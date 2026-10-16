# Task ID: 340

**Title:** UNRESPONSIVE-TRANSFER [OPUS-XHIGH] (Opus 5.5) Ajan yanıt vermezse aktarma + "inactive" durumu + bağlantı kopunca offline: assigned_at, CAS aktarma, kapasite dışı inactive, ping-pong sınırı

**Status:** pending

**Dependencies:** 305 ⏱

**Priority:** high

**Description:** Bugün yalnız zaman aşımıyla kapatma var; atanan ajan cevap vermezse sohbet bekler, tarayıcıyı kapatan ajan "çevrimiçi" görünmeye ve sohbet almaya devam eder (RTM presence yazmıyor). Kaynak: WG-03.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: WG-03. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

XHIGH GEREKÇESİ (eski etiket MAX, 2026-10-14 gözden geçirme): routing/eşzamanlılık (MASTER-PROMPT [MAX] dilimi).
KOD: chat-timeout.ts (ChatTimeoutSweeper; #sweepTenant findFirst ile rastgele marka satırı), scheduler/jobs.ts:138, env.ts:1012, InboxSettings schema:2127-2142, settings.ts:2617/2632, ChatTimeout.tsx; first_response_at chat-service.ts:508-512; transfer :1371; TRANSFER_REASONS domain.ts:64-70 (agent_disconnected kullanılmıyor); threads'te assigned_at yok; routing #selectAgent kapasite tüm aktifleri sayıyor; RTM presence yazmıyor, lastSeenAt yalnız API (auth.ts:459-466).
types/contract: TRANSFER_REASONS += agent_unresponsive; settings.yaml chat-timeout gövdesine unanswered_transfer_seconds, inactive_after_seconds; chats.yaml özetine inactive.
prisma: InboxSettings iki nullable INT; threads.assigned_at, inactive_since, unresponsive_transfers SMALLINT DEFAULT 0.
api: atama yapan her yer (route, drainQueue, transfer, takeover, claim #346) assigned_at yazar; chat_inactivity işi (SCHEDULE_CHAT_INACTIVITY_MS 15–30 sn) ya da chat_timeout ek adımı; aday: active + atanmış + first_response_at NULL + assigned_at < now−X (AI devrinde assigned_at = devir anı); CAS ("atanan hâlâ aynı ve hâlâ yanıt yok"); hedef aynı ekipte, yanıtsız ajan hariç, uzmanlık korunur; yoksa ekip kuyruğunun BAŞINA + Ekip Lideri bildirimi; yanıtsız ajan not_accepting_chats + presence olayı (kapatılabilir ayar); aynı sohbet en fazla 2 kez bu nedenle aktarılır; inactive: son olaydan beri inactive_after geçen aktif oturum kapasiteden düşer, yeni mesajla aktifleşir (#appendEvent temizler); kapasite sayımı inactive_since IS NULL.
RTM: son soket kapanınca 2 dk tolerans → offline + agent_presence_events (source disconnect — RP-03 #370) + routing_status_set; tek sorumlu yer; çok kopyada "son soket" Redis'te.
Manuel mod (WG-07 #346) ekiplerinde X süresi "kimse almadı" uyarısı. WG-08 (#342) aynı sweep'i paylaşır: sıra önce e-posta isteme sonra aktarma.
web: ChatTimeout.tsx üç satır, sıra doğrulaması (aktarma < inactive < kapatma), GV-06 kalıbı (#323); Inbox "inactive" rozeti (soluk); ajana durum değişikliği bildirimi.
Marka notu: yeni ayarlar lisans varsayılanı olarak okunur; marka bazlı davranış çok marka işinde.

KABUL KRİTERLERİ:
- 3 dk ayarında atanmış yanıtsız sohbet 3 dk + en fazla bir sweep aralığında aynı ekipte başka ajana geçer; olayda agent_unresponsive.
- Ajan son saniyede yanıt verdiyse aktarma olmaz (yarış testi).
- Uygun ajan yoksa kuyruk başı + Ekip Lideri bildirimi.
- Inactive sohbet limite sayılmaz, yeni mesajla aktifleşir.
- Tarayıcıyı kapatan ajan 2 dk sonra offline, yeni sohbet almaz.
- aktarma ≥ inactive girilince kayıt reddedilir.

KULLANILAN VARSAYIMLAR:
- Yanıtsız ajan not_accepting_chats yapılır (05 karar 2), ayarla kapatılabilir.
- LC semantiği: yalnız ilk yanıt beklenir.

**Test Strategy:**

Entegrasyon (sweep, yarış, kapasite, ping-pong sınırı), RTM birim (tolerans), e2e inbox-assign.spec.ts genişler; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 340.1. UT-SCHEMA [OPUS-HIGH] Kontrat/types + migration (assigned_at, inactive_since, unresponsive_transfers, ayar kolonları) + tüm atama yollarında assigned_at

**Status:** pending  
**Dependencies:** None  

Üst görev 340 ayrıntılarındaki ilgili bölüm.

### 340.2. UT-SWEEP [OPUS-XHIGH] chat_inactivity sweep: CAS aktarma, hedef seçimi, kuyruk başı, ping-pong sınırı, inactive kapasite

**Status:** pending  
**Dependencies:** 340.1  

Üst görev 340 ayrıntılarındaki ilgili bölüm.

### 340.3. UT-PRESENCE-WEB [OPUS-XHIGH] RTM bağlantı kopma → offline (Redis son soket) + ChatTimeout.tsx üç satır + inactive rozeti

**Status:** pending  
**Dependencies:** 340.2  

XHIGH GEREKÇESİ: (3) teslim güvencesi — yanlış çevrimiçi ajan sohbet kaybettirir.
