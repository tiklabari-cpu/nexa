# Task ID: 140

**Title:** M-CONTAINER — Uygulama imajları + tam yığın compose (yerelde tek komut, DEPLOY DEĞİL): Dockerfile api/rtm/web/widget + docker-compose.full.yml + `make demo` duman testi — §D113/K13

**Status:** done

**Dependencies:** None

**Priority:** low

**Description:** 2026-08-17 denetimi: yalnız dev `docker-compose.yml` (db+redis) var; hiçbir uygulama konteynerize değil, Dockerfile/prod-benzeri compose yok. "Bir bütün içinde hazır" ürün, geliştirici makinesi dışında da tek komutla ayağa kalkabilmeli. CLAUDE.md sınırı korunur: production deploy/DNS/TLS/gerçek secret YOK — bu görev yalnız yerelde koşan imajlar + compose + duman testi üretir.

**Details:**

SINIR (CLAUDE.md/MASTER-PROMPT): deploy YOK. Burada üretilen her şey `docker compose -f docker-compose.full.yml up`
ile YEREL makinede koşar; secret'lar dev değerleridir (`.env.example`), TLS/DNS yok. Amaç §F.1/9'un
"yalnızca geliştirme makinesinde çalışan sistem çalışmıyor sayılır" ölçütünü konteynerle karşılamak.
KIRILIM: 140.1 api+rtm imajları (SONNET) → 140.2 web+widget statik imajları (SONNET) → 140.3 compose +
`make demo` + duman testi (OPUS-XHIGH). PLAN §7.2 `M-CONTAINER` satırı bu turda `⬜ → KM-CONTAINER`.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-CONTAINER (türetilmiş — MASTER-PROMPT "Teslim Paketi: çalışan monorepo + docker-compose"; §F.1/9 temiz kurulum provası)**. Gereksinim satırı: `grep -n '| M-CONTAINER' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-CONTAINER' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

Üç alt-görev `done`; `make demo` (ya da `docker compose -f docker-compose.full.yml up --build -d`) sonrası duman script'i exit 0 (health 200 × 2, web 200, widget demo 200, seed'li giriş 200); imaj boyutları HANDOFF'a; `pnpm -w format:check`; PLAN §7.2 `M-CONTAINER` `✅`.

## Subtasks

### 140.1. M-CONTAINER-a [SONNET-XHIGH] Dockerfile api + rtm: çok aşamalı pnpm build (workspace filtreli), prisma migrate deploy entrypoint, non-root, healthcheck; .dockerignore

**Status:** done  
**Dependencies:** None  

API ve RTM konteyner imajları.

**Details:**

NE YAPILACAK: `apps/api/Dockerfile`, `apps/rtm/Dockerfile` (Node 24 alpine/slim; `corepack` pnpm 11.15.1;
`pnpm fetch` + `pnpm install --frozen-lockfile --filter @siyahtus/api...` deploy; build; runtime aşaması yalnız
dist + prisma engine); api entrypoint: `prisma migrate deploy` (DATABASE_URL owner) → `node dist/index.js`
(DATABASE_APP_URL runtime — README "table owner ile bağlanmaz" kuralı korunur); `HEALTHCHECK` curl health;
non-root user; kök `.dockerignore` (node_modules, .data, dist hariç tutma stratejisi). Yerelde
`docker build` iki imaj başarılı; boyutlar HANDOFF'a.
DOSYALAR: `apps/api/Dockerfile` · `apps/rtm/Dockerfile` · `.dockerignore`.
REFERANS: `apps/api/package.json` scripts (build/db:migrate) · `infra/db/init/00-extensions.sql` (DB tarafı zaten
compose'da).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-CONTAINER (türetilmiş — MASTER-PROMPT "Teslim Paketi: çalışan monorepo + docker-compose"; §F.1/9 temiz kurulum provası)**. Gereksinim satırı: `grep -n '| M-CONTAINER' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-CONTAINER' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 140.2. M-CONTAINER-b [SONNET-XHIGH] Dockerfile web + widget: Vite build → statik sunum (nginx), runtime API/RTM tabanı env ile (config.js enjeksiyonu), SPA fallback, cache başlıkları

**Status:** done  
**Dependencies:** None  

Web ve widget statik imajları.

**Details:**

NE YAPILACAK: `apps/web/Dockerfile`, `apps/widget/Dockerfile`: build aşaması Vite; nginx alpine sunum; web'in
API tabanı bugün "/api/v1 aynı host" ise nginx'te `/api` ve `/v1/agent/rtm` proxy'si (compose iç ağı) — ya da
build-time env; hangisiyse dokümante et; SPA fallback (`try_files`); widget `loader.js` + iframe belgesi
doğru origin'de (`WIDGET_BASE_URL`); cache başlıkları (hash'li asset'ler uzun, html no-cache).
DOSYALAR: `apps/web/{Dockerfile,nginx.conf}` · `apps/widget/{Dockerfile,nginx.conf}`.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-CONTAINER (türetilmiş — MASTER-PROMPT "Teslim Paketi: çalışan monorepo + docker-compose"; §F.1/9 temiz kurulum provası)**. Gereksinim satırı: `grep -n '| M-CONTAINER' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-CONTAINER' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 140.3. M-CONTAINER-c [OPUS-XHIGH] docker-compose.full.yml (db+redis+api+rtm+web+widget; migrate+seed init; healthcheck bağımlılıkları) + `make demo` + duman testi script’i + README; PLAN satırı ✅

**Status:** done  
**Dependencies:** 140.1, 140.2  

Tam yığın tek komutla yerelde ayağa kalkar ve duman testi geçer.

**Details:**

NE YAPILACAK: `docker-compose.full.yml` (dev compose'u BOZMA — ayrı dosya): db/redis (mevcut tanımlar) +
api (migrate deploy + seed bir kez — `SIYAHTUS_SEED_RESET` YOK; idempotent seed) + rtm + web + widget;
`depends_on: condition: service_healthy`; env `.env.example`'dan (`env_file`), portlar README'dekiyle aynı;
`make demo` (`docker compose -f docker-compose.full.yml up --build -d` + duman) ve `make demo-down`;
`scripts/smoke.sh` (curl: api health 200 + `scheduler.enabled` (tm 130 varsa) · rtm health 200 · web / 200 ·
widget /demo.html 200 · seed kimliğiyle `/auth/login` 200); README "Run the whole stack in containers"
+ SINIR notu (yerel, dev secret, TLS/DNS yok). PLAN §7.2 `M-CONTAINER` → `✅ → KM-CONTAINER`.
DOSYALAR: `docker-compose.full.yml` · `Makefile` · `scripts/smoke.sh` · `README.md` · PLAN.md.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-CONTAINER (türetilmiş — MASTER-PROMPT "Teslim Paketi: çalışan monorepo + docker-compose"; §F.1/9 temiz kurulum provası)**. Gereksinim satırı: `grep -n '| M-CONTAINER' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-CONTAINER' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
