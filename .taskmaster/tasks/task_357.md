# Task ID: 357

**Title:** INBOUND-EMAIL-BODY [OPUS-XHIGH] (Opus 5.5) Gelen e-postanın gövdesi ve ekleri: normalize webhook şeması, alıntı/imza ayıklama, HTML temizleme, ek tarama, hassas ek bayrağı ve erişim kaydı

**Status:** pending

**Dependencies:** 356 ⏱

**Priority:** high

**Description:** Gelen e-posta webhook'u text alanını kabul edip saklamıyor; ticket'a yalnız konu yazılıyor — oyuncunun "2.500 TL, saat 14:42, dekont ektedir" e-postası kayboluyor. Kaynak: HD-02.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: HD-02. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

XHIGH GEREKÇESİ: (1) güvenlik yüzeyi — dış HTML, ekler (virüs), kimlik belgeleri.
KOD: routes/channels.ts:100-108 inboundBody, :388-448 webhook (INBOUND_EMAIL_SECRET, pilotRefused); email-inbound.ts:113-169; spam-filter.ts; cc-mask.ts; services/storage (object-store, attachment, virus-scanner — tarayıcı kapalıysa reddeder); channels.yaml#/emailInbound.
contract: normalize gövde (to, cc[], from, subject, text, html, message_id, in_reply_to, references[], headers {auto_submitted, precedence, x_autoreply}, attachments[] {filename, content_type, size, content_base64}); sağlayıcı dönüştürücüleri (Postmark, Mailgun, SendGrid, SES) ayrı adaptör — sağlayıcı seçilmedi, şema bağımsız.
api (email-inbound.ts, sırayla): 1 idempotency (license_id, email_message_id); 2 eşleştirme HD-03 (#358 gelene kadar yeni ticket); 3 gövde: alıntı + imza ayıklama (Gmail/Outlook/Apple + Türkçe "… tarihinde … şunu yazdı:"), kart maskesi, uzunluk sınırı, ham metin de saklanır ("tamamını göster"); 4 HTML izin listesiyle temizlenir (script/iframe/style/on* yok, dış görsel data-src), yalnız body_html; 5 ekler: tip/boyut → virüs taraması → depolama anahtarı; reddedilen ek için sistem notu; 6 ticket_messages customer_message; 7 spam değerlendirmesine gövde dahil. Rota bodyLimit ≈30 MB. Ticket + mesaj tek transaction, ekler önce ve dışarıda; başarısız ek mesajı engellemez.
Hassas ek: dosya adı/konuda "kimlik", "pasaport", "ehliyet", "KYC" ya da kiracı "tüm ekleri hassas say" → sensitive; saklama politikasına bağlı (services/retention); açanı audit'e yaz; RL-02 yetkisiyle bulanık/kilitli.
Maskeleme yalnız kart/şifre/IBAN (AI-26), imzadaki telefon maskelenmez.
web: TicketThread gövde pre-wrap düz metin; "Biçimli görünüm" boş sandbox'lı iframe srcdoc + CSP; önizleme yalnız görsel/PDF.

KABUL KRİTERLERİ:
- Oyuncunun dekontlu e-postası ticket'ta metniyle ve ekiyle görünür.
- Alıntı ana metinde yok, açılır bölümde.
- Virüslü ek (EICAR) saklanmaz, not düşer.
- HTML içindeki script çalışmaz.
- Aynı e-posta iki kez → tek ticket.
- Kart numarası maskeli.
- Hassas eki açan audit'te.

KULLANILAN VARSAYIMLAR:
- Gelen e-posta sağlayıcısı seçilmedi (07 açık nokta); şema bağımsız.

**Test Strategy:**

channel-email-inbound.test.ts genişler (Türkçe Gmail alıntısı, EICAR, Message-ID tekrarı, script), alıntı ayıklayıcı birim; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
