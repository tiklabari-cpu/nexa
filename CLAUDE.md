# CLAUDE.md — Nexa (her Claude Code penceresi bunu otomatik okur)

Bu depo, **Nexa** canlı-destek + AI müşteri hizmetleri platformunun otonom yapımıdır.
Her pencere (interaktif veya `run-loop.sh` ile açılan) aşağıdaki kurallara uyar.

## Her zaman geçerli
- **Kilitli kararlar + akış:** `MASTER-PROMPT.md`. Stack, contract-first sıra, sınırlar oradadır.
- **Definition of Done + git + handoff:** `CONVENTIONS.md`. Bir iş bu kapıdan (exit code'larla)
  geçmeden "bitti" değildir.
- **Şema tek doğruluk kaynağı:** PRD §8.4 + `rapor-2-teknik-mimari.md` §5.3.
  `LiveChat_ER_Diyagram.mermaid` KULLANILMAZ (çelişkili).
- **Tek orkestratör:** implementasyon subagent'a dağıtılmaz; pencere kendi araçlarıyla çalışır.

## Otonom döngüde
- Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → build → verify → fix → close).
- Yalnız hedef task yapılır; done ancak DoD kapısı yeşilse + commit + push + Task Master done.
- Bağlam hafızadan değil, Task Master + git + `HANDOFF.md`'den kurulur.

## Sınırlar
Production deploy / DNS / TLS / gerçek secret / kart / ödeme YOK. force-push, DB drop,
history rewrite, başka repoya dokunma, referans .md/görselleri taşıma YOK. Dış servisler mock'lanır.
