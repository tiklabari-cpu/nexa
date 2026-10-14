# Task ID: 342

**Title:** ASK-EMAIL [SONNET-HIGH] "E-posta iste": ajan X dk yanıt vermezse ya da çevrimdışıyken satır içi e-posta kartı (bir kez, idempotent; kullanıcı adı/e-posta biliniyorsa yalnız "size buradan dönülecek")

**Status:** pending

**Dependencies:** 340 ⏱, 341 ⏱

**Priority:** medium

**Description:** Yanıt gecikince ya da kimse yokken oyuncunun iletişim bilgisi alınmadan sohbet kayboluyor; çevrimdışı formu yalnız form alanı tanımlıysa açılıyor. Kaynak: WG-08.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: WG-08. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

types/prisma: InboxSettings.ask_email_after_seconds INT NULL, ask_email_when_offline BOOLEAN DEFAULT false; iki metin (WG-05 metin altyapısıyla da tutulabilir #344).
api: WG-03 sweep'i (#340) aynı geçişte "X dk yanıt yok ve oyuncunun e-postası/kullanıcı adı yok" sohbetlerine BİR KEZ sistem olayı (type system, properties.kind ask_email) yazar; sıra önce e-posta isteme sonra aktarma; olay varlığı kontrolüyle idempotent. E-posta cevabı müşteri ucu (PATCH /customer ya da pre-chat yazımı); maskeleme + customers.email güncellemesi; is_lead mevcut mantık.
KURAL: kullanıcı adı/e-posta biliniyorsa kart yok, "size buradan dönülecek" sistem mesajı (bir kez). Çevrimdışı senaryosu WG-09 (#341): AI açıksa yalnız AI'ın insana devretmek istediği anda.
widget: ask_email olayını satır içi kart olarak çizer, gönderince onay (8 dil).
web: ayar ekranı (GV-06 kalıbı) + önizleme.

KABUL KRİTERLERİ:
- 2 dk ayarında yanıtsız ve iletişim bilgisi olmayan sohbette widget bir kez e-posta kartı gösterir; e-posta kaydedilir, onay görünür.
- Kullanıcı adı bilinen oyuncuya kart gösterilmez.
- Ayar kapalıyken hiçbir şey olmaz.

KULLANILAN VARSAYIMLAR:
- 05 WG-08 karar 1: bilinen kimlikte kart yok.

**Test Strategy:**

Sweep birim/entegrasyon (tek sefer), widget çizim testi; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
