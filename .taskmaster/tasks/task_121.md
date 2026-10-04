# Task ID: 121

**Title:** 09.2 · 13.3 · 13.5 — kanıt bloklarındaki bayat "Satır ◐ kalıyor" cümleleri (14 madde, ölçüldü)

**Status:** done

**Dependencies:** None

**Priority:** critical

**Description:** Üç `✅` damgalı gereksinim satırının kanıt bloğu hâlâ ŞİMDİKİ ZAMANDA açık iş sayıyor. Aynı sınıf bugün üç pencere yaktı (§D91/§D92/§D93); kalan 14 madde de aynı yalancı bulguyu doğuracak. Süpürerek kapat.

**Details:**

PRD/PLAN kimliği: **09.2** (PLAN.md:1122) · **13.3** (PLAN.md:1128) · **13.5** (PLAN.md:1131) —
üçü de `✅ → K…` damgalı.

(a) GEREKÇE VE KANIT (bu pencerede ÖLÇÜLDÜ — `## K.` bölümünün 63 bloğu tarandı):
Panelin sağlık taraması "satır kendi kendisiyle çelişiyor" bulgusunu BUGÜN ÜÇ KEZ açtı
(`07.6` → §D91 · `§5.3-KB` → §D92 · `13.3` → §D93). Üçünde de damga DOĞRU çıktı, kusur METİNDE:
K blokları **append-only** olduğu için bir turun "kalan iş" cümlesi bloğun sonunda kalıyor, sonraki
teslimlerin maddeleri onun ÖNÜNE giriyor → blok kapanışını iki kez konuşuyor ve **son sözü eski**.
Her biri bir pencere yaktı. Kalan yük ölçüldü:

| blok | tablo satırı | damga | bayat madde |
| --- | --- | --- | --- |
| `K09.2-b` (PLAN.md:3876) | 1122 | ✅ | **6** — "**Satır `◐` kalıyor**" saf şimdiki zaman |
| `K13.5` (PLAN.md:4112) | 1131 | ✅ | **7** — aynı kalıp |
| `K13.3` (PLAN.md:4083) | 1128 | ✅ | **1** — §D93 ARTIĞI: fiil geçmişe çekilmiş ("Satır o turda `◐` kaldı") ama NESNE şimdiki zamanda kalmış ("… duruyor") |

Toplam **14 madde / 3 blok**. Ölçüm komutu (yeniden koşulabilir, `PLAN.md` üzerinde):
`**Satır \`◐\` kalıyor**` → 13 isabet (K09.2-b 6 · K13.5 7) · §D93 artığı → 1 isabet (K13.3).

YANLIŞ POZİTİFLER — bunlara DOKUNMA (bu turda tek tek elendi):
- `K02.1.4:3806` "kanal bağlı **değilse**" · `K07.6:3932` "bir arada **kalıyor**" (kümeleme
  davranışı) · `K07.7-b:3936` "altı gated-olmayan sekme **duruyor**" (test iddiası) ·
  `KA11Y:4188` "**yakalıyor**" (`kalıyor` alt-dizisi) → hiçbiri açık iş cümlesi değil.
- `K07.6` ve `K5.3-KB` ZATEN DOĞRU ONARILDI (§D91/§D92): "Kalan…" etiketi duruyor ama arkasına
  "→ **KAPANDI**" + blok denetim cümlesi eklenmiş. Emsal biçim bu ikisidir — birebir taklit et.

(b) DOKUNULACAK DOSYA: **yalnız `PLAN.md`** (+ kapanışta `HANDOFF.md`).

(c) SIRA (kod yok, sözleşme yok — doküman işi):
1. Üç bloğun 14 maddesini ÖNCE koda karşı doğrula (aşağıdaki tuzak) → 2. metni çevir →
3. §D'ye tek sapma maddesi yaz → 4. ölçüm komutunu yeniden koş, 0 isabet olduğunu göster.

(d) BİLİNEN TUZAKLAR:
- **Metni körlemesine çevirme — önce damgayı hak ettiğini doğrula.** §D91/§D92/§D93'ün üçü de
  damganın DOĞRU olduğunu koda karşı ölçerek gösterdi (dosya varlığı YETMEZ: ilgili test
  paketlerini koşup sayı verdiler). Aynısını 09.2 · 13.3 · 13.5 için yap. Bir tanesi gerçekten
  eksik çıkarsa metin değil **damga** yanlıştır → `◐` + eksik açıklaması doğru cevaptır,
  `✅`'i savunmak DEĞİL.
- **§D93'ün dersi (dördüncü örnek burada):** fiili geçmişe çekmek YETMEZ — cümlenin açık iş sayan
  NESNESİ de ("… duruyor", "… henüz yapılmadı", "… bağlı değil") çevrilmeli. K13.3'ün kalan 1
  maddesi tam olarak bu yüzden hâlâ bulgu üretebilir durumda.
- **Hiçbir kanıt maddesi SİLİNMEZ** (append-only kural). Cümle çevrilir + bloğun GÜNCEL durumunu
  ilan eden denetim cümlesi eklenir.
- **Tablo hücrelerine DOKUNULMAZ** — `✅ → K09.2-b` / `✅ → K13.3` / `✅ → K13.5` aynen kalır
  (CONVENTIONS §1.2: hücrede yalnız damga).
- `PLAN.md` `.prettierignore`'da (tm 118 kararı) — prettier onu yeniden hizalamaz, `grep -n`
  okuma düzeni korunur. Satırları elle yaz, aracı üstünden geçirme.
- CONVENTIONS §1.2 satır uzunluğu: yeni tablo/gereksinim satırı EKLEMİYORSUN, ama kanıt
  bloğundaki maddeler zaten uzun — mevcut biçimi bozma.

(e) KAPSAM SINIRI — dokunma:
- Ürün kodu · testler · migration · sözleşme YOK. Bu görev **metin-only**.
- Faz-3 statüleri (tm 79/81/82/83/84/90) ve Faz-3 planı YOK.
- tm 1-26 (K1) · mevcut bağımlılık kenarları YOK.
- Yukarıda "yanlış pozitif" diye listelenen 4 satır + zaten onarılmış `K07.6`/`K5.3-KB` YOK.
- Faz özet sayaçları ve §5.0 damgaları YOK (sayım doğru).
- Diğer K bloklarına genişletme YOK — kapsam tam olarak bu 3 blok / 14 madde.

(f) KAPANIŞTA YAZ: §D'ye yeni sapma maddesi — bu, kalıbın **DÖRDÜNCÜ VE SON** süpürmesidir; kuralı
oraya kalıcı yaz: *"kalan-iş notu o turun maddesinin İÇİNE yazılır, bloğun kuyruğuna DEĞİL; ve
teslim edildiğinde hem FİİL hem NESNE geçmişe çevrilir."*

**Test Strategy:**

Bu görev **doküman-only**; build kapıları koşulmaz (§D80/§D81/§D82/§D87 emsali — `git diff --stat` yalnız `PLAN.md` + `HANDOFF.md` göstermeli, başka dosya çıkarsa kapsam aşılmıştır).
ÖLÇÜLEBİLİR KABUL — hepsi komutla doğrulanır:
(1) `PLAN.md` içinde `**Satır \`◐\` kalıyor**` araması → **0 isabet** (bugün 13).
(2) K13.3'teki §D93 artığı ("Satır o turda `◐` kaldı … duruyor") → **0 isabet** (bugün 1).
(3) Üç bloğun her biri "bu blokta açık iş YOK" ilanı taşıyor (`K07.6`/`K5.3-KB`'nin emsal biçimi).
(4) Üç tablo hücresi DEĞİŞMEDİ: `grep -n '| 09.2 |\|| 13.3 |\|| 13.5 |' PLAN.md` çıktısı hâlâ `✅ → K09.2-b` / `✅ → K13.3` / `✅ → K13.5`.
(5) Hiçbir kanıt maddesi silinmedi: `git diff PLAN.md` içinde silinen satır sayısı, eklenen satırların yeniden yazımı dışında **0 net madde kaybı** gösteriyor.
(6) Damganın hak edildiği KODA KARŞI ölçüldü: 09.2 · 13.3 · 13.5 için ilgili test paketleri koşuldu ve sayıları kanıt bloğuna yazıldı (dosya varlığı yetmez).
