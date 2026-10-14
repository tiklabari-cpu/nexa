# Task ID: 344

**Title:** WIDGET-PHRASES-ETA [OPUS-HIGH] Widget metinlerini dil başına özelleştirme (kapalı anahtar listesi, yer tutucu doğrulaması) + kuyrukta tahmini bekleme aralığı (RP-04 verisi, ≥20 örnek)

**Status:** pending

**Dependencies:** 291 ⏱, 305 ⏱

**Priority:** medium

**Description:** Çevrimdışı, kuyruk ve yer tutucu metinleri koda gömülü; kuyruktaki oyuncu yalnız sıra numarasını görüyor. Kaynak: WG-05.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: WG-05. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 6 — widget, engage, helpdesk, raporlar, kanallar, faturalama, GV.

KOD: widget locales/tr.ts:9/:10/:27/:64-72; i18n.ts createTranslator (aktif dil → en → anahtar); welcome_title/welcome_text deseni; queue_position.
types: WIDGET_PHRASE_KEYS (kapalı liste) + uzunluk sınırı + izinli yer tutucular ({n}, {minutes}).
prisma: widget_phrases (license_id, brand_id, locale, key, text; benzersiz (license, brand, locale, key)) + RLS.
api: GET/PUT /settings/widget/phrases?locale=; mint yanıtına yalnız o dilin geçersiz kılmaları; GET /customer/chat estimated_wait {min_minutes, max_minutes} | null.
TAHMİN: aynı ekip kuyruğunun son 7 gün kuyruk→atanma medyan ve p80'i (queue_entries #291) × sıra / o an kabul eden kapasite; örnek < 20 → null (yalnız sıra); dakikaya yuvarla, aralık; ekip başına Redis ~60 sn önbellek (4 sn'lik poll'da hesaplanmaz). AU-01 (#305) ekip kuyruğu kullanılır.
KURALLAR: bilinmeyen anahtar/yer tutucu reddedilir; düz metin (HTML yok); fallback: kiracı (dil) → katalog (dil) → katalog (en) → anahtar; diller K25 gereği 8 widget dili.
widget: createTranslator önce geçersiz kılmaya bakar; kuyruk metni {minutes}. web: dil seçmeli editör, varsayılanı gösteren yer tutucu, "varsayılana dön", GV-06 kalıbı.

KABUL KRİTERLERİ:
- TR çevrimdışı metni değişince TR widget yeni, EN widget varsayılan metni gösterir.
- Bilinmeyen yer tutucu kaydedilemez.
- Yeterli veri varken "yaklaşık X–Y dk", yokken yalnız sıra.

KULLANILAN VARSAYIMLAR:
- Örnek eşiği 20, pencere 7 gün.
- K25: RU/AZ widget dili yok.

**Test Strategy:**

i18n.test.ts, locales.test.ts, tahmin birim, entegrasyon; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.
