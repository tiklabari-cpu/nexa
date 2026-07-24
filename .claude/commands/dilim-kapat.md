---
description: Dilimi kapat — PLAN.md'yi geri güncelle, sayacı sayarak üret, commit at, sonraki dilimin görevlerini kur
allowed-tools: Bash(task-master *), Read, Grep, Glob, Edit, Bash(git *), Bash(pnpm *), Bash(make *)
---

Task Master ileri yönde çalışır (plan → görev). Bu komut **geri yönü** kapatır: görev → plan.
Yapılmazsa `PLAN.md` yalan söylemeye başlar.

## 1. Gerçekten bitti mi

`task-master list` — dilimin tüm görevleri `done` mu?

`done` olmayan varsa dur. Kullanıcıya sor: tamamlanacak mı, yoksa `PLAN.md §D`'ye gerekçeli
sapma olarak mı yazılacak? Kendi başına karar verme.

## 2. PLAN.md §3 durum işaretlerini güncelle

Her görevin `details` alanındaki `PLAN.md §x` çapasını izle. İlgili satırın işaretini
⬜/◐ → ✅ yap. **Yalnız gerçekten teslim edilmiş satırı** ✅ yap — "ekran duruyor" ✅ değildir,
`◐` kalır (PLAN.md §1.2).

## 3. Dilim tablosu ve faz sayacı

- `PLAN.md §3.11` dilim tablosunda ilgili satırı `~~13~~ ... ✅` biçimine çevir, merge SHA'sını yaz
- Kapsamdan çıkan kalem varsa hangi dilime taşındığını **aynı satıra** yaz
- Baştaki faz sayacını güncelle

> Sayaç **sayılarak** üretilir, elle yazılmaz — PLAN.md §1.2. Bu bir kez elle yazıldı
> ve dosyayla uyuşmadığı fark edilmeden kaldı. §3'teki işaretleri gerçekten say.

## 4. Sapma ve varsayımlar

- Plandan sapıldıysa → `PLAN.md §D` (PRD sapması)
- Onay beklemeden alınmış karar varsa → `PLAN.md §C` (Assumptions)

Görev günlüklerini (`task-master show <id>`) tara: uygulama sırasında verilmiş kararlar
oradadır ve çoğu §C'ye aittir.

## 5. Kapanış kapısı

- `make dev` temiz kurulumdan çalışıyor
- Birim + Playwright E2E yeşil
- Dilimin PRD kabul kriterleri karşılandı

## 6. Commit

Yeni dal aç (main'deysen), commit + push. Mesajda dilim numarası ve PRD kimlikleri geçsin.

## 7. Sonraki dilimi kur

`PLAN.md §3.11`'den sıradaki dilimi oku. Sonra **kodu okuyarak** görevleri üret:

```bash
task-master add-task --title "..." --description "..." --details "..." \
  --dependencies "..." --priority high
```

`parse-prd` / `expand` / `add-task --prompt` **kullanma** — hiçbiri kod tabanını görmez,
ADR'lerle çelişen jenerik adımlar yazar. Her görevin `details` alanına
`PRD: FR-MOD-xx · PLAN.md §y · Dilim N` çapasını, `testStrategy` alanına PRD kabul
kriterini koy. (`testStrategy`'nin CLI flag'i yok — `tasks.json`'ı düzenleyip
`task-master generate` çalıştır.)

Bitince `task-master validate-dependencies` ve `/clear`.
