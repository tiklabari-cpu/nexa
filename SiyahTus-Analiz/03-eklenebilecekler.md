# 03 — Karşılaştırma Sonucu SiyahTuş'a Eklenebilecekler

> **Ne bu dosya?** LiveChat, ChatBot.com ve piyasadaki AI destek ajanları (Intercom Fin, Zendesk AI, Ada, Decagon, Sierra, Freshworks Freddy) ile SiyahTuş'un (nexa-main) karşılaştırılmasından çıkan, sisteme eklenebilecek maddelerin **başlıklı listesi**.
> **Nasıl okunur?** Her maddenin kalıcı bir kimliği var (ör. `AI-03`). Aynı kimlik:
> - [04-gerekceler-ve-sorular.md](04-gerekceler-ve-sorular.md) dosyasında **neden ve gerekçe** ile,
> - [05-uygulama-rehberi.md](05-uygulama-rehberi.md) dosyasında **alan, kod karşılığı ve kodlama mantığı** ile
> tekrar geçer.
>
> **Sütunlar**
> - **Öncelik:** P0 = pilot/iGaming kullanımı için şart · P1 = önemli · P2 = olsa iyi olur
> - **Faz:** F1 = şimdi (AI yalnız konuşur, entegrasyon yok) · F2 = iGaming platform entegrasyonları geldikten sonra
> - **Efor:** S ≈ 1–2 gün · M ≈ 1 hafta · L ≈ 1 haftadan fazla (kaba tahmin)
> - **Kaynak:** maddenin nereden çıktığı. `LC` = LiveChat keşfi, `CB` = ChatBot.com keşfi, `AR` = sektör araştırması, `KOD` = nexa kod incelemesi, `SEN` = senin verdiğin karar/istek. Köşeli parantezdeki kodlar `kaynaklar/eksikler.md` içindeki satır numaralarıdır (ör. `[D15]`).
>
> **Sabit kararlar (bu listenin dayandığı çerçeve):**
> 1. AI şimdilik **yalnızca konuşur**: teşhis soruları sorar, bilgi bankasına göre yanıt verir, çözemezse **özetleyerek insana devreder**. BetConstruct, EveryMatrix vb. entegrasyon yok (F2).
> 2. Kiracılar **şirketler**; iGaming/bahis operatörlerine canlı destek veren çok ajanlı ekipler. Hiyerarşi: Kurucu → Yönetici(ler) → Ekip Lideri → Ekip Üyesi. Kimin neyi göreceği **sonra** belirlenecek, yani izinler yapılandırılabilir olmalı.
> 3. **Thread ID** = üyenin o günkü konuşma grubu (aynı gün tekrar gelirse aynı kalır), **Chat ID** = her bağlantı (aynı gün tekrar gelirse yeni). AI, thread ID ile üyenin o günkü önceki mesajlarını ve konusunu hatırlar. Chat ID / thread ID loglarda ve geçmişte aranabilir olur.

---

## Özet tablo

| Bölüm | Madde sayısı | P0 | P1 | P2 |
|---|---|---|---|---|
| 1. AI Agent çekirdeği (AI) | 30 | 19 | 9 | 2 |
| 2. Kimlikler, gün içi hafıza, aranabilir kayıtlar (ID) | 9 | 7 | 2 | 0 |
| 3. Roller ve yetkiler (RL) | 6 | 2 | 3 | 1 |
| 4. Inbox / sohbet deneyimi (IN) | 11 | 2 | 8 | 1 |
| 5. Arşiv (AR) | 4 | 1 | 3 | 0 |
| 6. HelpDesk / ticket (HD) | 5 | 3 | 2 | 0 |
| 7. Widget ve sohbet ayarları (WG) | 15 | 3 | 10 | 2 |
| 8. Engage / kampanyalar (EN) | 6 | 1 | 4 | 1 |
| 9. Raporlar (RP) | 5 | 0 | 5 | 0 |
| 10. Otomasyon ve yönlendirme (AU) | 3 | 1 | 2 | 0 |
| 11. Kanallar ve entegrasyonlar (KN) | 6 | 0 | 4 | 2 |
| 12. Faturalama (BL) | 3 | 0 | 2 | 1 |
| 13. Güvenlik, altyapı, UX dersleri (GV) | 6 | 3 | 3 | 0 |
| **Toplam** | **109** | **42** | **57** | **10** |

**Önerilen başlangıç sırası:** önce kimlik ve hafıza temeli (ID-01…ID-03), ardından AI motorunun çekirdeği (AI-01…AI-12) ve iGaming bilgi modeli (AI-13…AI-15). Sonra test, yayın ve kalite döngüsü (AI-19…AI-25), en son diğer bölümler. Ayrıntılı sıra için [06-kullanim-kilavuzu.md](06-kullanim-kilavuzu.md) dosyasına bak.

---

## 1. AI Agent çekirdeği (AI)

### 1.1 Konuşma motoru
| ID | Madde | Öncelik | Faz | Efor | Kaynak |
|---|---|---|---|---|---|
| AI-01 | **Sohbet içi konuşma hafızası:** AI her mesajda o sohbetin önceki mesajlarını görür; cevabı "yeni mesaj" gibi baştan değerlendirmez | P0 | F1 | M | KOD, AR |
| AI-02 | **Gün içi hafıza (thread ile):** üye aynı gün yeni bir chat açarsa, AI aynı thread'deki önceki chat'lerin özetini ve konusunu görür ("Az önce Papara yatırımınızla ilgili yazmıştınız…") | P0 | F1 | M | SEN |
| AI-03 | **Prosedür (konu akışı) motoru:** çok turlu, sırayla soru soran, cevaba göre dallanan, "ne zaman kullanılır" giriş koşulu olan akışlar (bugünkü tek mesajlık adım listesinin yerine) | P0 | F1 | L | KOD, AR, CB |
| AI-04 | **Bilgi toplama (slot) sistemi:** sorulan sorunun cevabını çıkarır, doğrular (tarih, tutar, TXID formatı), saklar, eksik olanı tekrar sorar. Hassas alanlar (şifre, kart) asla istenmez | P0 | F1 | M | KOD, AR |
| AI-05 | **LLM tabanlı konu tespiti ve prosedür seçimi:** kelime örtüşmesi yerine anlama dayalı seçim; prosedür önceliği; "her mesaja uyan" skill hatasının giderilmesi | P0 | F1 | M | KOD, AR |
| AI-06 | **Bilgi bankasından genel yanıt + "bilmiyorum" davranışı:** hiçbir prosedür uymazsa bilgi bankasından cevap ver; bilgi yoksa uydurmadan söyle ve devret | P0 | F1 | S | KOD, AR (G17) |
| AI-07 | **Davranış talimatları (Guidance) ekranı:** "önce yöntemi sor", "tek mesajda en fazla 2 soru" gibi düz yazıyla kurallar; veritabanında var olup kullanılmayan `instruction` alanının işler hale gelmesi; çakışma denetimi | P0 | F1 | M | KOD, AR |
| AI-08 | **Uyum korumaları (guardrail) seti:** platformun kilitlediği temel kurallar (G1–G19: sorumlu oyun, reşit olmayan, söz verme yasağı, şifre/OTP istememe…) + kiracının ekleyebileceği kurallar + yasaklı ifade listesi + gönderim öncesi çıktı denetimi | P0 | F1 | M | AR |
| AI-09 | **Otomatik insana devir tetikleyicileri (kiracı yapılandırır, karar K9):** AI "çözüldü" kararını kiracının tanımladığı kriterlere göre verir; devir kuralları (ör. AI çözemedi, şifre kurtarma, para yatırma) Yönetici/Kurucu tarafından eklenip ayarlanır. Hazır tetikleyiciler: oyuncu insan istedi, 2 tur anlaşılamadı, olumsuz duygu arttı, bilgi yok, uyum kuralı tetiklendi, hakaret/tehdit | P0 | F1 | M | KOD, AR, LC |
| AI-10 | **Yapılandırılmış devir kartı:** konu, oyuncu, toplanan bilgiler, AI'ın söyledikleri, devir nedeni, risk bayrakları, önerilen sonraki adım. Ajan ekranında görünür (bugünkü "ilk 160 karakter" özetinin yerine) | P0 | F1 | M | KOD, AR |
| AI-11 | **Devirden sonra AI'ın susması:** sohbet insana geçince AI cevap üretmeyi bırakır; istenirse ajan "AI'a geri ver" diyebilir | P0 | F1 | S | KOD |
| AI-12 | **Devir hedefi ve öncelik:** takım seçici (serbest metin yerine), konu → ekip eşlemesi (Finans, KYC/Risk, Bonus, Sorumlu Oyun, Teknik, Şikâyet), acil öncelik, mesai dışı davranışı | P0 | F1 | M | KOD, AR |

### 1.2 Bilgi modeli
| ID | Madde | Öncelik | Faz | Efor | Kaynak |
|---|---|---|---|---|---|
| AI-13 | **Yapılandırılmış bilgi tabloları:** Ödeme Yöntemleri (min/max, beklenen süre, gecikme eşiği, çalışma saatleri, sık hatalar), Bonuslar (çevrim, max bahis…), KYC belgeleri, Limitler ve kurallar, **Erişim bilgisi** (bilgi bankası / o an çekilen kaynak / sabit link; karar K13) | P0 | F1 | M | AR |
| AI-14 | **Tek bilgi deposu:** her kaynakta "kim kullanır" (AI Agent / Copilot / Herkese açık KB) seçimi, marka kapsamı, "son gözden geçirme" tarihi ve sahibi (bugün AI Agent ve Copilot'a aynı bilgi ayrı ayrı giriliyor) | P1 | F1 | M | KOD, LC |
| AI-15 | **iGaming hazır prosedür şablonları:** 20 konu (yatırım geçmedi, çekim beklemede/reddedildi, KYC, bonus, çevrim, bahis itirazı, oyun hatası, giriş, hesap kilidi, self-exclusion, sorumlu oyun, limit, ödeme yöntemleri, yanlış hesap/ağ, promosyon, bilgi değişikliği, şikâyet, erişim, çoklu hesap) Türkçe | P0 | F1 | M | AR |
| AI-16 | **Gerçek dil modeli ve embedding'in açılması:** pilot için OpenAI uyumlu sağlayıcının varsayılan yapılması, maliyet ve kota takibi | P0 | F1 | S | KOD [A-18] |
| AI-17 | **Gerçek web sitesi taraması:** çok sayfa, sitemap, sayfa sınırı, periyodik yenileme (bugün sahte, tek sayfa) | P1 | F1 | M | KOD [A-15, A-21, A-22] |
| AI-18 | **PDF/DOCX bilgi kaynağı** ve daha büyük dosya sınırı | P1 | F1 | M | KOD [A-27] |

### 1.3 Test, yayın ve kalite döngüsü
| ID | Madde | Öncelik | Faz | Efor | Kaynak |
|---|---|---|---|---|---|
| AI-19 | **Çok turlu test ve simülasyon:** "oyuncu gibi konuş" alanı; senaryolar (sabırsız, eksik bilgi veren, sorumlu oyun sinyali veren oyuncu); beklenen sonuç; yayın öncesi toplu yeniden koşma (regresyon) | P0 | F1 | L | AR, CB, KOD |
| AI-20 | **Taslak → test → onay → yayın:** sürüm numarası, geri alma, "dört göz" onayı (Ekip Lideri hazırlar, Yönetici yayınlar) | P1 | F1 | M | AR, KOD |
| AI-21 | **AI ayar değişiklik geçmişi:** bilgi, kural, prosedür ve profil değişikliklerinde kim, ne zaman, ne değiştirdi (bugün yalnız silme işlemleri kaydediliyor) | P1 | F1 | S | KOD |
| AI-22 | **Çözülemeyen sorular ve bilgi boşluğu raporu:** hiçbir şeye uymayan mesajların kaydedilmesi (bugün iz bırakmıyor), benzerlerin gruplanması, hacme göre sıralanması | P0 | F1 | M | KOD, AR, CB |
| AI-23 | **Koçluk ve öneri kuyruğu:** ajanın sohbetten "bunu bilgiye ekle", "AI yanlış cevapladı" diyebilmesi; ajanın başarılı cevabından bilgi önerisi üretilmesi; Ekip Lideri onayı | P1 | F1 | M | AR, LC |
| AI-24 | **Kalite kontrol (QA) kuyruğu:** haftalık örneklem + risk bayraklı sohbetlerin tamamı; puan kartı; LLM ön puanlama, Ekip Lideri onayı | P1 | F1 | M | AR |
| AI-25 | **AI metrikleri:** onaylı çözüm, yanlış çözüm (72 saat içinde aynı konuyla tekrar gelme), zorunlu devir uyumu, devir kalitesi, bot memnuniyeti (BSAT), tutarlılık | P1 | F1 | M | AR, KOD |

### 1.4 iGaming güvenliği ve gelecek
| ID | Madde | Öncelik | Faz | Efor | Kaynak |
|---|---|---|---|---|---|
| AI-26 | **Sohbet içi hassas veri maskeleme:** şifre, OTP, kart, CVV, seed phrase, IBAN paylaşılırsa maskeleme ve oyuncuya uyarı (mevcut kart maskelemenin genişletilmesi) | P0 | F1 | S | AR, KOD |
| AI-27 | **Risk bayrakları:** sorumlu oyun, reşit olmama şüphesi, şikâyet, fraud. Bayraklı sohbette promosyon ve bonus önerisi engellenir; bayrak ajan ve raporlarda görünür | P0 | F1 | M | AR |
| AI-28 | **Araç (entegrasyon) yuvası:** prosedürlerde "burada hesap kontrol edilecek" adımı için şema hazır, F1'de pasif; F2'de `deposit_lookup` gibi araçlar bağlanır | P2 | F2 | M | AR, SEN |
| AI-29 | **Şeffaflık ve "insanla görüş" butonu:** AI kendini tanıtır; widget'ta her zaman görünen insana geç seçeneği | P1 | F1 | S | AR (G16) |
| AI-30 | **Çok dilli yanıt:** TR varsayılan; oyuncunun diline göre cevap; dil algılamanın LLM'e taşınması | P2 | F1 | S | KOD |

---

## 2. Kimlikler, gün içi hafıza ve aranabilir kayıtlar (ID)

| ID | Madde | Öncelik | Faz | Efor | Kaynak |
|---|---|---|---|---|---|
| ID-01 | **Kimlik sözlüğü:** "thread ID" ve "chat ID" kavramlarının nexa'daki karşılıklarının tek bir tanımla sabitlenmesi (nexa'da Chat/Thread terimleri LiveChat'teki anlamıyla kullanılıyor olabilir; bkz. 04'teki soru) | P0 | F1 | S | SEN, KOD |
| ID-02 | **Günlük thread (üye + gün):** üyenin o günkü ilk bağlantısı yeni thread ID ve chat ID alır; aynı gün tekrar gelirse thread ID aynı kalır, chat ID yenilenir; ertesi gün ikisi de yenilenir | P0 | F1 | M | SEN |
| ID-03 | **Üye tanıma ve doğrulama:** **widget'ın kendi ürettiği imzalı token/çerezle** üyenin geri gelişte doğrulanması (mekanizma kurulacak, karar K4); başka cihazdan gelişte ajan onayı; kullanıcı adı/e-posta tek başına eşleştirmez; commit'lenmemiş `customer_username` işinin tamamlanması | P0 | F1 | M | SEN, KOD |
| ID-04 | **Gün sınırı ve saat dilimi:** "aynı gün" tanımı kiracı ayarı (varsayılan Europe/Istanbul, 00:00) | P1 | F1 | S | SEN |
| ID-05 | **ID'lerin arayüzde görünmesi ve kopyalanması:** Inbox başlığı, arşiv, müşteri profili, devir kartı, loglar | P0 | F1 | S | SEN |
| ID-06 | **ID ile arama:** global arama, komut paleti ve arşivde chat ID, thread ID, kullanıcı adı ve e-posta ile doğrudan bulma | P0 | F1 | S | SEN, LC |
| ID-07 | **Mesaj içeriğinde serbest metin arama:** arşivde ve global aramada mesaj metninde arama (bugün yalnız son 50 sohbet) | P0 | F1 | L | LC [E2, C11] |
| ID-08 | **Yapılandırılmış ve aranabilir loglar:** her log satırında kiracı, chat ID, thread ID, üye ID; AI kararları (hangi prosedür, hangi kaynak, neden devir) zaman çizelgesi olarak | P0 | F1 | M | SEN, KOD |
| ID-09 | **Log/zaman çizelgesi görüntüleyici:** bir chat veya thread için tüm olaylar (mesaj, AI kararı, devir, kural, etiket) tek ekranda; metin araması (Ctrl+F dostu), dışa aktarma | P1 | F1 | M | SEN |

---

## 3. Roller ve yetkiler (RL)

| ID | Madde | Öncelik | Faz | Efor | Kaynak |
|---|---|---|---|---|---|
| RL-01 | **Rol seti:** Kurucu / Yönetici / Ekip Lideri / Ekip Üyesi (bugün owner / vice owner / admin / agent; Ekip Lideri yok) | P0 | F1 | M | SEN, KOD |
| RL-02 | **Yapılandırılabilir izin matrisi:** rol × yetenek tablosu, kiracı bazında düzenlenebilir varsayılanlar ("kim neyi görecek" kararını sonraya bırakabilmek için) | P0 | F1 | L | SEN |
| RL-03 | **Ekip Lideri yetenekleri:** kendi ekibinin sohbetlerini izleme/devralma, QA onayı, AI taslağı hazırlama ve yayına gönderme | P1 | F1 | M | AR, SEN |
| RL-04 | **Davette varsayılan rolün en düşük rol olması** (bugün `admin`) | P1 | F1 | S | LC, KOD |
| RL-05 | **Sahiplik (Kurucu) devri** | P2 | F1 | M | LC [T23] |
| RL-06 | **Profil adı düzenleme ve uygulama içinden şifre değiştirme** | P1 | F1 | S | LC [T14, T18] |

---

## 4. Inbox / sohbet deneyimi (IN)

| ID | Madde | Öncelik | Faz | Efor | Kaynak |
|---|---|---|---|---|---|
| IN-01 | **Yazılan taslağın sohbetler arasında taşınmasının düzeltilmesi** (yanlış oyuncuya mesaj gitme riski) + sohbet başına taslak saklama | P0 | F1 | S | KOD [D15] |
| IN-02 | **Sağ panelde oyuncu kartı:** ad, kullanıcı adı, e-posta, ülke; pre-chat cevapları; aynı oyuncunun geçmiş sohbetleri ve aynı gün thread'i | P0 | F1 | M | LC [D37–D39] |
| IN-03 | Sohbet satırında bekleme süresi | P1 | F1 | S | LC [D4] |
| IN-04 | Takıma transfer: arayüzde yok; API'den yapılınca sohbet kimseye atanmadan kuyruk dışında kalıyor | P1 | F1 | S | KOD [D7] |
| IN-05 | Okundu bilgisi gösterimi (alan contract'ta var; widget bugün "okundu" kaydı göndermiyor) | P1 | F1 | S | KOD [D34] |
| IN-06 | Hazır yanıtlar: içerikte arama, 6'dan fazla sonuç, değişkenler (%oyuncu-adı%…), kişisel (private) yanıtlar | P1 | F1 | S | LC [D17, D18, A-30, A-33] |
| IN-07 | Olaya bağlı önerilen yanıtlar (sohbet başladı, aktarıldı, sessiz kaldı, puanlandı) | P2 | F1 | M | LC [A-37] |
| IN-08 | Klavye kısayolları listesi (Shift+/) ve sohbetler arası geçiş kısayolları | P1 | F1 | S | LC [C26, D29] |
| IN-09 | Her ekrandan açılabilen Copilot paneli | P1 | F1 | M | LC [C15] |
| IN-10 | Olay bazlı bildirim tercihleri ve okunana kadar tekrarlayan ses | P1 | F1 | S | LC [C20, C21] |
| IN-11 | Komut paletinden ayar alt sayfalarına gitme | P1 | F1 | S | LC [C8] |

---

## 5. Arşiv (AR)

| ID | Madde | Öncelik | Faz | Efor | Kaynak |
|---|---|---|---|---|---|
| AR-01 | **Ayrı arşiv ekranı:** liste + transkript + oyuncu paneli (bugün yalnız Inbox içinde bir görünüm) | P1 | F1 | M | LC [E1] |
| AR-02 | **Filtreler:** tarih (P0), ajan, ekip, puan, etiket, AI/insan, risk bayrağı; filtrelerin URL'de tutulması | P0 | F1 | M | LC [E3–E7, E11] |
| AR-03 | Arşivde puan ve yorumun gösterimi | P1 | F1 | S | LC [E14] |
| AR-04 | Transkripti dışa aktarma, yazdırma, e-postayla gönderme | P1 | F1 | M | LC [E15] |

---

## 6. HelpDesk / ticket (HD)

| ID | Madde | Öncelik | Faz | Efor | Kaynak |
|---|---|---|---|---|---|
| HD-01 | **Ticket'a yanıt verme ve yazışma geçmişi** + iç not | P0 | F1 | L | KOD [H3, H8] |
| HD-02 | **Gelen e-postanın gövdesi ve eklerinin kaydedilmesi** (bugün yalnız konu) | P0 | F1 | M | KOD [H2] |
| HD-03 | **E-posta yazışma zinciri:** müşterinin yanıtı aynı ticket'a bağlanır | P0 | F1 | M | KOD [H4] |
| HD-04 | Otomatik "talebiniz alındı" yanıtı | P1 | F1 | S | LC [H5] |
| HD-05 | Ticket ilk yanıt SLA'sı | P1 | F1 | S | LC [H9] |

---

## 7. Widget ve sohbet ayarları (WG)

| ID | Madde | Öncelik | Faz | Efor | Kaynak |
|---|---|---|---|---|---|
| WG-01 | **Pre-chat formu:** aç/kapat, yerleşik alanların (ad, kullanıcı adı, e-posta, mesaj) zorunluluğunun seçilebilmesi | P0 | F1 | S | LC, KOD |
| WG-02 | **Widget dili panelden seçilebilir** ve tarayıcı dili algılanır (TR pilotunda İngilizce açılma sorunu) | P0 | F1 | S | LC, KOD |
| WG-03 | **Ajan yanıt vermezse sohbeti başka ajana aktarma** + "inactive" durumu | P0 | F1 | M | LC, KOD |
| WG-04 | Form alan tipleri: seçim listesi, dropdown, çoklu seçim, **konu/departman seçimi → ekibe yönlendirme**; soruları düzenleyebilme | P1 | F1 | M | LC |
| WG-05 | Widget metinlerini özelleştirme (çevrimdışı, kuyruk, placeholder) + kuyrukta tahmini bekleme süresi | P1 | F1 | M | LC |
| WG-06 | Oyuncuya transkript e-postası + tüm transkriptleri bir adrese iletme | P1 | F1 | M | LC |
| WG-07 | Manuel atama modu (herkese bildirim, ilk alan alır) | P1 | F1 | M | LC |
| WG-08 | "E-posta iste": ajan X dakika yanıt vermezse / çevrimdışıyken | P1 | F1 | M | LC |
| WG-09 | Uygunluk ayarı: "her zaman" / "yalnız ajan varken" | P1 | F1 | S | LC |
| WG-10 | Launcher görünürlük modları ve widget logosu | P1 | F1 | S | LC |
| WG-11 | Puanlamaya yorum ekleme | P1 | F1 | S | LC |
| WG-12 | Widget içinde bilgi bankası araması | P1 | F1 | M | LC |
| WG-13 | Kurulum: sihirbazda snippet + kopyala; WordPress ve benzeri platform eklentileri | P2 | F1 | L | LC [A2, A8] |
| WG-14 | **Settings sayfalarında kaydedilmemiş değişiklik uyarısı** (altyapı var, bağlanmamış) | P1 | F1 | S | KOD, LC dersi |
| WG-15 | `<noscript>` yedek linki, kurulum rehberi linki | P2 | F1 | S | LC [A6, A9] |

---

## 8. Engage / kampanyalar (EN)

| ID | Madde | Öncelik | Faz | Efor | Kaynak |
|---|---|---|---|---|---|
| EN-01 | **Risk bayraklı oyuncuya kampanya/bonus gösterilmemesi** (sorumlu oyun) | P0 | F1 | S | AR (G4) |
| EN-02 | Zengin kampanya kartı: başlık, görsel, en fazla 5 buton (mesaj gönder / URL aç / kupon kopyala); aynı kart bot mesajlarında da | P1 | F1 | M | LC [E-23…E-29, A-19] |
| EN-03 | Çok koşullu hedefleme: çıkış niyeti, sayfada kalma süresi, ülke, referrer, yeni/geri gelen, özel değişken, AND/OR | P1 | F1 | M | LC [E-36…E-48] |
| EN-04 | "Geçerli sayfa URL'si" koşulunun hatalı çalışmasının düzeltilmesi | P1 | F1 | S | KOD |
| EN-05 | Kampanya silme, kampanya raporu, şablon galerisi | P1 | F1 | M | LC [E-15, E-12, E-16] |
| EN-06 | Hedeflerde (Goals) özel sayfa olayı | P2 | F1 | M | LC [E-56] |

---

## 9. Raporlar (RP)

| ID | Madde | Öncelik | Faz | Efor | Kaynak |
|---|---|---|---|---|---|
| RP-01 | Ajan, ekip, etiket ve konu filtreleri; ajan/ekip raporlarına derin link | P1 | F1 | M | LC [RF3, RF4, T10, T32] |
| RP-02 | Kaçan sohbetler ve etkileşim (kim başlattı) raporları | P1 | F1 | M | LC [R5, R6] |
| RP-03 | Uygunluk ve ajan aktivitesi (durum zaman çizelgesi) | P1 | F1 | M | LC [R10, R16] |
| RP-04 | Kuyruk bekleme ve terk raporları (`queued_at` verisi hazır) | P1 | F1 | M | LC [R17, R18] |
| RP-05 | Günlük / haftalık özet e-postaları | P1 | F1 | M | LC [T25] |

---

## 10. Otomasyon ve yönlendirme (AU)

| ID | Madde | Öncelik | Faz | Efor | Kaynak |
|---|---|---|---|---|---|
| AU-01 | **Konuya göre ekip yönlendirmesi:** Finans, KYC/Risk, Bonus, Sorumlu Oyun (yalnız eğitimli ajanlar), Teknik, Şikâyet kuyrukları; AI devri ve pre-chat konu seçimi buraya bağlanır | P0 | F1 | M | AR, SEN |
| AU-02 | Yönlendirme kuralları arayüzünün API ile eşitlenmesi (tam URL, ülke, çoklu URL) | P1 | F1 | S | KOD [A-41, A-44] |
| AU-03 | Tetikleyiciler: "sohbet puanlandı", ticket yaşam döngüsü olayları | P1 | F1 | M | LC [A-55, A-60] |

---

## 11. Kanallar ve entegrasyonlar (KN)

| ID | Madde | Öncelik | Faz | Efor | Kaynak |
|---|---|---|---|---|---|
| KN-01 | Gerçek WhatsApp kanalı (bugün mock) | P1 | F1 | L | LC [P8] |
| KN-02 | Gerçek Messenger / Instagram kanalları | P2 | F1 | L | LC [P4, P8] |
| KN-03 | Webhook teslim günlüğü arayüzü | P1 | F1 | S | KOD [D14] |
| KN-04 | Barındırılan API dokümanı | P1 | F1 | S | LC [D2] |
| KN-05 | Uygulamaların ajan arayüzüne panel ekleyebilmesi (iframe SDK) | P2 | F2 | L | LC [A16] |
| KN-06 | iGaming platform entegrasyonları (BetConstruct, EveryMatrix vb.): oyuncu/işlem sorgulama, AI-28 araç yuvasına bağlanır. **Şimdilik (F1):** 1–2 platform kartı pasif "Bağla" butonuyla "Yakında" olarak görünür (karar K15) | P1 | F2 | L | SEN |

---

## 12. Faturalama (BL)

| ID | Madde | Öncelik | Faz | Efor | Kaynak |
|---|---|---|---|---|---|
| BL-01 | Ödeme yöntemleri: **SWIFT** (elle onay), **kripto** ("Adres isteyin" talep akışı, TXID ile onay), **Stripe** (kart); bugün mock (karar K16) | P1 | F1 | L | LC [B11] |
| BL-02 | Fatura PDF'i, fatura adresi, vergi numarası | P1 | F1 | M | LC [B13, B14] |
| BL-03 | Abonelik iptali | P2 | F1 | S | LC [B17] |

---

## 13. Güvenlik, altyapı ve UX dersleri (GV)

| ID | Madde | Öncelik | Faz | Efor | Kaynak |
|---|---|---|---|---|---|
| GV-01 | **Widget'ta kötüye kullanım koruması:** CAPTCHA/oran sınırı; yabancının kiracının günlük AI kotasını tüketememesi | P0 | F1 | M | KOD (risk listesi) |
| GV-02 | **Kalıcı AI iş kuyruğu:** sunucu çökerse bekleyen AI yanıtının kaybolmaması | P0 | F1 | M | KOD (risk listesi) |
| GV-03 | **Davet akışının kötüye kullanımının engellenmesi** (başkasının adresine hesap açma) | P0 | F1 | S | KOD (risk listesi) |
| GV-04 | Panelin dar ekranlarda kullanılabilir olması | P1 | F1 | M | KOD (risk listesi) |
| GV-05 | Kişisel verinin URL'lerde olmaması (LiveChat ajan e-postasını URL'ye koyuyor; nexa'da tekrarlanmaması) | P1 | F1 | S | LC dersi |
| GV-06 | Tutarlı kaydetme kalıbı (anında kaydeden toggle ile Save butonlu sayfaların karışmaması) | P1 | F1 | S | LC dersi, KOD |
