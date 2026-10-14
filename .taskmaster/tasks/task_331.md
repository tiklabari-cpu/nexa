# Task ID: 331

**Title:** INBOX-PLAYER-CARD [OPUS-HIGH] Inbox sağ panelinde oyuncu kartı: ad, kullanıcı adı (beyan rozeti), e-posta (yetkiye göre sunucuda maskeli), ülke, pre-chat cevapları, devir kartı, "Bugün" (aynı Thread ID'nin bağlantıları) ve "Geçmiş" (90 gün, kısıtlı konuşmalar)

**Status:** pending

**Dependencies:** 286 ⏱, 287 ⏱, 304 ⏱, 329 ⏱, 330 ⏱

**Priority:** high

**Description:** Ajan oyuncunun kim olduğunu, bugün ne konuşulduğunu ve AI'ın ne topladığını görmek için Müşteriler sayfasına geçmek zorunda. Mevcut müşteri detay ucu ekip ayrımı yapmıyor (customer-service.ts:176-187) — aynı açık Inbox'a taşınmamalı. Kaynak: IN-02.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: IN-02. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 5 — ajan deneyimi, arama, arşiv.

contract: GET /chats/{chatId}/customer-context (chats.yaml + CustomerContext): customer {id, name, username, email (gerekirse maskeli), country_code, city, banned}, pre_chat [{label, value}], today [ConversationRef], history {items, next_page_id}, restricted_count; ConversationRef: Chat ID (thread_id), Thread ID (chat_id) — ID-01 adlarıyla, başlangıç/bitiş, atanan, ekipler, etiketler, AI devir kartı özeti (#304), puan (AR-03), accessible.
api: services/customers/customer-context.ts — her konuşma için resolveVisibility(tx, principal, 'read') ile accessible; accessible:false satırlarda yalnız tarih + konu etiketi (IN-02-S2), özet/etiket DÖNMEZ; e-posta "kişisel veri görür" yeteneği yoksa sunucuda maskeli (a***@gmail.com); route chats.ts.
"Bugün": ID-02 günlük grubunun önceki bağlantıları (K1=A: aynı chat'in thread'leri) — saat, süre, sonuç, devir kartı özeti; tıklayınca salt okunur transkript (aktif composer etkilenmez). "Geçmiş": gün başına bir satır, son 90 gün (S3), keyset (created_at, id), 20/sayfa; "Tümü" → Arşiv (AR-01) oyuncuya filtreli.
Pre-chat: önce bağlantının filled_form olayı, yoksa müşteri özel alanlarındaki pre_chat değerleri (VisitorPanel kuralı).
Risk bayrakları başlıkta rozet (ikon + metin). Kullanıcı adı "oyuncunun beyanı, doğrulanmadı" rozeti; geçerli üye tokenıyla "tanınan cihaz"; ID-03 olası eşleşmeler listesi (#287) burada.
RTM: yeni olay yok; incoming_chat / chat_transferred'da ['customer-context', chatId] tazelenir.
web: features/inbox/PlayerCard.tsx, useCustomerContext.ts; DetailsPanel en üstü; AI-10 kart ve ID-05 kopyala bileşenleri; locales. Hedef p95 < 300 ms.

KABUL KRİTERLERİ:
- Kartta ad, kullanıcı adı, e-posta (yetkiye göre maskeli), ülke ve pre-chat cevapları; olmayan alan "—".
- Aynı gün ikinci gelişte ilk bağlantı (saat, sonuç, devir kartı) "Bugün"de.
- Ertesi gün "Bugün" boş, önceki gün "Geçmiş"te tek satır.
- Ekip dışı geçmiş konuşmanın içeriği açılmaz; API özet/etiket döndürmez.
- Chat ID ve Thread ID kopyalanabilir.
- AI'dan devralınan sohbette devir kartı en üstte; "Profili aç" bağlantısı var.

KULLANILAN VARSAYIMLAR:
- IN-02-S1/S2/S3 varsayılanları.

**Test Strategy:**

customer-context.test.ts (ekip A ajanı B konuşmasının özetini alamaz; kiracılar arası 404), PlayerCard.test.tsx, e2e inbox-player-card.spec.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 331.1. PC-API [OPUS-XHIGH] customer-context ucu + görünürlük + sunucu maskesi + sayfalı geçmiş

**Status:** pending  
**Dependencies:** None  

XHIGH GEREKÇESİ: (1) görünürlük/kişisel veri sızıntısı riski (mevcut müşteri ucu ekip ayrımı yapmıyor).

### 331.2. PC-WEB [OPUS-HIGH] PlayerCard.tsx + useCustomerContext + DetailsPanel yerleşimi + RTM tazeleme

**Status:** pending  
**Dependencies:** 331.1  

Üst görev 331 ayrıntılarındaki ilgili bölüm.
