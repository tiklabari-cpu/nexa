# Task ID: 139

**Title:** PRD 🔒 kalanları (Should/Could) — konsol kabuğu tamamlayıcıları: hamburger/nav pin-unpin (01.1.1+01.5) · presence avatar grubu (01.1.4) · Invite +N (01.1.5) · "N Leads qualified" (01.1.2) · promosyon/onboarding banner + Take tour (01.4+02.2.3) · onboarding survey (07.2) — §F.2/3

**Status:** done

**Dependencies:** None

**Priority:** low

**Description:** §F.2 final raporunun "bilinçli yapılmayanlar" listesinde sekiz FR-MOD satırı 🔒 (Should/Could) kaldı: 01.1.1/.4/.5, 01.4, 01.5, 01.1.2, 02.2.3, 07.2. Kod tarandı (2026-08-17): AppShell’de nav daraltma/unpin, presence avatarları, Invite düğmesi, Take tour/promosyon banner’ı, onboarding survey — hiçbiri yok. Hepsi küçük kabuk işleri; Faz-4 hepsini alır ki PRD süpürmesi Should/Could’da da 0 🔒 ile bitsin (yalnız ⛔ kalır).

**Details:**

BULGU: `grep -rn -i "collapse\|unpin\|pinned\|invite" apps/web/src/components/AppShell.tsx` → 0;
`grep -rln -i "presence" apps/web/src/components` → yalnız CommandPalette; "take tour"/"what are you
tracking" → 0. PRD KK'ları (urun-gereksinim-dokumani-PRD.md:483-491, 506, 584) alt-görevlerde birebir.
Altı SONNET/OPUS nanotask; birbirinden bağımsız (01.4 banner'ı 02.2.3 "Take tour"u da kapsar).
NOT (damga): bu satırlar Faz 0–3 boyunca `🔒` idi (Should/Could, hiçbir fazın sayacına girmedi — §F.2/3).
Faz-4 onları alır: kapanışta ilgili PLAN §3 satırının hücresi `🔒` → `✅ → K<kod>` (K bloğu yoksa aç); §6A
tablosundaki "PRD 🔒 kalanları" kalemi altı alt-görevin altısı bitince ✅ (139.6 yapar).

FAZ-4'ÜN KONUSU KALEM DEĞİL DİKİŞTİR (§D113): Faz 0–3 kalemleri tek tek ✅ ama bütün, bir kullanıcının
gözünden bir yerde kopuyor. Bu görev o kopukluğu kapatır; kapatırken YENİ bir kalem/özellik AÇMAZ,
mevcut sözleşme + servis + ekranı birbirine bağlar. Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-01.1.1 · 01.1.2 · 01.1.4 · 01.1.5 · 01.4 · 01.5 · 02.2.3 · 07.2 (🔒 kalanları)**. Gereksinim satırı: `grep -n '🔒' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K01.1' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.
Üst görev alt-görevlerin toplamıdır; her alt-görev kendi satır/K bloğu bilgisini taşır (details içinde).
KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

Altı alt-görev `done`; web unit (+≥18) · e2e `shell.spec.ts` (yeni: unpin/pin · presence · invite · leads pill · banner dismiss kalıcı · survey tek sefer) · a11y.spec kabuk değişikliğiyle yeşil · typecheck/lint/build; PLAN §3 satırları `🔒` → `✅`; §6A kalemi ✅.

## Subtasks

### 139.1. 01.1.1-a + 01.5-a [SONNET-XHIGH] Logo/hamburger + nav daraltma/genişletme (pin/unpin), tercih kullanıcı bazında kalıcı; klavye erişilebilir

**Status:** done  
**Dependencies:** None  

Sol nav daraltılıp genişletilebilir; tercih saklanır.

**Details:**

NE YAPILACAK: `components/AppShell.tsx`: logo/hamburger düğmesi (`aria-expanded`, `aria-controls`) → nav
"pinned" (geniş, etiketli) ↔ "unpinned" (ikon rayı, hover'da genişler ya da yalnız ikon+tooltip); tercih
`localStorage` `siyahtus.nav.pinned:<accountId>` (kullanıcı bazında — `theme.ts`/`i18n.ts` store deseni,
zustand); klavye: düğme Enter/Space, odak sırası bozulmaz; a11y.spec kabuk rotalarında yeşil kalır.
KK (PRD 01.1.1): "Menü/uygulama seçici açılır; nav pin/unpin" · (01.5): "Pinned/Unpinned; kullanıcı bazında
persist". Testler: toggle · persist · başka hesapta bağımsız · aria.
DOSYALAR: `components/AppShell.tsx` (+test) · `lib/nav-store.ts` (yeni).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-01.1.1 · 01.5**. Gereksinim satırı: `grep -n '| 01\.1\.1/\.4/\.5, 01\.4, 01\.5' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K01.1' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.
Satır 179 beş kodu birlikte taşır — hücre `🔒` bu alt-görevle DEĞİL, beşi de bitince (139.5) `✅ → K01.1` olur; sen K01.1 bloğunu aç ve maddeni yaz.
KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 139.2. 01.1.4-a [OPUS-XHIGH] Presence avatar grubu: çevrimiçi takım üyeleri (RTM presence pub/sub) topbar’da; online/offline halka + metin (A11Y2 renk-bağımsız); hover isim

**Status:** done  
**Dependencies:** None  

Kim çevrimiçi topbar’da görünür; RTM presence tüketilir.

**Details:**

NE YAPILACAK: RTM presence (`apps/rtm` presence pub/sub — ADR-11; web `lib/realtime.ts` presence olaylarını
alıyor mu bak; almıyorsa agent RTM protokolündeki mevcut presence push'unu (`@siyahtus/types` rtm) abone ol —
YENİ RTM eylemi AÇMA; yoksa `/agents?status=online` polling'i (30 s) kabul edilir ve gerekçelenir) →
`components/PresenceAvatars.tsx`: ilk N avatar + "+M", her biri `title`/tooltip isim, durum halkası +
görsel-dışı metin (`sr-only` "online") — NFR-A11Y2. Testler: liste render · +M · a11y adları · presence
güncellemesi. OPUS: RTM tüketimi + kabuk kompozisyonu.
KK (PRD 01.1.4): "Online/offline halka; hover isim".
DOSYALAR: `components/{PresenceAvatars.tsx, AppShell.tsx}` · `lib/realtime.ts` (+test).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-01.1.4**. Gereksinim satırı: `grep -n '| 01\.1\.1/\.4/\.5, 01\.4, 01\.5' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K01.1' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 139.3. 01.1.5-a [SONNET-XHIGH] "Invite +N" topbar düğmesi → InviteTeammates modalı (04.4) her ekrandan

**Status:** done  
**Dependencies:** None  

Ekip daveti her ekrandan bir tık.

**Details:**

NE YAPILACAK: `AppShell.tsx` topbar'a "Invite" düğmesi (koltuk sayısı biliniyorsa "+N" — `/billing/subscription`
seats − aktif üye; bilinmiyorsa düz "Invite") → mevcut `features/team/InviteTeammates.tsx` modalı (04.4 ✅)
kabuktan açılır (modal bileşeni TeamPage'e sıkı bağlıysa çıkar; ikinci kopya YAZMA). Testler: düğme →
modal · N hesabı · yetki (agent rolü davet edemiyorsa düğme gizli — sunucu kuralına bak).
KK (PRD 01.1.5): "[MOD-04.4] modalını açar".
DOSYALAR: `components/AppShell.tsx` · `features/team/InviteTeammates.tsx` (+test).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-01.1.5**. Gereksinim satırı: `grep -n '| 01\.1\.1/\.4/\.5, 01\.4, 01\.5' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K01.1' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 139.4. 01.1.2-a [SONNET-XHIGH] "N Leads qualified" pill — nitelikli lead sayısı canlı (>0 iken görünür), tıklama Customers?segment=leads

**Status:** done  
**Dependencies:** None  

Topbar’da nitelikli lead sayacı.

**Details:**

NE YAPILACAK: `AppShell.tsx` topbar'a pill: kaynak `/customers?segment=leads` toplamı (mevcut uç; sayfalama
`total` alanı yoksa `/reports/overview`'daki lead sayısı — hangisi PRD "nitelikli lead" tanımına uyuyorsa;
kararı K'ye yaz; YENİ uç AÇMA), 60 s'de bir yenile ya da RTM olayıyla; 0 iken gizli; tıklama →
`/app/customers?segment=leads`. Testler: 0 gizli · N görünür · tıklama rota.
KK (PRD 01.1.2): "Sayı>0 iken görünür; tıklama lead görünümü/rapora götürür". §D107: bu kod PLAN'a hiç
aktarılmamıştı, tm 126'da 🔒 olarak eklendi (satır 180) — kapanışta `🔒` → `✅ → K01.1.2`.
DOSYALAR: `components/AppShell.tsx` (+test) · `features/customers` segment link'i.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-01.1.2**. Gereksinim satırı: `grep -n '| 01\.1\.2 ' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K01.1.2' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 139.5. 01.4-a + 02.2.3-a [SONNET-XHIGH] Promosyon/onboarding banner’ları — Banner design-system’i (EK-C.2 kalıcı dismiss + segment) ile "Take tour" (Inbox, tek sefer) + "Top chat topics" (Reports); satır 179 ✅

**Status:** done  
**Dependencies:** 139.1, 139.2, 139.3  

Segmentli, kalıcı-kapatılan banner’lar; Take tour Inbox’ta tek sefer.

**Details:**

NE YAPILACAK: `components/ui/Banner` (EK-C.2: segmentli + kalıcı dismiss zaten var) ile iki banner:
(a) Inbox üstünde "Take tour" (02.2.3: tek sefer + kalıcı kapatma; tur = 3-4 adımlık basit spot/tooltip
dizisi — kütüphane EKLEME, mevcut Modal/Popover ile) — segment: yeni hesap (onboarding tamamlandıktan
sonraki 7 gün); (b) Reports'ta "Top chat topics" (07.6 hazır) tanıtım banner'ı — segment: topics hiç
açılmamışsa. Dismiss `localStorage` kullanıcı bazında (Banner'ın mevcut mekanizması). Sonra satır 179
(`01.1.1/.4/.5, 01.4, 01.5`) hücresi `🔒` → `✅ → K01.1` (139.1/2/3 bitmiş olmalı — bağımlılık) ve satır
198 (`02.2.3`) `🔒` → `✅ → K02.2.3`.
KK (PRD 01.4): "Dismiss kalıcı; segmentli gösterim" · (02.2.3): "Tek sefer + kalıcı kapatma".
DOSYALAR: `features/inbox/InboxPage.tsx` · `features/reports/ReportsPage.tsx` · `components/ui/Banner*` ·
`components/Tour.tsx` (yeni) + testler.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-01.4 · 02.2.3**. Gereksinim satırı: `grep -n '| 01\.1\.1/\.4/\.5, 01\.4, 01\.5' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K01.1' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 139.6. 07.2-a [SONNET-XHIGH] Onboarding survey popover ("What are you tracking?" 5 seçenek; tek sefer, atlanabilir) → kişiselleştirme sinyali onboarding state’e; §6A kalemi ✅

**Status:** done  
**Dependencies:** 139.5  

İlk girişte tek seferlik anket; cevap onboarding durumuna yazılır.

**Details:**

NE YAPILACAK: Reports (07.2 PRD "Onboarding survey popover") ilk açılışta popover: "What are you tracking?"
5 seçenek (PRD kaynak: sales/leads/support/… — PRD:584 "5 seçenek"; metinleri ürün diline uygun seç, K'ye yaz)
+ Skip; cevap `POST /onboarding/complete` gövdesinde `survey`? — sözleşmede alan yoksa KATKISAL alan ekle
(`onboarding.yaml` complete body + `onboarding_state` sütunu? önce `OnboardingState` şemasına bak; sütun
gerekiyorsa küçük migration, drift temiz) — kişiselleştirme sinyali = Home checklist sırası (13.1) onu okur
(basit: seçilen alanı öne al). Tek sefer: state'te `survey_answered_at`. Testler: göster · skip · cevap →
istek · ikinci açılışta yok. Sonra satır 235 (`07.2`) `🔒` → `✅ → K07.2`; §6A "PRD 🔒 kalanları" kalemi ✅.
KK (PRD 07.2): "Tek sefer, atlanabilir; kişiselleştirme sinyali".
DOSYALAR: `features/reports/SurveyPopover.tsx` (+test) · `features/onboarding/*` · sözleşme/migration
gerekirse · PLAN.md.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-07.2**. Gereksinim satırı: `grep -n '| 07\.2 ' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K07.2' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
