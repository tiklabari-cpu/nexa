# Task ID: 141

**Title:** M-SEED — Demo verisi bütünlüğü: campaigns · tickets · SLA hedefi · goal · zamanlanmış rapor · webhook · örnek değerlendirmeler — seed’de yok, ilgili ekranlar demo’da boş — §D113/K14

**Status:** done

**Dependencies:** None

**Priority:** low

**Description:** 2026-08-17 denetimi: `apps/api/prisma/seed.ts` üç kiracı, ajanlar, müşteriler, sohbetler, skills/knowledge, satış izleme, markalar/kanallar tohumluyor; ama campaigns, tickets, SLA hedefleri, goals, zamanlanmış rapor, webhook ve ratings YOK — Campaigns/Tickets/SLA/Goals/Reviews ekranları demo’da boş açılıyor. Seed idempotent ve `SIYAHTUS_SEED_RESET` ile sıfırlanabilir. Bu görev demo’yu bütünler; şema/sözleşme değişmez.

**Details:**

BULGU (§D113/K14): `grep -n "campaign\|ticket\|slaTarget\|goal\|scheduledReport\|webhook\|rating" apps/api/prisma/seed.ts`
→ (bu turda) yalnızca sohbet/oy dışında 0 (doğrula). Kural: yalnız `acme` (richDemo) zenginleşir; `northwind`
ve `stateside` izolasyon fixture'ları OLDUKLARI GİBİ kalır (e2e onların boşluğuna güvenebilir — spec'leri oku);
idempotency korunur (`already present, skipping`); e2e `global-setup` `SIYAHTUS_SEED_RESET=1` ile koşar — yeni tohum
e2e beklentilerini kırmamalı (özellikle sayaç bekleyen testler: reports/customers spec'lerinde sabit sayı var mı bak).
PLAN §7.2 `M-SEED` satırı bu turda `⬜ → KM-SEED`.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-SEED (türetilmiş — MASTER-PROMPT "Seed veriyle demo akışı"; PRD §11.2 Q12 onboarding tohum verisi)**. Gereksinim satırı: `grep -n '| M-SEED' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-SEED' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

İki alt-görev `done`; `pnpm -w db:seed` idempotent (iki kez exit 0, ikinci "already present") · `SIYAHTUS_SEED_RESET=1` ile sıfırdan · `pnpm -w test:e2e` tam süit regresyonsuz · seed testi (varsa `seed.test.ts`) yeşil; PLAN §7.2 `M-SEED` `✅`.

## Subtasks

### 141.1. M-SEED-a [SONNET-XHIGH] acme’ye campaigns (2) + tickets (5, farklı öncelik/durum, biri chat’ten türemiş) + custom field değerleri + 3 rating (good/bad) tohumu

**Status:** done  
**Dependencies:** None  

Campaigns/Tickets/Reviews demo’da dolu açılır.

**Details:**

NE YAPILACAK: `seed.ts`'e (acme, richDemo bloğu) 2 kampanya (biri aktif greeting, biri taslak — `CampaignService`
şekli), 5 ticket (open/pending/solved, öncelikler, biri mevcut sohbetten `merge`/köprü ile — 13.6 servisiyle),
müşterilere custom field değerleri (08.7.6 tanımları varsa), 3 rating (07.8: good/good/bad, farklı günler).
Servis fonksiyonlarını KULLAN (ham insert değil) ki invariant'lar korunsun; idempotent (var mı kontrolü).
DOSYALAR: `apps/api/prisma/seed.ts` (+ varsa `seed.test.ts`).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-SEED (türetilmiş — MASTER-PROMPT "Seed veriyle demo akışı"; PRD §11.2 Q12 onboarding tohum verisi)**. Gereksinim satırı: `grep -n '| M-SEED' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-SEED' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 141.2. M-SEED-b [SONNET-XHIGH] acme’ye SLA hedefi (11.5-d) + 1 goal (13.3) + 1 zamanlanmış rapor (07.9) + 1 webhook (08.8.4, mock hedef) + 1 SIEM export cursor örneği yok (C6 — dokunma) tohumu; PLAN satırı ✅

**Status:** done  
**Dependencies:** 141.1  

SLA/Goals/Scheduled reports/Webhooks demo’da dolu; M-SEED kapanır.

**Details:**

NE YAPILACAK: SLA hedefi (ilk yanıt 5 dk / çözüm 24 s, iş saatleri) · goal (lead hunisi) · zamanlanmış rapor
(haftalık overview, mock mail) · webhook (`chat.archived` → `http://localhost:9/dev-null`? — SSRF koruması
localhost'u reddedebilir; adaptörün kabul ettiği mock URL biçimini oku, yoksa `https://example.com/hook` +
disabled) — hepsi servislerle, idempotent. SIEM/SSO tohumlanmaz (e2e kendi kurar). PLAN §7.2 `M-SEED` →
`✅ → KM-SEED`.
DOSYALAR: `apps/api/prisma/seed.ts` · PLAN.md.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-SEED (türetilmiş — MASTER-PROMPT "Seed veriyle demo akışı"; PRD §11.2 Q12 onboarding tohum verisi)**. Gereksinim satırı: `grep -n '| M-SEED' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-SEED' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
