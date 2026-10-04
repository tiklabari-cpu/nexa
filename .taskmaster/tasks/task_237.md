# Task ID: 237

**Title:** V8-BULK-ACTIONS [OPUS-XHIGH] ticket/chat toplu eylemleri — PRD §5.2 v1 Ticketing satirinda adi geciyor, depoda hicbir izi yok

**Status:** done

**Dependencies:** 209 ✓

**Priority:** medium

**Description:** PRD §5.2'nin "Ticketing (gelismis)" satiri v1 kapsamina alti sey yaziyor; besi FR-MOD satirina sahip ve teslim/gorevli, altincisi "bulk actions" hicbir FR-MOD satirina sahip degil, PLAN'da satiri yok ve kodda tek yuzeyi yok. Depodaki tek "bulk" knowledge-source CSV import'udur (06.3.2'nin v2 payi), ticket/chat toplu eylemi degil. GL-14 (tm 209) buldu ve karara bagladi.

**Details:**

(a) GEREKCE + KANIT (karar tm 209 · GL-14 · PLAN §D156):
PRD satir 393 (§5.2 kapsam tablosu): _"Ticketing (gelismis) | Ticket rules, custom fields,
saved views, **bulk actions**, email templates, Forms builder"_. Alti payin besi izlenebilir:
  - Ticket rules -> `FR-MOD-08.6.2` ✅
  - custom fields -> `FR-MOD-08.7.6` ✅
  - saved views  -> `FR-MOD-02.1.4` ◐ (tm 218)
  - email templates -> `FR-MOD-08.7.5` ◐ (tm 227)
  - Forms builder -> `FR-MOD-08.7.7` ◐ (tm 228)
Altinci pay (**bulk actions**) icin PRD §6'da satir YOK — `FR-MOD-02` bloğunun 19 satiri
(02.1.1–02.9) tarandi, toplu eylem gecmiyor. Olculdu (2026-09-07, GL-14 §F.1/1):
  - `grep -rniE "bulk" apps/web/src` -> **yalniz** `features/playbook/` (BulkImportForm,
    BulkImportResults, bulk-file, bulk-template) = knowledge kaynagi CSV/toplu ice aktarma.
  - `grep -rn "bulk" packages/contract/openapi/paths/*.yaml` -> **yalniz**
    `playbook.yaml` `bulkImportKnowledgeSources`.
  - `apps/web/src/features/inbox/` icinde secim/`selectedIds` deseni **yok**; Tickets grid
    (`FR-MOD-02.7`) satir bazli, coklu secim tasimiyor.
  - `rapor-1-fonksiyonel.md` icinde "bulk action"/"toplu eylem" **0 eslesme**.
Yani bu da tm 236 ile ayni ailedendir: PRD'nin faz ozeti adini koymus, PRD'nin FR katalogu
satirini hic acmamis, dolayisiyla PLAN da acmamis.

NEDEN v1 KAPISINI BLOKLAMADI: §F.00'in sayaci §4'un `Must (v1)` DAMGALI satirlarini sayar;
FR-MOD satiri olmayan bir kalem damga tasiyamaz. GL-14 kapiyi `20 ✅ · 0 ◐ · 0 ⬜` ile kapatti
ve bu kalemi ismen kayda gecirdi (§F.00'in "sessizce dusemez" sarti). Kapanis karari degismez.

(b) YAPILACAK IS — ONCE TRIYAJ, SONRA (gerekiyorsa) KOD:
1. **Triyaj (kod yazmadan).** "bulk actions" PRD'de tanimSIZ: hangi kaynak (ticket mi chat mi
   ikisi de), hangi eylem (ata / etiketle / oncelik / kapat / arsivle), hangi secim modeli
   (sayfa ici mi "tumu esles" mi). Karar: (i) turetilmis bir `FR-MOD-02.x` satiri acilip
   yapilacak mi, (ii) `⛔` gerekce ile mi kapanacak (ornek: kapsam tanimsiz — `08.6.2` ticket
   rules ayni ihtiyaci OTOMATIK karsiliyor, elle toplu eylem ayri bir urun karari), yoksa
   (iii) v2'ye mi atanacak. Emsal: §5.5 MOD-04/MOD-06'nin `⛔ Somut FR-MOD satiri yok, kapsam
   tanimsiz -> ayri kalem acilmadi` karari (§C-A12/§C-A13) — AYNI sekil, ayni gerekce turu.
2. **Kod yolu secilirse** iki sinir onceden bilinir:
   - **Tenant + scope**: toplu bir yazma da satir satir ayni RLS/`TenantScopedRepository`
     yolundan gecer; "hizli olsun" diye ham SQL ile atlanmaz (NFR-S4/S5 negatifleri kirmizi verir).
   - **NFR-P2 butcesi**: N kayitlik bir islem tek istekte N sorgu ACMAZ; `03.2.3`'un emsali
     (tm 207, sayfa basina iki toplu sorgu) izlenir. Ust sinir + kismi basari raporu tanimlanir.
3. Audit: her toplu eylem denetim kaydi uretmeli (`02.8`'in `chat.archived` emsali) — toplu
   olmasi tek bir ozet satirina indirgemeyi HAKLI CIKARMAZ; karar triyajda verilir.

(c) OLCULEBILIR KAPANIS: triyaj yolu (ii)/(iii) secilirse cikti PLAN satiri/gerekce + `#### K`
blogu (kod yok). Yol (i) secilirse: kontrat + api entegrasyon testi (cross-tenant negatifi dahil)
+ web birim testi (secim modeli, kismi basari) + bir e2e adimi + denetim kaydi testi.

(d) BILINEN TUZAKLAR:
1. **"bulk" kelimesi depoda ZATEN var ama baska seye ait** — `06.3.2`'nin knowledge CSV/toplu
   ice aktarmasi (v2 payi, tm 97.x). Onu bu kalemin karsiligi SAYMA; PRD'nin Ticketing satiri
   ile Knowledge satiri ayri satirlardir.
2. **Damga UYDURMA** — bugun bu kalemin PLAN'da satiri yok, cevrilecek hucre de yok.
3. `02.7` (Tickets grid) `Should (v1)` ✅'dir ve KK'si siralanabilir tablo + deep-link'tir;
   toplu secim onun KK'sinde YOK — o satirin damgasi bu gorevle degismez.
4. `apps/mobile` parite testi kontrattaki uc sayisini birebir pinliyor.

(e) KAPSAM SINIRI: v1'in `Must` sayaci ve Faz-1 kapanis damgasi (GL-14 · tm 209) DEGISMEZ.
Bu gorev yeni bir kapanis turu ACMAZ. `edit-after-send` ayni ailedendir ama AYRI gorevdir (tm 236).

**Test Strategy:**

Triyaj yolu secilirse: cikti PLAN.md'de bir satir (ya da §C-A12/§C-A13 sekilli gerekceli `⛔`) + `#### K` blogu; DoD kapisi yine exit 0 kosulur, karar HANDOFF'a yazilir. Kod yolu secilirse: (1) `contract:generate` sonrasi generated diff bos + `contract-parity` yesil; (2) api entegrasyon testi — toplu eylem yalniz cagiranin kiracisinin satirlarina dokunuyor (cross-tenant NEGATIF testi), yetkisiz scope 403, kismi basarida basarisiz satirlar raporlaniyor ve basarililar geri alinmiyor (ya da tersi: hepsi-ya-hicbiri, hangisi secildiyse test onu pinler); (3) denetim kaydi testi — her etkilenen kayit icin beklenen audit satiri; (4) web birim testi — secim modeli + ust sinir; (5) e2e: coklu secim -> eylem -> listede sonuc. Tam DoD kapisi exit 0.
