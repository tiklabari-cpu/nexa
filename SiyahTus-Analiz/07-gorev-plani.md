# 07 — Görev planı (Task Master #269–#388)

> **Ne bu dosya?** 03'teki 109 maddenin Task Master görevlerine nasıl dönüştüğünü gösterir: madde → görev eşlemesi, dalgalar, bu turda eklenen kararlar (K17–K27), paket ile kod arasındaki sapmalar ve açık riskler. Tarih: 2026-10-14. Kod HEAD: `120bb3d`.
>
> **Kaynak sırası:** 06 → 03 → 04 (Karar kaydı K1–K27 ve "Kararların maddelere etkisi"; madde içi varsayılanların önüne geçer) → 05 → 01. Görevlerin `details` alanı bu sırayı ve 05'in kodlama mantığını taşır.
>
> **Terim eşlemesi (K1=A):** ekranda **"Thread ID"** = nexa **Chat** (kod alanı `chat_id`, üyenin o günkü konuşma grubu); ekranda **"Chat ID"** = nexa **Thread** (kod alanı `thread_id`, tek bağlantı). Kod, DB ve API adları değişmez; çeviri yalnız sunum katmanında yapılır. Her görevin `details` alanının başında bu eşleme yazılıdır.

## 0. Özet

**Toplam:** 120 görev (#269–#388), 141 alt görev. Öncelik: high 59, medium 49, low 12. Durum: pending 116, deferred 4 (#322, #378, #379, #388).

- **Öncelik eşlemesi:** P0 → high, P1 → medium, P2 → low. **Öncelik devri:** high bir görevin bağımlı olduğu görev de high yapıldı; yoksa otonom döngü önkoşula sıra vermez (ör. #281 RL-04, #291 RP-04 veri yakalama, #323 GV-06/WG-14, #335 AR-01).
- **Etiketler:** PLAN §5.1.1 matrisi (`[SONNET|OPUS-HIGH|XHIGH|MAX]`). Her XHIGH etiketinin gerekçesi görev ayrıntısında adıyla yazılı; authZ/kripto/kiracı izolasyonu/eşzamanlılık/algoritma işleri `OPUS-MAX`. **Gözden geçirme (2026-10-14, sahip):** #385–#386 `OPUS-MEDIUM` (matriste yok; `run-loop.sh` tanımaz), #320/#323/#338/#345/#350/#370 `OPUS-HIGH`, #346 `OPUS-XHIGH`. Task Master başlıklarında etiketin ardına `(Opus 5.5)` / `(Sonnet 5.5)` yazılıdır; bu tabloda yazılmaz.
- **Görev biçimi:** başlık `KOD [ETİKET] açıklama`; `description` sonunda "Kaynak: …"; `details` = ortak üst bilgi (kaynak, K1=A, contract-first sıra, protokol, satır numaralarını yeniden doğrulama notu, dalga) + 05 mantığı + **KABUL KRİTERLERİ** + **KULLANILAN VARSAYIMLAR**; `testStrategy` sonunda DoD satırı. L maddeler alt görevlere bölündü; alt görev bağımlılıkları `"<üst>.<n>"` biçiminde.
- **F2 / deferred:** #322 (AI-28 aktif araç kullanımı), #378 (KN-06 gerçek entegrasyon), #379 (KN-05 iframe SDK), #388 (operatörün imzaladığı kimlik). KN-06'nın F1 pasif "Bağla" kartları (K15) normal görev: #377.
- **Doğrulama (bu turda koşuldu):** `tasks.json` JSON olarak geçerli; id'ler tekrarsız ve 269–388 ardışık; tüm bağımlılıklar mevcut, döngü yok (alt görevler dahil, alt görev yalnız önceki kardeşe bağlı); aktif hiçbir görev deferred bir göreve bağlı değil; 109 maddenin hepsi en az bir göreve eşli; `git diff` mevcut 268 göreve dokunmuyor (yalnız ekleme + metadata `taskCount` 388, `lastModified`).

### İlk başlanacak görevler

Bağımlılığı olmayan high görevler, `run-loop.sh` seçimine göre en küçük id önce:

1. **#269** ADR-14a ek notu (Skill çok turlu prosedür) — Dalga 0
2. **#270** LLM ADR §6a ek notu (JSON çıktı var, araç çağırma yok) — Dalga 0
3. **#271** ADR-08a ek notu (ekip kuyruğu, devir anında yönlendirme) — Dalga 0
4. **#272** ADR-09a ek notu (devredilen sohbet "AI çözümü" sayılmaz) — Dalga 0
5. **#273** ADR-11a ek notu (kalıcı AI kuyruğu Postgres'te) — Dalga 0

Ardından Dalga 1: #277 IN-01, #278 customer_username kapanışı, #280 WG-02, #281 RL-04, #282 GV-03 (bağımsız), #279 WG-01 ve #283 AI-16 (önkoşullarından sonra).

## 1. Madde → görev eşlemesi (109/109)

Her madde en az bir göreve bağlı. "Ana görev" maddenin asıl işini yapan görevdir; "Diğer" kolonunda maddeye ek iş yapan (ADR eki, ön görev, F2 parçası, ortak bileşen) görevler var.


### Kimlikler (ID)

| Madde | Başlık (03) | Öncelik | Ana görev | Diğer görevler |
|---|---|---|---|---|
| ID-01 | Kimlik sözlüğü: "thread ID" ve "chat ID" kavramlarının nexa'daki karşılıklarının tek bir tanımla sabitlenme… | P0 | #284 ID-GLOSSARY | – |
| ID-02 | Günlük thread (üye + gün): üyenin o günkü ilk bağlantısı yeni thread ID ve chat ID alır; aynı gün tekrar ge… | P0 | #286 DAILY-THREAD | – |
| ID-03 | Üye tanıma ve doğrulama: widget'ın kendi ürettiği imzalı token/çerezle üyenin geri gelişte doğrulanması (me… | P0 | #287 MEMBER-TOKEN | #278, #388 (deferred) |
| ID-04 | Gün sınırı ve saat dilimi: "aynı gün" tanımı kiracı ayarı (varsayılan Europe/Istanbul, 00:00) | P1 | #285 DAY-BOUNDARY | – |
| ID-05 | ID'lerin arayüzde görünmesi ve kopyalanması: Inbox başlığı, arşiv, müşteri profili, devir kartı, loglar | P0 | #329 ID-DISPLAY-COPY | – |
| ID-06 | ID ile arama: global arama, komut paleti ve arşivde chat ID, thread ID, kullanıcı adı ve e-posta ile doğrud… | P0 | #332 ID-SEARCH | – |
| ID-07 | Mesaj içeriğinde serbest metin arama: arşivde ve global aramada mesaj metninde arama (bugün yalnız son 50 s… | P0 | #333 MESSAGE-FULLTEXT-SEARCH | – |
| ID-08 | Yapılandırılmış ve aranabilir loglar: her log satırında kiracı, chat ID, thread ID, üye ID; AI kararları (h… | P0 | #288 STRUCTURED-LOGS-AI-DECISIONS | – |
| ID-09 | Log/zaman çizelgesi görüntüleyici: bir chat veya thread için tüm olaylar (mesaj, AI kararı, devir, kural, e… | P1 | #334 TIMELINE-VIEWER | – |

### AI ajanı (AI)

| Madde | Başlık (03) | Öncelik | Ana görev | Diğer görevler |
|---|---|---|---|---|
| AI-01 | Sohbet içi konuşma hafızası: AI her mesajda o sohbetin önceki mesajlarını görür; cevabı "yeni mesaj" gibi b… | P0 | #292 AI-CONVERSATION-CORE | – |
| AI-02 | Gün içi hafıza (thread ile): üye aynı gün yeni bir chat açarsa, AI aynı thread'deki önceki chat'lerin özeti… | P0 | #294 AI-DAILY-MEMORY | – |
| AI-03 | Prosedür (konu akışı) motoru: çok turlu, sırayla soru soran, cevaba göre dallanan, "ne zaman kullanılır" gi… | P0 | #296 AI-PROCEDURE-ENGINE | #269 |
| AI-04 | Bilgi toplama (slot) sistemi: sorulan sorunun cevabını çıkarır, doğrular (tarih, tutar, TXID formatı), sakl… | P0 | #295 AI-SLOTS | #270 |
| AI-05 | LLM tabanlı konu tespiti ve prosedür seçimi: kelime örtüşmesi yerine anlama dayalı seçim; prosedür önceliği… | P0 | #297 AI-UNDERSTAND-SELECT | #270 |
| AI-06 | Bilgi bankasından genel yanıt + "bilmiyorum" davranışı: hiçbir prosedür uymazsa bilgi bankasından cevap ver… | P0 | #298 AI-KNOWLEDGE-ANSWER | #270 |
| AI-07 | Davranış talimatları (Guidance) ekranı: "önce yöntemi sor", "tek mesajda en fazla 2 soru" gibi düz yazıyla… | P0 | #299 AI-GUIDANCE-RULES | #270 |
| AI-08 | Uyum korumaları (guardrail) seti: platformun kilitlediği temel kurallar (G1–G19: sorumlu oyun, reşit olmaya… | P0 | #301 AI-GUARDRAILS | #270 |
| AI-09 | Otomatik insana devir tetikleyicileri (kiracı yapılandırır, karar K9): AI "çözüldü" kararını kiracının tanı… | P0 | #303 AI-HANDOFF-TRIGGERS-RULES | – |
| AI-10 | Yapılandırılmış devir kartı: konu, oyuncu, toplanan bilgiler, AI'ın söyledikleri, devir nedeni, risk bayrak… | P0 | #304 AI-HANDOFF-CARD | – |
| AI-11 | Devirden sonra AI'ın susması: sohbet insana geçince AI cevap üretmeyi bırakır; istenirse ajan "AI'a geri ve… | P0 | #293 AI-FIRST-AND-SILENCE | #271, #272 |
| AI-12 | Devir hedefi ve öncelik: takım seçici (serbest metin yerine), konu → ekip eşlemesi (Finans, KYC/Risk, Bonus… | P0 | #307 AI-HANDOFF-TARGET-PRIORITY | #271 |
| AI-13 | Yapılandırılmış bilgi tabloları: Ödeme Yöntemleri (min/max, beklenen süre, gecikme eşiği, çalışma saatleri,… | P0 | #310 KB-STRUCTURED-TABLES | – |
| AI-14 | Tek bilgi deposu: her kaynakta "kim kullanır" (AI Agent / Copilot / Herkese açık KB) seçimi, marka kapsamı,… | P1 | #309 KB-SINGLE-STORE | #274 |
| AI-15 | iGaming hazır prosedür şablonları: 20 konu (yatırım geçmedi, çekim beklemede/reddedildi, KYC, bonus, çevrim… | P0 | #311 IGAMING-TEMPLATES | #275 |
| AI-16 | Gerçek dil modeli ve embedding'in açılması: pilot için OpenAI uyumlu sağlayıcının varsayılan yapılması, mal… | P0 | #283 AI-REAL-LLM-READINESS | #270 |
| AI-17 | Gerçek web sitesi taraması: çok sayfa, sitemap, sayfa sınırı, periyodik yenileme (bugün sahte, tek sayfa) | P1 | #312 REAL-WEB-CRAWLER | – |
| AI-18 | PDF/DOCX bilgi kaynağı ve daha büyük dosya sınırı | P1 | #313 DOCUMENT-SOURCES | – |
| AI-19 | Çok turlu test ve simülasyon: "oyuncu gibi konuş" alanı; senaryolar (sabırsız, eksik bilgi veren, sorumlu o… | P0 | #292 AI-CONVERSATION-CORE | #314 |
| AI-20 | Taslak → test → onay → yayın: sürüm numarası, geri alma, "dört göz" onayı (Ekip Lideri hazırlar, Yönetici y… | P1 | #290 AI-CONFIG-VERSION-DESIGN | #316 |
| AI-21 | AI ayar değişiklik geçmişi: bilgi, kural, prosedür ve profil değişikliklerinde kim, ne zaman, ne değiştirdi… | P1 | #315 AI-CONFIG-HISTORY | – |
| AI-22 | Çözülemeyen sorular ve bilgi boşluğu raporu: hiçbir şeye uymayan mesajların kaydedilmesi (bugün iz bırakmıy… | P0 | #317 AI-UNRESOLVED-QUESTIONS | #270 |
| AI-23 | Koçluk ve öneri kuyruğu: ajanın sohbetten "bunu bilgiye ekle", "AI yanlış cevapladı" diyebilmesi; ajanın ba… | P1 | #318 AI-COACHING-SUGGESTIONS | #270 |
| AI-24 | Kalite kontrol (QA) kuyruğu: haftalık örneklem + risk bayraklı sohbetlerin tamamı; puan kartı; LLM ön puanl… | P1 | #319 AI-QA-QUEUE | #270 |
| AI-25 | AI metrikleri: onaylı çözüm, yanlış çözüm (72 saat içinde aynı konuyla tekrar gelme), zorunlu devir uyumu,… | P1 | #320 AI-QUALITY-METRICS | #272 |
| AI-26 | Sohbet içi hassas veri maskeleme: şifre, OTP, kart, CVV, seed phrase, IBAN paylaşılırsa maskeleme ve oyuncu… | P0 | #300 SENSITIVE-MASKING | – |
| AI-27 | Risk bayrakları: sorumlu oyun, reşit olmama şüphesi, şikâyet, fraud. Bayraklı sohbette promosyon ve bonus ö… | P0 | #302 AI-RISK-FLAGS | – |
| AI-28 | Araç (entegrasyon) yuvası: prosedürlerde "burada hesap kontrol edilecek" adımı için şema hazır, F1'de pasif… | P2 | #321 AI-TOOL-SLOT-F1 | #269, #322 (deferred) |
| AI-29 | Şeffaflık ve "insanla görüş" butonu: AI kendini tanıtır; widget'ta her zaman görünen insana geç seçeneği | P1 | #308 AI-TRANSPARENCY-HUMAN-BUTTON | – |
| AI-30 | Çok dilli yanıt: TR varsayılan; oyuncunun diline göre cevap; dil algılamanın LLM'e taşınması | P2 | #387 AI-MULTILINGUAL | – |

### Inbox (IN)

| Madde | Başlık (03) | Öncelik | Ana görev | Diğer görevler |
|---|---|---|---|---|
| IN-01 | Yazılan taslağın sohbetler arasında taşınmasının düzeltilmesi (yanlış oyuncuya mesaj gitme riski) + sohbet… | P0 | #277 INBOX-DRAFT-ISOLATION | – |
| IN-02 | Sağ panelde oyuncu kartı: ad, kullanıcı adı, e-posta, ülke; pre-chat cevapları; aynı oyuncunun geçmiş sohbe… | P0 | #330 GEOIP-COUNTRY | #331 |
| IN-03 | Sohbet satırında bekleme süresi | P1 | #361 INBOX-WAITING-TIMER | – |
| IN-04 | Takıma transfer: arayüzde yok; API'den yapılınca sohbet kimseye atanmadan kuyruk dışında kalıyor | P1 | #306 INBOX-TRANSFER-TO-TEAM | – |
| IN-05 | Okundu bilgisi gösterimi (alan contract'ta var; widget bugün "okundu" kaydı göndermiyor) | P1 | #362 READ-RECEIPTS | – |
| IN-06 | Hazır yanıtlar: içerikte arama, 6'dan fazla sonuç, değişkenler (%oyuncu-adı%…), kişisel (private) yanıtlar | P1 | #363 CANNED-SEARCH-VARS-PRIVATE | – |
| IN-07 | Olaya bağlı önerilen yanıtlar (sohbet başladı, aktarıldı, sessiz kaldı, puanlandı) | P2 | #364 EVENT-SUGGESTED-REPLIES | – |
| IN-08 | Klavye kısayolları listesi (Shift+/) ve sohbetler arası geçiş kısayolları | P1 | #365 SHORTCUTS-PALETTE-SETTINGS | – |
| IN-09 | Her ekrandan açılabilen Copilot paneli | P1 | #366 COPILOT-DRAWER | – |
| IN-10 | Olay bazlı bildirim tercihleri ve okunana kadar tekrarlayan ses | P1 | #367 EVENT-NOTIFICATIONS-REPEAT | – |
| IN-11 | Komut paletinden ayar alt sayfalarına gitme | P1 | #365 SHORTCUTS-PALETTE-SETTINGS | – |

### Arşiv (AR)

| Madde | Başlık (03) | Öncelik | Ana görev | Diğer görevler |
|---|---|---|---|---|
| AR-01 | Ayrı arşiv ekranı: liste + transkript + oyuncu paneli (bugün yalnız Inbox içinde bir görünüm) | P1 | #335 ARCHIVE-SCREEN | – |
| AR-02 | Filtreler: tarih (P0), ajan, ekip, puan, etiket, AI/insan, risk bayrağı; filtrelerin URL'de tutulması | P0 | #336 ARCHIVE-FILTERS | #272 |
| AR-03 | Arşivde puan ve yorumun gösterimi | P1 | #337 RATING-COMMENT | – |
| AR-04 | Transkripti dışa aktarma, yazdırma, e-postayla gönderme | P1 | #338 TRANSCRIPT-EXPORT | – |

### HelpDesk (HD)

| Madde | Başlık (03) | Öncelik | Ana görev | Diğer görevler |
|---|---|---|---|---|
| HD-01 | Ticket'a yanıt verme ve yazışma geçmişi + iç not | P0 | #356 TICKET-REPLY-THREAD | – |
| HD-02 | Gelen e-postanın gövdesi ve eklerinin kaydedilmesi (bugün yalnız konu) | P0 | #357 INBOUND-EMAIL-BODY | – |
| HD-03 | E-posta yazışma zinciri: müşterinin yanıtı aynı ticket'a bağlanır | P0 | #358 EMAIL-THREADING | – |
| HD-04 | Otomatik "talebiniz alındı" yanıtı | P1 | #359 TICKET-AUTO-ACK | – |
| HD-05 | Ticket ilk yanıt SLA'sı | P1 | #360 TICKET-FIRST-RESPONSE-SLA | – |

### Roller (RL)

| Madde | Başlık (03) | Öncelik | Ana görev | Diğer görevler |
|---|---|---|---|---|
| RL-01 | Rol seti: Kurucu / Yönetici / Ekip Lideri / Ekip Üyesi (bugün owner / vice owner / admin / agent; Ekip Lide… | P0 | #324 ROLE-SET-TEAM-LEAD | – |
| RL-02 | Yapılandırılabilir izin matrisi: rol × yetenek tablosu, kiracı bazında düzenlenebilir varsayılanlar ("kim n… | P0 | #325 PERMISSION-MATRIX | – |
| RL-03 | Ekip Lideri yetenekleri: kendi ekibinin sohbetlerini izleme/devralma, QA onayı, AI taslağı hazırlama ve yay… | P1 | #326 TEAM-LEAD-CAPABILITIES | – |
| RL-04 | Davette varsayılan rolün en düşük rol olması (bugün `admin`) | P1 | #281 INVITE-DEFAULT-ROLE | #324 |
| RL-05 | Sahiplik (Kurucu) devri | P2 | #328 OWNERSHIP-TRANSFER | – |
| RL-06 | Profil adı düzenleme ve uygulama içinden şifre değiştirme | P1 | #327 PROFILE-NAME-PASSWORD | – |

### Widget (WG)

| Madde | Başlık (03) | Öncelik | Ana görev | Diğer görevler |
|---|---|---|---|---|
| WG-01 | Pre-chat formu: aç/kapat, yerleşik alanların (ad, kullanıcı adı, e-posta, mesaj) zorunluluğunun seçilebilmesi | P0 | #278 CUSTOMER-USERNAME-CLOSE | #279 |
| WG-02 | Widget dili panelden seçilebilir ve tarayıcı dili algılanır (TR pilotunda İngilizce açılma sorunu) | P0 | #280 WIDGET-LANGUAGE | – |
| WG-03 | Ajan yanıt vermezse sohbeti başka ajana aktarma + "inactive" durumu | P0 | #340 UNRESPONSIVE-TRANSFER | – |
| WG-04 | Form alan tipleri: seçim listesi, dropdown, çoklu seçim, konu/departman seçimi → ekibe yönlendirme; sorular… | P1 | #343 FORM-FIELD-TYPES-TOPIC | – |
| WG-05 | Widget metinlerini özelleştirme (çevrimdışı, kuyruk, placeholder) + kuyrukta tahmini bekleme süresi | P1 | #344 WIDGET-PHRASES-ETA | – |
| WG-06 | Oyuncuya transkript e-postası + tüm transkriptleri bir adrese iletme | P1 | #345 TRANSCRIPT-ON-REQUEST | – |
| WG-07 | Manuel atama modu (herkese bildirim, ilk alan alır) | P1 | #346 MANUAL-ASSIGNMENT-MODE | – |
| WG-08 | "E-posta iste": ajan X dakika yanıt vermezse / çevrimdışıyken | P1 | #342 ASK-EMAIL | – |
| WG-09 | Uygunluk ayarı: "her zaman" / "yalnız ajan varken" | P1 | #341 WIDGET-AVAILABILITY | – |
| WG-10 | Launcher görünürlük modları ve widget logosu | P1 | #347 LAUNCHER-VISIBILITY-LOGO | – |
| WG-11 | Puanlamaya yorum ekleme | P1 | #337 RATING-COMMENT | – |
| WG-12 | Widget içinde bilgi bankası araması | P1 | #348 WIDGET-KB-SEARCH | – |
| WG-13 | Kurulum: sihirbazda snippet + kopyala; WordPress ve benzeri platform eklentileri | P2 | #349 INSTALL-WIZARD-NOSCRIPT | – |
| WG-14 | Settings sayfalarında kaydedilmemiş değişiklik uyarısı (altyapı var, bağlanmamış) | P1 | #323 SETTINGS-SAVE-PATTERN | – |
| WG-15 | `<noscript>` yedek linki, kurulum rehberi linki | P2 | #349 INSTALL-WIZARD-NOSCRIPT | – |

### Engage (EN)

| Madde | Başlık (03) | Öncelik | Ana görev | Diğer görevler |
|---|---|---|---|---|
| EN-01 | Risk bayraklı oyuncuya kampanya/bonus gösterilmemesi (sorumlu oyun) | P0 | #350 PROMO-SUPPRESSION | – |
| EN-02 | Zengin kampanya kartı: başlık, görsel, en fazla 5 buton (mesaj gönder / URL aç / kupon kopyala); aynı kart… | P1 | #353 RICH-CAMPAIGN-CARD | – |
| EN-03 | Çok koşullu hedefleme: çıkış niyeti, sayfada kalma süresi, ülke, referrer, yeni/geri gelen, özel değişken,… | P1 | #330 GEOIP-COUNTRY | #352 |
| EN-04 | "Geçerli sayfa URL'si" koşulunun hatalı çalışmasının düzeltilmesi | P1 | #351 CAMPAIGN-CURRENT-URL-FIX | – |
| EN-05 | Kampanya silme, kampanya raporu, şablon galerisi | P1 | #354 CAMPAIGN-DELETE-REPORT-TEMPLATES | – |
| EN-06 | Hedeflerde (Goals) özel sayfa olayı | P2 | #355 GOAL-CUSTOM-EVENT | – |

### Raporlar (RP)

| Madde | Başlık (03) | Öncelik | Ana görev | Diğer görevler |
|---|---|---|---|---|
| RP-01 | Ajan, ekip, etiket ve konu filtreleri; ajan/ekip raporlarına derin link | P1 | #368 REPORT-FILTERS | – |
| RP-02 | Kaçan sohbetler ve etkileşim (kim başlattı) raporları | P1 | #369 MISSED-ENGAGEMENT-REPORTS | – |
| RP-03 | Uygunluk ve ajan aktivitesi (durum zaman çizelgesi) | P1 | #370 AVAILABILITY-ACTIVITY-REPORTS | – |
| RP-04 | Kuyruk bekleme ve terk raporları (`queued_at` verisi hazır) | P1 | #291 QUEUE-ENTRIES-CAPTURE | #371 |
| RP-05 | Günlük / haftalık özet e-postaları | P1 | #372 DIGEST-EMAILS | – |

### Otomasyon (AU)

| Madde | Başlık (03) | Öncelik | Ana görev | Diğer görevler |
|---|---|---|---|---|
| AU-01 | Konuya göre ekip yönlendirmesi: Finans, KYC/Risk, Bonus, Sorumlu Oyun (yalnız eğitimli ajanlar), Teknik, Şi… | P0 | #305 TEAM-TOPIC-QUEUES | #271 |
| AU-02 | Yönlendirme kuralları arayüzünün API ile eşitlenmesi (tam URL, ülke, çoklu URL) | P1 | #330 GEOIP-COUNTRY | #373 |
| AU-03 | Tetikleyiciler: "sohbet puanlandı", ticket yaşam döngüsü olayları | P1 | #374 TRIGGERS-RATED-TICKET-EVENTS | – |

### Kanallar (KN)

| Madde | Başlık (03) | Öncelik | Ana görev | Diğer görevler |
|---|---|---|---|---|
| KN-01 | Gerçek WhatsApp kanalı (bugün mock) | P1 | #380 WHATSAPP-LIVE | – |
| KN-02 | Gerçek Messenger / Instagram kanalları | P2 | #381 MESSENGER-INSTAGRAM-LIVE | – |
| KN-03 | Webhook teslim günlüğü arayüzü | P1 | #375 WEBHOOK-DELIVERY-LOG | – |
| KN-04 | Barındırılan API dokümanı | P1 | #376 HOSTED-API-DOCS | – |
| KN-05 | Uygulamaların ajan arayüzüne panel ekleyebilmesi (iframe SDK) | P2 | #379 CUSTOM-PANELS-F2 (deferred) | – |
| KN-06 | iGaming platform entegrasyonları (BetConstruct, EveryMatrix vb.): oyuncu/işlem sorgulama, AI-28 araç yuvası… | P1 | #377 IGAMING-CONNECT-PLACEHOLDERS | #378 (deferred) |

### Faturalama (BL)

| Madde | Başlık (03) | Öncelik | Ana görev | Diğer görevler |
|---|---|---|---|---|
| BL-01 | Ödeme yöntemleri: SWIFT (elle onay), kripto ("Adres isteyin" talep akışı, TXID ile onay), Stripe (kart); bu… | P1 | #382 BILLING-PAYMENT-METHODS | #276 |
| BL-02 | Fatura PDF'i, fatura adresi, vergi numarası | P1 | #383 INVOICE-PDF-PROFILE | #276 |
| BL-03 | Abonelik iptali | P2 | #384 SUBSCRIPTION-CANCEL | #276 |

### Güvenlik/altyapı (GV)

| Madde | Başlık (03) | Öncelik | Ana görev | Diğer görevler |
|---|---|---|---|---|
| GV-01 | Widget'ta kötüye kullanım koruması: CAPTCHA/oran sınırı; yabancının kiracının günlük AI kotasını tüketememesi | P0 | #339 WIDGET-ABUSE-GUARD | – |
| GV-02 | Kalıcı AI iş kuyruğu: sunucu çökerse bekleyen AI yanıtının kaybolmaması | P0 | #289 DURABLE-AI-QUEUE | #273 |
| GV-03 | Davet akışının kötüye kullanımının engellenmesi (başkasının adresine hesap açma) | P0 | #282 INVITE-EMAIL-VERIFY | – |
| GV-04 | Panelin dar ekranlarda kullanılabilir olması | P1 | #385 NARROW-SCREEN-PANEL | – |
| GV-05 | Kişisel verinin URL'lerde olmaması (LiveChat ajan e-postasını URL'ye koyuyor; nexa'da tekrarlanmaması) | P1 | #386 NO-PII-IN-URLS | – |
| GV-06 | Tutarlı kaydetme kalıbı (anında kaydeden toggle ile Save butonlu sayfaların karışmaması) | P1 | #323 SETTINGS-SAVE-PATTERN | – |

## 2. Dalgalar ve görev listesi

Dalgalar bir sıra önerisidir. `run-loop.sh` önce bağımlılıklara, sonra önceliğe bakar; birbirine bağlı olmayan görevler dalgalar arasında karışabilir. `deferred` görevleri döngü seçmez.


### Dalga 0 — ADR ek notları (K27: ADR başına bir görev)

| # | Kod [etiket] | Kaynak | Öncelik | Durum | Alt | Bağımlı olduğu |
|---|---|---|---|---|---|---|
| 269 | ADR-SKILL-PROCEDURE [OPUS-HIGH] | AI-03, AI-28 | high | pending | – | – |
| 270 | ADR-LLM-JSON [OPUS-HIGH] | AI-16, AI-04, AI-05, AI-06, AI-07, AI-08, AI-22, AI-23, AI-24 | high | pending | – | – |
| 271 | ADR-ROUTING-QUEUES [OPUS-HIGH] | AI-11, AI-12, AU-01 | high | pending | – | – |
| 272 | ADR-AI-RESOLUTION [OPUS-HIGH] | AI-11, AI-25, AR-02 | high | pending | – | – |
| 273 | ADR-DURABLE-AI-QUEUE [OPUS-HIGH] | GV-02 | high | pending | – | – |
| 274 | ADR-SINGLE-KB [OPUS-HIGH] | AI-14 | high | pending | – | – |
| 275 | ADR-TEMPLATE-CATALOG [OPUS-HIGH] | AI-15 | high | pending | – | – |
| 276 | ADR-PAYMENT-PROVIDERS [OPUS-HIGH] | BL-01, BL-02, BL-03 | medium | pending | – | – |

### Dalga 1 — küçük ama kritik

| # | Kod [etiket] | Kaynak | Öncelik | Durum | Alt | Bağımlı olduğu |
|---|---|---|---|---|---|---|
| 277 | INBOX-DRAFT-ISOLATION [OPUS-HIGH] | IN-01 | high | pending | 2 | – |
| 278 | CUSTOMER-USERNAME-CLOSE [OPUS-HIGH] | ID-03, WG-01 | high | pending | – | – |
| 279 | WIDGET-PRECHAT-CONFIG [OPUS-HIGH] | WG-01 | high | pending | – | 278 |
| 280 | WIDGET-LANGUAGE [SONNET-HIGH] | WG-02 | high | pending | – | – |
| 281 | INVITE-DEFAULT-ROLE [SONNET-HIGH] | RL-04 | high | pending | – | – |
| 282 | INVITE-EMAIL-VERIFY [OPUS-XHIGH] | GV-03 | high | pending | – | – |
| 283 | AI-REAL-LLM-READINESS [OPUS-HIGH] | AI-16 | high | pending | 4 | 270 |

### Dalga 2 — kimlik çekirdeği ve altyapı

| # | Kod [etiket] | Kaynak | Öncelik | Durum | Alt | Bağımlı olduğu |
|---|---|---|---|---|---|---|
| 284 | ID-GLOSSARY [SONNET-HIGH] | ID-01 | high | pending | – | – |
| 285 | DAY-BOUNDARY [SONNET-HIGH] | ID-04 | high | pending | – | – |
| 286 | DAILY-THREAD [OPUS-MAX] | ID-02 | high | pending | 5 | 284, 285 |
| 287 | MEMBER-TOKEN [OPUS-MAX] | ID-03 | high | pending | 5 | 278, 284 |
| 288 | STRUCTURED-LOGS-AI-DECISIONS [OPUS-HIGH] | ID-08 | high | pending | 2 | 284 |
| 289 | DURABLE-AI-QUEUE [OPUS-MAX] | GV-02 | high | pending | 4 | 273, 288 |
| 290 | AI-CONFIG-VERSION-DESIGN [OPUS-HIGH] | AI-20 | high | pending | – | – |
| 291 | QUEUE-ENTRIES-CAPTURE [OPUS-HIGH] | RP-04 | high | pending | – | – |

### Dalga 3a — AI çekirdeği

| # | Kod [etiket] | Kaynak | Öncelik | Durum | Alt | Bağımlı olduğu |
|---|---|---|---|---|---|---|
| 292 | AI-CONVERSATION-CORE [OPUS-MAX] | AI-01, AI-19 | high | pending | 5 | 270, 283, 286, 288, 289, 290 |
| 293 | AI-FIRST-AND-SILENCE [OPUS-MAX] | AI-11 | high | pending | 5 | 271, 272, 292 |
| 294 | AI-DAILY-MEMORY [OPUS-XHIGH] | AI-02 | high | pending | – | 287, 292 |
| 295 | AI-SLOTS [OPUS-HIGH] | AI-04 | high | pending | 3 | 270, 292 |
| 296 | AI-PROCEDURE-ENGINE [OPUS-MAX] | AI-03 | high | pending | 6 | 269, 290, 292, 295 |
| 297 | AI-UNDERSTAND-SELECT [OPUS-HIGH] | AI-05 | high | pending | 3 | 270, 296 |
| 298 | AI-KNOWLEDGE-ANSWER [OPUS-HIGH] | AI-06 | high | pending | – | 297 |
| 299 | AI-GUIDANCE-RULES [OPUS-HIGH] | AI-07 | high | pending | 2 | 270, 292 |
| 300 | SENSITIVE-MASKING [OPUS-XHIGH] | AI-26 | high | pending | – | – |
| 301 | AI-GUARDRAILS [OPUS-XHIGH] | AI-08 | high | pending | 4 | 298, 299, 300 |
| 302 | AI-RISK-FLAGS [OPUS-XHIGH] | AI-27 | high | pending | 3 | 287, 301 |
| 303 | AI-HANDOFF-TRIGGERS-RULES [OPUS-HIGH] | AI-09 | high | pending | 5 | 293, 297, 298, 301 |
| 304 | AI-HANDOFF-CARD [OPUS-HIGH] | AI-10 | high | pending | 2 | 295, 303 |
| 305 | TEAM-TOPIC-QUEUES [OPUS-MAX] | AU-01 | high | pending | 4 | 271, 291 |
| 306 | INBOX-TRANSFER-TO-TEAM [OPUS-HIGH] | IN-04 | high | pending | – | 305 |
| 307 | AI-HANDOFF-TARGET-PRIORITY [OPUS-HIGH] | AI-12 | high | pending | 3 | 303, 304, 305, 306 |
| 308 | AI-TRANSPARENCY-HUMAN-BUTTON [OPUS-HIGH] | AI-29 | medium | pending | – | 303, 307 |

### Dalga 3b — iGaming bilgi modeli

| # | Kod [etiket] | Kaynak | Öncelik | Durum | Alt | Bağımlı olduğu |
|---|---|---|---|---|---|---|
| 309 | KB-SINGLE-STORE [OPUS-MAX] | AI-14 | high | pending | 3 | 274 |
| 310 | KB-STRUCTURED-TABLES [OPUS-HIGH] | AI-13 | high | pending | 5 | 296, 309 |
| 311 | IGAMING-TEMPLATES [OPUS-HIGH] | AI-15 | high | pending | 4 | 275, 296, 299, 301, 307, 310 |
| 312 | REAL-WEB-CRAWLER [OPUS-XHIGH] | AI-17 | medium | pending | 4 | 289, 309 |
| 313 | DOCUMENT-SOURCES [OPUS-XHIGH] | AI-18 | medium | pending | 3 | 312 |

### Dalga 3c — test, yayın, kalite

| # | Kod [etiket] | Kaynak | Öncelik | Durum | Alt | Bağımlı olduğu |
|---|---|---|---|---|---|---|
| 314 | AI-SIMULATION-LAB [OPUS-HIGH] | AI-19 | high | pending | 5 | 296, 301, 302, 303 |
| 315 | AI-CONFIG-HISTORY [OPUS-HIGH] | AI-21 | medium | pending | – | 290 |
| 316 | AI-CONFIG-VERSIONING [OPUS-MAX] | AI-20 | medium | pending | 4 | 290, 314, 315 |
| 317 | AI-UNRESOLVED-QUESTIONS [OPUS-HIGH] | AI-22 | high | pending | 3 | 288, 297, 298, 303 |
| 318 | AI-COACHING-SUGGESTIONS [OPUS-HIGH] | AI-23 | medium | pending | 2 | 304, 316, 317 |
| 319 | AI-QA-QUEUE [OPUS-HIGH] | AI-24 | medium | pending | 3 | 288, 302, 314 |
| 320 | AI-QUALITY-METRICS [OPUS-HIGH] | AI-25 | medium | pending | 3 | 303, 304, 316, 319 |
| 321 | AI-TOOL-SLOT-F1 [OPUS-HIGH] | AI-28 | low | pending | – | 296, 304, 314 |
| 322 | AI-TOOL-SLOT-F2 [OPUS-MAX] | AI-28 | low | deferred | – | 321, 378 |

### Dalga 4 — roller

| # | Kod [etiket] | Kaynak | Öncelik | Durum | Alt | Bağımlı olduğu |
|---|---|---|---|---|---|---|
| 323 | SETTINGS-SAVE-PATTERN [OPUS-HIGH] | GV-06, WG-14 | high | pending | 2 | – |
| 324 | ROLE-SET-TEAM-LEAD [OPUS-MAX] | RL-01, RL-04 | high | pending | 3 | 281 |
| 325 | PERMISSION-MATRIX [OPUS-MAX] | RL-02 | high | pending | 5 | 323, 324 |
| 326 | TEAM-LEAD-CAPABILITIES [OPUS-XHIGH] | RL-03 | medium | pending | – | 325 |
| 327 | PROFILE-NAME-PASSWORD [OPUS-XHIGH] | RL-06 | medium | pending | – | – |
| 328 | OWNERSHIP-TRANSFER [OPUS-MAX] | RL-05 | low | pending | – | 324, 327 |

### Dalga 5 — ajan deneyimi, arama, arşiv

| # | Kod [etiket] | Kaynak | Öncelik | Durum | Alt | Bağımlı olduğu |
|---|---|---|---|---|---|---|
| 329 | ID-DISPLAY-COPY [SONNET-HIGH] | ID-05 | high | pending | – | 284, 286 |
| 330 | GEOIP-COUNTRY [OPUS-HIGH] | IN-02, EN-03, AU-02 | high | pending | – | – |
| 331 | INBOX-PLAYER-CARD [OPUS-HIGH] | IN-02 | high | pending | 2 | 286, 287, 304, 329, 330 |
| 332 | ID-SEARCH [OPUS-XHIGH] | ID-06 | high | pending | – | 284, 286, 287 |
| 333 | MESSAGE-FULLTEXT-SEARCH [OPUS-MAX] | ID-07 | high | pending | 4 | 332 |
| 334 | TIMELINE-VIEWER [OPUS-HIGH] | ID-09 | medium | pending | – | 288, 329 |
| 335 | ARCHIVE-SCREEN [OPUS-HIGH] | AR-01 | high | pending | – | 286, 329, 331 |
| 336 | ARCHIVE-FILTERS [OPUS-HIGH] | AR-02 | high | pending | – | 285, 293, 335 |
| 337 | RATING-COMMENT [OPUS-HIGH] | AR-03, WG-11 | medium | pending | – | 335 |
| 338 | TRANSCRIPT-EXPORT [OPUS-HIGH] | AR-04 | medium | pending | – | 335 |

### Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV

| # | Kod [etiket] | Kaynak | Öncelik | Durum | Alt | Bağımlı olduğu |
|---|---|---|---|---|---|---|
| 339 | WIDGET-ABUSE-GUARD [OPUS-XHIGH] | GV-01 | high | pending | 3 | 283, 287 |
| 340 | UNRESPONSIVE-TRANSFER [OPUS-MAX] | WG-03 | high | pending | 3 | 305 |
| 341 | WIDGET-AVAILABILITY [OPUS-HIGH] | WG-09 | medium | pending | – | 307 |
| 342 | ASK-EMAIL [SONNET-HIGH] | WG-08 | medium | pending | – | 340, 341 |
| 343 | FORM-FIELD-TYPES-TOPIC [OPUS-HIGH] | WG-04 | medium | pending | – | 305 |
| 344 | WIDGET-PHRASES-ETA [OPUS-HIGH] | WG-05 | medium | pending | – | 291, 305 |
| 345 | TRANSCRIPT-ON-REQUEST [OPUS-HIGH] | WG-06 | medium | pending | – | 280, 338 |
| 346 | MANUAL-ASSIGNMENT-MODE [OPUS-XHIGH] | WG-07 | medium | pending | – | 305 |
| 347 | LAUNCHER-VISIBILITY-LOGO [SONNET-HIGH] | WG-10 | medium | pending | – | – |
| 348 | WIDGET-KB-SEARCH [OPUS-HIGH] | WG-12 | medium | pending | – | 309 |
| 349 | INSTALL-WIZARD-NOSCRIPT [SONNET-HIGH] | WG-13, WG-15 | low | pending | – | – |
| 350 | PROMO-SUPPRESSION [OPUS-HIGH] | EN-01 | high | pending | – | 302 |
| 351 | CAMPAIGN-CURRENT-URL-FIX [SONNET-HIGH] | EN-04 | medium | pending | – | – |
| 352 | CAMPAIGN-MULTI-CONDITIONS [OPUS-HIGH] | EN-03 | medium | pending | – | 351, 330 |
| 353 | RICH-CAMPAIGN-CARD [OPUS-HIGH] | EN-02 | medium | pending | – | 350 |
| 354 | CAMPAIGN-DELETE-REPORT-TEMPLATES [SONNET-HIGH] | EN-05 | medium | pending | – | 353, 350 |
| 355 | GOAL-CUSTOM-EVENT [SONNET-HIGH] | EN-06 | low | pending | – | 352 |
| 356 | TICKET-REPLY-THREAD [OPUS-XHIGH] | HD-01 | high | pending | 4 | – |
| 357 | INBOUND-EMAIL-BODY [OPUS-XHIGH] | HD-02 | high | pending | – | 356 |
| 358 | EMAIL-THREADING [OPUS-XHIGH] | HD-03 | high | pending | – | 356, 357 |
| 359 | TICKET-AUTO-ACK [SONNET-HIGH] | HD-04 | medium | pending | – | 358 |
| 360 | TICKET-FIRST-RESPONSE-SLA [OPUS-HIGH] | HD-05 | medium | pending | – | 356 |
| 361 | INBOX-WAITING-TIMER [SONNET-HIGH] | IN-03 | medium | pending | – | – |
| 362 | READ-RECEIPTS [SONNET-HIGH] | IN-05 | medium | pending | – | – |
| 363 | CANNED-SEARCH-VARS-PRIVATE [OPUS-HIGH] | IN-06 | medium | pending | – | – |
| 364 | EVENT-SUGGESTED-REPLIES [SONNET-HIGH] | IN-07 | low | pending | – | 363, 337 |
| 365 | SHORTCUTS-PALETTE-SETTINGS [SONNET-HIGH] | IN-08, IN-11 | medium | pending | 2 | 277 |
| 366 | COPILOT-DRAWER [OPUS-HIGH] | IN-09 | medium | pending | – | 309, 283 |
| 367 | EVENT-NOTIFICATIONS-REPEAT [SONNET-HIGH] | IN-10 | medium | pending | – | 361 |
| 368 | REPORT-FILTERS [OPUS-XHIGH] | RP-01 | medium | pending | – | 325 |
| 369 | MISSED-ENGAGEMENT-REPORTS [OPUS-HIGH] | RP-02 | medium | pending | – | 293 |
| 370 | AVAILABILITY-ACTIVITY-REPORTS [OPUS-HIGH] | RP-03 | medium | pending | – | 340 |
| 371 | QUEUE-REPORTS [SONNET-HIGH] | RP-04 | medium | pending | – | 291, 305, 368 |
| 372 | DIGEST-EMAILS [SONNET-HIGH] | RP-05 | medium | pending | – | 368, 369, 371 |
| 373 | ROUTING-RULES-UI-PARITY [SONNET-HIGH] | AU-02 | medium | pending | – | 330 |
| 374 | TRIGGERS-RATED-TICKET-EVENTS [OPUS-HIGH] | AU-03 | medium | pending | – | 356, 337 |
| 375 | WEBHOOK-DELIVERY-LOG [SONNET-HIGH] | KN-03 | medium | pending | – | – |
| 376 | HOSTED-API-DOCS [SONNET-HIGH] | KN-04 | medium | pending | – | – |
| 377 | IGAMING-CONNECT-PLACEHOLDERS [SONNET-HIGH] | KN-06 | medium | pending | – | – |
| 378 | IGAMING-PLATFORM-F2 [OPUS-MAX] | KN-06 | low | deferred | – | 377, 287 |
| 379 | CUSTOM-PANELS-F2 [OPUS-XHIGH] | KN-05 | low | deferred | – | 325, 287 |
| 380 | WHATSAPP-LIVE [OPUS-XHIGH] | KN-01 | medium | pending | 3 | 289 |
| 381 | MESSENGER-INSTAGRAM-LIVE [OPUS-HIGH] | KN-02 | low | pending | – | 380 |
| 382 | BILLING-PAYMENT-METHODS [OPUS-XHIGH] | BL-01 | medium | pending | 4 | 276 |
| 383 | INVOICE-PDF-PROFILE [OPUS-XHIGH] | BL-02 | medium | pending | – | 382 |
| 384 | SUBSCRIPTION-CANCEL [OPUS-HIGH] | BL-03 | low | pending | – | 382, 383 |
| 385 | NARROW-SCREEN-PANEL [OPUS-MEDIUM] | GV-04 | medium | pending | – | 304, 334 |
| 386 | NO-PII-IN-URLS [OPUS-MEDIUM] | GV-05 | medium | pending | – | – |
| 387 | AI-MULTILINGUAL [OPUS-HIGH] | AI-30 | low | pending | – | 297, 301 |
| 388 | OPERATOR-SIGNED-IDENTITY-F2 [OPUS-MAX] | ID-03 | low | deferred | – | 287 |

## 3. Bu turda eklenen kararlar (K17–K27)

Ayrıntılı satırlar 04'teki Karar kaydı tablosunda. Görevlere etkisi:

| # | Karar | Etkilenen görevler |
|---|---|---|
| K17 | LLM ADR §6 ek notu yazılsın (§6a) | #270; AI görevleri ona bağlı (#283, #292, #295, #297, #299 …) |
| K18 | ADR-08a ve ADR-11a ekleri onaylı | #271, #273 → #293, #305, #307, #289 |
| K19 | ADR-13a eki (SWIFT + kripto + Stripe, yalnız mock/sandbox) | #276 → #382–#384 |
| K20 | customer_username ayrı ön görevle kapatılsın | #278 → #279, #287 |
| K21 | AI-20 tasarım notu ve RP-04 veri yakalama öne alınsın | #290, #291 (Dalga 2) |
| K22 | KN-01 ve KN-02 pending (ertelenmez) | #380 (medium), #381 (low); testte taklit, canlı bağlama insan kararı |
| K23 | HelpDesk: kodla, pilot e-posta kapısı ayrı ayar | #356 (alt görev 3), #359 |
| K24 | Bilgi amaçlı fatura PDF'i + mock e-Fatura | #383 |
| K25 | Widget'a RU/AZ eklenmez; AI yine RU/AZ cevap verebilir | #280, #387 |
| K26 | Döküm otomatik gönderilmez, yalnız oyuncu isterse; içeride kaydetme/loglama sürer | #345 |
| K27 | ADR başına bir görev | #269–#276 |

## 4. Paket ile kod arasındaki sapmalar (kod esas alındı)

Kod referansları 2026-10-14'te HEAD `120bb3d` üzerinde beş ayrı taramayla yeniden doğrulandı. Sapmaların hepsi küçük. Görevlerde kod esas alındı ve her görevde "başlamadan önce satır numaralarını yeniden doğrula" notu var.

**Karar/kapsam farkları (görevlere işlendi):**

| Konu | Paket diyor | Görevde uygulanan |
|---|---|---|
| Günlük kimlik kolonu | 05 §1.0 ayrı `daily_thread_id` / `day_thread_key` kolonu öneriyor | K1=A: nexa `chat_id` kullanılır, ayrı kolon açılmaz (#286, #292) |
| Üye kimliği | 05 ID-03 operatörün imzaladığı `user_hash`'i anlatıyor | K4: token'ı widget üretir (#287); operatör imzası F2 (#388, deferred) |
| AI erişim/adres soruları | 05 AI-08 G14 varsayılanı "hiçbir yöntem önerme" | K13: kiracının girdiği bilgi esas (#310, #301) |
| Devir kuralları | 05 AI-11, K9'un genişlettiği kapsamı içermiyor | #303'e kiracının devir kuralları ve "çözüldü" kriterleri eklendi |
| Widget dilleri | WG-02 S2 ve AI-30 RU/AZ widget dili ekliyor | K25: widget 8 dilde kalır; AI persona dillerine RU/AZ (#280, #387) |
| Döküm e-postası | 05 WG-06 "varsayılan kapalı, kiracı açabilir" | K26: otomatik gönderim hiç yok, yalnız oyuncu isteğiyle (#345) |
| Yedek widget dili | 05 WG-02 yedek dil `en`, 04 yeni şirketlere `tr` diyor | Kolon varsayılanı `en` (mevcutlar değişmez), yeni workspace `tr` (#280) |
| AI-21 ↔ AI-20 | AI-20 değişiklik geçmişine, AI-21 sürüm modeline dayanıyor (döngü) | Tasarım notu #290 önde; AI-21 (#315) AI-20'den (#316) önce |
| IN-04 sırası | IN-04 Inbox bölümünde | AI-12 devri ekip transferine dayandığı için Dalga 3a'ya alındı (#306) |
| AI-25 S3 üye eşleşmesi | Kullanıcı adı ile | K4 üye token'ına göre (`member_key`) |
| Düzenleme tablolarında `status` | Bazı maddeler `status` kolonu öneriyor | Eklenmez; yayın durumu sürüm paketinde (#290, #316) |

**Kod referansı sapmaları (doğrulama taramasından):**

| Madde | Paketteki referans | Koddaki durum |
|---|---|---|
| AI-02, ID-03, IN-02, WG-01 ve WG-01 üstü not | `customer_username` "commit'lenmemiş" | Commit `120bb3d` ile işlenmiş; çalışma ağacı temiz. Satır numaraları kaymamış |
| §1.0 tablo / AI-14 | `HANDOFF.md:2336`, `:2436` (Q6) | HANDOFF.md 52 satıra indi; Q6 artık `docs/archive/handoff/HANDOFF-arsiv-2026-10-14.md:2293` ("AÇIK — ürün kararı"), "ayrı" cevabı :2393, :3416, :4461 |
| HD-01 | `ticket-service.ts:265-294` `create` | `create` :201'de başlıyor; 265-294 yalnız ekleme ve kural kuyruğu |
| IN-11 | `settings-sections.ts` "36 bölüm" | 34 bölüm (aralık 108-407 doğru) |
| GV-04 | `NarrowScreenNotice.tsx:26` localStorage | `sessionStorage` (`siyahtus.narrow_screen.continue`); "devam et" yalnız oturum boyunca |
| GV-06 | `dirty-guard.tsx` "tek kullanıcı SkillEditor" | Yalnız `useLeaveGuard` için doğru; `useCloseGuard` 8, `confirmLeave` 3 dosyada |
| AU-01 | `contract/paths/chats.yaml:383-386` | Doğru yol `packages/contract/openapi/paths/chats.yaml`; `transfer` :370-373 |
| KN-01 | `routes/channels.ts:372` webhook | `/channels/:type/webhook` :347 |
| BL-03 | `subscription-service.ts` `canceled` durumu var | Bu dosyada `canceled` yok (varsayılan `trialing`); `canceled` lisans düzeyinde `metering.ts:249`, `license-activation.ts:24`. "İptal akışı yok" tespiti doğru |
| AI-21 | Copilot'ta audit yok | `routes/copilot.ts:264` bilgi silmede `data.deleted` yazıyor; playbook satırları :547, :1369 |
| AI-22 | `skill-engine.ts` `#record` ≈:703 | :673 (davranış aynı) |
| AI-23 | `resolveVisibility` chat-service.ts'te | Tanım `services/chat/access.ts:62`; chat-service yalnız çağırıyor |
| AI-25 | MCP `get_report` tool-catalog.ts | Gerçek çağrı `services/mcp/tools/get-report.ts:42` |
| AI-26 | `maskCardNumbers` çağrı listesi | Eksik: `copilot-enhance.ts:100,137`, `copilot-summary.ts:129,245`, `mcp/tools/summarize-chat.ts:68` de çağırıyor |
| AI-28 | `ai-mock/src/steps.ts:18-56` kapalı adım listesi | `SKILL_STEP_TYPES` :9-16; `validateSteps` :189 |

±30 satır içindeki küçük kaymalar (ör. `LABEL_RE` :42, Thread modeli :816, `/auth/me` :863) sapma sayılmadı.

### customer_username durumu

- **Bağlı:** DB (`Customer.username`, migration `20261014090000_customer_username`, indeks yok), API (`POST /customer/chat` kaydeder; ajan tarafı güncelleme; müşteri aramasında büyük/küçük harf duyarsız eşleşme `customer-service.ts:319`), kontrat ve üretilmiş tipler, widget pre-chat (alan zorunlu, 8 dil), web `CustomerDetailPanel`, birim/entegrasyon/e2e testleri.
- **Bağlı değil:** ticket araması (`ticket-service.ts` `queryFilter` ≈:942), mobil, Inbox `DetailsPanel`, ID-03/ID-06'nın `username_normalized` kolonu ve indeksi.
- **Tutarsızlık:** widget'ta zorunlu, API'de isteğe bağlı.
- **Görev:** #278 (K20) bunları kapatır; #279 WG-01 ve #287 ID-03 ona bağlı.

## 5. Açık riskler

| Risk | Nerede | Not |
|---|---|---|
| KVKK: risk bayrakları, uzun saklama süreleri, döküm ve ekler | AI-27 (#302), EN-01 (#350), HD-02 (#357), GV-05 (#386) | Saklama süreleri ve aydınlatma metni hukuk onayı ister |
| Meta'nın kumar/bahis politikası | KN-01 (#380), KN-02 (#381) | K22 pending; teknik iş taklitle ilerler, hesap onayı ticari engel olabilir |
| AB Yapay Zekâ Yasası md. 50 (şeffaflık) | AI-29 (#308) | "AI ile konuşuyorsunuz" bildirimi hukuk kontrolü |
| Kriz hattı metni | AI-08 (#301), AI-09 (#303) | Ülkeye göre doğru hat numarası ve metin hukuk/uyum onayı ister |
| Ekip düzeyinde çalışma saati hesabı | AI-12 (#307), HD-05 (#360) | P2; ilk sürüm şirket geneli mesai |
| iOS CHIPS / üçüncü taraf çerez kısıtları | ID-03 (#287) | Token'ın cihazda kalıcılığı Safari'de sınırlı; localStorage yedeği |
| Stripe'ın iGaming'e yazılım satanı reddetmesi | BL-01 (#382) | SWIFT ve kripto yolu Stripe'tan bağımsız tasarlandı (K16) |
| e-Fatura ülke kararı | BL-02 (#383) | K24: bilgi amaçlı PDF + mock; fatura kesen şirketin ülkesi netleşmeli |
| Turnstile veri aktarımı ve CGNAT | GV-01 (#339) | Cömert IP eşikleri; KVKK aydınlatma metni |
| Okundu bilgisi gizlilik metni | IN-05 (#362) | Widget gizlilik metninde belirtilip belirtilmeyeceği hukuki karar |
| GeoIP veritabanı lisansı ve güncelleme | GEOIP (#330) | MaxMind/DB-IP seçimi ve güncelleme süreci operasyon işi |
| Trigram indeksinin yazma yükü | ID-07 (#333) | Yük testiyle ölçülmeli |
| Yetki önbelleği gecikmesi (≤60 sn) | RL-02 (#325) | Sahibe bildirilir |
| Gelen e-posta sağlayıcısı seçilmedi | HD-02 (#357) | Şema sağlayıcıdan bağımsız |
| Satıcı API erişimi ve DPA | KN-06 F2 (#378) | Ticari süreç; F2 |

## Bekleyen sorular

Yok. K1–K27'nin hepsi cevaplandı; maddelerin içindeki diğer sorularda 04'teki önerilen varsayılan kullanıldı ve her görevin "KULLANILAN VARSAYIMLAR" bölümünde yazılı.
