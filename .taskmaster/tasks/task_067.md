# Task ID: 67

**Title:** 08.8.3 — MCP server (search_tickets/list_chats/get_report)  ·  dilim V2-5

**Status:** done

**Dependencies:** 78 ✓

**Priority:** medium

**Description:** FR-MOD-08.8.3 · Could (v2) · [MAX] ↑ · §7, LLM.

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `08.8.3`.

8 atomik alt-görev · ~9 pencere · etiket dağılımı: OPUS-MAX x1 · OPUS-XHIGH x3 · SONNET-XHIGH x4

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  08.8.3-a [SONNET-XHIGH] MCP tool kataloğu — saf veri modülü (4 tool descriptor + input şemaları)  (bağ: —)
  08.8.3-b [OPUS-XHIGH] MCP kontratı (paths/mcp.yaml) + GET /mcp/manifest keşif ucu  (bağ: 08.8.3-a)
  08.8.3-c [OPUS-MAX] Tool-call yürütücüsü — scope gate + tenant kapsamı + IDOR 404 + audit + search_tickets referans tool'u (BÖLÜNMEZ ÇEKİRDEK)  (bağ: 08.8.3-a, 08.8.3-b)
  08.8.3-d [SONNET-XHIGH] list_chats tool adaptörü (mevcut chat listeleme yoluna bağlama)  (bağ: 08.8.3-c)
  08.8.3-e [SONNET-XHIGH] get_report tool adaptörü — `report` enum'u ile mevcut 4 rapor sorgusuna eşleme  (bağ: 08.8.3-c)
  08.8.3-f [OPUS-XHIGH] summarize_chat tool'u + tool yanıtlarında PII/CC-mask sınırının doğrulanması  (bağ: 08.8.3-c)
  08.8.3-g [SONNET-XHIGH] Settings → MCP bağlantı ekranı (mcp URL + Copy + Claude setup + örnek prompt)  (bağ: 08.8.3-b)
  08.8.3-h [OPUS-XHIGH] Uçtan uca MCP istemci akışı + rate-limit kapsaması + audit doğrulaması  (bağ: 08.8.3-c, 08.8.3-d, 08.8.3-e, 08.8.3-f)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): Çekirdek = 08.8.3-c (tool çözümleme → scope gate → tenant kapsamı → IDOR 404 → audit). Bu dört karar tek akıl yürütmedir: gate'i dispatch'ten ayıran bir bölme, bir pencereye "hangi scope yeterli", başka bir pencereye "hangi tenant görülebilir" kararını verir; aradaki boşluk (ör. hasAnyScope geçtikten sonra sorgunun request.withTenant DIŞINDA çalışması, ya da yetkisiz id için 403 dönüp kaynağın varlığını doğrulaması) hiçbir pencerenin kabul kriterinde görünmez. Bu yüzden gate + tenant kapsamı + referans tool (search_tickets) tek alt-görevde (2 pencere bütçesi) kalır. Çekirdeğin ETRAFINDAKİ her şey dışarı çıkarıldı: saf katalog verisi (-a), kontrat+manifest (-b), üç tool adaptörü (-d/-e/-f), salt-okunur UI (-g), uçtan uca doğrulama (-h). Böylece OPUS-MAX penceresi 9 pencerenin yalnız 2'si.

VARSAYIMLAR: Tool yüzeyi TEK genel uç olarak kurulur: POST /api/v1/mcp/tools/{tool} (tool adı path param). Olgulardaki per-tool path listesi kendi içinde 'tahmini öneri' olarak işaretliydi; tek uç, yeni tool eklerken kontrat değişikliği ve re-bundle gerektirmediği için -d/-e/-f alt-görevlerini ucuzlatır. · MCP istemcisinin kimliği MEVCUT yollarla kurulur: PAT (Basic base64(account_id:PAT)) veya mevcut OAuth 2.1 Auth-Code+PKCE akışı (apps/api/src/routes/auth.ts). Dynamic client registration (RFC 7591) / headless izin akışı BU KALEMİN KAPSAMI DIŞINDADIR — olgularda 'tahmin edilenden daha büyük bir OAuth-altyapı işi olabilir' diye işaretlendi; ayrı kalem olarak açılmalı. · MCP'ye özel YENİ SCOPE eklenmez. Mevcut tickets--*:ro / chats--*:ro / reports_read ödünç alınır. Gerekçe: packages/types/src/scopes.ts'e scope eklemek scopes.test.ts'teki sabit sayacı (SOURCE_SCOPE_COUNT + SIYAHTUS_ADDED_SCOPES) da değiştirir ve MCP'nin yetki modeli zaten 'kullanıcının kendi scope'larıyla sınırlı' (PRD:1386) diyor — ayrı scope bu ilkeyi zayıflatır. · YENİ ApiError TİPİ eklenmez; validation / authorization / not_found kullanılır. Gerekçe: yeni tip errors.ts (2 yer) + scopes.test.ts sayacı + openapi enum + regen zinciri gerektiriyor (proje hafızası: siyahtus-error-type-additions) ve MCP hataları bu üç tipe tam oturuyor. · api_tokens.kind'a 'mcp' değeri EKLENMEZ; MCP token'ı 'pat' veya 'oauth' olarak kalır → hiçbir alt-görevde Prisma migration yok. · get_report TEK tool olarak kalır ve zorunlu `report` argümanı enum alır: overview | breakdown | ai-agent | reviews — apps/api/src/routes/reports.ts'teki dört reports_read korumalı uca birebir karşılık. PRD bu eşlemeyi söylemiyordu (olgular: 'belirsiz'); karar burada verildi ki alt-görev mekanik kalsın. · summarize_chat SALT-OKUNUR'dur: özet döndürür, internal note YAZMAZ. Bu yüzden yazma scope'u değil okuma scope'u (chats--*:ro) yeterlidir ve mevcut POST /copilot/chats/:chatId/summary davranışı değişmez. · MCP server URL'i yerel/mock origin'den türetilir; rapor

AÇIK SORULAR (ürün kararı): Claude Desktop/ChatGPT gibi bir MCP istemcisi gerçekten JSON-RPC/SSE bekliyorsa, REST tool uçları yeterli mi yoksa ayrı bir POST /mcp JSON-RPC köprüsü ayrı bir kalem olarak açılmalı mı? (varsayım 10) · Dynamic client registration (RFC 7591) v2 kapsamında mı? Bugünkü /auth/authorize insan tarayıcı login formu varsayıyor — MCP istemcisinin PAT ile bağlanması kabul edilebilir bir MVP mi? · get_report enum'una CSV export (/reports/export, ayrı EXPORT_SCOPES) dahil edilecek mi? Şimdilik kapsam dışı bırakıldı. · summarize_chat çağrısı copilot.recordAssist / Assisted metriğini ve ADR-09 AI-resolution sayacını besleyecek mi? Beslerse MCP çağrıları faturayı etkiler. · MCP tool çağrıları için ayrı bir rate-limit kovası mı gerekli, yoksa mevcut PAT kovası yeterli mi? Ayrıca 10.1.5 'API calls' faturalama sayacı MCP çağrılarını da saymalı mı? · Manifest, çağıranın scope'larına göre FİLTRELENMELİ mi (yalnız çağırabileceği tool'ları göstersin)? Bugünkü plan statik tam katalog döndürüyor; filtreleme bir yetki kararı olduğu için yapılırsa 08.8.3-c'nin (OPUS-MAX) kapsamına alınmalı.

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 67.1. 08.8.3-a [SONNET-XHIGH] MCP tool kataloğu — saf veri modülü (4 tool descriptor + input şemaları)

**Status:** done  
**Dependencies:** None  

Yeni saf veri modülü: 4 tool descriptor — `name`, `title`, `description`, `inputSchema` (zod + JSON-Schema karşılığı), `requiredScopes`. requiredScopes değerleri mevcut route'lardan BİREBİR kopyalanacak (bu metinde verildi, türetilmeyecek): search_tickets → ['tickets--all:ro','tickets--access:ro'] (apps/api/src/routes/tickets.ts:84 READ_SCOPES); list_chats → ['chats--all:ro','chats--access:ro'] (a

**Details:**

08.8.3-a — MCP tool kataloğu — saf veri modülü (4 tool descriptor + input şemaları)  [SONNET-XHIGH]

PRD: FR-MOD-08.8.3
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. Tek dosya + testi; çalışma zamanı authz KODU YOK (yalnız veri); eşzamanlılık yok; kopyalanacak desen isimle veriliyor (packages/types/src/apps.ts katalog deseni + services/audit/audit-log.ts `as const` katalog deseni); kontrat değişikliği yok; kabul kriteri mekanik (isim listesi + isScope() doğrulaması). requiredScopes DEĞERLERİ bu görev metninde birebir dikte edilmiştir — pencere hiçbir yetki kararı vermez; enforcement ve negatif testler 08.8.3-c'de (OPUS-MAX).
NEDEN AÇIK: `grep -rli mcp apps/ packages/` (.ts/.tsx/.yaml/.prisma) 0 dosya döndürdü — depoda MCP'ye ait hiçbir modül yok. `apps/api/src/services/` altında 22 servis dizini var, `mcp` yok. search_tickets/list_chats/get_report/summarize_chat isimlerinden hiçbiri koda karşı bulunamadı.
KAPSAM: Yeni saf veri modülü: 4 tool descriptor — `name`, `title`, `description`, `inputSchema` (zod + JSON-Schema karşılığı), `requiredScopes`. requiredScopes değerleri mevcut route'lardan BİREBİR kopyalanacak (bu metinde verildi, türetilmeyecek): search_tickets → ['tickets--all:ro','tickets--access:ro'] (apps/api/src/routes/tickets.ts:84 READ_SCOPES); list_chats → ['chats--all:ro','chats--access:ro'] (apps/api/src/routes/chats.ts:126); get_report → ['reports_read'] (apps/api/src/routes/reports.ts:510); summarize_chat → ['chats--all:ro','chats--access:ro'] (salt-okuma; not yazmaz — bkz. varsayım 7). Katalog `as const` dışa aktarılır + `toolByName()` yardımcı fonksiyonu (bilinmeyen ad → undefined). Route/kontrat/enforcement YOK.
DOSYALAR: apps/api/src/services/mcp/tool-catalog.ts · apps/api/src/services/mcp/tool-catalog.test.ts
REFERANS DESEN (kopyalanacak): packages/types/src/apps.ts · apps/api/src/services/audit/audit-log.ts · packages/types/src/scopes.ts
KK (birebir): "search_tickets/list_chats/get_report/summarize_chat tool'ları"
KK DOĞRULAMA: tool-catalog.test.ts: (1) katalog tam olarak 4 tool içerir ve isimleri KK'daki dört isimle birebir eşit → KK 'search_tickets/list_chats/get_report/summarize_chat tool'ları'; (2) her requiredScopes girdisi packages/types isScope() ile geçerli (yazım hatası kapısı); (3) her inputSchema geçerli, boş/bozuk argümanı reddediyor; (4) toolByName('nope') → undefined.
KAPSAM DIŞI: scope enforcement / hasAnyScope çağrısı (08.8.3-c) · route veya OpenAPI path (08.8.3-b, -c) · tool'ların gerçek veri sorguları (08.8.3-c/-d/-e/-f) · UI (08.8.3-g) · yeni scope tanımı — mevcutlar ödünç alınır (varsayım 3)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 67.2. 08.8.3-b [OPUS-XHIGH] MCP kontratı (paths/mcp.yaml) + GET /mcp/manifest keşif ucu

**Status:** done  
**Dependencies:** 67.1  

Contract-first: (1) packages/contract/openapi/paths/mcp.yaml — YALNIZ `manifest` operasyonu; (2) openapi.yaml'a path ref + `McpToolDescriptor` / `McpManifest` şemaları; (3) re-bundle + tip üretimi; (4) apps/api/src/routes/mcp.ts — YALNIZ `GET /mcp/manifest`: kimlikli (varsayılan agent/bot principal), scope gerektirmez, 08.8.3-a katalogunu + server URL'ini + protokol sürümünü döner. `public: true` 

**Details:**

08.8.3-b — MCP kontratı (paths/mcp.yaml) + GET /mcp/manifest keşif ucu  [OPUS-XHIGH]

PRD: FR-MOD-08.8.3 (+ NFR-S1, NFR-S3)
ETİKET GEREKÇESİ: OPUS-XHIGH: kullanıcı kuralı — 'yeni bir yetkili endpoint eklemek EN AZ OPUS-XHIGH'. Yeni kimlikli endpoint + yeni kontrat yüzeyi + 'public mi kimlikli mi' kararı (auth.ts:120-128 public+scopes kombinasyonunu boot'ta yasaklıyor, yani karar geri alınması pahalı). Çekirdek güvenlik sınırı DEĞİL (tenant verisi dönmüyor, statik katalog) → MAX değil. Sonnet'e verilmez.
NEDEN AÇIK: packages/contract/openapi/paths/ altında 20 yaml var, 'mcp' içeren yok. contract-parity.test.ts dosya başlığı iki yönlü çalıştığını söylüyor: 'an undocumented route fails, and so does a documented route that nothing serves' — bu yüzden kontrat, kendisini servis eden route ile AYNI pencerede gelmek zorundadır.
KAPSAM: Contract-first: (1) packages/contract/openapi/paths/mcp.yaml — YALNIZ `manifest` operasyonu; (2) openapi.yaml'a path ref + `McpToolDescriptor` / `McpManifest` şemaları; (3) re-bundle + tip üretimi; (4) apps/api/src/routes/mcp.ts — YALNIZ `GET /mcp/manifest`: kimlikli (varsayılan agent/bot principal), scope gerektirmez, 08.8.3-a katalogunu + server URL'ini + protokol sürümünü döner. `public: true` KULLANILMAZ. Tenant verisi dönmez (statik katalog).
DOSYALAR: packages/contract/openapi/paths/mcp.yaml · packages/contract/openapi/openapi.yaml · apps/api/src/routes/mcp.ts · apps/api/src/server.ts · apps/api/test/integration/mcp.test.ts
REFERANS DESEN (kopyalanacak): packages/contract/openapi/paths/webhooks.yaml · apps/api/src/routes/webhooks.ts · apps/api/test/integration/webhooks.test.ts
KK (birebir): "search_tickets/list_chats/get_report/summarize_chat tool'ları" | "KK-türetilmiş: MCP istemcisinin bağlanabilmesi için tool listesini keşfedebileceği bir uç gerekir. Türetme gerekçesi: PRD KK yalnız tool isimlerini + 'OAuth scope bazlı' + 'tenant izole' diyor; rapor-1-fonksiyonel.md:1758-1769 ekranda 'MCP server URL + [Copy]' gösterildiğini söylüyor, dolayısıyla o URL'in arkasında bir keşif yüzeyi olmalı."
KK DOĞRULAMA: apps/api/test/integration/mcp.test.ts: manifest yanıtı KK'daki dört tool adını da içerir (KK 'search_tickets/list_chats/get_report/summarize_chat tool'ları'); token'sız çağrı 401; müşteri (widget) token'ı 404 (auth.ts principals gate); iki farklı lisansın token'ı aynı statik katalogu görür ve yanıtta license_id/organization_id sızmaz. contract-parity.test.ts yeşil (iki yönlü).
KAPSAM DIŞI: POST /mcp/tools/{tool} (08.8.3-c — bu pencerede dokümante EDİLMEZ, yoksa parity 'documented but not served' ile kırılır) · tool yürütme / scope gate (08.8.3-c) · manifest'in çağıranın scope'una göre filtrelenmesi (açık soru 6) · UI (08.8.3-g)
SÖZLEŞME: YENİ: packages/contract/openapi/paths/mcp.yaml#/manifest (GET /mcp/manifest) + openapi.yaml paths girdisi + components.schemas.McpToolDescriptor / McpManifest. OpenAPI'ye eklenip re-bundle EDİLMEZSE contract-parity.test.ts kırılır; ters yönde de kırılır (dokümante edilip servis edilmeyen path). Yeni ApiError tipi eklenmez (varsayım 4).
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 67.3. 08.8.3-c [OPUS-MAX] Tool-call yürütücüsü — scope gate + tenant kapsamı + IDOR 404 + audit + search_tickets referans tool'u (BÖLÜNMEZ ÇEKİRDEK)

**Status:** done  
**Dependencies:** 67.1, 67.2  

Contract-first sırayla: (1) KONTRAT — paths/mcp.yaml'a `POST /mcp/tools/{tool}` (tek genel uç, varsayım 1) + McpToolCallRequest/McpToolCallResult şemaları + re-bundle. (2) ÇEKİRDEK — routes/mcp.ts handler: katalogdan (08.8.3-a) tool çöz → bilinmeyen ad 404 (tool yüzeyini haritalatmamak için); principal.scopes'a karşı tool.requiredScopes ile hasAnyScope → eksikse 403 authorization; gövdeyi tool.inp

**Details:**

08.8.3-c — Tool-call yürütücüsü — scope gate + tenant kapsamı + IDOR 404 + audit + search_tickets referans tool'u (BÖLÜNMEZ ÇEKİRDEK)  [OPUS-MAX]

PRD: FR-MOD-08.8.3 (+ NFR-S1, NFR-S3, NFR-S4, NFR-S5, NFR-S8, NFR-S9)
ETİKET GEREKÇESİ: OPUS-MAX: koşul 2 ihlali ve tek başına birden fazla güvenlik sınırı — (a) authZ: tool-bazlı scope zorunluluğu (PRD:1386 'her tool çağrısı kullanıcının scope'larıyla ve organization_id ile sınırlı'), (b) tenant izolasyon (withTenant/RLS sınırı), (c) IDOR/enumeration kararı (NFR-S5: 404, 403 değil), (d) audit yüzeyi. Yanlış karar pahalı: bir LLM istemcisine yetkisiz veri dökülür. Çekirdek daha küçüğe BÖLÜNMEZ (bkz. bolunmeyen_gerekce).
NEDEN AÇIK: grep mcp = 0; hiçbir tool-call yüzeyi yok. Mevcut merkezî gate (apps/api/src/plugins/auth.ts:120-181) route config'indeki `scopes`'u hasAnyScope ile denetliyor — ama tek genel uçta gerekli scope TOOL'a göre değişir, yani route-config seviyesinde ifade edilemez; handler içinde ikinci bir gate gerekir ve bu gate depoda mevcut DEĞİL. apps/api/src/routes/tickets.ts:85-104 GET /tickets serbest metin `query` + withTenant ile scope-gated liste sunuyor (search_tickets'ın bugünkü en yakın karşılığı) ama MCP sözleşmesine sarılmamış.
KAPSAM: Contract-first sırayla: (1) KONTRAT — paths/mcp.yaml'a `POST /mcp/tools/{tool}` (tek genel uç, varsayım 1) + McpToolCallRequest/McpToolCallResult şemaları + re-bundle. (2) ÇEKİRDEK — routes/mcp.ts handler: katalogdan (08.8.3-a) tool çöz → bilinmeyen ad 404 (tool yüzeyini haritalatmamak için); principal.scopes'a karşı tool.requiredScopes ile hasAnyScope → eksikse 403 authorization; gövdeyi tool.inputSchema ile doğrula → 400 validation; yürütmenin TAMAMI request.withTenant içinde; yanıtta license_id/organization_id ASLA yer almaz. (3) IDOR — argüman olarak gelen id başka lisansa aitse 404 (403 değil, NFR-S5). (4) AUDIT — 'mcp.tool_called' AUDIT_ACTIONS union'ına eklenir (audit-log.ts:62 'pat.created' komşuluğu), metadata = {tool, scope_used}; argüman metni/PII audit'e YAZILMAZ. (5) REFERANS TOOL — search_tickets → TicketService.list (mevcut serbest metin `query` yolu). Negatif ve cross-tenant testler pozitiflerden ÖNCE yazılır ve kırmızı görülür.
DOSYALAR: packages/contract/openapi/paths/mcp.yaml · packages/contract/openapi/openapi.yaml · apps/api/src/routes/mcp.ts · apps/api/src/services/mcp/tool-dispatch.ts · apps/api/src/services/mcp/tools/search-tickets.ts · apps/api/src/services/audit/audit-log.ts · apps/api/test/integration/mcp-tools.test.ts · apps/api/test/integration/tenant-isolation.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/plugins/auth.ts · apps/api/src/routes/tickets.ts · apps/api/src/routes/auth.ts · apps/api/test/integration/tenant-isolation.test.ts
KK (birebir): "OAuth scope bazlı" | "tenant izole" | "search_tickets/list_chats/get_report/summarize_chat tool'ları"
KK DOĞRULAMA: KK 'OAuth scope bazlı' → mcp-tools.test.ts: tickets--*:ro taşımayan PAT ile search_tickets → 403; scope'lu PAT ile 200. KK 'tenant izole' → tenant-isolation.test.ts: A lisansının token'ı B lisansının ticket'ını ne listeler ne id ile getirir (404); yanıt gövdesinde license_id/organization_id yok. KK 'search_tickets ... tool'ları' → katalogdaki search_tickets adıyla çağrı 200 ve TicketService sonucunu döner. contract-parity yeşil.
KAPSAM DIŞI: list_chats (08.8.3-d), get_report (08.8.3-e), summarize_chat (08.8.3-f) · PII/CC-mask okuma yolu doğrulaması (08.8.3-f) · MCP'ye özel yeni scope (varsayım 3) ve yeni ApiError tipi (varsayım 4) · dynamic client registration / headless izin akışı (varsayım 2) · ayrı rate-limit kovası (08.8.3-h) · UI (08.8.3-g)
SÖZLEŞME: YENİ: paths/mcp.yaml#/toolCall → POST /mcp/tools/{tool} + McpToolCallRequest/McpToolCallResult şemaları; openapi.yaml paths girdisi + re-bundle ZORUNLU (contract-parity.test.ts iki yönlü kırılır). Yeni hata tipi eklenmez — mevcut validation/authorization/not_found kullanılır; aksi halde errors.ts (×2 yer) + scopes.test.ts sayacı + openapi enum + regen zinciri gerekirdi (varsayım 4).
MIGRATION: yok — audit action genişletmesi kod seviyesinde union'a değer eklemektir, audit_log_entries şeması değişmez. api_tokens.kind'a 'mcp' EKLENMEZ (varsayım 5).
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 67.4. 08.8.3-d [SONNET-XHIGH] list_chats tool adaptörü (mevcut chat listeleme yoluna bağlama)

**Status:** done  
**Dependencies:** 67.3  

08.8.3-c'nin dispatch tablosuna `list_chats` dalı: katalogdaki inputSchema'dan gelen argümanlar (durum/limit/page_id) → ChatService.list (apps/api/src/services/chat/chat-service.ts:129); sonuç zarfı search_tickets adaptörüyle birebir aynı şekilde kurulur. Gate/tenant sarmalayıcısı ÇEKİRDEKTEN aynen tüketilir — bu pencerede hasAnyScope/withTenant çağrısı YAZILMAZ.

**Details:**

08.8.3-d — list_chats tool adaptörü (mevcut chat listeleme yoluna bağlama)  [SONNET-XHIGH]

PRD: FR-MOD-08.8.3
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. Güvenlik sınırı YOK çünkü scope gate + tenant kapsamı + IDOR kararı 08.8.3-c'de merkezî kuruldu ve testle kanıtlandı; bu alt-görev yeni authz kodu YAZMAZ, dispatch tablosuna bir dal + mevcut ChatService.list çağrısı ekler. Kopyalanacak desen ismen mevcut (08.8.3-c'de teslim edilen search-tickets.ts + routes/chats.ts). Kontrat değişikliği yok; kabul kriteri mekanik.
NEDEN AÇIK: apps/api/src/routes/chats.ts:126 scope-gated (['chats--all:ro','chats--access:ro']) chat listesi sunuyor ama MCP tool sözleşmesine sarılmamış; grep mcp = 0, list_chats isminde hiçbir yüzey yok.
KAPSAM: 08.8.3-c'nin dispatch tablosuna `list_chats` dalı: katalogdaki inputSchema'dan gelen argümanlar (durum/limit/page_id) → ChatService.list (apps/api/src/services/chat/chat-service.ts:129); sonuç zarfı search_tickets adaptörüyle birebir aynı şekilde kurulur. Gate/tenant sarmalayıcısı ÇEKİRDEKTEN aynen tüketilir — bu pencerede hasAnyScope/withTenant çağrısı YAZILMAZ.
DOSYALAR: apps/api/src/services/mcp/tools/list-chats.ts · apps/api/src/services/mcp/tool-dispatch.ts · apps/api/test/integration/mcp-tools.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/services/mcp/tools/search-tickets.ts · apps/api/src/routes/chats.ts · apps/api/src/services/chat/chat-service.ts
KK (birebir): "search_tickets/list_chats/get_report/summarize_chat tool'ları"
KK DOĞRULAMA: mcp-tools.test.ts: list_chats çağrısı çağıranın lisansındaki chat'leri döner (KK 'list_chats ... tool'ları'); chats--*:ro taşımayan token → 403 (çekirdek gate'i üzerinden, KK 'OAuth scope bazlı' payı); başka lisansın chat'i sonuçta yok (KK 'tenant izole' payı).
KAPSAM DIŞI: chat mesaj gövdesi/transcript dönmek (08.8.3-f summarize_chat) · yazma aksiyonları (kapat/ata/etiketle) — MCP yüzeyi salt-okunur · yeni kontrat path'i (tek genel uç kullanılır)
SÖZLEŞME: yok — POST /mcp/tools/{tool} genel ucu 08.8.3-c'de dokümante edildi; yeni path açılmaz, re-bundle gerekmez.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 67.5. 08.8.3-e [SONNET-XHIGH] get_report tool adaptörü — `report` enum'u ile mevcut 4 rapor sorgusuna eşleme

**Status:** done  
**Dependencies:** 67.3  

`get_report` tek tool, zorunlu `report` argümanı enum: overview | breakdown | ai-agent | reviews (varsayım 6) + isteğe bağlı from/to aralığı. Her enum değeri reports.ts'teki İLGİLİ SORGUYU yeniden kullanır — sorgu kodu KOPYALANMAZ; gerekirse route handler gövdesindeki rapor derleme bloğu dışa aktarılabilir saf fonksiyona çıkarılır ve route onu çağırmaya devam eder (davranış değişmez; mevcut report

**Details:**

08.8.3-e — get_report tool adaptörü — `report` enum'u ile mevcut 4 rapor sorgusuna eşleme  [SONNET-XHIGH]

PRD: FR-MOD-08.8.3 (+ ADR-09: rapor sayıları = fatura sayacı)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. Güvenlik sınırı yok (gate/tenant çekirdekte, tek scope 'reports_read' katalogdan gelir); eşzamanlılık yok; PRD'deki tek belirsizlik (hangi rapor ucu) BU PLANDA karara bağlandı (varsayım 6) — pencereye yorum bırakılmıyor; kopyalanacak desen ismen mevcut (search-tickets.ts adaptörü + reports.ts sorgu blokları); kabul kriteri mekanik. 4 hazır sorgu → geniş yüzey değil, MAX gerekmiyor.
NEDEN AÇIK: apps/api/src/routes/reports.ts'te dört `reports_read` korumalı uç var (510 /reports/overview, 664 /reports/breakdown, 725 /reports/ai-agent, 763 /reports/reviews) ama tek bir 'get_report' tool'una eşlenmiş değil; grep mcp = 0. Olgular kaydı: 'get_report tool'unun hangi endpoint'e eşleneceği net değil'.
KAPSAM: `get_report` tek tool, zorunlu `report` argümanı enum: overview | breakdown | ai-agent | reviews (varsayım 6) + isteğe bağlı from/to aralığı. Her enum değeri reports.ts'teki İLGİLİ SORGUYU yeniden kullanır — sorgu kodu KOPYALANMAZ; gerekirse route handler gövdesindeki rapor derleme bloğu dışa aktarılabilir saf fonksiyona çıkarılır ve route onu çağırmaya devam eder (davranış değişmez; mevcut reports testleri regresyon kapısıdır). Scope 'reports_read' katalogdan gelir; gate çekirdekten tüketilir.
DOSYALAR: apps/api/src/services/mcp/tools/get-report.ts · apps/api/src/services/mcp/tool-dispatch.ts · apps/api/src/routes/reports.ts · apps/api/test/integration/mcp-tools.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/services/mcp/tools/search-tickets.ts · apps/api/src/routes/reports.ts · apps/api/test/integration/reports-billing.test.ts
KK (birebir): "search_tickets/list_chats/get_report/summarize_chat tool'ları"
KK DOĞRULAMA: mcp-tools.test.ts: dört enum değeri de dolu rapor döner (KK 'get_report ... tool'ları'); 'reports_read' taşımayan token → 403 (KK 'OAuth scope bazlı' payı); iki lisanslı fixture'da sayılar karışmaz (KK 'tenant izole' payı). Regresyon: mevcut reports-billing.test.ts + reports-metrics.test.ts değişmeden yeşil (sorgu çıkarımı davranışı bozmadı).
KAPSAM DIŞI: /reports/export (CSV) — ayrı EXPORT_SCOPES taşıyor, MCP yüzeyine alınmıyor (açık soru 3) · yeni rapor sorgusu/metrik tasarımı · PDF/benchmark karşılaştırma
SÖZLEŞME: yok — tek genel uç 08.8.3-c'de dokümante edildi. UYARI: bu alt-görev yeni REST route AÇMAZ; açarsa OpenAPI'ye eklenip re-bundle zorunlu olur (contract-parity.test.ts kırılır).
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 67.6. 08.8.3-f [OPUS-XHIGH] summarize_chat tool'u + tool yanıtlarında PII/CC-mask sınırının doğrulanması

**Status:** done  
**Dependencies:** 67.3  

`summarize_chat` dalı: copilot-service.ts:182 conversationTurns() ile turn'leri oku → packages/ai-mock/src/assist.ts summariseConversation() ile özetle → yanıtı apps/api/src/lib/cc-mask.ts'ten geçirerek dön. İNTERNAL NOTE YAZILMAZ (salt-okunur tool, varsayım 7) — copilot akışının mevcut yazma davranışı değişmez. Erişilemeyen/başka lisansın chatId'si → 404 (403 değil). Yanıtta ham kart numarası bul

**Details:**

08.8.3-f — summarize_chat tool'u + tool yanıtlarında PII/CC-mask sınırının doğrulanması  [OPUS-XHIGH]

PRD: FR-MOD-08.8.3 (+ NFR-S5, NFR-S9)
ETİKET GEREKÇESİ: OPUS-XHIGH: PII maskeleme sınırına dokunuyor (koşul 2 hassasiyeti) — bir LLM istemcisine transcript özeti dökülüyor, ham PII sızarsa geri alınamaz. Ancak maskeleme ALGORİTMASI yeni değil: apps/api/src/lib/cc-mask.ts mevcut ve testli (08.9.5, tm 70), summariseConversation() deterministik ve testli; tenant gate çekirdekte kanıtlandı → OPUS-MAX değil. Güvenlik hassasiyeti nedeniyle Sonnet'e ASLA verilmez.
NEDEN AÇIK: apps/api/src/routes/copilot.ts:130-152 summariseConversation()'ı YALNIZ internal-note yazan akışta kullanıyor (özet chats.sendEvent ile recipients:'agents' notu olarak yazılıyor); MCP yanıtı için ayrı bir JSON sözleşmesi yok. Olgular kaydı: 'CC-mask/spam-filter sonrası mı ham mı transcript döneceği tanımsız (PII riski)'. grep mcp = 0.
KAPSAM: `summarize_chat` dalı: copilot-service.ts:182 conversationTurns() ile turn'leri oku → packages/ai-mock/src/assist.ts summariseConversation() ile özetle → yanıtı apps/api/src/lib/cc-mask.ts'ten geçirerek dön. İNTERNAL NOTE YAZILMAZ (salt-okunur tool, varsayım 7) — copilot akışının mevcut yazma davranışı değişmez. Erişilemeyen/başka lisansın chatId'si → 404 (403 değil). Yanıtta ham kart numarası bulunmadığı testle kanıtlanır.
DOSYALAR: apps/api/src/services/mcp/tools/summarize-chat.ts · apps/api/src/services/mcp/tool-dispatch.ts · apps/api/test/integration/mcp-tools.test.ts · apps/api/test/integration/cc-masking.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/copilot.ts · apps/api/src/services/ai/copilot-service.ts · packages/ai-mock/src/assist.ts · apps/api/src/lib/cc-mask.ts · apps/api/test/integration/cc-masking.test.ts
KK (birebir): "search_tickets/list_chats/get_report/summarize_chat tool'ları" | "tenant izole"
KK DOĞRULAMA: mcp-tools.test.ts: summarize_chat kendi lisansındaki chat için özet döner (KK 'summarize_chat ... tool'ları'); başka lisansın chatId'si → 404 (KK 'tenant izole'); chats scope'suz token → 403 (KK 'OAuth scope bazlı' payı). cc-masking.test.ts'e ek: transcript'te geçerli Luhn kart numarası varken tool yanıtında maskeli görünür.
KAPSAM DIŞI: mevcut POST /copilot/chats/:chatId/summary davranışını değiştirmek · Assisted/AI-resolution sayaçlarını beslemek (açık soru 4) · spam-filter'ın okuma yolunda tekrar çalıştırılması (yazma anında uygulanıyor) · gerçek LLM çağrısı (dış servisler mock)
SÖZLEŞME: yok — tek genel uç 08.8.3-c'de dokümante edildi; yanıt McpToolCallResult içinde kalır.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 67.7. 08.8.3-g [SONNET-XHIGH] Settings → MCP bağlantı ekranı (mcp URL + Copy + Claude setup + örnek prompt)

**Status:** done  
**Dependencies:** 67.2  

Yeni `McpConnection` bölümü, SettingsPage'in Integrations bölümünün altına: (1) MCP server URL'i salt-okunur alanda + [Copy] düğmesi (pano yazımı); (2) katlanır 'Claude setup' bölümü (Panel/PanelSection deseni) — adım adım bağlama talimatı; (3) örnek prompt bloğu (rapor-1: 'Find all tickets where customers ask about bulk orders'); (4) manifest'ten (08.8.3-b) çekilen tool listesi salt-okunur + veri

**Details:**

08.8.3-g — Settings → MCP bağlantı ekranı (mcp URL + Copy + Claude setup + örnek prompt)  [SONNET-XHIGH]

PRD: FR-MOD-08.8.3
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. Salt-okunur UI; token/secret üretmez veya göstermez; yazma yok; güvenlik kararı yok; eşzamanlılık yok. Kopyalanacak desenler ismen mevcut: WidgetCustomization.tsx (settings alt-bileşen deseni), SettingsPage.tsx Section/Card deseni, components/ui/Panel.tsx (katlanır bölüm). Kabul kriteri mekanik (metin/düğme görünürlüğü).
NEDEN AÇIK: apps/web/src/features/settings/SettingsPage.tsx:144-165 `Integrations` bileşeni YALNIZ '/app/apps' pazaryerine link veriyor — mcp URL/Copy/Claude-setup/örnek-prompt yok. apps/web/src/App.tsx:91 tek `settings` rotası tanımlı, `/app/settings/integrations/mcp` alt rotası YOK. grep mcp (apps/web dahil) = 0.
KAPSAM: Yeni `McpConnection` bölümü, SettingsPage'in Integrations bölümünün altına: (1) MCP server URL'i salt-okunur alanda + [Copy] düğmesi (pano yazımı); (2) katlanır 'Claude setup' bölümü (Panel/PanelSection deseni) — adım adım bağlama talimatı; (3) örnek prompt bloğu (rapor-1: 'Find all tickets where customers ask about bulk orders'); (4) manifest'ten (08.8.3-b) çekilen tool listesi salt-okunur + veri yokken anlamlı empty state. Mevcut tek-sayfa Settings mimarisi korunur (varsayım 8 — PRD'nin işaret ettiği alt rota yerine bölüm; sapma §C'ye yazılır).
DOSYALAR: apps/web/src/features/settings/McpConnection.tsx · apps/web/src/features/settings/McpConnection.test.tsx · apps/web/src/features/settings/SettingsPage.tsx · apps/e2e/tests/settings.spec.ts
REFERANS DESEN (kopyalanacak): apps/web/src/features/settings/WidgetCustomization.tsx · apps/web/src/features/settings/SettingsPage.tsx · apps/web/src/components/ui/Panel.tsx · apps/web/src/features/settings/Integrations.test.tsx
KK (birebir): "**MCP server** (mcp URL + Copy + Claude setup + örnek prompt)"
KK DOĞRULAMA: McpConnection.test.tsx: URL görünür ve [Copy] panoya yazar (KK 'mcp URL + Copy'); 'Claude setup' bölümü katlanır/açılır (KK 'Claude setup'); örnek prompt metni render edilir (KK 'örnek prompt'). e2e settings.spec.ts: Settings ekranında MCP bölümü görünür.
KAPSAM DIŞI: MCP için PAT üretme/gösterme akışı (mevcut PAT yüzeyi kullanılır) · yeni /app/settings/... alt rotası eklemek · tool çalıştıran bir UI konsolu · gerçek mcp.text.com DNS/TLS (kapsam dışı)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 67.8. 08.8.3-h [OPUS-XHIGH] Uçtan uca MCP istemci akışı + rate-limit kapsaması + audit doğrulaması

**Status:** done  
**Dependencies:** 67.3, 67.4, 67.5, 67.6  

(1) Uçtan uca akış doğrulaması: PAT ile kimlik → GET /mcp/manifest → dört tool'un sırayla çağrılması → beklenen sonuç zarfları. (2) MCP uçlarının mevcut rate-limit zincirine girdiğinin kanıtlanması; girmiyorsa bağlanması + LLM patern'i için kova parametresi kararı (açık soru 5) ve 429'un ADR-06 zarfıyla dönmesi. (3) Her tool çağrısında 'mcp.tool_called' audit kaydının düştüğünün ve argüman/PII içe

**Details:**

08.8.3-h — Uçtan uca MCP istemci akışı + rate-limit kapsaması + audit doğrulaması  [OPUS-XHIGH]

PRD: FR-MOD-08.8.3 (+ NFR-P2, NFR-S8, NFR-M5)
ETİKET GEREKÇESİ: OPUS-XHIGH: çok yüzeyli uçtan uca doğrulama (kontrat + 4 tool + audit + rate-limit) ve rate-limit politikası kararı (LLM istemcisinin ardışık çağrı paterni) güvenlik hassasiyeti taşıyor; çekirdek gate 08.8.3-c'de kanıtlandığı için MAX değil. Belirsizlik içerdiğinden ve tek referans dosyaya indirgenemediğinden SONNET olamaz.
NEDEN AÇIK: Olgular kaydı: 'bir LLM istemcisinin ardışık/otomatik tool çağırma paterni ayrıca değerlendirilmemiş'. apps/api/src/plugins/rate-limit.ts:130-180 Redis token-bucket zinciri mevcut ve auth'a bağımlı, ama MCP uçlarının bu zincire girdiği koda karşı doğrulanmadı (uçlar henüz yok; grep mcp = 0).
KAPSAM: (1) Uçtan uca akış doğrulaması: PAT ile kimlik → GET /mcp/manifest → dört tool'un sırayla çağrılması → beklenen sonuç zarfları. (2) MCP uçlarının mevcut rate-limit zincirine girdiğinin kanıtlanması; girmiyorsa bağlanması + LLM patern'i için kova parametresi kararı (açık soru 5) ve 429'un ADR-06 zarfıyla dönmesi. (3) Her tool çağrısında 'mcp.tool_called' audit kaydının düştüğünün ve argüman/PII içermediğinin doğrulanması. (4) Kanıtın HANDOFF'a yazılması.
DOSYALAR: apps/api/test/integration/mcp-e2e.test.ts · apps/api/src/plugins/rate-limit.ts · apps/api/src/routes/mcp.ts · apps/api/test/integration/audit-log.test.ts · HANDOFF.md
REFERANS DESEN (kopyalanacak): apps/api/src/plugins/rate-limit.ts · apps/api/test/integration/audit-log.test.ts · apps/api/test/integration/webhooks.test.ts
KK (birebir): "search_tickets/list_chats/get_report/summarize_chat tool'ları" | "OAuth scope bazlı" | "tenant izole"
KK DOĞRULAMA: mcp-e2e.test.ts tek akışta dört tool'u da çağırır (KK dört tool adı); PAT'in scope'ları dışına çıkan çağrı 403 (KK 'OAuth scope bazlı'); akış iki lisanslı fixture'da koşturulur ve hiçbir yanıt karşı lisansın satırını içermez (KK 'tenant izole'). audit-log.test.ts: her başarılı tool çağrısı bir 'mcp.tool_called' kaydı üretir; metadata'da argüman metni yok.
KAPSAM DIŞI: MCP JSON-RPC/SSE protokol köprüsü (varsayım 10, açık soru 1) · dynamic client registration (varsayım 2) · 10.1.5 API-calls faturalama sayacının MCP çağrılarını da sayması (açık soru 5) · UI (08.8.3-g)
SÖZLEŞME: yok — yeni path açılmaz; 429 yanıtı mevcut TooManyRequests response bileşeninden gelir. Eğer MCP path'lerine 429 response'u eklenirse mcp.yaml güncellenip re-bundle edilmelidir (contract-parity).
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
