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
- [ ] **PLAN.md gereksinim satırı güncellendi** — task'ın PRD kodundaki satır(lar) `⬜`/`◐` → `✅`
      ve kanıt yazılı. Doğrulama: `grep -n '| <PRD kodu>' PLAN.md` çıktısındaki **durum damgalı**
      satırlarda `⬜` kalmamalı. Bir task birden çok satır kapatıyorsa hepsi. Kısmen karşılandıysa
      `◐` + eksik açıklaması doğru cevaptır; `✅` uydurmak bu kutuyu geçmez.

> Not: repo script adları farklıysa `package.json`'daki gerçek script'leri kullan; yoksa
> önce onları ekle. Kapı komutları repo büyüdükçe bu dosyada güncellenir.

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
