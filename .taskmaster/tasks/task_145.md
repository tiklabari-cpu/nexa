# Task ID: 145

**Title:** SEC-1 [OPUS-MAX] Bölge kapısı (C4-b) REST kenarında istemci başlığıyla aşılıyor: `plugins/auth.ts` `X-Region`'ı karşılaştırmanın SOL tarafı yapıyor — dört kapıdan biri diğer üçüyle çelişiyor

**Status:** done

**Dependencies:** 142 ✓

**Priority:** high

**Description:** tm 142 (M-SEC) salt-okuma denetiminin HIGH bulgusu. Kimliği doğrulanmış REST kenarında veri-ikametgâhı (NFR-C4 · C4-b) kararı, tamamen saldırgan denetimindeki `X-Region` isteği başlığına dayanıyor. Çağıran, çalışma alanının KENDİ bölgesini başlıkta bildirdiğinde karşılaştırma her zaman geçiyor — hangi dağıtımın cevapladığından bağımsız olarak. Aynı kural diğer üç kapıda (widget token mint · signup · RTM login) süreç kendi bölgesiyle yazılmış; yani kural üç yerde bir, bir yerde başka şey söylüyor — `servesRegion`'ın doc-comment'inin tam olarak önlemeyi vaat ettiği durum.

**Details:**

BULGU (koda karşı okundu, tm 142):

`apps/api/src/plugins/auth.ts:236-239`
```
const requestedRegion = request.headers['x-region'];
const targetRegion = typeof requestedRegion === 'string' ? requestedRegion : env.SIYAHTUS_REGION;
if (!servesRegion(targetRegion, resolved.region)) { ... 421 ... }
```
`servesRegion(serving, home)` = `serving === home` (`packages/types/src/domain.ts:180`). `resolved.region`
kimlik bilgisinden (DB: `organizations.region`) gelir — bu doğru. Sorun SOL taraf: başlık varsa
karşılaştırmanın "serving" yarısı ÇAĞIRANIN yazdığı dize olur.

- Başlıksız: `env.SIYAHTUS_REGION === resolved.region` → süreç `us`, çalışma alanı `eu` ise **421** (doğru).
- `X-Region: eu` ile: `'eu' === 'eu'` → **200**. 421 kayboluyor, `security.region_rejected` denetim
  satırı da hiç yazılmıyor.

Yani başlık "yalnız daraltır" DEĞİL — **genişletir**: reddi kabule çevirir. `routes/account-lifecycle.ts:102-108`
yorumu bunun tersini varsayıyor ("There the header can only narrow — the right-hand side is read from the
database and no header can move it"); doğru gözlem (sağ taraf oynatılamaz) yanlış sonuca bağlanmış, çünkü
kapıyı geçirten SOL taraftır.

DİĞER ÜÇ KAPI SÜRECİN KENDİ BÖLGESİNİ KULLANIYOR (çelişki burada):
- `apps/api/src/routes/auth.ts:723` — widget token mint: `servesRegion(env.SIYAHTUS_REGION, region)`
- `apps/api/src/routes/account-lifecycle.ts:108` — signup: `servesRegion(env.SIYAHTUS_REGION, region)`
- `apps/rtm/src/auth.ts:120` ve `:187` — RTM login (agent ve customer): `servesRegion(this.region, ...)`

TESTLER BOŞLUĞU GÖRMÜYOR: `apps/api/test/integration/region.test.ts:578` "refuses a caller who names a
region the workspace does not live in" (`x-region: us`, çalışma alanı `eu` → 421) ve `:588` "serves a caller
who names the workspace region correctly" (`x-region: eu` → 200). Test ortamında `SIYAHTUS_REGION=eu` olduğu için
iki durum çakışıyor; hiç ölçülmeyen senaryo tam da kapının var olma sebebi: **süreç `us`, çalışma alanı `eu`,
çağıran `X-Region: eu` yolluyor**. Kod bu durumda 200 döner.

SÖMÜRÜLEBİLİRLİK KOŞULU (dürüstçe): kapı ancak bölgesel kapıların aynı veriye ulaşabildiği bir kurulumda
(paylaşılan/replike veritabanı — bu deponun tek-dağıtım modeli) fiilen iş yapar; tamamen ayrık veritabanları
olsaydı token zaten çözülemezdi. Ama kusur topolojiden bağımsız olarak nesnel: bir güvenlik karşılaştırmasının
bir yarısı istek başlığından geliyor ve doğru değeri yazmak 421'i 200'e çeviriyor.

KABUL:
1. `plugins/auth.ts` karşılaştırması `servesRegion(env.SIYAHTUS_REGION, resolved.region)` olur — SOL taraf her
   zaman sürecin kendi yapılandırması, diğer üç kapıdaki gibi.
2. `X-Region` yine okunur ama YALNIZ daraltabilir: başlık `env.SIYAHTUS_REGION`'dan farklıysa istek reddedilir
   (kafası karışmış istemciyi düzeltme amacı korunur), hiçbir durumda kabule çeviremez.
3. Reddedilen her iki dalda da `security.region_rejected` yazılır (bugün bypass dalında hiç yazılmıyor).
4. `region.test.ts`'e ÜÇ yeni entegrasyon testi: (a) süreç bölgesi ≠ çalışma alanı bölgesi + çağıran çalışma
   alanının bölgesini `X-Region`'da bildiriyor → **421** (bugün 200); (b) aynı senaryoda `security.region_rejected`
   satırı yazıldı; (c) `X-Region` süreç bölgesiyle uyuşmuyorsa (çalışma alanı doğru olsa bile) → 421.
   Süreç bölgesini testte oynatmak için `SIYAHTUS_REGION`/`buildServer` env'i override edilir.
5. Dört kapının aynı kuralı uyguladığını gösteren bir yorum/test bağı; `servesRegion` doc-comment'indeki
   "üç kapı ayrışmasın" iddiası artık testle taşınır.

SINIR: yalnız bu kusur. `X-Region`'ın ürün anlamını genişletme, yeni bölge ekleme, RTM'e dokunma yok
(CONVENTIONS §5).

**Test Strategy:**

- `apps/api/test/integration/region.test.ts` — yukarıdaki (a)/(b)/(c) testleri; (a) düzeltmeden ÖNCE kırmızı olduğu gösterilir (kanıt HANDOFF'a).
- Mevcut region testleri (`region.test.ts` tamamı) regresyonsuz.
- Tam DoD kapısı (CONVENTIONS §1): typecheck · lint · format:check · test · test:integration · build. Kontrat/migration değişmiyor.
