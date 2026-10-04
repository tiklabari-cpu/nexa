# Task ID: 206

**Title:** F0-LASTGAP-b [OPUS-XHIGH] Sohbet yasam-dongusu denetim kaydi — 02.8'in dorduncu KK maddesi (FR-MOD-02.8)

**Status:** done

**Dependencies:** None

**Priority:** critical

**Description:** Faz-0'in acik kalan uc `Must ◐` kaleminden biri: bir sohbetin arsivlenmesi/yeniden acilmasi hicbir denetim satiri birakmiyor. Kapatilinca PLAN satir 297 `◐ → ✅` olur.

**Details:**

(a) GEREKCE + KANIT — bu gorev neden var:
PLAN.md satir 297: `| 02.8 | Archive (salt-okuma transcript) | Must (MVP) | ◐ → K02.8 |`.
Kanit blogu `#### K02.8` (PLAN.md ~7958-7962). tm 189.8 maddesi damganin NEDEN `◐` kaldigini
yaziyor: "'Denetim kaydi' (KK'nin DORDUNCU maddesi) HALA karsilanmiyor — `audit-log.ts`'in eylem
kataloğunda `chat.taken_over` DISINDA hicbir chat yasam-dongusu eylemi yok; `deactivate`/`resume`
hicbir zaman `writeAuditEntry` cagirmiyor (grep ile dogrulandi). Bu on var olan bir bosluk, bu turun
kapsami disinda birakildi (CONVENTIONS §5) — damga bu yuzden `◐` kaliyor, `✅` UYDURULMADI."
Bu tur (2026-09-07) iddiayi yeniden dogruladi: `apps/api/src/services/audit/audit-log.ts` katalogunda
`chat.taken_over` (satir 297) tek chat eylemi; `writeAuditEntry` cagiranlari `plugins/ai-residency.ts`,
`plugins/auth.ts`, `routes/account-lifecycle.ts` — chat-service YOK.
Ust kapi tablosu (PLAN.md satir 20) Faz-0 icin `48 ✅ · 3 ◐ · 0 ⬜`; bu kalem o ucten biridir
(digerleri: 02.3.5 -> tm 205, 03.2.3 -> tm 207). Faz-0 kapanis turu (GL-13, tm 208) bu ucu bekliyor.
NOT: bu gorev, otonom dongunun "secilebilir gorev kalmadi" ile durmasindan dogan onarim turunda
acildi — tm 189.8 bulguyu PLAN'a yazdi ama Task Master'a AKTARMADI, is grafikten dustu.

(b) DOKUNULACAK DOSYALAR (hepsi dogrulandi, satir numaralari bu turda okundu):
- `apps/api/src/services/audit/audit-log.ts` — eylem katalogu; `chat.taken_over` satir 297,
  cevresinde `ticket.*` ve `customer.banned/unbanned` var. Yeni chat eylemleri buraya eklenir.
- `apps/api/src/services/chat/chat-service.ts` — `deactivate` (satir 612) · `deactivateByTimeout`
  (satir 653) · `resume` (satir 969). Uc yolun ucu de bugun sessiz.
- `apps/api/src/plugins/audit.ts` — `auditContext` uretimi; satir 65'teki yorum kritik:
  "`writeAuditEntry` throws if neither holds, so a missing tenant fails".
- `apps/api/src/services/audit/audit-log-reader.ts` + `apps/api/src/routes/audit-log.ts` — okuma
  yuzeyi; yeni eylem tipleri burada filtrelenebilir/gorunur olmali.
- Test: `apps/api/src/services/audit/audit-log.test.ts` (birim) + integration `chats`/`copilot`
  testleri (arsivleme yollari orada zaten kurulu).

(c) CONTRACT-FIRST SIRA:
Denetim eylem tipi kontratta bir enum olarak yasiyorsa ONCE `packages/contract/openapi` ->
`pnpm contract:generate` -> `@siyahtus/types` -> backend+unit -> (varsa UI filtre secenegi) -> e2e.
Migration BEKLENMIYOR (audit_log satiri jenerik) ama `pnpm db:check-drift` yesil kalmali.
Yeni OpenAPI PATH ACMA (`apps/mobile` parite testi toplam path sayisini sabitliyor).

(d) BILINEN TUZAKLAR:
1. SISTEM AKTORU — `deactivateByTimeout` bir supurge yolu, insan aktoru YOK. `writeAuditEntry`
   principal/tenant yoksa FIRLATIR (plugins/audit.ts:65). Sistem eylemi icin nasil yazilacagina
   acikca karar ver (ayri bir sistem aktoru mu, actor=null destegi mi) ve gerekcesini K blokuna yaz.
   UYDURMA BIR KULLANICI YAZMA — denetim izinin butunlugu bu gorevin tum konusu.
2. METADATA DISIPLINI — katalogdaki mevcut yorumlar acik: `chat.taken_over` "never the transcript or
   any message content", `customer.banned` "no metadata ... deliberately not copied in". AYNI
   disiplini koru: chat id + aktor + onceki durum yeter; mesaj icerigi/transkript ASLA.
3. IDEMPOTENCY — zaten arsivlenmis bir sohbeti tekrar arsivlemek IKINCI satir yazmamali
   (`customer.banned` emsali: "repeating a ban that already holds ... leaves no second line").
4. Denetim yazimi cagiranin transaction'ini uzatmamali; mevcut cagiranlar `writeAuditEntry(tx, ...)`
   deseniyle ayni islemde yaziyor — bu deseni koru, HTTP/yan etki EKLEME.
5. Integration testi kosarken: `test:integration -- <ad>` FILTRELEMEZ; vitest'i
   `with-test-datastores.ts` uzerinden sur. Tam kapi icin `turbo run test:integration --concurrency=1`
   (paralellikte bir push testi timeout veriyor).
6. Docker ayakta olmali; `docker compose down -v` KULLANMA (proje kapsamli, `db`/`redis` volume'unu
   de dusurur) — `stop` + `rm -f -v <service>`.

(e) KAPSAM SINIRI — neye DOKUNULMAYACAK:
- 02.8'in diger UC KK maddesi (salt-okuma transcript · Reopen/Create ticket erisimi · arsivde Copilot
  ozeti) tm 189.8'de KAPANDI. Yeniden ele alinmaz, testleri bozulmaz — ozellikle
  `copilot.test.ts` "summarises an archived chat without writing to the read-only transcript"
  (olay sayacini assert ediyor) ve "still feeds the Assisted metric ... after archiving".
- Denetim izinin GENEL mimarisi (C6 / SIEM export / Faz-3 kurumsal yetki) DEGISTIRILMEZ; bu gorev
  yalnizca chat yasam-dongusu eylemlerini mevcut kataloğa ekler.
- `chat.taken_over` (08.6.3 / NFR-S12) mevcut davranisi degismez.
- 02.8 disindaki hicbir PLAN damgasina dokunma.

BITIRINCE: PLAN.md satir 297 `◐ → ✅`, `#### K02.8` blokuna kanit maddesi, ust tablo satir 20'nin
Faz-0 sayaci bir ✅ artirilir. Faz-0'in `❌ ACIK (yeniden)` damgasina DOKUNMA — o GL-13'un (tm 208) isi.

**Test Strategy:**

Tam DoD kapisi (CONVENTIONS §1), hepsi exit 0: `pnpm -w typecheck` · `lint` · `format:check` · `build` · `contract:generate` sonrasi tek beklenen diff · `pnpm db:check-drift` "no drift" · `pnpm audit:req-coverage` exit 0 ve `FR-MOD-02.8` site sayisi ARTMIS. Birim: `apps/api` `test:unit --force` taban uzerine yeni testler — `audit-log.test.ts` yeni eylem tiplerini taniyor. Integration (3 parca, `--concurrency=1`): bir sohbeti arsivlemek TAM BIR denetim satiri yaziyor (aktor + chat id + onceki durum, mesaj icerigi YOK) · `resume` kendi satirini yaziyor · `deactivateByTimeout` sistem yolundan FIRLATMADAN yaziyor · zaten arsivlenmis sohbeti tekrar arsivlemek IKINCI satir yazmiyor (idempotency) · cross-tenant negatifi: baska organizasyonun denetim satiri `GET /audit-log`ta gorunmuyor. Kabul kriteri OLCULEBILIR: FR-MOD-02.8'in dorduncu KK maddesi ("denetim kaydi") bir integration testiyle kanitlanir; testler yesilken PLAN satir 297 `✅`ye cevrilebilir.
