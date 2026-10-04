# Task ID: 114

**Title:** GL-8 — V2-KAPAT — Faz-2 §F.00 kapanış turu (§F.1 tam 10 madde) [MAX]

**Status:** done

**Dependencies:** None

**Priority:** critical

**Description:** Faz-2 (v2) kalem envanteri sayıca kapandı (0 ⬜ · 0 ◐ · 27 ✅ · 3 ⛔) ama üst-tablonun Kapanış hücresi hâlâ "⬜ AÇIK": §F.00 kapanış turu (§F.1'in 10 maddesi tam sürüm) hiç koşulmadı. Faz kendiliğinden kapanmaz — kapanış bir turdur. GL-3 (tm 87, Faz-0) ve GL-4 (tm 88, v1) turlarının v2 karşılığı.

**Details:**

§F.00 · §F.1 · §F.2 · PLAN satır 22 (üst tablo) · §5.0 (satır 1098-1137) · §5.3.2 dilim 9 kapısı · GL-3/GL-4 emsali (§D55/§D56).

═══ (a) BU GÖREVİ DOĞURAN GEREKÇE + KANIT ═══
GRAF-ONARIM penceresi (2026-08-11), panelin "run-loop seçilebilir görev bulamıyor, otonom döngü
duracak" bulgusundan doğdu. Teşhis kanıtla yapıldı: 113 görevin 107'si `done`, 6'sı `deferred`,
**0 `pending`** → seçilebilir küme boş. Graf SAĞLAM: `validate_dependencies` temiz · döngü YOK ·
var olmayan id'ye bağımlılık YOK · açık göreve bağımlılık YOK (tek bağımlılık tm 79 → tm 35, o da
`done`). Yani kilit bağımlılıkta değil, **statülerde**: açık 6 görevin (tm 79/81/82/83/84/90)
hepsi Faz-3 (Enterprise) ve §D64'ün 2026-08-01 kullanıcı kararıyla BİLEREK `deferred` — "Faz-3
kalemleri deferred kalır, onlar gerçekten sonraki fazdır". O engel HÂLÂ GEÇERLİ; onları
`pending`'e çekmek §F.1/2'nin yasakladığı **faz sızıntısı** olurdu. Açık faz Faz-2'dir.
Faz-2'de kalan tek gerçek iş = bu kapanış turu. Kanıt zinciri:
  · PLAN satır 22: v2 envanteri "0 ⬜ · 0 ◐ · 27 ✅ · 3 ⛔ ... Kapanış | ⬜ AÇIK" +
    "faz kapanışı Faz-0'ın §F.00 provası gibi ayrı bir denetim turu ister, o tur henüz koşulmadı".
  · PLAN §5.3.2 dilim 9 kapısı: "İkisi de ✅ → **Faz-2 §F.00 kapanır**" (dilim 9 kalemleri ✅).
  · HANDOFF tm 99.8 notu: "Faz-2 satırının Kapanış hücresi bilerek ⬜ AÇIK bırakıldı — Faz-0'daki
    §F.00 provasının v2 karşılığı (kapsam süpürmesi + NFR ölçümü + sessiz borç taraması) henüz
    koşulmadı, o ayrı bir kapanış turu."
  · Task Master'da V2-KAPAT görevi YOKTU (GL-3=tm 87, GL-4=tm 88 var; GL-5/6/7 kullanılmış →
    bu tur GL-8). Yani boşluk gerçek bir plan boşluğuydu, statü hatası değil.

ÖNCELİK NOTU (iz): `critical` — bu görev panelin sağlık taramasının bulgusundan doğan düzeltme
akışında açıldı (CONVENTIONS §4.1'in `critical` için ayırdığı TEK yol). Toplu backlog/§G aktarımı
DEĞİLDİR: tek görev, döngünün kilidini açan işin ta kendisi. Görev bitince priority DEĞİŞTİRİLMEZ.

═══ (b) DOKUNULACAK DOSYALAR ═══
· `PLAN.md` — satır 22 (üst tablo Faz-2 satırı: `Kapanış` hücresi `⬜ AÇIK` → `✅ KAPALI`) ·
  §F.00'a **Faz-2 kapı satırı** eklenir (Faz-0/v1 kapı satırlarının hemen ardına, aynı biçimde) ·
  §5.0 sayaçları (satır 1100 + satır 22) tabloya karşı YENİDEN SAYILIR · §D'ye yeni sapma kaydı
  (bir sonraki boş D numarası) · §E/§K güncellenir (tazelik maddesi).
· `HANDOFF.md` — §F.2 raporu (madde madde kanıt) + CONVENTIONS §3 bloğu, newest-first en üste.
· `README.md` — yalnız §F.1/8 tazelik maddesi bir uyuşmazlık bulursa.
· **KOD DOSYASI YOK** (aşağıya bak).

═══ (c) SIRA (contract-first değil — bu bir DENETİM turu) ═══
1. **Kalem sayımı (§F.00 kapısı).** DİKKAT: v2'de `Must` YOKTUR (PRD'de v2 kalemlerinin hepsi
   `Should`/`Could`) → §F.00'ın **sayaç** kuralı yerine **kalem** kuralı geçerli:
   "23 açık kalemin hepsi ✅". §5.0 tablosunun (satır ~1108-1137, 30 mantıksal satır) her
   satırının **ÖNCÜ** durum damgası sayılır, beklenen `0 ⬜ · 0 ◐ · 27 ✅ · 3 ⛔ = 30`.
2. **§F.1'in 10 maddesi TAM SÜRÜM**, her biri **koda karşı** (PLAN'ın iddiasına karşı değil):
   (1) kapsam süpürmesi — v2 payındaki FR-MOD satırları kodda aranır, `◐` kalan olmamalı;
   (2) faz sızıntısı — Faz-3'ten öne çekilmiş iş var mı (tm 79/81/82/83/84/90 kodda karşılığı
       olmamalı; belgeli öne-çekmeler §D52/§D61 istisnadır);
   (3) NFR kapıları v2 payı **ÖLÇÜLÜR, tahmin edilmez** (en az: NFR-P4 windowing —
       `VirtualList` + `AppsMarketplace` DOM kart sayısı, tm 99.8 zaten `catalogue 102 · DOM 36`
       basıyor; cross-tenant/IDOR negatifleri; a11y);
   (4) şema artıkları — §8 tablosundaki her tablonun tüketicisi var mı (`goals` v2'de doldu mu,
       `workflows` ⛔ ADR-14 gerekçeli kalır);
   (5) `contract-parity` testi (beklenen 5/5);
   (6) sessiz borç grep'i — TODO/FIXME/XXX/HACK/@ts-ignore/@ts-expect-error/eslint-disable +
       skip(/only( , `apps/**/src` + `packages/**/src`;
   (7) ölü kod & erişilemez ekran — `App.tsx` route'ları vs. v2 feature sayfaları;
   (8) doküman tazeliği — PLAN/HANDOFF/README'deki test sayıları, sayaçlar, "sıradaki adım";
   (9) temiz kurulum provası — datastore healthy → migrate → seed → demo-flow e2e;
   (10) kapsam dışı doğrulaması (§9'un 10 maddesi — Stripe SDK yok, telif görsel yok, voice/IVR ⛔).
3. **`Should` borcu ismen listelenir.** §F.00 kuralı: `Should` kalemleri kapanışı bloklamaz ama
   raporda **ismen** yazılır ve ya sonraki faza taşınır ya §D'ye "kabul edilen borç" yazılır —
   sessizce düşemez. Bu turda taşınacaklar zaten belli: **tm 79 (Telegram) · 81 (SAML/SCIM) ·
   82 (HIPAA) · 83 (SOC2/ISO) · 84 (white-label/SLA) · 90 (mobil)** → hepsi Faz-3, `deferred`.
4. Üst tablo `⬜ AÇIK` → `✅ KAPALI` + §F.00'a Faz-2 kapı satırı.
5. §F.2 raporu → HANDOFF (kanıt madde madde) + §D kaydı.

═══ (d) BİLİNEN TUZAKLAR ═══
· **e2e çıplak kabukta KOŞMAZ:** `apps/rtm` kök `.env`'i kendi okumaz → Playwright 60 sn webServer
  timeout (`DATABASE_URL/REDIS_URL/JWT_SIGNING_KEY/CUSTOMER_TOKEN_SECRET: Required`). Doğrusu:
  `set -a; . ./.env; set +a; pnpm -w test:e2e` (veya `make test-e2e`). Kod kusuru DEĞİL.
· **integration serial koşar** (`--concurrency=1`) — paylaşılan PG yarışı.
· **`apps/e2e/kanit/*.png` her e2e koşusunda yeniden üretilir**; başka task'lara ait olanlar
  commit'e ALINMAZ (tm 99.1-99.8 emsali, kapsam disiplini). Pencere açılırken zaten kirliydiler.
· **PLAN sayacı naif glif sayımıyla sayılmaz** — §D68/§D69/§D70/§D71/§D75/§D76/§D77 bu yanlış-
  pozitifin beş turluk tarihçesidir. YALNIZ satır başındaki **öncü** damga sayılır; §5.2 kırılım,
  §5.3.2 dilim ve §G düz tablo satırları HEDEF DEĞİLDİR.
· **"verify+close, don't rebuild"** — GL-3/GL-4'te kod DEĞİŞMEDİ; bayat damga bulunursa teslim
  edilmiş koda karşı kanıtla `◐`→`✅` çevrilir, yeniden yazılmaz.
· **Kanıtsız "geçti" YOK** (§F.2 uyarısı): her §F.1 maddesinin kanıtı komut çıktısı / test adı /
  ölçüm değeri olarak HANDOFF'a yazılır.

═══ (e) KAPSAM SINIRI — NEYE DOKUNULMAYACAK ═══
· **ÜRÜN KODU YAZILMAZ.** Bu saf denetim + doküman senkronu turudur. Denetim bir açık bulursa:
  ya küçüktür (bu turda kapatılır) ya da **yeni tm görevi** olarak açılır (K7 önceliğiyle:
  v2/v3 = `low`; `critical` KULLANILMAZ) — üçüncü seçenek yok (§F.0 kuralı).
· **Faz-3 görevleri (tm 79/81/82/83/84/90) `deferred` KALIR** — §D64 kararı geçerli; statüleri
  DEĞİŞTİRİLMEZ. Raporda yalnız ismen listelenir.
· §D68-§D77 ve önceki §D kayıtları **append-only tarihçedir**, düzenlenmez.
· tm 1-26 dokunulmaz (K1). Faz-3 planı açılmaz — bu tur yalnız Faz-2'yi kapatır.
· Kanıt metni gereksinim satırına yazılmaz; damga + `→ K##` referansı satırda, kanıt bloğu
  §K'da (CONVENTIONS §1.2).

**Test Strategy:**

İKİ KAPI, ikisi de exit 0 olmadan `done` YOK.

(1) TAM DoD KAPISI (CONVENTIONS DoD · GL-3/GL-4 emsali — hepsi exit 0, sayılarla HANDOFF'a):
    `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w test` · `pnpm -w test:integration`
    (serial, `contract-parity` 5/5 dahil) · `pnpm -w build` ·
    `set -a; . ./.env; set +a; pnpm -w test:e2e` (demo-flow dahil).
    Referans taban (tm 99.8 turunda ölçüldü, bu tur ≥ olmalı): typecheck 11/11 · lint 8/8 ·
    unit `@siyahtus/api` 2414 + `@siyahtus/web` 957 + `@siyahtus/widget` 69 + `@siyahtus/types` 96 ·
    integration 1855/1855 · build 7/7 · **e2e 103/103**.

(2) §F.1/9 TEMİZ KURULUM PROVASI: datastore healthy → migrate → seed → `db:check-drift`
    ("no drift") → demo-flow e2e yeşil.

KABUL KRİTERİ (ölçülebilir): (i) §5.0 kalem sayımı `0 ⬜ · 0 ◐ · 27 ✅ · 3 ⛔ = 30` **sayılarak**
doğrulandı (elle yazılmadı); (ii) §F.1'in 10 maddesinin HER BİRİ için HANDOFF §F.2'de kanıt satırı
var (komut çıktısı / test adı / ölçüm); (iii) PLAN satır 22 `Kapanış` hücresi `✅ KAPALI` ve §F.00'da
Faz-2 kapı satırı mevcut; (iv) taşınan `Should`/Faz-3 kalemleri (tm 79/81/82/83/84/90) raporda
ismen listelendi; (v) commit + push yapıldı ve Task Master `done`.
