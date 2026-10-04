# Task ID: 157

**Title:** M-SEC-d [OPUS-MAX] Faz-5 salt-okuma güvenlik denetimi (STRIDE): partisyon RLS · TOTP ve kurtarma kodları · SSO alan bağı · sayfalama cursor ı — bulgular görev olur, ürün kodu YAZILMAZ

**Status:** done

**Dependencies:** 150 ✓, 152 ✓, 153 ✓

**Priority:** medium

**Description:** Faz-5 in dokunduğu yüzeyler düşman gözüyle okunur. tm 142 (M-SEC-a) emsali: bu görev DENETLER, DÜZELTMEZ. Bulunan High/Critical bulgular Task Master a ayrı görev olur; Medium/Low PLAN §D ye yazılır ve görevleşmez (CONVENTIONS §4.1). Denetimin değeri neyi elediğindedir — kusur BULUNMAYAN yerler de raporda ismen yazılır.

**Details:**

NE YAPILACAK: Faz-5 in ürettiği kodun tamamı salt-okuma STRIDE denetiminden geçer.
Odak yüzeyler (tm 150 · 152 · 153 · 151 · 155):
- Partisyon RLS: politikanın ana tablodakiyle birebir olduğu · gelecekteki partisyonların da kapsandığı
  · ana tablo üzerinden giden sorguların davranışının değişmediği.
- TOTP: secret in saklanması ve okunabilirliği · replay muhafızının gerçekten atomik olduğu ·
  ±1 pencerenin genişletilmediği · kurtarma kodlarının tek kullanımlığının yarış altında da tuttuğu.
- 2FA zorlaması: authorize kapısının atlanabileceği bir yol var mı (PAT · bot token · SSO dalı · refresh
  rotasyonu) · require_two_factor un fail-open a düşebileceği bir dal.
- SSO alan bağı: alt alan/benzer alan atlatması · geriye uyumluluk kararının fail-open yaratıp yaratmadığı.
- Sayfalama: keyset cursor ı bir kiracıdan diğerine taşınabilir mi (cursor içinde kiracı bilgisi sızıyor mu),
  before_event_id ile başka bir sohbetin olayları çekilebilir mi.
- 151.2 nin daralttığı /health: admin dalının rol kapısı doğru mu.

YÖNTEM (tm 142 emsali): otuz civarı dosya, düşman gözüyle, ÜRÜN KODU SIFIR SATIR DEĞİŞİR.
Rapor HANDOFF a: bulgular (High/Medium/Low) kaynak + kanıt + dosya:satır ile; ayrıca
DENETİMİN İKİNCİ YARISI olarak kusur BULUNMAYAN yerler ismen (bir denetimin değeri neyi elediğindedir).
High bulgular Task Master a görev olur ve önceliği high tır — critical KULLANILMAZ
(CONVENTIONS §4.1: panelin düzeltme akışına rezerve).
Medium/Low PLAN §D ye yazılır, görevleşmez.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-SEC-d** (türetilmiş — NFR-S1..S12 · v2-04 STRIDE). Gereksinim satırı: `grep -n "| M-SEC-d" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-SEC-d" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

- Kapı: typecheck · lint · format:check · build yeşil (kod değişmediği için FULL TURBO cache-hit beklenir;
  bu kusur değil KANIT — turbo nun girdi karması hiçbir kaynak dosyanın değişmediğini söylüyor).
- git diff --stat: yalnız PLAN.md · HANDOFF.md · .taskmaster/tasks.json.
- Çıktı: HANDOFF a bulgu raporu; her High için açılmış tm numarası; PLAN §7.2 M-SEC-d → "✅ → KM-SEC-d".
