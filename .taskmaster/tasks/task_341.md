# Task ID: 341

**Title:** WIDGET-AVAILABILITY [OPUS-HIGH] (Opus 5.5) Uygunluk ayarı "her zaman" / "yalnız ajan varken": can_start_chat ve answered_by, AI aktifken insan yokken de sohbet açılır, agents_only'de yerleşik alanlı çevrimdışı form

**Status:** pending

**Dependencies:** 307 ⏱

**Priority:** medium

**Description:** Bugün widget insan çevrimiçi değilse ve form alanı tanımlıysa çevrimdışı formu açıyor; AI aktif olsa bile oyuncu sohbet başlatamıyor. Örtük davranış açık bir ayara dönüşür. Kaynak: WG-09.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: WG-09. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: customer.ts:549 agentsOnline, :609 online, :560-575 responder; widget.ts:1011-1019 offlineFormOpen.
types/prisma: WidgetSettings.availability_mode TEXT DEFAULT 'always' CHECK always|agents_only.
api: GET /customer/chat yanıtına can_start_chat + answered_by human|ai|none; AI aktif ve kotası varsa (ai-daily-budget, #339 üye kotası) can_start_chat=true; kota doluysa AI yok sayılır.
KARAR TABLOSU: AI aktif → her zaman sohbet; insan yoksa devir anı AI-12 mesai dışı davranışına (#307) düşer. AI yok + always → sohbet açılır, atanmamış bekler (gerekirse WG-08 e-posta ister #342). AI yok + agents_only → çevrimdışı form yerleşik alanlarla (ad + e-posta + mesaj), özel alan şartı kalkar → ticket.
widget: offlineFormOpen can_start_chat'e göre. web: ayar + "ne olur" açıklamaları (GV-06 kalıbı).
"Çevrimiçi" sayımı WG-03 (#340) bağlantı kopma düzeltmesinden sonra güvenilir (bağımlılık değil, not).
Davranış değişikliği: pilot kiracıda geçiş öncesi mevcut çevrimdışı form kullanımı kontrol edilir; sürüm notu.

KABUL KRİTERLERİ:
- AI aktif, insan yok, çevrimdışı formu tanımlı → oyuncu AI ile sohbet başlatır.
- AI yok + agents_only + insan yok → form yerleşik alanlarla açılır.
- AI yok + always → sohbet açılır ve atanmamış görünür.

KULLANILAN VARSAYIMLAR:
- Varsayılan always (bugünkü insan-yokken-sohbet davranışına en yakın).

**Test Strategy:**

widget.offline.test.ts, e2e offline-form.spec.ts, entegrasyon (can_start_chat matrisi); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
