# Task ID: 1

**Title:** 08.9.4-a — SecuritySettings dosya alanlarini yuzeye cikar

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** schema.prisma:849-851'deki fileSharingEnabled/allowedFileTypes/maxFileSizeBytes sutunlari var ama hicbir yerden okunmuyor: openapi.yaml'da /settings/security yok, settings.ts route'unda gecmiyor, web'de ekrani yok. Olu sutunlari kontrata ve UI'a bagla.

**Details:**

1) packages/contract/openapi/openapi.yaml: /settings/security ekle (GET + PATCH). Mevcut /settings/* yollari 169-179 arasinda; ayni desene uy. 2) @nexa/types generate. 3) apps/api/src/routes/settings.ts: license kapsamli handler; PATCH'te allowedFileTypes MIME dogrulamasi. 4) apps/web Settings altinda Security ekrani. Hata zarfi ADR-06. PRD: FR-MOD-08.9.4 · PLAN.md §3.7 · Dilim 13

[günlük 2026-07-24 01:07 UTC] hazirlik: gorev capalari kodda dogrulandi (schema.prisma:849-851 alanlar mevcut; settings.ts'te yuzey yok; openapi.yaml /settings/* 169-179). Gunluk mekanizmasi: node .taskmaster/gunluk.mjs — update-task --append AI'ya gidip kilitlendigi icin kullanilmiyor.

[günlük 2026-07-24 02:01 UTC] plan: (1) contract paths/settings.yaml'a securitySettings (GET+PATCH) + openapi.yaml'a /settings/security yolu ve SecuritySettings semasi; (2) generate; (3) routes/settings.ts'e iki handler, scope access_rules:ro/rw, withTenant ile RLS kapsamli (security_settings RLS policy'si migration 20260722154008:983-984'te mevcut, dogrulandi); (4) SettingsPage.tsx'e SecuritySettings bolumu; (5) settings.test.ts'e GET/PATCH/MIME-red/cross-tenant testleri.

[günlük 2026-07-24 02:01 UTC] varsayim: signup (auth_signup SQL fonksiyonu, migration 20260724101000:36-50) security_settings SATIRI OLUSTURMUYOR — yalnizca seed.ts:267 olusturuyor. Yani gercek bir signup'tan gelen lisansta satir YOK. Karar: GET satir yoksa sema varsayilanlarini doner (yazma yapmaz), PATCH upsert eder. Alternatif (signup SQL'ini degistirip migration eklemek) auth yuzeyine dokunacagi ve gorev 1 kapsamini asacagi icin secilmedi. Varsayilanlarin tek kaynakta kalmasi icin test, satirsiz GET ile bos-create edilmis satirin ayni degerleri verdigini dogruluyor.

[günlük 2026-07-24 02:46 UTC] ENGEL bulundu (insan tarayicida fark etti): entegrasyon paketi DB'yi truncate edip yerine kendi A/B fiksturunu birakiyor (owner-a@example.test...). Demo hesabi owner@acme.localhost silinmisti, /auth/login 401 donuyordu, uygulamaya girilemiyordu — testler ise yesildi. Cozum: her entegrasyon kosusundan sonra 'pnpm db:seed' + login smoke kontrolu. Kural /is §5 ve /dilim-kapat §5'e yazildi. 2026-07-24 02:xx'te dogrulandi: seed sonrasi login HTTP 200.

[günlük 2026-07-24 02:56 UTC] surdurme (loop): kontrat+route+7 test+SettingsPage yazilmis durumda bulundu (614 satir, commit edilmemis). Kalan: typecheck, entegrasyon kosusu, reseed+login smoke, E2E gorsel kanit (SettingsPage.tsx dokunuldugu icin zorunlu), commit.

[günlük 2026-07-24 03:12 UTC] E2E testi eklendi (settings.spec.ts:80) ve iki hata bulup duzeltildi: (1) test durumu degistirip geri koymuyordu — seed idempotent oldugu icin ikinci kosuda kendi kendini kiriyordu, artik varsayilanlari geri yaziyor; (2) Save'e tiklayip hemen reload etmek PATCH'i geciyordu (yaris) — artik waitForResponse ile 200 bekleniyor. Kanit: apps/e2e/kanit/1-dosya-paylasimi.png ve -kaydedildi.png.

[günlük 2026-07-24 03:12 UTC] KAPANIS: typecheck yesil (kontrat 55->56 yol), 439 entegrasyon testi yesil, reseed+login smoke OK, yeni E2E testi yesil. testStrategy maddelerinin hepsi karsilandi. PLAN.md 3.7 guncellemesi dilim kapanisina birakildi (sayac sayilarak uretilir).

**Test Strategy:**

Kabul: GET /settings/security lisans kapsamli doner; baska lisansin ayarina erisim ADR-06 zarfiyla reddedilir. PATCH gecersiz MIME'i reddeder. Birim: MIME allowlist dogrulayicisi. Cross-tenant testi ZORUNLU. Bitince PLAN.md §3.7 satiri guncellenir.
