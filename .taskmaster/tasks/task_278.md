# Task ID: 278

**Title:** CUSTOMER-USERNAME-CLOSE [OPUS-HIGH] (Opus 5.5) customer_username işini kayıt altına al: DoD kapısı, PLAN/HANDOFF, username_normalized, eksik yerler (K20)

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** Analizde commit'lenmemiş olan customer_username işi 120bb3d ("analiz upload") commit'inde görev kaydı, feat/ dalı ve DoD kapısı olmadan main'e girdi. Widget'ta zorunlu, API'de isteğe bağlı. K20: ID-03'ün ön görevi olarak kayda alınsın; WG-01 ve ID-03 buna bağlansın. Kaynak: ID-03, WG-01.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: ID-03, WG-01. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 1 — hızlı güvenlik/temel düzeltmeler.

BUGÜN (2026-10-14 doğrulandı): schema.prisma:394-396 Customer.username; migration 20261014090000_customer_username (TEXT, indeks yok, "asla arama anahtarı değil"); customer.ts startSchema.username (:77, optional) + :707-724 kayıt; customers.ts ajan güncellemesi; customer-service.ts:319 ILIKE arama; widget pre-chat zorunlu alan (widget.ts:2636-2677, :1148), api.ts:251; 8 locale; CustomerDetailPanel gösterir/düzenler; testler (widget.prechat.test.ts, customer-chat.test.ts, customers.test.ts, e2e fixtures).
EKSİK: ticket araması (ticket-service.ts queryFilter ~:942) username'e bakmıyor; Inbox DetailsPanel göstermiyor (IN-02 yapacak — burada YAPILMAZ); mobil ekran yok; `username_normalized` yok.
YAPILACAK:
1) Mevcut değişikliğin DoD kapısını koş (`pnpm test:gate` arka planda + ilgili e2e: widget, customers, csat, traffic), kırmızı varsa düzelt.
2) Migration (genişlet): `customers.username_normalized` (lower(trim(username)) saklanan üretilmiş kolon) + indeks `(organization_id, username_normalized)` — ayrı migration dosyasında `CREATE INDEX CONCURRENTLY` (CONVENTIONS §6.3). Not: arama içindir, kimlik için DEĞİL (K4).
3) customer-service araması username için önek/eşitlik `username_normalized` üzerinden; ticket araması username'i de kapsar.
4) PLAN.md ilgili satır + §K kanıt maddesi (tm <bu id>), HANDOFF bloğu (CONVENTIONS §3).
KAPSAM DIŞI: eşleştirme/birleştirme (ID-03 #287), Inbox oyuncu kartı (IN-02 #331), mobil (ayrı not).

KABUL KRİTERLERİ:
- Tam DoD kapısı yeşil (exit code ile).
- username_normalized + indeks var; db:check-drift temiz.
- Ticket ve müşteri araması kullanıcı adını büyük/küçük harf duyarsız bulur.
- HANDOFF ve PLAN §K kaydı var.

KULLANILAN VARSAYIMLAR:
- K20: ayrı ön görev.
- Widget zorunlu / API isteğe bağlı farkı WG-01 (#279) ayarına bırakıldı.

**Test Strategy:**

customers.test.ts (normalize arama), ticket-search entegrasyon testi, mevcut widget.prechat/customer-chat testleri; `pnpm test:gate`; `pnpm -w db:check-drift`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
