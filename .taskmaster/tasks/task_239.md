# Task ID: 239

**Title:** V8-NFR-P6 [OPUS-MAX] Transkript sayfalamasi sabit-zaman degil — ifade imleci indekssiz, partition pruning yok

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** PLAN §7.2 `P4/P6` satiri `◐ → KP4` kaliyor. tm 212 triyaji PRD NFR-P6'nin uc parcasindan ikisini (aylik RANGE partition + cursor pagination) yerinde buldu, hedefi olan ucuncusunu — "sabit-zaman" — TUTMUYOR buldu: transkript sorgusu `(split_part(id,'_',2))::bigint` IFADESIYLE hem suzuyor hem siraliyor, bu ifadeye uyan indeks yok, ve sorguda `created_at` yuklemi olmadigi icin `PARTITION BY RANGE` pruning de yapmiyor.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1; git akisi §2; handoff bicimi §3. Sinirlar `CLAUDE.md`.
Migration politikasi ZORUNLU okuma: `CONVENTIONS.md` §6.3 (genislet -> tasi -> daralt) ve
ozellikle "uzun kilit" kurali — `CREATE INDEX CONCURRENTLY` bu depoda KULLANILABILIR ama
yalniz migration dosyasindaki TEK ifade oldugunda (yanina ikinci ifade konursa Postgres
`25001 — cannot run inside a transaction block` ile duser). Yani es zamanli indeks kendi
migration dosyasini alir.
PLAN satiri: §7.2 `| P4/P6 |` (`grep -n '^| P4/P6' PLAN.md`) · kanit blogu `#### KP4`
(`grep -n '^#### KP4' PLAN.md`). PLAN.md ~2,3 MB — BASTAN SONA OKUMA.

(a) OLCULEN BULGU (tm 212 · 2026-09-07 · yeniden olcme, uzerine kur):
PRD `urun-gereksinim-dokumani-PRD.md`:747 → `NFR-P6 | DB buyuk liste sorgulari |
\`events\` aylik RANGE partition + kompozit indeks + cursor pagination -> sabit-zaman`.
- `apps/api/src/services/chat/chat-service.ts:267-270` (transkript sayfasi):
    WHERE thread_id = $1
      AND (split_part(id, '_', 2))::bigint > $2
      [AND (split_part(id, '_', 2))::bigint < $3]
    ORDER BY (split_part(id, '_', 2))::bigint ASC|DESC
    LIMIT $n
- `events` uzerindeki indeksler (`apps/api/prisma/schema.prisma`, `model Event`):
  `@@id([id, createdAt])` · `@@index([threadId, createdAt])` · `@@index([chatId, createdAt])` ·
  `@@index([licenseId, createdAt])` · GIN `idx_events_properties`. Ifadeye uyan indeks YOK.
- `events` `PARTITION BY RANGE ("created_at")` — migration
  `20260722154008_domain_model/migration.sql:81`. Sorguda `created_at` yuklemi YOK, dolayisiyla
  her aylik partition yoklaniyor.
Sonuc: sayfa maliyeti thread'in TOPLAM olay sayisiyla ve partition sayisiyla buyuyor; PRD'nin
"sabit-zaman" hedefi tutmuyor. Denetim (`prd-uyum-denetimi.md` Ek A `NFR-P6`, KISMI ↓) ayni seyi
soyluyor ve "gosterilen testler onu korumuyor" diye ekliyor — denetim metni `…` ile kesiktir,
olcut PRD satiri + kodudur.

(b) DIKKAT — ifadenin VAR OLMA SEBEBI mesrudur, silme:
`chat-service.ts`in kendi yorumu gerekcesini yaziyor: sira id'nin ICINDE yasiyor, cunku birden
cok olay ayni milisaniyeyi paylasabilir ve `created_at` ile siralamak "next" tanimini
belirsizlestirir. Yani cozum "timestamp'e don" DEGILDIR. En az uc secenek var, karar bu gorevin:
  1. IFADE INDEKSI — `CREATE INDEX CONCURRENTLY ... ON events (thread_id, (split_part(id,'_',2)::bigint))`.
     Partitionli tabloda indeks yaratmanin kendine ozgu kurallari var (Postgres partitionli
     tabloda `CONCURRENTLY` desteklemez; partition partition yaratip `ATTACH` etmek gerekir) —
     bunu ONCE dogrula, varsayma.
  2. GERCEK KOLON — `events.sequence BIGINT` (genislet -> geri doldur -> daralt, §6.3); imleci
     kolondan sur, id'yi bozma. Migration'i once `with-test-datastores.ts` ile bir atilabilir
     veritabaninda prova et.
  3. `created_at` YUKLEMI EKLE — imlecin isaret ettigi olayin `created_at`ini de tasiyip
     sorguya bir alt/ust sinir koymak pruning'i acar; sirayi hala ifade belirler. En ucuzu
     olabilir ama ilk sayfayi (imlecsiz) cozmez.
Hangisi secilirse secilsin PLAN §C'ye `Assumption:` olarak degil, `#### KP4` blogua gerekce
olarak yazilir.

(c) KABUL — "olctum" demek icin gereken:
Yeni bir mikro-olcum (repo icinde, k6 DEGIL): tohumlanmis bir thread'in olay sayisi 10x
artirildiginda sayfa suresi/plan maliyeti SABIT kaliyor mu. `EXPLAIN (ANALYZE, BUFFERS)`
ciktisi ONCE ve SONRA kaydedilir (`Seq Scan`/`Sort` kaybolmali, `Index Scan` gorulmeli,
`Partitions removed` sayilmali). Olcum yoksa damga `◐` kalir — §D122'nin dersi.

(d) KAPSAM SINIRI:
- Yalniz NFR-P6. `NFR-P4`un "60 fps" ayagi AYRI gorevdir (tm 240) — ayni PLAN satirini
  paylasiyorlar ama ayni is degiller.
- Kontrat degismez (sayfalama sozlesmesi ayni), API cevabi degismez.

(e) KAPANIS: §7.2 `P4/P6` satiri ancak tm 240 DA bittiginde `✅` olur; bu gorev kendi ayagini
`#### KP4` blogua append eder ve satiri `◐` birakir (§D129'un kurali: `◐` + acik gorev VAR).
commit + push + Task Master `done`.

**Test Strategy:**

Olcut: (1) `EXPLAIN (ANALYZE, BUFFERS)` transkript sorgusu icin `Index Scan` gosteriyor ve `Sort` dugumu yok; (2) partition pruning fiilen olculuyor ("Partitions removed" > 0 ya da esdegeri) ya da neden olamayacagi gerekceyle yaziliyor; (3) thread olay sayisi 10x buyudugunde sayfa maliyeti sabit kaliyor — once/sonra plan ciktilari `#### KP4`ye yazilir; (4) mevcut transkript testleri (`apps/api/test/integration` altindaki chat/transcript suitleri) degismeden yesil — sozlesme ve sira degismedi; (5) migration eklendiyse `pnpm -w db:check-drift` exit 0 ve `CONVENTIONS §6.3` prova adimi kosuldu; (6) tam DoD kapisi (CONVENTIONS §1) exit code'lariyla.
