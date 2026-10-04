# Task ID: 243

**Title:** V8-CORS-WIDGET [OPUS-XHIGH] Production WEB_ORIGIN talimati widget origin'ini anmiyor — talimati izleyen dagitimda widget CORS'a takilir

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** tm 212 NFR-S6'nin "CORS izinli origin" kriterini okurken buldu: `.env.production.example:75`, `docs/production-checklist.md:37` ve `README`nin `WEB_ORIGIN` bolumu — ucu de listeye YALNIZ panel (+ ayri barindiriliyorsa chat sayfasi) origin'ini yazdiriyor, widget origin'ini (`WIDGET_BASE_URL`) HICBIRI anmiyor. Oysa widget'in tarayici kodu API'yi cross-origin cagiriyor ve production'da CORS `env.webOrigins`e daraliyor. Yani talimati harfiyen izleyen bir dagitimda panel calisir, urunun MUSTERI YARISI calismaz.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1; git akisi §2; handoff bicimi §3. Sinirlar `CLAUDE.md` —
production deploy YOK, gercek secret YOK.
PLAN kanit blogu: `#### KS6` (bulgunun kaydi orada, "Okurken bulunan komsu kusur" maddesi) ve
`#### KM-PROD-CFG` (`M-PROD-CFG-b`/`-c` bu talimatlari yazan turlardir). PLAN.md ~2,3 MB —
BASTAN SONA OKUMA. §7.2'nin `S6` satiri bu gorevle DEGISMEZ (zaten `✅`) — bu bir M-PROD-CFG
sinifi kusurdur, S6'nin guvenlik iddiasi degil.

(a) OLCULEN BULGU (tm 212 · 2026-09-07 — hepsi kod/dosya okumasi, olcum degil):
- `apps/api/src/server.ts:247` → `origin: env.isProduction ? env.webOrigins : true`. Production'da
  allowlist; `credentials: true`, yani "gelen origin'i yansit" bilincli olarak REDDEDILMIS
  (`env.ts:211-227`in kendi gerekcesi).
- `.env.production.example:75` → `WEB_ORIGIN=https://panel.<your-domain>`; hemen ustundeki yorum
  "the agent panel (and any separately hosted chat page)" diyor. Satir 78 `WIDGET_BASE_URL=
  https://widget.<your-domain>` — AYRI bir origin, ve `WEB_ORIGIN`e girmesi gerektigi hicbir
  yerde yazmiyor.
- `docs/production-checklist.md:37` → "WEB_ORIGIN is set to the real panel origin(s)
  (comma-separated if more than one host serves the panel or a standalone chat page)."
- `README.md` "### `WEB_ORIGIN`" bolumu → ayni cumle, ayni bosluk.
- `infra/helm/siyahtus/values.production.example.yaml:109` → `WEB_ORIGIN: "https://panel.<your-domain>"`.
- Widget FIILEN cross-origin cagiriyor: `apps/widget/nginx.conf`in `connect-src` yorumu
  ("The widget's REST calls go to the API on another origin — it has no same-origin backend at
  all"), `infra/helm/siyahtus/values.yaml:290-293` ("The widget's browser code calls the API
  cross-origin ... that image proxies nothing"), ve `loader.ts:97` widget origin'i host sayfaya
  esitse widget'i HIC ACMIYOR (yani widget her zaman ayri bir origin'dedir).
- Depo bunu BIR KEZ ZATEN OLCMUS: `#### KM-CONTAINER` / tm 140.3 — "production CORS'u
  `WEB_ORIGIN`'e daralip widget'in :5174'ten gelen cagrilarini — urunun musteri yarisini —
  kesiyor"; tam yigin compose bu yuzden `NODE_ENV=development` kosuyor. Yani bilgi vardi,
  TALIMATA gecmemisti.

(b) YAPILACAK IS:
1. Dort yeri de duzelt ve AYNI cumleyi kullan: `.env.production.example` · `README.md`
   (`WEB_ORIGIN` bolumu) · `docs/production-checklist.md` · `values.production.example.yaml`.
   Ornek deger `WIDGET_BASE_URL`in origin'ini de icermeli (ornegin
   `https://panel.<your-domain>,https://widget.<your-domain>`).
2. **Asil is bu: kapiyi kur, yalniz metni degil.** Bir talimat sessizce eskir; bir nobetci
   eskimez. Iki mesru secenek var, karar gerekce ile yazilir:
   (i) BOOT ZAMANI KONTROLU — `parseEnv` production'da `WIDGET_BASE_URL`in origin'i
       `webOrigins` icinde degilse **boot'u durdurur** (emsal: ayni dosyada origin olmayan bir
       `WEB_ORIGIN` degeri zaten boot'u durduruyor; "saglikli gorunen ama hicbir seyle eslesmeyen
       surec en kotusudur" gerekcesi birebir gecerli). Risk: mesru bir topolojiyi (widget'i
       panelle ayni host'tan servis eden) kilitleyebilir — ONCE dogrula.
   (ii) `env.production-example.test.ts` deseninde bir NOBETCI TEST — `.env.production.example`in
       `WEB_ORIGIN`i `WIDGET_BASE_URL`in origin'ini iceriyor mu; ayni disiplin
       `values.production.example.yaml` icin de. Ucuz, ama yalniz ORNEGI korur, gercek dagitimi
       degil.
3. `production-boot.test.ts`in uc CORS testi bu dalin bugunku davranisini kilitliyor — hangi yol
   secilirse secilsin onlari OKU ve gerekiyorsa GUNCELLE, sessizce bozma.

(c) BILINEN TUZAKLAR:
- `.gitignore`daki `.env.*` deseni `.env.production.example`i yakaliyor; `!.env.production.example`
  istisnasi var, ama yeni bir ornek dosya eklersen ayni tuzak isirir (`git check-ignore` ile bak).
- `env.parity.test.ts` uc yonlu parite tutuyor (`env.ts` <-> `.env.example` <-> `turbo.json`
  globalEnv). Yeni anahtar EKLEME niyetin yoksa bile, dokunursan onu kosur.
- Hosted Chat sayfasi (FR-MOD-08.5.9) ile widget iframe'i AYRI iki seydir; mevcut cumle yalniz
  birincisini anlatiyor. Ikisini karistirma, ikisi de listeye girebilir.

(d) KAPSAM SINIRI: CORS mekanizmasi (allowlist, `credentials: true`, normalize) DOGRUDUR ve
DEGISMEZ. Bu gorev yapilandirma talimatini + onun nobetcisini duzeltir. Gercek bir domain/DNS
ACILMAZ.

(e) KAPANIS: §7.2'de damga degisikligi YOK (`S6` zaten `✅`); kanit `#### KS6` blogua APPEND
edilir ("komsu kusur kapandi" maddesi) ve `#### KM-PROD-CFG`ye capraz referans verilir.
commit + push + Task Master `done`.

**Test Strategy:**

Olcut: (1) dort dosyanin dordunde de `WEB_ORIGIN` talimati widget origin'ini ismen istiyor ve ornek deger onu iceriyor; (2) secilen kapi FIILEN kirmizi verebiliyor — boot kontrolu secildiyse `WIDGET_BASE_URL`i listeden cikaran bir production ortami `parseEnv`i durduruyor (test), nobetci test secildiyse ornek dosyadan widget origin'i silindiginde suit kirmiziya donuyor (nobetcinin bos olmadigi kanit); (3) `apps/api/test/integration/production-boot.test.ts`in CORS testleri okundu ve gerekiyorsa guncellendi — sessizce bozulmadi; (4) `env.parity.test.ts` yesil; (5) gercek bir istekle dogrulama: production modda widget origin'inden gelen bir `OPTIONS`/`GET` `Access-Control-Allow-Origin` aliyor, listede olmayan bir origin ALMIYOR; (6) tam DoD kapisi (CONVENTIONS §1) exit code'lariyla.
