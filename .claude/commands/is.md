---
description: Sıradaki Task Master işini al ve plana sadık kalarak yürüt
argument-hint: '[görev id — boş bırakılırsa next]'
allowed-tools: Bash(task-master *), Read, Grep, Glob, Edit, Write, Bash(pnpm *), Bash(make *), Bash(git *)
---

Bir oturum = bir iş. `PLAN.md`'yi (89 KB) **okuma** — görevin kendisi zaten plana çivili.

## 1. İşi al

$ARGUMENTS boşsa `task-master next`, doluysa `task-master show $ARGUMENTS`.

`next` sana `in-progress` bir görev verirse bu **yarım kalmış iştir** — sıfırdan başlama:
`details` sonundaki `[günlük …]` satırlarını oku, kaldığı yerden sürdür.
(Doğrulandı: `next`, in-progress görevi yeniden gösterir; çökme işi kaybettirmez.)

Sonra `task-master set-status --id=<id> --status=in-progress`.

## 2. Bağlamı kur — yalnız gerekeni oku

Görevin `details` alanı sana dosya yolu ve satır numarası veriyor. **Sadece onları oku.**
`details` içindeki `PRD: FR-MOD-xx · PLAN.md §y` çapası, doğrulaman gerekirse nereye
bakacağını söyler — gereksiz yere açma.

Derinlik gerekiyorsa kodu **doğrudan oku** (Read/Grep). AI'ya giden hiçbir task-master
komutunu (`research`, `update-task`, `update-subtask`, `expand`) oturum içinden çağırma —
claude-code provider iç içe claude açıp kilitleniyor (ölçüldü: 300 sn'de sıfır çıktı).

## 3. Planını yaz

Kodu okuduktan sonra, yazmadan önce:
`node .taskmaster/gunluk.mjs <id> "plan: <ne yapacaksın, hangi dosyalar>"`

Bu satır, bağlam sıfırlanırsa geriye kalan tek şeydir. Ciddiye al.

## 4. Uygula — sırayı bozma

- **Kontrat önce:** yeni uç varsa `packages/contract/openapi/openapi.yaml` → generate → route
- **`[MAX]` etiketliyse:** `testStrategy` alanındaki negatif testleri **önce** yaz ve
  kırmızı gördüğünü doğrula. Yeşile geçmeden pozitif akışa başlama
- Hata zarfı ADR-06: `{ error: { type, message, request_id, details? } }`
- Her sorgu lisans kapsamlı; cross-tenant testi olmadan iş bitmez

Öğrendiğin her şeyi — çalışanı da çalışmayanı da — günlükçüyle düş:
`node .taskmaster/gunluk.mjs <id> "..."`. Özellikle **çalışmayanı**: bir sonraki
oturum (ya da özetlenen bağlam) aynı duvara toslamasın.

## 5. Kapat — ekranı gören iş görsel kanıt bırakır

`testStrategy` alanındaki kabul kriterlerinin **hepsini** tek tek doğrula. Testleri çalıştır.
Bir madde karşılanmıyorsa görev `done` olmaz — ya tamamla ya `blocked` yap ve nedenini günlüğe yaz.

**Entegrasyon testi çalıştırdıysan demo verisini geri yükle — istisnasız:**

```bash
pnpm db:seed && curl -sf -X POST http://localhost:4000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@acme.localhost","password":"nexa-demo-password"}' >/dev/null \
  && echo "demo girişi OK" || echo "DEMO GİRİŞİ KIRIK — günlüğe yaz, done deme"
```

Entegrasyon paketi veritabanını **truncate ediyor** ve yerine kendi A/B kiracı
fikstürünü bırakıyor (`owner-a@example.test` …). 2026-07-24'te ölçüldü: görev 1'in
testlerinden sonra demo hesabı yok oldu, `owner@acme.localhost` girişi 401 döndü,
insan uygulamaya giremedi — testler ise yeşildi. "Testler yeşil" ile "uygulama
çalışıyor" aynı şey değildir; ikisini de doğrula.

**Görev bir ekran ya da widget davranışı üretiyorsa** (`apps/web/**`, `apps/widget/**`
dokunulduysa) kabul kriterini doğrulayan E2E adımı, iddianın **hemen ardından** kanıt
kaydeder:

```ts
await expect(...).toBeVisible();                       // önce iddia
await page.screenshot({ path: 'kanit/<id>-<kisa-ad>.png', fullPage: true });
```

`apps/e2e/playwright.config.ts` artefaktları yalnız **başarısızlıkta** tutuyor
(`screenshot: 'only-on-failure'`) — yani geçen bir koşu geriye bakılacak hiçbir şey
bırakmaz. Otonom çalışırken kimse ekrana bakmadığı için kanıtı test üretir; insan
sonradan inceler. Config'i değiştirme, her koşuyu şişirir.

`kanit/` git'e girmez; yolları kapanış raporunda listele. Playwright'ın kendi raporu
da durur: `pnpm --filter @nexa/e2e report`.

E2E paketi 4 sunucuyu (api, rtm, web, widget) kendi başlatır ve gerçek Chromium'da
cross-origin iframe kurar — terminalde başsız çalışır, tarayıcı aracına ihtiyaç yok.

Sonra `task-master set-status --id=<id> --status=done` ve `task-master generate` —
`.taskmaster/tasks/task_0NN.md` aynaları tazelensin.

## 6. Bitir

Kullanıcıya kısa rapor: ne yapıldı, hangi kabul kriteri nasıl doğrulandı, ne yapılmadı.
Sonra **`/clear` öner** — yeni iş yeni bağlamda başlar. (Döngü modundaysan aşağıya bak.)

Dilimin son işiyse `/clear` yerine `/dilim-kapat` öner.

## Döngü modu (`/loop /is` veya "seri çalış")

Kullanıcı `/loop /is` başlattıysa ya da "seri çalış / otonom devam et" dediyse kurallar değişir:

- **Soru sorup bekleme.** Karar gerekiyorsa en güvenli varsayımı seç, günlüğe
  `varsayım:` önekiyle yaz, ilerle. Varsayım taşıyan işleri kapanış raporunda işaretle.
- **Döngü dilim dalında çalışır.** İlk iterasyonda `main`'deysen `git checkout -b slice-<N>`
  (N'i görevin `Dilim N` çapasından al; komut mevcut değişiklikleri güvenle taşır).
  Sonraki iterasyonlar aynı dalda sürer; `main`'e dönüş yalnız `/dilim-kapat` merge'ünde.
- **Her işin kapanışında commit at, push etme.** `git add -A && git commit` —
  mesaj: `feat(<alan>): <özet> (tm <id> · FR-MOD-<xx>)`. Çökme yarım işi kaybettirmez,
  her görev tek diff olarak incelenebilir kalır. Push yalnız `/dilim-kapat`'ta —
  orada otomatiktir (2026-07-24 kullanıcı onayı).
- **`[MAX]` görev akışı durdurmaz ama denetimsiz de geçmez.** Negatif testler önce
  yazılır, kırmızı görülür, sonra yeşile çevrilir. İş **tek başına bir commit** olur
  (başka işle karıştırılmaz) ve `done`'a çekilir ki bağımlılar açılsın. Kapanış
  raporunda **[MAX] İNCELE** bölümü zorunludur: commit SHA'sı, test dosyaları,
  dört negatif senaryonun çıktısı. İnsan incelemesi kapanış raporu üzerinden yapılır;
  iş ayrı commit olduğu için gerekirse tek `git revert` ile geri alınır.
- `/clear` yok; bu yüzden 3–4. adımdaki günlük disiplini daha da kritik: bağlam
  özetlense bile durum `tasks.json`'da yaşamalı.
- Her iterasyonun sonunda tek paragraf rapor: `<id>` — ne yapıldı, kabul kriterleri durumu.
- `next` uygun iş vermiyorsa iki durum var:
  - **(a) Dilimin tüm görevleri `done`** → `/dilim-kapat` talimatını
    (`.claude/commands/dilim-kapat.md`) oku ve uygula: PLAN.md geri yazımı,
    açıklamalı merge + push, sonraki dilimin görevlerinin kurulumu. Sonra döngüye
    devam et — sıradaki iterasyon yeni dilimin ilk işini alır. Faz 0'ın son
    dilimiyse dilim-kapat §8 döngüyü durdurur.
  - **(b) `done` olmayan görev kaldı** (blocked/yarım) → **döngüyü sonlandır** ve
    kapanış raporu ver: biten işler, commit listesi, varsayımlar, **[MAX] İNCELE**
    bölümü, kırmızı kalan her şey. Boş tur atma.
- **Kapanış raporunda `kanit/` ekran görüntülerinin yollarını listele** — UI işleri
  için insanın gözden geçireceği tek şey bu. Ekran üreten bir iş kanıtsız kapandıysa
  raporda açıkça belirt.
