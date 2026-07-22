# Text App (eski adıyla LiveChat) — Teknik Mimari ve Klonlama Blueprint'i

> **Belge türü:** Reverse-engineering + Senior Software Architecture blueprint
> **Hedef kitle:** Frontend ve backend mühendisleri (bir ürün klonlama ekibi)
> **Kaynak:** `https://www.text.com/app` üzerinde yapılan birinci-el, kimliği doğrulanmış canlı gözlemler (20 Temmuz 2026) + text.com resmî geliştirici dokümanları (Platform API'leri stabil sürüm **v3.6**)
> **Dil kuralı:** Açıklamalar Türkçe, tüm kod/tanımlayıcı/URL İngilizce. Yalnızca gözleme değil çıkarıma dayanan ifadeler açıkça **(çıkarım)** olarak işaretlenmiştir.

Bu belge, Text App'in (marka: "Text"; teknik altyapı: LiveChat Platform) sıfırdan klonlanabilmesi için gereken teknik kararların tamamını içerir: üst düzey mimari, frontend bileşen ağacı, REST/RTM API kontratları, veritabanı şeması (PostgreSQL DDL + Prisma), güvenlik/performans/bakım değerlendirmesi ve üretime hazır iskelet kodlar. Gözlemlenen gerçek kiracı (tenant), Türkçe bir online bahis/casino müşteri destek operasyonudur ("Hit Asistan" botu); örnek veriler bu bağlamdan alınmıştır.

---

## 1. Yönetici Özeti ve Klonlama Hedefi

### 1.1. Neyi klonluyoruz?

Text App, çok kanallı (omnichannel) bir **canlı sohbet + yapay zekâ destek platformudur**. Ürün iki büyük yüzeyden oluşur ve klonlama projesinin çekirdeği bu iki yüzey arasındaki **gerçek zamanlı (realtime) mesajlaşma çekirdeğidir**:

1. **Customer Widget (müşteri tarafı):** Şirketin web sitesine gömülen, çapraz-köken (cross-origin) bir iframe içinde çalışan sohbet balonu. Async bir JavaScript loader ile yüklenir ve yapılandırması `window.__lc` global nesnesi üzerinden lisansa (license) bağlanır. Varlıklar (assets) `cdn.static-text.com` üzerinden servis edilir (örneğin `/assets/text-app/greetings/default-greetings/hello.png`). Gözlemlenen widget, "Product Expert" kimliğiyle bir karşılama kartı, "Let's chat / Just browsing" seçenekleri, dosya ekleme + emoji + gönderme kontrollerine sahip bir composer ve "Powered by text.com" ibaresi içerir.

2. **Agent App (temsilci tarafı):** `https://www.text.com/app` adresinde çalışan bir **Single Page Application (SPA)**. Deep-link yapısı `/app/<module>` biçimindedir (örneğin `/app/inbox/chats/all/{threadId}/{chatId}`). Temsilciler burada gelen sohbetleri karşılar, yapay zekâ ajanı (AI Agent) ve Copilot ile çalışır, CRM'i, kampanyaları, raporları ve ayarları yönetir.

Bu iki yüzeyi birbirine bağlayan omurga, bir **RTM (Real-Time Messaging) WebSocket protokolü** ile onun stateless muadili olan **Web API (XHR/REST)** katmanıdır. Müşteri bir mesaj gönderdiğinde olay (event) backend'de kalıcılaştırılır, yönlendirilir (routing) ve ilgili temsilcilere/botlara push edilir; temsilci yanıtı da aynı kanaldan müşteriye geri döner.

### 1.2. Widget ↔ Agent-App gerçek zamanlı çekirdeği

Platformun en kritik teknik değeri, mesajların **hem stateful (RTM/WebSocket) hem stateless (Web API + polling)** yollarla taşınabilmesidir. Resmî dokümanların netleştirdiği temel model şudur:

- Bir müşterinin belirli bir lisans üzerinde aynı anda **yalnızca tek bir aktif `chat`'i** olabilir.
- Bir `chat`, birden fazla `thread` içerir. Sohbet kapatıldığında (deactivate) açık `thread` kapanır; sohbet yeniden başlatıldığında (resume) aynı `chat` içinde **yeni bir `thread`** açılır. Yani `chat` süreklidir, `thread` ise bir oturum parçasıdır.
- Mesajlar, tag'ler, sistem bildirimleri ve zengin mesajlar (rich message) hepsi birer **`event`** olarak modellenir; `thread` içinde sıralı biçimde tutulur.

Bu üçlü (chat → thread → event) modeli, hem veri tabanı tasarımının hem de API kontratlarının merkezindedir ve klonun tüm mesajlaşma mantığı bunun üzerine kurulmalıdır.

### 1.3. Çok kiracılı (multi-tenant) / lisans modeli

Platform çok kiracılıdır ve izolasyon anahtarı **license/account/organization** üçlüsüdür:

- **`organization_id`** — üst düzey kiracı kimliği, UUID formatında (dokümanlardaki örnek: `390e44e6-f1e6-0368c-z6ddb-74g14508c2ex`). Customer Chat API çağrılarında zorunlu query parametresidir (`?organization_id=...`).
- **`account_id`** — kimliği doğrulanan aktör (temsilci) hesabı, UUID (örnek: `f09ba25b-8be8-4fcd-a2c8-0b1c567aec85`).
- **`license`** — faturalama ve veri sınırlama biriminin klasik LiveChat karşılığı; widget yapılandırması lisansa bağlanır (çıkarım: `window.__lc.license`).
- **`client_id`** — OAuth uygulamasının kimliği, hex string (örnek: `1b4237f476826986da63022a76c35bb1`).

Gözlemlenen kiracıda **Owner** rolü "Can" (hunterwagn.e.r.6.3.76@gmail.com), **Admin** rolü "Calendertasker" (calendertasker@gmail.com) hesabıdır. Rol matrisi: **Owner / Admin / Agent** (LiveChat mirası olarak `viceowner` rolü de webhook payload'larında görülür). Her temsilcinin **eşzamanlı sohbet limiti** vardır (gözlemlenen: "6 concurrent chats limit").

### 1.4. Ticaret / abonelik modeli (klonun faturalama tasarımını belirler)

Gözlemlenen fiyatlandırma, koltuk-tabanlı (seat-based) + ölçülü (metered) hibrit bir modeldir:

- **$99 / kullanıcı / ay** (Growth planı). 2 kullanıcı = $198/ay. Monthly/Annual geçişi var ("Save $480 with annual plan").
- **AI resolutions**: Plana dahil 200 adet; ek her 50 adet **$49.50**. Kullanım sayacı "0 / 200".
- **API calls**: Ek her 100.000 çağrı **$29.50**.
- 14 günlük deneme (trial); gözlem anında "8 days left", "Starts on Jul 28, 2026".

Bu model, veritabanında `subscriptions` ve `usage` tablolarını, backend'de ise API çağrılarını ve AI çözümlerini **ölçen (metering)** bir katmanı zorunlu kılar (Bölüm 5 ve 6).

### 1.5. Gözlemlenen gerçek kimlikler (ID envanteri)

| Varlık | Format | Gözlemlenen örnek |
| --- | --- | --- |
| Chat ID / Ticket ID | 10 karakter base32 token | `TI1H8CFKRV`, `TI1G5Y48ZB` (doküman örneği: `PJ0MRSHTDG`) |
| Thread ID | 10 karakter base32 token | `TI1G04K0P9` (doküman örneği: `K600PKZON8`) |
| Event ID | `{thread_id}_{n}` veya UUID | `K600PKZON8_4`, `0affb00a-82d6-4e07-ae61-56ba5c36f743` |
| AI Agent ID | UUID | `0321ca9a-df85-405c-937a-589987b1a4f1` |
| account_id | UUID | `f09ba25b-8be8-4fcd-a2c8-0b1c567aec85` |
| organization_id | UUID | `390e44e6-f1e6-0368c-z6ddb-74g14508c2ex` |
| client_id | 32 haneli hex | `1b4237f476826986da63022a76c35bb1` |
| Bot ID | 32 haneli hex | `5c9871d5372c824cbf22d860a707a578` |
| Customer ID | UUID | `b7eff798-f8df-4364-8059-649c35c9ed0c` |
| Group (team) ID | integer | `0`, `1`, `19`, `42` |
| Agent ID | e-posta adresi | `smith@example.com` |
| Tag | serbest string (name) | `bug_report`, `payment` |
| Property namespace | 32 haneli hex | `0805e283233042b37f460ed8fbf22160` |

Bu ID şemaları, klonun anahtar tasarımı (Bölüm 5) için doğrudan referanstır: chat/thread için kısa, URL-güvenli, çakışmaya dayanıklı base32 token'lar; kullanıcı/organizasyon için UUID; grup için tamsayı; temsilci için e-posta birincil anahtarı.

### 1.6. Klonlama hedefinin kapsamı

Klon, aşağıdaki modül haritasını (icon rail → alt sayfalar) birebir karşılamalıdır: **Inbox** (Chats, AI Agents, Tickets, Views), **Customers** (Real-time visitor tracking, Contacts/CRM, Campaigns), **Team** (AI Agents, Copilot, Teammates, Teams), **Playbook** (otomasyon/skill motoru), **AI Agent** (skill editörü + RAG Knowledge), **Reports** (Overview, AI Agent, Metrics breakdown, Chat topics), **Settings** (Channels, Routing, Inbox, Integrations, Security, Billing), **Apps marketplace** ve **MCP server** (`https://mcp.text.com/`). Bu modüllerin işlevsel detayı 1. Rapor'da; teknik karşılıkları bu belgede işlenir.

---

## 2. Üst Düzey Mimari

### 2.1. Kelimelerle mimari

Sistemi altı mantıksal katmana ayırıyoruz:

**(A) Customer Edge (müşteri kenarı).** Şirket web sitesine bir `<script>` snippet'i eklenir. Bu snippet `window.__lc` yapılandırma nesnesini kurar (lisans/organizasyon kimliğini taşır) ve `cdn.static-text.com` üzerinden asenkron loader'ı çeker. Loader, sayfada bir launcher balonu ve tıklanınca açılan bir **cross-origin iframe** oluşturur. iframe, müşteri arayüzünü izole eder (ana sayfanın CSS/JS'inden etkilenmez, ana sayfanın DOM'una erişemez — güvenlik açısından kritik). Müşteri mesajları buradan **Customer Chat API** (Web API + isteğe bağlı RTM WebSocket) üzerinden backend'e gider.

**(B) Auth / Accounts.** Kimlik doğrulama ayrı bir servis kümesindedir: `accounts.text.com` / `accounts.livechat.com`. Temsilciler OAuth 2.1 ile; müşteriler "cookie grant" akışıyla `POST https://accounts.livechat.com/v2/customer/token` üzerinden **customer access token** alır. Sunucu-sunucu entegrasyonları için **Personal Access Token (PAT)** ve botlar için **bot token** kullanılır.

**(C) Realtime / RTM.** Kalıcı, çift yönlü WebSocket katmanı. Temsilci SPA'i ve isteğe bağlı olarak müşteri widget'ı buraya bağlanır; `login` → `subscribe` sonrası sunucu, `incoming_chat`, `incoming_event`, `chat_transferred`, `routing_status_set` gibi **push**'ları iletir. Bu, arayüzün sayfa yenilemeden canlı güncellenmesini sağlar (gözlem: sohbet listesi, traffic ve presence canlı güncelleniyor).

**(D) Backend Services.** Domain'e bölünmüş servisler: **Chat/Messaging** (chat/thread/event yaşam döngüsü), **Routing** (kural motoru + grup/temsilci ataması), **Configuration** (agents/bots/groups/tags/webhooks yönetimi), **AI Orchestration** (AI Agent skill yürütme + RAG + Copilot), **Reports/Analytics** (toplulaştırma), **Billing/Metering** (koltuk + kullanım ölçümü). Tüm bu servisler `https://api.livechatinc.com/v3.6` altında versiyonlanmış REST yüzeyleriyle dışa açılır.

**(E) Data + Cache.** Kalıcı depo olarak PostgreSQL (ilişkisel çekirdek); presence, unread sayaçları, RTM oturum yönlendirme ve rate-limit için Redis; mesaj arşivi/analitik için kolon-tabanlı bir depo (çıkarım); RAG için bir vektör deposu (çıkarım). Dosya paylaşımları için nesne depolama + CDN (`cdn.static-text.com`).

**(F) AI + MCP.** AI Agent skill motoru ve Copilot, LLM'lere ve RAG knowledge kaynaklarına bağlanır. Ayrıca dışa dönük bir **MCP server** (`https://mcp.text.com/`) vardır; "Works with Claude, ChatGPT, and any MCP-compatible tool" — yani kiracının Text verisi, MCP protokolü üzerinden harici AI asistanlarına açılır.

### 2.2. Multi-tenant yönlendirme

Her istek `organization_id` / `account_id` / `license` ile kiracıya bağlanır. RTM bağlantısı `login` sırasında token'dan çıkarılan kiracıya sabitlenir; backend, bir olayı yalnızca aynı lisanstaki yetkili aktörlere (temsilci/bot) push eder. Veritabanı düzeyinde her tablo `organization_id`/`license_id` taşır ve sorgular bu anahtarla filtrelenir (Row-Level Security veya uygulama katmanı zorlaması — Bölüm 6).

### 2.3. Mermaid mimari diyagramı

```mermaid
flowchart TB
    subgraph Customer["Customer Edge (web sitesi)"]
        WSNIP["window.__lc snippet + async loader<br/>(cdn.static-text.com)"]
        IFRAME["Cross-origin iframe<br/>Customer Widget UI"]
        WSNIP --> IFRAME
    end

    subgraph Agent["Agent SPA (www.text.com/app)"]
        SHELL["SPA Shell: TopBar + IconRail<br/>+ Module Sidebar + 3-pane Inbox<br/>+ Details/Copilot panel"]
    end

    subgraph Auth["Accounts / Auth (accounts.text.com)"]
        OAUTH["OAuth 2.1 (agents)<br/>Customer token (cookie grant)<br/>PAT + Bot token"]
    end

    subgraph Edge["API Gateway / Rate limiter"]
        GW["api.livechatinc.com/v3.6<br/>REST (XHR) + RTM (WebSocket)"]
    end

    subgraph Services["Backend Services"]
        MSG["Chat / Messaging<br/>(chat-thread-event)"]
        ROUTE["Routing engine<br/>(rules + groups)"]
        CONF["Configuration<br/>(agents/bots/groups/tags/webhooks)"]
        AI["AI Orchestration<br/>(Skills + RAG + Copilot)"]
        REP["Reports / Analytics"]
        BILL["Billing / Metering"]
    end

    subgraph Data["Data & Cache"]
        PG[("PostgreSQL")]
        REDIS[("Redis: presence,<br/>unread, RTM routing")]
        VEC[("Vector store (RAG)")]
        OBJ[("Object storage + CDN")]
    end

    subgraph AIlayerExt["AI / MCP"]
        LLM["LLM providers"]
        MCP["MCP server<br/>(mcp.text.com)"]
    end

    HOOKS["Webhooks (HTTP push)"]

    IFRAME -->|Customer Chat API| GW
    SHELL -->|Agent Chat API + RTM| GW
    SHELL -.->|login| OAUTH
    IFRAME -.->|cookie grant| OAUTH
    GW --> MSG & ROUTE & CONF & AI & REP & BILL
    MSG --> PG
    MSG --> REDIS
    ROUTE --> REDIS
    AI --> VEC
    AI --> LLM
    MSG --> OBJ
    REP --> PG
    BILL --> PG
    MSG -->|events| HOOKS
    CONF -->|config events| HOOKS
    MCP --> GW
    LLM -.-> MCP
```

### 2.4. Neden bu topoloji?

- **iframe izolasyonu**, müşteri widget'ını ana sitenin XSS yüzeyinden ve stil çakışmalarından ayırır; ayrıca çapraz-köken postMessage köprüsü ile kontrollü iletişim sağlar.
- **RTM + Web API ikiliği**, hem düşük gecikmeli canlı deneyim (temsilci masaüstü) hem de stateless entegrasyonlar (webhook tetikli otomasyonlar, veri senkronizasyonu) için tek platformda iki tüketim modeli sunar. Resmî doküman: "If you need a persistent, real-time connection... use the RTM API. Compared to RTM, Web API responses may have a slight delay."
- **Configuration/Chat/Reports API ayrımı**, sorumlulukların net bölünmesini (SRP) ve bağımsız ölçeklenmeyi sağlar.
- **MCP server**, ürünü "AI-native" yapar: kiracı verisi standart bir protokolle harici LLM araçlarına açılır (örnek prompt: "Find all tickets where customers ask about bulk orders").

---

## 3. Frontend & Component Mimarisi

### 3.1. Uygulama kabuğu (SPA Shell)

Agent App, sayfa yenilemeden modüller arası gezinen bir SPA'dir; URL değiştiğinde yalnızca içerik bölgesi yeniden render edilir, kabuk (shell) ayakta kalır. Kabuk şu kalıcı bileşenlerden oluşur:

- **TopBar (üst çubuk):** Solda logo/hamburger, "N Leads qualified" pill'i (gözlem: "1 Leads qualified"), ortada `⌘K` global arama ("Search Text or go to…"), sağda avatar grubu, "Invite +N" düğmesi ve trial rozeti ("8 days"). Global arama hem içerik araması hem komut paleti (go-to) işlevi görür.
- **Left Icon Rail (sol ikon şeridi):** Yukarıdan aşağı **Inbox, Contacts/People, Team, Engage (target), Reports (bar chart)**; altta **Settings (gear), Help (?)** ve **Account avatar ("C")**. Aktif modül vurgulanır. "Unpin side navigation" ile daraltılabilir.
- **Module Sidebar (2. sütun):** Aktif modülün alt navigasyonu. Örneğin Inbox için: Chats (All / My chats / Queued / Unassigned / Supervised / Archive), AI Agents (AI agent / Solved), Tickets (All / Unassigned / My open / More), Views (WhatsApp / Messenger / Twilio SMS / My recent chats).
- **3-Pane Inbox (asıl içerik):** **Liste** (sohbet öğeleri) | **Conversation** (transkript + Reply Suggestions chip'leri + composer) | **Details/Copilot paneli**.
- **Right Panel (Details / Copilot):** Müşteri detayları (Chat info, Chat tags, Visited pages, Visit info, Assignee, Chat ID, Duration) ile Copilot AI-assist. Panel modüller arasında kalıcıdır ("Details / Copilot / Expand details" düğmeleri her sayfada görünür).

### 3.2. Bileşen ağacı (kabuk)

```
<AppShell>
├── <TopBar>
│   ├── <BrandLogo /> <SidebarToggle />
│   ├── <LeadsPill count={1} />
│   ├── <GlobalSearch hotkey="cmd+k" />   // command palette + search
│   └── <TopBarActions>
│       ├── <AgentAvatarGroup /> <InviteButton delta="+1" />
│       └── <TrialBadge daysLeft={8} />
├── <IconRail>
│   ├── <RailItem icon="inbox" to="/app/inbox" active />
│   ├── <RailItem icon="contacts" to="/app/customers" />
│   ├── <RailItem icon="team" to="/app/team" />
│   ├── <RailItem icon="engage" to="/app/playbook" />
│   ├── <RailItem icon="reports" to="/app/reports" />
│   └── <RailFooter> <SettingsItem /> <HelpItem /> <AccountMenu /> </RailFooter>
├── <ModuleSidebar module={activeModule} />   // context-dependent
├── <ModuleOutlet />                           // React Router <Outlet/>
│   └── e.g. <InboxLayout>
│       ├── <ChatList virtualized />
│       ├── <Conversation>
│       │   ├── <Transcript />
│       │   ├── <ReplySuggestions />
│       │   └── <Composer />
│       └── <DetailsPanel /> | <CopilotPanel />
└── <ToastHost /> <ModalHost /> <PresenceProvider />
```

### 3.3. Paylaşılan UI kütüphanesi (design system)

Klonun bakımını sürdürülebilir kılmak için tek bir headless + tema-lı bileşen kütüphanesi önerilir (React + Radix UI primitifleri + Tailwind veya CSS-in-JS tokenları). Gözlemlerden türetilen minimum bileşen envanteri:

| Bileşen | Kullanım yeri (gözlem) |
| --- | --- |
| `Button` (primary/secondary/ghost/danger) | "Invite teammates", "Save changes", "New campaign", "Add website" |
| `Card` | Channel kartları, KPI kartları, template/skill kartları, marketplace app kartları |
| `Modal` / `Dialog` | "Invite teammates" modalı, "Create ticket", onboarding survey popover |
| `Table` / `DataGrid` | Contacts (Name/Email/Phone/Country/Last active/Chats/Tickets), Teammates, Tickets grid, Knowledge sources, Websites |
| `Tabs` | Contacts (All/Leads/Last 30d), AI Agent (Performance/Profile/Skills/Knowledge), Playbook (All/AI agents/Workspace/Drafts), Canned responses (Chat/Ticket) |
| `Skeleton` | Liste/transkript/rapor yüklenirken (çıkarım — SPA loading state) |
| `Toast` | Kaydetme onayı, hata bildirimleri (çıkarım) |
| `Stepper` | AI skill editöründeki sıralı adımlar (detect intent → request info → tag → summarize → send message → transfer); billing "Users" stepper |
| `Toggle` / `Switch` | "Skill active", channel ON/OFF, per-skill enable toggle, Monthly/Annual toggle |
| `Dropdown` / `Select` | Message type dropdown, Role select (Owner/Admin/Agent), Sort/Filter, Billing cycle |
| `Chip` / `Pill` | Reply Suggestions, "N Leads qualified", tag rozetleri, "AI Agent" / "Trending skill" badge'leri |
| `Avatar` / `AvatarGroup` | Temsilci avatarları, owner avatarı ("Can") |
| `SearchInput` | "Search teammates", "Enter name, email, or phone", `⌘K` global arama |
| `Badge` / `StatusDot` | Status (Accepting/Not accepting/Offline), 2FA (Active/Inactive), "Connected"/"Coming soon" |
| `VirtualizedList` | Chat list, contacts, transcript (uzun listeler için) |
| `RichTextEditor` | Composer (rich text, emoji, `#` canned, attach), Article knowledge kaynağı |
| `DateRangePicker` | Reports (7/30/90/365 gün + custom) |

### 3.4. Customer widget bileşen ağacı

Widget, ana siteden bağımsız ayrı bir React (veya Preact — daha küçük bundle için, çıkarım) uygulamasıdır ve cross-origin iframe içinde çalışır:

```
<WidgetRoot>            // iframe içinde mount
├── <Launcher bubble /> // kapalıyken sağ-alt köşedeki balon
└── <WidgetWindow>      // açıkken
    ├── <WidgetHeader>  // agent identity: "Product Expert", kapat/küçült
    ├── <GreetingCard>  // "Hello! Need a hand?..." + [Let's chat] [Just browsing]
    ├── <MessageList virtualized />   // customer/agent event'leri
    ├── <TypingIndicator />           // "agent is typing" (RTM sender_typing)
    ├── <Composer>                    // +attach, message input, emoji, send
    └── <PoweredBy href="text.com" />
```

Widget, ana pencere ile **`postMessage`** köprüsü üzerinden konuşur (sayfa URL'i, session fields, açma/kapama komutları). Loader snippet'i şu iskelete sahiptir (LiveChat'in bilinen `window.__lc` deseni):

```html
<!-- Text/LiveChat widget loader (before </body>) -->
<script>
  window.__lc = window.__lc || {};
  window.__lc.license = 1234567;              // license id (tenant-scoped)
  window.__lc.integration_name = "manual_onboarding";
  window.__lc.product_name = "text_app";
  (function (n, t, c) {
    function i(n) { return e._h ? e._h.apply(null, n) : e._q.push(n); }
    var e = {
      _q: [], _h: null, _v: "2.0",
      on: function () { i(["on", c.call(arguments)]); },
      once: function () { i(["once", c.call(arguments)]); },
      off: function () { i(["off", c.call(arguments)]); },
      get: function () { return i(["get", c.call(arguments)]); },
      call: function () { i(["call", c.call(arguments)]); },
      init: function () {
        var n = t.createElement("script");
        n.async = true;
        n.type = "text/javascript";
        n.src = "https://cdn.static-text.com/text-app/loader.js"; // asset host
        t.head.appendChild(n);
      }
    };
    !n.__lc.asyncInit && e.init();
    n.TextWidget = n.TextWidget || e;
  })(window, document, [].slice);
</script>
<noscript>Powered by <a href="https://www.text.com/">text.com</a></noscript>
```

### 3.5. Durum yönetimi (state management) tahmini

SPA'in yönetmesi gereken global durumlar gözlemlerden şöyle çıkar:

- **Session/Agent state:** oturum açmış temsilci (id, role, avatar), routing status (Accepting / Not accepting / Offline), eşzamanlı sohbet limiti (6), lisans/organizasyon bağlamı.
- **Active chat list:** All / My / Queued / Unassigned / Supervised / Archive kovaları; her biri filtre + sıralama (My chats / Oldest) taşır.
- **Presence:** real-time visitor tracking (All / Chatting / Supervised / Queued / Waiting for reply / Invited / Browsing) ve temsilci presence'ı.
- **Unread / notification counters:** sidebar rozetleri ("My chats 1", "Unassigned 1", "AI agent 0").
- **Routing:** aktif rota (deep-link), seçili thread/chat, sağ panel modu (Details vs Copilot).

**Öneri:** Sunucu durumu (server state) için **React Query (TanStack Query)** — sohbet listeleri, contacts, reports gibi REST verilerinin cache + revalidation'ı; **RTM push'ları** geldiğinde ilgili query'ler `queryClient.setQueryData` ile optimistically güncellenir. Client/UI durumu için ise hafif ve boilerplate'siz olduğu için **Zustand** önerilir (alternatif: Redux Toolkit + RTK Query, daha büyük ekipler ve katı denetlenebilirlik gerektiğinde). RTM WebSocket, tekil bir `RtmProvider` içinde açılır ve gelen push'ları hem Zustand store'a hem React Query cache'ine yansıtır.

### 3.6. React vs Vue notu

Gözlemlenen üründeki modüler kabuk, yoğun sanallaştırılmış listeler, `⌘K` komut paleti ve karmaşık iç durum, **React** ekosisteminin güçlü olduğu alanlardır (TanStack Query/Virtual, Radix, geniş işe alım havuzu). Klon için **React 18 + TypeScript** önerilir. Vue 3 (+ Pinia + Vue Query) teknik olarak eşdeğer bir seçenektir ve daha küçük bir öğrenme eğrisi sunar; ancak bu belgedeki örnekler React üzerinden verilmiştir çünkü realtime-yoğun, çok panelli editör arayüzleri için React'in olgun kütüphane yüzeyi daha geniştir. LiveChat'in tarihsel olarak React kullandığı bilinmektedir (çıkarım — kamuya açık iş ilanları ve mevcut SPA davranışı).

### 3.7. Gerçek örnek React bileşeni — `ChatListItem`

```tsx
// src/features/inbox/components/ChatListItem.tsx
import { memo } from "react";
import { useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { Avatar } from "@/ui/Avatar";
import { StatusDot } from "@/ui/StatusDot";
import { formatRelative } from "@/lib/time";
import type { ChatSummary } from "@/features/inbox/types";

interface ChatListItemProps {
  chat: ChatSummary;
  active: boolean;
}

/**
 * Inbox sohbet listesindeki tek satır.
 * Gözlemlenen örnek: "Example Customer — Reopened - by agent — 9m".
 */
export const ChatListItem = memo(function ChatListItem({ chat, active }: ChatListItemProps) {
  const navigate = useNavigate();

  const open = () =>
    navigate(`/app/inbox/chats/all/${chat.threadId}/${chat.chatId}`);

  return (
    <button
      type="button"
      onClick={open}
      aria-current={active ? "true" : undefined}
      className={clsx(
        "chat-list-item",
        active && "chat-list-item--active",
        chat.unreadCount > 0 && "chat-list-item--unread",
      )}
    >
      <Avatar name={chat.customerName} src={chat.customerAvatarUrl} />
      <div className="chat-list-item__body">
        <div className="chat-list-item__top">
          <span className="chat-list-item__name">{chat.customerName}</span>
          <time className="chat-list-item__time" dateTime={chat.lastEventAt}>
            {formatRelative(chat.lastEventAt)}
          </time>
        </div>
        <p className="chat-list-item__preview">
          {chat.statusLabel ? <em>{chat.statusLabel} · </em> : null}
          {chat.lastMessagePreview}
        </p>
      </div>
      <div className="chat-list-item__meta">
        <StatusDot status={chat.presence /* chatting | queued | supervised */} />
        {chat.unreadCount > 0 && (
          <span className="chat-list-item__badge">{chat.unreadCount}</span>
        )}
      </div>
    </button>
  );
});
```

### 3.8. Gerçek örnek Zustand store — `useInboxStore`

```ts
// src/features/inbox/store/useInboxStore.ts
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { subscribeWithSelector } from "zustand/middleware";
import type { ChatSummary, RtmPush } from "@/features/inbox/types";

type ChatBucket =
  | "all" | "my" | "queued" | "unassigned" | "supervised" | "archive";

interface InboxState {
  chatsById: Record<string, ChatSummary>;
  bucketOrder: Record<ChatBucket, string[]>;   // chatId listesi, sıralı
  activeChatId: string | null;
  unreadTotal: number;

  // actions
  setActiveChat: (chatId: string | null) => void;
  upsertChat: (chat: ChatSummary) => void;
  applyRtmPush: (push: RtmPush) => void;        // RTM/webhook köprüsü
  markSeen: (chatId: string) => void;
}

export const useInboxStore = create<InboxState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      chatsById: {},
      bucketOrder: {
        all: [], my: [], queued: [], unassigned: [], supervised: [], archive: [],
      },
      activeChatId: null,
      unreadTotal: 0,

      setActiveChat: (chatId) =>
        set((s) => {
          s.activeChatId = chatId;
          if (chatId && s.chatsById[chatId]) {
            s.unreadTotal -= s.chatsById[chatId].unreadCount;
            s.chatsById[chatId].unreadCount = 0;
          }
        }),

      upsertChat: (chat) =>
        set((s) => {
          const existed = Boolean(s.chatsById[chat.chatId]);
          s.chatsById[chat.chatId] = chat;
          if (!existed) s.bucketOrder.all.unshift(chat.chatId);
        }),

      // RTM push -> UI reducer. incoming_chat / incoming_event / chat_transferred...
      applyRtmPush: (push) =>
        set((s) => {
          switch (push.action) {
            case "incoming_chat": {
              const c = push.payload.chat;
              s.chatsById[c.id] = mapChat(c);
              s.bucketOrder.all.unshift(c.id);
              break;
            }
            case "incoming_event": {
              const { chat_id, event } = push.payload;
              const chat = s.chatsById[chat_id];
              if (!chat) break;
              chat.lastMessagePreview = event.text ?? "";
              chat.lastEventAt = event.created_at;
              if (chat_id !== s.activeChatId && event.author_type === "customer") {
                chat.unreadCount += 1;
                s.unreadTotal += 1;
              }
              // listeyi en üste taşı (recency)
              moveToFront(s.bucketOrder.all, chat_id);
              break;
            }
            case "chat_transferred": {
              // grup/temsilci ataması değişti -> kovaları yeniden hesapla
              rebucket(s, push.payload.chat_id, push.payload.transferred_to);
              break;
            }
            case "chat_deactivated": {
              moveToBucket(s, push.payload.chat_id, "archive");
              break;
            }
          }
        }),

      markSeen: (chatId) =>
        set((s) => {
          const c = s.chatsById[chatId];
          if (!c) return;
          s.unreadTotal -= c.unreadCount;
          c.unreadCount = 0;
        }),
    })),
  ),
);
```

Bu store, `RtmProvider` içinde WebSocket'ten gelen her push için `applyRtmPush()` çağrılarak beslenir; böylece kabuk sayfa yenilemeden canlı kalır.

### 3.9. UI/UX notları

- **Geçişler (transitions):** Panel açılış/kapanışları, launcher balonu ve modal'lar için 150–200 ms ease-out animasyonlar; içerik değişiminde skeleton → içerik cross-fade.
- **Responsive breakpoint'ler (çıkarım):** `>= 1280px` üç panelin tümü; `768–1279px` sağ panel varsayılan gizli (Details/Copilot düğmesiyle overlay); `< 768px` tek panel + alt tab bar (mobil temsilci deneyimi). Widget tarafında ise `< 640px` tam ekran, üzerinde köşe penceresi.
- **Virtualized listeler:** Chat list, contacts tablosu ve uzun transkriptler `@tanstack/react-virtual` ile sanallaştırılır; 10.000+ satırda bile 60 fps hedefi.
- **Dark theme:** CSS değişkenleriyle (design tokens) light/dark; `prefers-color-scheme` + kullanıcı override. Tüm renkler token üzerinden (örneğin `--surface`, `--text-primary`, `--accent`).
- **SPA shell reload etmez:** React Router ile client-side routing; modül değişince yalnızca `<ModuleOutlet/>` yeniden render olur, WebSocket bağlantısı ve global store korunur. Kod bölme (code splitting) her modül için `React.lazy` + `Suspense`.
- **Erişilebilirlik:** `⌘K` komut paleti klavyeyle tam gezilebilir; liste öğeleri `role="button"` + `aria-current`; renk-dışı durum göstergeleri (StatusDot yanında metin).

---

## 4. API & Veri Akışı (Backend)

Platform, tüm yüzeylerini `https://api.livechatinc.com/v3.6` altında **versiyonlanmış** olarak sunar (stabil sürüm **v3.6**). Dört ana API ailesi vardır: **Agent Chat API**, **Customer Chat API**, **Configuration API**, **Reports API**. Her ailenin hem **Web API (XHR/REST)** hem **RTM (WebSocket)** transportu vardır (Reports hariç — o yalnızca REST'tir).

![API access sayfası — APIs & SDKs ve Personal access tokens sekmeleri](gorseller/teknik/01-settings-api-access.jpg)

Yukarıdaki ekran, uygulama içindeki **Settings → Integrations → API access** sayfasıdır (`/app/settings/integrations/api-access/apis-sdks`). "APIs & SDKs" ve "Personal access tokens" sekmeleri, "Available APIs" listesinde **Reports API, Agent Chat API, Configuration API** ile **Customer Chat API**'yi gösterir; sağ üstte "API pricing ↗" ve "Documentation ↗" bağlantıları vardır.

### 4.1. Genel REST deseni

- **Taban URL + versiyon:** `https://api.livechatinc.com/v3.6/<api>/<transport>/<method>`. Web API için `<transport>` genelde `action`'dır; örneğin `.../customer/action/start_chat`, `.../configuration/action/create_agent`.
- **HTTP metodu:** Neredeyse tüm çağrılar **`POST`** ve JSON gövdelidir (RPC-tarzı "action" yaklaşımı, klasik REST kaynak fiillerinden çok metod adı taşır).
- **İçerik türü:** `Content-Type: application/json`.
- **Kimlik doğrulama başlığı:** `Authorization: Basic <base64(account_id:PAT)>` (PAT) veya `Authorization: Bearer <token>` (OAuth 2.1 / customer / bot).
- **Kiracı bağlamı:** Customer Chat API'de zorunlu `?organization_id=<uuid>` query parametresi; diğerlerinde bağlam token'dan çözülür.
- **Sayfalama (pagination):** `limit` + `sort_order` (asc/desc) ile başlar; yanıt `next_page_id` ve `previous_page_id` döner. Sonraki isteklerde bunlardan biri `page_id` olarak gönderilir. `filters`, `limit`, `sort_order`, `page_id` ile birlikte gönderilemez. `page_id` en fazla **1 ay** geçerlidir.
- **Hata biçimi:** `{ "error": { "type": "...", "message": "..." } }`. Rate limit aşımında `Too many requests` tipi döner; bir süre sonra istek yeniden açılır.
- **Batch:** Configuration API, aynı işlemi çok sayıda kaynağa uygulayan batch metodları sağlar; istek `{ "requests": [ ... ] }`, yanıt `{ "responses": [ ... ] }` biçimindedir ve sıra korunur, hatalar satır-içi döner.

### 4.2. Agent Chat API

Temsilci/bot perspektifinden sohbetlere programatik erişim. Doküman: "programmatic access to everything that happens in your Text conversations." İki transport:

- **Web API (XHR):** Stateless, "you send a request, you get a response." Veri senkronizasyonu, otomasyon tetikleme, webhook'a tepki veren araçlar için uygun.
- **RTM API (WebSocket):** Kalıcı, gerçek zamanlı bağlantı; canlı özel sohbet arayüzleri için. RTM, Web API'ye göre daha düşük gecikmelidir.

Temsilci tarafının temel action metodları (v3.6 — doküman ve LiveChat Platform deseni):

| Method | Amaç |
| --- | --- |
| `login` (yalnız RTM) | WebSocket oturumu açar, token doğrular, presence/subscribe başlatır |
| `list_chats` | Temsilcinin erişebildiği sohbetleri sayfalı listeler |
| `list_threads` | Bir chat'in thread'lerini listeler |
| `get_chat` | Tek bir chat + thread + event'leri getirir |
| `start_chat` | Yeni chat başlatır (initial events ile) |
| `resume_chat` | Kapalı chat'i yeni thread ile yeniden açar |
| `deactivate_chat` | Açık thread'i kapatır (chat'i pasifleştirir) |
| `send_event` | Bir chat'e event (message/system_message/rich_message/file) gönderir |
| `send_rich_message_postback` | Rich message buton geri bildirimi |
| `upload_file` | Dosya yükler (attach) |
| `transfer_chat` | Chat'i başka grup/temsilciye aktarır |
| `add_user_to_chat` / `remove_user_from_chat` | Temsilci/müşteri ekle-çıkar (supervise/assign) |
| `tag_thread` / `untag_thread` | Thread'e tag ekler/kaldırır |
| `update_chat_properties` / `update_thread_properties` / `update_event_properties` | Namespace'li property CRUD |
| `set_routing_status` | Temsilci durumu: `accepting_chats` / `not_accepting_chats` / `offline` |
| `mark_events_as_seen` | Okundu işareti (`seen_up_to`) |
| `send_typing_indicator` | "Agent is typing" göstergesi |
| `list_agents_for_transfer` | Aktarım için uygun temsilci listesi |

**Örnek — `send_event` (temsilci mesajı gönderme):**

```http
POST https://api.livechatinc.com/v3.6/agent/action/send_event
Authorization: Basic <base64(account_id:PAT)>
Content-Type: application/json

{
  "chat_id": "TI1H8CFKRV",
  "event": {
    "type": "message",
    "text": "Merhaba, para çekme talebinizi kontrol ediyorum.",
    "recipients": "all"
  }
}
```

**Botlar:** Bir bot olarak API çağırmak için **bot token** gerekir; token, Configuration API'nin `issue_bot_token` metodu ile üretilir. Botlar `create_bot` ile kaydedilir ve gruplara `priority` (first/normal/last) ile atanır.

### 4.3. Customer Chat API

Müşteri perspektifinden (widget veya özel arayüz). Resmî guide'da tam çalışan bir örnek verilmiştir. Taban: `https://api.livechatinc.com/v3.6/customer/action/<method>?organization_id=<uuid>`, `Authorization: Bearer <customer_token>`.

**Müşteri token'ı (cookie grant):**

```http
POST https://accounts.livechat.com/v2/customer/token
Content-Type: application/json
(credentials: include  -> tarayıcı çerezi gönderilir)

{
  "grant_type": "cookie",
  "client_id": "<your_client_id>",
  "organization_id": "<your_organization_id>",
  "response_type": "token",
  "redirect_uri": "https://your-site.example"
}
```

Yanıt: `{ "access_token": "...", "entity_id": "<customer_id>", "organization_id": "..." }`. `entity_id` müşteri kimliğidir.

**Temel action metodları ve akış:**

| Method | Amaç |
| --- | --- |
| `list_chats` | Müşterinin bu lisanstaki chat'lerini listeler (en fazla bir aktif chat) |
| `list_threads` | Bir chat'in thread'lerini + event'lerini getirir (polling burada kullanılır) |
| `start_chat` | İlk mesajla yeni chat başlatır |
| `resume_chat` | Var olan (kapalı) chat'i yeni thread ile açar |
| `send_event` | Aktif chat'e mesaj gönderir |
| `deactivate_chat` | Chat'i kapatır (açık thread'i kapatır) |
| `update_customer` | Müşteri profil alanlarını günceller |

**`start_chat` (müşteri, ilk mesajla):**

```http
POST https://api.livechatinc.com/v3.6/customer/action/start_chat?organization_id=<uuid>
Authorization: Bearer <customer_token>
Content-Type: application/json

{
  "chat": {
    "thread": {
      "events": [
        { "type": "message", "text": "Merhaba", "recipients": "all" }
      ]
    }
  }
}
```

Yanıt: `{ "chat_id": "...", "thread_id": "...", "event_id": "..." }`.

**`send_event` (müşteri):**

```http
POST https://api.livechatinc.com/v3.6/customer/action/send_event?organization_id=<uuid>
Authorization: Bearer <customer_token>

{
  "chat_id": "TI1H8CFKRV",
  "event": { "type": "message", "text": "Yatırımım gelmedi", "recipients": "all" }
}
```

**Polling (RTM kullanılmıyorsa):** `list_threads` her 3 saniyede çağrılır; istemci gördüğü event id'lerini bir `Set` içinde tutar, yeni event'leri arayüze ekler. Resmî guide bu deseni birebir gösterir; üretimde RTM WebSocket önerilir (polling yerine push).

**Özel müşteri bilgisi taşıma (custom widgets guide):** İki mekanizma:
- **Properties:** kalıcı iş bağlamı (account tier, purchase history, support status) — "who's this person to our business?"
- **Session fields:** geçici gezinme bağlamı (görüntülenen sayfalar, sitede geçen süre, sepet değeri) — "what's this person doing right now?"

Her ikisi de temsilcinin Details panelinde görünür (gözlem: Visited pages, Visit info, Referring page, IP, Visit duration).

### 4.4. Configuration API

Lisans genelindeki yapılandırmayı yönetir: agents, bots, groups, tags, webhooks, properties, auto access rules. Taban: `https://api.livechatinc.com/v3.6/configuration/action/<method>`, `Authorization: Basic <PAT>`.

**Örnek metod grupları (doküman + LiveChat Platform):**

| Alan | Metodlar |
| --- | --- |
| Agents | `create_agent`, `update_agent`, `delete_agent`, `suspend_agent`, `unsuspend_agent`, `approve_agent`, `list_agents`, `get_agent` |
| Agents (batch) | `batch_create_agents`, `batch_update_agents`, `batch_delete_agents`, `batch_suspend_agents`, `batch_unsuspend_agents`, `batch_approve_agents` |
| Bots | `create_bot`, `update_bot`, `delete_bot`, `list_bots`, `get_bot`, `issue_bot_token`, `reset_bot_secret` |
| Bots (batch) | `batch_create_bots`, `batch_update_bots`, `batch_delete_bots` |
| Groups (teams) | `create_group`, `update_group`, `delete_group`, `list_groups` |
| Tags | `create_tag`, `update_tag`, `delete_tag`, `list_tags` |
| Webhooks | `register_webhook`, `unregister_webhook`, `list_webhooks`, `enable_license_webhooks`, `disable_license_webhooks` |
| Properties | `register_property`, `update_property_configuration`, `list_license_properties` |
| Auto access | `add_auto_access`, `update_auto_access`, `delete_auto_access`, `list_auto_accesses` |

**Batch örneği (doküman):**

```http
POST https://api.livechatinc.com/v3.6/configuration/action/batch_delete_agents
Authorization: Basic <PAT>
Content-Type: application/json

{ "requests": [ { "id": "smith@example.com" }, { "id": "brown@example.com" }, {} ] }
```

Yanıt sırayı korur, hata satır-içi döner:

```json
{ "responses": [ {}, {}, { "error": { "type": "validation", "message": "`id` is required" } } ] }
```

**Auto access (otomatik erişim kuralları)**, gözlemlenen **Chat routing** özelliğinin backend karşılığıdır: `conditions` (url / domain / geolocation) → `access` (groups). Örneğin "Chats on text.com from United States → group 1".

### 4.5. Reports API

Yalnızca REST. Taban: `https://api.livechatinc.com/v3.6/reports/<category>/<report>`. Güvenlik: PAT (Basic; kullanıcı adı = account ID, parola = PAT) veya OAuth2 Bearer. Gerekli scope: **`reports_read`**. OpenAPI etiketleri: **Chats, Agents, Customers, Tags**.

**Örnek — `chats/duration` (ortalama sohbet süresi):**

```http
POST https://api.livechatinc.com/v3.6/reports/chats/duration
Authorization: Basic <PAT>
Content-Type: application/json

{
  "distribution": "day",
  "timezone": "Europe/Istanbul",
  "filters": {
    "from": "2026-07-14T00:00:00+03:00",
    "to":   "2026-07-20T23:59:59+03:00"
  }
}
```

Yanıt:

```json
{
  "name": "duration-report",
  "total": 369,
  "records": {
    "2026-07-14": { "agents_chatting_duration": 10800, "count": 37, "duration": 12100 },
    "2026-07-15": { "agents_chatting_duration": 7200, "count": 48, "duration": 8400 }
  }
}
```

**`distribution`** değerleri: `hour`, `day`, `day-hours`, `month`, `year`. **`filters`** desteklenen alanlar: `from`/`to` (RFC3339), `agents` (var/yok/values/exclude), `tags`, `groups` (integer id dizisi), `sales`, `goals`, `forms` (pre_chat/post_chat + answer id filtreleri), `event_types`, `greetings`, `agent_response` (ilk yanıt modifikatörü dahil), `customer_countries` (ISO 3166-1 Alpha-2), `properties` (namespace'li). Filtre verilmezse rapor son 7 günü kapsar.

Bu API, uygulamadaki **Reports** modülünü besler (gözlem: Overview KPI kartları — Total chats 20 [Manual 9 / Assisted 6 / Automated 5], Total cases 20, All sales $0, Total chat duration 6h 51m, Automated chat duration 15m 57s; karşılaştırma "14–20 Jul vs 7–13 Jul"). "Chat topics" ise AI ile kümelenen konu raporudur (çıkarım: ayrı bir NLP/embedding kümeleme işi).

### 4.6. RTM / WebSocket protokolü

RTM, kalıcı bir WebSocket bağlantısıdır (çıkarım: `wss://api.livechatinc.com/v3.6/<agent|customer>/rtm/ws`). Akış:

1. **Bağlan + `login`:** İstemci WebSocket açar ve `login` push'u gönderir (token + istenen presence). Sunucu, mevcut chat özetlerini ve routing durumunu döner.

```json
{ "action": "login",
  "payload": { "token": "Bearer <token>", "customer_push_level": "my",
               "application": { "name": "clone-agent-app", "version": "1.0.0" } } }
```

2. **Subscribe / presence:** `login` sonrası sunucu, temsilcinin erişebildiği chat'lere ve traffic'e otomatik abone eder; `set_routing_status` ile temsilci "accepting chats" olur.

3. **Pushes (sunucudan gelen olaylar):** Her push `{ "request_id"?, "action", "type": "push", "payload" }` biçimindedir. Temel push action'ları (webhook muadilleriyle birebir):

| Push action | Anlam |
| --- | --- |
| `incoming_chat` | Yeni thread'li yeni chat geldi (tüm chat + thread yapısı payload'da) |
| `incoming_event` | Bir chat'e yeni event (mesaj) geldi |
| `event_updated` / `event_deleted` | Event güncellendi/silindi |
| `incoming_rich_message_postback` | Rich message buton tıklaması |
| `chat_deactivated` | Chat pasifleşti (thread kapandı) |
| `chat_transferred` | Chat başka grup/temsilciye aktarıldı (`reason`: manual/inactive/assigned/unassigned/other; `queue` bilgisi) |
| `chat_access_updated` | Chat erişimi (group_ids) değişti |
| `user_added_to_chat` / `user_removed_from_chat` | Temsilci/müşteri eklendi/çıkarıldı (supervise/assign) |
| `thread_tagged` / `thread_untagged` | Thread tag'lendi/tag kaldırıldı |
| `routing_status_set` | Bir temsilci/bot durumu değişti (accepting/not accepting/offline) |
| `chat_properties_updated` / `..._deleted` | Chat property CRUD |
| `thread_properties_updated` / `..._deleted` | Thread property CRUD |
| `event_properties_updated` / `..._deleted` | Event property CRUD |
| `customer_session_fields_updated` | Müşteri session field'ları güncellendi (her aktif chat için) |
| `events_marked_as_seen` | Okundu bilgisi (`seen_up_to`) |
| `thread_summary_set` | Thread özeti üretildi (Copilot/AI summary; `summary.text` markdown madde işaretli) |
| `sender_typing` (çıkarım) | "Typing" göstergesi |
| `agent_created/updated/deleted/...`, `bot_...`, `group_...`, `tag_...`, `auto_accesses_updated` | Konfigürasyon değişiklik push'ları |

4. **Presence / traffic:** Real-time visitor tracking (All / Chatting / Supervised / Queued / Waiting for reply / Invited / Browsing), traffic push'larıyla beslenir (çıkarım: `incoming_customers` / `customer_visit_started` benzeri traffic olayları — LiveChat Platform'da mevcut).

**`incoming_event` push örneği:**

```json
{
  "action": "incoming_event",
  "type": "push",
  "payload": {
    "chat_id": "PJ0MRSHTDG",
    "thread_id": "K600PKZON8",
    "event": {
      "id": "K600PKZON8_7",
      "type": "message",
      "text": "Yatırımım hâlâ gelmedi",
      "author_id": "b7eff798-f8df-4364-8059-649c35c9ed0c",
      "created_at": "2026-07-20T09:14:22.010200Z"
    }
  }
}
```

### 4.7. OAuth 2.1 + PAT + scopes

Üç kimlik doğrulama modu vardır:

- **Personal Access Token (PAT):** Sunucu-sunucu, `Authorization: Basic <base64(account_id:PAT)>`. API access sayfasındaki "Personal access tokens" sekmesinde üretilir. Hızlı entegrasyonlar ve dahili araçlar için.
- **OAuth 2.1 uygulaması:** `client_id` + `Secret key` + `Redirect URI whitelist` + Client type (Server-side app / JS app / Native app). Token türü `Authorization: Bearer <token>`. Müşteri token'ları da bu client üzerinden (cookie grant) üretilir.
- **Bot token:** `issue_bot_token` ile; botun kimliği hex `bot_id`.

**Scope (yetki kapsamı) örnekleri (doküman + Platform):** `reports_read`, `chats--all:rw` (tüm sohbetlere okuma-yazma), `chats--my:rw`, `chats--access:rw`, `customers:rw` / `customers:own`, `agents--all:rw`, `groups--all:rw`, `tags--all:rw`, `properties--all:rw`, `webhooks--all:rw`, `multicast:rw`. Scope'lar `--all` / `--my` / `--own` gibi erişim kapsamı ekleriyle ölçeklenir; batch metodları, batch-olmayan muadilleriyle aynı scope'u ister.

Müşteri token akışında (cookie grant) genelde ek scope gerekmez; token, o müşteri için chat aksiyonlarını örtük olarak yetkilendirir.

### 4.8. Webhooks

Configuration API'nin `register_webhook` metodu ile kaydedilir; olaylar HTTP POST ile hedef URL'e itilir. Her payload: `{ webhook_id, secret_key, action, organization_id, payload, additional_data }`; konfigürasyon olaylarında ek `requester { user_id, account_id, client_id }`. `secret_key` ile imza doğrulaması yapılır. Push muadilleri RTM ile aynıdır. Tam olay envanteri:

- **Chats:** `incoming_chat`, `chat_deactivated`
- **Chat access:** `chat_access_updated`, `chat_transferred`
- **Chat users:** `user_added_to_chat`, `user_removed_from_chat`
- **Events:** `incoming_event`, `event_deleted`, `event_updated`, `incoming_rich_message_postback`
- **Properties:** `chat_properties_updated`, `chat_properties_deleted`, `thread_properties_updated`, `thread_properties_deleted`, `event_properties_updated`, `event_properties_deleted`
- **Thread tags:** `thread_tagged`, `thread_untagged`
- **Status:** `routing_status_set`
- **Customers:** `customer_session_fields_updated`
- **Configuration:** `agent_created`, `agent_approved`, `agent_updated`, `agent_suspended`, `agent_unsuspended`, `agent_deleted`, `auto_accesses_updated`, `bot_created`, `bot_updated`, `bot_deleted`, `group_created`, `group_updated`, `group_deleted`, `tag_created`, `tag_deleted`, `tag_updated`
- **Other:** `events_marked_as_seen`, `thread_summary_set`

**`chat_transferred` webhook örneği (doküman):**

```json
{
  "webhook_id": "<webhook_id>", "secret_key": "<secret_key>",
  "action": "chat_transferred",
  "organization_id": "390e44e6-f1e6-0368c-z6ddb-74g14508c2ex",
  "payload": {
    "chat_id": "PJ0MRSHTDG", "thread_id": "K600PKZON8",
    "requester_id": "jones@example.com", "reason": "manual",
    "transferred_to": { "group_ids": [19], "agent_ids": ["smith@example.com"] },
    "queue": { "position": 42, "wait_time": 1337, "queued_at": "2019-12-09T12:01:18.909000Z" }
  }
}
```

### 4.9. Rate limit ve kullanım ölçümü (metering)

Doküman: "there are rate limits for method calls. After exceeding those limits, the requester will get a `Too many requests` error... After some time, the request will be unblocked." Klon için önerilen model (gözlemlenen fiyatlandırmayla hizalı):

- **Fatura-tabanlı kota:** API çağrıları ölçülür; plana dahil kotayı aşan her **100.000 çağrı için $29.50**. Bu, çağrı başına Redis sayaçlarıyla (sliding window) ve aylık toplulaştırmayla ölçülür (Bölüm 5, `usage` tablosu).
- **AI resolutions:** AI Agent'ın tek başına çözdüğü konuşmalar ölçülür; plana dahil **200**, aşan her **50 için $49.50**. Bir "resolution", AI'nın insana devretmeden kapattığı konuşmadır (çıkarım — Reports'taki "Automated 5" metriğiyle örtüşür).
- **Teknik rate limit:** Token/istemci başına saniyede X istek (leaky bucket / token bucket). RTM için mesaj başına ayrı limit. Aşımda `429 Too many requests` + `Retry-After`.

### 4.10. MCP server

![MCP server sayfası — mcp.text.com bağlantısı ve Claude kurulum yönergesi](gorseller/teknik/02-mcp-server.jpg)

Uygulama içindeki **Settings → Integrations → MCP server** (`/app/settings/integrations/mcp`) sayfası, dışa dönük bir **Model Context Protocol** sunucusu sunar: **`https://mcp.text.com/`** ("Connect with AI assistants — Ask AI assistants about your Text data. Works with Claude, ChatGPT, and any MCP-compatible tool."). Sayfada "Claude setup — Connect Claude to Text MCP" yönergesi ve örnek prompt ("Find all tickets where customers ask about bulk orders") bulunur.

**Klon için MCP tasarımı:** MCP server, OAuth 2.1 ile kimliği doğrulanan bir kullanıcı bağlamında, altta yatan Agent Chat / Reports / Configuration API'lerini **MCP tool** olarak paketler (örneğin `search_tickets`, `list_chats`, `get_report`, `summarize_chat`). Her tool çağrısı, kullanıcının scope'larıyla sınırlıdır ve kiracı (`organization_id`) bazında izole edilir. Bu, ürünü harici LLM istemcilerine "veri + eylem" katmanı olarak açar.

---

## 5. Veritabanı Tasarımı

Çekirdek depo **PostgreSQL**'dir. Tasarım, gözlemlenen chat → thread → event modelini, çok kiracılılığı ve faturalama/ölçüm gereksinimlerini yansıtır. Her tablo, kiracı izolasyonu için `organization_id` (ve/veya `license_id`) taşır.

### 5.1. Tablo envanteri ve kolonlar

Aşağıda ana tablolar ve kritik kolonları özetlenmiştir. Ayrıntılı DDL 5.3'te verilmiştir.

- **organizations** (kiracı kökü): `id (uuid pk)`, `name`, `created_at`.
- **licenses**: `id (bigint pk)`, `organization_id (fk)`, `plan` (growth), `billing_cycle` (monthly/annual), `trial_ends_at`, `status`, `created_at`.
- **accounts / users (agents)**: `id (uuid pk)`, `email (unique)`, `name`, `avatar_url`, `created_at`, `last_seen_at`. Bir kullanıcı birden çok lisansa üye olabilir.
- **agent_memberships** (kullanıcı ↔ lisans, rol/durum): `license_id (fk)`, `agent_id (fk)`, `role` (owner/admin/agent/viceowner), `routing_status` (accepting_chats/not_accepting_chats/offline), `concurrent_chats_limit (int, örn. 6)`, `two_factor_enabled (bool)`, `awaiting_approval (bool)`, `suspended (bool)`.
- **groups (teams / departments)**: `id (bigint pk, license-scoped)`, `license_id (fk)`, `name`, `language_code`. Chat yönlendirmesinin hedefi.
- **group_agents** (grup üyeliği + öncelik): `group_id (fk)`, `agent_id (fk)`, `priority` (first/normal/last).
- **customers / contacts (CRM)**: `id (uuid pk)`, `organization_id (fk)`, `name`, `email`, `phone`, `country_code`, `country`, `last_activity_at`, `is_lead (bool)`, `chats_count`, `tickets_count`, `created_at`. Gözlem: 13 contact (Turkey/Serbia/Netherlands), 2 lead.
- **chats**: `id (varchar(10) pk, base32 token)`, `license_id (fk)`, `customer_id (fk)`, `active (bool)`, `created_at`. Bir müşterinin lisans başına en fazla bir aktif chat'i (kısmi unique index).
- **threads**: `id (varchar(10) pk)`, `chat_id (fk)`, `active (bool)`, `queue_position`, `created_at`, `closed_at`, `summary (text)`, `summary_updated_at`. Chat içinde sıralı thread'ler.
- **events (messages)**: `id (varchar pk)`, `thread_id (fk)`, `chat_id (fk denormalize)`, `type` (message/system_message/rich_message/file/filled_form), `text`, `author_id`, `author_type` (agent/customer/bot/system), `recipients` (all/agents), `created_at`, `properties (jsonb)`, `attachment_url`. **Zaman-tabanlı partitionlanır.**
- **chat_access** (chat ↔ grup erişimi): `chat_id (fk)`, `group_id (fk)`.
- **chat_users** (chat'e dahil aktörler): `chat_id (fk)`, `user_id`, `user_type` (agent/customer), `present (bool)`, `seen_up_to (timestamptz)`.
- **tickets**: `id (varchar(10) pk)`, `license_id (fk)`, `customer_id (fk)`, `source_chat_id (fk nullable)`, `subject`, `status` (open/pending/solved/closed/spam), `assignee_id (fk nullable)`, `group_id (fk nullable)`, `last_message_at`, `created_at`. Gözlem: chat'ten ticket oluşturma ("Create ticket from chat").
- **tags**: `id (uuid pk)`, `license_id (fk)`, `name`, `author_id`, `created_at`. `group_ids (int[])` ile kapsam.
- **thread_tags** (thread ↔ tag): `thread_id (fk)`, `tag_id (fk)`.
- **canned_responses**: `id (uuid pk)`, `license_id (fk)`, `scope` (chat/ticket), `shortcut` (# ile çağrılan), `text`, `group_id (fk nullable)`. Gözlem: 23 chat canned response.
- **campaigns (greetings / targeted messages)**: `id (uuid pk)`, `license_id (fk)`, `name`, `type` (greeting/targeted_message), `status` (ongoing/scheduled/inactive), `conditions (jsonb)`, `content (jsonb)`, `starts_at`, `ends_at`. Gözlem: 2 ongoing kampanya.
- **ai_agents**: `id (uuid pk)`, `license_id (fk)`, `name`, `persona (jsonb)`, `tone`, `avatar_url`, `languages (text[])`, `active (bool)`. Gözlem uuid: `0321ca9a-df85-405c-937a-589987b1a4f1`. Copilot da bir ai_agent kaydıdır (tür: copilot).
- **skills (Playbook)**: `id (uuid pk)`, `ai_agent_id (fk nullable)`, `license_id (fk)`, `name`, `kind` (ai_agent/workspace), `instruction (text, doğal dil)`, `steps (jsonb, sıralı)`, `active (bool)`, `runs_count (int)`, `trigger (jsonb)`, `created_by`, `updated_at`. Step tipleri: detect_intent, request_info, tag, summarize, send_message, transfer_to_team.
- **skill_runs**: `id (uuid pk)`, `skill_id (fk)`, `chat_id (fk)`, `status`, `log (jsonb)`, `ran_at`.
- **knowledge_sources (RAG)**: `id (uuid pk)`, `ai_agent_id (fk)`, `type` (website/file/article/faq), `name`, `source_url`, `content (text)`, `status`, `updated_at`, `added_by`. Gözlem: 13 kaynak (1 website, 12 article).
- **knowledge_chunks (vektör)**: `id (uuid pk)`, `source_id (fk)`, `chunk_text`, `embedding (vector)`, `token_count`. (pgvector — çıkarım.)
- **webhooks**: `id (uuid pk)`, `license_id (fk)`, `client_id`, `url`, `action` (olay tipi), `secret_key`, `type` (license/bot), `enabled (bool)`.
- **api_tokens**: `id (uuid pk)`, `owner_id (fk agents / bots)`, `kind` (pat/oauth/bot), `token_hash`, `scopes (text[])`, `created_at`, `last_used_at`, `revoked_at`. PAT'ler hash'lenerek saklanır.
- **oauth_clients**: `id (varchar pk = client_id)`, `organization_id (fk)`, `display_name`, `secret_hash`, `redirect_uris (text[])`, `client_type` (server/js/native).
- **subscriptions**: `id (uuid pk)`, `license_id (fk)`, `plan`, `billing_cycle`, `seats (int)`, `unit_price_cents (9900)`, `ai_resolutions_included (200)`, `status`, `current_period_end`, `trial_ends_at`.
- **usage_records**: `id (uuid pk)`, `license_id (fk)`, `metric` (api_calls/ai_resolutions), `period` (yyyymm), `quantity`, `included`, `overage_unit`, `overage_unit_price_cents`. api_calls için 100000/$29.50; ai_resolutions için 50/$49.50.
- **routing_rules**: `id (uuid pk)`, `license_id (fk)`, `kind` (chat/ticket), `conditions (jsonb)` (url/domain/geolocation/page), `target_group_id (fk)`, `priority (int)`, `enabled (bool)`, `is_fallback (bool)`. Gözlem: fallback "route it to [Chatting Team]".
- **channels**: `id (uuid pk)`, `license_id (fk)`, `type` (website_widget/email/messenger/twilio/whatsapp/instagram/telegram/chat_page), `status` (connected/off/soon), `config (jsonb)`.
- **websites** (widget kurulumları): `id (uuid pk)`, `license_id (fk)`, `domain`, `created_by`, `connected_at`, `setup` (manual/platform), `status`. Gözlem: localhost, livechat-demo.surge.sh.
- **security_settings**: trusted_domains, banned_customers (ip/visitor), spam_filters, file_sharing_policy — hepsi `license_id`'ye bağlı yapılandırma tabloları.

### 5.2. Mermaid ER diyagramı (çekirdek)

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ LICENSES : has
    LICENSES ||--o{ AGENT_MEMBERSHIPS : grants
    ACCOUNTS ||--o{ AGENT_MEMBERSHIPS : joins
    LICENSES ||--o{ GROUPS : contains
    GROUPS ||--o{ GROUP_AGENTS : has
    ACCOUNTS ||--o{ GROUP_AGENTS : member
    ORGANIZATIONS ||--o{ CUSTOMERS : owns
    LICENSES ||--o{ CHATS : hosts
    CUSTOMERS ||--o{ CHATS : starts
    CHATS ||--o{ THREADS : contains
    THREADS ||--o{ EVENTS : holds
    CHATS ||--o{ CHAT_USERS : includes
    CHATS ||--o{ CHAT_ACCESS : scoped_to
    GROUPS ||--o{ CHAT_ACCESS : allows
    THREADS ||--o{ THREAD_TAGS : tagged
    TAGS ||--o{ THREAD_TAGS : applied
    LICENSES ||--o{ TICKETS : has
    CUSTOMERS ||--o{ TICKETS : raises
    LICENSES ||--o{ AI_AGENTS : configures
    AI_AGENTS ||--o{ SKILLS : owns
    SKILLS ||--o{ SKILL_RUNS : logs
    AI_AGENTS ||--o{ KNOWLEDGE_SOURCES : feeds
    KNOWLEDGE_SOURCES ||--o{ KNOWLEDGE_CHUNKS : chunked
    LICENSES ||--o{ CAMPAIGNS : runs
    LICENSES ||--o{ CANNED_RESPONSES : stores
    LICENSES ||--o{ ROUTING_RULES : defines
    LICENSES ||--o{ WEBHOOKS : registers
    LICENSES ||--o{ SUBSCRIPTIONS : billed_by
    LICENSES ||--o{ USAGE_RECORDS : meters

    ORGANIZATIONS { uuid id PK
        string name }
    LICENSES { bigint id PK
        uuid organization_id FK
        string plan
        timestamptz trial_ends_at }
    ACCOUNTS { uuid id PK
        string email
        string name }
    AGENT_MEMBERSHIPS { bigint license_id FK
        uuid agent_id FK
        string role
        int concurrent_chats_limit }
    CHATS { varchar id PK
        bigint license_id FK
        uuid customer_id FK
        bool active }
    THREADS { varchar id PK
        varchar chat_id FK
        bool active
        text summary }
    EVENTS { varchar id PK
        varchar thread_id FK
        string type
        text text
        string author_type
        timestamptz created_at }
    TICKETS { varchar id PK
        bigint license_id FK
        string status }
    AI_AGENTS { uuid id PK
        bigint license_id FK
        string name }
    SKILLS { uuid id PK
        uuid ai_agent_id FK
        string kind
        jsonb steps }
```

### 5.3. PostgreSQL DDL (çekirdek tablolar)

```sql
-- Multi-tenant kök
CREATE TABLE organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE licenses (
    id             BIGINT PRIMARY KEY,             -- LiveChat-tarzı license id
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    plan           TEXT NOT NULL DEFAULT 'growth',
    billing_cycle  TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','annual')),
    trial_ends_at  TIMESTAMPTZ,
    status         TEXT NOT NULL DEFAULT 'trialing',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       CITEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    avatar_url  TEXT,
    last_seen_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_memberships (
    license_id             BIGINT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    agent_id               UUID   NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role                   TEXT   NOT NULL CHECK (role IN ('owner','admin','agent','viceowner')),
    routing_status         TEXT   NOT NULL DEFAULT 'offline'
                           CHECK (routing_status IN ('accepting_chats','not_accepting_chats','offline')),
    concurrent_chats_limit INT    NOT NULL DEFAULT 6,
    two_factor_enabled     BOOLEAN NOT NULL DEFAULT false,
    awaiting_approval      BOOLEAN NOT NULL DEFAULT false,
    suspended              BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (license_id, agent_id)
);

CREATE TABLE groups (
    id            BIGINT NOT NULL,
    license_id    BIGINT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    language_code TEXT NOT NULL DEFAULT 'en',
    PRIMARY KEY (license_id, id)
);

CREATE TABLE customers (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name             TEXT,
    email            CITEXT,
    phone            TEXT,
    country_code     CHAR(2),
    country          TEXT,
    is_lead          BOOLEAN NOT NULL DEFAULT false,
    chats_count      INT NOT NULL DEFAULT 0,
    tickets_count    INT NOT NULL DEFAULT 0,
    last_activity_at TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chats (
    id          VARCHAR(12) PRIMARY KEY,            -- base32 token, örn. 'TI1H8CFKRV'
    license_id  BIGINT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    customer_id UUID   NOT NULL REFERENCES customers(id),
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Bir müşterinin lisans başına yalnızca 1 aktif chat'i olabilir:
CREATE UNIQUE INDEX uq_one_active_chat
    ON chats (license_id, customer_id) WHERE active;

CREATE TABLE threads (
    id                 VARCHAR(12) PRIMARY KEY,     -- base32 token
    chat_id            VARCHAR(12) NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    active             BOOLEAN NOT NULL DEFAULT true,
    queue_position     INT,
    summary            TEXT,
    summary_updated_at TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at          TIMESTAMPTZ
);
CREATE INDEX idx_threads_chat ON threads (chat_id, created_at);

-- EVENTS: zaman-tabanlı RANGE partition (aylık)
CREATE TABLE events (
    id           VARCHAR(40) NOT NULL,              -- 'K600PKZON8_7' veya uuid
    thread_id    VARCHAR(12) NOT NULL,
    chat_id      VARCHAR(12) NOT NULL,              -- denormalize (sorgu hızı)
    license_id   BIGINT NOT NULL,
    type         TEXT NOT NULL
                 CHECK (type IN ('message','system_message','rich_message','file','filled_form')),
    text         TEXT,
    author_id    TEXT,
    author_type  TEXT NOT NULL CHECK (author_type IN ('agent','customer','bot','system')),
    recipients   TEXT NOT NULL DEFAULT 'all' CHECK (recipients IN ('all','agents')),
    attachment_url TEXT,
    properties   JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE events_2026_07 PARTITION OF events
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE events_2026_08 PARTITION OF events
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
-- ... aylık partition'lar otomatik üretilir (pg_partman veya cron job)

CREATE INDEX idx_events_thread ON events (thread_id, created_at);
CREATE INDEX idx_events_chat   ON events (chat_id, created_at);
CREATE INDEX idx_events_license_time ON events (license_id, created_at);

CREATE TABLE chat_users (
    chat_id    VARCHAR(12) NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL,
    user_type  TEXT NOT NULL CHECK (user_type IN ('agent','customer')),
    present    BOOLEAN NOT NULL DEFAULT true,
    seen_up_to TIMESTAMPTZ,
    PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE chat_access (
    chat_id  VARCHAR(12) NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    group_id BIGINT NOT NULL,
    PRIMARY KEY (chat_id, group_id)
);

CREATE TABLE tags (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    license_id BIGINT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    author_id  TEXT,
    group_ids  BIGINT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (license_id, name)
);

CREATE TABLE thread_tags (
    thread_id VARCHAR(12) NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    tag_id    UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (thread_id, tag_id)
);

CREATE TABLE tickets (
    id              VARCHAR(12) PRIMARY KEY,
    license_id      BIGINT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    customer_id     UUID REFERENCES customers(id),
    source_chat_id  VARCHAR(12) REFERENCES chats(id),
    subject         TEXT,
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open','pending','solved','closed','spam')),
    assignee_id     UUID REFERENCES accounts(id),
    group_id        BIGINT,
    last_message_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tickets_license_status ON tickets (license_id, status, last_message_at DESC);

CREATE TABLE ai_agents (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    license_id BIGINT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL DEFAULT 'ai_agent' CHECK (kind IN ('ai_agent','copilot')),
    name       TEXT NOT NULL,
    persona    JSONB NOT NULL DEFAULT '{}'::jsonb,
    tone       TEXT,
    avatar_url TEXT,
    languages  TEXT[] NOT NULL DEFAULT '{}',
    active     BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE skills (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    license_id  BIGINT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    ai_agent_id UUID REFERENCES ai_agents(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('ai_agent','workspace')),
    instruction TEXT,                              -- doğal dil talimat
    steps       JSONB NOT NULL DEFAULT '[]'::jsonb,-- sıralı: detect_intent, request_info, tag, summarize, send_message, transfer_to_team
    trigger     JSONB NOT NULL DEFAULT '{}'::jsonb,
    active      BOOLEAN NOT NULL DEFAULT false,
    runs_count  INT NOT NULL DEFAULT 0,
    created_by  TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE knowledge_sources (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ai_agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN ('website','file','article','faq')),
    name        TEXT NOT NULL,
    source_url  TEXT,
    content     TEXT,
    status      TEXT NOT NULL DEFAULT 'ready',
    added_by    TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE knowledge_chunks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id   UUID NOT NULL REFERENCES knowledge_sources(id) ON DELETE CASCADE,
    chunk_text  TEXT NOT NULL,
    embedding   VECTOR(1536),                      -- pgvector (çıkarım)
    token_count INT
);
CREATE INDEX idx_chunks_embedding ON knowledge_chunks
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TABLE routing_rules (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    license_id     BIGINT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    kind           TEXT NOT NULL CHECK (kind IN ('chat','ticket')),
    conditions     JSONB NOT NULL DEFAULT '{}'::jsonb,  -- url/domain/geolocation/page
    target_group_id BIGINT,
    priority       INT NOT NULL DEFAULT 0,
    is_fallback    BOOLEAN NOT NULL DEFAULT false,
    enabled        BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE webhooks (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    license_id BIGINT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    client_id  TEXT,
    url        TEXT NOT NULL,
    action     TEXT NOT NULL,                      -- 'incoming_chat', 'incoming_event', ...
    secret_key TEXT NOT NULL,
    type       TEXT NOT NULL DEFAULT 'license' CHECK (type IN ('license','bot')),
    enabled    BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE api_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    license_id  BIGINT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    owner_id    TEXT NOT NULL,                     -- agent id / bot id
    kind        TEXT NOT NULL CHECK (kind IN ('pat','oauth','bot')),
    token_hash  TEXT NOT NULL,                     -- düz token asla saklanmaz
    scopes      TEXT[] NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ
);

CREATE TABLE subscriptions (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    license_id             BIGINT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    plan                   TEXT NOT NULL DEFAULT 'growth',
    billing_cycle          TEXT NOT NULL DEFAULT 'monthly',
    seats                  INT NOT NULL DEFAULT 1,
    unit_price_cents       INT NOT NULL DEFAULT 9900,   -- $99/user/mo
    ai_resolutions_included INT NOT NULL DEFAULT 200,
    status                 TEXT NOT NULL DEFAULT 'trialing',
    trial_ends_at          TIMESTAMPTZ,
    current_period_end     TIMESTAMPTZ
);

CREATE TABLE usage_records (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    license_id               BIGINT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
    metric                   TEXT NOT NULL CHECK (metric IN ('api_calls','ai_resolutions')),
    period                   CHAR(6) NOT NULL,           -- 'yyyymm'
    quantity                 BIGINT NOT NULL DEFAULT 0,
    included                 BIGINT NOT NULL,
    overage_unit             INT NOT NULL,               -- 100000 veya 50
    overage_unit_price_cents INT NOT NULL,               -- 2950 veya 4950
    UNIQUE (license_id, metric, period)
);
```

### 5.4. Prisma şeması (özet)

```prisma
// prisma/schema.prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

model Organization {
  id        String     @id @default(uuid()) @db.Uuid
  name      String
  createdAt DateTime   @default(now()) @map("created_at")
  licenses  License[]
  customers Customer[]
  @@map("organizations")
}

model License {
  id             BigInt   @id
  organizationId String   @map("organization_id") @db.Uuid
  organization   Organization @relation(fields: [organizationId], references: [id])
  plan           String   @default("growth")
  billingCycle   String   @default("monthly") @map("billing_cycle")
  trialEndsAt    DateTime? @map("trial_ends_at")
  chats          Chat[]
  groups         Group[]
  memberships    AgentMembership[]
  aiAgents       AiAgent[]
  @@map("licenses")
}

model Account {
  id          String   @id @default(uuid()) @db.Uuid
  email       String   @unique
  name        String
  memberships AgentMembership[]
  @@map("accounts")
}

model AgentMembership {
  licenseId            BigInt  @map("license_id")
  agentId              String  @map("agent_id") @db.Uuid
  role                 String
  routingStatus        String  @default("offline") @map("routing_status")
  concurrentChatsLimit Int     @default(6) @map("concurrent_chats_limit")
  twoFactorEnabled     Boolean @default(false) @map("two_factor_enabled")
  license License @relation(fields: [licenseId], references: [id])
  agent   Account @relation(fields: [agentId], references: [id])
  @@id([licenseId, agentId])
  @@map("agent_memberships")
}

model Chat {
  id         String   @id @db.VarChar(12)
  licenseId  BigInt   @map("license_id")
  customerId String   @map("customer_id") @db.Uuid
  active     Boolean  @default(true)
  createdAt  DateTime @default(now()) @map("created_at")
  license    License  @relation(fields: [licenseId], references: [id])
  customer   Customer @relation(fields: [customerId], references: [id])
  threads    Thread[]
  @@map("chats")
}

model Thread {
  id        String   @id @db.VarChar(12)
  chatId    String   @map("chat_id") @db.VarChar(12)
  active    Boolean  @default(true)
  summary   String?
  createdAt DateTime @default(now()) @map("created_at")
  chat      Chat     @relation(fields: [chatId], references: [id])
  events    Event[]
  @@index([chatId, createdAt])
  @@map("threads")
}

model Event {
  id         String   @db.VarChar(40)
  threadId   String   @map("thread_id") @db.VarChar(12)
  chatId     String   @map("chat_id") @db.VarChar(12)
  licenseId  BigInt   @map("license_id")
  type       String
  text       String?
  authorId   String?  @map("author_id")
  authorType String   @map("author_type")
  recipients String   @default("all")
  properties Json     @default("{}")
  createdAt  DateTime @default(now()) @map("created_at")
  thread     Thread   @relation(fields: [threadId], references: [id])
  @@id([id, createdAt])
  @@index([threadId, createdAt])
  @@map("events")
}

model AiAgent {
  id        String  @id @default(uuid()) @db.Uuid
  licenseId BigInt  @map("license_id")
  kind      String  @default("ai_agent")
  name      String
  active    Boolean @default(true)
  license   License @relation(fields: [licenseId], references: [id])
  skills    Skill[]
  @@map("ai_agents")
}

model Skill {
  id          String  @id @default(uuid()) @db.Uuid
  aiAgentId   String? @map("ai_agent_id") @db.Uuid
  name        String
  kind        String
  instruction String?
  steps       Json    @default("[]")
  active      Boolean @default(false)
  runsCount   Int     @default(0) @map("runs_count")
  aiAgent     AiAgent? @relation(fields: [aiAgentId], references: [id])
  @@map("skills")
}
```

### 5.5. İndeksler, kısıtlar ve partitionlama

- **`events` zaman-tabanlı partition:** `PARTITION BY RANGE (created_at)`, aylık partition'lar. Mesaj hacmi platformun en büyük tablosudur; partitionlama, sorgu prune'lama, eski verinin `DETACH PARTITION` ile ucuz arşivlenmesi ve `VACUUM` maliyetinin düşürülmesi için kritiktir. Partition oluşturma `pg_partman` veya bir zamanlanmış görev ile otomatikleştirilir.
- **Tekil aktif chat kısıtı:** `uq_one_active_chat` kısmi unique index, "bir müşterinin lisans başına tek aktif chat" kuralını veritabanı düzeyinde garanti eder (dokümandaki iş kuralı).
- **Kompozit indeksler:** Liste sorguları (`idx_events_thread`, `idx_tickets_license_status`, `idx_threads_chat`) recency sıralamasıyla (`created_at DESC`) uyumlu; keyset (cursor) pagination için `page_id` bu sıralamayı kodlar.
- **Kiracı filtreleme:** Tüm ana tablolarda `license_id`/`organization_id` indekslidir; sorgular her zaman bununla başlar.
- **jsonb GIN:** `properties`, `conditions`, `steps` alanlarında ihtiyaç halinde `GIN` indeks (özellik-tabanlı filtreleme, Reports `properties` filtresi).
- **Foreign key + CASCADE:** Silme yaşam döngüsünü (organization → license → chat → thread → event) tutarlı kılar.

### 5.6. Veri yaşam döngüsü ve saklama (retention / GDPR)

- **Arşivleme:** Kapatılan chat'ler (`active = false`) mantıksal olarak "Archive" kovasına düşer (gözlem: 20 archived chat). Fiziksel olarak eski `events` partition'ları soğuk depoya (S3 + Parquet, çıkarım) taşınır; sıcak veritabanı yalnızca yakın dönemi tutar.
- **Transkript e-postası:** "Chat transcripts" ayarı, kapatılan sohbetin dökümünü müşteriye/temsilciye e-postalar (gözlem: `/settings/chats/chat-transcripts`).
- **GDPR silme:** `customers` ve ilişkili `events` üzerinde "right to be forgotten" için hard-delete akışı; `ON DELETE CASCADE` ile chat/thread/event zinciri temizlenir, `usage_records` ve toplulaştırılmış raporlarda PII anonimleştirilir (kişisel alanlar `NULL`/hash). Silme talepleri denetim izi (audit log) bırakır.
- **PII maskeleme:** IP (gözlem: `127.122.53.34`, `195.88.86.56`), e-posta, telefon gibi alanlar için saklama süresi sonunda maskeleme/tokenizasyon. Banned customers tablosu IP/visitor bazlı kalıcı engelleri tutar.
- **Saklama politikası (çıkarım):** Plan bazında konfigüre edilebilir mesaj saklama (örneğin 12 ay sıcak, sonrası arşiv); yasal tutma (legal hold) istisnaları.

---

## 6. Mimari Değerlendirme

### 6.1. Güvenlik

**Kimlik doğrulama (authentication).** Üç ayrı kimlik akışı net biçimde ayrılmalıdır: temsilci (OAuth 2.1 authorization code + PKCE), sunucu-sunucu (PAT, Basic auth), müşteri (cookie grant → kısa ömürlü Bearer). PAT'ler ve OAuth secret'ları **asla düz metin saklanmaz**; yalnızca `token_hash` (argon2/bcrypt veya HMAC-SHA256) tutulur. Müşteri token'ları kısa TTL'lidir ve yalnızca ilgili `organization_id` kapsamındadır.

**Yetkilendirme (authorization).** İki katmanlı: (1) **rol** (Owner/Admin/Agent) uygulama yetkilerini belirler (örneğin yalnız Owner/Admin ayar/faturalama görür); (2) **scope** API token'ının erişebileceği kaynakları sınırlar (`chats--all:rw` vs `chats--my:rw`, `reports_read`). "My chats" vs "All chats" ayrımı, temsilcinin yalnızca kendine atanmış veya grubuna açık sohbetleri görmesini sağlayan satır düzeyi bir erişim modelidir (`chat_access.group_ids` + `chat_users`).

**Tenant izolasyonu.** En kritik güvenlik sınırı budur. Her sorgu `organization_id`/`license_id` ile filtrelenmeli; bunu garanti altına almak için PostgreSQL **Row-Level Security (RLS)** politikaları (`current_setting('app.license_id')` üzerinden) veya uygulama katmanında zorunlu bir tenant-scoped repository deseni kullanılır. RTM/webhook push'ları yalnızca aynı lisanstaki yetkili aktörlere gider; bir kiracının olayı asla başka kiracıya sızmamalıdır. Test stratejisi: her endpoint için "cross-tenant erişim reddi" negatif testleri.

**Widget XSS / CORS / trusted domains.** Müşteri widget'ı **cross-origin iframe** içinde izole edilir; böylece ana sayfanın DOM/JS'ine erişemez ve tersi de geçerlidir. Widget'ın yüklenebileceği alan adları **Trusted domains** allowlist'i ile sınırlandırılır (gözlem: `/settings/security/trusted-domains`); yalnızca izinli origin'ler `window.__lc` üzerinden bağlanabilir. Müşteri mesajları arayüzde render edilirken HTML **escape** edilir (temsilci tarafında da), kullanıcı içeriği asla `innerHTML` ile yazılmaz. API tarafında CORS, izinli origin listesine göre `Access-Control-Allow-Origin` döner. Dosya paylaşımı **File sharing** politikasıyla (izinli tür/boyut) sınırlanır ve virüs taraması yapılır (çıkarım).

**Rate limiting.** Token/istemci başına Redis tabanlı token-bucket. Aşımda `429 Too many requests`. Bu hem kötüye kullanımı hem de faturalanan API-call metriğini kontrol eder. WebSocket için bağlantı başına mesaj hızı ayrıca sınırlanır.

**PII.** IP, e-posta, telefon, konum gibi kişisel veriler minimum yetkiyle erişilir, aktarımda TLS 1.2+ ile şifrelenir, depoda hassas alanlar için sütun düzeyi şifreleme (çıkarım). GDPR silme akışı (Bölüm 5.6) ve denetim izi zorunludur. Banned customers ve Spam filtreleri kötü niyetli trafiği eler.

**Webhook güvenliği.** Her webhook `secret_key` ile imzalanır; alıcı imzayı doğrular (replay koruması için timestamp + nonce, çıkarım). OAuth client'ının `redirect_uri` whitelist'i zorunludur (open redirect önleme).

### 6.2. Performans

**SSR/SSG vs SPA.** Agent App yoğun etkileşimli, oturum-arkası bir uygulamadır; **SPA** (client-side rendering) doğru tercihtir — SEO gereksinimi yoktur, sayfa-arası durum korunmalıdır. Ancak pazarlama sayfaları (text.com kök) ve **Chat page** (paylaşılabilir sohbet linki) için **SSG/SSR** (Next.js) uygundur; ilk boyama (first paint) ve paylaşım önizlemesi için. Müşteri widget'ı ise küçük, bağımsız bir bundle (Preact/vanilla) olarak CDN'den servis edilir; ilk yükleme <50 KB hedefi (çıkarım).

**CDN.** Statik varlıklar (`cdn.static-text.com`), widget loader'ı, avatarlar, greeting görselleri edge CDN'den servis edilir; coğrafi yakınlık ve cache ile TTFB düşürülür. Loader asenkron yüklenir, ana sayfayı bloklamaz.

**Caching katmanları (Redis).** (1) **Presence/routing:** hangi temsilci online, hangi chat kimde — sürekli değişen, düşük gecikme gereken veriler Redis'te. (2) **Unread sayaçları:** sidebar rozetleri. (3) **RTM fan-out:** bir olayı birden çok temsilciye dağıtmak için Redis Pub/Sub veya bir mesaj kuyruğu. (4) **Rate-limit sayaçları.** (5) **Sık okunan config** (groups, tags, canned responses) kısa TTL cache. Kalıcı veriler PostgreSQL'de kalır; Redis yalnızca sıcak yol (hot path).

**Realtime: WebSocket vs long-polling.** WebSocket birincil transporttur (düşük gecikme, çift yönlü); doküman da "stateful implementation uses WebSocket technology — the same standard that powers Slack, WhatsApp." Long-polling yalnızca **fallback**'tir (kurumsal proxy/firewall WebSocket'i engellerse) ve Customer Chat API guide'ındaki 3 saniyelik `list_threads` polling deseni, WebSocket kullanmayan basit entegrasyonlar için gösterilmiştir. Üretimde WebSocket + otomatik yeniden bağlanma (exponential backoff) + kaçırılan olayları `sync` ile telafi (son görülen event id'den sonrası).

**Virtualized listeler.** 10.000+ sohbet/contact/mesaj için DOM'da yalnızca görünür satırlar render edilir (`@tanstack/react-virtual`). Transkript, en alttan yukarı sonsuz kaydırma (reverse infinite scroll) ile keyset pagination kullanır.

**Veritabanı performansı.** `events` partitionlaması, kompozit indeksler ve keyset pagination (offset yerine cursor) büyük ölçekte sabit-zaman liste sorguları sağlar. Reports için ağır toplulaştırmalar, canlı OLTP'yi yormamak için read-replica veya ayrı bir kolon-tabanlı analitik depoya (çıkarım) yönlendirilir.

### 6.3. Bakım kolaylığı (maintainability)

**Monorepo.** Frontend (agent-app, widget), backend servisleri, paylaşılan tipler ve UI kütüphanesi tek bir monorepo'da (pnpm workspaces + Turborepo veya Nx) tutulur. Ortak `@clone/types` paketi, API kontratlarını (chat/thread/event/webhook payload'ları) hem client hem server'a tek kaynaktan dağıtır (tip güvenliği, drift önleme).

**Modüler / domain-tabanlı klasör yapısı.** Backend, DDD sınırlarıyla bölünür: `messaging`, `routing`, `configuration`, `ai`, `reports`, `billing`, `identity`. Her bounded context kendi modelini, servislerini ve API yüzeyini sahiplenir; contexts arası iletişim olaylar (events) üzerindendir (event-driven). Frontend, `features/inbox`, `features/customers`, `features/team`, `features/playbook`, `features/reports`, `features/settings` biçiminde feature-sliced.

**SOLID uygulaması.** Her API metodu tek sorumluluk (SRP); transport (REST/RTM) ile domain mantığı ayrık; repository arayüzleri (DIP) sayesinde PostgreSQL implementasyonu test'te in-memory ile değiştirilebilir. Skill step tipleri (detect_intent, request_info, tag, summarize, send_message, transfer_to_team) bir **Strategy** deseniyle genişletilebilir (OCP) — yeni step tipi eklemek mevcut kodu değiştirmez.

**Test.** (1) **Unit:** domain servisleri, routing kural motoru, skill yürütücü. (2) **Integration:** API endpoint'leri gerçek PostgreSQL'e karşı (testcontainers). (3) **Contract:** webhook/RTM payload şemaları JSON Schema ile doğrulanır. (4) **E2E:** Playwright ile agent-app + widget arası tam bir sohbet akışı (müşteri mesaj → routing → temsilci yanıt → arşiv). (5) **Load:** WebSocket fan-out ve `events` yazma yolu için k6/Gatling. (6) **Security:** cross-tenant erişim reddi ve rate-limit testleri.

**Gözlemlenebilirlik (observability).** Yapılandırılmış loglar (correlation id = `request_id`), dağıtık izleme (OpenTelemetry), metrikler (RTM bağlantı sayısı, event/sn, p95 gecikme, rate-limit isabet oranı), ve faturalama için ayrı kullanım sayaçları. Her webhook teslimi ve retry'ı loglanır.

---

## 7. Development Notes (üretime hazır kod)

### 7.1. Monorepo ve klasör düzeni

```
clone-text-app/
├── apps/
│   ├── agent-app/          # React 18 + TS SPA (temsilci paneli)
│   │   └── src/
│   │       ├── features/{inbox,customers,team,playbook,reports,settings}/
│   │       ├── ui/         # paylaşılan design-system bileşenleri
│   │       ├── rtm/        # RtmProvider + WebSocket istemcisi
│   │       └── lib/        # api client, time, auth
│   ├── widget/             # Preact/vanilla müşteri widget'ı (CDN bundle)
│   └── chat-page/          # Next.js SSR paylaşılabilir sohbet sayfası
├── services/
│   ├── gateway/            # API gateway + auth + rate limit
│   ├── messaging/          # chat/thread/event (Agent + Customer Chat API)
│   ├── rtm/                # WebSocket sunucusu (Node veya Go)
│   ├── routing/            # kural motoru + queue
│   ├── configuration/      # agents/bots/groups/tags/webhooks
│   ├── ai/                 # skill yürütücü + RAG + Copilot
│   ├── reports/            # analitik toplulaştırma
│   └── billing/            # abonelik + kullanım ölçümü + webhooks (Stripe)
├── packages/
│   ├── types/              # paylaşılan API kontrat tipleri (@clone/types)
│   ├── db/                 # Prisma şeması + migration'lar
│   └── config/             # eslint/tsconfig/tailwind ortak yapılandırma
├── infra/                  # Dockerfile'lar, k8s manifest'leri, Terraform
├── docker-compose.yml
├── turbo.json
└── pnpm-workspace.yaml
```

### 7.2. WebSocket (RTM) sunucusu — Node.js iskeleti

```ts
// services/rtm/src/server.ts
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { verifyToken } from "@clone/auth";
import { redisSub, redisPub } from "./redis";

interface RtmSession {
  socket: WebSocket;
  accountId: string;
  licenseId: string;
  groupIds: number[];
}

const sessions = new Map<string, RtmSession>();          // sessionId -> session
const byLicense = new Map<string, Set<string>>();         // licenseId -> sessionIds

const httpServer = createServer();
const wss = new WebSocketServer({ server: httpServer, path: "/v3.6/agent/rtm/ws" });

wss.on("connection", (socket) => {
  const sessionId = crypto.randomUUID();
  let authed = false;

  socket.on("message", async (raw) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return closeBad(socket); }

    // 1) login: token doğrula, oturumu lisansa bağla
    if (msg.action === "login") {
      const claims = await verifyToken(msg.payload?.token);
      if (!claims) return closeBad(socket, "authentication");
      authed = true;
      const session: RtmSession = {
        socket, accountId: claims.accountId,
        licenseId: claims.licenseId, groupIds: claims.groupIds,
      };
      sessions.set(sessionId, session);
      (byLicense.get(session.licenseId) ?? byLicense.set(session.licenseId, new Set()).get(session.licenseId)!)
        .add(sessionId);
      send(socket, { request_id: msg.request_id, action: "login", success: true,
        payload: { chats_summary: await loadChatSummaries(session) } });
      return;
    }

    if (!authed) return closeBad(socket, "authentication");
    const session = sessions.get(sessionId)!;

    // 2) istemci aksiyonları (örn. set_routing_status, mark_events_as_seen)
    switch (msg.action) {
      case "set_routing_status":
        await setRoutingStatus(session, msg.payload.status);
        // diğer oturumlara routing_status_set push'u fan-out edilir
        await redisPub.publish(`license:${session.licenseId}`,
          JSON.stringify({ action: "routing_status_set",
            payload: { agent_id: session.accountId, status: msg.payload.status } }));
        send(socket, { request_id: msg.request_id, success: true });
        break;
      case "ping":
        send(socket, { action: "pong" });
        break;
      default:
        send(socket, { request_id: msg.request_id, success: false,
          error: { type: "not_found", message: "unknown action" } });
    }
  });

  socket.on("close", () => {
    const s = sessions.get(sessionId);
    if (s) byLicense.get(s.licenseId)?.delete(sessionId);
    sessions.delete(sessionId);
  });
});

// 3) messaging servisinden gelen olayları ilgili lisansın oturumlarına dağıt (fan-out)
redisSub.psubscribe("license:*");
redisSub.on("pmessage", (_pattern, channel, payload) => {
  const licenseId = channel.split(":")[1];
  const push = JSON.parse(payload);                        // { action, payload }
  for (const sid of byLicense.get(licenseId) ?? []) {
    const s = sessions.get(sid);
    if (!s) continue;
    // erişim filtresi: chat push'u yalnız yetkili gruptaki temsilciye
    if (push.payload?.chat?.access?.group_ids &&
        !push.payload.chat.access.group_ids.some((g: number) => s.groupIds.includes(g))) continue;
    send(s.socket, { ...push, type: "push" });
  }
});

function send(sock: WebSocket, obj: unknown) { sock.send(JSON.stringify(obj)); }
function closeBad(sock: WebSocket, type = "validation") {
  send(sock, { success: false, error: { type, message: "invalid request" } });
  sock.close();
}

httpServer.listen(3010, () => console.log("RTM server on :3010"));
```

### 7.3. WebSocket (RTM) sunucusu — Go iskeleti

```go
// services/rtm/main.go
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

type Session struct {
	conn      *websocket.Conn
	accountID string
	licenseID string
	groupIDs  []int
	mu        sync.Mutex
}

type Hub struct {
	mu        sync.RWMutex
	byLicense map[string]map[*Session]struct{} // licenseID -> set of sessions
}

func NewHub() *Hub { return &Hub{byLicense: map[string]map[*Session]struct{}{}} }

func (h *Hub) add(s *Session) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.byLicense[s.licenseID] == nil {
		h.byLicense[s.licenseID] = map[*Session]struct{}{}
	}
	h.byLicense[s.licenseID][s] = struct{}{}
}

func (h *Hub) remove(s *Session) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.byLicense[s.licenseID], s)
}

// Fanout: messaging servisinden (Redis Pub/Sub) gelen push'u lisansa dağıt.
func (h *Hub) Fanout(licenseID string, push map[string]any) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for s := range h.byLicense[licenseID] {
		if !authorized(s, push) {
			continue
		}
		s.mu.Lock()
		_ = s.conn.WriteJSON(push)
		s.mu.Unlock()
	}
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return isTrustedOrigin(r.Header.Get("Origin")) },
}

func (h *Hub) serveWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	var s *Session
	for {
		var msg map[string]any
		if err := conn.ReadJSON(&msg); err != nil {
			if s != nil {
				h.remove(s)
			}
			return
		}
		switch msg["action"] {
		case "login":
			claims, ok := VerifyToken(payloadString(msg, "token"))
			if !ok {
				_ = conn.WriteJSON(errObj("authentication"))
				return
			}
			s = &Session{conn: conn, accountID: claims.AccountID,
				licenseID: claims.LicenseID, groupIDs: claims.GroupIDs}
			h.add(s)
			_ = conn.WriteJSON(map[string]any{"action": "login", "success": true})
		case "ping":
			_ = conn.WriteJSON(map[string]any{"action": "pong"})
		default:
			if s == nil {
				_ = conn.WriteJSON(errObj("authentication"))
				return
			}
			_ = conn.WriteJSON(errObj("not_found"))
		}
	}
}

func errObj(t string) map[string]any {
	return map[string]any{"success": false, "error": map[string]string{"type": t}}
}

func main() {
	hub := NewHub()
	go SubscribeRedis(hub) // Redis Pub/Sub -> hub.Fanout
	http.HandleFunc("/v3.6/agent/rtm/ws", hub.serveWS)
	log.Println("RTM (Go) on :3010")
	log.Fatal(http.ListenAndServe(":3010", nil))
}

// yardımcılar (imza): authorized, isTrustedOrigin, VerifyToken, SubscribeRedis, payloadString
func authorized(s *Session, push map[string]any) bool { _ = s; _ = push; return true }
func isTrustedOrigin(o string) bool                    { _ = o; return true }
func payloadString(m map[string]any, k string) string {
	if p, ok := m["payload"].(map[string]any); ok {
		if v, ok := p[k].(string); ok {
			return v
		}
	}
	return ""
}
```

### 7.4. REST endpoint — auth + `send_event`

```ts
// services/messaging/src/routes/sendEvent.ts
import { Router } from "express";
import { authenticate } from "../middleware/authenticate";     // PAT / OAuth / bot
import { requireScope } from "../middleware/requireScope";
import { rateLimit } from "../middleware/rateLimit";           // Redis token-bucket
import { meterApiCall } from "../middleware/meter";            // usage_records++
import { messagingService } from "../services/messagingService";

export const router = Router();

// POST /v3.6/agent/action/send_event
router.post(
  "/agent/action/send_event",
  authenticate,                         // Authorization: Basic <PAT> | Bearer <token>
  requireScope("chats--all:rw"),        // yetki kapsamı
  rateLimit({ perMinute: 600 }),        // 429 Too many requests
  meterApiCall("api_calls"),            // faturalanan metrik
  async (req, res) => {
    const { license } = req.auth;       // authenticate tarafından enjekte
    const { chat_id, event } = req.body;

    if (!chat_id || !event?.type) {
      return res.status(400).json({ error: { type: "validation", message: "`chat_id` and `event.type` are required" } });
    }

    // Tenant izolasyonu: chat gerçekten bu lisansa mı ait?
    const chat = await messagingService.getChatForLicense(chat_id, license.id);
    if (!chat) {
      return res.status(404).json({ error: { type: "not_found", message: "chat not found" } });
    }

    // Event'i kalıcılaştır + RTM/webhook fan-out'unu tetikle
    const saved = await messagingService.sendEvent({
      licenseId: license.id,
      chatId: chat_id,
      threadId: chat.activeThreadId,
      authorId: req.auth.actorId,
      authorType: req.auth.actorType,    // agent | bot
      event,
    });

    // 200: kaydedilen event
    return res.status(200).json({
      event_id: saved.id,
      thread_id: saved.threadId,
      chat_id: saved.chatId,
    });
  },
);
```

`messagingService.sendEvent`, event'i `events` tablosuna yazar, `redisPub.publish('license:<id>', { action: 'incoming_event', payload })` ile RTM fan-out'u tetikler ve kayıtlı webhook'lara `incoming_event` POST eder.

### 7.5. React müşteri widget bileşeni

![Customer widget — istemci render'ı (greeting kartı + composer)](gorseller/teknik/03-customer-widget.jpg)

Yukarıdaki ekran, müşteri tarafında render edilen widget'tır. Aşağıdaki bileşen, Customer Chat API'yi (cookie grant + `start_chat`/`send_event` + polling) kullanan minimal ama üretime yakın bir implementasyondur:

```tsx
// apps/widget/src/ChatWidget.tsx
import { useEffect, useRef, useState, useCallback } from "react";

const API = "https://api.livechatinc.com/v3.6/customer/action";
const ACCOUNTS = "https://accounts.livechat.com/v2/customer/token";

interface Msg { author: "You" | "Agent"; text: string; }

export function ChatWidget({ clientId, organizationId }: { clientId: string; organizationId: string; }) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const seen = useRef<Set<string>>(new Set());

  // 1) cookie grant ile customer token al
  const authorize = useCallback(async () => {
    const res = await fetch(ACCOUNTS, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "cookie", client_id: clientId,
        organization_id: organizationId, response_type: "token",
        redirect_uri: window.location.origin }),
    });
    const data = await res.json();
    setToken(data.access_token); setCustomerId(data.entity_id);
  }, [clientId, organizationId]);

  useEffect(() => { authorize(); }, [authorize]);

  const post = useCallback((method: string, body: unknown) =>
    fetch(`${API}/${method}?organization_id=${organizationId}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.json()), [organizationId, token]);

  // 2) mesaj gönder: yoksa start_chat, kapalıysa resume_chat, sonra send_event
  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !token) return;
    setDraft("");
    setMessages((m) => [...m, { author: "You", text }]);

    if (!chatId) {
      const d = await post("start_chat",
        { chat: { thread: { events: [{ type: "message", text, recipients: "all" }] } } });
      setChatId(d.chat_id); setThreadId(d.thread_id); setActive(true);
      seen.current.add(d.event_id); return;
    }
    if (!active) {
      const r = await post("resume_chat", { chat: { id: chatId } });
      setThreadId(r.thread_id); setActive(true);
    }
    const d = await post("send_event",
      { chat_id: chatId, event: { type: "message", text, recipients: "all" } });
    seen.current.add(d.event_id);
  }, [draft, token, chatId, active, post]);

  // 3) polling (üretimde RTM WebSocket ile değiştirin)
  useEffect(() => {
    if (!token || !chatId || !threadId) return;
    const id = setInterval(async () => {
      const d = await post("list_threads", { chat_id: chatId });
      const thread = d.threads?.find((t: any) => t.id === threadId);
      for (const ev of thread?.events ?? []) {
        if (ev.type === "message" && !seen.current.has(ev.id)) {
          seen.current.add(ev.id);
          const author = ev.author_id === customerId ? "You" : "Agent";
          setMessages((m) => [...m, { author, text: ev.text }]);
        }
      }
    }, 3000);
    return () => clearInterval(id);
  }, [token, chatId, threadId, customerId, post]);

  if (!open) return <button className="lc-launcher" onClick={() => setOpen(true)}>Chat</button>;

  return (
    <div className="lc-widget">
      <header className="lc-header">Product Expert</header>
      <div className="lc-messages">
        {messages.map((m, i) => (
          <div key={i} className={m.author === "You" ? "lc-msg lc-msg--me" : "lc-msg lc-msg--agent"}>
            {m.text}
          </div>
        ))}
      </div>
      <div className="lc-composer">
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Type a message..." />
        <button onClick={send}>Send</button>
      </div>
      <footer className="lc-footer">Powered by text.com</footer>
    </div>
  );
}
```

### 7.6. Dockerfile (RTM/messaging servisi — Node)

```dockerfile
# infra/rtm.Dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY pnpm-lock.yaml package.json ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @clone/rtm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/services/rtm/dist ./dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3010
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:3010/health || exit 1
CMD ["node", "dist/server.js"]
```

### 7.7. docker-compose.yml (yerel geliştirme)

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: clone
      POSTGRES_PASSWORD: clone
      POSTGRES_DB: clone_text
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U clone"]
      interval: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    command: ["redis-server", "--appendonly", "yes"]

  gateway:
    build: { context: ., dockerfile: infra/gateway.Dockerfile }
    environment:
      DATABASE_URL: postgres://clone:clone@postgres:5432/clone_text
      REDIS_URL: redis://redis:6379
    ports: ["8080:8080"]
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_started }

  messaging:
    build: { context: ., dockerfile: infra/messaging.Dockerfile }
    environment:
      DATABASE_URL: postgres://clone:clone@postgres:5432/clone_text
      REDIS_URL: redis://redis:6379
    depends_on:
      postgres: { condition: service_healthy }

  rtm:
    build: { context: ., dockerfile: infra/rtm.Dockerfile }
    environment:
      REDIS_URL: redis://redis:6379
      JWT_PUBLIC_KEY: ${JWT_PUBLIC_KEY}
    ports: ["3010:3010"]
    depends_on:
      redis: { condition: service_started }

volumes:
  pgdata:
```

### 7.8. Kubernetes / Terraform notu (kısa)

**Kubernetes:** Her servis ayrı bir `Deployment` + `Service`; RTM için **sticky session gerekmez** çünkü fan-out Redis Pub/Sub üzerinden yapılır (herhangi bir RTM pod'u herhangi bir olayı alır ve kendine bağlı oturumlara iletir), ancak WebSocket için Ingress'te `proxy-read-timeout` uzun tutulmalı ve HPA, açık bağlantı sayısı + CPU metriğiyle ölçeklenmelidir. PostgreSQL yönetilen bir servistir (RDS/Cloud SQL); Redis yönetilen (ElastiCache/Memorystore) veya Redis Cluster. Gizli anahtarlar (PAT imza anahtarı, OAuth secret'ları, DB parolası) `Secret` + harici bir gizli yönetici (External Secrets Operator) ile.

**Terraform:** Altyapı IaC ile tanımlanır — `vpc`, `eks/gke cluster`, `rds postgres` (multi-AZ, read-replica), `elasticache redis`, `s3/gcs` (dosya + arşiv), `cloudfront/cloud cdn` (widget assets = `cdn.static-text.com` muadili), `route53/dns`, `waf` (rate-limit + trusted-domain kenar denetimi). Ortam başına (dev/staging/prod) ayrı workspace; modüler yapı (`modules/database`, `modules/cache`, `modules/service`).

---

## 8. Eksik Özellikler / İyileştirmeler (öncelik: etki-tabanlı)

Aşağıdaki liste, klonu MVP'den üretim-kalitesine ve rekabetçi konuma taşıyacak iyileştirmeleri **etki × aciliyet** sırasına göre önceliklendirir.

### P0 — Çekirdek (klon çalışmaz/güvensiz olur, önce bunlar)

1. **RTM WebSocket + kaçırılan olay senkronizasyonu.** Polling ile başlanabilir ama üretimde gerçek zamanlı deneyim için WebSocket zorunludur. Yeniden bağlanmada "son görülen event id'den sonrasını çek" (`sync`) mantığı olmadan mesaj kaybı yaşanır. **Etki: çok yüksek.**
2. **Tenant izolasyonu zorlaması (RLS + negatif testler).** Bir kiracının verisinin diğerine sızması ürünü bitiren bir olaydır. PostgreSQL RLS + her endpoint için cross-tenant reddi testi. **Etki: çok yüksek (güvenlik).**
3. **Kimlik/scope katmanı (OAuth 2.1 + PAT + bot token + scope enforcement).** Tüm API yüzeyi bunun üzerine oturur. **Etki: çok yüksek.**
4. **Faturalama ölçümü (metering).** API-call ve AI-resolution sayaçları olmadan gözlemlenen iş modeli (koltuk + ölçülü kullanım) uygulanamaz; gelir doğrudan buna bağlıdır. **Etki: yüksek.**
5. **Chat routing / queue motoru.** Gelen sohbetin doğru gruba/temsilciye atanması, eşzamanlı sohbet limitine (6) saygı, kuyruk ve fallback rota. **Etki: yüksek.**

### P1 — Ürün paritesi (gözlemlenen özellikleri karşılamak için)

6. **AI Agent skill motoru + RAG Knowledge.** Doğal dil talimatı → sıralı adımlara (detect_intent, request_info, tag, summarize, send_message, transfer_to_team) derleyen yürütücü; website/file/article/faq kaynaklarını embedding'leyip retrieval yapan RAG hattı. Ürünün ana farklılaştırıcısı. **Etki: yüksek.**
7. **Copilot (agent-assist).** Sohbet özeti (internal note olarak), yanıt önerileri (Reply Suggestions chip'leri), ayrı knowledge tabanı. **Etki: orta-yüksek.**
8. **Omnichannel kanal adaptörleri.** Website widget hazır; Email (forwarding→ticket), Messenger, Twilio SMS, WhatsApp adaptörleri. Her biri gelen mesajı ortak `event` modeline normalize eder. **Etki: orta-yüksek.**
9. **Ticket sistemi.** Chat'ten ticket oluşturma, ticket rules otomasyonu, email templates, custom fields, forms. **Etki: orta.**
10. **Reports/Analytics.** Overview KPI'ları (Manual/Assisted/Automated bölünmesi), AI Agent performansı, metrics breakdown, AI-kümeleme "Chat topics". Read-replica üzerinden toplulaştırma. **Etki: orta.**
11. **Campaigns / greetings motoru.** Hedefli mesaj/karşılama, koşul tabanlı tetikleyiciler, per-campaign rapor. **Etki: orta.**

### P2 — Farklılaştırma ve olgunluk

12. **MCP server.** Kiracı verisini harici LLM araçlarına (Claude/ChatGPT) açan MCP endpoint'i (`search_tickets`, `list_chats`, `get_report`, `summarize_chat` tool'ları). Rekabette "AI-native" konumlandırma. **Etki: orta (stratejik).**
13. **Apps marketplace + OAuth app directory.** HubSpot, Salesforce, Shopify, Stripe, Slack, Segment, Mailchimp, Google Calendar, BigCommerce, Adobe Commerce, Medusa entegrasyonları. **Etki: orta.**
14. **Rich messages + rich cards + hızlı yanıtlar (quick replies).** Buton/kart/postback event tipleri (ecommerce ürün kartları dahil). **Etki: orta.**
15. **Desktop/mobil temsilci uygulaması + push bildirimleri.** Gözlem: "Desktop app" ayarı mevcut. **Etki: orta.**
16. **2FA zorunluluğu + SSO (SAML/OIDC).** Gözlem: 2FA alanı var ("Inactive"). Kurumsal satış için SSO. **Etki: orta (kurumsal).**

### P3 — İyileştirmeler ve teknik borç azaltma

17. **Analitik için ayrı kolon-tabanlı depo** (ClickHouse/BigQuery) — ağır raporları OLTP'den ayırmak. **Etki: düşük-orta (ölçekte yüksek).**
18. **Mesaj arşivi soğuk depolama** (S3 + Parquet) + `DETACH PARTITION` otomasyonu. **Etki: düşük (maliyet).**
19. **Widget'ı Preact'e taşıyarak bundle küçültme** (<50 KB), Core Web Vitals iyileştirme. **Etki: düşük-orta.**
20. **Denetim izi (audit log) ve gözlemlenebilirlik** (OpenTelemetry uçtan uca izleme). **Etki: düşük-orta.**
21. **Erişilebilirlik (WCAG 2.1 AA)** ve tam klavye navigasyonu, ekran okuyucu desteği. **Etki: düşük-orta (uyumluluk).**
22. **Instagram / Telegram kanalları** (gözlem: "Coming soon"). **Etki: düşük.**

### Önceliklendirme özeti

| Öncelik | Odak | Neden |
| --- | --- | --- |
| P0 | Realtime, izolasyon, auth, metering, routing | Bunlar olmadan ürün ne çalışır ne de güvenli/faturalanabilir |
| P1 | AI skills+RAG, Copilot, omnichannel, tickets, reports, campaigns | Gözlemlenen ürünle işlevsel parite |
| P2 | MCP, marketplace, rich messages, mobil, SSO | Rekabet farklılaşması ve kurumsal satış |
| P3 | Analitik depo, arşiv, bundle, audit, a11y | Ölçek, maliyet ve uzun vadeli bakım |

---

## Ek: Kaynak ve doğrulama notu

Bu belgedeki tüm somut endpoint, action, payload, scope, webhook olay tipi ve fiyatlandırma verileri; ya `https://www.text.com/app` üzerindeki birinci-el gözlemlere ya da text.com resmî geliştirici dokümanlarına (Agent Chat API, Configuration API, Reports API OpenAPI spesifikasyonu, Customer Chat API guide, Custom chat widgets guide, Webhooks v3.6 referansı) dayanır. Kesin URL kalıpları veya iç implementasyon detayları gözlemlenemediğinde, ilgili ifade **(çıkarım)** olarak işaretlenmiştir. Taban API host'u tüm örneklerde `https://api.livechatinc.com/v3.6`, kimlik host'u `https://accounts.livechat.com`, asset host'u `cdn.static-text.com`, MCP host'u `https://mcp.text.com/` olarak gözlemlenmiştir.





