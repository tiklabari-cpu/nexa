# AUTORUN — Nexa Otonom Döngü Kurulumu ve Çalıştırma

Bu sistem, planını (PRD → Task Master görev ağacı) otomatik takip eder ve her task'ı **temiz
bir Claude Code penceresinde** yaptırır. Bağlam Claude'nin kafasında değil, Task Master + git +
`HANDOFF.md`'de tutulduğu için pencereler arası kopmaz.

## Parçalar

- `run-loop.sh` — döngü sürücüsü. Her tur: sıradaki task'ı seçer → temiz pencerede yaptırır →
  hata varsa 1 kez yeniden dener → yine olmazsa durur.
- `TASK-RUNNER-PROMPT.md` — her pencerenin aldığı protokol (bootstrap → build → verify → fix → close).
- `CONVENTIONS.md` — objektif Definition of Done kapısı + git + handoff formatı.
- `MASTER-PROMPT.md` — kilitli teknik kararlar (pencereler bunu okur).
- `CLAUDE.md` — her `claude` penceresinin OTOMATİK okuduğu özet kurallar (kalıcı bağlam çıpası).
- `.gitignore` — secret/env/çıktı/log dışlama (ilk commit'te hazır).
- Task Master — görev ağacı + durum (`.taskmaster/`).

## Çalıştırma — tek komut

`run-loop.sh` **ilk çalıştırmada kendini kurar**: `.taskmaster` yoksa önce git + `parse-prd` +
efor etiketleri + PLAN/HANDOFF'u yapar, sonra döngüye girer. Yani normalde tek komut yeter:

```bash
chmod +x run-loop.sh
./run-loop.sh                                   # ilk kurulum + döngü
# arka planda:  nohup ./run-loop.sh > .loop-logs/run.out 2>&1 &
```

Ön koşul: Claude Code + Task Master kurulu ve Claude Code'a giriş yapılmış (Max aboneliği), git
remote erişimin (repo-scope PAT) hazır.

## İşi nerede/nasıl izlersin (5 pencere)

1. **Terminal (canlı):** runner artık her pencereyi `stream-json` ile canlı akıtır — açılan araç
   çağrıları (`→ Edit`, `→ Bash`...) ve metin satır satır görünür. Arka planda çalıştırdıysan:
   `tail -f .loop-logs/run.out`.
2. **Tam kayıt (pencere başına):** `.loop-logs/task-<id>.jsonl` (ham olay akışı) ve
   `.loop-logs/task-<id>.err` (hata). Sonradan replay:
   `jq -r 'select(.type=="assistant").message.content[]?|.text//("→ "+.name)' .loop-logs/task-<id>.jsonl`
3. **git history:** her task = commit(ler). Ne değiştiğini birebir görürsün: `git log --oneline`,
   `git show <sha>`.
4. **HANDOFF.md:** her task kapanışında insan-okur özet (ne yapıldı / doğrulama / kalan).
5. **Task Master panosu:** `task-master list` — hangi task done/in-progress/blocked.

Script'in kendi satırları (`▶ Task ... başlıyor`, `✔ ... BİTTİ`, `✖ ... DURDU`) turların
sınırını gösterir; aradaki akış o task'ın gerçek çalışmasıdır.

## Tek seferlik kurulum (opsiyonel — script bunu otomatik yapar; elle yapmak istersen)

```bash
# 1) Claude Code + Task Master kurulu olsun; Claude Code'a giriş yapılmış olsun (Max aboneliği)
claude mcp add taskmaster-ai -- npx -y task-master-ai   # Task Master MCP'yi projeye ekle

# 2) Proje kökünde (nexa reposu) git hazır olsun
git init && git branch -M main
git remote add origin git@github.com:tiklabari-cpu/nexa.git

# 3) PRD'yi görev ağacına çevir (planı Task Master'a yükle)
npx task-master-ai parse-prd urun-gereksinim-dokumani-PRD.md
#   → sonra görevlerin başlığına/detayına [MAX] / [XHIGH] etiketini işle
#     (MASTER-PROMPT'taki "Efor Kapıları" listesine göre).

# 4) Script'i çalıştırılabilir yap
chmod +x run-loop.sh
```

## Çalıştırma

```bash
./run-loop.sh            # döngüyü başlat (arka planda: nohup ./run-loop.sh & )
tail -f .loop-logs/*.err # canlı log izleme
```

Durdurmak için: `Ctrl-C` (veya arka plandaysa `kill <pid>`). Kaldığı yerden devam: tekrar
`./run-loop.sh` — durum Task Master'da olduğu için baştan başlamaz.

## İLK ÇALIŞTIRMADA MUTLAKA

Unattended bırakmadan önce **ilk 1-2 task'ı izleyerek** çalıştır:

- `claude --help` ile `--effort` değer adlarını ve `--permission-mode` seçeneklerini teyit et;
  farklıysa `run-loop.sh` başındaki değişkenleri düzelt. (`--effort max` bazı opus sürümlerinde
  yok — o zaman `EFFORT_MAX="high"` yap.)
- İlk pencerenin gerçekten commit + push yaptığını ve Task Master'da done işaretlediğini gör.
- `git remote`'un **nexa** olduğunu doğrula (yanlış repoya push riskini böyle keser).

## Güvenlik (tam otonom — bypassPermissions)

Çalışma modu `--permission-mode bypassPermissions`: pencereler hiç izin sormaz (en yüksek
otonomi, "duruyor" sorunu tümden biter). Bu güvenli, çünkü güvenlik izin-prompt'unda değil,
şu 4 katmanda:

1. **Claude Code araç-allowlist'in** — sen zaten yalnız ihtiyaç duyulan araçları açtın; pencere
   başka bir şey çağıramaz.
2. **Repo-scope'lu fine-grained PAT** — yalnız `nexa` reposuna yazma yetkisi. Diğer projelerine
   teknik olarak dokunamaz (en sağlam garanti — bunu mutlaka kullan).
3. **Proje dizininde çalışma** — runner'ı `nexa` kökünde başlat; dosya işlemleri burada.
4. **CONVENTIONS kuralları** — force-push yok, DB drop yok, başka repoya dokunma yok, secret
   commit yok.

> Daha korumalı istersen `run-loop.sh` içinde `PERM="auto"` yap: Anthropic'in sınıflandırıcılı
> otonom modu (dizin-scoped + yıkıcı/exfil bloklu). İkisi de "full otonom"; `auto` bir ağ daha ekler.

## Sınırlar (dürüst)

- Gerçekten 7/24 durmaz: kullanım limiti gelince runner bekleyip yeniden dener (backoff), ama
  pencere sıfırlanana kadar ilerleme durur. Bu, abonelik planına bağlı.
- Runner'ı senin makinende çalıştırırsın (bu Cowork bulut ortamında değil). Test edemediğim tek
  yer bu; o yüzden ilk turu izle.
