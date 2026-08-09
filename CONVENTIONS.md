# CONVENTIONS — Definition of Done, Git ve Handoff Kuralları

Bu dosya otonom döngünün "objektif kapısı"dır. Her task bunlara uymadan **done** sayılmaz.

## 1) Definition of Done (DoD) kapısı
Bir task ancak AŞAĞIDAKİLERİN HEPSİ yeşilse "done" işaretlenir. Hepsi komutla + exit code ile
doğrulanır; "gözle baktım oldu" geçersizdir.

- [ ] Type-check temiz — `pnpm -w typecheck` (exit 0)
- [ ] Lint temiz — `pnpm -w lint` (exit 0)
- [ ] Unit testler geçiyor — `pnpm -w test` (exit 0)
- [ ] Integration testler geçiyor (gerçek Postgres+Redis'e karşı) — `pnpm -w test:integration`
- [ ] Build başarılı — `pnpm -w build` (exit 0)
- [ ] İlgili E2E/smoke geçiyor — `pnpm -w test:e2e` (task'ın kapsadığı akış)
- [ ] Task'ın kendi kabul kriteri (Task Master'daki test stratejisi / PRD FR KK) karşılandı
- [ ] Yeni kod için test yazıldı (kapsam anlamlı; çıplak endpoint/servis testsiz kalmaz)
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
