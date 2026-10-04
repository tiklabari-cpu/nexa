# Task ID: 255

**Title:** PILOT-CODE-READINESS [EPIC] Docker pilot icin kod eksiklerinin kapatilmasi -- SMTP + gercek LLM/embedding + Settings IA + Tickets IA karari + Docker production config + events partition fitili

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Kontrollu production pilotuna cikmadan once kodda gercekten eksik olan isler. 2026-09-22 planlama turunda repo/PRD/PLAN/Task Master/denetim artefakti okunarak dogrulandi; her alt gorev kodda file:line kaniti ile acildi. Eski denetim bulgulari otomatik kabul edilmedi, bugunku koda karsi yeniden olculdu (healthcheck ve restart policy ornegin ZATEN var, o yuzden gorev acilmadi).

**Details:**

PILOT KAPSAMI (sahip karari, 2026-09-22) -- her alt gorev bu kutuyu varsayar:
- Hedef tam SaaS degil, KONTROLLU PRODUCTION PILOTU.
- Ilk dagitim Docker Compose + VPS. Kubernetes YAPILMAYACAK; mevcut Helm/K8s hazirligi KORUNUR, dokunulmaz.
- Gercek odeme ve Stripe kapsam DISI.
- Dosya yukleme pilotta kapali kalabilir; S3/object storage pilot blocker DEGIL.
- Yuksek kapasite/yuk testleri sonraki asama.
- Tam OpenTelemetry/Grafana sonraki asama; pilot icin temel log + health check + hata gorunurlugu yeterli.
- Gorsel Workflow Builder ve diger bilincli PRD istisnalari YENIDEN ACILMAZ.
- Pilotta GERCEK LLM saglayicisi ve GERCEK embedding saglayicisi kullanilacak.
- Pilot davet / sifre sifirlama / ilgili e-postalar info@nolnk.net uzerinden PrivateEmail SMTP ile gidecek.

SIR SINIRI (istisnasiz, her alt gorevde gecerli): SMTP kullanici adi, SMTP parolasi, LLM API key'i ve embedding API key'i HICBIR yere yazilmaz -- task detayina, PLAN.md'ye, HANDOFF.md'ye, commit'e, log'a, teste, ekrana. Kod yalnizca ANAHTAR ADLARINI bilir; gercek deger .env'de kalir. Hicbir alt gorev gercek saglayiciya istek atmak ZORUNDA degildir: dogrulama sahte SMTP sunucusu / sahte provider / enjekte edilen fetch ile yapilir (desen: apps/api/src/services/webhooks/webhook-dispatcher.ts:367 createHttpWebhookSender(fetchImpl)).

SIRA (bagimliliklar bunu zaten zorunlu kiliyor):
1) 255.1 saglayici karari -> 2) 255.2 SMTP config -> 3) 255.3 SMTP adapter -> 4) 255.4 auth mail akislari -> 5) 255.5 LLM seam -> 6) 255.6 sohbet adapteri -> 7) 255.7 embedding -> 8) 255.8 RAG recall -> 9) 255.9 limit/maliyet/redaction -> 10) 255.10 Settings navigasyon -> 11) 255.11 Settings arama -> 12) 255.12 Tickets IA karari -> 13) 255.13 upload kapali UI -> 14) 255.14 events partition -> 15) 255.15 Docker production config -> 16) 255.16 dogrulama.

BU EPIC'TE OLMAYANLAR VE NEDENI (yeniden acmayin):
- Odeme/Stripe (G9-PAY), kanallar/WhatsApp (G9-CHAN), mobil push (G9-PUSH), S3+ClamAV+SIEM+yuk testi (G9-INFRA), sosyal giris (G9-ID-a), MCP protokolu / PDF-Word / KB olcegi / dil icerigi (G9-GAP), Helm secret + K8s securityContext (G9-GATE-c/e): sahip karariyla pilot kapsami disinda.
- Healthcheck ve restart policy: ZATEN VAR (apps/*/Dockerfile HEALTHCHECK + docker-compose.full.yml restart: unless-stopped). Olculdu, gorev acilmadi.
- Log redaction altyapisi: ZATEN VAR (apps/api/src/lib/log-redact.ts). Yeni sir adlarinin listeye eklenmesi 255.3/255.6'nin kabul kriterine yazildi, ayri gorev degil.
- Davet / sifre sifirlama / 2FA e-postalarinin ICERIGI ve token omurleri: ZATEN VAR ve dogru (account-lifecycle.ts:190 1 saat tek kullanim; :418 7 gun tek kullanim; auth.ts:1187 2FA bildirimi; FR-MOD-00.3 notr cevap). Eksik olan yalnizca TASIYICI ve HATA DAVRANISI -- 255.3/255.4.
- e2e suitinin sira bagimliligi (denetim artefakti G9-GATE-a): gercek ve acik, ama urun kodu degil test altyapisi; bu turda sahibin listesinde yoktu. Her alt gorevin DoD'si test:e2e istedigi icin RISK olarak raporlandi; sahip isterse ayri gorev acilir.

**Test Strategy:**

Epic ancak 16 alt gorevin hepsi done olunca done olur (CONVENTIONS S4). Kapanis kaniti 255.16'dan gelir: (1) CONVENTIONS S1 kapisinin tamami --force ile yesil; (2) NODE_ENV=production pilot compose'u ayaga kalkar ve parseEnv/productionProblems'i GECER; (3) SMTP sahte sunucuya karsi davet + sifre sifirlama e-postasi uctan uca gider; (4) sahte LLM/embedding saglayicisiyla AI yanit yolu ve RAG recall kapisi yesil; (5) Settings gruplu navigasyon + arama e2e'de; (6) PLAN.md'de FR-MOD-08.1 satiri EKLENMIS ve damgali, diger dokunulan PRD satirlarinin damgasi ve K blogu guncel; (7) audit:req-coverage exit 0.

## Subtasks

### 255.1. PILOT-LLM-DECIDE [OPUS-HIGH] Sohbet ve embedding saglayici uyumluluk karari: aday matrisi + ADR + env anahtar sozlesmesi (gercek API cagrisi YOK, anahtar YOK)

**Status:** done  
**Dependencies:** None  

Pilotta gercek LLM ve gercek embedding kullanilacak, fakat saglayici henuz kesinlesmedi. Bu gorev kod degil KARAR uretir: adaylarin sohbet/embedding/streaming/tool-calling yuzeyini resmi dokumantasyondan dogrular, 'OpenAI uyumlu' iddiasini dogrulamadan kabul etmez, embedding boyutunu mevcut vector(1536) sozlesmesiyle karsilastirir ve 255.2/255.5/255.7'nin uygulayacagi env anahtar ADLARINI sabitler.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5; gereksinim etiketi S7. Sinirlar CLAUDE.md. Pilot kapsami ve sir siniri: ust gorev tm 255 details.

KODDA BUGUN (2026-09-22 olculdu):
- apps/api/src/config/env.ts:440 -> LLM_PROVIDER: z.enum(['mock']).default('mock'). Enum KAPALI; gercek saglayici bir config degeri degil, kod isi.
- apps/api/src/services/ai/inference.ts (104 satir) -> yalnizca bolge/izin kapisi: resolveInferenceProvider, inferenceLeavesRegion, assertInferenceAllowed (NFR-C4 HIPAA). Adapter YOK.
- Gercek uretim @siyahtus/ai-mock paketinde deterministik stub: intent.ts:29 INTENT_THRESHOLD=0.6, assist.ts summariseConversation/enhanceText, compiler.ts compileInstruction, topics.ts clusterTopics.
- packages/ai-mock/src/embedding.ts:22 EMBEDDING_DIMENSIONS=1536; :168 embed(text): number[] -- SENKRON (gercek saglayici async olacak, 255.7'nin isi).
- DB kolonu: apps/api/prisma/schema.prisma:1708 embedding Unsupported("vector(1536)").

KAPSAM -- su sekiz sorunun cevabi yazili olarak birakilir:
1) Aday sohbet saglayicilari ve her birinin RESMI API yuzeyi. Kaynak resmi dokumantasyon olmali (WebSearch/WebFetch); ikinci el blog yazisi kanit degildir, URL ile birlikte yazilir.
2) 'OpenAI uyumlu' iddiasi HER aday icin AYRI dogrulanir: /v1/chat/completions alan adlari, hata govdesi bicimi, akis (SSE) bicimi, tool/function calling semasi, embeddings ucunun VARLIGI. Uyum kismiysa NEREDE kirildigi tek tek yazilir. Dogrulanmadan 'uyumlu' kabul etmek bu gorevin reddidir.
3) Embedding saglayicisi sohbet saglayicisindan AYRI secilebilir; ayni olmak zorunda DEGILDIR. Iki ayri karar olarak yazilir.
4) Embedding boyutu: aday 1536 uretebiliyor mu (native ya da dimensions parametresiyle)? Uretemiyorsa migration + TAM yeniden gomme maliyeti yazilir; bu 255.7'nin dogrudan girdisidir.
5) Streaming pilotta gerekli mi? Bugun urunde token akisi yuzeyi YOK (AI yaniti RTM olayi olarak tek parca gidiyor). Gerekli degilse acikca KAPSAM DISI yazilir.
6) Tool/function calling pilotta gerekli mi? Skill adimlari bugun @siyahtus/ai-mock validateSteps kapisindan geciyor; model arac cagirmiyor. EVET/HAYIR yazilir.
7) Bolge/veri yerlesimi: NFR-C4 kapisi (assertInferenceAllowed) KORUNUR. Secilen saglayicinin kostugu bolge LLM_PROVIDER_REGION ile nasil eslesecek, yazilir.
8) Ucretlendirme sekli (token bazli / istek bazli) ve saglayici tarafi limitler -- 255.9'un girdisi.

CIKTI:
(a) ADR: docs/ altinda ya da PLAN.md S D kaydi (CONVENTIONS S1.2 bicimi).
(b) env anahtar ADLARI tablosu -- DEGER YOK, yalnizca isim ve anlam. Onerilen taslak, bu gorevde kesinlesir: LLM_PROVIDER, LLM_API_BASE_URL, LLM_MODEL, LLM_API_KEY, LLM_TIMEOUT_MS, LLM_MAX_OUTPUT_TOKENS, EMBEDDING_PROVIDER, EMBEDDING_API_BASE_URL, EMBEDDING_MODEL, EMBEDDING_API_KEY, EMBEDDING_DIMENSIONS. 255.2/255.5/255.7 TAM BU isimleri uygular.
(c) 255.5 / 255.6 / 255.7 / 255.9'un kapsamini daraltan net cumleler.

KAPSAM DISI: kod yazimi, enum acma, adapter, gercek API cagrisi, anahtar edinimi veya girisi, fiyat pazarligi, saglayici hesabi acma.

SAHIP KARARI BEKLIYORSA: saglayici sahibin secimiyse, matris tamamlanir ve ADR 'sahip karari bekleniyor: <hangi soru>' satiriyla kapatilir. Bu gorev yine de done olur; 255.5 baslamadan once sahip cevabi gerekir.

PRD: NFR-C4 (bolge/HIPAA kapisi korunur) - FR-MOD-06.3.2 (embedding/index sozlesmesi) - FR-05-06.EK1 (skill motoru calisma zamani).

### 255.2. PILOT-MAIL-ENUM [SONNET-HIGH] MAIL_PROVIDER=smtp: enum acilir, config sozlesmesi yazilir, production dogrulamasi saglayiciya bagli hale gelir (tasiyici 255.3'te)

**Status:** done  
**Dependencies:** None  

Bugun MAIL_PROVIDERS = ['file','null']; gercek gonderim ne kodda ne config'te mumkun. Bu gorev yalniz SOZLESMEYI acar: enum'a smtp, env semasina SMTP anahtar adlari, dort kaynak arasindaki parite (env.ts / .env.example / turbo.json globalEnv / .env.production.example) ve MAIL_PROVIDER=smtp secildiginde eksik ayarla production'da boot'un REDDEDILMESI. Gercek SMTP istemcisi 255.3'un isi.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5. Pilot kapsami ve sir siniri: ust gorev tm 255 details.

KODDA BUGUN (2026-09-22 olculdu):
- apps/api/src/services/mail/mailer.ts:88 -> export const MAIL_PROVIDERS = ['file','null'] as const. :109 createMailer bir switch; dosyanin kendi yorumu diyor ki 'enum'a smtp eklemek burada DERLEME HATASI vermeli, dosyaya dusmemeli' -- yani tasarim bu eklemeyi bekliyor.
- .env.example:137 MAIL_PROVIDER=file - .env.production.example:142 MAIL_PROVIDER=file.
- apps/api/src/routes/health.ts:160 providers.mail = env.MAIL_PROVIDER (yeni deger burada gorunur).
- apps/api/src/config/env.ts:693 productionProblems() bugun dort seyi zorunlu kiliyor: DATABASE_APP_URL, dev-only- yer tutucusu kalmamis sirlar, INBOUND_EMAIL_SECRET, WEB_ORIGIN'in widget origin'ini icermesi. SMTP hakkinda HICBIR sey yok.
- PARITE KAPISI GERCEK: apps/api/src/config/env.parity.test.ts env.ts'teki HER anahtarin .env.example'da ve turbo.json globalEnv'de bulunmasini, ayrica .env.example'da karsiligi olmayan anahtar BULUNMAMASINI test ediyor. apps/api/src/config/env.production-example.test.ts ayrica .env.production.example'i denetliyor. Eksik biri kapiyi kirmizi yapar.

KAPSAM:
1) mailer.ts: MAIL_PROVIDERS listesine 'smtp'; createMailer switch'ine smtp dali. Bu gorevde dal, 255.3'un dolduracagi tasiyiciyi cagirir; gecici olarak acik bir 'not implemented' hatasi firlatabilir AMA bu durum production'da boot'u engellemeli (asagidaki madde 3), sessizce file'a DUSMEMELI.
2) env.ts: 255.1'in sabitledigi SMTP anahtar ADLARI (taslak: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM, SMTP_TIMEOUT_MS). Hepsi optional; zorunluluk saglayiciya baglidir (madde 3). SMTP_FROM pilotta info@nolnk.net olacak -- ADRES bir sir degildir, ama KULLANICI ADI ve PAROLA sirdir ve yalniz .env'de yasar.
3) productionProblems(): MAIL_PROVIDER === 'smtp' ise SMTP_HOST / SMTP_PORT / SMTP_USERNAME / SMTP_PASSWORD / SMTP_FROM eksikse problem listesine eklenir -- boot reddedilir. Ayrica SMTP_PASSWORD dev-only- yer tutucusuyla gelemez (mevcut SECRET_KEYS deseni).
4) Dort kaynak paritesi: env.ts + .env.example + turbo.json globalEnv + .env.production.example. .env.production.example'da MAIL_PROVIDER=smtp ornegi ve SMTP_* satirlari YORUM olarak, DEGERSIZ.
5) health.ts/telemetry.ts yuzeyi: yeni deger kirilmadan gorunmeli.

KAPSAM DISI: gercek SMTP istemcisi, baglanti havuzu, retry, MIME (255.3). Gelen e-posta webhook'u ve bounce/complaint islemesi (pilot disi). Cagri yerlerinin hata davranisi (255.4). SPF/DKIM/DMARC DNS kaydi -- bu turda DNS islemi YOK.

SIR SINIRI: hicbir dosyaya gercek host/kullanici/parola yazilmaz. Testler sahte degerler kullanir. SMTP_PASSWORD, log-redact listesine eklenir (apps/api/src/lib/log-redact.ts) ve bunun testi yazilir.

PRD: FR-MOD-08.2 (e-posta bildirim tercihleri gercek bir tasiyici varsayar) - FR-MOD-04.4 (davet) - FR-MOD-00.3 (sifre sifirlama).

### 255.3. PILOT-MAIL-SMTP [OPUS-XHIGH] PrivateEmail uyumlu SMTP tasiyicisi: TLS + auth + zaman asimi + kalici/gecici hata ayrimi + yeniden deneme; sahte SMTP sunucusuna karsi test (gercek credential YOK)

**Status:** done  
**Dependencies:** 255.2  

Mailer arayuzu (send({to,subject,body,kind})) ve dokuz cagri yeri DEGISMEZ; degisen yalnizca tasiyicidir. XHIGH gerekcesi: (3) TESLIM GUVENCESI -- yeniden deneme mantigindaki bir hata e-postayi kaybettirir ya da iki kez gonderir; davet ve sifre sifirlama e-postasinin ikisi de tek kullanimlik token tasir.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5. Pilot kapsami ve sir siniri: ust gorev tm 255 details.

XHIGH GEREKCESI (PLAN S5.1.1 / S D175): (3) teslim guvencesi -- yeniden deneme/kuyruk mantigindaki bir hata mesaj kaybina ya da cift gonderime yol acar.

KODDA BUGUN (2026-09-22 olculdu):
- apps/api/src/services/mail/mailer.ts:36 interface Mailer { send(message: Message): Promise<void> } -- Message = { to, subject, body, kind }. kind: 'password_reset' | 'invitation' | 'notification' | 'scheduled_report' | 'ticket_notice'.
- DOKUZ cagri yeri (hicbiri degismemeli): routes/account-lifecycle.ts:190 (sifre sifirlama), :418 (davet), routes/auth.ts:1187 (2FA acildi bildirimi), routes/customer.ts:389, routes/settings.ts:1582 (SSO alan dogrulama), routes/tickets.ts:335, services/chat/chat-service.ts:1230, services/reports/scheduled-report-sweeper.ts:278, services/sla/sla-sweep.ts:261.
- FileMailer (mailer.ts:40) pratikte hic hata firlatmaz; bu yuzden bugun hicbir cagri yeri gercek bir gonderim hatasiyla karsilasmadi. Hata davranisi 255.4'un konusu, ama bu gorev HANGI hatanin firlatilacagini tanimlar.
- Desen olarak izlenecek iki yer: services/webhooks/webhook-dispatcher.ts:367 createHttpWebhookSender(fetchImpl = fetch) -- enjekte edilebilir tasiyici, testte ag YOK; ve redeliveryBackoffMs (:90) -- geri cekilme egrisi.

KAPSAM:
1) SmtpMailer: 255.2'nin actigi createMailer('smtp') dalini doldurur.
2) BAGIMLILIK KARARI PENCEREDE VERILIR ve gerekcesiyle yazilir: olgun bir kutuphane (ornek: nodemailer) mu, yoksa depodaki el-yazimi gelenek mi (s3-store.ts SigV4'u el-yazimi). Karar STARTTLS/implicit TLS, AUTH LOGIN/PLAIN, MIME ve basliklarin dogrulugu uzerinden verilir; secilen yol ADR/PLAN S D'ye yazilir. Yeni bir runtime bagimliligi ekleniyorsa pnpm-lock.yaml degisikligi commit'e dahildir.
3) Baglanti: TLS zorunlu (SMTP_SECURE), sunucu sertifikasi dogrulanir -- dogrulamayi kapatan bir secenek EKLENMEZ.
4) Zaman asimi: SMTP_TIMEOUT_MS; baglanti ve komut basina uygulanir; asilirsa gecici hata.
5) HATA AYRIMI (bu gorevin kalbi): SMTP 4xx = gecici (yeniden denenebilir), 5xx = kalici (asla yeniden denenmez); kimlik dogrulama hatasi (535) KALICIDIR ve tekrar denenmez. Iki sinif ayri tiplerle temsil edilir; 255.4 bu tipe gore davranir.
6) Yeniden deneme: yalnizca gecici hatada, ustel geri cekilme + ust sinir (webhook desenini izle). CIFT GONDERIM YASAK: sunucu mesaji kabul ettikten (250) sonra hicbir kosulda tekrar gonderilmez.
7) Log: baglanti/gonderim olaylari pino ile; ALICI ADRESI ve mesaj govdesi log'a YAZILMAZ; SMTP_PASSWORD redaction listesinde (255.2).

KAPSAM DISI: Mailer arayuzunun ve dokuz cagri yerinin degistirilmesi; kuyruk/outbox tablosu; bounce/complaint webhook'u; gelen e-posta; SPF/DKIM/DMARC DNS kaydi (bu turda DNS islemi yok); e-posta sablonlarinin HTML'e cevrilmesi.

SIR SINIRI: gercek PrivateEmail host/kullanici/parolasi HICBIR yere yazilmaz ve bu gorevde GERCEK SMTP SUNUCUSUNA BAGLANILMAZ. Dogrulama, testte ayaga kaldirilan sahte bir SMTP sunucusuna (node:net ile konusan kucuk bir sunucu ya da enjekte edilen tasiyici) karsi yapilir.

PRD: FR-MOD-08.2 - FR-MOD-04.4 - FR-MOD-00.3.

### 255.4. PILOT-MAIL-AUTHFLOW [OPUS-XHIGH] Gercek tasiyiciyla auth e-posta akislari: SMTP hatasi enumeration sizdirmamali ve commit edilmis daveti dusurmemeli (+ e2e)

**Status:** done  
**Dependencies:** 255.3  

FileMailer hic hata firlatmadigi icin bugune kadar gorunmeyen bir davranis: gercek SMTP'de gonderim hatasi sifre sifirlamada 202 yerine 500'e donusur ve hesabin VAR OLDUGUNU sizdirir (hesap yoksa mail hic denenmez, cevap 202 kalir). Davet akisinda ise e-posta hatasi, DB'ye ZATEN yazilmis davetleri cagirana basarisiz gosterir. XHIGH gerekcesi: (1) GUVENLIK YUZEYI -- enumeration korumasi (FR-MOD-00.3) hata kanalindan delinir.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5; gereksinim etiketi S7. Pilot kapsami ve sir siniri: ust gorev tm 255 details.

XHIGH GEREKCESI (PLAN S5.1.1 / S D175): (1) guvenlik yuzeyi -- enumeration korumasinin hata kanalindan delinmesi.

KODDA BUGUN (2026-09-22 olculdu):
- apps/api/src/routes/account-lifecycle.ts:185-200 POST /auth/password-reset: const token = await lifecycle.requestPasswordReset(email); IF (token) { await mailer.send(...) } sonra her iki durumda da 202 + NEUTRAL_RESET_MESSAGE. Yorum acikca diyor: 'Same body, same status, either way (FR-MOD-00.3)'. AMA mailer.send CIPLAK await: gercek SMTP hata verirse yalniz HESABI OLAN yol 500 doner -> notr cevap delinir.
- :415-425 POST davet: invitations transaction icinde yazilir ve COMMIT EDILIR, sonra await Promise.all(created.map(invite => mailer.send(...))). Tek bir adres hata verirse istek 500 doner ama davetler DB'de durur ve accept_url'ler gecerlidir.
- Try/catch DURUMU karisik: auth.ts:1187 (2FA bildirimi) ve tickets.ts:335 try/catch ICINDE; account-lifecycle.ts:190 ve :418, customer.ts:389, settings.ts:1582, chat-service.ts:1230, scheduled-report-sweeper.ts:278, sla-sweep.ts:261 CIPLAK await.
- settings.ts:1576 civarindaki yorum, SSO dogrulama mailinin basarisizligini 'bir dakika sonra bir yeniden deneme' olarak kabul ediyor -- yani orada davranis zaten dusunulmus.

KAPSAM:
1) Sifre sifirlama: e-posta gonderimi cevabi ETKILEMEZ. Hata yakalanir, log'lanir (adres log'a yazilmadan), cevap her iki dalda da AYNI govde + AYNI durum + benzer sureli olur. Gecici hatada yeniden deneme 255.3'un icinde kalir.
2) Davet: commit edilmis davetler geri alinmaz. Kismi basarisizlik cagirana 500 olarak DONMEZ; cevap 201 kalir ve hangi adreslerin postalanamadigi yanitta ya da log'da ayrik bir alanla bildirilir. Yanit govdesi degisiyorsa OpenAPI sozlesmesi guncellenir ve pnpm -w contract:generate kosulur (DoD kapisi bunu zaten zorunlu tutuyor). 'Davet baglantisini kopyala' yolu zaten gercek ve calisiyor -- kullanici bu yolla ilerleyebilmeli.
3) Kalan yedi cagri yeri icin ACIK karar: her biri icin 'hata cagirana yansisin mi' sorusu tek cumleyle cevaplanir ve kod buna uyar. Zamanlayici yollari (sla-sweep, scheduled-report-sweeper) bir mesajin dusmesi yuzunden TURU BIRAKMAMALI.
4) Token omurleri DOGRULANIR, degistirilmez: sifirlama 1 saat / tek kullanim, davet 7 gun / tek kullanim (kod bugun boyle; regresyon testi yazilir).

KAPSAM DISI: e-posta sablonlarinin icerigi/HTML'i; yeni bir outbox tablosu; bounce islemesi; 2FA yonetici sifirlama yuzeyi (pilot disi, PLAN S D132); SMTP istemcisinin kendisi (255.3).

SIR SINIRI: gercek SMTP sunucusuna baglanilmaz; testler sahte tasiyici/sahte sunucu kullanir.

PRD: FR-MOD-00.3 (sureli reset token + notr mesaj / enumeration korumasi) - FR-MOD-04.4 (coklu e-postayla davet) - FR-MOD-08.2.

### 255.5. PILOT-LLM-SEAM [OPUS-HIGH] LlmProvider arayuzu + LLM_PROVIDER enum'unun acilmasi + server.ts enjeksiyonu + testler icin sahte saglayici (gercek adapter 255.6'da)

**Status:** done  
**Dependencies:** 255.1  

Bugun AI metni uretmiyor: cagri yerleri dogrudan @siyahtus/ai-mock'tan import ediyor, LLM_PROVIDER enum'u ['mock'] ile kapali ve inference.ts yalnizca bolge kapisi. Bu gorev DIKISI acar: bir LlmProvider arayuzu, createLlmProvider fabrikasi (mailer/object-store deseni), server.ts'te enjeksiyon ve testlerin kullanacagi deterministik sahte saglayici. Gercek saglayici adapteri 255.6, embedding 255.7.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5. Pilot kapsami ve sir siniri: ust gorev tm 255 details. 255.1'in ADR'sini OKU: anahtar adlari, streaming ve tool-calling karari oradan gelir.

KODDA BUGUN (2026-09-22 olculdu):
- apps/api/src/config/env.ts:440 LLM_PROVIDER: z.enum(['mock']).default('mock'); :448 LLM_PROVIDER_REGION optional.
- apps/api/src/services/ai/inference.ts: resolveInferenceProvider / inferenceLeavesRegion / inferenceAllowed / assertInferenceAllowed. Bu KAPI KORUNUR -- gercek saglayici eklenirken NFR-C4 davranisi degismez.
- Cagri yerleri dogrudan pakete bagli: routes/copilot.ts:15 (ENHANCE_MODES, enhanceText, summariseConversation), routes/playbook.ts:13 (compileInstruction, validateSteps), routes/command-palette.ts:19 (matchPaletteTopic), services/ai/copilot-service.ts:24, services/ai/skill-engine.ts:17 (matchIntent, validateSteps), services/ai/knowledge-service.ts:11 (chunk, embed, toVectorLiteral), services/mcp/tools/summarize-chat.ts:35, services/reports/report-csv.ts:27.
- Izlenecek DESEN: server.ts:41 import { createMailer } ... :115 mailer = createMailer(env.MAIL_PROVIDER, { dir: env.MAIL_DIR }) -- fabrika env'den kurulur, secenek olarak enjekte edilir, test kendi sahtesini verir.

KAPSAM:
1) LlmProvider arayuzu (apps/api/src/services/ai/provider/ altinda): en az complete({ system, messages, maxOutputTokens, timeoutMs }) -> { text, usage } . Akis ve arac cagrisi YALNIZCA 255.1 EVET dediyse arayuze girer; HAYIR ise arayuz dar tutulur ve gerekcesi yorumda yazilir.
2) createLlmProvider(env) fabrikasi + LLM_PROVIDER enum'una 255.1'in sectigi deger(ler) ve 'mock'. Enum kapali kalmaya devam eder (switch derleme hatasi verir), ama artik iki degeri vardir.
3) server.ts enjeksiyonu: provider bir secenek olarak gecer; test sunucusu kendi sahtesini verir (test/helpers/fixtures.ts deseni).
4) FakeLlmProvider: deterministik, agsiz, testlerde kullanilir; kayit tutar (kac cagri, hangi istem) ki 255.9 sayaci dogrulayabilsin.
5) ILK TUKETICI olarak yalnizca skill-engine'in yanit uretme yolu arayuze baglanir (SkillEngine -> knowledge + persona -> send_message). Digerleri (copilot, ozet, enhance, command palette, konu kumeleme) BU GOREVDE degismez; 255.6'dan sonra ayri bir tur.
6) NFR-C4 kapisi: gercek saglayici secildiginde assertInferenceAllowed hala calisir -- HIPAA kapsamli bir workspace icin bolge disi cikarim REDDEDILIR. Bunun testi bu gorevde yazilir.

KAPSAM DISI: gercek HTTP adapteri (255.6), embedding (255.7), token/maliyet olcumu (255.9), intent esiginin modele tasinmasi (pilot disi), @siyahtus/ai-mock'un silinmesi -- mock saglayici KALIR, testler ve AI kapali kurulumlar onu kullanir.

SIR SINIRI: anahtar ADI env semasina girer, DEGERI hicbir yere yazilmaz; bu gorevde ag cagrisi YOK.

PRD: FR-05-06.EK1 (skill motoru calisma zamani) - FR-MOD-06.4 (persona) - NFR-C4 (bolge kapisi korunur).

### 255.6. PILOT-LLM-CHAT [OPUS-MAX] Secilen saglayicinin sohbet adapteri: zaman asimi, yeniden deneme, devre kesici, hata->insana devir; enjekte edilen fetch ile testler (gercek anahtar YOK)

**Status:** done  
**Dependencies:** 255.5  

255.5'in actigi LlmProvider arayuzunun gercek saglayici uygulamasi. Kural: her hata sinifinda konusma sessizce bozulmaz, INSANA DUSER. Adapter agi enjekte edilen fetch ile konusur, boylece test gercek anahtarsiz ve agsiz kosar.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5. Pilot kapsami ve sir siniri: ust gorev tm 255 details. 255.1 ADR'sini ve 255.5'in arayuzunu OKU.

KODDA BUGUN:
- AI yanit yolu: services/ai/skill-engine.ts -> matchIntent (kelime ortusmesi, INTENT_THRESHOLD 0.6) -> KnowledgeService.search -> persona sekillendirme (packages/types/src/persona.ts) -> send_message adimi. Model HICBIR metin yazmiyor.
- Enjekte edilebilir tasiyici DESENI: services/webhooks/webhook-dispatcher.ts:367 createHttpWebhookSender(fetchImpl: typeof fetch = fetch). Adapter AYNI deseni kullanir: createLlmAdapter({ fetchImpl = fetch, ... }).
- Outbound URL guvenligi icin mevcut yardimci: apps/api/src/lib/ssrf.ts. Saglayici taban URL'i CONFIG'ten gelir (kullanici girdisi degil), ama base URL dogrulamasi yine de yapilir.
- Geri cekilme egrisi ornegi: webhook-dispatcher redeliveryBackoffMs (:90).

KAPSAM:
1) Adapter: 255.1'in sectigi saglayicinin sohbet ucu; istek/cevap eslemesi; model adi LLM_MODEL'den.
2) Zaman asimi: LLM_TIMEOUT_MS; AbortController ile gercekten iptal edilir (asilan istek arkada calismaya devam etmez).
3) Yeniden deneme: yalnizca gecici siniflarda (429, 5xx, ag/zaman asimi). 4xx (400/401/403/404) KALICI, tekrar denenmez. 429'da saglayicinin Retry-After basligi varsa ona uyulur.
4) Devre kesici: ardisik N hatadan sonra acilir, pencere boyunca saglayiciya gidilmez, yari-acik denemeyle kapanir. Devre acikken AI yolu 'insana devir' verir.
5) HATA -> INSANA DEVIR: her basarisiz cikarim, konusmanin insan kuyruguna dusmesiyle sonuclanir (skill-engine'in mevcut handed_off yolu). Musteriye ham saglayici hatasi GOSTERILMEZ; log'a saglayici hata kodu yazilir, ISTEM VE YANIT METNI log'a yazilmaz.
6) Kimlik dogrulama: Authorization basligi LLM_API_KEY'den; deger log'a, hata mesajina, telemetriye ASLA girmez; log-redact listesine eklenir ve testi yazilir.
7) NFR-C4: assertInferenceAllowed adapterin CAGRILMASINDAN ONCE kosar (255.5'in testi burada da gecerli kalir).

KAPSAM DISI: streaming ve tool/function calling -- 255.1 EVET demediyse yazilmaz; embedding (255.7); token/maliyet sayaci (255.9); intent esiginin modele tasinmasi; copilot/ozet/enhance yuzeylerinin devri (ayri tur).

SIR SINIRI: GERCEK SAGLAYICIYA ISTEK ATILMAZ. Tum testler enjekte edilen fetch ile kosar. Gercek anahtar yalniz .env'de yasar ve pilotta sahibi tarafindan girilir.

PRD: FR-05-06.EK1 - FR-MOD-06.4 - NFR-C4.

### 255.7. PILOT-EMB-SEAM [OPUS-MAX] Gercek embedding saglayicisi: EmbeddingProvider arayuzu, embed() senkron->async gecisi (5 cagri yeri), vector(1536) sozlesmesi ve geri alinabilir yeniden gomme yolu

**Status:** done  
**Dependencies:** 255.5  

Bugun embedding hash'lenmis kelime torbasi ve embed() SENKRON. Gercek saglayici async oldugu icin bu, imza degisikligi gerektiren gercek bir refaktordur. vector(1536) DB sozlesmesi korunursa migration gerekmez; saglayici 1536 uretemiyorsa migration + tam yeniden gomme gerekir -- karar 255.1'den gelir.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1 (S1.3 parcali kosu); git S2; handoff S3; MIGRATION POLITIKASI S6.3 (genislet-sonra-daralt; CREATE INDEX CONCURRENTLY kendi dosyasinda tek ifade). Pilot kapsami ve sir siniri: ust gorev tm 255 details. 255.1 ADR'sindeki BOYUT kararini OKU.

KODDA BUGUN (2026-09-22 olculdu):
- packages/ai-mock/src/embedding.ts:22 EMBEDDING_DIMENSIONS = 1536; :168 export function embed(text: string): number[] -- SENKRON; :213 toVectorLiteral; :225 chunk.
- DB: apps/api/prisma/schema.prisma:1708 embedding Unsupported("vector(1536)"); ilk migration 20260722154008_domain_model.
- embed() CAGRI YERLERI (bes): services/ai/knowledge-service.ts:128 (indeksleme, INSERT ... ${vector}::vector), :180 (sorgu vektoru), services/reports/report-csv.ts:1277 ve :1291 (konu kumeleme -- rapor basina COK sayida cagri), packages/ai-mock/src/topics.ts:157.
- knowledge-service.ts:44-47 yorumu: HNSW parametreleri 'gercek OpenAI embedding'lerine ve stub'a karsi' secilmis; :232-235 sorgu vektorunun skaler alt-sorgu olarak yazilmasinin sebebi (generic plan'da $1::vector her satirda yeniden ayristiriliyor).

KAPSAM:
1) EmbeddingProvider arayuzu: embed(texts: string[]) -> Promise<number[][]>; toplu cagri (batch) ZORUNLU -- her chunk icin ayri istek pilotta hem yavas hem pahali.
2) createEmbeddingProvider(env) fabrikasi; EMBEDDING_PROVIDER enum'u ('mock' + secilen). Sohbet saglayicisindan AYRI yapilandirilir (255.1 karari).
3) embed() senkron->async gecisi: bes cagri yeri de async yola tasinir. report-csv.ts'teki konu kumeleme icin ACIK KARAR verilir ve yazilir: rapor basina gercek saglayiciya yuzlerce cagri kabul edilemezse kumeleme stub'da BIRAKILIR (mesru bir secim; gerekcesi PLAN S D'ye yazilir).
4) BOYUT SOZLESMESI: saglayici 1536 uretiyorsa migration YOK. Uretmiyorsa: yeni kolon + geri doldurma + eski kolonun dusurulmesi (S6.3 genislet-sonra-daralt), HNSW indeksinin yeniden insasi ve db:check-drift temiz. Bu dal 255.1'in kararina bagli; hangi dalin kosuldugu kapanista yazilir.
5) YENIDEN GOMME YOLU: mevcut bilgi tabani stub vektorleriyle dolu. Geri alinabilir ve kesintisiz bir yeniden gomme yordami (script ya da bakim komutu): kaynak kaynak ilerler, yarida kalirsa kaldigi yerden devam eder, calisirken retrieval BOZULMAZ. Karisik durum (bir kismi stub, bir kismi gercek) OLCULUR ve davranisi yazilir -- iki farkli uzayin vektorleri ayni indekste anlamsiz komsuluk uretir; bu yuzden yeniden gomme kaynak bazinda ATOMIK olmali.
6) Hata davranisi: embedding saglayicisi erisilemezse INDEKSLEME basarisiz olur ve bunu soyler; SORGU yolunda hata, retrieval'i bos donduruP AI'yi insana devretmeli (sessiz yanlis cevap YOK).

KAPSAM DISI: sohbet adapteri (255.6); recall kapisi (255.8); ANN/olcek tavani (tm 254, pilot disi); yeni bir vektor veritabani.

SIR SINIRI: EMBEDDING_API_KEY adi env semasina girer, degeri hicbir yere yazilmaz; testler sahte saglayiciyla, agsiz kosar.

PRD: FR-MOD-06.3.2 (chunk + embedding + index) - SEMA-MIMARI.8.4c'ye dokunulmaz.

### 255.8. PILOT-RAG-RECALL [OPUS-HIGH] Retrieval/recall kapisi: altin soru-pasaj kumesi, esik ve gerileme testi (sahte saglayiciyla deterministik)

**Status:** done  
**Dependencies:** 255.7  

Gercek embedding'e gecildiginde 'arama hala dogru pasaji buluyor mu' sorusunu olcen bir kapi yok. tm 252 (V8-KB-RECALL) bir kez elle olcmustu; bu gorev onu tekrarlanabilir bir gerileme kapisina cevirir. Kapi sahte saglayiciyla deterministik kosar; gercek saglayici icin ayni kume elle kosulabilir kalir.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5. Pilot kapsami: ust gorev tm 255 details.

BAGLAM: tm 252 ve tm 254 (tasks.json'da done) retrieval'i olctu: tam arama dogru, maliyet chunk sayisiyla dogrusal; IVFFlat indeksi dogru pasaji kacirabiliyordu. services/ai/knowledge-service.ts:33-47 ve :160-235 yorumlari bugunku yolu ve HNSW parametrelerinin neden oyle secildigini anlatiyor; RETRIEVAL_THRESHOLD ayni dosyada.

KAPSAM:
1) Altin kume: en az 20 soru-beklenen pasaj cifti, seed bilgi tabanindan uretilir; repoda veri dosyasi olarak yasar.
2) Olcut: recall@k (k= urunun gercekten kullandigi limit) ve esigin altinda kalan sorularin listesi. Esik SAYIYLA yazilir ve gerekcesi kaydedilir.
3) Kapi: sahte embedding saglayicisiyla deterministik kosar ve CI'da kosabilecek surede kalir. Gercek saglayiciyla kosmak icin ayni kumeyi kullanan elle bir komut birakilir (varsayilan olarak KOSMAZ, anahtar ister).
4) Gerileme: esigin altina dusus testi KIRMIZI yapar.
5) RETRIEVAL_THRESHOLD'un gercek embedding uzayinda hala anlamli olup olmadigi olculur; degisiyorsa yeni deger gerekcesiyle yazilir.

KAPSAM DISI: model kalite degerlendirmesi (yanit metninin iyiligi); ANN/olcek calismasi (tm 254); gercek saglayiciya CI'da cagri.

SIR SINIRI: CI yolunda gercek saglayiciya cagri YOK; anahtar gerektiren komut varsayilan olarak kapali.

PRD: FR-MOD-06.3.2.

### 255.9. PILOT-AI-LIMITS [OPUS-XHIGH] Token/maliyet olcumu mevcut AI sayaclarina baglanir + istek basina tavan + hata taksonomisi + sir redaction denetimi

**Status:** done  
**Dependencies:** 255.6, 255.7  

AI kullanimi bugun fatura ve raporlarda sayiliyor ama saydigi sey sahte bir cikarim; gercek saglayiciyla token ve maliyet gercek olur. XHIGH gerekcesi: (2) PARA DOGRULUGU -- bu sayilar AI resolution sayacina ve faturaya gidiyor.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5. Pilot kapsami ve sir siniri: ust gorev tm 255 details.

XHIGH GEREKCESI (PLAN S5.1.1 / S D175): (2) para dogrulugu -- faturaya giden sayilar.

KODDA BUGUN: AI kullanim sayaclari ve kota yuzeyi mevcut (reports/billing yolu; AI_RESOLUTIONS_INCLUDED / AI_OVERAGE_CENTS env anahtarlari .env.example'da). 255.5'in FakeLlmProvider'i cagri sayisini zaten tutuyor. Eksik olan: gercek token kullanimi, istek basina tavan ve maliyet.

KAPSAM:
1) Kullanim kaydi: her cikarimdan donen usage (girdi/cikti token) kaydedilir ve MEVCUT AI sayaclarina baglanir -- yeni bir paralel sayac YARATILMAZ; once mevcut sayacin nerede tutuldugu okunur, oraya eklenir.
2) Istek basina tavan: LLM_MAX_OUTPUT_TOKENS (255.1'in adlandirmasi) adapter'a gecer ve saglayiciya iletilir; ayrica istem uzunlugu icin ust sinir -- asan istek saglayiciya GONDERILMEDEN reddedilir ve insana devredilir.
3) Hata taksonomisi: 255.6'nin gecici/kalici siniflari urun tarafinda tek bir anlasilir sonuca baglanir (insana devir) ve log'da saglayici hata kodu ile ayirt edilebilir olur.
4) Sir redaction denetimi: LLM_API_KEY, EMBEDDING_API_KEY ve SMTP_PASSWORD apps/api/src/lib/log-redact.ts listesinde; istem ve yanit METNI log'a ve telemetriye yazilmaz. Bunun testi bu gorevde toplu olarak yazilir.
5) Kota davranisi: kota asildiginda bugunku davranis ne ise KORUNUR; degistirilmez (pilot kapsami). Yalnizca sayilan seyin gercek olmasi saglanir.

KAPSAM DISI: fiyatlandirma modeli degisikligi; %80 kota uyari e-postasi (denetim bulgusu N2, pilot disi); faturalama/tahsilat (G9-PAY, kapsam disi); saglayici tarafi rate-limit pazarligi.

SIR SINIRI: anahtar degerleri hicbir yerde; istem/yanit metni log'da yok.

PRD: FR-MOD-07.3.2 (Manual/Assisted/Automated + billing AI resolution iliskisi) - FR-05-06.EK1.

### 255.10. PILOT-SETTINGS-NAV [OPUS-HIGH] Settings gruplu navigasyon + bolum basina deep-link: FR-MOD-08.1 (Must, MVP) bugun karsilanmiyor -- 31 bolum tek duz sayfada

**Status:** done  
**Dependencies:** None  

PRD FR-MOD-08.1 Must/MVP olarak gruplu kenar cubugu (Notifications / Company details / Desktop app / Channels / Routing / Inbox / Integrations / Security / Billing), izin bazli gorunurluk ve daraltma istiyor. Kodda Settings tek bir Page icinde 31 bolumu alt alta render ediyor; izin gorunurlugu VAR, navigasyon YOK. PLAN.md'de bu PRD satiri hic yok -- damga duzeltmesi degil, satirin EKLENMESI gerekiyor.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5; gereksinim etiketi S7 (etiket TEST BASLIGINDA, parantez icinde). Pilot kapsami: ust gorev tm 255 details.

KANIT (2026-09-22 olculdu):
- PRD satir 596: 'FR-MOD-08.1 -- Settings kabugu/kenar cubugu: Notifications, Company details, Desktop app; Channels; Routing; Inbox; Integrations; Security; Billing gruplu navigasyon; izin bazli gorunurluk; "Unpin side navigation" ile daraltma. (Must, MVP)'. Ayni satirda 'SiyahTuş iyilestirmesi: Settings ici arama (20+ alt sayfa)' -- arama 255.11'in isi.
- PRD satir 861 (S8.1 IA iyilestirmeleri): 'Settings ici arama eklenir (20+ alt sayfa)'.
- KOD: apps/web/src/features/settings/SettingsPage.tsx (114 satir) tek bir <Page> icinde 31 bolum bileseni render ediyor (CompanyDetails ... ScheduledExports). Gruplama, kenar cubugu, daraltma YOK. Izin bazli gorunurluk VAR (scopes -> canEdit/canManage proplari, :69-77) -- bu KORUNUR.
- ROTA: apps/web/src/App.tsx:116 'settings' tek rota; :117 yalnizca 'settings/audit-log' ayri. Bolum basina deep-link YOK.
- prd-uyum-denetimi.md:371 ayni bulguyu 2026-08-30'da KISMI/Onemli olarak kaydetmis (o gun 28 bolum, bugun 31) -- bulgu eskimemis, buyumus.
- PLAN.md: 'FR-MOD-08.1' dizesi PLAN.md'de SIFIR kez geciyor; S3.7 'FR-MOD-08 -- Settings (yalniz MVP payi)' tablosunda 11 satir var ve 08.1 ARALARINDA DEGIL. Yani bu bir yanlis damga degil, EKSIK SATIR: audit:sweep bu satiri hic gormedigi icin '0 acik' diyor.

KAPSAM:
1) Settings kabugu: PRD'nin adlandirdigi gruplara gore kenar cubugu; mevcut 31 bolum bu gruplara DAGITILIR (hicbiri kaybolmaz; esleme tablosu kapanista yazilir).
2) Bolum basina deep-link: /app/settings/<bolum> rotalari; mevcut /app/settings/audit-log rotasi kirilmaz; /app/settings kok rotasi anlamli bir varsayilana yonlenir.
3) Izin bazli gorunurluk: kullanicinin scope'u yoksa grup/bolum BASLIGI da gorunmez (bugunku canEdit=false davranisi korunur, ustune navigasyon gorunurlugu eklenir).
4) Daraltma ('Unpin side navigation'): tercih kullanici bazinda kalici olmali. DIKKAT (olculmus tuzak): iyimser bir tercih anahtarinin e2e'de yarisa girdigi ve hesap kapsamli tercihlerin sonraki teste sizdigi daha once yasandi (tm 250) -- tercih yazma yolunun testi gezinmeden ONCE yaniti beklemeli.
5) PLAN.md: S3.7 tablosuna FR-MOD-08.1 satiri EKLENIR, damgasi bu gorevin gercekte teslim ettigi kadar olur (arama 255.11'de ise dogru damga '(0)' degil kismi olabilir -- CONVENTIONS S1.2 bicimi, kanit K blogunda).

KAPSAM DISI: Settings ici ARAMA (255.11); bolum iceriklerinin yeniden yazilmasi; Billing sayfasinin tasinmasi; mobil davranis ve klavye erisilebilirligi ayrintilari (255.11).

PRD: FR-MOD-08.1 - SEMA-MIMARI.8.1c (kismi).

### 255.11. PILOT-SETTINGS-SEARCH [SONNET-HIGH] Settings ici arama (31 bolum) + klavye erisilebilirligi + mobil davranis

**Status:** done  
**Dependencies:** 255.10  

PRD FR-MOD-08.1'in 'SiyahTuş iyilestirmesi' payi: 20+ alt sayfa icinde arama. 255.10'un gruplu navigasyonu uzerine oturur; arama sonucu ilgili bolumun deep-link'ine goturur.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5; gereksinim etiketi S7. Pilot kapsami: ust gorev tm 255 details.

KANIT: PRD:596 'SiyahTuş iyilestirmesi: Settings ici arama (20+ alt sayfa)'; PRD:861 ayni istek S8.1 IA iyilestirmeleri arasinda. Kodda arama YOK (SettingsPage.tsx'te arama alani yok, 2026-09-22).

KAPSAM:
1) Arama alani: bolum adi ve bolumun anahtar kelimeleri uzerinde; sonuc listesi 255.10'un deep-link rotasina goturur.
2) Izin filtresi: kullanicinin goremedigi bolum arama sonuclarinda DA cikmaz -- negatif test (bilgi sizintisi olur).
3) Klavye: alan odaklanabilir, sonuclar ok tuslariyla gezilebilir, Enter secer, Escape kapatir. Mevcut komut paleti (apps/web/src/components/CommandPalette.tsx) bu depoda zaten bir klavye deseni tasiyor -- once o okunur, desen tekrarlanir, KOPYALANMAZ.
4) i18n: yeni metinler cevrilir. DIKKAT (olculmus tuzak): t() cagiran yeni bir web bileseni i18n-coverage.test.ts'in TRANSLATED_FILES listesine EKLENMEZSE iki assertion kirmizi olur.
5) Mobil: dar ekranda navigasyon ve arama kullanilabilir kalir (mevcut duzenin kirilmadigi dogrulanir).
6) a11y: arama alaninin adi/rolu dogru; sonuc listesi ekran okuyucuya duyurulur. DIKKAT (olculmus tuzak): bir etiketin icine giren yardim metni getByLabelText'i, baska bir dugmenin aria-label'iyle ayni metin ise getByRole'u kirar.

KAPSAM DISI: global komut paletinin degistirilmesi; bolum iceriklerinde metin aramasi (yalniz bolum duzeyinde arama); yeni bolum eklenmesi.

PRD: FR-MOD-08.1 - SEMA-MIMARI.8.1c (kismi).

### 255.12. PILOT-TICKETS-IA [SONNET-HIGH] Tickets bilgi mimarisi KARARI: PRD 'ust-seviye gorunur' diyor ama birincil navigasyon listesinde Tickets yok -- ADR + PLAN kaydi (kod degisikligi bu gorevde YOK)

**Status:** done  
**Dependencies:** None  

Kullanicinin gozlemi dogrulandi: /app/tickets rotasi yok, ticket yuzeyi Inbox icinde yasiyor. Fakat PRD iki yerde birbirini tam tamamlamayan sey soyluyor. Bu yuzden dogrudan kod gorevi acilmadi: once karar, ADR'ye yazilir; ayri rota gerekiyorsa takip gorevi ACILIR (bu turda degil).

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5. Pilot kapsami: ust gorev tm 255 details.

KANIT (2026-09-22 olculdu) -- KARARIN DAYANAGI BU IKI SATIRIN GERILIMI:
- PRD:861 (S8.1 IA iyilestirmeleri): 'Tickets ust-seviye gorunur kilinir (yalniz Inbox'ta gizli degil)'.
- PRD:846 (S8.1 birincil navigasyon, sol ikon rayi): 'Home - Inbox - Customers (Real-time/Contacts/Campaigns) - Team (AI Agents/Copilot/Teammates/Teams) - Playbook - Engage (Traffic/Goals/Campaigns) - Reports - [alt] Settings - Help - Account'. Bu listede Tickets YOK.
- KOD: apps/web/src/App.tsx:102-120 rotalari -- home, inbox, customers(+3), team(+2), reports, billing, playbook, settings(+audit-log), apps, developers. /app/tickets YOK.
- Ticket yuzeyi Inbox icinde GERCEK ve calisiyor: apps/web/src/features/inbox/ ticket-grid.ts, ticket-selection.ts, ticket-priority.ts, TicketBulkBar.tsx, CreateTicketButton.tsx. Denetim (prd-uyum-denetimi.md:200) bunu SEMA-MIMARI.8.1c altinda 'Kucuk' siddetle 'karsiligi yok' diye isaretlemis.
- Ayrica US-5 KK3 ('sohbetten ticket') denetimde GERCEK olarak dogrulanmis -- yani islevsellik degil, YALNIZ GORUNURLUK tartisiliyor.

KAPSAM -- su uc secenekten biri gerekcesiyle secilir:
(A) Birincil navigasyona ayri Tickets girisi + /app/tickets rotasi + deep-link + e2e kapsami.
(B) Inbox icindeki mevcut Tickets gorunumu ust-seviye bir giristen deep-link ile acilir (rota Inbox'in alti, ama navigasyonda kendi adiyla gorunur).
(C) Mevcut tasarim PRD ile uyumlu sayilir; gerekce ADR'ye yazilir ve SEMA-MIMARI.8.1c'nin durumu PLAN'da acikca kaydedilir.
Secim PRD:846 ile PRD:861'in nasil uzlastirildigini TEK CUMLEYLE soylemeli. Referans urunun (LiveChat/text.com) bugunku IA'si WebSearch/WebFetch ile bakilabilir ve karara dayanak olarak yazilabilir -- ama PRD'nin kendi cumlesi ustundur.

CIKTI: ADR (docs/ ya da PLAN S D) + PLAN.md'de SEMA-MIMARI.8.1c'nin durumunun acikca kaydi. (A) ya da (B) secilirse UYGULAMA ICIN YENI BIR TASK ACILIR (baslik, kapsam, e2e kapsami ve PRD kimligi bu gorevde yazilir) -- uygulama bu gorevin kapsaminda DEGIL.

KAPSAM DISI: rota/navigasyon kodu yazmak; Inbox'taki ticket yuzeyini degistirmek; AI yeteneklerinin 'tek ev'e toplanmasi (SEMA-MIMARI.8.1c'nin ikinci payi, pilot disi).

PRD: SEMA-MIMARI.8.1c.

### 255.13. PILOT-UPLOAD-OFF [SONNET-HIGH] Dosya paylasimi kapaliyken ek dugmesi gosterilmemeli: API dogru reddediyor, UI reddi ancak dosya secildikten SONRA gosteriyor

**Status:** done  
**Dependencies:** None  

Pilotta dosya yukleme kapali kalabilir. API tarafi dogru (403 + anlasilir mesaj), ama ajan ve musteri yuzeyinde ek dugmesi duruyor; kullanici dosya seciyor ve ancak sonra hata goruyor. Kucuk, pilot blocker degil; kullanicinin acikca inceleme istedigi madde oldugu icin acildi.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5. Pilot kapsami: ust gorev tm 255 details.

KANIT (2026-09-22 olculdu):
- API DOGRU: apps/api/src/routes/uploads.ts:95-105 -- securitySettings okunur, fileSharingEnabled false ise izin adiminda ApiError.authorization('File sharing is turned off for this licence.') atilir; URL hic uretilmez. Tur ve boyut reddi de ayni yerde.
- Ayar yuzeyi VAR: apps/web/src/features/settings/FileSharing.tsx:130 file_sharing_enabled anahtari; API routes/settings.ts:615/1975.
- UI: apps/web/src/features/inbox/Composer.tsx ek yolunu uploadAttachment ile kuruyor; file_sharing_enabled'i HIC okumuyor (grep: apps/web + apps/widget icinde yalnizca settings ekranlarinda geciyor).
- BILINCLI TASARIM KARARINA DIKKAT: Composer.tsx:63-65 yorumu diyor ki istemci tarafi TUR/BOYUT sinirlarini ikinci kez kontrol etmez, red /uploads'tan gelir. BU KARAR KORUNUR. Bu gorev tur/boyut on-kontrolu EKLEMEZ; yalnizca OZELLIK TAMAMEN KAPALIYKEN affordance'i kaldirir -- 'her zaman basarisiz olacak bir dugme' ile 'sunucunun reddedecegi bir dosya' farkli seylerdir.

KAPSAM:
1) Ajan composer'i: dosya paylasimi kapaliysa ek dugmesi gizlenir ya da devre disi + sebebi soyleyen kisa bir aciklama.
2) Musteri widget'i: ayni davranis (widget'in ayar okuma yolu yoksa, mevcut bootstrap/config yanitina bu bayragin eklenmesi bu gorevin kapsamindadir).
3) Ayar acik/kapali degistiginde yuzey makul surede guncellenir (mevcut sorgu/cache deseni izlenir).
4) API davranisi DEGISMEZ -- 403 yolu ve mesaji aynen kalir; UI onu ikinci kez taklit etmez.

KAPSAM DISI: istemci tarafi tur/boyut on-kontrolu (bilincli karar, yukarida); S3/object storage (pilot disi); virus taramasi (pilot disi, ClamAV G9-INFRA-b).

PRD: FR-MOD-08.9.4 (File sharing -- izinli tur/boyut + reddi) - NFR-S10.

### 255.14. PILOT-EVENTS-PARTITION [OPUS-MAX] events partisyon bakimi calisma-zamani roluyle kosamiyor: ~2026-12'den itibaren her olay events_default'a duser -- SECURITY DEFINER + saglik sinyali

**Status:** done  
**Dependencies:** None  

PLAN S D131'de 2026-08-28'de OLCULMUS, hala acik: events_ensure_partition / events_secure_partition siyahtus_app roluyle calismiyor; zamanlayici yeni ay partisyonunu uretemiyor. Pilot takvimi Aralik'a uzandigi icin tarihi pilot penceresinin ICINDE. Kiraci izolasyonu etkilenmiyor (RLS duruyor), ama olaylar tek varsayilan partisyona yigiliyor ve hata bugun sessizce yutuluyor.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; MIGRATION POLITIKASI S6 ve S6.3. Pilot kapsami: ust gorev tm 255 details.

KANIT:
- PLAN.md S D131 (tm 157, 2026-08-28, MEDIUM): 'events partisyon bakimi calisma-zamani roluyle HIC kosamiyor; ~2026-12'den itibaren her olay events_default'a duser -- kiraci izolasyonu ETKILENMEZ'. PLAN.md:6430 ayni borcu ismen tekrar sayiyor.
- Kod: apps/api/prisma/migrations/20260722154008_domain_model/migration.sql:654 events_ensure_partition, :700 GRANT EXECUTE ... TO siyahtus_app; 20260826090000_events_partition_rls/migration.sql:34 events_secure_partition, :64 GRANT, :75 ve :93/:119 cagri zinciri. GRANT var ama fonksiyonlar SECURITY DEFINER degil: CREATE TABLE / partition attach icin gereken hak cagirana ait olmadigindan siyahtus_app ile permission denied uretiyor.
- Hata bugun yutuluyor (plugins/database.ts yolu) -- yani arizanin kendisi de gorunmez.
- Bagimsiz denetim artefakti ayni maddeyi G9-GATE-b olarak OPUS-MAX etiketiyle listeliyor.

KAPSAM:
1) KIRMIZI-ONCE: siyahtus_app roluyle bugunku permission denied'i URETEN bir test yazilir (once kirmizi oldugu gosterilir).
2) Migration: iki fonksiyon SECURITY DEFINER yapilir; search_path sabitlenir (SET search_path = ...) ve EXECUTE haklari daraltilir -- SECURITY DEFINER bir yetki yukseltmesidir, bu yuzden fonksiyonun ne yaptigi ve neden guvenli oldugu migration yorumunda yazilir. Fonksiyonlar YALNIZ partisyon uretir/guvenceye alir; disaridan gelen bir isim parametresiyle keyfi DDL calistirilamaz (girdi dogrulamasi).
3) SAGLIK SINYALI: bakim basarisizligi artik sessizce yutulmaz; saglik/log yuzeyine cikar (mevcut health.ts deseni ya da zamanlayici sonucu). Pilotta bu arizanin FARK EDILEBILIR olmasi bu gorevin asil urunu.
4) Geriye donuk: bugune kadar events_default'a dusmus satir varsa davranisi olculur ve yazilir (tasima bu gorevin kapsaminda degilse acikca yazilir).

KAPSAM DISI: partisyon saklama/retention politikasi degisikligi; events semasinin degistirilmesi; ANN/olcek isleri.

DIKKAT (olculmus tuzaklar): migrate deploy P1002 genelde artakalan bir Prisma shadow-DB oturumunun pg_advisory_lock(72707369)'i tutmasidir -- o pid sonlandirilir. Migration provasi icin izole bir DB: with-test-datastores.ts <komut>. pnpm db:reset ajanlara kapalidir; gerekiyorsa SIYAHTUS_SEED_RESET=1 pnpm db:seed.

PRD: SEMA-MIMARI.8.4c (events aylik RANGE partition) - NFR-P6 (buyuk liste sorgulari partisyona dayaniyor).

### 255.15. PILOT-DOCKER-PROD [OPUS-HIGH] Pilot icin NODE_ENV=production compose yapilandirmasi: bugunku tam yigin BILEREK development kosuyor, yani hicbir production kapisi calismiyor

**Status:** done  
**Dependencies:** 255.2, 255.5  

docker-compose.full.yml basindaki yorumun kendisi soyluyor: NODE_ENV development, cunku uc production kapisi bu yigini reddediyor (dev-only- yer tutuculari, INBOUND_EMAIL_SECRET, CORS/widget origin). Pilot gercek .env ile production'da kosacagi icin bu kapilarin ATLANMASI degil KARSILANMASI gerekir. Healthcheck ve restart policy ZATEN var -- bu gorev onlari yeniden yazmaz.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5. Pilot kapsami: ust gorev tm 255 details.

KANIT (2026-09-22 olculdu):
- docker-compose.full.yml:1-33 basligi: 'SCOPE: this is a LOCAL stack, not a deployment' ve 'NODE_ENV is development here ON PURPOSE' -- sebep olarak uc kapi sayiliyor: parseEnv dev-only- yer tutucularini reddediyor; production CORS WEB_ORIGIN'e daraliyor ve widget'in :5174'ten gelen cagrilarini kesiyor; parseEnv production'da INBOUND_EMAIL_SECRET istiyor.
- Yigin .env.example'i env_file olarak yukluyor (api :169, rtm :189) -- yani yer tutucu degerlerle kosuyor.
- productionProblems (apps/api/src/config/env.ts:693) bugun dort seyi zorunlu kiliyor: DATABASE_APP_URL, dev-only- kalmamis sirlar, INBOUND_EMAIL_SECRET, WEB_ORIGIN'in WIDGET_BASE_URL origin'ini ICERMESI (bu sonuncusu tm 243'te eklendi ve yukaridaki CORS gerekcesini ZATEN cozuyor -- yorum bu yonuyle eskimis olabilir, pencere bunu dogrular).
- ZATEN VAR, YENIDEN YAZILMAYACAK: apps/api/Dockerfile:127, apps/rtm/Dockerfile:119, apps/web/Dockerfile:91, apps/widget/Dockerfile:66 HEALTHCHECK; compose'ta restart: unless-stopped ve depends_on service_healthy zinciri.
- .env.production.example VAR ve kendi testi var (apps/api/src/config/env.production-example.test.ts): NODE_ENV=production, INBOUND_EMAIL_SECRET yer tutucusuz.

KAPSAM:
1) Pilot compose: ayri bir dosya ya da overlay (ornek docker-compose.pilot.yml ya da .prod overlay). NODE_ENV=production; env_file GERCEK .env (repoya girmez); .env.example yer tutuculari KULLANILMAZ.
2) Bu yigin parseEnv + productionProblems'i GECMELIDIR: DATABASE_APP_URL (RLS icin non-owner rol), sirlarin yer tutucu olmamasi, INBOUND_EMAIL_SECRET, WEB_ORIGIN'in widget origin'ini icermesi. Ayrica 255.2 ile MAIL_PROVIDER=smtp ve SMTP_* zorunlulugu, 255.5 ile LLM/embedding anahtar adlari.
3) .env.production.example GUNCELLENIR: bugun LLM_PROVIDER=mock (satir 140) ve MAIL_PROVIDER=file (satir 142) yaziyor; pilot gercegi yansitilir (DEGER YOK, yalnizca anahtar ve yorum). Mevcut production-example testi yesil kalmali.
4) Veri kaliciligi ve yedek: pilotta DB volume'unun kalici oldugu ve mevcut yedek yordamiyla (Makefile backup / restore-drill) uyumlu oldugu dogrulanir.
5) Calistirma yordami README'ye ya da docs/production-checklist.md'ye tek bolum olarak yazilir: hangi komut, hangi anahtarlar gerekli (ADLARIYLA), saglik nasil dogrulanir.

KAPSAM DISI -- BU TURUN SINIRI: gercek VPS'e dagitim, DNS, TLS sertifikasi, reverse proxy kurulumu, gercek secret'larin girilmesi, Kubernetes/Helm (mevcut hazirlik KORUNUR, DOKUNULMAZ), yedeklerin uzak depoya gonderilmesi.

SIR SINIRI: hicbir gercek deger commit'e girmez; .env repoda degildir ve .gitignore zaten kapsar.

PRD: NFR-C4 baglami korunur; dogrudan kapi productionProblems'in kendisidir.

### 255.16. PILOT-READY-VERIFY [OPUS-HIGH] Pilot kod hazirlik dogrulamasi: butun kapilar --force ile, production yigini fiilen ayakta, PRD damgalari ve kanit bloklari dogru

**Status:** done  
**Dependencies:** 255.4, 255.8, 255.9, 255.11, 255.12, 255.13, 255.14, 255.15, 255.17  

Epic'in kapanis kapisi. Onceki 15 alt gorevin tek tek yesil olmasi yeterli degil: bu gorev hepsini BIRLIKTE, onbellek atlanarak ve gercek bir production yigininda dogrular; PLAN damgalarinin dogrulugunu denetler ve pilot icin sahibin girmesi gereken anahtarlarin (ADLARIYLA) listesini birakir.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1 (S1.3: --force ve parcali kosu); git S2; handoff S3. Pilot kapsami ve sir siniri: ust gorev tm 255 details.

NEDEN AYRI BIR GOREV: onbellek yesil bir kapiyi TEKRAR OYNATABILIR (turbo FULL TURBO replay, olculdu). Ayrica her alt gorev kendi diliminde yesildi; pilotun sorusu 'hepsi ayni anda ve gercek yapilandirmada calisiyor mu'.

KAPSAM:
1) KAPILAR: pnpm -w typecheck / lint / format:check / test / test:integration / build / test:e2e -- turbo onbellegi ATLANARAK (--force) ve ciktida '0 cached' goruldugu YAZILARAK. DIKKAT: uc kapi tek bir Bash zaman asimini asabilir; parcali kos (CONVENTIONS S1.3). test:integration icin turbo run test:integration --concurrency=1 (paralel turboda bir push testi zaman asimina dusuyor). test:e2e 137 kanit PNG'sini yeniden yazar -- kendi turunun disindakiler geri alinir, calisma agaci temiz birakilir.
2) PRODUCTION YIGINI: 255.15'in pilot compose'u yerelde ayaga kaldirilir (127.0.0.1, disa acilim YOK); dort servis healthy; smoke gecer.
3) UCTAN UCA PILOT AKISI, sahte saglayicilarla: (a) davet e-postasi sahte SMTP kutusuna duser ve baglantiyla yeni uye katilir; (b) sifre sifirlama ayni sekilde; (c) musteri widget'tan yazar, AI yanit yolu sahte LLM/embedding ile calisir ve hata durumunda insana devreder; (d) Settings gruplu navigasyon + arama ile bir bolume deep-link ile gidilir.
4) PLAN/DAMGA DENETIMI: dokunulan her PRD satirinin damgasi GERCEKTEN teslim edileni yansitiyor mu (CONVENTIONS S1.2); FR-MOD-08.1 satiri S3.7'ye EKLENMIS mi; her alt gorevin kaniti '## K. Kanit Gecmisi' altinda ilgili '#### K<kod>' blogunda mi. Kismi teslim '◐' ile yazilir; '✅' UYDURULMAZ.
5) pnpm audit:req-coverage exit 0 ve yedi denetim betigi exit 0 (audit:sweep OPEN 0 / PARTIAL 0 dahil); task-master validate-dependencies gecerli.
6) SAHIP ICIN ANAHTAR LISTESI: pilotun calismasi icin .env'ye girilmesi gereken anahtarlarin ADLARI ve nereden alinacagi (SMTP: PrivateEmail hesabi; LLM/embedding: 255.1'de secilen saglayici). DEGER YOK. Bu liste HANDOFF.md'ye ve docs/production-checklist.md'ye yazilir.
7) KALAN RISKLER acikca listelenir -- en az sunlar: e2e suitinin sira bagimliligi (bagimsiz denetim G9-GATE-a; iki tam kosuda iki FARKLI test dustu, ikisi de tek basina yesil), pilot disi birakilan maddeler (odeme, kanallar, push, S3/ClamAV/SIEM, MCP, sosyal giris, K8s).

KAPSAM DISI: gercek saglayiciya istek; gercek secret girisi; VPS/DNS/TLS; dagitim; yeni ozellik.

PRD: bu gorev yeni bir PRD satiri kapatmaz; onceki 15 gorevin satirlarini DENETLER.

TM 255.4'TEN DEVREDILEN (2026-09-23, PLAN §D179): (1) Tam e2e suiti 255.4'te KOSULMADI -- sabit portlarda pencereden once acilmis bir dev yigini vardi (anon 30/dk, zamanlayici acik, MAIL_PROVIDER=file) ve oldurulmedi; ilgili 6 spec (25 test) ozel bir SMTP yiginda yesil. 255.16 tam suiti TEMIZ bir yiginda kosmali: benimsenen (reuseExistingServer) bir make-dev API'si file postasiyla auth-mail.spec + tickets posta testini kirmizi yapar. (2) ACIK RISK, pilot oncesi karar: istek yolunda hala SMTP turunu BEKLEYEN uc nezaket postasi var -- ziyaretci mesaji -> atanana bildirim (customer.ts notifyAssignee, 716/758), sohbet kapanisi -> transcript (chat-service #emailTranscript), ticket gecisi -> musteri bildirimi (tickets.ts). Hata cagirana yansimiyor ama gecikme yansiyor: saglikli sunucuda bir SMTP turu, asili sunucuda ~33 s (3 x 10 s zaman asimi + 1 + 2 s bekleme). Oneri: app.backgroundMail'e alinmalari (ayri gorev).

NOT (tm 255.8, 2026-09-23): RETRIEVAL_THRESHOLD gercek embedding uzayinda OLCULMEDI (anahtar yoktu). Anahtar varsa bir kez: EMBEDDING_PROVIDER=openai (+ EMBEDDING_API_BASE_URL, EMBEDDING_MODEL, EMBEDDING_API_KEY) pnpm --filter @siyahtus/api measure:knowledge-recall -- exit 0 PASS, 1 FAIL, 2 SKIPPED (olculmedi, gecis DEGIL). FAIL ya da taramanin en iyi noktasi 0.25 degilse esik uzaya baglanir; bkz. PLAN D183 (5).

### 255.17. PILOT-OAUTH-REDIRECT [OPUS-HIGH] Kaydolan calisma alaninin OAuth istemcisi dagitimin panel adresini (WEB_APP_URL) kaydetmiyor: pilot alan adinda panel girisi redirect_uri reddiyle kapali

**Status:** done  
**Dependencies:** 255.15  

tm 255.15 provasinin buldugu pilot engeli: auth_signup redirect URI olarak sabit http://localhost:5173/auth/callback yaziyor, panel kendi origin'ini gonderiyor.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5. Pilot kapsami: ust gorev tm 255 details.

KANIT (tm 255.15 pilot provasi, 2026-09-25 olculdu):
* POST /auth/signup ile acilan yeni calisma alaninin OAuth istemcisi yalniz http://localhost:5173/auth/callback (+ siyahtus://auth/callback) redirect URI ile kaydediliyor: auth_signup SQL fonksiyonu bu degeri sabit yaziyor (apps/api/prisma/migrations/20260724101000_signup_creates_oauth_client, 20260802120000_brand_context, 20260815090000_region_us, 20260815200000_sandbox_license, 20260816120000_mobile_native_redirect).
* Panel ise redirect_uri olarak ${window.location.origin}/auth/callback gonderiyor (apps/web/src/lib/auth-store.ts:121).
* Sonuc (olculdu): pilot yigininda web http://localhost:15173 iken /auth/authorize 400 "redirect_uri is not registered for this client." Yani pilotun gercek alan adinda (https://panel.<alan>) kaydolan HICBIR sahip panele giris yapamaz. Prova, kayitli http://localhost:5173/auth/callback ile token alarak ilerledi.

KAPSAM: yeni calisma alaninin istemcisi dagitimin kendi panel adresini (WEB_APP_URL) kaydetmeli; mevcut calisma alanlari icin genislet-yalniz (CONVENTIONS S6.3) bir yol. Guvenlik: redirect URI kaydi istemci girdisinden ALINMAZ, yalniz sunucu yapilandirmasindan. Eski localhost girdisinin korunup korunmayacagi karar olarak yazilir.

KAPSAM DISI: SSO/sosyal giris, mobil redirect (degismez).
