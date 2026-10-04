# Task ID: 176

**Title:** M-CAMP — Kampanya teslimati — modulun asil vaadi bosta

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Eslesen ziyaretciye YALNIZ bir `campaign_sends` satiri yaziliyor (campaign-service.ts:240); hicbir chat event, RTM push ya da widget mesaji uretilmiyor. `apps/widget` ve `apps/rtm` icinde "campaign" kelimesi bile gecmiyor, `engaged` uretimde hic true yapilmiyor, ve durum yalniz yazma aninda hesaplandigi icin sekme filtreleri zamanla yanlisa donuyor. Denetimin K2 kritik bulgusu.

**Details:**

PRD satır **522-535** (FR-MOD-03.3.2) · denetim `prd-uyum-denetimi.md` §5 K2.

**KARAR (verilmiş, tartışma değil):** teslimat **mevcut widget yoklaması** üzerinden — widget zaten 4 sn'de bir sunucuyu yokluyor (`apps/widget/src/widget.ts:24` `POLL_INTERVAL_MS = 4_000`) ve proaktif karşılama kartı mekanizması var (`GREETING`, `GREETING_DISMISSED_KEY`). **Yeni taşıma katmanı (soket) EKLENMEYECEK** — ayrı ve büyük bir iş, bu kalemde kapsam dışı.

**Yeniden kullan:** `matchesConditions` ve `visitorPageUrls` (`campaign-matching.ts`) mevcut ve testli; yeni eşleştirici yazma. İdempotanslık `(campaign, customer)` unique + `skipDuplicates` ile korunuyor — bozma.

**Test Strategy:**

Kalem bütününün kabul kriteri: kampanya oluştur → eşleşen ziyaretçi gelsin → widget yoklamasında kart **bir kez** görünsün → tıklayınca sohbet açılsın ve `engaged` true olsun. Cross-tenant: B lisansının kampanyası A ziyaretçisine asla ulaşmaz.

## Subtasks

### 176.1. M-CAMP-a [SONNET-XHIGH] campaign_sends.delivered_at migration + teslimat sorgusuna indeks kararı

**Status:** done  
**Dependencies:** None  

`deliveredAt DateTime? @map("delivered_at") @db.Timestamptz(6)`. Yeni migration aç — uygulanmış olanı düzenleme. NULL = henüz teslim edilmedi (geriye dönük zaman uydurma). `-b`nin sorgu şekline göre `(license_id, customer_id, delivered_at)` indeksi gerekiyor mu ölç; gerekmiyorsa açma ve nedenini yaz. `db:check-drift` exit 0.

**Details:**

Bağımlılık: yok. Dilim V7-1. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 176.2. M-CAMP-b [OPUS-MAX] BÖLÜNMEZ: yoklama cevabına bekleyen kampanya + delivered_at damgası (teslimat garantisi)

**Status:** done  
**Dependencies:** None  

`routes/customer.ts` yoklama ucu: `delivered_at IS NULL` gönderim varsa mesajı cevaba ekle ve **aynı işlemde** damgala. Karar ver ve yorumla: (1) birden çok bekleyen gönderimde seçim kuralı (öneri: en eski, tek seferde bir tane); (2) damgalama ile cevabın ulaşması arasında kopan bağlantı — **en-fazla-bir-kez mi en-az-bir-kez mi**, kampanya mesajı için hangisi daha az zararlı? Kontrat: `customer-chat.yaml` + `contract:generate` + generated senkron. Cross-tenant izolasyon zorunlu.

**Details:**

Bağımlılık: M-CAMP-a. Dilim V7-1. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 176.3. M-CAMP-c [SONNET-XHIGH] Widget kampanya kartı — mevcut proaktif kart mekanizmasını yeniden kullan

**Status:** done  
**Dependencies:** None  

İkinci bir kart sistemi kurma. Kapatma davranışı `GREETING_DISMISSED_KEY` desenine uysun. Karşılama kartı ile çakışırsa biri kazanmalı — kararı yorumla (öneri: kampanya, çünkü hedeflenmiş). Widget çapraz-origin iframe içinde: workspace metni **kaçışsız basılmaz** (NFR-S6); `<script>` metin olarak görünmeli. 8 dil (ar/de/en/es/fr/it/pt/tr) — kampanya metni çevrilmez, düğmeler çevrilir. `kanit/03.3.2-campaign-card.png`.

**Details:**

Bağımlılık: M-CAMP-b. Dilim V7-1. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 176.4. M-CAMP-d [SONNET-XHIGH] engaged bayrağı gerçekten set edilsin + etkileşim tanımı

**Status:** done  
**Dependencies:** None  

Üretimde hiç true yapılmıyor; kampanya başarısının tek sinyali bu. Tanım: **sohbet açmak** = engaged (görüntülenme zaten `delivered_at`). Ziyaretçi kartı kapatıp sonra kendi başına sohbet açarsa bu sayılır mı — zaman penceresi mi, yalnız karttan gelen tıklama mı? Seçimini yorumla ve teste bağla; rapor okuyan biri bu ayrımı bilmeden oranı yanlış yorumlar.

**Details:**

Bağımlılık: M-CAMP-c. Dilim V7-1. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 176.5. M-CAMP-e [OPUS-MAX] BÖLÜNMEZ: yeni ziyaretçi çalışan kampanyaları tetiklesin (sıcak yol + idempotanslık)

**Status:** done  
**Dependencies:** None  

Tetikleme şu an YALNIZ create/update anında, son `LIVE_WINDOW_MINUTES` içindeki ziyaretçilere karşı — yani kampanya kaydedildikten SONRA gelen ziyaretçi hiç eşleşmiyor. `visits` yazma yolunda değerlendir. **Asıl tasarım sorusu maliyet:** ziyaret yazma yolu her sayfa görüntülemesinde çalışan sıcak yoldur; her ziyarette tüm çalışan kampanyaları değerlendirmek pahalı olabilir — senkron mu, işlem sonrası mı, kısa önbellek arkasında mı? Kararı ve ölçümü yorumla; `apps/load/test/budgets.test.ts` NFR-P2 bütçesi yeşil kalmalı.

**Details:**

Bağımlılık: M-CAMP-a. Dilim V7-1. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 176.6. M-CAMP-f [OPUS-XHIGH] Kampanya durumu okuma anında yeniden değerlendirilsin

**Status:** done  
**Dependencies:** None  

`computeCampaignStatus` yalnız create (`campaign-service.ts:108`) ve update (`:169`) yolundan çağrılıyor; zamanlayıcı yok, `starts_at` geçmişe kayan kampanya sonsuza dek `scheduled` görünüyor. Tercih: okuma anında yeniden hesaplama (zamanlayıcı altyapısı gerektirmez); alternatif mevcut sweep deseni (`retention.ts`). Eşzamanlı iki okuma aynı satırı güncelleyebilir — **idempotent güncelleme** yaz. Sekme filtreleri (All/Ongoing/Scheduled/Inactive) bu değerden beslenir.

**Details:**

Bağımlılık: M-CAMP-e. Dilim V7-1. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.
