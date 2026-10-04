# Task ID: 202

**Title:** V2-APPS — Marketplace baglanti yollari: `api_key` sadece bir etiket + Zapier/Make otomasyonu yok (FR-MOD-09.2 · 09.4)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Iki kalem, tek yuzey (Apps Marketplace). (1) `09.2`: katalogdaki 104 kartin cogu `provider: "api_key"` tasiyor ama `AppService`te api_key icin ayri bir dal YOK — `oauthStart`/`oauthCallback` her kart icin ayni mock OAuth akisini kosuyor, yani PRD KK`sinin "her biri OAuth/API key" ayaginin ikinci yarisi kullaniciya hic ulasmiyor. (2) `09.4`: Zapier ve Make yalnizca iki katalog karti ve gosterdikleri sayilar sabit `dataFields` secenekleri — calisma alani olayindan zap/senaryo tetiklemeye giden hicbir yol yok. Uclu bir de kesik denetim payi var (202.2).

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

## (b) Kapsanan PLAN satirlari

| PLAN satir (2026-09-04) | Kod | Kanit blogu | Alt-gorev |
| --- | --- | --- | --- |
| 1280 (§5.0) | 09.2 | `#### K09.2-b` | 202.1 · 202.2 |
| 1282 (§5.0) | 09.4 | `#### K09.4` | 202.3 |

**PRD KK:** `09.2` (satir 665) _"Her biri OAuth/API key; kanal-tipli olanlar Channels`ta da yonetilir"_ ·
`09.4` (satir 667) _"700+ Zapier; partner/creator portali"_.

## (c) Dokunulacak dosyalar

- `apps/api/src/services/apps/app-service.ts` — `oauthStart` (:172) · `oauthCallback` (:187) ·
  `disconnect` · `requireConnectableApp`.
- `packages/types/src/apps.ts` — `APP_PROVIDERS` (:31), 104 kart katalogu, `zapier` (:304) · `make` (:319).
- `apps/api/src/routes/` apps ucu + `packages/contract/openapi/` (yeni alan/uc gerekirse).
- `apps/web/src/features/apps/` — kart baglanti akisi.
- Webhook altyapisi (MOD-08.8.4) — 202.3 onun uzerine kurulur, YENIDEN YAZILMAZ.

## (d) Bilinen tuzaklar

1. **Dis servis MOCK`lanir** (MASTER-PROMPT §5 · CLAUDE.md siniri). Gercek Zapier/Make/HubSpot`a istek
   ATILMAZ; hedef, gozlemlenebilir ve testlenebilir bir yol — mevcut mock OAuth deseninin esdegeri.
2. **API anahtari bir secret`tir.** PAT deseni izlenir: bir kez gosterilir, **hash`li** saklanir, log`a
   yazilmaz, `log-redact` kapsamina girer. Duz metin kolon ACMA.
3. `isChannelApp` capraz-bagi (kanal-tipli kart connect`i reddedip Channels`a yonlendiriyor) denetimde
   **gercek** bulundu — REGRESYONA sokma, api_key dali eklenirken de gecerli kalmali.
4. Yeni bir OpenAPI yolu eklersen `apps/mobile` parite sayaci kirilir; yorumla birlikte bump et.
5. Alt-gorev sirasi: **202.1 -> 202.2 -> 202.3.** 202.2 202.1`in actigi kodu okuyarak karar veriyor;
   202.3 bagimsizdir ama ayni dosyalara dokundugu icin sona birakildi.

## (e) Kapsam SINIRI

- YALNIZ `09.2` + `09.4`. `09.1` (marketplace girisi) ve `09.3` (API paketleri) zaten `✅` — dokunma.
- `08.8.4` (Webhooks) zaten `✅`; 202.3 onu KULLANIR, yeniden yazmaz.
- "Build your app" ayagi (OAuth 2.1 client kaydi + developer portali) denetimde **gercek** bulundu;
  yeniden acilmaz.

## Kapanista yapilacak PLAN.md guncellemesi

PLAN.md §5.0 (v2 kalem envanteri) icindeki ilgili satirin damgasi `◐ → K<kod>` yerine `✅ → K<kod>` olur.
Satir no `grep -n` ile bulunur — 2026-09-04 itibariyle: PLAN.md:1280 (`09.2`) ve :1282 (`09.4`). Kanit tablo hucresine
YAZILMAZ; `#### K<kod>` blogunun sonuna madde olarak eklenir:
`- ✅ <ne yapildi> — `<dosya>` · test `<dosya>` (n) · tm <id>`.
Ayrica **iki sayac** guncellenir cunku v2 kalem kuraldir, sayac degil:
(1) §5.0 basligindaki `0 ⬜ · 5 ◐ · 22 ✅ · 3 ⛔` satiri, (2) ust kapi tablosunun Faz-2 satiri (PLAN.md:22).

Kapanis dogrulamasi: `grep -n "| 09.2 \|| 09.4 " PLAN.md` cikan durum-damgali satirlarda `◐` KALMAMALI.

**Test Strategy:**

Aile ancak UC alt-gorevin hepsi kendi kapisindan gectikten sonra done.

GENEL KAPI (tum alt-gorevlerde ayni):
- TAM DoD kapisi (CONVENTIONS §1), exit code`lariyla. Test suiti §1.3 geregi parcalanabilir.
- Yeni/degisen test basliklari `(FR-MOD-...)` etiketi tasir (§7); `pnpm audit:req-coverage` exit 0.
- Kontrat degistiyse `pnpm -w contract:generate` sonrasi `git status --short packages/contract/src/generated`
  BOS. **`apps/mobile` parite testi tam uc sayisini pinliyor** — yeni bir OpenAPI yolu eklersen o sayaci
  yorumla birlikte bump et, yoksa mobil suiti kirmizi verir.
- Migration eklendiyse `pnpm -w db:check-drift` exit 0.

AILE KAPISI:
1. `provider: "api_key"` bir kart, OAuth mock`u KULLANMADAN baglanabiliyor; bagli kartin durumu
   `GET /apps` listesinde `connected` okunuyor.
2. Anahtarin duz metni hicbir yanitta ve hicbir log satirinda GORUNMUYOR (negatif test).
3. Bagli bir Zapier/Make karti icin calisma alani olayi gozlemlenebilir bir tetikleme uretiyor
   (mock alici); bagli DEGILKEN hicbir sey tetiklenmiyor.
4. `grep -n "| 09.2 \|| 09.4 " PLAN.md` §5.0 satirlarinda `◐` kalmamis olmali.

## Subtasks

### 202.1. V2-APPS-a [OPUS-XHIGH] `provider: api_key` gercek bir baglanti yolu olsun (FR-MOD-09.2)

**Status:** done  
**Dependencies:** None  

Katalogdaki `api_key` kartlari bugun OAuth mock akisindan geciyor. PRD KK "her biri OAuth/API key" diyor; ikinci yol yok. api_key kartlari icin anahtar girisiyle baglanan, anahtari hash`li saklayan ayri bir dal eklenir.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

`packages/types/src/apps.ts:31` — `APP_PROVIDERS = ["oauth", "api_key"]`, ve katalogdaki 104 kartin
cogunda `provider: "api_key"`. Ama `apps/api/src/services/apps/app-service.ts`:
- `oauthStart` (:172) her kart icin ayni `https://apps.siyahtus.local/oauth/<id>/authorize` URL`ini uretiyor,
- `oauthCallback` (:187) her kart icin ayni `state`+`code` dogrulamasini uyguluyor,
yani `provider` alani hicbir davranisi degistirmiyor — **yalnizca bir etiket**.

## Yapilacak

1. Kontrat once: api_key kartlari icin anahtar kabul eden bir baglanti yolu (`POST /apps/:appId/connect`
   ya da mevcut ucun `oneOf` govdesi — hangisi mobil parite sayacini bozmuyorsa onu sec, gerekcesini yaz).
2. `AppService`: `entry.provider === "api_key"` dali. `oauthStart` bu kartlar icin **reddeder**
   (400, "This app connects with an API key"), `oauthCallback` de oyle — iki yol birbirinin yerine
   gecemez, aksi halde `provider` yine anlamsiz kalir.
3. Anahtar **hash`li** saklanir (PAT deseni: `apps/api/src/lib` altindaki mevcut hash yardimcisi).
   `app_installations` satirina hash + son 4 hane gibi bir gosterim alani; duz metin YAZILMAZ.
   Migration gerekiyorsa CONVENTIONS §6.3 "genislet -> tasi -> daralt" kurali gecerlidir.
4. `log-redact` kapsami: anahtar log`a dusmemeli.
5. Web: api_key karti Connect`e basildiginda anahtar formu (mock OAuth modali DEGIL) — `lib/form.tsx`
   `useForm` deseni, alan-alti hata, gecersizken submit pasif.

## Bilinen tuzaklar

- **`isChannelApp` reddi korunur:** kanal-tipli kart (Messenger/Twilio/WhatsApp/Instagram/Telegram)
  buradan da baglanamaz, Channels`a yonlendirir. Denetim bu capraz-bagi `gercek` buldu.
- Istemci dogrulamasi sunucudan DAR olmamali (kayitli tuzak: form validator kendi ucuyla ayni esigi tasir).
- `apps/web` vitest CPU yuku altinda `userEvent` testlerinde 5000 ms timeout verir; `--maxWorkers=4`.

### 202.2. V2-APPS-b [OPUS-XHIGH] 09.2`nin okunamayan ikinci bosluguna karar ver

**Status:** done  
**Dependencies:** None  

Denetim 09.2 icin "Iki gercek bosluk" diyor; metin kaynaginda `…` ile kesik ve tam hali belgede YOK. Bu alt-gorev kalan payi PRD satirindan yeniden turetir, koda karsi dogrular, ya kapatir ya da gerekceyle `◐` birakir. `✅` UYDURULMAZ.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Neden ayri bir alt-gorev

Emsal tm 185`in `194.2`si (`FR-MOD-10.2`): kesik gerekce, KK`ya karsi yeniden turetme, ihlal
bulunamayinca `✅` uydurmama.

## Yapilacak

1. PRD satiri (`urun-gereksinim-dokumani-PRD.md`:665) uc parcaya ayrilir ve her biri koda karsi
   dogrulanir: (i) **kart sayisi** (v1: 15-20, v2: **100+**), (ii) **her biri OAuth/API key**,
   (iii) **kanal-tipli olanlar Channels`ta da yonetilir**.
2. tm 187 turunda ZATEN dogrulanmis olanlar (yalniz regresyon kontrolu): katalog **104 kart**
   (`packages/types/src/apps.ts`, `grep -c "provider:"`) · `isChannelApp` capraz-bagi **gercek** ·
   (ii)`nin api_key yarisi -> 202.1.
3. Supheli kalan: **bagli bir kartin gercekten bir sey yapip yapmadigi.** Katalog kartlarinin
   `dataFields` alanlari sabit secenek listeleridir (ornek `zapier` :313-317). Bagli bir HubSpot/
   Shopify karti Details panelinde gercek veri mi gosteriyor, yoksa bu sabit listeden mi? PRD`nin
   `09.2` KK`si veri icerigini istemiyor, ama "her biri" ifadesi baglanan kartin **bagli** olmasini
   istiyor — bulguyu yaz, kapsam disi ise gerekcesiyle kapsam disi yaz.
4. Ihlal bulunursa: kucukse bu pencerede kapat, buyukse yeni gorev ac ve `◐` birak. Ihlal yoksa
   damgayi `✅`e cevir ve **neyin arandigini** `#### K09.2-b`ye yaz.

## Bilinen tuzaklar

- Denetim metni KESIK; olcut PRD KK sutunu + kod.
- `09.2`nin bir de v1 satiri var (`PLAN.md:664`, `◐ → K09.2`) — o v1 payidir, bu gorevin kapsaminda
  DEGIL (v1 triyaji tm 186`da yapildi; satir `Must` olmadigi icin kapi bloklamiyor). Dokunma.

### 202.3. V2-APPS-c [OPUS-XHIGH] Zapier/Make otomasyon ayagi: calisma alani olayi -> zap/senaryo (FR-MOD-09.4)

**Status:** done  
**Dependencies:** None  

Zapier ve Make bugun yalnizca iki katalog karti; gosterdikleri "Active zaps" / "Last run" degerleri sabit `dataFields` secenekleri. PRD KK "700+ Zapier; partner/creator portali" diyor — portal ayagi gercek (OAuth 2.1 client kaydi, scope tavani, secret rotasyonu, developer portali), eksik olan otomasyon ayagi: bir calisma alani olayindan zap/senaryoya giden yol.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

`packages/types/src/apps.ts:304-332` — `zapier` (`provider: "oauth"`) ve `make` (`provider: "api_key"`)
kartlarinin `dataFields`i sabit secenek listeleridir (_"Active zaps: 0/1/3/7"_,
_"Last run: Success/Failed/Never run"_). Kod tabaninda bu iki kartin adini bagimsiz bir tetikleme
yoluna baglayan hicbir sey yok.

## Yapilacak

1. **Mevcut webhook altyapisini KULLAN** (`08.8.4`, zaten `✅`: HMAC-SHA256 + timestamp/nonce + 3x
   retry + SSRF korumasi). Yeni bir teslim mekanizmasi YAZMA — Zapier/Make baglantisi, o altyapiya
   kayitli bir aboneligin uzerine oturur.
2. Bagli bir Zapier/Make karti icin: hangi calisma alani olaylarinin tetikleyecegi (en az sohbet
   baslama/bitis ve ticket olusturma) ve hedefin nasil kaydedildigi. Baglanti YOKKEN hicbir sey
   tetiklenmez (negatif kapi).
3. Kart `dataFields`i sabit secenek yerine **gercek** sayilari okusun: kac tetikleme kayitli, en son
   ne zaman kostu. Sabit liste kalirsa kalem kapanmaz — denetimin bulgusu tam olarak budur.
4. Dis servis MOCK: gercek `hooks.zapier.com`a istek ATILMAZ; test bir mock alici kullanir
   (`channels-adapters.test.ts`in mock saglayici deseni emsal).
5. `700+` sayisi bir **pazarlama iddiasidir**, kod hedefi degil: PRD`nin olculebilir payi
   "partner/creator portali" + tetikleme yoludur. Bu yorumu gorevin kapanis notuna yaz.

## Bilinen tuzaklar

- **SSRF korumasi mevcut webhook yolunda yasiyor**; yeni bir cikis yolu acarsan o korumayi
  atlatmis olursun. Bu, guvenlik akil yurutmesi gerektiren bir yerdir.
- Saglayici hatasi **yutulup log`lanir**, cagiran akisi bozmaz (G1`in `dispatchAgentReply` karari emsal).
- Kart `provider` degerleri farkli (`zapier` oauth, `make` api_key) — 202.1`in acikligi ikisini de
  kapsamali, yoksa `make` baglanamaz.
