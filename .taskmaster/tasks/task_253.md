# Task ID: 253

**Title:** GL-17 [OPUS-MAX] V1-KAPAT3: Faz-1 (v1) SF.00 ucuncu kapanis turu, tm 252 sonrasi (Must 20/20)

**Status:** done

**Dependencies:** 252 ✓

**Priority:** high

**Description:** GL-16 v1 Must satiri 06.3.3'u olculmus bir retrieval kusuru yuzunden kismi damgaya cekti ve v1 kapisini yeniden acti. tm 252 duzeltip satiri tamam'a dondurunce bu tur SF.1'i tam surum kosar ve kapiyi resmi olarak yeniden kapatir (GL-15 emsali).

**Details:**

PENCERE PROTOKOLU: TASK-RUNNER-PROMPT.md (bootstrap -> build -> dogrulama -> kapanis). DoD kapisi CONVENTIONS.md S1 (S1.3 parcali kosu); git S2; handoff S3; sinirlar CLAUDE.md. DIKKAT: PLAN.md ~2,6 MB -- BASTAN SONA OKUMA, hedef satiri grep -n ile bul, cevresindeki ~30 satiri oku. Kanit tablo hucresinde DEGIL, "## K. Kanit Gecmisi" altindaki #### K bloklarindadir (CONVENTIONS S1.2) ve gecerli olan blogun SON maddesidir; ortadaki kismi glifleri tarihcedir.

NEDEN VAR (GL-16 / tm 232, 2026-09-13; PLAN SD169 + #### KGL-16 + SF.00'daki "v1 guncellemesi" paragrafi): GL-16 Faz-8'i kapatirken e2e'nin tek kirmizisini (apps/e2e/tests/persona-answer.spec.ts:30) olctu ve kok neden bir URUN kusuru cikti: bilgi tabani retrieval'i IVFFlat yolunda hazir bir kaynagi kaciriyor, musteri cevap yerine insan kuyruguna dusuyor. Kusur v1 Must satiri FR-MOD-06.3.3'un kabul kriterini ("kaynak retrieval'da kullanilir") dusurdugu icin GL-16 o satiri kismi damgaya cekti: v1 Must sayaci 19 tamam / 1 kismi / 0 acik, ust tablonun Faz 1 satiri (satir 21) Kapanis hucresi "ACIK (yeniden)". Duzeltme tm 252'nin isidir. Bu gorev v1 kapisini RESMI bir kapanis turuyla yeniden kapatir. Emsal: tm 204.2 son kismi v2 satirini kapatti ama kapiyi kapatmadi; kapiyi ayri tur GL-15 / tm 210 kapatti (PLAN SF.00 v2 ikinci kapi paragrafi).

ON KOSUL: tm 252 done VE PLAN.md'de 06.3.3 satirinin durum hucresi tamam damgali VE #### K06.3.3 blogunda tm 252'nin kanit maddesi var. Uc kosuldan biri yoksa bu gorev BLOCKED kapanir; damga uydurulmaz.

YAPILACAK IS:
(a) v1 Must sayacini SAY -- naif glif sayimi degil. Komut PLAN.md SF.00'in "v1 (Faz 1) kapisi -- IKINCI KAPANIS" paragrafinda birebir yazili (GL-14; bolum basligina capali awk, "### 4.1" ile "### 4.4" arasi, 4. sutunda "Must (v1)", 5. sutunda kismi/acik glifi). grep -n "awk '/^### 4" PLAN.md ile bul ve kopyala. Beklenen cikti "20 0 0". Ayni paragraftaki SAYIM TUZAGI notunu oku (08.8.4'un kalin PRD hucresi).
(b) SF.1'in 10 maddesi TAM SURUM, her biri exit code ile (emsal bicim: #### KGL-16): 1 pnpm audit:sweep; 2 faz sizintisi; 3 NFR olcumleri (P3 widget bundle nobetcinin kendi tanimiyla .js+.css, P5 audit:unpaged-lists, A11Y e2e axe blocking; P1/P2/P8 yeniden kosulmaz, sahibi ve tarihi yazilir -- SD143/3); 4 pnpm audit:schema-consumers; 5 contract-parity (dosya apps/api/test/integration/contract-parity.test.ts, api integration shard'larinin birinde kosar) + contract:generate diff bos; 6 pnpm audit:silent-debt; 7 pnpm audit:dead-code + pnpm audit:endpoint-ui; 8 dokuman tazeligi; 9 temiz kurulum provasi; 10 kapsam disi dogrulamasi.
(c) Tam DoD (CONVENTIONS S1): typecheck, lint, build (turbo --force) + format:check + test S1.3 geregi parcali ve --force (api/web/e2e disi turbo test; apps/web --maxWorkers=4; api test:unit; api integration 3 shard; rtm test:integration) + contract:generate sonrasi generated diff bos + db:check-drift "no drift" + audit:req-coverage exit 0 + test:e2e tam suit (persona-answer.spec.ts:30 DAHIL yesil).
(d) PLAN: ust tablo satir 21 Kapanis hucresi "ACIK (yeniden)" -> "KAPALI (yeniden)" ancak (a) 20 0 0 ve (b)(c) yesilken; eski damgalar tarihceye (panel hucredeki ILK sayi+glif eslesmesini okur, eski rakami yaziyla yaz). SF.00'a v1 ucuncu kapi paragrafi, yeni #### KGL-17 blogu, SD kaydi. HANDOFF'a SF.2 raporu.

KAPSAM SINIRI: urun kodu / migration / test YAZILMAZ -- kapanis turu (SD143 kurali: git diff --name-only urun kaynagi SIFIR dosya). Faz-0, v2 ve Faz-8 kapilarina dokunulmaz. Yeni kalem acmak serbesttir ama yapilmaz.

BILINEN TUZAKLAR: (1) Temiz kurulum provasinda varsayilan siyahtus-demo projesinin volume'u 2026-09-07'den beri KALICI -- sifirdan prova icin benzersiz proje adi SART: docker compose -p <benzersiz-ad> -f docker-compose.full.yml up --build -d, sonra ./scripts/smoke.sh (17 kontrol), sonra AYNI -p ile down -v (yalniz o projenin volume'larini siler; siyahtus_* dev volume'lari etkilenmez -- once docker volume ls ile dogrula). make kurulu degil. (2) npm kayit defteri yavaslarsa compose build 12+ dk surer (GL-16'da 759 sn) -- arka plana al, ayni turda blocking bekle. (3) Kok .env source edilmeden e2e ve db komutlari DATABASE_URL hatasi verir: set -a; . ./.env; set +a. (4) Bayat bir Vite sunucusu (port 5173) e2e'yi topluca dusurur -- once portlari kontrol et. (5) Tam e2e ~160 kanit PNG'sini yeniden yazar -- turun kendi ekran goruntusu yoksa hepsini git checkout ile geri al. (6) Kosulari prizde yap (tm 251: pil bitince hazirda bekletme tam suiti 21 dk askiya aldi).

**Test Strategy:**

On kosul + iki kapi. ON KOSUL: tm 252 done, PLAN 06.3.3 tamam damgali ve K06.3.3de tm 252 kaniti var; yoksa BLOCKED. (1) SAYAC: GL-14un bolum basligina capali komutu (PLAN SF.00 v1 ikinci kapi paragrafi) "20 0 0" verir; naif glif sayimi gecersiz. (2) SF.1 TAM SURUM: 10 maddenin her biri exit code ile kanitlanir (KGL-16 bicimi); temiz kurulum provasi benzersiz bir compose proje adiyla bos volumelarda kosulur. Ayrica tam DoD kapisi (CONVENTIONS S1, S1.3 parcali, --force) exit 0 ve test:e2e tam suit yesil (persona-answer.spec.ts:30 dahil). Urun kaynagi diffi SIFIR dosya. Satir 21 ancak (1) ve (2) yesilken KAPALI (yeniden) olur; degilse gerekceli ACIK kalir.
