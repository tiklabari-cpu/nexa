# Task ID: 311

**Title:** IGAMING-TEMPLATES [OPUS-HIGH] (Opus 5.5) 20 iGaming prosedür şablonu (Türkçe) + kurulum ucu + paket (igaming_core) + kiracının doldurması gerekenler + kilitli şablonlar

**Status:** pending

**Dependencies:** 275 ⏱, 296 ⏱, 299 ⏱, 301 ⏱, 307 ⏱, 310 ⏱

**Priority:** high

**Description:** Kiracının 20 prosedürü sıfırdan yazması haftalar sürer ve hataya açık (ör. self-exclusion isteyeni ikna etmeye çalışmak). Bugünkü 33 şablonun hiçbiri iGaming değil (templates.ts:88-692). Kaynak: AI-15.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-15. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3b — bilgi deposu ve bilgi kalitesi.

PAKET (#275): packages/ai-templates (ya da types/src/ai-templates/): IGAMING_TEMPLATES_TR — AI-03 biçiminde tam tanım + slotlar + kalıplar + devir (konu/neden anahtarlarıyla, grup id'siyle değil) + varsayılan davranış kuralları (AI-07: tek mesajda ≤2 soru, ödeme sorununda yöntem/tutar/saat öğrenmeden çözüm yok, mükerrer yatırım önerme, temsilciyle çelişme, "siz") + yasak ifadeler (AI-08) + test senaryoları (AI-19 tohumları) + locked + tenant_must_fill + version.
ANAHTARLAR (20): deposit_not_credited, withdrawal_pending, withdrawal_rejected, kyc_documents, bonus_claim, wagering_rules, bet_settlement_dispute, game_technical_issue, login_password, account_locked, self_exclusion (kilitli), responsible_gaming_signal (kilitli), limit_change, payment_methods_info, wrong_account_or_network, promotion_info, account_details_change, complaint_formal, site_access (K13: Erişim bilgisi ayarını kullanır), multi_account_third_party. G3/G5 prosedür değil AI-08 korumasıdır.
İÇERİK: araştırma §3 kataloğu + §3.1 yatırım tam örneği (slot tablosu, akış 1–8, kalıplar A–D, devir, yasak yanıtlar, kart, pasif deposit_lookup yuvası); "siz", "genellikle/politikamıza göre" çekinceleri, söz yok; yasal metinler verbatim.
KONTRAT: GET /ai-templates?industry=igaming&lang=tr, GET /ai-templates/{key}, POST /ai-templates/{key}/install {ai_agent_id, brand_ids?, route_mapping?}, POST /ai-templates/packs/igaming_core/install (20 şablon + kurallar + "örnek — doğrulayın" tablo satırları; ekipler yalnız create_groups:true ile); yanıt tenant_must_fill listesi.
KURULUM: kopya (canlı referans değil), taslak durumunda (AI-20 #316 gelince sürüm akışına girer); konu anahtarları handoff_routes'a eşlenir, eşlenmemişse kurulur ama yayın engellenir; aynı template_key → var olanı döner (force_copy hariç); çözülmemiş yer tutucu ({şikâyet_süresi}, {adr_kurumu}, {kriz_hattı}) varken yayın 400 template_unfilled; kilitli şablonu kapatma 409 template_locked (yalnız üslup düzenlenir); sürüm artınca kiracı kopyası kendiliğinden değişmez, rozet; galeri gezinme kayıt oluşturmaz.
DİL (AI-15-S3): Türkçe tam, İngilizce yalnız örnek cümleler.
WEB: TemplateGallery "iGaming" kategorisi (gaming_gambling kiracıda ilk sırada), ayrıntı/önizleme/Kur, ekip eşleme diyaloğu, "Kiracının doldurması gerekenler" paneli; OnboardingWizard'da sektör gaming_gambling seçilince "Önerilen kurulum".

KABUL KRİTERLERİ:
- 20 şablonun tamamı prosedür doğrulayıcısından geçer.
- deposit_not_credited kurulumu slotlar, adımlar, kalıplar ve eşlenmiş ekiple taslak oluşturur; ikinci kurulum kopya üretmez.
- Doldurulmamış yer tutucu varken yayın engellenir.
- Kilitli şablonlar kapatılamaz.
- gaming_gambling kiracıda galeri iGaming'i ilk sırada gösterir.
- Her şablonun en az 3 senaryosu mock ile geçer (AI-19 düzeneği gelince #314).

KULLANILAN VARSAYIMLAR:
- AI-15-S1: platform taslak hazırlar, "kiracı doğrulamalı" alanlar boş, kiracı yayından önce onaylar.
- AI-15-S2: kilitli şablonlar kapatılamaz.
- AI-15-S3 diller.
- site_access içeriği K13'e göre (05'teki "yalnız sabit güvenli metin" notu yerine).

**Test Strategy:**

Şablon doğrulayıcı testleri (templates.test.ts karşılığı), kurulum idempotentliği, kilit 409, e2e galeri; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 311.1. TPL-PACKAGE [OPUS-HIGH] Paket iskeleti + doğrulayıcı testleri + deposit_not_credited tam şablonu (§3.1)

**Status:** pending  
**Dependencies:** None  

Üst görev 311 ayrıntılarındaki ilgili bölüm.

### 311.2. TPL-CONTENT [OPUS-HIGH] Kalan 19 şablonun içeriği (TR) + senaryo tohumları + varsayılan kurallar + yasak ifadeler

**Status:** pending  
**Dependencies:** 311.1  

Mekanik ama geniş yüzey; self_exclusion ve responsible_gaming_signal metinleri uyum açısından gözden geçirilir.

### 311.3. TPL-INSTALL-API [OPUS-HIGH] Kurulum ve paket uçları (idempotent, rota eşleme, tenant_must_fill, kilit, template_unfilled)

**Status:** pending  
**Dependencies:** 311.1  

Üst görev 311 ayrıntılarındaki ilgili bölüm.

### 311.4. TPL-WEB-ONBOARD [SONNET-HIGH] TemplateGallery iGaming kategorisi + kurulum diyaloğu + onboarding önerisi

**Status:** pending  
**Dependencies:** 311.3  

Üst görev 311 ayrıntılarındaki ilgili bölüm.
