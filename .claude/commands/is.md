---
description: Sıradaki Task Master işini al ve plana sadık kalarak yürüt
argument-hint: "[görev id — boş bırakılırsa next]"
allowed-tools: Bash(task-master *), Read, Grep, Glob, Edit, Write, Bash(pnpm *), Bash(make *), Bash(git *)
---

Bir oturum = bir iş. `PLAN.md`'yi (89 KB) **okuma** — görevin kendisi zaten plana çivili.

## 1. İşi al

$ARGUMENTS boşsa `task-master next`, doluysa `task-master show $ARGUMENTS`.

Sonra `task-master set-status --id=<id> --status=in-progress`.

## 2. Bağlamı kur — yalnız gerekeni oku

Görevin `details` alanı sana dosya yolu ve satır numarası veriyor. **Sadece onları oku.**
`details` içindeki `PRD: FR-MOD-xx · PLAN.md §y` çapası, doğrulaman gerekirse nereye
bakacağını söyler — gereksiz yere açma.

Derinlik gerekiyorsa tek komut:
`task-master research "soru" --files=<yollar> --tree --save-to=<id>`

## 3. Planını yaz

Kodu okuduktan sonra, yazmadan önce:
`task-master update-subtask --id=<id> --prompt="plan: <ne yapacaksın, hangi dosyalar>"`

Bu satır, bağlam sıfırlanırsa geriye kalan tek şeydir. Ciddiye al.

## 4. Uygula — sırayı bozma

- **Kontrat önce:** yeni uç varsa `packages/contract/openapi/openapi.yaml` → generate → route
- **`[MAX]` etiketliyse:** `testStrategy` alanındaki negatif testleri **önce** yaz ve
  kırmızı gördüğünü doğrula. Yeşile geçmeden pozitif akışa başlama
- Hata zarfı ADR-06: `{ error: { type, message, request_id, details? } }`
- Her sorgu lisans kapsamlı; cross-tenant testi olmadan iş bitmez

Öğrendiğin her şeyi — çalışanı da çalışmayanı da — aynı komutla günlüğe düş.
Özellikle **çalışmayanı**: bir sonraki oturum aynı duvara toslamasın.

## 5. Kapat

`testStrategy` alanındaki kabul kriterlerinin **hepsini** tek tek doğrula. Testleri çalıştır.
Bir madde karşılanmıyorsa görev `done` olmaz — ya tamamla ya `blocked` yap ve nedenini günlüğe yaz.

Sonra `task-master set-status --id=<id> --status=done`.

## 6. Bitir

Kullanıcıya kısa rapor: ne yapıldı, hangi kabul kriteri nasıl doğrulandı, ne yapılmadı.
Sonra **`/clear` öner** — yeni iş yeni bağlamda başlar. (Döngü modundaysan aşağıya bak.)

Dilimin son işiyse `/clear` yerine `/dilim-kapat` öner.

## Döngü modu (`/loop /is` veya "seri çalış")

Kullanıcı `/loop /is` başlattıysa ya da "seri çalış / otonom devam et" dediyse kurallar değişir:

- **Soru sorup bekleme.** Karar gerekiyorsa en güvenli varsayımı seç, günlüğe
  `varsayım:` önekiyle yaz, ilerle. Varsayım taşıyan işleri kapanış raporunda işaretle.
- **`[MAX]` görevde `done` deme.** İşi tamamen bitir (negatif testler önce, hepsi yeşil),
  sonra `task-master set-status --id=<id> --status=review` — `done`'u insan verir.
  Ona bağımlı işler bekler; `next` başka uygun iş veriyorsa onunla devam et.
- `/clear` yok; bu yüzden 3–4. adımdaki günlük disiplini daha da kritik: bağlam
  özetlense bile durum `tasks.json`'da yaşamalı.
- Her iterasyonun sonunda tek paragraf rapor: `<id>` — ne yapıldı, kabul kriterleri durumu.
- `next` uygun iş vermiyorsa (hepsi bitti ya da kalanlar review/bağımlılık bekliyor)
  **döngüyü sonlandır** ve kapanış raporu ver: biten işler, review bekleyenler,
  varsayımlar, kırmızı kalan her şey. Boş tur atma.
