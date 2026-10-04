# Task ID: 194

**Title:** F0-BILLUI — Plan degisimi konsolda + trial kaleminin kalan payi (FR-MOD-10.1.1 · 10.2)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Denetim iki fatura kalemini KISMI buldu. 10.1.1: API tarafi eksiksiz ve testli (PATCH /billing/subscription plan kabul ediyor, bilinmeyen plani reddediyor, downgrade guard`i gercek) ama konsolun mutasyonu `plan` ALANINI HIC GONDERMIYOR — "Change plan" urunun icinden imkansiz. 10.2: trial cekirdegi eksiksiz ve testli; denetimin curutme turunda dusurdugu kalan pay belgede kesik, once o pay PRD KK`sina karsi yeniden turetilmeli.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## (a) Bu isi doguran gerekce

tm 184.4 (M-TRACE-d · `cf9ad43`) PLAN.md damgalarini `prd-uyum-denetimi.md`ye (2026-08-30, 12 denetci +
12 curutucu ajan) karsi yeniden okudu ve Faz-0`in 28 `Must` satirini `✅`ten `◐`ye indirdi; §F.00`in
mekanik kurali geregi ("bir faz ancak `Must` kapsaminda 0 ◐ ve 0 ⬜ kaldiginda kapanir") Faz-0 kapisi
`❌ ACIK`a dondu. tm 185 o 28 kalemi tek tek triyaj etti: 3 kalem denetimden SONRA kapanmisti (damga `✅`e
geri alindi), kalan 25 kalem is gorevine donusturuldu. Bu gorev o gorevlerden biridir.

Kapanis kosulu tek: **PRD kabul kriteri (KK)**. "Kod var + test yesil" YETMEZ — GL-3/GL-4/GL-8`in hatasi
tam olarak buydu ve M-TRACE ailesi (tm 184.1-184.3) bu kapiyi teshis etti. Kanit blogu PLAN.md`nin
`## K. Kanit Gecmisi` bolumundedir (`#### K<kod>`), tablo hucresinde DEGIL (CONVENTIONS §1.2).

## (b) Kapsanan PLAN satirlari

| PLAN satir (2026-09-04) | Kod | Kanit blogu | Alt-gorev |
| --- | --- | --- | --- |
| 283 | 10.1.1 | `#### K10.1.1` | 194.1 |
| 287 | 10.2 | `#### K10.2` | 194.2 |

## (c) Ana dosyalar

- `apps/web/src/features/billing/BillingPage.tsx` — `change` mutasyonu (:140-142, gövde tipi
  `{ billing_cycle?: string; seats?: number }`), `ManagePlan` bileseni (:424+).
- `apps/api/src/services/billing/subscription-service.ts:191-201` — downgrade guard`i (gercek, testli).
- `apps/api/src/plugins/license-gate.ts` — read-only kapisi; `allowWhenReadOnly` yalniz
  `routes/reports.ts:1803/1919/1968` (billing yazma) ve `routes/mcp.ts:74` uzerinde.
- `apps/api/src/services/auth/lifecycle-service.ts:23` (`TRIAL_DAYS = 14`) ·
  `services/billing/metering.ts:227` (`trialState`) · `AppShell.tsx:141-163` (`TrialBanner`).

## (d) Kapsam SINIRI

- YALNIZ iki satir. `10.1.4`/`10.1.5`/`10.3` DISARIDA (v1 ya da teslim edilmis).
- **GERCEK ODEME YOK** (MASTER-PROMPT siniri): kart, saglayici, para hareketi yok. Odeme yolu mock.

## Kapanista yapilacak PLAN.md guncellemesi

Bu ailenin TUM alt-gorevleri bittiginde ilgili `Must` satirinin damgasi `◐ → K<kod>` yerine
`✅ → K<kod>` olur (PLAN.md §3, satir no `grep -n` ile bulunur — 2026-09-04 itibariyle gecerli satir
numaralari asagida yazili, dosya degistikce kayar). Tek bir alt-gorev bir satiri tek basina kapatiyorsa
o satiri o alt-gorev cevirir. Kanit tablo hucresine YAZILMAZ; `#### K<kod>` blogunun sonuna madde
olarak eklenir: `- ✅ <ne yapildi> — `<dosya>` · test `<dosya>` (n) · tm <id>`.
Faz-0 `Must` sayaci (PLAN.md:18 kapi tablosu) her kapanan satirda guncellenir.

**Test Strategy:**

Aile ancak iki alt-gorev de DoD kapisindan gectiginde done. 194.2 sonucu "eksik yok" cikarsa satir `✅`e cevrilir ve gerekce kanit blogunda yazili olur; "eksik var" cikarsa ayni alt-gorev eksigi kapatir.

## Subtasks

### 194.1. F0-BILLUI-a [SONNET-XHIGH] Konsoldan plan degistirme (FR-MOD-10.1.1)

**Status:** done  
**Dependencies:** None  

PRD KK: "Plan tier gecisi; downgrade kisitlari (kullanim>plan)". Sunucu ikisini de yapiyor ve testli; konsol `plan` alanini hic gondermiyor — denetimin D2 deseni ("API`de var, konsolda yok").

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- `BillingPage.tsx:140-142`: `mutationFn: (body: { billing_cycle?: string; seats?: number }) =>
  api.patch("/billing/subscription", body)` — **`plan` alani yok**.
- `ManagePlan` bileseni yalniz `billing_cycle` (:472/:481) ve `seats` (:504/:519) gonderiyor.
- Sunucu: `PATCH /billing/subscription` plani kabul ediyor, bilinmeyen plani reddediyor, downgrade
  guard`i `subscription-service.ts:191-201`te GERCEK (yeni planin kotasi bu ayki kullanimin
  altindaysa red).

## Yapilacak

1. `ManagePlan`e plan tier secici ekle. Plan listesi **sunucudan** gelmeli (`grep`le bak: plan
   katalogu bir uctan mi geliyor yoksa sabit mi?) — istemciye gomulu bir plan listesi sunucu
   katalogundan sessizce ayrisir ve kullaniciya var olmayan bir plan sunar.
2. **Downgrade reddi kullaniciya anlatilir.** Sunucunun 4xx cumlesi hangi kotanin asildigini soyluyor;
   onu ALAN ALTINDA goster, genel bir "islem basarisiz"la degistirme. Mumkunse secenegi ONCEDEN
   pasif goster (mevcut kullanim > plan kotasi) + sebebini yaz — sonucu kesin 4xx olan bir buton tuzaktir
   (tm 181.3`un kaydettigi ayni karar).
3. Onay adimi: plan degisimi faturayi degistirir, geri alinmasi kolay degildir. Onay metni yeni tutari
   ve gecerlilik anini soylemeli.
4. Mevcut `seats`/`billing_cycle` yollari BOZULMAZ; mutasyon govdesi genisler, degismez.

## Bilinen tuzaklar

- Read-only (trial bitti) durumda billing yazma yollari ACIK kalmali — `allowWhenReadOnly` bu yuzden
  var. Yeni bir uc eklersen ayni `config`i vermeyi unutma, yoksa suresi bitmis musteri ODEYEMEZ.
- `onSuccess` tam abonelik gorunumu donduruyor ve sayfayi ondan guncelliyor (`setQueryData`) —
  plan degisiminden sonra kullanim/kota kartlari da tazelenmeli.
- `apps/web` vitest `--maxWorkers=4`.

### 194.2. F0-BILLUI-b [SONNET-XHIGH] Trial kaleminin kalan payini yeniden turet ve kapat (FR-MOD-10.2)

**Status:** done  
**Dependencies:** None  

Denetim bu kalemi curutme turunda `TAM`dan `KISMI`ye DUSURDU (`↓`) ama gerekce metni belgede kesik (`…`). Bu alt-gorev once kalan payi PRD KK`sina karsi YENIDEN TURETIR, sonra ya kapatir ya da gerekcesiyle `◐` birakir.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Durum (olculdu, 2026-09-04 — bu turda dogrulanan kisim)

PRD KK: "Kayit -> trial; canli gun sayaci; bitince kisit/odeme". Uc madde de bugun **calisir gorunuyor**:

- Kayit -> trial: `services/auth/lifecycle-service.ts:23` `TRIAL_DAYS = 14`, :115 signup yolunda kullaniliyor.
- Canli gun sayaci: `services/billing/metering.ts:227` `trialState` -> `routes/reports.ts:392`
  `trial: { ends_at, days_remaining }`; `AppShell.tsx:141-163` `TrialBanner` (`data-testid="trial-badge"`).
- Bitince kisit: `plugins/license-gate.ts` mutasyonlari `license_expired` ile reddediyor,
  okuma serbest. **Odeme yolu acik**: `allowWhenReadOnly: true` yalniz billing yazma uclarinda
  (`routes/reports.ts:1803/1919/1968`) — yani suresi bitmis musteri hala abone olabiliyor.

Yani bu turda **KK`nin ihlal edildigi bir nokta BULUNAMADI**. Denetimin `↓` gerekcesi
`prd-uyum-denetimi.md:421` satirinda `…` ile kesik ve tam metin belgede YOK.

## Yapilacak — sirayla

1. **Kalan payi yeniden turet.** Kaynak sirasi: (a) PRD `FR-MOD-10.2` satiri (urun-gereksinim
   dokumani :681) + bagimliliklari `FR-MOD-00.2` ve `FR-MOD-01.1.6`; (b) `prd-uyum-denetimi.md`
   §5/§6/§7 bolumlerinde trial gecen yerler; (c) `#### K10.2` blogu. Kesik metni TAHMIN ETME —
   bulamazsan bulamadigini yaz.
2. **KK`yi tek tek koda karsi dogrula** ve her madde icin ya var olan testi GOSTER ya da yeni test YAZ.
   CONVENTIONS §7`nin tam konusu bu: bir kriteri koruyan test yoksa, bugun calisiyor olmasi yarin
   da calisacagi anlamina gelmez. En az bir e2e: trial suresi bitmis bir calisma alaninda yazma
   reddediliyor AMA abonelik yolu ACIK.
3. **Sonuca gore kapat:**
   - Eksik bulunmadiysa: PLAN satiri `◐ → K10.2` -> `✅ → K10.2`, kanit maddesi "hangi KK maddesi
     hangi testle korunuyor" listesini tasir + denetimin `↓` gerekcesinin belgede kesik oldugunu
     ISMEN yazar (bir sonraki pencere ayni soruyu bastan sormasin).
   - Eksik bulunduysa: eksigi bu turda kapat; kapatilamayacak kadar buyukse `◐` birak, eksigi
     `#### K10.2` maddesine yaz ve **yeni bir Task Master gorevi ac** (priority `high`, `critical` DEGIL).

## Bilinen tuzaklar

- **`✅` UYDURMA.** "Bulamadim" ile "yok" ayni sey degil; hangisi oldugunu kanit maddesinde acikca yaz.
- e2e sabit portlarda ve TOHUMLU `siyahtus` veritabanina karsi kosar; trial suresi bitmis bir kiracik
  kurmak icin tohum satirini DEGISTIRME — testin kendisi tarihi ileri alsin ya da kendi kiracisini kursun.
- `license-gate` her mutasyonda taze okuma yapiyor (bilerek, onbellek yok) — testte tarih oynatinca
  etkisi hemen gorunur.
