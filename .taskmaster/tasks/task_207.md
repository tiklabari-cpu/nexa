# Task ID: 207

**Title:** F0-LASTGAP-c [SONNET-XHIGH] Contacts tablosunda custom kolonlar (FR-MOD-03.2.3)

**Status:** done

**Dependencies:** None

**Priority:** critical

**Description:** Faz-0'in acik kalan uc `Must ◐` kaleminden sonuncusu: custom field'lar Details panelinde gorunuyor ama Contacts TABLOSUNA satir-ici sutun olarak yansimiyor. Kapatilinca PLAN satir 307 `◐ → ✅` olur ve Faz-0'in Must sayaci `0 ◐`a duser.

**Details:**

(a) GEREKCE + KANIT — bu gorev neden var:
PLAN.md satir 307: `| 03.2.3 | Contacts tablosu (Name/Email/Phone/Country/Chats/**Tickets**) | Must (MVP) | ◐ → K03.2.3 |`.
Kanit blogu `#### K03.2.3` (PLAN.md ~7969-7972). tm 190.2 maddesi damganin NEDEN `◐` kaldigini
tek cumleyle yaziyor: "Kapsam disi birakilan TEK KK maddesi: 'custom kolonlar' (SiyahTuş: player ID /
KYC / bakiye) — `FR-MOD-08.7.6` zaten teslim edilmis (Details panelinde custom field'lar goruyor),
ama Contacts TABLOSUNA satir-ici sutun olarak yansitilmiyor; bu gorev bunu HIC ele almadi, bu yuzden
damga `✅` degil `◐` kaliyor."
Ust kapi tablosu (PLAN.md satir 20) Faz-0 icin `48 ✅ · 3 ◐ · 0 ⬜`; bu UCUNCU ve SON kalemdir
(digerleri: 02.3.5 -> tm 205, 02.8 -> tm 206). Bu kapaninca Faz-0 kapanis turu (GL-13, tm 208) acilir.
NOT: bu gorev, otonom dongunun "secilebilir gorev kalmadi" ile durmasindan dogan onarim turunda
acildi — tm 190.2 bulguyu PLAN'a yazdi ama Task Master'a AKTARMADI, is grafikten dustu.

(b) DOKUNULACAK DOSYALAR (yollar bu turda dogrulandi):
- `apps/web/src/features/customers/CustomersPage.tsx` — tm 190.2'nin yedi sutunu + `ColumnHeader`
  bileseni + `colSpan` burada.
- `apps/web/src/features/customers/customer-grid.ts` — saf siralama modeli (`ticket-grid.ts`in
  aynasi; `customer_sort`/`customer_order` URL parametreleri).
- `apps/api/src/services/customer/customer-service.ts` — `GET /customers` listesi; tm 190.1'in
  filtreleri + tm 190.2'nin `SortColumn`/keyset-cursor siralamasi burada.
- Custom field okuma yolu: `readCustomFieldValues` (tm 203.2'de `form_placement` alani eklendi) +
  `CustomFieldDefinition` / `CustomFieldValue` tipleri (`@siyahtus/types`).
- Tanim yuzeyi (SALT OKUNUR referans, dokunma): FR-MOD-08.7.6 custom field yonetimi.

(c) CONTRACT-FIRST SIRA:
`GET /customers` yaniti bugun custom field DEGERLERINI tasimiyorsa is KONTRATTAN baslar:
`packages/contract/openapi` -> `pnpm contract:generate` -> `@siyahtus/types` -> migration (gerekirse) ->
backend + unit -> frontend + typed client -> e2e.
YENI OpenAPI PATH ACMA — mevcut yaniti/parametreyi GENISLET. (`apps/mobile` parite testi toplam
endpoint sayisini birebir sabitliyor; yeni path acarsan o sayaci yorumla birlikte bump etmen gerekir.
tm 190.1 ve 190.2 de tam olarak bu yuzden yalnizca query parametresi ekledi.)

(d) BILINEN TUZAKLAR:
1. HANGI custom field kolon olacak? Bir kiracinin N tane tanimi olabilir; hepsini basmak tabloyu
   kirar. Bir gorunurluk karari gerekir (ornek: tanima `show_in_table` benzeri bir bayrak) ve bu bir
   KONTRAT degisikligidir — karari ve gerekcesini `#### K03.2.3` blokuna yaz.
2. SIRALAMA DURUSTLUGU — tm 190.2 `chats`/`tickets` sutunlarini BILEREK siralanamaz birakti
   (license-scoped `_count`; Prisma filtrelenmis iliski sayacina gore `orderBy` desteklemiyor,
   siralama gercek hucreyle celisirdi). Custom kolonlar icin ayni durustluk: sunucuda siralanamiyorsa
   baslik dugmesi/`aria-sort` KOYMA. Istemci-tarafli yeniden siralama YAPMA — `CustomersPage.test.tsx`
   bunu zaten assert ediyor ("sunucu-tarafli siralama, istemci-tarafli yeniden siralama DEGIL").
3. TENANT IZOLASYONU — custom field tanimlari organizasyona bagli. Cross-tenant negatif testi
   ZORUNLU; emsal `apps/api/test/integration/customers.test.ts`'in tm 190.1'de eklenen
   "cross-tenant" testi (baska organizasyonun musterisi hicbir filtreyle gorunmuyor, NFR-S4).
4. a11y — tm 190.2, `a11y.spec.ts`'in "focus and hover states in the customers table" testini
   `tbody`'e daraltmak zorunda kaldi: baslik satirindaki siralama dugmeleri
   `.getByRole('button').first()`i bir satir kontrolunden ONCE yakaliyordu. Yeni baslik kontrolu
   eklersen ayni tuzak geri gelir.
5. NFR-P2 150 ms butcesi — tm 190.1 emsali: yeni bir sorgu yolu aciyorsan EXPLAIN ANALYZE probu ile
   kanitla. Yeni indeks gerekiyorsa her biri kendi `CREATE INDEX CONCURRENTLY` migration dosyasinda
   (CONVENTIONS §6.3).
6. Migration uretmek golge DB ister (`psql` PATH'te degil; Prisma uzerinden olustur, `docker exec -i
   siyahtus-db` ile eris; konteyner yolu icin `MSYS_NO_PATHCONV=1`). Migration'i once atilabilir bir DB'de
   provalamak icin `with-test-datastores.ts <komut>`.
7. `apps/web` vitest CPU yuku altinda flake verir — `--maxWorkers=4`.
8. `pnpm audit:req-coverage` YALNIZ takip edilen dosyalari tarar: yeni test dosyasinin
   `(FR-MOD-03.2.3)` etiketi `git add` edilene kadar gorunmez.

(e) KAPSAM SINIRI — neye DOKUNULMAYACAK:
- 03.2.3'un diger ALTI sutunu (Name/Email/Phone/Country+bayrak/Last active/Chats/Tickets) ve
  sunucu-tarafli siralamasi tm 190.2'de KAPANDI. Yeniden ele alinmaz.
- FR-MOD-08.7.6'nin custom field YONETIMI (tanim CRUD) dokunulmaz.
- Traffic panosu ve paylasilan `ConditionFilters` bileseni (tm 190.1) dokunulmaz.
- Contacts FILTRE paneli (03.2.1, tm 190.1) dokunulmaz.
- 03.2.3 disindaki hicbir PLAN damgasina dokunma.

BITIRINCE: PLAN.md satir 307 `◐ → ✅`, `#### K03.2.3` blokuna kanit maddesi, ust tablo satir 20'nin
Faz-0 sayaci `0 ◐`a duser. Faz-0'in `❌ ACIK (yeniden)` damgasina DOKUNMA — o GL-13'un (tm 208) isi;
tm 208 bu gorev bitince secilebilir hale gelir.

**Test Strategy:**

Tam DoD kapisi (CONVENTIONS §1), hepsi exit 0: `pnpm -w typecheck` · `lint` · `format:check` · `build` · `contract:generate` sonrasi yalnizca beklenen diff · `pnpm db:check-drift` "no drift" · `pnpm audit:req-coverage` exit 0 ve `FR-MOD-03.2.3` site sayisi ARTMIS. Integration (`apps/api/test/integration/customers.test.ts`, 3 parca `--concurrency=1`): custom kolon degerleri `GET /customers` yanitinda dogru musteriye bagli donuyor · tanimi olmayan/bos deger bos hucre uretiyor (firlatmiyor) · CROSS-TENANT negatifi (baska organizasyonun custom field tanimi/degeri hicbir kosulda gorunmuyor) · yeni sorgu yolu icin EXPLAIN ANALYZE probu NFR-P2 150 ms butcesinin altinda. Birim `apps/web` (`--maxWorkers=4`): `CustomersPage.test.tsx` custom basliklari + hucre iceriklerini goruyor, `customer-grid.test.ts` siralanabilirlik kurali (siralanamayan kolon `aria-sort` TASIMIYOR). e2e: `customers.spec.ts` yesil + `a11y.spec.ts -g "customers"` dark+light 0 ihlal (tm 190.2'nin `tbody` daraltmasi bozulmamis). Kabul kriteri OLCULEBILIR: bir kiracinin tanimladigi custom field Contacts tablosunda satir-ici sutun olarak gorunuyor ve Details panelindeki AYNI degeri gosteriyor.
