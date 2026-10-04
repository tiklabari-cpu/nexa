# Task ID: 219

**Title:** V8-INBOX-SUGG [OPUS-XHIGH] Reply Suggestions baglam ve dil kazansin (FR-MOD-02.3.2)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** PRD satirinin adi 'Reply Suggestions cipleri (AI, Space ile)'; kod sabit Ingilizce regex/sablon uretiyor ve i18n katmanindan gecmiyor — Turkce bir sohbette Ingilizce cip oneriyor. Ana kabul kriteri (cip -> composer'a duzenlenebilir metin) KARSILANMIS ve testli; eksik olan kaynak.

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
PRD `:508`: "Reply Suggestions cipleri (AI, `Space` ile)" · KK: "Cip -> composer'a duzenlenebilir metin".
Kod `apps/web/src/features/inbox/replySuggestions.ts`: sabit Ingilizce kaliplar —
`const GREETING = /^\s*(hi|hey|hello|good\s+(morning|afternoon|evening))\b/i` ·
`const THANKS = /\b(thanks|thank you|...)\b/i` · `const ORDER = /\b(refund|cancel|return|order|...)\b/i`
ve iki sabit "holding" cumlesi (`"I'm still on it — please bear with me for a moment."` vb.).
Ureteci `leadFor()` dogrudan Ingilizce string donduruyor, `t()` cagirmiyor.
`#### K02.3.2` (PLAN.md ~6058) denetim maddesi: "Ana kabul kriteri karsilanmis ve testli. Ancak
oneri uretimi AI degil, sabit Ingilizce regex/sablon (replySuggestions.ts:29-60) ... i18n
katmanindan gecmiyor". PLAN satiri 642, oncelik `Should (v1)`.

(b) DOKUNULACAK DOSYALAR:
- `apps/web/src/features/inbox/replySuggestions.ts` (+ testi).
- `apps/web/src/features/inbox/Composer.tsx` — `Space` tetikleyicisi + `role="group"` cip satiri.
- Copilot dikisi: `POST /copilot/chats/{chatId}/reply` (MEVCUT uc — `12.1-12.3` ailesi,
  `apps/api/src/services/ai/copilot-service.ts`). IKINCI BIR AI YOLU ACILMAZ.
- `apps/web/src/locales/{en,tr}/inbox.ts` — fallback sablonlarin i18n karsiliklari.

(c) CONTRACT-FIRST SIRA: mevcut copilot ucunun yaniti yeterli mi diye BAK (yeterliyse sozlesme
degismez) -> istemci cagrisi + yukleniyor/hata durumlari -> i18nlenmis fallback -> unit -> e2e.

(d) BILINEN TUZAKLAR:
- Composer'da `Space` bir KISAYOL: yalniz BOS reply alaninda ve `mode='all'` iken tetikleniyor.
  Bu kosulu bozarsan kullanici bosluk tusuyla yazamaz hale gelir — regresyon testiyle sabitle.
- AI cagrisi ASENKRONDUR; `Space`in bugunku ANINDA cevabi kaybolmamali. Yukleme durumu ve
  zaman asimi sonrasi fallback ZORUNLU (saglayici mock, ama gecikme gercek).
- Fallback sablonlari i18nlenirken ANAHTAR KUMESI tum localelerde tam olmali; eksik anahtar
  Ingilizceye duser (mevcut davranis) ama BOS STRING yazma.
- Yeni bir web bileseni `t()` cagiriyorsa `i18n-coverage.test.ts` `TRANSLATED_FILES`ine EKLE.
- `MAX_SUGGESTIONS = 4` sinirini koru (bir bakista taranan kisa satir, menu degil).

(e) KAPSAM SINIRI: yeni AI ucu/model saglayicisi ACILMAZ (mock kalir, CLAUDE.md siniri) ·
Copilot ozet yolu (02.5) DEGISMEZ · cip -> composer davranisi DEGISMEZ (yalniz metnin KAYNAGI ve
DILI degisir) · knowledge/RAG yoluna dokunulmaz.
(f) KAPANIS: DoD kapisi yesil -> commit + push (Conventional Commit; PLAN.md satir damgasi
`◐ → ✅` + `#### K<kod>` bloguna kanit maddesi + HANDOFF.md girisi AYNI commite girer) ->
Task Master `done`. Calisma alanini kirli BIRAKMA.

**Test Strategy:**

Tam DoD kapisi exit 0 · `audit:req-coverage` exit 0 ve `FR-MOD-02.3.2` site sayisi ARTMIS. Birim (`apps/web`, `--maxWorkers=4`): (1) aktif locale `tr` iken onerilen cipler TURKCE (sabit Ingilizce string DONMUYOR); (2) saglayici hata/zaman asimi verirse i18nlenmis fallback ciplari geliyor ve UI patlamiyor; (3) `Space` yalniz bos reply alaninda + `mode='all'` iken tetikleniyor (REGRESYON — dolu alanda bosluk normal karakter); (4) cip -> composer duzenlenebilir metin davranisi degismedi (regresyon, mevcut test yesil); (5) en fazla 4 cip; (6) `i18n-coverage.test.ts` yesil. Integration: copilot reply ucu cagriliyor ve yaniti cipe donusuyor + cross-tenant negatif. e2e: Turkce oturumda `Space` -> Turkce cip -> composer (kanit PNG).
