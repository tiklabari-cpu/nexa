# Task ID: 130

**Title:** M-SCHED — Arka plan işleri zamanlayıcısı: idle auto-close · SLA saati · retention · SIEM teslimi · zamanlanmış raporlar `make dev`/çalışan sunucuda KENDİLİĞİNDEN koşar (bugün yalnız elle script) — §D113/K1

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** 2026-08-17 denetimi: beş doğruluk-kritik sweep (chat-timeout:run · sla:run · retention:run · siem:run · scheduled-reports:run) yalnız `apps/api/package.json` script’leri olarak var; `apps/api/src/index.ts` hiçbirini başlatmıyor, tek in-process zamanlayıcı partition bakımı (`plugins/database.ts:57`). `make dev` ile ayağa kalkan üründe boşta sohbet KAPANMAZ, SLA ihlali İŞARETLENMEZ, SIEM dosyası YAZILMAZ, zamanlanmış rapor GİTMEZ, retention SİLMEZ — ilgili kalemler ✅ damgalı. Bu görev in-process zamanlayıcı çekirdeği + beş işin kaydı + webhook yeniden teslimi + belgeleri getirir.

**Details:**

BULGU (§D113/K1, koda karşı): `apps/api/package.json:24-28` beş script (`retention:run` →
`services/retention/run.ts` · `chat-timeout:run` → `services/chat/chat-timeout-run.ts` ·
`scheduled-reports:run` → `services/reports/scheduled-reports-run.ts` · `siem:run` →
`services/audit/siem-run.ts` · `sla:run` → `services/sla/sla-run.ts`); her runner dosyası
"zamanlayıcı yok, host cron ister" notu taşıyor (`siem-run.ts:3-8` · `chat-timeout.ts:9-11` ·
`sla-sweep.ts:11-13`). `apps/api/src/index.ts` yalnız `buildServer` + `listen`. Webhook yeniden
denemesi istek içi (`services/webhooks/webhook-dispatcher.ts:117-135`, sunucu yeniden başlarsa kalan
denemeler kaybolur; `webhook_deliveries` tablosu her denemeyi logluyor — kalıcı yeniden teslim için
kaynak orada). Trial bitişi tembel hesaplanır (`subscription-service.ts:269`) — sweep GEREKMEZ.
"Faz-3 kapanış turu (tm 126) §F.1/9 temiz kurulum provasını e2e ile yürüttü" ama e2e bu sweep'leri
hiç tetiklemez — bu yüzden fark edilmedi.

TASARIM KARARLARI (alt-görevlere bağlayıcı):
- In-process zamanlayıcı, API sürecinin içinde (`apps/api/src/services/scheduler/`), ayrı worker
  süreci AÇILMAZ (`make dev`'in tek komut sözü + tek deploy birimi; ADR-11 Kafka/RabbitMQ yok).
  Birden çok API instance'ı için Redis lider kilidi (`SET NX PX` + sahiplik token'ı ile serbest
  bırakma) — kilit iş BAŞINA (her job kendi anahtarı), aralık başına.
- Env kapıları: `SCHEDULER_ENABLED` (varsayılan: `NODE_ENV=test` → false, aksi true), iş başına
  aralık `SCHEDULE_<JOB>_MS` (varsayılanlar: chat_timeout 60 s · sla 60 s · siem 300 s ·
  scheduled_reports 60 s · retention 3600 s · webhook_redelivery 60 s), `SCHEDULE_JITTER_PCT` (10).
- Retention ve scheduled-reports runner'ları bugün `dry-run` VARSAYILANLI — zamanlayıcıdan çağrılırken
  `dryRun: false` GEÇİRİLİR ama retention için ek güvenlik: `RETENTION_ENABLED` (varsayılan false;
  README'de açıkça — sessiz veri silme kabul edilmez). SIEM ve chat-timeout gerçek koşar (bugün de öyle).
- Her koşu: OTel span (`scheduler.<job>`) + yapısal log (job, duration, outcome, error class) +
  `/api/v1/health` gövdesinde `scheduler: {enabled, jobs: [{name, interval_ms, last_run_at,
  last_status, last_error_class?}]}` (mesaj değil sınıf — health.ts'nin mevcut sızıntı disiplini).
- Hata izolasyonu: bir job fırlatırsa diğerleri sürer; art arda N hata → log seviyesi warn→error,
  ASLA süreç düşmez. Zamanlayıcı `unref()` edilmez (sunucu ayakta kaldıkça çalışır) ama
  `app.close()` temiz durdurur (test için).
- CLI script'leri KALIR ve aynı runner fonksiyonunu çağırır (host cron isteyen dağıtımlar için).

ALT-GÖREVLER: 130.1 çekirdek (BÖLÜNMEZ · OPUS-MAX — kilit + eşzamanlılık) → 130.2 beş işin kaydı +
boot + health (SONNET) → 130.3 uçtan uca doğrulama (OPUS-XHIGH) → 130.4 docs/env (SONNET) →
130.5 webhook yeniden teslimi (OPUS-XHIGH, ayrı çünkü ödeme/gönderim semantiği: aynı olayı iki kez
gönderme riski).
KAPSAM DIŞI: dış zamanlayıcı (cron/k8s CronJob) belgeleme dışında · Kafka/RabbitMQ · trial sweep · UI.

FAZ-4'ÜN KONUSU KALEM DEĞİL DİKİŞTİR (§D113): Faz 0–3 kalemleri tek tek ✅ ama bütün, bir kullanıcının
gözünden bir yerde kopuyor. Bu görev o kopukluğu kapatır; kapatırken YENİ bir kalem/özellik AÇMAZ,
mevcut sözleşme + servis + ekranı birbirine bağlar. Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-SCHED (türetilmiş — FR-MOD-08.7.3 idle auto-close · 11.5-d SLA · NFR-C8 retention · C6-d SIEM · 07.9 scheduled reports)**. Gereksinim satırı: `grep -n '| M-SCHED' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-SCHED' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.
PLAN §7.2 tablosunda `M-SCHED` satırı bu turda `⬜ → KM-SCHED` olarak açıldı; alt-görevler bittikçe K bloğuna madde, hepsi bitince satır `✅ → KM-SCHED` (130.4 yapar).
KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

Beş alt-görevin beşi `done` olduğunda bitmiştir; üst görev ayrıca (hepsi exit 0):
- `pnpm -w test` · `pnpm -w test:integration` (yeni scheduler süitleri dahil) · `typecheck` · `lint` · `build`.
- ÖLÇÜLEBİLİR: `make dev` (ya da `pnpm --filter @siyahtus/api dev`) sonrası `curl :4000/api/v1/health` gövdesinde
  `scheduler.enabled=true` ve 5(+1) job satırı; test ortamında (`NODE_ENV=test`) `enabled=false` ve integration
  süiti sürelerinde artış yok (± %5).
- 130.3'ün kısa-aralıklı entegrasyon testi: boşta sohbet kapanır · SLA ihlali işaretlenir · SIEM dosyası yazılır ·
  zamanlanmış rapor gönderilir · iki scheduler tek koşu.
- PLAN §7.2 `M-SCHED` satırı `✅ → KM-SCHED`; K bloğunda 5 madde; README "Background jobs".

## Subtasks

### 130.1. M-SCHED-a [OPUS-MAX] Zamanlayıcı çekirdeği (BÖLÜNMEZ): iş kayıt defteri + aralık/jitter + Redis lider kilidi (SET NX PX) + hata izolasyonu + gözlemlenebilirlik + env kapıları

**Status:** done  
**Dependencies:** None  

In-process zamanlayıcı çekirdeği: kayıt defteri, aralık+jitter, Redis lider kilidi, hata izolasyonu, health özeti.

**Details:**

NE YAPILACAK: `apps/api/src/services/scheduler/scheduler.ts` — `Scheduler` sınıfı: `register({name,
intervalMs, run(ctx): Promise<JobOutcome>})`, `start()`/`stop()`, iş başına zamanlayıcı (ilk koşu
jitter'lı gecikmeyle — tüm instance'lar aynı anda başlamasın), koşu başına Redis kilidi
`siyahtus:sched:<job>` (`SET key <ownerToken> NX PX <intervalMs*0.9>`; serbest bırakma yalnız sahip
token'ıyla — Lua `if redis.call('get',k)==tok then del`), kilit alınamazsa "skipped: not leader"
(log debug), fırlatan job → `last_status='error'` + `last_error_class`, diğer job'lar etkilenmez;
`snapshot()` → health için özet. Env: `SCHEDULER_ENABLED`, `SCHEDULE_<JOB>_MS`, `SCHEDULE_JITTER_PCT`
(`config/env.ts`'e zod ile; `.env.example` + `turbo.json` globalEnv AYNI alt-görevde — tm 131.1'in
nöbetçisi henüz yoksa da parite şimdiden korunur). OTel: `lib/otel` mevcut yardımcıyla span
(`scheduler.<job>`, attr: outcome, duration_ms). Job'lar bu alt-görevde KAYDEDİLMEZ (130.2).
NEDEN: §D113/K1 — hiçbir sweep kendiliğinden koşmuyor; çoklu instance'ta çift koşu riski olduğu için
kilit çekirdeğin parçası ve bölünmez (§5.1.2 güvenlik/eşzamanlılık çekirdeği).
DOSYALAR: `services/scheduler/{scheduler.ts, scheduler.test.ts, lock.ts, lock.test.ts, types.ts}` ·
`config/env.ts` · `.env.example` · `turbo.json` · `test/integration/scheduler-lock.test.ts`.
REFERANS DESEN: `plugins/database.ts:47-57` (tek mevcut in-process interval + hata yutma) · Redis
istemcisi `plugins/redis.ts` (adı doğrula) · rate-limit'in Redis atomik deseni (`lib/rate-limit*`) ·
`lib/otel` span yardımcıları (M5).
KK: unit (fake timers): kayıt/başlat/durdur · aralık+jitter sınırları · fırlatan job diğerini
durdurmaz · snapshot doğru; integration (gerçek Redis): iki `Scheduler` aynı job → bir koşu; kilit
süresi dolunca diğeri alır; sahip olmayan serbest bırakamaz.
KAPSAM DIŞI: iş kaydı (130.2) · health route (130.2) · cron ifadeleri (aralık yeter).
TUZAKLAR: `unref` ETME (sunucu yaşadıkça çalışır) ama `stop()` her zamanlayıcıyı temizler yoksa
integration testleri kapanmaz; `NODE_ENV=test`'te varsayılan kapalı — with-test-datastores altında
sessizce açılırsa 90 dosyalık süit yavaşlar/kirlenir.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-SCHED (türetilmiş — FR-MOD-08.7.3 idle auto-close · 11.5-d SLA · NFR-C8 retention · C6-d SIEM · 07.9 scheduled reports)**. Gereksinim satırı: `grep -n '| M-SCHED' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-SCHED' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 130.2. M-SCHED-b [SONNET-XHIGH] Beş sweep’in zamanlayıcıya kaydı (chat-timeout · sla · retention · siem · scheduled-reports) — CLI script’leri aynı runner’ı çağırır; sunucu boot’ta başlar; /health "scheduler" alanı

**Status:** done  
**Dependencies:** 130.1  

Beş mevcut runner zamanlayıcıya kaydedilir; server boot başlatır; health özeti; CLI aynı fonksiyonu çağırır.

**Details:**

NE YAPILACAK: Her runner'ın "bir tur koş" fonksiyonunu CLI giriş noktasından ayır (çoğunda zaten
ayrı: `chat-timeout.ts` sweep fonksiyonu vs `chat-timeout-run.ts` CLI — dosya adlarını oku, yoksa
çıkar) ve `services/scheduler/jobs.ts`'te kaydet: `chat_timeout` (60 s) · `sla` (60 s) · `siem`
(300 s) · `scheduled_reports` (60 s) · `retention` (3600 s, `RETENTION_ENABLED` false ise job
"disabled" olarak snapshot'ta görünür ama koşmaz). `server.ts`/`index.ts`: `SCHEDULER_ENABLED`
true ise `buildServer` sonrası `scheduler.start()`, `onClose` → `stop()`. `routes/health.ts`:
gövdeye `scheduler` alanı (130.1 `snapshot()`); sözleşme `paths/health.yaml` şeması genişletilir
(katkısal) → `pnpm -w contract:generate` → generated diff commit. CLI script'leri (5) DEĞİŞMEZ
davranışla aynı fonksiyonu çağırmaya devam eder (dry-run varsayılanları CLI'da korunur).
NEDEN: §D113/K1. `make dev` ile ayağa kalkan ürün bu beş işi hiç yapmıyor.
DOSYALAR: `services/scheduler/jobs.ts` (+test) · `server.ts`/`index.ts` · `routes/health.ts` (+test) ·
`packages/contract/openapi/paths/health.yaml` (+generated) · `services/{chat,sla,audit,reports,
retention}/*-run.ts` (yalnız fonksiyon ayrımı gerekiyorsa).
REFERANS DESEN: 130.1'in `register` API'si · `routes/health.ts:48-55` mevcut degraded mantığı ·
`test/integration/contract-parity.test.ts` (health şeması değişince yeşil kalmalı).
KK: `NODE_ENV=development`'ta health gövdesinde 5 job (+ retention disabled) · test ortamında
`enabled:false` · CLI'lar hâlâ çalışır (`pnpm --filter @siyahtus/api chat-timeout:run` exit 0).
KAPSAM DIŞI: webhook redelivery (130.5) · yeni sweep yazmak.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-SCHED (türetilmiş — FR-MOD-08.7.3 idle auto-close · 11.5-d SLA · NFR-C8 retention · C6-d SIEM · 07.9 scheduled reports)**. Gereksinim satırı: `grep -n '| M-SCHED' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-SCHED' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 130.3. M-SCHED-c [OPUS-XHIGH] Uçtan uca doğrulama: kısa aralıklı entegrasyon testi — boşta sohbet kapanır · SLA ihlali işaretlenir · SIEM dosyası yazılır · rapor gönderilir; iki instance tek koşu (kilit)

**Status:** done  
**Dependencies:** 130.1, 130.2  

Zamanlayıcı açıkken beş işin gerçekten koştuğunu tek entegrasyon süitiyle kanıtlar.

**Details:**

NE YAPILACAK: `apps/api/test/integration/scheduler-e2e.test.ts`: `SCHEDULER_ENABLED=true` +
`SCHEDULE_*_MS=200` ile bir server kur (with-test-datastores izole DB/Redis'te), tohumla: boşta
sohbet (chat_timeout ayarı 1 s) → kapanır; SLA hedefi 1 s + ilk yanıtsız sohbet → ihlal işareti;
audit olayı → SIEM dosyası `SIEM_DIR` altında; zamanlanmış rapor (07.9) → `MAIL_DIR`'de dosya;
retention `RETENTION_ENABLED=false` → snapshot "disabled" ve hiçbir satır silinmez; ikinci server
instance'ı aynı Redis → her iş tek koşu (koşu sayacı). Testler `waitFor`-benzeri polling ile
(sabit sleep DEĞİL). Ayrıca §F.1/9 provasına eklenmek üzere: `make dev` sonrası health'te job'lar
(elle, HANDOFF'a çıktı yapıştır).
NEDEN: sweep'lerin her biri kendi süitinde test edilmişti; "kendiliğinden koşar" iddiası hiç
ölçülmemişti (§D113/K1).
DOSYALAR: `test/integration/scheduler-e2e.test.ts` (yeni) · gerekirse test yardımcıları.
REFERANS: `test/integration/push-lifecycle.test.ts` (durumların birleşmesini tek testte kanıtlama
gerekçesi) · `with-test-datastores.ts` · ilgili sweep süitleri (`chat-timeout`, `sla`, `siem`,
`scheduled-reports`).
KAPSAM DIŞI: e2e Playwright (sweep'ler UI'sız) · süre ölçümü/perf.
TUZAK: aralıklar çok kısa olursa kilit TTL'i (`interval*0.9`) 180 ms olur — Redis gidiş-dönüşü
buna sığmalı; gerekirse test için minimum TTL sabiti.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-SCHED (türetilmiş — FR-MOD-08.7.3 idle auto-close · 11.5-d SLA · NFR-C8 retention · C6-d SIEM · 07.9 scheduled reports)**. Gereksinim satırı: `grep -n '| M-SCHED' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-SCHED' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 130.4. M-SCHED-d [SONNET-XHIGH] Docs + env: .env.example zamanlayıcı anahtarları · README "Background jobs" · RETENTION_ENABLED uyarısı · PLAN satırı ✅

**Status:** done  
**Dependencies:** 130.2, 130.3  

Zamanlayıcının belgeleri ve env örnekleri; M-SCHED satırı kapanır.

**Details:**

NE YAPILACAK: `.env.example`'a `SCHEDULER_ENABLED`, `SCHEDULE_*_MS`, `SCHEDULE_JITTER_PCT`,
`RETENTION_ENABLED` (yorumlu, varsayılanlarla) — 130.1/130.2 eklediyse doğrula, eksik olanı tamamla;
kök `README.md`'ye "Background jobs" bölümü (hangi iş, hangi aralık, nasıl kapatılır, host cron
alternatifi = CLI script'leri, retention'ın kapalı varsayılanı ve NEDEN); `apps/api` runner
dosyalarındaki "zamanlayıcı yok" notları güncellenir (silinmez — "artık scheduler'dan da çağrılır");
PLAN §7.2 `M-SCHED` satırı `✅ → KM-SCHED`; K bloğuna özet madde.
NEDEN: §D113/K1 + §F.1/8 doküman tazeliği.
DOSYALAR: `.env.example` · `README.md` · 5 runner dosyası başlığı · PLAN.md · HANDOFF.md.
KK: README bölümü var; `.env.example`'daki her scheduler anahtarı `env.ts`'te okunuyor (tm 131.1'in
nöbetçisi varsa yeşil).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-SCHED (türetilmiş — FR-MOD-08.7.3 idle auto-close · 11.5-d SLA · NFR-C8 retention · C6-d SIEM · 07.9 scheduled reports)**. Gereksinim satırı: `grep -n '| M-SCHED' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-SCHED' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 130.5. M-SCHED-e [OPUS-XHIGH] Webhook yeniden teslimi kalıcı: başarısız `webhook_deliveries` satırları zamanlayıcıyla yeniden denenir (üst sınır + backoff + audit; aynı olay iki kez GİTMEZ)

**Status:** done  
**Dependencies:** 130.1, 130.2  

İstek içinde biten webhook denemeleri sunucu yeniden başlasa da kalıcı yeniden teslimle tamamlanır.

**Details:**

NE YAPILACAK: `webhook_redelivery` job'u (60 s): son denemesi başarısız ve `attempts < MAX`
(env `WEBHOOK_MAX_ATTEMPTS`, varsayılan 8) ve `next_attempt_at <= now` olan `webhook_deliveries`
satırlarını lisans bazında (`withTenant`) alır, aynı `WebhookDispatcher.attempt` ile dener, sonucu
loglar, backoff `next_attempt_at` yazar; başarılı olan satır `delivered`; tükenen `exhausted` +
audit `webhook.delivery_exhausted`. ŞEMA: `webhook_deliveries`'e `next_attempt_at`/`state` kolonu
gerekiyorsa migration (katkısal, RLS korunur, `db:check-drift` temiz). İstek-içi ilk deneme
davranışı KORUNUR (hızlı yol); yalnız istek-içi denemeler tükenince satır zamanlayıcıya kalır.
İdempotency: aynı olayın aynı webhook'a ikinci başarılı teslimi OLMAZ (`state` kontrolü + kilit).
NEDEN: `webhook-dispatcher.ts:117-135` istek içi retry; süreç ölürse teslim kaybolur; NFR-S7/08.8.4
"retry" iddiası kalıcı değil (§D113/K1).
DOSYALAR: `services/webhooks/{webhook-dispatcher.ts, redelivery.ts(+test)}` · `services/scheduler/
jobs.ts` · `prisma/migrations/<ts>_webhook_redelivery` (gerekirse) · `schema.prisma` · `@siyahtus/types`
audit action · `test/integration/webhook-redelivery.test.ts`.
REFERANS: `webhook-dispatcher.ts` (HMAC + SSRF korumaları AYNEN — attempt fonksiyonu yeniden
kullanılır, ikinci bir gönderim yolu AÇILMAZ) · C6-a2 audit action ekleme deseni.
KK: integration: başarısız teslim → job → başarı; tükenme → exhausted + audit; cross-tenant: A'nın
satırı B'nin kilidiyle işlenmez; idempotency.
KAPSAM DIŞI: UI (webhook ekranı zaten teslim durumunu gösteriyor mu bak; göstermiyorsa not düş, ekleme).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-SCHED (türetilmiş — FR-MOD-08.7.3 idle auto-close · 11.5-d SLA · NFR-C8 retention · C6-d SIEM · 07.9 scheduled reports)**. Gereksinim satırı: `grep -n '| M-SCHED' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-SCHED' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
