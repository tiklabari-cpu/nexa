# 01 — SiyahTuş (nexa-main): Sistemde Olanlar

> **Kaynak:** `C:\Users\Hobbie\Desktop\nexa-main`. Kod yalnızca okunarak incelendi; hiçbir şey değiştirilmedi ya da çalıştırılmadı. Son commit `51c4cb08`, tarih 2026-10-14.
> **Bu dosya ne anlatır?** SiyahTuş'ta bugün **ne var, nasıl çalışıyor, nerede duruyor**. Eksikler ve öneriler bu dosyada değil, 03, 04 ve 05 numaralı dosyalarda.
> **Okuma sırası:** Önce aşağıdaki özet bölüm (§A–§H), ardından ayrıntılı envanter (§1–§3).

## İçindekiler
- [A. Ürün tek bakışta](#a-ürün-tek-bakışta)
- [B. Teknik temel](#b-teknik-temel)
- [C. Modüller (panelde ne var)](#c-modüller-panelde-ne-var)
- [D. AI Agent bugün nasıl çalışıyor](#d-ai-agent-bugün-nasıl-çalışıyor)
- [E. Chat ID / Thread ID ve üye kimliği bugün nasıl çalışıyor](#e-chat-id--thread-id-ve-üye-kimliği-bugün-nasıl-çalışıyor)
- [F. Roller ve yetkiler](#f-roller-ve-yetkiler)
- [G. Gerçek ve mock olanlar](#g-gerçek-ve-mock-olanlar)
- [H. Durum, riskler ve dikkat edilecekler](#h-durum-riskler-ve-dikkat-edilecekler)
- [Ek 1. AI motoru: ayrıntılı kod incelemesi](#ek-1)
- [Ek 2. Kimlik modeli: ayrıntılı kod incelemesi](#ek-2)
- [Ek 3. Tam özellik envanteri (ürün/altyapı, ön yüz, backend)](#ek-3)

---

## A. Ürün tek bakışta
- **Ne?** LiveChat ve Text ürünlerinden ilham alan, canlı destek ile AI müşteri hizmetlerini tek panelde birleştiren çok kiracılı bir platform. Birebir kopya değil.
- **Bileşenler:**
  - Müşteri tarafında web **widget**.
  - Ajan tarafında web **paneli** ve **mobil uygulama**.
  - Gerçek zamanlı mesajlaşma için **RTM** (WebSocket) katmanı.
  - **REST API**: 313 operasyon, 20 alan.
- **Fiyat modeli (PRD):** Kullanıcı başına aylık $99; 200 AI çözümü dahil. AI çözümü, insan yanıtı olmadan kapanan konuşma demek.
- **Referans dikey (PRD):** Online bahis/casino desteği (KYC, para çekme, sorumlu oyun) planlarda var, ama kodda henüz bahis şablonu yok.
- **Durum:**
  - Task Master'da 268/268 görev ve 644/644 alt görev bitmiş; 1.764 commit.
  - Açık olarak yalnızca A11Y ve I18N NFR satırları kalmış.
  - `main` dalında commit'lenmemiş, görev kaydı olmayan bir iş var: `customer_username`, 44 dosya.

## B. Teknik temel
- **Monorepo:** pnpm + Turborepo. Uygulamalar: `apps/api`, `apps/rtm`, `apps/web`, `apps/widget`, `apps/mobile`, `apps/e2e`, `apps/load`. Paketler: `packages/contract`, `packages/types`, `packages/ai-mock`.
- **Backend:** Fastify 5, Prisma 6, Postgres 17 (pgvector) ve Redis.
  - 92 model, 113 migration.
  - Kiracı ayrımı RLS (row-level security) ile yapılıyor; 42 migration bununla ilgili.
  - `events` tablosu aylık bölümlere ayrılmış.
- **Contract-first:** Önce OpenAPI (`packages/contract`) yazılıyor, tipler oradan üretiliyor. Kilitli kararlar `MASTER-PROMPT.md` ve `PLAN.md` §0'da (ADR-01…15).
- **Çok kiracılık:** Organization → License (workspace) → neredeyse tüm tablolarda `license_id`.
  - EU/US bölge seçimi var.
  - Sandbox ve multibrand destekleniyor.
- **Web paneli:** React 18, react-router, TanStack Query, Zustand ve Tailwind. Diller İngilizce ve Türkçe; açık ve koyu tema; 5 font seçeneği.
- **Widget:** Sandbox'lı iframe; 8 dil (Arapça sağdan sola dahil); bir de barındırılan `chat.html` sayfası.
- **Mobil:** Expo / React Native; 4 sekme.
- **Altyapı ve operasyon:**
  - 3 docker-compose dosyası: geliştirme, tam demo, tek host pilot.
  - Helm chart var ama pilotta kullanılmıyor.
  - Cloudflare Tunnel.
  - CI: drift, gereksinim kapsaması, entegrasyon ve e2e kapıları.
  - 79 Playwright spec (yaklaşık 336 test).
  - k6 yük testi: RTM 6.000 bağlantıya kadar sorunsuz.
  - Ayrıca yedekleme/geri yükleme provası, 4 ADR ve 6 runbook.

## C. Modüller (panelde ne var)

| Modül | Yol | Başlıca içerik |
|---|---|---|
| Home | `/app` | Pano, başlangıç kontrol listesi (5 madde) |
| Inbox | `/app/inbox` | Sohbet ve ticket'lar tek yerde. Atama, transfer (ajana), etiket, iç not, mesaj düzenleme, başarısız mesajı yeniden deneme, Copilot paneli (özet, taslak, ton), boşluk tuşuyla yanıt önerileri, ticket grid'i, toplu işlem, birleştirme, takipçi |
| Customers | `/app/customers` | Müşteriler, gerçek zamanlı ziyaretçiler (Traffic), kampanyalar, hedefler (Goals) |
| Team | `/app/team` | Ekip arkadaşları, AI ajanlar (Copilot bilgisi, kural botları), takımlar, beceriler (skills), çalışma takvimi |
| Playbook / AI Agent | `/app/playbook` | Performans, Profil, Skill'ler (adım editörü, 33 şablon), Bilgi (site, dosya, makale, SSS, CSV), herkese açık KB |
| Reports | `/app/reports` | Metrik kırılımları, AI performansı, zamanlanmış raporlar, paylaşım linki, PDF dışa aktarma, doğal dille rapor sorgusu |
| Billing | `/app/billing` | Planlar ve entitlement'lar. Ödeme mock |
| Settings | `/app/settings` | 7 grup altında 33 bölüm: widget, formlar, kanallar, hazır yanıtlar, etiketler, routing, SLA, ticket kuralları, güvenlik (SSO/SCIM, 2FA, IP izin listesi, audit log, SIEM, saklama süresi) ve diğerleri |
| Developers | `/app/developers` | PAT, webhook'lar, Zapier/Make, MCP |
| Apps | `/app/apps` | Marketplace. 103 kart mock; Brevo, Freshdesk ve Telegram canlı |

Komut paleti Ctrl/Cmd+K ile açılıyor; "Ask AI" de var. Ayrıntılar için Ek 3 §2'ye bak.

## D. AI Agent bugün nasıl çalışıyor
Özet (ayrıntı ve dosya:satır referansları Ek 1'de):
1. Ziyaretçi mesajı gelir. Önce kural botu çalışır, ardından AI. AI'dan önce iki kapı vardır: veri bölgesi ve günlük AI kotası.
2. **Skill seçimi kelime örtüşmesiyle** yapılır (eşik 0.6), LLM ile değil. Mesaj başına tek skill çalışır. Uyan skill'ler arasında en son düzenlenen kazanır.
3. Skill adımları tek geçişte çalışır. Altı adım tipi var: konu tespiti, bilgi iste, etiketle, özetle, mesaj gönder (metin ya da bilgi bankası), takıma devret.
4. **Hafıza yok.** Motor konuşma geçmişini almıyor. Oyuncunun bir soruya verdiği cevap, yepyeni bir mesaj gibi baştan eşleştiriliyor.
5. **"Bilgi iste" adımı** soruyu soruyor, ama gelen cevabı okumuyor ve saklamıyor.
6. **Devir** yalnızca açıkça eklenmiş "takıma devret" adımıyla oluyor. Otomatik devir yok. Özet bir şablondan ibaret: ilk 160 karakter. Devirden sonra AI'ın susup susmadığı kontrol edilmiyor.
7. **Profil:** ad, avatar, ton, diller, cevap uzunluğu. Talimat alanı (`instruction`) veritabanında var ama hiçbir yerde kullanılmıyor.
8. **Bilgi:** AI Agent ve Copilot'un kaynakları ayrı. Marka kapsamı yok; taslak/yayın ayrımı yok.
9. **Test:** tek mesajlık önizleme var.
10. **Kayıt:** Hiçbir skill'e uymayan mesajlar kaydedilmiyor.
11. **LLM ve embedding varsayılanı mock.** OpenAI uyumlu sağlayıcı kodda hazır.

## E. Chat ID / Thread ID ve üye kimliği bugün nasıl çalışıyor
Özet (ayrıntı Ek 2'de):
- **Chat** = "müşteriyle süren ilişki" (kapsayıcı); **Thread** = "chat içindeki tek konuşma". ID'ler 10 karakterlik base32 kodları (ör. `TJ1H8CFKRV`).
- Pratikte widget'ta her yeni konuşma **yeni chat + yeni thread** alıyor. Gün ya da saat dilimi mantığı yok.
- ⚠️ **Terimler senin tanımının tersi:** Senin "thread ID"n (üye + gün) nexa'nın **Chat**'ine, senin "chat ID"n (her bağlantı) nexa'nın **Thread**'ine denk geliyor.
- Üye aynı tarayıcıdan geldiğinde `localStorage`'daki müşteri ID'siyle tanınıyor. Başka cihazdan gelirse yeni müşteri kaydı açılıyor. Kullanıcı adı ve e-posta doğrulanmamış bilgiler.
- Chat ID panelde görünüyor ve kopyalanabiliyor; thread ID hiçbir yerde görünmüyor.
- Arama yalnızca son 50 sohbette yapılabiliyor. Mesaj metninde arama yok. Log görüntüleyici yok; pino loglarında `thread_id` yok.

## F. Roller ve yetkiler
- **Roller:** owner > viceowner > admin > agent. Ayrıca 70 scope var; oturum scope'ları rolün tavanına göre kırpılıyor.
- **Panel görünürlüğü** scope listeleriyle belirleniyor (`navigation.ts`, `settings-sections.ts`).
  - Agent rolü Playbook'u, Billing'i ve çoğu ayarı göremiyor.
  - Bazı işlemler yalnızca owner'a açık: workspace fontu, SSO, BAA, sandbox.
- **Kimlik doğrulama:**
  - OAuth 2.1 + PKCE, PAT, HMAC imzalı müşteri tokenı, TOTP 2FA, SAML, SCIM.
  - IP izin listesi ve Redis tabanlı oran sınırı.
- **Henüz yok:** Ekip Lideri rolü. Davette varsayılan rol `admin`.

## G. Gerçek ve mock olanlar

| Gerçek / canlıya hazır | Mock / sahte |
|---|---|
| SMTP, S3, OpenAI uyumlu LLM/embedding (açılırsa), Telegram, Brevo, Freshdesk, imzalı ve yeniden denenen webhook'lar, SAML/SCIM | Ödeme, push, virüs tarama, web crawler, Messenger/WhatsApp/Instagram/SMS, marketplace OAuth (103 kart), varsayılan LLM/embedding, SIEM (yalnız dosyaya yazıyor) |

## H. Durum, riskler ve dikkat edilecekler
- **Riskler** (projenin kendi denetimlerinden):
  - CAPTCHA yok; yabancı biri günlük AI kotasını tüketebilir.
  - Kalıcı AI kuyruğu yok; sunucu çökerse bekleyen yanıt kaybolur.
  - Pilot tek ev sunucusunda çalışıyor.
  - Davet akışıyla başkasının adresine hesap açılabiliyor.
  - Panel tam responsive değil.
- **Kod incelemesinde fark edilenler:**
  - Inbox'ta yazılan taslak sohbetler arasında taşınabiliyor (`Composer.tsx:97`).
  - Ticket'a yanıt verilemiyor; gelen e-postadan yalnızca konu kaydediliyor.
  - Kampanyada "geçerli sayfa" koşulu, ziyaretçinin gezdiği tüm sayfalara bakıyor.
  - `workflows` tablosu kullanılmıyor.
  - RTM'deki 14 aksiyonun 7'si işleniyor; 23 push tipinin 11'i hiç yayınlanmıyor.
- **Kilitli kararlar:**
  - Görsel workflow editörü yok; tek paradigma "Skill" (ADR-14).
  - Uygulama işi subagent'lara dağıtılmıyor (CLAUDE.md).
  - Production deploy, gerçek secret ve ödeme yok.

---

<a id="ek-1"></a>

# Ek 1. AI motoru: ayrıntılı kod incelemesi


Kaynak: nexa-main kodu yalnızca okunarak incelendi (2026-10-14). Dosya yolları repo köküne göredir.

## Özet

Bugünkü AI Agent kelime eşleşmesiyle tetiklenen, tek mesajlık bir adım motoru. Mesajlar arasında hafızası yok.

- **Skill seçimi:** Kelime örtüşmesine göre yapılıyor, LLM kullanılmıyor (eşik 0.6, `packages/ai-mock/src/intent.ts:29`). Aynı mesaja birden fazla skill uyarsa en son düzenlenen kazanıyor; öncelik alanı yok (`skill-engine.ts:234-296`).
- **Bilgi bankası (RAG):** Yalnızca bir skill'in `send_message(source:'knowledge')` adımının içinde çalışıyor. Kendi başına bir geri dönüş seçeneği değil. Benzerlik eşiği 0.25 (`knowledge-service.ts:110`).
- **Hiçbir skill uymazsa:** Bot hiçbir şey göndermiyor ve kayıt da tutulmuyor; cevaplanamayan sorular görünmez kalıyor.
- **Çok adımlı teşhis konuşması yapılamıyor.**
  - `request_info` soruyu soruyor, ama gelen cevabı okumuyor, doğrulamıyor, saklamıyor (`skill-engine.ts:443-459`, `791-799`).
  - Adımlar arasında koşul, dallanma ya da "cevabı bekle" yok.
  - Konuşma geçmişi motora aktarılmıyor (`history=[]`, `skill-engine.ts:285`). Ziyaretçi soruya cevap verdiğinde bu cevap yeni bir mesaj gibi baştan eşleştiriliyor.
- **İnsana devretme:**
  - Yalnızca açıkça eklenmiş bir `transfer_to_team` adımıyla oluyor. Takım adı serbest metin olarak yazılıyor; o adda takım yoksa sohbet olduğu yerde kalıyor (`ai-responder.ts:174-198`).
  - Otomatik devretme yok: müşteri "insanla görüşmek istiyorum" dese de, birkaç deneme başarısız olsa da, müşteri öfkeli olsa da devretmiyor.
  - Devirden sonra da AI her mesajda skill aramaya devam ediyor gibi görünüyor; sohbetin insana geçip geçmediği kontrol edilmiyor (`customer.ts:381-389`).
  - Devirde aktarılan özet bir şablondan ibaret: "Customer asked: <ilk 160 karakter>" (`skill-engine.ts:802-809`).
- **Profil:**
  - Düzenlenebilen alanlar: ad, avatar, ton, diller ve cevap uzunluğu.
  - `AiAgent.instruction` alanı veritabanında var ama hiçbir yerde kullanılmıyor.
  - Talimat (guidance) ya da yasak konu alanı yok.
  - Sistem prompt'u sabit (`provider/answer-prompt.ts:52-82`).
- **Bilgi deposu:** Tablolar tek (`KnowledgeSource` / `KnowledgeChunk`). Ancak AI Agent'ın ve Copilot'un kaynakları ayrı `AiAgent` kayıtlarına bağlı. Yani aynı içerik ikisine ayrı ayrı girilmek zorunda.
  - Marka ya da takıma göre ayırma yok.
  - Taslak/yayın ayrımı yok; skill'in yalnızca açık/kapalı durumu var.
  - Denetim günlüğüne yalnızca silme işlemleri yazılıyor.
- **Şablonlar:** 33 şablon var, hepsi e-ticaret ve SaaS için. Bahis, casino, yatırım, çekim ya da KYC şablonu yok.
- **Test:** `POST /skills/preview` tek bir mesaj üzerinde deneme yapıyor ve günlük AI kotasından düşüyor. Çok adımlı bir sohbet simülatörü yok.
- **Yetki:** Yapay zekâyı düzenleme yetkisi (`agents-bot--all:rw`) yalnızca owner, viceowner ve admin rollerinde var. Ekip lideri ya da içerik editörü rolü yok (`packages/types/src/role-scopes.ts`).
- **Geri bildirim döngüsü yok:** Cevaplanamayan sorular raporu, bilgi eksikleri listesi ve ajanın verdiği beğen/beğenme işareti yok.
- **Mock olanlar:** LLM ve embedding varsayılan olarak mock (`config/env.ts:685`, `:746`). Kelime eşleşmesi, talimat derleyicisi ve dil algılama kural tabanlı.

## "Param hesabıma yatmadı" senaryosu bugün nasıl çalışır?

1. Mesaj "deposit/para yatırma" ifadeleri tanımlı bir skill'e uyarsa, skill ilk soruyu sorar (örneğin "Ne zaman yatırdınız?").
2. Üye "dün akşam Papara ile 500 TL" diye cevap verir.
3. Bu cevap yeni bir mesaj gibi değerlendirilir. "Para yatırma" kalıbına uymadığı için hiçbir skill çalışmaz ve bot susar. Ya da daha kötüsü, hiçbir kalıp tanımlanmamış (catch-all) bir skill her mesaja uyar ve alakasız bir cevap verir.
4. Toplanan bilgi hiçbir yere kaydedilmez. İnsana devredilse bile ajan yalnızca ilk mesajı görür.

**Sonuç:** Senin tarif ettiğin akış (teşhis soruları sor → çözmeye çalış → çözemezsen özetleyip insana devret) bugünkü motorla kurulamıyor. Motorun çok adımlı konuşma yapabilecek şekilde yeniden tasarlanması gerekiyor.


---
<a id="ek-2"></a>

# Ek 2. Kimlik modeli: ayrıntılı kod incelemesi


Kaynak: nexa-main kodu, yalnızca okuma ile incelendi (2026-10-14). Dosya yolları repo köküne göredir.

## Kısa cevap

Bugün üye, konuşması kapandıktan sonra her geri gelişinde **yeni bir chat ID ve yeni bir thread ID** alıyor. Kodda takvim günü ya da saat dilimi mantığı yok. AI yalnızca cevapladığı tek mesajı görüyor. Thread ID arayüzde hiçbir yerde görünmüyor ve aranamıyor. **nexa'daki "chat" ve "thread" kelimeleri, senin tanımının tersini anlatıyor.**

## 1. Chat ve Thread nedir?

- **Chat** (`apps/api/prisma/schema.prisma:781-812`): Koddaki tanımı "tek bir müşteriyle süren ilişki". Bir lisans + müşteri için aynı anda yalnızca bir aktif chat olabiliyor (`uq_one_active_chat`). Bir chat'in altında birden çok thread bulunabiliyor.
- **Thread** (`schema.prisma:814-843`): Koddaki tanımı "chat içindeki tek kesintisiz konuşma". Bir chat'te aynı anda yalnızca bir aktif thread olabiliyor. Atanan ajan, kuyruk bilgisi ve `summary` alanı thread'de tutuluyor.
- **Event** (`schema.prisma:851-887`): Her mesaj satırı hem `thread_id` hem `chat_id` taşıyor. Tablo aylık bölümlere ayrılmış.
- **ID biçimi:** Chat ve thread ID'leri 10 karakterlik Crockford base32 kodları, örneğin `TJ1H8CFKRV` (`packages/types/src/ids.ts:19-51`). Müşteri ID'si UUID.

## 2. Ne zaman yeni chat, ne zaman yeni thread açılıyor?

- Üyenin **aktif** bir chat'i varsa mesaj ona ekleniyor; yeni ID üretilmiyor (`apps/api/src/routes/customer.ts:680-685`, `:813-826`).
- Aktif chat yoksa **yeni chat ve yeni thread** birlikte oluşturuluyor (`chat-service.ts:388-412`, `:1962-2014`).
- Mevcut bir chat'in içinde yeni thread yalnızca ajanın "Reopen" (yeniden aç) işlemiyle açılıyor (`POST /chats/:id/resume`). Bu işlem chat'i, onu açan ajana atıyor.
- Widget kapanmış bir chat'i hiçbir zaman yeniden kullanmıyor. Bu, PRD'deki "kapanınca yeni thread ile devam" ifadesiyle çelişiyor (`urun-gereksinim-dokumani-PRD.md:346`, `:914`).
- **Aynı gün ya da ertesi gün gelmek arasında fark yok.** Chat hâlâ aktifse aradan ne kadar zaman geçerse geçsin aynı chat'e devam ediliyor; kapanmışsa yenisi açılıyor.
- Chat şu durumlarda kapanıyor:
  - Ziyaretçi "End chat" der.
  - Ajan arşivler.
  - Boşta kalma süresi dolar (`InboxSettings.chatTimeoutSeconds`). Bu süre ayarlanmamışsa chat hiç otomatik kapanmıyor.
- `Organization.timezone` alanı var (varsayılan `UTC`), ama yalnızca transkript e-postalarında tarih biçimlendirmek için kullanılıyor.

## 3. Üye farklı ziyaretlerde nasıl tanınıyor?

- Widget, müşteri ID'sini tarayıcıda `localStorage['siyahtus.customer_id']` içinde saklıyor (`apps/widget/src/api.ts:188-235`).
- **Başka cihaz, temizlenmiş tarayıcı ya da gizli pencere = yeni müşteri kaydı.** Widget tarafında ziyaretleri e-posta ya da kullanıcı adıyla eşleştiren bir mekanizma yok.
- `username` alanı yeni ve henüz commit'lenmemiş bir değişiklikle geliyor (`schema.prisma:394-396`; migration `20261014090000_customer_username`). Migration'daki not açıkça "asla arama anahtarı değil: indeks yok, tekillik yok" diyor.
- E-posta için indeks var, ama yalnızca gelen e-posta kanalında eşleştirme için kullanılıyor.
- ⚠️ **Gizlilik riski:** Ad, e-posta ve kullanıcı adı doğrulanmamış bilgiler. AI geçmişi bunlarla eşleştirip hatırlarsa, biri başka bir üyenin kullanıcı adını yazarak o üyenin konuşmalarını görebilir.

## 4. ID'ler nerede görünüyor, nerede aranabiliyor?

- **Chat ID görünen yerler:**
  - Inbox başlığı ve kopyalama butonu (`ThreadHeader.tsx:54`, `:133-137`)
  - Details paneli (`DetailsPanel.tsx:182-183`)
  - Müşteri detayındaki konuşma listesi
  - Ticket'ın kaynak sohbeti
  - Skill çalışma kayıtları
  - Audit log
- **Thread ID arayüzde hiçbir yerde görünmüyor.** API bu bilgiyi döndürüyor, ama Inbox her zaman yalnızca en yeni thread'i yüklüyor (`useInbox.ts:99`).
- **Arama imkânları:**
  - Komut paleti yalnızca son 50 sohbet içinde, tarayıcı tarafında; müşteri adı, son mesaj ve chat ID'ye bakıyor. Thread ID ile aranamıyor.
  - `GET /chats` uç noktasında ID ya da metin araması yok.
  - Audit log'da metin araması bilinçli olarak kapsam dışı bırakılmış.
  - Mesaj metninde arama hiç yok.

## 5. Loglar

- **pino:** Loglar yalnızca stdout'a yazılıyor, arayüzde log görüntüleyici yok.
  - `chat_id` yalnızca AI ve bot loglarında açıkça yazılıyor.
  - Bazı yerlerde anahtar adı `chatId`, bazı yerlerde `chat_id`; yani tutarsız.
  - **Hiçbir log satırında `thread_id` yok.**
- **SkillRun:** Yalnızca `chatId` tutuyor, `threadId` yok.
- **Audit log:** Yalnızca arşivleme, yeniden açma, mesaj düzenleme ve devralma işlemlerinde thread ID'yi metadata olarak tutuyor.

## 6. AI'ın gördüğü geçmiş

- `AiResponder.handle` motoru geçmiş olmadan çağırıyor (`history = []`). Cevap prompt'u yalnızca o anki mesajdan ve bilgi bankası parçalarından oluşuyor.
- Geçmiş mesajları yüklemek için kullanılabilecek mevcut fonksiyonlar:
  - `readConversationTurns(tx, chatId)` (`copilot-service.ts:73-92`)
  - `ChatService.listEvents(..., {threadId})` (`chat-service.ts:242-317`)
  - "Konu" bilgisini saklamak için hazır bir yer: `Thread.summary`

## 7. Terim eşleşmesi: senin tanımın ve nexa

| Senin terimin | Senin anlamın | nexa'da en yakın karşılık | Fark |
|---|---|---|---|
| **Thread ID** | Üye + gün; aynı gün tekrar gelişlerde aynı kalır | **Chat** (uzun ömürlü kapsayıcı) | nexa'nın chat'i güne bağlı değil; widget kapanmış chat'i yeniden kullanmıyor |
| **Chat ID** | Her bağlantı/oturum için ayrı | **Thread** (chat içindeki tek konuşma) | Pratikte her thread kendi yeni chat'iyle açılıyor |

### Çözüm seçenekleri

- **A: Mevcut modele oturtmak** (kod incelemesinin önerisi; PRD ile de uyumlu)
  - Widget yeni konuşma başlattığında, sistem bu üyenin **kiracının saat diliminde aynı gün** kapanmış bir chat'i olup olmadığına bakar.
  - Varsa o chat yeni bir thread ile yeniden açılır: `resume` gibi, ama ajana atamadan, normal yönlendirmeyle. Yoksa yeni chat açılır.
  - AI aynı chat'in önceki thread'lerini okuyarak gün içini hatırlar.
  - Arayüzde etiketler senin dilinle düzenlenir. Kodda `chat.id` = "Thread ID (günlük)", `thread.id` = "Chat ID (oturum)".
  - **Yan etki:** Sohbet sayısı raporları, `Customer.chatsCount` ve puanlamaların hangi kayda bağlandığı değişir.
- **B: Yeni bir "gün thread'i" kavramı eklemek**
  - Örneğin üye + yerel tarih + saat dilimi anahtarlı bir `conversation_day` tablosu.
  - nexa'nın mevcut anlamları korunur, ama arayüz, log ve aramada görünmesi gereken üçüncü bir ID ortaya çıkar.


---
<a id="ek-3"></a>

# Ek 3. Tam özellik envanteri


- Kaynak: `C:\Users\Hobbie\Desktop\nexa-main` (salt-okunur inceleme, 2026-10-14; son commit `51c4cb08`)
- Bölümler: [1. Ürün, durum ve altyapı](#1) · [2. Ön yüz: web / widget / mobil + LiveChat karşılaştırması](#2) · [3. Backend ve gerçek zamanlı katman](#3)

## Kısa özet
- **Ürün:** LiveChat ve Text'ten esinlenen canlı destek + AI platformu. Fiyat modeli kullanıcı başına aylık $99, 200 AI çözümü dahil.
- **Stack:** TypeScript, pnpm + Turborepo, Fastify 5, Prisma 6, Postgres 17 (pgvector) + RLS, Redis, OpenAPI contract-first.
- **Durum:** Task Master'da 268/268 görev ve 644/644 alt görev done; 1.764 commit. Açık kalan yalnızca A11Y ve I18N NFR'leri.
- ⚠️ **Commit'lenmemiş iş:** `main` üzerinde 44 dosya, yeni `customer_username` migration'ı; Task Master'da görevi yok.
- **Backend:** 313 API operasyonu (20 domain), 92 model, 113 migration, 70 scope, 9 zamanlanmış iş.
  - RTM'de 14 istemci aksiyonundan 7'si işleniyor; 23 push tipinden 11'i hiç yayınlanmıyor.
  - `workflows` tablosu kodda kullanılmıyor.
- **Ön yüz:**
  - Web paneli 9 modül; Settings 7 grup altında 33 bölüm.
  - Widget 8 dil destekliyor.
  - Mobil uygulamada 4 sekme var, yalnızca İngilizce.
- **Mock olanlar:** ödeme, push, virüs tarama, crawler, Messenger/WhatsApp/Instagram/SMS, marketplace OAuth, varsayılan LLM.
- **Gerçek olanlar:** SMTP, S3, OpenAI uyumlu LLM, Telegram, giden webhook'lar, SAML/SCIM.
- **LiveChat'e göre eksik:**
  - Ayrı bir Archives sayfası ve gelişmiş arama yok.
  - Kampanya tetikleyicisi yalnızca URL eşleşmesi.
  - Görsel workflow oluşturucu yok.
  - Gerçek sosyal kanallar yok.
  - Widget'ta bilgi bankası araması, ses bildirimi ve okundu bilgisi yok.
- **Riskler:**
  - CAPTCHA yok; günlük AI kotası tüketilebiliyor.
  - Kalıcı AI kuyruğu yok.
  - Pilot tek bir ev sunucusunda çalışıyor.
  - Davet akışı kötüye kullanılabiliyor.
  - Panel tam responsive değil.

---
<a id="1"></a>
# 03 — Ürün Amacı, Plan/Durum ve Altyapı/Ops (SiyahTuş · nexa-main)

> Kapsam: salt-okuma analiz, 2026-10-14. Kök: `C:\Users\Hobbie\Desktop\nexa-main`.
> `.env`, `secrets/` okunmadı. PLAN.md (~3 MB, 9 607 satır) ve HANDOFF.md (~2,7 MB) yalnız başlık/baş/kuyruk olarak tarandı.

---

## 1. Ürün amacı (PRD ve ürün dokümanları)

**Kaynak:** `urun-gereksinim-dokumani-PRD.md` (v1.0, 2026-07-21, sahip "Zoro", durum "Taslak", 1 420 satır)

- **Ne:** LiveChat (eski panel) + Text App (text.com) ürünlerinden ilham alan, ikisini **tek bilgi mimarisinde** birleştiren özgün bir canlı destek ve AI müşteri hizmetleri platformu. Birebir kopya değil.
- **Omurga:** müşteri tarafında cross-origin iframe **widget**, temsilci tarafında `/app/<module>` **SPA panel**. İkisini **RTM WebSocket** bağlıyor. Veri modeli **chat → thread → event**.
- **Üç AI katmanı:**
  1. **AI Agent:** RAG ile beslenir, doğal dille yazılan "skill"leri adımlara derleyip yürütür.
  2. **Copilot:** temsilciye özet ve yanıt önerisi verir.
  3. **Mikro özellikler:** Reply Suggestions, ton düzeltme ve benzerleri.
- **Kanallar:** website widget, chat page, e-posta, Messenger, SMS, WhatsApp; sonraki aşamada Instagram ve Telegram.
- **İş modeli:** kullanıcı başına ayda $99, buna 200 "AI resolution" dahil. Aşım ücretlendirilir; 14 gün kartsız deneme var. Farklılaştırıcı: tek ve şeffaf bir fiyat yüzeyi, kotanın %80'inde uyarı.
- **Referans dikey:** online bahis/casino desteği (KYC, para çekme, sorumlu oyun) için hazır skill şablonları.
- **Fazlar (PRD §5):** MVP (~3–4 ay) → v1 → v2 → Enterprise. Kapsam dışı olanlar §11.1'de; PLAN §9'da yansıtılmış: gerçek ödeme, ses/IVR, ayrı analitik ambar, masaüstü uygulaması.

**Destekleyici dokümanlar**

- `rapor-1-fonksiyonel.md`: MOD-00…MOD-12 ekran ve akış spec'i, EK-A/B/C çapraz kesitleri.
- `rapor-2-teknik-mimari.md`: mimari, frontend, API, DDL (§5.3, şemanın tek doğruluk kaynağı PRD §8.4 ile birlikte), RTM iskelet kodu (§7).
- `design-brief.md`: token'lar (renk, tipografi, spacing, radius, shadow, motion), bileşen envanteri, ekran başına WCAG 2.1 AA kontrol listesi. İlke: "yoğunluk okunabilirlikten ödün vermez", "durum asla yalnız renkle anlatılmaz".
- `LiveChat_ER_Diyagram.mermaid`: **kullanılmıyor**, çünkü PRD ile çelişiyor (bkz. `CLAUDE.md`).
- `MASTER-PROMPT.md`: otonom yapımın ana talimatı. Rol "tek sorumlu senior full-stack"; contract-first, dikey dilim; dış servisler mock; [MAX]/[XHIGH] efor kapıları; 10 dilimlik MVP kritik yolu.
- `CONVENTIONS.md`: Definition of Done kapısı, git, handoff formatı, migration politikası ("önce genişlet, sonra daralt"), test ↔ gereksinim etiketleme (§7).

---

## 2. Kilitli kararlar ve stack

**Kaynaklar:** `MASTER-PROMPT.md`, `PLAN.md` §0, `README.md` "Architecture".

| ADR | Karar |
|---|---|
| 01–03 | TypeScript her yerde. pnpm + Turborepo monorepo. Node 24, Fastify, Prisma, **PostgreSQL 17 (pgvector)**, **Redis 7** |
| 04 | Kaynak tabanlı REST `/api/v1/...`. Orijinaldeki action yüzeyi (`/action/send_event`) taklit edilmedi |
| 05 | Contract-first: `packages/contract` (OpenAPI 3.1) → `@siyahtus/types`. Üretilen tipler commit'leniyor; CI kaymayı (drift) yakalıyor |
| 06 | Hata zarfı `{error:{type,message,request_id,details}}`, 24 tip. HTTP status tipten türetiliyor. Görmeye yetkin olmadığın her şey 404 |
| 07 | Rate limit: agent 180/dk, customer 60/dk, RTM 10 msg/sn |
| 08 | Routing sırası: havuz → priority katmanı → en az yüklü → `last_assigned_at` → fallback → kuyruk |
| 09 | AI resolution: thread agent event'i olmadan kapanırsa +1. Billing ve Reports aynı sorgudan okuyor |
| 10 | Trial 14 gün, bitince salt-okuma |
| 11 | Kafka/RabbitMQ yok: Redis Streams + pub/sub |
| 12 | Bölge `{eu, us}`, kayıtta seçilir ve DB trigger'ı ile değiştirilemez. Pilot tamamen `us` |
| 13 | Fiyat 9900 cent, 200 AI resolution dahil. Stripe **mock** |
| 14 | Tek paradigma Skill. `workflows` tablosu var, görsel builder UI **yok** |
| 15 | RTM zarfı orijinalle uyumlu |

**Uygulamalar ve paketler** (`README.md` §Workspace layout):

| Uygulama/paket | Ne |
|---|---|
| `apps/api` | Fastify + Prisma |
| `apps/rtm` | ws + Redis fan-out, kayıpsız reconnect |
| `apps/web` | React + Vite + Tailwind + Radix, TanStack Query, Zustand |
| `apps/widget` | loader + `allow-same-origin`'siz sandbox iframe |
| `apps/mobile` | Expo / React Native |
| `apps/e2e` | Playwright |
| `apps/load` | k6 |
| `packages/contract`, `packages/types` | sözleşme ve paylaşılan tipler |
| `packages/ai-mock` | deterministik LLM/embedding stub'ı |

**Öne çıkan mühendislik kararları** (`README.md` "Notable engineering choices", HANDOFF kuyruğu):

- **RLS:** API Postgres'e tablo sahibi olarak değil, `siyahtus_app` rolüyle bağlanıyor. `DATABASE_URL` migration için, `DATABASE_APP_URL` runtime için. Sebep: sahip rolü RLS'ten muaf olur.
- **Invariant'lar DB'de:** "lisans + müşteri başına 1 aktif chat" gibi kurallar kısmi unique index ile zorlanıyor.
- **Event ID:** `TJ1H8CFKRV_7` biçiminde, thread ve sıra numarasını taşıyor. Reconnect sonrası "bundan sonrasını ver" senkronizasyonu bu sayede çalışıyor.
- **`events` tablosu** aylık RANGE partition'lı; partition'larda da RLS var (tm 150).
- **Pilotta gerçek sağlayıcılar:** OpenAI LLM + `text-embedding-3-small` (bölgesel host `us.api.openai.com`) ve SMTP (el yazımı, `node:net`/`node:tls`). Dev, test ve demo'da mock kalıyor.

---

## 3. Plan ve durum

### 3.1 PLAN.md fazları

`PLAN.md` başlık tablosu, satır 1–60 ve §2:

| Faz | Durum |
|---|---|
| Faz 0 — MVP (PRD §5.1) | ✅ 60 teslim · 0 kısmi · 0 açık · 3 gruplu-kilitli. 2026-09-04'te yeniden açıldı, sonra GL-13 (tm 208) ile tekrar kapandı |
| Faz 1 — v1 | ✅ 53 teslim · 0 kısmi · 0 açık. Üçüncü kapanış GL-17 (tm 253) |
| Faz 2 — v2 | ✅ 27 teslim + 3 kapsam dışı. GL-8 / GL-15 |
| Faz 3 — Enterprise | ✅ SAML/SCIM, bölge/BAA, SIEM, white-label, SLA, sandbox, mobil. GL-9 |
| Faz 4 — Bütünleme | ✅ tm 128–143 |
| Faz 5 — Doğruluk ve güvenlik borçları | ✅ tm 144–158 |
| Faz 6 — Yayına hazırlık | ✅ tm 159–168: prod config, ops, yük, ölçek, OTel, Helm, yedek, runbook. "Deploy yok", yalnız manifest |
| Faz 7 — PRD uyum düzeltmesi | ✅ tm 175–184 (kaynağı `prd-uyum-denetimi.md`) |
| Faz 8 — Kalan gereksinim borçları | ✅ tm 185–254, GL-16 |
| Pilot epic'leri (PLAN dışı numaralandırma) | ✅ tm 255–268 |

- **Modül matrisi (§2):** tüm MOD satırları ✅. Tek istisna: görsel Workflow builder ⛔ (ADR-14).
- **Hâlâ ◐ olan NFR satırları (§7):** yalnız **A11Y1–6 (◐ → KA11Y)** ve **I18N1/2 (◐ → KI18N1-2)**. I18N'de widget 8 dil, panel en/tr; kalan 37 dil "içerik payı" olarak bilerek yapılmıyor.
- **Diğer PLAN bölümleri:** §C Assumptions, §D Deviations (§D1…§D212 civarı), §F kapanış protokolü, §K kanıt geçmişi.
- **`PLAN-V2-KIRILIM.md`** (~0,9 MB): Faz 2'nin atomik iş kırılımı ve "depoya özgü tuzaklar" bölümü. Tarihsel; Faz 2 kapandı.

### 3.2 Task Master

Kaynak: `.taskmaster/tasks/tasks.json` (3,5 MB, tek etiket `master`).

- **268 görevin 268'i done, 644 alt görevin 644'ü done.** `pending`, `in-progress`, `deferred` ya da `blocked` görev yok.
- Kuyruk boş; sıradaki iş Task Master'a henüz girmemiş (bkz. §3.4).
- `.taskmaster/tasks/task_001..258.md` dosyaları 2026-10-05 tarihli eski dışa aktarım. Güncel kaynak `tasks.json`.

**Görevlerin alanlara göre dağılımı (başlıklardan):**

| Aralık | Konu |
|---|---|
| 1–62 | MVP/v1 özellik dilimleri: dosya paylaşımı, website/e-posta kanalı, billing/checkout (mock), bildirimler, ⌘K, inbox sekmeleri, raporlar, onboarding, audit log, retention, OTel, i18n, Playbook, AI Agent + Knowledge, webhook, omnichannel mock, Copilot, kampanyalar, ticket kuralları, forms builder, marketplace, widget özelleştirme |
| 63–99 | v2 dilimleri: metrik kırılımı, chat topics, Instagram/Telegram mock, skills-routing, MCP sunucusu, spam, CC maskeleme, API paketleri, Zapier/Make, Engage 360, Goals, Sales tracker, public KB, vardiya, multibrand, IP allowlist. Enterprise: SAML/SCIM, HIPAA/bölge, SOC2/SIEM, white-label/SLA/sandbox, mobil |
| 100–127 | Kararlılık ve PLAN tutarlılığı: e2e flake'leri, seed kirlenmesi, format borcu, a11y (axe), tema, Faz-2/3 kapanışları |
| 128–168 | Faz 4–6: mobil kullanılabilirlik, scheduler, env bütünlüğü, CI, i18n, CSAT, container'lar, seed, güvenlik denetimleri (M-SEC a–e), 2FA, sayfalama, prod config, ops, yük, ölçek, IaC, yedek, runbook |
| 169–184 | Faz 7, PRD uyum: Teams yazma yolları, kampanya teslimi, paylaşılan nesne deposu, rapor doğruluğu, sunucu tarafı sayaçlar, readiness mantığı, şirket bilgileri, izlenebilirlik kapısı |
| 185–254 | Yeniden açılan Must kalemlerinin triyajı ve kapatılması (F0/V1/V2 REOPEN), Faz 8 borçları: mesaj düzenleme, toplu eylemler, kural botu, NFR-P6/C8, KB recall/ölçek |
| 255–257 | **Pilot epic'leri:** SMTP + gerçek LLM/embedding, go-live boşlukları, herkese açık pilot hazırlığı (pilot modu, e-posta doğrulama, AI tavanları, yasal linkler, Cloudflare Tunnel) |
| 258–268 | CI'ı yeşile çevirme, e2e hızlandırma (paralel izole yığınlar), canlı öncesi UX sağlamlaştırma (epic 259, 26 alt görev), a11y/i18n kalanı, sahip düzeltmeleri, **Apps canlı adaptörleri** (Brevo, Freshdesk, Telegram), e-posta şablonları ve teması, panel/widget yeniden giydirme, panel font ön ayarları |

### 3.3 Git

- **Toplam 1 764 commit.** İlk commit 2026-07-22 ("first materials"), son commit `51c4cb08` 2026-10-13 (tm 268 merge).
- 2026-10-01'den bu yana 160 commit. Yerelde 230 dal var. Akış `feat/<slug>` → `main`'e merge, force-push yok.
- Son 60 commit'in içeriği:
  - tm 259.7–259.26: onay diyalogları, hata geri bildirimi, i18n, landmark'lar, odak yönetimi, dar ekran.
  - tm 261–268: owner düzeltmeleri, Apps canlı adaptörleri, "hiçbir Apps ayarı boot'u durdurmaz", e-posta şablon ve teması, widget restyle, font ön ayarları.
- **Commit'lenmemiş, Task Master'da görevi olmayan iş var.** Mevcut dal `main`; 44 dosya değişmiş (+611/−160).
  - Yeni migration `apps/api/prisma/migrations/20261014090000_customer_username/` (izlenmiyor).
  - `Customer.username` alanı eklenmiş (widget pre-chat formunda ziyaretçinin yazdığı kullanıcı adı).
  - Değişiklik sözleşme, api, widget testleri, e2e ve mobil testlere yayılmış.
  - Bu iş `tasks.json`'da yok (269 numaralı görev açılmamış).

### 3.4 HANDOFF.md

- **Yeniden eskiye görev günlüğü:** en üstte tm 268 (2026-10-13). Her kayıtta "Yapıldı / Varsayımlar / Doğrulama / Ders / Sonraki pencereye not" alanları var.
- **Dosyanın sonundaki İngilizce "What exists / What is honestly incomplete / What to build next" bölümü 2026-07 tarihli ve bayat.** Örneğin "16/52 MVP gereksinimi yazılmadı", "webhooks/Copilot başlamadı", "621 test" diyor; bunlar artık doğru değil. Güncel durum için PLAN başlık tablosu ve HANDOFF'un en üst kayıtları esas alınmalı.

---

## 4. Altyapı ve ops

### 4.1 Docker Compose

| Dosya | Amaç |
|---|---|
| `docker-compose.yml` | `make dev` veri depoları: `pgvector/pgvector:pg17` (host portu 5433), `redis:7-alpine` (6380). `storage` profilinde MinIO + mc init. Ports varsayılanlardan kaydırılmış |
| `docker-compose.full.yml` | Yerel tam demo yığını: db, redis, (minio), `init` (migrate + seed), api, rtm, web, widget imajları. `make demo` + `scripts/smoke.sh`. Deploy değil |
| `docker-compose.pilot.yml` | **Kontrollü production pilotu, tek Docker host** (tm 255.15). Ayrıntılar aşağıda |

`docker-compose.pilot.yml` ayrıntıları:

- `NODE_ENV=production`, seed yok, `name: siyahtus-pilot`.
- Tüm portlar yalnız `127.0.0.1`'de. db ve redis için host portu yok.
- `.env` kullanılıyor; zorunlu değerler `:?` ile korunuyor (eksikse Compose başlamıyor).
- Log rotasyonu açık (10 MB × 5 dosya).
- Kenar (edge) host'un sorumluluğunda: **şimdi** Cloudflare Tunnel (systemd), **sonra** DNS-only Caddy. Her iki yolda da `TRUST_PROXY_HOPS=1`.
- Uygulamanın kendi boot kapıları (`parseEnv`/`productionProblems`) eksik ya da placeholder secret'ta açılmayı reddediyor.

### 4.2 `infra/`

- **`infra/helm/siyahtus`** (chart 0.1.0)
  - Şablonlar: deployment, service, configmap, secret, hpa, pdb, networkpolicy, migrate-job, backup-cronjob, backup-pvc. Ayrıca `values.production.example.yaml`.
  - Postgres ve Redis dahil değil (yönetilen servis varsayımı).
  - **Pilotta kullanılmıyor.** Sahip kararıyla Kubernetes kapsam dışı; chart "tutuluyor".
- **`infra/pilot/`**
  - `cloudflared/config.example.yml`: panel, api, rtm ve widget için 4 hostname → `127.0.0.1` portları. Panelin `/api/` yolu doğrudan api'ye gidiyor; böylece her yol tek hop.
  - `Caddyfile.example`: ileride kullanılacak, yalnız DNS-only (grey cloud) kayıtlarla.
- **`infra/db/`**: `init/00-extensions.sql` ve `pilot/10-app-role-password.sh` (uygulama rolünün parolası).

### 4.3 CI (`.github/workflows/ci.yml`)

Tetikleyiciler: push, PR, elle çalıştırma. İşler:

1. **verify:** install → DB eklenti ve rol hazırlığı → contract build → **üretilen tipler senkron mu** → Prisma generate → migrate → **`db:check-drift`** → typecheck → lint → format:check → **`audit:req-coverage`** → build → unit testler (mobil hariç).
2. **integration (3 shard):** API entegrasyon testleri (`with-test-datastores`) + RTM entegrasyon testleri.
3. **pilot-images:** pilot imajlarını derliyor.
4. **mobile:** Jest + `expo export`.
5. **e2e:** seed + Playwright (chromium), 45 dk sınırı.

tm 258 (2026-10-04) `main`'i yeniden yeşile çevirdi.

### 4.4 Test kapısı (DoD)

- **`scripts/test-gate.mjs`** (`pnpm test:gate`): build → statik (typecheck, lint, prettier) + birim paralel → entegrasyon (parçalı, `--jobs`) → isteğe bağlı e2e. `--force` turbo cache'i atlıyor. Sonunda tek bir özet tablo basıyor.
- **CONVENTIONS §1 maddeleri** (her biri exit code ile doğrulanıyor):
  - typecheck, lint, format, unit, integration, build, ilgili e2e
  - kontrat senkronu, drift, req-coverage
  - PLAN damgası (◐/⬜ → ✅) ve `## K.` kanıt bloğu

### 4.5 `scripts/`

| Script | Ne yapıyor |
|---|---|
| `smoke.sh` | Container yığınında exit code ile "ulaşılabilir ve kendine bağlı mı" kontrolü. `SMOKE_PROFILE=pilot` ile CORS ve pilot kontrolleri |
| `backup.sh` | `docker compose exec` içinde `pg_dump` + upload tar'ı. `BACKUP_RETENTION_DAYS=30` (GDPR Art. 12(3) ile hizalı) |
| `restore-drill.sh` | Yedeği geçici bir DB'ye (`siyahtus_restore_drill_<n>`) geri yükleyip doğruluyor, sonra siliyor. Kaynak DB'ye yalnız SELECT atıyor |
| `audit/*` (salt-okuma) | `sweep` (137 FR-MOD satırı ↔ PLAN damgası), `schema-consumers` (ölü tablo), `silent-debt` (TODO, skip, ts-ignore), `dead-code`, `endpoint-ui` (çağıranı olmayan operasyon, **kapı**), `unpaged-lists` (NFR-P5, **kapı**), `req-coverage` (247 kabul kriteri ↔ test etiketi, **CI kapısı**) |
| `edge-rehearsal/` | Tunnel ve Caddy taklidiyle sahte `X-Forwarded-For` göndererek `TRUST_PROXY_HOPS=1` varsayımını yerelde sınıyor |
| `pilot-owner-token.mjs` | Pilot sahibine token üretme yardımcısı |

### 4.6 ADR'ler (`docs/adr/`)

| ADR | Tek satır özet |
|---|---|
| `agent-session-refresh.md` (2026-10-07, tm 259.1) | Panel access token'ı süresinin %70–80'inde proaktif yeniliyor. Yalnız `invalid_token` işaretli 401'de tek yenileme ve tek tekrar. Sekmeler arası Web Lock + BroadcastChannel. Reddedilen refresh oturumu bitiriyor; soket yenilemede yeniden kurulmuyor |
| `pilot-llm-embedding-provider.md` (2026-09-22, tm 255.1) | Pilot için OpenAI'ın kendi chat completions ucu; embedding ayrı yapılandırılıyor (`text-embedding-3-small`, native 1536 boyut, migration yok ama tam yeniden gömme gerekiyor). Bölgesel host zorunlu. Streaming ve tool calling kapsam dışı |
| `pilot-public-readiness.md` (2026-10-02, tm 257.1) | `PILOT_MODE` bayrağı + anonim `GET /deployment`. Sahte yüzeyler gizleniyor ve API 403 `pilot_mode` ile reddediyor. Açık kayıt korumaları: e-posta doğrulama, kayıt hız sınırı, token bazlı günlük AI tavanı, posta tavanı; **CAPTCHA yok**. Yasal URL'ler zorunlu. Kenar: Cloudflare Tunnel → Caddy. Copilot gerçek LLM kullanıyor |
| `smtp-transport.md` (2026-09-22, tm 255.3) | SMTP kütüphane değil el yazımı (`node:net`/`tls`), çünkü "250'den sonra ikinci DATA asla gönderilmez" garantisi gerekiyor. TLS ≥1.2 zorunlu, AUTH PLAIN/LOGIN, geçici/kalıcı hata ayrımı, 3 deneme ve üstel bekleme |

### 4.7 Runbook'lar ve production checklist

- **`docs/runbooks/`** (her biri belirti → teşhis komutu → müdahale → kayıt):
  - `postgres-down`, `redis-down`
  - `webhook-backlog`
  - `rtm-connection-storm`
  - `tenant-isolation-suspicion`
  - `event-partitions`
- **`docs/production-checklist.md`:** her madde bir komut ya da depoda kayıtlı bir kanıt. Bölümler: §1 Konfigürasyon, §2 Ops, §3 Kapasite, §4 Ölçek, §5 Deploy, §6 Yedek, §7 Gözlemlenebilirlik, §8 Uyumluluk.
- **Checklist §9 "Pilot on Docker Compose"** pilotun açılış reçetesi:
  - anahtarlar, Cloudflare Tunnel, Caddy'ye geçiş, bölge ve sağlayıcılar
  - **SPF/DKIM/DMARC** (kayıt açılmadan önce bir kapı)
  - kayıt, tavanlar ve kötüye kullanım limitleri
  - yasal linkler, `RETRIEVAL_THRESHOLD` ölçümü
  - deneme sonu ve elle aktivasyon, veri/yedek, host
- Checklist açıkça söylüyor: **"this repo has never seen a real cluster".**

### 4.8 E2E ve yük testi

- **`apps/e2e`** (Playwright):
  - 79 spec, `test(` çağrısı ~336. Kanıt PNG'leri `apps/e2e/kanit/` altında.
  - Ek konfigürasyonlar: `playwright.pilot.config.ts` (pilot modu), `playwright.session.config.ts` (`ACCESS_TOKEN_TTL=60` ile oturum yenileme).
  - Kapsadıkları: inbox (atama, sıralama, yeniden açma, öneriler, gözetim, sekmeler, okunmamış), widget, demo akışı, routing/skills, ticket, müşteriler, kampanyalar, hedefler, trafik, raporlar, billing ve entitlement, SSO, 2FA, SIEM, retention, uyumluluk, AI agent, Copilot, kural botu, public KB, i18n, a11y (axe), landmark'lar, odak, dar ekran, pilot modu, oturum yenileme ve geri yükleme, görünüm/font.
  - tm 260'tan beri tam süit paralel özel yığınlarda koşuyor: 331/331, ~8–10 dk (eskiden 23,5 dk).
- **`apps/load`** (k6, **CI'da değil**):
  - Senaryolar: `smoke.js`, `rest.js`, `rtm.js`.
  - 2026-08-27 ölçümü, tek dev laptop: RTM 6 000 sokete kadar yeşil (fan-out p99 466 ms). **8 000'de bozuluyor** (p99 599 ms, 60 ret).
  - PRD'deki NFR-P8 hedefi "~20k/pod" bu yığın için revize edildi (§D127). Bağlantı tavanı `RTM_MAX_CONNECTIONS` ile ayarlanıyor (tm 170).

---

## 5. Otonom yapım döngüsü

- **`run-loop.sh`** (27 KB):
  - Her Task Master görevi **temiz bir `claude` penceresinde** çalışıyor (stream-json, `.loop-logs/task-<id>.jsonl`).
  - Model ve efor görev etiketinden seçiliyor: `[OPUS|SONNET]-[HIGH|XHIGH|MAX]`. Opus 5.5 / Sonnet 5.5; güvenlik işi asla Sonnet'e verilmiyor.
  - İzin modu `PERM="auto"` (2026-10-03'ten beri; önceden `bypassPermissions`).
  - Başarısız göreve 1 retry; `MAX_TASK_ATTEMPTS=2`; üst üste 5 hatada döngü duruyor.
  - **Kota kapısı** var: 5 saatlik pencere ≈ $170; xhigh görev ~%8, max görev %15–18. Ayrıca panelden "nazik durdurma" kapısı.
- **`TASK-RUNNER-PROMPT.md`:** pencere protokolü. Bootstrap (bağlamı Task Master, git ve HANDOFF'tan kur) → resume kontrolü → build, doğrulama, düzeltme → kapanış (DoD kapısı + commit + push + Task Master done + HANDOFF kaydı).
- **`AUTORUN-README.md`:** kurulum ve izleme (terminal, jsonl, git, HANDOFF, `task-master list`).
- **`CLAUDE.md` sınırları:** prod deploy, DNS/TLS, gerçek secret, ödeme, force-push, DB drop yok.
- **`.claude/`**
  - `commands/is.md`: sıradaki görevi al ve yürüt.
  - `commands/dilim-kapat.md`: dilimi kapat; PLAN'ı geriye doğru güncelle, merge + push.
  - `commands/tm/*`: ~45 standart Task Master komutu.
  - `hooks/session-start.sh`: yalnız cloud oturumunda Node 24, pnpm, Docker, DB ve Task Master'ı kuruyor.
- **`.taskmaster/`:** `BUILD-BLUEPRINT.md`, `otonom.sh`, `gunluk.mjs`, ağustostan kalma `tmp-*.cjs` yardımcıları (temizlik adayı).

---

## 6. Bilinen boşluklar ve riskler

### 6.1 `prd-yeterlilik-degerlendirmesi.md` (2026-07-21, kodlamadan önce)

- **Hüküm:** PRD kodlamaya yeterli ve engelleyici boşluk yok.
- **Boşluklar G1–G10:** tasarım sistemi yok (G1), rate-limit değerleri (G2), routing algoritması (G3), AI/RAG Ar-Ge (G4), kanal onayları (G5), Stripe wiring (G6), ER diyagramı çelişkisi (G8) ve diğerleri.
- Önerdiği 10 kilit karar PLAN §0'daki ADR-01…15'e dönüştü.

### 6.2 `prd-uyum-denetimi.md` (2026-08-30, 12 denetçi + 12 çürütücü ajan)

- **Sonuç:** 247 gereksinim maddesinin **93'ü TAM (%38)**, 141'i KISMİ, 13'ü YOK. "Ürün çalışıyor ama son adım atılmamış."
- **En güçlü alanlar:** Auth (%71) ve veri modeli (%58). **En zayıf:** NFR-PERF (%11) ve FR-13 Engage/Mobil (%13).
- **Sistemik desenler:**
  - D1: omnichannel tek yönlü
  - D2: backend sağlam, UI yarım
  - D3: yüklenen pencere gerçek toplam sanılıyor
  - D4: ölü tablolar
  - D5: hukuki uyumluluk metinleri yok
  - D6: stateless ihlali (yüklemeler pod diskinde)
  - D7: testler kriteri değil dönüş kodunu ölçüyor
  - D8: readiness operatörü ters
- **Kritik iki bulgu:** `/groups` yalnız okunabiliyordu; kampanya otomatik gönderimi yoktu.
- **Sonrası:** Faz 7 (tm 175–184) ve Faz 8 / REOPEN triyajı (tm 185–254) bu bulguları kapattı. Sonuçta DoD'ye "kabul kriteri başına test" kapısı eklendi (`audit:req-coverage`, CONVENTIONS §7).
- **Kalan:** D5 hukuk işi kısmen kapsam dışı bırakıldı (KVKK/VERBIS sahip kararıyla dışarıda, yalnız DPA/SCC daraltması). Workflow builder ⛔.

### 6.3 `docs/ux-audit-2026-10-07.md` (canlı öncesi 2. tur UX taraması)

- **Bulgular:** 1 kritik (K1: panel oturum içinde token yenilemiyor, 1 saat sonra her istek 401), 5 yüksek (Y1–Y5), O1–O17 orta, D1–D21 düşük.
- **Kapatılması:** epic **tm 259** (26 alt görev) + tm 261. Kapanış tablosunda neredeyse hepsi "kapandı".
- **Kısmen kalanlar:**
  - O6: tam responsive panel yok. 1024 px altında "masaüstü için tasarlandı / yine de devam et" gösteriliyor.
  - D10: biçimi doğru ama harcanmış doğrulama token'ı hâlâ önce şifre soruyor.
- **Test edilmeyenler:** ekran okuyucuyla gerçek kullanım, gerçek telefon ve mobil uygulama, RTL widget, çoklu temsilcinin aynı anda kullanımı, performans.

### 6.4 Açık operasyonel riskler

Kaynak: `docs/production-checklist.md` "Known risks".

- **Kötüye kullanım:**
  - Yabancı biri bir çalışma alanının günlük AI tavanını tüketebilir.
  - Widget ve kayıt uçlarında **CAPTCHA yok**.
  - Davet akışıyla başkasının adresine hesap açılabilir.
- **Ayar ve konfigürasyon:**
  - RTM `/health`'in hız sınırı yok ve tünel üzerinden internetten erişilebiliyor.
  - `RTM_MAX_CONNECTIONS` ayarlanmazsa bağlantı tavanı yok.
  - Elle aktivasyon audit kaydı yazmıyor.
- **Tek süreç / kalıcılık:**
  - Kalıcı bir AI kuyruğu yok; süreç çökerse bekleyen AI yanıtı kayboluyor.
  - Bildirim postaları da kalıcı değil.
- **Altyapı:**
  - **Tek ev sunucusu = tek hata noktası.** Bellek baskısı sessizce takılmaya yol açıyor.
- **Bağımlılık ve test:**
  - `pnpm audit` 27 uyarı veriyor; hepsi `apps/mobile` (Expo) üzerinden ve pilot dışında.
  - e2e süiti sıraya bağımlı (fixture durumu).
- **Pilot dışında bırakılanlar (sahip kararı):** ödeme/Stripe, mesajlaşma kanalları, mobil push, S3, virüs tarama, SIEM, yük testi, MCP, sosyal giriş, yüklemeler, OTel toplama, Kubernetes.

### 6.5 Bu analizde gözlenen ek notlar

1. **HANDOFF.md kuyruğundaki özet bayat** (2026-07); yanıltıcı olabilir.
2. **`main` üzerinde commit'lenmemiş, görevi olmayan WIP var:** `customer_username` migration'ı ve 43 dosya. CONVENTIONS'taki "her iş bir görev + `feat/` dalı" akışına uymuyor.
3. **NFR'lerde açık kalan iki satır:** A11Y ve I18N ◐. Faz kapanışlarını bloklamıyorlar ama "WCAG 2.1 AA" iddiası tam değil.
4. **"Production" seviyesindeki kanıtlar** (yük, ölçek, Helm) tek laptopta ve manifest düzeyinde. Gerçek pilot host'ta yapılacak işler sahibe ait: tünel, DNS, SPF/DKIM/DMARC, OpenAI ve SMTP anahtarları, off-host yedek, dış uptime kontrolü.


---
<a id="2"></a>

# 02 — Ön Yüz (Frontend) Özellik Envanteri: SiyahTuş

> Kapsam: `apps/web` (ajan/yönetici paneli), `apps/widget` (müşteri sohbet widget'ı), `apps/mobile` (Expo/React Native ajan uygulaması).
> Yöntem: Salt okuma. Kaynak: rota tanımları, navigasyon katalogları, i18n katalogları (`apps/web/src/locales/en/*.ts` ≈ 3.500 anahtar), bileşen dosyaları. Hiçbir şey çalıştırılmadı, değiştirilmedi.
> Kök dizin: `C:\Users\Hobbie\Desktop\nexa-main\apps\` (aşağıdaki yollar buna görelidir).

---

## 0. Kısa Özet

- **Web paneli** React 18 + react-router + TanStack Query + Zustand + Tailwind. 9 ana modül (Home, Inbox, Customers, Team, Playbook/AI Agent, Reports, Billing, Settings, Developers) + Apps marketplace + herkese açık paylaşılan rapor sayfası + kimlik doğrulama sayfaları + ilk kurulum sihirbazı.
- **Ayarlar** 7 gruplu yan menüde **33 bölüm** (`web/src/features/settings/settings-sections.ts`).
- **Widget**: framework'süz TS (≈4.200 satır `widget/src/widget.ts`), sandbox'lı cross-origin iframe + loader, **8 dil** (en, tr, de, fr, es, it, pt, ar — Arapça RTL), tema auto/light/dark, ön/son sohbet formu, çevrimdışı form (ticket), dosya, emoji, yazıyor göstergesi, puanlama, kampanya, satış takibi, hosted "Chat page".
- **Mobil**: 4 sekmeli (Inbox, Customers, Reports, Settings) ajan uygulaması; sohbet yanıtlama + iç not, Copilot, push bildirim → sohbete derin bağlantı, çoklu hesap, SSO (PKCE). Çoğu yönetim ekranı salt okunur. Yalnızca İngilizce; tema OS'u takip eder.
- **Pilot modu** (`pilot_mode`, `GET /deployment`): Billing, Apps marketplace, Integrations ve mock kanallar gizlenir (`web/src/components/PilotHidden.tsx`).
- **Rol/scope tabanlı UI**: her navigasyon öğesi ve her ayar bölümü bir "any-of scope" listesiyle gizlenir (asıl kapı API'de). Roller: Owner, Vice owner, Admin, Agent.

---

## 1. Web Paneli (`apps/web`)

### 1.1 Rota Haritası (`web/src/App.tsx`)

**Oturum açmamış kullanıcı rotaları**

| Rota | Sayfa | Dosya |
|---|---|---|
| `*` (varsayılan) | Giriş (e-posta/şifre, SSO, çalışma alanı seçici, 2FA kodu / kurtarma kodu, zorunlu 2FA kurulumu) | `features/auth/SignInPage.tsx` |
| `/signup` | Çalışma alanı oluştur (ad, ad-soyad, e-posta, şifre, **veri bölgesi EU/US**, şartlar onayı; "14 gün ücretsiz, kart yok") | `features/auth/PublicPages.tsx` |
| `/forgot-password` | Şifre sıfırlama linki iste | aynı |
| `/reset-password` | Yeni şifre (e-postadaki token) | aynı |
| `/join` | Davet kabulü | aynı |
| `/verify-email` | E-posta doğrulama | aynı |
| `/auth/callback` | OAuth/SSO geri dönüşü (PKCE) | `features/auth/AuthCallbackPage.tsx` |
| `/shared/report` (SHARED_REPORT_PATH) | Hesapsız okunabilen **paylaşılan rapor** (token URL fragment'ında) | `features/reports/SharedReportPage.tsx` |

Ek durumlar: `ReconnectingPage` (sunucuya ulaşılamıyorsa kabuk `inert` olur, yazılan taslak korunur; "Try now" / "Sign out"), `LoadingPage`, `DeploymentGate` (başlangıçta ayar yüklenemezse "Cannot reach the server").

**Oturum açmış kullanıcı rotaları** (`/app` altında `AppShell`)

| Rota | Modül | Ana dosya |
|---|---|---|
| `/app/onboarding` | İlk kurulum sihirbazı (yeni çalışma alanı sahibi zorunlu yönlendirilir) | `features/onboarding/OnboardingWizard.tsx` |
| `/app` → `/app/inbox` | (yönlendirme) | |
| `/app/home` | Home / Dashboard | `features/home/HomePage.tsx` |
| `/app/inbox` (`?chat=`, `?ticket=` derin link) | Inbox (sohbetler + ticket'lar) | `features/inbox/InboxPage.tsx` |
| `/app/customers` | Müşteriler (Contacts) | `features/customers/CustomersPage.tsx` |
| `/app/customers/real-time` | Canlı trafik (ziyaretçiler) | `features/traffic/TrafficPage.tsx` |
| `/app/customers/campaigns` | Kampanyalar | `features/campaigns/CampaignsPage.tsx` |
| `/app/customers/goals` | Hedefler (Goals) | `features/goals/GoalsPage.tsx` |
| `/app/team` | Ekip arkadaşları | `features/team/TeamPage.tsx` |
| `/app/team/ai-agents` | AI ajanları / chatbot'lar | `features/team/TeamAiAgentsPage.tsx` |
| `/app/team/teams` | Takımlar (gruplar) | `features/team/TeamsPage.tsx` |
| `/app/reports` | Raporlar | `features/reports/ReportsPage.tsx` |
| `/app/billing` | Faturalama (pilotta gizli) | `features/billing/BillingPage.tsx` |
| `/app/playbook` | AI Agent (Playbook) | `features/playbook/PlaybookPage.tsx` |
| `/app/settings` | Ayarlar indeksi (ilk görülebilir bölüme gider) | `features/settings/SettingsPage.tsx` |
| `/app/settings/:section` | 33 ayar bölümü (bkz. §1.10) | `features/settings/*.tsx` |
| `/app/settings/audit-log` | Denetim günlüğü | `features/audit/AuditLogPage.tsx` |
| `/app/apps` | Apps marketplace (pilotta yalnız "live" kartlar varsa) | `features/apps/AppsMarketplace.tsx` |
| `/app/developers` | Geliştirici portalı | `features/developers/DeveloperPortal.tsx` |
| `/app/*` | 404 "Page not found" | `components/NotFoundPage.tsx` |

### 1.2 Navigasyon Yapısı (Kabuk)

Dosyalar: `web/src/components/AppShell.tsx`, `components/navigation.ts`, `components/CommandPalette.tsx`, `components/actions.ts`.

- **Sol ikon rayı (MODULES)**: Home (⌂, `reports_read`), Inbox (▤, `chats--*:ro`), Customers (◫), Team (◑), Playbook (✦, yalnız owner/admin — `agents-bot--all`), Reports (◆, `reports_read`).
- **Alt bölüm (FOOTER)**: Billing (◈, pilotta gizli), Settings (⚙), Developers ({}, `access_rules:rw`).
- Ray **daraltılabilir/genişletilebilir**, modüllerde **canlı rozet sayıları** (ör. "Inbox, 3 unread").
- **Uygulama menüsü (marka logosu)**: Apps bağlantısı + **BrandSwitcher** (çoklu marka).
- **Hızlı oluştur (Quick create)** düğmesi, **Invite (+sayaç)** düğmesi, **Çevrimiçi ekip arkadaşları avatarları** (accepting / online-not-accepting).
- **Hesap menüsü**: Dil (English / Türkçe), Tema (Light / Dark), Font (Workspace default / Inter / Nunito / Figtree — kaynak gösterimi: built-in / workspace / kendi seçimin), Sign out.
- **Komut paleti** (Ctrl/Cmd+K): "Go to" (modüller), "Actions" (şu an tek eylem: *Start/Stop Accepting Chats*), canlı arama — **Customers / Conversations / Tickets**, ve **"Ask AI"** (doğal dilde rapor sorusu; kaynak gösterimi).
- **Bannerlar**: Deneme süresi bitti ("Subscribe"), pilot deneme kalan gün (iletişim e-postası ile), **Sandbox çalışma alanı uyarısı**, **dar ekran uyarısı** (<1024 px; "mobil uygulamayı kullanın" / "Continue anyway").
- **Gerçek zamanlı**: tek WebSocket bağlantısı (RTM), yeni mesajda ses + masaüstü bildirimi + sekme başlığında okunmamış sayısı (`features/notifications/*`, `lib/realtime.ts`).
- **Ürün turu** (`components/Tour.tsx`): Inbox'ta "Take tour" bandı, 4 adım (kuyruklar, konuşma, Details/Copilot, müsaitlik).

### 1.3 Onboarding Sihirbazı (`/app/onboarding`)
Adımlar: **Welcome → Website → Channels → Company → Team** (`features/onboarding/OnboardingWizard.tsx`)
- Web sitesi alan adı ekleme (widget için)
- Diğer kanalların tanıtımı (Email, Messenger, WhatsApp, Instagram, Telegram, SMS)
- Şirket büyüklüğü seçimi (1–10 … 1000+)
- E-postayla ekip daveti (virgülle çoklu)
- **Örnek veri ekle** (kayıtlı yanıtlar vb. seed)
- Her adım atlanabilir ("Skip setup").

### 1.4 Home (`/app/home`) — `features/home/HomePage.tsx`
- Karşılama ("Welcome back, {name}")
- **Get started / aktivasyon kontrol listesi** (ilerleme çubuğu): widget kur, ekip arkadaşı davet et, widget'ı özelleştir, kayıtlı yanıt oluştur, AI Agent kur.
- **Right now** (canlı): çevrimiçi ziyaretçi, devam eden sohbet, çevrimiçi ajan.
- **Performance overview** (son 7 gün vs önceki 7): toplam sohbet, memnuniyet, yanıt süresi, verimlilik (ajan başı saatlik sohbet).
- **This week**: yeni sohbet, çözülen, memnuniyet (oylanan sayısı), haftalık değişim.
- Erişim `reports_read` scope'una bağlı; yoksa "Dashboard not available → Go to inbox".

### 1.5 Inbox (`/app/inbox`) — Sohbetler + HelpDesk (Ticket'lar)
Dosyalar: `features/inbox/` (InboxPage, Composer, Transcript, DetailsPanel, CopilotPanel, ThreadHeader, TicketGrid, TicketPane, TicketBulkBar, CreateTicketButton, TypingIndicator, ConflictBanner, Attachment …)

**Sol ray (görünümler)**
- Sohbetler: **All, My chats, Queued, Unassigned, Supervised, Archive**
- **AI Agents**: "AI agent" (AI'ın yürüttüğü), "Solved" (AI'ın kendi çözdüğü)
- **Tickets**: All tickets, Unassigned, My open, Solved, **More** (grid görünümüne kapı)
- **Views**: bağlı **kanal görünümleri** (kanala göre filtre) + **kayıtlı özel görünümler** (adlandır/kaydet/sil, localStorage)
- Kanal tanıtımı ("Connect Messenger, WhatsApp or SMS…")
- **Müsaitlik**: Accepting chats / Not accepting / Offline; bağlantı durumu (Live / Offline / Reconnecting)

**Sohbet listesi**: üst sekmeler (All / Chatting / Queued / Waiting), sıralama Newest/Oldest, kuyruk sırası (#n in queue), okunmamış rozeti, "Load more", sanal liste (`components/VirtualList.tsx`).

**Konuşma başlığı**: durum (Active/Archived), **bağlantıyı kopyala**, Details / Copilot panel geçişi, **Create ticket** (konudan ticket; zaten varsa "Open it").

**Transcript**: müşteri/ajan/AI mesajları ("AI" eki), iç notlar ("Internal note — not sent"), ekler, **gönderilemeyen mesajı yeniden dene**, **gönderilmiş mesajı düzenle** ("edited" etiketi), zengin metin (kalın/italik/liste), **yazıyor göstergesi**, eşzamanlı düzenleme çakışma bandı (ConflictBanner).

**Composer**
- Mod: **Reply** / **Internal note** ("Only your team will see this")
- **Kayıtlı yanıt (canned) seçici** — kısayol ile (#shortcut), ok tuşları + Enter/Tab
- **Boşluk tuşu ile yanıt önerileri** (çip önerileri + Copilot bilgisinden taslak)
- **Dosya ekleme** (tip/boyut sınırı ayarlardan), **emoji seçici** (3 kategori), **zengin metin** (Bold/Italic/Liste)
- **Sohbet etiketleri** (öneri + yeni etiket oluşturma)
- Enter gönder / Shift+Enter yeni satır; arşivli sohbette devre dışı

**Details paneli** (sağ, daraltılabilir)
- Conversation: durum, Chat ID, atanan kişi + **atamayı değiştir** (çevrimdışı uyarısı), kuyruk, başlangıç
- **Tags** (ekle/kaldır), **Teams** (yönlendirilen takım)
- **Apps** (bağlı uygulama kartları; Live/Demo; müşteri kaydı)
- **Visited pages**, **Visit info** (cihaz, referrer, süre, IP)
- **Archive conversation / Reopen conversation**, **Take over** (onaylı devralma)

**Copilot paneli** (`CopilotPanel.tsx`)
- **Summary**: konuşmayı özetle → iç not olarak ekle
- **Suggested reply**: Copilot bilgisinden taslak + kaynak isimleri → "Insert into reply"
- **Improve a draft**: Rephrase / Friendlier / More formal / Fix grammar
- **Ask about your reports**: doğal dil BI sorusu ("How many chats closed this week?")

**Ticket'lar (HelpDesk)**
- **TicketGrid**: kolonlar Subject, Customer, Status, Priority, Assignee, Last message; satır seçimi (max limitli "select all")
- **Toplu işlem çubuğu**: durum ayarla, öncelik ayarla, ata (veya kimse) → "{n} updated, {m} skipped"
- **TicketPane**: konu düzenle, **durum** (Open/Pending/Solved/Closed/Spam), **öncelik** (Urgent/High/Normal/Low), atanan, müşteri, oluşturulma, "From chat"/"Created directly", **özel alanlar**, **takipçiler** (ekle/çıkar), **birleştir (merge)** / **ayır (unmerge)**, **müşteriye e-posta bildirimi** (şablon seçimiyle durum değişikliğinde e-posta)

### 1.6 Customers modülü (sekmeler: Contacts · Real-time · Campaigns · Goals) — `features/customers/CustomersTabs.tsx`

**Contacts (`/app/customers`)** — `CustomersPage.tsx`, `CustomerDetailPanel.tsx`, `CustomersFilters.tsx`
- Arama (ad, e-posta, telefon), segmentler: **All / Leads / Last 30 days / Banned**
- Koşul filtreleri ("+ Add filter"): Country, Active from/until, Has tickets
- Tablo: Name, Email, Phone, Country, Chats, Tickets, Last active (+ "Show in Contacts table" işaretli özel alanlar)
- Detay paneli: ilk görülme, konuşma/ticket/ziyaret sayıları, geri dönen ziyaretçi, ülke, **iletişim bilgisi düzenleme** (ad, e-posta, telefon, kullanıcı adı), **özel alanlar**, **ziyaret edilen sayfalar** ("Came from"), **geçmiş konuşmalar** (link), gruplar
- **Ban / Lift ban**, **Erase this person** (GDPR kalıcı silme, onaylı)

**Real-time traffic (`/app/customers/real-time`)** — `TrafficPage.tsx`, `VisitorPanel.tsx`
- Sekmeler: **All, Chatting, Supervised, Queued, Waiting for reply, Invited, Browsing**
- Tablo: Visitor, Activity, Chatting with (AI/Agent), Actions
- Satır eylemleri: **Start chat** (proaktif), **Supervise chat / Stop supervising**, **Assign chat to me**, View profile, Edit contact
- Filtreler: Activity, Page URL contains, Came from contains, Country, Lead, Team
- Ziyaretçi paneli: ön-sohbet formu cevapları, ziyaret sayfaları; PII gizleme (yetkiye göre)

**Campaigns (`/app/customers/campaigns`)** — `CampaignsPage.tsx`, `CampaignBuilder.tsx`
- Sekmeler: All / Ongoing / Scheduled / Inactive
- Oluştur/düzenle: Ad, **tetikleyici (sayfa URL içerir)**, mesaj, başlangıç/bitiş tarihi (opsiyonel)
- Aç/kapa; istatistik: **Displayed, Chats, Conversion**

**Goals (`/app/customers/goals`)** — `GoalsPage.tsx`, `GoalBuilder.tsx`, `GoalsFunnel.tsx`
- Tür: **Page reached (URL içerir), Sale completed, Lead captured, Chat resolved**
- Aktif/Pasif; **hedef hunisi** (Visitors → Chats → Conversions)

### 1.7 Team modülü (sekmeler: Teammates · AI agents · Teams) — `features/team/`
**Teammates (`/app/team`)** — `TeamPage.tsx`, `TeamMembers.tsx`, `InviteTeammates.tsx`, `RoleMenu.tsx`, `AgentProfile.tsx`, `AgentSkills.tsx`, `WorkSchedule.tsx`
- KPI: ekip sayısı, sohbet kabul eden, toplam kapasite, takımlar, chatbot'lar ("bots never use a seat")
- Filtreler: arama, rol, müsaitlik, 2FA
- Tablo: Name, Role, Availability, Chat limit, 2FA, Skills, Manage
- **Davet** (çoklu e-posta + rol; davet linki kopyala; teslim edilemeyenler listesi; koltuk/seat sınırı uyarısı), **bekleyen davetler** (iptal)
- **Rol değiştir** (yalnız kendi rolü ve altı atanabilir), **Askıya al / Yeniden etkinleştir**
- **Profil**: rol, e-posta, son görülme, takımlar, **eşzamanlı sohbet limiti**
- **Skills (uzmanlık)** atama (beceri tabanlı yönlendirme)
- **Çalışma takvimi** (haftalık saatler + saat dilimi)

**AI agents (`/app/team/ai-agents`)** — `TeamAiAgentsPage.tsx`, `TeamAiPerformance.tsx`, `CopilotKnowledge.tsx`, `RuleBots.tsx`
- Bot hesapları tablosu (durum, koltuk maliyeti "Free")
- **AI agent performance** + **ajan bazında AI kullanımı**
- **Copilot knowledge**: kaynak ekle/sil (Article/FAQ/File/Website; durum Ready/Indexing/Empty; chunk sayısı)
- **Rule bots** (deterministik chatbot): bot ekle/aç-kapa/sil, takıma bağla; kural: *Koşul* (mesajda kelime var / içerir / tam eşit / sayfa URL içerir / mesai açık-kapalı) → *Eylem* (yanıt ver / etiketle / takıma aktar)

**Teams (`/app/team/teams`)** — `TeamsPage.tsx`, `Teams.tsx`, `TeamEditor.tsx`, `CreateTeamButton.tsx`
- Takım oluştur/düzenle/sil (ad, **dil kodu**), **üye yönetimi** + üye önceliği (Primary/First/Normal/Last)

### 1.8 Playbook / AI Agent (`/app/playbook`) — `features/playbook/`
Sekmeler: **Performance · Profile · Skills · Knowledge · Public KB**
- Üst: AI durumu **Answering / Paused**, "Pause all skills" / "Resume", hazır değilse uyarı.
- **Performance** (`AiPerformance.tsx`): Resolution rate, AI chats, CSAT, Transferred (düşük örneklem uyarısı).
- **Profile** (`ProfileForm.tsx`): asistan adı, avatar URL, ton, diller, yanıt uzunluğu (Short/Medium/Long) + **canlı önizleme**.
- **Skills** (`SkillEditor.tsx`): sekmeler All/AI/Workspace/Drafts; arama + filtre (tür, durum, ajan, sahip) + sıralama (A–Z, son güncellenen, en çok kullanılan); aç/kapa.
  - Editör: ad, **doğal dil talimatı → "Compile to steps"**, sürükle-bırak/ok tuşu ile adım sıralama.
  - Adım türleri: **Detect intent, Collect information, Add a tag, Summarise, Send a message (metin veya bilgi tabanından), Transfer to a team**.
  - **Önizleme** (örnek müşteri mesajıyla dene: "Would answer / hand over / do nothing").
  - **Çalışma günlüğü (Run log)**: Answered/Handed over/Did nothing/Failed… + ilgili sohbeti aç.
  - **Şablon galerisi** (Prebuilt / AI / Trending; Popular/Essential rozetleri; bazıları entegrasyon gerektirir) + **Recommended skills**.
- **Knowledge** (`KnowledgeSourceActions.tsx`, `BulkImportForm.tsx`): kaynak türleri **Website (crawl), File (.txt/.md/.csv), Article, FAQ**; düzenle, yeniden indeksle, **otomatik yenileme takvimi**, sil; **CSV toplu içe aktarma** (şablon indir, önizleme, sonuç tablosu).
- **Public KB** (`KbArticleList.tsx`, `KbArticleEditor.tsx`, `KbCategoryManager.tsx`, `KbSettings.tsx`): makale oluştur/düzenle (başlık, slug, kategori, markdown benzeri gövde, özet, **SEO başlık/açıklama**), Publish/Unpublish, kategori yönetimi, KB ayarları (açık/kapalı, public adres slug'ı, site başlığı).

### 1.9 Reports (`/app/reports`) — `features/reports/ReportsPage.tsx` (≈2.900 satır)
Kategoriler ve sekmeler:
- **Performance**: **Overview**, **Reviews**, **Breakdown**
- **AI & automation**: **AI Agent**, **Chat topics**
- **Team & staffing**: **Staffing**, **Team performance**
- **Business**: **Cases** (ticket), **Leads**, **Sales**

İçerik özeti:
- Overview: konuşma/vaka hacmi, kuyruktaki, ulaşılan hedefler, çözüm dağılımı (Manual/Assisted/Automated), saatlik otomatik sohbet, toplam süre, ilk yanıt, konuşma uzunluğu, memnuniyet, negatif oy, **SLA ihlalleri**, ajan bazında, **Top tags**.
- AI Agent: AI çözümleri, çözüm oranı, insana devir oranı, çalıştırılan skill sayısı.
- Reviews: **CSAT** (donut), günlük oylar, **otomatik içgörüler** ("Satisfaction is up…"), e-ticaret satışları.
- Breakdown: gün/ajan/saat/takım/kanal bazında çözüm dağılımı.
- Staffing: UTC saatine göre **gerekli vs planlanan ajan** ısı haritası.
- Chat topics: konu kümeleri + trend.
- Cases: duruma/önceliğe göre, açık/kapalı günlük.
- Leads, Sales (dönüşüm, atfedilen gelir), Team performance (ajan bazında ilk yanıt vb.).
- Araçlar: **tarih aralığı** (preset gün / custom), önceki döneme göre **delta**, **kayıtlı görünümler**, **dışa aktarma CSV/PDF**, **paylaşım linki** (süreli, iptal edilebilir; hesapsız okunur), **anket popover** ("What are you tracking?"), "Chat topics" tanıtım bandı.

### 1.10 Settings (`/app/settings/:section`) — 7 grup, 33 bölüm
Navigasyon + **ayar araması** (etiket ve anahtar kelimeyle): `features/settings/SettingsNav.tsx`, `settings-sections.ts`.

| Grup | Slug (rota) | Bölüm / ne yapılır | Dosya |
|---|---|---|---|
| General | `notifications` | Kendi bildirimleri: aç/kapa, ses, masaüstü (tarayıcı izni), mobil push, e-posta | `NotificationSettings.tsx` |
| General | `company` | Şirket adı, sektör (13 sabit), büyüklük, adres, saat dilimi | `CompanyDetails.tsx` |
| General | `appearance` | Çalışma alanı varsayılan panel fontu (yalnız Owner kaydeder) | `Appearance.tsx` |
| General | `brands` | Çoklu marka (ekle, yeniden adlandır, kaldır, varsayılan) | `Brands.tsx` |
| Channels | `channels` | Kanal kartları: Website widget, Chat page (hosted link), **Email** (yönlendirme adresleri, test mesajı), **Messenger, WhatsApp, SMS (Twilio), Instagram** (mock), **Telegram** (bot token, "Live") | `Channels.tsx` |
| Channels | `website-widgets` | Web sitesi ekle, kurulum yöntemi (manuel / platform), **snippet kopyala**, **geliştiriciyi e-postayla davet et**, bağlantı durumu ("Waiting for first message") | `WebsiteWidgets.tsx` |
| Channels | `widget` | **Widget görünümü**: marka rengi, konum (sağ/sol alt), tema Auto/Light/Dark, mobilde tam ekran, "Powered by" göster/gizle, **karşılama mesajı** (başlık + metin, link desteği), canlı önizleme, sıfırla | `WidgetCustomization.tsx` |
| Channels | `sales-tracker` | Satış takibi aç, para birimi, atıf penceresi (gün) | `SalesTracker.tsx` |
| Routing | `routing-rules` | Sıralı kurallar: sayfa URL içerir + skill → takım, öncelik, fallback kuralı | `RoutingRules.tsx` |
| Routing | `skills` | Uzmanlık alanları (beceri tabanlı yönlendirme) | `Skills.tsx` |
| Routing | `ticket-rules` | Ticket açılınca: konu içerir / kaynak → öncelik ata, etiket ekle, ajana/takıma ata | `TicketRules.tsx` |
| Routing | `sla` | İlk yanıt ve çözüm hedefi (dk), yalnız mesai saatleri | `SlaPolicy.tsx` |
| Inbox | `canned-responses` | Kayıtlı yanıtlar (kısayol + metin, takıma özel) | `CannedResponses.tsx` |
| Inbox | `tags` | Etiketler (takıma özel, kullanım sayısı) | `Tags.tsx` |
| Inbox | `chat-timeout` | Boşta kalan sohbeti otomatik kapat (dk/saat) | `ChatTimeout.tsx` |
| Inbox | `ticket-email-templates` | Markalı ticket e-posta şablonları (değişkenli), aç/kapa | `TicketEmailTemplates.tsx` |
| Inbox | `custom-fields` | Ticket/Contact özel alanları (Text/Number/Yes-No/Date), Contacts tablosunda göster | `CustomFieldsSettings.tsx` |
| Inbox | `chat-forms` | **Pre-chat, Post-chat, Offline (ticket / prospect)** form soruları; alan tipi + zorunluluk | `ChatFormsSettings.tsx` |
| Integrations | `integrations` | Marketplace'e kapı (pilotta gizli) | `Integrations.tsx` |
| Integrations | `mcp` | **MCP sunucu URL'si**, Claude kurulum adımları, örnek prompt, mevcut araçlar | `McpConnection.tsx` |
| Integrations | `personal-access-tokens` | PAT oluştur (ad, süre, scope), iptal | `PersonalAccessTokens.tsx` |
| Integrations | `scheduled-exports` | Rapor grubunu günlük/haftalık/aylık e-postayla gönder, alıcılar, düzenle/iptal | `ScheduledExports.tsx` |
| Integrations | `sandbox` | Sandbox çalışma alanı oluştur/sıfırla (Enterprise) | `Sandbox.tsx` |
| Security | `trusted-domains` | Widget'ın çalışacağı alan adları (alt alan adı dahil) | `TrustedDomains.tsx` |
| Security | `banned-customers` | Engellenen IP adresleri | `BannedCustomerIps.tsx` |
| Security | `file-sharing` | Dosya paylaşımı aç/kapa, izinli MIME türleri, maks. boyut | `FileSharing.tsx` |
| Security | `ip-allowlist` | IP/CIDR izin listesi + zorlama, **oturum politikası** (boşta zaman aşımı, eşzamanlı oturum), **çalışma alanında 2FA zorunlu** | `IpAllowlist.tsx` |
| Security | `sso` | SAML 2.0 bağlantısı (entity id, URL, sertifika, doğrulanmış alan adları + e-posta kodu ile doğrulama, IdP-initiated, **SSO zorunlu**) + **SCIM token'ları** | `SsoConnection.tsx` |
| Security | `two-factor` | Kendi 2FA'sı (TOTP kurulum, kurtarma kodları indir, yenile, kapat) | `TwoFactor.tsx` |
| Security | `compliance` | Veri bölgesi (EU/US, sabit), **HIPAA BAA kabul** | `Compliance.tsx` |
| Security | `data-retention` | Kapalı konuşma ve ziyaretçi verisi saklama süresi (30/60/365 gün/sınırsız) | `DataRetention.tsx` |
| Security | `audit-log` → `/app/settings/audit-log` | Denetim günlüğü: aksiyon filtresi, tarih aralığı, detay (hash zinciri pozisyonu), **Access review CSV** (üyeler, kimlik bilgileri) | `features/audit/AuditLogPage.tsx`, `AccessReviewExport.tsx` |
| Security | `siem` | SIEM dışa aktarma (hedef, son çalışma, zincir boşluğu uyarısı) | `SiemExport.tsx` |
| Billing | `billing` → `/app/billing` | Faturalama sayfasına link | |

Not: PRD'deki "Desktop app" bölümü bilerek yok.

### 1.11 Billing (`/app/billing`) — `features/billing/BillingPage.tsx`
- Plan KPI'ları (plan: Growth/Enterprise, koltuk, tahmini toplam, durum Trial/Active/Past due)
- **Plan yönetimi**: plan seviyesi, aylık/yıllık (yıllık tasarruf), koltuk +/−, minimum koltuk
- **AI resolutions sayacı** (kota çubuğu, %uyarı, aşım paketi satın alma)
- **API çağrıları** sayacı + **API paketleri** satın alma + satın alma geçmişi
- **Ödeme yöntemi** (mock; kart markası, son 4 hane, son kullanma, kart sahibi)
- **Faturalar** (indir; Paid/Open/Trial; Estimate/Reconstructed)
- Deneme bitti → **salt okunur çalışma alanı** uyarısı. Sağlayıcı: mock/demo.

### 1.12 Apps Marketplace (`/app/apps`) — `features/apps/AppsMarketplace.tsx`
- Arama + filtreler: **Kategori** (CRM, Support, E-commerce, Payments, Marketing, Productivity, Analytics, Channels), **Koleksiyon** (By Text, AI-Powered, New, Staff Picks), **Fiyat** (Free/Paid), **Yerleşim** (Details panel / Fullscreen / Messagebox)
- Kart: Connected/Not connected, **Connect** (OAuth izin onayı veya API anahtarı), Disconnect, Reconnect, **Live/Demo** rozeti, otomasyon tetik sayısı/son çalışma; ör. Freshdesk alt alan adı.

### 1.13 Developers (`/app/developers`) — `features/developers/DeveloperPortal.tsx`, `WebhookSubscriptions.tsx`
Sekmeler: **Apps** (OAuth istemcisi kaydı: public PKCE / confidential; redirect URI'ler, scope'lar; düzenle, **secret döndür**, sil), **Webhooks** (URL + olay, workspace-wide/bot-scoped, otomasyon uygulaması üzerinden; imzalama sırrı tek seferlik), **Manifest** (Zapier/Make tetikleyici ve eylemleri, REST Hooks).

### 1.14 Rol Bazlı UI Farkları
- Roller: **Owner, Vice owner, Admin, Agent** (`team.role.*`).
- Gizleme mekanizması: `navigation.ts` ve `settings-sections.ts` içindeki `scope` listeleri + `hasAnyScope`. Örnekler:
  - Agent: Inbox, Customers, Team (salt okunur kadro), Settings → Notifications, Two-factor, Tags, Canned responses, (ticket şablonları okuma). Playbook, Reports/Home (`reports_read` yoksa), Billing, Developers, güvenlik/kanal ayarlarının çoğu görünmez.
  - Admin/Vice owner: `access_rules` ile kanal, widget, yönlendirme, güvenlik bölümleri.
  - **Yalnız Owner**: workspace fontu kaydetme, SSO bağlantısı ekleme/değiştirme, BAA kabulü, sandbox oluştur/sıfırla. KB ayarları: admin/vice owner/owner.
  - Rol değişikliğinde "yalnız kendi rolün ve altı" kuralı (`RoleMenu.tsx`).
  - PII gizleme: yetkisi olmayan ajan için ziyaretçi iletişim bilgileri gizli (`traffic.panel.piiHidden`).
- **Pilot modu**: Billing, Apps (live kart yoksa), Integrations, mock kanal anahtar kelimeleri gizli.

### 1.15 i18n, Tema, Font, Erişilebilirlik (Web)
- **Diller**: English, Türkçe (`web/src/lib/i18n.ts`, `web/src/locales/{en,tr}/*.ts` — 14 namespace: apps, audit, audit-labels, auth, billing, common, customers, home, inbox, playbook, reports, settings, shell, team). Tarayıcıdan algılama; eksik anahtar İngilizce'ye düşer; çoğul formlar (`.one/.other`).
- **Tema**: Light (varsayılan, 2026-10-12'den beri) / Dark — `lib/theme.ts`, `styles/tokens.css` (WCAG AA'ya kilitli renk rampaları).
- **Font presetleri**: Inter (varsayılan), Nunito, Figtree; kullanıcı seçimi > çalışma alanı varsayılanı > yerleşik (`lib/font.ts`, `components/FontPicker.tsx`).
- **Erişilebilirlik**: "Skip to content" linki, ARIA etiketli ray rozetleri, `aria-live` bölgeleri, klavye ile tam palet/dropdown/modal (Esc, ok tuşları, Home/End), adım sıralamada ok tuşu alternatifi + ekran okuyucu duyurusu, `prefers-reduced-motion` (tokens.css), modal odak yönetimi, `inert` ile yeniden bağlanma katmanı, kaydedilmemiş değişiklik koruması (`lib/dirty-guard.tsx`), a11y testi (e2e Playwright, route pin).
- **Boş durumlar / iskeletler / hata**: `EmptyState`, `Skeleton`, `LoadError` her listede.

---

## 2. Müşteri Widget'ı (`apps/widget`)

Dosyalar: `widget/src/loader.ts` (host sayfadaki tek script), `widget/src/widget.ts` (iframe içindeki UI), `socket.ts`, `api.ts`, `i18n.ts`, `rich-text.ts`, `emoji.ts`, `locales/*.ts`; HTML: `widget.html` (iframe), `chat.html` (**hosted Chat page**), `demo.html`.

### 2.1 Kurulum ve JS API
- Snippet: `window.__siyahtus = { organizationId, widgetOrigin, position, language, primaryColor, theme, mobileFullscreen, poweredBy }`.
- Komutlar: `open()`, `close()`, `destroy()`, `siyahtus('trackSale', {...})` (satış atfı).
- Güvenlik: **sandbox'lı cross-origin iframe**, beyaz listeli postMessage protokolü (`ready/resize/open/close`), `innerHTML` yok.
- Mobil (<480 px) algılama; RTL dilde konum aynalanır.

### 2.2 Özellikler
| Özellik | Durum |
|---|---|
| Launcher (balon) + **okunmamış rozeti** (localStorage watermark) | Var |
| **Greeting kartı** ("Hi there 👋…", "Let's chat" / "Just browsing", kapatma hatırlanır) | Var |
| **Karşılama mesajı** (panelden başlık+metin, link) | Var |
| **Pre-chat formu** (ad, kullanıcı adı, e-posta, mesaj + özel sorular) | Var |
| **Kuyruk pozisyonu** ("You are number {n} in the queue") | Var |
| **Çevrimdışı mesaj formu** (kimse yoksa → ticket / prospect; konu, ad, e-posta) | Var |
| Mesajlaşma: zengin metin (bold/italic/liste), **AI mesaj etiketi**, "edited" işareti, zaman damgası, ajan avatarı/baş harfi | Var |
| **Yazıyor göstergesi** (isimli/genel) | Var |
| **Dosya ekleme** (tip/boyut reddi mesajları) + ek önizleme | Var |
| **Emoji seçici** (3 kategori) | Var |
| **Sohbet puanlama** good/bad + menüden erken "Rate this chat" + teşekkür | Var |
| **Post-chat formu** | Var |
| **Sohbeti bitir** (onaylı) + "Start new" | Var |
| **Kampanya** (proaktif mesaj, dismiss hatırlanır) | Var |
| **Satış takibi** (`trackSale`) | Var |
| Bağlantı kopması bandı, hata mesajları (rate limit, read-only) | Var |
| Tema: Auto/Light/Dark, marka rengi, sol/sağ alt konum, mobilde tam ekran | Var |
| "Powered by SiyahTuş" (kaldırılabilir), Privacy linki | Var |
| **Hosted Chat page** (`chat.html`, tam sayfa sohbet linki) | Var |
| Diller: **en, tr, de, fr, es, it, pt, ar** (ar = RTL, mantıksal CSS) | Var |
| Self-servis KB arama widget içinde | Yok (Public KB ayrı; widget'ta "browse" yalnız kapatma) |
| Ses bildirimi / tarayıcı bildirimi (ziyaretçi tarafı) | Yok |
| Okundu bilgisi (read receipt) | Yok |
| Transcript'i e-postayla gönder | Bulunamadı |

---

## 3. Mobil Uygulama (`apps/mobile`, Expo / React Native)

Dosyalar: `mobile/src/app/RootNavigator.tsx`, `app/navigation.ts`, `app/stacks/*`, `features/*`.

**Kimlik doğrulama** (`features/auth/`): SignIn (e-posta/şifre, **Continue with SSO** — sistem tarayıcısı + PKCE), WorkspacePicker, güvenli saklama (`auth/secure-store.ts`), cihaz token'ı, **Switch account** (çoklu hesap).

**Alt sekmeler (4)**: Inbox · Customers · Reports · Settings

| Ekran | İçerik | Dosya |
|---|---|---|
| InboxHome | Sohbet listesi (son aktiviteye göre), okunmamış, bağlantı bandı | `features/inbox/ChatListScreen.tsx`, `ConnectionBanner.tsx` |
| ChatDetail | Transcript + composer (**Reply / Internal note** tek alan iki mod; yalnız metin, ek yok) | `ChatScreen.tsx`, `Composer.tsx`, `Transcript.tsx` |
| ChatCopilot | Konuşmayı özetle (iç not), yanıt taslağı → "Insert into reply" | `features/copilot/CopilotScreen.tsx` |
| CustomersHome / CustomerDetail | Arama + segment, sonsuz kaydırma; Lead/Banned rozetleri, iletişim, sayılar (salt okunur) | `features/customers/*` |
| ReportsHome | Son 30 gün: hacim, çözüm dağılımı, süreler, ilk yanıt, memnuniyet, SLA ihlali | `features/reports/ReportsScreen.tsx` |
| SettingsHome = Notifications | Bildirim aç/kapa, ses, push, masaüstü, e-posta | `features/notifications/NotificationsScreen.tsx` |
| TeamList / TeamMember / TeamGroups | Ekip (askıda rozeti, eşzamanlı limit, 2FA, uzmanlık, çalışma takvimi), takımlar — salt okunur | `features/team/*` |
| SkillList / SkillDetail / KnowledgeSources | Playbook skill'leri (talimat, son çalışmalar), Copilot kaynakları — salt okunur | `features/playbook/*` |
| Billing | Plan, döngü, koltuk, AI çözümleri, API çağrıları, faturalar — salt okunur | `features/billing/BillingScreen.tsx` |
| Account | E-posta, çalışma alanı, hesap değiştir, çıkış | `features/account/AccountScreen.tsx` |

Diğer: **Push bildirimleri** (Expo; dokunulunca ilgili sohbete yönlendirme, oturum açılana dek bekletme — `notifications/routing.ts`), deep link şeması `siyahtus://`, gerçek zamanlı RTM istemcisi, bağlantı izleme, ErrorBoundary, ConfigErrorScreen.
**Tema**: OS açık/koyu modunu takip eder (`theme/theme.tsx`). **Dil**: yalnız İngilizce (sabit metinler, i18n katalogu yok). Erişilebilirlik: `accessibilityLabel`'lar mevcut.
Mobilde **olmayanlar**: Traffic, Campaigns, Goals, ticket yönetimi, ayarların yazma işlemleri, dosya ekleme, kayıtlı yanıt seçici, rapor sekmeleri.

---

## 4. LiveChat Bölümleriyle Yan Yana Karşılaştırma

| LiveChat bölümü | SiyahTuş'ta var mı? | Nerede (rota / dosya) | Not / eksik |
|---|---|---|---|
| **Home** (dashboard, onboarding checklist) | Var | `/app/home` — `features/home/HomePage.tsx`; `/app/onboarding` | Aktivasyon listesi, canlı sayaçlar, haftalık KPI |
| **Chats** (inbox, my chats, queued, supervised, unassigned) | Var | `/app/inbox` — `features/inbox/*` | Not, canned, emoji, dosya, etiket, devralma, düzenleme, Copilot. Inbox içinde metin araması yok (komut paleti ile arama var) |
| Chats → Customer details / visitor info | Var | `DetailsPanel.tsx`, `CustomerDetailPanel.tsx` | Ziyaret sayfaları, cihaz, referrer, süre, IP, app kartları |
| Chats → Supervise / whisper | Kısmen | Traffic "Supervise chat", Inbox "Supervised" görünümü | Ayrı "whisper" modu yerine iç not |
| **Engage → Traffic** | Var | `/app/customers/real-time` — `features/traffic/*` | 7 durum sekmesi, filtreler, proaktif "Start chat" |
| **Engage → Campaigns** (greetings) | Var (basit) | `/app/customers/campaigns` | Tetik: yalnız URL içerir + tarih aralığı; LiveChat'teki zengin tetikleyiciler (süre, kaynak, davranış) yok |
| **Engage → Goals** | Var | `/app/customers/goals` | 4 hedef türü + huni |
| Engage → Sales tracker | Var | `/app/settings/sales-tracker` + widget `trackSale` | |
| **Automate → Chatbot / AI Agent** | Var | `/app/playbook` (Skills, Profile, Knowledge, Performance), `/app/team/ai-agents` (Rule bots) | Adım tabanlı skill editörü, şablon galerisi, önizleme, run log |
| Automate → Copilot | Var | Inbox `CopilotPanel.tsx`, `team/CopilotKnowledge.tsx`, mobil `CopilotScreen` | Özet, taslak, ton iyileştirme, BI sorusu |
| Automate → Knowledge (KB) | Var | Playbook → Knowledge + Public KB | Website crawl, dosya, FAQ, CSV toplu içe aktarma, SEO'lu public KB |
| Automate → Workflows / routing | Var | Settings: `routing-rules`, `skills`, `ticket-rules`, `chat-timeout`, `sla` | Görsel workflow builder yok; kural listeleri |
| **Archives** | Kısmen | Inbox → "Archive" görünümü; müşteri detayında geçmiş konuşmalar | Ayrı Archives sayfası, gelişmiş arama/filtre (tarih, etiket, puan, ajan) yok |
| **Team** (agents, groups, roles, bots) | Var | `/app/team`, `/app/team/teams`, `/app/team/ai-agents` | Davet, roller, askıya alma, chat limiti, skills, çalışma takvimi |
| **Reports** | Var (geniş) | `/app/reports` — 10 sekme | CSV/PDF export, paylaşım linki, kayıtlı görünüm, planlı e-posta export |
| **Apps / Marketplace** | Var (çoğu demo) | `/app/apps`, `/app/developers`, Settings → `integrations`, `mcp` | OAuth/API key bağlantı; Live vs Demo; Zapier/Make manifest, webhooks |
| **HelpDesk / Tickets** | Var (Inbox içinde) | Inbox → Tickets (grid, pane, toplu işlem) | Durum, öncelik, takipçi, birleştir, e-posta şablonu, özel alan, ticket kuralları; e-posta kanalı |
| **Billing** | Var (mock) | `/app/billing` (pilotta gizli); mobil salt okunur | Plan, koltuk, AI/API kotaları, paketler, fatura |
| **Settings → Chat widget (customization)** | Var | `settings/widget`, `settings/website-widgets` | Renk, konum, tema, mobil tam ekran, branding, karşılama mesajı, önizleme. Logo/özel ikon/yükseklik ayarı yok |
| Settings → Forms (pre/post-chat, ticket) | Var | `settings/chat-forms` | Alan türleri text/number/boolean/date |
| Settings → Channels | Var (çoğu mock) | `settings/channels` | Website, Chat page, Email (gerçek), Telegram (live); Messenger/WhatsApp/SMS/Instagram mock |
| Settings → Canned responses | Var | `settings/canned-responses` | Takıma özel |
| Settings → Tags | Var | `settings/tags` | Takıma özel |
| Settings → Security (2FA, SSO, IP, banned) | Var | `two-factor`, `sso` (+SCIM), `ip-allowlist`, `banned-customers`, `trusted-domains`, `file-sharing`, `compliance`, `data-retention`, `audit-log`, `siem` | LiveChat'ten kapsamlı |
| Settings → Notifications | Var | `settings/notifications`, mobil Settings | Ses, masaüstü, push, e-posta |
| Settings → Multi-brand | Var | `settings/brands` + BrandSwitcher | |
| Settings → Language of widget | Kısmen | Snippet `language` parametresi | Panelde widget dili seçimi UI'ı bulunamadı |
| Desktop app | Yok | — | Bilerek yok (PRD 08.4) |
| Mobil uygulama | Var | `apps/mobile` | Ajan odaklı, çoğu yönetim salt okunur |
| Komut paleti / Ask AI | Var (ekstra) | `components/CommandPalette.tsx` | |
| Sandbox, PAT, MCP, SIEM, BAA | Var (ekstra) | Settings → Integrations / Security | LiveChat'te olmayan/enterprise özellikler |

---

## 5. Dikkat Çeken Boşluklar (UI açısından)
1. **Archives** ayrı modül değil; sohbet geçmişinde gelişmiş arama/filtre yok.
2. **Kampanya tetikleyicileri** yalnız URL eşleşmesi (+tarih); hedef kitle segmentasyonu/zamanlama kuralları yok.
3. **Kanalların çoğu mock** (Messenger, WhatsApp, SMS, Instagram); pilotta yalnız Website + Chat page.
4. **Widget'ta** KB araması, ses bildirimi, okundu bilgisi, transcript e-postası yok; logo/ikon özelleştirmesi yok.
5. **Mobil** yalnız İngilizce, dosya ekleme yok, ticket/traffic/campaign yok.
6. **Web paneli** yalnız EN/TR; widget 8 dil.
7. Komut paleti eylem kataloğu şimdilik tek eylem.


---
<a id="3"></a>

# 01 — Backend ve Gerçek Zamanlı Katman: Özellik Envanteri

> Kapsam: `apps/api`, `apps/rtm`, `packages/contract`, `packages/types`, `packages/ai-mock`, `infra/db` + `apps/api/prisma` (şema/migration).
> Yöntem: Salt okunur statik analiz (build/test/migration çalıştırılmadı). Uç nokta listesi `packages/contract/openapi/openapi.yaml` + `paths/*.yaml` ayrıştırılarak çıkarıldı ve `apps/api/src/routes/*.ts` içindeki route kayıtlarıyla karşılaştırıldı: **her iki tarafta da 313 operasyon var, birebir eşleşiyor** (contract ↔ kod sapması yok).
> Gizli bilgiler okunmadı. Var olduğu not edilen dosyalar: `apps/api/.env`, `apps/api/.env.example`, `apps/api/.env.production.example`, `secrets/acme-ai-entegrasyon.pat`. Ayrıca `apps/api/.data/` altında mock sağlayıcıların disk çıktıları var (≈10 bin `mail` dosyası, `uploads/`, `siem/`).

---

## 0. Mimari özeti

| Bileşen | Teknoloji | Not |
|---|---|---|
| REST API | Fastify 5, Zod, Prisma 6, ioredis, pino | `apps/api/src/server.ts` — tüm route'lar `/api/v1` öneki altında |
| RTM (WebSocket ağ geçidi) | `ws` 8, ioredis pub/sub, Prisma | `apps/rtm/src/server.ts` — varsayılan port 4001 |
| Veritabanı | PostgreSQL 17 + pgvector (`pgvector/pgvector:pg17`), `pgcrypto`, `citext`, `vector` | `infra/db/init/00-extensions.sql`, `apps/api/prisma/schema.prisma` |
| Önbellek / pub-sub / rate limit | Redis 7 | |
| Nesne depolama | yerel disk veya S3 (dev'de MinIO) | `docker-compose.yml` |
| Kontrat | OpenAPI 3.1 (`packages/contract/openapi`), `openapi-typescript` ile üretilen `src/generated/api.ts` | `pnpm contract:generate` |
| Paylaşılan tipler | `packages/types` (scope'lar, roller, RTM protokolü, domain enum'ları, entitlement'lar, uygulama kataloğu…) | API ve RTM aynı kuralı buradan okur |
| Yapay zekâ stub'ı | `packages/ai-mock` (deterministik, LLM'siz) | Varsayılan sağlayıcı `mock` |
| Telemetri | OpenTelemetry (console / OTLP exporter) | `apps/api/src/telemetry/telemetry.ts`, `apps/rtm/src/telemetry/telemetry.ts` |
| Dağıtım | Dockerfile'lar, `docker-compose.{,full,pilot}.yml`, `infra/helm/siyahtus`, `infra/pilot` (Caddy, cloudflared) | |

**Tasarım ilkeleri (koddan / kontrattan):** kaynak tabanlı REST (ADR-04, eylemler `POST /resource/{id}/verb`), tek hata zarfı `{ error: { type, message, request_id } }` (`apps/api/src/lib/api-error.ts`, `packages/types/src/errors.ts`), opak keyset cursor sayfalama, her route'un gerekli scope'u deklare etmesi, sohbet mutasyonlarının yalnızca REST'ten yapılması (RTM sadece okuma/abonelik/typing).

**Plugin zinciri (sıra önemli — `apps/api/src/server.ts`):** `errorHandler` → `lifecycle` (graceful drain) → `telemetry` → `sensible` → `helmet` (CSP `default-src 'none'`) → `cors` (prod'da `WEB_ORIGIN` listesi) → `database` → `redis` → `scheduler` → `backgroundMail` → `followUps` → **`rateLimit` (auth'tan önce)** → `auth` → `audit` → `aiResidency` → `licenseGate` → `entitlementGate` → `sandboxGate` → `aiBudget` → `pilotGate` → `metering` → route'lar. Body limiti 1 MiB (ekler imzalı upload URL'leri ile).

---

## 1. Çok kiracılık (multi-tenancy) ve bölge modeli

- **Hiyerarşi:** `Organization` (kiracı kökü, `region`, şirket bilgileri) → `License` (= "workspace"; plan, deneme, onboarding, HIPAA BAA, retention pencereleri, sandbox bağlantısı) → neredeyse tüm tablolar `license_id` taşır. `Customer` organizasyon düzeyinde.
- **Satır düzeyi güvenlik (RLS):** 42 migration dosyası `ENABLE ROW LEVEL SECURITY` içerir; politikalar `current_setting('app.current_license' | 'app.current_organization' | 'app.current_brand')` okur. Uygulama `siyahtus_app` rolüyle bağlanır (`infra/db/init/00-extensions.sql`, `infra/db/pilot/10-app-role-password.sh`).
- **`withTenant` / `withTenantRead`** (`apps/api/src/lib/tenant.ts`): her istek bir transaction içinde `set_config(...)` ile kiracı bağlamını ayarlar; okuma için `SET TRANSACTION READ ONLY`; 10 sn transaction zaman aşımı. Opsiyonel okuma replikası: `DATABASE_REPLICA_URL`.
- **Token çözümleme** `auth_resolve_token` adlı SECURITY DEFINER SQL fonksiyonu üzerinden (`apps/api/src/services/auth/token-service.ts`).
- **Multibrand:** `Brand` tablosu; `Channel`, `Website`, `SecuritySettings`, `InboxSettings`, `WidgetSettings` marka bazlı olabilir (`app.current_brand`).
- **Veri yerleşimi (NFR-C4):** bölgeler `eu` | `us` (`SIYAHTUS_REGION`, varsayılan `eu`). Workspace oluşturulurken bölgesi sabitlenir; yanlış bölgeye gelen her kimlik doğrulamalı istek `421 misdirected_request` + `details.region` döner. `X-Region` başlığı desteklenir. RTM `login` aynı kuralı uygular. `POST /auth/signup` bölgeyi yazma öncesi reddeder.
- **Sandbox:** ayrı bir Organization+License (ikinci kiracı), `licenses.sandbox_of_license_id` ile bağlı (`apps/api/src/services/billing/sandbox-service.ts`); `sandboxGate` sandbox'ta `/billing/` yazmalarını reddeder.
- **`events` tablosu aylık RANGE partition** (`events_default` yakalayıcı partition), bakım: `apps/api/src/services/chat/event-partitions.ts`.

---

## 2. Kimlik doğrulama, roller ve yetki modeli

### 2.1 Principal türleri (`apps/api/src/services/auth/principal.ts`)
| Tür | Kaynak | Not |
|---|---|---|
| `agent` | OAuth 2.1 access token veya PAT | Varsayılan route principal'ı `agent` + `bot` |
| `bot` | Bot tokenı (`TOKEN_KINDS = pat, oauth, bot`) | |
| `customer` | Widget müşteri tokenı (HMAC imzalı, durumsuz, iptal edilemez; TTL varsayılan 8 saat) | `apps/api/src/services/auth/customer-token.ts` |
| `scim` | SCIM provisioning tokenı | Yalnızca `/scim/v2`, `sso` entitlement'ı gerekir |
| `enrollment` | 2FA kayıt bileti | Zorunlu 2FA akışında kısa ömürlü |

### 2.2 Kimlik bilgisi mekanizmaları
- **OAuth 2.1 Authorization Code + PKCE (yalnızca S256)**, birebir redirect URI eşleşmesi, refresh token rotasyonu (aile/familyId, yeniden kullanımda iptal) — `apps/api/src/services/auth/oauth-service.ts`. TTL'ler: access ≤3600 sn (vars. 3600), refresh 30 gün, auth code ≤600 sn (vars. 120).
- **Personal Access Token (PAT)**: Basic `base64(account_id:pat)`; oturumun sahip olmadığı scope ile PAT basılamaz. PAT'lerle yapılan başarılı çağrılar **faturalanan API çağrısı** olarak sayılır (`apps/api/src/plugins/metering.ts`).
- Tokenlar opak, veritabanında yalnızca SHA-256 özeti tutulur. Parolalar **scrypt** ile hash'lenir (`apps/api/src/lib/crypto.ts`).
- **2FA (TOTP)** + kurtarma kodları (`apps/api/src/lib/totp.ts`, `services/auth/two-factor-service.ts`); workspace `requireTwoFactor` zorlayabilir.
- **SAML 2.0 SSO** (SP-initiated + opsiyonel IdP-initiated, sertifika rotasyonu, alan adı doğrulama e-postası, `enforced` bayrağı) — `xml-crypto` v6 + `@xmldom/xmldom`, algoritma allow-list ve XSW koruması (`apps/api/src/lib/saml.ts`, `saml-sp.ts`, `routes/saml.ts`). Test için `apps/api/scripts/mock-idp-server.ts`.
- **SCIM 2.0** (RFC 7643/7644) Users/Groups; `PUT /Users/{id}` bilinçli olarak uygulanmamış (`apps/api/src/routes/scim.ts`).
- **Partner uygulamaları:** workspace'e kayıtlı OAuth 2.1 istemcileri (secret rotasyonu).

### 2.3 Roller (kaba eksen) — `packages/types/src/role-scopes.ts`
`owner (3) > viceowner (2) > admin (1) > agent (0)`. Route'lar `minimumRole` / `exactRole` deklare edebilir; rol her istekte üyelikten taze okunur.

### 2.4 Scope'lar (ince eksen) — `packages/types/src/scopes.ts`
70 scope tanımlı; desen `kaynak--erişim:izin` (`erişim` ∈ `my|groups|access|all`, `izin` ∈ `ro|rw|rc`). `--all` alt erişimleri, `rw` de `ro`/`rc`'yi kapsar (`expandScope`).
- **Varsayılan agent scope'ları:** `accounts--my:rw`, `agents--my:rw`, `chats--access:rw`, `tickets--access:rw`, `customers:ro`, `groups--my:ro`, `tags--groups:ro`, `canned_responses--groups:ro`, `brands--all:ro`.
- **Admin/owner ek scope'ları:** `accounts--all:rw`, `agents--all:rw`, `agents-bot--all:rw` (AI ajan/skill/bilgi tabanı/KB/rule bot yönetimi), `chats--all:rw`, `tickets--all:rw`, `customers:rw`, `customers.ban:rw`, `customers.erase:rw`, `groups--all:rw`, `tags--all:rw`, `canned_responses--all:rw`, `webhooks--all:rw`, `channels--all:rw`, `access_rules:rw` (çoğu ayar ekranı), `organization--my:rw`, `brands--all:rw`, `properties.configuration:rw`, `audit_log--all:ro`, `audit_log--export:ro`, `reports_read`, `reports_manage`, `billing_manage`.
- Tanımlı ama hiçbir role varsayılan verilmeyen scope'lar: `billing_admin`, `billing--all:rw`, `ledger_read`, `multicast:rw`, `webhooks.state/configuration`, `properties.license/group.value...`, `sessions--my:*`, `accounts.roles*` vb. (kaynak platformdan kopyalanmış katalog).
- **`scopesWithinRole`**: oturum tokenlarının scope'ları her istekte rolün güncel tavanıyla kesiştirilir (rol düşürme anında etkili); PAT'lere uygulanmaz (onları `minimumRole` korur).
- **Sohbet görünürlüğü** iki kapılı: token scope'u (`chats--all` vs `chats--access`) + kişinin takım üyeliği (`apps/api/src/services/chat/access.ts`).

### 2.5 Ek erişim kapıları
| Kapı | Dosya | Davranış |
|---|---|---|
| IP allow-list (agent paneli) | `apps/api/src/lib/ip-allowlist.ts`, `plugins/auth.ts` | `ipAllowlistEnforced` açıksa sadece listedeki IP/CIDR'lar; customer ve scim muaf |
| Müşteri IP yasağı | `apps/api/src/lib/banned-ip.ts` | `SecuritySettings.bannedCustomerIps` |
| Güvenilir domainler | `TrustedDomain`, `lib/origin.ts` | Widget'ın gömülebileceği domainler (müşteri tokenı basılırken Origin kontrolü) |
| Lisans kapısı | `plugins/license-gate.ts` | Deneme bitmiş/`read_only` lisansta tüm yazma metodları reddedilir |
| Entitlement kapısı | `plugins/entitlement-gate.ts`, `lib/entitlements.ts` | Plan kapsamı dışı özellikler (bkz. §12) |
| Sandbox kapısı | `plugins/sandbox-gate.ts` | Sandbox'ta faturalama yazmaları yok |
| AI bölge kapısı (HIPAA) | `plugins/ai-residency.ts`, `services/ai/inference.ts` | BAA imzalı workspace'te model sağlayıcı farklı bölgedeyse `aiInference: true` route'lar `403 not_allowed` |
| AI günlük bütçe | `plugins/ai-budget.ts`, `services/ai/ai-daily-budget.ts` | Workspace ve deployment başına günlük token tavanı |
| Pilot kapısı | `plugins/pilot-gate.ts` | `PILOT_MODE=true` iken `/billing/*` yazmaları, kanal bağla/gönder/webhook, app OAuth/connect, `POST /onboarding/seed-demo`, `POST /settings/compliance/baa` reddedilir (canlı sağlayıcılar hariç) |

---

## 3. REST API uç noktaları (313 operasyon)

Taban: `http://localhost:4000/api/v1` (prod: `https://api.siyahtus.example/api/v1`). "Scope" sütunu route config'inden; boş = public / müşteri tokenı / özel kontrol.

### 3.1 Sistem
| Metot | Yol | Amaç | Yetki |
|---|---|---|---|
| GET | `/health` | Canlılık + bağımlılık kontrolü (detay admin'e kısıtlı) | public |
| GET | `/health/live` | Liveness probu | public |
| GET | `/health/ready` | Readiness probu (drain durumunu ayırt eder) | public |
| GET | `/deployment` | Giriş öncesi panelin okuduğu deployment ayarları (signup açık mı, pilot, gizlilik/şartlar URL'leri vb.) | public |

Kaynak: `apps/api/src/routes/health.ts`, `deployment.ts`.

### 3.2 Kimlik doğrulama ve hesap yaşam döngüsü
| Metot | Yol | Amaç | Yetki |
|---|---|---|---|
| POST | `/auth/login` | Kimlik bilgisi doğrula, erişilebilir workspace'leri listele | public |
| POST | `/auth/authorize` | Tek kullanımlık yetkilendirme kodu üret (PKCE) | login sonrası |
| POST | `/auth/token` | Kodu token ile değiştir / refresh token döndür | public (IP limiti 300/dk) |
| POST | `/auth/revoke` | Access/refresh token iptali | |
| GET | `/auth/me` | Çağıranı tanımla | |
| GET | `/auth/sso/{connectionId}` | Bir SSO bağlantısıyla girişi başlatmak için gereken bilgi | public |
| GET | `/auth/saml/{connectionId}/login` | IdP'ye yönlendirerek federasyonlu girişi başlat | public |
| POST | `/auth/saml/{connectionId}/acs` | SAML assertion'ı tüket, girişi tamamla (form post) | public |
| POST | `/auth/signup` | Workspace + ilk owner oluştur (bölge kararı) | public, 10/saat |
| POST | `/auth/password-reset` | Sıfırlama bağlantısı iste (arka planda e-posta) | public |
| POST | `/auth/password-reset/confirm` | Token ile yeni parola | public |
| POST | `/auth/verify-email` | Yeni owner e-postasını doğrula (token + parola) | public |
| POST | `/auth/verify-email/resend` | Doğrulama bağlantısını yeniden gönder | public |
| GET | `/auth/invitations/preview` | Davet kabul öncesi önizleme | public |
| POST | `/auth/invitations/accept` | Davet tokenı ile workspace'e katıl | public |
| GET | `/invitations` | Kabul edilmemiş davetler | `accounts--all:rw` |
| POST | `/invitations` | E-postayla ekip arkadaşı davet et | `accounts--all:rw` |
| DELETE | `/invitations/{invitationId}` | Bekleyen daveti iptal et | `accounts--all:rw` |
| POST | `/auth/2fa/enroll` | 2FA kaydını başlat | `accounts--my:rw` |
| POST | `/auth/2fa/activate` | Kodu doğrulayarak 2FA'yı etkinleştir | `accounts--my:rw` |
| DELETE | `/auth/2fa` | 2FA'yı kapat | `accounts--my:rw` |
| POST | `/auth/2fa/recovery-codes` | Yeni kurtarma kodu seti | `accounts--my:rw` |
| GET | `/auth/personal-access-tokens` | Kendi PAT'lerini listele | `accounts--my:ro` |
| POST | `/auth/personal-access-tokens` | PAT oluştur | `accounts--my:rw` |
| DELETE | `/auth/personal-access-tokens/{tokenId}` | PAT iptal et | `accounts--my:rw` |
| POST | `/customer/token` | Widget (müşteri) tokenı bas — Origin/trusted-domain kontrolü, RTM URL'si döner | public |

Kaynak: `routes/auth.ts`, `routes/account-lifecycle.ts`, `routes/saml.ts`; servisler `services/auth/*`.

### 3.3 Sohbetler (agent tarafı)
Model: **chat → thread → event**. Bir müşteri+lisans için en fazla bir aktif chat (kısmi unique index); thread kapanınca arşivlenir, müşteri dönünce aynı chat'te yeni thread. Event tipleri: `message`, `system_message`, `rich_message`, `file`, `filled_form`; yazar tipleri `agent|customer|bot|system`; alıcı `all|agents` (dahili not). Transfer nedenleri: `manual`, `routing`, `agent_disconnected`, `ai_handoff`, `bot_handoff`.

| Metot | Yol | Amaç | Scope |
|---|---|---|---|
| GET | `/chats` | Sohbet listesi; `view` = all/my/queued/unassigned/supervised/archived/ai/ai_solved, `channel` filtresi, keyset cursor | `chats--all:ro` \| `chats--access:ro` |
| POST | `/chats` | Müşteriyle sohbet başlat | `chats--*:rw` |
| GET | `/chats/{chatId}` | Tek sohbet + aktif thread | `chats--*:ro` |
| GET | `/chats/{chatId}/events` | Transkripti oku | `chats--*:ro` |
| POST | `/chats/{chatId}/events` | Mesaj, dahili not veya sistem eventi gönder (kart no maskeleme) | `chats--*:rw` |
| PUT | `/chats/{chatId}/events/{eventId}` | Gönderilmiş mesajı düzelt (edit) | `chats--*:rw` |
| POST | `/chats/{chatId}/deactivate` | Aktif thread'i kapat | `chats--*:rw` |
| POST | `/chats/{chatId}/resume` | Arşivlenmiş sohbeti yeniden aç | `chats--*:rw` |
| POST | `/chats/{chatId}/transfer` | Başka takıma/agent'a devret | `chats--*:rw` |
| POST | `/chats/{chatId}/takeover` | Süpervizör olarak zorla devral | `chats--all:rw` |
| POST | `/chats/{chatId}/supervise` | Süpervizör olarak kaydol/heartbeat | `chats--*:ro` |
| DELETE | `/chats/{chatId}/supervise` | Süpervizyonu bırak | `chats--*:ro` |
| POST | `/chats/{chatId}/tags` | Aktif thread'i etiketle | `tags--*:rw` + `chats--*:rw` |
| DELETE | `/chats/{chatId}/tags/{tagName}` | Etiketi kaldır | aynı |
| POST | `/chats/{chatId}/seen` | Okunma imlecini kaydet | `chats--*:ro` |
| GET | `/chats/{chatId}/apps` | Bağlı uygulamaların bu müşteriye ait verisi (detay paneli kartları) | `chats--*:ro` |

Kaynak: `routes/chats.ts`, `routes/apps.ts`; servisler `services/chat/chat-service.ts`, `services/routing/routing-service.ts`, `services/traffic/supervision-service.ts`.

### 3.4 Müşteri (widget) yüzeyi — yalnız müşteri tokenı
| Metot | Yol | Amaç |
|---|---|---|
| GET | `/customer/chat` | Widget'ın tüm sohbet durumu |
| POST | `/customer/chat/events` | Mesaj gönder; sohbet yoksa aç (spam filtresi, IP yasağı, routing, rule bot / AI ajan tetiklenir) |
| POST | `/customer/chat/typing` | Ziyaretçi yazıyor + sneak-peek (en fazla 500 karakter) |
| POST | `/customer/chat/close` | Ziyaretçi tarafından kapat (transkript e-postası) |
| POST | `/customer/chat/form-response` | Sohbet sonrası formu yanıtla |
| POST | `/customer/chat/rating` | Sohbeti puanla (`good`/`bad` + yorum) |
| POST | `/customer/chat/sale` | Tamamlanan siparişi gelir atfı için bildir (Sales tracker) |
| POST | `/customer/ticket` | Kimse yokken mesaj bırak (ticket oluşturur) |

Kaynak: `routes/customer.ts` (1294 satır), `services/chat/follow-ups.ts` (yanıt sonrası rule bot → AI ajan → atanan kişiye bildirim), `services/ai/ai-responder.ts`.

### 3.5 Müşteriler (CRM), trafik, kampanyalar, hedefler
| Metot | Yol | Amaç | Scope |
|---|---|---|---|
| GET | `/customers` | Müşteri listesi (arama, sıralama: last_activity/name/country) | `customers:ro` |
| GET | `/customers/{customerId}` | Müşteri + geçmiş | `customers:ro` |
| PATCH | `/customers/{customerId}` | Müşteri bilgilerini düzenle | `customers:rw` |
| PUT | `/customers/{customerId}/custom-fields` | Kişi özel alan değerleri | `customers:rw` |
| POST | `/customers/{customerId}/ban` | Müşteriyi yasakla | `customers.ban:rw` |
| DELETE | `/customers/{customerId}/ban` | Yasağı kaldır | `customers.ban:rw` |
| POST | `/customers/{customerId}/erase` | GDPR silme hakkı — kişiyi ve tanımlayan her şeyi sil | `customers.erase:rw` + admin |
| GET | `/traffic` | Sitedeki canlı ziyaretçiler (browsing/queued/waiting/chatting/supervised/invited, ülke/lead/sayfa/referrer/grup filtreleri) | `customers:ro` |
| GET | `/campaigns` | Kampanyalar (ongoing/scheduled/inactive) | `customers:ro` |
| POST | `/campaigns` | Kampanya oluştur (proaktif davet, koşullar) | `customers:rw` |
| PATCH | `/campaigns/{campaignId}` | Düzenle / aktifleştir | `customers:rw` |
| GET | `/goals` | Hedefler | `customers:ro` |
| POST | `/goals` | Hedef oluştur (dönüşüm tanımı) | `customers:rw` |
| PATCH | `/goals/{goalId}` | Düzenle / aktifleştir | `customers:rw` |

Kaynak: `routes/customers.ts`, `traffic.ts`, `campaigns.ts`, `goals.ts`; servisler `services/campaigns/*` (eşleştirme, teslim, etkileşim, ziyaret anında tetikleme), `services/goals/*`, `services/traffic/*`, `services/retention/erasure.ts`.

### 3.6 Ticket'lar
Durumlar: `open`, `pending`, `solved`, `closed`, `spam`. Scope: okuma `tickets--all:ro|tickets--access:ro|tickets--all:rw`, yazma `tickets--all:rw|tickets--access:rw`.

| Metot | Yol | Amaç |
|---|---|---|
| GET | `/tickets` | Liste (view: all/unassigned/my_open/solved, arama, sıralama) |
| POST | `/tickets` | Ticket oluştur (opsiyonel olarak sohbetten) |
| POST | `/tickets/bulk` | Çoklu ticket'a tek değişiklik uygula |
| GET | `/tickets/{ticketId}` | Tek ticket |
| PATCH | `/tickets/{ticketId}` | Durum, atanan, takım, konu değiştir |
| POST | `/tickets/{ticketId}/merge` | Başka ticket'a birleştir |
| DELETE | `/tickets/{ticketId}/merge` | Birleştirmeyi geri al |
| POST | `/tickets/{ticketId}/followers` | Takipçi ekle |
| DELETE | `/tickets/{ticketId}/followers/{accountId}` | Takipçi çıkar |
| PUT | `/tickets/{ticketId}/custom-fields` | Özel alan değerleri |

Kaynak: `routes/tickets.ts`, `services/tickets/*` (ticket kuralları uygulama, e-posta şablonları, bildirim e-postası).

### 3.7 Agent'lar, takımlar, bildirim cihazları
| Metot | Yol | Amaç | Scope |
|---|---|---|---|
| GET | `/agents` | Lisanstaki agent'lar | `agents--all:ro` \| `agents--my:ro` |
| PUT | `/agents/{agentId}/suspension` | Askıya al / geri al | `agents--all:rw` |
| PUT | `/agents/{agentId}/role` | Rol değiştir | rol kontrolü (owner/admin) |
| PUT | `/agents/{agentId}/chat-limit` | Eşzamanlı sohbet limiti | `agents--all:rw` |
| PUT | `/agents/{agentId}/expertise` | Uzmanlık alanları (beceri tabanlı routing) | rol kontrolü |
| GET | `/agents/{agentId}/work-schedule` | Haftalık çalışma programı | `agents--*:ro` |
| PUT | `/agents/{agentId}/work-schedule` | Programı değiştir | rol kontrolü |
| PUT | `/agents/me/routing-status` | Kendi durumunu ayarla (`accepting_chats`/`not_accepting_chats`/`offline`) | `agents--my:rw` |
| GET/PUT | `/agents/me/notification-preferences` | Bildirim kanalları (enabled/sound/desktop/push/email) | `agents--my:ro/rw` |
| GET/PUT | `/agents/me/ui-preferences` | Konsol yerleşim tercihleri | `agents--my:ro/rw` |
| GET | `/notifications/devices` | Kayıtlı mobil cihazlar | agent |
| POST | `/notifications/devices` | Cihaz kaydet / yenile (push) | `agents--my:rw` |
| DELETE | `/notifications/devices/{deviceId}` | Cihaza teslimi durdur | `agents--my:rw` |
| GET | `/groups` | Takımlar ve üyeleri | `groups--*:ro` |
| POST | `/groups` | Takım oluştur | `groups--all:rw` |
| PATCH | `/groups/{groupId}` | Yeniden adlandır / dil | `groups--all:rw` |
| DELETE | `/groups/{groupId}` | Takımı sil | `groups--all:rw` |
| PUT | `/groups/{groupId}/agents/{agentId}` | Agent ekle / öncelik (`primary/first/normal/last`) | `groups--all:rw` |
| DELETE | `/groups/{groupId}/agents/{agentId}` | Agent'ı çıkar | `groups--all:rw` |

Kaynak: `routes/agents.ts`, `routes/notifications.ts`, `services/team/*`, `services/notifications/*`.

### 3.8 AI: Playbook (AI ajanları, skill'ler, bilgi kaynakları)
Scope: okuma `agents-bot--all:ro`, yazma `agents-bot--all:rw` (fiilen admin). 7 route `aiInference: true` (HIPAA bölge kapısı).

| Metot | Yol | Amaç |
|---|---|---|
| GET | `/ai-agents` | Lisanstaki AI ajanları (`ai_agent`, `copilot`) |
| PATCH | `/ai-agents/{aiAgentId}` | Persona/ton/dil/talimat düzenle, aç/kapat |
| GET | `/skills` | Skill'ler + çalışma sayıları |
| POST | `/skills` | Skill oluştur |
| POST | `/skills/compile` | Doğal dil talimatı → adım listesi (mock derleyici) |
| POST | `/skills/preview` | Adım listesini örnek mesajda kaydetmeden çalıştır |
| GET | `/skills/{skillId}` | Tek skill |
| PATCH | `/skills/{skillId}` | Skill düzenle |
| DELETE | `/skills/{skillId}` | Skill sil |
| GET | `/skills/{skillId}/runs` | Son çalıştırmalar (token kullanımı dahil) |
| GET | `/knowledge-sources` | AI'ın yanıt verdiği bilgi kaynakları |
| POST | `/knowledge-sources` | Kaynak ekle ve indeksle (website/article/faq) |
| POST | `/knowledge-sources/bulk` | CSV'den toplu içe aktarım (12 MiB) |
| POST | `/knowledge-sources/file` | Dosya yükle (4 MiB) |
| PATCH | `/knowledge-sources/{sourceId}` | Yeniden adlandır / içeriği değiştir |
| DELETE | `/knowledge-sources/{sourceId}` | Kaynağı ve indekslenmiş chunk'ları sil |
| POST | `/knowledge-sources/{sourceId}/reindex` | Kaynağı yeniden çek ve indeksle |

Skill adım tipleri: `detect_intent`, `request_info`, `tag`, `summarize`, `send_message`, `transfer_to_team`. Skill türleri: `ai_agent`, `workspace`. Skill sonucu `answered` → thread insan yanıtı olmadan kapanırsa **AI çözümü** olarak faturalanır (ADR-09). Kaynak: `routes/playbook.ts`, `services/ai/skill-engine.ts`, `knowledge-service.ts`, `knowledge-refresh*.ts`, `knowledge-reembed*.ts`, `web-crawler.ts`, `knowledge-file-parse.ts`.

### 3.9 AI: Copilot ve komut paleti
| Metot | Yol | Amaç | Scope |
|---|---|---|---|
| GET | `/copilot/knowledge` | Copilot'un kendi bilgi kaynakları | `agents-bot--all:ro` |
| POST | `/copilot/knowledge` | Copilot bilgi tabanına kaynak ekle | `agents-bot--all:rw` |
| DELETE | `/copilot/knowledge/{sourceId}` | Copilot kaynağını sil | `agents-bot--all:rw` |
| POST | `/copilot/chats/{chatId}/summary` | Sohbeti özetle (aktifse dahili not olarak) | `chats--*:rw` |
| POST | `/copilot/chats/{chatId}/reply` | Bilgi tabanından yanıt taslağı | `chats--*:rw` |
| POST | `/copilot/chats/{chatId}/enhance` | Taslağı seçilen üslupta yeniden yaz | `chats--*:rw` |
| POST | `/copilot/bi` | Workspace metrikleri hakkında soru yanıtla (BI) | `agents-bot` + `reports_read` |
| POST | `/palette/ai-query` | ⌘K paletinde doğal dil sorgu | agent |

Kaynak: `routes/copilot.ts`, `routes/command-palette.ts`, `services/ai/copilot-*.ts`.

### 3.10 Ayarlar — güvenlik, kimlik, uyumluluk
Scope: aksi belirtilmedikçe okuma `access_rules:ro`, yazma `access_rules:rw`.

| Metot | Yol | Amaç |
|---|---|---|
| GET/POST | `/settings/trusted-domains` | Widget'ı gömebilecek domainler / ekle |
| DELETE | `/settings/trusted-domains/{domainId}` | Domain izni kaldır |
| GET/POST | `/settings/ip-allowlist` | Panel IP allow-list / ekle |
| DELETE | `/settings/ip-allowlist/{entryId}` | Girdiyi kaldır |
| GET/POST | `/settings/sso` | SAML IdP bağlantıları / ekle |
| PATCH | `/settings/sso/{connectionId}` | Bağlantıyı değiştir, sertifika döndür |
| DELETE | `/settings/sso/{connectionId}` | Federasyonu kaldır |
| POST | `/settings/sso/{connectionId}/domains/{domain}/challenge` | Alan adı sahiplik doğrulama e-postası |
| POST | `/settings/sso/{connectionId}/domains/{domain}/verify` | Doğrulama yanıtı |
| GET/POST | `/settings/scim-tokens` | SCIM tokenları / bas |
| DELETE | `/settings/scim-tokens/{tokenId}` | SCIM tokenı iptal |
| GET/PATCH | `/settings/security` | Dosya paylaşımı, izinli dosya tipleri/boyutu, spam filtresi, 2FA zorunluluğu, IP allow-list zorlaması, oturum boşta zaman aşımı, eşzamanlı oturum sayısı |
| GET/PATCH | `/settings/retention` | Veri saklama süresi (30/60/365/sınırsız) |
| GET | `/settings/compliance` | HIPAA kapsamı ve workspace bölgesi |
| POST | `/settings/compliance/baa` | HIPAA BAA kabulü (pilotta kapalı) |
| GET/PATCH | `/settings/company` | Şirket adı, sektör, adres, saat dilimi, büyüklük (`organization--my:rw`) |
| GET/PUT | `/settings/sla` | İlk yanıt / çözüm hedefleri (iş saatleri opsiyonu; `sla` entitlement) |
| GET/POST | `/settings/sandbox` | Sandbox workspace bilgisi / oluştur (`sandbox` entitlement) |
| POST | `/settings/sandbox/reset` | Oturum açılmış sandbox'ı boşalt |
| GET/PATCH | `/settings/siem` | Denetim kaydı SIEM dışa aktarım ayarı (`siem_export` entitlement) |
| GET | `/settings/siem/status` | Dışa aktarım durumu |

### 3.11 SCIM 2.0 (`/scim/v2`, `application/scim+json`, RFC 7644 hata zarfı, principal `scim`, `sso` entitlement, 300/dk)
| Metot | Yol | Amaç |
|---|---|---|
| GET/POST | `/scim/v2/Users` | Üyeleri listele / provision et |
| GET/PATCH/DELETE | `/scim/v2/Users/{userId}` | Oku / PatchOp güncelle / deprovision |
| GET/POST | `/scim/v2/Groups` | Takımları listele / oluştur |
| GET/PUT/PATCH/DELETE | `/scim/v2/Groups/{groupId}` | Oku / değiştir / üye ekle-çıkar-yeniden adlandır / sil |

### 3.12 Ayarlar — inbox yapılandırması
| Metot | Yol | Amaç | Scope |
|---|---|---|---|
| GET/POST | `/settings/canned-responses` | Kayıtlı yanıtlar (`#` kısayol, chat/ticket kapsamı, takım görünürlüğü) | okuma `canned_responses--groups:ro`, yazma `--all:rw` |
| PATCH/DELETE | `/settings/canned-responses/{cannedResponseId}` | Düzenle / sil | `canned_responses--all:rw` |
| GET/POST | `/settings/routing-rules` | Sohbet/ticket hangi takıma (koşul, öncelik, fallback) | `access_rules` |
| PATCH/DELETE | `/settings/routing-rules/{ruleId}` | Aç/kapat, hedef değiştir / sil | `access_rules:rw` |
| GET/POST | `/settings/expertise` | Uzmanlık alanları (skill-based routing) | `access_rules` |
| DELETE | `/settings/expertise/{expertiseId}` | Uzmanlık sil | `access_rules:rw` |
| GET/POST | `/settings/tags` | Etiket kütüphanesi (takım kapsamı) | okuma `tags--groups:ro`, yazma `tags--all:rw` |
| PATCH/DELETE | `/settings/tags/{tagId}` | Yeniden adlandır / kapsam / sil | `tags--all:rw` |
| GET/POST | `/settings/ticket-rules` | Ticket otomasyon kuralları (kaynak chat/email, koşul→aksiyon) | `tickets--all` |
| PATCH/DELETE | `/settings/ticket-rules/{ruleId}` | Düzenle / aç-kapat / sil | `tickets--all:rw` |
| GET/POST | `/settings/bots` | Kural tabanlı botlar (AI'sız) | `agents-bot--all` |
| PATCH/DELETE | `/settings/bots/{botId}` | Ad / aç-kapat / hizmet verdiği takımlar / sil | `agents-bot--all:rw` |
| POST | `/settings/bots/{botId}/rules` | Bota kural ekle | `agents-bot--all:rw` |
| PATCH/DELETE | `/settings/bots/{botId}/rules/{ruleId}` | Kural düzenle / sil | `agents-bot--all:rw` |
| GET/POST | `/settings/ticket-email-templates` | Ticket e-posta şablonları (şablon değişkenleri) | `tickets--all` |
| PATCH/DELETE | `/settings/ticket-email-templates/{templateId}` | Düzenle / aç-kapat / sil | `tickets--all:rw` |
| GET/POST | `/settings/custom-fields` | Özel alan tanımları (ticket/customer, form yerleşimi, tabloda gösterim) | `access_rules` |
| PATCH/DELETE | `/settings/custom-fields/{fieldId}` | Yeniden adlandır / zorunluluk / sil | `access_rules:rw` |
| GET/PUT | `/settings/chat-timeout` | Boşta sohbet otomatik kapanma süresi | `access_rules` |
| GET/PUT | `/settings/widget` | Widget görünümü (renk, konum, tema, mobil tam ekran, "powered by" — `white_label`, karşılama metni) | `access_rules` |
| GET/PUT | `/settings/sales-tracker` | Satış takipçisi (para birimi, atıf penceresi) | `access_rules` |
| GET/PUT | `/settings/appearance` | Workspace varsayılan panel fontu | okuma `agents--*:ro`, yazma `organization--my:rw` |

Kaynak: `routes/settings.ts` (3724 satır), `ticket-rules.ts`, `bots.ts`, `ticket-email-templates.ts`, `custom-fields.ts`.

### 3.13 Uygulama pazaryeri (Apps) ve onboarding
| Metot | Yol | Amaç | Scope |
|---|---|---|---|
| GET | `/settings/apps` | Pazaryeri uygulamaları + bağlantı durumu | `access_rules` |
| DELETE | `/settings/apps/{appId}` | Uygulama bağlantısını kes | `access_rules:rw` |
| POST | `/settings/apps/{appId}/oauth/start` | (Mock) OAuth akışını başlat | `access_rules:rw` |
| POST | `/settings/apps/{appId}/oauth/callback` | (Mock) OAuth'u tamamla | `access_rules:rw` |
| POST | `/settings/apps/{appId}/connect` | API anahtarıyla bağlan (yalnız hash saklanır; canlı kartlarda AES-256-GCM şifreli) | `access_rules:rw`, 20/saat |
| GET | `/onboarding/state` | İlk kurulum durumu | agent |
| POST | `/onboarding/complete` | Kurulumu bitti/atlandı işaretle | `properties.configuration:rw` |
| POST | `/onboarding/seed-demo` | Örnek veri yükle (pilotta kapalı) | |
| POST | `/onboarding/survey` | "Neyi takip ediyorsunuz?" anketi | `reports_read` |

### 3.14 Markalar, web siteleri, webhook'lar, partner uygulamaları, MCP
| Metot | Yol | Amaç | Scope |
|---|---|---|---|
| GET/POST | `/brands` | Markalar / oluştur | `brands--all:ro` / `rw` |
| GET/PATCH/DELETE | `/brands/{brandId}` | Oku / ad-slug-logo değiştir / sil | `brands--all` |
| GET/POST | `/websites` | Widget kurulu siteler / ekle | `access_rules` |
| GET/DELETE | `/websites/{websiteId}` | Kurulum snippet'iyle oku / sil | `access_rules` |
| GET/POST | `/webhooks` | Giden webhook abonelikleri / kaydet | `webhooks--all` |
| DELETE | `/webhooks/{webhookId}` | Webhook kaydını sil | `webhooks--all:rw` |
| GET | `/integrations/manifest` | Zapier/Make uygulaması için tetikleyici + aksiyon kataloğu | `webhooks--all:ro` |
| GET/POST | `/partner/apps` | Workspace'in OAuth istemcileri / kaydet | `access_rules` |
| GET/PATCH/DELETE | `/partner/apps/{clientId}` | Oku / güncelle / sil | `access_rules` |
| POST | `/partner/apps/{clientId}/rotate-secret` | Yeni client secret | `access_rules:rw` |
| GET | `/mcp/manifest` | MCP araç kataloğu ve sunucu bilgisi | public |
| POST | `/mcp/tools/{tool}` | MCP aracı çağır (aracın gerektirdiği scope'larla) | araç bazlı |

MCP araçları (`apps/api/src/services/mcp/tools/`): `search_tickets`, `list_chats`, `get_report`, `summarize_chat`.
Zapier/Make aksiyonları (`packages/types/src/integrations.ts`): `send_message`, `create_ticket`, `add_tag`.

### 3.15 Kanallar
Adapter kanalları: `messenger`, `twilio` (SMS), `whatsapp`, `instagram`, `telegram`. Adapter dışı: `website_widget`, `email`, `chat_page`. Durumlar `connected | off | soon`.

| Metot | Yol | Amaç | Scope |
|---|---|---|---|
| GET | `/channels` | Bağlı kanallar | `channels--all:ro` |
| POST | `/channels/{type}/connect` | Kanal bağla (**mock**; Telegram canlı olabilir — bot token doğrulanır) | `channels--all:rw` |
| POST | `/channels/{type}/disconnect` | Kanal bağlantısını kes | `channels--all:rw` |
| GET | `/channels/{type}/messages` | Kanal mesaj günlüğü | `channels--all:ro` |
| POST | `/channels/{type}/messages` | Kanaldan giden mesaj (**mock**) | `channels--all:rw` |
| POST | `/channels/{type}/webhook` | Gelen kanal mesajını al (**mock sağlayıcı webhook'u**, imza doğrulaması kapsam dışı) | public |
| POST | `/channels/telegram/webhook/{channelId}` | Canlı Telegram update'i al (secret hash sabit-zamanlı karşılaştırma) | public |
| POST | `/channels/email/inbound` | Yönlendirilen destek e-postasını al → ticket (`INBOUND_EMAIL_SECRET`) | public |
| GET/POST | `/channels/email/addresses` | Yönlendirme adresleri (`<org_id>[+etiket]@<INBOUND_EMAIL_DOMAIN>`) | `channels--all` |
| DELETE | `/channels/email/addresses/{addressId}` | Adresi kapat | `channels--all:rw` |
| POST | `/channels/email/addresses/{addressId}/test` | Adrese test mesajı | `channels--all:rw` |

Kaynak: `routes/channels.ts`, `services/channels/*`.

### 3.16 Dosya yükleme
| Metot | Yol | Amaç | Scope |
|---|---|---|---|
| POST | `/uploads` | Ek yükleme izni iste → imzalı `upload_url` + `file_url` | `chats--*:rw` (müşteri de) |
| GET | `/uploads-policy` | Bu lisansta dosya paylaşımı açık mı | |
| PUT | `/uploads/{key}` | İzin verilen yükleme için baytları gönder (imza ile; virüs taraması) | imzalı URL |
| GET | `/uploads/{key}` | Saklanan eki getir | `chats--*` |

Kaynak: `routes/uploads.ts`, `services/storage/*` (local/S3, `upload-url.ts`, `virus-scanner.ts` — fail-closed).

### 3.17 Ana sayfa ve raporlar
| Metot | Yol | Amaç | Scope |
|---|---|---|---|
| GET | `/home` | Ana pano: aktivasyon, canlı sayaçlar, haftalık performans | `reports_read` |
| GET | `/reports/overview` | Başlık sohbet metrikleri | `reports_read` |
| GET | `/reports/breakdown` | Gün/agent/saat/takım/kanal bazında çözüm dağılımı | `reports_read` |
| GET | `/reports/ai-agent` | AI ajan performansı | `reports_read` |
| GET | `/reports/reviews` | CSAT ve günlük puan hacmi (+ yorum içgörüleri) | `reports_read` |
| GET | `/reports/topics` | Sohbet konu kümeleri (hacim + trend; deterministik kümeleme) | `reports_read` |
| GET | `/reports/cases` | Gün/durum/önceliğe göre ticket hacmi | `reports_read` |
| GET | `/reports/leads` | Günlük yeni lead'ler | `reports_read` |
| GET | `/reports/team-performance` | Agent bazında KPI'lar | `reports_read` |
| GET | `/reports/sales` | Takip edilen satışlar | `reports_read` |
| GET | `/reports/goals` | Ziyaretçi → sohbet → dönüşüm hunisi | `reports_read` |
| GET | `/reports/staffing-forecast` | 7×24 gerekli/planlanan/çevrimiçi agent tahmini | `reports_read` |
| GET | `/reports/groups` | Çağıranın görebileceği rapor grupları | |
| GET | `/reports/export` | Rapor grubunu CSV veya PDF dışa aktar | |
| GET | `/reports/access-review` | SOC 2 CC6.1 erişim gözden geçirmesi | `audit_log--all:ro` |
| GET/POST | `/reports/share-links` | Paylaşım linkleri / bas (tek grup + tarih aralığı) | `reports_manage` |
| DELETE | `/reports/share-links/{shareLinkId}` | Linki iptal et | `reports_manage` |
| GET | `/reports/shared` | Paylaşım linkiyle anonim rapor okuma | public (token) |
| GET/POST | `/reports/scheduled-exports` | Zamanlanmış rapor e-postaları / oluştur | `reports_manage` |
| GET/PATCH/DELETE | `/reports/scheduled-exports/{scheduledExportId}` | Oku / grup-sıklık-alıcı-durum değiştir / iptal | `reports_manage` |
| GET | `/reports/scheduled-exports/{scheduledExportId}/runs` | Teslim geçmişi | `reports_read` |

Kaynak: `routes/reports.ts` (2466 satır), `reports-export.ts`, `reports-metrics.ts`, `scheduled-reports.ts`, `services/reports/*`, `services/staffing/*`, `services/home/home-service.ts`.

### 3.18 Faturalama (tamamı mock ödeme)
| Metot | Yol | Amaç | Scope |
|---|---|---|---|
| GET | `/billing/subscription` | Plan, deneme durumu, tahmini ücret | `billing_manage`/`billing_admin`/`reports_read` |
| PATCH | `/billing/subscription` | Plan, döngü (aylık/yıllık; yıllık = 10 ay ücreti), koltuk sayısı değiştir | billing |
| GET | `/billing/usage` | Dönem içi ölçülen kullanım (`api_calls`, `ai_resolutions`) | billing/`reports_read` |
| GET | `/billing/invoices` | Faturalar | billing |
| GET | `/billing/invoices/{period}/download` | Faturayı CSV indir | billing |
| GET/PUT | `/billing/payment-method` | Kayıtlı ödeme yöntemi (yalnız marka/son4/son kullanma) | billing |
| GET/POST | `/billing/api-packages` | Satın alınabilir API çağrı paketleri / satın al | billing |
| GET | `/billing/api-packages/purchases` | Satın alınmış API paketleri | billing |
| GET/POST | `/billing/ai-packages` | AI çözüm aşım paketi / satın al (idempotency key) | billing |
| GET | `/billing/entitlements` | Planın açtığı özellikler | |

Kaynak: `routes/reports.ts` (billing route'ları burada), `services/billing/*`.

### 3.19 Denetim kaydı
| Metot | Yol | Amaç | Scope |
|---|---|---|---|
| GET | `/audit-log` | Denetim kayıtları | `audit_log--all:ro` + admin |
| GET | `/audit-log/export` | SIEM'e akış (NDJSON) | `audit_log--export:ro` |
| GET | `/audit-log/{entryId}` | Tek kayıt | `audit_log--all:ro` |

### 3.20 Bilgi bankası (KB) — yönetim ve public
| Metot | Yol | Amaç | Scope |
|---|---|---|---|
| GET/POST | `/kb-articles` | Makaleler / oluştur | `agents-bot--all:ro` / `rw` |
| GET/PATCH/DELETE | `/kb-articles/{articleId}` | Oku / düzenle-yayınla-yayından kaldır / sil | aynı |
| GET/POST | `/kb-categories` | Kategoriler / oluştur | aynı |
| PATCH/DELETE | `/kb-categories/{categoryId}` | Düzenle / sil | aynı |
| GET | `/kb-settings` | KB ayarları | okuma |
| PUT | `/kb-settings` | KB yapılandır (açık/kapalı, public slug, site başlığı) | admin |
| GET | `/public/kb/{workspaceSlug}/articles` | Yayınlanmış makaleler (JSON) | public, 300/dk |
| GET | `/public/kb/{workspaceSlug}/articles/{articleSlug}` | Tek makale (JSON) | public |
| GET | `/public/kb/{workspaceSlug}/categories` | Kategoriler (JSON) | public |
| GET | `/public/kb/{workspaceSlug}` | KB ana sayfası (sunucu tarafı HTML) | public |
| GET | `/public/kb/{workspaceSlug}/sitemap.xml` | Sitemap | public |
| GET | `/public/kb/{workspaceSlug}/robots.txt` | robots.txt | public |
| GET | `/public/kb/{workspaceSlug}/{articleSlug}` | Makale (sunucu tarafı HTML, SEO başlık/açıklama) | public |

Kaynak: `routes/kb.ts`, `public-kb*.ts`, `lib/kb-*.ts`.

---

## 4. Veritabanı (PostgreSQL / Prisma)

- Şema: `apps/api/prisma/schema.prisma` (3013 satır, **92 model, 0 Prisma enum** — enum'lar `CHECK` kısıtları ve `packages/types` sabitleriyle). RLS politikaları SQL migration'larda.
- Migration: `apps/api/prisma/migrations/` — **113 migration** (`20260722090000_init_extensions` → `20261014090000_customer_username`). Drift kontrolü: `pnpm db:check-drift` (`apps/api/scripts/check-drift.ts`). Seed: `apps/api/prisma/seed.ts` (2048 satır).
- Uzantılar: `pgcrypto`, `citext` (e-posta), `vector` (pgvector). İndeksler: `knowledge_chunks.embedding` üzerinde **HNSW**, `events.properties` üzerinde GIN. Embedding boyutu 1536.
- Not: `LiveChat_ER_Diyagram.mermaid` şemanın kaynağı **değil** (şema başlığında açıkça belirtilmiş).

### 4.1 Tablolar (domain bazında)
| Domain | Tablolar (`@@map`) | Önemli ilişkiler / alanlar |
|---|---|---|
| Kiracı & lisans | `organizations`, `licenses` | Organization 1→N License; License: plan, billingCycle, trialEndsAt, status, onboarding, `hipaaBaaSignedAt`, şartlar sürümü, retention pencereleri, demo seed, anket, `sandboxOfLicenseId` (self-relation) |
| Hesap & üyelik | `accounts`, `agent_memberships` | Account N↔N License (`agent_memberships`: rol, routingStatus, eşzamanlı limit, bildirim tercihleri, font, dil, `awaitingApproval`, `suspended`, `lastAssignedAt`, `scimExternalId`) |
| OAuth & tokenlar | `oauth_clients`, `oauth_authorization_codes`, `oauth_refresh_tokens`, `api_tokens`, `device_tokens` | Hash'lenmiş token, PKCE challenge, `familyId`/`replacedById` rotasyon zinciri; `api_tokens.kind` pat/oauth/bot |
| Hesap güvenliği | `password_reset_tokens`, `email_verification_tokens`, `account_two_factor`, `two_factor_recovery_codes`, `invitations` | TOTP secret + `lastUsedStep` (tekrar kullanımı önleme) |
| SSO / erişim | `sso_connections`, `sso_domain_verifications`, `trusted_domains`, `ip_allowlist_entries` | Önceki sertifika + bitiş tarihi (rotasyon) |
| Takımlar | `groups`, `group_agents`, `expertise`, `agent_expertise`, `work_schedules`, `agent_presence_events` | Grup önceliği; presence olayları kadro tahmininde |
| Sohbet çekirdeği | `chats`, `threads`, `events` (aylık partition), `chat_users`, `chat_access`, `chat_supervisions`, `ratings` | Chat→Thread→Event; Thread: kuyruk pozisyonu, atanan, özet, `eventSequence`, `firstResponseAt`; `chat_access` = chat↔group |
| Müşteri / CRM | `customers`, `visits`, `channel_identities` | Customer organizasyon düzeyinde; ban, lead, sayaçlar |
| Etiket & özel alan | `tags`, `thread_tags`, `ticket_tags`, `custom_field_definitions`, `custom_field_values` | Tag'in `groupIds` kapsamı; özel alan ticket veya customer'a bağlı |
| Ticket | `tickets`, `ticket_followers`, `ticket_rules`, `ticket_email_templates`, `inbound_email_addresses` | Ticket: kaynak chat, birleştirme (`mergedIntoId` self-relation), gelen adres |
| Kampanya / hedef / satış | `campaigns`, `campaign_sends`, `goals`, `goal_achievements`, `sales_tracker_settings`, `tracked_sales` | Satış atfı chat'e (`attributed`) |
| AI | `ai_agents`, `skills`, `skill_runs`, `knowledge_sources`, `knowledge_chunks`, `workflows` | SkillRun LLM/embedding token sayıları; KnowledgeSource yenileme (`refreshAfterDays`, `nextRefreshAt`); **`workflows` tablosu kodda hiç kullanılmıyor** |
| Rule bot | `bots`, `bot_rules`, `bot_groups` | Takım bazlı öncelik |
| Routing | `routing_rules` | kind chat/ticket, hedef grup, öncelik, fallback |
| Kanallar | `channels`, `channel_messages`, `inbound_email_addresses` | `credentialCiphertext` (AES-GCM), `webhookSecretHash`; brand'e bağlı |
| Web / marka | `websites`, `brands` | |
| Webhook | `webhooks`, `webhook_deliveries` | Teslim denemesi, kalıcı hata, `nextAttemptAt` |
| Ayarlar | `security_settings`, `inbox_settings`, `widget_settings`, `workspace_appearance_settings`, `kb_settings`, `sla_policies`, `sla_breaches` | Marka bazlı olabilir |
| Faturalama | `subscriptions`, `usage_records`, `payment_methods`, `invoices`, `invoice_line_items`, `api_package_purchases`, `ai_package_purchases`, `ai_daily_usage`, `mail_daily_usage` | Dönem kapanışında donmuş faturalar |
| Denetim / SIEM | `audit_log`, `audit_chain_heads`, `siem_export_cursors` | Hash zinciri (`chainSeq`, `prevHash`, `hash`), budama işareti |
| Uygulamalar | `app_installations` | `apiKeyHash`, `apiKeyLastFour`, `credentialCiphertext`, `live` |
| KB | `kb_categories`, `kb_articles` | slug, SEO alanları, yayın durumu |
| Raporlar | `scheduled_reports`, `scheduled_report_runs`, `report_share_links` | Paylaşım tokenı hash + son 4 |

---

## 5. Gerçek zamanlı katman (RTM)

- **Uç noktalar** (`packages/types/src/rtm.ts`): agent `ws://…/v1/agent/rtm/ws`, müşteri `…/v1/customer/rtm/ws`. Protokol sürümü `3.6`. Ayrıca HTTP `/health`, `/health/live`, `/health/ready`.
- **Limitler:** login zaman aşımı 30 sn, ping aralığı 15 sn, boşta zaman aşımı 30 sn, bekleyen istek ≤10, istek zaman aşımı 15 sn, soket başına `RATE_LIMIT_RTM_PER_SEC` (vars. 10 mesaj/sn — aşımda kapatılmaz, `too_many_requests`), opsiyonel `RTM_MAX_CONNECTIONS` tavanı.
- **İstemci → sunucu aksiyonları (tanımlı 14):** `login`, `logout`, `ping`, `subscribe`, `unsubscribe`, `sync`, `send_event`, `send_typing_indicator`, `mark_events_as_seen`, `set_routing_status`, `start_chat`, `resume_chat`, `deactivate_chat`, `transfer_chat`.
  - **Gerçekte işlenenler:** `login`, `logout`, `ping`, `subscribe`, `unsubscribe`, `sync` (imleç bazlı kaçırılan event + düzeltmeler), `send_typing_indicator`. Diğerleri bilinçli olarak `not_allowed` döner ("REST kullanın", ADR-04) — `apps/rtm/src/dispatcher.ts`.
- **Sunucu → istemci push'ları (tanımlı 23):** `incoming_chat`, `chat_deactivated`, `chat_transferred`, `chat_taken_over`, `chat_access_updated`, `user_added_to_chat`, `user_removed_from_chat`, `queue_positions_updated`, `incoming_event`, `event_updated`, `events_marked_as_seen`, `incoming_typing_indicator`, `incoming_sneak_peek`, `thread_tagged`, `thread_untagged`, `thread_summary_set`, `routing_status_set`, `agent_disconnected`, `agent_conflict_warning`, `customer_updated`, `incoming_customers`, `traffic_visitor_updated`, `incoming_error`.
  - **Kodda yayınlananlar:** `incoming_chat`, `incoming_event`, `event_updated`, `chat_deactivated`, `chat_transferred`, `chat_taken_over`, `incoming_typing_indicator`, `incoming_sneak_peek`, `routing_status_set`, `traffic_visitor_updated`, `agent_conflict_warning` (+ `agent_disconnected` RTM içinde).
  - **Tanımlı ama hiçbir yerde yayınlanmayan (11):** `chat_access_updated`, `user_added_to_chat`, `user_removed_from_chat`, `queue_positions_updated`, `events_marked_as_seen`, `thread_tagged`, `thread_untagged`, `thread_summary_set`, `customer_updated`, `incoming_customers`, `incoming_error` (web/widget kaynaklarında da referans yok).
- **Veri yolu:** API → Redis pub/sub kanalı `siyahtus:rtm:license:{licenseId}` → RTM fan-out (`apps/api/src/services/realtime/publisher.ts` → `apps/rtm/src/fanout.ts`). Zarf `BusEnvelope v1` (licenseId, organizationId, action, audience {groupIds, agentIds, customerId, allAgents}, payload, originConnectionId). RTM yetki kararı vermez; API'nin koyduğu audience'a güvenir.
- **Typing / composing durumu:** Redis anahtarları `siyahtus:typing:{license}:{chat}`, `siyahtus:composer:{license}:{chat}` (TTL 8 sn). **Çoklu agent yazma çakışması tespiti** (Redis Lua script ile atomik) → `agent_conflict_warning` (`apps/rtm/src/conflict.ts`, `conflict-publisher.ts`).
- **Kimlik doğrulama** (`apps/rtm/src/auth.ts`): API ile aynı token/rol/bölge kuralları (`packages/types` paylaşımlı); bölge uyuşmazlığında `misdirected_request`.

---

## 6. Arka plan işleri (zamanlayıcı)

API süreci içinde çalışan zamanlayıcı; çoklu instance'ta **Redis lider kilidi** ile iş başına tek çalıştırma (`apps/api/src/services/scheduler/lock.ts`), `SCHEDULE_JITTER_PCT` ile jitter, `SCHEDULER_ENABLED` anahtarı. Kaynak: `apps/api/src/services/scheduler/jobs.ts`, `intervals.ts`.

| İş | Varsayılan aralık (env) | Görev |
|---|---|---|
| `chat_timeout` | 60 sn (`SCHEDULE_CHAT_TIMEOUT_MS`) | Boşta kalan sohbetleri workspace ayarına göre otomatik arşivle |
| `sla` | 60 sn | Çalışan SLA saatlerini kontrol et, ihlali kaydet (`sla_breaches`) ve e-posta at |
| `siem` | 5 dk | Denetim kaydını SIEM hedefine aktar (yalnız `file` sağlayıcı) |
| `scheduled_reports` | 60 sn | Zamanlanmış rapor e-postalarını gönder |
| `retention` | 1 saat | Süresi dolan veriyi kalıcı sil (**varsayılan kapalı**: `RETENTION_ENABLED=false`); ayrıca `pnpm retention:run` CLI |
| `webhook_redelivery` | 60 sn | Başarısız webhook teslimatlarını yeniden dene (maks. `WEBHOOK_MAX_ATTEMPTS`=8) |
| `knowledge_refresh` | 1 saat | Website bilgi kaynaklarını yeniden tara ve indeksle |
| `invoice_close` | 1 saat | Kapanan faturalama dönemlerini değişmez faturaya dondur |
| `unverified_signups` | 1 saat | Doğrulanmamış süresi geçmiş kayıtları (workspace'leriyle) sil |

İstek dışı (response sonrası) işler: `backgroundMail` (şifre sıfırlama, atanan bildirimi, kapanış transkripti, ticket bildirimi), `followUps` (rule bot → AI ajan → atanan bildirimi). Ayrıca `events` aylık partition bakımı.

**Retention varsayılanları:** thread 365 gün, ziyaret 90 gün, mail 30 gün, audit 30 gün; üç katman (deployment → workspace → HIPAA tavanı), her katman yalnız kısaltabilir (`services/retention/policy.ts`).

---

## 7. Entegrasyonlar ve mock durumu

| Alan | Sağlayıcı seçenekleri (env) | Varsayılan | Durum |
|---|---|---|---|
| LLM | `LLM_PROVIDER` = `mock` \| `openai` (OpenAI uyumlu HTTP, `LLM_API_BASE_URL`, `LLM_MODEL`) | `mock` | Gerçek adapter var (devre kesici, retry, redaksiyon, zaman aşımı, prompt/çıktı tavanları); varsayılan deterministik stub |
| Embedding | `EMBEDDING_PROVIDER` = `mock` \| `openai` | `mock` (leksikal) | Gerçek adapter var; `RETRIEVAL_THRESHOLD` |
| Skill derleyici, niyet, Copilot özet/yanıt/iyileştirme, konu kümeleme, palet/BI niyet | `packages/ai-mock` | — | **Tamamen kural tabanlı/deterministik stub** (`compiler.ts`, `intent.ts`, `assist.ts`, `topics.ts`, `palette-intent.ts`, `bi-intent.ts`, `embedding.ts`, `steps.ts`); bazı yollar LLM sağlayıcısını da kullanabilir |
| Web crawler (bilgi kaynağı) | — | `mockFetcher` | **Mock** (URL'den deterministik sayfa); HTML→metin ayrıştırma gerçek |
| E-posta (giden) | `MAIL_PROVIDER` = `file` \| `null` \| `smtp` | `file` (`.data/mail`) | SMTP gerçek (`smtp-mailer.ts`); günlük tavanlar (workspace 200, harici 50, global 400, güvenlik rezervi); yerel test için `scripts/mock-smtp-server.ts` |
| E-posta şablonları | `services/mail/templates/messages.ts` | — | verifyEmail, accountExists, passwordReset, invitation, twoFactorEnabled, ssoDomainChallenge, visitorMessage, customer/teamTranscript, scheduledReport, slaBreach, ticketNotice |
| E-posta (gelen) | `POST /channels/email/inbound` + `INBOUND_EMAIL_SECRET` | — | Sağlayıcının parse edip çağırması bekleniyor |
| Push (mobil) | `PUSH_PROVIDER` = `file` \| `null` | `file` | **Mock** — APNs/FCM yok, diske yazar |
| Ödeme | `STRIPE_PROVIDER` = `mock` | `mock` | **Tamamen mock**, kart girişi kapsam dışı |
| Depolama | `STORAGE_PROVIDER` = `local` \| `s3` | `local` | S3 gerçek (MinIO ile) |
| Virüs tarama | `VIRUS_SCANNER` = `mock` \| `unavailable` | `mock` | **Mock** (yalnız EICAR'ı yakalar); ClamAV için yer hazır; fail-closed |
| SIEM | `SIEM_PROVIDER` = `file` | `file` | Yalnız dosyaya NDJSON |
| Mesajlaşma kanalları | Messenger, WhatsApp, Instagram, Twilio SMS | — | **Mock adapter** (ağ yok, imza doğrulaması yok) |
| Telegram | `APPS_LIVE_PROVIDERS` içinde `telegram` | kapalı | **Canlı uygulanabilir** (bot token doğrulama, webhook kaydı, gerçek yanıt) |
| Uygulama pazaryeri | 103 kart (`packages/types/src/apps.ts`: HubSpot, Shopify, Stripe, Salesforce, Zendesk, Slack, Jira, Zapier, Make, …) | — | **Mock OAuth + deterministik sahte veri**; `brevo` ve `freshdesk` için canlı doğrulayıcı (`services/apps/verifiers/`), `APPS_LIVE_PROVIDERS` ile; kanal tipli kartlar Channels'tan yönetilir |
| Giden webhook'lar | HTTP gönderici (SSRF korumalı) | — | **Gerçek**; HMAC-SHA256 + zaman damgası + nonce imzası; aksiyonlar `chat_started`, `chat_deactivated`, `chat_transferred`, `event_created`, `ticket_created`; tipler `license`, `bot` |
| MCP sunucusu | `/mcp/*` | — | HTTP üzerinden 4 araç |
| Telemetri | `OTEL_ENABLED`, `OTEL_EXPORTER` (console/otlp) | testte kapalı | |

---

## 8. Güvenlik özellikleri

- **Rate limit** (`apps/api/src/plugins/rate-limit.ts`): Redis sorted set üzerinde kayan pencere, tek Lua script (atomik), her 429'da `Retry-After` + `X-RateLimit-*` başlıkları. İki aşama: auth öncesi `onRequest` (anonim IP kovası + başarısız token çözümleme bütçesi) ve auth sonrası `preHandler` (principal kovası).

  | Kova | Varsayılan |
  |---|---|
  | Agent tokenı | 180/dk, burst 30 |
  | Müşteri tokenı | 60/dk |
  | Anonim (IP) | 30/dk |
  | `POST /auth/token` (IP) | 300/dk |
  | Public config | 600/dk |
  | Auth hataları (IP) | 60/dk |
  | Public KB | 300/dk |
  | SCIM | 300/dk |
  | Health | 600/dk |
  | 2FA denemeleri | 20/saat |
  | Signup | 10/saat |
  | Apps connect | 20/saat |
  | RTM soketi | 10 mesaj/sn |

- **Güvenilir proxy:** `TRUST_PROXY_HOPS` ile sınırlı hop sayısı, yalnız loopback/özel ağ eşleri (`lib/trust-proxy.ts`) — XFF sahteciliğine karşı.
- **Log redaksiyonu:** authorization, cookie, parola, client_secret, code_verifier, token, bot_token, api_key, sağlayıcı sırları; `req.url` maskelenir (PII) — `lib/log-redact.ts`.
- **Kart numarası maskeleme** yazma anında (PCI SAQ A) — `lib/cc-mask.ts`.
- **SSRF koruması** (bulut metadata, loopback, özel ağlar) — `lib/ssrf.ts`, `lib/safe-fetch.ts`.
- **Spam filtresi** (deterministik; widget ve gelen e-posta) — `services/security/spam-filter.ts`.
- **Kimlik bilgisi şifreleme:** AES-256-GCM (`lib/credential-cipher.ts`, `APPS_CREDENTIAL_KEY`).
- **Denetim kaydı hash zinciri** (`AUDIT_CHAIN_SECRET`, `audit_chain_heads`) — kurcalama tespiti, budama işaretiyle (`services/audit/audit-chain.ts`).
- **Helmet** sıkı CSP, `X-Request-Id` korelasyonu, Zod `.strict()` gövde doğrulama, graceful shutdown (`SHUTDOWN_DRAIN_MS`).
- **HIPAA modu** (`lib/hipaa.ts`): retention tavanı + AI bölge kısıtı + BAA kaydı.
- **GDPR silme hakkı** (`services/retention/erasure.ts`).
- 32 bayt minimum sırlar: `JWT_SIGNING_KEY`, `WEBHOOK_HMAC_SEED`, `CUSTOMER_TOKEN_SECRET`, `UPLOAD_SIGNING_KEY`, `AUDIT_CHAIN_SECRET`.

---

## 9. Faturalama, planlar ve entitlement'lar

- **Planlar** (`apps/api/src/services/billing/subscription-service.ts`):
  - `growth` — listelenen fiyat, koltuk başı 9900 cent (`UNIT_PRICE_CENTS`), 200 AI çözümü dahil, entitlement yok. Deneme planı da budur (`TRIAL_DAYS`=14).
  - `enterprise` — teklif üzerine fiyat, tüm entitlement'lar.
- **Entitlement'lar** (`packages/types/src/entitlements.ts`): `white_label`, `sandbox`, `sla`, `sso` (SCIM dahil), `hipaa`, `siem_export`.
- **Abonelik durumları:** `trialing`, `active`, `past_due`, `read_only`, `canceled` (`read_only` → yazmalar engellenir).
- **Ölçüm:** `api_calls` (PAT çağrıları; 100.000 dahil, aşım 2950 cent/paket), `ai_resolutions` (aşım 50 cent). API ve AI aşım paketleri satın alınabilir. Faturalar dönem sonunda dondurulur, CSV indirilebilir.
- **AI günlük token tavanları:** LLM workspace 200 bin / global 2 milyon; embedding workspace 2 milyon / global 20 milyon (`mock`'ta sayılmaz).

---

## 10. Yapılandırma anahtarları ve özellik bayrakları (seçme)

Kaynak: `apps/api/src/config/env.ts` (1744 satır, Zod ile doğrulanır; `.env` parity testleri var), `apps/rtm/src/config/env.ts`.

| Kategori | Anahtarlar |
|---|---|
| Çalışma/bölge | `NODE_ENV`, `SIYAHTUS_REGION` (eu/us), `API_PORT`, `API_HOST`, `TRUST_PROXY_HOPS`, `SHUTDOWN_DRAIN_MS`, `LOG_LEVEL` |
| Veri depoları | `DATABASE_URL`, `DATABASE_APP_URL`, `DATABASE_POOL_SIZE`, `DATABASE_REPLICA_URL`, `REDIS_URL` |
| URL'ler | `API_BASE_URL`, `WEB_APP_URL`, `RTM_BASE_URL`, `WIDGET_BASE_URL`, `WEB_ORIGIN` (liste), `INBOUND_EMAIL_DOMAIN` |
| Sırlar | `JWT_SIGNING_KEY`, `WEBHOOK_HMAC_SEED`, `CUSTOMER_TOKEN_SECRET`, `UPLOAD_SIGNING_KEY`, `AUDIT_CHAIN_SECRET`, `APPS_CREDENTIAL_KEY`, `INBOUND_EMAIL_SECRET`, `LLM_API_KEY`, `EMBEDDING_API_KEY`, `SMTP_PASSWORD`, `STORAGE_S3_SECRET_ACCESS_KEY` |
| Token TTL | `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `CUSTOMER_TOKEN_TTL`, `AUTH_CODE_TTL`, `TWO_FACTOR_ENROLLMENT_TICKET_TTL`, `UPLOAD_URL_TTL` |
| Rate limit | `RATE_LIMIT_*` (§8) |
| **Özellik bayrakları** | `PILOT_MODE` (vars. false; pilot kısıtları + `PILOT_CONTACT_EMAIL`), `SIGNUP_ENABLED` (vars. true), `SIGNUP_EMAIL_VERIFICATION`, `RETENTION_ENABLED` (vars. false), `SCHEDULER_ENABLED`, `OTEL_ENABLED`, `APPS_LIVE_PROVIDERS` (brevo/freshdesk/telegram; vars. boş) |
| Yasal | `PRIVACY_POLICY_URL`, `TERMS_URL`, `TERMS_VERSION` |
| Faturalama | `TRIAL_DAYS`, `UNIT_PRICE_CENTS`, `AI_RESOLUTIONS_INCLUDED`, `AI_OVERAGE_CENTS`, `API_CALLS_INCLUDED`, `API_CALL_OVERAGE_CENTS`, `STRIPE_PROVIDER` |
| AI | `LLM_*` (provider, region, base URL, model, timeout, max output tokens, max prompt chars), `EMBEDDING_*` (provider, region, model, dimensions, timeout), `RETRIEVAL_THRESHOLD`, `AI_DAILY_*` |
| Mail | `MAIL_PROVIDER`, `MAIL_DIR`, `SMTP_*`, `ASSIGNEE_EMAIL_COOLDOWN_MS`, `MAIL_DAILY_*`, `MAIL_SECURITY_RESERVE` |
| Depolama/push/tarama | `STORAGE_*`, `PUSH_PROVIDER`, `PUSH_DIR`, `VIRUS_SCANNER` |
| Retention/SIEM | `RETENTION_*_DAYS`, `SIEM_PROVIDER`, `SIEM_DIR`, `SIEM_EXPORT_HORIZON_MS` |
| Zamanlayıcı | `SCHEDULE_JITTER_PCT`, `SCHEDULE_*_MS` (9 iş) |
| Webhook | `WEBHOOK_MAX_ATTEMPTS` |
| RTM | `RTM_PORT` (4001), `RTM_HOST`, `RATE_LIMIT_RTM_PER_SEC`, `RTM_MAX_CONNECTIONS`, `OTEL_*` |

Workspace düzeyindeki "bayraklar" ayar tablolarında: `requireTwoFactor`, `ipAllowlistEnforced`, `spamFilterEnabled`, `fileSharingEnabled`, `chatTimeoutSeconds`, `kb_settings.enabled`, `sales_tracker_settings.enabled`, `sla_policies.businessHoursOnly`, `sso_connections.enforced/allowIdpInitiated`, `ai_agents.active`, `skills.active`, `bots.enabled`.

---

## 11. Diğer domain servisleri (route'a doğrudan yansımayan)

- **Routing & kuyruk** (`services/routing/routing-service.ts`, ADR-08): kurallar → hedef takım (en spesifik, sonra fallback) → `accepting_chats` ve limit altındaki üyeler → atama (uzmanlık + `lastAssignedAt`), yoksa kuyruk.
- **Rule bot motoru** (`services/bots/*`): AI/embedding/KB'ye kesinlikle bağımlı değil (izolasyon testiyle doğrulanır).
- **AI responder** (`services/ai/ai-responder.ts`): müşteri mesajı kalıcı yazıldıktan sonra çalışır; AI hatası sohbeti AI yokmuş gibi bırakır (insana devir).
- **SLA iş saatleri** (`services/sla/business-hours.ts`), **kadro tahmini** (`services/staffing/*`), **satış atfı** (`services/sales/attribution.ts`), **hedef eşleştirme** (`services/goals/goal-matching.ts`), **görünüm fontu** (`services/appearance/panel-font.ts`), **CSV içe aktarım** (`lib/csv-import.ts`), **şablon değişkenleri** (`packages/types/src/template-variables.ts`), **zengin metin** (`rich-text.ts`), **persona** (`persona.ts`, 656 satır).

---

## 12. Uygulama durumu notları (stub / mock / eksik)

- Contract ↔ kod: 313/313 eşleşme; ayrıca `scripts/audit/*` ve `apps/api/src/config/*-audit.test.ts` ile endpoint-UI, şema tüketicisi, sayfasız liste, gereksinim kapsamı denetimleri mevcut.
- **Mock olanlar:** ödeme, push, virüs tarama (EICAR dışı), web crawler, Messenger/WhatsApp/Instagram/SMS adapter'ları, pazaryeri OAuth'u ve kart verisi (brevo/freshdesk hariç), varsayılan LLM/embedding, SIEM yalnız dosya.
- **Gerçek / canlıya hazır:** SMTP, S3, OpenAI uyumlu LLM ve embedding, Telegram (bayrakla), brevo/freshdesk doğrulayıcıları, giden webhook'lar, SAML, SCIM.
- **Bilinçli eksikler:** SCIM `PUT /Users/{id}`; kanal sağlayıcı imza doğrulaması; RTM üzerinden sohbet mutasyonları (`send_event` vb. tanımlı ama `not_allowed`).
- **Ölü/eksik kablolama:** 11 RTM push tipi tanımlı ama yayınlanmıyor (§5); `workflows` tablosu (Prisma `Workflow`) hiçbir kodda kullanılmıyor; birçok scope katalogda var ama hiçbir role verilmiyor (`billing_admin`, `ledger_read`, `multicast:rw` …).
- Kod tabanında `TODO/FIXME` işareti yok denecek kadar az (non-test kodda bulunmadı).
- Test hacmi: `apps/api/test` + `apps/rtm/test` altında 184 entegrasyon testi, `src` ve `packages` içinde 161 birim testi (çalıştırılmadı).

---

## 13. Paylaşılan paketlerin içeriği

- **`packages/contract`**: `openapi/openapi.yaml` (7228 satır; şemalar + path ref'leri), `openapi/paths/*.yaml` (37 dosya), `scripts/bundle.ts`, `src/generated/api.ts`, `src/document.ts`.
- **`packages/types`** (`src/`): `domain.ts` (roller, routing durumları, event/ticket/kanal/plan enum'ları, bölgeler), `scopes.ts`, `role-scopes.ts`, `rtm.ts`, `realtime-bus.ts`, `errors.ts`, `ids.ts`, `entitlements.ts`, `apps.ts` (103 kartlık katalog + mock veri üreteci), `integrations.ts`, `persona.ts`, `rule-bot.ts`, `custom-fields.ts`, `template-variables.ts`, `rich-text.ts`, `message-edit.ts`, `notifications.ts`, `push.ts`, `mobile-auth.ts`, `retention.ts`, `sla.ts`, `siem.ts`, `sandbox.ts`, `company.ts`, `widget.ts`, `work-schedule.ts`, `sales-tracker.ts`, `ticket-bulk.ts`, `knowledge-file.ts`, `ai-packages.ts`, `api-packages.ts`, `home.ts`, `deployment.ts`, `access-review.ts`, `ui-preferences.ts`, `panel-font.ts`, `referrer.ts`.
- **`packages/ai-mock`**: `embedding.ts` (leksikal deterministik embedding + chunk), `steps.ts` (skill adım birleşik tipi + doğrulama), `compiler.ts` (talimat → adımlar), `intent.ts`, `assist.ts` (özet/iyileştirme modları), `topics.ts` (konu kümeleme), `palette-intent.ts`, `bi-intent.ts` (soru → metrik).
- **`infra/db`**: `init/00-extensions.sql` (uzantılar + `siyahtus_app` rolü, dev parolası dosyada sabit), `pilot/10-app-role-password.sh`.
