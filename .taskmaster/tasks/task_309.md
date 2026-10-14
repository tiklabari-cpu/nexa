# Task ID: 309

**Title:** KB-SINGLE-STORE [OPUS-MAX] (Opus 5.5) Tek bilgi deposu (K11): audiences (AI Agent / Copilot), marka kapsamı (chats.brand_id), dil, sahip, son gözden geçirme; Genel KB makaleleri AI'a bağlanır

**Status:** pending

**Dependencies:** 274 ⏱

**Priority:** high

**Description:** Aynı "Papara limitleri" AI Agent ve Copilot için ayrı ayrı giriliyor; biri güncellenip diğeri unutulunca AI ile ajan farklı limit söyler. Kaynaklarda marka/dil/sahip/gözden geçirme yok; A markasının bonus kuralı B'nin oyuncusuna söylenebilir. Genel KB AI'a bağlı değil. Kaynak: AI-14.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-14. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3b — bilgi deposu ve bilgi kalitesi.

[MAX] çapraz-kesen veri modeli + marka izolasyonu (brand-isolation testi).
KOD: KnowledgeSource schema:1739-1772 (ai_agent_id zorunlu), KnowledgeChunk :1782-1804; copilot-service.ts:44, 97-117 (ayrı AiAgent), :119-140 skill_runs çapası; uçlar playbook.ts:645-1380, copilot.ts:208-260; knowledge-service.ts:374-382 süzgeç; KbArticle :2684-2707, kb.ts:196-352; tenant.ts:19-29, 90-92 app.current_brand; chats'te marka kolonu yok.
PRİSMA (üç sürüm, CONVENTIONS §6.3): (1) genişlet: knowledge_sources.audiences text[] NOT NULL DEFAULT '{ai_agent,copilot}', ai_agent_ids uuid[] DEFAULT '{}', brand_ids uuid[] DEFAULT '{}', language, owner_id, reviewed_at, review_interval_days DEFAULT 90, valid_until, kb_article_id unique null, source_table, source_row_id (AI-13); GIN indeksleri ayrı CONCURRENTLY migration'larında. status KOLONU AÇILMAZ (#290: sürüm paketi; knowledge_chunks visible_from/hidden_from #316). (2) taşı: copilot ajanına bağlı kaynaklar audiences {copilot}, diğerleri {ai_agent,copilot} + ai_agent_ids; kod yeni alanları okur, eskiye de yazar. (3) daralt (sonraki sürüm notu): ai_agent_id nullable, okunmaz.
chats.brand_id uuid null (sohbet açılırken widget'ın web sitesinden Website.brandId) — marka süzgecinin ön koşulu; tek yerde tanım (WG-01/02 marka çözümüyle aynı).
KONTRAT: KnowledgeSource yeni alanlar; GET /knowledge-sources?audience=&brand_id=&stale=&owner_id=; /copilot/knowledge geriye uyumlu takma ad (deprecated notu); KbArticle.ai_audiences; POST /knowledge-sources/{id}/review.
ARAMA SÜZGECİ (tek SQL): audiences @> '{ai_agent}' AND (ai_agent_ids boş OR :agent) AND (brand_ids boş OR :brand) AND (valid_until null OR > now()); marka bilinmiyorsa yalnız "tüm markalar". Copilot ai_agent ∪ copilot.
KB AKIŞI: yayınlanan makale ai_audiences doluysa bağlı kaynak (varsayılan açık, makale başına kapatılır — AI-14-S2); yayından kaldırınca aramadan çıkar.
PLAN ÖLÇÜMÜ: süzgeçli HNSW satır kaçırma riski (schema notu :1774-1781) — tm 254 ölçümü yeniden, gerekirse süzgeç kolonları knowledge_chunks'a denormalize.
Tazelik taraması AI-13 ile ortak iş. Benzer kaynak uyarısı (0.95) isteğe bağlı.
WEB: birleşik liste, kitle çipleri, marka çoklu seçim, sahip, gözden geçirme rozeti; Copilot sayfası süzgeçli görünüm; KB editöründe anahtar.

KABUL KRİTERLERİ:
- {ai_agent,copilot} kaynak hem AI cevabında hem Copilot taslağında; {copilot} kaynak AI'ın oyuncu cevabında asla.
- A markasına özel kaynak B sohbetinde kullanılmaz.
- Yayınlanan KB makalesi aramada bulunur, kaldırılınca bulunmaz.
- /copilot/knowledge migration öncesi/sonrası aynı öğeler.
- Migration sonrası mevcut kaynaklar yeniden embedding olmadan çalışır.

KULLANILAN VARSAYIMLAR:
- K11.
- AI-14-S2 makaleler varsayılan açık; S3 gözden geçirme zorunlu, 90 gün.

**Test Strategy:**

Entegrasyon (kitle, marka, KB yayın/kaldırma, eski uç, migration), brand-isolation.test.ts, retrieval ölçümü; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 309.1. KBS-EXPAND [OPUS-MAX] Genişlet: knowledge_sources yeni kolonlar + chats.brand_id + GIN indeksleri (ayrı dosyalar) + kontrat

**Status:** pending  
**Dependencies:** None  

Üst görev 309 ayrıntılarındaki ilgili bölüm.

### 309.2. KBS-MIGRATE-SEARCH [OPUS-MAX] Veri taşıma + arama/Copilot süzgeçleri + KB yayın kancası + retrieval ölçümü

**Status:** pending  
**Dependencies:** 309.1  

Üst görev 309 ayrıntılarındaki ilgili bölüm.

### 309.3. KBS-WEB [SONNET-HIGH] Birleşik bilgi listesi + Copilot süzgeçli görünüm + KB editör anahtarı

**Status:** pending  
**Dependencies:** 309.2  

Üst görev 309 ayrıntılarındaki ilgili bölüm.
