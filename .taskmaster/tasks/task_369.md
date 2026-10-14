# Task ID: 369

**Title:** MISSED-ENGAGEMENT-REPORTS [OPUS-HIGH] Kaçan sohbetler ve etkileşim (kim başlattı) raporları: threads.initiated_by, needs_human_since, missed_reason kapanışta bir kez yazılır; ısı haritası şirket saat diliminde

**Status:** pending

**Dependencies:** 293 ⏱

**Priority:** medium

**Description:** "Kaçan" ve "kim başlattı" kavramları yok; AI ile başlayıp kapanan sohbet kaçan sayılmamalı, AI devri sonrası yanıtsız kalan ayrı sayılmalı. Kaynak: RP-02.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: RP-02. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: first_response_at (chat-service.ts:508-512; AI/bot saymaz); #closeConversation ≈:956-990; ai-responder.ts:189-192 ai_handoff; campaign-engagement.ts:66.
prisma: threads.initiated_by TEXT NULL (customer|agent|campaign|ai|channel) + CHECK, needs_human_since TIMESTAMPTZ NULL (kuyruğa giriş, atama ya da AI devri), missed_reason TEXT NULL (queue_abandoned|unanswered_assigned|unanswered_after_ai).
api: oturum oluşturmada initiated_by; #closeConversation'da missed_reason (kaçan = needs_human_since NOT NULL AND first_response_at NULL — 05 karar 1; neden: atanmadan kapandı → queue_abandoned, atanmış yanıtsız → unanswered_assigned, son devir AI'dan → unanswered_after_ai); değer kapanışta bir kez, raporlar okur; report-csv.ts (sayım, saat×gün ısı haritası kiracı TZ — ID-04, ekip/ajan kırılımı, RP-01 filtreleri #368 hazırsa) + GET /reports/missed, /reports/engagement + export.
AI-11 (#293) "önce AI" ile needs_human_since = devir anı; AI-25 devir kalitesi metrikleri aynı alanlar. Kısmi geri doldurma migration'ı + rapor notu ("kesin değil").
web: iki sekme, ısı haritası bileşeni (staffing ile ortak). Kanal adaptörü doldurmazsa "bilinmiyor".

KABUL KRİTERLERİ:
- AI ile başlayıp AI ile kapanan sohbet kaçan sayılmaz.
- AI'ın devrettiği ve insanın yanıtlamadığı sohbet "devir sonrası kaçan".
- Isı haritası şirket saat diliminde.
- Kampanyadan başlayan sohbetler etkileşim raporunda ayrı satır.

KULLANILAN VARSAYIMLAR:
- 05 RP-02 karar 1: kaçan tanımı.

**Test Strategy:**

Kapanış senaryoları entegrasyonu, rapor toplamları; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
