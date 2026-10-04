# Task ID: 144

**Title:** [SONNET-XHIGH] Plan reddi upsell kalsın: SsoConnection + Compliance + SiemExport `details.entitlement`'ı tanısın (ADR-06 ile birlikte)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Entitlement reddi üç ekranda hâlâ genel "That is not allowed here." cümlesine düşüyor; upsell kayboluyor. tm 133.12'nin WidgetCustomization'da açtığı deseni bu üçüne uygula ve e2e ile kapat.

**Details:**

KÖKEN: tm 133.12 (I18N-l) tam e2e süitini koştururken `entitlements.spec.ts` `WidgetCustomization.tsx`'te bir regresyon buldu — I18N-j (tm 133.10) ekranı `t(errorMessageKey(error))`'a taşırken plan reddini de ADR-06'nın genel `not_allowed` cümlesine ("That is not allowed here.") indirmişti. Sunucu bu reddi `entitlementDenied()` ile veriyor: type `not_allowed`, `details: { entitlement, plan }` (apps/api/src/lib/entitlements.ts). Genel cümle taksonomi açısından doğru ama bu ekranlarda YANLIŞ — redde bir upsell yükü var ("bu Enterprise özelliği, planı yükseltin"), genel cümle onu açıklanmamış bir başarısızlığa çeviriyor.

NE YAPILACAK: `Sandbox.tsx` / `SlaPolicy.tsx` / (tm 133.12'den sonra) `WidgetCustomization.tsx`'in kurduğu deseni üç ekrana daha uygula — `error instanceof ApiClientError && error.details?.['entitlement'] === '<key>'` ise kendi katalog cümlesini, değilse `t(errorMessageKey(error))`:
- `apps/web/src/features/settings/SsoConnection.tsx` → `entitlement: 'sso'` (settings.ts `/settings/sso*` yazmaları, `exactRole: 'owner'`; ayrıca `routes/scim.ts` SCIM uçları)
- `apps/web/src/features/settings/Compliance.tsx` → `entitlement: 'hipaa'` (`/settings/compliance/baa`)
- `apps/web/src/features/settings/SiemExport.tsx` → `entitlement: 'siem_export'` (`/settings/siem`, ayrıca `routes/audit-log.ts` export)
Her biri için `locales/{en,tr}/settings.ts`'e bir cümle (SLA'nın `settings.sla.entitlementError` emsali: hangi tier gerektiğini söyle, sunucunun İngilizce prose'unu BASMA — ADR-06).

Üç ekranın da reddi bugün hiçbir e2e tarafından sürülmüyor; kusurun gizli kalma sebebi bu. `entitlements.spec.ts`'in white-label bloğu (plan'ı `growth`'a indir → yazmayı dene → mesajı oku → `enterprise`'a geri al, `finally` içinde) birebir kopyalanabilir desen.

BAĞLAM (bu pencere sıfırdan açılır): TASK-RUNNER-PROMPT.md §0 sırası. Gereksinim satırı: `grep -n '| I18N1/2' PLAN.md`. Kanıt bloğu: `grep -n '^#### KI18N1-2' PLAN.md` (tm 133.12 maddesi bu kusuru adıyla kaydediyor). ADR-06 gerekçesi: `apps/web/src/locales/en/common.ts` dosya başlığı + `apps/web/src/lib/api-client.ts` `errorMessageKey()`.

KAPSAM DIŞI: yeni entitlement eklemek, sunucu tarafı mesaj değişikliği, diğer ADR-06 çağrı yerleri.

KAPANIŞ: TASK-RUNNER-PROMPT §3. DoD kapısı CONVENTIONS §1 (exit code'larla); e2e eklendiği için `pnpm -w test:e2e` tam süit yeşil olmalı.

**Test Strategy:**

- Üç ekran için birer jsdom testi: 403 + `details.entitlement` mock'la → alert kendi cümlesini taşıyor, "That is not allowed here." taşımıyor, sunucunun İngilizce prose'unu ("not included in the … plan") taşımıyor.
- `apps/e2e/tests/entitlements.spec.ts`'e üç blok (plan düşür → yazmayı dene → mesaj → plan geri al). `pnpm -w test:e2e` exit 0.
- typecheck/lint/format:check/build yeşil; `i18n-coverage.test.ts` kalan 0 kalmalı.
