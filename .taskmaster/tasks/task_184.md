# Task ID: 184

**Title:** M-TRACE — Kalite kapisi — "kabul kriterinin KENDISI test ediliyor mu" olculmuyor

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Mevcut DoD kapisi "kod var + testler yesil" i olcuyor. Denetimde ilk turun verdigi her bes TAM dan biri ikinci turda coktu, ve 07.4 metriginin testi yesilken kriter yanlisti. Bu kalem hangi testin hangi gereksinimi korudugunu makineyle okunabilir kilar ve kapiya baglar.

**Details:**

Denetim `prd-uyum-denetimi.md` §2 (çürütme turu neden gerekliydi) ve §8 · `CONVENTIONS.md` §1.

**Sıfırdan başlamıyorsun:** desen kısmen var — kodda ve testlerde `FR-MOD-11.5 · 11.5-d`, `08.9.5-a/b`, `ADR-09` gibi referanslar yorumlarda geçiyor. Kural bunu **düzenli** hale getirmeli, yeni bir şey icat etmemeli.

`-d` (PLAN doğruluk taraması) **en sona bırakılmalı** — diğer düzeltme kalemleri kapanmadan koşarsa düzeltilmiş maddeleri de `◐`ye çeker.

**Test Strategy:**

Kalem bütününün kabul kriteri: CI adımının **gerçekten kırmızı verdiği** gösterilir — etiketsiz bir gereksinim ID'si eklenince kapı düşer, etiket eklenince yeşile döner. "Adım eklendi" yetmez; bu tam da denetimin eleştirdiği şeydir.

## Subtasks

### 184.1. M-TRACE-a [OPUS-MAX] BÖLÜNMEZ: test↔gereksinim izlenebilirlik konvansiyonu (b ve c bunun üstüne kuruluyor)

**Status:** done  
**Dependencies:** None  

Etiket nerede yaşar — test adında mı, yorumda mı, bir yardımcıda (`covers('FR-MOD-08.5.5')`) mı? Her birinin grep'lenebilirliği ve gürültüsü farklı. Bir test birden çok maddeyi korur, bir madde birden çok testle korunur — çoktan-çoğa ilişkiyi nasıl ifade ediyorsun? Kural **geriye dönük** olarak 2701 entegrasyon + 1174 birim testine uygulanamaz: kademeli benimseme nasıl işleyecek, yalnız yeni/değişen testler mi zorunlu? Çıktı: kural + `CONVENTIONS.md`'ye yazılmış hali + en az bir dosyada uygulanmış hali + etiketlerin makineyle çıkarılabildiğini gösteren örnek komut.

**Details:**

Bağımlılık: yok. Dilim V7-4. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 184.2. M-TRACE-b [OPUS-XHIGH] Kapsama raporu script`i + sınırının açıkça belgelenmesi

**Status:** done  
**Dependencies:** None  

`scripts/` altında: PRD madde kataloğunu okur, `-a`nın kuralına göre testleri tarar, **testi olmayan maddeleri listeler**. Girdi kataloğu `prd-uyum-denetimi.md` Ek A'daki 247 madde olabilir — ama o bir markdown tablosu; ayrıştırılmalı mı yapılandırılmış kaynağa mı taşınmalı, kararını yorumla. **Sınırı belgele:** bir madde etiketli ama testi kriteri ölçmüyorsa script bunu göremez — yeşil rapor yanlış güven verir (07.4 dersinin tam tekrarı). Kapsam dışı listesi tut (KVKK, workflow builder, masaüstü uygulaması) yoksa bilinçli kararlar "eksik" diye raporlanır. Çıktı: insan özeti + CI'ın tüketeceği makine biçimi.

**Details:**

Bağımlılık: M-TRACE-a. Dilim V7-4. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 184.3. M-TRACE-c [SONNET-XHIGH] Kapsama kapısını CI`a bağla + CONVENTIONS §1`i güncelle

**Status:** done  
**Dependencies:** None  

Kademeli olmalı: bugün 141 KISMİ madde var, kapıyı "hiçbir madde testsiz olamaz" diye kurarsan CI kalıcı kırmızı olur ve kimse bakmaz — yeni/değişen maddeler zorunlu, mevcut borç ayrı raporlanır. `CONVENTIONS.md` §1 DoD listesine yeni kutu. **Kapının gerçekten kırmızı verdiğini kanıtla.** Bilinen CI boşluğu (unit-tests-before-build bundle bütçesini sessizce atlıyor) aynı turda ayrı commit ile kapatılabilir.

**Details:**

Bağımlılık: M-TRACE-b. Dilim V7-4. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 184.4. M-TRACE-d [SONNET-MAX] EN SONA BIRAK: PLAN.md yanlış kapanışlarının taranması (geniş mekanik süpürme)

**Status:** done  
**Dependencies:** None  

`prd-uyum-denetimi.md` Ek A'daki nihai verdict (TAM/KISMİ/YOK) ile PLAN.md durum damgalarını karşılaştır; `✅` damgalı ama denetimde KISMİ/YOK çıkan satırları düzelt. CONVENTIONS §1.2: *"Kısmen karşılandıysa `◐` + eksik açıklaması doğru cevaptır; `✅` uydurmak bu kutuyu geçmez"* — bu iş kalemi o kuralı geriye dönük uyguluyor. **SIRALAMA:** başlarken Task Master'da hangi kalemlerin `done` olduğunu kontrol et ve yalnız **gerçekten hâlâ eksik** olanları düşür. Kanıt disiplini: hücrede yalnız damga (`◐ → K<kod>`), açıklama `## K. Kanıt Geçmişi` bloğuna madde olarak; var olanları silme. Faz özet sayaçları da güncellenmeli (panel `statedCounts` olarak okuyor). `C-plan-row-length` eşiğini aşan satır üretme.

**Details:**

Bağımlılık: M-TRACE-b. Dilim V7-4. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.
