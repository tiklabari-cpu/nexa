# CONVENTIONS — Definition of Done, Git ve Handoff Kuralları

Bu dosya otonom döngünün "objektif kapısı"dır. Her task bunlara uymadan **done** sayılmaz.

## 1) Definition of Done (DoD) kapısı

Bir task ancak AŞAĞIDAKİLERİN HEPSİ yeşilse "done" işaretlenir. Hepsi komutla + exit code ile
doğrulanır; "gözle baktım oldu" geçersizdir.

- [ ] Type-check temiz — `pnpm -w typecheck` (exit 0)
- [ ] Lint temiz — `pnpm -w lint` (exit 0)
- [ ] Format temiz — `pnpm -w format:check` (exit 0)
- [ ] Unit testler geçiyor — `pnpm -w test` (exit 0)
- [ ] Integration testler geçiyor (gerçek Postgres+Redis'e karşı) — `pnpm -w test:integration`
- [ ] Build başarılı — `pnpm -w build` (exit 0)
- [ ] İlgili E2E/smoke geçiyor — `pnpm -w test:e2e` (task'ın kapsadığı akış)
- [ ] Kontrat (OpenAPI) değiştiyse üretilen tipler günceldir — `pnpm -w contract:generate`
      sonrası `git status --short packages/contract/src/generated` boş (CI aynı adımı zorunlu
      tutar, ci.yml "Verify generated types are in sync with the spec")
- [ ] Migration eklendiyse şema sürüklenmesi yok — `pnpm -w db:check-drift` (exit 0)
- [ ] Task'ın kendi kabul kriteri (Task Master'daki test stratejisi / PRD FR KK) karşılandı
- [ ] Yeni kod için test yazıldı (kapsam anlamlı; çıplak endpoint/servis testsiz kalmaz)
- [ ] **Gereksinim kapsama denetimi temiz** — `pnpm audit:req-coverage` (exit 0; CI'da "Requirement
      coverage" adımı, §1.5). Yeni yazılan/değişen bir test bir PRD kabul kriterini koruyorsa
      CONVENTIONS §7'nin biçimiyle etiketlenir. Kapı **kapsama borcunu kırmızı yapmaz** (§7.5
      kademeli benimseme) — yalnız raporun kendi hakkında yalan söylemesinde kırmızı verir.
- [ ] **PLAN.md gereksinim satırı güncellendi** — task'ın PRD kodundaki satır(lar) `⬜`/`◐` → `✅`.
      Doğrulama: `grep -n '| <PRD kodu>' PLAN.md` çıktısındaki **durum damgalı** satırlarda `⬜`
      kalmamalı. Bir task birden çok satır kapatıyorsa hepsi. Kısmen karşılandıysa `◐` + eksik
      açıklaması doğru cevaptır; `✅` uydurmak bu kutuyu geçmez.
- [ ] **Kanıt `## K. Kanıt Geçmişi`ne yazıldı, tablo hücresine DEĞİL** (§1.2). Doğrulama:
      `grep -n '^#### K<kod>' PLAN.md` bloğu var ve bu task'ın maddesi (`tm <id>`) içinde.

> Not: repo script adları farklıysa `package.json`'daki gerçek script'leri kullan; yoksa
> önce onları ekle. Kapı komutları repo büyüdükçe bu dosyada güncellenir.

### 1.2 PLAN.md kanıt disiplini: hücrede damga, dipnotta geçmiş (2026-08-09)

Gereksinim tablosunun durum hücresi **yalnız** şu biçimdedir — başka hiçbir şey değil:

```
✅ → K07.7        ◐ → K09.3        ⬜
```

Kanıt (`ne yapıldı — dosya · test (n) · tm <id>`) `## K. Kanıt Geçmişi` bölümündeki
`#### K<kod>` bloğuna **madde olarak eklenir**; var olan maddeler silinmez.

Neden: her alt-görev aynı hücreye kanıt ekliyor, kimse silmiyordu. Ölçüldü (2026-08-09):
tek satır **32.480 karakter** (~10k token), 16 ayrı `tm` kanıtı iç içe. Çıplak bir `grep -n`
o satıra denk geldiğinde pencerenin bağlamının onda birini tek komutta yakıyordu; tm 65.8
satırı okuyabilmek için `sed`/`awk`/`grep -o`/`substr` sırayla denedi — dördü de boşa tur.
Kanıt metnindeki kaçırılmamış `|` karakterleri ayrıca 8 satırı 5 sütunluk tabloda 6-10 hücreye
bölüyordu, yani **panel o satırların durumunu yanlış okuyordu**. Taşıma sonrası en uzun tablo
satırı 526 karakter, hücre uyuşmazlığı 0.

Bu kuralı panelin sağlık taraması denetler (`C-plan-row-length`): eşiği aşan tablo satırı
bulunursa bulgu açılır. Yani kural yalnız iyi niyete bırakılmadı.

İstisna: **faz özet tablosu** (`| Faz | PRD | Genel durum | Must sayacı | Kapanış |`) bu
kuralın dışındadır — oradaki hücre bir sayım kaynağıdır (`54 ✅ · 0 ◐`), panel `statedCounts`
olarak okur. Ona dokunma.

### 1.1 Kapının objektifliği: test veri depoları koşu başına izole (tm 105)

`@nexa/api` ve `@nexa/rtm` gerçek Postgres + Redis'e karşı koşar ve her süit TRUNCATE ile
başlar. Eskiden aynı anda açık iki pencere aynı `nexa` veritabanını paylaştığı için birbirinin
fixture'ını siliyordu; sonuç, o pencerenin HİÇ DOKUNMADIĞI dosyalarda yüzlerce kırmızıydı
(ölçüldü: art arda iki koşuda 889 → 982). Kapı bu durumda objektif değildi.

Artık bu iki paketin `test` / `test:unit` / `test:integration` script'leri
`apps/api/scripts/with-test-datastores.ts` üzerinden geçer: her koşu kendi `nexa_test_<id>`
veritabanını (oluştur → `migrate deploy` → koşu sonunda düşür) ve kendi Redis mantıksal
veritabanını (1-15) alır. Koşu başına ~3 sn. Test/fixture tarafında değişiklik gerekmez —
harness yalnız `DATABASE_URL` / `DATABASE_APP_URL` / `REDIS_URL`'i yeniden yönlendirir.

Pencere için iki sonuç:

- `pnpm -w test` artık `--concurrency=1` istemez; turbo paralelliği güvenlidir.
- **Bir kırmızıyı "başka pencere yazıyordur" diye açıklama.** İzolasyon açıkken kırmızı ya
  senin değişikliğindendir ya da HANDOFF/Task Master'da kayıtlı bilinen bir kusurdur; ikisi de
  değilse gerçek bir regresyondur.

İstisna: `apps/e2e` sabit portlarda gerçek sunucuları ve seed'lenmiş `nexa` veritabanını sürer;
iki pencere aynı anda e2e koşamaz. Paylaşılan veritabanına karşı koşmak (bir testin bıraktığı
veriyi elle incelemek) için: `NEXA_TEST_ISOLATION=off`.

### 1.3 Kapıyı KOŞMAK da objektif olmalı: `--force` ve parçalama (tm 129)

§1.1 test veri depolarını izole ederek kapının _sonucunu_ objektif yaptı. tm 129 kapının
_determinizmini_ kapattı (mobil jest artık `NODE_ENV`'i pinliyor, kendi `testTimeout`/
`asyncUtilTimeout`'unu ve `maxWorkers`'ını taşıyor — §D112-ÇÖZÜM). Geriye iki **koşma** toleransı
kalıyor; ikisi de kuralı bilmeyen pencereyi yanıltır:

- **turbo `test` görevini önbelleğe alır.** Girdiler değişmediyse `pnpm -w test` yeniden koşmaz,
  `FULL TURBO` deyip son sonucu döndürür (ölçüldü: 49 ms). Bu normal ve istenen — ama "kapıyı üç kez
  koşturdum, üçü de yeşil" demenin hiçbir anlamı yok demektir. Bir kırmızıyı kovalarken ya da bir
  flake düzeltmesini kanıtlarken **`--force` şart**:
  `npx turbo run test --force --filter=!@nexa/e2e`. Normal DoD kapısında `--force` gerekmez.
- **Tek komut olarak kapı, bir pencerenin komut tavanını aşar.** `@nexa/api`'nin `test` script'i unit
  **ve** integration'ı birlikte koşar, `fileParallelism: false` ile sırayla: tek başına ~858 s, yani
  `pnpm -w test` ~15 dk. Pencerenin komut tavanı 10 dk. `pnpm -w test:integration` için zaten
  kullanılan çözüm burada da geçerli — **parçala ve her parçanın exit code'unu yaz**; içerik aynı
  kaldığı sürece kapı geçilmiş sayılır:

  ```
  npx turbo run test --force --filter=!@nexa/e2e --filter=!@nexa/api   # ~1 dk
  npx turbo run test:unit --force --filter=@nexa/api                   # ~30 sn (54 dosya)
  # ×3 (shard 1/3, 2/3, 3/3) — ~5 / 4 / 2,5 dk
  cd apps/api
  npx tsx scripts/with-test-datastores.ts vitest run --dir test/integration --shard=1/3
  ```

  Bölünmüş koşu kapıyı zayıflatmaz: her parça kendi izole veritabanını alır (§1.1) ve parçaların
  birleşimi `pnpm -w test`'in dosya sayısıyla birebir aynıdır (api **70 + 110 = 180**; sayı
  2026-08-30'da GL-11 · tm 158 turunda yeniden ölçüldü — metin "54 + 90 = 144" ile bayattı,
  Faz-5/Faz-6 arayı doldurdu). HANDOFF'a "parçalandı" diye yaz ki bir sonraki pencere sayıları
  eşleştirebilsin.

### 1.4 Kapının önkoşulları: iki sessiz tuzak (2026-08-31)

İkisi de kapıyı kırmızı yapmaz — **hiç cevap vermez**, o yüzden yavaş süit ya da gerçek regresyon
sanılır. Ölçüldü, kaybedilen tur sayısıyla birlikte.

- **Docker kapalıyken entegrasyon testleri ASILIR.** `with-test-datastores.ts` hızlı düşmez:
  10+ dakika boyunca **0 bayt çıktı** verir. Kapıyı koşmadan önce `docker info` ile bak. Kapalıysa
  exe **`%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe`** — `C:\Program Files\...`
  altında DEĞİL, kullanıcı kurulumu. Sonra `docker compose up -d`; `nexa-db` host portu **5433**,
  `nexa-redis` **6380**. psql kullanıcısı **`nexa`** (`-U postgres` → "role does not exist"),
  container'a komut geçerken `MSYS_NO_PATHCONV=1` gerekir. Volume'lar restart'ta korunur, yani
  e2e'nin beklediği tohumlu `nexa` veritabanı yerinde kalır.

- **`pnpm -w test:e2e` kök `.env`'i kendiliğinden ALMAZ.** Playwright'ın kaldırdığı RTM sunucusu
  60 saniyede `DATABASE_URL: Required` ile düşer ve bütün süit "webServer timeout" verir. Doğrusu:
  `set -a && . ./.env && set +a && pnpm -w test:e2e`. Aynı tuzak `pnpm db:migrate` için de geçerli.
  Bir e2e turu ~84 `apps/e2e/kanit/*.png` yeniden yazar — beklenen churn, geri alma.

### 1.5 Gereksinim kapsama kapısı CI'a bağlı — kademeli tasarım, borç değil tutarsızlık kırmızı yapar (tm 184.3)

`.github/workflows/ci.yml`'in `verify` işi artık "Requirement coverage" adımında
`pnpm audit:req-coverage` koşuyor (Format check'ten sonra, Build'den önce — build çıktısına
ihtiyacı yok, statik kontroller grubunda duruyor). §7.5'in "kademeli olmalı" şartı **ayrı bir
mekanizma istemedi**: `req-coverage.cjs` (tm 184.2) zaten bu sözleşmeyle yazılmıştı — kapsama
borcu (`untagged`) hiçbir zaman `errors`'a girmez, exit code yalnız raporun **kendi hakkında**
yalan söylediği dört durumda 1 döner (katalogda olmayan ID'yi anan etiket, artık var olmayan bir
maddeye muafiyet, gerekçesiz muafiyet, `EXPECTED_ROWS`'tan sapan ayrıştırma). Bunun pratik
sonucu tam olarak görevin istediği şey: **bugünkü 163 etiketsiz madde CI'ı hiç kırmızı yapmaz**
(mevcut borç ayrı raporlanır, `pnpm audit:req-coverage`'ın metin çıktısında), ama **yeni/değişen
bir teste yazılan yanlış etiket** (katalogda olmayan bir ID, ya da §7.3'ün yasakladığı bir kalıp
`errors`'a düşecek şekilde) kapıyı aynı turda kırar — çünkü önceki turda 0 hata vardı ve bir
hata yalnız o turun değişikliğinden gelebilir.

**Kapının gerçekten kırmızı verdiği kanıtlandı** (elle, bu turda): `WAIVERS` listesine
`source` alanı boş bırakılmış bir kayıt eklenip `pnpm audit:req-coverage` koşuldu →
`ERRORS = 1`, `waiver: ... has no reason or no source` mesajıyla **exit 1**; kayıt geri alınınca
aynı komut **exit 0**'a döndü. İkinci kanıt zaten depoda çalışıyor:
`apps/api/src/config/req-coverage-audit.test.ts`'in "reports no integrity error against the repo
as it stands" testi aynı `errors === []` iddiasını `pnpm -w test`'in `test:unit` shard'ında da
tutuyor — CI'daki yeni adım script'i **doğrudan** (CLI/exit-code yoluyla) koşan tek yer, testteki
`analyse()` çağrısının bir yedeği değil ikinci, bağımsız bir kanıt hattı.

**Görev tanımının işaret ettiği bilinen CI boşluğu** ("unit-tests-before-build bundle bütçesini
sessizce atlıyor") bu turda **zaten kapalı bulundu** — `git log -- .github/workflows/ci.yml`
`6404a2e` (tm 156.1, M-GUARD-a) "Build runs before Unit tests, widget bundle guard stops skipping
silently" diyor ve `ci.yml`'de "Build" adımı fiilen "Unit tests"ten önce duruyor;
`apps/widget/test/bundle-size.test.ts` artık `describe.skipIf` değil, `existsSync` üzerinden
**assert** ediyor (dist yoksa "run \`pnpm --filter @nexa/widget build\` first" mesajıyla kırmızı
verir, sessizce atlamaz). Ayrı bir düzeltme commit'i bu yüzden gerekmedi.

## 2) Git kuralları

- Branch: her task `feat/<kısa-slug>` (ör. `feat/rtm-websocket`) veya `fix/<slug>`.
- Commit: Conventional Commits — `feat(rtm): add reconnect + missed-event sync`,
  `fix(auth): correct PKCE verifier length`. Küçük, anlamlı, atomik commit'ler.
- Her task sonunda: commit + `git push`. Task dalı DoD yeşilse `main`'e merge.
- YASAK: `git push --force`, history rewrite, `main`'e doğrudan bozuk kod, başka repoya dokunma.
- `.env` / secret / anahtar ASLA commit'lenmez (`.gitignore` ilk commit'te hazır olmalı).

## 3) Handoff notu formatı (`HANDOFF.md`'ye eklenir)

Her task kapanışında en üste (newest-first) şu blok eklenir:

```
## <TASK-ID> — <başlık> — <done|blocked> — <UTC tarih>
- Yapıldı: <1-3 madde, ne değişti>
- Doğrulama: <hangi kapı komutları yeşil / hangisi kırmızı>
- Varsayımlar: <varsa; MASTER-PROMPT Assumption kuralı>
- Sonraki pencereye not: <bağımlı task, dikkat edilecek nokta, kalan borç>
```

Bu blok bir sonraki temiz pencerenin bağlamı doğru kurmasını sağlar — bağlam kaybını önleyen
mekanizmanın kalbi budur.

## 4) Task Master durum akışı

- Başlarken: task `in-progress`.
- DoD yeşil + commit + push sonrası: `done`.
- Geçemezse: `blocked` (veya `review`), asla `done` değil.
- Alt-görevler (subtasks) kendi başına aynı kapıdan geçer; hepsi done olunca üst task done.

### 4.1 Öncelik seviyeleri — `critical` rezervedir

Planlama sırasında açılan HER görev yalnız şu üçünden birini alır (BUILD-BLUEPRINT K7):
`high` (Faz-0 · v1 Must) · `medium` (v1 Should) · `low` (v2/v3).

Dördüncü seviye `critical` **planlamaya kapalıdır**. Yalnız panelin "düzeltmeye gönder"
akışıyla açılan pencere, sağlık taramasının bulgusundan doğan düzeltme görevine atar.
PRD aktarımı, `parse-prd`, PLAN §G aktarımı ve elle görev açma sırasında ASLA kullanılmaz —
`critical` normal backlog'un tamamının önüne geçtiği için (run-loop `pick_next`) planlamada
dağıtılırsa gerçek düzeltmelerin önünü keser ve öncelik sırası anlamını yitirir.

## 5) Kapsam disiplini

- Bir pencere yalnız kendi hedef task'ını yapar. "Bu arada şunu da düzelteyim" YOK — o ayrı
  task'tır, Task Master'a not/yeni task olarak eklenir.

## 6) Şema göçü (migration) politikası — çok replikalı dağıtımda güvenli değişiklik (tm 164.3)

Bu bölüm bir **karar** ve onun gerekçesidir. Üç sorunun cevabı; hepsi ölçüldü, varsayılmadı
(yeniden koşulabilir: `pnpm --filter @nexa/api measure:concurrent-migrate 3`).

### 6.1 Migration NEREDE koşar

| Ortam                                                        | Migration'ı kim koşar           | Nasıl                                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Yerel (`make dev`, tek konteyner, `docker-compose.full.yml`) | api imajının kendi entrypoint'i | `apps/api/docker-entrypoint.sh` → `prisma migrate deploy` (varsayılan **değişmedi**)                                                   |
| Dağıtım (Helm, replika > 1)                                  | **tek atımlık hook Job**        | `infra/helm/nexa/templates/migrate-job.yaml` (`helm.sh/hook: pre-install,pre-upgrade`) + ConfigMap'te `NEXA_MIGRATE_ON_START: "false"` |

**Neden entrypoint DEĞİL (replika > 1 iken).** `prisma migrate deploy` gerçekten sıraya
giriyor — üç süreç aynı anda boş bir veritabanına saldırdığında biri 72 migration'ı uyguladı,
diğer ikisi `pg_advisory_lock(72707369)` üzerinde bekleyip "uygulanacak bir şey yok" dedi,
üçü de exit 0. **Ama bekleme sınırlı: 10 000 ms.** Kilit bundan uzun tutulduğunda `migrate
deploy` P1002 ile vazgeçip **exit 1** veriyor (ölçüm: ~15 s sonra). Entrypoint'te bu exit
uygulamanın exit'idir: süreç hiç başlamaz, pod CrashLoopBackOff'a girer — hem de tam şemayı
değiştiren rollout sırasında. 10 sn'yi aşan migration hayali değil: dolu bir tabloda tek bir
index build'i yeter. Yarış her iki durumda da var; değişen, **kaybetmenin bedeli**.

**Neden init-container DEĞİL.** Aynı N-yollu yarışı başka bir konteynere taşır, ortadan
kaldırmaz — üstelik her scale-up'ta ve şema değişikliğiyle hiç ilgisi olmayan her pod
yeniden başlatmasında tekrarlar. Job, migration'ı **sürüm başına bir kez**, şema fiilen
değiştiğinde koşar; başarısız olursa Helm sürümü bloklar (yarım rollout yerine durmuş
rollout).

**seed dağıtımda KOŞMAZ.** `docker-compose.full.yml`'in `init` servisi migrate + seed
koşar, çünkü boş bir demo yığını işe yaramaz. Dağıtımın veritabanı demo değildir: seed
kurgu organizasyon/agent/chat yazar; gerçek veriye karşı koşması bir veri bütünlüğü olayıdır.
Job yalnız `prisma migrate deploy` çalıştırır.

### 6.2 Yarış — ölçülen davranış

| Senaryo                             | Sonuç (ölçüldü)                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| 3 süreç, boş veritabanı             | 1 süreç 72 migration uyguladı · 2 süreç no-op · **hepsi exit 0** · ~1,7 s                     |
| 3 süreç, zaten göç etmiş veritabanı | 3 no-op · hepsi exit 0 · ~1,0 s                                                               |
| Kilit dışarıdan 15 s tutuluyor      | **exit 1**, `P1002 — Timed out trying to acquire a postgres advisory lock … Timeout: 10000ms` |

Her migration **tam olarak bir kez** uygulandı (72 bulundu, yarışan süreçlerin toplamı 72).
Yani veri açısından yarış güvenli; tehlike süreçlerin **exit code'u**, sonuç değil.

**Yarıda kalan migration atomiktir ama serbest değildir** (ölçüldü): bir migration dosyasının
ikinci ifadesi patladığında birinci ifadenin etkisi de geri alınır (Postgres, çok ifadeli
basit sorguyu örtük transaction'a sarar), fakat `_prisma_migrations` tablosunda
`finished_at IS NULL` bir satır kalır ve **sonraki her `migrate deploy` P3009 ile reddeder**.
Kurtarma elle yapılır: `prisma migrate resolve --rolled-back <migration_adı>` (düzeltip
yeniden uygulamak için) ya da `--applied` (etki fiilen yerindeyse). Bu yüzden Job'ın
`activeDeadlineSeconds` değeri bir zamanlama bütçesi değil, **askıda kalmaya karşı emniyet
freni**dir: en yavaş migration'ın çok üstünde tutulur, yakınında değil.

### 6.3 Geri alınamaz migration politikası — genişlet, sonra daralt

Rollout sırasında **eski sürüm pod'lar hâlâ trafiğe cevap veriyor** ve hook Job şemayı
onlardan ÖNCE değiştiriyor. Dolayısıyla kural:

> Bir migration, o sırada koşan **eski** kodla da **yeni** kodla da uyumlu olmak zorundadır.

Tek sürümde YASAK (her biri iki sürüm ister):

- Hâlâ okunan bir kolonu/tabloyu **düşürmek**.
- **Yeniden adlandırmak** (düşür + ekle demektir).
- Tipi **daraltmak**, ya da `DEFAULT` vermeden `NOT NULL` eklemek.
- Eski kodun hâlâ ihlal edebileceği veriye **unique/check kısıtı** eklemek.

Doğru sıra (üç sürüm, "expand → migrate → contract"):

1. **Genişlet** — yeni kolonu nullable/`DEFAULT`'lu ekle. Kod eskiyi okur, **ikisine de yazar**.
2. **Taşı** — geri dolduran migration + kod yeniyi okumaya geçer. Eski kolon hâlâ duruyor.
3. **Daralt** — 2. sürüm her yerde ayakta olduğuna göre eski kolonu düşür.

Ek kural — **uzun kilit**: `ALTER TABLE`/`CREATE INDEX` dolu bir tabloda ACCESS EXCLUSIVE
kilidi alır ve o süre boyunca **eski pod'ların sorguları bloklanır**. `CREATE INDEX
CONCURRENTLY` bunu önler ve bu depoda **kullanılabilir** (ölçüldü) — ama yalnız migration
dosyasındaki **tek ifade** olduğunda. Yanına bir ifade daha koyulduğunda Postgres'in çok
ifadeli sorgu için açtığı örtük transaction devreye girer ve migration
`25001 — CREATE INDEX CONCURRENTLY cannot run inside a transaction block` ile düşer.
Yani: eşzamanlı index'in kendi migration dosyası olur.

## 7) Test ↔ gereksinim izlenebilirliği — etiket nerede yaşar (tm 184.1)

Bu bölüm bir **karar** ve onun gerekçesidir. Denetimin (`prd-uyum-denetimi.md` §8) şu
eleştirisinin cevabı: mevcut DoD kapısı "kod var + testler yeşil"i ölçüyor, PRD'nin istediği
"kabul kriterinin **kendisi** test ediliyor mu"yu ölçmüyor.

Bu bölüm **yalnız etiketi** kurar. Kapsama raporunu üreten script (tm 184.2) ve kapıyı CI'a
bağlayan adım (tm 184.3) bunun üstüne gelir; ikisi de burada tanımlanan biçimi okur.

### 7.1 Karar: etiket test başlığında, parantez içinde yaşar

```ts
describe('white_label — widget markası (FR-MOD-11.5)', () => {
  it('growth üzerinde powered_by=false reddediliyor', async () => { … });
});

it('BAA imzasını enterprise üzerinde kaydediyor (NFR-C4)', async () => { … });
```

Kural **yeni bir şey icat etmiyor** — depoda zaten baskın olan biçimi düzenliyor. Ölçüldü
(2026-09-04, `git ls-files` ile izlenen 472 test dosyası; §7.6'nın komutlarıyla yeniden
üretilebilir — parantez içindeki sayı bu kuralın YAZILMASINDAN ÖNCEKİ durumdur, aradaki fark
§7.6'daki örnek dosyanın etiketlenmesidir):

| Ölçüm                                                               |         Değer |
| ------------------------------------------------------------------- | ------------: |
| Herhangi bir katalog ID'si **anan** test dosyası                    |       **322** |
| Başlık düzeyinde **iddia taşıyan** test dosyası                     | **141** (140) |
| Başlık düzeyindeki iddia satırı                                     | **202** (196) |
| Bu satırlarda geçen **farklı** katalog ID'si (247 maddenin içinden) |   **74** (73) |
| Yalnız yorumda geçen ID satırı                                      |       **587** |

Yani 140 dosya bu kuralı kimse söylemeden zaten uyguluyordu, üstelik **üç koşucunun üçünde de**:
vitest (`apps/api` 43 · `apps/web` 66 · `apps/widget` 11 · `apps/rtm` 2 · `packages/types` 2 ·
`apps/load` 1), Playwright (`apps/e2e` 15) ve jest (`apps/mobile` 1). Kuralın taşıdığı yük bu
yüzden küçük: biçim değil, **biçimin anlamı** (§7.2) ve nereye yazılacağı (§7.4) sabitleniyor.

**Neden yorum DEĞİL.** Yorum en yaygın biçim (586 satır) ama iddia taşıyamaz. İki nedenle:
(1) dosya başlığındaki bir docblock **dosyanın konusunu** söyler, hangi `it`in o kriteri
düşürdüğünü değil — 28 testlik bir dosyada "bu dosya FR-MOD-11.5'i kapsıyor" cümlesi
doğrulanamaz; (2) yorum ile onun altındaki `expect` arasında hiçbir bağ yok, yorum yerinde
kalırken assertion boşaltılabilir. Yorumdaki ID'ler **köken bilgisi** olarak yerinde kalır
("bu kod şu maddeyi uyguluyor") ve kapsama iddiası SAYILMAZ.

**Neden `covers()` yardımcısı DEĞİL.** Cazip tarafı gerçek: ID'yi üretilmiş bir union tipine
bağlarsan yazım hatası `typecheck`te düşer. Bedeli daha büyük: üç koşucu (vitest · jest ·
Playwright) için üç uyarlama, her test dosyasına bir import, ve `describe`in içinde mi dışında
mı çağrıldığına bağlı bir yaşam döngüsü. Başlık ise **hiçbir koşucu API'sine dokunmuyor** —
düz metin, yukarıdaki tabloda üç koşucuda da çalıştığı ölçülmüş durumda. Yazım hatası riski
tm 184.2'nin script'inde katalogla eşleştirilerek karşılanır; kaçınılmak istenen bağlanma
maliyetinden ucuzdur.

**Başlığın üçüncü faydası:** etiket test çıktısına düşer. Kırmızı bir test artık hangi
gereksinimi düşürdüğünü kendi adında söylüyor — yorum bunu yapamaz.

### 7.2 Etiketin anlamı — bu bir iddiadır, konu başlığı değil

> Bir etiket şu cümlenin taahhüdüdür: **bu blok bu gereksinim bozulursa KIRMIZI verir.**

"Bu test o maddenin civarında" yeterli değildir. Kriteri değil dönüş kodunu ölçen bir test
(denetim §3/D7: `FR-MOD-07.4` fixture'ı `reason`suz olay yazdığı için hatayı yakalayamıyordu)
etiketi **hak etmez** — yeşil raporu yanlış güvene çevirir. Şüphedeysen etiketleme.

### 7.3 ID uzayı — yalnız katalog maddeleri

Etikete girecek ID **`prd-uyum-denetimi.md` Ek A'daki 247 maddeden biri** olmalıdır. Dört ad alanı:

| Ad alanı                 | Örnek                              |
| ------------------------ | ---------------------------------- |
| `FR-MOD-<n>[.<n>…]`      | `FR-MOD-11.5` · `FR-MOD-08.5.4`    |
| `FR-<bölüm>.<madde>`     | `FR-00-01.A` · `FR-EK-B.1`         |
| `NFR-<harf><sayı>`       | `NFR-C4` · `NFR-S11` · `NFR-A11Y3` |
| `SEMA-MIMARI.<n>[.<n>…]` | `SEMA-MIMARI.8.4c`                 |

Katalog maddesi OLMAYAN iki şey etikete girmez — ikisi de yorumda serbesttir:

- **PLAN iş kalemi kimliği** (`11.5-b`, `02.9-a`, `M-TRACE-a`): bir işin adı, bir gereksinim
  değil. Katalog ID'siyle birlikte ayrıntı olarak yazılabilir — `(FR-MOD-11.5 · 11.5-b)` —
  çıkarıcı yalnız `FR-MOD-11.5`'i alır, `11.5-b`'yi görmezden gelir.
- **ADR numarası** (`ADR-09`): mimari karar, kabul kriteri değil.

**Eğik çizgi kısaltması YASAK.** Depoda yorumlarda `NFR-C5/S9` ve `NFR-S4/S5` gibi kısaltmalar
var; çıkarıcı bunu genişletemez, yalnız ilk ID'yi görür ve ikincisi **sessizce kaybolur**.
Etikette her ID tam yazılır: `(NFR-C5 · NFR-S9)`.

### 7.4 Çoktan-çoğa

- **Bir test → birden çok madde:** aynı parantezde `·` ile ayır — `(FR-MOD-08.9.5 · NFR-C5)`.
  Ayırıcı depodaki mevcut yorum deyimidir (`(FR-MOD-04.5 · NFR-S11 · M-TEAM-e)`), yeni değil.
- **Bir madde → birden çok test:** kendiliğinden çalışır; çıkarıcı bir küme toplar, sayı
  tutmaz. Aynı ID'yi kaç blok isterse etiketleyebilir.
- **Yuvalama:** `describe` üzerindeki etiket **içindeki her `it`e dağılır**. Bu yüzden etiket
  **iddianın gerçekten doğru olduğu en dar bloğa** yazılır. Dosyanın en üstündeki `describe`e
  koyulan geniş bir etiket, o dosyadaki ilgisiz her testi de o maddeyi koruyor gibi gösterir —
  tam olarak kaçınılmak istenen sahte kapsama budur.

Konum, parantezin başlıkta nerede durduğu değildir: sonda olması okunaklıdır ve mevcut 101
`FR-MOD` başlığının 94'ü öyle, ama zorunlu değil — `'hedef kayıtları (FR-MOD-13.3) — dönüşüm
kaydı'` geçerli. Zorunlu olan tek şey ID'nin **parantez içinde** olması; düz metne gömülü bir
anma (`'FR-MOD-13.7'nin adlandırdığı dört yüzeyi sayar'`) iddia sayılmaz ve çıkarılmaz.

### 7.5 Kademeli benimseme — geriye dönük uygulanmaz

472 dosya / ~7.100 test geriye dönük etiketlenmez; bunu denemek ya turlarca sürer ya da
gözden geçirilmemiş, dolayısıyla §7.2'yi ihlal eden etiketler üretir. Kural şu şekilde yürür:

- **Zorunlu:** yeni yazılan ya da değişen bir test, bir PRD kabul kriterini koruyorsa
  etiketlenir. Kapı bunu tm 184.3'te ölçer.
- **Gönüllü:** mevcut 141 dosyanın dışındaki her şey. Bir dosyaya başka bir iş için
  dokunuluyorsa etiket eklemek teşvik edilir, şart değildir.
- **Borç ayrı raporlanır:** etiketsiz maddelerin listesi tm 184.2'nin çıktısıdır ve kapıyı
  kırmızı yapmaz. Bugün 247 maddenin 74'ü etiketli; kalan 173'ü "kapsanmıyor" DEĞİL,
  "etiketlenmemiş" demektir — ikisini karıştırmak kuralın ilk yanlış kullanımı olur.

### 7.6 Etiketler makineyle çıkarılabilir — örnek komut

Aşağıdaki iki komut depo kökünden koşar (Git Bash). tm 184.2 bunları script'e çevirecek;
buradaki amaç biçimin **bugün** çıkarılabilir olduğunu göstermek.

```bash
# Dış parantezler ŞART: alternasyon gruplanmazsa `\($NEXA_REQ_ID` yalnız ilk
# seçeneğe bağlanır, kalan üçü `describe(` çıpasından da parantez şartından da
# bağımsız eşleşir ve yorum satırları sonuca sızar (bu turda ölçüldü: 73 yerine
# 149 ID, aralarında hiç etiketlenmemiş dosyaların yorumları).
NEXA_REQ_ID='(FR-MOD-[0-9][0-9.]*|FR-[0-9A-Z][0-9A-Z-]*\.[0-9A-Za-z]+|NFR-[A-Z0-9]+|SEMA-MIMARI\.[0-9A-Za-z][0-9A-Za-z.-]*)'

# 1) Her kapsama iddiası, yeriyle birlikte (dosya:satır)
git ls-files '*.test.ts' '*.test.tsx' '*.spec.ts' '*.spec.tsx' \
  | xargs grep -nE "^[[:space:]]*(describe|it|test)(\.[a-z]+)?\(.*\($NEXA_REQ_ID"

# 2) İddia edilen maddelerin kümesi (247'nin içinden bugün 74)
git ls-files '*.test.ts' '*.test.tsx' '*.spec.ts' '*.spec.tsx' \
  | xargs grep -hE "^[[:space:]]*(describe|it|test)(\.[a-z]+)?\(.*\($NEXA_REQ_ID" \
  | grep -oE "\($NEXA_REQ_ID[^)]*\)" | grep -oE "$NEXA_REQ_ID" | sort -u
```

Regex katalogun 247 ID'sinin 246'sını eşliyor; eşleşmeyen tek satır `FR-MOD-02.4.1–.6`, bir
aralık gösterimi (kısa çizgi değil **en-dash**) — ondan yalnız `FR-MOD-02.4.1` çıkar. tm 184.2
katalog ayrıştırıcısını yazarken bu tek kaleme özel davranmalı.

Uygulanmış örnek: `apps/api/test/integration/entitlements.test.ts` — dosya başlığındaki
köken yorumu yerinde bırakıldı, iddialar dört iç `describe`e dar biçimde dağıtıldı
(`FR-MOD-11.5` · `NFR-S11` · `NFR-C4` · `NFR-S12`), üst `describe` yalnız hepsinde doğru olan
maddeyi (`FR-MOD-10.1.1`, plan geçişi / downgrade kısıtları) taşıyor.

**Bu iki komut artık betik: `pnpm audit:req-coverage`** (`scripts/audit/req-coverage.cjs`,
tm 184.2 · `--json` ile makine biçimi). Betiği yazarken yukarıdaki komutun **iki kusuru**
ölçümle çıktı; ikisi de betikte düzeltildi, ama komutu elle koşan biri bilmeli:

- **Çıkarma adımı, katalog ID'sinin parantezin BAŞINDA olmasını şart koşuyor.** Kalıp
  `\(<ID>[^)]*\)` olduğu için `(400, NFR-S8)`, `(un-enumerable, NFR-S5)` ve
  `(M-LOAD-CAP · NFR-R2)` komuta hiç görünmüyor — oysa §7.4 böyle bir sıra dayatmıyor,
  aksine iş kalemi kimliğinin ayrıntı olarak yanına yazılabileceğini söylüyor. Ölçüldü:
  **8 iddia satırı ve bir bütün madde (`NFR-R2`)** bu yüzden sayılmıyor. Betik 75 madde /
  146 dosya diyor; §7.1'in tablosundaki 74 / 141 bu kusurun sonucudur.
- **JS alternasyonu leftmost-_first_, POSIX ERE leftmost-_longest_.** Regex birebir
  JavaScript'e taşınırsa `FR-MOD-04.RBAC` → `FR-MOD-04.` olur (ilk dal önek eşliyor ve JS
  orada duruyor). Betik `FR-MOD-` dalını `[0-9]+(?:\.[0-9A-Za-z]+)*` yaparak kapattı.

Üçüncü kusur düzeltilebilir değil, **raporlanıyor**: §7.3'ün yasakladığı eğik çizgi kısaltması
(bugün iki başlıkta `NFR-S4/S5`) hiçbir çıkarıcı tarafından genişletilemez, ikinci ID her
hâlükârda kayboluyor — betik bu başlıkları ayrı bir kovada listeliyor.

### 7.7 Bu kuralın SATIN ALMADIĞI şey

Etiket, testin o kriteri **doğru** ölçtüğünü kanıtlamaz — yalnız birinin öyle iddia ettiğini
kaydeder. `FR-MOD-07.4` etiketli olsaydı bile fixture'ı kör olduğu için yeşil kalacaktı.
Yani bu bölüm kapsama **raporunu** mümkün kılar, kapsamanın **kalitesini** garanti etmez;
sınır tm 184.2'de açıkça belgelenir. Etiketli bir maddenin yeşil görünmesi, gözden geçirmenin
yerine geçmez.
