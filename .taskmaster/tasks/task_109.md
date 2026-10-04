# Task ID: 109

**Title:** e2e-seed-pollution — `db:seed` idempotent, TRUNCATE etmiyor: paylaşılan `siyahtus`'da e2e koşuları birikip customers/command-palette testlerini düşürüyor

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** `apps/e2e/tests/global-setup.ts` her koşudan önce `pnpm db:seed` çağırıyor ve yorumu "Every run starts from the same fixture" diyor — ama seed IDEMPOTENT: var olan tenant'ı görünce hiçbir şey silmiyor. Her e2e koşusu paylaşılan `siyahtus` veritabanına yeni müşteri + sohbet bırakıyor, birikim seed'lenmiş Alex/Mira/Robin'i müşteri listesinin ilk sayfasından taşırıyor ve bu testler düşüyor. Aynı testler sıfırdan migrate edilmiş izole bir DB'de yeşil.

**Details:**

BULUNDUĞU TUR: tm 106 (widget send yarışı düzeltilirken). Kusur tm 106'nın değişikliğinden BAĞIMSIZ ve ondan ÖNCE de vardı — tm 97.8 kapanışı da "paylaşılan DB'de state kirliliğiyle birlikte customers.spec.ts:12/51/68" diye kaydetmişti, ama nedeni o zaman teşhis edilmemişti.

KANIT (tm 106 turunda ölçüldü):
- Paylaşılan `siyahtus`'ya karşı alt küme koşusu: `customers.spec.ts:12/51/68` + `command-palette.spec.ts:15` kırmızı. Playwright hata bağlamı `waiting for getByRole('button', { name: /Mira Haddad/ })` diyor — yani seed'lenmiş müşteri listede YOK, silinmiş değil, sayfanın dışına taşmış.
- Sıfırdan `CREATE DATABASE siyahtus_e2e106` + `prisma migrate deploy` yapılmış izole DB'de AYNI testler ve TAM SÜİT **87/87 yeşil**.
- Kök neden `apps/api/prisma/seed.ts` + `apps/e2e/tests/global-setup.ts`: global-setup yalnız çıktıda `Acme Bikes` arıyor; seed tenant'ı bulunca sessizce çıkıyor, hiçbir tabloyu TRUNCATE etmiyor. Widget e2e testlerinin her biri saklı `customer_id` olmadan token mint ettiği için her koşu YENİ müşteri yaratıyor — birikim doğrusal.

ÇÖZÜM YÖNLERİ (karar bu görevde verilecek):
1. `global-setup.ts` seed'den ÖNCE reset etsin (`prisma migrate reset --force` ya da hedefli TRUNCATE). Dikkat: MASTER-PROMPT "DB drop YOK" sınırı — `siyahtus` geliştirme veritabanı; `migrate reset` yerine seed'in kendi TRUNCATE'i tercih edilebilir.
2. e2e'yi tm 105'in izolasyon harness'ına bağla (`apps/api/scripts/test-datastores.ts`): koşu başına kendi DB'si. DİKKAT: e2e sabit portlarda gerçek sunucular sürüyor ve `REDIS_URL`'e index eklemek RTM/API pub-sub'ını ayırır — HANDOFF'ta kayıtlı tuzak.
3. `global-setup.ts`'in yanlış yorumunu düzelt (hangi çözüm seçilirse seçilsin): bugünkü hali okuyanı "her koşu temiz başlar" diye yanıltıyor ve bu yanlış teşhise yol açtı.

YAN NOT: `apps/e2e/playwright.config.ts` `workers: 1` + `fullyParallel: false` zaten süit içi sırayı garanti ediyor; sorun süit İÇİ değil, koşular ARASI birikim.

**Test Strategy:**

Kabul kriteri: paylaşılan `siyahtus` veritabanına karşı, art arda İKİ tam e2e koşusu da 87/87 yeşil vermeli (bugün ikinci koşu birikim yüzünden düşüyor). Doğrulama: `pnpm -w test:e2e` iki kez üst üste; ayrıca üçüncü bir koşudan önce `SELECT count(*) FROM customers` sayısının koşular arasında büyümediği (ya da testlerin buna duyarsız olduğu) gösterilmeli.
