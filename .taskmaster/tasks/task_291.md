# Task ID: 291

**Title:** QUEUE-ENTRIES-CAPTURE [OPUS-HIGH] (Opus 5.5) Kuyruk giriş/çıkış kayıtlarını şimdiden yaz (queue_entries) — geçmiş bekleme süresi kaybolmasın (K21; rapor ekranı #371)

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** threads.queued_at atamada (routing-service.ts:219) ve kapanışta (chat-service.ts:967) null yapılıyor; geçmiş bekleme süreleri kayboluyor ve sonradan hesaplanamıyor. 05: "tablo ve yazımlar erken gelmeli". K21: öne alındı. Kaynak: RP-04.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: RP-04. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 2 — kimlik çekirdeği ve altyapı.

YAPILACAK: migration queue_entries (license_id, thread_id, group_id nullable, entered_at, left_at, outcome CHECK assigned|abandoned|closed_by_agent|transferred|timeout) + RLS + indeks (license_id, entered_at). Kuyruğa girilen her yer (route() queued; ileride WG-03 yeniden kuyruklama, AU-01 ekip kuyruğu) satır açar; çıkılan her yer (drainQueue, takeover/claim, kapanış, transfer) aynı işlemde kapatır. Sweep'e "kapalı oturuma ait açık satırı kapat" güvenlik ağı. Mevcut queued_at silme davranışı DEĞİŞMEZ (sıra numaralandırması ona dayanıyor).
TERK (RP-04-S1): kuyruktayken oyuncu kapatırsa (/customer/chat/close) ya da zaman aşımıyla kapanırsa abandoned; widget penceresinin kapanması olay değildir.
group_id: AU-01 (#305) gelene kadar sohbetin ilk erişim grubu; AU-01 queue_group_id'yi yazar.
KAPSAM DIŞI: rapor uçları ve ekran (#371), WG-05 tahmini (#344).

KABUL KRİTERLERİ:
- 3 dk kuyrukta bekleyip atanan sohbet için entered/left 3 dk farkla ve outcome assigned.
- Kuyrukta oyuncu kapatırsa abandoned.
- Kapanmış oturumda açık satır kalmaz.

KULLANILAN VARSAYIMLAR:
- K21.
- RP-04-S1 terk tanımı.
- Öncelik devri: P1 ama high AU-01 (#305) buna bağlı → high.

**Test Strategy:**

Entegrasyon (giriş/çıkış eşleşmesi, terk, sweep güvenlik ağı, RLS); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
