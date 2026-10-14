# Task ID: 308

**Title:** AI-TRANSPARENCY-HUMAN-BUTTON [OPUS-HIGH] (Opus 5.5) Şeffaflık ve "Temsilciyle görüş" butonu: AI kendini tanıtır (kaldırılamaz), AI konuşurken her zaman görünen buton, mesai dışı açık bilgi

**Status:** pending

**Dependencies:** 303 ⏱, 307 ⏱

**Priority:** medium

**Description:** G16 ve oyuncu güveni; AB Yapay Zekâ Yasası md. 50 (2 Ağustos 2026). Bugün "insanla görüş" butonu yok, "insan istiyorum" yazınca devir yok, AI'ya özel açılış mesajı yok. Kaynak: AI-29.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-29. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3a — AI çekirdeği (çok turlu motor, devir, uyum).

KONTRAT (paths/customer-chat.yaml): POST /customer/chat/request-human (idempotent, {reason?:'button'}); GET /customer/chat yanıtına owner ai|human|queue ve human_available.
API (customer.ts): sohbet AI'da mı doğrulanır, AI-09 devri reason player_request (netleştirme sorusu yok — buton açık talep), hedef AI-12, kiracı mesaisine göre metin, AI susar; oran sınırı (GV-01).
PERSONA: ai_agents.persona.welcome (A-11) + kilitli şeffaflık cümlesi "{asistan_adı}, {marka}'nın yapay zekâ asistanıyım." — kiracı metninde yoksa sistem başa ekler; persona kaydında uyarı.
WIDGET: owner==='ai' iken her zaman görünen buton (insan atanınca/kuyrukta gizlenir; kiracı gizleyemez, metnini değiştirir — AI-29-S1); tıklanınca "Temsilci bağlanıyor…"; klavye/aria; locale anahtarları (8 dil; K25: RU/AZ yok).
MESAİ DIŞI (S2): "Temsilcilerimiz şu an çevrimdışı, {saat} itibarıyla dönüş yapılacak; talebiniz kaydedildi"; kuyrukta kalır ya da WG-08/HD ile ticket.
Kural botu devralmış sohbette de buton görünür (05 risk notu önerisi).
WEB: ProfileForm açılış mesajı (kilitli önizleme), WidgetCustomization metni, Inbox devir nedeni etiketi.
ÖLÇÜM: basma oranı ve AI başlangıcından basmaya süre AI-25'e.

KABUL KRİTERLERİ:
- AI'ın ilk yanıtı şeffaflık cümlesini içerir; kiracı metninden silinse de.
- Sohbet AI'dayken buton görünür, insan atanınca görünmez.
- Butondan sonra AI yazmaz, sohbet doğru ekip kuyruğunda, neden player_request.
- Mesai dışında doğru metin, sohbet kaybolmaz.
- Çift tıklama iki devir oluşturmaz.
- Widget TR/EN metinleri ve ekran okuyucu adlandırması.

KULLANILAN VARSAYIMLAR:
- AI-29-S1/S2 varsayılanları.
- AB AI Yasası yorumu hukuki teyit ister (07 açık risk).

**Test Strategy:**

widget.requestHuman.test.ts, API entegrasyon (devir, mesai dışı, oran sınırı), e2e (oyuncu butona basar → ajan kuyrukta görür); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
