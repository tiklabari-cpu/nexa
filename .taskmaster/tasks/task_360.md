# Task ID: 360

**Title:** TICKET-FIRST-RESPONSE-SLA [OPUS-HIGH] Ticket ilk yanıt SLA'sı: öncelik bazlı ayrı hedef (varsayılan boş = ölçülmez), sweep adayları, kalan süre rozeti, "SLA'ya en yakın" sıralaması, rapor kartı

**Status:** pending

**Dependencies:** 356 ⏱

**Priority:** medium

**Description:** Ticket için yalnız çözüm süresi taranıyor; ilk yanıt ölçülmüyor. Ortak first_response_minutes doğrudan uygulanırsa mevcut kiracılarda toplu ihlal oluşur — ayrı alan, varsayılan boş. Kaynak: HD-05.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: HD-05. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: sla_policies schema:2779-2790, sla_breaches :2805-2827 (idempotent unique); sla-service.ts evaluateSubject/readClock; sla-sweep.ts:173-240; business-hours.ts; jobs.ts:146-149; ticket-service.ts:428-453; SlaPolicy.tsx, TicketGrid.tsx; /reports/cases.
prisma: sla_policies.ticket_first_response_minutes INT NULL, ticket_resolution_minutes INT NULL, ticket_targets_by_priority JSONB NULL; ticket ilk yanıt boşsa ölçülmez; çözüm hedefi boşsa ortak değer (genişlet → taşı → daralt).
api: HD-01 (#356) ilk agent_reply → first_response_at + evaluateSubject {subjectType ticket, target first_response, startedAt created_at, stoppedAt now}; sweep adayları: first_response_at NULL, open|pending, birleşmemiş, source_chat_id NULL (sohbetten açılanlar SLA dışı — 04 HD-01 S3); hedef öncelikten; mesai business-hours.ts; ticket yanıtına sla {first_response_due_at, first_response_breached}; liste "SLA'ya en yakın" sıralaması.
KURALLAR: yalnız agent_reply sayılır (system/internal_note saati durdurmaz); öncelik değişince hedef yeniden, başlangıç sabit; yeniden açılma saati sıfırlamaz; birleşenin saati taşınmaz; ihlal ilk görüldüğü an sabit.
contract: SlaPolicy yeni alanlar, Ticket/TicketDetail sla bloğu, /reports/cases first_response {avg_minutes, median_minutes, breached_count}.
web: SlaPolicy.tsx sohbet/ticket ayrı bölümler (GV-06), TicketGrid kolon, TicketPane canlı rozet (renk + metin), rapor kartı. İhlal bildirimi mevcut SLA e-postası + IN-10 (#367).

KABUL KRİTERLERİ:
- "Acil: 60 dk" ticket'a 45. dk yanıt → ihlal yok.
- 61. dk yanıt yoksa ihlal + bildirim.
- İç not saati durdurmaz.
- İş saatlerinde mesai dışı sayılmaz.
- Liste kalan süre ve en acile göre sıralama.
- Rapor ortalama ilk yanıt.

KULLANILAN VARSAYIMLAR:
- Ticket hedefi varsayılan boş (toplu ihlal yok).
- Sohbetten açılan ticket SLA dışı.

**Test Strategy:**

Entegrasyon (hedef içi/aşım, iç not, öncelik değişimi, mesai), birim (kalan süre); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
