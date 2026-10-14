# Task ID: 371

**Title:** QUEUE-REPORTS [SONNET-HIGH] (Sonnet 5.5) Kuyruk bekleme ve terk rapor ekranları (veri #291'de yakalanıyor): giriş, ortalama/p80 bekleme, atanma oranı, ısı haritası, ekip kırılımı, terk

**Status:** pending

**Dependencies:** 291 ⏱, 305 ⏱, 368 ⏱

**Priority:** medium

**Description:** K21 gereği queue_entries veri yakalama (#291) öne alındı; bu görev rapor uçlarını ve ekranını ekler. Kaynak: RP-04.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: RP-04. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

Önkoşul: #291 queue_entries yazımları (giriş/çıkış, outcome assigned|abandoned|closed_by_agent|transferred|timeout, temizlik adımı), AU-01 (#305) ekip kuyruğu (group_id = queue_group_id).
api: report-csv.ts yardımcıları + GET /reports/queue, GET /reports/queue-abandonment + export (CSV, ADR-09 tek kaynak); RP-01 filtre/kapsam (#368); ısı haritası kiracı TZ.
TERK (05 karar 1): kuyruktayken oyuncu kapatırsa (/customer/chat/close) ya da zaman aşımı → abandoned; widget penceresinin kapanması olay değil.
web: Raporlar › Sohbetler › "Kuyruk" ve "Kuyruk terki" sekmeleri.

KABUL KRİTERLERİ:
- 3 dk kuyrukta bekleyip atanan sohbet 3 dk + "atandı".
- Kuyrukta oyuncu kapatırsa "terk".
- Her ekip için ayrı ortalama.
- JSON ve CSV aynı sayılar.

KULLANILAN VARSAYIMLAR:
- K21: veri yakalama ayrı görevde öne alındı.

**Test Strategy:**

Rapor toplamları entegrasyonu, ekip kırılımı; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
