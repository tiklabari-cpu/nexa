# Task ID: 63

**Title:** 07.5 — Metrics breakdown (ajan/takım/kanal/saat)  ·  dilim V2-4

**Status:** done

**Dependencies:** 78 ✓

**Priority:** medium

**Description:** FR-MOD-07.5 · Should (v2).

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `07.5`.

9 atomik alt-görev · ~11 pencere · etiket dağılımı: OPUS-MAX x2 · OPUS-XHIGH x1 · SONNET-XHIGH x6

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  07.5-a [SONNET-XHIGH] ReportsBreakdown kontratına by_hour/by_team/by_channel (additive, opsiyonel)  (bağ: yok)
  07.5-b [SONNET-XHIGH] Saat boyutu: breakdownByHour() + /reports/breakdown yanıtına by_hour  (bağ: 07.5-a)
  07.5-c [SONNET-XHIGH] channel_messages(license_id, chat_id) indeksi + saf kanal etiketi helper'ı  (bağ: yok)
  07.5-d [OPUS-MAX] Kanal boyutu agregasyon çekirdeği — license_id-kilitli soft-FK join + 'website' fallback  (bağ: 07.5-a, 07.5-c)
  07.5-e [OPUS-MAX] Takım boyutu agregasyon çekirdeği — chat_access M:N fan-out + license kilidi  (bağ: 07.5-a)
  07.5-f [SONNET-XHIGH] CSV export: breakdown grubunu dört boyuta genişlet (uzun format)  (bağ: 07.5-b, 07.5-d, 07.5-e)
  07.5-g [SONNET-XHIGH] Breakdown sekmesi: "By hour" bölümü (salt-okunur tablo + empty state)  (bağ: 07.5-b)
  07.5-h [SONNET-XHIGH] Breakdown sekmesi: "By team" + "By channel" bölümleri + örtüşme dipnotu  (bağ: 07.5-d, 07.5-e)
  07.5-i [OPUS-XHIGH] Uçtan uca doğrulama: dört boyut çapraz-tutarlılığı + NFR-P2 bütçe ölçümü  (bağ: 07.5-f, 07.5-g, 07.5-h)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): İki OPUS-MAX çekirdeği bölünmez. (1) 07.5-d kanal boyutu: `channel_messages.chat_id` FK'sız soft-reference (schema.prisma yorumu birebir: "`chat_id` is a soft reference (no FK)"); join `license_id` eşleşmesiyle kilitlenmezse başka tenant'ın satırı bir chat'i yanlış kanala sokabilir — join koşulu, RLS davranışı ve "hangi kanal" seçimi tek akıl yürütmedir, parçalanırsa izolasyon argümanı kaybolur. (2) 07.5-e takım boyutu: `chat_access` tablosunun KENDİ license_id kolonu YOK (migration 20260722154008 satır 892-906 birebir: "chat_users and chat_access have no license column of their own (PRD §8.4)" — RLS `chats` üzerinden EXISTS alt-sorgusuyla uygulanıyor) ve `chat-service.ts:1246` `chatAccess.createMany` bir chat'i birden fazla gruba yazabiliyor (M:N) → izolasyon kilidi + çift-sayım invariantı + "hangi takım" tanımı aynı kararın parçaları. Bu çekirdeklerin ETRAFI ucuzlatıldı: kontrat (07.5-a), indeks/migration + saf helper (07.5-c), CSV (07.5-f), iki UI (07.5-g/-h) ve uçtan uca doğrulama (07.5-i) ayrı ve daha ucuz etiketli alt-görevlere çıkarıldı; pahalı pencereler yalnız SQL + izolasyon kararını taşıyor.

VARSAYIMLAR: Saat kovası UTC'dir — mevcut `breakdownByDay`'in `AT TIME ZONE 'UTC'` deseniyle (reports.ts:301) tutarlı. Müşteri saat dilimi parametresi bu kalemde kapsam dışı; aksi halde Overview'ın gün kovalarıyla ekranlar arası tutarsızlık doğar. · `by_hour` DENSE döner (0-23, veri yoksa sıfır satır); `by_day` mevcut davranışını korur (sparse). Gerekçe: saat ekseni sabit ve 24 elemanlıdır, UI'da boşluk yerine sıfır göstermek daha okunaklıdır. · Kanal sınıflandırması: bir chat'in kanalı, o chat'e ait EN ESKİ `direction='inbound'` `channel_messages` satırının `channel_type`'ıdır; hiç satır yoksa `'website'`. Gerekçe: `CHANNEL_TYPES = ['messenger','twilio','whatsapp']` (channel-adapter.ts:29) ve native web widget sohbetleri `channel_messages` satırı üretmez — fallback olmadan boyut eksik kalır. · Takım boyutunda FAN-OUT kabul edilir (birincil grup SEÇİLMEZ): bir chat açık olduğu her takımın satırında sayılır ve yanıt `overlapping: true` ile bunu beyan eder, UI dipnotla gösterir. Gerekçe: `chat_access` M:N'dir (chat-service.ts:1246 createMany) ve şemada 'birincil grup' kavramı yok; sessiz tekilleştirme veriyi uydurmak olurdu. · Hiçbir gruba açık olmayan sohbetler `team_id: null` / 'Unassigned' satırında toplanır — hiçbir sohbet kaybolmaz. · Rapor görünürlüğü lisans genelinde kalır: `reports_read` scope'u tüm takımların/kanalların metriklerini görür. Gerekçe: mevcut `by_agent` de tüm ajanları döndürüyor (reports.ts:677-698); takım bazlı daraltma yeni bir yetki modeli olur ve PRD'de yazmıyor. Karar 07.5-e'de testle sabitlenir. · CSV 'breakdown' grubu UZUN FORMAT'a geçer (`dimension,key,chats,closed,manual,assisted,automated`) ve `REPORT_GROUPS` katalogu (reports-export.ts:38-43) değişmez — yeni rapor grubu açılmaz, dosya adı/scope gating deseni korunur. · OpenAPI'de yeni alanlar OPSİYONEL kalır (`required` listesine eklenmez) — mevcut istemciler ve testler kırılmaz, geriye dönük uyum korunur. · `by_agent`'taki `LIMIT 20` yeni boyutlara uygulanmaz: saat 24 sabit, takım ve kanal kardin

AÇIK SORULAR (ürün kararı): Takım boyutunda örtüşme beyanı (fan-out + `overlapping` bayrağı) yeterli mi, yoksa şemaya 'birincil takım' (`threads.group_id` veya `chat_access.is_primary`) eklenip boyut ayrışık hale mi getirilmeli? Bu bir ürün kararı ve çapraz-kesen bir veri modeli değişikliği olur (yeni migration + chat-service/routing-service yazma yolları) — bu turda bilinçli olarak YAPILMADI. · Kanal boyutuna e-posta dahil edilecek mi? `email-inbound.ts` gelen e-postayı TICKET'a çeviriyor (chat değil) ve `channel_messages` yazmıyor; mevcut breakdown ise `threads` tabanlı. E-posta kanalını göstermek için ticket'ları da boyuta katmak gerekir — kapsam genişlemesi. · v2-03 §316 ortak gövde parametreleri `distribution` (`hour|day|day-hours|month|year`) ve `filters.agents` / `filters.groups` tanımlıyor. Bu kalem sabit dört boyutu TEK yanıtta döndürüyor (mevcut by_day+by_agent deseniyle tutarlı). Parametre-tabanlı `distribution` + filtre modeline geçiş ayrı bir kalem mi olmalı? · NFR-P7 ("ağır raporlar için read-replica/ayrı analitik depo") uygulanmış değil. 07.5-i'nin EXPLAIN ölçümü NFR-P2 bütçesini (okuma p99 <150ms) aşarsa ne yapılacak — kalem geri mi çekilir, materialized view mü, yoksa NFR-P7 ayrı kaleme mi açılır? · `chat_access` RLS'i `chats` üzerinden EXISTS alt-sorgusuyla çalışıyor (migration 20260722154008:892-906). Takım agregasyonu bu alt-sorgunun maliyetini ödeyecek; ölçüm sonrası `chat_access`'e denormalize `license_id` kolonu gerekir mi? (Şema tek doğruluk kaynağı PRD §8.4 olduğu için bu bir PR

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 63.1. 07.5-a [SONNET-XHIGH] ReportsBreakdown kontratına by_hour/by_team/by_channel (additive, opsiyonel)

**Status:** done  
**Dependencies:** None  

Contract-first ilk adım. `ReportsBreakdown` şemasına ÜÇ opsiyonel alan: `by_hour` (items: {hour:int 0-23, + SplitRow alanları}), `by_team` (items: {team_id:int|null, name:string|null, + SplitRow}) ve `overlapping:boolean` üst-alanı, `by_channel` (items: {channel:string, + SplitRow}). Alanlar `required` listesine EKLENMEZ (geriye dönük uyum: mevcut istemciler kırılmaz). paths/reports.yaml breakdown

**Details:**

07.5-a — ReportsBreakdown kontratına by_hour/by_team/by_channel (additive, opsiyonel)  [SONNET-XHIGH]

PRD: FR-MOD-07.5 (+ NFR-M2 bounded context: reports)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. Tek dosya çifti + üretilen bundle (3 dosya); güvenlik sınırı yok (kontrat yüzeyi, çalışma zamanı yok); eşzamanlılık yok; yeni algoritma yok — kopyalanacak desen aynı şemadaki by_day/by_agent blokları isimle verilebiliyor; değişiklik katkısal ve mekanik; KK mekanik doğrulanabilir (contract-parity + typecheck).
NEDEN AÇIK: packages/contract/openapi/openapi.yaml:1908 `ReportsBreakdown` şemasının açıklaması birebir "resolved over two dimensions — each UTC day in the window and each assigned agent" diyor ve `required: [range, by_day, by_agent]`; team/channel/hour alanı yok. packages/contract/openapi/paths/reports.yaml:46 operation summary'si de "Resolution split by day and by agent".
KAPSAM: Contract-first ilk adım. `ReportsBreakdown` şemasına ÜÇ opsiyonel alan: `by_hour` (items: {hour:int 0-23, + SplitRow alanları}), `by_team` (items: {team_id:int|null, name:string|null, + SplitRow}) ve `overlapping:boolean` üst-alanı, `by_channel` (items: {channel:string, + SplitRow}). Alanlar `required` listesine EKLENMEZ (geriye dönük uyum: mevcut istemciler kırılmaz). paths/reports.yaml breakdown operation summary + description dört boyutu anlatacak şekilde güncellenir. `pnpm --filter @siyahtus/contract generate` ile bundle + generated tipler yeniden üretilir.
DOSYALAR: packages/contract/openapi/openapi.yaml · packages/contract/openapi/paths/reports.yaml · packages/contract/src/generated/api.ts
REFERANS DESEN (kopyalanacak): packages/contract/openapi/openapi.yaml — aynı şemanın `by_day` (satır ~1923) ve `by_agent` (satır ~1937) blokları: alan adları, integer tipleri, nullable name deseni birebir kopyalanır · packages/contract/openapi/openapi.yaml — `ReportsOverview` içindeki `by_agent` + `top_tags` dizileri: çok-dizili yanıt şeması deseni · packages/contract/openapi/paths/reports.yaml — `breakdown` operation'ının mevcut parameters/responses bloğu (satır 42-70)
KK (birebir): "Boyutlu kırılım" | "KK-türetilmiş: "Yanıt şeması dört boyutu (gün/saat/takım/kanal) taşır; yeni alanlar opsiyoneldir, mevcut by_day+by_agent sözleşmesi değişmez." — PRD 07.5 KK sütunu tek kelimelik ("Boyutlu kırılım"), alan listesi yok; boyut adları PRD satırının kendisinden ("ajan/takım/kanal/saat") ve rapor-1-fonksiyonel.md:1333-1340 ("Metrikleri boyutlara göre (ajan, takım, kanal, saat — **çıkarım**) ayrıştırır") türetildi."
KK DOĞRULAMA: `apps/api/test/integration/contract-parity.test.ts` yeşil (bundle yeniden üretilmiş); `pnpm --filter @siyahtus/contract typecheck` + generated `api.ts` içinde `by_hour`/`by_team`/`by_channel` opsiyonel alan olarak görünür — "Boyutlu kırılım" KK'sının şema payını kanıtlar.
KAPSAM DIŞI: Backend sorguları (07.5-b/-d/-e) · CSV export (07.5-f) · UI (07.5-g/-h) · Yeni endpoint/path açmak — mevcut GET /api/v1/reports/breakdown korunur · v2-03 §316'daki `distribution` (hour|day|day-hours|month|year) parametre modeline geçiş
SÖZLEŞME: packages/contract/openapi/openapi.yaml `#/components/schemas/ReportsBreakdown` → opsiyonel `by_hour`, `by_team`, `by_channel` dizileri + `overlapping` boolean; paths/reports.yaml `breakdown` summary/description güncellemesi. YENİ PATH YOK. UYARI: OpenAPI'ye eklenip re-bundle edilmezse (`pnpm --filter @siyahtus/contract generate`) contract-parity.test.ts kırılır (MEMORY: siyahtus-contract-parity-gate).
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 63.2. 07.5-b [SONNET-XHIGH] Saat boyutu: breakdownByHour() + /reports/breakdown yanıtına by_hour

**Status:** done  
**Dependencies:** 63.1  

`breakdownByHour(tx, licenseId, from, to)` helper'ı — mevcut `SPLIT_COUNTS` fragment'i (reports.ts:117-123) AYNEN yeniden kullanılır (tek SQL tanımı ilkesi, reports.ts:112-123 yorumu), yalnız `GROUP BY EXTRACT(HOUR FROM t.created_at AT TIME ZONE 'UTC')`. Sonuç 0-23 DENSE dizi (veri olmayan saat sıfırlarla doldurulur — saat ekseni sabittir). `/reports/breakdown` handler'ına `by_hour` eklenir; `by_d

**Details:**

07.5-b — Saat boyutu: breakdownByHour() + /reports/breakdown yanıtına by_hour  [SONNET-XHIGH]

PRD: FR-MOD-07.5 (+ NFR-P2 okuma p99 <150ms)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. 2 dosya (route + integration test); güvenlik sınırı yok — aynı `threads` tablosu, aynı `t.license_id = ${licenseId}` filtresi, aynı withTenant/RLS yolu, YENİ JOIN YOK; eşzamanlılık yok; yeni algoritma yok — kopyalanacak desen `breakdownByDay()` (reports.ts:279-311) ismen verildi, tek fark GROUP BY ifadesi; kontrat değişikliği 07.5-a'da bitti; KK mekanik (24 kova + satır-içi invariant).
NEDEN AÇIK: Olgu: reports.ts'de hiçbir yerde `EXTRACT(HOUR ...)` veya saatlik distribution yok; tek zaman kırılımı `to_char((t.created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')` ile GÜNLÜK (reports.ts:301, breakdownByDay). Handler (reports.ts:664-723) yalnız `by_day` + `by_agent` döndürüyor.
KAPSAM: `breakdownByHour(tx, licenseId, from, to)` helper'ı — mevcut `SPLIT_COUNTS` fragment'i (reports.ts:117-123) AYNEN yeniden kullanılır (tek SQL tanımı ilkesi, reports.ts:112-123 yorumu), yalnız `GROUP BY EXTRACT(HOUR FROM t.created_at AT TIME ZONE 'UTC')`. Sonuç 0-23 DENSE dizi (veri olmayan saat sıfırlarla doldurulur — saat ekseni sabittir). `/reports/breakdown` handler'ına `by_hour` eklenir; `by_day`/`by_agent` davranışı DEĞİŞMEZ.
DOSYALAR: apps/api/src/routes/reports.ts · apps/api/test/integration/reports-billing.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports.ts — `breakdownByDay()` (satır 279-311): $queryRaw + SPLIT_COUNTS + bigint→Number map'leme deseni birebir · apps/api/src/routes/reports.ts — `/reports/breakdown` handler'ı (satır 664-723): rangeQuery→resolveRange→withTenant→reply.send serileştirme sırası · apps/api/test/integration/reports-billing.test.ts — `describe('breakdown (07.5)')` bloğu (satır 563-620): kurulum + invariant + cross-tenant iddia deseni
KK (birebir): "Boyutlu kırılım" | "KK-türetilmiş: "Saat boyutu: her sohbet açılış saatinin UTC kovasına düşer; 0-23 arası 24 kova döner; her satırda manual + assisted + automated === closed." — PRD KK sütunu tek kelimelik olduğu için PRD satırındaki "ajan/takım/kanal/**saat**" boyut listesinden ve mevcut şema açıklamasındaki invariant cümlesinden ("`manual + assisted + automated === closed` holds inside every row") türetildi."
KK DOĞRULAMA: reports-billing.test.ts 'breakdown (07.5)' bloğuna: (1) `by_hour.length === 24` ve `hour` değerleri 0..23 artan; (2) bilinen bir UTC saatinde açılan chat yalnız o kovada; (3) her satırda manual+assisted+automated === closed — "Boyutlu kırılım"ın saat payını kanıtlar.
KAPSAM DIŞI: Müşteri saat dilimi / `timezone` query parametresi (varsayım: UTC) · v2-03 §316'daki `day-hours` (gün×saat matrisi) dağılımı · Takım ve kanal boyutları (07.5-e / 07.5-d) · CSV export (07.5-f) ve UI (07.5-g)
SÖZLEŞME: yok (alan 07.5-a'da eklendi; bu pencere yalnız alanı doldurur — kontrat ile yanıt arasında sapma kalmaz)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 63.3. 07.5-c [SONNET-XHIGH] channel_messages(license_id, chat_id) indeksi + saf kanal etiketi helper'ı

**Status:** done  
**Dependencies:** None  

(1) Prisma: `ChannelMessage`'a `@@index([licenseId, chatId])` + karşılık gelen migration (yalnız CREATE INDEX; veri dönüşümü yok, geri alınabilir). (2) `reports-metrics.ts`'e saf `channelLabel(type: string | null): string` — bilinen tipler ('messenger'|'twilio'|'whatsapp', kaynak CHANNEL_TYPES) kendi etiketine, `null`/bilinmeyen → `'website'` (adaptör kanalı olmayan native web sohbeti). Saf ve bağ

**Details:**

07.5-c — channel_messages(license_id, chat_id) indeksi + saf kanal etiketi helper'ı  [SONNET-XHIGH]

PRD: FR-MOD-07.5 (+ NFR-P2 okuma p99 <150ms)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. 4-5 dosya (schema + migration + saf helper + testleri); güvenlik KARARI yok — join'i ve izolasyon kilidini 07.5-d yapar, bu alt-görev yalnız indeks + saf string eşlemesi; eşzamanlılık yok; yeni algoritma yok — kopyalanacak desenler (mevcut @@index tanımı, reports-metrics.ts saf fonksiyon stili, data-model.test.ts:274 EXPLAIN plan iddiası) ismen verildi; kontrat değişmez; KK mekanik.
NEDEN AÇIK: apps/api/prisma/schema.prisma `ChannelMessage` yalnız `@@index([licenseId, channelType, createdAt])` taşıyor — `chat_id` üzerinde HİÇBİR indeks yok, oysa kanal boyutu chat_id ile join edecek. Ayrıca `CHANNEL_TYPES = ['messenger', 'twilio', 'whatsapp']` (apps/api/src/services/channels/channel-adapter.ts:29) ve `channel_messages`'a YALNIZ `channel-service.ts:342` `record()` yazıyor → native web widget sohbetleri hiç satır üretmiyor; kanal boyutu fallback etiketi olmadan eksik kalır.
KAPSAM: (1) Prisma: `ChannelMessage`'a `@@index([licenseId, chatId])` + karşılık gelen migration (yalnız CREATE INDEX; veri dönüşümü yok, geri alınabilir). (2) `reports-metrics.ts`'e saf `channelLabel(type: string | null): string` — bilinen tipler ('messenger'|'twilio'|'whatsapp', kaynak CHANNEL_TYPES) kendi etiketine, `null`/bilinmeyen → `'website'` (adaptör kanalı olmayan native web sohbeti). Saf ve bağımlılıksız — reports.ts, CSV ve UI aynı sözlüğü paylaşır.
DOSYALAR: apps/api/prisma/schema.prisma · apps/api/prisma/migrations/ · apps/api/src/routes/reports-metrics.ts · apps/api/src/routes/reports-metrics.test.ts · apps/api/test/integration/data-model.test.ts
REFERANS DESEN (kopyalanacak): apps/api/prisma/schema.prisma — `ChannelMessage`'ın mevcut `@@index([licenseId, channelType, createdAt])` satırı: bileşik indeks yazım deseni · apps/api/src/routes/reports-metrics.ts — `round()` / `resolutionRate()`: bağımlılıksız saf fonksiyon + doc-comment stili · apps/api/test/integration/data-model.test.ts:274 — 'prunes partitions when a query is bounded by time': `EXPLAIN (FORMAT TEXT)` ile sorgu planı iddia etme deseni birebir kopyalanır · apps/api/src/services/channels/channel-adapter.ts:29 — CHANNEL_TYPES tek doğruluk kaynağı (helper bu listeyi tüketir, kendi listesini uydurmaz)
KK (birebir): "Boyutlu kırılım" | "KK-türetilmiş: "Kanal boyutunun veri yolu ölçeklenebilir (chat_id join'i indeks kullanır) ve adaptör kanalı olmayan sohbetler tanımlı bir kovaya ('website') düşer." — PRD KK'sı tek kelimelik; bu alt-görev KK'nın kendisini değil ÖNKOŞULUNU karşılar, kriter NFR-P2 (okuma bütçesi) ve boyutun tam-kapsayıcılığı üzerinden türetildi."
KK DOĞRULAMA: (1) data-model.test.ts'e EXPLAIN iddiası: `SELECT ... FROM channel_messages WHERE license_id = $1 AND chat_id = $2` planı Seq Scan içermez / yeni indeksi kullanır (NFR-P2 payı). (2) reports-metrics.test.ts unit: `channelLabel('messenger')==='messenger'`, `channelLabel(null)==='website'`, `channelLabel('bilinmeyen')==='website'`.
KAPSAM DIŞI: Kanal agregasyon sorgusu ve izolasyon kilidi (07.5-d — bölünmez çekirdek) · channel_messages.chat_id'ye FK constraint eklemek (soft-reference bilinçli tasarım: schema.prisma yorumu "the record outlives the conversation") · email→ticket akışı (email-inbound.ts ticket üretir, chat değil) · UI / CSV
MIGRATION: EVET — `channel_messages` tablosuna `CREATE INDEX` (license_id, chat_id). Yeni kolon/tablo yok, veri dönüşümü yok, geri alınabilir (DROP INDEX).
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 63.4. 07.5-d [OPUS-MAX] Kanal boyutu agregasyon çekirdeği — license_id-kilitli soft-FK join + 'website' fallback

**Status:** done  
**Dependencies:** 63.1, 63.3  

`breakdownByChannel(tx, licenseId, from, to)` — `threads t` → (soft) `channel_messages cm` üzerinden chat başına TEK kanal türetilir; join koşulu HER ZAMAN `cm.license_id = t.license_id AND cm.chat_id = t.chat_id` (iki kilit birden). Kanal seçimi: chat'in en ESKİ `direction='inbound'` satırının `channel_type`'ı; hiç satır yoksa `channelLabel(null)` → 'website' (07.5-c helper'ı). Mevcut `SPLIT_COUN

**Details:**

07.5-d — Kanal boyutu agregasyon çekirdeği — license_id-kilitli soft-FK join + 'website' fallback  [OPUS-MAX]

PRD: FR-MOD-07.5 (+ NFR-S4 tenant izolasyonu, NFR-S3 scope zorlaması, NFR-P2)
ETİKET GEREKÇESİ: OPUS-MAX: koşul 2 ihlali — TENANT İZOLASYON SINIRI. `channel_messages.chat_id` FK'sız soft-reference (schema.prisma birebir: "`chat_id` is a soft reference (no FK)"); ham SQL join'i `license_id` eşleşmesiyle kilitlenmezse başka bir tenant'ın aynı chat_id'li satırı bu lisansın chat'ini yanlış kanala sokabilir — RLS'e körü körüne güvenilemez, join koşulu açıkça doğrulanmalı. Ayrıca bir chat'in birden fazla channel_message satırı olabilir → "hangi kanal" seçimi bir invariant kararı. Çekirdek bölünmez: join koşulu, RLS davranışı ve kanal seçimi tek akıl yürütmedir.
NEDEN AÇIK: Olgu: reports.ts'de `channel_type` / `channel_messages` HİÇ geçmiyor (grep 0) — kanal boyutu için sıfır tüketici. Thread/Chat üzerinde `channel_type` kolonu yok (schema.prisma). Veri yalnız `channel_messages`'ta ve oraya YALNIZ `apps/api/src/services/channels/channel-service.ts:342` `record()` yazıyor; `CHANNEL_TYPES = ['messenger','twilio','whatsapp']` (channel-adapter.ts:29) → native web sohbetleri hiç satır üretmiyor. Sorgu ham `$queryRaw` olacağı için açık license filtresi zorunlu.
KAPSAM: `breakdownByChannel(tx, licenseId, from, to)` — `threads t` → (soft) `channel_messages cm` üzerinden chat başına TEK kanal türetilir; join koşulu HER ZAMAN `cm.license_id = t.license_id AND cm.chat_id = t.chat_id` (iki kilit birden). Kanal seçimi: chat'in en ESKİ `direction='inbound'` satırının `channel_type`'ı; hiç satır yoksa `channelLabel(null)` → 'website' (07.5-c helper'ı). Mevcut `SPLIT_COUNTS` (reports.ts:117-123) AYNEN yeniden kullanılır — kanal kırılımı Overview/fatura ile asla ayrışmaz (ADR-09). Handler'a `by_channel`; route scope'u `reports_read` DEĞİŞMEZ. Toplam invariantı: SUM(by_channel.chats) === toplam chats (her chat tam bir kovada).
DOSYALAR: apps/api/src/routes/reports.ts · apps/api/test/integration/reports-billing.test.ts · apps/api/test/integration/tenant-isolation.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports.ts:677-698 — `by_agent`'ın LEFT JOIN accounts + SPLIT_COUNTS + GROUP BY bloğu: dış tabloya join ederken license filtresini koruma deseni · apps/api/src/lib/tenant.ts — `withTenant` / `set_config` (SET LOCAL) ile RLS bağlamı: ham SQL'in hangi bağlamda koştuğu · apps/api/test/integration/tenant-isolation.test.ts — cross-tenant sızıntı iddia deseni
KK (birebir): "Boyutlu kırılım" | "KK-türetilmiş: "Kanal boyutu: her sohbet tam olarak bir kanal kovasına düşer (adaptör kanalı yoksa 'website'); satırların chats toplamı pencere toplamına EŞİTTİR (ne eksik ne çift sayım); başka lisansın kanal mesajı hiçbir satırı etkilemez." — PRD KK sütunu tek kelimelik; tam-kapsayıcılık ve izolasyon kriterleri NFR-S4 ile ve mevcut şema invariant cümlesiyle türetildi."
KK DOĞRULAMA: reports-billing.test.ts: (1) CROSS-TENANT ÖNCE — B lisansına, A lisansındaki bir chat ile AYNI chat_id'yi taşıyan `channel_messages` satırı yazılır; A'nın `/reports/breakdown` yanıtında o chat hâlâ 'website' kovasında kalır, B'nin kanalı görünmez (join kilidi kanıtlanır). (2) messenger/whatsapp/twilio inbound'u olan chat'ler doğru kovada. (3) SUM(by_channel.chats) === by_day toplam chats. (4) `reports_read` olmayan token → 403.
KAPSAM DIŞI: Takım boyutu (07.5-e) · Kanal bazlı yanıt süresi / SLA metrikleri · email→ticket akışının kanal kırılımına dahil edilmesi (email-inbound.ts chat değil ticket üretir) · channel_messages'a FK constraint eklemek · UI (07.5-h) ve CSV (07.5-f)
SÖZLEŞME: yok (alan 07.5-a'da eklendi). Yeni route YOK — mevcut GET /api/v1/reports/breakdown genişletiliyor, path pariteesi etkilenmez; yine de bundle 07.5-a'da güncellenmiş olmalı yoksa contract-parity kırılır.
MIGRATION: yok (indeks 07.5-c'de)
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 63.5. 07.5-e [OPUS-MAX] Takım boyutu agregasyon çekirdeği — chat_access M:N fan-out + license kilidi

**Status:** done  
**Dependencies:** 63.1  

`breakdownByTeam(tx, licenseId, from, to)` — `threads t` → `chats c` (license kilidi) → `chat_access ca ON ca.chat_id = c.id` → `groups g ON g.license_id = c.license_id AND g.id = ca.group_id`. Fan-out KABUL edilir (birincil-grup kavramı şemada yok): bir chat N takıma açıksa N satırda sayılır ve yanıt `overlapping: true` ile bunu BEYAN eder (sessiz çift sayım yasak). Hiçbir gruba açık olmayan chat

**Details:**

07.5-e — Takım boyutu agregasyon çekirdeği — chat_access M:N fan-out + license kilidi  [OPUS-MAX]

PRD: FR-MOD-07.5 (+ NFR-S4 tenant izolasyonu, NFR-S3 scope, NFR-P2)
ETİKET GEREKÇESİ: OPUS-MAX: koşul 2 ihlali — TENANT İZOLASYONU + YETKİ SINIRI. `chat_access` tablosunun KENDİ license_id kolonu yok (migration 20260722154008:892 birebir: "chat_users and chat_access have no license column of their own (PRD §8.4)"; RLS `chats` üzerinden EXISTS alt-sorgusuyla) → ham SQL join'i chats.license_id üzerinden kilitlenmezse izolasyon yalnız RLS'e kalır; ayrıca `groups` PK'sı bileşik (`@@id([licenseId, id])`) olduğu için aynı group_id iki lisansta var olabilir. Koşul 6 ihlali de var: `chatAccess.createMany` (chat-service.ts:1246) bir chat'i N gruba yazabildiği için "bu chat hangi takıma ait" AYRIŞIK DEĞİL — çift sayım mı birincil grup mu kararı yorum gerektirir. Çekirdek bölünmez.
NEDEN AÇIK: Olgu: reports.ts'de `group` / `chat_access` HİÇ geçmiyor (grep 0). Thread'de doğrudan `groupId` kolonu YOK (schema.prisma); takım bilgisinin tek gerçek kaynağı `ChatAccess(chat_id, group_id)` — ve bu M:N: `chat-service.ts:1246` `tx.chatAccess.createMany({ data: input.groupIds.map(...) })` bir chat'i N gruba yazıyor (transfer yolu `chat-service.ts:947-948` deleteMany+create ile tekile indiriyor, ama yeni chat yolu indirmiyor).
KAPSAM: `breakdownByTeam(tx, licenseId, from, to)` — `threads t` → `chats c` (license kilidi) → `chat_access ca ON ca.chat_id = c.id` → `groups g ON g.license_id = c.license_id AND g.id = ca.group_id`. Fan-out KABUL edilir (birincil-grup kavramı şemada yok): bir chat N takıma açıksa N satırda sayılır ve yanıt `overlapping: true` ile bunu BEYAN eder (sessiz çift sayım yasak). Hiçbir gruba açık olmayan chat'ler `team_id: null` / 'Unassigned' satırında toplanır — hiçbir sohbet kaybolmaz. `SPLIT_COUNTS` (reports.ts:117-123) AYNEN yeniden kullanılır. Görünürlük kararı: `reports_read` lisans genelinde kalır (mevcut `by_agent` de tüm ajanları döndürüyor — reports.ts:677-698); takım bazlı daraltma YAPILMAZ ve bu karar testle sabitlenir.
DOSYALAR: apps/api/src/routes/reports.ts · apps/api/test/integration/reports-billing.test.ts · apps/api/test/integration/tenant-isolation.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports.ts:677-698 — by_agent'ın LEFT JOIN + SPLIT_COUNTS + GROUP BY + ORDER BY chats DESC bloğu · apps/api/src/services/routing/routing-service.ts:142 — `tx.chatAccess.findMany` grup okuma deseni · apps/api/src/services/chat/access.ts — `resolveVisibility` (scope vs üyelik iki kapısı): görünürlük kararının mevcut referansı · apps/api/prisma/migrations/20260722154008_domain_model/migration.sql:892-906 — chat_access RLS politikası (chats üzerinden EXISTS)
KK (birebir): "Boyutlu kırılım" | "KK-türetilmiş: "Takım boyutu: bir sohbet açık olduğu HER takımın satırında görünür ve yanıt bu örtüşmeyi (`overlapping`) açıkça beyan eder; takımsız sohbetler kaybolmaz; başka lisansın takımı/sohbeti hiçbir satırda görünmez." — PRD KK sütunu tek kelimelik; fan-out beyanı `chat_access`'in M:N olmasından (chat-service.ts:1246) zorunlu olarak türetildi, çünkü sessiz çift sayım Overview toplamıyla çelişir."
KK DOĞRULAMA: reports-billing.test.ts: (1) CROSS-TENANT ÖNCE — iki lisansta AYNI `group_id` değerini kullanan kurgu; B'nin grubu/chat'i A'nın `by_team`'inde görünmez (join license kilidi olmadan sızar → test bunu kanıtlar). (2) İki gruba açık bir chat her iki takım satırında sayılır VE `overlapping === true`. (3) Tek gruba açık senaryoda SUM(by_team.chats) === toplam chats ve `overlapping === false`. (4) Gruba açık olmayan chat 'Unassigned' satırında. (5) scope'suz token → 403.
KAPSAM DIŞI: Kanal boyutu (07.5-d) · Threads'e `group_id` / 'birincil takım' kolonu eklemek (şema değişikliği — açık soru §1) · Grup CRUD/UI, takım üyeliği yönetimi · Ajan→grup eşlemesi üzerinden türev ikinci bir boyut · Takım bazlı SLA/yanıt süresi · UI (07.5-h) ve CSV (07.5-f)
SÖZLEŞME: yok (alanlar 07.5-a'da eklendi: `by_team` + `overlapping`). Yeni route YOK.
MIGRATION: yok — takım boyutu mevcut `chat_access` + `groups` tablolarından okunur; yeni kolon eklenmez (birincil-grup kolonu bilinçli olarak açık soru bırakıldı)
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 63.6. 07.5-f [SONNET-XHIGH] CSV export: breakdown grubunu dört boyuta genişlet (uzun format)

**Status:** done  
**Dependencies:** 63.2, 63.4, 63.5  

'breakdown' grubunun CSV'si UZUN FORMAT'a geçer: `dimension,key,chats,closed,manual,assisted,automated`; `dimension` ∈ {day, hour, team, channel}, `key` = tarih / saat / takım adı / kanal etiketi. Dört boyut TEK dosyada, sırayla. `REPORT_GROUPS` katalogu (reports-export.ts:38-43) DEĞİŞMEZ — yeni grup eklenmez, `/reports/groups`, scope gating ve dosya adı deseni aynen kalır. Mevcut formula-injectio

**Details:**

07.5-f — CSV export: breakdown grubunu dört boyuta genişlet (uzun format)  [SONNET-XHIGH]

PRD: FR-MOD-07.5 (+ FR-MOD-07.7 export)
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. 4 dosya; güvenlik sınırı yok — aynı `reports_read` scope'u, aynı `withTenant`, YENİ SORGU YAZILMAZ (mevcut helper'lar çağrılır; reports-export.ts ilkesi: "reuses the report's aggregation helpers rather than recomputing"); eşzamanlılık yok; yeni algoritma yok — kopyalanacak desen `buildGroupCsv` 'breakdown' case'i (reports.ts:378-391) ismen verildi; kontrat değişmez; KK mekanik (satır sayısı + değer eşitliği).
NEDEN AÇIK: reports.ts `buildGroupCsv` 'breakdown' case'i (satır 378-391) YALNIZ `breakdownByDay()` çıktısını seri hale getiriyor: `headers: ['date','chats','closed','manual','assisted','automated']`. Yeni boyutlar eklenince ekran ile indirme ayrışır — oysa reports-export.ts dosya başlığı bunu açıkça yasaklıyor: CSV "can never disagree with the screen it was exported from".
KAPSAM: 'breakdown' grubunun CSV'si UZUN FORMAT'a geçer: `dimension,key,chats,closed,manual,assisted,automated`; `dimension` ∈ {day, hour, team, channel}, `key` = tarih / saat / takım adı / kanal etiketi. Dört boyut TEK dosyada, sırayla. `REPORT_GROUPS` katalogu (reports-export.ts:38-43) DEĞİŞMEZ — yeni grup eklenmez, `/reports/groups`, scope gating ve dosya adı deseni aynen kalır. Mevcut formula-injection guard'ı ve quoting serialiser'ı DEĞİŞMEZ.
DOSYALAR: apps/api/src/routes/reports.ts · apps/api/src/routes/reports-export.ts · apps/api/src/routes/reports-export.test.ts · apps/api/test/integration/reports-billing.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/reports.ts:378-391 — `buildGroupCsv` 'breakdown' case: helper'ı çağır, headers+rows döndür · apps/api/src/routes/reports.ts — aynı fonksiyonun 'reviews' case'i (~410-420): çok alanlı satır map'leme · apps/api/src/routes/reports-export.test.ts — CSV quoting / formula-injection guard unit test deseni · apps/api/test/integration/reports-billing.test.ts:847-860 — export indirme + Content-Disposition dosya adı iddiası
KK (birebir): "Boyutlu kırılım" | "KK-türetilmiş: "İndirilen CSV, ekranın gösterdiği dört boyutun AYNISINI ve aynı sayıları taşır — ekran ile indirme asla ayrışmaz." — PRD 07.5 KK'sı tek kelimelik; export tutarlılık kriteri 07.7'nin export maddesinden ve reports-export.ts'in kendi ilkesinden türetildi."
KK DOĞRULAMA: integration: aynı pencerede `/reports/breakdown` ve `/reports/export?group=breakdown` çağrılır; CSV satır sayısı === by_day+by_hour+by_team+by_channel satır toplamı ve her satırın sayıları JSON yanıtıyla birebir eşit. Mevcut dosya adı testi (reports-billing.test.ts:850) ve scope gating testi (satır 907) DEĞİŞMEDEN yeşil kalır.
KAPSAM DIŞI: PDF / benchmark karşılaştırma (v2 — PLAN §4.4.8'de zaten kapsam dışı) · Yeni rapor grubu (REPORT_GROUPS katalogu değişmez) · overview/ai-agent/reviews gruplarının formatı · UI
SÖZLEŞME: yok — /reports/export yanıtı CSV (text/csv), OpenAPI'de gövde şeması taşımıyor; yeni path/parametre eklenmiyor.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 63.7. 07.5-g [SONNET-XHIGH] Breakdown sekmesi: "By hour" bölümü (salt-okunur tablo + empty state)

**Status:** done  
**Dependencies:** 63.2  

Yerel `ReportsBreakdown` arayüzüne opsiyonel `by_hour?: Array<SplitRow & { hour: number }>`; `BreakdownTab`'e üçüncü `Section` — başlık "By hour", description UTC saat kovasını söyler; satır etiketi `00:00`–`23:00`; mevcut `SplitTable` bileşeni AYNEN kullanılır (yeni tablo bileşeni yazılmaz). Alan yoksa/boşsa mevcut `EmptyState` deseni. "By day"/"By agent" blokları DEĞİŞMEZ.

**Details:**

07.5-g — Breakdown sekmesi: "By hour" bölümü (salt-okunur tablo + empty state)  [SONNET-XHIGH]

PRD: FR-MOD-07.5
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. 3 dosya (sayfa + unit test + e2e); güvenlik sınırı yok — salt-okunur render, veri zaten yetkilendirilmiş endpoint'ten geliyor; eşzamanlılık yok; yeni UI kompozisyonu yok — `Section`+`Card`+`SplitTable`+`EmptyState` deseni AYNI DOSYADA iki kez var (satır ~790-830) ve ismen verildi; kontrat değişmez; KK mekanik (render + empty state).
NEDEN AÇIK: apps/web/src/features/reports/ReportsPage.tsx `BreakdownTab` (satır ~770-830) YALNIZ iki `Section` render ediyor: "By day" ve "By agent". Yerel `interface ReportsBreakdown` (satır ~83-87) da yalnız `by_day` + `by_agent` taşıyor — saat/takım/kanal için ne tip ne bileşen var.
KAPSAM: Yerel `ReportsBreakdown` arayüzüne opsiyonel `by_hour?: Array<SplitRow & { hour: number }>`; `BreakdownTab`'e üçüncü `Section` — başlık "By hour", description UTC saat kovasını söyler; satır etiketi `00:00`–`23:00`; mevcut `SplitTable` bileşeni AYNEN kullanılır (yeni tablo bileşeni yazılmaz). Alan yoksa/boşsa mevcut `EmptyState` deseni. "By day"/"By agent" blokları DEĞİŞMEZ.
DOSYALAR: apps/web/src/features/reports/ReportsPage.tsx · apps/web/src/features/reports/ReportsPage.test.tsx · apps/e2e/tests/reports.spec.ts
REFERANS DESEN (kopyalanacak): apps/web/src/features/reports/ReportsPage.tsx — `BreakdownTab`'in "By day" ve "By agent" Section+Card+EmptyState+SplitTable blokları (satır ~790-830) birebir kopyalanır · apps/web/src/features/reports/ReportsPage.tsx — `SplitTable` bileşeni (satır ~835+): caption/firstColumn/rows props sözleşmesi · apps/e2e/tests/reports.spec.ts:44-46 — `getByRole('region', { name: 'By day' })` görünürlük iddiası deseni
KK (birebir): "Boyutlu kırılım" | "KK-türetilmiş: "Breakdown sekmesinde saat boyutu ayrı bir bölüm olarak görünür; veri yoksa boş dikdörtgen değil anlamlı empty state çıkar." — PRD KK'sı tek kelimelik; empty-state şartı depoda yerleşik FR-EK-B.1 kuralından ("her boş liste için anlamlı empty state (boş dikdörtgen yok)") ve mevcut BreakdownTab davranışından türetildi."
KK DOĞRULAMA: ReportsPage.test.tsx unit: (1) `by_hour` dolu yanıt → 24 satır + `00:00`/`23:00` etiketleri görünür; (2) `by_hour: []` veya alan yok → EmptyState metni görünür, boş tablo değil. E2E reports.spec.ts: Breakdown sekmesinde `region name: 'By hour'` görünür (mevcut 'By day' iddiasının yanına).
KAPSAM DIŞI: By team / By channel bölümleri (07.5-h) · Grafik/chart görselleştirme (mevcut tasarım tablo tabanlı) · Boyut seçici/filtre UI'ı · Saat dilimi seçici
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 63.8. 07.5-h [SONNET-XHIGH] Breakdown sekmesi: "By team" + "By channel" bölümleri + örtüşme dipnotu

**Status:** done  
**Dependencies:** 63.4, 63.5  

Yerel arayüze opsiyonel `by_team?`, `by_channel?`, `overlapping?`; iki `Section` daha: "By team" (etiket = takım adı, gruba açık olmayanlar 'Unassigned') ve "By channel" (etiket = kanal; 'website' dahil). `overlapping === true` iken "By team" Section description'ına açıklayıcı dipnot: bir sohbet birden fazla takıma açık olabilir, satır toplamı toplam sohbeti aşabilir (07.5-e'nin beyanı ekrana taşı

**Details:**

07.5-h — Breakdown sekmesi: "By team" + "By channel" bölümleri + örtüşme dipnotu  [SONNET-XHIGH]

PRD: FR-MOD-07.5
ETİKET GEREKÇESİ: SONNET-XHIGH: koşul 1-6 sağlandı. 3 dosya; güvenlik sınırı yok — salt-okunur render; örtüşme/çift sayım KARARI 07.5-e'de verildi ve `overlapping` bayrağı olarak yanıtta geliyor, bu pencere yalnız onu GÖSTERİR (karar vermez); eşzamanlılık/algoritma yok; kopyalanacak desen aynı dosyadaki By day/By agent blokları + 07.5-g'nin By hour bloğu; kontrat değişmez; KK mekanik.
NEDEN AÇIK: ReportsPage.tsx `BreakdownTab` yalnız by_day + by_agent render ediyor (satır ~770-830); yerel `ReportsBreakdown` arayüzünde (satır ~83-87) `by_team`/`by_channel`/`overlapping` yok — takım ve kanal için ne sekme ne tablo var.
KAPSAM: Yerel arayüze opsiyonel `by_team?`, `by_channel?`, `overlapping?`; iki `Section` daha: "By team" (etiket = takım adı, gruba açık olmayanlar 'Unassigned') ve "By channel" (etiket = kanal; 'website' dahil). `overlapping === true` iken "By team" Section description'ına açıklayıcı dipnot: bir sohbet birden fazla takıma açık olabilir, satır toplamı toplam sohbeti aşabilir (07.5-e'nin beyanı ekrana taşınır — sessiz çift sayım yasak). İkisinde de boş veri → `EmptyState`. Mevcut `SplitTable` AYNEN kullanılır.
DOSYALAR: apps/web/src/features/reports/ReportsPage.tsx · apps/web/src/features/reports/ReportsPage.test.tsx · apps/e2e/tests/reports.spec.ts
REFERANS DESEN (kopyalanacak): apps/web/src/features/reports/ReportsPage.tsx — "By day" / "By agent" Section+Card+EmptyState+SplitTable blokları (satır ~790-830) · apps/web/src/features/reports/ReportsPage.tsx — `SplitTable` (satır ~835+) ve `Section` description prop kullanımı (dipnot metni buraya girer) · apps/e2e/tests/reports.spec.ts:44-46 — region görünürlük iddiası
KK (birebir): "Boyutlu kırılım" | "KK-türetilmiş: "Breakdown sekmesinde takım ve kanal boyutları ayrı bölümler olarak görünür; takım satırlarındaki örtüşme (bir sohbetin birden fazla takımda sayılması) kullanıcıya açıkça bildirilir; boş boyutlar anlamlı empty state gösterir." — PRD KK'sı tek kelimelik; örtüşme bildirimi 07.5-e'nin M:N gerçeğinden (chat-service.ts:1246) zorunlu olarak türetildi, aksi halde ekran Overview toplamıyla çelişiyormuş gibi okunur."
KK DOĞRULAMA: ReportsPage.test.tsx unit: (1) `by_team` dolu → takım adları + 'Unassigned' satırı görünür; (2) `overlapping: true` → dipnot metni görünür, `false` → görünmez; (3) `by_channel` dolu → 'website' dahil kanal satırları; (4) her ikisi boş → EmptyState. E2E: `region name: 'By team'` ve `'By channel'` görünür.
KAPSAM DIŞI: By hour bölümü (07.5-g) · Grafik/chart görselleştirme · Takım/kanal filtre veya drill-down · Takım yönetimi ekranları
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 63.9. 07.5-i [OPUS-XHIGH] Uçtan uca doğrulama: dört boyut çapraz-tutarlılığı + NFR-P2 bütçe ölçümü

**Status:** done  
**Dependencies:** 63.6, 63.7, 63.8  

Çapraz-boyut invariant süiti + kapanış: (1) aynı pencerede SUM(by_day.chats) === SUM(by_hour.chats) === SUM(by_channel.chats) === Overview `chats`; (2) SUM(by_team.chats) >= chats ve fark yalnız `overlapping === true` iken var; (3) her boyutun her satırında manual+assisted+automated === closed (ADR-09 rapor=fatura hizası korunur); (4) e2e reports.spec.ts dört bölümü doğrular + CSV indirme dört `di

**Details:**

07.5-i — Uçtan uca doğrulama: dört boyut çapraz-tutarlılığı + NFR-P2 bütçe ölçümü  [OPUS-XHIGH]

PRD: FR-MOD-07.5 (+ NFR-P2, NFR-P7 read-replica, NFR-S4)
ETİKET GEREKÇESİ: OPUS-XHIGH: koşul 6 ihlali (KK mekanik değil — "Boyutlu kırılım" tek kelimelik; dört boyutun birbiriyle hangi eşitliği sağlaması gerektiği YORUM ister) + koşul 1 ihlali (kontrat+backend+CSV+UI+e2e beş yüzeyi aynı anda bağlar). NFR-P2 (okuma p99 <150ms) bütçesinin yeni join'lerle tutup tutmadığı bir ölçüm+yargı kararı. Güvenlik ÇEKİRDEĞİ yok (izolasyon 07.5-d/-e'de kapandı), o yüzden MAX değil XHIGH.
NEDEN AÇIK: Dört boyut üç ayrı pencerede (07.5-b/-d/-e) yazılıyor ve `SPLIT_COUNTS` fragment'i paylaşılıyor; hiçbiri tek başına "gün toplamı = saat toplamı = kanal toplamı" çapraz eşitliğini test etmiyor. Ayrıca mevcut e2e (apps/e2e/tests/reports.spec.ts:44-46) yalnız 'By day' bölümünü doğruluyor — dört bölümlü ekranın regresyon koruması yok.
KAPSAM: Çapraz-boyut invariant süiti + kapanış: (1) aynı pencerede SUM(by_day.chats) === SUM(by_hour.chats) === SUM(by_channel.chats) === Overview `chats`; (2) SUM(by_team.chats) >= chats ve fark yalnız `overlapping === true` iken var; (3) her boyutun her satırında manual+assisted+automated === closed (ADR-09 rapor=fatura hizası korunur); (4) e2e reports.spec.ts dört bölümü doğrular + CSV indirme dört `dimension` değerini içerir; (5) `EXPLAIN` ile üç yeni sorgunun planı ve süre ölçümü alınır, NFR-P2 bütçesine göre yargılanır, kanıt HANDOFF'a yazılır — bütçe aşılıyorsa NFR-P7 (read-replica/ayrı analitik yol) açık soru olarak kaydedilir (uygulanmaz); (6) contract-parity + tam DoD kapısı (typecheck+lint+unit+integration+build+e2e).
DOSYALAR: apps/api/test/integration/reports-billing.test.ts · apps/e2e/tests/reports.spec.ts · HANDOFF.md
REFERANS DESEN (kopyalanacak): apps/api/test/integration/reports-billing.test.ts:563-620 — 'breakdown (07.5)' bloğunun invariant + cross-tenant iddia yapısı · apps/api/test/integration/data-model.test.ts:274 — EXPLAIN ile sorgu planı iddia etme deseni (NFR-P2 kanıtı) · apps/e2e/tests/reports.spec.ts:29-46 — sekme gezinme + region görünürlük testi
KK (birebir): "Boyutlu kırılım" | "KK-türetilmiş: "Dört boyut (gün/saat/takım/kanal) aynı pencerede aynı toplamı verir; takım boyutundaki tek sapma açıkça beyan edilen örtüşmedir; hiçbir boyut Overview KPI'ı veya ADR-09 fatura sayacıyla çelişmez." — PRD KK sütunu tek kelimelik olduğu için çapraz-tutarlılık kriteri, mevcut ReportsBreakdown şemasının invariant cümlesinden ve ADR-09 rapor=fatura kuralından türetildi."
KK DOĞRULAMA: reports-billing.test.ts'e çapraz-boyut invariant testleri (kapsam 1-3) — "Boyutlu kırılım" KK'sının bütünlük payını kanıtlar; e2e dört bölümün görünürlüğünü; EXPLAIN ölçümü NFR-P2 payını; contract-parity kontrat payını kanıtlar.
KAPSAM DIŞI: Yeni boyut/metrik eklemek · Read-replica altyapısı kurmak (NFR-P7 — ölçüm bütçeyi aşarsa yalnız açık soru olarak kaydedilir) · PDF/benchmark export (v2) · Grafik görselleştirme
SÖZLEŞME: yok (doğrulama penceresi; contract-parity yalnız koşulur)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
