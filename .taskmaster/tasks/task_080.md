# Task ID: 80

**Title:** 08.9.6 — IP allowlist / oturum güvenliği  ·  dilim V2-1

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** FR-MOD-08.9.6 · Could (Ent.) · [MAX] ↑ · §7.

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `08.9.6`.

9 atomik alt-görev · ~10 pencere · etiket dağılımı: OPUS-MAX x3 · OPUS-XHIGH x3 · SONNET-XHIGH x3

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  08.9.6-a [SONNET-XHIGH] security_settings oturum politikası kolonları + kontrat/okuma yüzeyi (davranışsız iskelet)  (bağ: —)
  08.9.6-b [OPUS-XHIGH] ip_allowlist_entries tablosu + RLS politikası + IpAllowlistEntry şeması  (bağ: —)
  08.9.6-c [OPUS-MAX] lib/ip-allowlist.ts — CIDR/IP eşleştirme algoritması + izin-ret semantiği (saf, DB'siz)  (bağ: —)
  08.9.6-d [OPUS-XHIGH] /settings/ip-allowlist CRUD (GET/POST/DELETE) + self-lockout guard + audit + path kontratı  (bağ: 08.9.6-b, 08.9.6-c)
  08.9.6-e [OPUS-MAX] IP allowlist enforcement — auth onRequest kapısı + trustProxy taklit yüzeyi + not_allowed/audit  (bağ: 08.9.6-a, 08.9.6-b, 08.9.6-c)
  08.9.6-f [SONNET-XHIGH] PATCH /settings/security — oturum politikası alanlarının yazma yüzeyi (validasyon + audit)  (bağ: 08.9.6-a)
  08.9.6-g [OPUS-MAX] Oturum politikası enforcement — idle timeout (lastUsedAt) + lisans başına eşzamanlı oturum limiti  (bağ: 08.9.6-a, 08.9.6-f)
  08.9.6-h [SONNET-XHIGH] Settings ekranı — IP allowlist bölümü + oturum politikası formu  (bağ: 08.9.6-d, 08.9.6-f)
  08.9.6-i [OPUS-XHIGH] Uçtan uca doğrulama — E2E akışı, audit görünürlüğü, proxy-IP davranışı ve istek başına maliyet notu  (bağ: 08.9.6-d, 08.9.6-e, 08.9.6-g, 08.9.6-h)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): Üç alt-görev bölünmez güvenlik/eşzamanlılık çekirdeğidir ve daha küçüğe ayrılmaz: (1) 08.9.6-c — CIDR/IP eşleştirme algoritması + izin/ret semantiği: bir bit-maske hatası ya bypass (yanlış izin) ya da tüm ajanların kilitlenmesi (yanlış ret) demek; parse, eşleştirme ve "boş liste ne demek" kararı aynı bağlamda kalmalı. (2) 08.9.6-e — enforcement noktası: plugins/auth.ts:130-207 her kimlikli isteğin geçtiği tek çıkış kapısı; hangi principal türünün muaf olduğu, server.ts:97 trustProxy:true yüzünden request.ip'nin X-Forwarded-For ile taklit edilebilir olması ve kontrolün sırası tek bir akıl yürütmedir — parçalanırsa kontrol sessizce anlamsızlaşır. (3) 08.9.6-g — oturum politikası enforcement: token geçerlilik semantiğini değiştirmek authN sınırıdır ve eşzamanlı oturum limiti touch() fire-and-forget yazımı ile resolve() okuması arasındaki yarışı + toplu revoke invariant'ını birlikte ele almayı gerektirir. Bu üç çekirdeğin ETRAFINDAKİ her şey (kolon/kontrat iskeleti -a, tablo+RLS -b, CRUD yüzeyi -d, ayar yazma -f, UI -h, uçtan uca doğrulama -i) ayrı ve daha ucuz etiketli alt-görevlere çıkarıldı; böylece pahalı pencereler mümkün olan en küçük yüzeye indirildi.

VARSAYIMLAR: BOŞ ALLOWLIST = HERKESE İZİN. Kayıt yokken hiçbir kısıt uygulanmaz. Gerekçe: olgularda saptanan self-lockout riski ('boş liste izinli mi engelli mi netleşmeden implementasyona geçilirse tüm agent'ları kilitleme riski var'); yapılandırılmamış bir liste 'kimseye izin yok' anlamına gelemez. Ek olarak ayrı bir ip_allowlist_enforced bayrağı vardır: kayıt eklerken bile kısıt kapalı tutulabilir (güvenli hazırlık yolu). · CIDR DESTEKLENİR. Bir kayıt tekil IPv4/IPv6 adresi ya da CIDR aralığıdır (tekil adres /32 ya da /128 gibi davranır). PRD yalnız 'IP kısıtı' diyor; ofis/VPN aralıkları tekil adresle ifade edilemediği için aralık desteği zorunlu kabul edildi. · ENFORCEMENT NOKTASI: HER KİMLİKLİ İSTEK, LOGIN DEĞİL. Kontrol plugins/auth.ts onRequest hook'unda agent/PAT/bot principal'ları için çalışır; public:true uçlar (login/authorize/token/revoke) muaftır. Gerekçe: v2-04 satır 127 tehdidi 'PAT/Bearer token çalınması ile API'ye taklit erişim' — hedef login değil, çalınmış token'la yapılan API erişimidir; ayrıca public uçların muaf kalması yanlış yapılandırmadan sonra kurtarma yolunu açık tutar. · MÜŞTERİ/WIDGET YÜZEYİ MUAF. principal.kind === 'customer' istekleri IP allowlist'e tabi değildir; o yüzeyin IP denetimi FR-MOD-08.9.2'nin deny-list'idir (lib/banned-ip.ts, tm 68 teslim). Allowlist agent/admin panel erişimi içindir. · OTURUM IP'YE BAĞLANMAZ (session-to-IP binding YOK). Login sonrası IP değişimi oturumu sonlandırmaz; yalnız o anki isteğin adresi allowlist'e göre değerlendirilir. Gerekçe: olgularda saptanan 'login sonrası IP değişirse (VPN/mobil roaming) oturumun akıbeti belirsiz' riski — bağlama yanlış-pozitif üretir. · SELF-LOCKOUT GUARD YAZMA TARAFINDA. Kısıt açıkken (veya ilk kayıt eklenirken) çağıranın kendi adresini kapsamayan bir yapılandırma 400 validation ile reddedilir. PRD'de yoktur; availability riskine karşı verilen karardır. · YENİ ApiError TİPİ EKLENMEZ. Allowlist reddi mevcut not_allowed (403), idle/limit reddi mevcut authentication (401) ile döner. Böyl

AÇIK SORULAR (ürün kararı): PLAN ÇELİŞKİSİ: IP allowlist hangi plan(lar)da aktif olacak? PRD §5.3 (satır 413) 'Güvenlik | IP allowlist, CC masking, banned customers, spam, temel audit log (tüm planlarda)' derken §6 FR-MOD-08.9.6 aynı özelliği '(Enterprise)' + 'Could (Ent.)' etiketliyor. Bu turda plan kapısı yazılmaması kararlaştırıldı — onaylanıyor mu, yoksa license.plan === 'enterprise' kapısı mı isteniyor? · OWNER/ADMIN İÇİN ACİL KURTARMA YOLU: allowlist enforcement owner rolünü de kapsasın mı, yoksa owner her zaman muaf mı kalsın? Muafiyet self-lockout'a karşı ikinci bir emniyet supabıdır ama aynı zamanda çalınmış owner token'ı için bir bypass'tır. (Şu anki varsayım: owner da kapsanır; kurtarma yolu public login uçlarının muaf olması + self-lockout guard'dır.) · İHLAL DAVRANIŞI: allowlist dışı bir adresten gelen istekte yalnız o istek mi reddedilsin (şu anki varsayım), yoksa ilgili token da revoke mü edilsin? Revoke, VPN kopması gibi geçici durumlarda kullanıcıyı yeniden oturum açmaya zorlar. · IDLE TIMEOUT VARSAYILANI: PRD hiçbir süre vermiyor. Varsayılan null (kapalı) mı kalsın, yoksa NFR-S2'nin 'access token TTL ≤1 saat' hedefiyle uyumlu bir varsayılan (ör. 8 saat boşta kalma) mı yazılsın? · WIDGET/MÜŞTERİ MUAFİYETİ: PRD'nin 'IP kısıtı' ifadesi yalnız agent/admin panelini mi kastediyor? NFR-C11 (regüle dikey: 'IP allowlist; CC masking; audit') müşteri tarafını da ima ediyor olabilir; muafiyet kararı doğrulanmalı. · RTM (WebSocket) YÜZEYİ: apps/rtm bağlantıları da allowlist'e tabi olacak mı? Bu kır

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 80.1. 08.9.6-a [SONNET-XHIGH] security_settings oturum politikası kolonları + kontrat/okuma yüzeyi (davranışsız iskelet)

**Status:** done  
**Dependencies:** None  

Contract-first sıra: (1) OpenAPI components/schemas/SecuritySettings (openapi.yaml:862-900) şemasına katkısal 3 alan — ip_allowlist_enforced: boolean, session_idle_timeout_seconds: integer|null, max_concurrent_sessions: integer|null — açıklama metinlerinde null semantiği yazılır (null = kapalı / mevcut 25 sabiti). (2) Prisma: SecuritySettings modeline aynı üç kolon + migration (ip_allowlist_enforc

**Details:**

08.9.6-a — security_settings oturum politikası kolonları + kontrat/okuma yüzeyi (davranışsız iskelet)  [SONNET-XHIGH]

PRD: FR-MOD-08.9.6 (+ NFR-S2, NFR-S3)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 4 dosya + testleri. (2) Güvenlik sınırı yok — enforcement veya yetki kararı içermiyor, yalnız kolon+şema+serialiser. (3) Eşzamanlılık yok. (4) Kopyalanacak mevcut desen ismen verilebiliyor: requireTwoFactor kolonu (schema.prisma:1129) + serialiseSecurity (settings.ts:829-849) satırları. (5) Kontrat değişikliği katkısal ve mekanik (3 opsiyonel alan, yeni path yok). (6) Kabul kriteri mekanik: contract-parity + GET yanıt alanları.
NEDEN AÇIK: apps/api/prisma/schema.prisma:1123-1136 model SecuritySettings alanları tam olarak şunlar: bannedCustomerIps, spamFilterEnabled, fileSharingEnabled, allowedFileTypes, maxFileSizeBytes, requireTwoFactor, updatedAt — oturum politikası alanı YOK. session_idle_timeout|idle_timeout|max_concurrent|sessionPolicy grep'i apps/+packages/ genelinde yalnız apps/rtm/src/server.ts:194 (RTM_LIMITS.idleTimeoutMs, WebSocket heartbeat) buluyor — oturum politikası değil. serialiseSecurity (settings.ts:829-849) 6 alan döndürüyor.
KAPSAM: Contract-first sıra: (1) OpenAPI components/schemas/SecuritySettings (openapi.yaml:862-900) şemasına katkısal 3 alan — ip_allowlist_enforced: boolean, session_idle_timeout_seconds: integer|null, max_concurrent_sessions: integer|null — açıklama metinlerinde null semantiği yazılır (null = kapalı / mevcut 25 sabiti). (2) Prisma: SecuritySettings modeline aynı üç kolon + migration (ip_allowlist_enforced BOOLEAN NOT NULL DEFAULT false, diğer ikisi INTEGER NULL). (3) SECURITY_DEFAULTS (settings.ts:79-86) ve serialiseSecurity (settings.ts:829-849) okuma tarafına yeni alanlar. (4) pnpm --filter @siyahtus/contract generate ile re-bundle. PATCH yazma yüzeyi (-f) ve her türlü enforcement (-e/-g) KAPSAM DIŞI.
DOSYALAR: apps/api/prisma/schema.prisma · apps/api/prisma/migrations/<YYYYMMDDHHMMSS>_session_policy_columns/migration.sql · packages/contract/openapi/openapi.yaml · apps/api/src/routes/settings.ts · apps/api/test/integration/settings.test.ts
REFERANS DESEN (kopyalanacak): apps/api/prisma/schema.prisma (model SecuritySettings, satır 1123-1136 — requireTwoFactor kolonunun tam şekli) · apps/api/src/routes/settings.ts (SECURITY_DEFAULTS satır 79-86 + serialiseSecurity satır 829-850) · packages/contract/openapi/openapi.yaml (SecuritySettings şeması, satır 862-900) · apps/api/prisma/migrations/20260727090000_app_installations/migration.sql (klasör/dosya adlandırma deseni: YYYYMMDDHHMMSS_<ad>/migration.sql)
KK (birebir): "oturum politikaları" | "KK-türetilmiş: security_settings satırı session_idle_timeout_seconds (null = politika kapalı) ve max_concurrent_sessions (null = mevcut MAX_ACTIVE_TOKENS_PER_OWNER sabiti) alanlarını taşır; ip_allowlist_enforced allowlist'in uygulanıp uygulanmadığını söyler; GET /settings/security bunları döner. TÜRETME GEREKÇESİ: PRD KK'sı (FR-MOD-08.9.6, satır 656) yalnız 'oturum politikaları' diyor; hangi politika, hangi birim, hangi varsayılan yazmıyor (olgular: kk_yetersiz=true). Alan seti NFR-S2'nin 'Access token TTL kısaltılır … maks 25 access+25 refresh/istemci; revocation' maddesinden türetildi."
KK DOĞRULAMA: apps/api/test/integration/settings.test.ts — 'returns the schema defaults when no row exists' testi yeni üç alanı da kapsayacak şekilde genişletilir (satır yokken null/false döner); GET /settings/security yanıtında üç alan mevcut. contract-parity.test.ts yeşil kalır (yeni path eklenmediği için path listesi değişmez). prisma migrate diff boş.
KAPSAM DIŞI: PATCH yazma yüzeyi (08.9.6-f) · ip_allowlist_entries tablosu (08.9.6-b) · Her türlü enforcement (08.9.6-e / -g) · UI (08.9.6-h)
SÖZLEŞME: OpenAPI components/schemas/SecuritySettings (openapi.yaml:862) üzerine 3 katkısal alan. YENİ PATH YOK → contract-parity path listesi değişmez; ancak 'pnpm --filter @siyahtus/contract generate' ile re-bundle edilmezse üretilen tipler (packages/contract/src/generated/api.ts) eskir ve web tarafı tip hatası verir.
MIGRATION: EVET — security_settings tablosuna ip_allowlist_enforced BOOLEAN NOT NULL DEFAULT false, session_idle_timeout_seconds INTEGER NULL, max_concurrent_sessions INTEGER NULL. Katkısal, veri taşıma yok, RLS politikası zaten mevcut satır üzerinde.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 80.2. 08.9.6-b [OPUS-XHIGH] ip_allowlist_entries tablosu + RLS politikası + IpAllowlistEntry şeması

**Status:** done  
**Dependencies:** None  

(1) Prisma model IpAllowlistEntry: id (uuid), organizationId (uuid), licenseId (BigInt), entry (String — tekil IP veya CIDR, canonical form), label (String?), createdAt; @@unique([licenseId, entry]), @@index([licenseId]), @@map("ip_allowlist_entries"). (2) Migration: tablo + ALTER TABLE ip_allowlist_entries ENABLE ROW LEVEL SECURITY + CREATE POLICY ip_allowlist_entries_tenant ON ip_allowlist_entri

**Details:**

08.9.6-b — ip_allowlist_entries tablosu + RLS politikası + IpAllowlistEntry şeması  [OPUS-XHIGH]

PRD: FR-MOD-08.9.6 (+ NFR-S4 tenant izolasyonu, NFR-C11)
ETİKET GEREKÇESİ: OPUS-XHIGH: yeni tabloya RLS politikası yazmak tenant izolasyon yüzeyine dokunur (koşul 2 sınırda — güvenlik hassasiyeti var) ve tablo şekli bir tasarım kararı (normalize tablo mu, security_settings üstünde String[] mi; label taşınsın mı) → koşul 4/5 ihlali. Kullanıcı kuralı: güvenlik hassasiyeti olan iş asla SONNET olmaz. Eşleştirme mantığı (-c) ve enforcement (-e) burada olmadığı için MAX değil.
NEDEN AÇIK: grep: apps/ + packages/ genelinde ipAllowlist|ip_allowlist|allowed_ips|allowedIps → 0 eşleşme. Mevcut SecuritySettings.bannedCustomerIps kavramsal olarak ters işi çözüyor (deny-list, müşteri/widget yüzeyi, FR-MOD-08.9.2 — tm 68 ile teslim); agent/admin panel erişimini IP'ye göre İZİN VEREN bir yapı yok. Depoda allowlist deseni bir kez uygulanmış: schema.prisma:256-272 model TrustedDomain (organizationId/licenseId + entry + unique index).
KAPSAM: (1) Prisma model IpAllowlistEntry: id (uuid), organizationId (uuid), licenseId (BigInt), entry (String — tekil IP veya CIDR, canonical form), label (String?), createdAt; @@unique([licenseId, entry]), @@index([licenseId]), @@map("ip_allowlist_entries"). (2) Migration: tablo + ALTER TABLE ip_allowlist_entries ENABLE ROW LEVEL SECURITY + CREATE POLICY ip_allowlist_entries_tenant ON ip_allowlist_entries USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license()). (3) tenant-isolation.test.ts içindeki sabit tablo listesine (satır 62 ve 81 civarı, trusted_domains'in yanına) eklenir. (4) OpenAPI components/schemas/IpAllowlistEntry şeması. PATH TANIMI KAPSAM DIŞI — contract-parity.test.ts iki yönlü çalışır ('belgelenmiş ama servis edilmeyen path' de kırar), o yüzden /settings/ip-allowlist yolu route'uyla birlikte 08.9.6-d'de eklenir.
DOSYALAR: apps/api/prisma/schema.prisma · apps/api/prisma/migrations/<YYYYMMDDHHMMSS>_ip_allowlist_entries/migration.sql · packages/contract/openapi/openapi.yaml · apps/api/test/integration/tenant-isolation.test.ts
REFERANS DESEN (kopyalanacak): apps/api/prisma/schema.prisma (model TrustedDomain, satır 256-272 — allowlist tablo şekli birebir) · apps/api/prisma/migrations/20260726200000_custom_fields/migration.sql (satır 97-103 — ENABLE ROW LEVEL SECURITY + CREATE POLICY … siyahtus_current_license() bloğu) · apps/api/test/integration/tenant-isolation.test.ts (satır 62 ve 81 — RLS kapsamındaki tablo listesi)
KK (birebir): "IP kısıtı" | "KK-türetilmiş: IP kısıt listesi lisans başına normalize bir tabloda tutulur (ip_allowlist_entries), RLS ile tenant'a kapatılır ve bir kayıt tekil IP ya da CIDR aralığı olabilir. TÜRETME GEREKÇESİ: PRD (satır 656) yalnız 'IP kısıtı' diyor — tekil IP mi CIDR mi, nerede saklanacağı yazmıyor (olgular: kk_yetersiz=true). Depolama şekli NFR-S4'ün 'Her sorgu organization_id/license_id filtreli; PostgreSQL RLS' maddesine göre seçildi."
KK DOĞRULAMA: tenant-isolation.test.ts — ip_allowlist_entries tablosunda RLS aktif ve politika siyahtus_current_license()'a bağlı; A lisansının context'iyle B'nin kaydı ne okunabiliyor ne yazılabiliyor. prisma migrate up temiz; contract-parity.test.ts yeşil (path eklenmedi).
KAPSAM DIŞI: /settings/ip-allowlist OpenAPI path tanımı ve route'u (08.9.6-d — contract-parity iki yönlü kırılır) · CIDR parse/eşleştirme (08.9.6-c) · Enforcement (08.9.6-e) · security_settings kolonları (08.9.6-a)
SÖZLEŞME: OpenAPI components/schemas/IpAllowlistEntry (yalnız şema, path YOK) + re-bundle. UYARI: bu alt-görevde path EKLENMEZ; eklenirse contract-parity.test.ts 'documented route that nothing serves' dalından kırılır.
MIGRATION: EVET — yeni tablo ip_allowlist_entries (id uuid PK, organization_id uuid, license_id bigint FK→licenses, entry text, label text NULL, created_at timestamptz) + UNIQUE(license_id, entry) + INDEX(license_id) + RLS ENABLE + tenant policy.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 80.3. 08.9.6-c [OPUS-MAX] lib/ip-allowlist.ts — CIDR/IP eşleştirme algoritması + izin-ret semantiği (saf, DB'siz)

**Status:** done  
**Dependencies:** None  

Yalnız saf modül apps/api/src/lib/ip-allowlist.ts — DB, route, hook YOK: (1) parseAllowlistEntry(value) → tekil IPv4/IPv6 veya adres/prefix CIDR'ı canonical {version, bytes, prefixLength} yapısına çevirir; geçersiz (prefix >32/v4, >128/v6, negatif, adres bozuk) → null. (2) ipMatchesEntry(ip, entry) → bit-maskeli üyelik testi; IPv4-mapped IPv6 (::ffff:a.b.c.d) düzleştirilir (mevcut normaliseIp yeni

**Details:**

08.9.6-c — lib/ip-allowlist.ts — CIDR/IP eşleştirme algoritması + izin-ret semantiği (saf, DB'siz)  [OPUS-MAX]

PRD: FR-MOD-08.9.6 (+ NFR-S1, NFR-S3, NFR-C11)
ETİKET GEREKÇESİ: OPUS-MAX: erişim kontrolü algoritmasının kendisi — koşul 2 (güvenlik sınırı) ve koşul 4 (yeni algoritma; depoda kopyalanacak CIDR eşleştirici YOK) ihlali. Bit-maske ya da IPv4-mapped-IPv6 düzleştirme hatası doğrudan ya bypass ya da tüm ajanların kilitlenmesi demek; 'boş liste ne demek' kararı da aynı bağlamda verilmeli. BÖLÜNMEZ ÇEKİRDEK.
NEDEN AÇIK: Depodaki tek IP karşılaştırması tam-string eşitliği: apps/api/src/lib/banned-ip.ts — normaliseIp (trim+lowercase+::ffff: düzleştirme) ve bannedCustomerIps.some((entry) => normaliseIp(entry) === target). CIDR/aralık desteği yok. ipAllowlist|allowed_ips grep 0. apps/api/src/lib/ssrf.ts mevcut ama IP'yi sınıflandırıyor (private/loopback/link-local reddi), keyfi prefix'e karşı üyelik testi yapmıyor.
KAPSAM: Yalnız saf modül apps/api/src/lib/ip-allowlist.ts — DB, route, hook YOK: (1) parseAllowlistEntry(value) → tekil IPv4/IPv6 veya adres/prefix CIDR'ı canonical {version, bytes, prefixLength} yapısına çevirir; geçersiz (prefix >32/v4, >128/v6, negatif, adres bozuk) → null. (2) ipMatchesEntry(ip, entry) → bit-maskeli üyelik testi; IPv4-mapped IPv6 (::ffff:a.b.c.d) düzleştirilir (mevcut normaliseIp yeniden kullanılır); v4 girdi v6 entry'ye (ve tersi) eşleşmez. (3) decideIpAccess({ clientIp, entries }) → 'allow' | 'deny': boş liste = allow (yapılandırılmamış ≠ kimseye izin yok — self-lockout önlemi), dolu liste + eşleşme yok = deny, clientIp null/boş + dolu liste = deny (sinyal yokluğu dolu listede ret sayılır). (4) wouldLockOut(callerIp, nextEntries) → yazma tarafının (-d) çağıracağı self-kilitleme kontrolü.
DOSYALAR: apps/api/src/lib/ip-allowlist.ts · apps/api/src/lib/ip-allowlist.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/lib/banned-ip.ts (normaliseIp + saf-fonksiyon/DB ayrımı + doküman tonu) · apps/api/src/lib/ssrf.ts (IP aralık akıl yürütmesi ve fail-closed yazım biçimi) · apps/api/src/lib/ssrf.test.ts (negatif-önce test dizilimi)
KK (birebir): "IP kısıtı" | "KK-türetilmiş: Bir kayıt tekil IP ya da CIDR aralığıdır; boş liste hiçbir kısıt uygulanmadığı anlamına gelir; dolu listede eşleşmeyen adres reddedilir; adresi bilinmeyen istek dolu listede reddedilir. TÜRETME GEREKÇESİ: PRD 'IP kısıtı' dışında hiçbir uygulama detayı vermiyor (olgular: 'tekil IP mi CIDR aralığı mı … ihlal durumunda davranış — hiçbiri belirtilmemiş'). Boş-liste=izinli seçimi olgulardaki 'boş liste herkese izin mi kimseye izin yok mu netleşmeli / self-lockout riski' maddesine karşı verilen karardır (§C varsayım)."
KK DOĞRULAMA: ip-allowlist.test.ts — 'IP kısıtı' KK'sı, eşleştiricinin bir adresi listeye göre kabul/ret ettiğini kanıtlayan unit testleriyle karşılanır; 'boş liste = allow' ve 'clientIp yok = deny' davranışları ayrı testlerle sabitlenir (bu iki test regresyon kilididir).
KAPSAM DIŞI: DB okuma/yazma, route, Fastify hook (08.9.6-d / -e) · Oturum politikaları (08.9.6-f / -g) · SSRF sınıflandırması — lib/ssrf.ts ayrı sorumluluk, birleştirilmez
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 80.4. 08.9.6-d [OPUS-XHIGH] /settings/ip-allowlist CRUD (GET/POST/DELETE) + self-lockout guard + audit + path kontratı

**Status:** done  
**Dependencies:** 80.2, 80.3  

Contract-first: (1) packages/contract/openapi/paths/settings.yaml'a ipAllowlist (get/post) + ipAllowlistEntry (delete) blokları, openapi.yaml paths kaydı, re-bundle. (2) routes/settings.ts: GET (access_rules:ro|rw, entry alfabetik), POST (access_rules:rw, gövde parseAllowlistEntry ile doğrulanır → geçersizse 400 validation; canonical form saklanır; unique çakışması reddedilir), DELETE /:entryId (a

**Details:**

08.9.6-d — /settings/ip-allowlist CRUD (GET/POST/DELETE) + self-lockout guard + audit + path kontratı  [OPUS-XHIGH]

PRD: FR-MOD-08.9.6 (+ NFR-S12 audit, NFR-S4, NFR-S5)
ETİKET GEREKÇESİ: OPUS-XHIGH: erişim kontrol listesinin YAZMA yüzeyi = yeni yetkili endpoint. Kullanıcı kuralı: 'güvenlik hassasiyeti olan ama çekirdek güvenlik sınırı olmayan işler (ör. yeni bir yetkili endpoint eklemek) EN AZ OPUS-XHIGH olur; güvenlik işi asla sonnet'e verilmez.' Eşleştirme/kilitlenme kararı -c'de saf fonksiyon olarak sabitlendiği için MAX değil.
NEDEN AÇIK: /settings/ip-allowlist route'u yok (ip_allowlist grep 0). Aynı şekilli bir allowlist CRUD'u depoda bir kez var: apps/api/src/routes/settings.ts:206-299 /settings/trusted-domains GET/POST/DELETE — scope access_rules:ro|rw, tenant-scoped deleteMany, aynı transaction'da writeAuditEntry. AUDIT_ACTIONS (audit-log.ts:33-67) kapalı sözlük; IP allowlist için action yok.
KAPSAM: Contract-first: (1) packages/contract/openapi/paths/settings.yaml'a ipAllowlist (get/post) + ipAllowlistEntry (delete) blokları, openapi.yaml paths kaydı, re-bundle. (2) routes/settings.ts: GET (access_rules:ro|rw, entry alfabetik), POST (access_rules:rw, gövde parseAllowlistEntry ile doğrulanır → geçersizse 400 validation; canonical form saklanır; unique çakışması reddedilir), DELETE /:entryId (access_rules:rw, deleteMany ile tenant-scoped, count 0 → 404). (3) Her yazımda aynı transaction'da writeAuditEntry — AUDIT_ACTIONS'a settings.ip_allowlist_added ve settings.ip_allowlist_removed eklenir (metadata: entry; ham istemci IP'si PII olarak yazılmaz). (4) SELF-LOCKOUT GUARD: wouldLockOut(request.ip, nextEntries) true ise 400 ile reddedilir — çağıranın kendi adresini dışarıda bırakan bir yapılandırma kaydedilemez.
DOSYALAR: apps/api/src/routes/settings.ts · packages/contract/openapi/paths/settings.yaml · packages/contract/openapi/openapi.yaml · apps/api/src/services/audit/audit-log.ts · apps/api/test/integration/ip-allowlist.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/settings.ts (satır 206-299 — trusted-domains GET/POST/DELETE: scope, normalize-veya-400, transaction içi audit, tenant-scoped deleteMany + 404) · packages/contract/openapi/paths/settings.yaml (trustedDomains blokları) · apps/api/src/services/audit/audit-log.ts (satır 33-67 AUDIT_ACTIONS kapalı sözlüğü + sanitizeAuditMetadata)
KK (birebir): "IP kısıtı" | "KK-türetilmiş: IP kısıt listesi Settings üzerinden listelenir, kayıt eklenir ve silinir; her ekleme/silme audit log'a düşer; çağıranın kendisini dışarıda bırakan bir kayıt reddedilir. TÜRETME GEREKÇESİ: PRD 'IP kısıtı' dışında yönetim yüzeyi tanımlamıyor; audit payı NFR-S12'den, self-lockout reddi ise olgulardaki 'yanlış yapılandırılmış bir allowlist agent'ları kilitleyebilir (availability/self-lockout riski)' bulgusundan türetildi."
KK DOĞRULAMA: apps/api/test/integration/ip-allowlist.test.ts — POST sonrası GET kaydı döner ve audit_log'da settings.ip_allowlist_added satırı vardır; DELETE sonrası kayıt gider ve settings.ip_allowlist_removed yazılır; kendi IP'sini kapsamayan ilk kayıt 400 alır. contract-parity.test.ts yeşil (üç operasyon hem belgelenmiş hem servis ediliyor).
KAPSAM DIŞI: Enforcement — bu endpoint listeyi yönetir, hiçbir isteği reddetmez (08.9.6-e) · Oturum politikası alanlarının yazımı (08.9.6-f) · UI (08.9.6-h)
SÖZLEŞME: EVET — YENİ PATH'LER: GET/POST /settings/ip-allowlist ve DELETE /settings/ip-allowlist/{entryId}. packages/contract/openapi/paths/settings.yaml + openapi.yaml paths bölümüne eklenip 'pnpm --filter @siyahtus/contract generate' ile re-bundle EDİLMEZSE contract-parity.test.ts KIRILIR — test iki yönlüdür: belgelenmemiş route da, hiçbir şeyin servis etmediği belgelenmiş path de kırar.
MIGRATION: yok (tablo 08.9.6-b'de). Not: AUDIT_ACTIONS bir TS const'tır, migration gerektirmez; ancak kapalı sözlük olduğu için iki yeni action eklenmeden writeAuditEntry tip hatası verir.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 80.5. 08.9.6-e [OPUS-MAX] IP allowlist enforcement — auth onRequest kapısı + trustProxy taklit yüzeyi + not_allowed/audit

**Status:** done  
**Dependencies:** 80.1, 80.2, 80.3  

plugins/auth.ts onRequest zincirinde, principal çözüldükten ve principal-kind kontrolünden SONRA, scope kontrolünden ÖNCE: (1) principal.kind !== 'customer' ise lisansın ip_allowlist_enforced bayrağı ve ip_allowlist_entries kayıtları tenant-scoped okunur; (2) decideIpAccess({ clientIp: request.ip, entries }) → deny ise new ApiError('not_allowed', …) (403) fırlatılır — YENİ HATA TİPİ EKLENMEZ, not_

**Details:**

08.9.6-e — IP allowlist enforcement — auth onRequest kapısı + trustProxy taklit yüzeyi + not_allowed/audit  [OPUS-MAX]

PRD: FR-MOD-08.9.6 (+ NFR-S1, NFR-S3, NFR-S5, NFR-S12, NFR-C11)
ETİKET GEREKÇESİ: OPUS-MAX: authN/authZ sınırında ağ seviyeli erişim kontrolü. server.ts:97 trustProxy: true olduğu için request.ip istemcinin gönderdiği X-Forwarded-For'dan türeyebilir — yanlış karar verilirse allowlist tek başlıkla atlanır (bypass); ters yönde tüm workspace kilitlenir. Hangi principal türünün muaf olduğu, kontrolün zincirdeki sırası ve reddin hangi hata tipiyle döneceği tek bir akıl yürütmedir. Koşul 2 ihlali. BÖLÜNMEZ ÇEKİRDEK.
NEDEN AÇIK: request.ip depoda yalnız dört yerde geçiyor: plugins/rate-limit.ts:124 (anon rate-limit anahtarı), routes/customer.ts:256 ve :345, routes/auth.ts:565 — son üçü müşteri/widget isIpBanned kontrolü. Agent/PAT/bot isteğinde IP kontrolü yapan HİÇBİR kod yok. Tek çıkış kapısı plugins/auth.ts:130-207 onRequest hook'u: principal çözümü → principal-kind (404) → region (421) → scope (403) → role (403) kontrolleri zaten orada sıralı. apps/api/src/server.ts:97 trustProxy: true.
KAPSAM: plugins/auth.ts onRequest zincirinde, principal çözüldükten ve principal-kind kontrolünden SONRA, scope kontrolünden ÖNCE: (1) principal.kind !== 'customer' ise lisansın ip_allowlist_enforced bayrağı ve ip_allowlist_entries kayıtları tenant-scoped okunur; (2) decideIpAccess({ clientIp: request.ip, entries }) → deny ise new ApiError('not_allowed', …) (403) fırlatılır — YENİ HATA TİPİ EKLENMEZ, not_allowed packages/types/src/errors.ts'te zaten var (ERROR_STATUS 403); (3) müşteri/widget principal'ı MUAF (o yüzeyin denetimi FR-MOD-08.9.2'nin isIpBanned'ı); (4) public: true route'lar (login/authorize/token/revoke) bu dala hiç girmez — kurtarma yolu açık kalır, karar testle sabitlenir; (5) trustProxy yüzeyi: request.ip'nin nereden geldiği doğrulanır ve allowlist'in X-Forwarded-For ile taklit edilemeyeceği güvenceye alınır (güvenilmeyen kaynakta başlık yok sayılır / güvenilen proxy zinciri daraltılır), karar kodda yorumla gerekçelendirilir; (6) ret auth.ip_denied audit action'ı ile kaydedilir — metadata'da ham IP TUTULMAZ (NFR-C1/C2), yalnız principal kind + token id; (7) okuma her istekte taze yapılır, license-gate.ts'teki 'cache etme' gerekçesi bu yüzey için ayrıca değerlendirilip yorumlanır.
DOSYALAR: apps/api/src/plugins/auth.ts · apps/api/src/server.ts · apps/api/src/services/audit/audit-log.ts · apps/api/test/integration/ip-allowlist.test.ts · apps/api/test/integration/route-config.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/plugins/auth.ts (satır 130-207 — sıralı kontrol zinciri: principal-kind 404, region 421, scope 403, role 403) · apps/api/src/plugins/license-gate.ts (her istekte taze okuma + neden cache'lenmediğinin yazılı gerekçesi) · apps/api/src/lib/banned-ip.ts (tenant-scoped okuma + 'sinyal yokluğu eşleşme değildir' yazımı)
KK (birebir): "IP kısıtı" | "KK-türetilmiş: Kısıt açıkken, agent/PAT/bot kimliğiyle gelen her istek listeye göre değerlendirilir; eşleşmeyen adres 403 not_allowed alır; müşteri/widget yüzeyi muaftır; oturum açma (public) uçları kısıt dışıdır. TÜRETME GEREKÇESİ: PRD 'IP kısıtı' diyor ama olgularda saptandığı gibi 'enforcement noktasının yalnız login'de mi her istekte mi çalışacağı ayrı bir güvenlik kararı'dır — burada verilip testle sabitlenmiştir. Destek kaynağı v2-04 satır 127: 'PAT/Bearer token çalınması ile API'ye taklit erişim | TLS zorunlu, token rotasyonu, IP allowlist (Enterprise)' — kontrolün hedefi login değil, çalınmış token'la yapılan API erişimidir; dolayısıyla her istekte çalışır."
KK DOĞRULAMA: ip-allowlist.test.ts — enforce açık + eşleşmeyen IP ile agent token'ı korumalı bir uç çağırınca 403 not_allowed (ADR-06 zarfı: {error:{type:'not_allowed',…}}) ve audit_log'da auth.ip_denied satırı; eşleşen IP ile aynı çağrı 200. X-Forwarded-For taklidi testi kontrolü atlatamaz. route-config.test.ts public route'ların etkilenmediğini kanıtlar.
KAPSAM DIŞI: Oturum politikaları (idle timeout / eşzamanlı oturum) — 08.9.6-g · Allowlist yönetim endpoint'i — 08.9.6-d · Oturumun IP'ye bağlanması (session-to-IP binding) — bilinçli olarak YAPILMAZ (§C varsayım: VPN/mobil roaming yanlış-pozitifi) · Plan/paket kapısı (Enterprise-only gating) — açık soru, bu turda kodlanmaz · RTM (WebSocket) el sıkışması — ayrı yüzey, açık soru
SÖZLEŞME: yok — mevcut 403 not_allowed hata tipi kullanılır. UYARI (bilinçli kaçınılan tuzak): yeni bir ApiError tipi eklenseydi packages/types/src/errors.ts'te İKİ yer (ERROR_TYPES + ERROR_STATUS) + packages/types/src/scopes.test.ts:95 sayaç iddiası + OpenAPI hata enum'u + regen gerekirdi; bu iş not_allowed'ı yeniden kullanarak bunlara dokunmaz.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 80.6. 08.9.6-f [SONNET-XHIGH] PATCH /settings/security — oturum politikası alanlarının yazma yüzeyi (validasyon + audit)

**Status:** done  
**Dependencies:** 80.1  

(1) updateSecurityBody'ye üç katkısal alan: ip_allowlist_enforced: z.boolean().optional(), session_idle_timeout_seconds: z.number().int().positive().max(<üst sınır>).nullable().optional(), max_concurrent_sessions: z.number().int().positive().max(<üst sınır>).nullable().optional() — .positive() sıfır/negatifi reddeder (chat-timeout'taki aynı gerekçe: 0 bir 'kapalı' değil, enforcement'in üzerine gid

**Details:**

08.9.6-f — PATCH /settings/security — oturum politikası alanlarının yazma yüzeyi (validasyon + audit)  [SONNET-XHIGH]

PRD: FR-MOD-08.9.6 (+ NFR-S2, NFR-S12)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 2 dosya + testi. (2) Güvenlik sınırı YOK — yalnız bir ayar değerini doğrulayıp saklar; erişim/oturum kararı -e ve -g'de, değerlerin semantiği -a'nın kontratında sabit; route zaten access_rules:rw ile korunuyor, yeni yetki yüzeyi açılmıyor. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen verilebiliyor: updateChatTimeoutBody (pozitif tam sayı + üst sınır + nullable) ve require_two_factor spread satırı. (5) Kontrat değişikliği katkısal (mevcut PATCH requestBody'ye 3 alan, yeni path yok). (6) Kabul kriteri mekanik: 400/200 ve persist.
NEDEN AÇIK: apps/api/src/routes/settings.ts:140 updateSecurityBody zod şeması tam olarak 6 alan taşıyor: banned_customer_ips, file_sharing_enabled, allowed_file_types, max_file_size_bytes, spam_filter_enabled, require_two_factor. PATCH gövdesindeki data bloğu (satır 426-445) bu 6 alanın spread'i. Oturum politikası alanı ne şemada ne spread'de var.
KAPSAM: (1) updateSecurityBody'ye üç katkısal alan: ip_allowlist_enforced: z.boolean().optional(), session_idle_timeout_seconds: z.number().int().positive().max(<üst sınır>).nullable().optional(), max_concurrent_sessions: z.number().int().positive().max(<üst sınır>).nullable().optional() — .positive() sıfır/negatifi reddeder (chat-timeout'taki aynı gerekçe: 0 bir 'kapalı' değil, enforcement'in üzerine gideceği gerçek bir sayı olur). (2) PATCH data bloğuna karşılık gelen üç spread satırı. (3) packages/contract/openapi/paths/settings.yaml securitySettings PATCH requestBody'sine üç alan + re-bundle. Mevcut settings.security_updated audit yazımı yalnız DEĞİŞEN ALAN ADLARINI kaydediyor — değişiklik gerekmez, ama testle doğrulanır. Enforcement KAPSAM DIŞI.
DOSYALAR: apps/api/src/routes/settings.ts · packages/contract/openapi/paths/settings.yaml · apps/api/test/integration/settings.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/settings.ts (updateChatTimeoutBody — z.number().int().positive().max(CHAT_TIMEOUT_MAX_SECONDS).nullable() ve 0'ın neden reddedildiğinin yorumu) · apps/api/src/routes/settings.ts (satır 419-472 — PATCH /settings/security upsert + data spread bloğu + writeAuditEntry) · packages/contract/openapi/paths/settings.yaml (satır 223-265 — securitySettings patch requestBody şeması)
KK (birebir): "oturum politikaları" | "KK-türetilmiş: Oturum politikası değerleri Settings üzerinden kaydedilir; sıfır/negatif değer reddedilir; null politikanın kapalı olduğu anlamına gelir; değişiklik audit log'a alan adı olarak düşer. TÜRETME GEREKÇESİ: PRD 'oturum politikaları' dışında birim/sınır vermiyor (olgular: kk_yetersiz=true); sınırlar NFR-S2 ('Access token TTL kısaltılır … maks 25 access+25 refresh/istemci; revocation') ve depodaki chat-timeout deseninden türetildi."
KK DOĞRULAMA: settings.test.ts — PATCH ile üç alan yazılır, GET aynen geri okur; session_idle_timeout_seconds: 0 ve max_concurrent_sessions: 0 400 validation alır; audit_log'da settings.security_updated satırının metadata'sında yalnız değişen alan adları vardır. contract-parity.test.ts yeşil.
KAPSAM DIŞI: Değerlerin uygulanması — idle timeout / concurrent limit enforcement (08.9.6-g) · IP allowlist CRUD (08.9.6-d) · UI (08.9.6-h)
SÖZLEŞME: OpenAPI paths/settings.yaml içindeki securitySettings PATCH requestBody'sine 3 katkısal alan. Yeni path YOK. Re-bundle ('pnpm --filter @siyahtus/contract generate') şart; aksi halde üretilen tipler eskir.
MIGRATION: yok (kolonlar 08.9.6-a'da eklendi)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 80.7. 08.9.6-g [OPUS-MAX] Oturum politikası enforcement — idle timeout (lastUsedAt) + lisans başına eşzamanlı oturum limiti

**Status:** done  
**Dependencies:** 80.1, 80.6  

(1) IDLE TIMEOUT: lisansın session_idle_timeout_seconds doluysa, now - (lastUsedAt ?? createdAt) > timeout olan token reddedilir; ret sebebi resolve()'un mevcut reason deseniyle loglanır ama istemciye ayrım verilmez (mevcut 'expired ile unknown ayrımı token'ın gerçek olduğunu doğrular' gerekçesi korunur) → 401 authentication; token kalıcı olarak revoke edilir. touch()'ın fire-and-forget olması ned

**Details:**

08.9.6-g — Oturum politikası enforcement — idle timeout (lastUsedAt) + lisans başına eşzamanlı oturum limiti  [OPUS-MAX]

PRD: FR-MOD-08.9.6 (+ NFR-S2 token yönetimi, NFR-S3)
ETİKET GEREKÇESİ: OPUS-MAX: token geçerlilik semantiğini değiştirmek doğrudan authN sınırıdır (koşul 2 ihlali) ve eşzamanlı oturum limiti eşzamanlılık akıl yürütmesi gerektirir (koşul 3 ihlali): touch() fire-and-forget bir UPDATE, resolve() aynı satırı okuyor — idle penceresi bu yarışın içinde hesaplanacak; paralel issue() çağrılarında limitin aşılmaması bir invariant. BÖLÜNMEZ ÇEKİRDEK.
NEDEN AÇIK: apps/api/src/services/auth/token-service.ts:19 MAX_ACTIVE_TOKENS_PER_OWNER = 25 sabit ve lisans başına yapılandırılamıyor; #pruneOldest (satır ~238-259) yalnız kind === 'oauth' için çalışıyor ve eşiği bu sabitten alıyor. resolve() (satır 62-121) yalnız revoked_at, expires_at, lisans durumu ve membership kontrol ediyor — boşta-kalma (idle) kontrolü YOK. Alt yapı hazır: ApiToken.lastUsedAt kolonu (schema.prisma ~294) ve touch() → auth_touch_token (token-service.ts:125-128) her agent/bot isteğinde güncelliyor.
KAPSAM: (1) IDLE TIMEOUT: lisansın session_idle_timeout_seconds doluysa, now - (lastUsedAt ?? createdAt) > timeout olan token reddedilir; ret sebebi resolve()'un mevcut reason deseniyle loglanır ama istemciye ayrım verilmez (mevcut 'expired ile unknown ayrımı token'ın gerçek olduğunu doğrular' gerekçesi korunur) → 401 authentication; token kalıcı olarak revoke edilir. touch()'ın fire-and-forget olması nedeniyle 'okunan lastUsedAt ile aynı istekte yazılan değer' yarışı açıkça ele alınıp yorumla gerekçelendirilir. (2) EŞZAMANLI OTURUM LİMİTİ: #pruneOldest'in eşiği lisansın max_concurrent_sessions değerinden okunur (null → mevcut MAX_ACTIVE_TOKENS_PER_OWNER sabiti); aşan en eski oauth token'lar revoke edilir; PAT'ler hariç kalır (mevcut 'adlandırılmış, uzun ömürlü kimlik bilgisini sessizce iptal etmek gizemli kesinti yaratır' gerekçesi korunur). Limit okuması issue()'nun içindeki transaction'da yapılır ki paralel basımda invariant korunsun.
DOSYALAR: apps/api/src/services/auth/token-service.ts · apps/api/src/plugins/auth.ts · apps/api/test/integration/session-policies.test.ts · apps/api/test/integration/auth.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/services/auth/token-service.ts (satır 62-121 resolve — reason döndürme + istemciye ayrım vermeme deseni) · apps/api/src/services/auth/token-service.ts (satır 130-170 issue + satır 238-259 #pruneOldest — transaction içi cap uygulaması) · apps/api/src/plugins/license-gate.ts (her istekte taze okuma vs. cache tartışmasının yazılı biçimi)
KK (birebir): "oturum politikaları" | "KK-türetilmiş: Yapılandırılmış boşta-kalma penceresi aşıldığında oturum geçersizleşir ve token iptal edilir; yapılandırılmış eşzamanlı oturum limiti aşıldığında en eski oturum kapanır; her iki politika da null iken davranış bugünküyle birebir aynı kalır. TÜRETME GEREKÇESİ: PRD 'oturum politikaları' dışında hiçbir detay vermiyor (olgular: 'idle timeout kaç dakika/saat … hiçbiri belirtilmemiş'). Politikaların şekli NFR-S2'nin 'Access token TTL kısaltılır (kaynak 8 saat—uzun; SiyahTuş ≤1 saat + refresh); maks 25 access+25 refresh/istemci; revocation' maddesinden türetildi."
KK DOĞRULAMA: session-policies.test.ts — idle penceresi geçmiş bir token ile yapılan çağrı 401 alır ve api_tokens.revoked_at dolar; pencere içindeki çağrı 200 alır; max_concurrent_sessions=2 iken üçüncü oturum açıldığında en eski oauth token revoke olur, aynı sahibin PAT'i canlı kalır; her iki alan null iken mevcut auth.test.ts senaryoları değişmeden geçer.
KAPSAM DIŞI: IP allowlist (08.9.6-c / -d / -e) · Refresh token ailesi (OauthRefreshToken.familyId) semantiğinin değiştirilmesi — mevcut rotasyon/aile iptali davranışı korunur · Oturumun IP'ye bağlanması — §C varsayım gereği yapılmaz · Access token TTL'inin kendisi (NFR-S2, ayrı kalem)
SÖZLEŞME: yok — mevcut 401 authentication zarfı kullanılır; yeni hata tipi eklenmez (errors.ts×2 + scopes.test.ts sayaç + openapi enum + regen tuzağına girilmez).
MIGRATION: yok (kolonlar 08.9.6-a'da)
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 80.8. 08.9.6-h [SONNET-XHIGH] Settings ekranı — IP allowlist bölümü + oturum politikası formu

**Status:** done  
**Dependencies:** 80.4, 80.6  

Yeni dosya apps/web/src/features/settings/IpAllowlist.tsx: (1) allowlist listesi + ekle/sil formu (GET/POST/DELETE /settings/ip-allowlist, queryKey ['settings','ip-allowlist']); (2) 'Enforce' anahtarı + oturum politikası girdileri (idle timeout, max concurrent sessions) → PATCH /settings/security (mevcut ['settings','security'] cache'i güncellenir); (3) self-lockout uyarı metni ve sunucudan gelen 

**Details:**

08.9.6-h — Settings ekranı — IP allowlist bölümü + oturum politikası formu  [SONNET-XHIGH]

PRD: FR-MOD-08.9.6 (+ FR-EK-A.1 alan-altı hata, FR-EK-B.1 anlamlı empty state)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. (1) 3 dosya + testi. (2) Güvenlik sınırı YOK — tüm doğrulama, self-lockout reddi ve enforcement sunucuda (-c/-d/-e/-g); UI yalnız listeler, gönderir ve sunucudan gelen 400'ü gösterir. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen verilebiliyor: BannedCustomerIps bileşeni (SettingsPage.tsx:464-570) — IP giriş/liste editörü, query+mutation, EmptyState, canEdit kapısı. (5) Kontrat değişikliği yok. (6) Kabul kriteri mekanik: render + boş durum + hata gösterimi.
NEDEN AÇIK: apps/web/src/features/settings/SettingsPage.tsx:106-132 render listesi 15 bölüm içeriyor (ChannelsGrid … PreChatFormSettings) — IP allowlist ya da oturum politikası bölümü YOK. Aynı dosyadaki frontend SecuritySettings arayüzü (satır 64-72) yalnız 6 alan + updated_at taşıyor.
KAPSAM: Yeni dosya apps/web/src/features/settings/IpAllowlist.tsx: (1) allowlist listesi + ekle/sil formu (GET/POST/DELETE /settings/ip-allowlist, queryKey ['settings','ip-allowlist']); (2) 'Enforce' anahtarı + oturum politikası girdileri (idle timeout, max concurrent sessions) → PATCH /settings/security (mevcut ['settings','security'] cache'i güncellenir); (3) self-lockout uyarı metni ve sunucudan gelen 400'ün alan-altı gösterimi (role="alert"); (4) kayıt yokken EmptyState; (5) canEdit = access_rules:rw scope'u — false iken form render edilmez. SettingsPage.tsx: render listesine <IpAllowlist canEdit={canManageAccess} /> + SecuritySettings arayüzüne 3 yeni alan.
DOSYALAR: apps/web/src/features/settings/IpAllowlist.tsx · apps/web/src/features/settings/IpAllowlist.test.tsx · apps/web/src/features/settings/SettingsPage.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/settings/SettingsPage.tsx (satır 464-570 BannedCustomerIps — IP ekle/sil editörü, useQuery+useMutation, EmptyState, ApiClientError mesajı, canEdit kapısı) · apps/web/src/features/settings/SettingsPage.tsx (satır 329-460 TrustedDomains — ayrı kaynak CRUD listesi: POST/DELETE + id ile silme) · apps/web/src/features/settings/BannedCustomerIps.test.tsx (test iskeleti) · apps/web/src/features/settings/WidgetCustomization.tsx (ayrı dosya + kendi testi deseni)
KK (birebir): "IP kısıtı" | "oturum politikaları" | "KK-türetilmiş: Yönetici IP kısıt listesini ve oturum politikalarını Settings ekranından görür ve düzenler; liste boşken anlamlı bir boş durum gösterilir; sunucunun reddi (geçersiz CIDR, self-lockout) alan-altı hata olarak görünür; yetkisi olmayan kullanıcıya düzenleme formu gösterilmez. TÜRETME GEREKÇESİ: PRD KK'sında ekran davranışı yok; boş durum ve alan-altı hata payı FR-EK-A.1/EK-B.1'in depoda yerleşik desenlerinden türetildi."
KK DOĞRULAMA: IpAllowlist.test.tsx — kayıtlar listelenir; kayıt yokken EmptyState metni görünür (boş dikdörtgen değil); ekleme mutation'ı doğru gövdeyle çağrılır; sunucu 400'ü role="alert" ile görünür; canEdit=false iken form yok. E2E görünürlük 08.9.6-i'de.
KAPSAM DIŞI: E2E akışı (08.9.6-i) · Audit log görüntüleme ekranı · Coğrafi IP çözümleme / harita · Sunucu tarafı doğrulama veya enforcement
SÖZLEŞME: yok (kontrat -d ve -f'de tamamlandı; UI üretilen tipleri tüketir)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 80.9. 08.9.6-i [OPUS-XHIGH] Uçtan uca doğrulama — E2E akışı, audit görünürlüğü, proxy-IP davranışı ve istek başına maliyet notu

**Status:** done  
**Dependencies:** 80.4, 80.5, 80.7, 80.8  

(1) E2E apps/e2e/tests/settings.spec.ts'e IP allowlist akışı: kayıt ekle → listede görünür → sil → boş durum döner (enforce kapalı tutulur ki test oturumu kendini kilitlemesin). (2) Integration uçtan uca: enforce açık + eşleşmeyen IP → 403 ve GET /audit-log yanıtında auth.ip_denied girdisi görünür; audit metadata'sında ham IP olmadığı doğrulanır (NFR-C1/C2). (3) trustProxy: true altında request.ip

**Details:**

08.9.6-i — Uçtan uca doğrulama — E2E akışı, audit görünürlüğü, proxy-IP davranışı ve istek başına maliyet notu  [OPUS-XHIGH]

PRD: FR-MOD-08.9.6 (+ NFR-S12 audit, NFR-U/NFR-P SLO, NFR-C1/C2 PII)
ETİKET GEREKÇESİ: OPUS-XHIGH: dört yüzeyi (kontrat + DB/RLS + auth hook + UI) birlikte doğrulama ve 'her kimlikli istekte ek DB okuması'nın NFR-U/NFR-P bütçesine etkisi hakkında yorum gerektiren bir karar (cache'lensin mi, ne kadar TTL) — koşul 6 ihlali, mekanik değil. Yeni güvenlik mantığı yazılmadığı (yalnız -e'nin verdiği kararlar doğrulandığı) için MAX değil.
NEDEN AÇIK: apps/e2e/tests/settings.spec.ts mevcut ama IP allowlist akışı içermiyor (özellik henüz yok). apps/api/src/plugins/license-gate.ts her MUTASYONDA taze okuma yapıyor ve cache'i açık gerekçeyle reddediyor; 08.9.6-e'nin okuması ise yalnız mutasyonlarda değil HER kimlikli istekte çalışacağı için aynı gerekçe otomatik devralınamaz — ölçülmeli ve karara bağlanmalı. apps/api/src/server.ts:97 trustProxy: true olduğu için request.ip'nin gerçek kaynağı uçtan uca doğrulanmalı.
KAPSAM: (1) E2E apps/e2e/tests/settings.spec.ts'e IP allowlist akışı: kayıt ekle → listede görünür → sil → boş durum döner (enforce kapalı tutulur ki test oturumu kendini kilitlemesin). (2) Integration uçtan uca: enforce açık + eşleşmeyen IP → 403 ve GET /audit-log yanıtında auth.ip_denied girdisi görünür; audit metadata'sında ham IP olmadığı doğrulanır (NFR-C1/C2). (3) trustProxy: true altında request.ip'nin ne döndürdüğü ve -e'de verilen taklit-önleme kararının uçtan uca geçerli olduğu testle sabitlenir. (4) Allowlist okumasının istek başına maliyeti ölçülür; gerekiyorsa kısa TTL'li cache kararı verilir ve gerekçesi kodda yorumla + HANDOFF'ta kanıtla yazılır. (5) HANDOFF.md girdisi + PLAN §C varsayımlarının koda karşı doğrulanması.
DOSYALAR: apps/e2e/tests/settings.spec.ts · apps/api/test/integration/ip-allowlist.test.ts · apps/api/test/integration/audit-log.test.ts · HANDOFF.md
REFERANS DESEN (kopyalanacak): apps/e2e/tests/settings.spec.ts (mevcut Settings E2E akış deseni) · apps/api/test/integration/audit-log.test.ts (audit girdisinin uçtan uca görünürlüğünü kanıtlama deseni) · apps/api/test/integration/tenant-isolation.test.ts (çapraz-tenant regresyon süiti)
KK (birebir): "IP kısıtı" | "oturum politikaları" | "KK-türetilmiş: Kalem, yönetim ekranından yapılan bir değişikliğin gerçekten bir isteği reddettiği ve bu reddin audit izinde göründüğü uçtan uca kanıtlandığında bitmiş sayılır. TÜRETME GEREKÇESİ: PRD KK'sı ('IP kısıtı; oturum politikaları') doğrulama yöntemi tanımlamıyor; CONVENTIONS.md DoD kapısı ve NFR-S12 audit maddesi bu kanıtı zorunlu kılıyor."
KK DOĞRULAMA: E2E settings.spec.ts allowlist ekle/gör/sil akışı yeşil; integration'da enforce açıkken 403 + auth.ip_denied audit girdisi /audit-log üzerinden okunuyor; X-Forwarded-For taklidi testi kontrolü atlatamıyor; ölçüm notu HANDOFF'a kanıtla yazıldı.
KAPSAM DIŞI: Yeni güvenlik mantığı yazmak (hepsi -c/-e/-g'de) · Gerçek proxy/TLS/production dağıtımı (MASTER-PROMPT sınırı: production deploy/DNS/TLS YOK) · Plan/paket kapısı kararı (açık soru) · RTM WebSocket enforcement (açık soru)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
