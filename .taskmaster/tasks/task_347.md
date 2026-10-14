# Task ID: 347

**Title:** LAUNCHER-VISIBILITY-LOGO [SONNET-HIGH] Launcher görünürlük modları (always / until_opened / never) + siyahtus('open') + siyahtus:unread olayı + marka logosu

**Status:** pending

**Dependencies:** None

**Priority:** medium

**Description:** Balon her zaman görünüyor; operatör kendi "Canlı destek" düğmesini kullanmak istediğinde balonu gizleyemiyor; marka logosu widget'ta kullanılmıyor. Kaynak: WG-10.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: WG-10. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: loader.ts:55-57 (open/close/destroy), :255 config.open, :115-122 siyahtus(command) (yalnız trackSale, widget.ts:1996); Brands.tsx:24 logo_url.
types: WidgetAppearance.launcher_visibility, show_logo; WidgetTokenAppearance.logo_url. prisma: WidgetSettings iki kolon + CHECK.
api: mint logoyu markanın kaydından okur (yalnız https ya da kendi /uploads).
loader/widget: until_opened'da balon gizli, siyahtus('open') / config.open() paneli açar ve balonu gösterir; never'da balon hiç yok; görünürlük mint'e bağlı (yeniden kurulum yok), balon iframe hazır olana kadar çizilmez (yanıp sönme yok); siyahtus:unread olayı ana sayfaya (yalnız sayı, izinli mesaj listesine); logo başlıkta (boyut sınırı, alt = marka adı, CSP uyumlu).
web: ayar alanları + önizleme + never riski açıkça yazılır; kurulum rehberine "kendi düğmeni bağla" (WG-13 #349).

KABUL KRİTERLERİ:
- until_opened'da yüklemede balon yok; siyahtus('open') paneli açar.
- never'da balon hiç görünmez.
- Logo tanımlı ve show_logo=true ise başlıkta.

KULLANILAN VARSAYIMLAR:
- WG-10'da açık soru yok.

**Test Strategy:**

loader.appearance.test.ts, widget.appearance.test.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
