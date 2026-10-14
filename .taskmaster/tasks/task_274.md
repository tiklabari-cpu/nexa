# Task ID: 274

**Title:** ADR-SINGLE-KB [OPUS-HIGH] Q6 kararının değişmesi: AI Agent ve Copilot bilgileri tek depo + "kim kullanır" bayrağı (K11)

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** Eski karar Q6 "AI Agent ↔ Copilot bilgi tabanları ayrı" (docs/archive/handoff/HANDOFF-arsiv-2026-10-14.md:2293/2393). K11: tek depo, her kaynakta audiences. Kilitli karar değişikliği kayda geçmeli. Kaynak: AI-14.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-14. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 0 — ADR ek notları (kilitli kararlarla çelişen işler için önce yazılır).

NE YAZILACAK:
- docs/adr/single-knowledge-store.md: bağlam (Q6 geçmişi; arşivde satır 2293 "AÇIK — ürün kararı", 2393/3416/4461 "ayrı"), karar K11, sonuçlar.
- Anlam: AI Agent yalnız `audiences @> {ai_agent}` kaynakları; Copilot `ai_agent ∪ copilot`; "yalnız ajanlar için" = `{copilot}` (LiveChat "For internal use only" ile aynı). Yayınlanan Genel KB makaleleri varsayılan olarak AI Agent + Copilot'a açık, makale başına kapatılabilir (AI-14-S2). Son gözden geçirme zorunlu, varsayılan 90 gün (AI-14-S3).
- Eski uçlar (`/copilot/knowledge`) filtreli görünüm olarak kalır; daraltma sonraki sürümde.
- PLAN §D'ye sapma satırı.
Kod yok.

KABUL KRİTERLERİ:
- ADR dosyası ve PLAN §D satırı var.
- AI-14 (#309) bu göreve bağlı.

KULLANILAN VARSAYIMLAR:
- AI-14-S2 ve S3 varsayılanları kullanıldı.

**Test Strategy:**

Yalnız doküman: `pnpm -w format:check`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
