# Task ID: 323

**Title:** SETTINGS-SAVE-PATTERN [SONNET-MAX] Tutarlı kaydetme kalıbı + kaydedilmemiş değişiklik uyarısı: SettingsForm/SaveBar, SettingsNav confirmLeave, InstantToggle yalnız kişisel tercih, yüksek riskli ayarda gerekçeli onay

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** Bir ekranda kutu anında yetki açıyor (Tags.tsx:90-93), diğerinde Kaydet'e basmadan hiçbir şey olmuyor; ayar bölümleri arasında geçince taslak sessizce kayboluyor (useLeaveGuard yalnız SkillEditor:279'da; SettingsNav.tsx:181-229 NavLink'leri confirmLeave çağırmıyor). Yetki matrisi (RL-02) gelince bu karışıklık güvenlik açığına dönüşür — RL-02 bu göreve bağlı. Kaynak: GV-06, WG-14.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: GV-06, WG-14. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 4 — roller ve yetki matrisi.

KOD: lib/dirty-guard.tsx (shouldWarnOnLeave :87, useLeaveGuard :98, confirmLeave :129, useCloseGuard :46 — useCloseGuard 8 dosyada, confirmLeave AppShell/CommandPalette/PlaybookPage'de kullanılıyor; analizdeki "tek kullanıcı" ifadesi yalnız useLeaveGuard için doğru); lib/form.ts; SettingsNav.tsx:181/:218; Tags.tsx:90-93.
YAPILACAK (web): components/settings/SettingsForm.tsx + SaveBar.tsx (yapışkan çubuk, "Kaydedilmemiş değişiklikler", Kaydet/Vazgeç, temiz/hatalıyken Kaydet pasif, useLeaveGuard bağlı); SettingsNav bağlantılarında confirmLeave (reddedilirse preventDefault); InstantToggle (yalnız kişisel tercih, görsel olarak farklı, "Kaydedildi" + geri al, data-save-pattern="instant"); ConfirmHighRisk (fark + zorunlu gerekçe → audit metadata reason); Tags.tsx ekip kapsamı düzenleme penceresi + Kaydet'e taşınır; ayar bölümleri sırayla SettingsForm'a geçirilir. "Kirli" başlangıç değeriyle karşılaştırılır; kaydederken uyarı yok; kayıt sonrası başlangıç güncellenir; sekme kapanırken uyarı; hata durumunda form verisi korunur.
api: yüksek riskli uçlar (PUT /settings/permissions — RL-02, uyum kuralları — AI-08, saklama süresi) gövdede reason kabul eder ve audit'e yazar (GV-06-S1).
KALIP TESTİ: her ayar bölümünü çizip SaveBar ya da data-save-pattern="instant" arayan birim testi (yeni bölüm kalıba uymazsa kırılır). Yeni eklenen her ayar formu (WG-01/03/05/06/09…) bu korumayla gelir.
Öncelik notu: P1, ama P0 RL-02 buna bağlı → high.

KABUL KRİTERLERİ:
- Herhangi bir ayar bölümünde değişiklik yapıp başka bölüme geçerken onay penceresi; "Kal" değişikliği korur; değişiklik yokken pencere yok; sekme kapanırken uyarı.
- Etiket ekip kapsamı artık Kaydet'siz değişmez.
- Yüksek riskli ayarda Kaydet → fark → gerekçe → onay zorunlu; gerekçe audit'te.
- Kalıp testi SaveBar/anında kayıt işareti olmayan yeni bölümde kırılır.

KULLANILAN VARSAYIMLAR:
- GV-06-S1: gerekçe zorunlu yetki matrisi, AI uyum kuralları, veri saklama.
- SONNET-MAX: mekanik ama geniş yüzey (34 ayar bölümü).

**Test Strategy:**

SettingsNav.test.tsx, en az iki form birim testi, kalıp testi, e2e settings.spec.ts (anında kayıt varsayan testler güncellenir); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 323.1. SAVE-COMPONENTS [SONNET-HIGH] SettingsForm, SaveBar, InstantToggle, ConfirmHighRisk + SettingsNav confirmLeave + kalıp testi

**Status:** pending  
**Dependencies:** None  

Üst görev 323 ayrıntılarındaki ilgili bölüm.

### 323.2. SAVE-MIGRATE-SECTIONS [SONNET-MAX] Ayar bölümlerinin kalıba geçirilmesi + Tags.tsx + reason alanı

**Status:** pending  
**Dependencies:** 323.1  

Üst görev 323 ayrıntılarındaki ilgili bölüm.
