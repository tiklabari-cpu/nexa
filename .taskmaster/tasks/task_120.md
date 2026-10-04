# Task ID: 120

**Title:** A11Y1–6 — "Internal note" modu koyu temada 1.47:1 kontrast (WCAG 2.1 AA ihlali)

**Status:** done

**Dependencies:** None

**Priority:** critical

**Description:** Composer'ın "Internal note" sekmesi SEÇİLİ haldeyken koyu temada beyaz metni #ffce73 dolgu üstüne koyuyor (~1.47:1, AA eşiği 4.5:1). §7.2'nin `A11Y1–6 | WCAG 2.1 AA | ✅ → KA11Y` damgası bu ihlalle birlikte fazla iddia ediyor.

**Details:**

PRD/PLAN kimliği: **A11Y1–6** (PLAN.md:2195 · §7.2 · kanıt bloğu `#### KA11Y`, PLAN.md:4176).

(a) GEREKÇE VE KANIT (bu turda ÖLÇÜLDÜ, hafızadan değil):
- `apps/web/src/features/inbox/Composer.tsx:294` → `mode === 'agents'` (yani "Internal note" sekmesi
  SEÇİLİ) iken sınıf çifti `'bg-note text-white'`.
- `apps/web/tailwind.config.*:46` → `note: 'var(--note)'`. `apps/web/src/styles/tokens.css:127` →
  **koyu** temada `--note: #ffce73`. #ffce73 üstünde #ffffff → **1.47:1** (WCAG 2.1 AA metin eşiği
  4.5:1; büyük metin 3:1 — bu 12px `text-2xs`, yani 4.5:1 geçerli). AÇIK temada aynı çift
  `--note: #806413` ile 5.60:1, yani kusur YALNIZ koyu temada.
- Sekme ölü bir durum DEĞİL: `Composer.tsx:272-273` iki mod sunuyor (`all` = "Reply",
  `agents` = "Internal note"); `Composer.tsx:47` `useState<'all'|'agents'>('all')`. Yani ajan
  iç not yazmak için sekmeye bastığı anda kusur ekranda.
- HANDOFF tm 117 notu (2) bu kusuru ismen "bilinen, kapsam dışı" diye bırakmıştı; görev hiç
  açılmamıştı. Bu pencerede koda karşı yeniden doğrulandı — hâlâ HEAD'de.

(b) DOKUNULACAK DOSYALAR:
- `apps/web/src/features/inbox/Composer.tsx` (satır ~294 — asıl düzeltme)
- `apps/web/src/styles/tokens.test.ts` (yalnız gerekirse — aşağıdaki tuzağı oku)
- `apps/e2e/tests/a11y.spec.ts` (kör noktayı kapatan yeni tarama durumu)
- `apps/web/src/features/inbox/Composer.test.tsx` (birim kilidi)

(c) SIRA (contract-first burada sözleşmesiz — şema/migration/API DEĞİŞMİYOR):
1. Düzeltmeyi çağrı yerinde yap → 2. birim testle kilitle → 3. a11y e2e taramasına
"Internal note seçili" durumunu ekle (regresyon kapısı) → 4. tam DoD.

(d) BİLİNEN TUZAKLAR:
- **Token'ı DEĞİŞTİRME.** `--note`'un dört kullanımından üçü ön plan: `Transcript.tsx:100`
  (`text-note`), `Transcript.tsx:138` (`border-note`), `Composer.tsx:304` (`text-note`) — koyu
  yüzeyde #ffce73 oralarda DOĞRU ve yüksek kontrast. Yalnız `Composer.tsx:294` onu **dolgu**
  olarak kullanıyor. Koyu `--note`'u koyulaştırmak üç doğru kullanımı bozar VE
  `tokens.test.ts:127`'nin `--note`'u ÖN PLAN olarak dört yüzey × iki temada kilitleyen
  testleriyle çakışır (tm 117'nin 88 testi). Doğru düzeltme **çağrı yerinde**: dolgunun üstüne
  koyu mürekkep koy (ör. `text-surface-0`/`bg-inset` mürekkebi) ya da seçili durumu dolgu yerine
  kenarlık/metin ile göster. Hangi yolu seçersen ölçülen oranı details yerine kanıt bloğuna yaz.
- tm 117'nin AÇIK tema düzeltmeleri (`--success`/`--warning`/`--note`) ve tm 115'in kilitlediği
  `--brand-*`/`--text-tertiary` DEĞİŞMEYECEK.
- **axe bunu neden yakalamıyor:** `apps/e2e/tests/a11y.spec.ts` hiçbir taramada "Internal note"
  modunu açmıyor (`grep -c 'Internal note' a11y.spec.ts` → **0**). Varsayılan `mode='all'` iken o
  düğme `text-content-secondary`, yani ihlalli çift hiç render edilmiyor. Bu yüzden tm 115'in ve
  tm 117'nin 16 taraması da temiz döndü. Düzeltmeyi yapıp taramaya bu durumu EKLEMEZSEN kusur
  sessizce geri gelebilir — asıl iş bu kör noktayı kapatmaktır.
- Koyu tema `A11Y_EXCEPTIONS`'a girme; liste boş kalmalı (tm 117 kanıtı).

(e) KAPSAM SINIRI — dokunma:
- Backend, sözleşme, şema, migration YOK.
- Diğer bileşenlerin renkleri, tema sağlayıcısı (tm 117), i18n YOK.
- `Composer.tsx`in gönderme/öneri/yazıyor mantığı YOK — yalnız seçili sekme sınıfları.
- Faz-3 görevleri (tm 79/81/82/83/84/90) ve PLAN'ın Faz-3 planı YOK.
- PLAN'da yalnız `#### KA11Y` bloğuna madde eklenir; `A11Y1–6` tablo hücresi `✅ → KA11Y`
  AYNEN kalır (CONVENTIONS §1.2 — hücrede yalnız damga).

**Test Strategy:**

Kapı (hepsi exit 0, sayılar taban ≥ 5892): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w test` (≥3864) · `pnpm -w test:integration` (≥1906) · `pnpm -w build` · `pnpm -w test:e2e` (≥122). E2E çıplak kabukta koşmaz: `set -a; . ./.env; set +a; pnpm -w test:e2e`.
Göreve özel ÖLÇÜLEBİLİR kabul: (1) `a11y.spec.ts`e "Internal note" SEÇİLİ durumunu tarayan yeni bir durum eklendi ve axe `blocking 0 · excused 0 · advisory 0` döndü, `A11Y_EXCEPTIONS` BOŞ kaldı; (2) düzeltme ÖNCESİ o yeni taramanın gerçekten KIRMIZI olduğu gösterildi (kapı-probe kanıtı — yoksa test hiçbir şeyi korumuyor); (3) seçili "Internal note" düğmesinin ön/arka plan çifti koyu temada ölçülüp **≥4.5:1** çıktı, sayı kanıt bloğuna yazıldı; (4) `Transcript.tsx:100/138` ve `Composer.tsx:304`'ün `text-note`/`border-note` kullanımları DEĞİŞMEDİ ve `tokens.test.ts` (88) yeşil kaldı.
