# text.com/app — Anatomik Harita ve Fonksiyonel Gereksinim Raporu (Rapor 1)

> **Ürün:** Text App (eski adıyla **LiveChat**) — `https://www.text.com/app`
> **Belge türü:** Fonksiyonel anatomi + klonlama gereksinim dökümü
> **Hedef kitle:** Ürünü sıfırdan yeniden inşa edecek (klonlayacak) mühendislik ekibi
> **Kaynak:** `_evidence/00-INDEX.md` … `_evidence/10-settings-detail.md` (canlı, kimlik doğrulamalı gözlem paketi, 20 Tem 2026)
> **Dil kuralı:** Anlatım Türkçe; tüm UI etiketleri, URL'ler, tanımlayıcılar İngilizce (gözlemlendiği gibi). Kanıtın ötesine geçen her yorum **(çıkarım)** etiketlidir.

---

## 0. Yönetici Özeti (Executive Summary)

Text App, eski **LiveChat** ürününün "Text" markası altında yeniden konumlandırılmış hâlidir. Tek sayfalık bir uygulamadır (SPA) ve `/app/<module>` biçiminde derin bağlantı (deep-link) veren bir rota mimarisine sahiptir. Ürün, klasik canlı sohbet (live chat) çekirdeğinin üzerine üç yeni katman ekler:

1. **Omnichannel Inbox** — Web widget, Chat page, Email, Messenger, Twilio SMS, WhatsApp (ve yakında Instagram, Telegram) kanallarından gelen tüm konuşmaları tek gelen kutusunda toplayan sohbet + ticket (destek talebi) merkezi.
2. **Agentic AI Agent + Playbook** — Doğal dil ile yazılan, adım adım (detect-intent, request-info, tag, summarize, send-message, transfer) yürütülen otomasyon "skill"leri; RAG tabanlı bilgi tabanı (Knowledge) ile beslenir.
3. **Copilot** — Ajanı (insan temsilciyi) yanında destekleyen, sohbet özeti ve yanıt önerisi üreten yapay zekâ asistanı; kendi bilgi tabanına sahiptir.

Faturalandırma modeli klasik LiveChat "koltuk başı" modelinden **koltuk + tüketim (metered)** modeline geçmiştir: **$99 / kullanıcı / ay** + dahil **200 AI resolution** + aşım için **AI resolution** ve **API call** ücretlendirmesi. 14 günlük deneme (trial) süresi vardır.

Bu raporda incelenen örnek kiracı (tenant), gerçekçi örnek veri olarak **Türkçe çevrimiçi bahis/casino müşteri destek** senaryosudur ("Hit Asistan" botu; para çekme, KYC, çevrim/wager, sorumlu oyun konuları). Etkin dünya verisi: 13 contact, 20 chat, 20 arşiv chat, 2 campaign, 9 Playbook skill, 13 AI knowledge kaynağı.

Bu belge, ürünü 12 ana modüle (MOD-01 … MOD-12) böler; ayrıca uygulama-öncesi kimlik doğrulama akışını (MOD-00) ve çapraz kesit fonksiyonel desenleri (EK-A, EK-B, EK-C) kapsar. Her anlamlı arayüz elemanı, **fonksiyonel/teknik** ve **değerlendirme/planlama** olmak üzere iki blokla belgelenir.

---

## 1. Belgenin Kullanımı — İndeksleme Şeması ve Blok Efsanesi

### 1.1 Sabit ve bağımsız indeksleme

Özellikler daha sonra eklenip çıkarılırken **yeniden numaralandırmaya gerek kalmaması** için sabit ve bağımsız (independent) bir şema kullanılır:

```
[MOD-X]      → Sayfa / üst modül        (ör. [MOD-02] Inbox)
[MOD-X.Y]    → Alt modül                (ör. [MOD-02.3] Konuşma paneli / Composer)
[MOD-X.Y.Z]  → Mikro-işlev / atomik UI  (ör. [MOD-02.3.3] Mesaj yazım alanı)
```

Bir mikro-işlev çıkarıldığında yalnızca ilgili `[MOD-X.Y.Z]` bloğu silinir; kardeş numaralar sabit kalır. Yeni bir işlev, boşta kalan bir sonraki `.Z` numarasına eklenebilir.

### 1.2 Her eleman için iki blok

Her anlamlı `[MOD-X.Y.Z]` elemanı iki blokla anlatılır:

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** buton / sekme / tablo / modal / dropdown / textarea / toggle / kart / liste / grid (elemanın niteliğine göre biri).
- **Mevcut Durumlar:** Default / Hover / Active / Disabled / Focus / Loading / Empty / Error (uygulanabilir olanlar).
- **Tetiklenen Eylem ve Sayfa Mantığı:** tıklanınca arka planda ne olur; hangi rota/istek/API çağrısı tetiklenir (backend davranışı çıkarımdır ama gerçekçi tutulur).
- **Validasyon ve Hata Senaryoları:** form kuralları, engellenen durumlar, hata mesajları.
- **Görsel & Metinsel İçerik:** gözlemlenen gerçek etiketler, placeholder metinleri, ikonlar.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 **Ne işe yarıyor** — sade dille işlev.
- ➕ **Ekleme avantajı** — bu özelliği klona koymanın faydası.
- ➖ **Çıkarma dezavantajı/riski** — çıkarılırsa ne kaybedilir.
- 🛠️ **Karar seçeneği** — `Aynen kalsın` / `Özelleştirilsin [nasıl]` / `Çıkartılsın`.

---

## 2. Hesap / Kiracı Gerçekleri (Observed Facts)

| Alan | Değer (gözlemlenen) |
|---|---|
| App URL | `https://www.text.com/app` (SPA, `/app/<module>` derin bağlantılı) |
| Giriş yapan ajan | **Calendertasker** (`calendertasker@gmail.com`) — rol **Admin** |
| Hesap sahibi (Owner) | **Can** (`hunterwagn.e.r.6.3.76@gmail.com`) — "6 concurrent chats limit" |
| Plan | **Growth plan** — 14 günlük trial, "**8 days**" kaldı, "Starts on Jul 28, 2026" |
| Gerçek kullanım | 13 contact (Turkey/Serbia/Netherlands), 20 chat, 20 archived chat, 2 campaign, 9 Playbook skill, 13 AI knowledge kaynağı |
| Kiracı senaryosu | Türkçe çevrimiçi bahis/casino müşteri desteği ("Hit Asistan" bot; withdrawal/KYC/wager/responsible-gambling) |
| CDN / Assets | `cdn.static-text.com` (ör. `/assets/text-app/greetings/default-greetings/hello.png`) |
| Widget alt bilgisi | "Powered by text.com" |
| Bağlı siteler | `localhost`, `livechat-demo.surge.sh` |
| Chat/Ticket ID biçimi | base32 benzeri token: `TI1H8CFKRV`, `TI1G5Y48ZB`, thread `TI1G04K0P9` |
| AI/skill/kaynak kimliği | UUID (ör. AI agent `0321ca9a-df85-405c-937a-589987b1a4f1`) |

### 2.1 Fiyatlandırma (Manage subscription ekranından, gerçek)

| Kalem | Değer |
|---|---|
| Growth koltuk ücreti | **$99 / user / month** (2 user = **$198/mo**) |
| Billing cycle | Monthly ▾ / Annual ("Save $480 with annual plan") |
| AI resolutions | **200 dahil**; aşım **$49.50 per 50 extra**; sayaç "0 / 200 (0% used)" |
| API calls | **$29.50 per 100,000 extra** |
| Trial | 14 gün; trial boyunca **Billed now $0**; trial bitince ("Jul 28, 2026") tahsilat |
| Trial rozeti | Global üst çubukta "8 days left in your trial. Subscribe now" |

---

## 3. Modül Haritası (Master MOD Map)

| MOD | Sayfa / Modül | Ana Rota | Kısa Açıklama |
|---|---|---|---|
| MOD-00 | Ön-Uygulama / Kimlik Doğrulama | `text.com` login/signup | Login, signup, forgot-password (kavramsal) |
| MOD-01 | Global Shell / Navigation | `/app` | Üst çubuk, sol ikon rayı, sağ panel, banner'lar |
| MOD-02 | Inbox / Chats | `/app/inbox` | 3-pane sohbet + ticket + views + Copilot özet + arşiv |
| MOD-03 | Customers | `/app/customers` | Real-time ziyaretçi takibi, Contacts CRM, Campaigns |
| MOD-04 | Team | `/app/team` | AI Agents, Teammates, Teams, Invite modal, roller/2FA |
| MOD-05 | Playbook | `/app/playbook` | Otomasyon/skill merkezi; şablonlar, sekmeler, runs, toggle |
| MOD-06 | AI Agent | `/app/team/ai-agents/{uuid}` | Skill editörü + adımlar + Preview, Knowledge/RAG, Profile, Performance |
| MOD-07 | Reports | `/app/reports` | Overview, AI Agent, Metrics breakdown, Chat topics, gruplar, Share |
| MOD-08 | Settings | `/app/settings` | Notifications, Company, Channels, Routing, Inbox, Integrations, Security, Billing |
| MOD-09 | Apps Marketplace | `/app/settings/integrations/apps` | 15+ entegrasyon (Shopify, HubSpot, Salesforce, Stripe…) |
| MOD-10 | Billing / Subscription | `/app/settings/billing/subscription/manage` | Plan stepper'ları, tüketim sayaçları, trial |
| MOD-11 | Customer Widget | (müşteri tarafı iframe) | Launcher, greeting card, quick replies, composer, powered-by |
| MOD-12 | Copilot | `/app/team/ai-agents/copilot/knowledge` | Ajan-yardımcı AI; her sohbette buton; kendi bilgi tabanı |
| EK-A | Form & Girdi Mantığı | çapraz kesit | Tüm form/arama/filtre desenleri |
| EK-B | Sayfalama & Yükleme | çapraz kesit | Virtualized grid, infinite scroll, skeleton, empty state |
| EK-C | Dinamik Yapılar | çapraz kesit | Realtime, banner, dropdown, sağ panel |

---
## [MOD-00] Ön-Uygulama / Kimlik Doğrulama (Auth)

Bu modül uygulama kabuğunun (SPA) dışında, `text.com` genel sitesinde yer alan kimlik doğrulama akışını kapsar. Gözlem paketi kimlik doğrulamalı bir oturumdan alındığı için ekranlar birinci elden görülmedi; bu bölüm **kavramsal** ve büyük ölçüde **(çıkarım)** düzeyindedir, ancak klonlanacak ürünün minimum kimlik yüzeyini tanımlar.

### [MOD-00.1] Login (Oturum açma)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Form (email + password), submit butonu, "SSO / Google" alternatif giriş butonu (çıkarım).
- **Mevcut Durumlar:** Default (boş form) / Focus (alan odağı) / Loading (submit sonrası spinner) / Error (kimlik hatalı) / Disabled (alanlar boşken submit pasif).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Başarılı kimlik doğrulama sonrası oturum jetonu/çerez set edilir ve kullanıcı `/app` köküne, oradan varsayılan modül olan `/app/inbox` rotasına yönlendirilir (çıkarım). Çok kiracılı (multi-tenant) yapıda kimlik = **license/account** anahtarına bağlanır.
- **Validasyon ve Hata Senaryoları:** Geçersiz email formatı istemci tarafında engellenir; yanlış parola "invalid credentials" hatası döndürür; 2FA aktifse ikinci adım doğrulama kodu istenir (bkz. Teammates 2FA sütunu).
- **Görsel & Metinsel İçerik:** "Log in", email/password alanları, "Forgot password?" bağlantısı (çıkarım).

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Kullanıcıyı hesabına ve doğru kiracıya güvenli biçimde sokar.
- ➕ Standart, güvenli, herkesin bildiği akış; SSO ile kurumsal müşteri kazanımını kolaylaştırır.
- ➖ Çıkarılamaz; kimlik olmadan çok kiracılı SaaS çalışmaz.
- 🛠️ `Aynen kalsın` (email+password+opsiyonel Google SSO+2FA).

### [MOD-00.2] Signup (Kayıt) ve 14-Günlük Trial Başlatma

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Çok adımlı kayıt formu (email, parola, şirket/kullanım amacı) + trial oluşturma.
- **Mevcut Durumlar:** Default / Loading (hesap oluşturuluyor) / Error (email zaten kayıtlı) / Success (onboarding'e yönlendirme).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Yeni bir **license/account** oluşturulur, kullanıcı **Owner** rolüyle atanır, **Growth plan** 14 günlük trial başlatılır ("Starts on Jul 28, 2026" mantığı: trial bitiş tarihi hesaplanır), global üst çubukta "8 days left in your trial" sayacı bu tarihe göre canlı hesaplanır.
- **Validasyon ve Hata Senaryoları:** Zayıf parola reddi; kurumsal e-posta doğrulama linki; tekrarlı kayıt engeli.
- **Görsel & Metinsel İçerik:** "Sign up", "Start free trial", 14 günlük trial vurgusu.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Ödeme almadan ürünü denetme (product-led growth) kapısı.
- ➕ Kredi kartısız trial dönüşüm oranını artırır; "Billed now $0" güveni verir.
- ➖ Çıkarılırsa self-servis büyüme (PLG) kanalı kapanır.
- 🛠️ `Aynen kalsın` (14 gün, kartsız, Owner otomatik atanır).

### [MOD-00.3] Forgot Password (Parola Sıfırlama)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Tek alanlı form (email) → e-posta ile magic/reset link → yeni parola formu.
- **Mevcut Durumlar:** Default / Loading / Success ("If an account exists, we sent a link") / Error.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Süreli (expiring) token üretilir, e-posta ile gönderilir; link tıklanınca yeni parola belirleme ekranı açılır.
- **Validasyon ve Hata Senaryoları:** Güvenlik gereği, e-posta var olsun olmasın aynı nötr mesaj gösterilir (enumeration koruması); token süresi dolmuşsa yeniden iste.
- **Görsel & Metinsel İçerik:** "Forgot password?", "Reset password", "Send reset link".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Erişimini kaybeden kullanıcıyı kurtarır.
- ➕ Destek yükünü azaltır; güvenli self-servis.
- ➖ Çıkarılırsa parola kaybı = kilitlenme = destek maliyeti.
- 🛠️ `Aynen kalsın`.

---

## [MOD-01] Global Shell / Navigation

![Global shell — Inbox 3-pane](gorseller/fonksiyonel/01-chats-inbox-all.jpg)

Uygulama kabuğu; her modülde sabit kalan üç kalıcı kenar bölgeyle (üst çubuk, sol ikon rayı, sağ detay/Copilot paneli) tanımlanır. İçerik alanı rota değiştikçe yenilenir; kabuk sabit kalır (persistent shell — çıkarım: kabuk tek sefer mount edilir, iç görünümler client-side router ile değişir).

### [MOD-01.1] Üst Çubuk (Top Bar)

#### [MOD-01.1.1] Logo / Hamburger

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** İkon-buton (logo + hamburger menü).
- **Mevcut Durumlar:** Default / Hover / Active (menü açık).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Ana menüyü/uygulama seçiciyi açar; sol navigasyonu daraltma/genişletme ("Unpin side navigation" ile ilişkili) davranışını tetikleyebilir.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** Text logosu, hamburger ikonu.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Marka + global menü erişimi.
- ➕ Ekran gayrimenkulünü yönetmek için nav daraltma sağlar.
- ➖ Çıkarılırsa marka kimliği ve hızlı menü kaybı.
- 🛠️ `Aynen kalsın`.

#### [MOD-01.1.2] "N Leads qualified" Pill

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Bilgi rozeti (pill / badge), gözlemde "**1 Leads qualified**".
- **Mevcut Durumlar:** Default (sayı > 0) / muhtemelen Empty (0 iken gizli — çıkarım).
- **Tetiklenen Eylem ve Sayfa Mantığı:** AI/Playbook tarafından "lead qualified" olarak işaretlenen konuşma sayısını canlı gösterir; tıklanınca ilgili lead görünümüne/rapora götürebilir (çıkarım). Onboarding "qualify a lead" turuyla bağlantılı.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "1 Leads qualified".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Satış/lead değerini üst çubukta canlı vurgular; ürünün "değer" anlatısını görünür kılar.
- ➕ Satış odaklı ekipler için motivasyon + hızlı erişim.
- ➖ Çıkarılırsa lead değeri görünürlüğü azalır; ama çekirdek işlev değil.
- 🛠️ `Özelleştirilsin` — bahis/casino senaryosunda "Leads" yerine "Qualified players" veya domain-özel bir KPI'ya bağlanabilir.

#### [MOD-01.1.3] Global Arama (⌘K)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Arama girişi + komut paleti, kısayol **⌘K**.
- **Mevcut Durumlar:** Default (placeholder) / Focus (palet açık) / Loading (sonuç aranıyor) / Empty (sonuç yok) / Results.
- **Tetiklenen Eylem ve Sayfa Mantığı:** "Search Text or go to…" — hem içerik araması (chat, contact, ticket) hem de rota atlama (go-to navigation) yapar; komut paleti biçiminde çalışır (çıkarım: debounce'lı, çok kaynaklı federated arama).
- **Validasyon ve Hata Senaryoları:** Boş sorgu = son/önerilen öğeler; sonuç yoksa empty state.
- **Görsel & Metinsel İçerik:** Placeholder "Search Text or go to… ⌘K".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Klavye-öncelikli güçlü kullanıcılar için hızlı gezinme + arama.
- ➕ Verimlilik ve keşfedilebilirlik ciddi artar; SaaS'ta beklenen standart.
- ➖ Çıkarılırsa power-user hızı düşer; büyük hesaplarda öğe bulmak zorlaşır.
- 🛠️ `Aynen kalsın`.

#### [MOD-01.1.4] Avatar Grubu (Presence)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Yığılmış avatar grubu (stacked avatars), presence göstergeli.
- **Mevcut Durumlar:** Online (renkli halka) / Offline (gri) / Hover (isim tooltip).
- **Tetiklenen Eylem ve Sayfa Mantığı:** O an çevrimiçi/oturumdaki takım üyelerini canlı gösterir (WebSocket presence). Tıklanınca takım/roster'a götürebilir.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "C" harfli avatar (Calendertasker), diğer üyeler.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Kimin sahada olduğunu anlık gösterir.
- ➕ Ekip koordinasyonu; "kim müsait" bilgisi.
- ➖ Çıkarılırsa presence görünürlüğü azalır.
- 🛠️ `Aynen kalsın`.

#### [MOD-01.1.5] Invite +N

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Buton (+ sayaç), gözlemde "**Invite +1**".
- **Mevcut Durumlar:** Default / Hover / Active (modal açık).
- **Tetiklenen Eylem ve Sayfa Mantığı:** [MOD-04.4] Invite teammates modalını açar. "+1" muhtemelen bekleyen davet/eklenebilir koltuk sayısını veya teşvik rozetini gösterir (çıkarım).
- **Validasyon ve Hata Senaryoları:** Modal içinde (bkz. MOD-04.4).
- **Görsel & Metinsel İçerik:** "Invite", "+1".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Takım büyütmeyi her ekrandan tek tıkla erişilebilir kılar (viral/seat-expansion motivasyonu).
- ➕ Koltuk (dolayısıyla gelir) büyümesini kolaylaştırır.
- ➖ Çıkarılırsa davet akışı yalnızca Team sayfasında kalır; büyüme sürtünmesi artar.
- 🛠️ `Aynen kalsın`.

#### [MOD-01.1.6] Trial Rozeti "8 days"

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Uyarı rozeti + CTA.
- **Mevcut Durumlar:** Default (>0 gün) / Urgent (son günler, muhtemelen renk değişimi — çıkarım) / Expired (trial bitti → ödeme zorunlu).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Kalan trial gününü canlı hesaplar; "Subscribe now" ile [MOD-10] Manage subscription'a götürür.
- **Validasyon ve Hata Senaryoları:** Trial bitince uygulama kısıtlanır/ödeme istenir (çıkarım).
- **Görsel & Metinsel İçerik:** "8 days left in your trial. Subscribe now".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Ödemeye dönüşümü (conversion) sürekli hatırlatır.
- ➕ Gelir dönüşümü için kritik; aciliyet yaratır.
- ➖ Çıkarılırsa trial→paid dönüşümü düşer.
- 🛠️ `Aynen kalsın`.

### [MOD-01.2] Sol İkon Rayı (Left Icon Rail)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Dikey ikon navigasyonu (icon rail). Üstten alta: **Inbox** (aktif) · **Contacts/People** · **Team** · **Engage (target)** · **Reports (bar chart)**; altta: **Settings (gear)** · **Help (?)** · **Account avatar "C"**.
- **Mevcut Durumlar:** Default / Hover (tooltip + vurgu) / Active (seçili modül vurgulu) / Badge (sayaç, ör. okunmamış).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Her ikon ana modül rotasına atlar: Inbox→`/app/inbox`, Contacts→`/app/customers`, Team→`/app/team`, Engage→`/app/playbook` (çıkarım: "Engage/target" ikonu Playbook/Campaigns motoruna karşılık gelir), Reports→`/app/reports`, Settings→`/app/settings`. Help (?) yardım menüsü/merkezini açar; Account avatar profil/çıkış menüsünü açar.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** İkonlar; tooltip ile modül adları.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Ürünün birincil bilgi mimarisi; 5 ana iş alanı + sistem araçlarını tek dikey çubuğa indirger.
- ➕ Sabit, öğrenmesi kolay, ekran alanını verimli kullanır.
- ➖ Çıkarılamaz; ana navigasyon.
- 🛠️ `Aynen kalsın`. `Özelleştirilsin` — klonlanan üründe modül seti farklıysa ikon rayı buna göre kısaltılır.

Alt maddeler (mikro): [MOD-01.2.1] Inbox · [MOD-01.2.2] Contacts · [MOD-01.2.3] Team · [MOD-01.2.4] Engage/Playbook · [MOD-01.2.5] Reports · [MOD-01.2.6] Settings · [MOD-01.2.7] Help · [MOD-01.2.8] Account avatar. Her biri yukarıdaki rota mantığına uyar.

### [MOD-01.3] Sağ Panel Anahtarı (Details / Copilot / Expand)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Panel geçiş butonları — "Details", "Copilot", "Expand details panel".
- **Mevcut Durumlar:** Collapsed / Expanded / Active tab (Details veya Copilot).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Sağ tarafta bağlamsal paneli açar/kapar; **Details** (müşteri/sohbet meta verisi) ile **Copilot** (AI asistan) arasında geçiş yapar. Bu panel tüm uygulamada kalıcıdır (evidence: "Details / Copilot / Expand details panel buttons persist across app").
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "Details", "Copilot", genişletme ikonu.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Ajanın bağlamı (müşteri bilgisi) ve yardımcıyı (AI) sohbetten ayrılmadan yanında tutar.
- ➕ Bağlam değiştirme maliyetini düşürür; verimlilik artar.
- ➖ Çıkarılırsa ajan bağlam için başka ekranlara gitmek zorunda kalır.
- 🛠️ `Aynen kalsın`.

### [MOD-01.4] Promosyon Banner'ları

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** İçerik-üstü bilgi/pazarlama banner'ları (dismiss edilebilir).
- **Mevcut Durumlar:** Visible / Dismissed / CTA-hover.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Onboarding ve özellik keşfi banner'ları: Inbox'ta "See how you can qualify a lead… [Take tour]"; Reports'ta "Top chat topics in one place [See chat topics][Remind me later]". CTA ilgili turu/görünümü açar; "Remind me later" erteler.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** Banner başlığı + CTA butonları.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Yeni kullanıcıyı özelliklere yönlendiren onboarding katmanı.
- ➕ Aktivasyon ve özellik benimseme oranını artırır.
- ➖ Fazlası dikkat dağıtır; deneyimli kullanıcıyı rahatsız edebilir.
- 🛠️ `Özelleştirilsin` — kalıcı olarak kapatılabilir + kullanıcı olgunluğuna göre gösterim (segmentli onboarding).

### [MOD-01.5] "Unpin side navigation" (Nav Daraltma)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Toggle buton.
- **Mevcut Durumlar:** Pinned (sabit) / Unpinned (daraltılmış, hover'da açılan).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Sol navigasyonu sabit veya otomatik-daraltılan moda geçirir; tercih kullanıcı bazında saklanır (çıkarım: localStorage/hesap tercihi).
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "Unpin side navigation".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Yoğun sohbet ekranında yatay alan kazandırır.
- ➕ Küçük ekran/çok pane senaryosunda konfor.
- ➖ Çıkarılırsa alan yönetimi esnekliği azalır.
- 🛠️ `Aynen kalsın`.

---
## [MOD-02] Inbox / Chats

![Inbox 3-pane + örnek sohbet + details](gorseller/fonksiyonel/01-chats-inbox-all.jpg)

Rota: `/app/inbox` ve alt rotaları. Ürünün kalbi olan **3-pane** (üç panelli) sohbet çalışma alanıdır: **liste (sohbet/ticket listesi) | konuşma (transcript + composer) | details (müşteri/sohbet meta)**. Inbox aynı zamanda AI Agent konuşmalarını, ticket'ları ve kanal-bazlı görünümleri (views) barındırır.

### [MOD-02.1] Inbox Kenar Çubuğu (2. sütun) — Gruplar ve Sayaçlar

Kenar çubuğu, dört mantıksal grup ve canlı sayaçlarla sohbetleri filtreler.

#### [MOD-02.1.1] Chats Grubu

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Navigasyon listesi + canlı sayaç rozetleri.
- **Öğeler ve rotalar:** **All** (`/app/inbox/chats/all`) · **My chats (1)** (`/my`) · **Queued (0)** (`/queued`) · **Unassigned (0)** (`/unassigned`) · **Supervised (0)** (`/supervised`) · **Archive** (`/archive`).
- **Mevcut Durumlar:** Default / Active (seçili filtre vurgulu) / Badge (canlı sayı) / Empty (0).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Her öğe, orta listeyi ilgili sohbet kümesine filtreler. Sayaçlar WebSocket RTM ile canlı güncellenir (yeni sohbet gelince "Queued/Unassigned" artar). "My chats" o ajana atanmış aktif sohbetler; "Supervised" ajanın izlediği (supervise) sohbetler; "Archive" kapanmış/çözülmüş sohbet geçmişi.
- **Validasyon ve Hata Senaryoları:** Yok (salt filtre).
- **Görsel & Metinsel İçerik:** "All", "My chats", "Queued", "Unassigned", "Supervised", "Archive" + parantez içi sayılar.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Ajanın iş yükünü (kime ait, sırada, atanmamış) canlı segmentler.
- ➕ Çok ajanlı ekipte iş dağıtımı ve SLA yönetimi için zorunlu.
- ➖ Çıkarılırsa sohbetler ayrışmaz; ölçeklenemez.
- 🛠️ `Aynen kalsın`.

#### [MOD-02.1.2] AI Agents Grubu

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Navigasyon listesi + sayaç.
- **Öğeler ve rotalar:** **AI agent (0)** (`/app/inbox/ai-agents/{uuid}/active`) · **Solved (0)** (`/ai-agents/solved`).
- **Mevcut Durumlar:** Default / Active / Badge.
- **Tetiklenen Eylem ve Sayfa Mantığı:** AI Agent'ın aktif olarak yürüttüğü konuşmaları ve AI tarafından çözülmüş (solved) konuşmaları listeler. Bu, insan sohbetleriyle AI sohbetlerini ayırır; "Solved" = AI resolution sayacına (billing) katkı yapan konuşmalardır (çıkarım).
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "AI agent", "Solved".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 AI'ın devraldığı konuşmaları insan kuyruğundan ayırır; AI performansını gelen kutusunda görünür kılar.
- ➕ AI resolution ölçümü ve denetimi için kritik.
- ➖ Çıkarılırsa AI ve insan trafiği karışır, ölçüm zorlaşır.
- 🛠️ `Aynen kalsın`.

#### [MOD-02.1.3] Tickets Grubu

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Navigasyon listesi + "More" genişletici.
- **Öğeler ve rotalar:** **All** · **Unassigned (1)** · **My open (0)** · **More** → grid `/app/inbox/tickets/grid/{all|unassigned|my-open}?sortBy=lastMessageAt&order=desc`.
- **Mevcut Durumlar:** Default / Active / Badge / **Error-note** ("Ticket views are unavailable. Please contact support if that's unexpected.").
- **Tetiklenen Eylem ve Sayfa Mantığı:** Asenkron destek talepleri (e-posta kaynaklı, offline mesajlar). Grid görünümü `sortBy=lastMessageAt&order=desc` ile son mesaja göre sıralı. "More" ek ticket görünümlerini açar.
- **Validasyon ve Hata Senaryoları:** "Ticket views are unavailable" uyarısı gözlemlendi (kanal/izin durumuna bağlı görünürlük).
- **Görsel & Metinsel İçerik:** "All", "Unassigned (1)", "My open (0)", "More".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Anlık olmayan (asenkron) talepleri sohbetten ayrı yönetir.
- ➕ E-posta/offline destek için omnichannel bütünlüğü.
- ➖ Çıkarılırsa yalnızca canlı sohbet kalır; e-posta desteği kaybolur.
- 🛠️ `Aynen kalsın`.

#### [MOD-02.1.4] Views Grubu (Kanal ve Özel Görünümler)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Kaydedilmiş görünüm (saved view) listesi.
- **Öğeler ve rotalar:** **WhatsApp (0)** · **Messenger (0)** · **Twilio SMS (0)** (`/app/inbox/channel-promo/{whatsapp|messenger|twilio}`) · **My recent chats** (`/chats/views/default-my-recent-chats`).
- **Mevcut Durumlar:** Default / Active / Empty (0) / Promo (kanal bağlı değilse tanıtım görünümü).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Kanal-bazlı filtre görünümleri; kanal bağlı değilse `channel-promo` tanıtım/kurulum ekranına götürür. "My recent chats" varsayılan kişisel görünüm.
- **Validasyon ve Hata Senaryoları:** Kanal bağlı değilken sohbet gelmez → Empty/Promo.
- **Görsel & Metinsel İçerik:** "WhatsApp", "Messenger", "Twilio SMS", "My recent chats".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Kanal bazında hızlı filtre + özel kaydedilmiş görünümler.
- ➕ Omnichannel'da kanal önceliklendirme; kişisel görünümler verimlilik sağlar.
- ➖ Çıkarılırsa kanal ayrımı ve özel görünüm esnekliği kaybolur.
- 🛠️ `Özelleştirilsin` — kullanıcı-tanımlı kaydedilmiş görünümler (custom views) eklenmeli.

### [MOD-02.2] Sohbet Listesi (3. sütun)

#### [MOD-02.2.1] Liste Başlığı ve Sıralama

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Başlık + sıralama kontrolü (dropdown).
- **Mevcut Durumlar:** Default / Sort-open / Active-sort.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Başlık "All chats"; sıralama "My chats 1 / Oldest" — sohbetleri "Oldest / Newest" ve kapsam (My chats) bazında sıralar/filtreler.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "All chats", "My chats 1", "Oldest".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Ajanın hangi sohbete önce bakacağını yönetir (en eski = SLA riski).
- ➕ SLA/öncelik yönetimi.
- ➖ Çıkarılırsa sıralama sabitlenir, esneklik kaybolur.
- 🛠️ `Aynen kalsın`.

#### [MOD-02.2.2] Sohbet Liste Öğesi (Chat Item)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Liste kartı (avatar + isim + önizleme + zaman + durum etiketi).
- **Mevcut Durumlar:** Default / Hover / Active (seçili) / Unread (vurgulu) / Typing (müşteri yazıyor — çıkarım).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Tıklanınca orta panelde konuşmayı açar (`/chats/all/{threadId}/{chatId}`). Gözlem öğesi: "Example Customer — Reopened - by agent — 9m" (isim, durum/olay, göreli zaman). RTM ile yeni mesajda öğe yukarı taşınır ve unread işaretlenir.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** İsim, son mesaj/olay ("Reopened - by agent"), göreli zaman ("9m").

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Konuşmaları tarama ve seçme birimi.
- ➕ Hızlı tarama; durum/zaman ile önceliklendirme.
- ➖ Çıkarılamaz; listenin atomu.
- 🛠️ `Aynen kalsın`.

#### [MOD-02.2.3] "Take tour" Onboarding Banner'ı

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Onboarding banner + CTA.
- **Mevcut Durumlar:** Visible / Dismissed.
- **Tetiklenen Eylem ve Sayfa Mantığı:** "See how you can qualify a lead. Explore freely or take a tour before you go live with real customers." [Take tour] → rehberli tur başlatır (demo lead qualification senaryosu).
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** Yukarıdaki metin + [Take tour].

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Canlıya geçmeden önce güvenli deneme/öğrenme.
- ➕ Aktivasyon artışı.
- ➖ Fazla ısrarcıysa dikkat dağıtır.
- 🛠️ `Özelleştirilsin` — tek sefer gösterim + kalıcı kapatma.

### [MOD-02.3] Konuşma Paneli (Merkez) — Transcript + Composer

#### [MOD-02.3.1] Transcript (Konuşma Dökümü)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Kaydırılabilir mesaj akışı (baloncuklar), sistem olayları dahil.
- **Mevcut Durumlar:** Default / Loading (geçmiş yükleniyor, skeleton) / Empty (yeni sohbet) / Live (yeni mesaj canlı ekleniyor).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Müşteri + ajan + AI + sistem mesajlarını kronolojik gösterir; WebSocket ile canlı akış. Gözlemde bir "lead qualification bike-fleet demo" konuşması. Yeni gelen mesajlar alta eklenir, otomatik kaydırma (çıkarım).
- **Validasyon ve Hata Senaryoları:** Bağlantı koparsa "reconnecting" durumu (çıkarım).
- **Görsel & Metinsel İçerik:** Mesaj baloncukları, sistem olayları ("Reopened - by agent").

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Konuşmanın tam kaydı; ajanın bağlamı.
- ➕ Çıkarılamaz.
- ➖ —
- 🛠️ `Aynen kalsın`.

#### [MOD-02.3.2] Reply Suggestions Çipleri

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** AI-üretimli hızlı yanıt çipleri (tıklanabilir).
- **Mevcut Durumlar:** Default / Hover / Loading (öneri üretiliyor) / Empty (öneri yok).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Space tuşu veya otomatik olarak AI, bağlama uygun yanıt taslakları üretir; çipe tıklayınca metin composer'a yerleşir (gönderilmeden düzenlenebilir). Gözlem çipleri: "I'm still on it. Please bear…", "Give me a moment, I'll ch…".
- **Validasyon ve Hata Senaryoları:** AI hatası → öneri gelmez, ajan elle yazar.
- **Görsel & Metinsel İçerik:** Kısaltılmış öneri metinleri (çip).

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Ajanın yanıt hızını artıran AI-destekli hızlı cevaplar.
- ➕ Ortalama yanıt süresini düşürür; tutarlılık sağlar.
- ➖ Çıkarılırsa hız/tutarlılık avantajı kaybolur (ama çekirdek değil).
- 🛠️ `Aynen kalsın`. `Özelleştirilsin` — dil/tonu Copilot bilgi tabanına göre ayarlanabilir.

#### [MOD-02.3.3] Composer (Mesaj Yazım Alanı)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Çok satırlı metin girişi + araç çubuğu + Send.
- **Mevcut Durumlar:** Default (placeholder) / Focus / Typing / Disabled (sohbet kapalıysa) / Sending (Loading) / Error (gönderilemedi).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Placeholder "Enter message or press 'Space' for Reply Suggestions". Enter ile gönderir (Shift+Enter yeni satır — çıkarım); Space (boş alanda) Reply Suggestions'ı tetikler. Mesaj Agent Chat API üzerinden gönderilir, transcript'e ve müşteri widget'ına canlı işlenir.
- **Validasyon ve Hata Senaryoları:** Boş mesaj gönderilemez; ek boyut/tür limitleri (bkz. Settings > File sharing); gönderim hatası retry.
- **Görsel & Metinsel İçerik:** Placeholder metni + araç ikonları + "Send".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Ajanın müşteriye yanıt verdiği ana giriş.
- ➕ Çıkarılamaz; zengin araç seti verimlilik sağlar.
- ➖ —
- 🛠️ `Aynen kalsın`.

#### [MOD-02.3.4] Message Type Dropdown

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Dropdown (mesaj türü seçici).
- **Mevcut Durumlar:** Default / Open / Selected.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Mesajın türünü seçer: müşteriye görünen **reply** ile takıma özel **internal note** (dahili not) arasında geçiş (çıkarım — Copilot özeti "internal note" olarak eklendiğinden bu tür doğrulanır). Internal note müşteriye gitmez, transcript'te farklı stilde görünür.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** Mesaj türü etiketleri (Reply / Note).

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Ajanların müşteriye görünmeden kendi aralarında not bırakmasını sağlar.
- ➕ Ekip içi işbirliği + Copilot özet aktarımı için gerekli.
- ➖ Çıkarılırsa dahili işbirliği kaybolur.
- 🛠️ `Aynen kalsın`.

#### [MOD-02.3.5] Composer Araç İkonları (Canned / #tags / Rich / Emoji / Attach)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** İkon-buton grubu.
- **Öğeler:** **Canned response** ekleyici (`#` shortcut ile hazır yanıt), **#tags** (sohbet etiketleme), **rich text** (biçimlendirme), **emoji** seçici, **attach** (dosya ekleme).
- **Mevcut Durumlar:** Default / Hover / Active (panel açık) / Disabled (izin/kanal kısıtı).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Canned: `#` yazınca hazır yanıt listesi açılır (Settings > Canned responses'tan beslenir, 23 chat yanıtı). Emoji picker; attach dosya seçtirir (File sharing kurallarına tabi); rich metin biçimlendirir.
- **Validasyon ve Hata Senaryoları:** Attach: izinli tür/boyut kontrolü (Settings > File sharing). Canned: eşleşme yoksa liste boş.
- **Görsel & Metinsel İçerik:** İkonlar (canned, #, rich, emoji, attach).

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Hızlı, tutarlı ve zengin yanıtlar.
- ➕ Canned responses tekrarlayan soruları hızlandırır; ek/emoji/rich UX'i zenginleştirir.
- ➖ Çıkarılırsa yanıt hızı ve zenginlik düşer.
- 🛠️ `Aynen kalsın`.

#### [MOD-02.3.6] Send Butonu

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Birincil buton.
- **Mevcut Durumlar:** Default / Disabled (boş mesaj) / Loading (gönderiliyor) / Error.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Mesajı gönderir; optimistic UI ile hemen transcript'e ekler, arka planda API onaylar.
- **Validasyon ve Hata Senaryoları:** Boşken pasif; hata durumunda yeniden gönder.
- **Görsel & Metinsel İçerik:** "Send".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Mesaj gönderiminin tetikleyicisi.
- ➕ Çıkarılamaz.
- ➖ —
- 🛠️ `Aynen kalsın`.

### [MOD-02.4] Details Paneli (Sağ — Müşteri/Sohbet Meta Verisi)

Sağ panel; müşteri kimliği + canlı bağlam bölümlerinden oluşur. Gözlemlenen müşteri: "Example Customer — Chatting — customer@mail.com — New York, United States".

#### [MOD-02.4.1] Chat info · [MOD-02.4.2] Chat tags · [MOD-02.4.3] Visited pages · [MOD-02.4.4] Visit info · [MOD-02.4.5] Assignee · [MOD-02.4.6] Chat ID / Duration

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Katlanabilir bilgi bölümleri (accordion sections).
- **Mevcut Durumlar:** Collapsed / Expanded / Editable (tags/assignee) / Live-updating (duration, visit).
- **Tetiklenen Eylem ve Sayfa Mantığı:**
  - **Chat info:** Genel sohbet meta verisi.
  - **Chat tags:** Sohbete etiket ekle/çıkar (Playbook ve manuel; Settings > Tags'ten gelir).
  - **Visited pages (1):** Müşterinin gezdiği sayfalar (tracking).
  - **Visit info:** Device, Referring page (`www.text.com`), Visit duration (`7m49s`), IP (`127.122.53.34`) — canlı ziyaret telemetrisi.
  - **Assignee = You:** Sohbeti atanan ajan; buradan yeniden atama.
  - **Chat ID `TI1H8CFKRV` / Duration `7m45s`:** Kimlik + canlı süre sayacı.
- **Validasyon ve Hata Senaryoları:** Tag/assignee değişiklikleri anında kaydedilir; hatada geri alma (çıkarım).
- **Görsel & Metinsel İçerik:** "Chat info", "Chat tags", "Visited pages", "Visit info", "Device", "Referring page", "Visit duration", "IP", "Assignee", "Chat ID", "Duration".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Ajana müşteri bağlamını (kim, nereden, ne kadar süredir, hangi sayfalar) tek bakışta verir.
- ➕ Kişiselleştirilmiş ve hızlı destek; etiketleme ile raporlama/otomasyon beslenir.
- ➖ Çıkarılırsa ajan "kör" yanıt verir; bağlam kaybolur.
- 🛠️ `Aynen kalsın`. `Özelleştirilsin` — bahis/casino senaryosunda örnek custom field'lar eklenebilir: player ID, KYC durumu, bakiye (Settings > Custom fields ile).

### [MOD-02.5] Copilot Özeti — Internal Note Olarak

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Aksiyon + AI çıktısı (dahili not).
- **Mevcut Durumlar:** Idle / Generating (Loading) / Inserted (nota eklendi) / Error.
- **Tetiklenen Eylem ve Sayfa Mantığı:** "Summarize this chat as internal note" komutu Copilot'u tetikler; AI, konuşmayı özetler ve **internal note** olarak transcript'e ekler. Arşiv geçmişinde bu özet görülür (bkz. MOD-02.8 / görsel 19).
- **Validasyon ve Hata Senaryoları:** AI hatası → özet üretilemez.
- **Görsel & Metinsel İçerik:** "Summarize this chat as internal note".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Uzun sohbetleri saniyeler içinde özetleyip devir/analiz kolaylaştırır.
- ➕ Vardiya devri, denetim ve raporlama için büyük zaman tasarrufu.
- ➖ Çıkarılırsa özetleme manuel yapılır.
- 🛠️ `Aynen kalsın`.

### [MOD-02.6] Sohbet Aksiyonları (Create ticket / Copy chat link / Reopen)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Aksiyon menüsü öğeleri (… menu).
- **Mevcut Durumlar:** Default / Hover / Disabled (bağlama göre).
- **Tetiklenen Eylem ve Sayfa Mantığı:**
  - **Create ticket from chat:** Sohbetten asenkron takip için ticket üretir (Tickets grubuna düşer).
  - **Copy chat link:** Sohbetin kalıcı bağlantısını panoya kopyalar (paylaşım/derin bağlantı).
  - **Reopen:** Arşivlenmiş sohbeti yeniden açar ("Reopened - by agent" olayı transcript'e yazılır).
- **Validasyon ve Hata Senaryoları:** Reopen yalnızca arşiv/kapalı sohbetlerde; ticket üretimi kanal iznine tabi.
- **Görsel & Metinsel İçerik:** "Create ticket", "Copy chat link", "Reopen".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Sohbeti kalıcı iş öğesine (ticket) dönüştürme, paylaşma ve yeniden açma.
- ➕ Canlı→asenkron köprü; işbirliği ve süreklilik.
- ➖ Çıkarılırsa sohbetler kapandıktan sonra takip edilemez.
- 🛠️ `Aynen kalsın`.

### [MOD-02.7] Tickets Grid (Destek Talebi Tablosu)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Sıralanabilir grid/tablo.
- **Rota:** `/app/inbox/tickets/grid/{all|unassigned|my-open}?sortBy=lastMessageAt&order=desc`.
- **Mevcut Durumlar:** Default / Loading (skeleton) / Empty / Error ("Ticket views are unavailable…").
- **Tetiklenen Eylem ve Sayfa Mantığı:** Ticket'ları son mesaja göre sıralı listeler; satıra tıklayınca ticket konuşmasını açar. URL parametreleriyle sıralama/filtre deep-link'lenir.
- **Validasyon ve Hata Senaryoları:** Görünürlük hatası gözlemlendi.
- **Görsel & Metinsel İçerik:** Kolonlar (konu, müşteri, son mesaj zamanı, atanan — çıkarım).

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Asenkron destek taleplerini toplu yönetim.
- ➕ E-posta/offline destek için gerekli.
- ➖ Çıkarılırsa yalnızca canlı sohbet kalır.
- 🛠️ `Aynen kalsın`.

### [MOD-02.8] Archive (Sohbet Geçmişi)

![Archive transcript + Copilot özeti](gorseller/fonksiyonel/19-archive-chat-history.jpg)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Salt-okuma sohbet geçmişi + transcript görüntüleyici.
- **Rota:** `/app/inbox/chats/archive`.
- **Mevcut Durumlar:** Default / Loading / Empty / Read-only.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Kapanmış 20 arşiv sohbeti; transcript + eklenen **Copilot özeti** (internal note) görülür. Buradan **Reopen** ile sohbet yeniden açılabilir, **Create ticket** ile talebe dönüştürülebilir.
- **Validasyon ve Hata Senaryoları:** Salt-okuma; yalnızca reopen/ticket aksiyonları.
- **Görsel & Metinsel İçerik:** Arşiv transcript + Copilot summary bloğu.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Kalıcı denetim kaydı + geçmiş bağlam + yeniden açma.
- ➕ Uyuşmazlık çözümü, KYC/denetim (bahis senaryosunda kritik), raporlama.
- ➖ Çıkarılırsa geçmiş ve denetim kaybolur (regülasyon riski).
- 🛠️ `Aynen kalsın`.

---
## [MOD-03] Customers

Rota: `/app/customers`. Üç alt modül: **Real-time** (canlı ziyaretçi takibi), **Contacts** (CRM), **Campaigns** (hedefli mesaj/karşılama motoru). Sağ tarafta Details/Copilot paneli burada da kalıcıdır.

### [MOD-03.1] Real-time — Canlı Ziyaretçi Takibi (Traffic)

![Customers — Real-time (visitor tracking) empty state](gorseller/fonksiyonel/02-customers-realtime.jpg)

Rota: `/app/customers/real-time/{tab}`. Web sitesindeki ziyaretçileri gerçek zamanlı izler ve proaktif temas (start chat / supervise / assign) sağlar.

#### [MOD-03.1.1] Real-time Sekmeleri

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Sekme (tab) navigasyonu.
- **Öğeler:** **All** · **Chatting** · **Supervised** · **Queued** · **Waiting for reply** · **Invited** · **Browsing** (gözlemde hepsi 0).
- **Mevcut Durumlar:** Default / Active / Empty (0 ziyaretçi) / Live (RTM ile artış).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Her sekme ziyaretçileri duruma göre filtreler. WebSocket "traffic" akışı ile canlı güncellenir: yeni ziyaretçi "Browsing", sohbete girince "Chatting", davet edilince "Invited" olur.
- **Validasyon ve Hata Senaryoları:** Yok (salt filtre).
- **Görsel & Metinsel İçerik:** "All", "Chatting", "Supervised", "Queued", "Waiting for reply", "Invited", "Browsing".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Sitedeki canlı trafiği görüp doğru anda müdahale imkânı.
- ➕ Proaktif satış/destek; dönüşüm artışı.
- ➖ Çıkarılırsa yalnızca reaktif (müşteri yazınca) destek kalır.
- 🛠️ `Aynen kalsın`.

#### [MOD-03.1.2] Empty State + "Add more channels"

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Empty state kartı + CTA.
- **Mevcut Durumlar:** Empty (aktif ziyaretçi yok).
- **Tetiklenen Eylem ve Sayfa Mantığı:** "Reach customers wherever they are — Connecting more channels helps you reach people beyond your website." [Add more channels] → Settings > Channels'a götürür.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** Yukarıdaki metin + [Add more channels].

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Boş ekranı kanal ekleme fırsatına çevirir (aktivasyon).
- ➕ Kanal genişletmeyi teşvik eder.
- ➖ Çıkarılırsa boş ekran ölü kalır.
- 🛠️ `Aynen kalsın`.

#### [MOD-03.1.3] Ziyaretçi Tablosu + Satır Aksiyonları

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Canlı tablo (promo mock'ta gösterilen).
- **Kolonlar:** Name | Email | Activity (Browsing/Chatting) | Actions.
- **Satır aksiyonları:** **[Start chat]** · **[Supervise chat]** · **[Assign chat to me]** + edit (pencil) ikonu.
- **Mevcut Durumlar:** Default / Hover / Live.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Start chat → ajan ziyaretçiye proaktif sohbet başlatır; Supervise → mevcut sohbeti izler; Assign to me → sohbeti kendine atar; pencil → ziyaretçi/contact düzenler.
- **Validasyon ve Hata Senaryoları:** Ziyaretçi aktif değilse aksiyon pasif (çıkarım).
- **Görsel & Metinsel İçerik:** "Start chat", "Supervise chat", "Assign chat to me".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Canlı ziyaretçiye anında müdahale (proaktif satış/destek).
- ➕ Yüksek niyetli ziyaretçiyi yakalar; dönüşüm sağlar.
- ➖ Çıkarılırsa proaktif temas kaybolur.
- 🛠️ `Aynen kalsın`.

### [MOD-03.2] Contacts — CRM

![Contacts CRM tablosu (13 kayıt)](gorseller/fonksiyonel/03-customers-contacts.jpg)

Rota: `/app/customers/contacts/{all|leads|last-30d}?sortBy=last_activity&sortOrder=desc`. 13 gerçek kişiyi (Turkey/Serbia/Netherlands) tutan hafif CRM.

#### [MOD-03.2.1] Header + Arama + Filter

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Başlık + arama girişi + [Filter] butonu + sayaç.
- **Mevcut Durumlar:** Default / Focus (arama) / Filter-open / Loading / Empty (sonuç yok).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Başlık "Contacts"; arama placeholder "Enter name, email, or phone" — isim/email/telefon üzerinde arama (debounce, server-side — çıkarım). [Filter] gelişmiş filtre panelini açar. Sayaç "13 customers".
- **Validasyon ve Hata Senaryoları:** Sonuç yoksa empty state.
- **Görsel & Metinsel İçerik:** "Contacts", "Enter name, email, or phone", "Filter", "13 customers".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Müşteri kaydını hızla bulma/filtreleme.
- ➕ Büyük listelerde zorunlu.
- ➖ Çıkarılırsa CRM kullanılamaz hâle gelir.
- 🛠️ `Aynen kalsın`.

#### [MOD-03.2.2] Alt Sekmeler (All / Leads / Last 30 days)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Sekme + sayaç.
- **Öğeler:** **All (13)** · **Leads (2)** · **Last 30 days (13)**.
- **Mevcut Durumlar:** Default / Active.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Kişileri segmentler: tümü, lead işaretliler, son 30 günde aktif olanlar. URL'de tab + `sortBy=last_activity&sortOrder=desc`.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "All", "Leads", "Last 30 days".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Satış/etkinlik odaklı hızlı segmentler.
- ➕ Lead takibi ve yeniden etkileşim için pratik.
- ➖ Çıkarılırsa segmentasyon zayıflar.
- 🛠️ `Aynen kalsın`.

#### [MOD-03.2.3] Tablo Kolonları + Satır (Contact Detay)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Sıralanabilir tablo.
- **Kolonlar:** Name | Email | Phone | Country (bayrak) | Last active (sortable ↓) | Chats | Tickets.
- **Gözlem satırları (gerçek):** "can getiren" `asdqwd@gas.com` Turkey **6 chats**; "Customer" `test@mail.com` Serbia; "195.88.86.56" (IP as name) Turkey; ülkeler Turkey/Serbia/Netherlands.
- **Mevcut Durumlar:** Default / Hover / Row-selected / Sort-active.
- **Tetiklenen Eylem ve Sayfa Mantığı:** "Last active" tıklanınca sıralar; satıra tıklayınca contact profilini (geçmiş sohbet/ticket, meta) açar (çıkarım: sağ panelde veya ayrı sayfada). Chats/Tickets sütunları o kişinin toplam etkileşimini gösterir.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** Kolon başlıkları; bayrak ikonları.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Her müşterinin kimlik + coğrafya + etkileşim geçmişi tek tabloda.
- ➕ Kişiselleştirme, tekrar eden müşteriyi tanıma, raporlama.
- ➖ Çıkarılırsa müşteri hafızası kaybolur.
- 🛠️ `Özelleştirilsin` — bahis senaryosunda "player status / KYC / lifetime deposit" custom kolonları eklenebilir.

### [MOD-03.3] Campaigns — Hedefli Mesaj / Karşılama Motoru

![Campaigns (2 greeting kampanyası)](gorseller/fonksiyonel/04-customers-campaigns.jpg)

Rota: `/app/customers/campaigns/{all|ongoing|scheduled|inactive}`. Ziyaretçilere kural bazlı otomatik karşılama/hedefli mesaj (targeted messages / greetings) gönderen motor.

#### [MOD-03.3.1] Kampanya Alt Sekmeleri

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Sekme + sayaç.
- **Öğeler:** **All (2)** · **Ongoing (2)** · **Scheduled (0)** · **Inactive (0)**.
- **Mevcut Durumlar:** Default / Active / Empty.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Kampanyaları duruma göre filtreler (çalışan / zamanlanmış / pasif).
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "All", "Ongoing", "Scheduled", "Inactive".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Kampanya yaşam döngüsü yönetimi.
- ➕ Zamanlanmış promosyon/karşılama kontrolü.
- ➖ Çıkarılırsa kampanya durumu takip edilemez.
- 🛠️ `Aynen kalsın`.

#### [MOD-03.3.2] New Campaign (Karşılama/Hedefli Mesaj Builder)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Sihirbaz/builder (form + tetikleyici koşulları + mesaj içeriği).
- **Mevcut Durumlar:** Default / Editing / Validation-error / Saving / Published.
- **Tetiklenen Eylem ve Sayfa Mantığı:** [New campaign] ile karşılama (greeting) veya hedefli mesaj oluşturulur: **koşullar** (URL/sayfa, ziyaret sayısı, coğrafya, süre — çıkarım) + **mesaj içeriği/karşılama kartı** + zamanlama. Kayıt sonrası motor eşleşen ziyaretçilere otomatik gönderir; sonuçlar "View report" ile ölçülür.
- **Validasyon ve Hata Senaryoları:** Zorunlu alanlar (tetikleyici + mesaj) boşsa yayınlama engellenir (çıkarım).
- **Görsel & Metinsel İçerik:** "New campaign" + builder alanları (çıkarım).

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Doğru ziyaretçiye doğru anda otomatik mesaj (proaktif dönüşüm).
- ➕ Satış/dönüşüm ve karşılama otomasyonu.
- ➖ Çıkarılırsa proaktif etkileşim yalnızca manuel kalır.
- 🛠️ `Aynen kalsın`. `Özelleştirilsin` — bahis senaryosunda "bonus teklifi / sorumlu oyun uyarısı" şablonları hazır gelebilir.

#### [MOD-03.3.3] Kampanya Kartı (Edit / View report)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Kart (grid/list görünümü) + per-card aksiyonlar.
- **Mevcut Durumlar:** Default / Hover / Active/Inactive toggle.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Her kartta **Edit** (builder'ı açar) + **View report** (kampanya performansı: gösterim/etkileşim/dönüşüm — çıkarım). Grid/list geçişi mevcut.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "Edit", "View report".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Kampanyayı düzenleme + etkisini ölçme.
- ➕ Veri-odaklı optimizasyon.
- ➖ Çıkarılırsa kampanya körlemesine çalışır.
- 🛠️ `Aynen kalsın`.

---
## [MOD-04] Team

![Teammates roster + Profile paneli](gorseller/fonksiyonel/05-team-teammates.jpg)

Rota: `/app/team`. İnsan ve yapay zekâ "takım üyelerini" yönetir: **AI Agents**, **Teammates**, **Teams**. Kenar çubuğu üstünde "**+** (Open create actions)" ile hızlı oluşturma.

### [MOD-04.1] Team Kenar Çubuğu

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Navigasyon listesi.
- **Öğeler:** AI Agents → "AI agent" (`/app/team/ai-agents/{uuid}/performance`) + "Copilot" (`/app/team/ai-agents/copilot/knowledge`); "Teammates" (`/team/teammates`); "Teams" (`/team/teams`); üstte "+".
- **Mevcut Durumlar:** Default / Active.
- **Tetiklenen Eylem ve Sayfa Mantığı:** İlgili yönetim sayfasına gider. AI agent ve Copilot ayrı iki AI varlığıdır (biri müşteriyle konuşan agent, diğeri ajanı destekleyen Copilot).
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "AI agent", "Copilot", "Teammates", "Teams".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Tüm "çalışan" varlıklarını (insan + AI) tek çatı altında yönetir.
- ➕ AI'ı takımın parçası olarak konumlandırır (ürünün stratejik anlatısı).
- ➖ Çıkarılamaz.
- 🛠️ `Aynen kalsın`.

### [MOD-04.2] AI Agents (Team Tarafı — Performance / Copilot Knowledge)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** AI agent yönetim girişleri.
- **Mevcut Durumlar:** Default / Active.
- **Tetiklenen Eylem ve Sayfa Mantığı:** "AI agent" performance görünümüne (per-agent uuid) götürür; "Copilot" ise agent-assist bilgi tabanına (`/copilot/knowledge`). Detay [MOD-06] ve [MOD-12]'de.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "AI agent", "Copilot".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 AI varlıklarının yönetim girişi.
- ➕ Merkezî AI yönetimi.
- ➖ Çıkarılırsa AI yapılandırması dağınıklaşır.
- 🛠️ `Aynen kalsın`.

### [MOD-04.3] Teammates (İnsan Ekip Yönetimi)

Rota: `/app/team/teammates`. Header: "Teammates" + [Copy invite link] + [Invite teammates]. Arama "Search teammates" + [Filter]. Grup "All (2)".

#### [MOD-04.3.1] Header Aksiyonları (Copy invite link / Invite teammates)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** İkincil buton (Copy invite link) + birincil buton (Invite teammates).
- **Mevcut Durumlar:** Default / Hover / Copied (link kopyalandı geri bildirimi) / Active (modal açık).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Copy invite link → paylaşılabilir davet linkini panoya kopyalar; Invite teammates → [MOD-04.4] modalını açar.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "Copy invite link", "Invite teammates".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Ekip büyütmenin iki yolu (link + e-posta daveti).
- ➕ Koltuk büyümesi; hızlı onboarding.
- ➖ Çıkarılırsa ekip ekleme zorlaşır.
- 🛠️ `Aynen kalsın`.

#### [MOD-04.3.2] Arama + Filter

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Arama girişi + [Filter].
- **Mevcut Durumlar:** Default / Focus / Filter-open / Empty.
- **Tetiklenen Eylem ve Sayfa Mantığı:** "Search teammates" ile isim/e-posta arama; Filter ile role/status/2FA filtreleme (çıkarım).
- **Validasyon ve Hata Senaryoları:** Sonuç yoksa empty.
- **Görsel & Metinsel İçerik:** "Search teammates", "Filter".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Büyük ekiplerde üye bulma.
- ➕ Ölçeklenebilirlik.
- ➖ Küçük ekipte az kritik; büyükte zorunlu.
- 🛠️ `Aynen kalsın`.

#### [MOD-04.3.3] Teammates Tablosu (Name / Role / Status / 2FA)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Roster tablosu + satır aksiyon menüsü (…).
- **Kolonlar:** Name | Role | Status | 2FA | (… actions).
- **Gözlem satırları (gerçek):**
  - **Calendertasker (You)** — `calendertasker@gmail.com` — Role **Admin** — Status **Accepting chats** (yeşil) — 2FA **Inactive**.
  - **Can** — `hunterwagn.e.r.6.3.76@gmail.com` — Role **Owner** — Status **Offline** (gri) — 2FA **Inactive**.
- **Roller:** Owner, Admin, Agent. **Status değerleri:** Accepting chats / Not accepting chats / Offline.
- **Mevcut Durumlar:** Default / Hover / Row-selected / Status-renkli göstergeler.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Satıra tıklayınca sağda Profile paneli açılır; … menüsü rol değiştir/kaldır aksiyonları (izin bazlı). Status canlı presence.
- **Validasyon ve Hata Senaryoları:** Owner tek olmalı (çıkarım); kendi rolünü düşürme kısıtı olabilir.
- **Görsel & Metinsel İçerik:** "Admin", "Owner", "Accepting chats", "Offline", "Inactive".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Ekip rolleri, çevrimiçilik ve güvenlik (2FA) tek tabloda.
- ➕ RBAC + presence + güvenlik denetimi.
- ➖ Çıkarılırsa yetki/güvenlik yönetimi kaybolur.
- 🛠️ `Aynen kalsın`. `Özelleştirilsin` — 2FA "Inactive" olanlara zorunlu 2FA politikası eklenebilir.

#### [MOD-04.3.4] Profile Paneli (Teammate Detay)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Sağ detay paneli.
- **İçerik:** avatar, isim, rol rozeti, "Last seen: 26 minutes ago", email, "**6 concurrent chats limit**", [Manage profile], "Chatting teams (1)" (genişletilebilir).
- **Mevcut Durumlar:** Default / Expanded (teams) / Editing (Manage profile).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Ajan profilini gösterir; "6 concurrent chats limit" = aynı anda alabileceği maksimum sohbet (yönlendirme motorunu etkiler); Manage profile ile düzenleme; Chatting teams üyeliği.
- **Validasyon ve Hata Senaryoları:** Limit pozitif tamsayı; izinsiz kullanıcı düzenleyemez.
- **Görsel & Metinsel İçerik:** "Last seen", "6 concurrent chats limit", "Manage profile", "Chatting teams (1)".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Ajan kapasitesi ve takım üyeliği yönetimi (yönlendirmeyi besler).
- ➕ İş yükü dengeleme; adil dağıtım.
- ➖ Çıkarılırsa ajanlar aşırı yüklenebilir.
- 🛠️ `Aynen kalsın`.

### [MOD-04.4] Invite Teammates Modal (Form Mantığı)

![Invite teammates modal](gorseller/fonksiyonel/06-team-invite-modal.jpg)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Modal + form.
- **Alanlar:** Title "Invite teammates" + X; **"Enter email addresses"** textarea (placeholder "name@company, name@company", helper "Use commas to separate multiple emails."); **"Role"** dropdown (default **Admin**; seçenekler Owner / Admin / Agent).
- **Footer:** [Copy invite link] · [Cancel] · [Invite teammates] (submit).
- **Mevcut Durumlar:** Default / Focus / Validation-error (geçersiz/boş email) / Disabled (geçerli email yokken submit pasif) / Loading (davet gönderiliyor) / Success.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Virgülle ayrılmış çoklu email; submit → her adrese davet e-postası + seçilen rolle bekleyen üye oluşturur. Koltuk sayısı arttıkça faturaya yansır (çıkarım).
- **Validasyon ve Hata Senaryoları:** En az bir geçerli email olmadan submit pasif; geçersiz email formatı engellenir; zaten üye olan email uyarısı (çıkarım).
- **Görsel & Metinsel İçerik:** "Invite teammates", "Enter email addresses", "name@company, name@company", "Use commas to separate multiple emails.", "Role", "Copy invite link", "Cancel".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Çoklu, rol atamalı hızlı ekip daveti.
- ➕ Toplu onboarding; rol ön-atama ile güvenlik.
- ➖ Çıkarılamaz (ekip büyümesi).
- 🛠️ `Aynen kalsın`. `Özelleştirilsin` — davet sırasında takım (Chatting team) ve concurrent-chat limiti de atanabilir.

### [MOD-04.5] Teams (Chatting Teams / Departmanlar)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Takım listesi + edit sayfası.
- **Rota:** `/app/team/teams` (+ `/app/team/teams/chatting/0/edit`).
- **Mevcut Durumlar:** Default / Editing.
- **Tetiklenen Eylem ve Sayfa Mantığı:** "Chatting teams" — sohbetleri yönlendirmek için gruplar/departmanlar. Edit sayfasında üye ekle/çıkar, isim, yönlendirme hedefi. Chat routing (MOD-08.6.1) ve skill transfer adımları bu takımlara yönlendirir.
- **Validasyon ve Hata Senaryoları:** Boş isim engellenir (çıkarım); en az bir üye önerilir.
- **Görsel & Metinsel İçerik:** "Chatting teams".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Sohbetleri doğru departmana yönlendirmenin temeli.
- ➕ Uzmanlık bazlı yönlendirme (ödeme ekibi, KYC ekibi…).
- ➖ Çıkarılırsa tüm sohbetler tek havuzda; yönlendirme kabalaşır.
- 🛠️ `Aynen kalsın`.

---
## [MOD-05] Playbook (Otomasyon / Skill Motoru)

![Playbook skill listesi + şablon kartları](gorseller/fonksiyonel/07-playbook-skills.jpg)

Rota: `/app/playbook`. Eski LiveChat "Automate" (chatbot + routing rules + workflows + canned responses) katmanının birleştirilmiş hâli. Burada temel birim **skill**'dir: AI agent'ın veya workspace'in (deterministik workflow) çalıştırdığı bir kural/iş akışı.

### [MOD-05.1] Header (Browse templates / Create skill ▾)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Başlık + [Browse templates] butonu + [Create skill ▾] dropdown buton.
- **Mevcut Durumlar:** Default / Hover / Dropdown-open.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Browse templates → hazır şablon galerisini açar; Create skill ▾ → skill türü seçtiren dropdown (AI agent skill veya workspace workflow — çıkarım) → skill editörüne ([MOD-06.2]) götürür.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "Playbook", "Browse templates", "Create skill".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Otomasyon oluşturmanın ana giriş noktası (şablondan veya sıfırdan).
- ➕ Şablonlar hızlı başlangıç, dropdown esnek tür seçimi.
- ➖ Çıkarılırsa otomasyon oluşturulamaz.
- 🛠️ `Aynen kalsın`.

### [MOD-05.2] Recommended Skills (Şablon Kartları)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Öneri/şablon kartları + rozet + CTA.
- **Gözlem kartları (gerçek):**
  - "Create ticket out of bad ratings" — "Prebuilt by Text" — toggle **ON** — [See more].
  - "Product insurance upsell" — rozet **AI Agent** — "Trending skill" — [Try this].
  - "Close every new lead from chat" — "Popular skill" (Salesforce lead) — [Try this].
  - "Checkout coupon issuer" — rozet **AI Agent** — "Essential skill" — [Try this].
- **Mevcut Durumlar:** Default / Hover / Enabled (toggle ON) / Try (kuruluma götürür).
- **Tetiklenen Eylem ve Sayfa Mantığı:** [Try this] şablonu kopyalayıp editöre açar; toggle şablonu aktifleştirir; [See more] detay.
- **Validasyon ve Hata Senaryoları:** Bazı şablonlar entegrasyon (Salesforce) gerektirir → bağlı değilse uyarı (çıkarım).
- **Görsel & Metinsel İçerik:** "Prebuilt by Text", "AI Agent", "Trending/Popular/Essential skill", "See more", "Try this".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 En değerli otomasyonları hazır şablonla önerir (time-to-value düşürür).
- ➕ Kullanıcı sıfırdan yazmadan güçlü otomasyon kurar.
- ➖ Çıkarılırsa keşif ve hızlı başlangıç zayıflar.
- 🛠️ `Özelleştirilsin` — bahis senaryosuna özel şablonlar (KYC, withdrawal, responsible gambling) öne çıkarılabilir.

### [MOD-05.3] Skill Listesi Sekmeleri

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Sekme + sayaç.
- **Öğeler:** **All (9)** · **AI agents (8)** · **Workspace (1)** · **Drafts (0)**.
- **Mevcut Durumlar:** Default / Active / Empty (Drafts 0).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Skill'leri türe göre filtreler: AI agent (LLM ✦) skill'leri vs. Workspace (deterministik ⚡ workflow) vs. taslaklar.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "All", "AI agents", "Workspace", "Drafts".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 İki otomasyon paradigmasını (AI vs kural) net ayırır.
- ➕ Yönetilebilirlik; taslak ile güvenli hazırlık.
- ➖ Çıkarılırsa skill türleri karışır.
- 🛠️ `Aynen kalsın`.

### [MOD-05.4] Liste Kontrolleri (Search / Sort / Filter)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Arama + Sort + [Filter] (Open workflows filters menu).
- **Mevcut Durumlar:** Default / Focus / Filter-open / Empty.
- **Tetiklenen Eylem ve Sayfa Mantığı:** "Search skills" ada göre arar; Sort sıralar; Filter (workflow filtreleri) tür/durum/sahip bazlı süzer.
- **Validasyon ve Hata Senaryoları:** Sonuç yoksa empty.
- **Görsel & Metinsel İçerik:** "Search skills", "Sort", "Filter".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Çok sayıda skill arasında hızlı yönetim.
- ➕ Ölçek arttıkça zorunlu.
- ➖ Çıkarılırsa büyük skill kütüphaneleri yönetilemez.
- 🛠️ `Aynen kalsın`.

### [MOD-05.5] Skill Satırı (Runs + Toggle)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Liste satırı: ikon (⚡ workflow / ✦ AI) | Name | "N runs" | son düzenleme tarihi | sahip avatarı "Can" | opsiyonel [+ AI agent] etiketi | chat-trigger ikonu | enable **TOGGLE**.
- **Gözlem satırları (gerçek — bahis/casino):**
  - "Tag order issue chats" — **0 runs** — Jul 20 4:24 AM — Can (workspace ⚡).
  - "Withdrawal Issue Escalation" — **1 run** — Jul 14 — AI agent.
  - "KYC Verification Inquiry Handling" — **0 runs** — AI agent.
  - "Responsible Gambling Escalation" — **0 runs** — AI agent.
  - "Age Restriction Enforcement" — **4 runs** — AI agent.
  - "Betting Prediction Request Handling" — **0 runs** — AI agent.
  - "Bonus Condition Explanation" — AI agent.
- **Mevcut Durumlar:** Default / Hover / Enabled (toggle ON) / Disabled (OFF) / Draft.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Satıra tıklayınca skill editörü açılır; toggle skill'i canlı aktif/pasif eder; "N runs" o skill'in kaç kez tetiklendiğini gösterir (analitik/denetim).
- **Validasyon ve Hata Senaryoları:** Eksik yapılandırmalı skill aktifleştirilemez (çıkarım); AI skill için bilgi tabanı gereksinimi.
- **Görsel & Metinsel İçerik:** Skill adları, "N runs", tarih, sahip avatarı, "+ AI agent", toggle.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Otomasyonların canlı kontrol paneli; her birini tek tıkla aç/kapat + çalışma sayısı.
- ➕ Şeffaf denetim (runs), hızlı devreye alma.
- ➖ Çıkarılırsa otomasyon görünürlüğü ve kontrolü kaybolur.
- 🛠️ `Aynen kalsın`.

---
## [MOD-06] AI Agent

Rota: `/app/team/ai-agents/{uuid}/{performance|profile|skills|knowledge}` (gözlem uuid: `0321ca9a-df85-405c-937a-589987b1a4f1`). Ürünün çekirdek yapay zekâsı: müşteriyle konuşan, niyet algılayan, araç-benzeri adımları yürüten, etiketleyen, özetleyen ve insana devreden **agentic AI agent**. Dört sekme: **Performance | Profile | Skills | Knowledge**.

### [MOD-06.1] AI Agent Sekmeleri (Performance / Profile / Skills / Knowledge)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Sekme navigasyonu.
- **Mevcut Durumlar:** Default / Active.
- **Tetiklenen Eylem ve Sayfa Mantığı:** **Performance** (AI agent analitiği), **Profile** (persona/ton/isim/avatar/diller), **Skills** (Playbook'takiyle aynı skill listesi, agent'a özel), **Knowledge** (RAG bilgi tabanı).
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "Performance", "Profile", "Skills", "Knowledge".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Bir AI agent'ın tüm konfigürasyonunu (kişilik + yetenek + bilgi + performans) tek yerde toplar.
- ➕ Bütünsel AI yönetimi.
- ➖ Çıkarılamaz (AI çekirdeği).
- 🛠️ `Aynen kalsın`.

### [MOD-06.2] Custom Skill Editörü

![AI Agent custom skill editörü + Preview](gorseller/fonksiyonel/08-ai-skill-editor.jpg)

Rota: `/app/team/ai-agents/{uuid}/skills/{skillUuid}`. Doğal dil ile yazılan skill'in adımlara derlenip canlı önizlendiği ekran. Sol = tanım, sağ = Preview.

#### [MOD-06.2.1] Editör Üst Barı (Run log / Skill active / Save changes)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Üst bar: "AI agent / Edit custom skill" başlığı + X close + "**N run ▾**" (run log dropdown) + **Skill active** toggle + "…" aksiyonlar + [Save changes].
- **Mevcut Durumlar:** Default / Dirty (kaydedilmemiş değişiklik) / Saving (Loading) / Saved / Active-toggle ON/OFF.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Save changes skill tanımını kaydeder; Skill active toggle canlı devreye alır/çıkarır; N run ▾ çalışma günlüğünü (denetim) açar; X kapatır (kaydedilmemiş değişiklik uyarısı — çıkarım).
- **Validasyon ve Hata Senaryoları:** Geçersiz/eksik adımlarda Save engellenir; kaydedilmemişken çıkışta uyarı.
- **Görsel & Metinsel İçerik:** "Edit custom skill", "N run", "Skill active", "Save changes".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Skill'i düzenleme, canlıya alma ve denetleme kontrolü.
- ➕ Güvenli yayınlama + denetim (run log).
- ➖ Çıkarılamaz.
- 🛠️ `Aynen kalsın`.

#### [MOD-06.2.2] Skill Name

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Metin girişi.
- **Mevcut Durumlar:** Default / Focus / Error (boş).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Skill'in görünen adı (ör. "Withdrawal Issue Escalation"). Liste/rapor/run log'da bu isim görünür.
- **Validasyon ve Hata Senaryoları:** Boş isim kaydedilemez.
- **Görsel & Metinsel İçerik:** Skill adı.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Skill'i tanımlar/aranabilir kılar.
- ➕ Yönetilebilirlik.
- ➖ Çıkarılamaz.
- 🛠️ `Aynen kalsın`.

#### [MOD-06.2.3] Doğal Dil Talimat Textarea'sı

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Çok satırlı metin girişi (NL instruction).
- **Mevcut Durumlar:** Default (placeholder) / Focus / Filled / Compiling (adımlara derleniyor — çıkarım).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Placeholder: "e.g. Allow making a hotel reservation. Ask the customer about the room type and number of guests, then create a reservation in our internal system." Doğal dil talimatı, ordered STEPS'e derlenir (gözlemde gerçek talimat Türkçe girilmiş). Bu, no-code AI otomasyonunun kalbidir.
- **Validasyon ve Hata Senaryoları:** Boş talimatla adım üretilemez; belirsiz talimat zayıf adımlara yol açar.
- **Görsel & Metinsel İçerik:** Yukarıdaki placeholder.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Kod yazmadan, düz cümleyle karmaşık AI davranışı tanımlama.
- ➕ Teknik olmayan ekiplerin otomasyon kurmasını sağlar (ürünün ana değer önerisi).
- ➖ Çıkarılırsa AI agent yalnızca hazır adımlarla sınırlanır.
- 🛠️ `Aynen kalsın`.

#### [MOD-06.2.4] Ordered Steps (Sıralı Adımlar — Accordion)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Sıralı, genişletilebilir ve yeniden sıralanabilir adım akordeonu.
- **Gözlem adımları (gerçek — Withdrawal Issue Escalation):**
  1. AI Agent detects custom skill intent
  2. Request username and transaction date from customer
  3. Tag the conversation with payment label
  4. Create a brief summary of the withdrawal issue
  5. Inform customer about transfer with issue summary
  6. Transfer conversation to the payment team
- **Adım türleri:** detect-intent · request-info · tag · summarize · send-message · transfer-to-team.
- **Mevcut Durumlar:** Collapsed / Expanded / Reordering (drag) / Editing / Error (eksik parametre).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Her adım bir "araç" çağrısıdır; sırayla yürütülür. Adımlar drag ile yeniden sıralanır, genişletilip parametreleri düzenlenir. Bu, LLM'in tool-calling akışının görselleştirilmiş hâlidir.
- **Validasyon ve Hata Senaryoları:** Zorunlu parametreler (ör. transfer hedef takımı) boşsa adım hatalı; kaydetme engellenir.
- **Görsel & Metinsel İçerik:** Adım başlıkları (yukarıdaki 6 adım).

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 AI'ın ne yapacağını adım adım, denetlenebilir ve düzenlenebilir kılar (kara kutu değil).
- ➕ Şeffaflık + kontrol + yeniden sıralama esnekliği; regülasyonlu sektörde (bahis) denetim şart.
- ➖ Çıkarılırsa AI davranışı opak ve kontrol edilemez olur.
- 🛠️ `Aynen kalsın`.

#### [MOD-06.2.5] Preview (Canlı Simülasyon)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Canlı önizleme paneli (sağ).
- **Mevcut Durumlar:** Idle / Running (simülasyon) / Output.
- **Tetiklenen Eylem ve Sayfa Mantığı:** AI agent'ın skill'i örnek müşteri mesajına karşı çalıştırmasını simüle eder. Gözlem: örnek mesaj "Username is john_doe, and I made the withdrawal on June 10th." → AI eylemleri anlatır (topladığı veri, chat'i etiketledi, Türkçe özet üretti, insana transfer etti). Footer "Powered by text.com".
- **Validasyon ve Hata Senaryoları:** Skill hatalıysa Preview hata gösterir.
- **Görsel & Metinsel İçerik:** Simülasyon çıktısı + "Powered by text.com".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Yayınlamadan önce AI davranışını canlı test etme (güven + kalite).
- ➕ Hataları erken yakalar; iterasyonu hızlandırır.
- ➖ Çıkarılırsa AI kör yayınlanır (risk).
- 🛠️ `Aynen kalsın`.

### [MOD-06.3] Knowledge (RAG Bilgi Kütüphanesi)

![AI Agent Knowledge (RAG kaynakları)](gorseller/fonksiyonel/09-ai-knowledge.jpg)

Rota: `/app/team/ai-agents/{uuid}/knowledge`. AI agent'ı besleyen retrieval-augmented generation (RAG) bilgi tabanı.

#### [MOD-06.3.1] Knowledge Alt Sekmeleri

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Sekme + sayaç.
- **Öğeler:** **All (13)** · **Websites (1)** · **Files (0)** · **Articles (12)** · **FAQ (0)**.
- **Mevcut Durumlar:** Default / Active / Empty (Files 0, FAQ 0).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Kaynakları türe göre filtreler. Kaynak türleri: **Website** (URL crawl), **File** (doküman yükle), **Article** (manuel rich text), **FAQ** (Q&A çiftleri).
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "All", "Websites", "Files", "Articles", "FAQ".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 AI'ın "ne bildiğini" tür bazında yönetir.
- ➕ Çok kaynaklı, denetlenebilir bilgi tabanı.
- ➖ Çıkarılırsa AI halüsinasyona açık kalır (RAG olmadan).
- 🛠️ `Aynen kalsın`.

#### [MOD-06.3.2] + New Source (Kaynak Ekleme)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Buton + kaynak ekleme akışı.
- **Mevcut Durumlar:** Default / Type-select / Uploading/Crawling (Loading) / Success / Error.
- **Tetiklenen Eylem ve Sayfa Mantığı:** [+ New source] → kaynak türü seç (Website URL / File upload / Article / FAQ) → içerik alınır, parçalanır (chunk), embedding'lenir, indekslenir (çıkarım). Web sitesi için crawl; dosya için parse.
- **Validasyon ve Hata Senaryoları:** Geçersiz URL / desteklenmeyen dosya türü / boş içerik reddi; crawl hatası.
- **Görsel & Metinsel İçerik:** "New source".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 AI'ı şirkete özel bilgiyle besleme (doğru, güncel yanıtlar).
- ➕ Doğruluk artışı; halüsinasyon azalır.
- ➖ Çıkarılırsa AI genel bilgiyle sınırlı kalır.
- 🛠️ `Aynen kalsın`.

#### [MOD-06.3.3] Kaynak Tablosu

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Tablo: Name | Last Updated | Added by | Actions(…).
- **Gözlem kaynakları (gerçek — Türkçe, bahis; tümü Jul 14, by Can):** Para Çekme Kuralları ve Limitleri; Yatırım Yöntemleri ve Limitleri; Çevrim (Wager) Sorguları; Hesap Kapatma ve Sorumlu Oyun; Anında Havale ile Yatırım ve Dekont Yükleme; Şifre Sıfırlama; İşlem Kontrol / Yatırım Gecikmesi; Banka Hesabı Ekleme; Güncel Adres / Domain Sorusu; Mobil Uygulama.
- **Mevcut Durumlar:** Default / Hover / Row-actions.
- **Tetiklenen Eylem ve Sayfa Mantığı:** … menüsü ile kaynağı düzenle/sil/yeniden crawl et; satıra tıklayınca içerik. Kaynaklar AI yanıtlarında retrieval ile kullanılır.
- **Validasyon ve Hata Senaryoları:** Silme onayı; crawl başarısızlığı durumu.
- **Görsel & Metinsel İçerik:** "Name", "Last Updated", "Added by", makale başlıkları.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Bilgi kaynaklarını denetleme/güncelleme (kim, ne zaman ekledi).
- ➕ Bilgi yönetişimi + güncellik.
- ➖ Çıkarılırsa bilgi tabanı yönetilemez.
- 🛠️ `Aynen kalsın`. `Özelleştirilsin` — kaynak "geçerlilik tarihi" ve otomatik yeniden crawl planı eklenebilir.

### [MOD-06.4] Profile (Persona)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Form (persona ayarları).
- **İçerik (çıkarım, evidence: "persona/tone/name/avatar/languages"):** isim, avatar, ton, diller.
- **Mevcut Durumlar:** Default / Editing / Saving.
- **Tetiklenen Eylem ve Sayfa Mantığı:** AI agent'ın kimliğini ve iletişim tarzını belirler; müşteri widget'ında bu isim/avatar/ton görünür.
- **Validasyon ve Hata Senaryoları:** Zorunlu isim; desteklenen dil seçimi.
- **Görsel & Metinsel İçerik:** name / avatar / tone / languages alanları (çıkarım).

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 AI'a marka-uyumlu kimlik ve ton verir.
- ➕ Tutarlı marka sesi; çok dilli destek.
- ➖ Çıkarılırsa AI kişiliksiz/tutarsız olur.
- 🛠️ `Aynen kalsın`. `Özelleştirilsin` — Türkçe ton ve "Hit Asistan" persona hazır tanımlanabilir.

### [MOD-06.5] Performance (AI Analitiği)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Analitik gösterge paneli.
- **Mevcut Durumlar:** Default / Loading / Empty (veri yok).
- **Tetiklenen Eylem ve Sayfa Mantığı:** AI agent'ın performansını gösterir (çözülen sohbet, devir oranı, AI resolution sayısı — çıkarım). Reports > AI Agent ([MOD-07.4]) ile ilişkili.
- **Validasyon ve Hata Senaryoları:** Veri yoksa empty.
- **Görsel & Metinsel İçerik:** KPI kartları (çıkarım).

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 AI'ın gerçekten çalışıp çalışmadığını ölçer (ROI + billing).
- ➕ AI resolution takibi faturayla doğrudan ilişkili.
- ➖ Çıkarılırsa AI etkisi ölçülemez.
- 🛠️ `Aynen kalsın`.

---
## [MOD-07] Reports (Analitik)

![Reports Overview KPI'ları](gorseller/fonksiyonel/10-reports-overview.jpg)

Rota: `/app/reports`. Sohbet, ticket, satış, ekip ve AI performansının analitik merkezi. Karşılaştırmalı dönem (vs previous period) mantığı her metrikte var.

### [MOD-07.1] Reports Kenar Çubuğu

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Navigasyon + grup genişleticiler.
- **Öğeler:** Overview (`/overview`) · AI Agent (`/ai-agent`) · Metrics breakdown (`/metrics-breakdown`) · Chat topics (`/chat-topics`, **NEW • kırmızı nokta**) · Leads (grup ›) · Cases (grup ›) · Sales (grup ›) · Team performance (grup ›) · Export (grup ›).
- **Mevcut Durumlar:** Default / Active / Group-expanded / New-badge.
- **Tetiklenen Eylem ve Sayfa Mantığı:** İlgili rapora gider; gruplar alt raporları açar; "Chat topics" AI-clustered konu analizidir (yeni özellik).
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "Overview", "AI Agent", "Metrics breakdown", "Chat topics", "Leads", "Cases", "Sales", "Team performance", "Export".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Tüm analitiği kategorize eder; AI ve klasik metrikleri birlikte sunar.
- ➕ Kapsamlı raporlama; yöneticiye tam görünürlük.
- ➖ Çıkarılırsa veri-odaklı yönetim zayıflar.
- 🛠️ `Aynen kalsın`.

### [MOD-07.2] Onboarding Survey Popover (İlk Ziyaret)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Popover + checkbox anketi.
- **Soru:** "What are you tracking?" — seçenekler: Tracking agent performance / Sharing results with my team or manager / Spotting problems / Measuring revenue impact / Other.
- **Mevcut Durumlar:** İlk ziyaret / Dismissed / Submitted.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Kullanıcı hedeflerini toplar; raporları kişiselleştirmek/öneri sunmak için kullanılır (çıkarım).
- **Validasyon ve Hata Senaryoları:** Yok (opsiyonel).
- **Görsel & Metinsel İçerik:** Yukarıdaki 5 seçenek.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Raporları kullanıcı amacına göre kişiselleştirmek için sinyal.
- ➕ Kişiselleştirme + ürün analitiği.
- ➖ Çıkarılırsa kişiselleştirme sinyali kaybolur (kritik değil).
- 🛠️ `Özelleştirilsin` — tek sefer, atlanabilir tutulmalı.

### [MOD-07.3] Overview Sayfası

#### [MOD-07.3.1] Header + Range Tabs + Share

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Başlık + tarih karşılaştırma + range sekmeleri + [Share].
- **İçerik:** "Overview 14–20 Jul vs 7–13 Jul" + [7 days][30 days][90 days][365 days] + custom calendar + [Share].
- **Mevcut Durumlar:** Default / Active-range / Calendar-open / Share-open.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Range seçimi tüm metrikleri seçilen döneme ve otomatik önceki döneme göre yeniden hesaplar; custom takvim özel aralık; Share raporu paylaşır/dışa aktarır (link/export).
- **Validasyon ve Hata Senaryoları:** Geçersiz custom aralık (bitiş < başlangıç) engellenir.
- **Görsel & Metinsel İçerik:** "Overview", "14–20 Jul vs 7–13 Jul", "7 days", "30 days", "90 days", "365 days", "Share".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Dönemsel trend + karşılaştırma + paylaşım.
- ➕ Yönetici raporlaması; hızlı içgörü.
- ➖ Çıkarılırsa zaman-serisi analizi kaybolur.
- 🛠️ `Aynen kalsın`.

#### [MOD-07.3.2] KPI Kartları (Manual / Assisted / Automated Split)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** KPI kartları (delta göstergeli).
- **Gözlem (gerçek):**
  - **Total cases 20** (↑20 vs 0 prev) → Chats 20, Tickets 0.
  - **Total chats 20** (↑20) → **Manual 9 / Assisted 6 / Automated 5** (AI katılım kırılımı).
  - **All sales $0** [Configure sales platforms].
- **Mevcut Durumlar:** Default / Loading / Empty / Delta-up/down.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Total chats kartı sohbetleri AI katılımına göre böler: **Manual** (yalnız insan), **Assisted** (Copilot destekli insan), **Automated** (AI çözdü). Bu split hem AI ROI'sini hem billing'deki AI resolution'ları temellendirir. "Configure sales platforms" satış entegrasyonuna götürür.
- **Validasyon ve Hata Senaryoları:** Veri yoksa 0/empty; satış platformu bağlı değilse $0 + CTA.
- **Görsel & Metinsel İçerik:** "Total cases", "Total chats", "Manual/Assisted/Automated", "All sales", "Configure sales platforms".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 En kritik metrik: sohbetlerin ne kadarını AI çözdü/insana yardım etti.
- ➕ AI değerini kanıtlar; yatırım kararlarını besler; billing ile hizalı.
- ➖ Çıkarılırsa AI'ın etkisi görünmez olur (ürünün ana satış argümanı kaybolur).
- 🛠️ `Aynen kalsın`.

#### [MOD-07.3.3] Chats Bölümü Kartları

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Metrik kartları.
- **Gözlem (gerçek):** Automated chats per hour 0 avg; Automated chat duration 15m 57s; Total chat duration 6h 51m; (ve altta: response times, satisfaction...).
- **Mevcut Durumlar:** Default / Loading / Delta.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Süre, hız, memnuniyet metriklerini dönemsel + karşılaştırmalı gösterir.
- **Validasyon ve Hata Senaryoları:** Veri yoksa 0.
- **Görsel & Metinsel İçerik:** "Automated chats per hour", "Automated chat duration", "Total chat duration".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Operasyonel verimlilik (hız/süre/memnuniyet) ölçümü.
- ➕ SLA ve kalite yönetimi.
- ➖ Çıkarılırsa operasyon körleşir.
- 🛠️ `Aynen kalsın`.

### [MOD-07.4] AI Agent Raporu

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Rapor sayfası (`/app/reports/ai-agent`).
- **Mevcut Durumlar:** Default / Loading / Empty.
- **Tetiklenen Eylem ve Sayfa Mantığı:** AI agent'a özel metrikler (çözülen sohbet, deflection, AI resolution kullanımı — çıkarım). Billing sayacıyla ilişkili.
- **Validasyon ve Hata Senaryoları:** Veri yoksa empty.
- **Görsel & Metinsel İçerik:** "AI Agent".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 AI yatırımının geri dönüşü.
- ➕ AI resolution ve maliyet takibi.
- ➖ Çıkarılırsa AI ROI ölçülemez.
- 🛠️ `Aynen kalsın`.

### [MOD-07.5] Metrics Breakdown

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Detaylı metrik kırılım tablosu/grafikleri (`/metrics-breakdown`).
- **Mevcut Durumlar:** Default / Loading / Empty.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Metrikleri boyutlara göre (ajan, takım, kanal, saat — çıkarım) ayrıştırır.
- **Validasyon ve Hata Senaryoları:** Veri yoksa empty.
- **Görsel & Metinsel İçerik:** "Metrics breakdown".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Derin, boyutlu analiz.
- ➕ Sorun kök-neden analizi.
- ➖ Çıkarılırsa yalnız yüzeysel metrik kalır.
- 🛠️ `Aynen kalsın`.

### [MOD-07.6] Chat Topics (AI-Clustered)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** AI konu kümeleme raporu (`/chat-topics`, NEW).
- **Mevcut Durumlar:** Default / Loading (AI kümeliyor) / Empty.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Sohbetleri AI ile konu kümelerine ayırır ("Top chat topics"); hacim/trend gösterir. Overview'daki promo "See chat topics" buraya götürür.
- **Validasyon ve Hata Senaryoları:** Yeterli veri yoksa empty.
- **Görsel & Metinsel İçerik:** "Chat topics", "Top chat topics in one place".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Müşterilerin ne sorduğunu otomatik keşfeder (manuel etiketlemeye gerek yok).
- ➕ Ürün/operasyon içgörüsü; bilgi tabanı boşluklarını gösterir.
- ➖ Çıkarılırsa konu analizi manuelleşir.
- 🛠️ `Aynen kalsın`.

### [MOD-07.7] Rapor Grupları (Leads / Cases / Sales / Team performance / Export) + Survey

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Genişletilebilir rapor grupları.
- **Öğeler:** Leads, Cases, Sales, Team performance, Export.
- **Mevcut Durumlar:** Collapsed / Expanded.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Her grup ilgili alt raporları barındırır; **Export** verileri dışa aktarma (CSV/PDF — çıkarım); Team performance ajan bazlı KPI'lar.
- **Validasyon ve Hata Senaryoları:** İzin bazlı görünürlük (çıkarım).
- **Görsel & Metinsel İçerik:** "Leads", "Cases", "Sales", "Team performance", "Export".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Rol/amaç bazlı derin raporlar + dışa aktarım.
- ➕ Yönetici + analist ihtiyaçlarını karşılar.
- ➖ Çıkarılırsa raporlama sığ kalır.
- 🛠️ `Aynen kalsın`.

---
## [MOD-08] Settings (Omnichannel / Konfigürasyon)

![Settings — All channels](gorseller/fonksiyonel/11-settings-channels.jpg)

![Full Settings kenar çubuğu](gorseller/fonksiyonel/13b-billing-full-settings-nav.jpg)

Rota: `/app/settings`. Tüm ürün yapılandırması: bildirimler, şirket, kanallar, yönlendirme, gelen kutusu araçları, entegrasyonlar, güvenlik, faturalandırma. Kenar çubuğu gruplu; "Unpin side navigation" ile daraltılabilir.

### [MOD-08.1] Settings Kabuğu / Kenar Çubuğu

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Gruplu ayarlar navigasyonu.
- **Gruplar:** (tekil) Notifications, Company details, Desktop app; **Channels**; **Routing**; **Inbox**; **Integrations**; **Security**; **Billing**.
- **Mevcut Durumlar:** Default / Active / Group-expanded.
- **Tetiklenen Eylem ve Sayfa Mantığı:** İlgili ayar sayfasına gider; her sayfa kendi formu/tablosu.
- **Validasyon ve Hata Senaryoları:** İzin (role) bazlı görünürlük.
- **Görsel & Metinsel İçerik:** Yukarıdaki grup adları.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Tüm yönetimsel konfigürasyonun tek merkezi.
- ➕ Düzenli, keşfedilebilir yapı.
- ➖ Çıkarılamaz.
- 🛠️ `Aynen kalsın`.

### [MOD-08.2] Notifications

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Ayar formu (toggle'lar).
- **Rota:** `/app/settings/notifications`.
- **Mevcut Durumlar:** Default / Toggled / Saving.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Ses/masaüstü/e-posta bildirim tercihleri (yeni sohbet, atama, mention — çıkarım). Kullanıcı bazında saklanır.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "Notifications".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Ajanın kaçırmadan bildirim almasını sağlar.
- ➕ Yanıt süresi düşer; kaçan sohbet azalır.
- ➖ Çıkarılırsa ajanlar yeni sohbeti kaçırır.
- 🛠️ `Aynen kalsın`.

### [MOD-08.3] Company Details

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Form (şirket bilgileri).
- **Rota:** `/app/settings/company-details`.
- **Mevcut Durumlar:** Default / Editing / Saving / Error.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Şirket adı, sektör, adres, saat dilimi (çıkarım) — raporlama/fatura/widget markalama için temel.
- **Validasyon ve Hata Senaryoları:** Zorunlu alanlar; geçersiz format.
- **Görsel & Metinsel İçerik:** "Company details".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Kiracının kurumsal kimliği.
- ➕ Fatura/marka/rapor doğruluğu.
- ➖ Çıkarılırsa fatura ve markalama eksik kalır.
- 🛠️ `Aynen kalsın`.

### [MOD-08.4] Desktop App

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** İndirme/bilgi sayfası.
- **Rota:** `/app/settings/desktop-app`.
- **Mevcut Durumlar:** Default.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Masaüstü uygulama indirme linkleri (Windows/macOS — çıkarım); native bildirim/ayrı pencere avantajı.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "Desktop app".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Tarayıcı sekmesi yerine ayrı, kalıcı ajan uygulaması.
- ➕ Ajan verimliliği + native bildirim.
- ➖ Çıkarılırsa yalnız web kalır (kritik değil).
- 🛠️ `Özelleştirilsin` — MVP'de ertelenebilir; web-öncelikli.

### [MOD-08.5] Channels (Kanallar)

Omnichannel'ın kalbi. "All channels" sayfasında her kanal bir kart: ikon + isim + status badge + açıklama + CTA.

#### [MOD-08.5.1] All Channels

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Kanal kartları gridi.
- **Kartlar (gerçek):**
  - **Website widget** — **Connected** — "Chat with visitors in real time while they browse your website." [Manage].
  - **Chat page** — **Ready to use** — "Share a chat link with customers so they can reach out." [Get link].
  - **Email** — "Forward emails from multiple addresses as tickets." [Connect].
  - **Messenger** — "Get Facebook page messages as chats in your inbox." [Connect].
  - **Twilio SMS** — "Send and receive SMS messages directly from your inbox." [Connect].
  - **WhatsApp** — "WhatsApp messages will appear as chats in your inbox." [Connect].
  - **Instagram** — **Coming soon** — [Get notified].
  - **Telegram** — **Coming soon** — [Get notified].
- **Mevcut Durumlar:** Connected / Ready to use / Not connected / Coming soon.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Manage/Connect/Get link/Get notified CTA'ları ilgili kanal ayar sayfasına götürür veya OAuth bağlantısı başlatır. "Coming soon" için bildirim kaydı.
- **Validasyon ve Hata Senaryoları:** Kanal kimlik doğrulama hatası (OAuth reddi); yanlış numara/hesap.
- **Görsel & Metinsel İçerik:** Kanal isimleri + status + açıklamalar + CTA'lar (yukarıda tam).

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Tüm iletişim kanallarını tek gelen kutusunda birleştirme merkezi.
- ➕ Omnichannel = müşteriye her yerde ulaşma; ürünün ana değeri.
- ➖ Çıkarılırsa yalnız web widget kalır (rekabet dezavantajı).
- 🛠️ `Aynen kalsın`.

#### [MOD-08.5.2] Website Widgets (+ Add website Form Mantığı)

![Website widgets (2 site, install)](gorseller/fonksiyonel/12-settings-websites.jpg)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Yönetim sayfası + kurulum banner'ı + site tablosu.
- **Rota:** `/app/settings/websites` (**ON**).
- **Header:** "Website widgets" + [Customize widget ↗] (widget tema özelleştirici açar).
- **Banner:** "Connect the widget to your website" [Add website] [Install code manually] + platform ikonları (Shopify, WordPress, </> raw code). "Need help? Invite a developer or read guide".
- **Websites (2) tablosu:** Website | Created by | Connected on | Setup (Manual </>) | Status (Connected). Satırlar: `localhost` (Jul 20), `livechat-demo.surge.sh` (Jul 14). Per-row … menü (get code / remove).
- **Install:** JS snippet (`window.__lc` + async loader) `</body>` öncesine.
- **Mevcut Durumlar:** Default / Add-website-form / Installing / Connected / Not-verified (kod yok).
- **Tetiklenen Eylem ve Sayfa Mantığı:** **[Add website]** domain ekleme formu açar (URL girilir → snippet üretilir); [Install code manually] ham kodu gösterir; platform ikonları rehberli kurulum. Widget bağlanınca Status "Connected".
- **Validasyon ve Hata Senaryoları:** Geçersiz domain reddi; snippet yerleştirilmemişse "not verified"; Trusted domains (MOD-08.9.1) ile allowlist.
- **Görsel & Metinsel İçerik:** "Website widgets", "Customize widget", "Connect the widget to your website", "Add website", "Install code manually", "Need help? Invite a developer or read guide", "Connected".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Web sitesine chat widget kurmanın merkezi; çoklu site desteği.
- ➕ Kolay kurulum (snippet + platform rehberi); geliştirici davet et.
- ➖ Çıkarılamaz (çekirdek kanal).
- 🛠️ `Aynen kalsın`.

#### [MOD-08.5.3] Email (Forwarding)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Kanal kurulum sayfası.
- **Rota:** `/app/settings/email/forwarding-addresses` (**OFF**).
- **Mevcut Durumlar:** Off / Connecting / Connected.
- **Tetiklenen Eylem ve Sayfa Mantığı:** "Forward emails from multiple addresses as tickets." Birden çok e-posta adresini forward ederek ticket üretir.
- **Validasyon ve Hata Senaryoları:** Forward doğrulama (test e-postası); geçersiz adres.
- **Görsel & Metinsel İçerik:** "Email", forwarding-addresses.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 E-posta desteğini ticket sistemine bağlar.
- ➕ Asenkron destek kanalı.
- ➖ Çıkarılırsa e-posta desteği kaybolur.
- 🛠️ `Aynen kalsın`.

#### [MOD-08.5.4] Messenger · [MOD-08.5.5] Twilio SMS · [MOD-08.5.6] WhatsApp

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Kanal OAuth/kimlik bağlama sayfaları.
- **Rotalar:** `/messenger`, `/twilio`, `/whatsapp` (hepsi **OFF**).
- **Mevcut Durumlar:** Off / Connecting / Connected / Error.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Messenger → Facebook page OAuth; Twilio → Twilio hesap/numara kimlik bilgileri; WhatsApp → WhatsApp Business bağlama. Gelen mesajlar Inbox'a chat olarak düşer.
- **Validasyon ve Hata Senaryoları:** Geçersiz kimlik bilgisi; yetki reddi; numara doğrulama.
- **Görsel & Metinsel İçerik:** "Messenger", "Twilio SMS", "WhatsApp".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Sosyal + SMS + WhatsApp kanallarını tek kutuda birleştirir.
- ➕ Müşterinin bulunduğu her yerde destek.
- ➖ Çıkarılırsa erişim daralır.
- 🛠️ `Aynen kalsın`. `Özelleştirilsin` — hedef pazara göre öncelik (TR pazarında WhatsApp + Telegram öne).

#### [MOD-08.5.7] Instagram (SOON) · [MOD-08.5.8] Telegram (SOON)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** "Coming soon" kanal kartları + [Get notified].
- **Rotalar:** `/instagram`, `/telegram`.
- **Mevcut Durumlar:** Coming soon.
- **Tetiklenen Eylem ve Sayfa Mantığı:** [Get notified] lansman bildirimi için kayıt.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "Coming soon", "Get notified".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Yol haritası şeffaflığı + talep toplama.
- ➕ Beklenti yönetimi; TR pazarında Telegram önemli.
- ➖ Çıkarılırsa gelecek kanal sinyali kaybolur.
- 🛠️ `Özelleştirilsin` — klonda Telegram öncelikli tam entegrasyon (TR pazarı).

#### [MOD-08.5.9] Chat Page

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Barındırılan sohbet sayfası ayarı.
- **Rota:** `/app/settings/chat-page`. Status "Ready to use", CTA [Get link].
- **Mevcut Durumlar:** Ready / Configured.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Web sitesi olmayanlar için paylaşılabilir bir sohbet linki (hosted chat page). [Get link] linki verir.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "Chat page", "Ready to use", "Get link".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Site kurmadan, link paylaşarak destek almanın en hızlı yolu.
- ➕ Küçük işletme/sosyal-only için sıfır-kurulum kanal.
- ➖ Çıkarılırsa sitesiz kullanıcılar dışlanır.
- 🛠️ `Aynen kalsın`.

### [MOD-08.6] Routing (Yönlendirme)

![Chat routing kuralları](gorseller/fonksiyonel/15-chat-routing.jpg)

#### [MOD-08.6.1] Chat Routing

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Kural motoru sayfası + [+ New routing rule] + fallback seçici.
- **Rota:** `/app/settings/routing/chat-routing`.
- **İçerik:** "Route chats to the right team — Automatically route customers to the right team based on how customers interact with your website." [+ New routing rule]. Fallback: "If a chat doesn't match a rule, route it to [Chatting Team ▾]".
- **Mevcut Durumlar:** Default / Rule-editing / Empty (kural yok, sadece fallback).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Ziyaretçi/sayfa/URL/grup koşullarına göre sohbeti bir Chatting Team'e yönlendirir; eşleşme yoksa fallback takıma. Kurallar sıralı değerlendirilir (çıkarım).
- **Validasyon ve Hata Senaryoları:** Fallback takım zorunlu; çelişen kural uyarısı (çıkarım).
- **Görsel & Metinsel İçerik:** "Route chats to the right team", "New routing rule", "If a chat doesn't match a rule, route it to".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Doğru sohbeti doğru uzmana otomatik iletir.
- ➕ Verimlilik + uzmanlık bazlı hız + SLA.
- ➖ Çıkarılırsa tüm sohbetler tek havuzda; yanlış atama artar.
- 🛠️ `Aynen kalsın`. `Özelleştirilsin` — bahis senaryosunda "KYC / Ödeme / Genel" takımlarına URL+konu bazlı yönlendirme.

#### [MOD-08.6.2] Ticket Rules

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Ticket otomasyon kural motoru.
- **Rota:** `/app/settings/routing/ticket-rules`.
- **Mevcut Durumlar:** Default / Rule-editing / Empty.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Ticket'lar için otomasyon (atama, etiketleme, önceliklendirme koşullara göre — çıkarım).
- **Validasyon ve Hata Senaryoları:** Kural koşul/eylem zorunlu.
- **Görsel & Metinsel İçerik:** "Ticket rules".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Ticket iş akışını otomatikleştirir.
- ➕ Manuel triyaj yükünü azaltır.
- ➖ Çıkarılırsa ticket'lar elle yönetilir.
- 🛠️ `Aynen kalsın`.

---
### [MOD-08.7] Inbox (Gelen Kutusu Araçları)

#### [MOD-08.7.1] Tags

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Etiket kütüphanesi (CRUD).
- **Rota:** `/app/settings/tags`.
- **Mevcut Durumlar:** Default / Creating / Editing / Empty.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Sohbet/ticket'larda kullanılan etiketleri oluştur/düzenle/sil. Playbook skill'lerinin "tag" adımı ve Details paneli buradan besler; raporlamada segment.
- **Validasyon ve Hata Senaryoları:** Yinelenen etiket adı engeli; silinen etiketin kullanımdaki durumu uyarısı (çıkarım).
- **Görsel & Metinsel İçerik:** "Tags".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Konuşmaları sınıflandırma ve raporlama temeli.
- ➕ Otomasyon + analitik + arama için kritik.
- ➖ Çıkarılırsa segmentasyon ve konu analizi zayıflar.
- 🛠️ `Aynen kalsın`.

#### [MOD-08.7.2] Canned Responses (Form Mantığı)

![Canned responses](gorseller/fonksiyonel/16-canned-responses.jpg)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Hazır yanıt yönetimi + [New canned response ▾].
- **Rota:** `/app/settings/canned-responses`.
- **İçerik:** "Canned responses are pre-made messages to solve conversations quickly." Tabs: **Chat responses (23)** | **Ticket responses**. Her yanıt = **shortcut (#tag)** + message text + opsiyonel group scope. Composer'da `#` ile kullanılır.
- **Mevcut Durumlar:** Default / Creating (form) / Editing / Empty.
- **Tetiklenen Eylem ve Sayfa Mantığı:** [New canned response ▾] form açar: shortcut, mesaj metni, kapsam (grup). Kaydedilince composer `#` menüsünde çıkar.
- **Validasyon ve Hata Senaryoları:** Yinelenen shortcut engeli; boş mesaj engeli.
- **Görsel & Metinsel İçerik:** "Canned responses are pre-made messages to solve conversations quickly.", "Chat responses (23)", "Ticket responses", "New canned response".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Tekrarlayan yanıtları saniyede gönderme.
- ➕ Hız + tutarlılık + yeni ajan onboarding.
- ➖ Çıkarılırsa her yanıt elle yazılır.
- 🛠️ `Aynen kalsın`. `Özelleştirilsin` — bahis senaryosunda KYC/withdrawal hazır yanıtları ön-yüklenir.

#### [MOD-08.7.3] Chat Timeout

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Eşik/süre ayar formu.
- **Rota:** `/app/settings/chats/chat-timeout`.
- **Mevcut Durumlar:** Default / Editing / Saving.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Boşta kalma/timeout eşikleri: müşteri yanıt vermezse sohbetin otomatik kapanma/arşivlenme süresi.
- **Validasyon ve Hata Senaryoları:** Pozitif süre; makul aralık.
- **Görsel & Metinsel İçerik:** "Chat timeout".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Ölü sohbetleri otomatik temizler; ajan kapasitesini korur.
- ➕ Kapasite yönetimi; doğru metrikler.
- ➖ Çıkarılırsa ölü sohbetler kuyruğu tıkar.
- 🛠️ `Aynen kalsın`.

#### [MOD-08.7.4] Chat Transcripts

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Otomatik transcript e-posta ayarı.
- **Rota:** `/app/settings/chats/chat-transcripts`.
- **Mevcut Durumlar:** Default / Editing.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Sohbet bitince müşteriye/ekibe otomatik transcript e-postası gönderme kuralları.
- **Validasyon ve Hata Senaryoları:** Geçerli e-posta şablonu.
- **Görsel & Metinsel İçerik:** "Chat transcripts".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Müşteriye/ekibe konuşma kaydı gönderir (kayıt + şeffaflık).
- ➕ Uyuşmazlık çözümü + müşteri memnuniyeti.
- ➖ Çıkarılırsa kayıt paylaşımı manuelleşir.
- 🛠️ `Aynen kalsın`.

#### [MOD-08.7.5] Ticket Email Templates

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** E-posta şablonu editörü.
- **Rota:** `/app/settings/tickets/email-templates`.
- **Mevcut Durumlar:** Default / Editing / Saving.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Ticket bildirim/yanıt e-postalarının şablonları (markalı, değişkenli).
- **Validasyon ve Hata Senaryoları:** Geçersiz değişken/format.
- **Görsel & Metinsel İçerik:** "Email templates".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Marka-uyumlu, tutarlı e-posta iletişimi.
- ➕ Profesyonel görünüm + verimlilik.
- ➖ Çıkarılırsa e-postalar biçimsiz/manuel olur.
- 🛠️ `Aynen kalsın`.

#### [MOD-08.7.6] Custom Fields

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Özel alan tanımlayıcı (CRUD).
- **Rota:** `/app/settings/tickets/custom-fields`.
- **Mevcut Durumlar:** Default / Creating / Editing.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Ticket/contact üzerinde özel veri alanları tanımlar (metin, sayı, seçim — çıkarım). Details paneli ve CRM'de görünür.
- **Validasyon ve Hata Senaryoları:** Alan tipi/zorunluluk kuralları.
- **Görsel & Metinsel İçerik:** "Custom fields".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Ürünü sektöre özel veri modeline uyarlar.
- ➕ Bahis senaryosunda örnek alanlar: player ID, KYC durumu, bakiye.
- ➖ Çıkarılırsa yalnız standart alanlar kalır.
- 🛠️ `Aynen kalsın`. `Özelleştirilsin` — domain alanları hazır tanımlanır.

#### [MOD-08.7.7] Forms (Form Builder)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Form builder (alan sürükle-bırak / alan listesi).
- **Rota:** `/app/settings/forms`.
- **Form türleri:** pre-chat / post-chat / ticket / prospect (çıkarım — evidence: "pre-chat / post-chat / ticket / prospect forms field builder").
- **Mevcut Durumlar:** Default / Editing / Field-adding / Saving.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Sohbet öncesi/sonrası ve ticket formlarının alanlarını (name, email, konu, custom) tasarlar; widget'ta gösterilir, toplanan veri contact/ticket'a yazılır.
- **Validasyon ve Hata Senaryoları:** Zorunlu alan işaretleme; alan tipi validasyonu; en az bir alan.
- **Görsel & Metinsel İçerik:** "Forms".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Sohbet öncesi lead/bağlam toplama (isim, e-posta, konu).
- ➕ Nitelikli lead + yönlendirme için veri.
- ➖ Çıkarılırsa ziyaretçi anonim kalır; lead kalitesi düşer.
- 🛠️ `Aynen kalsın`. `Özelleştirilsin` — bahis senaryosunda yaş/sorumlu oyun onayı pre-chat formda.

### [MOD-08.8] Integrations

#### [MOD-08.8.1] Apps (Marketplace) — bkz. [MOD-09]

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Uygulama pazarı girişi.
- **Rota:** `/app/settings/integrations/apps`.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Üçüncü parti entegrasyon dizini; detay [MOD-09]'da.
- **Görsel & Metinsel İçerik:** "Apps".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Ürünü ekosisteme bağlar.
- ➕ CRM/e-ticaret/ödeme entegrasyonları.
- ➖ Çıkarılırsa izole ürün.
- 🛠️ `Aynen kalsın`.

#### [MOD-08.8.2] API Access (PAT / OAuth)

![API access — teknik](gorseller/teknik/01-settings-api-access.jpg)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Geliştirici erişim sayfası + sekmeler.
- **Rota:** `/app/settings/integrations/api-access/apis-sdks`.
- **Header:** "API access" + [API pricing ↗] + [Documentation ↗]. Tabs: **APIs & SDKs** | **Personal access tokens**.
- **"Get started" kartları:** Customize your chat / Chat as a customer / Pull data from Text. **Available APIs:** Reports API, Agent Chat API, Configuration API (+ Customer Chat API). Auth: **PAT + OAuth 2.1**.
- **Mevcut Durumlar:** Default / PAT-oluşturma / Token-oluşturuldu (bir kez gösterim).
- **Tetiklenen Eylem ve Sayfa Mantığı:** PAT üretir (kopyala, bir kez görünür); API dokümanlarına ve fiyatlandırmaya götürür. API call'lar billing sayacına yazılır ($29.50/100k extra).
- **Validasyon ve Hata Senaryoları:** Token revoke; kopyalanmazsa yeniden üretim gerekir.
- **Görsel & Metinsel İçerik:** "API access", "APIs & SDKs", "Personal access tokens", "Reports/Agent Chat/Configuration API".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Geliştiricilere programatik erişim (özel widget, entegrasyon, raporlama).
- ➕ Genişletilebilirlik + kurumsal entegrasyon.
- ➖ Çıkarılırsa ürün kapalı kutu olur.
- 🛠️ `Aynen kalsın`.

#### [MOD-08.8.3] MCP Server

![MCP server — teknik](gorseller/teknik/02-mcp-server.jpg)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** MCP bağlantı sayfası.
- **Rota:** `/app/settings/integrations/mcp`.
- **İçerik:** "Connect with AI assistants — Ask AI assistants about your Text data. Works with Claude, ChatGPT, and any MCP-compatible tool." **MCP server URL: `https://mcp.text.com/`** [Copy]. "Claude setup" (collapsible). Örnek prompt: "Find all tickets where customers ask about bulk orders".
- **Mevcut Durumlar:** Default / Copied / Setup-expanded.
- **Tetiklenen Eylem ve Sayfa Mantığı:** MCP sunucu URL'sini kopyalar; Claude, ChatGPT ve MCP uyumlu herhangi bir aracı Text verisine bağlar (doğal dil sorgu → veri).
- **Validasyon ve Hata Senaryoları:** Yetkilendirme/scope (çıkarım).
- **Görsel & Metinsel İçerik:** "Connect with AI assistants", "https://mcp.text.com/", "Claude setup".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Harici AI asistanlarının Text verisini doğal dille sorgulaması (yeni nesil entegrasyon).
- ➕ AI-öncelikli iş akışları; farklılaştırıcı özellik.
- ➖ Çıkarılırsa AI-native entegrasyon fırsatı kaçar.
- 🛠️ `Aynen kalsın` (rekabet avantajı).

### [MOD-08.9] Security (Güvenlik)

#### [MOD-08.9.1] Trusted Domains

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Domain allowlist (CRUD).
- **Rota:** `/app/settings/security/trusted-domains`.
- **Mevcut Durumlar:** Default / Adding / Empty.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Widget'ın çalışmasına izin verilen domainler; başka domainlerde widget engellenir (güvenlik/anti-abuse).
- **Validasyon ve Hata Senaryoları:** Geçersiz domain reddi.
- **Görsel & Metinsel İçerik:** "Trusted domains".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Widget'ın kötüye kullanımını (başka sitede gömülme) önler.
- ➕ Güvenlik + lisans koruması.
- ➖ Çıkarılırsa widget her yere gömülebilir.
- 🛠️ `Aynen kalsın`.

#### [MOD-08.9.2] Banned Customers

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Yasaklı ziyaretçi listesi.
- **Rota:** `/app/settings/security/banned-customers`.
- **Mevcut Durumlar:** Default / Adding / Empty.
- **Tetiklenen Eylem ve Sayfa Mantığı:** IP/ziyaretçi bazlı yasaklama; yasaklı ziyaretçi sohbet başlatamaz.
- **Validasyon ve Hata Senaryoları:** Geçerli IP/kimlik.
- **Görsel & Metinsel İçerik:** "Banned customers".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Taciz/spam yapan ziyaretçileri engeller.
- ➕ Ajan güvenliği; kötüye kullanım kontrolü.
- ➖ Çıkarılırsa kötü niyetli ziyaretçi engellenemez.
- 🛠️ `Aynen kalsın`.

#### [MOD-08.9.3] Spam

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Spam filtre ayarı.
- **Rota:** `/app/settings/security/spam`.
- **Mevcut Durumlar:** Default / Editing.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Spam sohbet/ticket'ları otomatik filtreler (kural/eşik — çıkarım).
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "Spam".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Gürültüyü azaltır; ajan zamanını korur.
- ➕ Verimlilik + temiz metrikler.
- ➖ Çıkarılırsa spam kuyruğu doldurur.
- 🛠️ `Aynen kalsın`.

#### [MOD-08.9.4] File Sharing

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Dosya paylaşım politikası ayarı.
- **Rota:** `/app/settings/security/file-sharing`.
- **Mevcut Durumlar:** Default / Editing.
- **Tetiklenen Eylem ve Sayfa Mantığı:** İzinli/yasaklı dosya türleri + boyut limitleri; composer attach ve müşteri yüklemesini kısıtlar.
- **Validasyon ve Hata Senaryoları:** İzinsiz tür/boyut reddi.
- **Görsel & Metinsel İçerik:** "File sharing".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Zararlı/büyük dosya riskini yönetir.
- ➕ Güvenlik + depolama kontrolü.
- ➖ Çıkarılırsa güvenlik açığı (malware yükleme).
- 🛠️ `Aynen kalsın`.

### [MOD-08.10] Billing (Settings İçinde) — bkz. [MOD-10]

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Faturalandırma grubu: Subscription (`/billing/subscription`), Payment details (`/payment-details`), Invoices (`/invoices`).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Abonelik yönetimi, ödeme yöntemi, fatura geçmişi. Tam akış [MOD-10]'da.
- **Görsel & Metinsel İçerik:** "Subscription", "Payment details", "Invoices".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Gelir/abonelik yönetimi.
- ➕ Self-servis fatura kontrolü.
- ➖ Çıkarılamaz.
- 🛠️ `Aynen kalsın`.

---
## [MOD-09] Apps Marketplace

![Apps marketplace](gorseller/fonksiyonel/14-apps-marketplace.jpg)

Rota: `/app/settings/integrations/apps`. Başlık: "Connect your tools with Text — Work with customer data and business tools without leaving conversations." Her entegrasyon bir kart (ikon + isim + açıklama + Connect/Install). OAuth app dizini.

### [MOD-09.1] Entegrasyon Kartları (Tam Liste)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Entegrasyon kartları gridi.
- **Kartlar (gerçek, tam enumerasyon):**
  1. **Messenger** — Facebook page mesajlarını chat olarak alır.
  2. **Twilio** — SMS gönder/al.
  3. **WhatsApp** — WhatsApp mesajlarını chat olarak alır.
  4. **HubSpot** — CRM senkronizasyonu (Sync CRM).
  5. **Mailchimp** — chat lead'lerini e-posta listelerine ekler.
  6. **Shopify** — sohbet sırasında sepet/sipariş görüntüleme.
  7. **Slack** — konuşma güncellemelerini Slack'e iletir.
  8. **Adobe Commerce** — e-ticaret entegrasyonu.
  9. **BigCommerce** — e-ticaret entegrasyonu.
  10. **Google Calendar** — sohbet sırasında randevu planlama.
  11. **Instagram** — Instagram DM'leri.
  12. **Medusa** — sohbette sipariş kapatma.
  13. **Salesforce** — CRM senkronizasyonu (Sync CRM).
  14. **Segment** — müşteri detay senkronizasyonu.
  15. **Stripe** — sohbette ödeme alma.
- **Mevcut Durumlar:** Default / Hover / Not connected / Connecting (OAuth) / Connected / Error.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Karta tıklayınca detay/izin ekranı; Connect → OAuth/API key akışı; bağlanınca ilgili veri sohbet içinde (Details panel/Copilot) görünür veya olaylar dışa akar. Kanal tipli olanlar (Messenger/Twilio/WhatsApp/Instagram) aynı zamanda Channels'ta yönetilir.
- **Validasyon ve Hata Senaryoları:** OAuth reddi; geçersiz API anahtarı; scope eksikliği.
- **Görsel & Metinsel İçerik:** "Connect your tools with Text", entegrasyon isimleri (yukarıda tam liste).

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Ürünü mevcut iş yığınına (CRM, e-ticaret, ödeme, takvim, veri) bağlar.
- ➕ Bağlam zenginliği (sohbette sipariş/ödeme/CRM); satış ve destek verimliliği.
- ➖ Çıkarılırsa ürün izole; ajan başka sekmelere geçmek zorunda kalır.
- 🛠️ `Özelleştirilsin` — klonda hedef müşteriye göre öncelik: bahis senaryosunda Stripe/ödeme + CRM + Segment öne; e-ticaret odaklı olanlar (Shopify, BigCommerce, Adobe Commerce, Medusa) MVP'de ertelenebilir. Çekirdek framework (OAuth app dizini) `Aynen kalsın`.

---
## [MOD-10] Billing / Subscription

![Manage subscription / pricing](gorseller/fonksiyonel/13-billing-subscription.jpg)

Rota: `/app/settings/billing/subscription/manage`. Yeni Text modeli: **koltuk-bazlı ($/user/mo) + tüketim (AI resolutions + API calls)**. Monthly/Annual toggle, 14 günlük trial.

### [MOD-10.1] Manage Subscription Sayfası

#### [MOD-10.1.1] Plan + Change Plan

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Plan başlığı + [Change plan] + geri ok.
- **İçerik:** "Manage subscription"; Plan **Growth plan** — "Starts on Jul 28, 2026" — [Change plan].
- **Mevcut Durumlar:** Default / Change-plan-open (plan tier seçimi).
- **Tetiklenen Eylem ve Sayfa Mantığı:** [Change plan] farklı plan seviyeleri (tier) arasında geçiş sunar; trial "Starts on" tarihiyle ilişkili.
- **Validasyon ve Hata Senaryoları:** Downgrade kısıtları (kullanım plandan yüksekse — çıkarım).
- **Görsel & Metinsel İçerik:** "Manage subscription", "Growth plan", "Starts on Jul 28, 2026", "Change plan".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Abonelik seviyesini yönetme.
- ➕ Self-servis plan değişimi; upsell/downgrade.
- ➖ Çıkarılamaz.
- 🛠️ `Aynen kalsın`.

#### [MOD-10.1.2] Billing Cycle (Monthly / Annual Toggle)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Dropdown/toggle (Monthly ▾ / Annual).
- **İçerik:** "Save $480 with annual plan".
- **Mevcut Durumlar:** Monthly / Annual (indirimli).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Aylık↔yıllık geçiş; yıllık seçilince toplam yeniden hesaplanır ve indirim ("Save $480") uygulanır.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "Monthly", "Save $480 with annual plan".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Yıllık taahhütle indirim; nakit akışı + elde tutma.
- ➕ Yıllık ödeme churn'ü azaltır, geliri öne çeker.
- ➖ Çıkarılırsa yıllık indirim kaldıraç kaybolur.
- 🛠️ `Aynen kalsın`.

#### [MOD-10.1.3] Users Stepper

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Sayısal stepper (+/−).
- **İçerik:** **$99/user/mo** — qty **2**.
- **Mevcut Durumlar:** Default / Increment / Decrement (min mevcut aktif kullanıcı sayısı — çıkarım).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Koltuk sayısını artırır/azaltır; toplam anında güncellenir (2 × $99 = $198/mo). Davet edilen üye sayısıyla senkron.
- **Validasyon ve Hata Senaryoları:** Aktif kullanıcı sayısının altına inilemez.
- **Görsel & Metinsel İçerik:** "$99/user/mo".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Koltuk = temel gelir kalemi; şeffaf ölçekleme.
- ➕ Büyümeyle doğrusal gelir.
- ➖ Çıkarılamaz.
- 🛠️ `Aynen kalsın`.

#### [MOD-10.1.4] AI Resolutions (Meter + Stepper)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Kullanım sayacı (usage meter) + stepper.
- **İçerik:** **$49.50 per 50 extra AI resolutions**; sayaç "**0 / 200 (0% used)**". (200 dahil.)
- **Mevcut Durumlar:** Default / Usage-bar (yüzde) / Over-limit (aşım).
- **Tetiklenen Eylem ve Sayfa Mantığı:** AI'ın çözdüğü konuşma (AI resolution) sayısını ölçer; 200 dahil, aşımda 50'lik paketler ($49.50). Reports'taki "Automated" chat sayısıyla ilişkilidir.
- **Validasyon ve Hata Senaryoları:** Aşım otomatik faturaya eklenir (çıkarım).
- **Görsel & Metinsel İçerik:** "AI resolutions", "$49.50 per 50 extra", "0 / 200 (0% used)".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 AI kullanımını değere (ödemeye) çeviren tüketim modeli.
- ➕ AI değeri ölçüldükçe gelir; adil kullanım-bazlı fiyat.
- ➖ Çıkarılırsa AI maliyeti/gelir ilişkisi kopar.
- 🛠️ `Aynen kalsın` (yeni iş modelinin kalbi).

#### [MOD-10.1.5] API Calls

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Katlanabilir tüketim kalemi.
- **İçerik:** **$29.50 per 100,000 extra API calls**.
- **Mevcut Durumlar:** Collapsed / Expanded / Usage.
- **Tetiklenen Eylem ve Sayfa Mantığı:** API kullanım hacmini ölçer; dahil kotayı aşınca 100k'lık paketler.
- **Validasyon ve Hata Senaryoları:** Aşım faturaya yansır.
- **Görsel & Metinsel İçerik:** "API calls", "$29.50 per 100000 extra API calls".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Programatik kullanımı da gelire çevirir.
- ➕ Ağır API kullanıcılarından adil gelir.
- ➖ Çıkarılırsa API maliyeti karşılanmaz.
- 🛠️ `Aynen kalsın`.

#### [MOD-10.1.6] Subscription Summary + Enter Payment Details

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Özet paneli + birincil buton.
- **İçerik:** "Subscription summary": 2 users $198/mo · Included usage (expand) · Total after trial **$198/mo** · Billed now **$0** · [Enter payment details] · "You'll be billed when your trial ends on Jul 28, 2026."
- **Mevcut Durumlar:** Default / Payment-form / Submitting.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Tüm seçimleri (kullanıcı, döngü, tüketim) toplayıp toplamı hesaplar; [Enter payment details] ödeme formunu açar. Trial boyunca $0; trial bitince tahsilat.
- **Validasyon ve Hata Senaryoları:** Ödeme kartı doğrulama (çıkarım). **NOT:** Gözlem paketinde ödeme bilgisi girmek yasaklanmıştır ("do not fill Enter payment details").
- **Görsel & Metinsel İçerik:** "Subscription summary", "Total after trial", "Billed now $0", "Enter payment details", "You'll be billed when your trial ends on Jul 28, 2026".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Şeffaf toplam + net "ne zaman ödeyeceğim" mesajı (güven).
- ➕ Dönüşümü kolaylaştırır; sürpriz yok.
- ➖ Çıkarılamaz.
- 🛠️ `Aynen kalsın`.

### [MOD-10.2] 14-Günlük Trial Mantığı

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Trial durumu (global rozet + billing bağlamı).
- **Mevcut Durumlar:** Active (gün sayısı) / Ending soon / Expired.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Kayıt anında 14 günlük trial başlar; global "8 days left" sayacı bitiş tarihine göre canlı; bitince ödeme zorunlu (uygulama kısıtlanır — çıkarım).
- **Validasyon ve Hata Senaryoları:** Trial bitip ödeme yoksa erişim kısıtı.
- **Görsel & Metinsel İçerik:** "8 days left in your trial. Subscribe now".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Kartsız deneme → değeri görüp ödemeye geçiş (PLG).
- ➕ Düşük sürtünmeli edinim.
- ➖ Çıkarılırsa self-servis dönüşüm zayıflar.
- 🛠️ `Aynen kalsın`.

---
## [MOD-11] Customer Widget (Müşteri Tarafı)

![Widget launcher demo sitede](gorseller/fonksiyonel/17-customer-widget-embedded.jpg)

![Müşteri widget'ı açık (greeting)](gorseller/fonksiyonel/18-customer-widget-open.jpg)

Müşteri tarafında, web sitesine JS snippet ile gömülen cross-origin iframe. Loader = async JS + `window.__lc` config (license-scoped). Demo sitesi: `livechat-demo.surge.sh`. Alt bilgi "Powered by text.com".

### [MOD-11.1] Launcher Bubble (Başlatıcı)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Yüzen başlatıcı balonu (sağ alt köşe).
- **Mevcut Durumlar:** Default (kapalı) / Hover / Unread (bildirim rozeti) / Open (widget açık).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Tıklayınca widget panelini açar/kapar; yeni proaktif mesaj/greeting gelince rozet/animasyon.
- **Validasyon ve Hata Senaryoları:** Trusted domains dışıysa yüklenmez.
- **Görsel & Metinsel İçerik:** Sohbet ikonu balonu.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Müşterinin desteğe girişi; her sayfada kalıcı.
- ➕ Erişilebilir, tanıdık desen.
- ➖ Çıkarılamaz.
- 🛠️ `Aynen kalsın`. `Özelleştirilsin` — marka rengi/konum (Customize widget).

### [MOD-11.2] Greeting Card + Quick Replies

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Karşılama kartı + hızlı yanıt butonları.
- **İçerik:** "Hello! Need a hand? We'll point you in the right direction" + quick replies **[Let's chat]** / **[Just browsing]**.
- **Mevcut Durumlar:** Default / Dismissed / Selected.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Proaktif karşılama (Campaigns/greeting motorundan); "Let's chat" sohbeti başlatır (gerekiyorsa pre-chat form), "Just browsing" kapatır/erteler. Greeting görseli `cdn.static-text.com/.../hello.png`.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "Hello! Need a hand? We'll point you in the right direction", "Let's chat", "Just browsing".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Ziyaretçiyi sohbete davet eder; niyet ayrıştırır (chat vs browse).
- ➕ Dönüşüm + düşük baskı; niyet sinyali.
- ➖ Çıkarılırsa proaktif karşılama kaybolur.
- 🛠️ `Aynen kalsın`. `Özelleştirilsin` — metin/quick reply seçenekleri kampanyaya göre.

### [MOD-11.3] Agent Identity (Kimlik)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Ajan/AI kimlik başlığı.
- **İçerik:** ör. "Product Expert" (AI Profile'dan gelen isim/persona).
- **Mevcut Durumlar:** Default / Typing / Online-offline.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Müşteriye kiminle konuştuğunu (AI persona veya insan ajan) gösterir; AI Agent Profile ([MOD-06.4]) ayarlarından beslenir.
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "Product Expert".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Güven + kişiselleştirme (kiminle konuşuyorum).
- ➕ Marka sesi + güven.
- ➖ Çıkarılırsa kişisellik kaybolur.
- 🛠️ `Aynen kalsın`.

### [MOD-11.4] Composer (Müşteri Yazım Alanı)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Mesaj girişi + araçlar (+attach, message, emoji, send).
- **Mevcut Durumlar:** Default / Typing / Sending / Disabled (kapalıysa).
- **Tetiklenen Eylem ve Sayfa Mantığı:** Müşteri mesaj yazıp gönderir (+ dosya ekler, emoji). Customer Chat API üzerinden ajan tarafına canlı iletilir. Dosya ekleme File sharing kurallarına tabi.
- **Validasyon ve Hata Senaryoları:** Boş mesaj gönderilemez; dosya tür/boyut limiti.
- **Görsel & Metinsel İçerik:** attach (+), mesaj alanı, emoji, send ikonları.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Müşterinin mesaj gönderme aracı.
- ➕ Zengin (dosya/emoji) iletişim.
- ➖ Çıkarılamaz.
- 🛠️ `Aynen kalsın`.

### [MOD-11.5] "Powered by text.com" (Marka Alt Bilgisi)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Marka bağlantısı (alt bilgi).
- **Mevcut Durumlar:** Default / Hover.
- **Tetiklenen Eylem ve Sayfa Mantığı:** text.com'a bağlantı; üst planlarda kaldırılabilir (white-label — çıkarım).
- **Validasyon ve Hata Senaryoları:** Yok.
- **Görsel & Metinsel İçerik:** "Powered by text.com".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Sağlayıcı markalaması + viral edinim.
- ➕ Ücretsiz pazarlama.
- ➖ Müşteri markası için istenmeyebilir.
- 🛠️ `Özelleştirilsin` — üst planlarda kaldırılabilir/white-label yapılır.

### [MOD-11.6] Embed Snippet (Kurulum)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Async JS snippet + `window.__lc` config.
- **Mevcut Durumlar:** Not-installed / Installed / Verified.
- **Tetiklenen Eylem ve Sayfa Mantığı:** `</body>` öncesine yerleştirilen snippet, license-scoped config ile iframe widget'ı yükler; RTM ile ajan tarafına bağlanır.
- **Validasyon ve Hata Senaryoları:** Yanlış license/domain → yüklenmez; Trusted domains kontrolü.
- **Görsel & Metinsel İçerik:** JS loader kodu.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Widget'ı siteye taşıyan teknik köprü.
- ➕ Tek satır kurulum; platform-bağımsız.
- ➖ Çıkarılamaz.
- 🛠️ `Aynen kalsın`.

---
## [MOD-12] Copilot (Ajan-Yardımcı AI)

![Copilot özeti — arşiv transcript içinde](gorseller/fonksiyonel/19-archive-chat-history.jpg)

AI Agent (müşteriyle konuşan) ile **Copilot** (ajanı destekleyen) iki ayrı AI varlığıdır. Copilot her sohbette erişilebilir; kendi bilgi tabanına sahiptir (`/app/team/ai-agents/copilot/knowledge`); sohbet özeti ve yanıt yardımı üretir. Sağ panelde "Copilot" sekmesi olarak açılır ([MOD-01.3]).

### [MOD-12.1] Copilot Butonu (Her Sohbette)

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** Panel sekmesi/butonu (sağ panelde "Copilot").
- **Mevcut Durumlar:** Default / Active (panel açık) / Generating (Loading) / Idle.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Copilot panelini açar; ajan, konuşma bağlamında AI'dan yardım ister (özet, yanıt önerisi, bilgi arama). Reply Suggestions ([MOD-02.3.2]) ile birlikte ajanı hızlandırır.
- **Validasyon ve Hata Senaryoları:** AI hatası → yardım üretilemez.
- **Görsel & Metinsel İçerik:** "Copilot".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 İnsan ajanı gerçek zamanlı destekleyen "yardımcı pilot".
- ➕ Yanıt kalitesi + hızı; yeni ajan eğitimi; "Assisted" chat metriğini besler.
- ➖ Çıkarılırsa ajan yalnız kalır; hız/kalite düşer.
- 🛠️ `Aynen kalsın`.

### [MOD-12.2] Copilot Knowledge Base

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** RAG bilgi tabanı (AI Agent Knowledge'a benzer).
- **Rota:** `/app/team/ai-agents/copilot/knowledge`.
- **Mevcut Durumlar:** Default / Empty / Managing.
- **Tetiklenen Eylem ve Sayfa Mantığı:** Copilot'un yanıt/özet üretirken kullanacağı ayrı bilgi kaynakları (müşteriye bakan AI Agent'tan bağımsız yönetilir).
- **Validasyon ve Hata Senaryoları:** Kaynak ekleme validasyonu (bkz. MOD-06.3.2).
- **Görsel & Metinsel İçerik:** "Copilot", "Knowledge".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Copilot'a şirket-içi/gizli bilgi (ajana özel prosedürler) verir.
- ➕ Ajan-özel bilgi (müşteriye açık olmayan) ile daha isabetli yardım.
- ➖ Çıkarılırsa Copilot genel bilgiyle sınırlı kalır.
- 🛠️ `Aynen kalsın`.

### [MOD-12.3] Özet ve Yanıt Yardımı

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** AI aksiyonları (summarize / reply help).
- **Mevcut Durumlar:** Idle / Generating / Output / Inserted / Error.
- **Tetiklenen Eylem ve Sayfa Mantığı:** "Summarize this chat as internal note" ([MOD-02.5]) ile özet; yanıt önerileri ([MOD-02.3.2]); bilgi tabanından yanıt taslağı. Çıktı internal note olarak eklenebilir veya composer'a yerleşir.
- **Validasyon ve Hata Senaryoları:** AI hatası → çıktı yok.
- **Görsel & Metinsel İçerik:** "Summarize this chat as internal note".

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Uzun sohbeti özetleme + yanıt yazma yükünü azaltma.
- ➕ Zaman tasarrufu + tutarlılık + vardiya devri.
- ➖ Çıkarılırsa manuel özet/yanıt.
- 🛠️ `Aynen kalsın`.

---

## EK-A. Çapraz Kesit — Form & Girdi Mantığı

Bu ek, modüllere dağılmış tüm form/girdi desenlerini tek yerde derler (zorunlu kapsam). Ortak desen: **istemci-tarafı anlık validasyon + geçerli girdi olmadan submit'in pasif kalması + Loading/Success/Error durumları**.

### EK-A.1 Form Envanteri (tam liste)

| Form | Modül | Ana Alanlar | Kritik Validasyon |
|---|---|---|---|
| Invite teammates | MOD-04.4 | Email(ler) textarea (virgülle çoklu), Role dropdown (Owner/Admin/Agent, default Admin) | En az bir geçerli email; geçersiz email submit'i bloklar |
| Add website | MOD-08.5.2 | Domain/URL | Geçerli domain; snippet doğrulaması ("Connected") |
| New campaign | MOD-03.3.2 | Tetikleyici koşulları + mesaj/greeting içeriği + zamanlama | Tetikleyici + mesaj zorunlu (çıkarım) |
| New skill (NL) | MOD-06.2 | Skill name + NL instruction + ordered steps | Boş isim/adım engeli; transfer hedefi zorunlu |
| New canned response | MOD-08.7.2 | Shortcut (#tag) + mesaj + grup kapsamı | Yinelenen shortcut engeli; boş mesaj engeli |
| Forms builder | MOD-08.7.7 | Alan ekleme (name/email/konu/custom), zorunluluk | En az bir alan; alan tipi validasyonu |
| Custom fields | MOD-08.7.6 | Alan adı + tip | Tip/zorunluluk kuralları |
| Global search (⌘K) | MOD-01.1.3 | Sorgu | Boş sorgu → öneriler; sonuç yok → empty |
| Contacts search | MOD-03.2.1 | name/email/phone | Sonuç yok → empty |
| Teammates search | MOD-04.3.2 | isim/email | Sonuç yok → empty |
| Skills search | MOD-05.4 | skill adı | Sonuç yok → empty |
| Payment details | MOD-10.1.6 | Kart bilgileri | Kart doğrulama (gözlemde girmek YASAK) |
| Login / Signup / Forgot password | MOD-00 | email/password | Format + kimlik + enumeration koruması |

### EK-A.2 Ortak Girdi Davranışları

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Arama alanları:** debounce'lı, server-side; boşta öneri/son öğeler, sonuç yoksa empty state.
- **Filtre butonları:** ([Filter] / "Open workflows filters menu") panel açar; çoklu ölçüt (rol/durum/tür/tarih).
- **Dropdown'lar:** Role (Owner/Admin/Agent), Message type (Reply/Note), Billing cycle (Monthly/Annual), Fallback team.
- **Stepper'lar:** Users, AI resolutions — anlık toplam güncelleme; alt sınır = mevcut kullanım.
- **Toggle'lar:** Skill active, kanal ON/OFF, bildirim tercihleri — anlık kaydetme (optimistic).
- **Mevcut Durumlar (genel):** Default / Focus / Filled / Validation-error / Disabled / Loading / Success.
- **Validasyon deseni:** submit yalnız geçerli minimum girdiyle aktifleşir; hata alan-altı mesajla gösterilir.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Tutarlı, öngörülebilir form deneyimi (öğrenme maliyeti düşük).
- ➕ Hata oranını düşürür; erişilebilirlik.
- ➖ Tutarsız uygulanırsa kullanıcı güveni düşer.
- 🛠️ `Aynen kalsın` — tek bir form/validasyon kütüphanesiyle standartlaştırılmalı.

---

## EK-B. Çapraz Kesit — Sayfalama & Yükleme Deseni

Zorunlu kapsam. Gözlem paketi notu: **grid'ler çıkarılabilir metin döndürmedi = virtualized** (sanal listeleme). Yani büyük tablolar/gridler DOM'a yalnız görünen satırları basar.

### EK-B.1 Yükleme ve Boş Durum Envanteri

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Virtualized grids (çıkarım, doğrulanmış davranış):** Contacts (13 satır ölçekli ama binlerce için sanal), Teammates, Skills, Tickets grid, Knowledge tablosu, Apps grid, Campaigns grid — hepsi sanal listeleme ile render (metin ekstraksiyonu boş dönmesi kanıt).
- **Infinite scroll / lazy load (çıkarım):** Uzun listeler (chat list, contacts, archive) kaydırıldıkça sayfa sayfa yükler.
- **Skeleton loaders (çıkarım):** Transcript, KPI kartları, gridler ilk yüklemede iskelet gösterir.
- **Empty states (gözlemlenen):**
  - Real-time: "Reach customers wherever they are… [Add more channels]".
  - Tickets: "Ticket views are unavailable. Please contact support if that's unexpected." (hata-empty).
  - Views/Channels: kanal bağlı değilse "channel-promo" ekranı.
  - Drafts (0), FAQ (0), Files (0), Scheduled (0), Inactive (0): sayaç 0 → boş liste.
- **Mevcut Durumlar:** Loading (skeleton) / Loaded / Empty / Error / Loading-more (infinite).

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Büyük veri setlerinde akıcı performans + net "boş/yükleniyor/hata" geri bildirimi.
- ➕ Sanal listeleme ölçek için zorunlu; skeleton algılanan hızı artırır; empty state onboarding fırsatı.
- ➖ Sanal listeleme olmadan büyük tablolar tarayıcıyı kilitler; empty state olmadan kullanıcı kaybolur.
- 🛠️ `Aynen kalsın` — grid'ler baştan virtualization + skeleton + anlamlı empty state ile inşa edilmeli.

---

## EK-C. Çapraz Kesit — Dinamik Yapılar (Realtime / Banner / Dropdown / Panel)

Zorunlu kapsam. Ürün büyük ölçüde **canlı (real-time)** ve **bağlamsal** bir deneyimdir.

### EK-C.1 Canlı (Real-time) Katman

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Element Tipi:** WebSocket RTM tabanlı canlı güncellemeler.
- **Kapsam:** Yeni sohbet → liste + sayaçlar (All/Queued/Unassigned) canlı artar; transcript canlı mesaj akışı; Real-time visitor tabları (Browsing→Chatting→Invited) canlı; presence (avatar grubu, teammate status Accepting/Offline); Duration/Visit duration sayaçları canlı; trial gün sayacı.
- **Mevcut Durumlar:** Connected / Reconnecting (çıkarım) / Live-update animasyonu.
- **Tetiklenen Eylem ve Sayfa Mantığı:** RTM olayları UI state'i push ile günceller (polling değil).

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 "Canlı destek" vaadinin teknik temeli.
- ➕ Anlık deneyim; sayfa yenilemeye gerek yok.
- ➖ Çıkarılırsa ürün "canlı" olmaktan çıkar.
- 🛠️ `Aynen kalsın` — WebSocket RTM zorunlu altyapı.

### EK-C.2 Banner'lar, Dropdown'lar ve Sağ Panel

**① TEKNİK VE FONKSİYONEL ÖZELLİKLER**
- **Bildirim/promo banner'ları:** Inbox "Take tour", Reports "Top chat topics", trial "8 days left", Website "Connect the widget" — dismiss/CTA'lı.
- **Hover/click dropdown'lar:** Create skill ▾, Message type, Role, Billing cycle, sort, run log (N run ▾), satır "…" menüleri.
- **Sağ Details/Copilot paneli:** Tüm uygulamada kalıcı ([MOD-01.3]); Details (müşteri meta) ↔ Copilot (AI) geçişi; genişletilebilir.
- **Modallar:** Invite teammates, Change plan, Add website, kaynak ekleme.
- **Mevcut Durumlar:** Open/Closed, Hover, Active, Collapsed/Expanded.

**② KULLANICI DEĞERLENDİRME VE PLANLAMA NOTU**
- 💡 Bağlamı koruyarak (sayfa değiştirmeden) aksiyon ve bilgi sunar.
- ➕ Verimlilik + düşük bağlam-değiştirme maliyeti; onboarding banner'ları aktivasyon.
- ➖ Aşırı banner dikkat dağıtır; tutarsız dropdown/panel deneyimi kafa karıştırır.
- 🛠️ `Aynen kalsın` — panel/dropdown/modal davranışları tek tasarım sistemiyle standartlaştırılmalı; banner'lar segmentli ve kapatılabilir olmalı.

---

## 4. Kapanış Notu (Klonlama Öncelik Sırası)

Bu belge Text App'in fonksiyonel anatomisini MOD-00 … MOD-12 + EK-A/B/C olarak eksiksiz haritalar. Klonlama için önerilen minimum çekirdek (MVP) sırası **(çıkarım)**:

1. **MOD-00 + MOD-01** — Auth + global shell (SPA iskeleti, RTM bağlantısı).
2. **MOD-02 + MOD-11** — Inbox 3-pane + müşteri widget (canlı sohbet çekirdeği; WebSocket RTM).
3. **MOD-08.5.2 + MOD-08.9.1** — Website widget kurulumu + Trusted domains.
4. **MOD-04 + MOD-08.6** — Teammates/roller/teams + chat routing.
5. **MOD-06 + MOD-05 + MOD-12** — AI Agent (skill editörü + RAG Knowledge) + Playbook + Copilot (ürünü farklılaştıran AI katmanı).
6. **MOD-03 + MOD-07** — Contacts/Campaigns + Reports (özellikle Manual/Assisted/Automated split).
7. **MOD-10** — Koltuk + tüketim (AI resolutions/API calls) faturalandırma + 14 günlük trial.
8. **MOD-08 kalanı + MOD-09** — Diğer kanallar, inbox araçları, güvenlik, apps marketplace.

Not: Bahis/casino senaryosuna özel `Özelleştirilsin` kararları (KYC/withdrawal/responsible-gambling skill ve canned response'ları, player custom field'ları, Telegram/WhatsApp kanal önceliği, yaş/sorumlu-oyun pre-chat formu) ilgili modüllerde işaretlenmiştir.

*(Belge sonu.)*
