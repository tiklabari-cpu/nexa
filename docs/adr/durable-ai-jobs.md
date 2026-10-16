# ADR-11a — Kalıcı AI iş kuyruğu Postgres'te (`ai_jobs`, `SKIP LOCKED`, `LISTEN/NOTIFY`)

- **Görev:** tm 273 (ADR-DURABLE-AI-QUEUE) · PLAN.md §0 (ADR-11a eki) · §D222
- **Tarih:** 2026-10-14
- **Durum:** Kabul edildi — sahip kararı **K18** ("ADR-08a ve ADR-11a ekleri — ✅ Hepsi onaylı"); GV-02 sorularının varsayılanları **GV-02-S1** (120 sn) ve **GV-02-S2** (bildirim e-postaları ikinci adımda) (`SiyahTus-Analiz/04-gerekceler-ve-sorular.md`, Karar kaydı ve § GV-02).
- **Değiştirdiği karar:** ADR-11 (PLAN.md §0) — lafzı aynen kalır. Bu ek, ADR-11'in kapsamadığı bir şeyi tarif eder: **kaybolmaması gereken** arka plan işinin nerede durduğu. ADR tablosunun satırı değişmedi.
- **Bağlı görev:** tm 289 DURABLE-AI-QUEUE (GV-02) — uygulamayı o yaptı (2026-10-16); kabul maddelerinin testleri ve "açık kalan"ların karşılığı §5'te.
- **Kod değişikliği:** yok. Bu dosya yalnız kararı kayda geçirir.

## 1. Bağlam

ADR-11: _"Kafka/RabbitMQ YOK. Redis Streams (fan-out) + pub/sub (presence)"_.

Bugünkü durum (2026-10-14 HEAD'de yeniden doğrulandı):

- Ziyaretçi mesajından sonra kural botu, AI Agent ve atanan kişinin bildirimi **süreç belleğinde** sıraya girer: `apps/api/src/services/chat/follow-ups.ts` (`FollowUps`, anahtar `<license>:<chat>`, `MAX_FOLLOW_UPS_PER_KEY = 20` `:39`). Yorum açık: _"Not durable, on purpose … a process that dies with a job queued loses it"_ (`:31-35`). Kuyruğa alma `apps/api/src/routes/customer.ts:342` (`followUp`), iş `:380` (`respondToCustomerMessage`: önce `ruleBots.handle`, bot devralmadıysa `ai.handle`); AI yanıtı `apps/api/src/services/ai/ai-responder.ts:48`. Kapanışta boşaltma `apps/api/src/plugins/follow-ups.ts:31-36` (`onClose` → `settled()`).
- Risk kayıtlı: `docs/production-checklist.md` "Known risks" (_"There is no persisted AI queue (PLAN §D201) … a crash … loses that answer"_), PLAN §D201 (tm 256.10, arşivde).
- Projede kuyruk kütüphanesi (BullMQ vb.) yok. Postgres'te "talep et, süreyle kilitle, bitir" kalıbı hazır: `apps/api/src/services/webhooks/redelivery.ts` (koşullu talep + kira `:24-45`, ölen işçinin işi kira dolunca yeniden alınır, kiracılar arası okuma SECURITY DEFINER sayıcıyla `:189`). AI günlük bütçesi de bilerek Postgres'te: Redis kovaları açık-başarısız (`fail open`), _"a spend cap that opens when Redis is away is not a cap"_ (`apps/api/src/services/ai/ai-daily-budget.ts:13-16`).
- **ADR-11 ile kod arasındaki fark (bilgi):** repoda Redis Streams kullanımı yok (`XADD`/`XREAD` aranıp bulunmadı); gerçek zamanlı yayılım Redis **pub/sub** ile yapılıyor (`apps/api/src/services/realtime/publisher.ts:57` `redis.publish(licenseChannel(…))`). Bu ek o farkı düzeltmez, yalnız kayda geçirir.
- `LISTEN/NOTIFY` repoda hiç kullanılmıyor; API yalnız Prisma'yla bağlanıyor (`pg` sürücüsü bağımlılık değil).

GV-02 (P0) bu belleği kalıcı yapmayı istiyor: tek ev sunucusundaki pilotta her yeniden başlatma, güncelleme ya da bellek takılması o anda bekleyen AI cevaplarını sessizce kaybettiriyor. Kaybolmaması gereken bir iş Redis'e konursa ADR-11'in Redis'i kapsamı sessizce genişler ve Redis kesintisi iş kaybına dönüşür; Kafka/RabbitMQ ise ADR-11'le yasak. `SiyahTus-Analiz/05-uygulama-rehberi.md` "Uygulayıcı için kurallar" madde 4: kilitli karar sessizce delinmez, ilgili ADR'ye ek not yazılır. Bu dosya o ek nottur.

## 2. Karar

1. **AI işleri Postgres'te, `ai_jobs` tablosunda durur.** Satır ziyaretçi mesajıyla **aynı transaction'da** yazılır (outbox): mesaj commit'lendiyse iş de vardır, mesaj geri alındıysa iş de yoktur. `ChatService.sendEvent` / `start` kendi `withTenant` işlemini açtığı için bunlara isteğe bağlı bir "aynı işlemde yaz" kancası eklenir. Tablo kiracı tablosudur (RLS, lisans); tekillik `(license_id, trigger_event_id, kind)` — aynı mesaj için ikinci iş yazılamaz. İlk ve tek iş türü `kind = 'visitor_message'`.
2. **Alma SECURITY DEFINER `ai_jobs_claim` ile.** Fonksiyon `FOR UPDATE SKIP LOCKED` ile satır seçer ve **süreli kira** (`lease_until`) yazar; kiracılar arası okuma yalnız bu fonksiyondan geçer (`redelivery.ts` kalıbı, sabit `search_path`). Sonuç `ai_jobs_settle` ile yazılır. İş kendisi `withTenant` içinde, kiracının RLS'iyle çalışır. Kira dolan `running` iş başka işçi tarafından yeniden alınır (en çok 2 deneme): "talep edildi" bayrağı saatsiz olsaydı ölen işçinin işi sonsuza dek takılı kalırdı.
3. **Sohbet başına sıra.** Bir sohbette kirası geçerli bir `running` iş varken o sohbetten iş alınmaz; her sohbetten yalnız en eski `pending` iş alınır. Bugünkü bellek içi "sohbet başına tek iş, sırayla" garantisi böylece **birden çok API sürecinde de** tutar (bugün yalnız tek süreçte tutuyor).
4. **Düşük gecikme: `LISTEN/NOTIFY` + 500 ms yoklama.** Outbox işlemi commit'te `pg_notify` ile işçiyi uyandırır (NOTIFY yalnız commit'te teslim edilir; geri alınan işlem bildirim üretmez). Yükü kiracı verisi taşımaz — yalnız "iş var" uyandırmasıdır; işçi yine `ai_jobs_claim`'i çağırır. **NOTIFY bir hızlandırıcıdır, doğruluk koşulu değildir:** kaçan ya da kopan bir bildirimi 500 ms yoklama yakalar.
5. **Tazelik 120 sn (GV-02-S1).** İş çalıştırılmadan önce `now() - created_at > 120 sn` ise `expired` yazılır: oyuncuya bayat cevap gitmez, sohbete iç not ("AI yanıtı gecikti, insana devredildi") düşer, sohbet insan yönlendirmesine bırakılır (zaten kuyrukta ya da atanmışsa dokunulmaz) ve karar kaydına (ID-08) `expired` yazılır. Bir sohbette 20'den fazla bekleyen iş varsa yeni iş doğrudan `expired` yazılır — bugünkü `MAX_FOLLOW_UPS_PER_KEY` sınırının kalıcı karşılığı.
6. **Aynı mesaja asla iki cevap.** AI cevabı `properties.reply_to_event_id = trigger_event_id` taşır; işçi göndermeden önce bu özellikte bir olay var mı bakar, varsa iş `done`. Kira dolup yeniden alınan iş de bu kontrolden geçer — çift cevabı kira değil idempotens engeller.
7. **Redis'in rolü DEĞİŞMEZ.** Gerçek zamanlı yayılım ve presence bugünkü gibi Redis'te kalır (ADR-11; bugün pub/sub, bkz. §1). AI cevabı kalıcı olarak yazıldıktan sonra bugünkü yoldan yayınlanır; Redis kesikse cevap kaybolmaz, widget onu bir sonraki yoklamasında alır. Redis, kaybolmaması gereken bir işin **tek kopyasını** taşımaz.
8. **ADR-11'in "Kafka/RabbitMQ YOK" maddesi aynen.** Yeni bir kuyruk sunucusu ya da kütüphanesi (BullMQ, pg-boss vb.) eklenmez; `ai_jobs` bir mesaj aracısı değil, kiracı tablosudur.
9. **Kapsam yalnız ziyaretçi mesajına verilen otomatik cevap.** Kural botu, AI Agent ve atanan kişinin bildirimi aynı işte, bugünkü sırayla (`customer.ts:380` → bildirim) kalır. Ajan bildirim e-postalarının (`app.backgroundMail`) kalıcılaşması **ikinci adımdır** (GV-02-S2) ve tm 289'un kapsamında değildir; o gelene kadar e-posta bugünkü gibi bellekte ve en iyi çabayla gönderilir.

## 3. Sonuçlar

- **Uyumlu kalan:** ADR-11'in iki maddesi — Kafka/RabbitMQ yok, gerçek zamanlı yayılım ve presence Redis'te — aynen geçerli. Webhook yeniden gönderimi ve AI bütçesiyle aynı ilke genelleşir: kaybolması ya da Redis kesintisinde açık kalması kabul edilemeyen durum Postgres'te tutulur.
- **Değişen:** `follow-ups.ts`'in "kalıcı değil, bilerek" kararı AI dalı için kalkar; bellek içi `FollowUps` bu iş için emekliye ayrılır. Ziyaretçinin gönderisi bugünkü gibi modeli beklemez (§D201 korunur).
- **Bu turda sabitlenen ayrıntılar (tm 289 için):**
  1. `LISTEN` Prisma'nın havuzundan yapılamaz: işçi ayrı, uzun ömürlü tek bir bağlantı açar (havuzlayıcı arkasındaysa oturum modunda). Bu bağlantı eklenmezse ya da koparsa işçi yalnız 500 ms yoklamayla çalışır ve bu kabul edilir — doğruluk hiçbir zaman bildirime dayanmaz.
  2. Kural botu ve AI bugün `FastifyRequest` alıyor (`customer.ts:386-388`); işçide istek yoktur. İş, kiracı bağlamını ve `request_id`'yi satırdan açıkça taşır (ID-08'in `bindChatLogContext` notuyla aynı).
  3. **Varsayım:** `expired` işin insana devri otomatik devirdir; ADR-09a gereği bu thread "AI çözümü" sayılmaz. Devir yolu AI-11'in bekçisininkiyle aynıdır ("Önce AI" modunda yönlendirme devir anında, ADR-08a madde 4).
- **Açık kalan:** biten (`done`/`expired`/`failed`) satırların saklama süresi ve temizliği; `/health` dışında bir uyarı eşiği (kuyruk derinliği, en eski işin yaşı). tm 289 sabitler, sabitlediğini §D'ye yazar.
- **Bu eki delen bir değişiklik** (kaybolmaması gereken işin Redis'e taşınması, yeni bir kuyruk sunucusu ya da kütüphanesi, tazelik sınırının kaldırılması) yeni bir ADR eki ve sahip kararı ister.

## 4. Kaynaklar

- `SiyahTus-Analiz/03-eklenebilecekler.md` — GV-02 satırı (P0, F1, "KOD (risk listesi)").
- `SiyahTus-Analiz/04-gerekceler-ve-sorular.md` — Karar kaydı K18; § GV-02 (gerekçe, bağımlılıklar, netleştirilecek sorular 1–2).
- `SiyahTus-Analiz/05-uygulama-rehberi.md` — "Uygulayıcı için kurallar" madde 4; § GV-02 (mevcut kod, eklenecek yerler, kodlama mantığı 1–7, kabul kriterleri).
- `SiyahTus-Analiz/07-gorev-plani.md` — #273 Dalga 0; GV-02 → #289 (bağımlılık #273).
- `docs/production-checklist.md` — "Known risks", kalıcı AI kuyruğu yok maddesi.

## 5. Uygulama (tm 289 · 2026-10-16)

Beş alt görevde: şema + RLS + `ai_jobs_claim` / `ai_jobs_settle` (289.1, §D247), outbox kancası (289.2, §D248), işçi (289.3, §D249), ziyaretçi takibinin işçiye taşınması + `/health` (289.5, §D250), kapanış (289.4, §D251). Bellek içi `FollowUps` silindi; `docs/production-checklist.md` "Known risks" maddesi kalıcı kuyruğu anlatacak biçimde yeniden yazıldı.

**Kabul maddesi → onu koruyan test** (`apps/api/test/integration/`):

| Kabul maddesi (GV-02)                                                                                  | Test                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zorla durdurulup başlatılan süreçte ziyaretçi cevabı bir kez alır (120 sn içinde) ya da devir + iç not | `ai-job-worker.test.ts` "a process that hung right after claiming loses the job to the restarted one…", "…older than 120 s is not answered: expired, an internal note…", "…every attempt of which died is handed to a person…"; rota üzerinden `ai-job-followups.test.ts` "a job whose process stopped mid-answer is answered once, by the next process" |
| Aynı mesaja iki işçiyle eşzamanlı asla iki cevap                                                       | `ai-job-worker.test.ts` "two workers on one queue answer every message exactly once…", "a worker whose lease ran out cannot send…", "an answer that arrives while the handler runs is not doubled"; kural botu + AI için `ai-job-followups.test.ts` "a rule's reply is the message's one answer…"                                                        |
| Aynı sohbette cevaplar geliş sırasıyla                                                                 | `ai-job-worker.test.ts` "two workers … in each chat in order…"; `ai-jobs-outbox.test.ts` "creates the jobs of one chat in the order its messages were written"; `visitor-follow-ups.test.ts` "answers one chat's messages one at a time, in the order they came"                                                                                         |
| Normal yükte yazımdan iş başlangıcına p95 < 1 sn                                                       | `ai-job-worker.test.ts` "starts a job within a second of its message, p95" (`LISTEN` zili açık, 20 mesaj / 25 ms aralık; 2026-10-16 ölçümü üç koşuda p95 10–13 ms)                                                                                                                                                                                       |
| `/health` kuyruk derinliğini ve en eski işin yaşını gösterir                                           | `ai-job-followups.test.ts` "shows an admin how many jobs wait and run, across every workspace, and how old the oldest is", "shows nobody else the queue"                                                                                                                                                                                                 |

**§3 "Açık kalan" maddelerinin karşılığı:**

- **Saklama / temizlik:** ayrı süpürme yok — satır thread'ine `ON DELETE CASCADE` bağlı; konuşma saklama süpürmesi ve müşteri silme kuyruk geçmişini konuşmayla birlikte götürür (§D247).
- **Uyarı eşiği:** pilotta otomatik uyarı yok. Okuma yolu admin `/health` gövdesindeki `ai_jobs {pending, running, oldest_age_s}`; işletme kuralı `docs/production-checklist.md`'de ("an age that keeps growing means no worker is taking jobs"). Kök paneldeki sayılar 389.14'ün işi; eşikli uyarı gerekirse onu yeni bir görev ekler (§D251).

**ADR'den sapmalar (her biri kendi §D'sinde):** kanca `sendEvent` / `start`'ın yanında `openOrContinueConnection`'da da var, çünkü ziyaretçi yolu ID-02'den beri oradan geçiyor (§D248). "İnsan yönlendirmesi" bugün boş bir adım; bağlantılar açılışta zaten insanlara yönlendiriliyor, "Önce AI" modu yok (§D249). Tazelik ya da kapalı bağlantı yüzünden işleyicisiz biten işte atanan kişiye bildirim gitmez; devir notu panele gerçek zamanlı düşer (§D250).
