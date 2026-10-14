# ChatBot.com — Story oluşturma ve görsel Story Builder (BFS dokümantasyonu)

Tarih: 2026-10-14 · Hesap: 7 günlük deneme · Kapsam: /stories/create + builder

## 1. /stories/create — "Set up your chatbot"

Başlık: "Set up your chatbot" — "Train your chatbot with data, use our ready-to-use templates or start from scratch."

| Kart | Rozet | Açıklama (verbatim) |
|---|---|---|
| Blank Bot | — | Create a blank chatbot, which you can train and customize later. |
| Website | AI | Crawl your website’s content to get answers to popular user questions. |
| Zendesk | AI | Scan your Zendesk help center articles to answer customer questions. |
| KnowledgeBase | AI | Scrap your KnowledgeBase articles to answer customer questions. |
| Customer Service Bot | — | Answer popular customer questions 24/7. |
| Job Application Bot | — | Automate sourcing candidates to speed up your hiring process. |
| FAQ Bot | — | Answer frequently asked questions with a chatbot and save your time. |
| Lead Generation Bot | — | Support customers around the clock to boost sales. |
| + All templates | — | Tüm şablon galerisi (aşağıda) |

Not: Sayfanın üstünde kalıcı "Subscribe in N days to get your first month for $1 / Subscribe now" bandı var (tıklanmadı).

### 1.1 "All templates" (genişletilmiş galeri — toplam 14 şablon)

Galeride kategori/filtre yok; düz grid. İlk 8 karta ek olarak:

| Şablon | Açıklama (verbatim) | Tahmini kategori |
|---|---|---|
| Online Quiz Bot | Engage your customers with a chatbot quiz tailored to your needs. | Engagement |
| Sales Bot | Sell your products directly from the chat window | Satış/e-ticaret |
| University Bot | Automate your communication and admission process. | Eğitim |
| Customer Satisfaction | Automate collecting surveys to capture the voice and opinions of your customers. | Anket/CSAT |
| Create Freshdesk Tickets | Let customers create Freshdesk tickets in the Chat Widget. | Entegrasyon (Freshdesk) |
| Create HelpDesk Tickets | Let customers create HelpDesk tickets while chatting with your chatbot. | Entegrasyon (HelpDesk) |

**ÖNEMLİ DAVRANIŞ:** Bir şablon kartına tıklamak önizleme AÇMAZ — anında `POST /v2/templates/<slug>/import` ile yeni story oluşturur ve builder'a (`/dashboard/<storyId>/`) yönlendirir. Customer Service Bot şablonundan oluşturulan story builder'da **"Published"** durumuyla açıldı (şablon içe aktarımı yayınlanmış bir sürüm olarak geliyor). Kanala bağlı olup olmadığı builder'dan görünmüyor; "Published" burada sürüm durumu (draft vs published) anlamında. Herhangi bir düzenlemeden sonra sağ üstte mavi **Publish** butonu belirir (yayınlanmamış değişiklik var). Publish'e basılmadı.

## 2. Builder genel yapısı (canvas)

| Öğe | Konum | Not |
|---|---|---|
| ← (geri) | sol üst | Story listesine döner |
| Story adı | sol üst | Tıklayınca "Edit story name" modalı (input + Cancel/Save) |
| 📖 (kitap ikonu) | ad yanında | Knowledge Hub (bkz. 5.2) |
| 💬 ikon | ad yanında | Training modalı (bkz. 5.3) |
| ⚡ | sağ üst toolbar | Kategorili blok paleti (bkz. 4.5) |
| 🔍 | sağ üst | Canvas içinde blok arama |
| 🔌 | sağ üst | Entegrasyonlar |
| 🕘 | sağ üst | Sürüm geçmişi |
| ⚙️ | sağ üst | Story ayarları |
| Published / Publish | sağ üst | Değişiklik yoksa gri "Published"; değişiklik varsa mavi "Publish" |
| 🏠 / 100% / ↶ ↷ | sol alt | Merkeze dön, zoom, undo/redo |
| Support | sol alt | Destek sohbeti |
| Test your bot | sağ alt | Gömülü test paneli |

Canvas, soldan sağa ağaç: **Start point** → kökten dallanan bloklar. Start point'e tıklanınca: "Start point is a trigger point that shows where your chatbot starts the chat flow. It can't be edited." + "Start onboarding lesson". Her blok üzerinde hover'da **Edit name** ve **⋯** menüsü (ör. "Start testing from here") ve sağında **+** (sonraki blok ekle) var.

Blok düzenleyici sağ panelde açılır; URL `?blockId=<uuid>` olur. Panel kapanınca (✕, ✓ veya Esc) değişiklikler **otomatik kaydedilir** (draft). ✓ ile kaydedince ilk seferde ipucu: "Remember to click the Publish button when you finish your work. Otherwise, your changes won't be visible to users." (+ "Don't show again"). Boş mesaj/boş buton ile kaydetmede blok seviyesinde doğrulama hatası görülmedi.

### 2.1 Customer Service Bot şablonunun ürettiği yapı (canvas sırası)

```
Start point
├─ Welcome message  [Bot Response]  "Hi! I'm Support Bot 👨‍💻"
│   └─ 🔙 Main menu [Bot Response]
│       ├─ Our offer           [User Input] → Select product category [Bot Response]
│       ├─ ❓ Question          [User Input] → How can I help you? [Bot Response]
│       ├─ FAQ                 [User Input] → Type your question [Bot Response] → Popular questions [FAQ]
│       ├─ Feedback            [User Input] → Feedback flow [Flow]
│       ├─ Newsletter          [User Input] → Newsletter flow [Flow]
│       ├─ Contact us          [User Input] → Contact info [Bot Response]
│       ├─ 👋 Small talk        [User Input] → Go to Main menu [Go to step]
│       ├─ Main menu           [User Input] → Go to Main menu [Go to step]
│       └─ 🔑 Account issues    [User Input] → Account issues - menu [Bot Response]
│             ├─ Change email   [User Input] → Change email [Bot Response]
│             └─ Reset password [User Input] → Reset password [Bot Response]
├─ AI Assist  (Knowledge Hub + Training ile cevaplama modülü)
└─ Default fallback [Fallback]
    ├─ Bot doesn't understand 1x [Filter] → Please rephrase [Bot Response]
    └─ Bot doesn't understand 2x or more [Filter] → Contact us or start again [Bot Response]
```
Şablonla gelen custom attribute'lar: `feedback`, `feedback_comment`.


## 3. "+" (blok ekle) menüsü — bağlama duyarlı blok listesi

Her bloğun sağındaki **+** ile açılan menü (üstte "Search" kutusu, arama ile filtre; eşleşme yoksa "Nothing found. Please consider changing your search query."). **Menü içeriği bağlama göre değişir** (DOM'daki `data-type` iç adlarıyla):

| Bağlam (önceki blok) | Görünen blok tipleri |
|---|---|
| Start point'ten sonra (kök tetikleyici) | USER_INPUT (User Input), FAQ, ATTACHMENT (Attachment input), BOT_RESPONSE, ADD_TO_SEGMENT, ADD_TO_LEADS, REMOVE_FROM_SEGMENT (Delete from segment), SET_ATTRIBUTE, LC_GOAL (Mark Goal), LC_TAG (Tag chat), LC_TRANSCRIPT (Send transcript), FILTER — toplam 12 |
| Bot Response / AI Assist / Success dalından sonra (bot aksiyon bağlamı) | BOT_RESPONSE, BACKTRACKING, FALLBACK, FLOW, GOTO (Go to step), ADD_TO_SEGMENT, ADD_TO_LEADS, REMOVE_FROM_SEGMENT, WEBHOOK, SET_ATTRIBUTE, LC_TRANSFER (Transfer chat), LC_GOAL, LC_TAG, LC_TRANSCRIPT, CLOSE_CHAT, FILTER, ASK_A_QUESTION (Question), AB_TEST (A/B Test), FRESHDESK_TICKET (Create ticket), FRESHDESK_CONTACT (Add contact), SHOPIFY_PRODUCT_AVAILABILITY (Product availability), SHOPIFY_PRODUCT_CARDS (Show products), SHOPIFY_ORDER_STATUS (Order status), ZENDESK_TICKET (Create ticket), HELPDESK_TICKET (Create ticket) + hazır alt-akışlar "Order status flow", "Product availability flow" |
| A/B varyant dalı (A/B) veya Question→Failure dalı içinde | Yukarıdakiyle aynı ama **FALLBACK, FILTER ve AB_TEST yok** (iç içe A/B ve filtre yasak) |
| Backtracking'ten sonra (kullanıcı girdisi beklenen bağlam) | USER_INPUT, FAQ, ATTACHMENT + bot aksiyonlarının hepsi (BACKTRACKING hariç) |

Not: Menüde "Text / Quick reply / Card" gibi ayrı bloklar YOK — bunlar **Bot Response** bloğunun içindeki "Responses" paletinden eklenir (bkz. 4.1). Ayrı bir e-posta gönderme bloğu yok (yalnız "Send transcript" transkripti e-postayla yollar). Bekleme/Delay bloğu yok — gecikme her mesajın üstünde ayarlanır. "End chat" karşılığı **Close chat**.

### 3.1 Blok "⋯" menüsü (hover)
Edit · Move · Duplicate single block · Duplicate with children · Delete single block · Delete with children · Start testing from here. (AI Assist bloğunda yalnız "Start testing from here".) Hover'da ayrıca "Edit name" (blok etiketi) görünür.

## 4. Blok tipleri — alanlar, seçenekler, limitler

### 4.1 Bot Response (BOT_RESPONSE)
Sağ panel: "BOT RESPONSE" başlığı + blok adı input'u + solda **Responses** paleti. Bir blok içinde birden çok mesaj sırayla eklenir (⠿ ile sürükle-sırala, 🗑 sil). Her mesajın üstünde: **"+Ns delay"** (kaydırıcı **0.1s – 10s**; varsayılan ilk mesaj +1s, sonrakiler +2s) ve **"Add filter"** (mesaj bazında koşul).

| Öğe | Tür | Seçenekler/alanlar | Limit/doğrulama | Not |
|---|---|---|---|---|
| Text | mesaj | Metin; `{ }` ile attribute ekleme (chip, örn. 👤 Name; varsayılan değer `{{default_name}}` biçiminde), 😊 emoji | ~1024 karakter (22 karakterlik metinde sayaç "1002") | |
| Random text | mesaj | "Variants" 1, 2, … + → her gösterimde rastgele varyant | varyant başına metin limiti aynı | Tekrarlayan cevapları doğallaştırır |
| Image | mesaj | "Drag and drop or browse" yükleme | — | |
| Gallery | kart karuseli | Kart: görsel (drag&drop), "Type card title", "Type card description", **Button**(lar); "+ Add card" | — | Kart butonu = Button ayarları |
| Button | mesaj + dikey butonlar | "Enter your message..." + Button + "Add button" | — | |
| Quick reply | mesaj + yatay çipler | "Enter your message..." + Button + "+ Add button" | — | Örn. Main menu: Offer, FAQ, Contact us, Feedback, Discount, Account issues |

**Button (Button/Gallery kartı) ayar popover'ı** — sekmeler *General* / *Actions*:
- Button title
- Button type: **Send message** · **Go to block** · **Open URL** · **Phone call** · **Open Moment** (Your website URL + Window size: Full - 100% / Tall - 75% / Compact - 50%)
- "+ Add postback" → Postback value (butona basınca bota giden gizli değer; User Input eşleşmesinde kullanılır)
- Actions sekmesi → "+ Add new action": Add to segment · Remove from segment · Set custom attribute
- "Save settings"

**Quick reply butonu**: Button type yalnız **Send message** veya **Go to block**; + Add postback; Actions sekmesi aynı.

**Mesaj filtresi ("Add filter")** — açılan liste:
- USER DATA: custom attribute'lar (feedback, feedback_comment)
- STORY ATTRIBUTES (örnek değerleriyle): Message ("How are you?"), Score (0.7), Failures (3), Email, Name, Username, Integration (livechat), Language, Timezone, Region, Country, Referrer, Source, IP, City, Phone number, Last seen (tarih), Segment, User ID
- "+ Add filter for custom attribute"
- Koşul editörü (örn. Score): **equals · isn't equal · is less than · is greater than · is less than or equal · is greater than or equal** + Value + "Apply filter". Birden çok filtre arasında **and / or** bağlacı.
- Önemli: **Score** = NLP eşleşme güveni (0–1), **Failures** = art arda anlaşılamama sayısı → fallback'teki "1x / 2x or more" dallanması bu filtreyle yapılıyor.

### 4.2 User Input (USER_INPUT) — niyet/eşleşme bloğu
| Öğe | Tür | Seçenekler/alanlar | Limit/doğrulama | Not |
|---|---|---|---|---|
| Blok adı | input | örn. "Contact us" | | |
| Keywords | çip listesi + "+ Add keyword" | Tooltip: "Keywords is a matching system in ChatBot. It works great when you want a unique phrase or a word to trigger a bot response." Çip içinde `{…}` ile **entity parametresi**, 😊 | keyword başına **50 karakter** | Parametre popup: *Parameter validation* (system entity) + *Save to attribute* + Cancel/Done |
| User says | eğitim cümleleri | "Enter user message" ile yeni satır; satırda `{ }` entity, 😊 | cümle başına **256 karakter** | Tooltip: "User says is a matching system in ChatBot. This system analyzes the full user query to pair it with the chatbot response that matches the best." |
| Trigger from anywhere | toggle (varsayılan OFF) | | | "Let the user trigger this input interaction from any place in the Story." — global niyet |

**System entities** (Parameter validation listesi): Any (non-empty), Alphanumeric, Email, Integer, No (hayır eşanlamlıları), Number (ordinal+cardinal), Phone number, Temperature, URL, Yes, Yes - No. Hesapta custom entity yoktu (liste yalnız SYSTEM ENTITIES).

### 4.3 Question (ASK_A_QUESTION) — slot doldurma
Çıkışlar: **Success** ve **Failure** dalları. Panel: "+1s delay", birden çok soru adımı ("+ Add next question").

| Alan | Seçenekler | Not |
|---|---|---|
| Question variants | 1, 2, … + (rastgele varyant) | Metinde attribute chip: "Nice to meet you, 👤Name! What's your email address?" |
| Validate response with entity | system entity listesi (Any, Email, …) | |
| Save response to attribute | attribute seçici (Name, Email, custom…) | |
| Action on failure input | **Ask the next question** / **Go to the failure block** | |
| Ask [N] if the user reply is invalid | **until filled / once / 2 times / 3 times / 4 times / 5 times** | Yeniden sorma sayısı |

### 4.4 Diğer bloklar
| Blok | Alanlar/seçenekler | Dallar | Not |
|---|---|---|---|
| Go to step (GOTO) | Block (açılır liste) veya "click here to choose the element from the tree" | — | Döngü/geri dönüş ("Go to Main menu") |
| Flow (FLOW) | Alt-canvas; tıklayınca breadcrumb "Story > Newsletter flow", URL `?flowId=` | — | Modüler alt akış |
| Add to segment / Add to leads / Delete from segment | Segment seçici (kullanıcı sayısıyla) + "click here to create new segment" | — | Şablon içe aktarımı "Customer Service Bot — Newsletter" segmentini otomatik oluşturdu |
| Set attribute (SET_ATTRIBUTE) | SET [attribute: custom + global, "+ Add custom attribute"] TO [Type attribute value]; "+ Add attribute" ile çoklu | — | |
| Webhook (WEBHOOK) | Mevcut webhook seç / "+ Create new webhook" formu: Webhook name (required), Webhook URL (required), Verification token, Basic auth (username/password), Headers (key/value) | **Success / Failure** | Form yalnız görüntülendi, webhook oluşturulmadı |
| Transfer chat (LC_TRANSFER) | **Within the group** / **To another group** (+ "Transfer to another group" grup ID, varsayılan 0) | **Success / Failure** | LiveChat'e insan devri (bkz. bölüm 9) |
| Mark Goal (LC_GOAL) | "Add a goal" — goal adı | — | LiveChat hedefi |
| Tag chat (LC_TAG) | "Add a tag" — tag adı | — | LiveChat etiketi |
| Send transcript (LC_TRANSCRIPT) | Email: "Type your email or use attribute" | — | |
| Close chat (CLOSE_CHAT) | Düzenlenemez ("The Close chat block can't be edited.") | — (terminal) | |
| A/B Test (AB_TEST) | "Split your chatbot traffic" — varyant başına kaydırıcı + %; "Add new variant" | A, B (en fazla **5: A–E**) | Toplam **%100 olmalı**; değilse "Oops — This change can't be applied. The total traffic distribution must equal 100%…" + Cancel / Exit without saving |
| Backtracking (BACKTRACKING) | Search interactions: **Only subsequent** / **Subsequent and triggered from anywhere** | — | "Backtracking blocks previously matched interactions so that the user can't trigger them again." |
| Fallback (FALLBACK) | Kökte "Default fallback"; altına Filter (Failures = 1 / ≥ 2) + Bot Response | — | |
| Filter (FILTER) | Mesaj filtresiyle aynı attribute/koşul editörü, AND/OR | — | Dallanma için kardeş Filter blokları |
| AI Assist | Bkz. bölüm 5 | — | |
| Attachment input (ATTACHMENT) | Kullanıcıdan dosya bekler | | |
| FAQ | "Popular questions" FAQ bloğu | | |
| Entegrasyon blokları | Freshdesk Create ticket / Add contact, Zendesk ve HelpDesk Create ticket, Shopify Product availability / Show products / Order status | | Entegrasyon bağlı değilse kullanılamaz (bağlanmadı) |

Genel doğrulama gözlemi: boş metin/boş buton başlığıyla blok kaydedilebildi — blok düzeyinde zorunlu alan uyarısı yok (A/B %100 kuralı hariç). Her değişiklik sonrası "Saved" toast'ı ve panelde Undo/Redo görünür.

### 4.5 Builder üst araç çubuğu — diğer öğeler
| Öğe | Tür | İçerik | Not |
|---|---|---|---|
| ⚡ (Blocks paleti) | sağ panel | Kategorili blok kataloğu: **Interactions** (User Input, Bot Response, Fallback, Filter, Attachment input, Flow) · **Actions** (Go to step, FAQ, Add to leads, Add to segment, Delete from segment, Webhook, Set attribute, A/B Test, Question, Close chat, Backtracking) · **LiveChat actions** (Transfer chat, Mark Goal, Tag chat, Send transcript) · **Shopify actions** (Show products, Product availability, Order status) · **Shopify flows** (Order status flow, Product availability flow) · **Freshdesk actions** (Create ticket, Add contact) · **Zendesk actions** (Create ticket) · **HelpDesk actions** (Create ticket) | Sürükle-bırak katalog; "+" menüsünün tam/kategorili hali |
| 🔍 Search | açılır arama | Blok **içeriğinde** tam metin arama (ör. "password" → BOT RESPONSE "Account issues - menu", USER INPUT "Reset password", BOT RESPONSE "Reset password: To reset your password, log in to the Client Portal…"). İpucu: ↑↓ gez, ↵ seç, esc kapat | Büyük akışlarda çok faydalı |
| 🔌 Integrations | sağ panel "Add integration" | Chat Widget, LiveChat, HelpDesk, Messenger, Slack, Freshdesk, Shopify, Zapier, Zendesk, Webhook, WordPress — hepsi "Connect" (test story'leri hiçbir kanala bağlı değil) | Hiçbirine bağlanılmadı |
| 🕘 Version history | panel | Sürüm kartları: **v2 [Preview] [Draft]** "Last update: Today 3:00 PM" (⋯ → **Publish**) · **v1 [Published]** "Today 2:46 PM by <kullanıcı>" (⋯ → **Edit name**, **Restore**) | Draft/Published ayrımı + geri yükleme |
| ⚙️ menü | açılır | Attributes & Entities · Dark mode · Navigation mode · Bot settings | bkz. 6, 7 |
| 📖 Knowledge Hub | modal | bkz. 5 | |
| 💬 Training | modal | bkz. 5.3 | |

## 5. AI özellikleri

### 5.1 AI Assist bloğu
Kökte (Start point'in doğrudan çocuğu) duran mavi **AI Assist** modülü. Tıklayınca: "This module enables your chatbot to utilize the **Knowledge Hub** and **Training** data to answer your customers questions." + **Edit Knowledge Hub** butonu. Kendi ayar paneli yok (prompt/talimat/ton/uzunluk alanı **yok**).

Akıştaki öncelik (test panelinde gözlenen): Kullanıcı mesajı önce story etkileşimleriyle (User Input/FAQ, güven eşiği) eşleştirilir; eşleşme yoksa AI Assist Knowledge Hub'dan cevap üretir; o da bulamazsa **Default fallback** çalışır.

### 5.2 Knowledge Hub (story bazında; URL `/dashboard/<storyId>/ai-knowledge/<kaynak>`)
Sol menü: **Websites · Articles · KnowledgeBase · Zendesk · Files (BETA)** (her birinde sayaç) + **Model usage: "N of 5000 Used content sources"** (deneme planında 5000 kaynak limiti). Üstte global "Search". "Learn" ve "How it works" (YouTube videosu: "Create your AI chatbot automatically with AI Knowledge").

| Kaynak | Ekleme | Alanlar/seçenekler | Durum/limit | Not |
|---|---|---|---|---|
| Websites | "Add content" → URL + tarama modu + **Train chatbot** | Tarama modu: **Scan a full page** (www.chatbot.com — tüm site), **Scan only nested pages** (…/help/*), **Scan a single page** (…/single-page.html). Alt not: "By sharing your URL, you confirm you have the necessary rights to share its content." | Taranan sayfalar **kategorilere** ayrılır (ör. "General – 1 pages"), kategori bazında aç/kapa. Liste kolonları: Title · Last edited · Source · State (**Used by AI**) ; "Add filter → Status" | Sayfa detayı: **Used by AI** toggle, 🗑 sil, ⟳ yeniden tara, **Content preview** (çıkarılan düz metin), Save and close. 1. taslakta Knowledge Hub içinden example.com taraması "General" iskeleti gösterip 0 sayfa ile sonuçlandı; 2. taslakta (sihirbaz) example.com tek sayfa başarıyla eklendi |
| Articles | "Add content" → editör | "Enter a title" + "Start writing your content..." + **Used by AI** toggle + **Save and close** | Kaydedince toast "Your article was created successfully"; State "Used by AI" | Manuel Q&A/politika metni için ideal |
| KnowledgeBase / Zendesk | Entegrasyon gerekir | "No content added" | Bağlanmadı | |
| Files (BETA) | "Add file" | "Upload a file to extract text data, which AI Assist can use…" | Dosya yüklenmedi | |

### 5.3 Training (💬 ikon; `/dashboard/<storyId>/training/…`)
| Bölüm | İçerik | Aksiyonlar |
|---|---|---|
| **Untrained questions** | Botun anlamadığı gerçek/test mesajları (ör. "I forgot my password", "Can I get a deposit bonus in bitcoin?"), tekrar sayısı rozeti, zaman | Satıra tıkla → inline cevap editörü (**B, I, link, madde, numaralı liste, `{ }` attribute, emoji**), "+ Add more questions" (aynı niyete varyant cümle), **Go to block** (cevabı mevcut bloğa yönlendir), ⓘ **Add to spam**, 🗑 sil. Toplu "Select all"; filtre "All Time", sıralama "Newest" |
| **Answered by AI** | AI Assist'in cevapladığı sorular + AI'ın verdiği cevap | Aynı editör: AI cevabını düzelt → eğitilmiş cevaba dönüştür |
| **Spam** | Spam'e atılanlar | |
| **Trained questions** | Kategoriler (varsayılan "General") + "Add new" kategori | Eğitilmiş Q&A deposu |

Test panelinde anlaşılmayan mesajın altında da kısayol çıkar: "This message was not recognized by bot. **Train your bot with this phrase.**"

### 5.4 AI ayarları (⚙️ → Bot settings modalı)
| Sekme | Alan | Seçenekler | Varsayılan |
|---|---|---|---|
| Navigation settings | Navigation mode | Trackpad / Mouse | Mouse |
| Bot settings | **Confidence score** — "the percentage, between 0 and 100, that defines how precisely your chatbot interprets the user input." | kaydırıcı + sayı | **70%** |
| Bot settings | Fallback → **React to Attachment input** — "Trigger a Fallback message when the user shares an attachment… but your Story doesn't contain the Attachment input interaction." | toggle | OFF |
| AI Assist | **Model** | **ChatBot AI Assist** / **OpenAI GPT-4.1** | ChatBot AI Assist |
| AI Assist | **Training confidence score** — "defines how precisely your chatbot interprets the user input." | kaydırıcı | **84%** |

**Yok olanlar (önemli):** Sistem talimatı/prompt, ton, cevap uzunluğu, dil, guardrail/yasaklı konu listesi, "kaynak göster" ayarı builder'da bulunamadı. AI davranışı yalnız içerik (Knowledge Hub + Training) + model seçimi + güven eşikleriyle kontrol ediliyor.

## 6. Entities & Attributes (⚙️ → Attributes & Entities; `/attributes-entities/...`)
| Öğe | Tür | Alanlar | Not |
|---|---|---|---|
| Custom attributes | liste + "+ Add new" | Ad (yalnız A-Z, 0-9, `-`, `_`; hata: "The attribute's name can only have letters A-Z, numbers 0-9, dash or underscore."), **Default value**, **Store value** toggle ("Remember the value of the attribute in future chats with the same visitor.") ; ⋯ → Rename / Delete | Şablondan: feedback, feedback_comment |
| Default (global) attributes | salt-okunur liste | Name, Email, Integration, Source, Avatar, Language, Timezone, IP, Gender, City, Region, Country, Referrer, Username, Phone number (+ filtrede Last seen, Segment, User ID, Message, Score, Failures) | |
| Entities (custom) | "+ Add new" → anında "Untitled" oluşturur (ad inline düzenlenir) | **Add entry** → Entry value + **Add synonym** çipleri; 🗑 ; "How it works" | Test: `claude_test_payment_method` = "papara" (eş anlamlı "paparam") |
| System entities | sabit | Any, Alphanumeric, Email, Integer, No, Number, Phone number, Temperature, URL, Yes, Yes - No | Keyword/User says/Question doğrulamasında |

Attribute kullanımı: mesajlarda `{ }` chip (varsayılan değerli), Set attribute bloğu, buton aksiyonu "Set custom attribute", Question "Save response to attribute", keyword parametresi "Save to attribute", filtrelerde koşul.

## 7. Test paneli ("Test your bot") ve hata ayıklama
- Sağ altta açılır sohbet penceresi ("Bot · Online"); **taslak (draft) sürümü** test eder (Publish gerekmez). Ataç ile dosya gönderme mümkün.
- Canvas **canlı izleme**: konuşma ilerledikçe kullanılan yol mavi çizgiyle vurgulanır ve aktif blok nabız animasyonuyla işaretlenir.
- ⋮ menüsü: **Debug mode** · **Returned user** (✓) · **Follow steps on the tree** (✓) · **Typing indicator** (✓) · **Reset chat**.
- **Debug mode** açıkken her bot cevabından önce "DEBUG MESSAGE" kartları: tetiklenen blok zinciri (ör. Default fallback → Filter → Bot Response). Kart tıklanınca zaman damgası + **Show JSON** → "JSON Response" modalı: `score` (eşleşme güveni), `failures` (art arda anlamama), `finished`, `attributes` {}, `diagram` (geçilen blok id'leri), `responses` [INPUT_MESSAGE, DEFAULT_FALLBACK, FILTER, BOT_RESPONSE{delay:2000, type:text, message}].
- Her bloğun ⋯ menüsünde **Start testing from here** (akışın ortasından test).

Test konuşması (CLAUDE-TEST Customer Service Bot):
| Kullanıcı | Bot | Yol |
|---|---|---|
| (açılış) | "Hi! I'm Support Bot 👨‍💻 Visitor" + "I can help you with the following topics ⬇" + Offer / FAQ / Contact us / Feedback / Discount / Account issues | Welcome → Main menu (Name attribute boş → varsayılan "Visitor") |
| How long do withdrawals take? | "Withdrawals are processed within **24 hours** after your identity verification (KYC) is completed." | AI Assist → Article (sadece ilgili cümleyi seçti, bonus/min tutarı eklemedi) |
| Can I get a deposit bonus in bitcoin? | "This message was not recognized by bot. Train your bot with this phrase." + "Could you rephrase your question to help me get it?" | AI cevap bulamadı → Default fallback (1x) — **uydurmadı** |
| contact | Galeri kartları: "Write to us — Send your email to support@example.com - we'll reply in 24 hours." [Email] [Main menu] + 2. kart (telefon) | Keyword eşleşmesi → Contact info |
| I forgot my password | Fallback "Could you rephrase…" | "Reset password" iç içe (Account issues altında) olduğu ve **Follow steps on the tree** açık olduğu için eşleşmedi → ağaç bağlamı katı |

## 8. Story düzeyi: ad, sürüm, yayın
| Öğe | Davranış |
|---|---|
| Ad | Başlığa tıkla → modal (Cancel/Save) veya inline; ad değişikliği yeni draft oluşturmaz |
| Draft vs Published | Şablon/sihirbazdan oluşturulan story **v1 Published** olarak doğar (kanala bağlı değil). İlk düzenlemede **v2 Draft (Preview)** oluşur, sağ üst buton mavi "Publish" olur. Publish'e basılmadı. |
| Otomatik kayıt | Her blok değişikliği anında kaydedilir ("Saved" toast); canvas sol altta global Undo/Redo, panel içinde ayrıca Undo/Redo |
| Version history | Sürüm listesi, Publish (draft'tan), Restore (eski sürüme dönüş), Edit name |
| Import/Export, Duplicate story, Share, dil ayarı | Builder içinde **bulunamadı** (story listesi/ayarlar diğer ajanın kapsamında) |
| Blank Bot / FAQ Bot / KnowledgeBase AI şablonları | Zaman nedeniyle oluşturulmadı (taslak limiti 3) |

### 8.1 Website (AI) sihirbazı — 3 adım
1. **Set up chatbot**: "Website — Scan your website content to generate answers to your customer questions." URL + tarama modu (full / nested / single page).
2. **Train**: "ChatBot classified 1 pages on your website into the following categories. You can manage categories used in training. If you click on each category, you can decide which category pages should be used to train the bot." Kategori kartı "General · 1 pages" + toggle; URL düzenlenebilir.
3. **Tune chatbot**: "Customize your welcome message" (varsayılan: "👋 Welcome to {{company_name}}! I'm ChatBot. Let me know how I can help you.") + quick reply "FAQ"; sağda canlı önizleme (site adı, Online). **Add chatbot** → story oluşur, builder'da "Published".

Website AI şablonunun ürettiği yapı:
```
Start point
├─ Welcome message [Bot Response]
│   ├─ FAQ [User Input] → [Bot Response]
│   ├─ Menu [User Input] → Show Menu [Bot Response]
│   ├─ Back to Menu [User Input] → Was it helpful? [Bot Response]
│   │     ├─ Yes [User Input] → Thank you! [Bot Response]
│   │     └─ No [User Input] → Back to Menu [Go to step]
│   └─ [FAQ bloğu] — grup "Small Talk": How are you? / Thanks a lot / hello / goodbye / no more questions
├─ AI Assist
└─ Default fallback → Fallback message [Bot Response]
```
**FAQ bloğu**: soru grupları ("+ Add question", "+ Add group", "Search question", "Trigger from anywhere"); her soru açılınca **User input** sekmesi (Keywords + User says — örn. "How are you?" için ~50+ hazır varyant) ve **Bot response** sekmesi.

## 9. İnsan temsilciye devir (handoff)
- Devir yalnız **LiveChat** entegrasyonu üzerinden: **Transfer chat** bloğu (Within the group / To another group + grup ID). Çıkış dalları **Success / Failure** (ör. Failure → "temsilci yok" mesajı, e-posta topla).
- Destekleyici LiveChat aksiyonları: **Tag chat** (etiket), **Mark Goal** (hedef), **Send transcript** (e-posta/attribute'a transkript), **Close chat**.
- Tetikleme stratejileri (builder imkanlarıyla): "Talk to human" User Input'u (**Trigger from anywhere** ON), fallback'te **Failures ≥ 2** filtresi → Transfer, AI cevap bulamayınca fallback zinciri → Transfer, buton (Go to block) ile menüden.
- HelpDesk/Freshdesk/Zendesk "Create ticket" blokları asenkron devir (ticket) alternatifi.
- Entegrasyon bağlı olmadığı için devir uçtan uca test edilemedi.

## 10. Bizim bot için çıkarımlar (iGaming / bahis canlı destek AI botu)

### Kopyalamaya değer
| Fikir | ChatBot.com'daki karşılığı | Bizde nasıl |
|---|---|---|
| **Katmanlı cevaplama**: kural/niyet → AI (RAG) → fallback | User Input/FAQ eşleşmesi → AI Assist (Knowledge Hub) → Default fallback | Kritik konular (çekim, KYC, hesap kilidi, sorumlu oyun) deterministik akışla; genel sorular RAG; bulamazsa uydurma yerine netleştirme sor → 2. denemede temsilciye devret |
| **Fallback sayacı** | `Failures` attribute + Filter (1x "rephrase", ≥2x "contact/handoff") | Art arda anlamama sayacı; 2. seferde otomatik canlı destek teklifi |
| **Güven skoru eşikleri** | Confidence score %70 (story), Training confidence %84 (AI) | Niyet ve RAG için ayrı eşik; eşik altı → netleştirme veya devir. Eşikleri panelden ayarlanabilir yap |
| **"Trigger from anywhere" global niyetler** | User Input toggle | "Temsilciye bağla", "çekimim nerede", "hesabımı kapat", "kumar bağımlılığı" gibi niyetler akışın her yerinden yakalanmalı |
| **Untrained questions / Answered by AI kuyruğu** | Training modalı: anlaşılmayanlar, AI'ın cevapladıkları, spam; inline düzelt → eğitilmiş Q&A | Operatör paneli: AI cevaplarını onayla/düzelt, anlaşılmayanları niyete bağla ("Go to block"), spam işaretle. Sürekli iyileştirme döngüsü |
| **Debug modu + JSON** | Test panelinde blok zinciri, score, failures, diagram, attributes | Admin test sohbetinde: eşleşen niyet, güven skoru, kullanılan bilgi kaynağı (doküman/paragraf), attribute durumu |
| **Canvas üzerinde canlı yol vurgusu** | Test sırasında mavi yol | Akış editörümüz varsa aynı görselleştirme |
| **Draft / Published + Restore** | Version history (v2 Draft, v1 Published, Restore) | Bot yapılandırması ve bilgi tabanı için sürümleme; yayın öncesi taslakta test; tek tıkla geri alma |
| **Slot doldurma (Question)** | Entity doğrulama + attribute'a kaydet + "Ask until filled / N times" + Success/Failure | Kullanıcı ID/e-posta/işlem ID toplama; doğrulama başarısızsa N denemeden sonra devir |
| **Custom entity + eş anlamlılar** | Entities: entry + synonyms | Ödeme yöntemleri (Papara, havale/EFT, kripto…), oyun türleri, bonus tipleri için sözlük; Türkçe argo/yazım varyantları |
| **Mesaj bazlı filtre** | Aynı blok içinde attribute koşullu mesaj (AND/OR) | Segment/VIP seviyesi/dil/ülke bazında farklı cevap (ör. ülkeye göre ödeme yöntemleri, VIP'e öncelikli devir) |
| **Random text varyantları + mesaj gecikmesi** | Random text, 0.1–10 s delay | Robotik görünmeyen, doğal tempolu cevaplar |
| **Kaynak bazında "Used by AI" toggle'ı** | Knowledge Hub her içerikte | Süresi geçmiş kampanya/bonus metinlerini silmeden AI'dan çekebilme; yayın tarihi/son kullanma alanı da ekleyin |
| **Web sitesi tarama modları** | full / nested / single page + kategori bazlı seçim + yeniden tara | Yardım merkezi ve bonus şartları sayfalarını periyodik yeniden tarama; kategori bazlı dahil/haric |
| **Devir dalları** | Transfer chat → Success/Failure, Tag, Goal, Transcript | Devirde etiket (konu, dil, VIP), konuşma özeti/transkript temsilciye; temsilci yoksa ticket/geri arama |
| **Hazır small-talk FAQ (50+ varyant)** | Website AI şablonunun FAQ bloğu | Türkçe small-talk paketi hazır gelsin |

### Kaçınılması / farklı yapılması gerekenler
| Sorun (ChatBot.com'da gözlenen) | Neden önemli (iGaming) | Öneri |
|---|---|---|
| **AI için talimat/ton/guardrail alanı yok** (yalnız model seçimi + eşik) | Bahis sektöründe yasal/sorumlu oyun kuralları, vaat yasakları ("kesin kazanç"), bonus şartı yanlış aktarımı ciddi risk | Sistem talimatı, yasaklı konu listesi, zorunlu uyarılar (18+, sorumlu oyun), "kaynakta yoksa söyleme" kuralı ve cevap uzunluğu/ton ayarları olmalı |
| AI cevabında **kaynak/atıf gösterilmiyor** | Kullanıcı ve denetim için izlenebilirlik | Debug'da ve opsiyonel olarak kullanıcıya kaynak linki |
| **"Follow steps on the tree" katılığı**: iç içe niyet ("I forgot my password") üst seviyede yakalanmadı | Kullanıcılar menüyü takip etmez; doğrudan sorar | Kritik niyetleri global yap; ağaç bağlamı yalnız slot doldururken bağlayıcı olsun |
| **Şablon tıklayınca anında story yaratıp "Published" yapıyor**, ayrıca segment otomatik oluşturuyor | Yan etkili, kafa karıştırıcı | Önizleme → onay → taslak olarak oluştur; yan kaynakları (segment) kullanıcıya göster |
| Blok seviyesinde **zorunlu alan doğrulaması yok** (boş mesaj/buton kaydedilebiliyor) | Canlıda boş/bozuk cevap riski | Publish öncesi lint: boş mesaj, hedefsiz buton, kopuk dal, erişilemeyen blok uyarıları |
| Webhook bloğu yalnız Success/Failure; cevap eşleme/timeout ayarı builder'da görünmüyor | Bakiye/çekim durumu sorgusu gibi canlı veriler gerekli | API aksiyonunda: timeout, yeniden deneme, cevap alanlarını attribute'a eşleme, hata mesajı şablonu; PII maskeleme |
| İnsan devri yalnız LiveChat ürününe bağlı | Bizim canlı destek altyapımız farklı olabilir | Sağlayıcıdan bağımsız handoff arayüzü (kuyruk, departman, dil, öncelik/VIP) |
| Dil/çok dilli içerik ayarı builder'da yok | TR + EN (+ diğer pazarlar) | Story/bilgi kaynağı bazında dil etiketi ve otomatik dil algılama |
| Untrained questions'ta niyet önerisi yok (manuel) | Hacim yüksek olacak | Benzer anlaşılmayan mesajları kümeleyip niyet önerisi sunun |

### Önerilen minimum mimari (özet)
1. **Global niyet katmanı** (anywhere): canlı destek, çekim durumu, yatırım sorunu, hesap/KYC, bonus şartları, sorumlu oyun/kendini dışlama, şikayet.
2. **Slot doldurma**: kullanıcı ID / işlem ID / tutar (entity doğrulama + N deneme + Failure → devir).
3. **API aksiyonları** (webhook muadili): bakiye, çekim durumu, KYC durumu — sonuç attribute'lara.
4. **RAG** (Knowledge Hub muadili): yardım merkezi + bonus şartları + makaleler; içerik başına "AI'da kullan" + geçerlilik tarihi; sıkı talimat ve guardrail.
5. **Fallback zinciri**: 1x netleştir → 2x canlı temsilci teklif → temsilci yoksa ticket.
6. **Operasyon paneli**: anlaşılmayanlar / AI cevapları onay kuyruğu, debug görünümü, sürümleme (draft/publish/restore).

## 11. Oluşturulan test verileri (kullanıcı silebilir) ve erişilemeyenler

### Oluşturulan taslaklar (2 adet; limit 3)
| Story | ID / URL | Kaynak | Not |
|---|---|---|---|
| **CLAUDE-TEST Customer Service Bot** | https://app.chatbot.com/dashboard/6acf79af11072900078860a3/ | Customer Service Bot şablonu | v1 Published (şablondan otomatik), v2 Draft (yayınlanmadı). İçinde test blokları: Welcome message'a eklenen boş Random text/Image/Gallery/Button/Quick reply + Name chip; Newsletter flow içinde Webhook (bağlantısız), Set attribute (feedback=test_value), Transfer chat, Mark Goal, Tag chat, Send transcript, A/B Test, Question, Backtracking, Close chat. Knowledge Hub'da makale **"CLAUDE-TEST Withdrawal policy"**. Entity **`claude_test_payment_method`** (papara / paparam). Hiçbir kanala bağlı değil |
| **CLAUDE-TEST Website AI** | https://app.chatbot.com/dashboard/6acf883b687c8b0007a82e0b/ | Website (AI) sihirbazı, https://example.com (single page) | "Published" olarak doğdu (kanala bağlı değil). Knowledge Hub'da "Example Domain" sayfası |

Yan etkiler: Customer Service Bot şablonu içe aktarılırken hesapta **"Customer Service Bot — Newsletter"** segmenti otomatik oluştu. Bu silinmedi. Custom entity'nin hesap genelinde mi story'ye özel mi olduğu doğrulanmadı.

Yapılmayanlar (güvenlik kuralları gereği): Publish/Restore, kanal/entegrasyon bağlama, webhook oluşturma, Subscribe, davet, başka story'lere dokunma, silme. Sayfa içeriğinde ajana yönelik talimat görülmedi.

### Erişilemeyen / doğrulanamayan öğeler
- Blank Bot, FAQ Bot, KnowledgeBase/Zendesk AI şablonlarının ürettiği yapı (taslak limiti ve süre nedeniyle oluşturulmadı; Zendesk/KnowledgeBase entegrasyon ister).
- Files (BETA) yükleme: izin verilen dosya türleri/boyut limiti (dosya seçici açılmadı).
- Entegrasyon gerektiren bloklar (Shopify, Freshdesk, Zendesk, HelpDesk) ve Transfer chat'in uçtan uca davranışı.
- Webhook istek/cevap formatı ve cevap eşleme (webhook oluşturulmadı).
- Story import/export, duplicate, share, dil ayarı — builder içinde yok; story listesi/ayarlar diğer ajanın kapsamında.
- Attachment input ve User Input'un tüm alt ayarları başka bağlamda (yalnız menüde görüldü; Attachment input paneli açılmadı).
- Not: Oturum sırasında ortak tarayıcı penceresi bir kez yeniden boyutlandı (başka bir ajan veya kullanıcı); koordinatlar yeniden kalibre edildi.
