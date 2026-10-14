# Task ID: 293

**Title:** AI-FIRST-AND-SILENCE [OPUS-MAX] (Opus 5.5) "Önce AI" (K9) ve devirden sonra AI'ın susması: mod durum makinesi, örtük devralma, AI'a geri ver, bekçi, ADR-09a yüklemi

**Status:** pending

**Dependencies:** 271 ⏱, 272 ⏱, 292 ⏱

**Priority:** high

**Description:** Bugün sohbet açılır açılmaz ajana atanıyor (chat-service.ts:394-412) ve AI her mesajda çalışıyor (customer.ts:380-389) — AI ve insan aynı oyuncuya paralel konuşuyor; takeover (chat-service.ts:1632) AI'ı susturmuyor; devredilip ajan yazmadan kapanan sohbetler "AI çözümü" diye faturalanıyor. K9: "Önce AI" — AI konuşurken atama yok, atama devir anında; ajan araya yazarsa devralmış sayılır. K10: devredilen sohbet AI çözümü sayılmaz. Kaynak: AI-11.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-11. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3a — AI çekirdeği (çok turlu motor, devir, uyum).

[MAX] yönlendirme zamanlaması + eşzamanlılık. ADR-08a (#271), ADR-09a (#272).
DURUM MAKİNESİ (bağlantı başına): ai → (AI devri | ajan mesajı | takeover | AI kapalı/tavan) → human; human → (yetkili "AI'a geri ver", bayrak engeli yok) → ai; ai → (gözetmen "duraklat") → paused.
KAPI: AiResponder.handle en başta modu okur (threads.ai_mode); ai değilse model çağrısı yok. Kural botu sırası korunur; kural botu devralırsa mode=human.
ÖNCE AI BAŞLANGICI: AI ajanı etkinken chat-service.start thread'i atamasız, kuyruk dışı (queue_position=null), ai_mode='ai' açar; "atanmamış"/"kuyrukta" görünümlerine girmez, ai görünümüne girer; eşzamanlı sınır tüketilmez; yönlendirme devir anında (AI-12). "Paralel" mod kiracı ayarı (ai_handoff_settings.assignment_mode 'ai_first'|'parallel').
ÖRTÜK DEVRALMA: ai thread'ine ajan recipients='all' yazarsa aynı transaction'da mode=human, ai_conversations.version++; yürüyen AI turu iyimser kilitle yazamaz.
BEKÇİ: oyuncu mesajından sonra ai_stall_timeout_seconds (60) içinde bot olayı/devir yoksa zamanlanmış iş ai_failure ile insana yönlendirir (jobs.ts).
AI'A GERİ VER: POST /chats/{chatId}/return-to-ai {note?, resume:'continue'|'fresh'}; isteğe bağlı POST /pause-ai. Yetki varsayılanı: sohbetin sahibi ajan + EL/Y/K (AI-11-S3; RL-02 gelene kadar admin+ ve kendi sohbeti). Sorumlu oyun/kendine zarar/reşit olmayan bayrağı varsa 409 ai_return_blocked (bayrak kontrolü AI-27 #302 ile etkinleşir; arayüz burada). Önce-AI'da geri verilen thread atamadan çıkar, geri veren ajan otomatik gözetmen (chat_supervisions).
ADR-09a: yüklem "kapanışta ajan olayı yok VE ai_handoffs/devir olayı yok" tek yardımcıda; faturalama sayacı, ai_solved görünümü (chat-service.ts:2389-2417), Reports "Automated" aynı anda geçer.
Prisma: threads.ai_mode text null + indeks (license_id, active, ai_mode); ai_handoff_settings.assignment_mode, ai_stall_timeout_seconds (tablo AI-09'da; burada minimal açılır, AI-09 genişletir).
RTM: chat_ai_mode_changed {chat_id, thread_id, ai_mode, by, reason} (ADR-15 zarfı, types/rtm.ts listesi). Her mod değişikliği ID-08 olayı + agents-only sistem olayı.
Web: ThreadHeader rozeti ("AI görüşüyor"/"İnsanda"/"AI duraklatıldı"), Devral (takeover ile birleşik), AI'a geri ver.
NOT: kuyruk süresi raporları önce-AI modunda devir anından başlar (RP-02/04).

KABUL KRİTERLERİ:
- Devirden sonra oyuncunun her mesajı sıfır model çağrısı ve sıfır bot mesajı (mock sayaç).
- AI turu sürerken ajan yazarsa mode=human ve AI taslağı gönderilmez (yarış testi).
- Başkasının sohbetini Ekip Üyesi geri veremez (403); bayraklı sohbet geri verilemez (409, #302 sonrası).
- Önce-AI modunda sohbet devre kadar atanmaz; bekçi takılan sohbeti süresinde insana yönlendirir.
- Mod değişikliği RTM ile rozeti anında günceller.
- Devredilmiş thread'ler ai_solved'da ve faturalama sayacında yok; ADR-09 regresyon testi (devirsiz sayılar aynı).

KULLANILAN VARSAYIMLAR:
- K9, K10.
- AI-11-S2: ajan mesajı = devralma.
- AI-11-S3 yetki varsayılanı.

**Test Strategy:**

Entegrasyon (sıfır model çağrısı, örtük devralma yarışı, yetkisiz geri verme, bekçi, ADR-09a sayaçları), e2e (ajan devralır, geri verir); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 293.1. MODE-GATE [OPUS-MAX] threads.ai_mode + mod durum makinesi + AiResponder kapısı + örtük devralma (aynı transaction)

**Status:** pending  
**Dependencies:** None  

Takeover ve kural botu devralma da human yapar.

### 293.2. AI-FIRST-START [OPUS-MAX] Önce-AI başlangıcı (atamasız, kuyruk dışı) + assignment_mode ayarı + bekçi işi

**Status:** pending  
**Dependencies:** 293.1  

Yönlendirme devir anına taşınır (AI-12 hedefi gelene kadar mevcut route()).

### 293.3. RETURN-PAUSE [OPUS-XHIGH] POST return-to-ai / pause-ai + yetki + bayrak engeli kancası

**Status:** pending  
**Dependencies:** 293.1  

XHIGH GEREKÇESİ: (1) yeni yetkili endpoint.

### 293.4. ADR09A-PREDICATE [OPUS-XHIGH] ADR-09a yüklemi tek yardımcıda: faturalama sayacı, ai_solved, Reports Automated

**Status:** pending  
**Dependencies:** 293.1  

XHIGH GEREKÇESİ: (2) para doğruluğu — faturaya giden ölçüm.

### 293.5. MODE-RTM-WEB [OPUS-HIGH] RTM chat_ai_mode_changed + Inbox rozet/butonlar + useInbox mutasyonları

**Status:** pending  
**Dependencies:** 293.2, 293.3  

Üst görev 293 ayrıntılarındaki ilgili bölüm.
