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
