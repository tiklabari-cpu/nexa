# Task ID: 279

**Title:** WIDGET-PRECHAT-CONFIG [OPUS-HIGH] (Opus 5.5) Widget pre-chat formu: aç/kapa ve yerleşik alanların (ad, kullanıcı adı, e-posta, mesaj) göster/zorunlu ayarı

**Status:** pending

**Dependencies:** 278 ⏱

**Priority:** high

**Description:** Form bugün her zaman açık ve dört alan zorunlu (widget.ts:1123-1160, sahip kararı 2026-10-14). Bazı operatörler kullanıcı adını hemen ister, bazıları formsuz yazılmasını ister. Karar şirket ayarına çevrilir; varsayılan bugünkü davranış. Kaynak: WG-01.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: WG-01. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 1 — hızlı güvenlik/temel düzeltmeler.

KOD: widget.ts needsPrechat :1123-1125 ayara bakmıyor; submitPrechat :1127-1160; form elemanları :2631-2655 required; customer.ts:707-727 yazım; mint auth.ts:1594 pre_chat_form; WidgetSettings schema.prisma:2151-2176; ChatFormsSettings.tsx.
SIRA: types `PrechatConfig` (enabled, fields{name|username|email|message:{visible,required}}) + DEFAULT_PRECHAT_CONFIG (bugünkü) + normalizePrechatConfig → contract settings.yaml (GET/PUT /settings/prechat ya da /settings/widget eki) + customer-chat.yaml (token yanıtına prechat) → migration WidgetSettings.prechat_enabled DEFAULT true, prechat_fields JSONB DEFAULT <bugünkü> + CHECK → API settings/mint/customer.ts ilk mesajda sunucu zorunluluğu → widget → web kartı (kirli form koruması, canlı önizleme) → testler.
MANTIK: required ⇒ visible; form kapalıysa özel pre_chat alanları da sorulmaz (panel uyarır); mesaj gizliyse ilk composer mesajı açılış mesajı; kullanıcı adı kapatılırken "Üye tanıma ve gün içi hafıza bu alan olmadan zayıflar" uyarısı (WG-01-S2); sunucu zorunluluğu yalnız yeni sohbet açan ilk mesajda, eksikse 400 ve iz bırakmadan ret; marka mint'te Origin→websites.brand_id ile çözülür (bulunamazsa lisans varsayılanı; WG-02/05/10 ortak).

KABUL KRİTERLERİ:
- Ayar kaydedilmemiş kiracıda 4 zorunlu alan (regresyon).
- prechat_enabled=false → widget doğrudan composer açar.
- username.required=false → boş gönderilebilir; true → widget ve API (400) reddeder.
- Değişiklik bir sonraki token alımında geçerli.
- Çok markalı kiracıda B sitesindeki widget B'nin ayarını alır.

KULLANILAN VARSAYIMLAR:
- WG-01-S1 varsayılan bugünkü davranış.
- WG-01-S2 kullanıcı adı kapatılabilir + uyarı.
- WG-01-S3 imzalı kullanıcı adı: K4 sonrası F2 (#388).

**Test Strategy:**

widget.prechat.test.ts, customer-chat.test.ts, settings.test.ts, e2e widget.spec.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
