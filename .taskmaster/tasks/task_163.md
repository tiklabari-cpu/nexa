# Task ID: 163

**Title:** M-OTEL — Telemetri exporter seçim dikişi (console|otlp|none, M-PROV-a deseni) + RTM metrikleri (bağlantı sayısı · fan-out gecikmesi · kopma nedeni)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** NFR-M5 yapılandırılmış log + OpenTelemetry izleme + metrikler istiyor. Kod var: apps/api/src/telemetry/telemetry.ts istek başına span ve request/latency/error metrikleri üretiyor, hepsi request_id ile etiketli. Ama iki eksik var: (1) exporter CONSOLE a sabit — dosyanın kendi yorumu "bu ortamda collector yok" diyerek bunu gerekçelendiriyor, yani bir seçim değil bir varsayım; (2) RTM in kendi telemetrisi YOK — NFR-M5 in saydığı metrikler arasında "RTM bağlantı, event/sn" var ve bugün hiçbiri ölçülmüyor.

**Details:**

BULGU KAYNAĞI: 2026-08-23 bağımsız denetimi (§D124, NFR-M5: OTel var ama yalnız console exporter).
ZEMİN (oku): apps/api/src/telemetry/telemetry.ts yorumu neden console exporter kullandığını yazıyor
ve sağlayıcıları BİLEREK OpenTelemetry global larına kaydetmiyor (test sızıntısını önlemek için).
O tasarım kararına dokunma; yalnız exporter SEÇİMİNİ env e taşı.

BU KALEM GERÇEK BİR COLLECTOR KURMAZ — sağlayıcı seçim dikişi hazırlanır, bağlantı kurulmaz.
Mock → gerçek geçişi bu turun kapsamı dışında (kullanıcı kararı).

FAZ-6'NIN KONUSU: CANLIDA AYAKTA KALMAK (§D124). Faz-5 ürünün DOĞRU olmasını sağladı;
Faz-6 HAZIR olmasını sağlar.

SINIR (CLAUDE.md): production deploy / DNS / TLS / gerçek secret YOK. Her kalem ya yerelde koşulabilir
ya --dry-run / helm template ile doğrulanabilir olmalı. M-CONTAINER emsali (tm 140): dosyalar depoda,
kubectl apply YOK. Mock sağlayıcıları gerçeğe çekmek de KAPSAM DIŞI.
Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-OTEL** (türetilmiş — NFR-M5). Gereksinim satırı: `grep -n "| M-OTEL" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-OTEL" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

İki alt-görev done. Ölçülebilir:
1. OTEL_EXPORTER env i fiilen seçiyor (console | otlp | none); none sessizce ve maliyetsiz çalışıyor.
2. RTM üç metriği üretiyor ve testle kilitli.
3. PLAN §7.2 M-OTEL → "✅ → KM-OTEL"; NFR-M5 satırının RTM payı artık dolu.

## Subtasks

### 163.1. M-OTEL-a [SONNET-XHIGH] Exporter seçim dikişi OTEL_EXPORTER=console|otlp|none (M-PROV-a deseni, tm 131.2) + env paritesi; collector yoksa none sessizce çalışır

**Status:** done  
**Dependencies:** None  

Telemetri hedefi artık yapılandırma, varsayım değil.

**Details:**

NE YAPILACAK: telemetry.ts in exporter seçimi env e taşınır.
- OTEL_EXPORTER: console (bugünkü davranış, varsayılan) | otlp | none.
- otlp seçilirse OTLP HTTP exporter kullanılır ve hedef adresi de env den gelir
  (OTEL_EXPORTER_OTLP_ENDPOINT — OpenTelemetry nin kendi standart anahtarı).
- none seçilirse hiçbir exporter kurulmaz ve telemetri maliyetsiz kapanır.
- Sözlük (vocabulary) exporter fabrikasının YANINDA tanımlanır ve env.ts oradan import eder —
  M-PROV-a nın kuralı: "env in kabul ettiği bir değeri hiçbir fabrika uygulamıyorsa, bu tam olarak
  M-PROV-a nın kapattığı sürüklenmedir; bir liste iki uçtan okunursa sürüklenemez".
- Yeni anahtarlar env.ts ↔ .env.example ↔ turbo.json globalEnv üçlüsüne birden eklenir.

DOSYALAR: apps/api/src/telemetry/telemetry.ts (exporter fabrikası + sözlük) ·
apps/api/src/plugins/telemetry.ts · apps/api/src/config/env.ts · apps/api/src/config/env.test.ts ·
.env.example · turbo.json · apps/api/package.json (OTLP exporter bağımlılığı).
REFERANS DESEN (BİREBİR KOPYALA): apps/api/src/services/mail/mailer.ts in MAIL_PROVIDERS sözlüğü ve
env.ts in onu import edip z.enum(...) e vermesi. Aynısını OTEL_EXPORTER için yap.

TUZAKLAR:
1. Test davranışı DEĞİŞMEMELİ: telemetry testi bugün in-memory exporter enjekte ediyor ve
   NODE_ENV=test te yığın kapalı. Bu yolu koru — env seçimi test enjeksiyonunu EZMEMELİ.
2. otlp bağımlılığı eklenirse bundle/kurulum maliyeti doğar; yalnız api paketine ekle,
   web/widget e sızdırma.
3. env parite nöbetçisi yeni anahtarı üç yerde birden ister — birini unutursan kapı kırmızı.
4. GERÇEK BİR COLLECTOR A BAĞLANMA (kapsam dışı); otlp yolunun doğruluğu birim testiyle
   (fabrika doğru exporter i üretiyor mu) kanıtlanır, canlı bağlantıyla değil.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-OTEL** (türetilmiş — NFR-M5). Gereksinim satırı: `grep -n "| M-OTEL" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-OTEL" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 163.2. M-OTEL-b [SONNET-XHIGH] RTM telemetrisi: eşzamanlı bağlantı sayısı · fan-out gecikmesi · kopma nedeni metrikleri (NFR-M5 in RTM payı bugün yok)

**Status:** done  
**Dependencies:** 163.1  

WebSocket katmanı artık kendini ölçüyor.

**Details:**

NE YAPILACAK: apps/rtm e telemetri eklenir — api dekiyle AYNI desen (kendi Telemetry örneği,
global lara kaydetmeden).
Üç metrik (NFR-M5 in saydıkları):
- Eşzamanlı bağlantı sayısı (gauge / up-down counter).
- Fan-out gecikmesi (histogram): olay üretiminden sokete yazılmasına kadar geçen süre.
  NFR-P1 in bütçesi bu metriktir (p99 < 500 ms) — tm 161.3 yük altında ölçecek, bu metrik
  ÜRETİMDE sürekli görünür kılar.
- Kopma nedeni (counter, etiketli): normal kapanış · protokol ihlali · kimlik zaman aşımı ·
  hız sınırı · sunucu kapanışı (tm 160.2 nin drenajı).
Exporter seçimi 163.1 in dikişini kullanır (aynı env anahtarı).

DOSYALAR: apps/rtm/src/ (yeni telemetri modülü + gateway/dispatcher bağlama) ·
apps/rtm/src/index.ts · apps/rtm package.json (OTel bağımlılıkları) · rtm testleri.
REFERANS: apps/api/src/telemetry/telemetry.ts (yapı) ve apps/api/src/plugins/telemetry.ts (bağlama).
Kopma nedenleri için apps/rtm/src/dispatcher.ts ve protokol limitleri (ADR-07: 10 msg/sn/bağlantı,
15 sn kimlik penceresi) — mevcut kapanış yollarını OKU, tahmin etme.

TUZAKLAR:
1. Metrik etiketleri KİRACI KİMLİĞİ TAŞIMAMALI (kardinalite patlaması + PII). Kopma nedeni gibi
   sınırlı kümeler kullan.
2. Test ortamında telemetri kapalı kalmalı (api deki NODE_ENV=test kuralının kardeşi) —
   106 rtm testi yavaşlamamalı.
3. Fan-out gecikmesi ölçümü sıcak yolda; ölçümün kendisi maliyetli olmamalı.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-OTEL** (türetilmiş — NFR-M5 · NFR-P1). Gereksinim satırı: `grep -n "| M-OTEL" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-OTEL" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
