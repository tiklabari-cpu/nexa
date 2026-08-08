#!/usr/bin/env bash
# =============================================================================
# Nexa — Otonom Görev Döngüsü (CANLI loglamalı)
# Her task TEMİZ bir Claude Code penceresinde çalışır; durum Task Master + git'te.
# Politika: full-otonom (bypassPermissions) | hata → 1 kez temiz pencerede retry
#           → yine olmazsa DUR + bildir | efor task etiketine göre otomatik.
# İZLEME: her pencere terminale canlı akar + tam kayıt .loop-logs/'a yazılır.
#         Ayrı izleme:  tail -f .loop-logs/task-<id>.jsonl | ./run-loop.sh yok;
#         basitçe bu script'in çıktısını izle veya:  tail -f .loop-logs/*.jsonl
# ÖNCE OKU: unattended bırakmadan ilk 1-2 turu izle; `claude --help` ile
#           --effort / --permission-mode adlarını sürümünde teyit et.
# =============================================================================
set -uo pipefail

# --- Ayarlar -----------------------------------------------------------------
# --- Model x efor matrisi (PLAN §5.1.1) -------------------------------------
# Görev/alt-görev başlığındaki etiket hem MODELİ hem EFORU seçer:
#   [SONNET-XHIGH] → sonnet + xhigh     [SONNET-MAX] → sonnet + max
#   [OPUS-XHIGH]   → opus   + xhigh     [OPUS-MAX]   → opus   + max
# Eski tek boyutlu etiketler (Faz-0/v1 tarihçesi) geriye dönük çalışır:
#   [MAX] → opus+max · [XHIGH] veya etiketsiz → opus+xhigh
# Efor tabanı xhigh'dır; güvenlik işi asla sonnet'e verilmez (PLAN §5.1.1).
MODEL="opus"                # varsayılan/geri-uyum modeli
MODEL_BIG="opus"
MODEL_SMALL="sonnet"
EFFORT_MAX="max"            # opus 'max' desteklemiyorsa: "high"
EFFORT_HIGH="xhigh"
PERM="bypassPermissions"   # tam otonom, prompt YOK. Güvenli alt.: "auto"
MAX_TURNS=250
RUNNER_PROMPT_FILE="TASK-RUNNER-PROMPT.md"
LOG_DIR=".loop-logs"; mkdir -p "$LOG_DIR"
MAX_CONSEC_ERRORS=5
BACKOFF_SECS=90
# Bir görev kapıyı geçemeyip 'blocked' kaldığında iş TERK EDİLMİŞ olur: pick_next
# blocked görev seçmediği için döngü sessizce bir sonrakine geçer ve yarım kalan
# iş bir daha asla ele alınmaz. Artık böyle görevler (bağımlılıkları kapalıysa)
# yeniden seçiliyor — ama sonsuz döngü olmasın diye sayılı: bir görev
# MAX_TASK_ATTEMPTS tam tur (her tur = 1 deneme + 1 retry) başarısız olursa
# atlanır ve elle müdahale için raporlanır.
MAX_TASK_ATTEMPTS="${LOOP_MAX_TASK_ATTEMPTS:-2}"
ATTEMPTS_FILE="$LOG_DIR/attempts.tsv"; : >> "$ATTEMPTS_FILE"
# Tek görev başarısızlığı artık döngüyü durdurmuyor (yukarı bkz.), ama ÜST ÜSTE
# bu kadar pencere başarısız olursa sorun tek görevde değil ortamdadır (bozuk
# build, düşen servis, yanlış branch) — o zaman durmak doğrusu: yoksa kalan tüm
# görevler sırayla denenip kota boşa yanar.
MAX_CONSEC_TASK_FAILS="${LOOP_MAX_CONSEC_TASK_FAILS:-3}"
ALLOW=""                   # gerekirse: '--allowedTools Bash(git *),Bash(pnpm *)'

# --- Kota kapısı ayarları -----------------------------------------------------
# Bir pencere açmadan ÖNCE "kalan kota bu işi kaldırır mı?" diye sorulur. Maliyet
# yüzdeleri geçmiş koşulardan ölçüldü (tam 5 saatlik pencere ≈ $170 → %1 ≈ $1.7):
# xhigh ortancası ~$13 (%8), max görevler $25-31 (%15-18) — üste yuvarlandı.
# RESERVE_PCT = kendi elle kullanımın için ayrılan pay.
PANEL_URL="${DASH_URL:-http://127.0.0.1:4545}"
RESERVE_PCT="${LOOP_RESERVE_PCT:-5}"
COST_MAX_PCT="${LOOP_COST_MAX_PCT:-20}"
COST_HIGH_PCT="${LOOP_COST_HIGH_PCT:-10}"

pick_schema='{"type":"object","properties":{"has_task":{"type":"boolean"},"task_id":{"type":"string"},"model":{"type":"string","enum":["sonnet","opus"]},"effort":{"type":"string","enum":["max","high"]},"remaining":{"type":"integer"}},"required":["has_task"]}'
result_schema='{"type":"object","properties":{"status":{"type":"string","enum":["done","blocked"]},"task_id":{"type":"string"},"summary":{"type":"string"}},"required":["status"]}'

log(){ echo "[$(date -u +%H:%M:%S)] $*"; }

# --- Görev deneme sayacı (tur bazlı, koşular arasında kalıcı) -----------------
# Biçim: "<task_id>\t<tur_sayısı>" — awk/grep dışında bağımlılık yok, jq gerekmez.
attempts_of(){ awk -F'\t' -v id="$1" '$1==id{n=$2} END{print n+0}' "$ATTEMPTS_FILE" 2>/dev/null; }
# Tam ALAN eşleşmesi şart: grep -F "93.4" satır içinde "193.4"e de uyar ve yanlış
# kaydı silerdi. awk $1==id bunu yapısal olarak engeller.
_drop_id(){
  awk -F'\t' -v id="$1" '$1!=id' "$ATTEMPTS_FILE" > "$ATTEMPTS_FILE.tmp" 2>/dev/null || : > "$ATTEMPTS_FILE.tmp"
  mv "$ATTEMPTS_FILE.tmp" "$ATTEMPTS_FILE"
}
bump_attempt(){
  local id="$1" n; n=$(( $(attempts_of "$id") + 1 ))
  _drop_id "$id"; printf '%s\t%s\n' "$id" "$n" >> "$ATTEMPTS_FILE"
}
clear_attempt(){ _drop_id "$1"; }
# Denemesi tükenmiş görevler — pick_next'e "bunları seçme" diye verilir.
exhausted_ids(){ awk -F'\t' -v max="$MAX_TASK_ATTEMPTS" '$2>=max{print $1}' "$ATTEMPTS_FILE" 2>/dev/null | paste -sd, - ; }

# --- Canlı akış: stream-json olaylarını insana çevirir; jq yok/hata → raw -----
pretty(){
  if command -v jq >/dev/null 2>&1; then
    jq -r --unbuffered '
      if .type=="system" and .subtype=="init" then "   · pencere açıldı (model \(.model // "?"))"
      elif .type=="system" and .subtype=="api_retry" then "   · API retry #\(.attempt // "?") (\(.error // ""))"
      elif .type=="assistant" then
        ([ .message.content[]?
           | if .type=="text" then "   " + ((.text // "")|gsub("\n";" ")|.[0:180])
             elif .type=="tool_use" then "   → \(.name)"
             else empty end ] | .[])
      elif .type=="result" then "   · [pencere sonucu alındı]"
      else empty end' 2>/dev/null || cat
  else
    cat
  fi
}

# =============================================================================
# Sanity: doğru dizinde miyiz?
if [ ! -f "urun-gereksinim-dokumani-PRD.md" ] || [ ! -f "$RUNNER_PROMPT_FILE" ]; then
  log "✖ HATA: bu script Nexa proje kökünde çalışmalı (PRD + $RUNNER_PROMPT_FILE burada olmalı)."
  exit 1
fi

# Tek seferlik BOOTSTRAP (ilk çalıştırma) — canlı akar
if [ ! -d ".taskmaster" ]; then
  log "⚙ İlk çalıştırma → kurulum (git + parse-prd + efor etiketleri). Canlı izliyorsun:"
  claude -p "Bu depoyu Nexa otonom yapımına HAZIRLA. Kod YAZMA, yalnız kurulum:
1) Oku: CLAUDE.md, MASTER-PROMPT.md, CONVENTIONS.md, urun-gereksinim-dokumani-PRD.md.
2) Git: repo yoksa 'git init' + 'git branch -M main'; remote yoksa
   'git remote add origin git@github.com:tiklabari-cpu/nexa.git'. .gitignore zaten var.
   İlk commit: doküman + döngü dosyaları → 'chore: bootstrap docs + autonomous loop' → push.
3) Task Master kurulu değilse kur+ekle; 'task-master parse-prd urun-gereksinim-dokumani-PRD.md'
   ile PRD'yi görev ağacına çevir (MASTER-PROMPT 'MVP Kritik Yol' sırası + bağımlılıklar).
   ÖNCELİK: yalnız 'high' (Faz-0 · v1 Must) / 'medium' (v1 Should) / 'low' (v2-v3) kullan.
   'critical' KULLANMA — o seviye panelin 'düzeltmeye gönder' akışına rezervedir (CONVENTIONS §4.1).
4) MASTER-PROMPT 'Efor Kapıları'ndaki [MAX] işlere task başlığına [MAX] ekle; gerisi [XHIGH].
5) PLAN.md + HANDOFF.md iskeleti oluştur.
6) DUR — hiçbir Faz task'ını YAPMA." \
    --model "$MODEL" --effort high --permission-mode "$PERM" --max-turns 80 $ALLOW \
    --output-format stream-json --verbose \
    2>>"$LOG_DIR/bootstrap.err" | tee -a "$LOG_DIR/bootstrap.jsonl" | pretty
  if [ ! -d ".taskmaster" ]; then
    log "✖ Bootstrap tamamlanamadı. Bkz. $LOG_DIR/bootstrap.err"
    exit 1
  fi
  log "✓ Kurulum tamam. Döngüye giriliyor."
fi

# --- Sıradaki hazır task + efor (ucuz, sessiz) -------------------------------
pick_next(){
  local skip skip_line
  skip=$(exhausted_ids)
  if [ -n "$skip" ]; then
    skip_line="ASLA SEÇME: $skip — bu görevlerin deneme hakkı tükendi, elle müdahale bekliyor."
  else
    skip_line="Atlanacak görev yok."
  fi
  claude -p "Task Master (MCP): sıradaki işi seç.

⚠ ÖNCE BUNU OKU — BAĞIMLILIK KİMLİĞİ ÇÖZÜMLEME (en sık yapılan hata):
Bir ALT GÖREVİN 'dependencies' alanındaki çıplak sayılar KARDEŞ ALT GÖREV numaralarıdır,
üst seviye görev id'si DEĞİLDİR. Örnek: 77.10 için dependencies=[\"3\",\"4\"] demek
77.3 ve 77.4 demektir — üst seviyedeki 3 ve 4 numaralı görevler DEĞİL.
Bu ikisi çok farklı sonuç verir: üst seviye 3/4 'done' olabilirken 77.3/77.4 'pending' olabilir.
KURAL: bir alt görevin bağımlılığını kontrol ederken sayının başına DAİMA üst görev id'sini ekle
(\"<üst_id>.<sayı>\"), zaten nokta içeriyorsa olduğu gibi kullan.

🚧 SEÇİM ÖNCESİ ZORUNLU DOĞRULAMA KAPISI:
Bir görevi seçmeden ÖNCE bağımlılıklarını TEK TEK, yukarıdaki kuralla çözerek oku ve her birinin
durumunun 'done' veya 'cancelled' olduğunu GÖR. Bir tanesi bile açıksa (pending/in-progress/
blocked/deferred) O GÖREVİ SEÇME — başka aday ara. Doğrulamadan seçilen görev pahalı bir pencereyi
boşa yakar: pencere açılır, bağımlılığın bitmediğini görür ve iş yapmadan kapanır.
Hiçbir aday doğrulamadan geçmiyorsa has_task=false döndür — yanlış görev seçmektense hiç seçme.

ÖNCELİK SIRASI kesindir:
0) $skip_line
1) Durumu 'in-progress' olan bir görev VEYA alt-görev varsa ONU seç. Bu yarım kalmış iştir —
   önceki pencere kota/çökme/elle durdurma yüzünden kapanmış olabilir. Açılacak pencere
   protokolün resume adımıyla kaldığı yerden devam edecek, atlanırsa o iş sonsuza kadar asılı kalır.
1.5) Yoksa: durumu 'blocked' AMA TÜM bağımlılıkları kapalı (done/cancelled) olan bir görev
   VEYA alt-görev varsa ONU seç. Bu, doğrulama kapısını geçemeyip yarıda bırakılmış iştir;
   hiçbir şeyi beklemiyor, yeniden denenebilir ve denenmelidir — yoksa kalıcı olarak terk edilir.
   ⛔ Bağımlılığı HÂLÂ AÇIK olan blocked görevleri SEÇME: onlar gerçekten bekliyor, tekrar
   denemek anlamsızdır. Birden çok aday varsa en küçük id'yi seç.
2) Yoksa priority='critical' olan bir 'pending' görev varsa ONU seç. Bunlar panelin sağlık
   taramasından doğan DÜZELTME görevleridir ve normal backlog'un (high/medium/low) ÖNÜNE geçer.
   Birden çoksa en eski (en küçük id) olanı seç.
3) Yoksa bağımlılıkları tamamlanmış (YUKARIDAKİ DOĞRULAMA KAPISINDAN geçmiş), durumu 'pending'
   olanlardan en yüksek öncelikliyi seç (sıra: high > medium > low).
   ⚠ Bu adımda hata en pahalıya patlıyor: alt görev bağımlılıklarını kardeş numarası olarak
   çözmezsen 'done' sanıp boş pencere açarsın. Her adayı seçmeden önce tek tek doğrula.
   Bir üst görevin alt-görevleri varsa ALT-GÖREVİ seç (üst görev kod yazmaz, alt-görevleri koşulur);
   alt-görevler arasında kendi 'dependencies' sırasını gözet.
İş YAPMA, kod okuma/yazma yok.
Döndür: has_task, task_id, model, effort, remaining (kalan yapılabilir görev sayısı).
MODEL ve EFOR seçilen işin BAŞLIĞINDAKİ ETİKETTEN okunur (PLAN §5.1.1 model x efor matrisi):
  [SONNET-XHIGH] -> model=\"sonnet\", effort=\"high\"   (\"high\" burada xhigh anlamına gelir)
  [SONNET-MAX]   -> model=\"sonnet\", effort=\"max\"
  [OPUS-XHIGH]   -> model=\"opus\",   effort=\"high\"
  [OPUS-MAX]     -> model=\"opus\",   effort=\"max\"
Eski tek boyutlu etiketler (Faz-0/v1 tarihcesi): [MAX] -> opus+max; [XHIGH] veya etiket YOK -> opus+high.
Etiket belirsizse GÜVENLİ tarafa düş: model=\"opus\", effort=\"max\"." \
    --model "$MODEL" --effort low --permission-mode "$PERM" --max-turns 10 $ALLOW \
    --output-format json --json-schema "$pick_schema" 2>>"$LOG_DIR/pick.err" \
    | jq -c '.structured_output' 2>/dev/null
}

# --- Bir task'ı temiz pencerede çalıştır (CANLI akar; status dosyadan okunur) -
stream_task(){
  local id="$1" eff="$2" mdl="${3:-$MODEL}"
  local logf="$LOG_DIR/task-$id.jsonl"
  : > "$logf"
  claude -p "$(cat "$RUNNER_PROMPT_FILE")

# HEDEF TASK: ${id}
Yalnız bu task'ı baştan sona tamamla, protokolü uygula, en son JSON sonucu döndür." \
    --model "$mdl" --effort "$eff" --permission-mode "$PERM" --max-turns "$MAX_TURNS" $ALLOW \
    --output-format stream-json --verbose --json-schema "$result_schema" \
    2>>"$LOG_DIR/task-$id.err" | tee -a "$logf" | pretty
}
status_from(){ jq -r 'select(.type=="result") | (.structured_output.status // empty)' "$1" 2>/dev/null | tail -1; }

# --- Kota kapısı: bu pencereyi açmaya yetecek kota var mı? --------------------
# Panelin bekçisi yalnız GÖREVLER ARASINDA durdurabiliyor: bir pencere açıldıktan
# sonra "BİTTİ" satırı gelene kadar kesilmiyor, ve retry aynı görevin içinde
# olduğu için araya hiç giremiyor. Yani tek bir pahalı görev (+retry) kalan payı
# aşıp kotayı pencere ORTASINDA bitirebiliyordu — yarım dosya, commit'siz iş.
# Bu kapı kararı pencere AÇILMADAN önce verir, o yüzden o riski kapatır.
#
# $1 = efor etiketi · $2 = aşama adı (log için)
# 0 → devam et · 1 → kota yetmiyor (çağıran temiz çıkar; panel sıfırlanmadan
# sonra döngüyü yeniden başlatır, in-progress task pick_next'te ilk sırada
# olduğu için aynı işten devam edilir).
# Panel kapalı/okunamıyorsa 0 döner (fail-open) — döngü panele bağımlı değildir.
# $1 = efor · $2 = aşama adı (log için) · $3 = model (sonnet pencereleri belirgin ucuz)
quota_gate(){
  local stage="$2" mdl="${3:-$MODEL_BIG}" need used remaining usage resume_at
  if [ "$1" = "$EFFORT_MAX" ]; then need=$((COST_MAX_PCT+RESERVE_PCT)); else need=$((COST_HIGH_PCT+RESERVE_PCT)); fi
  # sonnet pencereleri ölçülen opus maliyetinin küçük bir kesri — kapıyı orantılı gevşet,
  # ama RESERVE_PCT'yi asla yeme (kullanıcının elle kullanımı için ayrılmış pay).
  if [ "$mdl" = "$MODEL_SMALL" ]; then need=$(( (need - RESERVE_PCT) / 3 + RESERVE_PCT )); fi

  usage=$(curl -s --max-time 5 "$PANEL_URL/api/usage" 2>/dev/null)
  used=$(printf '%s' "$usage" | jq -r '.fiveHour.utilization // empty' 2>/dev/null)
  case "$used" in ''|*[!0-9]*) return 0 ;; esac   # okunamadı → eski davranış

  remaining=$((100-used))
  [ "$remaining" -ge "$need" ] && return 0

  # resumeAtIfStopped panelde sıfırlanma + 1 dk olarak hesaplanır ve geçmişe
  # düşmemesi garanti edilir (usage.mjs resumeAtFrom).
  resume_at=$(printf '%s' "$usage" | jq -r '.resumeAtIfStopped // empty' 2>/dev/null)
  if [ -n "$resume_at" ]; then
    curl -s --max-time 5 -X POST "$PANEL_URL/api/schedules" \
      -H 'content-type: application/json' \
      -d "{\"atISO\":\"$resume_at\",\"note\":\"kota kapısı — $stage\"}" >/dev/null 2>&1
  fi
  log "⏸ Kota kapısı ($stage): kalan %$remaining < gerekli %$need (efor $1, rezerv %$RESERVE_PCT)."
  log "  Döngü temiz duruyor. Otomatik devam: ${resume_at:-YOK — panel kapalı, elle başlat}"
  return 1
}

# =============================================================================
consec_errors=0; iteration=0; consec_task_fails=0
log "▶▶ Döngü başladı. Canlı akış aşağıda; tam kayıt: $LOG_DIR/"

while true; do
  iteration=$((iteration+1))

  pick=$(pick_next)
  if [ -z "${pick:-}" ] || [ "$pick" = "null" ]; then
    consec_errors=$((consec_errors+1))
    log "⚠ Sıradaki task alınamadı (muhtemelen rate-limit/transient). Hata #$consec_errors, ${BACKOFF_SECS}s bekleniyor..."
    [ "$consec_errors" -ge "$MAX_CONSEC_ERRORS" ] && { log "✖ Üst üste $MAX_CONSEC_ERRORS hata. Döngü durdu."; exit 1; }
    sleep "$BACKOFF_SECS"; continue
  fi
  consec_errors=0

  has_task=$(echo "$pick" | jq -r '.has_task // false')
  if [ "$has_task" != "true" ]; then
    log "✅ Hazır task kalmadı. Plan tamam (kalanlar bloke/beklemede olabilir). Döngü bitti."
    break
  fi
  task_id=$(echo "$pick" | jq -r '.task_id // "?"')
  remaining=$(echo "$pick" | jq -r '.remaining // "?"')
  eff_label=$(echo "$pick" | jq -r '.effort // "high"')
  [ "$eff_label" = "max" ] && eff="$EFFORT_MAX" || eff="$EFFORT_HIGH"
  mdl=$(echo "$pick" | jq -r '.model // empty')
  case "$mdl" in sonnet) mdl="$MODEL_SMALL" ;; opus) mdl="$MODEL_BIG" ;; *) mdl="$MODEL_BIG" ;; esac

  # KAPI 1 — görev penceresi açılmadan önce
  quota_gate "$eff" "görev öncesi" "$mdl" || exit 0

  log "──────────────────────────────────────────────────────────────"
  log "▶ Task $task_id  (model=$mdl, effort=$eff, kalan≈$remaining)  — tek sürekli akış başlıyor (build→doğrulama→kapanış)"
  start=$SECONDS
  stream_task "$task_id" "$eff" "$mdl"
  status=$(status_from "$LOG_DIR/task-$task_id.jsonl"); [ -z "$status" ] && status="blocked"

  if [ "$status" != "done" ]; then
    # KAPI 2 — retry penceresi açılmadan önce. Bekçinin yapısal olarak giremediği
    # tek nokta burası: iki deneme arasında "BİTTİ" satırı yok, dolayısıyla
    # nazik durdurma bu araya asla düşemiyor.
    quota_gate "$eff" "retry öncesi" "$mdl" || exit 0

    log "⟳ Task $task_id ilk turda geçemedi ($status). 1 kez yeniden deneniyor (temiz pencere)..."
    stream_task "$task_id" "$eff" "$mdl"
    status=$(status_from "$LOG_DIR/task-$task_id.jsonl"); [ -z "$status" ] && status="blocked"
  fi

  el=$((SECONDS-start))
  if [ "$status" = "done" ]; then
    clear_attempt "$task_id"; consec_task_fails=0
    log "✔ Task $task_id BİTTİ (+commit +push +done) — ${el}s. Sıradakine geçiliyor."
  else
    consec_task_fails=$((consec_task_fails+1))
    # Tur başarısız. Görev büyük olasılıkla 'blocked' bırakıldı; eskiden döngü
    # burada tamamen dururdu ve yeniden başlatıldığında pick_next blocked görev
    # seçmediği için o iş SESSİZCE TERK EDİLİRDİ. Artık tur sayılıyor: hak
    # kaldıysa döngü devam eder ve 1.5 kuralı aynı işi tekrar seçer.
    bump_attempt "$task_id"
    tries=$(attempts_of "$task_id")
    if [ "$tries" -ge "$MAX_TASK_ATTEMPTS" ]; then
      log "✖ Task $task_id $tries tam turda da kontrol kapısını geçemedi (${el}s). ATLANIYOR — elle müdahale gerek."
      log "  İncele:  $LOG_DIR/task-$task_id.err   ve   HANDOFF.md"
      log "  Sayaç sıfırlamak için: $ATTEMPTS_FILE içinden '$task_id' satırını sil."
    else
      log "✖ Task $task_id bu turda geçemedi (${el}s) — tur $tries/$MAX_TASK_ATTEMPTS. Sıradaki turda yeniden denenecek."
    fi
    if [ "$consec_task_fails" -ge "$MAX_CONSEC_TASK_FAILS" ]; then
      log "✖✖ Üst üste $consec_task_fails görev penceresi başarısız. Sorun tek görevde değil — döngü DURDU."
      log "  Ortamı kontrol et (build/test/servisler/branch), sonra panelden yeniden başlat."
      exit 2
    fi
  fi
done
