# Task ID: 304

**Title:** AI-HANDOFF-CARD [OPUS-HIGH] (Opus 5.5) Yapılandırılmış devir kartı: konu, oyuncu, toplanan bilgiler, karar dayanağı, AI'ın söyledikleri, nedenler, risk/duygu, önerilen adım; ajan "yeterli/yetersiz" geri bildirimi

**Status:** pending

**Dependencies:** 295 ⏱, 303 ⏱

**Priority:** high

**Description:** Bugünkü özet "Customer asked: <ilk 160 karakter>" (skill-engine.ts:801-809) ve Inbox'ta hiç gösterilmiyor. Faz 1'in asıl değeri ajanın hiçbir şeyi tekrar sormadan işe başlaması. Kaynak: AI-10.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-10. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3a — AI çekirdeği (çok turlu motor, devir, uyum).

PRİSMA: ai_handoffs (id, license_id, chat_id, thread_id, ai_conversation_id, skill_id, procedure_key, procedure_snapshot_hash, intent_label, reason_codes, primary_reason, slots_snapshot, decision_facts, ai_statements, output_check_flags, risk_flags, sentiment, suggested_next_step, attachments, target_group_id, priority, card_text, config_version_id, created_at, accepted_by, accepted_at, feedback sufficient|insufficient|null, feedback_reason, feedback_by, feedback_at) + RLS; indeksler (license_id, created_at), (chat_id). (05'teki daily_thread_id kolonu YOK: K1=A'da chat_id günlük thread.)
KONTRAT: AiHandoffCard; GET /chats/{chatId}/ai-handoffs (bağlantı ve günlük thread); POST /ai-handoffs/{id}/feedback {value, reason?}; ChatDetail.latest_ai_handoff.
RTM: ai_handoff_created {chat_id, thread_id, handoff_id, primary_reason, priority, target_group_id} (hedef grup kitlesi).
KART (LLM'siz, durumdan): konu = prosedür adı; oyuncu kimliği + "oyuncu beyanı, doğrulanmadı" rozeti (üye tokenı geçerliyse "tanınan cihaz"); show_in_card slotlar durum simgeleriyle; karar dayanağı (AI-13 gerçekleri "geçen 95 dk, beklenen ≤30 dk, eşik 60 dk"); AI'ın söyledikleri (son 5 kalıp/bilgi cevabı); çıkış denetimi bayrakları; nedenler; risk bayrakları; duygu; ekler; "Kontrol edilmesi gereken" satırı (AI-28 #321); tek cümlelik prosedür kalıbı özet (prosedürsüzde "Soru: <ilk mesaj>"; LLM özeti varsayılan kapalı).
UYUMLULUK: özet threads.summary'ye de + thread_summary_set; card_text recipients='agents' sistem olayı (arşiv/arama/dışa aktarma).
OYUNCUYA ÖZET (AI-10-S1): yalnız pii≠high ve source=player slotlar tek mesajda "Şu bilgileri ilettim: Papara, 2.500 TL, 13:42. Yanlış bir bilgi varsa yazabilirsiniz."
GERİ BİLDİRİM: tek tık, isteğe bağlı (S2), idempotent; accepted_at ajanın devirden sonraki ilk mesajında (sendEvent kancası).
GÜVENLİK: resolveVisibility; müşteri API'si ve webhook'larda yok; iç not karta girmez.
WEB: features/inbox/AiHandoffCard.tsx (sağ panel en üstte, kısa görünüm + açılır ayrıntı, Kopyala), Transcript'te sabit sistem satırı, arşivde aynı bileşen; ID'ler ID-05 bileşeniyle (#329 gelince).

KABUL KRİTERLERİ:
- Yatırım devrinde kart araştırma §3.1 örnek kartın bütün alanlarını içerir; "Customer asked: …" artık üretilmez.
- Ajan kartı devirden sonra 1 sn içinde görür (RTM).
- Geri bildirim kaydedilir, tekrar tıklama yeni satır üretmez.
- Kart iç not ve pii=high değer içermez; bilgi devirlerinde soru ve "bilgi bulunamadı" nedeni görünür.

KULLANILAN VARSAYIMLAR:
- AI-10-S1: oyuncuya kendi verdiği bilgilerin özeti.
- AI-10-S2: geri bildirim isteğe bağlı.

**Test Strategy:**

Kart kurucu birim; entegrasyon (yatırım devri, bilgi devri); e2e (ajan kartı görür, işaretler); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 304.1. CARD-API [OPUS-HIGH] ai_handoffs + card-builder + uçlar + RTM + accepted_at kancası + oyuncu özeti

**Status:** pending  
**Dependencies:** None  

Üst görev 304 ayrıntılarındaki ilgili bölüm.

### 304.2. CARD-WEB [OPUS-HIGH] AiHandoffCard.tsx + Transcript sistem satırı + geri bildirim

**Status:** pending  
**Dependencies:** 304.1  

Üst görev 304 ayrıntılarındaki ilgili bölüm.
