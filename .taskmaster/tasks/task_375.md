# Task ID: 375

**Title:** WEBHOOK-DELIVERY-LOG [SONNET-HIGH] Webhook teslim günlüğü arayüzü: teslim listesi, "Tekrar gönder", imzalı test olayı, aç/kapat (PATCH), temizlenmiş hata metni

**Status:** pending

**Dependencies:** None

**Priority:** medium

**Description:** WebhookDelivery modeli var ama arayüz yok; operatörün geliştiricisi teslimin neden düştüğünü göremiyor; webhook kapatılamıyor (PATCH yok). Kaynak: KN-03.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: KN-03. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: WebhookDelivery schema:2048-2075; webhooks.ts:132/:148/:192/:143 (PATCH yok); webhook-dispatcher.ts; jobs.ts:220; WebhookSubscriptions.tsx.
contract/api: GET /webhooks/{id}/deliveries?state=&cursor= (yeniden eskiye), POST …/deliveries/{deliveryId}/redeliver (normal gönderici yolu: SSRF koruması, imza, nonce; yeni deneme satırı), POST /webhooks/{id}/test (imzalı ping, test:true, dakikada birkaç), PATCH /webhooks/{id} enabled.
SAKLAMA: terminal teslimde payload bugün siliniyor; exhausted satırlarda kısa süre (ör. 72 saat) tutma ya da event_id'den yeniden üretme — kodlayan seçer, gerekçe HANDOFF'a; "teslim edilmiş payload kalıcı kopya bırakmaz" ilkesi korunur; teslim satırları retention sweep'ine dahil.
Hata metni gösterilmeden önce temizlenir (sır/belirteç/uzun gövde yok, ≤500).
indeks: (license_id, webhook_id, created_at) (gerekirse CONCURRENTLY).
web: çekmece tablo (zaman, olay, deneme, durum, HTTP kodu, kısa hata), filtre, eylemler.

KABUL KRİTERLERİ:
- Başarısız teslim HTTP kodu ve hata özetiyle görünür.
- "Tekrar gönder" yeni deneme üretir ve sonucu tabloya düşer.
- "Test" imzalı ping gönderir.
- Kapatılan webhook olay almaz.
- Başka kiracının teslimi görünmez.

KULLANILAN VARSAYIMLAR:
- KN-03'te açık soru yok.

**Test Strategy:**

Entegrasyon (kiracılar arası, test imzası, yeniden gönderim satırı); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
