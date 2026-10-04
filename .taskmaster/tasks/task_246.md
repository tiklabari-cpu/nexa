# Task ID: 246

**Title:** V8-KB-SKILL-GAPS [SONNET-XHIGH] Playbook/KB'nin uc cagrilmayan yazma ucu — silme yok, public KB acilamiyor (tm 215 TRACKED)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** tm 215'in metot bazli taramasi uc ucu istemcisiz buldu: `DELETE /skills/{skillId}` · `DELETE /kb-articles/{articleId}` · `PUT /kb-settings`. Sonuncusu en agiri: public bilgi bankasi konsoldan HIC acilamiyor.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md`. DoD kapisi `CONVENTIONS.md` §1; git akisi §2; handoff §3. Sinirlar `CLAUDE.md`.

KAYNAK: tm 215 (V8-DEADEND) `scripts/audit/endpoint-ui.cjs`'in `TRACKED` listesi. Kalemler orada gerekcesiyle yazili; bu gorev ucunun de sahibidir.

(a) UC KALEM:
1. `PUT /kb-settings` — EN ONEMLISI. `routes/kb.ts:453` `{ scopes: WRITE, minimumRole: 'admin' }` ile yaziyor; `KbArticleEditor.tsx:127` ucu yalniz OKUYOR ve `settings.enabled` false ise yazmayi kapatiyor. Yani ayari bilen tek ekran, o ayar yuzunden kilitli olan ekran — konsolda public KB'yi acan hicbir dugme yok. Kanit metni bunu "the one screen that knows about the setting is the one blocked by it" diye kaydediyor.
2. `DELETE /kb-articles/{articleId}` — `KbArticleEditor` yayindan kaldirabiliyor (`status: 'draft'`), silemiyor. Yanlis bir makale gizleniyor ama calisma alanindan cikarilamiyor.
3. `DELETE /skills/{skillId}` — `PlaybookPage.tsx:165/195` create, `SkillEditor.tsx:213` + `useSkillActiveToggle.ts:38` patch var; silme yok, liste birikiyor.

(b) KAPSAM: YENI UC ACILMAZ, kontrat DEGISMEZ. Yalniz `apps/web` yuzeyi. KB ayarlari icin dogal yer `PlaybookPage`'in KB sekmesi (`kb-tabs.ts`) ya da `KbArticleList` basligi; `settings/PublicPages.tsx` ile CAKISMA kontrolu yapilmali — `kb-settings` ayri bir kayittir. Silme yuzeyleri icin emsal: tm 215'in `playbook/KbCategoryManager.tsx`'i (onay adimli satir ici silme) ve `DeveloperPortal.tsx`'in silme onayi.

(c) TUZAK: `PUT /kb-settings` `minimumRole: 'admin'` — yuzey `Compliance.tsx`/`AccessReviewExport.tsx`'in nezaket gizlemesi desenini kullanmali (rol admin/viceowner/owner degilse dugme hic gorunmesin), ama sunucu gercek sinir olarak kalir. KB kapaliyken makale yazmayi engelleyen mevcut banner'in metni ("Turn it on in KB settings") artik gercek bir yere isaret etmeli.

(d) KAPANIS OLCUTU: `pnpm audit:endpoint-ui` exit 0 ve kapatilan kalemler `TRACKED` listesinden CIKMIS (betik kalmis bir kaydi "IS called now" diye kirmizi yapar). `apps/api/src/config/endpoint-ui-audit.test.ts` degismeden yesil.

**Test Strategy:**

Web unit: KB ayarlari kaydediliyor (PUT govdesi dogru), rol yetersizken yuzey yok; makale silme onay istiyor ve DELETE cagiriyor; skill silme ayni. `pnpm audit:endpoint-ui` exit 0 + kapatilan kalemler `TRACKED`ten dusmus. E2E: public KB acildiktan sonra makale yazma banner'i kayboluyor (mevcut `playbook.spec.ts` akisina eklenebilir). Tam DoD kapisi exit 0.
