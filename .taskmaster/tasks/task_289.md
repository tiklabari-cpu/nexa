# Task ID: 289

**Title:** DURABLE-AI-QUEUE [OPUS-MAX] (Opus 5.5) Kalıcı AI iş kuyruğu (ai_jobs, outbox, SKIP LOCKED işçi): çökmede yanıt kaybolmaz, aynı mesaja asla iki cevap gitmez

**Status:** pending

**Dependencies:** 273 ⏱, 288 ⏱

**Priority:** high

**Description:** AI ve kural botu işleri süreç belleğinde (follow-ups.ts "Not durable, on purpose"); yeniden başlatma/güncelleme/takılmada bekleyen yanıtlar sessizce kaybolur, çok kopyada çift cevap riski. Tek ev sunucusunda pilot. "Önce AI" (K9) insan güvenlik ağını kaldırdığı için pilottan önce şart. Kaynak: GV-02.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: GV-02. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 2 — kimlik çekirdeği ve altyapı.

[MAX] eşzamanlılık/kilit + ChatService transaction sınırı. ADR-11a (#273).
KOD: services/chat/follow-ups.ts (MAX_FOLLOW_UPS_PER_KEY=20), plugins/follow-ups.ts; customer.ts:342-389 (followUp → respondToCustomerMessage: kural botu, ai.handle, atanan bildirimi); ai-responder.ts:48; kalıp webhooks/redelivery.ts; scheduler.ts, lock.ts.
YAPILACAK: migration ai_jobs (id, license_id, organization_id, chat_id, thread_id, trigger_event_id, kind CHECK visitor_message, state CHECK pending|running|done|expired|failed, attempts, available_at, lease_until, created_at, started_at, finished_at, outcome, last_error, request_id), tekil (license_id, trigger_event_id, kind), indeks (state, available_at), RLS; SECURITY DEFINER ai_jobs_claim(p_limit, p_lease_seconds) (FOR UPDATE SKIP LOCKED, sohbet başına sıra) + ai_jobs_settle; ChatService.sendEvent/start'a "aynı işlemde yaz" outbox kancası; services/ai/ai-job-worker.ts (eklentiyle başlar, 500 ms yoklama + LISTEN/NOTIFY, withTenant); follow-ups.ts AI dalı işçiye taşınır (kural botu ve atanan bildirimi aynı işte, bugünkü sırayla); /health ai_jobs {pending, oldest_age_s}.
MANTIK: tazelik 120 sn → expired + iç not + insan yönlendirmesi + karar kaydı expired; uygunluk (bağlantı aktif mi, insan devraldı mı (AI-11 gelince), kota); idempotens properties.reply_to_event_id = trigger_event_id (göndermeden önce kontrol); çökme: süresi dolan running en çok 2 deneme; sohbette 20+ bekleyen → expired; kapanışta SHUTDOWN_DRAIN_MS; çok turlu AI (AI-03) geldiğinde iş konuşmanın o anki durumuna cevap üretir.

KABUL KRİTERLERİ:
- Süreç AI işi bekleyen mesajdan hemen sonra zorla durdurulup başlatılırsa oyuncu cevabı bir kez alır (120 sn içinde) ya da devir + iç not.
- Aynı mesaja iki işçiyle eşzamanlı testte asla iki cevap gitmez.
- Aynı sohbette cevaplar geliş sırasıyla.
- Normal yükte yazımdan iş başlangıcına p95 < 1 sn.
- /health kuyruk derinliğini ve en eski işin yaşını gösterir.

KULLANILAN VARSAYIMLAR:
- K18/ADR-11a.
- GV-02-S1 120 sn; S2 bildirim e-postaları sonraki adım.

**Test Strategy:**

Entegrasyon (atomik yazım, yeniden başlatma, iki işçi, sıra, süre aşımı, RLS); visitor-follow-ups.test.ts uyarlanır; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 289.1. AIJ-SCHEMA [OPUS-MAX] ai_jobs tablosu + RLS + ai_jobs_claim / ai_jobs_settle SECURITY DEFINER fonksiyonları

**Status:** pending  
**Dependencies:** None  

Sabit search_path; kiracılar arası sayıcı redelivery.ts kalıbında.

### 289.2. AIJ-OUTBOX [OPUS-MAX] ChatService outbox kancası: iş satırı ziyaretçi mesajıyla aynı transaction'da

**Status:** pending  
**Dependencies:** 289.1  

sendEvent/start isteğe bağlı aynı işlemde yazım.

### 289.3. AIJ-WORKER [OPUS-MAX] ai-job-worker: claim/lease, LISTEN/NOTIFY, tazelik, idempotens, sıra, kapanış; follow-ups AI dalının taşınması

**Status:** pending  
**Dependencies:** 289.2  

Kural botu ve bildirim sırası korunur.

### 289.4. AIJ-HEALTH-TESTS [OPUS-HIGH] /health metrikleri + visitor-follow-ups testlerinin uyarlanması + HANDOFF

**Status:** pending  
**Dependencies:** 289.3  

Üst görev 289 ayrıntılarındaki ilgili bölüm.
