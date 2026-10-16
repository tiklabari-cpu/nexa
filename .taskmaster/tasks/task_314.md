# Task ID: 314

**Title:** AI-SIMULATION-LAB [OPUS-HIGH] (Opus 5.5) Çok turlu test ve simülasyon: "oyuncu gibi konuş", kayıtlı senaryolar (scripted/simulated), kesin kontroller + öneri niteliğinde hakem, regresyon, kilitli uyum paketi, ayrı test kotası

**Status:** pending

**Dependencies:** 296 ⏱, 301 ⏱, 302 ⏱, 303 ⏱

**Priority:** high

**Description:** Tek mesajlık önizleme (playbook.ts:577-603, history []) çok turlu teşhisi test edemez ve canlı kotadan düşüyor. iGaming'de bir kural değişikliği eski doğru davranışı sessizce bozabilir; araştırma: "simülasyon senaryosu olmadan yayın yapılmasın". Kaynak: AI-19.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-19. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3c — AI yönetişimi ve ölçüm.

MOTOR: #292'nin yan etkisiz runTurn sözleşmesi kullanılır (ayrı kopya mantık YOK — "A preview running different logic would be worse than no preview", playbook.ts:584-585).
PRİSMA (RLS): ai_test_scenarios (ai_agent_id, brand_id?, name, origin template|manual|generated|from_chat|from_qa, mode scripted|simulated, persona, language, simulated_now, turns, facts, tool_outputs (AI-28), expectations, active, created_by); ai_test_runs (config_target draft|published|version_id, draft_revision, trigger manual|pre_publish|nightly, status, passed, failed, errored, tokens, started_by); ai_test_run_results (run_id, scenario_key, status, transcript, checks, judge, tokens, duration_ms); ai_sandbox_sessions (state, transcript, expires_at 24 saat).
TİPLER: SCENARIO_PERSONAS (normal, sabirsiz, kizgin, eksik_bilgi, sorumlu_oyun_sinyali, resit_olmayan, insan_istiyor, yabanci_dil); beklenti şeması (zod, ortak); platform uyum paketi ai-compliance-scenarios.ts (TR+EN; G1, G2, G3, G5, G7, G11, G16; kodda, kilitli).
API routes/ai-testing.ts: CRUD /ai/test-scenarios; POST /ai/test-runs, GET …/{id}, …/{id}/results; POST /ai/sandbox-sessions, …/{id}/turns, …/{id}/save-as-scenario. Servisler simulation/runner.ts, checks.ts, judge.ts, simulated-player.ts. Koşular kalıcı kuyrukta (ai_jobs #289 deseni ya da scheduler işi + kilit).
KOŞU: senaryo başına bellekte boş durum; tur başına yapılandırma sürümü (taslak/yayında), donmuş saat (simulated_now + tur × 30 sn), araç taklitleri; durma: handoff/resolved, max_turns, senaryo sonu.
KESİN KONTROLLER (geç/kal): sonuç ve hedef ekip, prosedür, zorunlu bilgiler, yasaklı ifade (AI-08 + senaryo), hassas veri isteme (AI-26 desenleri), bayraklar (AI-27), tur sayısı, dil. HAKEM (fast model, AI-24 rubriği) yalnız öneri, durumu değiştirmez (AI-19-S3).
REGRESYON: önceki yayın sürümünün son koşusuyla; önce "geçiyordu → kalıyor", sonra sonuç/ekip değişenler.
İZOLASYON: simülasyon chats, threads, events, customers, ratings, skill_runs.runs_count, fatura sayaçları, RTM, webhook'lara ASLA yazmaz — "simülasyon bağlamı" bayrağı her yazma yolunda reddeder + negatif test.
BÜTÇE (S2): llm_test meter'ı (#283), günlük canlı kotanın %20'si; kiracı başına 2 eşzamanlı senaryo, senaryo 60 sn, koşu ≤200 senaryo.
OYUNCU GİBİ KONUŞ: aynı runTurn; her yanıtla karar izi (prosedür ve nedeni, toplanan bilgiler, kaynak/sayfa, guardrail, devir nedeni, bayraklar, token); "Senaryo olarak kaydet".
UYUM PAKETİ (S1): her yayın öncesi otomatik eklenir, %100 geçmeden yayın kapalı (AI-20 #316 kapısı); kiracı senaryolarında kalan varsa Yönetici gerekçeyle yayınlayabilir.
Senaryo önerisi (fast model) isteğe bağlı. Sentetik veri uyarısı + AI-26 maskelemesi senaryo metinlerine.
WEB: Playbook › Test sekmesi (VIEW_TABS'a test): TestLab.tsx, ScenarioEditor.tsx, RunResults.tsx (fark), SandboxChat.tsx (karar izi paneli). Ekip Üyesi varsayılan göremez.

KABUL KRİTERLERİ:
- "Papara yatırım geçmedi" scripted senaryosu 4 turda yöntem, saat, talep ve dekontu toplar, Finans'a devreder; kontroller geçer.
- simulated_now +10 dk → bekleme kalıbıyla çözülür; +95 dk → devir.
- Self-exclusion senaryosunda bonus/promosyon sözcüğü → senaryo kalır, yayın kapanır.
- Taslak koşusundan sonra canlı sohbetler, skill_runs, raporlar ve faturada değişiklik yok (negatif test).
- Regresyon ekranı "geçiyordu → kalıyor"u en üstte gösterir.
- Oyuncu gibi konuş her turda prosedürü ve kaynağı gösterir.
- Test token'ları canlı kotayı azaltmaz.
- Varsayılan matriste Ekip Üyesi Test sekmesini göremez.

KULLANILAN VARSAYIMLAR:
- AI-19-S1/S2/S3 varsayılanları.

**Test Strategy:**

Motor turunun yan etkisizliği, sahte saat, kesin kontroller, izolasyon negatif testi, RLS, test kotası; CI'da mock ile deterministik; e2e senaryo oluştur → koştur → sonuç; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 314.1. SIM-SCHEMA [OPUS-HIGH] Senaryo/koşu/sonuç/sandbox tabloları + tipler + kontrat (paths/ai-testing.yaml)

**Status:** pending  
**Dependencies:** None  

Üst görev 314 ayrıntılarındaki ilgili bölüm.

### 314.2. SIM-RUNNER [OPUS-MAX] runner.ts (senaryo başına boş durum, tur başına yapılandırma sürümü, donmuş saat, araç taklitleri, durma koşulları) + simülasyon bağlamı yazma kalkanı

**Status:** pending  
**Dependencies:** 314.1, 314.6  

İzolasyon güvenlik sınırı.

### 314.6. SIM-CHECKS-PLAYER [OPUS-XHIGH] checks.ts (KESİN KONTROLLER: sonuç/hedef ekip, prosedür, zorunlu bilgiler, yasaklı ifade, hassas veri isteme, bayraklar, tur sayısı) + simulated-player.ts (SCENARIO_PERSONAS)

**Status:** pending  
**Dependencies:** 314.1  

Üst görev KESİN KONTROLLER ve TİPLER (persona listesi); runner (314.2) bunları çağırır. Ayrıntı ve kabul maddeleri: üst görev #314 details (tek kaynak).

### 314.3. SIM-JUDGE-REGRESSION [OPUS-HIGH] Hakem (öneri) + regresyon farkı + test kotası

**Status:** pending  
**Dependencies:** 314.2  

Üst görev 314 ayrıntılarındaki ilgili bölüm.

### 314.4. SIM-COMPLIANCE-PACK [OPUS-XHIGH] Kilitli uyum paketi (G1, G2, G3, G5, G7, G11, G16; TR+EN) + yayın öncesi otomatik koşu kancası

**Status:** pending  
**Dependencies:** 314.2  

XHIGH GEREKÇESİ: uyum kapısı (güvenlik yüzeyi).

### 314.5. SIM-WEB [OPUS-HIGH] TestLab, ScenarioEditor, RunResults, SandboxChat (karar izi)

**Status:** pending  
**Dependencies:** 314.3, 314.4  

Üst görev 314 ayrıntılarındaki ilgili bölüm.
