# Task ID: 384

**Title:** SUBSCRIPTION-CANCEL [OPUS-HIGH] (Opus 5.5) Abonelik iptali: dönem sonunda iptal, geri alma, salt-okumaya geçiş, 30 gün dışa aktarma ve saklama ayarına göre silme planı; yalnız Kurucu

**Status:** pending

**Dependencies:** 382 ⏱, 383 ⏱

**Priority:** low

**Description:** canceled durumu var ama iptal akışı yok. Kaynak: BL-03.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: BL-03. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: subscription-service.ts; Subscription schema:2206-2223 (currentPeriodEnd); license-gate.ts; DataRetention.tsx; jobs.ts:268.
prisma: subscriptions.cancel_at_period_end BOOLEAN DEFAULT false, canceled_at, cancel_reason.
contract/api: POST /billing/subscription/cancel, POST /billing/subscription/resume (minimumRole owner); dönem kapatma işine dönem sonu iptal adımı; sağlayıcı tarafında iptal (BL-01 #382 — manuel sağlayıcılarda no-op); Kurucuya e-posta; audit; idempotent.
KURALLAR: iptal anında yalnız işaret; dönem sonunda canceled + salt-okuma (deneme bitişi mekanizması); dönem bitene kadar geri al; sonrası yeni satın alma; 30 gün sonra kiracının saklama ayarına göre silme (05 karar 1; lisans yükümlülüğüyle uzun saklama seçen kiracıda süre uzar; mevcut retention sweep); iade yok (05 karar 2; yıllık istisna elle).
web: iptal akışı (neden, sonuçlar, workspace adını yazarak onay), "İptali geri al", dışa aktarma bağlantısı.

KABUL KRİTERLERİ:
- Kurucu iptal eder; dönem sonuna kadar çalışır; sonra salt-okunur.
- Dönem bitmeden "geri al" iptali kaldırır.
- Yönetici iptal ucunu çağıramaz (403).
- 30 gün sonra silme planlanır, dışa aktarma bu sürede çalışır.

KULLANILAN VARSAYIMLAR:
- 05 BL-03 karar 1 (30 gün), karar 2 (iade yok).
- P2 → low.

**Test Strategy:**

Rol kontrolü, dönem sonu geçişi, geri alma, silme planlaması; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
