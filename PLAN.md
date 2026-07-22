# PLAN.md — Nexa Geliştirme Planı

> **Tek doğruluk kaynağı.** Her dilim sonunda güncellenir.
> Şema doğruluk kaynağı: `urun-gereksinim-dokumani-PRD.md` §8.4 + `rapor-2-teknik-mimari.md` §5.3.
> `LiveChat_ER_Diyagram.mermaid` KULLANILMAZ (çelişkili — bkz. yeterlilik değerlendirmesi G8).

**Başlangıç:** 2026-07-22 · **Durum:** Dilim 1–8 ✅ tamam · Dilim 9–10 kaldı

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
| 9   | Reports Overview + Billing/metering + trial                                              | XHIGH  | `feat/09-reports-billing` |  ⬜   |
| 10  | Design system + tüm ekranların tutarlı stillenmesi                                       | XHIGH  | `feat/10-design-system`   |  ⬜   |

Durum: ⬜ başlamadı · ⏳ devam · ✅ bitti (test yeşil + push)

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

### Dilim 9 — Reports + Billing [XHIGH]

- Overview KPI: total chats, chats/agent, avg first response, CSAT, automated (ADR-09)
- `usage_records` metering; trial gün sayacı; salt-okuma modu (ADR-10); Stripe mock

### Dilim 10 — Design System [XHIGH]

- `design-brief.md` token'ları → Tailwind config + shadcn/ui
- Tüm ekranlar tek dile; WCAG 2.1 AA

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

- [ ] Tüm testler yeşil (unit + integration + E2E)
- [ ] typecheck + lint temiz
- [ ] `make dev` tek komutla her şeyi ayağa kaldırıyor
- [ ] README.md kurulum + mimariyi anlatıyor
- [ ] Demo akışı: widget mesaj → routing → agent inbox canlı → yanıt → arşiv
- [ ] Her dilim commit + push edilmiş
- [ ] HANDOFF.md yazılmış
