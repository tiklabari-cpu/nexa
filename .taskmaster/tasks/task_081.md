# Task ID: 81

**Title:** S11 — SAML 2.0 SSO + SCIM provisioning · dilim V3-1

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** PRD §5.4 (Ent.) · NFR-S11 · KK-türetilmiş. Kimlik sınırı: federasyon + otomatik provizyon.

**Details:**

Faz 3 (Enterprise) · PLAN §6.1 · kalem `S11` · dilim V3-1

9 atomik alt-görev · ~14 pencere · etiket dağılımı: OPUS-XHIGH x3 · OPUS-MAX x4 · SONNET-XHIGH x2

KK: "SAML IdP ile SSO girişi; SCIM ile kullanıcı yaşam döngüsü (provizyon/deprovizyon)" — NFR-S11'den türetildi (§C-A17).

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  S11-a [OPUS-XHIGH] sso_connections tablosu + RLS politikası + kontrat okuma yüzeyi  (bağ: —)
  S11-b [OPUS-MAX] SAML assertion doğrulama çekirdeği (BÖLÜNMEZ) — imza + koşullar + replay + XSW  (bağ: —)
  S11-c [SONNET-XHIGH] Mock IdP harness — imzalı assertion üreteci + anahtar çifti fixture'ı  (bağ: S11-b)
  S11-d [OPUS-MAX] SP uçları (BÖLÜNMEZ) — /auth/saml/{id}/login + /acs, hesap eşleme, JIT provizyon, oturum, audit  (bağ: S11-a, S11-b, S11-c)
  S11-e [OPUS-MAX] SCIM 2.0 sunucu çekirdeği (BÖLÜNMEZ) — /scim/v2/Users + bearer auth + lisans kapsamı  (bağ: S11-a)
  S11-f [OPUS-XHIGH] SCIM yaşam döngüsü semantiği — create/suspend/deprovizyon + koltuk etkisi + audit  (bağ: S11-e)
  S11-g [SONNET-XHIGH] Settings → Security: SSO bağlantı ekranı + SCIM token üretimi (bir kez gösterilir)  (bağ: S11-a, S11-d, S11-e)
  S11-h [OPUS-MAX] SSO zorunlu kılma (BÖLÜNMEZ) — parola girişinin kapatılması + break-glass kilitlenme koruması  (bağ: S11-d, S11-g)
  S11-i [OPUS-XHIGH] Uçtan uca doğrulama — SAML login e2e + SCIM yaşam döngüsü + ret matrisi + cross-tenant  (bağ: S11-d, S11-f, S11-g, S11-h)

BAĞLAM KURULUMU (bu görev KOD YAZMAZ — alt-görevleri koşulur):
- PLAN §6.1.2 kalem kırılımı + bölünmeyen çekirdek gerekçeleri + varsayımlar + açık sorular
- PLAN §6.2 dilim sırası ve sıralamanın gerekçesi · PLAN §G Faz-3 düz tablosu
- CONVENTIONS DoD kapısı · TASK-RUNNER-PROMPT pencere protokolü
- Tam alan detayı her alt-görevin kendi `details` alanındadır (Faz-3'ün companion dosyası YOK — PLAN §D98)

SINIRLAR (CLAUDE.md): dış servisler MOCK · production deploy/DNS/TLS/gerçek secret/ödeme YOK ·
force-push/DB drop/history rewrite YOK · başka repoya dokunma YOK.

**Test Strategy:**

Her alt-görev KENDİ tam DoD kapısından geçer (CONVENTIONS §1): pnpm -w typecheck && pnpm -w lint && pnpm -w test && pnpm -w build && ilgili test:integration/test:e2e — hepsi exit 0. Kalem ancak son doğrulama alt-görevi (S11-i) yeşil olduğunda ✅ sayılır. Her alt-görevin kendi testStrategy alanı o pencerenin kapı komutlarını verir.

## Subtasks

### 81.1. S11-a [OPUS-XHIGH] sso_connections tablosu + RLS politikası + kontrat okuma yüzeyi

**Status:** done  
**Dependencies:** None  

sso_connections tablosu + RLS politikası + kontrat okuma yüzeyi

**Details:**

S11-a — sso_connections tablosu + RLS politikası + kontrat okuma yüzeyi  [OPUS-XHIGH]

PRD: S11 (PLAN §6.1 · dilim V3-1 · tm 81)
TAHMİN: ~1 pencere

NEDEN AÇIK: depoda SAML/SCIM'e ait hiçbir kod yok (`grep -rn "saml\|scim" apps/api/src/routes/` → 0 eşleşme). Federasyon yapılandırmasının duracağı yer yok.

**AMA MODEL KISMEN HAZIR (denetim bulgusu — bilmezsen gereksiz şema işi açarsın):** parolasız (SSO-only) hesap zaten modellenmiş — `apps/api/prisma/schema.prisma:124` `password_hash` yorumu _"Null for accounts that only sign in via SSO"_ ve `apps/api/src/lib/crypto.ts:66` parolasız hesapta sabit-zaman dalını yazıyor (_"No password set (SSO-only account). Burn comparable time anyway"_). Yani `S11-d`'nin JIT provizyonu ve `S11-h`'nin parola kapatma kararı bu var olan alanın üstüne oturur; yeni bir "parolasız hesap" kavramı İCAT EDİLMEZ.

KAPSAM: `sso_connections` tablosu (licenseId, name, idpEntityId, idpSsoUrl, idpCertificatePem, attributeMapping Json, allowIdpInitiated Bool @default(false), enabled) + RLS politikası + salt-okuma kontrat yüzeyi (`GET /settings/sso`). DAVRANIŞSIZ iskelet — doğrulama S11-b'de, uçlar S11-d'de.

DOSYALAR: `apps/api/prisma/schema.prisma` · yeni migration `apps/api/prisma/migrations/<ts>_sso_connections/migration.sql` · `packages/contract/openapi/paths/settings.yaml` · `packages/types/src/domain.ts` · `apps/api/src/routes/settings.ts`

REFERANS DESEN (birebir kopyalanacak): tm 80 alt-görev `08.9.6-b` — `ip_allowlist_entries` tablosu + RLS. Migration'daki policy kalıbı: `USING (license_id = siyahtus_current_license())`. Sertifika PEM'i bir SIR DEĞİLDİR (IdP'nin public sertifikası) — hash'lenmez, olduğu gibi saklanır; SCIM token'ı ise S11-e'de hash'lenir.

KAPSAM DIŞI: assertion doğrulama (S11-b), SP uçları (S11-d), SCIM (S11-e), ekran (S11-g).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 81.2. S11-a2 [OPUS-MAX] SSO bağlantısı YAZMA ucu (BÖLÜNMEZ) — sertifika/entityId yazımı + owner rol kapısı + rotasyon

**Status:** done  
**Dependencies:** 81.1  

SSO bağlantısı YAZMA ucu (BÖLÜNMEZ) — sertifika/entityId yazımı + owner rol kapısı + rotasyon

**Details:**

S11-a2 — SSO bağlantısı YAZMA ucu (BÖLÜNMEZ) — sertifika/entityId yazımı + owner rol kapısı + rotasyon  [OPUS-MAX]

PRD: S11 (PLAN §6.1.2 · dilim V3-1 · tm 81)
TAHMİN: ~2 pencere

BU ALT-GÖREV DENETİM BULGUSUYLA AÇILDI (PLAN §D99). Kırılımın ilk hâlinde `sso_connections` tablosunun YAZMA ucu hiçbir alt-görevin kapsamında değildi: `S11-a` "DAVRANIŞSIZ iskelet + salt-okuma", `S11-d` yalnız `/login`+`/acs`, `S11-h` yalnız `enforced` bayrağı. Ucu isteyen tek alt-görev `S11-g` idi — bir SONNET web ekranı. Yani dört OPUS-MAX çekirdeğin tamamının güvendiği IdP SERTİFİKASINI kimin, hangi rolle, hangi doğrulamayla yazdığı boşta kalmıştı.

BÖLÜNMEZ ÇEKİRDEK (PLAN §5.1.2). Gerekçe: IdP sertifikasını yazabilen aktör, o lisansta İSTEDİĞİ KİŞİ ADINA imzalı assertion üretebilir — yani tam hesap devralma. Sertifika yazımı, rol kapısı ve rotasyon semantiği tek bir güven-çapası akıl yürütmesidir; ayrılırsa "sertifika yazıldı ama rol kapısı sonraki turda" gibi bir ara sürüm doğar ve o sürümde bir `agent` federasyonu ele geçirebilir.

KAPSAM: `POST /settings/sso` + `PATCH /settings/sso/{id}` + `DELETE /settings/sso/{id}`.
- **Rol kapısı: yalnız `owner`** (admin YETMEZ — sertifika değişimi hesap devralmaya eşdeğerdir). `roleAtLeast` yerine kesin eşitlik.
- Sertifika doğrulaması: PEM ayrıştırılabilir, X.509, süresi geçmemiş; ayrıştırılamayan sertifika 4xx.
- **Rotasyon semantiği (yazılı olmalı):** yeni sertifika yazıldığında eski sertifika hemen geçersiz mi, yoksa bir geçiş penceresi boyunca ikisi de kabul mü edilir? Kırılım "iki sertifika listesi + geçiş penceresi" ÖNERİR (IdP rotasyonu sırasında kesinti olmasın diye); karar bu pencerede verilir ve §C'ye yazılır.
- `allowIdpInitiated` bayrağını yalnız `owner` açabilir.
- Audit: `settings.security_updated` (mevcut eylem, yeni eylem uydurma) + değişen alan adları metadata'da (SERTİFİKA İÇERİĞİ metadata'ya YAZILMAZ).

DOSYALAR: `apps/api/src/routes/settings.ts` · `packages/contract/openapi/paths/settings.yaml` · `apps/api/src/services/auth/principal.ts:77` (`roleAtLeast`) · `apps/api/src/services/audit/audit-log.ts`

REFERANS DESEN: tm 80 `08.9.6-d` (`/settings/ip-allowlist` CRUD + rol kapısı + audit + kontrat) — birebir aynı şekil, yalnız yazılan şey daha tehlikeli.

KAPSAM DIŞI: doğrulayıcı (S11-b), SP uçları (S11-d), SCIM (S11-e), ekran (S11-g — o SALT TÜKETİCİDİR, yeni uç açmaz).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 81.3. S11-b [OPUS-MAX] SAML assertion doğrulama çekirdeği (BÖLÜNMEZ) — imza + koşullar + replay + XSW

**Status:** done  
**Dependencies:** None  

SAML assertion doğrulama çekirdeği (BÖLÜNMEZ) — imza + koşullar + replay + XSW

**Details:**

S11-b — SAML assertion doğrulama çekirdeği (BÖLÜNMEZ) — imza + koşullar + replay + XSW  [OPUS-MAX]

PRD: S11 (PLAN §6.1 · dilim V3-1 · tm 81)
TAHMİN: ~3 pencere

BÖLÜNMEZ ÇEKİRDEK (PLAN §5.1.2 istisnası). Gerekçe: XML imza doğrulama, Conditions kontrolleri (Destination / Audience / NotOnOrAfter / NotBefore / InResponseTo) ve assertion-id replay reddi TEK bir güvenlik akıl yürütmesinin uçlarıdır. Ayrılırsa aradaki sürümde "imzası doğru ama Audience'ı başka kiracıya ait" veya "imzası doğru, aynı assertion ikinci kez" kabul edilir. XSW (XML Signature Wrapping) savunması hiç bölünemez: HANGİ düğümün imzalandığı ile HANGİ düğümün okunduğu AYNI kod yolunda kararlaştırılmalıdır — bu ikisini ayırmak XSW açığının tanımıdır.

KAPSAM: `apps/api/src/lib/saml.ts` — saf, DB'siz, ağsız doğrulayıcı. **SALDIRGAN TEST VARYANTLARI DA BU ALT-GÖREVE AİTTİR** (denetim bulgusu): imzasız · imzası bozuk · yanlış Audience/Destination · süresi geçmiş · replay · **ve özellikle XSW varyantları** (imzalı Assertion'ı `Extensions`'a taşıma · sarmalayıcı Response ekleme · `ID` referansı kaydırma — en az üç ayrı XSW şekli). Gerekçe: XSW bir saldırı modelleme işidir; varyantı üreten pencere ile savunmayı yazan pencere ayrılırsa naif bir varyant üretilir, test YEŞİL YANAR ve savunma hiç sınanmamış olur. `S11-c` yalnız İYİ-HUYLU fixture'ı (anahtar çifti + mutlu yol `issueAssertion`) sağlar ve BU alt-görevi BEKLEMEZ. Girdi: base64 SAMLResponse + beklenen (entityId, acsUrl, sertifika, inResponseTo?). Çıktı: doğrulanmış nitelikler VEYA tipli ret. Replay için tüketilen assertion id'lerinin kısa TTL'li kaydı (Redis, `lib/banned-ip.ts`'in Redis kullanım deseni).

KARAR (bu pencerenin İLK işi, §C'ye yazılacak): XML-DSig ELDE YAZILMAZ. Olgun bir kütüphane seçilir (`xml-crypto` + `@xmldom/xmldom` ya da eşdeğeri); imza doğrulamayı elden yazmak bu projenin kabul edebileceği bir risk değil. Kütüphane seçimi ve sürümü §C'ye assumption olarak yazılır.

DOSYALAR: `apps/api/src/lib/saml.ts` (yeni) + `apps/api/src/lib/saml.test.ts` · `apps/api/package.json`

REFERANS DESEN: tm 80 `08.9.6-c` (`lib/ip-allowlist.ts`) — saf algoritma + izin/ret semantiği, DB'siz, yoğun unit testli. Hata tipleri `packages/types/src/errors.ts` taksonomisinden seçilir; yeni tip eklenirse ADR-06'nın dört yerini birden güncelle (kontrat, types, api-error, test).

KAPSAM DIŞI: HTTP uçları, hesap eşleme, oturum verme (hepsi S11-d).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 81.4. S11-c [SONNET-XHIGH] Mock IdP harness — imzalı assertion üreteci + anahtar çifti fixture'ı

**Status:** done  
**Dependencies:** None  

Mock IdP harness — imzalı assertion üreteci + anahtar çifti fixture'ı

**Details:**

S11-c — Mock IdP harness — imzalı assertion üreteci + anahtar çifti fixture'ı  [SONNET-XHIGH]

PRD: S11 (PLAN §6.1 · dilim V3-1 · tm 81)
TAHMİN: ~1 pencere

NEDEN: dış IdP (Okta/Auth0/Azure AD) MOCK'tur (CLAUDE.md sınırı: dış servisler mock'lanır, gerçek secret yok). S11-d'nin ve S11-i'nin test edilebilmesi için imzalı assertion üretebilen bir harness gerekir.

KAPSAM (denetim sonrası DARALTILDI): `apps/api/test/helpers/mock-idp.ts` — sabit bir test anahtar çifti (repoya commit'lenir, ÜRETİM SIRRI DEĞİLDİR, dosya başında bu açıkça yazılır) + `issueAssertion({subject, attributes, audience, destination, inResponseTo, notOnOrAfter})` **MUTLU YOL** + `fixtures.ts` export'u.

**BOZUK/XSW VARYANTLARI BU ALT-GÖREVDE ÜRETİLMEZ** — onlar `S11-b`'nin (bölünmez OPUS-MAX çekirdek) parçasıdır. Gerekçe: saldırgan varyant üretmek bir saldırı modelleme işidir ve savunmanın testini çekirdekten ayırmak, çekirdeğin bölünmezlik gerekçesini fiilen deler. Bu yüzden **bağımlılık da kaldırıldı**: `S11-c` `S11-b`'yi BEKLEMEZ, ikisi paralel koşabilir.

DOSYALAR: `apps/api/test/helpers/mock-idp.ts` (yeni) · `apps/api/test/helpers/fixtures.ts` (export)

REFERANS DESEN: `apps/api/test/helpers/fixtures.ts` mevcut fixture kalıbı · `packages/ai-mock` deterministik mock felsefesi (aynı girdi → aynı çıktı, test flake yok).

KAPSAM DIŞI: gerçek IdP bağlantısı — YAPILMAZ.

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 81.5. S11-d [OPUS-MAX] SP uçları (BÖLÜNMEZ) — /auth/saml/{id}/login + /acs, hesap eşleme, JIT provizyon, oturum, audit

**Status:** done  
**Dependencies:** 81.1, 81.3, 81.4  

SP uçları (BÖLÜNMEZ) — /auth/saml/{id}/login + /acs, hesap eşleme, JIT provizyon, oturum, audit

**Details:**

S11-d — SP uçları (BÖLÜNMEZ) — /auth/saml/{id}/login + /acs, hesap eşleme, JIT provizyon, oturum, audit  [OPUS-MAX]

PRD: S11 (PLAN §6.1 · dilim V3-1 · tm 81)
TAHMİN: ~2 pencere

BÖLÜNMEZ ÇEKİRDEK (PLAN §5.1.2). Gerekçe: "assertion geçerli" ile "bu assertion ŞU hesaba karşılık gelir ve ona oturum verilir" arasındaki adım bir YETKİLENDİRME kararıdır. JIT provizyon (görülmemiş e-posta → yeni üyelik) aynı pencerede olmalıdır; ayrılırsa "doğrulanmış ama eşlenmemiş" bir ara durum doğar ve o durumun güvenli davranışı (reddet mi, aç mı) hiçbir yerde yazılı olmaz.

KAPSAM: `POST|GET /auth/saml/{connectionId}/login` (AuthnRequest üret + RelayState + InResponseTo saklama) · `POST /auth/saml/{connectionId}/acs` (S11-b ile doğrula → e-posta niteliğinden hesap eşle → yoksa JIT üyelik aç → oturum/token ver) · audit: `auth.sso_login` ve `auth.sso_login_failed` eylemlerinin `AUDIT_ACTIONS`'a eklenmesi.

DOSYALAR: `apps/api/src/routes/auth.ts` · `apps/api/src/services/auth/oauth-service.ts` (token verme yolu) · `apps/api/src/services/auth/token-service.ts` · `apps/api/src/services/audit/audit-log.ts` (AUDIT_ACTIONS:34) · `packages/contract/openapi/paths/auth.yaml`

REFERANS DESEN: `oauth-service.ts:343` `#issueGrant` — oturum verme yolu AYNEN yeniden kullanılır, ikinci bir token verme yolu AÇILMAZ. Audit çağrısı `writeAuditEntry` üzerinden ve `withTenant` içinde (audit-log.ts başlık yorumu).

KARARLAR: JIT provizyonda açılan üyeliğin rolü `agent` (en az yetki). IdP-initiated akış (InResponseTo YOK) yalnız `allowIdpInitiated=true` ise kabul edilir, varsayılan kapalı.

KAPSAM DIŞI: SCIM (S11-e/-f), SSO zorunlu kılma (S11-h), ekran (S11-g).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 81.6. S11-e [OPUS-MAX] SCIM 2.0 sunucu çekirdeği (BÖLÜNMEZ) — /scim/v2/Users + bearer auth + lisans kapsamı

**Status:** done  
**Dependencies:** 81.1  

SCIM 2.0 sunucu çekirdeği (BÖLÜNMEZ) — /scim/v2/Users + bearer auth + lisans kapsamı

**Details:**

S11-e — SCIM 2.0 sunucu çekirdeği (BÖLÜNMEZ) — /scim/v2/Users + bearer auth + lisans kapsamı  [OPUS-MAX]

PRD: S11 (PLAN §6.1 · dilim V3-1 · tm 81)
TAHMİN: ~2 pencere

BÖLÜNMEZ ÇEKİRDEK (PLAN §5.1.2). Gerekçe: SCIM'in kimlik doğrulaması ile kiracı kapsamı TEK bir kapıdır. Bir SCIM token'ı bütün bir kuruluşun kullanıcı yaşam döngüsünü yönetir; "token doğru mu" ile "hangi lisans için doğru" kararları ayrı pencerelere bölünürse çapraz-kiracı bir YAZMA yolu açık kalır — bu, okuma sızıntısından daha ağırdır.

KAPSAM: `/scim/v2/Users` (GET liste+filtre, GET tek, POST, PATCH, DELETE) + `/scim/v2/Groups` (GET, üyelik okuma) · bearer token kimlik doğrulama (token HASH'li saklanır) · her istek tek bir lisansa kapsamlanır · **SCIM TOKEN'INI BASAN VE İPTAL EDEN YÖNETİCİ UCU DA BU ALT-GÖREVE AİTTİR** (denetim bulgusu — sahipsiz kalmıştı): `POST /settings/scim-tokens` + `DELETE /settings/scim-tokens/{id}`, `owner|admin` rol kapısı, token bir kez döner ve bir daha okunamaz, audit (`pat.created`/`pat.revoked` muadili eylemler). Gerekçe: bir kuruluşun tüm kullanıcı yaşam döngüsünü yöneten kimlik bilgisini BASAN uç, onu DOĞRULAYAN uçla aynı güvenlik sınıfındadır; ekrana (`S11-g`, SONNET) bırakılamaz · SCIM'in kendi hata zarfı (RFC 7644 `urn:ietf:params:scim:api:messages:2.0:Error`) — ADR-06 zarfı SCIM yolunda KULLANILMAZ, bu bilinçli bir istisnadır ve §D'ye yazılır.

DOSYALAR: `apps/api/src/routes/scim.ts` (yeni) · `apps/api/src/services/auth/token-service.ts` (SCIM token türü) · `apps/api/prisma/schema.prisma` (`api_tokens.kind` CHECK genişlemesi: `pat|oauth|bot|scim`) + migration · `packages/contract/openapi/paths/scim.yaml` (yeni)

REFERANS DESEN: `api_tokens` token hash'leme (token-service.ts) · `plugins/auth.ts` onRequest kimlik çözümleme kalıbı · rate limit: SCIM ucu `plugins/rate-limit.ts` kapsamına alınır (ADR-07).

KAPSAM DIŞI: yaşam döngüsü semantiği (S11-f), token üretim ekranı (S11-g).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 81.7. S11-f [OPUS-MAX] SCIM yaşam döngüsü semantiği — create/suspend/deprovizyon + koltuk etkisi + audit

**Status:** done  
**Dependencies:** 81.6  

SCIM yaşam döngüsü semantiği — create/suspend/deprovizyon + koltuk etkisi + audit

**Details:**

S11-f — SCIM yaşam döngüsü semantiği — create/suspend/deprovizyon + koltuk etkisi + audit  [OPUS-MAX]

PRD: S11 (PLAN §6.1 · dilim V3-1 · tm 81)
TAHMİN: ~1 pencere

KAPSAM: SCIM işlemlerinin ürün anlamına bağlanması. create → `agent_memberships` satırı (rol `agent`); PATCH `active=false` → `suspended=true`; PATCH `active=true` → geri al; DELETE → deprovizyon (suspend, SİLME DEĞİL — §C varsayımı). Koltuk sayımının/faturanın etkilenmesi. Audit: mevcut `member.invited` / `member.suspended` / `member.unsuspended` eylemleri yeniden kullanılır (yeni eylem uydurulmaz).

DOSYALAR: `apps/api/src/routes/scim.ts` · `apps/api/src/services/billing/subscription-service.ts` (koltuk sayımı) · `apps/api/src/services/audit/audit-log.ts`

REFERANS DESEN: `apps/api/src/routes/agents.ts` — mevcut davet/suspend yolları; SCIM bunları YENİDEN YAZMAZ, aynı servis fonksiyonlarını çağırır. Aksi hâlde iki farklı "kullanıcı askıya al" yolu doğar ve biri audit yazmayı unutur.

KARAR: DELETE deprovizyonu SİLMEZ, suspend eder — atanmış sohbetlerin sahipliği ve audit izi korunsun diye (§C-A18, açık soru olarak da işaretli).

KAPSAM DIŞI: grup→rol otomatik eşlemesi (ayrı kalem, §D kaydı gerektirir).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

ETİKET YÜKSELTME GEREKÇESİ (denetim bulgusu, OPUS-XHIGH → OPUS-MAX): bu alt-görev DIŞ BİR IdP'NİN KOMUTUYLA lisansa yeni üyelik açıyor (`create → agent_memberships`, rol `agent`) ve üyelik askıya alıyor. `S11-e`'nin kapısından geçtikten SONRA verilen bu karar bir yetkilendirme kararıdır (§5.1.1 OPUS-MAX: erişim kontrolü). Ayrıca "suspend edilmiş kullanıcı giriş yapamaz" iddiasının ZORLAMASININ NEREDE olduğu yazılmalı: mevcut `suspended` kontrolü `oauth-service.ts` giriş yolunda mı, yoksa yeni mi eklenecek — bu pencerede tespit edilir ve testle kanıtlanır.

### 81.8. S11-g [SONNET-XHIGH] Settings → Security: SSO bağlantı ekranı + SCIM token üretimi (bir kez gösterilir)

**Status:** done  
**Dependencies:** 81.1, 81.2, 81.5, 81.6  

Settings → Security: SSO bağlantı ekranı + SCIM token üretimi (bir kez gösterilir)

**Details:**

S11-g — Settings → Security: SSO bağlantı ekranı + SCIM token üretimi (bir kez gösterilir)  [SONNET-XHIGH]

PRD: S11 (PLAN §6.1 · dilim V3-1 · tm 81)
TAHMİN: ~1 pencere

KAPSAM (denetim sonrası KESİNLEŞTİRİLDİ — bu alt-görev SALT TÜKETİCİDİR): Settings → Security altında SSO bölümü — IdP metadata girişi (entityId, SSO URL, sertifika PEM, attribute mapping) formu, "bağlantıyı doğrula" butonu, SCIM token üret/iptal et. Token ÜRETİLDİĞİ ANDA BİR KEZ gösterilir, sonra bir daha gösterilmez.

**YENİ SUNUCU UCU AÇMA — üçü de başka alt-görevlerin malıdır:**
- SSO bağlantısı YAZMA ucu → `S11-a2` (OPUS-MAX). Bu ekran onu ÇAĞIRIR.
- SCIM token basma/iptal ucu → `S11-e` (OPUS-MAX). Bu ekran onu ÇAĞIRIR.
- **"Bağlantıyı doğrula" butonu SUNUCUDAN IdP'YE AĞ İSTEĞİ ATMAZ** (denetim bulgusu: kullanıcı kontrolündeki URL'e sunucudan istek = SSRF). Doğrulama YERELDİR: sertifika PEM'i ayrıştırılabiliyor mu, entityId/SSO URL biçimsel olarak geçerli mi, attribute mapping zorunlu alanları taşıyor mu. Ağ testi isteniyorsa ayrı bir OPUS-MAX alt-görev + SSRF savunması gerekir; bu turda KAPSAM DIŞI.

DOSYALAR: `apps/web/src/features/settings/SsoConnection.tsx` (yeni) + test · `apps/web/src/features/settings/SettingsPage.tsx` (bölüm bağlama)

REFERANS DESEN (birebir): `apps/web/src/features/settings/IpAllowlist.tsx` (tm 80 `08.9.6-h`) — bölüm yerleşimi, form, liste, silme onayı. "Bir kez göster" kalıbı: `apps/web/src/features/developers/DeveloperPortal.tsx:480-484` `SecretOncePanel` (tm 72 · `09.4-e`) — partner app `client_secret`'ı için yazılmış, birebir aynı sözleşme. (Web tarafında PAT üretim ekranı YOKTUR; sunucu tarafı hash emsali `services/auth/token-service.ts`.) Form primitifi `lib/form.tsx` (EK-A.1), kirli form koruması `lib/dirty-guard.tsx` (EK-A.2) — yeni form kütüphanesi EKLENMEZ.

KAPSAM DIŞI: enforcement (S11-h), e2e (S11-i), her türlü yeni sunucu ucu (S11-a2 / S11-e).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 81.9. S11-h [OPUS-MAX] SSO zorunlu kılma (BÖLÜNMEZ) — parola girişinin kapatılması + break-glass kilitlenme koruması

**Status:** done  
**Dependencies:** 81.5, 81.8  

SSO zorunlu kılma (BÖLÜNMEZ) — parola girişinin kapatılması + break-glass kilitlenme koruması

**Details:**

S11-h — SSO zorunlu kılma (BÖLÜNMEZ) — parola girişinin kapatılması + break-glass kilitlenme koruması  [OPUS-MAX]

PRD: S11 (PLAN §6.1 · dilim V3-1 · tm 81)
TAHMİN: ~2 pencere

BÖLÜNMEZ ÇEKİRDEK (PLAN §5.1.2). Gerekçe: parola yolunu KAPATAN karar ile kilitlenme KAÇIŞ yolu birlikte tasarlanmalıdır. Ayrılırsa aradaki sürümde IdP'si bozulan bir kuruluş kendi hesabından tamamen dışarıda kalır ve bunu düzeltebilecek hiç kimse kalmaz. Bu hata bu depoda BİR KEZ önlendi: tm 80 `08.9.6-d` self-lockout guard'ı tam olarak bunun için yazıldı — emsal odur.

KAPSAM: `sso_connections.enforced` bayrağı; açıkken o lisanstaki parola girişi (`POST /auth/login`) reddedilir. BREAK-GLASS: en az bir `owner` her zaman parolayla girebilir VEYA enforcement açılırken doğrulanmış bir kaçış yolu (kurtarma kodu) üretilir — hangisi seçilirse §C'ye yazılır. Enforcement açma işlemi `settings.security_updated` audit'i yazar.

DOSYALAR: `apps/api/src/routes/auth.ts` · `apps/api/src/services/auth/oauth-service.ts:92` (`authenticateAccount`) · `apps/api/src/routes/settings.ts` · `apps/web/src/features/settings/SsoConnection.tsx`

REFERANS DESEN: tm 80 `08.9.6-d` self-lockout guard — "kendini dışarıda bırakacak yapılandırmayı reddet" kalıbı.

KAPSAM DIŞI: e2e (S11-i).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 81.10. S11-i [OPUS-XHIGH] Uçtan uca doğrulama — SAML login e2e + SCIM yaşam döngüsü + ret matrisi + cross-tenant

**Status:** done  
**Dependencies:** 81.5, 81.7, 81.8, 81.9  

Uçtan uca doğrulama — SAML login e2e + SCIM yaşam döngüsü + ret matrisi + cross-tenant

**Details:**

S11-i — Uçtan uca doğrulama — SAML login e2e + SCIM yaşam döngüsü + ret matrisi + cross-tenant  [OPUS-XHIGH]

PRD: S11 (PLAN §6.1 · dilim V3-1 · tm 81)
TAHMİN: ~1 pencere

KAPSAM: kalemin KK'sının uçtan uca kanıtı. (1) e2e: SSO yapılandır → mock IdP ile giriş → panele düş (kanıt PNG `apps/e2e/kanit/S11-sso-login.png`). (2) SCIM yaşam döngüsü integration: provizyon → giriş → deprovizyon → giriş reddi. (3) RET MATRİSİ integration seviyesinde tekrar: imzasız · yanlış Audience · süresi geçmiş · replay · XSW. (4) cross-tenant negatif matrisi.

DOSYALAR: `apps/e2e/tests/sso.spec.ts` (yeni) · `apps/api/test/integration/sso.test.ts` · `apps/e2e/kanit/`

REFERANS DESEN: `apps/e2e/tests/settings.spec.ts` + `apps/e2e/tests/team.spec.ts`; kanıt PNG adlandırması `<kod>-<isim>.png` (mevcut 71 PNG'nin kalıbı). e2e sabit portlarda seed'lenmiş `siyahtus` veritabanını sürer — iki pencere aynı anda e2e koşamaz.

KAPI: bu alt-görev yeşile dönmeden kalem ✅ olmaz.

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

**YETKİ REDDİ NEGATİFİ (denetim bulgusu K1-2 · ZORUNLU):** SSO/SCIM uçlarının `sso` yetkisi olmadan (`growth` planı) ilgili uçlar **REDDEDİLMELİDİR**. Bu test bu alt-görevin süitindedir; kapı `11.5-b`'de kurulur (tm 84). `tm 84` bu kalemden SONRA koşacaksa test önce `skip` değil, **kapı kurulana kadar kırmızı bırakılmaz** — sıralama gereği `11.5-b` daha önce bitmiş olmalıdır (bkz. §6.2 bağımlılık notu).
