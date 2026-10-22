# Task ID: 316

**Title:** AI-CONFIG-VERSIONING [OPUS-XHIGH] (Opus 5.5) Taslak → test → onay → yayın: ai_config_versions (snapshot + işaretçi), dört göz, uyum değişikliğinde Kurucu onayı, geri alma, duraklatma, zamanlı yayın

**Status:** pending

**Dependencies:** 290 ⏱, 314 ⏱, 315 ⏱

**Priority:** medium

**Description:** Gece aceleyle yapılan bir değişiklik binlerce oyuncuya anında gidiyor (PATCH /skills canlıyı değiştiriyor). Dört göz hatalara ve içeriden kötüye kullanıma karşı korur; denetimde "bu yanıt hangi kural setiyle verildi?" cevabı sürüm numarası. Tasarım #290'da sabitlendi. Kaynak: AI-20.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-20. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3c — AI yönetişimi ve ölçüm.

XHIGH GEREKÇESİ (eski etiket MAX, 2026-10-14 gözden geçirme): eşzamanlılık (If-Match, yayın transaction'ı, önbellek geçersizleştirme) + yetki.
PRİSMA: ai_config_versions (id, license_id, ai_agent_id, number, minor, status in_review|approved|published|superseded|rejected, snapshot, knowledge_manifest, diff_summary, draft_revision, test_run_id, touches_compliance, submitted_by/at, reviewed_by/at, review_note, published_by/at, scheduled_at?, rollback_of?); ai_agents.published_version_id, draft_revision; knowledge_chunks.visible_from_version, hidden_from_version + indeks; geri dolum: mevcut durum v1, parçalar visible_from 1.
API routes/ai-config.ts: GET /ai/config/draft/diff; POST /ai/config/versions (onaya gönder); POST …/{id}/approve {publish_at?}, /reject, /rollback; POST /ai/pause, /ai/resume; GET /ai/config/versions, …/{a}/diff/{b}. Servisler config-compiler.ts (taslak → paket + doğrulama), config-cache.ts (sürüme göre önbellek, realtime-bus ile geçersizleştirme).
ZAMANLAYICI: ai_scheduled_publish (dakikada, kilitli); knowledge_chunk_gc (5 sürüm + 30 günden eski gizli parçalar).
RTM: ai_config_published; Inbox bandı.
AKIŞ: yazmalar taslağa, draft_revision++ (If-Match; eski revizyon 409); gönderme: derleyici doğrular (adımlar, AI-07 çelişki, devir hedefleri), fark, touches_compliance (guardrail, risk politikası, kilitli kategoriler), bu draft_revision için son AI-19 koşusunda uyum paketi %100, durum in_review + onaycılara bildirim; onay: onaycı ≠ gönderen (sunucu), touches_compliance → onaycı Kurucu; publish_at yoksa hemen; yayın tek transaction (published, öncekisi superseded, işaretçi, parça görünürlüğü, AI-21 + audit ai.config_published), commit sonrası önbellek + RTM.
ÇALIŞMA ANI: yeni bağlantı açılınca sürüm sabitlenir; her tur config_version_id; arama visible_from ≤ v < hidden_from; simülasyon taslakta yayımlanmamış parçaları da görür.
GERİ ALMA (S3): seçilen sürümün paketinden yeni sürüm (tarih yeniden yazılmaz); temizlenmiş parça gerekiyorsa engellenir; tek Yönetici yapabilir. DURAKLATMA: AiAgent.active=false + kayıt.
HIZLI YOL (S1/S2): Yöneticinin serbest makale/SSS düzeltmesi küçük sürüm (v12.1) otomatik onay + AI-21; ödeme/bonus/KYC tabloları ve uyum kuralları onaya tabi.
ZAMANLI YAYIN (S4): yayın anında onay ve uyum koşusu yeniden kontrol.
YETENEKLER: ai.config.edit/submit/publish/publish_compliance/rollback, ai.pause (RL-02 gelene kadar: EL taslak hazırlar = admin altı rol yoksa admin; dört göz admin↔owner).
WEB: VersionBar.tsx ("Yayında v12 · Taslak 7 değişiklik"), Versions.tsx, DiffView.tsx, "Taslak" şeridi, önizlemede taslak/yayındaki seçimi; useSkillActiveToggle anlamı "bu sürümde etkin" (geçiş açıklaması).
NOT: HNSW + görünürlük süzgeci isabet ölçümü (measure:knowledge-retrieval).

KABUL KRİTERLERİ:
- Taslakta prosedür değişince canlı widget eski davranışla; oyuncu gibi konuş (taslak) yeni davranış.
- Ekip Lideri yayınlayamaz; Yönetici kendi gönderisini onaylayamaz; guardrail değişikliği Kurucu olmadan yayımlanamaz.
- Uyum senaryosu kalırsa "Onaya gönder" nedeniyle kapalı.
- v11'e geri alınca v12'de silinen parça yeniden aranabilir.
- Her AI yanıtı kaydında config_version_id.
- Zamanlı yayın en geç 1 dk sonra; onay geri çekildiyse yapılmaz.
- İki kişi aynı taslağı düzenlerse ikinci kayıt 409.

KULLANILAN VARSAYIMLAR:
- K21 tasarımı #290.
- AI-20-S1..S4 varsayılanları.

**Test Strategy:**

Dört göz 403, Kurucu kuralı, uyum kapısı, geri alma, zamanlı yayın, If-Match 409, önbellek geçersizleştirme; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 316.1. VER-SCHEMA [OPUS-HIGH] ai_config_versions + ai_agents.published_version_id/draft_revision + knowledge_chunks görünürlük kolonları ve indeks + geri dolum v1

**Status:** pending  
**Dependencies:** None  

Üst görev 316 ayrıntılarındaki ilgili bölüm. HIGH NOTU (XHIGH→HIGH, sahip kararı 2026-10-22 · §D332): şema alanları üst görevin PRİSMA bölümünde tam yazılı; üst görevin XHIGH gerekçesi (If-Match, yayın transaction'ı, önbellek geçersizleştirme, yetki) 316.2 ve 316.3'te uygulanır, onlar XHIGH kalır. Geri dolumun mevcut her ajanı v1 yayınlanmış sürüme bağladığı testle kanıtlanır.

### 316.5. VER-COMPILER [OPUS-HIGH] config-compiler.ts: taslak → derlenmiş paket + doğrulama (adımlar, AI-07 çelişki, devir hedefleri) + fark özeti + touches_compliance

**Status:** pending  
**Dependencies:** 316.1  

Üst görev "Servisler config-compiler.ts" ve AKIŞ'taki gönderme doğrulaması; iş akışı uçları (316.2) bunu çağırır. Ayrıntı ve kabul maddeleri: üst görev #316 details (tek kaynak).

### 316.2. VER-WORKFLOW-API [OPUS-XHIGH] Gönder/onayla/reddet/geri al/duraklat uçları, dört göz, Kurucu kuralı, uyum kapısı, If-Match

**Status:** pending  
**Dependencies:** 316.1, 316.5  

Üst görev 316 ayrıntılarındaki ilgili bölüm.

### 316.3. VER-RUNTIME-CACHE [OPUS-XHIGH] Çalışma anı sürüm sabitleme + config-cache (sürüme göre) + realtime-bus geçersizleştirme + arama görünürlük süzgeci

**Status:** pending  
**Dependencies:** 316.2  

Üst görev 316 ayrıntılarındaki ilgili bölüm.

### 316.6. VER-SCHEDULED-JOBS [OPUS-HIGH] Zamanlı işler: ai_scheduled_publish (dakikada, kilitli) + knowledge_chunk_gc (5 sürüm + 30 günden eski gizli parçalar)

**Status:** pending  
**Dependencies:** 316.3  

Üst görev ZAMANLAYICI maddesi; yayın yolu 316.2/316.3'teki tek transaction'ı çağırır. Ayrıntı ve kabul maddeleri: üst görev #316 details (tek kaynak).

### 316.4. VER-WEB [OPUS-HIGH] VersionBar, Versions, DiffView, Taslak şeridi, RTM bandı

**Status:** pending  
**Dependencies:** 316.3  

Üst görev 316 ayrıntılarındaki ilgili bölüm.
