# nexa'da Chat / Thread kimlik modeli: bugünkü durum

Kaynak: nexa-main kodu, yalnızca okuma ile incelendi (2026-10-14). Dosya yolları repo köküne göredir.

## Kısa cevap

Bugün üye, konuşması kapandıktan sonra her geri gelişinde **yeni bir chat ID ve yeni bir thread ID** alıyor. Kodda takvim günü ya da saat dilimi mantığı yok. AI yalnızca cevapladığı tek mesajı görüyor. Thread ID arayüzde hiçbir yerde görünmüyor ve aranamıyor. **nexa'daki "chat" ve "thread" kelimeleri, senin tanımının tersini anlatıyor.**

## 1. Chat ve Thread nedir?

- **Chat** (`apps/api/prisma/schema.prisma:781-812`): Koddaki tanımı "tek bir müşteriyle süren ilişki". Bir lisans + müşteri için aynı anda yalnızca bir aktif chat olabiliyor (`uq_one_active_chat`). Bir chat'in altında birden çok thread bulunabiliyor.
- **Thread** (`schema.prisma:814-843`): Koddaki tanımı "chat içindeki tek kesintisiz konuşma". Bir chat'te aynı anda yalnızca bir aktif thread olabiliyor. Atanan ajan, kuyruk bilgisi ve `summary` alanı thread'de tutuluyor.
- **Event** (`schema.prisma:851-887`): Her mesaj satırı hem `thread_id` hem `chat_id` taşıyor. Tablo aylık bölümlere ayrılmış.
- **ID biçimi:** Chat ve thread ID'leri 10 karakterlik Crockford base32 kodları, örneğin `TJ1H8CFKRV` (`packages/types/src/ids.ts:19-51`). Müşteri ID'si UUID.

## 2. Ne zaman yeni chat, ne zaman yeni thread açılıyor?

- Üyenin **aktif** bir chat'i varsa mesaj ona ekleniyor; yeni ID üretilmiyor (`apps/api/src/routes/customer.ts:680-685`, `:813-826`).
- Aktif chat yoksa **yeni chat ve yeni thread** birlikte oluşturuluyor (`chat-service.ts:388-412`, `:1962-2014`).
- Mevcut bir chat'in içinde yeni thread yalnızca ajanın "Reopen" (yeniden aç) işlemiyle açılıyor (`POST /chats/:id/resume`). Bu işlem chat'i, onu açan ajana atıyor.
- Widget kapanmış bir chat'i hiçbir zaman yeniden kullanmıyor. Bu, PRD'deki "kapanınca yeni thread ile devam" ifadesiyle çelişiyor (`urun-gereksinim-dokumani-PRD.md:346`, `:914`).
- **Aynı gün ya da ertesi gün gelmek arasında fark yok.** Chat hâlâ aktifse aradan ne kadar zaman geçerse geçsin aynı chat'e devam ediliyor; kapanmışsa yenisi açılıyor.
- Chat şu durumlarda kapanıyor:
  - Ziyaretçi "End chat" der.
  - Ajan arşivler.
  - Boşta kalma süresi dolar (`InboxSettings.chatTimeoutSeconds`). Bu süre ayarlanmamışsa chat hiç otomatik kapanmıyor.
- `Organization.timezone` alanı var (varsayılan `UTC`), ama yalnızca transkript e-postalarında tarih biçimlendirmek için kullanılıyor.

## 3. Üye farklı ziyaretlerde nasıl tanınıyor?

- Widget, müşteri ID'sini tarayıcıda `localStorage['siyahtus.customer_id']` içinde saklıyor (`apps/widget/src/api.ts:188-235`).
- **Başka cihaz, temizlenmiş tarayıcı ya da gizli pencere = yeni müşteri kaydı.** Widget tarafında ziyaretleri e-posta ya da kullanıcı adıyla eşleştiren bir mekanizma yok.
- `username` alanı yeni ve henüz commit'lenmemiş bir değişiklikle geliyor (`schema.prisma:394-396`; migration `20261014090000_customer_username`). Migration'daki not açıkça "asla arama anahtarı değil: indeks yok, tekillik yok" diyor.
- E-posta için indeks var, ama yalnızca gelen e-posta kanalında eşleştirme için kullanılıyor.
- ⚠️ **Gizlilik riski:** Ad, e-posta ve kullanıcı adı doğrulanmamış bilgiler. AI geçmişi bunlarla eşleştirip hatırlarsa, biri başka bir üyenin kullanıcı adını yazarak o üyenin konuşmalarını görebilir.

## 4. ID'ler nerede görünüyor, nerede aranabiliyor?

- **Chat ID görünen yerler:**
  - Inbox başlığı ve kopyalama butonu (`ThreadHeader.tsx:54`, `:133-137`)
  - Details paneli (`DetailsPanel.tsx:182-183`)
  - Müşteri detayındaki konuşma listesi
  - Ticket'ın kaynak sohbeti
  - Skill çalışma kayıtları
  - Audit log
- **Thread ID arayüzde hiçbir yerde görünmüyor.** API bu bilgiyi döndürüyor, ama Inbox her zaman yalnızca en yeni thread'i yüklüyor (`useInbox.ts:99`).
- **Arama imkânları:**
  - Komut paleti yalnızca son 50 sohbet içinde, tarayıcı tarafında; müşteri adı, son mesaj ve chat ID'ye bakıyor. Thread ID ile aranamıyor.
  - `GET /chats` uç noktasında ID ya da metin araması yok.
  - Audit log'da metin araması bilinçli olarak kapsam dışı bırakılmış.
  - Mesaj metninde arama hiç yok.

## 5. Loglar

- **pino:** Loglar yalnızca stdout'a yazılıyor, arayüzde log görüntüleyici yok.
  - `chat_id` yalnızca AI ve bot loglarında açıkça yazılıyor.
  - Bazı yerlerde anahtar adı `chatId`, bazı yerlerde `chat_id`; yani tutarsız.
  - **Hiçbir log satırında `thread_id` yok.**
- **SkillRun:** Yalnızca `chatId` tutuyor, `threadId` yok.
- **Audit log:** Yalnızca arşivleme, yeniden açma, mesaj düzenleme ve devralma işlemlerinde thread ID'yi metadata olarak tutuyor.

## 6. AI'ın gördüğü geçmiş

- `AiResponder.handle` motoru geçmiş olmadan çağırıyor (`history = []`). Cevap prompt'u yalnızca o anki mesajdan ve bilgi bankası parçalarından oluşuyor.
- Geçmiş mesajları yüklemek için kullanılabilecek mevcut fonksiyonlar:
  - `readConversationTurns(tx, chatId)` (`copilot-service.ts:73-92`)
  - `ChatService.listEvents(..., {threadId})` (`chat-service.ts:242-317`)
  - "Konu" bilgisini saklamak için hazır bir yer: `Thread.summary`

## 7. Terim eşleşmesi: senin tanımın ve nexa

| Senin terimin | Senin anlamın | nexa'da en yakın karşılık | Fark |
|---|---|---|---|
| **Thread ID** | Üye + gün; aynı gün tekrar gelişlerde aynı kalır | **Chat** (uzun ömürlü kapsayıcı) | nexa'nın chat'i güne bağlı değil; widget kapanmış chat'i yeniden kullanmıyor |
| **Chat ID** | Her bağlantı/oturum için ayrı | **Thread** (chat içindeki tek konuşma) | Pratikte her thread kendi yeni chat'iyle açılıyor |

### Çözüm seçenekleri

- **A: Mevcut modele oturtmak** (kod incelemesinin önerisi; PRD ile de uyumlu)
  - Widget yeni konuşma başlattığında, sistem bu üyenin **kiracının saat diliminde aynı gün** kapanmış bir chat'i olup olmadığına bakar.
  - Varsa o chat yeni bir thread ile yeniden açılır: `resume` gibi, ama ajana atamadan, normal yönlendirmeyle. Yoksa yeni chat açılır.
  - AI aynı chat'in önceki thread'lerini okuyarak gün içini hatırlar.
  - Arayüzde etiketler senin dilinle düzenlenir. Kodda `chat.id` = "Thread ID (günlük)", `thread.id` = "Chat ID (oturum)".
  - **Yan etki:** Sohbet sayısı raporları, `Customer.chatsCount` ve puanlamaların hangi kayda bağlandığı değişir.
- **B: Yeni bir "gün thread'i" kavramı eklemek**
  - Örneğin üye + yerel tarih + saat dilimi anahtarlı bir `conversation_day` tablosu.
  - nexa'nın mevcut anlamları korunur, ama arayüz, log ve aramada görünmesi gereken üçüncü bir ID ortaya çıkar.
