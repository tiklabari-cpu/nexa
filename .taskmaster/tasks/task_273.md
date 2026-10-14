# Task ID: 273

**Title:** ADR-DURABLE-AI-QUEUE [OPUS-HIGH] (Opus 5.5) ADR-11a ek notu: kalıcı AI iş kuyruğu Postgres'te (ai_jobs, SKIP LOCKED, LISTEN/NOTIFY) (K18)

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** ADR-11 "Kafka/RabbitMQ yok; Redis Streams + pub/sub" diyor. GV-02'nin kalıcı AI kuyruğu Redis kesilince iş kaybetmemeli; repo kalıbı (webhooks/redelivery.ts, ai_budget Postgres'te) Postgres'i öneriyor. K18 onayladı. Kaynak: GV-02.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: GV-02. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 0 — ADR ek notları (kilitli kararlarla çelişen işler için önce yazılır).

NE YAZILACAK (PLAN.md §0 altına "ADR-11a" + docs/adr/durable-ai-jobs.md):
- AI işleri `ai_jobs` tablosunda; ziyaretçi mesajıyla aynı transaction'da (outbox) yazılır.
- Alma: SECURITY DEFINER `ai_jobs_claim` (`FOR UPDATE SKIP LOCKED`, süreli kira), sohbet başına sıra; düşük gecikme için `LISTEN/NOTIFY` + 500 ms yoklama.
- Redis Streams fan-out / pub-sub (presence, RTM) DEĞİŞMEZ; ADR-11'in "Kafka/RabbitMQ yok" maddesi aynen.
- Tazelik 120 sn: sonrası `expired` → insana devir + iç not (GV-02-S1 varsayılanı).
Kod yok.

KABUL KRİTERLERİ:
- ADR-11a yazılı; ADR-11 satırı değişmedi.
- GV-02 (#289) bu göreve bağlı.

KULLANILAN VARSAYIMLAR:
- GV-02-S1 (120 sn) ve S2 (bildirim e-postaları ikinci adımda) varsayılanları.

**Test Strategy:**

Yalnız doküman: `pnpm -w format:check`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
