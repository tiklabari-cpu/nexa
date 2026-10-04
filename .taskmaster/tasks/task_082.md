# Task ID: 82

**Title:** C4 — HIPAA BAA + bölgesel barındırma (US/EU) · dilim V3-1

**Status:** done

**Dependencies:** 81 ✓

**Priority:** medium

**Description:** PRD §5.4 (Ent.) · NFR-C4/C9 · KK-türetilmiş. ADR-12 tek bölge (eu) burada GENİŞLETİLİR (iptal edilmez).

**Details:**

Faz 3 (Enterprise) · PLAN §6.1 · kalem `C4` · dilim V3-1

7 atomik alt-görev · ~10 pencere · etiket dağılımı: OPUS-XHIGH x3 · OPUS-MAX x2 · SONNET-XHIGH x2

KK: "BAA imzalı hesapta HIPAA kapsamı; region seçimi (US/EU); yanlış bölge → misdirected_request" — NFR-C4/C9'dan türetildi (§C-A19).

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  C4-a [OPUS-XHIGH] REGIONS genişlemesi (eu + us) + licenses.region kayıt anında seçilebilir + kontrat  (bağ: —)
  C4-b [OPUS-MAX] Bölge zorlaması çekirdeği (BÖLÜNMEZ) — API + RTM + customer token üçünde misdirected_request (421)  (bağ: C4-a)
  C4-c [SONNET-XHIGH] Onboarding/kayıt akışında bölge seçimi + "sonradan değiştirilemez" uyarısı  (bağ: C4-a)
  C4-d [OPUS-XHIGH] BAA durumu — licenses.hipaa_baa_signed_at + kabul akışı (MOCK) + compliance.baa_signed audit  (bağ: C4-a)
  C4-e [OPUS-MAX] HIPAA kapsam kısıtları (BÖLÜNMEZ) — retention tavanı + PII maskesi sertleşmesi + AI bölge sınırı  (bağ: C4-b, C4-d)
  C4-f [SONNET-XHIGH] Settings → Security: HIPAA/BAA durum kartı + bölge gösterimi (salt-okunur)  (bağ: C4-d)
  C4-g [OPUS-XHIGH] Uçtan uca doğrulama — 421 üç yüzeyde + immutability + BAA'sız hesapta kısıt yok + cross-tenant  (bağ: C4-b, C4-e, C4-f)

BAĞLAM KURULUMU (bu görev KOD YAZMAZ — alt-görevleri koşulur):
- PLAN §6.1.3 kalem kırılımı + bölünmeyen çekirdek gerekçeleri + varsayımlar + açık sorular
- PLAN §6.2 dilim sırası ve sıralamanın gerekçesi · PLAN §G Faz-3 düz tablosu
- CONVENTIONS DoD kapısı · TASK-RUNNER-PROMPT pencere protokolü
- Tam alan detayı her alt-görevin kendi `details` alanındadır (Faz-3'ün companion dosyası YOK — PLAN §D98)

SINIRLAR (CLAUDE.md): dış servisler MOCK · production deploy/DNS/TLS/gerçek secret/ödeme YOK ·
force-push/DB drop/history rewrite YOK · başka repoya dokunma YOK.

**Test Strategy:**

Her alt-görev KENDİ tam DoD kapısından geçer (CONVENTIONS §1): pnpm -w typecheck && pnpm -w lint && pnpm -w test && pnpm -w build && ilgili test:integration/test:e2e — hepsi exit 0. Kalem ancak son doğrulama alt-görevi (C4-g) yeşil olduğunda ✅ sayılır. Her alt-görevin kendi testStrategy alanı o pencerenin kapı komutlarını verir.

## Subtasks

### 82.1. C4-a [OPUS-MAX] REGIONS genişlemesi (eu + us) + licenses.region kayıt anında seçilebilir + kontrat

**Status:** done  
**Dependencies:** None  

REGIONS genişlemesi (eu + us) + licenses.region kayıt anında seçilebilir + kontrat

**Details:**

C4-a — REGIONS genişlemesi (eu + us) + licenses.region kayıt anında seçilebilir + kontrat  [OPUS-MAX]

PRD: C4 (PLAN §6.1 · dilim V3-1 · tm 82)
TAHMİN: ~1 pencere

NEDEN AÇIK: `packages/types/src/domain.ts:147-149` → `REGIONS = ['eu']`, tek değer. ADR-12 bunu MVP kararı olarak kilitlemişti; PRD §5.4 Enterprise'da US/EU ister.

KAPSAM: `REGIONS` → `['eu','us']`; `licenses.region` KAYIT ANINDA seçilir, sonrasında IMMUTABLE kalır (ADR-12'nin korunan yarısı); kontrat + onboarding gövdesi. Mevcut lisanslar `eu`'da KALIR — geriye dönük göç YOK (immutability'nin doğal sonucu).

ADR GÜNCELLEMESİ (bu pencerenin işi): PLAN §0 ADR-12 satırı "değer kümesi {eu, us}, immutability korunur" olarak güncellenir + §D'ye sapma kaydı yazılır. ADR iptal EDİLMEZ, genişletilir.

DOSYALAR: `packages/types/src/domain.ts:149` (`export const REGIONS`) · **`apps/api/src/config/env.ts:16` ve `apps/rtm/src/config/env.ts:5` — İKİSİ DE `SIYAHTUS_REGION: z.literal('eu')` (denetim bulgusu: RTM env dosyası ilk listede YOKTU; `us` iki Zod şemasından da geçemez, ikisi de `z.enum(REGIONS)`'a genişletilir)` · `apps/api/prisma/schema.prisma` + migration (CHECK genişlemesi) · `packages/contract/openapi/paths/auth.yaml` (signup gövdesi) · `apps/api/src/routes/auth.ts` · `PLAN.md` §0 + §D

REFERANS DESEN: `CHANNEL_TYPES`/`SUBSCRIPTION_STATUSES` gibi `as const` birlik listeleri + Prisma CHECK kısıtı ikilisi; `packages/contract` → `openapi-typescript` → generated tip zinciri (ADR-05, contract-parity testi iki yönlüdür).

KAPSAM DIŞI: zorlama (C4-b), BAA (C4-d), UI (C4-c).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

**IMMUTABILITY NEREDE ZORLANIR — bu pencerede karara bağlanır ve testle kanıtlanır** (denetim bulgusu; etiket bu yüzden `OPUS-MAX`'a yükseltildi): `region` bir çapraz-kesen veri modeli invaryantıdır. Uygulama katmanında bir `if` olarak kalırsa `C4-b`/`C4-e`'nin tüm bölge zorlaması aşındırılabilir bir temele oturur. Kırılım **DB düzeyinde** zorlamayı önerir (UPDATE'i reddeden trigger ya da kolon izni); karar §C'ye yazılır ve testi "SQL'den doğrudan UPDATE denemesi reddedilir" olarak koşulur.

**BÖLGE KODLARI:** PRD NFR-C9 bölgeleri `dal` (US) / `fra` (EU) diye isimlendiriyor; bu depo ADR-12 gereği `eu`/`us` kullanıyor. Fark bilinçlidir ve §D'ye tek satırlık sapma olarak yazılır (denetim bulgusu K1-9).

### 82.2. C4-b [OPUS-MAX] Bölge zorlaması çekirdeği (BÖLÜNMEZ) — API + RTM + customer token üçünde misdirected_request (421)

**Status:** done  
**Dependencies:** 82.1  

Bölge zorlaması çekirdeği (BÖLÜNMEZ) — API + RTM + customer token üçünde misdirected_request (421)

**Details:**

C4-b — Bölge zorlaması çekirdeği (BÖLÜNMEZ) — API + RTM + customer token üçünde misdirected_request (421)  [OPUS-MAX]

PRD: C4 (PLAN §6.1 · dilim V3-1 · tm 82)
TAHMİN: ~3 pencere

BÖLÜNMEZ ÇEKİRDEK (PLAN §5.1.2). Gerekçe: bölge kararı ÜÇ ayrı giriş yüzeyinde (REST `onRequest`, RTM `login`, customer/widget token verme) AYNI olmak zorundadır. Üçünü ayrı pencerelere bölmek "REST reddediyor ama WebSocket kabul ediyor" durumunu üretir — ve veri ikametinin fiilen ihlal edildiği yer tam olarak orasıdır.

**MEVCUT DURUM (denetim düzeltmesi — "karar noktası yok" iddiası YANLIŞTI):** REST tarafında kapı ZATEN VAR — `apps/api/src/plugins/auth.ts:268-274` `X-Region` başlığını okuyup `misdirected_request` fırlatıyor. Eksik olan iki şey: (1) karşılaştırmanın SAĞ TARAFI süreç env'i (`env.SIYAHTUS_REGION`) — **lisansın bölgesi olmalı**; (2) RTM ve customer-token yüzeylerinde kapı **hiç yok**. Yani iş "sıfırdan kapı kurmak" değil, "var olan kapıyı doğru şeye bağlamak + iki yüzeye taşımak". İkinci bir kontrol EKLEME — var olanı düzelt. Hata tipi hazır: `packages/types/src/errors.ts:42,94` (`misdirected_request` → 421).

KAPSAM: isteğin hedef bölgesi (env `SIYAHTUS_REGION` / `X-Region`) ile lisansın bölgesi uyuşmuyorsa `misdirected_request`. Üç yüzey: (1) `apps/api/src/plugins/auth.ts` onRequest zinciri, (2) `apps/rtm/src/auth.ts` + `dispatcher.ts` login yolu, (3) `apps/api/src/services/auth/customer-token.ts`.

DOSYALAR: `apps/api/src/plugins/auth.ts:268-274` · `apps/api/src/config/env.ts:16` · **`apps/rtm/src/config/env.ts:5`** · `apps/rtm/src/auth.ts` · **`apps/rtm/src/dispatcher.ts:20,64,86`** (login yolu — denetim düzeltmesi: `connection.ts` içinde `login` HİÇ geçmiyor) · `apps/api/src/services/auth/customer-token.ts` · `apps/api/src/lib/api-error.ts`

REFERANS DESEN: tm 80 `08.9.6-e` — IP allowlist enforcement'ın auth onRequest kapısı; aynı yere, aynı sırayla takılır. Mevcut `X-Region` doğrulaması (§C-A6: "başlık doğrulanır ama tek değer kabul eder") bu turda GERÇEK karara dönüşür.

DİKKAT: RTM ve API ayrı süreçlerdir; ikisinin de aynı env'i okuduğundan ve aynı kararı verdiğinden emin ol. Test ikisini AYRI AYRI kanıtlamalı.

KAPSAM DIŞI: HIPAA kısıtları (C4-e), UI (C4-c/-f).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

**BÖLGE REDDİ AUDIT EYLEMİ BU ALT-GÖREVE AİTTİR** (denetim bulgusu K5-4): §6.2.1 dilim sırasını _"`auth.sso_login`, `auth.sso_login_failed` ve bölge reddi olayları `AUDIT_ACTIONS`'a V3-1'de girer"_ gerekçesine dayandırıyor; ama ilk kırılımda bölge reddi için hiçbir alt-görevde eylem yoktu. `security.region_rejected` eylemi `AUDIT_ACTIONS`'a burada eklenir ve reddedilen istekte yazılır (adres/token DEĞİL, yalnız lisans + istenen bölge). Emsal: `auth.ip_denied` (tm 80 · `08.9.6-e`) — aynı sınıf, aynı minimizasyon.

### 82.3. C4-c [SONNET-XHIGH] Onboarding/kayıt akışında bölge seçimi + "sonradan değiştirilemez" uyarısı

**Status:** done  
**Dependencies:** 82.1  

Onboarding/kayıt akışında bölge seçimi + "sonradan değiştirilemez" uyarısı

**Details:**

C4-c — Onboarding/kayıt akışında bölge seçimi + "sonradan değiştirilemez" uyarısı  [SONNET-XHIGH]

PRD: C4 (PLAN §6.1 · dilim V3-1 · tm 82)
TAHMİN: ~1 pencere

KAPSAM: signup/onboarding adımına bölge seçimi (EU / US) + seçimin KALICI olduğunu söyleyen açık uyarı. Varsayılan `eu`.

DOSYALAR (denetim sonrası TESPİT EDİLDİ, artık ismen): `apps/web/src/features/auth/PublicPages.tsx:141` (`SignUpPage`, `/auth/signup` POST'u `:155`) · `apps/web/src/features/auth/PublicPages.test.tsx`. **Onboarding sihirbazı DEĞİL** — `OnboardingWizard.tsx`'in adımları `welcome|website|team|sample` (`:23-25`), bölge oraya ait değil. Bölge alanı `C4-a`'nın signup gövdesine eklediği `region` alanına gider.

REFERANS DESEN: mevcut onboarding sihirbazı adım kalıbı (`lib/stepper.ts`) + `lib/form.tsx` validasyon primitifi. Uyarı için `components/ui/Banner.tsx`.

KAPSAM DIŞI: zorlama (C4-b), BAA kartı (C4-f).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 82.4. C4-d [OPUS-XHIGH] BAA durumu — licenses.hipaa_baa_signed_at + kabul akışı (MOCK) + compliance.baa_signed audit

**Status:** done  
**Dependencies:** 82.1  

BAA durumu — licenses.hipaa_baa_signed_at + kabul akışı (MOCK) + compliance.baa_signed audit

**Details:**

C4-d — BAA durumu — licenses.hipaa_baa_signed_at + kabul akışı (MOCK) + compliance.baa_signed audit  [OPUS-XHIGH]

PRD: C4 (PLAN §6.1 · dilim V3-1 · tm 82)
TAHMİN: ~1 pencere

KAPSAM: `licenses.hipaaBaaSignedAt DateTime?` + kabul ucu (`POST /settings/compliance/baa`) + `compliance.baa_signed` audit eylemi. İmza MOCK'tur: gerçek sözleşme metni, imza sağlayıcı veya hukuki akış YOKTUR — yalnız "bu lisans için BAA kabul edildi" kaydı (CLAUDE.md: dış servisler mock).

KISIT: BAA yalnız `region='us'` lisansta kabul edilebilir (PRD NFR-C4: "HIPAA yalnız US hosting + BAA"). `eu` lisansta uç 4xx döner.

YETKİ: yalnız `owner` (admin YETMEZ) — §C-A20.

DOSYALAR: `apps/api/prisma/schema.prisma` + migration · `apps/api/src/routes/settings.ts` · `apps/api/src/services/audit/audit-log.ts` (AUDIT_ACTIONS) · `packages/contract/openapi/paths/settings.yaml`

REFERANS DESEN: `routes/settings.ts` mevcut `settings.*` audit'li mutasyon kalıbı; rol kapısı `services/auth/principal.ts:70` `roleAtLeast`.

KAPSAM DIŞI: HIPAA kısıtlarının fiilen uygulanması (C4-e).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 82.5. C4-e [OPUS-MAX] HIPAA kapsam kısıtları (BÖLÜNMEZ) — retention tavanı + PII maskesi sertleşmesi + AI bölge sınırı

**Status:** done  
**Dependencies:** 82.2, 82.4  

HIPAA kapsam kısıtları (BÖLÜNMEZ) — retention tavanı + PII maskesi sertleşmesi + AI bölge sınırı

**Details:**

C4-e — HIPAA kapsam kısıtları (BÖLÜNMEZ) — retention tavanı + PII maskesi sertleşmesi + AI bölge sınırı  [OPUS-MAX]

PRD: C4 (PLAN §6.1 · dilim V3-1 · tm 82)
TAHMİN: ~2 pencere

BÖLÜNMEZ ÇEKİRDEK (PLAN §5.1.2). Gerekçe: "bu lisans HIPAA kapsamındadır" bir YETKİ değil bir KISIT anahtarıdır ve üç sonucu vardır: (1) zorunlu retention tavanı, (2) log/telemetri PII maskesinin sertleşmesi, (3) AI çıkarımının bölge dışına çıkmasının reddi. Ayrılırsa "BAA imzalı ama transcript'i başka bölgeye giden" bir hesap doğar — ürünün verdiği uyum sözünün fiilen boş olması budur.

KAPSAM: BAA imzalı lisansta — retention politikasının üst sınırı zorlanır (sınırsız seçilemez), `plugins/telemetry.ts` + pino redaction sertleşir, AI çağrısı bölge dışına çıkamaz (mock sağlayıcıda bile karar YAZILIR ki gerçek sağlayıcıya geçişte kapı hazır olsun).

DOSYALAR: `apps/api/src/services/retention/policy.ts` · `apps/api/src/server.ts` (pino redact) · `apps/api/src/telemetry/telemetry.ts` · `apps/api/src/services/ai/` (sağlayıcı seçim noktası) · `apps/api/src/lib/cc-mask.ts` (emsal)

REFERANS DESEN: `lib/cc-mask.ts` (GL-5 · tm 70) — "yazma anında maskele, yalnız UI'da değil" ilkesi buraya birebir taşınır. `services/retention/policy.ts` mevcut plan bazlı saklama kalıbı.

KAPSAM DIŞI: gerçek çok-bölgeli barındırma (§D97 — süreç/altyapı payı, bu depoda yapılamaz).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 82.6. C4-f [SONNET-XHIGH] Settings → Security: HIPAA/BAA durum kartı + bölge gösterimi

**Status:** done  
**Dependencies:** 82.4  

Settings → Security: HIPAA/BAA durum kartı + bölge gösterimi

**Details:**

C4-f — Settings → Security: HIPAA/BAA durum kartı + bölge gösterimi (salt-okunur)  [SONNET-XHIGH]

PRD: C4 (PLAN §6.1 · dilim V3-1 · tm 82)
TAHMİN: ~1 pencere

KAPSAM: Settings → Security altında "Veri bölgesi ve uyumluluk" kartı — bölge (**salt-okunur**, "kayıtta sabitlendi" notu), BAA durumu (imzalı/imzasız + tarih), `us` lisansta owner için **BAA kabul butonu** (bu bir mutasyondur; başlıktaki "salt-okunur" ibaresi denetimde kaldırıldı, yalnız BÖLGE gösterimi salt-okunurdur).

**ROL KAPISI (denetim bulgusu):** butonu yalnız `owner` GÖRÜR — `admin` de GÖRMEZ. Sunucu kapısı `C4-d`'dedir (`owner`, `roleAtLeast` değil kesin eşitlik); bu ekran onu YANSITIR, kendi kararını vermez.

DOSYALAR: `apps/web/src/features/settings/Compliance.tsx` (yeni) + test · `apps/web/src/features/settings/SettingsPage.tsx`

REFERANS DESEN (birebir): `apps/web/src/features/settings/IpAllowlist.tsx` bölüm yerleşimi · rol kapılı buton kalıbı `TeamPage` rol menüsü · boş/yükleme durumları `apps/web/src/components/Skeleton.tsx` + `apps/web/src/components/EmptyState.tsx` (EK-B.1 — denetim düzeltmesi: bunlar `components/ui/` altında DEĞİL, bir üst dizinde).

KAPSAM DIŞI: e2e (C4-g).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 82.7. C4-g [OPUS-XHIGH] Uçtan uca doğrulama — 421 üç yüzeyde + immutability + BAA'sız hesapta kısıt yok + cross-tenant

**Status:** done  
**Dependencies:** 82.2, 82.5, 82.6  

Uçtan uca doğrulama — 421 üç yüzeyde + immutability + BAA'sız hesapta kısıt yok + cross-tenant

**Details:**

C4-g — Uçtan uca doğrulama — 421 üç yüzeyde + immutability + BAA'sız hesapta kısıt yok + cross-tenant  [OPUS-XHIGH]

PRD: C4 (PLAN §6.1 · dilim V3-1 · tm 82)
TAHMİN: ~1 pencere

KAPSAM: (1) yanlış bölge → 421: API, RTM ve widget/customer token yollarının ÜÇÜ AYRI AYRI kanıtlanır. (2) region immutability negatifi. (3) BAA imzasız hesapta HIPAA kısıtının UYGULANMADIĞININ kanıtı (yanlış-pozitif kısıt yok). (4) cross-tenant. (5) e2e: bölge seçimiyle kayıt → uyumluluk kartı (kanıt PNG `apps/e2e/kanit/C4-region-compliance.png`).

DOSYALAR: `apps/e2e/tests/compliance.spec.ts` (yeni) · `apps/api/test/integration/region.test.ts` · `apps/rtm/test/integration/rtm.test.ts` · `apps/e2e/kanit/`

KAPI: bu alt-görev yeşile dönmeden kalem ✅ olmaz.

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

**YETKİ REDDİ NEGATİFİ (denetim bulgusu K1-2 · ZORUNLU):** BAA kabul ucunun `hipaa` yetkisi olmadan (`growth` planı) ilgili uçlar **REDDEDİLMELİDİR**. Bu test bu alt-görevin süitindedir; kapı `11.5-b`'de kurulur (tm 84). `tm 84` bu kalemden SONRA koşacaksa test önce `skip` değil, **kapı kurulana kadar kırmızı bırakılmaz** — sıralama gereği `11.5-b` daha önce bitmiş olmalıdır (bkz. §6.2 bağımlılık notu).
