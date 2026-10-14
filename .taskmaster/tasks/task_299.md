# Task ID: 299

**Title:** AI-GUIDANCE-RULES [OPUS-HIGH] (Opus 5.5) Davranış talimatları (Guidance) ekranı: düz yazı kurallar, kapsam/öncelik, prompt katman sırası, çelişki denetimi, instruction alanının taşınması

**Status:** pending

**Dependencies:** 270 ⏱, 292 ⏱

**Priority:** high

**Description:** Kiracının AI'a genel talimat yazabileceği yer yok: ai_agents.instruction var ama yazılamıyor ve modele gitmiyor (schema.prisma:1562, playbook.ts:404-413, answer-prompt.ts:65-75 sabit). Kaynak: AI-07.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-07. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3a — AI çekirdeği (çok turlu motor, devir, uyum).

PRİSMA: ai_guidance_rules (id, license_id, ai_agent_id, title, body ≤600, category communication|clarification|sensitive|prohibition|other, scope {all}|{skill_ids}|{brand_ids}, priority, active, owner_id, created_by, updated_by, zaman) + RLS (status YOK — sürüm paketi #290). Veri taşıma: dolu ai_agents.instruction → "Genel talimat" kuralı (genişlet → taşı; kolon sonra düşer).
PERSONA: address_form siz|sen, emoji none|few, max_questions_per_message 1–3.
KONTRAT: GET/POST /ai-guidance, PATCH/DELETE /ai-guidance/{id}, POST /ai-guidance/check; AiAgent persona alanları.
PROMPT KATMAN SIRASI (sabit): [1] platform kilitli kuralları (AI-08) → [2] kiracı uyum ekleri → [3] aktif adım talimatı → [4] kapsamdaki davranış kuralları (öncelik, kategori) → [5] persona → [6] bağlam. "Çelişkide üstteki katman kazanır".
SEÇİM: active + kapsamı all ya da aktif prosedür/marka; tur başına ≤30 kural ve 6 000 karakter; aşımda düşük öncelik düşer + guidance_truncated kaydı.
max_questions_per_message yürütücüde deterministik; emoji/hitap compose talimatı + çıkış denetiminde uyarı.
ÇELİŞKİ DENETİMİ (kaydederken uyarı, engellemez): örtüşen kurallar ≤20'li gruplar halinde LLM JSON {conflicts, duplicates, vague}; kilitli kuralla çelişen → "uygulanmayacak" uyarısı.
DETERMİNİSTİK RET: şifre/OTP/kart istemeyi, bonus teklifini zorunlu kılmayı, AI-08 kilitli eylemlerini kapatmayı söyleyen kural → 400 guidance_violates_locked_rule.
iGaming varsayılan kuralları AI-15 kurulumuyla gelir. Her değişiklik AI-21'e (#315 gelince kancalanır).
WEB: GuidanceRules.tsx (kategori gruplu, sayaçlı editör, çelişki paneli, "bu kuralla test et" → AI-19); PlaybookPage VIEW_TABS'a sekme.

KABUL KRİTERLERİ:
- Yatırım prosedürüne kapsamlanan kural yalnız o prosedürün turlarında compose isteğinde (mock yakalama).
- Dolu instruction'lı ajanlarda migration sonrası "Genel talimat" kuralı.
- "Oyuncudan şifresini iste" kuralı 400.
- Zıt iki kural için çelişki uyarısı.
- max_questions_per_message=1 iken her mesajda tek soru.

KULLANILAN VARSAYIMLAR:
- AI-07'de açık soru yok; kimin düzenleyeceği RL-02, yayın AI-20.

**Test Strategy:**

Birim (seçim, bütçe, yasak içerik), entegrasyon (kapsam); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 299.1. GUIDE-API [OPUS-HIGH] ai_guidance_rules + persona alanları + instruction taşıma + CRUD/check uçları + guidance.ts prompt derleme

**Status:** pending  
**Dependencies:** None  

Üst görev 299 ayrıntılarındaki ilgili bölüm.

### 299.2. GUIDE-WEB [SONNET-HIGH] GuidanceRules.tsx + ProfileForm hitap/emoji/soru sayısı

**Status:** pending  
**Dependencies:** 299.1  

Üst görev 299 ayrıntılarındaki ilgili bölüm.
