# Task ID: 135

**Title:** 08.5.4/.5/.6-b — Settings → Channels kartları canlı: Messenger / WhatsApp / SMS "Coming soon · Get notified"dan connect/disconnect’e (backend adaptörleri v1’den beri var) — §D113/K9

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** 2026-08-17 denetimi: `Channels.tsx:129-131` Messenger/WhatsApp/SMS kartları `coming_soon` + "Get notified" (yalnız localStorage’a yazar, `persistNotified` :77-83 — kimse bilgilendirilmez), oysa `POST /channels/{messenger|twilio|whatsapp}/connect` uçları ve adaptörleri tm 35’ten beri var ve testli; Instagram (08.5.7-d) ve Telegram (08.5.8-d) kartları canlı. Üç v1 `Must` kanalı için admin konsoldan bağlanamıyor. Bu görev üç kartı Telegram deseniyle canlıya alır ve "Get notified" ölü yolunu kaldırır.

**Details:**

BULGU (§D113/K9): `apps/web/src/features/settings/Channels.tsx:129-131` `comingSoon('messenger'…)`,
`comingSoon('whatsapp'…)`, `comingSoon('sms'…)`; `:136-138 comingSoon()` → `status:'coming_soon', cta:'Get
notified'`; `:77-83 persistNotified` → localStorage. `grep -rn "connectChannel\|/channels/.*/connect" apps/web/src`
→ yalnız instagram (:397) ve telegram (:556). Backend: `services/channels/registry.ts:15-17` üç adaptör,
`channels.yaml:125` connectChannel. Damga notu: 08.5.4-.6 satırları (PLAN.md:551-553) `Must (v1)` ✅ —
KK'ları ("OAuth; mesaj → inbox chat") backend'de karşılandı ve testliydi; eksik olan konsol kartıydı
(dikiş). Satırlar ✅ KALIR; K bloklarına "konsol kartı canlı" maddesi; §6A kalemi ✅ (135.4).
ORTAK (üç kanal alt-görevi için): Desen BİREBİR `apps/web/src/features/settings/Channels.tsx`'in
Telegram kartı (`telegramChannel`, satır ~543-561: durum `/channels` listesinden `connected` ile türetilir,
`useMutation` → `api.post('/channels/<type>/connect', body)` / `.../disconnect`, bağlantı formu modal,
başarı/hata) ve Instagram kartı (~384-402). `comingSoon(...)` çağrısı o kanal için KALDIRILIR;
üçü de kalkınca `comingSoon()` yardımcı fonksiyonu ve "Get notified" CTA'sı ölü kod olur → 135.4 siler
(08.5.1 KK'sındaki "Coming soon/Get notified" durumu, artık gerçekten gelmemiş kanal kalmadığı için
boş küme — K08.5.1'e not). Sunucu/sözleşme DEĞİŞMEZ: connect gövdesi `packages/contract/openapi/paths/
channels.yaml:128-135` açıklamasında (Messenger `code` + `page_id` [+ `page_name`]; Twilio
`account_sid` + `auth_token` + `phone_number`; WhatsApp `waba_id` + `phone_number`); adaptörler
`apps/api/src/services/channels/{messenger,twilio,whatsapp}.ts` `parseConnect` şemaları alan
doğrulamasının kaynağıdır — UI aynı alanları ister. Mock OAuth: Messenger/Instagram'da `code` mock
değişimidir — Instagram kartının yaptığı gibi bir "Connect with Facebook (mock)" düğmesi sahte `code`
üretir; kullanıcıdan `code` yazması İSTENMEZ. Twilio `auth_token` sır: alan `type=password`, yanıt
onu geri göstermez (adaptör saklamıyor — kart da göstermez). Inbox Views grubu (K02.1.4) zaten bağlı
kanalları gösteriyor — doğrula, değişiklik gerekmez. Testler: `Channels.test.tsx` (kart durumu ·
form doğrulama · connect isteği gövdesi · disconnect · hata) — mevcut Telegram testleri emsal.
i18n: tm 133.9 aynı dosyayı çeviriyor olabilir — çakışırsa önce `git log -1 -- Channels.tsx` oku ve
onun `t()` düzenine uy.

FAZ-4'ÜN KONUSU KALEM DEĞİL DİKİŞTİR (§D113): Faz 0–3 kalemleri tek tek ✅ ama bütün, bir kullanıcının
gözünden bir yerde kopuyor. Bu görev o kopukluğu kapatır; kapatırken YENİ bir kalem/özellik AÇMAZ,
mevcut sözleşme + servis + ekranı birbirine bağlar. Kapsam dışına çıkma (CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-08.5.4 Messenger · 08.5.5 Twilio SMS · 08.5.6 WhatsApp (konsol connect kartları) · 08.5.1 kart gridi**. Gereksinim satırı: `grep -n '| 08\.5\.[456]' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K08.5.4' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.
Üç PRD satırı 551-553 hücreleri eski biçimde ("✅ **MOCK adaptör** (tm 35)") — kapanışta §1.2 biçimine getir: `✅ → K08.5.4` vb. ve K bloklarını aç (`#### K08.5.4 — 08.5.4 · Messenger` …) — mevcut hücre metnini K bloğunun ilk maddesi olarak TAŞI (silme).
KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

**Test Strategy:**

Dört alt-görev `done` olunca; `pnpm --filter @siyahtus/web test` (Channels ≥ +9) · `pnpm -w test:e2e` (`channels.spec.ts`: üç kanal bağla → Views grubu → mock inbound → yanıt; kanıt PNG) · typecheck/lint/build; `grep -n "coming_soon\|Get notified" apps/web/src/features/settings/Channels.tsx` = 0 (135.4).

## Subtasks

### 135.1. 08.5.4-b [SONNET-XHIGH] Messenger kartı canlı: "Connect with Facebook (mock)" → page seçimi (page_id/page_name) → POST /channels/messenger/connect → Connected/Disconnect

**Status:** done  
**Dependencies:** None  

Messenger kartı Telegram/Instagram deseniyle bağlanır.

**Details:**

NE YAPILACAK: `Channels.tsx` `comingSoon('messenger'…)` → `messengerChannel(connectedChannels)`:
Instagram kartının mock OAuth deseni (`:384-402`): düğme sahte `code` üretir, küçük form `page_id`
(+ `page_name` opsiyonel) → `api.post('/channels/messenger/connect', {code, page_id, page_name})` →
kart `connected` + adres (page id) + Disconnect. Testler `Channels.test.tsx` (+3).
ORTAK (üç kanal alt-görevi için): Desen BİREBİR `apps/web/src/features/settings/Channels.tsx`'in
Telegram kartı (`telegramChannel`, satır ~543-561: durum `/channels` listesinden `connected` ile türetilir,
`useMutation` → `api.post('/channels/<type>/connect', body)` / `.../disconnect`, bağlantı formu modal,
başarı/hata) ve Instagram kartı (~384-402). `comingSoon(...)` çağrısı o kanal için KALDIRILIR;
üçü de kalkınca `comingSoon()` yardımcı fonksiyonu ve "Get notified" CTA'sı ölü kod olur → 135.4 siler
(08.5.1 KK'sındaki "Coming soon/Get notified" durumu, artık gerçekten gelmemiş kanal kalmadığı için
boş küme — K08.5.1'e not). Sunucu/sözleşme DEĞİŞMEZ: connect gövdesi `packages/contract/openapi/paths/
channels.yaml:128-135` açıklamasında (Messenger `code` + `page_id` [+ `page_name`]; Twilio
`account_sid` + `auth_token` + `phone_number`; WhatsApp `waba_id` + `phone_number`); adaptörler
`apps/api/src/services/channels/{messenger,twilio,whatsapp}.ts` `parseConnect` şemaları alan
doğrulamasının kaynağıdır — UI aynı alanları ister. Mock OAuth: Messenger/Instagram'da `code` mock
değişimidir — Instagram kartının yaptığı gibi bir "Connect with Facebook (mock)" düğmesi sahte `code`
üretir; kullanıcıdan `code` yazması İSTENMEZ. Twilio `auth_token` sır: alan `type=password`, yanıt
onu geri göstermez (adaptör saklamıyor — kart da göstermez). Inbox Views grubu (K02.1.4) zaten bağlı
kanalları gösteriyor — doğrula, değişiklik gerekmez. Testler: `Channels.test.tsx` (kart durumu ·
form doğrulama · connect isteği gövdesi · disconnect · hata) — mevcut Telegram testleri emsal.
i18n: tm 133.9 aynı dosyayı çeviriyor olabilir — çakışırsa önce `git log -1 -- Channels.tsx` oku ve
onun `t()` düzenine uy.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-08.5.4 Messenger · 08.5.5 Twilio SMS · 08.5.6 WhatsApp (konsol connect kartları) · 08.5.1 kart gridi**. Gereksinim satırı: `grep -n '| 08\.5\.[456]' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K08.5.4' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 135.2. 08.5.5-b [SONNET-XHIGH] SMS (Twilio) kartı canlı: account_sid + auth_token (password alanı, geri gösterilmez) + phone_number → connect → Connected/Disconnect

**Status:** done  
**Dependencies:** None  

SMS kartı bağlanır; sır alanı gizli.

**Details:**

NE YAPILACAK: `comingSoon('sms'…)` → `smsChannel(connectedChannels)`: form `account_sid` ·
`auth_token` (`type=password`, `autoComplete=off`) · `phone_number` (E.164 doğrulama — adaptörün
şemasıyla aynı) → `api.post('/channels/twilio/connect', …)` (kanal tipi adı `twilio` — registry anahtarı;
kart adı "SMS"); kart adres = numara; `auth_token` hiçbir yerde geri gösterilmez (yanıt zaten taşımıyor).
Testler (+3).
ORTAK (üç kanal alt-görevi için): Desen BİREBİR `apps/web/src/features/settings/Channels.tsx`'in
Telegram kartı (`telegramChannel`, satır ~543-561: durum `/channels` listesinden `connected` ile türetilir,
`useMutation` → `api.post('/channels/<type>/connect', body)` / `.../disconnect`, bağlantı formu modal,
başarı/hata) ve Instagram kartı (~384-402). `comingSoon(...)` çağrısı o kanal için KALDIRILIR;
üçü de kalkınca `comingSoon()` yardımcı fonksiyonu ve "Get notified" CTA'sı ölü kod olur → 135.4 siler
(08.5.1 KK'sındaki "Coming soon/Get notified" durumu, artık gerçekten gelmemiş kanal kalmadığı için
boş küme — K08.5.1'e not). Sunucu/sözleşme DEĞİŞMEZ: connect gövdesi `packages/contract/openapi/paths/
channels.yaml:128-135` açıklamasında (Messenger `code` + `page_id` [+ `page_name`]; Twilio
`account_sid` + `auth_token` + `phone_number`; WhatsApp `waba_id` + `phone_number`); adaptörler
`apps/api/src/services/channels/{messenger,twilio,whatsapp}.ts` `parseConnect` şemaları alan
doğrulamasının kaynağıdır — UI aynı alanları ister. Mock OAuth: Messenger/Instagram'da `code` mock
değişimidir — Instagram kartının yaptığı gibi bir "Connect with Facebook (mock)" düğmesi sahte `code`
üretir; kullanıcıdan `code` yazması İSTENMEZ. Twilio `auth_token` sır: alan `type=password`, yanıt
onu geri göstermez (adaptör saklamıyor — kart da göstermez). Inbox Views grubu (K02.1.4) zaten bağlı
kanalları gösteriyor — doğrula, değişiklik gerekmez. Testler: `Channels.test.tsx` (kart durumu ·
form doğrulama · connect isteği gövdesi · disconnect · hata) — mevcut Telegram testleri emsal.
i18n: tm 133.9 aynı dosyayı çeviriyor olabilir — çakışırsa önce `git log -1 -- Channels.tsx` oku ve
onun `t()` düzenine uy.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-08.5.4 Messenger · 08.5.5 Twilio SMS · 08.5.6 WhatsApp (konsol connect kartları) · 08.5.1 kart gridi**. Gereksinim satırı: `grep -n '| 08\.5\.[456]' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K08.5.4' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 135.3. 08.5.6-b [SONNET-XHIGH] WhatsApp kartı canlı: waba_id + phone_number → connect → Connected/Disconnect

**Status:** done  
**Dependencies:** None  

WhatsApp kartı bağlanır.

**Details:**

NE YAPILACAK: `comingSoon('whatsapp'…)` → `whatsappChannel(connectedChannels)`: form `waba_id` +
`phone_number` → `api.post('/channels/whatsapp/connect', …)`; adres = numara; testler (+3).
ORTAK (üç kanal alt-görevi için): Desen BİREBİR `apps/web/src/features/settings/Channels.tsx`'in
Telegram kartı (`telegramChannel`, satır ~543-561: durum `/channels` listesinden `connected` ile türetilir,
`useMutation` → `api.post('/channels/<type>/connect', body)` / `.../disconnect`, bağlantı formu modal,
başarı/hata) ve Instagram kartı (~384-402). `comingSoon(...)` çağrısı o kanal için KALDIRILIR;
üçü de kalkınca `comingSoon()` yardımcı fonksiyonu ve "Get notified" CTA'sı ölü kod olur → 135.4 siler
(08.5.1 KK'sındaki "Coming soon/Get notified" durumu, artık gerçekten gelmemiş kanal kalmadığı için
boş küme — K08.5.1'e not). Sunucu/sözleşme DEĞİŞMEZ: connect gövdesi `packages/contract/openapi/paths/
channels.yaml:128-135` açıklamasında (Messenger `code` + `page_id` [+ `page_name`]; Twilio
`account_sid` + `auth_token` + `phone_number`; WhatsApp `waba_id` + `phone_number`); adaptörler
`apps/api/src/services/channels/{messenger,twilio,whatsapp}.ts` `parseConnect` şemaları alan
doğrulamasının kaynağıdır — UI aynı alanları ister. Mock OAuth: Messenger/Instagram'da `code` mock
değişimidir — Instagram kartının yaptığı gibi bir "Connect with Facebook (mock)" düğmesi sahte `code`
üretir; kullanıcıdan `code` yazması İSTENMEZ. Twilio `auth_token` sır: alan `type=password`, yanıt
onu geri göstermez (adaptör saklamıyor — kart da göstermez). Inbox Views grubu (K02.1.4) zaten bağlı
kanalları gösteriyor — doğrula, değişiklik gerekmez. Testler: `Channels.test.tsx` (kart durumu ·
form doğrulama · connect isteği gövdesi · disconnect · hata) — mevcut Telegram testleri emsal.
i18n: tm 133.9 aynı dosyayı çeviriyor olabilir — çakışırsa önce `git log -1 -- Channels.tsx` oku ve
onun `t()` düzenine uy.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-08.5.4 Messenger · 08.5.5 Twilio SMS · 08.5.6 WhatsApp (konsol connect kartları) · 08.5.1 kart gridi**. Gereksinim satırı: `grep -n '| 08\.5\.[456]' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K08.5.4' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 135.4. 08.5-c [OPUS-XHIGH] Uçtan uca: e2e channels.spec.ts — üç kanalı bağla → Inbox Views grubunda görünür → mock inbound mesaj → yanıt; comingSoon()/"Get notified" ölü yolu silinir; K08.5.1 notu; §6A kalemi ✅

**Status:** done  
**Dependencies:** 135.1, 135.2, 135.3  

Üç kanalın konsoldan bağlanıp mesaj akıttığı Playwright ile kanıtlanır; ölü CTA kaldırılır.

**Details:**

NE YAPILACAK: (a) `apps/e2e/tests/channels.spec.ts`: Settings → Channels → üç kart bağla → Inbox
Views grubunda üç görünüm → mock inbound (`POST /channels/{type}/messages` webhook'u — telegram.spec/
instagram.spec'in yaptığı gibi) → agent yanıtlar → outbound kaydı (kanıt PNG); (b) `Channels.tsx`:
`comingSoon()` + `persistNotified` + "Get notified" CTA + `coming_soon` durumu (tip birliğinde kalabilir
ama üretici yoksa sil) KALDIRILIR — 08.5.1 KK'sındaki "Coming soon/Get notified" durumu için K08.5.1'e
not: "gelmemiş kanal kalmadı; durum boş küme, kod kaldırıldı — yeni bir kanal duyurulacaksa geri
gelir"; testleri güncelle; (c) §6A tablosunda kalem ✅.
DOSYALAR: `apps/e2e/tests/channels.spec.ts` · `kanit/channels-*.png` · `Channels.tsx` (+test) · PLAN.md.
REFERANS: `apps/e2e/tests/{telegram,instagram}.spec.ts`.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **FR-MOD-08.5.4 Messenger · 08.5.5 Twilio SMS · 08.5.6 WhatsApp (konsol connect kartları) · 08.5.1 kart gridi**. Gereksinim satırı: `grep -n '| 08\.5\.[456]' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### K08.5.4' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
