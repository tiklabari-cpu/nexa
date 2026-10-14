# Task ID: 386

**Title:** NO-PII-IN-URLS [OPUS-MEDIUM] (Opus 5.5) Kişisel verinin URL'lerde olmaması: scripts/audit/url-pii.mjs CI kontrolü, log maskesine q/search, referrer politikası, ziyaret sayfa adreslerinin sorgu kısmının maskelenmesi, dışa aktarma POST

**Status:** pending

**Dependencies:** None

**Priority:** medium

**Description:** Log maskesi query'yi tanıyor ama q'yu tanımıyor; ziyaret edilen operatör sayfalarının adresleri (ör. ?email=) açık saklanıyor olabilir (doğrulanmadı); kural CI'da korunmuyor. Kaynak: GV-05.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: GV-05. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

XHIGH GEREKÇESİ: (1) kişisel veri sızıntısı (KVKK), logs/referrer/ziyaret kaydı.
KOD: log-redact.ts:152-153 SENSITIVE_QUERY_KEY (q yok), :176-179 logSafeUrl, :191-195 requestPath; server.ts:232-243; CustomersPage.tsx:115-131/:140-146; Inbox ?chat=; ThreadHeader ?chat=; AuditLogPage.tsx:373-386; customer.ts:768-771 recordPageView.
denetim: scripts/audit/url-pii.mjs (salt-okuma, mevcut scripts/audit/* kalıbı, CI'a bağlı): setSearchParams, navigate(, href=, URLSearchParams.set çağrılarında email, name, username, phone, query, q, search anahtarlarını yakalar; kendi testi (ihlal eden örnek → kırmızı).
api: SENSITIVE_QUERY_KEY'e q, search; ziyaret sayfa adresi ve geliş adresinin sorgu kısmı saklanmadan önce maskPii + hassas anahtar maskesi (önce mevcut durum doğrulanır, bulgu HANDOFF'a); kampanya/hedef kuralları sorgu kısmına dayanıyorsa etkisi kontrol edilir (services/campaigns/*, services/goals/*); dışa aktarmalar POST + kısa ömürlü imzalı indirme.
web: arama metinleri bileşen durumunda (gerekirse yalnız #); panel index.html <meta name="referrer" content="strict-origin-when-cross-origin"> (mevcut değer kontrol edilir); üçüncü taraf bağlantılarında üye numarası/e-posta yok.
KURAL: adreste yalnız rastgele numaralar (Thread/Chat ID, UUID) ve kişisel olmayan filtreler; üye UUID'si panel içinde kalabilir, dış bağlantıya eklenmez (K4 token anahtarı gibi). AR-02 (#336) ve ID-06 (#332) bu kurala göre yazılır.

KABUL KRİTERLERİ:
- Denetim aracı CI'da yeşil; ihlal eden örnek eklenince kırmızı.
- Arşivde e-posta/kullanıcı adıyla aramadan sonra adres ve geçmişte metin yok.
- Dış siteye tıklamada Referer yalnız köken.
- Operatör sayfası adresindeki email= ziyaret kaydında açık saklanmaz.
- Sunucu logunda q=[redacted].

KULLANILAN VARSAYIMLAR:
- GV-05'te açık soru yok.

**Test Strategy:**

Denetim aracı testi, ziyaret kaydı maskeleme entegrasyonu, log maskesi birim; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
