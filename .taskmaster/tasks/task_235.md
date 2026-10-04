# Task ID: 235

**Title:** V8-WIDGET-RICH [OPUS-XHIGH] widget ajanin zengin metnini duz basiyor — musteri yildizlari harfiyen goruyor

**Status:** done

**Dependencies:** 208 ✓

**Priority:** medium

**Description:** apps/web transcript'i renderRichText ile basiyor, apps/widget ise bubble.textContent = event.text ile. Ajan **kalin** yazinca ziyaretci yildizlarla goruyor. tm 189.5'ten beri K02.3.5'te yazili ama gorevi yoktu; GL-13 (tm 208) karara bagladi.

**Details:**

(a) GEREKCE + KANIT (karar tm 208 · GL-13 · PLAN §D154):
`apps/web/src/features/inbox/Transcript.tsx:215` ajan mesajini `renderRichText(entry.input.text)`
ile basiyor — tm 189.5'in getirdigi kucuk markdown alt kumesi (`**kalin**` · `*italik*` · `- liste`),
`apps/web/src/features/inbox/richText.tsx`. Composer ayni alt kumeyi YAZMA tarafinda sunuyor
(bold/italic/list dugmeleri, `Composer.tsx:213-218`).
`apps/widget/src/widget.ts:2100` ise ayni metni **`bubble.textContent = event.text`** ile basiyor.
Sonuc: ajan `**onemli**` yazinca musteri `**onemli**` goruyor — yildizlariyla.

DIKKAT — KAYITTAKI SATIR REFERANSI YANLIS. `#### K02.3.5`'te `widget.ts` "~1539/1549" diye
geciyor; o satir bir **pre-chat form etiketidir** (`const marked = field.required ? label + ' *'
: label` -> `span.textContent = marked`), markdown ile ilgisi yok. Gercek yer **2100**.
tm 189.5 bunu "kapsam disi (bu gorev yalniz apps/web), yeni kalem ACILMADI" diye not dusmustu;
GL-13'un 8. tuzagi tam olarak bu sahipsizligi karara baglamayi istedi -> bu gorev odur.

(b) YAPILACAK IS:
1. `apps/widget`'e ayni alt kumeyi basan bir render (`renderRichText`in widget karsiligi).
   `packages/`e ORTAKLASTIRMAK cazip ama ZORUNLU DEGIL: `apps/web` React elemani uretiyor,
   widget DOM dugumu uretmeli — paylasilacak sey **parser**, renderer degil. Once parser'i
   ayirmayi degerlendir; maliyeti buyurse widget kendi kucuk parser'ini tasiyabilir, ama o
   zaman IKI YERDE ayni alt kume tanimlanir ve bu bir sapma olarak §D'ye yazilir.
2. **`innerHTML` KESINLIKLE YASAK** — NFR-S6 widget izolasyonunun acik kabul kriteri
   (`#### KS6`). `document.createElement` + `textContent` ile dugum kur.
3. **Musterinin kendi metni ASLA render edilmez.** `Transcript.tsx:287` bu kurali zaten yazili
   olarak tasiyor ("A customer's own text is never run through `renderRichText`"); widget
   tarafinda ayni ayrim `event`in yonune gore yapilir.
4. Ayni muameleyi hosted Chat sayfasi (`chat.html`) da almali — ayni `widget.ts` kodundan
   besleniyor, ayri bir yol acma.

(c) OLCULEBILIR KAPANIS: `apps/widget` birim testi — ajan mesajinda `**kalin**` bold dugumu
uretiyor, `*italik*`, `- liste`; **musteri mesajinda ayni girdi duz metin kaliyor**; `<img
src=x onerror=...>` gibi bir girdi hicbir kosulda element uretmiyor (XSS negatifi). e2e
`widget.spec.ts`e bir adim: ajan bicimli bir yanit gonderiyor, ziyaretci tarafinda yildiz
GORUNMUYOR ve `<strong>` var.

(d) BILINEN TUZAKLAR:
1. **NFR-P3 bundle butcesi** — widget'in gzip toplami 2026-09-07'de **22.602 B / 51.200 B**
   (loader 1.635 B / 8.192 B). Parser buyudukce butce daralir; `apps/widget/test/bundle-size.test.ts`
   kirmiziya doner. Ucuncu parti markdown kutuphanesi EKLEME.
2. `apps/widget` testleri `apps/web`inkilerden ayri kosar (`@siyahtus/widget` vitest); `TRANSLATED_FILES`
   kaydi web'e ozgudur, widget'te karsiligi yok.
3. e2e widget spec'leri gercek tarayicida iframe surer; `kanit/*.png` churn'u beklenir.

(e) KAPSAM SINIRI: **`02.3.5`'in damgasi bu gorevle DEGISMEZ** — o satirin KK'si composer
ARACLARINI sayar (canned/tag/emoji/attach + zengin metin girisi), musteri tarafindaki RENDER
`FR-MOD-11.x` widget payidir. Sunucu kontrati degismez (duz metin tasimaya devam), migration yok.
Widget composer'ina bicimlendirme dugmesi EKLENMEZ — bu gorev yalniz OKUMA tarafidir.

**Test Strategy:**

Birim (`@siyahtus/widget`): ajan mesajinda `**kalin**`/`*italik*`/`- liste` dogru dugumleri uretiyor; AYNI girdi musteri mesajinda duz metin kaliyor; XSS negatifi (`<img src=x onerror=alert(1)>` ve `<script>`) hicbir kosulda element uretmiyor ve `innerHTML` kod tabaninda hala kullanilmiyor (mevcut NFR-S6 nobetcisi yesil kalir). e2e: `widget.spec.ts`e bir adim — ajan `**kalin**` gonderir, ziyaretci panelinde `strong` gorunur ve yildiz metni gorunmez. Butce: `apps/widget/test/bundle-size.test.ts` yesil (50 KB gzip toplam / 8 KB loader) ve yeni sayi HANDOFF'a yazilir. Tam DoD kapisi (CONVENTIONS §1) exit 0.
