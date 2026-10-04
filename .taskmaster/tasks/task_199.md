# Task ID: 199

**Title:** V1-PERSONA — Persona cevabi gercekten sekillendirsin (FR-MOD-06.4)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Denetim: bes persona alani da duzenlenebilir/kalici, canli `PersonaPreview` var, zorunlu isim e2e ile kanitli ve widget basliginda persona adi+avatari gorunuyor — ama persona CEVAP URETIMINI HIC ETKILEMIYOR. `tone`, `languages` ve `persona.answerLength` DB`ye yaziliyor (playbook.ts:244-275) ve `apps/api/src/services/ai/` altinda (ai-responder.ts · inference.ts · skill-engine.ts) HIC OKUNMUYOR. Yani persona bugun bir vitrin.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## (a) Bu isi doguran gerekce

tm 184.4 (M-TRACE-d · `cf9ad43`) PLAN.md damgalarini `prd-uyum-denetimi.md`ye (2026-08-30, 12 denetci +
12 curutucu ajan) karsi yeniden okudu ve v1`in 11 `Must` satirini `✅`ten `◐`ye indirdi; §F.00`in mekanik
kurali geregi ("bir faz ancak `Must` kapsaminda 0 ◐ ve 0 ⬜ kaldiginda kapanir") v1 kapisi `❌ ACIK`a dondu.
tm 186 o 11 kalemi tek tek triyaj etti: `08.5.5` denetimden SONRA kapanmisti (G1), `05.1` ve `05.3`in
kalan bosluklari **ADR-14 ile kapsam disi** cikti (damga `✅`e alindi), kalan 8 kalem is gorevine
donusturuldu. Bu gorev o gorevlerden biridir.

Kapanis kosulu tek: **PRD kabul kriteri (KK)**. "Kod var + test yesil" YETMEZ — GL-3/GL-4/GL-8`in hatasi
tam olarak buydu ve M-TRACE ailesi (tm 184.1-184.3) bu kapiyi teshis etti. Kanit blogu PLAN.md`nin
`## K. Kanit Gecmisi` bolumundedir (`#### K<kod>`), tablo hucresinde DEGIL (CONVENTIONS §1.2).

**Denetim metni KIRIK — ona guvenme.** `prd-uyum-denetimi.md` Ek A`nin "Eksik olan" hucresi kaynagında
`…` ile kesiliyor (ornek: `FR-MOD-06.2.4` "Eksikler…"). Karar PRD`nin KK sutununa + koda karsi verilir;
asagidaki "Eksik olan" maddeleri tm 186 turunda `grep`/`sed` ile FIILEN dogrulandi, denetimden
kopyalanmadi.

## (b) Kapsanan PLAN satiri

| PLAN satir (2026-09-04) | Kod | Kanit blogu |
| --- | --- | --- |
| 588 | 06.4 | `#### K06.4` |

## (c) Eksik olan (olculdu, 2026-09-04)

- Sema: `AiAgent.tone` (schema.prisma:1403) · `languages` (:1405) · `persona` JSON (:1402,
  `answerLength` iceride, playbook.ts:248-262).
- `grep -n "tone" apps/api/src/services/ai/*.ts` -> **0 sonuc**. Uc dosyanin hicbiri persona okumuyor.
- Cevap metni `skill-engine.ts`ten geliyor: `send_message` adiminda ya sabit `step.text` (:260-262)
  ya da bilgi tabanindan turetilen yanit. Persona bu yolun HICBIR noktasina girmiyor.

## (d) Dokunulacak dosyalar

- `apps/api/src/services/ai/skill-engine.ts` — `send_message` sonucunu ureten yer (:224-272).
- `apps/api/src/services/ai/ai-responder.ts` — motoru cagiran kopru (persona`yi tasiyacak taraf).
- `apps/api/src/services/ai/inference.ts` — deterministik saglayici dikisi.
- `apps/web/src/features/playbook/ProfileForm.tsx` — `PersonaPreview`in bugunku yeri.

## (e) Bilinen tuzaklar

1. **Determinizm sart.** LLM MOCK`lanir (MASTER-PROMPT): personanin etkisi rastgele degil, testte
   sabit ve iddia edilebilir olmali. "Model daha kibar yazar" test edilemez; "kisa cevap N cumleyi
   asmaz" edilebilir.
2. **Persona bir GUVENLIK sinirini gevsetmemeli.** `tone` kullanici metnidir; bir prompt`a
   birlestiriliyorsa enjeksiyon yuzeyi acar. Serbest metni motorun karar mantigina DOGRUDAN
   gecirmeden once sinirla/normalize et.
3. **`12.x` Copilot ayri bir ajandir** (`kind: copilot`) ve kendi bilgi tabanina sahiptir; musteriye
   bakan personanin Copilot`a sizmasi bir regresyondur.
4. Ikamet/inference kapisi (`request.requireAiInference()`, ai-responder.ts) korunur.

## Kapsam SINIRI

Persona `06.4` satiridir. `06.5` (Performance KPI`lari, Should) ve `06.1` (sekmeler, ✅) kapsam disi.
Yeni bir LLM saglayicisi EKLENMEZ; mevcut deterministik stub genisletilir.

## Kapanista yapilacak PLAN.md guncellemesi

Ilgili `Must` satirinin damgasi `◐ → K<kod>` yerine `✅ → K<kod>` olur (PLAN.md §4.1/4.2/4.3; satir no
`grep -n` ile bulunur — 2026-09-04 itibariyle gecerli satir numaralari yukarida yazili, dosya degistikce
kayar). Tek bir alt-gorev bir satiri tek basina kapatiyorsa o satiri o alt-gorev cevirir. Kanit tablo
hucresine YAZILMAZ; `#### K<kod>` blogunun sonuna madde olarak eklenir:
`- ✅ <ne yapildi> — `<dosya>` · test `<dosya>` (n) · tm <id>`.
v1 `Must` sayaci (PLAN.md:19 kapi tablosu) her kapanan satirda guncellenir.

Kapanis dogrulamasi: `grep -n "| 06.4 " PLAN.md`
cikan durum-damgali satirlarda `◐` KALMAMALI.

**Test Strategy:**

Aile ancak iki alt-gorevin ikisi de DoD kapisindan gectiginde done. Kapanista `grep -n "| 06.4 " PLAN.md` cikan durum-damgali satirda `◐` KALMAMALI.

## Subtasks

### 199.1. V1-PERSONA-a [OPUS-XHIGH] Persona motora ulassin: tone/languages/answer_length cevaba etki etsin (FR-MOD-06.4)

**Status:** done  
**Dependencies:** None  

Persona uc alani (`tone`, `languages`, `persona.answerLength`) `skill-engine.ts`in urettigi cevaba deterministik ve olculebilir bicimde etki etsin. Bugun etkisi SIFIR.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Yapilacak

1. Persona`yi `AiResponder` uzerinden motora tasi (mevcut opsiyonel-bagimlilik deseni:
   `publisher?`/`mailer?`/`channels?` — ayni sozlesme).
2. Etkiyi SAF bir yardimciya ayir (ornegin `applyPersona(text, persona)`) ve orada test et:
   - `answerLength`: `short`/`medium`/`long` icin uzunluk butcesi (cumle/karakter) — kesme
     kelimeyi ortadan bolmez.
   - `languages`: destelenmeyen bir dilde gelen soru icin davranis ACIKCA tanimli olsun
     (ornegin varsayilan dile dus ya da devret) — sessizce yok sayma.
   - `tone`: normalize edilmis, sinirli bir kume uzerinden (serbest metin dogrudan mantiga girmez).
3. Persona TANIMSIZ ise bugunku davranis BIREBIR korunur — mevcut testler degismeden yesil kalmali.

## Bilinen tuzaklar

- Determinizm: `inference.ts` deterministik stub`dir; rastgelelik EKLEME.
- Sabit `step.text` cevaplarinda (source: text) personanin uzunluk kirpmasi admin`in yazdigi
  metni bozabilir. Hangi kaynaga uygulandigini KARARLASTIR ve `#### K06.4` blogunda yaz.
- Copilot (`kind: copilot`) bu yoldan ETKILENMEMELI — ayri yuzey, ayri persona.
- Docker kapaliyken entegrasyon testleri asilir — once `docker info`.

## Kapsam SINIRI

Yalniz backend etkisi. Widget/e2e kaniti 199.2.

### 199.2. V1-PERSONA-b [SONNET-XHIGH] Musterinin gordugu cevap personayla degisiyor — widget/e2e kaniti (FR-MOD-06.4)

**Status:** done  
**Dependencies:** None  

PRD KK: "Widget`ta persona gorunur; cok dilli; zorunlu isim". Ad+avatar zaten gorunuyor ve zorunlu isim e2e ile kanitli; eksik olan, personanin CEVABA etkisinin musteri yuzeyinde kanitlanmasi. 199.1`in backend etkisi widget`tan ucdan uca gorulur olmali.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> resume -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1 (parcalama §1.3, Docker onkosulu §1.4); git akisi §2; handoff bicimi §4;
test<->gereksinim etiketi §7 (yeni/degisen test basligina `(FR-MOD-...)` yazilir). Sinirlar `CLAUDE.md`.
Contract-first sira (MASTER-PROMPT): OpenAPI + @siyahtus/types -> migration -> backend + unit -> frontend +
typed client -> E2E. Etiket = model x efor (PLAN §5.1.1), run-loop basliktan okur.

## Yapilacak

1. `apps/e2e`: persona `answer_length` degistirilir -> widget`tan ayni soru sorulur -> musterinin
   gordugu cevabin uzunlugu OLCULEBILIR bicimde degisir.
2. Cok dillilik: `languages` ayarina gore widget cevabinin dili/davranisi 199.1`de tanimlanan
   kuralla ortusur.
3. `ProfileForm.tsx`in `PersonaPreview`i, motorun GERCEK davranisiyla ayni yardimciyi kullansin —
   yoksa onizleme bir sey vaat eder, urun baskasini yapar (bugunku durum tam olarak budur).

## Bilinen tuzaklar

- `apps/e2e` sabit portlarda ve tohumlu `siyahtus` veritabaninda kosar; iki pencere ayni anda e2e
  kosamaz. Once bayat dev sunucu birakilmadigini dogrula (port 5173) — bayat sunucu ~126 testi
  toptan dusurur ve kod kusuru gibi gorunur.
- `pnpm -w test:e2e` kok `.env`i kendiliginden ALMAZ: `set -a && . ./.env && set +a && pnpm -w test:e2e`.
- Bir e2e turu ~84 `apps/e2e/kanit/*.png` yeniden yazar — beklenen churn, geri alma.
- Bir e2e kirmizisi senin turundan ONCE de var olabilir: once `test-results/*/error-context.md` oku.

## Kapsam SINIRI

Yalniz `06.4`un widget/e2e kaniti. Widget gorunum ayarlari (`11.7`, Should) kapsam disi.
