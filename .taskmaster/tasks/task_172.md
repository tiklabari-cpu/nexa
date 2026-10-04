# Task ID: 172

**Title:** M-SEC-d2 [OPUS-MAX] SAML-JIT oturumu hesap-GLOBAL ikinci faktör kaydına ulaşıyor — yabancı bir çalışma alanı kurbanı HER çalışma alanından kalıcı olarak kilitleyebiliyor

**Status:** done

**Dependencies:** 157 ✓

**Priority:** high

**Description:** tm 157 (M-SEC-d) denetiminin ikinci HIGH bulgusu. `accounts--my:rw` tm 152.10'da `DEFAULT_AGENT_SCOPES`'a eklendi; gerekçesi "bu scope'un açtığı her rota yalnız çağıranın KENDİNE nişan alabilir" idi. Doğru — ama "kendi hesabı" GLOBAL, üyelik ise kiracı başına. Bir başkasının hesabı için üyelik uydurabilen çalışma alanı, bu rotaları o kişinin global durumuna nişan alabiliyor.

**Details:**

BULGU (tm 157 · M-SEC-d, HIGH #2). Zincirin her halkası okundu ve dosya:satır ile doğrulandı:

1. `routes/saml.ts:70` — `JIT_ROLE = 'agent'`. JIT sağlanan üyelik `agent` rolü alır.
2. `routes/saml.ts:550` — `defaultScopesForRole(membership.role)`; `packages/types/src/role-scopes.ts:60` — `DEFAULT_AGENT_SCOPES` içinde **`accounts--my:rw`** var.
3. `routes/auth.ts:255-291` — SAML assertion yolu `enforceSecondFactor`'a BİLEREK tabi değil ("Deliberately *not* applied to the SAML assertion path"). Yani bu oturum ikinci faktör sorulmadan basılır.
4. `routes/auth.ts:1040` (`/auth/2fa/enroll`) ve `:1087` (`/auth/2fa/activate`) — `scopes: ['accounts--my:rw']`, `principals: ['agent','enrollment']`. Yeni basılan SAML oturumu ikisini de karşılıyor.
5. Migration `20260826150000_two_factor_auth/migration.sql:23-31` — `account_two_factor` `PRIMARY KEY (account_id)`, kiracı sınırının ÜSTÜNDE. `two-factor-service.ts` başlığı bunu açıkça söylüyor: "one person's single secret covers every workspace they belong to".

SALDIRI: M-SEC-d1 (tm 171) ile zincirlenir — yabancı bir çalışma alanı `victim@victim-corp.com` için oturum alır, sonra `/auth/2fa/enroll` + `/auth/2fa/activate` çağırıp KENDİ authenticator'ını kurbanın GLOBAL hesabına ikinci faktör olarak kurar. Kurtarma sayfası (10 kod) da yanıt gövdesinde saldırgana döner.

SONUÇ — GERİ DÖNÜŞÜ YOK: `routes/auth.ts:348`'den sonraki dal, faktör aktifse "workspace'in politikası ne derse desin" kod istiyor. Kurban artık HİÇBİR çalışma alanına giremiyor. Kurtarma yolu yok: `auth_two_factor_disable`'ın TEK çağıranı `DELETE /auth/2fa` (`routes/auth.ts:1140`, `principals: ['agent']`) ve o da faktörün kapattığı bir oturum istiyor; parola sıfırlama (`routes/account-lifecycle.ts:200-228`) `account_two_factor`'a DOKUNMUYOR; admin/owner reset yüzeyi YOK. Kurbanın parolası elinde ama parolaya giden kapı faktörün arkasında. Saldırgan parolayı da biliyorsa (ihlal listesi) bu tam devralmadır.

NOT — M-SEC-d1'siz de dar bir hâli var: MEŞRU doğrulanmış alanla bile, iki çalışma alanına üye bir hesap (danışman) için AcmeCorp'un admini BetaCorp'a erişimini kontrol eden bir faktör kurabilir. Bu yüzden düzeltme tm 171'e bağımlı DEĞİL, bağımsız.

ÖNERİ (uygulama kararı bu görevin penceresine ait):
- `/auth/2fa/enroll` + `/auth/2fa/activate` da `reauthenticate` istesin (`routes/auth.ts:1228-1278` — parola varsa parola, yoksa faktör). Bugün istemiyorlar; gerekçe (`:1010-1029`) "korunacak bir şey yok, çünkü hesap zaten faktör tutmuyor" — bu, oturumun hesap SAHİBİNE ait olduğunu varsayıyor, SSO-JIT dalı tam da bunu bozuyor. Parolası olan bir hesap için parola istemek zinciri koparır; parolasız (saf SSO) hesap için `enrollment` bileti dalı zaten var.
- VEYA: üyeliği JIT ile YENİ yaratılmış bir oturum `accounts--my:rw` taşımasın (`provisioned.membership_created` zaten elde — `routes/saml.ts:580`).
- AYRICA (bu görevin ikinci yarısı, §D'deki MEDIUM ile aynı kök): kaybolan/ekilen faktör için kurtarma yolu. Parola sıfırlama akışı e-posta kontrolünü KANITLIYOR; onun ikinci faktörü de düşürmesi (ya da owner'a bir "reset member 2FA" yüzeyi) kilidin tek çıkışı. Bugün yok.
- Faktör kurulduğunda hesabın sahibine bildirim (`security.two_factor_enabled` zaten yazılıyor ama yalnız kuran kiracının denetim kaydına).

KAPSAM: yalnız bu bulgu (CONVENTIONS §5). Alan sahipliği kanıtı tm 171'in işi.

BAĞLAM: HANDOFF `## 157` bulgu tablosu satır 2 · `#### KM-SEC-d` · tm 152.5 (`enforceSecondFactor`) · tm 152.10 (`accounts--my:rw`'nin scope setine girişi) · tm 152.11 (`enrollment` bileti).

**Test Strategy:**

- ÖNCE KIRMIZI: yeni integration testi düzeltmeden önce koşulmalı — B çalışma alanının SAML'iyle JIT sağlanan bir hesap için `POST /auth/2fa/enroll` bugün 200 dönüyor olmalı; düzeltmeden sonra reddedilmeli.
- Zincirin sonu ölçülmeli: faktör kurulduktan sonra A çalışma alanına (`require_two_factor` KAPALI) `/auth/authorize` artık kod istiyor — bu testin düzeltmeden sonra hiç kurulamaması gerekir.
- Regresyon: MEŞRU kayıt yolları bozulmamalı — `enrollment` bileti akışı (tm 152.11, `two-factor.spec.ts` e2e) ve normal oturumdan kayıt yeşil kalmalı. Parolasız SSO hesabının kendi faktörünü kurabildiği dal ayrıca test edilmeli (aksi hâlde §D116'nın "policy shut them out; enrollment shut them out" döngüsü geri gelir — `role-scopes.ts:41-46`).
- Kurtarma yolu eklenirse: parola sıfırlamanın faktörü düşürdüğü (ya da owner reset'in çalıştığı) test + denetim satırı.
- Tam DoD kapısı (CONVENTIONS §1); `apps/e2e`'de `two-factor.spec.ts` + `sso.spec.ts` koşulmalı. Test kapısı §1.3 gereği parçalanabilir.
