---
description: Dilimi kapat — PLAN.md'yi geri güncelle, açıklamalı merge + push (otomatik, onaylı), sonraki dilimin görevlerini kur
allowed-tools: Bash(task-master *), Read, Grep, Glob, Edit, Bash(git *), Bash(pnpm *), Bash(make *)
---

Task Master ileri yönde çalışır (plan → görev). Bu komut **geri yönü** kapatır: görev → plan.
Yapılmazsa `PLAN.md` yalan söylemeye başlar.

## 1. Gerçekten bitti mi

`task-master list` — dilimin tüm görevleri `done` mu?

`done` olmayan varsa dilim KAPANMAZ. Elle çalışıyorsan kullanıcıya sor. Döngü
modundaysan kapatmayı deneme: döngüyü sonlandır, raporda nedenini söyle —
yarım dilimi kapatmak `PLAN.md`'yi yalancı çıkarır, o karar insana aittir.

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

Kapı geçilmeden push YOK. Kırmızı varsa önce düzelt; düzeltemiyorsan döngüyü
durdur ve raporla — kırmızının üstüne dilim kapatılmaz.

## 6. Merge + push (otomatik — kullanıcı 2026-07-24'te onayladı)

Görev commit'leri `slice-<N>` dalında birikti (bkz. `/is` döngü modu). Sırayla:

1. PLAN.md güncellemelerini dal üstünde commit'le: `docs(plan): dilim <N> kapanışı`
2. `git checkout main && git merge --no-ff slice-<N>` — merge mesajı şablonu
   (git geçmişindeki `merge: slice 11/12` deseninin devamı):

   ```
   merge: slice <N> — <dilimin kısa adı>

   Teslim: <FR-MOD kimlikleri — her biri tek satır özet>
   Sapmalar: <§D'ye yazılanlar; yoksa "yok">
   Varsayımlar: <§C'ye yazılanlar; yoksa "yok">
   [MAX]: <ayrı commit SHA'ları> — İNCELE bölümü kapanış raporunda
   Testler: <birim/E2E sonuçları — hepsi yeşil>
   ```

3. `git push origin main` ve `git branch -d slice-<N>`

Push açıklamasız gitmez — şablondaki her alan doldurulur.

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

Bitince `task-master validate-dependencies`. Elle moddaysan `/clear` öner;
döngü modundaysan döngüye dön — sıradaki iterasyon yeni dilimin ilk işini alır.

## 8. Faz 0'ın son dilimi kapandıysa — DUR

Sonraki dilim yoksa (§3.11 tablosu bitti) yeni görev KURMA, Faz 1'e GEÇME.
`PLAN.md §F` (Orkestratör Kapanış Turu — zorunlu) uygulanır: §F.1 denetimini yap,
§F.2 raporunu kullanıcıya sun, döngüyü sonlandır. Faz 1–3 durumları geçicidir ve
faz başlarken koda karşı denetlenir (PLAN.md §1.2) — o denetimi başlatmak insan kararıdır.
