# Task ID: 188

**Title:** F0-SHELL — Faz-0 kabuk kalemleri: sol ikon rayi + sag panel (FR-MOD-01.2 · 01.3)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Denetim Faz-0`in iki kabuk kalemini KISMI buldu: sol ikon rayinda badge sayac ve yetkiye gore gizleme yok (yalniz Developers `scope` tasiyor), sag panelde Details<->Copilot secimi reload`da kayboluyor. Ikisi de PRD kabul kriterinde ismen yazili.

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
| 203 | 01.2 | `#### K01.2` | 188.1 |
| 204 | 01.3 | `#### K01.3` | 188.2 |

## (c) Dokunulacak dosyalar

- `apps/web/src/components/navigation.ts` — `NavDestination` (`scope?`, badge alani yok), `MODULES`/`FOOTER`, `isNavVisible`.
- `apps/web/src/components/AppShell.tsx` — rayi render eden yer; `TrialBanner` deseni (canli sayac cekme) burada.
- `apps/web/src/features/inbox/InboxPage.tsx` — `panelTab` (`useState`, :262) ve `rightPanel` (`./rightPanel.js`, persist eden taraf).
- `apps/web/src/features/inbox/rightPanel.ts` — localStorage persist`in zaten calisan yarisi; ornek alinacak desen.

## (d) Kapsam SINIRI

- YALNIZ 01.2 ve 01.3. `01.1.x` (logo/hamburger, ⌘K, avatar grubu) ve `01.4`/`01.5` bu gorevin disinda —
  onlar Faz-0 `Must` degil ya da zaten kapali; damgalarina DOKUNMA.
- Yeni uc acilmasi gerekiyorsa (badge sayaclari icin) once mevcut uclara bak: `GET /chats?view=...`
  ve `GET /tickets` zaten sunucu tarafi toplam donduruyor (tm 179 M-COUNT). Yeni uc son care.

## Kapanista yapilacak PLAN.md guncellemesi

Bu ailenin TUM alt-gorevleri bittiginde ilgili `Must` satirinin damgasi `◐ → K<kod>` yerine
`✅ → K<kod>` olur (PLAN.md §3, satir no `grep -n` ile bulunur — 2026-09-04 itibariyle gecerli satir
numaralari asagida yazili, dosya degistikce kayar). Tek bir alt-gorev bir satiri tek basina kapatiyorsa
o satiri o alt-gorev cevirir. Kanit tablo hucresine YAZILMAZ; `#### K<kod>` blogunun sonuna madde
olarak eklenir: `- ✅ <ne yapildi> — `<dosya>` · test `<dosya>` (n) · tm <id>`.
Faz-0 `Must` sayaci (PLAN.md:18 kapi tablosu) her kapanan satirda guncellenir.

**Test Strategy:**

Aile ancak iki alt-gorevin ikisi de DoD kapisindan gectiginde done. Her alt-gorevin kendi olculebilir kriteri kendi `testStrategy`sinde. Kapanista `grep -n "| 01.2 \|| 01.3 " PLAN.md` cikan durum-damgali satirlarda `◐` KALMAMALI.

## Subtasks

### 188.1. F0-SHELL-a [SONNET-XHIGH] Sol ikon rayi: yetkiye gore gizleme + badge sayac (FR-MOD-01.2)

**Status:** done  
**Dependencies:** None  

PRD KK uc madde istiyor: "Her ikon ana modul rotasina atlar; aktif vurgulanir; badge sayac". Ilk ikisi var, ucuncusu YOK. Ayrica yetkiye gore gizleme yalniz Developers`a uygulanmis.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

- **Badge sayac hic yok.** `apps/web/src/components/navigation.ts` icinde `badge` gecen tek satir yok;
  `NavDestination` alanlari: `to`, `labelKey`, `icon`, `keywords`, `scope?`.
- **Yetkiye gore gizleme yalniz bir hedefte.** `MODULES` (home/inbox/customers/team/playbook/reports)
  ve `FOOTER`in ilk iki hedefi (`billing`, `settings`) `scope` TASIMIYOR; `scope` yalniz
  `/app/developers` uzerinde (`access_rules:rw`, navigation.ts:90). `isNavVisible` (:34) dogru yazilmis,
  besleyen veri eksik. Denetim: "DEFAULT_AGENT_SCOPES (role-scopes.ts:34-77) reports_read,
  billing_manage veya properties.configuration:rw tasimadigi icin agent rolundeki bir kullanici
  Reports/Billing kapisini goruyor ve 403 aliyor."

## Yapilacak

1. Her `NavDestination`a dogru `scope` ver. Kaynak: `apps/api/src/services/auth/role-scopes.ts`
   (`DEFAULT_AGENT_SCOPES`) + ilgili rotalarin `config.scopes` degeri. Bir ikonun scope`u,
   o modulun EN DAR okuma scope`u olmalidir (kullanici hic bir seyini goremiyorsa kapi gosterilmez).
   Kapi acik kalirsa 403; kapi yanlis kapanirsa kullanici urunun bir modulunu kaybeder — iki yon de
   test edilir.
2. `NavDestination`a `badge?` ekle ve besle. Onerilen kaynak: Inbox = atanmamis+kuyruk sayisi,
   Team = bekleyen davet, Reports = yok. **Yeni uc acmadan once** mevcut sunucu toplamlarini kullan
   (tm 179 M-COUNT sunucu tarafi sayaclari getirdi). Sayac 0 iken rozet render EDILMEZ.
3. `aria-label` rozeti icermeli ("Inbox, 3 unread") — cipla sayi ekran okuyucuda anlamsiz (NFR-A11Y).

## Bilinen tuzaklar

- `apps/web` vitest CPU yuku altinda `userEvent` testlerinde 5000 ms timeout verir; `--maxWorkers=4`.
- Rota gizleme testte iki yonlu kurulur: scope`u OLAN principal gorur, OLMAYAN gormez. Tek yonlu test
  gizlemeyi kanitlamaz.
- Rozet bir polling kaynagi ekliyorsa `TrialBanner`in `staleTime` desenine uy; her navigasyonda
  yeniden cekme rayin altinda gorunmez bir istek firtinasi yaratir.

## Kapsam SINIRI

Yalniz sol ikon rayi. ⌘K komut paleti (`01.1.3`), avatar presence grubu (`01.1.4`) ve trial rozeti
(`01.1.6`) kapsam disi — ucu de ayri PRD kalemi ve bu turda `Must ◐` degil.

### 188.2. F0-SHELL-b [SONNET-XHIGH] Sag panel: Details<->Copilot secimi persist (FR-MOD-01.3)

**Status:** done  
**Dependencies:** None  

PRD KK: "Panel acilir/kapanir; Details/Copilot gecisi persist". Details<->Expand persist ediliyor ve testi var; Details<->Copilot duz `useState` oldugu icin reload`da her zaman `details`e donuyor.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Eksik olan (olculdu, 2026-09-04)

`apps/web/src/features/inbox/InboxPage.tsx:262` — `const [panelTab, setPanelTab] = useState<"details" | "copilot">("details")`.
Ayni dosyada `:243` `const rightPanel = useRightPanel()` var ve O taraf (`./rightPanel.js`) localStorage`a
yaziyor, testi de var. Yani persist deseni depoda ZATEN mevcut, `panelTab` ona baglanmamis.
Ek olarak `:264` sohbet degisiminde sekmeyi `details`e zorluyor — bu davranisin bilerek mi oldugu
kararlastirilmali (PRD "tum uygulamada kalici" diyor; sohbet degisiminde sifirlamak persist`i
pratikte gorunmez kilar).

## Yapilacak

1. `panelTab`i `rightPanel` store`una tasi (ayni localStorage anahtar ailesi, ayri alan) ya da
   `useRightPanel` ile ayni deseni izleyen ikinci bir kucuk hook yaz. Iki ayri persist mekanizmasi
   AÇMA — biri digerinden sessizce ayrisir.
2. `:264`teki sifirlamayi karara bagla ve gerekcesini kodun yanina yaz. Onerilen: sohbet degisiminde
   sekme KORUNUR (PRD "tum uygulamada kalici"), yalniz secili sohbet yokken Details`e duser.
3. Bozuk/bilinmeyen localStorage degeri `details`e duser (kullaniciyi bos panele kilitleme).

## Bilinen tuzaklar

- jsdom`da `localStorage` testler arasinda TASINIR; her testte temizle yoksa siradaki test
  onceki testin sekmesiyle acilir ve sebebi gorunmez.
- `rightPanel.expanded` ile `panelTab` ayri kavramlar: Expand paneli KAPATIR, sekme hangi panelin
  gosterildigini soyler. InboxPage:657-711 ikisini birlikte kullaniyor; birini digerine indirgeme.

## Kapsam SINIRI

Yalniz sekme persist`i. Copilot panelinin ICERIGI (`FR-MOD-12.*`) ve Details panelinin atama kontrolu
(`FR-MOD-02.4`, tm 189.6) kapsam disi.
