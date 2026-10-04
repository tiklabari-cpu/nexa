# Task ID: 171

**Title:** M-SEC-d1 [OPUS-MAX] `verified_domains` sahiplik kanıtı istemiyor — §D116 MEDIUM (a) hâlâ açık, yalnız bir API çağrısı uzakta

**Status:** done

**Dependencies:** 157 ✓

**Priority:** high

**Description:** tm 157 (M-SEC-d) denetiminin birinci HIGH bulgusu. §D125 alan bağını KURDU ama alanın SAHİPLİĞİNİ hiç doğrulamıyor: `verified_domains` çalışma alanının kendi yazdığı bir liste. Orijinal bulgunun tehdit aktörü zaten çalışma alanı sahibiydi, dolayısıyla yazma yüzeyini `exactRole: 'owner'` ile daraltmak o aktörü hiç kısıtlamıyor.

**Details:**

BULGU (tm 157 · M-SEC-d, HIGH #1). Ölçüldü: `readVerifiedDomain` (`apps/api/src/lib/sso-connection.ts:247-253`) YALNIZ biçim kontrolü yapıyor — `HOSTNAME` regexi (`:229`) ve uzunluk. Sahiplik kanıtı YOK: ne DNS TXT, ne e-posta meydan okuması, ne de kamuya açık sağlayıcı (gmail.com / outlook.com) reddi. Depoda hiçbir alan-doğrulama mekanizması yok (`dns.?txt|domain.?verification|proof of ownership` taraması boş döndü).

SALDIRI: `sso` yetkisi olan (enterprise, ADR-13) bir çalışma alanının sahibi `PATCH /settings/sso-connections/{id}` ile `verified_domains: ["victim-corp.com"]` yazar (`routes/settings.ts:134-138, 189, 2615-2630`), kendi IdP'siyle `ceo@victim-corp.com` iddia eder. `sso_email_domain_verified` (migration `20260826140000_sso_verified_domains/migration.sql:129-152`) TAM eşleşmeyi doğrular ve GEÇER — liste saldırganın kendi yazdığı listedir. Sonuç §D116'nın ilk hâliyle birebir aynı: yabancının mevcut hesabı saldırganın kiracısına üye yapılır VE `routes/saml.ts:556-566` o kimlikle oturum basar; hiç kaydolmamış bir adres için hesap satırı işgal edilir. Kurbana HİÇBİR bildirim gitmiyor (`routes/saml.ts`'de notify/mail yok; denetim satırı yalnız SALDIRGANIN kiracısına yazılıyor, `:568-587`).

NEDEN §D125 BUNU KAPATMADI: §D125'in gerekçesi "alan iddiası IdP'nin iddiasıdır ve o satırın yazma yüzeyi zaten `exactRole: 'owner'`, üründeki en dar kapı". Ama §D116 MEDIUM (a)'nın tehdit aktörü TAM DA sahiptir ("kendi IdP'sini kuran bir çalışma alanı"). En dar kapıyı seçmek, kapının arkasındaki kişi saldırgansa bir savunma değildir. §D125'in getirdiği sertleşmeler (tam eşleşme, joker reddi, alt alan reddi, boş liste fail-closed, çözücünün İÇİNDE kapı, `p_license_id` → `p_connection_id`) GERÇEK ve KORUNMALI — ama hepsi iddianın BİÇİMİNİ kısıtlıyor, iddia HAKKINI değil.

ÖNERİ (uygulama kararı bu görevin penceresine ait):
- Alan başına sahiplik kanıtı: `sso_connection_domains` satırında `verification_token` + `verified_at`; DNS TXT (`_siyahtus-verify.<alan>`) ya da `postmaster@<alan>`/`admin@<alan>` e-posta meydan okuması. Doğrulanmamış alan JIT sağlamaya KATILMAZ (listede durabilir, `pending` görünür).
- Asgari ara adım (kanıt akışı bu pencereye sığmazsa): kamuya açık e-posta sağlayıcı reddi + mevcut bir hesap ilk kez yabancı bir çalışma alanına iliştirildiğinde SAHİBİNE bildirim (§D116'nın kendi önerisi: "Var olan hesabın iliştirilmesi ayrıca sahibine bildirilsin") + `security.provisioning_domain_rejected` kardeşi olarak bir `security.account_adopted` denetim satırı.
- Geriye uyumluluk: migration'ın TÜRETTİĞİ listeler (üyelerin bugünkü alanları) doğrulanmış SAYILMAZ — o bir olgu kaydıydı, sahiplik kanıtı değil.

KAPSAM: yalnız bu bulgu (CONVENTIONS §5). tm 157'nin ikinci HIGH'ı (SAML-JIT oturumunun hesap-GLOBAL 2FA kaydına ulaşması) AYRI görevdir; ikisi zincirleniyor ama düzeltmeleri bağımsız.

BAĞLAM: `grep -n "D125" PLAN.md` · `grep -n "D116" PLAN.md` · `#### KM-SEC-d` bloğu · HANDOFF `## 157` bulgu tablosu satır 1 · tm 151.1 (bu fiksin kendisi).

**Test Strategy:**

- ÖNCE KIRMIZI: yeni integration testi düzeltmeden önce koşulmalı — kendi bağlantısına `verified_domains: ["unrelated.example.test"]` yazan bir çalışma alanı `victim@unrelated.example.test` için 302 + oturum ALIYOR olmalı (bugünkü davranış), düzeltmeden sonra reddedilmeli.
- Doğrulanmış alan hâlâ çalışıyor: kanıt akışından geçmiş bir alan için JIT sağlama bozulmamalı (`sso.spec.ts` + `sso-verification.test.ts` yeşil).
- SCIM tarafı da kapanmalı (`scim_provision_member` aynı listeyi okuyor) — `scim.test.ts`'e negatif test.
- Migration eklenirse `pnpm -w db:check-drift` exit 0; kontrat değişirse `contract:generate` sonrası `git status` temiz.
- Tam DoD kapısı (CONVENTIONS §1), test kapısı §1.3 gereği parçalanabilir.
