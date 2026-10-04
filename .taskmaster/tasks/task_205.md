# Task ID: 205

**Title:** F0-LASTGAP-a [SONNET-XHIGH] Composer'dan #tag secimi — 02.3.5'in son yuklemi (FR-MOD-02.3.5)

**Status:** done

**Dependencies:** None

**Priority:** critical

**Description:** Faz-0'in acik kalan uc `Must ◐` kaleminden biri: Inbox composer'inda PRD'nin saydigi bes aracin sonuncusu (#tag) yok. Kapatilinca PLAN satir 293 `◐ → ✅` olur ve Faz-0'in §F.00 kapisi bir adim daha kapanir.

**Details:**

(a) GEREKCE + KANIT — bu gorev neden var:
PLAN.md satir 293: `| 02.3.5 | Composer araclari (canned #, tag, emoji, **attach**) | Must (MVP) | ◐ → K02.3.5 |`.
Kanit blogu `#### K02.3.5` (PLAN.md ~7942-7946). Orada tm 189.5 maddesi damganin NEDEN `◐` kaldigini
tek cumleyle yaziyor: "#tags kapsam disi (gorevin 3. maddesi): FR-MOD-08.7.1 tag yuzeyi tm 181.1'de
Details panelinde kapandi; composer'dan dogrudan erisim AYRI BIR KALEM (CONVENTIONS §5), IS ACILMADI
— damganin ◐ kalmasinin TEK nedeni bu." Bu gorev tam olarak o acilmamis istir.
Ust kapi tablosu (PLAN.md satir 20) Faz-0 icin `48 ✅ · 3 ◐ · 0 ⬜` diyor; bu kalem o ucten biridir
(digerleri: 02.8 -> tm 206, 03.2.3 -> tm 207). §F.00 kurali mekanik: bir faz ancak Must kapsaminda
0 ◐ ve 0 ⬜ kaldiginda kapanir, yani Faz-0'in kapanis turu (GL-13, tm 208) bu ucu bekliyor.
NOT: bu gorev, otonom dongunun "secilebilir gorev kalmadi" ile durmasindan dogan onarim turunda
acildi — tm 189.5 bulguyu PLAN'a yazdi ama Task Master'a AKTARMADI, is grafikten dustu.

(b) DOKUNULACAK DOSYALAR (hepsi dogrulandi, bu yollar mevcut):
- `apps/web/src/features/inbox/Composer.tsx` — canned `#` secici + emoji Dropdown burada.
- `apps/web/src/features/inbox/emoji.ts` — tm 189.5'in emsali: ucuncu-parti bagimlilik YOK, mevcut
  `components/ui/Dropdown.tsx` yeniden kullanildi (klavye roving/Escape/disari-tiklama orada kanitli),
  ekleme imlecin bulundugu yere gidiyor (`insertAtCaret`). Ayni deseni izle.
- `apps/web/src/features/inbox/DetailsPanel.tsx` — tag yuzeyi ZATEN burada: satir 110
  `api.get<{items:Array<{name:string}>}>('/settings/tags')`, satir 74 `chat.thread?.tags`, satir 204
  `PanelSection` "tags". Ayni sorgu anahtarini ve ayni mutasyonu yeniden kullan, ikinci bir tag dili
  ogretme.
- `apps/web/src/features/settings/Tags.tsx` — tag YONETIMI (08.7.1). SALT OKUNUR referans, dokunma.

(c) CONTRACT-FIRST SIRA:
Yeni uc BEKLENMIYOR — `GET /settings/tags` ve thread tag mutasyonu DetailsPanel'de zaten calisiyor;
bu bir YUZEY isidir. Kontrat gercekten degisirse sira: `packages/contract/openapi` -> `contract:generate`
-> `@siyahtus/types` -> backend+unit -> frontend -> e2e. Yeni OpenAPI PATH ACMA (path sayisi
`apps/mobile` parite testinde sabitlenmis; acarsan o sayaci yorumla birlikte bump etmen gerekir).

(d) BILINEN TUZAKLAR:
1. `#` COKLU YUKLEM CAKISMASI — composer'da `#` ZATEN canned response seciciye bagli (F5'te teslim,
   K02.3.5'te `#` ✅ olarak isaretli). Iki `#` yuklemi ayni tetigi paylasamaz. Bu gorevin ILK karari
   ayrimdir (ornek secenekler: tek menude iki bolum · tag icin ayri tetik/dugme · `#` sonrasi
   disambiguation). Hangisi secilirse gerekcesi `#### K02.3.5` blokuna yazilir.
2. `getByRole` CAKISMASI — DetailsPanel'in mevcut tag ekleme kontrolu ile ayni erisilebilir adi
   TASIMA. Bu depoda iki kez isirdi: bir etiketin baska bir dugmenin aria-label'iyla eslesmesi hem
   `getByLabelText` hem `getByRole` sorgularini bozuyor.
3. i18n — `apps/web`de `t()` cagiran YENI bir bilesen, `i18n-coverage.test.ts`in `TRANSLATED_FILES`
   listesine eklenmezse iki assertion duser. Yeni anahtarlar `en` + `tr` ikisine de eklenir.
4. `apps/web` vitest CPU yuku altinda `Test timed out in 5000ms` ile flake veriyor (userEvent
   testleri). Regresyon degil; `--maxWorkers=4` ile kos.
5. e2e: paylasilan tohumlu DB'de bayat dev sunucu (5173/5174) tum suiti karartir; kosmadan once
   4000/4001/5173/5174 bos olsun.

(e) KAPSAM SINIRI — neye DOKUNULMAYACAK:
- Emoji · rich text · attach · canned `#`: tm 189.5 + Dilim 13'te TESLIM EDILDI, yeniden ele alinmaz.
- Tag YONETIMI (olustur/sil/rename) FR-MOD-08.7.1'in konusudur; `Tags.tsx`e dokunma.
- WIDGET TARAFI BU GOREVIN KONUSU DEGIL. K02.3.5'te yazili, SAHIPSIZ komsu bosluk:
  `apps/widget/src/widget.ts` mesaj metnini `span.textContent = marked` (~satir 1549) ile basiyor,
  yani bir ajan `**kalin**` yazinca musteri tarafinda yildizlar harfiyen gorunuyor. Bu gorev bunu
  KAPSAMAZ; karari Faz-0 kapanis turu (GL-13 / tm 208) verecek — orada ismen listelendi, kaybolmadi.
- 02.3.5 disindaki hicbir PLAN damgasina dokunma.

BITIRINCE: PLAN.md satir 293 `◐ → ✅` cevrilir, `#### K02.3.5` blokuna kanit maddesi eklenir
(CONVENTIONS §1.2 — kanit K blokunda, tabloda degil), ust tablo satir 20'nin Faz-0 sayaci
`48 ✅ · 3 ◐` -> `49 ✅ · 2 ◐` guncellenir. Faz-0'in kendi `❌ ACIK (yeniden)` damgasina DOKUNMA —
o GL-13'un (tm 208) isidir.

**Test Strategy:**

Tam DoD kapisi (CONVENTIONS §1), hepsi exit 0: `pnpm -w typecheck` · `lint` · `format:check` · `build` · `contract:generate` sonrasi beklenmeyen diff yok · `pnpm db:check-drift` · `pnpm audit:req-coverage` exit 0 ve `FR-MOD-02.3.5` site sayisi ARTMIS olmali. Birim: `apps/web` tam suiti `--maxWorkers=4` yesil ve taban uzerine yeni testler — composer `#tag` secicisi icin (liste `GET /settings/tags`ten geliyor · secim imlece ekleniyor · zaten ekli tag tekrar onerilmiyor · klavye ile gezinme + Escape · canned `#` yuklemiyle cakismiyor). e2e: `apps/e2e/tests/inbox*.spec.ts` hedefli kosu yesil + `a11y.spec.ts` composer kapsaminda dark+light 0 ihlal. Kabul kriteri OLCULEBILIR: bir ajan composer'dan ayrilmadan bir sohbete tag ekleyebiliyor ve eklenen tag DetailsPanel'in tag bolumunde gorunuyor (ayni veri, iki yuzey).
