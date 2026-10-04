# Task ID: 245

**Title:** V8-EDIT-GAPS [SONNET-XHIGH] Uc ayarlar ekraninda "yarat + sil var, DUZENLE yok" (tm 215 TRACKED)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** tm 215'in metot bazli `audit:endpoint-ui` taramasi uc PATCH ucunun hicbir istemcisi olmadigini olctu: `/settings/custom-fields/{fieldId}` · `/partner/apps/{clientId}` · `/reports/scheduled-exports/{scheduledExportId}`. Ucunde de konsol yaratabiliyor ve silebiliyor, degistiremiyor.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md`. DoD kapisi `CONVENTIONS.md` §1; git akisi §2; handoff §3. Sinirlar `CLAUDE.md`.

KAYNAK: tm 215 (V8-DEADEND) `scripts/audit/endpoint-ui.cjs` sayimini (yol) -> (yol + metot) ciftine cekti ve cagrilmayan her ucu uc listeden birine yazdi. Bu gorev o betigin `TRACKED` listesindeki uc kalemin sahibidir; kalemler orada tam gerekcesiyle yazili.

(a) UC KALEM (hepsi ayni sekil):
1. `PATCH /settings/custom-fields/{fieldId}` — `CustomFieldsSettings.tsx:45/58/63` list+create+delete cagiriyor, PATCH'i kimse cagirmiyor. Bir alan adindaki yazim hatasini duzeltmek = alani ve altindaki degerleri silmek. (`ChatFormsSettings.tsx:75` de ayni ucun DELETE'ini cagiriyor.)
2. `PATCH /partner/apps/{clientId}` — `DeveloperPortal.tsx:109/324/587/643` list+register+delete+rotate-secret var, PATCH yok. Yeni bir redirect URI eklemek client id'yi ve altinda uretilmis her token'i goturuyor. Sunucu tarafinda `narrowScopes` PATCH'te de uygulaniyor (`partner-apps.ts:190-193`) — yani duzenleme yuzeyi bir yetki yukseltme yolu ACMIYOR.
3. `PATCH /reports/scheduled-exports/{scheduledExportId}` — `ScheduledExports.tsx:52/78/83` list+create+delete var, PATCH yok. Tek bir aliciyi degistirmek zamanlamayi yeniden kurmayi gerektiriyor.

(b) KAPSAM: YENI UC ACILMAZ, kontrat DEGISMEZ — ucu de zaten var, testli ve OpenAPI'de. Yalniz `apps/web` yuzeyi eklenir. Emsal sekil: `settings/Brands.tsx`'in satir ici duzenlemesi (blur'da PATCH, sunucunun reddi satirin yaninda) ve tm 215'in `playbook/KbCategoryManager.tsx`'i — ikisi de ayni desen.

(c) KAPANIS OLCUTU: `pnpm audit:endpoint-ui` exit 0 ve uc kalem `TRACKED` listesinden CIKMIS olur (betik zaten "IS called now — the surface arrived, drop the entry" diye hata verir, yani listeyi temizlemeyi unutmak kapiyi kirmizi yapar). Ayrica `apps/api/src/config/endpoint-ui-audit.test.ts` degismeden yesil kalir.

(d) TUZAK: uc kalemi de tek turda bitirmek gerekmiyor — ama `TRACKED` listesinden bir kalemi cikarirken digerlerini birakmak serbesttir; betik kalem bazinda calisir.

**Test Strategy:**

Her ekran icin web unit testi: duzenleme kaydediliyor (PATCH cagriliyor, gonderilen govde dogru), sunucu reddi satirin yaninda gorunuyor, `canEdit=false` ile duzenleme yuzeyi yok. `pnpm audit:endpoint-ui` exit 0 ve kapatilan kalemler `TRACKED`ten dusmus. `apps/web` tam suiti `--maxWorkers=4` yesil; tam DoD kapisi exit 0.
