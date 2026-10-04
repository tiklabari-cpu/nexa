# Task ID: 156

**Title:** M-GUARD — Nöbetçi borçları: CI adım sırası (NFR-P3 bundle bütçesi sessizce atlanıyor, §D122) · design-system a11y testleri · kabul edilen borç kayıtları (§D124)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Üç ayrı borç, ortak sınıf: bir kural yazılı ama onu KORUYAN mekanizma ya yok ya sessiz. (1) §D122: bundle-size.test.ts dist yoksa sessizce atlanıyor ve ci.yml de Unit tests adımı Build ten ÖNCE koşuyor — temiz bir checkout ta NFR-P3 bütçesi hiç ölçülmüyor, süit yine yeşil. (2) Design-system primitifleri (Banner/Dropdown/Modal/Panel) Radix yerine elle yazıldı; Radix in bedava verdiği klavye/odak davranışları bugün hiçbir testle kilitli değil. (3) Denetimin üç kabul edilen borcu (Radix sapması · NFR-I18N1 45+ dil · NFR-P8/M4 yük ayağı) PLAN a kaydedilmemiş.

**Details:**

BULGU KAYNAKLARI: §D122 (GL-10 turu) · 2026-08-23 denetimi (§D124 bulgu 7 ve 9).
Üç alt-görev; ilk ikisi bağımsız, üçüncüsü ikinciye bağımlı (sapma kaydı nöbetçiye referans verir).

FAZ-5'İN KONUSU: DENETİMİN BULDUĞU YANLIŞ (§D124). Bu faz YENİ ÖZELLİK AÇMAZ — iddia ile kodu
eşitler. Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-GUARD** (türetilmiş — NFR-P3 nöbetçisi · NFR-A11Y · §D124 borç kayıtları). Gereksinim satırı: `grep -n "| M-GUARD" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-GUARD" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

Üç alt-görev done. Ölçülebilir:
1. Temiz bir checkout ta CI, bundle bütçesini FİİLEN ölçüyor (atlamıyor).
2. Dört primitifin klavye/odak davranışları testle kilitli.
3. PLAN §D de üç yeni kabul edilen borç kaydı var ve §7.2 nin ilgili satırlarının metni daraltılmış (damgalar değişmemiş).

## Subtasks

### 156.1. M-GUARD-a [SONNET-XHIGH] CI adım sırası: ci.yml de Build, Unit tests ten ÖNCE koşar + bundle-size.test.ts dist yoksa sessizce atlamak yerine açık hata verir (§D122)

**Status:** done  
**Dependencies:** None  

Widget bundle bütçesi CI da gerçekten ölçülüyor.

**Details:**

NE YAPILACAK (§D122): iki küçük ama belirleyici düzeltme.
1. .github/workflows/ci.yml — verify job unda "Build" adımı "Unit tests" ADIMINDAN ÖNCE koşar.
   Bugün sıra: Typecheck → Lint → Format → Unit tests → Integration tests → Build.
   turbo.json da test:unit yalnız ^build e (bağımlılıkların build ine) bağlı, paketin KENDİ build ine değil;
   bu yüzden temiz checkout ta apps/widget/dist yoktur ve bütçe testi atlanır.
2. apps/widget/test/bundle-size.test.ts — describe.skipIf(!existsSync(distDir)) sessiz atlaması kalkar.
   dist yoksa test AÇIK BİR HATA vermeli ("önce build koş") ya da turbo bağımlılığı ile dist in
   varlığı garanti edilmeli. Sessiz yeşil KABUL EDİLEMEZ — bir NFR damgası, onu ölçen komut fiilen
   koşmuyorsa iddiadan ibarettir (§D122 nin dersi).

DOSYALAR: .github/workflows/ci.yml · apps/widget/test/bundle-size.test.ts · turbo.json (gerekirse
widget in test:unit görevine kendi build bağımlılığı).

TUZAKLAR:
1. Sıra değişimi CI süresini uzatabilir; kabul edilebilir — ölçülmeyen bütçe ölçülmemiş demektir.
2. YEREL koşuda da bozmamalı: pnpm -w test in build siz koşulduğu durumlar var; seçtiğin çözüm
   yerel geliştiriciyi kilitlememeli (turbo bağımlılığı en temiz yol).
3. Bütçenin kendisi geniş marjla geçiyor (2026-08-23 ölçümü: loader 1.646 B + widget 16.705 B gzip
   = 18,4 KB, bütçe 51.200 B). Yani bu görev bir REGRESYON aramıyor, NÖBETÇİYİ onarıyor.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-GUARD** (türetilmiş — NFR-P3 nöbetçisi · §D122). Gereksinim satırı: `grep -n "| M-GUARD" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-GUARD" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 156.2. M-GUARD-b [SONNET-XHIGH] Design-system a11y nöbetçileri: Modal focus-trap + Escape + odak geri verme · Dropdown roving-tabindex + Home/End · Panel/Banner rol ve canlı bölge testleri

**Status:** done  
**Dependencies:** None  

Elle yazılmış primitiflerin klavye davranışı artık testle kilitli.

**Details:**

NE YAPILACAK: apps/web/src/components/ui/ altındaki dört primitifin klavye ve odak davranışları
birim testleriyle kilitlenir. Bunlar Radix in bedava verdiği davranışlardır; depo primitifleri elle
yazdığı için bugün hiçbiri testle korunmuyor (§D124 bulgu 7).
- Modal: açılınca odak içeri girer · Tab döngüsü içeride kalır (focus trap) · Escape kapatır
  · kapanınca odak açan öğeye GERİ döner.
- Dropdown: ok tuşlarıyla gezinme (roving tabindex) · Home/End · Escape kapatır · dışarı tıklama kapatır.
- Panel: rol ve etiketleme (aria-label / aria-labelledby) · kapatma düğmesinin erişilebilir adı.
- Banner: rol (status/alert ayrımı) · kalıcı dismiss davranışı erişilebilir.
KOD DAVRANIŞI DEĞİŞTİRME hedefi değil — ölçüp eksik bulursan DÜZELT, ama kapsamı bu dört dosyada tut.

DOSYALAR: apps/web/src/components/ui/{Modal,Dropdown,Panel,Banner}.tsx ve .test.tsx dosyaları.
REFERANS: mevcut testler (Modal.test.tsx vb.) + e2e a11y.spec.ts in axe kullanımı.
NOT: axe taraması bu davranışları GÖREMEZ (statik ihlal arar); klavye davranışı ancak
etkileşimli birim testiyle kilitlenir. İkisi birbirinin yerine geçmez.

TUZAK: NFR-A11Y4 "sürükle-bırak yeniden sıralamaya klavye alternatifi" istiyor; bu görev o kalemi
AÇMAZ (kapsam dışı) — ama primitiflerde bir eksik bulursan HANDOFF a yaz.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-GUARD** (türetilmiş — NFR-A11Y1-6 · §D124/7). Gereksinim satırı: `grep -n "| M-GUARD" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-GUARD" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 156.3. M-GUARD-c [SONNET-XHIGH] Kabul edilen borç kayıtları: Radix sapması · NFR-I18N1 KOD/İÇERİK ayrımı · NFR-P8+M4 yük ayağının Faz-6 ya atanması (§D + §7.2 metin daraltması)

**Status:** done  
**Dependencies:** 156.2  

Üç bilinçli borç artık planda yazılı ve sahipli.

**Details:**

NE YAPILACAK: PLAN a ÜÇ kayıt. Ürün kodu DEĞİŞMEZ — bu bir belge görevidir.

1. RADIX/SHADCN SAPMASI (§D yeni madde). MASTER-PROMPT kilitli kararı ve design-brief.md §6.1
   shadcn/ui (Radix) tabanını istiyor; apps/web dört primitifi elle yazdı (Banner/Dropdown/Modal/Panel)
   ve bu sapma 123 kayıtlı sapmanın arasında YOK. Kayıt şunu yazar: sapmanın kendisi, gerekçesi
   (bağımlılık yüzeyi küçük kaldı · bundle bütçesi · axe taraması temiz), ve GÖÇ YAPILMAYACAĞI kararı
   (kullanıcı kararı, 2026-08-24). Nöbetçi olarak tm 156.2 nin klavye testlerine referans verir.

2. NFR-I18N1 · KOD / İÇERİK AYRIMI (§D yeni madde). §D97 nin KOD/SÜREÇ ayrımının kardeşi:
   widget i18n MEKANİZMASI + RTL + nöbetçi KOD PAYIDIR ve teslimdir (8 dil: ar/de/en/es/fr/it/pt/tr;
   apps/widget/src/i18n.ts kendi yorumunda dokuzuncu dilin kod değişikliği gerektirmediğini yazıyor).
   Kalan 37 katalog İÇERİK PAYIDIR (lokalizasyon teslimi, mühendislik değil).
   §7.2 nin I18N1/2 satırının METNİ bu ayrımı taşıyacak biçimde daraltılır — DAMGA ✅ KALIR.
   ◐ YAZMA: "◐ + kuyrukta açık görev yok" durumu §F.00 ı bloklar (§6A nın panel notu).

3. NFR-P8 · NFR-M4 YÜK AYAĞI → FAZ-6 (§D yeni madde). apps/rtm ws kullanıyor (MASTER-PROMPT kilitli
   kararı), PRD nin "~20k WS/pod (uWebSockets.js)" hedefi ne uygulandı ne ÖLÇÜLDÜ; NFR-M4 ün beşinci
   ayağı (k6/Gatling yük testi) depoda hiç yok. İkisi de Faz-6 M-LOAD kalemine (tm 161) atanır ve
   §7.2 de öyle işaretlenir.

DOSYALAR: PLAN.md yalnız — §D bölümü (yeni maddeler, en sona; mevcut numaralandırmayı sürdür) ·
§7.2 tablosunun I18N1/2 ve M4 satırlarının metni · §7.1 in EK-C.2 satırı (Radix e referans varsa).
HANDOFF.md ye kısa not.

DİSİPLİN (CONVENTIONS §1.2): tablo hücresine KANIT YAZMA. Hücre yalnız damga + referans taşır;
gerekçe §D maddesine ve K bloğuna gider. Faz özet tablosu bu kuralın dışındadır, ona dokunma.

TUZAK: bu görev ÜRÜN KODU YAZMAZ. git diff yalnız PLAN.md + HANDOFF.md + .taskmaster olmalı.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-GUARD** (türetilmiş — §D124 kabul edilen borçlar). Gereksinim satırı: `grep -n "| M-GUARD" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-GUARD" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
