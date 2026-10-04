# Task ID: 169

**Title:** FIX-WT-CLEAN-RUNLOOP-2 · Çalışma ağacındaki commit'siz `run-loop.sh` (elle-başlatma önceliğinde kota sıfırlanmasını bekleme) commit'lensin

**Status:** done

**Dependencies:** None

**Priority:** critical

**Description:** Panelin sağlık taraması `main` üzerinde 1 izlenen, commit'siz dosya buldu: `run-loop.sh` (+0 izlenmeyen). Değişiklik tek bir tutarlı iş: panel `/api/usage` yanıtında `manualOverride.active` bildirdiğinde kota kapısı döngüyü KAPATMAK yerine sıfırlanmayı bekliyor ve kaldığı yerden sürüyor (`wait_for_reset()` + `quota_gate` içinde yeniden ölçüm turu + `LOOP_WAIT_RESET_MAX_MIN` üst sınırı). Panel tarafı ayrı depoda hazır. CONVENTIONS §2 her task sonunda commit + push şart koşuyor; kirli bırakılan ağaç bir sonraki pencerenin hangi değişikliğin kime ait olduğunu ayırt edememesine yol açıyor — tm 153.1-153.7'nin yedi penceresi bu dosyayı bilinçli olarak 'bu göreve ait değil' diye bıraktı. Bu görev değişikliği sahiplenip commit + push eder ve ağacı temizler (tm 149'un ikinci turu).

**Details:**

BOOTSTRAP (bu kutu kendi kendine yeter):
- Depo: C:\Users\Hobbie\Desktop\nexa-main · dal: `main` · uzak: origin/main.
- Dosya: repo kökündeki `run-loop.sh` (otonom döngü koşucusu; HİÇBİR pnpm workspace paketinin
  girdisi değil, `format:check` globu `.sh` uzantısını kapsamıyor → ürün kodu diff'i 0).
- Diff kapsamı (`git diff` ile ölçüldü: 2 hunk, +75 / -17; eksilerin TAMAMI `quota_gate`'in
  `while` içine alınıp yeniden girintilenen eski gövdesi — silinen davranış yok):
  1) ~satır 56-60: `WAIT_RESET_MAX_MIN="${LOOP_WAIT_RESET_MAX_MIN:-90}"` + gerekçe yorumu.
  2) ~satır 231-309: `quota_gate` gövdesi bir `while` turuna alındı — panel `/api/usage`
     yanıtındaki `manualOverride.active` true ise kapı döngüyü KAPATMAK yerine
     `wait_for_reset()` ile sıfırlanmayı bekler, sonra kotayı YENİDEN ölçer (`rounds < 5`
     üst sınırı bayat `resumeAtIfStopped` karşısında sonsuz beklemeyi kesiyor; bekleyişten
     sonraki ölçüm `?fresh=1` ile panelin 30 sn'lik önbelleğini atlıyor). Yeni
     `wait_for_reset()` beklerken 10 sn'de bir `stop_gate` çağırıyor (tm 149'un kapısı), yani
     bekleyiş durdurulabilir; 5 dk'da bir kalan süreyi logluyor. Beklerken hiç pencere
     açılmadığı için kota harcanmaz.
- Panel tarafı AYRI DEPODA ve HAZIR (salt-okuma doğrulandı, dokunulmaz):
  Claude_Loop_Controller-main/`lib/manualOverride.mjs` `summary()` → `{active, untilISO, ...}`,
  `server.mjs:90` bunu `/api/usage` yanıtına `manualOverride` olarak koyuyor, `server.mjs:81`
  `?fresh` parametresini `getUsage({fresh})`'e geçiriyor, `resumeAtIfStopped` zaten vardı.
  Yani script'in okuduğu üç alanın üçü de sunucuda mevcut — yarım bir uç yok.
- Sahiplik git + Task Master ile kanıtlandı (tahmin değil): kuyrukta `in-progress` görev YOK
  (168 görev, 153 done / 15 pending) ve pending görevlerin hiçbiri `run-loop.sh`/panel işi
  değil. tm 153.1-153.7'nin yedi kapanış notu da aynı şeyi yazıyor: "`run-loop.sh`'ın
  commit'siz değişikliği BU GÖREVE AİT DEĞİL — dokunulmadı". Sahibi panel/kullanıcıdır.
  Aynı desenin birincisi tm 149 (FIX-WT-CLEAN-RUNLOOP, `stop_gate` kapısı) idi.

YAPILACAK:
1) `git diff` ile değişikliği doğrula; `bash -n run-loop.sh` (sözdizimi) geçmeli.
2) Secret taraması: dosyada .env / anahtar / token yok (CONVENTIONS §2).
3) Tek anlamlı Conventional Commit: `feat(loop): ...` — ilgisiz hiçbir şey aynı commit'e girmez.
4) `git push` (force YOK, history rewrite YOK — CLAUDE.md sınırı).
5) HANDOFF.md'ye kapanış notu: yedi pencerelik "sahipsiz" emsali kapandı.

KAPSAM DIŞI (bilerek): tm 149'un bıraktığı KAPI 2 boşluğu (`stop_gate` retry penceresinden
önce hâlâ çağrılmıyor) bu diff'te de yok — davranış değişikliği olur, görev diff'i genişletmez.
Panel deposuna (Claude_Loop_Controller-main) dokunulmaz: ayrı repo, CLAUDE.md sınırı.

DEPENDENCIES: boş — düzeltme hemen çalışabilir, hiçbir işi beklemiyor.

**Test Strategy:**

Kabul kriterleri (hepsi komutla + exit code ile):
1) `bash -n run-loop.sh` → exit 0 (sözdizimi temiz).
2) `git status --porcelain` → BOŞ çıktı (izlenen + izlenmeyen hiçbir dosya kalmamalı).
3) `git status -sb` → `## main...origin/main` (ahead YOK — push edilmiş).
4) `git show --stat HEAD~2` (ya da run-loop.sh commit'i) → yalnız `run-loop.sh`; HANDOFF ve
   Task Master ayrı commit'lerde (ilgisiz değişiklik tıkılmadı).
5) Yapısal olarak etkilenen kapılar yeşil: `pnpm -w typecheck` (exit 0) · `pnpm -w lint`
   (exit 0) · `pnpm -w format:check` (exit 0). `test` / `test:integration` / `build` /
   `test:e2e` ATLANIR — gerekçe: `run-loop.sh` hiçbir workspace paketinin girdisi değil,
   turbo girdi hash'i değişmiyor (typecheck/lint cache hit ile kanıtlanır), yani bu kapılar
   diff'i yapısal olarak gözlemleyemez (tm 149 emsali). Kontrat/migration'a dokunulmadı →
   `contract:generate` / `db:check-drift` gereksiz (CONVENTIONS §1 koşullu maddeleri).
