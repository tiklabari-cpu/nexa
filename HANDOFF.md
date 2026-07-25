# HANDOFF — Nexa

**Date:** 2026-07-25 · **Branch:** `main` (Dilim 14 merge edildi) · **Remote:** https://github.com/tiklabari-cpu/nexa

---

## Task log (newest-first)

### 29.3 — EK-A T5-a Yarım-form kapatma onayı + ortak davranış — done — 2026-07-25T17:22Z UTC
- Yapıldı:
  - **Dirty guard** (`lib/dirty-guard.tsx`): saf `confirmDiscard(isDirty, message?, confirm?)` +
    `useCloseGuard({isDirty,onClose,message?,confirm?})`. Kirli form kapatma → onay; temiz form
    onaysız kapanır. Confirmer enjekte edilebilir (test için). InviteTeammates modalındaki elle
    `window.confirm` bloğu bu primitife taşındı — artık tek kaynak (FR-EK-A.2).
  - **Optimistic + rollback** (`lib/optimistic.ts`): `optimisticCacheUpdate({queryClient,queryKey,
    update,invalidateKeys?})` → `{onMutate,onError,onSettled}`. cancel→snapshot→guess→hata'da
    rollback→settle'da invalidate deseni tek yerde. İki tüketici: `useInbox.useSendMessage`
    (elle yazılmış optimistic dance yerine helper) + `SettingsPage` routing-rule `toggle`
    (artık optimistic; hata'da geri döner). "Tutarlı davranış; optimistic + hata geri alma" KK ✅.
  - **Stepper** (`lib/stepper.ts`): `useStepper(count)` → index + clamp'li next/back/goTo + isFirst/
    isLast. OnboardingWizard elle `stepIndex` state'i bu hook'a taşındı; sınır aşımı imkânsız.
  - **Kapsam kararı**: ayrı "dropdown wrapper" YAZILMADI — native `<select>`'ler zaten tutarlı,
    tekilleştirilecek tekrar yok (form.tsx felsefesi: gereksiz soyutlamadan kaçın). Notlandı.
- Doğrulama (hepsi yeşil): `pnpm -w typecheck` (11 pkg) · `pnpm -w lint` (8 pkg) ·
  web unit 140 (14 yeni: dirty-guard 6, optimistic 3, stepper 5) · api unit+integration 594 ·
  `pnpm -w test:integration` 505 · `pnpm -w build` (7 pkg) · e2e 48/48 (yeni `team.spec.ts`:
  invite modal yarım-doldur→kapat→onay + temiz modal onaysız kapanır).
- Varsayımlar: `pnpm -w test` (birleşik) api+e2e'yi paylaşılan Postgres'e paralel sürdüğü için
  yarışıp kırmızı verir (bilinen harness artefaktı, kod değil) → DB suite'leri per-package/serial
  koştum, ikisi de yeşil. E2E dev-server'ları RTM env'i process'ten okuduğu için kök `.env`
  export edilerek koşuldu.
- Sonraki pencereye not: EK-A (parent 29) tamamlandı — 29.1+29.2+29.3 done. v1 form görevleri
  (47/50/51/52/43 — Forms builder, Custom fields) bu üç primitife (useForm + dirty-guard +
  optimistic + stepper) dayanabilir.

### 29.2 — EK-A T4-b Kalan Must formlarını primitife taşı — done — 2026-07-25 UTC
- Yapıldı:
  - **Auth formları** (`features/auth/PublicPages.tsx`): SignUp / ForgotPassword / ResetPassword /
    Join → elle `valid` boolean + `email.includes('@')` kaldırıldı, hepsi `useForm` primitifine
    taşındı. Ortak `Field` helper'ı alan-altı hata + `aria-invalid`/`aria-describedby` gösterecek
    şekilde genişletildi; `Submit` prop'u `busy`→`disabled`. Server-hata haritaları korundu
    (account_exists, enumeration-safe forgot).
  - **Sign-in** (`features/auth/SignInPage.tsx`): email/parola `useForm` (email = required+email,
    parola = required); geçersizken "Sign in" pasif, alan-altı hata. İki-adım (workspace seçimi)
    korundu; choose hatası artık adım-2'de de görünüyor.
  - **Settings** (`features/settings/SettingsPage.tsx`): New canned (shortcut+text) ve New tag
    (name) → `useForm({required})`; başarıda `form.reset()` alanları temizler. `CannedResponses`
    ve `Tags` test için `export` edildi.
  - **Kapsam dışı bırakıldı (gerekçeli):** Payment mock = `disabled` inputlar (ADR-13, hiçbir şey
    toplanmıyor → doğrulanacak alan yok); Channels grid = "ekle" formu zaten 29.1 pilotu (Website).
    TrustedDomains = `domain()` katı validatörü "pasted URL → hostname" E2E'sini kırardı → elle bırakıldı.
  - **Testler:** `PublicPages.test.tsx` (SignUp/Reset/Forgot validasyon), `SignInPage.test.tsx`,
    `settings/SettingsForms.test.tsx` (canned+tag: submit-disabled + alan-altı hata). +9 unit.
- Doğrulama (DoD kapısı tam yeşil): typecheck ✅ · lint ✅ · unit ✅ (web 126, api 89) ·
  integration ✅ (api 505, rtm 42) · build ✅ · **E2E tam suite 46/46** ✅ (signup/sign-in/canned/
  tags/payment/channels dahil). Not: rtm integration tek seferlik stateful flake verdi
  (`rtm.test.ts:290` thread-id çakışması, 3-günlük DB birikimi) — izole + temiz koşuda 42/42 geçti,
  frontend değişikliğiyle alakasız.
- Varsayımlar: Sign-in + Join enumerasyona ek olarak taşındı (enumere listede yoktu ama "kalan Must
  form" kapsamında; tek form katmanı hedefi). Auth email validatörü artık katı (regex) — in-app
  oluşturulan tüm hesaplar zaten regex-geçerli.
- Sonraki pencereye not: **29.3** (T5-a) hazır — dirty-guard + ortak dropdown/stepper/optimistic
  tekilleştirme; `form.isDirty` primitifte mevcut. Invite modalı zaten `isDirty` dirty-guard'ı
  kullanıyor (29.1); 29.3 bunu ortak bir sarmalayıcıya çıkarıp diğer modallara yayacak.

### 29.1 — EK-A T4-a Ortak form-validasyon primitifi + 2 pilot form — done — 2026-07-25 UTC
- Yapıldı:
  - **Tek primitif:** `apps/web/src/lib/form.tsx` — bağımlılıksız `useForm` hook + validatörler
    (`required`, `email`, `emailList`, `domain`, `minLength`, `compose`, `splitList`) + `FieldError`
    bileşeni. Frontend'de `zod` yok (web `package.json`'da bağımlı değil, lock churn riski) → KK
    "tek form/validasyon kütüphanesi" için hafif yerli şema tercih edildi. Hook: alan-altı hata
    (touched/submit sonrası görünür), geçersizken `canSubmit=false`, `isSubmitting` (Loading),
    server-hata → `setFieldError`/`setSubmitError`, `isDirty` (29.3 dirty-guard için hazır).
  - **Pilot 1 — Invite teammates** (`features/team/InviteTeammates.tsx`): elle `parseEmails` +
    `invalid[]` + `error` state'leri kaldırıldı → `useForm({emails: emailList()})`. Geçersiz adres →
    alan-altı hata (`role="alert"` FieldError), geçersizken "Invite" pasif. Server `invalid_emails`/
    `authorization` haritalaması korundu (helper'lar). Yarım-form kapatma onayı `form.isDirty`'ye bağlı.
  - **Pilot 2 — Add website** (`features/settings/WebsiteWidgets.tsx`): `domain` state →
    `useForm({domain: compose(required, domainRule)})`. Alan-altı hata + "Add website" geçersizken pasif.
    `domain` validatörü `.localhost`/tireli/rakamlı label'ları kabul eder (E2E dev-domain regresyonu).
  - **Backend/kontrat DEĞİŞMEDİ** — yalnız `apps/web/src` (6 dosya). api/rtm kaynağı el değmedi.
- Doğrulama (hepsi exit 0): `pnpm -w typecheck` ✅ (11/11) · `pnpm -w lint` ✅ (8/8) ·
  `pnpm -w build` ✅ (7/7) · web unit **117** (98→117, +19: `form.test.tsx` 13 = validatör+hook,
  `InviteTeammates.test.tsx` 3, `WebsiteWidgets.test.tsx` 3 — her pilotta "geçersiz→alan-altı hata+
  submit pasif" ve "geçerli→submit aktif") ✅ · E2E `settings.spec -g "site goes Connected"`
  **1 passed** (değişen Add-website akışı uçtan uca; `.env` export şart) ✅.
- Varsayımlar: `zod` yerine yerli primitif (KK "hafif hook/şema"yı açıkça izin veriyor; lock churn'den
  kaçınıldı) — 29.2/29.3 + v1 form görevleri (47/50/51/52/43) bu `useForm`/validatör API'sine dayanır.
  Invite'ta geçersiz satır artık submit'i tümden pasifleştirir (KK "geçersizken submit pasif" > eski
  "kısmi kabul" felsefesi); server yine güvenlik ağı. Select'ler (role/setup) validasyonsuz → form dışı
  local state.
- Sonraki pencereye not: 29.2 (kalan Must formları) ve 29.3 (dirty-guard tekilleştirme) `lib/form.tsx`
  primitifine bağımlı — aynı API'yi kullan. E2E'den önce kök **`.env` export** (rtm self-load etmiyor):
  `set -a && . ./.env && set +a`. Task Master 29.1 diskte **done**; tasks.json bu commit'e alınmadı
  (dalın deseni: periyodik `chore(taskmaster)`). Integration suite koşulmadı — bu iş frontend-only,
  api/rtm kaynağı değişmedi (git diff = yalnız apps/web).

### 28 — 01.3 Sağ panel switcher (Details/Expand + persist) — done — 2026-07-25 UTC
- Yapıldı:
  - **Tercih deposu:** `apps/web/src/features/inbox/rightPanel.ts` — `nexa.inbox.right-panel`
    localStorage anahtarı (`'details' | 'expanded'`), `loadRightPanel`/`saveRightPanel` (safeStorage;
    bilinmeyen/bozuk değer → `'details'`) + `useRightPanel()` hook (lazy init = reload'da tercih
    okunur). i18n/notifications ile aynı `nexa.*` deseni; **backend/kontrat değişmedi** (§D22 MVP payı).
  - **InboxPage:** Details paneli yalnız `!expanded` iken render; expand modda transcript tam
    genişlik (`main` flex-1). Panel AÇIKKEN dar transcript header'ına buton EKLENMEZ — kapatma
    panelin kendi başlığındaki `⇥` ("Collapse details panel", `onCollapse`) ile; panel KAPALIYKEN
    geniş header'daki "Show details panel" geri getirir. (Header'a her koşulda buton koymak 1280px'de
    paneli aside'ın altına taşıyıp tıklamayı kesiyordu → iki bağlamlı kontrol, taşma yok.)
  - **DetailsPanel:** opsiyonel `onCollapse` prop + başlıkta collapse butonu (prop yoksa eski davranış).
- Doğrulama (hepsi exit 0): `pnpm -w typecheck` ✅ (11/11) · `pnpm -w lint` ✅ (8/8) ·
  `pnpm -w build` ✅ (7/7) · web unit **98** (+ yeni `rightPanel.test.tsx`: store + hook
  toggle/expand/reload) ✅ · `turbo run test --concurrency=1` api **594** ✅ ·
  `pnpm -w test:integration` api **505** ✅ · `pnpm --filter @nexa/e2e test inbox-panel` **1 passed**
  ✅ (aç/kapa + reload sonrası kalıcı; `kanit/28-panel-expanded.png`).
- Varsayımlar: tercih **cihaz-başı localStorage** (hesap tercihi değil) — ekran genişliği makineye
  ait, KK "localStorage/hesap" ikisini de kabul ediyor. Copilot sekmesi kapsam dışı (v1, tm 36).
- Sonraki pencereye not: E2E'den önce kök **`.env` export** şart (rtm kendi yüklemiyor; 27'deki notla
  aynı) → `set -a && . ./.env && set +a`. Task Master durumu diskte güncellendi ama bu commit'e
  alınmadı (dalın deseni: tm 27 status'u da uncommitted bırakılmıştı — periyodik `chore(taskmaster)`
  batch'liyor). **tm 36 (12.1-a Copilot)** T1-a üstüne oturur: `ShowDetailsButton`, üç-yollu
  Details/Copilot/Expand switcher'a dönüşecek.

### 27 — 02.4 Details paneli ziyaret bilgisi (Visited pages + Visit info) — done — 2026-07-25 UTC
- Yapıldı:
  - **27.1 (T3-a) Kontrat+Backend:** `Chat` yanıtına nullable `visitor` bloğu — yeni `ChatVisitor`
    şeması (`visited_pages[]` + `visit_info{device,referrer,duration_seconds,ip}`);
    `pnpm --filter @nexa/contract generate` ile `src/generated/api.ts` yenilendi. `ChatService.get`
    müşterinin **bu lisansa ait** en son ziyaretini chat'e bağlar (`#latestVisitor`): device =
    browser+os ("Chrome on macOS"), duration = ended−started (sn, null-güvenli), pages defansif
    ayrıştırılır. Ziyaret bloğu yalnız agent/bot principal'a döner — customer widget'a **hiç**
    (IP kişisel veri, NFR-S9). Cross-license IDOR negatifi dahil 4 yeni integration testi.
  - **27.2 (T3-b) UI:** `DetailsPanel.tsx`'e iki katlanır `<Section>` — "Visited pages" (path'e
    kısaltılmış, tam URL'e linkli, sıralı liste) + "Visit info" (Device/Referring/Duration/IP,
    boş alanlarda "Direct"/"—"); ziyaret yoksa anlamlı empty state (başlıklar gizlenmez). Web
    `ChatDetail` tipine `visitor` + yeni `DetailsPanel.test.tsx` (3 render senaryosu).
- Doğrulama (hepsi exit 0): `pnpm -w typecheck` ✅ · `pnpm -w lint` ✅ · `pnpm -w build` ✅ ·
  web 91 / widget 34 unit ✅ · `@nexa/api` 594 test (28 dosya, +4 "visitor context") ✅ ·
  `pnpm -w test:e2e` 45 passed ✅ (demo-flow'a ziyaret-bilgisi görünürlük iddiası eklendi).
- Varsayımlar: §C-A10 alanları (Device/Referring/Duration/IP) PRD Açıklama'sından türetildi;
  canlı süre WS push kapsam dışı (T3-b snapshot gösterir).
- Sonraki pencereye not: E2E'den önce kök **`.env` export edilmeli** (rtm kendi yüklemiyor) ve
  4000/4001/5173/5174'te bayat dev server bırakılmamalı — bayat api raised rate-limit taşımadığından
  widget.spec 429 verir (kapı düşer, kod değil).

### 21 — 07.1/07.3.1/07.3.3 Reports: Breakdown + AI Agent sekmeleri + vs-önceki dönem + Chats kartları — done — 2026-07-25 UTC
- Yapıldı:
  - **Kontrat** (`packages/contract/openapi/`): overview yanıtına `previous_period` (eşit-uzunluk
    önceki dönem: range + karşılaştırılabilir sayılar) + `chats` blogu (automated_per_hour,
    automated/total chat duration); iki yeni yol **`GET /reports/breakdown`** (ReportsBreakdown:
    by_day + by_agent split) ve **`GET /reports/ai-agent`** (ReportsAiAgent: resolutions/rate,
    transfers/rate, skill_runs, avg automated duration). `pnpm --filter @nexa/contract generate`
    ile bundle + `src/generated/api.ts` yenilendi.
  - **Backend** (`apps/api/src/routes/reports.ts`): sınıflandırma tek yerden — paylaşılan
    `AGENT_EVENT`/`SKILL_RUN`/`SPLIT_COUNTS` SQL fragmanları + `windowTotals`/`ticketCount`/
    `satisfactionCounts`/`satisfactionScore` yardımcıları (Overview/Breakdown/AI Agent aynı ADR-09
    otomatik tanımını paylaşır, drift edemez). Overview önceki dönemi (`from-1ms` bitişli, çakışmasız)
    hesaplayıp delta için döndürür; breakdown gün (UTC bucket) + ajan kırılımı; ai-agent transfer
    olayını (`properties @> {system_event: chat_transferred}`, GIN-dostu) + skill_runs sayar.
  - **Web** (`apps/web/src/features/reports/ReportsPage.tsx`): sol `role=tablist` sekmeler
    (Overview/AI Agent/Breakdown); range 7/30/90/**365** + **Custom** date picker (geçersiz/geriye
    aralık → boş durum, sorgu atılmaz); her Overview KPI'ında nötr **vs-önceki delta** rozeti
    (`Kpi`'a opsiyonel `delta` slotu eklendi — geriye dönük uyumlu); **Chats** bölümü kartları;
    AI Agent (resolution/deflection) + Breakdown (gün/ajan split tabloları) panelleri.
- Doğrulama (**tam kapı yeşil, exit 0**): `pnpm -w typecheck` (11/11) · `pnpm -w lint` (8/8) ·
  `pnpm -w build` (7/7; OpenAPI bundle spec-hatasız) · unit (web **88**, rtm **65**, api unit +
  widget/contract/types/ai-mock) · integration (**seri**, `turbo … --concurrency=1`) api **590**
  (yeni reports testleri: previous-period eşit-uzunluk delta, 365/custom range, breakdown split
  gün/ajan + toplam=closed, ai-agent=overview=fatura, transfer_rate, cross-tenant ×2; +
  **contract-parity** yeni 2 yolu doğruladı) · e2e reports **2/2** (tab gezinme + kanıt
  screenshot'ları `kanit/21-reports-ai-agent.png` + `kanit/21-reports-breakdown.png`). Task kabul
  kriteri (delta + custom range + breakdown + e2e sekme + kanıt) karşılandı.
- Varsayımlar: **07.5 Metrics breakdown**'un tam boyut kümesi (kanal/saat) v2; MVP payı gün+ajan
  split. AI Agent `transfer` metriği `chat_transferred` sistem olayını sayar (chat-service'in
  yazdığı şekil). Kanal boyutu şemada thread/chat'te yok → breakdown'a alınmadı.
- Sonraki pencereye not: **Faz-0 bakiyesi (tm 20–26) kapandı** (PLAN §3.6 07.1/07.3.1/07.3.3 ✅,
  §2 MOD-07 ✅). E2E **rate-limit uyarısı**: reused `:4000` api `.env`'den `RATE_LIMIT_ANON_PER_MIN=200`
  alır; **tüm** e2e suite'i tek seferde koşarsan sona doğru anon bucket dolar ve alâkasız
  widget/settings testleri login fixture'ında **429** verir (üründe hata değil — playwright config
  test sunucusunu 2000 ile başlatır ama reuse edince 200 kalır). İzole koşumda hepsi yeşil; kapı
  için ya taze api başlat ya seri/pencere-bekleyerek koş.

### 26.4 — I18N1/2 testler: t() fallback unit + locale smoke + widget boyut — done — 2026-07-25 UTC
- Yapıldı: 26.1–26.3 zaten fallback unit (panel `apps/web/src/lib/i18n.test.ts` + widget
  `apps/widget/src/i18n.test.ts`), panel locale-switch smoke (`i18n.smoke.test.tsx`) ve widget
  bundle-P3 boyut testini (`test/bundle-size.test.ts`) bırakmıştı. Tek eksik **widget mount-locale
  smoke**'tu: yeni `apps/widget/src/i18n.smoke.test.ts` (3 test) gerçek widget'ı jsdom'da
  `language=tr` ile mount edip görünür chrome'un (launcher `Sohbet`/aria `Sohbeti aç`, panel aria
  `Müşteri destek sohbeti`, başlık `Bizimle sohbet edin`, send `Gönder`) fiilen Türkçe geldiğini —
  ve İngilizce varsayılanın kaybolduğunu — kanıtlıyor; ayrıca dilsiz→İngilizce fallback ve
  bölge-etiketli `tr-TR`→tr çözümü. Bu, `data-language → readConfig → createTranslator → DOM`
  zincirini uçtan uca doğruluyor (panelin locale smoke'unun widget karşılığı; widget'ta runtime
  dil değiştirici yok, locale sayfa-yükü boyunca sabit). Kaynak koda dokunulmadı — yalnız test.
- Doğrulama (**tam kapı yeşil, exit 0**): `pnpm -w typecheck` (11/11) · `pnpm -w lint` (8/8) ·
  `pnpm -w build` (7/7; widget **7.57 KB gzip** ≪ 50 KB P3) · `pnpm -w test:unit` (web **88** +
  widget **34** = yeni `i18n.smoke.test.ts` 3 + mevcut `i18n.test.ts` 7 + `bundle-size` 2 [taze
  dist'e karşı **skip değil**] + `loader` 22) · `pnpm -w test:integration` (**seri** · api 22 dosya /
  **492**) · `make test-e2e` (**44/44**, 13 widget spec dâhil). Task kabul kriteri (fallback unit +
  locale smoke + widget boyut) karşılandı.
- Kapsam disiplini: **yalnız 2 dosya** commit'lendi (`apps/widget/src/i18n.smoke.test.ts` + PLAN.md
  §7.2 I18N ⬜→✅) + taskmaster durum. İlgisiz çalışma-ağacı değişiklikleri (CLAUDE.md/
  MASTER-PROMPT.md, kanit .png'leri, autorun/convention .md'leri, run-loop.sh) **staged edilmedi**.
- Varsayımlar: e2e'nin İngilizce metin iddiaları (ör. "Let's chat") etkilenmez — demo host sayfası
  `data-language` set etmez, varsayılan `en` çıktısı 26.3'ten bu yana bayt-özdeş. Bundle-P3 testinin
  gerçekten koşması için (skipIf dist yokken atlar) unit'ten önce `build` çalıştırıldı; kapı sırasında
  build zaten var.
- Sonraki pencereye not: **Parent 26 done** (tüm alt-görevler kapandı) ve **PLAN.md §7.2 I18N ✅**.
  i18n = katalog + tr/en (canlı/otomatik çeviri §9 kapsam dışı, kasıtlı). Panelde çevrilmemiş ekran
  metinleri hâlâ fallback ile İngilizce'ye düşer (iskelet + eksik-anahtar güvenliği tasarımı);
  ileride ekran-bazı katalog genişletmesi ayrı task olur.

### 26.3 — I18N1/2 widget string kataloglama (bundle bütçesi P3) — done — 2026-07-25 UTC
- Yapıldı: 26.1/26.2 pencerelerinden çalışma ağacında bekleyen `apps/widget/src/i18n.ts`
  iskeletini (tr/en düz katalog + `createTranslator`/`resolveWidgetLocale`, panelle aynı
  fallback zinciri: aktif locale → İngilizce → anahtar) **widget'ın görünür yüzeyine bağladım**.
  `widget.ts` — `mount()` içinde `createTranslator(config.language)` ile locale'e bir kez bağlanan
  `t()`; `buildUi(doc, t)` + tüm render kapanışları + `renderBubble`/`renderAttachment`'a geçirildi.
  Katalanan metinler: launcher (text/open/close), header title, durum (queue `{n}` interpolasyon /
  offline), hatalar (connect/upload/send), transcript/panel aria, composer (input placeholder/label,
  send, attach etiketleri), pre-chat (intro/name/email/emailLabel/submit), greeting (label/msg/chat/
  browse), attachment-alt. Dekoratif `×`/`📎` glyph'leri ve boş durum metni çevrilmez (a11y aria ile).
- Doğrulama (**tam kapı yeşil**): `pnpm -w typecheck` (11/11 · exit 0) · `pnpm -w lint` (8/8 · exit 0) ·
  `pnpm -w build` (7/7 · exit 0) · `pnpm -w test:unit` (10/10; widget **31** = yeni `i18n.test.ts` 7 +
  mevcut `bundle-size` 2 + `loader` 22, web 88) · `pnpm -w test:integration` (**seri** · api 22 dosya /
  **492**) · `make test-e2e` (**44/44**, 13 widget spec dâhil — greeting, "Let's chat" pre-chat, agent
  identity, ekler). **Bundle P3**: widget app **7.57 KB gzip** (20.53→22.80 KB raw / 6.76→7.57 KB gzip,
  +~0.8 KB), loader **1.18 KB gzip** (dokunulmadı) — ikisi de 50 KB bütçenin çok altında; taze dist'e
  karşı `test/bundle-size.test.ts` (`describe.skipIf`) yeşil.
- Kapsam disiplini: **yalnız 3 widget dosyası** commit'lendi (`i18n.ts`, `i18n.test.ts`, `widget.ts` ·
  `feat/widget-i18n` → main ff). İlgisiz çalışma-ağacı değişiklikleri (CLAUDE.md/MASTER-PROMPT.md,
  kanit .png'leri, autorun/convention .md'leri, run-loop.sh) **staged edilmedi**.
- Varsayımlar: İngilizce katalog değerleri eski sabit metinlerle **birebir aynı** → varsayılan (en)
  widget çıktısı bayt-özdeş, e2e'nin İngilizce metin iddiaları etkilenmez. `loader.ts`'in host-sayfa
  erişilebilirlik etiketleri ('Chat'/'Customer support chat') **İngilizce bırakıldı**: P3 bütçesi tam
  da loader'la ilgili, katalogu loader'a import etmek onu şişirir; widget'ın kendi panel etiketi
  ('Customer support chat') iframe içinde zaten çevrili. `data-language` → loader query → `readConfig`
  → `createTranslator` bağlantı yolu uçtan uca tam.
- Sonraki pencereye not: **26.4** (test genişletme) — widget için `createTranslator` fallback unit'i +
  `bundle-size` testi **artık var**; kalan = widget-**mount locale smoke** (tr ile mount → Türkçe metin
  görünür) istenirse. Parent **26** ancak 26.4 bitince done; o zaman `PLAN.md §7.2 I18N ⬜→✅` güncellenir
  (henüz **değil**). Widget locale'i sayfa-yükü boyunca sabit (site `data-language` seçer, değişmez) —
  panel gibi runtime dil değiştirici yok, gerekmiyor.

### 26.2 — I18N1/2 panel string kataloglama + Intl helper locale bağı — done — 2026-07-25 UTC
- Yapıldı: 26.1'in çekirdeğini panelin **görünür chrome'una** bağladım. `AppShell.tsx` — trial banner
  (`shell.trial.*` + `{days}`/`{s}` interpolasyon), abonelik linki, ikon rayı `aria-label`'i, hesap menüsü
  (ad/çıkış fallback) `t()`'ye taşındı; hesap menüsüne **dil değiştirici** (`<select>` → `useLocale().setLocale`)
  eklendi. `navigation.ts` — kırıcı değişim: `label` → **`labelKey`** (katalog anahtarı); ray ve komut paleti
  aynı anahtardan çözer (`RailButton key` de `item.to`'ya çekildi). `CommandPalette.tsx` — grup başlıkları,
  placeholder/aria, "Searching…/No matches", isimsiz ziyaretçi/visitor fallback'leri `t()`'ye taşındı, `t`
  useMemo bağımlılığına eklendi. `format.ts` locale bağı zaten 26.1'de (title'ın 2. yarısı) tamam.
- Doğrulama (**tam kapı yeşil**): `pnpm -w typecheck` (11/11 · exit 0) · `pnpm -w lint` (exit 0) ·
  `pnpm -w build` (7/7; widget 6.76 kB gzip ≪ 50 KB P3, dokunulmadı) · `pnpm -w test:unit` (web **88**,
  yeni `i18n.smoke.test.tsx` dâhil) · `pnpm -w test:integration` (**seri** · 22 dosya / **492**) ·
  `pnpm -w test:e2e` (**44/44**). Not: e2e ilk koşuda 5 widget testi **429 rate-limit** ile düştü — sebep
  playwright'ın port 4000'de **bayat api dev sunucusunu** (raised `RATE_LIMIT_ANON_PER_MIN=2000` olmadan)
  `reuseExistingServer` ile yeniden kullanması; bayat süreci öldürüp taze sunucuyla tekrar koşunca **44/44 yeşil**.
  Kodumla (yalnız panel chrome) ilgisiz. Ayrıca e2e için kabuk env'ini `.env`'den export etmek gerekti
  (`tsx watch` dev komutu dotenv yüklemez; `make test-e2e` `include .env` ile çalışır).
- Kapsam disiplini: **yalnız 4 panel dosyası** commit'lendi (`AppShell.tsx`, `CommandPalette.tsx`,
  `navigation.ts`, `i18n.smoke.test.tsx` · commit `3bd3979` → main). `apps/widget/src/i18n.ts` (26.3) çalışma
  ağacında **commit'siz** bırakıldı; ilgisiz değişiklikler (CLAUDE.md/MASTER-PROMPT.md, kanit .png'leri, autorun
  .md'leri, run-loop.sh) staged edilmedi.
- Varsayımlar: "panel string" = her ekranda görünen **iskelet** chrome (shell/nav/palet); çevrilmemiş ekranlar
  fallback ile İngilizce'ye düşer (parent detay madde-2: "iskelet + eksik-anahtar güvenliği"). Task'ın
  "smoke/e2e" istediği locale-değişim kanıtı **smoke** dalıyla karşılandı (gerçek shell render → tr'ye çevir →
  ray etiketleri Türkçe, İngilizce kaybolur); ayrı e2e i18n spec'i eklenmedi.
- Sonraki pencereye not: **26.3** (widget) — `apps/widget/src/i18n.ts` iskeleti çalışma ağacında hazır bekliyor,
  bundle P3 (50 KB) bütçesini koru. **26.4** (test genişletme) — smoke + fallback unit'leri var; widget boyut
  testi kalabilir. Parent **26** ancak 26.3+26.4 bitince done; o zaman `PLAN.md §7.2 I18N ⬜→✅` güncellenir
  (henüz değil).

### 26.1 — I18N1/2 panel i18n çekirdeği (katalog + t() + locale kaynağı) — done — 2026-07-25 UTC
- Yapıldı: Bağımlılıksız hafif i18n temeli. `apps/web/src/lib/i18n.ts`: düz `tr/en` mesaj katalogu +
  `translate(locale,key,params)` (fallback zinciri **aktif locale → İngilizce → anahtarın kendisi** =
  eksik-anahtar güvenliği; `{name}` interpolasyon). Locale kaynağı: `localStorage('nexa.locale')` → tarayıcı
  dili → İngilizce (`detectLocale`, bölge eki kırpılır); zustand store + `useTranslate`/`useLocale` hook'ları;
  locale değişiminde `<html lang>` + `setFormatLocale` senkronu. `format.ts` Intl helper'ları (`formatCount`/
  `formatMoney`/`formatDate`) modül-düzeyi `activeLocale`'e bağlandı — **varsayılan argüman → geriye dönük
  uyumlu** (mevcut çağrı yerleri değişmez, testler açık locale geçirmeye devam eder).
- Doğrulama (**yeşil**): `pnpm -w typecheck` (11/11) · `pnpm -w lint` (8/8) · `pnpm -w build` (7/7) ·
  `@nexa/web` vitest **88** (yeni `i18n.test.ts` 7: fallback/interpolasyon/detectLocale + `format.test.ts` 5:
  locale bağı; mevcut AppShell/CommandPalette suite'leri hâlâ yeşil) · api/rtm entegrasyon **seri** koşuda yeşil
  (api 581). Not: `pnpm -w test` DB suite'lerini paylaşılan Postgres'te yarıştırır (bilinen konu — memory) →
  seri koştum; i18n saf frontend, backend'e dokunmaz.
- Kapsam: **yalnız 26.1** commit'lendi — `{i18n.ts, i18n.test.ts, format.ts, format.test.ts}` (commit `5883d5a`,
  `feat/i18n-foundation` → main ff). 26.2 (panel string'leri: AppShell/CommandPalette/navigation), 26.3 (widget
  `apps/widget/src/i18n.ts`) ve 26.4 (`i18n.smoke.test.tsx` + widget boyut testi) çalışması çalışma ağacında
  **commit'siz** bırakıldı — kendi pencerelerinde kapanacak. (navigation.ts `label`→`labelKey` kırıcı değişimi
  AppShell/CommandPalette ile bağlı; birlikte commit'lenmeli.)
- Varsayımlar: İki locale + bu string sayısında ICU/plural kütüphanesi gereksiz (widget 50KB P3 bütçesine de
  ağırlık bindirmez). İngilizce **doğruluk kaynağı** — her anahtar `en`'de var, `tr` kısmi olabilir. Canlı/makine
  çevirisi kapsam dışı (PRD §9). format binding'i 26.1'e dâhil edildi (parent detay madde-1: "format.ts locale'e
  bağla"; ayrıca `i18n.ts` `setFormatLocale`'e derleme-zamanı bağımlı).
- Sonraki pencereye not: **26.2** → `useTranslate()` ile panel string'lerini katalogla; rail/palette `labelKey`'i
  `t()` ile çöz (navigation.ts zaten `labelKey`). **26.3** → widget `createTranslator(data-language)` bağla, boyut
  bütçesini koru. **26.4** → smoke + widget boyut testi + PLAN.md §7.2 `I18N1/2` ⬜→✅ (yalnız tüm 26 kapanınca).
  Task 26 hâlâ `in-progress`.

### 25 — M5 Gözlemlenebilirlik: OpenTelemetry span + metrik (request_id köprüsü) — done — 2026-07-25 UTC
- Yapıldı: NFR-M5 (§7.2 ◐→✅). Gerçek OTel SDK (2.10) bağlandı. `apps/api/src/telemetry/telemetry.ts`:
  `BasicTracerProvider` (SimpleSpanProcessor) + `MeterProvider` (PeriodicExportingMetricReader). Exporter
  seçimi: dev/prod **konsol** (collector yok — sınır), test/enjekte **in-memory**. `apps/api/src/plugins/telemetry.ts`:
  `onRequest`→SERVER span aç (`GET /route`, attribute'ler: `http.request.method`, `http.route` (düşük
  kardinalite: `routeOptions.url`), `url.path`, **`request_id`**=`request.id`), `onError`→`recordException`,
  `onResponse`→`http.server.requests`/`.request.duration`(s)/`.errors` metrikleri + `http.response.status_code`
  + 5xx'te span status ERROR + span.end, `onClose`→shutdown. Telemetri kapalıyken **sıfır** hook/maliyet.
- Köprü: span'deki `request_id` = pino log `reqId` = `X-Request-Id` yanıt başlığı (server.ts `genReqId`) —
  aynı id üçünü birbirine bağlar (canlı sunucu smoke ile doğrulandı: `request_id: smoke-otel-1`).
- Anahtar: `OTEL_ENABLED` (env.ts). Boşsa ortamı izler: dev/prod açık, **test kapalı** (suite'ler hızlı kalır).
  `buildServer({telemetry})` ile enjekte edilebilir (null = kapat). `.env.example` belgelendi.
- Doğrulama (**yeşil**): `pnpm -w typecheck` (0) · `lint` (0) · `build` (0) · `@nexa/api` tam suite **581**
  (yeni `test/integration/telemetry.test.ts` 3: in-memory exporter'a span düştü + `request_id` attribute + 5xx
  ERROR + istisna + request/duration/error metrikleri) · `pnpm -w test:integration` (turbo --concurrency=1) **492**.
- Varsayımlar: SimpleSpanProcessor + konsol exporter yeterli (prod deploy yok — sınır). Metrik push aralığı
  60 s; testler `flushMetrics()` (forceFlush) ile deterministik okur. Attribute `request_id` (semconv değil,
  görev gereği). Providers global KAYDEDİLMEZ (tek süreçte çok sunucu → span sızıntısı olmasın).
- Sonraki pencereye not: `pnpm -w test` (varsayılan eşzamanlı) @nexa/api + @nexa/rtm entegrasyon suite'lerini
  **paylaşılan Postgres**'te yarıştırır → sahte kırmızı (rtm izole **65/65** ✅, api **581** ✅). DB suite'lerini
  **paket başına seri** koştur (bilinen konu). `@nexa/e2e` webServer'ı soğuk başlatınca `apps/rtm` env'i (`.env`
  yüklenmeden) düşüyor — **bu görevden önce de vardı**, dokunmadım (backend-only değişiklik, UI/akış yok).
  Faz-0 bakiyesinde kalan öncelik **26 (i18n) → 21 (Reports breakdown)**.

### 22 — 00.4 Onboarding sihirbazı + tohum veri — done — 2026-07-25 UTC
- Yapıldı: Signup **boş** çalışma alanı açıyordu (grup/website/sohbet yok) → yeni sahip boş inbox'a
  düşüyordu. Eklenen ilk-kurulum sihirbazı (§3.0 00.4 ⬜→✅). Contract-first: `openapi/paths/onboarding.yaml`
  + `@nexa/types` (`OnboardingState`, `OnboardingSeedResult`). Yeni uçlar: `GET /onboarding/state`,
  `POST /onboarding/complete` (bitir **ve** atla — aynı çağrı, idempotent), `POST /onboarding/seed-demo`.
  `/auth/me`'ye `onboarding_completed` eklendi (shell kapısı — ikinci istek maliyeti yok).
- Mekanizma: `licenses` tablosuna 2 bayrak (`onboarding_completed_at`, `demo_seeded_at`) — **lisans
  düzeyi** (workspace kurulu = tek sefer). Tohum veri yeni migration `onboarding_seed_demo(...)`
  **SECURITY DEFINER** (auth_*/retention_* deseni): tenant id'lerini açıkça alır, yalnız onları yazar
  (org-kapsamlı ziyaretçi + lisans-kapsamlı sohbet/thread/event atomik); `demo_seeded_at` ile idempotent.
  3 canned + 2 tag + 1 örnek ziyaretçi + owner'a atanmış **aktif** örnek sohbet (owner unrestricted →
  grup gerekmez). Web: `App.tsx` kapısı (`agent.onboarding_completed === false` → tüm yollar
  `/app/onboarding`'e); `OnboardingWizard` mevcut website/invite/settings akışlarını yeniden kullanır,
  her adım atlanabilir. Seed (demo tenant'lar) baştan onboarded işaretlendi + eski kayıtlar için backfill.
- Doğrulama (hepsi **yeşil**): `pnpm -w typecheck` · `lint` · `test:unit` (164) · `test:integration`
  (489 — yeni `onboarding.test.ts` 8: cross-tenant seed izolasyonu + iki kapı [scope+rol] + idempotent) ·
  `build` · `test:e2e` (44 — yeni `onboarding.spec.ts` 3: signup→sihirbaz→skip & complete→inbox).
  Kanıt: `apps/e2e/kanit/22-onboarding-wizard.png`.
- Varsayımlar: Yazma uçları `properties.configuration:rw` (ADMIN_SCOPES) + rol admin+ (iki kapı).
  E2E anon rate-limit: signup akışları tek IP'de anon kovayı zorluyordu → `playwright.config` api
  webServer'ına `RATE_LIMIT_ANON_PER_MIN=2000` headroom (limitin kendisi integration'da test edilir).
- Sonraki pencereye not: Faz-0 bakiyesinde kalan öncelik **25 (OTel) · 26 (i18n) → 21 (Reports breakdown)**.
  `contract/dist/openapi.json` gitignore'lu (build artefaktı); `src/generated/api.ts` commit'lendi.

### 24 — C8 veri saklama (retention) budama işi [MAX] — done — 2026-07-25 UTC
- Yapıldı: Silme CASCADE vardı (Dilim 3) ama süresi geçen veriyi budayan **periyodik iş yoktu**
  (§7.2 C8 ◐). Eklenen `services/retention/`: `policy.ts` (tablo→pencere — kapanmış thread 365g ·
  visit telemetri 90g · `.data` mail 30g; env'den override; `cutoffFor` **pozitif-pencere guard'ı**
  = "her şeyi silme" footgun'ını reddeder), `retention.ts` (`RetentionRunner` — tenant-döngülü
  hard-delete), `run.ts` (`retention:run` CLI). **Prod scheduler YOK** (sınır) — manuel tetik.
- Mekanizma: Yeni migration `retention_list_tenants()` **SECURITY DEFINER** (auth_* deseni) tüm
  tenant'ları sayar (RLS-bağlı `nexa_app` bunları tek başına göremez). Silmeler tenant başına
  `withTenant` içinde → **RLS cross-tenant'ı fiziksel imkânsız kılar** (WHERE hatası bile başka
  tenant'a ulaşamaz), owner+SECURITY DEFINER silme yerine (o RLS ağını kaybederdi). Kapanmış thread
  silinince event+thread_tag **cascade** düşer (en büyük tablo hiç adlandırılmadan budanır).
  Batch (500) + kısa tx + idempotent.
- Güvenlik: iki bağımsız guard — (1) her ifade `... < cutoff` yaş-guard'ı, guard'sız silme yolu
  YOK; (2) RLS tenant-scope. **dry-run varsayılan** (`--apply` olmadan yalnız sayar — irreversible).
  Silme audit'e `data.retention_pruned` (system aktör + sayaçlar) yazılır — metadata, veri değil.
- Doğrulama (DoD tam yeşil, exit 0): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w build` ·
  api unit+integration **570/570** (yeni: 6 birim policy + 8 integration retention) ·
  `pnpm -w test:integration` (serialize) **481/481** · rtm **65/65** · **e2e 41/41** · prettier temiz ·
  `retention:run` dry-run canlı DB'de koştu (SECURITY DEFINER 2 tenant döndürdü, 0 silme).
  Integration kanıtı `test/integration/retention.test.ts`: süresi geçen thread+event cascade
  **silinir** · recent+active thread **KALIR** · visit geçen silinir/recent kalır · **cross-tenant
  DOKUNULMAZ** (A bağlamında silme B'nin aynı satırını bırakır — RLS) · **idempotent** (2. koşu 0) ·
  **dry-run YAZMAZ** (sayar, silmez, audit yok) · audit tam 1 sistem-atıflı sayaçlı giriş ·
  mail dosyaları geçen süpürülür/recent kalır.
- Varsayımlar: (1) Retention hedefi = kapanmış thread (→event/tag cascade) + visit telemetri +
  `.data` mail. **Müşteri satırı silme kapsam dışı** — "right to erasure" API'si (GDPR Md.17, tekil
  özne) + per-tenant retention kolonu (`security_settings`) ayrı/sonraki iş (v1 borcu). (2) Pencereler
  env-yapılandırılabilir varsayılan (365/90/30), PRD'nin 30/60/365 kademesiyle hizalı. (3) Mail
  dosyaları tenant-etiketsiz olduğundan global süpürülür (yerel dev artefaktı). Şema DEĞİŞMEDİ
  (yalnız 1 SECURITY DEFINER fonksiyon migration'ı); `db:check-drift` etkilenmez (Prisma fonksiyon modellemez).
- Sonraki pencereye not: Faz-0 bakiyesinde sıradaki öncelik tm **22** (00.4 Onboarding) → 25 (OTel) ·
  26 (i18n) → 21. `retention:run` prod'da cron'a bağlanacak (sınır: scheduler yok).

### 23 — S12 audit_log yazıcısı (append-only olay yazımı) [MAX] — done — 2026-07-25 UTC
- Yapıldı: `audit_log` tablosu + RLS Dilim 12'de vardı ama **hiçbir olay yazılmıyordu** (§D16).
  Merkezi tek yazıcı `services/audit/audit-log.ts` → `writeAuditEntry(tx, ctx, entry)`: verilen
  **tenant transaction'ı** içinde tam 1 satır INSERT eder (RLS `WITH CHECK` yanlış tenant'ı reddeder),
  `sanitizeAuditMetadata` sır benzeri anahtarları (pass/secret/token/verifier/hash/…) düşürür,
  `request_id`'yi metadata'ya koyar. `plugins/audit.ts` → `request.auditContext()` principal'dan
  actor/tenant/ip/requestId üretir. **Şema DEĞİŞMEDİ.**
- Bağlanan 12 güvenlik eylemi: `auth.login` (başarılı `/auth/authorize`) · `auth.login_failed`
  (kayıtlı client'ın org'una — attacker `license_id`'sine değil — atfedilir, e-posta yazılmaz) ·
  `auth.password_reset` (hesabın her üyeliğine fan-out) · `member.invited`/`member.invitation_revoked`
  (davet e-postası audit'e yazılmaz — PII-min) · `settings.security_updated`/`routing_rule_updated`/
  `trusted_domain_added`/`trusted_domain_removed` · `billing.subscription_updated` · `pat.created`/
  `pat.revoked`. Konfig mutasyonları eylemin kendi tx'inde **atomik**; auth/PAT yolları **en-iyi-çaba**
  (kimlik doğrulama/erişilebilirlik audit yazımına bağımlı olmasın).
- Doğrulama (DoD tam yeşil, exit 0): `pnpm -w typecheck` · `pnpm -w lint` · api unit+integration
  **556/556** (yeni: 6 birim sanitizasyon + 16 integration) · `pnpm -w build` · `pnpm -w test:integration`
  (serialize) **473/473** · rtm **65/65** · **e2e 41/41** · prettier temiz. Integration kanıtı
  `test/integration/audit-log.test.ts`: eylem başına **tam 1 append** + doğru actor/target/metadata ·
  UPDATE/DELETE **DB'de reddi** (`permission denied`) · tenant'sız INSERT fail-closed · yanlış-tenant
  INSERT RLS reddi · **cross-tenant görünmezlik** (zorunlu negatif) · **sır/PII yok** (parola/PAT
  plaintext/deneme e-postası logda yok).
- Varsayımlar: (1) `audit_log` şema gereği **tenant-scoped** (license_id NOT NULL + RLS), bu yüzden
  yalnız güvenilir tenant bağlamı olan eylemler yazılır. Login = tenant'a bağlanan adım
  (`/auth/authorize`); `/auth/login` (üyelik listeleme) workspace seçmediğinden yazılmaz.
  (2) Rol/üyelik değişikliği yüzeyi şu an **davet oluştur/iptal** (ayrı rol-değiştir/suspend endpoint'i
  yok). (3) `auth.login_failed` yalnız `/auth/authorize` başarısızlığında (web app iki-adımlı akışta
  önce `/auth/login`'de tenant'sız düşer — bu doğası gereği yazılamaz).
- Sonraki pencereye not: **Okuma/export UI kapsam dışıydı (v1 borcu)** — audit tüketimi (liste/filtre/
  export) ayrı task. Yazıcı-tarafı sözleşme değişmedi (OpenAPI'ye endpoint eklenmedi). Faz-0 bakiyesinde
  sıradaki öncelik tm **24** (C8 retention).

### 20 — Reports KPI: Manual/Assisted/Automated ayrımı + Total cases (07.3.2) — done — 2026-07-25 UTC
- Yapıldı: Reports Overview'a PRD 07.3.2'nin **üç-sınıf çözüm ayrımı**. **Automated** = kapanmış,
  agent-yazımlı event yok (ADR-09 birebir korundu — faturanın AI-resolution sayacıyla aynı sorgu) ·
  **Assisted** = agent event VAR + o chat'e ait `skill_runs` VAR · **Manual** = agent event VAR, skill YOK.
  Üçü kapanmış vakayı tam bölüyor: `manual + assisted + automated = closed` (SQL FILTER'lar karşılıklı
  dışlayan + kapsayan). Yeni tablo/kolon/migration YOK — veri zaten `events` + `skill_runs`'ta.
- Sözleşme: `openapi.yaml` `ReportsOverview.totals`'a `manual`/`assisted` (+`_rate`) alanları;
  `pnpm --filter @nexa/contract generate` ile `dist/openapi.json` + `src/generated/api.ts` yenilendi.
- Backend: `routes/reports.ts` overview SQL'ine `assisted`/`manual` FILTER'ları; rate mantığı
  saf `routes/reports-metrics.ts`'e (`resolutionRate` + `round`) çıkarıldı (closed=0 → null guard).
- Web: `ReportsPage.tsx` — yeni **Resolution** bölümü (Manual/Assisted/Automated 3 kart) + Volume'a
  **Total cases** kartı; mevcut automated kartı (tone/rate hint) korundu.
- Doğrulama (DoD tam yeşil): typecheck 0 · lint 0 · unit (api `reports-metrics` 6/6 dâhil) 0 ·
  integration **457/457** (yeni 3 reports testi: 3-sınıf toplam=closed · ADR-09 skill-run automated'ı
  bozmaz · cross-tenant izolasyon; contract-parity + tenant-isolation dâhil) · build 0 ·
  e2e reports+demo-flow 4/4. Kanıt: `apps/e2e/kanit/20-reports-resolution.png` (Manual 2·100% / Assisted 0 / Automated 0, closed=2).
- PLAN: §3.6 07.3.2 ◐→✅ · §F bakiye sayacında tm 20 ✅ · §D17 ÇÖZÜLDÜ olarak işaretlendi.
- Sonraki pencereye not: Faz-0 bakiyesinde sıradaki öncelik tm **23** (S12 audit yazıcısı). Assisted'in
  chat↔skill eşlemesi `chat_id` üzerinden (skill_runs thread'e değil chat'e bağlı); ileride thread-zamanlı
  daha ince eşleme istenirse `skill_runs`'a `thread_id`/zaman penceresi gerekir (şu an kapsam dışı).

### §F — Faz-0 kapanış turu (bakiye kapatma) — done — 2026-07-25 UTC
- Yapıldı: 02.6 **Copy chat link** — inbox transcript başlığına "Copy link" düğmesi (`CopyLinkButton`);
  `${origin}/app/inbox?chat=<id>` mutlak deep-link'ini panoya kopyalar (komut paleti + InboxPage'in
  zaten tükettiği `?chat=` parametresi, tek kaynak). 02.6 artık tam ✅ (Reopen + Create ticket + Copy link).
- Ölü kod temizliği: `apiClient` singleton export'u (`lib/api-client.ts` — hiç import edilmiyordu;
  herkes `useApiClient()` / `new ApiClient()` kullanıyor) ve `useScrollToBottom` (InboxPage — hiç
  çağrılmıyordu; artık kullanılmayan `useRef` import'u da düştü) kaldırıldı.
- §D sapma kaydı: **D16** (audit_logs tablo+policy var ama yazıcı yok → S12 ⬜, v1 borcu), **D17**
  (07.3.2 Manual/Assisted ayrımı yok → ◐), **D18** (faz sızıntısı — Playbook/AI v1 payları öne
  çekildi → v1 sayılır, Faz-0 sayacına dâhil değil).
- PLAN: sayaç 47✅/6◐ → **48✅/5◐** (02.6 ◐→✅) · §2 matris MOD-02 ✅ · §3.11 Dilim 14 bakiye notu güncellendi.
- Doğrulama (yalnız web değişikliği): `@nexa/web` typecheck 0 · lint 0 · unit 72/72 · build 0.
  Düğme yalnız seçili sohbetle render olur (tarayıcı doğrulaması tam stack ister); string+clipboard
  mantığı test edilmiş idiom'u (`Channels` ChatPageLink) birebir yansıttığından statik+birim kapısıyla kapatıldı.
- Açık bırakılan Faz-0 bakiyesi (bilinçli — kullanıcı "hızlı kapanış" seçti; §F.3 kararına bırakıldı):
  Reports breakdown/365/custom (07.1/07.3.1/07.3.3) · 00.4 Onboarding sihirbazı · audit_log yazıcısı ·
  OTel (M5) · retention job (C8) · i18n · PAT UI (08.8.2).

### 19 — Inbox real-time sekmeleri (All/Chatting/Queued/Waiting) — done — 2026-07-24 UTC
- Yapıldı: FR-MOD-03.1.1. **Yalnız frontend** (yeni uç/DB yok — mevcut `/chats?view=` listesi
  istemci tarafında bölünüyor). Yeni saf modül `features/inbox/traffic.ts`: `matchesTrafficTab`
  + `filterByTrafficTab` + `trafficTabCounts`. Kova mantığı — **All** tüm liste; **Queued**
  `queue_position!=null`; **Waiting** aktif + son olay müşteriden (yanıt bekliyor); **Chatting**
  aktif + kuyrukta değil + son olay müşteriden değil. Chatting/Queued/Waiting **karşılıklı dışlayan**
  (bir sohbet tek kovada), toplamları All'a eşit. `InboxPage.tsx`: konuşma listesi başlığının
  altına yatay `role="tablist"` şeridi (aria-selected, sohbet görünümünde; ticket'larda yok);
  her sekmede canlı sayaç rozeti. Sayaçlar RTM ile canlı — push `['chats']`'i invalidate ediyor,
  liste + kovalar aynı state'ten türüyor. Seçim geçerliliği tam liste üzerinde kalıyor (sekme
  değişince açık transcript düşmez); sadece render süzülür. Boş sekmede özel boş-durum metni.
- Doğrulama: `pnpm -w typecheck` 0 · `pnpm -w lint` 0 · unit (web 72 / api 525) yeşil ·
  `pnpm -w test:integration` 454 yeşil · `pnpm -w build` 0 · `pnpm exec playwright test` 40 yeşil
  (yeni `apps/e2e/tests/inbox-tabs.spec.ts` dahil). Birim: `traffic.test.ts` (kova + sayaç +
  filtre). Kanıt: `apps/e2e/kanit/19-realtime-tabs.png`.
- Varsayımlar: FR-MOD-03.1.1'in "Real-time sekmeleri" başlığı MOD-03 traffic ekranına ait; task
  hedef dosyaları (InboxPage/useInbox) gereği sekmeler **konuşma listesi** üzerine yatay şerit
  olarak uygulandı (Supervised/Invited/Browsing kapsam dışı — task başlığı 4 sekmeyle sınırlı).
- Sonraki pencereye not: `pnpm -w test` (turbo, paralel) çalışan dev sunucusuyla api/rtm/e2e'de
  DB/port çakışması verir; kapı için serial script'leri kullan (`test:integration`, `playwright
  test` tek başına). Supervised/Invited/Browsing sekmeleri ileri bir MOD-03 task'ında eklenebilir.

### 18 — Command Palette (⌘K): içerik arama + rota atlama — done — 2026-07-24 UTC
- Yapıldı: FR-MOD-01.1.3. **Yalnız frontend** (yeni uç yok — mevcut `/customers?query`,
  `/tickets?query`, `/chats` kullanıldı). Yeni `components/CommandPalette.tsx`: ⌘K/Ctrl-K ile
  her modülden açılır dialog; combobox + listbox (klavye: ↑/↓/Enter/Esc, `aria-activedescendant`,
  backdrop kapatma, açılış/kapanışta odak iadesi). Boş sorgu → modül atlama; sorgu →
  müşteri + sohbet + ticket araması gruplu. Aramalar **scope-gated** (customers/tickets/chats
  read scope yoksa istek atılmaz — 403 gürültüsü yok). Sohbetin serbest-metin ucu yok:
  `/chats?view=all` istemci tarafında filtrelenir. Modül filtresi anlık (raw input), kayıt
  araması debounce (180ms). Ortak modül listesi `components/navigation.ts`'e çıkarıldı (rail +
  palet tek kaynaktan). **Deep-link:** seçim `/app/customers?customer=`, `/app/inbox?chat=` /
  `?ticket=` ile hedefe gider; `CustomersPage` ve `InboxPage` param'ı tüketip seçimi kurar,
  "seçim geçerliliği" efektleri liste yüklenene dek (`list.data`/`tickets.data`) bekler ki
  deep-link boş listeye karşı silinmesin.
- Doğrulama (hepsi yeşil): `pnpm -w typecheck`, `pnpm -w lint`, `pnpm -w build`; **web unit 62**
  (yeni `CommandPalette.test.tsx`: aç/kapa, modül listeleme+filtre+Enter atlama, keyword eşleşme,
  müşteri+ticket arama→deep-link, scope-gate negatifi — stub fetch); api integration 454;
  **e2e 39** (yeni `command-palette.spec.ts`: ⌘K açılışı, "Alex" araması müşteri+sohbet döndürür,
  müşteri seçimi kayda gider; modül atlama Reports). Görsel kanıt:
  `apps/e2e/kanit/18-command-palette.png`.
- Varsayımlar: Sohbet araması istemci-taraflı filtre (küçük "all" listesi); ticket UI yolu seed'de
  ticket olmadığından e2e'de değil, unit'te (stub) kanıtlandı. Deep-link'lenen müşteri "all"
  segmentine, sohbet/ticket "All" görünümüne pinlenir (arşiv/banlı kenar durumları liste efektine
  tabi).
- Sonraki pencereye not: Kalan Dilim 14 kalemi **03.1.1** (inbox gerçek-zamanlı sekmeler
  All/Chatting/Queued/Waiting) ve 02.6 "Copy chat link". Depodaki task-dışı bootstrap dosyaları
  (AUTORUN-README/CONVENTIONS/TASK-RUNNER/run-loop, CLAUDE/MASTER-PROMPT/.gitignore değişiklikleri,
  apps/api/.data, önceki kanit PNG'leri) kapsam disiplini gereği hâlâ untracked — bu commit'e
  yalnız tm 18 dosyaları + 18-command-palette.png alındı.

### 17 — Tags kütüphanesi CRUD (grup kapsamı) — done — 2026-07-24 UTC
- Yapıldı: Merkezi etiket kütüphanesi (FR-MOD-08.7.1). **Kontrat:** `openapi.yaml`'a `Tag`
  şeması (`group_ids`, `usage_count`, `author_id`) + `paths/settings.yaml`'a `listTags`/
  `createTag`/`updateTag`/`deleteTag`; tipler yeniden generate edildi. **Backend:**
  `routes/settings.ts`'e `GET/POST /settings/tags` + `PATCH/DELETE /settings/tags/:tagId`.
  İsim, chat etiketlemeyle aynı normalizasyon (trim+lowercase, `[licenseId,name]` unique →
  409/not_allowed). `group_ids` tenant'ın gruplarına doğrulanır (routing-rule deseni). Okuma
  `tags--*:ro` (ajan datalist için `--groups:ro` dahil), yazma `tags--all:rw`. `usage_count`
  = `_count(threads)`; kütüphane ve chat etiketleme **aynı `tags` tablosu** — ayrı liste değil.
  **Frontend:** SettingsPage'e **Tags** bölümü (ekle/sil, "All teams · N in use"); DetailsPanel
  tag input'una `<datalist>` (kütüphaneyi öneri olarak besler, serbest yazma hâlâ çalışır).
- Doğrulama (hepsi yeşil): `pnpm -w typecheck`, `pnpm -w lint`, `pnpm -w build`; api unit 71;
  rtm 65; web 56; **api integration 454** (yeni `settings > tags` blok: CRUD + grup kapsamı +
  cross-tenant liste/silme 404 + shared-table usage_count + write-scope 403; contract-parity 5);
  **e2e 37** (`settings › curates a tag in the library` dahil). Görsel kanıt:
  `apps/e2e/kanit/17-tags-library.png` (kütüphane + `shipping · 1 in use` canlı sayaç).
- Varsayımlar: UI'da yazma/silme + oluşturma; rename/regroup yalnız API+integration testiyle
  kanıtlandı (canned-responses UI deseni ile hizalı — sadece create+delete yüzeyi). Grup atama
  UI'sı yok (workspace-wide varsayılan); yazma admin-scope (`tags--all:rw`).
- Sonraki pencereye not: `.taskmaster/tasks.json` commit anında `in-progress`'ti; sonrası `done`
  işaretlendi (diskte doğru, commit'te değil — zararsız). Depoda task dışı bootstrap dosyaları
  (AUTORUN-README.md, CONVENTIONS.md, TASK-RUNNER-PROMPT.md, run-loop.sh, CLAUDE/MASTER-PROMPT
  değişiklikleri) hâlâ untracked/kirli — kapsam disiplini gereği bu commit'e alınmadı.

### 16 — Bildirimler (ses/masaüstü/tarayıcı/e-posta) — done — 2026-07-24 UTC
- Yapıldı: Yeni müşteri mesajında ajan bildirimi (FR-MOD-13.8). **İstemci:** saf karar
  çekirdeği `features/notifications/notifications.ts` (`decideNotification` + localStorage
  tercih IO) + efekt hook'u `useNotifications.ts` (ses = Web Audio çan, masaüstü = Notification
  API, sekme başlığı `(n) Nexa` + favicon rozeti; sekme odağa gelince sıfırlanır). `useRealtime`
  opsiyonel `onPush` alır (ref ile stabil, soket yeniden kurulmaz); `InboxPage` bağlar. Ayar
  yüzeyi: SettingsPage'e **Notifications** bölümü (aç/kapa + ses + masaüstü izin butonu),
  tercih tarayıcı-başına (localStorage), her mesajda taze okunur. **Sunucu e-posta:**
  `customer.ts` atanmış ajana `mailer.send({kind:'notification'})` gönderir (best-effort,
  mesajı bloklamaz; yalnız insan atanmışsa); `server.ts` mailer'ı customer route'a geçirir;
  `mailer.ts` kind union'a `notification` eklendi.
- Doğrulama: `typecheck`, `lint`, `build`, `test:unit` (56 web — 20 yeni notifications testi
  dahil: negatif/izin-reddi/self/sistem olayı; 71 api), `test:integration` (445 — yeni
  `notifications.test.ts`: atanana e-posta düşer + follow-up + idempotent tek e-posta),
  `test:e2e` (36 — yeni `notifications.spec.ts`: ayar yüzeyi + kapat/aç kalıcı + reload) — hepsi
  yeşil. Kanıt: `apps/e2e/kanit/16-notifications-settings.png`.
- Varsayımlar: Bildirim tercihleri hesap değil **cihaz** başına (localStorage) — cihaz-özgü
  (hoparlör/OS izni). Negatif test (kapatınca sussun) ve izin-reddi sessiz degrade davranışları
  saf `decideNotification` birim testleriyle deterministik kanıtlandı; e-posta entegrasyon
  testiyle. Client bildirimleri `InboxPage` mount'una bağlı (Settings'teyken tetiklenmez) — MVP
  için kabul; app-geneli için ileride AppShell'e taşınabilir.
- Sonraki pencereye not: E-posta her müşteri mesajında atanana gider (mock, `.data/mail`);
  gerçek sağlayıcıya geçiş tek `Mailer` implementasyonu değişimi. Kanıt png'leri repo
  konvansiyonu gereği git'e alınmıyor.

### 15 — Trial rozeti 'N gün' + Subscribe CTA (shell) — done — 2026-07-24 UTC
- Yapıldı: `AppShell` flex-col'e alındı, ince üst `TrialBanner` eklendi —
  `useQuery(['billing','subscription'])` ile BillingPage ile paylaşımlı cache;
  `trialing` → "N days left", `read_only` → "trial bitti, abone ol", `active` → banner yok.
  Subscribe CTA `/app/billing`'e gider. Billing scope'u olmayan ajanda 403 → `retry:false` →
  banner yok (graceful). `AppShell.test.tsx` `QueryClientProvider` ile sarıldı.
- Doğrulama: `typecheck`, `lint`, `build`, `test:unit` (40 web + 71 api), `test:integration`
  (442), `test:e2e` (35, yeni trial-badge testi dahil) — hepsi yeşil. Kanıt:
  `apps/e2e/kanit/15-trial-badge.png` (inbox içinden "14 days left … Subscribe").
- Varsayımlar: yok. Trial gate + `/billing/subscription` (access, trial.days_remaining)
  zaten mevcut (Dilim 9/14).
- Sonraki pencereye not: kanıt png'leri repo konvansiyonu gereği git'e alınmıyor
  (e2e spec regenerate ediyor). Dilim 14 merge SHA'sı slice kapanışında işlenecek.

## What exists

A working live-support platform. The MVP critical path runs end to end: a visitor
messages from the widget, routing assigns it, the agent sees it live in their inbox,
replies, tags it, archives it, and it shows up in reports and billing.

The slice table below is the build history, **not** a claim that the PRD's MVP is
finished — see "What to build next". 16 of the PRD's 52 MVP requirements are still
unwritten.

| Slice | Scope                                                                        | State |
| ----- | ---------------------------------------------------------------------------- | :---: |
| 1     | Monorepo, Postgres + Redis, `make dev`, health checks, CI                    |  ✅   |
| 2     | OAuth 2.1 + PKCE, PAT, customer tokens, scopes, RLS tenant isolation         |  ✅   |
| 3     | Full PRD §8.4 schema, event partitioning, database-enforced invariants, seed |  ✅   |
| 4     | chat → thread → event, Agent Chat API                                        |  ✅   |
| 5     | RTM gateway, fan-out, lossless reconnect                                     |  ✅   |
| 6     | Customer Chat API + embeddable widget                                        |  ✅   |
| 7     | 3-pane agent inbox                                                           |  ✅   |
| 8     | Routing, capacity limits, queueing                                           |  ✅   |
| 9     | Reports overview, metering, trial gate                                       |  ✅   |
| 10    | Design system, shell + module screens                                        |  ✅   |
| 11    | Ticketing core — `/tickets`, inbox Tickets group, create-from-chat           |  ✅   |

**621 tests green** — 219 unit, 379 integration, 23 end-to-end. Typecheck, lint and format clean.
No schema drift.

---

## Running it

```bash
make dev
```

Datastores, migrations, seed and all apps. Then http://localhost:5173 —
`owner@acme.localhost` / `nexa-demo-password`.

The seed creates two organizations on purpose. Acme is the one to log into;
Northwind exists so a cross-tenant leak shows up as visibly wrong data rather
than as nothing at all.

---

## What is honestly incomplete

**The PRD's MVP is about two thirds built.** 32 of its 52 `Must/Should (MVP)`
requirements are done, 4 partial, 16 untouched — signup, forgot password, checkout,
file sharing, notifications and ⌘K among them. `PLAN.md` §3 lists every one with the
evidence behind the verdict.

**The AI is a deterministic stub, not a model.** `packages/ai-mock` derives
embeddings from text (hashed bag of words, 1536 dims, L2-normalised) and
compiles instructions with rules. Retrieval ranks by real lexical overlap, so it
behaves like retrieval rather than looking like it — but "delivery" and
"shipping" stay unrelated, as they would to any lexical method. Swapping in a
real provider means replacing `embed()` and `compileInstruction()`; nothing else
knows how the numbers were produced.

**Not started (v1 scope in the PRD):** webhooks, Copilot, omnichannel adapters
(WhatsApp/Messenger/Twilio), campaigns, ticket rules and the advanced tickets grid,
custom fields, forms builder, the apps marketplace. The visual workflow editor stays
unbuilt by decision (ADR-14) — the table exists and nothing writes to it.

**Mocked, as instructed:** Stripe (no external call; `usage_records` are real and
the arithmetic is real), LLM providers, SMTP, object storage.

**Known limits, chosen rather than overlooked:**

- Idempotency keys live in Redis with a 24-hour TTL, not in Postgres. `events` is
  partitioned, and a unique index on a partitioned table must include the
  partition key. If Redis is down, a retried send can duplicate a message.
- Customer tokens are stateless and cannot be revoked individually. TTL is short,
  and bans and licence expiry are checked per request against live data.
- The widget polls every four seconds rather than holding a socket. The gateway
  could serve it; a customer-side socket across sleeping laptops and mobile
  networks is more to keep alive than the conversation is worth.
- Rate limiting fails open if Redis is unavailable. Availability beats a
  perfectly enforced limit, and auth and RLS are unaffected.

---

## Things worth knowing before changing anything

**The API connects to Postgres as `nexa_app`, never as the owner.** Postgres
exempts table owners and superusers from row level security. Point the runtime at
`DATABASE_URL` instead of `DATABASE_APP_URL` and every tenant isolation policy
silently stops applying while the whole test suite still passes.
`test/integration/tenant-isolation.test.ts` asserts this rather than trusting it.

**Invariants live in the database.** One active chat per license+customer, one
active thread per chat, one fallback routing rule per kind. A rule checked only
in a service is one concurrent request away from being violated, and the
resulting corruption is permanent. The tests fire concurrent requests at these
rather than checking them sequentially.

**Errors derive their HTTP status from their type.** A route cannot return
`not_found` with a 403. Anything the caller may not see — including another
tenant's data — is 404, so short IDs cannot be enumerated.

**"AI resolution" is defined in exactly one place** (`services/billing/metering.ts`):
a thread that closed with no agent-authored event. Reports and billing both read
it. Two counters meant to agree will not, and the first anyone notices is a
customer disputing a bill.

**Event IDs encode thread and sequence** (`TJ1H8CFKRV_7`). Ordering is decidable
from the ID alone, which is what makes lossless reconnect possible. Do not switch
transcript ordering to timestamps: several events can share a millisecond.

**`pnpm test:integration` runs serially.** Both packages' suites truncate the same
database; running them at once makes each delete the other's fixtures, which
presents as flaky RTM tests.

---

## Where to look

| Question                     | File                                                   |
| ---------------------------- | ------------------------------------------------------ |
| Decisions and why            | [PLAN.md](PLAN.md) §0 (ADRs), §D (deviations)          |
| Colours, spacing, a11y rules | [design-brief.md](design-brief.md)                     |
| API contract                 | `packages/contract/openapi/`                           |
| Tenant isolation             | `apps/api/src/lib/tenant.ts` + the RLS migration       |
| Conversation core            | `apps/api/src/services/chat/chat-service.ts`           |
| Reconnect                    | `apps/rtm/src/sync.ts`, `apps/web/src/lib/realtime.ts` |
| Routing algorithm            | `apps/api/src/services/routing/routing-service.ts`     |

---

## What to build next

**Read `PLAN.md` §3 first.** It is the authority, and it is now a projection of the
PRD's own phase and module structure — every work item carries an `FR-MOD` id.

An audit on 2026-07-23 found that finishing the ten original slices was not the same
as finishing the PRD's MVP: of the 52 requirements the PRD labels `Must/Should (MVP)`,
**18 had no code at all**, and Playbook — shipped under slice 10 — is a v1 feature that
had jumped ahead of them. `PLAN.md` §1.3 records this; §3 lists every gap with its
evidence.

~~1. Ticketing~~ — **done** (slice 11). `/tickets` list/create/get/patch, the Tickets
group in the inbox, "Create ticket" on a conversation, and `total_cases` in Reports.
Two pieces were moved out rather than rushed: email→ticket (`08.5.3`) belongs with the
channel surface in slice 13, and "Copy chat link" (part of `02.6`) with slice 14.

The order, and why:

1. **Account lifecycle** (`00.2`–`00.4`, `04.3.1`, `04.4`) — slice 12. There is no
   signup; every account comes from the seed. The trial rules (ADR-10) have never run
   against an account the product created itself, so expect surprises there.
2. **Channels, file sharing, greeting** (`08.5.1/.2/.3/.9`, `08.9.4`, `11.2`) — slice 13.
   File sharing carries the security shape: NFR-S10 wants type and size limits and
   scanning, and those belong in the first version rather than a retrofit.
3. **Checkout, notifications, ⌘K** (`10.1.x`, `13.8`, `01.1.3`, `02.6` copy link) — slice 14.

**Webhooks (`FR-MOD-08.8.4`) is v1, not MVP** — worth flagging because an earlier
version of this file recommended it first. When it is built, ship the HMAC signing and
the SSRF guard with the first version (NFR-S7, risk R2, `v2-derin-analiz/v2-04` §6);
retrofitting them once integrators depend on the loose behaviour is a breaking change.

When every phase in `PLAN.md` is closed, run the mandatory closing sweep in **PLAN.md §F**
before reporting the work finished.
