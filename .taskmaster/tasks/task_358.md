# Task ID: 358

**Title:** EMAIL-THREADING [OPUS-XHIGH] E-posta zinciri: HMAC imzalı Reply-To (<org>+t-<ticket>-<imza8>), In-Reply-To/References ve [#ID]+aynı gönderen eşleşmesi, solved→open, closed→ilişkili yeni ticket, otomatik yanıt döngüsü koruması

**Status:** pending

**Dependencies:** 356 ⏱, 357 ⏱

**Priority:** high

**Description:** Oyuncunun ajan yanıtına verdiği cevap yeni ticket açıyor; giden e-postada Reply-To yok ("no-reply" satırı). Kaynak: HD-03.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: HD-03. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

XHIGH GEREKÇESİ: (1) adresi bilen herkes ticket'a mesaj ekleyebilir — HMAC zorunlu; döngü koruması (e-posta itibarı).
KOD: email-inbound.ts:95-111 parseRecipient, :139-167; inbound-email-address.ts:41 LABEL_RE (≤32, [a-z0-9-]); channels.ts:414-428 email_resolve_inbound_address; smtp-mailer.ts:159; mime.ts:68+; ticket-email.ts:118-133; Ticket.mergedIntoId schema:1134; ids.ts (10 karakter Crockford).
api (services/tickets/ticket-reply-address.ts): adres <org>+t-<ticketid küçük>-<imza8>@<INBOUND_EMAIL_DOMAIN> (etiket 21 karakter, LABEL_RE uyumlu; imza HMAC(lisans sırrı, ticket id) ilk 8); t- etiketinde tablo yok, lisans organizasyonun varsayılan adresinden, imza doğrulanır.
EŞLEŞTİRME SIRASI: 1 To/Cc/Delivered-To'da geçerli t- token; 2 In-Reply-To/References → ticket_messages.email_message_id; 3 konuda [#ID] + AYNI gönderen; 4 yeni ticket. Spam kapısı eşleştirmeden önce.
EŞLEŞME SONRASI: birleşikse birincile; solved → open + "yeniden açıldı" sistem mesajı; closed ya da N günden eski → yeni ticket + related_ticket_id; farklı gönderen → mesaj eklenir, sender_mismatch=true (ajan arayüzünde uyarı).
GİDEN: HD-01 yanıtları ve HD-04 onayı Reply-To + [#ID] + References; ticket-email.ts pilot "no-reply" satırı kaldırılır.
DÖNGÜ: Auto-Submitted (≠no), X-Autoreply, Precedence bulk|auto_reply, X-Auto-Response-Suppress → otomatik yanıt yok, yeniden açma yok, yalnız not; gönderen başına saatlik açma/yeniden açma sınırı.
prisma: tickets.related_ticket_id varchar(12) NULL; ticket_messages.sender_mismatch boolean; licenses.reply_token_secret (ilk kullanımda üretilir; şifreli) ya da deployment sırrı + license id.

KABUL KRİTERLERİ:
- "Yanıtla" ile gelen cevap aynı ticket'ta, ticket "açık".
- Reply-To silinmiş ama In-Reply-To'lu cevap doğru eşleşir.
- Bozuk imzalı token yeni ticket açar.
- Çözülmüş ticket yeniden açılır; kapalıya gelen cevap ilişkili yeni ticket açar.
- Birleşik ticket'a gelen cevap birincile düşer.
- Otomatik yanıt döngüsü oluşmaz.

KULLANILAN VARSAYIMLAR:
- 04 HD-03 S1: kapalı/eski ticket'a cevap ilişkili yeni ticket (N gün kiracı ayarı, varsayılan 30).

**Test Strategy:**

Entegrasyon (yukarıdaki senaryolar), birim (adres üretme/çözme); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
