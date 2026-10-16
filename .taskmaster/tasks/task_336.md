# Task ID: 336

**Title:** ARCHIVE-FILTERS [OPUS-HIGH] (Opus 5.5) Arşiv filtreleri: tarih (kiracı saat diliminde; P0), ajan, ekip, puan, etiket (any/all/exclude, ≤20), AI/insan, risk bayrağı, kanal, durum; URL'de (yalnız kimlikler)

**Status:** pending

**Dependencies:** 285 ⏱, 293 ⏱, 335 ⏱

**Priority:** high

**Description:** Liste ucu yalnız görünüm, kanal, oyuncu, ekip, sıralama alıyor; tarih/ajan/etiket/puan yok. Raporların tarih aralığı UTC (ReportsPage.tsx:489-504) — arşiv aynı bileşeni kullanırsa gece vardiyası yanlış güne düşer. Kaynak: AR-02.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: AR-02. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 5 — ajan deneyimi, arama, arşiv.

contract (GET /archive/conversations parametreleri): date_from/date_to (YYYY-MM-DD, kiracı TZ) ya da from/to (ISO); agent_id[], group_id[]; rating any|not_rated|good|bad|commented|good_commented|bad_commented; tag[] (≤20), tag_mode any|all|exclude, untagged; handled_by[] ai|human|mixed; risk_flag[] (AI-27 enum; AI-27 öncesi arayüzde gizli); channel; status closed|open|all.
prisma: threads.agent_ids uuid[] (oyuncuya yazan ajanlar, kapanışta, GIN), threads.risk_flags text[] (AI-27 yazar, GIN), ratings(license_id, thread_id) indeksi; geçmiş veri için toplu, sayfalı backfill betiği (ayrı migration).
api (archive-service filtre derleyicisi): tarih kiracı TZ'de [gün başı, ertesi gün başı) → UTC (localDayKey/ID-04); etiket any → EXISTS, all → GROUP BY HAVING COUNT = n, exclude → NOT EXISTS; puan thread'in son puanı (LATERAL); ajan agent_ids && $1; görünürlük WHERE'de. "AI çözdü" = handled_by='ai' — ADR-09a ile aynı yüklem, ortak fonksiyon (#293) (AR-02-S2).
KURALLAR: filtreler arası AND, filtre içi OR; popover'larda canlı sayı yok; tarih filtresi başlangıç zamanına göre (S1); kayıtlı filtreler kişisel, paylaşım linkle (S3).
web: features/archive/ArchiveFilters.tsx (çipler, popover'lar, tarih ‹ › kaydırma, bugünü geçmez); URL ↔ filtre dönüştürücüsü yalnız kimlikler (e-posta/ad YOK — GV-05; LiveChat dersi); çelişen filtreler ("atanmamış" + ajan) sessizce silinmez, uyarı; EÜ için ajan filtresi yalnız "ben".
PERFORMANS: tarih + ekip en sık; threads(license_id, created_at) ve chat_access(group_id); EXPLAIN kanıtı.

KABUL KRİTERLERİ:
- "Dün" kiracı TZ'de 00:00–23:59 başlayan konuşmalar; İstanbul 23:30 başlayan doğru güne düşer.
- "Hariç: spam" spam etiketlileri çıkarır.
- Aynı aralıkta "AI çözdü" sayısı AI raporuyla aynı.
- Filtreli URL başka tarayıcıda aynı liste.
- URL'de e-posta/ad yok.
- 20'den fazla etiket seçilemez.
- Çelişen filtrede uyarı.

KULLANILAN VARSAYIMLAR:
- AR-02-S1/S2/S3 varsayılanları.

**Test Strategy:**

URL dönüştürücü birim (kişisel veri yok), her filtre ve kombinasyon entegrasyon, e2e filtreli URL yeniden yükleme; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 336.1. AF-API [OPUS-HIGH] Arşiv filtreleri API: parametreler + dizi kolonları/GIN + geri doldurma + filtre derleyicisi

**Status:** pending  
**Dependencies:** None  

contract parametreleri + prisma (threads.agent_ids, threads.risk_flags GIN, ratings indeksi) + sayfalı geri doldurma (ayrı migration) + archive-service filtre derleyicisi (kiracı TZ gün sınırı, etiket any/all/exclude, LATERAL puan, görünürlük WHERE'de, handled_by #293 yüklemi) + PERFORMANS (EXPLAIN kanıtı). Ayrıntı ve kabul maddeleri: üst görev #336 details (tek kaynak).

### 336.2. AF-WEB [SONNET-HIGH] Arşiv filtre çubuğu: çipler, popover'lar, tarih kaydırma, URL ↔ filtre (yalnız kimlik)

**Status:** pending  
**Dependencies:** 336.1  

ArchiveFilters.tsx; URL ↔ filtre dönüştürücüsü yalnız kimlikler (GV-05); çelişen filtre uyarısı; EÜ için ajan filtresi "ben"; kayıtlı filtreler kişisel. Uçlar ve sözleşme önceki alt görevde bitti: `packages/contract` + üretilen tipler tek kaynak; sunucu davranışını kod haritasıyla bul (`trace_path`, `search_graph`), düzenleyeceğin dosyayı Read ile oku. Ayrıntı ve kabul maddeleri: üst görev #336 details (tek kaynak).
