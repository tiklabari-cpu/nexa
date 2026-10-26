#!/usr/bin/env bash
# Stop kancası — kapı bitmeden pencere kapanamaz (2026-10-26, CONVENTIONS §1.3).
#
# Ölçülen vaka: tm 311.2 ve 389.3 pencereleri `pnpm test:gate` arka planda koşarken turunu
# bitirdi ve ara sonuç olarak `blocked` döndü; oturum bildirim gelince sürdü ama turlar ve
# yanlış ara sonuç boşa gitti. Bu kanca Claude pencere kapanmak istediğinde çalışır:
#   · scripts/test-gate.mjs çalışırken `.loop-logs/test-gate-<pid>.running` bırakır;
#   · canlı bir işaret varsa kanca kapının bitmesini kendi içinde bekler (en çok
#     GATE_STOP_MAX_WAIT sn, vars. 1500), sonra exit 2 ile pencereyi geri çevirir ve
#     ne yapacağını stderr'e yazar (Claude Code bunu bir sonraki talimat olarak verir);
#   · Claude Code'un kendi arka plan görevi (`background_tasks`) varsa da geri çevirir
#     (işaretsiz, o yüzden en çok 2 kez — unutulmuş bir dev sunucusu turları yemesin);
#   · sigorta: oturum başına en çok GATE_STOP_MAX_BLOCKS (vars. 8) geri çevirme; bayat
#     işaret (90 dk'dan eski ya da PID ölü) silinir; jq yoksa ya da hata olursa exit 0
#     (fail-open — eski davranışa dönülür, hiçbir şey kırılmaz).
# run-loop.sh her pencere açılmadan önce işaretleri ve sayaçları temizler ve pencereye
# SIYAHTUS_LOOP_WINDOW=1 verir; kanca o değişken olmadan hiçbir şey yapmaz.
set -u

# Yalnız döngü pencerelerinde çalışır: run-loop.sh SIYAHTUS_LOOP_WINDOW=1 verir. Sahibin kendi
# etkileşimli oturumu (aynı klasörde, döngü kapı koşarken) bu yüzden bekletilmez.
# Elle denemek için: GATE_STOP_FORCE=1.
[ "${SIYAHTUS_LOOP_WINDOW:-0}" = "1" ] || [ "${GATE_STOP_FORCE:-0}" = "1" ] || exit 0

input=$(cat 2>/dev/null || true)
root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
logdir="$root/.loop-logs"
max_wait="${GATE_STOP_MAX_WAIT:-1500}"
max_blocks="${GATE_STOP_MAX_BLOCKS:-8}"
bg_max_blocks=2
poll=15
stale_sec=5400

command -v jq >/dev/null 2>&1 || exit 0
session=$(printf '%s' "$input" | jq -r '.session_id // "nosession"' 2>/dev/null) || exit 0
bg=$(printf '%s' "$input" | jq -r '(.background_tasks // []) | length' 2>/dev/null) || bg=0
case "$bg" in ''|*[!0-9]*) bg=0 ;; esac

hlog(){ mkdir -p "$logdir" 2>/dev/null; printf '%s [%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$session" "$*" >> "$logdir/gate-stop.log" 2>/dev/null; }

pid_alive(){
  local pid="$1"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  if command -v tasklist >/dev/null 2>&1; then
    MSYS_NO_PATHCONV=1 tasklist /FI "PID eq $pid" /NH 2>/dev/null | grep -qE "[[:space:]]$pid[[:space:]]"
  else
    kill -0 "$pid" 2>/dev/null
  fi
}

# Canlı işaretleri basar; bayat olanları siler.
running_gates(){
  local f pid mtime now age
  now=$(date +%s)
  for f in "$logdir"/test-gate-*.running; do
    [ -e "$f" ] || continue
    pid=${f##*/test-gate-}; pid=${pid%.running}
    mtime=$(stat -c %Y "$f" 2>/dev/null || echo 0)
    age=$(( now - mtime ))
    if [ "$age" -gt "$stale_sec" ] || ! pid_alive "$pid"; then
      hlog "bayat işaret silindi: $(basename "$f") (yaş ${age}s, pid canlı mı: $(pid_alive "$pid" && echo evet || echo hayır))"
      rm -f "$f"
      continue
    fi
    printf '%s\n' "$f"
  done
}

gates=$(running_gates)
[ -z "$gates" ] && [ "$bg" -eq 0 ] && exit 0

countf="$logdir/gate-stop-$session.count"
n=$(cat "$countf" 2>/dev/null || echo 0); case "$n" in ''|*[!0-9]*) n=0 ;; esac
limit="$max_blocks"; [ -z "$gates" ] && limit="$bg_max_blocks"
if [ "$n" -ge "$limit" ]; then
  hlog "sigorta: $n kez geri çevrildi (sınır $limit) — pencere bırakılıyor"
  exit 0
fi
echo $((n+1)) > "$countf" 2>/dev/null

if [ -n "$gates" ]; then
  hlog "kapı sürüyor, bekleniyor (en çok ${max_wait}s): $(echo "$gates" | xargs -n1 basename | tr '\n' ' ')"
  waited=0
  while [ -n "$gates" ] && [ "$waited" -lt "$max_wait" ]; do
    sleep "$poll"; waited=$((waited+poll))
    gates=$(running_gates)
  done
  if [ -z "$gates" ]; then
    hlog "kapı bitti (${waited}s beklendi) — pencere geri çevrildi, sonucu okuması istendi"
    echo "DoD kapısı (pnpm test:gate) az önce bitti; sen sıranı kapı sürerken bitirmeye çalışıyordun. Kapı logunun son satırlarını oku (══ test-gate ══ özet tablosu ve varsa kırmızı dosyalar), sonucu CONVENTIONS §1/§3'e göre işle (yeşilse kapanış adımları, kırmızıysa düzelt ve kapıyı yeniden koş), ancak ondan sonra JSON sonucunu döndür." >&2
  else
    hlog "kapı hâlâ sürüyor (${waited}s beklendi) — pencere geri çevrildi"
    echo "DoD kapısı (pnpm test:gate) hâlâ koşuyor ($((waited/60)) dk'dır bekleniyor). Sıranı bitirme: TaskOutput block=true ile ya da ön planda 'until' döngüsüyle (sleep 30) kapının bitmesini bekle, sonra logun son satırlarını oku ve sonucu işle. Kapı bitmeden JSON sonucu döndürme — döngü bunu blocked sayar." >&2
  fi
  exit 2
fi

hlog "arka plan görevi var ($bg), işaret yok — pencere geri çevrildi ($((n+1))/$bg_max_blocks)"
echo "Claude Code'da hâlâ çalışan $bg arka plan görevi var. Bu bir kapı/test/build ise TaskOutput block=true ile bitmesini bekle ve sonucunu işle; unutulmuş bir sunucu ya da izleyici ise KillShell ile kapat. Sonra sıranı bitir." >&2
exit 2
