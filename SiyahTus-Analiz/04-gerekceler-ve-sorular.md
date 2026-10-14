# 04 — Eklenebilecekler: Sebep, Gerekçe ve Netleştirilecek Sorular

> **Ne bu dosya?** [03-eklenebilecekler.md](03-eklenebilecekler.md) dosyasındaki 109 maddenin her biri için sırasıyla şunlar yazılı:
> - **Ne:** maddenin kısaca ne olduğu.
> - **Neden gerekli:** iGaming canlı desteğinde neden önemli olduğu.
> - **Gerekçe / kanıt:** LiveChat, ChatBot.com, piyasadaki AI ajanları, araştırma ve nexa kodu.
> - **Yapılmazsa:** ortaya çıkacak risk.
> - **Bağımlılıklar:** önce yapılması gereken maddeler.
> - **Netleştirilecek sorular:** senin vermen gereken kararlar.
>
> **Sorular nasıl çalışır?** Her sorunun yanında bir **"Önerilen varsayılan"** var. Bir soruyu cevaplamazsan, kodlamayı yapacak AI o varsayılanla ilerler. Cevap vermek istediğin soruları aşağıdaki **Karar kaydı** tablosuna yaz. Tablo, maddelerin içindeki varsayılanların önüne geçer.
>
> **Terim notu:** Bu dosyada "Thread ID" ve "Chat ID" her zaman **senin** anlamınla kullanılıyor: Thread ID = üyenin o günkü konuşma grubu, Chat ID = her bağlantı. nexa kodundaki `chat` ve `thread` kelimeleri bunun tersini anlatıyor; ayrıntılar ID-01'de.
>
> Kod referansları `nexa-main` köküne göredir ve 2026-10-14'te yalnızca okunarak doğrulanmıştır.

---

## Önce cevaplanması gereken kararlar

Aşağıdaki kararlar birçok maddeyi etkiliyor. Kodlamaya başlamadan önce bunların cevaplanması önerilir; cevaplanmazsa varsayılanla ilerlenir.

| # | Karar | İlgili madde | Önerilen varsayılan | Senin cevabın |
|---|---|---|---|---|
| K1 | **Thread ID / Chat ID modeli:** "A" seçeneği mi (nexa'nın mevcut Chat'i günlük kapsayıcı = Thread ID olur, her bağlantı yeni bir nexa Thread'i = Chat ID olur; ekrandaki adlar senin diline göre değiştirilir), "B" mi (yeni bir "gün thread'i" tablosu)? | ID-01, ID-02 | **A** (yeni tablo gerekmez; raporlar, SLA ve faturalama sayıları değişmez) || ✅ **A** (onaylandı) |
| K2 | **"Yeni bağlantı" ne zaman sayılır, boşta kalma süresi ne olsun?** | ID-02 (S2, S3) | Önceki konuşma kapandıktan sonra gelen ilk mesaj. Sayfa yenileme ya da ikinci sekme yeni Chat ID açmaz. Widget konuşması **30 dakika** sessiz kalınca kapanır; kiracı bu süreyi değiştirebilir || ✅ Varsayılan onaylandı |
| K3 | **Gün sınırı** | ID-04 | Kiracının saat dilimi, varsayılan **Europe/Istanbul 00:00**. Süren konuşma gece yarısında bölünmez || ✅ Varsayılan onaylandı |
| K4 | **Farklı cihazdan gelen üye nasıl tanınsın?** (kullanıcı adı ve e-posta doğrulanmamış bilgiler; bunlarla geçmiş açmak başkasının konuşmasını sızdırabilir) | ID-03 | Yalnızca iki yolla: (a) operatör sitesi giriş yapmış üye için **imzalı kimlik** gönderirse; (b) **ajan onaylarsa**. Kullanıcı adı ya da e-posta tek başına eşleştirme yapmaz, yalnızca "olası eşleşme" olarak gösterilir || ✅ **A + doğrulama mekanizması kurulsun:** Token'ı **bizim widget'ımız üretir** (imzalı, çerez/localStorage'da saklanır); widget geri gelişte okuyup sunucuda doğrular, gereken mekanizma kurulsun. Başka cihazdan gelişte ajan onayı yolu geçerli |
| K5 | **AI önceki konuşmayı üyeye ne kadar açık anlatsın?** | ID-03, AI-02 | Yalnızca konu düzeyinde ("Bugün bir yatırım konusunda yazmıştınız, aynı konu mu?"). Tutar, IBAN ya da işlem numarasını kendiliğinden tekrar etmez || ✅ Varsayılan onaylandı |
| K6 | **Rol eşlemesi:** Kurucu = owner, Yönetici = admin, Ekip Lideri = yeni rol, Ekip Üyesi = agent; vice owner kaldırılsın mı? | RL-01 | Evet. Vice owner yeni atamalarda sunulmaz, mevcutlar Yönetici'ye taşınır || ✅ Varsayılan onaylandı |
| K7 | **İzin matrisinin varsayılanları ve matrisi kim değiştirir** | RL-02 | Ekip Üyesi yalnızca kendi ekibini görür. Ekip Lideri raporlarda yalnızca kendi ekibini görür. Yönetici faturalamayı görür ama değiştiremez. Matrisi yalnızca Kurucu değiştirir || ✅ Öneri onaylandı |
| K8 | **AI motoru:** Skill'i yeni bir kavram açmadan çok turlu "prosedür"e genişletmek ve ADR-14'e ek not düşmek | AI-03 | Evet. Adımlar yapılandırılmış liste olur; her adımda düz yazı talimat. "SOP'u yapıştır, taslağı AI çıkarsın" yardımcısı da eklenir || ✅ Varsayılan onaylandı |
| K9 | **Sohbet başında insan ne zaman atansın?** (bugün AI ile ajan aynı sohbette paralel çalışıyor) | AI-11 | **"Önce AI":** AI konuşurken ajana atama yapılmaz, atama devir anında olur. Ajan araya yazarsa sohbeti devralmış sayılır || ✅ **"Önce AI" + AI karar verir:** Sohbetin çözülüp çözülmediğine AI o an karar verir; "çözüldü" kriterlerini kiracı workspace içindeki ilgili alanlardan tanımlar. Bazı durumlarda insana aktarılır (ör. AI çözemiyorsa, hesap/şifre kurtarma, para yatırma… liste uzayabilir); bu devir kurallarının ince ayarını Yönetici/Kurucu workspace içinden yapar |
| K10 | **AI'ın devrettiği ama ajanın hiç yazmadığı sohbetler "AI çözümü" sayılıp faturalansın mı?** | AI-11, ADR-09 | Hayır || ✅ Varsayılan onaylandı |
| K11 | **AI Agent ve Copilot bilgileri tek depoda birleşsin mi?** (eski karar Q6: ayrı) | AI-14 | Evet: tek depo, her kaynakta "kim kullanır" seçimi || ✅ Varsayılan onaylandı |
| K12 | **Dil modeli sağlayıcısı ve veri bölgesi** | AI-16 | Pilotta OpenAI, bölge `us`. Kiracı sözleşmesine yurt dışı aktarım maddesi eklenir; maskeleme (AI-26) modelden önce çalışır || ✅ Varsayılan onaylandı |
| K13 | **"Site açılmıyor / güncel adres" sorularında AI ne desin?** (hukuki konu) | AI-08 (G14) | AI adres, VPN ya da engel aşma yöntemi önermez; yalnızca kiracının onayladığı sabit bir metni kullanır. **Hukuk görüşü alınmalı** || ✅ **Kiracının girdiği bilgi esas:** AI bu konuda kiracının girdiği bilgiyi kullanır; bilgiyi o an bir kaynaktan çekebilir (güncel cevap) ya da sabit bir linke yönlendirebilir. Hangisinin kullanılacağı ve link, değiştirilebilir bir ayardır |
| K14 | **Ekip kuyrukları:** Finans, KYC/Risk, Bonus, Sorumlu Oyun, Teknik, Şikâyet. Sabit mi, şirket tanımlı mı? | AU-01 | 6 hazır şablon gelir. Şirket bunları yeniden adlandırıp yenisini ekleyebilir. "Sorumlu Oyun" kuyruğu silinemez; buna yalnızca eğitimli ajanlar üye olabilir || ✅ Varsayılan onaylandı |
| K15 | **İlk iGaming platform entegrasyonu hangisi olsun?** (F2) | KN-06 | Pilot operatörün kullandığı platform. İlk sürüm yalnızca okuma yapar || ✅ **Şimdilik 1–2 platform yalnızca "Bağla" butonu olarak görünsün, buton tıklanamaz** (pasif, "yakında") |
| K16 | **Ödeme sağlayıcısı ve fatura kesen şirketin ülkesi** | BL-01 | Pilotta havale/SWIFT ile devam edilir. Yüksek riskli sektörü kabul eden bir sağlayıcıyla görüşülür; şirketin ülkesi önce netleşmeli | ✅ **Şimdilik SWIFT + kripto + Stripe:** SWIFT/banka havalesi; kripto ödeme seçilince müşteri "Adres isteyin" bölümüne yönlendirilir (cüzdan adresi talep üzerine verilir); Stripe da bağlanabilir |

> **Karar kaydı durumu (2026-10-14):** K1–K16'nın hepsi cevaplandı. K4, K9, K13, K15 ve K16 varsayılandan farklı ya da daha geniş cevaplandı. Bunların hangi maddeleri nasıl değiştirdiği hemen aşağıdaki "Kararların maddelere etkisi" bölümünde yazıyor. Uygulayıcı, maddelerin içindeki varsayılanlar yerine bu bölümü esas alır.

### Kararların maddelere etkisi

**K4: Üye kimliğinin token veya çerezle doğrulanması (token'ı SiyahTuş widget'ı üretir)**
- **Etkilediği maddeler:** ID-03, AI-02, GV-01, ID-02
- **Düzeltme (2026-10-14):** Token'ı operatör sitesi değil, **bizim widget'ımız (SiyahTuş) üretir.** Operatörün geliştirme yapması gerekmez.
- **Mekanizma:**
  1. **İlk ziyaret:** Widget bir oturum başlatır. Sunucu, platformun gizli anahtarıyla **imzalı bir üye tokenı** üretir. Kullanılabilecek yöntemler: HMAC-SHA256 ya da imzalı JWT.
     - Token şunları içerir: müşteri ID, license ID, cihaz/tarayıcı ID'si, düzenlenme zamanı, son geçerlilik, sürüm.
  2. **Saklama:** Widget token'ı kendi alan adında saklar.
     - Önce **partitioned (CHIPS) `Secure; HttpOnly; SameSite=None` çerez** denenir. Widget iframe olduğu için tarayıcıların üçüncü taraf çerez kısıtlarına uygun olmalı.
     - Çerez yazılamazsa yedek olarak widget'ın `localStorage`'ı kullanılır.
  3. **Geri gelişte:** Widget token'ı okuyup sunucuya gönderir. Sunucu sırasıyla imzayı, süreyi ve license eşleşmesini doğrular, sonra iptal listesine bakar.
     - Geçerliyse aynı müşteri kaydına bağlar. Gün içi hafıza (AI-02) ve Thread ID (ID-02) bu doğrulanmış kimlik üzerinden çalışır.
     - Geçersiz ya da değiştirilmişse yeni anonim kimlik açılır ve olay loglanır.
  4. **Yenileme ve iptal:** Token belirli aralıklarla yeniden imzalanır (kayan süre). Ajan veya Yönetici bir üyenin tokenlarını iptal edebilir. Anahtar değişimi (rotation) desteklenir.
- **Bugünkü açık kapatılır:** Bugün tarayıcıdaki düz `customer_id` anahtar gibi kullanılıyor ve widget token uç noktası herkese açık; bilen biri başkasının açık sohbetini okuyabilir. Bundan sonra müşteri ID'si tek başına kabul edilmez, yalnızca imzalı token kabul edilir.
- **Kullanıcı adı ve e-posta:** Pre-chat'te yazılanlar müşteri kaydına bilgi olarak eklenir. Tek başına başka bir kayıtla otomatik eşleştirme yapmaz.
- **Sınır:** Token tarayıcıya bağlıdır. Üye başka cihazdan ya da temizlenmiş tarayıcıdan gelirse otomatik tanınmaz. Bu durumda ajan ekranında "olası eşleşme (kullanıcı adı aynı, doğrulanmamış)" görünür ve **ajan onayıyla** birleştirilebilir. Ajan onayıyla birleşen geçmiş ajan ekranında görünür, AI hafızasına girmez.
  - İleride operatör sitesi imzalı kimlik göndermek isterse (F2), aynı doğrulama altyapısına ikinci bir giriş yolu olarak eklenebilir.
- **Panel:** Ayarlar › Güvenlik › "Üye tanıma": token süresi, anahtar yenileme, "kullanıcı adına göre olası eşleşmeyi ajana göster" seçeneği, toplu iptal.

**K9: "Önce AI", çözüldü kararını AI verir, devir kuralları kiracıda**
- **Etkilediği maddeler:** AI-09, AI-11, AI-12, AI-03, AI-25, AU-01
- **Önce AI:** AI konuşurken sohbet ajana atanmaz.
- **AI çözüldü kararını verir:** Sohbetin çözülüp çözülmediğine AI o an karar verir.
  - Karar, kiracının workspace'te tanımladığı **"çözüldü kriterleri"**ne göre verilir: konu veya prosedür bazında "şu bilgiler verildiyse ve oyuncu onayladıysa çözüldü" gibi alanlar.
  - Karar, gerekçesiyle birlikte karar loguna (ID-08) yazılır.
- **Devir kuralları yapılandırılabilir bir listedir** (AI-09 ve AI-12 genişler). Yönetici ve Kurucu, **Ayarlar › AI Agent › Devir kuralları** ekranından yönetir.
  - Her kural şu alanlardan oluşur: tetikleyici, hedef ekip ve öncelik.
    - Tetikleyici şunlardan biri olabilir: konu/prosedür, anahtar ifade, AI'ın çözememesi, oyuncunun insan istemesi, risk bayrağı.
    - Hedef ekip, AU-01'deki kuyruklardan biridir.
  - Hazır gelen örnek kurallar: AI çözemedi; hesap ve şifre kurtarma; para yatırma.
  - Kiracı kural ekleyebilir, kapatabilir ve sıralayabilir. Platformun kilitli uyum kuralları (G1–G5, G13, G15) kapatılamaz.
- **Ölçüm:** AI-25 metriklerinde "AI'ın çözüldü dediği" ile "oyuncunun onayladığı" ayrı ayrı ölçülür. Yanlış çözüm, 72 saat içinde tekrar gelmeyle izlenir.

**K13: Erişim ve adres soruları kiracının bilgisinden cevaplanır**
- **Etkilediği maddeler:** AI-08 (G14), AI-13, AI-14
- G14'teki "AI adres önermez" varsayılanı **kaldırıldı**.
- Bu konu için kiracıya **"Erişim bilgisi"** ayarı verilir. Üç kaynak türünden biri seçilir:
  - (a) Bilgi bankasındaki bir kaynak veya tablo satırı.
  - (b) Kiracının verdiği, o an çekilen dinamik bir kaynak: örneğin bir URL veya JSON uç noktası. Cevap kısa süreli önbelleğe alınır; çekilemezse son bilinen değer kullanılır, o da yoksa devir yapılır.
  - (c) Sabit bir yönlendirme linki.
- AI yalnızca bu ayardan gelen bilgiyi söyler; kendisi adres veya VPN uydurmaz. Ayar değiştirilebilir ve her değişiklik AI-21 değişiklik geçmişine yazılır.
- Hukuki sorumluluk kiracıdadır. Panelde bu bilgiyi kiracının girdiği belirtilir.

**K15: Platform entegrasyonları yer tutucu olarak görünür**
- **Etkilediği maddeler:** KN-06, AI-28
- Ayarlar › Entegrasyonlar'da 1–2 iGaming platformu (örneğin BetConstruct, EveryMatrix) kart olarak görünür. Kartın üzerinde "Bağla" butonu vardır ama **pasiftir** (tıklanamaz, "Yakında" etiketi taşır).
- Arka uçta bağlantı akışı yoktur; yalnızca katalog kaydı ve arayüz kartı eklenir.
- Gerçek entegrasyon F2'de, platform seçimi netleşince yapılır.

**K16: Ödeme yöntemleri (SWIFT + kripto + Stripe)**
- **Etkilediği maddeler:** BL-01, BL-02, BL-03
- **Ödeme yöntemleri** Billing › Ödeme ekranında üç seçenek olarak sunulur:
  - **SWIFT / banka havalesi:** Banka bilgileri ve ödeme referans kodu gösterilir. Ödeme elle onaylanır ve abonelik ondan sonra aktifleşir. Bugünkü elle aktivasyon yolu devam eder.
  - **Kripto:** Müşteri ödeme yöntemi olarak kriptoyu seçince **"Adres isteyin"** bölümüne yönlendirilir. Bu bir talep formudur: ağ seçimi (ör. USDT TRC20/ERC20), tutar ve fatura bilgisi istenir.
    - Cüzdan adresi otomatik gösterilmez, talep üzerine SiyahTuş ekibi verir.
    - Ödeme TXID ile elle onaylanır.
    - Talep, Billing yönetiminde bir kuyruğa düşer.
  - **Stripe:** Kart ödemesi için bağlanabilir. Kod tarafında bugünkü mock `payment-provider` arayüzüne bir Stripe adaptörü eklenir. Anahtarlar ortam ayarından okunur; webhook ile abonelik durumu güncellenir.
- **Sağlayıcı yapısı:** Her yöntem bir "ödeme sağlayıcısı" kaydı olarak ele alınır: `swift_manual`, `crypto_manual`, `stripe`. Hangilerinin görüneceğini platform yöneticisi açıp kapatabilir.
- **Faturalar:** Faturada ödeme yöntemi ve referans (SWIFT referansı, TXID, Stripe ödeme ID'si) yer alır (BL-02).
- **Not:** Stripe, iGaming'e yazılım satan işletmelerde ek inceleme isteyebilir ya da hesabı reddedebilir. Bu yüzden SWIFT ve kripto yolları Stripe'a bağımlı olmadan çalışacak şekilde tasarlanır.

Maddelerin içinde bunların dışında daha ayrıntılı sorular da var. Onların hepsinin önerilen varsayılanı yazılı.

---
## 1. AI Agent çekirdeği (AI)

> Bu parça, 03 dosyasındaki **1.1 Konuşma motoru** (AI-01…AI-12) ve **1.2 Bilgi modeli**nin ilk üç maddesinin (AI-13…AI-15) neden gerektiğini anlatır. Teknik ayrıntı ve kod yolları [05](05-uygulama-rehberi.md) dosyasındadır.
>
> **Bugünkü durumun tek cümlelik özeti:** SiyahTuş'un AI'ı her mesajı ayrı ayrı, kelime eşleştirmesiyle değerlendiriyor; önceki mesajları hatırlamıyor, sorduğu sorunun cevabını okumuyor, kendiliğinden insana devretmiyor ve devirden sonra da susmuyor. Bu yüzden "teşhis sorusu sor → çözmeye çalış → çözemezsen özetleyip devret" akışı bugün kurulamıyor (`kaynaklar/nexa-ai-motoru.md`).
>
> Terimler: **oyuncu** = sitede destek isteyen üye · **ajan** = insan destek temsilcisi · **devir** = sohbetin AI'dan insana geçmesi · **bağlantı (chat ID)** ve **günlük thread (thread ID)** senin tanımınla (03, sabit karar 3); kod karşılıkları ID-01'de sabitlenir.

---

### AI-01 — Sohbet içi konuşma hafızası
- **Ne:** AI, oyuncunun her yeni mesajını cevaplarken o sohbetteki önceki mesajları görür: kendi sorduğu sorular, oyuncunun verdiği cevaplar, gönderilen ekler. Cevabını "yeni bir mesaj geldi" gibi değil, konuşmanın devamı olarak verir.
- **Neden gerekli:** "Param yatmadı" diyen oyuncuya AI "Hangi yöntemle, saat kaçta yatırdınız?" diye sorar. Oyuncu "Papara, 13:40" diye cevap verdiğinde AI'ın bunun bir önceki sorunun cevabı olduğunu anlaması gerekir. Bugün bu cevap sıfırdan, bağımsız bir mesaj gibi değerlendiriliyor: AI ya susuyor ya da alakasız bir şey söylüyor. Canlı destek konuşması birkaç mesajlık soru-cevaptan oluşur; hafıza olmadan teşhis yapılamaz.
- **Gerekçe / kanıt:**
  - Piyasa: Intercom Fin, Zendesk AI agents, Ada, Decagon ve Sierra konuşmanın tamamını bağlam olarak kullanır; çok adımlı akışları (Procedures, Playbooks, AOP, Journeys) bunun üzerine kuruludur (`kaynaklar/igaming-ai-arastirma.md` §1.2). ChatBot.com da akış içinde önceki cevapları "attribute" olarak saklar (`kaynaklar/chatbot/chatbot-uygulama.md` §8, "Set attributes" dersi).
  - nexa bugün: AI'ı çağıran kod konuşma geçmişi göndermiyor (`apps/api/src/services/ai/ai-responder.ts:95-98`), motor geçmişi boş liste kabul ediyor (`skill-engine.ts:285`), cevabı yazan modele yalnız son mesaj gidiyor (`provider/answer-prompt.ts:79-82`). Model bağlantısı çok mesajlı konuşmayı zaten destekliyor (`provider/llm-provider.ts:40-48`); eksik olan, geçmişin toplanıp verilmesi.
  - Ek bulgu: oyuncu art arda iki-üç kısa mesaj yazarsa her biri ayrı iş olarak sıraya giriyor ve her birine ayrı cevap üretiliyor (`apps/api/src/routes/customer.ts:342-352`).
- **Yapılmazsa:** AI soru sorar ama cevabı anlamaz; oyuncu aynı şeyi tekrar tekrar yazar ve sinirlenir. Ajan sohbeti devraldığında bilgilerin yarısı kaybolmuş olur. AI-03 (prosedür) ve AI-04 (bilgi toplama) hiç çalışamaz.
- **Bağımlılıklar:** AI-16 (gerçek dil modeli), ID-01 (hangi mesajların "aynı sohbet" sayılacağı), GV-02 (kalıcı AI iş kuyruğu). Bu maddeye dayananlar: AI-02, AI-03, AI-04, AI-05, AI-09.
- **Netleştirilecek sorular:**
  1. Oyuncu art arda birkaç kısa mesaj yazdığında AI kısa bir süre bekleyip hepsine tek cevap mı versin? Önerilen varsayılan: Evet. Son mesajdan sonra 3 saniye beklenir, biriken mesajlar tek tur olarak cevaplanır.

### AI-02 — Gün içi hafıza (thread ile)
- **Ne:** Oyuncu aynı gün yeniden yazdığında (yeni chat ID, aynı thread ID) AI, o günkü önceki bağlantıların kısa özetini görür: konu, toplanan bilgiler ve konuşmanın nasıl bittiği (çözüldü mü, devredildi mi, yarım mı kaldı).
- **Neden gerekli:** Oyuncu sabah "Papara ile 2.500 TL yatırdım, gelmedi" yazıp çıkıyor, öğleden sonra "hâlâ gelmedi" diye dönüyor. AI'ın "Az önce Papara yatırımınızla ilgili yazmıştınız, konu finans ekibimize iletilmişti; durumu tekrar iletiyorum" diyebilmesi gerekir. Aksi halde oyuncuya aynı 6 soru yeniden sorulur; bu, iGaming'de en çok şikâyet üreten deneyimlerden biridir. Aynı gün aynı sorunla ikinci kez gelen oyuncu "çözülmemiş sorun" sinyalidir ve insana daha hızlı ulaşmalıdır.
- **Gerekçe / kanıt:**
  - Senin kararın: "AI, thread ID ile üyenin o günkü önceki mesajlarını ve konusunu hatırlar" (03, sabit karar 3).
  - Araştırma: "72 saat içinde aynı konuyla tekrar gelme" yanlış çözüm sinyali olarak ölçülüyor (`kaynaklar/igaming-ai-arastirma.md` §5.1–5.2). LiveChat'te ajan, oyuncunun geçmiş sohbetlerini sağ panelde görüyor; nexa'da bu yalnız Müşteriler sayfasında var (`kaynaklar/eksikler.md` [D39]).
  - nexa bugün: AI'ın önceki sohbetlere hiçbir erişimi yok. Sohbet kapandıktan sonra oyuncu yeniden yazınca yeni bir sohbet açılıyor (`apps/api/src/routes/customer.ts:813-841`) ve AI yalnız o anki mesajı görüyor.
- **Yapılmazsa:** Oyuncu her dönüşte sıfırdan başlar, sinirli oyuncu daha da sinirlenir, gün içinde tekrarlayan sorunlar görünmez kalır. Ajan aynı oyuncunun sabahki devrini fark etmeden ikinci bir iş açar.
- **Bağımlılıklar:** ID-01, ID-02 (günlük thread), ID-03 (aynı oyuncuyu tanıma), ID-04 (gün sınırı ve saat dilimi), AI-01, AI-10 (önceki devrin kartı), AI-12 (önceki ekibe yönlendirme).
- **Netleştirilecek sorular:**
  1. AI önceki konuşmayı kendiliğinden mi hatırlatsın, yoksa yalnız oyuncu aynı konuyu açarsa mı? Önerilen varsayılan: Önceki bağlantı çözülmeden ya da devredilerek bittiyse AI ilk cevabında kısaca hatırlatır. Çözülerek bittiyse bilgiyi yalnız oyuncu aynı konuyu açarsa kullanır.
  2. Oyuncu yalnız kullanıcı adı yazarak tanındıysa (farklı cihaz, doğrulama yok) AI önceki konuşmanın ayrıntılarını (tutar, yöntem) tekrar etsin mi? Önerilen varsayılan: Hayır. Başkasının kullanıcı adını yazan biri bu yolla bilgi alabilir. AI yalnız "Bugün daha önce de bize yazmış mıydınız?" diye sorar ve ayrıntıyı oyuncudan alır; ayrıntılar yalnız ajan ekranında görünür.
  3. Önceki günlerin konuşmaları AI'a gösterilsin mi? Önerilen varsayılan: Hayır. AI yalnız o günü bilir; önceki günler ajan ekranında (IN-02) görünür.

### AI-03 — Prosedür (konu akışı) motoru
- **Ne:** Her konu için birden fazla mesaj boyunca süren bir akış: "ne zaman kullanılır", "hangi bilgiler toplanır", "hangi sırayla ne sorulur", "cevaba göre ne yapılır", "ne zaman insana devredilir". Bugünkü tek mesajda baştan sona çalışan adım listesinin (Skill) çok turlu hale getirilmesi.
- **Neden gerekli:** "Param yatmadı" tek mesajla çözülmez. Önce yöntem ve saat sorulur, sonra yöntemin beklenen süresiyle karşılaştırılır. Süre dolmadıysa bekleme açıklanır; dolduysa talep oluşturulmuş mu, para kendi adına kayıtlı hesaptan mı gönderilmiş, dekont var mı diye sorulur. Sonuca göre konu ya çözülür ya da finansa devredilir. Bu, senin tarif ettiğin "teşhis sorusu sor → çözmeye çalış → çözemezsen özetleyip devret" akışının kendisidir ve bugünkü motorla kurulamıyor.
- **Gerekçe / kanıt:**
  - Pazar bu modele geçti: Intercom Fin "Procedures" (giriş koşulu "When to use", adımlar, dallanma), Ada "Playbooks", Decagon "AOP", Sierra "Journeys", Zendesk "generative procedures". Hepsi karar ağacı çizdirmek yerine düz yazıyla desteklenen yapılandırılmış adımlar kullanıyor (`kaynaklar/igaming-ai-arastirma.md` §1.2–1.3).
  - LiveChat'in ChatBot'u ve ChatBot.com görsel akış tasarımcısı kullanıyor (`kaynaklar/livechat-kesif-raporu.md` §2.2, `kaynaklar/chatbot/chatbot-uygulama.md`). iGaming ekipleri için bakımı zor; nexa'nın kilitli kararı da görsel akış yapmamak.
  - nexa bugün: adımlar tek mesajda baştan sona çalışıyor (`apps/api/src/services/ai/skill-engine.ts:412-497`). "Bilgi iste" adımı soruyu soruyor ama gelen cevabı okumuyor (`skill-engine.ts:443-459`). Koşul, dallanma ya da "cevabı bekle" yok (`packages/ai-mock/src/steps.ts:9-16`). Veritabanında `skills.trigger` alanı var ama hiçbir yerde kullanılmıyor (`apps/api/prisma/schema.prisma:1667`).
  - **Kilitli kararla ilişkisi:** ADR-14, "tek paradigma = Skill (adım listesi), görsel akış editörü yok" diyor (`PLAN.md:167`). Öneri yeni bir kavram açmak değil, Skill'i "çok turlu prosedür"e genişletmek. Yine sıralı bir adım listesi olur, ama adımlar oyuncunun cevabını bekleyebilir ve "eğer … ise" koşulu taşıyabilir. Görsel tuval yapılmaz. Bu, ADR-14'ün lafzına uyar ama kapsamını genişletir; ADR'ye bir ek not düşülmelidir.
- **Yapılmazsa:** AI yalnız tek cümlelik SSS cevapları verebilir. Ödeme, çekim, KYC ve bonus gibi destek hacminin çoğunu oluşturan teşhis konuşmaları hep insana kalır. Faz 1'in asıl değeri olan "bilgisi eksiksiz toplanmış devir" ortaya çıkmaz.
- **Bağımlılıklar:** AI-01, AI-04, AI-05, AI-13 (koşullarda kullanılan süreler ve limitler), AI-16. Sonrası için: AI-15 (hazır şablonlar), AI-19 (çok turlu test), AI-20 (sürüm ve yayın), AI-28 (ileride entegrasyon adımı).
- **Netleştirilecek sorular:**
  1. Skill'in yeni bir kavram açmadan çok turlu prosedüre genişletilmesi ve ADR-14'e ek not düşülmesi onaylanıyor mu? Önerilen varsayılan: Evet.
  2. Prosedür adımları nasıl yazılsın: tamamen serbest metin mi (Intercom tarzı), yapılandırılmış form mu? Önerilen varsayılan: Yapılandırılmış adım listesi; her adımda düz yazı talimat ve isteğe bağlı koşul. Ek olarak "SOP metnini yapıştır, taslağı AI hazırlasın" yardımcısı.
  3. Oyuncu bir konunun ortasında başka konuya geçerse ne olsun? Önerilen varsayılan: Yeni konuya geçilir, yarım kalan konu "askıda" tutulur. Yeni konu bitince AI "Önceki konuya dönelim mi?" diye sorar. Aynı anda en fazla 1 askıda konu olur.
  4. Oyuncu AI'ın sorusuna cevap vermeden sustuğunda prosedür ne zaman bırakılsın? Önerilen varsayılan: Bağlantı açık kaldıkça bekler. Bağlantı kapanırsa (sohbet zaman aşımı) yarım kalan bilgiler gün içi özete (AI-02) yazılır; oyuncu aynı gün dönerse kaldığı yerden devam edilir.

### AI-04 — Bilgi toplama (slot) sistemi
- **Ne:** Prosedürün ihtiyaç duyduğu her bilgi (kullanıcı adı, yöntem, tutar, işlem saati, TXID, dekont…) için bir tanım: türü, zorunlu olup olmadığı, nasıl doğrulanacağı, hassas olup olmadığı. AI cevaptan bilgiyi çıkarır, doğrular, saklar, eksik olanı yeniden sorar, zaten verilmiş olanı sormaz.
- **Neden gerekli:** Oyuncu "dün akşam papara ile 2,5 bin attım" yazdığında AI'ın bunu "Yöntem: Papara · Tutar: 2.500 TRY · Zaman: 13.10.2026 akşam, saat belirsiz" olarak anlaması, saati ayrıca sorması gerekir. Tutar yöntemin alt sınırının altındaysa bunu fark etmeli, kripto için TXID biçimini kontrol etmelidir. Toplanan bilgiler devir kartına (AI-10) düzgün aktarılır ve ajan oyuncuya aynı soruları tekrar sormaz. Bu, Faz 1'in en ölçülebilir değeridir ("devir kalitesi").
- **Gerekçe / kanıt:**
  - Intercom Fin girdileri konuşmadan kendisi çıkarır; Decagon ve Sierra prosedürlerinde alan doğrulaması var. Araştırmanın "toplanacak alanlar" tanımı: ad, zorunlu mu, doğrulama (tarih, tutar, TXID), hassas mı (`kaynaklar/igaming-ai-arastirma.md` Ekran D ve §3.1 alan tablosu).
  - Uyum: şifre, SMS kodu, tam kart numarası, CVV ve seed phrase **asla** istenmez (G11).
  - nexa bugün: "bilgi iste" adımı yalnız soruyu gönderiyor (`skill-engine.ts:443-459`). "Bu bilgi mesajda zaten var mı" kontrolü kaba bir tahmin; yalnız sipariş numarası, e-posta ve telefon kalıplarına bakıyor (`skill-engine.ts:791-799`). Gelen cevap hiçbir yere kaydedilmiyor.
- **Yapılmazsa:** AI ya aynı soruyu tekrar tekrar sorar ya da eksik bilgiyle devreder; ajan her şeyi baştan sorar. Hassas bilgi isteme gibi uyum hataları kontrol edilemez.
- **Bağımlılıklar:** AI-01, AI-03, AI-13 (yöntem listesi, min/max), AI-26 (oyuncu kendiliğinden hassas veri yazarsa maskeleme), ID-04 (saat dilimi), AI-10 (kartta gösterim).
- **Netleştirilecek sorular:**
  1. Dekont ya da ekran görüntüsü sohbet içinden alınsın mı? Önerilen varsayılan: Evet. Görsel kabul edilir ve ajana iletilir; AI görselin içeriğini yorumlamaz ve "onaylandı" demez. Kimlik belgesi (KYC) sohbetten alınmaz, resmi yükleme yoluna yönlendirilir (G12).
  2. Oyuncu zorunlu bir bilgiyi vermek istemezse ya da bilmiyorsa ne olsun? Önerilen varsayılan: Bilgi en fazla 2 kez, farklı şekilde sorulur. Sonra "verilmedi" olarak işaretlenir ve konu devredilir.

### AI-05 — LLM tabanlı konu tespiti ve prosedür seçimi
- **Ne:** Oyuncunun ne istediğinin kelime eşleştirmesi yerine dil modeliyle anlaşılması. Hangi prosedürün çalışacağına prosedürlerin "ne zaman kullanılır" tarifine ve örnek cümlelerine bakılarak karar verilir. Çakışmada öncelik sırası uygulanır; AI emin değilse kısa bir netleştirme sorusu sorar.
- **Neden gerekli:** Oyuncular aynı şeyi çok farklı söyler: "param yatmadı", "bakiye gelmedi", "havale attım gözükmüyor", "usdt gönderdim düşmedi", üstelik yazım hatalarıyla. Kelime eşleştirme bunların çoğunu kaçırır ya da yanlış konuya bağlar (ör. içinde "çekim" geçen bir yatırım şikâyeti). Yanlış prosedür yanlış sorular, yanlış sorular da sinirli oyuncu demektir.
- **Gerekçe / kanıt:**
  - Intercom "When to use" alanı, Zendesk "use cases (intents)", Decagon "giriş koşulları" (`kaynaklar/igaming-ai-arastirma.md` §1.2–1.3).
  - ChatBot.com'da en sık sorun, mesajların "Bot doesn't understand 1x / 2x" bloklarına düşmesi; bunu ölçmek için ayrı bir rapor var (`kaynaklar/chatbot/chatbot-uygulama.md` §5, §9.1).
  - nexa bugün: seçim kelime örtüşmesiyle yapılıyor, eşik 0.6 (`packages/ai-mock/src/intent.ts:29`). Birden fazla skill uyarsa en son düzenlenen kazanıyor, öncelik alanı yok (`skill-engine.ts:239-257`). İçinde konu adımı olmayan bir skill her mesaja uyuyor (`skill-engine.ts:368-370`); tek bir "genel" skill bütün konuşmaları yutabiliyor.
- **Yapılmazsa:** Yanlış konuya yanlış akış başlar ya da AI hiç başlamaz. "Her mesaja uyan" bir skill yanlışlıkla tüm sohbetleri ele geçirir. Prosedür sayısı 20'yi geçtikçe karışıklık büyür.
- **Bağımlılıklar:** AI-16, AI-01, AI-03. AI-22 (hiçbir şeye uymayan mesajların kaydı) bu maddenin çıktısını kullanır.
- **Netleştirilecek sorular:**
  1. AI emin olmadığında ne yapsın? Önerilen varsayılan: İki olası konu arasında kaldıysa tek bir seçmeli soru sorar ("Yatırımla mı, çekimle mi ilgili?"). Hiçbir konuya yakın değilse bilgi bankasından cevap dener (AI-06).

### AI-06 — Bilgi bankasından genel yanıt + "bilmiyorum" davranışı
- **Ne:** Oyuncunun sorusu hiçbir prosedüre uymazsa AI bilgi bankasından (makaleler, SSS, tablolar) cevap verir. Cevap bilgi bankasında yoksa uydurmaz; "Bu konuda size kesin bilgi veremiyorum" der ve insana devreder.
- **Neden gerekli:** "Papara ile en az ne kadar yatırabilirim?", "Çevrim şartı ne demek?" gibi bilgi soruları için prosedür gerekmez; tablodan ya da makaleden doğru cevap yeterlidir. Ama iGaming'de uydurulmuş bir limit ya da süre doğrudan para kaybı ve şikâyet demektir. "Bilmiyorum" demek uydurmaktan her zaman iyidir (G17).
- **Gerekçe / kanıt:**
  - Intercom Fin, Zendesk generative replies ve LiveChat ChatBot "AI Knowledge" bu ilk katmanı sunuyor (`kaynaklar/igaming-ai-arastirma.md` §1.2; `kaynaklar/livechat-kesif-raporu.md` §2.2).
  - Uyum: G17 (yanıt yoksa uydurma, devret), G18 (aynı soruya tutarlı yanıt).
  - nexa bugün: bilgi bankası yalnız bir skill'in içindeki "bilgi bankasından cevapla" adımında çalışıyor, kendi başına bir yol değil (`skill-engine.ts:533-596`). Hiçbir skill uymazsa bot hiçbir şey söylemiyor ve iz de kalmıyor (`skill-engine.ts:295`). Bilgi bankasında karşılık bulunamazsa oyuncuya hiçbir şey söylenmiyor, sohbet sessizce bekliyor (`skill-engine.ts:581-595`).
- **Yapılmazsa:** Oyuncu basit bir soruya cevap alamaz ve sessizlikle karşılaşır. Ya da yanlış kurulmuş "genel" bir skill yüzünden alakasız bir makaleden cevap alır.
- **Bağımlılıklar:** AI-05, AI-13, AI-14, AI-16, AI-17/AI-18 (bilgi kaynaklarının kendisi). Çıktısı AI-09'u (bilgi yok → devir) ve AI-22'yi (çözülemeyen sorular) besler.
- **Netleştirilecek sorular:**
  1. Bilgi bankasında cevap yoksa AI doğrudan devretsin mi, önce oyuncuya sorsun mu? Önerilen varsayılan: Para, hesap, bonus ve sorumlu oyun konularında doğrudan devreder. Diğer konularda "Sizi bir temsilcimize aktarayım mı?" diye bir kez sorar.

### AI-07 — Davranış talimatları (Guidance) ekranı
- **Ne:** Kiracının AI'ın nasıl konuşacağını düz yazıyla kurallar halinde yazabildiği ekran. Örnekler: "Ödeme sorununda yöntem ve tutarı öğrenmeden çözüm önerme", "Tek mesajda en fazla 2 soru sor", "Oyuncuya 'siz' diye hitap et". Her kural kategori, kapsam (tüm sohbetler / belirli konular / belirli marka), öncelik ve sahip bilgisiyle tutulur. Kaydederken çelişki denetimi yapılır.
- **Neden gerekli:** Her operatörün kendi üslubu ve iç kuralları vardır. Bunları prosedürlerin içine tek tek gömmek bakımı imkânsız hale getirir. Örneğin "Mükerrer yatırımı asla önerme" kuralı bütün ödeme konularında aynı anda geçerli olmalıdır. Bugün kiracının AI'a genel bir talimat yazabileceği bir yer yok.
- **Gerekçe / kanıt:**
  - Intercom Fin "Guidance" (iletişim stili, netleştirme, bağlam; "önce iOS mu Android mi sor" örneği) ve "Optimize" aracının çelişki denetimi; Ada "Coaching" (`kaynaklar/igaming-ai-arastirma.md` §1.2–1.3, Ekran C).
  - Ders: kural sayısı arttıkça çakışma yönetimi gerekir; Intercom'da 100 aktif kural sınırı bildiriliyor (ikincil kaynak, §1.3).
  - nexa bugün: veritabanında `ai_agents.instruction` alanı var (`apps/api/prisma/schema.prisma:1562`) ama API'den yazılamıyor (`apps/api/src/routes/playbook.ts:404-413` yalnız ad, durum, ton, avatar, dil ve cevap uzunluğunu güncelliyor) ve modele de gitmiyor. Modelin talimatı kodda sabit (`provider/answer-prompt.ts:65-75`).
- **Yapılmazsa:** Kiracı AI'ın üslubunu ve iç kurallarını ayarlayamaz; her küçük değişiklik için prosedür düzenlemek gerekir. Çelişen kurallar fark edilmez ve AI tutarsız davranır.
- **Bağımlılıklar:** AI-16; AI-08 (kilitli kurallar talimatların üstündedir), AI-03 (prosedüre özel talimat), RL-02 (kim düzenler), AI-20/AI-21 (taslak, yayın ve değişiklik geçmişi), AI-19 (talimat değişince test).
- **Netleştirilecek sorular:** Yok. (Kimin düzenleyeceği RL-02'de, yayın onayı AI-20'de karara bağlanır.)

### AI-08 — Uyum korumaları (guardrail) seti
- **Ne:** Üç katmanlı koruma. (1) Platformun kilitlediği, kiracının kapatamayacağı temel kurallar (G1–G19: sorumlu oyun, reşit olmayan, söz verme yasağı, şifre/OTP istememe, AML incelemesi hakkında ipucu vermeme…). (2) Kiracının ekleyebileceği kurallar ve yasaklı ifade listesi. (3) Her AI cevabının oyuncuya gitmeden önce otomatik denetlenmesi: yasaklı ifade, "kontrol ettim / hesabınıza geçti" gibi doğrulanmamış iddia, süre ya da ödeme sözü.
- **Neden gerekli:** iGaming'de AI'ın tek bir yanlış cümlesi lisans riski doğurur: kendini oyundan men etmek isteyen oyuncuya bonus teklif etmek, reşit olmayana oyun anlatmak, "5 dakikaya yatar" diye söz vermek, "hesabınız AML incelemesinde" diyerek ipucu vermek. Dil modeline "yapma" demek yetmez. Bu davranışlar hem talimatla hem de gönderim öncesi otomatik kontrolle engellenmeli, temel set de kiracı tarafından gevşetilememelidir.
- **Gerekçe / kanıt:**
  - Düzenleyici dayanak: Curaçao CGA sorumlu oyun politikası ve şikâyet yönergesi (sorumlu oyunla ilgili şikâyette iletişim insanla yürütülmeli, AI kayıtları tutarlılık için izlenmeli), MGA oyuncu koruma direktifi, UKGC müşteri etkileşimi rehberi (riskli oyuncuya pazarlama yapılmamalı, üçüncü taraf sağlayıcılar da kapsamda) (`kaynaklar/igaming-ai-arastirma.md` §4.1–4.2).
  - Vendor'lar: Intercom devir kurallarını (Escalation Guidance) ayrı bir nesne olarak tutuyor; Sierra bir "hakem model" ile prosedüre uyumu puanlıyor (§1.2–1.3). ChatBot.com'da politika düzeyinde kilit yok, hassas konular yalnız akış içindeki "transfer" bloğuyla yönetiliyor (`kaynaklar/chatbot/chatbot-uygulama.md` §9.3).
  - nexa bugün: guardrail, yasaklı ifade listesi ya da çıktı denetimi yok. Modelin talimatı yalnız "pasajlara dayanarak cevap ver" diyor (`provider/answer-prompt.ts:65-75`). Var olan tek koruma, oyuncu mesajındaki kart numarasının maskelenmesi (`apps/api/src/routes/customer.ts:816`).
- **Yapılmazsa:** Lisans ve uyum ihlali, oyuncu şikâyeti, itibar kaybı. SiyahTuş iGaming operatörlerine "güvenli AI" olarak satılamaz.
- **Bağımlılıklar:** AI-16, AI-07 (talimat katmanı), AI-09 (zorunlu devirler), AI-27 (risk bayrakları), AI-26 (hassas veri maskeleme), EN-01 (riskli oyuncuya kampanya engeli), AI-25 (ihlal metrikleri), ID-08 (her tetiklenmenin kaydı).
- **Netleştirilecek sorular:**
  1. Kendine zarar ifadesinde paylaşılacak kriz hattı metnini kim belirler? Önerilen varsayılan: Platform ülkeye göre bir taslak metin önerir; kiracı kendi metnini onaylamadan AI Agent yayına alınamaz.
  2. "Site açılmıyor / güncel adres nedir" sorularında AI ne desin (G14)? Önerilen varsayılan: AI hiçbir adres, VPN ya da engel aşma yöntemi önermez; yalnız kiracının onayladığı sabit bir metni kullanır ("resmi duyuru kanallarımızı takip edin" gibi). Bu konu için hukuk görüşü alınmalıdır.
  3. Cevaplar gönderilmeden önce ikinci bir dil modeli tarafından da denetlensin mi? Bu ek maliyet demektir. Önerilen varsayılan: Para, hesap, bonus ve sorumlu oyun konularında evet; diğer konularda yalnız kural ve kelime taraması.

### AI-09 — Otomatik insana devir tetikleyicileri
- **Ne:** Prosedürde açık bir "devret" adımı olmasa da AI'ın kendiliğinden insana devretmesini sağlayan tetikleyiciler: oyuncu insan istedi; AI art arda 2 tur anlayamadı; oyuncunun öfkesi artıyor; bilgi bankasında cevap yok; bir uyum kuralı tetiklendi (self-exclusion, sorumlu oyun sinyali, reşit olmayan şüphesi, fraud, resmi şikâyet); hakaret ya da tehdit (2 uyarıdan sonra); konuşma döngüye girdi; oyuncu aynı gün aynı sorunla tekrar geldi. Her tetikleyicinin bir "devir nedeni" kodu olur.
- **Neden gerekli:** Parası söz konusu olduğunda oyuncu çabuk sinirlenir. "İnsanla görüşmek istiyorum" dediği halde botla konuşmaya zorlanan oyuncu şikâyet eder, hatta düzenleyiciye gider. Bazı durumlarda devir yasal zorunluluktur (sorumlu oyun, şikâyet). Devir nedenleri ayrıca hangi bilginin ya da prosedürün eksik olduğunu gösteren en değerli veridir.
- **Gerekçe / kanıt:**
  - G16: "İnsanla görüşmek istiyorum" talebi her zaman karşılanır. G1–G5, G13, G15 ve G19 zorunlu devirdir (`kaynaklar/igaming-ai-arastirma.md` §4.2). Araştırmanın Ekran E'si global tetikleyicileri tanımlar.
  - LiveChat ChatBot'ta "Transfer to agent" açılıp kapanan bir beceri (`kaynaklar/livechat-kesif-raporu.md` §2.2); ChatBot.com'da devir yalnız akış içindeki transfer bloğuyla yapılıyor (`kaynaklar/chatbot/chatbot-uygulama.md` §9.3).
  - nexa bugün: devir yalnız skill'e açıkça eklenmiş "takıma aktar" adımıyla oluyor (`apps/api/src/services/ai/skill-engine.ts:488-495`). Motor kendiliğinden devretmiyor (`skill-engine.ts:14-16`). Dil modeli hata verirse sohbet oyuncuya hiçbir şey söylenmeden sessizce insana kalıyor (`skill-engine.ts:26-38`).
- **Yapılmazsa:** Oyuncu botla sıkışıp kalır, zorunlu devirler kaçırılır (uyum ihlali), devir oranı ve nedenleri ölçülemez.
- **Bağımlılıklar:** AI-01, AI-05 (insan isteği ve duygu aynı anlama adımında tespit edilir), AI-08, AI-10, AI-11, AI-12, AI-27; AI-29 (widget'ta her zaman görünen "insanla görüş" butonu aynı sonucu doğurur); AI-02 (gün içi tekrar).
- **Netleştirilecek sorular:**
  1. AI devretmeden önce oyuncuya "Sizi bir temsilciye aktarayım mı?" diye sorsun mu? Önerilen varsayılan: Oyuncu açıkça insan isterse en fazla bir netleştirme sorusundan sonra doğrudan devreder (G16). Uyum tetikleyicilerinde sormadan devreder. "Anlaşılamadı" durumunda bir kez sorar.
  2. Varsayılan eşikler uygun mu: 2 tur anlaşılamama, hakarette 2 uyarı, prosedür başına en fazla 12 tur? Önerilen varsayılan: Evet; kiracı ayarından değiştirilebilir, ama uyum tetikleyicileri kapatılamaz.

### AI-10 — Yapılandırılmış devir kartı
- **Ne:** AI sohbeti insana devrettiğinde ajanın ekranında görünen düzenli bir kart: konu, oyuncu kimliği (oyuncunun beyanı), toplanan bilgiler (eksik olanlar işaretli), AI'ın oyuncuya ne söylediği ve neye söz vermediği, devir nedeni, risk ve duygu bayrakları, önerilen sonraki adım, ekler (dekont). Ajan kartı "yeterli / yetersiz" diye işaretleyebilir.
- **Neden gerekli:** Faz 1'de AI para konularının çoğunu çözemez, çünkü hesabı göremez. Asıl değeri, ajanın oyuncuya hiçbir şeyi tekrar sormadan işe başlayabilmesidir. Araştırmadaki örnek kart: "Niyet: Yatırım hesaba geçmedi · Yöntem: Papara · Tutar: 2.500 TRY · Zaman: 13:42 (geçen 95 dk, beklenen ≤30 dk) · Talep oluşturuldu: Evet · Dekont: Ekli · Devir nedeni: süre aşıldı + dekont var · Önerilen adım: Papara referansıyla eşleştirme". Bugünkü "Customer asked: <ilk 160 karakter>" özeti bunun yerini tutmaz.
- **Gerekçe / kanıt:**
  - Araştırmanın standart devir özeti şablonu ve "devir kalitesi" metriği: "Faz 1'in asıl değeri burada" (`kaynaklar/igaming-ai-arastirma.md` Ekran E, §3.1 kart örneği, §5.2).
  - ChatBot.com incelemesinden çıkan öneri: devir anında bot transkripti ve toplanan alanlar ajana aktarılmalı (`kaynaklar/chatbot/chatbot-uygulama.md` §9.3).
  - nexa bugün: özet bir şablondan ibaret, oyuncunun ilk mesajının ilk 160 karakteri (`apps/api/src/services/ai/skill-engine.ts:801-809`), ve yalnız skill'e "özetle" adımı eklenmişse yazılıyor. Özet konuşma kaydına yazılıyor (`ai-responder.ts:142-148`) ama Gelen Kutusu'nda gösterilmiyor; oradaki özet yalnız ajanın elle istediği Copilot özeti (`apps/web/src/features/inbox/CopilotPanel.tsx:160-188`).
- **Yapılmazsa:** Ajan transkripti baştan okur ya da oyuncuya aynı soruları yeniden sorar; AI'ın topladığı bilgi boşa gider, devir süresi uzar, devir kalitesi ölçülemez.
- **Bağımlılıklar:** AI-04, AI-09, AI-03 (prosedüre özel kart şablonu), AI-27 (risk bayrakları), IN-02 (oyuncu kartı yanında durur), ID-05 (kartta chat ID / thread ID), AI-25 (kart kalitesi metriği), ID-09 (zaman çizelgesinde görünür).
- **Netleştirilecek sorular:**
  1. Oyuncuya da "Şu bilgilerinizi ilettim" diye kısa bir özet gösterilsin mi? Önerilen varsayılan: Evet; yalnız oyuncunun kendi verdiği bilgiler (tutar, yöntem, saat) tek mesajda. Risk bayrakları ve iç notlar asla gösterilmez.
  2. Ajanın kartı "yeterli / yetersiz" diye işaretlemesi zorunlu mu? Önerilen varsayılan: Hayır; tek tıklık, isteğe bağlı. Ekip Lideri sonuçları raporda görür.

### AI-11 — Devirden sonra AI'ın susması
- **Ne:** Sohbet insana geçtiği anda AI cevap üretmeyi bırakır, oyuncu yazmaya devam etse bile. Ajan isterse "AI'a geri ver" diyebilir; AI kaldığı yerden ya da yeni konuyla devam eder.
- **Neden gerekli:** Ajan oyuncuyla konuşurken AI'ın araya girip başka bir cevap vermesi kafa karıştırır ve çelişkili bilgi riski taşır (ajan "finans ekibi bakıyor" derken AI'ın "genellikle 30 dakikada yatar" demesi gibi). Devirden sonraki AI çağrıları ayrıca boşuna maliyettir.
- **Gerekçe / kanıt:**
  - Intercom, Zendesk ve Ada'da devirden sonra sohbet insana aittir. ChatBot.com'da devir LiveChat ajanına aktarımla biter; incelemeden çıkan öneri: "Bot görüşüyor" etiketi, tek tıkla devral, "bota geri ver" (`kaynaklar/chatbot/chatbot-uygulama.md` §6, §9.1, §9.3).
  - nexa bugün: AI her yeni oyuncu mesajında çalışıyor ve sohbetin insana geçip geçmediğine bakmıyor (`apps/api/src/routes/customer.ts:380-389`, `services/ai/ai-responder.ts:48-98`). Üstelik sohbet açılır açılmaz yönlendirme onu bir ajana atıyor (`services/chat/chat-service.ts:394-412`); yani bugün AI ve insan aynı sohbette paralel çalışıyor. Ajanın "devral" işlevi var (`chat-service.ts:1632`) ama AI'ı susturmuyor.
  - **Kilitli kararla ilişkisi:** ADR-09'a göre kapanışta ajan mesajı olmayan her sohbet "AI çözümü" sayılıp faturaya yansıyor (`PLAN.md:162`). AI'ın devrettiği ama oyuncunun ajan yazmadan ayrıldığı sohbetler de bu yüzden "AI çözümü" sayılıyor; bu hem raporu hem faturayı şişirir.
- **Yapılmazsa:** AI ve ajan aynı oyuncuya aynı anda farklı şeyler söyler, oyuncu güvenini kaybeder, gereksiz AI maliyeti oluşur.
- **Bağımlılıklar:** AI-09, AI-10, AI-12; RL-02 ("AI'a geri ver" yetkisi); ID-08 (sahiplik değişikliklerinin kaydı).
- **Netleştirilecek sorular:**
  1. Sohbet başında insan ne zaman atansın? Önerilen varsayılan: "Önce AI". AI aktif olduğu sürece sohbet bir ajana atanmaz, "AI görüşüyor" listesinde durur ve devir anında yönlendirilir. Bugünkü "paralel" davranış kiracı ayarı olarak kalabilir.
  2. Ajanın AI'ın yürüttüğü bir sohbete mesaj yazması otomatik devralma sayılsın mı? Önerilen varsayılan: Evet.
  3. "AI'a geri ver" yetkisi kimde olsun? Önerilen varsayılan: Sohbetin sahibi ajan ile Ekip Lideri, Yönetici ve Kurucu. Sorumlu oyun ya da reşit olmayan bayrağı taşıyan sohbet hiç kimse tarafından AI'a geri verilemez.
  4. AI'ın devrettiği ama hiçbir ajanın yazmadan kapandığı sohbetler "AI çözümü" sayılmaya devam etsin mi (ADR-09)? Önerilen varsayılan: Hayır; devredilmiş sohbetler AI çözümü sayılmaz ve faturaya yansımaz.

### AI-12 — Devir hedefi ve öncelik
- **Ne:** AI devrederken sohbetin gideceği ekibin listeden seçilmesi (bugünkü serbest metin yerine); konu → ekip eşlemesi (Finans, KYC/Risk, Bonus, Sorumlu Oyun, Teknik, Şikâyet); aciliyet (sorumlu oyun, reşit olmayan şüphesi, kendine zarar = acil); mesai dışında ne yapılacağı.
- **Neden gerekli:** "Çekim reddedildi" Finans/Risk'e, "hesabımı kapatın" yalnız eğitimli Sorumlu Oyun ekibine, "bahis itirazı" Trading'e gitmelidir. Yanlış ekibe giden sohbet tekrar aktarılır ve oyuncu bekler. Kendine zarar ifadesi içeren bir sohbetin normal kuyrukta 20 dakika beklemesi kabul edilemez. Gece 03:00'te devredilen oyuncuya "Ekibimiz 09:00'da dönecek" denmelidir; bugün ise hiçbir ajan çevrimiçi değilse devir başarısız oluyor ve sohbet olduğu yerde kalıyor.
- **Gerekçe / kanıt:**
  - Araştırma Ekran E: hedef kuyruk/ekip eşlemesi, öncelik kuralları, mesai dışı davranışı (`kaynaklar/igaming-ai-arastirma.md` §2).
  - LiveChat: gruplar "beceri, dil ya da markaya göre" yönlendirme içindir (`kaynaklar/livechat-kesif-raporu.md`, Team › Groups bölümü).
  - nexa bugün: devir adımı ekip adını serbest metin olarak tutuyor (`packages/ai-mock/src/steps.ts:52-55`); o adda ekip yoksa sohbet olduğu yerde kalıyor (`apps/api/src/services/ai/ai-responder.ts:174-186`). Ekipte çevrimiçi ajan yoksa aktarım "group_offline" hatasıyla reddediliyor (`services/chat/chat-service.ts:1395-1412`) ve AI tarafı bu hatayı yalnız log'a yazıyor (`ai-responder.ts:165-171`). Sohbet önceliği kavramı yok. Ajanlar için "uzmanlık" etiketi zaten var (`apps/api/prisma/schema.prisma:739`), Sorumlu Oyun eğitimi için kullanılabilir.
  - **Kilitli kararla ilişkisi:** ADR-08 yönlendirme sırasını sabitliyor (`PLAN.md:161`). Öncelikli sohbetin kuyrukta öne geçmesi bu sıranın "kuyruk" adımına bir ek gerektirir; ajan seçme mantığı değişmez.
- **Yapılmazsa:** Ekip adı değişince devirler sessizce bozulur, acil sohbetler sıradan bekler, mesai dışında oyuncu cevapsız kalır, yanlış ekibe giden sohbetler tekrar aktarılır.
- **Bağımlılıklar:** AU-01 (konuya göre ekip yönlendirmesi; eşleme tablosu ortak), AI-09, AI-11, AI-15 (şablonlardaki hedef ekipler), RL-03 (Ekip Lideri), IN-04 (ajan ekranında takıma aktarma), HD-01 / WG-08 (mesai dışında talep ve e-posta).
- **Netleştirilecek sorular:**
  1. iGaming kiracısına ilk kurulumda 6 ekip (Finans, KYC/Risk, Bonus, Sorumlu Oyun, Teknik, Şikâyet) otomatik önerilsin mi? Önerilen varsayılan: Evet, öneri olarak gelir; kiracı ekipleri birleştirebilir ya da yeniden adlandırabilir.
  2. Mesai dışında devredilen sohbet ne olsun? Önerilen varsayılan: Kuyrukta bekler; AI "Ekibimiz HH:MM itibarıyla dönecek" der; oyuncu e-posta bırakmak isterse talep (ticket) açılır. Kendine zarar ifadesinde mesai fark etmeksizin kriz hattı bilgisi hemen verilir.
  3. Sorumlu Oyun sohbetleri yalnız "Sorumlu Oyun eğitimli" uzmanlığı olan ajanlara mı gitsin? Önerilen varsayılan: Evet. O an böyle bir ajan yoksa sohbet acil öncelikle Sorumlu Oyun kuyruğunda bekler ve Ekip Liderine bildirim gider.

### AI-13 — Yapılandırılmış bilgi tabloları
- **Ne:** Kritik bilgilerin serbest metin makale yerine form/tablo olarak girilmesi. Ödeme Yöntemleri: yön (yatırım/çekim), min/max, beklenen süre, "gecikme sayılır" eşiği, çalışma saatleri, talep ya da açıklama kodu gerekip gerekmediği, dekont gerekip gerekmediği, sık hatalar. Bonuslar: tip, min yatırım, çevrim katı, max bahis, max çekim, süre, hariç yöntemler. KYC belgeleri: kabul kriterleri, inceleme süresi, yükleme yolu. Limitler ve kurallar.
- **Neden gerekli:** "Param yatmadı" akışının kalbi, işlem saatinin yöntemin beklenen süresiyle karşılaştırılmasıdır. Bu bilgi bir makalenin içinde serbest metin olarak durursa AI onu yanlış okuyabilir ve hesap yapamaz. Tablodaki "Papara · yatırım · beklenen 30 dk · gecikme eşiği 60 dk · 7/24" satırıyla AI kesin bir kural uygular: "95 dakika geçmiş, eşik aşılmış → finansa devret". Ödeme ve bonus bilgileri ayrıca çok sık değişir; tabloyu güncel tutmak ve "son gözden geçirme" tarihini izlemek kolaydır.
- **Gerekçe / kanıt:**
  - Araştırmanın ana önerisi: "Ödeme yöntemi, bonus ve KYC bilgilerini yapılandırılmış tablo olarak alın; yanlış yanıtların büyük kısmı burada önlenir" (`kaynaklar/igaming-ai-arastirma.md` §6 madde 2, Ekran B tablo şemaları). Türkiye bağlamı: FAST 7/24, EFT mesai saatine bağlı, kriptoda ağ seçimi kritik (§3.2); bunlar kodda sabit değil, kiracı tablosunda olmalı.
  - Vendor'larda yapılandırılmış veri çoğunlukla API ile geliyor (Intercom data connectors). Faz 1'de entegrasyon olmadığından tabloyu kiracı elle girer; F2'de aynı alanlar entegrasyondan doldurulabilir.
  - nexa bugün: bilgi kaynakları yalnız metin (makale, SSS, dosya, web sitesi; `packages/types/src/domain.ts:190`). Tablo tipinde kaynak yok, AI hesaplama yapmıyor.
- **Yapılmazsa:** AI süreleri ve limitleri yanlış söyler ya da hiç karşılaştıramaz; "param yatmadı" akışı her durumda devirle biter; bilgi eskidiğinde kimse fark etmez.
- **Bağımlılıklar:** AI-03, AI-04 (yöntem listesi ve doğrulama), AI-06 (tablodan cevap), AI-14 (tablolar tek bilgi deposunun parçası, marka kapsamı), AI-20/AI-21 (değişiklik onayı ve geçmişi). İleride KN-06 (entegrasyonla otomatik doldurma).
- **Netleştirilecek sorular:**
  1. Sabit tablolar mı olsun, kiracının kendi tablosunu tasarlayabildiği esnek bir yapı mı? Önerilen varsayılan: 4 sabit tablo (Ödeme, Bonus, KYC, Limitler/Kurallar); esnek tablo sonraya.
  2. "Son gözden geçirme" uyarısı ne sıklıkla çıksın? Önerilen varsayılan: Ödeme yöntemleri 14 günde bir; bonuslar kampanya bitişinde ve 30 günde bir; KYC ve kurallar 90 günde bir. Süresi geçen satırı AI kullanmaya devam eder, ama panelde uyarı çıkar ve Kurucu/Yöneticiye bildirim gider.
  3. Çoklu markada (bir kiracının birden fazla sitesi) her marka ayrı satırlar mı tutsun? Önerilen varsayılan: Evet; bir satır "tüm markalar" olarak da işaretlenebilir.

### AI-14 — Tek bilgi deposu
- **Ne:** Bütün bilgi kaynaklarının (makale, SSS, dosya, web sitesi, tablolar, Genel Bilgi Bankası makaleleri) tek yerde tutulması. Her kaynakta "kim kullanır" seçimi (AI Agent / Copilot / herkese açık bilgi bankası), marka kapsamı, dil, sahibi ve "son gözden geçirme" tarihi bulunur.
- **Neden gerekli:** Bugün aynı "Papara limitleri" bilgisi AI Agent için bir yere, ajan asistanı Copilot için başka bir yere ayrı ayrı giriliyor. Biri güncellenip diğeri unutulduğunda AI ile ajan oyuncuya farklı limitler söyler. iGaming'de bir kiracı genellikle birden fazla markaya hizmet verir; A sitesinin bonus kuralının B sitesindeki oyuncuya söylenmesi ciddi bir hatadır.
- **Gerekçe / kanıt:**
  - LiveChat Knowledge hub: tek kaynak listesi ve her kaynakta "For internal use only" kutusu (yalnız Copilot kullanır, müşteri sohbetinde kullanılmaz) (`kaynaklar/livechat-kesif-raporu.md` §2.3).
  - Araştırma Ekran A/B: her marka ayrı bilgi kümesine bağlanır, "son gözden geçirme tarihi" zorunludur (`kaynaklar/igaming-ai-arastirma.md` §2).
  - nexa bugün: AI Agent ve Copilot bilgileri aynı tabloda ama farklı "AI ajan" kayıtlarına bağlı (`apps/api/prisma/schema.prisma:1739-1772`; Copilot kaydı `services/ai/copilot-service.ts:44,107-112`). Ekranları da ayrı: Senaryolar › Bilgi ve Ekip › AI temsilciler › Copilot bilgisi (`apps/web/src/features/team/CopilotKnowledge.tsx`). Genel Bilgi Bankası makaleleri AI'a hiç bağlı değil. Kaynaklarda marka, dil, sahip ve gözden geçirme tarihi yok. Marka kavramı sistemde var (`schema.prisma:1966`) ama bilgiye bağlanmamış.
  - **Kilitli kararla ilişkisi:** Repoda "AI Agent ve Copilot bilgi tabanları ayrı" kararı verilmiş (HANDOFF.md, açık sorular tablosunda Q6). Bu madde o kararı değiştirir. Öneri: depo tek olur, kullanım "kim kullanır" bayrağıyla ayrılır; bugünkü ayrı listeler aynı deponun filtrelenmiş görünümleri olarak kalabilir.
- **Yapılmazsa:** Çift bakım, AI ile ajan arasında çelişkili bilgi, yanlış markanın bilgisinin oyuncuya söylenmesi, eskimiş bilginin fark edilmemesi.
- **Bağımlılıklar:** AI-06, AI-13, AI-17/AI-18 (kaynak türleri), AI-20/AI-21, WG-12 (widget içi bilgi bankası araması aynı depoyu kullanır), RL-02.
- **Netleştirilecek sorular:**
  1. "AI Agent ve Copilot bilgileri ayrı" kararı (Q6) "tek depo + kim kullanır bayrağı" olarak değişsin mi? Önerilen varsayılan: Evet.
  2. Genel Bilgi Bankası'nda yayınlanan makaleler AI tarafından otomatik kullanılsın mı? Önerilen varsayılan: Evet; yayınlanan makaleler varsayılan olarak AI Agent ve Copilot'a açıktır, makale başına kapatılabilir.
  3. "Son gözden geçirme" tarihi zorunlu olsun mu? Önerilen varsayılan: Evet; varsayılan geçerlilik 90 gün, süresi geçen kaynak için panelde uyarı (tablolar için süreler AI-13'te).

### AI-15 — iGaming hazır prosedür şablonları
- **Ne:** En yaygın 20 iGaming destek konusu için Türkçe, kullanıma hazır prosedür şablonları: yatırım geçmedi, çekim beklemede, çekim reddedildi, KYC, bonus alma, çevrim şartı, bahis itirazı, oyun hatası, giriş/şifre, hesap kilidi, self-exclusion, sorumlu oyun sinyali, limit, ödeme yöntemleri, yanlış hesap/ağ, promosyon, bilgi değişikliği, şikâyet, erişim, çoklu hesap. Her şablon giriş cümleleri, toplanacak bilgiler, teşhis soruları, yanıt kalıpları, devir koşulları, hedef ekip ve yasak ifadelerle hazır gelir.
- **Neden gerekli:** Kiracının sıfırdan 20 prosedür yazması haftalar sürer ve hataya açıktır (ör. self-exclusion isteyen oyuncuyu ikna etmeye çalışmak). Şablonlar kurulumu günlere indirir ve uyum açısından doğru davranışı varsayılan yapar. Bugünkü 33 şablonun hiçbiri iGaming için değil.
- **Gerekçe / kanıt:**
  - Araştırmanın 20 maddelik niyet kataloğu ve "Para yatırdım, hesabıma geçmedi" tam örneği (`kaynaklar/igaming-ai-arastirma.md` §3, §3.1).
  - Şablon galerisi vendor'larda standart: LiveChat Workflows 39 şablon, ChatBot.com hazır botlar (`kaynaklar/eksikler.md` [A-48]); Decagon ve Intercom SOP metninden taslak üretiyor.
  - nexa bugün: 33 şablon var, hepsi e-ticaret ve SaaS için (sipariş durumu, iade, Shopify…) (`apps/web/src/features/playbook/templates.ts:88-692`). Şablonlar yalnız ön yüzde tutuluyor; sunucuda "şablon" kavramı bilinçli olarak açılmamış (repo görev notu `.taskmaster/tasks/task_098.md`).
- **Yapılmazsa:** Pilot kiracı boş bir ekranla başlar, ilk haftalarda AI neredeyse hiç konu çözemez, uyum açısından riskli prosedürler kiracı tarafından sıfırdan yazılır.
- **Bağımlılıklar:** AI-03, AI-04, AI-08 (kilitli konular), AI-12 (hedef ekipler), AI-13 (şablonların okuduğu tablolar), AI-19 (her şablonla gelen test senaryoları), AI-20 (şablondan oluşturulan taslağın yayını).
- **Netleştirilecek sorular:**
  1. Şablon metinlerinin hukuk ve uyum açısından doğrulamasını kim yapacak? Önerilen varsayılan: Platform taslakları hazırlar; "kiracı doğrulamalı" alanları (süreler, ADR kurumu, şikâyet süresi) boş bırakır; kiracı yayından önce onaylar.
  2. Self-exclusion, sorumlu oyun sinyali ve reşit olmayan şüphesi şablonları kiracı tarafından kapatılabilir mi? Önerilen varsayılan: Hayır; bunlar kilitli gelir, yalnız metinlerin üslubu düzenlenebilir.
  3. Şablonlar hangi dillerde gelsin? Önerilen varsayılan: Türkçe tam; İngilizce yalnız giriş cümleleri (konu tespiti için).

### AI-16 — Gerçek dil modeli ve embedding'in açılması (maliyet ve kota takibi)
- **Ne:** Pilot ortamında AI'ın sahte (mock) model yerine gerçek bir dil modeli ve gerçek embedding ile çalışması: bilgi bankasının yeni modelle yeniden işlenmesi, "bilgi bulundu" eşiğinin yeniden ayarlanması, kiracının harcadığı token'ı, tahmini maliyeti ve günlük kotasını panelden görebilmesi.
- **Neden gerekli:** Bugünkü sahte model kelime benzerliğiyle çalışıyor. "Param yatmadı" ile "yatırımım gözükmüyor" cümlelerinin aynı şey olduğunu anlamıyor. Konuşma hafızası, prosedür motoru ve konu tespiti (AI-01…AI-05) gerçek bir model olmadan kurulamaz. iGaming'de trafik maç saatlerinde ve hafta sonu patlar. Kiracının günlük AI kotası akşam 21:00'de biterse AI susar ve bütün yük insanlara kalır. Bu yüzden kotanın görünmesi ve dolmadan uyarı gelmesi şart.
- **Gerekçe / kanıt:**
  - **nexa bugün:** Model ve embedding varsayılan olarak `mock` (`apps/api/src/config/env.ts:685`, `:746`). Gerçek OpenAI adaptörleri yazılmış (`services/ai/provider/openai-llm-provider.ts`, `openai-embedding-provider.ts`). Sahip kararı 2026-10-02'de verilmiş: sağlayıcı OpenAI, bölge `us` (`docs/adr/pilot-llm-embedding-provider.md` §11). `PILOT_MODE=true` ile production'da mock zaten reddediliyor (`env.ts:1376-1385`). Yani kodun büyük kısmı hazır. Eksik olanlar: anahtar, bilgi bankasının yeniden gömülmesi (`pnpm knowledge:reembed`), eşik kalibrasyonu (`measure:knowledge-recall` → `RETRIEVAL_THRESHOLD`) ve kiracıya görünürlük.
  - **Kota ve maliyet:** Günlük token tavanları var (kiracı başına 200.000 LLM token'ı, `env.ts:811-814`, tablo `ai_daily_usage`). Ama tavan bütün kiracılar için tek bir sayı ve kiracı bunu hiçbir ekranda göremiyor (web'de kullanım ekranı yok, sadece kota dolunca hata). Her AI çalıştırmasının token'ı `skill_runs` satırına yazılıyor ve `GET /reports/ai-agent` `tokens` döndürüyor. Para karşılığı yok, çünkü ADR §8 "fiyat koda gömülmez" diyor.
  - **ADR sınırı:** ADR §6'ya göre model araç çağırmıyor ve `response_format` (JSON çıktı) gönderilmiyor; model yalnızca müşteriye gidecek metni yazıyor. Konu tespiti (AI-05), çözülemeyen soru kümeleri (AI-22) ve QA ön puanlama (AI-24) yapılandırılmış JSON çıktı ister. Bu yüzden ADR'nin genişletilmesi gerekiyor.
  - **Piyasa:** ChatBot.com kullanımı "valid chat" sayısıyla ölçüyor; limit aşılınca sohbet başına $0,05 alıyor ve bunu "Paid chats" raporunda açıkça gösteriyor (`kaynaklar/chatbot/chatbot-uygulama.md` §7.3, §9.1-6). Intercom Fin ve Zendesk "çözüm" başına ücretlendiriyor (araştırma §5.1). Ortak ders: kullanım ve maliyet kiracıya şeffaf gösteriliyor.
  - **Kilitli kararla çakışma:** `MASTER-PROMPT.md` "Dış servisleri MOCK'la — LLM için deterministik stub" diyor. Bu çakışma ADR ile zaten uzlaştırılmış: mock geliştirme, test ve CI için varsayılan olarak kalıyor, gerçek sağlayıcı yalnızca pilot/production ortam ayarıyla açılıyor. Bu maddedeki "varsayılan" kelimesi **pilot dağıtımının varsayılanı** anlamına geliyor, kodun varsayılanı değil.
- **Yapılmazsa:** Pilot müşteri AI'ı denediğinde alakasız ya da boş yanıt görür (sahte web tarayıcısı her siteye "teslimat 3–5 gün" metni döndürüyor, bkz. AI-17). AI-01…AI-05 hiç test edilemez. Maliyet sürprizi yaşanır ya da kota sessizce dolar: AI susar, kimse nedenini bilmez.
- **Bağımlılıklar:** GV-01 (widget kötüye kullanımı kotayı tüketmesin), GV-02 (kalıcı AI iş kuyruğu), AI-26 (modele gitmeden maskeleme), AI-05 / AI-03 (JSON çıktı ihtiyacı), AI-19 (test kotası), BL-01.
- **Netleştirilecek sorular:**
  1. **AI-16-S1:** Oyuncu mesajları ABD bölgesinde (`us`) işlenecek. Bu KVKK açısından kiracı sözleşmesine "yurt dışına aktarım" maddesi olarak mı yazılacak, yoksa AB bölgesi mi hedeflenecek? AB bölgesi için OpenAI'ya ayrıca başvurmak gerekiyor. *Önerilen varsayılan:* Pilotta `us` kalsın. Kiracı sözleşmesine aktarım maddesi eklensin ve AI-26 maskelemesi modele gitmeden önce çalışsın. AB bölgesi F2'de değerlendirilsin.
  2. **AI-16-S2:** Kiracı başına günlük token tavanını kim belirleyecek: paket/plan mı, yoksa SiyahTuş ekibi kiracı bazında elle mi? *Önerilen varsayılan:* Plana bağlı bir varsayılan tavan olsun, SiyahTuş ekibi bunu kiracı bazında elle yükseltebilsin. Kurucu ve Yönetici tavanı görsün, %80'de ve %100'de uyarı alsın, ama kendisi yükseltemesin.
  3. **AI-16-S3:** Panelde token'ın yanında tahmini para (USD) da gösterilsin mi? *Önerilen varsayılan:* Evet. Birim fiyatlar ortam ayarından okunsun ve "tahmini" etiketiyle gösterilsin. Faturalama yine "AI çözümü" sayacına göre (ADR-09) yapılsın.
  4. **AI-16-S4:** Tek model mi kullanılsın, yoksa iki model mi (sınıflandırma ve özet için ucuz/hızlı, oyuncuya yanıt için daha güçlü)? *Önerilen varsayılan:* İki ayar olsun (`LLM_MODEL` + `LLM_MODEL_FAST`). İkincisi boş bırakılırsa birincisi kullanılsın.
  5. **AI-16-S5:** Madde "OpenAI uyumlu sağlayıcı" diyor, ama ADR yalnızca resmi OpenAI'yi destekliyor (§10: başka satıcının uyumluluk katmanı desteklenmez). Azure OpenAI ve benzeri uyumlu uçlar gerekli mi? *Önerilen varsayılan:* Pilotta yalnızca OpenAI. Uyumlu uçlar F2'de, ayrı bir adaptör göreviyle.

### AI-17 — Gerçek web sitesi taraması (çok sayfa, sitemap, sayfa sınırı, periyodik yenileme)
- **Ne:** Kiracının, operatörün yardım merkezi, bonus şartları ve ödeme yöntemleri sayfalarını URL vererek gerçekten taratabilmesi: "tüm alt sayfalar" ya da "tek sayfa" seçimi, sitemap desteği, sayfa sınırı, belirli aralıklarla otomatik yenileme ve hangi sayfanın neden alınamadığını gösteren liste.
- **Neden gerekli:** iGaming'de bonus şartları ve ödeme limitleri sık değişir. Operatörün sitesi tek doğru kaynaktır. Bu bilgileri elle kopyalayıp yapıştırmak hem zaman alır hem de bilginin hızla eskimesine yol açar. Yanlış bir bonus şartını söylemek doğrudan itiraz ve şikâyet doğurur. Yapılandırılmış tablolar (AI-13) kritik sayıları taşır; site taraması ise genel kuralları ve şartlar metnini tamamlar.
- **Gerekçe / kanıt:**
  - **LiveChat:** Knowledge hub'da "All pages / Single page" seçimi var, "Auto-update every 30 days" (en az 5, en fazla 365 gün) ayarlanabiliyor ve chatbot için 200 sayfa sınırı uygulanıyor (`kaynaklar/livechat-kesif-raporu.md` §2.2–2.3).
  - **Diğer ürünler:** Intercom Fin ve Freshworks Freddy URL kaynağı alıyor, Zendesk yardım merkezinden besleniyor (araştırma §1.2).
  - **nexa bugün:** Getirme sahte. `services/ai/web-crawler.ts:32` `mockFetcher` her URL için "Standard delivery takes three to five working days…" diye uydurma bir e-ticaret metni üretiyor. Pilotta bir casino sitesi eklenirse AI iade politikasıyla yanıt verir. Link takibi ya da sitemap yok; toplu içe aktarma satır başına tek URL alıyor (`knowledge-bulk-crawl.ts`).
  - **Hazır altyapı:** Yenileme döngüsü (`knowledge-refresh-sweep.ts`, `refresh_after_days`, zamanlayıcı işi `knowledge_refresh`) ve SSRF koruması (`lib/ssrf.ts` → `resolvePublicHttpTarget` + `pinnedConnection`) var. eksikler [A-15], [A-21], [A-22].
  - **iGaming'e özgü zorluklar:**
    - Casino ön yüzlerinin çoğu JavaScript ile çizilen tek sayfalık uygulamalar; basit bir HTTP isteği bunlarda boş sayfa döndürür.
    - Bot koruması ve coğrafi engel (TR IP'sinden erişim olmayabilir) taramayı durdurabilir.
    - Erişim engelleri yüzünden adresler sık değişir (G14).
    - Giriş gerektiren sayfalar taranamaz.
- **Yapılmazsa:** AI ya hiç bilgi bulamaz ya da sahte içerikle yanıt verir. Kiracılar bütün şartları elle girmek zorunda kalır ve bu bilgiler eskir. Eskimiş bonus veya ödeme bilgisi şikâyete, hatta ADR (alternatif uyuşmazlık çözümü) başvurusuna dönüşür.
- **Bağımlılıklar:** AI-16 (gerçek embedding), AI-14 (tek bilgi deposu, marka kapsamı), AI-20 (yeni içerik yayına nasıl girer), AI-21 (değişiklik kaydı), GV-02 (kalıcı iş kuyruğu).
- **Netleştirilecek sorular:**
  1. **AI-17-S1:** Otomatik yenilemede değişen içerik doğrudan AI'ın kullanımına mı girsin, yoksa onay mı beklesin? *Önerilen varsayılan:* Varsayılan olarak otomatik girsin, değişen sayfalar "gözden geçir" listesine düşsün ve Yönetici bildirim alsın. Kaynak bazında "yenilemeler onaya tabi" seçeneği olsun ve bonus/ödeme sayfalarında açık gelsin.
  2. **AI-17-S2:** Sayfa sınırı kaç olsun ve plana bağlı mı olsun? *Önerilen varsayılan:* Kaynak başına 200 sayfa (LiveChat ile aynı), kiracı başına toplam 2.000 sayfa. Plana bağlanması BL kararlarıyla birlikte verilsin.
  3. **AI-17-S3:** JavaScript ile çizilen sitelerde gerçek tarayıcı (headless) ile tarama yapılsın mı? Bu maliyeti ve güvenlik yükünü belirgin biçimde artırır. *Önerilen varsayılan:* F1'de hayır. Çok az metin dönen sayfa "Bu sayfa JavaScript gerektiriyor olabilir; içeriği PDF veya metin olarak ekleyin" uyarısıyla işaretlensin.

### AI-18 — PDF/DOCX bilgi kaynağı ve daha büyük dosya sınırı
- **Ne:** Operatörün elindeki PDF ve Word belgelerinin (bonus şartları, ödeme rehberi, KYC kabul kriterleri, iç prosedür kılavuzu) bilgi kaynağı olarak yüklenebilmesi ve dosya sınırının büyütülmesi.
- **Neden gerekli:** Operatörler prosedürlerini ve şartlarını çoğunlukla PDF ya da Word olarak verir: ödeme sağlayıcısının dokümanı, T&C PDF'i, eğitim kılavuzu. Bugün yalnızca .txt, .md ve .csv kabul ediliyor, sınır da 2 MiB. Pilot kurulumunda bu belgelerin elle metne çevrilmesi günler sürer.
- **Gerekçe / kanıt:**
  - **Piyasa:** LiveChat Knowledge hub PDF kabul ediyor ve sınırı 46 MB (`livechat-kesif-raporu.md` §2.3). Intercom Fin ve Freddy dosya kaynağı destekliyor (araştırma §1.2).
  - **nexa'da bilinçli ret:** PDF/DOCX desteği bilerek eklenmemiş (`services/ai/knowledge-file-parse.ts:42-46`). Gerekçe: belge ayrıştırıcılarının güvenlik açığı geçmişi var ve saf fonksiyon olarak yazılamıyorlar.
  - **Sınırlar:** İzin verilen türler üç tane (`packages/types/src/knowledge-file.ts:31`). Dosya sınırı **2 MiB** (`:45`). eksikler.md'deki "4 MiB" base64 kodlu istek gövdesinin sınırı (`routes/playbook.ts:200`); dosyanın kendisi için sınır 2 MiB. Metin sınırı 100.000 karakter (`:55`).
  - **İşleme şekli:** Ayrıştırma ve gömme isteğin içinde, eşzamanlı yapılıyor (`routes/playbook.ts:761-826`). Büyük dosya için arka plan işi gerekecek.
  - **Hazır altyapı:** Yüklemelerde virüs tarayıcı (`services/storage/virus-scanner.ts`) ve nesne deposu (`object-store.ts`) zaten var. eksikler [A-27].
  - **Güvenlik gerekçesiyle ilişkisi:** Koddaki ret gerekçesi geçerli. Çözüm desteği reddetmek değil, ayrıştırmayı izole edilmiş ve kaynakları sınırlanmış bir işçi süreçte yapmak.
- **Yapılmazsa:** Kiracılar uzun belgeleri elle kopyalar, tablolar ve başlıklar kaybolur, kurulum süresi uzar. Pilot onboarding'inde "AI'a belgemizi veremiyoruz" itirazı çıkar.
- **Bağımlılıklar:** AI-16, AI-14, AI-13 (kritik sayılar PDF'ten değil, yapılandırılmış tablodan gelmeli), GV-02, AI-21.
- **Netleştirilecek sorular:**
  1. **AI-18-S1:** Dosya sınırı ne olsun? Taranmış (görüntü) PDF'ler için OCR yapılsın mı? *Önerilen varsayılan:* Dosya başına 20 MB, 300 sayfa ve 1.000.000 karakter. OCR F1'de olmasın; görüntü PDF'i "metin bulunamadı, taranmış belge olabilir" uyarısıyla reddedilsin.
  2. **AI-18-S2:** Orijinal dosya saklansın mı, yoksa yalnızca çıkarılan metin mi? *Önerilen varsayılan:* Orijinal dosya nesne deposunda saklansın. Böylece yeniden ayrıştırılabilir ve QA'da "kaynağı göster" denebilir. Kaynak silinince dosya da silinsin.

### AI-19 — Çok turlu test ve simülasyon
- **Ne:** Kurucu, Yönetici ve Ekip Liderinin AI ile "oyuncu gibi" çok mesajlı konuşabildiği bir test alanı. Buna ek olarak:
  - kayıtlı senaryolar (sabırsız, kızgın, eksik bilgi veren, sorumlu oyun sinyali veren, "insan istiyorum" diyen oyuncu);
  - her senaryo için beklenen sonuç (çözüldü / şu ekibe devredildi / şu bayrak kondu);
  - yayından önce bütün senaryoların toplu olarak yeniden koşulması (regresyon) ve sonuç farkının gösterilmesi.
- **Neden gerekli:** iGaming'de tek bir yanlış yanıt (self-exclusion isteyen oyuncuya bonus önermek, "5 dakikaya yatar" diye söz vermek) lisans ve itibar riski taşır. Bir kural ya da prosedür değiştiğinde eskiden doğru çalışan davranışların bozulmadığını kanıtlamak gerekir. Tek mesajlık önizleme, "yöntem → saat → dekont" gibi çok turlu bir teşhis akışını (AI-03) test edemez.
- **Gerekçe / kanıt:**
  - **Intercom Fin:** Procedure Simulations var: AI ile üretilen ya da elle yazılan senaryolar, sahte bağlayıcı çıktısı ve simüle edilmiş saat ("çekim 24 saati geçti mi?"). Batch test ve önizleme ayrı araçlar (araştırma §1.2–1.3).
  - **Sierra:** Simülasyonlarla regresyon koşuyor ve bir "hakem" model prosedüre uyumu puanlıyor. Decagon'da Duet simüle konuşmalarla test ediyor.
  - **ChatBot.com:** Planlarında "Testing tool / Debug mode" var (`chatbot-uygulama.md` §7.3).
  - **Araştırmanın önerisi:** Ekran F'de bu test alanı tarif ediliyor. Karar önerisi 4: "simülasyon senaryosu olmadan yayın yapılmasın".
  - **nexa bugün:**
    - `POST /skills/preview` (`routes/playbook.ts:577-603`) tek bir mesajla çalışıyor ve konuşma geçmişi boş geliyor (`skill-engine.ts:353` `history: []`).
    - Her önizleme günlük AI kotasından düşüyor (`aiBudget: true`).
    - Senaryo kaydı, beklenen sonuç ve toplu koşu yok. Var olan `apps/e2e/tests/ai-agent.spec.ts` geliştiricinin testi; kiracının kendi senaryoları değil.
- **Yapılmazsa:** Kiracı yayına körlemesine çıkar ve uyum hatasını ancak gerçek bir oyuncu yaşadığında fark eder. Her kural değişikliği eski akışları sessizce bozabilir. "Neden bozuldu?" sorusunun cevabı da olmaz.
- **Bağımlılıklar:** Test edilecek davranışlar: AI-01, AI-02, AI-03, AI-04, AI-08, AI-09, AI-27. Ayrıca: AI-20 (yayın kapısı), AI-15 (şablonlarla gelen hazır senaryolar), AI-16 (gerçek model ve test kotası), AI-24 (QA bulgusu senaryoya dönüşür), AI-28 (sahte araç çıktısı), RL-02 / RL-03 (kim koşturur).
- **Netleştirilecek sorular:**
  1. **AI-19-S1:** Yayın için senaryoların geçmesi zorunlu mu olsun? *Önerilen varsayılan:* Platformun kilitlediği uyum senaryoları (G1–G5, G7, G11, G16) %100 geçmeden yayın butonu kapalı kalsın. Kiracının kendi senaryolarında kalanlar varsa Yönetici gerekçe yazarak yine de yayınlayabilsin.
  2. **AI-19-S2:** Simülasyonlar kiracının günlük AI kotasından düşsün mü? *Önerilen varsayılan:* Ayrı bir "test kotası" olsun (günlük canlı kotanın %20'si). Testler canlı oyuncu trafiğinin kotasını hiçbir zaman tüketmesin.
  3. **AI-19-S3:** Senaryo sonucunu kim değerlendirsin: kesin kurallar mı, LLM hakem mi? *Önerilen varsayılan:* İkisi birlikte. Geç/kal kararını kesin kontroller versin (zorunlu bilgiler toplandı mı, yasaklı ifade geçti mi, doğru ekibe devredildi mi, bayrak kondu mu). LLM hakem yalnızca ton ve doğruluk için puan ve yorum versin; tek başına bir senaryoyu kaldıramasın.

### AI-20 — Taslak → test → onay → yayın (sürüm, geri alma, dört göz)
- **Ne:** AI ayarlarının (profil, davranış kuralları, prosedürler, devir kuralları, bilgi tabloları) canlı sürümden ayrı bir taslakta düzenlenmesi. Akış: taslak hazırlanır, test edilir, onaylanır ve sürüm numarasıyla yayınlanır; gerekirse tek tıkla önceki sürüme dönülür. Ekip Lideri hazırlar, Yönetici yayınlar. Uyum kurallarında değişiklik Kurucu onayı ister.
- **Neden gerekli:** Gece vardiyasında aceleyle yapılan bir değişiklik bugün binlerce oyuncuya anında gidiyor. Bonus kampanyaları belli bir saatte başlar; içeriğin önceden hazırlanıp o saatte yayınlanması gerekir. Dört göz kuralı hem hatalara hem de içeriden kötüye kullanıma (örneğin "bonus garantili" ifadesi eklemek) karşı korur. Denetimde "bu yanıt hangi kural setiyle verildi?" sorusunun cevabı da sürüm numarasıdır.
- **Gerekçe / kanıt:**
  - **Araştırma:** Ekran D'de durumlar "Taslak / Testte / Onay bekliyor / Yayında / Arşiv" olarak tanımlı ve her yayın bir versiyon numarası alıyor. Ekran H'de dört göz onayı ve geri alma var.
  - **Piyasa:** Sierra'da değişiklikler kod gibi sürüm kontrolüyle izleniyor (araştırma §1.3). ChatBot.com'da "Version history" yalnızca Team ve üstü planlarda var; onay akışı yok, Editor rolü doğrudan canlıyı değiştiriyor (`chatbot-uygulama.md` §7.2, §9.1-4).
  - **nexa'da sürüm yok:**
    - Skill yalnızca `active` aç/kapa alanına sahip (`schema.prisma:1668`). PATCH isteği canlıyı anında değiştiriyor (`routes/playbook.ts:499-534`).
    - Bilgi kaynağının durumu yalnızca `ready` / `indexing`. Taslak, sürüm ya da geri alma yok.
  - **nexa'da yetki kaba:** AI düzenleme yetkisi (`agents-bot--all:rw`) yalnızca admin ve üstü rollerde (`packages/types/src/role-scopes.ts:89`). Ekip Lideri rolü yok.
  - **ADR-14 ile uyum:** Bu madde ADR-14 ile çakışmıyor. Skill tek paradigma olarak kalıyor; sürümleme Skill'lerin, bilgi kaynaklarının ve kuralların üzerinde bir "AI yapılandırma paketi" olarak çalışıyor. Ölü `workflows` tablosunun `status: draft` alanı kullanılmıyor.
- **Yapılmazsa:** Yanlış bir kural anında canlıya geçer. Geri dönmek için eski hâli hatırlamak gerekir. Oyuncu itirazında ve regülatör denetiminde (CGA tutarlılık şartı, UKGC kanıt beklentisi) hangi kuralın geçerli olduğu gösterilemez.
- **Bağımlılıklar:** AI-19, AI-21, RL-01 / RL-02 / RL-03, AI-07 / AI-08 (kurallar), AI-03 (prosedürler), AI-13 / AI-14 (bilgi), AI-25 (sürüme göre metrik karşılaştırma).
- **Netleştirilecek sorular:**
  1. **AI-20-S1:** Sürümün kapsamı ne olsun: tüm AI yapılandırması tek paket mi (tek sürüm numarası), yoksa her prosedür ve kural ayrı ayrı mı yayınlanır? *Önerilen varsayılan:* Tek paket ("AI yapılandırması v12"). Basit bilgi metni düzeltmeleri "hızlı yol" ile ayrı yayınlanabilsin, ama yine kayda geçsin.
  2. **AI-20-S2:** Bilgi bankası değişiklikleri de onaya tabi olsun mu? *Önerilen varsayılan:* Ödeme, bonus ve KYC tabloları ile uyum kuralları onaya tabi olsun. Serbest makale ve SSS metinlerini Yönetici doğrudan yayınlayabilsin.
  3. **AI-20-S3:** Acil durumda (canlıda yanlış bilgi var) tek kişi işlem yapabilsin mi? *Önerilen varsayılan:* Geri alma ve "AI'ı duraklat" işlemlerini tek bir Yönetici (ve üstü) yapabilsin. İleriye doğru yeni yayın her zaman dört göz istesin.
  4. **AI-20-S4:** Zamanlanmış yayın olsun mu? *Önerilen varsayılan:* Evet, F1'de basit "şu tarih ve saatte yayınla" seçeneği olsun (kampanya başlangıçları için). Yayın anında onay ve test sonuçları yeniden kontrol edilsin.

### AI-21 — AI ayar değişiklik geçmişi
- **Ne:** Bilgi, kural, prosedür ve profil değişikliklerinde kimin, ne zaman, neyi değiştirdiğinin kaydı. Kayıt önceki ve sonraki hâlin farkını da içerir. Kayıtlar ekranda görüntülenebilir ve dışa aktarılabilir.
- **Neden gerekli:** Oyuncu "AI bana dün şunu söyledi" diye itiraz ettiğinde, o anda hangi kuralın ve bilginin geçerli olduğu gösterilebilmelidir. Ekip içindeki "bunu kim değiştirdi?" tartışmasını bitirir. Regülatör beklentisi de bu yönde: CGA "AI kayıtlarının izlenmesi" şartı, UKGC değerlendirme kanıtı (araştırma §4.1, §5.3-5).
- **Gerekçe / kanıt:**
  - **Araştırma:** Ekran H her değişikliği "kim, ne zaman, diff, versiyon" olarak tarif ediyor.
  - **ChatBot.com:** Denetim kaydı yok, sürüm geçmişi de yalnızca üst planlarda (`chatbot-uygulama.md` §9.1-4).
  - **nexa'da altyapı var:** Hash zincirli bir `audit_log` tutuluyor (`schema.prisma:2477-2515`, `services/audit/audit-log.ts`).
  - **Ama AI tarafında yalnızca silme kaydediliyor:** `routes/playbook.ts:546` ve `:1368` yalnızca `data.deleted` yazıyor. `AUDIT_ACTIONS` listesinde skill, bilgi kaynağı ya da AI profili oluşturma/güncelleme eylemi yok. `PATCH /ai-agents/:id` iz bırakmıyor.
  - **Mevcut log bu iş için tek başına yetmez, iki nedenle:**
    - Audit kaydına değer yazmak yasak; yalnızca alan adları, sayılar ve roller yazılabiliyor (`audit-log.ts`, `AuditEntry.metadata` açıklaması). Yani "önce/sonra farkı" orada tutulamaz.
    - Audit kayıtları varsayılan olarak 30 gün sonra siliniyor ve kiracı bu süreyi uzatamıyor (`services/retention/policy.ts`, `auditDays`). AI yapılandırma geçmişinin bundan daha uzun yaşaması gerekiyor.
- **Yapılmazsa:** İtiraz ya da denetim anında kanıt olmaz. Hatalı değişikliğin kaynağı bulunamaz. Geri alma (AI-20) neye döneceğini bilemez.
- **Bağımlılıklar:** AI-20 (sürüm kayıtları farkın kaynağı), ID-08 / ID-09 (log ve zaman çizelgesi görüntüleyici), RL-02 (kim görür).
- **Netleştirilecek sorular:**
  1. **AI-21-S1:** Değişiklik geçmişi ne kadar süre saklansın? *Önerilen varsayılan:* AI yapılandırma geçmişi en az 5 yıl ya da kiracı hesabı silinene kadar saklansın. Audit log'un 30 günlük penceresine bağlı olmasın.
  2. **AI-21-S2:** Geçmişi kim görebilsin? *Önerilen varsayılan:* Kurucu ve Yönetici tamamını görsün. Ekip Lideri kendi hazırladığı değişiklikleri ve yayın geçmişini görsün. Bu ayar RL-02 matrisinden değiştirilebilsin.

### AI-22 — Çözülemeyen sorular ve bilgi boşluğu raporu
- **Ne:** AI'ın yanıt veremediği, "bilmiyorum" dediği, anlayamayıp devrettiği ya da oyuncunun yanıttan sonra terk ettiği mesajların kaydedilmesi. Benzer mesajlar gruplanır ve gruplar hacme, terk oranına ve devir oranına göre sıralanır. Her gruptan "bilgi ekle / prosedüre örnek cümle ekle / kural ekle / yok say" eylemi yapılabilir.
- **Neden gerekli:** Pilotun ilk haftalarında AI'ı iyileştirmenin en hızlı yolu "en çok sorulan ve cevaplanamayan 10 konu" listesidir. iGaming'de yeni bir ödeme yöntemi, kampanya ya da hata mesajı çıktığı anda oyuncular sormaya başlar. Bu boşluk görünmezse AI sürekli devreder ve insan yükü hiç azalmaz.
- **Gerekçe / kanıt:**
  - **Intercom Fin:** "Unresolved questions" ekranı benzer çözülmemiş soruları kümeliyor ve AI içerik önerileri üretiyor (araştırma §1.3).
  - **ChatBot.com:** Training › Unmatched phrases / Ignored kuyruğu var; Popularity raporunda "Bot doesn't understand 1x / 2x or more" oranı izleniyor (`chatbot-uygulama.md` §3, §5, §9.1-2). Gözlem notu: bu, gerçek zamanlı bir "fallback alarmına" çevrilmeli (§9.3).
  - **Araştırma:** §5.2'de "çözülemeyen soru kümeleri" metriği ve Ekran G'de karşılığı var.
  - **nexa bugün iz bırakmıyor:**
    - Hiçbir skill uymazsa motor kayıt yazmadan dönüyor (`services/ai/skill-engine.ts:295` `return NOTHING_RAN`).
    - Desteklenmeyen dildeki mesaj da sessizce atlanıyor (`:279-280`).
    - Bilgi bulunamazsa sonuç yine `skipped` oluyor. Bu mesajlar hiçbir yerde görünmüyor.
  - **Hazır parça:** Deterministik bir kümeleme algoritması var (`packages/ai-mock/src/topics.ts`, "Chat topics" raporu). Ama girdisi bütün sohbetler ve sonuç kaydedilmiyor.
- **Yapılmazsa:** İyileştirme körlemesine yapılır. Aynı boşluk haftalarca devirle kapatılır ve insan maliyeti düşmez. AI başarı oranının neden düşük olduğu açıklanamaz.
- **Bağımlılıklar:** AI-05 (konu tespiti), AI-06 ("bilmiyorum" davranışı), AI-09 (devir nedeni), AI-14 (bilginin ekleneceği yer), AI-23 (öneri kuyruğu), AI-25, AI-26 (kayıttan önce maskeleme), ID-08.
- **Netleştirilecek sorular:**
  1. **AI-22-S1:** Kayda düşen oyuncu cümleleri ne kadar süre saklansın? *Önerilen varsayılan:* Maskelenmiş metin en fazla 90 gün saklansın ve sohbet saklama süresi daha kısaysa ona uysun. Grup başlığı ve sayılar süresiz kalsın.
  2. **AI-22-S2:** Yalnızca günlük rapor mu olsun, yoksa ani artışta canlı uyarı da gelsin mi? *Önerilen varsayılan:* İkisi de olsun. Liste her saat güncellensin. Bir grup 60 dakikada 20 mesajı geçerse (eşik kiracı tarafından ayarlanabilir) Ekip Liderine ve Yöneticiye uygulama içi bildirim gitsin.

### AI-23 — Koçluk ve öneri kuyruğu
- **Ne:** Ekip Üyesi devraldığı sohbette AI'ın mesajını işaretleyebilir: "yanlış/eksik cevap", "bunu bilgiye ekle", "burada devretmeliydi", "gereksiz devretti". Ajanın oyuncuya verdiği başarılı yanıttan "AI bilgisine öner" denebilir. Tüm öneriler Ekip Liderinin onay kuyruğuna düşer. Onaylanan öneri bilgi, kural ya da prosedür taslağına dönüşür ve AI-20 yayın akışına girer. Öneriyi yapan ajan sonucu görür.
- **Neden gerekli:** AI'ı en iyi tanıyan, her gün oyuncuyla konuşan ajandır. "Papara artık 7/24 değil" ya da "yeni kripto ağı eklendi" gibi değişiklikleri ilk duyan kişi de odur. Bu bilgiyi AI'a aktarmanın resmi bir yolu yoksa bilgi WhatsApp gruplarında kaybolur ve AI aynı hatayı tekrarlar.
- **Gerekçe / kanıt:**
  - **Ada:** "Coaching" ile konuşma üzerinden düzeltme yapılabiliyor (araştırma §1.2).
  - **Intercom Fin:** İnsan ajanın başarılı yanıtından makale önerisi üretiyor (§1.3).
  - **Araştırma:** Ekran G "makale/kural önerisi, Ekip Lideri onaylar" diyor; §5.3-3'te koçluk döngüsü tarif ediliyor.
  - **ChatBot.com:** Training ekranında "train / ignore" var ama onay katmanı yok. Gözlem notu: "Ekip Üyesi 👍/👎, Ekip Lideri onaylar, Yönetici yayınlar, audit log" (`chatbot-uygulama.md` §9.3).
  - **nexa bugün:** Ajandan AI'a geri bildirim kanalı yok (`kaynaklar/nexa-ai-motoru.md`: "Geri bildirim döngüsü yok").
  - **Kullanılabilecek parçalar:** Inbox'ta Copilot paneli var (`apps/web/src/features/inbox/CopilotPanel.tsx`); öneri butonu doğal olarak buraya oturur. Herkese açık bilgi bankası makalelerinde yayın akışı var (`kb.article_published`), ama AI bilgisine öneri yolu yok.
- **Yapılmazsa:** AI hataları tekrar eder. Ajanlar AI'a güvenmez ve AI'ın yanıtlarını beklemeden sohbeti devralır. Bilgi bankası eskir; iyileştirme tek bir yöneticinin hafızasına kalır.
- **Bağımlılıklar:** AI-11 (devralma), AI-14 (bilginin hedefi), AI-20 (taslak/yayın), AI-22 (öneri bir kümeye bağlanabilir), AI-24 (QA bulguları da bu kuyruğa akar), AI-19 (öneriden senaryo), RL-03 (Ekip Lideri onayı), AI-26 (öneri metninden kişisel veri temizliği).
- **Netleştirilecek sorular:**
  1. **AI-23-S1:** Ekip Lideri onaylayınca öneri doğrudan yayına mı girsin? *Önerilen varsayılan:* Ekip Liderinin onayı öneriyi taslağa çevirsin, yayın AI-20'deki dört göz kuralına tabi olsun (Yönetici yayınlar). Yalnızca metin düzeltmesi içeren bilgi önerileri Yönetici tarafından "hızlı yol" ile yayınlanabilsin.
  2. **AI-23-S2:** Ajanın yanıtından otomatik bilgi önerisi her devirde üretilsin mi? Bu, maliyet ve gürültü demek. *Önerilen varsayılan:* Hayır. Yalnızca ajan "AI bilgisine öner" dediğinde ya da aynı çözülemeyen soru kümesinde (AI-22) haftada 3'ten fazla benzer ajan yanıtı birikince üretilsin.

### AI-24 — Kalite kontrol (QA) kuyruğu
- **Ne:** AI'ın yürüttüğü ya da devrettiği sohbetlerin bir inceleme kuyruğuna alınması. Kuyruğa iki kaynaktan sohbet girer:
  - **Örneklem:** Her hafta rastgele seçilen bir oran.
  - **Tam inceleme:** Risk bayraklı, düşük puanlı, 72 saat içinde tekrar temas eden ve otomatik tarayıcının işaretlediği sohbetlerin tamamı.

  Sohbetler bir puan kartıyla (rubrik) değerlendirilir: doğru konu, zorunlu bilgiler, bilgiye sadakat, kurallara uyum, doğru zamanda devir, devir özeti, ton. Önce LLM ön puan verir, ardından Ekip Lideri onaylar. Ayda bir kalibrasyon yapılır.
- **Neden gerekli:** CGA şikâyet yönergesi AI kayıtlarının izlenmesini ve önerilen çözümlerin benzer vakalarda tutarlı olduğunun doğrulanmasını istiyor. UKGC de müşteri etkileşiminin değerlendirildiğine dair kanıt bekliyor (araştırma §4.1). Kiracılarınız operatörlere "AI'ımız bu hafta %98 kurallara uydu, ihlaller şunlar ve düzeltildi" diyebilmeli. Bu hem denetim kanıtı hem satış argümanı.
- **Gerekçe / kanıt:**
  - **Piyasa:** Zendesk QA / autoQA ve Sierra'nın hakem modeli kullanılıyor (araştırma §1.2, §5.3).
  - **Araştırmanın önerdiği süreç (§5.3):**
    - %5–10 örneklem;
    - %100 inceleme koşulları (risk bayrağı, düşük BSAT, 72 saatte tekrar temas, guardrail tarayıcısı);
    - a–g rubriği;
    - aylık kalibrasyon;
    - uyum kaydı.
  - **ChatBot.com:** Tek tek yanıtlar için onay ya da puanlama yok (`chatbot-uygulama.md` §9.1-2).
  - **nexa bugün:** QA modülü yok. `services/reports/review-insights.ts` yalnızca müşteri puanları ve yorumlarıyla çalışıyor. `skill_runs.log` hangi adımın neden çalıştığını kaydediyor; bu, QA için hazır bir kanıt kaynağı. Müşteri puanı iyi/kötü şeklinde (`packages/types/src/domain.ts:271`).
- **Yapılmazsa:** Uyum ihlalleri (söz verme, sorumlu oyun sinyalini kaçırma, şifre isteme) fark edilmez. Denetimde gösterilecek kanıt olmaz. AI kalitesi ölçüme değil, kişisel izlenime dayanır.
- **Bağımlılıklar:** AI-25 (yanlış çözüm, zorunlu devir uyumu ve tutarlılık metrikleri QA sonucunu kullanır), AI-27 (bayraklı sohbetlerin %100 incelemesi), AI-08 (guardrail tarayıcısı), AI-23 (bulgudan öneri), AI-19 (bulgudan senaryo), AI-20 (sohbetin hangi sürümle yürütüldüğü), RL-03, ID-09 (transkript ve karar izi).
- **Netleştirilecek sorular:**
  1. **AI-24-S1:** Rastgele örneklem oranı ne olsun ve kim değiştirebilsin? *Önerilen varsayılan:* %5 olsun ve kiracı %1–20 arasında ayarlayabilsin. %100 inceleme kategorileri platform tarafından kilitli olsun; kiracı kapatamasın.
  2. **AI-24-S2:** LLM ile ön puanlama açık mı olsun? Maliyeti var ve oyuncu metni yeniden modele gidiyor. *Önerilen varsayılan:* Açık olsun, ama yalnızca kuyruğa düşen sohbetlerde ve maskelenmiş metinle. Kiracı kapatabilsin.
  3. **AI-24-S3:** İnsan ajanların sohbetleri de aynı QA'ya girsin mi? *Önerilen varsayılan:* F1'de hayır. Yalnızca AI'ın konuştuğu sohbetler ve devir kalitesi girsin. İnsan ajan QA'sı ayrı bir ürün kararı olarak (P2) ele alınsın.

### AI-25 — AI metrikleri
- **Ne:** AI performansını "insan karışmadı" (containment) oranıyla değil, gerçek başarıyla ölçen bir panel. Metrikler araştırma §5.2'den alındı:
  - onaylı çözüm;
  - varsayılan çözüm;
  - yanlış çözüm (72 saat içinde aynı konuyla tekrar temas ya da QA'da "çözülmemiş" bulunması);
  - containment;
  - devir oranı ve devir nedenleri;
  - devir kalitesi;
  - zorunlu devir uyumu;
  - guardrail ihlali;
  - bot memnuniyeti (BSAT);
  - netleştirme verimliliği;
  - devirden sonra insana ulaşma süresi;
  - tutarlılık.

  Panel konu, marka, ekip, dil ve AI sürümüne göre filtrelenebilir.
- **Neden gerekli:** iGaming'de "param yatmadı" yazıp tatmin edici yanıt alamayan oyuncu sohbeti kapatır ve başka kanaldan tekrar yazar. Containment bunu "başarı" sayar. Gerçek başarı ölçülmezse AI yanlış yöne optimize edilir ve operatöre yanlış rakam satılır. Sorumlu oyun devirlerinin %100 yapıldığını kanıtlamak da regülasyon açısından şart.
- **Gerekçe / kanıt:**
  - **Containment yanıltıcı:** Araştırmadaki örnekte containment %72,6, gerçek çözüm ise %35,2. Intercom Fin'in "assumed resolution" yaklaşımı yanlış çözüm üretebiliyor. Zendesk otomatik çözümü LLM ile doğruluyor ve BSAT'ı insan CSAT'ından ayrı ölçüyor (§5.1–5.2). Karar önerisi 5: Faz 1 KPI'ı devir kalitesi, yanlış çözüm oranı ve zorunlu devir uyumu olmalı.
  - **ChatBot.com:** Yalnızca hacim raporları var; çözüm, CSAT ve devir yok (`chatbot-uygulama.md` §5, §9.1-1).
  - **nexa bugün:**
    - `GET /reports/ai-agent` (`apps/api/src/routes/reports.ts:829-869`) şunları döndürüyor: `resolutions` (ADR-09 tanımı: thread hiçbir ajan mesajı olmadan kapandıysa AI çözümü sayılır; faturalamayla aynı sayaç), `transfer_rate`, `skill_runs`, `tokens`.
    - `apps/web/src/features/playbook/AiPerformance.tsx` dört kart gösteriyor. Buradaki CSAT genel memnuniyet; AI'a özgü değil.
    - ADR-09'un "çözüm" tanımı araştırmadaki **varsayılan çözüme** denk geliyor. Onaylı çözüm, yanlış çözüm, devir nedeni, zorunlu devir ve tutarlılık için gereken veri bugün hiç kaydedilmiyor.
  - **Kilitli kararla ilişkisi:** ADR-09'a göre rapor ile fatura aynı sorgudan beslenmeli. Fatura sayacı değiştirilmeyecek. Yeni metrikler onun yanına ek olarak gelecek ve panelde "AI çözümü (faturalanan)" ile "onaylı çözüm" ayrı etiketlerle gösterilecek.
- **Yapılmazsa:** Yanlış KPI'larla yönetilir. Kiracı yanlış çözümleri göremez. Zorunlu devir ihlalleri raporlarda görünmez. Yeni sürümün eskisinden iyi olup olmadığı anlaşılamaz.
- **Bağımlılıklar:** AI-05 (konu etiketi), AI-09 (devir nedenleri), AI-10 (devir kartı: ajan "yeterli" işaretler), AI-24 (QA sonuçları), AI-27 (bayraklar), AI-20 (sürüm numarası), AI-29 ("sorununuz çözüldü mü?" butonu), ID-02 / ID-03 / ID-04 (üye kimliği ve gün: 72 saat tekrar temas için), RP-01 (filtreler), AI-08.
- **Netleştirilecek sorular:**
  1. **AI-25-S1:** Faturalanan "AI çözümü" tanımı (ADR-09: ajan yazmadan kapandı) korunsun mu, yoksa onaylı çözüme mi geçilsin? *Önerilen varsayılan:* F1'de fatura ADR-09 tanımında kalsın. Panelde onaylı, varsayılan ve yanlış çözüm ayrı ayrı gösterilsin. "Yanlış çözümlerin faturadan düşülmesi" F2'de ticari bir karar olarak değerlendirilsin.
  2. **AI-25-S2:** Sohbet sonunda oyuncuya "Sorununuz çözüldü mü? Evet / Hayır" sorulsun mu ve BSAT hangi ölçekle ölçülsün? *Önerilen varsayılan:* Evet, AI çözüm yanıtıyla bitirdiğinde bu butonlar çıksın. BSAT için mevcut iyi/kötü puan kullanılsın, ama AI sohbetlerinde ayrı kaydedilsin. 1–5 ölçeğine geçilmesin.
  3. **AI-25-S3:** "Tekrar temas" tanımı ne olsun? *Önerilen varsayılan:* Pencere 72 saat. "Aynı üye" ID-03 eşleşmesine göre belirlensin (kullanıcı adı + marka). "Aynı konu" AI-05'in verdiği konu etiketine göre belirlensin. Konu bilinmiyorsa tekrar temas "herhangi bir konu" satırında ayrıca raporlansın.

### AI-26 — Sohbet içi hassas veri maskeleme
- **Ne:** Oyuncu sohbette şu bilgilerden birini paylaşırsa, mesaj kaydedilmeden önce maskelenir: şifre, OTP/SMS kodu, kart numarası, CVV, internet bankacılığı bilgisi, kripto seed phrase ya da özel anahtar, IBAN. Oyuncuya "bu bilgiyi paylaşmayın" uyarısı gider. Ajan ekranında, AI'da, loglarda ve modele giden metinde yalnızca maskeli hâl bulunur. Bugünkü kart maskelemesi bu şekilde genişletilir.
- **Neden gerekli:**
  - **Dolandırıcılık ve panik:** iGaming dolandırıcılığının en yaygın yolu "destek" kılığına girip OTP ya da şifre istemektir. Panik hâlindeki oyuncu ("param yatmadı!") her şeyi yazabilir.
  - **Kalıcı risk:** Bu veriler veritabanında, loglarda, yedeklerde ve yurt dışındaki LLM sağlayıcısında kalırsa hem KVKK ihlali hem de hesap ele geçirme riski doğar.
  - **Kural:** Bu, guardrail G11'in teknik karşılığı.
- **Gerekçe / kanıt:**
  - **Araştırma:** G11 kuralı ve §3.1 adım 7 ("Kart numaranızı ya da şifrenizi paylaşmayın… hesap numarasının ilk hanelerini kapatabilirsiniz") bunu tarif ediyor. Finansın eşleştirme yapabilmesi için IBAN'ın son 4 hanesi yeterli.
  - **nexa'da kart maskelemesi var:** `apps/api/src/lib/cc-mask.ts` Luhn kontrollü kart maskelemesi yapıyor. Maskeleme kayıt anında şu yerlerde uygulanıyor:
    - `routes/customer.ts:668`
    - `routes/chats.ts:197`, `:376`
    - `services/channels/channel-service.ts:478`
    - `services/channels/email-inbound.ts:122`
    - `lib/log-redact.ts:164`
  - **Eksik olanlar:**
    - IBAN, OTP, CVV, şifre, seed phrase ve özel anahtar için tespit yok.
    - Oyuncuya uyarı gitmiyor.
    - Ek görseller (dekont) maskelenmiyor.
- **Yapılmazsa:** KVKK/PCI ihlali yaşanır. Bir veri sızıntısında hesaplar ele geçirilebilir. Hassas veri yurt dışındaki modele gider. Denetimde "OTP'ler kayıtlarımızda duruyor" demek zorunda kalınır.
- **Bağımlılıklar:** AI-08 (AI bu bilgileri hiç istemez; çıktı denetimi), AI-16 (modele gitmeden önce), AI-04 (IBAN son 4 hane gibi kısmi alanlar), AI-27 (şifre/OTP paylaşımı "hesap güvenliği" bayrağı olabilir), ID-08, AI-22 / AI-23 / AI-24 (bu kayıtlar maskeli tutulur).
- **Netleştirilecek sorular:**
  1. **AI-26-S1:** IBAN tamamen mi maskelensin, yoksa son 4 hane görünsün mü? (Finans eşleştirme için son haneler gerekiyor.) *Önerilen varsayılan:* Son 4 hane görünsün (`TR** **** … **12 34`). Tam IBAN hiçbir yerde saklanmasın.
  2. **AI-26-S2:** Ajan ve AI mesajlarına da maskeleme uygulansın mı? Türk pazarında ajanlar oyuncuya yatırım için IBAN paylaşabiliyor. *Önerilen varsayılan:* Ajan ve AI mesajlarında kart, CVV, OTP, şifre ve seed maskelensin; IBAN maskelenmesin. Oyuncu mesajlarında hepsi maskelensin. AI'ın kendisi IBAN vermesin (AI-08).
  3. **AI-26-S3:** OTP gibi bağlama dayalı tespitlerde yanlış pozitif riski var (işlem numarası, tutar). Hangi kural uygulansın? *Önerilen varsayılan:* 4–8 haneli bir sayı yalnızca yakınında "kod / şifre / OTP / SMS / doğrulama" gibi bir kelime varsa maskelensin. Tek başına duran sayı ve kripto TXID'si (64 haneli onaltılık) maskelenmesin, çünkü TXID devir için gerekli.

### AI-27 — Risk bayrakları
- **Ne:** Sohbete ve gerekirse oyuncuya yapılandırılmış risk bayrakları konması.
  - **Bayrak türleri:** sorumlu oyun sinyali, self-exclusion/ara verme talebi, reşit olmama şüphesi, kendine zarar ifadesi, resmi şikâyet/itiraz, fraud/çoklu hesap/hesap ele geçirme şüphesi, hakaret/tehdit.
  - **Kim koyar:** AI (G1–G5, G13, G15, G19 tetikleyicileri) ya da ajan.
  - **Etkisi:** Bayraklı sohbette AI ve kampanyalar bonus, promosyon ve "yatırım yap" önerisi yapamaz.
  - **Görünürlük:** Bayrak ajan ekranında, arşivde, raporlarda ve QA'da görünür.
  - **Kaldırma:** Yalnızca yetkili rol, gerekçe yazarak kaldırabilir.
- **Neden gerekli:** Operatörlere hizmet veren bir destek şirketinin en büyük uyum riski, kendini oyundan men etmek isteyen bir oyuncuya bonus teklif etmektir. Düzenleyiciler de bunu istiyor:
  - **UKGC:** Risk göstergesi olan müşteriye pazarlama ve bonusun durdurulmasını istiyor (SR 3.4.3).
  - **CGA:** Self-exclusion yapmış kişileri "kırılgan kişi" sayıyor ve sorumlu oyunla ilgili şikâyetlerin insan tarafından yürütülmesini istiyor (araştırma §4.1).
- **Gerekçe / kanıt:**
  - **Araştırma:** Kurallar §4.2'de (G1–G5, G13, G15, G19). Öncelik Ekran E'de: sorumlu oyun ve reşit olmama "acil". %100 QA incelemesi §5.3'te. Sisal sohbetlerinde problemli kumarın dilsel belirteçleri tespit edilebiliyor; operatörün müşteri iletişim göstergeleri vakaların yaklaşık %77'sini doğru tahmin ediyor (§4.1).
  - **nexa'da bayrak modeli yok:** Yalnızca serbest etiketler var (`Tag` / `ThreadTag`, `schema.prisma:952`, `:1095`). Devir nedeni tek bir değer (`ai_handoff`). `Customer` modelinde risk alanı yok (`schema.prisma:389-426`).
  - **Kampanyalar riske bakmıyor:** Kampanya motoru oyuncunun risk durumunu kontrol etmiyor (EN-01).
- **Yapılmazsa:**
  - Self-exclusion isteyen oyuncuya kampanya pop-up'ı çıkar ve lisans ihlali oluşur.
  - Sorumlu oyun vakaları arşivde bulunamaz; QA'daki %100 inceleme yapılamaz.
  - Oyuncu ertesi gün geldiğinde ajan dünkü kriz konuşmasından habersiz olur.
- **Bağımlılıklar:** AI-08, AI-09, AI-10 (devir kartında bayrak), AI-12 (acil öncelik ve Sorumlu Oyun ekibi), EN-01, AU-01, AR-02 (arşiv filtresi), AI-24, AI-25, ID-03 (oyuncu düzeyinde bayrak için kimlik), RL-02, KN-06 (F2'de operatöre aktarım).
- **Netleştirilecek sorular:**
  1. **AI-27-S1:** Bayrak yalnızca sohbete mi yazılsın, oyuncuya da kalıcı olarak mı? *Önerilen varsayılan:* Bayrak her zaman sohbete yazılsın. Sorumlu oyun, self-exclusion ve reşit olmama bayrakları oyuncuya da yazılsın ve süresiz kalsın; yalnızca yetkili rol gerekçe yazarak kaldırabilsin. Diğer bayraklar sohbetle sınırlı kalsın.
  2. **AI-27-S2:** Bayrağı kim kaldırabilsin? *Önerilen varsayılan:* Sorumlu oyun, self-exclusion ve reşit olmama bayraklarını Yönetici ve üstü kaldırabilsin; gerekçe zorunlu olsun ve kayda geçsin. Diğer bayrakları Ekip Lideri ve üstü kaldırabilsin.
  3. **AI-27-S3:** Oyuncunun kimliği F1'de doğrulanmış değil (kullanıcı adı oyuncunun beyanı). Kalıcı bayrak yanlış kişiye yazılabilir. Nasıl ele alınsın? *Önerilen varsayılan:* Oyuncu düzeyindeki bayrak "beyana dayalı" etiketiyle tutulsun. Ajan ekranında kesin bilgi gibi değil, uyarı olarak gösterilsin. Doğrulama F2'de platform entegrasyonuyla yapılsın.
  4. **AI-27-S4:** Sorumlu oyun bayrağı konunca operatöre anında bildirim gitsin mi? *Önerilen varsayılan:* Evet. F1'de giden bir webhook olayı (`risk_flag.raised`) ve Kurucunun seçtiği e-posta adresine bildirim gitsin. Operatör tarafında hesap üzerinde işlem yapmak operatörün sorumluluğunda kalsın.

### AI-28 — Araç (entegrasyon) yuvası
- **Ne:** Prosedür adımlarında "burada hesap/işlem sistemden kontrol edilecek" yerinin bugünden tanımlanabilmesi: araç adı, girdi alanları (hangi toplanan bilgiden beslenir), beklenen çıktı alanları ve araç yoksa ya da hata verirse ne olacağı.
  - **F1'de pasif:** AI bu adımda "bilgi topla → kuralı uygula → gerekirse devret" yoluna devam eder. Devir kartında "kontrol edilmesi gereken" satırı olarak görünür.
  - **F2'de:** `deposit_lookup`, `withdrawal_status`, `kyc_status`, `bonus_status` gibi araçlar BetConstruct, EveryMatrix vb. bağlayıcılarına bağlanır.
- **Neden gerekli:** Entegrasyon geldiğinde 20 prosedürü baştan yazmak gerekmez; araç yerine takılır. Bugünden şu veri de birikir: "kaç sohbet, otomatik kontrol edilemediği için devredildi?" Bu, hangi entegrasyonun önce yapılacağına dair somut bir öncelik listesi verir. Ajan da devir kartında neyi kontrol etmesi gerektiğini net görür.
- **Gerekçe / kanıt:**
  - **Piyasa:** Intercom Fin'de Procedures içinde Data connectors var; hassas kimlik değerleri modelden değil doğrudan sistemden enjekte ediliyor. Decagon AOP'lerinde Tools, Ada Playbook'larında API çağrıları, Sierra SDK'sında araçlar bulunuyor (araştırma §1.2).
  - **Araştırma:** §1.1'de katman 4 ("Faz 1'de yok ama modelde yeri baştan ayrılmalı"), Ekran D'de "Gelecek entegrasyon yuvası", §3.1'de `deposit_lookup(user_id, amount, time_window)`, §6'da karar 1.
  - **nexa bugün:**
    - Skill adım tipleri kapalı bir liste (`packages/ai-mock/src/steps.ts`: `detect_intent`, `request_info`, `tag`, `summarize`, `send_message`, `transfer_to_team`).
    - ADR `docs/adr/pilot-llm-embedding-provider.md` §6 "tool/function calling — HAYIR, kapsam dışı" diyor.
    - Dışarıya açılan MCP araç kataloğu, araç tanımı için iyi bir desen sunuyor (`apps/api/src/services/mcp/tool-catalog.ts`: zod + JSON Schema + yetki).
    - E-ticaret entegrasyon şablonları sahte (`apps/web/src/features/playbook/templates.ts:502-692`).
  - **Kilitli kararlarla uzlaştırma:**
    - **ADR-14:** Araç yuvası ayrı bir akış aracı olmayacak; Skill/prosedür içinde yeni bir adım tipi olacak. Bu ADR-14 ile uyumlu.
    - **ADR §6:** F1'de bu adım çalıştırılmaz ve model hiçbir aracı çağırmaz. F2'de ADR §6 yeniden açılır. Önerimiz, aracı modelin değil prosedür motorunun deterministik olarak çağırması.
- **Yapılmazsa:** F2'de bütün prosedürlerin yeniden tasarlanması gerekir. Entegrasyon önceliği tahmine dayanır. Bir de güvenlik riski var: "oyuncu kimliğini model mi yazacak, oturum mu verecek?" sorusu şimdiden düşünülmezse, model başka bir oyuncunun kimliğini uydurup sorgulayabilir.
- **Bağımlılıklar:** AI-03, AI-04 (toplanan bilgiler aracın girdisi olur), AI-15 (şablonlarda yuva işaretli gelir), AI-10 (devir kartında "kontrol edilmesi gereken"), AI-19 (sahte araç çıktısıyla F2 dallarını bugünden test etme), KN-06 (F2 entegrasyonları), AI-21.
- **Netleştirilecek sorular:**
  1. **AI-28-S1:** F1'de yuva ajan devir kartında görünsün mü? *Önerilen varsayılan:* Evet. Kartta "Kontrol edilmesi gereken: yatırım sorgusu (kullanıcı adı, tutar, saat)" satırı olsun. Oyuncuya hiçbir şey hissettirilmesin; AI "kontrol ettim" demesin (G8).
  2. **AI-28-S2:** F2'de aracı kim çağırsın: model mi (function calling), prosedür motoru mu? Oyuncu kimliği nereden gelsin? *Önerilen varsayılan:* Aracı prosedür motoru deterministik olarak çağırsın; model yalnızca bilgi toplasın. Oyuncu kimliği hiçbir zaman modelin yazdığı değerden alınmasın; operatörün imzaladığı doğrulanmış oturum bilgisinden gelsin.

### AI-29 — Şeffaflık ve "insanla görüş" butonu
- **Ne:**
  - AI ilk mesajında kendini yapay zekâ asistanı olarak tanıtır.
  - AI konuştuğu sürece widget'ta her zaman görünen bir "Temsilciyle görüş" butonu bulunur.
  - Butona basıldığında ya da oyuncu bunu yazdığında en fazla 1 netleştirme sorusundan sonra devir yapılır.
  - Mesai dışındaysa ne olacağı oyuncuya açıkça söylenir.
- **Neden gerekli:**
  - **Kural ve güven:** Guardrail G16'nın karşılığıdır ve oyuncu güveni için gereklidir.
  - **Terk ve şikâyet:** Bottan sıkılan iGaming oyuncusu sohbeti kapatıp şikâyet sitelerine yazar. "İnsanla görüşemiyorum" şikâyeti operatörün itibarına zarar verir.
  - **AB müşterileri:** AB'deki oyunculara hizmet veren kiracılar için AB Yapay Zekâ Yasası'nın 50. maddesi, AI ile konuşulduğunun bildirilmesini 2 Ağustos 2026'dan itibaren zorunlu tutuyor. (Bu bilgi araştırma dosyasında yok, genel bilgidir; hukuki teyit önerilir.)
- **Gerekçe / kanıt:**
  - **Araştırma:** G16 kuralı ("İnsanla görüşmek istiyorum" talebi her zaman karşılanır, en fazla 1 netleştirme sorusu sorulabilir) ve Ekran A ("oyuncuya yapay zekâ olduğu açıkça söylenir").
  - **LiveChat:** Chatbot'ta "Transfer to agent" becerisi var (`livechat-kesif-raporu.md` §2.2). ChatBot.com'un Academy'sinde "Transfer to Agent" dersi var.
  - **nexa'da olanlar:**
    - Widget AI yanıtlarını işaretliyor (`apps/widget/src/widget.ts:2964-2966` `isAiMessage`; TR metni "Yanıt yapay zekâ tarafından yazıldı", `apps/widget/src/locales/tr.ts:47`).
    - Başlıkta AI persona adı gösteriliyor (`widget.ts:423-433`).
  - **nexa'da olmayanlar:**
    - "İnsanla görüş" butonu yok.
    - Oyuncu "insan istiyorum" yazınca devir yapılmıyor (`kaynaklar/nexa-ai-motoru.md`).
    - AI'ya özel bir açılış mesajı yok (eksikler [A-11]); widget'taki hoş geldin mesajı genel.
- **Yapılmazsa:** Oyuncu bot döngüsünde sıkışır, sohbeti terk eder ve şikâyet eder. G16 ihlali QA'da sürekli karşınıza çıkar. AB'deki oyunculara hizmet veren kiracılar için de yasal risk oluşur.
- **Bağımlılıklar:** AI-09 (devir tetikleyicisi), AI-11 (devirden sonra AI susar), AI-12 (hedef ekip ve mesai dışı), AI-25 (butonun kullanım oranı), WG-02 (widget dili), WG-05 (metinlerin özelleştirilmesi), WG-08 (mesai dışında e-posta isteme), GV-01 (butonun kötüye kullanımı).
- **Netleştirilecek sorular:**
  1. **AI-29-S1:** Buton her zaman mı görünsün, yoksa AI'ın ilk yanıtından sonra mı? Kiracı butonu gizleyebilsin mi? *Önerilen varsayılan:* AI konuştuğu sürece her zaman görünsün. Kiracı butonu gizleyemesin, yalnızca metnini değiştirebilsin.
  2. **AI-29-S2:** Mesai dışında butona basılınca ne olsun? *Önerilen varsayılan:* Oyuncuya "Temsilcilerimiz şu an çevrimdışı, {saat} itibarıyla dönüş yapılacak; talebiniz kaydedildi" denilsin. Sohbet kuyrukta kalsın ya da ticket'a dönüşsün; isteğe bağlı olarak e-posta istensin (WG-08).

### AI-30 — Çok dilli yanıt
- **Ne:**
  - Türkçe varsayılan dil olarak kalır. Oyuncu başka dilde yazarsa AI o dilde yanıt verir; bilgi bankası Türkçe olsa bile sadık bir çeviriyle.
  - Dil algılama kelime listesinden LLM'e taşınır.
  - Desteklenen diller genişletilir (EN, RU, AZ vb.).
  - Desteklenmeyen dilde AI susmak yerine devreder.
  - Devir kartında oyuncunun dili ve Türkçe özet görünür.
- **Neden gerekli:** Türk operatörleri Azerbaycanlı, Rusça konuşan, Almanya'daki Türk diasporası ve İngilizce konuşan oyunculara da hizmet veriyor. Bugün desteklenmeyen dilde yazan oyuncu AI'dan hiç yanıt almıyor ve bu hiçbir yerde görünmüyor.
- **Gerekçe / kanıt:**
  - **Araştırma ve piyasa:** Araştırma Ekran A "TR varsayılan, EN/AZ/RU vb." diyor. ChatBot.com'da "Multilingual AI" bir plan özelliği. Gözlem notu: raporlarda dil bazlı kırılım gerekli, çünkü iGaming çok dilli (`chatbot-uygulama.md` §7.3, §9.3).
  - **nexa'da desteklenen diller:** Yalnızca `en`, `tr`, `de`, `fr`, `es` (`packages/types/src/persona.ts:56`); RU ve AZ yok.
  - **Dil algılama:** Durak kelime sayımıyla yapılıyor (`persona.ts:472-506`). Kısa mesajlarda sonuç "bilinmiyor".
  - **Sessiz atlama:** Persona'nın dilleri dışında kalan bir mesajda AI yanıt vermiyor, sohbeti devretmiyor ve kayıt da tutmuyor (`services/ai/skill-engine.ts:273-280`, sonuç `skipped`).
  - **Yanıt dili:** Prompt'ta "Reply in this language" talimatı var (`provider/answer-prompt.ts:70-72`).
  - **Widget dilleri:** Arayüz dilleri ar, de, en, es, fr, it, pt, tr (`apps/widget/src/locales`); RU ve AZ yok (WG-02).
- **Yapılmazsa:** Yabancı dilde yazan oyuncu yanıtsız kalır ve sorun ölçülemez. Çeviri kurallarsız yapılırsa bonus şartı ya da limit yanlış çevrilip söz verilmiş gibi algılanabilir.
- **Bağımlılıklar:** AI-16 (LLM), AI-05 (dil tespiti aynı çağrıda yapılır), AI-06, AI-08 (yasaklı ifadeler her dilde denetlenmeli), AI-22 (desteklenmeyen dil vakaları kayda geçer), AI-25 (dil kırılımı), WG-02, AU-01 (dile göre ekip yönlendirme).
- **Netleştirilecek sorular:**
  1. **AI-30-S1:** Bilgi bankası Türkçeyken AI başka dilde çeviriyle yanıt verebilsin mi? Çeviri hatası riski var. *Önerilen varsayılan:* Evet. Ödeme, bonus ve KYC yanıtlarında sayılar, para birimleri ve koşullar aynen korunsun. Gerektiğinde "Resmi kurallar Türkçe metindir" notu eklensin. Kiracı bu özelliği dil bazında kapatabilsin.
  2. **AI-30-S2:** İlk pakette hangi diller olsun? *Önerilen varsayılan:* TR, EN, RU ve AZ. Mevcut DE, FR ve ES de korunsun.
  3. **AI-30-S3:** Desteklenmeyen bir dilde ne olsun? *Önerilen varsayılan:* Oyuncuya algılanan dilde (yapılamıyorsa İngilizce) "Bu dilde yardımcı olamıyorum, sizi bir temsilciye aktarıyorum" denilsin ve devredilsin. Vaka AI-22'ye kaydedilsin.

---

> Bu parça `04-gerekceler-ve-sorular.md` dosyasının 2., 3. ve 13. bölümleridir. Madde kimlikleri `03-eklenebilecekler.md` ile aynıdır.
> **Terim notu:** Bu dosyada "Thread ID" ve "Chat ID" her zaman **senin** anlamınla kullanılır: Thread ID = üyenin o günkü konuşma grubu, Chat ID = her bağlantı. nexa kodundaki `chat` / `thread` kelimeleri bunun tersini anlatır; eşleme ID-01'de.
> Kod referansları `nexa-main` köküne göredir ve 2026-10-14 tarihinde yalnızca okunarak doğrulanmıştır.

---

## 2. Kimlikler, gün içi hafıza ve aranabilir kayıtlar (ID)

### ID-01 — Kimlik sözlüğü
- **Ne:** Sistemdeki bütün numaraların (Thread ID, Chat ID, mesaj numarası, üye numarası, istek numarası, ticket numarası, AI karar numarası) ne anlama geldiğini tek bir tabloda sabitlemek. Ekranlar, loglar, dışa aktarmalar, API dokümanı ve AI aynı adı aynı anlamda kullanır.
- **Neden gerekli:** nexa'nın kodunda "chat" ve "thread" kelimeleri senin tanımının tersini anlatıyor. nexa'daki "chat" üyeyle süren uzun ilişki (senin Thread ID'n), nexa'daki "thread" ise tek bir bağlantı (senin Chat ID'n). Sözlük olmazsa bir ajan "şu chat ID'ye bak" dediğinde geliştirici başka bir kayda bakar, logda yanlış alan aranır, operatöre yanlış numara verilir.
- **Gerekçe / kanıt:**
  - nexa bugün: `Chat` "tek müşteriyle süren ilişki", `Thread` "chat içindeki tek kesintisiz konuşma" (`apps/api/prisma/schema.prisma:781-843`). Mesaj numarası bağlantının numarasını içinde taşıyor: `TJ1H8CFKRV_7` = `TJ1H8CFKRV` bağlantısının 7. olayı (`packages/types/src/ids.ts`). Ekranda yalnız nexa'nın chat numarası "Chat ID" adıyla görünüyor (`apps/web/src/features/inbox/DetailsPanel.tsx:182-183`); nexa'nın thread numarası hiçbir yerde görünmüyor.
  - LiveChat da aynı iki katmanlı modeli (chat + thread) kullanıyor. Numaralara ulaşmak o kadar zahmetli ki LiveChat Marketplace'te yalnız bunun için ücretli bir eklenti var ("Get IDs", ayda $1).
  - Önerilen eşleme (ID-02'de A seçeneği onaylanırsa):
    - **Thread ID (günlük)** = nexa `chat.id`. Üye + gün. 10 karakter, ör. `TJ1H8CFKRV`.
    - **Chat ID (bağlantı)** = nexa `thread.id`. Her bağlantıda yeni. 10 karakter.
    - **Mesaj ID** = nexa `event.id` = `<Chat ID>_<sıra no>`. Mesaj numarasının başı bağlantıyı gösterdiği için loglarda bir Chat ID aranınca o bağlantının bütün mesajları da bulunur.
    - **Üye ID** = nexa `customer.id` (uzun UUID). Teknik bir numara; ekranda kısaltılmış gösterilir, dışarıya verilmez (neden: ID-03).
    - **İstek ID (request ID)** = her sunucu isteğinin numarası; hata mesajlarında ve loglarda görünür.
    - **Ticket ID** ve **AI karar ID** (ID-08).
  - Koddaki alan adları (`chat_id`, `thread_id`) değişmez; çeviri yalnız ekran etiketlerinde, log görüntüleyicide ve dışa aktarma başlıklarında yapılır. Böylece API ve entegrasyonlar bozulmaz.
- **Yapılmazsa:** Ekip, geliştirici ve operatör aynı numaraya farklı ad verir. Şikâyet ya da denetim sırasında yanlış konuşma incelenir; loglarda "chat_id" diye aranan şey aslında senin Thread ID'n olur ve sonuç yanlış çıkar.
- **Bağımlılıklar:** ID-02 (eşleme hangi seçeneğe göre yazılacak), ID-05, ID-06, ID-08, ID-09, AI-10.
- **Netleştirilecek sorular:**
  1. Ekranda "Thread ID / Chat ID" İngilizce terimleri mi kalsın, Türkçe karşılık mı kullanılsın? Önerilen varsayılan: senin terimlerin kalsın ("Thread ID", "Chat ID"); yanlarında kısa açıklama olsun: "Üyenin bugünkü konuşma grubu" / "Bu bağlantı".
  2. Numaraların önüne ayırt edici harf (T-, C-) eklensin mi? Önerilen varsayılan: hayır. Numara her yerde aynı biçimde dursun ki Ctrl+F ile ekranda, logda ve dışa aktarmada aynı şekilde bulunsun; hangisinin ne olduğunu etiket söylesin.
  3. Geliştirici (API) dokümanında hangi adlar kullanılsın? Önerilen varsayılan: koddaki adlar (`chat_id`, `thread_id`) + her alanın yanında "panelde görünen adı" sütunu.

### ID-02 — Günlük thread (üye + gün)
- **Ne:** Üyenin o günkü ilk bağlantısı yeni bir Thread ID ve yeni bir Chat ID alır. Aynı gün tekrar gelirse Thread ID aynı kalır, Chat ID yenilenir. Ertesi gün ikisi de yenilenir. AI ve ajan, Thread ID üzerinden üyenin o günkü önceki bağlantılarını görür.
- **Neden gerekli:** Oyuncu sabah "Papara yatırımım geçmedi" yazıp çıkar, öğlen "hâlâ yok" diye döner. Bugün sistem onu tanımadığı için her şeyi baştan sorar. Günlük thread, AI'ın "Az önce Papara yatırımınızla ilgili yazmıştınız" diyebilmesinin ve ajanın üyenin bugünkü bütün temaslarını tek yerde görmesinin temelidir. "Aynı gün tekrar gelme" aynı zamanda sorunun çözülmediğinin en güçlü işaretidir.
- **Gerekçe / kanıt:**
  - **nexa bugün:** Sohbet kapandıktan sonra her geri gelişte yeni chat ve yeni thread açılıyor (`apps/api/src/routes/customer.ts:680-685`, `:813-826`; `apps/api/src/services/chat/chat-service.ts:1962-2014`). Kodda takvim günü kavramı yok. Kapanmamış sohbet günlerce aynı kalabiliyor, çünkü otomatik kapanma (`InboxSettings.chatTimeoutSeconds`) ayarlanmazsa hiç çalışmıyor. PRD ise "kapanınca aynı chat'te yeni thread ile devam" diyor; kod bunu uygulamıyor.
  - **Araştırma:** iGaming'de çözülmeyen oyuncunun kısa sürede tekrar yazması "yanlış çözüm"ün ana sinyali (`igaming-ai-arastirma.md` §5.1–5.2, 72 saat tekrar temas metriği). Günlük thread bu ölçümün de temelidir.
  - **İki seçenek ve önerim: A.**
    - **A: nexa'nın mevcut yapısını kullanmak.** nexa chat'i günlük kap olur, her bağlantı onun içinde yeni bir nexa thread'i olur. Ekranda nexa chat numarası "Thread ID", nexa thread numarası "Chat ID" diye gösterilir.
    - **B: Yeni bir "gün" kaydı eklemek.** nexa'nın chat/thread anlamları olduğu gibi kalır; üstüne üye + tarih anahtarlı üçüncü bir kayıt gelir.
  - **Neden A:**
    1. nexa'nın veri modeli tam olarak bunun için tasarlanmış (chat altında birden çok thread; PRD de böyle tarif ediyor). Yeni tablo, yeni güvenlik kuralı (RLS) ya da yeni kiracı izolasyon testi gerekmez.
    2. "Bir üyenin aynı anda tek açık konuşması" ve "bir konuşmada tek açık bağlantı" kuralları veritabanında zaten zorlanıyor (`uq_one_active_chat`, `uq_one_active_thread`). İki sekmeden aynı anda yazma gibi yarışlar bedavaya korunur.
    3. Raporlar, SLA, AI çözüm sayımı (faturalama) ve puanlar bugün zaten bağlantı (nexa thread) başına hesaplanıyor (`apps/api/src/services/reports/report-csv.ts` sorguları çoğunlukla `FROM threads`; puan kaydında `thread_id` var). A ile bu sayılar değişmez.
    4. AI'ın gün içi hafızası, aynı nexa chat'inin önceki thread'lerini okumaktan ibaret olur. Bunun için hazır fonksiyon var (`ChatService.listEvents(..., {threadId})`) ve erişim kontrolü zaten chat düzeyinde.
    5. Inbox'ta üye başına günde tek satır olur; ajan günün bütün bağlantılarını bir arada görür.
  - **A'nın yan etkileri (hepsi çözülebilir, ama bilinçli karar ister):**
    - **Terim tersliği:** ekran etiketleri değişir (ID-01). Bugün ekranda "Chat ID" yazan numara artık "Thread ID" olur.
    - **Müşteri profilindeki "Sohbet sayısı":** bugün nexa chat sayısı (`customer-service.ts:498`); A ile "gün sayısı"na döner. Etiket ya da hesap değişmeli.
    - **Ekip görünürlüğü:** Sohbeti görebilecek ekip chat düzeyinde tutuluyor ve transfer bu listeyi değiştiriyor (`chat-service.ts:1414-1415`). Sabah Finans'a, öğlen Bonus'a giden bir günde, ayar yapılmazsa sabahki ekip günün tamamını görmeyi kaybeder ya da öğlenki ekip sabahki konuşmayı da görür. Kural konmalı (aşağıda soru 7).
    - **Dış entegrasyonlar:** "sohbet başladı" webhook'u (`chat_started`) yalnız yeni nexa chat açılınca gidiyor. Aynı gün dönüşte gitmez; bunun için yeni bir "bağlantı başladı" olayı eklenmeli.
    - **Ajanın "Yeniden aç" düğmesi:** dünkü bir sohbeti bugün yeniden açarsa yeni bağlantı dünün Thread ID'sine eklenir. Kural konmalı (soru 6).
    - **Bölümlü mesaj tablosu ve güvenlik kuralları:** A için değişiklik gerekmez (mesajlar zaten hem chat hem thread numarası taşıyor; RLS chat ve mesaj tablolarında mevcut).
  - **B neden ikinci:** sistemde fiilen üç numara olur (gün, nexa chat, nexa thread) ve nexa chat ile thread neredeyse bire bir kalır, yani bir katman boşa çalışır. Yeni tablo, güvenlik kuralı, "günü bul ya da oluştur" yarış kontrolü ve kiracılar arası sızıntı testleri gerekir. AI hafızası birden çok sohbet kaydını dolaşır; Inbox'ta aynı üyenin aynı günkü bağlantıları ayrı satırlar olarak kalır. Avantajı: API ve webhook kullanan dış sistemler hiç etkilenmez. Pilotta dış entegrasyon olmadığı için bu avantaj bugün küçük.
  - **Gün sınırı:** "Aynı gün" kiracının saat dilimine göre hesaplanır, varsayılan Europe/Istanbul 00:00 (ayrıntı ID-04).
- **Yapılmazsa:** AI-02 (gün içi hafıza) kurulamaz. Oyuncu aynı gün üçüncü kez yazdığında yine baştan anlatır; ajan üç ayrı konuşma görür ve birbirine bağlayamaz. Loglarda "bu üyenin bugünkü bütün temasları" tek numarayla bulunamaz.
- **Bağımlılıklar:** ID-01, ID-03 (kim "aynı üye" sayılır), ID-04 (gün tanımı), AI-01 ve AI-02 (hafızayı kullananlar), ID-05, ID-06, ID-08, IN-02, AR-01.
- **Netleştirilecek sorular:**
  1. A seçeneğini onaylıyor musun? Önerilen varsayılan: A.
  2. "Yeni bağlantı" tam olarak ne zaman sayılır? Önerilen varsayılan: önceki konuşma kapandıktan sonra (üye "Sohbeti bitir" dedi, ajan arşivledi ya da boşta kalma süresi doldu) gelen ilk mesaj. Sayfa yenileme, ikinci sekme ya da internet kopması yeni Chat ID üretmez.
  3. Boşta kalma süresi ne olsun? Bugün ayarlanmazsa konuşma hiç kapanmıyor, bu durumda aynı gün dönüşler hep aynı Chat ID'de kalır. Önerilen varsayılan: widget konuşmaları 30 dakika sessiz kalınca otomatik kapansın; kiracı değiştirebilsin.
  4. Gece yarısını geçen konuşma ne olsun? Önerilen varsayılan: süren konuşma bölünmez, başladığı güne ait sayılır. Gece yarısından sonra konuşma kapanırsa (ya da 30 dakika sessiz kalırsa) sonraki mesaj yeni günün Thread ID'sini açar.
  5. Aynı gün dönen üye hangi ajana gitsin? Önerilen varsayılan: sabahki ajan çevrimiçi ve kapasitesi varsa ona; değilse normal yönlendirme.
  6. Ajan önceki güne ait bir konuşmayı "Yeniden aç"arsa ne olsun? Önerilen varsayılan: eski güne eklenmesin; bugünün Thread ID'si altında yeni bir Chat ID açılsın ve ekranda "dünkü konuşmadan devam" bağlantısı görünsün.
  7. Aynı gün farklı ekiplere giden bağlantılarda ekipler birbirinin konuşmasını görsün mü? Önerilen varsayılan: evet, o günün bütün bağlantılarını görsünler (devamlılık için). Sorumlu Oyun ve KYC/Risk gibi hassas ekipler istenirse izin matrisinde (RL-02) hariç tutulabilsin.
  8. Bir üye aynı gün iki farklı markanın sitesinden yazarsa? Önerilen varsayılan: marka başına ayrı Thread ID. (Tarayıcılar farklı sitelerdeki widget hafızasını zaten ayırdığı için çoğu durumda kendiliğinden böyle olur.)

### ID-03 — Üye tanıma
- **Ne:** İki bağlantının ne zaman "aynı üye" sayılacağına dair güvenli kural. Varsayılan: aynı tarayıcı. Farklı cihazda tanıma yalnız kiracının imzaladığı kimlik bilgisiyle ya da ajan onayıyla. Pre-chat formundaki kullanıcı adı ve e-posta yalnız ipucu olarak kullanılır. Repodaki commit'lenmemiş `customer_username` işi de bu maddede tamamlanır.
- **Neden gerekli:** Oyuncu sabah telefondan, öğlen bilgisayardan yazdığında tanınmak ister. Ama kullanıcı adını herkes yazabilir. Sistem "aynı kullanıcı adı = aynı kişi" derse, başka birinin kullanıcı adını yazan kişi o oyuncunun bugünkü konuşmasını (tutar, ödeme yöntemi, belge, hesap durumu) AI'dan öğrenebilir. iGaming'de hesap ele geçirme ve sosyal mühendislik yaygın; bu doğrudan bir veri sızıntısı ve KVKK sorunu olur.
- **Gerekçe / kanıt:**
  - **nexa bugün:** Üye, tarayıcıda saklanan bir numarayla tanınıyor (`localStorage['siyahtus.customer_id']`, `apps/widget/src/api.ts:188-235`). Başka cihaz, gizli pencere ya da temizlenmiş tarayıcı yeni müşteri demek. Kullanıcı adı alanı commit'lenmemiş bir değişiklikle geliyor; migration notu açıkça "asla arama anahtarı değil" diyor (`apps/api/prisma/migrations/20261014090000_customer_username/migration.sql`).
  - **Bugünkü imzalı token kimlik kanıtı değil:** Widget'ın aldığı HMAC imzalı token nexa'nın kendi anahtarıyla, her anonim ziyaretçi için basılıyor (`apps/api/src/services/auth/customer-token.ts`). Kiracının "bu kişi benim sitemde giriş yapmış X üyesi" dediği bir imza mekanizması yok (kodda aranan `user_hash` / kimlik doğrulama benzeri bir şey bulunmadı).
  - **Ek bulgu:** Tarayıcıda saklanan üye numarası fiilen bir anahtar gibi çalışıyor. Token alma ucu herkese açık; workspace numarası widget kodunda zaten görünür ve kodun kendi notuna göre çağıran "istediği siteyi beyan edebilir" (`apps/api/src/routes/auth.ts:191-203`). Yani bir üyenin numarasını öğrenen biri onun adına token alıp açık konuşmasını okuyabilir. Günlük hafıza eklenince bu numaranın değeri artar; numara gizli tutulmalı (GV-05).
  - **Tarayıcı kısıtı:** Widget başka bir alan adından iframe ile çalıştığı için tarayıcılar onun hafızasını siteye göre ayırıyor ve bazıları (özellikle iOS Safari) kısıtlayabiliyor. "Aynı tarayıcı" tanıması bile her cihazda garanti değil; test edilmeli.
  - **Piyasa:** Intercom "Identity Verification" ile kiracının sunucusunda üretilen HMAC imzası (`user_hash`) olmadan kullanıcıyı eşleştirmiyor. LiveChat giriş yapmış müşteriler için kiracının kendi kimlik sağlayıcısını kullanabiliyor. ChatBot.com kullanıcıları entegrasyondan gelen "User ID" ile arıyor (`kaynaklar/chatbot/chatbot-uygulama.md` §Users). Ortak ders: sohbet penceresine yazılan bilgiye güvenilmez, kiracı imzalar.
  - **Araştırma:** G11 (hassas bilgi istenmez), G13 (hesap değişikliği ve ele geçirme şüphesi insana), G8 (AI doğrulanmış bilgi varmış gibi konuşamaz).
- **Yapılmazsa:** Ya farklı cihazdan gelen oyuncu hiç tanınmaz (senin isteğin karşılanmaz) ya da kullanıcı adıyla saf eşleştirme yapılır ve bir oyuncunun konuşması başkasına açılır.
- **Bağımlılıklar:** ID-02, ID-01, AI-02, AI-08 (çıktı kuralları), AI-26 (maskeleme), IN-02 (oyuncu kartında "olası eşleşme"), WG-01 (pre-chat alanları), GV-05, KN-06 (F2'de operatör platformundan gelen doğrulanmış üye kimliği).
- **Netleştirilecek sorular:**
  1. Farklı cihazdan gelen üye hangi yolla tanınsın? Önerilen varsayılan: yalnız iki yolla. (a) Kiracının sitesi, giriş yapmış üye için imzalı kimlik gönderirse otomatik. (b) Ajan "bu aynı kişi" diye onaylarsa elle; bu durumda geçmiş yalnız ajan ekranında birleşik görünür, AI hafızasına girmez. Kullanıcı adı ya da e-posta tek başına asla eşleştirme yapmaz; ajan ekranında "olası eşleşme (doğrulanmamış)" olarak görünür.
  2. AI önceki bağlantıları üyeye ne kadar açık anlatsın? Önerilen varsayılan: aynı tarayıcıda yalnız konu düzeyinde ("Bugün bir yatırım konusunda yazmıştınız, aynı konu mu?"). Tutar, IBAN, işlem numarası, belge gibi ayrıntıları kendiliğinden tekrar etmez; ayrıntıyı ancak üye kendisi söylerse teyit eder. İmzalı kimlikle tanınan üyede de aynı kural geçerli.
  3. Operatör siteleri giriş yapmış üye bilgisini widget'a imzalı olarak verebilir mi (operatörün geliştiricisi gerekir)? Önerilen varsayılan: pilotta isteğe bağlı bir özellik olarak sunulsun; F2 platform entegrasyonlarıyla birlikte standart hale gelsin.
  4. Ajan onaylı eşleştirmeyi kim yapabilsin? Önerilen varsayılan: Ekip Lideri ve üstü; her eşleştirme denetim kaydına yazılsın ve geri alınabilsin.

### ID-04 — Gün sınırı ve saat dilimi
- **Ne:** "Aynı gün" tanımının kiracının saat dilimine göre yapılması. Varsayılan Europe/Istanbul, gün başlangıcı 00:00. Kiracı ayarlardan değiştirebilir.
- **Neden gerekli:** Sunucu UTC ile çalışıyor. İstanbul'da gün UTC'den 3 saat önce başlıyor; ayar yapılmazsa gece 00:00–03:00 arasında yazan oyuncu yanlış güne bağlanır. iGaming'de en yoğun saatlerden biri tam bu aralık (gece maçları, casino).
- **Gerekçe / kanıt:**
  - `Organization.timezone` alanı var ama varsayılanı `UTC` ve yalnız transkript e-postasında tarih biçimlendirmek için kullanılıyor (`schema.prisma:55`, `chat-service.ts:1209-1219`).
  - AI günlük kotası UTC gününe göre sayılıyor (`apps/api/src/services/ai/ai-daily-budget.ts`, `utcDayKey`); raporların gün kırılımları da UTC (`report-csv.ts`, "AT TIME ZONE 'UTC'"). Gün kavramı sistemde üç farklı yerde üç farklı şekilde tanımlanmış olacak; en azından ekranda hangisinin hangi saate göre olduğu yazılmalı.
  - Türkiye 2016'dan beri yaz saati uygulamıyor (sabit UTC+3); yine de başka ülkelerdeki kiracılar için gerçek saat dilimi adı (IANA, ör. `Europe/Istanbul`) saklanmalı.
- **Yapılmazsa:** Gece yarısından sonra dönen oyuncu "dünkü" Thread ID'ye bağlanır ya da tersi olur. Ekip "bugünkü konuşmalar" dediğinde raporla, AI hafızasıyla ve kotayla farklı sayılar görür.
- **Bağımlılıklar:** ID-02, RP-01…RP-05 (raporların gün tanımı), GV-01 (AI kotasının sıfırlanma saati).
- **Netleştirilecek sorular:**
  1. Gün 00:00'da mı başlasın, yoksa vardiyaya göre (ör. 06:00) mı? Önerilen varsayılan: 00:00; ayarlardan 0–23 arası bir saat seçilebilsin.
  2. Ayar hangi düzeyde olsun? Önerilen varsayılan: workspace düzeyinde tek ayar (boşta kalma süresiyle aynı ekranda); yeni workspace'lerde Europe/Istanbul.
  3. AI günlük kotası da bu saatte mi sıfırlansın? Önerilen varsayılan: hayır; platform kotası UTC'de kalsın (bütün kiracılar için tek sayaç), ama panelde yerel saatle gösterilsin ("03:00'te yenilenir").

### ID-05 — ID'lerin arayüzde görünmesi ve kopyalanması
- **Ne:** Thread ID ve Chat ID'nin Inbox başlığında, detay panelinde, arşivde, müşteri profilinde, devir kartında, ticket'ta, AI çalışma kaydında, denetim kaydında ve log ekranında görünmesi ve tek tıkla kopyalanması.
- **Neden gerekli:** Ekip içinde "C2 numaralı chat'e bak" demek, operatörle yazışmak, şikâyet ve itiraz süreçlerinde kanıt göstermek numarayla olur. Numara görünmezse ekip ekran görüntüsü ve oyuncu adıyla konuşur; benzer isimli iki oyuncu karışır.
- **Gerekçe / kanıt:**
  - nexa bugün Inbox başlığında nexa chat numarasını yalnız geniş ekranda düz metin olarak gösteriyor (`apps/web/src/features/inbox/ThreadHeader.tsx:53-55`); oradaki kopyala düğmesi numarayı değil bağlantı adresini kopyalıyor (`ThreadHeader.tsx:128-150`). Detay panelinde numara seçilebilir metin (`DetailsPanel.tsx:182-183`). Bağlantı numarası (nexa thread) hiçbir ekranda yok; Inbox her zaman yalnız en yeni bağlantıyı yüklüyor (`apps/web/src/features/inbox/useInbox.ts:97-100`).
  - LiveChat'te numaralara ulaşmak için ücretli eklenti satılıyor (ID-01).
  - CGA şikâyet yönergesi AI kayıtlarının izlenmesini ve tutarlılığın doğrulanmasını bekliyor (`igaming-ai-arastirma.md` §4.1); izleme numarasız yapılamaz.
- **Yapılmazsa:** Ekip ve operatör arasında yanlış konuşma üzerinde işlem yapılır; şikâyetlerde hangi bağlantının konuşulduğu kanıtlanamaz.
- **Bağımlılıklar:** ID-01, ID-02, ID-09, AI-10 (devir kartı), AR-01, IN-02.
- **Netleştirilecek sorular:**
  1. Oyuncuya (widget'ta) bir numara gösterilsin mi? Önerilen varsayılan: evet, yalnız Chat ID, sohbet menüsünde "Destek numaranız" olarak ve kopyalanabilir. Oyuncu operatöre şikâyet ederken bu numarayı verir. (Bu numara oyuncuya zaten teknik olarak iletiliyor; göstermek yeni bir risk yaratmaz.)
  2. Mobil uygulamada da gösterilsin mi? Önerilen varsayılan: evet, salt okunur ve kopyalanabilir.

### ID-06 — ID ile arama
- **Ne:** Komut paletinde (Ctrl+K), global aramada ve arşivde Thread ID, Chat ID, mesaj ID, üye ID, kullanıcı adı ve e-posta yazınca sonucun sunucudan doğrudan gelmesi.
- **Neden gerekli:** "Şu numaraya bak" dendiğinde konuşma iki saniyede açılmalı. Bugün arama yalnız son 50 sohbet içinde çalışıyor; dünkü bir konuşma numarasıyla bile bulunamıyor.
- **Gerekçe / kanıt:**
  - Komut paleti sohbetleri tarayıcıda, en yeni 50 kayıt içinde arıyor; kodun kendi notu da bunun bir sınır olduğunu söylüyor (`apps/web/src/components/CommandPalette.tsx:206-215`). Bağlantı numarasıyla hiç aranamıyor.
  - Sohbet listesi API'sinde arama parametresi yok (`packages/contract/openapi/paths/chats.yaml`, `listChats`). Ticket ve müşteri aramaları sunucuda var (`ticket-service.ts:945`, `customer-service.ts:317-319`); kullanıcı adı müşteri aramasına commit'lenmemiş değişiklikle eklenmiş.
  - LiveChat Ctrl+K'da "Search in archives" modu var; ChatBot.com kullanıcı listesinde "e-posta veya ID ile ara" kutusu ve "User ID" filtresi var.
  - CGA: sorumlu oyun şikâyetlerinde 5 iş günü hedefi; geçmiş konuşmayı hızla bulmak süreyi doğrudan etkiler.
- **Yapılmazsa:** Eski konuşmalar fiilen kaybolur; şikâyet ve QA incelemesi ajan hafızasına kalır.
- **Bağımlılıklar:** ID-01, ID-02, ID-05, ID-07 (mesaj içinde arama), AR-01, AR-02, IN-11, RL-02 (kim neyi bulabilir), GV-05 (aranan metin adres çubuğuna yazılmaz).
- **Netleştirilecek sorular:**
  1. Ekip Üyesi, ekibinin göremediği bir konuşmayı numarasıyla bulabilsin mi? Önerilen varsayılan: hayır; görme yetkisi olmayan konuşma "bulunamadı" olarak döner (nexa'nın bugünkü "yetkisizse yok say" kuralı). Ekip Lideri kendi ekiplerini, Yönetici ve Kurucu hepsini bulur.
  2. Kullanıcı adı ve e-posta ile arama kimlere açık olsun? Önerilen varsayılan: bütün ajanlara (iş gereği), ama sonuç listesinde e-posta, görme yetkisi olmayan role maskeli gösterilsin.

### ID-07 — Mesaj içeriğinde serbest metin arama
- **Ne:** Arşivde ve global aramada mesaj metninde (oyuncunun ve ajanın yazdıkları, yetkiye göre iç notlar dahil) tarih aralığıyla arama.
- **Neden gerekli:** "Geçen hafta 'Papara 5000' yazan oyuncu", bir işlem numarası (TXID), IBAN'ın son haneleri, "şikâyet edeceğim" diyenler... QA, şikâyet ve uyum incelemeleri, AI'ın cevaplayamadığı soruların bulunması hep buna dayanır.
- **Gerekçe / kanıt:**
  - Mesaj metninde arama hiç yok (`kaynaklar/eksikler.md` E2 ve C11, P0). LiveChat arşivinde metin araması var (adreste `query=`).
  - Mesaj tablosu aylık bölümlere ayrılmış ve satır düzeyi güvenlik (RLS) altında. Metin araması için gereken Postgres eklentisi (`pg_trgm`) kurulu değil (`infra/db/init/00-extensions.sql`).
  - Teknik tuzak: Repo, RLS altındaki bazı karşılaştırmaların indeksi kullanamadığını transkript sayfalamasında ölçüp belgelemiş (migration `20260911170000_events_sequence_column`, `apps/api/test/integration/transcript-page-plan.test.ts`). "İçinde geçen" türü metin aramasında aynı sorunun çıkması muhtemel; tasarım buna göre yapılmalı (ayrıntı 05).
- **Yapılmazsa:** QA ve uyum incelemesi elle ve tahminle yapılır; AI-22 (bilgi boşluğu raporu) ve AI-24 (QA kuyruğu) zayıf kalır.
- **Bağımlılıklar:** ID-06, AR-01, AR-02, RL-02 (iç notları kim görür), AI-26 (maskelenen veri aranamaz, bu bilinçli), GV-05.
- **Netleştirilecek sorular:**
  1. Arama varsayılan olarak ne kadar geriye baksın? Önerilen varsayılan: son 90 gün; tarih seçilerek saklama süresinin tamamı aranabilsin.
  2. İç notlar aramaya dahil mi? Önerilen varsayılan: evet, iç notu görme yetkisi olanlar için.
  3. Türkçe kök eşleşmesi gerekli mi ("yatırım" arayınca "yatırdım" da çıksın)? Önerilen varsayılan: ilk sürümde "metnin içinde geçen" arama (Ctrl+F mantığı); kök eşleşmesi sonraki sürümde.

### ID-08 — Yapılandırılmış ve aranabilir loglar
- **Ne:** Her log satırında aynı anahtarlar: kiracı, istek ID, üye ID, Thread ID, Chat ID, işlemi yapan. Ayrıca AI'ın her kararının (hangi prosedür ve sürümü, hangi bilgi kaynakları, hangi kural tetiklendi, neden devretti, kaç token, ne kadar sürdü) veritabanında kalıcı bir "AI karar kaydı" olarak tutulması.
- **Neden gerekli:** "AI bu oyuncuya neden böyle dedi?" sorusuna dakikalar içinde, numarayla cevap verebilmek. Düzenleyiciler de bunu bekliyor: CGA AI kayıtlarının izlenmesini, UKGC değerlendirmenin kanıtını istiyor.
- **Gerekçe / kanıt:**
  - Loglar yalnız sunucunun ekran çıktısına yazılıyor. `chat_id` yalnız AI ve bot loglarında var; anahtar adı bazı yerlerde `chatId`, bazı yerlerde `chat_id` (`apps/api/src/routes/customer.ts:484,512` ve `apps/api/src/services/ai/ai-responder.ts:169,184`). Hiçbir log satırında `thread_id` yok; kiracı numarası log satırlarına otomatik eklenmiyor (`apps/api/src/server.ts` logger ayarı).
  - AI çalışma kaydı (`SkillRun`) yalnız nexa chat numarasını tutuyor, bağlantı numarasını tutmuyor (`schema.prisma:1694-1711`).
  - Pilot sunucuda log dosyaları 10 MB × 5 dosyayla sınırlı döndürülüyor (`docker-compose.pilot.yml`). Yoğun bir günde ekran çıktısı loglarının birkaç gün içinde silinmesi muhtemel. "Geçmişte arama" için kalıcı kayıt veritabanında olmalı.
  - Sunucu, isteğin numarasını istemciden gelen başlıktan doğrulamadan alıyor (`server.ts:255`); dışarıdan sahte numara yazılabilir.
  - Araştırma: QA sürecinin 5. adımı "uyum kaydı" (`igaming-ai-arastirma.md` §5.3).
- **Yapılmazsa:** Bir şikâyette AI'ın ne yaptığı yeniden kurulamaz. Loglar birkaç günde kaybolur; düzenleyici ya da operatör sorduğunda kanıt sunulamaz.
- **Bağımlılıklar:** ID-01, ID-02, ID-09, AI-03…AI-12 (kararları üreten parçalar), AI-21, AI-25, GV-02 (kuyruktaki işin numarası).
- **Netleştirilecek sorular:**
  1. AI karar kaydı ne kadar saklansın? Önerilen varsayılan: konuşmayla aynı süre (bugünkü varsayılan 365 gün; kiracı kısaltabilir).
  2. AI'a giden metnin (prompt) tamamı saklansın mı? Önerilen varsayılan: hayır. Kullanılan kaynakların numaraları, prosedür sürümü ve kısa gerekçe saklansın; tam metin yalnız "hata ayıklama modu" açıkken ve 7 gün.
  3. Sunucu logları pilotta harici bir log sistemine gönderilsin mi? Önerilen varsayılan: pilotta hayır (kalıcı kayıt veritabanında); canlıya geçerken evet.

### ID-09 — Log / zaman çizelgesi görüntüleyici
- **Ne:** Bir Chat ID ya da Thread ID için bütün olayları (mesajlar, iç notlar, AI kararları, devir, kural, etiket, atama, kapanış, puan) tek bir zaman çizelgesinde gösteren, filtrelenebilen, Ctrl+F ile aranabilen ve dışa aktarılabilen ekran.
- **Neden gerekli:** Ekip Lideri ya da Yönetici bir şikâyette veya QA incelemesinde "ne oldu" sorusunu tek ekranda görür; üç ayrı yere bakmak zorunda kalmaz.
- **Gerekçe / kanıt:**
  - Bilgi bugün dağınık: transkript Inbox'ta, AI çalışma kaydı Playbook'ta, denetim kaydı Ayarlar'da (metin araması bilerek kapsam dışı bırakılmış, `apps/web/src/features/audit/AuditLogPage.tsx:14`), teknik loglar sunucuda.
  - Inbox listeleri performans için yalnız ekranda görünen satırları çiziyor (`components/VirtualList.tsx`). Tarayıcının Ctrl+F'i görünmeyen satırları bulamaz; zaman çizelgesi bu yüzden farklı çizilmeli.
  - Araştırma: Ekran G (Analiz ve Koçluk) ve Ekran H (Değişiklik Geçmişi) (`igaming-ai-arastirma.md` §2).
- **Yapılmazsa:** QA ve uyum incelemesi saatler sürer; Ekip Lideri bilgiyi parça parça toplar, bir parçayı kaçırınca yanlış karar verir.
- **Bağımlılıklar:** ID-05, ID-06, ID-08, RL-02 (kim görür, kim dışa aktarır), AR-04 (transkript dışa aktarma), AI-24 (QA).
- **Netleştirilecek sorular:**
  1. Kim görebilsin? Önerilen varsayılan: Ekip Üyesi kendi konuşmalarının zaman çizelgesini (AI kararları dahil) görsün; Ekip Lideri kendi ekiplerininkini; Yönetici ve Kurucu hepsini.
  2. Dışa aktarmayı kim yapabilsin? Önerilen varsayılan: Yönetici ve Kurucu; her dışa aktarma denetim kaydına yazılsın.
  3. Dışa aktarmada oyuncunun kişisel verisi maskelensin mi? Önerilen varsayılan: varsayılan maskeli; "maskesiz" seçeneği yalnız Kurucu'da.

---

## 3. Roller ve yetkiler (RL)

### RL-01 — Rol seti
- **Ne:** Dört rol: Kurucu, Yönetici, Ekip Lideri, Ekip Üyesi. Önerilen eşleme: Kurucu = nexa `owner`, Yönetici = nexa `admin`, Ekip Lideri = yeni rol (`team_lead`), Ekip Üyesi = nexa `agent`. nexa'daki `viceowner` yeni atamalarda sunulmaz; mevcut sahipleri Yönetici'ye taşınır.
- **Neden gerekli:** Şirketlerin gerçek yapısı bu: Kurucu, birden çok Yönetici, vardiya ve ekipleri yöneten Ekip Liderleri, sohbetleri karşılayan Ekip Üyeleri. Bugün Ekip Lideri katmanı yok; lider ya her şeye yetkili Yönetici yapılıyor ya da hiçbir şeyi izleyemeyen sıradan ajan kalıyor.
- **Gerekçe / kanıt:**
  - nexa'da dört rol var: owner (3) > viceowner (2) > admin (1) > agent (0) (`packages/types/src/role-scopes.ts:20-25`). viceowner ile admin aynı yetki listesini alıyor; aralarındaki tek fark sıralama (`defaultScopesForRole`, aynı dosya `:148-152`). Yani nexa'da fiilen üç yetki düzeyi var.
  - Yönetici yetkileri çok geniş: faturalama, güvenlik ayarları, müşteri verisini kalıcı silme, bütün sohbetler (`ADMIN_SCOPES`, `role-scopes.ts:83-138`). Ekip Lideri'ni Yönetici yapmak bunların hepsini vermek demek.
  - Rol listesi veritabanında sabit kontrollerle korunuyor (`agent_memberships_role_check`; davetlerde yalnız `admin`/`agent`, `invitations_role_check`). Workspace başına tek Kurucu kuralı veritabanında (`uq_license_single_owner`).
  - ChatBot.com'da yalnız üç sabit rol var (Owner, Administration, Editor); ekip bazlı görünürlük ve onay katmanı yok. Kendi keşif notumuz bunun bizim dört rolümüz için yetersiz olduğunu söylüyor (`kaynaklar/chatbot/chatbot-uygulama.md` §9.2–9.3). LiveChat nexa'nın kopyaladığı Owner / Vice owner / Admin / Agent yapısını kullanıyor.
  - Araştırmadaki rol eşlemesi: Kurucu/Yönetici düzenler ve yayınlar; Ekip Lideri taslak hazırlar, test eder, onay ister; Ekip Üyesi düzeltme önerir (`igaming-ai-arastirma.md` §2).
- **Yapılmazsa:** Liderler Yönetici yapılır ve gereğinden fazla yetki alır (fatura, silme, güvenlik) ya da işi tek bir Yönetici yapar ve darboğaz oluşur. AI'da "dört göz" onayı (AI-20) ve QA (AI-24) kurulamaz.
- **Bağımlılıklar:** RL-02, RL-03, RL-04, RL-05, AI-20, AI-24, RP-01 (ekibe göre rapor).
- **Netleştirilecek sorular:**
  1. viceowner rolü ne olsun? Önerilen varsayılan: yeni atamalarda sunulmasın, mevcut sahipleri Yönetici'ye taşınsın (yetkileri zaten aynı). Kurucu yokken vekâlet gerekiyorsa bu RL-05 (sahiplik devri) ile çözülsün.
  2. Bir kişi birden fazla ekibin lideri olabilir mi? Önerilen varsayılan: evet.
  3. Ekip Lideri sohbet karşılar mı, koltuk sayılır mı? Önerilen varsayılan: evet, sohbet kabul edebilir ve koltuk sayılır.

### RL-02 — Yapılandırılabilir izin matrisi
- **Ne:** Rol × yetenek tablosu ("Ekip Üyesi oyuncunun e-postasını görsün mü", "Ekip Lideri bütün ekiplerin raporunu görsün mü" gibi). Platform makul varsayılanlarla gelir; kiracı (Kurucu) değiştirebilir. Bazı hücreler kilitlidir; ör. sahiplik devri, SSO, faturalama yalnız Kurucu'dadır.
- **Neden gerekli:** "Kim neyi görecek" kararını sonraya bıraktın. Her operatörün ekip yapısı da farklı. Kararın her değişikliği bir yazılım güncellemesi gerektirmemeli.
- **Gerekçe / kanıt:**
  - nexa'nın ince yetki altyapısı zaten var: 70 tanımlı yetki ("scope", `packages/types/src/scopes.ts`). Hangi rolün hangi yetkileri aldığı ise kodda sabit (`defaultScopesForRole`). Matris bu sabit listeyi kiracı ayarına çevirir; yeni bir yetki sistemi kurmaya gerek yok.
  - Panel menüleri ve ayar bölümleri zaten yetkiye göre gizleniyor (`apps/web/src/components/navigation.ts:57-64`, `apps/web/src/features/settings/settings-sections.ts`). Matris yetki listesini değiştirdiğinde ekranlar kendiliğinden uyum sağlar.
  - Rol düşürmenin anında etkili olması için bir koruma zaten var (`scopesWithinRole`, `role-scopes.ts:193-196`); matris bu korumayı bozmayacak şekilde kurulmalı.
  - ChatBot.com'da özel rol ya da izin ayarı yok. Zendesk ve Intercom üst planlarda özel rol/izin sunuyor (genel bilgi).
- **Yapılmazsa:** Her yetki kararı geliştirme işine dönüşür. Yanlış varsayılan (ör. herkesin bütün sohbetleri görmesi) fark edilene kadar canlıda kalır; operatöre özel ihtiyaçlar karşılanamaz.
- **Bağımlılıklar:** RL-01, RL-03, ID-06, ID-07, ID-09 (görünürlük), AI-20, AI-24, GV-06 (yetki ekranı mutlaka "Kaydet + onay" kalıbıyla çalışmalı), RL-05.
- **Netleştirilecek sorular:**
  1. Ekip Üyesi başka ekiplerin sohbetlerini ve arşivini görsün mü? Önerilen varsayılan: hayır; kendi ekiplerinin sohbetleri ve kendisine atananlar.
  2. Ekip Üyesi oyuncunun e-postasını ve kullanıcı adını görsün mü? Önerilen varsayılan: evet (iş gereği), ama dışa aktaramasın.
  3. Ekip Lideri raporlarda neyi görsün? Önerilen varsayılan: yalnız kendi ekiplerini.
  4. Yönetici faturalamayı değiştirebilsin mi? Önerilen varsayılan: görsün, değiştiremesin (Kurucu'da kalsın). Bugün nexa'da Yönetici değiştirebiliyor.
  5. İzin matrisini kim değiştirebilsin? Önerilen varsayılan: yalnız Kurucu. Her değişiklik denetim kaydına yazılsın ve bütün Yöneticilere bildirilsin.
  6. Kiracı yeni rol (ör. "QA Uzmanı") tanımlayabilsin mi? Önerilen varsayılan: ilk sürümde hayır (dört sabit rol, düzenlenebilir matris); ihtiyaç doğarsa sonra.

### RL-03 — Ekip Lideri yetenekleri
- **Ne:** Ekip Lideri kendi ekip(ler)inin sohbetlerini canlı izler, devralır, başka ajana atar; ekip arşivini, zaman çizelgesini ve ekip raporunu görür; QA puanlamasını onaylar; AI için taslak hazırlayıp onaya gönderir; ekip üyelerinin "AI yanlış cevapladı" işaretlerini onaylar.
- **Neden gerekli:** iGaming vardiyalarında ilk eskalasyon noktası Ekip Lideri'dir. Zor oyuncuyu devralmak, yeni ajanı izlemek, AI'ın hatalarını toplamak onun işi.
- **Gerekçe / kanıt:**
  - Bugün sohbeti zorla devralmak bütün sohbetlere yetki ister (`POST /chats/{id}/takeover`, `chats--all:rw`); "yalnız kendi ekibimde devral" seçeneği yok. İzleme (supervise) var.
  - Ekip bazlı görünürlüğün altyapısı var: sohbetin hangi ekiplere açık olduğu ve ajanın hangi ekiplerde olduğu her istekte kontrol ediliyor (`apps/api/src/services/chat/access.ts`). Ama "bu ekibin lideri kim" bilgisi yok.
  - Raporlarda ekip ve ajan filtresi yok (`kaynaklar/eksikler.md` T10, T32).
  - ChatBot.com keşfinden çıkan rol tablosu Ekip Lideri için "taslak önerir, kendi ekibinin kuyruğunu inceler, ekip filtresiyle rapor görür" diyor (`chatbot-uygulama.md` §9.2); araştırma QA'da "LLM ön puanlar, Ekip Lideri onaylar" öneriyor (`igaming-ai-arastirma.md` §5.3).
- **Yapılmazsa:** Liderler ya Yönetici yapılır (aşırı yetki) ya da her devralma ve onay Yönetici'ye kalır; gece vardiyasında karar verecek kimse olmaz.
- **Bağımlılıklar:** RL-01, RL-02, AI-20, AI-23, AI-24, RP-01, ID-09, IN-04 (takıma transfer).
- **Netleştirilecek sorular:**
  1. Ekip Lideri kendi ekibine üye ekleyip çıkarabilsin mi? Önerilen varsayılan: hayır; ekip üyeliğini Yönetici yönetsin.
  2. Ekip Lideri AI'daki değişikliği kendisi yayınlayabilsin mi? Önerilen varsayılan: hayır; "dört göz": Ekip Lideri hazırlar, Yönetici yayınlar (AI-20).
  3. Ekip Lideri başka ekibin sohbetini devralabilsin mi (ör. gece tek lider varken)? Önerilen varsayılan: hayır; izin matrisinde (RL-02) açılabilsin.

### RL-04 — Davette varsayılan rolün en düşük rol olması
- **Ne:** Ekip arkadaşı davet ederken rol kutusu varsayılan olarak "Ekip Üyesi" gelsin; daha yüksek rol bilinçli seçilsin. Sunucu da rol belirtilmemiş davette en düşük rolü kullansın.
- **Neden gerekli:** Hızlı davette kimse rol kutusuna bakmaz. Varsayılan Yönetici olursa yeni gelen herkes faturaya, güvenlik ayarlarına ve oyuncu verisini silmeye yetkili olur.
- **Gerekçe / kanıt:**
  - Davet ekranında varsayılan rol Yönetici: `useState<'admin' | 'agent'>('admin')` (`apps/web/src/features/team/InviteTeammates.tsx:110`). Sunucuda da rol yazılmamış davet Yönetici sayılıyor: `role: z.enum(['admin', 'agent']).default('admin')` (`apps/api/src/routes/account-lifecycle.ts:89-92`).
  - İlk kurulum sihirbazı ise davetleri Ekip Üyesi olarak gönderiyor (`apps/web/src/features/onboarding/OnboardingWizard.tsx:484`). Aynı ürün iki yerde iki farklı varsayılan kullanıyor.
  - LiveChat'te de aynı hata var ve keşifte "ders" olarak işaretlendi (`kaynaklar/eksikler.md`, "LiveChat hatalarından dersler" 3). ChatBot.com'da da varsayılan "Administration".
- **Yapılmazsa:** Yetkisi gereğinden yüksek hesaplar birikir; bir hesap ele geçirilirse zarar çok büyük olur.
- **Bağımlılıklar:** RL-01, GV-03.
- **Netleştirilecek sorular:**
  1. Davette Ekip Lideri seçilince hangi ekibin lideri olacağı da zorunlu seçilsin mi? Önerilen varsayılan: evet; Ekip Üyesi için ekip seçimi isteğe bağlı.

### RL-05 — Sahiplik (Kurucu) devri
- **Ne:** Kurucu, workspace sahipliğini başka bir üyeye güvenli şekilde devreder: devralacak kişi onaylar, eski Kurucu Yönetici olur, her adım kayda geçer.
- **Neden gerekli:** Kurucu şirketten ayrılabilir, hesabı değişebilir ya da işi bir ortağa bırakabilir. Bugün bunun yolu yok; workspace sahipsiz kalır.
- **Gerekçe / kanıt:**
  - Rol değiştirme ucu sahiplik devrini açıkça reddediyor ("Ownership transfer is not supported here", `apps/api/src/routes/agents.ts:666-670`); ekrandaki rol menüsü de Kurucu rolünü hiç sunmuyor (`apps/web/src/features/team/RoleMenu.tsx`).
  - Yalnız Kurucu'nun yapabildiği işler var: SSO bağlantısı, HIPAA BAA, sandbox, workspace fontu (`apps/api/src/routes/settings.ts`, `exactRole: 'owner'`). Kurucu SSO zorunluluğundan da muaf (`auth.ts:1905`). Kurucu yoksa bunlar kilitli kalır.
  - LiveChat'te "Change owner" var (`kaynaklar/eksikler.md` T23). ChatBot.com'da "Transfer ownership" düğmesi sessizce çalışmıyordu; tekrarlanmaması gereken bir hata.
- **Yapılmazsa:** Kurucu ayrılınca workspace'in güvenlik ayarları değiştirilemez; çözüm platform ekibinin veritabanına elle müdahalesi olur (riskli ve kayıtsız).
- **Bağımlılıklar:** RL-01, RL-02, RL-06 (devir öncesi şifre ve iki adımlı doğrulama teyidi), GV-03 (e-posta sahipliği kanıtı).
- **Netleştirilecek sorular:**
  1. Devralacak kişinin onayı gereksin mi? Önerilen varsayılan: evet; e-postasına gelen bağlantıyla 72 saat içinde kabul etmeli, yoksa devir düşer.
  2. Eski Kurucu ne olsun? Önerilen varsayılan: Yönetici.
  3. Kurucu ulaşılamaz durumdaysa (ayrıldı, hesabını kaybetti)? Önerilen varsayılan: panelde yol yok; platform destek ekibinin kimlik doğrulamalı, kayıtlı manuel süreci.

### RL-06 — Profil adı düzenleme ve uygulama içinden şifre değiştirme
- **Ne:** Her kullanıcı kendi görünen adını düzenler ve mevcut şifresini girerek yeni şifre belirler.
- **Neden gerekli:** Yanlış yazılmış ad için destek talebi açmak ya da şifre değiştirmek için "şifremi unuttum" e-postası beklemek gereksiz. iGaming'de ajanlar oyuncuya genellikle takma adla görünür; bu da kendi kendine yönetilebilmeli.
- **Gerekçe / kanıt:**
  - Profil adı düzenleme yok; ajan uçlarında yalnız sohbet limiti, uzmanlık, rol, askıya alma ve çalışma takvimi var (`kaynaklar/eksikler.md` T14). Şifre yalnız e-postayla sıfırlanabiliyor (T18).
  - Hesap e-postaları adres başına günde 5 ile sınırlı (`docs/production-checklist.md`); şifre değiştirmek için sıfırlama e-postası kullanmak bu hakkı da harcıyor.
  - ChatBot.com keşfinden çıkan güvenlik notu: "Şifre değişiminde eski şifre istenmeli" (`chatbot-uygulama.md` §9.3).
- **Yapılmazsa:** Basit işler destek talebine döner; şifre değişimi zahmetli olduğu için yapılmaz.
- **Bağımlılıklar:** RL-01, GV-03, RL-05.
- **Netleştirilecek sorular:**
  1. Şifre değişince diğer oturumlar kapansın mı? Önerilen varsayılan: evet, şifreyi değiştirdiği oturum hariç hepsi.
  2. Oyuncuya görünen ad, paneldeki addan ayrı olsun mu? Önerilen varsayılan: evet; isteğe bağlı "oyuncuya görünen ad" (takma ad) alanı. Boşsa panel adı kullanılır.

---


---

## 4. Inbox / sohbet deneyimi (IN)

### IN-01 — Yazılan taslağın sohbetler arasında taşınmasının düzeltilmesi + sohbet başına taslak saklama
- **Ne:** Ajanın bir sohbette yazıp göndermediği metin (ve eklediği dosya) başka sohbete geçince ajanla birlikte taşınıyor. Bu taşınma durdurulacak; her sohbetin taslağı kendi sohbetinde saklanacak ve ajan geri dönünce yerinde duracak.
- **Neden gerekli:** iGaming ekiplerinde bir ajan aynı anda 4–6 oyuncuyla yazışır ve listede sürekli sohbet değiştirir. Bir oyuncu için yazılmış "Çekiminiz 2.500 TL, IBAN'ınızın son 4 hanesi 8841" gibi bir metin yanlışlıkla başka oyuncuya giderse bu hem kişisel veri ihlali (KVKK) olur hem de operatör için itibar ve şikâyet riski doğurur. Yarım kalan cevabın kaybolması da ajanı yavaşlatır.
- **Gerekçe / kanıt:**
  - nexa: Mesaj kutusundaki metin, eklenen dosya, mod (yanıt/iç not) ve öneri çipleri bileşenin kendi hafızasında tutuluyor (`apps/web/src/features/inbox/Composer.tsx:97-105`). Bileşen sohbet değişince sıfırlanmıyor, çünkü sohbete bağlı bir anahtarı yok (`InboxPage.tsx:883-890`). Gönder düğmesi de o an açık olan sohbete gönderiyor (`Composer.tsx:116`, `212-227`). Sonuç: A sohbetinde yazılan metin, B sohbetinde Enter'a basılınca B'deki oyuncuya gider. Bu hata kod okumasıyla bulundu, çalıştırılarak doğrulanmadı [D15].
  - Aynı risk dosya eki için de geçerli: A oyuncusu için yüklenmiş bir dekont ya da ekran görüntüsü B'ye gidebilir.
  - LiveChat'te taslak sohbete bağlı; başka sayfaya gidip dönünce korunuyor (keşif raporu, Composer bölümü).
- **Yapılmazsa:** Yanlış oyuncuya kişisel/finansal bilgi veya dosya gider. Tek bir olay bile operatörün veri ihlali bildirimi yapmasını gerektirebilir. Pilotta güveni en çok sarsacak türden bir hata.
- **Bağımlılıklar:** Yok; bağımsız bir iş ve en önce yapılmalı. IN-08'deki hızlı sohbet geçiş kısayolları bu düzeltmeden önce açılmamalı, çünkü riski büyütür.
- **Netleştirilecek sorular:**
  1. Taslaklar nerede saklansın: yalnız o tarayıcıda mı, yoksa ajanın başka bilgisayarında da görünsün diye sunucuda mı? Önerilen varsayılan: yalnız o tarayıcıda, en fazla 24 saat. Ajan çıkış yapınca silinir. Hassas metin taslak olarak sunucuya yazılmaz.
  2. Sohbet başka ajana/ekibe aktarılınca ya da kapanınca taslağa ne olsun? Önerilen varsayılan: silinsin. Yeni sahibi eski ajanın taslağını görmez.

### IN-02 — Sağ panelde oyuncu kartı
- **Ne:** Inbox'ta sağ panelin en üstünde bir oyuncu kartı yer alacak. Kartta ad, kullanıcı adı, e-posta ve ülke; pre-chat (sohbet öncesi form) cevapları; sohbet AI'dan devralındıysa devir kartı; o günkü önceki sohbetler (aynı thread) ve geçmiş günlerin konuşmaları bulunacak.
- **Neden gerekli:** Oyuncu "yarım saat önce de yazdım, hâlâ yatırımım geçmedi" dediğinde ajan kim olduğunu, bugün ne konuşulduğunu ve AI'ın hangi bilgileri topladığını tek bakışta görmeli. Kullanıcı adı, finans ekibine iletilecek en önemli bilgi. Bugün ajan bunun için Müşteriler (Customers) sayfasına geçip oyuncuyu aramak zorunda. Yoğun saatte bu hem süre kaybettirir hem de yanlış oyuncuya bakma riski yaratır.
- **Gerekçe / kanıt:**
  - nexa: Sağ panelde konuşma durumu, Chat ID, atanan kişi, etiketler, ekipler, uygulamalar, ziyaret edilen sayfalar ve ziyaret bilgisi var. Ad, e-posta, kullanıcı adı ve ülke yok (`apps/web/src/features/inbox/DetailsPanel.tsx:173-397`) [D37]. Pre-chat cevapları yalnız Canlı Trafik panelinde (`features/traffic/VisitorPanel.tsx:68-72`) [D38], geçmiş sohbetler yalnız Müşteriler ekranında görünüyor (`features/customers/CustomerDetailPanel.tsx:265-275`) [D39].
  - Kullanıcı adı alanı veritabanına yeni eklendi ama henüz commit'lenmedi (`apps/api/prisma/migrations/20261014090000_customer_username/`). Bu ID-03'ün işi.
  - Ülke otomatik dolmuyor. IP'den ülke bulan bir bileşen (GeoIP) yok; `customers.country_code` yalnız elle ya da yönlendirme isteğiyle yazılıyor.
  - Müşteri detayı uç noktası oyuncunun tüm sohbetlerini ekip ayrımı yapmadan listeliyor (`apps/api/src/services/customers/customer-service.ts:176-187`). Inbox'a taşınırken "kim neyi görür" kuralına bağlanması gerekiyor.
  - LiveChat'in sağ panelinde müşteri kartı (ad, e-posta, konum/harita), ek bilgiler ve "browsing or chat history" var (keşif raporu: Sağ panel bölümü ve Chats turunun 2. adımı). Intercom ve Zendesk'te de konuşmanın yanında kişi profili ve son konuşmalar standart.
- **Yapılmazsa:** Ajan aynı gün tekrar gelen oyuncuya aynı soruları yeniden sorar; oyuncu sinirlenir, şikâyet artar. AI'ın topladığı bilgiler görünmez kalır, AI-10'daki emek boşa gider. Ajan sayfa değiştirirken sohbet kaçırır.
- **Bağımlılıklar:** ID-01 ve ID-02 (aynı gün thread'inin tanımı), ID-03 (kullanıcı adı ve üye eşleştirme), ID-05 (ID'lerin görünmesi ve kopyalanması), AI-10 (devir kartı bu panelde gösterilir), AI-27 (risk bayrakları kartta rozet olarak), RL-02 (e-posta gibi alanları kim görür), WG-01 (pre-chat alanları).
- **Netleştirilecek sorular:**
  1. Ülke bilgisi otomatik bulunsun mu? Önerilen varsayılan: evet. Ülke, IP'den sunucunun içindeki çevrimdışı bir veritabanıyla bulunur; IP dışarıya gönderilmez. Harita gösterilmez, yalnız ülke ve şehir yazılır.
  2. Ajanın kendi ekibine ait olmayan geçmiş konuşmalar (ör. Sorumlu Oyun ya da KYC ekibinin konuşmaları) görünsün mü? Önerilen varsayılan: tarih ve konu etiketi görünür, içerik açılamaz ("kısıtlı konuşma"). Kimin neyi açacağı RL-02 matrisinden ayarlanır.
  3. Geçmiş kaç gün geriye gitsin? Önerilen varsayılan: son 90 gün. "Tümü" bağlantısı Arşiv ekranını (AR-01) bu oyuncuya filtrelenmiş olarak açar.

### IN-03 — Sohbet satırında bekleme süresi
- **Ne:** Sohbet listesindeki her satırda, oyuncunun ne kadar süredir cevap beklediğini gösteren canlı bir sayaç (ör. "4 dk") olacak. Belirli eşikler aşılınca satırın görünümü değişecek.
- **Neden gerekli:** Yatırımı geçmeyen ya da çekimini bekleyen oyuncu birkaç dakika cevapsız kalınca art arda yazar, sonra sosyal medyaya veya şikâyet sitesine gider. Ajan hangi oyuncuya önce döneceğine bu süreye bakarak karar verir. Ekip Lideri de listeye bakınca geciken sohbeti hemen görür.
- **Gerekçe / kanıt:** nexa'da satırda ad, kuyruk sırası, okunmamış noktası, son mesaj ve etiketler var; süre yok (`apps/web/src/features/inbox/InboxPage.tsx:748-797`) [D4]. Gerekli veri büyük ölçüde mevcut: son olayın yazarı ve zamanı listede geliyor, kuyruğa giriş zamanı veritabanında (`threads.queued_at`) var ama kullanılmıyor. Ancak "son olay oyuncudan mı" diye bakmak yanıltıcı olur, çünkü "Sohbet aktarıldı" gibi bir sistem mesajı da son olay olabilir. LiveChat'te satırda avatar ve canlı artan süre ("33m") gösteriliyor.
- **Yapılmazsa:** Uzun bekleyen oyuncu listede fark edilmez. İlk yanıt süresi ve terk oranı kötüleşir.
- **Bağımlılıklar:** Yok. İlgili maddeler: WG-03 (cevapsız sohbeti başka ajana aktarma aynı "cevap bekliyor" tanımını kullanmalı), IN-10 (tekrarlayan ses), RP-04 (kuyruk raporu).
- **Netleştirilecek sorular:**
  1. Sayaç neyi ölçsün? Önerilen varsayılan: oyuncunun cevaplanmamış ilk mesajından bu yana geçen süre. Ajan ya da AI oyuncuya cevap yazınca sıfırlanır, iç not sıfırlamaz. Kuyruktaki sohbette kuyruğa giriş süresi gösterilir.
  2. Uyarı eşikleri ne olsun? Önerilen varsayılan: 2 dakikada sarı, 5 dakikada kırmızı. Yönetici kiracı ayarından değiştirebilir.

### IN-04 — Takıma transfer (API'de var, arayüzde yok)
- **Ne:** Sohbetin atama menüsüne "Ekibe aktar" seçeneği eklenecek. Ajan sohbeti bir kişiye değil, ekibe (Finans, KYC/Risk, Bonus, Sorumlu Oyun…) aktarabilecek ve isteğe bağlı kısa bir not bırakabilecek.
- **Neden gerekli:** İlk hattaki ajan çekim reddi, KYC itirazı ya da bahis itirazı gibi konuları çözemez; uzman ekibe aktarması gerekir. Bugün yalnız tek bir kişiyi seçebiliyor ve o kişinin müsait olup olmadığını, ekipte kimin boş olduğunu bilmiyor. Ekibe aktarmak işi doğru kuyruğa bırakır.
- **Gerekçe / kanıt:**
  - nexa: Sunucu ekibe aktarmayı destekliyor (`packages/contract/openapi/paths/chats.yaml:370-408`, "Exactly one of group_id or agent_id"). Arayüz ise yalnız kişi gönderiyor (`apps/web/src/features/inbox/useInbox.ts:821-824`) [D7].
  - Önemli bulgu: Ekibe aktarılan sohbet "atanmamış" yapılıyor, ama ekipten birine atanmıyor ve kuyruğa da alınmıyor (`apps/api/src/services/chat/chat-service.ts:1388-1417`). Kuyruğu boşaltan işlem yalnız kuyruk sırası olan sohbetlere bakıyor (`services/routing/routing-service.ts:179-192`). Yani sohbet, biri fark edip alana kadar hedef ekibin "atanmamış" görünümünde bekliyor. AI'ın insana devri de aynı yolu kullandığı için (`services/ai/ai-responder.ts:174-199`) aynı sorun orada da var.
  - Ekipte o an sohbet kabul eden kimse yoksa aktarma hata verip reddediliyor (`chat-service.ts:1396-1412`).
  - LiveChat'te "Transfer to ..." menüsünde hem ajanlar hem gruplar var.
- **Yapılmazsa:** Ajanlar oyuncuya "başka kanaldan yazın" der ya da iç not yazıp ekibe ayrıca haber verir. Sohbet atanmamış halde unutulur; finans ve KYC talepleri gecikir.
- **Bağımlılıklar:** AU-01 (konuya göre ekipler ve kuyruklar), AI-12 (AI devrinde aynı ekip seçici), WG-03 (cevap verilmeyen sohbetin aktarılması), RL-02 (kim aktarabilir), IN-10 (aktarılan ekibe bildirim).
- **Netleştirilecek sorular:**
  1. Hedef ekipte o an çevrimiçi kimse yoksa ne olsun? Önerilen varsayılan: aktarma reddedilmesin; sohbet o ekibin kuyruğuna alınsın ve ajana "ekipte şu an kimse çevrimiçi değil, kuyruğa alındı" uyarısı gösterilsin. Sorumlu Oyun gibi kritik bir ekipte Yönetici'ye ayrıca bildirim gitsin.
  2. Aktarırken not zorunlu mu? Önerilen varsayılan: isteğe bağlı; not iç not olarak sohbete düşer. Sorumlu Oyun ve Şikâyet ekiplerine aktarırken zorunlu.

### IN-05 — Okundu bilgisi gösterimi (veri hazır)
- **Ne:** Ajanın oyuncuya yazdığı son mesajın altında "Okundu · 14:32" yazacak. Böylece oyuncunun mesajı gerçekten görüp görmediği belli olacak.
- **Neden gerekli:** Ajan "KYC belgenizi yükleyin" ya da "çekim talebinizi yeniden oluşturun" yazdı, oyuncu cevap vermiyor. Okuyup bekliyor mu, yoksa sekmeyi kapatıp gitti mi? Mesaj okunmadıysa ajan e-posta/ticket yoluna geçer. Şikâyet incelemesinde de "oyuncu bilgilendirildi ve mesajı okudu" kanıtı olur.
- **Gerekçe / kanıt:**
  - nexa'da veri modeli hazır: her katılımcı için "nereye kadar okudu" alanı (`seen_up_to`) var (`packages/contract/openapi/openapi.yaml:1097-1107`) ve sunucu servisi bunu oyuncu için de kaydedebiliyor (`apps/api/src/services/chat/chat-service.ts:1805-1825`). Ancak oyuncu tarafı bu alanı hiç yazmıyor. Widget'ta "okudum" çağrısı yok, oyuncu API'sinde bu uç tanımlı değil; alanı yazan tek yer ajan paneli (`apps/api/src/routes/chats.ts:580`). Mesaj akışı da bilgiyi göstermiyor (`features/inbox/Transcript.tsx`).
  - Bu yüzden eksikler tablosundaki "veri hazır" tespiti [D34] yarım doğru: alan var ama oyuncu tarafı boş. Widget ve yeni bir uç gerektiği için efor S'den biraz fazla olabilir.
  - LiveChat'te ajan mesajının altında "Read • 33m" görünüyor.
- **Yapılmazsa:** Ajan gereksiz yere tekrar tekrar yazar ya da okunmamış bir bilgiyi verilmiş sayar. Şikâyet incelemesinde kanıt eksik kalır.
- **Bağımlılıklar:** Yok. İlgili maddeler: IN-07 ("oyuncu sessiz kaldı" önerisi), WG-08 (e-posta iste), ID-09 (okundu olayı zaman çizelgesinde gösterilebilir).
- **Netleştirilecek sorular:**
  1. Oyuncu da "ajan okudu" bilgisini görsün mü? Önerilen varsayılan: hayır. İlk sürümde bilgi yalnız ajan tarafında gösterilir.

### IN-06 — Hazır yanıtlar: içerikte arama, 6'dan fazla sonuç, değişkenler (%oyuncu-adı%…), kişisel (private) yanıtlar
- **Ne:** "#" ile açılan hazır yanıt seçicisinde arama yalnız kısayolun başında değil, metnin içinde de yapılacak; tüm sonuçlar kaydırmalı bir listede görünecek. Yanıtlara oyuncu adı, kullanıcı adı, ajan adı ve Chat ID gibi değişkenler eklenebilecek. Ayrıca yalnız ajanın kendisinin gördüğü kişisel yanıtlar olacak.
- **Neden gerekli:** iGaming ekipleri yöntem bazında yüzlerce hazır yanıt kullanır: Papara yatırım süresi, FAST/EFT farkı, KYC belge kuralları, bonus çevrim açıklaması gibi. Ajan kısayolları ezberleyemez; "papara" ya da "çevrim" yazıp bulabilmeli. Bugün yalnız ilk 6 sonuç görünüyor, yani "papara" ile başlayan 10 yanıtın 4'ü gizli kalıyor. Değişkenler kişiselleştirilmiş ve hatasız selamlama sağlar. Kişisel yanıtlar ise ajanın kendi imzası ve üslubu içindir.
- **Gerekçe / kanıt:**
  - nexa: Seçici yalnız kısayolun başını eşliyor ve sonuçları 6'da kesiyor (`apps/web/src/features/inbox/useCannedResponses.ts:60-68`) [D17]. Değişken yok [D18, A-33]. Görünürlük yalnız "herkes" ya da "ekip" olabiliyor (`apps/api/src/services/team/canned-response-access.ts:28`, `apps/api/prisma/schema.prisma:1311-1328`) [A-30]. Ticket e-posta şablonlarında `{{customer.name}}` gibi bir değişken kataloğu zaten var (`packages/types/src/template-variables.ts:22`), ama hazır yanıtlarda kullanılmıyor.
  - Kısayollar yalnız İngilizce harf ve rakam kabul ediyor (`apps/api/src/routes/settings.ts:362`), bu yüzden "#çekim" gibi bir kısayol yazılamıyor. İçerikte arama bu açığı da kapatır.
  - LiveChat'te metin içinde arama, Shared/Private yanıtlar, `%customer-name%` gibi 4 değişken ve grup/adet bazında gezinme var.
- **Yapılmazsa:** Ajanlar kendi not dosyalarından kopyala-yapıştır yapar. Eski ya da yanlış bilgi (ör. güncel olmayan yatırım süresi) oyuncuya söz gibi gider (G7 riski) ve yanıtlar tutarsızlaşır.
- **Bağımlılıklar:** RL-02 (kim paylaşılan, kim kişisel yanıt oluşturur), ID-03 (kullanıcı adı değişkeni), ID-05 (Chat ID / thread ID değişkeni). İlgili maddeler: IN-07, AI-14 (bilgi deposuyla ilişki), AI-27/EN-01 (risk bayraklı sohbette bonus içerikli yanıt uyarısı).
- **Netleştirilecek sorular:**
  1. Değişkenler LiveChat'teki gibi `%oyuncu-adi%` şeklinde mi, nexa'nın ticket şablonlarındaki gibi `{{customer.name}}` şeklinde mi yazılsın? Önerilen varsayılan: `{{ }}`, böylece tek bir katalog kullanılır. Ajan bunu elle yazmaz; Türkçe etiketli bir menüden seçer.
  2. Değişkenin değeri yoksa (ör. oyuncu adını yazmamışsa) ne olsun? Önerilen varsayılan: kiracının belirlediği yedek ifade kullanılsın ("Değerli üyemiz"). Ajan göndermeden önce metni görür ve düzeltebilir.
  3. Ekip Üyesi paylaşılan yanıt oluşturabilsin mi? Önerilen varsayılan: hayır. Ekip Üyesi yalnız kişisel yanıt oluşturur; paylaşılan yanıtları Ekip Lideri ve üstü yönetir.

### IN-07 — Olaya bağlı önerilen yanıtlar (sohbet başladı, aktarıldı, sessiz kaldı, puanlandı)
- **Ne:** Belirli anlarda mesaj kutusunun üstünde o ana uygun hazır yanıtlar çip olarak önerilecek: sohbet başladığında, sohbet size aktarıldığında, oyuncu bir süredir yazmadığında, olumlu/olumsuz puan verildiğinde.
- **Neden gerekli:** Aktarılan sohbette "Merhaba, ben Finans ekibinden Ayşe, talebinizi devraldım" gibi standart bir karşılama; sessiz kalan oyuncuya "Hâlâ buradaysanız yardımcı olmaya devam edebilirim"; olumsuz puandan sonra özür ve şikâyet yolu. Bu öneriler ekip genelinde tutarlı bir dil sağlar ve yeni ajanların işini kolaylaştırır. Öncelik P2, yani olsa iyi olur.
- **Gerekçe / kanıt:** nexa'da öneriler yalnız boş kutuda Boşluk tuşuyla açılan niyet şablonları ve Copilot taslağından oluşuyor (`apps/web/src/features/inbox/replySuggestions.ts`, `Composer.tsx:325-443`). Olaya bağlı bir eşleme yok; hazır yanıt tablosunda da böyle bir alan bulunmuyor [A-37]. Oyuncu puanı ajan ekranına anlık iletilmiyor, yalnız kaydediliyor (`apps/api/src/routes/customer.ts:1096-1136`). LiveChat'in "Suggested responses" ekranında 5 olay ile hazır yanıtlar ekip ve kişi düzeyinde eşleniyor; ajan önerileri kendisi için kapatabiliyor.
- **Yapılmazsa:** Küçük bir verim kaybı olur; ajan aynı yanıtı "#" ile elle bulur.
- **Bağımlılıklar:** IN-06 (arama ve kişisel yanıtlar), IN-04 (aktarma olayı), IN-05 (okundu/sessizlik), AR-03 ve WG-11 (puan ve yorum), AI-27 (risk bayraklı sohbette bonus veya promosyon içeren yanıt önerilmez).
- **Netleştirilecek sorular:**
  1. Oyuncu kaç dakika yazmazsa "sessiz kaldı" sayılsın? Önerilen varsayılan: 3 dakika, kiracı ayarıyla değiştirilebilir. WG-03'teki "ajan cevap vermedi" süresiyle karıştırılmamalı.
  2. Öneriler hiç kendiliğinden gönderilsin mi (ör. sohbet başlayınca otomatik karşılama)? Önerilen varsayılan: hayır. Öneriler yalnız çip olarak gösterilir; ajan tıklar, düzenler ve kendisi gönderir.

### IN-08 — Klavye kısayolları listesi (Shift+/) ve sohbetler arası geçiş kısayolları
- **Ne:** "?" tuşuyla (Shift+/) açılan bir kısayol listesi; Alt+↑/↓ ile önceki/sonraki sohbete geçiş; etiket ekleme, dosya yükleme ve sohbeti kapatma gibi işler için kısayollar.
- **Neden gerekli:** Maç saatlerinde ve kampanya dönemlerinde ajan 5–8 sohbeti aynı anda yürütür. Her geçişte fareye uzanmak dakikalar kaybettirir. Kısayol listesi yeni ajanların bunları öğrenmesini de sağlar.
- **Gerekçe / kanıt:** nexa'da genel klavye dinleyicisi yalnız Ctrl+K komut paleti için var (`apps/web/src/components/CommandPalette.tsx:151-163`). Mesaj kutusu yalnız Boşluk, Esc, Enter ve ok tuşlarını işliyor (`features/inbox/Composer.tsx:445-493`) [C26, D29]. LiveChat'in kısayol penceresinde Ctrl+K, Ctrl+G, Shift+/, Alt+↑/↓, Ctrl+Alt+M, Ctrl+Alt+U ve Ctrl+Alt+Backspace gibi kısayollar var. Türkçe klavyede "?" Shift+/ ile yazılmadığı ve Ctrl+Alt, AltGr ile çakıştığı için bu kısayollar birebir kopyalanamaz (ayrıntı 05'te).
- **Yapılmazsa:** Yoğun saatlerde verim kaybı olur. Klavyeyle çalışan kullanıcılar için erişilebilirlik eksik kalır.
- **Bağımlılıklar:** IN-01 (önce o düzeltilmeli; hızlı geçiş ile taşınan taslak birleşince yanlış oyuncuya mesaj gider), IN-09 (Copilot kısayolu), IN-11 (paletteki kısayol ipuçları).
- **Netleştirilecek sorular:**
  1. Alt+↑/↓ hangi listede gezinsin? Önerilen varsayılan: ekranda o an görünen listede, yani seçili görünüm ve sekme hangisiyse onda.
  2. Kısayollar kişiselleştirilebilir olsun mu? Önerilen varsayılan: hayır, ilk sürümde sabit bir set. Türkçe klavyede çakışan tuş kombinasyonları baştan seçilmez.

### IN-09 — Her ekrandan açılabilen Copilot paneli
- **Ne:** Hangi sayfada olunursa olunsun (Raporlar, Ayarlar, Arşiv, Müşteriler) bir kısayolla açılan sağ çekmece. Çekmece bilgi bankasına soru ("Papara çekim üst limiti ne?"), rapor sorusu ("bugün kaç çekim şikâyeti geldi?") ve ürünün kullanımıyla ilgili yardım sunacak.
- **Neden gerekli:** Ajan sohbet dışındayken de bilgiye ihtiyaç duyar. Ekip Lideri raporlara bakarken hızlıca soru sormak ister. Yeni ajanların eğitimi de hızlanır. Bugün bir bilgiye ulaşmak için Playbook'a gidip aramak gerekiyor.
- **Gerekçe / kanıt:** nexa'daki Copilot paneli bir sohbete bağlı (özet, yanıt taslağı, metin iyileştirme, rapor sorusu; `apps/web/src/features/inbox/CopilotPanel.tsx:1-16`) ve yalnız Inbox'ta açılıyor. Komut paletindeki "Ask AI" yalnız rapor sayılarını cevaplıyor [C13, C15]. Sohbetten bağımsız bir "bilgi bankasına soru" ucu yok; mevcut uçlar sohbet kimliği istiyor (`packages/contract/openapi/openapi.yaml:332-343`). LiveChat'te Ctrl+G ile her ekrandan açılan bir Copilot var (ürün soruları, metrikler, "Train me with sources"); Intercom ve Zendesk'te de benzeri bulunuyor.
- **Yapılmazsa:** Orta düzeyde verim kaybı olur. Ajanlar bilgiyi ekip liderine sorar ya da tahminle cevap verir.
- **Bağımlılıklar:** AI-14 (tek bilgi deposu ve "Copilot kullanır" işareti), AI-16 (gerçek dil modeli), IN-08 (kısayol), RL-02 (rapor sorularını kim sorabilir).
- **Netleştirilecek sorular:**
  1. Copilot hangi bilgi kaynaklarından cevap versin? Önerilen varsayılan: "Copilot" ya da "herkese açık" olarak işaretli kaynaklardan ve rapor sayılarından. Yalnız AI Agent'a özel iç talimatlar kullanılmaz.
  2. Copilot'la yapılan yazışmalar saklansın mı? Önerilen varsayılan: hayır. Yazışma yalnız oturum boyunca tarayıcıda durur; sunucuda yalnız kullanım sayısı (fatura ve kota için) tutulur.

### IN-10 — Olay bazlı bildirim tercihleri ve okunana kadar tekrarlayan ses
- **Ne:** Ajan hangi olaylarda uyarı alacağını seçebilecek: yeni mesaj (her zaman açık), yeni sohbet atandı, sohbet bana/ekibime aktarıldı, kuyrukta bekleyen oyuncu var, yeni ticket veya ticket yanıtı geldi. "Yeni mesaj" sesi ajan sohbeti açana kadar aralıklarla çalacak.
- **Neden gerekli:** iGaming ajanları sürekli operatörün yönetim paneline (oyuncu hesabı, işlem geçmişi) geçip geri döner. Tek seferlik kısa bir bip sesi kolayca kaçar ve kaçan mesaj, bekleyip sinirlenen bir oyuncu demektir. Ekip liderleri de kuyruk birikimini anında duymak ister.
- **Gerekçe / kanıt:** nexa'da uyarı yalnız "oyuncu mesaj yazdı" olayında çalışıyor (`apps/web/src/features/notifications/notifications.ts:70-100`). Tercihler yalnız kanal anahtarlarından ibaret: açık, ses, masaüstü, mobil, e-posta (`packages/types/src/notifications.ts:57-86`). Ses tek seferlik çalıyor (`features/notifications/useNotifications.ts:107-114`). Yeni ticket için ajan paneline anlık bildirim bile gitmiyor, yalnız webhook tetikleniyor [C20, C21]. LiveChat'te "Notify me about…" listesi (Incoming chats, New tickets, Visitors in the queue, New/Returning visitors) ve "Repeat New message sound until message is read" seçeneği var.
- **Yapılmazsa:** Sohbetler kaçar, bekleme uzar, terk artar. Ticket'lar saatlerce fark edilmez.
- **Bağımlılıklar:** IN-03 (aynı "cevap bekliyor" tanımı), IN-04 (aktarma olayı), HD-01 (ticket yanıtı olayı), GV-06 (tutarlı kaydetme kalıbı).
- **Netleştirilecek sorular:**
  1. Tekrarlayan ses ne sıklıkla ve ne kadar süre çalsın? Önerilen varsayılan: 10 saniyede bir, en fazla 2 dakika boyunca ya da ajan sohbeti açana kadar.
  2. Yönetici bazı bildirimleri ekip için zorunlu tutabilsin mi? Önerilen varsayılan: ilk sürümde hayır. Yalnız "yeni mesaj" olayı herkes için kapatılamaz.

### IN-11 — Komut paletinden ayar alt sayfalarına gitme
- **Ne:** Ctrl+K paletinde "hazır yanıt", "SLA", "iki adımlı doğrulama" ya da "yönlendirme" yazılınca doğrudan ilgili Ayarlar bölümü (ve rapor sekmeleri) açılacak.
- **Neden gerekli:** Yönetici ve Ekip Lideri vardiya sırasında hızlıca ayar değiştirir: çevrimdışı mesajı, yönlendirme kuralı, hazır yanıt gibi. 36 ayar bölümü arasında menüden gezinmek yavaş.
- **Gerekçe / kanıt:** Palet yalnız 9 ana modüle gidiyor (`apps/web/src/components/navigation.ts:66-163`, `components/CommandPalette.tsx:285-312`). Ayar bölümleri için bir arama fonksiyonu zaten yazılmış, ama yalnız Ayarlar sayfasının kendi içinde kullanılıyor (`features/settings/settings-sections.ts:454-470`) [C8]. Bu fonksiyon Türkçe "İ/ı" harflerini yanlış eşliyor; palete taşınırken düzeltilmeli. LiveChat'te "set" yazınca Invite settings, Chat forms gibi alt sayfalar listeleniyor.
- **Yapılmazsa:** Etkisi düşük; zaman kaybı olur.
- **Bağımlılıklar:** Yok. İlgili maddeler: IN-08 (kısayol listesi), ID-06 (palette ID ile arama; ayrı madde ama aynı paleti kullanır, çakışmamalı).
- **Netleştirilecek sorular:** Yok.

## 5. Arşiv (AR)

### AR-01 — Ayrı arşiv ekranı: liste + transkript + oyuncu paneli
- **Ne:** Inbox içindeki "Arşiv" görünümünden bağımsız, geçmiş konuşmaları bulmaya odaklı bir ekran olacak. Üstte arama ve filtreler, solda sonuç listesi, ortada salt okunur konuşma metni, sağda oyuncu paneli (IN-02 kartı) yer alacak.
- **Neden gerekli:** Inbox canlı iş içindir, geçmişi incelemek ayrı bir iştir. Ekip Lideri şikâyet inceler ("dün gece oyuncuya çekim için söz verilmiş mi?"). Finans ekibi "bu kullanıcı adıyla geçen hafta yazan oyuncunun konuşmalarını" arar. Kalite kontrol örneklem çeker, uyum birimi denetim için kayıt ister.
- **Gerekçe / kanıt:**
  - nexa: Arşiv bugün Inbox'ın bir görünümü (`view=archived`; `packages/contract/openapi/paths/chats.yaml:26-41`, `apps/web/src/features/inbox/views.ts:124-133`) [E1].
  - Önemli bulgu: Liste "oyuncu başına tek kayıt" mantığıyla çalışıyor. nexa'da "chat" bir oyuncuyla süregelen ilişkiyi, "thread" ise bu ilişki içindeki her yeni konuşmayı temsil ediyor (`chats.yaml:6-11`). Liste her satırda yalnız son konuşmayı taşıyor (`apps/api/src/services/chat/chat-service.ts:2142-2146`); detay da yalnız son konuşmanın etiket ve atanan bilgisini veriyor (`chat-service.ts:2638-2664`). Dolayısıyla 20 kez yazmış bir oyuncu arşivde tek satır olarak görünüyor ve eski konuşmalar listede yer almıyor. Arşiv konuşma (bağlantı) bazında listelenmeli; bu ayrım ID-01'in kimlik sözlüğüyle birlikte netleşmeli.
  - LiveChat'te ayrı bir Archives modülü var: 3 sütun, arama, "Add filter", sonuç sayacı ve sıralama.
- **Yapılmazsa:** Geçmiş bir konuşmayı bulmak için oyuncunun adını bilip Müşteriler ekranından girmek gerekir. Şikâyet incelemesi ve denetim saatler sürer, eski konuşmalar fiilen kaybolur.
- **Bağımlılıklar:** ID-01 ve ID-02 (listede bir satırın neyi temsil ettiği), ID-05 (satırda ve başlıkta ID'ler), ID-06 ve ID-07 (arama kutusu), AR-02 (filtreler), AR-03, AR-04, IN-02 (oyuncu paneli), RL-02 (kimin arşivde neyi göreceği), ID-09 (konuşmanın zaman çizelgesine geçiş).
- **Netleştirilecek sorular:**
  1. Arşiv listesinde bir satır neyi göstersin: her bağlantıyı (chat ID) mı, oyuncunun o günkü konuşma grubunu (thread ID) mu? Önerilen varsayılan: her bağlantı bir satır olsun. "Aynı günü grupla" anahtarıyla o günün bağlantıları tek satırda toplanabilsin.
  2. Ekip Üyesi arşivde neyi görsün? Önerilen varsayılan: yalnız kendi ekiplerinin konuşmalarını (bugünkü görünürlük kuralı). Ekip Lideri kendi ekibinin tamamını, Yönetici ve Kurucu hepsini görsün. Bu, RL-02 matrisinden değiştirilebilsin.
  3. Devam eden konuşmalar da arşivde çıksın mı? Önerilen varsayılan: varsayılan olarak yalnız kapanmış konuşmalar listelensin; "devam edenleri de göster" filtresi olsun.

### AR-02 — Filtreler: tarih (P0), ajan, ekip, puan, etiket, AI/insan, risk bayrağı; filtrelerin URL'de tutulması
- **Ne:** Arşivde şu filtreler olacak: tarih (bugün, dün, son 7 gün, son 30 gün, bu ay, özel aralık), ajan, ekip, puan, etiket (herhangi biri / hepsi / hariç), konuşmayı AI'ın mı insanın mı çözdüğü ve risk bayrağı. Seçilen filtreler adres çubuğunda tutulacak, böylece link paylaşılabilecek.
- **Neden gerekli:** Kalite ve uyum işleri filtre ister: "dün 22:00–02:00 arası Finans ekibinin kötü puan alan konuşmaları", "AI'ın kendi kapattığı ama 'çekim' etiketli konuşmalar", "sorumlu oyun bayraklı tüm konuşmalar" gibi. Bunların en temeli tarih filtresi (P0). Ekip Lideri bir linki ajana gönderip "şu listeye bak" diyebilmeli.
- **Gerekçe / kanıt:**
  - nexa: Liste uç noktası yalnız görünüm, kanal, oyuncu, ekip, sıralama ve sayfa parametresi alıyor (`packages/contract/openapi/paths/chats.yaml:25-72`). Tarih, ajan, etiket ve puan filtresi yok; ekip filtresi API'de var ama arayüz kullanmıyor [E3–E7]. Sıralama adres çubuğunda tutuluyor, filtreler tutulmuyor (`features/inbox/chat-sort.ts`) [E11].
  - Raporlar ekranındaki tarih aralığı gün sınırını UTC'ye göre hesaplıyor (`apps/web/src/features/reports/ReportsPage.tsx:489-504`), yani İstanbul için "bugün" 03:00'te başlıyor. Arşiv aynı bileşeni kullanırsa gece vardiyasının konuşmaları yanlış güne düşer. Gün sınırı ID-04'teki kiracı saat dilimine göre belirlenmeli; organizasyonun saat dilimi bugün varsayılan olarak UTC.
  - LiveChat'te Date, Agent, Group, Rating, Tag (any/all/exclude, en fazla 20), Assignment, Availability ve Country filtreleri var ve URL'de tutuluyor. LiveChat'in iki hatası tekrarlanmamalı: ajan e-postasını URL'ye yazıyor (kişisel veri sızıntısı) ve "Unassigned" seçilince ajan filtresini uyarmadan siliyor.
- **Yapılmazsa:** Şikâyet ve denetim incelemesi yapılamaz, belirli bir tarih aralığının kaydı çıkarılamaz, QA örneklemi elle toplanır.
- **Bağımlılıklar:** AR-01, ID-04 (gün sınırı ve saat dilimi), ID-06 ve ID-07 (aynı ekrandaki arama), AI-27 (risk bayrağı verisi), AI-09/AI-10 (devir ve AI/insan bilgisi), WG-11 (yorumlu puan), GV-05 (URL'de kişisel veri olmaması), RP-01 (raporlarla aynı filtre bileşeni).
- **Netleştirilecek sorular:**
  1. Tarih filtresi konuşmanın başladığı zamana mı, bittiği zamana mı göre çalışsın? Önerilen varsayılan: başladığı zamana göre.
  2. "AI çözdü" nasıl tanımlansın? Önerilen varsayılan: hiç insan yanıtı olmadan kapanan konuşma. Bu, bugün faturalamada kullanılan tanımın aynısı; böylece rapor, fatura ve arşiv aynı sayıyı verir.
  3. Kayıtlı filtreler (ör. "Kötü puanlı Finans") ekiple paylaşılsın mı? Önerilen varsayılan: ilk sürümde link paylaşımı yeterli, kayıtlı filtreler kişisel kalsın.

### AR-03 — Arşivde puan ve yorumun gösterimi
- **Ne:** Oyuncunun verdiği puan (iyi/kötü) ve yorumu arşiv listesinde, konuşma detayında ve Inbox'ta görünecek.
- **Neden gerekli:** Kötü puan alan konuşmayı açan Ekip Lideri nedenini (oyuncunun yorumunu) konuşmayla yan yana görmeli. Ajana geri bildirim ve koçluk buna dayanır.
- **Gerekçe / kanıt:** Puanlar değer, yorum ve konuşma bilgisiyle kaydediliyor (`apps/api/prisma/schema.prisma:1278-1291`, `apps/api/src/routes/customer.ts:1096-1136`; yorumdaki kart numaraları maskeleniyor) ve Raporlar'daki memnuniyet hesabında kullanılıyor. Ama Inbox'ta ve arşivde hiçbir yerde gösterilmiyor [E14, E6]. Widget şu an yorum alanı sunmuyor (WG-11), API ise yorumu kabul ediyor. Aynı konuşmaya birden çok puan yazılabiliyor (tekilleştirme yok). Puan, oyuncunun "en son" konuşmasına yazılıyor; oyuncu yeni bir konuşma açtıktan sonra eskisini puanlarsa puan yanlış konuşmaya gidebilir. LiveChat'te arşivde puan ve yorum görünüyor, puan filtresi de var.
- **Yapılmazsa:** Kötü puanların nedeni görülemez; koçluk ve kalite kontrol körlemesine yapılır.
- **Bağımlılıklar:** AR-01, AR-02 (puan filtresi), WG-11 (yorum toplama), AI-24 (QA kuyruğu bu veriyi kullanır), RL-02.
- **Netleştirilecek sorular:**
  1. Ekip Üyesi kendi konuşmalarının puanını ve yorumunu görsün mü? Önerilen varsayılan: evet, yalnız kendi konuşmalarınınkini görsün. Başkalarının puan ve yorumlarını Ekip Lideri ve üstü görsün.

### AR-04 — Transkripti dışa aktarma, yazdırma, e-postayla gönderme
- **Ne:** Arşivde (ve Inbox'ta) bir konuşma dosya olarak indirilebilecek, yazdırılabilecek ya da PDF olarak kaydedilebilecek ve bir e-posta adresine gönderilebilecek. Başlıkta Chat ID, thread ID, oyuncu, tarih ve ajanlar yer alacak.
- **Neden gerekli:** Oyuncu şikâyeti ya da lisans otoritesinin (ör. Curaçao, MGA ADR) talebi geldiğinde konuşma kaydı sunulmalı. Finans ekibine dekontlu konuşma iletilmeli. Oyuncu da konuşmanın bir kopyasını isteyebilir (KVKK erişim hakkı).
- **Gerekçe / kanıt:**
  - nexa: Konuşma kapanınca otomatik transkript e-postası zaten gidiyor: oyuncunun e-postası varsa ona, ayrıca atanan ajana. İç notlar oyuncu kopyasından çıkarılıyor (`apps/api/src/services/chat/chat-service.ts:1115-1280`, `services/notifications/chat-transcript.ts`). Ama isteğe bağlı indirme, yazdırma ya da istenen zamanda gönderme yok [E15].
  - Raporlar'daki PDF üretici Türkçe karakterleri (ğ, ş, ı, İ) basamıyor, yerlerine "?" yazıyor (`apps/api/src/routes/reports-export.ts:212-238`). Transkript için bu yol kullanılmamalı.
  - LiveChat'te arşivde dışa aktarma ve yazdırma, widget menüsünde de "Send transcript" var.
- **Yapılmazsa:** Kayıtlar ekran görüntüsüyle toplanır; bunlar eksik ve değiştirilebilir olur, denetimde zayıf kalır. Uyum taleplerine geç yanıt verilir.
- **Bağımlılıklar:** AR-01, WG-06 (oyuncunun transkripti kendisinin istemesi ve otomatik iletme; aynı içerik şablonu kullanılır), ID-05 (başlıktaki ID'ler), AI-26 (hassas veri maskeleme), RL-02 (kimin dışa aktarabileceği), ID-09 (tam olay kaydının dışa aktarımı ayrı madde).
- **Netleştirilecek sorular:**
  1. Kim dışa aktarabilsin ve e-postayla gönderebilsin? Önerilen varsayılan: Ekip Lideri ve üstü. Ekip Üyesi yalnız kendi konuşmasını oyuncunun kayıtlı e-postasına gönderebilsin.
  2. İç notlar dışa aktarımda yer alsın mı? Önerilen varsayılan: iki seçenek olsun. "Oyuncu kopyası" iç not içermez. "İç kopya" iç notları içerir; yalnız Ekip Lideri ve üstü, yalnız indirme ve yazdırma için kullanabilir. Dışarıya e-postayla yalnız oyuncu kopyası gider.
  3. Rastgele bir e-posta adresine gönderilebilsin mi? Önerilen varsayılan: hayır. Yalnız oyuncunun kayıtlı adresine ve kiracının izin verdiği alan adlarına (ör. @sirketiniz.com) gönderilebilsin. Her gönderim denetim kaydına yazılsın.

## 6. HelpDesk / ticket (HD)

### HD-01 — Ticket'a yanıt verme ve yazışma geçmişi + iç not
- **Ne:** Ticket ekranında bir yazışma akışı (oyuncunun mesajları, ajan yanıtları, iç notlar) ve bir yanıt kutusu olacak. Ajanın yanıtı oyuncuya e-posta olarak gidecek, iç not yalnız ekipte kalacak.
- **Neden gerekli:** Mesai dışında widget'tan bırakılan mesajlar, e-postayla gelen KYC belgeleri, çekim itirazları ve resmi şikâyetler ticket olur. Bunlara bugün sistem içinden cevap verilemiyor; ajan kendi e-posta programından yazmak zorunda. Bu durumda yazışma kayıt dışı kalır ve kimin ne dediği denetlenemez. Resmi şikâyetler (ör. Curaçao kuralları) yazılı ve kayıtlı yanıt ister.
- **Gerekçe / kanıt:**
  - nexa: Ticket'ta mesaj, gövde ya da not tutulmuyor (`apps/api/prisma/schema.prisma:1117-1165`). Servis kodunda "yanıt ucu yok" yazıyor (`apps/api/src/services/tickets/ticket-service.ts:433-439`). Ticket ekranı bir konuşma olarak değil, bir "kayıt" olarak tasarlanmış (`apps/web/src/features/inbox/TicketPane.tsx:1-14`) [H3, H8].
  - Oyuncuya giden tek e-posta, durum değişince ajanın seçtiği şablonlu bildirim (`apps/api/src/routes/tickets.ts:280-373`). Bu e-posta ortak bir gönderici adresinden, yanıt adresi olmadan gidiyor; pilotta altına "Bu adres yanıtları okumaz" satırı ekleniyor (`services/tickets/ticket-email.ts:118-133`).
  - E-postadan ticket açan uç pilot modunda tamamen kapalı (`apps/api/src/routes/channels.ts:388-391`, `pilotRefused`).
  - LiveChat HelpDesk, Zendesk ve Freshdesk'te ticket bir yazışma dizisidir (herkese açık yanıt, iç not, ekler) ve yanıt e-postayla gider.
- **Yapılmazsa:** HelpDesk fiilen kullanılamaz. Çevrimdışı talepler cevapsız kalır, ilk yanıt süresi ölçülemez (HD-05), şikâyet kayıtları eksik kalır.
- **Bağımlılıklar:** HD-02 (gelen e-postanın metni ticket'ın ilk mesajı olur), HD-03 (oyuncunun cevabı aynı ticket'a düşer), HD-05, IN-06 (ticket için hazır yanıtlar; altyapıda "ticket" kapsamı zaten var), AI-26 (maskeleme), RL-02, IN-10 (yeni yanıt bildirimi), ID-05 (ticket numarasının görünmesi).
- **Netleştirilecek sorular:**
  1. Yanıtlar hangi adresten gitsin? Önerilen varsayılan: ilk sürümde sistemin alan adından, kiracının marka adıyla ("Marka Destek"). Oyuncunun cevabının ticket'a dönebilmesi için ticket'a özel bir yanıt adresi eklenir (HD-03). Kiracının kendi alan adından gönderim (SPF/DKIM kurulumu) sonraki aşamaya kalır.
  2. Oyuncuya giden e-postada önceki yazışmalar alıntılansın mı? Önerilen varsayılan: hayır. E-postada yalnız son yanıt ve ticket numarası olur, böylece eski yazışmadaki kişisel veriler tekrar dolaşmaz.
  3. Pilotta e-posta kanalı açılacak mı? Önerilen varsayılan: evet. Açılmazsa HD-01…HD-05 pilotta yalnız widget çevrimdışı formu ve sohbetten açılan ticket'larla çalışır.

### HD-02 — Gelen e-postanın gövdesi ve eklerinin kaydedilmesi
- **Ne:** E-postayla açılan ticket'ta oyuncunun yazdığı metin ve ekler (dekont, ekran görüntüsü, belge) kaydedilecek ve ticket ekranında gösterilecek.
- **Neden gerekli:** Bugün yalnız konu satırı ("Yatırımım geçmedi") kalıyor; tutar, saat, yöntem ve dekont kayboluyor. Ajan oyuncuya "lütfen tekrar yazın" demek zorunda kalıyor, oyuncu da aynı şeyi ikinci kez anlatmaktan şikâyet ediyor.
- **Gerekçe / kanıt:** E-posta işleyici ticket'a yalnız konuyu yazıyor (`apps/api/src/services/channels/email-inbound.ts:161-167`). Gelen istekteki metin alanı kabul ediliyor ama bilerek atılıyor ("not stored", `apps/api/src/routes/channels.ts:100-108`); ek alanı ise hiç yok [H2]. Dosya saklama ve virüs tarama altyapısı mevcut (`apps/api/src/services/storage/`, `virus-scanner.ts`; tarama yapılamazsa dosya reddediliyor). LiveChat/HelpDesk'te e-postanın gövdesi ve ekleri ticket'ta görünüyor.
- **Yapılmazsa:** E-posta kanalı işe yaramaz. KYC belgeleri ve dekontlar kaybolur ya da sistem dışında, kişisel e-posta kutularında dolaşır.
- **Bağımlılıklar:** HD-01 (gövde ticket'ın ilk mesajı olarak saklanır), AI-26 (kart ve şifre maskeleme), RL-02 (belgeleri kimin açacağı), AI-08/G12 (KYC belgelerinin hangi kanaldan kabul edileceği kiracı politikasına bağlı).
- **Netleştirilecek sorular:**
  1. Ek sınırları ne olsun? Önerilen varsayılan: dosya başına 10 MB, e-posta başına 25 MB; yalnız görsel ve PDF. Diğer ekler saklanmaz, ticket'a "şu ek kabul edilmedi" notu düşer.
  2. Kimlik/KYC belgesi içeren ekler nasıl korunsun? Önerilen varsayılan: e-postayla kabul edilsin ama "hassas" olarak işaretlensin. Yalnız KYC ekibi ile Ekip Lideri ve üstü açabilsin; kiracının veri saklama süresi dolunca otomatik silinsin.
  3. HTML (biçimli) e-postalar nasıl gösterilsin? Önerilen varsayılan: düz metin hali gösterilsin. Biçimli hali isteğe bağlı olsun; güvenli hale getirilmiş ve dış görselleri engellenmiş olarak açılsın.

### HD-03 — E-posta yazışma zinciri: müşterinin yanıtı aynı ticket'a bağlanır
- **Ne:** Oyuncu ajanın e-postasına cevap verdiğinde yeni ticket açılmayacak; mesaj aynı ticket'a eklenecek ve ticket yeniden "açık" duruma geçecek.
- **Neden gerekli:** Bir çekim itirazında 4–5 e-posta gidip gelir. Her cevap ayrı ticket olursa ekip aynı oyuncu için birden çok kayıtla uğraşır, iki ajan aynı oyuncuya çelişkili cevap verebilir, SLA ve raporlar şişer.
- **Gerekçe / kanıt:** Gelen her e-posta yeni ticket açıyor ve önceki yazışmayla eşleştirme yapılmıyor (`apps/api/src/services/channels/email-inbound.ts:161`) [H4]. Giden bildirimlerde yanıt adresi yok, bu yüzden oyuncu cevap verse bile cevap sisteme dönmüyor (`services/tickets/ticket-email.ts:118-126` açıklaması). Altyapının yarısı hazır: kiracıya özel "+etiket" adres yapısı (`services/channels/inbound-email-address.ts`) ve giden e-postaya kimlik numarası (Message-ID) üretimi (`services/mail/smtp-mailer.ts:159`) var, ama bu numara saklanmıyor. Zendesk, Freshdesk ve HelpDesk; ticket'a özel yanıt adresi, e-posta başlıklarıyla eşleştirme ve konu satırında ticket numarası kullanıyor.
- **Yapılmazsa:** Kopya ticket'lar birikir, bağlam kaybolur, SLA ve raporlar bozulur. Oyuncu "kaç kez yazacağım" diye şikâyet eder.
- **Bağımlılıklar:** HD-01 (giden yanıtın kimliği ve yanıt adresi), HD-02 (gelen e-posta başlıklarının okunması), HD-04 (otomatik onaya verilen cevap da zincire bağlanmalı ve otomatik yanıt döngüsü önlenmeli), ID-05 (konu satırındaki ticket numarası).
- **Netleştirilecek sorular:**
  1. Çözülmüş ya da kapalı bir ticket'a cevap gelirse ne olsun? Önerilen varsayılan: ticket "çözüldü" durumundaysa yeniden açılsın. "Kapalı" durumdaysa ya da 7 günden eskiyse yeni ticket açılsın ve eskisine bağlantı verilsin.
  2. Oyuncu başka bir e-posta adresinden cevap verirse ne olsun? Önerilen varsayılan: ticket'a özel yanıt adresi doğruysa mesaj aynı ticket'a eklensin, ama "farklı gönderen" uyarısıyla. Ajan bu durumda doğrulama yapmadan hesap bilgisi paylaşmasın.

### HD-04 — Otomatik "talebiniz alındı" yanıtı
- **Ne:** Yeni ticket açıldığında oyuncuya otomatik bir onay e-postası gidecek. E-postada ticket numarası, beklenen dönüş süresi ve gerekirse mesai saatleri bilgisi yer alacak.
- **Neden gerekli:** Gece 03:00'te çekim sorunu yazan oyuncu, talebinin alındığını bilmezse tekrar tekrar yazar (kopya ticket) ya da şikâyet sitesine gider. Ticket numarası da sonraki yazışmalarda ortak referans olur.
- **Gerekçe / kanıt:** nexa'da kiracının yazdığı e-posta şablonları ve bir şablon motoru var, ama şablonlu e-posta yalnız ajan durum değiştirirken elle seçerse gidiyor (`apps/api/src/routes/tickets.ts:280-373`). Ticket kurallarının eylemleri yalnız atama, öncelik ve etiketten ibaret (`apps/api/src/services/tickets/ticket-rule-matching.ts:41-46`); "e-posta gönder" eylemi yok. E-postadan ya da widget'tan ticket açılınca hiçbir bildirim tetiklenmiyor [H5]. LiveChat HelpDesk'te "Automatically send a reply" seçeneği var.
- **Yapılmazsa:** E-postalar tekrarlanır, kopya ticket'lar oluşur, "kimse ilgilenmiyor" algısı yerleşir.
- **Bağımlılıklar:** HD-01 (giden e-posta altyapısı ve ticket'taki kayıt), HD-03 (oyuncu bu onaya cevap verirse aynı ticket'a düşmeli; otomatik yanıt döngüsü engellenmeli), HD-05 (mesajdaki beklenen süre), AU-03 (ticket yaşam döngüsü tetikleyicileri), ID-04 (mesai ve saat dilimi).
- **Netleştirilecek sorular:**
  1. Hangi kaynaktan açılan ticket'larda gönderilsin? Önerilen varsayılan: e-postadan ve widget çevrimdışı formundan açılanlarda. Ajanın sohbetten açtığı ticket'ta gönderilmesin, çünkü oyuncu sohbette zaten bilgilendirildi.
  2. Mesai dışında farklı bir metin gitsin mi? Önerilen varsayılan: evet, ayrı bir "mesai dışı" şablonu gitsin ("talebiniz alındı, ekibimiz 09:00 itibarıyla dönüş yapacak").
  3. E-posta hangi dilde gitsin? Önerilen varsayılan: kiracının varsayılan dilinde (Türkçe). Oyuncunun dili biliniyorsa o dilde (WG-02).

### HD-05 — Ticket ilk yanıt SLA'sı
- **Ne:** Ticket'lar için bir "ilk yanıt" süre hedefi (ör. 4 saat) tanımlanıp ölçülecek. Hedef aşılınca ihlal kaydı ve uyarı oluşacak. Ticket listesinde kalan süre, raporlarda ortalama ilk yanıt süresi görünecek.
- **Neden gerekli:** E-postayla gelen çekim ve KYC talepleri sıraya gömülür; kimse fark etmeden günler geçebilir. Lisans otoriteleri şikâyetlere belirli bir sürede yanıt verilmesini ister; operatörün de oyuncu güveni için bunu izlemesi gerekir.
- **Gerekçe / kanıt:** SLA altyapısı hazır: "ilk yanıt dakikası" hedefi tanımlı (`apps/api/prisma/schema.prisma:2779-2790`), ihlal kayıtları ticket'ları da kapsıyor (`schema.prisma:2805-2827`) ve düzenli tarama işi çalışıyor (`apps/api/src/services/scheduler/jobs.ts:146-149`). Ancak ticket için yalnız çözüm süresi ölçülüyor. İlk yanıt bilinçli olarak ölçülmüyor, çünkü ticket'a yanıt verilemiyor (`apps/api/src/services/sla/sla-sweep.ts:177-181`, `services/tickets/ticket-service.ts:433-439`) [H9]. Ayrıca hem sohbet hem ticket için tek bir "ilk yanıt" hedefi kullanılıyor; oysa sohbet dakikayla, ticket saatle ölçülmeli.
- **Yapılmazsa:** E-posta talepleri günlerce bekler ve gecikme rapora yansımaz. Resmi şikâyet süreleri kaçırılır.
- **Bağımlılıklar:** HD-01 (zorunlu, çünkü yanıt olmadan süre ölçülemez), HD-04 (otomatik onay ilk yanıt sayılmaz), ID-04 (mesai saatleri ve saat dilimi), IN-10 (ihlal bildirimi), RP-01 (raporda ajan ve ekip filtresi).
- **Netleştirilecek sorular:**
  1. Sohbet ve ticket için ayrı hedef olsun mu? Önerilen varsayılan: evet. Sohbet dakika, ticket saat cinsinden ayrı alanlarda tanımlansın.
  2. Önceliğe göre farklı hedefler olsun mu? Önerilen varsayılan: evet. "Acil" için ayrı bir hedef (ör. 1 saat), diğerleri için tek bir hedef (ör. 8 iş saati) olsun.
  3. Ne "ilk yanıt" sayılsın? Önerilen varsayılan: ajanın oyuncuya gönderdiği ilk yanıt. İç not, otomatik onay ve durum bildirimi sayılmasın. Sohbetten açılan ticket'larda ilk yanıt sohbette verilmiş sayılsın ve ticket SLA'sı uygulanmasın.

---

> Bu parça `04-gerekceler-ve-sorular.md` dosyasının 7–12. bölümleridir. Maddelerin kimlikleri ve öncelikleri `03-eklenebilecekler.md` ile aynıdır.
> Kısaltmalar: **LC** = LiveChat keşfi, **CB** = ChatBot.com keşfi, **nexa** = SiyahTuş kodu (`nexa-main`). Kod yolları repo köküne göredir. Köşeli parantezdeki kodlar (`[E-23]`, `[R17]`…) `kaynaklar/eksikler.md` satırlarıdır.
> Roller: Kurucu → Yönetici → Ekip Lideri → Ekip Üyesi. Kimin neyi göreceği RL-02 (izin matrisi) ile sonradan ayarlanabilir; aşağıdaki rol önerileri yalnızca varsayılandır.

---

## 7. Widget ve sohbet ayarları (WG)

### WG-01 — Pre-chat formu: aç/kapat ve yerleşik alanların zorunluluğu
- **Ne:** Sohbet öncesi formun şirket bazında açılıp kapatılabilmesi ve yerleşik alanların (ad, kullanıcı adı, e-posta, ilk mesaj) her biri için "göster / zorunlu" seçimi.
- **Neden gerekli:** iGaming destek ekipleri iki farklı ihtiyaçla gelir. Bazı operatörler oyuncunun kullanıcı adını sohbetin ilk saniyesinde ister, çünkü yatırım/çekim sorusunda başka hiçbir şey yapılamaz. Bazıları ise giriş yapmamış ziyaretçinin ("site açılmıyor", "üye olmak istiyorum") hiç form doldurmadan yazabilmesini ister. Bugün tek bir sabit davranış var ve şirket bunu değiştiremiyor.
- **Gerekçe / kanıt:** LC'de form tek tuşla kapanıyor, Ad/E-posta varsayılan olarak zorunlu değil [Forms]. nexa'da form her zaman açılıyor ve dört alanın dördü de zorunlu (`apps/widget/src/widget.ts:1123-1138`, kodda "All four fixed fields are required (owner, 2026-10-14)" notu). Bu senin bugünkü kararın. Madde bu kararı bozmuyor, şirket ayarına çeviriyor. Kullanıcı adı alanı ve kaydı repoda henüz commit'lenmemiş durumda (ID-03 işi).
- **Yapılmazsa:** Giriş yapmamış ziyaretçiler dört zorunlu alanla karşılaşıp çıkar ve kayıt öncesi sorular kaybolur. Kullanıcı adını hiç istemeyen bir operatör widget'ı kullanamaz.
- **Bağımlılıklar:** ID-03 (üye tanıma, kullanıcı adı alanı), AI-02 (gün içi hafıza kullanıcı adına dayanıyor), WG-04 (ek alan tipleri), WG-14 (kaydedilmemiş değişiklik uyarısı).
- **Netleştirilecek sorular:**
  1. Şirket ayarının varsayılanı ne olsun? Önerilen varsayılan: bugünkü davranış (form açık, dört alan zorunlu) varsayılan kalsın. Şirket bunu değiştirebilsin.
  2. Kullanıcı adı alanı kapatılabilsin mi? Önerilen varsayılan: kapatılabilsin. Ama kapatılırken panelde "Üye tanıma ve gün içi hafıza bu alan olmadan çalışmaz" uyarısı çıksın.
  3. Operatör sitesi, giriş yapmış oyuncunun kullanıcı adını widget'a kendisi göndersin mi (oyuncu yazmasın)? Önerilen varsayılan: evet, ama yalnızca imzalı biçimde (site sunucusunun ürettiği doğrulanabilir kimlik). Karar ID-03'te kesinleşir. WG-01 imzalı kullanıcı adı geldiğinde formda o alanı atlar.

### WG-02 — Widget dili panelden seçilebilir ve tarayıcı dili algılanır
- **Ne:** Widget dilinin (Türkçe, İngilizce…) panelden seçilmesi. "Otomatik" seçilirse oyuncunun tarayıcı dili kullanılır. Kurulum kodunu elle değiştirmek gerekmez.
- **Neden gerekli:** Türk operatörün oyuncusu widget'ı İngilizce görüyor. Bu pilotun ilk gününde görülen bir kalite sorunu. Ayrıca çok dilli operatörlerde (TR + EN + RU…) oyuncunun kendi dilinde karşılanması güven verir.
- **Gerekçe / kanıt:** LC'de 48 dilli, aranabilir dil seçici var. nexa'da dil yalnızca kurulum kodundaki `language` parametresinden geliyor (`apps/widget/src/loader.ts:27,301`). `resolveWidgetLocale` boş değerde doğrudan İngilizce'ye düşüyor, tarayıcı dili okunmuyor (`apps/widget/src/i18n.ts:29-32`). Panelde dil ayarı yok (`packages/types/src/widget.ts`, `WidgetAppearance`). Ek bulgu: oyuncuya giden sohbet dökümü e-postası da her zaman İngilizce gidiyor, çünkü sunucu oyuncunun dilini bilmiyor (`apps/api/src/services/chat/chat-service.ts`, `#emailTranscript`).
- **Yapılmazsa:** Türk pilotunda widget İngilizce açılır. Her müşteri için kurulum kodunu elle düzeltmek gerekir ve unutulur.
- **Bağımlılıklar:** AI-30 (AI'ın oyuncunun dilinde yanıt vermesi; widget dili ona ipucu olur), WG-05 (metin özelleştirme dil başına yapılır), WG-06 (döküm e-postasının dili).
- **Netleştirilecek sorular:**
  1. Öncelik sırası ne olsun? Önerilen varsayılan: (1) kurulum kodunda dil açıkça yazılmışsa o, (2) panel ayarı "Otomatik" ise oyuncunun tarayıcı dili (destekleniyorsa), (3) desteklenmiyorsa panelde seçilen yedek dil. Yeni şirketlerde yedek dil Türkçe olsun.
  2. Bugünkü 8 dile (en, tr, de, fr, es, it, pt, ar) ek dil gerekiyor mu (ör. Rusça, Azerice)? Önerilen varsayılan: pilotta mevcut 8 dil yeterli, ek diller pilot operatörün oyuncu kitlesine göre eklensin.

### WG-03 — Ajan yanıt vermezse sohbeti başka ajana aktarma ve "inactive" durumu
- **Ne:** Sohbet bir ajana atandıktan sonra ajan belirli bir sürede (ör. 3 dk) ilk yanıtı vermezse sohbet otomatik olarak başka uygun ajana aktarılır. Belirli süre mesaj gelmeyen sohbet de "inactive" olur ve ajanın eşzamanlı sohbet limitinden düşer.
- **Neden gerekli:** iGaming'de en sık temas "param yatmadı" ve "çekimim nerede". Bu oyuncu beklerken sabırsızlanır ve dakikalar içinde başka kanala (Telegram, şikâyet sitesi) geçer. Ajan molaya çıktığında ya da tarayıcıyı kapattığında atanmış sohbet sahipsiz kalıyor.
- **Gerekçe / kanıt:** LC'de üç ayar var: "ajan 3 dk yanıt vermezse aktar", "10 dk mesaj yoksa inactive", "15 dk sonra kapat" (Settings › Inactivity timeouts). nexa'da yalnızca otomatik kapatma var (`apps/api/src/services/chat/chat-timeout.ts`). Ajanın bağlantısı koptuğunda durumu da değişmiyor: gerçek zamanlı sunucuda bağlantı kopunca "çevrimdışı" yapan kod yok (`apps/rtm/src`). Aktarma nedenleri listesinde `agent_disconnected` tanımlı ama hiçbir yerde kullanılmıyor (`packages/types/src/domain.ts:64-70`). Kısacası tarayıcısını kapatan ajan "sohbet kabul ediyor" görünmeye ve yeni sohbet almaya devam ediyor.
- **Yapılmazsa:** Yanıtsız kalan oyuncu kaybolur, şikâyet artar. Ayrıca AI'ın "sizi finans ekibine aktarıyorum" dediği oyuncu hiç yanıt alamaz ve AI devrinin değeri sıfırlanır.
- **Bağımlılıklar:** AU-01 (aktarma aynı ekip/kuyruk içinde yapılır), AI-11 (devirden sonra AI susar; aktarma insanlar arasında olur), RP-02 (kaçan sohbet raporu), RP-03 (ajan aktivitesi), WG-08 (yanıt gecikirse e-posta isteme).
- **Netleştirilecek sorular:**
  1. Varsayılan süreler ne olsun? Önerilen varsayılan: aktarma 3 dk, inactive 10 dk, kapatma mevcut ayar. Şirket değiştirebilir. Panel "aktarma < inactive < kapatma" sırasını zorlar.
  2. Aktarılacak uygun ajan yoksa ne olsun? Önerilen varsayılan: sohbet aynı ekibin kuyruğunun en önüne alınır, Ekip Lideri bildirim alır ve yanıt vermeyen ajan otomatik olarak "sohbet kabul etmiyor" durumuna çekilir.
  3. Süre AI'dan insana devredilen sohbetlerde de işlesin mi? Önerilen varsayılan: evet. Süre devrin yapıldığı andan başlar.

### WG-04 — Form alan tipleri ve konu/departman seçimiyle ekibe yönlendirme
- **Ne:** Formlara seçim listesi, açılır liste ve çoklu seçim tiplerinin eklenmesi. Ayrıca "konu seçimi" alanı: oyuncunun seçtiği konu sohbeti doğrudan ilgili ekibe (Finans, KYC, Bonus…) yönlendirir. Var olan soruların düzenlenebilmesi ve sıralanabilmesi.
- **Neden gerekli:** iGaming destek merkezleri konuya göre ayrılmış ekiplerle çalışır. Bir yatırım sorusunun bonus ekibine düşmesi hem süre kaybıdır hem yanlış bilgi riskidir. AI kapalıyken ya da AI'dan önce oyuncuya "Konunuz nedir?" diye sormak en ucuz yönlendirmedir.
- **Gerekçe / kanıt:** LC'de choice list, dropdown, multiple choice ve "group selection" (departman seç → takıma yönlendir) var [Forms]. nexa'da yalnızca metin, sayı, evet/hayır ve tarih tipleri var (`packages/types/src/custom-fields.ts:82`). Sorular eklenip silinebiliyor ama düzenlenemiyor (`apps/web/src/features/settings/ChatFormsSettings.tsx`). Yönlendirme motoru "widget'tan açık ekip isteği" kavramını zaten destekliyor (`apps/api/src/services/routing/routing-service.ts:32`, `requestedGroupId`). Ama widget'ın sohbet başlatma yolu bunu hiç göndermiyor (`apps/api/src/routes/customer.ts:840`).
- **Yapılmazsa:** Tüm sohbetler genel kuyruğa düşer ve ajanlar elle aktarır. Sorumlu oyun talebi eğitimsiz bir ajana gidebilir.
- **Bağımlılıklar:** AU-01 (konu → kuyruk eşlemesi burada tanımlanır), WG-01, RP-01 (konu filtresi), AI-05 (AI konu tespiti; iki kaynak çakışırsa hangisinin kazanacağı).
- **Netleştirilecek sorular:**
  1. AI açıkken de konu seçimi sorulsun mu? Önerilen varsayılan: AI açık şirketlerde varsayılan kapalı olsun, konuyu AI tespit etsin. AI kapalı ya da "önce insan" çalışan şirketlerde açık olsun.
  2. Oyuncuya hangi konu adları gösterilsin? Önerilen varsayılan: "Para yatırma", "Para çekme", "Hesap doğrulama (KYC)", "Bonus ve kampanyalar", "Hesap kapatma / ara verme / limit", "Teknik sorun", "Şikâyet", "Diğer". "Sorumlu Oyun" adı oyuncuya gösterilmesin, içeride bu kuyruğa eşlensin.

### WG-05 — Widget metinlerini özelleştirme ve kuyrukta tahmini bekleme süresi
- **Ne:** Çevrimdışı mesajı, kuyruk mesajı, mesaj kutusu yer tutucusu gibi widget metinlerinin şirket tarafından dil başına değiştirilebilmesi. Kuyruktaki oyuncuya sıra numarasının yanında tahmini bekleme süresinin gösterilmesi.
- **Neden gerekli:** Operatörün kendi ses tonu var ("Değerli üyemiz…"). Sabit "Sırada 3. sıradasınız" metni de oyuncuya ne kadar bekleyeceğini söylemiyor. Bekleme süresini bilmeyen oyuncu sekmeyi kapatıp tekrar yazar, kuyruk şişer.
- **Gerekçe / kanıt:** LC'de offline, kuyruk (`%number%`, `%minutes%`) ve placeholder metinleri özelleştirilebiliyor. nexa'da bu metinler widget koduna sabit yazılmış (`apps/widget/src/locales/tr.ts:9-10,27`). Panelden yalnızca karşılama başlığı ve metni değişiyor (`packages/types/src/widget.ts`, `welcome_title/welcome_text`).
- **Yapılmazsa:** Widget operatörün markasına yabancı kalır. Kuyruk terki artar (RP-04 bunu ölçecek ama düzeltemeyecek).
- **Bağımlılıklar:** WG-02 (dil başına metin), RP-04 (bekleme süresi tahmini aynı veriden gelir), AU-01 (kuyruk ekip bazlı olursa tahmin de ekip bazlı olmalı).
- **Netleştirilecek sorular:**
  1. Tahmini bekleme süresi gösterilsin mi? Önerilen varsayılan: evet, ama yalnızca aralık olarak ("yaklaşık 3–5 dk") ve son 7 günde yeterli veri varsa. Veri azsa yalnızca sıra numarası gösterilsin. Kesin süre sözü verilmesin (AI'daki söz verme yasağıyla aynı mantık).

### WG-06 — Oyuncuya sohbet dökümü e-postası ve tüm dökümleri bir adrese iletme
- **Ne:** Oyuncunun widget'tan "dökümü e-postama gönder" diyebilmesi. Şirketin, kapanan tüm sohbetlerin dökümünü belirlediği adreslere (ör. uyum/arşiv kutusu) otomatik iletebilmesi.
- **Neden gerekli:** İtiraz ve şikâyet süreçlerinde oyuncu ve operatör "ne konuşulmuştu?" sorusuna kanıt ister. Lisans otoriteleri (CGA, MGA) şikâyet kayıtlarının saklanmasını bekler ve bazı operatörler tüm yazışmaları ayrı bir arşive kopyalar.
- **Gerekçe / kanıt:** LC'de widget'ta "Send transcript" ve Settings › Transcript forwarding var. nexa'da durum beklenenden farklı: sohbet kapanınca döküm, e-postası biliniyorsa oyuncuya **otomatik ve sorulmadan** gidiyor. Bu e-posta her zaman İngilizce (`apps/api/src/services/chat/chat-service.ts`, `#emailTranscript`; `services/notifications/chat-transcript.ts`). Oyuncunun kendisinin istemesi ya da şirketin sabit bir adrese iletmesi mümkün değil. İç notların oyuncuya gitmemesi garanti altında.
- **Yapılmazsa:** Şirketin uyum arşivi elle tutulur. Öte yandan bugünkü otomatik gönderim, pre-chat'te başkasının e-postasını yazan birine finansal yazışmanın gitmesine yol açabilir.
- **Bağımlılıklar:** WG-02 (e-posta dili), WG-01 (e-posta alanı), AI-26 (dökümde hassas verinin maskeli olması), AR-04 (ajan tarafında döküm dışa aktarma).
- **Netleştirilecek sorular:**
  1. Oyuncuya döküm otomatik mi gitsin, yalnızca oyuncu isterse mi? Önerilen varsayılan: şirket ayarı olsun, varsayılanı "yalnızca oyuncu isterse" olsun. Bu varsayılan mevcut şirketler (pilot dahil) için de geçerli olsun ve değişiklik duyurulsun. Otomatik gönderimi isteyen şirket ayarı açabilsin.
  2. İletme adreslerine giden dökümde iç notlar olsun mu? Önerilen varsayılan: hayır. Şirket açarsa yalnızca kendi doğrulanmış alan adındaki adreslere iç notlu döküm gitsin. En fazla 5 adres, ayarı yalnızca Kurucu ve Yönetici değiştirsin.

### WG-07 — Manuel atama modu (herkese bildirim, ilk alan alır)
- **Ne:** Otomatik dağıtım yerine, kuyruktaki sohbetin ekipteki herkese bildirildiği ve ilk tıklayan ajanın üstlendiği mod.
- **Neden gerekli:** VIP masaları ve küçük gece vardiyaları gibi bazı iGaming ekipleri ajanların sohbeti kendilerinin seçmesini ister (ör. "bu oyuncuyu ben tanıyorum"). Ekip Lideri dengesizliği gözle yönetir.
- **Gerekçe / kanıt:** LC'de Chat settings altında "Manual selection" seçeneği var. nexa'da dağıtım her zaman otomatik (`routing-service.ts`). Manuel mod ayarı kodda yok, ama kuyruktan "Bana ata" eylemi zaten var (Traffic ve Inbox).
- **Yapılmazsa:** Manuel çalışmak isteyen ekipler otomatik atamayı kapatıp herkesi "kabul etmiyor" durumuna alarak sistemi zorlar. Bu da raporları bozar.
- **Bağımlılıklar:** AU-01 (mod kuyruk/ekip bazında seçilir), IN-10 (bildirim tercihleri), WG-03 (manuel modda "kimse almadı" süresi).
- **Netleştirilecek sorular:**
  1. Mod şirket genelinde mi, ekip bazında mı seçilsin? Önerilen varsayılan: ekip bazında. Varsayılan otomatik olsun. Sorumlu Oyun kuyruğu manuel moda alınamasın (sohbetin beklemeden alınması gerekir).

### WG-08 — "E-posta iste": ajan X dakika yanıt vermezse ya da çevrimdışıyken
- **Ne:** Atanan ajan belirli sürede yanıt vermezse veya kimse çevrimiçi değilse widget'ın oyuncuya "size e-postayla dönelim" deyip iletişim bilgisi istemesi.
- **Neden gerekli:** Oyuncu ayrılsa bile konuşma kaybolmaz ve ekip sonra dönebilir. iGaming'de bu, yoğun saatlerde (maç saatleri, hafta sonu) yanıtsız kalan "param yatmadı" sohbetlerini kurtarır.
- **Gerekçe / kanıt:** LC'de iki senaryo var: "When not responding" (1–60 dk) ve "When offline". nexa'da çevrimdışı formu yalnızca şirket formda ticket/prospect alanı tanımladıysa çıkıyor (`apps/widget/src/widget.ts:1011-1019`). Yanıt gecikmesine bağlı bir zamanlayıcı yok.
- **Yapılmazsa:** Yanıtsız kalan oyuncuya dönüş yolu olmaz. Konuşma "kapandı" görünür ama oyuncu çözüm almamıştır.
- **Bağımlılıklar:** WG-03 (aynı "ilk yanıt yok" zamanlayıcısını kullanır), WG-09, HD-01/HD-03 (dönüş e-postasının ticket olarak yanıtlanması), ID-03.
- **Netleştirilecek sorular:**
  1. Kullanıcı adı bilinen oyuncudan da e-posta istensin mi? Önerilen varsayılan: hayır. Kullanıcı adı varsa "Size üyelik hesabınız üzerinden / bu sohbetten dönüş yapılacak" mesajı yeterli. E-posta yalnızca kimliği bilinmeyen ziyaretçiden istensin.

### WG-09 — Uygunluk ayarı: "her zaman" / "yalnızca ajan varken"
- **Ne:** Oyuncunun sohbet başlatabilmesinin her zaman mı, yalnızca sohbet kabul eden ajan varken mi mümkün olacağını belirleyen açık bir ayar.
- **Neden gerekli:** AI'ın 7/24 ilk yanıtı verdiği bir modelde widget gece de açık olmalı. AI kullanmayan bir operatör ise gece "mesaj bırakın" ekranı göstermek isteyebilir. Bugün bu davranış ayarla değil, tesadüfi koşullarla belirleniyor.
- **Gerekçe / kanıt:** LC'de "Always" ve "Only when agents are accepting chats" seçenekleri var. nexa'da bu örtük çalışıyor: çevrimdışı formu yalnızca form alanı tanımlıysa çıkıyor (`widget.ts:1011-1019`). Daha önemli bulgu: widget'a "çevrimiçi" bilgisi yalnızca insan ajan sayısından gidiyor (`apps/api/src/routes/customer.ts:549,609`, `online: agentsOnline > 0`). Yani AI aktif olsa bile insan yokken ve çevrimdışı formu tanımlıyken oyuncu AI ile değil, "mesaj bırakın" formuyla karşılaşıyor.
- **Yapılmazsa:** Gece saatlerinde AI devre dışı kalır ve en yoğun bahis saatlerinde (gece maçları) oyuncu forma yönlendirilir.
- **Bağımlılıklar:** AI-12 (mesai dışı devir davranışı), WG-08, WG-05 (çevrimdışı metni), AI-29.
- **Netleştirilecek sorular:**
  1. AI açıkken "yalnızca ajan varken" modu ne anlama gelsin? Önerilen varsayılan: AI açıksa widget her zaman açık kalsın, mod yalnızca AI'ın insana devretmek istediği anı etkilesin (insan yoksa AI mesai dışı mesajını verir ve talep kaydı oluşturur). AI kapalı şirketlerde varsayılan "her zaman" olsun.

### WG-10 — Launcher görünürlük modları ve widget logosu
- **Ne:** Sohbet balonunun (launcher) üç görünürlük modu: her zaman görünür / site kendi düğmesiyle açana kadar gizli / hiç görünmez. Ayrıca widget başlığında markanın logosunun gösterilmesi.
- **Neden gerekli:** Birçok bahis sitesi menüsünde kendi "Canlı Destek" düğmesini kullanır ve köşedeki balonu istemez (mobilde kupon/bahis düğmeleriyle çakışır). Logo da oyuncuya resmî kanalda olduğunu gösterir. Sahte destek hesaplarının yaygın olduğu bu sektörde bu önemli bir güven işaretidir.
- **Gerekçe / kanıt:** LC'de üç mod ve logo yükleme var. nexa'da JS ile açma/kapatma API'si var (`apps/widget/src/loader.ts:55-57,255`, `open/close/destroy`) ama balonu gizleme modu yok. Markanın `logo_url` alanı var (`apps/web/src/features/settings/Brands.tsx:24`, `schema.prisma` `logoUrl`) ama widget bunu hiç kullanmıyor.
- **Yapılmazsa:** Operatör balonu gizlemek için kendi CSS hilesini yazar. Bu her widget güncellemesinde kırılır.
- **Bağımlılıklar:** WG-13 (kurulum rehberinde "kendi düğmeni bağla" örneği), WG-15.
- **Netleştirilecek sorular:** Yok.

### WG-11 — Puanlamaya yorum ekleme
- **Ne:** Oyuncu sohbeti "iyi / iyi değil" diye puanladıktan sonra isteğe bağlı kısa bir yorum yazabilir. Yorum ajanın ekranında, arşivde ve raporlarda görünür.
- **Neden gerekli:** "İyi değil" puanı tek başına neyin yanlış gittiğini söylemez. iGaming'de olumsuz yorumlar çoğu zaman bir ödeme sorununun ya da sorumlu oyun sinyalinin ("hayatımı mahvettiniz") ilk işaretidir. Ekip Lideri bu sohbetleri öncelikle incelemelidir.
- **Gerekçe / kanıt:** LC'de puandan sonra yorum alanı var. nexa'da veritabanı ve API yorumu zaten kabul ediyor (`apps/api/src/routes/customer.ts:95-98` `comment`, `schema.prisma` `Rating.comment`). Yorum alanını gösteren tek yer olan widget bunu göstermiyor. Raporlarda ve Inbox'ta puan yorumu görünmüyor [R25, E14].
- **Yapılmazsa:** Müşteri memnuniyeti yalnızca sayı olarak kalır, nedenleri bilinmez.
- **Bağımlılıklar:** AR-03 (arşivde puan ve yorum), AU-03 ("sohbet puanlandı" tetikleyicisi), AI-24 (kötü puanlı sohbetler QA kuyruğuna), AI-27 (yorumdaki sorumlu oyun sinyali bayrağa dönüşebilir).
- **Netleştirilecek sorular:** Yok.

### WG-12 — Widget içinde bilgi bankası araması
- **Ne:** Widget'ta "Yardım" sekmesi: oyuncu sohbet başlatmadan önce yardım makalelerinde arama yapabilir ("Papara ile nasıl yatırım yapılır?").
- **Neden gerekli:** Yatırım yöntemleri, bonus kuralları ve KYC belgeleri gibi tekrar eden sorular iGaming destek hacminin büyük kısmını oluşturur. Oyuncunun cevabı kendisinin bulması hem AI maliyetini hem ajan yükünü düşürür.
- **Gerekçe / kanıt:** LC'de widget içi KB "coming soon" durumunda. nexa'nın zaten herkese açık bir bilgi bankası var (`apps/api/src/routes/public-kb.ts`, yalnızca yayınlanmış makaleler). Bu farklılaştırıcı olabilir. Ancak bu uçlarda arama yok (yalnızca listeleme ve tek makale), widget'ta da KB yok.
- **Yapılmazsa:** Her basit soru sohbet açar. AI günlük kotası ve ajan zamanı bu sorulara harcanır.
- **Bağımlılıklar:** AI-14 (tek bilgi deposu ve "herkese açık KB" işareti), AI-29 (her ekranda "insanla görüş"), WG-02 (makale dili).
- **Netleştirilecek sorular:**
  1. Widget araması hangi içeriği göstersin? Önerilen varsayılan: yalnızca yayınlanmış herkese açık KB makaleleri. AI'ın iç bilgileri (ödeme tablosu, iç prosedürler) gösterilmesin. AI-14 tamamlanınca "herkese açık" işaretli kaynaklar da eklensin.
  2. AI açıkken ayrı bir arama sekmesi gerekli mi? Önerilen varsayılan: evet, "Yardım" sekmesi olarak. Ama sohbet düğmesi her zaman bir tık uzakta kalsın.

### WG-13 — Kurulum: sihirbazda kod + kopyala, platform eklentileri
- **Ne:** İlk kurulum sihirbazında widget kodunun "Kopyala" düğmesiyle gösterilmesi. Yaygın site altyapıları için hazır kurulum yolları (WordPress eklentisi, Google Tag Manager şablonu vb.).
- **Neden gerekli:** Bir operatörün ilk deneyimi "kodu nereden alacağım?" sorusuyla başlamamalı. iGaming operatörleri çoğunlukla WordPress yerine platform sağlayıcının (BetConstruct, EveryMatrix vb.) içerik yönetim paneline ya da GTM'e kod ekler. Kurulum rehberi bu gerçeğe göre yazılmalı.
- **Gerekçe / kanıt:** LC'de sihirbazda kod kutusu + "Copy code" ve 14 platform eklentisi var [A2, A8]. nexa'da sihirbaz yalnızca alan adı soruyor (`apps/web/src/features/onboarding/OnboardingWizard.tsx`). Kod ve kopyalama yalnızca Ayarlar'da (`features/settings/WebsiteWidgets.tsx:298-306`). "Platform" seçeneği yalnızca bir etiket (`apps/api/src/services/websites/website-service.ts:26-31`).
- **Yapılmazsa:** Kurulum için destek talebi açılır ve ilk deneyim yavaşlar. Ama pilotta elle kurulum yapılabildiği için engel değil.
- **Bağımlılıklar:** WG-15 (kurulum rehberi linki), KN-06 (platform bazlı rehberler).
- **Netleştirilecek sorular:**
  1. Hangi kurulum yolları öncelikli? Önerilen varsayılan: (1) sihirbazda kod + kopyala, (2) GTM için yazılı rehber, (3) pilot operatörün kullandığı iGaming platformunun içerik paneli için yazılı rehber. WordPress eklentisi talep gelene kadar ertelensin.

### WG-14 — Ayarlar sayfalarında kaydedilmemiş değişiklik uyarısı
- **Ne:** Ayarlar'da bir formu değiştirip kaydetmeden başka bölüme geçildiğinde "Kaydedilmemiş değişiklikler var" uyarısı çıkması.
- **Neden gerekli:** Yönetici widget metnini ya da zaman aşımını düzenleyip yanlışlıkla başka bölüme tıklarsa emeği sessizce kaybolur. Daha kötüsü, "kaydettim" sanıp canlıda eski ayarla çalışır.
- **Gerekçe / kanıt:** LC'deki tutarsız uyarı LC'nin bilinen hatalarından biri. nexa'da altyapı hazır (`apps/web/src/lib/dirty-guard.tsx`, `useLeaveGuard`, `confirmLeave`) ama yalnızca Senaryo düzenleyicisinde kullanılıyor (`features/playbook/SkillEditor.tsx:279`). Ayarlar menüsündeki bağlantılar uyarıyı çağırmıyor (`features/settings/SettingsNav.tsx:181-229`).
- **Yapılmazsa:** Yapılan ayar değişiklikleri sessizce kaybolur.
- **Bağımlılıklar:** GV-06 (tutarlı kaydetme kalıbı). Bu bölümde yeni eklenen her ayar formu (WG-01, WG-03, WG-05, WG-06, WG-09…) bu korumayla birlikte gelmeli.
- **Netleştirilecek sorular:** Yok.

### WG-15 — `<noscript>` yedek linki ve kurulum rehberi linki
- **Ne:** Kurulum koduna, JavaScript kapalıysa görünen "Bizimle sohbet edin" bağlantısı (barındırılan sohbet sayfasına) eklenmesi. Kurulum ekranlarına "Kurulum rehberi" bağlantısı konması.
- **Neden gerekli:** Küçük ama ucuz bir güvenlik ağı. Bazı oyuncular katı tarayıcı ayarlarıyla ya da reklam engelleyiciyle gelir. Rehber linki de kurulum destek talebini azaltır.
- **Gerekçe / kanıt:** LC'nin kurulum kodunda `<noscript>` ve rehber linki var [A6, A9]. nexa'da yok. Kod üreticisi yalnızca iki `<script>` üretiyor (`website-service.ts:184-200`). Barındırılan sohbet sayfası ise zaten var (`apps/widget/chat.html`).
- **Yapılmazsa:** Küçük bir oyuncu kesimi destek kanalına hiç ulaşamaz.
- **Bağımlılıklar:** WG-13.
- **Netleştirilecek sorular:**
  1. SiyahTuş'un kendi yardım makaleleri nerede yayımlanacak? Önerilen varsayılan: SiyahTuş'un kendi çalışma alanındaki herkese açık KB (nexa'nın kendi KB özelliği). Ayrı bir yardım sitesi kurulmasın.

---

## 8. Engage / kampanyalar (EN)

### EN-01 — Risk bayraklı oyuncuya kampanya/bonus gösterilmemesi
- **Ne:** Sorumlu oyun, reşit olmama şüphesi, kendini dışlama (self-exclusion) gibi bir risk bayrağı taşıyan oyuncuya hiçbir kampanya kartı, bonus mesajı veya "yatırım yap" yönlendirmesi gösterilmez. Bu kural kiracı tarafından kapatılamaz.
- **Neden gerekli:** Bu bir uyum kuralı. Sorumlu oyun sinyali veren ya da hesabını kapattıran oyuncuya bonus göstermek UKGC mantığında açık ihlal sayılır ve CGA/MGA kurallarının ruhuna aykırıdır. Operatörü lisans riskine, SiyahTuş'u da itibar riskine sokar. "Bu yazılım bağımlı oyuncuya bonus gösteriyor" cümlesi bir satış ekibinin duymak isteyeceği son şeydir.
- **Gerekçe / kanıt:** Sektör araştırmasındaki guardrail **G4**: "Risk bayrağı olan konuşmada bonus, promosyon, 'yatırım yap' yönlendirmesi yasak" (`kaynaklar/igaming-ai-arastirma.md` §4.2). G1 kendini dışlama talebinde promosyon teklifini açıkça yasaklıyor (niyet kataloğu #11). LC ve CB'de böyle bir kavram yok, çünkü bu sektöre özgü. nexa'da kampanya teslimi yalnızca "yasaklı müşteri" ve "açık sohbet var mı" diye bakıyor (`apps/api/src/services/campaigns/campaign-delivery.ts:151-160`). Risk bayrağı kavramı henüz yok (AI-27'de geliyor).
- **Yapılmazsa:** Kendini dışlama talebi veren oyuncu ertesi gün "%100 yatırım bonusu" kartı görür. Bu, ekran görüntüsüyle şikâyet sitelerine ve düzenleyiciye gidecek türden bir olaydır.
- **Bağımlılıklar:** AI-27 (bayrakların kaynağı; bu madde onları tüketir), ID-03 (bayrağın aynı oyuncunun her cihazında geçerli olması üye tanımaya bağlı), AI-08 (AI'ın sohbet içinde bonus önermemesi aynı kuralın sohbet tarafı), EN-02 (zengin kart ve bot butonları da bu kapıdan geçer), EN-05 (raporda "bastırılan gösterim" sayısı), KN-01 (WhatsApp proaktif mesajları da aynı kurala tabi).
- **Netleştirilecek sorular:**
  1. Bayrak ne zaman ve kim tarafından kaldırılır? Önerilen varsayılan: otomatik geri açılma olmasın. Bayrağı yalnızca yetkili bir kişi (Sorumlu Oyun ekibinden Ekip Lideri veya Yönetici) gerekçe yazarak kaldırsın ve bu işlem denetim kaydına yazılsın. Kendini dışlama bayrağı operatör kaldırana kadar kalıcı olsun.
  2. Hangi bayrak türleri promosyonu engeller? Önerilen varsayılan: sorumlu oyun, reşit olmama şüphesi ve kendini dışlama **kilitli** olsun (kiracı kapatamaz). Fraud bayrağı varsayılan olarak bonus gösterimini engellesin ama kiracı kapatabilsin. Şikâyet bayrağı varsayılan olarak engellemesin.
  3. Bayrak yalnızca o markada mı, şirketin tüm markalarında mı geçerli? Önerilen varsayılan: şirketin tüm markalarında. Aynı oyuncu operatörün birden fazla sitesinde olabilir.

### EN-02 — Zengin kampanya kartı ve aynı kartın bot mesajlarında kullanılması
- **Ne:** Kampanya kartına başlık, görsel ve en fazla 5 buton eklenmesi (mesaj gönder / bağlantı aç / kupon kopyala). Aynı kart ve buton yapısı AI ve kural botunun mesajlarında da kullanılabilir.
- **Neden gerekli:** Düz metin bir kart iGaming'de neredeyse hiç tıklanmaz. "Yatırım sorunu mu yaşıyorsunuz? [Yardım al]" ya da "Hoş geldin bonusu koşulları [Kuralları oku]" gibi butonlu kartlar hem dönüşümü hem yönlendirmeyi kolaylaştırır. AI tarafında "Hangi yöntemle yatırdınız? [Papara] [Havale/EFT] [Kripto]" butonları teşhis sorularını hızlandırır (AI-04).
- **Gerekçe / kanıt:** LC'de kart tipi, görsel (2300×1500), başlık 80 + gövde 220 karakter, en fazla 5 buton ve 10 hazır şablon var [E-23…E-29]. CB'de buton aksiyonları üst planlarda. nexa'da kampanya içeriği yalnızca `message` (`packages/types/src/domain.ts:457-460`), widget kartı yalnızca `{id, message}` taşıyor (`apps/widget/src/widget.ts:213`). Bot mesajlarında `rich_message` widget'ta hiç çizilmiyor [A-19].
- **Yapılmazsa:** LC şablonlarının hiçbiri kurulamaz, kampanya modülü göstermelik kalır. AI'ın çoktan seçmeli teşhis soruları da serbest metne mahkûm olur.
- **Bağımlılıklar:** EN-01 (kart gösterilmeden önce risk kapısı), EN-05 (şablon galerisi bu kart tipine dayanır), AI-03/AI-04 (prosedür adımlarında hızlı yanıt butonları), AI-08 (bot butonları guardrail denetiminden geçer).
- **Netleştirilecek sorular:**
  1. AI/bot mesajlarında hangi buton türlerine izin verilsin? Önerilen varsayılan: AI yalnızca "mesaj gönder" (hızlı yanıt) ve kiracının onayladığı alan adlarına "bağlantı aç" butonu gönderebilsin. "Kupon kopyala" ve yatırım/bonus sayfasına giden butonlar yalnızca kampanyalarda kullanılsın, AI mesajında kullanılmasın (G9/G10).

### EN-03 — Çok koşullu hedefleme
- **Ne:** Kampanya hedeflemesinin yalnızca "URL içerir" ile sınırlı kalmaması. Çıkış niyeti, sayfada kalma süresi, ülke, geldiği site (referrer), yeni/geri gelen ziyaretçi, sitenin ilettiği özel değişken ve bunların VE/VEYA ile birleştirilmesi.
- **Neden gerekli:** iGaming'de doğru kişiye doğru mesaj kritik. Yatırım sayfasında 60 sn takılan oyuncuya "Yardım ister misiniz?", kayıt sayfasından çıkmak üzere olana "Sorunuz mu var?", giriş yapmamış yeni ziyaretçiye kayıt rehberi gösterilir. Tek koşulla bunların hiçbiri kurulamaz.
- **Gerekçe / kanıt:** LC'de 12'den fazla koşul tipi ve Match all/one var [E-36…E-48]. nexa'da koşul modeli tek alanlı (`domain.ts:451-454`, `url_contains`). Kodda "Future condition kinds (geo, time-on-page, …) push their own check here" notu var (`campaign-matching.ts:83`). Ek bulgu: ülke verisinin kaynağı yok. Müşteri kaydında `country_code` alanı var, ama widget akışında bunu IP'den dolduran bir adım kodda bulunamadı. Sitenin oturum değişkeni iletebileceği bir API de yok [E-46].
- **Yapılmazsa:** Kampanyalar ya herkese gider ya kimseye. İlk deneyen operatör modülü bırakır.
- **Bağımlılıklar:** EN-04 (önce "geçerli sayfa" doğru çalışmalı), EN-01 (hedeflenen kitleden riskli oyuncular yine çıkarılır), AU-02 (ülke verisi yönlendirme kurallarında da gerekli), EN-06 (özel değişken altyapısı ortak).
- **Netleştirilecek sorular:**
  1. Ülke bilgisi nereden gelsin? Önerilen varsayılan: sunucuda yerel bir IP→ülke veritabanı (ör. MaxMind GeoLite2 gibi, lisans koşullarına uygun). Dış servise çağrı yapılmasın. Sonuç yalnızca ülke kodu olarak saklansın.
  2. Operatör sitesinin ilettiği değişkenler (giriş yapmış mı, VIP seviyesi, ilk yatırım yapıldı mı) hedeflemede kullanılsın mı? Önerilen varsayılan: evet, ama bunlar oyuncunun tarayıcısından gelen doğrulanmamış veri sayılsın. Yalnızca kampanya hedeflemesinde kullanılsın, yetki veya AI kararlarında kullanılmasın. Gerçek oyuncu verisi F2'de platform entegrasyonuyla gelir (KN-06).

### EN-04 — "Geçerli sayfa URL'si" koşulunun hatalı çalışmasının düzeltilmesi
- **Ne:** "Oyuncu şu sayfadayken göster" koşulunun, oyuncunun o oturumda gezdiği herhangi bir sayfaya değil, gerçekten şu an bulunduğu sayfaya bakması.
- **Neden gerekli:** "Çekim sayfasında yardım teklif et" kampanyası, oyuncu çekim sayfasından ayrılıp casino lobisine geçtiğinde de tetikleniyor. Bu yanlış yerde, yanlış zamanda mesaj demek ve güveni düşürür.
- **Gerekçe / kanıt:** `apps/api/src/services/campaigns/campaign-matching.ts:80`: `pageUrls.some(...)`, yani oturumdaki tüm sayfalar taranıyor. LC'de "Current page URL" ve "Any page from session" iki ayrı koşul. Ek bulgu: sayfa görüntülemesi sunucuya yalnızca oyuncu mesaj gönderdiğinde kaydediliyor (`apps/api/src/routes/customer.ts:765-768`). Sohbet öncesi gezinen oyuncunun hangi sayfada olduğu bilinmiyor. Bu da "sayfaya göre kampanya" vaadini sohbet açmamış ziyaretçide fiilen işlevsiz bırakıyor.
- **Yapılmazsa:** Kampanyalar yanlış sayfada çıkar ya da hiç çıkmaz. Operatör "kampanya çalışmıyor" der.
- **Bağımlılıklar:** EN-03 (koşul dizisi yapısı bu düzeltmeyle birlikte kurulur).
- **Netleştirilecek sorular:** Yok.

### EN-05 — Kampanya silme, kampanya raporu, şablon galerisi
- **Ne:** Kampanyaların silinebilmesi (bugün yalnızca pasife alınabiliyor), tarih aralıklı kampanya raporu (gösterim, sohbet, dönüşüm) ve hazır şablon galerisi.
- **Neden gerekli:** Yüzlerce eski kampanya listede kalırsa yönetim zorlaşır. Pazarlama ve destek yöneticileri "bu ay hangi kampanya ne getirdi?" sorusunu raporla cevaplamak ister. iGaming'e özel Türkçe şablonlar ("Yatırım yardımı", "Çıkış niyeti: soru var mı?", "Hoş geldin bonusu koşulları") ilk kurulumu dakikalara indirir.
- **Gerekçe / kanıt:** LC'de Delete, Duplicate, kampanya bazlı rapor ve 10 şablonlu galeri var [E-12, E-15, E-16]. nexa'da kampanya uçları yalnızca GET/POST/PATCH (`apps/api/src/routes/campaigns.ts:90,101,122`). Kampanya raporu yok, yalnızca kartta Displayed/Chats/Conversion var. Şablon dosyası yok.
- **Yapılmazsa:** Liste kalabalıklaşır, kampanyanın işe yarayıp yaramadığı ölçülemez.
- **Bağımlılıklar:** EN-02 (şablonlar zengin karta dayanır), EN-01 (rapora "risk nedeniyle gösterilmedi" sayısı eklenir), RP-01 (rapor filtre şablonu).
- **Netleştirilecek sorular:**
  1. Silme gerçek silme mi, arşiv mi olsun? Önerilen varsayılan: arşiv (yumuşak silme). Kampanya listeden kalkar ama gönderim kayıtları veri saklama süresi boyunca kalır. Düzenleyici "bu oyuncuya hangi promosyon ne zaman gösterildi?" diye sorabilir.
  2. Hazır şablonlarda promosyon içeren olanlar olsun mu? Önerilen varsayılan: olsun. Ama her promosyon şablonu "risk bayraklı oyunculara gösterilmez" etiketiyle gelsin ve sorumlu oyun bağlantısı (ör. "Limitlerinizi belirleyin") opsiyonel alt satır olarak hazır gelsin.

### EN-06 — Hedeflerde (Goals) özel sayfa olayı
- **Ne:** Operatör sitesinin JavaScript ile "kayıt tamamlandı", "ilk yatırım yapıldı" gibi bir olay gönderebilmesi ve bunun bir hedef (dönüşüm) olarak sayılması.
- **Neden gerekli:** iGaming'de dönüşüm "teşekkür sayfasına ulaştı" ile ölçülmez, çünkü çoğu işlem tek sayfalık uygulamalarda olur. "Destek sohbetinden sonra oyuncu kaydı tamamladı mı?" sorusu destek ekibinin değerini gösteren en güçlü metriklerden biridir.
- **Gerekçe / kanıt:** LC'de Goals altında "Custom Page Event" (değişken adı + değeri) var [E-56]. nexa'da hedef tanımı yalnızca URL ve satış/lead/çözüm bayraklarından oluşuyor (`packages/types/src/domain.ts`, `GoalDefinition`). Sitenin olay gönderebileceği bir JS API'si yok (yalnızca satış için `trackSale` var).
- **Yapılmazsa:** Destek ve kampanya ekibinin katkısı ölçülemez, yalnızca sohbet sayısı raporlanır.
- **Bağımlılıklar:** EN-03 (sitenin değişken/olay ilettiği JS altyapısı ortak), EN-05 (kampanya raporundaki dönüşüm sütunu).
- **Netleştirilecek sorular:**
  1. Olayla birlikte tutar (yatırım miktarı) gönderilsin mi? Önerilen varsayılan: hayır, yalnızca olay adı gönderilsin (ör. `first_deposit`). Tutar gibi finansal veri F2'de platform entegrasyonundan gelsin. Hedef raporu için olay sayısı yeterli.

---

## 9. Raporlar (RP)

### RP-01 — Ajan, ekip, etiket ve konu filtreleri; ajan/ekip raporlarına derin link
- **Ne:** Tüm raporlarda tarih filtresine ek olarak ajan, ekip, etiket ve konu filtreleri. Ekip sayfasından "bu ajanın raporu" bağlantısıyla filtrelenmiş rapora tek tıkla geçiş.
- **Neden gerekli:** Bir iGaming destek merkezinde Ekip Lideri "Finans ekibimin bu haftaki ilk yanıt süresi" ya da "Bonus konulu sohbetlerin memnuniyeti" sorularını her gün sorar. Bugün yalnızca şirket geneli görülüyor.
- **Gerekçe / kanıt:** LC raporlarında Agent, Group, Tag, Keyword, Country filtreleri ve ajan/grup sayfasından "View reports" bağlantısı var [RF3, RF4, T10, T32]. nexa raporlarının ortak sorgu şeması yalnızca `from/to/baseline` alıyor (`apps/api/src/routes/reports.ts:200-211`). Ekip kırılımı yalnızca Breakdown tablosunda var.
- **Yapılmazsa:** Ekip Liderleri verileri CSV'ye alıp Excel'de filtreler. Ekip Lideri rolünün (RL-03) anlamı azalır.
- **Bağımlılıklar:** RL-02/RL-03 (Ekip Lideri yalnızca kendi ekibini görür), AU-01 (ekip = kuyruk), AI-05 (konu bilgisinin kaynağı), RP-02…RP-04 (yeni raporlar aynı filtre şablonunu kullanır).
- **Netleştirilecek sorular:**
  1. Ekip Lideri raporlarda yalnızca kendi ekibini mi görsün? Önerilen varsayılan: evet. Kendi ekibi otomatik filtre olarak gelsin. Daha geniş görünüm RL-02 izin matrisiyle açılsın.
  2. "Konu" filtresi neye dayansın? Önerilen varsayılan: iki ayrı filtre olsun. "AI konusu" (AI'ın seçtiği prosedür) ve "Etiket" (ajanın koyduğu). İkisi birleştirilmesin.

### RP-02 — Kaçan sohbetler ve etkileşim (kim başlattı) raporları
- **Ne:** Hiç insan yanıtı almadan kapanan veya terk edilen sohbetlerin sayısı, saat ısı haritası ve ekip kırılımı. Ayrıca sohbeti kimin başlattığı (oyuncu, kampanya, ajanın proaktif daveti, AI) kırılımı.
- **Neden gerekli:** Kaçan sohbet canlı destekte en temel kayıp göstergesidir. iGaming'de kaçan her "param yatmadı" sohbeti potansiyel bir şikâyet ya da kaybedilen oyuncudur. Hangi saatlerde kaçırıldığını görmek vardiya planlamasının girdisidir.
- **Gerekçe / kanıt:** LC'de "Missed chats" (+heatmap) ve "Chat engagement" raporları var [R5, R6]. nexa'da "missed" kavramı yok. Ama veri hazır: her oturumda ilk ajan yanıtının zamanı (`threads.first_response_at`) tutuluyor ve SLA modülü kapanışta "ilk yanıt hiç verilmedi" durumunu zaten tespit ediyor (`apps/api/src/services/chat/chat-service.ts`, `#closeConversation`). "Kim başlattı" bilgisi saklanmıyor.
- **Yapılmazsa:** Yönetim kayıpları göremez, AI devrinden sonra yanıtsız kalan oyuncular görünmez kalır.
- **Bağımlılıklar:** WG-03 (aktarma kaçan sohbeti azaltır, rapor bunu ölçer), RP-01, RP-04, AI-25 (AI metrikleriyle aynı tanımları kullanmalı).
- **Netleştirilecek sorular:**
  1. "Kaçan sohbet" tanımı ne olsun? Önerilen varsayılan: insana atanmış ya da kuyruğa girmiş ama hiç insan yanıtı almadan kapanan sohbet. AI'ın yanıt verip insana devrettiği, ama insanın yanıt vermediği sohbetler de kaçan sayılsın ve "devir sonrası kaçan" diye ayrı gösterilsin. Yalnızca AI ile başlayıp AI ile biten sohbetler kaçan sayılmasın.

### RP-03 — Uygunluk ve ajan aktivitesi (durum zaman çizelgesi)
- **Ne:** Ajanların "sohbet kabul ediyor / etmiyor / çevrimdışı" durumlarında ne kadar süre kaldığını gösteren rapor ve ajan × saat şeklinde gün içi durum şeridi.
- **Neden gerekli:** Vardiyalı çalışan iGaming destek ekiplerinde Ekip Lideri "planlanan 8 saatin kaçında ajan gerçekten sohbet kabul etti?" sorusunu sorar. Maç saatlerinde düşük kabul süresi doğrudan kaçan sohbet olarak döner.
- **Gerekçe / kanıt:** LC'de "Chat availability" ve "Agent activity" raporları var [R10, R16]. nexa'da durum değişiklikleri zaten kaydediliyor (`agent_presence_events`, `apps/api/src/routes/agents.ts:383`). Bu kayıt yalnızca personel tahmininde kullanılıyor (`routes/reports.ts:1295-1310`). Önemli bulgu: ajanın tarayıcısı kapanınca durum değişmiyor (bkz. WG-03). Bu yüzden rapor "çevrimiçi" süreyi olduğundan fazla gösterir.
- **Yapılmazsa:** Vardiya disiplini ölçülemez, personel tahmini yanlış girdiyle çalışır.
- **Bağımlılıklar:** WG-03 (bağlantı kopunca durumun düşürülmesi), RP-01, RL-02.
- **Netleştirilecek sorular:**
  1. Ajan tarayıcıyı kapattığında ya da bağlantısı koptuğunda durum otomatik "çevrimdışı" olsun mu? Önerilen varsayılan: evet. Kısa kopmalar sayılmasın diye 2 dakikalık tolerans olsun. Bu karar WG-03 ile ortak.
  2. Ekip Üyesi kendi aktivite raporunu görsün mü, başkalarınınkini görsün mü? Önerilen varsayılan: kendisininkini görsün, başkalarınınkini görmesin. Ekip Lideri kendi ekibini, Yönetici ve Kurucu herkesi görsün. Çalışan izleme verisi olduğu için bu ayar RL-02'de değiştirilebilsin.

### RP-04 — Kuyruk bekleme ve terk raporları
- **Ne:** Kuyruğa giren sohbet sayısı, ortalama ve en uzun bekleme süresi, kuyruktan atanma oranı ve kuyrukta beklerken vazgeçen (terk eden) oyuncu sayısı. Saat ve ekip kırılımıyla birlikte.
- **Neden gerekli:** Yoğun saatlerde kuyruk iGaming desteğinin en hassas noktasıdır. "Oyuncular ortalama kaç dakika bekliyor, kaçı bekleyemeyip gidiyor?" sorusu hem personel kararını hem WG-05'teki bekleme tahminini besler.
- **Gerekçe / kanıt:** LC'de "Queued customers" ve "Queue abandonment" raporları var [R17, R18]. nexa'da yalnızca "şu an kuyrukta" sayısı var. Kuyruğa giriş zamanı (`threads.queued_at`) tutuluyor, ama önemli bir bulgu var: bu değer atama anında ve kapanışta **siliniyor** (`apps/api/src/services/routing/routing-service.ts:219`, `chat-service.ts:967`). Yani geçmiş bekleme süreleri bugün kayboluyor ve sonradan hesaplanamıyor.
- **Yapılmazsa:** Kuyruk sorunları sezgiyle yönetilir. Bugün başlanmazsa geçmişe dönük veri de olmayacak.
- **Bağımlılıklar:** AU-01 (ekip bazlı kuyruklar), WG-05 (bekleme tahmini), RP-01, RP-02.
- **Netleştirilecek sorular:**
  1. "Terk" ne sayılsın? Önerilen varsayılan: kuyrukta beklerken sohbetin oyuncu tarafından kapatılması ya da zaman aşımıyla kapanması terk sayılsın. Yalnızca widget penceresinin kapatılması terk sayılmasın, çünkü oyuncu sohbetten çıkmadan geri dönebilir.

### RP-05 — Günlük / haftalık özet e-postaları
- **Ne:** Yöneticilere ve Ekip Liderlerine her sabah (ve haftalık) giden kısa özet: sohbet sayısı, kaçan sohbet, ilk yanıt süresi, memnuniyet, AI çözüm/devir oranı, risk bayraklı sohbet sayısı.
- **Neden gerekli:** Yöneticiler panele her gün girmez. 7/24 çalışan iGaming desteğinde "dün gece ne oldu?" sorusunun cevabı sabah e-postasında olmalı.
- **Gerekçe / kanıt:** LC'de profil ayarlarında Daily summary ve Weekly summary seçenekleri var [T25]. nexa'da zamanlanmış rapor altyapısı var (`apps/api/src/services/reports/scheduled-report-service.ts`, CSV ekli e-posta). Kişisel özet şablonu yok (`services/mail/templates/messages.ts` şablon listesinde yok).
- **Yapılmazsa:** Sorunlar ancak biri panele bakınca fark edilir. Gece vardiyasındaki kayıplar görünmez kalır.
- **Bağımlılıklar:** RP-02, RP-04, AI-25 (AI metrikleri), AI-27 (risk bayrağı sayısı), RL-02 (kim hangi kapsamı alır), IN-10 (bildirim tercihleri ekranı).
- **Netleştirilecek sorular:**
  1. Kim hangi özeti alsın ve e-postada oyuncu bilgisi olsun mu? Önerilen varsayılan: Kurucu ve Yönetici şirket geneli günlük özet (08:00, şirket saat diliminde), Ekip Lideri kendi ekibinin özetini alsın. Ekip Üyesi varsayılan olarak almasın. E-postada oyuncu adı, kullanıcı adı ve mesaj içeriği **olmasın**, yalnızca sayılar ve panele bağlantı olsun.

---

## 10. Otomasyon ve yönlendirme (AU)

### AU-01 — Konuya göre ekip yönlendirmesi (Finans, KYC/Risk, Bonus, Sorumlu Oyun, Teknik, Şikâyet)
- **Ne:** Şirketin konu bazlı kuyrukları tanımlayabilmesi (hazır şablon: Finans, KYC/Risk, Bonus, Sorumlu Oyun, Teknik, Şikâyet). AI'ın devri, pre-chat konu seçimi ve ajanın elle aktarımı hep bu kuyruklara bağlanır. Sorumlu Oyun kuyruğu yalnızca eğitimli ajanlara gider. Her kuyruğun kendi sırası, önceliği ve mesai dışı davranışı vardır.
- **Neden gerekli:** iGaming destek merkezlerinin çalışma biçimi budur. Yatırım/çekim sorusu finans ekibine, belge sorusu KYC ekibine, kendini dışlama talebi eğitimli sorumlu oyun ekibine gider. Yanlış ekibe giden sohbet hem zaman kaybıdır hem de sorumlu oyun konusunda uyum riski taşır (CGA: sorumlu oyun şikâyetleri insan tarafından ve yetkin personelle yürütülmeli).
- **Gerekçe / kanıt:** Sektör araştırması (Ekran E) hedef kuyruk eşlemesini ve "sorumlu oyun ve reşit olmayan şüphesi → acil" önceliğini tanımlıyor. LC'de yalnızca URL/ülke tabanlı grup yönlendirmesi var. nexa'da durum şöyle:
  - Ekip (grup) ve yönlendirme kuralı altyapısı güçlü. Uzmanlık şartı, öncelik katmanları ve yedek ekip var (`apps/api/src/services/routing/routing-service.ts`).
  - Ama **kuyruk şirket genelinde tek sıra**. Sıra numarası tüm şirkete göre veriliyor (`#nextQueuePosition`). Kuyruk boşaltılırken ilk bekleyen sohbet için uygun ajan yoksa döngü duruyor (`routing-service.ts:215`, `if (!assignee) break;`). Yani Sorumlu Oyun kuyruğunda bekleyen tek bir sohbet, boşta Finans ajanı olsa bile arkadaki tüm sohbetleri bekletebiliyor.
  - Kuyruktaki sohbet boşaltılırken uzmanlık şartı uygulanmıyor (kod yorumu, `routing-service.ts:203-209`).
  - AI devri hedef ekibi serbest metin adla arıyor. Ad tutmazsa sohbet olduğu yerde kalıyor (`apps/api/src/services/ai/ai-responder.ts:174-187`).
- **Yapılmazsa:** Yoğun saatte bir ekipteki tıkanıklık tüm şirketin kuyruğunu kilitler. Kendini dışlama talebi eğitimsiz bir ajana düşebilir. AI'ın "sizi finans ekibine aktarıyorum" sözü boşa çıkabilir.
- **Bağımlılıklar:** AI-12 (AI devrinde hedef ekip seçici bunu kullanır), WG-04 (pre-chat konu seçimi), WG-03 (aktarma kuyruk içinde), WG-07 (kuyruk bazında atama modu), IN-04 (takıma transfer arayüzü), RP-01/RP-04 (ekip ve kuyruk raporları), RL-03 (Ekip Lideri = kuyruk sahibi).
- **Netleştirilecek sorular:**
  1. Kuyruk listesi sabit mi, şirket tanımlı mı? Önerilen varsayılan: 6 hazır kuyruk şablon olarak gelsin. Şirket yeniden adlandırabilsin, yenisini ekleyebilsin (ör. "VIP"). Ancak "Sorumlu Oyun" rolündeki kuyruk silinemesin, yalnızca adı değişebilsin.
  2. "Eğitimli ajan" nasıl işaretlenecek? Önerilen varsayılan: mevcut "Yetenekler (uzmanlık)" altyapısıyla "Sorumlu oyun eğitimi" etiketi. Bu etiketi olmayan ajan Sorumlu Oyun kuyruğuna üye yapılamasın. Etiketi Yönetici veya Kurucu verebilsin.
  3. Sorumlu Oyun kuyruğunda uygun ajan yoksa ne olsun? Önerilen varsayılan: sohbet genel kuyruğa düşmesin. Ekip Lideri ve Yöneticiye acil bildirim gitsin. Oyuncuya destek kaynakları içeren sabit bir mesaj ve "en kısa sürede uzman ekibimiz dönecek" bilgisi verilsin. Mesai dışında talep kaydı açılsın.
  4. Acil öncelikli sohbetler (sorumlu oyun, reşit olmama şüphesi, kendine zarar) kuyruğun en önüne mi geçsin? Önerilen varsayılan: evet, kendi kuyruklarında en öne geçsin.

### AU-02 — Yönlendirme kuralları arayüzünün API ile eşitlenmesi
- **Ne:** Sohbet yönlendirme kuralları ekranında, API'nin zaten desteklediği "URL tam eşleşme", "birden fazla URL" ve "ülke" koşullarının seçilebilmesi.
- **Neden gerekli:** Çok markalı veya çok ülkeli operatörler sohbeti siteye ya da ülkeye göre farklı ekiplere yönlendirmek ister (ör. ".../tr/" Türkçe ekip, ".../en/" uluslararası ekip). Altyapı var, ekran eksik. Ucuz bir iş.
- **Gerekçe / kanıt:** LC'de "Is exactly", "+ Add another URL" ve "Customer's location" koşulları var [A-41, A-42, A-44]. nexa'da yönlendirme motoru `url_contains[]`, `url_equals[]`, `country_codes[]` koşullarını destekliyor (`routing-service.ts:423-441`). Ekran yalnızca tek bir "URL içerir" gönderiyor (`apps/web/src/features/settings/RoutingRules.tsx:142`). Ek bulgu: widget'tan başlayan sohbet yönlendirmeye yalnızca URL'yi iletiyor, ülkeyi iletmiyor (`apps/api/src/routes/customer.ts:840`). Ülke verisinin kaynağı da yok (bkz. EN-03). Yani ülke koşulu ekrana eklense bile widget sohbetlerinde bugün çalışmaz.
- **Yapılmazsa:** Yetenek API'de durur ama kimse kullanamaz. Çok markalı operatör manuel aktarım yapar.
- **Bağımlılıklar:** EN-03 (ülke verisinin kaynağı), AU-01.
- **Netleştirilecek sorular:** Yok (ülke verisinin kaynağı EN-03'teki soruyla birlikte karara bağlanır).

### AU-03 — Tetikleyiciler: "sohbet puanlandı" ve ticket yaşam döngüsü olayları
- **Ne:** Otomasyonların (webhook, ticket kuralları, Zapier/Make) tetiklenebileceği yeni olaylar: "sohbet puanlandı" (iyi/kötü + yorum) ve ticket güncellendi / durum değişti / yeni mesaj geldi / atandı.
- **Neden gerekli:** Kötü puan alan bir iGaming sohbeti çoğu zaman çözülmemiş bir ödeme sorunudur. Ekip Liderinin bunu anında görmesi ya da otomatik takip ticket'ı açılması kaybı önler. Ticket olayları da operatörün kendi sistemleriyle (back-office, CRM, Slack/Telegram grubu) bağlantı kurmasının temelidir.
- **Gerekçe / kanıt:** LC Workflows'ta "Chat rated" ve 11 ticket tetikleyicisi var [A-55, A-60]. nexa'da dışarı gönderilen olaylar yalnızca 5 tane: `chat_started`, `chat_deactivated`, `chat_transferred`, `event_created`, `ticket_created` (`apps/api/src/services/webhooks/webhook-service.ts:28-34`). Ticket kuralları yalnızca ticket açılışında çalışıyor (`packages/types/src/domain.ts:570-592`).
- **Yapılmazsa:** Kötü deneyimler zamanında yakalanmaz. Operatörün kendi araçlarıyla entegrasyonu ticket açılışıyla sınırlı kalır.
- **Bağımlılıklar:** WG-11 (puan yorumu), HD-01 (ticket yanıtı geldiğinde "yeni mesaj" olayı anlamlı olur), AI-24 (kötü puanlı sohbet QA kuyruğuna), KN-03 (yeni olayların teslim günlüğü).
- **Netleştirilecek sorular:**
  1. Kötü puan geldiğinde varsayılan olarak ne olsun? Önerilen varsayılan: sohbetin ekibinin Ekip Liderine panel bildirimi gitsin ve sohbet QA kuyruğuna (AI-24) eklensin. Otomatik ticket açma ve webhook isteğe bağlı kural olarak kalsın.

---

## 11. Kanallar ve entegrasyonlar (KN)

### KN-01 — Gerçek WhatsApp kanalı
- **Ne:** WhatsApp mesajlarının gerçekten alınıp gönderildiği bir kanal. Bugün bu kanal yalnızca bir taklit (mock).
- **Neden gerekli:** Türkiye ve çevre pazarlarda oyuncuların önemli kısmı destek için mesajlaşma uygulamalarını tercih eder. Telegram zaten canlı. WhatsApp ise sıkça istenen ikinci kanal.
- **Gerekçe / kanıt:** LC'de WhatsApp Marketplace üzerinden geliyor [P8]. nexa'da WhatsApp adaptörü açıkça "MOCK" yazıyor (`apps/api/src/services/channels/whatsapp.ts`). Ama gerçek kanal için hazır bir örnek var: canlı Telegram kanalı (`services/channels/telegram-live.ts`). Bu örnekte kimlik bilgisi şifreli saklanıyor, gelen mesaj gizli başlıkla doğrulanıyor ve `APPS_LIVE_PROVIDERS` ile açılıyor.
- **Yapılmazsa:** WhatsApp kullanan oyuncular ayrı bir araçtan (ör. telefon başında bir ajan) yönetilir, kayıtlar SiyahTuş dışında kalır ve AI bu kanalda çalışmaz.
- **Bağımlılıklar:** ID-03 (telefon numarası ile widget üyesinin eşleştirilmesi), EN-01 (WhatsApp üzerinden proaktif promosyon mesajları risk bayrağına tabi), AU-01 (kanal sohbetleri de konu kuyruklarına gider), AI-26 (maskeleme bu kanalda da çalışmalı).
- **Netleştirilecek sorular:**
  1. Meta'nın kendi Cloud API'si mi, bir aracı (BSP: 360dialog, Twilio, Gupshup vb.) mı kullanılsın? Önerilen varsayılan: doğrudan Cloud API. SiyahTuş "Tech Provider" olur, her şirket kendi WhatsApp Business hesabını gömülü kayıt (Embedded Signup) ile bağlar. Aracı firma ancak Meta onay sürecinde sorun çıkarsa değerlendirilsin.
  2. Pilot operatörün WhatsApp Business hesabı onaylı mı ve hangi ülkelerde kullanılacak? Önerilen varsayılan: başlamadan önce doğrulansın. Meta'nın ticaret ve iş mesajlaşma politikaları gerçek parayla kumar/bahis işletmelerini kısıtlıyor ve hesap onayı ile ülke sınırlaması gerektirebiliyor. Hukuki görüş alınmadan geliştirme bütçesi ayrılmasın.
  3. Proaktif (şablonlu) mesaj gönderilecek mi? Önerilen varsayılan: F1'de hayır. Yalnızca oyuncunun yazdığı mesajlara 24 saatlik pencere içinde yanıt verilsin. Şablonlu mesajlar promosyon riskini (EN-01) ve Meta şablon onayını beraberinde getirir.

### KN-02 — Gerçek Messenger / Instagram kanalları
- **Ne:** Facebook Messenger ve Instagram DM mesajlarının gerçekten alınıp gönderilmesi. Bugün ikisi de taklit (mock).
- **Neden gerekli:** Bazı operatörler sosyal medya hesaplarından gelen destek mesajlarını da tek yerde toplamak ister. Ancak iGaming markalarının Meta platformlarındaki hesapları sık kapatıldığı ve reklam kısıtı olduğu için öncelik düşük.
- **Gerekçe / kanıt:** LC'de Messenger ücretli, Instagram Marketplace'te [P4, P8]. nexa'da adaptörler taklit (`apps/api/src/services/channels/messenger.ts`, `instagram.ts`). Panelde sahte yetkilendirme kodu kullanılıyor (`apps/web/src/features/settings/Channels.tsx`, `MOCK_FACEBOOK_AUTH_CODE`).
- **Yapılmazsa:** Sosyal medya mesajları ayrı yönetilir. Ama bu, pilot için engel değil.
- **Bağımlılıklar:** KN-01 (aynı Meta uygulaması ve doğrulama altyapısı paylaşılır), ID-03.
- **Netleştirilecek sorular:**
  1. Messenger mı Instagram mı önce gelsin? Önerilen varsayılan: KN-01'den sonra, pilot operatör talep ederse önce Instagram (Türkiye'de daha yaygın). İkisi aynı Meta uygulaması üzerinden çalışır.

### KN-03 — Webhook teslim günlüğü arayüzü
- **Ne:** Geliştiriciler ekranında her webhook için son teslimlerin listesi (zaman, olay, durum kodu, hata, deneme sayısı), "tekrar gönder" ve "test olayı gönder" düğmeleri.
- **Neden gerekli:** Operatörler SiyahTuş'u kendi back-office'lerine ve Telegram/Slack gruplarına webhook ile bağlar. Bağlantı kopunca "neden gelmiyor?" sorusunun cevabı panelde olmalı. Yoksa her sorun SiyahTuş'a destek talebi olarak döner.
- **Gerekçe / kanıt:** LC'de bu Developer Console'da [D14]. nexa'da teslim kaydı ve otomatik yeniden deneme arka uçta var (`webhook_deliveries` tablosu, `schema.prisma` `WebhookDelivery`; zamanlanmış `webhook_redelivery` işi). Ama panelde gösterilmiyor (`apps/web/src/features/developers/WebhookSubscriptions.tsx`). API'de yalnızca listeleme, ekleme ve silme var (`apps/api/src/routes/webhooks.ts`).
- **Yapılmazsa:** Entegrasyon sorunları körlemesine çözülür ve destek yükü artar.
- **Bağımlılıklar:** AU-03 (yeni olaylar burada görünür), KN-04 (dokümandan bu ekrana bağlantı).
- **Netleştirilecek sorular:** Yok.

### KN-04 — Barındırılan API dokümanı
- **Ne:** SiyahTuş API'sinin (OpenAPI) okunabilir, aranabilir bir doküman sayfası olarak yayımlanması.
- **Neden gerekli:** iGaming operatörlerinin kendi geliştirici ekipleri ya da platform sağlayıcıları vardır ve entegrasyonu kendileri yapar. Doküman yoksa her entegrasyon toplantı ve e-postayla ilerler.
- **Gerekçe / kanıt:** LC'de geliştirici dokümanı ve API Console var [D2]. nexa'da sözleşme tam bir OpenAPI dosyası olarak duruyor (`packages/contract/openapi/openapi.yaml` + `paths/*.yaml`). Ama hiçbir yerde sunulmuyor (Redoc/Swagger yok).
- **Yapılmazsa:** Entegrasyon süresi uzar, satış döngüsü yavaşlar.
- **Bağımlılıklar:** KN-03, KN-06 (ileride platform entegrasyon dokümanı da burada yer alır).
- **Netleştirilecek sorular:**
  1. Doküman herkese açık mı olsun, giriş mi gerektirsin? Önerilen varsayılan: herkese açık. Ama yalnızca dış geliştiricinin kullanabileceği uçları içersin. Yönetim içi ve iç uçlar filtrelensin.

### KN-05 — Uygulamaların ajan arayüzüne panel ekleyebilmesi (iframe SDK)
- **Ne:** Bir uygulamanın (SiyahTuş'un ya da şirketin kendi geliştirdiği) sohbet ekranının sağ paneline kendi küçük ekranını (iframe) yerleştirebilmesi. Panel, seçili sohbetin oyuncu bilgisini güvenli biçimde alır.
- **Neden gerekli:** iGaming'de en güçlü kullanım: operatörün kendi back-office'indeki oyuncu kartını (bakiye, son işlemler, bonus durumu) sohbetin yanında açmak. Bu, tam platform entegrasyonu (KN-06) gelmeden önce bile ajanın sekme değiştirmesini ortadan kaldırır. Tam entegrasyondan çok daha ucuz bir ara yoldur.
- **Gerekçe / kanıt:** LC'de Details / Message box / Fullscreen yerleşimli uygulama SDK'sı var [A16]. nexa'da sağ panelde "Uygulamalar" bölümü var (`apps/web/src/features/inbox/DetailsPanel.tsx:139-155,300-330`). Ancak yalnızca bağlı uygulamaların verisini kart olarak gösteriyor, iframe yok. Uygulama kataloğundaki "yerleşim" bilgisi bile rastgele üretiliyor (`packages/types/src/apps.ts:1870-1872`).
- **Yapılmazsa:** Ajanlar iki ekran arasında oyuncu adını kopyala-yapıştır yapar. Bu hem yavaştır hem yanlış oyuncuya bakma riski taşır.
- **Bağımlılıklar:** ID-03 (iframe'e gidecek oyuncu kimliği), KN-06 (aynı ihtiyacın tam entegrasyonlu çözümü), RL-02 (paneli kim görür).
- **Netleştirilecek sorular:**
  1. İlk sürümde kimler panel ekleyebilsin? Önerilen varsayılan: yalnızca şirketin kendisi (Kurucu/Yönetici kendi back-office adresini tanımlar). Üçüncü taraf uygulama mağazası sonraya kalsın.
  2. Oyuncu kimliği iframe'e nasıl aktarılsın? Önerilen varsayılan: kısa ömürlü, imzalı bir belirteçle (kullanıcı adı + sohbet ID + süre). Kullanıcı adı adres çubuğunda açık metin olarak gitmesin (GV-05).

### KN-06 — iGaming platform entegrasyonları (BetConstruct, EveryMatrix vb.)
- **Ne:** Oyuncu ve işlem sorgulama için iGaming platformlarına bağlanma: oyuncu bulma, bakiye ve işlem durumu, KYC durumu, aktif bonus/çevrim. AI-28'deki araç yuvasına bağlanır ve AI'ın "kontrol ettim" diyebilmesini sağlar. Faz 2 işidir.
- **Neden gerekli:** Faz 1'de AI yalnızca bilgi toplar ve devreder. Gerçek çözüm oranını artıran şey "yatırımınız 13:42'de hesabınıza geçmiş" diyebilmektir. Rakip AI ajanları (Intercom Fin, Decagon, Sierra) değeri tam da bu "işlem yapabilen araçlar" ile yaratıyor.
- **Gerekçe / kanıt:** Sektör araştırması "Gelecek entegrasyon yuvası"nı her prosedürde tanımlıyor (ör. `deposit_lookup(user_id, amount, time_window)`, `igaming-ai-arastirma.md` §3.1). Karar önerisi: "veri modeli 5 katmanlı, araç katmanı F1'de boş kalsa da şema hazır". nexa'da gerçek dış entegrasyon örneği olarak Brevo, Freshdesk ve Telegram var (`apps/api/src/services/apps/verifiers/`). Kimlik bilgisini şifreli saklama kalıbı hazır. iGaming platformu bağlantısı yok.
- **Yapılmazsa:** AI F1 seviyesinde kalır. "Param yatmadı" sohbetlerinin büyük kısmı insana gider ve otomatik çözüm oranı sınırlı kalır.
- **Bağımlılıklar:** AI-28 (araç yuvası şeması; bu madde onu doldurur), ID-03 (widget üyesi ↔ platform oyuncu ID eşleşmesi), AI-08 (araç sonuçlarıyla bile söz verme yasağı sürer), KN-05 (ara çözüm), AI-21 (araç tanımı değişikliklerinin geçmişi).
- **Netleştirilecek sorular:**
  1. Hangi platform önce? Önerilen varsayılan: pilot operatörün kullandığı platform. Bu cevaplanmadan tasarım başlamasın. Adaylar BetConstruct, EveryMatrix, SoftSwiss, Pronet Gaming, Digitain gibi platformlar.
  2. İlk sürüm yalnızca okuma mı yapsın? Önerilen varsayılan: evet. Oyuncu bulma, işlem durumu, KYC durumu ve bonus/çevrim durumu yalnızca okunsun. Bonus tanımlama, limit değiştirme gibi yazma işlemleri yapılmasın. Bunlar ileride de yalnızca insan onayıyla yapılsın.
  3. Platform API bilgilerini kim verir ve oyuncu kimliği nasıl doğrulanır? Önerilen varsayılan: her şirket kendi platform API bilgilerini girer ve bunlar şifreli saklanır. Oyuncu kimliği, operatör sitesinin imzaladığı oturum bilgisinden alınır (ID-03). Oyuncunun sohbette yazdığı kullanıcı adıyla tek başına hesap verisi gösterilmez.

---

## 12. Faturalama (BL)

### BL-01 — Gerçek ödeme sağlayıcısı
- **Ne:** Abonelik ücretinin gerçekten tahsil edilmesi: kart/ödeme yöntemi kaydı, yenilemede otomatik çekim, başarısız ödemede uyarı ve tekrar deneme. Bugün ödeme tamamen taklit (mock). Pilot elle aktivasyonla çalışıyor.
- **Neden gerekli:** Ücretli lansmanın ön koşulu. Ancak iGaming'e hizmet veren bir yazılım şirketi için ödeme sağlayıcısı seçimi teknik değil, ticari ve hukuki bir karar. Birçok ödeme kuruluşu kumar/bahis sektörüne hizmet veren işletmeleri de yüksek riskli sayıp reddedebiliyor veya hesabı sonradan kapatabiliyor.
- **Gerekçe / kanıt:** LC'de kartla checkout ve sepet önizlemesi var [B8, B11]. nexa'da ödeme katmanı bilinçli olarak tek bir taklit uygulama (`apps/api/src/services/billing/payment-provider.ts`, `STRIPE_PROVIDER` varsayılanı `mock`, `config/env.ts:973`). Arayüz yalnızca kart kaydını tanımlıyor, tahsilat ve iade yok. Abonelik ve fatura dönemi kapatma mantığı hazır (`subscription-service.ts`, `invoice-close-*`).
- **Yapılmazsa:** Her müşteri elle faturalanır ve tahsil edilir. Ölçeklenmez ama pilotu engellemez.
- **Bağımlılıklar:** BL-02 (fatura belgesi ve vergi bilgisi sağlayıcı/ülke seçimine bağlı), BL-03 (iptal akışı), GV-03.
- **Netleştirilecek sorular:**
  1. Hangi ödeme sağlayıcısı ve hangi bölge? Önerilen varsayılan: pilot ve ilk müşterilerde banka havalesi/SWIFT + elle aktivasyon (bugünkü yol) devam etsin. Paralel olarak, SiyahTuş'un iGaming operatörlerine yazılım sattığını başvuruda açıkça belirterek yüksek riskli sektörü kabul eden bir sağlayıcıyla görüşülsün. Stripe gibi genel sağlayıcılar ret riski nedeniyle tek seçenek olarak planlanmasın.
  2. SiyahTuş hangi ülkedeki şirket üzerinden faturalandıracak (Türkiye, Kıbrıs, Malta, Estonya…)? Önerilen varsayılan: bu karar BL-01 ve BL-02'den önce verilsin. Vergi, e-fatura zorunluluğu ve ödeme sağlayıcısı seçeneklerini doğrudan belirler.
  3. Hangi para birimi? Önerilen varsayılan: USD (bugünkü fiyat $99). EUR isteğe bağlı.
  4. Kripto (USDT) ile ödeme kabul edilsin mi? Önerilen varsayılan: hukuki ve muhasebe görüşü alınana kadar hayır. Sektörde B2B ödemelerde yaygın olduğu için talep gelirse ayrıca değerlendirilsin.

### BL-02 — Fatura PDF'i, fatura adresi, vergi numarası
- **Ne:** Şirketin fatura bilgilerini (ünvan, adres, vergi dairesi/numarası, ülke) girebilmesi ve her dönem için yasal geçerliliği olan PDF fatura indirebilmesi.
- **Neden gerekli:** Kurumsal müşteri CSV ile muhasebe kaydı yapamaz. Faturada kendi ünvanını ve vergi numarasını görmek ister. Türkiye'de faturalandırılıyorsa e-Fatura/e-Arşiv yasal zorunluluktur.
- **Gerekçe / kanıt:** LC'de fatura PDF'i ve hesap bilgileri var [B13, B14]. nexa'da fatura indirme yalnızca CSV (`apps/api/src/routes/reports.ts:2208`, `/billing/invoices/:period/download`). Fatura adresi ve vergi numarası alanı hiç yok (kodda `billing_address`, `tax`, `vat` bulunamadı). PDF üretici altyapısı rapor dışa aktarmada zaten var (`GET /reports/export?format=pdf`).
- **Yapılmazsa:** Müşteri muhasebesi faturayı kabul etmez ve tahsilat gecikir.
- **Bağımlılıklar:** BL-01 (faturalandıran şirketin ülkesi), BL-03.
- **Netleştirilecek sorular:**
  1. Türkiye'de e-Fatura/e-Arşiv entegrasyonu (GİB özel entegratörü) gerekiyor mu? Önerilen varsayılan: BL-01'deki ülke kararına bağlı. Türk şirketi üzerinden faturalandırılacaksa entegratör üzerinden e-belge kesilsin, uygulama içi PDF yalnızca bilgi amaçlı olsun. Yurt dışı şirketse uygulama içi PDF yasal fatura olsun.
  2. Fatura numaralandırması nasıl olsun? Önerilen varsayılan: yıl bazlı, ardışık ve boşluksuz (ör. 2026-000123). Kesilen fatura değiştirilemesin, düzeltme ayrı belgeyle yapılsın.

### BL-03 — Abonelik iptali
- **Ne:** Kurucunun aboneliği panelden iptal edebilmesi. İptal dönem sonunda geçerli olur ve dönem bitene kadar geri alınabilir.
- **Neden gerekli:** Self-servis iptal hem tüketici/ticari mevzuatın beklentisi hem de güven unsuru. "İptal etmek için destekle yazışmak zorundayım" deneyimi satış öncesi itiraz yaratır. iGaming müşterileri lisans veya pazar değişikliğinde hızla küçülüp büyüyebilir.
- **Gerekçe / kanıt:** LC'de abonelik "until you cancel" mantığında [B17]. nexa'da abonelik durum alanında `canceled` değeri var ama iptal akışı ve uç noktası yok (`apps/api/src/services/billing/subscription-service.ts`). Deneme bitince salt-okuma moduna geçiş mekanizması hazır (`plugins/license-gate.ts`).
- **Yapılmazsa:** İptaller e-postayla ve elle yönetilir, unutulan iptaller ücret itirazına döner.
- **Bağımlılıklar:** BL-01, BL-02, RL-05 (iptal yalnızca Kurucu yetkisinde), veri saklama ayarları.
- **Netleştirilecek sorular:**
  1. İptalden sonra veri ne olsun? Önerilen varsayılan: dönem sonunda çalışma alanı salt-okunur olsun. 30 gün boyunca veriler dışa aktarılabilsin. Ardından şirketin veri saklama ayarına göre silinsin (iGaming lisans kayıt saklama yükümlülükleri nedeniyle şirket daha uzun süre seçebilsin).
  2. Kullanılmayan süre için iade yapılsın mı? Önerilen varsayılan: hayır. İptal dönem sonunda geçerli olsun. Yıllık planlarda iade ayrı ticari karar olarak elle yapılsın.

---

## 13. Güvenlik, altyapı ve UX dersleri (GV)

### GV-01 — Widget'ta kötüye kullanım koruması
- **Ne:** Widget'ı ve AI kotasını kötüye kullanıma karşı katmanlı koruma: oyuncu, IP ve workspace başına AI yanıt sınırları; yalnız şüpheli durumda devreye giren görünmez CAPTCHA; kota dolunca AI yerine insan kuyruğu; Yönetici'ye erken uyarı.
- **Neden gerekli:** Bugün siteyi açan herkes AI'ı tetikleyebiliyor. Bir script (ya da rakip bir operatör) bir workspace'in günlük AI hakkını dakikalar içinde bitirebilir; o gün gece yarısına kadar AI kapanır ve bütün oyuncular insan beklemek zorunda kalır.
- **Gerekçe / kanıt:**
  - Platformun kendi canlı yayın kontrol listesi bunu açık risk olarak yazıyor: yabancı biri günlük AI tavanını tüketebilir; widget'ın token ucunda ve kayıt ekranında CAPTCHA yok; sınırlar ağ başına olduğu için çok ağa yayılmış bir script yalnız yavaşlar (`docs/production-checklist.md`, "Known risks"; ADR `docs/adr/pilot-public-readiness.md` K-e(5)).
  - Günlük AI tavanı workspace ve platform düzeyinde, UTC gününe göre (`apps/api/src/services/ai/ai-daily-budget.ts`). Oyuncu başına bir sınır yok.
  - İstek sınırları: müşteri token'ı dakikada 60, anonim IP dakikada 30 (`apps/api/src/plugins/rate-limit.ts`). Spam filtresi yalnız sohbeti açan mesajı tarıyor.
  - Token ucu, tarayıcısında üye numarası olmayan her ziyaretçi için veritabanında yeni bir müşteri kaydı açıyor (`apps/api/src/routes/auth.ts`, `/customer/token`); bu da şişirilebilir.
  - Pilot zaten Cloudflare Tunnel arkasında; Cloudflare'in görünmez doğrulaması (Turnstile) bu yapıya doğal oturur.
- **Yapılmazsa:** Tek bir saldırı bütün günün AI'ını kapatır; maliyet ve oyuncu memnuniyeti zarar görür; veritabanı sahte müşteri kayıtlarıyla dolar.
- **Bağımlılıklar:** GV-02, ID-03, ID-04, AI-16 (gerçek modelin açılması, maliyet takibi), AI-09.
- **Netleştirilecek sorular:**
  1. CAPTCHA ne zaman çıksın? Önerilen varsayılan: yalnız şüpheli davranışta (aynı IP'den çok sayıda yeni ziyaretçi, çok hızlı mesaj); normal oyuncu hiç görmesin.
  2. Oyuncu başına günlük AI yanıt sınırı olsun mu? Önerilen varsayılan: evet, üye başına günde 40 AI yanıtı; aşılınca konuşma insana geçsin.
  3. Workspace kotası dolunca ne olsun? Önerilen varsayılan: AI susar, konuşmalar insan kuyruğuna gider, ajan ekranında "AI günlük kotası doldu" notu çıkar. Kotanın %80'inde Yönetici ve Kurucu'ya uyarı gider.
  4. Doğrulama hizmeti olarak Cloudflare Turnstile kullanılsın mı? Önerilen varsayılan: evet (pilot zaten Cloudflare arkasında); geliştirme ve testte sahte (mock) sağlayıcı.

### GV-02 — Kalıcı AI iş kuyruğu
- **Ne:** Oyuncunun mesajı kaydedildiği anda aynı işlemle bir "AI işi" de kalıcı olarak yazılsın. Sunucu çökse bile yeniden açıldığında iş tamamlanır; çok gecikmişse oyuncuya bayat cevap gitmez, konuşma insana devredilir. Aynı mesaja asla iki kez cevap verilmez.
- **Neden gerekli:** Pilot tek bir ev sunucusunda çalışıyor. Sunucu yeniden başladığında, güncelleme yapıldığında ya da bellek yüzünden takıldığında o anda bekleyen AI cevapları sessizce kayboluyor. Oyuncu cevap bekler, kimse bilmez.
- **Gerekçe / kanıt:**
  - AI ve kural botu işleri sunucunun belleğinde sıraya alınıyor ve bilerek kalıcı yapılmamış: "Not durable, on purpose" (`apps/api/src/services/chat/follow-ups.ts`). Kontrol listesi de bunu açık risk olarak yazıyor: "çökme ya da süre aşımı o cevabı kaybettirir" (`docs/production-checklist.md`, PLAN §D201).
  - Tek ev sunucusu ve bellek baskısıyla sessiz takılma bilinen risk (`kaynaklar/nexa-ozellikler.md` §6.4).
  - Yeniden kullanılabilecek kalıp kodda hazır: webhook yeniden gönderimi Postgres'te "iş al, süreyle kilitle, bitir" mantığıyla çalışıyor (`apps/api/src/services/webhooks/redelivery.ts`). AI günlük bütçesi de bilerek Redis yerine Postgres'te tutulmuş, çünkü Redis kesilince sınırlar "açık" kalıyor (`ai-daily-budget.ts` açıklaması). Projede BullMQ gibi bir kuyruk kütüphanesi yok.
  - Çok turlu AI (AI-03) geldiğinde işler uzar ve durum taşır; kalıcı kuyruk ihtiyacı artar.
- **Yapılmazsa:** Her güncelleme ya da çökmede bazı oyuncular cevapsız kalır; çok adımlı teşhis akışları yarıda kesilir; kimse fark etmez çünkü kayıt yok.
- **Bağımlılıklar:** AI-01, AI-03, AI-09, AI-11, GV-01, ID-08.
- **Netleştirilecek sorular:**
  1. Gecikmiş AI cevabı ne kadar süre sonra artık gönderilmesin? Önerilen varsayılan: 2 dakika. Sonrasında oyuncuya "Sizi bir temsilciye aktarıyorum" denir ve konuşma insan kuyruğuna gider.
  2. Ajan bildirim e-postaları da bu kalıcı kuyruğa alınsın mı? Önerilen varsayılan: evet, ikinci adımda (önce AI).

### GV-03 — Davet akışının kötüye kullanımının engellenmesi
- **Ne:** Davet gönderen kişinin, davet bağlantısını kullanarak başkasının e-posta adresiyle hesap açıp şifre belirleyebilmesinin engellenmesi. Bağlantıyla açılan yeni hesap, e-posta sahipliği kanıtlanmadan kullanılamaz.
- **Neden gerekli:** Kötü niyetli ya da hesabı ele geçirilmiş bir Yönetici, örneğin bir rakip operatör çalışanının ya da tanınmış birinin adresiyle hesap açabilir. Hesaplar platform genelinde tek olduğu için bu sahte hesap gerçek kişiyi başka workspace'lere kadar takip edebilir; denetim kayıtlarında sahte bir kimlik oluşur.
- **Gerekçe / kanıt:**
  - Kontrol listesi açıkça yazıyor: "Davet akışı başkasının adresiyle hesap açmak için kullanılabilir; davet eden kabul bağlantısını yanıtta alır ve davet edilen adres için şifre belirleyebilir" (`docs/production-checklist.md` "Known risks").
  - Davet ucu kabul bağlantısını yanıtta döndürüyor (ekranda "davet bağlantısını kopyala"). Yeni hesap kabulünde ad ve şifre bağlantıyla belirleniyor, e-postanın sahibi olunduğu ayrıca kanıtlanmıyor (`apps/api/src/services/auth/lifecycle-service.ts:538-608`).
  - Hesaplar birden çok workspace'e bağlanabiliyor (`accounts` ↔ `agent_memberships`); bir adres bir kez sahiplenilince her yerde geçerli.
  - Kayıt (signup) için e-posta doğrulaması zaten var (`SIGNUP_EMAIL_VERIFICATION`); aynı mekanizma davette de kullanılabilir.
- **Yapılmazsa:** Kimlik taklidi, hesap önceden sahiplenme ve denetim kaydının güvenilmezliği.
- **Bağımlılıklar:** RL-04, RL-05, RL-06.
- **Netleştirilecek sorular:**
  1. "Davet bağlantısını kopyala" özelliği kalsın mı? Önerilen varsayılan: kalsın (e-posta ulaşmadığında işe yarıyor), ama bağlantıyla açılan yeni hesap, davet edilen adrese giden koduyla doğrulanmadan giriş yapamasın.
  2. Günlük davet sınırı olsun mu? Önerilen varsayılan: workspace başına günde 50 (mevcut "workspace dışına giden e-posta" sınırıyla aynı).

### GV-04 — Panelin dar ekranlarda kullanılabilir olması
- **Ne:** Inbox (yanıt, devralma), devir kartı, zaman çizelgesi, onay ve QA ekranlarının tablette (768–1024 piksel) ve telefonda (375 piksel ve üstü) rahat kullanılabilmesi.
- **Neden gerekli:** Ekip Liderleri ve Yöneticiler vardiya dışında, gece ya da yolda telefondan bakar. Acil bir devralma ya da onay masaüstüne dönmeyi beklememeli.
- **Gerekçe / kanıt:**
  - Panel 1024 pikselin altında "masaüstü için tasarlandı / yine de devam et" uyarısı gösteriyor (`apps/web/src/components/NarrowScreenNotice.tsx:23`, `NARROW_SCREEN_MAX = 1024`). Son UX taramasında da "tam responsive panel yok" kısmen açık kaldı (`docs/ux-audit-2026-10-07.md` O6).
  - Mobil uygulama var ama yalnız İngilizce; ticket yönetimi yok, yönetim ekranlarının çoğu salt okunur (`kaynaklar/nexa-ozellikler.md` §3).
  - Dar ekran için bir e2e testi zaten var (`apps/e2e/tests/narrow-screen.spec.ts`); genişletilebilir.
- **Yapılmazsa:** Gece acil bir devralma ya da onay beklemede kalır; liderler masaüstüne bağımlı olur.
- **Bağımlılıklar:** ID-09, RL-03, AI-10, AI-20, AI-24.
- **Netleştirilecek sorular:**
  1. Öncelik hangisi: panelin telefonda çalışması mı, mobil uygulamanın Türkçeleşmesi mi? Önerilen varsayılan: önce panel (Inbox ve onay ekranları); mobil uygulamanın Türkçesi sonra.
  2. Telefonda hangi ekranlar şart? Önerilen varsayılan: Inbox (yanıt ve devralma), devir kartı, onay kuyruğu, zaman çizelgesi. Ayarlar masaüstünde kalabilir.

### GV-05 — Kişisel verinin URL'lerde olmaması
- **Ne:** Panel ve widget adreslerinde ve dışarıya verilen bağlantılarda e-posta, ad, kullanıcı adı, telefon ya da aranan metin bulunmaması; yalnız rastgele numaralar kullanılması. Üye numarası gibi "anahtar" değeri taşıyan numaraların da üçüncü taraflara gitmemesi.
- **Neden gerekli:** Adres çubuğundaki bilgi tarayıcı geçmişine, ekran paylaşımına, başka sitelere giden "nereden geldi" bilgisine ve analiz araçlarına sızar. Oyuncu verisi için bu doğrudan KVKK riski.
- **Gerekçe / kanıt:**
  - LiveChat ajan e-postasını adrese yazıyor (`/team/agent/<e-posta>`, arşiv filtresinde `agent[]=<e-posta>`) ve haber bağlantısında kullanıcı e-postasını üçüncü tarafa taşıyor (`kaynaklar/eksikler.md`, "LiveChat hatalarından dersler" 9 ve Team bölümü ders 6).
  - nexa sunucu tarafında iyi durumda: log'a yazılan adreslerde `email` ve `query` parametreleri maskeleniyor (`apps/api/src/lib/log-redact.ts:152-153`), izleme verisine adresin sorgu kısmı hiç gitmiyor (`requestPath`). Panel adreslerinde numara kullanılıyor (`?chat=`, `?customer=`).
  - Dikkat edilecek iki nokta: (1) `?customer=<üye numarası>` adresi üye numarasını taşıyor; bu numara widget token'ı almakta anahtar gibi çalıştığı için (ID-03) panel dışına çıkmamalı. (2) Yeni gelecek arşiv metin araması (ID-07) ve ID araması (ID-06) aranan metni adrese yazmamalı; özellikle `q=` gibi kısa bir parametre adı bugünkü log maskelemesine takılmaz.
- **Yapılmazsa:** Oyuncu e-postaları ve kullanıcı adları tarayıcı geçmişinde, ekran kayıtlarında ve üçüncü taraf loglarında birikir.
- **Bağımlılıklar:** ID-03, ID-06, ID-07, AR-02 (filtrelerin adreste tutulması).
- **Netleştirilecek sorular:**
  1. Arşiv filtreleri paylaşılabilir bağlantıda tutulurken (AR-02) aranan metin de bağlantıya girsin mi? Önerilen varsayılan: hayır. Numara, tarih, ekip, etiket gibi filtreler bağlantıda; serbest metin bağlantıda değil.

### GV-06 — Tutarlı kaydetme kalıbı
- **Ne:** Ayar ekranlarında tek kural: değişiklik form üzerinde yapılır, "Kaydet" ile kalıcı olur, kaydedilmeden çıkılırsa uyarı çıkar. Anında kaydeden anahtarlar yalnız düşük riskli kişisel tercihlerde kullanılır, görsel olarak farklıdır ve kaydedildiğini bildirir. Yüksek riskli ayarlar (yetki matrisi, AI kuralları, saklama süresi) ayrıca onay penceresi ister.
- **Neden gerekli:** Bir ekranda kutuyu işaretlemek anında yetki açar, diğerinde "Kaydet"e basmadan hiçbir şey olmaz; kullanıcı hangisinde olduğunu bilemez. Yetki matrisi geldiğinde bu karışıklık güvenlik açığına dönüşür.
- **Gerekçe / kanıt:**
  - Etiketler ekranında ekip kapsamı kutusu anında kaydediyor (`apps/web/src/features/settings/Tags.tsx:90-93`); diğer ayar bölümleri "Kaydet" düğmesi kullanıyor.
  - "Kaydedilmemiş değişiklik" uyarısının altyapısı var ama yalnız AI skill editöründe kullanılıyor (`apps/web/src/lib/dirty-guard.tsx`; `apps/web/src/features/playbook/SkillEditor.tsx:279`). Ayar bölümleri arasında geçince taslak sessizce kayboluyor (`kaynaklar/eksikler.md`, "LiveChat hatalarından dersler").
  - LiveChat'te de kaydetme kalıpları karışık (sabit çubuk / satır içi / anında kayıt) ve keşifte ders olarak işaretlendi; ChatBot.com'da da kirli form uyarısı yok.
- **Yapılmazsa:** Yanlışlıkla açılan yetkiler, kaybolan ayar taslakları, "kaydettim sanmıştım" kaynaklı hatalar.
- **Bağımlılıklar:** WG-14 (kaydedilmemiş değişiklik uyarısı), RL-02, AI-07, AI-20.
- **Netleştirilecek sorular:**
  1. Yüksek riskli ayarlarda onay penceresine kısa bir "neden değiştirdin" notu zorunlu olsun mu? Önerilen varsayılan: evet, yetki matrisi, AI uyum kuralları ve veri saklama süresi için; not denetim kaydına yazılır.

