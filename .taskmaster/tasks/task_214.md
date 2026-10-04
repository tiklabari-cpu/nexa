# Task ID: 214

**Title:** V8-CAMP-DELIV [SONNET-XHIGH] campaignPerformance.displayed teslim edileni saysin, satir sayisini degil (FR-MOD-03.3.1-.3)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Kampanya performansinin `displayed` figuru `campaign_sends` SATIR SAYISI. Satir teslim edilmeden de yaziliyor, yani hic gosterilmemis bir kampanya "gosterildi" sayiliyor ve donusum oraninin paydasi sisiyor. Sessiz bir metrik yanlisi.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1; git akisi §2; handoff bicimi §4. Sinirlar `CLAUDE.md`.
Bu gorev PLAN.md §6D (FAZ 8 — Kalan Gereksinim Borclari, §D149) kaleminin Task Master karsiligidir.
DIKKAT: PLAN.md ~2,3 MB — BASTAN SONA OKUMA. Hedef satiri `grep -n` ile bul, cevresindeki ~30
satiri oku. Kanit metni tablo hucresinde DEGIL, `## K. Kanit Gecmisi` altindaki `#### K<kod>`
blogundadir (CONVENTIONS §1.2) — ve gecerli olan blogun SON maddesidir, ortadaki `◐` glifleri
tarihcedir.
KAYITLI KARAR ARAMASI (§D149un dersi): damgayi degistirmeden once `grep -n "D1[0-9][0-9] (" PLAN.md`
ile ilgili kodu ara ve `git log --oneline --since=2026-08-30` ile denetimden SONRA is yapilmis mi bak.
NUMARALANDIRMA: bu faz **8**dir — `Faz-7` §7Cnindir (tm 175-184). Onek `V8-`, `V7-` KULLANMA.

(a) GEREKCE + KANIT:
`apps/api/src/services/campaigns/campaign-matching.ts:187`:
  `return { displayed: sends.length, chats, conversion };`
`campaign_sends` satiri teslimattan ONCE yaziliyor; `delivered_at` sutunu (NULL = henuz teslim
edilmedi) tam da bunun icin eklendi — `M-CAMP-a` (tm 176.1, migration
`20260831100000_campaign_sends_delivered_at`). `#### K03.3.1-.3` bunu "Kalan" olarak yazmis ve
"metrik tanimi tm 176.4un karari" demis, ama gorev ACILMAMIS; panel bunu `suspicious-done` olarak
bildiriyor (satir `✅` ama kanit blogu acik is anlatiyor).
Mevcut test: `campaign-matching.test.ts:198` "counts displayed / chats / conversion from the sends"
-> `{ displayed: 3, chats: 2, conversion: 1 }`; `:209` bos liste -> sifirlar.

(b) DOKUNULACAK DOSYALAR:
- `apps/api/src/services/campaigns/campaign-matching.ts` — `campaignPerformance` (saf fonksiyon).
- `apps/api/src/services/campaigns/campaign-matching.test.ts` — mevcut 3/2/1 senaryosu REGRESYON
  olarak KORUNUR (teslim edilmis satirlarla), yanina teslim edilmemis satir senaryosu eklenir.
- `campaignPerformance`in cagiranini bul (`grep -rn "campaignPerformance" apps/api/src`) — okunan
  satirlarin `delivered_at` alanini TASIDIGINDAN emin ol; tasimiyorsa sorguya eklenir.
- `PLAN.md` `#### K03.3.1-.3` — bu turun maddesi (satir zaten `✅`, damga DEGISMEZ).
- Migration YOK (sutun zaten var). Sozlesme degisikligi YOK (alan adi ayni, anlami duzeliyor).

(c) CONTRACT-FIRST SIRA: sozlesme degismiyor -> saf fonksiyon + tablo testi -> cagiranin sorgusu
-> integration.

(d) BILINEN TUZAKLAR:
- `conversion` paydasi da ayni tanima hizalanmali, yoksa iki metrik birbiriyle celisir
  (`displayed` teslim edileni, `conversion` hepsini sayarsa oran anlamsizlasir). Karari gorev
  icinde ver ve `#### K03.3.1-.3`e YAZ.
- `engaged` bayragi AYRI bir kavramdir (M-CAMP-d, tm 176.4) — teslim ile karistirma.
- Widget yoklamasi (`GET /customer/chat`) teslimat damgasini basan yerdir (M-CAMP-b); bu gorev
  o yola DOKUNMAZ, yalniz okuma tarafini duzeltir.

(e) KAPSAM SINIRI: teslimat yolu (M-CAMP-b/-c/-e) DEGISMEZ · `engaged` tanimi DEGISMEZ ·
kampanya durumu yeniden degerlendirme (M-CAMP-f) DEGISMEZ · UI metin/rozet degisikligi YOK.
(f) KAPANIS: DoD kapisi yesil -> commit + push (Conventional Commit; PLAN.md satir damgasi
`◐ → ✅` + `#### K<kod>` bloguna kanit maddesi + HANDOFF.md girisi AYNI commite girer) ->
Task Master `done`. Calisma alanini kirli BIRAKMA.

**Test Strategy:**

Tam DoD kapisi exit 0 (`typecheck` · `lint` · `format:check` · `build` · `db:check-drift` · `audit:req-coverage`). Birim: `campaign-matching.test.ts` — (1) MEVCUT 3/2/1 senaryosu, satirlarin ucu de `delivered_at` dolu olacak sekilde, AYNI sonucu verir (regresyon); (2) `delivered_at: null` tasiyan satir `displayed`e SAYILMAZ; (3) hepsi teslim edilmemisse `displayed: 0` ve `conversion` payda sifirinda patlamaz (NaN/Infinity DONMEZ); (4) bos liste hala sifirlar. Integration: kampanya raporu ucunun yanitinda teslim edilmemis gonderim sayilmiyor + cross-tenant negatif (A lisansinin gonderimi Bnin figurunu etkilemez). Kapanis olcusu: `grep -n "sends.length" apps/api/src/services/campaigns/campaign-matching.ts` sonucsuz.
