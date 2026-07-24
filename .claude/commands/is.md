---
description: Sıradaki Task Master işini al ve plana sadık kalarak yürüt
argument-hint: "[görev id — boş bırakılırsa next]"
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

## 5. Kapat

`testStrategy` alanındaki kabul kriterlerinin **hepsini** tek tek doğrula. Testleri çalıştır.
Bir madde karşılanmıyorsa görev `done` olmaz — ya tamamla ya `blocked` yap ve nedenini günlüğe yaz.

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
- **Her işin kapanışında commit at, push etme.** `git add -A && git commit` —
  mesaj: `feat(<alan>): <özet> (tm <id> · FR-MOD-<xx>)`. Çökme yarım işi kaybettirmez,
  her görev tek diff olarak incelenebilir kalır. Push yalnız `/dilim-kapat`'ta, insanla.
- **`[MAX]` görev akışı durdurmaz ama denetimsiz de geçmez.** Negatif testler önce
  yazılır, kırmızı görülür, sonra yeşile çevrilir. İş **tek başına bir commit** olur
  (başka işle karıştırılmaz) ve `done`'a çekilir ki bağımlılar açılsın. Kapanış
  raporunda **[MAX] İNCELE** bölümü zorunludur: commit SHA'sı, test dosyaları,
  dört negatif senaryonun çıktısı. İnsan incelemesi push'tan önce — dilim kapanışında.
- `/clear` yok; bu yüzden 3–4. adımdaki günlük disiplini daha da kritik: bağlam
  özetlense bile durum `tasks.json`'da yaşamalı.
- Her iterasyonun sonunda tek paragraf rapor: `<id>` — ne yapıldı, kabul kriterleri durumu.
- `next` uygun iş vermiyorsa (hepsi bitti ya da kalanlar bağımlılık bekliyor)
  **döngüyü sonlandır** ve kapanış raporu ver: biten işler, commit listesi,
  varsayımlar, **[MAX] İNCELE** bölümü, kırmızı kalan her şey. Boş tur atma.
