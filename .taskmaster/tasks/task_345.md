# Task ID: 345

**Title:** TRANSCRIPT-ON-REQUEST [OPUS-HIGH] (Opus 5.5) Sohbet dökümü (K26): oyuncuya OTOMATİK GÖNDERİM YOK, yalnız oyuncu widget'ta tıklarsa; iç kayıt (log/transkript saklama) aynen sürer; iletme adresleri

**Status:** pending

**Dependencies:** 280 ⏱, 338 ⏱

**Priority:** medium

**Description:** Bugün kapanışta e-postası olan ziyaretçiye döküm otomatik gidiyor (chat-service #emailTranscript). K26: döküm otomatik gönderilmez; oyuncu isterse "Dökümü e-postama gönder" ile alır. Bu karar loglamayı/iç kaydı etkilemez. Kaynak: WG-06.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: WG-06. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

EFOR: high — dört xhigh gerekçesinden (güvenlik yüzeyi / para doğruluğu / teslim güvencesi / pencere içi karar) hiçbiri yok; karar önceden verilmiş (2026-10-14 gözden geçirme).
K26 (sahip kararı): customer_auto_send kavramı AÇILMAZ ya da sabit false; kapanışta oyuncuya döküm e-postası gitmez (mevcut ve yeni tüm kiracılar). Events/transkript/arşiv/zaman çizelgesi kaydı DEĞİŞMEZ — yalnız dışarıya e-posta gönderimi kalkar. Ajana giden kopya ajanın kendi bildirim tercihine göre sürer. Geçiş sürüm notunda ve pilot kiracıya duyurulur.
KOD: chat-service.ts #emailTranscript (≈:1130-1270), chat-transcript.ts:55 transcriptRecipients, messages.ts:495 customerTranscriptMail, :541 teamTranscriptMail, mail-caps.ts.
types/contract: TranscriptSettings {forward_to: string[] ≤5, forward_include_notes: boolean}; settings.yaml; customer-chat.yaml POST /customer/chat/transcript.
prisma: InboxSettings kolonları ya da transcript_settings (RLS).
api: transcriptRecipients oyuncuyu otomatik alıcıdan çıkarır; iletme adresleri her biri ayrı deliver; yeni müşteri ucu: yalnız kendi en son sohbeti, oyuncunun dili (WG-02 #280), AR-04 şablonu (#338) oyuncu kopyası (iç not YOK), oran sınırı (sohbet başına 3, saatte 5 → 429); forward_include_notes yalnız kiracının doğrulanmış alan adında (değilse ayar reddedilir) ve bu tür iç bildirim sayılır.
widget: başlık menüsünde "Dökümü e-postama gönder", e-posta yoksa giriş alanı (8 dil). web: ayar bölümü, adres doğrulama, iç not uyarısı, GV-06 kalıbı.
Kart maskelemesi yazma anında olduğu için döküm zaten maskeli.

KABUL KRİTERLERİ:
- Kapanışta oyuncuya döküm e-postası gitmez (mevcut ve yeni kiracılar); ajana tercihine göre gider.
- Kapanış sonrası transkript, arşiv ve zaman çizelgesi kaydı eskisi gibi tam (regresyon testi).
- Widget'tan istenince döküm oyuncunun dilinde gelir ve iç not içermez.
- 5'ten fazla iletme adresi ve doğrulanmamış alan adına iç notlu iletme reddedilir.
- Oran sınırı aşılınca 429.

KULLANILAN VARSAYIMLAR:
- K26: otomatik gönderim yok, yalnız istekle; loglama/iç kayıt etkilenmez.
- İletme e-postaları iç bildirim sayılır (dış kotaya girmez) — 07 açık nokta.

**Test Strategy:**

chat-transcript.test.ts (saf karar), entegrasyon (otomatik gönderim yok, iç not sızmaz, iç kayıt sürer), e2e widget.spec.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
