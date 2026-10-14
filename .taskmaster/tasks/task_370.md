# Task ID: 370

**Title:** AVAILABILITY-ACTIVITY-REPORTS [OPUS-HIGH] (Opus 5.5) Uygunluk ve ajan aktivitesi raporları: presence source (manual|disconnect|unresponsive|suspension|login), durum başına süre, ajan × saat şeridi, vardiya bindirmesi; EÜ yalnız kendini görür

**Status:** pending

**Dependencies:** 340 ⏱

**Priority:** medium

**Description:** Presence olayları kaydediliyor ama yalnız staffing tahmininde kullanılıyor; bağlantı kopması kaydedilmediği için "çevrimiçi" süre abartılı. Kaynak: RP-03.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: RP-03. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

EFOR: high — dört xhigh gerekçesinden (güvenlik yüzeyi / para doğruluğu / teslim güvencesi / pencere içi karar) hiçbiri yok; karar önceden verilmiş (2026-10-14 gözden geçirme).
KOD: AgentPresenceEvent schema:2840-2855; agents.ts:383, membership-service.ts:89; reports.ts:1295-1310 presenceEvents (açılış satırı), presence-coverage.ts, roster-coverage.ts; :1765.
prisma: agent_presence_events.source TEXT DEFAULT 'manual' + CHECK.
api: GET /reports/availability, GET /reports/agent-activity?date=&agent_id[]; presenceCoverage tekrar kullanılır; RP-01 filtre/kapsam (#368 hazırsa); gün sınırı kiracı TZ (ID-04); açılış satırı deseni; bellek üst sınırı + sayfalama. WG-03 (#340) disconnect → offline (source disconnect) önkoşul — ikisi aynı sürümde ya da rapor uyarısı.
YETKİ: EÜ yalnız kendini (05 karar 2), EL kendi ekibi, Yönetici/Kurucu hepsi (RL-02).
web: sekmeler, şerit (renk + desen, renk körü dostu), plan bindirmesi; Ekip › üye profili "Bugünkü aktivite".

KABUL KRİTERLERİ:
- 09 kabul / 12 kabul etmiyor / 13 kabul / 18 çevrimdışı ajanda 8 saat kabul, 1 saat kabul etmiyor.
- Tarayıcıyı kapatan ajanın şeridinde tolerans sonrası "bağlantı yok".
- EÜ başka ajanın şeridini isteyemez (403).

KULLANILAN VARSAYIMLAR:
- 05 RP-03 karar 2: EÜ yalnız kendini.

**Test Strategy:**

Aralık birim (gece yarısı, açılış satırı), kapsam entegrasyonu; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
