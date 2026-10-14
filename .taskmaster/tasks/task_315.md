# Task ID: 315

**Title:** AI-CONFIG-HISTORY [OPUS-HIGH] AI ayar değişiklik geçmişi: ai_config_changes (önce/sonra/fark, yalnız ekleme), audit_log eylemleri, 5 yıl saklama, ekran ve CSV

**Status:** pending

**Dependencies:** 290 ⏱

**Priority:** medium

**Description:** Oyuncu "AI bana dün şunu söyledi" dediğinde o an geçerli kural/bilgi gösterilebilmeli (CGA, UKGC). Bugün AI tarafında yalnız silmeler kaydediliyor (playbook.ts:547, :1369; copilot.ts:264); audit_log değer yazamaz ve 30 günde budanır. AI-20'den önce yapılır (döngüyü kırmak için; version_id nullable). Kaynak: AI-21.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-21. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3c — AI yönetişimi ve ölçüm.

PRİSMA: ai_config_changes (id, license_id, ai_agent_id?, entity_type persona|guidance_rule|procedure|skill|knowledge_source|knowledge_table_row|handoff_rule|handoff_route|guardrail|risk_policy|access_info|config_version, entity_id, action created|updated|deleted|submitted|approved|rejected|published|rolled_back|paused|resumed|crawled, actor_id, actor_type, actor_role, at, version_id?, draft_revision?, before, after, diff, note, request_id); uygulama rolüne yalnız INSERT + SELECT (invoices kalıbı); RLS; indeksler (license_id, at desc), (license_id, entity_type, entity_id, at desc).
AUDIT: AUDIT_ACTIONS += ai.config_changed, ai.config_submitted, ai.config_approved, ai.config_rejected, ai.config_published, ai.config_rolled_back, ai.paused, ai.resumed, knowledge.crawled; metadata yalnız varlık türü, id, alan adları.
SERVİS services/ai/config-history.ts recordChange(tx, auditCtx, {...}): önceki hâl FOR UPDATE, yaz, sonraki hâl, JSON yol farkı, satır + audit aynı transaction'da; tek Kaydet = tek satır; aktör ve o anki rol; sistem işleri actor_type system + iş id; 20 KB üstü metin için hash/uzunluk; AI-26 maskeleme; okunabilir özet ("Adım 3: Finans'a devret → KYC'ye devret").
KANCALAR: servis katmanında tek sarmalayıcı — PATCH /ai-agents, skill CRUD, kaynak CRUD/yeniden indeksleme, copilot bilgi yolları ve AI-03/07/08/09/12/13/27/K13 yazma yolları (o görevler kancayı çağırır), AI-20 durum geçişleri.
SAKLAMA (AI-21-S1): aiConfigHistoryDays varsayılan 1825 (ya da sınırsız); audit budamasından etkilenmez; kiracı silinince silinir.
API: GET /ai/changes (filtre, imleç), GET /ai/changes/{id}, GET /ai/changes/export (CSV, Kurucu/Yönetici).
GÖRÜNÜRLÜK (S2): Kurucu/Yönetici tamamı, Ekip Lideri kendi değişiklikleri + yayın geçmişi (RL-02).
WEB: Playbook › Geçmiş sekmesi, History.tsx, ChangeDiff.tsx, editörlerde "Geçmiş" çekmecesi, audit log satırından derin bağlantı.

KABUL KRİTERLERİ:
- Persona tonu değişince 1 değişiklik satırı (önce/sonra) + 1 audit satırı (fields:['tone']).
- Skill silinince tam önceki hâl saklanır.
- Uygulama rolüyle UPDATE/DELETE veritabanı hatası.
- 30 günlük audit budamasından sonra satırlar yerinde.
- Ekip Lideri yalnız kendi değişikliklerini görür.
- CSV'de kim, ne zaman, varlık, alan, önce, sonra, sürüm.

KULLANILAN VARSAYIMLAR:
- AI-21-S1: 5 yıl; uzun saklama ↔ silme hakkı hukuki karar (07 açık risk).
- AI-21-S2 görünürlük.

**Test Strategy:**

Her yazma yolu aynı transaction'da tam bir satır (geri alınırsa yok), maskeleme, UPDATE/DELETE reddi, budama, RLS, dışa aktarma; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
