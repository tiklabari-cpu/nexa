# Task ID: 271

**Title:** ADR-ROUTING-QUEUES [OPUS-HIGH] (Opus 5.5) ADR-08a ek notu: ekip başına kuyruk, öncelik sırası, "önce AI"da devir anında yönlendirme (K18)

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** ADR-08 yönlendirme sırasını sabitliyor. AU-01 kuyruğu ekip başına böler (baş-tıkanması: routing-service.ts:215 `if (!assignee) break;`), AI-12 acil önceliği getirir, AI-11 "önce AI" (K9) modunda yönlendirmeyi sohbet açılışından devir anına taşır. Ajan seçme sırası DEĞİŞMEZ. Sahip kararı K18 onayladı. Kaynak: AI-11, AI-12, AU-01.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-11, AI-12, AU-01. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 0 — ADR ek notları (kilitli kararlarla çelişen işler için önce yazılır).

NE YAZILACAK (PLAN.md §0 altına "ADR-08a" eki + docs/adr/routing-team-queues.md):
- Kuyruk = ekip (`threads.queue_group_id`); sıra numarası, yeniden numaralandırma ve boşaltma ekip başına. Ekip içinde sıra `priority DESC, queued_at ASC`. "İlk eksikte dur" yalnız o ekip içinde.
- Öncelik: urgent (G3 kendine zarar, G5 reşit olmayan, G1 self-exclusion), high (aynı gün tekrar, öfke), normal.
- "Önce AI" (K9): AI etkinken thread atamasız ve kuyruk dışı açılır; yönlendirme devir anında AI-12 hedefiyle çağrılır. "Paralel" mod kiracı ayarı olarak kalır.
- Sorumlu Oyun (`topic_role='responsible_gambling'`) kuyruğunda yedek ekip zinciri YOK; uzmanlık şartı hem üyelikte hem seçimde (K14).
- Ajan seçme: havuz → priority katmanı → en az yüklü → last_assigned_at → fallback (ADR-08 aynen).
- Widget'taki "X. sıradasınız" artık ekip kuyruğuna göre (bilinçli davranış değişikliği).
Kod yok.

KABUL KRİTERLERİ:
- ADR-08a metni PLAN §0 altında ve docs/adr'de; ADR-08 satırı değişmedi.
- AU-01 (#305), AI-11 (#293), AI-12 (#307) bu göreve bağlı.

KULLANILAN VARSAYIMLAR:
- K14 (6 hazır kuyruk, Sorumlu Oyun silinemez) ADR metnine aynen alındı.

**Test Strategy:**

Yalnız doküman: `pnpm -w format:check`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
