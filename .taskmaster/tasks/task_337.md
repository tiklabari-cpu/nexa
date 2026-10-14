# Task ID: 337

**Title:** RATING-COMMENT [OPUS-HIGH] Puan + yorum: widget'ta puandan sonra isteğe bağlı yorum (yeni satır açmadan), puanın doğru bağlantıya yazılması (thread_id), arşiv/Inbox/raporda gösterim, chat_rated push

**Status:** pending

**Dependencies:** 335 ⏱

**Priority:** medium

**Description:** API yorumu kabul ediyor ama widget göstermiyor; Inbox ve arşivde puan/yorum hiç görünmüyor; aynı konuşmaya birden çok puan yazılabiliyor; puan oyuncunun "en son" konuşmasına yazılıyor (eskisi puanlanırsa yanlış konuşmaya gider). İki madde aynı puan yolunu değiştirdiği için birleştirildi. Kaynak: AR-03, WG-11.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AR-03, WG-11. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 5 — ajan deneyimi, arama, arşiv.

KOD: customer.ts:95-98 rateSchema.comment (≤1000, kart maskeli), :1096-1135 POST /customer/chat/rating (her çağrı yeni satır, son thread'e); Rating schema:1278-1291; review-insights.ts; widget'ta comment yok.
contract: puan gönderiminde thread_id (widget konuşmanın Chat ID'sini gönderir); PATCH /customer/chat/rating/{id} (yorumu mevcut puana ekle) ya da tek istekte değer + yorum; ConversationSummary.rating {value, has_comment}, detay {value, comment, rated_at}, ChatDetail.thread.rating; GET /reports/reviews son yorumlar (sayfalı); RTM chat_rated {chat_id, thread_id, value} (atanan ve ekip; IN-07 ile ortak).
prisma: ratings(license_id, thread_id, created_at DESC) indeksi; thread_id boş eski satırlar chat_id + zaman aralığıyla tek seferlik backfill.
api: yorum ayrı gelirse YENİ Rating satırı açılmaz, oyuncunun o sohbetteki son puan satırına yazılır (puan sayısı iki kat sayılmaz); okunan puan thread'in en son puanı; yorum düz metin, maskeli (AI-26 genişlemesi aynı yol); ajan puanı değiştiremez; görünürlük (AR-03-S1): EÜ kendi konuşmalarınınkini, EL+ hepsini (RL-02); retention sweep ratings'i kapsar (kontrol).
widget: puan sonrası "Eklemek istediğiniz bir şey var mı?" (kötü puanda öne çıkar).
web: RatingBadge.tsx (ikon + metin) arşiv satırı/detayı ve DetailsPanel; ReportsPage yorumlar kartı; uzun yorum kısaltılır, tıklayınca tamamı; HTML render edilmez.
AI-27 hazır olunca yorum risk sinyali taramasına verilebilir (not).

KABUL KRİTERLERİ:
- Kötü puandan sonra yazılan yorum aynı puan satırına; puan sayısı değişmez.
- Arşiv satırında "Kötü (yorumlu)", detayda yorum.
- Inbox'ta açık sohbette puan RTM ile anında.
- Varsayılan kararda EÜ başka ajanın yorumunu göremez.
- Gösterilen puan AR-02 puan filtresiyle tutarlı.
- Yeni konuşma açıldıktan sonra eski konuşmanın puanı doğru bağlantıya yazılır.
- Kart numaralı yorum maskeli.

KULLANILAN VARSAYIMLAR:
- AR-03-S1 görünürlük.
- WG-11'de açık soru yok.

**Test Strategy:**

Entegrasyon (ikinci puan birinciyi gösterimde değiştirir, yorum satır açmaz, görünürlük), widget.rating.test.ts, e2e csat.spec.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
