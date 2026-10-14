# Task ID: 300

**Title:** SENSITIVE-MASKING [OPUS-XHIGH] Sohbet içi hassas veri maskeleme: şifre, OTP, kart, CVV, IBAN (son 4), seed phrase, özel anahtar, internet bankacılığı — yazmadan, loglamadan ve modele göndermeden önce + oyuncuya uyarı

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** Panikteki oyuncu "param yatmadı" derken her şeyi yazabilir; bu veriler DB, log, yedek ve yurt dışındaki LLM'de kalırsa KVKK ihlali ve hesap ele geçirme riski. Bugün yalnız Luhn kart maskelemesi var (cc-mask.ts). K12: maskeleme modelden önce çalışır. G11'in teknik karşılığı. Kaynak: AI-26.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-26. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3a — AI çekirdeği (çok turlu motor, devir, uyum).

XHIGH GEREKÇESİ: (1) güvenlik yüzeyi — güvenilmeyen girdiyi ayrıştırma.
ÇAĞRI NOKTALARI (2026-10-14 + doğrulama): customer.ts:255, :668, :906, :1021, :1124; chats.ts:197, :376; channel-service.ts:478; email-inbound.ts:122; log-redact.ts:164; ayrıca copilot-enhance.ts:100,137, copilot-summary.ts:129,245, mcp/tools/summarize-chat.ts:68 (analizde eksik listelenmişti).
YAPILACAK: lib/sensitive-mask.ts maskSensitive(text, {author customer|agent|bot, policy}) → {text, detections}; cc-mask geriye uyumlu sarmalayıcı; types SENSITIVE_TYPES + yazar politikası + uyarı metinleri (TR, EN, …); tüm çağrı noktaları + AI yanıtı gönderim öncesi + LLM prompt'u (savunma derinliği) + AI-22/23/24 kayıtları.
DEDEKTÖRLER: card Luhn; iban TR+24 rakam ve diğer ülkeler mod-97, maske son 4 (AI-26-S1); cvv 3-4 hane + 30 karakter yakınında cvv|cvc|güvenlik kodu; otp 4-8 hane + yakınında kod|sms|otp|doğrulama|onay kodu|şifre (S3; tek başına sayı ve 64 hex TXID maskelenmez); password şifrem|parolam|password|pw + token; seed 12/15/18/21/24 BIP-39 kelime (kodda liste, küme O(n)); private_key WIF ya da yakınında private key|özel anahtar olan 64 hex; banking_credential müşteri no|internet şubesi + sayı + şifre.
POLİTİKA (AI-26-S2): oyuncu mesajında hepsi; ajan/bot mesajında card, cvv, otp, password, seed, private_key; IBAN ajan/bot mesajında maskelenmez; AI kendisi IBAN vermez (AI-08).
SIRA: kalıcı yazım, RTM push, log, spam filtresi ve AI'dan önce ("bir kez, en başta maskele" ilkesi customer.ts:664-668).
UYARI: tespit varsa sohbet başına tür başına bir kez system olayı (recipients all, oyuncunun dili; properties.sensitive_types). password/otp → AI bağlamına sensitive_shared (AI-08 "kodu paylaşmayın"; AI-27 hesap güvenliği bayrağı önerebilir).
EKLER: F1'de görseller maskelenmez; ajana "dekontta kart/IBAN görünebilir" notu.
Web: Transcript rozeti "Hassas veri gizlendi (OTP)", Ayarlar › Güvenlik › Hassas veri bilgi sayfası (Kurucu). Widget: uyarı sistem mesajı; isteğe bağlı istemci ön uyarısı.
Regex'ler önceden derlenmiş ve geri izlemesiz.

KABUL KRİTERLERİ:
- "Şifrem Ali1234!" maskeli; "SMS kodu 482913" maskeli; "TR33 0006 1005 1978 6457 8413 26" → TR** … 13 26.
- "İşlem no PPR-20261014-482913", "2.500 TL", "05321234567" ve 64 hex TXID maskelenmez.
- 12 kelimelik BIP-39 maskelenir; sıradan Türkçe cümle maskelenmez.
- Maskesiz değer events.text, loglar, ai_* tabloları ve LLM istek gövdesinde yok (mock prompt kontrolü).
- Uyarı sohbet başına tür başına bir kez, oyuncunun dilinde.
- Ajanın paylaştığı IBAN oyuncuya tam görünür.

KULLANILAN VARSAYIMLAR:
- AI-26-S1/S2/S3 varsayılanları.
- K12: modele gitmeden maskeleme.

**Test Strategy:**

Türkçe pozitif/negatif örnek seti (cc-mask.test.ts yanında), her yazma yolu için entegrasyon (cc-masking.test.ts genişler), log redaksiyonu, prompt kontrolü; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
