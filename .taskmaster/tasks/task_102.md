# Task ID: 102

**Title:** Faz-2 özet sayaçlarını tabloyla eşitle — 1 kalemlik gerçek bayatlık (07.7 ◐→✅ sonrası güncellenmedi) (DOKÜMAN-ONLY)

**Status:** done

**Dependencies:** 101 ✓

**Priority:** high

**Description:** PLAN.md satır 22 (üst-tablo Faz 2 satırı) ve §5.0 girişi (satır ~1100) hâlâ `12 ⬜ · 1 ◐ · 14 ✅ · 3 ⛔` diyor; §5.0 tablosu reflow sonrası (tm 101) `12 ⬜ · 0 ◐ · 15 ✅ · 3 ⛔` sayıyor. Tek satırlık düzeltme: iki özette `1 ◐ kısmi · 14 ✅ teslim` → `0 ◐ kısmi · 15 ✅ teslim`.

**Details:**

KÖKEN: tm 101 (§5.0 reflow) penceresinde kanıtlanan yan bulgu — bkz. PLAN.md §D77.

KANIT (git, son 12 PLAN.md revizyonunda mantıksal satır-birleştirmeli sayım):
- `5d2c096` (WORKSCHED-j) `§5.3-Vardiya ◐→✅` çevirirken satır 22 + satır 1100 sayaçlarını AYNI commit'te güncelledi (12/1/14/3) → bayatlık oluşmadı, doğru davranış.
- `6230b4f` (07.7-l · tm 93.12) `07.7 ◐→✅` çevirdi ama iki özet sayacına da DOKUNMADI → tek kalemlik gerçek bayatlık buradan geliyor.

Bu, §D68–§D76'daki YANLIŞ POZİTİF serisinden farklıdır: orada özet doğruydu ve panelin parser'ı bozuktu (tm 101 ile kapatıldı). Burada parser artık 30 satırın hepsini okuyor ve özet gerçekten geride — yani panel bir sonraki taramada §1.2 çelişkisini DOĞRU olarak bildirecek.

YAPILACAK (tek tur, doküman-only):
1. PLAN.md satır 22 (üst-tablo `**Faz 2 — v2**` satırı) içindeki `**12 ⬜ açık · 1 ◐ kısmi · 14 ✅ teslim · 3 ⛔ kapsam dışı**` → `**12 ⬜ açık · 0 ◐ kısmi · 15 ✅ teslim · 3 ⛔ kapsam dışı**`.
2. PLAN.md §5.0 girişindeki (satır ~1100) aynı ifadeyi aynı şekilde güncelle.
3. Değiştirmeden ÖNCE tabloyu yeniden say (aşağıdaki script) — aradan geçen pencereler damga çevirmiş olabilir; sayaçları körlemesine 0/15 yazma, SAYIMDAN yaz.
4. §D'ye tek satırlık D78 kaydı: hangi commit'in bayattığı, yeni sayım, kaynağın kapandığı.

KAPSAM DIŞI: damga çevirmek · §5.0 tablosunu yeniden düzenlemek (tm 101'de yapıldı, 30 temiz satır) · `23 açık kalem` kapanış-paydası · siyahtus-panel deposu.

DoD: Doküman-only; kod/kontrat/şema dosyasına dokunulmaz. `git status` kapanışta temiz (run-loop.sh sahibinin, dokunma).

**Test Strategy:**

1. Sayım (script, exit 0): §5.0 tablosu başlıktan §5.1'e kadar okunur, `^\| ` ile başlayan her satır bir kalem (tm 101 reflow'undan sonra 30 mantıksal = 30 fiziksel satır), damga = 6. alanın öncü damga karakteri → dağılım hesaplanır ve toplam 30 çıkar.
2. Eşitlik: satır 22 ve §5.0 girişindeki özet metinleri (1)'in çıktısıyla BİREBİR aynı olmalı — grep ile iki satır da doğrulanır.
3. Sızıntı kontrolü: `git diff` yalnız PLAN.md (+ HANDOFF.md); diff'te damga ekleyen/silen gereksinim satırı YOK — yalnız iki özet satırı + D78 kaydı değişmiş olmalı.
4. Regresyon: tm 101'in invariantı korunuyor — §5.0 blokta `^\| ` ile başlamayan satır sayısı 0.
