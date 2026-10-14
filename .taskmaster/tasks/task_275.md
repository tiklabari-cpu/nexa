# Task ID: 275

**Title:** ADR-TEMPLATE-CATALOG [OPUS-HIGH] task_098 kararına ek: iGaming şablon kataloğu paylaşılan pakette, sunucuda kurulum ucu

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** .taskmaster/tasks/task_098.md:28 "şablon kavramı kontrata girmez, katalog apps/web içinde yereldir" diyor. AI-15 şablonların sunucudan kurulmasını (idempotent, kilitli şablonlar, kiracının doldurması gerekenler) gerektiriyor. Kaynak: AI-15.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-15. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 0 — ADR ek notları (kilitli kararlarla çelişen işler için önce yazılır).

NE YAZILACAK (docs/adr/ai-template-catalog.md + PLAN §D satırı):
- iGaming şablonları yeni paylaşılan pakette (`packages/ai-templates` ya da `packages/types/src/ai-templates/`), sürümlü.
- Kontrata girer: `GET /ai-templates`, `GET /ai-templates/{key}`, `POST /ai-templates/{key}/install`, `POST /ai-templates/packs/{pack}/install`.
- Mevcut 33 e-ticaret şablonu web'de yerel kalabilir (task_098 onlar için geçerli).
- Kurulum canlı referans değil kopya; kilitli şablonlar (self_exclusion, responsible_gambling_signal) kapatılamaz.
Kod yok. task_098 görev kaydı DEĞİŞTİRİLMEZ (mevcut görevlere dokunulmaz); ek not ayrı dosyada.

KABUL KRİTERLERİ:
- Karar dosyası var; task_098 kaydı değişmedi.
- AI-15 (#311) bu göreve bağlı.

KULLANILAN VARSAYIMLAR:
- Mevcut 33 şablon yerinde kalır.

**Test Strategy:**

Yalnız doküman: `pnpm -w format:check`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
