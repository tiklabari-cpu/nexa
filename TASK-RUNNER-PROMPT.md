# TASK-RUNNER-PROMPT — Tek Task, Temiz Pencere Protokolü

Sen TEK bir temiz Claude Code penceresisin. Görevin: Task Master'daki **tek bir hedef task'ı**
baştan sona tamamlamak, sonra çıkmak. Başka task'a GEÇME. Konuşma geçmişin YOK — bağlamı
aşağıdaki kalıcı kaynaklardan yeniden kur.

## 0) Bootstrap — bağlamı dosyalardan kur (hafızaya güvenme)

Sırayla oku:

1. `MASTER-PROMPT.md` — kilitli teknik kararlar, stack, contract-first akış, sınırlar.
2. `CONVENTIONS.md` — Definition of Done (DoD) kapısı, git kuralları, handoff formatı.
3. Task Master'dan HEDEF TASK'ı çek (get_task / show): başlık, detay, test stratejisi, kabul
   kriteri, bağımlılıklar, alt-görevler.
4. `PLAN.md` — **baştan sona OKUMA** (~1.4 MB / ~6.150 satır, bağlamı boşa harcar). Şu iki adımı yap:
   a. Task başlığındaki iş kalemi kimliğini (ör. `11.7-a`) `### Düz tablo (aktarım kaynağı)`
   bölümünde ara → `PRD` sütunu sana gereksinim kodunu verir (`11.7`). Eşleme burada
   yazılıdır, tahmin etme.
   b. O kodun gereksinim satır(lar)ını bul: `grep -n '| 11\.7' PLAN.md | cut -c1-200`. Senin
   hedefin **durum damgası (`⬜`/`◐`/`✅`) taşıyan** satırlar; Düz tablo / dilim tablosu
   satırları değil. Bir task birden çok satır kapatabilir (ör. `02.9-a` → hem `02.9` hem `11.8`).
   §3'te (kapanış) bu satırları güncelleyeceksin — şimdi yalnız yerlerini ve mevcut durumlarını not al.

   c. **Kanıt tabloda DEĞİL, `## K. Kanıt Geçmişi` bölümündedir.** Gereksinim satırı artık
   yalnız damga + referans taşır: `| 07.7 | … | Should | ★ | ✅ → K07.7 |`. O kalemin
   geçmişi lazımsa: `grep -n '^#### K07.7' PLAN.md` → bulduğun satırdan itibaren oku
   (`Read` ile dar `offset`/`limit`). Kanıt gerekmiyorsa **hiç açma** — damga yeter.

   ⚠ Bu düzen 2026-08-09'da kuruldu, sebebi ölçümdür: kanıt hücrede birikince satır 32.480
   karaktere çıkmıştı (tek başına ~10k token) ve çıplak bir `grep` pencerenin tur bütçesini
   yakıyordu — tm 65.8 tek satırı okuyabilmek için `sed`, `awk`, `grep -o`, `substr` sırayla
   denedi, hepsi boşa tur. Taşıma sonrası en uzun tablo satırı 526 karakter. **Bu kazancı
   koru: tablo hücresine kanıt YAZMA** (§3'e bak).

5. `git log --oneline -20` + `git status` — repo şu an nerede.
6. Task'ın dokunacağı mevcut dosyalar.

## 1) Resume kontrolü + durum damgası (yeniden deneme olabilir)

Bu task daha önce yarım kalmış olabilir. ÖNCE mevcut durumu tespit et: ilgili dosyalar/branch
var mı, testler ne durumda, `git status` ne diyor, `HANDOFF.md`'de bu task için not var mı.
**Sıfırdan yapma** — kaldığı yerden devam et veya hatayı düzelt.

`HANDOFF.md`'yi **tam okuma** (~1.3 MB, ~25 blok). Bloklar newest-first sıralı ve `## Task log`
başlığı 14. satırdadır — sana gereken yalnız en üstteki birkaç blok. Kalıp: `head -60 HANDOFF.md`
veya `Read(limit: 60)`. Daha eski bir işi arıyorsan tam metin yerine hedefli ara:
`grep -n 'tm <id>' HANDOFF.md | head -5` → dönen satır numarası çevresini dar bir aralıkla oku.

Tespit biter bitmez task'ı Task Master'da **in-progress** işaretle (CONVENTIONS §4). Bu adım
opsiyonel DEĞİL: pencere beklenmedik şekilde ölürse (kota bitti, çökme, elle durdurma) geride
"bu iş başlamıştı" izi kalmaz; görev `pending` göründüğü için hiçbir denetim onu yarım kalmış
saymaz ve sessizce kaybolur. Alt-görev üzerinde çalışıyorsan alt-görevi işaretle.

## 2) İşi baştan sona bitir — TEK sürekli akış (build → doğrulama → düzeltme → kapanış)

Bu, "önce yaz, sonra ayrı bir kontrol turunda bak" şeklinde iki ayrı faz **DEĞİLDİR**. Aşağıdaki
üç alt-adım aynı kesintisiz çalışmanın parçasıdır; aralarında doğal bir "durma noktası" yok —
kapanışa (§3) ulaşmadan pencereyi bitirme.

- **Build.** Task'ı MASTER-PROMPT'taki contract-first akışıyla uygula: sözleşme (OpenAPI +
  @nexa/types) → migration → backend + unit test → frontend + typed client → E2E. Task neyi
  kapsıyorsa onu; kapsam dışına ÇIKMA (başka task'ın işini yapma).
- **Doğrulama (OBJEKTİF kapı).** CONVENTIONS.md'deki DoD kapısını çalıştır ve **exit code'lara
  bak** (kendi kanaatine değil): typecheck, lint, unit, integration, build, ilgili smoke/E2E, ve
  task'ın kabul kriteri. Herhangi biri kırmızıysa geçme.
- **Düzeltme.** Kapı kırmızıysa düzelt ve yeniden doğrula; bu pencerede makul sayıda dene.
  Yeşile dönmüyorsa tahmine dayalı "herhalde oldu" DEME.

**Kapı komutlarını ARKA PLANA ATMA — pencereyi öldürür.** Test/build komutlarını daima ÖN PLANDA,
yeterli `timeout` ile çalıştır (tam suite ~10-15 dk → `timeout: 900000`). `run_in_background`
kullanırsan komut oturuma bağlıdır: sıranı bitirdiğin anda `-p` oturumu kapanır, arka plandaki
koşu da onunla birlikte ölür — sonuç bildirimi ASLA gelmez. "Bildirim bekleyeyim" diye sıranı
bitirmek = pencerenin sonu: kapanış (§3) hiç çalışmaz, JSON sonuç dönmez, döngü bunu `blocked`
sayar ve DURUR. (Görülen vaka: tm 93.3 — kod bitmişti, iki pencere de tam bu şekilde öldü.)

**DB testleri artık izole koşar (tm 105).** `@nexa/api` ve `@nexa/rtm`'in `test` /
`test:unit` / `test:integration` script'leri her koşuya KENDİ Postgres veritabanını
(`nexa_test_<id>`) ve KENDİ Redis mantıksal veritabanını (1-15) verir; koşu bitince ikisi de
silinir (`apps/api/scripts/with-test-datastores.ts`). Bu yüzden ne turbo'nun paralelliği ne
de aynı anda açık BAŞKA BİR PENCERE artık senin sonucunu kirletebilir — eskiden ikisi de
aynı `nexa` veritabanını TRUNCATE ettiği için kendi kodunla ilgisi olmayan yüzlerce kırmızı
üretiyordu. `--concurrency=1` gerekmez; `pnpm -w test` doğrudan çalışır.

Bunun pratik sonucu: **kırmızı gördüğünde artık "başka pencere yazıyordur" diye elle kök-neden
analizi yapma.** İzolasyon açıkken bir kırmızı ya senin değişikliğinden ya da HANDOFF/Task
Master'da zaten kayıtlı bilinen bir kusurdan gelir. Paylaşılan `nexa` veritabanına karşı
koşmak istersen (bir testin bıraktığı veriyi elle incelemek için) `NEXA_TEST_ISOLATION=off`.

İstisna: `apps/e2e` sabit portlarda gerçek sunucuları ve seed'lenmiş `nexa` veritabanını
kullanır — iki pencere aynı anda e2e koşamaz (port çakışması olarak gürültülü biçimde düşer).

**Tur/bütçe disiplini:** build kısmında iterasyona kilitlenip kalma. Kapanış (§3) — done da
olsa blocked de olsa — **opsiyonel değil, bu pencerenin zorunlu son adımıdır**. Elindeki tur
bütçesinin tamamını build'e harcayıp kapanışa hiç gelmeden pencereyi bitirmek en kötü sonuçtur
(kod yarım, Task Master yanlış durumda, HANDOFF/PLAN güncellenmemiş). Uzayan bir düzeltme
döngüsü fark edersen, kararı erken ver: ya yeşile çevir ya da `blocked` ilan edip §3'ün blocked
dalını çalıştırarak kapat — ama MUTLAKA kapat.

## 3) Kapanış

- **Kapı YEŞİL ise:** (sıra önemli — 1–2 dosya değişikliği, 3 onları commit'ler)
  1. **`PLAN.md`'yi güncelle — iki ayrı yer, karıştırma:**

     **(i) Tablo satırı — yalnız damga.** §0'da bulduğun gereksinim satır(lar)ının damgasını
     `⬜`/`◐` → `✅` yap. Hücrenin tamamı şu iki biçimden biri olmalı, başka hiçbir şey değil:
     `✅ → K<kod>` · `◐ → K<kod>`
     **Hücreye kanıt, dosya adı, test sayısı, tarih, açıklama YAZMA.** Kanıt hücrede birikince
     satır 32.000 karakteri aşıyor ve sonraki her pencerenin `grep`'ini zehirliyor — bu düzen
     tam olarak onu önlemek için kuruldu. Referansı olmayan bir satır kapatıyorsan `K<kod>`
     kodunu PRD kodundan türet (`07.7` → `K07.7`) ve (ii)'de bloğunu aç.

     **(ii) `## K. Kanıt Geçmişi` — kanıt buraya.** İlgili `#### K<kod>` bloğunu bul
     (`grep -n '^#### K07.7' PLAN.md`) ve **bloğun sonuna bir madde ekle**, mevcut biçimde:
     ``- ✅ <ne yapıldı> — `<dosya>` · test `<dosya>` (n) · tm <id>``
     Blok yoksa `## K.` bölümünün sonuna `#### K<kod> — <PRD kodu> · <kısa başlık>` diye aç.
     Var olan maddeleri SİLME, üstüne yazma — bu bir geçmiş kaydıdır, ekleyerek büyür.

     Task'ın kapattığı **her** satırı güncelle. Gereksinimi yalnız kısmen karşıladıysan `◐`
     bırak ve eksiği (ii)'deki maddeye yaz — kapanış uğruna `✅` UYDURMA.

  2. `HANDOFF.md`'ye kısa not ekle (CONVENTIONS formatı): ne yapıldı / varsayımlar / bir sonraki
     pencere için notlar. Ekleme noktası **`## Task log (newest-first)` başlığının hemen altı**;
     `Edit`'in `old_string`'i o başlık + bir sonraki bloğun ilk satırı olsun. Dosyayı yeniden
     okumana gerek yok (bu noktayı §1'de zaten gördün) ve blok **kısa** olsun — 4 madde yeter.
  3. `git add -A` → Conventional Commit (`feat(<alan>): ...` / `fix: ...`), CONVENTIONS'a uygun.
     PLAN.md ve HANDOFF.md düzenlemeleri **bu commit'in içinde** olmalı — ayrı commit'e bırakma,
     çalışma alanını kirli BIRAKMA.
  4. `git push` (task dalı → main; CONVENTIONS'taki branch kuralı).
  5. Task Master'da task'ı **done** işaretle (set-status done); alt-görevler bittiyse onları da.
  6. `git status` ile son kontrol: çalışma alanı temiz olmalı. Değilse kalan değişikliği ya
     commit'le ya da neden bırakıldığını HANDOFF'a yaz.
  7. Son çıktı olarak JSON döndür: `{"status":"done","task_id":"<id>","summary":"<1 cümle>"}`.
- **Kapı hâlâ KIRMIZI ise (düzeltemedin):**
  1. Bozuk kodu main'e MERGE ETME. İstersen WIP'i task dalına commit et.
  2. `HANDOFF.md`'ye BLOCKED notu: hangi adım, son hata mesajı, denenen çözümler.
  3. Task Master durumunu done YAPMA (blocked/review bırak).
  4. Son çıktı: `{"status":"blocked","task_id":"<id>","summary":"<neden bloke>"}`.

## Kurallar

- **Asla** ikinci bir task'a başlama. **Asla** kapı yeşil değilken done işaretleme.
- Tek orkestratör: subagent'a dağıtma; kendi araçlarınla çalış.
- Sınırlar (MASTER-PROMPT): production deploy/DNS/secret/kart yok, force-push yok, DB drop yok,
  başka repoya dokunma yok, referans .md/görselleri taşıma yok.
- En son mesajın MUTLAKA yukarıdaki JSON sonucu olsun (başka metin ekleme).
