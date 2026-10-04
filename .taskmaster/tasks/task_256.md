# Task ID: 256

**Title:** PILOT-GO-LIVE-GAPS [EPIC] 2026-09-30 bagimsiz kontrolde dogrulanan pilot engelleri -- 15. gun deneme kilidi + fastify XFF acigi + acik kayit + temsilci e-posta seli + proxy/ops + webhook DNS sabitleme

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Butun kapilar yesilken kodda dogrulanan ve hicbir gorevde olmayan pilot engelleri ile ilk hafta sorunlari. Her alt gorev 2026-09-30'da file:line kaniti ile acildi.

**Details:**

KAYNAK: 2026-09-30 bagimsiz hazirlik kontrolu (commit 983bf9f9). Butun kapilar --force ile YESIL olculdu: typecheck+lint+build 28/28, birim 5.464, entegrasyon api 3.582 + rtm 111, e2e 311/313 (iki kirmizi tek basina 3/3), pilot compose sifirdan smoke 16/16 + 17/17. Ama hicbir kapinin olcmedigi, gercek pilotu durduran ya da ilk haftada can yakacak bosluklar koda karsi dogrulandi; hicbiri Task Master'da yoktu. Bu epic onlari kapatir.

PILOT KAPSAMI + SIR SINIRI: tm 255 details ile AYNI (degismedi). Gercek saglayiciya istek, gercek sir, deploy YOK.

SIRA: 256.1 deneme kilidi -> 256.2 bagimlilik guvenligi -> 256.3 kayit anahtari -> 256.4 bildirim e-postasi -> 256.5 kenar/ops -> 256.6 API hijyeni -> 256.7 roster tazeligi -> 256.8 yazma takilmasi -> 256.9 webhook DNS sabitleme -> 256.10 AI yanitini istekten ayirma -> 256.11 kapanis dogrulamasi.

DAMGA KARARLARI (acilis turunda, PLAN SD193): 10.2 ◐ (256.1 geri cevirir; Faz-0 kapisi yeniden acildi), 08.8.4 ◐ ve S7 ◐ (256.9 geri cevirir; Faz-1 kapisi yeniden acildi). Diger alt gorevlerin satirlari ✅ kalir, gerekceleri SD193'te.

BU EPIC'TE OLMAYANLAR (kayitli, bilerek disarida): Copilot yardimcilarinin gercek LLM'e baglanmasi (SD180/SD181, sahip karari -- sonraki epic adayi); ulke yonlendirmesi/GeoIP (US-8 KK1); raporlarin UTC gun siniri; KB PDF/Word; widget dil sayisi; 2FA yonetici sifirlamasi (SD132); RTM /health tavani (SD137); e2e sira bagimliligi (G9-GATE-a); odeme/kanallar/push/S3/K8s/sosyal giris/MCP (sahip karari 2026-09-22).

**Test Strategy:**

Epic ancak 11 alt gorevin hepsi done olunca done olur (CONVENTIONS S4). Kapanis kaniti 256.11'den gelir: (1) CONVENTIONS S1 kapisinin tamami --force ile yesil; (2) pnpm audit --prod'da pilot yolunda (api/rtm/web/widget/packages) advisory yok; (3) pilot compose sifirdan + ilk calisma alani + OAuth ile admin /health: smoke 19/19; (4) Faz-0 ve Faz-1 kapilari yeniden KAPALI, 10.2 / 08.8.4 / S7 ✅; (5) panel tanilamasi git-unpushed disinda temiz.

## Subtasks

### 256.1. PILOT-TRIAL-WAYBACK [OPUS-XHIGH] Deneme bitince abonelik kilidi kaldirmiyor: odeme yolu lisansi aktif etsin + TRIAL_DAYS env okunsun + pilot icin operator aktivasyonu

**Status:** done  
**Dependencies:** None  

Her calisma alani kayittan 14 gun sonra salt-okunur oluyor ve urunde geri donus yolu yok. Abonelik + kart lisansi 'active' yapmali; TRIAL_DAYS env gercekten okunmali; pilot musterileri icin operatorun elle aktive etme yolu belgelenmeli.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5; gereksinim etiketi S7. Sinirlar CLAUDE.md. Pilot kapsami ve sir siniri: tm 255 details (degismedi). Bu epic'in kaynagi: 2026-09-30 bagimsiz kontrol (PLAN SD193, HANDOFF ust blok).

XHIGH GEREKCESI: (2) para dogrulugu + erisim kapisi (license-gate her yazma istegini reddediyor).

KODDA BUGUN (2026-09-30 olculdu):
- apps/api/src/services/auth/lifecycle-service.ts:30 TRIAL_DAYS = 14 sabit; :140 auth_signup'a bu sabit gidiyor.
- apps/api/src/config/env.ts:443 TRIAL_DAYS env semada var ama HICBIR yer okumuyor (grep env.TRIAL_DAYS = 0).
- apps/api/src/services/billing/metering.ts:233-259 trialState: status 'trialing' + trial_ends_at gecmis -> access 'read_only'.
- apps/api/src/plugins/license-gate.ts:39-57 read_only iken her POST/PUT/PATCH/DELETE 402 license_expired (ajan VE widget ziyaretcisi).
- licenses.status'u 'trialing'den baska bir degere ceviren KOD YOK (TS + SQL grep). subscription-service.ts:234 yalniz subscriptions.status='active' yaziyor.
- reports.ts:2105 PATCH /billing/subscription ve :2224 PUT /billing/payment-method allowWhenReadOnly; testler (reports-billing.test.ts:4791, :5333) yalniz bu iki rotanin 200 dondugunu olcuyor, sonrasinda yazmanin acildigini DEGIL.
- Mesaj metni 'subscribe to start new conversations' diyor ama abone olmak kilidi kaldirmiyor.

KAPSAM:
1) Signup, deneme uzunlugunu env.TRIAL_DAYS'ten alsin (varsayilan 14 degismez).
2) Odeme yolu: calisma alaninin HEM abonelik satiri HEM kayitli odeme yontemi varsa lisans 'active' olur (deneme icinde erken abone olan da). Tetik: PATCH /billing/subscription ve PUT /billing/payment-method sonrasi, ayni transaction'da. Denetim kaydi (billing.license_activated). Idempotent.
3) Pilot operator yolu: odeme sahte oldugu icin pilot musterisi odeme yapmaz; production-checklist S9'a sahip rolu ile tek SQL (docker compose exec db psql) + TRIAL_DAYS notu yazilir.
4) Web: aktif lisansta deneme seridi gorunmez (mevcut davranis olculur, gerekirse duzeltilir).

KAPSAM DISI: gercek odeme/Stripe, fatura kesme, past_due akisi.

PLAN: 10.2 ◐ -> ✅ (K10.2 maddesi); Faz-0 Must sayaci + Genel durum + Kapanis hucresi yeniden KAPALI (AÇIK kelimesi tarihcede YAZILMAZ -- panelin ayristiricisi).

### 256.2. PILOT-DEPS-SECURITY [OPUS-HIGH] Pilot yolundaki bilinen acikli bagimliliklar: fastify >=5.12.1 (XFF sahteleme), find-my-way, fast-uri, deepmerge-ts, xmldom, react-router-dom

**Status:** done  
**Dependencies:** None  

pnpm audit --prod 51 advisory (39 high). Pilot yolunda olanlar: fastify 5.10.0 GHSA-3m5p-2c4r-xxw2 (trustProxy hop-count altinda X-Forwarded-For sahteleme -> hiz siniri/IP ban/IP allow-list atlatilir), find-my-way, fast-uri, deepmerge-ts, xmldom (SAML), react-router-dom (acik yonlendirme). Mobil zinciri pilot disi.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5; gereksinim etiketi S7. Sinirlar CLAUDE.md. Pilot kapsami ve sir siniri: tm 255 details (degismedi). Bu epic'in kaynagi: 2026-09-30 bagimsiz kontrol (PLAN SD193, HANDOFF ust blok).

OLCUM (2026-09-30, pnpm audit --prod): api: fastify 5.10.0 (GHSA-3m5p-2c4r-xxw2, GHSA-w2qp-rph6-63g4), find-my-way 9.6.0 (GHSA-c96f-x56v-gq3h), fast-uri 3.1.4 + 4.1.1 (6 advisory), @xmldom/xmldom 0.8.14 + 0.9.11 (xml-crypto uzerinden, SAML), deepmerge-ts 7.1.5 (api + rtm). web: react-router-dom 6.30.4 (GHSA-jjmj-jmhj-qwj2), react-router 6.30.4. Kalan 30'dan fazlasi apps/mobile (expo zinciri) -- pilot disi, bu gorevde degil, HANDOFF'a liste.
- apps/api/src/server.ts:239 trustProxy: env.TRUST_PROXY_HOPS; request.ip hiz siniri (rl:anon, rl:authfail), IP ban (auth.ts:1556), ajan IP allow-list (plugins/auth.ts:367-396) ve denetim IP'sini besliyor.

KAPSAM: surum yukseltmeleri (dogrudan bagimlilik ya da pnpm overrides), kilit dosyasi guncellemesi; fastify deprecation uyarilari (disableRequestLogging) varsa ayni turda. Davranis degisikligi beklenmez; trust-proxy entegrasyon testi ve butun kapilar kanittir.

KAPSAM DISI: mobil (expo) zinciri; major surum gocleri (react-router 7) -- 6.30.x yamasi yeterliyse.

PLAN: damga degismez (hicbir KK kirilmadi, guvenlik durusu). SD kaydi + KS1-S5/KS8 maddesi.

### 256.3. PILOT-SIGNUP-SWITCH [OPUS-XHIGH] Acik kayit kapatilabilir olsun: SIGNUP_ENABLED env + 403 not_allowed/signup_closed + panelde anlasilir mesaj

**Status:** done  
**Dependencies:** None  

POST /auth/signup herkese acik, e-posta dogrulamasi yok, kapatma anahtari yok. Canli adreste yabancilar calisma alani acip sahibin OpenAI anahtarini ve posta kutusunu (calisma alani basina 200'e kadar davet) kullanabilir.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5; gereksinim etiketi S7. Sinirlar CLAUDE.md. Pilot kapsami ve sir siniri: tm 255 details (degismedi). Bu epic'in kaynagi: 2026-09-30 bagimsiz kontrol (PLAN SD193, HANDOFF ust blok).

XHIGH GEREKCESI: (1) kimlik dogrulamasiz uc noktada yeni politika.

KODDA BUGUN:
- apps/api/src/routes/account-lifecycle.ts:77 POST /auth/signup public, oturumu hemen donuyor; env anahtari yok (env.ts grep SIGNUP = 0).
- account-lifecycle.ts:395 POST /invitations istek basina 50 adres; lib/entitlements.ts:196 SEAT_CEILING = 200.
- apps/web/src/features/auth/PublicPages.tsx:154 signupFailureMessage bilinmeyen hatayi genel mesaja cevirir; :202 cagri.

KAPSAM: SIGNUP_ENABLED (true|false, varsayilan true: dev/test/demo degismez). false iken signup, VERITABANINA DOKUNMADAN 403 not_allowed + details.reason 'signup_closed' (hata taksonomisi degismez). Web kayit ekrani bu durumu kendi mesajiyla soyler (butun locale'ler, i18n kapsama testi). .env.example + .env.production.example + production-checklist S9: ilk calisma alan(lar)i acildiktan sonra SIGNUP_ENABLED=false + up -d. Davet akisi degismez.

KAPSAM DISI: e-posta dogrulamasi, davet-kodu ile kayit, CAPTCHA.

PLAN: damga degismez (00.2 KK'si kayit akisini tarif eder, o calisiyor); SD kaydi + K00.2 maddesi.

### 256.4. PILOT-NOTIFY-MAIL [OPUS-XHIGH] Temsilci e-posta seli + istek icinde beklenen postalar: sohbet basina bekleme suresi + uc postanin backgroundMail'e tasinmasi

**Status:** done  
**Dependencies:** None  

Atanmis sohbette ziyaretcinin HER mesaji temsilciye ayri e-posta (20 mesaj = 20 e-posta) ve bu posta ziyaretcinin istegi icinde bekleniyor; kapanista transcript ve ticket bildirimi de istek icinde. Posta kutusunun gonderim siniri davet/sifirlama postalarini da durdurabilir.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5; gereksinim etiketi S7. Sinirlar CLAUDE.md. Pilot kapsami ve sir siniri: tm 255 details (degismedi). Bu epic'in kaynagi: 2026-09-30 bagimsiz kontrol (PLAN SD193, HANDOFF ust blok).

XHIGH GEREKCESI: (3) teslim garantisi (kuyruk/tekrar -- yanlisi mesaj kaybeder ya da cogaltir).

KODDA BUGUN:
- apps/api/src/routes/customer.ts:412 notifyAssignee -> await mailer.send (cagri :739 ve :781, her ziyaretci mesajinda).
- apps/api/src/services/notifications/assignee-email.ts:34-45 shouldEmailAssignee yalniz opt-out'a bakar; bekleme suresi yok; tercih varsayilan acik (schema.prisma:244).
- chat-service.ts:864/:923 -> :1234 #emailTranscript istek icinde; routes/tickets.ts:335 musteri ticket-durum bildirimi istek icinde.
- plugins/background-mail.ts + services/mail/delivery.ts:105 BackgroundMail var, yalniz account-lifecycle.ts:198 (sifre sifirlama) kullaniyor.
- production-checklist S9 'Known risks' (1): asili SMTP'de ~33 s gecikme; PLAN SD179.

KAPSAM: (1) Temsilci e-postasi sohbet+temsilci basina bekleme suresiyle (Redis SET NX PX; ASSIGNEE_EMAIL_COOLDOWN_MS, varsayilan 15 dk, 0 = kapali); cihaz push'u degismez. (2) Uc posta (temsilci bildirimi, kapanis transcripti, ticket durum bildirimi) app.backgroundMail uzerinden -- yanit postayi beklemez, sonuc log'da mailFailureFields ile. (3) checklist S9 risk (1) guncellenir.

KAPSAM DISI: AI yanitinin istekten ayrilmasi (256.10).

PLAN: 13.8 ✅ kalir (KK: e-posta bildirimi var ve calisiyor); K13.8 maddesi + SD kaydi.

### 256.5. PILOT-EDGE-OPS [OPUS-HIGH] Pilotun kenari ve isletimi: hazir Caddy ornegi (tek hop), log dondurme, kaynak haritalari imajdan cikar, yedek zamanlama + sunucu disi kopya + dis izleme runbook'u

**Status:** done  
**Dependencies:** None  

Panel /api istegi iki proxy'den (host proxy + web nginx), widget bir proxy'den geciyor; TRUST_PROXY_HOPS tek sayi. Compose'da log siniri yok (disk dolar), kaynak haritalari production'da HTTP 200 ile servis ediliyor, yedek elle ve ayni diskte, dis izleme yok.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5; gereksinim etiketi S7. Sinirlar CLAUDE.md. Pilot kapsami ve sir siniri: tm 255 details (degismedi). Bu epic'in kaynagi: 2026-09-30 bagimsiz kontrol (PLAN SD193, HANDOFF ust blok).

KODDA BUGUN (2026-09-30 olculdu):
- apps/web/nginx.conf:134-141 /api/ proxy'si X-Forwarded-For'a ekliyor -> panel yolu = host proxy + web nginx = 2 hop; widget -> API_BASE_URL dogrudan = 1 hop. .env.production.example:84 TRUST_PROXY_HOPS=1.
- docker-compose.pilot.yml: logging / max-size YOK (grep 0).
- apps/web/vite.config.ts:18 ve apps/widget/vite.config.ts:29,42 sourcemap: true; pilot provasinda /assets/index-*.js.map -> HTTP 200.
- Makefile:163 pilot-backup elle; checklist S9 'Copying archives off the host is not part of this repository's scope'.

KAPSAM: (1) infra/pilot/Caddyfile.example: panel, widget, api, rtm host'lari; panelin /api/* istegi dogrudan api'ye (her yol 1 hop), RTM websocket; Caddy istemcinin gonderdigi X-Forwarded-For'u yok sayar (trusted_proxies yok). (2) Compose'da alti servise json-file log dondurme. (3) web + widget imajlari *.map tasimaz (gelistirmede harita kalir). (4) checklist S9: 'Reverse proxy' alt bolumu, gunluk yedek cron satiri + sunucu disi kopya secenekleri + restore provasi, dis calisma izleme onerisi. (5) smoke pilot profili: web kaynak haritasi servis etmiyor kontrolu.

KAPSAM DISI: TLS sertifikasi alma, DNS, gercek sunucu (sahibin).

PLAN: M-PROD-CFG / M-OPS damgalari ✅ kalir; KM-PROD-CFG maddesi + SD kaydi.

### 256.6. PILOT-API-HYGIENE [OPUS-HIGH] Bozuk JSON 500 yerine 400 + RETRIEVAL_THRESHOLD env'e + LLM 'length' bos yanitinda operator ipucu

**Status:** done  
**Dependencies:** None  

Bozuk JSON govdesi 500 internal donuyor ve error seviyesinde log uretiyor (pilotta olculdu). Bilgi tabani esigi kodda sabit (gercek embedding olcumunden sonra yeniden derleme gerekir). Reasoning model secilirse max_completion_tokens dusunmeye gidip bos 'length' yaniti doner; log bunu soylemiyor.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5; gereksinim etiketi S7. Sinirlar CLAUDE.md. Pilot kapsami ve sir siniri: tm 255 details (degismedi). Bu epic'in kaynagi: 2026-09-30 bagimsiz kontrol (PLAN SD193, HANDOFF ust blok).

KODDA BUGUN:
- apps/api/src/plugins/error-handler.ts:40-56 yalniz uc Fastify kodunu + 401/403/404'u esliyor; FST_ERR_CTP_INVALID_JSON_BODY (Fastify'da 400) 500 + error log'a dusuyor. Pilot provasi: HTTP 500 {type: internal}.
- apps/api/src/services/ai/knowledge-service.ts:95 RETRIEVAL_THRESHOLD = 0.25 sabit; :186 retrievalThreshold secenegi var, sunucu vermiyor. checklist S9: esik gercek uzayda olculmeli.
- apps/api/src/services/ai/provider/openai-llm-provider.ts:461 finish_reason 'length' -> no_answer; LLM_MAX_OUTPUT_TOKENS varsayilan 400 (env). Reasoning modellerde max_completion_tokens dusunme tokenlarini da kapsar.

KAPSAM: (1) Fastify'in 4xx content-type-parser hatalari (gecersiz JSON, bos JSON govdesi, desteklenmeyen medya tipi, govde cok buyuk) kendi 4xx'i ile validation/uygun tip olarak doner, error log degil. (2) RETRIEVAL_THRESHOLD env ([-1,1], varsayilan 0.25) -> KnowledgeService; measure:knowledge-recall ciktisi env adini soyler; checklist yeniden derleme gerektirmez diye guncellenir. (3) 'length' + bos icerikte llm.failed log'una hint alani; checklist S9'a model secimi notu (reasoning olmayan sohbet modeli ya da daha yuksek LLM_MAX_OUTPUT_TOKENS).

PLAN: damga degismez; SD kaydi + ilgili K maddeleri (KM-PROD-CFG, K06.3.2).

### 256.7. PILOT-ROSTER-FRESH [SONNET-HIGH] Komut paletinden durum degisince Team listesi eski durumu gostermesin: yazma sonrasi ['team','agents'] tazelenir

**Status:** done  
**Dependencies:** None  

Palet sohbet kabulunu durdurunca Team ekrani 30 sn'ye kadar eski 'Accepting chats'i gosterebiliyor; liste yalniz RTM push'una guveniyor. e2e command-palette.spec.ts:131 tam kosularda iki kez kirmizi (2026-09-13, 2026-09-30), tek basina yesil.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5; gereksinim etiketi S7. Sinirlar CLAUDE.md. Pilot kapsami ve sir siniri: tm 255 details (degismedi). Bu epic'in kaynagi: 2026-09-30 bagimsiz kontrol (PLAN SD193, HANDOFF ust blok).

KODDA BUGUN:
- apps/web/src/lib/auth-store.ts:516-522 setRoutingStatus PUT /agents/me/routing-status sonrasi yalniz auth store'u gunceller; sorgu onbellegine dokunmaz.
- apps/web/src/components/CommandPalette.tsx:117-136 paletin eylemi bu store fonksiyonunu kullanir.
- apps/web/src/features/inbox/useInbox.ts:1109 ve :1163 ['team','agents'] yalniz RTM olayiyla guncellenir.
- e2e 2026-09-30: 'Received: ... Accepting chats' (PUT 200 alindiktan SONRA), tek basina 3/3.

KAPSAM: basarili durum yazimindan sonra ['team','agents'] gecersizlenir (palet ve inbox yolu ayni noktadan). Test: web birim.

PLAN: damga degismez (04.3.3 / 01.1.3 KK'si calisiyor, tazelik kusuru); K04.3.3 maddesi.

### 256.8. PILOT-WRITE-STALL [OPUS-MAX] Tam e2e kosusunda 10 sn cevapsiz kalan yazma istegi: kok nedeni olc (kilit mi, havuz mu, test mi), urun kusuruysa duzelt

**Status:** done  
**Dependencies:** None  

2026-09-30 tam e2e'de POST /api/v1/skills 10 sn icinde hic cevap almadi (trace), 2026-09-15'te campaigns olusturma ayni belirtiyi verdi. Isleyici tek transaction'da tek INSERT. Canlida 'kaydet'e basinca 10 sn takilma olarak gorunur.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5; gereksinim etiketi S7. Sinirlar CLAUDE.md. Pilot kapsami ve sir siniri: tm 255 details (degismedi). Bu epic'in kaynagi: 2026-09-30 bagimsiz kontrol (PLAN SD193, HANDOFF ust blok).

OPUS-MAX GEREKCESI: kilit/transaction teshisi.

OLCULEN (2026-09-30):
- a11y.spec.ts:1005 (light) 'the skill editor ...' -> waitForResponse 10 s zaman asimi; trace: POST /api/v1/skills 00:24:42.083Z status -1; oncesi ve sonrasi istekler 25-400 ms. Tek basina 3/3.
- apps/api/src/routes/playbook.ts:441 isleyici: withTenant icinde aiAgent.findFirst + skill.create + creatorName.
- apps/api/src/lib/tenant.ts:49 TENANT_TRANSACTION_TIMEOUT_MS = 10 s; maxWait Prisma varsayilani 2 s (havuz tukenmesi 2 s'de hata verirdi, 10 s asili kalmazdi).
- siyahtus-db log'unda o dakikada hata yok; log_lock_waits = off, log_min_duration_statement = -1.
- HANDOFF/memory: 2026-09-15 campaigns.spec.ts:13 'Saving...' 10 s, satir yazilmadi.

KAPSAM: yeniden uretim (tam ya da daraltilmis e2e) sirasinda kilit bekleme kaydi + pg_stat_activity ornekleme + api istek suresi log'u; kok neden kanitla adlandirilir; urun kusuruysa duzeltme + regresyon testi; ortam/test kaynakliysa olcumle belgelenir ve gerekirse test duzeltilir. Dev DB ayari degistirildiyse geri alinir.

PLAN: damga karari olcume gore (kusur bir KK'yi bozuyorsa o satir); SD kaydi.

### 256.9. PILOT-WEBHOOK-PIN [OPUS-MAX] Webhook SSRF korumasi DNS-rebinding'e acik: cozulen ve denetlenen adres baglantiya sabitlensin

**Status:** done  
**Dependencies:** None  

assertPublicHttpUrlResolved adi cozer ve denetler, ama gonderici fetch'e adi verir ve fetch yeniden cozer (TOCTOU). Kotu niyetli bir calisma alani yoneticisi DNS'i iki cozumleme arasinda cevirerek imzali POST'u 127.0.0.1 / 169.254.169.254 / Redis'e yollatabilir. 08.8.4 ve S7 bu yuzden ◐.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5; gereksinim etiketi S7. Sinirlar CLAUDE.md. Pilot kapsami ve sir siniri: tm 255 details (degismedi). Bu epic'in kaynagi: 2026-09-30 bagimsiz kontrol (PLAN SD193, HANDOFF ust blok).

OPUS-MAX GEREKCESI: guvenlik siniri (SSRF).

KODDA BUGUN:
- apps/api/src/lib/ssrf.ts:14-17 kendi yorumu: 'A production fetcher must additionally resolve the host and re-check the resolved IP, and pin it for the connection. That belongs in the fetcher'.
- ssrf.ts:86-114 assertPublicHttpUrlResolved adresleri denetler, yalniz URL doner.
- apps/api/src/services/webhooks/webhook-dispatcher.ts:264-274 attempt() denetler; :367-393 createHttpWebhookSender fetch(url) ile ADI verir -> yeniden cozumleme.

KAPSAM: denetlenen adres baglantiya sabitlenir (Host basligi ve TLS SNI orijinal ad olarak korunur; IPv4/IPv6; birden fazla adres varsa hepsi denetlenir, sabitlenen denetlenmislerden biri); yonlendirme reddi, zaman asimi ve imza davranisi degismez; zamanlanmis yeniden teslim ayni yoldan gecer.

PLAN: 08.8.4 ◐ -> ✅ ve S7 ◐ -> ✅ (K08.8.4, KS7); Faz-1 Must sayaci + Genel durum + Kapanis hucresi yeniden KAPALI (AÇIK kelimesi tarihcede yazilmaz).

### 256.10. PILOT-AI-ASYNC [OPUS-XHIGH] Ziyaretcinin mesaj istegi AI yanitini beklemesin: yanit istekten sonra uretilsin, sira ve tekrar korumasi korunsun

**Status:** done  
**Dependencies:** 256.4  

Ziyaretci POST'u AI yanitini (embedding 10 s + model 20 s'ye kadar) bekliyor; widget bu surede gonder dugmesini kilitli tutuyor. Yanit istekten sonra uretilip mevcut gercek-zaman/yoklama yoluyla ulasmali.

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5; gereksinim etiketi S7. Sinirlar CLAUDE.md. Pilot kapsami ve sir siniri: tm 255 details (degismedi). Bu epic'in kaynagi: 2026-09-30 bagimsiz kontrol (PLAN SD193, HANDOFF ust blok).

XHIGH GEREKCESI: (3) teslim garantisi (yanit kaybolmamali, iki kez gitmemeli).

KODDA BUGUN:
- apps/api/src/routes/customer.ts:330-339 respondToCustomerMessage (kural botu, sonra AI) -- :734 ve :774'te await.
- env.ts EMBEDDING_TIMEOUT_MS 10 s, LLM_TIMEOUT_MS 20 s; devre kesici 5 hatada acilir.
- apps/widget/src/widget.ts:1173 / :1238 state.sending istek bitene kadar dugmeyi kilitler; mesaj iyimser olarak hemen gorunur; yanit refresh()/yoklama ile gelir.

KAPSAM: AI (ve kural botu) yaniti yanit gonderildikten sonra, istek yasam dongusunden bagimsiz ama sunucu kapanisinda bosaltilan bir yolla uretilir; tekrar (replay) korumasi ve 'AI kapaliyken yanit yok' davranisi korunur; hata ayni urun sonucu (insana devir). Widget yaniti mevcut yoldan alir.

KAPSAM DISI: token akisi (streaming).

PLAN: damga degismez; K07.3.2 / K06.4 maddesi + SD kaydi.

### 256.11. PILOT-GATE-VERIFY [OPUS-HIGH] Epic 256 kapanis kapisi: butun kapilar --force, tam e2e iki kez, pilot yigini sifirdan + OAuth ile admin /health (19/19), audit temiz, Faz-0/Faz-1 kapali

**Status:** done  
**Dependencies:** 256.1, 256.2, 256.3, 256.4, 256.5, 256.6, 256.7, 256.8, 256.9, 256.10  

Epic'in kapanis dogrulamasi; urun kodu degistirmez (kirmizi bulursa ilgili gorevi yeniden acar).

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md. DoD kapisi CONVENTIONS.md S1; git S2; handoff S3; kapsam disiplini S5; gereksinim etiketi S7. Sinirlar CLAUDE.md. Pilot kapsami ve sir siniri: tm 255 details (degismedi). Bu epic'in kaynagi: 2026-09-30 bagimsiz kontrol (PLAN SD193, HANDOFF ust blok).

KAPSAM: (1) CONVENTIONS S1 tamami --force, '0 cached' yazili; (2) tam e2e iki kez (PNG gurultusu geri alinir); (3) docker-compose.pilot.yml benzersiz -p ile sifirdan, sahte env repo disinda, ilk calisma alani + OAuth PKCE ile sahip token'i -> SMOKE_ORGANIZATION_ID + SMOKE_ADMIN_TOKEN ile smoke 19/19 (event_partitions ok), kaynak haritasi 404, bozuk JSON 400, down -v ayni -p; (4) pnpm audit --prod pilot yolunda temiz; (5) panel tanilamasi git-unpushed disinda temiz, Faz-0/Faz-1 open=false closed=true; (6) production-checklist S9 'Known risks' guncel; (7) HANDOFF + PLAN SD kapanis kaydi.
