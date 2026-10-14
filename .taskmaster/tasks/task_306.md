# Task ID: 306

**Title:** INBOX-TRANSFER-TO-TEAM [OPUS-HIGH] Ekibe aktarma: arayüzde "Ekibe aktar" + not; ekipte kimse yoksa reddetmek yerine ekip kuyruğu; AI devri de aynı yol (atanmamış kalma hatası)

**Status:** pending

**Dependencies:** 305 ⏱

**Priority:** high

**Description:** Sunucu ekibe aktarmayı destekliyor ama arayüz yalnız kişi gönderiyor (useInbox.ts:821-824); ekibe aktarılan sohbet atanmamış yapılıyor ama kuyruğa da alınmıyor (chat-service.ts:1388-1417) ve kimse yoksa group_offline ile reddediliyor. AI devri aynı yolu kullandığı için AI-12'den önce yapılmalı (bağımlılık nedeniyle Dalga 5'ten öne alındı). Kaynak: IN-04.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: IN-04. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3a — AI çekirdeği (çok turlu motor, devir, uyum).

KONTRAT: transfer gövdesine note (≤500), yanıta outcome assigned|queued; 409 group_offline dokümandan kalkar; GET /groups yanıtına accepting_count.
API: RoutingService.assignWithinGroup(tx, licenseId, groupId) — mevcut ajan seçimiyle ata, yoksa ekip kuyruğu (queue_group_id, #305) + queue_entries (#291); chat-service.transfer ekip dalı bunu çağırır; not varsa recipients='agents' iç not; kritik (Sorumlu Oyun) ekipte kuyruğa düşerse Yöneticiye bildirim (IN-04-S1); Sorumlu Oyun ve Şikâyet ekiplerine aktarırken not zorunlu (S2). AI devri aynı metodu kullanır.
RTM: chat_transferred; atanan ajana "bana aktarıldı" (IN-10 ile).
WEB: AssigneePicker iki bölüm ("Ekip arkadaşı" / "Ekip", "Finans · 2 çevrimiçi"); başlık menüsü "Aktar…"; transferToGroup(groupId, note?); görünürlük kaybında seçim temizlenir + bilgi mesajı; hata cümleleri.
NOT: AI aktarılan sohbette susar (AI-11).

KABUL KRİTERLERİ:
- Ajan sohbeti Finans'a aktarabilir; çevrimiçi biri varsa ona atanır ve bildirim gider.
- Finans'ta kimse yoksa Finans kuyruğuna girer, ilk müsait Finans ajanına atanır.
- Not iç not olarak görünür, oyuncu görmez.
- Sohbet aktaran ajanın listesinden düşer, hata görülmez.
- AI devrinden sonra sohbet atanmamış kalmaz.

KULLANILAN VARSAYIMLAR:
- IN-04-S1: reddetme yerine kuyruk + uyarı.
- IN-04-S2: not isteğe bağlı; RG ve Şikâyet'te zorunlu.

**Test Strategy:**

Entegrasyon (atama, kuyruk, AI devri), DetailsPanel.transfer.test.tsx, e2e inbox-transfer-team.spec.ts; group_offline bekleyen testler güncellenir; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
