# Task ID: 203

**Title:** V2-ENGAGE360 — Traffic satirindan ziyaretci 360° paneli yok (FR-MOD-13.2)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Denetim `13.2`nin UC KK maddesinin de karsilandigini soyluyor (gelismis filtre · ziyaretci gecmisi · proaktif aksiyon); eksik olan PRD`nin Aciklama sutunundaki "ziyaretci 360° panel". Bugun Traffic satirindaki "Edit contact" aksiyonu kullaniciyi `/app/customers`a GOTURUYOR — Engage yuzeyinde panel acilmiyor ve ajan canli listeyi kaybediyor. Veri zaten var: `GET /customers/:id` `visits_count` · `groups` · `visits[]{came_from, pages, os, browser}` · `custom_fields` (pre-chat) donduruyor. Bu, salt yuzey isidir.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## (a) Bu isi doguran gerekce

tm 184.4 (M-TRACE-d · `cf9ad43`) PLAN.md damgalarini `prd-uyum-denetimi.md`ye (2026-08-30, 12 denetci +
12 curutucu ajan, iki tur adversaryal) karsi yeniden okudu ve v2 §5.0`in 8 satirini `✅`ten `◐`ye indirdi;
v2`de `Must` OLMADIGI icin §F.00`in *sayac* kurali degil **kalem kurali** gecerlidir ("23 acik kalemin
hepsi ✅ oldugunda Faz-2 kapanir") ve kapi `❌ ACIK`a dondu. tm 187 (V2-REOPEN) once kalem kuralinin ic
celiskisini cozdu (payda **23 SABIT**; `08.9.2/.3/.5` paydanin disindadir ve ucu de gercekten ✅ — G1
`3127638` denetimin D1 bulgusunu denetim gunu kapatmisti), sonra 8 kalemi triyaj etti: **3 kalem** yanlis
dusurulmustu (`08.5.7` · `08.9.3` · `08.9.5`, SIRALAMA tuzagi) ve `✅`e geri alindi, **5 kalem** is
gorevine donusturuldu. Bu gorev o gorevlerden biridir.

Kapanis kosulu tek: **PRD kabul kriteri (KK)**. "Kod var + test yesil" YETMEZ — GL-3/GL-4/GL-8`in hatasi
tam olarak buydu ve M-TRACE ailesi (tm 184.1-184.3) bu kapiyi teshis etti. Kanit blogu PLAN.md`nin
`## K. Kanit Gecmisi` bolumundedir (`#### K<kod>`), tablo hucresinde DEGIL (CONVENTIONS §1.2).

**Denetim metni KAYNAGINDA KIRIK — ona guvenme.** `prd-uyum-denetimi.md` Ek A`nin "Eksik olan" hucresi
`…` ile kesiliyor. Asagidaki maddeler tm 187 turunda `grep`/`sed` ile KODA KARSI dogrulandi,
denetimden kopyalanmadi.

## (b) Kapsanan PLAN satiri

| PLAN satir (2026-09-04) | Kod | Kanit blogu | Alt-gorev |
| --- | --- | --- | --- |
| 1285 (§5.0) | 13.2 | `#### K13.2` | 203.1 · 203.2 |

**PRD (satir 714).** KK: _"Gelismis filtre; ziyaretci gecmisi; proaktif aksiyon"_ (denetim: ucu de
karsilaniyor). Aciklama: _"Match all filters + Add filter; **ziyaretci 360° panel** (pre-chat form,
returning visitor N visits, came from, groups, visited pages)"_ — eksik olan bu.
tm 185`in `02.3.5`/`04.1` emsali: KK disindan gelen eksik de is olarak acilir.

## (c) Dokunulacak dosyalar

- `apps/web/src/features/traffic/TrafficPage.tsx` — liste + satir aksiyonlari.
- `apps/web/src/features/traffic/rowActions.ts` (:53 `Edit contact`) · `types.ts` (`TrafficVisitor`).
- Detay paneli icin emsal: Inbox`un Details bolmesi (`chat-service.ts:1403-1418` ayni alanlari
  `visited_pages` / `referrer` olarak zaten donduruyor) ve `apps/web/src/features/customers/`.
- **Backend`e dokunulmasi BEKLENMIYOR:** `customer-service.ts:162-176` gerekli her alani doner.
  Bir alan gercekten eksikse once bunu kanitla, sonra ekle (kontrat-once).

## (d) Bilinen tuzaklar

1. **Traffic canli bir liste** (yoklama/RTM). Panel acikken listenin tazelenmesi paneli kapatmamali,
   secili ziyaretci listeden duserse panel durustce bunu soylemeli.
2. `rowActions.ts` izin bilir (`ctx.canEditCustomer`). Panel de ayni kapiyi tasimali — scope`suz ajan
   panelde musteri PII`si gormemeli.
3. A11y: yan panel/slide-over odak tuzagi + `Esc` ile kapanma ister; `hover:underline` axe
   `link-in-text-block` kuralini bozar (kayitli tuzak).
4. `apps/web` vitest CPU yuku altinda `userEvent` testlerinde 5000 ms timeout verir; `--maxWorkers=4`.
5. Alt-gorev sirasi: **203.1 -> 203.2** (ikisi de ayni bilesenе dokunuyor; 203.2 panelin icini doldurur).

## (e) Kapsam SINIRI

- YALNIZ `13.2`nin panel payi. Gelismis filtre / proaktif aksiyon **zaten karsilaniyor** — dokunma,
  yalniz regresyona sokma.
- `03.1.3` (canli ziyaretci panosu) zaten `✅`; onun sorgu/yoklama yolunu yeniden yazma.
- Yeni migration BEKLENMIYOR.

## Kapanista yapilacak PLAN.md guncellemesi

PLAN.md §5.0 (v2 kalem envanteri) icindeki ilgili satirin damgasi `◐ → K<kod>` yerine `✅ → K<kod>` olur.
Satir no `grep -n` ile bulunur — 2026-09-04 itibariyle: PLAN.md:1285 (§5.0 satiri). Kanit tablo hucresine
YAZILMAZ; `#### K<kod>` blogunun sonuna madde olarak eklenir:
`- ✅ <ne yapildi> — `<dosya>` · test `<dosya>` (n) · tm <id>`.
Ayrica **iki sayac** guncellenir cunku v2 kalem kuraldir, sayac degil:
(1) §5.0 basligindaki `0 ⬜ · 5 ◐ · 22 ✅ · 3 ⛔` satiri, (2) ust kapi tablosunun Faz-2 satiri (PLAN.md:22).

Kapanis dogrulamasi: `grep -n "| 13.2 " PLAN.md` cikan durum-damgali satirlarda `◐` KALMAMALI.

**Test Strategy:**

Aile ancak IKI alt-gorevin ikisi de kendi kapisindan gectikten sonra done.

GENEL KAPI (tum alt-gorevlerde ayni):
- TAM DoD kapisi (CONVENTIONS §1), exit code`lariyla. Test suiti §1.3 geregi parcalanabilir.
- Yeni/degisen test basliklari `(FR-MOD-...)` etiketi tasir (§7); `pnpm audit:req-coverage` exit 0.
- Kontrat degistiyse `pnpm -w contract:generate` sonrasi `git status --short packages/contract/src/generated`
  BOS. **`apps/mobile` parite testi tam uc sayisini pinliyor** — yeni bir OpenAPI yolu eklersen o sayaci
  yorumla birlikte bump et, yoksa mobil suiti kirmizi verir.
- Migration eklendiyse `pnpm -w db:check-drift` exit 0.

AILE KAPISI:
1. Traffic satirindan panel **yerinde** aciliyor — URL `/app/customers`a GITMIYOR (bugunku davranisin
   regresyon testi: gezinme olmamali).
2. Panelde PRD`nin saydigi bes alan da okunabiliyor: pre-chat form yanitlari · ziyaret sayisi ·
   came from · gruplar · gezilen sayfalar.
3. `canEditCustomer` scope`u olmayan ajanda panel PII gostermiyor.
4. e2e: ajan Traffic`te bir ziyaretciyi acip 360 bilgisini goruyor, kanit PNG `apps/e2e/kanit/` altinda.
5. `grep -n "| 13.2 " PLAN.md` §5.0 satirinda `◐` kalmamis olmali.

## Subtasks

### 203.1. V2-ENGAGE360-a [SONNET-XHIGH] Traffic satiri yerinde bir ziyaretci paneli acsin (FR-MOD-13.2)

**Status:** done  
**Dependencies:** None  

Panelin iskeleti: Traffic satirindan yerinde acilan, canli liste tazelenirken kapanmayan, izin kapisini tasiyan ve klavyeyle kapatilabilen bir yan panel. Icerik 203.2`de doldurulur; bu alt-gorev kimlik + ziyaret sayisi + came from ile ilk kesiti gosterir.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

`apps/web/src/features/traffic/rowActions.ts:53` — `{ id: "edit", label: "Edit contact",
enabled: ctx.canEditCustomer }`; secildiginde `/app/customers?customer=...`a **gezinir**.
`types.ts`teki `TrafficVisitor` yalniz `customer_id` · `name` · `email` · `activity` · `chat_id` ·
`chatting_with` · `last_activity_at` tasiyor — 360 alanlarinin hicbiri listede yok.

## Yapilacak

1. Satirdan yerinde acilan yan panel (slide-over). Veri kaynagi `GET /customers/:id` (typed client);
   yeni uc ACMA — `customer-service.ts:162-176` gerekli alanlari zaten doner.
2. Ilk kesit: ad/e-posta · **ziyaret sayisi** (`visits_count`) · **came from** (`visits[0].came_from`)
   · gruplar (`groups`). Kalan iki alan (gezilen sayfalar, pre-chat form) 203.2`de.
3. Izin kapisi: `canEditCustomer` yoksa panel acilmaz ya da PII`siz acilir — hangisi secilirse
   gerekcesi yazilir, ama scope`suz ajan PII GORMEZ.
4. Canli liste: yoklama tazelendiginde panel kapanmaz; secili ziyaretci listeden duserse panel
   durustce "bu ziyaretci artik cevrimici degil" der, sessizce bosalmaz.
5. `Esc` ile kapanma + odak tuzagi + kapanista odagin tetikleyen satira donmesi.
6. Metinler `en` + `tr` iki locale`e de eklenir.

## Bilinen tuzaklar

- "Edit contact" aksiyonu KALDIRILMAZ (musteriyi duzenlemek hala gerekli); panel ONA EK gelir.
  Ayni ada sahip iki eylem `getByRole` sorgularini kirar (kayitli tuzak) — adlandirmaya dikkat.
- `apps/web` vitest `--maxWorkers=4`.

### 203.2. V2-ENGAGE360-b [SONNET-XHIGH] Panelde gezilen sayfalar + pre-chat form yanitlari (FR-MOD-13.2)

**Status:** done  
**Dependencies:** None  

PRD`nin saydigi bes alanin kalan ikisi: **visited pages** (ziyaret basina, sirali) ve **pre-chat form** yanitlari. Ikisi de `GET /customers/:id` yanitinda zaten var (`visits[].pages` ve `custom_fields`); is onlari okunabilir bicimde gostermektir.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

`customer-service.ts:168-176` `visits[]`i `{id, came_from, pages, os, browser, started_at, ended_at}`
olarak donduruyor; `pages` serbest `jsonb`. Inbox Details bolmesi ayni veriyi
`chat-service.ts:2038` `visitedPagesOf(visit.pages)` ile `{url, at?}` dizisine ceviriyor — **ayni
okuma mantigini yeniden yazma, o yardimciyi/paylasilan bicimi kullan.**
Pre-chat form yanitlari `custom_fields` altinda (`custom-field-service.ts:242` `listPreChatForm`).

## Yapilacak

1. Gezilen sayfalar: ziyaret basina grupli, sirali liste; uzun URL kirpilir ama `title` tam deger tasir.
   Bos `pages` durumu durustce "sayfa kaydi yok" der.
2. Pre-chat form yanitlari: alan adi + deger; yanit yoksa bolum gosterilmez (bos baslik gurultudur).
3. `jsonb` savunmaci okunur: elle duzenlenmis bir satir paneli PATLATMAMALI (goal matcher`in ayni
   gerekcesi: "okunamayan tanim bir hata degil, bos bir sonuctur").
4. Metinler `en` + `tr`.

## Bilinen tuzaklar

- `visitedPagesOf` mantigini kopyalama; iki yerde ayrisirsa Inbox Details ile Traffic paneli ayni
  ziyaretci icin farkli sayfa listesi gosterir.
- Cok ziyaretli bir musteride liste uzun olur — `VirtualList` emsali var, ama panel icin sanallastirma
  zorunlu degilse ekleme (P4 olcumu bu turun konusu degil).
