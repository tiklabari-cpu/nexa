# Task ID: 126

**Title:** GL-9 · F3-KAPAT [OPUS-MAX] PRD §5.4 — Faz-3 §F.00 kapanış turu (§F.1 tam 10 madde + §F.2 final rapor)

**Status:** done

**Dependencies:** 125 ✓

**Priority:** high

**Description:** Faz-3'ün altı kalemi de teslim edildi (S11 · C4 · C6 · 11.5 · 08.5.8 ✅ · 13.7 ◐) ama §F.00 kapanış turu HİÇ koşulmadı: PLAN.md üst tablosunda Faz-3 hâlâ "⬜ planlandı, başlanmadı" damgası taşıyor. Bu görev §F.1'in 10 maddesini TAM sürüm koşarak Faz-3'ü kapatır ve — Faz-3 son faz olduğu için — §F.2'nin proje geneli FİNAL raporunu üretir.

**Details:**

GEREKÇE VE KANIT (bu görev bir denetim bulgusundan doğdu — run-loop seçilebilir görev bulamadı):

1. Task Master'da 124 görevin 124'ü ve 333 alt-görevin 333'ü `done`. Tek bir `pending`/`blocked`/
   `deferred` kayıt YOK, bağımlılık döngüsü YOK, var olmayan id'ye bağımlılık YOK. Kuyruk boş
   olduğu için otonom döngü duruyordu.
2. PLAN.md üst tablosundaki Faz-3 satırı (dosyanın ~23. satırı) hâlâ şunu diyor: "⬜ **planlandı,
   başlanmadı**" · kapanış sütunu "⬜ AÇIK". Bu BAYAT. §6.2'nin dilim tablosu (~2547-2554)
   beş dilimin de bittiğini gösteriyor: V3-1 `S11` (tm 81) + `C4` (tm 82) ✅ · V3-2 `C6` (tm 83) ✅ ·
   V3-3 `11.5` (tm 84) ✅ · V3-4 `08.5.8` (tm 79) ✅ · V3-5 `13.7` (tm 90) ◐ kabul.
3. §F.00'ın Faz-3 kapısı (PLAN ~4517): Faz-3'te `Must` YOKTUR (PRD §5.4 kalemlerinin hepsi
   `Should`/`Could`), bu yüzden sayaç kuralı yerine **kalem kuralı** geçerlidir —
   "beş kalem ✅ + `13.7` ◐ olduğunda Faz-3 kapanır". Kalem kuralı KARŞILANMIŞ GÖRÜNÜYOR;
   bu turun işi onu **sayarak doğrulamak** ve damgayı yazmaktır.
4. Bu, bu depoda daha önce ÜÇ KEZ olan hatanın dördüncü örneğidir. PLAN ~900'deki bulgu 3:
   "Task Master kuyruğu boş … Faz kapanış turları hiç görev olarak açılmamıştı → GL-3/GL-4."
   Emsaller: GL-3 F0-KAPAT (tm 87) · GL-4 V1-KAPAT (tm 88) · GL-8 V2-KAPAT (tm 114). Bu görev
   aynı işin Faz-3 sürümüdür; o üç görevin kapanış kayıtları biçim şablonudur.

YAPILACAK İŞ:

1. **SAYAÇ (§F.00).** Faz-3'ün §6 tablolarındaki 15 satırı **sayarak** üret — naif glif sayımı
   DEĞİL (§D68–§D77'de beş turluk yanlış-pozitif tarihçesi var). Beklenen dağılım: 6 açık kalem
   (5 ✅ + `13.7` ◐) · 2 v2'de karşılandı · 4 ⛔ · 2 ⛔-süreç · 1 faz değişikliği (08.9.6 → Faz 2).
   Sayı tutmuyorsa DAMGA YAZMA — önce farkı çöz.

2. **§F.1'in 10 MADDESİNİN TAMAMI, TAM SÜRÜM** (mini sürüm YETMEZ — §F.00 açıkça böyle diyor).
   Her madde **koda karşı** koşulur, PLAN'ın iddiasına karşı değil:
   (1) Kapsam süpürmesi — PRD §6'daki 138 `FR-MOD` satırı yeniden çıkarılır ve her biri kodda
       aranır; beklenen: her satır ✅ ya da gerekçeli ⛔/🔒.
   (2) Faz sızıntısı — sonraki fazdan öne çekilmiş iş var mı (§1.3'teki hatanın tekrarı).
   (3) NFR kapıları — §7.2'deki NFR'lerden Faz-3 kapsamına girenler ÖLÇÜLÜR, tahmin edilmez.
   (4) Şema artıkları — §8'deki her tablonun bir tüketicisi var mı.
   (5) Kontrat bütünlüğü — `contract-parity` testi koşulur (exit code kanıttır).
   (6) Sessiz borç taraması — `TODO`/`FIXME`/`XXX`/`@ts-expect-error`/`skip(`/`only(`/atlanan
       test/kapatılmış lint kuralı taranır ve LİSTELENİR.
   (7) Ölü kod & erişilemez ekran — route'u olmayan bileşen, çağrılmayan servis, UI'ı olmayan uç.
   (8) Doküman tazeliği — PLAN.md · HANDOFF.md · README.md gerçekle uyuşuyor mu (test sayıları,
       endpoint sayıları ve "sıradaki adım" bölümleri bayatlamaya en yatkın yerlerdir).
   (9) Temiz kurulum provası — sıfırdan migrate → seed → demo akışı.
   (10) Kapsam dışı doğrulaması — §9'daki 10 maddeden hiçbiri yanlışlıkla yapılmamış olmalı.

3. **DAMGALAR.** Üst tablo Faz-3 satırı → `✅ KAPALI` + sayaç · §F.00'ın Faz-3 kapı paragrafı →
   kapanış tarihi + sayaç + kanıt referansı · §2 Modül→Faz matrisinin Faz-3 satırları (tm 122
   tam olarak bu bayat damga desenini düzeltti — aynı hatayı yeniden üretme).

4. **TAŞINAN `Should` BORÇLARI İSMEN** (§F.00: "Sessizce düşemez"). `13.7` `◐` olarak kapanır ve
   gerekçesi İKİ PAYLIDIR (§D96 · §6.1.6): (a) mağaza payı — `.ipa`/`.apk` ve store yüklemesi
   yapılmadı; (b) modül paritesi daraltması — dört yüzey (Inbox/AI/CRM/Reports) teslim,
   Billing/Playbook/Team edilmedi. İkisi de KABUL EDİLEN BORÇ olarak kalır; kapanış uğruna `✅`
   UYDURULMAZ (TASK-RUNNER-PROMPT §3). Üçüncü borç olan handset kaydı **tm 125'te ödendi** —
   listede olmadığını ve `parity.test.ts`'in `OPEN_DEBTS` dizisinin 1 maddeye düştüğünü doğrula.
   (Bu görevin tm 125'e bağımlı olmasının gerekçesi budur: kapanış raporunun borç listesi ancak
   o iş bittikten sonra doğru olur. §F.00 "◐ kaldıramaz … tamamla, ya da kapsamı daralt +
   kalanı gerekçeli yeni kaleme ayır" der; tm 125 "tamamla" seçeneğidir.)

5. **§F.2 FİNAL RAPOR.** Faz-3 SON fazdır; kapandığı anda §F'nin tetikleyicisi ("§3–§6'daki tüm
   fazlar kapandığında ve başka planlı iş kalmadığında") gerçekleşir. Bu yüzden bu tur §F.2'nin
   proje geneli raporunu da üretir ve `HANDOFF.md`'ye yazar — altı başlık ayrı ayrı: tamamlanan
   kapsam (PRD kimlikleriyle, faz faz) · yarım kalan işler (PRD kimliği + neden + kalan iş
   tahmini) · bilinçli yapılmayanlar (⛔/🔒, gerekçesiyle) · sessiz borç (F.1/6 bulguları) ·
   sapmalar (§D'ye eklenen her yeni sapma) · karar bekleyen açık sorular (PRD §11.2 ile
   karşılaştırmalı).

BİLİNEN TUZAKLAR:
- ⚠ §F'nin kendi uyarısı: "Rapor 'tamamlandı' diyorsa, §F.1'in 10 maddesinin her biri FİİLEN
  çalıştırılmış olmalıdır." Bu projede denetimsiz "bitti" raporu bir kez zaten yanlış çıktı
  (§1.3: MVP'nin %30'u yazılmamıştı ama her dilim ✅ görünüyordu). Yeşil test kapsamın tam
  olduğunu göstermez — yalnız YAZILAN kodun çalıştığını gösterir.
- §D97 KOD / SÜREÇ AYRIMI kapının okunuşunu değiştirir: `C6` (SOC2/ISO) ve `C4` (HIPAA)
  kalemlerinde `✅` YALNIZ KOD PAYINI iddia eder. Sertifikasyon, dış denetim, Type II gözlem
  penceresi, ISO belgesi, gerçek BAA imzası ve gerçek çok-bölgeli barındırma görevleşmez ve bu
  kapıyı BLOKLAMAZ. "SOC 2 ✅" gibi yalan bir damga YAZMA.
- `format:check` deponun genelinde KIRMIZI (13 dosya; tm 90.11 notu) ve CONVENTIONS §1'in
  listesinde yok ama CI'da zorunlu. §F.1/6 (sessiz borç) tam olarak bu tip borcu arar: ya
  formatla (yalnız formatlama, davranış değişikliği yok) ya §D'ye gerekçesiyle yaz —
  SESSİZCE BIRAKMA.
- §F.1/6 ve diğer maddelerin bulguları için üç seçenek vardır, dördüncüsü YOKTUR: düzeltilir ·
  yeni görev olarak plana girer · gerekçesiyle §D'ye yazılır.
- Kanıt metni TABLOYA yazılmaz: gereksinim satırı yalnız damga + `→ K...` referansı taşır,
  metin `## K. Kanıt Geçmişi` altındaki bloğa gider (CONVENTIONS §1.2).
- PLAN.md ~770 KB / ~5900 satır — BAŞTAN SONA OKUMA. Hedef satırı `grep -n` ile bul ve
  çevresindeki ~30 satırı oku.
- `pnpm -w test:integration` turbo paralelliğinde bir push testini zaman aşımına uğratıyor;
  `turbo run test:integration --concurrency=1` ile seri koş. `test:e2e` ~9-10 dk sürer ve
  `apps/e2e/kanit/` altında bayt düzeyinde PNG churn'ü üretir (görsel fark yok) — bu turda yeni
  kanıt görseli üretilmiyorsa churn geri alınır.

KAPSAM SINIRI (neye DOKUNULMAYACAK):
- Bu tur KOD YAZMAZ. Bulduğu kusurlar düzeltme değil YENİ GÖREV konusudur (§F.3: yarım kalan
  işlerden hangilerinin yapılacağını kullanıcı seçer). İstisna: §F.1/8'in gerektirdiği doküman
  tazeliği düzeltmeleri ve varsa saf formatlama.
- Faz-0 / v1 / v2 damgalarına DOKUNMA — üçü de kapalı ve kanıtlı (tm 87 · tm 88 · tm 114).
- Production deploy / DNS / TLS / gerçek secret / sertifikasyon süreci / gerçek BAA YOK
  (CLAUDE.md sınırları).
- Yeni özellik, refactor, bağımlılık yükseltmesi YOK.

**Test Strategy:**

CONVENTIONS §1 DoD kapısının TAMAMI exit 0 + kapanışın kendi ölçülebilir kabulü.

A. Kapı (GL-8'in / tm 114'ün kanıt biçiminin aynısı, SAYILARLA raporlanır):
   pnpm -w typecheck && pnpm -w lint && pnpm -w test && pnpm -w test:integration && pnpm -w build && pnpm -w test:e2e && pnpm -w db:check-drift
   (`test:integration` içinde `contract-parity` yeşil olmalı — §F.1/5'in kanıtı budur.
    Integration kapısı turbo paralelliğinde bir push testini zaman aşımına uğratabiliyor:
    `turbo run test:integration --concurrency=1` ile seri koş.)

B. Kapanışın kabulü (dosyaya bakılarak doğrulanır — "koştum" demek yetmez):
   1. `PLAN.md` üst tablosundaki Faz-3 satırı `✅ KAPALI` + SAYILARAK üretilmiş sayaç taşır.
   2. `PLAN.md` §F.00'ın "Faz-3 (Enterprise) kapısı" paragrafı kapanış tarihi + sayaç + kanıt
      referansı taşır; "2026-08-11 itibarıyla AÇIK — planlandı, başlanmadı" ifadesi KALKMIŞTIR.
   3. `HANDOFF.md`'de §F.1'in 10 maddesinin HER BİRİ için ayrı bir kanıt satırı vardır
      (komut · çıktı · dosya/route listesi). Madde başına kanıt yoksa tur BİTMEMİŞTİR.
   4. `HANDOFF.md`'de §F.2 raporu altı başlığın ALTISINI da içerir: tamamlanan kapsam · yarım
      kalanlar · bilinçli yapılmayanlar · sessiz borç · sapmalar · karar bekleyen açık sorular.
   5. Taşınan `Should` borçları İSMEN listelidir (§D96'nın mağaza payı + modül paritesi payı);
      tm 125'te ödenen handset kaydı borcu bu listede YOKTUR.
