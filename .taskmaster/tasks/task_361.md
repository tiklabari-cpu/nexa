# Task ID: 361

**Title:** INBOX-WAITING-TIMER [SONNET-HIGH] (Sonnet 5.5) Sohbet satırında bekleme süresi: sunucuda threads.awaiting_reply_since, ChatSummary.waiting_since/queued_at, tek paylaşılan saat, eşikler

**Status:** pending

**Dependencies:** None

**Priority:** medium

**Description:** Ajan hangi oyuncunun ne kadar süredir cevap beklediğini listede göremiyor. İstemcide "son olay oyuncudan mı" hesabı yanlış (aktarma sistem mesajı sayacı sıfırlar) — kaynak sunucuda tek alan olmalı. Kaynak: IN-03.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: IN-03. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: InboxPage.tsx:748-797; openapi.yaml:1076-1095 ChatSummary (queued_at yok); schema:822-823; chat-service.ts:2039-2175; InboxSettings :2127-2142.
prisma: threads.awaiting_reply_since timestamptz NULL; inbox_settings.waiting_warn_seconds, waiting_alert_seconds (NULL → 120/300).
api: #appendEvent çağıranları aynı transaction'da: oyuncu mesajı (author customer, recipients all) → boşsa now; ajan/bot oyuncuya görünen mesaj → NULL; AI'dan insana devir (ai_handoff) → boşsa now; kapanış → NULL; iç not ve "aktarıldı" sistem mesajı DOKUNMAZ. Serileştiriciler waiting_since + queued_at.
contract: ChatSummary.waiting_since, queued_at; Inbox ayarlarına iki eşik.
web: features/inbox/WaitingTimer.tsx, tek useNow(15_000), Date başlığından saat farkı düzeltmesi, eşikte ikon + metin ("5 dk+"), kuyrukta "kuyrukta 3 dk"; ayar ekranı GV-06 kalıbı (#323 hazırsa).
WG-03 (#340) ve RP-04 (#291/#371) aynı tanımı kullanır. İleride "en uzun bekleyen" sıralaması için (license_id, awaiting_reply_since) indeksi.

KABUL KRİTERLERİ:
- Oyuncu yazınca sayaç başlar, ajan cevap verince kaybolur.
- İç not / "Sohbet aktarıldı" sayacı sıfırlamaz.
- AI cevap verince kaybolur, AI devredince yeniden başlar.
- Eşiklerde görünüm değişir; Yönetici eşikleri değiştirir.
- Kuyruktaki sohbet kuyruk süresini gösterir.
- 200 satırda kaydırma akıcı (tek zamanlayıcı).

KULLANILAN VARSAYIMLAR:
- Mevcut açık thread'ler boş başlar (isteğe bağlı tek seferlik doldurma).

**Test Strategy:**

Entegrasyon (set/clear kuralları), birim (biçimlendirme), e2e inbox-waiting.spec.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
