# LiveChat (my.livechatinc.com) — BFS Keşif Raporu

- Tarih: 2026-10-14
- Oturum: kullanıcının Chrome oturumu (Claude in Chrome), lisans #19985624
- Yöntem: BFS — her sayfadaki tüm tıklanabilir öğeler sırayla açıldı; modal/akışlar son adıma kadar götürüldü.
- **Güvenlik kuralı:** Canlı hesapta geri alınamayan işlemler (gönder / kaydet / sil / satın al / mesaj gönder / davet gönder) **tıklanmadı**. Bu öğeler `⛔ onay bekliyor` olarak işaretlendi; durumları (aktif/pasif, doğrulama) yine raporlandı.

Durum etiketleri: ✅ test edildi · ⛔ onay bekliyor (tetiklenmedi) · ⚠️ edge-case / bulgu · ↗ dış link · 🔒 plan/trial kilidi


## İçindekiler
1. [Hesapta oluşan yan etkiler](#yan-etkiler)
2. [Bölümler arası ortak bulgular](#ortak)
3. [Onboarding / Kod kurulumu (`/install-code`)](#s0)
4. [Home, üst bar, Chats](#s1)
5. [Engage, Automate](#s2)
6. [Archives, Team, Reports](#s3)
7. [Apps, HelpDesk, Billing](#s4)
8. [Settings](#s5)

<a id="yan-etkiler"></a>
## Hesapta oluşan yan etkiler (dürüst döküm)
Gönder / kaydet / sil / satın al / bağlan işlemleri yapılmadı. Ancak aşağıdakiler gezinti sırasında oluştu:

| # | Ne oldu | Nerede | Kalıcı mı? |
|---|---|---|---|
| 1 | "Quality of customer support" toggle'ı ~1 sn kapatılıp tekrar açıldı (anında kaydeden ayar) | Settings › Chat page › Customization | Son değer orijinal (ON); sunucuya 2 kayıt isteği gitmiş olabilir |
| 2 | İki ürün turu tamamlandı; Home checklist'te "Preview widget", "Ask Copilot" tamamlandı işaretlendi | Home | Evet (onboarding ilerlemesi) |
| 3 | Copilot'a otomatik mesajlar gitti ("Train me with sources" + Automate Overview'daki 4× "Tell me more") | Copilot (iç asistan) | Copilot geçmişinde; ziyaretçi/kişilere bir şey gitmedi |
| 4 | Geliştirici davet linki üretildi (Copy invite link) — kimseye gönderilmedi | Install-code / Invite | 13 günde kendiliğinden geçersiz |
| 5 | "Empty workflow" ile `untitled_445` taslağı oluşmuş olabilir | Automate › Workflows | Belirsiz; listede görünmüyor |
| 6 | Test davet taslakları (example.com / "not-an-email") localStorage'da kaldı, sonra temizlendi | Invite modalı | Temizlendi bildirildi |
| 7 | Sepette Google Analytics eklentisi duruyor (ajan eklemediğini, varsayılan olduğunu bildirdi) | Apps › Cart | Mevcut |

<a id="ortak"></a>
## Bölümler arası ortak bulgular
- ⚠️ **Onboarding kapısı:** Kod kurulu olmadığı için `/home`, `/chats`, `/team`, `/reports`, `/apps`, `/settings`… her **tam sayfa yüklemede** `/install-code`'a yönleniyor; deep link'ler çalışmıyor, hedef adres kayboluyor. Yalnız `/subscription` muaf. "Skip" ya da "I don't want to chat yet" geçici; uygulama içi gezinme etkilenmiyor.
- ⚠️ **"Unsaved changes" uyarısı tutarsız:** Hiç değişiklik yokken çıkıyor (kampanya editörü, Billing manage), değişiklik varken çıkmıyor (Goals ←, Chatbots Cancel, Workflows X, profil sayfası, Inactivity timeouts, Sales tracker).
- ⚠️ **Doğrulama tutarsız:** URL alanları bir yerde "notaurl"u reddediyor, başka yerde "abc"yi kabul ediyor; IP/domain alanlarında canlı hata yok; değerler sessizce kırpılıyor (opaklık 250→%2, chat limit 1–20, koltuk 0→1 / 99999→999); negatif satış değeri kabul ediliyor; sadece boşluktan oluşan adlarla kaydet aktif.
- ⚠️ **Davet modalı:** Varsayılan rol en yetkili "Admin (billing access)"; aynı e-posta iki kez yazılınca Send yine aktif; taslaklar Cancel sonrası da kalıyor.
- ⚠️ **Gizlilik:** Ajan e-postası URL'de (`agent[]=`, `/team/agent/<e-posta>`) ve 3. taraf Beamer (News) linkinde; Help Center linklerine `_fbp`, `__hutk`, `__hstc`, `_gl` takip parametreleri ekleniyor.
- ⚠️ **Başlık / aktif menü bayat:** Settings'te sayfa başlığı ve seçili menü öğesi bir önceki sayfada kalıyor; Apps detayında aktif sekme bir geride.
- ⚠️ **Esc davranışı:** İç popover açıkken Esc üst modalı da kapatıyor → girilen veri kayboluyor.
- ⚠️ **Yükleme durumları:** Reports breakdown tablolarında "Loading..." satırı kaybolmuyor; Insights altındaki 2 rapor sonsuz spinner; Invoices "Failed to fetch invoices"; Apps'te sonuçsuz arama boş alan gösteriyor.
- ⚠️ **Install kodu görseli** (Settings › Install) farklı bir lisans numarası (100170061) gösteriyor; Copy code doğru kodu (19985624) kopyalıyor.
- ⚠️ **Yazım / içerik:** "Set offer of the right reply…" (Chats turu), "URL adresses" (Routing rules), Starter kartında Text Intelligence yazıyor ama tabloda yok, "+11" rozeti vs 14 entegrasyon.
- 🔒 **Plan kilitleri:** 7 rapor Business plan; Chatbot "Custom answers" Premium; chatbot web taraması 200 sayfa; konuma göre routing kilitli; benchmark kilitli.

## Erişilemeyenler (hesap durumu nedeniyle)
Gerçek sohbetler (kuyruk, transfer, supervise), arşiv sohbet detayı/transcript/export, Traffic ziyaretçi listesi (widget kurulu değil), faturalar, kayıtlı hedef/chatbot/kaynak/routing kuralı detayları, Ticket form builder (HelpDesk kapalı), 2FA/SSO (accounts.livechat.com'da), ödeme/kurulum/bağlama adımları.

---

<a id="s0"></a>
---

## A0. Giriş / Yönlendirme

| Durum | Davranış |
|---|---|
| `/home` açılınca | Kurulum tamamlanmadığı için `/install-code` adresine yönlendiriliyor (title: "Install LiveChat code"). |
| Uygulama kabuğu | DOM'da gizli olarak "Upgrade now", "Discover Text App", "Invite" butonları mevcut → ana uygulama kabuğu onboarding'in arkasında yüklü. |

## A1. `/install-code` — Kod kurulum (onboarding)

### 1.1 Sayfa içeriği
- Başlık: "Start using LiveChat on your website now"
- Kart "Add the code manually": "Paste the code before the </body> tag on every page." + kaydırılabilir kod kutusu (lisans 19985624, `integration_name = "manual_onboarding"`, `tracking.js` CDN, `<noscript>` "Chat with us" linki).
- Butonlar: **Copy code**, **Invite your developer**, **Install guide**
- "Other ways to install": **Connect with Google Tag Manager** (akordeon), **More integrations** (+11)
- Alt link: **I don't want to chat yet**
- Sağ altta turuncu sohbet balonu (LiveChat'in kendi destek widget'ı, "New message").

### 1.2 Invite your developer (aynı URL'de alt ekran)
- Başlık: "Invite the developer to connect LiveChat for you."
- Öğeler: e-posta inputu (placeholder `eg. developer@example.com`), **Send invite**, **Copy invite link**, **Skip**
- Durumlar:
  - Boş input → **Send invite pasif** ✅
  - `abc` girip blur → kırmızı çerçeve + "Enter a valid email address" ✅
  - Geçerli e-posta → Send invite aktif olur ✅ ⛔ (gönderilmedi)
  - Copy invite link hover tooltip: "Share this link to invite people to LiveChat. Link expires in 13 days" ✅
- ⚠️ Edge-case'ler:
  - Input `type="text"` (email değil), `maxLength` yok → mobilde e-posta klavyesi açılmaz, sınırsız uzunluk girilebilir.
  - Doğrulama yalnız **blur**'da yeniden çalışıyor: hata mesajı, geçerli e-posta yazılırken bile focus çıkana kadar ekranda kalıyor.
  - Odak inputa otomatik geliyor (autofocus).
  - **Copy invite link** tıklanınca görsel geri bildirim (toast / "Copied") yok ⚠️ — kullanıcı kopyalandığını anlayamıyor.
  - **Skip** → `/home` (ana uygulama) açılıyor ✅. ⚠️ Fakat Skip kalıcı değil: sayfa yeniden yüklendiğinde / yeni sekmede `/home`, `/team`, `/settings` vb. açılınca tekrar `/install-code`'a yönlendiriyor (kod kurulana kadar onboarding her yüklemede araya giriyor).

### 1.3 Kod kartı butonları
| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Copy code | buton | Kodu panoya kopyalar; tıklandıktan sonra yanında yeni **Check status** butonu beliriyor | ✅ (ayrı bir "Copied" toast'u yok ⚠️) |
| Check status | buton (Copy code sonrası görünür) | Sitede kurulum kontrolü yapar → sarı uyarı kutusu: "⚠ Code not installed." | ✅ |
| Invite your developer | buton | Bkz. 1.2 | ✅ |
| Install guide | buton | Yeni sekmede ↗ `https://www.livechat.com/help/setting-up-livechat-on-your-website/` açar | ✅ ⚠️ URL'ye `utm_source=webapp`, `landing_page`, `_fbp`, `__hutk`, `__hstc`, `_gl` takip parametreleri ekleniyor |
| Kod kutusu | kaydırılabilir `<pre>` | Fare tekerleği sayfa yerine kutunun içini kaydırıyor | ✅ |

### 1.4 Other ways to install
- **Connect with Google Tag Manager** (akordeon) ✅ → açılınca: **Connect** (⛔ OAuth, tetiklenmedi) ve **Install guide** (↗ `https://www.livechat.com/help/google-tag-manager/`).
- **More integrations** (akordeon, rozet "+11") ✅ → açılınca 14 seçenek: WordPress, Shopify, WooCommerce, BigCommerce, Ecwid, Adobe Commerce (Magento), SquareOnline, Squarespace, Wix, Webflow, Weebly, Joomla, Drupal, Segment.
  - "Connect with WordPress" → yeni sekmede ↗ `https://wordpress.org/plugins/wp-live-chat-software-for-wordpress/` ✅ (diğerleri de aynı şekilde platformun eklenti/uygulama sayfasına dış link olarak davranıyor; tek tek doğrulanmadı).
- ⚠️ Akordeonlar birbirini dışlıyor: biri açılınca diğeri kapanıyor.
- ⚠️ Rozet "+11" diyor ama listede 14 entegrasyon var (sayı tutarsızlığı; "logolarda görünen 3 + 11" mantığı olabilir).
- **I don't want to chat yet** (buton) ⛔ — onboarding'i kalıcı kapatma ihtimali nedeniyle tetiklenmedi.
- Sağ alt **New message** / turuncu balon: LiveChat'in kendi destek sohbeti (mesaj gönderilmedi ⛔).

---


---
<a id="s1"></a>

# 01 — Home + Üst bar / sol ray ekstraları + Chats

> Lisans 19985624 (trial). Keşif tarihi: 2026-10-14. Etiketler: ✅ test edildi · ⛔ onay bekliyor (tetiklenmedi) · ⚠️ bulgu · ↗ dış link · 🔒 plan/trial kilidi

## Kurulum kapısı / Onboarding (https://my.livechatinc.com/install-code)

### İçerik
- ⚠️ `/home` ve `/chats` doğrudan açıldığında uygulama **/install-code** sayfasına yönlendiriyor (widget kodu web sitesine kurulmamış olduğu için onboarding kapısı). Sol ray ve üst bar DOM'da mevcut (Home, Chats, Engage, Automate, Archives, Team, Reports, Apps, HelpDesk, Billing, Settings, News, My Profile "A", Upgrade now, Discover Text App, Invite) ama bu ekranda görünmüyor — sayfa tam ekran onboarding.
- ⚠️ Kapı tutarsız davranıyor: aynı anda diğer sekmelerde /subscription, /automate, /engage/traffic, /settings/code açılabiliyor; /home bazen açılıyor bazen tekrar /install-code'a düşüyor.
- Başlık: **"Start using LiveChat on your website now"** ("now" kelimesi mor→pembe gradyan).
- Kart: **"</> Add the code manually"** — "Paste the code before the </body> tag on every page."
- Kod kutusu (kaydırılabilir, monospace): 
  ```
  <!-- Start of LiveChat (www.livechat.com) code -->
  <script>
      window.__lc = window.__lc || {};
      window.__lc.license = 19985624;
      window.__lc.integration_name = "manual_onboarding";
      window.__lc.product_name = "livechat";
      ;(function(n,t,c){ ... n.src="https://cdn.livechatinc.com/tracking.js" ... }(window,document,[].slice))
  </script>
  <noscript><a href="https://www.livechat.com/chat-with/19985624/" rel="nofollow">Chat with us</a>, powered by <a href="https://www.livechat.com/?welcome" ...>LiveChat</a></noscript>
  <!-- End of LiveChat code -->
  ```
- Kart altı butonlar: **Copy code** (siyah, birincil), **Invite your developer**, **Install guide**.
- "Other ways to install" başlığı altında iki akordeon:
  1. **Connect with Google Tag Manager** (GTM ikonu) → açılınca: "Connect with Google Tag Manager" + **Connect** butonu + **Install guide** linki.
  2. **More integrations** (WordPress, Shopify, WooCommerce ikonları + "+11") → açılınca 14 öğe: Connect with WordPress, Shopify, WooCommerce, BigCommerce, Ecwid, Adobe Commerce (Magento), SquareOnline, Squarespace, Wix, Webflow, Weebly, Joomla, Drupal, Segment.
- En altta: **I don't want to chat yet** (ikincil buton).
- Sağ altta turuncu LiveChat destek balonu (DOM'da "Open chat", "Dismiss" butonları).

### Öğeler & durumlar
| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Copy code | Buton | Kodu panoya kopyalar | (bkz. aşağı) |
| Invite your developer | Buton | Aynı URL'de tam ekran "Invite the developer" adımına geçer (modal değil, role=dialog yok) | ✅ |
| Install guide (kod kartı) | Buton | ↗ Yeni sekmede https://www.livechat.com/help/setting-up-livechat-on-your-website/?utm_source=webapp&landing_page=… | ↗ (diğer sekme gözlemi) |
| Connect with Google Tag Manager | Akordeon | Genişler/daralır; Connect + Install guide gösterir | ✅ |
| GTM > Connect | Buton | Google OAuth/GTM bağlantısı başlatır | ⛔ tetiklenmedi |
| GTM > Install guide | Link | ↗ https://www.livechat.com/help/google-tag-manager/?utm_source=webapp… | ↗ |
| More integrations | Akordeon | 14 entegrasyonu listeler (öğeler `div role=button`, href yok) | ✅ |
| Connect with WordPress | Satır | ↗ Yeni sekme: https://wordpress.org/plugins/wp-live-chat-software-for-wordpress/ | ✅ ↗ |
| Diğer 13 entegrasyon | Satır | Muhtemelen ilgili marketplace/yardım sayfasını yeni sekmede açar (href DOM'da yok, JS ile) | ↗ tıklanmadı |
| I don't want to chat yet | Buton | Onboarding'i atlar (hesap durumunu değiştirir; tüm ajanları etkiler) | ⛔ tetiklenmedi |
| Destek balonu | Floating buton | LiveChat'in kendi destek sohbetini açar | (bkz. Global bölüm) |

### Invite the developer adımı
**İçerik:** Başlık "Invite the developer to connect LiveChat for you." · e-posta alanı (placeholder "eg. developer@example.com", type=text, maxlength yok) · **Send invite** · **🔗 Copy invite link** · **Skip**.

| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| E-posta alanı | Text input | Açılışta otomatik odaklı; blur'da doğrulanır | ✅ |
| Send invite | Buton | Boş/geçersizken disabled (gri); geçerli e-posta + blur sonrası aktif (siyah) | ⛔ tıklanmadı |
| Copy invite link | Link-buton | Hover tooltip: "Share this link to invite people to LiveChat. Link expires in 13 days". Tıklayınca etiket "Copied!" olur | ✅ |
| Skip | Buton | Kurulum ekranına geri döner (bkz. aşağı) | — |
| Esc | Klavye | Hiçbir etkisi yok | ✅ |

**Edge-case / bulgular**
- ✅ "abc" → blur'da kırmızı çerçeve + "Enter a valid email address".
- ✅ "a@b.c, x@example.com" (çoklu) → "Enter a valid email address" (tek adres kabul ediyor).
- ✅ 247 karakterlik adres → "Email must have max 100 characters"; Send invite disabled.
- ⚠️ Geçersiz bir değerden sonra geçerli e-posta yazılırken hata mesajı yazma sırasında kalıyor, ancak blur sonrası temizleniyor (doğrulama yalnızca blur'da güncelleniyor).
- ⚠️ Kopyalanan davet linki 13 gün geçerli — bu tıklama sunucuda bir davet tokenı üretiyor olabilir.

**Skip (Invite the developer adımında)** ✅ → uygulama içinde `/home`'a geçirir.
- ⚠️ `/home` tam yenilendiğinde (F5 veya URL'ye doğrudan gitme) tekrar `/install-code`'a yönlendiriliyor. Kapıyı geçmenin pratik yolu: Invite your developer → Skip. Uygulama içinden sol ray ile (SPA) gezinirken kapı tetiklenmiyor.
- ⚠️ Not: Sağ altta DOM'da görülen "Open chat" / "Dismiss" butonları LiveChat'e değil, Claude tarayıcı uzantısının "Claude is active in this tab group" katmanına ait.

---

## Home (https://my.livechatinc.com/home)

### İçerik
- Sol kart: "Hello azzatenli!" + başlık **"Let's get you started with LiveChat"**. Akordeon tarzı kontrol listesi (aynı anda tek madde açık; madde başlığına tıklayınca açılır, sağda `>` ok). Tamamlanan maddeler yeşil ✓ ve üstü çizili.
- Sağ panel: açık olan maddeye göre değişen illüstrasyon (mock UI).
- Kontrol listesi maddeleri (tam metinler):

| # | Başlık | Açıklama | Butonlar | Sağ illüstrasyon | Durum |
|---|---|---|---|---|---|
| 1 | Try out your chat workspace in a sample chat | See how conversations flow and explore tools that help you respond faster and assist customers effectively. | **Go to sample chat** | "Tina Cornell" sohbet mock'u ("Hi, Tina!👋 How can I help you today?" / "Hi! Do you have any 100,000mAh power banks available?") | ✅ zaten tamamlanmış |
| 2 | Preview and customize your chat widget | Match it to your brand's look and feel by customizing it directly on your site. Access more options in the settings. | **Preview widget** · **drboolum.org ✏️** | "Hello, nice to see you back!" widget mock + Joe sohbeti, "Chat now", "Follow us on Instagram" | Preview widget'a tıklayınca ✅ oldu |
| 3 | Test your chatbot's knowledge | Try a question and watch your chatbot provide answers using your website's content. | **Test chatbot** (disabled) · **Add chatbot** | "ChatBot" mock: "Hi, I'm looking for leather furniture for my home." → "What are you looking for?" [Chairs][Sofas][Bean Bags] → "Here are options you may like:" ürün kartları (Serene Sofa Set, EcoZen Sofa, Zenith Bed, "Add to cart") | tamamlanmamış |
| 4 | Chat with Copilot, your AI assistant | Get instant assistance with setup, learn about features, and track your team's performance - all in one place. | **Ask Copilot** · **Start product tour** | Copilot mock: "What was my license performance last week?" 1. Number of total chats increased by 7% 2. Satisfaction dropped by 1 pp 3. Response time increased by 3 s 4. Missed chats dropped by 4% 5. Efficiency increased by 85.0; çipler "How to set up LiveChat?", "How to automate my sales?", "Do we ship to Japan?"; "Your message" + Ask | Ask Copilot sonrası ✅ |
| 5 | Invite teammates | Bring your team to LiveChat. Companies of your size usually add 5 people. | **Invite** · **👥 0/5 recommended users invited** · **Skip** | "+ Invite teammate" mock + Maria Collins, Connor Smith, Jon Morrison, Mia Thomson | tamamlanmamış |
| 6 | Connect LiveChat to your site | See who's browsing your site and let customers reach out to you in real time. | **Connect LiveChat** · **Invite your developer** | Ziyaretçi trafiği tablosu mock (Jenny Wilson, j.wilson@email.com, "Pick from queue", "Start chat", "Supervise chat", bayraklar) | tamamlanmamış |
| 7 | Drive more chats with automated campaigns | Capture visitors' attention with personalized campaigns that encourage them to start a chat. | **Manage campaigns** (madde tamamlanınca gizleniyor) | Kampanya mock ("…offers on our stylish watch bestsellers." / "Start shopping") | ⚠️ keşif sırasında (başka ajanların Engage çalışmasıyla) ✅ oldu |
| 8 | Add more channels | Reach more customers. One or more channels will expand your customer base | Facebook Messenger **Add** · WhatsApp Business **Add** · Twilio **Add** · Telegram **Add** · **Skip** | "Chats › My chats (3)" mock: Tina Cornell (Messenger, 15s), Sophie Osaka (Instagram, 30s) | tamamlanmamış |

### Öğeler & durumlar
| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Madde başlıkları | Akordeon | Tıklayınca açılır, diğeri kapanır; sağ illüstrasyon değişir | ✅ |
| Go to sample chat | Buton | Chats'teki örnek sohbete gider (bkz. Chats bölümü) | ✅ |
| Preview widget | Buton | Grup içinde yeni sekme görünmedi (site önizlemesi ayrı pencerede açılıyor ya da popup engellendi); madde 2 anında "tamamlandı" oldu | ✅ ⚠️ |
| drboolum.org ✏️ | Buton | Satır içi düzenleme: URL input + **Save** (değişiklik yokken disabled) + **Cancel** | ✅ |
| URL input | Text | Boş → "The value cannot be empty"; "not a url !!" → "The value must be a valid URL" (ikisinde Save disabled); "example.com" → Save aktif. Esc etkisiz. Cancel → eski değere döner | ✅ / Save ⛔ |
| Test chatbot | Buton | **disabled**; hover tooltip: "You have no chatbots to test" | ✅ |
| Add chatbot | Buton | `/automate/chatbots`'a gider | ✅ |
| Ask Copilot | Buton | Copilot panelini açar (bkz. Global > Copilot); madde 4 ✅ olur | ✅ |
| Start product tour | Buton | 6 adımlı ürün turu (aşağıda) | ✅ |
| Invite (madde 5) | Buton | "Invite people to LiveChat" modalı (bkz. Global > Invite) | ✅ |
| 0/5 recommended users invited | Buton/rozet | Hover tooltip "No agents invited to your license" | ✅ |
| Skip (madde 5 / madde 8) | Buton | Maddeyi kalıcı olarak atlar | ⛔ tetiklenmedi |
| Connect LiveChat | Buton | /install-code kurulum ekranı (beklenen) | tıklanmadı |
| Invite your developer (madde 6) | Buton | "Invite the developer…" ekranı | ✅ (kapıda test edildi) |
| Manage campaigns | Buton | Engage > Campaigns (beklenen) | — |
| Add (4 kanal) | Buton | İlgili Settings kanal sayfası (örn. /settings/facebook-messenger) | Settings kapsamı |

### Ürün turu ("Start product tour") ✅
Arka plan kararır, sol raydaki ilgili ikon vurgulanır; ilk 2 adımda kullanıcının vurgulanan ikona **tıklaması** gerekiyor, sonra popover çıkıyor. URL tur boyunca `/home`.
0. Karşılama balonu: "Hi, welcome to your free trial!" / "Ready to explore? Take a quick product tour to see how LiveChat can boost your support and sales in no time." → **Let's dive in**
1. (Chats ikonu) **Step into the Chats section** — "This is your main workspace: see all your conversations, chat in real time, and supervise agents and chatbots." — Next · Skip all · 1 / 6 steps
2. (Engage ikonu) **Engage your website visitors** — "Monitor your website traffic, reach out to customers browsing your site, or set up automatic campaigns to invite them to chat." — 2 / 6
3. (Automate ikonu) **Automate and supercharge your work** — "We have set up a chatbot to handle chats for you! You can also get reply suggestions based on your knowledge sources, automate tagging, and more!" — 3 / 6
4. **Fine-tune your settings** — "Style the chat widget your customers see on your website to match your brand's look and feel." — 4 / 6
5. **Search bar: your command center** — "Access everything you need—navigate LiveChat, ask Copilot, search Archives, and perform actions without missing a beat." — 5 / 6
6. **Got questions? I've got answers!** — "I'm Copilot, your AI assistant, and I'm always here to help with setup, metrics or your own business." — **Finish** (Skip all yok) · 6 / 6

### Edge-case / bulgular
- ⚠️ Tur 3. adımı "We have set up a chatbot to handle chats for you!" diyor; Home madde 3 ise "You have no chatbots to test" — tutarsız.
- ⚠️ Kontrol listesi durumu sunucu tarafında ve paylaşımlı; başka kullanıcı/ajan eylemleri maddeleri otomatik tamamlıyor.
- ⚠️ "Preview widget" ve "Ask Copilot" sadece tıklamayla madde "tamamlandı" sayılıyor.
- "Hello azzatenli!" — kullanıcı adı e-postanın yerel kısmından türetilmiş görünüyor.

---

## Global üst bar ve sol ray ekstraları (tüm sayfalarda)

### Yerleşim
- **Sol ray (yukarıdan aşağı):** Ürün logosu (tooltip "Switch product") · Home · Chats · Engage · Automate · Archives · Team · Reports · Apps · HelpDesk · Billing (/subscription) · Settings (kırmızı "!" rozeti, tooltip "Settings") · News (zil ikonu) · Avatar "A" (yeşil durum noktası).
- **Üst mavi şerit (trial banner):** kutucuklu sayaç **"1 4 days left in your trial."** + **Upgrade now** butonu (role=status). /subscription sayfasında şerit görünmüyor.
- **Üst siyah bar:** ortada **Search [Ctrl] [K]** · sağda **(A) 1** (kabul eden ajan göstergesi) · **+ Invite** · en sağda **Copilot** ikonu (okunmamış kırmızı nokta; Copilot açıldıktan sonra kayboldu).

### Ürün değiştirici (logo)
- Menü: **LiveChat ⓘ** (tooltip: "14 days left in your trial. Time to upgrade.") · **ChatBot** · **HelpDesk** · ayırıcı · **Text Accounts** · alt bilgi "powered by text|".
- Bağlantılar: LiveChat/ChatBot/HelpDesk/Text Accounts → ↗ https://accounts.livechat.com/ (sorgu parametreli SSO yönlendirme); "powered by" → ↗ https://www.text.com/ . Esc ile kapanır. ✅ (dış linkler takip edilmedi)

### Trial banner — Upgrade now
| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Upgrade now | Buton | `/subscription` plan seçimi: "Choose your plan", Annual (save up to 17%) / Monthly radyo; Starter $19, Team $49 (CURRENT TRIAL rozeti), Business $79 ("Recommended for businesses of your size"), Enterprise "Let's talk / Request a call", "See all features". Ayrıntı Billing bölümünde. | ✅ gezinme / Choose plan ⛔ 🔒 |

### (A) 1 göstergesi
- Hover tooltip: **"Accepting chats: 👥 1 agent"**. Tıklayınca `/team` (Agents listesi) açılır. ✅

### + Invite (üst bar)
- Açılır menü: **Set up ChatBot** (→ `/automate/chatbots`) ✅ · **Invite teammate** (→ "Invite people to LiveChat" modalı) ✅

#### "Invite people to LiveChat" modalı
- Sütunlar **Email addresses** | **Role**. 4 sabit satır; placeholder'lar: "Eg. chatting.agent@outlook.com", "Eg. team.leader@outlook.com", "Eg. marketer@outlook.com", "Eg. sales.rep@outlook.com". 4. satır doldurulunca yeni satır eklenmiyor (maks. 4).
- Role açılır listesi (her satır): **Admin (billing access)** (varsayılan, ✓) · **Admin** · **Agent**.
- Alt: **🔗 Copy invite link** · **Send invites** (boşken disabled).

| Öğe | Davranış | Durum |
|---|---|---|
| Geçersiz e-posta ("not-an-email") | Kırmızı çerçeve + "Enter a valid email address"; Send invites disabled | ✅ |
| Aynı e-posta iki satırda | 2. satır altında "Email address is duplicated" | ✅ |
| Geçerli e-posta(lar) | Send invites aktif (mavi) | ⛔ tıklanmadı |
| X (veri doluyken) | Onay: ⚠ **"Cancel inviting agents?"** — "If you cancel inviting agents now, they won't join your organization." · **Back to inviting** · **Cancel inviting** (kırmızı) | ✅ |
| X (boşken) | Doğrudan kapanır | ✅ |
| Esc | Etkisiz | ✅ |

- ⚠️ **Varsayılan rol "Admin (billing access)"** — en yetkili rol varsayılan.
- ⚠️ **Duplicate hatası varken Send invites aktif kalıyor.**
- ⚠️ **Taslak kalıcılığı:** modal ilk açıldığında 1. satırda başka sekmede yazılmış "not-an-email" değeri duruyordu; "Cancel inviting" sonrası tekrar açıldığında önceki değerler yine geldi — form durumu temizlenmiyor. Alanlar elle temizlendi.

### Search / Ctrl+K komut paleti
- Açılış: Search veya **Ctrl+K**. Placeholder "Search", sağda X.
- Boş durumda: **Stop Accepting Chats** (komut) · **Knowledge Hub — Go to Automate** · **✨ Summarize My Team's Activity In The Last 30 Days.**
- Alt bilgi: "Open search [Ctrl] [K]" · "Up/down [▲] / [▼]" · "Close [esc]" · **Walkthrough**.
- Yazınca satır içi otomatik tamamlama ("set" → "set— invite settings") ve sağda eylem rozeti (**⏎ Navigate / Command / Ask Copilot / Search in archives**).
- "set": Invite Settings — Go to Team · Settings — Go to Settings · Ask Copilot — your AI assistant · Search In Archives — search for chats, customers and more.
- "chat": Stop Accepting Chats (Command) · Chats — Go to Chats · Chatbot — Go to Team · Chats Availability / Chat Duration / Chat Engagement / Chat Forms / Chat Satisfaction / Missed Chats / Total Chats — Go to Reports · Chatbot — Go to Automate · Install Livechat / Apple Business Chat / Forward Chats Transcript / Chat Buttons — Go to Settings · Ask Copilot · Search In Archives.
- Eşleşme yoksa ("zzqxw<b>'"%&", "test"): yalnızca Ask Copilot + Search In Archives. Özel karakterler düz metin ✅.
- ArrowDown/ArrowUp seçimi değiştirir ✅; Enter seçili eylemi çalıştırır.
- **Search In Archives** modu: "←" + **[Archives]** çipi; "test" ve "Tina" için **"No Results Found"** + **Clear Search**. ← ile geri dönülür ✅.
- **Walkthrough**: "← Walkthrough"; kart "Welcome to new search experience — Boost your efficiency to the maximum — Open search ctrl + K — → Search through LiveChat structure → Ask Copilot a question from any place → Search through archives"; "OTHER WAYS TO BOOST YOUR PRODUCTIVITY": LiveChat automation (- open Help Center ↗) · Explore Automate section · Add knowledge sources · See what's new in LiveChat · Add ChatBot · Install HelpDesk · Install KnowledgeBase · Install OpenWidget (Install öğeleri ⛔).
- Esc kapatır ✅. "Stop Accepting Chats" ⛔, "Summarize…" ⛔ (Copilot'a soru gönderir).

### Copilot paneli (sağ üst ikon / Ctrl+G / Home "Ask Copilot")
- Başlık "✨ Copilot" + **?** + **⤢** (genişlet) + **X**.
- Karşılama: "Hey azzatenli 👋. Ask me anything!" / "I'm your AI assistant, here to make your job easier. I can: • answer your questions about LiveChat • provide your performance metrics • share product updates • learn about your business to provide chat support" + **Train me with sources**.
- Giriş "Your message" + **Ask** (boşken disabled). Genişletilmiş modda "Hit ⏎ to send a message", ⓘ ve **Collapse** tooltip'li küçültme.
- **?** → "Help us shape this feature to best fit your needs by testing it out and sharing your thoughts." + **Leave feedback** → ↗ Google Forms "Copilot Improvements" (docs.google.com/forms/d/e/1FAIpQLSexJCDytciGA88XP1eR1x5jLCYzBjba-RHAFr8YDeGVPQEnOw/viewform), yeni sekme (kapatıldı).
- **Train me with sources** → sohbete "Train me with sources" kullanıcı mesajı eklenir, yanıt "I'm here if you need any help! 👍", sayfa `/automate/knowledge-hub/all-sources`'a gider. ⚠️ Buton Copilot'a otomatik mesaj gönderiyor.
- Ctrl+G toggle ✅. ⚠️ Sayfa yenilenince Copilot geçmişi sıfırlandı. Serbest metin gönderilmedi ⛔.

### News (zil ikonu)
- "LiveChat News" paneli (Beamer — app.getbeamer.com iframe), 🔍 arama ve X.
- Girdiler (NEW rozetli): "Images now open in a lightbox — right inside the widget" (April 28, 2025; "Your customers can now preview images shared in chat without leaving the conversation." Learn how >) · "A fresh new top bar for a smoother chat" (April 17, 2025) · "Chrome floating chat is here to keep conversations flowing" (April 16, 2025). Her girdide paylaş ikonu.
- ⚠️ En yeni haber Nisan 2025 (bugün Ekim 2026) — akış güncel değil. Link hedefi: https://news.livechat.com/ ↗.

### Avatar "A" menüsü (sol alt)
| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| A · azzatenli · ko10chitin@outlook.com | Başlık | Profil bilgisi | ✅ |
| Accept chats | Toggle (açık) | Ajan durumunu değiştirir | ⛔ |
| Dark mode ⓘ | Toggle (kapalı) | ⓘ tooltip: "Available on Home, Chats and Traffic." | ✅ tooltip / toggle ⛔ |
| Notification preferences 🔴! | Link | Modal (aşağıda) | ✅ |
| Download apps | 3 ikon | Tooltip'ler: "Android mobile app", "iOS mobile app", "Desktop app" | ✅ hover / indirme ⛔ |
| Help Center | Link | ↗ yardım merkezi (grup dışında açıldı, sekme görünmedi) | ↗ |
| Report an issue | Link | Modal | ✅ |
| Keyboard shortcuts | Link | Modal | ✅ |
| Company details | Link | Modal | ✅ |
| Log out | Link | Oturumu kapatır | ⛔ |

#### Notification preferences modalı
- "⚠ Enable your browser notifications so you don't miss any chats." + **Enable browser notifications** (tarayıcı izin istemi — ⛔).
- **🔊 Notification sound** toggle (açık) → kapatınca 🔇 ve "Repeat **New message** sound until message is read" satırı gizlenir.
- "Notify me about…": New messages ⓘ (işaretli, **disabled**; tooltip "Always ON so you don't miss any conversations.") · Incoming chats ☑ · New tickets to handle ☑ · Visitors in the queue ☑ · New visitors ☑ · Returning visitors ☐. Her satırda **(test)** (ses çalar) ve işaretliyse **Default sound**.
- "Default sound" → popover **"Personalize your notifications"** — "Download desktop app and select one of many new sounds or add custom one yourself." + **⊞ Download for Windows** (⛔).
- **Cancel** · **Save** (değişiklik yokken disabled). Değişiklikler Cancel ile geri alındı ✅. ⚠️ Popover açıkken Esc tüm modalı kapatıyor.

#### Keyboard shortcuts modalı (Shift+/ ile de açılır ✅)
- **Global:** Search — Ctrl K · Open Copilot — Ctrl G · Display keyboard shortcuts — ⇧ Shift / · Hide / Show sidebar — [
- **Chats & Archives:** Previous chat — Alt ▲ · Next chat — Alt ▼ · Close chat — Ctrl Alt Backspace · Tag chat / ticket — Ctrl Alt M · Pick customer from the queue — Ctrl Alt J · Add filter in the archives — Ctrl Shift L
- **Message box:** Use canned response — # · Insert emoji — : · Get reply suggestion — Ctrl Alt C · Upload file — Ctrl Alt U · Switch textarea mode — Ctrl Alt P · Focus on suggested response — Shift Tab · Autocomplete suggestions: use / next — Tab /
- Esc kapatır ✅. "[" Home'da görünür etki yapmadı.

#### Company details modalı
- "Please fill out your company details to help us serve you better in the future. This data will also contribute to the benchmarking tool and Customer Service Reports."
- **Company name** (boş; maxlength yok — 238 karakter kabul, `<script>` düz metin) · **Website** (drboolum.org) · **City** (boş) · **Country** (Serbia; aramalı liste, 249 ülke: Afghanistan … Zimbabwe) · **Industry** (boş; aramalı, 110 sektör: Automotive, Accounting, Advertising, Aerospace & Defense, Agricultural Products, Airlines, Apparel, Accessories & Luxury Goods, Architecture, Asset Management & Custody Banks, Automation, Banking & Mortgages, Beverages, Biotechnology, Broadcasting, Building Materials, Business Supplies, Capital Goods, Casinos & Gaming, Chemicals, Civil Engineering, Cloud Services, Commercial Printing, Commodity Chemicals, Communications, Computer Hardware, Computer Networking, Construction & Engineering, Construction, Consulting, Consumer Discretionary, Consumer Electronics, Consumer Goods, Consumer Services, Consumer Staples, Containers & Packaging, Corporate & Business, Cosmetics, Data Processing & Outsourced Services, Design, Distributors, Diversified Capital Markets, Education Services, Education, Electrical Equipment, Electrical, Energy, Eyewear, Family Services, Finance, Financial Services, Food Production, Food Retail, Food, Fundraising, Gold, Graphic Design, Ground Transportation, Health & Wellness, Health Care Services, Health Care, Home Improvement Retail, Homefurnishing Retail, Hotels, Restaurants & Leisure, Household Appliances, Human Resource & Employment Services, Industrial Machinery, Industrials & Manufacturing, Industrials, Insurance, Integrated Telecommunication Services, Internet Software & Services, Internet, Investment Banking & Brokerage, Legal Services, Leisure Facilities, Life Sciences Tools & Services, Machinery, Marine, Mechanical Engineering, Media, Metals & Mining, Movies & Entertainment, Nanotechnology, Oil & Gas, Packaged Foods & Meats, Paper Products, Payments, Pharmaceuticals, Photography, Professional Services, Public Relations, Publishing, Real Estate, Renewable Energy, Research & Consulting Services, Restaurants, Retailing, Semiconductors, Shipping & Logistics, Specialized Consumer Services, Specialty Retail, Sporting Goods, Technology Hardware, Storage & Peripherals, Textiles, Apparel & Luxury Goods, Textiles, Tobacco, Trading Companies & Distributors, Transportation, Utilities, Wireless Telecommunication Services) · **Company size** (2-9; seçenekler 1, 2-9, 10-49, 50-99, 100-499, 500-999, 1000+) · **Audience**: B2B, B2C, Internal use.
- Aramalı listelerde eşleşme yoksa "No results found".
- Website "not valid" → "Incorrect URL address". ⚠️ Hata varken **Save changes** aktif.
- **Cancel** · **Save changes** (⛔). ⚠️ Liste açıkken Esc tüm modalı kapatıyor.

#### Report an issue modalı
- 🐞 "Report an issue" — "To help us diagnose and fix the problem, please download a bug report and send it to our Support Team. ⓘ"
- ⓘ: "The content in the downloaded file is the exclusive property of Text, Inc. and is protected under applicable law. It's intended for use only by our Support Team and cannot be shared with third parties without our explicit consent."
- **Download bug report** · **Download & open chat** (⛔ indirme). X ile kapanır ✅.

### Turuncu LiveChat destek balonu (sağ alt)
- secure.livechatinc.com "LiveChat chat widget" iframe'i; rozet "1"; ara sıra "New message" toast'u.
- Açılınca **Text AI Support — AI assistant** sohbet geçmişi (önceden sorulmuş "AI agent specs" sorusu ve yanıtı: "Go to the Team section. Select AI agents… https://www.text.com/app/team/ai-agents/", ardından "Good morning, azzatenli! Welcome back to Livechat. It's nice to see you again. How can I help you today?"). Altta "Powered by text.com".
- Başlık: sol üst ⤡, **⋯** menüsü (**Send transcript** ⛔ · **Add chat to your website** · **Sounds** toggle açık), **X** küçült.
- Composer: **+** → **Send a file** · **Add screenshot**; "Write a message..."; 😊; ↑ gönder (⛔).
- Küçültülünce balonun yanında "Write a message..." mini giriş çubuğu ve X kalıyor.

---

## Chats (https://my.livechatinc.com/chats → /chats/TM1WJ3F3IZ/TM1WJ3F3JZ)

### İçerik / yerleşim
- `/chats` açılınca otomatik olarak tek sohbet olan **örnek sohbete** (chat id `TM1WJ3F3IZ`, thread `TM1WJ3F3JZ`) yönlenir. Üç sütun: **Chats** listesi · **Sample chat** akışı + composer · sağda **müşteri detay paneli**.
- ⚠️ Tam sayfa yüklemede (URL'ye doğrudan gitme, ör. `/chats/INVALID123/XYZ`) önce `/install-code` kapısı çıkıyor ve Skip sonrası orijinal deep link korunmuyor (`/home`'a düşüyor).
- SPA içinde geçersiz chat id'ye gidilince (`history.pushState('/chats/INVALID123/XYZ')`) sessizce örnek sohbete yönlendiriliyor; hata mesajı yok.

### İlk ziyaret: Chats turu
- Karşılama balonu: **"Welcome to the Chats section!"** — "Dive into the sample chat to test key features and experience the power of automation." — **Take a tour** · **Maybe later**.
- Adımlar (Take a tour; sohbet başlığındaki banner'daki "Take a tour" ile tekrar başlatılabiliyor → o zaman 5 adım):
  1. **Manage ongoing chats** — "Stay on top of active conversations or jump in to supervise other agents." (Chats listesi vurgulanır)
  2. **Get to know your customers** — "See who you're chatting with, where they're from, and their browsing or chat history—all in one place."
  3. **Use shortcuts for faster replies** — "Set offer of the right reply at the right time. Or use # to access canned responses at any time." (⚠️ "Set offer of" — anlamsız/yazım hatası gibi duruyor)
  4. **Speed up replies with AI suggestions** — "Get reply suggestions tailored from your business sources, like your website, to respond quickly and accurately."
  5. **Enhance messages with AI** — "Let AI suggest or add tags automatically to keep your chats organized." (görselde "Pricing ×", "Sales ×" etiketleri) — **Finish**
- Her adımda **Next** · **Skip all** · "n / 6 steps" (ilk açılışta 2/6'dan başladı — karşılama 1. adım sayılıyor) veya "n / 5 steps" (banner'dan başlatınca). ✅ uçtan uca.
- ⚠️ Adım sayacı tutarsız: ilk turda "2 / 6 … 6 / 6", banner'dan başlatınca "1 / 5 … 5 / 5".

### Chats listesi (sol sütun)
| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| ˅ My chats (1) | Daraltılabilir başlık | Tıklayınca bölüm daralır (˃ My chats (1)), tekrar tıklayınca açılır | ✅ |
| Newest ˅ | Sıralama toggle'ı | Tıklayınca "Oldest" olur, tekrar "Newest" (açılır liste değil, iki durumlu toggle) | ✅ |
| Sohbet satırı | Liste öğesi | Avatar + "Example Customer" + son mesaj "Thanks!" + geçen süre ("33m", canlı artıyor) | ✅ |
| Satır hover → **⋯** | Hover menüsü | **→ Transfer to ...** (disabled) · **✅ Create HelpDesk ticket** (disabled); hover tooltip: "Some of the actions are unavailable in sample chat" | ✅ |
| Satır hover → **✕** | Hover butonu | Sohbeti kapatır (tooltip yok) | ⛔ |
| Sağ tık | — | Özel bağlam menüsü yok (tarayıcı menüsü) | ✅ |
- Boş durumlar (Queued / Unassigned / Supervised vb.) bu hesapta sohbet olmadığı için görünmüyor.

### Sohbet başlığı
- Başlık **"Sample chat"** + **⋯** (aria "Chat menu") menüsü: **Transfer to ...** (disabled) · **Create HelpDesk ticket** (disabled) · **Ban this customer** (disabled) · **✕ End sample chat** (aktif — ⛔ tetiklenmedi).

### Sohbet akışı (sample chat içeriği, tam)
- Üstte bilgi bandı: "✨ This sample chat is your space to explore core chatting features and practice before engaging with real customers. 👋" + **Take a tour**.
- Mesajlar:
  - azzatenli: "First e-bike or upgrading? Where do you usually ride?"
  - Example Customer: "First one. City during the week, gravel paths on weekends."
  - azzatenli: "Switch handles both. Fast on pavement, grippy on gravel."
  - (ürün kartı, ajan tarafında) bisiklet görseli — **Switch** — **$2799.00** (tıklanabilir değil)
  - Example Customer: "Love it. Can I get it pre-fitted to my measurements before it ships?"
  - azzatenli: "Sure! A custom fit, what's your height and inseam?"
  - Example Customer: "5'8", 31 inseam"
  - azzatenli: "Got everything I need. I'll email you the order summary." — altında "Read • 33m"
  - Example Customer: "Thanks!" — "33m"
- Composer üstünde ilk açılışta öneri çipleri: "Hi there! 👋 How can I help yo..." · "Would you like me to help you ..." (sonradan kayboldu).
- Mesaj hover'ı: zaman damgası tooltip'i ("10:48:00 am" — tüm mesajlarda aynı saat). Müşteri mesajlarında **😊+ Add reaction** → tepki çubuğu: 👍 👎 ❤️ 😵‍💫(yüz) ✅ ⏳ (seçilmedi ⛔). Ajan mesajlarında **# Save canned response**.

#### "Save reply as canned response" modalı (ajan mesajı hover → #)
- Sekmeler **Shared** ("All group members will have access to this canned response") / **Private** ("Only you will have access to this canned response").
- **Response text** (mesaj metniyle önceden dolu) + **{x}** değişken butonu → açılır liste: %customer-email% · %customer-name% · %agent-name% · %agent-email%.
- **Shortcuts ⓘ** (tooltip: "To use the response in a chat, type # and your shortcut.") — "#Type shortcut..." — "Hit enter to add a new one".
- **Advanced settings ⚙** → tam sayfa `/automate/canned-responses/new?from=/chats/...` "Create Canned Response": Shared/Private, **Group selection** (G General), Response text, Shortcuts, "Automate tasks (optional)" — "Suggest this response when" (How does it work, Select events), "Assign tags 0/10 tags — Select tags — Automatically assign tags to the chat in which canned was used"; Cancel/Save. Cancel → **"You have unsaved changes"** — "Your changes will be lost if you continue. Are you sure you want to discard them?" **Stay here** / **Discard changes** → sohbete döner. ✅
- **Cancel** · **Save** (⛔). ⚠️ Esc modalı (ve {x} listesi açıkken bile) onaysız kapatıyor.

### Composer (mesaj kutusu)
| Öğe | Tür | Davranış / içerik | Durum |
|---|---|---|---|
| Metin alanı | Contenteditable | Placeholder "ctrl+K for quick actions"; yazınca tek kelimelik hayalet otomatik tamamlama ("thank" → "thank**sgiving**"); Shift+Enter yeni satır; **Enter gönderir** | ✅ (Enter ⛔) |
| Message ˅ | Mod seçici | **Message** ✓ / **Note**. Note modunda alan sarı, placeholder "Type an internal note, the customer won't see this message", buton etiketi "Note" | ✅ |
| Reply suggestions ikonu | Buton (disabled) | Tooltip: "Add public source to get reply suggestion **Settings**" | ✅ |
| # | Buton | Tooltip "Use canned response [#]"; tıklayınca alana "#" yazar ve hazır yanıt seçiciyi açar | ✅ |
| 📎 | Buton | Tooltip "Upload file [ctrl][alt][U]" (dosya penceresi açılmadı) | ⛔ |
| 😊 | Buton | Tooltip "Insert emoji [:]"; emoji seçici: "Search ..." + kategoriler Frequently Used, Smiles & People, Animals & Nature, Food & Drink, Activities, Travel & Places, Objects, Symbols; sonuç yoksa "Darn, no results found 😓" | ✅ |
| ⋯ | Buton | Tooltip "More options": **Autocomplete ⓘ** toggle (açık; tooltip "Single-word autocomplete. Works only with English. Learn more ↗ Feedback ➤") · **Shortcuts guide** (Keyboard shortcuts modalını açar) | ✅ / toggle ⛔ |
| Send | Buton | Boşken disabled; herhangi bir karakterde (yalnızca "#" bile) aktif | ⛔ hiç tıklanmadı |
| ":" kısayolu | Klavye | ":smi" → grinning_face_with_smiling_eyes, beaming_face_with_smiling_eyes önerileri | ✅ |
| Ctrl+K (composer'da) | Klavye | Bağlama duyarlı palet: Stop Accepting Chats · **End Sample Chat** — chat with Example Customer · **Tag Chat** [Ctrl Alt M] · **Upload File** [Ctrl Alt U] · Summarize My Team's Activity… + Walkthrough | ✅ (eylemler ⛔) |
| Ctrl+Alt+M | Klavye | Etiket seçiciyi açar | ✅ |
| Ctrl+Alt+J | Klavye | Görünür etki yok (kuyruk boş) | ✅ |
| "[" | Klavye | Kenar çubuğu gizle/göster — görünür etki gözlenmedi | ⚠️ |
- ✅ Taslak kalıcılığı: yazılan taslak Home'a gidip dönünce korunuyor. Test sonunda taslak temizlendi.

#### Hazır yanıt (canned response) seçici — "#"
- Başlık **GENERAL**; kısayol grupları ve adetleri: anytime 3 · bye 3 · feedback 3 · help 2 · hi 3 · product 2 · sure 3 · ticket 2 · transfer 2 · wait 3. Alt: **+ New** · ⚙.
- Grupların içerikleri (› ile açılır, ‹ ile geri):
  - **anytime:** "Sure thing! If you have any other questions, I'll be happy to help!" · "I'm happy that I could be of help!" · "You're welcome! 😊"
  - **bye:** "See you later! 👋" · "It was nice talking to you. Have a great day! 👋" · "Thanks for visiting 😊 See you around!"
  - **feedback:** "We really appreciate that you've shared that with us. Thanks!" · "That's a great idea! Thanks for bringing it up! 🙌" · "Thank you for your feedback!"
  - **help:** "Do you have any other questions that I can help you with?" · "Can I help you with anything else?"
  - **hi:** "Hi there! 👋 How can I help you today?" · "Hello! 👋 Let me find that out for you." · "Hello! 👋"
  - **product:** "If you need more details about our features or plans, be sure to ask 😊" · "Which product are you interested in?"
  - **sure:** (anytime ile birebir aynı 3 yanıt)
  - **ticket:** "I'm opening a HelpDesk ticket now. You'll get updates over email." · "I've opened a ticket for you. All updates will be sent via email."
  - **transfer:** "Let me add my colleague to the thread." · "Let me forward you to my colleague who will be able to help."
  - **wait:** "Thank you for your patience." · "I'm still on it. Please bear with me for a moment." · "Give me a moment, I'll check on that for you."
- Filtre: "#he" → doğrudan help yanıtları; "#hi" → hi yanıtları; eşleşme yoksa ("#hezzz") liste kapanıyor (boş durum mesajı yok).
- Bir yanıta tıklamak metni composer'a ekliyor ("Hello! 👋") — gönderilmedi, silindi ✅.
- ⚙ popover: **Sort responses by group** (toggle açık) · **Event-based suggestions ⓘ** (toggle açık; tooltip "Get canned response recommendations at specific events in the chat. Learn more ↗") · **Manage responses ↗**. (toggle'lar ⛔)
- **+ New** → "Create canned response" modalı: Shared/Private, Response text (placeholder "Frequently used response..."), {x}, Shortcuts, Advanced settings, Cancel/Save. ⚠️ Modal açılır açılmaz boş alan için "Enter your response." hatası gösteriliyor (kullanıcı etkileşiminden önce). ⚠️ Kısayola boşluk girilebiliyor ("#qa test" çipi oluştu). Cancel ✅ / Save ⛔.
- ⚠️ "anytime" ve "sure" grupları aynı içeriğe sahip (yinelenen hazır yanıtlar).

### Etiketler (composer altı)
- **🏷 Add tag** + mevcut çip **sales** (hover'da ✕ ile kaldırma — ⛔).
- Etiket seçici: positive feedback · **sales ✓** · spam · support · complaint; her satırda 📌 (tooltip "…to the top of the list" — sabitleme); altta "Search tag" + ⚙.
- Arama eşleşmezse "No tags found" (oluştur seçeneği yok).
- ⚙: **Clear search with each selection** (toggle kapalı) · **Tags settings ↗**.
- Etiket ekleme/çıkarma yapılmadı ⛔.

### Sağ panel — müşteri detayları
- Sekmeler: **👤 (Customer details)** · **+** (tooltip "Add application" → `/apps/marketplace/apps` "Explore apps") · **✕** (paneli dikey ikon şeridine daraltır; 👤 ile tekrar açılır) ✅.
- Müşteri kartı: avatar, **Example Customer**, **customer@mail.com**, Google haritası (Jersey City / Manhattan, kırmızı pin, "Harita verileri ©2026 Google", "Şartlar", "Harita hatası bildirin" — harita dili tarayıcı diline göre Türkçe). Hover'da **˅** düğmesi kartı kompakt moda alır (harita gizlenir, ˃ ile geri açılır). ✅
- **⠿ Additional info** (sürüklenebilir, daraltılabilir): "Chat duration: 33 min 38 s ⓘ" (tooltip: "Total time including queues, transfers, chats with bots and agents"; süre canlı artıyor) · "Groups: G General". ✅
- **⠿ Reply suggestions** (daraltılabilir): "Import public sources to get instant reply suggestions during the chat." + **Add public source ˅** (menü: **Add website source** · **Add PDF file**) + **⚙ Settings** (→ `/automate/knowledge-hub/all-sources`). "Add website source" → `/automate/knowledge-hub/websites` sayfasında "Add URL" modalı ("Enter website URL as a knowledge source for internal assistance of Copilot as well as for generation of reply suggestions in customer chats", alan "https://www.example.com/help/" + "All pages ˅", ☐ "For internal use only — Source will be used only to support agents in conversations with Copilot, not in customer chats.", More settings, **Add website** ⛔). Kapatıldı.
- ⚠️ Küçültülmüş destek widget'ı ("Write a message..." mini çubuğu) sağ panelin alt kısmındaki "Add public source" / "Settings" butonlarının üstüne biniyor; gerçek tıklama widget'a gidiyor (JS ile tıklamak gerekti).

### Edge-case / bulgular (Chats)
- ⚠️ Sample chat'te tüm transfer/ticket/ban eylemleri disabled, yalnızca "End sample chat" aktif.
- ⚠️ Send butonu yalnızca "#" karakteriyle bile aktifleşiyor; Enter tuşu doğrudan gönderiyor (yanlışlıkla gönderim riski).
- ⚠️ Tüm sample mesajlarının zaman damgası aynı ("10:48:00 am").
- ⚠️ Tur 3. adım metni "Set offer of the right reply…" muhtemelen hatalı.
- ⚠️ Esc, iç içe popover açıkken (değişken listesi, sound popover, dropdown) üst modalı da kapatıyor — kaydedilmemiş veri kaybı riski (canned response modalı).

---

## Ulaşılamayan / test edilmeyenler
- ⛔ Tüm geri dönüşsüz eylemler: Send/Send invite(s), Save/Save changes, Add website, Connect (GTM), Install (Walkthrough), Download (bug report, desktop app, Windows), Enable browser notifications, Accept chats / Dark mode / Autocomplete / Sort / Event-based suggestions / Clear search toggle'ları, End sample chat, sohbet kapatma ✕, etiket ekleme/çıkarma, tepki ekleme, Stop Accepting Chats, Log out, Choose plan / Request a call, onboarding "I don't want to chat yet" ve checklist "Skip" butonları.
- Copilot'a ve LiveChat destek widget'ına serbest mesaj gönderilmedi (yalnızca "Train me with sources" butonu otomatik bir Copilot mesajı üretti).
- Help Center ve "Preview widget" grup dışında yeni pencere açtığı için hedef URL doğrulanamadı.
- Diğer 13 "Connect with …" entegrasyonu (Shopify, WooCommerce, …) tıklanmadı (her biri dış sayfa açıyor; href DOM'da yok).
- Gerçek müşteri sohbeti, kuyruk, supervise, transfer akışları hesapta veri olmadığı için gözlemlenemedi; Chats listesinin diğer bölümleri (Queued, Unassigned vb.) boş olduğundan görünmedi.
- Dar ekran/responsive davranış test edilmedi (opsiyonel).
- Not: Keşif sırasında oturumun sekme grubu dışarıdan kapatıldı; yeni grup/sekmeyle devam edildi.


---
<a id="s2"></a>

# 02 — Engage & Automate (LiveChat ajan uygulaması)

> Kapsam: https://my.livechatinc.com/engage ve https://my.livechatinc.com/automate altındaki tüm sayfalar, sekmeler, modallar ve akışlar.
> Hesap: lisans 19985624, deneme (trial) hesabı — "14 days left in your trial. Upgrade now" banner'ı her sayfanın üstünde.
> Etiketler: ✅ test edildi · ⛔ onay bekliyor (tetiklenmedi) · ⚠️ bulgu · ↗ dış link · 🔒 plan/trial kilidi
> Tarih: 2026-10-14

## 0. Erişim ön koşulu — `/install-code` kapısı

### İçerik
- Doğrudan URL ile (`/engage`, `/engage/traffic`, `/automate`, `/settings` …) tam sayfa yüklemesi yapıldığında uygulama her seferinde **`/install-code`** sayfasına yönlendiriyor: "Start using LiveChat on your website now" — "Add the code manually" (kod bloğu, `window.__lc.license = 19985624`, `integration_name = "manual_onboarding"`), "Copy code", "Invite your developer", "Install guide", "Other ways to install: Connect with Google Tag Manager / More integrations +11", en altta **"I don't want to chat yet"**.
- "I don't want to chat yet" tıklanınca `/settings/code` sayfasına geçiliyor; bundan sonra uygulama içi (SPA) gezinme ile Engage/Automate erişilebilir oluyor.

### Edge-case / bulgular
- ⚠️ Deep link çalışmıyor: `/engage/traffic` gibi bir URL'yi yeni sekmede açmak her zaman `/install-code`'a düşüyor (widget kurulmadığı sürece). Kullanıcı yer imleri/paylaşılan linkler bu yüzden kırık.
- ⚠️ `/install-code` sayfasındaki kod lisansı `19985624`, ancak `/settings/code` sayfasındaki "Install chat widget manually" kod önizlemesinde `window.__lc.license = 100170061` görünüyor (muhtemelen statik/örnek görsel) — tutarsızlık.

## 1. Engage (/engage)

`/engage` → otomatik olarak `/engage/traffic`'e yönlendirir. Sol ikincil menü başlığı "Engage":

| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Traffic — "0 customers" | Menü linki + sayaç | `/engage/traffic` | ✅ |
| Campaigns — "5 active" | Menü linki + sayaç | `/engage/campaigns` → `/engage/campaigns/recurring` | ✅ |
| Goals — "0 active" | Menü linki + sayaç | `/engage/goals` | ✅ |
| Panel başlığındaki kenar çubuğu ikonu (▯) | İkon buton (etiketsiz) | İkincil menüyü daralt/genişlet | ✅ |
| Sol ana nav "Engage" ikonu | Link + hover tooltip "Engage" | `/engage` | ✅ |

⚠️ Erişilebilirlik: panel başlığındaki daralt/genişlet butonunun `aria-label`'ı yok (ekran okuyucuda "button" olarak okunuyor).

### 1.1 Traffic (/engage/traffic)

#### İçerik (boş durum — widget kurulmamış)
- Başlık: **Traffic**
- İllüstrasyon: örnek ziyaretçi tablosu (Name / Email / Activity / Actions / Country): "Anette Black – a.black@mail.com – Chatting – Supervise chat – United States", "Jenny Wilson – j.wilson@mail.com – Browsing – Start chat ✎ – United States", "Robert Fox – robert.fox@mail.com – Chatting – Supervise chat – United States" (statik görsel, tıklanamaz).
- Başlık: **"Install chat widget to see visitors"**
- Metin: "There are visitors waiting on your website. Install the chat widget to connect with visitors browsing your site."
- Butonlar: **Install chat widget** (birincil), **Invite developer** (ikincil).

#### Öğeler & durumlar
| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Install chat widget | Birincil buton | `/settings/code` (Settings › Channels › Install LiveChat) sayfasına götürür | ✅ |
| Invite developer | İkincil buton | "Invite people to LiveChat" modalını açar | ✅ |
| Gerçek ziyaretçi listesi / filtreler / kolonlar | — | Widget kurulmadığı için görünmüyor | ⚠️ erişilemedi |

#### Modal: "Invite people to LiveChat" (Invite developer)
- Alanlar: "Email addresses" — 4 satır e-posta input'u; placeholder'lar: "Eg. chatting.agent@outlook.com", "Eg. team.leader@outlook.com", "Eg. marketer@outlook.com", "Eg. sales.rep@outlook.com".
- Her satırda "Role" açılır listesi; varsayılan **Admin (billing access)**; seçenekler: **Admin (billing access)** ✓, **Admin**, **Agent**.
- Alt: "🔗 Copy invite link" (link butonu), **Send invites** (birincil).

| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| E-posta input ×4 | Text input | Blur'da doğrulama | ✅ |
| Role dropdown ×4 | Select | 3 seçenek (yukarıda) | ✅ |
| Copy invite link | Link-buton | Davet linkini panoya kopyalar | ⛔ onay bekliyor (tetiklenmedi — davet linki üretir) |
| Send invites | Birincil buton | Boşken **disabled**; geçerli e-posta girip blur sonrası **enabled** | ⛔ onay bekliyor (tetiklenmedi) |
| X (kapat) | İkon buton | Veri girilmişse "Cancel inviting agents?" onay diyaloğu açar | ✅ |
| Esc | Klavye | Odak input/select'teyken modalı **kapatmadı** | ✅ ⚠️ |

- Doğrulama ✅: "notanemail" → kırmızı çerçeve + "ⓘ Enter a valid email address". 
- ⚠️ Hata mesajı, geçerli bir değer ("dev@example.com") yazılırken kaybolmuyor; yalnızca blur (Tab) sonrası temizleniyor ve Send invites o anda aktifleşiyor.
- Onay diyaloğu "**Cancel inviting agents?**" — "If you cancel inviting agents now, they won't join your organization." Butonlar: **Back to inviting** / **Cancel inviting** (kırmızı). "Cancel inviting" yalnızca taslağı atar ✅.
- ⚠️ Modal başlığı "Invite people to LiveChat" iken onay diyaloğu "agents" diyor; ayrıca buton "Invite developer" olmasına rağmen varsayılan rol "Admin (billing access)" — geliştiriciye fatura yetkisi varsayılan olarak verilmesi riskli bir varsayılan.

### 1.2 Campaigns (/engage/campaigns → /engage/campaigns/recurring)

#### İçerik
- Başlık: **Campaigns**; sağ üstte **New campaign** (birincil buton).
- Tanıtım banner'ı: "🔥 **New: exit intent campaign**" — "Capture visitors with exit intent by offering a special discount before they leave your site." Buton: **Try new template**; sağ üstte **Close banner** (X). Görselde "Don't go just yet! / Enjoy 10% off / Copy code" önizlemesi.
- Sekmeler (segment): **Recurring** (`/engage/campaigns/recurring`, varsayılan) · **One-time** (`/engage/campaigns/one-time`).
- Sağda: ⓘ **Multiple campaigns** + anahtar (açık/yeşil). Tooltip: "Customers will see as many campaigns as many conditions will be met during the visit."
- Tablo kolonları (Recurring): **Name ↑** (sıralanabilir) · **Status** · **Displayed** · **Chats** · **Conversion** · **Last 7 days stats**. İlk satır: "⊕ Add new campaign".
- Mevcut 5 kampanya (hepsi Status = açık, Displayed 0, Chats 0, Conversion "-", "Reports" linki, "…" menü):

| Kampanya | Tip ikonu | Hover'da koşullar (tooltip) |
|---|---|---|
| Exit Intent Campaign | 🖥 (kart/rich) | "Matching all of these conditions: All visitors · Customer's activity: about to leave page" |
| Offer discount on your checkout page | **T** (metin) | "Matching any of these conditions: All visitors · Time on page: 13s · Page contains checkout · Page contains cart · Page contains order · Page contains confirmation · Page contains shipping" |
| Offer help on your pricing page | **T** | "Matching any of these conditions: All visitors · Time on page: 13s · Page contains plans · Page contains pricing" |
| Welcome returning customers | **T** | "Matching all of these conditions: Returning visitors · Time on page: 14s" |
| Welcome your customers | 🖥 | "Matching all of these conditions: First time visitors · Time on page: 5s" |

- One-time sekmesi: kolonlar yalnızca **Name ↑ · Status · Displayed · Last 7 days stats**; tek satır "⊕ Add new campaign"; hiçbir boş-durum metni yok.

#### Öğeler & durumlar
| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| New campaign | Birincil buton | `/engage/campaigns/recurring/templates` (şablon seçimi) | ✅ |
| Try new template | Buton | "Hook leaving visitors" şablonuyla editörü açar (`/recurring/add?templateId=…&category=Promote and convert`) | ✅ |
| Close banner (X) | İkon buton | Banner'ı kapatır (kalıcı tercih olabilir) | ⛔ onay bekliyor (tetiklenmedi) |
| Recurring / One-time | Segment sekme | URL değişir | ✅ |
| Multiple campaigns anahtarı | Toggle (anında kaydeder) | Çoklu kampanya gösterimi | ⛔ onay bekliyor (tetiklenmedi) |
| Name ↑ / ↓ | Sıralama başlığı | A→Z / Z→A sıralar | ✅ |
| Satır Status anahtarı | Toggle (anında kaydeder) | Kampanyayı aktif/pasif yapar | ⛔ onay bekliyor (tetiklenmedi) |
| Kampanya adı | Link | Editörü açar: `/engage/campaigns/recurring/<id>` (ör. Exit Intent = `/5`) | ✅ |
| Tip ikonu (🖥 / T) | Hover | Koşul tooltip'i | ✅ |
| Reports | Link | `/reports/campaigns?date_from=…&date_to=…&greeting[]=<id>` (Reports › Chats › Campaigns conversion, "Campaign is <ad>" filtresiyle) | ✅ |
| "…" (Toggle menu) | Kebab menü | **Duplicate**, **Edit**, **Delete** (kırmızı) | ✅ açıldı; Duplicate/Delete ⛔ onay bekliyor |
| Add new campaign | Satır butonu | Şablon seçimine gider | ✅ |

#### Edge-case / bulgular
- ⚠️ One-time sekmesindeyken "New campaign" tıklanınca yine **recurring**/templates'e gidiyor (one-time bağlamı kayboluyor).
- ⚠️ One-time listesi boşken açıklayıcı bir boş durum yok; yalnızca "Add new campaign" satırı.
- ⚠️ Kebab butonunun erişilebilir adı "Toggle menu" (hangi satıra ait olduğu belirtilmiyor).
- Reports sayfası boşken: "You had no chats from recurring campaigns during this period — Get people chatting with more actionable campaigns." + **Go to campaigns**.

### 1.3 Create campaign — Şablon seçimi (/engage/campaigns/recurring/templates)

- Başlık çubuğu: X (kapat) + "Create campaign". Soru: **"What's your campaign goal?"**
- Kategori sekmeleri (URL'de `?category=`):
  - **Greet and inform**: "Offer instant help — Quickly connect visitors with support through clickable options." (önizleme: "Need help or have a question?" + Track order / Shipping cost / Return policy / Other) · "Welcome visitors — Send a friendly message and encourage visitors to start a chat." (önizleme: "Hello! We're here for you." + Chat with us) · "Share important updates — Let your visitors know about any important website information."
  - **Promote and convert**: "Personalize experience — Guide visitors to discover products that match their preferences." · "🔥 Trending — **Hook leaving visitors** — Offer a special discount to catch visitors before they leave your site." · "Announce new products — Introduce a new product or feature to spark interest and increase sales." · "Share valuable resources — Provide resources to showcase offerings and engage visitors."
  - **Generate Leads**: "Increase social engagement — Expand social media following by inviting users to follow your profiles." (önizleme: Follow us on socials! + Instagram/Facebook) · "Grow your audiences — Encourage visitors to subscribe to your newsletter to generate leads." (önizleme: "Would you like to be the first line for exclusive deals and special offers?" + Sign up) · "Invite and capture interest — Invite visitors to join your events to increase engagement." (önizleme: "Just a few days left to sign up for our upcoming online event. Will you join us? ⏰" + Count me in / Learn more)
- ⚠️ "Generate Leads" sekmesi URL'yi **çift kodlanmış** yazıyor: `?category=Generate%2520leads` (diğer akışta `Generate%20leads`).
- ⚠️ "Sıfırdan / boş kampanya" seçeneği yok — her kampanya bir şablondan başlıyor.
- ⚠️ Şablon kartları `button`/`link` değil, tıklanabilir `div` (klavye/ekran okuyucu erişimi zayıf; programatik click de tetiklemiyor).

### 1.4 Campaign editor — Adım 1: görünümü özelleştir (`/engage/campaigns/recurring/add?templateId=…&category=…`)

Örnek: "Increase social engagement" şablonu.

#### İçerik
- Üst araç çubuğu: **X** · başlık "Increase social engagement" · ✎ (pasif; tooltip: "It's not possible to change the name while creating a new campaign.") · **Change template** ikonu (tooltip "Change template") · **?** (tooltip "Help").
- Onboarding ipucu (sarı balon): "**Editable elements** — Edit image, texts and buttons by clicking on them".
- Önizleme kartı: "Upload or choose image" alanı · Başlık "Follow us on socials!" · Metin "Stay connected with us for the latest updates." · Butonlar "Instagram", "Facebook" · "+ Add button" · altında "Write a message…" alanı + 🗑 ikonu.
- Alt çubuk: **Previous: select template** · **Next: set conditions**.

#### Öğeler & durumlar
| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| ? Help | İkon | ↗ Yeni sekmede `https://www.livechat.com/help/targeted-messages/` ("Engage visitors using Campaigns") | ✅ ↗ |
| Change template | İkon | Şablon seçimine döner (yeni oluştururken aktif; düzenlemede pasif — tooltip "It's not possible to change the template while editing.") | ✅ |
| Görsel alanı | Popover | Sekmeler **Custom** (yükleme alanı ⊕, "Max. 2300x1500 px \| png, jpg, gif, jpeg") / **Library** (5 hazır görsel: 👋, 😍, 🤑, kalem, 🔔); "Alternative text ⓘ" (placeholder "Describe"; tooltip "Alternative text is essential for people with disabilities who use screen readers."); **Save** | ✅ (Save/yükleme ⛔ tetiklenmedi) |
| Başlık metni | Inline edit | Sayaç **x/80**; boş bırakılabiliyor (placeholder "Title") | ✅ |
| Gövde metni | Inline edit | Sayaç **x/220** | ✅ |
| Buton (ör. Instagram) | Popover | **Button style ⓘ** (Default / Primary / Danger; tooltip "Color depends on chat widget appearance settings for group General"), **Actions**: Send message ("Sends message with button text as content"), Phone call ("Calls provided number"), Open URL ("Opens link in new tab"), Open Moment, Dismiss, Copy coupon ("Copy coupon value to clipboard"); **Button text** (max **20** karakter); eyleme göre: Website URL (Open URL / Open Moment) / Phone number / Value to copy; Send message ve Dismiss'te yalnızca Button text; **Done**; önizlemede seçili butonun yanında 🗑 | ✅ |
| + Add button | Buton | Yeni buton "Button text", style "Select option" (boş), action Send message; **en fazla 5 buton** — 5'ten sonra "Add button" kayboluyor | ✅ |
| Write a message… + 🗑 | Önizleme | Tooltip: "Customers can send a custom message when the chat widget is minimized. Placeholder text is not editable"; 🗑 bu alanı kaldırır | ✅ |
| Previous: select template | Buton | Şablon listesine döner | ✅ |
| Next: set conditions | Buton | Adım 2; form hatası varsa **disabled** | ✅ |

#### Edge-case / bulgular (doğrulama ✅)
- Button text boş → "Missing the button title"; önizlemede buton "Empty" yazıyor; alt bilgi "To apply changes, please fix the data in highlighted buttons"; Next disabled.
- Website URL "abc" → "Not a valid URL". Phone number "abc" → "Not a valid phone number".
- ⚠️ Eylem tipi değiştirildiğinde önceki değer taşınıyor: Open URL → Phone call'a geçince Phone number alanı "https://example.com" ile dolu geliyor ve hemen hata veriyor; Copy coupon'da "Value to copy" = URL.
- ⚠️ Button text 20 karakterde **sessizce kesiliyor** (sayaç/uyarı yok). Özel karakterler (`<b>&"'`) düz metin olarak gösteriliyor (XSS yok ✅).
- ⚠️ Yeni eklenen butonda "Button style" boş ("Select option") — varsayılan atanmıyor.
- ⚠️ Button style dropdown'ı, ⓘ tooltip'i açıkken tetikleyicinin üstünü kapattığı için ilk tıklamada açılmıyor.

### 1.5 Campaign editor — Adım 2: koşullar

#### İçerik
- Sol: **Who will receive this campaign** — segment: All visitors (varsayılan) / First time visitors / Returning visitors.
- **When to display this campaign** — "Time on page is more than: [13] seconds" (stepper) + ⓘ (tooltip: "Tip: Your Google Analytics can tell you how long customers stay on each page so you can set the time trigger accordingly.").
- Eşleşme dropdown: **Match all of these conditions** / **Match one of these conditions**. Birden çok koşul arasında "AND" etiketi.
- Koşul satırı (varsayılan: 🌐 Current page URL · contains · "Enter a string" · ✕). **+ Add condition**.
- Sağ: **Preview** — sekmeler **Desktop** / **Mobile** (telefon çerçevesi); widget başlığında "azzatenli"; alt not: "To test the campaign, open your website in an incognito mode (Ctrl + Shift + N)."
- Alt: **Previous: customize look** · **Save campaign** ⛔.

#### Koşul tipleri ve operatörler
| Koşul tipi | Operatör / alanlar |
|---|---|
| Customer's activity | is · [about to leave page / actively browsing] |
| Current page URL | contains / does not contain / is exactly / is not · "Enter a string" |
| Customer's location | "Enter country or city name" |
| Customer's browsing time | is more than · [5] seconds |
| Number of viewed pages | is at least · [3] |
| Referring website address | contains · "Enter a string" |
| Pages visited in exact order | "Page URL contains" · "Enter a string" · **+ next page** |
| Any page from session | contains / does not contain / is exactly / is not · "Enter a string" |
| Custom variable | "Enter variable name" · [is exactly / is not / is greater than / is greater or equal / contains / does not contain / is lower than / is lower or equal] · "Enter variable value" |

#### Edge-case / bulgular
- Time on page alanı: min 0, max **900**; "-5" → "5" (eksi işareti atılıyor), "99999999" → **900**'e sabitleniyor; "0" kabul ✅.
- Boş "Enter a string" ile Save campaign butonu **etkin** görünüyor (boş koşulla kaydetme engellenmiyor olabilir) — ⛔ tetiklenmedi.
- X ile çıkış → "**You have unsaved changes** — Your changes will be lost if you continue. Are you sure you want to discard them?" — **Stay here** / **Discard changes** (kırmızı) ✅.
- ⚠️ Mevcut kampanyada hiçbir değişiklik yapmadan (yalnızca Adım 2'ye geçip X'e basınca) da "unsaved changes" uyarısı çıkıyor (yanlış pozitif).

### 1.6 Mevcut kampanyayı düzenleme (`/engage/campaigns/recurring/5` — Exit Intent Campaign)
- Başlıkta **Live** rozeti; ✎ etkin → modal "**Change the campaign name**" — "Campaign name" alanı; **Cancel** / **Change name** ⛔. Boş ad → kırmızı çerçeve + Change name disabled (hata mesajı yok ⚠️); maxLength tanımsız ⚠️.
- Change template ikonu pasif (tooltip yukarıda). Alt çubuk: **Cancel** · **Next: set conditions**.
- İçerik: görsel (ünlem işareti) + 🗑, "Wait! Before you go…", "How about a quick chat? We're here to help with anything you need.", buton "Start chat", Add button, Write a message….
- Adım 2: All visitors, Time on page 0, "Customer's activity is about to leave page". Save campaign ⛔.
- "Hook leaving visitors" şablonu (Try new template): "Don't go just yet!" / "Enjoy 10% off your order with this discount code" / buton "Copy code" + indirim etiketi görseli.

### 1.7 Tüm kampanya şablonlarının varsayılan içeriği (her biri açıldı ✅, hepsi kaydedilmeden atıldı)

Her şablonun Adım 2 varsayılanı aynı: **All visitors · Time on page 13 s · Match all of these conditions · Current page URL contains "" (boş)**.

| Kategori | Şablon | Adım 1 önizleme içeriği (verbatim) |
|---|---|---|
| Greet and inform | Offer instant help | Görsel/başlık yok · "Need help or have a question?" · butonlar "Track order📍", "Shipping cost 📦", "Return policy ↩️", "Other" · Add button · Write a message… |
| Greet and inform | Welcome visitors | "Hello!" · "We are here for you." · buton "Chat with us" · Add button · Write a message… |
| Greet and inform | Share important updates | **Metin tipi (T)**: "Green news 🌱" · "We're carbon neutral. Thank you for supporting our sustainable journey!" · Write a message… · ipucu "**Use %name% to address customers by their name.**" (buton yok) |
| Promote and convert | Personalize experience | "Hello! 👋" · "Ready to discover more about our products?" · butonlar "Get details", "Ask for deals" |
| Promote and convert | Hook leaving visitors (🔥 Trending) | indirim etiketi görseli · "Don't go just yet!" · "Enjoy 10% off your order with this discount code" · buton "Copy code" |
| Promote and convert | Announce new products | megafon görseli · "Introducing our brand new mobile app 📱" · "Subtitle" (boş alt başlık placeholder) · butonlar "iOS", "Android" |
| Promote and convert | Share valuable resources | "Upload or choose image" · "New collection alert! ✨" · "Explore our new product catalog and discover our latest offerings!" · buton "Download catalog" |
| Generate Leads | Increase social engagement | "Upload or choose image" · "Follow us on socials!" · "Stay connected with us for the latest updates." · "Instagram", "Facebook" |
| Generate Leads | Grow your audiences | zarf görseli · "Would you like to be the first line for exclusive deals and special offers?" · "Subtitle" · buton "Sign up" |
| Generate Leads | Invite and capture interest | "Just a few days left to sign up for our upcoming online event. Will you join us?" · "Count me in", "Learn more" |

- ⚠️ Şablondan çıkarken (Previous: select template) **hiç düzenleme yapılmamış olsa bile** "You have unsaved changes" diyaloğu çıkıyor (tüm şablonlarda tekrarlandı).
- ⚠️ Şablon kategori URL'leri tutarsız çift kodlama: `?category=Greet%2520and%2520inform`, `Promote%2520and%2520convert`, `Generate%2520leads` (şablon listesi) vs `Greet%20and%20inform` (editör).
- Koşullar: "Customer's browsing time" ve "Number of viewed pages" için operatör seçilemiyor (sabit "is more than … seconds" / "is at least"). "Referring website address" operatörleri: contains / does not contain (+liste devamı). Customer's location alanına yazı yazıldığında ("Ist") öneri listesi görülmedi (alan serbest metin).

### 1.8 Goals (/engage/goals)

#### İçerik (boş durum)
- Başlık **Goals**; sağ üstte **New goal**.
- Huni kartları: **Visitors** (last 7 days) **0** 👥 → **Chats** (last 7 days) **0** 💬 → **Goals** (last 7 days) **0** 🎯 (aralarında ">" okları).
- Boş durum: "**Measure chat effectiveness**" — "See how many chats turn into leads, sales or resolved cases. **Learn more** about Goals" (↗ `https://www.livechat.com/help/goals-set-up-and-use/`) + **⊕ Create goal**.
- Panel başlığı ikonu tooltip: "**Hide sidebar** [" — klavye kısayolu **[** ikincil menüyü gizler/gösterir ✅ (Engage'in tüm alt sayfalarında aynı).

| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| New goal / Create goal | Birincil buton | `/engage/goals/create` | ✅ |
| Learn more | Link | ↗ help center | ✅ ↗ |
| Hide sidebar ([) | İkon + kısayol | İkincil menüyü daraltır | ✅ |

#### 1.8.1 Create a goal (/engage/goals/create)
- ← (geri) · "**Create a goal**" — "Measure how many chats turn into leads, sales or resolved cases."
- Kartlar: **Order placed** ("Most popular" rozeti; 🛒 "Measure successful sales") · **Start from scratch** (⊕ "Track goals specific to your team").

#### 1.8.2 Set up conditions (Order placed / Start from scratch — URL değişmiyor, hâlâ `/engage/goals/create`)
- "**Set up conditions**"; segment sekmeler **Page visited** / **Advanced triggers**.
- **Page visited**: "Goal is completed when a customer reaches a specific page after the chat. This can be your post-purchase "thank you" page"
  - **The URL** dropdown: `is exactly` / `contains` (Order placed'da varsayılan **contains**; Start from scratch'te **Select option**).
  - **URL path** (placeholder "i.e. /checkout") — çoklu etiket (chip) girişi; Enter ile chip olur, × ile silinir.
  - Öneri chip'leri (yalnızca Order placed): `/thank-you`, `/success`, `/order-confirmation`, `/checkout/confirmation`, `/purchase/complete`, `/order/complete`, `/confirmation` — tıklanan chip alana eklenir ve öneri listesinden kalkar.
  - **Goal name** (placeholder "Enter goal name"; Order placed varsayılanı "**Sales - order placed**").
- **Advanced triggers**: "Choose Trigger" radyo kartları:
  - **Custom Page Event** (varsayılan) — "Goal is achieved when a specific condition set in your website's code. This can be filling out a registration form." → alanlar **Custom variable name** ("Type variable name"), **Custom variable value** ("Type variable value").
  - **API Request** — "Goal is marked as successful by **Goals API** when the visitor ends up on a site that doesn't use LiveChat tracking code." (↗ `https://platform.text.com/docs/management/configuration-api/v2.0`) → yalnızca Goal name.
  - "**Contact our Support** if you need a helping hand with setting up goals." (chat widget'ını açar — tetiklenmedi).
- Alt çubuk **Cancel** · **Create goal** ⛔ — yalnızca URL path'e en az bir değer girildiğinde görünüyor.

#### Edge-case / bulgular
- ⚠️ Footer (Cancel/Create goal) form boşken hiç görünmüyor; kullanıcı nasıl kaydedeceğini göremiyor.
- ⚠️ Start from scratch'te "The URL" = "Select option" ve Goal name boşken bile **Create goal etkin** (ön doğrulama yok) — ⛔ tıklanmadı, sunucu tarafı doğrulama test edilmedi.
- ⚠️ Goal name temizlenip Advanced triggers'a geçilince ad "Sales - order placed"e geri dönüyor (sekme değişimi formu sıfırlıyor).
- ⚠️ ← geri oku, girilmiş veri varken **uyarısız** `/engage/goals`'a dönüyor (unsaved-changes koruması yok; Campaigns editöründe var — tutarsız). Cancel ise "Create a goal" kart seçimine döner.
- Input'larda maxLength yok.

## 2. Automate (/automate)

`/automate` → `/automate/overview`. İkincil menü (başlık "Automate"):

| Öğe | URL | Not |
|---|---|---|
| Overview | `/automate/overview` | |
| Chatbots | `/automate/chatbots` | ChatBot.com uygulaması **iframe** içinde (`livechatapp.chatbot.com`) |
| Knowledge hub ▸ (açılır) | `/automate/knowledge-hub/all-sources` | alt öğeler: All sources **0**, Websites **0** (`/websites`), PDF files **0** (`/pdf`) |
| Canned responses ▸ (açılır) | `/automate/canned-responses` | alt öğeler: Responses list, Suggested responses (`/automate/suggested-responses`) |
| Routing rules | `/automate/groups-routing` | |
| Workflows **Beta** | `/automate/workflows` | |
| Panel başlığı ▯ | — | tooltip "Hide sidebar [" (kısayol **[**) |

### 2.1 Overview (/automate/overview)

#### İçerik (verbatim)
- Hero: "NEW RELEASE" — "**Put an AI Agent on your chats**" — "Businesses like yours resolve up to 74% of chats automatically with AI agents and convert up to 3x more visitors into sales." — buton **I'm interested in AI Agents**. Sağda görsel: "Inbox · AI Agent ↑ $1.8k — Yes! Express delivery lands before noon the next day. Want me to add it to your cart?"
- **Speed up chatting**:
  - Chat with Copilot — "Get instant answers from AI assistant" — **Chat now →**
  - Get canned response suggestions — "Suggest responses based on specific events" — **Manage →**
  - Enhance your messages — "Adjust the tone, fix grammar and more" — **Tell me more →**
  - Get Reply suggestions — "Suggest smart replies while chatting with customers" — **Manage →**
- **Automate routine tasks**:
  - Summarize your chats — "Get chat summaries in form of a simple list" — **Tell me more →**
  - Auto-tag your chats — "Tag chats based on the canned response used" — **Tell me more →**
  - Get AI tag suggestions — "Suggest tags based on previous tag usage" — **Tell me more →**
- **Ensure team efficiency**:
  - Route your chats — "Direct customers to appropriate teams" — **Manage →**
  - Set working hours — "Guarantee proper staffing for each shift" — **Manage →**
  - Set up Workflows **Beta** — "Automate manual processes and routine tasks" — **Manage →**

#### Öğeler & durumlar
| Öğe | Davranış | Durum |
|---|---|---|
| I'm interested in AI Agents | İlgi bildirimi / satış akışı olabilir | ⛔ onay bekliyor (tetiklenmedi) |
| Chat now | Sağda **Copilot** panelini açar | ✅ |
| Manage (canned response suggestions) | `/automate/suggested-responses` | ✅ |
| Manage (Reply suggestions) | `/automate/knowledge-hub/all-sources` | ✅ |
| Manage (Route your chats) | `/automate/groups-routing` | ✅ |
| Manage (Set working hours) | `/team/agent/<kendi e-postası>` (Team bölümü) | ✅ |
| Manage (Workflows) | `/automate/workflows` | ✅ |
| Tell me more (×4) | Copilot panelini açar ve **otomatik olarak Copilot'a soru gönderir**: "Tell me more about text enhancements" / "…chat summaries" / "…chats auto-tagging" / "…AI tag suggestions" | ✅ ⚠️ (bkz. bulgular) |

#### Copilot paneli (sağ çekmece)
- Başlık "Copilot" + ? (yardım) + ⛶ (genişlet) + ✕. Mesaj kutusu "Your message" + **Ask** (boşken pasif). Her cevabın altında ⧉ (kopyala) ve # ikonları.
- Karşılama: "Hey azzatenli 👋. Ask me anything! I'm your AI assistant, here to make your job easier. I can: • answer your questions about LiveChat • provide your performance metrics • share product updates • learn about your business to provide chat support" + **Train me with sources**.
- Örnek cevaplar: text enhancements → "AI text enhancements let you adjust message tones (professional, friendly, or casual), expand, summarize, or rephrase your texts, fix grammar and spelling mistakes, and generate whole new content…" + **See the full tutorial ↗**; chat summaries → "Chat summary lets you generate and review key points from conversations… Simply enter a chat and navigate to the customer details column to get a summary."; auto-tagging → "You can set your canned responses to automatically apply specific tags to your chats…"; AI tag suggestions → "Once you've tagged at least 100 chats, the app will start offering you tag suggestions…"; "Want to know more about me?" → "See the full resume".
- ⚠️ "Tell me more" butonları kullanıcı onayı olmadan Copilot'a mesaj gönderiyor (konuşma geçmişine kalıcı kayıt düşüyor). Bu keşif sırasında 4 adet otomatik Copilot sorusu oluştu (yalnızca dahili AI asistanı; ziyaretçiye/başkasına bir şey gönderilmedi).
- ⚠️ Hero'daki kart başlığı "AI Agent" ama Chatbots sayfası "ChatBot" ürününü açıyor — isimlendirme tutarsız.

### 2.2 Chatbots (/automate/chatbots) — iframe `livechatapp.chatbot.com`

#### İçerik
- Başlık **Chatbots**, sağ üstte **Add chatbot**.
- Banner (X ile kapatılabilir ⛔): "**Automate your customer service** — Provide quick and accurate AI-generated answers to your customers' questions. Feed your chatbot with knowledge from your website, help center, FAQ pages, documentation files, or PDFs." (görselde ChatBot önizlemesi ve Zendesk/HelpDesk vb. ikonları).
- Tablo: **Name** · **Status**; tek satır "⊕ Add new chatbot" (hiç bot yok).

#### Akış: Add new chatbot (tam sayfa form + sağda canlı önizleme)
- Başlık "X Add new chatbot"; alt çubuk **Cancel** / **Add chatbot** ⛔.
- Akordeon bölümler (aynı anda biri açık):
  1. **General settings** — "Name your chatbot and choose its availability." Alanlar: **Name** (varsayılan "ChatBot"), **Welcome message** ("(Go to advanced configurator)" linki; varsayılan "It's nice to meet you! What brings you here today?"), **Accepting chats** anahtarı (açık).
  2. **Skills** — "Choose AI skills and enhance your chatbot capabilities." **+ Add skill** menüsü: **Small talk** ("Support casual conversations.") · **Transfer to agent** ("Forward chat to agent when needed."). Seçilen beceri chip olarak eklenir (× ile kaldırılır), menüde ✓ işaretlenir.
  3. **AI Knowledge** — "Power your chatbot to answer customers' questions using sources." **+ Add new website** → modal "**Add website**": "Enter the website URL as a knowledge source for your chatbot to generate AI answers for your customers' questions." · "Enter website URL" (placeholder "Website URL") · ⓘ "We'll scrape 200 pages from provided website. To add more pages, you need to **upgrade your chatbot** to the premium version." · **Add website** ⛔ (boşken pasif).
  4. **Custom answers** 🔒 **Premium** — görsel (When user asks "Can I sign up for a monthly subscription?" → Then respond …"Train phrase") · "**Unlock this feature** — Set up custom answers, control your chatbot flow, and measure the overall customer experience." · **🔒 Get started** (yükseltme — tetiklenmedi).
- Sağ önizleme: "ChatBot — AI-driven bot", hoş geldin baloncuğu, "Write a message…" (test sohbeti — mesaj gönderilmedi).

#### Edge-case / bulgular
- ⚠️ Add website modalında "abc" gibi geçersiz URL ile **Add website etkinleşiyor** (istemci tarafı doğrulama yok).
- ⚠️ Name ve Welcome message tamamen boşaltıldığında hata mesajı yok, **Add chatbot etkin kalıyor**; önizleme başlığı yine "ChatBot" gösteriyor, hoş geldin baloncuğu kayboluyor.
- ⚠️ Cancel, değişiklik yapılmış olsa bile **onay sormadan** kapatıyor (LiveChat'in diğer formlarındaki "unsaved changes" davranışıyla tutarsız).
- ⚠️ İçerik iframe'de olduğundan erişilebilirlik ağacı/ana sayfa metin araması içeriği görmüyor; sayfa başlığı "Automate".

### 2.3 Knowledge hub (/automate/knowledge-hub/…)

#### All sources (`/all-sources`)
- Banner (X ⛔): "Power up **Copilot** with your business knowledge — Equip your agents with instant answers and smarter replies. Add public websites and PDFs to the Knowledge hub. Use the knowledge to assist agents through Copilot and generate reply suggestions for customer chats." + **Tell me more** (Copilot'a soru gönderir — tetiklenmedi).
- Kartlar: **Websites** — "Enter URLs of public websites or web pages." **Add website** · **PDF** — "Upload PDF files with relevant business information." **Add PDF File**.

#### Modal: Add URL (Add website)
- "Enter website URL as a knowledge source for internal assistance of **Copilot** as well as for generation of **reply suggestions** in customer chats" (altı çizili terimler hover tooltip: Copilot → "**Get support from Copilot** — Copilot stores your knowledge and supports your agents with information anytime, anywhere in the app."; reply suggestions → "**Get reply suggestions during chats** — Generate ready-to-send replies in customer chats based on the source. Agents can still edit or dismiss them, keeping full control over the replies.").
- **Enter website URL** (placeholder "https://www.example.com/help/") + kapsam dropdown: **All pages** ("Add all nested pages", varsayılan ✓) / **Single page** ("Add only this particular page").
- ☐ **For internal use only** — "Source will be used only to support agents in conversations with Copilot, not in customer chats."
- **More settings** (genişletir): ☑ **Auto-update source every [30] days** (stepper; min **5**, max **365**; 999 → 365'e sabitlenir) · **Source name** (placeholder "Enter source name"; "When left empty, the name will be auto-generated").
- **Add website** ⛔.
- Doğrulama ✅: "notaurl" → "ⓘ **It doesn't seem like a real website**".
- Esc açık dropdown ile birlikte modalı da kapatıyor.

#### Modal: Add PDF file
- "Upload a PDF to extract text data. This knowledge will be used for internal assistance from Copilot and for generating reply suggestions in customer chats."
- Bırakma alanı: **⇪ Select a file** · "or drag and drop it here" · "PDF file • 46 MB max" (input accept `application/pdf,.pdf`, tekli dosya).
- ☐ For internal use only (aynı açıklama). **Add PDF file** ⛔ (dosya seçilmeden de etkin görünüyor ⚠️). Dosya seçici açılmadı.
- ⚠️ Tooltip'lerde büyük boş bir görsel alanı render oluyor (görsel yüklenmiyor).
- ⚠️ **Durum sızıntısı**: All sources'ta Add PDF modalı açıkken sayfadan ayrılıp `/knowledge-hub/pdf`'e gidince modal kendiliğinden yeniden açık geliyor.

#### Websites (`/websites`) ve PDF files (`/pdf`)
- Websites: başlık + **Add website**; banner "Add public website — Add help centers, terms and conditions, product pages, FAQs, and more. Make sure the website is public, with no restricted access or passwords." + Tell me more + Close banner; boş durum "**Add your first website** — Add public websites with your business knowledge to support agents at work." + **Add website**.
- PDF files: başlık + **Add PDF**; banner "Add PDF file — Upload PDFs with valuable knowledge about your business. Add product brochures, employee handbooks, training manuals, and other key documents." + Tell me more; boş durum "**No PDF files added** — Upload a PDF file with your business knowledge to support agents at work." + **Add PDF**.
- ⚠️ `/automate/knowledge-hub/pdf-files` gibi yanlış alt yol sessizce `/automate/overview`'a yönlendiriyor (404 yok).

### 2.4 Canned responses — Responses list (/automate/canned-responses)

#### İçerik
- "**How does it work?**" kutusu (**Hide ⌃** ile gizlenebilir) — 3 kart (↗ yeni sekmede help center):
  - "Find out how to create and use canned responses" → `https://www.livechat.com/help/set-canned-responses/`
  - "Read more about private canned responses that only you can use" → `…/set-canned-responses/#private-canned-responses`
  - "Learn how to get response suggestions while chatting" → `…/set-canned-responses/#suggested-canned-responses`
- **+ New canned response**; filtre segment **All** / **Shared** / **Private**; arama "Search …".
- Sayaç çubuğu: "**23 canned responses**". Liste (sanal kaydırmalı). Satırda hover'da sağda 3 ikon: ✎ **Edit response**, ⧉ **Create copy**, 🗑 **Delete response**.

#### Mevcut 23 hazır yanıt (hepsi "Added by LiveChat, 14 October 2026"; "SR" = "Suggested response" rozeti)
| # | Kısayol(lar) | Metin | SR |
|---|---|---|---|
| 1 | #transfer | Let me add my colleague to the thread. | |
| 2 | #transfer | Let me forward you to my colleague who will be able to help. | |
| 3 | #product | If you need more details about our features or plans, be sure to ask 😊 | |
| 4 | #product | Which product are you interested in? | |
| 5 | #feedback | We really appreciate that you've shared that with us. Thanks! | ✓ |
| 6 | #feedback | That's a great idea! Thanks for bringing it up! 🙌 | |
| 7 | #feedback | Thank you for your feedback! | ✓ |
| 8 | #ticket | I'm opening a HelpDesk ticket now. You'll get updates over email. | |
| 9 | #ticket | I've opened a ticket for you. All updates will be sent via email. | |
| 10 | #bye | See you later! 👋 | |
| 11 | #bye | It was nice talking to you. Have a great day! 👋 | |
| 12 | #bye | Thanks for visiting 😊 See you around! | |
| 13 | #help | Do you have any other questions that I can help you with? | ✓ |
| 14 | #help | Can I help you with anything else? | ✓ |
| 15 | #sure #anytime | Sure thing! If you have any other questions, I'll be happy to help! | ✓ |
| 16 | #sure #anytime | I'm happy that I could be of help! | ✓ |
| 17 | #sure #anytime | You're welcome! 😊 | ✓ |
| 18 | #wait | Thank you for your patience. | ✓ |
| 19 | #wait | I'm still on it. Please bear with me for a moment. | ✓ |
| 20 | #wait | Give me a moment, I'll check on that for you. | |
| 21 | #hi | Hi there! 👋 How can I help you today? | ✓ |
| 22 | #hi | Hello! 👋 Let me find that out for you. | ✓ |
| 23 | #hi | Hello! 👋 | |


#### Filtre/arama ✅
- Shared → 23; Private → "0 canned responses" + boş durum "**Create private canned response** — Add a personal touch to frequently used responses." + **Create private response**.
- Arama "help" → 7 sonuç (metin içinde "help" geçenler, ör. #transfer "…able to help", #ticket "HelpDesk").
- Arama `zzz<>%'"` → "0 canned responses — **No canned responses found** — Try adjusting your search or show all canned responses in this group" + **Show all responses** (aramayı temizler → 23).
- ⚠️ Arama "#bye" → **0 sonuç** (kısayolla, # önekli arama çalışmıyor; kullanıcılar sohbette #kısayol kullandığı için beklenmedik).
- Edit/Copy/Delete: Edit ✅ açıldı (aşağıda); **Create copy** ⛔ (kopya oluşturur), **Delete response** ⛔.

#### Form: Create Canned Response (`/automate/canned-responses/new`)
- Başlık "X Create Canned Response". Segment **Shared** ("All group members will have access to this canned response") / **Private** ("Only you will have access to this canned response").
- **Group selection** dropdown (G General).
- **Response text** (placeholder "Frequently used response..."; sol altta **{x}+** değişken butonu → `%customer-email%`, `%customer-name%`, `%agent-name%`, `%agent-email%`). Boşken kırmızı + "ⓘ **Enter your response.**" (form açılır açılmaz gösteriliyor ⚠️).
- **Shortcuts ⓘ** (tooltip "To use the response in a chat, type # and your shortcut.") — "#Type shortcut..." chip girişi, "Hit enter to add a new one".
- **Automate tasks (optional)**: "Suggest this response when" — **How does it work ⓘ** (tooltip "Receive response suggestions while talking to your customer. Learn more") — **Select events** çoklu seçim: Chat was started / Chat was transferred / Chat went idle / Chat was rated as good / Chat was rated as bad / AI canned response was proposed.
- "Assign tags" **0/10 tags** — **Select tags**: complaint / positive feedback / sales / spam / support — "Automatically assign tags to the chat in which canned was used".
- Alt: ☐ **Create another one** · **Cancel** · **Save** ⛔ (metin boşken disabled; metin girilince enabled).
- Edge-case: ⚠️ Kısayolda boşluk kabul ediliyor ("#my test" chip'i oluştu) — sohbette `#my test` yazımı belirsiz. ⚠️ Değişken menüsü Esc ile kapatılınca metne tek başına "%" karakteri kalıyor. HTML (`<b>bold</b>`) düz metin olarak kalıyor. Cancel → "You have unsaved changes" (Stay here / Discard changes) ✅.

#### Form: Edit Canned Response (`/automate/canned-responses/<id>`, ör. `/1`)
- Aynı form, başlık "Edit Canned Response", mevcut değerlerle dolu (ör. "Let me add my colleague to the thread." / #transfer). Butonlar **Cancel** / **Save** ⛔. Değişiklik yokken Cancel onay sormadan döner ✅.

### 2.5 Canned responses — Suggested responses (/automate/suggested-responses)
- Açıklama: "Get canned response suggestions while chatting with your customers. Help your agents reply faster and work more efficiently by setting up response suggestions for each group. **Learn more**"
- "**Event-based suggestions**" — segment **Shared** / **Private**.
- Satırlar (When … suggest responses:):
  - 💬 chat was started → #hi, #hi
  - 🔄 chat was transferred → "No responses selected"
  - 🕒 chat went idle → #help, #help, #sure #anytime, #wait, #wait
  - 👍 chat was rated as good → #feedback, #feedback, #sure #anytime, #sure #anytime
  - 👎 chat was rated as bad → #feedback, #feedback
- Satır hover'ında **Edit ✎** → satır içinde "Search shared responses" çoklu seçim kutusuna dönüşür; liste tüm paylaşılan hazır yanıtları (#kısayol + metin) gösterir. Seçim anında kaydedileceği için ⛔ seçim yapılmadı; Esc ile değişmeden kapandı ✅.
- Alt bilgi: "To disable event suggestions for everyone in group edit each event above and clear all canned responses." · "**How can you disable suggestions for yourself?** While chatting, open the canned response picker (#) and switch off Event-based suggestions. **Check how**".

- Suggested responses › **Private** sekmesi: beş olayın hepsi "No responses selected" (kişisel öneri yok); satır hover'ında Edit.

### 2.6 Routing rules (/automate/groups-routing)

#### İçerik
- "**Shortcuts to helpful stuff**" (Hide ⌃) — 3 kart (help center ↗): "Get to know how Routing rules works" · "Learn how to customize the Chat Widget for each of your websites" · "Learn how Groups can improve your workflow".
- "**Set up routing rules** — Route customers from specific pages or locations to the right team of agents. Rules are run in priority order, from the top of the list." + **Add new rule**.
- Boş durum: "**Rules + groups = a perfect match** — Routing Rules work best with multiple groups. Learn how to build your flows using groups and rules together." + **Learn more**.
- Alt kutu (fallback): "Route customers to [G General ▾]" — tek seçenek **General** ✓ (seçim anında kaydedebileceği için değiştirilmedi ⛔).

#### Akış: New rule (`/automate/groups-routing/add`)
- Başlık "X New rule". Sol: "**When a customer meets conditions below** ⓘ" (tooltip "Add the URL address or customer's location, or both as a trigger for performing a particular action."). Sağ: "**Then do the following action** ⓘ" (tooltip "Decide whether you want to route chats to a particular group or turn the chat widget off when the conditions are met.").
- Varsayılan koşul kartı "**Customer who visits URL adresses that:**" (🗑) — [Contains ▾ / Is exactly] + "Enter the URL" + ✕; "+ Add another URL".
- **+ Add condition** menüsü: Customer visits URL (zaten eklendiği için pasif) · **Customer visits domain** → kart "Customer who visits domain that:" [Contains] "Enter the domain" + "+ Add another domain"; koşullar arasında "**And**" · **Customers location** 🔒 (hover: "**Upgrade to unlock customer's location condition** — Routing chats based on customer's location isn't available in your plan." + **View pricing plans** — tıklanmadı).
- Eylem (radyo): ◉ **Route to group:** [G General ▾] — "Customers will start a chat with agents from the group you have picked" · ○ **Turn chat off** — "Customers won't see a chat widget at all, and you won't be able to see them in the Traffic section."
- Alt çubuk: **Cancel** · **Save changes** ⛔ (tüm değer alanları dolana kadar disabled).
- Edge-case: ⚠️ URL alanına "abc" yazmak geçerli kabul edildi (doğrulama yok), domain "example.com" girilince **Save changes etkinleşti**. ⚠️ Başlıkta yazım hatası: "URL **adresses**" (doğrusu "addresses"). Cancel → "You have unsaved changes" (Stay here / Discard changes) ✅.

### 2.7 Workflows **Beta** (/automate/workflows) — iframe `workflows.livechatinc.com/workflows/livechat`

#### Karşılama sayfası
- "**Welcome to Workflows** — Automate your work with an app integration platform. Use AI to quicken the process. Enjoy a simple, no-code setup to streamline tasks you would otherwise do manually."
- **Start from scratch** → kart **Empty workflow**.
- **Start with a template** — filtreler: **Product: All** (All / LiveChat / HelpDesk / OpenAI / Mailchimp / Salesforce / Hubspot / Slack / Shopify) · **Category: All** (All / Notifications & alerts / Lead collection / Chat management / Customer experience / Ticket management). Örn. Category = Lead collection → 8 şablon ✅.
- Şablon kartları (kategori · ad · kullanılan uygulama ikonları) — sayfadaki tam liste: Welcome new chat visitors (Customer experience) · Ticket when chat starts (Notifications & alerts) · Ticket on competitor mention (N&A; LiveChat+OpenAI+HelpDesk+Mailchimp ikonları) · Ticket on bad rating (N&A) · Tag order issue chats (CX) · Support case follow-up (Ticket mgmt) · Show Salesforce profile to the agent on chat start (CX) · Show contact profile to agents (CX; HubSpot) · Share chat insights as tickets (Chat mgmt) · Route chats by product interest (Chat mgmt) · Remind teammates to ask for reviews (Chat mgmt) · Recover from bad ratings (CX) · Qualify chat leads with AI and sync to Salesforce and Slack (Lead) · Qualify chat leads with AI (CX) · Notify during transfers (Chat mgmt) · Monitor new chat quality (Chat mgmt) · Message visitors who leave (CX) · Mark as spam and close (Ticket mgmt) · Log support tickets in HubSpot (CX) · Log support tickets as Salesforce cases (CX) · Handle after-hours chats (CX) · Flag urgent chats (CX) · Flag churn risk when a customer rates poorly (CX) · Escalate to manager (Ticket mgmt) · Email chat transcript to visitor (CX) · Daily chats report to Slack (N&A) · Customer feedback request (Ticket mgmt) · Create Shopify customer from finished chat (Lead) · Create a ticket with summary (Chat mgmt) · Create an upsell case after a ticket is resolved (Lead) · Clarification for customer (Ticket mgmt) · Capture new leads from first-time support chats (Lead) · Auto-tag by keywords (Chat mgmt) · Auto-reply to ratings (CX) · Assist with chat transfers (Chat mgmt) · Add new contacts to Salesforce from support tickets (Lead) · Add leads to marketing tools (Lead) · Add leads to Mailchimp (Lead) · Add leads to HubSpot (Lead).
- **Import from file** — "Upload — Click or drag & drop a .json file" ⛔ (dosya seçilmedi).
- ⚠️ Editör içi Templates panelindeki sekme adları sayfadaki kategori adlarından farklı: "All 39 · Chats 8 · Customer experience 14 · Lead collection 8 · Notifications 4 · Tickets 5" (sayfada "Chat management", "Notifications & alerts", "Ticket management").

#### Workflow editörü (Empty workflow / şablon)
- Üst çubuk: X · ad (ör. "untitled_445" ▾) · rozet **Draft** · sağda **Publish** ⛔ (boş akışta disabled).
- Ad menüsü ▾: **Rename** (satır içi düzenleme) · **Import from file** · **Export to file** (indirme ⛔) · **Discard draft** ⛔.
- Tuval: "+ Add trigger" → "+ Add action" düğümleri; altta **Templates** butonu (arama "Search template..." + kategori çipleri, şablon kartları; ✕ ile kapanır).
- İlk şablon açılışında ipucu: "**Publish changes** — Customers won't see the changes you made until you publish them." **Got it** / **Don't show me again**.
- Düğüm hover'ında ↻ (değiştir) ve 🗑 (sil) ikonları; düğüm başlığına tıklama → satır içi yeniden adlandırma; düğüm gövdesine tıklama → sağ panel.
- Örnek panel "**2. Send message** — Sends a message in a currently ongoing chat." — **Sender** [Current chat agent / Me (workflow creator) ✓] · **Who can see this message?** [Everyone in the chat ✓ / Only teammates] · **Message** ("Welcome to our service! How can we assist you today?").

##### Tetikleyici kataloğu (Add trigger, "Search trigger...")
- **Built-in › General**: Time schedule · Manual trigger · Webhook trigger
- **Customers**: Customer email set · Customer custom fields updated
- **Chats**: For selected chat (**Manual** rozeti) · Chat started · Chat rated · Specific keywords in chat · Chat ended · Chat transferred · Chat commented · Chat tagged · Customer left chat · Chat inactivity · Product card event
- **Tickets**: For selected ticket (**Manual**) · Ticket created · Ticket updated · Ticket status changed · Ticket priority changed · Ticket tags changed · Ticket followers changed · Ticket assignment changed · Ticket custom fields changed · Ticket message added · New message from requester · Any agent message · New message to requester · New private note
- **Apps › Hubspot**: Contact created · Contact deleted · **Mailchimp**: New subscriber · New unsubscriber · **Slack**: New channel message · New mention · Reaction added
- Her öğenin yanında ⓘ açıklama ikonu.

##### Eylem kataloğu (Add action, "Search action...")
- **General**: Webhook · Conditional paths · Wait · End workflow · Collect data from agent · Notify Agent · AI Agent reasoning · Detect language · Match agent
- **Customers**: Get customer · List customers · Update customer · Ban customer · Set customer custom fields
- **Chats**: Transfer chat · Tag chat · Get chat transcript · Send message · Supervise chat · Send chat transcript · Close chat · Get chat details · Get chats report · Get agent status · Get chat inactivity · List archived chats
- **Tickets**: Add followers to ticket · Add tags to ticket · Create a ticket · Find ticket · List tickets · Send message to a ticket · Send follow-up to a ticket · Set ticket assignment · Set ticket status · Set ticket priority · Summarize ticket · Set custom fields · Remove tags from ticket · Remove followers from ticket · Move ticket to spam
- **Apps › Hubspot**: Create contact · Get contact · Find contact by email · Update contact · Create note
- **Klaviyo**: Get profile · Create or update profile · Track event · Subscribe profile · Unsubscribe profile
- **Mailchimp**: Send campaign · Add or update subscriber · Archive subscriber · Delete subscriber · Add subscriber tag · Delete tag from subscriber · Get subscriber
- **OpenAI**: Extract order · Text sentiment · Summarize text · Check moderation · Categorize text
- **Salesforce**: Get account · Get contact · Get lead · Find account · Find contact by email · Create account · Create contact · Update contact · Update account · … (liste kaydırmalı devam ediyor — tamamı okunamadı)
- **Shopify**: Create customer · Get customer · Get customer orders · Get order · Get product · Update order · Update customer
- **Slack**: Send message · Create channel · Send direct message · Send private message · Find user by email

#### Edge-case / bulgular
- ⚠️ "Empty workflow" tıklanır tıklanmaz "untitled_445" adlı bir **Draft** oluşturuluyor (sunucu tarafında taslak yaratılmış olabilir); X ile çıkınca liste sayfasında görünmedi (karşılama ekranı aynen kaldı) — boş taslağın kalıcı olup olmadığı belirsiz. Taslağa düğüm eklenmedi, Publish yapılmadı.
- ⚠️ Şablon editöründen X ile çıkış "unsaved/publish" uyarısı vermeden kapanıyor.
- ⚠️ Tüm içerik iframe'de; erişilebilirlik ağacından okunamıyor.
- ⚠️ "Trigger" listesinde "Apps" altında Klaviyo/OpenAI/Salesforce/Shopify yok, eylemlerde var (tetikleyici desteği yalnız HubSpot/Mailchimp/Slack).

---

## 3. Genel bulgular (Engage + Automate)
- ⚠️ **Deep link / yenileme kapısı**: her tam sayfa yüklemesinde `/install-code` kapısı; "I don't want to chat yet" ile geçiliyor ama yenilemede tekrar geliyor.
- ⚠️ **Tutarsız "unsaved changes" koruması**: Campaigns, Canned responses, Routing rules'ta var (Campaigns'te yanlış pozitif); Goals (← ok), Chatbots (Cancel), Workflows (X) — yok.
- ⚠️ **Doğrulama tutarsızlığı**: Knowledge hub URL doğruluyor ("It doesn't seem like a real website"), Chatbot "Add website" ve Routing URL doğrulamıyor.
- ⚠️ **Otomatik yan etkiler**: Overview'daki "Tell me more" butonları Copilot'a otomatik mesaj gönderiyor; "Empty workflow" anında taslak oluşturuyor.
- ⚠️ **Ortak oturum sorunu (test ortamı)**: Paralel ajanlar yüzünden bu oturumda MCP sekme grubu iki kez kapandı; her seferinde yeni sekme açılıp kapı geçildi.
- 🔒 Plan/trial kilitleri: Chatbot "Custom answers" (Premium, "Get started"), Chatbot web sitesi 200 sayfa sınırı ("upgrade your chatbot"), Routing "Customers location" ("Upgrade to unlock…/View pricing plans"), her sayfada "14 days left in your trial · Upgrade now".

## 4. Ulaşılamayanlar / test edilmeyenler (ve nedenleri)
- **Traffic gerçek ziyaretçi listesi** (kolonlar, filtreler, ziyaretçi detayı, Start chat/Supervise): widget kurulu olmadığı için yalnızca boş durum var.
- **Kalıcı/dışa dönük eylemler** (⛔ hiçbiri tetiklenmedi): Send invites, Copy invite link, Save campaign, kampanya Status/Multiple campaigns anahtarları, Duplicate/Delete kampanya, Close banner'lar, Create goal, Add chatbot, Add website/Add PDF (scrape/upload), Get started (Premium), Save canned response, Create copy/Delete response, Suggested responses seçimleri, Routing fallback değişimi, Save changes (rule), Publish/Discard draft/Export/Import (workflow), I'm interested in AI Agents, View pricing plans, Contact our Support.
- **Kampanya istatistikleri / Conversion / Last 7 days stats** kolonlarının dolu hali: veri yok (0/–).
- **Goals listesi ve düzenleme**: hiç hedef yok; oluşturma kaydedilmediği için liste/düzenleme/silme ekranları görülemedi.
- **Chatbot listesi/düzenleme, Knowledge hub kaynak satırları**: kaydedilmiş öğe yok.
- **Routing kuralı listesi (sıralama/öncelik sürükle-bırak)**: kural yok.
- **Workflow düğüm yapılandırmaları**: yalnızca şablondaki "Send message" paneli açıldı; diğer ~80 tetikleyici/eylemin parametre panelleri, taslağı kalıcı değiştirmemek için açılmadı. Salesforce eylem listesinin sonu okunamadı.
- **Dosya seçicileri** (PDF, workflow .json, kampanya görseli Custom yükleme): OS dosya penceresi açılmaması için tetiklenmedi.
- **ChatBot önizleme sohbeti** ve "Go to advanced configurator" linkinin hedefi (iframe içinde, href okunamadı; tıklanmadı).
- **Copilot** serbest soru gönderme (yalnız otomatik "Tell me more" istemleri istemeden gönderildi).


---
<a id="s3"></a>

# 03 — Archives, Team, Reports (BFS dokümantasyonu)

Hesap: lisans 19985624, trial (ekranda "14 days left in your trial" + "Upgrade now"). Tarih: 2026-10-14. Hesapta tek ajan var (hesap sahibi, Admin/Owner), tek grup ("General"), hiç sohbet yok (widget kodu kurulu değil).

Etiketler: ✅ test edildi · ⛔ onay bekliyor (tetiklenmedi) · ⚠️ bulgu · ↗ dış link · 🔒 plan/trial kilidi

---

## 0. Genel engel: `/install-code` onboarding yönlendirmesi ⚠️

- **İçerik:** Bu oturumda `/archives`, `/team`, `/team/agents`, `/reports`, `/reports/total-chats`, `/home`, `/engage/traffic`, `/settings/code` adreslerinden herhangi birine **tam sayfa yükleme (adres çubuğu / reload / deep link)** ile gidildiğinde uygulama anında `https://my.livechatinc.com/install-code` sayfasına yönlendiriyor ("Start using LiveChat on your website now", kod kopyalama kutusu, "Invite your developer", "Install guide", "Connect with Google Tag Manager", "More integrations +11", "I don't want to chat yet").
- `/subscription` tam yüklemede yönlendirilmiyor. ✅ Buradan **uygulama içi (SPA) sol menü linkiyle** Archives/Team/Reports'a geçildiğinde sayfalar normal açılıyor. Tüm bu bölümün dokümantasyonu bu yolla yapıldı.
- `history.pushState` + `popstate` ile yönlendirme denemesi ve install-code sayfasındaki gizli sidebar linkine JS ile tıklama → yine `/install-code`'a dönüyor (route guard).
- "I don't want to chat yet" butonu muhtemelen onboarding'i kalıcı olarak geçiyor → ⛔ onay bekliyor (tetiklenmedi; hesaba kalıcı durum yazar).
- **Sonuç / ⚠️ bulgu:** Archives filtre URL'leri (deep link) ve Reports URL'leri bu hesapta paylaşılabilir/yeniden yüklenebilir değil; reload filtreleri değil, tüm sayfayı kaybettiriyor. "Reload sonrası filtre kalıcılığı" bu yüzden test edilemedi.
- install-code sayfasında sağ üstte "New message" toast'u ve sağ altta LiveChat widget (Open chat / Dismiss) görünüyor.

---

## Archives (https://my.livechatinc.com/archives)

### Ana görünüm (3 sütun)

**İçerik**
- Sol sütun başlığı **"Archives"** + sağında liste görünümü ikonu (sliders).
- Orta sütun başlığı **"Chat"**. Boş durum: takvim/hashtag illüstrasyonu, **"Nothing in your Archives yet"**, "Archives organize and hold all your finished chats. To start receiving chats, first install your LiveChat.", mavi **"Install LiveChat"** butonu, altında "Or **invite developer**" linki.
- Sağ sütun: müşteri detay paneli için iskelet (skeleton) yer tutucuları — veri olmadığı için sürekli skeleton.
- Sol liste veri yokken sürekli **skeleton (loading görünümlü)** satırlar gösteriyor. ⚠️ Boş veri, yükleniyor gibi görünüyor; liste tarafında "boş" mesajı yok.
- Arama kutusu ("Search in archives…"), "Add filter", "0 chats" sayacı ve "Newest" sıralama **sohbet yokken ve filtre yokken DOM'da var ama gizli** (`display:none`). Herhangi bir filtre eklenince görünür hale geliyor. ⚠️ Kullanıcı ilk girişte arama/filtre alanını göremiyor; "Add filter" yalnızca gizli DOM üzerinden açılabildi (aşağıya bakın). Filtre bir kez eklenip "clear your search" ile temizlendiğinde arama çubuğu görünür kalıyor ve liste alanı tamamen boş (ne skeleton ne mesaj).

**Öğeler & durumlar**

| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Liste görünümü ikonu (sliders) | Dropdown | "LIST VIEW:" → Detailed / Default (varsayılan, seçili) / Compact radyo seçenekleri. Seçim anında değişiyor; boş veride görsel fark yok. Esc ile kapanıyor. | ✅ (test sonrası Default'a geri alındı) |
| Search in archives… | Text input | Enter ile arar; URL'ye `query=` eklenir. Sağda "Clear" (x) butonu. | ✅ |
| Add filter | Menü butonu | Date, Agent, Group, Rating, Tag, Assignment, Availability, Country. Eklenmiş filtrelerin yanında ✓ işareti görünür. | ✅ |
| "0 chats" | Sayaç | Sonuç sayısı | ✅ |
| Newest / Oldest | Toggle buton | Tıklayınca menü açmadan Newest ↔ Oldest arasında geçiş yapar. URL'ye yazılmıyor. | ✅ ⚠️ (sıralama deep link'te korunmaz) |
| Install LiveChat | Buton | `/settings/code` sayfasına gider (Settings kapsamı); tarayıcı geri tuşu Archives'a sorunsuz döner | ✅ |
| invite developer | Link | "Invite people to LiveChat" modalını açar (aşağıda). ⚠️ `find`/ref ile yapılan ilk tıklamada hiçbir şey olmadı; koordinatla ikinci tıklamada açıldı. | ✅ |
| Filtre çipi `<` / `>` | İkon buton | Date çipinde, aralığı aralık uzunluğu kadar geri/ileri kaydırır (14 günlük aralık → 14 gün). | ✅ |
| Filtre çipi `×` | İkon buton | Filtreyi kaldırır | ✅ (görüldü) |
| "clear your search" | Link (sonuç yok durumunda) | Tüm filtreleri + aramayı temizler, URL `/archives`'e döner | ✅ |

### Filtreler (Add filter menüsü)

Her filtre çipe tıklanınca popover açılır: başlık (ikon + ad), "0 chats" (anlık eşleşen sayısı), seçim kutusu, bazılarında "Close"/"Done".

| Filtre | Seçenekler | URL parametresi | Notlar |
|---|---|---|---|
| **Date** | Today, Yesterday, Last 7 days, Last 30 days, Last month, Current month, Custom period | `date_from=YYYY-MM-DD&date_to=YYYY-MM-DD` | Custom period → iki aylık takvim (Eylül 2026 / Ekim 2026), `«` `‹` `›` `»` gezinme, Pzt başlangıçlı. Bugünden (14 Eki) sonraki günler pasif (gri). Aralık 7–20 Eyl seçildi → çip "Date is 7 Sep 2026 - 20 Sep 2026". ✅ |
| **Agent** | Hesaptaki ajan(lar) (ad + e-posta). Çoklu seçim (çip + ✓). | `agent[]=<e-posta>` | ⚠️ Ajanın e-posta adresi URL query string'inde açık metin olarak taşınıyor (paylaşılan linkler/loglar için PII sızıntısı). ✅ |
| **Group** | "G General" | `group[]=0` | ✅ |
| **Rating** | Any rating, Not rated, Rated bad, Rated good, Rated & commented, Rated bad & commented, Rated good & commented | `rate=rated_good` | Tekli seçim. ✅ |
| **Tag** | Not tagged, positive feedback, sales, spam, support, complaint | `tag[]=sales` | Sağ üstte eşleşme modu: **Match any (OR)** (varsayılan) / **Match all (AND)** / **Exclude (IS NOT)**. Sayaç "1/20 selected" → en fazla 20 etiket. "Done" butonu. Exclude seçilince çip "Tag is not sales", URL'ye `op:exclude[]=tag`. ✅ |
| **Assignment** | Unassigned, Assigned | `agent_assignment[]=unassigned` | ⚠️ "Unassigned" seçilince mevcut **Agent filtresi sessizce kaldırıldı** (karşılıklı dışlayıcı, uyarı yok). ✅ |
| **Availability** | Başlık "Status when chat started": Online (Accepting chats) 🟢 / Offline (Not accepting chats) 🔴 | `availability=online` | ✅ |
| **Country** | Arama yapılabilir ülke listesi ("Tur" → Turkey, Turkmenistan, Turks and Caicos Islands); "zzzz" → "No results found". Match any modu; "1 selected" sayacı. | `countries[]=TR` | ✅ |

**Edge-case / bulgular**
- ✅ Özel karakterli arama (`test <b>'"%&`) güvenli şekilde URL-encode edildi (`query=test%20%3Cb%3E%27%22%25%26`), HTML olarak render edilmedi (XSS yok).
- ✅ Sonuç yok durumu: büyüteçli konuşma balonu ikonu, **"Darn, no results found"**, "Check your filter combination or **clear your search** and try again".
- ✅ Date `>` (ileri) oku, bir sonraki dönem bugünü aşacaksa önce gizleniyor/pasifleşiyor (21 Eyl–4 Eki aralığında pasif).
- ⚠️ Çok sayıda filtre eklenince çipler dikey yığılıyor ve liste alanını aşağı itiyor (6 filtrede liste görünür alanın yarısından aşağıda başlıyor).
- ⚠️ Filtreler URL'de tutuluyor (deep link tasarımı var) ama Bölüm 0'daki yönlendirme yüzünden bu hesapta reload/paylaşım çalışmıyor.
- **Sohbet detayı, transkript, sohbet içi aksiyonlar (etiketleme, export/print, "Copy link", müşteri detayları), toplu seçim, export:** hesapta hiç arşivlenmiş sohbet olmadığı için **ulaşılamadı**. Liste/detay export butonu boş durumda görünmüyor.

### Modal: "Invite people to LiveChat" (Archives → invite developer; aynı modal Team'de de kullanılıyor)

**İçerik:** Başlık "Invite people to LiveChat", sağ üstte ×. Sütunlar "Email addresses" ve "Role". Varsayılan 4 satır; placeholder'lar "Eg. team.leader@outlook.com", "Eg. marketer@outlook.com", "Eg. sales.rep@outlook.com" (dolunca yeni satır eklenir: "Eg. designer@outlook.com"). Sol altta "🔗 Copy invite link", sağ altta "Send invites".

| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| E-posta alanları | Input (dinamik satır) | Son satır doldurulunca yeni boş satır eklenir | ✅ |
| Role | Dropdown (satır başına) | **Admin (billing access)** (varsayılan) / Admin / Agent | ✅ ⚠️ |
| Copy invite link | Link-buton | Davet linkini panoya kopyalar (sunucuda davet linki üretebilir) | ⛔ onay bekliyor (tetiklenmedi) |
| Send invites | Primary buton | Geçersiz alan varken **disabled** | ⛔ onay bekliyor (tetiklenmedi) |
| × | Kapat | Form doluyken onay penceresi açar | ✅ |

**Edge-case / bulgular**
- ⚠️ Modal açıldığında ilk satır **önceden "dev@example.com" ile dolu** geldi (bu sekmede yazılmamıştı) — taslak başka bir oturum/sekmeden (paralel çalışan bir ajan) paylaşılan depolamadan geri yüklenmiş olabilir; davet taslakları sekmeler arasında kalıcı.
- ⚠️ "Invite developer" bağlamında varsayılan rol **en yetkili rol (Admin + billing access)**; geliştiriciye faturalama erişimi vermek güvenlik açısından riskli varsayılan.
- ✅ `abc@` → kırmızı çerçeve + "ⓘ Enter a valid email address"; Send invites disabled.
- ✅ Aynı e-posta iki kez → "Email address is duplicated" (⚠️ gri metin, kırmızı değil — hata stili tutarsız).
- ✅ 200+ karakter e-posta → "ⓘ Email must have max 100 characters".
- ✅ Esc: rol dropdown'ı kapatıyor, modalı kapatmıyor.
- ✅ Form doluyken × → onay diyaloğu: ⚠️ ikon, **"Cancel inviting agents?"**, "If you cancel inviting agents now, they won't join your organization.", butonlar **"Back to inviting"** / **"Cancel inviting"** (kırmızı). "Cancel inviting" taslağı atıp kapattı (yalnız yerel taslak; dışa dönük işlem yok).
- Üst bardaki **"+ Invite"** butonu modal yerine menü açıyor: "Set up ChatBot", "Invite teammate".
- ⚠️ Sol menüdeki "News" linki ↗ `https://app.getbeamer.com/standalone?app_id=...&custom_user_id=<hesap e-postası>` — kullanıcı e-postası üçüncü taraf URL'sinde query parametresi olarak gidiyor.

---

## Team (https://my.livechatinc.com/team)

Başlık "Team"; sekmeler: **Agents** (`/team`), **Chatbots** (`/team/chatbots`), **Groups** (`/team/groups`), **Suspended agents** (`/team/suspended-agents`); sağ üstte **Invite settings ↗** (yeni sekmede `https://accounts.livechat.com/panel/settings/invitations` açar — açıldı ve kapatıldı, içerik incelenmedi). Sekme değişimi URL'yi günceller; tam yüklemede `/install-code`'a yönlenir (Bölüm 0).

### Agents sekmesi (/team)

**İçerik:** "Search agent" kutusu; "Add new chatbot" (ikonlu); mavi "+ Invite agents". Sarı uyarı bandı ⚠️ ikon: **"Some agents can't start chatting"** / "Finish inviting your team" + siyah **"Complete invites"** butonu. Tablo başlığı **"Active (1)"**, kolonlar **Name · Role · Status ↑** (Status sıralanabilir başlık). İlk satır "⊕ Add new agent". Ajan satırı: avatar "A", "azzatenli (You)", e-posta, Role rozeti **"Owner"**, Status "● Accepting chats ˅", "…" menüsü. Sağda **Details** paneli (× ile kapanır, satıra tıklayınca yeniden açılır; bölümler sürüklenebilir "draggable sections").

| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Search agent | Input | Anlık filtre, büyük/küçük harf duyarsız ("AZZA" eşleşti); eşleşme yoksa "No matches found."; × ile temizlenir | ✅ ⚠️ "Active (1)" sayacı filtre sonrası değişmiyor |
| Status ↑ | Sıralama başlığı | Tıklanabilir; tek kayıtta görünür fark yok | ✅ |
| Add new agent (satır) | Buton | "Invite people to LiveChat" modalını açar (Archives bölümündeki ile aynı) | ✅ |
| + Invite agents | Buton | Aynı davet modalı | ✅ / Send invites ⛔ |
| Complete invites | Buton | Aynı davet modalı (kalıcı taslakla açılır) | ✅ |
| Add new chatbot | Buton | `/automate/chatbots` sayfasına gider (Automate kapsamı) | ✅ |
| Status dropdown ("Accepting chats ˅") | Dropdown | ● Accepting chats / ● Not accepting chats / ● Log out | ✅ açıldı, seçim ⛔ (canlı durum değiştirir) |
| "…" (agent-actions-dropdown) | Kebab | **Edit profile** · **Change chat limit** · **View agent reports** | ✅ |
| Change chat limit | Modal | "Chats limit": ajan adı/e-posta, "concurrent chats" sayısal alan (6); Cancel / **Apply** (değişiklik yokken disabled). 25 yazılınca blur'da **20'ye kısıtlandı** | ✅ / Apply ⛔ (Cancel ile kapatıldı) |
| View agent reports | Menü öğesi | `/reports/total-chats?agent[]=<e-posta>&date_from=…&date_to=…` (son 7 gün) | ✅ |
| Details paneli | Yan panel | "azzatenli" + Owner rozeti, "Product Expert", e-posta; "Chat limit: 6 concurrent chats", "Login status: Accepting chats", "Last seen: 🖥 Just now"; **Groups (1)** ˅ → "G General"; **Working hours** ˅ → ⏰ "Set working hours to better manage staffing." + "Get feature" / "Learn more"; **Performance** ˅ → Total chats 0 · Goals 0 · Chat satisfaction n/a (her biri ilgili rapora link; Total chats → /reports/total-chats) + "View reports" | ✅ |
| Get feature (Working hours) | Buton 🔒 | `/subscription/upgrade?recommended=business&highlighted=work-scheduler` | 🔒 |
| Learn more (Working hours) | Buton ↗ | Yeni sekme: https://www.livechat.com/help/configuring-the-work-scheduler/ (açıldı, kapatıldı) | ↗ |
| Ajan adı/avatarı (panel) | Link | `/team/agent/<e-posta>` profil sayfası | ✅ ⚠️ e-posta URL yolunda |

### Davet modalı — ek bulgular (Team'den)
- ⚠️ **Taslak kalıcılığı:** Archives'ta girilen geçersiz satırlar (abc@, kopya, 200+ karakter) modal "Cancel inviting" ile kapatılmış olmasına rağmen Team → "Complete invites" ile açıldığında **aynen geri geldi**. "Cancel inviting" taslağı silmiyor; ilk satırdaki "dev@example.com" de her açılışta mevcut (bu oturumdan önce/başka bir sekmeden girilmiş). Sarı "Some agents can't start chatting / Finish inviting your team" bandı bu bekleyen taslakla ilişkili görünüyor. Kendi eklediğim satırlar elle temizlendi; "dev@example.com" bana ait olmadığı için dokunulmadı.
- ⚠️ Temizlenen boş alanda "Enter a valid email address" hatası boşaltıldıktan sonra da kalıyor (blur'a kadar bayat doğrulama).
- Esc, "Cancel inviting agents?" onay penceresinde = "Back to inviting" (davet modalına geri döner).

### Profil sayfası (/team/agent/<e-posta>) — "Edit profile"

**İçerik:** "‹ Back" (→ /team), başlık "Profile". Avatar "A" + yeşil durum noktası + mavi "+" (avatar yükleme — dosya seçici, ⛔ tetiklenmedi), "Owner" rozeti, ad, unvan.

| Bölüm | Öğeler | Durum |
|---|---|---|
| Details | **Full name** (input), **Job title** (input), **Chat limit ⓘ** (sayısal, ▲▼; tooltip "How many chats the agent can handle at once"; yardım metni "3 is optimal for rookies"), **Email** (kilitli/disabled, 🔒), **Change password** linki | ✅ / Change password ⛔ (parola girişi yasak) |
| Member of 1 group | "Assign to groups" (**Enter groups** kilitli; hover: "All groups added"), "Find group" arama (zzz → "No matches found"), "G General" çipi | ✅ |
| Agent status after logging in | ◉ Accept chats (seçili) / ○ Don't accept chats / ○ According to working hours (disabled 🔒) + kutu "Add working hours" / "Set custom hours for when the agent will be accepting chats each day." / Get feature / Learn more | 🔒 |
| Two-factor authentication (2FA) | "2FA makes it more difficult for someone else to sign in to your account. Use authentication app like Google authenticator to protect your account." / **Enable 2FA** | ⛔ (güvenlik ayarı, tıklanmadı) |
| Role and permissions | "You're the owner and have all permissions." / **Change owner** → satır içi: sahip dropdown (azzatenli) + Cancel + mavi **Change owner** | ✅ açıldı → Cancel / Change owner ⛔ |
| Time format | ◉ 12-hour (09:23:00 pm) / ○ 24-hour (21:23:00) | ✅ (değiştirilmedi) |
| Email updates | ☑ Daily summary of chats, satisfaction rates, and missed opportunities · ☑ Weekly summary of chats, availability, response times, and team updates · ☑ New unassigned chat | ✅ (değiştirilmedi) |
| Kaydet çubuğu | Herhangi bir alan değişince altta sabit **Cancel / Save changes** belirir | Save ⛔ onay bekliyor (tetiklenmedi) |

**Edge-case / bulgular**
- ✅ Full name boşaltılınca: "ⓘ Name is required", Save changes disabled.
- ✅ Chat limit: 999 → blur'da **20**; 0 → **1** (1–20 arası kıstırma, hata mesajı yok — sessiz düzeltme).
- ⚠️ Kirli (kaydedilmemiş) form varken "Get feature" ile sayfadan çıkılınca **"kaydedilmemiş değişiklikler" uyarısı yok**; değişiklikler sessizce atıldı (kayıt yapılmadı, ad "azzatenli" olarak kaldı — doğrulandı).
- ⚠️ "Change owner" satır içi formunda tek seçenek mevcut sahibin kendisi iken "Change owner" butonu aktif görünüyor.
- ⚠️ Upgrade sayfasındaki "‹" geri oku önceki sayfaya değil `/subscription`'a götürüyor.
- Upgrade sayfası (🔒, yalnız görüntülendi): "Upgrade to Business plan — $79 per agent / mo"; "What you get with the upgrade:" Work scheduler to automate shifts · Team performance metrics · Agent activity report · On-demand scheduled reports · Chat takeover · Private chat messages · Staffing prediction · Apple Messages for Business and SMS · Track up to 1000 customers · Reply Suggestions. Summary: "Team plan ~~$708~~ $588 / yr (saving 16.95%)", "Agents: 1", "Free trial until Oct 28, 2026", Annual total $948, Billed on renewal $948 / yr, **Billed now $0**, **Upgrade to Business** ⛔, "You'll be charged for individual products at the end of their free trial(s). Your subscription will continue until you cancel." `highlighted=` parametresi geldiği yere göre ilgili maddeyi sarı vurgular (⚠️ Chat duration raporundan gelince "Agent activity report" vurgulandı — eşleşme hatalı).

### Chatbots sekmesi (/team/chatbots)
- Boş durum: **"Connect with ChatBot to create a bot"** / "A chatbot is software that simulates human-like conversations with users via text messages on chat. It works as live agent does in LiveChat." / **Connect with ChatBot** (⛔ Connect — tetiklenmedi) / "Learn more" (buton).
- Bot listesi yok (hesapta bot yok).

### Groups sekmesi (/team/groups)

**İçerik:** mavi "+ New group"; "Total (1)"; kolonlar Name · Members · Status ↓; "⊕ Add new group" satırı; satır: "G General / 1 member", üye avatarı "A", "● 1/1 accepting chats", "…". Altta boş-durum tanıtımı: "Create groups to organize your team" / "Groups help to automatically route chats to the right agents based on skill, language, or brand." / "Create group". Sağ Details: "General" + **Default** rozeti, "ID: 0" + kopyala ikonu, "| All agents belong to this group."; Members (1) → azzatenli; Performance (Total chats 0, Goals 0, Chat satisfaction n/a, View reports); **Chat assignment** → "Manage chat assignment" (→ `/settings/chats-assignment`); **Routing rules** → "Manage routing rules" (→ `/automate/groups-routing`).

| Öğe | Davranış | Durum |
|---|---|---|
| "…" (General) | Yalnızca **View reports** (varsayılan grup düzenlenemez/silinemez) | ✅ |
| Satıra tıklama | Ayrı sayfa açmaz; yalnız Details panelini doldurur | ✅ |
| View reports (panel) | Reports'a `group[]=0` filtresiyle | ✅ |
| + New group / Add new group / Create group | "Create a new group" modalı: **Name** (placeholder "e.g. Support team"), **Add members** (varsayılan: mevcut kullanıcı çipi; yazınca "Enter a name or email" ile ajan arama listesi), **Create** | ✅ / Create ⛔ |

**Edge-case / bulgular (Create a new group)**
- ✅ Yalnız boşluk → Create disabled (trim var).
- ⚠️ Mevcut grupla aynı ad ("General") → Create **aktif** (istemci tarafında yinelenen ad kontrolü yok).
- ⚠️ Ad alanında maxlength yok — 131 karakter (`<script>x</script> CCC…`) kabul edildi, uyarı yok; HTML metin olarak gösterildi (XSS yok).
- ✅ Tüm üyeler çıkarılınca: kırmızı "Add at least one member", Create disabled.
- ⚠️ Esc modalı **onay sormadan** kapatıyor ve girilenleri atıyor (davet modalı ise onay soruyor — tutarsız).

### Suspended agents sekmesi (/team/suspended-agents)
- Boş durum: yasak işaretli kişi ikonu, **"No suspended agents"** / "Once you suspend an agent, they'll show up here." / **See active agents** (→ Agents sekmesi). ✅
- Suspend/Remove agent akışı: yalnızca sahip hesabı olduğu ve kebab menüsünde bu seçenek bulunmadığı için ulaşılamadı.


---

## Reports (https://my.livechatinc.com/reports)

Giriş: Team → ajan satırı "…" → "View agent reports" ile (veya sol menü Reports ikonu, SPA içi). `/reports` tam yüklemede `/install-code`'a yönlenir (Bölüm 0).

### Rapor menüsü (sol panel, tamamı) ✅

Sol panel başlığı "Reports"; bölümler katlanabilir (chevron ˅/›). Sağ içerikte başlığın solundaki panel ikonu (`side-navigation-toggle`) rapor menüsünü gizler/gösterir.

| Bölüm | Rapor | URL | Durum |
|---|---|---|---|
| — | My saved views | /reports/saved-views | Boş: "No saved reports views yet" / "Add filters to reports and save them as report views for quick access to the most important data. Your saved views will show up here." / buton "Explore reports" ✅ |
| Summary | Last 7 days | /reports/last-7-days | ✅ (aşağıda) |
| Summary | Dashboard | /reports/dashboard | "View the most important LiveChat metrics all at once." / "Put the dashboard on your wall and monitor the state of your customer service. No seat required!" / "Open dashboard" ✅ |
| Chats | Total chats | /reports/total-chats | ✅ detaylı (aşağıda) |
| Chats | Chat engagement | /reports/chat-engagement | Grafik serileri: From campaigns / Started by customer / Started by agent; "Chat engagement breakdown" + Export CSV ✅ |
| Chats | Missed chats | /reports/missed-chats | "Missed chats" grafik + breakdown + "Missed chats heatmap" (Export CSV ×2) ✅ |
| Chats | Campaigns conversion | /reports/campaigns | KPI: Campaigns displayed, Chats from campaigns (0%). Boş durum: "You had no chats from recurring campaigns during this period" / "Get people chatting with more actionable campaigns." / "Go to campaigns". "Campaigns breakdown" (Campaign · Group · Displayed · Chats · Conversion · Settings): Exit Intent Campaign, Offer discount on your checkout page, Offer help on your pricing page, Welcome returning customers, Welcome your customers — hepsi "General", her satırda "Edit". Agent filtresi bu raporda düşüyor. ✅ |
| Chats | Tags usage | /reports/tags-usage | KPI: Tagged chats (0%), Not tagged chats (0%). Breakdown: Tag · No. of chats with this tag · % of tagged chats; complaint, support, spam, sales, positive feedback ✅ |
| Chats | Chat satisfaction | /reports/chat-ratings | Show benchmark data (🔒), "Average satisfaction rate", Rated good (0%), Rated bad (0%), breakdown ✅ |
| Chats | Chat availability | /reports/availability | "Chat availability" (örn. 29min; ölçek 0 h–8 h), breakdown "Availability"; ikinci kart "Number of chats by status" (Online · Accepting chats / Offline · Not accepting chats) + 24-hour distribution + breakdown ✅ |
| Chats | Chat forms | /reports/chat-forms | Varsayılan çip "Form is Pre-chat form". Boş: "No results for closed questions" / "Closed questions answer will appear here. Give it a try and add choice list to the pre-chat form." / "Configure pre-chat form" ✅ |
| Chats | Chat duration | /reports/chat-duration | 🔒 "Make your team more effective" / "Analyze chats duration for different agents, tags and groups to improve efficiency." / "Upgrade plan" / "Not sure? Chat with us to get more info." |
| Agents | Agent performance | /reports/agent-performance | 🔒 "Key performance metrics in one place" / "Use the agents performance report to find areas where your entire team and individual agents can improve." |
| Agents | Chat response times | /reports/chat-response-times | 🔒 "Shorten your response time" / "Use the response times report to spot agents who could speed up their work." |
| Agents | Staffing prediction | /reports/staffing-prediction | 🔒 "Schedule shifts with ease" / "…check how many agents you'll need to cover chats next week." |
| Agents | Agent activity | /reports/activity | 🔒 "Track and manage employee hours" / "…see when and for how long your agents were chatting." |
| Customers | Queued customers | /reports/queued-visitors | "Queue conversion" (Queued customers, Entered the chat 0%, Left the queue 0%), "Average waiting time" (Time to enter the chat / Time to leave the queue), "Queued customers heatmap"; 3× Export CSV ✅ |
| Customers | Queue abandonment | /reports/queue-abandonment | Boş: "No customers left the queue in the set time period." ✅ |
| Insights | Top customer questions | /reports/top-customer-questions | ⚠️ insights-app.livechat.com iframe; 15+ sn sonsuz spinner |
| Insights | Alerts | /reports/alerts | ⚠️ https://insights-app.livechat.com/alerts iframe; sonsuz spinner |
| Ecommerce | Achieved goals | /reports/goals | "You don't have any Goals set up" / "Create your first Goal to start measuring conversions." / "Create a Goal" ✅ |
| Ecommerce | Tracked sales | /reports/sales | "You don't have any Sales Trackers set up" / "Create your first Sales Tracker to start measuring conversions." / "Create a Sales Tracker" ✅ |
| Export raw data | Generate report | /reports/generate-report | 🔒 "Use raw data to create custom reports" / "Get your customer service data right to your email — daily, weekly, or monthly." / Upgrade plan |
| Export raw data | Scheduled reports | /reports/scheduled-reports | 🔒 aynı metin — zamanlanmış e-posta raporu bu planda kapalı |
| — | Reviews | /reports/reviews | "When a customer leaves you a good review, it's worth sharing with the world!" / "We're constantly selecting the best reviews left by your customers on chats. Show them off on your social media profiles or invite your marketing colleagues to do the work!" / "Invite marketer" / "No reviews yet" / "Reviews are good ratings with longer comments left by your customers on a chat. Once you get them, we'll display them here!" ✅ |

Tüm veri raporlarının altında: "This report was generated on 14 Oct 2026 at HH:MM:SS AM" · "All reports are displayed in your local time." · "Use the Reports API to access this data remotely." ↗ https://platform.text.com/docs/data-reporting/reports-api#total-chats (anchor rapora göre değişir).

### Total chats (ortak rapor şablonu)

| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Save view | Buton → modal | "Save view": "View name" (maxlength 84), "Note: This view will only be visible to you.", Cancel / Save view (boşken disabled) | ✅ / Save ⛔ onay bekliyor (tetiklenmedi) |
| Add filter | Menü | Keyword, Agent, Group, Tag, Assignment, Availability, Country (Archives'tan farklı: Date ve Rating yok, Keyword var) | ✅ |
| Keyword | Popover | "Keyword ⓘ", placeholder `E.g. "missing order" issues`, "Close". Tooltip: "Count the chats where the keywords are present. You can look for specific words, phrases (using quotation marks), tags or agent names." Enter → `query=refund` | ✅ |
| Date çipi | Popover | Today / Yesterday / Last 7 days (varsayılan) / Last 30 days / Last month / Current month / Custom period; "Compare to..." checkbox; "Done". Preset seçimi popover'ı kapatıp uygular. `<` `>` dönem kaydırma | ✅ |
| Compare to... | Checkbox + dropdown | Previous period / Previous year / Custom period. Previous period → çip "Date ②", URL `compare_date_from/compare_date_to`; iki seri (mavi 14 Oct'26, sarı 13 Oct'26), ajan adı, değer ve "View chats →" | ✅ |
| Agent çipi | Popover | Team'den gelirken `agent[]=<e-posta>` otomatik; × ile kaldırılır | ✅ ⚠️ e-posta URL'de |
| 24-hour distribution | Toggle | `group_by=hour`; breakdown kolonları saatlik ("12:00 am 14 Oct'26 vs 12:00 am 13 Oct'26") | ✅ |
| ⓘ grafik başlığı | Tooltip | "This chart shows the number of all chats." + "RECOMMENDATION: Visitors who chat are more likely to convert into customers. See how to engage with visitors and get more chats." (link → /reports/chat-engagement) | ✅ |
| Show benchmark data | Toggle (🔒 disabled) | Hover: "This feature is available in the Business plan. Upgrade and keep track of your competitors' scores." | 🔒 |
| "Serbia, 2-9 employees" ⓘ | Tooltip | "To see benchmark for different industries and locations go to Customer Service Benchmark" ↗ https://www.livechat.com/benchmark/ | ✅ ⚠️ benchmark bölgesi "Serbia" |
| Breakdown kartı | Katlanabilir tablo | Tarih/saat kolonları, "Total", yatay kaydırma | ✅ |
| Export CSV | Buton (her kartta) | CSV indirir | ⛔ onay bekliyor (tetiklenmedi) |
| Heatmap | Grafik | Hover: "14 Oct 4:00 pm · Chats: 0"; Compare açıkken kırmızı: "Comparing filters such as time, groups or agents is unavailable in heatmap visualization." | ✅ |

**Edge-case / bulgular**
- ⚠️ Breakdown tablolarının altında veri gelmiş olsa da kalıcı "Loading..." satırı (Total chats, Chat engagement, Missed chats, Tags usage, Chat satisfaction, Availability, Queued customers).
- ⚠️ Filtreler raporlar arası taşınıyor (Agent filtresi çoğu raporda kalıyor; Campaigns/Queued customers'ta düşüyor).
- ⚠️ Save view adı yalnız boşluk iken "Save view" aktif (trim doğrulaması yok).
- Cancel/× Save view modalını kapatıyor; hiçbir şey kaydedilmedi.

- ⚠️ Date seçim kutusundaki "×" tarihi varsayılana (Last 7 days) sıfırlıyor ve Compare'i de sessizce kaldırıyor. Custom period seçimi Reports'ta popover'ın kendiliğinden kapanması nedeniyle iki denemede açılamadı (Archives'taki aynı iki aylık takvim bileşeni olduğu varsayılıyor).
- "View chats →" (grafik serisi altında) → `/archives?...` aynı agent/date/query filtreleriyle + `offline_message=0` (Reports→Archives çapraz bağlantı) ✅. Archives'ta Date chip "Date is Last 7 days", arama kutusu "refund" ile dolu geldi.
- ⚠️ Rapora özgü olmayan query parametreleri diğer raporlara taşınıyor (örn. Reviews URL'si `?group_by=hour&query=refund` taşıdı).

### Last 7 days (Summary)
- Kart "Total chats" + sağ üstte segment **My stats / All agents** (varsayılan All agents). Değer "0" ve "+0 from previous 7 days"; gün ekseni Thu…Wed.
- Boş durum: konuşma balonu, **"No chats yet"** / "It's ok to start by **chatting with yourself**" ↗ `https://cdn.livechatinc.com/preview/19985624` (widget önizleme).
- Alt satırlar: Queued visitors (All agents: 0, My stats: **n/a**), Goals "+ Add" (→ Engage goals oluşturma sayfası), Sales "+ Add" (→ `/settings/sales-tracker/add`), Chat satisfaction "-". ✅ (Add butonları yalnızca sayfaya götürür; oluşturma yapılmadı)

### Chat forms — Form filtresi
- Form çipi seçenekleri: **Pre-chat form** (varsayılan, `survey=prechat`) / **Post-chat form** (`survey=postchat`). Post-chat seçilince metin "...add choice list to the post-chat form." ve buton "Configure post-chat form".
- Bu raporda Add filter yalnızca **Agent, Group, Tag**; Keyword çipi URL'de olduğu halde gösterilmiyor, Compare düşüyor ve tarih "Today" olarak görünüyor. ⚠️ bir görsel hata: Form çipinin üstünde hayalet tooltip ("Pre-chat form") kalıyor.

### Kilitli raporlar (🔒 ortak şablon)
Chat duration, Agent performance, Chat response times, Staffing prediction, Agent activity, Generate report, Scheduled reports: başlık + açıklama + örnek grafik görseli (ör. Chat duration: "Average chat duration — Jane: 11min 9s / Tom: 17min 7s", benchmark toggle'lı örnek) + **Upgrade plan** (→ `/subscription/upgrade?...`, yalnız görüntülendi) + "Not sure? **Chat with us** to get more info." (LiveChat destek widget'ını açar — mesaj gönderilmedi, tıklanmadı).

### Dashboard
- "Open dashboard" bir `<button>` (href yok; büyük ihtimalle yeni pencerede TV/duvar dashboard'u açar) — tıklanmadı/harici pencere açacağı için kaydedildi.

---

## Ulaşılamayanlar / sınırlamalar

1. **Arşivlenmiş sohbet yok** → Archives sohbet detay görünümü, transkript, müşteri detay paneli (sağ sütun yalnız skeleton), sohbet içi aksiyonlar (tag ekleme, export/print/download transcript, "Copy link", follow-up, ban vb.), toplu seçim, sayfalama ve sonuçlu liste görünümleri (Detailed/Default/Compact farkı) test edilemedi. Paralel bir ajan Chats'te bir sohbet başlatmıştı, ancak oturum sonunda arşive düşmemişti.
2. **`/install-code` yönlendirmesi**: tüm deep link / reload testleri (filtre kalıcılığı, paylaşılabilir URL) yapılamadı; gezinme yalnız `/subscription` → SPA menüsü yoluyla mümkün oldu. Koordinatörün önerdiği "Invite your developer → Skip" yolu onboarding'i kalıcı olarak değiştirebileceği için kullanılmadı.
3. **Insights raporları** (Top customer questions, Alerts): `insights-app.livechat.com` iframe'i yüklenmedi (sonsuz spinner).
4. **Kilitli (🔒) raporlar**: Chat duration, Agent performance, Chat response times, Staffing prediction, Agent activity, Generate report, Scheduled reports — Business plan gerektiriyor; iç ekranlar (granülerlik, zamanlanmış rapor formu vb.) erişilemez.
5. **Tek kullanıcılı hesap**: başka ajan/rol, suspend/remove, rol değiştirme, grup düzenleme/silme (varsayılan grup kilitli), bot detay sayfası mevcut değil.
6. **⛔ Bilerek tetiklenmeyenler**: Send invites, Copy invite link, Save view, Save changes (profil), Apply (chat limit), Change owner, Enable 2FA, Change password, avatar yükleme, Create (grup), Connect with ChatBot, Export CSV (tüm kartlar), Upgrade to Business, ajan durumu değiştirme (Accepting/Not accepting/Log out), "I don't want to chat yet".
7. Reports'ta Custom period takvimi ve geçersiz tarih aralığı denemesi (popover kapanma sorunu) tamamlanamadı; Archives'ta takvim gelecekteki günleri pasif gösteriyor.
8. Sayfa içeriğinde ajana yönelik talimat içeren metin görülmedi.




---
<a id="s4"></a>

# 04 — Apps, HelpDesk, Billing (BFS keşif raporu)

Hesap: lisans 19985624, Team planı deneme sürümü (trial: "14 days left", deneme bitişi **Oct 28, 2026**). Tarama tarihi: 2026-10-14. Kullanılan sekme: yalnızca bu ajanın kendi sekmesi.

Etiketler: ✅ test edildi · ⛔ onay bekliyor (tetiklenmedi) · ⚠️ bulgu · ↗ dış link · 🔒 plan/trial kilidi

> ⚠️ **Genel bulgu (oturum):** Yeni sekmede `/apps/marketplace/apps` açıldığında uygulama ilk yüklemede **`/install-code`** (“Start using LiveChat on your website now”) onboarding ekranına yönlendirdi; aynı anda grup içindeki diğer tüm LiveChat sekmeleri de `/install-code`'a atladı (sekmeler arası durum senkronu). ~10 sn sonra tekrar gidince normal sayfa açıldı. Onboarding ekranındaki “I don't want to chat yet” tıklanmadı.

---

## Billing (https://my.livechatinc.com/subscription)

Sol ana menüde “Billing” (kart ikonu) → `/subscription`. Billing alt kenar çubuğu: **Subscription**, **Invoices**, **Account details**. Sayfa başlığının solundaki panel ikonu (“Show sidebar” / gizle) alt kenar çubuğunu aç/kapat yapar ✅.

⚠️ Alt menüdeki “Subscription / Invoices / Account details” öğeleri `<a>` olarak işaretli ama **`href` yok** (JS ile yönlendirme) → orta tıklama/yeni sekmede açma çalışmaz, erişilebilirlik sorunu.
Doğrudan URL'ler (deep link) çalışıyor ✅: `/subscription`, `/subscription/manage`, `/subscription/invoices`, `/subscription/account-details`.

Yükleme durumu: içerik gelene kadar gri iskelet (skeleton) blokları gösteriliyor (~3-5 sn).

### Subscription — “Choose your plan” (/subscription)

**İçerik**
- Başlık: “Choose your plan”
- Fatura döngüsü radyo grubu: **Annual (save up to 17%)** [varsayılan seçili] / **Monthly**
- “Recommended for businesses of your size” oku → Business kartı (mavi çerçeve vurgusu)
- 4 plan kartı:

| Plan | Açıklama | Yıllık fiyat | Aylık fiyat | CTA | Rozet |
|---|---|---|---|---|---|
| Starter | Bare essentials to start chatting with customers. | $19 per agent / mo | $25 per agent / mo | Choose plan (beyaz) | — |
| Team | Full customization, targeting, and team management. | $49 per agent / mo | $59 per agent / mo | Choose plan (beyaz) | **CURRENT TRIAL** |
| Business | Key features, advanced reporting, and workflow automation. | $79 per agent / mo | $89 per agent / mo | Choose plan (mavi, birincil) | Recommended |
| Enterprise | Security, and controls. | Let's talk | Let's talk | Request a call | — |

- Kart özellik listeleri:
  - **Starter — Key features:** Text Intelligence · Track up to **100 customers** · **1** recurring campaign · **60-day** chat history · **Basic** widget customization · **24/7/365** Support · **1** user
  - **Team — Everything in Starter, plus:** Text Intelligence · Track up to **400** visitors · **Unlimited** campaigns · **Unlimited** chat history · **Full** widget customization · **Basic** reporting · **Unlimited** users
  - **Business — Everything in Team, plus:** Text Intelligence · Track up to **1000** visitors · Apple Messages for Business integration · Work scheduler · Staffing prediction · On-demand reporting · **Advanced** reporting · Agent performance
  - **Enterprise — Everything in Business, plus:** Text Intelligence · Customize tracking limit · Dedicated account manager · Dedicated onboarding · **White label** chat widget · Software engineer support · **Single Sign-on** (SSO) · **HIPAA** Compliance · Alternative payment terms · **Professional** services
- Alt link: **See all features** (span, `data-testid="all-features-button"`) → karşılaştırma modalı.

**Öğeler & durumlar**

| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Annual / Monthly | Radyo | Fiyatları anında değiştirir (19/49/79 ↔ 25/59/89). Kayıt yok. | ✅ |
| Özellik satırları (ör. “Text Intelligence”, “Track up to 100 customers”) | Hover tooltip | “Text Intelligence” → “Copilot, who guides you through onboarding, account setup, and using LiveChat, along with our other customer service products.” · “Track up to 100 customers” → “How many visitors you can view in real-time.” | ✅ |
| Choose plan (Starter/Team/Business) | Buton | `/subscription/manage` sepet/ön izleme ekranını açar (seçilen plan ön seçili). Satın alma yapmaz. | ✅ (Team ile açıldı) |
| Request a call (Enterprise) | Buton | Satış talebi tetikleyebileceği için tıklanmadı. | ⛔ onay bekliyor (tetiklenmedi) |
| See all features | Link (span) | Plan karşılaştırma modalını açar | ✅ |
| Sağ alt turuncu sohbet balonu | Widget | LiveChat destek sohbeti (kendi widget'ı) — açılmadı | — |

**Edge-case / bulgular**
- ⚠️ Terim tutarsızlığı: Starter “Track up to 100 **customers**”, diğer planlar “… **visitors**”.
- ⚠️ “Annual (save up to 17%)” — manage ekranında Team için “saving 16.95%” gösteriliyor (yuvarlama tutarlı ama “up to”).
- ⚠️ Sayfada Monthly seçip Team “Choose plan”a basınca manage ekranı yine **Billed annually** ile açıldı (seçilen döngü taşınmıyor).
- ⚠️ Ana sayfadaki “Choose plan” (Team) aktifken modal içindeki Team “Choose plan” **disabled** (`disabled=true`, gri) — iki yerde farklı davranış.

### Modal — “Choose the plan to suit your business” (See all features / Change plan)

**İçerik**: Sol üstte radyo **Billed annually / Billed monthly** (açılışta sayfadaki seçim devralınıyor), sütun başlıkları: Starter $19|$25, Team $49|$59, **RECOMMENDED** Business $79|$89, Enterprise “Custom pricing”. Butonlar: Choose plan ×3 (Team disabled), **Contact sales** (Enterprise). Sağ üstte ✕. Her özellik satırında ⓘ tooltip (ör. Website → “Place a beautiful, highly functional chat widget on your website.”).

**Tam özellik matrisi** (✓ = var, — = yok; S/T/B/E = Starter/Team/Business/Enterprise):

| Kategori / Özellik | S | T | B | E |
|---|---|---|---|---|
| **Channels** | | | | |
| Website | ✓ | ✓ | ✓ | ✓ |
| Apps | ✓ | ✓ | ✓ | ✓ |
| Direct Chat Link | ✓ | ✓ | ✓ | ✓ |
| Facebook Messenger | ✓ | ✓ | ✓ | ✓ |
| SMS | — | ✓ | ✓ | ✓ |
| Apple Messages for Business | — | — | ✓ | ✓ |
| Email / Instagram / X(Twitter) / WhatsApp | “available in the marketplace” (tüm planlar) | | | |
| **Text Intelligence** | | | | |
| Reply suggestions | — | 3 sources | ✓ | ✓ |
| Insights | — | ✓ | ✓ | ✓ |
| Tag suggestions | — | ✓ | ✓ | ✓ |
| Chat summary | — | — | ✓ | ✓ |
| Text enhancement | — | — | ✓ | ✓ |
| Sentiment analysis | — | — | — | early access |
| **Chat and monitoring** | | | | |
| AI chatbots | “ChatBot starts at $52 / mo. Learn more” | | | |
| Traffic tracking | up to 100 visitors | up to 400 visitors | up to 1000 visitors | custom |
| Multiple website support | ✓ | ✓ | ✓ | ✓ |
| Applications | ✓ | ✓ | ✓ | ✓ |
| Pre-chat & post-chat surveys | predefined only | ✓ | ✓ | ✓ |
| Inactivity message | ✓ | ✓ | ✓ | ✓ |
| Customer details | ✓ | ✓ | ✓ | ✓ |
| Agent rating | ✓ | ✓ | ✓ | ✓ |
| Transfers | ✓ | ✓ | ✓ | ✓ |
| Smart chat routing | ✓ | ✓ | ✓ | ✓ |
| Manual chat routing | ✓ | ✓ | ✓ | ✓ |
| Canned responses | — | ✓ | ✓ | ✓ |
| Private canned responses | — | ✓ | ✓ | ✓ |
| Canned response suggestions | — | ✓ | ✓ | ✓ |
| Custom customer segments | — | ✓ | ✓ | ✓ |
| Chat tagging | — | ✓ | ✓ | ✓ |
| File sharing | — | ✓ | ✓ | ✓ |
| Routing rules based on URL | — | ✓ | ✓ | ✓ |
| Automated tags | — | ✓ | ✓ | ✓ |
| Routing rules based on geolocation | — | — | ✓ | ✓ |
| Chat takeover | — | only from bots | ✓ | ✓ |
| Work scheduler | — | — | ✓ | ✓ |
| **Asynchronous communication** | | | | |
| Availability | ✓ | ✓ | ✓ | ✓ |
| Chat history | 60-day | ✓ | ✓ | ✓ |
| Email transcripts | ✓ | ✓ | ✓ | ✓ |
| **Stats and reports** | | | | |
| Daily & Weekly summary | ✓ | ✓ | ✓ | ✓ |
| Insights | ✓ | ✓ | ✓ | ✓ |
| LiveChat Dashboard | — | ✓ | ✓ | ✓ |
| Chat statistics | — | ✓ | ✓ | ✓ |
| Tags usage | — | ✓ | ✓ | ✓ |
| Campaign conversions | — | ✓ | ✓ | ✓ |
| Agent activity | — | — | ✓ | ✓ |
| Agent performance | — | — | ✓ | ✓ |
| Chat duration | — | — | ✓ | ✓ |
| Chat response | — | — | ✓ | ✓ |
| On-demand reporting | — | — | ✓ | ✓ |
| Staffing prediction | — | — | ✓ | ✓ |
| **Engagement** | | | | |
| Proactive chats | ✓ | ✓ | ✓ | ✓ |
| Eye-catcher | predefined only | ✓ | ✓ | ✓ |
| Recurring campaigns | 1 campaign | ✓ | ✓ | ✓ |
| One-time campaigns | — | ✓ | ✓ | ✓ |
| **Customization** | | | | |
| Chat window translations | predefined only | ✓ | ✓ | ✓ |
| Dark mode | ✓ | ✓ | ✓ | ✓ |
| Live editor | ✓ | ✓ | ✓ | ✓ |
| Right-to-left support | ✓ | ✓ | ✓ | ✓ |
| Themes | ✓ | ✓ | ✓ | ✓ |
| Accessibility compliance | ✓ | ✓ | ✓ | ✓ |
| Custom logo in chat widget | — | ✓ | ✓ | ✓ |
| Multi-brand customization | — | ✓ | ✓ | ✓ |
| Language selection | — | ✓ | ✓ | ✓ |
| White label | — | — | — | ✓ |
| **Management** | | | | |
| User roles | ✓ | ✓ | ✓ | ✓ |
| Supervision | ✓ | ✓ | ✓ | ✓ |
| Allowed domains | ✓ | ✓ | ✓ | ✓ |
| Group organization | — | ✓ | ✓ | ✓ |
| Inactivity timeout configuration | — | ✓ | ✓ | ✓ |
| Internal notes | — | ✓ | ✓ | ✓ |
| **Integrations and add-ons** | | | | |
| Marketplace | ✓ | ✓ | ✓ | ✓ |
| API | “start with a free $25 credit” | | | |
| ChatBot | “starts at $52” | | | |
| HelpDesk | “starts at $29” | | | |
| KnowledgeBase | “starts at $24” | | | |
| **Ecommerce** | | | | |
| Shopify / WooCommerce / Bigcommerce integration | ✓ | ✓ | ✓ | ✓ |
| Goals | — | ✓ | ✓ | ✓ |
| Sales tracker | — | ✓ | ✓ | ✓ |
| **Security** | | | | |
| 256-bit SSL, Banned visitors list, Credit card masking, Data center in US or EU, Log in with Google/Microsoft/Apple, Two-Factor Authentication, Require login with Google, Trusted domains | ✓ | ✓ | ✓ | ✓ |
| Access restriction | — | — | ✓ | ✓ |
| Audit log | — | — | — | ✓ |
| Security assistance | — | — | — | ✓ |
| HIPAA Compliance | — | — | — | ✓ |
| Single Sign-On (SSO) ready | — | — | — | ✓ |
| **Product support** | | | | |
| Help Center | ✓ | ✓ | ✓ | ✓ |
| 24/7/365 Support | ✓ | ✓ | ✓ | ✓ |
| Product training, Software engineer support, Legal assistance, Alternative payment terms, Key Account Manager | — | — | — | ✓ |
| Professional Services | — | — | — | Learn more |

**Öğeler & durumlar**

| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Billed annually / monthly | Radyo | Modal fiyatlarını değiştirir | ✅ |
| Choose plan (Starter/Business) | Buton | Manage ekranında sepet planını değiştirir (yalnız ön izleme) | ✅ |
| Choose plan (Team) | Buton | Mevcut deneme planı → disabled | ✅ |
| Contact sales | Buton | Satış talebi riski → tıklanmadı | ⛔ onay bekliyor (tetiklenmedi) |
| ChatBot “Learn more”, Professional Services “Learn more” | Link | ↗ dış site (tıklanmadı) | ↗ |
| ⓘ tooltip'ler | Hover | Özellik açıklaması gösterir (165 tetikleyici; örnek kaydedildi) | ✅ (örneklem) |
| ✕ / Esc | Kapatma | İkisi de modalı kapatır | ✅ |

**Edge-case / bulgular**
- ⚠️ Modal içindeki döngü değiştirmesi arka plandaki sayfa radyosunu güncellemiyor (modalde annual, arkada monthly fiyatlar kalıyor).
- ⚠️ Kart listesi (Starter “24/7/365 Support”) ile matris tutarlı; ancak kartta Starter “1 user” yazarken matriste kullanıcı sayısı satırı yok.

### Subscription — Manage / sepet ön izlemesi (/subscription/manage)

“Choose plan” veya doğrudan URL ile açılır. Sol üstte geri oku (← `/subscription`).

**İçerik**
- **Your subscription** kartı: LiveChat logosu, “Team plan”, fatura döngüsü açılır menüsü, ajan sayacı (stepper), sağda “$49 / mo per agent”, **Change plan** linki.
- **Your add-ons:** Google Analytics — “Track the impact of website chats on online sales and gather marketing data.” $5 / mo · Unlimited agents · 🗑 **Remove**
- **Frequently bought with LiveChat:**
  - Pro+ API requests package — “A monthly package of 500,000 API requests with a one-time API specialist session.” **Add: $149.99 / mo** · Unlimited agents
  - Pro API requests package — “A monthly package of 500,000 API requests.” **Add: $149.99 / mo** · Unlimited agents
  - Essential API requests package — “A monthly package of 100,000 API requests.” **Add: $29.99 / mo** · Unlimited agents
- **Summary** (sağ panel):
  - Current subscription: Team plan ~~$708~~ $588 / yr · Agents: 1 · Free trial until Oct 28, 2026 · rozet “saving 16.95%”
  - New subscription → mavi kutu **Immediate changes** ⓘ (tooltip: “These changes will take effect immediately”) — değişiklikleri “Billing: annual → monthly”, “Agents: 1 → 2”, “Plan: Team → Business” biçiminde listeler; varsayılan olarak “Google Analytics” satırı.
  - **Add-on (1)** › (genişletilebilir: “Google Analytics $5 / mo — Free trial until Oct 28, 2026”) ✅
  - **Annual total** ⓘ (tooltip: “The average 3yr cost based on the chosen LiveChat subscription plan and add-ons in your cart with taxes included” — etiket döngüye göre “Monthly total / Annual total / 2yr total / 3yr total”)
  - Billed on renewal · **Billed now $0**
  - **Go to checkout** (mavi) + dipnot: “You'll be charged for individual products at the end of their free trial(s). Your subscription will continue until you cancel.”

**Fiyat ön izleme testleri (kayıt yapılmadı)** ✅

| Plan | Döngü | Ajan | Birim | Toplam (GA $5 dahil) | Billed now |
|---|---|---|---|---|---|
| Team | Annual (varsayılan) | 1 | $49/mo | Annual total $648 / yr | $0 |
| Team | Monthly | 1 | $59/mo (+ “Save $120 annually” yeşil ipucu) | Monthly total $64 / mo | $0 |
| Team | Every 2 years | 1 | $49/mo | 2yr total $1,296 / 2yrs | $0 |
| Team | Every 3 years | 1 | $49/mo | 3yr total $1,944 / 3yrs | $0 |
| Team | Every 3 years | 2 | $49/mo | $3,708 / 3yrs | $0 |
| Team | Every 3 years | 999 | $49/mo | $1,762,416 / 3yrs | $0 |
| Business | Every 3 years | 1 | $79/mo | $3,024 / 3yrs | $0 |
| Starter | Every 3 years | 1 | $19/mo | $864 / 3yrs | $0 |

**Öğeler & durumlar**

| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Billing period dropdown | Combobox | Seçenekler: Billed monthly / Billed annually / Billed every 2 years / Billed every 3 years (seçili olanda ✓). Açıkken placeholder “Select billing period”. | ✅ |
| Ajan sayacı (`data-testid=agents-number`, type=text, min=1, max=999) | Stepper + metin | ▲/▼ ile değişir; etiket “agent”/“agents” çoğullanır | ✅ |
| Ajan sayacı — Starter seçiliyken | — | Input ve ▲▼ **disabled** (Starter = 1 user) | ✅ 🔒 |
| Change plan | Link | Karşılaştırma modalını açar | ✅ |
| Remove (Google Analytics) | Buton | Eklentiyi kaldırma → tıklanmadı | ⛔ onay bekliyor (tetiklenmedi) |
| Add: $… (API paketleri) | Buton | Sepete ekleme → tıklanmadı | ⛔ onay bekliyor (tetiklenmedi) |
| Add-on (1) › | Akordeon | Eklenti detayını aç/kapat | ✅ |
| ⓘ Immediate changes / ⓘ total | Tooltip | Bkz. yukarı | ✅ |
| Go to checkout | Buton | Ödeme akışı → tıklanmadı | ⛔ onay bekliyor (tetiklenmedi) |
| ← geri oku | Buton | `/subscription` plan sayfasına döner | ✅ |

**Edge-case / bulgular**
- ✅ Ajan alanına `0` veya `abc` yazılınca değer 1'e geri döndü (toplam $1,944 kaldı); `99999` yazılınca **999**'a sabitlendi (max=999).
- ⚠️ 2 ve 3 yıllık döngülerde ek indirim yok: birim fiyat yıllık ile aynı ($49/mo) — sadece peşin dönem uzuyor.
- ⚠️ “Google Analytics” eklentisi kullanıcı hiçbir şey yapmadan hem “Your add-ons”ta hem de “Immediate changes” kutusunda yeni değişiklik gibi listeleniyor (deneme hesabında varsayılan sepet öğesi; “Free trial until Oct 28, 2026”).
- ⚠️ “Immediate changes” tooltip'i döngü değişikliğinin “hemen” geçerli olacağını söylüyor; deneme sürümündeyken bu ifade belirsiz.
- ⚠️ Sayfada **beforeunload “Leave site?”** uyarısı var — kullanıcı hiçbir değişiklik yapmasa bile (yalnız varsayılan GA satırı varken) başka URL'e gitmeye çalışınca çıktı.
- ✅ Sepet durumu kalıcı değil: sayfa yenilenince/yeniden girilince Team / annual / 1 agent varsayılanına döner.
- ⚠️ Görsel olarak dropdown açıldığında “Save $120 annually” ipucu yalnız Monthly seçiliyken görünür ve düzeni kaydırır (tıklama hedefleri yer değiştiriyor).

### Invoices (/subscription/invoices)

**İçerik**: Başlık “Invoices”; boş durum: “Nothing in your Invoices” / “After you subscribe, all your invoices will appear here” / **Subscribe now** butonu. Üstte kırmızı toast: **“Failed to fetch invoices”** (✕ ile kapatılabilir).

| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Subscribe now | Buton | `/subscription` plan seçim sayfasına gider (satın alma yok) | ✅ |
| Hata toast'u ✕ | Buton | Toast kapatma | — |

**Edge-case / bulgular**
- ⚠️ Deneme hesabında faturalar uç noktası hata veriyor (“Failed to fetch invoices”) ve aynı anda boş durum gösteriliyor — hata ile “fatura yok” ayrımı yapılmıyor.
- Fatura indirme / tablo görülemedi (fatura yok).

### Account details (/subscription/account-details)

**İçerik**
- **Account Owner** kartı: avatar “A”, kullanıcı adı **azzatenli**, e-posta (hesap sahibinin e-postası).
- **Payment card** kartı: “To install paid LiveChat integrations, please add a payment method.” + **Add card** (mavi) + kart görseli (VISA, Mastercard, Discover, Amex logoları).

| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Add card | Buton | Ödeme yöntemi ekleme → tıklanmadı | ⛔ onay bekliyor (tetiklenmedi) |

**Edge-case / bulgular**
- Kayıtlı ödeme yöntemi yok; fatura adresi/vergi no alanı bu ekranda görünmüyor (muhtemelen checkout'ta).
- Ücretli marketplace uygulamalarının kurulumu ödeme kartı şartına bağlı (metinden).

### Billing — Tüm tooltip metinleri (birebir) ✅

Tooltip'ler (`data-testid="tooltip-trigger"`, toplam 165: 57 sayfa + 108 modal) tek tek tetiklenip okundu.

**Plan kartları (/subscription):**

| Kart | Özellik | Tooltip |
|---|---|---|
| Starter | Text Intelligence | Copilot, who guides you through onboarding, account setup, and using LiveChat, along with our other customer service products. |
| Starter | Track up to 100 customers | How many visitors you can view in real-time. |
| Starter | 1 recurring campaign | Create 1 recurring campaign that automatically greets and assists website visitors. |
| Starter | 60-day chat history | Your chats will be stored in the archives for 60 days. |
| Starter | Basic widget customization | Customization is limited to changing the theme and colors of the chat widget. |
| Starter | 24/7/365 Support | Our Support Team is here for you round the clock to offer assistance. |
| Starter | 1 user | You receive a single-user plan with 1 available user. |
| Team | Text Intelligence | Provide faster, more personalized, and more efficient customer service with AI features like reply suggestions, tag suggestions, and Insights. |
| Team | Track up to 400 visitors | How many visitors you can view in real-time. |
| Team | Unlimited campaigns | Create unlimited recurring campaign that automatically greets and assists website visitors. |
| Team | Unlimited chat history | All your chats will be stored in the archives. Review your chat history and search for specific conversations. |
| Team | Full widget customization | Full customization, including changing the theme, colors, visibility, and position of the chat widget. You can also edit displayed messages and the chat logo. |
| Team | Basic reporting | Chat reports plus a daily recap of your account activity. |
| Team | Unlimited users | Invite as many teammates to LiveChat as you need. |
| Business | Text Intelligence | Provide faster, more personalized, and more efficient customer service with AI features like reply suggestions, chat summary, text enhancement, plus get early access to new features. |
| Business | Track up to 1000 visitors | How many visitors you can view in real-time. |
| Business | Apple Messages for Business integration | Let your customers message you directly via the Messages app on iOS and macOS. Connect with 1.5 billion Apple users without leaving the LiveChat app. |
| Business | Work scheduler | Configure the working hours for your agents to ensure smooth transitions between shifts. |
| Business | Staffing prediction | A report that will tell you how many agents you will need to cover your changing chat volume. |
| Business | On-demand reporting | You can receive scheduled reports that would cover a particular aspect of your solution. The reports can be provided in CSV, TSV, XLS and other formats. |
| Business | Advanced reporting | Full suite of chats, staffing and response times reports. On-demand reporting capability, which allows you to generate scheduled or one-time reports. |
| Business | Agent performance | See how your agents are doing. Spot top performers and teammates who need to improve certain areas of their work. |
| Enterprise | Text Intelligence | (Business ile aynı metin) |
| Enterprise | Customize tracking limit | Tailor the number of visitors you can track to your needs. |
| Enterprise | Dedicated account manager | You will be assigned a dedicated account manager who will help you with everything from set up through advanced use to getting the most of your LiveChat. |
| Enterprise | Dedicated onboarding | Training that will teach your team how to use LiveChat for sales and support effectively. |
| Enterprise | White label chat widget | You can ask us to give you the option to remove the 'Powered by LiveChat' branding. |
| Enterprise | Software engineer support | Our software engineers will consult and advise in terms of implementation scenario and integrating LiveChat with your existing software environment. |
| Enterprise | Single Sign-on (SSO) | LiveChat is ready for integration with enterprise-grade or cloud SSO solutions (based on SAML 2.0). |
| Enterprise | HIPAA Compliance | LiveChat helps you maintain HIPAA compliance with enhanced security standards and a business associate agreement (BAA) so your organization can collect health information safely and securely. |
| Enterprise | Alternative payment terms | As an alternative to using your company card, you can pay for LiveChat with purchase orders and annual invoices. |
| Enterprise | Professional services | Get comprehensive professional services from LiveChat including quick implementation, tailored support, training, and more. |

⚠️ **Tutarsızlıklar:**
- Starter kartında “Text Intelligence” ✓ olarak listeleniyor (tooltip: Copilot), ama karşılaştırma matrisinde Starter için tüm Text Intelligence satırları “—”.
- Starter “Track up to 100 **customers**” ama tooltip “How many **visitors** …”.
- Team “Unlimited campaigns” tooltip'i “Create unlimited recurring campaign…” (dilbilgisi: tekil “campaign”).
- “Work scheduler”: kartta “Configure the working hours…”, modalda “Set the working hours…” — farklı metinler.
- DOM'da Business (önerilen) kartının özellik tetikleyicileri iki kez render ediliyor (gizli kopya → erişilebilirlik ağacında yinelenen içerik).

**Karşılaştırma modalı (See all features / Change plan) — satır ⓘ tooltip'leri (birebir):**

| Özellik | Tooltip |
|---|---|
| Website | Place a beautiful, highly functional chat widget on your website. |
| Apps | Embed a high-performance chat widget in your mobile apps. |
| Direct Chat Link | Share a short link to direct visitors straight to the chat page. |
| Facebook Messenger | Bring all your Facebook communication right into LiveChat app to better connect with your fans. |
| SMS | Receive and send text messages directly in the LiveChat app. Enjoy all the benefits of always being where your customers are. |
| Apple Messages for Business | Let visitors message you directly via the Messages app on iOS and macOS. Connect with 1.5 billion Apple users without leaving the LiveChat app. |
| Email | Integrate LiveChat with email marketing software, and include your visitors in email campaigns. |
| Instagram | Streamline communication by responding to Instagram messages directly from LiveChat. |
| X(Twitter) | Manage your X conversations directly in LiveChat. |
| WhatsApp | Engage customers through WhatsApp, allowing agents to respond directly from LiveChat. |
| Reply suggestions | Receive reply suggestions based on knowledge sources you import to LiveChat. Up to 10 sources. |
| Insights (TI) | Find the most popular questions and topics on your LiveChat without having to read through thousands of chats. |
| Tag suggestions | Get one-click tag suggestions during chats based on your previous tagging. |
| Chat summary | Get the gist of your conversation without reading through the entire transcript with AI chat summary. |
| Text enhancement | Enhance your messages with AI editing tools such as rephrasing, summarizing, correcting grammar, and even expanding texts. |
| Sentiment analysis | Get real-time sentiment analysis during chats to better understand your customers. |
| AI chatbots | Integrate with ChatBot to solve up to 80% of cases with AI-driven support. |
| Traffic tracking | The number of visitors you can monitor in LiveChat at any given time. |
| Multiple website support | Place your chat widget on multiple websites with no additional charge. |
| Applications | Application for web, desktop, and mobile. |
| Pre-chat & post-chat surveys | Gather valuable information at the beginning and at the end of each chat. (“predefined only” hücresi: “Use our default survey forms”) |
| Inactivity message | Automatically ask a visitor for their email address if your agents haven't responded for a specified amount of time. |
| Customer details | Detailed information on your visitors including name, e-mail, location, currently viewed page and more. |
| Agent rating | Let your visitors rate the agent that chatted with them. |
| Transfers | Transfer an ongoing chat to other agents when in a pinch or when expert advice is needed. |
| Smart chat routing | Intelligent chat distribution between available agents. |
| Manual chat routing | All visitors starting a chat will be queued. Chats can be then picked up manually by agents. |
| Canned responses | Save frequently used responses under a shortcut and speed up the conversation. |
| Private canned responses | Add a unique style to your messages with canned responses only you can use. |
| Canned response suggestions | Get event-based response suggestions during chats and reply faster. |
| Custom customer segments | Save filter combinations as segments to pick out hot leads in a flash. |
| Chat tagging | Assign case-specific tags to chats and easily locate them in your Archives later. |
| File sharing | Share marketing materials, tutorials, and other files over chat. You can also receive files from visitors. |
| Routing rules based on URL | Route chats from specific URLs like domain.com/help to your support agents or domain.com/pricing to your sales agents. |
| Automated tags | Assign tags automatically based on the canned response you use in the chat. |
| Routing rules based on geolocation | Automatically route visitors to agent groups that know their language. |
| Chat takeover | Take over the conversation either from a bot or your support agent. |
| Work scheduler | Set the working hours for your agents to ensure smooth transitions between shifts. |
| Availability | Keep visitors and agents on the same page by enabling asynchronous communication, whether a chat is live or spread out across hours, days, or months. |
| Chat history | Review your chat history and search for specific conversations. |
| Email transcripts | Your visitors can receive emails with chat transcripts if they wish to review their conversations. |
| Daily & Weekly summary | A summary of agent's activities that shows how well he or she is doing while chatting. |
| Insights (Reports) | Find the most popular questions and topics on your LiveChat without having to read through thousands of chats. |
| LiveChat Dashboard | A rundown of the most important metrics from your LiveChat. |
| Chat statistics | Essential information regarding your live chat like number of chats, availability, engagement, satisfaction and more. |
| Tags usage | An overview of the tags used that help you identify popular support cases. |
| Campaign conversions | See how many campaigns displayed to visitors resulted in a chat. |
| Agent activity | This report lets you know when your agents were available for chats during a particular day. The report keeps track of agents' statuses and shows a graphical representation of their activity. |
| Agent performance | See how your agents are doing. Spot top performers and teammates who need to improve certain areas of their work. |
| Chat duration | Analyze chat duration for different agents, tags, and groups to improve efficiency. |
| Chat response | See how long it takes an agent to reply to a new chat. |
| On-demand reporting | Receive scheduled reports that cover a particular aspect of your solution. Available in CSV, TSV, XLS and other formats. |
| Staffing prediction | See how many agents you will need to efficiently staff your chat. |
| Proactive chats | Make the first move and initiate a chat with a website visitor yourself. |
| Eye-catcher | Get more chats by drawing your visitors' attention to your chat window with a colorful eye-catcher. |
| Recurring campaigns | Encourage visitors to chat thanks to recurring campaigns that greet them, offer help, and showcase your products. |
| One-time campaigns | Announce your products, services, and offers to customers once per visitor's lifetime. |
| Chat window translations | Adjust your chat widget by adding custom phrases in any of the 48 available languages. |
| Dark mode | Switch your chat widget to dark mode and make it more comfortable to use for your customers. |
| Live editor | Adjust the appearance of the chat widget, including theme, colors, position, and offsets, and see a live preview without the need to save changes. |
| Right-to-left support | LiveChat widget offers native support for right-to-left languages, like Arabic and Hebrew. |
| Themes | Choose one of the available chat widget themes to make it fit with your website's design. |
| Accessibility compliance | The WCAG 2.1 Level AA compliant chat widget has screen reader support, keyboard navigation, and contrast adjustments. |
| Custom logo in chat widget | Brand your chat widget with your company's logo. |
| Multi-brand customization | Customize the look of the chat widget for each website you're using LiveChat on. |
| Language selection | Choose one of the 48 available languages for your chat widget. Create dedicated agent groups and assign specific languages to your chat widget to provide multilingual customer support. |
| White label | Ask us to remove the 'Powered by LiveChat' branding from your chat widget. |
| User roles | Assign administrative privileges to certain users only. |
| Supervision | Supervise ongoing chats to train new agents and ensure the best chat quality. |
| Allowed domains | Allow teammates to join Text products without invitations by setting up allowed domains. |
| Group organization | Divide users into groups responsible for particular branches of your business. |
| Inactivity timeout configuration | Automatically transfer a chat when an agent is not responding in a conversation. To keep your chat flow steady, you can choose the amount of time after which the chat will be transferred. |
| Internal notes | Chat with your team behind the scenes and leave private notes in chats visible only to your team. |
| Marketplace | Connect a variety of free and paid 3rd party apps, including CRMs, e-commerce platforms, social media channels, and help desk software. Explore the Marketplace for more information. |
| API | Pull and feed various data via the LiveChat API, which allows for creation of custom integrations. |
| “start with a free $25 credit” | Then, charges apply per 1000 requests, starting from $0.08) ⚠️ (açılış parantezi yok) |
| ChatBot | Integrate LiveChat with ChatBot to build and launch conversational chatbots without coding. Start a free trial, subscribe later. |
| HelpDesk | Integrate LiveChat with HelpDesk to add email to your communication channels in a form of ticketing system. Start a free trial, subscribe later. |
| KnowledgeBase | Integrate LiveChat with KnowledgeBase to create, manage, and share self-service content with your customers. Start a free trial, subscribe later. |
| Shopify integration | Connect your Shopify store with LiveChat and grow your sales. |
| WooCommerce integration | Connect your WooCommerce store with LiveChat to chat with customers and see their shopping carts. |
| Bigcommerce integration | Connect your BigCommerce store with LiveChat and turn store visitors into customers. |
| Goals | Set up business goals you want to reach over chat, like making a sale or signing up a new customer, and see how many conversations end up with them. |
| Sales tracker | Automatically track chats that lead to a sale. Measure how much value you're getting out of LiveChat by going over chat Archives or the Sales Tracker report. |
| 256-bit SSL secure connection | Ensure connection safety through SSL encryption protocol. |
| Banned visitors list | View and edit the list of visitors who are blocked from using your chat. Add and remove IPs and decide how long to ban a visitor for. |
| Credit card masking | Credit card numbers are not visible during chats and will not be stored in the archives. |
| Data center in US or EU | Host your data in the USA or in the EU in compliance with data protection requirements. |
| Log in with Google / Microsoft / Apple | Use your Google / Microsoft / Apple Account details to log in to LiveChat. |
| Two-Factor Authentication | Enable two-factor authentication (2FA) to enhance account security by requiring a password and an authentication app code. |
| Require login with Google | Require all team members to use their Google Account details to log in to LiveChat. |
| Trusted domains | Protect your LiveChat tracking code from being added to unauthorized websites. |
| Access restriction | Restrict access to your LiveChat to a limited number of IPs. |
| Audit log | Receive an on-demand file that lists all notable changes made in the application settings. |
| Security assistance | Our specialists will be ready to advise on the best practices in terms of LiveChat security inside your premise. |
| HIPAA Compliance | (kart tooltip'i ile aynı) |
| Single Sign-On (SSO) ready | LiveChat is ready for integration with enterprise-grade or cloud SSO solutions (based on SAML 2.0). |
| Help Center | Learn the ropes of chatting and customer service thanks to a collection of articles on LiveChat. |
| 24/7/365 Support | Contact us using chat on our website or directly in your LiveChat app. |
| Product training | Training session that will teach your agents how to effectively use LiveChat for sales and support. This training will give you the know-how necessary to run a successful LiveChat implementation. |
| Software engineer support | Our software engineers will assist you with custom implementations and integrating LiveChat with your existing software environment. |
| Legal assistance | Our legal team will take care of analyzing or drafting the paperwork your company needs to get started with LiveChat. |
| Alternative payment terms | (kart tooltip'i ile aynı) |
| Key Account Manager | You will be assigned a dedicated account manager that will be responsible for the success of your LiveChat. Your Key Account Manager will help you set up as well as keep optimizing your LiveChat for the best results. |
| Professional Services | Get comprehensive professional services from LiveChat including quick implementation, tailored support, training, and more. |

⚠️ Tooltip “Reply suggestions … Up to 10 sources.” ama matriste Team hücresi “3 sources” — plan bazlı sınır tooltip'te ayrılmıyor.
⚠️ Modaldaki ChatBot/HelpDesk/KnowledgeBase fiyatları (“starts at $52 / $29 / $24”) marketplace'te “Free to install” görünmeleriyle çelişkili görünüyor (ücret ilgili ürünün kendi aboneliğinde).

### Global öğeler (Billing/Apps/HelpDesk sayfalarında)

| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Üst mavi şerit “14 days left in your trial.” + **Upgrade now** | Banner butonu | Satın alma akışı → tıklanmadı | ⛔ onay bekliyor (tetiklenmedi) |
| “Meet Text App — your new all-in-one support workspace.” + “Discover Text App” + ✕ | Kampanya banner'ı | Başka bölüm | — |
| Arama (Ctrl K), Invite, Copilot (“Chat with Copilot Ctrl G”), “Accepting chats: 1 agent” | Üst bar | Başka bölüm | — |

---

## Apps (https://my.livechatinc.com/apps/marketplace/apps)

**Mimari:** Kabuk (sol alt menü, başlık, “Go to Cart”) LiveChat SPA'sında; içerik **çapraz kökenli iframe** `https://marketplace-agentapp.livechatinc.com/apps` (Gatsby SSR). Iframe URL'leri bağımsız da açılabiliyor (oturumsuz; CTA alanı “loading...” kalıyor).

⚠️ **Deep link sorunu:** `/apps/marketplace/apps` doğrudan (tam sayfa) yüklendiğinde uygulama **`/install-code`** onboarding ekranına yönlendirdi (tekrarlanabilir, 2/2). Sol menüden (SPA içi) gidince sorun yok. `/subscription`, `/subscription/manage` doğrudan yüklemede yönlendirme yapmadı.
Uygulama içi URL'ler: `/apps/marketplace/apps`, `/apps/marketplace/apps/self-setup`, `/apps/marketplace/partners`, `/apps/marketplace/developers`, `/apps/automation/build-your-app`, `/apps/automation/webhooks`, `/apps/marketplace/cart`, detay `/apps/marketplace/apps/<slug>`.

### Sol alt menü (Apps)

| Öğe | Hedef | Durum |
|---|---|---|
| Explore apps | /apps/marketplace/apps | ✅ |
| External integrations | /apps/marketplace/apps/self-setup (breadcrumb “Explore apps > Self-setup”) | ✅ |
| Partners | /apps/marketplace/partners | ✅ ⚠️ menü vurgusu hemen değişti ama iframe içeriği ~10 sn eski sayfada (Self-setup) kaldı |
| Creators | /apps/marketplace/developers | ✅ |
| Build your app | /apps/automation/build-your-app | ✅ |
| Automate with webhooks | /apps/automation/webhooks | ✅ |
| Panel ikonu (başlık solu) | Alt menüyü aç/kapat | ✅ |
| **Go to Cart** (sağ üst, kırmızı rozet “1”) | /apps/marketplace/cart | ✅ |

⚠️ “My apps / Installed apps” sekmesi **yok**; kurulu uygulamaları listeleyen görünüm bulunamadı (hesapta kurulu uygulama da görünmüyor).

### Explore apps — liste sayfası

**İçerik**
- **Collections** karuseli (› / ‹ ile kayar ✅):
  - **By text** — “Apps from the Text team designed to simplify your day-to-day tasks.” (`/apps/by-text/`, 32)
  - **AI-Powered** — “Extend your LiveChat with AI apps that boost your customer service.” (`/apps/ai-powered/`, 8)
  - **New & Noteworthy** — “Recently published, high-quality apps recognized by LiveChat experts.” (`/apps/new-and-noteworthy/`, 7)
  - **Staff Top Picks** — “Feature-rich applications that greatly enhance your chatting experience.” (`/apps/staff-top-picks/`, 12)
  - ⚠️ Gizli koleksiyon `/apps/starter-pack/` (“Featured in Starter Pack”, 12) — karuselde yok ama URL çalışıyor.
- **All Apps**: filtreler **Categories: all**, **Payment type: all**, **Placement: all**; arama “Search for apps”; sıralama (varsayılan **Recommended**).
- Kart: logo, ad, “AI-Powered” rozeti, fiyat (“Free to install” / “$X / mo”), “• 4.6 ★”, “Works with LiveChat”, kısa açıklama. **117 uygulama**, sayfalama yok.

**Filtre/sıralama seçenekleri (birebir)**

| Kontrol | Seçenekler | URL | Durum |
|---|---|---|---|
| Categories | Analytics · CMS Integrations · CRM Connectors · Chatbots · Contact Management · Desktop Sharing · E-commerce · Email Marketing · Files Sharing · Help Desk · Invoicing · Lead Generation · Social Media | `/apps/<slug>/?categories=<slug>&compatibility=livechat`; başlık “Featured in <Kategori>”, Collections gizlenir | ✅ |
| Payment type | Free · One time payment · Per license, per month · Per agent, per month | — | ✅ açıldı |
| Placement | Campaigns · Navigation · Message Box · Details (Chats or Tickets) · Settings | — | ✅ açıldı |
| Sıralama | Alphabetically · Price · Popularity · Recommended (✓) · Recently published | `sortBy=recommended/price/popularity/published` | ✅ |

**Sıralama sonuçları**
- **Price** (azalan): SnapCall $999 → Pro+ API $149.99 → Pro API $149.99 → Microsoft Dynamics Cases $79 → OAPPS for WhatsApp $59 → Migam $47 → Essential API $29.99 → Advanced Group Manager $19 → LiveCalls $10 → Callzz $10 … son: Trello, External Account Manager, Attribution Resolver (Free).
- **Popularity** ilk 15: KnowledgeBase for LiveChat, Facebook Messenger, WhatsApp Business, Twilio SMS, Telegram for Business, HelpDesk, ChatBot, LiveChat for WordPress, Mailchimp, HubSpot, Google Analytics, Salesforce, Shopify - Live Chat, Squarespace, 2way Newsletter SMS.
- **Recently published** ilk 10: Attribution Resolver, Pro+ API, Pro API, Essential API, Survey Sensei EU/US, External Account Manager, Trello, Facebook, Auto-responder, Dashboards for LiveChat.
- ⚠️ Geçersiz `sortBy` (ör. `recently-published`) sessizce `recommended`'a döner.

**Arama testleri**

| Girdi | Sonuç | Durum |
|---|---|---|
| `translate` | 3: Google Translate for LiveChat, DeepL Translate for LiveChat, Message Translator (GPT Translator eşleşmedi) | ✅ |
| `WHATSAPP` | 6: WhatsApp Business, Outbound messages, Super Trainer automations, Twilio SMS Voice & WhatsApp, LiveCalls, OAPPS for WhatsApp 4.1 → harf duyarsız, açıklamada da arıyor | ✅ |
| `qqzzxx` | 0 sonuç — ⚠️ **boş durum mesajı yok**, alan tamamen boş | ✅ ⚠️ |
| `<b>x</b>'"%` | 0 sonuç, HTML yorumlanmadı | ✅ |
| ✕ | Aramayı temizler | ✅ |

⚠️ Arama terimi URL'e yazılmıyor; uygulama içinde ilk tuş vuruşu kayboldu (“Google Analytics” → “oogle Analytics”, yine de eşleşti). Breadcrumb ile listeye dönünce arama sıfırlanıyor.

**Kategori → uygulama eşleşmesi (tam)**

| Kategori | Sayı | Uygulamalar |
|---|---|---|
| Analytics | 23 | AgentTrainer, Agents Performance Report, Agent Activity Report, Chat Response Time Report, Chat Duration Report, Staffing Prediction Report, Google Analytics, Chat Summary, Chats Transcripts Exporter, Super Trainer automations, Super Vision, Mixpanel, Super Agent, Chat Assistant, LiveSession, Super Queue notifications, Chats Exporter, Surveys, Microsoft Teams, Agent Pulse, Logs, Survey Sensei EU/US, Dashboards for LiveChat |
| CMS Integrations (`cms`) | 4 | LiveChat for WordPress, Squarespace, LiveChat for Webflow, WHMCS |
| CRM Connectors (`crm`) | 8 | HubSpot, Salesforce, Pipedrive, Salesforce Sandbox, Salesforce for LiveChat, Microsoft Dynamics Cases, AI CRM, Customer.io for LiveChat |
| Chatbots | 2 | ChatBot, EasyBot |
| Contact Management | 5 | Outbound messages, Twilio SMS Voice & WhatsApp, SALESmanago, Private TODOs, Queue priorities |
| Desktop Sharing | 5 | Zoho Assist, Getscreen.me, RemSupp, Google Hangouts Meet, Loom for LiveChat |
| E-commerce | 4 | Shopify - Live Chat, BigCommerce, Wix, Currencies |
| Email Marketing | 3 | Mailchimp, ActiveCampaign, iContact |
| Files Sharing | 2 | Dropbox, Google Drive for LiveChat |
| Help Desk | 8 | KnowledgeBase for LiveChat, HelpDesk, Zendesk, Zoom for LiveChat, Integrated Calculator, Sync for Jira Service Desk DC, Stripe for LiveChat, Redbi Calculator |
| Invoicing | **0** | ⚠️ boş kategori filtrede listeleniyor |
| Lead Generation | 9 | WhatsApp Business, Telegram for Business, Calendly, Chat Notes, Rich Messages, Slack for LiveChat, Stripe, Taku, Callzz |
| Social Media | 5 | Facebook Messenger, Telegram, Instagram, Telegramer 3, OAPPS for WhatsApp 4.1 |

⚠️ Kategori atamaları tutarsız (Zoom/hesap makineleri “Help Desk”, Currencies “E-commerce”, Microsoft Teams “Analytics”). 117 uygulamadan yalnız 78'i bir kategoride; ~39 uygulama (ör. Facebook, Direct, AI Tags, BanHammer, Trello, Jira for LiveChat, Instagram for Business, GPT/DeepL/Google Translate, Apple Messages for Business, Pro/Essential API paketleri, Message Translator…) hiçbir kategoride yok.

**Koleksiyon içerikleri (tam)**
- **By text (32):** Pro+ API requests package, Pro API requests package, Essential API requests package, KnowledgeBase for LiveChat, HelpDesk, Agents Performance Report, Agent Activity Report, Chat Response Time Report, Chat Duration Report, Staffing Prediction Report, LiveChat for WordPress, Mailchimp, HubSpot, Google Analytics, Salesforce, Shopify - Live Chat, Squarespace, BigCommerce, Calendly, Zendesk, LiveChat for Webflow, Wix, Pipedrive, WHMCS, Dropbox, ActiveCampaign, Tenor GIF Keyboard, Mixpanel, Message Translator, iContact, External Account Manager, Attribution Resolver
- **AI-Powered (8):** ChatBot, KnowledgeBase for LiveChat, HelpDesk, AgentTrainer, Chat Summary, GPT Translator for LiveChat, Message Translator, Chat Assistant
- **New & Noteworthy (7):** Telegram for Business, Super Trainer automations, LiveSession, Super Queue notifications, Zoom for LiveChat, YouTube Video Sender, Gaming In Queue
- **Staff Top Picks (12):** WhatsApp Business, Telegram for Business, HelpDesk, ChatBot, Mailchimp, HubSpot, Shopify - Live Chat, 2way Newsletter SMS, Instagram for Business, AgentTrainer, Super Trainer automations, Chat Notes
- **Starter Pack (12, gizli):** WhatsApp Business, Mailchimp, Shopify - Live Chat, Instagram for Business, Super Trainer automations, SnapCall · Live Video for Chat, Message Translator, Rich Messages, Slack for LiveChat, Zoom for LiveChat, Stripe, Microsoft Teams

### Tüm uygulamalar (117) — liste + detay sayfası özeti

Puan = liste kartındaki ★ (— = puan yok). Tüm detay sayfaları SSR ile çekildi ✅ (117/117 HTTP 200). Standart detay bölümleri: Overview · Key Features · Benefits · App Terms · Reviews · Support (+ çoğunda “More by this developer”). “Ek” sütunu yalnız farklılıkları gösterir.

| # | Uygulama | Slug | Fiyat | Geliştirici | Puan | Slogan | Ek / bulgu |
|---|---|---|---|---|---|---|---|
| 1 | Pro+ API requests package | pro-api-requests-package-1 | $149.99/mo | Text | — | A monthly package of 500,000 API requests with a one-time API specialist session included. | ⚠️ “App Terms and Conditions” linki privacy-policy'ye gidiyor |
| 2 | Pro API requests package | pro-api-requests-package | $149.99/mo | Text | — | A monthly package of 500,000 API requests | ⚠️ Pro ve Pro+ aynı fiyat |
| 3 | Essential API requests package | essential-api-requests-package | $29.99/mo | Text | — | A monthly package of 100,000 API requests | |
| 4 | ChatBot | chatbot | Free (AI) | ChatBot | 4.6 (29 rating, 11 yorum) | Integrate LiveChat with ChatBot to get a customer service chatbot! | “See the pricing at chatbot.com/pricing/” |
| 5 | KnowledgeBase for LiveChat | knowledge-base | Free (AI) | Text | 4.6 | Integrate LiveChat with KnowledgeBase and empower your support with self-service | |
| 6 | WhatsApp Business | whatsapp-business | Free | LiveChat Integrations | 4.4 | Manage your chats with WhatsApp customers in the LiveChat app | Ek H2'ler: “Shorten your customer's path to your business”, “Suitable for all-sizes businesses with no risk at all”, “Convenience and effective communication” |
| 7 | HelpDesk | helpdesk | Free (AI) | Text | 4.5 (27 rating) | Integrate LiveChat with HelpDesk and manage all customer messages in one place | “Integration with LiveChat is possible starting from the Team plan.” 🔒 |
| 8 | AgentTrainer | agenttrainer | Free (AI) | AgentTrainer | 5 | Automated agent training with customer simulation | What's new [3.1.8] - 2026-03-12 |
| 9 | Agents Performance Report | agents-performance-report | $7/mo | Text | — | All key performance metrics in one place | |
| 10 | Agent Activity Report | agent-activity-report | $7/mo | Text | — | Measure your agents' activity and manage their work more efficiently | |
| 11 | Chat Response Time Report | chat-response-time-report | $7/mo | Text | — | Shorten your response time and improve customer satisfaction | |
| 12 | Chat Duration Report | chat-duration-report | $7/mo | Text | — | Analyze the chat duration and increase your efficiency | |
| 13 | Staffing Prediction Report | staffing-prediction-report | $7/mo | Text | — | Check the predicted workload and schedule shifts with ease | |
| 14 | Facebook Messenger | facebook-messenger | Free | (yok) | 4.7 | Integrate your LiveChat with Facebook Messenger and have your Facebook and website communication in one place - for free. | ⚠️ geliştirici linki yok |
| 15 | Twilio SMS | twilio | Free | (yok) | 4.4 | Send and receive SMS text messages in LiveChat. Be where your customers are. | |
| 16 | Telegram for Business | telegram-for-business | Free | LiveChat Integrations | 4.8 | Turn Telegram into a powerful support, sales, and marketing channel. | |
| 17 | LiveChat for WordPress | wordpress | Free | Text | 5 | Chat with website visitors and increase customer satisfaction. | |
| 18 | Mailchimp | mailchimp | Free | Text | 4.5 | Convert leads into customers by sending personalized marketing after the chat | |
| 19 | HubSpot | hubspot | Free | Text | 4.2 | Manage your HubSpot CRM contacts while chatting with customers. | |
| 20 | Google Analytics | google-analytics | $5/mo | Text | 4.4 (6 rating) | Track the impact of website chats on online sales and gather marketing data. | Sepette |
| 21 | Salesforce | salesforce | Free | Text | 4 | Send contacts, leads and cases from LiveChat to Salesforce. | |
| 22 | Shopify - Live Chat | shopify-live-chat | Free | Text | 5 | Engage website visitors through live chat and boost sales in your Shopify store. | |
| 23 | Squarespace | squarespace | Free | Text | 4 | Amaze your customers with exceptional chat service. | |
| 24 | 2way Newsletter SMS | 2way-message | Free | 2way, Inc. | 4.7 | Turn every chat into an SMS subscriber and every subscriber into recurring revenue. | ↗ 2wayapp.com |
| 25 | Chat Summary | chat-summary | $5/mo (AI) | SKlabs | 5 | Harness the power of OpenAI's cutting-edge artificial intelligence to generate concise summaries from your chats. | ↗ docs.sklabs.dev |
| 26 | BigCommerce | bigcommerce | Free | Text | 5 | Turn store visitors into clients and increase customer satisfaction. | |
| 27 | Calendly | calendly | Free | Text | 5 | Booking system integrated with chat on your website | |
| 28 | Zendesk | zendesk | Free | Text | 5 | Create tickets in Zendesk directly from chat. | |
| 29 | LiveChat for Webflow | webflow | Free | Text | 5 | Turn website visitors into loyal customers with tailored user experiences | |
| 30 | Wix | wix | Free | Text | 5 | Provide proactive customer service and close more sales. | |
| 31 | Telegram | telegram | Free | FEDYK sp. z o. o. | 4.2 | Seamless support with comprehensive features. | What's new [1.8.0] - 2024-09-05 |
| 32 | Pipedrive | pipedrive | Free | Text | 3.5 | Manage your Personas straight from the chat. | |
| 33 | WHMCS | whmcs | Free | Text | 3.7 | Chat with visitors on your WHMCS site and convert them into customers. | |
| 34 | Dropbox | dropbox | Free | Text | 5 | Share files with your visitors on chat. | |
| 35 | Apple Messages for Business | apple-messages-for-business | Free | (yok) | 5 | Turn more Apple users into loyal customers by making it easier for them to chat with you. | 🔒 Business planı (matris) |
| 36 | Outbound messages | outbound-messages | Free | LiveChat Integrations | 4.7 | Proactive multi-channel campaigns, made simple | |
| 37 | ActiveCampaign | activecampaign | Free | Text | 5 | Gain new subscribers and improve your follow-up activities without lifting a finger. | |
| 38 | Tenor GIF Keyboard | tenor-gif-keyboard | Free | Text | 5 | Bring Personality To Your Conversations | |
| 39 | Instagram for Business | instagram-for-business | Free | FEDYK sp. z o. o. | 3.9 | Turn Instagram conversations into business outcomes | What's new [1.4] - 2023-08-22 |
| 40 | GPT Translator for LiveChat | gpt-translator-for-livechat | Free (AI) | Darka Software | 4 | Real-time translation for LiveChat based on OpenAI GPT model. Enjoy auto-tagging, advanced group mapping and lowest prices on LiveChat marketplace. | |
| 41 | Google Translate for LiveChat | google-translate-for-livechat | Free | Darka Software | 3.6 | Real-time translation for LiveChat based on Google Translation Provider. … | |
| 42 | Chats Transcripts Exporter | chats-transcripts-exporter | Free | Darka Software | 3 | Export your chats transcripts to CSV | |
| 43 | Super Trainer automations | super-trainer | Free | .BespokeChat | 5 | Coach agents in real time with flexible automations: reminders, tags, and checklists triggered by chat events. | What's new 01.03.2026 |
| 44 | Supervisor | supervisor | Free | FEDYK sp. z o. o. | 5 | Supervise chats effortlessly | What's new 1.2 - 2024-12-01 |
| 45 | DeepL Translate for LiveChat | deepl-translate-for-livechat | Free | Darka Software | 5 | Real-time translation for LiveChat based on DeepL Translation Provider. … | |
| 46 | Super Vision | super-vision | Free | .BespokeChat | 4.5 | Supervise multiple chats simultaneously | What's new: 12 sürüm (16.07.2020 → 01.10.2025) |
| 47 | EasyBot | easybot | Free | LiveChat Integrations | 5 | Easy to configure, affordable bot for everyone | |
| 48 | Zoho Assist | zoho-assist | Free | (yok) | 4.2 | Launch or schedule remote support and screen sharing sessions from your LiveChat conversations. | What's new [1.0.0] - 2023-06-19 |
| 49 | Instagram | instagram | Free | LiveChat Integrations | 4.5 | Easily manage Instagram chats directly within LiveChat. | ⚠️ #39 ile karışabilir |
| 50 | Mixpanel | mixpanel | Free | Text | 5 | Monitor LiveChat events using Mixpanel. | |
| 51 | SnapCall · Live Video for Chat | snapcall | $999/mo | SnapCall | 5 | Unlimited audio & video Calls. Up to 300 Agents. | En pahalı |
| 52 | Message Translator | message-translator | $5/mo (AI) | Text | 2 | Translate chat messages in real time | |
| 53 | Super Agent | super-agent | Free | .BespokeChat | 5 | Alternative multi-chat interface - All your customer chats on the one single screen. | What's new: 12 sürüm |
| 54 | Chat Assistant | chat-assistant | $3/mo (AI) | SKlabs | 5 | Enhance your LiveChat experience | |
| 55 | Getscreen.me | getscreenme | Free | (yok) | 5 | Remote access to desktops. Momentarily. From a web browser. | |
| 56 | iContact | icontact | Free | Text | 5 | Gain a larger newsletter audience and simplify your follow-up activities. | |
| 57 | Giphy for LiveChat | giphy-for-livechat | Free | Roam Tools | 5 | Adding the largest library of GIFs to LiveChat | What's new [3.0.0] - 2024-12-17 |
| 58 | Places | places | Free | Chat Engineers | 5 | Guide customers & leads straight to your business | |
| 59 | Chat Notes | quick-notes | $2/mo | Sikora Works | 5 | Save and manage private notes in LiveChat threads, enhancing customer service efficiency. | ⚠️ slug ≠ ad |
| 60 | Twilio SMS, Voice & WhatsApp | twilio-sms-for-livechat | $2.99/mo | Darka Software | 3.7 | Integrate phone numbers with your LiveChat - answer your customers' SMS or WhatsApp messages directly from your agent application. | |
| 61 | LiveSession | livesession | Free | LiveSession | 4.5 | Watch LiveSession recording instantly from LiveChat. | |
| 62 | Super Queue notifications | super-queue | Free | .BespokeChat | 5 | Stay ahead of the queues with Super Queue notifications | What's new [0.1]/[1.0] |
| 63 | Rich Messages | rich-messages-configurator | $2.99/mo | LiveChat Integrations | 5 | Engage your customers with rich, beautiful messages. | |
| 64 | RemSupp | remsupp | Free | (yok) | 5 | Remotely access and control desktops. | What's new [2.0.0] - 2023-01-04 |
| 65 | Slack for LiveChat | slack-for-livechat | $5/mo | Sikora Works | 5 | Enjoy the power of your favorite software working seamlessly together. | |
| 66 | Salesforce Sandbox | salesforce-sandbox | Free | Darka Software | 5 | Create, View and Automate Salesforce Flows Directly in LiveChat. | ⚠️ #70 ile aynı slogan |
| 67 | Google Hangouts Meet | google-hangouts-meet | $1.99/mo | Sikora Works | 5 | Jump on a video call right from the chat and investigate the problems in detail. | |
| 68 | AutoTagger x Spam Detector | autotagger-x-spam-detector | Free | Darka Software | — | Let AI automatically tag your chats! | |
| 69 | Visitor Data Editor | visitor-data-editor | $1.25/mo | Darka Software | — | Simple Property Editor for your LiveChat Visitors | |
| 70 | Salesforce for LiveChat | salesforce-for-livechat | $6.99/mo | Darka Software | 5 | Create, View and Automate Salesforce Flows Directly in LiveChat. | |
| 71 | Zoom for LiveChat | zoom-for-livechat | $2/mo | SKlabs | 5 | Start a video call from the chat and help your customers solve their problems. | |
| 72 | Chats Exporter | chats-exporter | $7/mo | Tweak Chat | 3.4 | Effortlessly export and archive your LiveChat conversations with our Chats Exporter tool | |
| 73 | Stripe | stripe | $2.50/mo | LiveChat Integrations | 4 | Handle payments right in the chat | |
| 74 | Integrated Calculator | integrated-calculator | Free | (yok) | 5 | Boost customer service with our LiveChat calculator—an intuitive tool for quick math solutions… | ⚠️ gizlilik linki rastgele netlify alt alanı |
| 75 | BanHammer | banhammer | $9.99/mo | LiveChat Expert | 5 | Protect your chats from spammers. Get rid of malicious and anonymous traffic by blocking visitors who use TOR (dark web), proxies, and VPNs. | |
| 76 | Facebook | facebook-1 | Free | FEDYK sp. z o. o. | — | Grow your business with Facebook and LiveChat | ⚠️ “Facebook Messenger” ile ad karışıklığı |
| 77 | Direct | direct | Free | FEDYK sp. z o. o. | 5 | Direct chats between agents in the LiveChat App. | What's new [2.0.0] - 2023-05-11 |
| 78 | Telegramer 3 | telegramer | $9/mo | OAPPS | — | Support your customers via Telegram. | |
| 79 | AI Tags | ai-tags | $6/mo | TM Apps | — | Automated chat tagging powered by AI – save time, stay organized, and gain insights effortlessly. | ⚠️ “AI-Powered” rozeti yok; “What's new” boş |
| 80 | Sync for Jira Service Desk DC | sync-for-jira-service-desk-dc | Free | (yok) | — | Real-Time service desk issues creation with comments for Jira Service Desk data center. | |
| 81 | Iceland Authentication | iceland-authentication | Free | Vettvangur | 5 | Iceland Authentication Integration for LiveChat. | |
| 82 | SALESmanago | salesmanago | Free | SALESmanago | 5 | Transfer contacts from LiveChat to SALESmanago Customer Engagement Platform | |
| 83 | Surveys | surveys | $2.50/mo | freelancer | 5 | Seamlessly create, distribute, and analyze surveys, gathering valuable insights to make informed decisions. | |
| 84 | Microsoft Teams | microsoft-teams | $5/mo | SKlabs | 5 | Send out notifications to Microsoft Teams channels | |
| 85 | Auto-responder | auto-responder | Free | (yok) | — | ⚠️ slogan yok | ⚠️ yalnız App Terms + Support |
| 86 | LiveCalls | videocalls | $10/mo | LiveChat Integrations | 5 | Start calls. Share screens. Solve problems. All in one on every chat. | |
| 87 | Agent Pulse | agent-pulse | $7/mo | m.reszke.pl | 5 | Leverage custom statuses, automated workflows, and real-time monitoring to improve reporting and boost your team's productivity | |
| 88 | SneakPeek | sneakpeek | $1.99/mo | Chat Engineers | 5 | Turn URLs into visual chat-friendly previews | |
| 89 | Advanced Group Manager | agm | $19/mo | Tweak Chat | 3.4 | Manage a large number of groups with ease using Advanced Group Manager | |
| 90 | Microsoft Dynamics Cases | microsoft-dynamics-cases | $79/mo | Sikora Works | 5 | Manage contacts and cases directly from LiveChat. | |
| 91 | Quick links | my-bookmarks | $2/mo | jnb Apps | 1 | Easy access to your frequently visited pages while chatting | En düşük puan |
| 92 | Private TODOs | private-todos | $2/mo | Djavo Software | — | Private chat to-dos using Microsoft TODO | |
| 93 | Queue priorities | queue-priorities | $3/mo | Tweak Chat | 5 | Manage customer support by setting group priorities in your queue, ensuring faster response times for key user segments | |
| 94 | Logs | logs | $1.25/mo | Darka Software | — | ⚠️ “Track setting changes in and more!” (eksik kelime) | |
| 95 | Taku | taku | $9/mo | Abylay Keldibek | — | Engage visitors with AI powered popups | |
| 96 | Stripe for LiveChat | stripe-for-livechat | $5/mo | No-Code Venture | — | Seamlessly access and manage your Stripe customers directly within LiveChat. … | Ek H2 “Stripe for LiveChat: Streamline Your Payment Support” |
| 97 | AI Summaries | ai-summaries | $5.99/mo | Abylay Keldibek | — | Automate chat summaries, gauge sentiment, and export reports | |
| 98 | YouTube Video Sender | send-video | $2.99/mo | Muka Studios | 5 | Send YouTube videos in chat with a single click! | ⚠️ gizlilik linki bit.ly |
| 99 | Trello | trello | Free | (yok) | — | Turn your notes into Trello tasks instantly — stay organized without switching apps. | ⚠️ gizlilik alanı “livechat-trello-cli-to-fix.netlify.app” |
| 100 | Jira for LiveChat | jira-for-livechat | $6.99/mo | Darka Software | 5 | Create and Automate Jira Issues Directly in LiveChat. | |
| 101 | External Account Manager | external-account-manager | Free | Text | — | ⚠️ slogan yok | yalnız App Terms + Support |
| 102 | Gaming In Queue | gaming-in-queue | $2.99/mo | Service Innovations | — | Let visitors play games directly in-chat while waiting in queue. | |
| 103 | Agent Profiles | agent-profiles | $2.99/mo | Muka Studios | — | Build Customer Trust with Professional Agent Profiles! | |
| 104 | AI CRM | ai-crm | $6.99/mo | Darka Software | 5 | First LiveChat fully dedicated AI CRM | |
| 105 | Customer.io for LiveChat | customerio-for-livechat | $3/mo | Darka Software | — | Real-time customer data synchronization and profile retrieval. | |
| 106 | Loom for LiveChat | loom-for-livechat | $1/mo | Roam Tools | — | Create and add Loom videos | |
| 107 | Survey Sensei EU/US | survey-sensei-eu-us | $5/mo | No-Code Venture | — | Transform customer feedback into actionable insights with satisfaction scores, sentiment analysis, and automated reporting using AI. | |
| 108 | Dashboards for LiveChat | dashboards-for-livechat | $9.99/mo | Darka Software | 5 | Share your LiveChat reports with your clients and other teams. | ⚠️ Terms linki = Privacy linki |
| 109 | Agent Chat | agent-chat | $2.50/mo | Darka Software | 5 | Allow your LiveChat agents to chat and share files with each other. | |
| 110 | Callzz | callzz | $10/mo | (yok) | 2.4 | Great customer communications with multi-channel approach | |
| 111 | Get IDs | get-ids | $1/mo | QuarkText Apps | 5 | Easily access Chat and Thread IDs directly from the Chats and Archives sections. | |
| 112 | Google Drive for LiveChat | google-drive-for-livechat | $2.99/mo | Abylay Keldibek | — | Share Google Drive files directly in LiveChat | |
| 113 | Migam | migam | $47/mo | (yok) | — | Sign language interpreter | |
| 114 | Currencies | currencies | $2/mo | Chat Engineers | — | The quickest way to convert currencies. | ⚠️ gizlilik linki telegra.ph |
| 115 | Redbi Calculator | redbi-calculator | $1/mo | No-Code Venture | — | A versatile and intuitive calculator designed to help sales agents | |
| 116 | Attribution Resolver | attribution-resolver | Free | Text | — | ⚠️ slogan yok, kart logosu boş | yalnız App Terms + Support |
| 117 | OAPPS for WhatsApp 4.1 | oapps-for-whatsapp | $59/mo | OAPPS | 5 | Support your customers via WhatsApp with LiveChat | ⚠️ ad içinde sürüm no. |

Ortak detay öğeleri: “Legal Terms — By installing this app, you agree to the Marketplace Terms[, App Privacy Policy][ and App Terms and Conditions].” (↗ https://www.livechat.com/legal/terms/), “Ratings & Reviews — X out of 5 • N Ratings”, 5→1 yıldız dağılım çubukları, “How would you rate this app?” (5 boş yıldız — ⛔ tıklanmadı), son 3–4 yorum, “Show all N reviews”, “Tutorial & Support — How to use this app: Follow the app tutorial with setup instructions … To get help and support contact <geliştirici>. You can also suggest improvements or request new features…”, **App tutorial** / **Contact <geliştirici>** ↗, “Verified” statü feragatnamesi, “More by this developer”.

**Örnek birebir detay — HelpDesk (`/apps/helpdesk/`)**: Overview: “HelpDesk is a simple yet powerful online ticketing software forming part of our product suite… HelpDesk is embedded inside the LiveChat Agent App… Integration with LiveChat is possible starting from the Team plan. See the pricing at www.helpdesk.com/pricing”. Key Features: Automated support actions · Improved teamwork (“…Use the Viewer role to temporarily suspend an agent's active status without incurring charges.”) · Advanced AI-boosted ticketing · Connected message sources. Benefits: Branding elements · Short learning curve · Easy-to-navigate interface · Quicker case resolution · Increased availability · All customer messages in one app. Reviews: 4.5/5 • 27 Ratings; görünen yorumlar: Matt Zab (olumsuz: “After 5 years, we're leaving this app due to poor support and broken features…”), Quant Comps Technician, ahmad.
**Örnek — ChatBot (`/apps/chatbot/`)**: Key Features: Visual builder · Chatbot templates · AI-powered chatbots · Transfer chats to agents · Let training improve your chatbots every day · Connected chatbots · Rich messages. Benefits: Use chatbots for repetitive tasks · Say 'Hello' to automation! · Work smarter and more efficiently · Transfer chats to humans when necessary. 4.6/5 • 29 Ratings, “Show all 11 reviews”.

### Uygulama detay sayfası — uygulama içi görünüm

| Örnek | Başlık alanı | CTA | Durum |
|---|---|---|---|
| Google Analytics (`/apps/marketplace/apps/google-analytics`) | Breadcrumb “Explore apps > Analytics > Google Analytics”; “$5 / mo, per license”; rozet **Verified**; “★ 4.4 • Rate this app”; “Developed by Text”; “Works with LiveChat” | **Get** + altında “**Saved in cart**” linki | ⛔ Get tıklanmadı |
| HelpDesk (`/apps/marketplace/apps/helpdesk`) | Breadcrumb “Explore apps > Help Desk > HelpDesk”; rozetler **AI-Powered**, **Verified**; ★ 4.5 | **Get** | ⛔ tıklanmadı |

Sekmeler aynı sayfada kaydırma çapası, başlık yapışkan. ⚠️ Scroll-spy vurgusu bir sekme geride (Reviews'a tıklayınca “Benefits”, Support'a tıklayınca “Reviews” vurgulu). Overview'da görsel karuseli (‹ ›). ⚠️ HelpDesk liste kartında logo boş render edildi.

### Cart (/apps/marketplace/cart)

- “You have **1 item** waiting in your cart”
- **Google Analytics** for LiveChat · “14-day free trial” rozeti · **$5.00 / mo** · Unlimited Agents · döngü menüsü **Billed monthly** (seçenekler: Billed monthly ✓ / Billed annually) + yeşil “Save $9 with annual” · **Learn more** · 🗑 **Remove**
- **You may also like:** Rich Messages (“Engage your customers with rich, beautiful messages.”), Surveys (“Seamlessly create, distribute, and analyze surveys, gathering valuable insights to make informed decisions.”), Quick links (“Easy access to your frequently visited pages while chatting”) — her biri **Add to cart**, Unlimited Agents, Learn more
- **Summary:** RECURRING FEES — Google Analytics $5.00 / mo · Unlimited Agents · Trial ends Oct 28, 2026 · **Total $5.00** · **Billed now $0.00** · **Continue to subscription** · uyarı: “It appears that your product is not fully activated. Before you begin making purchases at Marketplace, please ensure there's a valid credit card in your subscription.”

| Öğe | Durum |
|---|---|
| Döngü menüsü | ✅ açıldı, seçim yapılmadı (sepet sunucuda saklandığından değiştirilmedi), Esc ile kapandı |
| Remove / Add to cart / Continue to subscription / Learn more | ⛔ onay bekliyor (tetiklenmedi) |

⚠️ Sepet rozeti “1”: GA kullanıcı eklemeden sepette. Sepette aylık, Billing > manage'da yıllık toplam içinde gösteriliyor (iki ekran tutarsız).

### External integrations / Self-setup (/apps/marketplace/apps/self-setup)

Hero: “Connect with **customers** across your favorite platforms” / “Explore how to install LiveChat on external platforms through detailed installation guides for a full omnichannel experience” / **Browse guides ↓** (sayfa içi kaydırma). Görselde Adobe, Google Ads, SentiOne logoları.
**74 kurulum rehberi** (hepsi “Works with LiveChat”, `/apps/<slug>/`): 1&1, 1CRM, Loris, Thinkific, Zoey, 3dcart, Uscreen.tv, Jumpseller, Big Cartel, CommerceV3, CoreCommerce, CS-Cart, SentiOne Automate, FCC Connector (T), Drupal, viaSocket, Ecwid, ekmPowershop, Elevio, Freshdesk, Ucraft, Gold-Vision, Google Ads (`google-adwords`), Google Tag Manager, Helpmonks, MotoCMS, Octoboard, VirtueMart, Instapage, IRIS CRM, DotNetNuke, Jimdo, Joomla!, Ghost, Weblium, nopCommerce, Landingi, Leadpages, LeadSquared, Magento, Adobe Commerce (Magento 2), Miva, Upscope, Ordering, OpenCart, osCommerce, OSI Affiliate Software, PinnacleCart, PlayVox, ProProfs, NetSuite SuiteCommerce, 10Web, Segment, SITE123, AmeriCommerce, Stratifyd, Talkdesk, Triggerbee, Tumblr, Unbounce, Help Desk Migration, Volusion V2, WebSite X5, Wishpond, WooCommerce, Woopra, X-Cart, Welyo Connector (Z), Survicate, Help Desk Migration App, InsightDials, Elementor, Zapier, Zen Cart.
⚠️ “Help Desk Migration” ve “Help Desk Migration App” aynı açıklamayla iki kez. ⚠️ WooCommerce ana uygulama listesinde yok, yalnız burada (plan matrisinde “WooCommerce integration” var).

### Partners (/apps/marketplace/partners)

Başlık: “Team up with a Text partner for your next project” — “Find the best match for your business use case and connect with one of our certified partners.”

| Kontrol | Seçenekler / Davranış | Durum |
|---|---|---|
| Search for partner | Enter ile arar; `qqzzxx` → çöl illüstrasyonu + “**Nothing to show**” / “Please adjust filters and / or select another category.” | ✅ |
| Services: All | AI and Data · API and integrations · Chat agent outsourcing · Chat customization · Chat strategy consultancy · Chatbot building · Cloud, DevOps & Managed IT · Consulting · Custom development · Customer service trainings · Design · E-commerce · Finance, law and security · Language & Localization · Lead generation · LiveChat implementation · Marketing · Media & Content Production · Outsourcing and recruitment · Outsourcing customer service · Product implementation · QA & Testing · SEO services · Training | ✅ |
| Country: All | ~100+ ülke; United States en üstte, sonra Algeria, Albania, Andorra, Argentina, Armenia, Australia, Austria, Azerbaijan, Bahrain, Bangladesh, Belarus, Belgium, … | ✅ ⚠️ alfabe bozuk (Algeria > Albania) |
| Industry: All | Automotive · Banks · Charities, Foundations & Non-Profits · E-commerce · Education & Universities · Energy & Utilities · Financial services · Government · Healthcare · Hospitality · Media & Entertainment · Medical & wellness · Other · Professional Services · Real Estate · Technology · Telecommunications · Travelling | ✅ |
| More filters | Markets served · Language | ✅ |
| Text verified | Toggle | ✅ |
| Partner kartı | Ad, “Featured” rozeti, ülke, diller, bütçe (“Undisclosed”), açıklama, hizmet etiketleri + “+N more”, **Contact** | ✅ |
| Contact | Modal “Contact with <partner>”: Your questions (placeholder “Hello! I need staffing my customer service team.”; alt metin “Let the expert know what would you like to get help with. Feel free to ask them anything!”), Your name (Michael), Your surname (Scott), Your email address (michael@scott.com), Your website (https://www.company.com) — placeholder'lar; **Request contact** | ✅ açıldı / ⛔ gönderilmedi; Esc ✅ |
| Join Partner Program | ↗ https://partners.livechat.com/app/auth/sign-up | ↗ |
| Get personalized match | ↗ https://www.text.com/partners/find-a-partner/form/ (yeni sekme; kapatıldı) | ↗ |
| Sayfalama | ‹ 1 2 3 4 5 … **253** › | ✅ |

1. sayfa partnerleri: Joe Bush - Chat Expert (Featured, UK), Conscious Commerce Corporation (Featured, Canada), Chat Center - Español & Português (Featured, US), CrowdChat, HelpFlow, .BespokeChat, Joe Bush (tekrar), [“Want to get listed here? Get listed here by joining our Partner Program…” bandı], Checlickmedia Digital Marketing, Conscious Commerce (tekrar), HiredSupport, Digitech Outsourcing Solution LLC, LLIKA, LTVplus, Aun Digital, Codewebster, RoyalzExpertDev, 203 Media Group, 24x7 VMG Chat, 2buy1click Ltd, 5Hz, 610 Digital LLC, Absolute Digital Media, AgentTrainer, Aik Designs, Airborne Studio, AlchemyLeads, AleaIT Solutions, Alpha IT Solution, Angora Media, Answering Service Care, Appco Software, AppVerticals, Architecture of Sales, ASAP Computer Services, Atomic Object, Auspicioussoft, Avid Panda, BankBound, Beaconcross Technologies, BetterX Worldwide, Bigfolio LLC, Biz4Group LLC, Bizcuits Solutions, Biznatron, BlackBox Vision, Bluelinks Agency, Brand Metrics Fintech, spaceride, BrandingTouch.com, Bright Labs, Budventure Technologies, BusinessKrafts, Buzz Dealer, BxB Media, CandidRoot Solutions, CartCoders, Catalyst Marketing Agency, Chat Center (tekrar), Cindtoro, Ciphers Digital Marketing, CitrusBits, Clear View Advantage, Clickretina.com, ClixLogix, CMARIX, CodeAegis, CodeSol Technologies, Codevelo, Codify Infotech, Codivox, Contese Agency, Corpela Inc., Creatikartta, Curotec, Throttl, CX Engage, Cyber Cultr Media, DASWEB, Debut Marketing, Deliverables Agency, Derivate X, Designpluz, Dgt27, Digital Auxilius, Digital Hunch Agency, Digital Thing, Dispersal Digital Agency, Distantia, Dotoji, Dream Advice, Droidal LLC, eCheckPlan, Ed Olimpio / My Good Profile, eSparkBiz, Ethos Ink, EverHelp, EVERYWOW, Exemplifi, Fgfactory Australia, Humm Oy, Fire Fuel SEO Agency, Fluid Attacks, Fly on the cloud.
Alt bant: “Can't find the right partner? Tell us what your business needs right now and let us do the matchmaking.”

⚠️ Featured partnerler listede ikinci kez tekrar ediyor; bazı kartlarda dil alanı boş; bir açıklamada telefon/URL düz metin (içerikte talimat yok, yalnız iletişim bilgisi); “Outsourcing & recruitment” / “Outsourcing And Recruitment” iki yazım; Corpela Inc. ~70 dil listeliyor (kart taşması); alfabetik sıralamada “spaceride”, “Throttl”, “Humm Oy” yanlış yerde.

### Creators (/apps/marketplace/developers)

“Developers — Power up your customer service with LiveChat integrations.”; sıralama **Number of products** (✓) / **Developer name**.
9 kart: **Text** (“Text Team responsible for building and maintaining Text Apps.”), **Darka Software**, **LiveChat Integrations**, **FEDYK sp. z o. o.** (“We love solving problems by creating efficient software. We are the chats nerds 🤓”), **Sikora Works**, **SKlabs**, **.BespokeChat**, **No-Code Venture**, **Roam Tools** — her biri “Developed” + ürün ikonları.
⚠️ Uygulamalardaki diğer ~20 geliştirici (SnapCall, Tweak Chat, OAPPS, Chat Engineers, Abylay Keldibek, Muka Studios, AgentTrainer, 2way Inc., LiveChat Expert, TM Apps, Vettvangur, SALESmanago, freelancer, m.reszke.pl, jnb Apps, Djavo Software, Service Innovations, QuarkText Apps, LiveSession, ChatBot) Creators sayfasında yok; 14 uygulamada geliştirici linki hiç yok.

### Build your app (/apps/automation/build-your-app)

| Kart | Metin | Buton → hedef |
|---|---|---|
| Make the most of LiveChat with API | “Leverage the power of our APIs to fully customize your LiveChat experience. Build private integrations, connect with CRMs, and create data reports. Visit API Console for details.” | **Explore API Console** → ↗ https://platform.text.com/console |
| Detailed reports | “See precise information on your API usage, requests, and the API methods your apps use.” | **API Usage** → ↗ https://platform.text.com/console/access-api/usage |
| Messaging | “Implement event-based messaging for sync and async communication.” USE CASES: live chat apps, chatbots, in-app messaging | **Check API** → ↗ https://platform.text.com/docs/messaging |
| Advanced solutions | “Explore technological assets powering our industry-leading messaging solutions.” | **Explore** → ↗ https://platform.text.com/ |
| Build your own apps | “Advanced solutions for demanding developers. Explore technological assets powering our industry-leading messaging solutions.” | **Start building** → ↗ yeni sekme açıldı ama **boş kaldı** ⚠️ |

⚠️ CTA'lar `<a>` değil `<button>` + JS yeni sekme; hedef URL hover'da görünmüyor. İki kart aynı açıklama cümlesini tekrar ediyor. Açılan dış sekmeler kapatıldı.

### Automate with webhooks (/apps/automation/webhooks)

“Chat webhooks — Build automated flows to customize your LiveChat experience.” · **Go to Console** · **Read tutorial** · “Webhooks carry information about what's happening in the chat. With webhooks, you can create automated flows and build custom LiveChat integrations. You can set them up here or in the **Developer Console** (↗ https://platform.text.com/console), which offers more webhooks options.” · **Created webhooks** → boş durum “You have no webhooks created yet.” · **+ Add webhook**.

**Add webhook modalı** ✅ (açıldı, kaydedilmedi):

| Event | Data type (varsayılan işaretli) |
|---|---|
| chat_started (varsayılan) | chat ⓘ, visitor ⓘ, pre_chat_survey ⓘ |
| chat_ended | chat, visitor, pre_chat_survey |
| chat_changed | chat, visitor |
| visitor_queued | visitor (disabled + işaretli) |
| canned_response_changed | canned_response (disabled + işaretli) |

- “This event will trigger sending a webhook.” · Target URL placeholder “https://my-app.com”, “This URL will receive the webhook.” · **Cancel** · **Add webhook** ⛔ · ✕ · Esc ✅
- ⓘ tooltip'leri örnek JSON gösteriyor (ör. canned_response: `{"id": 1, "group": 0, "text": "Changed canned response text", "modification_date": 1510562215, "modified_by": "john.doe@mycompany.com", "tags": ["shortcut1", "shortcut2", "shortcut3"]}`).
- ⚠️ “not a url” yazıp odak çıkınca anlık doğrulama yok (gönderim test edilmedi).
- ⚠️ ⓘ tooltip'i fare ayrılınca kapanmıyor, Cancel/Add webhook butonlarını örtüyor; Cancel tıklaması etkisiz kaldı → Esc ile kapatıldı. Kayıt oluşmadı (liste hâlâ boş) ✅.
- ⚠️ chat_ended için “post_chat_survey” yerine “pre_chat_survey” sunuluyor.
- ⚠️ Event değişince modal yüksekliği değişip kayıyor.

---

## HelpDesk (https://my.livechatinc.com/helpdesk-in-livechat)

Sol menüde onay-kutusu ikonlu “HelpDesk”. HelpDesk eklenmediği için tanıtım (upsell) ekranı:

**İçerik**
- Yeşil HelpDesk logosu
- Başlık: “**Save 670 working hours per year on support with the ticketing system**”
- Metin: “Transform chats and emails into tickets and reclaim hundreds of hours each year. Focus on what matters most – solving cases and innovating.”
- Buton: **Add HelpDesk ticketing system**
- Sağda illüstrasyon (img alt=“promo”): e-posta kartı “Can't access account — Peter Lawson <peter@mail.com> To: Help Center” → “New ticket” → “Urgent” → “IT Support” → “Automatically send a reply” → “All tickets” listesi (Peter Lawson · Can't access account).

| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Add HelpDesk ticketing system | `<button>` (href yok, enabled) | HelpDesk ürününü ekler / deneme başlatır | ⛔ onay bekliyor (tetiklenmedi) |
| İllüstrasyon | Statik görsel | Etkileşim yok | ✅ |

**Edge-case / bulgular**
- Kaydırılacak başka içerik, sekme veya ayar yok. Fiyat bu ekranda verilmiyor (Billing modalında “HelpDesk starts at $29”; marketplace'te “Free to install”; detayda “See the pricing at www.helpdesk.com/pricing” ve “Integration with LiveChat is possible starting from the Team plan.” 🔒).
- ⚠️ Görselin alt metni “promo” — açıklayıcı değil.
- Settings altında “Email by HelpDesk” (`/settings/helpdesk`) ayrı sayfa var — başka bölümün kapsamı.

---

## Ulaşılamayan / test edilmeyen noktalar ve nedenleri

1. **Satın alma/ödeme akışları** — Go to checkout, Continue to subscription, Upgrade now, Add card → güvenlik kuralı ⛔. (Subscribe now yalnız plan sayfasına götürdüğü için test edildi.)
2. **Enterprise “Request a call” / “Contact sales”** — satış talebi gönderebileceğinden tıklanmadı ⛔.
3. **Get (kurulum), Add to cart, Remove, Rate this app** — hesap durumunu değiştirdiği için ⛔.
4. **HelpDesk “Add HelpDesk ticketing system”** ⛔ — kurulu HelpDesk arayüzü görülemedi.
5. **Webhook kaydetme** ⛔ — webhook listesi/düzenle/sil durumları görülemedi (liste boş).
6. **Invoices** — hesapta fatura yok ve uç nokta “Failed to fetch invoices” döndü; tablo/indirme görülemedi.
7. **Kurulu uygulamalar** — hesapta yok ve “My apps” sekmesi mevcut değil.
8. **Partners** — 253 sayfanın yalnız 1.'si listelendi; partner detayı açılmadı; Country listesi kısmen kaydedildi.
9. **117 uygulamanın Key Features/Benefits maddeleri** — yalnız bölüm başlıkları toplandı (SSR'da madde başlıkları heading etiketi değil); ChatBot ve HelpDesk birebir okundu. “Show all N reviews” açılmadı.
10. **Payment type / Placement filtre sonuç sayıları** — seçenekler kaydedildi, her biri için sayım yapılmadı. Alphabetical sıralama sonucu kaydedilemedi (tıklama karta isabet etti).
11. **Uygulama detayında Overview video/karusel** — görsel içerik, metin olarak kaydedilmedi.


---
<a id="s5"></a>

# 05 — Settings (/settings) — BFS dokümantasyonu

Lisans: 19985624 (trial, "14 days left in your trial" banner'ı + "Upgrade now" butonu üst şeritte). Tarih: 2026-10-14.
Etiketler: ✅ test edildi · ⛔ onay bekliyor (tetiklenmedi) · ⚠️ bulgu · ↗ dış link · 🔒 plan/trial kilidi

## Giriş / erişim notu

- ⚠️ **Onboarding kapısı:** `/settings`, `/settings/*`, `/home` gibi tam sayfa yüklemelerinde uygulama `/install-code` sayfasına yönlendiriyor ("Start using LiveChat on your website now"). Sayfada: kod snippet'i, "Copy code", "Invite your developer", "Install guide", "Other ways to install" (Connect with Google Tag Manager — açılır; "More integrations +11") ve en altta **"I don't want to chat yet"** butonu var.
- "I don't want to chat yet" tıklanınca ✅ uygulama `/settings/code`'a (ilk deep-link hedefi) geçiyor. Kapı her tam sayfa yenilemesinde tekrar çıkıyor → kalıcı değil, oturum/SPA içi geçiş. Bu nedenle tüm alt sayfalar SPA içi (sidebar link) navigasyonla gezildi.
- `/settings` kökü → `/settings/code`'a (Install LiveChat) yönleniyor.

## Settings yan menüsü — tam envanter

| Grup | Öğe | URL | Rozet/durum |
|---|---|---|---|
| Channels (açılır) | Install LiveChat | /settings/code | kırmızı "!" + OFF |
| Channels | Email by HelpDesk | /settings/helpdesk | OFF |
| Channels | Facebook Messenger | /settings/facebook-messenger | OFF |
| Channels | Apple Messages | /settings/apple-messages-for-business | OFF |
| — | Chat page | /settings/chat-page | |
| Website widget (açılır, varsayılan kapalı) | Customization | /settings/theme | |
| Website widget | Language | /settings/language | |
| Website widget | Availability | /settings/availability | |
| Website widget | Welcome screen | /settings/welcome-screen | |
| Forms (açılır) | Pre-chat form | /settings/pre-chat-form | |
| Forms | Ask for email | /settings/ask-for-email | |
| Forms | Post-chat form | /settings/post-chat-form | |
| Forms | Ticket form | /settings/ticket-form | |
| Engagement (açılır) | Eye-catcher | /settings/eye-catcher | |
| Engagement | Chat buttons | /settings/chat-buttons | |
| Engagement | Quality showcase | /settings/quality-badge | |
| — | Tags | /settings/tags | |
| — | Sales tracker | /settings/sales-tracker | |
| Chat settings (açılır) | Chat assignment | /settings/chats-assignment | |
| Chat settings | Transcript forwarding | /settings/archives-forwarding | |
| Chat settings | File sharing | /settings/file-sharing | |
| Chat settings | Inactivity timeouts | /settings/inactivity-timeouts | |
| Security (açılır) | Trusted domains | /settings/trusted-domains | |
| Security | Banned customers | /settings/banned-customers | |
| Security | Credit card masking | /settings/credit-cards-masking | |
| Security | Login settings | /settings/login-settings | |

Not: Menüde ayrı "Canned responses", "Integrations", "Sounds/notifications", "WhatsApp" öğesi YOK (bunlar uygulamanın başka bölümlerinde olabilir). Sol ana nav'daki ayar ikonu üzerinde kırmızı "!" rozeti var (kod kurulmamış).

## Ortak öğeler (tüm Settings sayfaları)

| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Üst şerit "1 4 days left in your trial." + "Upgrade now" | banner + buton | Billing/upgrade akışına götürür | ⛔ tıklanmadı 🔒 |
| Search (Ctrl K) | global arama | Komut paleti | ana nav bölümü (bu bölüm dışı) |
| "+ Invite" (üst sağ) | buton | "Invite people to LiveChat" modalı (bkz. Install LiveChat > Invite your developer ile aynı modal) | — |
| Sayfa başlığı solundaki panel ikonu | buton (ikon) | Settings yan menüsünü daralt/genişlet | ✅ |
| Grup başlıkları (Channels, Website widget, Forms, Engagement, Chat settings, Security) | akordeon | Tıkla → aç/kapa (chevron). İlk girişte yalnız Channels açık | ✅ |
| Sağ alt turuncu LiveChat balonu | widget | LiveChat'in kendi destek widget'ı (vendor chat) | tıklanmadı |

## Settings — Install LiveChat (/settings/code)

### İçerik
- Başlık "Install LiveChat", sağ üst **"Preview live"** ↗ `https://cdn.livechatinc.com/preview/19985624` (widget önizleme sayfası, yeni sekme).
- "Install website widget" + kırmızı "!" ; açıklama: "To see LiveChat on your website, you'll need to add a bit of code or configure an integration." + **Learn more** ↗ `https://www.livechat.com/help/setting-up-livechat-on-your-website/`
- Kart **"Install chat widget manually"** — "1. Copy and paste this code before the </body> tag on every page of your website." + kod görseli + **Copy code**.
- "Need help?" → **Invite your developer**, **Check install guide**.
- **OTHER WAYS TO INSTALL** (akordeon listesi): Connect with Google Tag Manager, Connect with WordPress; "Show more ways" ile: Connect with Shopify, Install WooCommerce plugin, Connect to BigCommerce, Connect with Ecwid, Connect with Adobe Commerce (Magento), Connect with SquareOnline, Connect with Squarespace, Connect with Wix, Connect with Webflow, Connect to Weebly, Connect to Joomla!, Connect with Drupal, Connect to Segment → "Show less ways". Altta "See more ways to install LiveChat via **3rd party integrations**".
- Her akordeon açılınca: kısa açıklama (ör. GTM: "Connect your GTM account to quickly set up chat widget on your website.") + **Install** (GTM) / **Connect** (diğerleri) + Invite your developer + Check install guide.

### Öğeler & durumlar
| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Copy code | buton | Panoya kopyalar; buton ~2 sn "✓ Copied" (koyu mavi) olur | ✅ |
| Invite your developer | buton | "Invite people to LiveChat" modalını açar | ✅ (aşağıda) |
| Check install guide | buton | Yardım makalesi (yeni sekme, livechat.com/help) | ↗ tıklanmadı |
| GTM "Install" | buton | GTM OAuth/kurulum | ⛔ onay bekliyor (tetiklenmedi) |
| WordPress…Segment "Connect" (14 adet) | buton | Entegrasyon bağlama | ⛔ onay bekliyor (tetiklenmedi) |
| Show more ways / Show less ways | toggle buton | Listeyi 2 ↔ 15 yönteme genişletir/daraltır | ✅ |
| 3rd party integrations | buton/link | Marketplace'e yönlendirme | tıklanmadı |
| Sidebar "Install LiveChat" | link | kırmızı "!" + kırmızı "OFF" (kod algılanmadı) | ✅ |

### Modal: Invite people to LiveChat
- Alanlar: 4 satır "Email addresses" (placeholder: Eg. chatting.agent@outlook.com / Eg. team.leader@outlook.com / Eg. marketer@outlook.com / Eg. sales.rep@outlook.com) + her satırda **Role** dropdown.
- Role seçenekleri: **Admin (billing access)** (varsayılan, ✓), **Admin**, **Agent**.
- Alt: "🔗 Copy invite link" (tıklanmadı — davet linki üretir/kopyalar), **Send invites** (boşken disabled) ⛔.
- ✅ Validasyon: "not-an-email" yazıp odak değiştirince kırmızı çerçeve + "Enter a valid email address"; Send invites hâlâ disabled.
- ✅ Esc: önce açık dropdown'ı kapatır, modal açık kalır.
- ✅ X ile kapatma, alan doluyken → onay diyaloğu **"Cancel inviting agents?"** — "If you cancel inviting agents now, they won't join your organization." Butonlar: **Back to inviting** / **Cancel inviting** (kırmızı). "Cancel inviting" → taslak atıldı, hiçbir şey gönderilmedi.

### Edge-case / bulgular
- ⚠️ Sayfadaki kod "snippet"i aslında bir **görsel** ve içinde `__lc.license = 100170061` yazıyor; hesabın gerçek lisansı 19985624 (DOM'da gerçek kod 19985624 ile mevcut, Copy code doğru kodu kopyalıyor). Kullanıcı görseldeki kodu elle yazarsa yanlış lisans kurar → yanıltıcı.
- ⚠️ `/install-code` onboarding sayfasındaki snippet'te `integration_name = "manual_onboarding"` ve `product_name = "livechat"` alanları da var.
- ⚠️ Global onboarding yönlendirmesi: kod kurulmadan her tam sayfa yüklemesinde `/install-code` araya giriyor (deep link'ler doğrudan açılmıyor).

## Settings — Email by HelpDesk (/settings/helpdesk)

### İçerik
- Başlık "Transform your email experience"; metin: "Effortlessly convert emails to manageable tickets and solve them on an individual, team, or automatic basis. Amaze your customers with timely and organized messaging." + illüstrasyon (HelpDesk e-posta/ticket ekranı).

### Öğeler & durumlar
| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Try 14-day HelpDesk trial | buton (birincil) | HelpDesk deneme başlatır | ⛔ onay bekliyor (tetiklenmedi) |
| Learn more | link | ↗ https://www.helpdesk.com/integrations/livechat/ | ↗ |
| Sidebar rozeti | — | "OFF" | — |

## Settings — Facebook Messenger (/settings/facebook-messenger)

### İçerik (sayfa gövdesi iframe içinde yükleniyor — entegrasyon uygulaması)
- Başlık "Accept chats from Facebook Messenger".
- Mavi promosyon şeridi: "Reply Longer, Reach Further - go PRO today!" / "Get a 7-day response window, $10 for marketing campaigns, and a custom welcome screen." + **Upgrade for $39/month** (sarı buton) 🔒⛔.
- Kart "Connect your Facebook page" — "See and reply to your Facebook page messages directly in LiveChat." + **Connect to Facebook** ⛔ (OAuth, tetiklenmedi).

### Edge-case / bulgular
- ⚠️ İçerik ~3-4 sn gecikmeli (iframe) yükleniyor; ilk anda yalnız başlık görünüyor.
- ⚠️ Messenger PRO ayrı bir ücretli eklenti ($39/ay) olarak satılıyor.

## Settings — Apple Messages (/settings/apple-messages-for-business)

### İçerik
- Üst sağ: **Open Help Center** (↗ yardım merkezi).
- Etiket "AVAILABLE IN BUSINESS & ENTERPRISE PLANS" 🔒; başlık "Be right where communication happens"; metin: "Let over 1.65 billion Apple users connect with you just as they would with friends in iMessage. Your customer service team will chat with Apple users directly from the LiveChat Agent App." + telefon/masaüstü görseli.
- **View pricing plans** (birincil, billing'e gider) ⛔ · **Learn more** (↗).

| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Open Help Center | buton | Yardım merkezi (dış) | ↗ |
| View pricing plans | buton | Planlar/upgrade | 🔒 ⛔ |
| Learn more | link | Dış yardım makalesi | ↗ |

## Settings — Chat page (/settings/chat-page)

### İçerik
- Sağ üst **✎ Customize** → `/settings/chat-page/setup`.
- Hero: "Chat with customers wherever they are" — "Share a link to your chat page without setting up a website. Use it in emails, newsletters, digital files, and on social media." + **Test it out** (link, chat page'i yeni sekmede açar ↗ `https://direct.lc.chat/19985624/`).
- Salt okunur input: `https://direct.lc.chat/19985624/` + **Copy** butonu.
- Sağda chat page önizlemesi ("CHAT WITH OUR SUPPORT TEAM / Hello! / Get instant, personalized support with our live chat feature. Get answers to your questions by interacting with the chat box. Remember to rate your conversations to help other users.").
- Özellik şeridi: "No code. No setup." · "Works out of the box." · "Works with groups".
- 3 bilgi kartı: **Share on X (Twitter)** — "Take support cases off X by sharing your chat page link in a tweet or comment." · **Share on Facebook** — "Let customers know about your chat in a Facebook post or comment." · **Share QR code** — "Let customers contact you by scanning the QR code with their phones." (QR görseli).

### Öğeler & durumlar
| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Customize | buton/link | `/settings/chat-page/setup` alt sayfası | ✅ |
| Test it out | link | ↗ direct.lc.chat/19985624/ | ↗ |
| Copy | buton | Linki seçer/kopyalar (görsel "Copied" geri bildirimi görülmedi, input metni seçili hale geldi) | ✅ |
| Share on X / Facebook / QR kartları | kart | Tıklama/hover ile hiçbir aksiyon yok (statik bilgi kartları) | ✅ |

### Edge-case / bulgular
- ⚠️ "Share on X", "Share on Facebook", "Share QR code" kartları buton gibi görünüyor ama tıklanamaz; QR kodu indirme/büyütme seçeneği yok.
- ⚠️ Copy butonunda belirgin "Copied" geri bildirimi yok (Install sayfasındaki Copy code'da var) — tutarsızlık.

### Alt sayfa: Customization (/settings/chat-page/setup)
- Başlık "← Customization" (geri oku → /settings/chat-page).
- **Chat page title**: "Add a clear page title to help customers find your chat page easily in their browser and search results." · **Page title** input (varsayılan "Chat now! | Live Chat Customer Support", sayaç 38) — "Max. 60 characters. Complete this field to improve search result ranking."
- **Display name** input (boş, placeholder "e.g. Acme Support", sayaç 0) — "Max. 40 characters. Use your full company name."
- **Show logo** toggle (AÇIK) + logo yükleme alanı (varsayılan LiveChat mavi baloncuk logosu) — "Max. 1500×1000 px | jpg, jpeg, png, gif" — "The logo will be visible both on the chat page and in the chat widget." (yükleme ⛔ yapılmadı)
- **Quality of customer support** toggle (AÇIK) — "This section is automatically generated using your product data: total rated chats, average first response time, customer satisfaction rate, and number of people who chatted. Use the toggle to show or hide it on your chat page. Data reflects the last 30 days."
- Sağda tarayıcı-sekmesi görünümlü canlı önizleme (sekme başlığı "Chat now! | Live Chat Cust…").

| Öğe | Tür | Davranış | Durum |
|---|---|---|---|
| Page title | text | Sayaç; >60 → kırmızı sayaç + "Character limit exceeded. Max 60 characters allowed.", Save disabled; boş bırakılınca hata yok, placeholder "Enter page title..." | ✅ |
| Display name | text | Canlı önizleme: "CHAT WITH EXAMPLE CO", başlık "Example Co Support", metin "Example Co's live chat feature…"; >40 → "Character limit exceeded. Max 40 characters allowed." | ✅ |
| Show logo / Quality toggle | switch | değiştirilmedi (kaydetme çubuğu tetikleyebilir) | kaydedilmedi |
| Kaydetme çubuğu | sticky footer | Herhangi bir değişiklikte altta **Cancel** + **Save changes** çıkar; geçersizken Save disabled | ✅ / Save ⛔ |
| Cancel | buton | Tüm alanları önceki değere döndürür, çubuk kaybolur | ✅ |

- ✅ Özel karakter testi (`<script>&"'`) önizlemede düz metin olarak (büyük harfle) render edildi, HTML yorumlanmadı.
- ⚠️ **Kaydedilmemiş değişiklik varken "←" geri okuna basınca uyarı YOK** — değişiklikler sessizce atılıyor ve /settings/chat-page'e dönülüyor. Tekrar girince değerler orijinal (✅ kalıcı değişiklik yok).
- ⚠️ Page title boş bırakılabiliyor: alan altında zorunlu-alan hatası çıkmıyor (Save durumu ayrıca izole test edilmedi; o anda Display name limit hatası nedeniyle disabled idi).

## Settings — Website widget › Customization (/settings/theme)

Sayfa tarayıcı başlığı "Theme | LiveChat Settings". Sol: "Customize your chat widget — Decide how the chat widget on your website will look, behave and what information it will offer." Sağ: **Preview** paneli (canlı widget önizlemesi: ajan "azzatenli / Product Expert" kartı, 👍/👎, "Hello. How may I help you?", "I'd like to ask something" (Read), "Go ahead", "Write a message…", emoji, ek (+), gönder (disabled), "Powered by LiveChat" ↗ livechat.com/powered-by-livechat/) + alt link **Test it out** on the chat page ↗ `https://cdn.livechatinc.com/preview/19985624`.
Bölümler akordeon; her biri açılınca URL değişiyor (deep link): `/settings/theme/customizeonwebsite`, `/appearance`, `/position`, `/mobilechatwidget`, `/additionaltweaks`. Aynı anda tek akordeon açık.
Tüm değişiklikler alt sticky çubuk ile kaydediliyor: **Cancel** / **Save changes** (⛔ Save tıklanmadı).

### Customize widget on website (NEW!) — /settings/theme/customizeonwebsite
- Görsel + "Align widget with your brand by customizing it directly on your website."
- **Type website address** input — önceden dolu: `drboolum.org` (hesap kaydındaki site adresi olduğu düşünülüyor) + mavi **→** butonu (siteyi on-site editörle açar ↗ — ⛔ tıklanmadı).
- ✅ Boş → "The value cannot be empty", → disabled. ✅ "not a url!!" → boşluklar otomatik siliniyor ("notaurl!!") + "The value must be a valid URL", → disabled. Bu alan kaydetme çubuğunu tetiklemiyor.

### Appearance — /settings/theme/appearance
| Öğe | Tür | Seçenekler / varsayılan | Davranış | Durum |
|---|---|---|---|---|
| MINIMIZED WINDOW | kart-radio | Bar / **Bubble** (✓) | Bar seçilince önizleme "Chat with azzatenli" mavi bar'a dönüşüyor; kaydetme çubuğu çıkıyor | ✅ |
| Theme and colors | kart-radio | **Light** (✓) / Dark | Dark → önizleme koyu temaya geçiyor; swatch paletinin ilk rengi siyah→açık griye dönüyor | ✅ |
| Theme color (radio, varsayılan seçili) | renk swatch | #1C1C1C, #6936BD, **#0059E1** (✓), #5FC8D6, #73D943, #FFCA00, #FF6D03, #DA3807, #D92685 + 🌈 özel renk | 🌈 tıklanınca hex input (#2472E8) + renk kutusu ▾ (doygunluk/parlaklık kare + ton seçici açılır) | ✅ |
| Hex input | text | — | "zzzzzz" girildi → kabul etmedi, #2472E8'e döndü (geçersiz hex sessizce reddediliyor, hata mesajı yok) | ✅ ⚠️ |
| More color settings (radio) | radio | "Make the chat widget more unique by choosing a custom color scheme." | Açılınca: **Minimized widget**: Bar (#2472E8), Bar text (#FFFFFF), Icon color (#FFFFFF); **Maximized widget**: Chat background (#111111 – dark modda), Opacity (100%), Primary color (#2472E8), Customer's bubble (#2472E8), Customer's text (#FFFFFF), Agent's bubble (#252525), Agent's text (#FFFFFF), System messages (#B3B3B3). Her biri hex + renk seçici ▾ | ✅ |
| Opacity | text (%) | 100% | ⚠️ "250" yazınca değer "2%" oldu (aralık dışı değer hata vermeden ilk haneye kırpılıyor) ve önizleme neredeyse saydam oldu | ✅ ⚠️ |

- ✅ Cancel → Bubble/Light/varsayılan renkler geri geldi.

### Position — /settings/theme/position
- **Widget position**: Align to: dropdown (**Right** / Left), Side spacing: [0] px, Bottom spacing: [0] px.
- **Visibility** — "Control when to display the chat widget icon on your website." + **Read more…** ↗ `https://www.livechat.com/help/chat-widget-visibility/`
  - (●) **The chat widget is always visible** — "Display the widget icon on your site to let customers start a chat." (varsayılan)
  - ( ) **Hide widget until it gets activated** ⓘ — "Once a chat is started, the widget will appear and will remain visible." Tooltip: "The chat widget will only show up after: a campaign is displayed, or a customer clicks on your site's chat button, or an API call opens the chat widget."
  - ( ) **Always hide minimized widget icon** — "Customers won't be able to start chats unless you add a clickable chat button to your website."
- ✅ Bottom spacing "99999" → kırmızı "Value should be between 0-100", Save disabled.
- ⚠️ Side spacing "-50" → eksi işareti atılıp "050" gösterildi (hata yok; baştaki sıfır temizlenmiyor).
- ⚠️ Align "Left" seçildiğinde önizleme konumu değişmiyor (önizleme yalnız widget penceresini gösteriyor).
- ✅ Cancel → 0/0, Right.

### Mobile chat widget — /settings/theme/mobilechatwidget
- **Show chat widget on mobile** toggle (AÇIK). Kapatınca alt seçenekler gizleniyor + kaydetme çubuğu çıkıyor (anlık kaydetmiyor ✅).
- (●) **Same as on desktop** / ( ) **Custom for mobile devices**. Custom seçilince: **Appearance** › Mobile widget type: dropdown (**Bubble** / Bar); Align to (Right/Left), Side spacing px, Bottom spacing px; **Visibility** (Position'daki 3 seçeneğin aynısı + Read more…). Önizleme panelinde **Desktop / Mobile** sekmeleri beliriyor (Mobile seçili, telefon çerçevesinde önizleme).
- ✅ Cancel → Same as on desktop.

### Additional tweaks — /settings/theme/additionaltweaks
| Öğe | Tür | Varsayılan | Davranış | Durum |
|---|---|---|---|---|
| Show logo + "Upload your logo" linki | toggle + link | AÇIK | Upload dosya seçici açar | ⛔ upload yapılmadı |
| Show agent's photo | toggle | AÇIK | Kapatınca önizlemedeki ajan avatarları kayboluyor; kaydetme çubuğu çıkıyor | ✅ (Cancel ile geri alındı) |
| Enable sound notifications for customers ⓘ | toggle | AÇIK | Tooltip: "Your customers can hear sound notifications when using your chat window. They can mute/unmute them during chat." | değiştirilmedi |
| Let customers rate agents | toggle | AÇIK | — | değiştirilmedi |
| Let customers get chat transcripts | toggle | AÇIK | — | değiştirilmedi |
| White label widget ⓘ 🔒 | toggle (kilitli) | KAPALI | Tooltip: "Remove "Powered by LiveChat" label from your chat widget". Tıklanınca ~1-2 sn karartma sonrası modal **"Upgrade to unlock"** — "This feature is not available in your plan. Upgrade your account to get access." + **Change plan** (⛔) + X | ✅ 🔒 |

### Kaydedilmemiş değişiklik koruması
- ✅ Sidebar'dan başka sayfaya (Language) geçmeye çalışınca modal: **"You have unsaved changes"** — "Your changes will be lost if you continue. Are you sure you want to discard them?" → **Stay here** / **Discard changes** (kırmızı) / X.

### Edge-case / bulgular
- ⚠️ **Sayfa başlığı (header) hatası:** /settings/theme açılınca üst başlık "Customization" yerine **"Chat page"** (önceki sayfanın adı) gösteriyor. Unsaved-changes modalında "Stay here" seçildikten sonra başlık **"Language"** olarak kalıyor, URL hâlâ /settings/theme/… → başlık route ile senkron değil.
- ⚠️ Chat page › Customization'daki "←" geri okunda unsaved uyarısı yok, ama Website widget › Customization'da sidebar geçişinde var → tutarsız koruma.
- ⚠️ Geçersiz hex ve aralık dışı opacity için kullanıcıya hata mesajı yok (sessiz düzeltme/kırpma).

## Settings — Website widget › Language (/settings/language)

### İçerik
- **Select language** — aranabilir combobox (açılınca placeholder "Select option", yazınca filtreler; eşleşme yoksa "No results found"). Varsayılan: **English**.
- Tam liste (48 dil, sıralı): العَرَبِيَّة, Հայերեն, Azərbaycan, български, Català, 简体中文, 繁體中文, Hrvatski, Česky, Dansk, Nederlands, English, Eesti, زبان فارسی, Suomi, Français, ქართული, Deutsch, Ελληνικά, עברית, हिन्दी, Magyar, Íslenska, Bahasa Indonesia, Italiano, 日本語, қазақ тілі, 한국어, Latviešu, Lietuvių, Malagasy, Bahasa Malaysia, Norsk (nynorsk), Norsk (bokmål), Polski, Português, Português brasileiro, Română, Русский, Srpski, Slovenčina, Slovenščina, Español, Svenska, ไทย, Türkçe, Українська, Tiếng Việt.
- **Customize phrases** (akordeonlar, tek seferde biri açık):
  - **Welcome your customers**: Welcome message ["Hello. How may I help you?"], Default customer name ["Customer"], Message placeholder ["Write a message…"].
  - **Agents are away** — "Customers can still start a chat. They'll see offline info and **ask for email** form." (link → /settings/ask-for-email). Alan: **Offline info** (textarea) ["We're away at the moment. Leave a message, and we'll reply by email."]
  - **Customers get in a queue** — "If all agents hit their limit or **chat routing** is set to manual new customers will be queued." (link ↗ https://www.livechat.com/help/queue-configuration/). Alan: **Queued customer info** ["You're %number% in the queue. The wait is about %minutes% minute(s). Thanks for your patience."] + yardım: "Use variable %number% to tell customers which place they occupy in the queue. Use %minutes% to show when an agent will reply."
- Sağda Preview (Customization ile aynı widget önizlemesi) + "Test it out on the chat page".

### Öğeler & durumlar / testler
| Test | Sonuç | Durum |
|---|---|---|
| Türkçe seçimi (tıklayarak) | Önizleme anında Türkçe: "Merhaba. Size nasıl yardımcı olabilirim?", "Okundu", "Mesaj yazın…"; alanlar Türkçe varsayılanlara dönüyor ("Müşteri", "Mesaj yazın..."); kaydetme çubuğu Cancel/Save changes | ✅ (Cancel → English) |
| Welcome message boş | Hata yok, Save changes etkin; önizleme eski metni göstermeye devam ediyor | ✅ ⚠️ |
| Welcome message çok uzun + `<b>bold</b> & %name% {{x}}` | Karakter sınırı/sayaç yok; önizlemede HTML düz metin, **%name% → "Customer"** ile değiştiriliyor (değişken desteği var ama arayüzde belgelenmemiş) | ✅ ⚠️ |
| Cancel | Tüm değerler geri döndü (Hello. How may I help you? / Customer / Write a message…) | ✅ |

### Edge-case / bulgular
- ⚠️ **KRİTİK UX/GÜVENLİK BULGUSU:** Dil combobox'ında arama yazıp **Enter**'a basınca seçim yapılmıyor; bunun yerine sayfadaki HTML formu **native GET submit** ediliyor → tam sayfa yenilemesi, URL: `/install-code?Welcome_to_chat=Hello.+How+may+I+help+you%3F&Client=Customer&Embedded_textarea_placeholder=Write+a+message%E2%80%A6&selectedLanguageId=en` (onboarding kapısına düşüyor, ardından /settings/language?… ile aynı query string'le geri dönüyor). Form alan değerleri URL'ye sızıyor (tarayıcı geçmişi/log'lara düşebilir); kaydedilmemiş değişiklikler uyarısız kayboluyor. Sunucuya kayıt yapılmadı (dil English kaldı ✅).
- Alan iç isimleri query'den görülebiliyor: `Welcome_to_chat`, `Client`, `Embedded_textarea_placeholder`, `selectedLanguageId`.
- ⚠️ Welcome/Offline/Queue alanlarında maxLength veya sayaç yok (Chat page alanlarında var) — tutarsız.

## Settings — Website widget › Availability (/settings/availability)

### İçerik
- **Customers can start a chat** (iki kart-radio):
  - (●) **Always** (varsayılan) — • Customers can send messages even if you're away. • You'll see their messages as unassigned chats. • Customers will get an email with your reply. • Chat history is available for both agents and customers.
  - ( ) **Only when agents are accepting chats** — • Customers can't start a chat when you're away. • With HelpDesk, customers will be able to leave tickets that you can handle once you're available. "Available with [HelpDesk logosu]". Seçilince ek checkbox: ☑ **Customers can see the chat history** (varsayılan işaretli).
- **What happens when**:
  - **Agents are away** — "Customers will see offline status info" [Customize] · "Customers will be asked to leave their email address" [Customize] (yalnız Always modunda). "Only when…" modunda ikinci satır yerine: "Try HelpDesk to get tickets from your customers when you're away" + **Try 14-day HelpDesk trial** (⛔).
  - **Customers get in a queue** — "Customers will see queue info" [Customize].

| Öğe | Davranış | Durum |
|---|---|---|
| Always / Only when… radio | Değişiklik kaydetme çubuğu (Cancel/Save changes) açıyor; anlık kaydetmiyor | ✅ (Cancel → Always) |
| Customize #1 (offline status) | → /settings/language ("Agents are away" akordeonu açık) | ✅ |
| Customize #2 (email) | → /settings/ask-for-email | ✅ |
| Customize #3 (queue) | → /settings/language ("Customers get in a queue" açık) | ✅ |
| Try 14-day HelpDesk trial | Deneme başlatır | ⛔ |

- ⚠️ Customize ile Language'a gidilince üst başlık "Availability" olarak kalıyor (aynı stale header hatası).

## Settings — Website widget › Welcome screen (/settings/welcome-screen)

Akordeonlar ve deep link'ler: Customize header (`/settings/welcome-screen`), Manage content (`/settings/welcome-screen/content`), Change settings (`/settings/welcome-screen/settings`). Sağda Preview: welcome ekranı ("Welcome! Text us", ajan kartı "Hello. How may I help you?", **Back to chat** butonu, alt sekmeler **Home / Chat**, Powered by LiveChat) + Test it out.

### Customize header
- **Show logo** ⓘ toggle (AÇIK) — "Brand your widget's welcome screen with your company logo". Tooltip: "The logo will also be visible in chat widget, chat page and all emails sent to widget users". Logo alanı (turuncu LiveChat logosu) — "Max. 1500×1000 px jpg, jpeg, png, gif" (upload ⛔).
- **Welcome text** input ["Welcome! Text us"].
  - ✅ Boş → hata yok, önizlemedeki başlık tamamen kayboluyor, Save etkin. ⚠️
  - ✅ Uzun + `<i>x</i> & çşğüöı 😀` → input 50 karakterde kesiyor; **tam 50 karakterde** "Text cannot be longer than 50 characters" hatası çıkıyor ama **Save changes etkin kalıyor** (disabled:false). ⚠️ Önizleme HTML'i düz metin, emoji ve Türkçe karakterleri doğru gösteriyor.
  - ✅ Cancel → "Welcome! Text us".

### Manage content
| Kart | Metin | Buton | Durum |
|---|---|---|---|
| **LiveChat** (Active rozeti) | "Invite customers to chat or let them know when agents are offline." | Customize → /settings/language | ✅ |
| **Other channels** › WhatsApp | "Offer more ways to connect by activating WhatsApp as marketplace integrated channel in your chat widget." | Go to marketplace | ↗ tıklanmadı |
| **More channels** (coming soon) › KnowledgeBase | "Let customers browse your help center articles inside your chat widget." | Install | ⛔ |
| HelpDesk | "Let customers leave messages when agents are offline. Messages are saved as tickets in your HelpDesk." | Install | ⛔ |
| **Custom links** | "Elevate your customer service with links. Direct customers to help centers, social media, or meeting scheduling." (örnek link iskeletleri) | Add links | ✅ |

#### Modal: Custom links
- Animasyonlu örnek liste: Schedule a call, Watch video guide, Follow us on X, Terms & Conditions. Başlık "Elevate your customer service with handy links" — "Guide users to help centers, meeting scheduling, or social media. Paste the link below to add it to your welcome screen."
- Input "Paste new link and hit enter" + ↑ butonu; alt: **Cancel** / **Done**.
- ✅ "not a link" → "Please provide a valid URL address".
- ✅ `https://example.com/help` → link kartı oluşuyor: **Name your link** (boş, odaklı) + **URL** + 🗑 sil ikonu; Done disabled (isim boşken).
- ✅ İsim >30 karakter → "Label can have up to 30 characters".
- ⚠️ İsim "Help" yazıldıktan sonra bile Done görsel olarak disabled kaldı (blur gerekmiş olabilir). Done ⛔ tıklanmadı (kalıcı olabilir). Cancel → modal kapandı, link eklenmedi ✅.

### Change settings
- **Show welcome screen** toggle (AÇIK) — "Decide whether customers should see a welcome screen in your chat widget." (değiştirilmedi)

## Settings — Forms › Pre-chat form (/settings/pre-chat-form)

### İçerik
- **Pre-chat form** ana toggle (AÇIK) — "Pre-chat forms allow you to gather visitor's information before the chat starts." **Learn more** ↗ https://www.livechat.com/help/chat-surveys/
- Form oluşturucu (her eleman kartı: ⠿ sürükleme tutamacı, ˅ daralt/genişlet, eleman adı, ☐ Required, 🗑 sil):
  1. **Information** — Message (textarea) ["Let's chat! Fill in a few details to get started."]
  2. **Name** — ☐ Required — Label ["Name:"]
  3. **Email** — ☐ Required — Label ["E-mail:"]
- **+ Add element** menüsü: Information · Name (disabled — zaten var) · Email (disabled — zaten var) · Question · Choice list · Dropdown · Multiple choice list · Group selection.
- **Show pre-chat form after campaign** toggle (AÇIK) — "You can decide if you want to display pre-chat form after campaign is send to the customer." **Learn more** ↗ https://www.livechat.com/help/chat-surveys/#pre-chat-after-campaigns
- Sağda Preview: ajan kartı, mesaj, Name:/E-mail: alanları, **Start the chat** butonu.

### Eleman tipleri ve yapılandırma alanları (her biri yerel olarak eklendi, sonra Cancel ✅)
| Tip | Alanlar | Varsayılanlar | Önizleme |
|---|---|---|---|
| Information | Message (textarea) | "Let's chat! Fill in a few details to get started." (yeni eklenen ikinci Information da aynı metinle geliyor) | Metin bloğu |
| Question | ☐ Required, Question (label) | boş | Metin kutusu |
| Choice list | ☐ Required, Label ["Question:"], Choice #1 ["First answer"], Choice #2 ["Second answer"], + Add answer, her seçenekte × | — | Radio liste |
| Dropdown | ☐ Required, Label ["Question:"], Choice #1/#2, + Add answer | — | "-- choose --" select |
| Multiple choice list | ☐ Required, Label ["Question:"], Choice #1/#2, + Add answer | — | Checkbox liste |
| Group selection | ☑ Required (**zorunlu, disabled**), Question ["Choose a department:"], her Choice: "Department name" input + **Assign to group…** combobox (seçenek: **G General**) + ×, + Add answer | — | "Choose a department: *" + "-- choose --" |

### Edge-case / bulgular
- ✅ Add answer 12 kez tıklandı → Choice #14'e kadar çıktı, üst limit yok (buton disabled olmadı). ⚠️ Seçenek sayısı sınırsız.
- ⚠️ Yeni eleman eklenince (boş Question/department) **Save changes disabled oluyor ama hiçbir hata mesajı gösterilmiyor** — kullanıcı neyin eksik olduğunu göremiyor.
- ✅ Ana toggle kapatılınca builder gizleniyor, kaydetme çubuğu çıkıyor (anlık kayıt yok). ⚠️ Önizleme toggle kapalıyken de formu göstermeye devam ediyor.
- ✅ Cancel → form orijinal 3 elemana döndü; toggle durumları: Pre-chat ON, Name/Email Required OFF, after campaign ON.
- 🗑 eleman silme ve sürükle-bırak sıralama ⛔ test edilmedi (silme kuralı).

## Settings — Forms › Ask for email (/settings/ask-for-email)

### İçerik
- **Set up ask for email** — iki sekme (segmented): **When not responding** (varsayılan) / **When offline** (URL değişmiyor).
- **When not responding**: "Decide what happens when a customer sends a message but an agent assigned doesn't respond"
  - (●) **Don't send anything** (varsayılan) — bu durumda dakika alanı ve ↑/↓ (Increment/Decrement value) disabled.
  - ( ) **Send a message when an agent doesn't respond for [2] minutes** — seçilince açılan alanlar: **Message text** (zengin metin; odakta **B / I / 🔗** araç çubuğu) ["Sorry, but I won't be able to reply as soon as I thought. Please leave your email so I can get back to you later."], ☑ **Customer can leave email**, **Confirmation text** ["Thanks! You'll hear from us at:"]. Önizleme: mesaj + Email inputu + → butonu.
- **When offline**: "When all agents are offline and a customer sends a message, they'll be asked for an email. It happens right after their first message." — **Message text** ["We will reply as soon as possible. Get our response via email:"], **Confirmation text** ["You'll receive replies at your email:"]. Önizleme: üstte offline banner "We're away at the moment. Leave a message, and we'll reply by email." + email isteme balonu.

### Testler
| Test | Sonuç | Durum |
|---|---|---|
| Radio "Send a message…" | Ek alanlar açılıyor, kaydetme çubuğu çıkıyor | ✅ |
| Dakika "0" | Otomatik **1**'e yükseltildi (min 1) | ✅ |
| Dakika "9999abc" | Harfler atıldı, otomatik **60**'a düşürüldü (max 60), hata mesajı yok | ✅ ⚠️ |
| Cancel | Don't send anything / 2 dk geri geldi | ✅ |

## Settings — Forms › Post-chat form (/settings/post-chat-form)

### İçerik
- **Post-chat form** ana toggle (**AÇIK**) — "Post-chat forms allow you to get helpful feedback from customers at the end of a chat." **Learn more** ↗ https://www.livechat.com/help/chat-surveys/
- Varsayılan elemanlar:
  1. **Choice list** — ☑ Required — Label "Is this the first time you have chatted with us about this case?" — Choice #1 "Yes", Choice #2 "No" (+ Add answer, ×)
  2. **Choice list** — ☑ Required — Label "Was the case resolved during the chat?" — Yes / No
  3. **Chat rating** — ☑ Required — Rating label ["How would you rate this chat?"], Comment label ["Thank you for the rating! You can leave a comment in the box below:"] + not "Leaving a comment is always optional"
- **+ Add element** menüsü: Thank you message · Question · Message · Choice list · Dropdown · Multiple choice list · Chat rating (**disabled** — zaten var; tek örnek).
- Alt bilgi: "To see form answers, check out the **Chat forms report**. Chat ratings with comments are saved in the **Chat satisfaction report**." → `/reports/chat-forms`, `/reports/chat-ratings` (uygulama içi).
- Preview: offline banner ("We're away at the moment…"), iki soru (Yes/No radio), "How would you rate this chat?" 👍/👎, **Submit**.

### Eleman tipleri (yerel eklendi → Cancel ✅)
| Tip | Alanlar | Varsayılan |
|---|---|---|
| Thank you message | Message | "Thank you for the chat. Feel free to leave us any additional feedback." — formun sonuna ekleniyor; eklendikten sonra menüde **disabled** (tekil) |
| Question | ☐ Required, Question ["Question:" etiketli, boş] | — |
| Message | ☐ Required, Message ["Message:" etiketli, boş] | — |
| Choice list / Dropdown / Multiple choice list | Pre-chat ile aynı yapı | — |

- ✅ Cancel sonrası form orijinal 3 elemana döndü, tüm Required = true.
- ⚠️ Post-chat form trial hesapta varsayılan AÇIK geliyor (Pre-chat de AÇIK).

## Settings — Forms › Ticket form (/settings/ticket-form)

### İçerik
- Mavi bilgi kutusu (ⓘ): **"Ticket form is inactive and customers can start a chat, even if agents are away"** — "You can change this setting in the **Availability** section, so customers can leave a HelpDesk ticket that you can handle in your own time." (Availability → /settings/availability)
- Kart: "Resolve customer cases through HelpDesk tickets" — "Let your customers leave tickets when you're away so you'll have more time to think before solving cases." + **Enable HelpDesk boosters** (⛔ HelpDesk etkinleştirir, tetiklenmedi).
- Preview: ikon + "Ticket form is disabled"; "Test it out on the chat page".
- Not: Ticket form alanları (builder) bu hesapta Availability "Always" olduğu ve HelpDesk kapalı olduğu için **görülemiyor**.

## Settings — Engagement › Eye-catcher (/settings/eye-catcher)

### İçerik
- "Grab your website visitors' attention and encourage them to start a chat by showing an eye-catcher. Eye-catchers are only shown on desktop." **Learn more** ↗ https://www.livechat.com/help/more-chats-with-the-eye-catcher/
- **Show eye-catcher** toggle (KAPALI) — "Draw your visitors attention to a captivating visual to get more chats."
- Preview: **Reset position** butonu + boş kutu "Turn on eye-catchers to grab your visitor's attention." + widget balonu.
- Toggle açılınca (kaydetme çubuğu çıkıyor, anlık kayıt yok ✅): "Personalize your eye-catcher to increase chat engagement." + iki akordeon:
  - **Upload your image** — "+" yükleme kutusu, "Max. 1500x1000 px | png, jpg, gif" (⛔ upload yapılmadı).
  - **Browse eye-catcher gallery** — **119** hazır görsel (dosya adları h1–h6 Halloween, c1–c6, new001–new1xx; örn. "Need help? Chat with us!", "Let's talk! We are here / START CHAT", "Boo! We are here" yarasa). Varsayılan önizleme: "Need Help? Click here and start chatting with us!" (1 bildirim rozetli).

### Testler
| Test | Sonuç | Durum |
|---|---|---|
| Galeriden "Boo! We are here" seç | Kartta ✓ işareti, önizlemede büyük görsel | ✅ |
| Önizlemede eye-catcher'ı sürükle | Serbestçe taşınabiliyor (konum ayarlanabilir) | ✅ |
| Reset position | Varsayılan konuma döndürüyor | ✅ |
| Cancel (kaydetme çubuğu) | **Bu sayfada ek onay modali**: "You have unsaved changes — Your changes will be lost if you continue. Are you sure you want to discard them?" → **Cancel** / **Discard changes** | ✅ |
| Discard changes | Builder kapandı, önizleme "Turn on eye-catchers…"; başka sayfaya gidip dönünce toggle KAPALI (kalıcı değişiklik yok) | ✅ |

### Edge-case / bulgular
- ⚠️ **Discard sonrası toggle görsel olarak YEŞİL (açık) kaldı**, oysa altındaki checkbox `false` ve içerik/önizleme kapalı durumda → UI state tutarsızlığı (sayfa değişince düzeliyor).
- ⚠️ Cancel davranışı tutarsız: Eye-catcher'da Cancel onay modali açıyor, diğer sayfalarda Cancel anında geri alıyor.
- ⚠️ Galeride arama/kategori filtresi yok; 119 görsel uzun tek liste.

## Settings — Engagement › Chat buttons (/settings/chat-buttons)

### İçerik
- Sağ üst **Create chat button** (mavi) → `/settings/chat-buttons/new/image`.
- "Use chat buttons to draw extra attention to your LiveChat. Allow your customers to start a chat anywhere on your website." **Learn more** ↗ https://www.livechat.com/help/chat-button-guide/
- **Manage chat buttons** tablosu — sütunlar: Online state · Offline state · Type ↑ (sıralanabilir) · Actions. İlk satır "+ Create chat button".
- Mevcut 3 satır (varsayılan):
  | # | Online | Offline | Type | Actions |
  |---|---|---|---|---|
  | 1 (id 3b293cee52) | görsel (button_online003.png — "Start Chat Now") | görsel (button_offline003.png — "LEAVE MESSAGE") | Image | Install · ✎ · 🗑 |
  | 2 (id bd57461522) | "Live chat now" (link) | "Leave us a message" (link) | Text | Install · ✎ · 🗑 |
  | 3 | görsel (button_online007.png) | görsel (button_offline007.png) | Image | Install · ✎ · 🗑 |
- Install (kod modalı) ⛔ tıklanmadı · 🗑 Delete ⛔.

### Akış: Create Chat Button (/settings/chat-buttons/new/image | /new/text)
- Başlık "× Create Chat Button". **Select type**: segmented **Image button** / **Text button** (URL /new/image ↔ /new/text).
- Image button: "Button created from an image" — **Upload button images** "Accepted file types JPG, PNG, GIF. Max. size 500 x 400 px and 1 MB" — "Online state – button image when agents are online" [⬆ Upload image], "Offline state – button image when agents are offline" [⬆ Upload image] (⛔ upload yok).
- Text button: "Button as simple text link." — **Enter button text**: Online (placeholder "Example: Chat now"), Offline (placeholder "Example: Leave a message").
- Alt çubuk: **Cancel** / **Create button** (iki alan dolana kadar disabled; dolunca etkin — ⛔ tıklanmadı).
- ✅ Uzun metin + `<b>Chat</b> çş 😀` → karakter sınırı yok, hata yok.
- ✅ Doluyken × → **"You have unsaved changes"** modalı (Stay here / Discard changes) → Discard → listeye dönüldü, yeni buton oluşmadı.

### Akış: Edit Chat Button (/settings/chat-buttons/<id>)
- Text: "Edit Chat Button" — Online ["Live chat now"], Offline ["Leave us a message"]. ✅ Online boş → kırmızı "This field can't be empty", **Save button** disabled. ✅ Cancel → değerler geri geldi (sayfada kalıyor).
- Image: görseller önizlemeli ("Start Chat Now" yeşil / "LEAVE MESSAGE") + her birinde **⬆ Replace** (⛔).

### Edge-case / bulgular
- ⚠️ **Listede görsel butonlar yüklenmiyor** (img naturalWidth 0, boş satır görünüyor) ama Edit sayfasında aynı görseller düzgün görünüyor → liste görsel URL'si kırık.
- ⚠️ Actions sütunundaki ✎ / 🗑 ikon butonlarının aria-label/title'ı yok (erişilebilirlik).
- ⚠️ Create akışında metin alanlarına uzunluk sınırı yok.

## Settings — Engagement › Quality showcase (/settings/quality-badge)

### İçerik
- **Publish Quality page** toggle (**AÇIK**) — "Share the link to your quality page showing your chat satisfaction and responsiveness." **Learn more** ↗ https://www.livechat.com/help/quality-badge-adding-badge-site/
  - Salt okunur link `https://lc.chat/qa/19985624` + **Copy**; sağda örnek quality page görseli (tıklanabilir ↗ lc.chat/qa/19985624): "Excellent service — 67% of customers are happy…", 67% / 1748 / 20s metrikleri (örnek/demo veri).
- Kartlar (cursor:pointer, tıklanabilir — dış paylaşım penceresi açar, ↗ tıklanmadı): **Share on X (Twitter)** — "Share quality page in a tweet or comment." · **Share on Facebook** — "Share quality page in a post or comment."
- **Quality badge locked** 🔒 — "You need at least 10 rated chats and 70% satisfaction rate in the last month to unlock the badge." **Learn more** ↗ (aynı makale). Örnek rozet: "EXCELLENT SERVICE ★★★★☆ 4.0/5.0 - 10 ratings | Jun. 2017 | Verified by LiveChat".

| Öğe | Durum |
|---|---|
| Publish Quality page toggle | ⛔ değiştirilmedi (bu sayfada kaydetme çubuğu yok → anlık kaydediyor olabilir) |
| Copy | (Chat page'deki ile aynı bileşen) |

### Edge-case / bulgular
- ⚠️ Chat page'deki "Share on X/Facebook" kartları tıklanamazken burada aynı tasarımdaki kartlar tıklanabilir (cursor:pointer) → tutarsızlık.
- ⚠️ Örnek rozette "Jun. 2017" tarihi — eski/statik görsel.
- ⚠️ Panel ikonunun tooltip'i "Hide sidebar" + kısayol **[** — hover bittikten sonra da ekranda takılı kalabiliyor.
- Kilitli rozet için ilerleme göstergesi (kaç rated chat / % memnuniyet) yok.

## Settings — Tags (/settings/tags)

### İçerik
- "Tags help you categorize and organize your chats. Use them to filter results in Archives, as well as narrow down data in Reports." **Learn more** ↗ https://www.livechat.com/help/tagging-chats-and-tickets/
- **Manage tags**: input (placeholder "Tag") + **Create tag** (submit). Sağda ⓘ **Remind agents to tag** toggle (KAPALI) — tooltip: "Agents will get a reminder to tag a finished chat" (⛔ değiştirilmedi; anlık kaydedebilir).
- Tablo: Tag · Author · Date ↑ (sıralanabilir; tıklayınca ↓, tümü aynı tarihli olduğundan sıra değişmedi) · Reports linki · "…" menü.
- Satırlar (5 varsayılan tag, Author "LiveChat" logolu, Date "14 October 2026"):
  1. positive feedback  2. sales  3. spam  4. support  5. complaint
- Her satırda **Reports** → `/reports/tags-usage?tag[]=<tag>` (uygulama içi).
- **"…" kebab menü** (her satırda aynı): **Archives** (→ Archives, tag filtreli) · **Delete** (kırmızı, ⛔ tıklanmadı).

### Testler
| Test | Sonuç | Durum |
|---|---|---|
| Boş isimle Create tag | Hiçbir şey olmadı, hata mesajı da yok (sessiz) | ✅ ⚠️ |
| 221 karakter isim (yazarken) | Canlı hata: "Tag name is too long. It should be equal or less than 180 characters." (input maxLength yok) | ✅ |
| "Sales" (var olan "sales" ile büyük/küçük harf farkı) | Yazarken uyarı yok (submit edilmedi — duplicate kontrolü yalnız sunucu tarafında olabilir) | ✅ ⛔ submit yok |
| Esc | "…" menüsünü kapatıyor | ✅ |

- ⚠️ Tag satırında inline düzenleme (rename) yok; yalnız Archives/Delete.
- ⚠️ Boş submit için kullanıcı geri bildirimi yok.

## Settings — Sales tracker (/settings/sales-tracker)

### İçerik
- Sağ üst **New sales tracker** → `/settings/sales-tracker/add`. "Track which chats end with sales and measure how much revenue you get from chats." **Learn more** ↗ https://www.livechat.com/help/sales-tracker/
- **Manage sales trackers** tablosu: Tracker name ↑ · Status · Actions — **boş** (yalnız "+ Add new sales tracker" satırı; aynı /add sayfası).

### Akış: Set up your sales tracker (/settings/sales-tracker/add)
- "× Set up your sales tracker"
- **Name your sales tracker** (placeholder "Pick a name")
- **Assign value to purchases** (radio, başlangıçta hiçbiri seçili değil):
  - **Fixed – each sale has the same value** ⓘ "Set one value for all purchases. Useful for tracking leads or if you're selling a single product." → "Each purchase is worth [Enter value] [Currency ▾]"
  - **Dynamic – sales may have different values** ⓘ "Capture the value of each sale from your website code. You need to specify which global variable in your website code contains the order value information" → "Value variable [Example cart.total_price] [USD ▾]"
  - **Non-monetary – don't assign monetary value**
  - Para birimi listesi (26): AED, AUD, BRL, CAD, CHF, CNY, DKK, EUR, GBP, HKD, INR, ISK, JPY, KRW, MXN, NOK, NZD, PLN, RUB, SAR, SEK, SGD, THB, TRY, **USD** (varsayılan ✓), ZAR. Kapalıyken placeholder "Select" (ilk açılışta), sonra USD.
- **Assign order number**: ☐ "Assign order number to each chat that led to a sale" → işaretlenince **Order ID parameter** [Example order.order_number].
- **How long would you like to track conversions? [30] days after the chat.**
- Alt: **Cancel** / **Continue** (isim+değer tipi seçilene kadar disabled; ⛔ Continue tıklanmadı — tracker oluşturabilir).

### Testler
| Test | Sonuç | Durum |
|---|---|---|
| Fixed değer "-12abc,5" | Harfler atıldı, **"-12,5" (negatif) kabul edildi**, Continue etkin | ✅ ⚠️ |
| Uzun isim + `<x> çş` | Sınır/hata yok, Continue etkin | ✅ ⚠️ |
| Dynamic seçili, Value variable boş | Continue **etkin** (zorunlu alan kontrolü yok) | ✅ ⚠️ |
| Order number işaretli, Order ID boş | Continue etkin | ✅ ⚠️ |
| Gün "999" | Kabul edildi; "0" → otomatik 1 | ✅ |
| Cancel (doluyken) | **Onay sormadan** listeye döndü, tracker oluşmadı | ✅ ⚠️ |

### Edge-case / bulgular
- ⚠️ **Layout hatası:** "How long would you like to track conversions? [30] days" alanı sticky alt çubuğun (Cancel/Continue) **altında kalıyor, kaydırarak görünür hale getirilemiyor** (yalnız klavye/JS ile odaklanılabildi).
- ⚠️ Seçili para birimi dar kutuda "U…" olarak kesiliyor (USD).
- ⚠️ Negatif satış değeri kabul ediliyor.
- ⚠️ Cancel davranışı Chat buttons'taki × (onay modali) ile tutarsız.

## Settings — Chat settings › Chat assignment (/settings/chats-assignment)

### İçerik
- **Choose how chats are distributed** (iki kart-radio):
  - (●) **Auto assignment** (varsayılan) — "Chats are evenly distributed among agents with accepting chats status. When all agents hit their limit, new visitors are queued." + ⓘ "Set each agent's chat limit in their **profile details**" (→ `/team`).
  - ( ) **Manual selection** — "All agents get notified about a customer waiting in the queue. Chat will be assigned to the first agent who picks it up."
- **Shortcuts to helpful stuff** (3 tıklanabilir kart, `<a>` değil):
  - "Read our chat assignment guide to learn more" → ↗ yardım makalesi (tıklanmadı)
  - "Route chats to groups with Routing rules" → ✅ `/automate/groups-routing`
  - "Learn how ChatBot can boost team productivity" → ✅ ↗ **yeni sekmede** `https://www.chatbot.com/benefits/` (sekme hemen kapatıldı)

| Öğe | Durum |
|---|---|
| Manual selection radio | ⛔ değiştirilmedi — sayfada kaydetme çubuğu/Save butonu görünmüyor, seçim anında kaydediliyor olabilir |

### Edge-case / bulgular
- ⚠️ Kısayol kartları ve "profile details" anchor değil (div onClick) → sağ tık/yeni sekmede açma yok, erişilebilirlik zayıf.
- ⚠️ ChatBot kartı dış siteye `landing_page=…/settings/language` parametresiyle gidiyor (bulunulan sayfa chats-assignment olduğu halde eski bir sayfa adı) → izleme parametresi bayat.
- Not: "Chat limits" bu sayfada değil, Team › ajan profilinde ayarlanıyor.

## Settings — Chat settings › Transcript forwarding (/settings/archives-forwarding)

Tarayıcı başlığı "Transcripts forwarding" (menüde "Transcript forwarding" — tekil/çoğul tutarsız ⚠️).

### İçerik
- "Automatically forward your chat transcripts to a list of email addresses. Chats archived before setting up transcript forwarding will not be sent." **Learn more** ↗ https://www.livechat.com/help/how-to-get-chat-transcripts/
- **Forward all chat transcript to email** — chip input (placeholder "name@company.com"); yardım: "Hit enter or space to add a new one. You can add up to 1 email addresses." (⚠️ "1 email addresses" dilbilgisi hatası)

### Testler
| Test | Sonuç | Durum |
|---|---|---|
| "not-an-email" + Enter | Kırmızı chip eklendi + "Invalid email"; kaydetme çubuğu çıktı, Save changes disabled | ✅ |
| "test@example.com" + Space, "second@example.com" + Enter | Chip'ler eklenebiliyor (limit aşılabiliyor) ama hata: **"You have reached the trial limit of 1 email address."** 🔒; Save disabled | ✅ |
| Cancel | Tüm chip'ler temizlendi | ✅ |

- ⚠️ Limit aşımı engellenmiyor, yalnız hata gösteriliyor; "trial limit" ifadesi plan kısıtı olduğunu belirtiyor.

## Settings — Chat settings › File sharing (/settings/file-sharing)

### İçerik
- "Share and receive files during chats. Files that can be a potential threat will be automatically filtered out. You can then decide if you want to access them or not." **Learn more** (aria-label "An article about sharing files on chat") ↗ https://www.livechat.com/help/sharing-files-over-livechat/
- **Enable file sharing for:** ☑ **Agents** · ☑ **Visitors** (ikisi de varsayılan işaretli).
- ✅ Visitors işareti kaldırılınca kaydetme çubuğu (Cancel / Save changes) çıktı; Cancel → ikisi de tekrar true.
- Not: Dosya boyutu/tür kısıtı ayarı yok.

## Settings — Chat settings › Inactivity timeouts (/settings/inactivity-timeouts)

### İçerik (her satır: checkbox + sayı alanı ↑/↓ "Increment value"/"Decrement value")
1. ☑ "When the agent is not responding for [3] minutes, **transfer the visitor to another agent.**" — "Applies only if the chat has just started. All following responses can be longer and won't result in a transfer."
2. ☑ "When there are no new messages in the chat for [10] minutes, **make the chat inactive.**" — "Inactive chats are not included in agents' concurrent chats limit."
3. ☑ "When there are no new messages in the chat for [15] minutes, **close the chat.**"
- **Satır içi** butonlar: **Save changes** (değişiklik yokken disabled) · **Discard changes** — diğer sayfalardaki sticky alt çubuktan farklı eski tasarım ⚠️.

### Testler
| Test | Sonuç | Durum |
|---|---|---|
| Transfer "0" | Otomatik 1'e yükseldi (min 1) | ✅ |
| Inactive "99999" | 60'a kırpıldı (max 60), hata mesajı yok | ✅ ⚠️ |
| Inactive 60 > Close 15 | **Mantıksal tutarsızlık kabul edildi** (chat inaktif olmadan kapanacak), uyarı yok, Save etkin | ✅ ⚠️ |
| Checkbox kaldır | İlgili sayı alanı griye dönüp disabled oluyor | ✅ |
| Kaydedilmemişken sidebar'dan başka sayfaya geçiş | **Uyarı YOK**, değişiklikler sessizce atıldı | ✅ ⚠️ |
| Geri dönünce | 3 / 10 / 15, tümü işaretli — kalıcı değişiklik yok | ✅ |

## Settings — Security › Trusted domains (/settings/trusted-domains)

### İçerik
- "Protect your LiveChat widget from being added to unauthorized sites by creating a list of trusted domains. Trusting a domain automatically trusts all its subdomains. Trusting a subdomain doesn't trust its core domain." **Learn more** ↗ https://www.livechat.com/help/trusted-domains
- **Manage domains** — sekmeler: **Trusted (0)** / **Detected (0)** (URL değişmiyor).
  - Trusted: "You don't have any trusted domains added yet. Add trusted domain manually or check **Detected domains**" (link → Detected sekmesi) + input (placeholder "yourdomain.com") + **Add to trusted**.
  - Detected: "We didn't detect any websites with LiveChat code installed. **Install LiveChat code** on your website." (→ /settings/code)

### Testler
| Test | Sonuç | Durum |
|---|---|---|
| Boş input + Add to trusted | Hiçbir şey olmadı, hata mesajı yok | ✅ ⚠️ |
| "http://not a domain!!/path" yazıp blur | Canlı doğrulama yok, buton etkin (submit ⛔ yapılmadı — kalıcı ekleme riski) | ✅ ⛔ |

- ⚠️ Bu sayfadayken sidebar'da aktif vurgu hâlâ **"Customization"** üzerinde kalıyordu (aktif menü durumu bayat).

## Settings — Security › Banned customers (/settings/banned-customers)

### İçerik
- Sağ üst **Ban customer** (mavi). Boş durum: kişi ikonu + "You haven't banned any customers yet" — "When you ban a customer, they will not see your chat widget, appear on your traffic list, receive campaigns." + **Ban customer**.

### Modal: Ban customer
- **Customer IP** (text) · **Duration** dropdown: 1 day · 3 days · **7 days** (varsayılan ✓) · 30 days · 6 months · 1 year · 3 years.
- "**Note:** Banned customers will not see your chat widget, appear on your traffic list, receive campaigns."
- **Cancel** / **Ban customer** (kırmızı, ⛔ dolu IP ile tıklanmadı).

| Test | Sonuç | Durum |
|---|---|---|
| Boş IP + Ban customer | "Customer IP is required" (kırmızı); ban yapılmadı | ✅ |
| "999.300.1.abc" + blur | **Canlı IP doğrulaması yok**, hata çıkmadı, buton etkin (submit edilmedi) | ✅ ⚠️ |
| Duration dropdown açıkken **Esc** | Dropdown yerine **tüm modal kapandı** | ✅ ⚠️ |
| Cancel | Modal kapandı; liste hâlâ boş | ✅ |

- ⚠️ IPv6/CIDR desteği belirtilmemiş; IP format doğrulaması yalnız submit'te (veya hiç) yapılıyor olabilir.

## Settings — Security › Credit card masking (/settings/credit-cards-masking)

### İçerik
- "Masking protects customer credit card numbers in Chats and Archives. It replaces all but the last 4 digits with X characters. Example: 370000000000002 will be shown as XXX-XXXX-XXXX-0002."
- **Credit card policy** (radio): ( ) **Show customers credit card numbers** · (●) **Mask customers credit card numbers** (varsayılan).
- ✅ "Show…" seçilince kaydetme çubuğu (Cancel / Save changes) çıktı — anlık kayıt yok; Cancel → Mask tekrar seçili.
- ⚠️ Örnekteki gruplama "XXX-XXXX-XXXX-0002" 15 haneli Amex numarası için 3-4-4-4 = 15 karakter ✓, ancak gerçek Amex formatı 4-6-5'tir — örnek gruplama gerçek kart formatıyla uyuşmuyor (kozmetik).

## Settings — Security › Login settings (/settings/login-settings)

### İçerik
- Kart: **"Choose authentication method for your team"** — "Decide how your team should log in to Text products to make the login process easy and secure. Choose between email and password, Google login, Custom SSO, and more."
- **Go to login settings ↗** (target=_blank) → `https://accounts.livechat.com/panel/settings/security` (dış hesap paneli; ⛔/↗ tıklanmadı — 2FA/SSO ayarları orada).
- Sağda dekoratif seçenek kartları (tıklanamaz): 🔒 **Any method** · **G Google** · ⚙ **Custom SSO**.
- Not: 2FA, SSO, oturum ayarları LiveChat uygulaması içinde değil, accounts.livechat.com'da → bu bölümün kapsamı dışında kaldı.

- ⚠️ "Any method / Google / Custom SSO" kartları seçilebilir seçenek gibi görünüyor ama etkileşimsiz (cursor yok).

## Ek derinlik — Install LiveChat › OTHER WAYS TO INSTALL (tüm akordeon içerikleri)

| Yöntem | Açıklama (akordeon açılınca) | Buton | Durum |
|---|---|---|---|
| Connect with Google Tag Manager | "Connect your GTM account to quickly set up chat widget on your website." | Install | ⛔ |
| Connect with WordPress | "Add chat widget to your WordPress site." | Connect | ⛔ |
| Connect with Shopify | "Add chat widget to your Shopify store." | Connect | ⛔ |
| Install WooCommerce plugin | "Add chat widget to your WooCommerce store." | Connect | ⛔ |
| Connect to BigCommerce | "Add chat widget to your BigCommerce store." | Connect | ⛔ |
| Connect with Ecwid | "Add chat widget to your Ecwid store." | Connect | ⛔ |
| Connect with Adobe Commerce (Magento) | "Add chat widget to your Adobe Commerce (Magento) store." | Connect | ⛔ |
| Connect with SquareOnline | "Add chat widget to your SquareOnline store." | Connect | ⛔ |
| Connect with Squarespace | "Add chat widget to your Squarespace site." | Connect | ⛔ |
| Connect with Wix | "Add chat widget to your Wix site." | Connect | ⛔ |
| Connect with Webflow | "Add chat widget to your Webflow site." | Connect | ⛔ |
| Connect to Weebly | "Add chat widget to your Weebly site." | Connect | ⛔ |
| Connect to Joomla! | "Download the LiveChat plugin and upload it to your Joomla! site." | Connect | ⛔ |
| Connect with Drupal | "Download the LiveChat plugin and upload it to your Drupal site." | Connect | ⛔ |
| Connect to Segment | "Add chat widget to your Segment site." | Connect | ⛔ |

- Her akordeonda ayrıca "Need help?" → Invite your developer (aynı davet modalı) + Check install guide (↗ yardım).
- ✅ "3rd party integrations" → uygulama içi `/apps/marketplace/apps/cms` (Marketplace CMS kategorisi); geri tuşu /settings/code'a döndürüyor.
- ⚠️ Joomla!/Drupal "Download…upload" açıklamasına rağmen buton etiketi "Connect" (beklenen: "Download").
- ⚠️ Adlandırma tutarsız: "Connect with …" / "Connect to …" / "Install … plugin" karışık.

## Ek — Chat page › Customization toggle davranışı

- ⚠️ **"Quality of customer support" toggle kaydetme çubuğu tetiklemiyor** (metin alanları tetikliyor). Toggle'ı KAPALI yapınca Save/Cancel çıkmadı → **anlık kaydetmiş olabilir**. Hemen tekrar AÇIK'a alındı (~1 sn içinde); sayfadan çıkıp dönünce durum **Show logo: AÇIK, Quality: AÇIK** (orijinal). Net değişiklik yok, ancak arka planda iki kayıt isteği (OFF→ON) gitmiş olabilir. ⚠️ Aynı sayfada metin alanları kaydetme çubuğu kullanırken toggle'ların anlık kaydetmesi tutarsız ve riskli UX.
- Show logo toggle'ı bu nedenle değiştirilmedi.

## Genel bulgular özeti (çapraz)

1. ⚠️ **Language combobox'ta Enter → native GET form submit**: sayfa yenileniyor, form değerleri URL query'sine yazılıyor (`?Welcome_to_chat=…&Client=…&Embedded_textarea_placeholder=…&selectedLanguageId=en`), kaydedilmemiş değişiklikler uyarısız kayboluyor.
2. ⚠️ **Stale header**: Settings sayfa başlığı route değişince güncellenmiyor ("Customization" yerine "Chat page"; Language'da "Availability"; unsaved-modal'da "Stay here" sonrası "Language").
3. ⚠️ **Stale sidebar active state**: Trusted domains'teyken "Customization" vurgulu kaldı.
4. ⚠️ **Kaydedilmemiş değişiklik koruması tutarsız**: Website widget/Eye-catcher/Chat buttons'ta modal var; Chat page › Customization "←", Inactivity timeouts (sidebar geçişi) ve Sales tracker Cancel'da yok.
5. ⚠️ **Kaydetme kalıpları tutarsız**: çoğu sayfada sticky alt çubuk (Cancel/Save changes); Inactivity timeouts'ta satır içi Save/Discard; Quality showcase / Chat assignment / Tags "Remind" / Chat page toggle'ları'nda kaydetme çubuğu yok (anlık kayıt olası).
6. ⚠️ **Sessiz değer düzeltme**: opacity 250→2%, dakika 0→1 / 9999→60, side spacing -50→050, geçersiz hex reddi — kullanıcıya mesaj yok.
7. ⚠️ **Validasyon boşlukları**: negatif satış değeri, boş Dynamic variable ile Continue, geçersiz IP/domain için canlı doğrulama yok, boş Welcome message/Page title kabul, Inactive>Close tutarsızlığı kabul.
8. ⚠️ **Install sayfasındaki kod görseli farklı lisans (100170061)** gösteriyor.
9. ⚠️ Chat buttons listesindeki görseller yüklenmiyor; ikon butonlarda aria-label yok.
10. ⚠️ Welcome text tam 50 karakterde "cannot be longer than 50" hatası + Save etkin.
11. ⚠️ Eye-catcher Discard sonrası toggle görsel olarak açık kalıyor.
12. ⚠️ Sales tracker'da "track conversions [days]" alanı sticky footer altında, ulaşılamıyor.
13. ⚠️ Metin hataları: "You can add up to 1 email addresses", "Transcripts forwarding" vs "Transcript forwarding", "pre-chat form after campaign is send".

## Ulaşılamayan / test edilmeyen öğeler ve nedenleri

| Öğe | Neden |
|---|---|
| Tüm Save changes / Create / Continue / Done / Add to trusted (dolu) / Ban customer (dolu) / Create tag (dolu) | ⛔ Güvenlik kuralı — kalıcı değişiklik |
| Connect/Install (GTM, WordPress…Segment, Facebook, KnowledgeBase, HelpDesk, HelpDesk boosters, HelpDesk trial) | ⛔ OAuth/entegrasyon |
| Upgrade now / Upgrade for $39/month / View pricing plans / Change plan | ⛔ Satın alma |
| Logo / eye-catcher / chat button görsel yüklemeleri | ⛔ Dosya yükleme |
| 🗑 Delete (tag, chat button, form elemanı), Tag "…" › Delete | ⛔ Silme |
| Install (chat button kod modalı), Copy invite link, Send invites | ⛔ Kural listesindeki "Install"/davet |
| Publish Quality page, Remind agents to tag, Chat assignment Manual, Show logo (chat page), Show welcome screen, widget toggle'ları (sound, rating, transcripts) | Kaydetme çubuğu olmayan/anlık kayıt şüphesi olan kontroller değiştirilmedi |
| Ticket form builder | Availability "Always" + HelpDesk kapalı olduğu için form görünmüyor |
| 2FA, SSO, login yöntemleri | Uygulama dışı (accounts.livechat.com/panel/settings/security) ↗ |
| Canned responses, Integrations, Sounds/notifications, WhatsApp, Groups, License/account bilgisi | Settings menüsünde **yok**; uygulamanın Automate / Apps / Team / Billing / profil bölümlerinde (diğer ajanların kapsamı) |
| Facebook Messenger iframe içi alt akışlar | Yalnız "Connect to Facebook" (OAuth ⛔) ve upgrade var |
| "Check install guide", "Test it out", "Preview live", Share on X/Facebook, Learn more linkleri | ↗ Dış site — hedef URL kaydedildi, gidilmedi |
| Kesin "tam sayfa reload ile doğrulama" | Her tam yüklemede /install-code kapısı çıkıyor; doğrulamalar SPA içi sayfa değiştirip geri dönerek ve iki kez yeni sekmede taze yükleme sonrası (Language=English, Banned list boş, File sharing/CC masking/Inactivity orijinal) yapıldı |

### Oturum notları
- Çalışma sırasında Chrome sekme grubum iki kez dışarıdan sıfırlandı (başka ajanlar); her seferinde yeni sekme açılıp devam edildi. Açık kalan dialog/taslaklarda hiçbir şey submit edilmedi.
- "I don't want to chat yet" butonu onboarding kapısını geçmek için kullanıldı (kalıcı değil; her tam yüklemede kapı geri geliyor).
- ChatBot kısayol kartı istemeden yeni sekmede chatbot.com açtı → sekme hemen kapatıldı.
