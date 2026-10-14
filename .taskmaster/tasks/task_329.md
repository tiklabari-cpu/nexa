# Task ID: 329

**Title:** ID-DISPLAY-COPY [SONNET-HIGH] Thread ID ve Chat ID'nin her ekranda görünmesi ve tek tıkla kopyalanması (Inbox, transkript ayırıcısı, arşiv, profil, ticket, çalışma kaydı, audit, widget "Destek numaranız", mobil)

**Status:** pending

**Dependencies:** 284 ⏱, 286 ⏱

**Priority:** high

**Description:** Bugün Inbox başlığında yalnız nexa chat numarası geniş ekranda düz metin; kopyala düğmesi numarayı değil bağlantıyı kopyalıyor (ThreadHeader.tsx:133-160); bağlantı numarası hiçbir ekranda yok. Ekip ve operatör numarayla konuşamıyor. Kaynak: ID-05.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: ID-05. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 5 — ajan deneyimi, arama, arşiv.

web: components/CopyId.tsx (tek aralıklı yazı + kopyala + 1,5 sn "Kopyalandı" + aria-label "Thread ID'yi kopyala", karakter karakter okunabilir); ThreadHeader iki numara (dar ekranda taşma menüsünde, gizlenmez); DetailsPanel iki satır; transkript ayırıcısında Chat ID; müşteri profilinde gün → bağlantı; ticket panelinde "Kaynak: Thread T · Chat C"; Playbook çalışma kaydında Chat ID; audit thread_id metadata'sı "Chat ID (bağlantı)" etiketiyle. Kopyalanan değer yalnız 10 karakterlik numara (bağlantı adresi ayrı düğme). Numaralar API'den, istemcide türetilmez.
contract + prisma: tickets.source_thread_id (nullable) + ticket şemasında alan (skill_runs.thread_id #288'de).
widget (ID-05-S1): menüde "Destek numaranız: C…" + kopyala; loader.ts iframe'e allow="clipboard-write"; izin yoksa seçili metin.
mobile (S2): sohbet başlığında iki numara, uzun basınca kopya (pano bağımlılığı yoksa eklenir).
i18n: ids isim alanı (#284), widget 8 dil.

KABUL KRİTERLERİ:
- Inbox'ta Thread ID ve aktif Chat ID ≥1024 px başlıkta, dar ekranda menüde; kopyalanan tam 10 karakter; 1,5 sn geri bildirim.
- Transkriptte her bağlantının başında Chat ID ve saat.
- Widget'taki "Destek numaranız" paneldeki aktif Chat ID ile aynı.
- Sohbetten açılan ticket'ta iki numara.
- Mobil sohbet ekranında iki numara kopyalanabilir.

KULLANILAN VARSAYIMLAR:
- ID-05-S1: oyuncuya yalnız Chat ID.
- S2: mobilde de.

**Test Strategy:**

CopyId birim; e2e inbox-copy-link.spec.ts genişler, widget.spec.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
