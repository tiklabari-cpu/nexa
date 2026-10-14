# Task ID: 285

**Title:** DAY-BOUNDARY [SONNET-HIGH] (Sonnet 5.5) Gün sınırı ve saat dilimi: workspace ayarı (varsayılan Europe/Istanbul 00:00), tek localDayKey fonksiyonu

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** Sunucu UTC; Organization.timezone varsayılanı UTC ve yalnız transkript e-postasında kullanılıyor. Ayar yapılmazsa 00:00–03:00 arası yazan oyuncu yanlış güne bağlanır (iGaming'in yoğun saatleri). K3: kiracı saat dilimi, varsayılan Europe/Istanbul 00:00, süren konuşma bölünmez. Kaynak: ID-04.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: ID-04. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 2 — kimlik çekirdeği ve altyapı.

KOD: schema.prisma:55 Organization.timezone; chat-service.ts:1209-1219; InboxSettings schema:2127-2141; settings.ts:2640-2655 / :3396-3401; ChatTimeout.tsx; UTC kullananlar ai-daily-budget.ts, report-csv.ts.
YAPILACAK: contract settings.yaml chat-timeout şemasına day_boundary_timezone (IANA), day_boundary_hour (0-23); migration inbox_settings.day_boundary_tz TEXT NOT NULL DEFAULT 'Europe/Istanbul', day_boundary_hour SMALLINT NOT NULL DEFAULT 0 + CHECK; types/conversation-day.ts `localDayKey(at, tz, boundaryHour)` + DEFAULT_DAY_BOUNDARY (kolon varsayılanıyla birebir); API doğrulama (Intl.DateTimeFormat ile tz, saat 0-23); web ChatTimeout.tsx "Sohbet süresi ve gün sınırı": aranabilir saat dilimi + saat seçici + canlı örnek.
KURALLAR: gün anahtarı yalnız localDayKey ile (SQL'de ayrı hesap yok); ayar değişikliği yalnız sonraki bağlantıları etkiler (ADR'ye uç durum notu); satır yoksa kod varsayılanı; raporlar şimdilik UTC + ekranda "Saatler UTC" notu; AI kotası UTC'de kalır, panelde yerel saatle gösterilir (ID-04-S3). Okuma InboxSettings findFirst ile — zaman aşımıyla aynı yerden (fiilen workspace düzeyi).
Öncelik notu: P1, ama P0 ID-02 buna bağlı → high.

KABUL KRİTERLERİ:
- Ayar satırı olmayan workspace'te gün sınırı Europe/Istanbul 00:00.
- "Mars/Olympus" → 400; saat 24 → 400.
- Sınır 06:00 iken 05:59 önceki güne, 06:00 bugüne.
- Ayar değişikliği mevcut chats.local_day değerlerini değiştirmez; audit kaydı yazılır.

KULLANILAN VARSAYIMLAR:
- K3.
- ID-04-S1: 00:00, 0-23 seçilebilir.
- ID-04-S2: workspace düzeyi tek ayar.
- ID-04-S3: AI kotası UTC.

**Test Strategy:**

localDayKey birim (İstanbul, America/New_York DST geçişleri, sınır 6, artık gün); ayar ucu entegrasyon; e2e settings.spec.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
