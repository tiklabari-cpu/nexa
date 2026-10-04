# Task ID: 196

**Title:** V1-SKILLROW [SONNET-XHIGH] Skill satirinda tarih + sahip (FR-MOD-05.5)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** PRD 05.5 satirin icerigini tek tek sayiyor: "ikon + Name + `N runs` + tarih + sahip + [+AI agent] + chat-trigger + enable toggle". Satirda isim, adim sayisi, `N runs`, durum noktasi ve canli enable/disable toggle VAR; tarih ve sahip YOK. `updated_at` API`de doniyor ama satirda hic basilmiyor; `created_by` DB`ye yaziliyor (playbook.ts:324) ama `serialiseSkill` hic dondurmuyor, dolayisiyla "sahip" yalnizca bir filtre ekseni olarak yasiyor.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## (a) Bu isi doguran gerekce

tm 184.4 (M-TRACE-d · `cf9ad43`) PLAN.md damgalarini `prd-uyum-denetimi.md`ye (2026-08-30, 12 denetci +
12 curutucu ajan) karsi yeniden okudu ve v1`in 11 `Must` satirini `✅`ten `◐`ye indirdi; §F.00`in mekanik
kurali geregi ("bir faz ancak `Must` kapsaminda 0 ◐ ve 0 ⬜ kaldiginda kapanir") v1 kapisi `❌ ACIK`a dondu.
tm 186 o 11 kalemi tek tek triyaj etti: `08.5.5` denetimden SONRA kapanmisti (G1), `05.1` ve `05.3`in
kalan bosluklari **ADR-14 ile kapsam disi** cikti (damga `✅`e alindi), kalan 8 kalem is gorevine
donusturuldu. Bu gorev o gorevlerden biridir.

Kapanis kosulu tek: **PRD kabul kriteri (KK)**. "Kod var + test yesil" YETMEZ — GL-3/GL-4/GL-8`in hatasi
tam olarak buydu ve M-TRACE ailesi (tm 184.1-184.3) bu kapiyi teshis etti. Kanit blogu PLAN.md`nin
`## K. Kanit Gecmisi` bolumundedir (`#### K<kod>`), tablo hucresinde DEGIL (CONVENTIONS §1.2).

**Denetim metni KIRIK — ona guvenme.** `prd-uyum-denetimi.md` Ek A`nin "Eksik olan" hucresi kaynagında
`…` ile kesiliyor (ornek: `FR-MOD-06.2.4` "Eksikler…"). Karar PRD`nin KK sutununa + koda karsi verilir;
asagidaki "Eksik olan" maddeleri tm 186 turunda `grep`/`sed` ile FIILEN dogrulandi, denetimden
kopyalanmadi.

## (b) Kapsanan PLAN satiri

| PLAN satir (2026-09-04) | Kod | Kanit blogu |
| --- | --- | --- |
| 573 | 05.5 | `#### K05.5` |

## (c) Eksik olan (olculdu, 2026-09-04)

- **Tarih basilmiyor.** `serialiseSkill` (`apps/api/src/routes/playbook.ts:870-880`) `updated_at`
  donduruyor ve `apps/web/src/features/playbook/types.ts` `Skill.updated_at` tasiyor, ama
  `PlaybookPage.tsx`in skill satiri onu render etmiyor (satirda yalniz `runsCount` var, :573).
  `formatDate` ayni dosyada zaten kullaniliyor (:925, knowledge tablosu) — yeni yardimci gerekmez.
- **Sahip hic uctan gelmiyor.** `createdBy` yaziliyor (`playbook.ts:324`) ama `serialiseSkill` alan
  listesinde YOK (`id/ai_agent_id/name/kind/instruction/steps/active/runs_count/updated_at`).
  Yani sozlesme degisikligi gerekiyor: contract-first sira burada FIILEN calisir.

## (d) Dokunulacak dosyalar

- `packages/contract/**` (playbook spec) + `packages/types` — `Skill` payload`ina sahip alani.
- `apps/api/src/routes/playbook.ts` — `serialiseSkill` (:858-880) ve onu besleyen `select`/`include`.
- `apps/web/src/features/playbook/types.ts` — `Skill` arayuzu.
- `apps/web/src/features/playbook/PlaybookPage.tsx` — skill satiri (:560-580).
- `apps/web/src/features/playbook/skill-filter.ts` — sahip ekseninin BUGUNKU tanimi burada.

## (e) Bilinen tuzaklar

1. **"Sahip" iki farkli sey demek olabilir — kararini yaz.** `skillMatchesControls` bugun owner`i
   `ai_agent_id`ye esitliyor ve dosyanin kendi yorumu bunu itiraf ediyor; denetim bunu `05.4`
   (Should) altinda ayri bir kusur olarak isaretledi. Satirin "sahip"i PRD`de bir KISI (skill`i kim
   olusturdu) anlamina geliyor. Ikisini karistirma; `05.4`un filtre kusurunu bu turda DUZELTME
   (ayri satir, ayri karar) ama daha da BOZMA.
2. `created_by` bir hesap kimligi; satirda ham UUID gostermek kullaniciya hicbir sey anlatmaz.
   Ada cevirmek bir join/lookup ister — `agents`/`accounts` uzerinden. Kaynak yoksa "—" bas,
   UUID BASMA.
3. Sozlesme degistigi icin `pnpm -w contract:generate` sonrasi `git status --short
   packages/contract/src/generated` BOS olmali (CONVENTIONS §1). Yeni bir OpenAPI YOLU acilmiyor,
   yalniz mevcut semaya alan ekleniyor — `apps/mobile` uc-sayisi parite testi bu yuzden bozulmamali;
   yine de kos ve dogrula.
4. `apps/web` vitest CPU yuku altinda `userEvent` testlerinde 5000 ms timeout verir; `--maxWorkers=4`.

## Kapsam SINIRI

YALNIZ `05.5`. `05.1`/`05.3` bu turda `✅`e alindi (ADR-14 kapsam daraltmasi) — damgalarina DOKUNMA.
`05.4` (Should) liste kontrolleri ve onun sahip-filtresi kusuru kapsam disi. `[+AI agent]` rozeti ve
chat-trigger gostergesi PRD satirinda geciyor: satirda `ai_agent_id` zaten var, rozet ucuzsa ekle,
chat-trigger ayri bir veri kaynagi istiyorsa EKLEME ve neden eklemedigini `#### K05.5` blogunda yaz.

## Kapanista yapilacak PLAN.md guncellemesi

Ilgili `Must` satirinin damgasi `◐ → K<kod>` yerine `✅ → K<kod>` olur (PLAN.md §4.1/4.2/4.3; satir no
`grep -n` ile bulunur — 2026-09-04 itibariyle gecerli satir numaralari yukarida yazili, dosya degistikce
kayar). Tek bir alt-gorev bir satiri tek basina kapatiyorsa o satiri o alt-gorev cevirir. Kanit tablo
hucresine YAZILMAZ; `#### K<kod>` blogunun sonuna madde olarak eklenir:
`- ✅ <ne yapildi> — `<dosya>` · test `<dosya>` (n) · tm <id>`.
v1 `Must` sayaci (PLAN.md:19 kapi tablosu) her kapanan satirda guncellenir.

Kapanis dogrulamasi: `grep -n "| 05.5 " PLAN.md`
cikan durum-damgali satirlarda `◐` KALMAMALI.

**Test Strategy:**

OLCULEBILIR KAPI:
1. `apps/api` birim/entegrasyon testi: `GET /skills` yanitindaki her ogenin sahip alanini tasidigi,
   ve `createdBy` NULL olan (sistem/seed) bir skill icin alanin `null` dondugu — ikisi de iddia edilir.
2. `apps/web` birim testi (`PlaybookPage.test.tsx` ya da yeni `skill-row.test.tsx`): bir skill satiri
   render edilince (a) bicimlenmis tarih, (b) sahip adi gorunur; sahip yoksa "—" gorunur ve HICBIR
   testte ham UUID beklenmez (`expect(...).not.toMatch(/[0-9a-f]{8}-/)`).
3. Test basliklari CONVENTIONS §7 bicimiyle `(FR-MOD-05.5)` etiketi tasir; `pnpm audit:req-coverage`
   exit 0 ve `FR-MOD-05.5` artik etiketli sayilir.
4. TAM DoD kapisi (CONVENTIONS §1, parcalama §1.3): typecheck · lint · format:check · build · unit ·
   integration · `contract:generate` sonrasi generated senkron. Sema degismedigi icin `db:check-drift`
   yalniz teyit amaclidir.
5. PLAN.md: `grep -n "| 05.5 " PLAN.md` durum-damgali satirinda `◐` kalmamis olmali.
