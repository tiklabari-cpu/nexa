# Task ID: 286

**Title:** DAILY-THREAD [OPUS-MAX] (Opus 5.5) Günlük thread (K1=A): üyenin o günkü ilk bağlantısı yeni nexa chat (Thread ID) + thread (Chat ID); aynı gün dönüşte aynı chat'e yeni thread; ertesi gün ikisi de yeni

**Status:** pending

**Dependencies:** 284 ⏱, 285 ⏱

**Priority:** high

**Description:** Bugün her geri gelişte yeni chat + thread açılıyor, takvim günü yok; kapanmamış sohbet günlerce aynı kalabiliyor. Günlük thread, AI'ın "Az önce Papara yatırımınızla ilgili yazmıştınız" diyebilmesinin ve ajanın günün tüm temaslarını tek yerde görmesinin temeli. K1=A (nexa chat = günlük kap), K2 (yeni bağlantı = kapanıştan sonraki ilk mesaj; yenileme/ikinci sekme yeni ID açmaz; widget konuşması 30 dk sessizlikte kapanır), K3 (gün sınırı). Kaynak: ID-02.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: ID-02. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 2 — kimlik çekirdeği ve altyapı.

[MAX] chat→thread→event çekirdek modeli (MASTER-PROMPT efor kapısı).
KOD: customer.ts:676-685, :813-826 + chats.start; chat-service.ts start :323-360, #startInTransaction :361-460, sendEvent :463, #closeConversation :952-1050, resume :1289-1370 (yeni thread'i ajana atar), transfer :1371+ (chat_access sil/yaz :1414-1415), #createChatWithThread :1962-2014; uq_one_active_chat / uq_one_active_thread (20260722154008_domain_model:718-726); chat-timeout.ts:104-118 (ayar yoksa kapanmaz); customer-service.ts:498 sohbet sayısı; webhook chat_started yalnız yeni chat (chat-service.ts:350-355); useInbox.ts:97-100 yalnız en yeni thread.
MANTIK (05 ID-02 Kodlama mantığı 1-8):
- local_day = localDayKey(now, tz, hour) (#285); chats.local_day, chats.day_tz yazılır.
- Ziyaretçi mesajı: (a) aktif chat var: local_day NULL/bugün → ekle; geçmiş gün + son olay boşta kalma süresinden (yoksa 30 dk) eski → aktif thread #closeConversation(reason day_rollover), sonra (b); daha yeni → ekle (gece yarısı bölünmez). (b) aktif chat yok: (customer_id, local_day=bugün) chat'i varsa aynı gün dönüş: chat active=true, yeni thread (assignee null, opened_via=same_day_return), #startInTransaction yönlendirme/kuyruk mantığı yeniden kullanılır (resume KULLANILMAZ); agents-only sistem olayı "Üye aynı gün tekrar bağlandı", incoming_chat, trafik, thread_started webhook, audit chat.connection_opened, spam filtresi. Yoksa chats.start (first_of_day). (c) yarış: P2002 → yeniden oku, kazanan bağlantıya ekle, 1 kez yeniden dene.
- Ajan yolları: POST /chats (agent_start), resume bugünse bugünkü davranış (agent_reopen); eski günse bugünün chat'i bulunur/açılır, yeni thread ajana atanır, properties.continued_from_chat_id (ID-02-S6).
- Ekip görünürlüğü: aynı gün dönüşte yeni ekip chat_access'e EKLENİR (eskiler silinmez; ID-02-S7); transfer "değiştir" davranışını korur; hassas ekip istisnası RL-02.
- K2: InboxSettings.chatTimeoutSeconds ayarlanmamış kiracılarda widget konuşmaları 30 dk sessizlikte kapanır (davranış değişikliği — duyurulur).
- Sayaçlar: thread tabanlı raporlar/SLA/AI çözümü/puan değişmez; müşteri profilinde "gün" ve "bağlantı" ayrı.
- Saat enjekte edilebilir (now?: () => Date).
- Aynı gün dönen üye: sabahki ajan çevrimiçi ve kapasitesi varsa ona (ID-02-S5), değilse normal yönlendirme.
- Marka başına ayrı Thread ID (ID-02-S8; tarayıcı depolaması zaten ayırıyor).

KABUL KRİTERLERİ:
- Senaryo 1–10 (05 ID-02 Kabul kriterleri): ilk bağlantı T1/C1 first_of_day; aynı gün dönüş T1 + yeni C2, connections [C1,C2], thread_started gider chat_started gitmez; ertesi gün yeni T2/C3; yenileme/ikinci sekme yeni ID üretmez; gece yarısı kuralı; dünkü sessiz bağlantı day_rollover; yarışta tek T tek C; 23:59/00:01 İstanbul farklı günler; ajan yeniden açma continued_from_chat_id; farklı tarayıcı yeni T.
- Toplam sohbet, AI çözümü, CSAT, SLA ihlali sayıları değişiklik öncesiyle aynı (regresyon).
- Puan aynı gün dönüşteki güncel bağlantıya (C2) yazılır.
- Başka kiracı bu kiracının günlük chat'ini bulamaz (RLS negatif).

KULLANILAN VARSAYIMLAR:
- K1=A, K2 (30 dk, kiracı değiştirebilir), K3.
- ID-02-S5..S8 varsayılanları.
- "Her dönüşte yeni chat" varsayan testlerin güncellenmesi bu görevin parçası.

**Test Strategy:**

customer-chat.test.ts, chats.test.ts senaryoları; rapor regresyonu; webhook testi; tenant-isolation; e2e widget.spec.ts, inbox-reopen.spec.ts, csat.spec.ts güncellenir; `pnpm test:gate` (arka planda) + `pnpm -w test:e2e`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 286.1. DAY-SCHEMA [OPUS-MAX] Contract + migration: chats.local_day/day_tz, threads.opened_via (+CHECK), uq_chat_customer_day kısmi tekil indeks, Chat.connections, webhook thread_started, GET /chats/{id}/events thread_id

**Status:** pending  
**Dependencies:** None  

Yalnız genişletme; eski kayıtlarda local_day NULL ("eski model"). İndeks ayrı migration'da CONCURRENTLY.

### 286.2. DAY-VISITOR-PATH [OPUS-MAX] conversation-day.ts: openOrContinueConnection — ziyaretçi yolu, aynı gün dönüş, day_rollover, yarış

**Status:** pending  
**Dependencies:** 286.1  

resolveLocalDay + openOrContinueConnection; customer.ts bu servisi kullanır; K2 varsayılan 30 dk kapanış.

### 286.3. DAY-AGENT-PATHS [OPUS-MAX] Ajan yolları (POST /chats, resume önceki gün → bugünün chat'i), chat_access ekleme, sayaçlar, audit, listDayConnections kancası

**Status:** pending  
**Dependencies:** 286.2  

resume eski günde continued_from_chat_id; customer-service sayaç "gün/bağlantı"; AI-02 için listDayConnections(tx, chatId, {excludeThreadId}).

### 286.4. DAY-WEB-MOBILE [OPUS-HIGH] Web: günün bütün bağlantıları ayırıcıyla, ThreadHeader Thread ID + aktif Chat ID, "Bugünkü bağlantılar", satırda "N bağlantı"; mobil ayırıcı

**Status:** pending  
**Dependencies:** 286.3  

useInbox yalnız en yeni thread yerine günün bağlantılarını sırayla yükler; ids i18n (#284).

### 286.5. DAY-TEST-MIGRATION [OPUS-HIGH] Mevcut testlerin yeni modele uyarlanması + tam e2e + davranış değişikliği duyurusu (HANDOFF/PLAN)

**Status:** pending  
**Dependencies:** 286.4  

customer-chat.test.ts, widget.spec.ts, csat.spec.ts, inbox-reopen.spec.ts; K2 duyurusu.
