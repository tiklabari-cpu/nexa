# Task ID: 131

**Title:** M-ENV — Ortam değişkeni bütünlüğü (env.ts ↔ .env.example ↔ turbo globalEnv) + sağlayıcı seçim dikişleri (MAIL/PUSH/STRIPE/STORAGE/SIEM) + RTM /health Postgres probu — §D113/K2-K3

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** 2026-08-17 denetimi: kod 13 env anahtarını okuyor ama `.env.example`’da yok (INBOUND_EMAIL_SECRET dahil — unset iken inbound-mail webhook’u tasarım gereği açık); 19 anahtar `turbo.json` globalEnv’de yok (ikisi secret: UPLOAD_SIGNING_KEY, AUDIT_CHAIN_SECRET — yerelde `load-env-file.ts` maskeler, CI’da gerçek risk); `MAIL_PROVIDER`/`STRIPE_PROVIDER`/`STORAGE_PROVIDER` zod ile doğrulanıp HİÇ okunmuyor (seçim NODE_ENV’e sabit); Stripe’ın arayüzü yok, Storage somut sınıf, SIEM sink dosyaya gömülü; RTM /health Postgres’i yoklamıyor (agent login DB’ye bağlı).

**Details:**

BULGU (§D113/K2-K3, koda karşı):
- Okunan ama `.env.example`'da olmayan (13): API_HOST · RTM_HOST · WEB_ORIGIN · WIDGET_BASE_URL ·
  INBOUND_EMAIL_DOMAIN · INBOUND_EMAIL_SECRET · RATE_LIMIT_PUBKB_PER_MIN (env.ts:94) ·
  RATE_LIMIT_SCIM_PER_MIN (env.ts:104) · SIEM_EXPORT_HORIZON_MS (env.ts:137) · VIRUS_SCANNER (env.ts:182) ·
  LOG_LEVEL; LLM_PROVIDER_REGION ve OTEL_ENABLED yalnız yorum satırı.
- Okunan ama `turbo.json` globalEnv'de olmayan (19): UPLOAD_SIGNING_KEY · AUDIT_CHAIN_SECRET · WEB_APP_URL ·
  WIDGET_BASE_URL · MAIL_DIR · PUSH_DIR · SIEM_DIR · SIEM_EXPORT_HORIZON_MS · INBOUND_EMAIL_DOMAIN ·
  INBOUND_EMAIL_SECRET · RATE_LIMIT_PUBKB_PER_MIN · RATE_LIMIT_SCIM_PER_MIN · RETENTION_{THREAD,VISIT,
  MAIL,AUDIT}_DAYS · API_CALLS_INCLUDED · API_CALL_OVERAGE_CENTS · STORAGE_LOCAL_DIR · UPLOAD_URL_TTL ·
  VIRUS_SCANNER · OTEL_ENABLED. Turbo 2 strict env: task ortamından düşer; yerelde
  `apps/api/src/config/load-env-file.ts:39,48` kök `.env`'i doğrudan okuduğu için görünmez.
- `env.ts:170,171,176` MAIL_PROVIDER/STORAGE_PROVIDER/STRIPE_PROVIDER doğrulanır, TÜKETİLMEZ; seçim
  `server.ts:100-101` NODE_ENV'e göre (`FileMailer`/`NullMailer`, `FilePushProvider`/`NullPushProvider`).
  Yalnız `VIRUS_SCANNER` (`createVirusScanner()`) ve `LLM_PROVIDER` fiilen dal seçer.
- Stripe: arayüz yok, dikiş yok (mock davranış `services/billing/*` içinde). Storage: `LocalStore`
  somut sınıf, üç çağrı yerinde `new LocalStore(env.STORAGE_LOCAL_DIR)` (`uploads.ts:63`, `chats.ts:93`,
  `customer.ts:191`). SIEM: `siem-sink.ts:97` dosya yazımı sınıfın içinde.
- RTM `server.ts:171` `health()` yalnız Redis; `auth.ts:205-226` her agent login'inde Postgres.
Bu görev GERÇEK sağlayıcı YAZMAZ (CLAUDE.md: dış servis yok/mock) — yalnız arayüz + seçim dikişi,
ki "hazır" ürün bir gün gerçek sağlayıcıyı bir env değişkeni + bir sınıfla alsın.

FAZ-4'ÜN KONUSU KALEM DEĞİL DİKİŞTİR (§D113): Faz 0–3 kalemleri tek tek ✅ ama bütün, bir kullanıcının
gözünden bir yerde kopuyor. Bu görev o kopukluğu kapatır; kapatırken YENİ bir kalem/özellik AÇMAZ,
mevcut sözleşme + servis + ekranı birbirine bağlar. Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-ENV / M-PROV (türetilmiş — NFR-M bakım kolaylığı · MASTER-PROMPT "dış servisler mock, arayüz + sahte sağlayıcı")**. Gereksinim satırı: `grep -n '| M-ENV' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-ENV' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.
PLAN §7.2 tablosunda `M-ENV` satırı `⬜ → KM-ENV` olarak açıldı; alt-görevler bittikçe K bloğuna madde, hepsi bitince `✅ → KM-ENV` (131.3 yapar).
KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

Üç alt-görev `done` olunca; üst görev ayrıca: `pnpm -w test` · `test:integration` · `typecheck` · `lint` · `build` exit 0; env parite nöbetçi testi yeşil; provider seçimi env ile değişiyor (test); RTM health PG probu; PLAN §7.2 `M-ENV` `✅ → KM-ENV`.

## Subtasks

### 131.1. M-ENV-a [SONNET-XHIGH] Ortam değişkeni paritesi: env.ts ↔ .env.example ↔ turbo.json globalEnv — 13 + 19 eksik anahtar tamamlanır + nöbetçi test

**Status:** done  
**Dependencies:** None  

Üç kaynak arasında env anahtarı paritesi kurulur ve bir testle korunur.

**Details:**

NE YAPILACAK: (a) `.env.example`'a 13 eksik anahtar (yorumlu, varsayılan değerleriyle; INBOUND_EMAIL_SECRET
için "unset = inbound webhook açık — üretimde ZORUNLU" uyarısı); OTEL_ENABLED / LLM_PROVIDER_REGION
yorumlu kalabilir ama nöbetçi test yorumlu satırı da "belgelenmiş" sayar (regex `^#?\s*KEY=`);
(b) `turbo.json` globalEnv'e 19 eksik anahtar; (c) nöbetçi: `apps/api/src/config/env.parity.test.ts`
— `env.ts` ve `apps/rtm/src/config/env.ts`'in zod şemasından anahtar listesini çıkarır (şema
nesnesinin `shape`'i), `.env.example`'ı ve `turbo.json`'ı okur (`node:fs`, test dosyası), her okunan
anahtar iki dosyada da var mı → yoksa hangi anahtar eksik listeleyerek düşer; ters yön: `.env.example`'da
olup hiçbir env.ts'te olmayan anahtar (WEB_PORT/WIDGET_PORT vite tarafı — beyaz liste) → düşer.
NEDEN: §D113/K2. Secret'ların turbo'dan düşmesi CI'da gerçek risk.
DOSYALAR: `.env.example` · `turbo.json` · `apps/api/src/config/env.parity.test.ts` (yeni) ·
`apps/api/src/config/env.ts` (yalnız export gerekiyorsa: şema nesnesini dışa aç).
REFERANS: `env.ts:207` tek `process.env` erişimi · `apps/mobile/src/theme/tokens.test.ts` (bir kaynak
dosyayı ayrıştırıp karşılaştıran nöbetçi deseni).
KK: test yeşil; kasıtlı bir anahtar silinince kırmızı (bunu testin kendi negatif senaryosuyla kanıtla).
KAPSAM DIŞI: anahtarların değerlerini/semantiğini değiştirmek · sağlayıcı seçimi (131.2).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-ENV / M-PROV (türetilmiş — NFR-M bakım kolaylığı · MASTER-PROMPT "dış servisler mock, arayüz + sahte sağlayıcı")**. Gereksinim satırı: `grep -n '| M-ENV' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-ENV' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 131.2. M-PROV-a [OPUS-XHIGH] Sağlayıcı seçim dikişleri: MAIL/PUSH/STRIPE/STORAGE/SIEM_PROVIDER fiilen seçer (NODE_ENV değil); Stripe PaymentProvider + ObjectStore + SiemTarget arayüzleri (mock impl = mevcut davranış; gerçek impl YAZILMAZ)

**Status:** done  
**Dependencies:** 131.1  

Doğrulanıp okunmayan *_PROVIDER anahtarları gerçekten seçici olur; eksik arayüzler açılır.

**Details:**

NE YAPILACAK: (a) `services/providers.ts` (ya da her servisin kendi `create*()` fabrikası —
`virus-scanner.ts:58 createVirusScanner()` deseni): `createMailer(env)` → `MAIL_PROVIDER=file|null`
(mock adı 'file' — mevcut `FileMailer`; test'te 'null'), `createPushProvider(env)` → `PUSH_PROVIDER=file|null`
(YENİ anahtar; env.ts + .env.example + turbo), `createObjectStore(env)` → `STORAGE_PROVIDER=local`
(arayüz `ObjectStore`: put/get/signedUrl/delete — `LocalStore` onu uygular; üç `new LocalStore`
çağrı yeri fabrikaya döner), `createPaymentProvider(env)` → `STRIPE_PROVIDER=mock` (YENİ arayüz
`PaymentProvider`: mevcut mock davranış — `payment-method-service.ts` + faturalama çağrıları —
arayüzün arkasına alınır; davranış BİREBİR aynı, testler değişmeden yeşil), `createSiemTarget(env)`
→ `SIEM_PROVIDER=file` (arayüz `SiemTarget.deliver(batch)`; `SiemSink` dosya yazımını `FileSiemTarget`'a
devreder). (b) `server.ts:100-101` NODE_ENV dalı KALKAR; test ortamı `.env`/with-test-datastores
üzerinden `null` sağlayıcıları alır — integration süitleri mail/push dosyası bekliyorsa (`MAIL_DIR`
okuyan testler var) onlar 'file' ister: test env'de varsayılanı testlerin bugünkü beklentisine göre
seç ve GEREKÇESİYLE yaz. (c) Bilinmeyen değer → boot'ta açık hata (zod enum).
NEDEN: §D113/K3 — anahtarlar sahte seçici; gerçek sağlayıcı bir gün eklenecekse dikiş şimdi kurulmalı
(MASTER-PROMPT: "arayüz + sahte sağlayıcı").
DOSYALAR: `services/mail/mailer.ts` · `services/push/push-provider.ts` · `services/storage/
{object-store.ts(yeni), local-store.ts}` · `services/billing/{payment-provider.ts(yeni), *}` ·
`services/audit/siem-sink.ts` (+`siem-target.ts`) · `server.ts` · `routes/{uploads,chats,customer}.ts` ·
`config/env.ts` · `.env.example` · `turbo.json` · testler.
REFERANS: `services/upload/virus-scanner.ts:29-60` (arayüz + iki impl + env fabrikası — bu deseni
kopyala) · `services/channels/registry.ts` (exhaustive Record).
KK: her fabrika env ile impl seçer (unit); yanlış değer boot hatası; mevcut integration süitleri
DEĞİŞMEDEN yeşil (davranış birebir); `grep -rn "NODE_ENV" apps/api/src/server.ts` provider seçimi
için 0.
KAPSAM DIŞI: gerçek Stripe/S3/SMTP/APNs/Splunk impl'i (CLAUDE.md sınırı — mock kalır) · UI.
TUZAK: `PaymentProvider` arayüzünü mevcut mock'un TÜM çağrı yüzeyinden çıkar (yeni davranış icat
etme); OPUS çünkü ödeme/sır dokunuşu ve çok dosyalı dikiş.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-ENV / M-PROV (türetilmiş — NFR-M bakım kolaylığı · MASTER-PROMPT "dış servisler mock, arayüz + sahte sağlayıcı")**. Gereksinim satırı: `grep -n '| M-ENV' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-ENV' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 131.3. M-ENV-b [SONNET-XHIGH] RTM /health Postgres probu (agent login DB’ye bağlı) + api /health’e mock-sağlayıcı özeti + PLAN satırı ✅

**Status:** done  
**Dependencies:** 131.1, 131.2  

RTM sağlık ucu Postgres’i de yoklar; api health hangi sağlayıcıların mock olduğunu söyler.

**Details:**

NE YAPILACAK: (a) `apps/rtm/src/server.ts:171 health()`: Redis PING'e ek Postgres `SELECT 1` (2 s
timeout, api `routes/health.ts:18` deseni; hata sınıfı sızdırılır mesaj değil) → ikisinden biri
düşükse 503 `degraded`; (b) api `/api/v1/health` gövdesine `providers: {mail:'file', push:'file',
storage:'local', payment:'mock', siem:'file', llm:'mock', virus_scanner:'mock'}` (131.2'nin fabrikaları
adlarını verir) — sözleşme `paths/health.yaml` katkısal + generated; (c) PLAN §7.2 `M-ENV` satırı
`✅ → KM-ENV`; K bloğuna özet.
NEDEN: §D113/K3 — RTM ölü DB ile 'ok' derken her agent login'i reddediyor; işletmeci hangi
sağlayıcının mock olduğunu health'ten okuyabilmeli ("hazır" ürünün dürüstlüğü).
DOSYALAR: `apps/rtm/src/server.ts` (+`test/integration/health.test.ts`) · `apps/api/src/routes/
health.ts` (+test) · `packages/contract/openapi/paths/health.yaml` (+generated) · PLAN.md.
KK: rtm health PG down → 503 (test: bağlantı dizesi bozuk client enjekte); api health providers alanı;
contract-parity yeşil.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-ENV / M-PROV (türetilmiş — NFR-M bakım kolaylığı · MASTER-PROMPT "dış servisler mock, arayüz + sahte sağlayıcı")**. Gereksinim satırı: `grep -n '| M-ENV' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-ENV' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
