# Task ID: 349

**Title:** INSTALL-WIZARD-NOSCRIPT [SONNET-HIGH] Kurulum: sihirbazda kod + kopyala + canlı "bağlandı" göstergesi, rehber bağlantıları; snippet'e <noscript> yedek linki

**Status:** pending

**Dependencies:** None

**Priority:** low

**Description:** Onboarding sihirbazı yalnız alan adı soruyor, kodu göstermiyor; snippet JS kapalı tarayıcıda hiçbir şey sunmuyor. İki madde aynı snippet/sihirbaz yüzeyine dokunduğu için birleştirildi. Kaynak: WG-13, WG-15.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: WG-13, WG-15. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: OnboardingWizard.tsx; WebsiteWidgets.tsx:298-306 (kod + kopyala), :352-366; website-service.ts:26-31 WEBSITE_SETUPS, :184-200 snippet(); markWebsiteConnected; apps/widget/chat.html.
WG-13: sihirbazın web sitesi adımında addWebsite yanıtındaki snippet WebsiteWidgets kopyalama bileşeniyle (tek kaynak: website-service.snippet); websites.status yoklamasıyla "bekleniyor / bağlandı"; "Geliştiriciye gönder"; GTM ve iGaming platform paneli rehberleri (KB içeriği). WordPress eklentisi ERTELENDİ (ayrı paket, kapsam dışı).
WG-15: snippet() sonuna <noscript><a href="{widgetOrigin}/chat.html?organization_id={id}">Bizimle sohbet edin</a></noscript> — metin widget diline göre sabit listeden (WG-02 #280 varsa; yoksa tr/en), kullanıcı girdisi yok; mevcut kurulumlar değişmez; rehber URL'si env → GET /deployment; sihirbaz + WebsiteWidgets'ta "Kurulum rehberi" bağlantısı. Barındırılan sohbet sayfasının güvenilir alan adı istisnası korunur.

KABUL KRİTERLERİ:
- Sihirbazda snippet görünür ve kopyalanır; widget ilk yüklendiğinde "bağlandı".
- Yeni snippet <noscript> içerir ve barındırılan sayfayı doğru kiracıyla açar.
- Rehber bağlantısı iki ekranda da görünür.

KULLANILAN VARSAYIMLAR:
- P2 → low.
- WordPress eklentisi kapsam dışı.

**Test Strategy:**

website-service birim (snippet + kaçışlar), e2e onboarding.spec.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
