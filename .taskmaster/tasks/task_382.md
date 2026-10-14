# Task ID: 382

**Title:** BILLING-PAYMENT-METHODS [OPUS-XHIGH] Ödeme yöntemleri (K16 + ADR-13a): swift_manual, crypto_manual ("Adres isteyin" talep kuyruğu, TXID ile elle onay), stripe (MOCK/sandbox adaptör, webhook) + durum makinesi ve dunning

**Status:** pending

**Dependencies:** 276 ⏱

**Priority:** medium

**Description:** payment-provider yalnız registerPaymentMethod (mock); tahsilat/iade/webhook yok. K16: SWIFT + kripto + Stripe; Stripe'a bağımlı olmadan çalışmalı. ADR-13 (Stripe MOCK) ADR-13a ekiyle (#276) genişletildi. Kaynak: BL-01.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: BL-01. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

XHIGH GEREKÇESİ: (2) para doğruluğu (tahsilat, idempotency, durum makinesi).
SINIR: gerçek anahtar, canlı ödeme, gerçek cüzdan adresi YOK (CLAUDE.md, MASTER-PROMPT). Stripe adaptörü sandbox/taklit; canlıya alma insan kararı.
KOD: billing/payment-provider.ts (PAYMENT_PROVIDERS + mock), env.ts:973 STRIPE_PROVIDER=mock; payment-method-service.ts, subscription-service.ts (trialing/active/canceled), invoice-service.ts, invoice-close-*.ts (jobs.ts:268), license-activation.ts (elle aktivasyon), plugins/license-gate.ts; reports.ts:2115-2436 /billing/*; BillingPage.tsx.
arayüz: sağlayıcı-bağımsız PaymentProvider genişlemesi (createCustomer, barındırılan ödeme/kurulum oturumu — kart verisi bize değmez, PCI SAQ A; chargeInvoice; refund; webhook payment_succeeded/failed, itiraz). Sağlayıcı kayıtları swift_manual, crypto_manual, stripe; görünürlük platform yöneticisi ayarı.
prisma: payment_transactions (license_id, invoice_id, provider, provider_ref, amount_minor, currency, status, failure_code, provider_event_id benzersiz) + RLS; subscriptions.provider_customer_id, provider_subscription_id, past_due_since; crypto_payment_requests (license_id, network ör. USDT TRC20/ERC20, amount_minor, currency, invoice/fatura bilgisi, state requested|address_sent|paid|cancelled, txid, handled_by) + RLS.
SWIFT: banka bilgileri + ödeme referans kodu gösterimi (değerler platform ayarından; repoda gerçek IBAN YOK); platform personeli "ödendi" işaretler → mevcut license-activation.
KRİPTO: "Adres isteyin" formu (ağ, tutar, fatura bilgisi) → Billing yönetim kuyruğu; cüzdan adresi otomatik gösterilmez, ekip verir; TXID ile elle onay.
DURUM MAKİNESİ: trialing → active → past_due → (ek süre) read_only → canceled; her geçiş audit; tutarlar minor birimde, para birimi tek kaynak (05 karar 3); webhook provider_event_id ile tekil; billing_dunning işi (1/3/7. gün yeniden deneme, sonra salt-okuma) yalnız otomatik tahsilatlı sağlayıcıda.
Billing yetkisi RL-02 ile Kurucu (#325 matrisi).
web: ödeme yöntemi seçimi (üç sekme), SWIFT bilgisi + referans, kripto talep formu + durum, Stripe barındırılan sayfaya yönlendirme (taklit), "ödeme başarısız" bandı, ödeme geçmişi; platform yönetiminde kripto/SWIFT kuyruğu.

KABUL KRİTERLERİ:
- Taklit/sandbox Stripe ile ödeme → abonelik active, fatura "ödendi".
- Başarısız ödemede bant, dunning planı, ek süre sonunda salt-okuma.
- Aynı webhook olayı iki kez → tek işlem kaydı.
- SWIFT elle "ödendi" işareti aynı sonucu üretir.
- Kripto talebi kuyruğa düşer; adres otomatik gösterilmez; TXID ile onaylanınca abonelik aktif.
- Stripe kapalıyken SWIFT ve kripto çalışır.

KULLANILAN VARSAYIMLAR:
- K16 ödeme yöntemleri; ADR-13a (#276).
- Stripe'ın iGaming reddi riski (07 açık risk).

**Test Strategy:**

Sağlayıcı taklidi + webhook imza, idempotency, durum makinesi geçişleri, kripto kuyruğu entegrasyonu; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 382.1. PAY-CORE [OPUS-XHIGH] PaymentProvider genişlemesi + payment_transactions + durum makinesi + audit

**Status:** pending  
**Dependencies:** None  

Üst görev 382 ayrıntılarındaki ilgili bölüm.

### 382.2. PAY-MANUAL [OPUS-HIGH] swift_manual (referans, elle onay) + crypto_manual ("Adres isteyin" kuyruğu, TXID onayı)

**Status:** pending  
**Dependencies:** 382.1  

Üst görev 382 ayrıntılarındaki ilgili bölüm.

### 382.3. PAY-STRIPE [OPUS-XHIGH] Stripe adaptörü (sandbox/taklit) + webhook imza + dunning işi

**Status:** pending  
**Dependencies:** 382.1  

Gerçek anahtar yok.

### 382.4. PAY-WEB [SONNET-HIGH] Billing ödeme ekranı (üç yöntem) + bant + geçmiş + platform yönetim kuyruğu

**Status:** pending  
**Dependencies:** 382.2, 382.3  

Üst görev 382 ayrıntılarındaki ilgili bölüm.
