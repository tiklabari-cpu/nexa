# PLAN-EXPAND-PROMPT — Kalan Kapsamın Denetimi ve Alt-Görev Kırılımı

> Bu dosya bir **tek seferlik orkestratör görevidir**. Temiz bir Claude Code penceresinde
> çalıştırılır. Çıktısı yalnızca güncellenmiş `PLAN.md`'dir.

---

## 0) Rol, mod ve tek kural

Sen bu projenin tek sorumlu orkestratörüsün. Bu turda **ürün kodu YAZMIYORSUN**.
Görevin: `PLAN.md`'nin yapılmamış/yarım kalan kısımlarını PRD'ye ve **koda** karşı denetlemek,
her kalemin zorluğunu ölçmek ve planı **çok daha ince alt-görevlere** bölünmüş hâlde yeniden yazmak.

**Tek kural, her şeyin üstünde:** Bu planın bir kez daha "✅ görünüp aslında eksik" olmasına
izin verme. `PLAN.md §F`'de yazan ders aynen geçerli — yeşil test kapsamın tam olduğunu
göstermez, yalnız yazılan kodun çalıştığını gösterir. Bu yüzden **her durum yargısı koda
karşı doğrulanır**, `PLAN.md`'nin kendi iddiasına karşı değil.

**Bu turda izin verilenler:** dosya okuma, `grep`/`rg`, `git log`, salt-okunur DB/şema incelemesi,
`PLAN.md`'yi yazmak.
**Bu turda YASAK:** ürün kodu yazmak/düzeltmek, migration, test çalıştırıp düzeltmeye girişmek,
commit dışında repo durumunu değiştirmek, subagent'a iş dağıtmak (tek orkestratör kuralı),
`PLAN.md`'nin tarihçe bölümlerinin (§A–§F) mevcut metnini silmek/yeniden yazmak.
_(Ekleme serbesttir ve gereklidir: §C'ye varsayım, §D'ye sapma, §F'ye yeni `§F.0`/`§F.00`
alt bölümleri — bkz. Aşama D. Yasak olan mevcut satırları değiştirmek.)_

---

## 1) Bootstrap — bağlamı dosyalardan kur

Sırayla oku (hafızaya güvenme):

1. `CLAUDE.md` — proje kuralları, tek orkestratör, sınırlar.
2. `MASTER-PROMPT.md` — kilitli kararlar, contract-first akış, **Efor Kapıları** ve `[MAX]` listesi.
3. `CONVENTIONS.md` — DoD kapısı (bir alt-görevin "bitti" sayılması bu kapıdan geçer).
4. `PLAN.md` — tamamı. Özellikle §0 (ADR), §1.3 (neden yeniden düzenlendi), §3 (Faz 0),
   §4–§6 (v1/v2/Enterprise), §7 (NFR kapıları), §8 (şema artıkları), §C (varsayımlar),
   §D (sapmalar), §F (kapanış turu protokolü).
5. `urun-gereksinim-dokumani-PRD.md` — **ANA doğruluk kaynağı**. §5 fazlar, §6 `FR-MOD`
   modülleri (tüm satırlar **ve her satırın `KK` kabul kriterleri** — bunlar alt-görevlerin
   kabul kriteri olacak, Aşama C), §7 NFR, §8.4 veri modeli, §10.2 karmaşıklık,
   §11.1 kapsam dışı, §11.2 açık sorular.
6. `HANDOFF.md` — son durum, açık bırakılan bakiye.
7. `.taskmaster/tasks/tasks.json` — biten 19 task'ın **açıklama kalitesini** örnek al
   (dosya yolu + satır çapası + PRD kimliği + negatif test şartı). Yeni alt-görevler bu
   kalitede yazılacak.
8. Destekleyici kaynaklar, gerektiğinde: `rapor-1-fonksiyonel.md`, `rapor-2-teknik-mimari.md`,
   `v2-derin-analiz/*`, `prd-yeterlilik-degerlendirmesi.md`, `design-brief.md`.

**Doğruluk kaynağı sırası:** PRD → PLAN.md → MASTER-PROMPT.md. Çelişki varsa PRD kazanır ve
çelişki `PLAN.md §D`'ye sapma olarak yazılır. Şema için tek kaynak PRD §8.4 + rapor-2 §5.3;
`LiveChat_ER_Diyagram.mermaid` KULLANILMAZ.

---

## 2) AŞAMA A — Kapsam denetimi (koda karşı)

Amaç: "gerçekte ne var, ne yok" tablosunu **kanıtla** üretmek.

1. **PRD §6'daki tüm `FR-MOD` satırlarını çıkar** (yaklaşık 138 satır). Hiçbirini atlama;
   `PLAN.md`'de karşılığı olmayan satır varsa bu bir plan boşluğudur, işaretle.
2. Her satır için kodda karşılığını ara. Kanıt kaynakları:
   - `packages/contract/openapi/` — yol var mı?
   - `apps/api/src/routes/`, `apps/api/src/services/` — handler/servis var mı?
   - `apps/api/prisma/schema.prisma` + migration'lar — tablo/kolon var mı, **tüketicisi var mı**?
   - `apps/web/src/features/`, `apps/widget/src/` — ekran/bileşen var mı, **route'u var mı**?
   - `apps/api/test/`, `apps/e2e/tests/` — kabul kriterini fiilen doğrulayan test var mı?
3. Her satıra durum ver: `✅` (kod + test var) · `◐` (çekirdek var, PRD kabul kriteri eksik) ·
   `⬜` (kod yok) · `🔒` (sonraki faz) · `⛔` (kapsam dışı, gerekçeli).
   **`◐` ve `⬜` için mutlaka "neyin eksik olduğu" tek cümleyle yazılır** — o cümle alt-görevin
   tohumudur.
4. **`PLAN.md` ile fark raporu:** planın iddiası ile kodun gerçeği çeliştiği her satırı listele.
   Çelişki bulursan planın satırını **kodun lehine** düzelt ve farkı §D'ye yeni bir sapma
   maddesi olarak ekle (D19'dan devam et).
5. **Kapsam kaynakları — bunları da tara, yalnız §3–§6'yı değil:**
   - `PLAN.md §7.1` (FR-EK çapraz kesit desenleri) — `◐`/`⬜` olan her desen iş kalemidir.
   - `PLAN.md §7.2` (NFR kapıları) — `◐`/`⬜` olan her NFR iş kalemidir (S7 webhook, S12 audit
     yazıcısı, M5 OTel, C8 retention, I18N1/2, P4/P6 dahil).
   - `PLAN.md §8` (şema artıkları) — tüketicisi olmayan her tablo ya bir eksik özelliktir ya da
     silinmelidir; hangisi olduğuna karar ver ve iş kalemi üret.
   - `HANDOFF.md`'de "açık bırakılan Faz-0 bakiyesi" olarak sayılan kalemler.
   - **Sessiz borç taraması** (§F.1/6): `TODO`, `FIXME`, `XXX`, `@ts-expect-error`, `skip(`,
     `only(`, atlanmış test, kapatılmış lint kuralı. Bulunanların her biri ya alt-görev olur ya
     da gerekçesiyle "kabul edilen borç" diye §D'ye yazılır — sessizce durması üçüncü seçenek değil.
   - **Ölü kod / erişilemez yüzey** (§F.1/7): route'u olmayan bileşen, çağrılmayan servis,
     UI'ı olmayan endpoint.

**Aşama A çıktısı:** `PLAN.md`'ye yazılacak güncel durum tabloları + fark raporu. Bunu yazmadan
Aşama B'ye geçme.

---

## 3) AŞAMA B — Zorluk analizi ve efor etiketi

Açık kalan (`◐`/`⬜`) her iş kalemi için zorluğu **ölç**, tahmin etme. Rubrik:

| Boyut | Sorulacak soru | Ağırlık |
| --- | --- | --- |
| Güvenlik sınırı | Auth, scope, tenant izolasyonu, token, dosya, dış girdi sınırına dokunuyor mu? | Yüksek |
| Veri bütünlüğü | Yeni migration / invariant / partition / unique kısıt gerekiyor mu? | Yüksek |
| Eşzamanlılık | Yarış koşulu, kuyruk, atama, idempotency, soket durumu var mı? | Yüksek |
| Para | Faturalama, metering, kota, plan/koltuk aritmetiği var mı? | Yüksek |
| Kontrat yüzeyi | Yeni endpoint/şema mı, mevcut yüzeyi mi kullanıyor? | Orta |
| Katman sayısı | Kontrat + backend + UI + widget'ın kaçına dokunuyor? | Orta |
| Geri dönülemezlik | Yanlış yapılırsa veri kaybı / breaking change olur mu? | Yüksek |
| Belirsizlik | PRD kabul kriteri net mi, karar gerektiriyor mu? | Orta |

**Etiket kuralı (MASTER-PROMPT "Efor Kapıları" ile hizalı):**

- `[MAX]` — MASTER-PROMPT'un `[MAX]` listesine giren işler (RTM, tenant izolasyonu, OAuth/scope,
  chat→thread→event çekirdeği, routing/queue, webhook HMAC+SSRF, AI skill motoru) **ve**
  yukarıdaki rubrikte "Yüksek" ağırlıklı boyutlardan **en az birini** taşıyan her kalem.
- `[XHIGH]` — geri kalan her şey.
- **YUKARI YUVARLAMA (zorunlu):** Bir kalemin `[XHIGH]` mi `[MAX]` mı olduğu tartışmalıysa
  **`[MAX]` seçilir**. Gerekçe: `run-loop.sh` etiketten efor türetiyor
  (`[MAX]` → `max`, `[XHIGH]` → `xhigh`); yanlış tarafa yuvarlamanın bedeli asimetrik — fazla
  efor biraz zaman, az efor sessiz bir güvenlik/veri hatası. Yukarı yuvarlanan her kaleme
  satırında `↑` işareti ve tek cümle gerekçe yazılır.
- Etiket **alt-görev seviyesinde** verilir, üst kalem seviyesinde değil. Bir üst kalemin bir
  alt-görevi `[MAX]`, diğerleri `[XHIGH]` olabilir — genelde doğrusu budur.

---

## 4) AŞAMA C — Alt-görevlere bölme

Amaç: kalan işi, **tek temiz pencerede DoD kapısından geçebilecek** atomik parçalara indirmek.

### Atomiklik testi — bir alt-görev şu 5 şartı birden karşılar

1. **Tek pencere:** tek bir Claude Code penceresinde başlayıp `CONVENTIONS.md` DoD kapısından
   (typecheck + lint + unit + integration + build + ilgili E2E) geçebilir.
2. **Tek kabul kriteri:** "bitti mi?" sorusunun tek ve objektif cevabı vardır. İki farklı
   cevap gerekiyorsa iki alt-görevdir.
3. **Kendi testini taşır:** yazdığı kodu doğrulayan testi de kendi kapsamındadır.
4. **Bağımsız doğrulanabilir:** bir sonraki alt-görev yapılmadan da yeşil kalır (yarım bir
   yüzey bırakmaz).
5. **Tek PRD kimliği:** bir `FR-MOD` kimliğine (veya net bir alt maddesine) bağlıdır.
   İki kimlik taşıyorsa iki alt-görevdir.

### Gereksinim-düzeyi kabul kriteri (ZORUNLU — uydurma yok)

Her alt-görev, dayandığı `FR-MOD` satırının **PRD'deki kendi kabul kriterlerini (KK)** taşır.
Kural:

1. PRD'deki KK maddelerini **birebir kopyala** (`KK1`, `KK2`, … numaralarıyla). Yeniden yazma,
   özetleme, "ruhunu al" yok — kabul kriterinin sahibi PRD'dir.
2. Her KK maddesinin yanına **doğrulama yöntemini** yaz: hangi test dosyası / hangi komut /
   hangi E2E akışı bu maddeyi kanıtlayacak. "Gözle bakılır" geçersizdir.
3. Bir KK maddesi objektif olarak doğrulanamıyorsa (ölçüt belirsiz, veri yolu yok), bu bir
   **kırmızı bayraktır**: kalemi "spike/karar" alt-görevine çevir, belirsizliği `PLAN.md §C`'ye
   varsayım olarak yaz; uygulama alt-görevi ondan sonra gelir.
4. PRD'nin KK'sı yoksa (bazı Should/Could satırlarında olmayabilir), kabul kriterini sen yazarsın
   ama **kaynağını işaretle**: `KK-türetilmiş` + hangi PRD cümlesinden türetildiği. Türetilmiş
   her kriter §C'ye varsayım olarak da düşer.
5. **DoD kapısı (CONVENTIONS.md) ile KK aynı şey değildir.** DoD "kod sağlıklı mı"yı ölçer;
   KK "istenen şey oldu mu"yu. Bir alt-görev **ikisini birden** geçmeden done olmaz. tm 1–19'da
   done'ların ayakta kalmasının sebebi buydu; kaçırılan işlerin sebebi de KK'nın atlanmasıydı.

### Bölme sinyalleri — bunlardan biri varsa BÖL

- **Bir `FR-MOD`'un birden çok KK maddesi var ve hepsi tek pencerede kanıtlanamıyor → KK başına böl.**
  (En güvenilir bölme sinyali budur; katman sayısından daha iyi ayırır.)
- Kontrat/backend **ve** ekran birlikte → `-a` API + kontrat, `-b` ekran (tm 6/7 deseni).
- Yeni migration/tablo → migration + invariant testi ayrı bir `[MAX]` alt-görev.
- Güvenlik kuralı (doğrulama, allowlist, imza, tarama) → kendi `[MAX]` alt-görevi;
  **negatif testler pozitiflerden önce** yazılır ve kırmızı görülür.
- Agent tarafı + müşteri/widget tarafı → ayrı alt-görevler (iki farklı yüzey, iki farklı test).
- Liste + detay + düzenleme → ayrı alt-görevler.
- 3'ten fazla dosya/katmana dokunuyorsa → böl.
- Karar gerektiren belirsizlik varsa → karar ayrı bir "spike/karar" alt-görevi olur, kararı
  `PLAN.md §C`'ye yazar, uygulama ondan sonra gelir.

### Adlandırma ve numaralandırma

Biten işlerdeki desen sürdürülür: `<FR-MOD kimliği>-<harf> — <kısa başlık> [ETİKET]`
Örnek: `08.8.4-a — Webhook kayıt API + kontrat [XHIGH]`, `08.8.4-b — HMAC imzalama + SSRF guard [MAX]`.

### Her alt-görev için zorunlu alanlar

Aşağıdaki alanların **hepsi** doldurulur. Eksik alanlı alt-görev yazma:

| Alan | İçerik |
| --- | --- |
| **ID** | `<FR-MOD>-<harf>` |
| **Başlık** | Ne yapılacağı, tek satır |
| **PRD kimliği** | `FR-MOD-xx.x` (+ ilgili NFR: `NFR-Sxx` vb.) |
| **Etiket** | `[XHIGH]` / `[MAX]` (+ yukarı yuvarlandıysa `↑` ve gerekçe) |
| **Neden açık** | Şu an kodda ne var, ne yok — **dosya yolu + satır çapasıyla** |
| **Kapsam** | Dokunulacak dosyalar/katmanlar; contract-first sıra |
| **KK (gereksinim kabul kriteri)** | PRD'nin kendi `KK` maddeleri, **birebir**, numaralarıyla |
| **KK doğrulama yöntemi** | Her KK maddesi için: hangi test/komut/E2E akışı kanıtlayacak |
| **Zorunlu testler** | Birim / integration / E2E + **cross-tenant** + varsa negatif testler |
| **Bağımlılıklar** | Önce bitmesi gereken alt-görev ID'leri |
| **Kapsam dışı** | Bu alt-görüşte YAPILMAYACAK bitişik işler (faz sızıntısı kalkanı) |
| **Tahmin** | Kaç temiz pencere (1 = normal; 2+ ise muhtemelen daha bölünmeli) |

### Derinlik politikası (bilinçli — kör derinlik değil)

**`PLAN.md`'nin uzunluk sınırı YOKTUR.** Kaç alt-görev gerekiyorsa o kadar yazılır — 100 de olur,
400 de. Dosya uzunluğu asla bir bölme kararının gerekçesi olamaz. Buna bağlı üç yasak:

- **Kısaltma yasak:** "vb.", "benzer şekilde diğerleri", "…" ile liste bitirme yok. Her kalem
  açık açık yazılır.
- **Örnekleme yasak:** "örnek olarak 3 tanesi yazıldı, gerisi aynı desende" yok.
- **Sığdırma yasak:** pencere dolacak diye kalem birleştirme yok. Pencere dolarsa checkpoint'e
  yazıp kaldığın yerden devam edersin (bkz. Bölüm 6).

Derinlik kademeleri:

- **Faz-0 bakiyesi ve Faz-1 (v1):** TAM derinlik. Atomiklik testini geçene kadar böl.
  Sıradaki iş bunlardan çıkacak; ne kadar ince olursa "done" iddiası o kadar az saklanabilir.
- **§7 NFR kapıları ve §8 şema artıkları:** TAM derinlik (bunlar sessiz borcun yaşadığı yer).
- **Faz-2 (v2) ve Faz-3 (Enterprise):** ORTA derinlik — iş kalemi + zorluk etiketi + tahmini
  alt-görev sayısı + bağımlılık notu. Gerekçe **uzunluk değil, bayatlamadır**: o fazlar
  başlarken kod tabanı değişmiş olacak, bugün yazılan ince kırılım yanlış güven verir
  (`PLAN.md §1.2`: "Faz 1–3 durumları geçicidir, faz başlarken denetlenir").
  **İstisna:** bugün itibarıyla kapsamı net, bağımlılığı bilinen ve kod tabanı değişse de
  değişmeyecek bir v2/Enterprise kalemi varsa (ör. saf bir güvenlik kuralı), onu tam derinlikte
  bölmekte serbestsin. Bu politikayı `PLAN.md`'ye **açıkça yaz** ki sonraki pencere eksiklik sanmasın.

---

## 5) AŞAMA D — `PLAN.md`'yi yeniden yaz

### Korunacaklar (dokunma)

- §0 ADR tablosu (ADR'ler yeniden tartışılmaz).
- §1 (okuma kılavuzu, §1.3 kaydı), §9 (kapsam dışı), §A–§F (tarihçe, varsayımlar, sapmalar,
  bitti tanımı, kapanış turu protokolü).
- §C ve §D'ye **ekleme yapılır**, mevcut maddeler silinmez/yeniden yazılmaz.

### Güncellenecekler

- **§2 modül→faz matrisi** — Aşama A'nın bulgularıyla.
- **§3 (Faz 0)** — durum işaretleri düzeltilir; açık kalan her satırın altına alt-görev kırılımı
  eklenir.
- **§4 (v1)** — koda karşı denetlenmiş durumlar + tam alt-görev kırılımı.
- **§5–§6 (v2/Enterprise)** — orta derinlik kırılım (derinlik politikası gereği).
- **§7.1 / §7.2** — her `◐`/`⬜` kalem için alt-görev üretilir ve buradan referanslanır.
- **§8** — tüketicisi olmayan tabloların her biri bir alt-görüşe veya gerekçeli silme kararına bağlanır.
- **Baştaki faz özeti tablosu** — sayaçlar **sayılarak** üretilir, elle yazılmaz (§1.2 kuralı).
  Sayım yöntemini tek cümleyle yaz (hangi tablodan, hangi işaretler). Tabloya her faz için
  `Must` sayacı ayrı bir sütun olarak eklenir — `§F.00` kapısı bu sütundan okunur.

### Yeni bölüm: `§F.0 — Periyodik Denetim (mini kapanış turu)`

§F bugün yalnız **en sonda** çalışan bir protokol. Sorun şu: §1.3'teki 18 eksik gereksinim,
denetim en sona bırakıldığı için **aylarca** görünmedi. Bu yüzden §F.1'in maddeleri periyodik
hâle getirilir. §F'nin mevcut metnine **dokunma**; §F.1'den ÖNCE gelecek yeni bir `§F.0`
alt bölümü **ekle** ve şunları yaz:

**Tetikleyiciler (üçünden herhangi biri):**

- Her **dilim sınırı** (bir dilim kapanırken — zorunlu).
- Her **5 task'ta bir** (dilim uzunsa ortada bir kez daha).
- Bir task **blocked** kapandığında (bloke, çoğu zaman plan hatasının ilk belirtisidir).

**Her tetiklemede çalışacak çekirdek (§F.1'den, hafif sürüm):**

| # | §F.1 maddesi | Mini sürümde ne yapılır | Kanıt |
| - | ------------ | ----------------------- | ----- |
| 1 | Kapsam süpürmesi | Yalnız **o dilimin** `FR-MOD` satırları koda karşı denetlenir | Route/dosya listesi |
| 2 | Faz sızıntısı | Dilimde başka fazdan iş var mı | Evet/Hayır + §D kaydı |
| 3 | NFR kapıları | Dilimin dokunduğu NFR'ler ölçülür (tahmin değil) | Ölçüm çıktısı |
| 5 | Kontrat bütünlüğü | `contract-parity` testi çalıştırılır | exit code |
| 6 | Sessiz borç | Dilimde eklenen `TODO`/`skip`/`@ts-expect-error` taranır | grep çıktısı |
| 8 | Doküman tazeliği | Test sayısı + sayaç + "sıradaki adım" gerçekle uyuşuyor mu | Güncellenmiş satırlar |

**Tam sürüm (10 maddenin hepsi)** yalnız **faz kapanışında** ve projenin en sonunda çalışır.

**Kural:** Mini denetim kırmızıysa dilim kapanmaz. Bulgular ya düzeltilir ya yeni alt-görev
olarak plana girer ya gerekçesiyle §D'ye yazılır — dördüncü seçenek yoktur.

### Yeni bölüm: `§F.00 — Faz Kapanış Kapısı (sayaca bağlı)`

Faz kapanışı düzyazı bir karar olmaktan çıkarılır ve **sayaca bağlanır**. `§F.0`'ın hemen
üstüne (veya §3.11'in generalleştirilmiş hâli olarak) şu kuralı yaz ve **her faz bölümünün
sonuna** o fazın kendi kapanış kapısını ekle:

> **Bir faz ancak o fazın `Must` kapsamında `0 ◐` ve `0 ⬜` kaldığında kapanır.**

Kuralın uygulama detayları — bunları da yaz, yoruma bırakma:

- **Sayım kaynağı:** o fazın §3/§4/§5/§6 tablolarındaki işaretler. Sayaç **sayılarak** üretilir,
  elle yazılmaz (§1.2).
- **`Should` kalemleri** kapanışı bloklamaz, ama kapanış raporunda **ismen** listelenir ve
  ya sonraki faza taşınır ya §D'ye "kabul edilen borç" olarak yazılır. Sessizce düşemez.
- **`🔒` ve `⛔`** sayaca girmez, ama her birinin gerekçesi satırında yazılı olmalıdır;
  gerekçesiz `🔒` bir kapanış engelidir (gizlenmiş `⬜` olabilir).
- **`◐` kaldıramaz:** "çekirdek var, kabul kriteri eksik" hâli tam olarak yarım kalmış işin
  kendisidir (§F.1/1). Bir `◐`'yi kapatmanın iki yolu var: tamamla, ya da kapsamı daraltıp
  kalanı gerekçeli yeni bir kaleme ayır (§D'ye sapma).
- **Kapanış anında** §F.1'in **10 maddesinin tamamı** çalıştırılır (mini sürüm yetmez).
- Faz kapanış raporu `HANDOFF.md`'ye yazılır: sayaç (kaç ✅ / ◐ / ⬜ / 🔒 / ⛔), taşınan
  `Should` kalemleri, yeni sapmalar.

**Faz-0 için özel not:** Bugünkü sayaç `48 ✅ · 5 ◐ · 1 ⬜`. Bu kurala göre **Faz-0 kapanmamıştır**.
Kalan kalemleri (07.1 / 07.3.1 / 07.3.2 / 07.3.3, 00.4, S12 audit yazıcısı, M5 OTel, C8 retention,
i18n, 08.8.2 PAT UI) tam derinlikte alt-görevlere böl ve `Must`/`Should` ayrımını her birinin
satırında açıkça göster — hangilerinin kapanışı bloklayıp hangilerinin bloklamadığı sayaçtan
okunabilsin.

### Yeni bölüm: `§G — İş Kırılımı Dizini (Task Master aktarımı için)`

`PLAN.md`'nin sonuna, tarihçeden **önce** gelecek şekilde tek bir düz tablo ekle. Bu tablo
Task Master'a aktarımın kaynağıdır; her satır bir alt-görevdir ve §4'teki alanları taşır:

`ID | Başlık | PRD | Etiket | Bağımlılıklar | Faz | Dilim önerisi | Tahmin (pencere)`

Ek olarak §G'nin başına şunları yaz:

- **Önerilen dilim gruplaması:** alt-görevler 3–8 kalemlik dilimlere gruplanır; her dilimin
  bir teması, bir kapanış kapısı ve bir `§F.0` mini denetim noktası olur (Dilim 13 brief'inin deseni).
- **Toplamlar:** kaç alt-görev, kaçı `[MAX]`, kaçı `[XHIGH]`, faz başına dağılım, toplam
  tahmini pencere sayısı.
- **Kritik yol:** bağımlılık zinciri en uzun olan hat.
- **Faz kapanışını bloklayanlar:** `Must` kapsamındaki kalemler ayrı işaretlenir (`§F.00`
  kapısının girdisi budur).

> Bu tabloyu Task Master'a **sen aktarmayacaksın** — kullanıcı kendi dönüştürecek. Senin işin
> tablonun aktarıma hazır olması: her satır kendi kendine yeter, eksik alan yok, bağımlılıklar
> ID ile verilmiş.

---

## 6) Uygulama disiplini (bu turda sana ait kurallar)

- **Faz sızıntısı yasak.** Faz-0'ın açığı dururken v1 işi öne çekilmez (§1.3'teki hatanın
  tekrarı). Bir kalem yanlış fazdaysa `PLAN.md §D`'ye yaz, sessizce taşıma.
- **PRD kimliği olmayan iş yazılmaz.** İhtiyaç PRD'de yoksa ya §9'a (kapsam dışı) ya §D'ye
  (sapma) yazılır — plana kimliksiz satır girmez.
- **Varsayım yaparsan** `PLAN.md §C`'ye "A<n>" olarak yaz; onay bekleme, ama gizleme.
- **Checkpoint:** Aşama A bitince, Aşama C bitince ve Aşama D bitince `PLAN.md`'yi diske yaz.
  Ayrıca **her modül (`FR-MOD-xx`) kırılımını bitirdiğinde** yaz — uzunluk sınırı olmadığı için
  iş büyük; tek seferde yazmaya çalışma. Her yazımdan sonra dosyanın sonuna
  `<!-- KIRILIM DURUMU: son işlenen = FR-MOD-xx.x · sıradaki = FR-MOD-yy.y -->` satırını güncelle
  ki pencere dolarsa bir sonraki pencere kaldığın yerden devam etsin. İş bitince bu satırı sil.
- **Pencere dolarsa:** işi kısaltarak bitirme. Checkpoint'i yaz, ne kaldığını raporla, dur.
  Yarım ama dürüst bir kırılım, tam ama uydurma bir kırılımdan iyidir.
- **Kapsam disiplini:** bu turda yalnız `PLAN.md` (ve gerekiyorsa `HANDOFF.md`'ye tek bir not)
  değişir. Başka dosyaya dokunma.
- Bitince commit: `docs(plan): kalan kapsamı denetle ve alt-görevlere böl`. Push serbest,
  merge/force-push yok.

---

## 7) Final rapor (Türkçe, tek mesaj)

İş bitince şunları ayrı ayrı ver:

1. **Denetim farkı** — `PLAN.md`'nin iddiası ile kodun gerçeği arasında bulunan her çelişki.
2. **Kalan kapsam** — faz faz, PRD kimlikleriyle, sayılarla.
3. **Kırılım özeti** — kaç alt-görev üretildi; `[MAX]`/`[XHIGH]` dağılımı; yukarı yuvarlananlar
   ve gerekçeleri; KK'sı PRD'de bulunamayıp türetilen kalemler.
4. **Faz kapanış durumu** — `§F.00` kuralına göre her fazın sayacı ve kapanışı bloklayan
   `Must` kalemleri (isim isim).
5. **Önerilen sıra** — hangi dilim önce, neden (bağımlılık + risk).
6. **Sessiz borç** — bulunan `TODO`/`skip`/ölü kod listesi ve her birinin akıbeti.
7. **Yeni sapmalar ve varsayımlar** — §D ve §C'ye eklenenler.
8. **Karar bekleyen açık sorular** — PRD §11.2 ile karşılaştırmalı, her biri tek cümle.

> Rapor "tamamlandı" diyorsa, Aşama A'nın kod denetimi fiilen çalıştırılmış olmalıdır.
> Denetimsiz "bitti" raporu bu projede bir kez zaten yanlış çıktı (§1.3).

---

**BAŞLA:** Önce Bölüm 1'deki kaynakları oku, sonra Aşama A → B → C → D sırasıyla ilerle.
Bu turda ürün kodu yazma.
