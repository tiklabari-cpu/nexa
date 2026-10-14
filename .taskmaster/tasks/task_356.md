# Task ID: 356

**Title:** TICKET-REPLY-THREAD [OPUS-XHIGH] Ticket'a yanıt ve yazışma geçmişi + iç not: ticket_messages, POST/GET /tickets/{id}/messages, e-posta gönderimi (Message-ID zinciri), iç not asla e-postaya gitmez; pilot kapısı ayrı ayar (K23)

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** Ticket modelinde mesaj yok; ajan ticket'a yanıt veremiyor ("no reply endpoint"). HelpDesk F1'in temel eksikliği. K23: kod yazılır, pilot ortamında e-posta kapısı ayrı bir ayarla açılır. Kaynak: HD-01.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: HD-01. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

XHIGH GEREKÇESİ: (1) iç not / yanıt karışması veri sızıntısı, (3) e-posta teslim güvencesi.
KOD: schema:1117-1165 Ticket, :1167-1181 takipçiler; ticket-service.ts create :265-294, createFromEmail :306-334, createFromWidget :352-376, update :378-456, "no reply endpoint" :433-439; routes/tickets.ts:280-373; ticket-email.ts (no-reply satırı :118-133); mailer/smtp-mailer.ts:159/mime.ts; tickets.yaml; TicketPane.tsx, useTickets.ts; canned_responses scope ticket; webhook ticket_created; plugins/pilot-gate.ts.
prisma: ticket_messages (id uuid, license_id, ticket_id varchar(12), kind customer_message|agent_reply|internal_note|system, author_type customer|agent|system|bot, author_id, body_text, body_html (yalnız temizlenmiş gelen), attachments jsonb [{key,name,size,mime,scan_status,sensitive}], email_message_id, in_reply_to, delivery_status queued|sent|failed|null, idempotency_key, created_at) + RLS + indeksler (ticket_id, created_at), kısmi unique (license_id, email_message_id), unique (license_id, idempotency_key); tickets.first_response_at, last_customer_message_at, last_agent_message_at.
contract: GET /tickets/{ticketId}/messages (sayfalı, eskiden yeniye), POST {kind reply|note, text ≤20.000, attachment_keys[], set_status? pending|solved, idempotency_key}; TicketMessage; hatalar ticket_no_recipient, ticket_merged.
api (ticket-message-service.ts): maskCardNumbers + AI-26; zaman damgaları; ilk agent_reply'de first_response_at + SLA (HD-05 #360); yanıt sonrası pending, oyuncu yazınca open; audit ticket.replied / ticket.note_added (metinsiz); e-posta commit sonrası BackgroundMail kind ticket_reply (dış kota), From sistem adresi + marka adı, Reply-To HD-03 adresi (#358 gelince), Message-ID saklanır, In-Reply-To/References önceki mesajdan, delivery_status; birleşik ticket'a yazma ticket_merged → birincil; birincilin akışı birleşenlerin mesajlarını da gösterir. kind=internal_note posta yolunu HİÇ çağırmaz.
PİLOT KAPISI (K23): pilot-gate.ts'te ticket e-postası ayrı bir ayar/env ile açılır (varsayılan kapalı); kapalıyken yanıt kaydedilir, delivery_status "gönderilmedi (pilot)" ve arayüzde açıklama.
RTM: ticket_message_created (atanan, takipçiler, ekip); isteğe bağlı webhook (AU-03 #374).
web: TicketThread.tsx (iç not sarı/amber, ekler), TicketComposer.tsx (Yanıt / İç not modu, # scope=ticket hazır yanıtlar, "Gönder ve çözüldü yap"), useTicketMessages.ts, "gönderilemedi · tekrar dene"; oyuncu e-postası yoksa yanıt kapalı + açıklama.
Giden e-posta: düz metin + basit HTML, son mesaj, konuda [#ID], önceki yazışma alıntılanmaz; gelen HTML ham render edilmez; ekler /uploads (virüs tarama).
SPF/DKIM/DMARC kurulum notu runbook'a (gerçek DNS işlemi YOK — CLAUDE.md).

KABUL KRİTERLERİ:
- Ajan yanıtı test spool'unda ticket numaralı e-posta olarak görünür, akışta "gönderildi".
- İç not hiçbir zaman e-postaya gitmez (spool testi).
- Oyuncu e-postası yoksa yanıt kapalı.
- Aynı istek iki kez → tek mesaj.
- Birleşik ticket'a yazma reddedilir.
- Yanıt sonrası "beklemede".
- SMTP hatasında "gönderilemedi · tekrar dene".
- Pilot kapısı kapalıyken e-posta gitmez, mesaj kaydedilir (K23).

KULLANILAN VARSAYIMLAR:
- K23: kodla; pilotta e-posta kapısı ayrı ayar, varsayılan kapalı.

**Test Strategy:**

ticket-messages.test.ts (iç not spool, kiracılar arası, idempotency, birleşik), birim, e2e tickets-reply.spec.ts + mailbox.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 356.1. TR-SCHEMA-CONTRACT [OPUS-HIGH] ticket_messages + tickets zaman kolonları + kontrat (GET/POST messages, TicketMessage, hatalar)

**Status:** pending  
**Dependencies:** None  

Üst görev 356 ayrıntılarındaki ilgili bölüm.

### 356.2. TR-SERVICE [OPUS-XHIGH] ticket-message-service: maskeleme, durum geçişi, idempotency, birleşik ticket, audit, RTM

**Status:** pending  
**Dependencies:** 356.1  

Üst görev 356 ayrıntılarındaki ilgili bölüm.

### 356.3. TR-MAIL-PILOT [OPUS-XHIGH] E-posta gönderimi (BackgroundMail ticket_reply, Message-ID zinciri, delivery_status) + pilot kapısı ayarı (K23)

**Status:** pending  
**Dependencies:** 356.2  

Üst görev 356 ayrıntılarındaki ilgili bölüm.

### 356.4. TR-WEB [SONNET-HIGH] TicketThread + TicketComposer (Yanıt/İç not) + tekrar dene + e2e

**Status:** pending  
**Dependencies:** 356.3  

Üst görev 356 ayrıntılarındaki ilgili bölüm.
