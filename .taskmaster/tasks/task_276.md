# Task ID: 276

**Title:** ADR-PAYMENT-PROVIDERS [OPUS-HIGH] ADR-13a ek notu: ödeme yolları SWIFT (elle) + kripto "Adres isteyin" (elle, TXID) + Stripe adaptörü yalnız mock/sandbox (K16, K19)

**Status:** pending

**Dependencies:** None

**Priority:** medium

**Description:** ADR-13 "Stripe MOCK", MASTER-PROMPT/CLAUDE.md "gerçek kart/ödeme yok". K16 üç yol istiyor; K19: Stripe adaptörü kodlanır ama yalnız mock/sandbox ile test edilir, canlı anahtar ve canlıya alma insan kararıdır. Kaynak: BL-01, BL-02, BL-03.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: BL-01, BL-02, BL-03. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 0 — ADR ek notları (kilitli kararlarla çelişen işler için önce yazılır).

NE YAZILACAK (PLAN.md §0 altına "ADR-13a" + docs/adr/payment-providers.md):
- Sağlayıcı kayıtları: `swift_manual`, `crypto_manual`, `stripe`; hangilerinin görüneceğini platform yöneticisi açar/kapatır.
- SWIFT: banka bilgisi + ödeme referans kodu, elle onay sonrası abonelik aktif (bugünkü elle aktivasyon yolu sürer).
- Kripto: "Adres isteyin" talep formu (ağ: USDT TRC20/ERC20, tutar, fatura bilgisi); cüzdan adresi otomatik gösterilmez, SiyahTuş ekibi verir; TXID ile elle onay; talepler Billing yönetiminde kuyruk.
- Stripe: `payment-provider` arayüzüne adaptör; anahtarlar env'den; webhook imza doğrulaması; otonom döngü ve CI yalnız mock/sandbox kullanır; canlı anahtar asla commit'lenmez ve canlıya alma insan kararıdır. Stripe iGaming tedarikçisini reddedebilir → SWIFT/kripto Stripe'a bağımlı değildir.
- Fiyat ADR-13 (9900 cent, 200 AI çözümü) değişmez.
Kod yok.

KABUL KRİTERLERİ:
- ADR-13a yazılı; ADR-13 satırı değişmedi; CLAUDE.md sınırı açıkça tekrar edildi.
- BL-01/02/03 (#382–#384) bu göreve bağlı.

KULLANILAN VARSAYIMLAR:
- BL-01-S3 para birimi USD (bugünkü $99).

**Test Strategy:**

Yalnız doküman: `pnpm -w format:check`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
