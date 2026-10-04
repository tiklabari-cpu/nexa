# Task ID: 227

**Title:** V8-TMPL-USE [OPUS-XHIGH] Ticket e-posta sablonlarinin tuketicisi — renderTemplate cagrilmiyor (FR-MOD-08.7.5)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** CRUD ve 'gecersiz degisken/format engeli' kriteri karsilanmis, ama renderTemplate repoda YALNIZ kendi testinden cagriliyor: bir admin sablon yazabiliyor, o sablonla hicbir e-posta gonderilmiyor. Olu ozellik.

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
PRD `:634`: "Ticket email templates (markali, degiskenli)" · KK: "Gecersiz degisken/format engeli".
`grep -rn "renderTemplate" apps/api/src apps/web/src packages --include=*.ts --include=*.tsx`
(kendi modulu haric) -> SIFIR tuketici (bu turda olculdu).
`#### K08.7.5` (PLAN.md ~6155) denetim maddesi birebir: "CRUD ve 'gecersiz degisken/format engeli'
kriteri karsilanmis (servis `{{ group.field }}` yer tutucularini @siyahtus/types katalogua karsi
doguluyor). AMA SABLON TUKETICISI YOK: `renderTemplate` (packages/types/src/template-variables.ts:130)
repoda yalnizca ken[di testinden]…". PLAN satiri 659, `Should (v1)`.

(b) DOKUNULACAK DOSYALAR:
- `packages/types/src/template-variables.ts` — `renderTemplate` (DEGISMEZ, yalniz cagrilir).
- Ticket e-posta yolu: EMSAL `08.7.4` chat transcript gonderimi (`grep -rn "transcript" apps/api/src`
  ile bul) — ayni mock saglayici dikisini kullan.
- `apps/api/src/services/` altindaki ticket bildirim/e-posta yolu + ticket durum gecisleri.
- `apps/api/src/routes/` — sablon secimi bir uctan geliyorsa sozlesme.

(c) CONTRACT-FIRST SIRA: hangi OLAYIN sablonu tuketecegine karar ver (ticket acildi/atandi/
cozuldu — PRD satiri + mevcut ticket yasam dongusu) -> sozlesme (gerekiyorsa) -> backend +
integration -> UI (sablon secimi) -> e2e.

(d) BILINEN TUZAKLAR:
- SAGLAYICI MOCK KALIR (CLAUDE.md siniri: gercek SMTP/secret YOK). Kanit "e-posta gitti" degil
  "gonderilen govde sablondan turedi ve degiskenler cozuldu" olmali.
- Degisken dogrulamasi ZATEN var ve KORUNUR: gecersiz `{{ group.field }}` yer tutucusu
  @siyahtus/types katalogua karsi reddediliyor. Gonderim yolunda da AYNI dogrulama kosmali, yoksa
  kaydedilmis eski bir sablon calisma zamaninda patlar (fail-closed: gonderme, hata dondur).
- Kiraci izolasyonu: sablon lisans kapsamlidir; baska lisansin sablonu ASLA kullanilamaz
  (cross-tenant negatif ZORUNLU).
- Degisken cozumu MUSTERI VERISI tasir — log'a ve audit metadata'sina govde YAZILMAZ (yalniz
  sablon kimligi + alan ADLARI; `08.3` M-CO-a'nin "alan adlari, degerler degil" emsali).

(e) KAPSAM SINIRI: gercek SMTP/saglayici ACILMAZ · sablon CRUD ekrani DEGISMEZ · chat transcript
yolu (08.7.4) DEGISMEZ · custom fields (08.7.6) DEGISMEZ · forms builder tm 228'in isi.
(f) KAPANIS: DoD kapisi yesil -> commit + push (Conventional Commit; PLAN.md satir damgasi
`◐ → ✅` + `#### K<kod>` bloguna kanit maddesi + HANDOFF.md girisi AYNI commite girer) ->
Task Master `done`. Calisma alanini kirli BIRAKMA.

**Test Strategy:**

Tam DoD kapisi exit 0 · `audit:req-coverage` exit 0 ve `FR-MOD-08.7.5` site sayisi ARTMIS. Kapanis olcusu: `grep -rn "renderTemplate" apps/api/src` artik EN AZ BIR uretim cagrisi gosteriyor. Integration (`apps/api`): (1) sablon secili bir ticket olayinda gonderilen GOVDE sablondan turedi ve degiskenler cozuldu; (2) NEGATIF: gecersiz/bilinmeyen degisken tasiyan kaydedilmis sablon gonderimi FAIL-CLOSED reddediyor (patlamiyor, sessizce ham `{{...}}` GONDERMIYOR); (3) sablon secilmemisse mevcut varsayilan davranis KORUNUYOR (regresyon); (4) CROSS-TENANT: A lisansinin sablonu B'nin gonderiminde kullanilamaz (ZORUNLU); (5) log ve audit metadata'sinda cozulmus GOVDE yok (yalniz sablon kimligi + alan adlari) — sizinti negatifi. Web unit: sablon secimi yuzeyi (varsa) + i18n. e2e: ticket olayi -> sablonlu e-posta govdesi (mock outbox kaniti).
