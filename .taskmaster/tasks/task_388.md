# Task ID: 388

**Title:** OPERATOR-SIGNED-IDENTITY-F2 [OPUS-MAX] F2 — Operatörün imzaladığı oyuncu kimliği (identify / user_hash): giriş yapmış üye için operatör sunucusunda HMAC, widget'a iletim, sunucuda doğrulama, platform oyuncu ID eşlemesi

**Status:** deferred

**Dependencies:** 287 ⏱

**Priority:** low

**Description:** K4 F1'de widget'ın ürettiği üye tokenını (#287) seçti; 05 ID-03'ün anlattığı operatör imzalı kimlik F2'ye ertelendi. KN-06 araçları (#378) ve WG-01 imzalı kullanıcı adı buna bağlı. Kaynak: ID-03.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: ID-03. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

ETKİNLEŞTİRME KOŞULU: pilot operatörün sitesinde sunucu taraflı imzalama yapabilmesi + KN-06 F2 planı.
[MAX] kriptografi + kimlik doğrulama.
Kapsam (05 ID-03 operatör yolu): kiracı başına identity_secret (şifreli, rotasyonlu; panelde bir kez gösterilir); siyahtus('identify', {user_id, username?, email?, user_hash, ts}) — user_hash = HMAC-SHA256(secret, kanonik alanlar + ts), kısa geçerlilik (replay koruması); sunucu doğrular → customers'ta doğrulanmış platform kimliği (platform_user_id) + "doğrulanmış" rozeti; doğrulanmış kimlik eşleşmesi geçmişi otomatik bağlar (K4 a yolu); doğrulanmamış kullanıcı adı yine yalnız "olası eşleşme"; geçersiz imza sessizce yok sayılır + sayaç; kurulum rehberinde sunucu örnekleri (Node/PHP), gizli anahtarın tarayıcıya konmaması uyarısı.
WG-01-S3 imzalı kullanıcı adı, GV-01 "doğrulanmış üye sorulmaz", KN-06 kimlik kapısı bu görevle tamamlanır.

KABUL KRİTERLERİ:
- Geçerli imzalı identify ile oyuncu doğrulanmış olarak tanınır ve geçmişi bağlanır.
- Bozuk/eskimiş imza kimlik vermez.
- Gizli anahtar loglarda ve API yanıtlarında görünmez.
- Anahtar rotasyonunda eski anahtar geçiş süresince kabul edilir.

KULLANILAN VARSAYIMLAR:
- K4: F1 widget tokenı, operatör imzası F2.

**Test Strategy:**

HMAC birim (kanonikleştirme, replay), entegrasyon (bağlama, ret), güvenlik incelemesi; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
