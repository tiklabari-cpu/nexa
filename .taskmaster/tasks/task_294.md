# Task ID: 294

**Title:** AI-DAILY-MEMORY [OPUS-HIGH] (Opus 5.5) Gün içi hafıza: aynı gün yeni bağlantıda AI önceki bağlantıların özetini (konu, toplanan bilgiler, sonuç) görür; kimlik güvenine göre filtre (K4, K5)

**Status:** pending

**Dependencies:** 287 ⏱, 292 ⏱

**Priority:** high

**Description:** Oyuncu sabah "Papara 2.500 TL yatırdım gelmedi" deyip öğlen dönünce AI ona aynı 6 soruyu yeniden soruyor. Aynı gün aynı sorunla dönüş "çözülmemiş sorun" sinyali. K5: AI önceki konuşmayı yalnız konu düzeyinde anar; tutar/IBAN/işlem no'yu kendiliğinden tekrar etmez. Kaynak: AI-02.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-02. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3a — AI çekirdeği (çok turlu motor, devir, uyum).

EFOR: high — karar önceden verilmiş, kalıp depoda var; xhigh gerekçesi yeterli değil (2026-10-14 gözden geçirme).
K1=A: günlük thread = nexa chat; loadDailyDigests(chatId, excludeThreadId) aynı chat'in önceki thread'lerinin ai_conversations.digest'lerini okur (ID-02 listDayConnections kancası). Ayrı daily_thread_id YOK.
DİGEST (LLM'siz): {connection, started_at, ended_at, procedure_key/name, intent_label, slots {display,status}, outcome resolved|resolved_waiting|handed_off|abandoned|no_ai, handoff {id, team_id, reason_codes, agent_replied}|null, risk_flags, last_ai_excerpt ≤200}. Her AI turunda güncellenir; kapanışta (deactivate :841, deactivateByTimeout :890) outcome kesinleşir; aktif collect varken kapanış → abandoned.
YÜKLEME: yeni bağlantının ilk turunda o günün en yeni 3 özeti system prompt'a "Bugünkü önceki konuşmalar (oyuncu beyanı, doğrulanmadı)".
KİMLİK GÜVENİ (K4 sonrası): session/verified = geçerli üye tokenı (#287) → ayrıntı ve slot önden doldurma (status carried) serbest; claimed = yalnız kullanıcı adı beyanı → slot değerleri prompt'tan kodda çıkarılır, AI yalnız "Bugün daha önce de bize yazmış mıydınız?" der. Ajan onaylı bağlanmış müşterinin geçmişi AI'a VERİLMEZ (K4). Filtre prompt kurulmadan önce kodda.
K5: kimlik geçerli olsa da AI tutar/IBAN/TXID'yi kendiliğinden tekrar etmez, konu düzeyinde anar; ayrıntıyı oyuncu söylerse teyit eder (compose talimatı + AI-08 çıkış denetimi kancası).
HATIRLATMA MODU: auto_if_unresolved (varsayılan, AI-02-S1) / on_topic_only; relates_to_previous anlama çıktısından (#297).
TEKRAR TEMAS: aynı procedure_key + önceki handed_off/resolved_waiting → signals.repeat_same_day (AI-09/AI-12 kullanır).
Ayar: AiAgent.daily_memory {enabled, recall}; ajan ekranı verisi GET /chats/{chatId}/ai-digests (gösterim IN-02 #331).
Önceki günler AI'a verilmez (AI-02-S3).

KABUL KRİTERLERİ:
- Bağlantı 1: Papara 2.500 TRY, finansa devir, kapandı; aynı gün bağlantı 2 "hâlâ gelmedi" → AI ilk cevabında önceki konuya değinir, toplanmış slotları yeniden sormaz (geçerli token); kartta "aynı gün 2. temas".
- Ertesi gün özet yüklenmez.
- claimed güveninde model isteği ve cevap önceki tutar/yöntemi içermez.
- Zaman aşımıyla kapanan bağlantı abandoned + slotlar özette.
- Başka kiracının özetleri yüklenmez.

KULLANILAN VARSAYIMLAR:
- K4, K5.
- AI-02-S1/S2/S3.

**Test Strategy:**

Entegrasyon (aynı gün iki bağlantı, ertesi gün, claimed filtresi), birim (buildDigest, güven filtresi); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
