# Task ID: 189

**Title:** F0-INBOX — Faz-0`in yeniden acilan 9 Inbox kalemi (FR-MOD-02.*)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Denetim Inbox`un 9 `Must` kalemini KISMI buldu: supervised gorunumu yok, gonderim hatasi geri alinamiyor, sohbet listesi RTM`de yeniden siralanmiyor, Details`te atama kontrolu yok, arsivde Copilot ozeti alinamiyor, composer`da rich text/emoji yok, ticket gorunumlerinde hata-empty yok, iki aksiyonun hic testi yok.

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
| 212 | 02.1.1 | `#### K02.1.1` | 189.1 |
| 213 | 02.1.3 | `#### K02.1.3` | 189.2 |
| 214 | 02.2.2 | `#### K02.2.2` | 189.3 |
| 216 | 02.3.3 | `#### K02.3.3` | 189.4 |
| 219 | 02.3.6 | `#### K02.3.6` | 189.4 |
| 218 | 02.3.5 | `#### K02.3.5` | 189.5 |
| 220 | 02.4.1–.6 | `#### K02.4.1-.6` | 189.6 |
| 221 | 02.6 | `#### K02.6` | 189.7 |
| 222 | 02.8 | `#### K02.8` | 189.8 |

02.3.3 ve 02.3.6 AYNI eksigi (hata retry) tarif ettigi icin tek alt-goreve (189.4) baglandi; o
alt-gorev iki satiri birden kapatir.

## (c) Ana dosyalar

- `apps/api/src/routes/chats.ts` (view enum, :21) · `apps/api/src/services/chat/chat-service.ts`
  (`viewFilter` :1691-1737, liste siralamasi :1555 civari).
- `apps/web/src/features/inbox/` — `InboxPage.tsx` (VIEWS :78-90, TICKET_VIEWS :101), `Composer.tsx`,
  `DetailsPanel.tsx`, `CopilotPanel.tsx`, `useInbox.ts`.
- `apps/rtm/` — 189.3 icin push yolu.

## (d) Alt-gorev sirasi

Bagimsizlar: 189.1 · 189.2 · 189.5 · 189.7 · 189.8 herhangi bir sirada. 189.4 (retry) `Composer.tsx` +
`useInbox.ts` dokunuyor, 189.5 de `Composer.tsx` dokunuyor — ayni turda ikisini birden acma, ikinci
pencere birincinin sonucunu okur. 189.3 en agir kalem (`[OPUS-MAX]`), tek basina bir pencere ister.

## (e) Kapsam SINIRI

- YALNIZ yukaridaki 9 satir. `02.1.2` (AI Agents grubu, v1) · `02.1.4` (Views) · `02.3.2`
  (Reply suggestions) · `02.5` · `02.7` · `02.9` Faz-0 `Must` degil, DOKUNMA.
- `02.3.1` (transcript) ve `02.3.4` (message type) zaten `✅` — regresyon yaratmadigin surece
  damgalarina dokunma.

## Kapanista yapilacak PLAN.md guncellemesi

Bu ailenin TUM alt-gorevleri bittiginde ilgili `Must` satirinin damgasi `◐ → K<kod>` yerine
`✅ → K<kod>` olur (PLAN.md §3, satir no `grep -n` ile bulunur — 2026-09-04 itibariyle gecerli satir
numaralari asagida yazili, dosya degistikce kayar). Tek bir alt-gorev bir satiri tek basina kapatiyorsa
o satiri o alt-gorev cevirir. Kanit tablo hucresine YAZILMAZ; `#### K<kod>` blogunun sonuna madde
olarak eklenir: `- ✅ <ne yapildi> — `<dosya>` · test `<dosya>` (n) · tm <id>`.
Faz-0 `Must` sayaci (PLAN.md:18 kapi tablosu) her kapanan satirda guncellenir.

**Test Strategy:**

Aile ancak sekiz alt-gorevin hepsi DoD kapisindan gectiginde done. Kapanista `grep -n "| 02\." PLAN.md` cikan durum-damgali satirlarin yukaridaki dokuzunda `◐` KALMAMALI.

## Subtasks

### 189.1. F0-INBOX-a [OPUS-XHIGH] `supervised` sohbet gorunumu (FR-MOD-02.1.1)

**Status:** done  
**Dependencies:** None  

PRD KK: "Her oge orta listeyi filtreler; sayaclar RTM ile canli". Chats grubunun alti ogesinden biri — Supervised — inbox`ta HIC yok; gozetleme yalniz Traffic panosunda var.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- `apps/api/src/routes/chats.ts:21` view enum: `all/my/queued/unassigned/archived/ai/ai_solved` —
  `supervised` YOK.
- `apps/api/src/services/chat/chat-service.ts` `viewFilter` (:1691-1737 civari) icinde supervised dali yok.
- `apps/web/src/features/inbox/InboxPage.tsx` `VIEW_LABEL_KEY` (:81-89) ve `VIEWS` dizisinde yok.
- Gozetleme kavraminin sunucu tarafi VAR ama baska bir yuzeyde:
  `apps/api/src/services/traffic/supervision-service.ts` + `traffic-service.ts` (`supervised` durumu,
  :30/:47/:416-446). Yani sifirdan model kurmuyorsun; var olan gozetim kaydini inbox gorunumune bagliyorsun.

## Yapilacak (contract-first)

1. **Sozlesme:** OpenAPI `GET /chats` `view` enum`una `supervised` eklenir; `@siyahtus/types` yeniden uretilir
   (`pnpm -w contract:generate`, sonrasinda `git status --short packages/contract/src/generated` BOS olmali).
   **Yeni yol acilmiyor** — mevcut yola deger ekleniyor, yani `apps/mobile` parity sayaci bozulmaz.
2. **Backend:** `viewFilter`a supervised dali. Tanim karari gerekli ve gerekcesi koda yazilir:
   "supervised" = bu ajanin gozetledigi (supervision kaydi olan) AKTIF sohbetler. `traffic-service.ts`in
   oncelik siralamasindaki gerekceyi (`queued > supervised > waiting/chatting`) oku, ayni tanimi kullan —
   iki yuzeyin ayni kelimeye farkli anlam vermesi bu kalemin kok nedeni.
3. **RLS/izolasyon:** sorgu tenant sinirini RLS`e birakir; kopya `license_id` filtresi ekleme (M-CHOBS emsali).
4. **Frontend:** `VIEWS` + `VIEW_LABEL_KEY` + i18n `en`/`tr` anahtari. Bos durum metni ayrilir
   ("Supervising nothing right now"), `inbox.list.empty.*` ailesine katilir.
5. **Sayac:** PRD "sayaclar RTM ile canli" diyor. Diger gorunumlerin sayaci nereden geliyorsa
   supervised de oradan gelir; ayri bir mekanizma icat etme.

## Bilinen tuzaklar

- OpenAPI`ye YENI YOL eklemek `apps/mobile` parity testinin sabitledigi uc sayisini bozar. Bu
  alt-gorev yol EKLEMIYOR; eklemek zorunda kalirsan sayaci yorumla birlikte guncelle.
- Entegrasyon testleri kendi izole veritabanini alir (CONVENTIONS §1.1); `--concurrency=1` gerekmez.
  Docker kapaliysa suit CEVAP VERMEZ (0 bayt, 10+ dk) — once `docker info`.
- Cross-tenant negatif test zorunlu: baska kiracinin gozetledigi sohbet bu listede GORUNMEZ.

### 189.2. F0-INBOX-b [SONNET-XHIGH] Tickets grubu: dorduncu oge + "Ticket views unavailable" (FR-MOD-02.1.3)

**Status:** done  
**Dependencies:** None  

PRD KK`nin siralama yarisi karsilanmis (ticket-service.ts:136). Eksik olan: PRD`nin dorduncu ogesi "More (grid)" yerine "Solved" konmus ve PRD`nin acikca andigi "Ticket views unavailable" hata-empty durumu yok.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- `apps/web/src/features/inbox/InboxPage.tsx:101-105` `TICKET_VIEWS` = `all` · `unassigned` ·
  `my_open` · `solved`. PRD (satir 499, FR-MOD-02.1.3) dorduncu ogeyi **"More (grid)"** diye
  adlandiriyor — yani ticket grid`ine (FR-MOD-02.7, teslim edilmis) acilan bir kapi.
- Kaynak sutunu acikca `"Ticket views unavailable"` hata-empty durumunu aniyor; boyle bir durum yok.

## Yapilacak — ONCE KARAR, sonra kod

Iki secenek var, birini gerekcesiyle sec ve gerekceyi `#### K02.1.3` blogunun maddesine yaz:

(i) `solved` KORUNUR ve **yaninda** bes"inci oge olarak "More" eklenir (grid`e gotururur).
(ii) `solved` "More"a donusturulur ve solved filtresi grid`in kendi filtresine birakilir.

Onerilen (i): `solved` bugun calisan bir filtre ve kullanicidan bir sey almak, ona bir sey vermekten
daha pahalidir. Ama karari sen ver — PRD`nin listesi dort oge sayiyor, bes"inci ogenin gerekcesi yazilmali.

Ikinci is: ticket listesi sorgusu hata dondugunde (403/500) liste alani `"Ticket views unavailable"
esdegeri bir hata-empty gosterir — bugun `useQuery` hatasi yalniz genel hata yolundan geciyor.
i18n `en`+`tr` anahtari eklenir; metin sunucudan degil katalogtan gelir.

## Bilinen tuzaklar

- `Selection` tipi (`InboxPage.tsx:99` civari) sohbet ve bilet secimini TEK degerde tutuyor; yeni bir
  oge eklerken bu birligi bozma (yorumda neden boyle oldugu yazili: iki ayri state ayrisir).
- Ticket gorunum filtresi URL`in isi (`ticket-grid.ts`, tm 179.3 deep-link`ledi) — yeni oge de
  URL`den okunabilir olmali, yoksa paylasilan link bozulur.
- `getByRole("link", {name})` alt dizi eslediginde strict-mode ihlali verir (tm 182.2 emsali):
  "More" gibi kisa bir etiket baska bir bagliantinin adinin icinde geciyorsa test belirsizlesir.

### 189.3. F0-INBOX-c [OPUS-MAX] BOLUNMEZ: sohbet listesi RTM`de yukari tasinsin (FR-MOD-02.2.2)

**Status:** done  
**Dependencies:** None  

PRD KK: "Tiklama transcript acar; RTM`de yukari tasinir + unread". Ikinci yari karsilanmiyor: liste `chats.created_at DESC, id` ile siraliyor ve `created_at` hic degismiyor; yeni mesaj yalniz satirin `last_event`/`unread` alanini YERINDE guncelliyor.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- `apps/api/src/services/chat/chat-service.ts` — liste sunucuda `chats.created_at DESC` + `id` ile
  siralaniyor (denetim :1555`i isaret ediyor; satir numarasi kaymis olabilir, `grep -n "createdAt"` ile bul).
- `apps/web/src/features/inbox/useInbox.ts` — RTM olayi geldiginde satirin alanlari guncelleniyor,
  liste yeniden SIRALANMIYOR (denetim :539 civarini isaret ediyor).
- Sonuc: mesaj yazan musteri listenin dibinde kalir. Bu bir gorsel detay degil — ajanin isini
  sirasiyla yapmasini imkansiz kilar.

## Neden [OPUS-MAX] ve neden BOLUNMEZ

Siralama anahtarini degistirmek **keyset sayfalamayi** dogrudan etkiler. Bugunku imlec `created_at`
gibi DEGISMEYEN bir alana dayaniyor; `last_event_at` gibi DEGISEN bir alana gecince ayni satir iki
sayfada birden gorunebilir ya da hic gorunmeyebilir (imlecin altindan kayar). Sunucu siralamasi +
imlec + istemci yeniden siralamasi TEK karar; ucunu ayri pencerelerde yapmak tutarsiz bir liste uretir.

## Yapilacak

1. **Karar + olcum:** siralama anahtari ne olacak? Adaylar: (a) `chats` uzerinde bakimi yapilan bir
   `last_event_at` kolonu (migration + olay yazan yolda guncelleme), (b) `threads`/`events` uzerinden
   turetilen bir deger. (a) hizli okur, yazma yolunu kirletir; (b) yazmayi temiz tutar, okumayi
   pahalilastirir. Karari **EXPLAIN ANALYZE ile olcerek** ver (NFR-P2 okuma butcesi 150 ms;
   `reports-billing.test.ts` / tm 183.1 probe deseni). Gerekce testin icine yazilir.
2. **Migration (gerekiyorsa):** CONVENTIONS §6.3 — genislet/tasi/darallt. Yeni kolon nullable ya da
   `DEFAULT`lu eklenir; geri dolduran migration ayri ifade. `CREATE INDEX CONCURRENTLY` kullanacaksan
   migration dosyasinda TEK ifade olmak zorunda (yanina ikinci ifade 25001 ile dusurur).
3. **Imlec:** keyset imleci yeni anahtari tasimali ve **kararli** olmali (esitlikte `id` ikinci anahtar).
   Bozuk/bayat imlec hata DEGIL bayat yer imi olarak ele alinir (`audit-log-reader.ts` deseni).
4. **Istemci:** RTM olayi geldiginde ilgili sayfa cache`i yeniden siralanir; secili sohbet
   KAYBOLMAZ (secim id ile tutulur, index ile degil).
5. **unread:** PRD ayni cumlede "+unread" diyor; unread bugun calisiyor, regresyon testiyle korunur.

## Bilinen tuzaklar

- Migration uygulanmis bir dosyayi duzenlemek bu depoda TOLERE EDILIYOR ama yeni bir dosya acmak
  daha temiz. `pnpm -w db:check-drift` exit 0 olmali; shadow DB gerekiyorsa Prisma uzerinden acilir
  (`psql` PATH`te degil; container: `docker exec -i siyahtus-db`, kullanici `siyahtus`, MSYS_NO_PATHCONV=1).
- Test veri depolari kosu basina izole (CONVENTIONS §1.1) — kirmizi gorursen "baska pencere"
  aciklamasi GECERSIZ.
- api `test` script`i unit+integration birlikte ~858 s; §1.3 geregi parcala ve her parcanin exit
  code`unu handoff`a yaz.

### 189.4. F0-INBOX-d [OPUS-XHIGH] Gonderim hatasi geri alinabilsin — retry (FR-MOD-02.3.3 · 02.3.6)

**Status:** done  
**Dependencies:** None  

Iki PRD kaleminin KK`si ayni kelimeyi kullaniyor: "hata retry". Bugun basarisiz gonderimde ajanin yazdigi metin GERI GELMIYOR ve tekrar-gonder aksiyonu YOK — yazilan mesaj sessizce kayboluyor.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- `apps/web/src/features/inbox/Composer.tsx:123` — `submit()` metni gonderim SONUCUNU BEKLEMEDEN
  `setText("")` ile temizliyor.
- `apps/web/src/features/inbox/useInbox.ts` — `optimistic.onError` yalniz transcript cache`ini geri
  aliyor (denetim :539); composer metni geri gelmiyor.
- `Composer.tsx:478-486` — gonder butonu yalniz `submit` cagiriyor; basarisiz bir gonderimi tekrar
  denemeye yarayan hicbir kontrol yok.
- PRD: `FR-MOD-02.3.3` KK "Bos mesaj engellenir; optimistic gonderim; **hata retry**";
  `FR-MOD-02.3.6` KK "Bosken pasif; **hata retry**". Iki satir da bu alt-gorevle kapanir.

## Yapilacak

1. **Karar:** metin ne zaman temizlenir? Iki dogru cevap var: (i) iyimser temizle + hatada geri koy,
   (ii) sonucu bekle. (i) daha akici ama geri koyma sirasinda kullanici yeni bir sey yazmis olabilir —
   o durumda YAZDIGININ USTUNE YAZMA (bu, hatanin kendisinden daha kotu bir kayiptir). Karari ve
   catisma cozumunu kodun yanina yaz.
2. Basarisiz olay transcript`te "gonderilemedi" durumuyla KALIR ve yaninda **Retry** kontrolu bulunur;
   retry ayni idempotent gonderimi yeniden dener (`send_event` deseni — mevcut idempotency anahtarini
   kullan, yenisini icat etme; ayni mesajin iki kez gitmesi bu isin en kotu sonucudur).
3. Kalici hata (403/422) ile gecici hata (5xx/ag) ayrilir: gecicide Retry sunulur, kalicida sunucunun
   cumlesi gosterilir ve Retry gizlenir (sonucu kesin 403 olan bir buton tuzaktir — tm 181.3 emsali).
4. Ek (`attachment`) tasiyan gonderimde retry ekin kendisini de tasimali ya da acikca reddetmeli.

## Bilinen tuzaklar

- `apps/web` vitest CPU yuku altinda `userEvent` testlerinde 5000 ms timeout verir; `--maxWorkers=4`.
- Optimistic rollback`in TanStack Query tarafi (`onError`) ile bilesen state`i AYRI iki dunya;
  ikisini tek kaynaga bagla yoksa "metin geri geldi ama transcript`te hala hayalet balon var" olur.
- Ayni turda 189.5 (rich text/emoji) ACILMAZ — ikisi de `Composer.tsx` dokunuyor.

### 189.5. F0-INBOX-e [SONNET-MAX] Composer araclari: rich text + emoji (FR-MOD-02.3.5)

**Status:** done  
**Dependencies:** None  

PRD bes arac sayiyor (canned `#`, #tags, rich text, emoji, attach); ikisi var. Rich text (kalin/italik/liste) YOK — duz `<textarea>`; emoji secici HIC yok (`apps/web` genelinde "emoji" gecen tek satir yok).

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- `apps/web/src/features/inbox/Composer.tsx:411-441` duz `<textarea>`.
- `grep -ril emoji apps/web/src` -> **0 dosya**.
- Var olan: canned `#` menusu ✅ · attach ✅ (`attachment.ts:23-36`, /uploads kuralina bagli).

## Kapsam karari — ONCE BUNU YAZ

PRD`nin `FR-MOD-02.3.5` **Kabul Kriteri** sutunu yalniz iki maddeyi sayiyor ("`#` canned menusu;
attach File sharing kurallarina tabi") ve ikisi de karsilanmis; rich text/emoji **Aciklama** sutunundan
geliyor. tm 185 triyaji bu satiri yine de **is** olarak acti (kapsam daraltmadi) cunku bes aracin
ucunun eksikligi urun yuzeyinde gercek bir boslugu. Ama **sirayi** bu belirler: emoji once (ucuz,
bagimsiz), rich text sonra (tasarim karari ister).

## Yapilacak

1. **Emoji secici.** Uculuncu parti bagimlilik EKLEME (paket butcesi + widget bundle guard deseni);
   kucuk bir kategorili liste yeterli. Klavyeyle gezilebilir (NFR-A11Y4), `aria-label` tasir,
   secim imlecin oldugu yere eklenir (sonuna degil).
2. **Rich text.** KARAR: depolama bicimi ne? Sunucu bugun duz metin tasiyor. Uc secenek:
   (i) Markdown alt kumesi (metin duz kalir, render istemcide) — **onerilen**, migration istemez,
   musteri widget`i da ayni metni gosterebilir; (ii) HTML (XSS yuzeyi acar, widget`ta sanitize
   zorunlu); (iii) yapisal JSON (sema degisikligi). Karar gerekcesiyle `#### K02.3.5` maddesine yazilir.
   Secilen bicim **musteri tarafinda da** dogru gorunmeli — widget duz metin gosteriyorsa ajanin
   `**kalin**` yazmasi musteride yildizli metin olarak cikar; bu kabul edilebilir mi, karari ver ve yaz.
3. `#tags` (composer`da etiket ekleme) bu alt-gorevin kapsaminda DEGIL — `FR-MOD-08.7.1` tag yuzeyi
   tm 181.1`de kapandi; composer entegrasyonu ayri bir kalem olarak notta anilir, is acilmaz.

## Bilinen tuzaklar

- Ayni turda 189.4 (retry) ACILMAZ — ikisi de `Composer.tsx` dokunuyor.
- Emoji dugmesi `aria-label`siz birakilirsa axe `button-name` ihlali verir; a11y suiti bunu yakalar.
- Rich text render`i musteri metnine uygulanirsa **XSS**: musterinin yazdigi `<script>` ajan
  konsolunda calismamali. Widget tarafindaki mevcut "literal, inert string" deseni referans alinir.

### 189.6. F0-INBOX-f [OPUS-XHIGH] Details panelinde atama kontrolu (FR-MOD-02.4.1–.6)

**Status:** done  
**Dependencies:** None  

PRD KK: "Bolumler katlanir; tag/assignee aninda kaydeder; sure/ziyaret canli". Katlanma ve tag aninda kaydetme var; **assignee aninda kaydeder** karsilanmiyor — panel yalniz "Assigned/Unassigned" metni gosteriyor, ajan adi bile yok.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- `apps/web/src/features/inbox/DetailsPanel.tsx:98-115` — `Row label={t("inbox.details.row.assignee")}`
  icinde yalniz `assignee_id ? "assigned" : "unassigned"` metni + (rol izin veriyorsa) bir **Takeover**
  butonu. Atama/transfer kontrolu YOK.
- Ajan ADI yalniz `TakeoverModal` icinde cozuluyor (:317-341, `GET /agents` roster`indan) — panelde degil.
- Yani sunucu yolu ve roster HAZIR; eksik olan panelin kendisi (denetimin D2 deseni: "API`de var,
  konsolda yok").

## Yapilacak

1. Assignee satirinda **ad** gosterilir (roster `GET /agents`, `TakeoverModal`in kullandigi ayni
   `["team","agents"]` cache anahtari — ikinci bir cache ACMA, ikisi ayrisir).
2. Atama/transfer kontrolu: acilir liste + secim aninda PATCH (PRD "aninda kaydeder"). Hangi ucun
   kullanilacagi once dogrulanir — transfer/atama ucu `chats` rotalarinda zaten var (`useChatAction`
   ailesine bak); YENI UC ACMADAN once mevcut olani kullan.
3. Yetki: atayabilen ile yalniz gorebilen ayrilir. Kapi rol/scope`tan gelir, `canTakeover` deseninin
   ayni yeri. Gorebilen ama atayamayan kullaniciya salt-okuma metin gosterilir (bolum GIZLENMEZ —
   assignee bilgisi okuma yetkisinin parcasi).
4. Iyimser guncelleme + hata geri alma; catisma (baska ajan ayni anda aldi) sunucunun 409 cumlesiyle.
5. Arsivlenmis sohbette kontrol pasif (`chat.active === false`) — mevcut `canTakeover` gerekcesi
   (DetailsPanel.tsx:39 yorumu) aynen gecerli.

## Bilinen tuzaklar

- `DetailsPanel.tsx` en son tm 133.3 (i18n) ile degisti; her yeni metin `en`+`tr` katalogda olmali,
  i18n sentinel testi eksik anahtari yakalar.
- Roster sorgusu `enabled: assigneeId !== null` ile kisitliydi (modal icin); panelde HER ZAMAN gerekir —
  `staleTime` koru, her acilista yeniden cekme.
- PRD ayni satirda "sure/ziyaret canli" da diyor; ziyaret bilgisi tm 27.x`te teslim edildi
  (`#### K02.4.1-.6` ilk maddesi). Sure sayaci canli degilse onu da bu turda kapat, degilse
  `◐` birakip eksigi maddeye yaz — `✅` UYDURMA.

### 189.7. F0-INBOX-g [SONNET-XHIGH] Copy chat link + Reopen: UI yolunun testi (FR-MOD-02.6)

**Status:** done  
**Dependencies:** None  

Uc aksiyon da mevcut ve reopen sunucu tarafinda dogru (yeni thread + `chat_resumed` sistem olayi, teklik kurali korunuyor). Boslugun tamami TEST: Copy chat link icin ne birim ne e2e testi var; Reopen`in UI yolu icin de test yok.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- Denetim: "(1) Copy chat link icin hicbir test yok — ne birim ne e2e; (2) Reopen`in UI yolu icin de
  test yok". Sunucu tarafi `chat-service.ts:849-877` (reopen -> yeni thread + `chat_resumed`) DOGRU
  ve testli.
- PRD KK: "Ticket uretir; kalici link kopyalar; arsiv reopen -> yeni thread + `Reopened` olayi".

## Neden bu bir is kalemi (kod degil test)

CONVENTIONS §7`nin tam konusu: bir kabul kriterini KORUYAN test yoksa, kriterin bugun calisiyor
olmasi yarin da calisacagi anlamina gelmez. `#### K02.6` blogundaki ✅ iddiasi bu yuzden kanitsizdi.
Bu alt-gorev **once testleri yazar, sonra kirmizi cikan varsa duzeltir** — testi gecirmek icin
kriteri gevsetme.

## Yapilacak

1. **Copy chat link** birim testi: kontrol tiklaninca panoya yazilan deger, sohbetin KALICI linki
   (rota + chat id). jsdom`da `navigator.clipboard` mock`lanir; mevcut bir clipboard deseni varsa
   (`grep -rn "clipboard" apps/web/src`) ona uy, yenisini icat etme.
2. **Copy chat link** e2e: kopyalanan link YENI bir sayfada acilinca AYNI sohbet aciliyor. "Kalici
   link" iddiasinin tek gercek kaniti budur; panoya bir sey yazildigini gormek yetmez.
   (Playwright`ta pano izni gerekir: `context.grantPermissions(["clipboard-read","clipboard-write"])`,
   Chromium.)
3. **Reopen UI** birim + e2e: arsivlenmis sohbette Reopen tiklanir -> transcript`te "Reopened" sistem
   olayi gorunur, composer yeniden yazilabilir hale gelir.
4. Uc testin basligi da `(FR-MOD-02.6)` etiketi tasir.

## Bilinen tuzaklar

- e2e sabit portlarda ve TOHUMLU `siyahtus` veritabanina karsi kosar; iki pencere ayni anda e2e kosamaz.
  Bayat bir dev sunucu (5173) tum suiti kirmizi yapar — kosmadan once kontrol et.
- Bir e2e turu ~55-84 `apps/e2e/kanit/*.png` yeniden yazar; bu beklenen churn, GERI AL.
- Reopen testi arsivlenmis bir sohbet ister; tohumda varsa onu kullan, yoksa testin kendisi
  arsivleyip yeniden acsin (tohuma yeni satir EKLEME — paylasilan veritabani).

### 189.8. F0-INBOX-h [SONNET-XHIGH] Arsivlenmis sohbette Copilot ozeti (FR-MOD-02.8)

**Status:** done  
**Dependencies:** None  

Salt-okuma dogru ve Reopen/Create ticket erisilebilir. Ama PRD`nin arsiv icin acikca istedigi "Copilot ozeti" alinamiyor: buton `chatActive === false` iken disabled.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- `apps/web/src/features/inbox/CopilotPanel.tsx:131` — ozet butonu `disabled={!chatActive || summary.isPending}`.
  Ayni dosyada `:119` arsivlenmis sohbette bir "disabled" notu basiyor.
- PRD `FR-MOD-02.8` aciklamasi: "Archive (chat history/archives) — **salt-okuma transcript + Copilot
  ozeti**; Reopen/Create ticket". KK: "Kapanan sohbetler; salt-okuma; reopen/ticket aksiyonlari;
  denetim kaydi".
- Mantiken de ters: bir sohbetin ozetini istemek icin en iyi an, sohbet BITTIKTEN sonradir.

## Yapilacak

1. Ozet butonunun kapisini `chatActive`ten ayir. Hangi Copilot aksiyonlarinin arsivde anlamli oldugunu
   TEK TEK karar ver ve gerekceyi kodun yanina yaz:
   - **Ozet (summary):** arsivde ANLAMLI -> acilir.
   - **Yanit onerisi (reply) / draft gelistirme (enhance):** arsivde anlamsiz (gonderilecek mesaj yok)
     -> kapali KALIR. Bu ayrimi yapmadan tek bayragi kaldirmak, sonucu kesin hayal kirikligi olan
     butonlar acar.
2. Sunucu tarafini DOGRULA: ozet ucu arsivlenmis (aktif olmayan) bir sohbet icin calisiyor mu?
   Calismiyorsa uc de acilir — ama once `grep`le bak, uc zaten calisiyor olabilir (D2 deseni).
3. `FR-MOD-02.5` ("Copilot ozeti — internal note") `Should (v1)` ve ZATEN kapali; arsivde ozet
   alindiginda internal note olarak eklenebiliyorsa o yol bozulmamali (arsiv salt-okuma!) — internal
   note yazmak bir YAZMA islemidir, arsivde reddedilmesi dogru olabilir. Karari ver ve yaz.
4. `#### K02.8` maddesine "denetim kaydi" (KK`nin dorduncu maddesi) durumunu da yaz: arsivleme
   audit`e giriyor mu? Girmiyorsa `◐` birak ve eksigi yaz — `✅` UYDURMA.

## Bilinen tuzaklar

- `chatActive` bayragi `CopilotPanel.tsx:79-84`te prop olarak geliyor; kaldirmak yerine anlamini
  daraltmak (`canDraft` gibi) daha guvenli — cagiran taraf da guncellenir.
- LLM saglayicisi MOCK (deterministik stub, MASTER-PROMPT); ozet testi sabit ciktiya assert eder.
