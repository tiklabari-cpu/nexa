# Thread ID = günlük kapsayıcı (`chat_id`), Chat ID = bağlantı (`thread_id`) — kimlik sözlüğü

- **Görev:** tm 284 (ID-GLOSSARY) · PLAN.md §D234
- **Tarih:** 2026-10-15
- **Durum:** Kabul edildi — sahip kararı **K1 = A** ("nexa'nın mevcut Chat'i günlük kapsayıcıdır = Thread ID; her bağlantı yeni bir nexa Thread'idir = Chat ID; ekrandaki adlar sahibin diline göre değişir", `SiyahTus-Analiz/04-gerekceler-ve-sorular.md` Karar kaydı K1). Varsayımlar: **ID-01-S1** (terimler İngilizce kalır + kısa açıklama), **ID-01-S2** (numaraya önek eklenmez), **ID-01-S3** (API dokümanında kod adları + panel adı).
- **Değiştirdiği karar:** yok. Kodun adlandırması korunur; yalnız sunum katmanındaki adlar değişir.
- **Bağlı görevler:** tm 285 (ID-04 gün sınırı), tm 286 (ID-02 günlük thread — kapsayıcının "üye + gün" davranışını o yapar), tm 288 (ID-08 yapılandırılmış log + AI karar kaydı), tm 329 (ID-05 numaranın görünmesi/kopyalanması), tm 332 (ID-06 numarayla arama).
- **Kod değişikliği:** yalnız adlar ve açıklamalar (aşağıda §5). DB kolonu, API alanı, webhook payload'ı ve log anahtarı değişmedi.

## 1. Sorun

Sahibin dilinde **Thread ID** üyenin o günkü konuşma grubudur, **Chat ID** her bağlantıdır. nexa kodunda `chat` ve `thread` kelimeleri bunun **tersini** anlatır: `Chat` (`apps/api/prisma/schema.prisma` `model Chat`) bir üyeyle süren ilişkinin kapsayıcısı, `Thread` (`model Thread`) onun içindeki tek kesintisiz konuşmadır. Sözlük olmadan bir ajan "şu Chat ID'ye bak" dediğinde geliştirici `chat_id`'ye bakar ve başka bir kaydı bulur; logda yanlış alan aranır; operatöre yanlış numara verilir. Bugün ekranda yalnız `chat.id` görünür ve adı "Chat ID"dir — yani sahibin tanımına göre **yanlış** etiketle.

## 2. Karar (K1 = A)

Kod adları değişmez. **Çeviri yalnız sunum katmanında** yapılır: panel etiketleri, dışa aktarma başlıkları, log görüntüleyicinin tooltip'i, API dokümanı sütunu, AI'ın kullanıcıya yazdığı metin.

### Eşleme tablosu

| Ekranda / dokümanda adı | Kod alanı                  | Tablo · sütun                  | Örnek          | Anlamı                                                                          |
| ----------------------- | -------------------------- | ------------------------------ | -------------- | ------------------------------------------------------------------------------- |
| **Thread ID** (günlük)  | `chat_id`                  | `chats.id`                     | `TJ1H8CFKRV`   | Üyenin o günkü konuşma grubu; içinde bir ya da çok bağlantı durur               |
| **Chat ID** (bağlantı)  | `thread_id`                | `threads.id`                   | `K3M9Q2XW7B`   | Tek kesintisiz bağlantı; her yeni bağlantıda yeni                               |
| **Message ID**          | `event_id` / `events.id`   | `events.id`                    | `K3M9Q2XW7B_7` | `<Chat ID>_<sıra no>`: numaranın başı bağlantıyı gösterir                       |
| **Member ID**           | `customer_id`              | `customers.id`                 | UUID           | Teknik numara; ekranda kısaltılır, dışarıya verilmez (ID-03)                    |
| **Request ID**          | `request_id`               | — (sunucu isteği)              | UUID           | Her sunucu isteğinin numarası (`x-request-id`); hata mesajında ve logda görünür |
| **Ticket ID**           | `ticket_id` / `tickets.id` | `tickets.id`                   | `Q7ZP4N2D8T`   | `Thread ID` ile aynı biçim, ayrı tablo                                          |
| **AI decision ID**      | `decision_id`              | `ai_decision_logs.id` (tm 288) | UUID           | AI'ın tek kararı (ID-08)                                                        |

Bu tablonun makinece okunan hâli `packages/types/src/id-glossary.ts` içindeki `ID_GLOSSARY`'dır (her tür için `screenName`, `labelKey`, `shortDescriptionKey`, `codeField`, `pattern`). Metinler web'de `apps/web/src/locales/{en,tr}/ids.ts` içindedir; mobil `apps/mobile/src/lib/idLabels.ts` tek dosyada aynı adları kullanır.

### Kurallar

1. **Kod adı ↔ ekran adı yalnız bir yönde çevrilir.** `chat_id` ekranda "Thread ID", `thread_id` ekranda "Chat ID" yazar. Bir ekran, log ya da dışa aktarma bu iki adı kendisi yazmaz; katalogdan (`ids.*`) alır. Web'de bunu `apps/web/src/lib/ids-glossary.test.ts` kaynakta aratarak denetler.
2. **Terimler İngilizce kalır (ID-01-S1)**, yanında kısa açıklama: Thread ID — "Üyenin bugünkü konuşma grubu"; Chat ID — "Bu bağlantı". İngilizce arayüzde de aynı iki terim, açıklaması çevrilmiş olarak.
3. **Numara biçimi değişmez (ID-01-S2).** Önek, tire, küçük harf yok; 10 karakter Crockford base32 (`SHORT_ID_RE`). Ctrl+F ve kopyala-yapıştır ekranda, logda ve dışa aktarmada aynı diziyi bulur. Hangisinin ne olduğunu etiket söyler, numara söylemez.
4. **Dışa aktarma başlığı iki adı birden taşır:** `Thread ID (chat_id)`, `Chat ID (thread_id)` (`idExportHeader`). Sahip ve geliştirici aynı dosyayı okur.
5. **API dokümanında kod adları + panel adı (ID-01-S3).** OpenAPI açıklamaları `Panelde: Thread ID (günlük)` / `Panelde: Chat ID (bağlantı)` notunu taşır; alan adları, webhook payload'ı ve log anahtarları kod adıyla kalır. RLS politikaları, migration'lar ve dış entegrasyonlar bu yüzden etkilenmez.
6. **Tür belirsizliği.** Üç tür aynı 10 karakterlik jetondur (günlük kapsayıcı, bağlantı, ticket) ve üç tür UUID'dir (üye, istek, AI kararı). Biçim tek başına türü seçemez; `classifyIdentifier(value)` değerin uyabileceği **bütün** türleri sırayla döner, ID-06 aramasında tür sunucuda lisans kapsamlı bir aramayla seçilir. Boş dönüş "bu bir numara değil" demektir (ad ya da e-posta aramasına düşer). Büyük/küçük harf katlanmaz: yanlış yazılmış değer geçerli görünmesin.

### Gün sınırı (ID-04)

"Günlük" kapsayıcının günü **kiracının saat dilimine** göre sayılır (K3): varsayılan **Europe/Istanbul 00:00**, ayarlardan 0–23 arası bir başlangıç saati; **süren konuşma gece yarısında bölünmez**. Bu görev yalnız adı ve eşlemeyi sabitler; gün sınırının uygulanması tm 285'te, "üye + gün" davranışı tm 286'dadır. Bugün kodda kapsayıcı müşteri başına tek aktif `Chat`'tir (`uq_one_active_chat`); gün sınırı gelene kadar "Thread ID" ekranda bu kapsayıcının numarasını gösterir ve bu ADR'nin hint'i ("bugünkü konuşma grubu") tm 286 ile gerçek olur. **Uygulama (tm 285, PLAN §D235):** ayar `inbox_settings.day_boundary_tz` (IANA, varsayılan `Europe/Istanbul`) + `day_boundary_hour` (0–23, varsayılan `0`); `PUT /settings/chat-timeout` ikisini de kabul eder (`Mars/Olympus` ve saat 24 → 400); gün anahtarı yalnız `@siyahtus/types` `localDayKey(at, tz, boundaryHour)` ile hesaplanır, SQL'de ayrı gün hesabı yoktur. Ayar workspace düzeyinde tek değer gibi okunur (`findFirst`, en son kaydedilen). **Uç durum:** ayar değişikliği yalnız **sonraki bağlantıları** etkiler; bir sohbetin gün anahtarı (`chats.local_day`, tm 286) bir kez yazılır ve ayar değişince yeniden hesaplanmaz — yani süren bir konuşma, ayar o sırada düzenlense bile bölünmez ve geçmiş günler kaymaz. Değişiklik denetim kaydına eski ve yeni sınırla yazılır. Platformun AI günlük kotası ve raporların gün kırılımı UTC'de kalır (K3 ile uyumlu); kotanın yenilenme anı ekranda yerel saatle ve UTC ile birlikte yazılır (tm 283.4).

### Günlük kapsayıcının veri modeli (ID-02 · tm 286.1, PLAN §D236)

- **Gün sütunları:** `chats.local_day` (DATE) + `chats.day_tz` (IANA adı). İkisi birlikte, bağlantı açılırken bir kez yazılır (`localDayKey`, yukarıdaki sınırla) ve bir daha hesaplanmaz; CHECK `chats_local_day_tz_pair` "ikisi ya da hiçbiri", `chats_day_tz_check` boş olmayan ad ister. **NULL = eski model:** ID-02'den önce açılmış sohbet bir güne dosyalanmamıştır ve geriye dönük doldurulmaz — thread'leri birçok güne yayılır, tek bir gün uydurmak birkaç günü tek Thread ID'ye koyardı.
- **Üye başına günde tek Thread ID:** kısmi tekil indeks `uq_chat_customer_day ON chats (license_id, customer_id, local_day) WHERE local_day IS NOT NULL`. `uq_one_active_chat`'ten farkı `active`'e bakmamasıdır (gün, açık bağlantı olsun olmasın tek sohbettir); yarışta kaybeden ekleme 23505 / Prisma `P2002` alır. Aynı indeks "üyenin o günkü sohbeti" aramasını RLS altında da indeks koşulunda tutar (`data-model.test.ts`, `siyahtus_app` ile EXPLAIN).
- **Bağlantının nasıl açıldığı:** `threads.opened_via` — `first_of_day` · `same_day_return` · `agent_start` · `agent_reopen` · `day_rollover` (`CONNECTION_OPENED_VIA`, CHECK `threads_opened_via_check` ve kontrat `ConnectionOpenedVia` aynı liste; test üçünü karşılaştırır). NULL = ID-02'den önce açılmış thread.
- **API:** `Chat.local_day`, `Chat.connections` (günlük sohbette günün bütün bağlantıları en eskiden yeniye; eski modelde yalnız en yenisi — onun eski thread'leri "bugünün" bağlantısı değil, geçmiş ziyaretlerdir), `Thread.opened_via`, `ChatSummary.connection_count`; her bağlantının dökümü `GET /chats/{id}/events?thread_id=` ile.
- **Webhook:** `thread_started` = var olan sohbetin altında açılan sonraki bağlantı (aynı gün dönüş); günün ilk bağlantısı `chat_started` ile duyurulur — bir açılış ikisiyle birden asla. `chat_started` ve `chat_deactivated` artık `thread_id` taşır.
- **Bu adımda yazan yok:** sütunları ziyaretçi yolu (tm 286.2) ve ajan yolları (tm 286.3) doldurur; o zamana kadar her yeni sohbet eski modelle açılır. 05'in bağlantı özetindeki `group_id` eklenmedi: bağlantı başına ekip bugün hiçbir yerde kayıtlı değil (`chat_access` sohbet başınadır), kaynağı yönlendirmeyi yazan alt görevde seçilecek.

### Ziyaretçi yolu (ID-02 · tm 286.2, PLAN §D237)

- **Tek giriş:** `POST /customer/chat/events` artık `ChatService.openOrContinueConnection`'ı çağırır; karar ve yazım **tek işlemde**. Gün, boşta kalma penceresi ve "açık bağlantı mesajı alır mı" kararı `services/chat/conversation-day.ts`'tedir (`resolveLocalDay`, `connectionIdleSeconds`, `continuesConnection`); yazımlar değişmezlerin yanında, `chat-service.ts`'te kalır.
- **(a) Açık bağlantı:** günü NULL (eski model) ya da bugün olan sohbet mesajı alır. Günü geçmiş bir gün olan sohbet, son olayı boşta kalma penceresinden (kiracının sohbet zaman aşımı, yoksa K2'nin 30 dakikası) yeniyse yine alır — **gece yarısı süren konuşmayı bölmez**; daha eskiyse sistem onu `day_rollover` nedeniyle kapatır (`chat.archived`, aktör `system`, istek numarası korunur) ve mesaj (b)'ye düşer. Kapatmadan önce sohbet satırı `FOR UPDATE` ile kilitlenir ve etkinlik kilitten sonra okunur.
- **(b) Açık bağlantı yok:** üyenin bugünkü sohbeti varsa yeniden açılır (koşullu `UPDATE … WHERE active = false`) ve altında yeni bağlantı açılır (`same_day_return`; dünkü kapatıldıysa `day_rollover`): yönlendirme bir varışınki gibidir ama önce **günün son atanan ajanı** müsait ve kapasitesi varsa ona gider (ID-02-S5, `RoutingService.assignIfAvailable`); yönlendirilen ekip `chat_access`'e **eklenir**, eskiler kalır (ID-02-S7); yalnız ajanlara görünen "Customer reconnected the same day" satırı ve `chat.connection_opened` denetim kaydı yazılır; dışarıya `thread_started` (`reason` = `opened_via`) gider, `chat_started` gitmez. `resume` kullanılmaz (bağlantıyı açan ajana atar). Bugünkü sohbet yoksa yeni sohbet `local_day` + `day_tz` ile açılır (`first_of_day` ya da `day_rollover`) ve `chat_started` ile duyurulur.
- **(c) Yarış:** kısmi tekil indeksler (`uq_one_active_chat`, `uq_chat_customer_day`, `uq_one_active_thread`) `P2002` verir (raw sorguda `P2010`/23505), veritabanı işlemi kilitlenme ya da yazma çakışması olarak keser (`P2034`, 40P01, 40001) ya da deneme değişikliği kendisi görür (`ConnectionRaceLost`); işlem zaten bütünüyle geri alınmıştır ve **bir kez** yeniden denenir — ilk commit'ten sonra açık bir bağlantı vardır, sonraki her deneme yalnız ekler.
- **Eleme:** spam filtresi, pre-chat formu ve dil kaydı "bağlantı açan mesaja" uygulanır; aynı gün dönüş ve devir de buna dahildir (`ChatService.opensConnection`, aynı karar, yazmadan).
- **K2 — 30 dakika:** zaman aşımı ayarlamamış kiracıda **widget** sohbetleri 30 dakika sessizlikte kapanır (`chat-timeout.ts`); mesajlaşma kanallarından gelen sohbet (gelen `channel_messages` satırı olan) kiracı kendi süresini ayarlayana kadar açık kalır. Ayarlanmış süre her sohbete uygulanır. Bu, ayarlamamış mevcut kiracılar için **davranış değişikliğidir**.
- **Widget:** kapanış istemleri (CSAT, post-chat formu) sohbet + bağlantıya göre anahtarlanır; aynı gün dönüşte sohbet numarası aynı kaldığı için önceki bağlantının istemi yeni bağlantıda temizlenir.
- **Kapsam dışı (tm 286.3):** ajanın `POST /chats`'i ve `resume`'u, kanal adaptörleri (`ChannelService` hâlâ `start`/`sendEvent` ile eski modelde açar), müşteri profilindeki "gün/bağlantı" sayacı, `listDayConnections`.

### Ajan yolları, kanal sohbetleri, bağlantının ekibi ve sayaçlar (ID-02 · tm 286.3, PLAN §D238)

- **`POST /chats` (`agent_start`):** üyenin açık sohbeti varsa, ziyaretçinin kuralıyla (2a) karar verilir — dünkü ve pencereden uzun sessiz bağlantı önce `day_rollover` ile kapanır (aktör `system`), canlıysa olduğu gibi döner (200). Yoksa konuşma üyenin gününde açılır: bugünkü sohbet varsa altında yeni bağlantı (aynı numara, 201; ekip `chat_access`'e eklenir, `chat.connection_opened` + `thread_started`), yoksa günün sohbeti (`chat_started`). Bağlantı her durumda `agent_start`'tır — devirle açılmış olsa bile onu açan ajandır. Yarış bir kez yeniden denenir.
- **`resume` (`agent_reopen`, ID-02-S6):** bugüne ya da hiçbir güne dosyalanmamış sohbet yerinde yeniden açılır (eski model kendi modelinde kalır; `continuesConnection`'ın NULL kuralı). **Geçmiş bir güne** dosyalanmış sohbet açılmaz — biten güne bağlantı eklenmez: konuşma üyenin bugünkü sohbetinde (varsa yeni bağlantı, yoksa günün sohbeti açılır) devam eder, yeni bağlantı ajana atanır, açılış satırı "Chat reopened" `properties.continued_from_chat_id` ile eski sohbeti gösterir, eski sohbetin ekipleri bugünküne eklenir (S7) ve yanıt **bugünün sohbetidir** (farklı numara; panel oraya geçer). Denetim `chat.reopened` bugünkü sohbetin satırıdır, metadata eski sohbeti de anar. Yerinde yeniden açma da artık `thread_started` ile duyurulur (sonraki bağlantı); günü açan devam `chat_started`'dır. Üyenin açık bir konuşması varken yeniden açma eskisi gibi 409.
- **Kanal sohbetleri:** `ChannelService` gelen mesajı ziyaretçi yolundan geçirir (`openOrContinueConnection`; spam elemesi `opensConnection` ile, denetim aktörü gönderen müşteri, IP yok). Gece yarısında bölme penceresi **sweep'in kapatacağı pencerenin aynısıdır** (`rolloverIdleSeconds`): kiracının süresi; yoksa widget sohbetine K2'nin 30 dakikası, kanal sohbetine **hiç** — K2 widget kuralıdır, kanal konuşması sessizlikle kapanmadığı sürece günün dönümünde de bölünmez.
- **Bağlantının ekibi:** `threads.group_id` (migration `20261015170000_thread_group`, yalnız genişletme, FK yok — `chat_access.group_id`'nin kuralı): yönlendirmenin seçtiği tek ekip, açılırken verilen tek ekip ya da transferin devrettiği ekip; hiçbiri ya da birden çoksa NULL (`connectionGroup`). S5 yapışkan atamada önceki bağlantının ekibi; yeniden açmada açılan konuşmanın son bağlantısının ekibi. Ekibe transfer açık bağlantının ekibini değiştirir (erişimi eskisi gibi değiştirir); ajana transfer değiştirmez. Kontrat `ChatConnection.group_id`.
- **Sayaçlar:** müşteri profili `chats_count` (gün = sohbet) + yeni `connections_count` (bağlantı = thread; raporların, SLA'nın, AI çözümünün ve puanın saydığı birim). Raporlar thread tabanlı kaldığı için değişmez — regresyon testi aynı bağlantıları bir günde tek sohbet ve bağlantı başına sohbet olarak iki kiracıda kurup Overview'u karşılaştırır.
- **AI-02 kancası:** `listDayConnections(tx, chatId, { excludeThreadId })` — günün diğer bağlantıları en eskiden yeniye, özet ve etiketleriyle (döküm değil); güne dosyalanmamış sohbette yalnız en yenisi; başka kiracının sohbeti boş gün okunur.

## 3. Seçenek B neden alınmadı

B, yeni bir "gün thread'i" tablosu açmayı önerirdi: sahibin Thread ID'si için yeni tablo, nexa `chats`/`threads` ayrı kalırdı. Maliyeti: ikinci bir kimlik katmanı, RLS politikaları ve migration'lar, bütün `chat_id` bağımlıları için çifte yazım. A aynı sonucu (sahibin dilinde iki kimlik) yeni tablo olmadan verir; çevirinin tek yeri sunum katmanıdır. B seçilirse ID-02, ID-05, ID-06 ve ID-08'in veri modeli kısımları yeniden yazılmalıdır.

## 4. Sonuçlar

- Ekranda, logda ve dışa aktarmada aynı iki ad aynı iki şeyi anlatır; "Chat ID" artık `thread_id`'dir.
- Bir ekranın "Chat ID" etiketini elle yazması test kırar (`ids-glossary.test.ts`); yeni kimlik türü `ID_KINDS`'a eklenince sözlük + web kataloğu + mobil sabitleri birlikte güncellenir, testler (`id-glossary.test.ts`, `ids-glossary.test.ts`, `idLabels.test.ts`) eksik anahtarı yakalar.
- Mevcut kullanıcı görünür değişiklik tek yerde: Inbox Ayrıntılar panelindeki "Chat ID" satırı **"Thread ID"** olur ve başlıktaki numaranın tooltip'i eklenir. Numaranın kendisi aynıdır.
- Webhook alıcıları ve API istemcileri etkilenmez.

## 5. Değişen dosyalar

| Katman   | Dosya                                                                                                                                                                                                                   |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| types    | `packages/types/src/id-glossary.ts` (+ test), `ids.ts` (`SHORT_ID_RE`, `EVENT_ID_RE`, `UUID_RE` dışa açıldı)                                                                                                            |
| contract | `packages/contract/openapi/openapi.yaml` (`Chat.id`, `ChatSummary.id`/`thread_id`, `Thread.id`/`chat_id`, `Event.chat_id`/`thread_id`, `ChatId` parametresi, `Webhook`), `paths/chats.yaml`, `paths/customer-chat.yaml` |
| web      | `apps/web/src/locales/{en,tr}/ids.ts` (yeni `ids` isim alanı), `DetailsPanel.tsx`, `ThreadHeader.tsx`, `lib/ids-glossary.test.ts`                                                                                       |
| mobile   | `apps/mobile/src/lib/idLabels.ts` (+ test)                                                                                                                                                                              |
