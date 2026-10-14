# Task ID: 270

**Title:** ADR-LLM-JSON [OPUS-HIGH] (Opus 5.5) Pilot LLM ADR §6a ek notu: yapılandırılmış JSON çıktı EVET, araç çağırma HAYIR (K17)

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** docs/adr/pilot-llm-embedding-provider.md §6 "tools, tool_choice, response_format gönderilmez" diyor. Konu tespiti (AI-05), slot çıkarımı (AI-04), dayanaklı yanıt (AI-06), çelişki denetimi (AI-07), hakem (AI-08), küme başlığı (AI-22), öneri taslağı (AI-23), QA ön puanı (AI-24) JSON şema çıktısı ister. Sahip kararı K17: ek yazılsın. Kaynak: AI-16, AI-04, AI-05, AI-06, AI-07, AI-08, AI-22, AI-23, AI-24.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-16, AI-04, AI-05, AI-06, AI-07, AI-08, AI-22, AI-23, AI-24. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 0 — ADR ek notları (kilitli kararlarla çelişen işler için önce yazılır).

NE YAZILACAK (docs/adr/pilot-llm-embedding-provider.md, §6'nın altına "§6a — 2026-10 eki"):
- `response_format: { type: 'json_schema' }` yalnız sınıflandırma/anlama, yazım (grounded/cited), hakem, küme başlığı, öneri taslağı ve QA ön puanı çağrılarında gönderilir. `tools` / `tool_choice` F1'de yine gönderilmez.
- Kararlar (devir, etiket, soru, prosedür adımı) deterministik kodda (`policy.ts`) kalır; model yalnız aday değer üretir; değerler izlenebilirlik kalkanından geçer (AI-04).
- Şema desteklenmezse: düz JSON + şema doğrulama + 1 yeniden deneme; yine geçersizse sağlayıcı hatası (AI-09 `ai_failure` → devir).
- Model katmanı: `LLM_MODEL` (oyuncuya giden metin) + `LLM_MODEL_FAST` (sınıflandırma/özet/hakem; boşsa ana model) — AI-16-S4 varsayılanı.
- Mock sağlayıcı şemaya uygun deterministik JSON üretir (MASTER-PROMPT "LLM için deterministik stub" korunur).
- Uyumlu uçlar (Azure vb.) F2 (AI-16-S5 varsayılanı).
- §11 Sahip kararları listesine K12 (OpenAI, bölge us) ve K17 satırı.
Kod değişikliği yok.

KABUL KRİTERLERİ:
- ADR dosyasında §6a var; §6 metni silinmedi, "değiştirildi: §6a" notu var.
- AI-16 (#283) ve JSON çıktı kullanan bütün AI görevleri bu göreve bağlı.

KULLANILAN VARSAYIMLAR:
- AI-16-S4 (iki model ayarı) ve AI-16-S5 (yalnız resmi OpenAI) varsayılanları kullanıldı.

**Test Strategy:**

Yalnız doküman: `pnpm -w format:check`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
