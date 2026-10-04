# Task ID: 165

**Title:** M-BACKUP — Yedekleme + GERİ YÜKLEME PROVASI: pg_dump scripti + CronJob manifesti + retention · çalıştırılabilir restore-drill (NFR-R5)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** NFR-R5 yedekleme + point-in-time recovery istiyor ve "yedekler de retention politikasına tabi" diyor. Depoda bugün HİÇBİR yedekleme yolu yok. Daha önemlisi: bir yedeğin var olması onu geri yüklenebilir yapmaz — ölçülmesi gereken şey "yedek alındı" değil "yedek GERİ YÜKLENDİ ve veri tutuyor" olmalı.

**Details:**

BULGU KAYNAĞI: 2026-08-23 bağımsız denetimi (§D124: NFR-R5 hiç yok).

CLAUDE.md SINIRI — DİKKAT: "DB drop YOK". Geri yükleme provası, siyahtus geliştirme veritabanına
DOKUNMAZ; kendi GEÇİCİ veritabanını yaratır, yedeği oraya yükler, doğrular ve düşürür.
Emsal: apps/api/scripts/with-test-datastores.ts — her koşuya kendi siyahtus_test_<id> veritabanını
verip sonunda düşüren mevcut harness. Aynı disiplin.

FAZ-6'NIN KONUSU: CANLIDA AYAKTA KALMAK (§D124). Faz-5 ürünün DOĞRU olmasını sağladı;
Faz-6 HAZIR olmasını sağlar.

SINIR (CLAUDE.md): production deploy / DNS / TLS / gerçek secret YOK. Her kalem ya yerelde koşulabilir
ya --dry-run / helm template ile doğrulanabilir olmalı. M-CONTAINER emsali (tm 140): dosyalar depoda,
kubectl apply YOK. Mock sağlayıcıları gerçeğe çekmek de KAPSAM DIŞI.
Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-BACKUP** (türetilmiş — NFR-R5 · NFR-C8). Gereksinim satırı: `grep -n "| M-BACKUP" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-BACKUP" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

İki alt-görev done. Ölçülebilir:
1. Yedekleme scripti koşuyor ve bir dosya üretiyor; CronJob manifesti dry-run dan geçiyor.
2. restore-drill scripti GEÇİCİ bir veritabanına yedeği yüklüyor, migration durumunu ve satır sayılarını
   doğruluyor, sonra düşürüyor — exit code ile.
3. siyahtus geliştirme veritabanına DOKUNULMADI.
4. PLAN §7.2 M-BACKUP → "✅ → KM-BACKUP".

## Subtasks

### 165.1. M-BACKUP-a [SONNET-XHIGH] Yedekleme scripti + CronJob manifesti (pg_dump + object storage dizini) + retention politikası

**Status:** done  
**Dependencies:** None  

Yedek alma yolu depoda ve zamanlanabilir.

**Details:**

NE YAPILACAK:
1. scripts/backup.sh: pg_dump ile mantıksal yedek + .data/uploads (object storage yerel dizini)
   arşivi. Çıktı adı zaman damgalı. psql/pg_dump HOST TA KURULU OLMAYABİLİR — Makefile in
   make psql hedefi bunu KONTEYNER İÇİNDE koşuyor; aynı yolu kullan.
2. Retention: kaç yedek tutulur, ne zaman silinir. NFR-C8 "yedekler de retention politikasına tabi"
   diyor — yani GDPR silme talebi yedekleri de kapsar. Bunu politikada AÇIKÇA yaz
   (yedek saklama süresi ≤ retention penceresi ya da yedekten silme prosedürü).
3. infra/helm/siyahtus/templates/ altına CronJob manifesti (dry-run ile doğrulanır).

DOSYALAR: scripts/backup.sh (yeni) · infra/helm/siyahtus/templates/backup-cronjob.yaml (yeni) ·
README (kısa bölüm) · Makefile (hedef).
REFERANS: Makefile in psql hedefi (konteyner içinde çalıştırma deseni) · scripts/smoke.sh
(bash script stili: exit code, retry, açıklayıcı yorumlar).
apps/api/src/services/retention/policy.ts — retention pencerelerinin kaynağı; politika onunla tutarlı olmalı.

TUZAK: yedek dosyaları depoya COMMIT LENMEMELİ — .gitignore a çıktı dizinini ekle.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-BACKUP** (türetilmiş — NFR-R5 · NFR-C8). Gereksinim satırı: `grep -n "| M-BACKUP" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-BACKUP" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 165.2. M-BACKUP-b [OPUS-XHIGH] GERİ YÜKLEME PROVASI scripts/restore-drill.sh: geçici veritabanına yükler, migration durumunu ve satır sayılarını doğrular, sonra düşürür — ölçülen şey "geri yüklenebilir"

**Status:** done  
**Dependencies:** 165.1  

Yedeğin gerçekten geri yüklenebildiği kanıtlandı.

**Details:**

NE YAPILACAK: scripts/restore-drill.sh — çalıştırılabilir bir prova.
Adımlar:
1. GEÇİCİ bir veritabanı yaratır (ör. siyahtus_restore_drill_<zaman>) — siyahtus ya DOKUNMAZ.
2. 165.1 in ürettiği yedeği oraya yükler.
3. DOĞRULAR:
   - _prisma_migrations tablosundaki uygulanmış migration sayısı beklenenle aynı mı,
   - kritik tabloların satır sayıları kaynak ile tutuyor mu (organizations · accounts · chats · events),
   - RLS politikaları geri geldi mi (tm 150 nin partisyon politikaları DAHİL — mantıksal yedek
     bunları taşıyor mu, ÖLÇ; taşımıyorsa bu bir BULGUDUR ve raporlanır),
   - pgvector uzantısı ve SECURITY DEFINER fonksiyonlar yerinde mi.
4. Geçici veritabanını DÜŞÜRÜR (başarısız olsa bile — trap ile temizlik).
5. Exit code ile sonuç verir.

NEDEN OPUS-XHIGH: doğrulama listesinin ne içereceği bir yargı işidir; eksik bir liste "yedek çalışıyor"
diye yanlış güven verir. Ayrıca RLS/uzantı/fonksiyon gibi şema nesnelerinin mantıksal yedekte
nasıl davrandığı ölçülmeli, varsayılmamalı.

CLAUDE.md SINIRI: "DB drop YOK" — bu script YALNIZ kendi yarattığı geçici veritabanını düşürür.
siyahtus ya ve siyahtus_test_* dışındaki hiçbir veritabanına dokunmaz. Bu koruma script in kendisinde
bir isim kontrolüyle ZORLANMALI (yanlışlıkla siyahtus yazılırsa reddetsin).

DOSYALAR: scripts/restore-drill.sh (yeni) · Makefile (hedef) · README (kısa bölüm).
REFERANS: apps/api/scripts/with-test-datastores.ts — geçici veritabanı yaratma/düşürme deseni
ve temizlik disiplini (ölen koşunun bıraktığını sonraki koşu süpürür).

TUZAK: pg_dump/pg_restore sürüm uyumu; konteyner içindeki Postgres 17 ile aynı sürümü kullan
(make psql deseni).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-BACKUP** (türetilmiş — NFR-R5). Gereksinim satırı: `grep -n "| M-BACKUP" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-BACKUP" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
