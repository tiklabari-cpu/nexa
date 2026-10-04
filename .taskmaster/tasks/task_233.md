# Task ID: 233

**Title:** V8-E2E-CAPACITY [OPUS-XHIGH] e2e tam suiti suit-ici kapasite birikmesiyle 4 test dusuruyor

**Status:** done

**Dependencies:** 208 ✓

**Priority:** high

**Description:** Tam e2e suiti (279 test) dort kirmizi veriyor; dordu de ayni fixture'a karsi ayri kosuldugunda yesil. Kok neden olculdu: suitin kendi onceki testlerinin biraktigi acik sohbetler demo ajani concurrent_chats_limit'ine dolduruyor, sonraki yonlendirme testleri atama alamiyor.

**Details:**

(a) GEREKCE + OLCULEN KANIT (tm 208 · GL-13 kapanis turu, 2026-09-07):
Tam suit: 279 test, 22,0 dk, **275 gecti / 4 dustu**:
  - `entitlements.spec.ts:99` (white-label · 11.5-b/-c) — "Save appearance" disabled bekleniyor, enabled geldi
  - `playbook.spec.ts:68` (05.6-tmpl31-d) — "Use template" dugmesi 1 bekleniyor, 11 geldi
  - `skills-routing.spec.ts:149` (FR-MOD-08.6.3) — "the chat never routed to the skilled agent", Received: null
  - `team.spec.ts:447` (FR-MOD-04.5) — "the chat never routed to the new team's member", Received: null
Dordu birlikte ayri kosuldugunda: **24/24 yesil, 4,0 dk**
(`npx playwright test tests/entitlements.spec.ts tests/playbook.spec.ts tests/skills-routing.spec.ts tests/team.spec.ts`).

BU BIR ESKI-KOSU KALINTISI DEGIL. `apps/e2e/tests/global-setup.ts` her kosuda
`SIYAHTUS_SEED_RESET=1` ile `pnpm db:seed` cagiriyor ve seed tenant tablolarini TRUNCATE ediyor
(tm 109'un cozumu). Yani veritabani her suit basinda temiz. Kirmiziyi ureten sey suitin
KENDI onceki testleridir.

OLCUM (tam kosunun hemen ardindan, `docker exec siyahtus-db psql`):
  - `select count(*) from chats` -> **136**
  - `select assignee_id, count(*) from threads where active is true group by 1`:
    `b0e29f98-355c-4753-8851-76627b25d12a` -> **6 aktif thread**
  - o ajanin `agent_memberships.concurrent_chats_limit` -> **6**
`b0e29f98…` tam olarak `skills-routing:149` ve `team:447`'nin bekledigi assignee. Yani
yonlendirici DOGRU davrandi (dolu ajana atama yapmaz) ve test `Received: null` gordu.
**Urun dogru, suit kirilgan.** GL-12'de (tm 168) suit 210 testken yesildi; bugun 279.

(b) YAPILACAK IS — uc secenekten biri, karar bu gorevin:
  1. **Testler kendi sohbetlerini kapatsin** (afterEach/afterAll ile deactivate) — en dar
     duzeltme, ama her yeni spec'in hatirlamasi gereken bir kural ekler.
  2. **Yonlendirme testleri kendi ajanini/workspace'ini kullansin** — `PAGING_OWNER`/
     `NORTHWIND` emsali (`fixtures.ts`); paylasilan demo ajanina hic dokunmazlar.
  3. **Fixture bir kapasite garantisi versin** — bir yardimci, testin bekledigi ajanin
     aktif thread sayisini sifirlar (dogrudan servis/API ile), boylece siralamadan
     bagimsiz olur.
`playbook.spec.ts:68` ve `entitlements.spec.ts:99` AYNI ailedendir ama farkli birikme
(sablon listesi / tier durumu) — ucunu de ayni turda oku, ayni cozum sekli uymayabilir.

(c) OLCULEBILIR KAPANIS: `pnpm -w test:e2e` (tam suit, tek kosu, shard'siz) **exit 0** ve
sayilar HANDOFF'a yazilir. Ayrica ikinci bir ardisik tam kosu da yesil olmali — birikme
sorunu tek kosuda gizlenebilir.

(d) BILINEN TUZAKLAR:
  1. Tam suit ~22 dk (yuklu makinede) ve pencere komut tavani 10 dk -> `--shard=1/2` +
     `--shard=2/2` ile parcala, ama SON dogrulama shard'siz olmali (siralama shard'da degisir).
  2. Suit ~55 `apps/e2e/kanit/*.png` yeniden yazar — beklenen churn, geri al.
  3. 4000/4001/5173/5174 bos olmali; bayat bir dev sunucu tum suiti karartir.
  4. Kok `.env` sourced olmali (`set -a && . ./.env && set +a`), yoksa webServer 60 sn'de
     `DATABASE_URL: Required` ile duser.
  5. `prisma migrate reset` bu depoda AI onayi olmadan kosmaz (Prisma guvenlik kapisi) —
     zaten gerekmez, `SIYAHTUS_SEED_RESET=1` truncate yolu vardir.

(e) KAPSAM SINIRI: urun kodu degismez (yonlendirici dogru davraniyor). Yalniz
`apps/e2e` altindaki spec/fixture. Faz-0/1/2 kapanis turlarini (tm 208/209/210) bloklamaz.
<info added on 2026-09-07 (tm 209 · GL-14)>
(f) GL-14 DUZELTMESI — DORT KIRMIZININ MEKANIZMASI ORTAK DEGIL (tm 209 · 2026-09-07):

GL-14 tam e2e suitini ikinci kez kosturdu: yine **275/279** (22,4 dk), kirmizilar BIREBIR ayni
dort test (`entitlements.spec.ts:99` · `playbook.spec.ts:68` · `skills-routing.spec.ts:149` ·
`team.spec.ts:447`), ve dordu birlikte ayri kosuldugunda yine yesil (**24/24**, 3,5 dk). Yani
(a)'daki "suit-sirasi bagimliligi" teshisi BAGIMSIZ OLARAK DOGRULANDI.

AMA §D151'in "dordu de SUIT-ICI KAPASITE BIRIKMESI" ifadesi FAZLA GENIS ve bu gorevi yanlis
yonlendirebilir. `playbook.spec.ts:68`'in hata imzasi yonlendiricinin `Received: null`'i DEGIL:

    Locator: getByRole('dialog', {name:'Browse templates'})
             .getByRole('button', {name:'Use template'})
    Expected: 1
    Received: 11        (23 x locator resolved to 11 elements, 10 sn boyunca SABIT)

Test `Search templates…` kutusuna 'warranty' yaziyor ve 1 kart bekliyor. **11**, sablon
katalogunun TAM BIR KATEGORISI kadardir: `apps/web/src/features/playbook/templates.ts` 33 sablon
tasiyor, ucu de 11'lik (`ai` · `prebuilt` · `trending`). `TemplateGallery.tsx:129-135` once
kategoriye sonra sorguya filtreliyor (`categoryTemplates.filter(templateMatchesQuery)`) — yani
filtre MANTIGI dogru; gorunen sey sorgunun HIC UYGULANMAMIS olmasidir.

OLCULEN: yalnizca IMZA FARKI. Mekanizma bu turda OLCULMEDI — asagisi hipotezdir, kanit degildir:
`fill()` ile arama kutusunun debounce'u (`TemplateGallery.tsx:122-125`) arasinda bir yaris.
Duzeltmeden once dogrulanmali.

BU GOREV ICIN SONUC: kapasite birikmesini duzeltmek (her spec'in kendi ajanini/limitini almasi)
muhtemelen `entitlements` · `skills-routing` · `team` uclusunu yesile cevirir ama
`playbook.spec.ts:68`'i BIRAKIR. Kapanis olcutu bu yuzden "dort testin dordu de TAM SUITTE
yesil" olmali; ucunun donmesi kapanis SAYILMAZ.

Kaynak: PLAN §KGL-14 (§F.1'in DoD maddesi) · HANDOFF tm 209 blogu.
</info added>

**Test Strategy:**

`set -a && . ./.env && set +a && pnpm -w test:e2e` tek kosuda exit 0 (shard'siz), ardindan AYNI komut ikinci kez exit 0 — birikme sorunu ancak ardisik iki yesil kosuyla kapanmis sayilir. Ek olarak, duzeltmenin dogru yerde oldugunu gosteren bir olcum: tam kosunun ardindan `select assignee_id, count(*) from threads where active is true group by 1` ciktisi hicbir ajan icin o ajanin `concurrent_chats_limit` degerine ULASMAMALI. Tam DoD kapisi (CONVENTIONS §1) exit 0.
