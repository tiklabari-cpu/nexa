#!/usr/bin/env bash
# Otonom koşucu — her iterasyon TAZE bir Claude oturumu açar.
# Bağlam şişmesi tanım gereği imkânsız: durum yalnız tasks.json + git üzerinden akar,
# her yeni süreç CLAUDE.md kurallarını sıfırdan yükler ve tek görev okur.
#
# Kullanım (Mac uyumasın diye caffeinate ile):
#   caffeinate -i ./.taskmaster/otonom.sh
#
# İzin gerçeği: `claude -p` soru soramaz. Varsayılan --dangerously-skip-permissions —
# adı üstünde: model hangi komutu seçerse sormadan çalışır. Yalnız bu repoda ve
# başında olabileceğin bir makinede kullan. Alternatif: önce /fewer-permission-prompts
# ile allowlist kur, sonra:  IZIN="--permission-mode acceptEdits" ./.taskmaster/otonom.sh
set -uo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

IZIN=${IZIN:---dangerously-skip-permissions}
MAKS=${MAKS:-60}
LOG=.taskmaster/otonom.log

durum() {
  node -e '
    const fs=require("fs");
    if(fs.existsSync(".taskmaster/faz0.kapandi")){console.log("DONE");process.exit(0)}
    const t=JSON.parse(fs.readFileSync(".taskmaster/tasks/tasks.json","utf8")).master.tasks;
    const done=new Set(t.filter(x=>x.status==="done").map(x=>String(x.id)));
    if(t.some(x=>x.status==="in-progress")){console.log("RUN");process.exit(0)}          // yarım iş → sürdür
    if(t.some(x=>x.status==="pending"&&x.dependencies.every(d=>done.has(String(d))))){console.log("RUN");process.exit(0)}
    if(t.length&&t.every(x=>x.status==="done")){console.log("CLOSE");process.exit(0)}    // dilim kapanışı gerek
    console.log("STUCK")' 2>/dev/null
}

onceki=""
for i in $(seq 1 "$MAKS"); do
  D=$(durum)
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] tur $i — durum: ${D:-HATA}" | tee -a "$LOG"
  case "$D" in
    "")    echo "durum okunamadı (tasks.json bozuk?) — dur." | tee -a "$LOG"; break ;;
    DONE)  echo "Faz 0 kapandı — koşu bitti. Rapor: PLAN.md §F.2" | tee -a "$LOG"; break ;;
    STUCK) echo "Uygun iş yok (blocked kalanlar var) — insan kararı gerekli. task-master list" | tee -a "$LOG"; break ;;
    CLOSE) if [ "$onceki" = "CLOSE" ]; then echo "Dilim kapanışı ilerlemedi — dur." | tee -a "$LOG"; break; fi ;;
  esac
  claude -p "CLAUDE.md kurallarıyla çalış. .claude/commands/is.md talimatını oku ve DÖNGÜ MODU kurallarıyla TEK iterasyon uygula: uygun bir görev varsa onu uçtan uca bitir (günlük + commit dahil); tüm görevler done ise .claude/commands/dilim-kapat.md'yi uygula. Bitince dur." \
    $IZIN >>"$LOG" 2>&1 || { echo "claude hata ile çıktı — dur. Ayrıntı: $LOG" | tee -a "$LOG"; break; }
  onceki="$D"
  sleep 5
done
echo "Özet: task-master list · günlükler tasks.json'da · log: $LOG"
