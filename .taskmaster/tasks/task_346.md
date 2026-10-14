# Task ID: 346

**Title:** MANUAL-ASSIGNMENT-MODE [OPUS-MAX] Manuel atama modu (ekip bazlı): herkese bildirim, "Al" ile CAS, limit kontrolü; Sorumlu Oyun ekibi manuel yapılamaz

**Status:** pending

**Dependencies:** 305 ⏱

**Priority:** medium

**Description:** Atama her zaman otomatik; bazı ekipler (ör. Bonus) "ilk alan alır" çalışmak istiyor. Elle alma yalnız takeover ile var. Kaynak: WG-07.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: WG-07. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

[MAX] atama eşzamanlılığı.
KOD: routing-service.ts route :114-171, drainQueue :179-241; DetailsPanel takeover; Group schema:698-711; agents.ts:1006-1040.
prisma: groups.assignment_mode TEXT DEFAULT 'auto' CHECK auto|manual.
contract/types: PATCH /groups/{groupId} assignment_mode; GroupAssignmentMode; POST /chats/{id}/claim (ya da takeover'ın kuyruk kullanımı).
api: manuel ekipte route/drainQueue ajan seçmez, ekip kuyruğuna koyar (AU-01 #305); claim CAS (assignee_id IS NULL koşullu update), kaybeden "başka bir ajan aldı"; eşzamanlı limit kontrolü; topic_role responsible_gambling ekip manuel yapılamaz (400); assigned_at yazılır (#340); queue_entries kapanır (#291).
RTM: kuyruğa giren sohbet ekip üyelerine incoming_chat (mevcut eylemler).
web: ekip editöründe mod seçici, Inbox "Kuyrukta" görünümünde "Al", sesli bildirim (IN-10 #367 sonrası tercihlerle).
WG-03 (#340) manuel ekipte "X dk kimse almadı → Ekip Lideri uyarısı".

KABUL KRİTERLERİ:
- Manuel ekibe gelen sohbet kimseye atanmaz, ekipteki çevrimiçi ajanlara bildirim gider.
- İki ajanın eşzamanlı "Al"ında yalnız biri atanır.
- Sorumlu Oyun ekibi manuel yapılamaz.
- Limiti dolu ajan alamaz.

KULLANILAN VARSAYIMLAR:
- 05 WG-07 karar 1: Sorumlu Oyun manuel olamaz.

**Test Strategy:**

Entegrasyon (eşzamanlı Al, limit, RG reddi), e2e; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
