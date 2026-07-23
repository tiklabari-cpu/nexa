# PLAN.md — Nexa Geliştirme Planı

> **Tek doğruluk kaynağı.** Her dilim sonunda güncellenir.
> Şema doğruluk kaynağı: `urun-gereksinim-dokumani-PRD.md` §8.4 + `rapor-2-teknik-mimari.md` §5.3.
> `LiveChat_ER_Diyagram.mermaid` KULLANILMAZ (çelişkili — bkz. yeterlilik değerlendirmesi G8).

**Başlangıç:** 2026-07-22 · **Durum:** Dilim 1–10 ✅ (10/10) · F1–F6 düzeltmeleri ✅ (bkz. §1b)
**PRD Faz-0 (MVP) uyumu: 28 tam · 6 kısmi · 18 açık (52 gereksinim).**
Dilimlerin bitmesi MVP'nin bitmesi DEĞİLDİR — bkz. **§1a**.

---

## 0. Kilitli Kararlar (ADR — yeniden tartışılmaz)

| #      | Karar               | Değer                                                                                                                                 |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-01 | Dil                 | TypeScript her yerde                                                                                                                  |
| ADR-02 | Monorepo            | pnpm workspaces + Turborepo, proje kökünde                                                                                            |
| ADR-03 | Backend             | Node 24 + Fastify + Prisma + PostgreSQL 17 (pgvector) + Redis 7                                                                       |
| ADR-04 | API şekli           | Resource-based REST `/api/v1/...`; eylemler kaynak altında POST alt-yolu. Action yüzeyi (`/action/send_event`) taklit EDİLMEZ         |
| ADR-05 | Kontrat             | `packages/contract` OpenAPI 3.1 → `@nexa/types` generate (contract-first)                                                             |
| ADR-06 | Hata zarfı          | `{ error: { type, message, request_id, details? } }` — 24 tip (v2-03 §1.8 tablosu)                                                    |
| ADR-07 | Rate limit          | agent 180/dk (burst 30) · customer 60/dk · RTM WS 10 msg/sn/bağlantı. 429 → `Retry-After` + `X-RateLimit-*`. Env: `RATE_LIMIT_*`      |
| ADR-08 | Routing algoritması | havuz → priority katmanı (primary>first>normal>last) → en az yüklü → `last_assigned_at ASC` → fallback → kuyruk                       |
| ADR-09 | AI resolution       | thread kapanışında `author_type='agent'` event YOKSA +1 → `usage_records(metric='ai_resolutions')`. Reports "Automated" aynı sorgudan |
| ADR-10 | Trial               | 14 gün; bitince **salt-okuma** (veri silinmez, yeni chat/ticket yok, widget offline)                                                  |
| ADR-11 | Kuyruk              | Kafka/RabbitMQ YOK. Redis Streams (fan-out) + pub/sub (presence)                                                                      |
| ADR-12 | Bölge               | MVP tek bölge; `region` immutable, tek değer `eu`                                                                                     |
| ADR-13 | Fiyat               | `unit_price_cents=9900`, `ai_resolutions_included=200`, aşım `AI_OVERAGE_CENTS` (varsayılan 50). Stripe MOCK                          |
| ADR-14 | Skill vs Workflow   | Tek paradigma = **Skill** (adım listesi). `workflows` tablosu şemada kalır, UI YOK                                                    |
| ADR-15 | RTM zarfı           | Orijinalle uyumlu: `{request_id, action, payload}` → `{request_id, action, type:'response'\|'push', success, payload}`                |

---

## 1. Dikey Dilimler (MVP kritik yol)

Her dilim: (a) OpenAPI+tip → (b) Prisma migration → (c) backend servis + unit test → (d) frontend + typed client → (e) integration/E2E → (f) commit + push.

| #   | Dilim                                                                                    | Zorluk | Branch                    | Durum |
| --- | ---------------------------------------------------------------------------------------- | :----: | ------------------------- | :---: |
| 1   | Bootstrap: monorepo, DB+Redis, `make dev`, health check, CI                              | XHIGH  | `feat/01-bootstrap`       |  ✅   |
| 2   | Auth + tenant izolasyonu (RLS + cross-tenant negatif test) + OAuth2.1/PKCE + PAT + scope |  MAX   | `feat/02-auth-tenant`     |  ✅   |
| 3   | Veri modeli + migration (PRD §8.4) + invariant'lar + seed                                |  MAX   | `feat/03-data-model`      |  ✅   |
| 4   | chat→thread→event + Agent Chat API                                                       |  MAX   | `feat/04-chat-core`       |  ✅   |
| 5   | RTM WebSocket + reconnect/missed-event sync                                              |  MAX   | `feat/05-rtm`             |  ✅   |
| 6   | Customer widget (iframe loader + Customer Chat API + trusted domains)                    | XHIGH  | `feat/06-widget`          |  ✅   |
| 7   | Inbox 3-pane + composer                                                                  | XHIGH  | `feat/07-inbox`           |  ✅   |
| 8   | Routing + queue + concurrent limit + fallback                                            |  MAX   | `feat/08-routing`         |  ✅   |
| 9   | Reports Overview + Billing/metering + trial                                              | XHIGH  | `feat/09-reports-billing` |  ✅   |
| 10  | Design system + tüm ekranların tutarlı stillenmesi                                       | XHIGH  | `feat/playbook`           |  ✅   |

Durum: ⬜ başlamadı · ⏳ devam · ✅ bitti (test yeşil + push)

> ⚠️ **Bu tablo "MVP bitti" demek DEĞİLDİR.** §1'deki 10 dilim, PRD'nin Faz-0 kapsamının
> tamamı değil, benim seçtiğim bir kritik yol kesitidir. Gerçek uyum §1a'da.

---

## 1a. PRD Faz Uyumu (izlenebilirlik) — 2026-07-23 denetimi

**Neden bu bölüm var.** §1'deki dilimler PRD'den türetilmişti ama zamanla PRD fazlarından
ayrıştı: `Dilim 10` altında teslim edilen **Playbook aslında PRD'de v1'dir**
(`FR-MOD-05.x → Must (v1)`, §5.2), buna karşılık **MVP etiketli 18 gereksinim hiç yazılmadı**.
Yani bir v1 özelliği öne çekilirken Faz-0'da delik kaldı. Bu bölüm o deliği görünür tutar.

**Yöntem:** PRD §6'daki 138 `FR-MOD` satırından `Must/Should (MVP*)` etiketli **52** tanesi
alındı; her biri PLAN.md'nin iddiasına değil **koda** karşı kontrol edildi
(route listesi, `openapi.yaml` path'leri, `schema.prisma` modelleri, `apps/web/src/features/`).

### Açık MVP gereksinimleri (kod yok)

| PRD | Gereksinim | Öncelik | Kanıt / durum |
| --- | --- | --- | --- |
| FR-MOD-02.1.3 | Tickets grubu (All/Unassigned/My open) | Must (MVP temel) | `Ticket` modeli var (schema:467), route/UI **yok** |
| FR-MOD-02.6 | Create ticket from chat | Must (MVP) | Reopen var (`/chats/{id}/resume`), ticket üretimi yok |
| FR-MOD-08.5.3 | Email (forwarding → ticket) | Must (MVP) | yok |
| FR-MOD-00.2 | Signup + 14 gün trial başlatma | Must (MVP) | `/auth` altında signup endpoint yok — hesaplar yalnız seed'den |
| FR-MOD-00.3 | Forgot password (süreli token) | Must (MVP) | yok |
| FR-MOD-00.4 | Onboarding sihirbazı | Should (MVP) | yok |
| FR-MOD-04.3.1 | Copy invite link | Must (MVP) | yok |
| FR-MOD-04.4 | Invite teammates modal | Must (MVP) | yalnız UI metni (`TeamPage.tsx:109`), akış yok |
| FR-MOD-08.5.1 | All channels kart gridi | Must (MVP) | yok |
| FR-MOD-08.5.2 | Website widgets CRUD | Must (MVP) | `Website` modeli var (762), endpoint yok |
| FR-MOD-08.5.9 | Chat page (hosted link) | Must (MVP) | yok |
| FR-MOD-08.9.4 | File sharing (tür/boyut + tarama) | Must (MVP) | yalnız `attachment_url` alanı; upload/doğrulama yok |
| FR-MOD-10.1.1 | Plan + Change plan | Must (MVP) | yalnız okuma (`/billing/subscription`) |
| FR-MOD-10.1.2 | Billing cycle (Monthly/Annual) | Must (MVP) | yok |
| FR-MOD-10.1.3 | Users stepper | Must (MVP) | yok |
| FR-MOD-10.1.6 | Subscription summary + ödeme | Must (MVP) | yok |
| FR-MOD-11.2 | Greeting card + quick replies | Must (MVP) | widget'ta launcher/composer var, greeting yok |
| FR-MOD-13.8 | Notifications (ses/masaüstü) | Must (MVP) | yok |

### Kısmi (çekirdek var, PRD kapsamı tamamlanmamış)

| PRD | Eksik kalan |
| --- | --- |
| FR-MOD-02.3.5 | Composer'da `#` canned + emoji var; **attach yok** (08.9.4'e bağlı) |
| FR-MOD-08.7.1 | Chat başına etiketleme var; **etiket kütüphanesi CRUD'u** (settings) yok |
| FR-MOD-07.1 | Overview var; AI Agent / Metrics breakdown sekmeleri yok |
| FR-MOD-03.1.1 | Customers listesi var; Real-time sekmeleri (Chatting/Queued/Waiting) yok |
| FR-MOD-11.3 | Bot kimliği var; yapılandırılabilir persona yok |
| FR-MOD-01.1.3 | ⌘K komut paleti yok (Must MVP temel) |

### Faz ihlali (kayıt)

- **Playbook + RAG (`packages/ai-mock`, `/skills`, `/knowledge-sources`)** → PRD'de **v1**
  (`§5.2`, `FR-MOD-05.x/06.x`). MVP'den önce teslim edildi. Geri alınmıyor (çalışıyor ve
  test edilmiş), ama Faz-0 kapanmadan başka v1 işi alınmayacak.

### Sıradaki dilimler (PRD Faz-0'ı kapatmak için)

| #   | Dilim | Kapsadığı PRD | Gerekçe |
| --- | --- | --- | --- |
| 11  | **Ticketing çekirdeği** | 02.1.3, 02.6, 08.5.3 | PRD §5.1 MVP amacını *"canlı sohbet **+ temel ticketing** çekirdeği"* diye tanımlıyor. Tek en büyük delik. Ayrıca **bugün görünür bir kusur**: `customer-service.ts` `tickets_count` sayıyor ve bu sayı hiçbir zaman 0'dan büyük olamıyor. |
| 12  | **Hesap yaşam döngüsü** | 00.2, 00.3, 00.4, 04.3.1, 04.4 | Ürün şu an kendi kendine hesap üretemiyor; her şey seed'e bağlı. Trial (ADR-10) signup olmadan test edilemez. |
| 13  | **Kanallar + dosya** | 08.5.1, 08.5.2, 08.5.9, 08.9.4, 11.2 | Widget'ın kurulum yüzeyi ve müşteriye ilk dokunuş (greeting). 08.9.4 güvenlik şekli taşıyor (tür/boyut/tarama). |
| 14  | **Checkout + bildirim + ⌘K** | 10.1.x, 13.8, 01.1.3, 08.7.1 | Trial→ücretli dönüşüm yolu (PRD çıkış kriteri: ≥%8) ve kalan shell parçaları. |

---

## 2. Dilim Detayları

### Dilim 1 — Bootstrap [XHIGH] ✅

**Teslim edildi (2026-07-22):** 78 unit test yeşil · typecheck 8/8 · lint 6/6 · format temiz ·
`make dev` çalışıyor · API+RTM `/health` 200 (db+redis canlı) · WS handshake doğrulandı
(ping→pong, bilinmeyen action reddi, `organization_id`'siz upgrade 400) · widget loader
1.09 KB gzip (bütçe 50 KB).

- pnpm workspace + Turborepo; `packages/types`, `packages/contract`, `packages/config`, `apps/api`, `apps/rtm`, `apps/web`, `apps/widget`
- `docker-compose.yml`: `pgvector/pgvector:pg17` + `redis:7-alpine` (başka imaj YOK)
- `Makefile`: `make dev` tek komut (docker up → migrate → seed → tüm app'ler)
- `GET /health` (api) + `GET /health` (rtm) → `{status, db, redis, version}`
- CI: GitHub Actions — typecheck + lint + unit test + build
- Kabul: `make dev` ayakta, `/health` 200, CI yeşil

### Dilim 2 — Auth + Tenant İzolasyonu [MAX] ✅

**Teslim edildi (2026-07-22):** 203 test yeşil (120 unit + 83 integration) · typecheck/lint/format temiz ·
migration drift yok · uçtan uca doğrulandı (login → PKCE authorize → token → /auth/me, seed'lenmiş
iki kiracıyla; Acme token'ı Northwind'e ulaşamıyor).

**Kanıtlanan invariant'lar:**

- `nexa_app` rolü superuser DEĞİL, tablo sahibi DEĞİL → RLS gerçekten uygulanıyor (test bunu doğruluyor)
- Tenant context yoksa **0 satır** (fail-closed); cross-tenant read/update/delete/insert hepsi bloklu
- `SET LOCAL` transaction dışına sızmıyor (hata durumunda bile)
- Token'lar yalnız hash olarak saklanıyor; PAT düz metni tek seferlik dönüyor
- Authorization code tek kullanımlık; replay → ürettiği token'lar da iptal
- Refresh rotation + reuse → tüm aile iptal
- Rol/suspend değişikliği mevcut token'lara anında yansıyor
- Zayıf session güçlü PAT üretemiyor (privilege escalation kapalı)
- Customer token agent yüzeyine ulaşamıyor (404, 403 değil)
- `public: true` + `scopes` kombinasyonu boot'ta hata veriyor

**Kapsam notu:** `customers` ve `trusted_domains` tabloları dilim 3'ten dilim 2'ye alındı —
`/customer/token`'ın trusted-domain kontrolü onlarsız uygulanamaz ve test edilemezdi.

**Invariant'lar / tehditler (önce yaz):**

- I1: Hiçbir sorgu `license_id`/`organization_id` filtresi olmadan veri döndüremez (RLS son savunma)
- I2: Token düz metin saklanmaz (argon2id hash)
- I3: Scope yetersizse route çalışmaz (403 `authorization`), kaynak enumeration'da 404
- I4: Customer token Customer Chat API dışına çıkamaz
- T1: Cross-tenant IDOR (kısa base32 ID tahmini)
- T2: PKCE downgrade / code replay
- T3: Refresh token rotation eksikliği

**Negatif testler (pozitiften ÖNCE):** org A token'ı ile org B chat okuma → 404; scope'suz `chats--all:rw` çağrısı → 403; RLS bypass denemesi (raw query, `app.current_license` set edilmemiş) → 0 satır; `code_verifier` yanlış → `invalid_grant`; kullanılmış code tekrar → reddedilir.

- OAuth 2.1 Authorization Code + PKCE (S256, verifier 43–128), refresh rotation, access TTL ≤1 saat
- PAT: `Basic base64(account_id:PAT)`; bot token; customer token (cookie grant, kısa TTL, org-scoped)
- Scope modeli: `resource--access:permission` (v2-03 §8.5 tam liste)
- `TenantScopedRepository` + PostgreSQL RLS (`current_setting('app.current_license')`)

### Dilim 3 — Veri Modeli [MAX] ✅

**Teslim edildi (2026-07-22):** 240 test yeşil (120 unit + 120 integration) · 39 tablo ·
tümünde RLS · drift yok · seed iki kiracı + gerçekçi transcript üretiyor.

**Veritabanının kendi başına koruduğu invariant'lar (uygulama koduna güvenmeden):**

- `uq_one_active_chat` — lisans+müşteri başına 1 aktif chat. **Yarış testiyle** kanıtlandı:
  8 eşzamanlı `start_chat` → tam olarak 1 tanesi başarılı.
- `uq_one_active_thread` — chat başına 1 aktif thread.
- `threads_closed_consistency_check` — aktif+kapalı çelişkisi imkânsız.
- `uq_one_fallback_routing_rule` — lisans+kind başına 1 fallback.
- `events` aylık RANGE partition + otomatik partition üretimi + DEFAULT partition
  (saat kayması olan mesaj kaybolmaz, bulunabilir bir yere düşer). Partition pruning
  EXPLAIN ile doğrulandı.
- `events → threads` FK (ON DELETE CASCADE) — **testte bulundu:** FK yokken chat silinince
  event satırları yetim kalıyordu (GDPR silme talebi için gerçek sorun).
- `audit_log` append-only: `UPDATE`/`DELETE` hem policy hem GRANT seviyesinde reddediliyor.
- pgvector ivfflat + boyut doğrulaması (1536 dışındaki embedding reddediliyor).

- PRD §8.4'teki 30+ tablo, rapor-2 §5.3 DDL'e birebir
- `events` aylık RANGE partition + otomatik partition üretimi
- `uq_one_active_chat` kısmi unique index
- `knowledge_chunks` pgvector ivfflat
- Tüm CHECK kısıtları; RLS politikaları tüm tenant tablolarında
- Seed: 2 organizasyon (cross-tenant test için), gruplar, ajanlar, müşteriler, örnek chat/thread/event, canned responses, tags, routing rules

### Dilim 4 — chat→thread→event + Agent Chat API [MAX] ✅

**Teslim edildi (2026-07-22):** 290 test yeşil (120 unit + 170 integration) ·
uçtan uca doğrulandı: widget token → agent chat başlatır → müşteri yanıtlar →
internal note → arşiv → resume (yeni thread) → cross-tenant 404.

**Kanıtlanan invariant'lar:**

- Internal note (`recipients='agents'`) müşteri transcript'inde **yok** — SQL'de filtreleniyor,
  sonradan atılmıyor (aksi halde kısa sayfa müşteriye "burada bir not var" bilgisini sızdırırdı).
- Müşteri internal note **yazamıyor** — reddetmek yerine `all`'a düşürülüyor.
- Idempotency: aynı `idempotency_key` ile tekrar → orijinal event (200), yeni satır yok.
  Kiracılar arası key çakışması yok.
- 12 eşzamanlı `send_event` → 1..12 arası **benzersiz ve boşluksuz** sequence
  (`UPDATE … RETURNING`; read-then-write çakışırdı).
- Kapalı sohbete yazma → 409 `chat_inactive`.
- Ajan yalnız üyesi olduğu takımın sohbetlerini görüyor; takımdan çıkarılınca **anında** kaybediyor.
- Kendisine kişisel transfer edilen sohbeti takım değişse de görmeye devam ediyor.
- Boş takıma transfer → 409 `group_offline` (müşteri sahipsiz kalmıyor).
- `after_event_id` ile replay (dilim 5'in kayıpsız reconnect primitifi) — sequence sırasına göre,
  timestamp'e göre değil.

**Kapsam notu:** Müşterinin kendi sohbetini okuma/yazma yüzeyi dilim 6'dan öne alındı —
internal note sınırı ancak iki taraf da varken kanıtlanabilirdi.

**Invariant'lar:** lisans+müşteri başına 1 aktif chat · aktif olmayan chat'e event yazılamaz (`chat_inactive`) · `recipients='agents'` event müşteriye gitmez · event id monotonik/idempotent · optimistic concurrency.

- `POST /api/v1/chats` (start) · `GET /api/v1/chats` (list) · `POST /api/v1/chats/{id}/events` · `.../deactivate` · `.../resume` · `.../transfer` · `.../tags` · `GET /api/v1/chats/{id}`

### Dilim 5 — RTM WebSocket [MAX] ✅

**Teslim edildi (2026-07-22):** 332 test yeşil (120 unit + 212 integration; 42'si RTM) ·
canlı doğrulandı: REST send → push **13 ms**, socket düşür → 3 mesaj gel → reconnect + sync →
**hiçbiri kaybolmadı**.

**Mimari:** API soketle konuşmaz. Redis'e zarf yayınlar; zarf _hem_ payload'ı _hem_ izleyici
kitlesini (audience) taşır. Gateway aptaldır: yetki kararı vermez, çünkü tenant context'i ve
takım üyeliği görünürlüğü yoktur — vereceği her karar tahmin olurdu. Tek kendi kontrolü:
zarfın lisansı bağlantının lisansıyla eşleşmeli.

**Kanıtlanan invariant'lar:**

- **Kayıpsız reconnect:** cursor = event id içindeki sequence. Timestamp KULLANILMAZ —
  aynı milisaniyede birden çok event olabilir ve süreçler arası saat farkı vardır.
  Test: aynı `createdAt`'li 12 event doğru sırada replay ediliyor.
- Replay üst sınırı 200/chat; aşılırsa `truncated: true` (istemci transcript'i yeniden çeker).
  Sınırsız replay hem istemciyi boğar hem gateway'i sınırsız allocate ettirir.
- Bağlantı kopukken **kazanılan** chat `new_chat_ids`'te bildiriliyor (geçmişi replay edilmiyor);
  **kaybedilen** chat `removed_chat_ids`'te.
- Cursor eski bir thread'i işaret ediyorsa → `truncated` (0'dan replay uzun sohbette istemciyi boğardı).
- Internal note müşterinin **replay'inde de** yok — reconnect sızıntı yolu olmuyor.
- Cross-tenant: başka kiracının chat'i ne replay ediliyor ne de varlığı doğrulanıyor.
- Fan-out: takım dışı ajana gitmiyor · müşteriye agent-only push gitmiyor ·
  abone olunmayan push gitmiyor · bozuk bus mesajı soketi düşürmüyor.
- Socket üzerinden chat mutasyonu reddediliyor — aynı invariant'ların iki implementasyonu olmaz.

**Invariant'lar:** reconnect'te event kaybı YOK (`sync` son event id'den) · login 30sn · ping 15sn · 10 pending/soket · fan-out yalnız yetkili ajanlara.

- `login` → `subscribe` → push (`incoming_chat`, `incoming_event`, `chat_deactivated`, `chat_transferred`, `incoming_typing_indicator`, `routing_status_set`, `queue_positions_updated`)
- Redis pub/sub fan-out; missed-event sync testi

### Dilim 6 — Customer Widget [XHIGH] ✅

**Teslim edildi (2026-07-22):** 379 test yeşil (120 unit + 259 integration) ·
widget bundle **5.3 KB gzip** (bütçe 50 KB) · loader 1.09 KB.

- Customer Chat API ayrı yüzey (`/customer/chat*`) — agent route'larını filtreleyerek
  yeniden kullanmak, oraya eklenen her yeni alanın biri hatırlayana kadar widget'a
  açık kalması demekti.
- Tek çağrıda tüm widget durumu (online, chat, events, queue position) — yavaş
  bağlantıda panelin sohbet dolu mu boş mu açıldığı farkı.
- Mesaj gönderme tek endpoint: ziyaretçi açısından "başlat" ve "gönder" farkı yok;
  istemciye karar verdirmek iki ilk mesajın yarışmasına davetiye.
- Framework yok, düz DOM — 50 KB bütçesinde React tek başına 3 katı.
- `textContent` her yerde; `innerHTML` eslint'te yasak (NFR-S6).
- Ajan yokken dürüst "kimse müsait değil" mesajı — sahte umut kısa beklemeyi
  terk edilmiş sohbete çevirir.
- WebSocket yerine 4 sn polling: uyuyan laptop / kopuk mobil ağda sessizce ölmeyen
  ve ziyaretçi için ayırt edilemez olan seçenek.

- Async loader snippet + cross-origin iframe; < 50KB hedefi
- Customer Chat API: token, start_chat, send_event, RTM customer socket
- Trusted domains allowlist; HTML escape (asla innerHTML)

### Dilim 7 — Inbox 3-pane [XHIGH] ✅

**Teslim edildi (2026-07-22):** tarayıcıda uçtan uca doğrulandı —
giriş → 3-pane inbox → widget'tan gelen mesaj **sayfa yenilemeden** transcript'e düştü →
internal note gönderildi → müşteri onu görmüyor, ajan görüyor.

- Design-brief token'ları doğrudan uygulandı (dilim 10'un bir kısmı buraya alındı;
  arayüzü önce stilsiz kurup sonra boyamak iki kez iş demekti).
- RTM push'ları **aynı React Query cache'ine** yazılıyor — paralel "canlı olaylar"
  listesi tutup render'da birleştirmek, duplike ve sırasız mesajın kaynağıdır.
- Event id ile dedupe: push ve refetch aynı olayı getirebilir; optimistic placeholder
  gerçeğiyle değiştiriliyor.
- Internal note modu ayırt edilemez olamaz: amber composer + "Only your team will see this"
  - baloncukta açık etiket. Buradaki pahalı hata notu müşteriye göndermektir.
- Auto-scroll yalnız zaten en alttaysa takip ediyor — geçmişi okuyan ajanı yukarıdan
  koparmak, kaçırılan scroll'dan kötüdür.
- Reconnect: `RtmClient` chat başına son event id'yi tutuyor, her yeniden bağlanmada
  `sync` ile replay ediyor; backoff jitter'lı (sunucu restart'ında tüm ajanların
  aynı anda dönmesi kesintiyi uzatır).

- Sol: Chats grubu (All/My/Queued/Unassigned/Archive) canlı sayaç
- Orta: liste (virtualized) + transcript (reverse infinite scroll)
- Sağ: Details paneli
- Composer: Reply/Internal note, canned `#`, attach, optimistic send

### Dilim 8 — Routing [MAX] ✅

**Teslim edildi (2026-07-22):** 358 test yeşil (120 unit + 238 integration; 26'sı routing).
**Sıra değişikliği:** widget'tan (dilim 6) önce yapıldı — widget'tan gelen sohbetin
gerçekten yönlendirilmesi için routing bir ön koşul.

**ADR-08 algoritması, adım adım test edildi:**

- Kural eşleşmesi > fallback; kuraldaki **tüm** koşullar sağlanmalı
  ("pricing sayfası VE UK" → UK'den anasayfaya giren eşleşmez).
- Priority katmanı (primary>first>normal>last), **dolu katman atlanıyor**:
  primary doluysa chat kuyruğa değil `first`'e gidiyor.
- Katman içinde en az yüklü; eşitlikte `last_assigned_at ASC`.
  **Adalet testi:** 3 ajana 6 sohbet → tam olarak 2/2/2.
- `concurrent_chats_limit` asla aşılmıyor — limit doluysa kuyruk.
  (Limit üstü sessiz atama, müşterinin görmezden gelinmesinin yoludur.)
- Fallback takım: eşleşen takım doluysa devreye giriyor.
- Kuyruk: chat kapanınca **ve** ajan `accepting_chats` olunca boşalıyor.
  Aksi halde boş ekrana dönen ajan otururken müşteri bekliyor.
- Kuyruk numaraları bitişik tutuluyor (renumber) — "4. sıradasınız" derken üç kişi olması güveni yıkar.
- Bir kuyruk girdisi atanamıyorsa **sıra bozulmuyor** (drain duruyor, atlamıyor).
- Silinmiş takım id'si yok sayılıyor (eski widget snippet'i müşteriye ceza olmamalı).
- Cross-tenant: başka lisansın ajanı asla atanmıyor.

- ADR-08 algoritması; concurrent limit; fallback grup; kuyruk pozisyonu
- Negatif testler: limit dolu → kuyruk; tüm gruplar offline → `groups_offline`

### Dilim 9 — Reports + Billing [XHIGH] ✅

**Teslim edildi (2026-07-22):** 398 test yeşil (120 unit + 278 integration).

- **ADR-09 tek tanım:** "AI resolution" = kapanışta `author_type='agent'` event'i olmayan thread.
  Reports "Automated" ve fatura sayacı **aynı** predicate'i okuyor; test ikisinin eşitliğini
  doğruluyor. Anlaşacağı varsayılan iki sayaç er ya da geç ayrışır ve bunu ilk fark eden
  faturayı itiraz eden müşteri olur.
- Kapanışta sayılıyor, artımlı bayrakla değil: ajan sonradan katılınca bayrağı doğru
  temizlemek gerekirdi, yanlış yapınca insanın yaptığı işi müşteriye faturalardınız.
- `automated_rate` **kapanmış** sohbetlere göre — açık sohbet henüz çözülmedi; toplam
  üzerinden hesaplamak inbox yoğunlaştıkça oranı düşürürdü.
- CSAT oyu yoksa `null`, %0 değil: oylanmamış dönem _bilinmiyor_, felaket değil.
- **ADR-10 trial:** süresi dolunca **salt-okuma** — veri okunabilir, silinmez, dışa aktarılabilir.
  Yazma → 402 `license_expired`. `/auth/*` açık kalıyor: çıkış ve token iptalini engellemek
  "lütfen ödeyin"i "kapana kısıldınız"a çevirir.
- License gate route bazında değil hook olarak: "şu bir endpoint'i unuttuk" bedava katmanın
  sessizce sınırsız olma yoludur.
- Kota %80'de uyarı (PRD §8.3 akış 5).

### Dilim 10 — Design System [XHIGH] ◐ kısmi

Token sistemi, Tailwind eşlemesi ve a11y kuralları var; inbox baştan sona bunları kullanıyor
(hiçbir bileşende sabit renk yok). Eksik olan **uygulanacak diğer ekranlar**: Customers, Team,
Playbook, Reports, Settings — API'leri var, UI'ları yok. Icon rail bunları devre dışı
gösteriyor, var gibi davranmıyor. Detay: HANDOFF.md.

- Overview KPI: total chats, chats/agent, avg first response, CSAT, automated (ADR-09)
- `usage_records` metering; trial gün sayacı; salt-okuma modu (ADR-10); Stripe mock

### Dilim 10 — Design System [XHIGH]

- `design-brief.md` token'ları → Tailwind config + shadcn/ui
- Tüm ekranlar tek dile; WCAG 2.1 AA

---

## 1b. Dilim sonrası düzeltmeler

### F1 — Kontrat kayması kapatıldı (2026-07-23) ✅

**Bulgu:** ADR-05 "contract-first" diyor, ama dilim 6, 8 ve 9 route'ları doğrudan
`apps/api/src/routes/`'a yazıp `packages/contract/openapi/`'ye dokunmamış. **10 endpoint
kontratsız kalmış** — dolayısıyla üretilmiş tipleri ve dokümantasyonu da yok. Hiçbir test
bunu yakalamadı, çünkü testler route'ları doğrudan çağırıyordu.

Kontratsız kalan yüzey: `/reports/overview` · `/billing/subscription` · `/billing/usage` ·
`/agents` · `/agents/me/routing-status` · `/groups` · `/customer/chat` (+ `/events`,
`/close`, `/rating`).

**Düzeltme:**

- 3 yeni path dosyası (`paths/agents.yaml`, `paths/reports.yaml`, `paths/customer-chat.yaml`)
  \+ 6 yeni şema (`Agent`, `Group`, `UsageSummary`, `ReportsOverview`, `CustomerChatState`,
  `CustomerMessageResult`) + `Customer` tag'i. Kontrat 18 → **28 path**.
- **Asıl düzeltme kaymayı tekrar imkânsız kılan test:** `contract-parity.test.ts` Fastify'ın
  router'ını `printRoutes` ile okuyup kontratla **iki yönlü** karşılaştırıyor — belgelenmemiş
  route da, karşılığı olmayan kontrat maddesi de hata veriyor. Ayrıca: `operationId` tekilliği
  (openapi-typescript tipleri buna göre anahtarlıyor, çakışma sessizce üzerine yazardı) ve
  public olmayan her operasyonda 4xx tanımı.
- Parser'ın sessizce boş küme üretip iki tarafı da "eşit" göstermesine karşı taban kontrolü.

CI zaten üretilmiş tiplerin bayatlığını kontrol ediyordu; ama spec'in **kendisi** eksik olduğu
için o kapı bunu yakalayamazdı. Parity testi bu boşluğu kapatıyor.

### F2 — Kalıcı kabuk + API'si hazır modül ekranları (2026-07-23) ✅

Dilim 10'un "uygulanacak ekran yok" boşluğunun API'si zaten var olan kısmı kapatıldı.
**414 test yeşil** (131 unit + 283 integration); tarayıcıda seed veriyle uçtan uca doğrulandı.

- **`AppShell`** — kalıcı icon rail + `react-router` ile deep-link'lenebilir rotalar
  (`/app/inbox`, `/app/team`, `/app/reports`, `/app/billing`). PRD §8.1 rota semantiği:
  ajanın baktığı ekranın linkini meslektaşına gönderebilmesi ve reload'un onu inbox'a
  düşürmemesi gerekiyor. UI'ı olmayan modüller **gizlenmiyor, devre dışı** gösteriliyor —
  gizlemek "bu üründe yok" der, devre dışı "henüz burada değil" der; doğrusu ikincisi.
- **Reports** (`/reports/overview`) · **Team** (`/agents` + `/groups`) ·
  **Billing** (`/billing/subscription` + `/billing/usage`).
- Bilinmeyen ile sıfır ayrı gösteriliyor: oylanmamış dönem `—`, %0 değil. `formatX`
  fonksiyonları `null`'ı `null` döndürüyor, sıfıra çevirmiyor.

**Yolda bulunan hata (tarayıcıda, testte değil):** hesap menüsü kapalı `<details>`'in
çocuklarını tarayıcının gizlemesine güveniyordu. Panel `position: absolute` olunca bu kural
tutmuyor: 224×130'luk kutusunu koruyor, erişilebilirlik ağacında çalışan bir "Sign out" ile
kalıyor, sadece içeriğin **arkasına** boyanıyor — ekranda yok, ekran okuyucuda ve tab
sırasında tamamen var. `hidden group-open:block` ile açıkça gizlendi; `<summary>`'ye
`role="button"` + `aria-expanded` eklendi (çıplak `<summary>` "generic" olarak duyuruluyordu,
yani ne açtığı ne de açık olup olmadığı belliydi).

> **Test dürüstlüğü notu:** ilk yazdığım görünürlük testleri bu hatayı yakalamıyordu —
> jest-dom'un `toBeVisible()` fonksiyonu kapalı `<details>` altındaki öğeleri CSS'ten
> bağımsız "gizli" sayıyor ve jsdom stylesheet yüklemiyor. Hatayı geri koyup testlerin yine
> geçtiğini görerek doğruladım. Regresyonu asıl tutan, tarayıcının fiilen uyduğu mekanizmayı
> (`hidden` + `group-open:block` sınıfları) sabitleyen ayrı bir test; o test hata geri
> konunca kırılıyor.

### F3 — Playwright E2E paketi + widget yolunun onarımı (2026-07-23) ✅

"Bitti" tanımının son açık maddesi kapandı: `apps/e2e` (Playwright, chromium) **10 test**.
CI'daki koşullu e2e job'ı artık gerçekten çalışıyor.

**Kapsam:** ana demo akışı tek tarayıcı oturumunda — ziyaretçi widget'tan yazar → routing atar →
ajan **sayfa yenilemeden** görür → yanıtlar → ziyaretçi yanıtı görür → internal note eklenir ve
ziyaretçide **görünmediği** doğrulanır → arşivlenir. Ayrı context'ler: ziyaretçi ve ajan farklı
kişiler, storage paylaşmaları birindeki hatayı diğerinde maskeler.

**Paket yazılırken bulunan gerçek hatalar (hepsi tarayıcı seviyesinde, alt katmanlar göremezdi):**

- **Widget hiç kimlik alamıyormuş.** Loader iframe'i `allow-same-origin` olmadan
  oluşturuyordu → doküman opak kökenli → her istek `Origin: null` taşıyor → API token
  vermiyor. Tarayıcıda kanıtlandı (`self.origin === "null"`, 403). Unit testler geçiyordu
  (jsdom köken modellemiyor), integration testler geçiyordu (API'yi düzgün Origin ile
  doğrudan çağırıyorlar).
- **Trusted-domain kontrolü uygulanamaz durumdaydı.** Token isteği iframe'den geliyor;
  iframe'in kökeni Nexa'nın kendi widget kökeni, yani **her müşteri için aynı**. Hangi
  sitenin sohbeti açtığını asla söyleyemezdi. Artık host sayfanın kökenini yalnız o sayfada
  çalışan loader biliyor ve `host_origin` olarak aktarıyor. Bunun bir **yapılandırma**
  kontrolü olduğu, kimlik doğrulama sınırı olmadığı kontratta açıkça yazıldı — doğrudan API
  çağıran herkes istediği host'u iddia edebilir; asıl sınır token'ın tek ziyaretçinin kendi
  konuşmasına kapsanmış olması.
- **Launcher paneli kapatıyordu.** Panel açıkken launcher düğmesi composer'ın Send düğmesinin
  üstünde kalıyor ve tıklamayı yutuyordu — panel düzgün görünüyor, mesaj gitmiyor.
- **`Availability` etiketi select'e bağlı değildi** (`htmlFor` yok). Ajanın iş alıp almadığını
  belirleyen kontrol, ekran okuyucuda isimsizdi.
- **`.localhost` reddediliyordu.** Seed her demo kiracıya `<tenant>.localhost` veriyor ama
  `originHost` http'yi yalnız düz `localhost` için kabul ediyordu — seed'lenen widget yerelde
  hiç çalışamazdı. RFC 6761 §6.3 `.localhost` TLD'sinin tamamını loopback'e ayırdığı için
  alt alan adları da kabul ediliyor.
- **Anon rate limit env'den okunmuyordu** (tek sabit kodlanmış limitti, ADR-07'ye aykırı).
  `RATE_LIMIT_ANON_PER_MIN` eklendi; CI e2e job'ında yükseltiliyor, üretim varsayılanı 30.

**Test tasarımı notu:** organizasyon id'si worker kapsamlı çözülüyor. Test başına çözmek her
test için bir `/auth/login` demekti ve tek koşuda anon limiti tetikliyordu — süit o zaman
ürün hatası gibi görünen 429'larla düşüyordu.

### F6 — Playbook: AI skill motoru + RAG (2026-07-23) ✅

Dilim 10'un son modülü. **Dilim 10 artık 7/7.** Kontrat 37 → **46 path**.
**595 test yeşil** (219 unit + 353 integration + 23 E2E).

**`packages/ai-mock`** — sağlayıcısız, deterministik AI. Üç parça:

- **Embedding**: içerikten türeyen hash'li kelime torbası, 1536 boyuta izdüşüm, L2 normalize.
  Semantik değil (leksikal her yöntem gibi "delivery" ile "shipping"i ilişkilendirmez) ama
  sistemin gerçekten dayandığı iki özelliği taşıyor: aynı metin → aynı vektör, ve örtüşen
  kelimeler → yüksek benzerlik. Hafif gövdeleme eklendi ("takes"/"take" buluşsun diye);
  bunun kesinlik bedeli intent eşiğinin 0.6'ya çıkarılmasıyla ödendi — iki kelimelik bir
  ifade iki kelimeyi de istiyor.
- **Compiler**: doğal dil → sıralı adımlar. Anlamadığı satırı **raporluyor**, uydurmuyor.
  Müşteriye makul görünen yanlış işi yapan bir skill, derlenmeyi reddedenden kötüdür.
- **Intent**: aynı tokenizer'la leksikal eşleşme.

**Motor** (`skill-engine.ts`): adımları çalıştırıyor, sonucu üçe ayırıyor — `answered` /
`handed_off` / `skipped`. Mesaj başına **tek** skill çalışıyor; iki skill'in aynı soruya cevap
vermesi, yöneticinin hangisinin önce çalıştığını göremeyeceği bir durum yaratır.

**Kanıtlanan invariant'lar:**

- AI **bot** olarak yazıyor, agent olarak değil. ADR-09 bunu okuyor (agent event'i olmayan
  kapanmış thread = AI resolution) ve Reports ilk-yanıt sayacını yalnız insanla başlatıyor.
- Bilgi tabanında yeterince yakın bir şey yoksa **cevap vermiyor** — alakasız bir makaleden
  cevaplamak, cevap olmadığını kabul etmekten kötüdür; sohbet insana kalıyor.
- Bozuk skill müşteriye mesajını kaybettirmiyor; en kötü sonuç zaten insana kalan sohbet.
- Transfer sonrası adımlar çalışmıyor (AI artık o sohbetin sahibi değil).
- Müşterinin zaten verdiği bilgiyi tekrar sormuyor.
- Cross-tenant: başka kiracının skill'i çalışmıyor, bilgisi getirilmiyor.

**Yolda bulunan ciddi hata (benim kodum değil).** `ChatService.start` müşteri durumunu
atlayıp **müşterinin ilk mesajını `author_type: 'agent'` olarak** kaydediyordu — `sendEvent`
doğru yapıyor, `start` yapmıyordu. Aynı hesabı iki yerde yapmanın sonucu. Etkisi:

1. Widget'tan açılan her sohbette ziyaretçinin ilk mesajı ajan balonu olarak görünürdü.
2. Daha kötüsü: her thread daha ilk satırda "agent event"i kazandığı için **hiçbir sohbet
   AI resolution sayılamazdı**. Reports "Automated" kalıcı olarak 0, ve kullanılan otomasyon
   hiç faturalanmıyordu. (Daha önceki tarayıcı kontrolümde gördüğüm "AUTOMATED 0" buydu.)

Türetme tek bir `authorTypeOf`'a alındı; `recipientsFor` de aynı şekilde paylaşıldı (müşteri
hiçbir yazma yolunda internal note yazamaz). Regresyon testi ADR-09 döngüsünü uçtan uca
sabitliyor.

**İkinci hata:** widget zaman aşımından sonra ilk mesajı yeniden gönderirse chat artık var
olduğu için `sendEvent` yoluna giriyor ve idempotency anahtarı tanınmıyordu — ziyaretçinin
açılış mesajı çoğalırdı. `start` artık anahtarı aynı ad alanında kaydediyor.

**Scope düzeltmesi:** `agents-bot--all:rw` admin varsayılanlarında yoktu; sahibin bile
Playbook'u yönetmesi imkânsızdı.

---

### F5 — Settings modülü + composer `#` seçicisi (2026-07-23) ✅

Dilim 10'un ikinci modülü. Kontrat 31 → **37 path**. **535 test yeşil**
(177 unit + 335 integration + 23 E2E).

- **Trusted domains** (CRUD) · **Saved replies** (CRUD) · **Routing rules** (liste + aç/kapa + hedef takım)
- Trusted domains başa alındı çünkü ürünün çalışmasını kapıda tutan tek ayar o: müşterinin alan
  adı listede olmadan widget kendi sitesinde token alamıyor ve hata "widget bozuk" gibi görünüyor,
  "yapılandırma eksik" gibi değil. Bu ekran olmadan widget kimsenin kuramayacağı bir üründü.

**Kapanan döngü — canned responses.** Şemada ve seed'de vardı, **hiçbir şey okumuyor ya da
yazmıyordu**: ne yönetim ekranı ne composer'da `#` seçici (FR-MOD-02.3.5 ölü duruyordu). İkisi
birden eklendi. E2E ana testi döngüyü uçtan uca kanıtlıyor: Settings'te kaydedilen yanıt,
kimse sayfayı yenilemeden `#` ile müşteriye ulaşıyor.

**Paylaşılan origin modülü (`lib/origin.ts`).** Trusted domain'i saklarken uygulanan
normalizasyon ile token endpoint'inin `Origin` başlığından çıkardığı ana bilgisayar adı **birebir
aynı olmak zorunda**. Bir nokta ya da port farkı, alan adının listede doğru görünürken
widget'ın tam da eklendiği sitede reddedilmesi demek — ve iki yerde de bunu açıklayan hiçbir şey
olmaz. `originHost` auth.ts'ten buraya taşındı; unit testin son bloğu iki tarafın aynı dizeye
indiğini doğruluyor.

**Bilinçli kısıtlar:**

- Fallback routing rule **kapatılamıyor** (API 403, UI'da düğme devre dışı). Kapatmak, hiçbir
  kurala uymayan sohbetleri gidecek yeri olmadan bırakırdı; yapılandırma yine sağlıklı görünürdü.
- Wildcard alan adı (`*.example.com`) reddediliyor — çalışacakmış gibi durup asla eşleşmeyecek
  bir değer saklamak yerine. Alt alan adı eşleşmesi `include_subdomains` bayrağı.
- `#` seçici açıkken Enter seçiciye ait: ajanın hâlâ seçmekte olduğu ham `#promo` metnini
  müşteriye göndermek, klavye tutarsızlığından daha kötü bir sonuç.
- Seçici kelime içindeki `#` için açılmıyor (hex renk, URL fragment) — birini cümlenin ortasında
  bölmek, özelliği hiç sunmamaktan kötü.

---

### F4 — Customers modülü (2026-07-23) ✅

Dilim 10'un kalan üç modülünden ilki. Kontrattan başlandı (ADR-05): 3 path / 5 operasyon,
kontrat 28 → **31 path**. **461 test yeşil** (135 unit + 310 integration + 16 E2E).

- `GET /customers` (arama + segment + keyset sayfalama) · `GET /customers/{id}` (ziyaretler +
  sohbetler) · `PATCH /customers/{id}` · `POST|DELETE /customers/{id}/ban`
- UI: iki pane — liste + detay. Modal değil, çünkü ajan birine bakarken geldiği listeyle
  karşılaştırıyor; modal bunu her seferinde elinden alır.

**Yolda kapatılan iki veri boşluğu:**

- **`chats_count` / `tickets_count` hiçbir zaman yazılmıyormuş.** Şemada var (PRD §8.4) ama
  hiçbir yazma yolu bakmıyor; okunsa herkes için sonsuza kadar 0 gösterirdi — üstelik
  yetkiliymiş gibi. İlişkili satırlardan sayılıyor. Test bunu açıkça sabitliyor: sütun 0'a
  set edilip endpoint'in 1 döndürmesi bekleniyor.
- **`visits` tablosu tamamen boşmuş.** Widget zaten sayfa URL'ini gönderiyordu (routing
  kullanıyor), hiçbir yere yazılmıyordu. Artık kaydediliyor: 30 dk içinde aynı ziyaret
  sürdürülüyor (sayfa başına satır değil), ardışık tekrarlar atlanıyor, 50 sayfa ile sınırlı,
  user-agent'tan tarayıcı/OS çıkarılıyor. Mesajı düşürmemek için best-effort.

**Ban yazma yolu eklendi.** `banned_at` sütunu ve iki yerde uygulaması (chat başlatma +
token üretimi) zaten vardı; onu **set edebilecek** hiçbir şey yoktu. `customers.ban:rw`
ayrı scope: yanlış yazılmış bir ismi düzeltebilen ajan, aynı yetkiyle birini hizmet dışı
bırakabilmemeli. Geçmiş silinmiyor — ban moderasyon kararıdır, silme talebi değil; sohbetleri
silmek kararın dayanağını da silerdi.

**Testin yakaladığı gerçek hata:** sayfalama 11 müşteriden 5'ini gösteriyordu. Postgres'te
`ORDER BY x DESC` varsayılanı **NULLS FIRST**; ben nulls-last varsayıp keyset predicate'ini
ona göre yazmıştım. İkisi sessizce çelişince sayfalama erken bitiyor ve hiç aktivitesi olmayan
her müşteri kayboluyordu — hata vermeden. Sıralama artık `nulls: 'last'` ile açıkça belirtiliyor.

**Widget iyileştirmesi:** "Visited pages" sadece siteyi gösteriyordu, sayfayı değil — çapraz
kökende `document.referrer` tarayıcı tarafından kökene kırpılıyor, yani widget yolu hiç
öğrenemiyor. Loader artık `host_url` geçiyor. Query string ve fragment **kırpılıyor**: oturum
token'ları, sıfırlama linkleri ve e-posta adresleri orada yaşar, destek kaydı da onların
görüneceği en son yerdir.

---

## 3. Assumptions (varsayımlar — onay beklenmedi)

- **A1:** Host'ta `psql` yok. Tüm DB CLI işlemleri Postgres container'ı içinden (`docker compose exec db psql`) yapılır.
- **A2:** `licenses.id BIGINT` — uygulama tarafında snowflake benzeri artan ID üretimi (PostgreSQL sequence).
- **A3:** LLM sağlayıcı MOCK: deterministik stub (`packages/ai-mock`) — aynı girdi → aynı çıktı, testler stabil.
- **A4:** SMTP mock: e-postalar `.data/mail/*.json` dosyasına yazılır, gönderilmez.
- **A5:** Stripe mock: `subscriptions`/`usage_records` lokal yazılır, dış çağrı yok.
- **A6:** `region='eu'` sabit; `X-Region` başlığı doğrulanır ama tek değer kabul eder.
- **A7:** Object storage mock: yerel `.data/uploads` + imzalı URL simülasyonu.

## 4. Deviations (sapmalar)

- **D1 (dilim 2):** Redirect URI eşleşmesi **tam eşitlik** (OAuth 2.1). Kaynak platformun
  "kayıtlı yol, istek yolunun alt dizesi olabilir" kuralı (v2-03 §8.6) uygulanmadı — bu kural
  client alanındaki herhangi bir open-redirect'i code sızdırma kanalına çevirir.
- **D2 (dilim 2):** Access token TTL 8 saat değil **1 saat** (NFR-S2 iyileştirmesi).
- **D3 (dilim 2):** Parola KDF olarak argon2id yerine **scrypt** (RFC 7914, Node standart
  kütüphanesi). Gerekçe: native modül kurulum riski yok; güvenlik farkı marjinal, dayanıklılık farkı değil.
- **D4 (dilim 2):** Customer token **stateless HMAC** (DB'de satır yok). Her anonim ziyaretçi için
  satır yazmak konuşma verisinden büyük bir tabloya yol açardı. Bedeli: tekil iptal yok —
  TTL kısa, ban/lisans kontrolü her istekte canlı veriden yapılıyor.
- **D5 (dilim 2):** `licenses.id` için `BIGSERIAL` + `START WITH 1000001`. Prisma'nın
  `@default(autoincrement())` beklentisiyle uyumlu; elle `CREATE SEQUENCE` drift üretiyordu.
- **D6 (dilim 3):** `events` tablosuna `DEFAULT` partition eklendi (PRD'de yok). Gerekçe:
  partition penceresi dışına düşen bir satır aksi halde hata verip **müşteri mesajını
  kaybettirir**. Default partition kaybı önler ve anomaliyi bulunabilir kılar.
- **D7 (dilim 3):** `threads` tablosuna PRD §8.4'te olmayan alanlar eklendi:
  `assignee_id`, `event_sequence`, `queued_at`, `first_response_at`. Sırasıyla inbox
  ataması, kayıpsız reconnect (dilim 5) ve Reports "ilk yanıt süresi" için gerekli.
- **D8 (dilim 3):** `prisma migrate diff` tek başına drift kapısı olamıyor — Prisma index
  _access method_ (ivfflat/GIN) modelleyemiyor. `pnpm db:check-drift` bu tek bilinen
  ifadeye izin verip diğer her farkta hata veriyor; sinyal korunuyor.

**Doküman düzeltmeleri (kaynakta sayı hatası):**

- v2-03 §8.5 başlığı "~63 scope" diyor, tablosu **58** sayıyor. Tablo esas alındı.
- v2-03 §1.8 tablosu **24** hata tipi listeliyor (master prompt 23 diyor). Tablo esas alındı.

---

## 5. Bitti Tanımı Takibi

- [x] Tüm testler yeşil — **595** (219 unit + 353 integration + 23 E2E)
      · @nexa/types 26 · ai-mock 42 · rtm 23+42 · widget 24 · web 33 · api 71+311
- [x] typecheck + lint + format temiz · migration drift yok
- [x] `make dev` tek komutla her şeyi ayağa kaldırıyor
- [x] README.md kurulum + mimariyi anlatıyor
- [x] Demo akışı doğrulandı: widget mesaj → routing (URL kuralıyla Sales'e) →
      agent inbox'ta **canlı** (13 ms) → yanıt → internal note (müşteri görmüyor) →
      etiket → arşiv → reports + billing
- [x] Her dilim commit + push edilmiş
- [x] HANDOFF.md yazılmış
- [x] Playwright E2E paketi — 10 test, ana demo akışı tarayıcıda kanıtlandı (bkz. F3)
