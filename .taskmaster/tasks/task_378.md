# Task ID: 378

**Title:** IGAMING-PLATFORM-F2 [OPUS-MAX] F2 — iGaming platform entegrasyonu (gerçek): PlatformConnector, salt okunur araçlar (deposit_lookup, withdrawal_status, kyc_status, bonus_state), doğrulanmış kimlik kapısı, tool_invocations

**Status:** deferred

**Dependencies:** 377 ⏱, 287 ⏱

**Priority:** low

**Description:** K15 gereği ertelendi. Satıcı API erişimi (NDA, sandbox, IP izin listesi) ve DPA ticari süreç gerektirir; pilot platform seçilince açılır. Kaynak: KN-06.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: KN-06. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

ETKİNLEŞTİRME KOŞULU: pilot platform seçimi + satıcı sandbox erişimi + DPA; operatörün imzaladığı kimlik ya da eşdeğer doğrulanmış oyuncu-platform ID eşlemesi (#388).
05 KN-06 özeti: PlatformConnector (findPlayer, listTransactions, getKycStatus, getBonusState) + maskeli DTO'lar; araç tanımları AI-28 kayıt formatında (#321/#322; read_only, zaman aşımı ≤3 sn, önbellek, hassasiyet); platform_connections (credential_ciphertext, appCredentialAad) + tool_invocations (maskeli giriş özeti, outcome, latency, error_code) + RLS; safe-fetch yalnız tanımlı host, devre kesici, kiracı oran sınırı; kimlik kapısı: araç yalnız DOĞRULANMIŞ kimlikle (sohbette yazılan kullanıcı adıyla asla); salt okuma (05 karar 2); hata/zaman aşımında AI "kontrol edemiyorum" + F1 akışı, AI-08 söz verme yasakları sürer; LLM'e yalnız gereken alanlar; veri bölgesi; devir kartında "AI şunu kontrol etti"; Inbox "Oyuncu hesabı" kartı.
Gerçek satıcı çağrıları testte taklit sunucu (MASTER-PROMPT §5).

KABUL KRİTERLERİ:
- Doğrulanmış oyuncu için deposit_lookup son yatırımı döndürür; AI söz vermeden aktarır, devir kartında görünür.
- Doğrulanmamış oyuncuda araç çağrılmaz.
- 3 sn yanıtsızlıkta F1 akışı.
- Kimlik bilgisi şifreli, loglarda yok.
- Kiracılar arası yalıtım.

KULLANILAN VARSAYIMLAR:
- K15: F2.
- Ticari ve hukuki önkoşullar (07 açık risk).

**Test Strategy:**

Adaptör sözleşme testleri (taklit sunucu), zaman aşımı/devre kesici, kimlik kapısı, kiracılar arası, log maskeleme; güvenlik incelemesi; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
