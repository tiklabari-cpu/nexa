# Task ID: 132

**Title:** M-CI — Kapı, CI, doküman ve depo hijyeni: db:check-drift CI’da · README gerçekle hizalı · CONVENTIONS DoD listesi CI ile aynı · .playwright-mcp dökümleri · denetim script’leri kalıcı · playbook/health integration testleri — §D113/K4-K6

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** 2026-08-17 denetimi: CI (`.github/workflows/ci.yml`) `db:check-drift`’i hiç koşmuyor; README mobil çalıştırmayı, e2e önkoşullarını (global-setup dev DB’yi sıfırlar!), `.env` yükleme ihtiyacını anlatmıyor ve "test:unit dış servis istemez" iddiası api/rtm için yanlış; CONVENTIONS §1 DoD listesinde CI’ın zorunlu tuttuğu format:check / kontrat codegen diff / db:check-drift yok (tm 118’den beri açık öneri); `.playwright-mcp/` altında 14 MCP döküm YAML’ı izleniyor; `.audit-tm126/*.cjs` (§F.1 denetim araçları) tek seferlik klasörde; `routes/playbook.ts` ve `routes/health.ts`’in kendi integration testi yok.

**Details:**

BULGULAR (§D113/K4-K6, koda karşı):
- CI: `ci.yml:96-111` typecheck/lint/format:check/test:unit/test:integration/build + `:81-88` codegen
  diff + e2e job'u; "drift" sözcüğü yok. `ci.yml:120` `if: hashFiles('apps/e2e/package.json') != ''`
  artık hep doğru (bayat koruma). Mobil jest süiti `verify` job'unda diğer süitlerle aynı anda —
  tm 129'un ölçtüğü yük altı flake CI'da da olası.
- README: `README.md:143` "pnpm test:unit — vitest, no external services needed" (api/rtm için yanlış:
  `with-test-datastores.ts` canlı PG+Redis ister; README:152-168 kendisi anlatıyor) · mobil yalnız
  workspace tablosunda (README:95) · e2e için `playwright install chromium`, 5 sunucu, ve
  `apps/e2e/tests/global-setup.ts:17-19,34-62`'nin `SIYAHTUS_SEED_RESET=1` ile dev DB'yi SIFIRLADIĞI
  yalnız kaynak yorumunda · kök kabuktan `pnpm db:migrate`'in `DATABASE_URL` görmediği yazılı değil
  (Makefile `include .env` yalnız make hedeflerinde).
- CONVENTIONS §1 DoD listesi: format:check · contract codegen diff · db:check-drift YOK; CI üçünü de
  zorluyor (§F.2 "süreç borcu — kullanıcı kararı"). `TASK-RUNNER-PROMPT.md:15,44` PLAN "≈770 KB /
  3.700 satır", HANDOFF "≈880 KB, 244 blok" — bugün 1.34 MB / 5.660 satır ve 1.30 MB. HANDOFF.md:3
  "Date: 2026-08-01".
- Hijyen: `.playwright-mcp/page-2026-08-03T*.yml` 14 dosya izleniyor (MCP tarayıcı dökümü, ürün değil);
  `.audit-tm126/{sweep,silent-debt,dead-code,schema-consumers,endpoint-ui}.cjs` §F.0/§F.1'in
  araçlarıdır ama tek turun klasöründe. `LiveChat_ER_Diyagram.mermaid` KALIR (referans doküman,
  CLAUDE.md taşıma yasağı).
- Testler: `apps/api/src/routes/playbook.ts` yalnız `copilot.test.ts` üzerinden dolaylı; `routes/health.ts`
  yalnız contract-parity ile yapısal.

FAZ-4'ÜN KONUSU KALEM DEĞİL DİKİŞTİR (§D113): Faz 0–3 kalemleri tek tek ✅ ama bütün, bir kullanıcının
gözünden bir yerde kopuyor. Bu görev o kopukluğu kapatır; kapatırken YENİ bir kalem/özellik AÇMAZ,
mevcut sözleşme + servis + ekranı birbirine bağlar. Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-CI / M-DOCS / M-HYGIENE (türetilmiş — NFR-M4 test piramidi · NFR-M bakım · §F.1/8 doküman tazeliği)**. Gereksinim satırı: `grep -n '| M-CI' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-CI' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.
PLAN §7.2 tablosunda `M-CI` satırı `⬜ → KM-CI` olarak açıldı; alt-görevler bittikçe K bloğuna madde, hepsi bitince `✅ → KM-CI` (132.5 yapar).
KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

Beş alt-görev `done` olunca; ayrıca: CI yeşil (push sonrası Actions'ta `verify`+`e2e` yeşil — HANDOFF'a run linki), `pnpm -w format:check` (README/CONVENTIONS markdown) exit 0, `git ls-files .playwright-mcp` boş, `pnpm audit:*` script'leri çalışır, playbook/health integration testleri yeşil; PLAN §7.2 `M-CI` `✅ → KM-CI`.

## Subtasks

### 132.1. M-CI-a [SONNET-XHIGH] CI: db:check-drift adımı + bayat e2e `if` kaldır + mobil jest süiti ayrı job (yük altı flake’i CI’dan da uzak tut)

**Status:** done  
**Dependencies:** None  

CI drift kapısı, bayat koşul temizliği, mobil süit için ayrı job.

**Details:**

NE YAPILACAK: `.github/workflows/ci.yml`: (a) `verify` job'unda `db:migrate` sonrasına
`pnpm -w db:check-drift` adımı (script kökte var: package.json:25); (b) `ci.yml:120` `if:
hashFiles(...)` kaldır; (c) `apps/mobile` jest'i ayrı job'a al (`mobile`: install → `pnpm --filter
@siyahtus/mobile test` → `pnpm --filter @siyahtus/mobile build` (expo export)); `verify`'ın `test:unit`
adımı `--filter=!@siyahtus/mobile` ile mobil hariç — turbo filter sözdizimini kontrol et; (d) e2e job'u
`needs: [verify]` kalır. Yerelde `act` YOK — doğrulama push sonrası Actions'ta.
NEDEN: §D113/K4 — drift kapısı CI'da yok; mobil süit yük altında flake (tm 129/§D112).
DOSYALAR: `.github/workflows/ci.yml`.
REFERANS: mevcut `verify` job adımları ci.yml:18-112.
KK: Actions'ta üç job (`verify`, `mobile`, `e2e`) yeşil; `db:check-drift` adımı log'da görünür.
KAPSAM DIŞI: coverage upload, dependency audit, cache ince ayarı.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-CI / M-DOCS / M-HYGIENE (türetilmiş — NFR-M4 test piramidi · NFR-M bakım · §F.1/8 doküman tazeliği)**. Gereksinim satırı: `grep -n '| M-CI' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-CI' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 132.2. M-DOCS-a [SONNET-XHIGH] README gerçekle hizalanır: mobil çalıştırma · e2e önkoşulları + "dev DB sıfırlanır" uyarısı · .env yükleme (db:migrate/e2e) · "test:unit dış servis istemez" düzeltmesi · Background jobs bölümü

**Status:** done  
**Dependencies:** None  

README’nin yanlış/eksik iddiaları düzeltilir; e2e’nin dev DB’yi sıfırladığı yazılır.

**Details:**

NE YAPILACAK: `README.md`: (a) "Development" bölümünde `pnpm test:unit` satırı → "vitest; **api ve rtm
canlı Postgres+Redis ister** (koşu başına izole veritabanı, bkz. aşağıda)"; (b) yeni "End-to-end
tests" alt bölümü: `pnpm exec playwright install chromium` · 5 sunucu otomatik açılır · **global
setup dev `siyahtus` veritabanını sıfırlar** (`SIYAHTUS_SEED_RESET=1`) — verini kaybetmek istemiyorsan …
· iki pencere aynı anda e2e koşamaz; (c) "Environment" notu: kök kabuktan `pnpm db:migrate`/
`pnpm test:e2e` için `.env` yüklenmeli (`set -a; source .env; set +a` ya da `make migrate`);
(d) "Mobile app" bölümü (13.7-t/tm 128.5 yazdıysa link, yazmadıysa kısa özet + `apps/mobile/README.md`'ye
işaret — 128.5 bitmediyse "bkz." yerine adımları buraya yaz, sonra 128.5 taşır); (e) "Background jobs"
(tm 130.4 yazdıysa dokunma; yazmadıysa bugünkü gerçeği yaz: script'ler + scheduler durumu). Ayrıca
`HANDOFF.md:3` başlık tarihini "güncel — bkz. Task log" biçimine çevir (tarih sabiti bayatlıyor).
NEDEN: §D113/K5 + §F.1/8 doküman tazeliği.
DOSYALAR: `README.md` · `HANDOFF.md` (yalnız satır 3).
KK: README'deki her komut bu makinede çalışır (en az `make dev` yolunu ve e2e önkoşul komutunu fiilen
koştur; HANDOFF'a çıktı özeti).
KAPSAM DIŞI: mimari bölümünü yeniden yazmak; PLAN.md.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-CI / M-DOCS / M-HYGIENE (türetilmiş — NFR-M4 test piramidi · NFR-M bakım · §F.1/8 doküman tazeliği)**. Gereksinim satırı: `grep -n '| M-CI' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-CI' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 132.3. M-DOCS-b [SONNET-XHIGH] Kapı sözleşmesi: CONVENTIONS §1 DoD listesine format:check + kontrat codegen diff + db:check-drift (CI ile aynı) · TASK-RUNNER-PROMPT bayat boyutlar · §F.0 araç adları

**Status:** done  
**Dependencies:** 132.1  

CONVENTIONS DoD listesi CI’ın zorunlu tuttuğu üç kapıyı da sayar; runner prompt bayat sayıları düzeltir.

**Details:**

NE YAPILACAK: (a) `CONVENTIONS.md` §1 DoD listesine üç kutu: `pnpm -w format:check` (exit 0) ·
kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status --short packages/contract/src/
generated` boş · migration varsa `pnpm -w db:check-drift` (exit 0) — hepsi CI'da zaten zorunlu
(ci.yml:81-88, :102; drift 132.1 ile). Not: bu, §F.2 raporunun "kullanıcı kararı" dediği süreç
borcudur; Faz-4 açılışında (§D113) karar verildi: kapı sözleşmesi CI ile aynı olur. (b)
`TASK-RUNNER-PROMPT.md:15` "≈770 KB / 3.700 satır" → güncel (ölç: `wc -c PLAN.md`) ve `:44` HANDOFF
"≈880 KB, 244 blok" → güncel; sayıları yaklaşık ver ("~1.3 MB / ~5.700 satır") ki her turda bayatlamasın.
(c) PLAN §F.0 tablosuna denetim araç adlarını ekle (132.4'ün `pnpm audit:*` komutları — 132.4
bitmediyse yalnız yer tutucu cümle: "araçlar scripts/audit/ altında toplanacak (tm 132.4)").
NEDEN: §D113/K5; §F.2/4 "süreç borcu — kullanıcı kararı" bekliyordu.
DOSYALAR: `CONVENTIONS.md` · `TASK-RUNNER-PROMPT.md` · `PLAN.md` §F.0.
KAPSAM DIŞI: run-loop.sh · AUTORUN-README.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-CI / M-DOCS / M-HYGIENE (türetilmiş — NFR-M4 test piramidi · NFR-M bakım · §F.1/8 doküman tazeliği)**. Gereksinim satırı: `grep -n '| M-CI' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-CI' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 132.4. M-HYGIENE-a [SONNET-XHIGH] Depo hijyeni: .playwright-mcp/ dökümleri kaldır + ignore; .audit-tm126/*.cjs → scripts/audit/ + `pnpm audit:*` komutları (§F.0 periyodik denetim araçları); PLAN §F.0/§F.1 atıfları

**Status:** done  
**Dependencies:** None  

MCP döküm dosyaları depodan çıkar; §F.1 denetim script’leri kalıcı ve komutla çağrılabilir olur.

**Details:**

NE YAPILACAK: (a) `git rm -r .playwright-mcp` (14 YAML dökümü) + `.gitignore`'a `.playwright-mcp/`;
(b) `.audit-tm126/{sweep,silent-debt,dead-code,schema-consumers,endpoint-ui}.cjs` → `scripts/audit/`
(`git mv`; README'si de) ve kök `package.json` script'leri: `audit:sweep` · `audit:silent-debt` ·
`audit:dead-code` · `audit:schema-consumers` · `audit:endpoint-ui` (her biri `node scripts/audit/<x>.cjs`);
her script'in başındaki "tm 126'ya özel" varsayımları (sabit yollar, tarih) genelleştir ve çalıştığını
kanıtla (çıktılarını HANDOFF'a özetle — bu aynı zamanda Faz-4 açılışında bir §F.0 mini denetimidir);
(c) PLAN §F.0 tablosuna "Kanıt" sütununda ilgili komut adı; §D105/§F.1 maddelerindeki
`.audit-tm126/…` atıflarına "→ scripts/audit/… (tm 132.4)" notu (silme, CONVENTIONS §1.2 tarihçe);
(d) `.taskmaster/tmp-*` zaten ignore — dokunma. `LiveChat_ER_Diyagram.mermaid` KALIR.
NEDEN: §D113/K6 + §F.0'ın periyodik denetimi elle yeniden yazılmasın diye.
DOSYALAR: `.playwright-mcp/` · `.gitignore` · `scripts/audit/*` · `package.json` · PLAN.md.
KK: `git ls-files .playwright-mcp` boş; 5 `pnpm audit:*` komutu exit 0 ve anlamlı çıktı;
`.audit-tm126/` kalmaz (git mv).
KAPSAM DIŞI: script mantığını genişletmek (yalnız taşınabilir/çalışır hâle getirme).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-CI / M-DOCS / M-HYGIENE (türetilmiş — NFR-M4 test piramidi · NFR-M bakım · §F.1/8 doküman tazeliği)**. Gereksinim satırı: `grep -n '| M-CI' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-CI' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 132.5. M4-a [SONNET-XHIGH] Integration test boşlukları: routes/playbook.ts (skill CRUD/compile/preview/knowledge + cross-tenant) ve routes/health.ts (ok / degraded 503) + PLAN satırı ✅

**Status:** done  
**Dependencies:** 132.1, 132.2, 132.3, 132.4  

İki testsiz route dosyası kendi integration süitini alır; M-CI satırı kapanır.

**Details:**

NE YAPILACAK: (a) `apps/api/test/integration/playbook.test.ts`: `routes/playbook.ts`'in her ucu
(listele/oluştur/oku/güncelle/sil skill · compile · preview · knowledge kaynakları · runs) — pozitif +
yetki reddi (scope) + **cross-tenant 404** (başka lisansın skill'i) + doğrulama hataları (ADR-06
zarfı); mevcut `copilot.test.ts`'in dolaylı kapsadığı senaryoları TEKRARLAMA, atıf ver. (b)
`test/integration/health.test.ts`: 200 gövde şekli (version/region/uptime_s/deps/scheduler/providers
— tm 130/131 eklediyse) · Redis düşükken 503 `degraded` (test Redis'i kapatmak yerine bozuk URL'li
ikinci server örneği kur — with-test-datastores'un verdiği Redis'e dokunma). (c) PLAN §7.2 `M-CI`
`✅ → KM-CI`; K bloğuna özet.
NEDEN: §D113/K6 — 40 route dosyasından 2'si kendi süitsiz (contract-parity yapısal nöbetçi, davranış
değil).
DOSYALAR: iki yeni test dosyası · PLAN.md.
REFERANS: `test/integration/copilot.test.ts` (playbook uçlarına dokunan yerler) · `test/integration/
skills*.test.ts` varsa · `routes/health.ts:18-55`.
KK: playbook süiti ≥ 12 test, health ≥ 3; tam integration süiti yeşil.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-CI / M-DOCS / M-HYGIENE (türetilmiş — NFR-M4 test piramidi · NFR-M bakım · §F.1/8 doküman tazeliği)**. Gereksinim satırı: `grep -n '| M-CI' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-CI' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
