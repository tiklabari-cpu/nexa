#!/usr/bin/env bash
# Kod haritasını (codebase-memory-mcp) tazeler ve sonucu .loop-logs/cbm-state.json'a yazar.
# run-loop.sh her görevin commit + push'undan sonra ve döngü başında çağırır; elle de çalışır.
#
# HİÇBİR durumda döngüyü durdurmaz: her yol exit 0 ile biter. Başarısızlık yalnız durum
# dosyasında (ok:false) ve log satırında görünür; pencere o zaman haritayı kapalı sayar ve
# grep/Read ile çalışır (TASK-RUNNER-PROMPT §0.7). Gerekçe: .loop-logs/PLAN-2026-10-16-*.md §1.2.
#
# Ortam: CBM_BIN (program yolu), CBM_TRIES (3), CBM_WAIT_SECS (20), CBM_TIMEOUT_SECS (300).
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="$ROOT/.loop-logs"; mkdir -p "$LOG_DIR"
STATE="$LOG_DIR/cbm-state.json"
LAD="$(cygpath -m "${LOCALAPPDATA:-$HOME/AppData/Local}" 2>/dev/null || echo "${LOCALAPPDATA:-}")"
CBM_BIN="${CBM_BIN:-$LAD/nexa-tools/cbm/bin/codebase-memory-mcp.exe}"
TRIES="${CBM_TRIES:-3}"
WAIT="${CBM_WAIT_SECS:-20}"
TMO="${CBM_TIMEOUT_SECS:-300}"
REPO="$(cygpath -m "$ROOT" 2>/dev/null || echo "$ROOT")"
HEAD_SHA="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"

say(){ echo "[$(date -u +%H:%M:%S)] [harita] $*"; }

# Önceki başarılı indeksin commit'i (ok:false yazarken korunur — pencere ne kadar eski olduğunu görsün).
prev_head="$(jq -r 'if .ok then .head else (.head_indexed // empty) end' "$STATE" 2>/dev/null || true)"

write_fail(){
  jq -n --arg head "$HEAD_SHA" --arg prev "${prev_head:-}" --arg reason "$1" \
        --arg at "$(date -u +%FT%TZ)" \
        '{ok:false, head:$head, head_indexed:($prev|select(.!="")), reason:$reason, at:$at}' \
        > "$STATE.tmp" && mv -f "$STATE.tmp" "$STATE"
  say "⚠ yenilenemedi ($1) — pencereler haritayı KAPALI sayacak (grep/Read). Döngü sürüyor."
  exit 0
}

[ -f "$CBM_BIN" ] || write_fail "program_yok:$CBM_BIN"

OUT_FILE="$LOG_DIR/cbm-refresh.out"
reset_done=0
last="bilinmiyor"
for i in $(seq 1 "$TRIES"); do
  timeout "$TMO" "$CBM_BIN" cli --quiet index_repository --repo-path "$REPO" \
    --mode full --doc-candidates true > "$OUT_FILE" 2>&1
  rc=$?
  out="$(tail -c 6000 "$OUT_FILE")"
  status="$(printf '%s' "$out" | grep -o '"status":"[a-z_]*"' | tail -1 | cut -d'"' -f4)"
  if [ "$status" = "indexed" ]; then
    nodes="$(printf '%s' "$out" | grep -o '"nodes":[0-9]*' | tail -1 | cut -d: -f2)"
    edges="$(printf '%s' "$out" | grep -o '"edges":[0-9]*' | tail -1 | cut -d: -f2)"
    jq -n --arg head "$HEAD_SHA" --arg at "$(date -u +%FT%TZ)" \
          --argjson nodes "${nodes:-0}" --argjson edges "${edges:-0}" --argjson tries "$i" \
          '{ok:true, head:$head, at:$at, nodes:$nodes, edges:$edges, tries:$tries}' \
          > "$STATE.tmp" && mv -f "$STATE.tmp" "$STATE"
    say "✔ ${HEAD_SHA:0:8} indekslendi (${nodes:-?} düğüm, ${edges:-?} kenar, deneme $i)."
    exit 0
  fi
  if [ "$rc" = "124" ]; then last="zaman_asimi_${TMO}s"
  elif [ -n "$status" ]; then last="$status"
  else last="cikti_yok_rc$rc"
  fi
  # Bozuk/kayıp proje: bir kez sil ve sıfırdan kur.
  if [ "$reset_done" = 0 ] && printf '%s' "$out" | grep -qiE 'project not found|not indexed|corrupt|malformed'; then
    reset_done=1
    say "proje kaydı bozuk/yok — bir kez silinip yeniden kuruluyor."
    timeout 60 "$CBM_BIN" cli --quiet delete_project --project "$(printf '%s' "$REPO" | sed 's#[:/]#-#g; s#--*#-#g')" >/dev/null 2>&1 || true
  fi
  say "deneme $i/$TRIES başarısız ($last)."
  [ "$i" -lt "$TRIES" ] && sleep "$WAIT"
done
write_fail "$last"
