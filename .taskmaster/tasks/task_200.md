# Task ID: 200

**Title:** V1-AIMETER [OPUS-XHIGH] AI cozum asim paketi satin alinabilir olsun — stepper (FR-MOD-10.1.4)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Denetim: sayac (`N/limit` + gercek %, 100 ustunu kirpmadan), %80 proaktif uyari ve asim fiyatinin onden gosterimi EKSIKSIZ. Eksik olan PRD basligindaki "**stepper**": AI cozum asim paketi satin alinabilir bir kalem degil — 50`lik paket yalnizca bir fiyat vitrini olarak render ediliyor (`BillingPage.tsx:176-179`, `packPriceCents`). Ayni ekranda API cagri paketi ZATEN satin alinabiliyor (`POST /billing/api-packages`), yani desen depoda hazir; AI tarafi ona baglanmamis.

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
| 621 | 10.1.4 | `#### K10.1.4` |

## (c) Izlenecek desen — YENIDEN ICAT ETME

API cagri paketi (`09.3`) tam olarak bu isi yapiyor ve `✅`:
- `apps/api/src/services/billing/api-package-service.ts` — katalog + satin alma + kotayi
  `usage_records`a kredi etme (:113).
- `apps/api/src/routes/reports.ts` — `GET /billing/api-packages` (:1955) · `POST` (:1963) ·
  `GET /billing/api-packages/purchases` (:2011).
- `apps/web/src/features/billing/BillingPage.tsx` — `ApiPackagePurchasesSection` (:372, :575-660):
  satin alma mutasyonu, hata banner`i, salt-okunur workspace`te butonun DEVRE DISI BIRAKILMAMASI
  (karar sunucuda, 09.3-d) ve satin alma sonrasi cache invalidasyonu.
AI tarafinin sayilari `metering.ts`te hazir: `ai_resolutions` (:67, :194-205),
`AI_RESOLUTION_OVERAGE_UNIT`, `config.aiOverageCents`. Fatura tarafi `invoice-service.ts:147`.

## (d) Yapilacak

1. Sozlesme once: AI cozum paketi katalogu + satin alma ucu (`api-packages` ile SIMETRIK isimlendir).
   Yeni OpenAPI yolu aciliyorsa `apps/mobile` uc-sayisi parite sayaci ELLE bumplanir (kayitli tuzak).
2. Servis: satin alinan kota `usage_records`a AYNI bicimde kredi edilir (`metering.ts:124-151`
   deseni) — ikinci bir sayac UYDURMA (fatura ADR-09: tek kaynak).
3. Fatura: satin alma bir sonraki fatura okumasinda ayri bir kalem olarak GORUNUR
   (`invoice-service.ts`; API paketinin 09.3-e maddesiyle ayni beklenti).
4. Web: metrede bir **stepper** (kac paket) + satin al. Stepper 0`in altina inmez ve makul bir ust
   sinir tasir; toplam fiyat SATIN ALMADAN ONCE gorunur (mevcut `overage-charge` deseni).

## (e) Bilinen tuzaklar

1. **Bu bir PARA yoludur.** Cift tiklama iki paket satin ALMAMALI (idempotans/pending kilidi);
   fiyat istemciden GELMEZ, sunucuda hesaplanir. `MockPaymentProvider` disina cikma —
   gercek odeme/kart YASAK (MASTER-PROMPT sinirlari).
2. Salt-okunur/suresi dolmus workspace`te buton devre disi BIRAKILMAZ; karar sunucuda verilir
   (09.3-d`nin gerekcesi: kapasite satin almak, suresi dolmus bir workspace`in cikis yollarindan biridir).
3. `%80 uyari` ve sayac davranisi REGRESYONA girmemeli — `BillingPage.test.tsx` (12 test) yesil kalir.
4. Migration eklenirse `pnpm -w db:check-drift` exit 0 sart.
5. Docker kapaliyken entegrasyon testleri asilir — once `docker info` (CONVENTIONS §1.4).

## Kapsam SINIRI

Yalniz `10.1.4`. `10.1.5` (API cagri paketi) `✅` — dokunma, yalniz desenini kullan.
`10.2`/`10.3` (Faz-0 ve Should) kapsam disi.

## Kapanista yapilacak PLAN.md guncellemesi

Ilgili `Must` satirinin damgasi `◐ → K<kod>` yerine `✅ → K<kod>` olur (PLAN.md §4.1/4.2/4.3; satir no
`grep -n` ile bulunur — 2026-09-04 itibariyle gecerli satir numaralari yukarida yazili, dosya degistikce
kayar). Tek bir alt-gorev bir satiri tek basina kapatiyorsa o satiri o alt-gorev cevirir. Kanit tablo
hucresine YAZILMAZ; `#### K<kod>` blogunun sonuna madde olarak eklenir:
`- ✅ <ne yapildi> — `<dosya>` · test `<dosya>` (n) · tm <id>`.
v1 `Must` sayaci (PLAN.md:19 kapi tablosu) her kapanan satirda guncellenir.

Kapanis dogrulamasi: `grep -n "| 10.1.4 " PLAN.md`
cikan durum-damgali satirlarda `◐` KALMAMALI.

**Test Strategy:**

OLCULEBILIR KAPI:
1. `apps/api` entegrasyon: satin alma sonrasi donemin AI kotasi paket buyugu kadar ARTAR ve ayni
   donemin `overage`i buna gore DUSER (tek sayac iddiasi — ikinci bir sayac olmadigi da iddia edilir).
2. Idempotans/yaris testi: ayni istek iki kez gonderildiginde kota BIR kez kredi edilir.
3. Fiyat sunucuda: govdede sahte bir fiyat gonderilirse yok sayilir/reddedilir (asla uygulanmaz).
4. Salt-okunur workspace: uc kendi karari ile cevap verir; istemci butonu devre disi BIRAKMAZ
   (web testinde iddia edilir).
5. Fatura okumasi satin almayi ayri kalem olarak gosterir.
6. `apps/web`: stepper 0`in altina inmez, ust sinirda durur; toplam fiyat satin almadan once gorunur;
   satin alma sonrasi sayac/uyari yeniden cekilir. Mevcut 12 `BillingPage.test.tsx` testi YESIL kalir.
7. `apps/e2e`: metreden paket satin alinir -> sayac ve uyari guncellenir.
8. Test basliklari `(FR-MOD-10.1.4)` etiketi tasir; `pnpm audit:req-coverage` exit 0.
9. TAM DoD kapisi (CONVENTIONS §1, parcalama §1.3) + `contract:generate` senkron + `db:check-drift`.
10. `grep -n "| 10.1.4 " PLAN.md` durum-damgali satirinda `◐` kalmamis olmali.
