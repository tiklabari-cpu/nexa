# Task ID: 305

**Title:** TEAM-TOPIC-QUEUES [OPUS-XHIGH] (Opus 5.5) Konuya göre ekip kuyrukları (K14): Finans, KYC/Risk, Bonus, Sorumlu Oyun (yalnız eğitimli), Teknik, Şikâyet — ekip başına kuyruk, öncelik, baş-tıkanmasının giderilmesi

**Status:** pending

**Dependencies:** 271 ⏱, 291 ⏱

**Priority:** high

**Description:** Kuyruk şirket genelinde tek sıra; uygun ajan yoksa döngü duruyor (routing-service.ts:215 `if (!assignee) break;`) — Sorumlu Oyun'da bekleyen tek sohbet Finans'ı da bekletiyor; boşaltmada uzmanlık uygulanmıyor (:203-209). K14: 6 hazır şablon, yeniden adlandırılabilir, yenisi eklenebilir; Sorumlu Oyun silinemez, yalnız eğitimli ajan üye olur. Kaynak: AU-01.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AU-01. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3a — AI çekirdeği (çok turlu motor, devir, uyum).

XHIGH GEREKÇESİ (eski etiket MAX, 2026-10-14 gözden geçirme): Routing/queue algoritması + concurrent limit + fallback (MASTER-PROMPT). ADR-08a (#271).
KOD: routing-service.ts route :114-171, drainQueue :179-241, renumberQueue :244-257, #nextQueuePosition :407-414, #selectGroup :261-313, #fallbackGroup :315-321, #selectAgent :341-405; Group schema:698-711, AgentExpertise :759; ai-responder.ts:174-187 adla arama.
TİPLER/KONTRAT: QUEUE_TOPIC_ROLES ['finance','kyc_risk','bonus','responsible_gambling','technical','complaint']; packages/contract/openapi/paths/agents.yaml#/group (rol, gerekli yetenekler, mesai dışı modu); GET /routing/queues (rol → ekip; AI-12 ve WG-04 kullanır).
PRİSMA: groups.topic_role TEXT NULL + kısmi tekil (license_id, topic_role); groups.after_hours_mode DEFAULT 'queue'; ekip gerekli yetenek bağlantı tablosu; threads.queue_group_id BIGINT NULL; threads.priority (AI-12 ile ortak: urgent|high|normal; tek tanım burada) ; mevcut kuyruktaki oturumlar için queue_group_id geri doldurma (ilk erişim grubu); queue_entries.group_id (#291) bu alandan yazılır.
ROUTING: sıra numarası/yeniden numaralandırma/boşaltma ekip başına; ekip içinde priority DESC, queued_at ASC; "ilk eksikte dur" yalnız ekip içinde; boşaltmada gerekli yetenekler; responsible_gambling için yedek ekip YOK (uygun ajan yoksa kuyrukta kalır, EL ve Yöneticiye acil bildirim, oyuncuya bir kez sabit destek mesajı; mesai dışında talep kaydı — AI-12/HD); eğitimli ajan kontrolü üyelikte (PUT /groups/{id}/agents/{agentId} 409) ve seçimde; Sorumlu Oyun ekibi silinemez; kısa işlemler, tüm kiracıyı kilitlemeyen boşaltma.
AI KÖPRÜSÜ: resolveQueue(topicRole) — ad yerine rol/ID (AI-12 kullanır).
RTM: queue_positions_updated ekip bazında. Widget sıra numarası ekip kuyruğuna göre.
WEB: ekip editöründe kuyruk ayarları; onboarding/ekip sayfasında "iGaming kuyruk şablonunu kur" eylemi (6 ekip + "Sorumlu oyun eğitimi" yeteneği; migration değil bilinçli eylem); Inbox "Kuyrukta" ekip sekmeleri. ("Takıma aktar" IN-04 #306.)

KABUL KRİTERLERİ:
- Finans'ta boş ajan varken Sorumlu Oyun kuyruğunda bekleyen sohbet Finans atamasını engellemez.
- Sorumlu Oyun sohbeti hiçbir koşulda başka ekibe ya da eğitimsiz ajana atanmaz.
- Yetenek etiketi olmayan ajan Sorumlu Oyun ekibine eklenemez (409).
- Rol ile çözülen AI devri ekip adı değişse de doğru ekibe düşer.
- Acil öncelikli sohbet kendi kuyruğunun başına geçer.
- Oyuncunun gördüğü sıra kendi ekip kuyruğuna göre.

KULLANILAN VARSAYIMLAR:
- K14.
- AU-01-S2: "Sorumlu oyun eğitimi" yeteneği; Yönetici/Kurucu verir.
- AU-01-S3/S4 varsayılanları.

**Test Strategy:**

Entegrasyon (baş-tıkanması, yedek yasağı, yetenek kuralı, öncelik, eşzamanlı boşaltma), routing.test.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 305.1. TQ-SCHEMA [OPUS-XHIGH] topic_role, after_hours_mode, gerekli yetenekler, threads.queue_group_id/priority + geri doldurma + kontrat

**Status:** pending  
**Dependencies:** None  

Üst görev 305 ayrıntılarındaki ilgili bölüm.

### 305.2. TQ-ROUTING [OPUS-XHIGH] Ekip başına kuyruk/boşaltma/numaralandırma + öncelik sırası + yetenek uygulaması + RG yedek yasağı

**Status:** pending  
**Dependencies:** 305.1  

Üst görev 305 ayrıntılarındaki ilgili bölüm.

### 305.3. TQ-MEMBERSHIP-RESOLVE [OPUS-XHIGH] Üyelikte eğitim kontrolü (409), RG silinemez, resolveQueue(topicRole), GET /routing/queues

**Status:** pending  
**Dependencies:** 305.1  

XHIGH GEREKÇESİ: (1) yetkili endpoint kuralı.

### 305.4. TQ-WEB [OPUS-HIGH] Ekip editörü kuyruk ayarları + iGaming şablonu kur eylemi + Inbox kuyruk sekmeleri

**Status:** pending  
**Dependencies:** 305.2, 305.3  

Üst görev 305 ayrıntılarındaki ilgili bölüm.
