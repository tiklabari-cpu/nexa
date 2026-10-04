# Task ID: 218

**Title:** V8-INBOX-CHAN [OPUS-XHIGH] Kanal gorunumleri gercek gorunum olsun — /chats kanal filtresi (FR-MOD-02.1.4)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Inbox Views grubundaki kanal satirlari birer `<Link to='/app/settings'>`: tiklayinca orta liste kanala gore SUZULMUYOR, Ayarlar'a gidiyor. /chats sorgu semasinda kanal parametresi de yok, yani suzme sunucuda da mumkun degil.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1; git akisi §2; handoff bicimi §4. Sinirlar `CLAUDE.md`.
Bu gorev PLAN.md §6D (FAZ 8 — Kalan Gereksinim Borclari, §D149) kaleminin Task Master karsiligidir.
DIKKAT: PLAN.md ~2,3 MB — BASTAN SONA OKUMA. Hedef satiri `grep -n` ile bul, cevresindeki ~30
satiri oku. Kanit metni tablo hucresinde DEGIL, `## K. Kanit Gecmisi` altindaki `#### K<kod>`
blogundadir (CONVENTIONS §1.2) — ve gecerli olan blogun SON maddesidir, ortadaki `◐` glifleri
tarihcedir.
KAYITLI KARAR ARAMASI (§D149un dersi): damgayi degistirmeden once `grep -n "D1[0-9][0-9] (" PLAN.md`
ile ilgili kodu ara ve `git log --oneline --since=2026-08-30` ile denetimden SONRA is yapilmis mi bak.
NUMARALANDIRMA: bu faz **8**dir — `Faz-7` §7Cnindir (tm 175-184). Onek `V8-`, `V7-` KULLANMA.

(a) GEREKCE + KANIT:
PRD `:503`: "Views grubu — WhatsApp/Messenger/Twilio SMS KANAL GORUNUMLERI + 'My recent chats' +
kullanici-tanimli custom views" · KK: "Kanal bagli degilse channel-promo; custom saved views
eklenebilir".
Kod: `apps/web/src/features/inbox/InboxPage.tsx:891` ve `:902` -> `to="/app/settings"`.
Sozlesme: `grep -n "channel" packages/contract/openapi/paths/chats.yaml` -> `view` enumunda
(`all/my/queued/unassigned/supervised/archived/ai/ai_solved`) kanal YOK, sorgu parametresi olarak
kanal YOK. Yani filtre backendde de mumkun degil.
`#### K02.1.4` (PLAN.md ~6052) denetim maddesi ayni: "Kanal gorunumleri gercek bir gorunum degil:
her satir <Link to='/app/settings'> ... /chats sorgu semasinda kanal filtresi parametresi de yok".
DIKKAT: KKnin "kanal bagli degilse channel-promo" yarisi KARSILANMIS durumda ve KORUNACAK.

(b) DOKUNULACAK DOSYALAR:
- `packages/contract/openapi/paths/chats.yaml` — `GET /chats`e `channel` filtresi.
- `packages/contract` uretimi + `packages/types` kanal sozlugu (mevcut kanal enumunu YENIDEN
  KULLAN, ikincisini yazma).
- `apps/api/src/routes/chats.ts` + `apps/api/src/services/chat/chat-service.ts` — sorgu.
- `apps/web/src/features/inbox/InboxPage.tsx` (kanal satirlari) · `useInbox.ts:57`
  (`/chats?view=...&sort=...&limit=...` URL kurucusu) · `views.ts`.
- `apps/mobile` parite testi: `packages/contract` yol SAYISI degismiyorsa dokunma; DEGISIYORSA
  mobil parite sayacini yorumla birlikte bump et (bilinen tuzak).

(c) CONTRACT-FIRST SIRA: sozlesme -> `contract:generate` -> backend + integration ->
web + unit -> e2e.

(d) BILINEN TUZAKLAR:
- `view` ve `channel` DIK eksenlerdir: `view=my&channel=whatsapp` anlamli olmali. Kanali `view`
  enumuna EKLEME — sayaclar, kayitli gorunumler ve `views.ts` sozlugu `view` uzerinden calisiyor.
- Sekme rozetleri sunucunun `total`ina bagli (tm 179.4 · M-COUNT-d): filtre eklenince rozet
  AYNI filtreyi gormeli, yoksa "yuklenen pencere gercek toplam sanilir" kusuru geri gelir.
- Kanal bagli DEGILSE davranis DEGISMEZ (channel-promo, dashed CTA -> Settings->Channels).
- Custom saved views (base view + real-time) mekanizmasina dokunma; kanal onun bir EKSENI olabilir
  ama bu gorev onu genisletmez.

(e) KAPSAM SINIRI: custom saved views semasi DEGISMEZ · kanal baglama/ayar ekranlari DEGISMEZ ·
"My recent chats" DEGISMEZ · Instagram/diger kanal adaptorleri DEGISMEZ (mock kalir).
(f) KAPANIS: DoD kapisi yesil -> commit + push (Conventional Commit; PLAN.md satir damgasi
`◐ → ✅` + `#### K<kod>` bloguna kanit maddesi + HANDOFF.md girisi AYNI commite girer) ->
Task Master `done`. Calisma alanini kirli BIRAKMA.

**Test Strategy:**

Tam DoD kapisi exit 0, `contract:generate` sonrasi `git status --short packages/contract/src/generated` BOS · `audit:req-coverage` exit 0 ve `FR-MOD-02.1.4` site sayisi ARTMIS. Integration (`apps/api`): (1) `GET /chats?channel=<x>` yalniz o kanalin sohbetlerini doner; (2) `view` ile BIRLIKTE calisir (`view=my&channel=...` kesisim); (3) bilinmeyen kanal degeri 400; (4) `total` sayaci FILTRELENMIS toplami doner (tm 179.4 regresyonu); (5) cross-tenant negatif ZORUNLU. Birim (`apps/web`): kanal satiri artik gorunum degistiriyor (Settings'e GITMIYOR) · kanal bagli degilken channel-promo davranisi DEGISMEDI (regresyon) · rozet filtreli toplami gosteriyor. e2e: kanal gorunumune gecis + liste daralmasi (kanit PNG). `apps/mobile` parite testi yesil (yol sayisi degistiyse yorumla bumplandi).
