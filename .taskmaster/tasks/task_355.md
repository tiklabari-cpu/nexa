# Task ID: 355

**Title:** GOAL-CUSTOM-EVENT [SONNET-HIGH] (Sonnet 5.5) Hedeflerde özel sayfa olayı: siyahtus('trackEvent', {name, value?}) → visitor_events → goals.record (tutar alanı yok, ziyaretçi bazında tekil)

**Status:** pending

**Dependencies:** 352 ⏱

**Priority:** low

**Description:** Hedefler yalnız URL, satış, lead, çözülen sohbet; "kayıt tamamlandı", "ilk yatırım sayfası" gibi olaylar ölçülemiyor. Kaynak: EN-06.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: EN-06. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: domain.ts:518-527 GoalDefinition; goal-matching.ts:66-120, goal-triggers.ts:70; trackSale yolu loader.ts:115 → widget.ts:1996 → POST /customer/chat/sale (customer.ts:1154).
types/contract: GoalDefinition.custom_event? {name, value_equals?}; goals.yaml, customer-chat.yaml POST /customer/events.
prisma: visitor_events (license_id, customer_id, name, value, occurred_at) + RLS + (license_id, customer_id, name) indeksi (ya da ziyaret JSON'u — kodlayan seçer, gerekçe HANDOFF'a).
api: ad ^[a-z0-9_]{1,40}$, değer ≤100, oran sınırı; goals.record; tutar alanı şemada YOK (05 karar 1), gönderilse de saklanmaz; doğrulanmamış veri — faturalama/yetki kararında kullanılmaz; hedef başına ziyaretçi bazında tekil sayım.
widget: trackEvent (trackSale güvenli daraltma deseni widget.ts:3175); hatalı ad sessizce yok sayılır. web: GoalBuilder gelişmiş bölüm.

KABUL KRİTERLERİ:
- trackEvent registration_completed sonrası hedef dönüşümü artar.
- Hatalı ad sayfayı kırmaz.
- Tutar gönderilse de saklanmaz.
- Aynı olayın tekrarı dönüşümü şişirmez.

KULLANILAN VARSAYIMLAR:
- 05 EN-06 karar 1: tutar yok.
- P2 → low.

**Test Strategy:**

goal-matching birim, entegrasyon, e2e goals.spec.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
