# Task ID: 335

**Title:** ARCHIVE-SCREEN [OPUS-HIGH] (Opus 5.5) Ayrı Arşiv ekranı (/app/archive): satır = bağlantı (Chat ID), salt okunur transkript, oyuncu paneli; 3 kez yazan oyuncu 3 satır

**Status:** pending

**Dependencies:** 286 ⏱, 329 ⏱, 331 ⏱

**Priority:** high

**Description:** Arşiv bugün Inbox'ın bir görünümü ve "oyuncu başına tek kayıt" mantığıyla çalışıyor (her satır yalnız son thread, chat-service.ts:2142-2146); 20 kez yazmış oyuncu tek satır, eski konuşmalar listede yok. Şikâyet incelemesi ve denetim saatler sürüyor. Kaynak: AR-01.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AR-01. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 5 — ajan deneyimi, arama, arşiv.

contract paths/archive.yaml: GET /archive/conversations — satır = bağlantı (nexa thread; AR-01-S1, "Aynı günü grupla" anahtarı), alanlar chat_id (=Thread ID), thread_id (=Chat ID), customer {id, name, username}, started_at, ended_at, assignee, group_ids, tags, rating (AR-03), handled_by ai|human|mixed, risk_flags (AI-27), first_customer_message (kısa, maskeli), message_count; parametreler AR-02 filtreleri + ID-06/07 aramaları; keyset; total_capped. GET /archive/conversations/{id}: o bağlantının etiket/atanan/puanı (son thread değil).
prisma: threads(license_id, created_at DESC, id DESC) ve threads(license_id, closed_at DESC) — her biri ayrı CONCURRENTLY migration; threads.handled_by text NULL (kapanışta yazılır; AR-02 ve ADR-09a ile tek yüklem #293); gerekirse threads.customer_id denormalize (ölçüme göre).
api: services/archive/archive-service.ts, routes/archive.ts; withTenant + resolveVisibility(read) WHERE içinde (sonradan süzme değil); ilk mesaj events(thread_id, created_at) ile tek sorguda, zaman aralığı koşuluyla (bölüm budaması), N+1 yok.
KURALLAR: canlı değil (RTM yok); resume yeni thread açar, eski bağlantı arşivde kalır; DataRetention silmişse "saklama süresi dolduğu için silindi"; silinmiş oyuncu satırları gelmez; salt okunur ("Inbox'ta aç / yeniden aç" ayrı eylem); varsayılan en yeni bitiş önce; yalnız kapanmışlar, "devam edenleri de göster" filtresi (S3).
GÖRÜNÜRLÜK (S2): EÜ kendi ekipleri, EL kendi ekibi, Yönetici/Kurucu hepsi (RL-02).
web: features/archive/ ArchivePage, ArchiveList, ArchiveDetail (salt okunur Transcript + PlayerCard #331), useArchive; navigation.ts yeni modül (kapsam chats--all:ro|chats--access:ro); URL ?c=<bağlantı id> + AR-02 filtreleri; ayrı boş/yükleniyor/hata durumları (LiveChat "sonsuz iskelet" dersi); arama çubuğu her zaman görünür; dar ekranda sekmeler (GV-04). Inbox "Arşiv" görünümü kısa vadede kalır, "Arşivde aç".
Öncelik notu: P1, ama P0 AR-02 buna bağlı → high.

KABUL KRİTERLERİ:
- Arşiv modülü sol raydan açılır.
- Aynı oyuncunun üç konuşması üç satır; her biri kendi etiket/atanan/puanı.
- Satır seçilince transkript ve oyuncu paneli; URL paylaşılınca aynı konuşma.
- EÜ ekip dışı konuşmaları görmez.
- 1 milyon konuşmalı test verisinde ilk sayfa p95 < 800 ms.
- Boş arşivde "henüz arşiv yok".

KULLANILAN VARSAYIMLAR:
- AR-01-S1/S2/S3 varsayılanları.

**Test Strategy:**

archive.test.ts (3 satır, görünürlük, kiracılar arası), e2e archive.spec.ts, EXPLAIN kanıtı; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 335.1. AR-API [OPUS-HIGH] Arşiv API: archive.yaml + iki CONCURRENTLY migration + threads.handled_by + archive-service (görünürlük WHERE'de, N+1 yok)

**Status:** pending  
**Dependencies:** None  

contract paths/archive.yaml (liste + detay) + iki ayrı CONCURRENTLY migration + threads.handled_by (kapanışta; #293 yüklemiyle) + services/archive/archive-service.ts + routes/archive.ts (withTenant + resolveVisibility WHERE içinde, ilk mesaj tek sorguda, keyset, total_capped) + KURALLAR'ın sunucu tarafı. Ayrıntı ve kabul maddeleri: üst görev #335 details (tek kaynak).

### 335.2. AR-WEB [SONNET-HIGH] Arşiv ekranı: /app/archive, salt okunur transkript, oyuncu paneli, "Inbox'ta aç"

**Status:** pending  
**Dependencies:** 335.1  

features/archive/ ArchivePage + gezinme girişi + salt okunur transkript + oyuncu paneli + "Inbox'ta aç / yeniden aç" + "Aynı günü grupla" anahtarı + i18n. Uçlar ve sözleşme önceki alt görevde bitti: `packages/contract` + üretilen tipler tek kaynak; sunucu davranışını kod haritasıyla bul (`trace_path`, `search_graph`), düzenleyeceğin dosyayı Read ile oku. Ayrıntı ve kabul maddeleri: üst görev #335 details (tek kaynak).
