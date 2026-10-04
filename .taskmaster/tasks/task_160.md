# Task ID: 160

**Title:** M-OPS — Ops dikişleri: /health/live ↔ /health/ready ayrımı · zarif drenaj (SIGTERM de readiness önce düşer) · production log profili

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Bugün tek bir /health var ve hem canlılık hem hazırlık sorusunu birlikte cevaplıyor: bağımlılıklara dokunuyor ve düştüklerinde 503 veriyor. Bir orkestratör için bu ikisi FARKLI sorulardır — Postgres kısa süre düştüğünde süreç öldürülmemeli (liveness), ama rotasyondan çıkarılmalı (readiness). Ayrıca SIGTERM bugün doğrudan app.close() çağırıyor: uçuştaki istekler ve RTM soketleri için bir drenaj penceresi yok, yani her yeniden dağıtım bir miktar isteği kesiyor.

**Details:**

BULGU KAYNAĞI: 2026-08-23 bağımsız denetimi (§D124, production hazırlığı).
ZEMİN (oku, tahmin etme): apps/api/src/index.ts SIGINT/SIGTERM i ZATEN yakalıyor ve app.close()
çağırıyor; apps/rtm/src/index.ts de aynısını yapıyor. Yani bu kalem sıfırdan bir kapanış yolu YAZMAZ,
var olanı DRENAJ SIRASIYLA değiştirir.
routes/health.ts kendi yorumunda "readiness probe" diyor ve bağımlılıklara gerçekten dokunuyor —
yani bugünkü uç aslında readiness tir; eksik olan liveness.

ÇAKIŞMA UYARISI: tm 151.2 (M-SEC-b2) anonim /health yanıtını daraltıyor. İki görev aynı dosyaya
dokunuyor. Hangisi sonra koşarsa DİĞERİNİN kararını korumalı: anonim yanıt dar kalır, ayrıntı
kimlikli admin e verilir, ve liveness/readiness ayrımı bu daraltmanın ÜSTÜNE kurulur.

FAZ-6'NIN KONUSU: CANLIDA AYAKTA KALMAK (§D124). Faz-5 ürünün DOĞRU olmasını sağladı;
Faz-6 HAZIR olmasını sağlar — konfigürasyon, ops dikişleri, ölçek ölçümü, dağıtım manifestleri, runbook.

SINIR (CLAUDE.md — pazarlık yok): production deploy / DNS / TLS sertifikası / gerçek secret YOK.
Bu fazın HER kalemi ya yerelde koşulabilir ya --dry-run / helm template ile doğrulanabilir olmak
zorundadır. M-CONTAINER emsali (tm 140): dosyalar depoda, kubectl apply YOK.

AYRICA KAPSAM DIŞI: mock sağlayıcıları gerçeğe çekmek (LLM · SMTP · S3 · Stripe · push · SIEM · AV ·
beş mesajlaşma kanalı). Kullanıcı bunu bu turda istemedi. Bir dikişi GERÇEK sağlayıcıya bağlama;
yalnız seçim dikişini hazırla. Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-OPS** (türetilmiş — NFR-R1/R2 · NFR-M5). Gereksinim satırı: `grep -n "| M-OPS" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-OPS" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

Üç alt-görev done. Ölçülebilir:
1. /health/live bağımlılıklara DOKUNMADAN 200 dönüyor; /health/ready Postgres düştüğünde 503 dönüyor.
2. SIGTERM sonrası readiness ÖNCE false oluyor, uçuştaki istek tamamlanıyor, sonra süreç kapanıyor.
3. Dockerfile + compose + smoke.sh yeni uçlara göre güncel; make demo hâlâ yeşil.
4. PLAN §7.2 M-OPS → "✅ → KM-OPS".

## Subtasks

### 160.1. M-OPS-a [SONNET-XHIGH] /health üçe ayrılır: /health/live (bağımlılıksız) · /health/ready (bağımlılıklar) · /health (kimlikli ayrıntı) + Dockerfile/compose/smoke.sh güncellenir

**Status:** done  
**Dependencies:** None  

Orkestratör canlılık ile hazırlığı ayrı sorabiliyor.

**Details:**

NE YAPILACAK: apps/api/src/routes/health.ts üç uca ayrılır.
- GET /health/live: hiçbir bağımlılığa dokunmaz, süreç ayakta ise 200 (ve uptime). Bu LIVENESS tir;
  Postgres düştüğünde 200 dönmeye DEVAM etmeli — yoksa orkestratör sağlıklı bir süreci öldürür.
- GET /health/ready: bugünkü davranış (Postgres + Redis probu, düştüğünde 503). READINESS.
- GET /health: geriye uyumlu kalır; anonim yanıt dar (tm 151.2 kararı), kimlikli admin e ayrıntı
  (dependencies · scheduler · providers · region · version).
RTM in kendi health ucu da aynı ayrımı almalı (apps/rtm) — orada da PG probu var (M-ENV-b, tm 131.3).

DOSYALAR: apps/api/src/routes/health.ts · apps/rtm içindeki health ucu ·
packages/contract/openapi/paths/health.yaml (iki yeni path — contract-parity İKİ YÖNLÜ, kontrat ve
route AYNI alt-görevde inmeli) · apps/api/Dockerfile + apps/rtm/Dockerfile HEALTHCHECK satırları ·
docker-compose.full.yml healthcheck bacakları · scripts/smoke.sh.

TUZAKLAR:
1. Dockerfile HEALTHCHECK bugün /api/v1/health e curl atıyor. Konteyner sağlığı için doğru uç
   /health/ready tir (bağımlılığı olmayan bir süreç "hazır" sayılmamalı) — değiştir ve compose
   bağımlılık zincirinin (init → api → rtm) hâlâ çalıştığını make demo ile ÖLÇ.
2. smoke.sh "api /health is ok" ve scheduler kontrolünü yapıyor; daraltılmış anonim yanıtla
   uyumlu hale getir, yoksa make demo kırılır.
3. Yeni uçlar public olmalı (probe kimlik taşımaz) ama skipRateLimit kararı tm 151.2 ile tutarlı olmalı.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-OPS** (türetilmiş — NFR-R1). Gereksinim satırı: `grep -n "| M-OPS" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-OPS" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 160.2. M-OPS-b [OPUS-XHIGH] Zarif drenaj: SIGTERM de readiness önce false → drenaj penceresi → uçuştaki istekler biter → scheduler kilidi bırakılır → DB/Redis kapanır; RTM de soketlere kapanış çerçevesi

**Status:** done  
**Dependencies:** 160.1  

Yeniden dağıtım artık istek kesmiyor.

**Details:**

NE YAPILACAK: kapanış sırası kurulur (bugün doğrudan app.close() çağrılıyor).
Sıra:
1. SIGTERM alınır → dahili "kapanıyor" bayrağı set edilir → /health/ready bundan sonra 503 döner.
   (Orkestratör bunu görüp yeni trafik göndermeyi keser.)
2. Yapılandırılabilir bir drenaj penceresi beklenir (SHUTDOWN_DRAIN_MS, varsayılan makul bir değer).
3. Uçuştaki isteklerin tamamlanması beklenir (Fastify close bunu zaten yapar).
4. Scheduler in Redis lider kilidi BIRAKILIR — yoksa bir sonraki lider kilit süresi dolana kadar bekler.
5. DB ve Redis bağlantıları kapanır.
RTM tarafında: açık soketlere düzgün bir kapanış çerçevesi gönderilir ki istemci reconnect e düşsün
(NFR-R2: otomatik reconnect + missed-event sync zaten var — bu onu TETİKLER, bozmaz).

DOSYALAR: apps/api/src/index.ts (sinyal işleyici) · apps/api/src/server.ts (kapanış kancaları) ·
apps/api/src/plugins/scheduler.ts (kilit bırakma) · apps/api/src/routes/health.ts (kapanıyor bayrağı) ·
apps/rtm/src/index.ts + gateway (soket kapanışı) · env.ts + .env.example + turbo.json (yeni anahtar).
REFERANS: scheduler in Lua ile sahip doğrulayan kilit bırakma yolu (tm 130.1 de kurulmuştu —
kilidi BIRAKAN yol zaten var mı, ÖLÇ; varsa çağır, yoksa ekle).

TUZAKLAR:
1. Testte drenaj penceresi KISA olmalı, yoksa süit yavaşlar; değer env den geldiği için test 0 verebilir.
2. İki kez SIGTERM gelirse (orkestratör sabırsız) ikinci sinyal ZORLA kapatmalı — sonsuz bekleme yok.
3. RTM soket kapanışı istemcide "hata" değil "yeniden bağlan" olarak okunmalı; e2e ve rtm integration
   süitleri (106 test) yeşil kalmalı.
4. Bu değişiklik test süitlerinin sunucu kapatma yolunu da etkiler — süitler asılı kalmamalı.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-OPS** (türetilmiş — NFR-R1/R2). Gereksinim satırı: `grep -n "| M-OPS" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-OPS" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 160.3. M-OPS-c [SONNET-XHIGH] Production log profili: pino seviyeleri + request_id korelasyonu + lib/log-redact.ts in production da zorunlu olması

**Status:** done  
**Dependencies:** 160.1  

Canlı loglar hem okunabilir hem PII sızdırmıyor.

**Details:**

NE YAPILACAK: logların production davranışı netleştirilir.
- Log seviyesi env den (LOG_LEVEL zaten turbo globalEnv de var — env.ts şemasında ve kullanımda mı, ÖLÇ).
- request_id korelasyonu: server.ts genReqId zaten x-request-id başlığını ya da UUID kullanıyor;
  her log satırının bunu taşıdığını ve yanıt başlığıyla eşleştiğini testle kilitle (NFR-M5).
- lib/log-redact.ts in maskeleme listesi production da ZORUNLU olarak devrede olmalı;
  bugün devrede mi, hangi yolla? ÖLÇ ve kilitle.
- disableRequestLogging bugün yalnız test te kapalı; production da istek loglarının hacmi
  ve içeriği (yol + durum + süre, gövde YOK) gözden geçirilir.

DOSYALAR: apps/api/src/server.ts (logger yapılandırması) · apps/api/src/lib/log-redact.ts + testi ·
apps/api/src/config/env.ts (LOG_LEVEL) · apps/rtm de aynı profil.
REFERANS: tm 155.3 (M-SEC-c3) sanitizeAuditMetadata i derinleştiriyor — log-redact ile ORTAK bir
anahtar sözlüğü doğabilir; ikisini birbirinden kaydırma (o görev de aynı uyarıyı taşıyor).

TUZAK: bu alt-görev YENİ bir gözlemlenebilirlik yığını kurmaz (o tm 163 · M-OTEL). Yalnız var olan
log yolunun production profilini netleştirir. Kapsam dışına çıkma.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-OPS** (türetilmiş — NFR-M5 · NFR-S9). Gereksinim satırı: `grep -n "| M-OPS" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-OPS" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
