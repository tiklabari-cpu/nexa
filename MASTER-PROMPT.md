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

## Git / Repo
- Remote: git@github.com:tiklabari-cpu/nexa.git (PRIVATE). İlk kurulum proje kökünde:
  `git init` → `git branch -M main` → `git remote add origin <url>` → .gitignore + ilk commit → push.
- İzolasyon: yalnız `nexa` reposuna scope'lu FINE-GRAINED PAT kullan; diğer projelerine
  teknik olarak dokunamaz. .env / secret / anahtar ASLA commit'lenmez (.gitignore ilk commit'te).
- Branch: `main` korunur; her dilim `feat/<slice>` dalında geliştirilir, bitince main'e merge.
- force-push YOK, history rewrite YOK, başka repoya dokunma YOK.
- Her dilim sonunda: commit + push (uzaktan yedek + ucuz resume).

## Çalışma Prensibi (DURMADAN)
1. PLAN.md (proje kökünde) oluştur: MVP kritik yolunu dikey dilimlere böl; her dilime zorluk
   etiketi koy ([XHIGH] veya [MAX] — bkz. Efor Kapıları). Tek doğruluk kaynağı bu; her dilim
   sonunda güncelle.
2. Her dilim sırayla: (a) OpenAPI+tip sözleşmesi → (b) Prisma migration → (c) backend servis +
   unit test → (d) frontend ekran + typed client → (e) integration/E2E test → (f) git commit + push.
3. Her commit'ten sonra doğrula: migration'lar koşsun, testler yeşil, sunucu ayağa kalksın,
   akışı Playwright/curl ile fiilen çalıştır. Kırmızıysa düzelt, geçmeden ilerleme.
4. ONAY İÇİN DURMA (efor kapıları hariç). Makul varsayımla ilerle, varsayımı PLAN.md'ye
   "Assumption:" olarak yaz. Bloke olursan (dış anahtar) dur ve mock'a geç.
5. Dış servisleri (Stripe, WhatsApp/Meta, LLM, SMTP) MOCK'la — arayüz + sahte sağlayıcı yaz.
   LLM için deterministik stub.
6. TEK ORKESTRATÖR: implementasyonu subagent'a dağıtma. Ana thread kendi araçlarıyla çalışır;
   çizgiyi PLAN.md + git + kökteki dokümanlar taşır.

## Efor Kapıları (model/efor geçişleri — ÖNEMLİ)
- Varsayılan efor: xhigh. Zor dilimleri PLAN.md'de [MAX] ile işaretle.
- Bir [MAX] dilime BAŞLAMADAN ÖNCE DUR ve şunu yaz: "▶ Bu dilim [MAX] gerektiriyor. Efor'u
  max'a al ve 'devam' yaz." ONAY GELMEDEN o dilime BAŞLAMA.
- [MAX] dilim bitince (kod + test yeşil + commit + push) tekrar DUR: "■ [MAX] dilim bitti +
  pushlandı. xhigh'a dönebilirsin." Sonraki [XHIGH] dilime otomatik geçme, onay bekle.
- [XHIGH] dilimler arasında durma, akıcı ilerle.
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
itibaren durmadan ilerle (efor kapılarına saygı göstererek).

