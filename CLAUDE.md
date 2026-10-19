# CLAUDE.md — SiyahTuş (her Claude Code penceresi bunu otomatik okur)

Bu depo, **SiyahTuş** canlı-destek + AI müşteri hizmetleri platformunun otonom yapımıdır.
Her pencere (interaktif veya `run-loop.sh` ile açılan) aşağıdaki kurallara uyar.

## Her zaman geçerli

- **Kilitli kararlar + akış:** `MASTER-PROMPT.md`. Stack, contract-first sıra, sınırlar oradadır.
- **Definition of Done + git + handoff:** `CONVENTIONS.md`. Bir iş bu kapıdan (exit code'larla)
  geçmeden "bitti" değildir.
- **Şema tek doğruluk kaynağı:** PRD §8.4 + `rapor-2-teknik-mimari.md` §5.3.
  `LiveChat_ER_Diyagram.mermaid` KULLANILMAZ (çelişkili).
- **Tek orkestratör:** implementasyon subagent'a dağıtılmaz; pencere kendi araçlarıyla çalışır.
- **Kod okuma:** bir dosyada bul + bloğunu oku, tek çağrıda:
  `node scripts/loop/block.mjs <dosya> <re:desen|ad|satır>`; ayrıntı `TASK-RUNNER-PROMPT.md` §0.7.

## Otonom döngüde

- Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → build → verify → fix → close).
- Yalnız hedef task yapılır; done ancak DoD kapısı yeşilse + commit + push + Task Master done.
- Bağlam hafızadan değil, Task Master + git + `HANDOFF.md`'den kurulur.
- Canlı `HANDOFF.md` / `PLAN.md` §K yalnız son görevlerin ayrıntısını tutar. Eski kayıt/kanıt
  gerekiyorsa `docs/archive/` altında grep ile ara; arşivi baştan okuma (CONVENTIONS §1.2, §3).
- **Uzun komutlar (kapı, tam test koşusu, build) pencerenin 10 dk komut tavanını aşabilir.**
  `pnpm test:gate` ve benzeri uzun komutları `run_in_background` ile başlat; log yolunu ilk
  satırdan al, bitince son satırlarını (`Tasks:`, `Failed:`, `exit`) oku. Ön planda koşturma.

## Sınırlar

Production deploy / DNS / TLS / gerçek secret / kart / ödeme YOK. force-push, DB drop,
history rewrite, başka repoya dokunma, referans .md/görselleri taşıma YOK. Dış servisler mock'lanır.
