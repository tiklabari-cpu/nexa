# Task ID: 153

**Title:** P5-PAGE — Liste sayfalaması istemciye bağlanır: Inbox · transcript · Tickets · Customers · Traffic tek sabit sayfada kesiliyor (NFR-P5 · FR-EK-B.1 · FR-MOD-02.3.1) — §D124 bulgu 2

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Sunucu tarafı kusursuz: dört liste ucu ve transcript ucu opak keyset cursor ile sayfalanıyor, next_page_id dönüyor, sözleşme gerekçesini yazıyor. Panel bu cursor u KULLANMIYOR — sabit bir limit ile tek istek atıp bırakıyor: /chats limit=50 · transcript limit=200 · /tickets limit=50 · /customers limit=50 · /traffic limit=100. Pratik sonucu: 50 den fazla aktif sohbeti olan bir çalışma alanında 51. sohbete ulaşmanın yolu yok, 200 olaydan uzun bir konuşmanın başı görünmüyor. Tohum veriyle asla ortaya çıkmadığı için testler de yeşil kalıyor. Ayrıca PLAN §7.1 EK-B.1 satırı "infinite scroll" için ✅ taşıyor ama kanıtı yalnız VirtualList/Skeleton/EmptyState sayıyor; VirtualList saf penceremedir.

**Details:**

BULGU (2026-08-23 bağımsız denetim · §D124/2): beş çağrı yeri tarandı ve hiçbiri next_page_id okumuyor.
Sayfa zincirlemesi depoda YALNIZ iki yerde gerçekten var: Apps Marketplace ve Audit Log.
Bu bir performans ayarı değil, VERİ KAYBI gibi görünen bir üründür: kullanıcı 51. kaydı hiç göremez.

ZEMİN — SUNUCU HAZIR, PANEL KULLANMIYOR (tahmin etme, oku):
/chats · /tickets · /customers · /traffic ve transcript ucu opak KEYSET cursor ile sayfalanıyor ve
next_page_id dönüyor. Sözleşme gerekçesini de yazıyor: packages/contract/openapi/paths/chats.yaml
içinde "Paginated by opaque keyset cursor rather than offset: an offset page shifts under you every
time a new message arrives". Transcript ucu ayrıca after_event_id ve before_event_id taşıyor.

REFERANS DESEN DEPODA VAR — YENİDEN İCAT ETME:
- apps/web/src/features/audit/AuditLogPage.tsx: useInfiniteQuery + getNextPageParam: (lastPage) =>
  lastPage.next_page_id + query.data.pages.flatMap(...). Sayfa zincirlemesinin kanonik örneği.
- apps/web/src/features/apps/AppsMarketplace.tsx: aynı desen, filtreli sorgu ile.
- apps/web/src/components/VirtualList.tsx: VirtualList + VirtualTable — SAF PENCERELEME, veri getirme
  kancası YOK. Sonsuz kaydırma bugün hiçbir listede yok.

FAZ-5'İN KONUSU: DENETİMİN BULDUĞU YANLIŞ (§D124). Bu faz YENİ ÖZELLİK AÇMAZ — iddia ile kodu
eşitler. Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **P5-PAGE** (türetilmiş — NFR-P5 + FR-EK-B.1 + FR-MOD-02.3.1). Gereksinim satırı: `grep -n "| P5-PAGE" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KP5-PAGE" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

Yedi alt-görev done. Ölçülebilir kapanış kanıtı:
1. e2e: 50 den fazla sohbet ve 200 den uzun bir transcript tohumlanmış durumda ikinci sayfa GERÇEKTEN geliyor.
2. scripts/audit altındaki yeni tarayıcı "sabit limit ile sayfalanmayan liste çağrısı" için 0 bulgu veriyor.
3. PLAN §7.1 EK-B.1 satırının kanıtı artık sonsuz kaydırmayı da içeriyor; §7.2 P5-PAGE "✅ → KP5-PAGE".

## Subtasks

### 153.1. P5-PAGE-a [OPUS-XHIGH] Ortak kanca lib/paged-query.ts (useInfiniteQuery sarmalayıcı) + VirtualList/VirtualTable a onEndReached (eşik + tek-uçuş muhafızı)

**Status:** done  
**Dependencies:** None  

Sayfalama tek bir yerde tanımlı; ekranlar onu tüketiyor.

**Details:**

NE YAPILACAK: iki parça.
1. apps/web/src/lib/paged-query.ts (yeni): useInfiniteQuery üzerine ince bir sarmalayıcı —
   sorgu anahtarı + URL kurucu alır, {items, fetchNext, hasNext, isFetchingNext, ...} döner;
   next_page_id sözleşmesini TEK yerde bilir.
2. VirtualList ve VirtualTable a opsiyonel onEndReached (+ eşik) eklenir: görünür pencere sona
   yaklaşınca bir kez tetiklenir; TEK-UÇUŞ muhafızı olmalı (aynı sayfa iki kez istenmemeli).
Mevcut kullanımlar (AuditLogPage, AppsMarketplace, Contacts/Teammates/Skills/Tickets) BOZULMAMALI —
yeni parametreler opsiyonel.

DOSYALAR: apps/web/src/lib/paged-query.ts (yeni) + testi ·
apps/web/src/components/VirtualList.tsx + VirtualList.test.tsx.
REFERANS: AuditLogPage.tsx in useInfiniteQuery bloğu (kanonik) · AppsMarketplace.tsx.

TUZAKLAR:
1. NFR-P4 bütçesi korunmalı: VirtualList in "10.000 satırda sınırlı DOM düğümü" testi yeşil kalmalı.
2. onEndReached scroll olayında her karede tetiklenmemeli — eşik + isFetchingNext koruması.
3. Bu alt-görev HİÇBİR EKRANI DEĞİŞTİRMEZ; yalnız altyapı + testleri. Ekranlar 153.2-153.6 da.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **P5-PAGE** (türetilmiş — NFR-P5). Gereksinim satırı: `grep -n "| P5-PAGE" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KP5-PAGE" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 153.2. P5-PAGE-b [OPUS-XHIGH] Inbox sohbet listesi sayfalanır (useInbox.ts limit=50) — RTM push ları ile sayfa birleşiminin tutarlılığı

**Status:** done  
**Dependencies:** 153.1  

50 den fazla sohbeti olan bir gelen kutusu tamamen gezilebiliyor.

**Details:**

NE YAPILACAK: apps/web/src/features/inbox/useInbox.ts içindeki useChatList sayfalı hale gelir
(bugün: /chats?view=...&limit=50, tek istek). Liste panelinde sona yaklaşınca sonraki sayfa gelir.

ASIL ZORLUK — BU YÜZDEN OPUS: bu liste CANLI. RTM push ları (yeni sohbet, güncellenen sohbet)
aynı önbelleğe yazıyor ve 30 saniyede bir refetchInterval var. Sayfalı önbellekle bunların
birleşimi tutarlı olmalı:
- Yeni bir sohbet İLK sayfaya girmeli, yüklenmiş sayfalar altından kaymamalı.
- Bir sohbet güncellendiğinde hangi sayfada olursa olsun güncellenmeli (pages.flatMap üzerinde arama).
- refetchInterval sayfalı sorguda yalnız İLK sayfayı tazelemeli, yüklenmiş sayfaları atmamalı.
Keyset cursor un offset e göre tercih edilme gerekçesi tam olarak budur (sözleşme yorumu).

DOSYALAR: apps/web/src/features/inbox/useInbox.ts (useChatList + RTM olay işleyicileri) ·
apps/web/src/features/inbox/InboxPage.tsx (liste paneli) · useInbox.test.tsx.
REFERANS: 153.1 in paged-query kancası · aynı dosyadaki mevcut queryClient.setQueryData
optimistic güncelleme deseni.

TUZAK: bu ekranın e2e kapsaması geniş (inbox-tabs, inbox-unread, inbox-panel spec leri).
Sayfalama eklerken o senaryolar KIRILMAMALI — taban 205 e2e yeşil kalmalı.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **P5-PAGE** (türetilmiş — NFR-P5). Gereksinim satırı: `grep -n "| P5-PAGE" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KP5-PAGE" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 153.3. P5-PAGE-c [OPUS-XHIGH] Transcript ters sonsuz kaydırma (useInbox.ts limit=200): before_event_id ile geriye yürüme + prepend sırasında kaydırma konumunun korunması + skeleton

**Status:** done  
**Dependencies:** 153.1  

Uzun bir konuşmanın başı da okunabiliyor.

**Details:**

NE YAPILACAK: useTranscript bugün /chats/{id}/events?limit=200 ile tek sayfa çekiyor.
NFR-P5 in asıl maddesi "reverse infinite scroll + keyset pagination + skeleton" diyor.
- Transcript in ÜSTÜNE yaklaşınca before_event_id ile bir önceki sayfa yüklenir.
- Yeni içerik BAŞA eklenirken (prepend) kullanıcının okuduğu yer ZIPLAMAMALI:
  yükleme öncesi scrollHeight ölçülür, ekleme sonrası scrollTop farkla telafi edilir.
- Yükleme sırasında üstte skeleton gösterilir.
- Canlı mesaj akışı (RTM ile gelen yeni olaylar SONA eklenir) bozulmamalı; Transcript.tsx in
  mevcut "yalnız dipteyken otomatik kaydır" davranışı korunmalı.

DOSYALAR: apps/web/src/features/inbox/useInbox.ts (useTranscript) ·
apps/web/src/features/inbox/Transcript.tsx (kaydırma yönetimi — pinnedToBottom mantığı burada) ·
Transcript testleri.
SÖZLEŞME: paths/chats.yaml — events ucu after_event_id ve before_event_id taşıyor ve
next_page_id in her iki yönde nasıl kullanılacağını açıklıyor. OKU, tahmin etme.

TUZAKLAR:
1. Sıralama: olay id leri thread + sıra numarası kodluyor (TJ1H8CFKRV_7) — sıralama id den
   çözülebilir, zaman damgası karşılaştırmasına GÜVENME (README "Notable engineering choices").
2. Prepend telafisi yanlışsa kullanıcı her sayfa yüklemesinde yerini kaybeder — bunu bir testle kilitle.
3. Okundu imleci (useMarkSeen) geriye yürürken YANLIŞ tetiklenmemeli: eski olayları görüntülemek
   "seen" ilerletmemeli.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **P5-PAGE** (türetilmiş — NFR-P5 + FR-MOD-02.3.1). Gereksinim satırı: `grep -n "| P5-PAGE" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KP5-PAGE" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 153.4. P5-PAGE-d [SONNET-XHIGH] Tickets grid sayfalanır (useTickets.ts limit=50)

**Status:** done  
**Dependencies:** 153.1  

Ticket listesi 50 kayıtta bitmiyor.

**Details:**

NE YAPILACAK: apps/web/src/features/inbox/useTickets.ts içindeki sorgu 153.1 in paged-query
kancasına taşınır; TicketGrid sona yaklaşınca sonraki sayfayı ister. Mevcut sıralama/deep-link
davranışı (02.7) korunur — sıralama değişince sayfa zinciri SIFIRLANIR (yeni sorgu anahtarı).

DOSYALAR: apps/web/src/features/inbox/useTickets.ts · TicketGrid.tsx · TicketPane.tsx + testleri.
REFERANS: 153.1 kancası · AuditLogPage in filtre değişiminde sorgu anahtarını değiştirme deseni.
TUZAK: total alanı yanıtta var; "N / M" göstergesi eklemek istersen 153.5 in deseniyle tutarlı yap.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **P5-PAGE** (türetilmiş — NFR-P5). Gereksinim satırı: `grep -n "| P5-PAGE" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KP5-PAGE" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 153.5. P5-PAGE-e [SONNET-XHIGH] Customers listesi sayfalanır (CustomersPage.tsx limit=50) + total ile "N / M" göstergesi

**Status:** done  
**Dependencies:** 153.1  

Kişi listesi 50 kayıtta bitmiyor.

**Details:**

NE YAPILACAK: CustomersPage.tsx içindeki useQuery, 153.1 in paged-query kancasına taşınır.
Yanıt zaten {items, total, next_page_id} taşıyor ve tip tanımında next_page_id VAR ama okunmuyor.
Ek olarak listenin başına "gösterilen / toplam" göstergesi konur (total alanı kullanılır).
Arama (debounce, 250 ms) ve segment filtresi değişince sayfa zinciri sıfırlanır.

DOSYALAR: apps/web/src/features/customers/CustomersPage.tsx + testleri · locales/{en,tr}/customers.ts.
REFERANS: 153.1 kancası · aynı dosyadaki mevcut debounce ve seçim-geçerliliği mantığı
(seçili kayıt listeden düşünce seçim temizleniyor — sayfalı listede bu mantık pages.flatMap üzerinden çalışmalı).
TUZAK: seçili müşteri ikinci sayfadaysa deep-link ile açılış hâlâ çalışmalı.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **P5-PAGE** (türetilmiş — NFR-P5). Gereksinim satırı: `grep -n "| P5-PAGE" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KP5-PAGE" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 153.6. P5-PAGE-f [SONNET-XHIGH] Traffic listesi sayfalanır (TrafficPage.tsx limit=100)

**Status:** done  
**Dependencies:** 153.1  

Gerçek zamanlı ziyaretçi listesi 100 kayıtta bitmiyor.

**Details:**

NE YAPILACAK: TrafficPage.tsx içindeki sorgu 153.1 in kancasına taşınır.
Bu liste de canlıdır (sekme sayaçları + periyodik tazeleme) — 153.2 deki ile aynı kural:
tazeleme yalnız ilk sayfayı yeniler, yüklenmiş sayfaları atmaz.

DOSYALAR: apps/web/src/features/traffic/TrafficPage.tsx + testleri.
REFERANS: 153.1 kancası · 153.2 nin canlı-liste kararı (aynı desen, daha basit hâli).
TUZAK: 13.2 nin gelişmiş filtreleri ve ziyaretçi 360 paneli bu ekranda; filtre değişimi zinciri sıfırlamalı.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **P5-PAGE** (türetilmiş — NFR-P5). Gereksinim satırı: `grep -n "| P5-PAGE" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KP5-PAGE" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 153.7. P5-PAGE-g [OPUS-XHIGH] Uçtan uca + nöbetçi: seed e 60 sohbet / 250 olaylı bir konuşma → e2e ikinci sayfayı yürür; scripts/audit altına sayfalanmayan liste çağrısı tarayıcısı

**Status:** done  
**Dependencies:** 153.2, 153.3, 153.4, 153.5, 153.6  

Sayfalama bir insanın yürüdüğü yolla kanıtlanıyor ve geri gelmesi engelleniyor.

**Details:**

NE YAPILACAK: üç iş.
1. TOHUM: apps/api/prisma/seed.ts e sayfalamayı GÖRÜNÜR kılan veri — bir çalışma alanında 60+ sohbet
   ve bir sohbette 250+ olay. Tohum idempotent kalmalı (mevcut "already present, skipping" deseni).
   Var olan e2e senaryolarının saydığı sayılar bozulmamalı — gerekirse veriyi AYRI bir çalışma alanına koy.
2. E2E: ikinci sayfanın gerçekten geldiğini yürüyen senaryolar (Inbox listesi + transcript geriye yürüme).
3. NÖBETÇİ: scripts/audit/ altına yeni bir tarayıcı — web kaynağında sabit limit ile çağrılıp
   next_page_id okunmayan liste çağrısı arar; bulursa listeler. package.json a pnpm audit:<ad> script i,
   scripts/audit/README.md ye satır.

DOSYALAR: apps/api/prisma/seed.ts · apps/e2e/tests/ (mevcut inbox spec ine ek ya da yeni spec) ·
scripts/audit/<yeni>.cjs + README.md · package.json (kök script).
REFERANS: scripts/audit/endpoint-ui.cjs — istemci kaynağını tarayıp sözleşmeyle karşılaştıran mevcut
tarayıcı; yeni nöbetçi onun kardeşidir. README tablosuna aynı biçimde satır ekle.

TUZAKLAR:
1. E2E tohum sıfırlaması (SIYAHTUS_SEED_RESET) tüm süiti etkiler; 60 sohbet eklemek başka spec lerin
   saydığı listeleri bozabilir. Ölç, gerekirse ayrı çalışma alanı kullan.
2. Tarayıcı yanlış-pozitif verebilir (sayfalaması OLMAYAN uçlar da limit alır) — README de bunu yaz,
   endpoint-ui.cjs in "sonucu elle sınıflandır" notu emsaldir.

PLAN İŞİ (kalem burada kapanır): §7.2 P5-PAGE → "✅ → KP5-PAGE"; §7.1 EK-B.1 satırının kanıtı
#### KEK-B.1 (yoksa aç) bloğunda sonsuz kaydırma maddesiyle tamamlanır — satırın damgası ✅ kalır,
ama kanıtı ilk kez iddiasını karşılar. #### KP5-PAGE bloğuna yedi alt-görevin maddesi.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **P5-PAGE** (türetilmiş — NFR-P5 + FR-EK-B.1). Gereksinim satırı: `grep -n "| P5-PAGE" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KP5-PAGE" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
