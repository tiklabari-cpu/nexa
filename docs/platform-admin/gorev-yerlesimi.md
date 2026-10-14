# Görev yerleşimi — workspace paneli mi, root panel mi? (tm 269–390)

Sahip kararı (2026-10-14): SiyahTuş analiz paketinden gelen 120 görevin (#269–#388) **tamamı
yapılır**. Her görevin hangi panelden yapılacağına bu doküman karar verir. Bütün görevler
bittiğinde elde **iki panel** olur:

| Panel                      | Kim kullanır                                                                     | Nerede                                                                       |
| -------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Workspace paneli**       | Kiracının (iGaming operatörünün) Kurucu / Yönetici / Ekip Lideri / Ekip Üyesi'si | `apps/web` (`app.<alan>`), `apps/widget`, `apps/mobile`, API `/api/v1`       |
| **Root (platform) paneli** | SiyahTuş ekibi (platform operatörü): superadmin / support / billing / readonly   | `apps/admin` (`admin.<alan>`), ayrı süreç `platform-api`, API `/platform/v1` |

Root panelin kendisi **tm 389 PLATFORM-ADMIN** epiğidir (22 alt görev). Workspace tarafındaki AI
yerleşim kararı ve "AI ajanı oluşturma" boşluğu **tm 390 AI-AGENT-CREATE** görevindedir.
Gereksinimler `docs/platform-admin/requirements.md`, tasarım `docs/platform-admin/design.md`.

## 1. Karar ilkeleri

1. **Kimin işi?** Kiracının kendi çalışma alanı için yaptığı her şey workspace panelindedir.
   SiyahTuş'un kiracılar _arasında_ ya da kiracı _hakkında_ yaptığı her şey root paneldedir.
2. **Hem workspace hem root olan görevlerde veri modeli kiracı görevinindir.** Kiracı görevi
   tabloyu, servis fonksiyonunu ve (gerekirse) `SECURITY DEFINER` fonksiyonunu yazar; root
   panelin yüzü tm 389'un ilgili alt görevinde kodlanır ve **o alt görev kiracı görevine bağımlıdır**
   (tersi değil — kiracı görevleri root panel bitmeden de çalışır ve kapanır).
3. **Kiracı görevi root panel arayüzü kodlamaz.** Paketin "platform yönetiminde kuyruk",
   "SiyahTuş ekibi elle yükseltir", "runbook/psql" dediği yerler kiracı görevinde servis
   fonksiyonu + entegrasyon testi olarak kalır; ekran tm 389'da. tm 389 gelene kadar geçici yol
   bugünkü gibi runbook/psql'dir (production-checklist §9), bu geçici yol görevi bloke etmez.
4. **Dağıtım sırları (env) panele taşınmaz.** `WHATSAPP_APP_SECRET`, `TURNSTILE_SECRET_KEY`,
   `INBOUND_EMAIL_SECRET` gibi değerler `.env`'de kalır; root panel yalnız "var/yok + kaynak"
   gösterir (effective-config, redaksiyonlu). Tek istisna, sahibin açık isteğiyle, **LLM / embedding
   API anahtarı**: root panelde yapıştırılır, şifreli saklanır, env yedek olarak kalır (389.17).
5. **Platform kilitli katalogları (G1–G19, uyum senaryo paketi, QA rubriği, iGaming şablon paketi,
   araç kataloğu) kodda kalır** (paketin kararı). Root panel bunları sürümüyle gösterir, ülkeye
   göre kriz metni taslağı gibi _veri_ parçalarını düzenler, kiracı başına kurulum durumunu
   raporlar (389.19). Katalog içeriğini panelden düzenlemek F2.
6. **Kiracı içeriği root panelde görünmez.** Sohbet metni, oyuncu verisi, bilgi bankası içeriği
   platform ekranlarında yoktur; yalnız sayılar, durumlar ve kimlikler. Kiracı içeriğine bakmak
   yalnız korkuluklu impersonation ile (389.15: salt-okunur varsayılan, kırmızı şerit, çift audit,
   sahibe e-posta).

## 2. Root panelde ne olacak (tm 389 modül haritası)

| Modül                          | Alt görev     | İçerik                                                                                                                                                                                                                                                                                                                                  | Beslendiği kiracı görevleri                                                                                                 |
| ------------------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Çekirdek                       | 389.1–389.7   | `siyahtus_platform` rolü, platform tabloları, ayrı süreç/kontrat, operatör kimliği (zorunlu TOTP, RBAC), değişmez audit zinciri, `apps/admin` iskeleti, edge/CI/Helm/compose kablolaması                                                                                                                                                | —                                                                                                                           |
| Dashboard + sağlık             | 389.8         | KPI'lar, kayıt zaman çizelgesi, kiracı API liderinin yazdığı sağlık anlık görüntüsü, **bileşen durum kaydı** (`siyahtus:ops:components`)                                                                                                                                                                                                | #288 (log bağlamı), #289 (ai_jobs), #312/#313 (işçiler), #330 (GeoIP), #339 (captcha), #380/#381 (kanallar) — hepsi "varsa" |
| Workspace'ler                  | 389.9–389.10  | Liste/arama/detay (üyeler, markalar, kullanım, abonelik, faturalar, kiracı audit okuma, notlar), eylemler: deneme uzat, aktive et, plan değiştir, askıya al, salt-okuma, iptal/geri al, **zorlamalı sahiplik devri**, sil (14 gün soğuma)                                                                                               | #324 (rol adları), #328 (sahiplik devri değişmezleri), #384 (iptal)                                                         |
| Hesaplar                       | 389.11        | Arama, doğrulama e-postası, zorunlu şifre sıfırlama, oturum/token iptali, 2FA sıfırlama, askıya alma, dışa aktarma, silme                                                                                                                                                                                                               | #282 (davet kötüye kullanımı sayaçları)                                                                                     |
| Faturalama + kullanım          | 389.12        | Planlar, abonelikler, faturalar, paketler, gelir, **kredi/iade**, elle abonelik, kullanım tabloları, **AI kota override'ı** (`licenses.ai_daily_*_cap`) ve plan varsayılanları                                                                                                                                                          | #283 (kota/defter), #320 (AI metrikleri — yalnız sayı)                                                                      |
| Ayarlar + duyuru               | 389.13        | `signup_enabled`, deneme süresi, duyuru (en/tr), bakım modu, **effective-config** (redaksiyonlu env + kaynak), kanal canlı sağlayıcı listesi (`APPS_LIVE_PROVIDERS`, K22) ve K23 ticket e-posta kapısı yalnız _gösterim_                                                                                                                | #356, #380, #381, #339                                                                                                      |
| Operasyon                      | 389.14        | Zamanlayıcı işleri (+şimdi çalıştır), webhook birikimi, SIEM, bölümler, doğrulanmamış kayıtlar, bileşen durumları, iş kuyrukları                                                                                                                                                                                                        | #289, #312, #313, #375, #330                                                                                                |
| Impersonation                  | 389.15        | "Müşteri olarak gir": salt-okunur varsayılan, `full` TOTP ile, 30 dk, kırmızı şerit, çift audit, sahibe e-posta                                                                                                                                                                                                                         | #300 (maskeleme aynen geçerli), #325 (yetki matrisi aynen geçerli)                                                          |
| Güvenlik                       | 389.16        | Blocklist (e-posta/alan/IP), başarısız girişler, IP'ye göre kayıtlar, impersonation listesi, davet/widget kötüye kullanım sayaçları                                                                                                                                                                                                     | #282, #339                                                                                                                  |
| **AI ayarları**                | 389.17        | Sağlayıcı (mock/openai), model, base URL, bölge, **API anahtarı yapıştırma alanı** (yazma-yalnız, maske), zaman aşımı/token limitleri, global günlük tavanlar, fiyat tablosu, "Bağlantıyı test et", "Yeniden gömle"; kiracı API'de hot-swap registry                                                                                    | #283 (adaptör + kota öncelik sırası), #270 (JSON çıktı)                                                                     |
| **Ödeme operasyonu**           | 389.18        | SWIFT "ödendi" işareti, kripto **adres isteği kuyruğu** (adres ver → TXID onayla), sağlayıcı aç/kapa, banka bilgisi ayarı, fatura ihraççı profili, fatura indirme, iptal/iade onayı                                                                                                                                                     | #276, #382, #383, #384                                                                                                      |
| **AI katalogları + yönetişim** | 389.19        | G1–G19 kataloğu ve sürümü (salt okunur), **ülkeye göre kriz metni taslakları** (düzenlenir), iGaming şablon paketi sürümü + kiracı başına kurulum durumu, uyum senaryo paketi sürümü, QA rubriği, araç kataloğu; workspace detayında "AI" sekmesi (yapılandırma geçmişi sayıları, guardrail tetiklenme sayıları, QA özeti — içerik yok) | #301, #311, #314, #315, #319, #321                                                                                          |
| Uyarılar                       | 389.20        | Operatör e-posta uyarıları (deneme bitişleri, ödeme kuyruğu bekliyor, kota %100, sağlık kırmızı)                                                                                                                                                                                                                                        | 389.14, 389.16                                                                                                              |
| Dokümanlar + kapı              | 389.21–389.22 | Runbook, checklist, ADR, tam DoD + e2e + pilot build + smoke                                                                                                                                                                                                                                                                            | —                                                                                                                           |

## 3. Workspace panelinde ne olacak (özet)

Bugünkü panel + 120 görevin kiracı yüzü. AI yönetimi **tek merkezde**: Playbook › AI Agent
(tm 390 kararı; aynı rotalar Ayarlar › AI Agent girişinden ve komut paletinden de bulunur):

- **Genel ayarlar** — ad, avatar, ton, diller, yanıt uzunluğu, hitap/emoji/soru sayısı (#299),
  karşılama mesajı (widget ayarı), "Sohbet kabul ediyor" (`active`, #301 yayın kapısıyla).
  Boş durum: "AI ajanı ekle" → `POST /ai-agents` (tm 390).
- **Davranış** — davranış talimatları (#299), devir tetikleyicileri + devir kuralları + çözüldü
  kriterleri (#303), uyum korumaları: kilitli platform kuralları salt okunur + kiracı ekleri +
  kriz/şikâyet metni (#301), risk politikası (#302).
- **Prosedürler (Skills)** — çok turlu prosedürler (#296), iGaming şablon galerisi (#311), araç
  yuvası (#321), hızlı çipler.
- **Bilgi** — tek depo (#309), yapılandırılmış tablolar + Erişim bilgisi (#310), tarayıcı (#312),
  PDF/DOCX (#313), çözülemeyen sorular (#317).
- **Test** — simülasyon laboratuvarı (#314); **Geçmiş** — yapılandırma geçmişi (#315), sürüm/yayın
  akışı (#316); **Öneriler** (#318).
- Ayarlar tarafında kalanlar: Kullanım ve kotalar › Yapay zekâ kullanımı (#283.4 — **kota
  yükseltme yok**, yalnız görüntüleme), AI kalite (#319), erişim kuralları ve widget kötüye kullanım
  ayarı (#339), roller ve yetki matrisi (#324–#326), sahiplik devri (#328), faturalama (#382–#384:
  ödeme yöntemi seçimi, SWIFT bilgisi, kripto adres talebi, fatura profili, iptal).

## 4. Görev başına karar

Sütun **Panel**: `W` = yalnız workspace paneli (widget/mobil/API dahil) · `R` = yalnız root panel ·
`W+R` = iki panelde de yüzü var · `Dok` = yalnız doküman (panel yok). **Root yüzü** sütunu W+R
görevlerde root paneldeki parçayı ve bunu kodlayan 389 alt görevini söyler. Bu doküman tasks.json'a
eklenen "PANEL YERLEŞİMİ" bloklarının kaynağıdır; ikisi çelişirse tasks.json'daki blok düzeltilir.

| Görev | Başlık (kısa)                          | Panel | Root yüzü / not                                                                                                                                             |
| ----- | -------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 269   | ADR-SKILL-PROCEDURE                    | Dok   | —                                                                                                                                                           |
| 270   | ADR-LLM-JSON                           | Dok   | —                                                                                                                                                           |
| 271   | ADR-ROUTING-QUEUES                     | Dok   | —                                                                                                                                                           |
| 272   | ADR-AI-RESOLUTION                      | Dok   | —                                                                                                                                                           |
| 273   | ADR-DURABLE-AI-QUEUE                   | Dok   | —                                                                                                                                                           |
| 274   | ADR-SINGLE-KB                          | Dok   | —                                                                                                                                                           |
| 275   | ADR-TEMPLATE-CATALOG                   | Dok   | Katalog sürümü/kurulum istatistiği root'ta (389.19) — ADR'ye bir cümle                                                                                      |
| 276   | ADR-PAYMENT-PROVIDERS                  | Dok   | "Hangi sağlayıcı görünür" ve elle onay kuyruğu root'ta (389.18) — ADR'ye bir cümle                                                                          |
| 277   | INBOX-DRAFT-ISOLATION                  | W     | —                                                                                                                                                           |
| 278   | CUSTOMER-USERNAME-CLOSE                | W     | —                                                                                                                                                           |
| 279   | WIDGET-PRECHAT-CONFIG                  | W     | —                                                                                                                                                           |
| 280   | WIDGET-LANGUAGE                        | W     | —                                                                                                                                                           |
| 281   | INVITE-DEFAULT-ROLE                    | W     | —                                                                                                                                                           |
| 282   | INVITE-EMAIL-VERIFY                    | W+R   | Günlük davet sınırı aşımı ve doğrulanmamış davet hesapları sayaç olarak root güvenlik ekranında (389.16, salt okunur)                                       |
| 283   | AI-REAL-LLM-READINESS                  | W+R   | Kota override + plan varsayılanı (389.12), LLM anahtarı/model/bölge (389.17). 283.4 ekranı yalnız gösterir                                                  |
| 284   | ID-GLOSSARY                            | W     | Root panel de aynı sözlüğü kullanır (destek araması Thread/Chat ID ile)                                                                                     |
| 285   | DAY-BOUNDARY                           | W     | —                                                                                                                                                           |
| 286   | DAILY-THREAD                           | W     | —                                                                                                                                                           |
| 287   | MEMBER-TOKEN                           | W     | —                                                                                                                                                           |
| 288   | STRUCTURED-LOGS-AI-DECISIONS           | W+R   | Platform süreci aynı logger'ı `platform_admin_id` alanıyla kullanır (389.3)                                                                                 |
| 289   | DURABLE-AI-QUEUE                       | W+R   | `ai_jobs` birikimi/ölü iş sayısı root operasyon ekranında (389.14)                                                                                          |
| 290   | AI-CONFIG-VERSION-DESIGN               | Dok   | —                                                                                                                                                           |
| 291   | QUEUE-ENTRIES-CAPTURE                  | W     | —                                                                                                                                                           |
| 292   | AI-CONVERSATION-CORE                   | W     | —                                                                                                                                                           |
| 293   | AI-FIRST-AND-SILENCE                   | W     | —                                                                                                                                                           |
| 294   | AI-DAILY-MEMORY                        | W     | —                                                                                                                                                           |
| 295   | AI-SLOTS                               | W     | —                                                                                                                                                           |
| 296   | AI-PROCEDURE-ENGINE                    | W     | —                                                                                                                                                           |
| 297   | AI-UNDERSTAND-SELECT                   | W     | —                                                                                                                                                           |
| 298   | AI-KNOWLEDGE-ANSWER                    | W     | —                                                                                                                                                           |
| 299   | AI-GUIDANCE-RULES                      | W     | Yerleşim: Playbook › AI Agent › Davranış (tm 390 kararı)                                                                                                    |
| 300   | SENSITIVE-MASKING                      | W     | Impersonation'da da aynı maske (389.15)                                                                                                                     |
| 301   | AI-GUARDRAILS                          | W+R   | Katalog + sürüm görünümü, **ülkeye göre kriz metni taslakları** (AI-08-S1) root'ta (389.19)                                                                 |
| 302   | AI-RISK-FLAGS                          | W     | —                                                                                                                                                           |
| 303   | AI-HANDOFF-TRIGGERS-RULES              | W     | Yerleşim: Playbook › AI Agent › Davranış › Devir (tm 390 kararı; Ayarlar girişi aynı rotaya)                                                                |
| 304   | AI-HANDOFF-CARD                        | W     | —                                                                                                                                                           |
| 305   | TEAM-TOPIC-QUEUES                      | W     | —                                                                                                                                                           |
| 306   | INBOX-TRANSFER-TO-TEAM                 | W     | —                                                                                                                                                           |
| 307   | AI-HANDOFF-TARGET-PRIORITY             | W     | —                                                                                                                                                           |
| 308   | AI-TRANSPARENCY-HUMAN-BUTTON           | W     | —                                                                                                                                                           |
| 309   | KB-SINGLE-STORE                        | W     | —                                                                                                                                                           |
| 310   | KB-STRUCTURED-TABLES                   | W     | —                                                                                                                                                           |
| 311   | IGAMING-TEMPLATES                      | W+R   | Paket sürümü + kiracı başına kurulum/yayın durumu root'ta (389.19)                                                                                          |
| 312   | REAL-WEB-CRAWLER                       | W+R   | `knowledge_jobs` birikimi root operasyonda (389.14)                                                                                                         |
| 313   | DOCUMENT-SOURCES                       | W+R   | İşçi süreci durumu root operasyonda (389.14)                                                                                                                |
| 314   | AI-SIMULATION-LAB                      | W+R   | Uyum senaryo paketi sürümü root'ta (389.19)                                                                                                                 |
| 315   | AI-CONFIG-HISTORY                      | W+R   | Workspace detayı "AI" sekmesinde değişiklik sayıları (389.19; içerik yok)                                                                                   |
| 316   | AI-CONFIG-VERSIONING                   | W     | Platform tarafı "AI'ı durdur" = kota override 0 (389.12)                                                                                                    |
| 317   | AI-UNRESOLVED-QUESTIONS                | W     | —                                                                                                                                                           |
| 318   | AI-COACHING-SUGGESTIONS                | W     | —                                                                                                                                                           |
| 319   | AI-QA-QUEUE                            | W+R   | Platform rubriği görünümü + kiracı QA özeti sayıları (389.19)                                                                                               |
| 320   | AI-QUALITY-METRICS                     | W     | Dashboard'da kiracılar arası toplamlar (389.8; yalnız sayı)                                                                                                 |
| 321   | AI-TOOL-SLOT-F1                        | W     | Katalog listesi root'ta salt okunur (389.19)                                                                                                                |
| 322   | AI-TOOL-SLOT-F2 (deferred)             | W     | —                                                                                                                                                           |
| 323   | SETTINGS-SAVE-PATTERN                  | W     | `apps/admin` aynı kalıbın kopyasını kullanır (389.6)                                                                                                        |
| 324   | ROLE-SET-TEAM-LEAD                     | W     | Root üye listesi yeni rol adlarını gösterir (389.9)                                                                                                         |
| 325   | PERMISSION-MATRIX                      | W     | "Alt sınırlar" kodda kalır; root panel düzenlemez                                                                                                           |
| 326   | TEAM-LEAD-CAPABILITIES                 | W     | —                                                                                                                                                           |
| 327   | PROFILE-NAME-PASSWORD                  | W     | —                                                                                                                                                           |
| 328   | OWNERSHIP-TRANSFER                     | W+R   | Kurucuya ulaşılamıyorsa **zorlamalı devir** root'ta (389.10; superadmin + TOTP + kimlik doğrulama kontrol listesi + gerekçe)                                |
| 329   | ID-DISPLAY-COPY                        | W     | —                                                                                                                                                           |
| 330   | GEOIP-COUNTRY                          | W+R   | Veritabanı dosyası sürümü/yaşı root operasyonda (389.14); güncelleme runbook                                                                                |
| 331   | INBOX-PLAYER-CARD                      | W     | —                                                                                                                                                           |
| 332   | ID-SEARCH                              | W     | Root destek araması kimliği workspace'e çözer, içerik göstermez (389.9)                                                                                     |
| 333   | MESSAGE-FULLTEXT-SEARCH                | W     | —                                                                                                                                                           |
| 334   | TIMELINE-VIEWER                        | W     | —                                                                                                                                                           |
| 335   | ARCHIVE-SCREEN                         | W     | —                                                                                                                                                           |
| 336   | ARCHIVE-FILTERS                        | W     | —                                                                                                                                                           |
| 337   | RATING-COMMENT                         | W     | —                                                                                                                                                           |
| 338   | TRANSCRIPT-EXPORT                      | W     | —                                                                                                                                                           |
| 339   | WIDGET-ABUSE-GUARD                     | W+R   | Turnstile anahtar varlığı effective-config'de (389.13), doğrulama/kota sayaçları güvenlik ekranında (389.16)                                                |
| 340   | UNRESPONSIVE-TRANSFER                  | W     | —                                                                                                                                                           |
| 341   | WIDGET-AVAILABILITY                    | W     | —                                                                                                                                                           |
| 342   | ASK-EMAIL                              | W     | —                                                                                                                                                           |
| 343   | FORM-FIELD-TYPES-TOPIC                 | W     | —                                                                                                                                                           |
| 344   | WIDGET-PHRASES-ETA                     | W     | —                                                                                                                                                           |
| 345   | TRANSCRIPT-ON-REQUEST                  | W     | —                                                                                                                                                           |
| 346   | MANUAL-ASSIGNMENT-MODE                 | W     | —                                                                                                                                                           |
| 347   | LAUNCHER-VISIBILITY-LOGO               | W     | —                                                                                                                                                           |
| 348   | WIDGET-KB-SEARCH                       | W     | —                                                                                                                                                           |
| 349   | INSTALL-WIZARD-NOSCRIPT                | W     | —                                                                                                                                                           |
| 350   | PROMO-SUPPRESSION                      | W     | —                                                                                                                                                           |
| 351   | CAMPAIGN-CURRENT-URL-FIX               | W     | —                                                                                                                                                           |
| 352   | CAMPAIGN-MULTI-CONDITIONS              | W     | —                                                                                                                                                           |
| 353   | RICH-CAMPAIGN-CARD                     | W     | —                                                                                                                                                           |
| 354   | CAMPAIGN-DELETE-REPORT-TEMPLATES       | W     | —                                                                                                                                                           |
| 355   | GOAL-CUSTOM-EVENT                      | W     | —                                                                                                                                                           |
| 356   | TICKET-REPLY-THREAD                    | W+R   | K23 pilot e-posta kapısı env'dir; effective-config'de görünür (389.13)                                                                                      |
| 357   | INBOUND-EMAIL-BODY                     | W     | —                                                                                                                                                           |
| 358   | EMAIL-THREADING                        | W     | —                                                                                                                                                           |
| 359   | TICKET-AUTO-ACK                        | W     | —                                                                                                                                                           |
| 360   | TICKET-FIRST-RESPONSE-SLA              | W     | —                                                                                                                                                           |
| 361   | INBOX-WAITING-TIMER                    | W     | —                                                                                                                                                           |
| 362   | READ-RECEIPTS                          | W     | —                                                                                                                                                           |
| 363   | CANNED-SEARCH-VARS-PRIVATE             | W     | —                                                                                                                                                           |
| 364   | EVENT-SUGGESTED-REPLIES                | W     | —                                                                                                                                                           |
| 365   | SHORTCUTS-PALETTE-SETTINGS             | W     | —                                                                                                                                                           |
| 366   | COPILOT-DRAWER                         | W     | —                                                                                                                                                           |
| 367   | EVENT-NOTIFICATIONS-REPEAT             | W     | —                                                                                                                                                           |
| 368   | REPORT-FILTERS                         | W     | —                                                                                                                                                           |
| 369   | MISSED-ENGAGEMENT-REPORTS              | W     | —                                                                                                                                                           |
| 370   | AVAILABILITY-ACTIVITY-REPORTS          | W     | —                                                                                                                                                           |
| 371   | QUEUE-REPORTS                          | W     | —                                                                                                                                                           |
| 372   | DIGEST-EMAILS                          | W     | —                                                                                                                                                           |
| 373   | ROUTING-RULES-UI-PARITY                | W     | —                                                                                                                                                           |
| 374   | TRIGGERS-RATED-TICKET-EVENTS           | W     | —                                                                                                                                                           |
| 375   | WEBHOOK-DELIVERY-LOG                   | W+R   | Kiracılar arası webhook birikimi/başarısızlık oranı root operasyonda (389.14)                                                                               |
| 376   | HOSTED-API-DOCS                        | W     | Platform kontratı ayrı dosyadır (`packages/contract/platform/`), kiracı OpenAPI'sine hiç girmez; sızıntı testi bunu da doğrular                             |
| 377   | IGAMING-CONNECT-PLACEHOLDERS           | W     | —                                                                                                                                                           |
| 378   | IGAMING-PLATFORM-F2 (deferred)         | W     | —                                                                                                                                                           |
| 379   | CUSTOM-PANELS-F2 (deferred)            | W     | —                                                                                                                                                           |
| 380   | WHATSAPP-LIVE (pending, K22)           | W+R   | Meta uygulama sırları env; canlı sağlayıcı listesi (`APPS_LIVE_PROVIDERS`) ve webhook sağlığı root'ta gösterilir (389.13/389.14); canlıya alma insan kararı |
| 381   | MESSENGER-INSTAGRAM-LIVE (pending)     | W+R   | #380 ile aynı                                                                                                                                               |
| 382   | BILLING-PAYMENT-METHODS                | W+R   | SWIFT "ödendi", kripto adres kuyruğu + TXID onayı, sağlayıcı aç/kapa, banka bilgisi ayarı root'ta (389.18). 382.4 platform kuyruğu KODLAMAZ                 |
| 383   | INVOICE-PDF-PROFILE                    | W+R   | İhraççı (SiyahTuş) profili platform ayarı; faturaları listeleme/indirme root'ta (389.18)                                                                    |
| 384   | SUBSCRIPTION-CANCEL                    | W+R   | Kiracı adına iptal/geri al (389.10), yıllık iade istisnası = kredi (389.12)                                                                                 |
| 385   | NARROW-SCREEN-PANEL                    | W     | `apps/admin` masaüstü-only kalır                                                                                                                            |
| 386   | NO-PII-IN-URLS                         | W+R   | CI denetimi `apps/admin`'i de tarar (389.6)                                                                                                                 |
| 387   | AI-MULTILINGUAL                        | W     | —                                                                                                                                                           |
| 388   | OPERATOR-SIGNED-IDENTITY-F2 (deferred) | W     | —                                                                                                                                                           |
| 389   | PLATFORM-ADMIN (epik)                  | R     | Root panelin kendisi                                                                                                                                        |
| 390   | AI-AGENT-CREATE                        | W     | `POST /ai-agents`, boş durum, AI Agent sekme yerleşimi                                                                                                      |

## 5. Bağımlılık yönü (özet)

```
kiracı görevi  ──(veri modeli, servis fonksiyonu)──▶  389.x root yüzü
      ▲                                                   │
      └──────────── bağımlılık YOK ───────────────────────┘
```

389.12 → #283 · 389.18 → #382, #383, #384 · 389.19 → #301, #311, #314, #315, #319 ·
389.17 → #283 (adaptör) · 389.14 "varsa" bileşenlere bağlanır (bağımlılık yok).
Kiracı görevlerine 389'a bağımlılık **eklenmedi**; dalga planı (07) değişmedi.
