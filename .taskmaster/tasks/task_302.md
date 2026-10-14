# Task ID: 302

**Title:** AI-RISK-FLAGS [OPUS-XHIGH] Risk bayrakları: sohbet ve üye kapsamlı yapılandırılmış bayraklar, riskPolicy (promosyon/bonus engeli, zorunlu devir), görünürlük, gerekçeli kaldırma, webhook

**Status:** pending

**Dependencies:** 287 ⏱, 301 ⏱

**Priority:** high

**Description:** En büyük uyum riski kendini oyundan men etmek isteyene bonus teklif etmek (UKGC SR 3.4.3, CGA). Bugün yalnız serbest etiketler var (Tag/ThreadTag), Customer'da risk alanı yok, kampanyalar riske bakmıyor. Kaynak: AI-27.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-27. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3a — AI çekirdeği (çok turlu motor, devir, uyum).

XHIGH GEREKÇESİ: (1) güvenlik yüzeyi — yeni yetkili uçlar, rol kısıtlı hassas veri.
PRİSMA: risk_flags (id, license_id, scope chat|member, chat_id?, thread_id?, customer_id?, member_key?, type rg_signal|self_exclusion_request|underage_suspected|self_harm|complaint_formal|fraud_suspected|account_takeover_suspected|multi_account|abusive|account_security, severity info|high|urgent, source ai_rule|ai_classifier|agent|qa, rule_ref, evidence_event_ids, note, basis declared|verified, status active|cleared, raised_by/at, cleared_by/at, clear_reason); satır silinmez; RLS lisans; indeksler (license_id, status, type), (license_id, customer_id) WHERE status='active'. EN-01'in customer_risk_flags ihtiyacı bu tablonun member kapsamıyla karşılanır (tek tablo).
TİPLER: RISK_FLAG_TYPES, varsayılan şiddet/kapsam/kaldırma yetkisi; saf riskPolicy(flags) → {noPromotions, noBonusTalk, mustHandoff, priority, targetTeamKey} (web, API, widget yapılandırması ortak).
API: services/risk/risk-flags.ts; POST /chats/{id}/risk-flags, DELETE /risk-flags/{id} (gerekçe zorunlu), GET /customers/{id}/risk-flags, GET /risk-flags (rapor/arşiv filtresi). AI motoru bayrağı devirle aynı transaction'da koyar.
KAPSAM (AI-27-S1): her zaman sohbete; rg_signal, self_exclusion_request, underage_suspected ayrıca üyeye, süresiz; basis F1'de declared (S3: "beyana dayalı" uyarısı).
KALDIRMA (S2): gerekçe zorunlu; rg/self_exclusion/underage için Yönetici+ (diğerleri Ekip Lideri+; RL-01 gelene kadar admin+); audit risk_flag.cleared; self_exclusion bayrağını kaldırmak operatörün kararını değiştirmez (ekranda açıklanır).
POLİTİKA UYGULAMASI: her AI turunda sohbet+üye bayrakları → noBonusTalk (prompt kuralı, bonus prosedürleri insana, çıkış denetimi), noPromotions (EN-01 #350), mustHandoff (AI yanıt üretmez); AI-11 return-to-ai 409 burada etkinleşir.
GÖRÜNÜRLÜK: Ekip Üyesi tür görür; not/kanıt yalnız Sorumlu Oyun ekibi, EL+.
RTM risk_flag_raised/cleared; webhook risk_flag.raised/cleared (S4; INTEGRATION_TRIGGERS ile eşit; payload'da metin YOK); urgent bayraklarda EL, Sorumlu Oyun ekibi ve seçilen e-postaya bildirim.
WEB: ThreadHeader çipleri, DetailsPanel "Risk" bölümü, bayrak ekle/kaldır, Ayarlar › Risk bayrakları, rapor kartı. Opsiyonel: canned_responses.is_promotional uyarısı (IN-07 ile).

KABUL KRİTERLERİ:
- "Hesabımı kapatmak istiyorum, oynamayı bırakacağım" aynı transaction'da self_exclusion_request (urgent) + Sorumlu Oyun devri; AI bonus/alternatif önermez.
- Bayraklı oyuncunun sonraki ziyaretinde kampanya gösterilmez (EN-01 ile).
- Ekip Lideri rg_signal kaldıramaz; Yönetici gerekçeyle kaldırır; audit.
- Arşivde risk filtresi doğru sohbetleri getirir (AR-02 ile).
- Webhook payload'ında mesaj metni yok.
- Ekip Üyesi bayrak notunu göremez (API).
- Bayraklı sohbette return-to-ai 409.

KULLANILAN VARSAYIMLAR:
- AI-27-S1..S4 varsayılanları.
- KVKK özel nitelikli veri saklama süresi hukuki karar (07 açık risk).

**Test Strategy:**

riskPolicy birim; kaldırma yetkisi/gerekçe; görünürlük; webhook payload; RLS; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 302.1. RF-SCHEMA-POLICY [OPUS-XHIGH] risk_flags tablosu + RISK_FLAG_TYPES + riskPolicy saf fonksiyonu

**Status:** pending  
**Dependencies:** None  

Üst görev 302 ayrıntılarındaki ilgili bölüm.

### 302.2. RF-API-RUNTIME [OPUS-XHIGH] Uçlar, AI motorunda devirle aynı transaction, kaldırma yetkisi, RTM, webhook, bildirim

**Status:** pending  
**Dependencies:** 302.1  

Üst görev 302 ayrıntılarındaki ilgili bölüm.

### 302.3. RF-WEB [SONNET-HIGH] ThreadHeader/DetailsPanel risk UI + Ayarlar › Risk bayrakları

**Status:** pending  
**Dependencies:** 302.2  

Üst görev 302 ayrıntılarındaki ilgili bölüm.
