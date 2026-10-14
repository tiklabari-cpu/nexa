# Task ID: 359

**Title:** TICKET-AUTO-ACK [SONNET-HIGH] Otomatik "talebiniz alındı" yanıtı: ticket kuralına "Şablon e-postası gönder" eylemi + outside_business_hours koşulu + ticket.expected_response değişkeni; commit sonrası gönderim, backscatter koruması

**Status:** pending

**Dependencies:** 358 ⏱

**Priority:** medium

**Description:** E-postayla gelen talebe onay gitmiyor; oyuncu talebinin alındığını ve ne zaman cevap alacağını bilmiyor. Kaynak: HD-04.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: HD-04. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: ticket-rule-matching.ts:30-75; apply-ticket-rules.ts (transaction içinde); ticket-rule-service.ts, ticket-rules.yaml; ticket-email.ts, ticket-email-template-service.ts prepareTicketEmail; routes/tickets.ts:296-373; template-variables.ts; business-hours.ts.
types/contract: TicketRuleActions.send_template_id; hasAction tanır; koşul outside_business_hours; şablon değişkeni ticket.expected_response (HD-05 #360 hedefinden: mesai içi "4 saat içinde", dışı "09:00 itibarıyla" — HD-05 yoksa değişken boş/yedek ifade).
api: applyTicketRules transaction içinde e-posta göndermez, bildirimleri döndürür; çağıranlar (create, createFromEmail, createFromWidget) commit sonrası backgroundMail; ticket_messages system satırı "Otomatik onay gönderildi: <şablon>"; Auto-Submitted: auto-replied; Reply-To HD-03 adresi; e-posta yoksa atla + "alıcı yok" satırı.
KURALLAR: ticket başına en fazla bir onay (ilk eşleşen kural); birleşik/spam ticket'a yok; sohbetten açılan ticket'a kural kaynağı nedeniyle yok; spam kapısından geçmeyen ya da SPF/DMARC başarısız gönderene yok (backscatter); döngü kuralları HD-03 ile ortak; pilot e-posta kapısı K23 (#356); dil kiracı şablonu.
web: TicketRules.tsx eylem seçicide şablon seçimi + örnek verili önizleme (GV-06 kalıbı).

KABUL KRİTERLERİ:
- E-postayla gelen talebe 1 dk içinde ticket numaralı onay.
- Mesai dışında mesai dışı şablonu.
- Onay akışta sistem satırı.
- Onaya verilen cevap aynı ticket'a (HD-03).
- Otomatik yanıt veren adresle döngü yok.

KULLANILAN VARSAYIMLAR:
- K23 pilot kapısı geçerli.

**Test Strategy:**

Entegrasyon (spool onayı, sohbet kaynaklı yok, auto-reply kaynaklı yok, şablon pasifse yok), e2e tickets.spec.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
