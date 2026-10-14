# Task ID: 321

**Title:** AI-TOOL-SLOT-F1 [OPUS-HIGH] (Opus 5.5) Araç (entegrasyon) yuvası — F1 pasif kısım: igaming-tools kataloğu, call_tool adım tipi (çalıştırılmaz), pending_checks, devir kartında "Kontrol edilmesi gereken", simülasyonda sahte araç çıktısı

**Status:** pending

**Dependencies:** 296 ⏱, 304 ⏱, 314 ⏱

**Priority:** low

**Description:** Entegrasyon geldiğinde 20 prosedürü baştan yazmamak için yuva bugünden; "kaç sohbet otomatik kontrol edilemediği için devredildi?" verisi F2 önceliklendirmesini sağlar. ADR-14a (#269): araç adımı Skill/prosedür adımıdır. ADR §6: model araç çağırmaz. Kaynak: AI-28.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-28. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3c — AI yönetişimi ve ölçüm.

TİPLER packages/types/src/igaming-tools.ts: ToolDefinition {key, title_tr, description, input_schema, output_schema, kind read|write, requires_verified_identity, timeout_ms, phase 'f2', input_schema_version}; IGAMING_TOOL_CATALOG: deposit_lookup, withdrawal_status, kyc_status, bonus_status, bet_lookup, account_status, limit_status (hepsi okuma).
ADIM: steps.ts (SKILL_STEP_TYPES :9-16, validateSteps :189) + procedure.ts'e call_tool {tool, inputs {x: 'slot:…'}, on_unavailable continue|handoff, on_error handoff, branches?}; doğrulama girdilerin var olan slotlara bağlı olmasını ister; step-contract-parity korunur.
MOTOR (F1): çalıştırılmaz; karar izine tool_not_connected; durum pending_checks [{tool, inputs}]; on_unavailable'a göre devam; AI "kontrol ettim" demez (G8).
DEVİR KARTI (AI-28-S1): "Kontrol edilmesi gereken: yatırım sorgusu — kullanıcı adı ali123 (beyan), 2.500 TRY, 13:42".
SİMÜLASYON: senaryo tool_outputs (ör. deposit_lookup {status:'credited'}) ile F2 dalları bugünden test edilir.
RAPOR: AI-25 dökümüne pending_checks sayımı ("en çok hangi kontrol eksik").
WEB: prosedür editöründe "Sistem kontrolü" kartı (araç, girdi eşleme, araç yokken ne olacağı; "Faz 2'de etkinleşir" rozeti); Ayarlar'da katalog listesi (bağlı değil).
F2 GÜVENLİK İLKELERİ (şimdiden yazılır, #322'de uygulanır): aracı prosedür motoru deterministik çağırır (S2); girdiler doğrulanmış slotlardan; requires_verified_identity'de oyuncu kimliği slot'tan değil doğrulanmış oturumdan; çıktı veri, talimat değil; yazma araçları kapalı.
tool_connections tablosu F1'de OLUŞTURULMAZ.

KABUL KRİTERLERİ:
- call_tool adımlı prosedür kaydedilir; olmayan slota bağlı girdi reddedilir.
- F1'de bu adıma gelen konuşmada dışarıya istek yok; kartta "Kontrol edilmesi gereken" satırı.
- Simülasyonda deposit_lookup credited → "hesaba geçmiş" dalı; aynı senaryo canlıda devirle biter.
- Raporda "otomatik kontrol edilemediği için devredilen" sayısı araç bazında.

KULLANILAN VARSAYIMLAR:
- AI-28-S1: kartta görünür; S2: F2'de prosedür motoru çağırır.
- Öncelik P2 → low.

**Test Strategy:**

Adım doğrulaması, F1'de çalıştırılmama, kartta görünme, simülasyonda dallanma; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
