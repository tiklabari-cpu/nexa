# Task ID: 287

**Title:** MEMBER-TOKEN [OPUS-MAX] Üye tanıma (K4): widget'ın ürettiği imzalı üye tokenı (CHIPS çerez + localStorage yedeği), sunucu doğrulaması, iptal/rotasyon, başka cihazda ajan onaylı eşleştirme

**Status:** pending

**Dependencies:** 278 ⏱, 284 ⏱

**Priority:** high

**Description:** Bugün tarayıcıdaki düz customer_id anahtar gibi çalışıyor ve widget token ucu herkese açık: üyenin ID'sini bilen biri açık sohbetini okuyabilir (auth.ts:191-203, 1594-1760). K4: tokenı operatör değil SiyahTuş widget'ı üretir; geri gelişte imza, süre, license ve iptal listesi doğrulanır; müşteri ID tek başına kabul edilmez. Kullanıcı adı/e-posta otomatik eşleştirme yapmaz; başka cihazda yalnız ajan onayıyla bağlanır (AI hafızasına girmez). Kaynak: ID-03.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: ID-03. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 2 — kimlik çekirdeği ve altyapı.

[MAX] güvenlik sınırı (authN, kripto, tenant).
KOD: widget api.ts:184-237 connect (siyahtus.customer_id localStorage), :436-450; loader.ts:161 iframe allow-same-origin; auth.ts:188-210 customerTokenBody (host_origin beyan), :1594-1760 mint (müşteri yoksa oluşturur); services/auth/customer-token.ts (HMAC, CUSTOMER_TOKEN_SECRET, durumsuz TTL); credential-cipher.ts.
K4 MEKANİZMASI:
1) İlk ziyaret: sunucu imzalı üye tokenı üretir (HMAC-SHA256 ya da imzalı JWT): customer_id, license_id, cihaz/tarayıcı ID, iat, exp, ver.
2) Saklama: widget kendi alan adında önce partitioned (CHIPS) `Secure; HttpOnly; SameSite=None` çerez (API widget origin'inde set eder), yazılamazsa widget localStorage.
3) Geri geliş: token gönderilir; sunucu sırasıyla imza → süre → license eşleşmesi → iptal listesi. Geçerli → aynı müşteri (AI-02 ve ID-02 bu doğrulanmış kimlik üzerinden). Geçersiz/değiştirilmiş → yeni anonim kimlik + olay logu (yanıt farkı yaratma, kahin olmasın).
4) Kayan süreyle yeniden imzalama; ajan/Yönetici bir üyenin tokenlarını iptal edebilir; anahtar rotasyonu (önceki anahtar geçiş süresince kabul).
5) Bare customer_id artık kabul edilmez. Geçiş: tokenı olmayan mevcut widget'lar ilk girişte (localStorage'daki customer_id + yeni üretilen bağ anahtarı) token alır — 05 ID-03 madde 6'daki customer_key sertleştirmesi bunun geçiş yoludur; ADR'de yazılır.
6) Pre-chat kullanıcı adı/e-posta yalnız bilgi; "olası eşleşme" = aynı org'da username_normalized ya da e-posta eşit (en çok 10), ajan ekranında "doğrulanmamış". Ajan onaylı bağlama yalnız ajan geçmiş görünümünü birleştirir, AI hafızası ve gün çözümü müşteri numarasına bağlı kalır.
7) Panel: Ayarlar › Güvenlik › "Üye tanıma": token süresi, anahtar yenileme, "kullanıcı adına göre olası eşleşmeyi göster", toplu iptal.
KAPSAM DIŞI: operatörün imzaladığı kimlik (user_hash / identify) → F2 (#388, deferred).

KABUL KRİTERLERİ:
- Aynı tarayıcıdan aynı gün ikinci bağlantı aynı müşteriye ve aynı Thread ID'ye düşer.
- Yalnız customer_id ile (token yok/bozuk) istek o müşteriye bağlanmaz; yeni anonim kimlik açılır, olay loglanır; yanıt biçimi geçerli/geçersizde aynı.
- Farklı tarayıcıdan başka üyenin kullanıcı adını/e-postasını yazan ziyaretçi yeni müşteri olur; AI önceki üyenin bilgisini vermez; ajan ekranında "olası eşleşme (doğrulanmamış)".
- Ekip Üyesi "aynı kişi olarak bağla"yı kullanamaz; Ekip Lideri+ kullanır, audit customer.identity_linked, geri alınabilir.
- İptal edilen token reddedilir; rotasyon sonrası eski anahtar geçiş süresi bitince reddedilir.
- Kiracılar arası token/eşleşme negatif testi.

KULLANILAN VARSAYIMLAR:
- K4 (05'teki operatör user_hash yolunun yerine).
- K5: AI yalnız konu düzeyinde hatırlatır (AI-02).
- ID-03-S4: ajan onaylı eşleştirme Ekip Lideri ve üstü (RL-01 gelene kadar admin+).

**Test Strategy:**

Entegrasyon (token mint/verify/revoke/rotate, bare id reddi, eşleşme, bağlama), widget testleri (çerez/localStorage yedeği), e2e widget.spec.ts + customers.spec.ts; iOS Safari gerçek cihaz notu HANDOFF'a; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 287.1. MT-CONTRACT-SCHEMA [OPUS-MAX] Contract + migration: üye token anahtarları (şifreli, önceki anahtar + geçerlilik), iptal tablosu, identity settings, customer_identity_links (RLS)

**Status:** pending  
**Dependencies:** None  

paths/auth.yaml token gövde/yanıt, settings.yaml /settings/member-recognition, customers.yaml possible-matches + links.

### 287.2. MT-MINT-VERIFY [OPUS-MAX] Token üretimi/doğrulaması (imza → süre → license → iptal), bare customer_id kapatma + geçiş yolu, kayan yenileme, rotasyon

**Status:** pending  
**Dependencies:** 287.1  

Sabit zamanlı karşılaştırma; geçersizde aynı yanıt biçimi; warn log (license_id, reason).

### 287.3. MT-WIDGET-STORAGE [OPUS-XHIGH] Widget: partitioned CHIPS çerez, localStorage yedeği, gönderim; logout

**Status:** pending  
**Dependencies:** 287.2  

XHIGH GEREKÇESİ: (1) güvenlik yüzeyi — kimlik saklama. iOS/Safari kısıtları notu.

### 287.4. MT-MATCH-LINK [OPUS-XHIGH] Olası eşleşmeler + ajan onaylı bağla/çöz (audit), AI hafızası dışı

**Status:** pending  
**Dependencies:** 287.2  

XHIGH GEREKÇESİ: (1) yeni yetkili endpoint.

### 287.5. MT-SETTINGS-UI [SONNET-HIGH] Ayarlar › Güvenlik › Üye tanıma ekranı (süre, anahtar yenile, olası eşleşme anahtarı, toplu iptal)

**Status:** pending  
**Dependencies:** 287.2, 287.4  

settings-sections.ts kaydı (scope access_rules); GV-06 kalıbı gelince uyarlanır.
