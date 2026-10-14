# ChatBot.com — Uygulama keşfi (builder hariç)

> Keşif tarihi: 2026-10-14 · Hesap: 7 günlük deneme (trial) · Kaynak: https://app.chatbot.com (kullanıcının gerçek Chrome'u, oturum açık)
> Kapsam dışı: `/stories/create` ve builder canvas (diğer ajan).
> ⛔ = kaydeden/yayınlayan/ödeyen son buton tıklanmadı ("onay bekliyor").

## 0. Genel kabuk (shell)

**Sol dikey ikon menü (tooltip'ler hover ile):**

| Sıra | İkon tooltip | URL |
|---|---|---|
| 1 | (logo) | — |
| 2 | Chatbots (şimşek ikonu) | `/stories` (kök `/` buraya yönlenir) |
| 3 | Visitors | `/visitors` |
| 4 | Training | `/training` |
| 5 | Archives | `/v2/archives` |
| 6 | Reports | `/reports` |
| 7 | Integrations | `/integrations` |
| alt | "7 days" mavi rozet (kalan deneme günü) | `/settings/subscription` |
| alt | Academy (kep ikonu) | `/academy` |
| alt | Yardım (?) | menü (aşağıda) |
| alt | Bildirimler (zil) | panel (aşağıda) |
| alt | Avatar "A" | hesap menüsü (aşağıda) |

**Üst banner (deneme):** "Subscribe in 3 days to get your first month for $1" + `Subscribe now` butonu ⛔ + kapatma (×). (Not: rozet "7 days" derken banner "3 days" diyor — teklif süresi ile deneme süresi ayrı sayaçlar.)

Sağ altta `Open chat` / `Dismiss` butonları: ChatBot/LiveChat'in kendi destek widget'ı.

**Yardım (?) çekmecesi — "Product Help":**

| Öğe | Alt metin | Davranış |
|---|---|---|
| First steps | Get started with ChatBot | onboarding rehberi |
| Help Center | Follow step-by-step tutorials | dış yardım merkezi |
| Academy | Level up your skill set | `/academy` |
| Contact us | Connect with our Product Experts | destek sohbeti (widget) |

**Bildirimler (zil) çekmecesi:** başlık "Notifications" + kapat (×). Boş durum: **"You don’t have any notifications."** Filtre/ayar yok.

**Avatar menüsü (A):**

| Öğe | Hedef |
|---|---|
| Profil başlığı (avatar, kullanıcı adı, e-posta) | `/settings/account` |
| Partnership › Partner Program — "Perfect for solution providers" | `partners.livechat.com/solution-program/` (yeni sekme) |
| Partnership › Developer Program — "Build and monetize apps" | `platform.text.com/developer-program` (yeni sekme) |
| 💳 Subscription (7 days left) | `/settings/subscription` |
| Settings | `/settings` |
| Company details | modal (aşağıda) |
| Log out | `/logout` |

**Company details modalı:**
- Açıklama: "Please fill out your company details to help us serve you better in the future. This data will also contribute to the benchmarking tool and Customer Service Reports." → Şirket verisi **benchmark** ve **Customer Service Reports** için kullanılıyor.

| Alan | Tip | Kural / seçenekler |
|---|---|---|
| Company name | text | zorunlu, max 256, boşken kırmızı çerçeve |
| Website address | text | zorunlu, max 2048; "notaurl" yazınca blur'da hata vermedi (URL doğrulaması en fazla submit'te) |
| City | text | zorunlu, max 256 |
| Country | arama destekli dropdown | varsayılan **Turkey** (IP'den tahmin) |
| Industry | arama destekli dropdown | varsayılan Automotive; ~115 seçenek (Accounting, Advertising, … **Casinos & Gaming**, … Wireless Telecommunication Services) |
| Company size | dropdown | 1-9 · 10-49 · 50-99 · 100-499 · 500-999 · 1000+ |
| Audience | checkbox (çoklu) | B2B · B2C · Internal use |
| Butonlar | | Cancel · **Save changes** ⛔ onay bekliyor |

**Edge-case:** Modal açılışta tüm boş zorunlu alanlar kırmızı (dokunmadan önce hata göstermesi = agresif validasyon). Escape modalı kapatmıyor, Cancel/× gerekli.

---

## 1. Chatbots (Stories listesi) — `/stories`

**İçerik:** Başlık "Chatbots", arama kutusu ("Search your chatbot", max 256), ilk kart **Add chatbot** (mavi, → `/stories/create`, kapsam dışı), ardından bot kartları; altta "Get started" bölümü.

- İlk yüklemede 7 adet iskelet (skeleton) kart görünür; bot yoksa yalnız "Add chatbot" kalır. (Keşif sırasında diğer ajanın oluşturduğu **"CLAUDE-TEST Customer Service Bot"** kartı vardı.)
- Kart: bot adı + son 7 günün mini alan grafiği (sparkline). Hover tooltip: **"This story has no metrics from last week"** (veri yoksa).
- Karta tıklama → `/dashboard/<storyId>/` (bot'un kendi paneli/builder — kapsam dışı; sekme başlığı "New dashboard").

**Öğeler & durumlar**

| Öğe | Tip | Davranış |
|---|---|---|
| Search your chatbot | input | anlık filtre; yazınca × (temizle) ikonu çıkar; eşleşme yoksa **"sonuç yok" mesajı YOK**, sadece kartlar kaybolur |
| Kart ⋯ menüsü | kebab | Rename · Duplicate · Copy story ID · Delete chatbot (kırmızı) |
| Rename | inline düzenleme | kart başlığı input'a dönüşür, metin seçili, max 128 karakter; Escape iptal |
| Duplicate | aksiyon | anında kopya oluşturur (tıklanmadı ⛔) |
| Copy story ID | panoya kopyalama | API/entegrasyon için story ID |
| Delete chatbot | onay modalı | Başlık "Delete chatbot"; metin: "Are you sure you want to delete this chatbot? You will lose the entire chatbot flow. This operation cannot be undone." Butonlar: Cancel · **Yes, delete it** ⛔ |
| Get started › "How to start building your chatbots" | Watch | YouTube/video modalı ("Build Your AI ChatBot in Under 3 Minutes"), × ile kapanır |
| Get started › "Learn the basics of ChatBot within minutes" | Start lesson | Academy dersi |
| Get started › Help Center — "Visit our Help Center to learn more about ChatBot setup." | Explore (dış link ikonu) | yardım merkezi yeni sekme |

**Edge-case:** Silme geri alınamaz, soft-delete/çöp kutusu yok. Liste sıralama/filtre/klasör/etiket yok; kart üzerinde durum (aktif/pasif) rozeti yok.

---

## 2. Visitors (Audience / kullanıcılar) — `/visitors`

**İçerik:** İki kolonlu düzen. Sol alt menü + sağda liste.
- Kök `/visitors` → `/visitors/all-visitors?q=<filtre-serileştirmesi>&sum=<hash>` (filtreler URL'de taşınır → paylaşılabilir/yer imi yapılabilir görünüm).
- İlk girişte sağ altta tanıtım kartı: "Let's check how to collect and manage your visitors in ChatBot." + video küçük resmi + ×.

**Sol menü**

| Öğe | URL | Sayaç | Boş durum metni |
|---|---|---|---|
| Learn (kitap ikonu) | dış yardım makalesi | — | — |
| All visitors | `/visitors/all-visitors` | 0 | "No visitors yet — Your chatbot is still waiting for its first visitor. Please verify that it is active and accessible." |
| All leads | `/visitors/all-leads` | 0 | "No leads yet — Your chatbot is still waiting for its first visitor. Please verify…" |
| Recent visitors | `/visitors/recent-visitors` | 0 | "No recent visitors — It seems that no visitors chatted with your chatbot in the last 24 hours." (tarih filtresi yok; sabit son 24 saat) |
| Segments › "Customer Service Bot — Newsletter" | `/visitors/segments/<id>` | 0 | "Your segment is empty. Start collecting visitors in the segment with your chatbot." (bu segment şablon bot ile **otomatik** oluşmuş) |
| Segments › + Add new | `?addNewSegment=true` modal | — | — |

Her boş durumda **Get started with Visitors** butonu → YouTube video modalı "Collect, Manage, and Analyze Your Visitors in ChatBot" (2:48).

**Üst araç çubuğu (liste görünümü)**

| Öğe | Seçenekler / davranış |
|---|---|
| Search by email or id | e-posta veya visitor ID ile arama |
| Match all filters ▾ | Match all (VE) ✓ · Match any (VEYA) |
| 📅 All Time | All Time · Today · Yesterday · Last 7 Days · Last 30 Days · This month · Last Month · Last 3 months · This Year · Last Year (özel aralık yok) |
| ⚡ Chatbot is All | popover: "Select value" dropdown (botlar) + Apply filter |
| + Add filter | Name · Email · First seen · Country · City · Region · Language · Referrer · IP · Timezone · Integration · Source · Segment · User ID |

**Filtre operatörleri (popover)**

| Filtre tipi | Operatörler | Değer |
|---|---|---|
| Metin (Name, Email, City, Region, Referrer, IP, Timezone, Source, User ID…) | is · is not · contains · starts with · ends with | serbest metin; boşken **Apply filter** pasif |
| First seen | (chip: "First seen exactly Today") | arama destekli liste: Today · Yesterday · Last 7 Days · Last 30 Days · Last Month · Last 3 months · Current month · Current year · Last year · **Custom period** |
| Integration | is · is not · contains · starts with · ends with | dropdown: Chat Widget · Chat Widget (legacy) · Messenger · LiveChat · Slack · Testing tool |
| Segment | is · is not | segment dropdown |

- Popover × ile kapatılırsa değer girilmemiş chip kaldırılır (yarım filtre kalmaz).

**Segment işlemleri**

| Öğe | Davranış |
|---|---|
| Add new modalı | Başlık "Add new segment"; "Create a new segment to group users and direct them to different chatbot flows or export contact information."; input "Type a segment name" (maxLength yok); Cancel · **Confirm** ⛔ (boş/yalnız boşluk → Confirm pasif) |
| Segment başlığı ⋯ | Rename · Delete (kırmızı) |
| Delete modalı | "Delete segment — Are you sure you want to delete **<ad>** segment? This operation cannot be undone." Cancel · **Delete** ⛔ |

**Edge-case:** Hiç ziyaretçi olmadığından ziyaretçi tablosunun kolonları, profil detay paneli, toplu seçim/CSV export gözlenemedi (veri gerektiriyor). Segmentler bot akışında ("add to segment" aksiyonu) dolduruluyor; segment kuralı (dinamik koşul) tanımlama yok — segment = statik etiket listesi.

---

## 3. Training (klasik eğitim / bilinmeyen ifadeler) — `/training`

**İçerik:** Bilgi bandı: "You're in the classic Training section. We're continuously working to move the features to the new Training, which is located directly in the chatbot workflow, but you can still use the classic one to train your chatbot." → Ürün, eğitimi builder içine taşıyor; bu ekran "eşleşmeyen kullanıcı ifadelerini" gözden geçirme kuyruğu.

**Öğeler & durumlar**

| Öğe | Tip | Seçenekler / davranış |
|---|---|---|
| Search user query | arama | kullanıcı ifadeleri içinde arama |
| Unmatched phrases (sayaç rozeti: 0) | sekme | botun anlamadığı kullanıcı mesajları kuyruğu. Boş: "Nothing found. Please consider changing your search query." |
| Ignored | sekme (`?q=filters[ignored]=true`) | yok sayılan ifadeler. Boş: "There are no phrases to train." |
| Chatbot | arama destekli dropdown | All stories · (her bot, ör. CLAUDE-TEST Customer Service…) |
| Time period | dropdown | Whole time span (vars.) · Today · Yesterday · Last 7 Days · Last 30 Days · This month · Last Month · Last 3 months · This Year · Last Year |

**Edge-case / çıkarım:** Veri yokken ifade satırı aksiyonları (bir interaksiyona ekle / ignore) gözlenemedi; yardım dokümanına göre her ifade mevcut bir bot yanıtına "train" edilir veya "ignore" edilir. Ayrı bir "Knowledge base / AI kaynakları" menüsü sol navigasyonda **yok** (AI bilgi kaynakları builder içinde).

---

## 4. Archives (Sohbet geçmişi) — `/v2/archives` (eski `/archives` de aynı ekranı açıyor)

**İçerik:** 3 panelli düzen: sol sohbet listesi (iskelet), orta transkript, sağ **"Chat details"** paneli (iskelet: avatar + 4 alan + ikinci blok 4 alan).
- Boş durum: **"Nothing in your Archives yet — Archives organize and hold all your finished chats. To start receiving chats, first connect your chatbot to one of our integrations."**
- Buton **Connect your chatbot** → `/integrations`.

**Öğeler & durumlar**

| Öğe | Durum |
|---|---|
| Sohbet listesi | iskelet (veri yok) |
| Transkript | boş durum illüstrasyonu (kaktüs/çöl) |
| Chat details | iskelet |

**Edge-case:** Liste filtreleri/arama yalnız veri olunca beliriyor (gözlenemedi). **Canlı Inbox / takeover ekranı yok**: ChatBot.com'da ajan devri (human handoff) LiveChat/Messenger vb. entegrasyon üzerinden yapılıyor; ChatBot'un kendi uygulamasında canlı sohbet devralma arayüzü bulunmuyor. Archives yalnız **bitmiş** sohbetler.

---

## 5. Reports (Analitik) — `/reports`

**İçerik:** Kök `/reports` → `/reports/chats/all-chats`. Sol alt menü 4 grup / 8 rapor. Her raporda: tarih chip'i, (bazılarında) **+ Add filter**, başlık + (?) tanım tooltip'i, sağ üstte **Export to CSV** (⛔ indirme — tıklanmadı), KPI kutuları ve grafik. Boş durum: "No data yet — **Connect your chatbot** to one of the integrations and start collecting data now." (link → `/integrations`), arka planda dalgalı örnek grafik + "10% → 20%" illüstrasyonu.

**Rapor kataloğu ve metrik tanımları (tooltip'ler birebir)**

| Grup | Rapor | URL | KPI'lar | (?) tanım |
|---|---|---|---|---|
| Chats | All chats | `/reports/chats/all-chats` | Total chats · Avg chats | "The total number of chats in a given period. That includes the monthly package, paid and invalid chats." |
| Chats | Paid chats | `/reports/chats/paid-chats` | Total paid chats · Avg paid chats | "Chats that exceed the number of chats included in your pricing plan in a given period." |
| Chats | Busiest period | `/reports/chats/busiest-period` | ısı haritası (Mon–Sun × 12am…9pm, 3 saatlik etiketler), lejant Quietest → Busiest (5 ton) | "A heat map that presents your chatbot's activity at a given time of day." |
| Messages | All messages | `/reports/messages/all-messages` | Total messages · Avg messages | "The number of all messages your chatbot received in a given period." |
| Messages | Average messages | `/reports/messages/average-messages` | Avg messages | "The average number of messages per conversation users send to your chatbot in a given period." |
| Interactions | Popularity | `/reports/interactions/popular-interactions` | Tablo: Interaction name · Number of messages · % of all user messages | "This report shows the popularity of all interactions in a given chatbot Story." |
| Users | All users | `/reports/users/all-users` | Total users · Avg users | "The total number of users who chatted with your chatbot in a given period." |

**Filtreler**

| Öğe | Seçenekler |
|---|---|
| Tarih chip'i (vars. **Last 30 Days**) | arama destekli liste: Today · Yesterday · Last 7 Days · Last 30 Days · Last Month · Last 3 months · Current month · Current year · Last year · **Custom period** |
| Custom period | çift aylık takvim (ör. Eylül/Ekim 2026), Pazartesi başlangıçlı, bugün işaretli, **gelecek tarihler pasif**, «« önceki ay; **Apply filter** (aralık seçilmeden pasif) |
| + Add filter (Chats, Messages) | **Story** · **Integration** |
| Popularity | **Story is <bot>** chip'i zorunlu (tek seçim dropdown, Add filter yok) |
| All users | yalnız tarih (Add filter yok) |

**Popularity tablosu:** Seçili bot'un **tüm interaksiyonları** (bloklar) 0 değerle bile listelenir (ör. Start point, Welcome message, AI assist, Default fallback, Bot doesn't understand 1x / 2x or more, Please rephrase, 👋 Small talk, Survey start, 👍 Correct / 👎 Incorrect, Fallback, Newsletter…). İsimler altı çizili link → builder'da ilgili bloğa gider. Bu, "fallback'e düşme oranı"nı ölçmenin tek doğrudan yolu.

**Edge-case:**
- Ajan/operatör bazlı rapor, çözüm oranı, CSAT, devir (handoff) sayısı, yanıt süresi **yok** — raporlar tamamen bot hacmi odaklı.
- "Paid chats" = paket limitini aşan ücretli sohbetler → kullanım-bazlı faturalandırmanın görünür olduğu yer.
- Grafik granülerliği (gün/hafta) seçimi veri olmadan görünmüyor.

---

## 6. Integrations — `/integrations`

**İçerik:** Sol menü (her entegrasyon + bağlı sayısı rozeti, hepsi 0), sağda "All integrations (0)" başlığı + Search + 3 kolon kart ızgarası. WordPress sol menüde dış-link ikonlu → `wordpress.org/plugins/chatbot-com-ai-platform/`.
- Arama boş sonuç: **"No integrations found — Try a different phrase or clear your search."** + `Clear search` butonu.

**Kart listesi (açıklamalar birebir)**

| Entegrasyon | Kart açıklaması | Detay URL |
|---|---|---|
| Chat Widget | Easily add an AI chatbot to your website. Customize its looks and feel to make it match your website design. | `/integrations/chat-widget` |
| LiveChat | Integrate your chatbot with LiveChat to enable chat transfers, transcript forwarding, and other valuable features. | `/integrations/livechat` |
| HelpDesk | Follow up on leads and escalate user queries by automatically creating a new HelpDesk ticket whenever necessary. | `/integrations/helpdesk` |
| Messenger | Automate your Messenger conversations using an AI chatbot that answers all questions asked on your Facebook Page. | `/integrations/messenger` |
| Slack | Add an AI chatbot to your Slack workspace to automate repetitive tasks and quickly respond to user inquiries. | `/integrations/slack` |
| Freshdesk | Gather tickets and create new contacts in Freshdesk through personalized conversations with the chatbot. | `/integrations/freshdesk` |
| Shopify | Integrate bot to your Shopify store to automatically inform visitors about order status, search products, and much more! | `/integrations/shopify` |
| Zapier | Connect bot to your favorite apps using Zapier to seamlessly transfer information between services. | `/integrations/zapier` |
| Zendesk | Enhance your customer experience by using a chatbot to gather Zendesk tickets during the chat. | `/integrations/zendesk` |
| Webhook | Pass data from ongoing chats to other services and custom integrations by using simple, yet powerful webhooks. | `/integrations/webhook` |
| WordPress | Install a chatbot on your WordPress website to provide 24/7 customer support with instant answers. | dış link (WP plugin) |

**Detay sayfası ortak şablonu:** "‹ Back to All Integrations" · sağ üst birincil buton · sol kart (logo, **Learn** → yardım makalesi, uzun açıklama, "Use this integration to:" maddeleri) · sağda bağlı kayıtlar listesi + "+ <aksiyon>" satırı.

| Entegrasyon | Birincil buton | Sağ liste başlığı | "Use this integration to:" |
|---|---|---|---|
| Chat Widget | Add Chat Widget | Connected chatbots | easily add a chatbot to any website · proactively greet your website visitors and invite them to chat · customize the look and feel of your bot to match your brand style |
| LiveChat | Connect with LiveChat | Connected chatbots | transfer an ongoing chat to a LiveChat agent · categorize chats with tags · send chat transcripts to your email · close the chat window when the conversation ends. (Açıklama: bot "initial contact point, an after-hours AI agent, or both") |
| Messenger | Connect with Messenger | Connected page | automate conversations on your Facebook page · answer customer questions… without the help of a human · collect leads more effectively |
| Slack | Connect with Slack | Connected channels | automate internal processes · onboard new employees · instantly answer repetitive questions based on internal knowledge (kanal veya DM modu) |
| HelpDesk | Connect with HelpDesk | Connected organizations | automatically collect customer queries and convert them to "HelpDest" tickets (yazım hatası ürün metninde) · gather the user data and pass it to HelpDesk automatically |
| Freshdesk | Connect with Freshdesk | Connected organizations | gather customer queries… turn them into Freshdesk tickets · collect customer contact details such as name and email |
| Shopify | Connect with Shopify | Created stories | promote offers with interactive product cards · increase number of orders · allow customers to easily search for a specific product · provide information about the order status |
| Zapier | Connect with Zapier | Created Zaps | create Google Calendar events · add new data to Google Sheets · add subscribers to your Mailchimp list · add new contacts to Autopilot · send new leads to Salesforce ("over 1000 popular apps") |
| Zendesk | Connect with Zendesk | Connected organizations | (başlık "Integration allows to:") collect customer queries from chats and turn them into Zendesk tickets |
| Webhook | Add Webhook | Connected webhooks | retrieve information about products… show them in the chat widget · collect orders… pass them to your service · retrieve customer information… pass it to your database · show order statuses ("two-way communication") |

**Bağlantı modalı (Chat Widget, Webhook, Freshdesk'te doğrulandı; diğerleri aynı bileşen):** Başlık "Connect with <X>", metin "Select a chatbot you want to connect with <X>.", bot dropdown'u (ilk bot seçili), **Cancel** · **Connect** ⛔ onay bekliyor. → Widget özelleştirme ekranı, webhook URL/token formu ve OAuth akışları Connect sonrasında olduğu için **erişilmedi**.

**Edge-case:** Bağlantı her zaman **bot (story) başına**; bir entegrasyona birden çok bot bağlanabiliyor (liste). Chat Widget görünüm/dil/ön karşılama ayarları entegrasyon örneği içinde, global ayarlarda değil.

---

## 7. Settings — `/settings` (→ `/settings/account`)

**Sol menü:** Account · Team · Subscription (› Your subscription · Invoices) · Data management · Developers.
- Bilinmeyen alt yollar (`/settings/bot`, `/settings/bot-settings`, `/settings/segments`) sessizce `/settings/account`'a yönleniyor.
- **Global "Bot settings" / dil / widget görünümü sayfası yok** — bunlar bot (story) içinde ve Chat Widget entegrasyon örneğinde. (Data management tanıtım görselindeki eski menüde "Bot settings" ve "User segments" maddeleri var → kaldırılmış/taşınmış.)

### 7.1 Account — `/settings/account`

| Öğe | Tip | Davranış |
|---|---|---|
| Avatar (A) + kalem ikonu | file input | profil fotoğrafı yükleme |
| Rol rozeti | etiket | **Owner** |
| Name | text (maxLength yok) | düzenlenebilir (blur'da otomatik kayıt ihtimali — test edilmedi ⛔) |
| Email | email, **readOnly** | değiştirilemez |
| Change password | kart → modal | "Change password": New password · Repeat new password; Cancel · **Change password** ⛔ (boşken pasif). **Mevcut şifre sorulmuyor.** |
| Transfer ownership | kart | tıklamada hiçbir şey olmuyor (ekipte başka üye yok — sessiz pasif durum, açıklama/tooltip yok) |
| Delete account | kart | "Contact our support team to process the deletion of your account." → `mailto:support@chatbot.com` (self-servis silme yok) |
| Tutorials › API documentation | kart | `chatbot.com/docs` (dış link) |

### 7.2 Team — `/settings/team`

Tablo kolonları: **Name** (avatar, ad, e-posta) · **Role** (rozet) · **Status** (Active). Sahip satırında hover ile aksiyon çıkmadı.

**Invite teammate → modal "Invite to ChatBot"**

| Öğe | Davranış |
|---|---|
| Email | placeholder "Type email"; geçersiz ("notanemail") → kırmızı çerçeve, hata metni yok; Send invites pasif kalır |
| Role dropdown | **Administration** (varsayılan) · **Editor** |
| Çöp kutusu ikonu | satırı kaldırır |
| + Invite another | yeni e-posta+rol satırı (toplu davet, her satıra ayrı rol) |
| Cancel · **Send invites** ⛔ | test@example.com girilince aktif oldu — tıklanmadı |

**Roller ve yetkiler (UI metni birebir)**

| Rol | UI açıklaması | Çıkarım |
|---|---|---|
| Owner | davette seçilemez; hesapta tek | her şey + Transfer ownership + hesap silme talebi |
| Administration | "Has access to all ChatBot features. Can manage Teams and the Subscription." | tam yetki, ekip ve faturalama dahil |
| Editor | "Doesn't have access to the Subscription and Bot settings. Can’t manage Teams." | bot içeriği, raporlar, ziyaretçiler (varsayım); abonelik, bot ayarları, ekip yönetimi yok |

→ Yalnız 3 sabit rol. Özel rol, bot bazlı yetki, salt-okunur (viewer/analyst) rol, onay akışı **yok**.

### 7.3 Subscription › Your subscription — `/settings/subscription/dashboard`

Üst bilgi: "Your current plan: **Team free trial**, ends in **7 days**. Subscribe now to keep using ChatBot without interruption."

| Plan | Fiyat (ilk ay) | Liste fiyatı | Rozet | Alt başlık |
|---|---|---|---|---|
| STARTER | $1/mo | ~~$65~~ | Save $64 | Basic chat automation |
| TEAM (CURRENT PLAN) | $1/mo | ~~$169~~ | Save $168 | Advanced chat automation |
| BUSINESS | $1/mo | ~~$499~~ | Save $498 | Complete chat automation |
| ENTERPRISE | — | — | — | Individual contract with included custom bot building process |

**Plan kartına tıklayınca alt panel (birebir):**
- **TEAM — WHAT YOU HAVE:** 5000 free valid chats/mo (?) · 5 active chatbots · All integrations · Data security · Unlimited training history · Advanced reporting · Team collaboration · Button actions · View all features
- **STARTER — WHAT YOU LOSE:** Only 1000 free valid chats/mo · Only 1 active chatbot · Training will be limited to 7 days · Reports will be limited · Team collaboration will be disabled · Button actions will be disabled. **WHAT YOU KEEP:** All integrations · Data security. (Annual: save **20%**)
- **BUSINESS — WHAT YOU GET:** Free 25000 valid chats/mo · Unlimited chatbots · All integrations · Data security · Unlimited training history · Advanced reporting · Team collaboration · Button actions
- **ENTERPRISE — WHAT YOU GET:** Unlimited chats · Unlimited chatbots · All integrations · Data security · Unlimited training history · Advanced reporting · Team collaboration · Button actions · Personal onboarding · Premium customer support · Security assistance · Dedicated account manager · ChatBot configuration · Custom integrations. Sağda: "One-on-one guidance and premium services to help you manage your business at scale." — "Jan from ChatBot" + **Contact Sales** ⛔

**(?) "valid chat" tooltip'i:** "A chat is counted as valid when your chatbot provides at least one response to the customer message. We don’t count the chats that are empty or were not answered by the bot as valid. Once you reach your monthly chats package limit, each additional chat will cost $0.05."

| Öğe | Seçenekler / değer |
|---|---|
| Billing cycle | Monthly (vars.) · Annual (save 15%) — Starter'da Annual (save 20%) |
| Discount | "First month for $1" (yalnız aylıkta görünür) |
| Total price | Aylık: ~~$169~~ **$1**; Annual Team: **$1704** (ilk ay indirimi yok) |
| **Go to checkout** | ⛔ onay bekliyor |
| View all features | dış link `chatbot.com/pricing-legacy/` (yeni sekme) |
| Chat with support | sağ altta yüzen buton |

**Plan özellik tablosu — pricing-legacy "Compare plans" (yıllık faturalı fiyatlar; ✓ var, – yok)**

| Özellik | Starter $52/mo | Team $142/mo | Business $424/mo |
|---|---|---|---|
| Active chatbots | 1 | 5 | Unlimited |
| Chats package | 12,000 chats/yr | 60,000 chats/yr | 300,000 chats/yr |
| Training history | 7 days | Unlimited | Unlimited |
| Team collaboration | – | ✓ | ✓ |
| Version history | – | ✓ | ✓ |
| White label | – | – | ✓ |
| Artificial Intelligence: Automatic bot building · Visual Builder · AI Knowledge · AI Assist · AI model training · Multilingual AI | ✓ | ✓ | ✓ |
| Features: Testing tool · Debug mode · Templates · Flows · Filters · Entities · Custom attributes · User management · Segments · A/B testing · Moments | ✓ | ✓ | ✓ |
| User export | – | ✓ | ✓ |
| Advanced button actions | – | ✓ | ✓ |
| Integrations: Chat Widget · LiveChat · Facebook Messenger · Slack · WordPress · Shopify · Zapier · HelpDesk.com · Freshdesk · Zendesk · Webflow · BigCommerce · Wix · Squarespace | ✓ | ✓ | ✓ |
| Custom (integration) | "Available for Enterprise. Get in touch" | | |
| Reporting: All chats · Paid chats · All messages · Average messages · All users | ✓ | ✓ | ✓ |
| Busiest period | – | ✓ | ✓ |
| Interactions popularity | – | ✓ | ✓ |
| Developer tools: Webhooks · Javascript API · REST API · Moments SDK | ✓ | ✓ | ✓ |
| Security: GDPR Compliance · 256-bit SLL encryption · SSO (Google, Microsoft, Apple) · Data removal | ✓ | ✓ | ✓ |
| Automatic data removal | – | – | ✓ |
| Custom SSO | "Available for Enterprise. Get in touch" | | |
| Product support: Help center · Email support · Chat support | ✓ | ✓ | ✓ |
| Service level agreements (SLAs) · Personal onboarding · Priority support · Legal assistance · Security assistance · Alternative payment methods · Pay with crypto · Bot building service · Bot maintenance · Support from Product Expert | – | – | – ("Available for Enterprise") |

Notlar: Tablodaki "256-bit SLL" yazım hatası üründe. Pricing sayfası "Free 14-days trial" diyor, uygulamadaki deneme 7 gün → tutarsızlık. Uygulamadaki "Reports will be limited" = Starter'da Busiest period + Interactions popularity yok.

### 7.4 Invoices — `/settings/subscription/invoices`
Boş durum: **"You don't have any invoices currently"**.

### 7.5 Data management — `/settings/data` (plan kilidi)
- Kilit ekranı: "**Upgrade plan to Business to use this feature** — The Data Management section allows you to set up automatic deletion of your data and specify the maximum age of your data storage." + **Upgrade plan** ⛔.
- Tanıtım görselindeki içerik: "Delete data automatically" toggle ("Turn on the switch to remove your data when the maximum age of your data storage is reached"), "Maximum age — Define the maximum age of your data storage after which it will be removed." → Value (ör. 30) + Period (days ▾); Tutorial kartı "How to set up data management?".

### 7.6 Developers — `/settings/developers` (API / token)
- **Developer access token** metni: "Developer access token is only for you and should be kept in private. This is a private usage token that allows you to make requests to our API. It should never be shared, as it provides full access to your account."
- Token **düz metin** gösteriliyor (değer bu dokümana yazılmadı) + **Copy to clipboard**. Regenerate/revoke, çoklu token, kapsam (scope), son kullanma **yok**.
- Tutorials › API documentation (`chatbot.com/docs`).
- Webhook'lar Settings'te değil, **Integrations › Webhook** altında ve bot başına bağlanıyor (bkz. §6).

### 7.7 Widget / chat penceresi özelleştirme
- Global ayar sayfası yok. Yol: Integrations › Chat Widget › **Add Chat Widget** → "Connect with Chat Widget" modalı (bot seç) → **Connect** ⛔. Görünüm/renk/ön karşılama/dil ekranları Connect sonrası açılan widget örneği içinde → **erişilmedi**.
- Dil: Multilingual AI plan özelliği olarak listeleniyor; dil seçimi bot/AI düzeyinde (builder kapsamı).

**Edge-case (Settings geneli):** Token kişiye özel ve tam yetkili, iptal edilemiyor. Şifre değişiminde eski şifre istenmiyor; 2FA ayarı yok. Owner devri tek üyeli hesapta sessizce çalışmıyor.

---

## 8. Academy — `/academy` (→ `/academy/category/all`)

**İçerik:** "Master your bot creating skills with ChatBot Academy", arama kutusu, sağ üstte "Your current level: **Beginner**" rozeti (oyunlaştırma). Sol: Lessons › All lessons · Bots (`/academy/category/bots`).

| Ders | Seviye | Açıklama | Beğeni |
|---|---|---|---|
| Onboarding | Beginner | Take this lesson to learn the basics of ChatBot and get started! | 99% |
| Survey bot | Beginner | Know your customers’ opinion with proactive survey chatbot. | 98% |
| Filters 101 | Intermediate | Learn how to use filters to show different messages in different situations. | 100% |
| Ask a question | Beginner | Learn how to collect lead information from your customers in no-time. | 100% |
| Welcome Bot | Beginner | Take advantage of human cleverness and the bot speed in one chatbot. | 99% |
| 🆕 Set attributes | Beginner | Learn how to set custom attributes while chatting with the bot. | 98% |
| Offline Form Bot | Beginner | Get yourself some slack and leave a chatbot on the watch. | 99% |
| Appointment bot | Beginner | Hire a bot to automate your appointment booking system. | 98% |
| Competition Bot | Beginner | Create a bot that invites visitors to participate in a short quiz and get more leads. | 100% |
| Transfer to Agent | Beginner | Learn how to hand the chat over to a real agent in LiveChat | 99% |

**Ders modalı (ör. Onboarding):** seviye rozeti, başlık, **Start now** (⛔ — derse özel bot oluşturduğu için tıklanmadı), "New to ChatBot?" + "In this lesson, you will learn:" (how it works · how to create User Inputs · what are the Bot Responses · how to test your scenario); sağ meta: Last update (Jan 27, 2025 10:56 AM) · Category (Bots) · Time (01:00) · Helped (99%). × ile kapanır.

**Edge-case:** Ders seviyesi/ilerleme takibi kullanıcı bazlı ("Your current level"); ekip yöneticisi için üyelerin ilerlemesini görme yok.

---

## 9. Bizim bot yönetimi için çıkarımlar (iGaming canlı destek platformu)

Bağlam: Bizim platformda bot, canlı destek ekibinin önünde çalışacak. Roller: **Kurucu / Yönetici / Ekip Lideri / Ekip Üyesi**. ChatBot.com ekipleri botu nasıl izletiyor ve kontrol ettiriyor, bunu gözlemledim. Aşağıda neyi alalım, neyi farklı yapalım, ona dair notlarım var.

### 9.1 ChatBot.com'un izleme/kontrol modeli (gözlenen)
1. **Analitik bot hacmi odaklı:** chats, paid chats, busiest period ısı haritası, messages, average messages, users ve **interaction popularity** var. Ajan performansı, devir sayısı, çözüm oranı ve CSAT **yok**.
2. **Bot cevaplarını gözden geçirme iki ekranda:** (a) **Training › Unmatched phrases / Ignored**: botun anlamadığı ifadeler kuyruğu, ifade ya bir cevaba "train" edilir ya da "ignore" edilir; (b) **Popularity tablosu**: "Default fallback", "Bot doesn't understand 1x / 2x or more" bloklarına düşen mesaj yüzdesi. Tek tek cevap için onay/puanlama yok.
3. **Canlı devralma (takeover) ChatBot'un içinde yok.** İnsan devri LiveChat entegrasyonuyla yapılıyor ("transfer an ongoing chat to a LiveChat agent", tags, transcript). Archives yalnız **bitmiş** sohbetleri gösteriyor.
4. **Roller kaba:** Owner, Administration ve Editor var. Editor abonelik ile bot ayarlarına erişemiyor ve ekibi yönetemiyor. Bot bazlı yetki, salt-okunur rol ve denetim kaydı (audit log) yok. "Version history" sadece Team+ planlarda.
5. **Veri yönetimi:** otomatik veri silme (saklama süresi) Business planda. Segmentler statik ve bot akışıyla dolduruluyor. Ziyaretçi filtreleri zengin (14 alan, AND/OR, URL'de saklanan görünüm).
6. **Ücretlendirme "valid chat" sayısına bağlı:** bot en az bir cevap verirse sohbet sayılıyor, limit aşılınca sohbet başına $0.05. Paid chats raporu bunu şeffaf gösteriyor.

### 9.2 Bizim için öneriler (rol bazlı)

| Yetenek | Kurucu | Yönetici | Ekip Lideri | Ekip Üyesi | ChatBot.com karşılığı |
|---|---|---|---|---|---|
| Bot oluşturma/silme, yayınlama | ✓ | ✓ | – (taslak önerir) | – | Owner/Admin/Editor hepsi (Editor da düzenleyebiliyor) |
| Bot akışı/cevap düzenleme | ✓ | ✓ | ✓ (onaya gider) | – | Editor (onay akışı yok) |
| Bot cevaplarını gözden geçirme kuyruğu (anlaşılmayanlar, düşük güven, kötü puan) | ✓ | ✓ | ✓ (kendi ekibi) | işaretleme ("bot yanlış cevapladı") | Training › Unmatched phrases |
| Canlı sohbeti izleme (bot konuşurken) | ✓ | ✓ | ✓ | ✓ (atanan kuyruk) | **yok** |
| Botu devralma (takeover) / bota geri verme | ✓ | ✓ | ✓ | ✓ | yalnız LiveChat entegrasyonu ile |
| Bot raporları (fallback oranı, devir oranı, çözüm, en popüler niyetler) | ✓ | ✓ | ✓ (ekip filtresi) | – | Reports (devir/çözüm yok) |
| Ekip/üye yönetimi, rol atama | ✓ | ✓ | ekibine üye önerir | – | Administration |
| Abonelik/faturalama, API token, veri saklama | ✓ | kısmi (token yok) | – | – | Owner/Admin |
| Denetim kaydı (kim botu değiştirdi/yayınladı) | ✓ | ✓ | okuma | – | yok (Version history sadece Team+) |

### 9.3 iGaming'e özel somut çıkarımlar
- **Hassas konularda zorunlu devir:** para yatırma/çekme, bonus itirazı, hesap kapatma, sorumlu oyun (self-exclusion, limit) ve KYC gibi niyetlerde bot cevabı yerine **kurala bağlı otomatik insan devri** olmalı. Bu kuralları Kurucu/Yönetici tanımlasın. ChatBot'ta bu yalnızca akış içi "transfer" bloğuyla yapılıyor ve politika seviyesinde bir kilit yok.
- **Fallback alarmı:** Popularity tablosundaki "Bot doesn't understand 2x or more" mantığını alalım ama gerçek zamanlı uyarıya çevirelim. Ekip Lideri panelinde "son 15 dakikada fallback > %X" uyarısı çıksın.
- **Cevap kalite döngüsü:** Training'deki "train / ignore" kuyruğunu alalım ve şunları ekleyelim: Ekip Üyesi devraldığı sohbette bot cevabını 👍/👎 ile işaretlesin, Ekip Lideri kuyruğu onaylasın, Yönetici cevabı yayınlasın. Kim neyi onayladı audit log'da tutulsun.
- **Canlı izleme + takeover tek ekranda:** ChatBot'un en büyük eksiği bu. Bizim Inbox'ta bot konuşmaları "Bot görüşüyor" etiketiyle görünsün. Ekip Üyesi/Lideri tek tıkla devralsın, sonra "bota geri ver" diyebilsin. Devir anında bot transkripti ve toplanan alanlar (oyuncu ID, VIP seviyesi, son işlem) agent'a aktarılsın.
- **Raporlar:** ChatBot'un 8 raporuna ek olarak şunlar olmalı: devir oranı, devirden sonra ilk yanıt süresi, botun tek başına çözdüğü oran (containment), niyet bazlı CSAT, dil bazlı kırılım (iGaming çok dilli) ve marka/site bazlı filtre (çoklu marka). Busiest period ısı haritasını vardiya planlaması için Ekip Liderine açalım.
- **Ücret/limit şeffaflığı:** "valid chat" tanımı gibi bot kullanım kotasını Kurucu panelinde gösterelim ve limit yaklaşınca uyarı verelim.
- **Güvenlik:** ChatBot'taki zayıflıkları tekrarlamayalım. Şifre değişiminde eski şifre istenmeli, 2FA olmalı. API token iptal edilebilmeli, kapsamlı ve çoklu olmalı. Token'ı yalnız Kurucu görsün. Veri saklama süresi (KVKK/GDPR, lisans gereklilikleri) Kurucu ayarı olarak tüm planlarda bulunsun.
- **Rol modeli:** ChatBot'un 3 rolü bizim 4 rolümüz için yetersiz. Ekip Lideri katmanı (ekip bazlı görünürlük ve onay) ile bot bazlı yetki (hangi markanın botunu kim düzenler) eklenmeli. Davet modalındaki "satır başına rol + toplu davet" ve rol açıklamasının dropdown'da gösterilmesi iyi UX, bunu alalım.
- **Boş durumlar ve onboarding:** Her boş ekranda tek bir CTA (Connect your chatbot / Get started video) ve Academy dersleri var, bu deseni alalım. Ama "sonuç yok" mesajı eksik olan yerler (Chatbots araması) ve sessizce çalışmayan butonlar (Transfer ownership) gibi hataları tekrarlamayalım.

---

## 10. Erişilemeyen / gözlenemeyen öğeler

| Öğe | Neden |
|---|---|
| Ziyaretçi tablosu kolonları, ziyaretçi profil paneli, toplu seçim, CSV/user export | Hesapta hiç ziyaretçi yok (boş durum) |
| Archives sohbet listesi filtreleri, transkript ve "Chat details" alanları | Bitmiş sohbet yok, yalnız iskelet görüldü |
| Training ifade satırı aksiyonları (train / ignore) | Unmatched phrase yok |
| Rapor grafik detayları (granülerlik, hover, gerçek değerler) | Veri yok; Export to CSV dosya indirdiği için ⛔ |
| Chat Widget görünüm/dil/karşılama ayarları, webhook URL formu, LiveChat/Messenger/Slack/HelpDesk OAuth, Freshdesk/Zendesk kimlik bilgisi formları, Shopify/Zapier kurulumu | Hepsi "Connect" sonrasında açılıyor ⛔ |
| Bot (story) ayarları, AI/Knowledge, dil, bot bazlı yayın/aktiflik | Builder/dashboard kapsamı (diğer ajan) |
| Canlı Inbox / takeover ekranı | Üründe yok (LiveChat'e devrediliyor) |
| Editor rolünün gerçek arayüzü, davet e-postası, bekleyen davet durumu | Davet göndermek ⛔ |
| Transfer ownership modalı | Tek üyeli hesapta tepki vermiyor |
| Data management formu | Business plan kilidi (yalnız tanıtım görseli) |
| Checkout / ödeme ekranı, Contact Sales formu | ⛔ onay bekliyor |
| Card "Duplicate", Rename kaydı, segment Rename/Delete/Confirm, chatbot Delete | Kalıcı değişiklik ⛔ |
| Academy "Start now" | Ders botu oluşturuyor ⛔ |
| Yardım menüsündeki "First steps" ve "Contact us" hedefleri | Sohbet/onboarding akışı başlatıyor; tıklanmadı |

Not: Sayfa içeriklerinde bana yönelik bir talimat görmedim. Developer access token ekranda düz metin olarak görüldü, değeri dokümana yazılmadı.
