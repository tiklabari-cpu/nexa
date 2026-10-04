# Task ID: 234

**Title:** V8-AUDIT-HYGIENE [OPUS-XHIGH] denetim scriptlerinin iki korlugu + bir eksik paging-exempt isareti

**Status:** done

**Dependencies:** 208 ✓

**Priority:** low

**Description:** GL-13'un §F.1 turunun urettigi uc kucuk rapor-dogrulugu kusuru: schema-consumers SECURITY DEFINER tuketicilerini goremiyor (her turda ayni 3 yanlis-pozitif), unpaged-lists exit 1 veriyor cunku bir cagrida gerekce duzyazi yazili ama makine-okunur isaret yok, ve req-coverage iki egik cizgi kisaltmasi bildiriyor (CONVENTIONS §7.3 yasakliyor).

**Details:**

(a) GEREKCE — ucu de tm 208'de (GL-13 · §F.1) olculdu, hicbiri urun kusuru degil; ucu de
**raporun kendisi hakkinda yanlis konusmasi**dir ve bir sonraki kapanis turunu ayni bicimde
yanıltir. Kayit: PLAN §D153.

1. **`audit:schema-consumers` SECURITY DEFINER korlugu.** Cikti her turda ayni uc yanlis-pozitifi
   veriyor: `PasswordResetToken` (`password_reset_tokens`) · `AccountTwoFactor`
   (`account_two_factor`) · `TwoFactorRecoveryCode` (`two_factor_recovery_codes`) -> "NO CONSUMER
   FOUND". Ucu de gercekten tuketiliyor, ama **SECURITY DEFINER SQL fonksiyonlariyla**:
   `auth_request_password_reset` / `auth_consume_password_reset` (migration
   `20260724090000_account_lifecycle` + `20260724094000_lifecycle_unambiguous_outputs`) ve
   `auth_two_factor_*` fonksiyonlari (`apps/api/src/services/auth/two-factor-service.ts`,
   `routes/auth.ts`). Sema yorumu bunu zaten yaziyor: *"RLS has no permissive policy… only a
   SECURITY DEFINER function reaches this table"*. Script yalniz `prisma.<model>.*` cagrilarini
   ve ham tablo adini ariyor. GL-11 (§D143) ayni uc satiri kaydetti ama GOREVLESTIRMEDI —
   bu yuzden GL-13 ayni eleme isini bastan yapmak zorunda kaldi.
   Yapilacak: script fonksiyon govdelerini de tarasin (migration .sql'lerinde tablo adini anan
   `CREATE FUNCTION` govdesi + o fonksiyonu cagiran TS kaynagi) ya da en azindan ayri bir
   "reached only via SECURITY DEFINER function" kategorisi acsin — `AuditChainHead` icin zaten
   "reached only via raw SQL" kategorisi var, emsal orada.

2. **`audit:unpaged-lists` exit 1 — eksik `paging-exempt` isareti.**
   `apps/web/src/features/developers/WebhookSubscriptions.tsx:87`:
   `api.get<AppListResponse>('/settings/apps?category=productivity&limit=100')`.
   Gerekce hemen ustundeki blok yorumda **duzyazi olarak** yazili ("One request, narrowed to the
   catalogue's `productivity` section…") ama script'in bekledigi `paging-exempt: <neden>`
   satiri yok. GL-11'de `UNPAGED 0` idi, yani bu cagri sonradan geldi.
   Karar once verilecek: ya isaret eklenir (katalog sabit ve 100'un altinda — o zaman muafiyet
   dogru cevaptir) ya `usePagedQuery`ye baglanir. GL-13 bunu BILEREK duzeltmedi: bir kapanis
   turunun yan etkisi olarak bir kapiyi susturmak yanlis olurdu.

3. **Iki egik cizgi kisaltmasi.** `apps/api/test/integration/brand-isolation.test.ts:119` ve `:409`
   basliklarinda `NFR-S4/S5` geciyor; CONVENTIONS §7.3 bunu acikca yasaklar (cikaric yalniz ilk
   ID'yi gorur, ikincisi **sessizce kaybolur**). Dogrusu `(NFR-S4 · NFR-S5)`.
   `pnpm audit:req-coverage` bunu "slash abbreviations = 2" diye bildiriyor ama exit code'u
   bozmuyor (§7.5 kademeli benimseme).

(b) OLCULEBILIR KAPANIS: `pnpm audit:schema-consumers` uc yanlis-pozitifi artik "NO CONSUMER
FOUND" altinda LISTELEMIYOR (ya dogru kategoriye giriyor ya cikiyor) · `pnpm audit:unpaged-lists`
**exit 0** · `pnpm audit:req-coverage` ciktisinda "slash abbreviations = 0".

(c) BILINEN TUZAKLAR:
  1. `audit:req-coverage` etiket degisikliginden sonra `git add -A` gerektirir — script yalniz
     **izlenen** dosyalari tarar, yeni/degismis bir baslik `git add` edilmeden gorunmez.
  2. `brand-isolation.test.ts` basliklarini degistirmek testin kendisini degistirmez ama
     `req-coverage` site sayilarini oynatir; HANDOFF'a once/sonra yaz.
  3. `schema-consumers` degisikligi yanlis-NEGATIF uretmemeli: gercekten tuketicisi olmayan
     `workflows` (⛔ ADR-14) listede KALMALI — bu, script'in tek gercek bulgusudur.

(d) KAPSAM SINIRI: urun davranisi degismez. Dokunulacak yerler `scripts/audit/*.cjs`,
`WebhookSubscriptions.tsx`in bir yorum satiri (ya da sorgusu) ve iki test basligi. Yeni
gereksinim/ozellik yok.

(e) EK BULGU (tm 211 · 2026-09-07 — UCUNCU KORLUK, bu goreve eklendi; ayri gorev ACILMADI):
`scripts/audit/sweep.cjs` bir PLAN tablo satirinin TAMAMINI glif icin tariyor ve oncelik sirasi
acik > kismi > kapsam-disi > kilitli > teslim. Yani DURUM hucresi disinda, aciklama metninde
gecen bir glif satirin DURUMU sayiliyor. Olculdu: `13.7`nin iki damgali satiri var (PLAN 675
v1 · 2295 §6 Faz-3 tablosu); 2295 uzun zamandir teslim damgali ama aciklamasinda "magaza payi
<kapsam-disi glifi>-surec" yaziyordu. 675 kismi iken bu gorunmuyordu (kismi glifi oncelikli);
tm 211 675'i teslim yapinca sweep `13.7`yi BLOCKED okudu — yanlis siniflandirma.
tm 211'in cozumu METINSELDIR (2295'ten glif kaldirildi, gerekcesi satirda ve §D158'de yazili);
KALICI cozum bu gorevin isi: sweep glifi YALNIZCA DURUM sutunundan okumali — satiri `|` ile
bolup damga hucresine bakmali; script bu deseni ilk hucre (PRD kodu) icin ZATEN kullaniyor,
damga hucresi icin kullanmiyor.
OLCULEBILIR: 2295'e glif geri konuldugunda bile `node scripts/audit/sweep.cjs` `13.7`yi DONE
saymali; regresyon nobetcisi `13.4` (gercek kapsam-disi, ADR-14) BLOCKED KALMALI.

**Test Strategy:**

Uc komutun ucu de kendi kapisini gecer: `pnpm audit:schema-consumers` (uc SECURITY DEFINER tablosu artik "NO CONSUMER FOUND" degil; `workflows` HALA listede — regresyon nobetcisi), `pnpm audit:unpaged-lists` **exit 0**, `pnpm audit:req-coverage` **exit 0** ve ciktida "slash abbreviations = 0". Script degisikligi icin birim testi: `scripts/audit/` altinda test yoksa, en azindan degisiklikten ONCE/SONRA ciktilar HANDOFF'a yazilir. Tam DoD kapisi (CONVENTIONS §1) exit 0; `apps/api` integration `brand-isolation.test.ts` yesil kalir (baslik degisti, iddia degismedi).
