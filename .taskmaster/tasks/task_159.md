# Task ID: 159

**Title:** M-PROD-CFG — Production konfigürasyonu fiilen çalışır: NODE_ENV=production boot yolu ilk kez koşulur · proxy hop env e · statik sunucu güvenlik profili · .env.production.example

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Zemin iyi: server.ts trustProxy: 1 i gerekçesiyle kuruyor, helmet CSP + CORS production allowlist var, parseEnv production da dev-only- secret ı ve eksik DATABASE_APP_URL i reddediyor. Eksik olan üç şey: (1) bu production yolu HİÇ KOŞULMAMIŞ — konteyner yığını bile bilerek NODE_ENV=development ile çalışıyor, yani reddin gerçekten çalıştığı ölçülmedi; (2) trustProxy hop sayısı koda gömülü ve kendi yorumunda "tam olarak bir güvenilir ters proxy" varsayımını ilan ediyor — gerçek bir dağıtımda CDN + ingress iki hop olabilir ve yanlış sayı IP allow-list i baypas ettirir; (3) web ve widget nginx yapılandırmalarında production güvenlik başlıkları (HSTS, CSP, Referrer-Policy) yok.

**Details:**

BULGU KAYNAĞI: 2026-08-23 bağımsız denetimi (§D124, production hazırlığı bölümü).
Bu kalem YENİ GÜVENLİK MEKANİZMASI KURMAZ — var olanı yapılandırılabilir ve ÖLÇÜLMÜŞ hale getirir.

NEDEN ÖNEMLİ: request.ip üç güvenlik kararını besliyor — anonim hız sınırı, müşteri IP yasağı ve
ajan IP allow-list i (FR-MOD-08.9.6). server.ts in kendi yorumu bunu uzun uzun yazıyor ve
varsayımını açıkça ilan ediyor: "the API is reached through exactly one trusted reverse proxy".
O varsayım bir dağıtımda yanlışsa allow-list sessizce baypas edilir.

FAZ-6'NIN KONUSU: CANLIDA AYAKTA KALMAK (§D124). Faz-5 ürünün DOĞRU olmasını sağladı;
Faz-6 HAZIR olmasını sağlar — konfigürasyon, ops dikişleri, ölçek ölçümü, dağıtım manifestleri, runbook.

SINIR (CLAUDE.md — pazarlık yok): production deploy / DNS / TLS sertifikası / gerçek secret YOK.
Bu fazın HER kalemi ya yerelde koşulabilir ya --dry-run / helm template ile doğrulanabilir olmak
zorundadır. M-CONTAINER emsali (tm 140): dosyalar depoda, kubectl apply YOK.

AYRICA KAPSAM DIŞI: mock sağlayıcıları gerçeğe çekmek (LLM · SMTP · S3 · Stripe · push · SIEM · AV ·
beş mesajlaşma kanalı). Kullanıcı bunu bu turda istemedi. Bir dikişi GERÇEK sağlayıcıya bağlama;
yalnız seçim dikişini hazırla. Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-PROD-CFG** (türetilmiş — NFR-S9 · NFR-S3/S5 · NFR-M). Gereksinim satırı: `grep -n "| M-PROD-CFG" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-PROD-CFG" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

Üç alt-görev done. Ölçülebilir kapanış kanıtı:
1. NODE_ENV=production ile boot yolu integration testiyle kapsanıyor (placeholder secret reddi dahil).
2. Proxy hop sayısı env den geliyor ve yanlış yapılandırmanın IP kararlarını nasıl etkilediği testle kilitli.
3. web + widget nginx yapılandırmaları production güvenlik başlıklarını taşıyor.
4. .env.production.example var ve README de anlatılıyor; PLAN §7.2 M-PROD-CFG "✅ → KM-PROD-CFG".

## Subtasks

### 159.1. M-PROD-CFG-a [OPUS-XHIGH] NODE_ENV=production boot yolu ilk kez fiilen koşulur + integration testi (placeholder secret reddi · DATABASE_APP_URL zorunluluğu · .env dosyası olmadan saf ortam değişkenleriyle ayağa kalkma)

**Status:** done  
**Dependencies:** None  

Production konfigürasyonunun reddettiği şeyleri gerçekten reddettiği ölçüldü.

**Details:**

NE YAPILACAK: apps/api/src/config/env.ts içindeki production dalı bugün YAZILI ama HİÇ KOŞULMAMIŞ.
parseEnv, NODE_ENV=production altında: DATABASE_APP_URL i zorunlu kılıyor (yoksa RLS baypas olur) ve
beş secret in (JWT_SIGNING_KEY · WEBHOOK_HMAC_SEED · CUSTOMER_TOKEN_SECRET · UPLOAD_SIGNING_KEY ·
AUDIT_CHAIN_SECRET) dev-only- ön ekiyle başlamasını reddediyor.
Bu dalı kapsayan integration testleri yazılır:
- production + eksik DATABASE_APP_URL → anlamlı hata (mesaj RLS gerekçesini söylüyor).
- production + dev-only- secret → anlamlı hata (hangi anahtar olduğunu söylüyor).
- production + geçerli konfig → parseEnv başarılı, isProduction true, schedulerEnabled/otelEnabled doğru.
- Sunucu, .env DOSYASI OLMADAN yalnız process.env ile ayağa kalkabiliyor (12-factor) — depoda hiçbir şey
  dotenv çağırmıyor, bu zaten böyle; testle KİLİTLE ki ileride bir dotenv eklenip sessizce bağımlılık doğmasın.

DOSYALAR: apps/api/src/config/env.ts (yalnız OKUMA beklenir; kusur bulursan düzelt) ·
apps/api/src/config/env.test.ts (mevcut parite testleri burada — kardeşlerini oraya ekle) ·
gerekirse apps/api/test/integration/ altında boot testi.
REFERANS DESEN: aynı dosyadaki env.parity.test.ts / env.test.ts — sağlayıcı sözlüklerini .shape
üzerinden sayan mevcut testler; production dalı da aynı disiplinle sınanır.

TUZAKLAR:
1. Test NODE_ENV i global olarak DEĞİŞTİRMEMELİ — parseEnv e sahte bir source nesnesi ver
   (fonksiyon zaten source parametresi alıyor). Global mutasyon diğer süitleri kirletir.
2. Gerçek bir production sunucusu AYAĞA KALDIRMA (gerçek secret yok, CLAUDE.md sınırı);
   ölçülen şey konfigürasyon dalıdır, canlı bir dağıtım değil.
3. RTM in kendi env şeması da var (apps/rtm) — aynı production korumaları orada var mı, ÖLÇ.
   Yoksa bu alt-görevin kapsamındadır (aynı sınıf kusur, aynı dosya ailesi).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-PROD-CFG** (türetilmiş — NFR-M · NFR-S4). Gereksinim satırı: `grep -n "| M-PROD-CFG" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-PROD-CFG" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 159.2. M-PROD-CFG-b [OPUS-MAX] BÖLÜNMEZ: proxy hop sayısı env e (TRUST_PROXY_HOPS) + WEB_ORIGIN çoklu origin + web/widget nginx production güvenlik profili (HSTS · CSP · Referrer-Policy · widget iframe CSP)

**Status:** done  
**Dependencies:** 159.1  

Dağıtım topolojisi değişince güvenlik kararları sessizce bozulmuyor.

**Details:**

NE YAPILACAK: üç yapılandırma yüzeyi.

1. TRUST_PROXY_HOPS (env, varsayılan 1): apps/api/src/server.ts bugün trustProxy: 1 i KODA GÖMÜYOR.
   Yorumu neden 1 olduğunu ve varsayımını açıkça yazıyor ("if that ever changes, this must become
   the proxy address/subnet, not a count"). Env e taşı, varsayılanı 1 tut, .env.example + turbo.json
   globalEnv + env.ts şemasına ekle (M-ENV-a nın parite kuralı).
2. WEB_ORIGIN çoklu origin: CORS bugün production da tek origin e izin veriyor
   (origin: env.isProduction ? [env.WEB_ORIGIN] : true). Gerçek bir dağıtımda panel + hosted chat
   sayfası farklı originler olabilir. Virgülle ayrılmış liste kabul et; boş/hatalı girdi fail-closed olsun.
3. nginx production güvenlik profili: apps/web/nginx.conf ve apps/widget/nginx.conf bugün yalnız
   cache başlıkları taşıyor. Eklenecekler: Strict-Transport-Security · Content-Security-Policy
   (SPA için; widget iframe i için AYRI ve daha dar) · X-Content-Type-Options · Referrer-Policy ·
   X-Frame-Options / frame-ancestors (widget in iframe olarak gömülmesi GEREKİYOR — onu kırma).

NEDEN OPUS-MAX VE BÖLÜNMEZ (§5.1.2 istisnası): request.ip üç güvenlik kararını besliyor —
anonim hız sınırı (plugins/rate-limit.ts), müşteri IP yasağı (lib/banned-ip.ts) ve ajan IP
allow-list i (FR-MOD-08.9.6, IpAllowlist). Hop sayısı yanlışsa proxy-addr EN SOLDAKİ XFF girdisini
döner — yani çağıranın kendi yazdığı değeri — ve allow-list baypas edilir. server.ts in yorumu
bu senaryoyu birebir anlatıyor. Bu bir authZ sınırıdır, bölünmez.

DOSYALAR: apps/api/src/server.ts (trustProxy + cors) · apps/api/src/config/env.ts · .env.example ·
turbo.json (globalEnv) · apps/web/nginx.conf · apps/widget/nginx.conf ·
apps/api/src/config/env.test.ts (parite) · ilgili integration testleri.

TUZAKLAR:
1. WIDGET CSP İ KENDİ İZOLASYONUNU KIRMAMALI: widget cross-origin iframe olarak çalışıyor ve
   README "no allow-same-origin" diyor (NFR-S6). frame-ancestors i widget için AÇIK bırak
   (müşteri sitesine gömülecek), panel için KAPAT. İkisini karıştırmak ya widget i öldürür ya paneli açar.
2. HSTS yalnız HTTPS arkasında anlamlıdır; bu depoda TLS YOK. Başlık yapılandırmada bulunur ama
   yerel http yığınını bozmamalı — profili koşullu yap ve gerekçesini conf dosyasına yorum olarak yaz.
3. CSP yi fazla sıkı yazarsan Vite in ürettiği SPA çalışmaz (inline stil/script). Ölç: make demo
   yığınını kaldır, sayfayı aç, konsolda CSP ihlali OLMADIĞINI gör.
4. env parite nöbetçisi (env.parity.test.ts) yeni anahtarı üç yerde birden ister: env.ts ↔ .env.example
   ↔ turbo.json globalEnv. Birini unutursan kapı kırmızı.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-PROD-CFG** (türetilmiş — NFR-S3/S5/S6/S9). Gereksinim satırı: `grep -n "| M-PROD-CFG" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-PROD-CFG" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 159.3. M-PROD-CFG-c [SONNET-XHIGH] .env.production.example + README "Production configuration": hangi anahtar neden zorunlu, hangisi neden opsiyonel

**Status:** done  
**Dependencies:** 159.1, 159.2  

Canlıya çıkacak kişi hangi değeri neden vermesi gerektiğini okuyabiliyor.

**Details:**

NE YAPILACAK: iki belge.
1. .env.production.example (yeni): .env.example in production kardeşi. Her anahtar için TEK SATIR
   gerekçe: neden zorunlu, ne olursa ne olur. Gerçek secret İÇERMEZ — yer tutucular dev-only- ön ekiyle
   OLMAMALI (parseEnv onları production da reddediyor), bunun yerine "<üret: openssl rand -hex 32>"
   biçiminde talimat olsun.
2. README ye "Production configuration" bölümü: zorunlu anahtarlar tablosu · secret üretme komutları ·
   DATABASE_URL (migration, sahip rolü) ile DATABASE_APP_URL (çalışma zamanı, siyahtus_app) ayrımının
   NEDEN kritik olduğu · TRUST_PROXY_HOPS un dağıtım topolojisine göre nasıl seçileceği ·
   SCHEDULER_ENABLED ve RETENTION_ENABLED in varsayılan davranışı.
README nin mevcut "Environment" ve "Background jobs" bölümleriyle ÇELİŞMEMELİ — onlara referans ver.

DOSYALAR: .env.production.example (yeni) · README.md (yeni bölüm) · .gitignore (yeni dosyanın
yanlışlıkla ignore edilmediğini doğrula — .env.* deseni var, !.env.example istisnası da; yeni dosya
için de istisna gerekiyor).
REFERANS: .env.example in mevcut yorum yoğunluğu (her blok neden orada olduğunu yazıyor) ve
README nin "Notable engineering choices" bölümünün ton u.

TUZAK: .gitignore de .env.* deseni bu dosyayı yakalar. İstisna eklemezsen dosya commit lenmez ve
görev sessizce hiçbir şey teslim etmemiş olur — git status ile DOĞRULA.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6C.` (bul: `grep -n "^## 6C" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-PROD-CFG** (türetilmiş — NFR-M). Gereksinim satırı: `grep -n "| M-PROD-CFG" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-PROD-CFG" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 6 (Hazırlık) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
