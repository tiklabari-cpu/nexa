# Task ID: 333

**Title:** MESSAGE-FULLTEXT-SEARCH [OPUS-MAX] (Opus 5.5) Mesaj içeriğinde serbest metin arama: pg_trgm GIN (bölümlü events), SECURITY DEFINER search_events (kiracı + görünürlük içeride), varsayılan son 90 gün, iç notlar yetkiye göre

**Status:** pending

**Dependencies:** 332 ⏱

**Priority:** high

**Description:** Mesaj metninde arama hiç yok. QA, şikâyet, uyum incelemeleri ve AI'ın cevaplayamadıklarını bulmak buna dayanır ("geçen hafta 'Papara 5000' yazan oyuncu", TXID, IBAN son haneleri). Kaynak: ID-07.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: ID-07. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 5 — ajan deneyimi, arama, arşiv.

[MAX] RLS'i atlayan SECURITY DEFINER — kiracı ve görünürlük filtresi fonksiyonun içinde zorunlu ve testli; güvenlik incelemesi.
KOD: Event schema:851-887 (aylık bölümlü, event-partitions.ts, runbook event-partitions.md); RLS + indeks tuzağı (migration 20260911170000_events_sequence_column, transcript-page-plan.test.ts); infra/db/init/00-extensions.sql (pg_trgm YOK).
migration: CREATE EXTENSION IF NOT EXISTS pg_trgm (+ 00-extensions.sql; pilot rolüyle denenir — trusted eklenti); bölümlü ebeveyne GIN trigram indeksi; mevcut büyük bölümler için önce her bölümde CONCURRENTLY + ebeveyne ATTACH (uzun kilit yok); search_events(p_license, p_query, p_from, p_to, p_unrestricted, p_group_ids, p_actor_id, p_include_notes, p_limit, p_cursor) — sabit search_path, license_id = p_license açık filtre, chat_access ∩ grup listesi veya katılımcı, yalnız gereken kolonlar; siyahtus_app'e yalnız EXECUTE.
Türkçe İ/ı: lower/ILIKE locale bağımlı — gerekirse translate ile normalize arama kolonu.
contract: listChats'e query (≥3), date_from, date_to (AR-02 ile ortak); öğeye match {event_id, thread_id, snippet, created_at}; search.yaml türlerine message.
api: services/chat/event-search.ts (resolveVisibility → fonksiyon parametreleri); GET /chats query verilince bu yol; GET /search da kullanır.
KURALLAR: kırp, boşluk tekle, LIKE kaçışı, ≥3 karakter; tarih varsayılan son 90 gün (ID-07-S1), en fazla 400 gün (bölüm budaması); created_at DESC, id keyset, sayfa 50; sohbet başına gruplama (en yeni eşleşme + sayı), snippet sunucuda ±60; iç notlar ajanlarda dahil (S2), müşteri principal'ı ulaşamaz; kök eşleşmesi yok (S3; sonraki sürüm tsvector('simple')).
web: arşivde her zaman görünür arama çubuğu, tarih aralığı, vurgulu snippet, "Bu mesaja git" → /app/inbox?chat=T&thread=C&event=E; Ctrl+K "Arşivde ara" modu.

KABUL KRİTERLERİ:
- "papara 5000" "Papara ile 5000 TL" geçen mesajı bulur; büyük/küçük duyarsız; "İSTANBUL" "istanbul"u bulur.
- Sonuçlar yalnız aramayı yapanın görebildiği sohbetlerden.
- Maskelenmiş kartın açık hali aranınca sonuç yok.
- Tarih yoksa son 90 gün.
- Plan testi büyük veride trigram indeksinin kullanıldığını doğrular; seed'de p95 < 1 sn.
- Aranan metin tarayıcı adresinde yok.

KULLANILAN VARSAYIMLAR:
- ID-07-S1/S2/S3 varsayılanları.
- Trigram indeksinin yazma yükü yük testiyle ölçülür (07 açık risk).

**Test Strategy:**

Entegrasyon (bulma, görünürlük, iç not, kiracılar arası negatif, tarih sınırı, %/_ kaçışı, Türkçe harfler), plan testi (transcript-page-plan kalıbı), e2e arşiv araması; güvenlik incelemesi; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 333.1. FTS-EXT-INDEX [OPUS-HIGH] pg_trgm + bölüm bazında CONCURRENTLY indeks + ATTACH + init SQL

**Status:** pending  
**Dependencies:** None  

Her CONCURRENTLY kendi migration dosyasında tek ifade. HIGH NOTU (XHIGH→HIGH, sahip kararı 2026-10-22 · §D332): indeks işi mekanik ve hatası sessiz kalmaz. Bölümlenmiş tabloda üst tabloda CONCURRENTLY desteklenmez: üstte ON ONLY ile indeks, her bölümde CONCURRENTLY, sonra ALTER INDEX … ATTACH PARTITION; pg_index.indisvalid testi zorunlu (Prisma diff kısmi indeksleri görmez). SECURITY DEFINER fonksiyonu 333.2'de MAX kalır. Geçmiş: 2026-10-21 MAX→XHIGH (§D315).

### 333.2. FTS-FUNCTION [OPUS-MAX] search_events SECURITY DEFINER (kiracı + görünürlük içeride) + güvenlik testleri

**Status:** pending  
**Dependencies:** 333.1  

Üst görev 333 ayrıntılarındaki ilgili bölüm.

### 333.3. FTS-API [OPUS-HIGH] event-search.ts + listChats query/date + /search message türü

**Status:** pending  
**Dependencies:** 333.2  

Üst görev 333 ayrıntılarındaki ilgili bölüm.

### 333.4. FTS-WEB [SONNET-HIGH] Arşiv arama çubuğu + snippet + "Bu mesaja git" + Ctrl+K "Arşivde ara"

**Status:** pending  
**Dependencies:** 333.3  

Üst görev 333 ayrıntılarındaki ilgili bölüm.
