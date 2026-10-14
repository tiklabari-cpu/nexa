# Task ID: 374

**Title:** TRIGGERS-RATED-TICKET-EVENTS [OPUS-HIGH] (Opus 5.5) Tetikleyiciler: chat_rated ve ticket yaşam döngüsü webhook olayları, ticket kurallarına "Ne zaman" (created|updated|status_changed|message_added), kötü puan otomasyonu, döngü koruması

**Status:** pending

**Dependencies:** 356 ⏱, 337 ⏱

**Priority:** medium

**Description:** Puan ucu olay yaymıyor; ticket kuralları yalnız açılışta çalışıyor; Zapier/Make manifesti 5 tetikle sınırlı. Kaynak: AU-03.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AU-03. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: webhook-service.ts:28-34 WEBHOOK_ACTIONS; workspace-events.ts:60-62 emit (commit sonrası, fırlatmaz); chat-service.ts:350/580/1108/1503; customer.ts:1096-1135; domain.ts:559-600 TicketRule; apply-ticket-rules.ts; integrations.ts manifest; webhooks.ts:143.
types/contract: WEBHOOK_ACTIONS += chat_rated, ticket_updated, ticket_status_changed, ticket_assigned, ticket_message_added (HD-01 #356 ile); payload şemaları webhooks.yaml + manifest; TicketRule.on created|updated|status_changed|message_added + koşullar status_to, priority_at_least, from_requester.
prisma: ticket_rules.on TEXT DEFAULT 'created' + CHECK; InboxSettings.bad_rating_actions JSONB.
api: puan ucunda commit sonrası chat_rated (yorum maskeli, minimum alanlar) + kötü puan otomasyonu (05 karar 1 varsayılan: Ekip Liderine panel bildirimi + AI-24 QA kuyruğuna ekleme #319; ticket açma ve webhook isteğe bağlı); ticket güncelleme yollarında olay yayını; kural motoru on filtresiyle; DÖNGÜ: triggered_by_rule bağlam bayrağı, derinlik 1.
web: webhook olay listesi manifestten; TicketRules "Ne zaman" seçicisi; kötü puan ayarı (GV-06).

KABUL KRİTERLERİ:
- Kötü puanda chat_rated aboneliği olan webhook bir kez tetiklenir, EL bildirim alır.
- "solved olunca etiket ekle" yalnız o geçişte çalışır, kendi güncellemesiyle tekrar tetiklenmez.
- Yeni olaylar Zapier manifestinde ve contract tipleriyle uyumlu.

KULLANILAN VARSAYIMLAR:
- 05 AU-03 karar 1: kötü puan varsayılanı.

**Test Strategy:**

Olay yayını entegrasyonu (yanlış kiracıya gitmez), kural döngüsü testi, manifest/contract senkron testi; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
