# Task ID: 166

**Title:** M-RUNBOOK — docs/production-checklist.md (her madde bir komut ya da bir kanıt) + docs/runbooks/ (belirti → teşhis komutu → müdahale)

**Status:** done

**Dependencies:** None

**Priority:** low

**Description:** Depoda bugün docs/ dizini yok; belgeler kökte dağınık .md dosyaları hâlinde ve hepsi geliştirme odaklı. Canlıya çıkacak bir kişinin okuyacağı iki şey eksik: çıkış öncesi kontrol listesi ve olay anında bakılacak runbook. Faz-6 nın diğer kalemleri bu iki belgenin İÇERİĞİNİ üretiyor; bu kalem onları toplar.

**Details:**

BULGU KAYNAĞI: 2026-08-23 bağımsız denetimi (§D124, production hazırlığı).
BU KALEM SON SIRADA (low) ÇÜNKÜ İÇERİĞİ DİĞERLERİNDEN GELİR: 159 (konfig) · 160 (ops) · 161 (kapasite)
· 162 (ölçek) · 164 (dağıtım) · 165 (yedek). Onlar bitmeden yazılan bir checklist uydurma olur.
Yine de teknik bağımlılık YAZILMADI — pencere sırası önceliğe bırakılmıştır (low en son koşulur).

FAZ-6'NIN KONUSU: CANLIDA AYAKTA KALMAK (§D124). Faz-5 ürünün DOĞRU olmasını sağladı;
Faz-6 HAZIR olmasını sağlar.

SINIR (CLAUDE.md): production deploy / DNS / TLS / gerçek secret YOK. Her kalem ya yerelde koşulabilir
ya --dry-run / helm template ile doğrulanabilir olmalı. M-CONTAINER emsali (tm 140): dosyalar depoda,
kubectl apply YOK. Mock sağlayıcıları gerçeğe çekmek de KAPSAM DIŞI.
Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-RUNBOOK** (türetilmiş — NFR-M · MASTER-PROMPT teslim paketi). Gereksinim satırı: `grep -n "| M-RUNBOOK" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-RUNBOOK" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

İki alt-görev done. Ölçülebilir:
1. docs/production-checklist.md in HER maddesi ya bir komut ya bir kanıt işaret ediyor (düz temenni yok).
2. docs/runbooks/ altında beş senaryo var ve her biri belirti → teşhis komutu → müdahale yapısında.
3. PLAN §7.2 M-RUNBOOK → "✅ → KM-RUNBOOK".

## Subtasks

### 166.1. M-RUNBOOK-a [SONNET-XHIGH] docs/production-checklist.md — canlıya çıkmadan önce doğrulanacak her madde bir komut ya da bir kanıt

**Status:** done  
**Dependencies:** None  

Çıkış öncesi kontrol listesi koşulabilir.

**Details:**

NE YAPILACAK: docs/production-checklist.md — her satır ya çalıştırılabilir bir komut ya işaret edilen
bir kanıt taşır. "Güvenlik gözden geçirildi" gibi ölçülemeyen madde YAZILMAZ.
Kapsanacak başlıklar (kaynakları Faz-6 nın diğer kalemleridir):
- Konfigürasyon: NODE_ENV=production · beş secret üretilmiş ve dev-only DEĞİL · DATABASE_APP_URL
  ayrı ve siyahtus_app rolü · TRUST_PROXY_HOPS topolojiye göre (tm 159).
- Ops: /health/live ve /health/ready probe ları bağlı · zarif drenaj penceresi ayarlı (tm 160).
- Kapasite: yük testi koşuldu ve sayılar kabul edildi (tm 161) · kaynak sınırları o sayılara göre (tm 164.2).
- Ölçek: iki-pod doğrulaması geçti · sticky session kararı uygulandı (tm 162).
- Dağıtım: manifestler dry-run dan geçti · migration stratejisi seçildi (tm 164).
- Yedek: yedekleme zamanlandı VE geri yükleme provası koşuldu (tm 165) — ikincisi olmadan birincisi sayılmaz.
- Gözlemlenebilirlik: OTEL_EXPORTER ayarlı, collector erişilebilir (tm 163).
- Uyum: retention politikası gözden geçirildi, RETENTION_ENABLED bilinçli olarak açıldı/kapatıldı.
- KAPSAM DIŞI OLANLAR AÇIKÇA: TLS/DNS sertifikası · gerçek sağlayıcılar · SOC2/ISO/BAA süreçleri.
  Bunlar "yapılmadı" değil "bu deponun dışında" diye işaretlenir (§D97 KOD/SÜREÇ ayrımı).

DOSYALAR: docs/production-checklist.md (yeni; docs/ dizini de yeni) · README (referans linki).
REFERANS TON: README nin "This is a local stack, not a deployment" dürüstlüğü ve PLAN §F.1 in
"her madde ölçülür, tahmin edilmez" disiplini.

TUZAK: bu belge Faz-6 nın diğer kalemleri bitmeden yazılırsa uydurma olur. Koşulduğunda hangi
kalemlerin bitmiş olduğunu KONTROL ET; bitmemiş bir kalemin maddesini "beklemede (tm N)" diye işaretle,
sahte bir onay kutusu koyma.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-RUNBOOK** (türetilmiş — NFR-M). Gereksinim satırı: `grep -n "| M-RUNBOOK" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-RUNBOOK" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 166.2. M-RUNBOOK-b [SONNET-XHIGH] docs/runbooks/ — DB düştü · Redis düştü · webhook kuyruğu şişti · RTM bağlantı fırtınası · kiracı izolasyonu şüphesi; her biri belirti → teşhis komutu → müdahale

**Status:** done  
**Dependencies:** 166.1  

Olay anında bakılacak belgeler var.

**Details:**

NE YAPILACAK: docs/runbooks/ altında beş senaryo, her biri AYNI yapıda:
BELİRTİ (ne görünür) → TEŞHİS (hangi komut/sorgu koşulur) → MÜDAHALE (ne yapılır) → SONRASI (ne kaydedilir).

1. postgres-down.md: /health/ready 503, api 5xx. Teşhis: health çıktısı, bağlantı havuzu, pg logları.
   Müdahale: readiness zaten rotasyondan çıkarır; veritabanı dönünce pod lar kendiliğinden hazır olur.
2. redis-down.md: presence/rate-limit/fan-out etkilenir. ÖNEMLİ: bazı yollar FAIL-CLOSED tasarlandı
   (SAML replay muhafızı Redis düşerse reddeder) — bunu yaz, çünkü "her şey durdu" paniğini önler.
3. webhook-backlog.md: webhook_deliveries şişti. Teşhis: bekleyen satır sayısı, attempt dağılımı.
   Müdahale: WEBHOOK_MAX_ATTEMPTS ve backoff penceresi; webhook.delivery_exhausted denetim kayıtları.
   NOT: bu sweep in CLI karşılığı YOK (README bunu gerekçesiyle yazıyor) — elle koşmaya çalışma.
4. rtm-connection-storm.md: bağlantı sayısı fırlıyor. Teşhis: tm 163.2 nin metrikleri, kopma nedenleri.
   Müdahale: HPA, ADR-07 sınırları, sticky session durumu.
5. tenant-isolation-suspicion.md: çapraz-kiracı veri şüphesi. Teşhis: RLS kapsamı sorgusu
   (tm 150 nin partisyonları dahil), audit log, hangi rolle bağlanıldığı (siyahtus_app mi sahip mi).
   Müdahale: erişimi kes, denetim zincirini doğrula, kanıtı sakla.

DOSYALAR: docs/runbooks/*.md (beş dosya) · docs/production-checklist.md (referans) · README (link).
KAYNAKLAR (oku, uydurma): README nin "Background jobs" bölümü (sweep davranışları, retention ın
neden varsayılan kapalı olduğu, webhook backoff u) · apps/api/src/routes/health.ts (teşhis çıktısı) ·
PLAN §D116 nın "fail-closed" notları · tm 163.2 nin metrik adları.

TUZAK: runbook lar GERÇEK komutlar içermeli ve o komutlar bu depoda çalışmalı (make psql · curl
health · docker compose logs). Çalışmayan bir komut runbook u olaydan daha zararlı yapar —
yazdığın her komutu bir kez KOŞ.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-RUNBOOK** (türetilmiş — NFR-M). Gereksinim satırı: `grep -n "| M-RUNBOOK" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-RUNBOOK" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
