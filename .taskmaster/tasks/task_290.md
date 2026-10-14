# Task ID: 290

**Title:** AI-CONFIG-VERSION-DESIGN [OPUS-HIGH] (Opus 5.5) AI yapılandırma sürüm modeli tasarım notu (K21): "taslak = düzenleme tabloları, çalışma anı = yayınlanmış değişmez paket", sürüm işaretçisi

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** 05 AI-20: "Sürüm işaretçisi ve taslak ilkesi AI-01…AI-15 kodlanmadan ÖNCE sabitlenmeli, yoksa geri dönüşü pahalı." K21: tasarım notu öne alınır; uygulama #316'da kalır. Kaynak: AI-20.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-20. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 2 — kimlik çekirdeği ve altyapı.

NE ÇIKACAK (docs/adr/ai-config-versioning.md, kod yok):
- Model: anlık görüntü (snapshot) + işaretçi. Düzenleme tabloları (skills, ai_guidance_rules, procedure alanları, ai_handoff_settings/devir kuralları, handoff_routes, kb_* tabloları, ai_agents.persona, guardrail ekleri) taslak çalışma alanıdır; canlı AI yalnız `ai_config_versions.snapshot` (derlenmiş paket) okur.
- `ai_agents.published_version_id`, `draft_revision` (If-Match, 409).
- Bilgi parçaları: `knowledge_chunks.visible_from_version / hidden_from_version`; geri dolum v1.
- Yeni bağlantı açılınca o anki yayın sürümü bağlantıya sabitlenir; her AI turu config_version_id taşır (ai_decision_logs, ai_conversations, ai_usage_events).
- AI-03 `procedure_snapshot` konuşma başında; snapshot hash'i kartta.
- Bu nota uymak için AI-03/07/08/09/12/13/14 görevlerinin şema kuralları: her düzenleme tablosunda `status` alanı açma (sürüm paketi yapar), `updated_at` + `draft_revision` artışı tek yardımcıdan.
- Hızlı yol (S1/S2): serbest makale/SSS düzeltmesi küçük sürüm (v12.1).
- RL yetenek adları: ai.config.edit/submit/publish/publish_compliance/rollback, ai.pause.

KABUL KRİTERLERİ:
- ADR dosyası var ve AI çekirdeği görevlerinin (#292, #296, #299, #301, #303, #307, #309, #310) şema kuralları buna atıf yapıyor.

KULLANILAN VARSAYIMLAR:
- K21.
- AI-20-S1 tek paket sürüm; S2 tablolar ve uyum kuralları onaya tabi; S3 geri alma/duraklatma tek Yönetici; S4 zamanlanmış yayın.

**Test Strategy:**

Yalnız doküman: `pnpm -w format:check`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
