# Task ID: 292

**Title:** AI-CONVERSATION-CORE [OPUS-MAX] (Opus 5.5) Konuşma motoru çekirdeği + sohbet içi hafıza: ai_conversations durumu, yan etkisiz runTurn sözleşmesi, bağlam yükleyici, art arda mesaj birleştirme, iyimser kilit

**Status:** pending

**Dependencies:** 270 ⏱, 283 ⏱, 286 ⏱, 288 ⏱, 289 ⏱, 290 ⏱

**Priority:** high

**Description:** AI her mesajı geçmişsiz değerlendiriyor (ai-responder.ts:95-98 yalnız {message, chatId}; skill-engine.ts:285 history=[]; answer-prompt.ts:79-82 tek user mesajı); art arda 3 mesaja 3 cevap üretiyor (customer.ts:342-352). Hafıza olmadan teşhis yapılamaz; AI-02/03/04/05/09 buna dayanır. Bu görev 05 §1.0 ortak çerçevesini kurar; AI-19'un istediği yan etkisiz tur fonksiyonu sözleşmesi burada tasarlanır. Kaynak: AI-01, AI-19.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-01, AI-19. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3a — AI çekirdeği (çok turlu motor, devir, uyum).

[MAX] eşzamanlılık (iyimser kilit, çok kopya).
HEDEF MODÜL apps/api/src/services/ai/conversation/: conversation-engine.ts (handleTurn), context-loader.ts, state-store.ts, policy.ts iskeleti, compose.ts; AiResponder.handle kapılarını (requireAiInference :63, requireAiBudget :81) korur, SkillEngine.run yerine ConversationEngine.handleTurn çağırır. Eski tek mesajlık skill'ler adaptörle tek adımlı prosedür olarak koşar; iki motor bırakılmaz.
K1=A EŞLEMESİ: bağlantı = ConnectionRef {chatId (=Thread ID, günlük), threadId (=Chat ID)}. Günlük thread = nexa chat_id; 05 §1.0'daki ayrı daily_thread_id KOLONU AÇILMAZ (sapma notu 07'de).
ai_conversations (bağlantı başına bir satır, unique(license_id, chat_id, thread_id), RLS): mode ('ai'|'human'|'paused', AI-11 kullanır), active_skill_id, procedure_snapshot, step_id, step_status, slots, suspended, counters, signals, digest, outcome, last_processed_event_seq, version, config_version_id (#290), created_at/updated_at/closed_at. AI-03/04/11 alanları burada açılır, mantıkları kendi görevlerinde.
runTurn SÖZLEŞMESİ (AI-19 için): runTurn(state, message, ctx{now, configVersionId, toolStubs, mode}) → {reply, decisions, nextState, sideEffects[]}; yan etkiler (devir, etiket, bayrak, özet) DÖNDÜRÜLÜR, canlı adaptör uygular, simülatör yalnız kaydeder.
AI-01 MANTIĞI: loadConnectionEvents(ref) event_sequence sırasıyla message/file/seçili system_message; rol eşlemesi customer→user, bot→assistant, agent→assistant + "[Temsilci]"; system olayları "Olaylar" notu; ASLA recipients='agents' (iç not), Copilot çıktısı, başka bağlantı; ekler "[Ek: görsel, dekont.jpg]"; maskeli metin. Bütçe AI_HISTORY_MAX_MESSAGES 20, AI_HISTORY_MAX_CHARS 12000, ilk oyuncu mesajı her zaman tutulur; kırpılan kısım için LLM özeti yok, "Durum özeti" slots/adımdan deterministik. Ardışık aynı rol birleşir. Debounce AI_BATCH_WINDOW_MS 3000 (en fazla 2 katı bekle); sonraki işler yeni olay yoksa no-op. İyimser kilit: version + last_processed_event_seq oku, LLM transaction dışında, UPDATE … WHERE version=:v; 0 satır → taslak gönderilmez. Gönderim öncesi yeni oyuncu olayı varsa taslak atılır, en fazla 1 kez yeniden. LLM_MAX_PROMPT_CHARS bölüm bütçesi, varsayılan 48 000 öneri.
SESSİZLİK YASAĞI (AI-06 değişmez kuralı): mode='ai' iken işlenen her tur bot mesajı ya da açık devirle biter — tek yerde test (AI-06/09 tamamlar).
Kontrat: AiAgent.batch_window_seconds (0-10), PATCH /ai-agents gövdesi; web ProfileForm tek alan.
Kayıt: her tur ai_decision_logs (#288) + skill_runs satırı (rapor sürekliliği).
Kod sınırı: model çağrıları MeteredLlm üzerinden; DB transaction ile iç içe değil; operatör loguna oyuncu metni yazılmaz.

KABUL KRİTERLERİ:
- "Param yatmadı" → AI yöntem ve saat sorar → "Papara 13:40" → ikinci tur model isteğinde önceki üç mesaj doğru sıra ve rollerle (mock istek yakalama).
- İç notlar hiçbir model isteğinde yok.
- 3 sn içinde 3 mesaj → tam 1 bot cevabı; last_processed_event_seq üçüncü mesajın sırası.
- Aynı bağlantıyı işleyen iki motor → en fazla 1 bot cevabı.
- 40 mesajlık konuşmada ilk oyuncu mesajı korunur, prompt_too_long oluşmaz.
- Ekler yer tutucuyla; ikili içerik modele gitmez.
- Eski tek mesajlık skill testleri (skill-engine.test.ts) yeni motorla geçer.

KULLANILAN VARSAYIMLAR:
- K1=A: daily_thread_id ayrı kolon yok, chat_id kullanılır.
- AI-01-S1: 3 sn bekleme.
- Mock LLM deterministik (MASTER-PROMPT).

**Test Strategy:**

context-loader birim; ai-skills.test.ts yanında çok turlu entegrasyon; eşzamanlılık testi; e2e ai-agent.spec.ts iki turlu senaryo; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 292.1. CORE-STATE-TABLE [OPUS-MAX] ai_conversations tablosu + RLS + state-store (iyimser kilit, sürüm)

**Status:** pending  
**Dependencies:** None  

Alanlar yukarıda; tenant-isolation negatif testi.

### 292.2. CORE-RUNTURN-ADAPTER [OPUS-MAX] runTurn sözleşmesi (yan etkisiz) + canlı adaptör (AiResponder) + eski skill adaptörü

**Status:** pending  
**Dependencies:** 292.1  

Yan etkiler döndürülür; canlı adaptör uygular; eski adım tipleri eşlenir (detect_intent→when_to_use, request_info→collect, send_message→say/answer_from_knowledge, transfer_to_team→handoff, tag→tag).

### 292.3. CORE-CONTEXT-LOADER [OPUS-HIGH] context-loader: loadConnectionEvents, rol eşlemesi, bütçe, iç not hariç, ek yer tutucu

**Status:** pending  
**Dependencies:** 292.2  

TurnContext {messages, systemNotes, stateDigest, newCustomerText, lastSeq}; (thread_id, event_sequence) tek indeksli sorgu, LIMIT N+1.

### 292.4. CORE-BATCH-LOCK [OPUS-MAX] Debounce/birleştirme + iyimser kilit + gönderim öncesi yeni mesaj kontrolü

**Status:** pending  
**Dependencies:** 292.3  

ai_jobs işçisi (#289) ile çalışır.

### 292.5. CORE-SETTINGS-E2E [SONNET-HIGH] batch_window_seconds kontrat + ProfileForm alanı + env anahtarları + e2e iki tur

**Status:** pending  
**Dependencies:** 292.4  

AI_HISTORY_MAX_MESSAGES, AI_HISTORY_MAX_CHARS, AI_BATCH_WINDOW_MS; LLM_MAX_PROMPT_CHARS varsayılanı.
