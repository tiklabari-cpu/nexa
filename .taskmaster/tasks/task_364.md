# Task ID: 364

**Title:** EVENT-SUGGESTED-REPLIES [SONNET-HIGH] (Sonnet 5.5) Olaya bağlı önerilen yanıtlar (sohbet başladı, aktarıldı, oyuncu sessiz, iyi/kötü puan): istemcide olay tespiti, en fazla 4 çip, otomatik gönderim yok, risk bayraklıya promosyon önerilmez

**Status:** pending

**Dependencies:** 363 ⏱, 337 ⏱

**Priority:** low

**Description:** Önerilen yanıt çipleri yalnız niyet şablonu/Copilot; olaylara (aktarma, sessizlik, puan) bağlı hazır yanıt önerisi yok. Kaynak: IN-07.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: IN-07. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: replySuggestions.ts (ReplyChip.source template|copilot); Composer.tsx:325-443; schema:1311-1328; RTM chat_transferred, incoming_chat, incoming_event; puan push'u yok (AR-03 #337 chat_rated ekler).
prisma: canned_responses.suggest_on text[] DEFAULT '{}' (chat_started, chat_transferred, customer_idle, rated_good, rated_bad), suggest_order int, category (promosyon ayrımı; AI-27 bağlamı); inbox_settings.customer_idle_seconds (NULL → 180). Kişisel öneriler IN-06 private (#363).
contract/api: CannedResponse.suggest_on, category. UI tercihi suggestions_event_enabled (ui-preferences.ts).
web: features/inbox/eventSuggestions.ts saf fonksiyon (chat_started: ajan mesajı yok + ilk açılış; chat_transferred: son sistem olayı bu ajana aktarma; customer_idle: son görünen mesaj ajandan + idle süre, istemci zamanlayıcısı; rated_*: chat_rated push'u); Composer source 'event'; sıra olay > Copilot > şablon, en fazla 4 çip; yalnız kutu boşken, olay başına bir kez, kapatılan tekrar çıkmaz; otomatik gönderim YOK; risk bayraklı sohbette (isPromoSuppressed #350) promosyon kategorisi önerilmez; ayar ekranı SuggestedResponses.tsx (GV-06); # seçici dişlisinde "Benim için kapat".

KABUL KRİTERLERİ:
- "Sohbet aktarıldı"ya bağlı yanıtın çipi aktarılan sohbeti açan ajana görünür.
- Çipe tıklayınca metin kutuya gelir, gönderilmez.
- Kişisel kapatma açıkken çip yok.
- Risk bayraklı sohbette promosyon yanıtı önerilmez.

KULLANILAN VARSAYIMLAR:
- P2 → low.
- Promosyon filtresi EN-01 (#350) sonrası etkin; o gelmeden category alanı yine eklenir.

**Test Strategy:**

Birim (olay tespiti), e2e (aktarılan sohbette çip); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
