# Task ID: 365

**Title:** SHORTCUTS-PALETTE-SETTINGS [SONNET-HIGH] (Sonnet 5.5) Klavye kısayolları kaydı + "?" penceresi + Alt+↑/↓ sohbet geçişi (Türkçe Q / AltGr güvenli) ve komut paletinden ayar/rapor alt sayfalarına gitme (Türkçe katlama)

**Status:** pending

**Dependencies:** 277 ⏱

**Priority:** medium

**Description:** Tek genel dinleyici yalnız Ctrl+K; kısayol listesi yok; palet ayar alt sayfalarını bulmuyor ve "İki adımlı" araması Türkçe büyük harf nedeniyle başarısız. İki madde aynı palet/klavye katmanına dokunduğu için birleştirildi. Kaynak: IN-08, IN-11.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: IN-08, IN-11. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: CommandPalette.tsx:151-163 (Ctrl+K), :238-312, :307 confirmLeave; Modal.tsx:131, Dropdown.tsx:81/:129; Composer.tsx:445-493; actions.ts; navigation.ts:66-163; settings-sections.ts:108-407 (İngilizce keywords), :418-426 visibleSections, :454-470 searchSections (toLowerCase); report-views.ts.
IN-08 (web): lib/shortcuts.ts tek kayıt (id, kombinasyon, kapsam global|inbox|composer, açıklama anahtarı, işleyici; çakışma tespiti); components/ShortcutsModal.tsx (gruplu, aranabilir, OS'a göre ⌘/⌥); AppShell tek keydown, Ctrl+K kayda taşınır; Inbox: Alt+↑/↓ (görünen liste, sonda durur, odak composer'a), etiket ekleme, dosya yükleme, Copilot (IN-09 #366 kısayolu).
KURALLAR: modal açıkken genel kısayollar susar; metin alanında yalnız composer kapsamı, tek harf asla; "?" kontrolü event.key === '?' (TR klavyede Shift+*); getModifierState('AltGraph') true ise hiçbir kısayol (AltGr+Q "@"); Ctrl+Alt+harf AltGr üreten tuşlardan seçilmez; geri dönüşü zor eylemler onaylı ya da yalnız palette. IN-01 (#277) güvenlik düzeltmesi önkoşul.
IN-11 (web): palete searchSections sonuçları (≤6) + rapor görünümleri, yetkiye göre; settings-sections.ts Türkçe katlama (toLocaleLowerCase('tr-TR') + NFD + \p{M} silme; ı/i, ş/s eşdeğer) + Türkçe anahtar kelimeler ("kısayol", "yanıt", "iki adımlı", "mesai", "şifre"); sıra etiket başı > etiket içi > anahtar kelime; seçimde confirmLeave. Katlama yardımcısı IN-06 (#363) ile ortak tek fonksiyon (lib/text-fold.ts).
Contract/API değişikliği yok.

KABUL KRİTERLERİ:
- "?" (TR ve US) kısayol penceresini açar, Esc kapatır.
- Alt+↓ sonraki sohbeti açar, odak composer'da.
- AltGr+Q ile "@" yazılır, kısayol tetiklenmez.
- Modal açıkken Alt+↓ çalışmaz.
- Aynı kombinasyon iki eyleme bağlanamaz.
- Ctrl+K "hazır" → "Hazır yanıtlar" ayarı; EÜ yetkisiz güvenlik bölümlerini görmez; "iki" ve "sifre" doğru bölümleri bulur; kirli formda onay.

KULLANILAN VARSAYIMLAR:
- IN-08/IN-11'de açık soru yok.

**Test Strategy:**

shortcuts.test.ts, ShortcutsModal.test.tsx, CommandPalette.test.tsx, e2e keyboard-shortcuts.spec.ts + command-palette.spec.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 365.1. KB-SHORTCUTS [SONNET-HIGH] shortcuts.ts kaydı + ShortcutsModal + Alt+↑/↓ + AltGr güvenliği

**Status:** pending  
**Dependencies:** None  

Üst görev 365 ayrıntılarındaki ilgili bölüm.

### 365.2. PALETTE-SETTINGS [SONNET-HIGH] Palette ayar/rapor alt sayfaları + Türkçe katlama (ortak text-fold)

**Status:** pending  
**Dependencies:** 365.1  

Üst görev 365 ayrıntılarındaki ilgili bölüm.
