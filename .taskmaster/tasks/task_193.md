# Task ID: 193

**Title:** F0-SETGAP — Settings`in iki `Must` kalemi: e-posta kanali + hazir yanit grup kapsami (FR-MOD-08.5.3 · 08.7.2)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Denetim iki Settings kalemini KISMI buldu: gelen e-posta adresi semasi SABIT (bir calisma alani birden fazla adres tanimlayamiyor) ve PRD`nin istedigi adres dogrulama yok; hazir yanitlarda GRUP KAPSAMI baglanmamis — `group_id` ve `visibility` kolonlari semada var, hicbir uc okumuyor/yazmiyor (denetimin D4 "olu kolon" deseni).

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## (a) Bu isi doguran gerekce

tm 184.4 (M-TRACE-d · `cf9ad43`) PLAN.md damgalarini `prd-uyum-denetimi.md`ye (2026-08-30, 12 denetci +
12 curutucu ajan) karsi yeniden okudu ve Faz-0`in 28 `Must` satirini `✅`ten `◐`ye indirdi; §F.00`in
mekanik kurali geregi ("bir faz ancak `Must` kapsaminda 0 ◐ ve 0 ⬜ kaldiginda kapanir") Faz-0 kapisi
`❌ ACIK`a dondu. tm 185 o 28 kalemi tek tek triyaj etti: 3 kalem denetimden SONRA kapanmisti (damga `✅`e
geri alindi), kalan 25 kalem is gorevine donusturuldu. Bu gorev o gorevlerden biridir.

Kapanis kosulu tek: **PRD kabul kriteri (KK)**. "Kod var + test yesil" YETMEZ — GL-3/GL-4/GL-8`in hatasi
tam olarak buydu ve M-TRACE ailesi (tm 184.1-184.3) bu kapiyi teshis etti. Kanit blogu PLAN.md`nin
`## K. Kanit Gecmisi` bolumundedir (`#### K<kod>`), tablo hucresinde DEGIL (CONVENTIONS §1.2).

## (b) Kapsanan PLAN satirlari

| PLAN satir (2026-09-04) | Kod | Kanit blogu | Alt-gorev |
| --- | --- | --- | --- |
| 270 | 08.5.3 | `#### K08.5.3` | 193.1 |
| 274 | 08.7.2 | `#### K08.7.2` | 193.2 |

## (c) Ana dosyalar

- `apps/api/src/services/mail/email-inbound.ts` (adres semasi :57-70) · `apps/api/src/config/env.ts:234`
  (`INBOUND_EMAIL_DOMAIN`) · `apps/web/src/features/settings/Channels.tsx` (:332 adres gosterimi).
- `apps/api/prisma/schema.prisma` `model CannedResponse` (:1170-1187: `groupId BigInt?`,
  `visibility String @default("all")`, `@@index([licenseId, groupId])`).
- `apps/api/src/routes/settings.ts` — hazir yanit uclari (`grep -n "canned"`).

## (d) Kapsam SINIRI

- YALNIZ iki satir. `08.5.4`/`08.5.5`/`08.5.6` (omnichannel — tm 183 M-CHOBS ve G1 ailesi),
  `08.6.1` (routing — tm 181.3`te kapandi), `08.7.1` (tag grup kapsami — tm 181.1) DISARIDA.
- Gercek bir SMTP/e-posta saglayicisina baglanma YOK (MASTER-PROMPT: dis servisler mock`lanir).

## Kapanista yapilacak PLAN.md guncellemesi

Bu ailenin TUM alt-gorevleri bittiginde ilgili `Must` satirinin damgasi `◐ → K<kod>` yerine
`✅ → K<kod>` olur (PLAN.md §3, satir no `grep -n` ile bulunur — 2026-09-04 itibariyle gecerli satir
numaralari asagida yazili, dosya degistikce kayar). Tek bir alt-gorev bir satiri tek basina kapatiyorsa
o satiri o alt-gorev cevirir. Kanit tablo hucresine YAZILMAZ; `#### K<kod>` blogunun sonuna madde
olarak eklenir: `- ✅ <ne yapildi> — `<dosya>` · test `<dosya>` (n) · tm <id>`.
Faz-0 `Must` sayaci (PLAN.md:18 kapi tablosu) her kapanan satirda guncellenir.

**Test Strategy:**

Aile ancak iki alt-gorev de DoD kapisindan gectiginde done. Kapanista iki satirda da `◐` KALMAMALI.

## Subtasks

### 193.1. F0-SETGAP-a [OPUS-XHIGH] Coklu gelen e-posta adresi + adres dogrulama (FR-MOD-08.5.3)

**Status:** done  
**Dependencies:** None  

Ana akis (forward -> ticket, gonderen eslesme, spam suzme, CC maskeleme) TAM. PRD KK`nin iki maddesi eksik: "Coklu adres forward -> ticket" ve "test dogrulama".

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- Adres semasi SABIT: `<organization_id>@<INBOUND_EMAIL_DOMAIN>` — `email-inbound.ts:57-70`,
  konsolda `Channels.tsx:332`. Bir calisma alani ikinci bir adres (ornegin `support@` ve `billing@`)
  tanimlayamiyor.
- `INBOUND_EMAIL_DOMAIN` varsayilani `inbound.siyahtus.localhost` (`config/env.ts:234`).
- PRD KK: "Coklu adres forward -> ticket; **test dogrulama**". Ikinci madde: adresin gercekten
  calistigini kullaniciya kanitlayan bir eylem (bir test mesaji gonder / son gelen mesaji goster).

## Yapilacak (contract-first)

1. **Model karari.** Coklu adres nasil temsil edilir?
   (i) Adres **etiketi** kolonu + ayni domain (`<org>+<label>@domain` ya da `<label>.<org>@domain`) —
       migration hafif, yonlendirme kurali basit. **Onerilen.**
   (ii) Ayri bir `inbound_addresses` tablosu — daha genel, daha pahali, RLS + tekillik kurallari ister.
   Karari ve gerekcesini `#### K08.5.3` maddesine yaz. Hangi model olursa olsun: iki kiracinin ayni
   adresi almasi IMKANSIZ olmali (veritabani seviyesinde unique).
2. **Yonlendirme:** hangi adrese gelen mesaj hangi kuyruga/etikete duser? En az "adres -> ticket"
   calismali; adres -> takim esleme opsiyonel ve ayri bir kalem olarak notta anilir.
3. **Test dogrulama:** konsolda "Send test email" ya da "Son alinan mesajlar" eylemi. tm 183.1
   `GET /channels/:type/messages` ucunu ZATEN acti — dogrulama yuzeyi buna dayanabilir, yeni uc
   acmadan once oraya bak.
4. Sozlesme once: OpenAPI + `@siyahtus/types`, sonra migration, sonra backend+unit, sonra konsol.

## Bilinen tuzaklar

- **OpenAPI`ye YENI YOL eklemek `apps/mobile` parity testinin sabitledigi uc sayisini bozar** —
  yeni yol gerekiyorsa sayaci YORUMLA BIRLIKTE guncelle (bilinen, belgelenmis tuzak).
- Migration: CONVENTIONS §6.3 (genislet -> tasi -> daralt). Var olan tek adresin ARDINDA KALAN
  bir gecis yolu olmali; bugunku adres calismaya devam etmeli (musterilerin filtreleri ona bagli).
- `db:check-drift` exit 0 sart. Shadow DB Prisma uzerinden; `psql` PATH`te degil (`docker exec -i siyahtus-db`).
- Spam suzme ve CC maskeleme mevcut ve DOGRU — regresyon testleriyle koru, yeniden yazma.

### 193.2. F0-SETGAP-b [OPUS-XHIGH] Hazir yanitlarda grup kapsami — iki olu kolon (FR-MOD-08.7.2)

**Status:** done  
**Dependencies:** None  

`#` kisayolu calisiyor, yinelenen shortcut `(license, scope, shortcut)` unique ile engelleniyor, "Modified by" izi tutuluyor. EKSIK: PRD KK`nin "grup scope" maddesi — semada `group_id` ve `visibility` kolonlari var, hicbir uc onlari okumuyor ya da yazmiyor.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- `apps/api/prisma/schema.prisma` `model CannedResponse` (:1170-1187):
  `groupId BigInt? @map("group_id")` · `visibility String @default("all")` · `@@index([licenseId, groupId])`.
- `grep -n "visibility" apps/api/src/routes/settings.ts` -> **0 satir**. Iki kolon da olu.
- PRD KK: "`#` composer`da; yinelenen shortcut engeli; **grup scope**; surum izi (Modified by)".
- **Emsal HAZIR:** tm 181.1 (M-UI-a) etiketlerde ayni isi yapti ("Etiket grup kapsami ekrani — ucun
  olu kolon olmadigini da dogrula"). O turun kararlarini ve ekranini oku, ayni dili kullan.

## Yapilacak (contract-first)

1. **`visibility` anlami sabitlenir.** Bugunku varsayilan `"all"`. Ikinci deger ne? (`"group"`?
   `"private"`?) Deger kumesini KISITLA (veritabani CHECK ya da enum) — serbest string bir
   yil sonra uc farkli yazimla dolar.
2. **Uc:** hazir yanit olusturma/guncelleme `group_id` + `visibility` kabul eder; listeleme
   **cagirana gore suzer** (kendi grubunun + herkese acik olanlar). Suzme SUNUCUDA olur —
   istemcide suzmek, sayfalanmis bir listede yanlis sonuc verir ve gizli olani tel uzerinde tasir.
3. **Composer `#` menusu** ayni suzulmus listeyi tuketir (bugunku uc ne donduruyorsa onu gosteriyor;
   uc suzunce menu kendiliginden dogru olur — ama TESTLE dogrula).
4. **Konsol:** hazir yanit duzenleme yuzeyine grup secici. Kullanicinin uyesi OLMADIGI grubu
   secebilmesi bir yetki karari — tm 181.1`in verdigi karari izle.
5. Silinen grup: `group_id` FK`si nasil davranir? (`ON DELETE SET NULL` -> yanit herkese acik olur mu,
   yoksa grup silinemez mi?) tm 175`in `group_in_use` 409 deseni emsal — karari yaz.

## Bilinen tuzaklar

- Kolonlar ZATEN var; migration gerekmeyebilir. Gerekiyorsa (CHECK kisiti gibi) §6.3 kurallari gecerli.
- `@@unique([licenseId, scope, shortcut])` grup kapsami gelince anlamini degistirir mi? Iki farkli
   grup ayni `#hello` kisayolunu isteyebilir. Bu kisiti gevsetmek bir KARAR — gevsetirsen menu
   belirsizlesir (hangi metin?), gevsetmezsen gruplar birbirinin kisayolunu bloklar. Karari yaz.
- Cross-tenant + cross-group negatif testleri zorunlu: baska grubun ozel yaniti listede GORUNMEZ.
