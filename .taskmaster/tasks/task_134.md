# Task ID: 134

**Title:** 07.8/08.7.7/11.4 — Widget CSAT döngüsü kapanır: sohbeti değerlendir (good/bad) + sohbeti bitir + post-chat formu; Reports Reviews artık gerçek veri gösterir — §D113/K8

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** 2026-08-17 denetimi: `apps/widget/src/api.ts:185 rate()` ve `:189 close()` hiçbir yerden çağrılmıyor — widget’ta değerlendirme kontrolü ve "sohbeti bitir" düğmesi yok; backend `POST /customer/chat/rating` ve `/customer/chat/close` canlı ve testli (`routes/customer.ts:599,620`); `ReportsPage.tsx:829` Reviews/CSAT bölümü "read back from the ratings the widget collects" diyor ama widget hiç toplamıyor → üretimde panel sonsuza kadar "No ratings yet". 08.7.7 forms builder yalnız `pre_chat` yerleşimini teslim etti (K08.7.7); PRD "pre-chat/post-chat" der. Bu görev üç uçlu zinciri kapatır: widget → API → Reports.

**Details:**

BULGU (§D113/K8): `grep -rn "\.rate(\|\.close(" apps/widget/src --include=*.ts | grep -v test` → 0
çağıran (yalnız tanımlar `api.ts:185,189`); widget öğe envanteri (`nx-launcher`, `nx-prechat`,
`nx-attach`, `nx-send`, …) değerlendirme/kapatma kontrolü içermiyor. `grep -rn "post.\?chat" apps/widget/src
apps/api/src` → 0 (yalnız pre_chat: `form_placement='pre_chat'` CHECK'i K08.7.7). Reports 07.8 ✅
(CSAT donut) ama kaynak akış yok — üç uygulama arasında kopuk zincir.
KIRILIM: 134.1 rating UI (SONNET) → 134.2 sohbeti bitir (SONNET) → 134.3 post-chat form (OPUS-XHIGH,
sözleşme+migration+widget) → 134.4 e2e (OPUS-XHIGH). Damgalar (§D114 · 2026-08-17 çelişki denetimi ile GÜNCELLENDİ): 07.8 ve 11.4 satırları ✅ KALIR
(KK'ları rapor/composer payını karşılıyor — koda karşı doğrulandı), AMA 08.7.7 satırı (PLAN.md:560)
artık ◐ → K08.7.7: post_chat depoda hiç yok, satır başlığı "(pre/post-chat)" iki yerleşim vaat ediyor.
134.3 bitince o satır ◐ → ✅ ÇEVRİLİR (bu görevin kapanış işlerinden biri); K bloklarına "widget kaynağı bağlandı"
maddeleri eklenir; §6A tablosunda bu kalem ✅ olur.

FAZ-4'ÜN KONUSU KALEM DEĞİL DİKİŞTİR (§D113): Faz 0–3 kalemleri tek tek ✅ ama bütün, bir kullanıcının
gözünden bir yerde kopuyor. Bu görev o kopukluğu kapatır; kapatırken YENİ bir kalem/özellik AÇMAZ,
mevcut sözleşme + servis + ekranı birbirine bağlar. Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-07.8 Reviews/Ratings (widget kaynağı) · FR-MOD-08.7.7 post-chat form · FR-MOD-11.4 composer/kontroller**. Gereksinim satırı: `grep -n '| 07\.8 ' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K07.8' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.
Bu görev üç PRD koduna dokunur: kapanışta K07.8 (rating kaynağı), K08.7.7 (post_chat yerleşimi), K11.4 yoksa K11.4 aç (sohbeti bitir) — her birine kendi maddesi; tablo damgaları ✅ kalır.
KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

Dört alt-görev `done` olunca; ayrıca `pnpm -w test:e2e` (`widget.spec.ts` + yeni `csat.spec.ts`: ziyaretçi değerlendirir → Reports Reviews'ta görünür, kanıt PNG) · widget/api/web unit + integration yeşil · widget bundle < 50 KB gzip; §6A tablosunda kalem ✅.

## Subtasks

### 134.1. 07.8-b [SONNET-XHIGH] Widget değerlendirme kontrolü: sohbet kapanınca (agent arşivler / auto-close) ve menüden "Rate this chat" → good/bad → POST /customer/chat/rating → teşekkür durumu; i18n; testler

**Status:** done  
**Dependencies:** None  

Ziyaretçi sohbeti değerlendirebilir; rating uç noktası artık gerçek çağıran alır.

**Details:**

NE YAPILACAK: `apps/widget/src/widget.ts`: (a) sohbet kapandığında (widget bunu nasıl öğreniyor —
polling'de chat durumu `archived`/kapalı; `widget.ts:655` polling notu; RTM değil) transcript altına
"Bu sohbet nasıldı?" + 👍/👎 (metin etiketli, a11y: `role=group` + `aria-label`) → `api.rate(value)`
(`api.ts:185`) → "Teşekkürler" durumu; ikinci oylama sunucu kuralına göre (idempotent mi, değiştirilebilir
mi — `routes/customer.ts:620` + `customer-chat.test.ts:598` oku, UI ona uysun); (b) açık sohbette
başlık menüsünden "Rate this chat" (isteğe bağlı erken oy) — sunucu açık sohbette kabul ediyorsa; etmiyorsa
yalnız kapanışta göster ve nedenini yorumla; (c) i18n `apps/widget/src/i18n.ts` (en/tr; 133.13 sonra
diğer dillere taşır — anahtar adlarını onunla çakışmayacak biçimde ver: `rating.*`); (d) `innerHTML`
YASAK (S6 eslint kuralı) — DOM API ile.
NEDEN: §D113/K8 — `rate()` çağıransız; Reports CSAT sonsuza kadar boş.
DOSYALAR: `apps/widget/src/{widget.ts, api.ts (değişmez), i18n.ts, styles}` · `apps/widget/src/*.test.ts`
(+rating: kapanışta görünür · oy → istek gövdesi · teşekkür · a11y adları).
REFERANS: widget'ın mevcut prechat/greeting akışı (`widget.ts:322-395`) · `api.ts` istek deseni ·
`routes/customer.ts:620` rating kuralları.
KK: kapanan sohbette değerlendirme görünür, oy istek atar, teşekkür gösterir; bundle bütçesi (P3) korunur.
KAPSAM DIŞI: yorum metni (PRD "rated good/bad") · Reports tarafı (zaten var).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-07.8 Reviews/Ratings (widget kaynağı) · FR-MOD-08.7.7 post-chat form · FR-MOD-11.4 composer/kontroller**. Gereksinim satırı: `grep -n '| 07\.8 ' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K07.8' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 134.2. 11.4-b [SONNET-XHIGH] Widget "sohbeti bitir": başlık menüsü → onay → POST /customer/chat/close → kapanış durumu (+ değerlendirme daveti); i18n; testler

**Status:** done  
**Dependencies:** 134.1  

Ziyaretçi sohbeti kendisi bitirebilir.

**Details:**

NE YAPILACAK: `widget.ts` başlık alanına menü/düğme "End chat" → onay ("Bu sohbeti bitirmek istiyor
musun?") → `api.close()` (`api.ts:189`, `POST /customer/chat/close`, `routes/customer.ts:599`) →
kapanış durumu ("Sohbet bitti · Yeni sohbet başlat") → 134.1'in değerlendirme bloğu tetiklenir;
kapalıyken composer pasif; yeni sohbet başlatma mevcut akış (token/yeni chat) — ikinci bir yol AÇMA,
widget'ın "yeni mesaj → yeni chat" mantığı neyse onu çağır. i18n `chat.end.*`. a11y: düğme adı, onay
diyaloğu `role=dialog`+odak.
NEDEN: §D113/K8 — `close()` ölü kod; ziyaretçi sohbeti bitiremiyor.
DOSYALAR: `apps/widget/src/{widget.ts, i18n.ts, styles}` + testler.
REFERANS: 134.1'in kapanış durumu · `routes/customer.ts:599` close semantiği (kapalı sohbete mesaj → ?).
KK: menü → onay → istek → kapalı durum; iptal etkisiz; a11y adları.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-07.8 Reviews/Ratings (widget kaynağı) · FR-MOD-08.7.7 post-chat form · FR-MOD-11.4 composer/kontroller**. Gereksinim satırı: `grep -n '| 07\.8 ' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K07.8' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 134.3. 08.7.7-b [OPUS-XHIGH] Post-chat formu: form_placement='post_chat' (sözleşme + migration CHECK genişletme + custom-field-service + Settings forms builder seçeneği + widget kapanışta gösterim → contact’a yazma)

**Status:** done  
**Dependencies:** 134.1, 134.2  

Forms builder’ın "post-chat" yerleşimi uçtan uca gelir (contract-first).

**Details:**

NE YAPILACAK (contract-first sıra): (1) `packages/contract`: `FORM_PLACEMENTS`/`CustomFieldDefinition.
form_placement` enum'una `post_chat` (katkısal) + `/customer/token` yanıtına `post_chat_form` (pre_chat_form
yanında) + `POST /customer/chat/form-response`? — ÖNCE mevcut pre-chat cevabının nasıl yazıldığına bak
(K08.7.7: pre-chat alanı = contact custom-field'ı, cevap yeni chat isteğiyle mi geliyor?); post-chat
cevabı için aynı contact custom-field yazma yolunu kullan (`checkCustomFieldValue` doğrulaması) —
yeni uç yalnız gerekiyorsa; (2) migration: `20260726210000`'ın CHECK'i (`pre_chat` yalnız
`entity='contact'`) → `post_chat` de `contact`; `db:check-drift` temiz; RLS değişmez; (3)
`custom-field-service.ts`: `listPostChatForm`; (4) web Settings forms builder: yerleşim seçici
`pre_chat|post_chat`; (5) widget: kapanışta (134.2/agent arşivi/auto-close) form varsa alanları
göster → gönder → teşekkür; 134.1'in değerlendirmesiyle aynı ekranda (sıra: form → rating);
(6) testler: integration (token yanıtında post_chat_form · cevap contact'a yazılır · doğrulama ·
cross-tenant), web (builder seçici), widget (kapanışta form).
NEDEN: PRD 08.7.7 "pre-chat/post-chat" — yalnız pre_chat teslim edilmişti (K08.7.7 dürüstçe yazmış);
CSAT döngüsünün doğal parçası.
DOSYALAR: `packages/contract/openapi/{components,paths/customer.yaml}` · `packages/types` ·
`apps/api/prisma/migrations/<ts>_post_chat_form` · `schema.prisma` (CHECK) · `services/custom-fields/
custom-field-service.ts` · `routes/customer.ts` · `apps/web/src/features/settings/Forms*.tsx` ·
`apps/widget/src/widget.ts` · testler.
REFERANS: K08.7.7 pre-chat zinciri (tm 51 makinesi) — birebir aynı yol, ikinci yerleşim.
KK (birebir PRD): "En az bir alan; tip validasyon; widget'ta gösterim → contact/ticket'a yazma".
KAPSAM DIŞI: ticket/prospect yerleşimleri (ayrı iş) · e-posta.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-07.8 Reviews/Ratings (widget kaynağı) · FR-MOD-08.7.7 post-chat form · FR-MOD-11.4 composer/kontroller**. Gereksinim satırı: `grep -n '| 07\.8 ' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K07.8' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 134.4. 07.8-c [OPUS-XHIGH] Uçtan uca: e2e csat.spec.ts — ziyaretçi sohbet eder → agent arşivler → ziyaretçi post-chat formu doldurur + 👍 verir → Reports Reviews CSAT donut’ta görünür (kanıt PNG); §6A kalemi ✅

**Status:** done  
**Dependencies:** 134.1, 134.2, 134.3  

Üç uygulamalı zincir Playwright ile kanıtlanır.

**Details:**

NE YAPILACAK: `apps/e2e/tests/csat.spec.ts`: mevcut `demo-flow.spec.ts` akışını (visitor → routing →
agent reply → archive) temel al; arşiv sonrası widget'ta form + rating; ardından agent Reports →
Reviews sekmesi → oy görünür (donut/sayaç) → `kanit/csat-*.png`. Ayrıca ziyaretçinin kendisinin
"End chat" ile bitirdiği varyant. §6A tablosunda kalem ✅; K07.8'e uçtan uca maddesi.
DOSYALAR: `apps/e2e/tests/csat.spec.ts` · `apps/e2e/kanit/csat-*.png` · PLAN.md.
REFERANS: `demo-flow.spec.ts` · `widget.spec.ts` (visitorSends) · `reports.spec.ts`.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-07.8 Reviews/Ratings (widget kaynağı) · FR-MOD-08.7.7 post-chat form · FR-MOD-11.4 composer/kontroller**. Gereksinim satırı: `grep -n '| 07\.8 ' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K07.8' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
