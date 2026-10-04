# Task ID: 149

**Title:** FIX-WT-CLEAN-RUNLOOP · Çalışma ağacındaki commit'siz `run-loop.sh` (panel nazik-durdurma kapısı) commit'lensin

**Status:** done

**Dependencies:** None

**Priority:** critical

**Description:** Panelin sağlık taraması `main` üzerinde 1 izlenen, commit'siz dosya buldu: `run-loop.sh`. Değişiklik, panelin `.loop-logs/STOP-REQUESTED` bayrağını görev sınırlarında okuyup döngünün KENDİ temiz çıkmasını sağlayan `stop_gate()` kapısı. CONVENTIONS §2 her task sonunda commit + push şart koşuyor; kirli bırakılan ağaç bir sonraki pencerenin hangi değişikliğin kime ait olduğunu ayırt edememesine yol açıyor (tm 148 HANDOFF notu bunu zaten "sahibi panel/kullanıcı" diye işaretlemişti ama kapsam dışı olduğu için commit etmemişti). Bu görev o değişikliği sahiplenip commit + push eder ve ağacı temizler.

**Details:**

BOOTSTRAP (bu kutu kendi kendine yeter):
- Depo: C:\Users\Hobbie\Desktop\nexa-main · dal: `main` · uzak: origin/main.
- Dosya: repo kökündeki `run-loop.sh` (otonom döngü koşucusu; hiçbir pnpm workspace paketine ait değil).
- Diff kapsamı (git diff ile ölçüldü, 2 hunk, +23 satır, -0):
  1) ~satır 250-270: `STOP_FLAG=".loop-logs/STOP-REQUESTED"` + `STOP_HONORED=".loop-logs/STOP-HONORED"`
     tanımları, `stop_gate()` fonksiyonu (bayrak varsa logla → `mv` ile STOP-HONORED'a taşı → `exit 0`)
     ve koşu başında kalmış bayrakları temizleyen `rm -f`.
  2) ~satır 278 + 300-305: iki çağrı yeri — `stop_gate "tur başı"` (while döngüsünün ilk satırı) ve
     `stop_gate "görev penceresi açılmadan"` (KAPI 1 / quota_gate'ten hemen sonra, pahalı Claude
     penceresi açılmadan önce).
- Sahiplik: Task Master kuyruğu bu iş açıldığında BOŞtu (148/148 done, in-progress yok), yani
  değişiklik hiçbir yarım göreve ait değil — panel/kullanıcı tarafından yapılmış bir koşum-aracı
  iyileştirmesi. tm 148'in HANDOFF notu bunu açıkça yazıyor.

YAPILACAK:
1) `git diff` ile değişikliği doğrula; `bash -n run-loop.sh` (sözdizimi) geçmeli.
2) Secret taraması: diff'te .env / anahtar / token yok (CONVENTIONS §2). `.loop-logs/` zaten
   `.gitignore:33`'te — bayrak dosyaları repoya sızmaz.
3) Tek anlamlı Conventional Commit: `feat(loop): ...` — başka değişiklik aynı commit'e tıkılmaz.
4) `git push` (force YOK, history rewrite YOK — CLAUDE.md sınırı).
5) HANDOFF.md'ye kapanış notu; tm 148'in "commit'siz duruyor" notu artık kapandı.

KAPSAM DIŞI (bilerek): `stop_gate` retry penceresinden (KAPI 2) önce ÇAĞRILMIYOR. Bu bir davranış
değişikliği olur, mevcut diff'te yok ve bu görev diff'i genişletmiyor. Not olarak HANDOFF'a düşülür.

DEPENDENCIES: boş — düzeltme hemen çalışabilir, hiçbir işi beklemiyor.

**Test Strategy:**

Kabul kriterleri (hepsi komutla + exit code ile):
1) `bash -n run-loop.sh` → exit 0 (sözdizimi temiz).
2) `git status --porcelain` → BOŞ çıktı (izlenen + izlenmeyen hiçbir dosya kalmamalı).
3) `git log --oneline -1` → run-loop.sh commit'i; `git status -sb` → `## main...origin/main` (ahead YOK, push edilmiş).
4) `git show --stat HEAD` → yalnız `run-loop.sh` (+ ayrı commit'te HANDOFF.md) — ilgisiz dosya karışmamış.
5) Secret kapısı: `git show HEAD -- run-loop.sh | grep -iE 'api[_-]?key|secret|token|passwo?rd|PRIVATE KEY'` → eşleşme yok.
6) DoD kapıları: `run-loop.sh` HİÇBİR workspace paketinin girdisi değil ve `format:check` globu
   (`**/*.{ts,tsx,js,json,md,css,yaml,yml}`) `.sh` kapsamıyor → ürün kodu diff'i 0. Yine de
   `pnpm -w typecheck`, `pnpm -w lint`, `pnpm -w format:check` koşulup exit 0 kaydedilir; test/
   integration/build/e2e bu diff'i yapısal olarak gözlemleyemez (turbo girdi hash'i değişmedi) ve
   ATLANMA SEBEBİ kapanış notunda açıkça yazılır — sessizce atlanmaz.
