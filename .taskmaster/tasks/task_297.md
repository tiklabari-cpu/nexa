# Task ID: 297

**Title:** AI-UNDERSTAND-SELECT [OPUS-HIGH] LLM tabanlı anlama ve prosedür seçimi: tek JSON çağrısı (konu, slot, insan isteği, duygu, risk), deterministik policy, netleştirme, yedek prosedür

**Status:** pending

**Dependencies:** 270 ⏱, 296 ⏱

**Priority:** high

**Description:** Seçim kelime örtüşmesiyle (intent.ts:29, eşik 0.6), öncelik yok (en son düzenlenen kazanıyor, skill-engine.ts:239-256), detect_intent adımı olmayan skill her mesaja uyuyor (:366-370). Oyuncular aynı şeyi yazım hatalarıyla çok farklı söylüyor. Kaynak: AI-05.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-05. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3a — AI çekirdeği (çok turlu motor, devir, uyum).

understand.ts: katalog (yayındaki prosedürler, marka süzgeci AI-14; kilitliler + aktif her zaman; ≤8 örnek); 15'ten büyükse ön eleme (turun tek embedding'i, ai_procedure_examples tablosu (id, license_id, skill_id, text, embedding vector(1536), embedding_space) + RLS + HNSW indeksi ayrı migration'da).
JSON ÇIKTI (ADR §6a): {language, relates_to_previous, wants_human{value, explicit}, intent{procedure_key|null, confidence, alternatives, is_continuation, smalltalk, off_topic}, answers_pending_question, yes_no, extracted (AI-04), correction, ai_conditions (AI-03), sentiment positive|neutral|negative|angry, abuse, risk{self_exclusion, rg_signal, self_harm, minor, fraud_aml, complaint_formal, account_takeover} her biri {flag, evidence_quote}}. Şema doğrulama; geçersizse 1 yeniden; yine geçersiz → ai_failure (AI-09).
POLICY (deterministik): 1) zorunlu devirler (AI-08/09) 2) aktif prosedür + (is_continuation | answers_pending_question) → sürdür 3) confidence ≥ high (0.70) → başlat/geç; beraberlikte (fark <0.10) kilitli > küçük priority > yüksek güven 4) low (0.40) ≤ c < high ve aday varsa → en iyi iki adayla tek seçmeli netleştirme (art arda ikincisi yok) 5) diğer → AI-06 bilgi yolu; smalltalk → kısa persona cevabı 6) hiçbiri → unmatched olayı (AI-22).
YEDEK PROSEDÜR: is_fallback (ajan başına en fazla 1); migration: detect_intent adımı olmayan eski skill'ler is_fallback=true + panelde uyarı ("her mesaja uyan skill" biter).
MOCK: matchIntent ile örnek cümlelerden deterministik çıktı; dil mock'ta detectLanguage. Desteklenmeyen dil sessizlik değil devir (AI-09).
Kontrat: Skill.is_fallback; AiAgent.clarify_thresholds{high, low}. LLM_UNDERSTAND_MODEL ya da tier fast, sıcaklık 0. Kayıt: seçilen prosedür, güven, alternatifler ID-08'e.
FİKSTÜR: apps/api/test/fixtures/ai-intents-tr.json (20 iGaming konusu, ≥200 cümle, yazım hataları dahil); gerçek sağlayıcıyla gece değerlendirmesi isteğe bağlı (DoD dışı).

KABUL KRİTERLERİ:
- "havale attım gözükmüyor", "usdt gönderdim düşmedi", "bakiyem gelmedi" → deposit_not_credited (mock'ta örneklerle).
- Eşit güvende küçük priority kazanır.
- Niyet adımı olmayan eski skill başka prosedür eşleşince cevap vermez.
- Düşük güvende iki seçenekli tek netleştirme; art arda ikinci yok.
- Aktif prosedürde "Papara" devam olarak işlenir.
- "hesabımı kapatın" her durumda kilitli self-exclusion'ı seçer.

KULLANILAN VARSAYIMLAR:
- AI-05-S1: iki aday arasında tek seçmeli soru, hiçbirine yakın değilse bilgi yolu.

**Test Strategy:**

Mock ile birim/entegrasyon (DoD); fikstür seti; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 297.1. UND-CALL [OPUS-HIGH] understand.ts: katalog, JSON şema, doğrulama/yeniden deneme, mock çıktısı

**Status:** pending  
**Dependencies:** None  

Üst görev 297 ayrıntılarındaki ilgili bölüm.

### 297.2. UND-POLICY [OPUS-HIGH] policy.ts karar sırası + netleştirme + yedek prosedür migration'ı + clarify_thresholds

**Status:** pending  
**Dependencies:** 297.1  

Üst görev 297 ayrıntılarındaki ilgili bölüm.

### 297.3. UND-PREFILTER-FIXTURE [OPUS-HIGH] ai_procedure_examples + HNSW ön eleme (>15 prosedür) + ai-intents-tr.json fikstürü

**Status:** pending  
**Dependencies:** 297.1  

İndeks kendi migration dosyasında.
