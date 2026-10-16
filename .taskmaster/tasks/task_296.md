# Task ID: 296

**Title:** AI-PROCEDURE-ENGINE [OPUS-XHIGH] (Opus 5.5) Prosedür (konu akışı) motoru: çok turlu Skill (mode=procedure), adım/koşul dili, sürüm sabitleme, konu değişimi, SOP'tan taslak, editör (görsel tuval YOK)

**Status:** pending

**Dependencies:** 269 ⏱, 290 ⏱, 292 ⏱, 295 ⏱

**Priority:** high

**Description:** "Param yatmadı" tek mesajla çözülmez: yöntem/saat sor → beklenen süreyle karşılaştır → bekleme ya da talep/hesap/dekont sor → çöz ya da finansa devret. Bugünkü adımlar tek mesajda baştan sona koşuyor (skill-engine.ts:412-497), koşul/dallanma/"cevabı bekle" yok, skills.trigger kullanılmıyor. K8: Skill yeni kavram açmadan çok turlu prosedüre genişler, ADR-14a (#269). Kaynak: AI-03.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-03. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3a — AI çekirdeği (çok turlu motor, devir, uyum).

XHIGH GEREKÇESİ (eski etiket MAX, 2026-10-14 gözden geçirme): algoritma tasarımı.
TANIM (packages/types/src/procedure.ts, web+API ortak): Procedure {when_to_use, examples[], priority, slots: SlotDef[], steps: ProcStep[], templates [{key,text,verbatim?}], handoff {conditions, target (AI-12), card_fields, next_step_hint}, limits {max_turns 12}}. ProcStep: say{template_key|instruction} · collect{slots ≤2} · check{when, then, else?} · answer_from_knowledge{query_hint?} · handoff{reason_code, target?} · resolve{outcome resolved|resolved_waiting, followup_template?} · tag{tag} · tool{tool_key, inputs, active:false} (AI-28 yuvası, F1'de atlanır). Cond = all|any|not|slot{name,op,value}|fact{path,op,value}|fn{name,args}|ai{question}; op: eq neq lt lte gt gte in not_in exists missing matches; fn sabit liste: elapsed_minutes, within_working_hours, next_window; fact yolları AI-13 tablolarından (#310; o gelene kadar facts arayüzü stub, testlerde fixture); ai koşulu anlama çıktısında ai_conditions, unknown=false + kayıt. Serbest ifade/eval YOK.
PRİSMA (genişletme, varsayılanlı): skills.mode text default 'single', when_to_use, examples text[], priority int default 100, slots jsonb, procedure jsonb, locked bool, template_key, template_version, is_fallback bool (AI-05). status/version EKLENMEZ (#290 sürüm paketi).
YÜRÜTME: başta slotlar anlama çıktısı + gün içi özetle önden dolar; tur başına ≤8 iç adım (döngü kalkanı); collect eksik zorunlu slotları max_questions_per_message ile sorar → awaiting_answer; check dallanır; say kalıbı doldurur (eksik değişkende kalıp gönderilmez, hata kaydı, instruction kullanılır); answer_from_knowledge → AI-06; handoff → AI-09/10/12; resolve sonucu işaretler (K9 çözüldü kriterleri #303); tool F1'de "pasif, atlandı" kaydı. Eylemler tek mesajda compose'a; verbatim kalıplar olduğu gibi.
SÜRÜM SABİTLEME: başta tanım procedure_snapshot'a kopyalanır; konuşma sürerken yayın onu etkilemez.
KONU DEĞİŞİMİ: başka prosedür eşik üstü → aktif awaiting_answer ise suspended (≤1), yenisi başlar; yenisi resolve ile biterse "Önceki konuya dönelim mi?" (yes_no); kilitli prosedürler (self_exclusion, rg_signal) her şeyin önüne geçer, askıdakini siler (AI-03-S3).
BEKLEME: zamanlayıcı yok; 30 dk'dan uzun aradan sonra "uzun ara" notu (AI-03-S4: bağlantı kapanınca özete yazılır, aynı gün devam).
KAYDETME DOĞRULAMASI (400 + problem kodu): olmayan goto, collect'siz döngü, collect >2 slot, tanımsız kalıp değişkeni, hassas slot (AI-04), geçersiz devir hedefi, locked'da yalnız kalıp metni değişir; erişilemeyen adım uyarı.
KONTRAT: Skill yeni alanlar; ProcedureStep birleşik tip; POST /skills/compile {mode:'procedure', sop_text} → JSON şemalı LLM taslağı (asla otomatik etkin değil; mock'ta kural tabanlı iskelet) (K8 yardımcısı); GET /chats/{chatId}/ai-conversation (ajan; resolveVisibility; müşteri API'sinden asla). POST /skills/preview'a conversation girdisi + state çıktısı (tam çok turlu test AI-19).
WEB: SkillEditor bölümleri (Ne zaman kullanılır, Örnek cümleler, Öncelik, Toplanacak bilgiler, Adımlar [tip + talimat + isteğe bağlı Eğer… + hedef adım], Yanıt kalıpları, Devir); listede mode rozeti ve öncelik. step-contract-parity.test.ts genişler.
KAYIT: her adım kararı ID-08'e (turn_id, step_id, type, cond_result, detail); tur başına skill_runs satırı.

KABUL KRİTERLERİ:
- Araştırma §3.1 "yatırım geçmedi" akışı mock LLM ile 4–6 turda koşar; geçen/beklenen süreye göre A/B/C/D kalıplarına dallanır; resolved_waiting ya da tüm slotlarla devir.
- Konuşma sürerken yayınlanan değişiklik o konuşmayı etkilemez.
- Kaydetme şunları reddeder: olmayan goto, collect'siz döngü, 3 slotlu collect, tanımsız kalıp değişkeni, "şifre" slotu, olmayan ekip.
- Akış ortasında konu değişimi askıya alma ve "önceki konuya dönelim mi?" üretir.
- Eski tek mesajlık skill testleri geçer.
- tool adımı F1'de atlanır ve kayda düşer; max_turns aşımında devir nedeni max_turns.

KULLANILAN VARSAYIMLAR:
- K8: yapılandırılmış adım listesi + düz yazı talimat + SOP yardımcısı.
- AI-03-S3 (askıda en fazla 1 konu), S4 (bağlantı açık kaldıkça bekler).

**Test Strategy:**

Birim (yürütücü, koşul değerlendirici, kaydetme doğrulaması), entegrasyon (§3.1 uçtan uca), e2e playbook.spec.ts prosedür düzenleme; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 296.1. PROC-TYPES [OPUS-XHIGH] packages/types procedure.ts: Procedure/ProcStep/Cond tipleri + kaydetme doğrulayıcısı + problem kodları

**Status:** pending  
**Dependencies:** None  

Web ve API aynı doğrulayıcıyı kullanır.

### 296.2. PROC-SCHEMA [OPUS-HIGH] Migration: skills yeni kolonlar (varsayılanlı) + contract Skill/ProcedureStep

**Status:** pending  
**Dependencies:** 296.1  

Mevcut skill'ler için veri taşıma gerekmez.

### 296.3. PROC-EXECUTOR [OPUS-XHIGH] executor.ts: adım döngüsü (tur başına ≤8 iç adım), procedure_snapshot, konu değişimi/askı, max_turns

**Status:** pending  
**Dependencies:** 296.1, 296.7  

facts arayüzü (AI-13 öncesi stub).

### 296.7. PROC-CONDITIONS-TEMPLATES [OPUS-HIGH] conditions.ts (Cond ağacı: all|any|not|slot|fact|fn|ai, op listesi, sabit fn listesi, fact stub arayüzü) + templates.ts (kalıp doldurma; eksik değişkende gönderme yok + hata kaydı) — saf modüller

**Status:** pending  
**Dependencies:** 296.1  

Üst görev TANIM'daki Cond ve templates kuralları; serbest ifade/eval YOK; tipler 296.1'de. Executor (296.3) bunları kullanır. Ayrıntı ve kabul maddeleri: üst görev #296 details (tek kaynak).

### 296.4. PROC-API [OPUS-HIGH] POST /skills/compile (procedure, SOP taslağı) + GET /chats/{id}/ai-conversation + preview conversation girdisi

**Status:** pending  
**Dependencies:** 296.2, 296.3  

Görünürlük resolveVisibility (access.ts:62).

### 296.5. PROC-EDITOR [OPUS-HIGH] SkillEditor prosedür bölümleri + liste rozeti/öncelik (görsel tuval YOK)

**Status:** pending  
**Dependencies:** 296.4  

step-authoring.ts, step-reorder.ts deseni.

### 296.6. PROC-LEGACY-REGRESSION [OPUS-HIGH] Eski skill regresyonu + ID-08 adım kayıtları + skill_runs sürekliliği

**Status:** pending  
**Dependencies:** 296.3  

AI Agent raporu skill_runs'tan okur.
