# CONVENTIONS — Definition of Done, Git ve Handoff Kuralları

Bu dosya otonom döngünün "objektif kapısı"dır. Her task bunlara uymadan **done** sayılmaz.
Kuralların gerekçeleri, ölçümleri ve eski yöntemler: `docs/conventions-gerekce.md` (aynı bölüm
numaralarıyla; baştan okuma, `grep -n '^### 1.3' docs/conventions-gerekce.md` ile aç).

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
- [ ] **Log anahtarları snake_case** — `pnpm audit:log-keys` (exit 0; CI'da "Log keys" adımı,
      tm 288.1). `apps/api` + `apps/rtm` log çağrısında `chatId`/`licenseId`/`reqId` gibi bir
      kimlik anahtarı kırmızı verir; doğru yazım `LOG_KEYS` (`@siyahtus/types`).
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

Kanıt `## K. Kanıt Geçmişi` bölümündeki `#### K<kod>` bloğuna **madde olarak eklenir**; madde
silinmez, üstüne yazılmaz (eskisi arşive taşınır, aşağıda). Blok yoksa `## K.` bölümünün sonuna
`#### K<kod> — <PRD kodu> · <kısa başlık>` diye aç. Panel tablo satırı uzunluğunu denetler
(`C-plan-row-length`).

**Madde biçimi (2026-10-14'ten itibaren) — tek satır:**
`- ✅ tm <id> · <ne yapıldı, bir cümle> · <dosya:satır> · <test dosyası (n)> · <commit> · §D<n>`.
Ayrıntı, ölçüm ve hikâye maddeye değil HANDOFF bloğuna ya da §D'ye yazılır. Eski maddeler
yeniden yazılmaz.

**Canlı blokta en fazla son 3 madde kalır.** Yeni madde eklenince fazlası (en eskiler) **aynı
commit'te** `docs/archive/plan-kanit/PLAN-kanit-arsiv-<YYYY-MM>.md` dosyasına (yoksa oluştur)
aynı `#### K<kod> — <başlık>` başlığının altına birebir taşınır; canlı blokta maddelerin altında
`_Önceki maddeler: docs/archive/plan-kanit/… (#### K<kod>)_` satırı durur. Taşınan bir madde
bir "**Kalan** …" / "henüz yapılmadı" notunu kapatıyorsa, canlıda o notu kapanışsız bırakma —
✅ satırda panel bunu `suspicious-done` sayar; gerekirse kalan maddelerin üstüne tek satır
`Durum: KAPANDI (tm <id>)` yaz.

İstisna: **faz özet tablosu** (`| Faz | PRD | Genel durum | Must sayacı | Kapanış |`) bu
kuralın dışındadır — oradaki hücre bir sayım kaynağıdır (`54 ✅ · 0 ◐`), panel `statedCounts`
olarak okur. Ona dokunma.

Eski kanıt, §D sapmaları ve tarihçe `docs/archive/` altındadır:
`grep -rn 'K07.7\|tm <id>\|D167\b' docs/archive` — arşivi baştan okuma.

### 1.1 Kapının objektifliği: test veri depoları koşu başına izole (tm 105)

`@siyahtus/api` ve `@siyahtus/rtm`'in `test` / `test:unit` / `test:integration` script'leri
`apps/api/scripts/with-test-datastores.ts` üzerinden koşar: her koşu kendi `siyahtus_test_<id>`
veritabanını ve kendi Redis mantıksal veritabanını (1-15) alır. Sonuçları:

- `pnpm -w test` `--concurrency=1` istemez; turbo paralelliği güvenlidir.
- **Bir kırmızıyı "başka pencere yazıyordur" diye açıklama.** Kırmızı ya senin değişikliğindendir
  ya da HANDOFF/Task Master'da kayıtlı bilinen bir kusurdur; ikisi de değilse gerçek regresyondur.
- e2e de izoledir (tm 260, §1.3). Eski tek yığın (`--legacy`) paylaşılan veritabanını sıfırlar —
  onunla iki pencere aynı anda koşamaz. Paylaşılan veritabanına karşı koşmak için:
  `SIYAHTUS_TEST_ISOLATION=off`.

Gerekçe/ölçümler: `docs/conventions-gerekce.md` §1.1.

### 1.3 Kapıyı KOŞMAK da objektif olmalı: `--force` ve parçalama (tm 129)

- **turbo `test` görevini önbelleğe alır** (`FULL TURBO`). Bir kırmızıyı kovalarken ya da bir
  flake düzeltmesini kanıtlarken **`--force` şart**:
  `npx turbo run test --force --filter=!@siyahtus/e2e`. Normal DoD kapısında gerekmez.
- **api testleri paralel parçalar halinde koşar** (`apps/api/scripts/run-sharded.ts`). **Sahip
  kararı 2026-10-07: varsayılan PARALEL — CPU/4 parça, tavan 6; görev notlarında "testler SERİ"
  yazıyorsa bu satır geçerlidir.** Bayrak vermeden koş; `--jobs=1` yalnız tek bir dosyanın
  kırmızısını yalıtırken. Zaman aşımı kırmızısında önce bir kez aynı varsayılanla, sonra
  `--jobs=3` ile koş — yine çıkarsa gerçek. Özet satırı (`Test Files … (n)`) tüm parçaların
  toplamıdır.
- **Başlıklı kapı:** `pnpm test:gate` = `build` → `statik` (typecheck+lint, format:check, loop-tools) ∥
  `birim` → `entegrasyon` → isteğe bağlı `e2e` (`--e2e`). Yalnız bazı başlıklar:
  `pnpm test:gate birim entegrasyon`; önbelleksiz: `--force`. Tam kapı ~11 dk, pencerenin 10 dk
  komut tavanını aşabilir: arka planda koş, log yolu ilk satırda.
  **KURAL — kapı nasıl koşulur:** Tam kapı ~11 dk, tek komutta pencerenin 10 dk tavanını aşar.
  Kapı (ve tam test/e2e/build) **her zaman `run_in_background` ile** koşulur. Arka planda da
  sorun çıkarsa kapı başlıklara bölünür ve her parçanın exit code'u ayrı yazılır:
  `pnpm test:gate build statik birim` ardından `pnpm test:gate entegrasyon` (~7 dk).
  **`--force` varsayılan DEĞİLDİR**; yalnız önbelleğe güvenmemek için somut bir neden varsa
  (ör. önbellek bozuk sonuç verdi) kullanılır ve nedeni HANDOFF'a yazılır.
  **KURAL — ara doğrulama ≠ kapanış:** Görev sırasında e2e'nin TAMAMI koşulmaz; yalnız dokunulan
  akışın spec'i koşulur (`pnpm test:e2e --shards=1 <spec>`, ~2 dk). e2e'nin tamamı ve tam kapı
  **kapanışta bir kez** koşulur; DoD kanıtı o koşudur. Gerekçe: son 30 görevde süre %36'sı e2e'nin
  tamamına gitti (görev başına ~4 tam koşu), kapının 62 koşusunun 44'ü `--force` ileydi.
  **KURAL — kırmızı kapı e2e koşmaz (2026-10-16):** `build` kırmızıysa hiçbir şey koşmaz;
  `statik`/`birim`/`entegrasyon` kırmızıysa e2e ATLANIR (tabloda `ATLANDI`). Entegrasyon, statik/birim
  kırmızıyken de koşar (bağımsız bilgi). `--keep-going` eski "hepsini koş" davranışıdır. Gate,
  kırmızı birim/entegrasyon dosyaları için tek dosyalık yeniden-koşma komutunu yazar; önce onu
  yeşile çevir, sonra kapıyı yeniden başlat.
- **e2e parçalı koşar (tm 260):** `pnpm -w test:e2e` = `apps/e2e/scripts/run-e2e-sharded.mjs`;
  her parça kendi yığınında ve portlarında. Parça sayısı `--shards=N` / `SIYAHTUS_E2E_SHARDS`.
  Kapı için **son satırlar** okunur: parça satırları, `Tests: …` ve `verdict: GREEN|RED`; exit 1 =
  bir parça kırmızı ya da eksik. **Yalnız parçalıyken düşen kırmızı bir sıra bağımlılığıdır** —
  `pnpm test:e2e --shards=1 <önceki> <düşen>` ile üret ve düzelt. CI'da `--legacy` koşar.
- **`apps/web` kendi süitini `--maxWorkers=4` ile ister** — yüklü makinede
  `Test timed out in 5000ms` CPU çekişmesidir; sınırlıyken yeniden koşmadan kırmızı yazma.

Gerekçe/ölçümler ve eski yöntem ("Tarihçe — paralel parçalardan önce", elle shard komutları):
`docs/conventions-gerekce.md` §1.3.

### 1.4 Kapının önkoşulları: iki sessiz tuzak (2026-08-31)

- **Docker kapalıyken entegrasyon testleri ASILIR** (0 bayt çıktı). Kapıdan önce `docker info`.
  Kapalıysa exe `%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe`, sonra
  `docker compose up -d` (`siyahtus-db` 5433, `siyahtus-redis` 6380; psql kullanıcısı `siyahtus`;
  container'a yol geçerken `MSYS_NO_PATHCONV=1`).
- **`pnpm -w test:e2e --legacy` ve `pnpm db:migrate` kök `.env`'i kendiliğinden ALMAZ:**
  `set -a && . ./.env && set +a && <komut>`. Parçalı varsayılan `.env`'i kendisi yükler. Bir e2e
  turu `apps/e2e/kanit/*.png` dosyalarını yeniden yazar — beklenen churn.

Ayrıntı: `docs/conventions-gerekce.md` §1.4.

### 1.5 Gereksinim kapsama kapısı CI'a bağlı — kademeli tasarım, borç değil tutarsızlık kırmızı yapar (tm 184.3)

CI `verify` işi "Requirement coverage" adımında `pnpm audit:req-coverage` koşar. Kapsama borcu
(`untagged`) kapıyı kırmızı yapmaz; exit 1 yalnız raporun kendi hakkında yalan söylediğinde
(katalogda olmayan ID'yi anan etiket, var olmayan maddeye muafiyet, gerekçesiz muafiyet,
`EXPECTED_ROWS`'tan sapan ayrıştırma). Gerekçe ve kanıt: `docs/conventions-gerekce.md` §1.5.

## 2) Git kuralları

- Branch: her task `feat/<kısa-slug>` (ör. `feat/rtm-websocket`) veya `fix/<slug>`.
- Commit: Conventional Commits — `feat(rtm): add reconnect + missed-event sync`,
  `fix(auth): correct PKCE verifier length`. Küçük, anlamlı, atomik commit'ler.
- Her task sonunda: commit + `git push`. Task dalı DoD yeşilse `main`'e merge.
- YASAK: `git push --force`, history rewrite, `main`'e doğrudan bozuk kod, başka repoya dokunma.
- `.env` / secret / anahtar ASLA commit'lenmez (`.gitignore` ilk commit'te hazır olmalı).

## 3) Handoff notu formatı (`HANDOFF.md`'ye eklenir)

Her task kapanışında en üste (newest-first) şu blok eklenir:
(`## Task log (newest-first)` başlığının hemen altına; **kısa**, 4 madde)

```
## <TASK-ID> — <başlık> — <done|blocked> — <UTC tarih>
- Yapıldı: <1-3 madde, ne değişti>
- Doğrulama: <hangi kapı komutları yeşil / hangisi kırmızı>
- Varsayımlar: <varsa; MASTER-PROMPT Assumption kuralı>
- Sonraki pencereye not: <bağımlı task, dikkat edilecek nokta, kalan borç>
```

Bu blok bir sonraki temiz pencerenin bağlamı doğru kurmasını sağlar — bağlam kaybını önleyen
mekanizmanın kalbi budur.

**Canlı `HANDOFF.md` en fazla son 5 görev bloğu + açık (pending / in-progress / blocked /
review) görevlerin bloklarını tutar.** Yeni blok eklenince en alttaki fazla blok **aynı
commit'te** `docs/archive/handoff/HANDOFF-arsiv-<YYYY-MM>.md` dosyasına (ayın arşiv dosyası;
yoksa oluştur) başlığının hemen altına, newest-first sırası korunarak birebir taşınır. Eski
kayıt: `grep -rn 'tm <id>' docs/archive/handoff` — arşivi baştan okuma.

## 4) Task Master durum akışı

- Başlarken: task `in-progress`.
- DoD yeşil + commit + push sonrası: `done`.
- Geçemezse: `blocked` (veya `review`), asla `done` değil.
- Alt-görevler (subtasks) kendi başına aynı kapıdan geçer; hepsi done olunca üst task done.
- Görev SİLİNMEZ (bağımlılıklar eski görevlere işaret eder). Eski done görevlerin `details` /
  `testStrategy` alanları tek satır özete indirilmiş olabilir; tam metin
  `docs/archive/tasks/tasks-<tarih>.json` yedeğindedir.

### 4.1 Öncelik seviyeleri — `critical` rezervedir

Planlama sırasında açılan HER görev yalnız şu üçünden birini alır (BUILD-BLUEPRINT K7):
`high` (Faz-0 · v1 Must) · `medium` (v1 Should) · `low` (v2/v3).

Dördüncü seviye `critical` **planlamaya kapalıdır**: yalnız panelin "düzeltmeye gönder" akışıyla
açılan pencere, sağlık bulgusundan doğan düzeltme görevine atar. PRD aktarımı, `parse-prd`,
PLAN §G aktarımı ve elle görev açmada ASLA kullanılmaz. Gerekçe: `docs/conventions-gerekce.md` §4.1.

## 5) Kapsam disiplini

- Bir pencere yalnız kendi hedef task'ını yapar. "Bu arada şunu da düzelteyim" YOK — o ayrı
  task'tır, Task Master'a not/yeni task olarak eklenir.

## 6) Şema göçü (migration) politikası — çok replikalı dağıtımda güvenli değişiklik (tm 164.3)

Ölçümler ve "neden entrypoint / init-container değil": `docs/conventions-gerekce.md` §6
(yeniden koşulabilir: `pnpm --filter @siyahtus/api measure:concurrent-migrate 3`).

### 6.1 Migration NEREDE koşar

Yerel: api entrypoint'i (`apps/api/docker-entrypoint.sh` → `prisma migrate deploy`). Dağıtım
(Helm, replika > 1): tek atımlık hook Job (`infra/helm/siyahtus/templates/migrate-job.yaml`) +
`SIYAHTUS_MIGRATE_ON_START: "false"`. **seed dağıtımda KOŞMAZ.**

### 6.2 Yarış — ölçülen davranış

Eşzamanlı `migrate deploy` veri açısından güvenli; kilit 10 sn'yi aşarsa P1002 + exit 1. Yarıda
kalan migration `finished_at IS NULL` bırakır → sonraki deploy P3009; kurtarma
`prisma migrate resolve --rolled-back|--applied <ad>`.

### 6.3 Geri alınamaz migration politikası — genişlet, sonra daralt

Bir migration hem **eski** hem **yeni** kodla uyumlu olmak zorundadır. Tek sürümde YASAK: okunan
kolonu/tabloyu düşürmek, yeniden adlandırmak, tipi daraltmak / `DEFAULT`'suz `NOT NULL`, eski
kodun ihlal edebileceği unique/check kısıtı. Sıra: **genişlet → taşı → daralt**.
`CREATE INDEX CONCURRENTLY` yalnız migration dosyasındaki **tek ifade** olarak (yoksa `25001`).

## 7) Test ↔ gereksinim izlenebilirliği — etiket nerede yaşar (tm 184.1)

Kararın gerekçesi ve ölçümleri (neden yorum / `covers()` değil, etiket sayımları, elle grep
komutunun kusurları): `docs/conventions-gerekce.md` §7.

### 7.1 Karar: etiket test başlığında, parantez içinde yaşar

`it('BAA imzasını enterprise üzerinde kaydediyor (NFR-C4)', …)`. Yorumdaki ID köken bilgisidir,
iddia sayılmaz.

### 7.2 Etiketin anlamı — bu bir iddiadır, konu başlığı değil

Etiket = "bu blok bu gereksinim bozulursa KIRMIZI verir". Şüphedeysen etiketleme.

### 7.3 ID uzayı — yalnız katalog maddeleri

Yalnız `prd-uyum-denetimi.md` Ek A maddeleri: `FR-MOD-<n>[.<n>…]` · `FR-<bölüm>.<madde>` ·
`NFR-<harf><sayı>` · `SEMA-MIMARI.<n>[.<n>…]`. İş kalemi kimliği (`11.5-b`) ve ADR etikete girmez.
**Eğik çizgi (`NFR-C5/S9`) ve aralık (`FR-MOD-08.5.4-.6`) kısaltması YASAK** — her ID tam:
`(NFR-C5 · NFR-S9)`. Tek istisna katalogun kendi maddesi `FR-MOD-02.4.1–.6`.

### 7.4 Çoktan-çoğa

Birden çok madde aynı parantezde `·` ile ayrılır. `describe` etiketi içindeki her `it`e dağılır —
etiketi iddianın doğru olduğu **en dar** bloğa yaz.

### 7.5 Kademeli benimseme — geriye dönük uygulanmaz

Yeni/değişen ve PRD kriterini koruyan test etiketlenir; eski dosyalar gönüllü.

### 7.6 Etiketler makineyle çıkarılabilir — örnek komut

`pnpm audit:req-coverage` (`scripts/audit/req-coverage.cjs`, `--json`).

### 7.7 Bu kuralın SATIN ALMADIĞI şey

Etiket, testin kriteri doğru ölçtüğünü kanıtlamaz; gözden geçirmenin yerine geçmez.
