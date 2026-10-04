# Task ID: 190

**Title:** F0-CRM — Contacts yuzeyi: filtre paneli + tablo sutunlari (FR-MOD-03.2.1 · 03.2.3)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Denetim Contacts`in iki `Must` kalemini KISMI buldu: PRD`nin KK`sinde ismen gecen "filtre paneli" Contacts tarafinda yok (yalniz 4 segment sekmesi), ve tabloda PRD`nin saydigi sutunlarin yarisi yok (Email, Phone, ulke bayragi, Tickets).

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
| 231 | 03.2.1 | `#### K03.2.1` | 190.1 |
| 232 | 03.2.3 | `#### K03.2.3` | 190.2 |

## (c) Ana dosyalar

- `apps/web/src/features/customers/CustomersPage.tsx` — arama, segment sekmeleri, `VirtualTable`
  (basliklar :210-217, `colSpan={4}`).
- `apps/web/src/features/traffic/TrafficFilters.tsx` — depoda ZATEN calisan kosul-tabanli filtre paneli;
  denetim bunu "gercek bir filtre paneli var ama Contacts`ta degil" diye isaret ediyor. Yeniden
  kullanilacak desen budur, sifirdan yazma.
- `apps/api/src/routes/customers.ts` (+ `services/customers/`) — filtre parametrelerinin sunucu yarisi.

## (d) Kapsam SINIRI

- YALNIZ 03.2.1 ve 03.2.3. `03.1.*` (Traffic), `03.2.2` (alt sekmeler, `Should`, zaten var) ve `03.3.*`
  (Campaigns — tm 176 M-CAMP ailesi kapatti) DISARIDA.
- Musteri profili paneli (`03.2.3`in "satir profili acar" maddesi) ZATEN calisiyor; regresyon yaratma.

## Kapanista yapilacak PLAN.md guncellemesi

Bu ailenin TUM alt-gorevleri bittiginde ilgili `Must` satirinin damgasi `◐ → K<kod>` yerine
`✅ → K<kod>` olur (PLAN.md §3, satir no `grep -n` ile bulunur — 2026-09-04 itibariyle gecerli satir
numaralari asagida yazili, dosya degistikce kayar). Tek bir alt-gorev bir satiri tek basina kapatiyorsa
o satiri o alt-gorev cevirir. Kanit tablo hucresine YAZILMAZ; `#### K<kod>` blogunun sonuna madde
olarak eklenir: `- ✅ <ne yapildi> — `<dosya>` · test `<dosya>` (n) · tm <id>`.
Faz-0 `Must` sayaci (PLAN.md:18 kapi tablosu) her kapanan satirda guncellenir.

**Test Strategy:**

Aile ancak iki alt-gorev de DoD kapisindan gectiginde done. Kapanista `grep -n "| 03.2.1 \|| 03.2.3 " PLAN.md` durum-damgali satirlarinda `◐` KALMAMALI.

## Subtasks

### 190.1. F0-CRM-a [SONNET-XHIGH] Contacts filtre paneli (FR-MOD-03.2.1)

**Status:** done  
**Dependencies:** None  

PRD KK: "Debounce arama; **filtre paneli**; sonuc yoksa empty". Birinci ve ucuncu var; filtre paneli yok — yalniz 4 segment sekmesi (all/leads/recent/banned).

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- `CustomersPage.tsx`: debounce arama ✅, "N people" sayaci ✅, sonuc-yok bos durumu ✅.
- Kosul-tabanli filtre paneli YOK. Depoda calisan bir ornek VAR: `TrafficFilters.tsx` (trafik panosu).

## Yapilacak

1. `TrafficFilters.tsx`in desenini Contacts`a uyarla — **bilesen paylasimi tercih edilir**, kopyalama
   degil; iki panel ayrisirsa kullanici ayni urunde iki farkli filtre dili ogrenir.
2. Alan secimi PRD ve mevcut sema ile sinirli: en az `country`, `last_activity` araligi, `has_tickets`
   / `chats_count` esigi. **Sunucu destegi olmayan alan sunma** — istemcide filtrelenen bir alan,
   sayfalanmis bir listede yanlis sonuc verir (yalniz yuklenen pencereyi filtreler; denetimin D3 deseni).
3. Sunucu yarisi: `GET /customers` sorgu parametreleri + indeks kontrolu. Yeni indeks acmadan once
   EXPLAIN ANALYZE ile OLC (NFR-P2 150 ms; tm 183.1 probe deseni — seyrek fixture kullan, yogun
   fixture planlayiciyi yaniltir).
4. Filtre durumu URL`e yazilir (paylasilabilir link + geri/ileri) — ticket grid`inin tm 179.3`te
   izledigi ayni karar.

## Bilinen tuzaklar

- OpenAPI`ye YENI YOL eklemek `apps/mobile` parity sayacini bozar; bu is mevcut yola PARAMETRE
  ekliyor, yol sayisi degismemeli.
- Form dogrulayicilari: bir alanin dogrulayicisini benzer bir alandan kopyalamak sessizce fazla
  engelleyebilir — her alanin kendi sunucu sozlesmesine bak (`lib/form.tsx`).
- `format:check` prettier`i kapsar; yeni bilesen dosyalari bicimlenmis olmali.

### 190.2. F0-CRM-b [SONNET-XHIGH] Contacts tablosu: eksik sutunlar + siralama (FR-MOD-03.2.3)

**Status:** done  
**Dependencies:** None  

PRD Name/Email/Phone/Country(flag)/Last active/Chats/Tickets sayiyor ve KK "Siralanabilir" diyor. Tabloda 4 sutun var (Name, Country, Chats, Last active), siralama kontrolu yok; `tickets_count` API`den geliyor ama tabloda gosterilmiyor.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- `CustomersPage.tsx:210-217` basliklar: Name · Country · Chats · Last active (`colSpan={4}`).
  Email/telefon ikincil satir olarak Name hucresinde; ayri sutun YOK. Ulke bayragi YOK. Tickets sutunu YOK.
- `grep -n sort apps/web/src/features/customers/CustomersPage.tsx` -> **0 satir**: siralama kontrolu yok.
- `tickets_count` API`den geliyor (tm 179 M-COUNT `tickets_count` gercek degeri besledi) — sunucu hazir.

## Yapilacak

1. Sutunlari PRD`nin listesine tamamla: Email · Phone · Country (bayrak + ad) · Tickets. `colSpan`
   guncellenir (`VirtualTable` bos-durum satirini onunla ciziyor — unutulursa bos tablo yanlis genislikte cikar).
2. **Siralama sunucuda.** Istemcide siralama yalniz yuklenen pencereyi siralar ve kullaniciya "en cok
   sohbet eden musteri" diye YANLIS bir cevap verir (denetimin D3 deseni; tm 179.2 ayni tuzagi
   ticket`larda cozdu — o cozumun keyset imleciyle etkilesimini oradan oku).
3. Bayrak: emoji bayrak mi, SVG mi karari verilir. Emoji bayraklar bazi platformlarda render edilmez;
   her durumda ulke ADI erisilebilir metin olarak bulunmali (bayrak tek basina ekran okuyucuda hicbir sey).
4. Ozel kolonlar (KK`nin "custom kolonlar" maddesi) `FR-MOD-08.7.6` (Custom fields, teslim edilmis)
   ile baglanabilir; bu turda kapsam disi, `#### K03.2.3` maddesinde ismen anilir.

## Bilinen tuzaklar

- Tablo `VirtualTable` (sanallastirilmis) — sutun eklemek satir yuksekligini (`rowHeight={56}`)
  degistirirse sanallastirma hesabi kayar; degeri kontrol et.
- Siralama sunucuya tasinirken keyset imleci siralama anahtarini TASIMALI, yoksa sayfa 2 yanlis gelir.
- Telefon/e-posta sutunlari kisisel veri: mevcut maskeleme/izin kurallari varsa (KVKK/NFR-C) bozma.
