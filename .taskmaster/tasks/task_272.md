# Task ID: 272

**Title:** ADR-AI-RESOLUTION [OPUS-HIGH] ADR-09a ek notu: devredilmiş ama ajanın yazmadığı thread "AI çözümü" sayılmaz (K10)

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** ADR-09: kapanışta ajan olayı yoksa +1 AI çözümü (faturaya gider). AI'ın devrettiği ama ajan yazmadan kapanan sohbetler bugün AI çözümü sayılıp faturayı şişiriyor. K10: sayılmasın. Rapor = fatura kuralı (aynı yüklem) korunur. Kaynak: AI-11, AI-25, AR-02.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-11, AI-25, AR-02. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 0 — ADR ek notları (kilitli kararlarla çelişen işler için önce yazılır).

NE YAZILACAK (PLAN.md §0 altına "ADR-09a" + docs/adr/ai-resolution-handoff.md):
- Yeni yüklem: "kapanışta author_type='agent' olay YOK **VE** bu thread için `ai_handoffs` satırı (AI-10) / devir olayı YOK".
- Yüklem tek yardımcı fonksiyonda; faturalama sayacı (usage_records ai_resolutions), `ai_solved` görünümü (chat-service.ts:2389-2417), Reports "Automated", arşiv "AI çözdü" filtresi (AR-02, `threads.handled_by='ai'`) ve AI-25 "faturalanan AI çözümü" kutusu AYNI anda geçer.
- Geçmiş dönem faturaları yeniden hesaplanmaz; değişiklik yürürlük tarihinden itibaren.
- AI-25'in yeni metrikleri (onaylı/varsayılan/yanlış çözüm) faturaya girmez (AI-25-S1 varsayılanı).
Kod yok; uygulama #293 alt görevinde.

KABUL KRİTERLERİ:
- ADR-09a metni yürürlük kuralıyla birlikte yazılı.
- #293, #320, #336 bu göreve bağlı.

KULLANILAN VARSAYIMLAR:
- Geçmiş faturalar değişmez (yürürlük ileriye dönük).
- AI-25-S1: fatura ADR-09(a) tanımında kalır.

**Test Strategy:**

Yalnız doküman: `pnpm -w format:check`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
