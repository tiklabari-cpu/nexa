# Task ID: 283

**Title:** AI-REAL-LLM-READINESS [OPUS-HIGH] (Opus 5.5) Gerçek LLM ve embedding'e hazırlık: model katmanı + JSON şema çıktısı, kiracı bazlı kota, kullanım defteri, "Yapay zekâ kullanımı" ekranı ve uyarılar

**Status:** pending

**Dependencies:** 270 ⏱

**Priority:** high

**Description:** Konuşma hafızası, prosedür ve konu tespiti gerçek model olmadan kurulamaz; adaptörler hazır (openai-*-provider.ts), varsayılan mock. Kiracı kotasını ve maliyetini göremiyor; kota akşam bittiğinde AI sessizce susuyor. K12: pilotta OpenAI, bölge us; maskeleme (AI-26) modelden önce. Kaynak: AI-16.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-16. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 1 — hızlı güvenlik/temel düzeltmeler.

KOD: env.ts:685 LLM_PROVIDER mock, :700-735, :746-760, :791-793 RETRIEVAL_THRESHOLD, :811-814 günlük tavanlar, :1250-1300 üretim kontrolleri, :1376-1385 PILOT_MODE mock reddi; provider/llm-provider.ts (responseSchema yok), metered-llm.ts, ai-daily-budget.ts (ai_budget_* SECURITY DEFINER), SkillRun token sütunları, routes/reports.ts:829-869.
SINIR: gerçek anahtar/secret YOK (CLAUDE.md). Kod varsayılanı mock kalır; testler ağsız. Pilot geçişi (anahtar, `pnpm knowledge:reembed`, `measure:knowledge-recall` → RETRIEVAL_THRESHOLD) yalnız runbook olarak yazılır, otonom döngüde KOŞULMAZ.
MANTIK: tavan `override ?? plan ?? env` (60 sn önbellek, ai_budget_reserve'e parametre); ai_usage_events (best-effort defter: surface ai_agent|copilot|knowledge_index|simulation|qa|cluster, meter, model_tier, token, chat_id?, config_version_id?); maliyet okuma anında env fiyatlarıyla, "tahmini" etiketi, fiyat yoksa para alanı dönmez (AI-16-S3); %80/%100 uyarısı license+UTC gün+meter+eşik tekil; kota dolunca zaman çizelgesine ai.cap_reached (ID-08 hazırsa); gün UTC (ekranda yazılır, ID-04'e çevrilmez); LLM_MODEL_FAST (S4); test meter'ları llm_test/embedding_test (AI-19-S2).

KABUL KRİTERLERİ:
- PILOT_MODE=true production'da LLM_PROVIDER=mock açılmaz (korunur).
- Kurucu kullanım yüzdesini, 30 günlük grafiği, yüzey kırılımını görür; Ekip Üyesi 403.
- X lisansına 500.000 override → X 200.000'i aşar, diğerleri durur.
- %80 eşiğinde gün+meter başına tam 1 bildirim.
- Fiyat env'de yoksa para alanı yok.
- responseFormat çağrısında geçersiz JSON → sağlayıcı hatası, sohbet insana kalır.
- Simülasyon token'ları llm_test meter'ına yazılır.

KULLANILAN VARSAYIMLAR:
- K12: OpenAI us; KVKK yurt dışı aktarım maddesi sözleşme işi (kod dışı).
- AI-16-S2: plan varsayılanı + SiyahTuş ekibi elle yükseltir; Kurucu/Yönetici görür, yükseltemez.
- AI-16-S3, S4, S5 varsayılanları.

**Test Strategy:**

Birim (tavan önceliği, maliyet), entegrasyon ai-usage.test.ts (RLS, toplamlar ai_daily_usage ile eşit), e2e (Kurucu görür, Ekip Üyesi 403); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 283.1. LLM-CONTRACT-TIER [OPUS-HIGH] LlmCompletionRequest: responseFormat (JSON şema) + tier (default|fast); OpenAI adaptörü response_format; mock deterministik JSON

**Status:** pending  
**Dependencies:** None  

ADR §6a (#270) uygulaması. LLM_MODEL_FAST env (4 env dosyasında eşit). Geçersiz JSON → sağlayıcı hatası yolu.

### 283.2. AI-CAPS-LEDGER [OPUS-XHIGH] Kiracı bazlı tavan (licenses.ai_daily_*_cap override → plan → env) + ai_usage_events defteri + test meter'ları

**Status:** pending  
**Dependencies:** 283.1  

XHIGH GEREKÇESİ: (2) para doğruluğu — kota ve kullanım ölçümü. Migration: licenses nullable cap kolonları, ai_usage_events (RLS, (license_id, at desc)), ai_daily_usage meter CHECK genişletmesi. Tek SQL ifadesinde kontrol+artırma korunur.

### 283.3. AI-USAGE-API-ALERTS [OPUS-HIGH] GET /ai/usage (reports_read + admin) + ai-usage-alerts (%80/%100, tekil) + kota dolunca ai.cap_reached

**Status:** pending  
**Dependencies:** 283.2  

contract paths/ai-usage.yaml; yalnız sayı döner, içerik yok; bildirim uygulama içi + e-posta Kurucu ve seçilen alıcılar.

### 283.4. AI-USAGE-WEB-RUNBOOK [SONNET-HIGH] Ayarlar › Kullanım ve kotalar › Yapay zekâ kullanımı ekranı + Performans kartı + pilot geçiş runbook'u

**Status:** pending  
**Dependencies:** 283.3  

AiUsage.tsx + settings-sections kaydı; AiPerformance.tsx token/tahmini maliyet kartı; docs/runbooks altında pilot geçiş adımları (reembed, eşik ölçümü, uyum senaryoları) — koşulmaz, yalnız yazılır.
