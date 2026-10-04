# Task ID: 105

**Title:** apps/api integration testleri: paylaşılan yerel Postgres/Redis eşzamanlı pencere çakışması

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Otonom döngüde birden fazla temiz pencere aynı anda çalışırken (tm 97.6 kapanışında gözlemlendi), hepsi aynı yerel docker Postgres/Redis'e (siyahtus-db:5433, siyahtus-redis:6380) karşı `apps/api` integration testlerini koşuyor. CONVENTIONS.md zaten tek-turbo-içi paralelliği (@siyahtus/api + @siyahtus/rtm) uyarıyor ama bu, SÜREÇLER ARASI (ayrı pencere/oturum) çakışma — kapsam dışı kaldığı için hiç belgelenmemişti.

**Details:**

Gözlem (tm 97.6 kapanışı, 2026-08-09): `npx turbo run test --filter=@siyahtus/api --concurrency=1` art arda iki koşuda 889 → 982 (2008 testten) farklı kırmızı sayısı verdi — deterministik değil. Kök neden kanıtları:
- `pg_stat_activity`'de yarım kalmış `idle in transaction` bağlantı bulundu (muhtemelen daha önce ölmüş bir pencereden kalma, TASK-RUNNER-PROMPT §2'nin uyardığı senaryo).
- Bağlantıları `pg_terminate_backend` ile temizledikten SONRA bile kırmızı sayısı düşmedi (889→982), yani sorun yalnız eski bağlantı değil, o AN çalışan başka bir süreç.
- İzole geçici DB'de (`siyahtus_verify_976`, migrate deploy edildi) bile `work-schedule.test.ts` 24/25 kırmızı verdi (çoğu 401) — paylaşılan Redis (rate-limit/session) üzerinden de çapraz kirlenme olası.
- `apps/api test:unit` (src dizini, DB'ye dokunması beklenmeyen testler) bile CANLI bir `unique constraint (email)` çakışmasıyla kırmızı verdi (`report-csv.test.ts`) — başka bir sürecin O ANDA aynı deterministik fixture email'iyle yazdığının kanıtı.
- Bu turun kendi `apps/api` diff'i SIFIR (`git diff --stat -- apps/api` boş) — yani kırmızılar tm 97.6'nın kodundan bağımsız.

Kapsam: bu tek bir görevin çözebileceği bir "bug" değil — otonom çoklu-pencere mimarisinin altyapı sınırlaması. Olası çözüm yönleri (araştırılacak, karar bu görevde verilecek):
1. Pencereler arası bir DB-erişim kilidi/mutex (ör. run-loop seviyesinde, `apps/api`/`apps/rtm` integration testi koşan pencere sayısını 1'le sınırlama).
2. Her pencere için ayrı, ucuz bir şema/DB (ör. `CREATE DATABASE siyahtus_test_<pencere-id>` + migrate, test sonunda drop) — Redis için de benzer namespace izolasyonu (prefix veya ayrı DB index).
3. CI/test-runner seviyesinde bir "DB testi çalışıyor" flag dosyası/lock — run-loop `pick_next` bu flag'i görürse DB-bağımlı görevi ertelesin.

DoD kapısının objektifliği bu sorunla zedeleniyor: gelecekteki pencereler kendi kodlarından bağımsız kırmızı `apps/api` sonuçları görüp ya yanlışlıkla "blocked" ilan edecek ya da (bu turda yapıldığı gibi) her seferinde elle kök-neden analizi yapmak zorunda kalacak. Kalıcı bir çözüm gerekiyor.

**Test Strategy:**

Kabul kriteri: iki pencere aynı anda `apps/api` integration testlerini koştuğunda, ikisi de birbirinden bağımsız kırmızısız (veya en azından deterministik, kendi kod değişikliğiyle açıklanabilir) sonuç almalı. Doğrulama: iki paralel `npx turbo run test --filter=@siyahtus/api --concurrency=1` koşusu (elle simüle edilmiş iki pencere) art arda çalıştırılıp ikisinin de temiz suite üzerinde yeşil olduğu gösterilmeli.
