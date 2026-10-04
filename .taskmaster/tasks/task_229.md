# Task ID: 229

**Title:** V8-APPS-FILTER [SONNET-XHIGH] Marketplace filtre taksonomisi — koleksiyonlar + odeme/yerlesim filtreleri (FR-MOD-09.1)

**Status:** done

**Dependencies:** None

**Priority:** low

**Description:** Kabul kriterinin kart->OAuth->sohbet-ici-veri ayagi tamamen karsilanmis; eksik olan PRD'nin saydigi taksonomi: koleksiyonlar (By Text/AI-Powered/New/Staff Picks) ve kategori/odeme/yerlesim filtreleri. listQuery yalniz query + category tasiyor.

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
PRD `:664`: "Entegrasyon kartlari gridi — OAuth app dizini; KOLEKSIYONLAR (By Text/AI-Powered/New/
Staff Picks); KATEGORI/ODEME/YERLESIM FILTRELERI + arama" · KK: "Kart -> izin/OAuth akisi;
baglaninca veri sohbet icinde (Details/Copilot)".
Kod `apps/api/src/routes/apps.ts:33-38`:
  `const listQuery = z.object({ query: ..., category: z.enum(APP_CATEGORIES).optional(),
     limit: ..., page_id: ... });`
= yalniz arama + kategori. Koleksiyon/odeme/yerlesim ekseni YOK.
`#### K09.1` (PLAN.md ~6188) denetim maddesi: "Kabul kriteri (kart -> izin/OAuth akisi; baglaninca
veri sohbet icinde) TAMAMEN KARSILANMIS: ConsentDialog izinleri listeliyor, Authorize
start->callback calistiriyor, GET /chats/:chatId/apps sohbet ici veriyi donduruyor. Eksik olan
filtre taksonomisi: listQuer[y]…". PLAN satiri 663, `Should (v1)`.

(b) DOKUNULACAK DOSYALAR:
- `packages/types/src/apps.ts` — `APP_CATALOG` (102+ kart), `APP_CATEGORIES`, `APP_PROVIDERS`.
  Koleksiyon/odeme/yerlesim alanlari buraya eklenir (grid + servis + test TEK KAYNAK).
- `apps/api/src/routes/apps.ts` `listQuery` + `apps/api/src/services/.../app-service.ts` `list`.
- `packages/contract/openapi/paths/` — sorgu parametreleri.
- `apps/web/src/features/settings/AppsMarketplace.tsx` — grid kontrolleri
  (`useInfiniteQuery` + `VirtualList` KORUNUR).

(c) CONTRACT-FIRST SIRA: katalog alanlari (`@siyahtus/types`) -> sozlesme sorgu parametreleri ->
backend + integration -> `contract:generate` -> web + unit -> e2e.

(d) BILINEN TUZAKLAR:
- KART SAYISI ve kanal capraz-bagi DEGISMEZ: `isChannelApp` -> connect reddi + karttan Channels
  linki (tm 202.1/202.2'nin isi) REGRESYON yesil kalmali.
- `provider: 'api_key'` artik bir DAVRANIS (tm 202.1): `POST /settings/apps/{appId}/connect` vs
  `oauthStart` birbirini REDDEDIYOR. "Odeme/yerlesim" filtresi bu ayrimla KARISTIRILMAMALI.
- Sayfalama zaten var (`limit` + `page_id`); yeni eksenler sayfalamayi BOZMAMALI (cursor
  filtreye duyarli olmali, yoksa sayfa 2 yanlis kume doner).
- 102+ karta yeni zorunlu alan eklersen HEPSINI doldurman gerekir — alani opsiyonel yap ya da
  varsayilan ver, yoksa `apps.test.ts` (types) topluca kirilir.
- Yeni OpenAPI YOLU eklemiyorsan mobil parite sayaci degismez; ekliyorsan bump et.

(e) KAPSAM SINIRI: OAuth/api_key baglanma akislari DEGISMEZ · katalog kart SAYISI degismez ·
Zapier/Make (09.4) DEGISMEZ · sohbet-ici veri (Details/Copilot) DEGISMEZ.
(f) KAPANIS: DoD kapisi yesil -> commit + push (Conventional Commit; PLAN.md satir damgasi
`◐ → ✅` + `#### K<kod>` bloguna kanit maddesi + HANDOFF.md girisi AYNI commite girer) ->
Task Master `done`. Calisma alanini kirli BIRAKMA.

**Test Strategy:**

Tam DoD kapisi exit 0, `contract:generate` sonrasi beklenmeyen diff YOK · `audit:req-coverage` exit 0 ve `FR-MOD-09.1` site sayisi ARTMIS. Integration (`apps.test.ts`): (1) her yeni eksen TEK BASINA suzuyor; (2) eksenler BIRLIKTE kesisiyor (koleksiyon + kategori + arama); (3) bilinmeyen deger 400; (4) SAYFALAMA filtreyle tutarli — sayfa 2 ayni kumeyi surduruyor (cursor filtreye duyarli); (5) cross-tenant (katalog statik olsa da kurulum durumu lisans kapsamli). Types: `apps.test.ts` 102+ kartin HEPSI icin yeni alanlar gecerli (zorunlu alan eklendiyse hepsi dolu). Web unit: `AppsMarketplace` kontrolleri + `VirtualList` ve `useInfiniteQuery` REGRESYON yesil. e2e: `apps.spec.ts` koleksiyon secimi listeyi daraltiyor (kanit PNG).
