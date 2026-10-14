# Task ID: 379

**Title:** CUSTOM-PANELS-F2 [OPUS-XHIGH] F2 — Uygulamaların ajan arayüzüne panel ekleyebilmesi (iframe SDK): custom_panels, kısa ömürlü imzalı bağlam tokenı, sandbox'lı iframe + postMessage köprüsü, frame-src yönetimi

**Status:** deferred

**Dependencies:** 325 ⏱, 287 ⏱

**Priority:** low

**Description:** Operatör back-office'ini Inbox sağ paneline gömmek istiyor. F2 olarak ertelendi (görev kapsamı kararı). Kaynak: KN-05.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: KN-05. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

ETKİNLEŞTİRME KOŞULU: F2 planlaması; CSP frame-src'in sunucu/proxy tarafında kiracı origin'lerine göre yönetimi için dağıtım kararı.
05 KN-05 özeti: custom_panels (license_id, name, url https CHECK, visible_group_ids, enabled, signing_secret_ciphertext) + RLS; panel CRUD (yönetici, audit); POST /chats/{id}/panels/{panelId}/context-token (≤5 dk, imzalı; org_id, chat_id, thread_id — K1=A: Thread ID/Chat ID, oyuncu kullanıcı adı (doğrulanmışsa işaretli), ajan ID, aud=panel); sandbox iframe (allow-scripts allow-forms allow-popups, farklı origin); postMessage köprüsü (origin kontrolü; ready → context, resize, insertText yalnız composer önerisi); gömülemeyenler için "yeni sekmede aç"; oyuncu bilgisi URL'ye yazılmaz (GV-05); F1'de panel sohbet geçmişi okuyamaz/mesaj gönderemez.

KABUL KRİTERLERİ:
- Panel ilgili ekipte görünür, diğerlerinde görünmez.
- ready sonrası doğru sohbetin imzalı bağlamı; token 5 dk sonra geçersiz.
- Başka origin'den postMessage işlenmez.
- Kullanıcı adı hiçbir URL'de yok.

KULLANILAN VARSAYIMLAR:
- F2 deferred (kullanıcı talimatı).

**Test Strategy:**

Köprü origin testi, token süresi, ekip görünürlüğü; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
