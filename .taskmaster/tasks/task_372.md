# Task ID: 372

**Title:** DIGEST-EMAILS [SONNET-HIGH] (Sonnet 5.5) Günlük/haftalık özet e-postaları: kişisel tercih, şirket saatiyle 08:00 (haftalık Pazartesi), rol kapsamlı sayılar rapor yardımcılarından, kişisel veri YOK, idempotent

**Status:** pending

**Dependencies:** 368 ⏱, 369 ⏱, 371 ⏱

**Priority:** medium

**Description:** Yöneticiler ve Ekip Liderleri günün özetini panele girmeden alamıyor; zamanlanmış rapor altyapısı var ama özet şablonu yok. Kaynak: RP-05.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: RP-05. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: scheduled-report-service/sweeper/period/mail.ts; jobs.ts:181; messages.ts:589 (özet şablonu yok); types/notifications.ts, routes/notifications.ts; agent_memberships.locale.
types/contract: bildirim tercihlerine digest_daily, digest_weekly (notifications.yaml).
prisma: digest_deliveries (license_id, agent_id, period_key benzersiz) + RLS.
api: sweep adımı (scheduled_reports ya da yeni digests işi, dakikada bir; "08:00 geçti ve bu dönem gönderilmedi" → bir kez); hesaplar kiracı başına bir kez, alıcılara rol kapsamıyla dağıtılır (EL → kendi ekipleri); sayılar report-csv.ts yardımcılarından (RP-01/02/04); yeni şablon digestMail (TR/EN, ajan locale).
İÇERİK (05 karar 1): toplamlar, önceki döneme değişim, kaçan, ilk yanıt, CSAT, AI çözüm/devir, risk bayraklı sohbet SAYISI, kuyruk p80. Oyuncu adı, kullanıcı adı, mesaj metni YOK; bağlantılar yalnız ID.
notifyEmail kapalıya gönderilmez; iç bildirim (dış kotaya girmez).
web: tercih anahtarları (InstantToggle), şirket varsayılanı ayarı.

KABUL KRİTERLERİ:
- Günlük özeti açık Yönetici 08:00 sonrası ilk sweep'te tek e-posta; sweep iki kez koşsa da ikinci yok.
- EL e-postası yalnız kendi ekibinin sayıları.
- Gövdede oyuncu kişisel verisi yok (otomatik test).

KULLANILAN VARSAYIMLAR:
- 05 RP-05 karar 1: alıcı ve içerik.

**Test Strategy:**

Dönem anahtarı/idempotency birim, kişisel veri yokluğu testi, kapsam testi; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
