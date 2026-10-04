# Task ID: 236

**Title:** V8-MSG-EDIT [OPUS-XHIGH] gonderilmis mesaji duzenleme (edit-after-send) — PRD §5.2 v1 kapsaminda adi geciyor, depoda hicbir izi yok

**Status:** done

**Dependencies:** 209 ✓

**Priority:** medium

**Description:** PRD §5.2'nin Guvenlik satiri v1 kapsamina "mesaj duzenleme (edit-after-send)" yaziyor ve §10.2 onu "v1/v2 · Low" diye fiyatliyor. PRD §6'nin 138 FR-MOD satirinda KARSILIGI YOK; PLAN.md/HANDOFF.md/prd-uyum-denetimi.md'de tek kelime gecmiyor; kodda tek yuzey yok. Yani damgasiz, gorevsiz, sahipsiz bir v1 kapsam kalemi. GL-14 (tm 209) buldu ve karara bagladi.

**Details:**

(a) GEREKCE + KANIT (karar tm 209 · GL-14 · PLAN §D156):
PRD satir 399 (§5.2 kapsam tablosu, Guvenlik satiri): _"SSO (Google/Microsoft OAuth) + 2FA;
mesaj duzenleme (edit-after-send)"_. PRD satir 1116 (§10.2 efor tablosu):
`| Mesaj duzenleme (edit-after-send) | v1/v2 | Low | — |`.
Ayni satirin diger iki payi TESLIM: SSO -> `services/auth/oauth-service.ts` (Google/Microsoft),
2FA -> `services/auth/two-factor-service.ts` + `lib/totp.ts` (NFR-S11, Faz-3 tm 81).
Ucuncu pay YOK ve olculdu (2026-09-07, GL-14 §F.1/1):
  - `grep -niE "edit-after-send" urun-gereksinim-dokumani-PRD.md` -> yalniz 399 + 1116.
  - Ayni desen `PLAN.md`, `HANDOFF.md`, `prd-uyum-denetimi.md`, `rapor-1-fonksiyonel.md`,
    `v2-derin-analiz/*.md` icinde **0 eslesme**.
  - `packages/contract/openapi/paths/chats.yaml` icinde PATCH/PUT **yok**; `events/{eventId}`
    diye bir yol ne kontratta ne `apps/api/src/routes`'ta var; `editMessage|edit_message|
    editEvent` `apps/web/src` + `apps/api/src` genelinde **0**.
Yani bu bir "yarim kalmis is" degil, **hic baslamamis ve kimsenin listesinde olmayan** bir istir.

NEDEN v1 KAPISINI BLOKLAMADI (ve bu gorev o karari geri almaz): §F.00'in sayaci §4.1/4.2/4.3'un
`Must (v1)` DAMGALI satirlarini sayar; FR-MOD satiri olmayan bir kalem damga tasiyamaz, dolayisiyla
sayaca hic girmedi. GL-14 kapiyi `20 ✅ · 0 ◐ · 0 ⬜` ile kapatti ve bu kalemi **ayri, ismen** kayda
gecirdi (§F.00'in "sessizce dusemez" sarti). Kapanis kararini bu gorev DEGISTIRMEZ.

(b) YAPILACAK IS — ONCE TRIYAJ, SONRA (gerekiyorsa) KOD:
1. **Triyaj (kod yazmadan).** Karar: bu kalem (i) PRD §6'ya turetilmis bir satir olarak girip
   yapilacak mi, (ii) `⛔` gerekce ile kapanacak mi (ornek gerekce sekli: ADR-04'un action-yuzeyi
   reddi gibi kilitli bir karar ya da `chat_events`'in append-only invaryantiyla catisma), yoksa
   (iii) v2/v3'e mi atanacak (PRD §10.2 "v1/v2" diyerek zaten hedgeliyor). Karari `#### K` blogu
   olarak yaz; PLAN'a satir aciyorsan §4.3'e `Should (v1)` olarak gir ve damgasini oraya koy.
2. **Kod yolu secilirse** cekirdek soru mimari: `chat_events` bu depoda **append-only** bir olay
   akisidir (chat->thread->event, ADR-15 / §8.4) ve RTM `incoming_event` push'u tuketicilere
   BIR KEZ gider. Bir olayin metnini yerinde degistirmek bu invaryanti bozar. Dogru sekil
   buyuk olasilikla **duzeltme olayi** (yeni bir `message_edited` olayi + orijinale referans)
   ve okuyucunun son surumu gostermesidir; widget + web + mobil UCU DE ayni kurali okumali.
3. **Pencere/yetki**: kimin, ne kadar sure icinde duzenleyebilecegi bir urun karari — PRD
   sessiz. Triyajda karara bagla, varsayimla kod yazma.

(c) OLCULEBILIR KAPANIS: triyaj yolu (ii)/(iii) secilirse cikti bir PLAN satiri + `#### K` blogu +
gerekce (kod yok, DoD kapisi yine de yesil kosulur). Yol (i) secilirse: kontrat + migration +
api birim/entegrasyon testi + web/widget birim testi + bir e2e adimi; olay akisi invaryanti icin
NEGATIF test (duzenleme orijinal olayi SILMEZ/DEGISTIRMEZ).

(d) BILINEN TUZAKLAR:
1. **Damga UYDURMA.** Bugun bu kalemin PLAN'da satiri YOK; "✅" yazilacak bir hucre de yok.
   Once satir acilir (ya da acilmamasi gerekcelendirilir), sonra damga konur.
2. `02.3.x` composer satirlarinin damgasi bu gorevle DEGISMEZ — onlarin KK'si YAZMA araclarini
   sayar, gonderilmis bir mesajin duzenlenmesini degil.
3. `apps/mobile` parite testi kontrattaki uc sayisini **birebir** pinliyor; yeni bir yol
   eklenirse o sayi yorumla birlikte guncellenir (aksi halde kapi kirmizi verir).
4. PRD §10.2 bu kalemi "v1/v2" diye fiyatliyor — yani PRD'nin KENDISI faz konusunda kararsiz.
   Triyaj bunu bir bulgu olarak yazmali, ortmemeli.

(e) KAPSAM SINIRI: v1'in `Must` sayaci ve Faz-1 kapanis damgasi (GL-14 · tm 209) DEGISMEZ.
Bu gorev yeni bir kapanis turu ACMAZ. `bulk actions` ayni ailedendir ama AYRI gorevdir (tm 237).

**Test Strategy:**

Triyaj yolu secilirse: cikti PLAN.md'de bir satir (ya da gerekceli `⛔`) + `#### K` blogu; DoD kapisi (CONVENTIONS §1) yine exit 0 kosulur ve HANDOFF'a karar yazilir. Kod yolu secilirse: (1) kontrat `contract:generate` sonrasi generated diff bos + `contract-parity` yesil; (2) api entegrasyon testi — bir olayin duzenlenmesi ORIJINAL olayi silmiyor/degistirmiyor (append-only negatifi), yetkisiz ajan 403 aliyor, pencere disinda 4xx; (3) web + widget birim testi — okuyucu son surumu gosteriyor, duzenlenmis isareti gorunuyor; (4) e2e: ajan gonderiyor, duzenliyor, ziyaretci tarafinda guncel metin gorunuyor; (5) `apps/mobile` parite sayisi guncel. Tam DoD kapisi exit 0.
