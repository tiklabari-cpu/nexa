# Task ID: 150

**Title:** S4-PART — events partisyonlarında RLS: kiracı izolasyonu ana tabloda var, partisyonlarda yok (NFR-S4) — §D124 bulgu 1

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Denetim ölçtü: siyahtus_app rolüyle kiracı bağlamı ayarlanmadan "select count(*) from events" → 0 (RLS doğru çalışıyor), ama "select count(*) from events_2026_08" → 55 (RLS baypas, tüm kiracıların satırları okunabiliyor). events aylık RANGE partitionlı; ana tabloda RLS açık, partisyonlarda kapalı. ALTER DEFAULT PRIVILEGES her yeni tabloya siyahtus_app için DML veriyor ve events_ensure_partition her ay yeni partisyon açıyor — delik kendini her ay yeniden üretiyor. Bugün uygulama kodundan sömürülebilir DEĞİL (Prisma hep ana tabloyu sorguluyor), ama projenin bir numaralı güvenlik iddiası partisyon seviyesinde tutmuyor ve invariant testi partisyonları açıkça muaf tutuyor.

**Details:**

BULGU (2026-08-23 bağımsız denetim · §D124/1): ÖLÇÜLDÜ, tahmin değil. Çalışma zamanı rolüyle,
kiracı bağlamı ayarlanmadan: "select count(*) from events" → 0; "select count(*) from events_2026_08" → 55.
Bugün 11 partisyon var (events_2026_06 … events_2027_02 + events_default) ve hiçbirinde
relrowsecurity açık değil. Grant kaynağı iki yerde: 20260722090000_init_extensions/migration.sql:25-31
(ALTER DEFAULT PRIVILEGES + GRANT ON ALL TABLES) ve events_ensure_partition gövdesinin kendisi
(her yeni partisyona açıkça GRANT SELECT, INSERT, UPDATE, DELETE veriyor).

FAZ-5'İN KONUSU: DENETİMİN BULDUĞU YANLIŞ (§D124). Faz 0–4 kalemleri tek tek ✅ ve testli;
2026-08-23 bağımsız denetimi yine de dokuz bulgu çıkardı ve ortak şekilleri şu: bir damga, onu hak
eden koddan daha geniş bir şey iddia ediyor. Bu faz YENİ ÖZELLİK AÇMAZ — iddia ile kodu eşitler.
Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **S4-PART** (türetilmiş — NFR-S4 kiracı izolasyonu). Gereksinim satırı: `grep -n "| S4-PART" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KS4-PART" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

Üç alt-görev done. Ölçülebilir kapanış kanıtı:
1. Çalışma zamanı rolüyle bağlamsız "select count(*) from events_<ay>" → 0 satır.
2. data-model.test.ts RLS kapsam testi artık events_ ön ekli tabloları DIŞLAMIYOR ve yeşil.
3. api integration süiti tam yeşil (taban 2477) — ana tablo üzerinden giden hiçbir sorgu davranışı değişmemiş.
4. PLAN §7.2 S4-PART satırı "✅ → KS4-PART".

## Subtasks

### 150.1. S4-PART-a [OPUS-MAX] Migration: partisyonlarda RLS + events_tenant politikasının aynısı; events_ensure_partition yeni partisyonda da kurar; mevcut 11 partisyon geriye dönük düzeltilir

**Status:** done  
**Dependencies:** None  

Kiracı izolasyonu artık partisyon seviyesinde de geçerli.

**Details:**

NE YAPILACAK: yeni bir Prisma migration (apps/api/prisma/migrations/<zaman>_events_partition_rls/).
İki iş var:
(1) events_ensure_partition fonksiyonu CREATE OR REPLACE ile güncellenir — partisyonu yarattıktan
    ve GRANT verdikten sonra ayrıca "ALTER TABLE ... ENABLE ROW LEVEL SECURITY" koşar ve ana
    tablodakiyle AYNI politikayı partisyona kurar (politika adı partisyon başına benzersiz olmalı).
(2) Mevcut partisyonların hepsi için aynısı geriye dönük koşulur: pg_inherits/pg_class üzerinden
    events tablosunun tüm partisyonlarını dolaşan bir DO bloğu — events_default DAHİL.

DOSYALAR: yeni migration dizini (tek dosya, migration.sql).
Değiştirilecek fonksiyonun mevcut gövdesi:
apps/api/prisma/migrations/20260722154008_domain_model/migration.sql içinde events_ensure_partition
(GRANT satırı VAR, ENABLE ROW LEVEL SECURITY YOK), hemen ardından events_maintain_partitions,
en sonda events_default yaratımı.

REFERANS DESEN — aynı dosyada ana tablonun politikası:
  ALTER TABLE events ENABLE ROW LEVEL SECURITY;
  CREATE POLICY events_tenant ON events
    USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());
Partisyon politikasının gövdesi bununla BİREBİR aynı olmalı.

TUZAKLAR — bu alt-görev iddia etmez, ÖLÇER:
1. Partisyonda RLS açmak, ANA TABLO üzerinden giden sorguların davranışını DEĞİŞTİRMEMELİ.
   Bunu varsayma: migration sonrası TAM api integration süitini koş (taban 2477) ve yeşil gör.
   Kırmızı gelirse politika gövdesi ya da FORCE seçimi yanlıştır — düzelt, geçme.
2. Yalnız REVOKE YETMEZ: ALTER DEFAULT PRIVILEGES her yeni tabloya yetkiyi yeniden verir.
   Çözüm RLS + politika olmalı ki gelecekteki partisyonlar da doğuştan korunsun.
3. Migration idempotent olmalı (IF NOT EXISTS / pg_policies kontrolü); db:check-drift temiz kalmalı.
4. siyahtus geliştirme veritabanını DROP ETME (CLAUDE.md sınırı). Testler zaten izole veritabanı alıyor.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **S4-PART** (türetilmiş — NFR-S4). Gereksinim satırı: `grep -n "| S4-PART" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KS4-PART" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 150.2. S4-PART-b [OPUS-XHIGH] Kapsam nöbetçisi: RLS testinin partisyon muafiyeti kalkar + bağlamsız doğrudan partisyon sorgusunun çapraz-kiracı satır döndürmediğini ölçen yeni test

**Status:** done  
**Dependencies:** 150.1  

İnvariant testi artık partisyonları da sayıyor.

**Details:**

NE YAPILACAK: apps/api/test/integration/data-model.test.ts içindeki
describe("row level security") > it("covers every tenant table") testinin sorgusundan,
events_ ön ekli tabloları dışlayan tablename koşulu KALDIRILIR.
Ardından aynı describe bloğuna YENİ bir test eklenir: çalışma zamanı rolüyle (DATABASE_APP_URL)
kiracı bağlamı AYARLANMADAN doğrudan bir partisyona SELECT atıldığında 0 satır döndüğü ölçülür —
ve ana tablo üzerinden bağlamla okumanın hâlâ çalıştığı AYNI testte doğrulanır (iki yönlü kanıt).

SIRA ÖNEMLİ — ÖNCE KIRMIZI: muafiyeti kaldırdığın ilk koşuda test KIRMIZI gelmeli
(11 partisyon korumasız listelenir). 150.1 uygulanmışsa yeşile döner. Kırmızıyı GÖRMEDEN geçme:
görmediysen ya muafiyet doğru kaldırılmamıştır ya sorgu partisyonları hiç görmüyordur.
Kırmızı/yeşil sırasını HANDOFF notuna YAZ — kanıt, kanaat değil.

DOSYALAR: apps/api/test/integration/data-model.test.ts (RLS describe bloğu).
REFERANS DESEN: aynı dosyadaki "hides another tenant..." testi — iki kiracılı fixture kurup
çapraz görünürlüğü ölçüyor; yeni test onun kardeşidir.
Çalışma zamanı rolüyle bağlanma deseni: apps/api/scripts/with-test-datastores.ts ve testlerin
DATABASE_APP_URL kullanımı.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **S4-PART** (türetilmiş — NFR-S4). Gereksinim satırı: `grep -n "| S4-PART" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KS4-PART" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 150.3. S4-PART-c [SONNET-XHIGH] Zamanlayıcı yolu: maintainPartitions ileri bir ay açtığında RLS de açılıyor mu — integration testi + PLAN §7.2 satırı + K bloğu

**Status:** done  
**Dependencies:** 150.1, 150.2  

Gelecek ayların partisyonları da doğuştan korumalı.

**Details:**

NE YAPILACAK: events_ensure_partition uygulama tarafından da çağrılıyor
(apps/api/src/plugins/database.ts — boot anında ve 6 saatte bir events_maintain_partitions).
Yeni integration testi: ileri bir tarih için events_ensure_partition çağır → yaratılan partisyonun
pg_class.relrowsecurity değeri true VE pg_policies içinde politikası var.
Yani düzeltme yalnız bugünkü partisyonları değil GELECEKTEKİLERİ de kapsıyor.

DOSYALAR: apps/api/test/integration/data-model.test.ts (ya da yakınındaki uygun süit) ·
apps/api/src/plugins/database.ts (yalnız OKUMA — kod değişikliği beklenmiyor).

PLAN İŞİ (bu alt-görev kalemi kapatır): §7.2 NFR kapıları tablosuna S4-PART satırı
"✅ → KS4-PART" yapılır ve #### KS4-PART kanıt bloğuna üç alt-görevin maddesi eklenir.
CONVENTIONS §1.2: tablo hücresine kanıt YAZMA, damga + referans yaz.

REFERANS DESEN: aynı dosyadaki mevcut RLS testleri (describe "row level security") ve
apps/api/src/plugins/database.ts’in maintainPartitions çağrısı — testin neyi taklit edeceğini
oradan oku, tahmin etme.

TUZAKLAR:
1. Test ileri bir ay için partisyon YARATIR; koşu sonunda o partisyonu bırakması sorun değil
   (izole test veritabanı koşu sonunda düşer, §1.1) — ama testi PAYLAŞILAN veritabanına karşı
   koşarsan (SIYAHTUS_TEST_ISOLATION=off) artık bırakır. Bunu bil.
2. Bu alt-görev kalemi KAPATIR: 150.1 ve 150.2 yeşil değilse §7.2 satırını ✅ yapma.
3. Kanıt K bloğuna madde olarak eklenir; tablo hücresine kanıt YAZILMAZ (CONVENTIONS §1.2).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **S4-PART** (türetilmiş — NFR-S4). Gereksinim satırı: `grep -n "| S4-PART" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KS4-PART" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
