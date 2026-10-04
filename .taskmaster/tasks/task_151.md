# Task ID: 151

**Title:** M-SEC-b — M-SEC denetiminin iki MEDIUM bulgusu: SSO/SCIM JIT sağlamanın doğrulanmamış e-posta güveni · anonim /health bilgi sızıntısı (§D116)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** tm 142 (M-SEC-a) STRIDE denetimi iki HIGH bulmuş ve ikisi de kapatılmıştı (tm 145/146). Aynı denetimin iki MEDIUM bulgusu ise CONVENTIONS §4.1 gereği o turda görevleşmemiş, PLAN §D116 içinde listeli kalmıştı. Faz-5 onları ödüyor. (a) SSO ve SCIM JIT sağlama, IdP/konnektörün bildirdiği HER e-posta adresine güveniyor — doğrulanmış alan bağı yok; kendi IdP sini kuran bir çalışma alanı başka birinin var olan hesabını kendi kiracısına iliştirebiliyor ya da hiç kaydolmamış bir adres için hesap satırı işgal edebiliyor. (b) GET /api/v1/health anonim çağırana bölgeyi, sürümü, her dikişin hangi mock ile koştuğunu ve scheduler durumunu veriyor, üstelik her çağrı sınırsızca bir Postgres sorgusu ve bir Redis PING harcıyor.

**Details:**

BULGU KAYNAĞI: PLAN §D116 MEDIUM (a) ve (b) — tm 142 denetiminin görevleşmemiş payı.
Bu iki bulgu bugün depoda YAZILI ama SAHİPSİZ; Faz-5 sahibini veriyor.
İkisi de bağımsız, iki ayrı nanotask.

FAZ-5'İN KONUSU: DENETİMİN BULDUĞU YANLIŞ (§D124). Faz 0–4 kalemleri tek tek ✅ ve testli;
2026-08-23 bağımsız denetimi yine de dokuz bulgu çıkardı ve ortak şekilleri şu: bir damga, onu hak
eden koddan daha geniş bir şey iddia ediyor. Bu faz YENİ ÖZELLİK AÇMAZ — iddia ile kodu eşitler.
Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-SEC-b** (türetilmiş — NFR-S1/S4/S12; kaynak PLAN §D116 MEDIUM). Gereksinim satırı: `grep -n "| M-SEC-b" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-SEC-b" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

İki alt-görev done. Ölçülebilir:
1. Doğrulanmamış alanlı bir IdP iddiası ile JIT sağlama reddediliyor (önce-kırmızı testle kanıtlı).
2. Anonim GET /health yanıtı yalnız durum ve servis adı taşıyor; region/version/providers/scheduler yok.
3. scripts/smoke.sh ve docker-compose.full.yml healthcheck bacakları hâlâ yeşil (make demo kırılmadı).
4. PLAN §7.2 M-SEC-b satırı "✅ → KM-SEC-b".

## Subtasks

### 151.1. M-SEC-b1 [OPUS-MAX] SSO/SCIM JIT sağlama doğrulanmış alan bağı ister: sso_connections.verified_domains + var olan hesabı yabancı kiracıya iliştirme kapanır

**Status:** done  
**Dependencies:** None  

Bir IdP artık yalnız kendi doğruladığı alanın kullanıcılarını sağlayabiliyor.

**Details:**

NE YAPILACAK (§D116 MEDIUM (a)): JIT sağlama yolunun e-posta güvenine bir sınır konur.
1. sso_connections tablosuna doğrulanmış alan listesi eklenir (migration + kontrat + Settings UI alanı).
2. auth_provision_sso_account ve scim_provision_member yalnız o alanlara ait adresleri sağlar;
   dışarıdaki adres reddedilir ve reddin denetim kaydı yazılır.
3. "Var olan hesabı bu kiracıya üye yap" davranışı ile "yeni hesap yarat" davranışı AYRIŞTIRILIR:
   var olan bir hesabın yabancı bir kiracıya iliştirilmesi artık doğrulanmış alan olmadan olmaz.

DOSYALAR (denetimin işaret ettiği yerler):
- apps/api/prisma/migrations/20260814090000_sso_sp_endpoints/migration.sql:116 → auth_provision_sso_account
- aynı ailedeki scim_provision_member fonksiyonu
- apps/api/src/lib/sso-connection.ts (bağlantı okuma/yazma + doğrulama yüzeyi)
- apps/api/src/routes/saml.ts · apps/api/src/routes/scim.ts (çağıranlar)
- apps/web/src/features/settings/SsoConnection.tsx (alan listesi girişi)
- Kontrat: packages/contract/openapi/paths/settings.yaml (SSO bağlantı şeması)

REFERANS DESEN: aynı ailede sertifika rotasyonu (previous_certificate_pem + expires_at) —
bir güvenlik alanının şemaya, kontrata ve UI ye birlikte nasıl eklendiğini gösterir.

TUZAKLAR:
1. GERİYE UYUMLULUK: bugün doğrulanmış alanı olmayan bağlantılar var (seed + e2e sso.spec.ts).
   Boş liste "her alana izin ver" anlamına GELMEMELİ (fail-open olur) — ama var olan e2e akışını da
   kırmamalısın. Doğru cevap: migration mevcut bağlantılara bugünkü kullanıcılarının alanını yazar
   (veri türetimi), yeni bağlantılarda alan zorunlu olur. Seçtiğin yolu gerekçesiyle §D ye yaz.
2. Alan karşılaştırması büyük/küçük harf duyarsız ve tam eşleşme olmalı; alt alan (subdomain)
   otomatik kabul EDİLMEMELİ — "acme.com" doğrulandı diye "evil.acme.com.attacker.net" geçmemeli.
3. ÖNCE KIRMIZI: doğrulanmamış alanlı bir assertion ile sağlamanın bugün BAŞARILI olduğunu gösteren
   test önce yazılır ve kırmızı koşulur; düzeltmeden sonra yeşile döner.
4. SCIM tarafı unutulmasın — denetim iki yüzeyi birden işaret ediyor.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-SEC-b** (türetilmiş — §D116 MEDIUM (a)). Gereksinim satırı: `grep -n "| M-SEC-b" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-SEC-b" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 151.2. M-SEC-b2 [SONNET-XHIGH] /health anonim yanıtı daraltılır: bölge/sürüm/sağlayıcı/scheduler yalnız kimlikli admin e; anonim yola yüksek tavanlı sınır

**Status:** done  
**Dependencies:** None  

Sağlık ucu artık altyapıyı anonim çağırana anlatmıyor.

**Details:**

NE YAPILACAK (§D116 MEDIUM (b)): GET /api/v1/health bugün public + skipRateLimit ve yanıtında
region, version, dependencies (gecikmeler dahil), scheduler durumu ve hangi dikişin hangi mock ile
koştuğu (providers) var. Anonim yanıt yalnız {status, service} taşıyacak biçimde daraltılır;
ayrıntılı gövde kimlikli VE admin rolündeki çağırana verilir.
Anonim yol sınırsız kalmaz: probe u öldürmeyecek kadar YÜKSEK tavanlı bir IP sınırı konur
(mevcut rate-limit eklentisinin anon kovası deseni).

DOSYALAR: apps/api/src/routes/health.ts (public + skipRateLimit yapılandırması ve yanıt gövdesi) ·
apps/api/src/plugins/rate-limit.ts (anon kova deseni) ·
packages/contract/openapi/paths/health.yaml (yanıt şeması iki biçime ayrılır).

ZORUNLU EŞ GÜNCELLEME — yoksa make demo kırılır:
- scripts/smoke.sh: "api /health is ok" ve scheduler kontrolü daraltılan gövdeye göre güncellenir.
- docker-compose.full.yml ve apps/api/Dockerfile · apps/rtm/Dockerfile HEALTHCHECK satırları:
  anonim yanıt hâlâ 200/503 ayrımını verdiği için curl bacağı çalışmalı; kontrol eden alan değişirse düzelt.

TUZAKLAR:
1. Sağlık ucunun ASIL işi kaybolmasın: bağımlılıklar düştüğünde anonim yanıt hâlâ 503 dönmeli
   (orkestratör rotasyondan çıkarabilsin). Daraltma yalnız GÖVDEYİ kısar, durum kodunu değil.
2. RTM in kendi /health i de aynı sınıf bilgi veriyor mu — bak, veriyorsa aynı daraltmayı uygula.
3. Sınır tavanı düşük seçilirse izleme sistemi kendini DDoS etmiş olur; anon kovası için ayrı ve
   yüksek bir tavan kullan, gerekçesini koda yorum olarak yaz.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **M-SEC-b** (türetilmiş — §D116 MEDIUM (b)). Gereksinim satırı: `grep -n "| M-SEC-b" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KM-SEC-b" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
