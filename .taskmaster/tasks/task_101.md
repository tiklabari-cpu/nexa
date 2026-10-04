# Task ID: 101

**Title:** PLAN §5.0 tablosunun 4 sarkan satırını reflow et — panelin dejenere parse döngüsünü kır (DOKÜMAN-ONLY)

**Status:** done

**Dependencies:** None

**Priority:** critical

**Description:** PLAN.md §5.0 "v2 kalem envanteri" tablosunun 30 mantıksal satırından 4'ünün hücre içeriği fiziksel satırlara hard-wrap edilmiş durumda. Panelin satır-bazlı sayacı tabloyu ilk sarkan devam satırında kesiyor ve yalnız ilk 3 satırı okuyor (2 ✅ / 0 ◐ / 1 ⬜) — bu yüzden §1.2 çelişkisi YANLIŞ POZİTİF olarak her taramada yeniden açılıyor (§D68–§D76, 8+ pencere yandı). Bu görev sarkan satırları kendi tablo satırlarına birleştirir; hiçbir durum damgası, hiçbir sayaç, hiçbir metin içeriği değişmez.

**Details:**

KÖKEN: Panel sağlık taraması bulgusu (Faz-2 özet sayacı çelişkisi). Teşhis + kanıt: PLAN.md §D75 ve §D76. Bu görev §D75'in "(a) reflow — yetki bekliyor" diye bıraktığı kalıcı çözümdür.

SORUN (kanıtlı): PLAN.md §5.0 tablosu (başlık satırı ~1106, veri satırları ~1108-1169) 30 mantıksal satır taşır ve gerçek dağılım 12 ⬜ · 2 ◐ · 13 ✅ · 3 ⛔'dır — üst-tablo (satır 22) ve §5.0 girişi (satır 1100) bununla BİREBİR AYNI, yani özet sayaçları DOĞRU. Ama 4 satırın "Durum / Not" hücresi sonraki fiziksel satırlara sarkıyor:
  - 07.6           (satır 1110) → kuyruk 1111
  - 08.6.3         (satır 1115) → kuyruk 1116-1130
  - 08.8.3         (satır 1132) → kuyruk 1133-1146
  - §5.3-KB        (satır 1162) → kuyruk 1163-1164 (1163 BOŞ SATIR — GFM'de tabloyu fiilen bitirir)
İlk kesinti 1111'de olduğu için satır-bazlı bir sayaç yalnız 1108/1109/1110'u görür = 2 ✅ / 0 ◐ / 1 ⬜ (panelin bildirdiği rakamların aritmetik kaynağı). Ayrıca 1163'teki boş satır tabloyu GFM render'ında da bölüyor.

YAPILACAK (tek tur, doküman-only):
1. §5.0 tablosundaki 4 sarkan satırın devam satırlarını kendi tablo satırlarının SONUNA birleştir (newline → tek boşluk). Sonuç: her mantıksal satır TEK fiziksel satır, tablo 30 temiz veri satırı.
2. Karakter içeriği KORUNUR — yalnız satır sonları boşluğa döner. Birleştirme öncesi/sonrası mantıksal satır metinleri (whitespace normalize edilerek) birebir eşit olmalı; bunu bir script ile doğrula ve çıktısını HANDOFF'a yaz.
3. Dosyanın geri kalanına DOKUNMA: gereksinim satırlarının durum damgaları (kanıta dayalı), özet sayaçları (satır 22 · satır 1100), §5.1/§5.2/§5.3, §D kayıtları (append-only tarihçe).
4. §D'ye tek satırlık D77 kaydı: ne birleştirildi, sayımın değişmediği (12 ⬜ · 2 ◐ · 13 ✅ · 3 ⛔ · toplam 30), döngünün kapandığı.

KAPSAM DIŞI: sayaçları değiştirmek (doğrular — değiştirmek hatayı ENJEKTE eder) · damga çevirmek · §5.0 dışındaki tabloları reflow etmek · siyahtus-panel deposundaki sayacı düzeltmek (ayrı depo, buradan erişilmiyor).

RİSK/NOT: Reflow §5.0'dan sonraki satır numaralarını ~30 satır yukarı kaydırır. Canlı satır-numarası atıfları etkilenmez (tasks.json ve PLAN-V2-KIRILIM.md yalnız PLAN.md:57 ve PLAN.md:520'ye atıf yapar — ikisi de §5.0'ın ÜSTÜNDE). HANDOFF.md'deki 11xx atıfları tarihçedir, append-only bırakılır.

DoD: Doküman-only değişiklik; kod/kontrat/şema dosyasına dokunulmaz. Kapı komutları bu görev için anlamlı değil, ancak `git status` kapanışta temiz olmalı (run-loop.sh bu pencereden önce de kirliydi — sahibi commit'lemeli, dokunma).

**Test Strategy:**

1. Birleştirme doğrulaması (script, exit 0): reflow ÖNCESİ ve SONRASI PLAN.md §5.0 tablosu mantıksal satırlara ayrıştırılır (`^\| ` ile başlayan satır yeni satır, diğerleri öncekine eklenir); whitespace normalize edildikten sonra 30 satırın 30'u da birebir eşit olmalı — tek karakter kaybı/eklenmesi yok.
2. Sayım invariantı: reflow SONRASI naif satır-bazlı sayım (`awk 'NR aralığı && /^\| / {damga = 6. alanın ilk karakteri}'`) → 30 satır, 12 ⬜ · 2 ◐ · 13 ✅ · 3 ⛔. Yani naif sayaç artık mantıksal sayaçla YAKINSIYOR (bulgunun kapanma kanıtı).
3. Tablo bütünlüğü: §5.0 tablo bloğunda (başlık satırından §5.1 başlığına kadar) `^\| ` ile başlamayan satır KALMAMALI (boş satır 1163 dahil) — grep sayısı 0.
4. Sızıntı kontrolü: `git diff --stat` yalnız PLAN.md (+ HANDOFF.md) göstermeli; `git diff` içinde durum damgası (⬜/◐/✅/⛔) ekleyen/silen tek bir satır bile olmamalı — damga sayıları diff öncesi/sonrası eşit.
