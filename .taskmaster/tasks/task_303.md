# Task ID: 303

**Title:** AI-HANDOFF-TRIGGERS-RULES [OPUS-HIGH] (Opus 5.5) Otomatik insana devir (K9): hazır tetikleyiciler, kiracının yapılandırdığı devir kuralları listesi, AI'ın "çözüldü" kararı için kiracının çözüldü kriterleri

**Status:** pending

**Dependencies:** 293 ⏱, 297 ⏱, 298 ⏱, 301 ⏱

**Priority:** high

**Description:** Devir yalnız açık transfer_to_team adımıyla oluyor; model hatasında sohbet sessizce insana kalıyor (skill-engine.ts:26-38); desteklenmeyen dilde sessiz skipped. G16: "insanla görüşmek istiyorum" her zaman karşılanır. K9: AI çözüldü kararını kiracının tanımladığı kriterlere göre verir; devir kuralları (ör. AI çözemedi, hesap/şifre kurtarma, para yatırma) Yönetici/Kurucu tarafından Ayarlar › AI Agent › Devir kuralları ekranından eklenir, kapatılır, sıralanır; platformun kilitli uyum kuralları (G1–G5, G13, G15) kapatılamaz. Kaynak: AI-09.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-09. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3a — AI çekirdeği (çok turlu motor, devir, uyum).

TİPLER packages/types/src/handoff.ts: neden kodları player_request, not_understood, negative_sentiment, no_knowledge, guardrail_rg, guardrail_self_harm, guardrail_minor, guardrail_account_security, guardrail_complaint, abuse, loop_detected, max_turns, repeat_same_day, procedure_rule, missing_required_info, ai_failure, unsupported_language, guardrail_output_block, tenant_rule (K9), player_said_unresolved (AI-25); önem sırası + kilitli mi.
PRİSMA: ai_handoff_settings (license_id, ai_agent_id, triggers {not_understood_turns 2, abuse_warnings 2, max_turns 12, negative_sentiment {enabled, consecutive 2}, ask_before_handoff {not_understood true, no_knowledge_other true}}, messages nedene göre TR, assignment_mode (#293), after_hours (AI-12), no_answer (AI-06)) + RLS.
K9 DEVİR KURALLARI: ai_handoff_rules (id, license_id, ai_agent_id, position, active, locked, trigger {type topic|procedure|phrase|ai_unresolved|player_request|risk_flag, value}, target {topic_key|group_id}, priority urgent|high|normal) + RLS; hazır örnekler: "AI çözemedi", "Hesap ve şifre kurtarma", "Para yatırma"; kiracı ekler/kapatır/sıralar; kilitli G kuralları listede gri, kapatılamaz (400 handoff_trigger_locked).
K9 ÇÖZÜLDÜ KRİTERLERİ: prosedür başına resolution_criteria (ör. "şu slotlar dolu VE oyuncu yes_no=evet ile onayladı" — Cond dili #296) + genel varsayılan (oyuncu açık onayı). AI resolve adımında ya da bilgi cevabında kriter sağlanınca "çözüldü" der; karar ve gerekçe ID-08'e; sağlanmazsa resolve yerine ilgili devir kuralı/soru. AI-25'te "AI'ın çözüldü dediği" ve "oyuncunun onayladığı" ayrı ölçülür.
KONTRAT: GET/PUT /ai-agents/{id}/handoff-settings, /ai-agents/{id}/handoff-rules CRUD + sıralama.
DEĞERLENDİRME YERİ: zorunlu tetikler anlamadan hemen sonra; prosedür kaynaklı yürütücüden sonra; çıktı kaynaklı compose'dan sonra.
TETİKLEYİCİLER: kilitli G1/G2/G3/G5/G13/G15 hemen; player_request (wants_human.explicit) hemen — konu bilinmiyor ve ilk istekse tek "Konuyu kısaca yazar mısınız?" (G16), ikinci istekte koşulsuz; not_understood streak eşikte bir kez "aktarayım mı?" ya da devir; negative_sentiment; no_knowledge (AI-06 politikası); abuse (2 uyarı); loop_detected (aynı bot sorusu 2 / aynı oyuncu mesajı 3); max_turns; repeat_same_day (teşhis atlanır, eksik zorunlu slot sorulur, devir); missing_required_info; ai_failure (sağlayıcı hatası/tavan/zaman aşımı/geçersiz JSON → LLM'siz sabit metin + devir, bugünkü sessizliğin yerine); unsupported_language; tenant_rule.
BİRDEN ÇOK NEDEN: hepsi kayıt; primary_reason önem sırasıyla.
DEVİR MESAJI: nedene göre kiracı metni verbatim (LLM yok); mesai dışında AI-12 metni.
YÜRÜTME: handoffService.execute(conversation, reasons) → kart (AI-10) → mode=human (AI-11) → hedef + aktarım (AI-12) → RTM; idempotent.
TRANSFER OLAYI: chat-service.ts:1446-1460 properties'e handoff_id, reason_codes, priority.
WEB: HandoffSettings.tsx (tetikleyici anahtarları/eşikler, kilitliler gri, devir mesajları, Devir kuralları listesi sürükle-sırala, Çözüldü kriterleri — prosedür editöründe de alan).

KABUL KRİTERLERİ:
- "insanla görüşmek istiyorum" → aynı turda devir (konu biliniyorsa soru yok).
- Art arda iki anlaşılamayan tur → ayara göre tek "aktarayım mı?" ya da devir.
- Model hatası ve günlük tavan → oyuncu sabit metni görür, devir olur; sessizlik yok.
- Desteklenmeyen dil → devir.
- Kilitli tetikleyiciler API'den kapatılamaz.
- Kiracının "Para yatırma → Finans, high" kuralı yatırım konusunda devri tetikler; kural kapatılınca tetiklemez; sıralama uygulanır.
- Çözüldü kriteri sağlanmadan AI "çözüldü" demez; karar gerekçesiyle karar kaydında.
- Her devirde neden kodları transfer olayında ve kartta.

KULLANILAN VARSAYIMLAR:
- K9 (05 metninden geniş).
- AI-09-S1: açık istekte en fazla bir netleştirme; uyum tetiklerinde sormadan; anlaşılamadıda bir kez sor.
- AI-09-S2 eşikler 2/2/12, kiracı değiştirebilir, uyum tetikleri kapatılamaz.

**Test Strategy:**

Her tetikleyici için birim + entegrasyon; devir kuralları CRUD/sıralama; çözüldü kriterleri; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 303.1. HO-TYPES-SETTINGS [OPUS-HIGH] handoff.ts neden kodları + ai_handoff_settings + kontrat

**Status:** pending  
**Dependencies:** None  

Üst görev 303 ayrıntılarındaki ilgili bölüm.

### 303.2. HO-TRIGGERS-EXECUTE [OPUS-HIGH] triggers.ts + handoffService.execute (kart → mod → hedef) + transfer olayı özellikleri + ai_failure sabit metni

**Status:** pending  
**Dependencies:** 303.1  

Üst görev 303 ayrıntılarındaki ilgili bölüm.

### 303.3. HO-TENANT-RULES [OPUS-HIGH] K9 devir kuralları listesi (ai_handoff_rules): CRUD, sıralama, hazır örnekler, kilitli G satırları

**Status:** pending  
**Dependencies:** 303.1  

Üst görev 303 ayrıntılarındaki ilgili bölüm.

### 303.4. HO-RESOLUTION-CRITERIA [OPUS-HIGH] K9 çözüldü kriterleri: prosedür başına + genel varsayılan, resolve kararı, ID-08 gerekçesi

**Status:** pending  
**Dependencies:** 303.2  

Cond dili #296.

### 303.5. HO-WEB [SONNET-HIGH] HandoffSettings.tsx (tetikleyiciler, mesajlar, devir kuralları, çözüldü kriterleri)

**Status:** pending  
**Dependencies:** 303.3, 303.4  

Üst görev 303 ayrıntılarındaki ilgili bölüm.
