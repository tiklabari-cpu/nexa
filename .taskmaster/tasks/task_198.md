# Task ID: 198

**Title:** V1-KNOWLEDGE — Bilgi kaynagi yasam dongusu: dosya + kaynak tablosu (FR-MOD-06.3.2 · 06.3.3)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Denetim v1`in iki Knowledge/RAG kalemini KISMI buldu. `06.3.2`: dort tur, SSRF korumali crawl, ayni islemde chunk+embed+index ve bulk CSV importu var — ama `file` turu GERCEK bir dosya degil, yalniz `body.content` metni (multipart yok, parse yok). `06.3.3`: tabloda isim/tur/chunk/tarih/URL/durum + Sil var — ama "Added by" uctan hic donmuyor, DUZENLEME ucu yok, yeniden-crawl yok, silme onayi yok ve PRD`nin istedigi "gecerlilik tarihi + otomatik yeniden crawl" hic yok.

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

## (b) Kapsanan PLAN satirlari

| PLAN satir (2026-09-04) | Kod | Kanit blogu | Alt-gorev |
| --- | --- | --- | --- |
| 586 | 06.3.2 | `#### K06.3.2` | 198.1 |
| 587 | 06.3.3 | `#### K06.3.3` | 198.2 · 198.3 · 198.4 |

## (c) Dokunulacak dosyalar

- `apps/api/src/routes/playbook.ts` — `GET /knowledge-sources` (:486-510, serialisation),
  `POST /knowledge-sources` (:514-570), `POST /knowledge-sources/bulk` (:602), `DELETE` (:803).
- `apps/api/src/services/ai/knowledge-service.ts` · `web-crawler.ts` · `lib/ssrf.ts`.
- `apps/web/src/features/playbook/PlaybookPage.tsx` — `KnowledgePanel` (:900-950).
- `packages/contract/**` + `packages/types` — yeni alan/uc icin sozlesme once.
- `apps/api/prisma/schema.prisma` — `KnowledgeSource` (`addedBy` :1452 zaten var).

## (d) SIRA KISITI

198.2 -> 198.3 -> 198.4 sirasiyla kosulur: ucu de ayni serialisation`i ve ayni tablo satirini
degistiriyor, ve 198.4`un otomatik yeniden-crawl`i 198.3`un ELLE yeniden-crawl yolunu yeniden
kullanir. 198.1 bagimsizdir, once ya da sonra kosabilir.

## Kapsam SINIRI

`06.3.2-bulk` (bulk/CSV) BILINCLI olarak v2 payidir (PLAN §5.1) ve **zaten teslim edilmistir**
(tm 97.x). Bu ailede bulk`a dokunma; `06.3.2`nin v1 payi yalniz `file` turudur.
`06.3.1` (alt sekmeler) `✅` — damgasina dokunma. Copilot`un kendi bilgi tabani
(`/copilot/knowledge`, `kind: copilot`) AYRI bir yuzeydir (`12.2`): ikisi birbirinin kaynagini
ASLA gostermemeli — her degisiklikte bu sinir yeniden dogrulanir.

## Kapanista yapilacak PLAN.md guncellemesi

Ilgili `Must` satirinin damgasi `◐ → K<kod>` yerine `✅ → K<kod>` olur (PLAN.md §4.1/4.2/4.3; satir no
`grep -n` ile bulunur — 2026-09-04 itibariyle gecerli satir numaralari yukarida yazili, dosya degistikce
kayar). Tek bir alt-gorev bir satiri tek basina kapatiyorsa o satiri o alt-gorev cevirir. Kanit tablo
hucresine YAZILMAZ; `#### K<kod>` blogunun sonuna madde olarak eklenir:
`- ✅ <ne yapildi> — `<dosya>` · test `<dosya>` (n) · tm <id>`.
v1 `Must` sayaci (PLAN.md:19 kapi tablosu) her kapanan satirda guncellenir.

Kapanis dogrulamasi: `grep -n "| 06.3.2 \|| 06.3.3 " PLAN.md`
cikan durum-damgali satirlarda `◐` KALMAMALI.

**Test Strategy:**

Aile ancak dort alt-gorevin dordu de DoD kapisindan gectiginde done. Kapanista `grep -n "| 06.3.2 \|| 06.3.3 " PLAN.md` cikan durum-damgali satirlarda `◐` KALMAMALI. Ayrica her alt-gorevde kiracilar-arasi negatif test (baska bir kiracinin kaynagina erisilemez) korunur.

## Subtasks

### 198.1. V1-KNOWLEDGE-a [OPUS-XHIGH] `file` kaynagi gercek dosya olsun: yukleme + parse (FR-MOD-06.3.2)

**Status:** done  
**Dependencies:** None  

PRD KK: "Gecersiz URL/tur reddi; crawl/parse; RAG indeksleme; bulk/CSV import". `website` icin crawl+parse var, `file` icin PARSE YOK: `POST /knowledge-sources` `type: "file"` aldiginda yaptigi tek sey `content = body.content ?? ""` (playbook.ts:523). Yani "File" bugun "metni yapistir, adina dosya de" demek.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- `playbook.ts:521-531`: yalniz `body.type === "website"` dalinda gercek bir alma/ayristirma var
  (`assertPublicHttpUrl` -> `crawl`). `file` dali yok; `content` dogrudan govdeden geliyor.
- Multipart/yukleme yolu repoda YOK; `type` enum`u (`playbook.ts:76`) `file`i kabul ediyor ama
  onu digerlerinden ayiran hicbir davranis yok.

## Yapilacak

1. Sozlesme once: dosya yukleme yolu (multipart ya da acikca belgelenen base64 govde — hangisi
   secilirse `#### K06.3.2` blogunda GEREKCESI yazilir). Yeni bir OpenAPI YOLU aciliyorsa
   `apps/mobile` uc-sayisi parite testinin sayaci ELLE bumplanir (kayitli tuzak).
2. Deterministik bir parser dikisi: `web-crawler.ts`in `htmlToText` deseni gibi, disari cikmayan
   ve testte sabit sonuc veren bir `parseUploadedFile`. Desteklenen turler ACIKCA sinirli
   (ornegin `text/plain` + `text/markdown` + `text/csv`); desteklenmeyen tur 400 ile REDDEDILIR
   ("gecersiz tur reddi" KK maddesi budur).
3. Butceler: bulk import`un zaten tasidigi satir/karakter/bayt butcelerinin ayni sinifi
   (`knowledge-bulk-row.ts`) burada da uygulanir. Butcesiz yukleme bir bellek-tuketimi yuzeyidir.
4. Chunk+embed+index AYNI islemde kalir (mevcut davranis) — kaynak var ama aranamaz olmasi
   "hazir gorunup hicbir sey cevaplamamak" demektir (dosyanin kendi gerekcesi).

## Bilinen tuzaklar

- **Bu bir GUVENLIK yuzeyi.** Yukleme = kullanici kontrollu bayt. Butce, tur beyaz listesi ve
  dosya adinin hicbir yerde yol olarak kullanilmamasi sart. Sunucuda diske YAZMA gerekmiyorsa yazma.
- Bulk CSV yolu (`/knowledge-sources/bulk`) ZATEN var ve v2 payiydi; onu yeniden yazma, yalniz
  paylasilan butce/parse yardimcilarini ortak kullan.
- Docker kapaliyken entegrasyon testleri ASILIR (0 bayt cikti, 10+ dk) — once `docker info`
  (CONVENTIONS §1.4).

## Kapsam SINIRI

Yalniz `file` turu. `website`/`article`/`faq` davranisi DEGISMEZ; bulk CSV kapsam disi.

### 198.2. V1-KNOWLEDGE-b [SONNET-XHIGH] "Added by" uctan tabloya (FR-MOD-06.3.3)

**Status:** done  
**Dependencies:** None  

PRD satiri tablonun sutunlarini sayiyor: "Name / Last Updated / **Added by** / Actions". `addedBy` semada var (schema.prisma:1452) ve yaziliyor (playbook.ts:549, 767) ama `GET /knowledge-sources` serialisation`i (playbook.ts:498-508) onu HIC dondurmuyor — yani sutun uretilemez.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

`GET /knowledge-sources` donen alanlar: `id · ai_agent_id · name · type · status · source_url ·
chunk_count · updated_at`. `added_by` YOK. `POST` yanitinda da yok (:562-570).

## Yapilacak

1. Sozlesme once: `added_by` alani (ve gosterilebilir bir ad) `knowledge_sources` semasina.
2. `GET` + `POST` + bulk yanitlarinin HEPSI ayni alani dondursun — biri dondurup digeri
   dondurmezse tablo kaynagi olusturur olusturmaz "bilinmiyor" gosterir.
3. Web tablosunda sutun/satir alt bilgisi olarak render (`PlaybookPage.tsx` `KnowledgePanel`,
   :915-930 bugunku `tur · chunk · tarih · url` seridi).

## Bilinen tuzaklar

- `addedBy` bir hesap kimligi ve NULL olabilir (bot/seed/sistem tarafindan eklenen kaynak).
  Ham UUID BASMA; ad cozulemezse "—" ya da "Sistem" bas ve bunu testle sabitle.
- Ad cozumu bir join ekliyorsa `GET /knowledge-sources` bir liste ucudur: N+1 sorgu yapma.
- Sozlesme degistigi icin `contract:generate` sonrasi generated senkron olmali.

## Kapsam SINIRI

Yalniz "Added by". Aksiyon menusu 198.3, gecerlilik tarihi 198.4.

### 198.3. V1-KNOWLEDGE-c [OPUS-XHIGH] Kaynak satirinda aksiyon menusu: duzenle + yeniden indeksle + silme onayi (FR-MOD-06.3.3)

**Status:** done  
**Dependencies:** None  

PRD KK: "… menu; silme onayi; kaynak retrieval`da kullanilir; ...". Bugun satirda menu YOK (ciplak bir Sil butonu), silme ONAYSIZ (`onClick={() => remove.mutate(source.id)}`, PlaybookPage.tsx:940) ve DUZENLEME ucu HIC YOK — `PATCH /knowledge-sources/:id` repoda mevcut degil (yalniz GET · POST · POST bulk · DELETE var).

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- **Silme onayi yok.** `PlaybookPage.tsx:936-947` — tek tikla, geri alinamaz, onaysiz silme.
  Kaynak silinince chunk`lar cascade siliniyor (playbook.ts:811) — yani yanlis tik veri kaybi.
- **Duzenleme yok.** `playbook.ts`te `/knowledge-sources` altinda `PATCH`/`PUT` yok.
- **Yeniden indeksle/crawl yok.** Bir website kaynagi bir kez crawl ediliyor; site degisince
  kaynak bayat kaliyor ve urunun icinden tazelenemiyor.
- **Aksiyon menusu yok** — PRD "…" menusunu ismen istiyor.

## Yapilacak

1. `PATCH /knowledge-sources/:sourceId` — en azindan `name` ve (article/faq icin) `content`.
   Icerik degisirse chunk`lar YENIDEN indekslenir; eskisi birakilirsa kaynak duzenlenmis gorunur
   ama eski metinden cevaplar (silme yorumundaki ayni tuzak).
2. `POST /knowledge-sources/:sourceId/reindex` (ya da PATCH ile ayni islem — sozlesmede sec ve
   `#### K06.3.3` blogunda gerekcelendir): `website` icin SSRF kapisindan gecen yeni bir crawl,
   digerleri icin mevcut metnin yeniden indekslenmesi. Crawl islem DISINDA kalir (mevcut desen).
3. Web: satirdaki ciplak butonlar bir `…` menusune toplanir; **silme onay adimi** eklenir
   (depoda kullanilan `Modal`/onay deseni; yeni bir onay primitifi UYDURMA).

## Bilinen tuzaklar

- **Yeniden crawl bir SSRF yuzeyidir.** Kayitli `source_url` bile olsa yeniden alinirken
  `assertPublicHttpUrl` TEKRAR calistirilir — DNS yeniden baglama (rebinding) tam da bu yuzden
  `ssrf.test.ts`te test ediliyor. "Zaten dogrulanmisti" varsayimi bu kalemdeki tek kritik hatadir.
- Onay diyalogu `window.confirm` OLMAMALI (test edilemez + tasarim sistemi disi).
- Kiracilar-arasi: `PATCH`/`reindex` baska kiracinin kaynagini 404 vermeli, 403 degil (mevcut desen).
- Docker kapaliyken entegrasyon testleri asilir — once `docker info`.

## Kapsam SINIRI

Gecerlilik tarihi + OTOMATIK yeniden crawl 198.4`un isi; burada yalniz ELLE tetiklenen yol.

### 198.4. V1-KNOWLEDGE-d [SONNET-XHIGH] Gecerlilik tarihi + otomatik yeniden crawl (FR-MOD-06.3.3)

**Status:** done  
**Dependencies:** None  

PRD KK`sinin son maddesi ismen "**gecerlilik tarihi + otomatik yeniden crawl** (SiyahTuş)". Bugun bir website kaynagi bir kez crawl ediliyor ve sonsuza kadar oyle kaliyor; ne bir tazelik esigi ne de zamanlanmis bir yenileme var.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

`KnowledgeSource` semasinda tazelik/gecerlilik alani yok; `apps/api/src/services/scheduler/jobs.ts`
icinde bilgi kaynagi tazeleyen bir is yok.

## Yapilacak

1. Migration: kaynak basina bir tazelik penceresi (ornegin `refreshAfterDays` / `nextRefreshAt`).
   Varsayilan, mevcut kaynaklari DAVRANIS DEGISTIRMEDEN birakmali (NULL = otomatik yenileme yok).
2. Zamanlanmis is: suresi gecen `website` kaynaklarini 198.3`un yeniden-crawl YOLUNU cagirarak
   tazeler. Ikinci bir crawl yolu YAZMA — iki yol iki farkli SSRF kapisi demektir.
3. Web: kaynak satirinda/duzenleme formunda tazelik penceresi secilebilir; "son tazelenme" gorunur.

## Bilinen tuzaklar

- **Basarisiz tazeleme kaynagi BOZMAMALI.** Site dusmusse ya da SSRF kapisi reddediyorsa eski
  icerik KALIR ve durum "tazelenemedi" olur; kaynagi bosaltmak sessiz veri kaybidir.
- Is kiracilar arasinda dolasir: her kaynak KENDI kiracisinin baglaminda islenir (RLS).
- `website` disindaki turlerde otomatik tazeleme ANLAMSIZ (kaynak metni disarida degil) — alan
  yalniz `website` icin anlamli, digerlerinde kabul edilmez ya da yok sayilir; hangisi oldugunu
  sozlesmede sabitle.
- Migration eklendigi icin `pnpm -w db:check-drift` exit 0 sart; shadow DB tuzagi icin kayitli not.

## Kapsam SINIRI

Yalniz otomatik tazeleme. Elle yeniden-indeksleme 198.3`te; ikisi ayni servis yolunu paylasir.
