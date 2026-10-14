# Task ID: 362

**Title:** READ-RECEIPTS [SONNET-HIGH] Okundu bilgisi: POST /customer/chat/seen (widget görünürken, 1 sn gecikmeli), markSeen yalnız ileri, customer_seen push, ajan ekranında son okunan ajan mesajının altında "Okundu · saat"

**Status:** pending

**Dependencies:** None

**Priority:** medium

**Description:** seen_up_to verisi ajan tarafında var ama oyuncu tarafı hiç işaretlemiyor; markSeen yorumuna rağmen işareti geri yazabiliyor. Kaynak: IN-05.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: IN-05. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: openapi.yaml:1097-1107 ChatUser.seen_up_to; chat-service.ts:1805-1825 markSeen (koşulsuz update — HATA); chats.ts:580; widget'ta seen çağrısı yok; Transcript.tsx; useInbox.ts:602-650 useMarkSeen.
contract: POST /customer/chat/seen {seen_up_to}; RTM customer_seen {chat_id, thread_id, seen_up_to} (ajan kitlesi).
api: yeni uç (customer.ts), oran sınırı ≈1/sn; markSeen GREATEST(seen_up_to, $1) — ajan ve oyuncu için düzeltme; yazma sonrası push.
widget: pencere açık + visibilityState visible + liste en altta → 1 sn gecikmeyle; küçültülmüş/arka planda gönderilmez.
web: Transcript chat.users customer kaydının seen_up_to'su; bu zamana kadar oluşmuş recipients all, yazarı ajan/bot son mesajın altında tek etiket; iç notlar asla; RTM ile ['chat', chatId] yaması; saat ajanın yerelinde.
Oyuncu tarafında gösterim YOK (04 IN-05 S1). Gizlilik metni notu (07 açık risk). Eksik göstermek yanlış "okundu"dan iyidir.

KABUL KRİTERLERİ:
- Oyuncu mesajı görünce ajan ekranında 2 sn içinde "Okundu · saat".
- Küçültülmüş widget'ta gelen mesaj okunmuş sayılmaz.
- Eski zamanlı istek işareti geri çekmez.
- İç notlar "okundu" almaz.

KULLANILAN VARSAYIMLAR:
- 04 IN-05 S1: oyuncuya gösterilmez.

**Test Strategy:**

Entegrasyon (kendi sohbeti, kiracılar arası 404, yalnız ileri), widget birim (görünmezken çağrı yok), Transcript.readReceipt.test.tsx, e2e; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
