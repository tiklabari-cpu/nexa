# Task ID: 284

**Title:** ID-GLOSSARY [SONNET-HIGH] Kimlik sözlüğü: Thread ID (günlük, nexa chat) / Chat ID (bağlantı, nexa thread) tek tanım — types, i18n, contract açıklamaları, ADR

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** nexa kodundaki chat/thread kelimeleri sahibin tanımının tersini anlatıyor. K1=A: Thread ID = nexa `chats.id` (üye + gün), Chat ID = nexa `threads.id` (her bağlantı). Ekranlar, loglar, dışa aktarmalar ve AI aynı adı aynı anlamda kullanmalı. Kaynak: ID-01.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: ID-01. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 2 — kimlik çekirdeği ve altyapı.

KOD: packages/types/src/ids.ts:19-51 (SHORT_ID_RE, EVENT_ID_RE); schema.prisma Chat :781-812, Thread :816-843, Event :851-887; DetailsPanel.tsx:182-183 tek etiket "Chat ID"; ThreadHeader.tsx:53-55.
YAPILACAK: packages/types/src/id-glossary.ts — türler: day_thread (codeField chat_id), connection (thread_id), event, customer, request, ticket, ai_decision; her biri labelKey, codeField, pattern, shortDescriptionKey; ID-06 için `classifyIdentifier(value)`. contract openapi.yaml + paths/chats.yaml, customer-chat.yaml, webhooks.yaml: chat_id / thread_id açıklamalarına "Panelde: Thread ID (günlük)" / "Panelde: Chat ID (bağlantı)" (alan adları DEĞİŞMEZ). web i18n isim alanı `ids` (tr/en): ids.thread.label="Thread ID", hint "Üyenin bugünkü konuşma grubu"; ids.chat.label="Chat ID", hint "Bu bağlantı". docs/adr/conversation-day-ids.md: A kararı (K1), eşleme tablosu, gün sınırı (ID-04), kod adı ↔ ekran adı. mobile sabitleri tek dosyada.
KURAL: çeviri yalnız sunum katmanında; DB kolonları, API alanları, webhook payload, log anahtarları kod adlarıyla. Dışa aktarma başlıkları "Thread ID (chat_id)". Numara biçimi değişmez (önek yok — ID-01-S2).

KABUL KRİTERLERİ:
- id-glossary.ts bütün türleri içerir; birim testi SHORT_ID_RE/EVENT_ID_RE ile tutarlı.
- Web'de "Chat ID"/"Thread ID" sabit metni yalnız ids kataloğunda (grep birim testi).
- Contract açıklamaları güncel; contract:generate temiz.
- ADR dosyası A kararını ve eşlemeyi içerir.

KULLANILAN VARSAYIMLAR:
- K1=A.
- ID-01-S1: terimler İngilizce kalır + kısa açıklama.
- ID-01-S2: önek yok.
- ID-01-S3: API dokümanında kod adları + panel adı sütunu.

**Test Strategy:**

Birim testleri; mevcut e2e (inbox-header-layout.spec.ts, inbox-copy-link.spec.ts) etiket değişikliğine göre güncellenir; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
