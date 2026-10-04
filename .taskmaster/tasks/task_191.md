# Task ID: 191

**Title:** F0-TEAMUI — Team modulunun dort `Must` kalemi (FR-MOD-04.1 · 04.3.1 · 04.3.4 · 04.4)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Denetim Team modulunun dort `Must` kalemini KISMI buldu: modul-ici gezinme yok, "Copy invite link" bagimsiz bir header aksiyonu degil, ayri profil paneli hic yok ve `last_seen_at` hicbir yerde yazilmiyor, davet edilen koltuk faturaya yansimiyor.

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
| 239 | 04.1 | `#### K04.1` | 191.1 |
| 240 | 04.3.1 | `#### K04.3.1` | 191.2 |
| 242 | 04.3.4 | `#### K04.3.4` | 191.3 |
| 243 | 04.4 | `#### K04.4` | 191.4 |

## (c) Ana dosyalar

- `apps/web/src/features/team/` — `TeamPage.tsx` (`Section` bloklari :204/:210/:387/:440),
  `InviteTeammates.tsx` (:71-75, :182-195), `TeamMembers.tsx`, `Teams.tsx` (tm 175.4).
- `apps/web/src/components/AppShell.tsx:268` — `InviteRailButton` ("+" hizli olustur).
- `apps/api/src/services/billing/subscription-service.ts:274` — `ensureSeatsCoverHeadcount`.
- `apps/api/src/routes/scim.ts:517` — bugun bu fonksiyonu cagiran TEK yer.

## (d) Kapsam SINIRI

- YALNIZ dort satir. `04.2` (AI performansi — tm 181.10), `04.5` (Teams yazma yollari — tm 175 M-TEAM),
  `04.6` DISARIDA; ucu de denetimden sonra kapandi ya da Faz-0 `Must` degil.
- Rol/izin modeli DEGISMEZ. Bu dort kalem yuzey ve faturalama dikisi; scope semasina dokunma.

## Kapanista yapilacak PLAN.md guncellemesi

Bu ailenin TUM alt-gorevleri bittiginde ilgili `Must` satirinin damgasi `◐ → K<kod>` yerine
`✅ → K<kod>` olur (PLAN.md §3, satir no `grep -n` ile bulunur — 2026-09-04 itibariyle gecerli satir
numaralari asagida yazili, dosya degistikce kayar). Tek bir alt-gorev bir satiri tek basina kapatiyorsa
o satiri o alt-gorev cevirir. Kanit tablo hucresine YAZILMAZ; `#### K<kod>` blogunun sonuna madde
olarak eklenir: `- ✅ <ne yapildi> — `<dosya>` · test `<dosya>` (n) · tm <id>`.
Faz-0 `Must` sayaci (PLAN.md:18 kapi tablosu) her kapanan satirda guncellenir.

**Test Strategy:**

Aile ancak dort alt-gorev de DoD kapisindan gectiginde done. Kapanista dort satirda da `◐` KALMAMALI.

## Subtasks

### 191.1. F0-TEAMUI-a [SONNET-XHIGH] Team modul-ici gezinme + "+" hizli olustur (FR-MOD-04.1)

**Status:** done  
**Dependencies:** None  

PRD KK: "Insan + AI varliklari tek cati". Uc varlik grubu (Teammates, AI agents + Copilot, Teams) tek sayfada `Section` bloklari olarak var; PRD`nin tarif ettigi modul-ici kenar cubugu/gezinme yok ve "+" hizli olustur yalnizca teammate davetini aciyor.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- `TeamPage.tsx` dort `Section` blogu (pending invitations, teammates, AI agents, teams) — tek uzun
  sayfa. Modul-ici gezinme (kenar cubugu / sekme) YOK.
- `AppShell.tsx:268` `InviteRailButton` — "+" yalniz teammate davetini aciyor; AI agent ya da takim
  olusturmaya gotursen yol yok.

## Yapilacak

1. Modul-ici gezinme ekle. Bicim karari senin: kenar cubugu mu, sekme mi? PRD "kenar cubugu" diyor
   ama sol ana ray zaten bir kenar cubugu — iki kenar cubugu yan yana dar ekranlarda urunu bozar.
   Kararini ve gerekcesini `#### K04.1` maddesine yaz. Hangi bicim olursa olsun: derin baglanti
   verilebilir olmali (`/app/team/teams` gibi) yoksa "Teams ekranina git" diye bir link paylasilamaz.
2. "+" hizli olustur bir menuye donusur: Invite teammate · New team · (AI agent varsa) New AI agent.
   Her ogenin kapisi kendi scope`u; yetkisi olmayana oge GOSTERILMEZ (403 kapisi degil, gizleme).
3. Mevcut bolumler KORUNUR — gezinme onlarin uzerine gelir, yerlerine gecmez. Bir kullanicinin bugun
   bildigi yol bozulmamali.

## Bilinen tuzaklar

- `getByRole("link", {name})` alt dizi eslediginde strict-mode ihlali verir (tm 182.2: "Team →"
  etiketi rayin "Team" bagintisini belirsiz yapmisti). Yeni gezinme etiketlerini secerken bunu dusun.
- Ic gezinme rota ekliyorsa router testleri + e2e derin baglanti testi guncellenir.
- a11y: `nav` landmark`i `aria-label` tasimali; iki `nav` ayni isimle axe ihlali verir.

### 191.2. F0-TEAMUI-b [SONNET-XHIGH] Header aksiyonu: "Copy invite link" (FR-MOD-04.3.1)

**Status:** done  
**Dependencies:** None  

PRD KK: "Link kopyalar; modal acar" — iki bagimsiz header aksiyonu. "Invite teammates" var; "Copy invite link" bagimsiz bir aksiyon DEGIL, yalniz davet POST edildikten SONRA modal icinde, olusturulan ilk davetin `accept_url`u icin beliriyor.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- `InviteTeammates.tsx:71-75` ve `:182-195` — kopyalanan deger POST sonucundan gelen `accept_url`.
  Yani bugun "davet linkini kopyalamak" icin ONCE birine davet gondermek gerekiyor.
- Denetim "Tasarim gerekcesi…" diye devam ediyor (metin belgede kesik): mevcut davranisin bir gerekcesi
  OLABILIR. **Once o gerekceyi bul** (`InviteTeammates.tsx` yorumlari + `#### K04.3.1` + git log).

## Yapilacak — ONCE KARAR

Iki dogru cevap var; birini gerekcesiyle sec ve `#### K04.3.1` maddesine yaz:

(i) **Adrese ozel olmayan bir katilim linki** (workspace-level invite link) eklenir: header`dan tek
    tikla kopyalanir, kabul edilince davet edilen kisi varsayilan rolle katilir. **Guvenlik bedeli
    gercek**: link kimde varsa workspace`e girer. O yuzden: suresi olmali, iptal edilebilmeli, rolu
    sabit ve dar olmali, denetim kaydina girmeli. Bu bir GUVENLIK karari — hafife alma.
(ii) Header aksiyonu **modal`i acar ve link-uretme adimina goturur**; yani "Copy invite link" bir
    kisayol olur, yeni bir kimlik yolu acmaz. Guvenlik bedeli yok, PRD`nin harfine daha az uyar.

Onerilen: (ii) ile basla; (i)`yi ayri bir kalem olarak notta anmakla yetin — cunku (i) yeni bir
kimlik yuzeyi acar ve Faz-0 kapisini bir guvenlik tasarimina baglamak yanlis takas olur.

## Bilinen tuzaklar

- Pano erisimi: jsdom`da `navigator.clipboard` mock`lanir; Playwright`ta izin gerekir
  (`grantPermissions(["clipboard-read","clipboard-write"])`, Chromium).
- Eger (i) secilirse: link bir kimlik bilgisidir — URL`e/log`a/analitige girmemeli, tek kopya
  bilesende durmali (tm 181.2`nin PAT karari birebir emsal).

### 191.3. F0-TEAMUI-c [OPUS-XHIGH] Profil paneli + `last_seen_at` olu kolonu (FR-MOD-04.3.4)

**Status:** done  
**Dependencies:** None  

PRD`nin tarif ettigi ayri profil paneli hic yok; bilgiler roster tablosunun sutunlarina dagilmis. "last seen" hicbir yerde yok — `accounts.last_seen_at` semada var ama HICBIR SEY yazmiyor (denetimin D4 "olu kolon" deseni).

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- Ayri profil paneli YOK (avatar/isim/rol/last seen/email/concurrent chats limit/Manage profile/Chatting teams).
- `apps/api/src/services/reports/access-review.ts:21` yorumu birebir: `accounts` bir `last_seen_at`
  tasiyor ama **hicbir sey yazmiyor**, ve her zaman bos olan bir alan rapora girdiginde yanlis cevap uretir.
- `last_seen_at` adiyla YAZILAN baska tablolar var ama farkli varliklar:
  `notifications.ts` (:168/:173) ve `traffic/supervision-service.ts` (:61-69). Onlari `accounts` ile
  KARISTIRMA — ayni ad, ayri anlam.
- PRD KK: "Limit yonlendirmeyi besler; duzenleme izin bazli". Ikisi de bugun dogru; eksik olan panelin
  kendisi ve `last seen`.

## Yapilacak (contract-first)

1. **`accounts.last_seen_at`i yaz ya da kaldir — arada birakma.** Yazma karari verilirse: nerede
   guncellenecek? Her istekte yazmak sicak yolda bir UPDATE demektir (yazma amplifikasyonu). Onerilen
   desen: kabalastirma (ornegin 60 sn`den eski ise guncelle) ve gerekcesini kodun yanina yaz. Kaldirma
   karari verilirse CONVENTIONS §6.3 gecerli: bir kolonu tek surumde DUSURME (genislet -> tasi -> daralt).
2. **Profil paneli**: roster satirindan acilan bir panel/modal. Icerik PRD listesi; `concurrent chats
   limit` DUZENLENEBILIR (izin bazli) ve degistirildiginde routing`i besledigi TESTLE gosterilir —
   bu, kalemin PRD KK`sindaki tek olculebilir cumledir.
3. "Chatting teams" (uyesi oldugu takimlar) tm 175 M-TEAM`in getirdigi grup uyelik uclarindan okunur;
   yeni uc ACMA.
4. "Manage profile" baglantisi: kendi hesabin icin ayarlar yuzeyine, baskasi icin (yetki varsa)
   duzenleme paneline. Yetkisiz kullanicida baglanti GOSTERILMEZ.

## Bilinen tuzaklar

- Migration eklenirse `pnpm -w db:check-drift` exit 0 olmali. `psql` PATH`te degil:
  `docker exec -i siyahtus-db` (kullanici `siyahtus`, MSYS_NO_PATHCONV=1). Shadow DB Prisma uzerinden acilir.
- `last_seen_at` yazan yol RLS altinda calisir; yazma tenant baglaminda olmali.
- Presence (`AppShell` avatar grubu, `FR-MOD-01.1.4`) ile `last_seen_at` AYRI kavramlar: biri canli
   soket, digeri kalici damga. Birini digerinin yerine koyma.

### 191.4. F0-TEAMUI-d [OPUS-MAX] BOLUNMEZ: davet edilen koltuk faturaya yansisin (FR-MOD-04.4)

**Status:** done  
**Dependencies:** None  

Coklu email, satir-ici gecersiz-adres hatasi, default rol, rol on-atama, yarim-form kapatma onayi ve rol-tavani reddi hepsi var ve test edilmis. Eksik olan TEK kabul kriteri: "koltuk faturaya yansir". `ensureSeatsCoverHeadcount` bugun yalniz SCIM yolundan cagriliyor.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- `apps/api/src/services/billing/subscription-service.ts:274` `ensureSeatsCoverHeadcount` tanimli.
- `grep -rn "ensureSeatsCoverHeadcount" apps/api/src` -> cagri YALNIZCA `routes/scim.ts:517`.
  Yani SCIM ile provizyon edilen kullanici faturayi buyutuyor, **konsoldan davet edilen kullanici**
  buyutmuyor. Ayni urunde iki farkli fatura gercegi.
- `apps/api/src/plugins/sandbox-gate.ts:25` ve `lib/entitlements.ts:161` bu fonksiyonun anlamini
  aciklayan yorumlari tasiyor — once onlari oku.
- PRD `FR-MOD-04.4` KK son maddesi: "**koltuk faturaya yansir**".

## Neden [OPUS-MAX] ve neden BOLUNMEZ

Bu bir **para** yolu. Yanlis yapmanin iki yonu de kotu: koltuk sayilmazsa musteri bedava kullanir
(gelir kaybi + SCIM ile tutarsizlik), fazla sayilirsa musteriye kullanmadigi bir sey icin fatura
kesilir. Davet **kabul edilmemis** olabilir, **iptal** edilebilir, **suresi gecebilir** — koltugun
hangi anda sayildigi tek bir karardir ve iptal/expire yollariyla birlikte tasarlanmak zorundadir.
Parca parca yapilirsa arada "sayildi ama geri alinmadi" bir surum kalir.

## Yapilacak

1. **KARAR: koltuk ne zaman sayilir?** Iki tutarli cevap:
   (i) **Kabul aninda** (uyelik olustugunda) — `ensureSeatsCoverHeadcount`in bugunku anlamiyla birebir
       (SCIM de uyelik yaratiyor). Davet bekleyen kisi faturaya girmez. **Onerilen** — iki yol o zaman
       AYNI kurali paylasir, ikinci bir kavram dogmaz.
   (ii) Davet aninda — PRD`nin "davet + rol on-atama; koltuk faturaya yansir" cumlesine daha yakin,
       ama iptal/expire yollarinda koltugu geri vermeyi zorunlu kilar.
   Karari ve gerekcesini hem koda hem `#### K04.4` maddesine yaz.
2. Secilen ani UYGULA: davet kabul yolundan (ve gerekiyorsa davet olusturma yolundan)
   `ensureSeatsCoverHeadcount` cagrilir, **ayni transaction icinde** (yarim durum yok).
3. **Plan tavanini** unutma: koltuk artisi planin kotasini asiyorsa ne olur? Sessizce buyutmek de,
   sessizce reddetmek de yanlis — kullaniciya soyleyen bir hata/uyari yolu olmali. `entitlements.ts`
   zaten bir dil kuruyor, onu kullan.
4. Konsol tarafi: davet modalinda "bu davet faturanizi su kadar buyutecek" bilgisi (PRD "koltuk
   faturaya yansir" maddesinin kullaniciya donuk yarisi).

## Bilinen tuzaklar

- `sandbox-gate.ts` koltuk sayimini bir sinir olarak kullaniyor; degisiklik oradaki varsayimi bozabilir.
- Idempotanslik: ayni daveti iki kez kabul etmek koltugu iki kez ARTIRMAMALI.
- Faturalama testleri gercek Postgres ister; Docker kapaliysa suit 0 bayt cikti ile ASILIR (§1.4).
- Test veri depolari kosu basina izole (§1.1) — kirmizi "baska pencere" ile aciklanamaz.
