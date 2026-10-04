# Task ID: 76

**Title:** §5.3-KB — Public KB (SEO'lu self-servis bilgi tabanı)  ·  dilim V2-6

**Status:** done

**Dependencies:** 78 ✓

**Priority:** medium

**Description:** PRD §5.3 (v2) · KK-türetilmiş (kaynak: §5.3 'Public KB').

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `PUBKB`.

9 atomik alt-görev · ~12 pencere · etiket dağılımı: OPUS-MAX x2 · OPUS-XHIGH x3 · SONNET-XHIGH x4

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  PUBKB-a [SONNET-XHIGH] Public KB veri modeli: kb_articles + kb_categories + kb_settings (RLS'li migration)  (bağ: yok)
  PUBKB-b [OPUS-XHIGH] Yönetim (agent-auth) KB CRUD kontratı + backend + yayın (draft/published) durumu  (bağ: PUBKB-a)
  PUBKB-c [OPUS-MAX] Anonim public okuma çekirdeği (BÖLÜNMEZ): slug→license çözümleyici + yayın filtresi + 404 politikası + anon rate-limit  (bağ: PUBKB-a, PUBKB-b)
  PUBKB-d [OPUS-MAX] Makale gövdesi güvenli render çekirdeği (BÖLÜNMEZ): escape-first sınırlı markdown  (bağ: yok)
  PUBKB-e [OPUS-XHIGH] SEO'lu sunucu-render HTML yüzeyi: KB ana sayfası + makale sayfası (title/meta/canonical/OG/JSON-LD)  (bağ: PUBKB-c, PUBKB-d)
  PUBKB-f [SONNET-XHIGH] sitemap.xml + robots.txt (yalnız yayınlanmış makaleler, XML-escape'li)  (bağ: PUBKB-c, PUBKB-e)
  PUBKB-g [SONNET-XHIGH] Admin: KB makale listesi + durum sekmeleri (All/Published/Drafts) + anlamlı empty state  (bağ: PUBKB-b)
  PUBKB-h [SONNET-XHIGH] Admin: makale editörü (içerik + SEO alanları) + publish/unpublish + public link  (bağ: PUBKB-b, PUBKB-g)
  PUBKB-i [OPUS-XHIGH] Uçtan uca doğrulama: anonim okuyucu e2e + izolasyon/SEO kanıt seti  (bağ: PUBKB-c, PUBKB-e, PUBKB-f, PUBKB-h)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): İki bölünmez çekirdek var. (1) PUBKB-c — anonim (principal'sız) trafiğe org-scoped İÇERİK servis etme kararı bu depoda bir ilk: slug→license çözümleyici (pre-tenant SECURITY DEFINER deliği), yayın filtresi (published+is_public), 404-yerine-403 politikası (NFR-S5) ve enumeration yüzeyi TEK bir akıl yürütmenin parçaları; resolver'ı filtreden veya 404 politikasından ayırmak, "hangi satır kime görünür" invariantını iki ayrı pencereye bölerek kaybettirir. (2) PUBKB-d — escape-first render: kaçış sırası ile beyaz-liste sırası aynı fonksiyonda karar verilir; "önce escape sonra whitelist" invariantı bölününce stored-XSS açığı tam olarak bu dikişten girer. Her iki çekirdeğin ETRAFINDAKİ her şey (şema/migration, admin CRUD, HTML şablonu, sitemap, admin UI, e2e) ayrı ve daha ucuz etiketli alt-görevlere çıkarıldı.

VARSAYIMLAR: §C-PUBKB-1 (ŞEMA İZOLASYONU): Public KB, `knowledge_sources` tablosunu GENİŞLETMEZ; ayrı `kb_articles`/`kb_categories`/`kb_settings` tabloları kullanır. Gerekçe: `knowledge_sources` tamamen AI Agent RAG amaçlı doluyor (`playbook.ts` `type:'website'` crawl çıktısı, dosya/FAQ içerikleri, `copilot.ts` ajana-özel KB) — aynı tabloya bir `public` bayrağı eklemek, ajanın iç/taslak içeriğini tek yanlış UPDATE ile anonim kitleye açılabilir hale getirir ve `knowledge-service.ts`/`skill-engine.ts` tüketicilerini kırma riski taşır. · §C-PUBKB-2 (RENDER MİMARİSİ): Public KB sayfaları apps/web SPA'sına EKLENMEZ; API tarafından sunucuda üretilen HTML olarak servis edilir. Gerekçe: PRD kendi A2 varsayımında (satır 1045) 'Ürün SPA (SEO gerekmez, oturum-arkası); pazarlama sayfaları ve Chat page için SSR/SSG uygun' diyor — public KB bu istisna sınıfına konur. Depodaki tek anonim tam-sayfa (`apps/widget/chat.html`) açıkça `noindex, nofollow` taşıyor, yani SPA/widget hattı SEO üretemez. Yeni SSR framework'ü (Next/Remix) EKLENMEZ — ADR-01/02 stack'i dışına çıkılmaz; Fastify `text/html` yanıtı yeterli. · §C-PUBKB-3 (İÇERİK BİÇİMİ): Makale gövdesi ham HTML olarak saklanmaz ve saklanmayacak; sınırlı markdown alt kümesi + escape-first render kullanılır (`lib/kb-render.ts`). Yeni sanitizasyon bağımlılığı (sanitize-html/DOMPurify) EKLENMEZ. Gerekçe: repoda hiçbir sanitizasyon kütüphanesi yok; bağımlılık eklemek yeni tedarik-zinciri ve güvenlik incelemesi yüzeyi açar, oysa beyaz-listeli üretim (parse değil, generate) daha küçük ve tam denetlenebilir bir yüzeydir. · §C-PUBKB-4 (ADRES): Workspace'in public adresi `kb_settings.public_slug` (license-singleton, global unique) ile taşınır. Gerekçe: `Organization` (schema.prisma:29-40) ve `License` (47+) modellerinde slug/subdomain alanı YOK; UUID'li adres SEO'ya uygun değil. · §C-PUBKB-5 (ERİŞİM ÇÖZÜMLEME): slug→license çözümü, mevcut `auth_resolve_organization_license` (migration 20260724110000, SECURITY DEFINER, REVOKE FROM PUBLIC + GRANT TO siyahtus_a

AÇIK SORULAR (ürün kararı): Public KB hangi origin'den servis edilecek? API origin mi, `WIDGET_BASE_URL` mi, yoksa ayrı bir `kb.` alt alanı mı? DNS/TLS kapsam dışı olduğu için kırılımda API origin varsayıldı; canonical URL üretimi bu karara bağlı ve tek bir env değişkeni (`PUBLIC_KB_BASE_URL`) ile soyutlanacak. · Makale gövdesi için zengin metin (WYSIWYG) editörü isteniyor mu? Varsayım: HAYIR — düz metin + sınırlı markdown (§C-PUBKB-3). Zengin editör istenirse PUBKB-d ve PUBKB-h yeniden boyutlandırılmalı ve bir sanitizasyon kütüphanesi kararı gerekir. · Public KB'de site-içi arama (full-text) MVP'ye dahil mi? Şu an kapsam dışı bırakıldı (liste + kategori + makale gezinmesi). Dahilse ayrı bir alt-görev (Postgres full-text, tenant-scoped, anonim yüzey → yeni negatif test seti) eklenmeli. · AI Agent, public KB makalelerini de RAG kaynağı olarak kullanmalı mı (çift yönlü bağ: bir makale hem public hem RAG)? Varsayım: HAYIR — iki tablo, iki amaç, tek yönlü sınır. Çift yönlü istenirse `kb_articles` → `knowledge_chunks` indeksleme köprüsü ayrı bir alt-görev olur. · Bir workspace'in birden çok public KB'si (marka/dil başına) olacak mı? Varsayım: license başına TEK KB (`kb_settings` license-singleton). Çoklu KB istenirse `kb_settings` çoklu satıra dönüşür ve PUBKB-c'nin resolver'ı yeniden tasarlanır (çekirdek yeniden açılır — pahalı). · Yayınlanmış bir makalenin slug'ı değiştirilirse eski adres ne yapmalı (301 yönlendirme kaydı mı, 404 mü)? Kırılımda 404 varsayıldı; SEO açısından yönlendirme tablosu istenirse `k

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 76.1. PUBKB-a [SONNET-XHIGH] Public KB veri modeli: kb_articles + kb_categories + kb_settings (RLS'li migration)

**Status:** done  
**Dependencies:** None  

Contract-first sıranın 'migration' adımı (kontrat bu alt-görevde YOK — çünkü OpenAPI'ye path eklenip route serve edilmezse contract-parity.test.ts'in 'serves every route the contract documents' yönü kırılır). Üç yeni tablo: (1) `kb_categories` — id, license_id, slug, name, position; (2) `kb_articles` — id, license_id, category_id?, slug, title, body (düz metin/sınırlı markdown), excerpt?, seo_titl

**Details:**

PUBKB-a — Public KB veri modeli: kb_articles + kb_categories + kb_settings (RLS'li migration)  [SONNET-XHIGH]

PRD: §5.3-Knowledge (public KB) — PRD §6 FR-MOD tablosunda karşılığı YOK, en yakın komşu FR-MOD-06.3 (Knowledge/RAG); NFR-S4, NFR-S5, NFR-C1
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. Yalnız schema.prisma + tek migration.sql (2 dosya + integration testi). Güvenlik sınırı YOK — tablolar mevcut `license_id = siyahtus_current_license()` RLS kalıbının birebir kopyası, yeni erişim kararı içermiyor (erişim kararı PUBKB-c'de). Eşzamanlılık yok, yeni algoritma yok; kopyalanacak migration dosyaları ismen verilebiliyor. Kontrat değişikliği yok. KK mekanik doğrulanabilir (RLS cross-tenant testi).
NEDEN AÇIK: schema.prisma:939-957 `KnowledgeSource` modeli yalnız `type/name/sourceUrl/content/status/addedBy/aiAgentId` taşıyor — `slug`, `seo_title`, `seo_description`, `category`, `published`/`is_public` alanlarının HİÇBİRİ yok. `apps/api/src/routes/` altında 27 dosya var, hiçbiri kb/public adında değil. Yani public KB için tek bir satır veri modeli mevcut değil.
KAPSAM: Contract-first sıranın 'migration' adımı (kontrat bu alt-görevde YOK — çünkü OpenAPI'ye path eklenip route serve edilmezse contract-parity.test.ts'in 'serves every route the contract documents' yönü kırılır). Üç yeni tablo: (1) `kb_categories` — id, license_id, slug, name, position; (2) `kb_articles` — id, license_id, category_id?, slug, title, body (düz metin/sınırlı markdown), excerpt?, seo_title?, seo_description?, status ('draft'|'published'), published_at?, created_by?, created_at, updated_at; (3) `kb_settings` — license-singleton: license_id (PK), enabled (default false), public_slug (GLOBAL unique), site_title?, updated_at. Her üç tabloya `ENABLE ROW LEVEL SECURITY` + `<tablo>_tenant` policy (`USING/WITH CHECK license_id = siyahtus_current_license()`). Unique: (license_id, slug) kb_articles'ta ve kb_categories'te; kb_settings.public_slug global unique. Index: (license_id, status, published_at DESC). `knowledge_sources` tablosuna DOKUNULMAZ.
DOSYALAR: apps/api/prisma/schema.prisma · apps/api/prisma/migrations/<yeni_timestamp>_public_kb/migration.sql · apps/api/test/integration/public-kb-schema.test.ts
REFERANS DESEN (kopyalanacak): apps/api/prisma/migrations/20260726190000_ticket_email_templates/migration.sql · apps/api/prisma/migrations/20260726130000_inbox_settings/migration.sql · apps/api/prisma/migrations/20260726120000_omnichannel_adapters/migration.sql · apps/api/prisma/schema.prisma
KK (birebir): "KK-türetilmiş: "SEO'lu self-servis bilgi bankası (public KB)" — PRD §6 FR-MOD tablosunda bu kaleme ait KK satırı YOK (kalem yalnız §5.3 faz tablosunda tek cümle olarak geçiyor), bu yüzden KK §5.3'ten türetildi. Bu alt-görevin payı: 'SEO'lu' → makale başına ayrı, kalıcı, insan-okur bir adres (slug) ve arama motoruna verilecek meta alanları (seo_title/seo_description) VERİ MODELİNDE bulunmalı; 'self-servis' → içerik ajan panelinden değil, okuyucu tarafından gezilebilir bir taksonomiye (kategori) bağlı olmalı; 'public' → yayın durumu (draft/published) ve workspace bazlı açma anahtarı ayrı alanlar olmalı."
KK DOĞRULAMA: `public-kb-schema.test.ts` integration: (1) aynı license'ta aynı slug ile ikinci makale → unique ihlali (KK 'slug' payı); (2) seo_title/seo_description/status/published_at kolonları yazılıp okunabiliyor (KK 'SEO'lu' payı); (3) kategori bağı ile makale okunabiliyor (KK 'self-servis gezinme' payı); (4) `prisma migrate diff` temiz (şema ile migration drift yok).
KAPSAM DIŞI: OpenAPI path'i eklemek (PUBKB-b/-c/-e ile birlikte gelir — parity testinin ters yönü kırılır) · `knowledge_sources`/`knowledge_chunks` tablolarına herhangi bir kolon eklemek (§C varsayım 1: ayrı tablo) · Public erişim çözümleyici SQL fonksiyonu (PUBKB-c'nin kendi migration'ı) · Makale gövdesi için embedding/RAG indeksleme (AI Agent KB'si ayrı kalır)
MIGRATION: EVET — yeni migration `<timestamp>_public_kb`: `kb_categories`, `kb_articles`, `kb_settings` tabloları + üçünde ENABLE ROW LEVEL SECURITY + `_tenant` policy + unique/index'ler. `knowledge_sources` DEĞİŞMEZ.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 76.2. PUBKB-b [OPUS-XHIGH] Yönetim (agent-auth) KB CRUD kontratı + backend + yayın (draft/published) durumu

**Status:** done  
**Dependencies:** 76.1  

Contract-first: (1) `packages/contract/openapi/paths/kb.yaml` — `POST/GET /kb-articles`, `GET/PATCH/DELETE /kb-articles/{articleId}`, `POST/GET /kb-categories`, `PATCH/DELETE /kb-categories/{categoryId}`, `GET/PUT /kb-settings`; şemalar `KbArticle`, `KbCategory`, `KbSettings`; bundle + `@siyahtus/types` regen. (2) `apps/api/src/routes/kb.ts` — `playbook.ts` CRUD şablonunun birebir kopyası: `request.wi

**Details:**

PUBKB-b — Yönetim (agent-auth) KB CRUD kontratı + backend + yayın (draft/published) durumu  [OPUS-XHIGH]

PRD: §5.3-Knowledge (public KB); NFR-S4 (yetki), NFR-S5 (404 politikası), NFR-C2 (audit)
ETİKET GEREKÇESİ: OPUS-XHIGH: kullanıcı kuralı — 'yeni bir yetkili endpoint eklemek, mevcut scope'u genişletmek EN AZ OPUS-XHIGH'. Burada yeni bir yetkili endpoint KÜMESİ (kb-articles/kb-categories/kb-settings) açılıyor ve 'bir makale artık anonim kitleye görünür' bayrağı (status=published + kb_settings.enabled) İLK KEZ tanımlanıyor — güvenlik hassasiyeti var ama çekirdek erişim kararı (anonim okuma) PUBKB-c'de. Ayrıca kontrat+backend+scope kararının çok yüzeyli bağlanması ve KK'nın PRD'de olmayışı (yorum gerektiren belirsizlik) SONNET koşul 2 ve 6'yı ihlal ediyor.
NEDEN AÇIK: `apps/api/src/routes/playbook.ts:352-450` yalnız `/knowledge-sources` CRUD'unu sunuyor (agent-auth, scope `agents-bot--all:ro/:rw`) ve o kayıtlar tamamen AI Agent RAG amaçlı — makale/kategori/yayın kavramı yok. `packages/contract/openapi/paths/` altında 23 yaml var, hiçbiri kb* veya public* önekli değil (ls çıktısı). Yani yayınlanabilir makale yönetimi için ne kontrat ne route var.
KAPSAM: Contract-first: (1) `packages/contract/openapi/paths/kb.yaml` — `POST/GET /kb-articles`, `GET/PATCH/DELETE /kb-articles/{articleId}`, `POST/GET /kb-categories`, `PATCH/DELETE /kb-categories/{categoryId}`, `GET/PUT /kb-settings`; şemalar `KbArticle`, `KbCategory`, `KbSettings`; bundle + `@siyahtus/types` regen. (2) `apps/api/src/routes/kb.ts` — `playbook.ts` CRUD şablonunun birebir kopyası: `request.withTenant` ile tenant-scoped sorgu, `ApiError.notFound` ile 404. (3) Slug normalizasyonu (küçük harf, boşluk→'-', ASCII dışı transliterasyon yok → reddet) ve license-içi çakışmada `validation` hatası. (4) `status` geçişi: draft→published `published_at` yazar, unpublish `published_at`'ı null'lar. (5) `kb_settings` yazımı `minimumRole: 'administrator'` (public_slug + enabled bir kamuya-açma anahtarıdır); okuma normal scope. (6) publish/unpublish ve kb_settings.enabled değişimi audit log'a yazılır (mevcut audit yardımcısı, auth.ts'teki `action:'pat.revoked'` deseni).
DOSYALAR: packages/contract/openapi/paths/kb.yaml · packages/contract/openapi/openapi.yaml · apps/api/src/routes/kb.ts · apps/api/src/server.ts · apps/api/test/integration/kb.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/playbook.ts · apps/api/src/routes/ticket-email-templates.ts · packages/contract/openapi/paths/playbook.yaml · apps/api/src/routes/settings.ts
KK (birebir): "KK-türetilmiş: "SEO'lu self-servis bilgi bankası (public KB)" — PRD §6'da bu kalem için KK satırı yok; §5.3'ten türetildi. Bu alt-görevin payı: 'public' kelimesi ancak bir içeriğin AÇIKÇA yayınlanmasıyla anlam kazanır → bir makale varsayılan olarak taslaktır ve yalnız yetkili bir eylemle yayınlanır; workspace'in KB'si varsayılan olarak kapalıdır ve yalnız yönetici açabilir."
KK DOĞRULAMA: `kb.test.ts` integration: (1) yeni makale varsayılan `status='draft'`, `published_at=null` (KK 'varsayılan taslak' payı); (2) PATCH status=published → `published_at` dolar, tekrar draft → null'lanır (KK 'açık yayın eylemi' payı); (3) `PUT /kb-settings` normal ajan token'ıyla 403, administrator ile 200 (KK 'yalnız yönetici açar' payı); (4) `contract-parity.test.ts` her iki yönde yeşil (kontrat = servis edilen).
KAPSAM DIŞI: Anonim/public okuma yolu (PUBKB-c) — bu alt-görevde hiçbir route `config.public` almaz · HTML render / SEO meta / sitemap (PUBKB-e, PUBKB-f) · Admin ekranları (PUBKB-g, PUBKB-h) · Gövde metninin güvenli render'ı (PUBKB-d) — burada gövde ham saklanır, servis edilmez
SÖZLEŞME: EVET — `packages/contract/openapi/paths/kb.yaml` yeni: `/kb-articles`, `/kb-articles/{articleId}`, `/kb-categories`, `/kb-categories/{categoryId}`, `/kb-settings` + `KbArticle`/`KbCategory`/`KbSettings` şemaları. OpenAPI'ye eklenip **re-bundle** edilmezse `contract-parity.test.ts` KIRILIR (çift yönlü kontrol: hem belgelenmemiş route hem servis edilmeyen belge). Yeni ApiError tipi EKLENMEZ (mevcut `validation`/`not_found`/`authorization` yeter) — eklenirse tuzak: `packages/types/src/errors.ts` (ERROR_TYPES + ERROR_STATUS, iki yer) + `packages/types/src/scopes.test.ts:95` sayaç + openapi enum + regen. Yeni scope da EKLENMEZ (§C varsayım 6) — eklenirse `scopes.test.ts:31` sayacı kırılır.
MIGRATION: yok (PUBKB-a'nın tabloları kullanılır)
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 76.3. PUBKB-c [OPUS-MAX] Anonim public okuma çekirdeği (BÖLÜNMEZ): slug→license çözümleyici + yayın filtresi + 404 politikası + anon rate-limit

**Status:** done  
**Dependencies:** 76.1, 76.2  

(1) Migration: `kb_resolve_public_slug(p_slug TEXT)` SECURITY DEFINER fonksiyonu — `auth_resolve_organization_license`'ın birebir kardeşi; tek soru sorar, YALNIZ `kb_settings.enabled = true` ve license'ı `canceled` olmayan workspace eşleşir; `REVOKE EXECUTE ... FROM PUBLIC` + `GRANT ... TO siyahtus_app`. (2) `apps/api/src/routes/public-kb.ts` — `config: { public: true }`: `GET /public/kb/{workspaceSlu

**Details:**

PUBKB-c — Anonim public okuma çekirdeği (BÖLÜNMEZ): slug→license çözümleyici + yayın filtresi + 404 politikası + anon rate-limit  [OPUS-MAX]

PRD: §5.3-Knowledge (public KB); NFR-S4, NFR-S5 (403 değil 404), NFR-S6, NFR-S8 (rate limit), NFR-P2
ETİKET GEREKÇESİ: OPUS-MAX: güvenlik sınırı + tenant izolasyonu — SONNET koşul 2'nin doğrudan ihlali. Bu depoda `principal` olmadan org-scoped İÇERİK servis eden ilk yüzey: `principal.ts:14-42` yalnız agent/bot/customer tanımlıyor, `config.public:true` route'larda `request.principal` undefined kalıyor, dolayısıyla tenant bağlamı yol parametresinden türetilmek zorunda. Mevcut public route'ların hepsi transactional (signup, provider webhook, health) — hiçbiri içerik OKUTMUYOR. Yanlış kararın maliyeti: başka tenant'ın veya yayınlanmamış makalenin arama motoruna sızması. Çekirdek (resolver + filtre + 404 politikası + enumeration yüzeyi) bölünmez.
NEDEN AÇIK: `apps/api/src/plugins/auth.ts:34-46` `config.public=true` opt-in'i var ve `principal` public route'ta hiç set edilmiyor. Public kullanan mevcut örneklerin tamamı (`account-lifecycle.ts` signup/reset/invitation, `channels.ts:158-166` provider+email inbound, `uploads.ts:138`, `health.ts:48`, `auth.ts` login/token/customer-token) transactional ya da imzalı — hiçbiri org-scoped içeriği anonim kitleye OKUTMUYOR. Öte yandan pre-tenant çözümleme deseni ZATEN VAR: `auth_resolve_organization_license` (migration `20260724110000_chat_page_license_resolver`, SECURITY DEFINER, `REVOKE ... FROM PUBLIC` + `GRANT ... TO siyahtus_app`) ve `channels.ts` email inbound ile `auth.ts:538` Chat page bunu `withTenant(app.db, tenant, ...)` ile kullanıyor — yani sıfırdan icat değil, aynı denetlenmiş deliğin ikinci örneği kurulacak.
KAPSAM: (1) Migration: `kb_resolve_public_slug(p_slug TEXT)` SECURITY DEFINER fonksiyonu — `auth_resolve_organization_license`'ın birebir kardeşi; tek soru sorar, YALNIZ `kb_settings.enabled = true` ve license'ı `canceled` olmayan workspace eşleşir; `REVOKE EXECUTE ... FROM PUBLIC` + `GRANT ... TO siyahtus_app`. (2) `apps/api/src/routes/public-kb.ts` — `config: { public: true }`: `GET /public/kb/{workspaceSlug}/articles` (yayınlanmış makale listesi, keyset sayfalama), `GET /public/kb/{workspaceSlug}/articles/{articleSlug}`, `GET /public/kb/{workspaceSlug}/categories`. (3) Her istek: slug çözümle → `withTenant(app.db, tenant, ...)` → sorguya `status='published' AND published_at IS NOT NULL` filtresi ZORUNLU. (4) 404 politikası (NFR-S5): bilinmeyen workspace slug'ı, KB kapalı workspace, taslak makale, başka tenant'ın makalesi — DÖRDÜ DE ayırt edilemez tek bir 404 döner (403 yok, mesaj farkı yok, timing farkı gözetilir). (5) Yanıt gövdesinde ASLA bulunmayacak alanlar: `license_id`, `created_by`, iç `id`'ler dışında herhangi bir ajan/hesap kimliği, `content` dışındaki iç alanlar. (6) Rate-limit: `rate-limit.ts` anon kovası (30 req/60s/IP) SEO crawler'ı boğar → public KB GET'leri için ayrı, daha yüksek limitli kova (`rl:pubkb:<ip>`); `skipRateLimit` KULLANILMAZ (health dışında hiçbir yerde kullanılmıyor). (7) Kontrat: `packages/contract/openapi/paths/public-kb.yaml` + re-bundle.
DOSYALAR: apps/api/prisma/migrations/<yeni_timestamp>_kb_public_resolver/migration.sql · apps/api/src/routes/public-kb.ts · apps/api/src/plugins/rate-limit.ts · packages/contract/openapi/paths/public-kb.yaml · apps/api/src/server.ts · apps/api/test/integration/public-kb.test.ts
REFERANS DESEN (kopyalanacak): apps/api/prisma/migrations/20260724110000_chat_page_license_resolver/migration.sql · apps/api/src/routes/channels.ts · apps/api/src/routes/customer.ts · apps/api/src/lib/tenant.ts
KK (birebir): ""SEO'lu self-servis bilgi bankası (public KB)"" | "KK-türetilmiş: bu alt-görevin payı — 'public' = kimlik doğrulamasız okuyucu içeriğe erişebilir; 'self-servis' = okuyucunun bir ajanla temas kurmadan makaleyi bulup okuyabilmesi. Türetme gerekçesi: PRD §6 FR-MOD tablosunda bu kaleme ait KK satırı YOK; §5.3 satırı (satır 410) tek cümle. NFR-S5 gereği yetkisiz erişim 403 değil 404 döner kuralı PRD NFR bölümünden alınmıştır, türetilmiş değildir."
KK DOĞRULAMA: `public-kb.test.ts`: (1) token'sız (Authorization header'ı OLMAYAN) istek yayınlanmış makaleyi 200 ile döner → KK 'public' payı; (2) aynı istek taslak makale için 404 → KK 'yalnız yayınlanan public' payı; (3) license B'nin makale slug'ı, license A'nın workspaceSlug'ı ile → 404 → NFR-S5; (4) `kb_settings.enabled=false` workspace → tüm public yollar 404; (5) yanıt gövdesinde `license_id`/`created_by` yok (snapshot iddiası); (6) `contract-parity` yeşil.
KAPSAM DIŞI: HTML render, meta etiketleri, JSON-LD (PUBKB-e) · sitemap.xml / robots.txt (PUBKB-f) · Gövde metninin HTML'e dönüştürülmesi (PUBKB-d) — bu alt-görev gövdeyi JSON'da ham metin olarak döner · Admin CRUD (PUBKB-b'de kapandı) · Public tarafta arama/full-text (kapsam dışı, §C açık soru 3)
SÖZLEŞME: EVET — `packages/contract/openapi/paths/public-kb.yaml`: `/public/kb/{workspaceSlug}/articles`, `/public/kb/{workspaceSlug}/articles/{articleSlug}`, `/public/kb/{workspaceSlug}/categories`. **OpenAPI'ye eklenip re-bundle edilmezse `contract-parity.test.ts` KIRILIR.** Bu operasyonların `security: []` (anonim) olarak işaretlenmesi ve 404-only hata gövdesi belgelenmesi gerekir.
MIGRATION: EVET — `<timestamp>_kb_public_resolver`: `kb_resolve_public_slug(TEXT)` SECURITY DEFINER fonksiyonu + `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO siyahtus_app` (referans: `20260724110000_chat_page_license_resolver`). Tablo değişikliği yok.
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 76.4. PUBKB-d [OPUS-MAX] Makale gövdesi güvenli render çekirdeği (BÖLÜNMEZ): escape-first sınırlı markdown

**Status:** done  
**Dependencies:** None  

Saf, I/O'suz fonksiyon: `apps/api/src/lib/kb-render.ts` → `renderArticleBody(markdown: string): string`. Algoritma sırası ZORUNLU: (1) girdinin TAMAMI HTML-escape edilir (`& < > " '`); (2) yalnızca escape edilmiş metin üzerinde sınırlı markdown alt kümesi tanınır ve etiketlere çevrilir: `##`/`###` başlık, paragraf, `-` liste, `**kalın**`, `` `kod` ``, `[metin](url)` link; (3) link URL'i yalnız `ht

**Details:**

PUBKB-d — Makale gövdesi güvenli render çekirdeği (BÖLÜNMEZ): escape-first sınırlı markdown  [OPUS-MAX]

PRD: §5.3-Knowledge (public KB); NFR-S6, NFR-S4
ETİKET GEREKÇESİ: OPUS-MAX: stored-XSS sınırı + yeni algoritma tasarımı. Ajanın yazdığı gövde, kimlik doğrulamasız tarayıcılara HTML olarak gidecek; depoda hiçbir sanitizasyon kütüphanesi kurulu değil, dolayısıyla çıkış kodlaması sıfırdan ve DOĞRU sırayla tasarlanacak (önce tam escape, sonra beyaz-liste). SONNET koşul 2 (güvenlik sınırı) ve koşul 4 (kopyalanacak mevcut desen yok — `web-crawler.ts` TERS yönde çalışıyor) ihlal. Çekirdek bölünmez: kaçış sırası ile beyaz-liste sırası aynı fonksiyonun invariantı.
NEDEN AÇIK: Repo genelinde (apps + packages package.json'ları) `sanitize-html`, `DOMPurify`, `marked`, `markdown-it` grep 0 — hiçbir sanitizasyon/markdown kütüphanesi kurulu değil. Tek HTML kaçış yardımcısı `apps/api/src/services/ai/web-crawler.ts:89` `escapeHtml` ve o (a) dışa aktarılmamış private bir yardımcı, (b) yalnız mock sayfa ÜRETMEK için kullanılıyor; dosyanın asıl işi `htmlToText` yani HTML→düz metin, yani TERS yön. Yani public sayfada metin→HTML üretecek güvenli hiçbir yol yok.
KAPSAM: Saf, I/O'suz fonksiyon: `apps/api/src/lib/kb-render.ts` → `renderArticleBody(markdown: string): string`. Algoritma sırası ZORUNLU: (1) girdinin TAMAMI HTML-escape edilir (`& < > " '`); (2) yalnızca escape edilmiş metin üzerinde sınırlı markdown alt kümesi tanınır ve etiketlere çevrilir: `##`/`###` başlık, paragraf, `-` liste, `**kalın**`, `` `kod` ``, `[metin](url)` link; (3) link URL'i yalnız `http:`/`https:` şemasına izinli (`javascript:`, `data:`, `vbscript:`, şemasız/protokol-göreli `//` reddedilir → link düz metne düşer), üretilen `<a>` `rel="nofollow noopener ugc"` taşır; (4) ham HTML ASLA geçmez — beyaz-liste dışı hiçbir etiket üretilmez, girdideki `<script>`/`<img onerror>` zaten adım 1'de metne dönmüştür; (5) çıktı uzunluk tavanı + derinlik sınırı (ReDoS'a açık geri-izleyen regex yok, doğrusal tarama). Ayrıca `renderPlainExcerpt()` (meta description için, etiketsiz düz metin).
DOSYALAR: apps/api/src/lib/kb-render.ts · apps/api/src/lib/kb-render.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/services/ai/web-crawler.ts · apps/api/src/lib/cc-mask.ts · apps/api/src/lib/ssrf.ts
KK (birebir): "KK-türetilmiş: "SEO'lu self-servis bilgi bankası (public KB)" — PRD §6'da KK satırı yok. Bu alt-görevin payı: bir bilgi bankası makalesinin okunabilir olması için başlık/paragraf/liste/link biçimlendirmesi gerekir ('bilgi bankası' payı); anonim kitleye servis edilen her çıktı, yazarın girdiğinden başka hiçbir şey çalıştırmamalıdır (NFR-S6 türevi). Türetme gerekçesi: PRD render biçimi hakkında hiçbir şey söylemiyor; biçim kararı §C varsayım 3 olarak kaydedildi."
KK DOĞRULAMA: `kb-render.test.ts` unit: (1) `## Başlık` → `<h2>` (KK 'okunabilir makale' payı); (2) `<script>alert(1)</script>` girdisi çıktıda `&lt;script&gt;` olarak görünür, hiçbir `<script` üretilmez (KK 'çalıştırmaz' payı); (3) `[x](javascript:alert(1))` → link üretilmez, düz metne düşer; (4) `renderPlainExcerpt` çıktısında hiçbir `<` karakteri yok.
KAPSAM DIŞI: HTML sayfa şablonu, meta/OG/JSON-LD (PUBKB-e) · Yeni bir sanitizasyon bağımlılığı eklemek (§C varsayım 3: bağımlılık eklenmez) · Frontend tarafında markdown önizleme (PUBKB-h'de düz textarea; zengin editör §C açık soru 2) · Tablo/görsel/gömülü içerik desteği (beyaz-liste dışı, v3)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 76.5. PUBKB-e [OPUS-XHIGH] SEO'lu sunucu-render HTML yüzeyi: KB ana sayfası + makale sayfası (title/meta/canonical/OG/JSON-LD)

**Status:** done  
**Dependencies:** 76.3, 76.4  

`apps/api/src/routes/public-kb-html.ts` — `config: { public: true }`, `reply.type('text/html; charset=utf-8')` ile SUNUCUDA üretilen HTML (yeni bağımlılık yok, şablon literal): `GET /public/kb/{workspaceSlug}` (kategori + makale listesi) ve `GET /public/kb/{workspaceSlug}/{articleSlug}` (makale). Veri yolu PUBKB-c'nin servis fonksiyonlarını yeniden kullanır (aynı resolver, aynı published filtresi,

**Details:**

PUBKB-e — SEO'lu sunucu-render HTML yüzeyi: KB ana sayfası + makale sayfası (title/meta/canonical/OG/JSON-LD)  [OPUS-XHIGH]

PRD: §5.3-Knowledge (public KB); NFR-P2, NFR-A11Y1, NFR-S6
ETİKET GEREKÇESİ: OPUS-XHIGH: yeni bir public HTTP yüzeyi (HTML content-type) ve depoda hiç örneği olmayan bir render katmanı tasarımı — çok yüzeyli bağlama (kontrat + route + şablon + PUBKB-d çıktısı) ve mimari karar içeriyor, SONNET koşul 4 (kopyalanacak mevcut desen) sağlanmıyor. Güvenlik hassasiyeti var (anonim yüzey) ama izolasyon PUBKB-c'de, kaçış PUBKB-d'de çözüldüğü için MAX gerekmiyor.
NEDEN AÇIK: `apps/web` tek bir Vite SPA (App.tsx react-router, client-render) ve PRD kendi A2 varsayımında (satır 1045) 'Ürün SPA (SEO gerekmez, oturum-arkası); pazarlama sayfaları ve Chat page için SSR/SSG uygun' diyor. Depodaki TEK anonim tam-sayfa yüzey `apps/widget/chat.html` ve o sayfa açıkça `<meta name="robots" content="noindex, nofollow" />` taşıyor. `apps/api`'de `@fastify/static`/`sendFile`/`text/html` grep 0. Yani şu an indekslenebilir bir sayfa üretecek hiçbir yol yok.
KAPSAM: `apps/api/src/routes/public-kb-html.ts` — `config: { public: true }`, `reply.type('text/html; charset=utf-8')` ile SUNUCUDA üretilen HTML (yeni bağımlılık yok, şablon literal): `GET /public/kb/{workspaceSlug}` (kategori + makale listesi) ve `GET /public/kb/{workspaceSlug}/{articleSlug}` (makale). Veri yolu PUBKB-c'nin servis fonksiyonlarını yeniden kullanır (aynı resolver, aynı published filtresi, aynı 404 politikası — kopyalanmaz, çağrılır). Her sayfa: `<title>` (seo_title ?? title), `<meta name="description">` (seo_description ?? excerpt, PUBKB-d `renderPlainExcerpt`), `<link rel="canonical">`, OpenGraph (og:title/og:description/og:type=article/og:url), `Article` JSON-LD (JSON içinde `<` kaçışı), `<meta name="robots" content="index, follow">` (chat.html'in tersi — bilinçli), `lang` attribute. Gövde PUBKB-d'nin `renderArticleBody` çıktısıdır. JS'siz ilk boyama: sayfa hiçbir script yüklemeden tam okunur. Semantik iskelet: tek `<h1>`, `<main>`, `<nav>` breadcrumb (a11y). Cache-Control: public, kısa max-age + ETag.
DOSYALAR: apps/api/src/routes/public-kb-html.ts · apps/api/src/lib/kb-page.ts · packages/contract/openapi/paths/public-kb.yaml · apps/api/src/server.ts · apps/api/test/integration/public-kb-html.test.ts
REFERANS DESEN (kopyalanacak): apps/widget/chat.html · apps/api/src/routes/public-kb.ts · apps/api/src/lib/kb-render.ts · apps/api/src/services/ai/web-crawler.ts
KK (birebir): ""SEO'lu self-servis bilgi bankası (public KB)"" | "KK-türetilmiş: bu alt-görevin payı — 'SEO'lu' = sayfa arama motoru tarafından indekslenebilir olmalı: sunucudan gelen ilk HTML'de başlık, açıklama ve makale metni JavaScript çalışmadan bulunmalı, sayfa kanonik bir adres bildirmeli. Türetme gerekçesi: PRD 'SEO'lu' diyor ama hangi meta/işaretlemenin gerektiğini yazmıyor; PRD satır 1045 SPA'nın SEO üretemeyeceğini kendisi söylüyor, dolayısıyla sunucu-render kararı §C varsayım 2'ye yazıldı."
KK DOĞRULAMA: `public-kb-html.test.ts` integration: (1) yanıt gövdesi (hiçbir script çalıştırmadan, ham string olarak) makale başlığını ve gövde metnini içerir → KK 'SEO'lu' payı; (2) `<title>`, `<meta name="description">`, `<link rel="canonical">`, `og:title`, `Article` JSON-LD var; (3) taslak makale → 404 HTML (metin sızmıyor) → KK 'yalnız public' payı; (4) `<script>` içeren gövdeyle üretilen sayfada `<script` yalnız JSON-LD bloğunda geçer, makale gövdesinde geçmez.
KAPSAM DIŞI: sitemap.xml / robots.txt (PUBKB-f) · Çok dilli sayfa + hreflang (§C varsayım 8: tek dil) · Görsel/medya gömme, tema/marka özelleştirme (v3) · apps/web SPA'sına public route eklemek (§C varsayım 2: SPA'ya dokunulmaz) · Site içi arama (§C açık soru 3)
SÖZLEŞME: EVET — `public-kb.yaml` içine iki HTML operasyonu: `GET /public/kb/{workspaceSlug}` ve `GET /public/kb/{workspaceSlug}/{articleSlug}`, `content: text/html` yanıtıyla. **contract-parity.test.ts Fastify router'ının TAMAMINI sayar — HTML route'ları da OpenAPI'ye eklenip re-bundle edilmezse test kırılır.** DİKKAT: `/public/kb/{workspaceSlug}/{articleSlug}` (HTML) ile `/public/kb/{workspaceSlug}/articles/{articleSlug}` (JSON) yol çakışması olmamasına dikkat — `articles`, `categories`, `sitemap.xml` ayrılmış segmentlerdir, makale slug'ı bu üçünü alamaz (PUBKB-b'deki slug doğrulamasına rezerve-kelime kuralı eklenir).
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 76.6. PUBKB-f [SONNET-XHIGH] sitemap.xml + robots.txt (yalnız yayınlanmış makaleler, XML-escape'li)

**Status:** done  
**Dependencies:** 76.3, 76.5  

`apps/api/src/routes/public-kb-sitemap.ts`, `config: { public: true }`: (1) `GET /public/kb/{workspaceSlug}/sitemap.xml` — PUBKB-c'nin published-makale servis fonksiyonundan liste alır, `<urlset>`/`<url>`/`<loc>`/`<lastmod>` üretir; her `<loc>` XML-escape edilir (`& < > " '`), `lastmod` = `published_at`/`updated_at` ISO tarihi; KB kapalı/bilinmeyen slug → 404. (2) `GET /public/kb/{workspaceSlug}/r

**Details:**

PUBKB-f — sitemap.xml + robots.txt (yalnız yayınlanmış makaleler, XML-escape'li)  [SONNET-XHIGH]

PRD: §5.3-Knowledge (public KB); NFR-S5
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. 2 dosya + testi. Güvenlik sınırı YOK — erişim kararı ve published filtresi PUBKB-c'de çözülmüş, burada aynı servis fonksiyonu çağrılıp XML'e yazılıyor (yetki kararı verilmiyor). Eşzamanlılık yok. Kopyalanacak desen ismen var: `reports-export.ts` (injection-safe dışa aktarım) ve `public-kb.ts` (yayın filtresi + resolver çağrısı). Kontrat eklemesi katkısal ve mekanik. KK mekanik doğrulanabilir (URL listesi = published makale kümesi).
NEDEN AÇIK: Repo genelinde sitemap.xml / robots.txt üretimi grep 0 (olgular listesi) ve `apps/api/src/routes/` altında böyle bir dosya yok (27 dosyalık ls). Depodaki tek anonim tam-sayfa (`apps/widget/chat.html`) zaten `noindex, nofollow` — yani hiçbir indeksleme yönergesi üretim yolu mevcut değil.
KAPSAM: `apps/api/src/routes/public-kb-sitemap.ts`, `config: { public: true }`: (1) `GET /public/kb/{workspaceSlug}/sitemap.xml` — PUBKB-c'nin published-makale servis fonksiyonundan liste alır, `<urlset>`/`<url>`/`<loc>`/`<lastmod>` üretir; her `<loc>` XML-escape edilir (`& < > " '`), `lastmod` = `published_at`/`updated_at` ISO tarihi; KB kapalı/bilinmeyen slug → 404. (2) `GET /public/kb/{workspaceSlug}/robots.txt` — `User-agent: *` + `Allow: /public/kb/{slug}/` + `Sitemap: <mutlak sitemap url>`; KB kapalıysa `Disallow: /`. (3) Sayfa sayısı tavanı (50k URL / tek dosya) aşılırsa ilk N ile sınırlanır (sitemap index v3).
DOSYALAR: apps/api/src/routes/public-kb-sitemap.ts · packages/contract/openapi/paths/public-kb.yaml · apps/api/src/server.ts · apps/api/test/integration/public-kb-sitemap.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports-export.ts · apps/api/src/routes/public-kb.ts · apps/api/src/services/ai/web-crawler.ts
KK (birebir): "KK-türetilmiş: "SEO'lu self-servis bilgi bankası (public KB)" — bu alt-görevin payı: 'SEO'lu' bir bilgi bankası, arama motoruna hangi sayfalarının indekslenebilir olduğunu makine-okur biçimde bildirmelidir (sitemap + robots). Türetme gerekçesi: PRD sitemap/robots'tan hiç söz etmiyor; 'SEO'lu' sıfatının asgari teknik karşılığı olarak türetildi."
KK DOĞRULAMA: `public-kb-sitemap.test.ts` integration: (1) sitemap yalnız `status='published'` makalelerin URL'lerini içerir, taslakların slug'ı hiç geçmez → KK 'yalnız public içerik' payı; (2) `robots.txt` Sitemap satırını ve Allow kuralını taşır → KK 'SEO'lu' payı; (3) `&` içeren slug/başlık XML'de `&amp;` olarak kaçırılır.
KAPSAM DIŞI: Sitemap index / 50k üstü bölme (v3) · Arama motoruna ping/submit (dış servis — MASTER-PROMPT §5 mock, kapsam dışı) · Kök `/robots.txt` (uygulama kökü ürün SPA'sına ait; burada yalnız KB yolu altındaki robots) · Structured data doğrulama araçlarıyla dış test
SÖZLEŞME: EVET — `public-kb.yaml`'a `GET /public/kb/{workspaceSlug}/sitemap.xml` (`application/xml`) ve `GET /public/kb/{workspaceSlug}/robots.txt` (`text/plain`). **OpenAPI'ye eklenip re-bundle edilmezse contract-parity.test.ts kırılır.** `sitemap.xml`/`robots.txt` PUBKB-b'deki rezerve-slug listesine eklenmiş olmalı.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 76.7. PUBKB-g [SONNET-XHIGH] Admin: KB makale listesi + durum sekmeleri (All/Published/Drafts) + anlamlı empty state

**Status:** done  
**Dependencies:** 76.2  

(1) Saf modül `apps/web/src/features/playbook/kb-tabs.ts` — makale listesini `status` + kategori + debounce arama ile daraltan saf fonksiyonlar (`knowledge-tabs.ts` imzasının kardeşi). (2) `KbArticleList.tsx` — `role=tablist` sekmeler (All / Published / Drafts), satırda başlık + kategori + durum rozeti + `updated_at`; her sekme için ANLAMLI empty state (boş dikdörtgen yok); yükleme skeleton'ı. (3)

**Details:**

PUBKB-g — Admin: KB makale listesi + durum sekmeleri (All/Published/Drafts) + anlamlı empty state  [SONNET-XHIGH]

PRD: §5.3-Knowledge (public KB); FR-EK-B.1 (empty state deseni), NFR-A11Y1
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. 3-4 dosya (saf filtre modülü + bileşen + test + sekme kaydı). Güvenlik sınırı YOK — yalnız PUBKB-b'nin agent-auth endpoint'ini tüketen okuma ekranı, yetki kararı vermiyor. Eşzamanlılık yok. Kopyalanacak desen birebir var ve ismen verilebiliyor: `knowledge-tabs.ts` + `skill-tabs.ts` (saf sekme filtresi) ve `PlaybookPage.tsx` (sekme kabuğu). Kontrat değişikliği yok. KK mekanik doğrulanabilir (her sekme doğru alt küme).
NEDEN AÇIK: `apps/web/src/features/playbook/` altında Knowledge tarafı yalnız AI Agent RAG kaynaklarını gösteriyor (`knowledge-tabs.ts` sekmeleri All/Websites/Files/Articles/FAQ = `KnowledgeSource.type`) ve `PlaybookPage.tsx` yayınlanabilir makale kavramını hiç bilmiyor; `apps/web/src/features/` altındaki 15 özellik dizininin hiçbirinde kb/public-kb yok.
KAPSAM: (1) Saf modül `apps/web/src/features/playbook/kb-tabs.ts` — makale listesini `status` + kategori + debounce arama ile daraltan saf fonksiyonlar (`knowledge-tabs.ts` imzasının kardeşi). (2) `KbArticleList.tsx` — `role=tablist` sekmeler (All / Published / Drafts), satırda başlık + kategori + durum rozeti + `updated_at`; her sekme için ANLAMLI empty state (boş dikdörtgen yok); yükleme skeleton'ı. (3) `PlaybookPage.tsx`'e 'Public KB' sekmesi kaydı. Veri: PUBKB-b'nin `GET /kb-articles` endpoint'i, üretilmiş `@siyahtus/types` tipleriyle.
DOSYALAR: apps/web/src/features/playbook/kb-tabs.ts · apps/web/src/features/playbook/kb-tabs.test.ts · apps/web/src/features/playbook/KbArticleList.tsx · apps/web/src/features/playbook/KbArticleList.test.tsx · apps/web/src/features/playbook/PlaybookPage.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/playbook/knowledge-tabs.ts · apps/web/src/features/playbook/skill-tabs.ts · apps/web/src/features/playbook/skill-filter.ts · apps/web/src/features/playbook/PlaybookPage.tsx · apps/web/src/features/playbook/TemplateGallery.tsx
KK (birebir): "KK-türetilmiş: "SEO'lu self-servis bilgi bankası (public KB)" — bu alt-görevin payı: bir bilgi bankası ancak içeriği yönetilebiliyorsa var olur; ekip hangi makalenin yayında hangisinin taslak olduğunu tek bakışta görebilmelidir. Türetme gerekçesi: PRD §6'da bu kalem için KK satırı yok; yönetim yüzeyi §5.3'ün 'bilgi bankası' ifadesinden türetildi. Empty-state şartı FR-EK-B.1'in birebir KK'sından ödünç alındı: "her boş liste için anlamlı empty state (boş dikdörtgen yok)"."
KK DOĞRULAMA: `kb-tabs.test.ts` unit: her sekme doğru alt kümeyi döner (Published yalnız `status='published'`, Drafts yalnız `draft`, All hepsi) → KK 'yönetilebilir bilgi bankası' payı. `KbArticleList.test.tsx`: boş listede anlamlı empty state metni render edilir (boş dikdörtgen değil) → FR-EK-B.1 KK'sı; `role=tablist`/`aria-selected` doğru (NFR-A11Y1).
KAPSAM DIŞI: Makale oluşturma/düzenleme formu (PUBKB-h) · publish/unpublish eylemi (PUBKB-h) · Public sayfanın kendisi (PUBKB-e) · Kategori yönetimi ekranı (PUBKB-h içinde basit seçici olarak, ayrı CRUD ekranı v3) · Sürükle-bırak sıralama
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 76.8. PUBKB-h [SONNET-XHIGH] Admin: makale editörü (içerik + SEO alanları) + publish/unpublish + public link

**Status:** done  
**Dependencies:** 76.2, 76.7  

`KbArticleEditor.tsx`: (1) alanlar — Title (zorunlu), Slug (başlıktan otomatik türer, elle düzenlenebilir, T4-a form primitifiyle alan-altı hata), Category (seçici + 'yeni kategori'), Body (düz metin/sınırlı markdown textarea + hangi biçimlendirmenin desteklendiğini söyleyen yardım metni), Excerpt, SEO title, SEO description (karakter sayacı: 60/155 önerisi). (2) Publish / Unpublish butonu — `PATC

**Details:**

PUBKB-h — Admin: makale editörü (içerik + SEO alanları) + publish/unpublish + public link  [SONNET-XHIGH]

PRD: §5.3-Knowledge (public KB); FR-EK-A.1 (form validasyon primitifi), NFR-A11Y1
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. 2-3 dosya + testleri. Güvenlik sınırı YOK — form, PUBKB-b'nin agent-auth PATCH'ini çağırır; 'kim yayınlayabilir' kararı backend'de (`minimumRole`) verilmiş durumda, UI yalnız onu yansıtır. Eşzamanlılık yok. Kopyalanacak desen ismen var: `SkillEditor.tsx` (çok alanlı editör + kaydet), `ProfileForm.tsx` (zorunlu alan + submit-disabled), `WidgetCustomization.tsx` (ayar formu + canlı önizleme). Kontrat değişikliği yok. KK mekanik doğrulanabilir.
NEDEN AÇIK: `apps/web/src/features/playbook/` altında makale editörü yok — mevcut editör `SkillEditor.tsx` yalnız skill adımlarını düzenliyor; `PlaybookPage.tsx` knowledge tarafında yalnız kaynak listesi/silme var (`knowledge-tabs.ts`). `apps/web/src/features/` altında slug/seo alanı içeren hiçbir form yok.
KAPSAM: `KbArticleEditor.tsx`: (1) alanlar — Title (zorunlu), Slug (başlıktan otomatik türer, elle düzenlenebilir, T4-a form primitifiyle alan-altı hata), Category (seçici + 'yeni kategori'), Body (düz metin/sınırlı markdown textarea + hangi biçimlendirmenin desteklendiğini söyleyen yardım metni), Excerpt, SEO title, SEO description (karakter sayacı: 60/155 önerisi). (2) Publish / Unpublish butonu — `PATCH /kb-articles/{id}` `status` alanını değiştirir; yayınlanınca 'Public link' satırı görünür (kopyala butonu, `kb_settings.public_slug` + makale slug'ından üretilir); `kb_settings.enabled=false` iken uyarı bandı ('KB kapalı — link çalışmaz'). (3) Geçersiz/çakışan slug backend'den dönünce alan-altı hata. (4) Kirli formu kapatma onayı (T5-a dirty-guard deseni).
DOSYALAR: apps/web/src/features/playbook/KbArticleEditor.tsx · apps/web/src/features/playbook/KbArticleEditor.test.tsx · apps/web/src/features/playbook/kb-slug.ts · apps/web/src/features/playbook/kb-slug.test.ts · apps/web/src/features/playbook/KbArticleList.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/playbook/SkillEditor.tsx · apps/web/src/features/playbook/ProfileForm.tsx · apps/web/src/features/settings/WidgetCustomization.tsx · apps/web/src/features/settings/WebsiteWidgets.tsx
KK (birebir): "KK-türetilmiş: "SEO'lu self-servis bilgi bankası (public KB)" — bu alt-görevin payı: 'SEO'lu' → yazar, arama motoruna gidecek başlık/açıklamayı ve makalenin kalıcı adresini (slug) düzenleyebilmelidir; 'public' → yayına almak açık, geri alınabilir tek bir eylem olmalıdır. Türetme gerekçesi: PRD §6'da KK satırı yok. Form davranışı FR-EK-A.1'in birebir KK'sından ödünç: "Tek form/validasyon kütüphanesi; alan-altı hata mesajı"."
KK DOĞRULAMA: `KbArticleEditor.test.tsx` unit: (1) Title boşken submit pasif + alan-altı hata (FR-EK-A.1 KK'sı); (2) başlık yazınca slug otomatik türer, elle değiştirilince artık türetilmez (KK 'kalıcı adres' payı); (3) SEO title/description alanları kaydedilip geri okunur (KK 'SEO'lu' payı); (4) Publish → durum rozeti 'Published' + Public link görünür; Unpublish geri alır (KK 'public' payı); (5) `kb_settings.enabled=false` iken uyarı bandı render edilir.
KAPSAM DIŞI: Zengin metin (WYSIWYG) editörü (§C açık soru 2 — varsayım: hayır) · Markdown canlı önizleme (render PUBKB-d'de sunucuda; UI önizlemesi v3) · Görsel yükleme/medya kütüphanesi · Yayın onay/review iş akışı (§C varsayım 9: yok) · Kategori CRUD tam ekranı (burada yalnız seçici + hızlı ekleme)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 76.9. PUBKB-i [OPUS-XHIGH] Uçtan uca doğrulama: anonim okuyucu e2e + izolasyon/SEO kanıt seti

**Status:** done  
**Dependencies:** 76.3, 76.5, 76.6, 76.8  

`apps/e2e/tests/public-kb.spec.ts` — hikâye: ajan panelde makale oluşturur → taslakken public adres 404 → publish eder → OTURUMSUZ (storageState'siz) yeni browser context ile public adres açılır ve makale okunur → `<title>`/meta description/canonical doğrulanır → sitemap.xml yalnız o makaleyi listeler → ikinci bir tenant'ın workspaceSlug'ı ile aynı makale slug'ı 404 → unpublish sonrası public adre

**Details:**

PUBKB-i — Uçtan uca doğrulama: anonim okuyucu e2e + izolasyon/SEO kanıt seti  [OPUS-XHIGH]

PRD: §5.3-Knowledge (public KB); NFR-S5, NFR-S6, NFR-P2, NFR-A11Y1
ETİKET GEREKÇESİ: OPUS-XHIGH: tek bir dosya gibi görünse de kontrat+backend+HTML+sitemap+admin UI'yi tek senaryoda bağlayan çok yüzeyli doğrulama ve güvenlik iddialarının (izolasyon, taslak sızmaması, XSS) kanıtlanması — hangi iddianın hangi testle kapandığına dair yorum gerektiriyor, SONNET koşul 6 sağlanmıyor. Çekirdek güvenlik kararı verilmediği için MAX değil.
NEDEN AÇIK: `apps/e2e/tests/` altında 17 spec var (ai-agent, billing, campaigns, command-palette, copilot, customers, demo-flow, inbox-panel, inbox-tabs, notifications, onboarding, playbook, reports, settings, team, tickets, traffic, widget) — hiçbiri public/anonim bir okuma yüzeyini kapsamıyor; `widget.spec.ts` anonim ama widget oturumu (customer token) kuruyor, kimliksiz sayfa okuma senaryosu yok.
KAPSAM: `apps/e2e/tests/public-kb.spec.ts` — hikâye: ajan panelde makale oluşturur → taslakken public adres 404 → publish eder → OTURUMSUZ (storageState'siz) yeni browser context ile public adres açılır ve makale okunur → `<title>`/meta description/canonical doğrulanır → sitemap.xml yalnız o makaleyi listeler → ikinci bir tenant'ın workspaceSlug'ı ile aynı makale slug'ı 404 → unpublish sonrası public adres tekrar 404 ve sitemap'ten düşer. Ek: XSS regresyonu (gövdeye `<img onerror>` yazılıp public sayfada aktif etiket üretilmediğinin DOM'dan doğrulanması), JS kapalı davranışı (script engellenmiş context'te makale metni yine görünür), Lighthouse/başlangıç boyutu yerine basit NFR-P2 bütçesi ölçümü (yanıt süresi + gövde boyutu) HANDOFF kanıtına yazılır. Ayrıca `pnpm -w test` yarışına karşı: yeni DB testleri paket bazında SERİ koşulacak şekilde işaretlenir (proje hafızası: siyahtus-test-gate-parallel-db) ve e2e öncesi truncate+reseed (siyahtus-e2e-clean-db).
DOSYALAR: apps/e2e/tests/public-kb.spec.ts · apps/e2e/tests/fixtures.ts · apps/e2e/playwright.config.ts · HANDOFF.md
REFERANS DESEN (kopyalanacak): apps/e2e/tests/widget.spec.ts · apps/e2e/tests/playbook.spec.ts · apps/e2e/tests/global-setup.ts · apps/e2e/tests/fixtures.ts
KK (birebir): ""SEO'lu self-servis bilgi bankası (public KB)"" | "KK-türetilmiş: bu alt-görevin payı — kalemin tamamının tek senaryoda kanıtı: kimliksiz bir okuyucu, hiçbir ajanla temas kurmadan (self-servis), arama motorunun görebileceği bir adreste (SEO'lu), yalnızca yayınlanmış içeriği (public) okuyabilmelidir. Türetme gerekçesi: PRD §6'da KK satırı yok; §5.3'ün üç sıfatı (SEO'lu / self-servis / public) doğrudan üç e2e iddiasına çevrildi."
KK DOĞRULAMA: `public-kb.spec.ts`: 'public' → oturumsuz context 200 alır ve makaleyi okur; 'yalnız yayınlanan' → taslak ve unpublish sonrası 404; 'self-servis' → hiçbir chat/widget etkileşimi olmadan kategori→makale gezinmesi tamamlanır; 'SEO'lu' → `<title>`/meta description/canonical/sitemap kontrolü. Cross-tenant iddiası ayrı bir test bloğunda ikinci tenant fixture'ı ile.
KAPSAM DIŞI: Yeni özellik eklemek (bu alt-görev yalnız doğrular; bulunan hata ilgili alt-göreve geri döner) · Gerçek arama motoru indeksleme doğrulaması (dış servis — kapsam dışı) · Yük/performans testi (NFR-P2 yalnız tek-istek bütçesi olarak ölçülür) · Production deploy / DNS / TLS (§9)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
