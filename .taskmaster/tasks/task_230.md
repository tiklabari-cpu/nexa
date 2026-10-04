# Task ID: 230

**Title:** V8-INVOICE [OPUS-MAX] Kalici fatura gecmisi — Invoice modeli yok, gecmis bugunku fiyatla turetiliyor (FR-MOD-10.3)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** schema.prisma'da Invoice modeli HIC YOK. Fatura gecmisi okuma aninda turetiliyor ve gecmis donemleri BUGUNKU abonelik satirindan fiyatliyor: plan degisince gecmis faturalar geriye donuk degisiyor. Sessiz bir dogruluk hatasi.

**Details:**

PENCERE PROTOKOLU: `TASK-RUNNER-PROMPT.md` (bootstrap -> build -> dogrulama -> kapanis).
DoD kapisi `CONVENTIONS.md` §1; git akisi §2; handoff bicimi §4. Sinirlar `CLAUDE.md`.
Bu gorev PLAN.md §6D (FAZ 8 — Kalan Gereksinim Borclari, §D149) kaleminin Task Master karsiligidir.
DIKKAT: PLAN.md ~2,3 MB — BASTAN SONA OKUMA. Hedef satiri `grep -n` ile bul, cevresindeki ~30
satiri oku. Kanit metni tablo hucresinde DEGIL, `## K. Kanit Gecmisi` altindaki `#### K<kod>`
blogundadir (CONVENTIONS §1.2) — ve gecerli olan blogun SON maddesidir, ortadaki `◐` glifleri
tarihcedir.
KAYITLI KARAR ARAMASI (§D149un dersi): damgayi degistirmeden once `grep -n "D1[0-9][0-9] (" PLAN.md`
ile ilgili kodu ara ve `git log --oneline --since=2026-08-30` ile denetimden SONRA is yapilmis mi bak.
NUMARALANDIRMA: bu faz **8**dir — `Faz-7` §7Cnindir (tm 175-184). Onek `V8-`, `V7-` KULLANMA.

(a) GEREKCE + KANIT:
PRD `:682`: "Invoices (fatura gecmisi) + Payment details yonetimi" · KK: "Fatura listesi/INDIRME;
odeme yontemi guncelleme".
`grep -n "model Invoice" apps/api/prisma/schema.prisma` -> SIFIR (bu turda olculdu). Semada yalniz
`PaymentMethod` · `Subscription` · `UsageRecord` · `ApiPackagePurchase` var.
`#### K10.3` (PLAN.md ~6258) denetim maddesi birebir: "'Fatura gecmisi' kalici DEGIL, okuma aninda
TURETILIYOR ve gecmis donemleri BUGUNKU abonelik satirindan fiyatliyor. schema.prisma'da Invoice
modeli hic yok ... ve Subscription tek satir olup y[eniden yaziliyor]…". PLAN satiri 667,
`Should (v1)`.
Mevcut okuma yolu: `apps/api/src/services/billing/invoice-service.ts` + `routes/reports.ts`
(`/billing/invoices`). `PaymentProvider` dikisi (M-PROV-a · tm 131.2) VAR ve KORUNUR.

(b) DOKUNULACAK DOSYALAR:
- `apps/api/prisma/schema.prisma` + YENI migration — `invoices` (+ gerekiyorsa `invoice_line_items`):
  donem baslangic/bitis · para birimi · tutar · kalemler · durum · olusturma damgasi. Degerler
  DONDURULUR (yazildigi andaki fiyat).
- `apps/api/src/services/billing/invoice-service.ts` — okuma tabloya doner.
- Donem kapanisinda yazan sweep: EMSAL `services/*/*-run.ts` CLI girisleri + Redis lider kilidi
  (`M-SCHED` deseni, tm 113/Faz-4). `package.json`a bir `*:run` girisi eklenirse
  `audit:dead-code`in "tuketicisiz servis" listesi buyur — bu BEKLENEN, gerekcesi yazilir.
- `apps/web/src/features/billing/` — liste + INDIRME yolu.
- `apps/mobile` salt-okur Billing yuzeyi (13.7-o) ayni sozlugu okur.

(c) CONTRACT-FIRST SIRA: sozlesme (`/billing/invoices` yanit semasi) -> migration -> backend +
integration -> `contract:generate` -> web + unit -> mobil parite -> e2e.

(d) BILINEN TUZAKLAR — BU GOREVIN ASIL KANITI GERIYE DONUKLUKTUR:
- Testin merkezi sudur: PLAN DEGISTIKTEN SONRA gecmis faturalar DEGISMEMELI. Bunu kanitlamayan
  bir tur bu gorevi KAPATMAZ.
- GECMIS VERI: bugun turetilen faturalarin karsiligi tabloda YOK. Backfill yapilacak mi, yoksa
  tablo yalniz ileriye mi calisacak — karar gorev icinde verilir ve `#### K10.3`e YAZILIR.
  Backfill yapilirsa BUGUNKU fiyatla yazmak ayni hatayi kalicilastirir; gerekcesini yaz.
- `ApiPackagePurchase` satir kalemi (tm 71.5 · `09.3-e`) KORUNUR — yeni tabloya taşınırken
  kaybolmamali.
- ODEME/KART AKISI KAPSAM DISI (CLAUDE.md siniri: gercek kart/odeme YOK). `PaymentProvider`
  mock dikisi DEGISMEZ.
- `db:check-drift` migration sonrasi "no drift" demeli; shadow DB gerektiren SQL uretimi icin
  Prisma uzerinden ilerle.
- RLS: `invoices` lisans kapsamli olmali ve politika YAZILMALI (cross-tenant negatif ZORUNLU).

(e) KAPSAM SINIRI: gercek odeme saglayicisi ACILMAZ · kart formu/PCI yuzeyi DEGISMEZ (C5/S9
maskeleme korunur) · abonelik plan degistirme akisi DEGISMEZ · kullanim sayaclari
(`UsageRecord`) DEGISMEZ.
(f) KAPANIS: DoD kapisi yesil -> commit + push (Conventional Commit; PLAN.md satir damgasi
`◐ → ✅` + `#### K<kod>` bloguna kanit maddesi + HANDOFF.md girisi AYNI commite girer) ->
Task Master `done`. Calisma alanini kirli BIRAKMA.

**Test Strategy:**

Tam DoD kapisi exit 0, `contract:generate` sonrasi beklenmeyen diff YOK, `db:check-drift` "no drift" · `audit:req-coverage` exit 0 ve `FR-MOD-10.3` site sayisi ARTMIS. Integration — ASIL KANIT: (1) fatura yazildiktan SONRA abonelik plani/fiyati degistirilir ve GECMIS FATURA DEGISMEZ (tutar, para birimi, kalemler aynen kalir) — bu test gecmeden gorev kapanmaz; (2) donem kapanisi sweep'i idempotent (iki kez kosunca ikinci fatura YAZMAZ); (3) `ApiPackagePurchase` satir kalemi faturada gorunuyor (tm 71.5 regresyonu); (4) CROSS-TENANT: A lisansinin faturasi B'ye ASLA gorunmuyor, RLS politikasi testli (ZORUNLU); (5) indirme yolu dogru icerik tipi ve icerigi donuyor. Web unit + `apps/mobile` parite testi yesil. e2e: fatura listesi + indirme (kanit PNG). Backfill karari `#### K10.3`e yazili.
