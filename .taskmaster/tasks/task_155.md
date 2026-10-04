# Task ID: 155

**Title:** M-SEC-c — M-SEC denetiminin beş LOW bulgusu: rate-limit sırası · mobil restore() tek-uçuş · sanitizeAuditMetadata derinliği · EC sertifika tabanı · SCIM koltuk tavanı (§D116)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** tm 142 (M-SEC-a) STRIDE denetiminin beş LOW bulgusu CONVENTIONS §4.1 gereği o turda görevleşmedi ve PLAN §D116 içinde listeli kaldı. Hiçbiri tek başına acil değil ama beşi de gerçek ve hepsi bir pencerelik iş; sahipsiz bırakıldıkları için her denetim turunda yeniden bulunuyorlar. Faz-5 beşini de kapatır.

**Details:**

BULGU KAYNAĞI: PLAN §D116 LOW listesi (tm 142 denetiminin görevleşmemiş payı).
Beş alt-görev birbirinden BAĞIMSIZDIR; sırayla ya da paralel koşulabilir.
Her biri tek pencerelik ve dar kapsamlı — kapsam genişletme (CONVENTIONS §5).

FAZ-5'İN KONUSU: DENETİMİN BULDUĞU YANLIŞ (§D124). Bu faz YENİ ÖZELLİK AÇMAZ — iddia ile kodu
eşitler. Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-SEC-c** (türetilmiş — §D116 LOW bulguları). Gereksinim satırı: `grep -n "| M-SEC-c" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-SEC-c" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

Beş alt-görev done; her biri kendi önce-kırmızı testini taşır.
PLAN §7.2 M-SEC-c satırı "✅ → KM-SEC-c"; §D116 nın LOW listesine "kapandı → tm 155.x" notu düşülür.

## Subtasks

### 155.1. M-SEC-c1 [OPUS-XHIGH] Kimlik doğrulama onRequest ↔ hız sınırı preHandler sırası: geçersiz bearer seli istek başına bir auth_resolve_token sorgusu ödetmesin

**Status:** done  
**Dependencies:** None  

Kimliği geçersiz istek yığını artık veritabanına ulaşmıyor.

**Details:**

NE YAPILACAK (§D116 LOW/1): bugün kimlik doğrulama onRequest kancasında
(apps/api/src/plugins/auth.ts), hız sınırı ise preHandler da (apps/api/src/plugins/rate-limit.ts).
Fastify yaşam döngüsünde onRequest preHandler dan ÖNCEDİR — yani geçersiz bir bearer token seli,
hız sınırına takılmadan önce istek başına bir auth_resolve_token sorgusu harcatıyor.
Çözüm: kimliği doğrulanamayan / anonim istekler için sınırın auth tan ÖNCE değerlendirilmesi.
Kimlikli isteklerin hesap-bazlı sınırı (ADR-07: agent 180/dk) bugünkü yerinde kalabilir —
çünkü o sınır kimliği bilmeyi gerektirir. Yani iki kova iki farklı aşamada olabilir; kararı gerekçesiyle yaz.

DOSYALAR: apps/api/src/plugins/auth.ts (onRequest kancası) · apps/api/src/plugins/rate-limit.ts
(anon kovası ve preHandler kaydı) · ilgili integration testleri.

TUZAKLAR:
1. Kanca sırasını değiştirmek TÜM rotaları etkiler — 429/401 sırası değişirse mevcut testler kırılır.
   Hangi durumda hangi kodun döneceğini önce yaz, sonra uygula.
2. ADR-07 in sözleşmesi korunmalı: her 429 Retry-After + X-RateLimit-* taşır.
3. /health ve public uçların davranışı bozulmamalı (151.2 ile çakışabilir — o görev anon /health
   sınırına dokunuyor; hangisi sonra koşarsa diğerinin kararını korumalı).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-SEC-c** (türetilmiş — §D116 LOW/1). Gereksinim satırı: `grep -n "| M-SEC-c" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-SEC-c" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 155.2. M-SEC-c2 [SONNET-XHIGH] Mobil restore() tek-uçuş muhafızını atlıyor: #rotate doğrudan çağrılıyor, eşzamanlı refresh aile iptaline yol açabiliyor

**Status:** done  
**Dependencies:** None  

Mobil oturum tazeleme yarışı artık hesabı kilitlemiyor.

**Details:**

NE YAPILACAK (§D116 LOW/2): apps/mobile/src/auth/session.ts içindeki restore() metodu,
tek-uçuş (single-flight) muhafızını atlayarak #rotate ı DOĞRUDAN çağırıyor.
Eşzamanlı bir refresh() aynı refresh token ı ikinci kez sunar; sunucu bunu token hırsızlığı sayar
ve refresh ailesini iptal eder (oauth-service.ts in rotasyon savunması) — kullanıcı sebepsiz çıkış yer.
Çözüm: restore() de aynı muhafızlı yolu kullanmak.

DOSYALAR: apps/mobile/src/auth/session.ts (restore + #rotate + tek-uçuş muhafızı) + testleri.
REFERANS: aynı dosyadaki refresh() — muhafızı DOĞRU kullanan kardeş yol.

TUZAKLAR:
1. Bugün dar bir kusur: unknown durumunda yalnız splash monteli (RootNavigator), yani yarış nadiren
   oluşuyor. Yine de düzeltilir — 152 (2FA) ve ileride push ile açılış yolları bu dar pencereyi genişletebilir.
2. apps/mobile testleri jest ile koşar ve tsconfig node tiplerini taşır; jest.mock fabrikası yerel bir
   const a KAPANMAMALI (hoisting kuralı) — mevcut testlerin desenine bak.
3. Eşzamanlılık testi zamanlayıcıya değil, iki promise in aynı anda başlatılmasına dayanmalı.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-SEC-c** (türetilmiş — §D116 LOW/2). Gereksinim satırı: `grep -n "| M-SEC-c" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-SEC-c" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 155.3. M-SEC-c3 [SONNET-XHIGH] sanitizeAuditMetadata derin tarama: iç içe hassas anahtarlar (details.password gibi) bugün aynen yazılıyor

**Status:** done  
**Dependencies:** None  

Denetim kaydı artık iç içe geçmiş sırları da maskeliyor.

**Details:**

NE YAPILACAK (§D116 LOW/3): apps/api/src/services/audit/audit-log.ts içindeki sanitizeAuditMetadata
YALNIZ üst düzey anahtarlara bakıyor; {details: {password: ...}} biçimindeki iç içe bir yapı
denetim kaydına AYNEN yazılıyor. Fonksiyon özyinelemeli hale getirilir (derinlik sınırı ve döngü koruması ile).

DOSYALAR: apps/api/src/services/audit/audit-log.ts (sanitizeAuditMetadata) + testleri.
REFERANS: apps/api/src/lib/log-redact.ts — log tarafında zaten var olan maskeleme listesi;
anahtar sözlüğünü ORADAN al ya da ortak bir yere çıkar, iki liste tutup birbirinden kaydırma.

TUZAKLAR:
1. Derinlik sınırı ve dairesel referans koruması olmalı (denetim yazımı asla asılı kalmamalı).
2. Diziler de taranmalı.
3. Denetim zinciri satır HMAC i metadata üzerinden hesaplanıyorsa maskeleme SIRASI önemlidir —
   maskelenmiş hâli imzalanmalı ki doğrulama tutarlı olsun. Mevcut zincir testleri yeşil kalmalı.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-SEC-c** (türetilmiş — §D116 LOW/3). Gereksinim satırı: `grep -n "| M-SEC-c" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-SEC-c" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 155.4. M-SEC-c4 [SONNET-XHIGH] inspectIdpCertificate EC eğri tabanı zorlaması: küçük eğrili bir EC sertifikası bugün geçiyor

**Status:** done  
**Dependencies:** None  

IdP sertifikası artık zayıf eğrilerle kabul edilmiyor.

**Details:**

NE YAPILACAK (§D116 LOW/4): apps/api/src/lib/sso-connection.ts içindeki inspectIdpCertificate
modül tabanını YALNIZ RSA / RSA-PSS / DSA için zorluyor; EC anahtarlar için eğri kontrolü yok,
yani küçük eğrili (zayıf) bir EC sertifikası kabul ediliyor.
Çözüm: EC için izin verilen eğri listesi (P-256 ve üstü) ve dışındakinin reddi + anlamlı hata mesajı.

DOSYALAR: apps/api/src/lib/sso-connection.ts (inspectIdpCertificate) + sso-connection.test.ts.
REFERANS: aynı fonksiyondaki RSA modül tabanı kontrolü — aynı biçimde, aynı hata zarfıyla.

TUZAKLAR:
1. Node un KeyObject asymmetricKeyDetails alanı EC için namedCurve verir; sürüm farklarına dikkat.
2. Mevcut e2e sso.spec.ti nin mock IdP sertifikası hangi algoritmayı kullanıyor — kırma.
3. Hata mesajı sertifikanın içeriğini SIZDIRMAMALI; mevcut hata zarfı desenine uy (ADR-06).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-SEC-c** (türetilmiş — §D116 LOW/4). Gereksinim satırı: `grep -n "| M-SEC-c" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-SEC-c" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 155.5. M-SEC-c5 [SONNET-XHIGH] SCIM koltuk tavanı: applySeatEffect koltuk sayısını tavansız yükseltiyor, bir konnektör faturayı gözetimsiz büyütebiliyor

**Status:** done  
**Dependencies:** None  

SCIM sağlama artık plan tavanını aşamıyor.

**Details:**

NE YAPILACAK (§D116 LOW/5): apps/api/src/routes/scim.ts içindeki applySeatEffect koltuk sayısını
tavansız yükseltiyor. Bu KASITLIYDI (denetim öyle yazıyor) ama gözetimsiz bir konnektör faturayı
büyütebilir. Entitlement tavanı uygulanır ve aşımda limit_reached hata tipiyle reddedilir.

DOSYALAR: apps/api/src/routes/scim.ts (applySeatEffect) · apps/api/src/lib/entitlements.ts
(tavan kaynağı) · scim.test.ts.
REFERANS: entitlement kapısının diğer kullanımları (plugins/entitlement-gate.ts) ve
limit_reached hata tipinin mevcut kullanımı.

TUZAKLAR:
1. SCIM in RFC yanıt biçimi ADR-06 hata zarfından farklıdır — SCIM ucunun kendi hata biçimini koru
   (routes/scim.ts te zaten bir dönüşüm var; ona bak).
2. Tavan aşımı kısmi başarı yaratmamalı: bir grup üyeliği yazılıp koltuk artışı reddedilmemeli (işlem bütünlüğü).
3. Tavanın nereden geldiğini (plan/entitlement) koda yorum olarak yaz; sabit sayı GÖMME.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-SEC-c** (türetilmiş — §D116 LOW/5). Gereksinim satırı: `grep -n "| M-SEC-c" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-SEC-c" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
