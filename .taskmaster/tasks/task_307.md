# Task ID: 307

**Title:** AI-HANDOFF-TARGET-PRIORITY [OPUS-HIGH] (Opus 5.5) Devir hedefi ve öncelik: id tabanlı hedef (ad değil), konu/neden → ekip rotaları, acil öncelik, uzmanlık şartı, mesai dışı davranışı (kuyruk + metin + talep)

**Status:** pending

**Dependencies:** 303 ⏱, 304 ⏱, 305 ⏱, 306 ⏱

**Priority:** high

**Description:** Devir adımı ekip adını serbest metin tutuyor (steps.ts:52-55); ad tutmazsa sohbet kalıyor; ekipte çevrimiçi ajan yoksa devir hata veriyor ve AI tarafı yalnız logluyor; öncelik kavramı yok. Kendine zarar ifadeli sohbet normal kuyrukta beklememeli; gece 03:00'te "Ekibimiz 09:00'da dönecek" denmeli. Kaynak: AI-12.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AI-12. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 3a — AI çekirdeği (çok turlu motor, devir, uyum).

ADIM ŞEMASI: handoff/transfer_to_team hedefi group_id; migration genişlet → taşı: çözücü önce id'ye, yoksa ada; geri doldurma işi adları id'ye çevirir; arayüz yalnız id yazar.
PRİSMA: handoff_routes (AU-01 ile ortak tek tablo: id, license_id, brand_id null, match_type topic|reason, match_key finance|kyc_risk|bonus|responsible_gaming|technical|complaints|trading|general ya da neden kodu, group_id, required_expertise_id null, default_priority, active) + RLS; threads.priority (#305 tanımı) + priority_reason. K9 devir kuralları (#303) hedefini buradan çözer.
KONTRAT: /handoff-routes CRUD; Thread.priority; sohbet listesi önceliğe göre sırala/süz; aktarım ucuna yalnız bot principal'ı için queue_if_offline:true.
HEDEF ÇÖZME: (1) adımın açık hedefi → (2) K9 kiracı kuralı → (3) neden rotası (G1/G2/G3 → responsible_gaming; G5 → ayara göre kyc_risk|rg; G13 → kyc_risk; G15 → complaints) → (4) prosedür konu rotası → (5) aynı gün önceki devrin ekibi (repeat_same_day; çevrimiçiyse aynı ajan) → (6) fallback → (7) varsayılan; her adımda grup var mı doğrulanır, yoksa sonraki + kayıt.
UZMANLIK: required_expertise_id varsa yalnız o uzmanlıktaki ajanlar; yoksa acil öncelikle kuyrukta, grup Ekip Liderlerine bildirim (AI-12-S3); eğitimsiz ajana düşmez.
ÖNCELİK: urgent = G3, G5, G1; high = repeat_same_day, angry; normal.
MESAİ DIŞI (AI-12-S2): kabul eden ajan yoksa hata yok, grup kuyruğu; kiracı metni "Ekibimiz {açılış} itibarıyla dönecek" ({açılış} F1'de kiracının yazdığı metin; WorkSchedule'dan hesap P2); oyuncu e-posta verirse createFromWidget ile ticket (HD/WG-08); G3'te kriz metni her koşulda önce.
OLAY: transfer sistem olayına reason ai_handoff, handoff_id, priority, reason_codes; kart target_group_id/priority taşır; mod geçişi başına tek devir.
iGaming EKİP ÖNERİSİ: organizations.sector=gaming_gambling ise AI-15 kurulumu 6 ekibi ve rotalarını önerir (AI-12-S1); grup yalnız açık onayla.
WEB: HandoffRoutes.tsx; SkillEditor ekip seçici; Inbox öncelik rozeti + sıralama.

KABUL KRİTERLERİ:
- Ekip yeniden adlandırılınca devir çalışır (id).
- Ekipte çevrimiçi ajan yokken devir hata vermez; kuyruk + mesai dışı metni.
- G3 ifadesi → kriz metni + acil + sorumlu oyun ekibi.
- Uzmanlık şartlı rotada uzmanlığı olmayan ajana atama yok.
- Kuyrukta acil sohbet normallerin önüne geçer.
- Ad tabanlı eski adım id'ye taşınır; geçersiz hedefte fallback + kayıt.

KULLANILAN VARSAYIMLAR:
- AI-12-S1/S2/S3 varsayılanları.
- Ekip düzeyinde çalışma saati hesabı P2 (07 açık risk).

**Test Strategy:**

Entegrasyon (ad değişimi, çevrimdışı ekip, G3, uzmanlık, sıra, taşıma); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 307.1. TGT-ROUTES-MIGRATE [OPUS-HIGH] handoff_routes + adım hedefi group_id taşıması (genişlet → taşı) + kontrat

**Status:** pending  
**Dependencies:** None  

Üst görev 307 ayrıntılarındaki ilgili bölüm.

### 307.2. TGT-RESOLVER [OPUS-HIGH] target-resolver.ts çözme sırası + uzmanlık + öncelik + mesai dışı + queue_if_offline

**Status:** pending  
**Dependencies:** 307.1  

Üst görev 307 ayrıntılarındaki ilgili bölüm.

### 307.3. TGT-WEB [SONNET-HIGH] HandoffRoutes.tsx + SkillEditor ekip seçici + Inbox öncelik rozeti/sıralama

**Status:** pending  
**Dependencies:** 307.2  

Üst görev 307 ayrıntılarındaki ilgili bölüm.
