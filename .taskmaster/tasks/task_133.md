# Task ID: 133

**Title:** I18N — Konsol sayfa gövdelerinin çevrilmesi: dil değiştirici gerçekten çalışsın (bugün 78 sayfa dosyasından 2’si t() kullanıyor) + widget katalog/RTL mekanizması — NFR-I18N2 ◐→✅

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** 2026-08-17 denetimi: `apps/web/src/lib/i18n.ts` tam bir store (en/tr, ~148 anahtar) ve AppShell’de dil değiştirici var, ama 78 üretim .tsx dosyasından yalnız AppShell + CommandPalette `t()` çağırıyor; Home/Inbox/Reports/Settings/Team/Billing/Customers/Playbook (~8.500 satır) 0 çağrı — Türkçe’ye geçince yalnız çerçeve çevriliyor. KI18N1-2 bunu dürüstçe "shell/nav/⌘K" diye yazmıştı; NFR-I18N2 "panel i18n" ister → satır bu turda ◐. Widget en/tr (54 anahtar), "45+ dil"/RTL yok. Bu görev sayfa sayfa çeviri + nöbetçi test + e2e kanıt + widget çok-dil/RTL mekanizmasını getirir.

**Details:**

BULGU (§D113/K7): `grep -rl "useTranslate\|\bt(" apps/web/src --include=*.tsx | grep -v test`
→ yalnız `components/AppShell.tsx` ve `components/CommandPalette.tsx:50`. Sayfa gövdeleri sabit
İngilizce. Kullanıcı dil değiştiricide "Türkçe" seçince yarım bir ürün görüyor — bu bir "dikiş"
değil, yarım kalmış NFR'dir; PLAN §7.2 `I18N1/2` satırı bu turda `✅ → ◐` yapıldı (§D113).
KIRILIM: 133.1 altyapı + nöbetçi (OPUS-XHIGH — düzen kararı) → 133.2…133.11 sayfa grupları
(SONNET; büyük dosyalar SONNET-MAX) → 133.12 e2e kanıt (OPUS-XHIGH) → 133.13 widget çok-dil + RTL
(SONNET-MAX). Sayfa alt-görevleri BİRBİRİNDEN BAĞIMSIZDIR (yalnız 133.1'e bağlı) — paralel/karışık
sırada koşabilir; her biri kendi dosyalarını çevirir ve nöbetçi listesini genişletir.
ORTAK KURALLAR (tm 133'ün her sayfa alt-görevi için — 133.1 altyapıyı kurar, sen onu KULLAN):
- Katalog: `apps/web/src/locales/{en,tr}/<ad-alanı>.ts` (133.1'in düzeni; anahtar biçimi
  `<sayfa>.<bölüm>.<anlam>`, değer değil anlam — "save" değil "actions.save"); `useTranslate()` →
  `t('inbox.list.empty')`; sayı/tarih/para `lib/format.ts` (locale'e bağlı; §D82 pinleme dersi —
  runtime locale'i ürün davranışına sızdırma; testler locale'i açıkça kurar).
- Türkçe metinler GERÇEK çeviri (makine-kalitesinde değil): kısa, ürün dili tutarlı ("Sohbet",
  "Müşteri", "Takım", "Playbook" (özel ad), "Faturalama", "Ayarlar", "Raporlar", "Gelen kutusu");
  ⌘K/AppShell'in mevcut `tr` kataloğu (`lib/i18n.ts`) sözlük emsalidir.
- Testler: sayfanın mevcut `*.test.tsx`'leri metin arıyorsa (`getByText('Save')`) → anahtarla
  eşleşen İngilizce değer üzerinden ya da `t()`'nin test yardımcısıyla (133.1 sağlar) — assert
  sayısı AZALMAZ; +1 test: `tr` locale'de sayfanın en az bir sentinel metni Türkçe.
- 133.1'in nöbetçisi (`i18n-coverage.test.ts`) sayfa dosyanı "çevrilmiş" listesine ALIR — listeyi
  güncellemek bu alt-görevin işidir; nöbetçi ayrıca en/tr anahtar kümelerinin EŞİT olduğunu doğrular
  (eksik tr anahtarı kırmızı).
- `aria-label`/`title`/placeholder da çevrilir (a11y metinleri sabit İngilizce kalmasın).
- Kapsam dışı: sunucu tarafı metinler (hata mesajları ADR-06 `type`'ından istemcide çevrilir —
  `lib/api-client.ts`'in hata eşlemesi 133.1'de) · e-posta şablonları · widget (133.13).

FAZ-4'ÜN KONUSU KALEM DEĞİL DİKİŞTİR (§D113): Faz 0–3 kalemleri tek tek ✅ ama bütün, bir kullanıcının
gözünden bir yerde kopuyor. Bu görev o kopukluğu kapatır; kapatırken YENİ bir kalem/özellik AÇMAZ,
mevcut sözleşme + servis + ekranı birbirine bağlar. Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **NFR-I18N2 panel i18n (+ I18N1 widget · I18N5 yerelleştirme)**. Gereksinim satırı: `grep -n '| I18N1/2' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KI18N1-2' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.
PLAN §7.2 `I18N1/2` satırı bu turda `◐ → KI18N1-2`; alt-görevler bittikçe K bloğuna madde; 133.12 bitince satır `✅ → KI18N1-2` (widget 45+ dil hedefi için 133.13’ün notu K bloğunda dürüstçe: mekanizma + N dil, tam liste değil).
KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

13 alt-görev `done` olunca; ayrıca: `pnpm -w test` (web i18n-coverage nöbetçisi: tüm sayfa dosyaları listede, en/tr anahtar kümeleri eşit) · `pnpm -w test:e2e` (`i18n.spec.ts`: her rota için tr sentinel + kanıt PNG) · typecheck/lint/build; PLAN §7.2 `I18N1/2` `✅ → KI18N1-2`; K bloğunda 13 madde.

## Subtasks

### 133.1. I18N-a [OPUS-XHIGH] Altyapı + nöbetçi: katalog düzeni (locales/{en,tr}/<ad-alanı>.ts), t() ad-alanı/interpolasyon/çoğul, hata-zarfı → kullanıcı metni eşlemesi, i18n-coverage.test.ts (sayfa listesi + en/tr anahtar eşitliği), test yardımcısı

**Status:** done  
**Dependencies:** None  

Sayfa çevirilerinin üstüne oturacağı katalog düzeni, yardımcılar ve nöbetçi test.

**Details:**

NE YAPILACAK: (a) `apps/web/src/lib/i18n.ts`'i BOZMADAN genişlet: kataloğu `src/locales/{en,tr}/
{shell,auth,inbox,customers,team,reports,billing,playbook,settings,apps,home,common}.ts` dosyalarına
böl (mevcut ~148 anahtar `shell`/`common`'a taşınır, davranış aynı; `i18n.test.ts` yeşil kalır),
`t(key, vars?)` interpolasyon (`{count}`) + basit çoğul (`Intl.PluralRules`), fallback zinciri
aynen (aktif→en→anahtar); (b) ADR-06 hata `type` → kullanıcı metni eşlemesi `common.errors.<type>`
(24 tip) ve `lib/api-client.ts`'in hata gösterim yolu onu kullanır (sayfalar sunucu mesajını ham
göstermez); (c) nöbetçi `src/lib/i18n-coverage.test.ts`: `features/**/*.tsx` (test hariç) dosyalarını
tarar; sabit liste `TRANSLATED_FILES` (bu turda: AppShell, CommandPalette + 133.x'in ekleyecekleri) —
listede olmayan bir dosya `t(` çağırmıyorsa "henüz çevrilmedi" olarak SAYILIR ve test kalan sayıyı
raporlar; listede olan dosyada JSX metin düğümü olarak İngilizce cümle kalıp kalmadığı için heuristik
(≥ 3 kelimelik düz metin JSX çocuğu) — false-positive'leri `// i18n-ignore` ile açıkla; en/tr anahtar
kümeleri EŞİT (fark listelenir); (d) test yardımcısı `test/i18n.tsx`: `renderWithLocale(ui, 'tr')`;
(e) `lib/format.ts` locale'i store'dan alır (zaten öyle mi doğrula).
NEDEN: §D113/K7 — sayfa çevirileri ortak düzen olmadan on pencerede on farklı yapı üretir.
DOSYALAR: `lib/i18n.ts` · `src/locales/**` · `lib/api-client.ts` · `lib/i18n-coverage.test.ts` ·
`test/i18n.tsx` · `lib/i18n.test.ts` (+interpolasyon/çoğul testleri).
REFERANS: mevcut `lib/i18n.ts` (store + fallback) · `components/AppShell.tsx` kullanımı · widget
`apps/widget/src/i18n.ts` (createTranslator) — iki katalog AYRI kalır.
KK: mevcut testler yeşil; nöbetçi çalışıyor ve "kalan N dosya" raporluyor; en/tr eşit.
KAPSAM DIŞI: sayfaların kendisini çevirmek (133.2+); üçüncü dil.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **NFR-I18N2 panel i18n (+ I18N1 widget · I18N5 yerelleştirme)**. Gereksinim satırı: `grep -n '| I18N1/2' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KI18N1-2' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 133.2. I18N-b [SONNET-XHIGH] Auth + public sayfalar: SignInPage · PublicPages (SignUp/Forgot/Reset/Join) · AuthCallbackPage · OnboardingWizard

**Status:** done  
**Dependencies:** 133.1  

Giriş/kayıt/onboarding metinleri katalogdan gelir.

**Details:**

NE YAPILACAK: listelenen dosyaların TÜM kullanıcı metinlerini `t()`'ye taşı (`locales/{en,tr}/auth.ts`, `onboarding.ts`); form doğrulama mesajları (`lib/form.tsx` primitifi kullanılıyorsa onun mesajları da) çevrilir; nöbetçi listesine ekle; +1 tr sentinel testi.
DOSYALAR: `features/auth/{SignInPage,PublicPages,AuthCallbackPage}.tsx` · `features/onboarding/OnboardingWizard.tsx` · `lib/form.tsx` (mesajlar) · ilgili testler.
ORTAK KURALLAR (tm 133'ün her sayfa alt-görevi için — 133.1 altyapıyı kurar, sen onu KULLAN):
- Katalog: `apps/web/src/locales/{en,tr}/<ad-alanı>.ts` (133.1'in düzeni; anahtar biçimi
  `<sayfa>.<bölüm>.<anlam>`, değer değil anlam — "save" değil "actions.save"); `useTranslate()` →
  `t('inbox.list.empty')`; sayı/tarih/para `lib/format.ts` (locale'e bağlı; §D82 pinleme dersi —
  runtime locale'i ürün davranışına sızdırma; testler locale'i açıkça kurar).
- Türkçe metinler GERÇEK çeviri (makine-kalitesinde değil): kısa, ürün dili tutarlı ("Sohbet",
  "Müşteri", "Takım", "Playbook" (özel ad), "Faturalama", "Ayarlar", "Raporlar", "Gelen kutusu");
  ⌘K/AppShell'in mevcut `tr` kataloğu (`lib/i18n.ts`) sözlük emsalidir.
- Testler: sayfanın mevcut `*.test.tsx`'leri metin arıyorsa (`getByText('Save')`) → anahtarla
  eşleşen İngilizce değer üzerinden ya da `t()`'nin test yardımcısıyla (133.1 sağlar) — assert
  sayısı AZALMAZ; +1 test: `tr` locale'de sayfanın en az bir sentinel metni Türkçe.
- 133.1'in nöbetçisi (`i18n-coverage.test.ts`) sayfa dosyanı "çevrilmiş" listesine ALIR — listeyi
  güncellemek bu alt-görevin işidir; nöbetçi ayrıca en/tr anahtar kümelerinin EŞİT olduğunu doğrular
  (eksik tr anahtarı kırmızı).
- `aria-label`/`title`/placeholder da çevrilir (a11y metinleri sabit İngilizce kalmasın).
- Kapsam dışı: sunucu tarafı metinler (hata mesajları ADR-06 `type`'ından istemcide çevrilir —
  `lib/api-client.ts`'in hata eşlemesi 133.1'de) · e-posta şablonları · widget (133.13).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **NFR-I18N2 panel i18n (+ I18N1 widget · I18N5 yerelleştirme)**. Gereksinim satırı: `grep -n '| I18N1/2' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KI18N1-2' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 133.3. I18N-c [SONNET-MAX] Inbox: InboxPage + liste/transcript/composer/details/copilot bileşenleri (features/inbox, 20 test dosyası)

**Status:** done  
**Dependencies:** 133.1  

Inbox’ın tüm metinleri katalogdan gelir.

**Details:**

NE YAPILACAK: `features/inbox/**` (InboxPage 847 satır + ChatList/Transcript/Composer/DetailsPanel/CopilotPanel/ConflictBanner/… ) → `locales/{en,tr}/inbox.ts`; canned response `#` seçici, internal note, transfer, tag, archive metinleri; boş/yükleniyor/hata cümleleri; a11y etiketleri. 20 test dosyası metin arıyor — assert sayısı azalmaz.
DOSYALAR: `features/inbox/*.tsx` (test hariç) · `locales/{en,tr}/inbox.ts`.
ORTAK KURALLAR (tm 133'ün her sayfa alt-görevi için — 133.1 altyapıyı kurar, sen onu KULLAN):
- Katalog: `apps/web/src/locales/{en,tr}/<ad-alanı>.ts` (133.1'in düzeni; anahtar biçimi
  `<sayfa>.<bölüm>.<anlam>`, değer değil anlam — "save" değil "actions.save"); `useTranslate()` →
  `t('inbox.list.empty')`; sayı/tarih/para `lib/format.ts` (locale'e bağlı; §D82 pinleme dersi —
  runtime locale'i ürün davranışına sızdırma; testler locale'i açıkça kurar).
- Türkçe metinler GERÇEK çeviri (makine-kalitesinde değil): kısa, ürün dili tutarlı ("Sohbet",
  "Müşteri", "Takım", "Playbook" (özel ad), "Faturalama", "Ayarlar", "Raporlar", "Gelen kutusu");
  ⌘K/AppShell'in mevcut `tr` kataloğu (`lib/i18n.ts`) sözlük emsalidir.
- Testler: sayfanın mevcut `*.test.tsx`'leri metin arıyorsa (`getByText('Save')`) → anahtarla
  eşleşen İngilizce değer üzerinden ya da `t()`'nin test yardımcısıyla (133.1 sağlar) — assert
  sayısı AZALMAZ; +1 test: `tr` locale'de sayfanın en az bir sentinel metni Türkçe.
- 133.1'in nöbetçisi (`i18n-coverage.test.ts`) sayfa dosyanı "çevrilmiş" listesine ALIR — listeyi
  güncellemek bu alt-görevin işidir; nöbetçi ayrıca en/tr anahtar kümelerinin EŞİT olduğunu doğrular
  (eksik tr anahtarı kırmızı).
- `aria-label`/`title`/placeholder da çevrilir (a11y metinleri sabit İngilizce kalmasın).
- Kapsam dışı: sunucu tarafı metinler (hata mesajları ADR-06 `type`'ından istemcide çevrilir —
  `lib/api-client.ts`'in hata eşlemesi 133.1'de) · e-posta şablonları · widget (133.13).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **NFR-I18N2 panel i18n (+ I18N1 widget · I18N5 yerelleştirme)**. Gereksinim satırı: `grep -n '| I18N1/2' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KI18N1-2' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 133.4. I18N-d [SONNET-XHIGH] Customers + Traffic + Campaigns + Goals sayfaları ve bileşenleri

**Status:** done  
**Dependencies:** 133.1  

CRM/Engage yüzeyleri katalogdan gelir.

**Details:**

NE YAPILACAK: `features/customers/**` (CustomersPage 257 + CustomerDetailPanel + custom-fields) · `features/traffic/**` (TrafficPage 416 + filtreler) · `features/campaigns/**` (288) · `features/goals/**` (208) → `locales/{en,tr}/customers.ts`; segment adları, filtre etiketleri, huni aşamaları, boş durumlar.
DOSYALAR: yukarıdaki dizinler · `locales/{en,tr}/customers.ts`.
ORTAK KURALLAR (tm 133'ün her sayfa alt-görevi için — 133.1 altyapıyı kurar, sen onu KULLAN):
- Katalog: `apps/web/src/locales/{en,tr}/<ad-alanı>.ts` (133.1'in düzeni; anahtar biçimi
  `<sayfa>.<bölüm>.<anlam>`, değer değil anlam — "save" değil "actions.save"); `useTranslate()` →
  `t('inbox.list.empty')`; sayı/tarih/para `lib/format.ts` (locale'e bağlı; §D82 pinleme dersi —
  runtime locale'i ürün davranışına sızdırma; testler locale'i açıkça kurar).
- Türkçe metinler GERÇEK çeviri (makine-kalitesinde değil): kısa, ürün dili tutarlı ("Sohbet",
  "Müşteri", "Takım", "Playbook" (özel ad), "Faturalama", "Ayarlar", "Raporlar", "Gelen kutusu");
  ⌘K/AppShell'in mevcut `tr` kataloğu (`lib/i18n.ts`) sözlük emsalidir.
- Testler: sayfanın mevcut `*.test.tsx`'leri metin arıyorsa (`getByText('Save')`) → anahtarla
  eşleşen İngilizce değer üzerinden ya da `t()`'nin test yardımcısıyla (133.1 sağlar) — assert
  sayısı AZALMAZ; +1 test: `tr` locale'de sayfanın en az bir sentinel metni Türkçe.
- 133.1'in nöbetçisi (`i18n-coverage.test.ts`) sayfa dosyanı "çevrilmiş" listesine ALIR — listeyi
  güncellemek bu alt-görevin işidir; nöbetçi ayrıca en/tr anahtar kümelerinin EŞİT olduğunu doğrular
  (eksik tr anahtarı kırmızı).
- `aria-label`/`title`/placeholder da çevrilir (a11y metinleri sabit İngilizce kalmasın).
- Kapsam dışı: sunucu tarafı metinler (hata mesajları ADR-06 `type`'ından istemcide çevrilir —
  `lib/api-client.ts`'in hata eşlemesi 133.1'de) · e-posta şablonları · widget (133.13).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **NFR-I18N2 panel i18n (+ I18N1 widget · I18N5 yerelleştirme)**. Gereksinim satırı: `grep -n '| I18N1/2' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KI18N1-2' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 133.5. I18N-e [SONNET-XHIGH] Team + Home + Notifications ayarları bileşenleri

**Status:** done  
**Dependencies:** 133.1  

Ekip, ana sayfa ve bildirim tercih metinleri katalogdan gelir.

**Details:**

NE YAPILACAK: `features/team/**` (TeamPage 494 + WorkSchedule + InviteTeammates + AgentSkills) · `features/home/**` (HomePage 251 + kartlar) · `features/notifications/**` → `locales/{en,tr}/{team,home}.ts`; rol adları, durum rozetleri, haftalık takvim gün adları (`Intl` ile), davet akışı metinleri.
DOSYALAR: yukarıdaki dizinler · `locales/{en,tr}/{team,home}.ts`.
ORTAK KURALLAR (tm 133'ün her sayfa alt-görevi için — 133.1 altyapıyı kurar, sen onu KULLAN):
- Katalog: `apps/web/src/locales/{en,tr}/<ad-alanı>.ts` (133.1'in düzeni; anahtar biçimi
  `<sayfa>.<bölüm>.<anlam>`, değer değil anlam — "save" değil "actions.save"); `useTranslate()` →
  `t('inbox.list.empty')`; sayı/tarih/para `lib/format.ts` (locale'e bağlı; §D82 pinleme dersi —
  runtime locale'i ürün davranışına sızdırma; testler locale'i açıkça kurar).
- Türkçe metinler GERÇEK çeviri (makine-kalitesinde değil): kısa, ürün dili tutarlı ("Sohbet",
  "Müşteri", "Takım", "Playbook" (özel ad), "Faturalama", "Ayarlar", "Raporlar", "Gelen kutusu");
  ⌘K/AppShell'in mevcut `tr` kataloğu (`lib/i18n.ts`) sözlük emsalidir.
- Testler: sayfanın mevcut `*.test.tsx`'leri metin arıyorsa (`getByText('Save')`) → anahtarla
  eşleşen İngilizce değer üzerinden ya da `t()`'nin test yardımcısıyla (133.1 sağlar) — assert
  sayısı AZALMAZ; +1 test: `tr` locale'de sayfanın en az bir sentinel metni Türkçe.
- 133.1'in nöbetçisi (`i18n-coverage.test.ts`) sayfa dosyanı "çevrilmiş" listesine ALIR — listeyi
  güncellemek bu alt-görevin işidir; nöbetçi ayrıca en/tr anahtar kümelerinin EŞİT olduğunu doğrular
  (eksik tr anahtarı kırmızı).
- `aria-label`/`title`/placeholder da çevrilir (a11y metinleri sabit İngilizce kalmasın).
- Kapsam dışı: sunucu tarafı metinler (hata mesajları ADR-06 `type`'ından istemcide çevrilir —
  `lib/api-client.ts`'in hata eşlemesi 133.1'de) · e-posta şablonları · widget (133.13).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **NFR-I18N2 panel i18n (+ I18N1 widget · I18N5 yerelleştirme)**. Gereksinim satırı: `grep -n '| I18N1/2' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KI18N1-2' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 133.6. I18N-f [SONNET-MAX] Reports (ReportsPage 2317 satır: on sekme, KPI kartları, export/schedule, reviews, topics, benchmark)

**Status:** done  
**Dependencies:** 133.1  

Raporlar yüzeyi katalogdan gelir; sayı/tarih biçimleri locale’e bağlı.

**Details:**

NE YAPILACAK: `features/reports/**` → `locales/{en,tr}/reports.ts`; sekme adları, KPI etiketleri, düşük-baz uyarısı, SLA hedefsiz "—", export/PDF/zamanlanmış rapor formları, reviews/topics/benchmark metinleri; `lib/format.ts` üzerinden sayı/yüzde/süre (sabit "%"/"ms" ekleri de çevrilebilir yapıda). Büyük dosya — mekanik ama geniş: SONNET-MAX.
DOSYALAR: `features/reports/*.tsx` · `locales/{en,tr}/reports.ts`.
ORTAK KURALLAR (tm 133'ün her sayfa alt-görevi için — 133.1 altyapıyı kurar, sen onu KULLAN):
- Katalog: `apps/web/src/locales/{en,tr}/<ad-alanı>.ts` (133.1'in düzeni; anahtar biçimi
  `<sayfa>.<bölüm>.<anlam>`, değer değil anlam — "save" değil "actions.save"); `useTranslate()` →
  `t('inbox.list.empty')`; sayı/tarih/para `lib/format.ts` (locale'e bağlı; §D82 pinleme dersi —
  runtime locale'i ürün davranışına sızdırma; testler locale'i açıkça kurar).
- Türkçe metinler GERÇEK çeviri (makine-kalitesinde değil): kısa, ürün dili tutarlı ("Sohbet",
  "Müşteri", "Takım", "Playbook" (özel ad), "Faturalama", "Ayarlar", "Raporlar", "Gelen kutusu");
  ⌘K/AppShell'in mevcut `tr` kataloğu (`lib/i18n.ts`) sözlük emsalidir.
- Testler: sayfanın mevcut `*.test.tsx`'leri metin arıyorsa (`getByText('Save')`) → anahtarla
  eşleşen İngilizce değer üzerinden ya da `t()`'nin test yardımcısıyla (133.1 sağlar) — assert
  sayısı AZALMAZ; +1 test: `tr` locale'de sayfanın en az bir sentinel metni Türkçe.
- 133.1'in nöbetçisi (`i18n-coverage.test.ts`) sayfa dosyanı "çevrilmiş" listesine ALIR — listeyi
  güncellemek bu alt-görevin işidir; nöbetçi ayrıca en/tr anahtar kümelerinin EŞİT olduğunu doğrular
  (eksik tr anahtarı kırmızı).
- `aria-label`/`title`/placeholder da çevrilir (a11y metinleri sabit İngilizce kalmasın).
- Kapsam dışı: sunucu tarafı metinler (hata mesajları ADR-06 `type`'ından istemcide çevrilir —
  `lib/api-client.ts`'in hata eşlemesi 133.1'de) · e-posta şablonları · widget (133.13).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **NFR-I18N2 panel i18n (+ I18N1 widget · I18N5 yerelleştirme)**. Gereksinim satırı: `grep -n '| I18N1/2' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KI18N1-2' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 133.7. I18N-g [SONNET-XHIGH] Billing (BillingPage 1205 satır: plan/koltuk/döngü, AI resolutions meter, API paketleri, faturalar, ödeme yöntemi MOCK, entitlements)

**Status:** done  
**Dependencies:** 133.1  

Faturalama yüzeyi katalogdan gelir; para biçimi locale’e bağlı.

**Details:**

NE YAPILACAK: `features/billing/**` → `locales/{en,tr}/billing.ts`; "No card is charged" gibi MOCK açıklamaları da çevrilir (dürüstlük metni kaybolmaz); para/tarih `lib/format.ts`.
DOSYALAR: `features/billing/*.tsx` · `locales/{en,tr}/billing.ts`.
ORTAK KURALLAR (tm 133'ün her sayfa alt-görevi için — 133.1 altyapıyı kurar, sen onu KULLAN):
- Katalog: `apps/web/src/locales/{en,tr}/<ad-alanı>.ts` (133.1'in düzeni; anahtar biçimi
  `<sayfa>.<bölüm>.<anlam>`, değer değil anlam — "save" değil "actions.save"); `useTranslate()` →
  `t('inbox.list.empty')`; sayı/tarih/para `lib/format.ts` (locale'e bağlı; §D82 pinleme dersi —
  runtime locale'i ürün davranışına sızdırma; testler locale'i açıkça kurar).
- Türkçe metinler GERÇEK çeviri (makine-kalitesinde değil): kısa, ürün dili tutarlı ("Sohbet",
  "Müşteri", "Takım", "Playbook" (özel ad), "Faturalama", "Ayarlar", "Raporlar", "Gelen kutusu");
  ⌘K/AppShell'in mevcut `tr` kataloğu (`lib/i18n.ts`) sözlük emsalidir.
- Testler: sayfanın mevcut `*.test.tsx`'leri metin arıyorsa (`getByText('Save')`) → anahtarla
  eşleşen İngilizce değer üzerinden ya da `t()`'nin test yardımcısıyla (133.1 sağlar) — assert
  sayısı AZALMAZ; +1 test: `tr` locale'de sayfanın en az bir sentinel metni Türkçe.
- 133.1'in nöbetçisi (`i18n-coverage.test.ts`) sayfa dosyanı "çevrilmiş" listesine ALIR — listeyi
  güncellemek bu alt-görevin işidir; nöbetçi ayrıca en/tr anahtar kümelerinin EŞİT olduğunu doğrular
  (eksik tr anahtarı kırmızı).
- `aria-label`/`title`/placeholder da çevrilir (a11y metinleri sabit İngilizce kalmasın).
- Kapsam dışı: sunucu tarafı metinler (hata mesajları ADR-06 `type`'ından istemcide çevrilir —
  `lib/api-client.ts`'in hata eşlemesi 133.1'de) · e-posta şablonları · widget (133.13).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **NFR-I18N2 panel i18n (+ I18N1 widget · I18N5 yerelleştirme)**. Gereksinim satırı: `grep -n '| I18N1/2' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KI18N1-2' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 133.8. I18N-h [SONNET-XHIGH] Playbook (PlaybookPage 910 + SkillEditor + TemplateGallery + RecommendedSkills + Knowledge paneli + AI Agent profil/performans)

**Status:** done  
**Dependencies:** 133.1  

Playbook/AI yüzeyi katalogdan gelir.

**Details:**

NE YAPILACAK: `features/playbook/**` → `locales/{en,tr}/playbook.ts`; adım tipleri, şablon kategori adları (katalog verisi `@siyahtus/types`'taysa oradaki İngilizce başlık KALIR — veri; UI etiketleri çevrilir), knowledge alt sekmeleri, crawl durumları, profil/performans kartları.
DOSYALAR: `features/playbook/*.tsx` · `locales/{en,tr}/playbook.ts`.
ORTAK KURALLAR (tm 133'ün her sayfa alt-görevi için — 133.1 altyapıyı kurar, sen onu KULLAN):
- Katalog: `apps/web/src/locales/{en,tr}/<ad-alanı>.ts` (133.1'in düzeni; anahtar biçimi
  `<sayfa>.<bölüm>.<anlam>`, değer değil anlam — "save" değil "actions.save"); `useTranslate()` →
  `t('inbox.list.empty')`; sayı/tarih/para `lib/format.ts` (locale'e bağlı; §D82 pinleme dersi —
  runtime locale'i ürün davranışına sızdırma; testler locale'i açıkça kurar).
- Türkçe metinler GERÇEK çeviri (makine-kalitesinde değil): kısa, ürün dili tutarlı ("Sohbet",
  "Müşteri", "Takım", "Playbook" (özel ad), "Faturalama", "Ayarlar", "Raporlar", "Gelen kutusu");
  ⌘K/AppShell'in mevcut `tr` kataloğu (`lib/i18n.ts`) sözlük emsalidir.
- Testler: sayfanın mevcut `*.test.tsx`'leri metin arıyorsa (`getByText('Save')`) → anahtarla
  eşleşen İngilizce değer üzerinden ya da `t()`'nin test yardımcısıyla (133.1 sağlar) — assert
  sayısı AZALMAZ; +1 test: `tr` locale'de sayfanın en az bir sentinel metni Türkçe.
- 133.1'in nöbetçisi (`i18n-coverage.test.ts`) sayfa dosyanı "çevrilmiş" listesine ALIR — listeyi
  güncellemek bu alt-görevin işidir; nöbetçi ayrıca en/tr anahtar kümelerinin EŞİT olduğunu doğrular
  (eksik tr anahtarı kırmızı).
- `aria-label`/`title`/placeholder da çevrilir (a11y metinleri sabit İngilizce kalmasın).
- Kapsam dışı: sunucu tarafı metinler (hata mesajları ADR-06 `type`'ından istemcide çevrilir —
  `lib/api-client.ts`'in hata eşlemesi 133.1'de) · e-posta şablonları · widget (133.13).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **NFR-I18N2 panel i18n (+ I18N1 widget · I18N5 yerelleştirme)**. Gereksinim satırı: `grep -n '| I18N1/2' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KI18N1-2' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 133.9. I18N-i [SONNET-MAX] Settings — 1. yarı: SettingsPage iskeleti + Channels + Website widgets + Tags/Canned/Custom fields/Forms + Chat timeout/Transcripts/Templates

**Status:** done  
**Dependencies:** 133.1  

Ayarların ilk yarısı katalogdan gelir.

**Details:**

NE YAPILACAK: `features/settings/{SettingsPage.tsx (2235 satır — bölümlerin İLK yarısı: iskelet + inbox araçları + kanallar), Channels.tsx, WebsiteWidgets*, Tags*, Canned*, Forms*, ...}` → `locales/{en,tr}/settings.ts`; ikinci yarı 133.10 — SettingsPage'i iki alt-görev paylaşacağı için ÖNCE bölüm listesini çıkar ve HANDOFF'a hangi bölümlerin bu turda çevrildiğini yaz (133.10 oradan devam eder). "Coming soon / Get notified" kart metinleri (tm 135 kaldırana kadar) da çevrilir.
DOSYALAR: `features/settings/*.tsx` (ilk yarı) · `locales/{en,tr}/settings.ts`.
ORTAK KURALLAR (tm 133'ün her sayfa alt-görevi için — 133.1 altyapıyı kurar, sen onu KULLAN):
- Katalog: `apps/web/src/locales/{en,tr}/<ad-alanı>.ts` (133.1'in düzeni; anahtar biçimi
  `<sayfa>.<bölüm>.<anlam>`, değer değil anlam — "save" değil "actions.save"); `useTranslate()` →
  `t('inbox.list.empty')`; sayı/tarih/para `lib/format.ts` (locale'e bağlı; §D82 pinleme dersi —
  runtime locale'i ürün davranışına sızdırma; testler locale'i açıkça kurar).
- Türkçe metinler GERÇEK çeviri (makine-kalitesinde değil): kısa, ürün dili tutarlı ("Sohbet",
  "Müşteri", "Takım", "Playbook" (özel ad), "Faturalama", "Ayarlar", "Raporlar", "Gelen kutusu");
  ⌘K/AppShell'in mevcut `tr` kataloğu (`lib/i18n.ts`) sözlük emsalidir.
- Testler: sayfanın mevcut `*.test.tsx`'leri metin arıyorsa (`getByText('Save')`) → anahtarla
  eşleşen İngilizce değer üzerinden ya da `t()`'nin test yardımcısıyla (133.1 sağlar) — assert
  sayısı AZALMAZ; +1 test: `tr` locale'de sayfanın en az bir sentinel metni Türkçe.
- 133.1'in nöbetçisi (`i18n-coverage.test.ts`) sayfa dosyanı "çevrilmiş" listesine ALIR — listeyi
  güncellemek bu alt-görevin işidir; nöbetçi ayrıca en/tr anahtar kümelerinin EŞİT olduğunu doğrular
  (eksik tr anahtarı kırmızı).
- `aria-label`/`title`/placeholder da çevrilir (a11y metinleri sabit İngilizce kalmasın).
- Kapsam dışı: sunucu tarafı metinler (hata mesajları ADR-06 `type`'ından istemcide çevrilir —
  `lib/api-client.ts`'in hata eşlemesi 133.1'de) · e-posta şablonları · widget (133.13).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **NFR-I18N2 panel i18n (+ I18N1 widget · I18N5 yerelleştirme)**. Gereksinim satırı: `grep -n '| I18N1/2' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KI18N1-2' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 133.10. I18N-j [SONNET-MAX] Settings — 2. yarı: Security (SSO/SCIM/IP allowlist/HIPAA/SIEM/audit) + Sandbox + White-label + SLA + Sales tracker + Brands + Webhooks/PAT + AuditLogPage

**Status:** done  
**Dependencies:** 133.1, 133.9  

Ayarların ikinci yarısı + audit log ekranı katalogdan gelir.

**Details:**

NE YAPILACAK: `features/settings/*` kalan bölümler (133.9'un HANDOFF listesinden devam) + `features/audit/AuditLogPage.tsx` (362) → `locales/{en,tr}/settings.ts` (aynı dosyaya ekle) + `audit.ts`; güvenlik ekranlarının uyarı metinleri (break-glass, SSO zorunlu kılma) anlam kaybetmeden çevrilir.
DOSYALAR: `features/settings/*.tsx` (ikinci yarı) · `features/audit/*.tsx` · `locales/{en,tr}/{settings,audit}.ts`.
ORTAK KURALLAR (tm 133'ün her sayfa alt-görevi için — 133.1 altyapıyı kurar, sen onu KULLAN):
- Katalog: `apps/web/src/locales/{en,tr}/<ad-alanı>.ts` (133.1'in düzeni; anahtar biçimi
  `<sayfa>.<bölüm>.<anlam>`, değer değil anlam — "save" değil "actions.save"); `useTranslate()` →
  `t('inbox.list.empty')`; sayı/tarih/para `lib/format.ts` (locale'e bağlı; §D82 pinleme dersi —
  runtime locale'i ürün davranışına sızdırma; testler locale'i açıkça kurar).
- Türkçe metinler GERÇEK çeviri (makine-kalitesinde değil): kısa, ürün dili tutarlı ("Sohbet",
  "Müşteri", "Takım", "Playbook" (özel ad), "Faturalama", "Ayarlar", "Raporlar", "Gelen kutusu");
  ⌘K/AppShell'in mevcut `tr` kataloğu (`lib/i18n.ts`) sözlük emsalidir.
- Testler: sayfanın mevcut `*.test.tsx`'leri metin arıyorsa (`getByText('Save')`) → anahtarla
  eşleşen İngilizce değer üzerinden ya da `t()`'nin test yardımcısıyla (133.1 sağlar) — assert
  sayısı AZALMAZ; +1 test: `tr` locale'de sayfanın en az bir sentinel metni Türkçe.
- 133.1'in nöbetçisi (`i18n-coverage.test.ts`) sayfa dosyanı "çevrilmiş" listesine ALIR — listeyi
  güncellemek bu alt-görevin işidir; nöbetçi ayrıca en/tr anahtar kümelerinin EŞİT olduğunu doğrular
  (eksik tr anahtarı kırmızı).
- `aria-label`/`title`/placeholder da çevrilir (a11y metinleri sabit İngilizce kalmasın).
- Kapsam dışı: sunucu tarafı metinler (hata mesajları ADR-06 `type`'ından istemcide çevrilir —
  `lib/api-client.ts`'in hata eşlemesi 133.1'de) · e-posta şablonları · widget (133.13).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **NFR-I18N2 panel i18n (+ I18N1 widget · I18N5 yerelleştirme)**. Gereksinim satırı: `grep -n '| I18N1/2' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KI18N1-2' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 133.11. I18N-k [SONNET-XHIGH] Apps marketplace + Developer portal (+ katalog verisindeki İngilizce açıklamalar için karar)

**Status:** done  
**Dependencies:** 133.1  

Apps ve developers yüzeyleri katalogdan gelir.

**Details:**

NE YAPILACAK: `features/apps/**` (AppsMarketplace 505) · `features/developers/**` (DeveloperPortal 669) → `locales/{en,tr}/apps.ts`; `APP_CATALOG` (102 kalem, `packages/types/src/apps.ts`) açıklamaları VERİDİR — çevrilmez, UI etiketleri (kategori adları, filtreler, "Install", OAuth mock açıklaması) çevrilir; kararı K bloğuna yaz.
DOSYALAR: iki dizin · `locales/{en,tr}/apps.ts`.
ORTAK KURALLAR (tm 133'ün her sayfa alt-görevi için — 133.1 altyapıyı kurar, sen onu KULLAN):
- Katalog: `apps/web/src/locales/{en,tr}/<ad-alanı>.ts` (133.1'in düzeni; anahtar biçimi
  `<sayfa>.<bölüm>.<anlam>`, değer değil anlam — "save" değil "actions.save"); `useTranslate()` →
  `t('inbox.list.empty')`; sayı/tarih/para `lib/format.ts` (locale'e bağlı; §D82 pinleme dersi —
  runtime locale'i ürün davranışına sızdırma; testler locale'i açıkça kurar).
- Türkçe metinler GERÇEK çeviri (makine-kalitesinde değil): kısa, ürün dili tutarlı ("Sohbet",
  "Müşteri", "Takım", "Playbook" (özel ad), "Faturalama", "Ayarlar", "Raporlar", "Gelen kutusu");
  ⌘K/AppShell'in mevcut `tr` kataloğu (`lib/i18n.ts`) sözlük emsalidir.
- Testler: sayfanın mevcut `*.test.tsx`'leri metin arıyorsa (`getByText('Save')`) → anahtarla
  eşleşen İngilizce değer üzerinden ya da `t()`'nin test yardımcısıyla (133.1 sağlar) — assert
  sayısı AZALMAZ; +1 test: `tr` locale'de sayfanın en az bir sentinel metni Türkçe.
- 133.1'in nöbetçisi (`i18n-coverage.test.ts`) sayfa dosyanı "çevrilmiş" listesine ALIR — listeyi
  güncellemek bu alt-görevin işidir; nöbetçi ayrıca en/tr anahtar kümelerinin EŞİT olduğunu doğrular
  (eksik tr anahtarı kırmızı).
- `aria-label`/`title`/placeholder da çevrilir (a11y metinleri sabit İngilizce kalmasın).
- Kapsam dışı: sunucu tarafı metinler (hata mesajları ADR-06 `type`'ından istemcide çevrilir —
  `lib/api-client.ts`'in hata eşlemesi 133.1'de) · e-posta şablonları · widget (133.13).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **NFR-I18N2 panel i18n (+ I18N1 widget · I18N5 yerelleştirme)**. Gereksinim satırı: `grep -n '| I18N1/2' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KI18N1-2' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 133.12. I18N-l [OPUS-XHIGH] Uçtan uca kanıt: e2e i18n.spec.ts — dil değiştir → her rotada Türkçe sentinel + kanıt PNG; nöbetçi "kalan 0"; PLAN satırı ✅

**Status:** done  
**Dependencies:** 133.1, 133.2, 133.3, 133.4, 133.5, 133.6, 133.7, 133.8, 133.9, 133.10, 133.11  

Dil değiştiricinin bütün konsolu çevirdiğini Playwright kanıtlar; NFR-I18N2 satırı kapanır.

**Details:**

NE YAPILACAK: `apps/e2e/tests/i18n.spec.ts`: giriş → AppShell dil değiştirici → `tr` → 20 rotanın her birinde en az bir Türkçe sentinel (`getByText`) ve **hiç** bilinen İngilizce sentinel yok (her sayfa için bir çift) → `apps/e2e/kanit/i18n-*.png` (koyu tema, mevcut kanıt seti gibi) → geri `en`; ayrıca localStorage'da tercih kalıcı (yeniden yükle → tr). Nöbetçi `i18n-coverage.test.ts` "kalan 0" (tüm sayfa dosyaları listede) — değilse eksik alt-görevi bul, bu turda küçükse tamamla, büyükse blocked bırak. PLAN §7.2 `I18N1/2` → `✅ → KI18N1-2` (widget 45+ dil hedefi 133.13'ün notuyla dürüstçe); K bloğuna özet + rota listesi.
DOSYALAR: `apps/e2e/tests/i18n.spec.ts` · `apps/e2e/kanit/i18n-*.png` · PLAN.md.
REFERANS: `apps/e2e/tests/a11y.spec.ts` (rota listesi + iki tema deseni) · `fixtures.ts` signIn.
KAPSAM DIŞI: widget (133.13).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **NFR-I18N2 panel i18n (+ I18N1 widget · I18N5 yerelleştirme)**. Gereksinim satırı: `grep -n '| I18N1/2' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KI18N1-2' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 133.13. I18N-m [SONNET-MAX] Widget çok-dil + RTL mekanizması: katalog düzeni + en/tr/de/fr/es/it/pt/ar (RTL) + dir="rtl" düzeni + i18n testi + "45+ dil" hedefinin dürüst kaydı

**Status:** done  
**Dependencies:** 133.1  

Widget çevirilerini genişleten mekanizma + RTL; hedef sayısı dürüstçe kaydedilir.

**Details:**

NE YAPILACAK: `apps/widget/src/i18n.ts` (54 anahtar, en/tr) → katalog dizini `apps/widget/src/locales/<lang>.ts`, `data-language` ile seçim aynen; 6 yeni dil (de/fr/es/it/pt/ar — kısa arayüz metinleri; `ar` için `dir="rtl"` iframe belgesi + CSS mantıksal özellikler (`margin-inline`, `inset-inline`) — düzen testi); bilinmeyen dil → `en` fallback (mevcut); bundle bütçesi (NFR-P3 5.3 KB gzip → katalog artışıyla ölç, 50 KB altı) — kataloglar lazy değil (küçük). NFR-I18N1 "45+ dil": mekanizma + 8 dil teslim; kalan diller VERİ girişidir, K bloğuna "45+ hedefi katalog genişletmesiyle karşılanır; bu turda 8" diye dürüstçe yazılır (satır `✅`'i panel i18n içindir, widget dili notlu).
DOSYALAR: `apps/widget/src/{i18n.ts, locales/*.ts, widget.ts (dir), styles}` · testler (`i18n.test.ts` +RTL).
REFERANS: `apps/widget/src/i18n.ts` createTranslator · KI18N1-2 bundle ölçümü.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **NFR-I18N2 panel i18n (+ I18N1 widget · I18N5 yerelleştirme)**. Gereksinim satırı: `grep -n '| I18N1/2' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KI18N1-2' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
