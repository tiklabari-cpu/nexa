# Task ID: 334

**Title:** TIMELINE-VIEWER [OPUS-HIGH] Log / zaman çizelgesi görüntüleyici: bir Chat ID ya da Thread ID için mesaj, iç not, AI kararı, atama, transfer, etiket, puan, SLA, ticket, audit tek ekranda; Ctrl+F dostu; maskeli dışa aktarma

**Status:** pending

**Dependencies:** 288 ⏱, 329 ⏱

**Priority:** medium

**Description:** Bilgi dağınık: transkript Inbox'ta, AI çalışma kaydı Playbook'ta, audit Ayarlar'da (metin araması kapsam dışı), teknik loglar sunucuda. Inbox listeleri sanallaştırıldığı için tarayıcı Ctrl+F görünmeyen satırları bulamaz. Kaynak: ID-09.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: ID-09. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 5 — ajan deneyimi, arama, arşiv.

contract: GET /chats/{chatId}/timeline?thread_id=&kinds=&page_id=&limit= → {at, kind message|note|system|ai_decision|assignment|transfer|tag|rating|sla_breach|ticket|audit, actor, chat_id, thread_id, event_id?, text?, details}; POST /chats/{chatId}/timeline/export {format csv|ndjson|txt, thread_id?, mask_pii}.
migration: audit_log (license_id, target, created_at) indeksi (CONCURRENTLY).
api: services/chat/timeline.ts — kaynaklar events (iç notlar dahil), ai_decision_logs (#288), hedefi chat:<id> audit kayıtları, skill_runs, ratings, sla_breaches, bu sohbetten açılan ticket'lar; (at, kind_sırası, id) ile birleştirme ve sayfalama, her kaynak kendi indeksiyle sınırlı; görünürlük resolveVisibility + canSeeChat, görünmeyen 404; audit eylemi chat.timeline_exported; yetenekler timeline.view, timeline.export, timeline.export_unmasked (RL-02).
KURALLAR: liste SANALLAŞTIRILMAZ; 200 satırlık sayfalar "Daha fazla yükle", yüklenenler DOM'da; sayfa içi süzme kutusu; saatler workspace TZ (ID-04), tooltip UTC; dışa aktarma akışlı ≤20.000 satır, varsayılan maskeli (maskPii + müşteri alanları), maskesiz yalnız export_unmasked; başlıklar "Thread ID (chat_id)"; Thread ID görünümünde bağlantı ayırıcıları; saklama süresi dolmuş audit için "kayıt saklama süresi dolmuş" notu.
GÖRÜNÜRLÜK (ID-09-S1): EÜ kendi konuşmaları (AI kararları dahil), EL kendi ekipleri, Yönetici/Kurucu hepsi. Dışa aktarma Yönetici/Kurucu (S2), maskesiz yalnız Kurucu (S3).
web: features/timeline/TimelinePage.tsx (/app/inbox/timeline?chat=<T>&thread=<C>), TimelinePanel.tsx (Inbox detay sekmesi), filtreler, süzme, satır kopyalama, dışa aktarma penceresi; arşiv satırı eylemi.

KABUL KRİTERLERİ:
- Mesajlar, iç notlar, AI kararları (prosedür, kaynak, devir nedeni), atama, transfer, etiket, kapanış ve puan doğru sırada.
- Ctrl+F yüklenmiş tüm satırlarda eşleşme bulur.
- EÜ başka ekibin zaman çizelgesini açamaz (404).
- CSV varsayılan e-posta ve kullanıcı adını maskeler; dışa aktarma audit'te.
- Süresi dolmuş audit için not, hata yok.

KULLANILAN VARSAYIMLAR:
- ID-09-S1/S2/S3 varsayılanları.

**Test Strategy:**

Entegrasyon (birleştirme/sıralama, 404, maskeleme + audit), e2e (Inbox'tan aç, AI karar satırını bul, CSV indir, "Thread ID (chat_id)" başlığı); `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
