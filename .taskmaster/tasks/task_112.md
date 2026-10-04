# Task ID: 112

**Title:** PLAN §5 Faz-2 özet sayaçları yine bayat — satır 22 + satır 1100 tabloyla eşitlensin (§D84'ün tekrarı)

**Status:** done

**Dependencies:** None

**Priority:** critical

**Description:** Panel sağlık taraması bulgusu: PLAN.md:22 Faz-2 özet satırı `3 ⬜ · 1 ◐ · 23 ✅ · 3 ⛔` diyor, §5.0 envanter tablosu (PLAN.md:1108–1137) sayıldığında `2 ⬜ · 1 ◐ · 24 ✅ · 3 ⛔` çıkıyor (✅ 23→24, ⬜ 3→2). §5.0'ın kendi sayaç satırı (PLAN.md:1100) da aynı bayat değeri taşıyor. §F.00 faz kapanış kararı bu tabloya bakılarak verildiği için bayat özet, bitmemiş fazı bitmiş gösterebilir.

**Details:**

KÖKEN: Panel sağlık taraması bulgusu (Faz-2 özet sayacı çelişkisi) — bu yüzden `critical` (CONVENTIONS §4.1).

KAPSAM: YALNIZ iki özet sayaç satırı (22 + 1100) + §D kaydı + HANDOFF notu. Gereksinim satırlarının damgalarına DOKUNULMAZ — onlar kanıta dayalı (§1.2). Kod DEĞİŞMEZ.

TEŞHİS (git ile kanıtlandı, tahmin değil): satır 22 en son `7680328` (tm 110 · §D84) commit'inde yazıldı ve O AN DOĞRUYDU (`3 ⬜ · 1 ◐ · 23 ✅ · 3 ⛔`). O commit'ten bu yana §5.0 tablosuna satır EKLENMEDİ/SİLİNMEDİ — `git diff 7680328 HEAD -- PLAN.md` §5.0 bloğunda yalnız 2 değişen satır, 0 ekleme/silme; iki tarafta da 30 veri satırı, aynı PRD kodları, aynı sıra. Yalnız 2 damga çevrildi ve hiçbir çeviren commit özeti güncellemedi:
- 13.2 ◐→✅  `6c6c971` (13.2-l · tm 111)
- 13.3 ⬜→◐  `5f1d215` (13.3-a · tm 74.1)
Aritmetik: 3⬜/1◐/23✅ üzerine bu 2 çevrim → 2⬜/1◐/24✅. Yani sebep = BAYAT ÖZET, damga hatası veya satır ekleme DEĞİL.

NEDEN ◐ SAYACI DOĞRU GÖRÜNDÜ: iki çevrim `◐` ekseninde birbirini götürdü (13.2 çıktı, 13.3 girdi) — sayı 1'de sabit kaldı ama KİMLİĞİ değişti. Panelin yalnız ✅/⬜ uyuşmazlığı bildirmesi sayacın kısmen sağlam olduğu anlamına gelmiyor.

İKİNCİ SAYAÇ: §5.0'ın kendi sayaç satırı (1100) da aynı bayat değeri taşıyor. §D78 (tm 102) ve §D84 (tm 110) birebir aynı sınıfta emsaldir ve ikisinde de satır 22 + satır 1100 BİRLİKTE düzeltilmişti; §5.0 sayaç satırı gereksinim satırı değil türetilmiş sayımdır, bayat bırakılırsa bir sonraki taramada aynı bulgu geri gelir ve kuyruğu kendi kendine besler.

DOKUNULMAYACAK: `23 açık kalem` kapanış paydası (satır 22 col5 · satır 1102 · §5.2 başlığı · satır 2318) — o, PLANLAMA ANINDAKİ açık kalem kümesidir, canlı sayaç değil. `📋 PLANLANDI, kod SÜRÜYOR` anlatısı da aynen kalır.

TEKRAR SAYISI: bu §D78 → §D84 → bu tur = ÜÇÜNCÜ tekrar ve aralık kısalıyor (§D84 ile arasında yalnız 2 damga çevrimi var). §D84 kalıcı çözümü doğru teşhis etti (damgayı çeviren pencere sayacı AYNI commit'te günceller; emsal `5d2c096`/WORKSCHED-j) ama mekanizmaya bağlamadı. Kalıcı çözüm = CONVENTIONS §1'e DoD kutusu eklemek veya sayım script'ini kapıya bağlamak — AYRI İŞ, bu pencerede açılmadı (CONVENTIONS §5).

BAĞIMLILIK: yok (boş) — düzeltme hemen çalışabilir, hiçbir işin bitmesini beklemiyor.

NOT (araç kusuru, §D84'ten devralındı): MCP `add_task` `priority`'yi high/medium/low'a zorluyor, `critical` yazılamıyor; ayrıca yazma yolu üst-görev `id`'lerini string→sayı normalize edip ~220 satır ilgisiz churn üretiyor. Bu görev bu yüzden tasks.json'a birebir mevcut kayıt şeklinde elle eklendi (tm 110 emsali). `set_task_status` bu kusuru taşımıyor.

**Test Strategy:**

1) Sayım körlemesine yazılmaz — awk script'i §5.0 başlığı → §5.1 arasındaki `^| ` satırlarını tarar, damgayı 6. alanın öncü karakterinden okur, 30 veri satırı + 0 geçersiz damga doğrular, exit 0. Beklenen: `2 ⬜ · 1 ◐ · 24 ✅ · 3 ⛔`. Aynı script `7680328`'e karşı da koşulur ve `3/1/23/3` vermelidir — taban ölçülür, varsayılmaz.
2) Çapraz doğrulama: Task Master'da done olmayan v2 kalemleri = tm 73 (13.2 · done → ✅) · tm 74 (13.3 · in-progress, 9 alt-görevin 3'ü pending → ◐) · tm 75 (13.5 · pending) · tm 99 (09.2 · pending) → 1 ◐ + 2 ⬜ ile birebir örtüşür.
3) İki özet birbiriyle tutarlı: satır 22 ve satır 1100 aynı sayaç dizgesini taşır.
4) Damga regresyonu yok: `git diff`'te §5.0 bloğunun gereksinim satırlarında 0 değişiklik.
5) Kod değişmediği için DoD'un derleme kapıları bu görevde KAPSAM DIŞIDIR — yalnız .md + tasks.json dokunuldu ve `tasks.json` ürün kodunda hiçbir yerde import edilmiyor (grep ile doğrulandı) (§D78/§D83/§D84 emsali). `git status` temiz bırakılır.
