# Task ID: 215

**Title:** V8-DEADEND [OPUS-XHIGH] Cagrilmayan uc supurmesi + audit:endpoint-ui'nin metot korlugu (NFR-turetilmis)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** `audit:endpoint-ui` yol bazli sayiyor: POSTu cagrilan bir yolun DELETEi cagrilmasa da "kapsanmis" gorunuyor — tm 213un bulgusu tam bu kor noktadan kacti. Ayrica 14 istemcisiz yolun ikisi gercek yuzey borcu.

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

(a) GEREKCE + KANIT (bu turda olculdu):
`pnpm audit:endpoint-ui` -> "contract paths: 205 · called by web/widget/mobile: 191 · NOT called by
any client: 14". Iki sorun:
1) KOR NOKTA: sayim YOL bazli. `/chats/{chatId}/supervise` listede YOK cunku POSTu cagriliyor —
   ama DELETEi hicbir istemci cagirmiyor (tm 213in bulgusu). Metot bazli sayilsaydi yakalanirdi.
2) 14 yolun IKISI gercek yuzey borcu:
   - `/kb-categories/{categoryId}` — `apps/api/src/routes/kb.ts:386` ve `:416` iki metot
     kaydediyor; istemci tarafinda YALNIZ koleksiyon ucu cagriliyor
     (`KbArticleEditor.tsx:159` POST `/kb-categories`, `KbArticleList.tsx:79` GET). Yani bir
     kategori YARATILABILIYOR ve LISTELENIYOR ama yeniden adlandirilamiyor/silinemiyor.
   - `/reports/access-review` — `apps/api/src/routes/reports.ts` (servis
     `services/reports/access-review.ts`); hicbir istemci cagirmiyor.
   Kalan 12si tasarimi geregi bassiz: `/auth/saml/{connectionId}/acs` · `/scim/v2/*` (4) ·
   `/mcp/tools/{tool}` · `/channels/email/inbound` · `/public/kb/*` (5, SSR/robots/sitemap).
   §D145 emsali: bu sinif "gerekcesiyle listeye yazilip susturulur".
3) `pnpm audit:unpaged-lists` -> `UNPAGED = 1`:
   `apps/web/src/features/developers/WebhookSubscriptions.tsx:87`
   `api.get<AppListResponse>('/settings/apps?category=productivity&limit=100')` — tek istekte
   kapali liste. Ya `usePagedQuery` ile zincirlenir ya ustune `paging-exempt: <neden>` yazilir.

(b) DOKUNULACAK DOSYALAR:
- `scripts/audit/endpoint-ui.cjs` — sayimi (yol) -> (yol + metot) ciftine cek; muafiyet listesi
  gerekceli olsun (bassiz uclar icin `// server-to-server: <neden>` gibi).
- `apps/web/src/features/playbook/KbArticleList.tsx` / `KbArticleEditor.tsx` — kategori
  yeniden adlandir/sil yuzeyi (mevcut uclari cagirir; YENI UC ACILMAZ).
- `/reports/access-review` — ya bir ekrana baglanir ya "yonetim/denetim ucu, konsol yuzeyi yok"
  gerekcesiyle muafiyet listesine yazilir (§D145 emsali; karar gorev icinde verilir).
- `apps/web/src/features/developers/WebhookSubscriptions.tsx` — sayfalama ya da `paging-exempt:`.
- `PLAN.md` §6D satiri + ilgili `#### K` blogu.

(c) SIRA: once betik metot bazina cekilir (yeni sayim CIKTISI kayda gecer) -> cikan yeni olu uclar
listelenir -> her biri ya baglanir ya gerekcelendirilir -> unpaged kalemi kapanir.

(d) BILINEN TUZAKLAR:
- Betigi degistirince cikan sayi BUYUYECEK (metot bazli sayim daha cok bulur). Bu bir REGRESYON
  DEGIL, olcumun duzelmesidir — handoff notunda ONCE/SONRA sayilarini birlikte yaz.
- `/public/kb/*` uclari PRDnin v2 "SEOlu self-servis bilgi bankasi" kalemidir, "pazarlama sitesi"
  DEGIL (§D143/10da ayrica gerekcelendirilmis) — kaldirma.
- `/scim/v2/*` ve SAML ACS dis IdPnin cagirdigi uclardir; istemci beklemek yanlistir.
- `audit:dead-code`in "api servis 6/124 tuketicisiz" ciktisindaki alti dosyanin hepsi
  `package.json` CLI girisidir (`*-run.ts`) — bulgu DEGIL.

(e) KAPSAM SINIRI: yeni uc ACILMAZ · SCIM/SAML/MCP/e-posta-inbound/public-KB yuzeylerine
DOKUNULMAZ · `DELETE /chats/{id}/supervise`in istemcisi tm 213un isidir (bu gorev yalniz betigin
onu GORMESINI saglar).
(f) KAPANIS: DoD kapisi yesil -> commit + push (Conventional Commit; PLAN.md satir damgasi
`◐ → ✅` + `#### K<kod>` bloguna kanit maddesi + HANDOFF.md girisi AYNI commite girer) ->
Task Master `done`. Calisma alanini kirli BIRAKMA.

**Test Strategy:**

Tam DoD kapisi exit 0. Olculebilir kapanis: (1) `pnpm audit:endpoint-ui` YOL+METOT ciftiyle calisiyor ve GEREKCESIZ 0 donuyor (her muaf giris yaninda neden yazili); (2) betik, `DELETE /chats/{chatId}/supervise` istemcisiz oldugu surece onu RAPORLUYOR — bunu kanitlayan bir birim testi veya betigin kendi self-check ciktisi; (3) `pnpm audit:unpaged-lists` -> `UNPAGED = 0`; (4) kb kategori yeniden adlandir/sil yuzeyi eklendiyse web unit + e2e yesil, eklenmediyse gerekce yazili. Ayrica `apps/web` tam suiti `--maxWorkers=4` yesil ve `audit:req-coverage` exit 0.
