# Task ID: 338

**Title:** TRANSCRIPT-EXPORT [OPUS-HIGH] (Opus 5.5) Transkripti dışa aktarma: TXT indir, yazdırılabilir HTML (Türkçe karakterli PDF tarayıcıdan), e-postayla gönderme (oyuncu kopyası / iç kopya, izinli alan adları, audit, oran sınırı)

**Status:** pending

**Dependencies:** 335 ⏱

**Priority:** medium

**Description:** Oyuncu şikâyeti ya da lisans otoritesi talebinde kayıt sunulmalı; bugün isteğe bağlı indirme/yazdırma/gönderme yok. Raporlardaki PDF üretici Türkçe karakterleri "?" yapıyor (reports-export.ts:211-238) — kullanılmamalı. Kaynak: AR-04.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AR-04. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 5 — ajan deneyimi, arama, arşiv.

EFOR: high — dört xhigh gerekçesinden (güvenlik yüzeyi / para doğruluğu / teslim güvencesi / pencere içi karar) hiçbiri yok; karar önceden verilmiş (2026-10-14 gözden geçirme).
contract: GET /chats/{chatId}/threads/{threadId}/transcript?format=txt|html&audience=customer|internal (Content-Disposition attachment); POST …/transcript/email {to, audience:'customer'} → 202, hata recipient_not_allowed.
kiracı ayarı: inbox_settings.transcript_allowed_domains text[] (AR-04-S3).
api: renderTranscript (services/notifications/chat-transcript.ts) yeniden kullanılır; başlıkta kiracı adı, Thread ID (chat_id) ve Chat ID (thread_id), kullanıcı adı, kiracı TZ'de başlangıç/bitiş, ajanlar, dışa aktaran ve zaman; audit chat.transcript_exported / chat.transcript_emailed (kim, hangi konuşma, alıcının alan adı — metin yok); BackgroundMail kind chat_transcript (dış kotaya tabi); RL-02 scope; akış hâlinde üretim; kullanıcı başına dakikada N.
KOPYALAR (S2): "iç kopya" (iç notlu) yalnız indirme/yazdırma, EL+; dışarıya e-postayla yalnız oyuncu kopyası.
ALICI (S3): yalnız oyuncunun kayıtlı adresi ve kiracının izinli alan adları.
YETKİ (S1): EL ve üstü; EÜ yalnız kendi konuşmasını oyuncunun kayıtlı e-postasına.
EKLER: dosya adı + "panelde görüntüleyin" notu; süreli imzalı bağlantı e-postaya KONMAZ.
web: features/archive/TranscriptActions.tsx; /app/archive/:id/print kabuksuz sayfa, @media print, Türkçe karakterli sistem fontu; e-posta modalı (alıcı varsayılan oyuncu e-postası).
WG-06 (#345) aynı şablonu kullanır. Sunucu PDF'i istenirse gömülü font = yeni bağımlılık kararı (kapsam dışı).

KABUL KRİTERLERİ:
- EL TXT indirir: Chat ID ve Thread ID var, saatler kiracı TZ'de, iç notlar yalnız iç kopyada.
- Yazdırma görünümü "ğşıİ"yi doğru basar.
- Oyuncuya giden e-posta iç not içermez.
- İzinli olmayan alan adına gönderim reddedilir.
- Her işlem audit'te.
- Varsayılan kararda EÜ iç kopyayı indiremez.

KULLANILAN VARSAYIMLAR:
- AR-04-S1/S2/S3 varsayılanları.

**Test Strategy:**

Entegrasyon (iç not yok, alan adı reddi, audit, kiracılar arası 404), e2e (yazdırma Türkçe karakter, mailbox.ts ile e-posta içeriği); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
