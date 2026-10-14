# Task ID: 319

**Title:** AI-QA-QUEUE [OPUS-HIGH] (Opus 5.5) Kalite kontrol (QA) kuyruğu: deterministik %5 örneklem + risk bayraklı/zorunlu kategorilerin %100'ü, rubrik, LLM ön puan + Ekip Lideri onayı, tutarlılık işi, kalibrasyon

**Status:** pending

**Dependencies:** 288 ⏱, 302 ⏱, 314 ⏱

**Priority:** medium

**Description:** CGA şikâyet yönergesi AI kayıtlarının izlenmesini ve tutarlılığın doğrulanmasını, UKGC değerlendirme kanıtı istiyor. Kiracı operatöre "AI bu hafta %98 kurallara uydu, ihlaller şunlar" diyebilmeli. Bugün QA modülü yok. Kaynak: AI-24.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-24. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3c — AI yönetişimi ve ölçüm.

PRİSMA (RLS): qa_rubrics (version, criteria [{key, label, type pass_fail|score_1_5, weight, critical, locked}], active); qa_reviews (chat_id, thread_id, ai_agent_id, config_version_id, team_id, brand_id, reasons, priority, status pending_prescore|ready|in_review|completed, assigned_to?, due_at, rubric_id, prescore, scores, final pass|fail, critical_fail, excerpt_masked, reviewer_id, reviewed_at, comments); qa_calibrations, qa_calibration_scores. İndeksler (license_id, status, due_at), (license_id, team_id, status).
TİPLER: platform rubriği a doğru konu, b zorunlu bilgiler, c bilgiye sadakat, d guardrail uyumu, e doğru zamanda devir, f devir özeti, g ton (d ve e critical + locked); QA_REASONS random, risk_flag, low_bsat, repeat_72h, guardrail_scan, mandatory_handoff, handoff_insufficient, consistency, manual.
SERVİSLER services/qa/: sampler.ts, prescore.ts, consistency.ts, qa-service.ts. ZAMANLAYICI: qa_sampling (kiracı TZ'de 02:00), qa_prescore (kuyruk), qa_consistency (haftalık).
İNCELEME BİRİMİ: AI'ın katıldığı bir bağlantı (Chat ID) + devir sonrası ilk birkaç insan mesajı.
ÖRNEKLEM: önceki gün kapanan AI bağlantıları; deterministik hash(license, gün, thread_id) < r (AI-24-S1: %5, kiracı %1–20); zorunlu kategoriler %100 ve kilitli (risk bayrağı, kötü BSAT, 72 saat tekrar temas (AI-25), guardrail işaretleri, zorunlu devirler, "yetersiz" kartlar, tutarlılık sapmaları); öncelik risk > guardrail > diğer; son tarih risk 2 iş günü, diğer 7 gün.
ÖN PUAN (S2: açık, yalnız kuyruğa düşenlerde, maskeli metinle, kiracı kapatabilir): default model, sıcaklık 0, JSON {criteria [{key, value, evidence_event_ids, rationale}], critical_candidates, overall}; kanıt id'leri bu sohbete ait değilse atılır; hata → ön puansız ready.
İNSAN: kritik kriterler tek tek onaylanmadan kayıt yok; kritik hatada otomatik AI-23 önerisi + AI-19 senaryo taslağı + zorunlu devir ihlalinde ai_conversation_outcomes.mandatory_handoff_violation + Yönetici bildirimi.
AI-25'E AKIŞ: yanlış çözüm, zorunlu devir uyumu, doğrulanmış guardrail ihlali, tutarlılık.
TUTARLILIK: haftalık (konu, prosedür, bilgi kovaları) gruplarında farklı sonuç/kalıp çiftleri consistency nedeniyle kuyruğa.
KALİBRASYON: ayda bir aynı 20 konuşma tüm liderlere; kriter başına uyum yüzdesi.
YETKİ: inceleyen kendi devraldığı sohbeti inceleyemez; sorumlu oyun transkriptinin tam metni yalnız Sorumlu Oyun ekibi ve Yönetici.
İnsan ajan QA F1'de yok (S3).
API routes/qa.ts + paths/qa.yaml: GET /qa/reviews, GET …/{id} (transkript + karar izi + ön puan), POST …/{id}/claim, PUT …/{id}, POST /qa/reviews (elle), GET|PUT /qa/settings, kalibrasyon, GET /qa/summary.
WEB: Raporlar › AI Kalite: QaQueue.tsx, QaReview.tsx (transkript / karar izi ID-09 / rubrik), QaCalibration.tsx; Ayarlar › AI kalite (AiQuality.tsx); Inbox "QA'ya gönder" (EL+).

KABUL KRİTERLERİ:
- %5 oran ve günde 1.000 AI konuşmasıyla ~50 rastgele + tüm zorunlu kategoriler; aynı gün yeniden koşuda aynı liste.
- Risk bayraklı her AI konuşması kuyrukta.
- Ön puan yalnız o sohbetin event ID'lerine atıf; geçersiz atıf atılır.
- Kritik kriterler tek tek onaylanmadan kayıt yok.
- Kritik hata otomatik AI-23 önerisi + AI-19 senaryo taslağı.
- A lideri B incelemelerini göremez.
- QA sonuçları AI-25 oranlarına yansır.
- Kalibrasyon raporu kriter başına uyum yüzdesi.

KULLANILAN VARSAYIMLAR:
- AI-24-S1/S2/S3 varsayılanları.
- QA kanıtı saklama süresi AI-21-S1 ile birlikte hukuki karar.

**Test Strategy:**

Örneklem tekrar üretilebilirliği, %100 kategoriler, kanıt doğrulaması, kritik hata eylemleri, ekip kapsamı, RLS; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 319.1. QA-SCHEMA-SAMPLER [OPUS-HIGH] QA tabloları + rubrik/nedenler + sampler (deterministik + zorunlu kategoriler) + zamanlayıcı

**Status:** pending  
**Dependencies:** None  

Üst görev 319 ayrıntılarındaki ilgili bölüm.

### 319.2. QA-PRESCORE-REVIEW [OPUS-HIGH] Ön puan (kanıt doğrulamalı) + inceleme/claim + kritik hata eylemleri + tutarlılık + kalibrasyon

**Status:** pending  
**Dependencies:** 319.1  

Üst görev 319 ayrıntılarındaki ilgili bölüm.

### 319.3. QA-WEB [OPUS-HIGH] QaQueue, QaReview (3 bölme), QaCalibration, AiQuality ayarı, Inbox "QA'ya gönder"

**Status:** pending  
**Dependencies:** 319.2  

Üst görev 319 ayrıntılarındaki ilgili bölüm.
