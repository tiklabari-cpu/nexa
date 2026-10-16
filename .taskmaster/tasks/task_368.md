# Task ID: 368

**Title:** REPORT-FILTERS [OPUS-HIGH] (Opus 5.5) Rapor filtreleri (ajan, ekip, etiket, konu) tek filterClause yardımcısıyla tüm uçlarda + Ekip Lideri kapsam kesişimi sunucuda + derin linkler + filtreli paylaşım/zamanlanmış rapor

**Status:** pending

**Dependencies:** 325 ⏱

**Priority:** medium

**Description:** Raporlar yalnız tarih alıyor; ekip/ajan bazında bakılamıyor; Ekip Lideri için kapsam yok. Kaynak: RP-01.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: RP-01. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

EFOR: high — karar önceden verilmiş, kalıp depoda var; xhigh gerekçesi yeterli değil (2026-10-14 gözden geçirme).
KOD: reports.ts:200-211 rangeQuery, :1592/:1603/:1707 (ilk 20 ajan)/:1804/:1892; report-csv.ts (JSON, CSV, zamanlanmış aynı yardımcılar); reports_read yalnız ADMIN_SCOPES; ReportsPage.tsx, report-views.ts.
contract/types: ReportFilter {agent_id[], group_id[], tag[], topic[], channel?} tüm rapor uçlarına; yalnız ID (GV-05).
api: rangeQuery → reportQuery; report-csv.ts tek filterClause (assignee_id, chat_access.group_id, thread_tags, AI konusu = AI-05 prosedür kimliği, etiketle birleştirilmez — 05 karar 2); export, paylaşım linki, zamanlanmış rapor filters JSONB saklar; paylaşım linki filtreyi dondurur.
YETKİ: reports_read--groups benzeri ekip kapsamlı yetenek (RL-02 matrisi #325); sunucu istenen ekip filtresini kişinin (liderlik) ekipleriyle KESİŞTİRİR, istemciye güvenmez; boş kesişim → boş sonuç.
migration: threads(license_id, assignee_id, created_at) CONCURRENTLY ayrı dosya; sorgular readDb.
web: çoklu seçimli filtre çubuğu, URL'de filtreler (yalnız ID), kayıtlı görünümler filtreyi saklar, ekip/üye sayfalarında "Raporları gör" derin linki.
"Tüm uçlar filtreyi uyguluyor" testi zorunlu (atlanan sorgu riski).

KABUL KRİTERLERİ:
- /app/reports?group_id=5&agent_id=<uuid> filtreli açılır, sayılar tutarlı.
- EL başka ekibin group_id'siyle kapsam dışını göremez.
- Aynı filtreyle CSV ekranla birebir.
- URL'de e-posta yok.

KULLANILAN VARSAYIMLAR:
- 05 RP-01 tanımları (ajan = son atanan, ekip = erişim grupları, etiket any-of).

**Test Strategy:**

Her filtre entegrasyon, EL kesişim testi, JSON=CSV testi, "tüm uçlar" testi; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 368.1. RF-API [OPUS-HIGH] Rapor filtreleri API: tek filterClause tüm uçlarda + dışa aktarma/paylaşım/zamanlı + ekip kapsamı kesişimi

**Status:** pending  
**Dependencies:** None  

ReportFilter contract tüm rapor uçlarına; rangeQuery → reportQuery, report-csv.ts tek filterClause; export, paylaşım linki ve zamanlanmış rapor filters JSONB; YETKİ kesişimi sunucuda; migration (CONCURRENTLY ayrı dosya); "tüm uçlar filtreyi uyguluyor" testi zorunlu. Ayrıntı ve kabul maddeleri: üst görev #368 details (tek kaynak).

### 368.2. RF-WEB [SONNET-HIGH] Rapor filtre çubuğu: çoklu seçim, URL'de yalnız ID, kayıtlı görünümler, derin linkler

**Status:** pending  
**Dependencies:** 368.1  

Çoklu seçimli filtre çubuğu, URL'de yalnız kimlik, kayıtlı görünümler filtreyi saklar, ekip/üye sayfalarında "Raporları gör"; Ekip Liderinde kilitli ekip seçici. Uçlar ve sözleşme önceki alt görevde bitti: `packages/contract` + üretilen tipler tek kaynak; sunucu davranışını kod haritasıyla bul (`trace_path`, `search_graph`), düzenleyeceğin dosyayı Read ile oku. Ayrıntı ve kabul maddeleri: üst görev #368 details (tek kaynak).
