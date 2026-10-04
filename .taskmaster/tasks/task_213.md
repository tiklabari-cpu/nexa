# Task ID: 213

**Title:** V8-SUPERVISE-OFF [SONNET-XHIGH] Gozetimi birakma yuzeyi — DELETE /chats/{id}/supervise cagrilmiyor (FR-MOD-02.1.1)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Bir temsilci bir sohbeti gozetlemeye baslayabiliyor ama VAZGECEMIYOR: uc kontratta ve APIde var, hicbir istemci cagirmiyor. Tek cikis sohbetin kapanmasi. `#### K02.1.1`in kendi `ⓘ` maddesi bunu yazmis ama gorevlesmemis.

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
`#### K02.1.1` (PLAN.md ~7917) son maddesi: "ⓘ Kalan borc (bu kalemin kapanisini engellemiyor, ayri
bir is): gozetimi BIRAKMA yuzeyi yok — `DELETE /chats/{chatId}/supervise` ucu var ama hicbir istemci
cagirmiyor". Bu turda koda karsi DOGRULANDI:
- Kontrat: `packages/contract/openapi/paths/chats.yaml` `supervise:` blogunda `post:` VE `delete:`
  ikisi de tanimli.
- API: `apps/api/src/routes/chats.ts:399` (POST -> `supervisions.register`) ve `:414`
  (DELETE -> `supervisions.release`, 204 doner).
- Istemci: `grep -rn "/supervise" apps/web/src` -> TEK cagri `apps/web/src/features/traffic/
  TrafficPage.tsx:395` `api.post(\`/chats/${chatId}/supervise\`)`. DELETE cagiran YOK.
NOT: `pnpm audit:endpoint-ui` bunu GOREMEZ cunku sayimi YOL bazlidir, metot bazli degil — yolun
POSTu cagrildigi icin "kapsanmis" gorunuyor. O kor nokta tm 215in isidir.

(b) DOKUNULACAK DOSYALAR:
- `apps/web/src/features/traffic/TrafficPage.tsx` — satir aksiyonlari (`rowActions.ts` sozlugu +
  `:201` etiket haritasi + `:395` mevcut mutation). Emsal: mevcut `supervise` mutationinin AYNISI.
- `apps/web/src/features/traffic/rowActions.ts` (+ `.test.ts`) — aksiyonun gorunurluk kurali.
- `apps/web/src/locales/{en,tr}/customers.ts` — `traffic.action.superviseChat` zaten var
  (`:164` / `:155`); yaninda "stop supervising" karsiligi eklenir. YENI BILESEN i18n listesine
  eklenirse `i18n-coverage.test.ts` `TRANSLATED_FILES`ini de guncelle.
- Opsiyonel: `apps/web/src/features/inbox/InboxPage.tsx` `Supervised` gorunumu.
- Yeni uc / migration / sozlesme degisikligi YOK.

(c) CONTRACT-FIRST SIRA: sozlesme ZATEN dogru — bu gorev yalniz istemci ayagidir.
Sira: rowActions kurali -> mutation -> etiket/i18n -> test -> e2e.

(d) BILINEN TUZAKLAR:
- `supervise` bir HEARTBEATtir: ayni ajanin ikinci POSTu `last_seen_at`i tazeler, yeni satir
  ACMAZ (kontrat: "Idempotent heartbeat"). Birakma aksiyonundan sonra heartbeat timerinin
  yeniden POST atmadigindan emin ol, yoksa satir aninda geri gelir.
- Yetki: iki uc da `scopes: ['chats--all:ro','chats--access:ro']`, `principals: ['agent']`.
  Aksiyonu gormeyen bir tokena aksiyon GOSTERME (fail-closed, `hasAnyScope` deseni).
- Iki farkli ajan ayni sohbeti izleyebilir: birakma YALNIZ cagiranin satirini siler, sayac
  digerini saymaya devam eder. Testte bunu sabitle.

(e) KAPSAM SINIRI: yeni uc/migration/sozlesme YOK · `supervised` durumunun tanimi
(`chat_supervisions` liveness penceresi) DEGISMEZ · Traffic pano canliligi (polling -> RTM)
tm 220nin isidir, buraya karistirma.
(f) KAPANIS: DoD kapisi yesil -> commit + push (Conventional Commit; PLAN.md satir damgasi
`◐ → ✅` + `#### K<kod>` bloguna kanit maddesi + HANDOFF.md girisi AYNI commite girer) ->
Task Master `done`. Calisma alanini kirli BIRAKMA.

**Test Strategy:**

Tam DoD kapisi (CONVENTIONS §1) exit 0: `pnpm -w typecheck` · `lint` · `format:check` · `build` · `pnpm audit:req-coverage` exit 0 ve `FR-MOD-02.1.1` etiketli site sayisi ARTMIS. Birim: `apps/web` tam suiti `--maxWorkers=4` yesil (yuk altinda `userEvent` timeoutlari cekismedir, regresyon degil) + yeni testler: (1) aksiyon DELETEi cagiriyor, (2) basarili yanit sonrasi liste tazeleniyor ve satir `supervised` sekmesinden dusuyor, (3) heartbeat timeri birakma sonrasi yeniden POST ATMIYOR, (4) yetkisiz token aksiyonu GORMUYOR, (5) iki izleyiciden biri birakinca digerinin satiri KALIYOR. e2e: `apps/e2e/tests/inbox-supervised.spec.ts` supervise -> unsupervise akisiyla genisletilir (kanit PNG). Integration tarafinda yeni test GEREKMEZ (uc zaten testli) — ama mevcut `release` testinin yesil kaldigini dogrula.
