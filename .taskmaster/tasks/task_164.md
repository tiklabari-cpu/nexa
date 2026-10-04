# Task ID: 164

**Title:** M-IAC — Dağıtım manifestleri (DEPLOY YOK): Helm chart iskeleti · probe/kaynak/HPA/PDB · migration stratejisi kararı · values.production.example + dry-run doğrulaması

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** infra/ altında bugün tek bir SQL dosyası var (db/init/00-extensions.sql). M-CONTAINER (tm 140) uygulama imajlarını ve tam yığın compose u getirdi ama o YEREL bir yığın — README bunu açıkça yazıyor ("This is a local stack, not a deployment"). Bir dağıtımın ihtiyaç duyduğu manifestler (Deployment · Service · ConfigMap · Secret şablonu · probe · kaynak sınırı · HPA · PDB · migration Job u) hiç yazılmadı. Kullanıcı kararı (2026-08-24): manifestler YAZILIR, deploy EDİLMEZ — M-CONTAINER emsali.

**Details:**

BULGU KAYNAĞI: 2026-08-23 bağımsız denetimi (§D124, production hazırlığı: dağıtım katmanı yok).
KULLANICI KARARI (2026-08-24): "Evet — manifest yaz, deploy etme". Doğrulama helm template ve
kubectl --dry-run=client ile yapılır; gerçek küme GEREKMEZ ve KULLANILMAZ.

BAĞIMLILIK NOTU: 164.2 (probe lar) tm 160.1 in /health/live ↔ /health/ready ayrımına dayanır —
o ayrım olmadan liveness probe u yanlış uca bakar ve sağlıklı bir pod u öldürür.
Ayrıca tm 162.1 (iki-pod doğrulaması) sticky session gerekip gerekmediğini söyleyecek; sonucu
Service/Ingress manifestini etkiler — 162.1 in HANDOFF notunu OKU.

FAZ-6'NIN KONUSU: CANLIDA AYAKTA KALMAK (§D124). Faz-5 ürünün DOĞRU olmasını sağladı;
Faz-6 HAZIR olmasını sağlar.

SINIR (CLAUDE.md): production deploy / DNS / TLS / gerçek secret YOK. Her kalem ya yerelde koşulabilir
ya --dry-run / helm template ile doğrulanabilir olmalı. M-CONTAINER emsali (tm 140): dosyalar depoda,
kubectl apply YOK. Mock sağlayıcıları gerçeğe çekmek de KAPSAM DIŞI.
Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-IAC** (türetilmiş — NFR-R1 · MASTER-PROMPT teslim paketi). Gereksinim satırı: `grep -n "| M-IAC" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-IAC" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
<info added on 2026-08-28T21:44:37.973Z>
Based on my analysis of the codebase, I can now generate the update text to be appended to task 164's details:

M-SCALE-a (tm 162.1) SONUCU — MANIFEST İÇİN BAĞLAYICI (tam gerekçe: PLAN §D136, kanıt: PLAN #### KM-SCALE):

STICKY SESSION GEREKMİYOR. Service'te `sessionAffinity: None` kalacak — ne `ClientIP` ne çerez tabanlı yapışkanlık gerekiyor. Kurulu bir WebSocket'i hiçbir oturum yapışkanlığı taşıyamaz; onu TCP'nin kendisi sabitliyor.

INGRESS GEREKSİNİMLERİ (yapışkanlık DEĞİL):
1. WebSocket upgrade geçişi: `/v1/agent/rtm/ws` ve `/v1/customer/rtm/ws` yolları için (RTM_PATHS, packages/types/src/rtm.ts:31-34).
2. Boşta-kalma zaman aşımı: RTM'in 15 sn ping aralığından (`RTM_LIMITS.pingIntervalMs = 15_000`, packages/types/src/rtm.ts:41) UZUN olmalı — aksi halde sağlıklı soketler ara katmanda kesilir. Sunucu zaten `idleTimeoutMs: 30_000` (packages/types/src/rtm.ts:42) kullanıyor; Ingress'in read/send timeout'u en az bu kadar olmalı.

ÖLÇÜMÜN DAYANAĞI (apps/api/test/integration/two-pod.test.ts, dördü de çapraz pod ÇALIŞIYOR):
- Olay teslimi: api-B'ye atılan olay rtm-A ve rtm-B'ye ulaşıyor (satır 289-332).
- Okuma imleci: `POST /chats/:id/seen` api-B'de, `unread_count` api-A'da 1→0 (satır 360-377).
- Varlık: `PUT /agents/me/routing-status` api-B'de, api-A'dan okunuyor + rtm-A'ya push düşüyor (satır 379-404).
- Yazma çakışması: rtm-A + rtm-B'deki iki ajan `agent_conflict_warning` alıyor (satır 407-439).
- Modül düzeyinde durum: yalnız sabitler + memoize Intl.DateTimeFormat; örnek düzeyinde tek koleksiyon Scheduler'ın kendi iş tablosu (süreç-yerel, Redis kilidiyle koordine).

ZAMANLAYICI (satır 461-577): iki gerçek API süreci aynı aralıkta TEK lider seçiyor (`['ok','skipped']`). `replicas > 1` güvenli — HPA/PDB yazarken API replikasını 1'e sabitlemek GEREKMEZ.

HENÜZ ÖLÇÜLMEDİ (manifest'i buna göre temkinli yaz): pod başına bağlantı/havuz bütçesi tm 162.2'nin, read-replica dikişi tm 162.3'ün işi; ikiden fazla pod ve tek makineden büyük ölçek hiç ölçülmedi.

Yeniden koşulabilir kanıt: `cd apps/api && npx tsx scripts/with-test-datastores.ts vitest run test/integration/two-pod.test.ts`
</info added on 2026-08-28T21:44:37.973Z>

**Test Strategy:**

Dört alt-görev done. Ölçülebilir:
1. helm template exit 0 ve geçerli YAML üretiyor.
2. kubectl --dry-run=client ile manifestler kabul ediliyor (küme YOK, yalnız istemci doğrulaması).
3. Probe lar /health/live ve /health/ready e bakıyor; migration stratejisi kararı yazılı.
4. README de "Deployment" bölümü var ve deploy EDİLMEDİĞİ açıkça yazılı.
5. PLAN §7.2 M-IAC → "✅ → KM-IAC".

## Subtasks

### 164.1. M-IAC-a [SONNET-XHIGH] infra/helm/siyahtus iskeleti: api/rtm/web/widget Deployment + Service + ConfigMap + Secret şablonu; helm template ile doğrulanır

**Status:** done  
**Dependencies:** None  

Dört uygulamanın dağıtım manifesti depoda.

**Details:**

NE YAPILACAK: infra/helm/siyahtus/ altında bir Helm chart iskeleti.
- Chart.yaml · values.yaml · templates/ (dört uygulama için Deployment + Service, ConfigMap,
  Secret ŞABLONU — gerçek secret İÇERMEZ).
- İmaj adları M-CONTAINER ın (tm 140) ürettiği dört imajla eşleşmeli:
  apps/api/Dockerfile · apps/rtm/Dockerfile · apps/web/Dockerfile · apps/widget/Dockerfile.
- Ortam değişkenleri ConfigMap ten (secret olmayanlar) ve Secret ten (JWT_SIGNING_KEY ·
  WEBHOOK_HMAC_SEED · CUSTOMER_TOKEN_SECRET · UPLOAD_SIGNING_KEY · AUDIT_CHAIN_SECRET ·
  DATABASE_URL · DATABASE_APP_URL · REDIS_URL) beslenir.
- Postgres ve Redis chart a DAHİL EDİLMEZ (yönetilen servis varsayımı); bağlantı dizeleri değer olarak gelir.
  Bu bir karardır — values.yaml a yorum olarak yaz.

DOSYALAR: infra/helm/siyahtus/ (yeni) · .prettierignore (Helm şablonları Go template sözdizimi taşır ve
prettier onları bozabilir — gerekirse ignore et; format:check kapısı YEŞİL kalmalı).
REFERANS: docker-compose.full.yml — hangi servisin hangi env i aldığı, healthcheck bağımlılık zinciri
ve init servisi orada yazılı; chart onun dağıtım karşılığıdır.
apps/api/docker-entrypoint.sh — entrypoint bugün migrate deploy koşuyor; 164.3 bunu tartışacak.

TUZAKLAR:
1. format:check kapısı yaml dosyalarını da kapsıyor (**/*.{...,yaml,yml}). Helm şablonları
   {{ }} taşıdığı için prettier onları geçersiz sayabilir — .prettierignore a ekle ve GEREKÇESİNİ yaz.
2. GERÇEK SECRET KOYMA. Secret şablonu yalnız anahtar adlarını taşır; değerler values dosyasından
   ya da dış bir secret yöneticisinden gelir (164.4 te belgelenir).
3. kubectl ya da helm bu makinede kurulu OLMAYABİLİR (make de değildi). Kuruluysa koş; değilse
   doğrulamayı bir konteyner içinde yap ve nasıl yaptığını HANDOFF a yaz (tm 143 ün make -n emsali).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-IAC** (türetilmiş — MASTER-PROMPT teslim paketi). Gereksinim satırı: `grep -n "| M-IAC" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-IAC" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 164.2. M-IAC-b [SONNET-XHIGH] Probe / kaynak / ölçek: liveness→/health/live · readiness→/health/ready · requests+limits · HPA (CPU + RTM bağlantı metriği notu) · PodDisruptionBudget

**Status:** done  
**Dependencies:** 164.1, 160.1  

Pod lar doğru sorulara göre yönetiliyor.

**Details:**

NE YAPILACAK: chart a operasyonel alanlar eklenir.
- livenessProbe → GET /api/v1/health/live (bağımlılıksız). Postgres düştüğünde pod ÖLDÜRÜLMEMELİ.
- readinessProbe → GET /api/v1/health/ready. Bağımlılık düşünce pod rotasyondan çıkar.
- startupProbe: migration/boot süresini tolere edecek biçimde (init gecikmesi).
- resources.requests/limits: her uygulama için makul başlangıç değerleri + gerekçe yorumu.
- HorizontalPodAutoscaler: api ve web için CPU tabanlı. RTM İÇİN CPU YANLIŞ METRİKTİR —
  RTM in yükü açık bağlantı sayısıdır (NFR-P8). CPU HPA sı koy ama yorumda bunun bir vekil olduğunu
  ve doğru metriğin tm 163.2 nin ürettiği bağlantı sayısı olduğunu yaz.
- PodDisruptionBudget: yeniden dağıtım sırasında en az bir replikanın ayakta kalması
  (tm 160.2 nin zarif drenajıyla birlikte anlamlı).

DOSYALAR: infra/helm/siyahtus/templates/ · values.yaml.
BAĞIMLILIK: tm 160.1 in /health/live ve /health/ready uçları OLMADAN bu alt-görev yapılamaz —
bugünkü tek /health bağımlılıklara dokunuyor ve liveness için YANLIŞ uçtur.
AYRICA tm 162.1 in sticky session sonucunu OKU (HANDOFF): gerekiyorsa Service/Ingress e
sessionAffinity eklenir ve gerekçesi yazılır.

TUZAK: kaynak sınırları uydurma sayılar olacak (yük ölçümü tm 161 de). Değerleri BAŞLANGIÇ olarak
işaretle ve 161.4 ün ölçümünden sonra gözden geçirilmesi gerektiğini values.yaml a yorum olarak yaz.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-IAC** (türetilmiş — NFR-R1). Gereksinim satırı: `grep -n "| M-IAC" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-IAC" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 164.3. M-IAC-c [OPUS-XHIGH] Migration stratejisi KARARI: migrate deploy init-container mı Job mu · çok replikada yarış · geri alınamaz migration politikası — karar + manifest

**Status:** done  
**Dependencies:** 164.1  

Şema göçü çok replikalı bir dağıtımda güvenli.

**Details:**

NE YAPILACAK: bir karar ve onun manifesti.
BUGÜNKÜ DURUM: apps/api/docker-entrypoint.sh her konteyner başlangıcında prisma migrate deploy
koşuyor. Tek konteynerde sorunsuz; ÜÇ REPLİKALI bir dağıtımda üç süreç aynı anda migration koşar.
Prisma nın kendi kilidi bunu tolere eder ama sonuç yine de gözden geçirilmeli.

KARAR VERİLECEK ÜÇ SORU (her birinin cevabı ve GEREKÇESİ yazılır):
1. Migration nerede koşar: her pod un init-container ı mı, tek seferlik bir Job mu, yoksa entrypoint
   olduğu gibi mi kalır? (Job en yaygın ve en açık olanıdır: dağıtım sırası netleşir.)
2. Yarış: iki migration aynı anda başlarsa ne olur? Prisma nın advisory lock davranışı ÖLÇÜLÜR
   (iki süreçle deneyerek), varsayılmaz.
3. Geri alınamaz migration politikası: sütun silen / tip daraltan bir migration, eski sürüm pod lar
   hâlâ ayaktayken koşarsa onları kırar. Kural yazılır (ör. genişlet-sonra-daralt / iki aşamalı dağıtım)
   ve CONVENTIONS ya da README ye eklenir.

NEDEN OPUS-XHIGH: bu bir dağıtım tasarımı kararı ve yanlışı veri kaybına ya da kesintiye yol açar.

DOSYALAR: infra/helm/siyahtus/templates/ (Job ya da init-container) · apps/api/docker-entrypoint.sh
(değişecekse) · docker-compose.full.yml (init servisi — YEREL yığında zaten tek atımlık bir init var,
onun emsalini OKU) · README ya da CONVENTIONS (politika).
REFERANS: docker-compose.full.yml in init servisi — migrate + seed i tek atımlık koşuyor ve
diğer servisler ona bağlı. Kubernetes karşılığı budur.

TUZAK: seed PRODUCTION DA KOŞMAMALI. Yerel init hem migrate hem seed yapıyor; manifest yalnız
migrate yapmalı ve bu ayrım açıkça yazılmalı.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-IAC** (türetilmiş — NFR-R5 · dağıtım güvenliği). Gereksinim satırı: `grep -n "| M-IAC" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-IAC" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 164.4. M-IAC-d [SONNET-XHIGH] values.production.example.yaml + secret şablonları + kubectl --dry-run=client doğrulaması + README "Deployment" bölümü (deploy EDİLMEDİĞİ açıkça yazılı)

**Status:** done  
**Dependencies:** 164.2, 164.3  

Manifestler kullanılabilir ve sınırı yazılı.

**Details:**

NE YAPILACAK:
1. values.production.example.yaml: gerçek bir dağıtımın doldurması gereken her değer, tek satır
   gerekçesiyle. Gerçek secret YOK — "<dış secret yöneticisinden>" biçiminde talimat.
2. Secret sağlama yolu belgelenir: chart Secret şablonunu üretir ama değerler nereden gelir
   (Kubernetes Secret · dış secret yöneticisi · CI). Bir yol ÖNERİLİR, gerekçesiyle.
3. Doğrulama: helm template | kubectl apply --dry-run=client -f - komutunun exit 0 verdiği gösterilir.
4. README ye "Deployment" bölümü: chart nasıl render edilir, ne DOĞRULANMIŞTIR ve — en önemlisi —
   NE DOĞRULANMAMIŞTIR. Açıkça yaz: bu manifestler HİÇBİR KÜMEYE UYGULANMADI; TLS, DNS, ingress
   sertifikası ve gerçek secret bu deponun sınırı dışındadır (CLAUDE.md). README nin
   "This is a local stack, not a deployment" cümlesiyle aynı dürüstlük seviyesini koru.

DOSYALAR: infra/helm/siyahtus/values.production.example.yaml · README.md · .gitignore
(values.production.example.yaml ın ignore edilmediğini DOĞRULA — .env.* deseni bunu yakalamaz ama
secrets/ deseni ve *.key/*.pem desenleri var; yine de git status ile kontrol et).
REFERANS: tm 159.3 ün .env.production.example i — aynı ton, aynı "gerçek secret yok" disiplini.

TUZAK: README nin mevcut "Run the whole stack in containers" bölümüyle ÇELİŞMEMELİ; o yerel yığını,
bu dağıtım manifestlerini anlatır. İkisini birbirine referansla ayır.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-IAC** (türetilmiş — MASTER-PROMPT teslim paketi). Gereksinim satırı: `grep -n "| M-IAC" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-IAC" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
