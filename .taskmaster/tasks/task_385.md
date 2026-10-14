# Task ID: 385

**Title:** NARROW-SCREEN-PANEL [SONNET-XHIGH] Panelin dar ekranlarda kullanılabilirliği: kırılım noktaları (≥1280 / 1024–1279 / 768–1023 / <768), Inbox telefon akışı, rota bazlı uyarı bandı, 375 ve 768 Playwright projeleri + axe

**Status:** pending

**Dependencies:** 304 ⏱, 334 ⏱

**Priority:** medium

**Description:** NarrowScreenNotice 1024 altında "masaüstü için tasarlandı" diyor; Ekip Lideri telefondan sohbet açıp devralamıyor. Kaynak: GV-04.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: GV-04. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

XHIGH GEREKÇESİ: (3) teslim güvencesi — büyük durumlu Inbox bileşenlerinde düzen regresyonu riski.
KOD: NarrowScreenNotice.tsx:23 (1024), :26 (localStorage), :49-61; AppShell.tsx; InboxPage.tsx, DetailsPanel.tsx, ThreadHeader.tsx (narrow); e2e narrow-screen.spec.ts; tokens.css; apps/mobile.
web: ≥1280 üç bölme; 1024–1279 üç bölme, detay varsayılan kapalı; 768–1023 iki bölme (liste + transkript), detay ve Copilot alttan sayfa; <768 tek bölme yığın + geri; composer altta sabit, dokunma hedefi ≥44 px; iOS visualViewport (klavyede composer görünür); sanal liste dokunmatik kaydırma; uyarı bandı rota bazlı (NavDestination/rota responsive: true).
Öncelik akışı: telefonda sohbet aç → oku → yanıtla/devral → devir kartını gör (AI-10 #304); zaman çizelgesi (#334); onay/QA kuyrukları (AI-20 #316, AI-24 #319) hazırsa. Ayar ekranları ilk aşamada tek sütun.
testler: Playwright 375×812 ve 768×1024 projeleri; mevcut inbox e2e'leri dar görünümde de; axe; kanıt ekran görüntüleri apps/e2e/kanit/.
Mobil uygulamanın Türkçeleştirilmesi KAPSAM DIŞI.

KABUL KRİTERLERİ:
- 375 px'te EL sohbeti açar, yanıt yazar, devralır; yatay kaydırma yok.
- 768 px'te Inbox iki bölmeli; detay açılır/kapanır.
- Uyarlanmış ekranlarda uyarı bandı yok, uyarlanmamışlarda var.
- Hedef ekranlarda axe kritik hata yok.

KULLANILAN VARSAYIMLAR:
- GV-04'te açık soru yok.

**Test Strategy:**

Playwright dar projeler, axe, mevcut inbox e2e'leri dar görünümde; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
