# Task ID: 295

**Title:** AI-SLOTS [OPUS-HIGH] (Opus 5.5) Bilgi toplama (slot) sistemi: tipler, Türkçe normalizasyon, doğrulayıcılar, izlenebilirlik kalkanı, hassas slot yasağı

**Status:** pending

**Dependencies:** 270 ⏱, 292 ⏱

**Priority:** high

**Description:** "Bilgi iste" adımı yalnız soruyu gönderiyor, cevabı okumuyor/saklamıyor (skill-engine.ts:443-459, :791-799). AI aynı soruyu tekrar sorar ya da eksik bilgiyle devreder. Devir kalitesinin ölçülebilir değeri burada. Kaynak: AI-04.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-04. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3a — AI çekirdeği (çok turlu motor, devir, uyum).

TİPLER (packages/types/src/slots.ts, web+API ortak): SlotDef {name, label, type, required always|never|{when:Cond}, ask, ask_variants?, validate {min,max,enum_source,regex,network_aware}, pii none|low|high, show_in_card, card_label?, max_attempts 2, confirm never|if_inferred|always}. Tipler: text, enum, number, money, datetime, date, duration, boolean, username, email, phone, txid, crypto_network, iban_last4, reference_code, file, url.
YASAK (G11, kaydetmede 400 slot_sensitive_forbidden): şifre/parola, OTP/SMS/doğrulama kodu, tam kart, CVV/CVC, seed/özel anahtar, internet bankacılığı, tam IBAN (yalnız iban_last4). TR+EN regex tek kaynak.
ÇIKARIM: anlama çağrısı (#297) extracted [{slot, raw_text, value, confidence}]; izlenebilirlik kalkanı: raw_text işlenen mesajlarda geçmiyorsa değer atılır. TR normalizasyon: "2,5 bin", "2.500", "2500tl", "₺2.500,00" → 2500.00 TRY; "13:40" → bugün (kiracı TZ, ID-04); "dün akşam"/"az önce" → partial; gelecek/30 günden eski → invalid; evet/hayır/var/yok/olmadı → boolean. Doğrulama: TRC20 64 hex, ERC20/BEP20 0x+64 hex, adres önekleri; tablo kaynaklı enum AI-13 satırlarına bulanık eşleşme (#310 gelene kadar facts arayüzü stub); min/max dışı → out_of_range işareti (ret değil).
DURUMLAR: missing|filled|partial|invalid|refused|unknown|carried; max_attempts aşılınca refused; filled/carried sorulmaz; correction:true üstüne yazar, previous_values.
SORU: mesaj başına en fazla max_questions_per_message (AI-07, varsayılan 2).
EKLER: file slotu aynı bağlantıdaki oyuncu ekiyle dolar; AI "Dekontunuz alındı" der, yorumlamaz (G12); KYC belgesi sohbetten alınmaz (AI-04-S1).
SAKLAMA: ai_conversations.slots; pii=high değerler karar kaydına/loga yazılmaz. Webhook/otomasyona gitmez.
Kontrat: SlotDef şeması + problem kodları. Web: SkillEditor slot tablosu (#296 ile), DetailsPanel "AI'ın topladıkları" (GET /chats/{chatId}/ai-conversation, #296).

KABUL KRİTERLERİ:
- "dün akşam papara ile 2,5 bin attım" → yontem=papara filled, tutar=2500 TRY filled, islem_zamani partial; sonraki soru yalnız saati sorar.
- "şifre" adlı ya da "SMS kodunuzu yazın" sorulu slot 400 slot_sensitive_forbidden.
- Mesajda olmayan raw_text değeri kaydedilmez (mock).
- TXID ağa göre doğrulanır; geçersizde bir kez açıklayarak yeniden sorar.
- Düzeltme üstüne yazar; 2 reddetmede refused ve kartta "verilmedi".
- 40+ Türkçe ifadeli normalizasyon birim testleri.

KULLANILAN VARSAYIMLAR:
- AI-04-S1: dekont kabul, yorum yok, KYC sohbetten alınmaz.
- AI-04-S2: en fazla 2 kez sorulur, sonra verilmedi + devir.
- Saat dilimi #285 (yoksa Europe/Istanbul).

**Test Strategy:**

Birim (≥40 TR örnek), entegrasyon (çok slotlu tek mesaj, düzeltme, ret); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 295.1. SLOT-TYPES [OPUS-HIGH] packages/types slots.ts: tipler, yasaklı ad/etiket listesi, ortak doğrulayıcılar, problem kodları

**Status:** pending  
**Dependencies:** None  

Üst görev 295 ayrıntılarındaki ilgili bölüm.

### 295.2. SLOT-NORMALIZE-TR [OPUS-HIGH] normalize-tr.ts + validators.ts (tutar, tarih/saat, evet/hayır, TXID/ağ, IBAN son 4) + ≥40 örnek

**Status:** pending  
**Dependencies:** 295.1  

Saat dilimi localDayKey/tz ile.

### 295.3. SLOT-EXTRACT [OPUS-HIGH] extract.ts: anlama çıktısını doğrula, izlenebilirlik kalkanı, durumlar, deneme sayacı, düzeltme

**Status:** pending  
**Dependencies:** 295.2  

Anlama çağrısı #297; o gelene kadar mock çıktısıyla test.
