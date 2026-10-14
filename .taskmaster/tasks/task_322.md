# Task ID: 322

**Title:** AI-TOOL-SLOT-F2 [OPUS-MAX] [F2 · deferred] Araç yuvasının aktif kullanımı: dağıtıcı (zaman aşımı, devre kesici, oran sınırı, audit ai.tool_called), doğrulanmış kimlikle çağrı, tool_connections

**Status:** deferred

**Dependencies:** 321 ⏱, 378 ⏱

**Priority:** low

**Description:** F2: iGaming platform entegrasyonları (KN-06) gelince araçlar gerçekten çağrılır ve AI "hesabınıza geçmiş görünüyor" diyebilir (söz verme yasağı sürer). Sahip talimatı: F2 maddeleri deferred. Kaynak: AI-28.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-28. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3c — AI yönetişimi ve ölçüm.

ETKİNLEŞTİRME KOŞULU: KN-06 gerçek entegrasyonu (#378) ve LLM ADR §6'nın F2 için yeniden açılması (araç çağırma yine modelde değil, prosedür motorunda).
KAPSAM: dağıtıcı MCP tool-dispatch.ts desenini izler (zaman aşımı ≤3 sn, kiracı/marka kapsamı, audit ai.tool_called, araç başına oran sınırı, devre kesici); tool_connections (license_id, brand_id, tool_key, provider, credential_ref, status) — kimlik bilgisi gizli kasada (credential-cipher); requires_verified_identity araçlarında kimlik doğrulanmış oturumdan (K4 üye tokenı + F2 operatör imzalı kimlik #388); çıktı yapılandırılmış alan olarak prompt'a (injection koruması); yazma araçları varsayılan kapalı, açılırsa oyuncu onayı + AI-20 uyum onayı; tool_invocations kaydı (KN-06) devir kartında "AI şunu kontrol etti".
Bu görev F2'ye kadar seçilmez (deferred).

KABUL KRİTERLERİ:
- (F2) Doğrulanmamış oyuncuda araç çağrılmaz; 3 sn aşımında F1 akışı; sonuçlar söz verme yasağına tabi.

KULLANILAN VARSAYIMLAR:
- Sahip talimatı: F2 deferred.

**Test Strategy:**

(F2) Adaptör sözleşme testleri, devre kesici, kimlik kapısı, RLS. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
