# nexa (SiyahTuş): AI Agent'ın bugünkü çalışma şekli

Kaynak: nexa-main kodu yalnızca okunarak incelendi (2026-10-14). Dosya yolları repo köküne göredir.

## Özet

Bugünkü AI Agent kelime eşleşmesiyle tetiklenen, tek mesajlık bir adım motoru. Mesajlar arasında hafızası yok.

- **Skill seçimi:** Kelime örtüşmesine göre yapılıyor, LLM kullanılmıyor (eşik 0.6, `packages/ai-mock/src/intent.ts:29`). Aynı mesaja birden fazla skill uyarsa en son düzenlenen kazanıyor; öncelik alanı yok (`skill-engine.ts:234-296`).
- **Bilgi bankası (RAG):** Yalnızca bir skill'in `send_message(source:'knowledge')` adımının içinde çalışıyor. Kendi başına bir geri dönüş seçeneği değil. Benzerlik eşiği 0.25 (`knowledge-service.ts:110`).
- **Hiçbir skill uymazsa:** Bot hiçbir şey göndermiyor ve kayıt da tutulmuyor; cevaplanamayan sorular görünmez kalıyor.
- **Çok adımlı teşhis konuşması yapılamıyor.**
  - `request_info` soruyu soruyor, ama gelen cevabı okumuyor, doğrulamıyor, saklamıyor (`skill-engine.ts:443-459`, `791-799`).
  - Adımlar arasında koşul, dallanma ya da "cevabı bekle" yok.
  - Konuşma geçmişi motora aktarılmıyor (`history=[]`, `skill-engine.ts:285`). Ziyaretçi soruya cevap verdiğinde bu cevap yeni bir mesaj gibi baştan eşleştiriliyor.
- **İnsana devretme:**
  - Yalnızca açıkça eklenmiş bir `transfer_to_team` adımıyla oluyor. Takım adı serbest metin olarak yazılıyor; o adda takım yoksa sohbet olduğu yerde kalıyor (`ai-responder.ts:174-198`).
  - Otomatik devretme yok: müşteri "insanla görüşmek istiyorum" dese de, birkaç deneme başarısız olsa da, müşteri öfkeli olsa da devretmiyor.
  - Devirden sonra da AI her mesajda skill aramaya devam ediyor gibi görünüyor; sohbetin insana geçip geçmediği kontrol edilmiyor (`customer.ts:381-389`).
  - Devirde aktarılan özet bir şablondan ibaret: "Customer asked: <ilk 160 karakter>" (`skill-engine.ts:802-809`).
- **Profil:**
  - Düzenlenebilen alanlar: ad, avatar, ton, diller ve cevap uzunluğu.
  - `AiAgent.instruction` alanı veritabanında var ama hiçbir yerde kullanılmıyor.
  - Talimat (guidance) ya da yasak konu alanı yok.
  - Sistem prompt'u sabit (`provider/answer-prompt.ts:52-82`).
- **Bilgi deposu:** Tablolar tek (`KnowledgeSource` / `KnowledgeChunk`). Ancak AI Agent'ın ve Copilot'un kaynakları ayrı `AiAgent` kayıtlarına bağlı. Yani aynı içerik ikisine ayrı ayrı girilmek zorunda.
  - Marka ya da takıma göre ayırma yok.
  - Taslak/yayın ayrımı yok; skill'in yalnızca açık/kapalı durumu var.
  - Denetim günlüğüne yalnızca silme işlemleri yazılıyor.
- **Şablonlar:** 33 şablon var, hepsi e-ticaret ve SaaS için. Bahis, casino, yatırım, çekim ya da KYC şablonu yok.
- **Test:** `POST /skills/preview` tek bir mesaj üzerinde deneme yapıyor ve günlük AI kotasından düşüyor. Çok adımlı bir sohbet simülatörü yok.
- **Yetki:** Yapay zekâyı düzenleme yetkisi (`agents-bot--all:rw`) yalnızca owner, viceowner ve admin rollerinde var. Ekip lideri ya da içerik editörü rolü yok (`packages/types/src/role-scopes.ts`).
- **Geri bildirim döngüsü yok:** Cevaplanamayan sorular raporu, bilgi eksikleri listesi ve ajanın verdiği beğen/beğenme işareti yok.
- **Mock olanlar:** LLM ve embedding varsayılan olarak mock (`config/env.ts:685`, `:746`). Kelime eşleşmesi, talimat derleyicisi ve dil algılama kural tabanlı.

## "Param hesabıma yatmadı" senaryosu bugün nasıl çalışır?

1. Mesaj "deposit/para yatırma" ifadeleri tanımlı bir skill'e uyarsa, skill ilk soruyu sorar (örneğin "Ne zaman yatırdınız?").
2. Üye "dün akşam Papara ile 500 TL" diye cevap verir.
3. Bu cevap yeni bir mesaj gibi değerlendirilir. "Para yatırma" kalıbına uymadığı için hiçbir skill çalışmaz ve bot susar. Ya da daha kötüsü, hiçbir kalıp tanımlanmamış (catch-all) bir skill her mesaja uyar ve alakasız bir cevap verir.
4. Toplanan bilgi hiçbir yere kaydedilmez. İnsana devredilse bile ajan yalnızca ilk mesajı görür.

**Sonuç:** Senin tarif ettiğin akış (teşhis soruları sor → çözmeye çalış → çözemezsen özetleyip insana devret) bugünkü motorla kurulamıyor. Motorun çok adımlı konuşma yapabilecek şekilde yeniden tasarlanması gerekiyor.
