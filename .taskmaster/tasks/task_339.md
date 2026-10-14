# Task ID: 339

**Title:** WIDGET-ABUSE-GUARD [OPUS-XHIGH] (Opus 5.5) Widget kötüye kullanım koruması: üye başına günlük AI turu, yalnız riskte doğrulama (Turnstile/mock), kota %80 bildirimi, kota dolunca insana devir

**Status:** pending

**Dependencies:** 283 ⏱, 287 ⏱

**Priority:** high

**Description:** Bugün yalnız IP/token hız sınırı ve workspace/platform günlük AI tavanı var; tek bir script tüm workspace AI kotasını tüketebilir, CAPTCHA yok (pilot-public-readiness K-e(5)). Dört katmanlı koruma kurulur. Kaynak: GV-01.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: GV-01. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

XHIGH GEREKÇESİ: (1) güvenlik yüzeyi (bot/kötüye kullanım), (2) AI maliyeti (para doğruluğu).
KOD: plugins/rate-limit.ts (müşteri 60/dk, anonim IP 30/dk; Redis yoksa açık), services/ai/ai-daily-budget.ts + plugins/ai-budget.ts (ai_budget_* SECURITY DEFINER), security/spam-filter.ts (customer.ts:687+), auth.ts:1697-1709 (her yeni ziyaretçiye müşteri satırı), config/env.ts productionProblems.
env: CAPTCHA_PROVIDER mock|turnstile|none, TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY; PILOT_MODE'da turnstile + anahtar zorunluluğu productionProblems'a. GERÇEK ANAHTAR YOK — geliştirme/test mock sağlayıcıyla (CLAUDE.md sınırı).
prisma: ai_customer_daily_usage (license_id, customer_id, day, ai_turns, llm_tokens) PK + RLS; security_settings.ai_turns_per_customer_day INT DEFAULT 40, captcha_mode TEXT DEFAULT 'risk' (off|risk|always_on_chat_start); customers.challenge_passed_at.
contract: customer-chat.yaml + auth.yaml challenge_required (details.reason, site_key), isteğe bağlı challenge_token; settings.yaml yeni ayarlar.
api: risk değerlendirmesi token basımında ve sohbet açılışında (aynı IP'den 10 dk'da çok yeni müşteri, dakikada çok mesaj, AI turu/insan oranı; sayaçlar Redis, Redis yoksa yalnız "doğrulama iste" devre dışı, kota Postgres'te kalır); services/security/captcha.ts (Turnstile + sahte); AI yolunda reserve'den önce üye başına tek ifadeli artır-ve-kontrol et; kota dolunca insan yolu + iç not + ai_decision_logs decision=cap_reached (#288); %80'de Kurucu/Yöneticilere günde bir bildirim.
widget: yalnız challenge_required gelince Turnstile tembel yüklenir; iframe CSP/sandbox challenges.cloudflare.com izni; 8 dil (K25).
web: settings-sections (scope access_rules), kota göstergesi (Home + AI performans).
KURALLAR: doğrulamayı geçen üye 12 saat sorulmaz; geçerli üye tokenlı (K4/#287) üye hiç sorulmaz; sağlayıcıya ulaşılamazsa sohbet açılır ama AI cevap vermez; CGNAT nedeniyle IP eşikleri cömert; erişilebilir doğrulama kutusu.

KABUL KRİTERLERİ:
- Normal ziyaretçi hiç doğrulama görmez.
- Aynı IP'den eşik üstü yeni ziyaretçi açan script doğrulamasız token/sohbet açamaz.
- 41. AI turunda AI susar, sohbet insana gider, ajan notu görünür.
- %80 bildirimi günde bir kez.
- Testte gerçek sağlayıcıya ağ çağrısı yok.

KULLANILAN VARSAYIMLAR:
- Varsayılan tavan 40 tur/üye/gün; captcha_mode risk.
- Turnstile KVKK aydınlatma metni hukuk kontrolü (07 açık risk).

**Test Strategy:**

Birim (risk eşikleri), entegrasyon (41. tur, sahte sağlayıcıyla geçerli/geçersiz doğrulama, %80 günde bir), e2e widget doğrulama akışı; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 339.1. ABUSE-QUOTA [OPUS-XHIGH] Üye başına günlük AI turu + cap_reached + %80 bildirimi + ayarlar

**Status:** pending  
**Dependencies:** None  

Üst görev 339 ayrıntılarındaki ilgili bölüm.

### 339.2. ABUSE-CAPTCHA [OPUS-XHIGH] Risk değerlendirmesi + captcha.ts (mock/Turnstile) + challenge_required kontratı + env/productionProblems

**Status:** pending  
**Dependencies:** 339.1  

Üst görev 339 ayrıntılarındaki ilgili bölüm.

### 339.3. ABUSE-WIDGET-WEB [SONNET-HIGH] Widget tembel doğrulama kutusu (8 dil) + panel ayar/kota göstergesi

**Status:** pending  
**Dependencies:** 339.2  

Üst görev 339 ayrıntılarındaki ilgili bölüm.
