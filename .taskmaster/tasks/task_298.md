# Task ID: 298

**Title:** AI-KNOWLEDGE-ANSWER [OPUS-HIGH] Bilgi bankasından genel yanıt + "bilmiyorum" davranışı: dayanak kontrollü JSON yazım, sayı uydurma denetimi, sessizlik yasağı

**Status:** pending

**Dependencies:** 297 ⏱

**Priority:** high

**Description:** Bilgi bankası yalnız bir skill adımında çalışıyor; hiçbir skill uymazsa bot susuyor ve iz kalmıyor (skill-engine.ts:295, :581-595). iGaming'de uydurulmuş limit/süre para kaybı ve şikâyet demek; "bilmiyorum" uydurmaktan iyidir (G17). Kaynak: AI-06.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-06. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3a — AI çekirdeği (çok turlu motor, devir, uyum).

knowledge-answer.ts: tetik policy "bilgi yolu" ya da answer_from_knowledge adımı; sorgu = işlenmemiş oyuncu metni + query_hint + son bot sorusu bağlamı; turun ortak embedding'i.
GERÇEK CEVAP ÖNCE: anlama çıktısı tablo varlığı + özellik gösteriyorsa ("Papara" + "min yatırım") AI-13 satırından kalıpla kesin değer (#310 gelince; arayüz burada).
ARAMA: knowledge_chunks AI-14 süzgeçleri (audiences ⊇ ai_agent, marka, published, valid_until) — #309 gelene kadar mevcut ai_agent_id süzgeci; eşik altı → model çağrılmaz, cevap yok yolu.
YAZIM: compose JSON {reply, grounded full|partial|none, cited_ids} (ADR §6a); cited_ids verilen pasajların alt kümesi değilse geçersiz.
DAYANAK: none → cevap yok yolu; partial → cevap + "temsilcimize aktarabilirim" teklifi; full → cevap.
CEVAP YOK: kiracı metni (varsayılan "Bu konuda size kesin bilgi veremiyorum. Sizi bir temsilcimize aktarıyorum.") ya da "aktarayım mı?" — konu grubuna göre (AI-06-S1: para, hesap, bonus, sorumlu oyun → doğrudan devir; diğerleri bir kez sor); devir nedeni no_knowledge; ai.unanswered olayı (AI-22).
SESSİZLİK YASAĞI: mode='ai' iken her tur bot mesajı ya da açık devir — tek yerde test.
TUTARLILIK (G18): sıcaklık 0–0.3; kaynak kimlikleri tur kaydına.
SAYI UYDURMA: birimli sayılar (TL, dk, saat, gün, %, x) pasaj/gerçeklerde yoksa ihlal → AI-08 yeniden yazdırır; tarih/saat biçimleri hariç.
Ayar: ai_handoff_settings.no_answer {policy_by_category, text} (tablo #303 ile ortak; burada alan).

KABUL KRİTERLERİ:
- Eşleşen SSS'li soru → cevap ve karar kaydında kaynak kimliği.
- Eşleşmeyen soru → açık "kesin bilgi veremiyorum" ve ayara göre devir ya da soru; hiçbir durumda sessizlik yok.
- Kaynakta olmayan sayı içeren taslak engellenir, yeniden yazılır.
- B markası sohbeti A'ya özel kaynağı kullanmaz; süresi geçmiş kaynak kullanılmaz (#309 sonrası).
- "Papara ile en az ne kadar yatırabilirim?" → AI-13 satırı birebir (#310 sonrası).

KULLANILAN VARSAYIMLAR:
- AI-06-S1 konu grubuna göre politika.
- RETRIEVAL_THRESHOLD gerçek embedding'de yeniden ölçülür (runbook #283).

**Test Strategy:**

Entegrasyon (eşleşen SSS, eşleşmeyen soru, sayı uydurma, sessizlik yasağı tek test); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
