# Task ID: 380

**Title:** WHATSAPP-LIVE [OPUS-XHIGH] Gerçek WhatsApp Cloud API kanalı (K22: pending): gömülü kayıt, uygulama düzeyi webhook (X-Hub-Signature-256), wamid tekilliği, 24 saat penceresi, medya, durumlar; testte taklit

**Status:** pending

**Dependencies:** 289 ⏱

**Priority:** medium

**Description:** WhatsApp adaptörü açıkça MOCK. K22 gereği görev pending (deferred değil); Meta'nın kumar/bahis politikası ticari engel olabilir — teknik iş sandbox/taklitle ilerler, canlı bağlama insan kararı. Kaynak: KN-01.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: KN-01. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

XHIGH GEREKÇESİ: (1) dış webhook imzası, şifreli kimlik bilgisi, kiracı çözümü.
KOD: channels/whatsapp.ts (MOCK), channel-adapter.ts (imza doğrulama kapsam dışı notu), registry.ts, channel-service.ts; canlı örnek telegram-live.ts (credential_ciphertext + channelCredentialAad, webhook_secret_hash, channels.ts:372, APPS_LIVE_PROVIDERS env.ts:337, safe-fetch); Channel brand_id; Channels.tsx mock diyaloğu.
api: whatsapp-live.ts (gömülü kayıt kodu → işletme belirteci + phone_number_id + WABA, webhook aboneliği, belirteç şifreli); uygulama düzeyi tek webhook (GET hub.verify_token/hub.challenge; POST X-Hub-Signature-256 HMAC); Cloud API payload (metin, medya, interaktif, durum); gönderim /{phone_number_id}/messages (safe-fetch); kiracı çözümü phone_number_id → kanal → lisans SECURITY DEFINER çözümleyici, sonra withTenant; HIZLI 200 + ağır iş kalıcı kuyruğa (GV-02 #289); wamid tekilliği; 24 saat penceresi (F1'de şablon yok — 05 karar 3; composer kilitlenir); medya /uploads (MIME/boyut), metin AI-26 maskeli; statuses → IN-05 (#362) uyumlu; E.164 → müşteri (ID-03 bağlama ayrı); Graph hata 190 → "yeniden bağlan" + bildirim. Şablon/promosyon mesajı gelirse EN-01 isPromoSuppressed (#350).
prisma: (channel_id, provider_message_id) benzersiz; oturum başına last_customer_message_at.
env: WHATSAPP_APP_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID, Graph sürümü — GERÇEK DEĞER YOK, testte taklit (CLAUDE.md). APP_SECRET dağıtım sırrıdır.
web: gerçek bağlama akışı, durum, composer "24 saat penceresi kapandı" bandı.

KABUL KRİTERLERİ:
- Test numarasından (taklit) gelen mesaj doğru kiracının Inbox'ında sohbet açar; ajan yanıtı gönderim taklidine ulaşır.
- Geçersiz imza 401, hiçbir şey yazılmaz.
- Aynı mesajın iki teslimi tek mesaj.
- 24 saati geçmiş sohbette serbest metin gönderilemez, uyarı görünür.
- Gelen görsel dosya paylaşım kurallarına uyar.

KULLANILAN VARSAYIMLAR:
- K22: pending; canlı bağlama ve Meta onayı insan kararı.
- 05 KN-01 karar 3: F1'de şablon yok.

**Test Strategy:**

İmza negatif testleri, Meta örnek payload fikstürleri, idempotency, pencere kuralı; dış servis taklit; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 380.1. WA-WEBHOOK [OPUS-XHIGH] Uygulama webhook ucu (doğrulama + HMAC) + SECURITY DEFINER kiracı çözümü + wamid tekilliği + hızlı 200/kuyruk

**Status:** pending  
**Dependencies:** None  

Üst görev 380 ayrıntılarındaki ilgili bölüm.

### 380.2. WA-ADAPTER [OPUS-HIGH] whatsapp-live adaptörü: gömülü kayıt, gönderim, medya, durumlar, 24 saat penceresi, hata 190

**Status:** pending  
**Dependencies:** 380.1  

Üst görev 380 ayrıntılarındaki ilgili bölüm.

### 380.3. WA-WEB [SONNET-HIGH] Bağlama akışı + kanal durumu + composer pencere bandı

**Status:** pending  
**Dependencies:** 380.2  

Üst görev 380 ayrıntılarındaki ilgili bölüm.
