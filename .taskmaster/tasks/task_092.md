# Task ID: 92

**Title:** 08.9.7 — Temel audit log tüm planlarda + audit ekranı  ·  dilim V2-1

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Faz 2 (v2) · PLAN §5.2 · 11 atomik alt-görev. Bu turda kapsam süpürmesinde bulundu (PLAN §D62).

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `08.9.7-audit`.

11 atomik alt-görev · ~14 pencere · etiket dağılımı: OPUS-MAX x2 · OPUS-XHIGH x3 · SONNET-XHIGH x6

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  08.9.7-a [OPUS-XHIGH] Audit log okuma kontratı + audit_log--all:ro scope'u + GET /audit-log (keyset, son 30 gün varsayılan)  (bağ: yok)
  08.9.7-b [SONNET-XHIGH] Audit liste filtreleri: eylem, aktör ve tarih aralığı (katkısal sorgu parametreleri)  (bağ: 08.9.7-a)
  08.9.7-c [OPUS-XHIGH] Webhook değişimi audit'i: webhook.created / webhook.deleted eylemleri  (bağ: yok)
  08.9.7-d [SONNET-XHIGH] data.deleted eylemi + ayarlar ailesi hedefli silmelerinde audit  (bağ: 08.9.7-c)
  08.9.7-e [SONNET-XHIGH] İçerik ve entegrasyon silme uçlarında data.deleted audit'i  (bağ: 08.9.7-d)
  08.9.7-f [OPUS-MAX] Rol değişimi ucu (PUT /agents/{agentId}/role) + member.role_changed audit'i  (bağ: 08.9.7-c)
  08.9.7-g [SONNET-XHIGH] Retention politikasına audit penceresi (RETENTION_AUDIT_DAYS=30) — politika/env/rapor iskeleti  (bağ: yok)
  08.9.7-h [OPUS-MAX] Append-only log'da süreli budama: audit_prune_expired SECURITY DEFINER + retention sweep bağlantısı  (bağ: 08.9.7-g)
  08.9.7-i [SONNET-XHIGH] Audit Log ekranı: salt-okunur liste + boş/skeleton/hata durumları + Settings girişi  (bağ: 08.9.7-a)
  08.9.7-j [SONNET-XHIGH] Audit ekranı filtreleri (eylem/tarih) + 'daha fazla yükle' + e2e görünürlük  (bağ: 08.9.7-b, 08.9.7-i)
  08.9.7-k [OPUS-XHIGH] NFR-S12 uçtan uca doğrulama: dört olay + 30 gün penceresi + 'tüm planlarda' kanıtı  (bağ: 08.9.7-b, 08.9.7-c, 08.9.7-e, 08.9.7-f, 08.9.7-h, 08.9.7-j)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): İki alt-görevin çekirdeği bölünmez. (1) 08.9.7-f — rol değişimi ucu: yetki yükseltme (privilege escalation) sınırı tek bir akıl yürütmeyle kurulur — aktörün rolü, hedefin rolü, kendi rolünü değiştirme yasağı, owner'ın korunması ve son-owner invaryantı aynı bağlamda birlikte düşünülmezse kapı yarım kapanır; agents.ts:161-231'deki suspension guard'larının aynısı burada rol için kurulmalı. (2) 08.9.7-h — append-only budama: audit_log'da UPDATE/DELETE siyahtus_app rolünden REVOKE edilmiş (migration 20260722154008:1005-1006) ve RLS'te yalnız SELECT/INSERT politikası var; 30 günlük pencere ancak dar bir SECURITY DEFINER fonksiyonla (retention_list_tenants() deseni) uygulanabilir. Fonksiyonun imzası, yaş yüklemi, lisans parametresi, GRANT/REVOKE'u ve "tablo DELETE yetkisi asla verilmez" kararı tek karardır; parçalanırsa append-only invaryantına açılan deliğin sınırı kaybolur. Bu iki çekirdeğin ETRAFINDAKİ her şey (kontrat satırı, filtre parametreleri, salt-okunur ekran, politika/env iskeleti, mekanik audit çağrıları) ayrı ve daha ucuz etiketli alt-görevlere çıkarıldı.

VARSAYIMLAR: Scope adı `audit_log--all:ro` olacak. Kaynak olgulardaki `audit_log--all:r` önerisi kullanılamaz: packages/types/src/scopes.ts'teki expandScope regex'i izin ekini `(ro|rw|rc)` olarak zorluyor, `:r` hiçbir zaman genişlemez. · Audit okuma yetkisi Owner/Admin ile sınırlı: route'ta scope (`audit_log--all:ro`) + `minimumRole: 'admin'` çift kapısı. PRD KK'sı okuma yüzeyini tanımlamıyor; karar v2-04 §RBAC matrisinden (satır 212-213: Audit log Owner ✓, Admin ✓) türetildi. · 'Son 30 gün' hem SAKLAMA süresi hem liste varsayılan penceresi olarak yorumlandı: 30 günden eski satırlar budanır (08.9.7-h) ve filtresiz liste son 30 günü döner (08.9.7-a). · 'genişletilmiş + SIEM Enterprise' bu turda YAPILMIYOR. Repoda plan/entitlement mekanizması hiç yok (grep 'entitlement|planGate|requirePlan' → 0); plan bazlı farklı pencere ayrı bir tasarım kararıdır. Tek global pencere `RETENTION_AUDIT_DAYS` (varsayılan 30) ile uygulanır. · 'Tüm planlarda' için KALDIRILACAK bir kapı yok — kapı hiç kurulmamış (schema.prisma AuditLogEntry yorumu bunu açıkça söylüyor). Dolayısıyla iş 'kapıyı kaldırmak' değil, 'kapı olmadığını testle kanıtlamak' (08.9.7-k). · 'Rol değişimi' olayını kaydedebilmek için önce olayın kendisi gerekiyor: depoda rol değiştiren hiçbir uç yok, o yüzden 08.9.7-f minimal bir `PUT /agents/{agentId}/role` ucu ekliyor. Owner devri (ownership transfer) kapsam dışı bırakıldı. · 'Veri silme' hedefli/tekil silme uçları olarak yorumlandı ve TEK bir `data.deleted` eylemi + `<kind>:<id>` hedefi ile kaydediliyor (uç başına ayrı eylem adı üretilmiyor). Audit metadata'sı yalnız `kind` taşır; silinen kaydın adı/içeriği yazılmaz. · Kaynak olgulardaki 'customers.ts:171 DELETE /customers/:customerId (GDPR erasure) var ama audit'lenmiyor' iddiası koda karşı YANLIŞ çıktı: o satır `DELETE /customers/:customerId/ban` (ban kaldırma) ucudur; depoda tekil müşteri silme ucu YOK. Kırılım bu düzeltmeye göre yapıldı; GDPR tekil erasure ucu eklemek bu kalemin kapsamında değil. · Audit ekranı SettingsPage için

AÇIK SORULAR (ürün kararı): 08.9.7-f (rol değişimi ucu, OPUS-MAX, 2 pencere) bu kalemin kapsamında mı kalmalı, yoksa MOD-04 (Team) altına ayrı bir kalem olarak mı taşınmalı? Orkestratörün bağlayıcı kapsam metni yalnız 'plan kapısı + 30 gün + ekran' diyor; ancak NFR-S12 ve US-11 KK3 'rol değişimi'ni birebir sayıyor ve depoda böyle bir uç YOK — yani olay hiç üretilemiyor, KK testle kapatılamıyor. Çıkarılırsa kalem 2 pencere ucuzlar ama NFR-S12 eksik kapanır. · 'Son 30 gün' gerçekten SİLME mi olmalı, yoksa yalnız görüntüleme penceresi mi? Silme, append-only invaryantına kontrollü bir delik açıyor (08.9.7-h: SECURITY DEFINER + migration, OPUS-MAX, 2 pencere) ve 08.9.7-g ile birlikte 3 pencere maliyet. Yalnız görüntüleme penceresi seçilirse -g/-h düşer ama 'son 30 gün' saklama iddiası karşılanmaz ve audit_log süresiz büyümeye devam eder. · Enterprise payı ('genişletilmiş saklama + export + SIEM') hangi faza yazılacak? Uygulanabilmesi için önce bir entitlement/plan-gate mekanizması gerekiyor ve repoda hiç yok — bu, MOD-10 Billing tarafında ayrı bir kalem gibi duruyor. · `data.deleted` tek eylemi mi, yoksa uç başına ayrı eylem adları mı (`website.deleted`, `skill.deleted`, `tag.deleted` …)? Tek eylem sözlüğü küçük tutuyor ama (license_id, action, created_at) indeksiyle yapılan eylem filtresini kabalaştırıyor; ayrı adlar filtreyi keskinleştirir ama sözlüğü ~10 eylem büyütür. · Audit ekranı Settings altında mı kalmalı, yoksa güvenlik/uyumluluk yüzeyi büyüdükçe kendi modül rayı girdisine mi taşınmalı (components/

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 92.1. 08.9.7-a [OPUS-XHIGH] Audit log okuma kontratı + audit_log--all:ro scope'u + GET /audit-log (keyset, son 30 gün varsayılan)

**Status:** done  
**Dependencies:** None  

Contract-first: (1) packages/contract/openapi/paths/audit-log.yaml — GET /audit-log, items[] + next_page_id, components/parameters PageId+Limit yeniden kullanılır; openapi.yaml'a path kaydı; (2) scope audit_log--all:ro — scopes.ts kataloğu + scopes.test.ts SIYAHTUS_ADDED_SCOPES listesi + principal.ts ADMIN_SCOPES; (3) okuma servisi services/audit/audit-log-reader.ts — withTenant + RLS'ye güvenir (ekst

**Details:**

08.9.7-a — Audit log okuma kontratı + audit_log--all:ro scope'u + GET /audit-log (keyset, son 30 gün varsayılan)  [OPUS-XHIGH]

PRD: NFR-S12 (+ NFR-S3 scope kataloğu, NFR-S5 IDOR/tenant izolasyonu, NFR-P6 büyük liste sorgusu)
ETİKET GEREKÇESİ: OPUS-XHIGH: YENİ yetkili endpoint + YENİ scope tanımı. Kullanıcı kuralı birebir: 'yeni bir yetkili endpoint eklemek, mevcut scope'u genişletmek EN AZ OPUS-XHIGH olur; güvenlik işi ASLA sonnet'e verilmez'. Koşul 2 ihlali (authZ + tenant izolasyon yüzeyi). MAX değil: kripto/algoritma tasarımı yok, tenant izolasyonu mevcut RLS politikasından (audit_log_read) ve withTenant deseninden kopyalanıyor.
NEDEN AÇIK: Okuma tarafı sıfır: apps/api/src içinde writeAuditEntry dışında audit_log/AuditLogEntry'ye hiçbir SELECT/servis/route yok (grep: yalnız services/audit/audit-log.ts yazıcısı + test/integration/audit-log.test.ts). packages/contract/openapi/paths/ altında 23 path dosyası var, audit*.yaml YOK. packages/types/src/scopes.ts'te (58 kaynak + 6 SiyahTuş eklemesi) audit ile ilgili hiçbir scope yok.
KAPSAM: Contract-first: (1) packages/contract/openapi/paths/audit-log.yaml — GET /audit-log, items[] + next_page_id, components/parameters PageId+Limit yeniden kullanılır; openapi.yaml'a path kaydı; (2) scope audit_log--all:ro — scopes.ts kataloğu + scopes.test.ts SIYAHTUS_ADDED_SCOPES listesi + principal.ts ADMIN_SCOPES; (3) okuma servisi services/audit/audit-log-reader.ts — withTenant + RLS'ye güvenir (ekstra license_id filtresi eklenmez), sıralama (created_at DESC, id DESC), base64url keyset cursor, limit clamp, filtre yoksa varsayılan pencere son 30 gün (mevcut (license_id, created_at DESC) indeksi kullanılır, tam tablo taraması yok); (4) routes/audit-log.ts — config { scopes: ['audit_log--all:ro'], minimumRole: 'admin' } çift kapı; server.ts register; (5) pnpm --filter @siyahtus/contract generate ile re-bundle + tip üretimi.
DOSYALAR: packages/contract/openapi/paths/audit-log.yaml · packages/contract/openapi/openapi.yaml · packages/types/src/scopes.ts · packages/types/src/scopes.test.ts · apps/api/src/services/auth/principal.ts · apps/api/src/services/audit/audit-log-reader.ts · apps/api/src/routes/audit-log.ts · apps/api/src/server.ts · apps/api/test/integration/audit-log-read.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/services/customers/customer-service.ts (encodeCursor/decodeCursor/cursorPredicate + take: limit+1 keyset sayfalama, satır ~67-120) · apps/api/src/routes/reports.ts (salt-okunur, ayrı scope ile korunan owner/admin route deseni) · packages/contract/openapi/paths/customers.yaml (listCustomers: PageId/Limit parametreleri + items/total/next_page_id yanıtı) · apps/api/src/services/audit/audit-log.ts (withTenant/TenantClient + RLS'ye güvenme deseni)
KK (birebir): "Temel audit (login, rol değişimi, veri silme, webhook değişimi, son 30 gün) tüm planlarda" | "KK-türetilmiş: audit kayıtları yalnız Owner/Admin tarafından okunabilir ve bir kiracı yalnız kendi kayıtlarını görür. Türetme gerekçesi: PRD KK'sı yalnız 'tutulur' diyor, okuma yüzeyini/yetkisini tanımlamıyor (kk_yetersiz). v2-04-guvenlik-uyumluluk.md satır 212-213 RBAC matrisi (Audit log: Owner ✓, Admin ✓) + NFR-S5 IDOR kuralından türetildi."
KK DOĞRULAMA: test/integration/audit-log-read.test.ts: GET /audit-log owner/admin token'ıyla 200 ve kendi kiracısının kayıtlarını döner ('tüm planlarda' payının okuma yüzeyi); filtre verilmediğinde yalnız son 30 günü döner ('son 30 gün'); ajan rolü/scope'suz token 403 ve başka lisansın kaydı görünmez (türetilmiş KK). contract-parity.test.ts yeşil = kontrat ile sunulan uç birebir aynı.
KAPSAM DIŞI: Filtreler (action/actor_id/tarih) — 08.9.7-b · Ekran — 08.9.7-i / -j · Tekil kayıt detayı GET /audit-log/{id} (MVP'de gerek yok) · Export/CSV + SIEM aktarımı (Enterprise payı, bu turda yok) · Yeni ApiError tipi — gerekmiyor: 403 için mevcut authorization tipi kullanılır, dolayısıyla errors.ts (×2) + scopes.test.ts sayacı + openapi enum + regen dörtlüsü bu alt-görevde TETİKLENMEZ
SÖZLEŞME: YENİ: GET /audit-log — packages/contract/openapi/paths/audit-log.yaml (yeni dosya) + openapi.yaml path kaydı + AuditLogEntry şeması. UYARI: OpenAPI'ye eklenip re-bundle edilmezse contract-parity.test.ts KIRILIR — bu test iki yönlü çalışır (belgesiz route da, karşılıksız belge de patlar). Ayrıca yeni scope string'i scopes.test.ts'teki SIYAHTUS_ADDED_SCOPES listesine eklenmezse 'SCOPES toHaveLength(SOURCE_SCOPE_COUNT + SIYAHTUS_ADDED_SCOPES.length)' iddiası kırılır.
MIGRATION: yok (audit_log tablosu, RLS politikaları ve (license_id, created_at DESC) indeksi zaten mevcut)
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 92.2. 08.9.7-b [SONNET-XHIGH] Audit liste filtreleri: eylem, aktör ve tarih aralığı (katkısal sorgu parametreleri)

**Status:** done  
**Dependencies:** 92.1  

GET /audit-log'a katkısal parametreler: action (AUDIT_ACTIONS sözlüğünden enum), actor_id (uuid), date_from/date_to (z.coerce.date). action verildiğinde (license_id, action, created_at DESC) indeksi kullanılır. date_from/date_to verilmezse 08.9.7-a'daki 30 günlük varsayılan korunur. Reader'ın #where yardımcısı ayrıştırılır; kontrat parametreleri paths/audit-log.yaml'a eklenir + re-bundle.

**Details:**

08.9.7-b — Audit liste filtreleri: eylem, aktör ve tarih aralığı (katkısal sorgu parametreleri)  [SONNET-XHIGH]

PRD: NFR-S12 (+ NFR-P6)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 3 dosya + test; yeni yetki/scope kararı yok (kapı 08.9.7-a'da kuruldu, bu alt-görev yalnız WHERE daraltıyor); eşzamanlılık yok; kopyalanacak desen ismen var (customer-service.ts #where + reports.ts rangeQuery); kontrat değişikliği katkısal (yalnız query parametresi); kabul kriteri mekanik (filtre listeyi daraltır).
NEDEN AÇIK: 08.9.7-a yalnız tarih penceresi + sayfalama getiriyor; NFR-S12'nin saydığı dört olay ailesini ayrıştırmak için eylem/aktör bazlı daraltma gerekiyor ve audit_log'un ikinci indeksi (license_id, action, created_at DESC) bugün hiçbir sorgu tarafından kullanılmıyor — okuma tarafı hiç yazılmamıştı (grep: 0 tüketici).
KAPSAM: GET /audit-log'a katkısal parametreler: action (AUDIT_ACTIONS sözlüğünden enum), actor_id (uuid), date_from/date_to (z.coerce.date). action verildiğinde (license_id, action, created_at DESC) indeksi kullanılır. date_from/date_to verilmezse 08.9.7-a'daki 30 günlük varsayılan korunur. Reader'ın #where yardımcısı ayrıştırılır; kontrat parametreleri paths/audit-log.yaml'a eklenir + re-bundle.
DOSYALAR: apps/api/src/services/audit/audit-log-reader.ts · apps/api/src/routes/audit-log.ts · packages/contract/openapi/paths/audit-log.yaml · apps/api/test/integration/audit-log-read.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/services/customers/customer-service.ts (#where + segment/query filtre birleştirme) · apps/api/src/routes/reports.ts (rangeQuery: z.coerce.date() from/to + parse() hata zarfı) · packages/contract/openapi/paths/customers.yaml (query/segment parametre bildirimi)
KK (birebir): "Temel audit (login, rol değişimi, veri silme, webhook değişimi, son 30 gün) tüm planlarda" | "KK-türetilmiş: dört olay ailesi listede birbirinden ayrıştırılabilir olmalı. Türetme gerekçesi: PRD KK olayları sayıyor ama okuma/filtre yüzeyini tanımlamıyor (kk_yetersiz); NFR-S12'nin sayımının ekranda doğrulanabilmesi eylem bazlı daraltma gerektiriyor."
KK DOĞRULAMA: test/integration/audit-log-read.test.ts: action=auth.login yalnız login satırlarını döner; actor_id verilen aktörün satırlarına daralır; date_from/date_to pencereyi daraltır ve 30 günlük varsayılanı geçersiz kılar.
KAPSAM DIŞI: Serbest metin arama (metadata içi arama) — jsonb tarama, kapsam dışı · Ekran filtre kontrolleri — 08.9.7-j · Yeni indeks ekleme (mevcut iki indeks yeterli)
SÖZLEŞME: Katkısal: paths/audit-log.yaml GET parametrelerine action/actor_id/date_from/date_to eklenir. Yeni operation YOK, dolayısıyla contract-parity operasyon kümesi değişmez; yine de re-bundle (pnpm --filter @siyahtus/contract generate) yapılmazsa üretilen tipler kontrattan sapar.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 92.3. 08.9.7-c [OPUS-XHIGH] Webhook değişimi audit'i: webhook.created / webhook.deleted eylemleri

**Status:** done  
**Dependencies:** None  

AUDIT_ACTIONS'a 'webhook.created' ve 'webhook.deleted' eklenir (kapalı sözlük). routes/webhooks.ts'te register ve unregister'ı zaten saran request.withTenant(tx) bloğunun İÇİNDE writeAuditEntry çağrılır. target = 'webhook:<id>'. metadata YALNIZ { action, type, url_host } taşır — url'nin tamamı ve secret ASLA yazılmaz (register yanıtı plaintext secret döndürüyor; sanitizeAuditMetadata'nın regex'i '

**Details:**

08.9.7-c — Webhook değişimi audit'i: webhook.created / webhook.deleted eylemleri  [OPUS-XHIGH]

PRD: NFR-S12 (+ NFR-S7 webhook güvenliği, risk R1/R2)
ETİKET GEREKÇESİ: OPUS-XHIGH: güvenlik hassasiyeti var — append-only ve asla temizlenemeyen bir tabloya webhook imzalama secret'ının sızmaması ve yazının register/unregister ile AYNI tenant transaction'ında kalması gerekiyor (audit-log.ts kendi dokümantasyonu bunu vurguluyor). Çekirdek güvenlik sınırı (HMAC/SSRF) burada YENİDEN tasarlanmıyor, o yüzden MAX değil. Koşul 2 gereği SONNET olamaz.
NEDEN AÇIK: grep writeAuditEntry apps/api/src → webhooks.ts hiç geçmiyor (0 sonuç); AUDIT_ACTIONS sözlüğünde (audit-log.ts:33-67, 25 eylem) webhook.* diye bir eylem yok. Oysa route'lar mevcut: POST /webhooks (routes/webhooks.ts:57) ve DELETE /webhooks/:webhookId (routes/webhooks.ts:77). NFR-S12'nin birebir saydığı 'webhook değişimi' hiçbir yerde kaydedilmiyor.
KAPSAM: AUDIT_ACTIONS'a 'webhook.created' ve 'webhook.deleted' eklenir (kapalı sözlük). routes/webhooks.ts'te register ve unregister'ı zaten saran request.withTenant(tx) bloğunun İÇİNDE writeAuditEntry çağrılır. target = 'webhook:<id>'. metadata YALNIZ { action, type, url_host } taşır — url'nin tamamı ve secret ASLA yazılmaz (register yanıtı plaintext secret döndürüyor; sanitizeAuditMetadata'nın regex'i 'url'/'value' gibi anahtarları yakalamaz, bu yüzden savunma çağrı yerinde kurulur). Silme yalnız gerçekten silindiğinde (removed > 0) kaydedilir.
DOSYALAR: apps/api/src/services/audit/audit-log.ts · apps/api/src/services/audit/audit-log.test.ts · apps/api/src/routes/webhooks.ts · apps/api/test/integration/audit-log.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/settings.ts:275-298 (trusted_domain_removed — count>0 kapısı + target biçimi + tx içinde yazım) · apps/api/test/integration/audit-log.test.ts (satır ~430-453: 'haystack' deseni — secret/PII'nin log'a düşmediğini kanıtlayan iddia)
KK (birebir): "Temel audit (login, rol değişimi, veri silme, webhook değişimi, son 30 gün) tüm planlarda" | "KK3: Audit log (login, rol değişimi, veri silme, webhook değişimi) tutulur (§7). — kaynak: US-11, satır 325"
KK DOĞRULAMA: test/integration/audit-log.test.ts: POST /webhooks tam olarak bir webhook.created entry'si yazar (aktör/hedef doğru); DELETE /webhooks/:id tam olarak bir webhook.deleted yazar; 404 silme hiçbir entry yazmaz. Bu, KK'nın 'webhook değişimi' maddesini birebir kanıtlar.
KAPSAM DIŞI: Webhook güncelleme/secret rotasyonu ucu — depoda YOK, bu turda eklenmiyor · Teslimat/retry loglama (08.8.4-d ile teslim edilmiş ayrı yüzey) · Ekranda gösterim (08.9.7-i/-j)
SÖZLEŞME: yok (mevcut /webhooks uçlarının davranışı değişmiyor, yalnız yan etki olarak audit satırı yazılıyor)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 92.4. 08.9.7-d [SONNET-XHIGH] data.deleted eylemi + ayarlar ailesi hedefli silmelerinde audit

**Status:** done  
**Dependencies:** 92.3  

AUDIT_ACTIONS'a tek bir 'data.deleted' eylemi eklenir. Beş silme ucunda, zaten var olan request.withTenant(tx) bloğunun içinde ve yalnız gerçekten silindiğinde (count > 0) writeAuditEntry çağrılır. target = '<kind>:<id>' (canned_response / tag / custom_field / ticket_rule / ticket_email_template). metadata YALNIZ { kind } taşır — silinen kaydın adı, gövdesi veya değerleri metadata'ya YAZILMAZ.

**Details:**

08.9.7-d — data.deleted eylemi + ayarlar ailesi hedefli silmelerinde audit  [SONNET-XHIGH]

PRD: NFR-S12 (+ NFR-C8 veri yaşam döngüsü)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 4 route dosyası + test; yeni güvenlik sınırı yok (yazım mevcut writeAuditEntry'den geçiyor, tenancy'yi RLS zorluyor); eşzamanlılık yok; kopyalanacak desen ismen var (settings.ts:275-298); kontrat değişikliği yok; kabul kriteri mekanik (silme başına tam 1 entry, no-op'ta 0).
NEDEN AÇIK: NFR-S12'nin 'veri silme' maddesi bugün yalnız otomatik toplu sweep için karşılanıyor (retention.ts:145-148 data.retention_pruned). Hedefli silme uçlarında audit yok: grep writeAuditEntry settings.ts'te yalnız trusted_domain_added/removed + security/routing/chat_timeout/widget satırlarını gösteriyor; canned-response silme (settings.ts:390), tag silme (settings.ts:769), ticket-rules.ts:118, ticket-email-templates.ts:101 ve custom-fields.ts:103 audit'siz. NOT: depoda DELETE /customers/:customerId diye bir erasure ucu YOK — customers.ts:171 DELETE /customers/:customerId/ban (ban kaldırma) ucudur; kaynak olgulardaki bu iddia koda karşı doğrulanmadı ve düzeltildi.
KAPSAM: AUDIT_ACTIONS'a tek bir 'data.deleted' eylemi eklenir. Beş silme ucunda, zaten var olan request.withTenant(tx) bloğunun içinde ve yalnız gerçekten silindiğinde (count > 0) writeAuditEntry çağrılır. target = '<kind>:<id>' (canned_response / tag / custom_field / ticket_rule / ticket_email_template). metadata YALNIZ { kind } taşır — silinen kaydın adı, gövdesi veya değerleri metadata'ya YAZILMAZ.
DOSYALAR: apps/api/src/services/audit/audit-log.ts · apps/api/src/services/audit/audit-log.test.ts · apps/api/src/routes/settings.ts · apps/api/src/routes/ticket-rules.ts · apps/api/src/routes/ticket-email-templates.ts · apps/api/src/routes/custom-fields.ts · apps/api/test/integration/audit-log.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/settings.ts:275-298 (DELETE /settings/trusted-domains/:domainId — deleteMany + count>0 kapısı + writeAuditEntry aynı tx içinde) · apps/api/test/integration/audit-log.test.ts:110-131 ('records a trusted domain being removed (and not a no-op delete)' testi birebir kopyalanabilir)
KK (birebir): "Temel audit (login, rol değişimi, veri silme, webhook değişimi, son 30 gün) tüm planlarda" | "KK3: Audit log (login, rol değişimi, veri silme, webhook değişimi) tutulur (§7). — kaynak: US-11, satır 325"
KK DOĞRULAMA: test/integration/audit-log.test.ts: beş silme ucunun her biri tam olarak bir data.deleted entry'si yazar (doğru target/kind); 404 silme entry yazmaz. KK'nın 'veri silme' maddesinin hedefli silme payını kanıtlar.
KAPSAM DIŞI: İçerik/entegrasyon silme uçları (websites/playbook/copilot/apps) — 08.9.7-e · Toplu retention sweep audit'i (retention.ts'te zaten var) · GDPR tekil erasure ucu (depoda yok, bu turda eklenmiyor)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 92.5. 08.9.7-e [SONNET-XHIGH] İçerik ve entegrasyon silme uçlarında data.deleted audit'i

**Status:** done  
**Dependencies:** 92.4  

08.9.7-d'de tanımlanan 'data.deleted' eylemi bu beş uca uygulanır; her biri kendi mevcut request.withTenant(tx) bloğunun içinde, yalnız silme gerçekleştiyse yazar. target = '<kind>:<id>' (website / skill / knowledge_source / copilot_source / app_installation). metadata yalnız { kind }.

**Details:**

08.9.7-e — İçerik ve entegrasyon silme uçlarında data.deleted audit'i  [SONNET-XHIGH]

PRD: NFR-S12 (+ NFR-C8)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 5 route dosyası, tek satırlık aynı dönüşüm; eylem sözlüğü 08.9.7-d'de tanımlandığı için burada yalnız uygulama var; güvenlik kararı yok, eşzamanlılık yok; referans desen ismen 08.9.7-d'nin kendisi + settings.ts:275-298; kabul kriteri mekanik.
NEDEN AÇIK: grep writeAuditEntry: websites.ts, playbook.ts, copilot.ts ve apps.ts dosyalarının hiçbirinde geçmiyor (0 sonuç). Oysa hepsi kalıcı silme yapıyor: DELETE /websites/:websiteId (websites.ts:111), DELETE /playbook/skills/:skillId (playbook.ts:267), DELETE /knowledge-sources/:sourceId (playbook.ts:437), DELETE /copilot/knowledge/:sourceId (copilot.ts:116), DELETE /settings/apps/:appId (apps.ts:76).
KAPSAM: 08.9.7-d'de tanımlanan 'data.deleted' eylemi bu beş uca uygulanır; her biri kendi mevcut request.withTenant(tx) bloğunun içinde, yalnız silme gerçekleştiyse yazar. target = '<kind>:<id>' (website / skill / knowledge_source / copilot_source / app_installation). metadata yalnız { kind }.
DOSYALAR: apps/api/src/routes/websites.ts · apps/api/src/routes/playbook.ts · apps/api/src/routes/copilot.ts · apps/api/src/routes/apps.ts · apps/api/test/integration/audit-log.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/settings.ts:275-298 (count>0 kapısı + tx içinde yazım) · apps/api/src/routes/webhooks.ts:77-89 (removed === 0 → 404 deseni, aynı yapı)
KK (birebir): "Temel audit (login, rol değişimi, veri silme, webhook değişimi, son 30 gün) tüm planlarda"
KK DOĞRULAMA: test/integration/audit-log.test.ts: beş ucun her biri tam olarak bir data.deleted entry'si yazar; 404 silmede entry yok. 'veri silme' maddesinin içerik/entegrasyon payını kapatır.
KAPSAM DIŞI: Ayarlar ailesi uçları (08.9.7-d) · Chat tag kaldırma (chats.ts:320) — konuşma içi etiket düşürme veri silme değil, kapsam dışı · Ekranda gösterim (08.9.7-i/-j)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 92.6. 08.9.7-f [OPUS-MAX] Rol değişimi ucu (PUT /agents/{agentId}/role) + member.role_changed audit'i

**Status:** done  
**Dependencies:** 92.3  

Contract-first: agents.yaml'a PUT /agents/{agentId}/role + openapi.yaml kaydı + re-bundle. Route: config { scopes: ['agents--all:rw'], minimumRole: 'admin' } çift kapı; guard'lar (suspension ucunun deseninin aynısı, rol için): aktör agent principal olmalı; roleAtLeast(actorRole,'admin'); kendi rolünü değiştiremez; hedef owner ise reddedilir (owner devri kapsam dışı); yeni rol aktörün rolünü AŞAMAZ

**Details:**

08.9.7-f — Rol değişimi ucu (PUT /agents/{agentId}/role) + member.role_changed audit'i  [OPUS-MAX]

PRD: NFR-S12 (+ NFR-S3 RBAC, US-11 KK3)
ETİKET GEREKÇESİ: OPUS-MAX: yetki yükseltme (privilege escalation) sınırı — kim kimi hangi role taşıyabilir, owner nasıl korunur, kendi rolünü değiştirme nasıl engellenir. Koşul 2 ihlali ve yanlış kararın pahalı olduğu tipik durum (bir admin kendini owner yapabilirse tüm RBAC çöker). Çekirdek BÖLÜNMEZ: guard'lar tek akıl yürütmedir.
NEDEN AÇIK: Depoda rol değiştiren hiçbir uç yok: agents.ts'in tüm route'ları routing-status (51), notification-preferences (104), liste (131), suspension (161) ve groups (233); rol yalnız davet gövdesinde (account-lifecycle.ts:41 role: z.enum(['admin','agent'])) ve suspension audit metadata'sında (agents.ts:223 metadata:{role:targetRole}) geçiyor — suspend askıya alır, rol değiştirmez. Yani NFR-S12'nin birebir saydığı 'rol değişimi' olayı üretilebilir DEĞİL: AUDIT_ACTIONS'ta karşılığı da yok.
KAPSAM: Contract-first: agents.yaml'a PUT /agents/{agentId}/role + openapi.yaml kaydı + re-bundle. Route: config { scopes: ['agents--all:rw'], minimumRole: 'admin' } çift kapı; guard'lar (suspension ucunun deseninin aynısı, rol için): aktör agent principal olmalı; roleAtLeast(actorRole,'admin'); kendi rolünü değiştiremez; hedef owner ise reddedilir (owner devri kapsam dışı); yeni rol aktörün rolünü AŞAMAZ (roleAtLeast(actorRole, nextRole)); hedefin mevcut rolü aktörün üstündeyse reddedilir; no-op (aynı rol) hiçbir şey yazmaz. AUDIT_ACTIONS'a 'member.role_changed'; entry aynı tx içinde, target 'account:<id>', metadata { from, to }.
DOSYALAR: apps/api/src/routes/agents.ts · apps/api/src/services/audit/audit-log.ts · apps/api/src/services/audit/audit-log.test.ts · packages/contract/openapi/paths/agents.yaml · packages/contract/openapi/openapi.yaml · apps/api/test/integration/agents-suspension.test.ts · apps/api/test/integration/audit-log.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/agents.ts:161-231 (PUT /agents/:agentId/suspension — scope+rol çift kapısı, owner koruması, kendi kendine uygulama yasağı, roleAtLeast karşılaştırması, no-op'ta entry yazmama, tx içinde writeAuditEntry) · apps/api/src/services/auth/principal.ts (roleAtLeast + ROLE_RANK) · apps/api/test/integration/agents-suspension.test.ts (aynı guard ailesinin negatif test seti)
KK (birebir): "Temel audit (login, rol değişimi, veri silme, webhook değişimi, son 30 gün) tüm planlarda" | "KK3: Audit log (login, rol değişimi, veri silme, webhook değişimi) tutulur (§7). — kaynak: US-11, satır 325"
KK DOĞRULAMA: test/integration/audit-log.test.ts: admin bir üyeyi agent→admin taşır, tam olarak bir member.role_changed entry'si (from/to metadata'sıyla) yazılır → KK'nın 'rol değişimi' maddesi birebir kanıtlanır. Guard'lar agents-suspension.test.ts komşusunda negatif testlerle kanıtlanır.
KAPSAM DIŞI: Owner devri (ownership transfer) — ayrı ve daha ağır bir invaryant (son-owner kuralı), bu alt-görevde reddedilir · Bot/AI hesaplarının rolü · Ekranda rol değiştirme UI'ı (Team ekranı) — bu turda yok, uç API seviyesinde kalır · Davet rolü akışı (account-lifecycle.ts, zaten audit'li)
SÖZLEŞME: YENİ: PUT /agents/{agentId}/role — paths/agents.yaml + openapi.yaml kaydı + re-bundle. UYARI: OpenAPI'ye eklenmezse contract-parity.test.ts KIRILIR (belgesiz route yönü).
MIGRATION: yok (agent_memberships.role kolonu ve rol CHECK'i zaten mevcut)
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 92.7. 08.9.7-g [SONNET-XHIGH] Retention politikasına audit penceresi (RETENTION_AUDIT_DAYS=30) — politika/env/rapor iskeleti

**Status:** done  
**Dependencies:** None  

RetentionPolicy'ye auditDays; env'e RETENTION_AUDIT_DAYS (z.coerce.number().int().positive().default(30) — NFR-S12 'son 30 gün'); .env.example satırı; resolveCutoffs'a audit cutoff'u (mevcut cutoffFor invaryantı: pozitif olmayan pencere reddedilir, cutoff asla 'now' veya sonrası olamaz); RetentionReport tipine auditEntries sayacı (bu adımda daima 0, silme yok). Runner davranışı DEĞİŞMEZ.

**Details:**

08.9.7-g — Retention politikasına audit penceresi (RETENTION_AUDIT_DAYS=30) — politika/env/rapor iskeleti  [SONNET-XHIGH]

PRD: NFR-S12 'son 30 gün' (+ NFR-C8 saklama politikası)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 4-5 dosya, saf politika/aritmetik; DB'ye hiç dokunmuyor (silme 08.9.7-h'de), dolayısıyla güvenlik sınırı yok; eşzamanlılık yok; kopyalanacak desen ismen var (policy.ts'teki threadDays/visitDays/mailDays üçlüsü + policy.test.ts); kontrat değişikliği yok; kabul kriteri mekanik (varsayılan 30, pozitif olmayan pencere reddedilir).
NEDEN AÇIK: services/retention/policy.ts'teki RetentionPolicy arayüzü yalnız threadDays/visitDays/mailDays taşıyor ve config/env.ts:72-74 yalnız RETENTION_THREAD_DAYS/RETENTION_VISIT_DAYS/RETENTION_MAIL_DAYS tanımlıyor; audit_log hiçbir pencereye bağlı değil → satırlar süresiz birikiyor. Dosyanın kendi başlığı da audit'i kapsam dışı sayıyor (üç pencere sayılıyor).
KAPSAM: RetentionPolicy'ye auditDays; env'e RETENTION_AUDIT_DAYS (z.coerce.number().int().positive().default(30) — NFR-S12 'son 30 gün'); .env.example satırı; resolveCutoffs'a audit cutoff'u (mevcut cutoffFor invaryantı: pozitif olmayan pencere reddedilir, cutoff asla 'now' veya sonrası olamaz); RetentionReport tipine auditEntries sayacı (bu adımda daima 0, silme yok). Runner davranışı DEĞİŞMEZ.
DOSYALAR: apps/api/src/services/retention/policy.ts · apps/api/src/services/retention/policy.test.ts · apps/api/src/services/retention/retention.ts · apps/api/src/config/env.ts · .env.example
REFERANS DESEN (kopyalanacak): apps/api/src/services/retention/policy.ts (threadDays/visitDays/mailDays: arayüz + resolveRetentionPolicy + cutoffFor deseni birebir kopyalanır) · apps/api/src/services/retention/policy.test.ts (pencere başına mevcut birim testleri) · apps/api/src/config/env.ts:72-74 (env şeması satırları)
KK (birebir): "Temel audit (login, rol değişimi, veri silme, webhook değişimi, son 30 gün) tüm planlarda"
KK DOĞRULAMA: policy.test.ts: varsayılan auditDays = 30 ('son 30 gün'); resolveCutoffs audit cutoff'unu 30 gün öncesine koyuyor; sıfır/negatif pencere reddediliyor. KK'nın 'son 30 gün' payının politika tarafını kanıtlar.
KAPSAM DIŞI: Fiili silme + SECURITY DEFINER fonksiyonu — 08.9.7-h · Plan bazlı farklı pencere (temel 30 gün vs Enterprise genişletilmiş): repoda entitlement/plan-gate mekanizması hiç yok (grep 'entitlement|planGate|requirePlan' → 0), ayrı tasarım kararı gerektirir · Kiracı başına özelleştirilebilir pencere (security_settings kolonu)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 92.8. 08.9.7-h [OPUS-MAX] Append-only log'da süreli budama: audit_prune_expired SECURITY DEFINER + retention sweep bağlantısı

**Status:** done  
**Dependencies:** 92.7  

Yeni migration: retention_list_tenants() desenini birebir izleyen dar bir fonksiyon — audit_prune_expired(p_license_id BIGINT, p_cutoff TIMESTAMPTZ) RETURNS BIGINT, LANGUAGE plpgsql SECURITY DEFINER, SET search_path = public, pg_temp; YALNIZ 'license_id = p_license_id AND created_at < p_cutoff' satırlarını siler, silinen sayıyı döndürür; p_cutoff NULL veya now() ve sonrası ise exception atar. REVO

**Details:**

08.9.7-h — Append-only log'da süreli budama: audit_prune_expired SECURITY DEFINER + retention sweep bağlantısı  [OPUS-MAX]

PRD: NFR-S12 'son 30 gün' (+ NFR-C8, NFR-S4 bütünlük)
ETİKET GEREKÇESİ: OPUS-MAX: append-only invaryantına kontrollü bir delik açılıyor. audit_log'da UPDATE/DELETE siyahtus_app'ten REVOKE edilmiş ve RLS'te yalnız SELECT/INSERT politikası var; budama ancak RLS'i atlayan SECURITY DEFINER bir fonksiyonla mümkün — yani fonksiyonun yaş yüklemi ve lisans parametresi TEK cross-tenant savunması. Yanlış yazılırsa tüm kiracıların denetim izi silinir. Koşul 2+3 ihlali; çekirdek bölünmez.
NEDEN AÇIK: migrations/20260722154008_domain_model/migration.sql:997-1006 → audit_log ENABLE RLS + yalnız audit_log_read (SELECT) ve audit_log_append (INSERT) politikaları; ardından 'REVOKE UPDATE, DELETE ON audit_log FROM siyahtus_app'. Mevcut RetentionRunner (services/retention/retention.ts) TÜM silmelerini siyahtus_app + withTenant üzerinden yapıyor → 30 günlük pencere normal yoldan UYGULANAMAZ; audit satırları bugün süresiz birikiyor.
KAPSAM: Yeni migration: retention_list_tenants() desenini birebir izleyen dar bir fonksiyon — audit_prune_expired(p_license_id BIGINT, p_cutoff TIMESTAMPTZ) RETURNS BIGINT, LANGUAGE plpgsql SECURITY DEFINER, SET search_path = public, pg_temp; YALNIZ 'license_id = p_license_id AND created_at < p_cutoff' satırlarını siler, silinen sayıyı döndürür; p_cutoff NULL veya now() ve sonrası ise exception atar. REVOKE EXECUTE FROM PUBLIC + GRANT EXECUTE TO siyahtus_app. Tablo üzerindeki DELETE yetkisi siyahtus_app'e VERİLMEZ (mevcut REVOKE aynen kalır). RetentionRunner'ın per-tenant döngüsüne bağlanır (batch'li, dryRun'da hiçbir şey silmez, sayım döndürür); sonuç mevcut data.retention_pruned entry'sinin metadata'sına audit_entries olarak eklenir.
DOSYALAR: apps/api/prisma/migrations/<yeni>_audit_retention_window/migration.sql · apps/api/src/services/retention/retention.ts · apps/api/test/integration/retention.test.ts · apps/api/test/integration/audit-log.test.ts
REFERANS DESEN (kopyalanacak): apps/api/prisma/migrations/20260725090000_retention_tenants/migration.sql (retention_list_tenants: dar SECURITY DEFINER + SET search_path + GRANT EXECUTE TO siyahtus_app; yorumu 'küçük, adlandırılmış, gözden geçirilebilir bir delik' gerekçesini de veriyor) · apps/api/src/services/retention/retention.ts (#pruneTenant + #deleteInBatches + dryRun ayrımı + data.retention_pruned yazımı) · apps/api/test/integration/audit-log.test.ts:300-360 ('the log cannot be rewritten' — siyahtus_app'in UPDATE/DELETE reddi testleri, aynen korunmalı)
KK (birebir): "Temel audit (login, rol değişimi, veri silme, webhook değişimi, son 30 gün) tüm planlarda"
KK DOĞRULAMA: test/integration/retention.test.ts: 31 gün önce yazılmış audit satırı sweep sonrası yok, 29 günlük satır duruyor → 'son 30 gün' birebir kanıtlanır. audit-log.test.ts'in mevcut append-only testleri yeşil kalır → budama, tabloyu yazılabilir hale getirmedi.
KAPSAM DIŞI: Plan bazlı farklı pencere (Enterprise genişletilmiş saklama) — entitlement mekanizması repoda yok · Budamanın kendisini audit'lemek için ayrı yeni eylem (mevcut data.retention_pruned metadata'sı kullanılır) · Arşive taşıma / cold storage / SIEM aktarımı · siyahtus_app'e tablo düzeyinde DELETE verme — AÇIKÇA yasak
MIGRATION: EVET — yeni Prisma migration (audit_retention_window): yalnız audit_prune_expired(BIGINT, TIMESTAMPTZ) fonksiyonu + REVOKE EXECUTE FROM PUBLIC + GRANT EXECUTE TO siyahtus_app. Tablo/kolon/indeks değişikliği YOK, dolayısıyla schema.prisma değişmez ve db:check-drift temiz kalır.
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 92.9. 08.9.7-i [SONNET-XHIGH] Audit Log ekranı: salt-okunur liste + boş/skeleton/hata durumları + Settings girişi

**Status:** done  
**Dependencies:** 92.1  

Yeni apps/web/src/features/audit/AuditLogPage.tsx: useQuery + api.get('/audit-log') → tablo (Zaman / Eylem / Aktör / Hedef / IP), Skeleton (yükleniyor), EmptyState (anlamlı boş metin, boş dikdörtgen yok), ErrorNotice (hata). App.tsx'e '/app/settings/audit-log' route'u. SettingsPage.tsx'e Integrations kartı deseninde bir giriş bölümü. RBAC: scopes.includes('audit_log--all:ro') değilse giriş kartı g

**Details:**

08.9.7-i — Audit Log ekranı: salt-okunur liste + boş/skeleton/hata durumları + Settings girişi  [SONNET-XHIGH]

PRD: NFR-S12 (kullanıcıya görünür audit ekranı) + FR-EK-B.1 (skeleton + anlamlı empty state)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 4-5 dosya (yeni sayfa + route + giriş kartı + test); veri yolu ve yetki kapısı 08.9.7-a'da kuruldu, burada yalnız render var; eşzamanlılık/algoritma yok; kopyalanacak desen ismen var (CustomersPage.tsx liste + Page/EmptyState/Skeleton bileşenleri + SettingsPage Integrations 'kapı' kartı); kontrat değişikliği yok; kabul kriteri mekanik (satırlar render, boş durumda anlamlı metin).
NEDEN AÇIK: apps/web/src altında 'audit' geçen hiçbir dosya veya satır yok (grep 0 sonuç). SettingsPage.tsx (1953 satır) yalnız ChannelsGrid/Integrations/Notification/WebsiteWidgets/WidgetCustomization/TrustedDomains/BannedCustomerIps/FileSharing/CannedResponses/Tags/RoutingRules/TicketRules/TicketEmailTemplates/CustomFields/PreChatForm bölümlerini render ediyor (satır 106-131) — audit görüntüleme yok.
KAPSAM: Yeni apps/web/src/features/audit/AuditLogPage.tsx: useQuery + api.get('/audit-log') → tablo (Zaman / Eylem / Aktör / Hedef / IP), Skeleton (yükleniyor), EmptyState (anlamlı boş metin, boş dikdörtgen yok), ErrorNotice (hata). App.tsx'e '/app/settings/audit-log' route'u. SettingsPage.tsx'e Integrations kartı deseninde bir giriş bölümü. RBAC: scopes.includes('audit_log--all:ro') değilse giriş kartı gösterilmez ve sayfa yetki uyarısı render eder (UI gizleme YETERLİ DEĞİLDİR — asıl kapı 08.9.7-a'daki route scope+minimumRole gatingidir).
DOSYALAR: apps/web/src/features/audit/AuditLogPage.tsx · apps/web/src/features/audit/AuditLogPage.test.tsx · apps/web/src/App.tsx · apps/web/src/features/settings/SettingsPage.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/customers/CustomersPage.tsx (useApiClient + useQuery + api.get('/customers?...') + liste render + seçim/boş durum yönetimi) · apps/web/src/features/settings/SettingsPage.tsx:144-176 (Integrations — başka bir ekrana açılan 'kapı' bölümü deseni) ve :329-460 (TrustedDomains — scope'a bağlı canEdit gating + liste render) · apps/web/src/components/Page.tsx + EmptyState.tsx + Skeleton.tsx (Page/Section/CardSkeleton/ErrorNotice/EmptyState) · apps/web/src/features/inbox/TicketGrid.tsx (aria-sort'lu tablo başlıkları — salt-okunur grid deseni)
KK (birebir): "Temel audit (login, rol değişimi, veri silme, webhook değişimi, son 30 gün) tüm planlarda" | "KK-türetilmiş: audit izi kullanıcıya görünür bir ekrandan okunabilir olmalı. Türetme gerekçesi: PRD KK'sı yalnız 'tutulur' diyor; kalemin başlığı ve orkestratörün bağlayıcı kapsam kararı ('kullanıcıya görünür ekran') ekran yüzeyini gerektiriyor, PRD'de ekran KK'sı yok (kk_yetersiz)."
KK DOĞRULAMA: AuditLogPage.test.tsx: kayıt varken satırlar (eylem/aktör/zaman) render ediliyor; kayıt yokken anlamlı empty state (boş dikdörtgen değil); yükleme sırasında skeleton; hata durumunda ErrorNotice. Ayrıca yetkisiz scope ile giriş kartı render EDİLMİYOR.
KAPSAM DIŞI: Filtre kontrolleri + 'daha fazla yükle' + e2e — 08.9.7-j · CSV export butonu (Enterprise payı) · Kayıt detay çekmecesi/modal'ı · SettingsPage içine gömülü bölüm (dosya 1953 satır — ayrı sayfa tercih edildi)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 92.10. 08.9.7-j [SONNET-XHIGH] Audit ekranı filtreleri (eylem/tarih) + 'daha fazla yükle' + e2e görünürlük

**Status:** done  
**Dependencies:** 92.2, 92.9  

Eylem seçici (AUDIT_ACTIONS'tan üretilen liste veya olay ailesi grupları) + tarih aralığı kontrolü (varsayılan son 30 gün, ekranda görünür şekilde belirtilir) + next_page_id ile 'daha fazla yükle'. Seçimler URL parametresine yazılır (paylaşılabilir/deep-link). e2e: owner olarak giriş → Settings → Audit log → login kaydı görünür.

**Details:**

08.9.7-j — Audit ekranı filtreleri (eylem/tarih) + 'daha fazla yükle' + e2e görünürlük  [SONNET-XHIGH]

PRD: NFR-S12 (+ FR-EK-B.1 liste davranışları)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı — 2-3 dosya + e2e; backend filtreleri 08.9.7-b'de hazır, burada yalnız kontrol + sorgu parametresi bağlama var; güvenlik kararı yok; kopyalanacak desen ismen var (CustomersPage segment sekmeleri + debounce arama, ReportsPage aralık kontrolü); kabul kriteri mekanik (filtre listeyi daraltır, daha fazla yükle ikinci sayfayı ekler).
NEDEN AÇIK: 08.9.7-i yalnız ilk sayfayı, filtresiz render ediyor; 08.9.7-b'de eklenen action/actor_id/date_from/date_to parametreleri ve 08.9.7-a'nın next_page_id'si UI'da hiçbir yerde kullanılmıyor — dolayısıyla NFR-S12'nin dört olay ailesi ekranda ayrıştırılamıyor.
KAPSAM: Eylem seçici (AUDIT_ACTIONS'tan üretilen liste veya olay ailesi grupları) + tarih aralığı kontrolü (varsayılan son 30 gün, ekranda görünür şekilde belirtilir) + next_page_id ile 'daha fazla yükle'. Seçimler URL parametresine yazılır (paylaşılabilir/deep-link). e2e: owner olarak giriş → Settings → Audit log → login kaydı görünür.
DOSYALAR: apps/web/src/features/audit/AuditLogPage.tsx · apps/web/src/features/audit/AuditLogPage.test.tsx · apps/e2e/tests/settings.spec.ts
REFERANS DESEN (kopyalanacak): apps/web/src/features/customers/CustomersPage.tsx (segment sekmeleri + debounce arama + searchParams ile URL senkronu, satır ~40-125) · apps/web/src/features/reports/ReportsPage.tsx (paylaşılan aralık kontrolü + sekme deseni) · apps/web/src/features/inbox/TicketGrid.tsx (URL param sıralama deep-link deseni — 02.7-a) · apps/e2e/tests/settings.spec.ts (mevcut settings e2e akışı)
KK (birebir): "Temel audit (login, rol değişimi, veri silme, webhook değişimi, son 30 gün) tüm planlarda"
KK DOĞRULAMA: AuditLogPage.test.tsx: eylem seçimi isteği action parametresiyle yapıyor ve liste daralıyor; ekran varsayılan pencereyi 'son 30 gün' olarak gösteriyor; 'daha fazla yükle' ikinci sayfayı ekliyor. e2e settings.spec.ts: owner Audit log ekranında kendi login kaydını görüyor.
KAPSAM DIŞI: Serbest metin arama · CSV export (Enterprise payı) · Sanallaştırılmış liste (VirtualList) — sayfa boyutu küçük, gerekmiyor
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 92.11. 08.9.7-k [OPUS-XHIGH] NFR-S12 uçtan uca doğrulama: dört olay + 30 gün penceresi + 'tüm planlarda' kanıtı

**Status:** done  
**Dependencies:** 92.2, 92.3, 92.5, 92.6, 92.8, 92.10  

Tek bir uçtan uca senaryo süiti: (1) login → rol değişimi → webhook oluştur+sil → hedefli veri silme; dördü de GET /audit-log'da doğru eylem adlarıyla görünür; (2) 30 günden eski bir satır budama sonrası listede yok, 29 günlük satır var; (3) iki farklı plandaki (deneme/ücretli abonelik) lisansta aynı davranış — audit ne yazımda ne okumada plana bağlı değil; (4) cross-tenant: B'nin hiçbir olayı A'n

**Details:**

08.9.7-k — NFR-S12 uçtan uca doğrulama: dört olay + 30 gün penceresi + 'tüm planlarda' kanıtı  [OPUS-XHIGH]

PRD: NFR-S12 (+ PRD §11 risk R5, v2-04 R10)
ETİKET GEREKÇESİ: OPUS-XHIGH: çok yüzeyli bağlama (kontrat + backend + migration + UI + RTM'siz e2e) ve KK'da yorum gerektiren bir iddianın ('tüm planlarda') koda karşı kanıtlanması. Yeni güvenlik sınırı kurmuyor ama kurulanların bütününü doğruluyor → MAX değil, SONNET de değil.
NEDEN AÇIK: NFR-S12 dört olay ailesini birebir sayıyor; bu turdan önce yalnız login (auth.ts:140) ve toplu veri silme (retention.ts:145-148) kaydediliyordu — rol değişimi ve webhook değişimi eylemleri AUDIT_ACTIONS sözlüğünde bile yoktu. 'Tüm planlarda' iddiası ise kanıtsız: repoda plan/tier kapısı hiç kurulmamış (grep 'entitlement|planGate|requirePlan' → 0 sonuç; schema.prisma AuditLogEntry yorumu: 'PRD §8.4 makes this available on every plan, not just Enterprise as the source platform does'). Yani kapı 'kaldırılmadı', hiç kurulmadı — bu, varsayımla değil testle kapatılmalı.
KAPSAM: Tek bir uçtan uca senaryo süiti: (1) login → rol değişimi → webhook oluştur+sil → hedefli veri silme; dördü de GET /audit-log'da doğru eylem adlarıyla görünür; (2) 30 günden eski bir satır budama sonrası listede yok, 29 günlük satır var; (3) iki farklı plandaki (deneme/ücretli abonelik) lisansta aynı davranış — audit ne yazımda ne okumada plana bağlı değil; (4) cross-tenant: B'nin hiçbir olayı A'nın ekranında/yanıtında yok; (5) e2e ekran görünürlüğü. Kanıt HANDOFF'a yazılır.
DOSYALAR: apps/api/test/integration/audit-log-read.test.ts · apps/api/test/integration/audit-log.test.ts · apps/e2e/tests/settings.spec.ts
REFERANS DESEN (kopyalanacak): apps/api/test/integration/audit-log.test.ts (dört özelliğin ayrı ayrı iddia edilmesi + fixtures iki kiracı deseni) · apps/api/test/integration/tenant-isolation.test.ts (çapraz-kiracı süit deseni)
KK (birebir): "Temel audit (login, rol değişimi, veri silme, webhook değişimi, son 30 gün) tüm planlarda" | "genişletilmiş + SIEM Enterprise" | "KK3: Audit log (login, rol değişimi, veri silme, webhook değişimi) tutulur (§7). — kaynak: US-11, satır 325"
KK DOĞRULAMA: Tek testte KK'nın her maddesi ayrı ayrı iddia edilir: dört eylem ailesi listede → 'login, rol değişimi, veri silme, webhook değişimi'; 31 günlük satırın yokluğu → 'son 30 gün'; iki farklı planlı lisansta aynı sonuç → 'tüm planlarda'. 'genişletilmiş + SIEM Enterprise' maddesi bu turda AÇIKÇA yapılmadı olarak kayda geçer (kapsam dışı gerekçesiyle).
KAPSAM DIŞI: Enterprise 'genişletilmiş + SIEM' payı (entitlement mekanizması yok — ayrı kalem) · Yük/performans ölçümü (audit_log büyüme senaryosu) · Export/CSV
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
