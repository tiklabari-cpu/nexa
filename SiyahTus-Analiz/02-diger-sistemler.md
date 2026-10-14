# 02 — Diğer Sistemlerde Olanlar (Başlıklar)

> **Ne bu dosya?** Karşılaştırmada kullanılan sistemlerin özellikleri, başlık ve kısa madde düzeyinde. Ayrıntılı ekran ekran döküm `kaynaklar/` klasöründe.
> **Sistemler:**
> 1. **LiveChat** (my.livechatinc.com): canlı hesapta BFS ile gezildi.
> 2. **ChatBot.com** (app.chatbot.com): canlı hesapta gezildi; builder bölümü ayrıca ele alındı.
> 3. **Piyasadaki AI destek ajanları:** Intercom Fin, Zendesk AI, Ada, Decagon, Sierra, Freshworks Freddy. Bunlar web araştırmasıyla incelendi.
> 4. **iGaming'e özgü uygulamalar ve düzenlemeler:** Curaçao (CGA), MGA, UKGC.
>
> **Ayrıntılı kaynaklar:** `kaynaklar/livechat-kesif-raporu.md` · `kaynaklar/chatbot/` · `kaynaklar/igaming-ai-arastirma.md`
>
> İşaretler: 🔒 = üst plana kilitli · ⚠️ = dikkat çeken eksik/hata (ders olarak)

---

## 1. LiveChat

### 1.1 Kurulum ve onboarding
- Kod kurulum ekranı: snippet, Copy code, kurulum durumu kontrolü ("Code not installed")
- Geliştiriciye davet: e-posta ile gönderme, 13 gün geçerli davet linki
- Kurulum yolları: Google Tag Manager ve 14 platform eklentisi (WordPress, Shopify, WooCommerce, Wix, Webflow, Magento, Joomla, Drupal, Segment…)
- `<noscript>` yedek "Chat with us" linki
- ⚠️ Kod kurulana kadar her sayfa yüklemesinde onboarding ekranına yönlendirme yapılıyor; doğrudan linkler çalışmıyor

### 1.2 Home
- Başlangıç kontrol listesi (8 madde): örnek sohbet, widget önizleme, chatbot testi, Copilot, ekip daveti, kurulum, kampanyalar, kanallar
- İki ürün turu (6'şar adım)

### 1.3 Global kabuk
- Ürün değiştirici, deneme bandı ve "Upgrade" butonu, "Accepting chats" göstergesi
- **Ctrl+K komut paleti:** sayfalara gitme, arşivde arama, walkthrough'lar
- **Copilot paneli (Ctrl+G):** ürün yardımı, metrikler, "Train me with sources"
- News (Beamer) akışı
- Profil menüsü: bildirim tercihleri (olay bazlı), klavye kısayolları listesi, şirket bilgileri, hata bildirme
- Davet modalı: satır başına rol, toplu davet, link ile davet
- ⚠️ Davette varsayılan rol en yetkili rol ("Admin (billing access)")

### 1.4 Chats (sohbet ekranı)
- Sohbet listesi: sıralama, gruplama, satırda bekleme süresi, satırın üstüne gelince çıkan menü
- Sohbet başlığı menüsü: transfer (ajana veya gruba), etiket, kapatma
- **Composer:**
  - Mesaj / iç not modları
  - Emoji ve ":" kısayolu
  - "#" ile hazır yanıt, hazır yanıt değişkenleri
  - Dosya ekleme
  - Hızlı işlemler paleti
- Sohbet başına kalıcı taslak
- Okundu bilgisi ("Read • 33m")
- **Sağ panel:**
  - Müşteri kartı (ad, e-posta, konum ve harita)
  - Ziyaret bilgisi, ziyaret edilen sayfalar
  - Pre-chat cevapları, geçmiş sohbetler
  - Etiketler, uygulama panelleri
- Sohbet kısayolları (Alt+↑/↓ ile sohbet değiştirme, etiket, dosya, kapatma)
- ⚠️ Popover içindeyken Esc'e basınca üstteki modal da kapanıyor; yalnızca "#" yazılıyken bile Send aktif oluyor

### 1.5 Engage
- **Traffic:** gerçek zamanlı ziyaretçi listesi, ziyaretçi detayı, sohbet başlatma ve izleme
- **Kampanyalar** (tekrarlayan ve tek seferlik):
  - 10 şablon, 3 kategoride: Greet and inform, Promote and convert, Generate leads
  - Zengin kart: görsel, başlık (80 karakter), gövde (220 karakter), en fazla 5 buton (mesaj gönder / URL aç / kupon kopyala)
  - Hedef kitle: tüm ziyaretçiler, ilk kez gelenler, geri gelenler
  - 9 koşul tipi: çıkış niyeti, mevcut sayfa URL'si, konum, gezinme süresi, görüntülenen sayfa sayısı, referrer, sıralı sayfa ziyareti, oturumdaki herhangi bir sayfa, özel değişken (8 operatör)
  - Koşul birleştirme: hepsi/biri (AND/OR); sayfada kalma süresi 0–900 saniye
  - Masaüstü ve mobil önizleme
  - Kampanya satırı menüsü: çoğalt, düzenle, sil
  - Kampanya raporu
- **Goals:** hazır hedef ("Order placed") ya da sıfırdan; sayfa ziyareti veya özel olay tetikleyicisi
- **Sales tracker**

### 1.6 Automate
- **Chatbots:** ChatBot.com ürünü panelin içine gömülü (iframe)
  - Web sitesi kaynağı (tüm sayfalar, en fazla 200), tek sayfa
  - 🔒 "Custom answers" yalnızca Premium planda
- **Knowledge hub:** URL ve PDF kaynakları, URL doğrulaması
- **Hazır yanıtlar (canned responses):** paylaşılan ve kişisel, gruplar, değişkenler, arama
- **Önerilen yanıtlar:** olaylara bağlı (sohbet başladı, aktarıldı, sessiz kaldı, iyi/kötü puanlandı)
- **Yönlendirme kuralları:** URL (içerir / tam eşleşme), 🔒 müşteri konumu → grup
- **Workflows (Beta):**
  - 39 şablon
  - Tetikleyiciler: zaman, manuel, webhook; müşteri, sohbet ve ticket olayları; uygulama olayları
  - Eylemler:
    - Webhook, koşullu yol, bekleme
    - AI reasoning, dil algılama, ajan eşleştirme
    - Sohbet, ticket ve müşteri işlemleri
    - HubSpot, Klaviyo, Mailchimp, OpenAI, Salesforce, Shopify ve Slack eylemleri
  - Taslak → yayın akışı; JSON içe/dışa aktarma
- **Copilot:** sohbet içinde özet ve taslak; "Tell me more" ile otomatik sorular
- ⚠️ "Unsaved changes" uyarısı tutarsız; URL doğrulaması tutarsız

### 1.7 Archives
- Üç liste görünümü, arama (URL'de `query=`)
- 8 filtre tipi: tarih (özel aralık dahil), ajan, grup, puan, etiket (OR / AND / IS NOT, en fazla 20), atama, uygunluk, ülke
- Sıralama: en yeni / en eski
- Transkript, müşteri paneli, dışa aktarma
- ⚠️ Ajan e-postası URL'de açık görünüyor

### 1.8 Team
- Sekmeler: Agents, Chatbots, Groups, Suspended
- Ajan menüsü, durum, sohbet limiti (1–20), profil (ad, rol, gruplar, 2FA, şifre)
- Grup oluşturma
- Sahiplik devri
- Günlük ve haftalık özet e-postaları

### 1.9 Reports (27 rapor)
- **Summary:** Last 7 days, Dashboard
- **Chats:** Total chats, Chat engagement, Missed chats (ısı haritasıyla), Campaigns conversion, Tags usage, Chat satisfaction, Chat availability, Chat forms, 🔒 Chat duration
- **Agents:** 🔒 Agent performance, 🔒 Chat response times, 🔒 Staffing prediction, 🔒 Agent activity
- **Customers:** Queued customers, Queue abandonment
- **Insights:** Top customer questions, Alerts
- **Ecommerce:** Achieved goals, Tracked sales
- **Export raw data:** 🔒 Generate report, 🔒 Scheduled reports
- **Diğer:** Reviews, My saved views
- **Ortak özellikler:**
  - Filtreler: tarih hazır seçenekleri, ajan, grup, etiket, anahtar kelime
  - Karşılaştırma: önceki dönem, önceki yıl, özel
  - 24 saatlik dağılım, kırılım tablosu, ısı haritası, CSV dışa aktarma
  - Kayıtlı görünümler, benchmark (🔒)

### 1.10 Billing
- **Planlar:** Starter, Team, Business, Enterprise
  - Yıllık: ajan başına $19 / $49 / $79; aylık: $25 / $59 / $89
  - Plan karşılaştırma tablosu ve 165 ipucu metni
- **Faturalama dönemi:** aylık, yıllık, 2 yıllık, 3 yıllık
- **Koltuk sayısı:** 1–999
- **Diğer:** faturalar, hesap/fatura bilgileri, kart ekleme

### 1.11 Apps ve geliştirici
- **Marketplace:** 117 uygulama, 13 kategori, koleksiyonlar, sepet, 74 harici kurulum rehberi, partnerler
- **Build your app:** geliştirici platformu, ajan arayüzüne panel ekleyen uygulamalar
- **Webhook'lar:** 5 olay tipi, ekleme formu
- **Reports API**, platform dokümantasyonu

### 1.12 HelpDesk
- Ayrı bir ürün olarak tanıtılıyor ("Add HelpDesk ticketing system"). E-posta ticket kanalı (Settings → Email by HelpDesk)

### 1.13 Settings (26 öğe)
- **Kanallar:** Install LiveChat, Email by HelpDesk, Facebook Messenger, Apple Messages
- **Chat page:** barındırılan sohbet sayfası, kalite sayfası
- **Website widget:**
  - Görünüm: tema, renkler, konum, mobil görünüm, ek ayarlar, sitede canlı özelleştirme
  - Dil: 48 dil, metinleri özelleştirme
  - Uygunluk: her zaman / yalnız ajan varken
  - Karşılama ekranı: başlık, içerik, ayarlar
- **Formlar:**
  - Pre-chat formu (aç/kapa; alan tipleri: seçim listesi, dropdown, çoklu seçim, grup seçimi)
  - E-posta isteme (ajan X dakika yanıt vermezse / çevrimdışıyken)
  - Post-chat formu (puan ve yorum)
  - Ticket formu
- **Engagement:** Eye-catcher, Chat buttons, Quality showcase
- **Diğer:** Tags, Sales tracker
- **Chat settings:**
  - Atama: otomatik / manuel
  - Transkript iletme
  - Dosya paylaşımı
  - İnaktivite zaman aşımları: ajan yanıt vermezse aktar; inactive yap; kapat
- **Security:** Trusted domains, Banned customers, Credit card masking, Login settings
- ⚠️ **Gözlenen hatalar:**
  - Language sayfasında Enter'a basınca form gönderiliyor.
  - Değerler sessizce kırpılıyor.
  - Sayfa başlığı ve seçili menü öğesi bir önceki sayfada kalıyor.
  - Install görselinde yanlış lisans numarası var.

---

## 2. ChatBot.com

### 2.1 Bot oluşturma (`/stories/create`)
- **8 başlangıç kartı:**
  - Blank Bot
  - Website (AI ile site tarama)
  - Zendesk (AI)
  - KnowledgeBase (AI)
  - Customer Service Bot
  - Job Application Bot
  - FAQ Bot
  - Lead Generation Bot
- **"All templates":** 14 şablonluk galeri
- **Builder (görsel akış tasarımcısı):** ayrıntılar §2.9'da; builder keşfi bitince eklenecek

### 2.2 Chatbots listesi (Stories)
- Bot kartları, durum, menüler, arama
- ⚠️ Sonuç yoksa mesaj gösterilmiyor

### 2.3 Visitors (kullanıcılar)
- Ziyaretçi tablosu, 14 filtre alanı (AND/OR), URL'de saklanan görünümler
- Segmentler (statik, bot akışıyla dolduruluyor)

### 2.4 Training
- **Unmatched phrases:** botun anlamadığı ifadeler kuyruğu. Her ifade "train" (bir cevaba bağla) ya da "ignore" edilir.

### 2.5 Archives
- Yalnızca bitmiş sohbetler
- Canlı izleme veya devralma (takeover) ekranı yok

### 2.6 Reports (8 rapor)
- Sohbetler, ücretli sohbetler ("valid chat"), yoğun saat ısı haritası, mesajlar, ortalama mesaj, kullanıcılar
- Etkileşim popülerliği: hangi bot bloğu ne kadar kullanılıyor; "anlamadım 1x / 2x+" oranları
- ⚠️ Devir, çözüm, CSAT ve ajan metrikleri yok

### 2.7 Integrations (11)
- LiveChat (insana devir burada), diğer kanal ve uygulama entegrasyonları
- Her entegrasyon "botu seç → Connect" adımıyla başlıyor

### 2.8 Settings
- **Account**
- **Team** (3 sabit rol):
  - Owner
  - Administration: tüm özellikler, ekip ve abonelik yönetimi
  - Editor: abonelik ve bot ayarlarına erişemez, ekip yönetemez
- **Subscription:**
  - Starter $65, Team $169, Business $499 aylık; ilk ay $1
  - Limit aşılınca sohbet başına $0.05
  - Version history yalnızca Team+ planlarda
- **Diğer:** faturalar
- **Data management:** 🔒 otomatik veri silme yalnızca Business planda
- **Developers:** API token
- ⚠️ **Güvenlik hataları:**
  - Şifre değişiminde eski şifre sorulmuyor.
  - API token düz metin gösteriliyor, iptal edilemiyor.

### 2.9 Builder ayrıntıları
Ayrıntılı döküm: `kaynaklar/chatbot/chatbot-builder.md`

- **Şablonlar:** 14 şablon var, kategorisi yok. Önizleme olmadan doğrudan bot oluşturuyor; bot "Published" durumunda açılıyor (hiçbir kanala bağlı olmasa da).
- **Canvas (görsel akış):** Bloklar ağaç yapısında. "+" menüsünde, bulunulan yere göre farklı bloklar çıkıyor. Bloğun "⋯" menüsünde çoğaltma, silme gibi işlemler var.
- **Blok tipleri:**
  - **Bot Response:** metin, hızlı yanıt, buton, kart/carousel, görsel ve gecikme. Mesaj sınırı yaklaşık 1024 karakter. A/B test için en fazla 5 varyant, toplamları %100 olmalı.
  - **User Input:** niyet ve eşleşme bloğu. Anahtar kelime (en fazla 50 karakter) ve eğitim cümlesi (en fazla 256 karakter) içeriyor. Akışın her yerinden tetiklenebilen niyetler tanımlanabiliyor.
  - **Question:** soru sorup cevabı bir attribute'a kaydediyor (slot doldurma), doğrulama yapılabiliyor.
  - **Diğer bloklar:** Filter/koşul, Goto/jump, Set attribute, Tag, Webhook, Send transcript, Close chat, LiveChat "Transfer chat".
- **AI:**
  - Sıralama şöyle: önce kendi kuralların, sonra AI Assist ile Knowledge Hub'dan cevap (web sayfaları, makaleler, Files beta), en son "tekrar sorar mısınız" diyen fallback.
  - Bilgi yoksa uydurmuyor.
  - Ayarlar yalnızca model seçimi (ChatBot AI Assist / OpenAI GPT-4.1) ve iki güven eşiğinden (%70 ve %84) ibaret.
  - ⚠️ Talimat, ton ya da yasak konu alanı yok.
- **Entities & Attributes:** sistem ve özel entity'ler, konuşma değişkenleri.
- **Test paneli:** Yayınlanmamış taslağı çalıştırıyor. Debug modunda tetiklenen bloklar, eşleşme puanı, başarısız deneme sayacı ve tam JSON görünüyor.
- **Training:** Anlaşılmayan sorular ve AI'ın verdiği cevaplar burada toplanıyor; buradan düzeltilebiliyor.
- **Sürüm:** Taslak ve yayın ayrı tutuluyor; geçmiş bir sürüme geri dönülebiliyor.
- **İnsana devir:** Yalnızca LiveChat "Transfer chat" bloğuyla yapılıyor; blok başarılı/başarısız olarak dallanıyor. Başarısız deneme sayacıyla devir de kurulabiliyor.
- ⚠️ **Zayıf yanlar:**
  - AI için koruma kuralları (guardrail) yok.
  - Cevaplarda kaynak gösterilmiyor.
  - Soru eşleştirme yalnızca bulunulan seviyede çalışıyor. Örneğin "şifremi unuttum" alt menüdeki niyete eşleşmedi.
  - Şablon, sessizce bir segment oluşturuyor.

---

## 3. Piyasadaki AI destek ajanları

### 3.1 Ortak model: beş katman
1. **Bilgi (Knowledge):** makale, URL, PDF, soru-cevap parçaları
2. **Davranış talimatı (Guidance / Instructions / Coaching):** düz yazıyla kurallar, ton, netleştirme, yasaklar
3. **Prosedür (Procedure / Playbook / AOP / Journey):** çok adımlı akış, "ne zaman kullanılır" koşulu, dallanma
4. **Aksiyon / veri bağlayıcı (Tools / Data connectors):** API ile okuma/yazma
5. **Devir kuralları (Escalation):** ne zaman insana geçileceği, hangi ekibe gidileceği, müşteriye ne söyleneceği

**Bu katmanları çevreleyen döngü:** simülasyon/test → sürümlü yayın → çözülemeyen soruların analizi → koçluk

### 3.2 Intercom Fin
- Knowledge (yardım merkezi, URL, snippet, dosya)
- **Guidance:** iletişim stili, netleştirme kuralları, çakışma denetimi ("Optimize")
- **Procedures:** adımlar + araçlar + guidance; "When to use" giriş koşulu
- **Data connectors:** API GET/POST
- **Escalation Guidance:** devir için ayrı kurallar (en fazla 100 aktif kural)
- **Test:** Simulations (sahte connector çıktısı, simüle saat), batch test, önizleme
- **Analiz:** çözülemeyen soru kümeleri, AI içerik önerileri

### 3.3 Zendesk AI agents
- Yardım merkezinden generative cevaplar, persona ve ton
- **Use cases (intents) + generative procedures;** klasik dialog akışlarıyla birlikte ("hibrit ajan")
- Automated resolution (LLM ile doğrulanan çözüm), BSAT
- autoQA ile AI konuşmalarının puanlanması

### 3.4 Ada
- **Playbooks:** düz dille yazılmış SOP'lar; her adımı denetleyen bir "adherence supervisor"
- **Coaching:** geçmiş konuşmalardan düzeltme
- ⚠️ Playbook çalışırken coaching dikkate alınmıyor ve bilgi bankası araması yapılamıyor

### 3.5 Decagon
- **AOP (Agent Operating Procedures):** ad, giriş koşulları, düğüm düğüm adımlar
- **Duet / AOP Copilot:** SOP'tan taslak AOP üretir, simülasyonla test eder

### 3.6 Sierra
- **Journeys:** kodsuz (Agent Studio) ya da kod olarak (Agent SDK, versiyon kontrolüyle)
- **Simulations:** SOP'tan otomatik test üretimi, "hakem" model ile uyum puanı, regresyon

### 3.7 Freshworks Freddy
- Dosya, URL, KB ve harici connector'lar (SharePoint, Drive, Confluence)
- Agent Studio, doğal dille anlatılarak kurulan agentic workflow'lar, Freddy Insights

---

## 4. iGaming'e özgü uygulamalar ve düzenlemeler

### 4.1 Destek konuları (20 konu kataloğu)
- **Ödeme:** yatırım hesaba geçmedi; ödeme yöntemleri; yanlış hesaba veya ağa gönderim
- **Çekim:** beklemede; reddedildi
- **Hesap:** KYC/doğrulama; giriş/şifre; hesap kilitli; bilgi değişikliği; çoklu hesap
- **Bonus:** bonus alma; çevrim şartı; promosyon/turnuva
- **Oyun:** bahis sonucu itirazı; oyun ve teknik sorun
- **Sorumlu oyun:** self-exclusion; sorumlu oyun sinyalleri; limit ayarlama
- **Diğer:** şikâyet; erişim adresi

### 4.2 Türkiye ödeme bağlamı
- EFT ile FAST arasındaki saat farkı, Papara akışı, USDT ağ seçimi (TRC20 / ERC20)
- "Talep oluştur → gösterilen hesaba gönder → açıklamaya kod yaz" akışında sık hatalar

### 4.3 Uyum kuralları (G1–G19)
- **Sorumlu oyun:**
  - Self-exclusion talebi ve sorumlu oyun sinyalleri derhal insana gider.
  - Kendine zarar ifadesinde acil öncelik.
  - Risk bayraklı sohbette promosyon yasak.
  - Reşit olmama şüphesi ve limit yükseltme talepleri insana gider.
- **Para:** söz, garanti ya da süre taahhüdü yok; "kontrol ettim" demek yok; bahis tavsiyesi yok; mükerrer yatırım teşviki yok.
- **Veri:** şifre, OTP, kart, CVV, seed phrase asla istenmez. KYC belgesi yalnızca güvenli kanaldan alınır. AML (kara para) kontrolleri açıklanmaz.
- **Yasal:** erişim engelini aşma yöntemi önerilmez; şikâyetler insana gider (CGA).
- **Şeffaflık:** AI olduğu söylenir; "insanla görüşmek istiyorum" talebi her zaman karşılanır; bilgi yoksa uydurulmaz; tutarlılık sağlanır.

### 4.4 Düzenleyici dayanaklar
- **Curaçao (CGA/LOK):**
  - Sorumlu oyun politikası.
  - Şikâyet yönergesi v1.1: sorumlu oyun konularındaki ve karmaşık şikâyetler insan tarafından yürütülmeli; AI kayıtları tutarlılık açısından izlenmeli.
- **MGA:** Player Protection Directive, ADR (alternatif uyuşmazlık çözümü) yönergesi.
- **UKGC:** Müşteri etkileşimi rehberi (SR Code 3.4.3), risk göstergeleri, otomatik kararların insan incelemesine açık olması.

### 4.5 Kalite ölçümü
- "Containment" tek başına başarı ölçüsü değil.
- **Önerilen ölçüler:**
  - Onaylı çözüm
  - Yanlış çözüm (72 saat içinde aynı konuyla tekrar gelme)
  - Zorunlu devire uyum (%100)
  - Devir kalitesi
  - BSAT
  - Tutarlılık
- **QA süreci:** örneklem + risk bayraklı sohbetlerin tamamı; puan kartı; LLM ön puanlama, Ekip Lideri onayı; kalibrasyon.
