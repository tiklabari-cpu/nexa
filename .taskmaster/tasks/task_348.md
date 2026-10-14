# Task ID: 348

**Title:** WIDGET-KB-SEARCH [OPUS-HIGH] (Opus 5.5) Widget içinde bilgi bankası araması: "Yardım" sekmesi, yalnız yayımlanmış makaleler, kiracı tokendan, tsvector arama, tembel modül

**Status:** pending

**Dependencies:** 309 ⏱

**Priority:** medium

**Description:** Oyuncu sık sorulan bilgiyi sohbet açmadan bulamıyor; herkese açık KB uçlarında arama yok. Kaynak: WG-12.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: WG-12. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: public-kb.ts:156/:186/:208 (listQuery yalnız limit/page_id), kb_resolve_public_slug SECURITY DEFINER, tek 404 politikası; widget'ta KB yok.
contract: GET /customer/kb/search?q=&locale= ve GET /customer/kb/articles/{slug} (müşteri tokenı, kiracı tokendan); isteğe bağlı public uçlara q.
prisma/migration: makale başlık+gövde tsvector + GIN ('simple' + unaccent ya da Türkçe sözlük); dolu tabloda CONCURRENTLY ayrı migration.
api: yalnız published; taslak ve başka kiracının makalesi aynı boş sonuç; oran sınırı (müşteri kovası); arama sorgusu loglarda maskeli; sonuçsuz aramalar AI-22 (#317) bilgi boşluğuna sayı/normalize terim olarak beslenebilir (içerik değil). Arama servisi kaynaktan bağımsız arayüz — AI-14 tek depo (#309) kaynağı kullanılır.
widget: Yardım sekmesi (ayrı, tembel yüklenen modül — 50 KB bütçesi), arama, sonuç, makale (wdg/rich-text.ts sanitize; dış bağlantı rel=noopener + yeni sekme), her ekranda "Sohbet başlat".
web: widget ayarında aç/kapat.

KABUL KRİTERLERİ:
- "papara" aramasında yayımlanmış "Papara ile yatırım" çıkar, taslak çıkmaz.
- Başka kiracının makalesi hiçbir sorguda dönmez (negatif test).
- Yardım sekmesinden tek tıkla sohbet başlar.

KULLANILAN VARSAYIMLAR:
- Arama kaynağı AI-14 tek depo (K11).

**Test Strategy:**

Entegrasyon (taslak/kiracılar arası negatif), widget birim, e2e; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
