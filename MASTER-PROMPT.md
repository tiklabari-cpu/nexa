# Nexa — Otonom Geliştirme Görevi (Master Prompt)

> Referans dokümanlar ZATEN proje kökünde (`livechat` klasörü) ve mevcut alt klasörlerde
> (`v2-derin-analiz/`, `gorseller/`, `images/`). Onlar için YENİ klasör AÇMA; oldukları
> yerden oku. Kod bu kökün altına monorepo olarak kurulur; referans .md'ler kökte kalır.

## Rol ve Hedef
Bu projenin tek sorumlu senior full-stack mühendisisin. Hedef: kökteki PRD ve raporlara
dayanarak canlı-destek + AI müşteri hizmetleri platformu "Nexa"nın ÇALIŞAN bir sürümünü
sıfırdan, contract-first ve dikey dilimler halinde inşa etmek. MVP kritik yolunu uçtan uca
çalışır ve test edilmiş halde teslim et.

## Doğruluk Kaynakları (önce oku — hepsi proje kökünde)
- urun-gereksinim-dokumani-PRD.md — ANA kaynak (özellikler §6, veri modeli §8.4,
  akışlar §8.3, NFR §7, karmaşıklık §10.2).
- rapor-1-fonksiyonel.md — detaylı fonksiyonel spec (ekranlar/akışlar).
- rapor-2-teknik-mimari.md — DDL (§5.3), RTM iskeletleri (§7).
- v2-derin-analiz/v2-03-api-veri-referans.md — API kontratı, ~63 scope, 23 hata tipi, webhook.
- v2-derin-analiz/v2-01-fonksiyonel-ux-derin.md — UX/state/a11y detayı.
- v2-derin-analiz/v2-02-teknik-mimari-derin.md — RTM/SLO/kapasite.
- v2-derin-analiz/v2-04-guvenlik-uyumluluk.md — RLS/STRIDE/webhook HMAC.
- prd-yeterlilik-degerlendirmesi.md — boşluklar + kilit kararlar.
- KURAL: Şema için tek doğruluk = PRD §8.4 + rapor-2 §5.3. Eski LiveChat_ER_Diyagram.mermaid'i
  KULLANMA (çelişkili).

## Kilitli Teknik Kararlar (sorma, uygula)
- Dil: TypeScript her yerde (paylaşılan tipler için).
- Monorepo (proje kökünde): pnpm + Turborepo. packages/types (@nexa/types),
  packages/contract (OpenAPI), apps/api (Fastify), apps/rtm (WebSocket), apps/web (agent SPA),
  apps/widget (customer widget). Referans .md'ler kökte kalır, taşınmaz.
- Backend: Node + Fastify, Prisma + PostgreSQL (RLS ile multi-tenant), Redis (presence/
  rate-limit/pub-sub), pgvector (RAG).
- Realtime: WebSocket (ws), chat→thread→event modeli, reconnect + missed-event sync.
- Auth: OAuth 2.1 + PKCE, PAT (hash'li), customer token, scope enforcement (route+API).
- Frontend: React + Vite + Tailwind + shadcn/ui (Radix), TanStack Query, Zustand, typed API
  client OpenAPI'den generate.
- Contract-first: her özellik önce OpenAPI + @nexa/types → sonra backend → sonra frontend.

## Kilitli Kontrat & Ürün Kararları (ADR — sorma, uygula)
> Bunlar `prd-yeterlilik-degerlendirmesi.md` §5'teki açık kararların kilitlenmiş halidir.
> Kod yazarken bunları yeniden tartışma; sapman gerekirse PLAN.md'ye "Deviation:" yaz.

- **API kontrat şekli:** Resource-based REST `/api/v1/...`. Eylemler kaynak altında POST alt-yolu:
  `POST /api/v1/chats/{chatId}/events`, `.../transfer`, `.../deactivate`, `.../tags`.
  Orijinalin action yüzeyini (`/action/send_event`) TAKLİT ETME. Tek kaynak: `packages/contract`
  OpenAPI 3.1 → `@nexa/types` generate.
- **Hata zarfı:** `{ error: { type, message, request_id, details? } }`. 23 hata tipi v2-03'ten;
  HTTP status + `type` birlikte döner.
- **Rate limit (Redis sliding window, env ile override `RATE_LIMIT_*`):**
  agent token (PAT/OAuth) 180 req/dk (burst 30) · customer token 60 req/dk · RTM WS 10 msg/sn/bağlantı.
  429 → `Retry-After` (saniye) + `X-RateLimit-Limit/Remaining/Reset` başlıkları.
- **Routing atama algoritması (dilim 8):**
  1. Havuz = routing_rules hedef grubu ∩ `routing_status=accepting` ∩ aktif chat < `concurrent_chats_limit`
  2. `group_agents.priority` katmanına göre sırala (`primary` > `first` > `normal` > `last`)
  3. Dolu en yüksek katman içinde **en az yüklü** ajan (aktif chat sayısı)
  4. Eşitlik → en uzun süredir atama almayan (`last_assigned_at ASC`)
  5. Havuz boş → fallback grup; o da boş → kuyruk (`threads.queue_position`)
- **"AI resolution" tanımı (billing + Reports TEK sayaç):** thread kapanışında, o thread içinde
  `author_type='agent'` event YOKSA → 1 AI resolution; `usage_records(metric='ai_resolutions')`
  artırılır. Reports "Automated" aynı sorgudan beslenir.
- **Trial:** 14 gün. Bitince **salt-okuma** — veri okunur, yeni chat/ticket açılmaz, widget "offline"
  döner, veri SİLİNMEZ. Tam kilit yok.
- **Kuyruk/cache:** MVP'de Kafka/RabbitMQ YOK. Redis Streams (event fan-out) + pub/sub (presence)
  yeterli. Broker kararı v2'ye ertelendi — eklemek kapsam genişletmesidir, YAPMA.
- **Veri bölgesi:** MVP tek bölge. `region` alanı şemada immutable durur, tek değer (`eu`).
- **Fiyat:** PRD EK-C sabit — `unit_price_cents=9900`, `ai_resolutions_included=200`.
  Aşım birim fiyatı env (`AI_OVERAGE_CENTS`, varsayılan 50). Stripe MOCK.
- **Skill vs Workflow:** Tek paradigma = **Skill** (adım listesi). Görsel node/edge Workflow editörü
  v2'ye ertelendi; `workflows` tablosu şemada kalır ama UI YAZMA.

## Ortam (kurulu — tekrar kurma)
Node v24 (nvm) · pnpm 11 · Docker (daemon çalışıyor) · psql 18 · redis-cli 8 · gh · jq · make
Docker imajları önceden çekildi: `pgvector/pgvector:pg17`, `redis:7-alpine` — docker-compose'da
BUNLARI kullan, başka Postgres imajı seçme. Playwright Chromium önceden indirildi
(`npx playwright install` gereksiz, sadece `chromium` projesi kullan).

## Git / Repo
- Remote: https://github.com/tiklabari-cpu/nexa.git — **ZATEN KURULU** (git init + remote + ilk
  commit yapıldı, `main` uzak ile güncel, kimlik doğrulama Keychain'de). `git init` ETME,
  remote EKLEME. Sadece commit + push.
- **.gitignore İLK İŞ:** kod yazmadan önce oluştur (node_modules, .env*, dist, .turbo, coverage,
  playwright-report, *.log, .DS_Store). Repo şu an açık olabilir — .env / secret / anahtar
  ASLA commit'lenmez.
- İzolasyon: yalnız `nexa` reposuna dokun; başka repoya push etme.
- Branch: `main` korunur; her dilim `feat/<slice>` dalında geliştirilir, bitince main'e merge.
- force-push YOK, history rewrite YOK, başka repoya dokunma YOK.
- Her dilim sonunda: commit + push (uzaktan yedek + ucuz resume).

## Çalışma Prensibi (DURMADAN)
1. PLAN.md (proje kökünde) oluştur: MVP kritik yolunu dikey dilimlere böl; her dilime zorluk
   etiketi koy ([XHIGH] veya [MAX] — bkz. Zorluk Etiketleri). Tek doğruluk kaynağı bu; her dilim
   sonunda güncelle.
2. Her dilim sırayla: (a) OpenAPI+tip sözleşmesi → (b) Prisma migration → (c) backend servis +
   unit test → (d) frontend ekran + typed client → (e) integration/E2E test → (f) git commit + push.
3. Her commit'ten sonra doğrula: migration'lar koşsun, testler yeşil, sunucu ayağa kalksın,
   akışı Playwright/curl ile fiilen çalıştır. Kırmızıysa düzelt, geçmeden ilerleme.
4. ONAY İÇİN HİÇ DURMA — istisna yok. Dilim başında/sonunda, zorluk etiketi değişiminde,
   faz geçişinde onay isteme. Makul varsayımla ilerle, varsayımı PLAN.md'ye "Assumption:"
   olarak yaz. Bloke olursan (dış anahtar/erişim) durma; mock'a geç ve devam et.
5. Dış servisleri (Stripe, WhatsApp/Meta, LLM, SMTP) MOCK'la — arayüz + sahte sağlayıcı yaz.
   LLM için deterministik stub.
6. TEK ORKESTRATÖR: implementasyonu subagent'a dağıtma. Ana thread kendi araçlarıyla çalışır;
   çizgiyi PLAN.md + git + kökteki dokümanlar taşır.

## Zorluk Etiketleri (bilgi amaçlı — KAPI DEĞİL, DURMA YOK)
- Her dilime PLAN.md'de zorluk etiketi koy: [XHIGH] veya [MAX].
- Etiket YALNIZCA "burada daha dikkatli ol" sinyalidir; onay kapısı DEĞİLDİR.
  Hiçbir etiket geçişinde DURMA, soru sorma, onay bekleme, "devam?" diye sorma.
  Tüm dilimler arasında kesintisiz ilerle — [XHIGH]→[MAX] ve [MAX]→[XHIGH] dahil.
- [MAX] dilimlerde fazladan özen göster (durmadan): önce invariant/tehdit listesini yaz,
  negatif testleri (cross-tenant sızıntı, yetkisiz scope, reconnect'te event kaybı)
  pozitif testlerden ÖNCE kur, kritik yolu integration testiyle kanıtla. Bu dilimler
  daha uzun sürebilir — sorun değil, yine de durmadan devam et.
- [MAX] dilimler (PRD §10.2 High/Medium-High ile hizalı):
  * RTM WebSocket + reconnect/missed-event sync (High)
  * Tenant izolasyonu: RLS + TenantScopedRepository + cross-tenant negatif test (Medium-High)
  * OAuth 2.1 + PKCE + scope enforcement + token modeli (High)
  * chat→thread→event çekirdek model + invariant'lar (1-aktif-chat, partition, optimistic)
  * Routing/queue atama algoritması + concurrent limit + fallback (Medium-High)
  * Webhook güvenliği: HMAC-SHA256 + SSRF koruması (güvenlik akıl yürütmesi)
  * (v1) AI Agent skill motoru (NL→adım) + RAG orkestrasyonu (High)
- Diğer HER ŞEY [XHIGH]: bootstrap, CRUD, migration yazımı, inbox UI, composer, details,
  design system, reports overview, seed, testlerin yazımı.

## Faz — MVP Kritik Yol (sırayla; etiketler)
1. [XHIGH] Bootstrap: monorepo, DB+Redis script (make dev), health check, CI.
2. [MAX]   Auth + tenant izolasyonu (RLS + cross-tenant negatif test) + OAuth2.1/PAT + scope.
3. [MAX]   Veri modeli + migration (PRD §8.4) + invariant'lar + seed.
4. [MAX]   chat→thread→event + Agent Chat API (send_event, list_chats, start/resume/deactivate,
   transfer, tag).
5. [MAX]   RTM WebSocket (login/subscribe/push) + reconnect/missed-event sync.
6. [XHIGH] Customer widget (iframe loader + Customer Chat API + trusted domains).
7. [XHIGH] Inbox 3-pane (list/transcript/details) + composer (canned #, internal note, attach).
8. [MAX]   Routing + queue + concurrent limit + fallback team.
9. [XHIGH] Reports Overview (temel KPI) + Billing/metering iskeleti + trial.
10. [XHIGH] Design system + tüm ekranların tutarlı stillenmesi.

## Ön Yüz / Tasarım
- gorseller/mod-*.png ve images/real_*.png ekranlarını KOPYALAMA; ilham al. İki ürünü
  (text.com + livechat.com) PRD §8.1'deki tek IA altında birleştir.
- Önce design-brief.md (proje kökünde) üret: token'lar (renk, tipografi, spacing, radius,
  shadow, dark/light) + bileşen envanteri. Sonra tüm ekranlar bu token'lara göre. shadcn/ui
  tabanı → profesyonel, tutarlı, erişilebilir (WCAG 2.1 AA).

## "Bitti" Tanımı
- Tüm testler yeşil (unit+integration+E2E), tip-check + lint temiz.
- make dev tek komutla her şeyi ayağa kaldırıyor; README.md bunu anlatıyor.
- Seed veriyle demo akışı çalışıyor: müşteri widget'tan mesaj → routing → agent inbox'ta
  canlı → yanıt → arşiv.
- git log düzenli, anlamlı commit'ler; her dilim pushlanmış.

## Sınırlar (YAPMA)
- Production deploy, DNS/TLS, gerçek secret/kart/ödeme, force push, DB drop — YAPMA.
- Harcama gerektiren hiçbir şey. Dış servisleri mock'la.
- Referans .md/görselleri başka klasöre TAŞIMA; oldukları yerde bırak.

## Teslim Paketi
Çalışan monorepo + README.md (kurulum + mimari) + PLAN.md (ne bitti/ne kaldı) +
docker-compose.yml + seed + tüm testler + HANDOFF.md (durum özeti).

BAŞLA: önce doküman kaynaklarını oku, PLAN.md + design-brief.md üret, sonra Faz 1'den
Faz 10'a kadar hiç durmadan ilerle. Ara verme, onay isteme — sadece "Bitti" tanımı
karşılandığında dur.

