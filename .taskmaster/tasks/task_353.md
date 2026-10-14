# Task ID: 353

**Title:** RICH-CAMPAIGN-CARD [OPUS-HIGH] (Opus 5.5) Zengin kampanya kartı (başlık, görsel, ≤5 buton: send_message / open_url / copy_coupon) + postback + fallback_text; AI kartlarında yalnız send_message ve güvenilir alan adı

**Status:** pending

**Dependencies:** 350 ⏱

**Priority:** medium

**Description:** Kampanya içeriği tek metin; widget zengin mesaj çizmiyor. Aynı kart bot/prosedür mesajlarında da kullanılacak. Kaynak: EN-02.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: EN-02. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: domain.ts:457-460 CampaignContent; CampaignBuilder.tsx; widget.ts:213 state.campaign; rich_message yalnız web Inbox tiplerinde; Event.properties JSONB; /uploads.
types: RichCard {title? ≤80, body ≤220, image? {url, alt}, buttons ≤5}; CardButton {label ≤20 sayaçlı, style, action send_message | open_url{url} | copy_coupon{code}}; ortak doğrulayıcı (yalnız https:, javascript: yok, kupon ≤40); CampaignContent.type text|card + card? (eski message korunur); fallback_text zorunlu.
contract: campaigns.yaml, customer-chat.yaml (campaign.card, buton tıklama), chats.yaml rich_message.
api: kampanya doğrulama; POST /customer/chat/events postback (send_message → normal oyuncu mesajı + properties.postback — AI/yönlendirme aynı yol); campaign_sends.clicked_at.
AI KARTLARI (05 karar 1): yalnız send_message ve TrustedDomains'e open_url; copy_coupon yasak; doğrulama prosedür kaydında ve gönderimde (AI-08 çıktı denetimi).
KURALLAR: zengin desteklemeyen kanalda fallback_text, butonlar numaralı; buton eylemi değişince eski alan sıfırlanır; metin sessizce kırpılmaz; görsel /uploads ya da https, alt zorunlu; kart EN-01 kapısından geçer (#350).
widget: proaktif yuva + transkriptte kart, Clipboard API (loader iframe allow="clipboard-write" — #329 ile ortak), izin yoksa seçilebilir metin; kart çizimi tembel yüklenebilir (50 KB).
web: CampaignBuilder kart editörü + masaüstü/mobil önizleme; Inbox Transcript rich_message salt okunur + "oyuncu şu butona bastı".

KABUL KRİTERLERİ:
- Başlık + görsel + 3 butonlu kampanya kaydedilir ve widget'ta doğru çizilir.
- "Mesaj gönder" sohbeti başlatır, buton metni oyuncu mesajı olarak görünür.
- "Kupon kopyala" panoya yazar, onay gösterir.
- javascript: URL reddedilir.
- Eski metin kampanyaları değişmeden çalışır.
- Inbox'ta kart ve basılan buton görünür.

KULLANILAN VARSAYIMLAR:
- 05 EN-02 karar 1: AI kartında kupon yok.

**Test Strategy:**

types doğrulayıcı birim, widget.campaign.test.ts, e2e campaigns.spec.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
