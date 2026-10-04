# Task ID: 154

**Title:** D121-3 — §D121 in üç Should payı: FR-MOD-02.2.1 liste sıralaması · FR-MOD-03.1.2 "Add more channels" CTA · FR-MOD-04.3.2 Teammates arama/filtre

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** GL-10 (tm 143) kapanış turu bu üç PRD kodunu "v1 e kilitlenip hiçbir v1 satırına taşınmayan" pay olarak §D121 e yazdı ve Faz-4 kapsamına ALMADI; §F.3 gereği kullanıcı seçimine bırakıldı. 2026-08-23 denetimi üçünü de kodda tek tek doğruladı: gerçekten yoklar. Üçü de Should önceliğinde, hiçbiri faz kapanışını bloklamaz, her biri bir pencerelik iş. Faz-5 onları kapatır ki PRD kapsamında ismen bilinen açık kalem kalmasın.

**Details:**

BULGU KAYNAĞI: PLAN §D121 (GL-10 turu) + 2026-08-23 denetiminin kod doğrulaması.
Üçü de birbirinden bağımsız; sırayla ya da paralel koşulabilir.

FAZ-5'İN KONUSU: DENETİMİN BULDUĞU YANLIŞ (§D124). Bu faz YENİ ÖZELLİK AÇMAZ — iddia ile kodu
eşitler. Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **D121-3** (PRD kimlikli — FR-MOD-02.2.1 · 03.1.2 · 04.3.2). Gereksinim satırı: `grep -n "| D121-3" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KD121-3" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

Üç alt-görev done; her biri kendi PRD satırını damgalar.
Ölçülebilir: PLAN da 02.2.1 · 03.1.2 · 04.3.2 kodlarının damgalı satırları ✅ (bugün gruplu 🔒 satırlarda saklılar).

## Subtasks

### 154.1. 02.2.1-b [SONNET-XHIGH] Sohbet listesi sıralama kontrolü (Oldest/Newest) — sunucu sort parametresini zaten kabul ediyor, eksik olan yalnız kontrol + URL e yazma

**Status:** done  
**Dependencies:** None  

Ajan gelen kutusunu eskiden yeniye de sıralayabiliyor.

**Details:**

NE YAPILACAK: Inbox liste başlığına sıralama kontrolü (Oldest / Newest) eklenir ve seçim
URL sorgu parametresine yazılır (paylaşılabilir/kalıcı olsun).
SUNUCU DEĞİŞMEZ: apps/api/src/routes/chats.ts listeleme sorgusu sort: z.enum([newest, oldest])
parametresini ZATEN kabul ediyor ve sözleşmede de belgeli (paths/chats.yaml sort parametresi).
Yani bu iş yalnız istemci tarafıdır.

DOSYALAR: apps/web/src/features/inbox/InboxPage.tsx (liste başlığı) · useInbox.ts (sorgu) ·
locales/{en,tr}/inbox.ts · testleri.
REFERANS DESEN: Tickets grid inin sıralama + deep-link davranışı (02.7-a) ve AuditLogPage in
"URL filtrelerin tek doğruluk kaynağıdır" yaklaşımı.

TUZAK: 153.2 sayfalamayı ekliyorsa sıralama değişimi sayfa zincirini SIFIRLAMALI.
İki görev aynı dosyaya dokunuyor — hangisi sonra koşarsa diğerinin davranışını korumalı.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **02.2.1** (PRD — FR-MOD-02.2.1 (Should)). Gereksinim satırı: `grep -n "| 02.2.1" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### K02.2.1" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 154.2. 03.1.2-b [SONNET-XHIGH] Real-time boş durumuna "Add more channels" CTA sı → Settings → Channels derin linki

**Status:** done  
**Dependencies:** None  

Boş trafik ekranı kullanıcıyı kanal eklemeye götürüyor.

**Details:**

NE YAPILACAK: Customers → Real-time (Traffic) ekranının boş durumuna bir eylem düğmesi eklenir;
tıklayınca Settings → Channels a gider. Anlamlı boş durum metni ZATEN var (EK-B.1, tm 30);
eksik olan yalnız kanal ekleme yoluna dönen CTA.

DOSYALAR: apps/web/src/features/traffic/TrafficPage.tsx · apps/web/src/components/EmptyState.tsx
(eylem desteği var mı, yoksa opsiyonel olarak ekle) · locales/{en,tr}.
REFERANS DESEN: depodaki diğer anlamlı boş durumlar (Contacts/Skills/Tickets) ve
Settings → Channels rotasının derin link biçimi.
TUZAK: CTA yalnız kanal eklemeye YETKİSİ olan role gösterilmeli (scope kontrolü) — yetkisiz
kullanıcıya 403 e giden bir düğme gösterme; AuditLogPage in scope nezaket kontrolü emsaldir.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **03.1.2** (PRD — FR-MOD-03.1.2 (Should)). Gereksinim satırı: `grep -n "| 03.1.2" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### K03.1.2" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 154.3. 04.3.2-b [SONNET-XHIGH] Teammates arama kutusu (debounce) + rol/durum/2FA filtresi + filtrelenmiş boş durum

**Status:** done  
**Dependencies:** None  

Kalabalık bir ekipte doğru kişi bulunabiliyor.

**Details:**

NE YAPILACAK: Team → Teammates tablosuna arama kutusu (debounce 250 ms) ve üç filtre eklenir:
rol · durum (routing_status) · 2FA. Tablo bu sütunları ZATEN gösteriyor; eksik olan kontroller.
Filtre sonucu boşsa "eşleşen yok" boş durumu gösterilir (tüm liste boş durumundan farklı metin).

DOSYALAR: apps/web/src/features/team/TeamPage.tsx + testleri · locales/{en,tr}/team.ts.
REFERANS DESEN: CustomersPage.tsx in debounce li arama + segment filtresi (EK-A.2 ortak girdi
davranışları: debounce arama, dropdown) ve components/EmptyState.tsx.

TUZAK: 2FA filtresi 152 (S11-2FA) ile birlikte anlam kazanır — o kalem two_factor_enabled i gerçekten
yazmaya başlar. Bu görev ondan BAĞIMSIZ koşabilir (sütun bugün de var), ama filtrenin bugün her zaman
"kapalı" döneceğini bil ve testini ona göre kur.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **04.3.2** (PRD — FR-MOD-04.3.2 (Should)). Gereksinim satırı: `grep -n "| 04.3.2" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### K04.3.2" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
