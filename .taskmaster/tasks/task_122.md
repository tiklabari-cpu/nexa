# Task ID: 122

**Title:** PRD §5.5 — §2 Modül→Faz Matrisi bayat ⬜/◐ damgaları KAPALI fazlarla çelişiyor (4 satır, ölçüldü)

**Status:** done

**Dependencies:** None

**Priority:** critical

**Description:** §1'in kapı tablosu üç fazı da "0 ◐ · 0 ⬜" ile KAPALI ilan ederken, dört satır aşağıdaki §2 matrisi hâlâ ◐/⬜ taşıyor. §F.00 "◐ kaldıramaz" der — §2'yi önce okuyan bir denetim penceresi kapalı fazları yeniden açık sanar. Damgaları koda hizala.

**Details:**

PRD/PLAN kimliği: **PRD §5.5** — PLAN §2 "Modül → Faz Matrisi (PRD §5.5)" tablosu (PLAN.md:120-144).

(a) GEREKÇE + KANIT (bu turda hem §5 satırlarına hem KODA karşı ölçüldü):
§1'in faz kapısı tablosu (PLAN.md:20-22) üç fazı da **"0 ◐ · 0 ⬜"** ile KAPALI ilan ediyor
(Faz-0 GL-3/tm 87 · v1 GL-4/tm 88 · v2 GL-8/tm 114 · §D89). Dört satır aşağıda §2'nin matrisi
hâlâ ◐/⬜ taşıyor. §F.00 "**◐ kaldıramaz**" diyor — yani §2'yi önce okuyan bir denetim penceresi
KAPALI fazları yeniden açık sanar ve tur yakar. Bu, panelin "satır kendi kendisiyle çelişiyor"
sınıfının aynısı (§D91/§D92/§D93 + tm 121 bunu DÖRT kez yaktı), ama bu kez §5'te değil §2'de.

KÖK NEDEN — yazılı ve tarihli: §D19 (PLAN.md:3339, 2026-07-25) 02.4'ü kapatırken aynen şunu yazmış:
"→ §3.2'de 02.4.1–.6 `◐`→`✅`; D19 çözüldü. (**Bu satır dışına dokunulmadı; §2/§8'deki D19/T3
referansları kendi denetim turlarında güncellenir.**)" — o "kendi denetim turu" HİÇ GELMEDİ.
GL-3, GL-4 ve GL-8'in §F.1/8 (doküman tazeliği) maddesi üçü de §2'yi kaçırdı (~17 gün).

ÖLÇÜLEN DÖRT SATIR (her biri §5 satırı + kanıt bloğu + KOD ile karşılaştırıldı):

1. **PLAN.md:125** `MOD-02 Inbox 3-pane + Archive` → `◐ chat+ticket+Copy link ✅ ·
   **02.4 ziyaret bilgisi ⬜ (§D19)**`. **KANITLA YANLIŞ:** PLAN.md:186 `02.4.1–.6 … ✅ → K02.4.1-.6`,
   kanıt bloğu PLAN.md:3775. Kod: `DetailsPanel.tsx` "Visited pages"+"Visit info" bölümlerini ve boş
   durumlarını render ediyor; `chat-service.ts` `get`→`#latestVisitor`; test `DetailsPanel.test.tsx`
   + integration `chats.test.ts` "visitor context". TÜM 02.x satırları ✅ (MVP 178-188 · v1 530-535).
   Kalan tek açık: `02.2.3 "Take tour" banner` = `Could` + `🔒` (PLAN.md:190).

2. **PLAN.md:129** `Engage/Goals + Sales tracker` → `⬜`. Legend (PLAN.md:87): `⬜` = "Açık — **kod yok**".
   **KANITLA YANLIŞ:** 13.2 `✅ → K13.2` (1127) · 13.3 `✅ → K13.3` (1128) · 13.5 `✅ → K13.5` (1131);
   kanıt blokları 4076 / 4103 / 4139. Kod: `apps/web/src/features/goals/` (GoalBuilder · GoalsFunnel ·
   GoalsPage + testleri) · `apps/api/src/services/goals/goal-service.ts` ·
   `apps/api/src/services/sales/attribution.ts` + `attribution.test.ts`.

3. **PLAN.md:140** `MOD-09 Apps marketplace` → `⬜`. **KANITLA YANLIŞ:** 09.1 `✅ → K09.1` (553) ·
   09.2 `✅ → K09.2` (554) · 09.2-v2 `✅ → K09.2-b` (1122) · 09.3 `✅ → K09.3` (1123) ·
   09.4 `✅ → K09.4` (1124). Kod: `apps/web/src/features/apps/AppsMarketplace.tsx` + `app-grid.ts`
   + testleri (tm 121 ölçümü: types 17/17 · web 32/32 · integration 12/12).

4. **PLAN.md:124** `MOD-01 Global shell + ⌘K` → `◐ ⌘K+rozet ✅, Copilot v1`. **GEREKÇE BAYAT ama
   DAMGA TARTIŞMALI — KENDİN ÖLÇ, körlemesine çevirme.** Hücrenin verdiği sebep ("Copilot v1")
   ARTIK GEÇERSİZ: Copilot v1'de teslim edildi (MOD-12 satırı `✅ ayrı KB + panel + özet/yanıt/enhance`;
   kod `apps/api/src/routes/copilot.ts` + `services/ai/copilot-service.ts`), v1 kapısı 2026-07-31'de
   kapandı. 01.1.3 / 01.1.6 / 01.2 / 01.3 hepsi `✅` (168-171), v2 payı `✅ → K01.1.3` (1125).
   AMA PLAN.md:172 `01.1.1/.4/.5, 01.4, 01.5` (Hamburger · presence avatarları · Invite +N · banner ·
   unpin) = `Should/Could` + `🔒 v1+` HÂLÂ AÇIK. Karar senin: ya `◐`ın gerekçesini DOĞRU olanla
   değiştir (🔒 Should/Could artığı), ya MOD-02 emsalindeki gibi ✅ + not yap. Hangisini seçersen
   ÖLÇÜMÜNÜ hücreye/kanıta yaz.

(b) DOKUNULACAK DOSYA: yalnız `PLAN.md` (§2 tablosu, satır 124-144) + `HANDOFF.md`.
    `## K.` kanıt bloklarına DOKUNMA — onlar zaten DOĞRU; bu görev §2'yi onlara hizalar.

(c) SIRA (contract-first geçerli değil — doküman-only iş): (1) dört satırın her birini §5 satırı +
    kanıt bloğu + KOD ile tek tek doğrula (ÜÇÜ DE uyuşmalı), (2) damgayı düzelt, (3) hücreye kısa
    gerekçe + `→ K…` referansı koy (CONVENTIONS §1.2: kanıt METNİ tabloda DEĞİL, `## K.` bloğunda),
    (4) §D95 aç ve kalıcı kuralı yaz: "bir damga kapandığında AYNI turda §2 matrisi de taranır —
    §D19'un 'kendi denetim turunda güncellenir' notu 17 gün ve üç GL turu boyunca gelmedi".

(d) BİLİNEN TUZAKLAR:
    - ⛔ **İKİ KONTROL SATIRI DOĞRU — DEĞİŞTİRME:** PLAN.md:144 `Mobil app ⬜` (13.7 `⬜ → K13.7`,
      satır 563; tm 90 Faz-3 `deferred`) ve PLAN.md:133 `Görsel Workflow builder ⛔ ADR-14`
      (13.4 `⛔`, satır 1129). İkisi de HAK EDİLMİŞ. Toplu "hepsini ✅ yap" süpürmesi bunları bozar
      ve §F.1/2'nin yasakladığı **faz sızıntısı**nı yaratır.
    - §1'in kapı tablosu (20-22) DEĞİŞMEZ — oradaki sayılar GL turlarının ölçümüdür, bu görev
      yeniden saymıyor.
    - §G dilim tablosundaki `◐→✅` ifadeleri (PLAN.md:2265-2267) damga DEĞİL, geçmiş bir geçişin
      tarifidir. DOKUNMA.
    - tm 121'in dersi: damgayı KODA karşı doğrulamadan çevirme — metni değil, gerçeği düzelt.

(e) KAPSAM SINIRI: ürün kodu · testler · migration · sözleşme · `## K.` kanıt blokları · §1 kapı
    tablosu · Faz-3 görev statüleri (tm 79/81/82/83/84/90) · tm 1-26 (K1) DEĞİŞMEZ. Bu görev
    `PLAN.md` §2 + `HANDOFF.md` dışına ÇIKMAZ.

**Test Strategy:**

Bu görev **doküman-only**; build kapıları koşulmaz (§D80/§D81/§D82/§D87 emsali).
`git diff --name-only` YALNIZ `PLAN.md` + `HANDOFF.md` + Task Master durum dosyasını göstermeli;
başka dosya çıkarsa kapsam aşılmıştır.

ÖLÇÜLEBİLİR KABUL — hepsi komutla doğrulanır:
(1) §2 matrisinde (PLAN.md:120-144) `⬜` sayısı **3 → 1**; kalan TEK `⬜` satır 144 `Mobil app` olmalı.
(2) §2 matrisinde `◐` sayısı **2 → 0** (MOD-01 için `◐` bilinçli korunduysa **2 → 1** VE hücrede
    DOĞRU gerekçe + ölçüm yazılı olmalı — "Copilot v1" ibaresi her hâlükârda gitmeli).
(3) `grep -n '02.4 ziyaret bilgisi' PLAN.md` → **0 isabet** (bugün 1).
(4) `grep -n 'Copilot v1' PLAN.md` §2 satırında **0 isabet**.
(5) KONTROL SATIRLARI DEĞİŞMEDİ: satır 144 hâlâ `⬜`, satır 133 hâlâ `⛔` taşıyor.
(6) §1 kapı tablosunun üç satırı (20-22) **bayt bayt aynı** (`git diff` o satırlarda hiçbir şey göstermemeli).
(7) §D95 açılmış ve kalıcı kural yazılmış.
(8) `pnpm -w format:check` exit 0.
