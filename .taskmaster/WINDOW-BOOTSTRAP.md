# PENCERE AÇILIŞI — her görev bunu ÖNCE okur

Bu dosya, Task Master'daki her görevin ilk adımıdır. Pencere hiçbir bağlam taşımaz:
önceki turların ne yaptığını bilmez, bu dosyayı ve görevin kendi metnini okuyarak kurulur.

---

## 1. Zorunlu okumalar (sırayla)

1. `CLAUDE.md` — kilitli kararlar, sınırlar
2. `CONVENTIONS.md` — **§1 DoD kapısı**, §1.2 PLAN.md kanıt disiplini, §1.3 kapıyı parçalama,
   §2 git, §3 handoff, §5 kapsam disiplini
3. `prd-uyum-denetimi.md` — bu görev serisinin kaynağı olan denetim raporu.
   Görev metni hangi bölüme (D1…D8, K1, K2) dayandığını söyler; **o bölümü oku**.
4. Görevin kendi metninde verilen PRD satır aralığı — `urun-gereksinim-dokumani-PRD.md`

> **Şema tek doğruluk kaynağı:** PRD §8.4 + `rapor-2-teknik-mimari.md` §5.3.
> `LiveChat_ER_Diyagram.mermaid` KULLANILMAZ (çelişkili, bilinerek terk edilmiş).

---

## 2. Ortam tuzakları — bunlar bilinmezse tur boşa gider

### Docker kapalıysa testler ASILIR, hata vermez

Entegrasyon testleri gerçek Postgres + Redis ister. Docker Desktop kapalıyken
`with-test-datastores.ts` hızlı düşmez — **0 bayt çıktıyla 10+ dakika asılır** ve yavaş
süit gibi görünür.

```bash
docker info >/dev/null 2>&1 || echo "DOCKER KAPALI"
```

Kapalıysa: exe **`%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe`**
(`C:\Program Files\...` altında DEĞİL — kullanıcı kurulumu). Başlattıktan sonra:

```bash
docker compose up -d
```

`nexa-db` → host portu **5433**, `nexa-redis` → **6380**.
psql kullanıcısı **`nexa`**, şifre `nexa_dev_password`, veritabanı `nexa` —
`-U postgres` "role does not exist" verir. Container'a komut geçerken
`MSYS_NO_PATHCONV=1` gerekir (Git Bash yolu bozar):

```bash
MSYS_NO_PATHCONV=1 docker exec nexa-db psql -U nexa -d nexa -tAc "SELECT count(*) FROM licenses;"
```

Volume'lar restart'ta korunur; e2e'nin ihtiyaç duyduğu tohumlu `nexa` veritabanı yerinde kalır.

### e2e kök `.env`'i kendiliğinden ALMAZ

Playwright'ın ayağa kaldırdığı RTM sunucusu 60 saniyede
`DATABASE_URL: Required` ile düşer. Doğrusu:

```bash
set -a && . ./.env && set +a && pnpm -w test:e2e
```

Aynı tuzak `pnpm db:migrate` için de geçerli.

### Kapı tek komutta pencere tavanını aşar

`pnpm -w test` ~15 dk (api'nin `test` script'i unit **ve** integration'ı `fileParallelism: false`
ile sırayla koşar). CONVENTIONS §1.3 parçalaması — her parçanın exit code'unu yaz:

```bash
npx turbo run test --force --filter=!@nexa/e2e --filter=!@nexa/api
npx turbo run test:unit --force --filter=@nexa/api
cd apps/api && npx tsx scripts/with-test-datastores.ts vitest run --dir test/integration --shard=1/3
cd apps/api && npx tsx scripts/with-test-datastores.ts vitest run --dir test/integration --shard=2/3
cd apps/api && npx tsx scripts/with-test-datastores.ts vitest run --dir test/integration --shard=3/3
```

Beklenen sayılar (2026-08-30 ölçümü): api unit **1174** (70 dosya) ·
api integration **2701** (110 dosya: 1069 + 953 + 679) · web 1541 · rtm 168 ·
widget 115 · types 132 · ai-mock 136 · load 28 · **e2e 210**.
Sayı düşerse test kaybolmuştur — araştır.

### Tek entegrasyon dosyası koşmak

`test:integration -- <ad>` **filtrelemez**. Doğrusu:

```bash
cd apps/api && npx tsx scripts/with-test-datastores.ts vitest run test/integration/<ad>.test.ts
```

### Diğer

- e2e turu ~**84** adet `apps/e2e/kanit/*.png` yeniden yazar — beklenen churn, geri alma.
- turbo `test` görevini önbelleğe alır; bir kırmızıyı kovalarken `--force` şart.
- 5173'te artık dev server bırakma — kalıntı Vite sunucusu uygulamayı boş gösterip
  e2e'nin çoğunu topluca düşürür (kod kusuru değil).
- `make` kurulu DEĞİL; README'nin `make dev`/`make demo` komutlarını elle aç.
- k6 PATH'te değil: `%LOCALAPPDATA%\nexa-tools` altındaki exe.
- PowerShell ondalıkları virgülle yazar — elle CSV üretirken InvariantCulture zorla.

---

## 3. Bitirme kapısı (CONVENTIONS §1)

Hepsi exit 0 olmadan görev **done değildir**:

```bash
pnpm -w typecheck
pnpm -w lint
pnpm -w format:check
pnpm -w build
pnpm -w db:check-drift
```

Artı: yukarıdaki parçalanmış test koşuları + `set -a && . ./.env && set +a && pnpm -w test:e2e`.

Kontrat (OpenAPI) değiştiyse:

```bash
pnpm -w contract:generate
git status --short packages/contract/src/generated   # BOŞ olmalı
```

Migration eklendiyse `db:check-drift` exit 0. Migration SQL'i üretmek shadow DB ister;
uygulanmış bir migration'ı yerinde düzeltmek bu depoda tolere edilir
(`migrate deploy` checksum bakmıyor) — ama yeni iş için yeni migration aç.

---

## 4. Kapanış (sırayla, atlanmaz)

1. **PLAN.md gereksinim satırı** — görevin PRD kodundaki satır(lar)ı güncelle.
   Durum hücresi YALNIZ damga: `✅ → K<kod>` / `◐ → K<kod>` / `⬜`.
   Kanıt metni **`## K. Kanıt Geçmişi`** altındaki `#### K<kod>` bloğuna **madde olarak eklenir**;
   var olan maddeler silinmez. Hücreye kanıt yazmak kuralı ihlal eder (§1.2).
   Kısmen karşılandıysa `◐` + eksik açıklaması **doğru** cevaptır; `✅` uydurmak kapıyı geçmez.
2. **HANDOFF.md** — en üste (newest-first) CONVENTIONS §3 bloğu:
   Yapıldı / Doğrulama / Varsayımlar / Sonraki pencereye not.
3. **git** — `feat/<slug>` dalında commit + push; DoD yeşilse `main`'e merge.
   `--force`, history rewrite, `main`'e doğrudan bozuk kod YASAK.
4. **Task Master** — alt görevler tek tek, sonra üst görev `done`.
   Kapı kırmızıysa `blocked`/`review`, asla `done` değil.

---

## 5. Kapsam disiplini

Pencere **yalnız kendi hedef görevini** yapar. "Bu arada şunu da düzelteyim" YOK —
o ayrı bir görevdir, Task Master'a yeni görev olarak eklenir.

Dış servisler mock'lanır. Production deploy / DNS / TLS / gerçek secret / kart / ödeme YOK.

---

## 6. Model seçimi

Her görevin metninde **`Model:`** satırı var (`sonnet` veya `opus`).

- `sonnet` — spesifikasyonu net, mevcut bir deseni izleyen mekanik iş.
- `opus` — tasarım kararı, eşzamanlılık/idempotanslık semantiği ya da çok dosyaya
  yayılan muhakeme gerektiren iş.

Görev `opus` diyorsa sonnet ile parçalamaya çalışma; zorluk parçalanarak kaybolmuyor.
