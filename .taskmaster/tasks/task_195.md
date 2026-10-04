# Task ID: 195

**Title:** F0-WIDGETGAP — Widget`in uc `Must` kalemi (FR-MOD-11.1 · 11.4 · 11.6)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Denetim widget`in uc `Must` kalemini KISMI buldu: launcher`da unread rozeti HIC yok ve yoklama dongusu yalniz panel acikken calistigi icin kapali widget yeni mesaji fark edemiyor; composer`da emoji yok; embed snippet`in KK`sindaki "RTM baglantisi" karsilanmiyor — widget hicbir soket kurmuyor, 4 saniyelik yoklama ile calisiyor.

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
| 293 | 11.1 | `#### K11.1` | 195.1 |
| 296 | 11.4 | `#### K11.4` | 195.2 |
| 297 | 11.6 | `#### K11.6` | 195.3 |

## (c) Ana dosyalar

- `apps/widget/src/widget.ts` — `POLL_INTERVAL_MS = 4_000` (:24), `startPolling` (:959-975),
  launcher render (:1168 civari), proaktif kart yuvasi (:568-630), composer (:1417 civari).
- `apps/rtm/` — 195.3`un karsi tarafi.
- `apps/widget/test/bundle-size.test.ts` — bundle butcesi kapisi (`existsSync` ile assert eder,
  sessizce atlamaz; tm 156.1).

## (d) Alt-gorev sirasi

195.1 ve 195.3 AYNI dosyanin ayni bolumune (yoklama/soket yasam dongusu) dokunuyor. **Once 195.3
(RTM) yapilirsa 195.1`in "kapaliyken yoklama" yarisi kendiliginden degisir** — o yuzden onerilen sira
195.3 -> 195.1, ya da 195.1`in yalniz rozet yarisi once. Ikisini ayni turda ACMA. 195.2 bagimsiz.

## (e) Kapsam SINIRI

- YALNIZ uc satir. `11.2` (greeting + quick replies) tm 185 triyajinda `✅`e geri alindi (tm 176
  M-CAMP kampanya kartini widget`a bagladi) — ona DOKUNMA. `11.3`/`11.5`/`11.7` Faz-0 `Must` degil.
- Widget bundle butcesi bir kapidir: her uc alt-gorev de `apps/widget/test/bundle-size.test.ts`i
  yesil birakmak zorunda. Bir kutuphane eklemek bu kapiyi kirar.

## Kapanista yapilacak PLAN.md guncellemesi

Bu ailenin TUM alt-gorevleri bittiginde ilgili `Must` satirinin damgasi `◐ → K<kod>` yerine
`✅ → K<kod>` olur (PLAN.md §3, satir no `grep -n` ile bulunur — 2026-09-04 itibariyle gecerli satir
numaralari asagida yazili, dosya degistikce kayar). Tek bir alt-gorev bir satiri tek basina kapatiyorsa
o satiri o alt-gorev cevirir. Kanit tablo hucresine YAZILMAZ; `#### K<kod>` blogunun sonuna madde
olarak eklenir: `- ✅ <ne yapildi> — `<dosya>` · test `<dosya>` (n) · tm <id>`.
Faz-0 `Must` sayaci (PLAN.md:18 kapi tablosu) her kapanan satirda guncellenir.

**Test Strategy:**

Aile ancak uc alt-gorev de DoD kapisindan gectiginde done. Kapanista uc satirda da `◐` KALMAMALI.

## Subtasks

### 195.1. F0-WIDGETGAP-a [OPUS-XHIGH] Launcher unread rozeti + kapaliyken haberdar olma (FR-MOD-11.1)

**Status:** done  
**Dependencies:** None  

PRD KK: "Ac/kapa; yeni greeting`te rozet/animasyon; Trusted domains disindaysa yuklenmez". Birinci ve ucuncu tam. Unread rozeti HIC yok — `widget.ts`te "unread"/"badge" gecen tek satir yok — ve yoklama dongusu yalniz panel acikken calistigi icin kapali widget yeni mesaji zaten fark edemiyor.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- `grep -n "unread\|badge" apps/widget/src/widget.ts` -> **0 satir**.
- `startPolling` (:959-975) ve cevresindeki yorum: yoklama `state.open && !doc.hidden` kosuluna bagli
  ("a backgrounded tab gains nothing from polling"). Bu karar pil/ag acisindan MAKUL ama rozetin
  onkosulunu yok ediyor: kapali widget yeni mesaji hic ogrenemez.
- Launcher yalniz metin tasiyor (:1168 civari).

## Yapilacak — ONCE KARAR

Rozet, "kapaliyken yeni mesaj var mi" sorusunun cevabini gerektirir. Uc secenek:

(i) **195.3`u (RTM) BEKLE** ve rozeti soketten besle — en dogru cevap, en az ag trafigi. Bu
    alt-gorevi 195.3`ten SONRA yapmak bu yuzden onerilir.
(ii) Kapaliyken **seyrek** yoklama (ornegin 30-60 sn) — 4 sn`lik hizli yoklamanin gerekcesi acik
    panelin canliligiydi; kapali panel icin ayni butce gerekmiyor. Sekme gizliyken durur.
(iii) Rozeti yalniz proaktif kart/kampanya olaylarindan besle — eksik cevap (ajanin cevabi rozet uretmez).

Sectigini ve **neden digerini secmedigini** `#### K11.1` maddesine yaz.

## Yapilacak — uygulama

1. Okunmamis sayaci: hangi mesaj "okunmamis"? Panel kapaliyken gelen musteri-gorunur ajan/AI
   mesajlari. Panel acilinca sifirlanir. Sayaci kalici kilma (sessionStorage) karari verilir —
   sayfa yenilendiginde rozet kaybolursa musteri cevabi kacirir.
2. Launcher rozeti: sayi + erisilebilir metin (`aria-label`), 0 iken render EDILMEZ.
3. "Yeni greeting`te rozet/animasyon" maddesi: proaktif kart bekliyorken de rozet/animasyon
   (kampanya karti mekanizmasi tm 176.3`te geldi, `activeCard()` :585).
4. Bundle butcesi kapisini gec.

## Bilinen tuzaklar

- **Headless Chromium bir sekmeyi blur edemez** — her sayfa "focused + visible" raporlar. Gorunurluk/
  odak davranisini test ederken `document.hasFocus`u `page.evaluate` ile override et, `addInitScript`
  ile DEGIL (belgelenmis tuzak).
- `doc.hidden` mantigini degistirirken mevcut yorumlarin gerekcesini KORU; pil/mobil ag argumani
  gecerli, yalniz kapali-panel durumu icin yeniden dengeleniyor.
- Widget capraz-origin sandbox iframe icinde calisir; ana sayfaya sizan bir global EKLEME.

### 195.2. F0-WIDGETGAP-b [SONNET-XHIGH] Widget composer`inda emoji (FR-MOD-11.4)

**Status:** done  
**Dependencies:** None  

PRD KK`nin uc maddesi (canli iletim, file-sharing kurali, bos mesaj engeli) karsilanmis ve testli. Kalan pay basliktaki dorduncu arac: emoji. `widget.ts`te emoji gecen tek satir bir yorum ("Text-labeled, not emoji-only").

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- `grep -ni emoji apps/widget/src/widget.ts` -> yalniz `:1417` bir a11y yorumu; emoji secici YOK.
- Var olan: Customer Chat API ile canli iletim ✅ · `uploads.ts:105` `fileSharingEnabled` kapaliysa
  red ✅ · `if ((!text && !attachment) || state.sending) return` bos mesaj engeli ✅.

## Yapilacak

1. Kucuk, bagimlilliksiz bir emoji secici. **Kutuphane EKLEME** — widget bundle butcesi bir kapidir
   (`apps/widget/test/bundle-size.test.ts`, tm 156.1`den beri sessizce atlamiyor, assert ediyor).
   Kategorili kisa bir liste yeterli; tam Unicode katalogu gerekmez ve butceyi yer.
2. Klavyeyle gezilebilir + `aria-label` (NFR-A11Y). Secim imlecin oldugu yere eklenir.
3. `apps/web` tarafindaki emoji secici (tm 189.5) ile **ayni sozlugu paylasmak** cazip ama widget
   ayri bir bundle: paylasim butceyi buyutuyorsa AYRI tut ve gerekcesini yaz.
4. Emoji tasiyan mesajin uctan uca dogru gittigini dogrula (UTF-8/surrogate cifti; bazi emoji iki
   kod birimi — uzunluk siniri karakter mi kod birimi mi sayiyor? Sinir testini yaz).

## Bilinen tuzaklar

- Bundle butcesi: `pnpm --filter @siyahtus/widget build` calistirilmadan test "run build first" ile
  KIRMIZI verir — sessizce atlamaz.
- Widget sandbox iframe icinde; secici panelin disina tasarsa kirpilir (`overflow`).
- Mesaj uzunluk siniri sunucuda; emoji ile sinira dayanan bir mesaj sunucuda reddedilirse istemci
  sayaci yanlis demektir.

### 195.3. F0-WIDGETGAP-c [OPUS-MAX] BOLUNMEZ: widget RTM baglantisi (FR-MOD-11.6)

**Status:** done  
**Dependencies:** None  

Snippet, capraz-origin sandbox iframe, postMessage origin+source dogrulamasi ve trusted-domain kapisi EKSIKSIZ. KK`daki "RTM baglantisi" karsilanmiyor: widget WebSocket kurmuyor, 4 saniyelik yoklama ile calisiyor.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- `apps/widget/src/widget.ts:24` `POLL_INTERVAL_MS = 4_000`; :287 yorumu birebir: "the widget holds
  no socket". `startPolling` :959-975.
- PRD `FR-MOD-11.6` KK: "License-scoped iframe; **RTM baglantisi**; Trusted domains kontrolu".
  Birinci ve ucuncu tam.

## Neden [OPUS-MAX] ve neden BOLUNMEZ

Widget`a soket koymak **musteri tarafinda kimlik dogrulanmis, kalici bir baglanti** acmaktir. Uc sey
ayni anda dogru olmak zorunda, ayri turlara bolunurse arada guvensiz ya da bozuk bir surum kalir:
(1) **kimlik** — musteri jetonu soket el sikismasinda nasil tasinir ve nasil dogrulanir (widget
jetonu tarayicida durur; ajan oturumuyla ayni kapidan gecemez); (2) **kiracı sinirı** — soket yalniz
kendi sohbetinin olaylarini almali, `chats--all` gibi genis bir kanala abone OLMAMALI; (3) **geri
dusme** — soket kurulamazsa (proxy, kurumsal guvenlik duvari) yoklama devam etmeli, yoksa widget
bugun calisan musterilerde SESSIZCE olur. Bu ucu tek karardir.

## Yapilacak (contract-first)

1. **Sozlesme:** RTM tarafinda musteri rolu icin login/subscribe/push sozlesmesi. `apps/rtm` zaten
   ajan tarafi icin bu uc adimi ve missed-event senkronunu tasiyor — **onun modelini kullan**,
   ikinci bir protokol ICAT ETME. Musterinin abone olabilecegi tek sey kendi sohbetidir.
2. **Yetki:** el sikismasinda musteri jetonu dogrulanir; jetonun kapsadigi sohbet disindaki her
   abonelik reddedilir. Cross-tenant ve cross-chat negatif testleri ZORUNLU (bu, musteri tarafina
   acilan ilk kalici baglanti — IDOR burada en pahalisidir).
3. **Geri dusme:** soket kurulamaz ya da duserse yoklamaya don; soket geri gelince yoklamayi durdur.
   Ikisi ayni anda calisirsa mesajlar iki kez islenir — idempotanslik (olay id`si ile) sart.
4. **Kacirilan olay senkronu:** yeniden baglanmada aradaki olaylar cekilir (ajan tarafindaki
   missed-event deseni). Musteri sekmeyi uyutup geri dondugunde sohbet EKSIKSIZ olmali.
5. **Bundle butcesi:** soket istemcisi widget`a agirlik ekler; `bundle-size.test.ts` kapisini gec.
   Gecemiyorsan butceyi buyutmek bir KARARDIR, gerekcesiyle yazilir.

## Bilinen tuzaklar

- e2e sabit portlarda gercek sunucular kaldirir; **iki pencere ayni anda e2e kosamaz**. Bayat bir
  dev sunucu (5173) tum suiti kirmizi yapar.
- `pnpm -w test:e2e` kok `.env`i KENDILIGINDEN ALMAZ: `set -a && . ./.env && set +a && pnpm -w test:e2e`.
  Aksi halde RTM sunucusu `DATABASE_URL: Required` ile duser ve tum suit "webServer timeout" verir.
- Headless Chromium sekmeyi blur edemez; gorunurluk davranisini `page.evaluate` ile override et.
- Bir e2e turu ~55-84 `apps/e2e/kanit/*.png` yeniden yazar — beklenen churn, geri al.
- 195.1 (rozet) ile AYNI yasam dongusune dokunur; ayni turda ikisini acma.
