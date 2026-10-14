# Task ID: 320

**Title:** AI-QUALITY-METRICS [OPUS-XHIGH] AI metrikleri: onaylı / varsayılan / yanlış çözüm, containment, devir oranı ve kalitesi, zorunlu devir uyumu, guardrail ihlali, BSAT, tutarlılık — faturalanan AI çözümünden ayrı (ADR-09a)

**Status:** pending

**Dependencies:** 303 ⏱, 304 ⏱, 316 ⏱, 319 ⏱

**Priority:** medium

**Description:** Containment yanıltıcı (araştırma örneği: %72,6 containment, %35,2 gerçek çözüm). Gerçek başarı ölçülmezse AI yanlış yöne optimize edilir; sorumlu oyun devirlerinin %100 yapıldığı kanıtlanmalı. K9: "AI'ın çözüldü dediği" ile "oyuncunun onayladığı" ayrı ölçülür; yanlış çözüm 72 saat içinde tekrar gelmeyle. Kaynak: AI-25.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-25. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3c — AI yönetişimi ve ölçüm.

XHIGH GEREKÇESİ: (2) para doğruluğu — faturalanan sayaç ile yeni metrikler yan yana; ADR-09a regresyonu.
PRİSMA: ai_conversation_outcomes (AI'ın katıldığı her bağlantı için tek satır): kimlik license_id, chat_id (=Thread ID), thread_id (=Chat ID), member_key (geçerli üye tokenı #287 müşterisi), brand_id, team_id, ai_agent_id, config_version_id, language; intent, procedure_id; started_at, ended_at; ai_turns, player_turns, clarification_turns, required_slots_total/filled; outcome confirmed_resolved|assumed_pending|assumed_resolved|false_resolved|handed_off|abandoned|declined, ai_claimed_resolved bool (K9), resolution_confirmation yes|no|null + confirmed_at; handoff_at, handoff_reason, handoff_mandatory_rule, first_human_reply_at, handoff_card_rating, handoff_card_missing, agent_reasked; bsat, csat_after_handoff; guardrail_hits, guardrail_violations_confirmed, flags, mandatory_handoff_violation; repeat_same_intent_72h, repeat_any_72h, repeat_of_id?; qa_result; finalized_at. ratings.subject ai|human. Rollup ai_metrics_daily (gün kiracı TZ, ID-04).
YAZMA NOKTALARI: ilk AI turu satırı açar; her tur sayaçlar/konu; devirde devir alanları; ilk insan mesajında first_human_reply_at; widget "Çözüldü mü? Evet/Hayır" (AI-25-S2; AI-29 ortak bileşen) onay alanları — "Hayır" yeniden devir (player_said_unresolved); puan → bsat/csat; kart bandı (AI-23) devir kalitesi; kapanışta devir/onay yoksa assumed_pending; AI-08 guardrail_hits; AI-27 flags; AI-24 qa_result.
ZAMANLAYICI: ai_outcomes_finalize (saatlik: kapanıştan 72 saat geçen satırlarda tekrar temas + kesinleştirme), ai_metrics_rollup (saatlik).
TANIMLAR (types'ta tek kaynak, ipucu metinleri dahil): payda N (AI'ın en az bir anlamlı tur yazdığı bitmiş bağlantılar); onaylı = confirmed_resolved/N; varsayılan = kesinleşmiş assumed_resolved/N (+ kesinleşmemiş ayrı); yanlış = (onaylı ∪ varsayılan) içinde (repeat_same_intent_72h ∨ qa unresolved); containment (uyarı notlu); devir oranı + neden dağılımı (no_knowledge → AI-22 bağlantısı); devir kalitesi = sufficient/(sufficient+insufficient) + tekrar sorma oranı; zorunlu devir uyumu (hedef %100, ihlaller ID'leriyle); guardrail ihlali (QA doğrulanmış; otomatik şüpheliler ayrı sütun); BSAT yalnız AI'ın tek başına yürüttüklerinde; netleştirme verimliliği; devir sonrası bekleme medyan/p90 mesai içi/dışı; tutarlılık (AI-24).
TEKRAR TEMAS (S3): aynı member_key'in bitişten sonraki 72 saatte açtığı herhangi bir bağlantı (aynı gün thread'inde yeni Chat ID dahil); konu aynıysa same_intent; member_key yoksa "ölçülemedi" kovası.
API: GET /reports/ai-agent geriye uyumlu (resolutions aynen, ADR-09a; yeni quality bloğu); GET /reports/ai-agent/breakdown?by=intent|reason|version|language|brand|team; GET /reports/ai-agent/conversations?metric=…; paths/reports.yaml; MCP get_report (services/mcp/tools/get-report.ts:42) aynı fonksiyondan.
WEB: Raporlar › AI Agent KPI kutuları, devir nedeni dağılımı, sürüm karşılaştırması, filtreler, "Faturalanan AI çözümü (ADR-09)" ayrı etiketli kutu, Türkçe tanım ipuçları; AiPerformance.tsx kartları; performance.ts "az örnek" uyarısı yeni oranlara.
GÖRÜNÜRLÜK: Kurucu/Yönetici tamamı, EL kendi ekip/marka (RL-02).
Fatura (S1): ADR-09a tanımında kalır; yanlış çözümlerin faturadan düşülmesi F2 ticari karar.

KABUL KRİTERLERİ:
- Aynı veriyle ADR-09(a) resolutions değişmez (regresyon).
- Fixture 10 bağlantı (3 onaylı, 4 varsayılan — biri 48 saatte aynı konuyla geri gelmiş, 3 devir — biri zorunlu RG): onaylı %30, varsayılan %30, yanlış çözüm 1/7, devir %30, zorunlu devir uyumu %100.
- Son 72 saatteki varsayılanlar "kesinleşmemiş".
- QA'nın bulduğu zorunlu devir ihlali uyumu %100'ün altına düşürür, ID olay listesinde.
- v12 ve v13 yan yana.
- BSAT'a yalnız AI'ın tek başına yürüttüğü bağlantılar girer.
- Ekip Lideri yalnız kendi ekibini görür.
- AI'ın "çözüldü" dediği ile oyuncunun onayladığı ayrı gösterilir (K9).

KULLANILAN VARSAYIMLAR:
- K9, K10.
- AI-25-S1/S2/S3 varsayılanları; S3'teki "kullanıcı adı + marka" eşleşmesi yerine K4 üye tokenı (member_key).

**Test Strategy:**

Her tanım fixture ile birim; kesinleştirme işi; rollup = ham veri; RLS; ADR-09 regresyonu; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 320.1. MET-OUTCOMES [OPUS-XHIGH] ai_conversation_outcomes + ratings.subject + yazma noktaları + widget "Çözüldü mü?" butonları

**Status:** pending  
**Dependencies:** None  

Üst görev 320 ayrıntılarındaki ilgili bölüm.

### 320.2. MET-FINALIZE-ROLLUP [OPUS-XHIGH] Kesinleştirme (72 saat tekrar temas) + rollup + tanımlar (types) + rapor uçları + MCP

**Status:** pending  
**Dependencies:** 320.1  

Üst görev 320 ayrıntılarındaki ilgili bölüm.

### 320.3. MET-WEB [OPUS-HIGH] Raporlar › AI Agent paneli + AiPerformance kartları + ipuçları

**Status:** pending  
**Dependencies:** 320.2  

Üst görev 320 ayrıntılarındaki ilgili bölüm.
