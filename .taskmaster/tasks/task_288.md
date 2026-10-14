# Task ID: 288

**Title:** STRUCTURED-LOGS-AI-DECISIONS [OPUS-HIGH] Yapılandırılmış loglar (license_id, request_id, chat_id, thread_id, customer_id her satırda) + kalıcı AI karar kaydı (ai_decision_logs)

**Status:** pending

**Dependencies:** 284 ⏱

**Priority:** high

**Description:** "AI bu oyuncuya neden böyle dedi?" sorusuna numarayla dakikalar içinde cevap. Bugün loglar yalnız stdout, chatId/chat_id tutarsız, thread_id hiçbir satırda yok, request_id istemciden doğrulanmadan alınıyor (server.ts:255), pilot log döndürme 10 MB × 5. CGA/UKGC kayıt beklentisi. Kaynak: ID-08.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: ID-08. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 2 — kimlik çekirdeği ve altyapı.

KOD: server.ts:200-256 (genReqId :255), :324-398; customer.ts:484,512 (chatId); ai-responder.ts:169,184 ve rule-bot-responder.ts:111 (chat_id); SkillRun yalnız chatId; telemetry.ts:65; docker-compose.pilot.yml.
YAPILACAK: types/log-keys.ts (LOG_KEYS, LogContext); plugins/log-context.ts (auth sonrası child logger: license_id, organization_id, actor_type, actor_id); bindChatLogContext(request, {chatId, threadId, customerId}); genReqId yalnız ^[A-Za-z0-9._-]{8,64}$; camelCase anahtarlar düzeltilir; RTM aynı anahtarlar; migration ai_decision_logs (id, license_id, chat_id, thread_id, customer_id, trigger_event_id, reply_event_id, request_id, job_id, decision CHECK answered|asked|handoff|silent|blocked|expired|cap_reached, procedure_id, procedure_version, step, knowledge_source_ids, chunk_ids, retrieval_scores, guardrail_hits, handoff_reason, risk_flags, model, llm_input_tokens, llm_output_tokens, latency_ms, error_type, details jsonb ≤8KB, config_version_id?, created_at) + RLS + indeksler (license_id, created_at desc), (chat_id, created_at), (thread_id); skill_runs.thread_id (nullable); retention/erasure kapsamı; scripts/audit/log-keys.mjs (camelCase kimlik anahtarı bulursa hata, CI'a bağlı); yazıcı API'si (AI görevleri kullanır).
KURALLAR: karar kaydı mesaj metni tutmaz; tam prompt yalnız "hata ayıklama modu" açıkken ai_debug_traces'e 7 gün (varsayılan kapalı, yalnız Kurucu açar; ID-08-S2); yazılamazsa cevap engellenmez, error log; saklama konuşmayla aynı (ID-08-S1, 365 gün varsayılan); harici log sistemi pilotta yok (S3).

KABUL KRİTERLERİ:
- Sohbet/müşteri/AI yollarında her log satırında license_id ve request_id; sohbet satırlarında chat_id + thread_id.
- log-keys denetim aracı CI'da yeşil.
- Her AI turu için tam bir ai_decision_logs satırı (AI çekirdeği gelince; bu görevde yazıcı + test).
- Geçersiz X-Request-Id yeni UUID ile değişir.
- Başka kiracının karar kaydı okunamaz.

KULLANILAN VARSAYIMLAR:
- ID-08-S1/S2/S3 varsayılanları.

**Test Strategy:**

logStream ile entegrasyon (widget mesajı → AI yolu satırları), ai_decision_logs RLS negatif, retention testi; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 288.1. LOG-CONTEXT [OPUS-HIGH] Log bağlamı eklentisi, request-id doğrulama, anahtar düzeltmeleri, RTM, scripts/audit/log-keys.mjs

**Status:** pending  
**Dependencies:** None  

Mevcut maskPii/redaksiyon kuralları korunur.

### 288.2. AI-DECISION-TABLE [OPUS-HIGH] ai_decision_logs tablosu + skill_runs.thread_id + retention/erasure + yazıcı servis

**Status:** pending  
**Dependencies:** 288.1  

Hacim yüksekse aylık bölümleme notu (event-partitions.ts).
