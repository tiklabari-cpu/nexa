# Task ID: 72

**Title:** 09.4 — Zapier/Make + Build-your-app  ·  dilim V2-7

**Status:** done

**Dependencies:** 34 ✓, 78 ✓

**Priority:** low

**Description:** FR-MOD-09.4 · Could (v2) · MOD-08.8.4.

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `FR-MOD-09.4`.

7 atomik alt-görev · ~8 pencere · etiket dağılımı: OPUS-MAX x1 · OPUS-XHIGH x2 · SONNET-XHIGH x4

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  09.4-a [SONNET-XHIGH] Zapier + Make marketplace kartları ve katalog sınır güncellemesi  (bağ: yok)
  09.4-b [SONNET-XHIGH] Entegrasyon manifesti (trigger + action kataloğu): kontrat + statik endpoint  (bağ: yok)
  09.4-c [OPUS-MAX] Partner app kaydı çekirdeği: oauth_clients self-servis CRUD (client_id / secret_hash / redirect_uri allowlist / scope daraltma / org izolasyonu)  (bağ: yok)
  09.4-d [OPUS-XHIGH] Partner app secret rotate + denetim izi (partner_app.* audit olayları)  (bağ: 09.4-c)
  09.4-e [SONNET-XHIGH] Developer portal kabuğu: partner app listesi + kayıt formu + 'secret bir kez' paneli  (bağ: 09.4-c)
  09.4-f [SONNET-XHIGH] Portal'da Zapier REST Hooks yüzeyi: webhook aboneliği yönetimi + trigger manifesti + secret rotate düğmesi  (bağ: 09.4-b, 09.4-d, 09.4-e)
  09.4-g [OPUS-XHIGH] Uçtan uca partner akışı doğrulaması: kayıtlı client ile OAuth 2.1 authorize→token + cross-tenant/negatif kapanış  (bağ: 09.4-c, 09.4-d, 09.4-e, 09.4-f)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): 09.4-c (partner app kaydı çekirdeği) bölünmez. Üç kısıt tek bağlamda tutulmak zorunda: (1) üretilen secret'ın saklanma formatı `hashToken(secret)` olmak ZORUNDA çünkü mevcut `OauthService.#authenticateClient` (apps/api/src/services/auth/oauth-service.ts:328-340) `constantTimeEqual(hashToken(clientSecret), client.secret_hash)` ile doğruluyor — format ayrı pencerede kararlaştırılırsa üretilen client `/auth/token` akışında sessizce çalışmaz; (2) `redirect_uris` kayıt-anı doğrulaması, `OauthService.isRegisteredRedirect` (oauth-service.ts:130-140) TAM EŞLEŞME beklediği için normalize etmemek zorunda — doğrulama ile eşleştirme aynı akıl yürütmenin iki ucu; (3) scope daraltma (kaydeden principal'ın sahip olmadığı scope client'a verilemez) + org-scoped RLS izolasyonu (404, 403 değil) aynı route'ta karar veriliyor. Bu üçü ayrılırsa open-redirect / yetki genişlemesi / sessiz kimlik doğrulama kırılması riskleri pencereler arasına düşer. Çekirdeğin ETRAFINDAKİ her şey (katalog kartı, manifest, rotate+audit, portal UI, webhook UI, uçtan uca doğrulama) ayrı ve daha ucuz etiketli alt-görevlere çıkarıldı.

VARSAYIMLAR: KK YORUMU (kk_yetersiz=true): '700+ Zapier' inşa edilebilir bir kabul kriteri değildir — Zapier'in kendi ekosistemindeki app sayısını ifade eder. Kilitli yorum: SiyahTuş 700 entegrasyon YAZMAZ; Zapier/Make platformunda TEK bir SiyahTuş app'i yayınlanabilir olacak şekilde (i) katalogda Zapier+Make kartı, (ii) makine-okunur trigger/action manifesti, (iii) REST Hooks subscribe/unsubscribe yüzeyi (mevcut /webhooks) teslim edilir. Bu, orkestratörün 'katalog/deseni kanıtla, hepsini yazma' kararının birebir karşılığıdır. · SCOPE KARARI: partner app yönetimi için YENİ OAuth scope EKLENMEZ; mevcut `access_rules:ro`/`access_rules:rw` yeniden kullanılır (routes/apps.ts:45,55 ile aynı yönetici yüzeyi). Gerekçe: (a) yeni scope packages/types/src/scopes.ts + scopes.test.ts (SIYAHTUS_ADDED_SCOPES dizisi + SOURCE_SCOPE_COUNT=58) + principal.ts + openapi regen dörtlüsünü senkron güncellemeyi zorunlu kılar; (b) daha önemlisi, yeni bir scope üçüncü-taraf token'lara verilebilir hale gelir ve birinci-parti workspace admin yetkisiyle üçüncü-parti geliştirici yetkisini karıştırma (IDOR/yetki genişlemesi, NFR-S5) riski doğurur. Karar §C'ye yazılır. · KATALOG SINIRI SAPMASI: FR-MOD-09.2 KK'sı 'Tam entegrasyon listesi (15–20 kart)' diyor ve iki test bu sınırı kilitliyor (packages/types/src/apps.test.ts:39-40, apps/api/test/integration/apps.test.ts:196-197). Zapier+Make eklenince katalog 22'ye çıkar; sınır 15–22'ye yükseltilir ve testin başlık/yorumuna gerekçe yazılır: '15–20' v1 (09.2) veri/kanal listesiydi, 22 = + v2 (09.4) otomasyon platformu kartları. Bilinçli sapma, §D'ye kaydedilir. · MODELLEME: Zapier ve Make, APP_CATALOG'un mevcut ikili bölünmesini (channel app / data app) bozmamak için DATA app olarak modellenir (dataLabel + dataFields dolu). Alternatif — AppCatalogEntry'ye üçüncü bir 'automation' kipi eklemek — tip + partition testi + marketplace grid değişikliği gerektirdiği için reddedildi (daha pahalı, güvenlik değeri yok). · PARTNER APP KAYDI KİMLİK DOĞRULAMALIDIR: RFC 7591 tarzı kimliksiz/

AÇIK SORULAR (ürün kararı): Kaynak izlenebilirliği kırık: PRD satır 667'nin Kaynak sütunu 'v2-05' dosyasına atıf yapıyor ama depoda böyle bir dosya yok (find → 0) ve v2-derin-analiz/01-04 dosyalarının hiçbirinde Zapier/Make/partner/build-your-app geçmiyor. Bu kalemin gereksinimleri yalnız PRD tek satırından türetildi — kullanıcı onayı gerekir mi, yoksa türetilmiş KK'lar (§C) yeterli mi? · Partner app yönetimi için `access_rules:rw` yeniden kullanımı onaylanıyor mu, yoksa ayrı bir `oauth_clients--all:ro/:rw` scope çifti mi isteniyor? Ayrı scope, birinci-parti/üçüncü-parti yetki ayrımını netleştirir ama dört noktalı senkron (scopes.ts + scopes.test.ts + principal.ts + openapi regen) ve yeni bir devredilebilir yetki yüzeyi getirir. Varsayılan karar: yeniden kullan. · APP_CATALOG'un 15–20 üst sınırının 22'ye çıkarılması (FR-MOD-09.2 KK'sından sapma) kabul mü, yoksa Zapier/Make ayrı bir `AUTOMATION_CATALOG` sabitinde mi tutulsun? İkincisi 09.2 KK'sını bozmaz ama katalog tek-doğruluk-kaynağını ikiye böler ve marketplace grid'inde iki kaynağı birleştirmek gerekir. · Portal'da PAT (personal access token) üretme ekranı bu kaleme dahil edilsin mi? API tam olarak mevcut (apps/api/src/routes/auth.ts:396-500: list/create/revoke, escalation guard'lı) ama UI hiç yok. Bu FR-MOD-08.8.2 boşluğu; partner portalının doğal önkoşulu ama bu kalemin doğrudan kapsamı değil — ayrı bir kalem olarak mı açılsın? · WEBHOOK_ACTIONS bugün 5 aksiyon (chat_started, chat_deactivated, chat_transferred, event_created, ticket_created). Zapi

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 72.1. 09.4-a [SONNET-XHIGH] Zapier + Make marketplace kartları ve katalog sınır güncellemesi

**Status:** done  
**Dependencies:** None  

Kontrat/migration yok, yalnız veri + test sınırı. (1) packages/types/src/apps.ts APP_CATALOG'a iki AppCatalogEntry: `zapier` (category 'productivity', provider 'oauth') ve `make` (category 'productivity', provider 'api_key'). (2) Her ikisi de DATA app olarak modellenir — `dataLabel` + `dataFields` DOLU olmak zorunda, çünkü apps.test.ts:53 `channelled.length + data.length === APP_CATALOG.length` pa

**Details:**

09.4-a — Zapier + Make marketplace kartları ve katalog sınır güncellemesi  [SONNET-XHIGH]

PRD: FR-MOD-09.4 (+ FR-MOD-09.2 katalog sınırı)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 3 dosya (1 kaynak + 2 test); güvenlik sınırı YOK (saf statik katalog verisi, hiçbir route/scope/tenant yolu değişmiyor, koşul 2 ✅); eşzamanlılık/transaction akıl yürütmesi yok (koşul 3 ✅); kopyalanacak desen ismen var: packages/types/src/apps.ts 'slack' girdisi (satır 266-279) ve 'jira' (280-292) (koşul 4 ✅); kontrat değişikliği yok — katalog mevcut GET /settings/apps yanıtında taşınıyor (koşul 5 ✅); KK mekanik doğrulanabilir: katalogda iki yeni id + partition invariantı (koşul 6 ✅).
NEDEN AÇIK: Olgu: `grep -rli zapier apps/ packages/` (dist source-map gürültüsü hariç) 0 gerçek kod eşleşmesi. Koda karşı doğrulandı: packages/types/src/apps.ts APP_CATALOG tam 20 girdi taşıyor (satır 93 'hubspot' … satır 350 'twilio-sms'); Zapier/Make kartı yok. Ayrıca iki test bu sayıyı kilitliyor: packages/types/src/apps.test.ts:39-40 (>=15 && <=20) ve apps/api/test/integration/apps.test.ts:196-197 (aynı sınır) — iki kart eklemek bu iki iddiayı KIRAR, güncellenmesi bu alt-görevin işidir.
KAPSAM: Kontrat/migration yok, yalnız veri + test sınırı. (1) packages/types/src/apps.ts APP_CATALOG'a iki AppCatalogEntry: `zapier` (category 'productivity', provider 'oauth') ve `make` (category 'productivity', provider 'api_key'). (2) Her ikisi de DATA app olarak modellenir — `dataLabel` + `dataFields` DOLU olmak zorunda, çünkü apps.test.ts:53 `channelled.length + data.length === APP_CATALOG.length` partition invariantını ve apps.test.ts:31-32 `dataFields.length > 0` + `options.length > 0` iddialarını taşıyor; alanlar otomasyon-lezzetli mock olur (ör. 'Last zap run', 'Active zaps'). (3) İki testteki üst sınır 20 → 22 yükseltilir ve '(15–20 cards)' başlığı '(15–22 cards)' yapılıp gerekçe yorumu yazılır (09.2 v1 listesi + 09.4 otomasyon kartları). (4) Kart açıklaması partner portalına gönderme yapar (metin; link 09.4-e'de).
DOSYALAR: packages/types/src/apps.ts · packages/types/src/apps.test.ts · apps/api/test/integration/apps.test.ts
REFERANS DESEN (kopyalanacak): packages/types/src/apps.ts (satır 266-279 'slack' girdisi — productivity/oauth/dataLabel/dataFields tam şekli; satır 280-292 'jira') · packages/types/src/apps.test.ts (satır 36-56 katalog sınırı + partition iddiaları)
KK (birebir): "700+ Zapier" | "KK-türetilmiş: bu alt-görevin payı = 'Zapier ve Make marketplace kataloğunda görünür bir entegrasyon kartı olarak yer alır'. Türetildi çünkü PRD KK'sındaki '700+ Zapier' Zapier'in kendi ekosistemindeki app sayısıdır (kk_yetersiz=true); SiyahTuş'un 700 entegrasyon yazması anlamına gelmez, katalogda Zapier/Make'in varlığı anlamına gelir."
KK DOĞRULAMA: `pnpm --filter @siyahtus/types test` → apps.test.ts: APP_CATALOG'ta 'zapier' ve 'make' id'leri var, id'ler benzersiz (satır 18), partition invariantı (satır 53) korunuyor, yeni sınır (15–22) yeşil. `apps/api/test/integration/apps.test.ts` → GET /settings/apps yanıtında iki kart listeleniyor, sınır iddiası yeşil. apps/web AppsMarketplace.test.tsx regresyonu yeşil (grid otomatik render eder).
KAPSAM DIŞI: Gerçek Zapier/Make OAuth handshake — dış servis MOCK (MASTER-PROMPT §5) · Trigger/action manifesti (09.4-b) · Partner app kaydı ve oauth_clients yazma yolu (09.4-c) · Marketplace 'Connect' akışının davranışı (09.1/09.2, tm 53 — done)
SÖZLEŞME: yok — katalog mevcut `GET /settings/apps` yanıtında taşınıyor, yeni OpenAPI path'i eklenmez. Yeni path eklenmediği için contract-parity.test.ts bu alt-görevden etkilenmez.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 72.2. 09.4-b [SONNET-XHIGH] Entegrasyon manifesti (trigger + action kataloğu): kontrat + statik endpoint

**Status:** done  
**Dependencies:** None  

Contract-first, tek pencerede kontrat+backend (parity çift yönlü olduğu için ayrılamaz). (1) `packages/types/src/integrations.ts` (yeni): `INTEGRATION_TRIGGERS` — WEBHOOK_ACTIONS'ın her aksiyonu için {action, label, description, sample_payload}; `INTEGRATION_ACTIONS` — Zapier 'action' karşılığı, mevcut route'lardan seçilmiş METADATA listesi (ör. mesaj gönder, ticket oluştur, etiket ekle: {id, meth

**Details:**

09.4-b — Entegrasyon manifesti (trigger + action kataloğu): kontrat + statik endpoint  [SONNET-XHIGH]

PRD: FR-MOD-09.4 (+ NFR-S3 mevcut scope korunur)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — ~6 dosya (tip + kontrat + route + test); güvenlik sınırı YOK: endpoint STATİK bir sabiti döndürür, hiçbir tenant verisi okumaz, hiçbir istek gövdesi parse etmez, MEVCUT `webhooks--all:ro/:rw` scope'unu yeniden kullanır — yeni yetki yüzeyi açmaz (koşul 2 ✅); eşzamanlılık yok (koşul 3 ✅); kopyalanacak desen ismen var: routes/webhooks.ts GET deseni + packages/types/src/apps.ts statik katalog deseni (koşul 4 ✅); kontrat değişikliği katkısal ve mekanik (koşul 5 ✅); KK mekanik: manifest her WEBHOOK_ACTION'ı içeriyor mu (koşul 6 ✅).
NEDEN AÇIK: Koda karşı: WEBHOOK_ACTIONS tam 5 aksiyon içeriyor — `chat_started`,`chat_deactivated`,`chat_transferred`,`event_created`,`ticket_created` (apps/api/src/services/webhooks/webhook-service.ts:27-33), ama abone olunabilir olayların makine-okunur listesi + örnek payload'u hiçbir yerde YAYINLANMIYOR: `ls packages/contract/openapi/paths/` 23 yaml döndürüyor, integrations/manifest yok. Zapier'in REST Hooks modeli (subscribe=POST /webhooks, unsubscribe=DELETE /webhooks/{webhookId}) mevcut routes/webhooks.ts üstüne DOĞRUDAN oturuyor (HMAC+SSRF tm 34'te üretimde) — eksik olan tek şey, Zapier/Make app tanımının üretilebilmesi için trigger/action listesinin makine-okunur yayınlanması.
KAPSAM: Contract-first, tek pencerede kontrat+backend (parity çift yönlü olduğu için ayrılamaz). (1) `packages/types/src/integrations.ts` (yeni): `INTEGRATION_TRIGGERS` — WEBHOOK_ACTIONS'ın her aksiyonu için {action, label, description, sample_payload}; `INTEGRATION_ACTIONS` — Zapier 'action' karşılığı, mevcut route'lardan seçilmiş METADATA listesi (ör. mesaj gönder, ticket oluştur, etiket ekle: {id, method, path, label, required_scopes}); hiçbir çağrı yapılmaz. packages/types/src/index.ts'ten dışa aktarılır. (2) Route: `GET /integrations/manifest` → {triggers, actions, subscribe:{method:'POST',path:'/webhooks'}, unsubscribe:{method:'DELETE',path:'/webhooks/{webhookId}'}}; scope `['webhooks--all:ro','webhooks--all:rw']` (MEVCUT, yeni scope eklenmez). (3) Kontrat: packages/contract/openapi/paths/webhooks.yaml'a operasyon + openapi.yaml'a `IntegrationManifest` şeması + re-bundle. (4) Manifest ↔ WEBHOOK_ACTIONS senkron testi (aksiyon eklenip manifeste yazılmazsa test kırılır).
DOSYALAR: packages/types/src/integrations.ts · packages/types/src/index.ts · packages/contract/openapi/paths/webhooks.yaml · packages/contract/openapi/openapi.yaml · apps/api/src/routes/webhooks.ts · apps/api/test/integration/webhooks.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/webhooks.ts (satır 49-56 — GET + scope config + reply.send({items}) deseni) · packages/types/src/apps.ts (statik katalog sabiti + tip tanımı + dosya başı gerekçe yorumu deseni) · packages/contract/openapi/paths/apps.yaml (katalog döndüren GET operasyonunun kontrat şekli)
KK (birebir): "700+ Zapier" | "KK-türetilmiş: '700+ Zapier'ın inşa edilebilir karşılığı = Zapier/Make platformunda TEK bir SiyahTuş app'i yayınlanabilir olmalı; bunun için SiyahTuş'un trigger ve action kataloğunu makine-okunur yayınlaması yeterlidir. Türetildi çünkü PRD KK'sı ölçülebilir bir kabul kriteri değil (kk_yetersiz=true) ve literal okunursa 700 ayrı entegrasyon yazma hatasına götürür."
KK DOĞRULAMA: `apps/api/test/integration/webhooks.test.ts` — GET /integrations/manifest yanıtındaki trigger listesi WEBHOOK_ACTIONS ile BİREBİR aynı kümedir (senkron testi), her trigger bir sample_payload taşır, actions listesi boş değil ve her action'ın required_scopes'u geçerli scope'lardan oluşur (isScope). `contract-parity.test.ts` yeşil (belgelenmiş operasyon servis ediliyor, servis edilen operasyon belgelenmiş).
KAPSAM DIŞI: Yeni WEBHOOK_ACTION eklemek (teslimat yolu + payload üretimi gerektirir, ayrı iş) · Zapier/Make tarafındaki app tanımının kendisi (dış platform, depo dışı) · Webhook teslimat/retry davranışı (08.8.4-d, tm 34 — done) · Portal UI'da manifestin gösterimi (09.4-f)
SÖZLEŞME: YENİ: `GET /integrations/manifest` — packages/contract/openapi/paths/webhooks.yaml'a operasyon + openapi.yaml'a `IntegrationManifest`/`IntegrationTrigger`/`IntegrationAction` şemaları. UYARI: OpenAPI'ye eklenip re-bundle edilmezse contract-parity.test.ts KIRILIR; parity ÇİFT YÖNLÜ çalışıyor (contract-parity.test.ts dosya başı: 'an undocumented route fails, and so does a documented route that nothing serves') — kontrat ve route AYNI pencerede gitmek zorunda, kontrat-önce ayrı alt-görev YAPILAMAZ.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 72.3. 09.4-c [OPUS-MAX] Partner app kaydı çekirdeği: oauth_clients self-servis CRUD (client_id / secret_hash / redirect_uri allowlist / scope daraltma / org izolasyonu)

**Status:** done  
**Dependencies:** None  

Contract-first, tek pencerede kontrat+backend (parity çift yönlü). Kontrat → `packages/contract/openapi/paths/partner-apps.yaml` (yeni): `POST /partner/apps`, `GET /partner/apps`, `GET /partner/apps/{clientId}`, `PATCH /partner/apps/{clientId}`, `DELETE /partner/apps/{clientId}` + openapi.yaml'a `PartnerApp` / `PartnerAppRegistration` şemaları + re-bundle. Servis `apps/api/src/services/partner/par

**Details:**

09.4-c — Partner app kaydı çekirdeği: oauth_clients self-servis CRUD (client_id / secret_hash / redirect_uri allowlist / scope daraltma / org izolasyonu)  [OPUS-MAX]

PRD: FR-MOD-09.4 (+ NFR-S1, NFR-S2, NFR-S3, NFR-S4, NFR-S5, NFR-S8; PRD §8.4 satır 973 oauth_clients DDL; PRD satır 244 'P4 — Developer/Partner')
ETİKET GEREKÇESİ: OPUS-MAX: koşul 2 ihlali — bu alt-görev üçüncü-taraf bir KİMLİK DOĞRULAMA yüzeyi açıyor: client secret üretimi ve hash'lenerek saklanması (NFR-S2), redirect_uri allowlist doğrulaması (open-redirect sınırı, NFR-S3), scope yükseltme engeli (NFR-S5), organization-scoped tenant izolasyonu (NFR-S4). Yanlış kararın maliyeti yüksek: secret formatı mevcut `#authenticateClient` doğrulamasıyla uyuşmazsa üretilen client sessizce çalışmaz. Çekirdek bölünmez (bkz. bolunmeyen_gerekce); etrafındaki tüm yüzeyler 09.4-a/-b/-d/-e/-f/-g'ye çıkarıldı.
NEDEN AÇIK: Koda karşı doğrulandı ve toplanan olgudaki '0 tüketici' ifadesi DÜZELTİLDİ: `grep -rn oauthClient apps/api/src` → 0 sonuç, yani oauth_clients satırı YAZAN/GÜNCELLEYEN hiçbir route veya servis yok; tablo yalnız `apps/api/prisma/seed.ts:487` fixture'ından doluyor. Ama OKUMA yolu VAR: `OauthService.findClient` (apps/api/src/services/auth/oauth-service.ts:115-120) `auth_find_client()` SECURITY DEFINER fonksiyonunu çağırıyor ve `POST /auth/authorize` (apps/api/src/routes/auth.ts:211-218) bunu tüketip redirect_uri allowlist + scope daraltma uyguluyor. Eksik olan TEK şey self-servis YAZMA yolu. Altyapı hazır: `oauth_clients` tablosu schema.prisma:151-170'te PRD DDL'iyle birebir; org-scoped RLS politikası migration 20260722151255 satır 392-395'te (`organization_id = siyahtus_current_organization()` USING+WITH CHECK); `withTenant` `app.current_organization` GUC'unu set ediyor (apps/api/src/lib/tenant.ts:60); `generateClientId()` apps/api/src/lib/crypto.ts:157'de tanımlı ve src'de 0 tüketicili.
KAPSAM: Contract-first, tek pencerede kontrat+backend (parity çift yönlü). Kontrat → `packages/contract/openapi/paths/partner-apps.yaml` (yeni): `POST /partner/apps`, `GET /partner/apps`, `GET /partner/apps/{clientId}`, `PATCH /partner/apps/{clientId}`, `DELETE /partner/apps/{clientId}` + openapi.yaml'a `PartnerApp` / `PartnerAppRegistration` şemaları + re-bundle. Servis `apps/api/src/services/partner/partner-app-service.ts` (yeni), route `apps/api/src/routes/partner-apps.ts` (yeni), server.ts'e kayıt. GÜVENLİK ÇEKİRDEĞİ (altı madde, tek bağlamda): (1) client_id = `generateClientId()` (crypto.ts:157) — tahmin edilemez, org kimliği sızdırmaz. (2) secret YALNIZ `client_type='confidential'` için üretilir; saklanan değer `hashToken(secret)` — format ZORUNLU çünkü `OauthService.#authenticateClient` (oauth-service.ts:328-340) `constantTimeEqual(hashToken(clientSecret), client.secret_hash)` ile doğruluyor; `client_type='public'` ise secret_hash null kalır (OAuth 2.1 PKCE). Secret yanıtta BİR KEZ döner (`Cache-Control: no-store`), list/get onu ASLA seçmez (webhook-service.ts SAFE_SELECT deseni). (3) redirect_uris allowlist doğrulaması: mutlak URI, yalnız `https` (dev istisnası `http://localhost` / `http://127.0.0.1` açıkça izinli), fragment yok, wildcard yok, kullanıcı-bilgisi (`user:pass@`) yok, en az 1 en fazla N adet; kayıtta NORMALIZE EDİLMEZ çünkü `isRegisteredRedirect` (oauth-service.ts:130-140) tam string eşleşmesi bekliyor. (4) scope daraltma: kaydeden principal'ın SAHİP OLMADIĞI scope client'a verilemez — auth.ts:429-438 PAT escalation guard deseni birebir; `isScope` süzgeci; boş küme → 400. (5) izolasyon: tüm sorgular `request.withTenant` içinde (org-scoped RLS); başka organizasyonun clientId'si için 404 (403 DEĞİL — id enumerasyonu engellenir, NFR-S5); silme `deleteMany` + count=0 → 404 (webhooks.ts:83-86 deseni). (6) scope kararı: YENİ SCOPE EKLENMEZ — `access_rules:ro` / `access_rules:rw` yeniden kullanılır (routes/apps.ts:45,55 ile aynı yönetici yüzeyi).
DOSYALAR: packages/contract/openapi/paths/partner-apps.yaml · packages/contract/openapi/openapi.yaml · apps/api/src/routes/partner-apps.ts · apps/api/src/services/partner/partner-app-service.ts · apps/api/src/server.ts · apps/api/test/integration/partner-apps.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/webhooks.ts + apps/api/src/services/webhooks/webhook-service.ts (secret bir kez döner + SAFE_SELECT ile asla yeniden seçilmez + deleteMany→404 izolasyon deseni) · apps/api/src/routes/campaigns.ts (Zod .strict() CRUD + PATCH kısmi güncelleme + parse() hata sarmalayıcı) · apps/api/src/routes/auth.ts satır 422-478 (PAT: scope escalation guard + Cache-Control no-store + kimlik bilgisi yalnız yanıtta) · apps/api/src/services/auth/oauth-service.ts satır 115-150 ve 328-340 (client kaydının şekli + secret doğrulama + redirect eşleşme kuralı)
KK (birebir): "partner/creator portalı" | "KK-türetilmiş: bu alt-görevin payı = 'bir geliştirici kendi uygulamasını kaydedebilir: display_name + redirect_uris + scope verir, client_id alır, confidential ise client secret'ını bir kez görür'. Türetildi çünkü PRD KK'sı yalnız portalın varlığını söylüyor, alan/akış listesi vermiyor (kk_yetersiz=true); alanlar PRD §8.4 satır 973 DDL'inden (oauth_clients: display_name, secret_hash, redirect_uris, client_type, scopes) alındı."
KK DOĞRULAMA: `apps/api/test/integration/partner-apps.test.ts` (NEGATİFLER ÖNCE, kırmızı görülür): (n1) başka organizasyonun clientId'si ile GET/PATCH/DELETE → 404 (403 değil); (n2) `http://evil.example.com` / `https://a.example.com/*` / `https://a.example.com#frag` / göreli URI → 400; (n3) kaydeden principal'ın sahip olmadığı scope istenirse → 403; (n4) `GET /partner/apps` ve `GET /partner/apps/{id}` yanıtlarında `secret` alanı YOK; (n5) `access_rules:rw` taşımayan ajan token'ı ile POST → 403. POZİTİF: (p1) kayıt 201 döner ve secret tam bir kez gelir; (p2) dönen client_id+secret ile `POST /auth/token` client doğrulaması GEÇER — secret_hash format uyumunun kanıtı, çekirdeğin en kritik iddiası. `contract-parity.test.ts` yeşil.
KAPSAM DIŞI: Secret rotate + audit izi (09.4-d) · Developer portal UI (09.4-e) · Yeni OAuth scope tanımı — bilinçli olarak YAPILMIYOR (bkz. varsayımlar) · RFC 7591 dinamik/kimliksiz client kaydı — açılmaz; kayıt daima kimlik doğrulamalı ve access_rules:rw kapılı · Prisma migration — oauth_clients tablosu, RLS politikası ve auth_find_client zaten mevcut · Zapier/Make katalog kartı (09.4-a) ve manifest (09.4-b)
SÖZLEŞME: YENİ: `packages/contract/openapi/paths/partner-apps.yaml` (5 operasyon: POST/GET /partner/apps, GET/PATCH/DELETE /partner/apps/{clientId}) + openapi.yaml'a `PartnerApp` (secret'sız) ve `PartnerAppRegistration` (secret'lı, yalnız POST yanıtı) şemaları. UYARI: OpenAPI'ye eklenip re-bundle edilmezse contract-parity.test.ts KIRILIR; parity çift yönlü olduğu için kontrat ve route AYNI pencerede gitmek zorunda. `@siyahtus/types` regenerate edilir.
MIGRATION: yok — `oauth_clients` tablosu (schema.prisma:151-170, PRD §8.4 satır 973 DDL'iyle birebir), org-scoped RLS politikası `oauth_clients_tenant` ve `auth_find_client()` fonksiyonu migration 20260722151255_auth_and_tenancy'de zaten mevcut. Yeni kolon/tablo GEREKMEZ. Risk notu: bugün tabloyu yalnız seed.ts dolduruyor; ilk entegrasyon koşusunda seed fixture'ının client_type/redirect_uris değerleriyle yeni route'un ürettiği satırların uyumu doğrulanmalı.
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 72.4. 09.4-d [OPUS-XHIGH] Partner app secret rotate + denetim izi (partner_app.* audit olayları)

**Status:** done  
**Dependencies:** 72.3  

(1) `POST /partner/apps/{clientId}/rotate-secret` — yeni secret üret, `hashToken` ile `secret_hash`'i değiştir, yanıtta BİR KEZ dön, `Cache-Control: no-store`; eski secret ANINDA geçersiz; yalnız `client_type='confidential'` client'larda geçerli, public client'ta 400. Scope `access_rules:rw`, tenant kapılı (başka org → 404). (2) AUDIT_ACTIONS'a dört aksiyon: `partner_app.created`, `partner_app.upd

**Details:**

09.4-d — Partner app secret rotate + denetim izi (partner_app.* audit olayları)  [OPUS-XHIGH]

PRD: FR-MOD-09.4 (+ NFR-S12 denetim izi, NFR-S2 kimlik bilgisi saklama)
ETİKET GEREKÇESİ: OPUS-XHIGH: güvenlik hassasiyeti olan ama çekirdek sınırı KURMAYAN iş — sınır 09.4-c'de kuruldu, burada mevcut sınırın üstüne kimlik bilgisi yenileme + denetim izi ekleniyor. Yine de yeni bir kimlik bilgisi ÜRETEN yetkili endpoint olduğu için koşul 2 gereği asla SONNET'e verilmez; kullanıcı kuralı 'güvenlik olarak high gereken işlerde xhigh' bu kalemi en az OPUS-XHIGH yapar.
NEDEN AÇIK: Koda karşı: `AUDIT_ACTIONS` (apps/api/src/services/audit/audit-log.ts:33-67) `pat.created` ve `pat.revoked` dahil 26 aksiyon taşıyor ama partner/OAuth-client yaşam döngüsüne dair HİÇBİR aksiyon yok. PRD satır 766 NFR-S12'yi birebir şöyle yazıyor: 'Temel audit (login, rol değişimi, veri silme, webhook değişimi, son 30 gün) tüm planlarda' — partner app kaydı/silinmesi/secret yenilenmesi aynı sınıf bir kimlik değişimi ve bugün izsiz kalır. Ayrıca 09.4-c bir secret üretiyor ama yenileme yolu yok: secret sızarsa tek çare client'ı silip yeniden kaydetmek (mevcut entegrasyonu kırar).
KAPSAM: (1) `POST /partner/apps/{clientId}/rotate-secret` — yeni secret üret, `hashToken` ile `secret_hash`'i değiştir, yanıtta BİR KEZ dön, `Cache-Control: no-store`; eski secret ANINDA geçersiz; yalnız `client_type='confidential'` client'larda geçerli, public client'ta 400. Scope `access_rules:rw`, tenant kapılı (başka org → 404). (2) AUDIT_ACTIONS'a dört aksiyon: `partner_app.created`, `partner_app.updated`, `partner_app.deleted`, `partner_app.secret_rotated`. (3) 09.4-c'nin dört yazma route'una + rotate'a `audit(...)` çağrısı — auth.ts:459-470 PAT deseni; metadata YALNIZ güvenlik-anlamlı alanları taşır (client_id, verilen scope'lar, redirect_uri sayısı) ve secret'ı ASLA taşımaz (`sanitizeAuditMetadata` üzerinden). (4) Kontrat: partner-apps.yaml'a rotate operasyonu + re-bundle.
DOSYALAR: apps/api/src/services/audit/audit-log.ts · apps/api/src/routes/partner-apps.ts · apps/api/src/services/partner/partner-app-service.ts · packages/contract/openapi/paths/partner-apps.yaml · apps/api/test/integration/partner-apps.test.ts · apps/api/test/integration/audit-log.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/auth.ts satır 452-478 (pat.created audit çağrısı + no-store + metadata yalnız scope'lar) · apps/api/src/services/audit/audit-log.ts satır 33-67 (AUDIT_ACTIONS sabiti + kategori yorumları) ve sanitizeAuditMetadata (satır 112) · apps/api/src/services/webhooks/webhook-service.ts satır 85-104 (secret üretimi + yalnız yanıtta dönme)
KK (birebir): "partner/creator portalı" | "KK-türetilmiş: bu alt-görevin payı = 'partner uygulamasının kimlik bilgisi yenilenebilir ve her kayıt/silme/yenileme denetim izine düşer'. Türetildi çünkü PRD KK'sı portalın yalnız varlığını söylüyor; denetim zorunluluğu NFR-S12'den (PRD satır 766) birebir geliyor."
KK DOĞRULAMA: integration: (negatif önce) rotate sonrası ESKİ secret ile `POST /auth/token` → `invalid_client`; public client'ta rotate → 400; başka organizasyonun client'ında rotate → 404; audit metadata'sında secret string'i BULUNMUYOR (yanıttaki secret ile audit satırı karşılaştırılır). Pozitif: YENİ secret ile `POST /auth/token` geçiyor; kayıt/güncelleme/silme/rotate işlemlerinin her biri için `audit_log_entries`'te doğru action ile bir satır var.
KAPSAM DIŞI: Audit log okuma/export ekranı — v1 kapsamı dışında (audit-log.ts dosya başı: 'Reading and exporting the log is out of scope here (v1)') · PAT rotate (FR-MOD-08.8.2 alanı) · Secret sızıntısı tespiti/uyarısı · Portal'daki rotate düğmesi (09.4-f)
SÖZLEŞME: YENİ: `POST /partner/apps/{clientId}/rotate-secret` — packages/contract/openapi/paths/partner-apps.yaml'a eklenir + re-bundle. UYARI: re-bundle edilmezse contract-parity.test.ts KIRILIR (çift yönlü parite).
MIGRATION: yok — audit_log_entries tablosu mevcut; AUDIT_ACTIONS bir TS sabiti, yeni aksiyon eklemek şema değişikliği gerektirmez. Doğrulanacak: `audit_log_actor_type_check` kısıtı actor_type içindir, action kolonunda bir CHECK/enum kısıtı var mı (varsa migration gerekir — pencere başında migration.sql'e bak).
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 72.5. 09.4-e [SONNET-XHIGH] Developer portal kabuğu: partner app listesi + kayıt formu + 'secret bir kez' paneli

**Status:** done  
**Dependencies:** 72.3  

UI-only, kontrat tüketici. (1) `apps/web/src/features/developers/DeveloperPortal.tsx` (yeni): `GET /partner/apps` listesi (display_name, client_id, client_type, redirect_uris sayısı, scopes, created_at) + ANLAMLI EMPTY STATE (boş dikdörtgen değil — components/EmptyState.tsx); 'Register app' modalı — display_name zorunlu, client_type seçimi (public/confidential), redirect_uris satır-satır girdi, sc

**Details:**

09.4-e — Developer portal kabuğu: partner app listesi + kayıt formu + 'secret bir kez' paneli  [SONNET-XHIGH]

PRD: FR-MOD-09.4 (+ FR-EK-A.1 form validasyon primitifi, FR-EK-B.1 anlamlı empty state)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 4 dosya; GÜVENLİK KARARI YOK: tüm doğrulama (redirect_uri allowlist, scope daraltma, izolasyon) sunucuda 09.4-c'de, ekran yalnız API'yi tüketip hatayı gösteriyor (koşul 2 ✅); eşzamanlılık yok (koşul 3 ✅); kopyalanacak desen ismen var: AppsMarketplace.tsx (useQuery/useMutation + Modal + Section/Card) ve WebsiteWidgets.tsx (ekle-formu + liste + sil) (koşul 4 ✅); kontrat değişikliği YOK, 09.4-c/-d kontratı tüketilir (koşul 5 ✅); KK mekanik: render + empty state + submit-disabled + secret bir kez (koşul 6 ✅).
NEDEN AÇIK: Koda karşı: `ls apps/web/src/features` → apps, auth, billing, campaigns, custom-fields, customers, home, inbox, notifications, onboarding, playbook, reports, settings, team, traffic — 'developer' veya 'partner' adlı klasör YOK. `apps/web/src/App.tsx:80-93` altındaki /app rotaları arasında developer/partner rotası yok. `apps/web/src/components/navigation.ts` MODULES (6 girdi) + FOOTER listelerinde de yok. Yani partner/creator portalı için hiçbir ekran mevcut değil.
KAPSAM: UI-only, kontrat tüketici. (1) `apps/web/src/features/developers/DeveloperPortal.tsx` (yeni): `GET /partner/apps` listesi (display_name, client_id, client_type, redirect_uris sayısı, scopes, created_at) + ANLAMLI EMPTY STATE (boş dikdörtgen değil — components/EmptyState.tsx); 'Register app' modalı — display_name zorunlu, client_type seçimi (public/confidential), redirect_uris satır-satır girdi, scope çoklu seçim; alan-altı hata + geçersizken submit pasif (T4-a form primitifi). (2) Kayıt yanıtındaki `secret` BİR KEZ gösterilen panelde: kopyala düğmesi + 'bir daha gösterilmeyecek' uyarısı; panel kapanınca secret state'ten silinir ve listede asla görünmez. (3) Sil (onay modalı). (4) `App.tsx`'e `/app/developers` rotası + `navigation.ts` FOOTER'a girdi — labelKey i18n anahtarı (`nav.developers`) i18n kataloğuna eklenir, çünkü nav label'ları t() ile çözülüyor. (5) Portal yalnız `access_rules:rw` sahibi (owner/admin) için görünür; ajan rolünde navigasyon girdisi gizli.
DOSYALAR: apps/web/src/features/developers/DeveloperPortal.tsx · apps/web/src/features/developers/DeveloperPortal.test.tsx · apps/web/src/App.tsx · apps/web/src/components/navigation.ts
REFERANS DESEN (kopyalanacak): apps/web/src/features/apps/AppsMarketplace.tsx (useQuery/useMutation + Modal onay + ErrorNotice + Page/Section/Card iskeleti + queryKey deseni) · apps/web/src/features/settings/WebsiteWidgets.tsx (ekle-formu + liste + sil + form validasyon primitifi kullanımı) · apps/web/src/components/EmptyState.tsx (anlamlı empty state) · apps/web/src/components/navigation.ts (nav girdisi şekli + i18n labelKey kuralı)
KK (birebir): "partner/creator portalı"
KK DOĞRULAMA: unit (`DeveloperPortal.test.tsx`): (1) liste boşken anlamlı empty state render ediliyor; (2) display_name boşken submit PASİF ve alan-altı hata görünüyor; (3) kayıt yanıtındaki secret bir kez render ediliyor, panel kapanınca DOM'dan gidiyor ve liste satırında secret yok; (4) sunucudan gelen 400 (geçersiz redirect_uri) kullanıcıya alan-altı/ErrorNotice olarak yansıyor. E2E: portal → app kaydet → client_id + secret görünür.
KAPSAM DIŞI: Webhook aboneliği yönetimi ve manifest sekmesi (09.4-f) · Secret rotate düğmesi (09.4-f — endpoint 09.4-d'de) · PAT üretme ekranı (FR-MOD-08.8.2 — ayrı kalem; API mevcut: auth.ts:396-500, UI yok) · Görsel Workflow builder (⛔ ADR-14)
SÖZLEŞME: yok — 09.4-c'nin kontratı tüketilir; yeni path eklenmez.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 72.6. 09.4-f [SONNET-XHIGH] Portal'da Zapier REST Hooks yüzeyi: webhook aboneliği yönetimi + trigger manifesti + secret rotate düğmesi

**Status:** done  
**Dependencies:** 72.2, 72.4, 72.5  

Portal'a ikinci ve üçüncü sekme. (1) `WebhookSubscriptions.tsx`: `GET /webhooks` listesi (url / action / type / enabled / created_at) + anlamlı empty state; 'Subscribe' formu — action seçenekleri 09.4-b manifestinden okunur (sabit liste KOPYALANMAZ), url girdisi; `POST /webhooks` yanıtındaki `secret` BİR KEZ gösterilir (kopyala + uyarı); `DELETE /webhooks/{webhookId}` onay modalıyla. Sunucudan gel

**Details:**

09.4-f — Portal'da Zapier REST Hooks yüzeyi: webhook aboneliği yönetimi + trigger manifesti + secret rotate düğmesi  [SONNET-XHIGH]

PRD: FR-MOD-09.4 (+ FR-MOD-08.8.4 mevcut webhook yüzeyinin arayüzü)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 4 dosya; güvenlik kararı YOK: SSRF/HMAC/izolasyon kararlarının tamamı zaten sunucuda (webhooks.ts + lib/ssrf.ts, tm 34) ve rotate kararı 09.4-d'de; ekran yalnız çağırıp sonucu gösteriyor (koşul 2 ✅); eşzamanlılık yok (koşul 3 ✅); kopyalanacak desen ismen var: WebsiteWidgets.tsx (liste+ekle+sil) ve AppsMarketplace.tsx (Modal onay) (koşul 4 ✅); kontrat değişikliği YOK (koşul 5 ✅); KK mekanik doğrulanabilir (koşul 6 ✅).
NEDEN AÇIK: Koda karşı: `grep -rln webhook apps/web/src` → 0 sonuç (yalnız apps/e2e/tests/settings.spec.ts:140'ta yorum geçiyor). Webhook kaydı/listesi/silme route'ları tm 34'te üretimde (apps/api/src/routes/webhooks.ts, HMAC + assertPublicHttpUrl) ama web'de HİÇBİR ekran onları tüketmiyor — abonelik yalnız ham API çağrısıyla yönetilebiliyor. Zapier'in REST Hooks akışının (subscribe/unsubscribe) insan tarafındaki karşılığı yok.
KAPSAM: Portal'a ikinci ve üçüncü sekme. (1) `WebhookSubscriptions.tsx`: `GET /webhooks` listesi (url / action / type / enabled / created_at) + anlamlı empty state; 'Subscribe' formu — action seçenekleri 09.4-b manifestinden okunur (sabit liste KOPYALANMAZ), url girdisi; `POST /webhooks` yanıtındaki `secret` BİR KEZ gösterilir (kopyala + uyarı); `DELETE /webhooks/{webhookId}` onay modalıyla. Sunucudan gelen 400 (private/loopback URL SSRF reddi) kullanıcıya alan-altı hata olarak yansır. (2) Manifest sekmesi: `GET /integrations/manifest` triggers/actions listesi — Zapier/Make app tanımını kuran geliştiriciye salt-okunur referans (subscribe/unsubscribe path'leri dahil). (3) 09.4-d'nin `rotate-secret` düğmesi partner app satırına: onay modalı + yeni secret'ın bir kez gösterimi. (4) e2e `apps/e2e/tests/developers.spec.ts`.
DOSYALAR: apps/web/src/features/developers/WebhookSubscriptions.tsx · apps/web/src/features/developers/WebhookSubscriptions.test.tsx · apps/web/src/features/developers/DeveloperPortal.tsx · apps/e2e/tests/developers.spec.ts
REFERANS DESEN (kopyalanacak): apps/web/src/features/settings/WebsiteWidgets.tsx (liste + ekle formu + sil, sunucu hatası gösterimi) · apps/web/src/features/apps/AppsMarketplace.tsx (Modal onay akışı + useMutation invalidate) · apps/e2e/tests/settings.spec.ts (e2e spec iskeleti + fixture kullanımı)
KK (birebir): "700+ Zapier" | "partner/creator portalı"
KK DOĞRULAMA: unit (`WebhookSubscriptions.test.tsx`): (1) abonelik listesi ve boşken anlamlı empty state; (2) kayıt yanıtındaki secret bir kez render ediliyor ve liste satırında YOK (sunucu zaten döndürmüyor — ekran da göstermiyor); (3) sunucudan 400 gelen private/loopback URL denemesinde alan-altı hata görünüyor; (4) action seçenekleri manifest yanıtından türüyor (sabit liste yok). E2E `developers.spec.ts`: portal → webhook ekle → listede görünür → sil → listeden düşer.
KAPSAM DIŞI: Webhook teslimat/retry davranışını değiştirmek (08.8.4-d, tm 34 — done) · SSRF/HMAC mantığına dokunmak (sunucuda, tm 34) · Yeni WEBHOOK_ACTION eklemek · Teslimat log ekranı (webhook_deliveries görünümü — ayrı iş)
SÖZLEŞME: yok — mevcut `/webhooks` (tm 34), 09.4-b manifesti ve 09.4-d rotate endpoint'i tüketilir.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 72.7. 09.4-g [OPUS-XHIGH] Uçtan uca partner akışı doğrulaması: kayıtlı client ile OAuth 2.1 authorize→token + cross-tenant/negatif kapanış

**Status:** done  
**Dependencies:** 72.3, 72.4, 72.5, 72.6  

Yalnız doğrulama ve kapanış kanıtı; yeni üretim kodu yazılmaz (en fazla test yardımcıları). (1) Integration senaryosu: portal API'siyle `client_type='confidential'` client kaydet → `POST /auth/authorize` ile kayıtlı redirect_uri + PKCE S256 challenge'la kod al → `POST /auth/token` ile client_secret + code_verifier değiş → erişim token'ının scope'ları client'ın kayıtlı scope kümesiyle sınırlı. (2) 

**Details:**

09.4-g — Uçtan uca partner akışı doğrulaması: kayıtlı client ile OAuth 2.1 authorize→token + cross-tenant/negatif kapanış  [OPUS-XHIGH]

PRD: FR-MOD-09.4 (+ NFR-S3, NFR-S4, NFR-S5, NFR-M4)
ETİKET GEREKÇESİ: OPUS-XHIGH: çok yüzeyli bağlama (kontrat + backend + auth akışı + UI) ve KK'daki belirsizliğin ('700+ Zapier') kapatıldığının kanıtlanması yorum gerektiriyor; hafif güvenlik dokunuşu — mevcut sınırların (secret_hash format uyumu, redirect_uri allowlist, scope daraltma, org izolasyonu) uçtan uca doğrulanması, ama YENİ sınır kurmuyor. Bu yüzden OPUS-MAX değil, OPUS-XHIGH.
NEDEN AÇIK: Koda karşı: 09.4-c portalda bir OAuth client üretiyor; `POST /auth/authorize` (apps/api/src/routes/auth.ts:208-280) ve `POST /auth/token` (auth.ts:286-311) client'ı `auth_find_client` üzerinden okuyup redirect_uri allowlist (`isRegisteredRedirect`) + scope daraltma (auth.ts:246-252) + secret doğrulama (`#authenticateClient`, oauth-service.ts:328-340) uyguluyor. Bugün bu iki yolu birbirine bağlayan HİÇBİR test yok: mevcut OAuth testleri `apps/api/prisma/seed.ts:487` fixture client'ıyla çalışıyor, portalın ÜRETTİĞİ client'la değil — yani secret_hash format uyumu ile kayıt-anı/eşleştirme-anı redirect doğrulamasının tutarlılığı kanıtsız.
KAPSAM: Yalnız doğrulama ve kapanış kanıtı; yeni üretim kodu yazılmaz (en fazla test yardımcıları). (1) Integration senaryosu: portal API'siyle `client_type='confidential'` client kaydet → `POST /auth/authorize` ile kayıtlı redirect_uri + PKCE S256 challenge'la kod al → `POST /auth/token` ile client_secret + code_verifier değiş → erişim token'ının scope'ları client'ın kayıtlı scope kümesiyle sınırlı. (2) Negatifler: kayıtlı OLMAYAN redirect_uri → 400; yanlış client_secret → `invalid_client`; client'ın kayıtlı scope'u dışında scope isteği → daraltılır veya 400; başka organizasyonun client_id'si ile authorize → 404/validation. (3) Cross-tenant: iki lisans/organizasyon fixture'ıyla portal listesinin sızmadığı; rotate/delete'in yabancı client'a değmediği. (4) Kapanış kanıtı HANDOFF'a: contract-parity yeşil, manifest ↔ WEBHOOK_ACTIONS senkronu yeşil, apps katalog sınırı yeşil, e2e developers.spec.ts yeşil, tam DoD kapısı (typecheck+lint+unit+integration+build+e2e).
DOSYALAR: apps/api/test/integration/partner-apps.test.ts · apps/api/test/integration/auth.test.ts · apps/api/test/integration/tenant-isolation.test.ts · apps/e2e/tests/developers.spec.ts
REFERANS DESEN (kopyalanacak): apps/api/test/integration/auth.test.ts (OAuth authorize→token akış testi + PKCE fixture'ları) · apps/api/test/integration/tenant-isolation.test.ts (cross-tenant iddia deseni) · apps/api/test/integration/contract-parity.test.ts (kontrat↔route parite kapısı)
KK (birebir): "700+ Zapier" | "partner/creator portalı"
KK DOĞRULAMA: Senaryonun tamamı yeşil: portalda üretilen client GERÇEKTEN OAuth 2.1 akışında çalışıyor (secret_hash format uyumunun uçtan uca kanıtı) ve dört negatif ile cross-tenant iddiaları tutuyor. KK'nın '700+ Zapier' payı şu somut kanıtla kapanır: (a) katalogda Zapier+Make kartı var, (b) `GET /integrations/manifest` her trigger'ı ve subscribe/unsubscribe yolunu yayınlıyor, (c) portal üzerinden webhook aboneliği kurulup silinebiliyor — yani Zapier/Make tarafında TEK bir SiyahTuş app'i tanımlamak için gereken her şey SiyahTuş tarafında mevcut.
KAPSAM DIŞI: Yeni üretim davranışı eklemek — bu alt-görev doğrulamadır; bulunan kusur varsa ilgili alt-görev yeniden açılır · Gerçek Zapier/Make platformunda app yayınlamak (depo dışı, dış servis) · Yük/performans testi (NFR-P kalemleri ayrı)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
