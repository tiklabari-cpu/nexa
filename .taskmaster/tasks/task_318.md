# Task ID: 318

**Title:** AI-COACHING-SUGGESTIONS [OPUS-HIGH] Koçluk ve öneri kuyruğu: ajan AI mesajını işaretler / kendi yanıtını "AI bilgisine öner"; LLM genellemesi + maskeleme; Ekip Lideri onayı → AI-20 taslağı

**Status:** pending

**Dependencies:** 304 ⏱, 316 ⏱, 317 ⏱

**Priority:** medium

**Description:** AI'ı en iyi tanıyan her gün oyuncuyla konuşan ajan; "Papara artık 7/24 değil" gibi değişiklikleri ilk o duyar. Bugün ajandan AI'a geri bildirim kanalı yok; bilgi WhatsApp gruplarında kaybolur. Kaynak: AI-23.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-23. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3c — AI yönetişimi ve ölçüm.

PRİSMA: ai_suggestions (id, license_id, ai_agent_id, kind wrong_answer|missing_info|should_have_handed_off|should_not_have_handed_off|tone|promote_agent_answer|other, source agent_flag|qa_finding|unresolved_cluster, chat_id, thread_id, event_ids, excerpt_masked (son 6 mesaj, oluşturma anında maskeli kopya), note, team_id, proposed_change {target knowledge_snippet|guidance_rule|procedure_example|procedure_note, title, body, source_id?}, duplicate_of?, similar_chunk_ids, status new|drafting|in_review|accepted|rejected|merged, reviewer_id, reviewed_at, review_note, resulting_change_id?, created_by, created_at) + RLS + indeks (license_id, status, team_id, created_at).
API routes/ai-suggestions.ts: POST /ai/suggestions (resolveVisibility; wrong_answer'da event AI mesajı mı; aynı event+tür+ajan ikinci 409; ajan başına günde 50); GET (EL için ekip kapsamı sunucuda; EÜ yalnız kendi); PATCH (kabul/ret/birleştir, metin düzenleme; ret notu zorunlu 400); POST …/{id}/to-scenario (AI-19). Servisler suggestions.ts, suggestion-drafting.ts.
TASLAK (iş ai_suggestion_drafts): promote_agent_answer ve missing_info için fast model JSON {title, body, applies_to_intent, removed_specifics} — oyuncuya özgü ad/kullanıcı adı/tutar/tarih/işlem no çıkarılır; sonra AI-26 maskelemesi.
YİNELENEN: taslak KB'de aranır, ≥τ → similar_chunk_ids + "Bilgi zaten var; AI neden bulamadı?" ipucu.
İNCELEME: EL yalnız team_id kendi ekiplerinden (öneri anındaki ekip); kabul → hedefe göre AI-20 taslağına değişiklik + AI-21 bağlantısı (canlıya yayınla geçer; AI-23-S1: EL onayı taslağa çevirir, yayın dört göz; metin düzeltmesi hızlı yol); birleştirme öneriye ya da AI-22 kümesine.
OTOMATİK ÖNERİ (S2): her devirde değil; yalnız ajan "AI bilgisine öner" dediğinde ya da aynı AI-22 kümesinde haftada 3+ benzer ajan yanıtında.
DEVİR KARTI BANDI: "Yeterli / Eksik: [alan çipleri]" AI-25 ai_conversation_outcomes'a yazar, öneri açmaz; yalnız "gereksiz devretti" should_not_have_handed_off açar.
RTM ai_suggestion_created (onaycı rozet sayısı). Tipler SUGGESTION_KINDS; yetenekler ai.suggest, ai.suggestions.review.
WEB: Transcript AI mesajında "⋯ › AI'ı düzelt" modalı (neden çipleri + not), ajan mesajında "AI bilgisine öner", Playbook › Öneriler (Suggestions.tsx: solda kesit ve ID'ler, sağda düzenlenebilir öneri).

KABUL KRİTERLERİ:
- EÜ AI mesajını "yanlış" işaretleyince öneri saniyeler içinde liderin kuyruğunda, rozet artar.
- "ali123" ve "2.500 TL" içeren ajan yanıtından taslakta bu değerler yok.
- Kabul edilen öneri AI-20 farkında, yayına kadar canlıyı değiştirmez.
- Notsuz ret 400.
- A liderinin B önerilerini görmemesi (API).
- Var olan bilgiyle aynı öneri "zaten var" uyarısıyla.

KULLANILAN VARSAYIMLAR:
- AI-23-S1/S2 varsayılanları.

**Test Strategy:**

Görünürlük, genelleştirme fixture'ı, ekip kapsamı, ret notu, taslağa düşme, oran sınırı; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 318.1. SUG-API [OPUS-HIGH] ai_suggestions + uçlar + taslak işi (genelleme + maskeleme) + yinelenen tespiti + RTM

**Status:** pending  
**Dependencies:** None  

Üst görev 318 ayrıntılarındaki ilgili bölüm.

### 318.2. SUG-WEB [SONNET-HIGH] Transcript "AI'ı düzelt" / "AI bilgisine öner" + Suggestions.tsx + devir kartı bandı

**Status:** pending  
**Dependencies:** 318.1  

Üst görev 318 ayrıntılarındaki ilgili bölüm.
