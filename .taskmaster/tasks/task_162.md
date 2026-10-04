# Task ID: 162

**Title:** M-SCALE — Ölçek dikişleri: iki-pod doğrulaması (fan-out · scheduler lideri · sticky session) · bağlantı havuzu + PgBouncer · read-replica okuma yolu (NFR-R1/R4 · NFR-P7)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** NFR-R1 yatay ölçek istiyor (stateless servisler + RTM pod ölçeği + Redis pub/sub fan-out) ve kod bunu destekleyecek biçimde yazılmış: scheduler Redis lider kilidi kullanıyor, RTM fan-out Redis pub/sub üzerinden. Ama bu HİÇ ÖLÇÜLMEDİ — bugüne kadar her şey tek süreçle koşuldu. NFR-R4 darboğaz yönetimi için read-replica öngörüyor; NFR-P7 ağır raporların OLTP yi yormamasını istiyor. İkisinin de kod payı yok.

**Details:**

BULGU KAYNAĞI: 2026-08-23 bağımsız denetimi (§D124, NFR-R grubu: R1 kod var ölçüm yok, R4 read-replica yok).
ZEMİN (oku): scheduler lider kilidi tm 130.1 de kuruldu (Redis SET NX + Lua ile sahip doğrulama);
RTM fan-out u Redis pub/sub üzerinden çalışıyor ve rtm.test.ts te çapraz-kiracı izolasyonu testli.
Yani bu kalem YENİ MİMARİ KURMAZ — var olanın çok süreçli davranışını ÖLÇER ve eksik dikişi ekler.

FAZ-6'NIN KONUSU: CANLIDA AYAKTA KALMAK (§D124). Faz-5 ürünün DOĞRU olmasını sağladı;
Faz-6 HAZIR olmasını sağlar.

SINIR (CLAUDE.md): production deploy / DNS / TLS / gerçek secret YOK. Her kalem ya yerelde koşulabilir
ya --dry-run ile doğrulanabilir olmalı. Mock sağlayıcıları gerçeğe çekmek de KAPSAM DIŞI.
Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-SCALE** (türetilmiş — NFR-R1/R4 · NFR-P7). Gereksinim satırı: `grep -n "| M-SCALE" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-SCALE" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

Üç alt-görev done. Ölçülebilir:
1. İki api + iki rtm süreci aynı Redis e bağlıyken fan-out çapraz pod çalışıyor ve scheduler TEK lider seçiyor.
2. Bağlantı havuzu env den yapılandırılabiliyor; PgBouncer uyumluluğu belgeli.
3. Read-replica dikişi var (DATABASE_REPLICA_URL yoksa birincile düşer) ve ağır rapor sorguları oraya gidiyor.
4. PLAN §7.2 M-SCALE → "✅ → KM-SCALE"; NFR-R1/R4/P7 satırları güncel.

## Subtasks

### 162.1. M-SCALE-a [OPUS-MAX] BÖLÜNMEZ: iki-pod doğrulaması — aynı Redis e bağlı iki api + iki rtm süreci; fan-out çapraz pod çalışıyor mu · scheduler tek lider seçiyor mu · sticky session gerekiyor mu

**Status:** done  
**Dependencies:** None  

Yatay ölçek iddiası ilk kez iki süreçle ölçüldü.

**Details:**

NE YAPILACAK: çok süreçli bir integration testi (ya da koşulabilir bir doğrulama harness ı).
Ölçülecek üç soru:
1. FAN-OUT: rtm-A ya bağlı bir ajan, api-B üzerinden gönderilen bir mesajı alıyor mu?
   (Redis pub/sub un asıl vaadi bu; tek süreçte hiç sınanmadı.)
2. SCHEDULER LİDERİ: iki api süreci aynı anda ayaktayken bir sweep KAÇ KEZ koşuyor?
   Cevap "bir" olmalı (tm 130.1 in Redis kilidi). İki kez koşarsa retention/webhook yeniden teslim
   gibi işler çift çalışır — veri kaybı ve çift teslim demektir.
3. STICKY SESSION: bir ajanın WS bağlantısı rtm-A da iken REST istekleri api-B ye giderse bir şey
   bozuluyor mu? (Presence, unread, seen imleci, conflict uyarısı.) Cevap "hayır" olmalı —
   olmuyorsa dağıtım sticky session ister ve bu M-IAC in manifestini etkiler.

NEDEN OPUS-MAX VE BÖLÜNMEZ: eşzamanlılık ve dağıtık kilit akıl yürütmesi. Bağlam bölününce
"iki süreç aynı anda ne yapar" sorusu cevaplanamaz.

DOSYALAR: apps/api/test/integration/ altında yeni bir çok-süreçli süit ya da
scripts/ altında koşulabilir bir doğrulama · apps/api/scripts/with-test-datastores.ts (İKİ süreç
AYNI veritabanı ve AYNI Redis i paylaşmalı — harness bugün her koşuya İZOLE veritabanı veriyor,
bu testte tam tersi gerekiyor: paylaşım. Harness ı buna göre kullan ya da genişlet).
REFERANS: apps/rtm/test/integration/rtm.test.ts (fan-out ve abonelik testleri) ·
apps/api/src/services/scheduler/lock.ts + lock.test.ts (kilit semantiği).

TUZAKLAR:
1. İZOLASYON HARNESS I İLE ÇELİŞKİ: §1.1 her koşuya kendi veritabanını veriyor. Bu test iki sürecin
   AYNI depoyu paylaşmasını gerektiriyor. Harness ı atlatmak yerine, tek bir harness altında iki
   süreç başlat (ikisi de aynı DATABASE_URL/REDIS_URL alsın). Nasıl yaptığını HANDOFF a yaz.
2. Süreçleri temiz kapat — asılı kalan süreç sonraki süitleri kilitler (portlar).
3. Zamanlayıcı testi kısa aralıklarla koşmalı (SCHEDULE_*_MS env den) ki test dakikalarca sürmesin.
4. Bulgu çıkarsa (ör. sticky session GEREKİYOR) bu bir kusur değil bir GEREKSİNİMDİR —
   §D ye yaz ve M-IAC (tm 164) için not düş.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-SCALE** (türetilmiş — NFR-R1). Gereksinim satırı: `grep -n "| M-SCALE" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-SCALE" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 162.2. M-SCALE-b [SONNET-XHIGH] Bağlantı havuzu: Prisma pool boyutu env e · PgBouncer transaction-mode uyumluluğu belgelenir · max_connections bütçesi

**Status:** done  
**Dependencies:** None  

Pod sayısı arttığında veritabanı bağlantıları tükenmiyor.

**Details:**

NE YAPILACAK:
1. Prisma bağlantı havuzu boyutu env den yapılandırılabilir olsun (bugün varsayılan).
   Yeni anahtar env.ts + .env.example + turbo.json globalEnv üçlüsüne birden eklenir (parite nöbetçisi).
2. max_connections BÜTÇESİ belgelenir: docker-compose.yml postgres i -c max_connections=200 ile
   koşuyor. Pod başına havuz × pod sayısı ≤ bütçe ilişkisini README de bir tabloyla yaz.
3. PgBouncer transaction-mode uyumluluğu: PRD (NFR-S4) PgBouncer transaction-mode + SET LOCAL
   öngörüyor ve depo ZATEN SET LOCAL kullanıyor (kiracı bağlamı için) — yani uyumlu.
   Bunu DOĞRULA ve belgele; uyumsuz bir kullanım (oturum-ömürlü SET, prepared statement varsayımı)
   varsa bul ve raporla.

DOSYALAR: apps/api/src/plugins/database.ts (havuz yapılandırması) · apps/api/src/config/env.ts ·
.env.example · turbo.json · README.md (yeni alt bölüm) · apps/api/src/lib/tenant.ts
(SET LOCAL kullanımı — OKU, kiracı bağlamının nasıl kurulduğunu gör).
REFERANS: README nin "Notable engineering choices" bölümündeki DATABASE_URL ↔ DATABASE_APP_URL
ayrımı anlatımı — aynı ton ve aynı yer.

TUZAK: prepared statement lar PgBouncer transaction-mode ile sorunludur. Prisma nın bu ortamda
nasıl davrandığını ARAŞTIR ve bulgunu yaz; gerekirse bağlantı dizesi parametresi öner.
Gerçek bir PgBouncer KURMA (kapsam dışı) — belgele ve uyumsuzluk varsa raporla.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-SCALE** (türetilmiş — NFR-R1/R4 · NFR-S4). Gereksinim satırı: `grep -n "| M-SCALE" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-SCALE" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 162.3. M-SCALE-c [OPUS-XHIGH] Read-replica okuma yolu dikişi: DATABASE_REPLICA_URL (yoksa birincile düşer), ağır rapor sorguları oraya — NFR-P7/R4 ün kod payı

**Status:** done  
**Dependencies:** 162.2  

Ağır raporlar artık OLTP yolunu yormayabiliyor.

**Details:**

NE YAPILACAK: bir okuma yolu dikişi — GERÇEK bir replika kurulmaz (kapsam dışı), seçim dikişi hazırlanır.
- Yeni env: DATABASE_REPLICA_URL (opsiyonel). Yoksa okuma birincile düşer — davranış BUGÜNKÜYLE AYNI.
- Ağır ve SALT-OKUNUR sorgular (reports servisleri: report-csv · reports-metrics · access-review)
  replika istemcisini kullanır.
- Kiracı izolasyonu replika yolunda da GEÇERLİ olmalı: RLS ve SET LOCAL bağlamı aynı biçimde kurulur
  (replika da siyahtus_app rolüyle bağlanır — sahip rolüyle DEĞİL).
- Replika gecikmesi (replication lag) okunan verinin bayat olabileceği anlamına gelir; hangi
  raporların bunu tolere ettiğini yaz. Faturalama sayaçları (ADR-09 ai_resolutions) TOLERE ETMEZ —
  onlar birincil kalır.

NEDEN OPUS-XHIGH: çok yüzeyli bir dikiş (env + plugin + servis seçimi) ve bir izolasyon riski
taşıyor — yanlış kurulursa replika yolunda RLS baypas edilir (tam olarak tm 150 nin kapattığı sınıf).

DOSYALAR: apps/api/src/plugins/database.ts (ikinci istemci) · apps/api/src/config/env.ts ·
.env.example · turbo.json · apps/api/src/services/reports/* (okuma yolu seçimi) ·
apps/api/src/lib/tenant.ts (bağlam kurulumu replika için de).
REFERANS DESEN: M-PROV-a (tm 131.2) sağlayıcı seçim dikişleri — "env fiilen seçer, NODE_ENV değil"
kuralı burada da geçerli.

TUZAKLAR:
1. RLS: replika istemcisi de siyahtus_app ile bağlanmalı; DATABASE_URL (sahip) kullanılırsa RLS sessizce
   devre dışı kalır. Bunu bir testle KİLİTLE.
2. Replika YOKKEN hiçbir davranış değişmemeli — tam integration süiti yeşil kalmalı.
3. Yazma sorgusu replikaya GİTMEMELİ; seçim yalnız salt-okunur yollarda.
4. Gerçek bir replika kurup test etmek kapsam dışı; dikişi aynı veritabanına ikinci bir istemciyle
   yönlendirerek doğrulayabilirsin (davranış eşdeğerliği + RLS kilidi).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-SCALE** (türetilmiş — NFR-P7 · NFR-R4). Gereksinim satırı: `grep -n "| M-SCALE" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-SCALE" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
