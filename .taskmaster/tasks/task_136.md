# Task ID: 136

**Title:** M-UI-GAP — İstemcisiz dört uç ekranını kazanır: /settings/chat-timeout (08.7.3 formu) · /agents/{id}/role (rol değiştirme) · /chats/{id}/seen (okundu) · /onboarding/state (sihirbaz devam) — §F.2/4 kaydı

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** GL-9 (tm 126) §F.1/7 ölü-kod taraması 183 sözleşme yolundan 7’sinin hiçbir istemci çağıranı olmadığını buldu; üçü tasarım gereği makine tarafından tüketilir (/audit-log/export, /reports/access-review, /billing/entitlements — mobil 13.7-o entitlements’ı çağırdı), DÖRDÜ gerçek ekran boşluğu: `/settings/chat-timeout` (08.7.3 idle auto-close ayarının UI’sı yok — sweep var, ayar sadece API’den), `/agents/{agentId}/role` (rol değişimi konsoldan yapılamıyor), `/chats/{chatId}/seen` (okundu imleci sunucuya hiç yazılmıyor), `/onboarding/state` (sihirbaz ilerlemeyi okumuyor). §F.2 raporu bunları "M-UI-GAP" adıyla aday göstermişti; bu görev dördünü kapatır.

**Details:**

BULGU (HANDOFF tm 126 §F.1/7 · §D113/K10): sözleşmede belgeli, sunucuda sunulan, testli — ama hiçbir
istemcinin çağırmadığı dört uç. Her biri küçük ve bağımsız (dört SONNET/OPUS nanotask). Damgalar:
ilgili PRD satırları ✅ kalır (08.7.3 "idle auto-close sweep" ✅ idi — UI payı eklenir), K bloklarına
madde; PLAN §7.2 `M-UI-GAP` satırı bu turda `⬜ → KM-UI-GAP`; dördü bitince `✅` (136.4).
Sözleşme/sunucu DEĞİŞMEZ (dört uç zaten var) — yalnız web istemcisi + testler.

FAZ-4'ÜN KONUSU KALEM DEĞİL DİKİŞTİR (§D113): Faz 0–3 kalemleri tek tek ✅ ama bütün, bir kullanıcının
gözünden bir yerde kopuyor. Bu görev o kopukluğu kapatır; kapatırken YENİ bir kalem/özellik AÇMAZ,
mevcut sözleşme + servis + ekranı birbirine bağlar. Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-UI-GAP (türetilmiş — §F.1/7 "UI’ı olmayan endpoint": FR-MOD-08.7.3 · 04.x rol · 02.2.2 unread · 00.x onboarding)**. Gereksinim satırı: `grep -n '| M-UI-GAP' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-UI-GAP' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

Dört alt-görev `done`; `pnpm --filter @siyahtus/web test` (+≥12) · e2e ilgili spec'lerde +1'er senaryo · typecheck/lint/build; `scripts/audit/endpoint-ui.cjs` (tm 132.4 taşıdıysa; yoksa `.audit-tm126/endpoint-ui.cjs`) çıktısında dört yol artık "istemcisi var"; PLAN §7.2 `M-UI-GAP` `✅ → KM-UI-GAP`.

## Subtasks

### 136.1. M-UI-GAP-a [SONNET-XHIGH] Settings → Inbox araçları: "Chat timeout" formu (GET/PUT /settings/chat-timeout; pozitif süre ya da kapalı) — 08.7.3 UI payı

**Status:** done  
**Dependencies:** None  

Idle auto-close penceresi konsoldan ayarlanabilir.

**Details:**

NE YAPILACAK: `apps/web/src/features/settings/ChatTimeout.tsx` (yeni): `GET /settings/chat-timeout`
→ `chat_timeout_seconds | null`; form: "Boşta sohbetleri otomatik kapat" anahtarı + süre (dakika/saat
seçici; sunucu saniye ister, ≤ 30 gün) → `PUT`; `lib/form.tsx` primitifi (EK-A.1) + dirty-guard;
SettingsPage'in Inbox araçları bölümüne bağla (Canned/Tags yanına). Sözleşme `paths/settings.yaml:1000-`.
Testler: yükle · kapalı → aç → PUT gövdesi · geçersiz süre alan-altı hata · sunucu hatası.
DOSYALAR: `features/settings/{ChatTimeout.tsx, ChatTimeout.test.tsx, SettingsPage.tsx}`.
REFERANS: aynı dosyadaki benzer tekil-ayar formları (ör. transcripts/sales tracker bölümleri).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-UI-GAP (türetilmiş — §F.1/7 "UI’ı olmayan endpoint": FR-MOD-08.7.3 · 04.x rol · 02.2.2 unread · 00.x onboarding)**. Gereksinim satırı: `grep -n '| M-UI-GAP' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-UI-GAP' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 136.2. M-UI-GAP-b [OPUS-XHIGH] Team: rol değiştirme (PUT /agents/{agentId}/role) — owner/admin kapısı, ayrıcalık tavanı, kendi rolünü değiştirememe; audit satırı görünür

**Status:** done  
**Dependencies:** None  

Rol değişimi konsoldan yapılabilir; sunucunun tavan kuralları UI’da da dürüstçe yansır.

**Details:**

NE YAPILACAK: `features/team/TeamPage.tsx` satır menüsüne "Change role" → rol seçici (sunucu kuralı:
çağıranın rolü ≤ tavan; kendi rolü ve owner rolü seçilemez — `agents.yaml:226-250` açıklaması) →
`PUT /agents/{agentId}/role` → liste güncellenir; 403/validation ADR-06 tipinden dürüst mesaj; audit
ekranında `agent.role_changed` (C6-a2 eklediyse) görünür. OPUS: yetki sınırına dokunan UI — sunucu
kuralını UI'da YENİDEN uygulama (sunucu tek doğruluk), yalnız seçenekleri filtrele ve reddi göster.
Testler: seçenek filtreleme (admin owner'ı seçemez · kendi satırında menü yok) · PUT gövdesi · 403 mesajı.
DOSYALAR: `features/team/{TeamPage.tsx, RoleMenu.tsx?, *.test.tsx}`.
REFERANS: `features/team/TeamPage.tsx` mevcut suspend/expertise menüleri · `routes/agents.ts` rol kuralı.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-UI-GAP (türetilmiş — §F.1/7 "UI’ı olmayan endpoint": FR-MOD-08.7.3 · 04.x rol · 02.2.2 unread · 00.x onboarding)**. Gereksinim satırı: `grep -n '| M-UI-GAP' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-UI-GAP' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 136.3. M-UI-GAP-c [SONNET-XHIGH] Inbox: okundu imleci — sohbet açılınca/yeni olay görüntülenince POST /chats/{chatId}/seen; unread rozeti sunucu gerçeğiyle (yeniden yükle → korunur)

**Status:** done  
**Dependencies:** None  

Okunmadı durumu artık sunucuda tutulur; sekme/yeniden yükleme okunmuşu unutmaz.

**Details:**

NE YAPILACAK: `features/inbox/useInbox.ts`: seçili sohbette son görünen olayın zamanı değişince
(debounce 1 s) `POST /chats/{chatId}/seen {seen_up_to}` (`chats.yaml:445-462`); liste yanıtı
`last_seen_at`/unread alanı taşıyorsa rozet ONDAN türetilir (yerel-yalnız hesap kalkar; sunucu alanı
yoksa mevcut yerel hesap KALIR ve K'ye not düşülür — sözleşme değişmez); yeniden yükleyince okunmuş
sohbet okunmuş kalır. Testler: seen isteği doğru zamanla · debounce · başka sohbete geçince gönderim ·
hata sessiz (best-effort).
DOSYALAR: `features/inbox/{useInbox.ts, InboxPage.tsx?, *.test.ts(x)}`.
REFERANS: `useInbox.ts` mevcut unread mantığı · `routes/chats.ts` seen semantiği (`last_seen_at` tek satır).
KAPSAM DIŞI: mobil (ayrı not: tm 128 sonrası mobil ChatScreen için aynı çağrı — K bloğuna aday yaz).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-UI-GAP (türetilmiş — §F.1/7 "UI’ı olmayan endpoint": FR-MOD-08.7.3 · 04.x rol · 02.2.2 unread · 00.x onboarding)**. Gereksinim satırı: `grep -n '| M-UI-GAP' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-UI-GAP' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 136.4. M-UI-GAP-d [SONNET-XHIGH] Onboarding sihirbazı GET /onboarding/state okur (kaldığı adımdan devam; sample data durumu) + Home checklist aynı kaynaktan; PLAN satırı ✅

**Status:** done  
**Dependencies:** 136.1, 136.2, 136.3  

Sihirbaz ilerlemeyi sunucudan okur; M-UI-GAP satırı kapanır.

**Details:**

NE YAPILACAK: `features/onboarding/OnboardingWizard.tsx` açılışta `GET /onboarding/state`
(`onboarding.yaml:10-28`: completed/skipped + sample data) → tamamlanmışsa yönlendir, değilse
adım/sample-data durumunu göster; `features/home/HomePage.tsx` checklist'i (13.1) aynı state'i
kullanıyorsa tekilleştir (iki kaynak olmasın). Testler (+3). PLAN §7.2 `M-UI-GAP` → `✅ → KM-UI-GAP`;
`endpoint-ui` denetim script'i çıktısı HANDOFF'a (dört yol artık çağrılıyor).
DOSYALAR: `features/onboarding/*` · `features/home/*` · PLAN.md.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-UI-GAP (türetilmiş — §F.1/7 "UI’ı olmayan endpoint": FR-MOD-08.7.3 · 04.x rol · 02.2.2 unread · 00.x onboarding)**. Gereksinim satırı: `grep -n '| M-UI-GAP' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-UI-GAP' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
