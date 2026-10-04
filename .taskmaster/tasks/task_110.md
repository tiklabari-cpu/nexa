# Task ID: 110

**Title:** PLAN §5 Faz-2 özet sayaçları bayat — satır 22 + satır 1100 tabloyla eşitlensin

**Status:** done

**Dependencies:** None

**Priority:** critical

**Description:** Panel sağlık taraması bulgusu: PLAN.md:22 Faz-2 özet satırı `7 ⬜ · 1 ◐ · 19 ✅ · 3 ⛔` diyor, §5.0 envanter tablosu (PLAN.md:1108–1137) sayıldığında `3 ⬜ · 1 ◐ · 23 ✅ · 3 ⛔` çıkıyor. §5.0'ın kendi sayaç satırı (PLAN.md:1100) da bayat: `6 ⬜ · 0 ◐ · 21 ✅ · 3 ⛔`. §F.00 faz kapanış kararı bu tabloya bakılarak verildiği için bayat özet, bitmemiş fazı bitmiş gösterebilir.

**Details:**

KÖKEN: Panel sağlık taraması bulgusu (Faz-2 özet sayacı çelişkisi) — bu yüzden `critical` (CONVENTIONS §4.1).

KAPSAM: YALNIZ iki özet sayaç satırı (22 + 1100) + §D kaydı + HANDOFF notu. Gereksinim satırlarının damgalarına DOKUNULMAZ — onlar kanıta dayalı (§1.2). Kod DEĞİŞMEZ.

TEŞHİS (git ile kanıtlandı, tahmin değil): satır 22 en son `6679c26` (05.6-tmpl31-a · tm 98.1) commit'inde yazıldı ve O AN DOĞRUYDU (`7 ⬜ · 1 ◐ · 19 ✅ · 3 ⛔`). O commit'ten bu yana §5.0 tablosuna satır EKLENMEDİ/SİLİNMEDİ — iki tarafta da 30 satır, aynı PRD kodları, aynı sıra. Yalnız 5 damga çevrildi ve hiçbir çeviren commit özeti güncellemedi:
- 05.6   ◐→✅  `60b967c` (05.6-tmpl31-e · tm 98.5)
- 08.5.7 ⬜→✅  `51e2643` (08.5.7-h · tm 65.8)
- 09.3   ⬜→✅  `9dfed5f` (09.3-h · tm 71.8)
- 09.4   ⬜→✅  `4ac9cb7` (09.4 kapanışı · tm 72.7)
- 13.2   ⬜→◐   `05229bd` (13.2-a · tm 73.1)
Aritmetik: 7⬜/1◐/19✅ üzerine bu 5 çevrim → 3⬜/1◐/23✅. Yani sebep = BAYAT ÖZET (güncellenmeden kalmış), damga hatası veya satır ekleme DEĞİL.

İKİNCİ SAYAÇ: §5.0'ın kendi sayaç satırı (1100) da aynı kusuru taşıyor — tm 65.8'e kadar güncel tutulmuş, sonraki 3 çevrimi (09.3 · 09.4 · 13.2) kaçırmış. §D78 (tm 102) birebir aynı sınıfta emsaldir ve orada da satır 22 + satır 1100 BİRLİKTE düzeltilmişti; §5.0 sayaç satırı gereksinim satırı değil türetilmiş sayımdır, bayat bırakılırsa bir sonraki taramada aynı bulgu geri gelir.

DOKUNULMAYACAK: `23 açık kalem` kapanış paydası (satır 22 col5 · satır 1102 · §5.2 başlığı · satır 2318) — o, PLANLAMA ANINDAKİ açık kalem kümesidir (30 − 3 ⛔ − 3 GL-teslim − 06.2.3), canlı sayaç değil.

BAĞIMLILIK: yok (boş) — düzeltme hemen çalışabilir, hiçbir işin bitmesini beklemiyor.

NOT (araç kusuru, kayda geçsin): MCP `add_task` `priority`'yi high/medium/low'a zorluyor, `critical` yazılamıyor; ayrıca yazma yolu 109 üst-görev `id`'sini string'den sayıya normalize edip 220 satırlık ilgisiz churn üretiyor. Bu görev bu yüzden tasks.json'a birebir mevcut kayıt şeklinde elle eklendi. `set_task_status` bu kusuru taşımıyor (cerrahi yazıyor).

**Test Strategy:**

1) Sayım körlemesine yazılmaz — awk script'i §5.0 başlığı → §5.1 arasındaki `^| ` satırlarını tarar, damgayı 6. alanın öncü karakterinden okur, 30 veri satırı + 0 geçersiz damga doğrular, exit 0. Beklenen: `satır=30 ✅=23 ◐=1 ⬜=3 ⛔=3 ??=0`.
2) Çapraz doğrulama: Task Master'da done olmayan v2 kalemleri = tm 73 (13.2 · in-progress) · 74 (13.3) · 75 (13.5) · 99 (09.2) → 1 ◐ + 3 ⬜ ile birebir örtüşür.
3) İki özet birbiriyle tutarlı: satır 22 ve satır 1100 aynı sayaç dizgesini taşır (`grep -c` = 2).
4) Damga regresyonu yok: `git diff`'te §5.0 bloğunun gereksinim satırlarında 0 değişiklik.
5) Kod değişmediği için DoD'un derleme kapıları (typecheck/lint/test/build/e2e) bu görevde KAPSAM DIŞIDIR — yalnız .md + tasks.json dokunuldu; kapı yerine yukarıdaki 4 doğrulama geçerlidir (§D78/§D83 emsali). `git status` temiz bırakılır.
