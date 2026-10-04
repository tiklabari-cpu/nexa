# Task ID: 152

**Title:** S11-2FA — KALAN İŞ: agent rolü kendi 2FA kaydını yapamıyor (DEFAULT_AGENT_SCOPES) + uçtan uca two-factor.spec.ts. TOTP çekirdeği · kayıt uçları · zorlama · web ekranları TESLİM EDİLDİ (152.1-152.8 done) (NFR-S11 · FR-MOD-00.1) — §D124 bulgu 3

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** DARALTILDI (2026-08-27 uzlaştırma penceresi — §D126). Görevin sekiz alt-görevi TESLİM EDİLDİ ve koda karşı doğrulandı: account_two_factor + two_factor_recovery_codes migrationları, lib/totp.ts (RFC 6238 + replay muhafızı), kurtarma kodları, dört kayıt ucu (POST /auth/2fa/enroll · activate · DELETE /auth/2fa · recovery-codes), /auth/authorize da zorlama + require_two_factor politikasının fiilen okunması, /auth/login anotasyonları, web hesap ayarı ekranı, girişin ikinci adımı, Settings→Security anahtarı ve Teammates 2FA sütunu. BU KALEMLERİ TEKRAR YAPMA. GERİYE İKİ ŞEY KALDI: (1) require_two_factor açık bir çalışma alanında rolü agent olan bir üye oturum basamıyor AMA kendi kaydını da yapamıyor — kilit; (2) iddiayı bir insanın yürüdüğü yolla kanıtlayan e2e two-factor.spec.ts henüz YOK.

**Details:**

DURUM (2026-08-27 uzlaştırma penceresi · §D126 — koda karşı ölçüldü, kanaat değil):
Alt-görev 152.1-152.8 done ve teslim gerçek. Doğrulama noktaları: dört kayıt ucu
apps/api/src/routes/auth.ts:914/959/993/1038; zorlama enforceSecondFactor aynı dosyada
(satır ~267-331, üç dal + denetim olayları); ikinci giriş adımı
apps/web/src/features/auth/SignInPage.tsx:153-154/239-240 (two_factor_required +
details.enrollment_required); hesap ayarı ekranı apps/web/src/features/settings/TwoFactor.tsx;
testler apps/api/src/lib/totp.test.ts (82) + test/integration/two-factor-{enrollment,enforcement,
recovery-codes}.test.ts + agents-two-factor.test.ts + apps/web/.../TwoFactor.test.tsx (10).
Kanıt dökümü PLAN.md #### KS11-2FA bloğunda (sekiz madde).

KALAN 1 — AGENT ROLÜ KENDİ KAYDINI YAPAMIYOR (alt-görev 152.10, YENİ):
Ölçüldü: packages/types/src/role-scopes.ts:32-43 DEFAULT_AGENT_SCOPES accounts--my:ro taşıyor,
accounts--my:rw TAŞIMIYOR; dört /auth/2fa/* ucunun hepsi accounts--my:rw istiyor
(routes/auth.ts:915 vd.); scopesWithinRole (role-scopes.ts:142-145) her oturumun kapsamlarını
bu tavanla HER İSTEKTE kesiyor. Sonuç: require_two_factor açık bir çalışma alanında tek üyeliği
orada olan, rolü agent olan bir hesap (a) oturum basamıyor — zorlama doğru çalışıyor — ve
(b) kaydını yapmak için gereken uca da hiç ulaşamıyor. SignInPage in enrollment_required paneli
bu yüzden /app/settings e link bırakıyor ama o rota da oturum istiyor: kapalı döngü.
Bu boşluk 152.5 · 152.6 · 152.7 · 152.8 kanıt maddelerinin DÖRDÜNDE de "kapsam dışı" diye
devredildi ve hiçbir alt-görev sahiplenmedi; NFR-S11 in "zorunlu politika" iddiası bu haliyle
agent rolü için karşılanmıyor. 152.5 in önerdiği çözüm (a): DEFAULT_AGENT_SCOPES a
accounts--my:rw eklemek — ama karar tek başına scope listesi değil: accounts--my:rw ile
korunan BAŞKA uçlar varsa (grep: scopes listesinde accounts--my:rw) her biri agent rolüne
açılmış olur, o yüzden önce o yüzey sayılmalı; alternatif, kayıt uçlarını accounts--my:ro +
principals agent + "yalnız kendi hesabı" sözleşmesine indirmektir (uçlar zaten id parametresi
almıyor, başkasının faktörüne yol yok).

KALAN 2 — UÇTAN UCA KANIT (alt-görev 152.9, zaten pending):
apps/e2e/tests/two-factor.spec.ts YOK (ölçüldü: dosya yok, apps/e2e/tests altında 2fa/two_factor
geçen tek satır yok). 152.9 un kendi details i akışı sayıyor; 152.10 dan SONRA koşulmalı ki
senaryo agent rolüyle de yürüsün.

DEĞİŞMEYEN SINIRLAR: sosyal giriş (Google/Microsoft/Apple) EKLENMEZ. Kurumsal kimlik
(SAML 2.0 + SCIM) teslim, dokunma — SAML yolu 2FA kapısından bilinçli olarak MUAF
(gerekçe KS11-2FA/152.5 maddesinde). Faz-5 YENİ ÖZELLİK AÇMAZ: iddia ile kodu eşitler.
ÖLÇÜLDÜ, BU GÖREVİN KAPSAMI DEĞİL: apps/mobile/src/features/auth/enter.ts two_factor_required ı
tanımıyor (mobil parite ayrı görev ister) — 152.7 nin notu.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Kanıt bloğu: grep -n "^#### KS11-2FA" PLAN.md → kapanışta madde bu bloğun SONUNA eklenir (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Gereksinim satırı: grep -n "| S11-2FA" PLAN.md → §7.2 satırı bugün "◐ → KS11-2FA"; iki kalem de bitince "✅ → KS11-2FA".
- FR-MOD-00.1 (PLAN.md:169) ✅ KALIR ve DOKUNULMAZ: o satırın Must payı email+parola girişidir (Dilim 2), SSO/2FA payı PRD de "opsiyonel" ve ayrı S11-2FA satırında izleniyor (§D126).

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not → git add -A + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit codelarla): pnpm -w typecheck · lint · format:check · test · test:integration · build · ilgili test:e2e · kontrat değiştiyse contract:generate sonrası git status temiz · migration varsa db:check-drift.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2). test/test:integration tek komutta pencere tavanını aşar — CONVENTIONS §1.3 e göre parçala.

**Test Strategy:**

İki alt-görev (152.10, 152.9) done. Ölçülebilir kapanış kanıtı:
1. require_two_factor açık bir çalışma alanında rolü AGENT olan bir üye kendi kaydını uçtan uca
   tamamlayabiliyor (enroll → activate) ve sonrasında oturum basabiliyor — integration testiyle
   kanıtlanıyor, ÖNCE KIRMIZI ölçülerek (bugün scope reddi almalı).
2. e2e two-factor.spec.ts uçtan uca yeşil: kaydol → aktifleştir → çıkış → giriş kod ister →
   yanlış kod reddi → kurtarma koduyla giriş → aynı kurtarma kodu ikinci kez reddedilir →
   politika açıkken kaydı olmayan üye kilitli (kayda yönlendiriliyor).
3. PLAN.md §7.2 S11-2FA satırı "✅ → KS11-2FA" ve KS11-2FA bloğunda iki yeni madde.

ZATEN KANITLANMIŞ, TEKRAR ETME (152.1-152.8): TOTP vektörleri · replay · kurtarma kodu tek
kullanımı · dört kayıt ucu · /auth/authorize zorlaması · require_two_factor politikasının
okunması · kaba kuvvet bütçesi · web ekranları · Teammates sütununun canlı veriyle beslenmesi.

## Subtasks

### 152.1. S11-2FA-a [SONNET-XHIGH] Migration + tip iskeleti: account_two_factor + two_factor_recovery_codes tabloları (password_reset_tokens erişim deseni) + ERROR_TYPES two_factor_required — YENİ OpenAPI path YOK

**Status:** done  
**Dependencies:** None  

İki adımlı doğrulamanın veri zemini ve hata tipi hazır.

**Details:**

NE YAPILACAK: iki tablo + bir hata tipi. Route ve kontrat path i EKLENMEZ.
1. account_two_factor: account_id (PK, accounts a FK), secret (şifreli ya da korumalı saklama —
   kararı gerekçesiyle migration yorumuna yaz), activated_at, last_used_step (replay muhafızı için),
   created_at. TOTP secret i GERİ OKUNABİLİR olmak zorundadır (doğrulama için) — parola gibi
   hash lenemez; bu yüzden erişimi kısıtla.
2. two_factor_recovery_codes: id, account_id (FK), code_hash (SHA-256), used_at (nullable), created_at.
3. packages/types/src/errors.ts → ERROR_TYPES listesine two_factor_required + ERROR_STATUS eşlemesi.

ERİŞİM DESENİ — KOPYALANACAK ÖRNEK: password_reset_tokens. O tabloda hiçbir izin verici RLS
politikası YOKTUR; erişim yalnız SECURITY DEFINER fonksiyonlar üzerindendir
(auth_request_password_reset / auth_consume_password_reset, apps/api/src/services/auth/lifecycle-service.ts).
Sebep: accounts kiracı-üstüdür, license_id ile filtrelenemez. 2FA tabloları da hesap başınadır →
aynı deseni uygula. PLAN §8 in GL-9 notu bu tablonun neden "tüketicisi yok" gibi göründüğünü anlatır.

KARAR NOTU (migration yorumuna ve HANDOFF a yaz): TOTP secret i HESAP başınadır (accounts),
ama two_factor_enabled PRD §8.4 gereği ÜYELİK başınadır (agent_memberships).
İkincisi birincinin TÜREVİ olarak senkron tutulur — ayrı bir doğruluk kaynağı YARATMA.
Yani: hesap 2FA yı aktifleştirince o hesabın tüm üyeliklerinde two_factor_enabled true olur.

DOSYALAR: yeni migration dizini · packages/types/src/errors.ts · packages/types/src/errors.test.ts.

NEDEN BU ALT-GÖREVDE YENİ PATH YOK: contract-parity testi
(apps/api/test/integration/contract-parity.test.ts) İKİ YÖNLÜ çalışır — belgelenip sunulmayan bir
path testi KIRMIZIYA düşürür. Bu yüzden her yeni OpenAPI path i, onu sunan route ile AYNI
alt-görevde iner (152.4). Bu alt-görev yalnız migration + tip ekler, tek başına yeşil geçer.

REFERANS DESEN: apps/api/prisma/migrations/ altında password_reset_tokens’ı kuran migration
(tablo + SECURITY DEFINER fonksiyonlar, izin verici RLS politikası YOK) ve
packages/types/src/errors.ts’in mevcut ERROR_TYPES/ERROR_STATUS çiftleri.

TUZAKLAR:
1. TOTP secret’ı PAROLA GİBİ HASH’LENEMEZ — doğrulama için geri okunabilir olmak zorunda.
   Bu yüzden koruma hash’te değil ERİŞİMDE: tabloya yalnız SECURITY DEFINER fonksiyonlar erişir.
2. accounts kiracı-üstüdür; bu iki tabloya license_id KOYMA ve kiracı-bazlı RLS kurmaya çalışma.
3. Yeni hata tipi i18n nöbetçisini (lib/i18n-coverage.test.ts, common.errors.* kapsaması) kırar —
   en/tr katalog anahtarını AYNI alt-görevde ekle, yoksa web testi kırmızı.
4. Bu alt-görev route ya da OpenAPI path EKLEMEZ (contract-parity iki yönlü çalışır).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **S11-2FA** (türetilmiş — NFR-S11). Gereksinim satırı: `grep -n "| S11-2FA" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KS11-2FA" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 152.2. S11-2FA-b [OPUS-MAX] TOTP çekirdeği lib/totp.ts (BÖLÜNMEZ): RFC 6238 · step replay muhafızı · sabit-zaman karşılaştırma · base32 secret üretimi · otpauth URI

**Status:** done  
**Dependencies:** 152.1  

Kod üretimi ve doğrulaması standartlara uygun ve tekrar saldırısına kapalı.

**Details:**

NE YAPILACAK: apps/api/src/lib/totp.ts — bağımlılıksız, Node standart kütüphanesiyle:
- HMAC-SHA1 tabanlı HOTP (RFC 4226) + zaman adımlı TOTP (RFC 6238): 30 saniyelik pencere, 6 hane.
- Doğrulamada ±1 pencere kayması kabul edilir (saat kayması), DAHA GENİŞİ KABUL EDİLMEZ.
- REPLAY MUHAFIZI: bir kod bir kez kullanılınca aynı step tekrar kabul edilmez
  (account_two_factor.last_used_step ile). Bu opsiyonel değil — TOTP nin bilinen zayıflığı budur.
- Karşılaştırma timingSafeEqual ile.
- Secret üretimi: 160 bit rastgele → base32 (RFC 4648, padding siz), randomBytes ile.
- otpauth://totp/<issuer>:<hesap>?secret=...&issuer=... URI üreticisi.
- Unit testler RFC 6238 in kendi TEST VEKTÖRLERİYLE (belgede yayınlanmış zaman/kod çiftleri).

NEDEN OPUS-MAX VE NEDEN BÖLÜNMEZ (§5.1.2 istisnası): bu bir kripto/kimlik doğrulama çekirdeğidir.
Bağlam bölününce güvenlik akıl yürütmesi kaybolur. Çevresindeki her şey (uçlar, UI, e2e) ayrı ve
daha ucuz alt-görevlerdedir; çekirdek tek pencerede kalır.

REFERANS DESEN: apps/api/src/lib/crypto.ts — depo neden argon2 yerine scrypt seçtiğini,
neden token lar için tek SHA-256 kullandığını ve timingSafeEqual disiplinini yazıyor.
Aynı gerekçelendirme seviyesini totp.ts te de tut: NEDEN ±1 pencere, NEDEN replay muhafızı.

DOSYALAR: apps/api/src/lib/totp.ts (yeni) · apps/api/src/lib/totp.test.ts (yeni).
BAĞIMLILIK EKLEME: otplib benzeri bir paket KURMA — crypto.ts in gerekçesi burada da geçerli
(bir güvenlik primitifi için native/üçüncü parti bağımlılık, standart kütüphaneyle yazılabiliyorsa, tercih edilmez).

TUZAKLAR:
1. Base32 alfabesi ve padding: doğrulayıcı uygulamalar (Google Authenticator, 1Password) padding siz
   büyük harf base32 bekler. Yanlışsa kullanıcı kodu asla tutmaz ve hata sessizdir.
2. Zaman kaynağı test edilebilir olmalı: fonksiyon "şimdi"yi parametre olarak alsın, Date.now() u
   içeride sabitlemesin — RFC vektörleri ancak öyle koşulabilir.
3. otpauth URI de issuer hem yolda hem sorgu parametresinde olmalı (uygulamalar ikisini de okur).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **S11-2FA** (türetilmiş — NFR-S11). Gereksinim satırı: `grep -n "| S11-2FA" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KS11-2FA" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 152.3. S11-2FA-c [OPUS-XHIGH] Kurtarma kodları: 10 adet tek kullanımlık, SHA-256 hash li saklanır, yeniden üretim eskileri geçersizler

**Status:** done  
**Dependencies:** 152.2  

Telefonunu kaybeden ajan hesabına geri girebiliyor.

**Details:**

NE YAPILACAK: apps/api/src/services/auth/two-factor-service.ts (yeni) içinde kurtarma kodu
üretimi ve tüketimi:
- Aktivasyon anında 10 adet kod üretilir, kullanıcıya BİR KEZ düz metin gösterilir, veritabanına
  yalnız SHA-256 hash i yazılır (lib/crypto.ts in token deseni: 256 bit entropi → tek SHA-256).
- Bir kod kullanılınca used_at damgalanır ve BİR DAHA kabul edilmez.
- Yeniden üretim (regenerate) ESKİ kodların hepsini geçersizler (kullanılmamış olanlar dahil).
- Kalan kod sayısı okunabilir olmalı (UI "3 kurtarma kodunuz kaldı" diyebilsin).

DOSYALAR: apps/api/src/services/auth/two-factor-service.ts (yeni) + testi ·
apps/api/src/lib/crypto.ts (token hash deseni — OKU, yeniden yazma).
REFERANS DESEN: davetiye ve parola sıfırlama token larının hash lenerek saklanması
(services/auth/lifecycle-service.ts) — aynı disiplin.

TUZAKLAR:
1. Kodlar okunabilir olmalı (insan elle yazacak): karışabilen karakterleri (0/O, 1/l/I) alfabeden çıkar.
2. Tüketim ATOMİK olmalı: iki eşzamanlı istek aynı kodu iki kez harcayamamalı
   (koşullu UPDATE ... WHERE used_at IS NULL RETURNING deseni — audit zincirinin kullandığı yol).
3. Kurtarma kodu ile giriş, denetim kaydına AYRI bir olay olarak yazılmalı (normal 2FA girişinden ayırt edilebilsin).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **S11-2FA** (türetilmiş — NFR-S11). Gereksinim satırı: `grep -n "| S11-2FA" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KS11-2FA" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 152.4. S11-2FA-d [OPUS-XHIGH] Kayıt uçları + kontrat: POST /auth/2fa/enroll · POST /auth/2fa/activate · DELETE /auth/2fa (parola ister) · POST /auth/2fa/recovery-codes

**Status:** done  
**Dependencies:** 152.2, 152.3  

Ajan kendi hesabında iki adımlı doğrulamayı açıp kapatabiliyor.

**Details:**

NE YAPILACAK: dört uç + OpenAPI satırları AYNI alt-görevde (contract-parity iki yönlüdür).
- POST /auth/2fa/enroll: secret üretir, otpauth URI döner, HENÜZ AKTİF ETMEZ (activated_at null).
- POST /auth/2fa/activate: gövdedeki kodu doğrular → aktifleştirir → kurtarma kodlarını BİR KEZ döner
  → o hesabın tüm üyeliklerinde two_factor_enabled true olur.
- DELETE /auth/2fa: parola ister (oturum tek başına yetmez), kapatır, kurtarma kodlarını siler,
  üyelik bayraklarını false yapar. require_two_factor açık bir çalışma alanının üyesiyse REDDEDİLİR.
- POST /auth/2fa/recovery-codes: yeniden üretir (aktif 2FA + parola ister).
Hepsi kimlikli (public DEĞİL). Her biri denetim kaydı yazar.

DOSYALAR: apps/api/src/routes/auth.ts (uçlar) · packages/contract/openapi/paths/auth.yaml ·
apps/api/src/services/auth/two-factor-service.ts · apps/api/test/integration/ altında ilgili süit.
REFERANS DESEN: aynı dosyadaki /auth/personal-access-tokens uçları — kimlikli, kaynak-tabanlı,
sırrı bir kez gösterip sonra hash saklayan aile.

TUZAKLAR:
1. enroll ile activate ARASINDA hesap yarı-kayıtlı kalır; ikinci bir enroll çağrısı eskisini
   geçersizleyip yenisini vermeli (yarım kalmış kayıt kilit yaratmamalı).
2. DELETE in parola istemesi bir "yeniden kimlik doğrulama" adımıdır — çalınmış bir oturumun 2FA yı
   kapatmasını engeller. Atlama.
3. Kontrat + route aynı commit te olmalı; sonra pnpm -w contract:generate ve git status temiz.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **S11-2FA** (türetilmiş — NFR-S11). Gereksinim satırı: `grep -n "| S11-2FA" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KS11-2FA" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 152.5. S11-2FA-e [OPUS-MAX] Zorlama (BÖLÜNMEZ): /auth/authorize da 2FA kapısı + require_two_factor politikası fiilen okunur + /auth/login two_factor_required anotasyonu + denetim olayları

**Status:** done  
**Dependencies:** 152.4  

2FA artık bir ayar değil, gerçekten geçilmesi gereken bir kapı.

**Details:**

NE YAPILACAK: oturumun basıldığı yere kapı konur.
1. POST /auth/authorize: hesabın aktif 2FA kaydı varsa gövdede geçerli bir kod (ya da kurtarma kodu)
   ŞART; yoksa two_factor_required hata tipiyle reddedilir (yeni ERROR_TYPES girdisi, 152.1 de eklendi).
2. Seçilen çalışma alanının security_settings.require_two_factor değeri TRUE ise ve hesabın 2FA kaydı
   YOKSA oturum basılmaz — kullanıcı kayda yönlendirilir. Bugün bu alan hiçbir yerde okunmuyor;
   bu maddeyi atlarsan kalem kapanmaz.
3. POST /auth/login yanıtındaki her üyeliğe two_factor_required anotasyonu eklenir
   (sso_enforced_connection_id ile birebir aynı gerekçe ve aynı yer — ekran doğru kapıyı açabilsin).
4. Denetim olayları: security.two_factor_enabled / disabled / challenge_failed / recovery_code_used.

NEDEN OPUS-MAX VE BÖLÜNMEZ: bu bir authN sınırıdır. Yanlış kurulursa ya kapı hiç çalışmaz
(sessiz açık) ya da herkesi kilitler.

ÖNCE KIRMIZI — ZORUNLU SIRA: üç testi düzeltmeden ÖNCE yaz ve kırmızı koştur:
(a) aktif 2FA lı hesap kodsuz authorize çağırıyor → bugün 200, olması gereken red;
(b) require_two_factor açık çalışma alanı + kaydı olmayan ajan → bugün 200, olması gereken red;
(c) yanlış kod → red. Kırmızı çıktıları HANDOFF a yaz.

DOSYALAR: apps/api/src/routes/auth.ts (login anotasyonu + authorize kapısı) ·
apps/api/src/services/auth/oauth-service.ts (grant yolu) ·
apps/api/src/services/auth/two-factor-service.ts · apps/api/src/routes/settings.ts (yalnız OKUMA:
require_two_factor nereden geliyor) · apps/api/src/services/audit/audit-log.ts (yeni olay adları).

TUZAKLAR:
1. SAML/SSO ile gelen oturumlar: IdP zaten MFA yapmış olabilir. Karar ver ve GEREKÇESİNİ yaz —
   önerilen: SSO ile basılan oturum 2FA kapısından MUAFTIR (IdP nin sorumluluğu), parola ile
   basılan oturum muaf DEĞİLDİR. Kararını §D ye ve koda yorum olarak yaz.
2. Bot token ve PAT yolları etkilenmemeli — onlar kullanıcı oturumu değil.
3. Kendini kilitleme senaryosu: son owner ın 2FA sı bozulursa çalışma alanı erişilemez olur.
   Kurtarma kodları bunun cevabıdır; ayrıca DELETE /auth/2fa in require_two_factor altında
   reddedildiğini unutma (152.4) — bu ikisi birlikte tutarlı olmalı.
4. e2e süitinin mevcut giriş akışı KIRILMAMALI: seed hesaplarının 2FA sı yok, dolayısıyla
   require_two_factor kapalıyken hiçbir şey değişmemeli. 205 e2e yeşil kalmalı.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **S11-2FA** (türetilmiş — NFR-S11 + FR-MOD-00.1). Gereksinim satırı: `grep -n "| S11-2FA" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KS11-2FA" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 152.6. S11-2FA-f [SONNET-XHIGH] Web — hesap ayarı ekranı: iki adımlı doğrulamayı aç/kapat, otpauth URI + kopyalanabilir secret, kurtarma kodlarını indir (en/tr)

**Status:** done  
**Dependencies:** 152.4  

Ajan iki adımlı doğrulamayı kendi hesabında kurabiliyor.

**Details:**

NE YAPILACAK: apps/web/src/features/settings/ (ya da hesap menüsü altında) TwoFactor.tsx —
- Kapalıyken: "Etkinleştir" → POST /auth/2fa/enroll → otpauth URI + KOPYALANABİLİR secret gösterilir
  → kullanıcı doğrulayıcı uygulamasına girer → kod alanı → POST /auth/2fa/activate.
- Aktivasyon yanıtındaki 10 kurtarma kodu BİR KEZ gösterilir + indirilebilir (.txt) + "kaydettim" onayı.
- Açıkken: durum + kalan kurtarma kodu sayısı + "Yeniden üret" + "Kapat" (parola ister).
- Tüm metinler locales/{en,tr} katalogundan (i18n nöbetçisi lib/i18n-coverage.test.ts yeşil kalmalı).

QR KODU EKLENMEZ: yeni bir QR kütüphanesi kurmak bundle ve bağımlılık maliyetidir; otpauth URI si
kopyalanabilir metin olarak yeterlidir (doğrulayıcı uygulamalar elle girişi destekler).
Bu bir karardır, unutulmuş bir iş değil — HANDOFF a yaz.

DOSYALAR: apps/web/src/features/settings/TwoFactor.tsx + testi ·
apps/web/src/features/settings/SettingsPage.tsx (bağlama) ·
apps/web/src/locales/{en,tr}/settings.ts (ya da uygun ad alanı).
REFERANS DESEN: aynı dizindeki tekil-ayar formları (ChatTimeout.tsx) + lib/form.tsx primitifi
(EK-A.1: alan-altı hata, geçersizken submit pasif) + lib/dirty-guard.tsx (EK-A.2).

TUZAKLAR:
1. Kurtarma kodları ekrandan kaybolduktan sonra bir daha GÖSTERİLEMEZ — UI bunu açıkça söylemeli.
2. İndirme bağlantısı için data: URI kullanılıyorsa tarayıcı kısıtlarına dikkat; basit ve test edilebilir tut.
3. Sunucunun döndürdüğü hata tipini t(errorMessageKey(...)) ile çevir (ham error.message BASMA) —
   i18n nöbetçisi bunu denetliyor.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **S11-2FA** (türetilmiş — NFR-S11). Gereksinim satırı: `grep -n "| S11-2FA" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KS11-2FA" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 152.7. S11-2FA-g [SONNET-XHIGH] Web — giriş akışının ikinci adımı: kod ekranı + kurtarma kodu alternatifi + require_two_factor açıkken kaydı olmayana zorunlu kayıt yolu

**Status:** done  
**Dependencies:** 152.5, 152.6  

Girişte ikinci adım gerçekten sorulıyor.

**Details:**

NE YAPILACAK: apps/web/src/features/auth/SignInPage.tsx akışına ikinci adım eklenir.
- /auth/login yanıtındaki two_factor_required anotasyonu true olan üyelik seçilince, parola
  adımından sonra KOD adımı gelir; kod /auth/authorize gövdesine eklenir.
- "Kurtarma kodu kullan" alternatifi aynı ekranda.
- Sunucu require_two_factor yüzünden reddettiyse (kaydı yok) kullanıcı kayıt akışına yönlendirilir
  ve neden yönlendirildiği açıkça yazılır.
- Hata mesajları katalogdan (two_factor_required dahil).

DOSYALAR: apps/web/src/features/auth/SignInPage.tsx · apps/web/src/lib/auth-store.ts (authorize çağrısı) ·
apps/web/src/locales/{en,tr}/auth.ts.
REFERANS DESEN: aynı ekrandaki SSO dalı — sso_enforced_connection_id anotasyonu geldiğinde parola
kutusu yerine "SSO ile devam et" gösteriliyor. İkinci adım onun kardeşidir; aynı state makinesine ekle,
ikinci bir giriş ekranı YARATMA.

TUZAKLAR:
1. Kod alanı numerik ve yapıştırmaya uygun olmalı; otomatik gönderim 6. hanede tetiklenebilir ama
   klavye erişilebilirliğini bozmamalı (NFR-A11Y4).
2. Yanlış kod sonrası parola adımına GERİ DÖNME — kullanıcıyı baştan başlatma.
3. Mobil uygulama (apps/mobile) bu akıştan ETKİLENİR mi? Bu alt-görevin kapsamı web dir;
   mobil in davranışını ÖLÇ ve bir borç doğuyorsa HANDOFF a yaz (kapsam dışına çıkma, CONVENTIONS §5).

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **S11-2FA** (türetilmiş — NFR-S11 + FR-MOD-00.1). Gereksinim satırı: `grep -n "| S11-2FA" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KS11-2FA" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 152.8. S11-2FA-h [SONNET-XHIGH] Settings → Security: require_two_factor artık zorluyor (yardım metni + etkisi) + Teammates 2FA sütunu canlı veriyle besleniyor

**Status:** done  
**Dependencies:** 152.5  

Yöneticinin gördüğü anahtar gerçekten bir şey yapıyor.

**Details:**

NE YAPILACAK:
1. Settings → Security ekranındaki require_two_factor anahtarının yanına, açıldığında NE OLACAĞINI
   söyleyen yardım metni (kaydı olmayan üyeler bir sonraki girişte kayda zorlanır).
2. Anahtar açılırken kaç üyenin henüz kaydı olmadığını gösteren bir uyarı (owner ı kilitlemekten korur).
3. Team → Teammates tablosundaki 2FA sütununun artık GERÇEK kayıttan beslendiği doğrulanır
   (bugün two_factor_enabled hiç yazılmıyordu; 152.4 sonrası yazılıyor). Gerekirse etiket/boş durum düzeltilir.

DOSYALAR: apps/web/src/features/settings/ (Security bölümü — SettingsForms.tsx ya da ilgili bileşen) ·
apps/web/src/features/team/TeamPage.tsx · locales/{en,tr}.
REFERANS DESEN: IpAllowlist.tsx ve BannedCustomerIps.tsx — aynı Security bölümünde yaşayan,
entitlement/uyarı taşıyan ekranlar.

TUZAK: bu alt-görev SUNUCU DAVRANIŞI DEĞİŞTİRMEZ — zorlama 152.5 te kuruldu.
Burada yapılan iş yalnız yöneticinin doğru bilgiyle karar vermesini sağlamak.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **S11-2FA** (türetilmiş — NFR-S11). Gereksinim satırı: `grep -n "| S11-2FA" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KS11-2FA" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 152.9. S11-2FA-i [OPUS-XHIGH] Uçtan uca two-factor.spec.ts: kaydol → aktifleştir → çıkış → giriş kod ister → yanlış kod reddi → kurtarma koduyla giriş → aynı kod ikinci kez reddedilir → politika açıkken kaydı olmayan kilitli

**Status:** done  
**Dependencies:** 152.5, 152.7, 152.8  

İki adımlı doğrulama bir insanın yürüdüğü yolla kanıtlanıyor.

**Details:**

NE YAPILACAK: apps/e2e/tests/two-factor.spec.ts (yeni) — tek oturumda tam yolculuk:
1. Ajan hesap ayarından 2FA yı etkinleştirir (secret UI dan okunur, test TOTP kodunu kendisi üretir).
2. Kurtarma kodları gösterilir ve saklanır.
3. Çıkış → yeniden giriş: parola sonrası KOD adımı geliyor.
4. Yanlış kod reddediliyor (alan-altı hata).
5. Doğru kod ile giriş başarılı.
6. Çıkış → kurtarma kodu ile giriş başarılı.
7. AYNI kurtarma kodu ikinci kez reddediliyor.
8. require_two_factor açık bir çalışma alanında kaydı olmayan ajan kilitli (kayda yönlendiriliyor).
Kanıt PNG leri apps/e2e/kanit/ altına (mevcut adlandırma desenine uy).

DOSYALAR: apps/e2e/tests/two-factor.spec.ts (yeni) · apps/e2e/tests/fixtures.ts (gerekirse yardımcı) ·
apps/api/prisma/seed.ts (gerekirse 2FA kapalı ikinci bir çalışma alanı).
REFERANS DESEN: apps/e2e/tests/sso.spec.ts — mock IdP ile tam kimlik yolculuğunu yürüyen en yakın süit.
FIXTURE DİSİPLİNİ: tm 147 (E2E-POLLUTION) kuralı geçerli — spec paylaşılan çalışma alanını GERİ VERİR
ve verdiğini DOĞRULAR. 2FA açık bırakılmış bir hesap sonraki spec leri kilitler; temizliği atlama.

TUZAK: test TOTP kodunu üretmek için apps/api/src/lib/totp.ts i doğrudan import edemeyebilirsin
(e2e ayrı paket). Küçük bir yerel üretici yaz ya da paketi uygun şekilde dışa aktar — kararı HANDOFF a yaz.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Fazın gerekçesi + kırılımı: PLAN.md `## 6B.` (bul: `grep -n "^## 6B" PLAN.md`) ve §D124 (bul: `grep -n "D124" PLAN.md | head -3`).
- Bu görevin PRD/kod kimliği: **S11-2FA** (türetilmiş — NFR-S11 + FR-MOD-00.1). Gereksinim satırı: `grep -n "| S11-2FA" PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n "^#### KS11-2FA" PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 5 (Doğruluk) — düz tablo`.

KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.

### 152.10. S11-2FA-j [OPUS-XHIGH] Kilidi aç: rolü agent olan üye kendi 2FA kaydını yapabilsin (DEFAULT_AGENT_SCOPES vs. accounts--my:rw)

**Status:** done  
**Dependencies:** None  

require_two_factor açık bir çalışma alanında agent rolü ne oturum basabiliyor ne kaydını yapabiliyor — zorlama doğru, kayıt yolu kapalı.

**Details:**

ÖLÇÜLEN KUSUR (2026-08-27 · §D126 — dört alt-görevin devrettiği, sahipsiz kalan boşluk):
packages/types/src/role-scopes.ts:32-43 DEFAULT_AGENT_SCOPES accounts--my:ro taşıyor,
accounts--my:rw taşımıyor. Dört kayıt ucunun hepsi accounts--my:rw istiyor
(apps/api/src/routes/auth.ts:915 · 959 · 993 · 1038). scopesWithinRole
(role-scopes.ts:142-145) oturumun kapsamlarını rol tavanıyla HER İSTEKTE kesiyor.
Sonuç kapalı döngü: politika üyeyi dışarıda tutuyor, kayıt ucu da ona kapalı.

NE YAPILACAK:
1. ÖNCE KIRMIZI: agent rolüyle POST /auth/2fa/enroll çağıran bir integration testi yaz ve
   bugünkü reddi ÖLÇ (çıktıyı kanıt maddesine yaz) — sonra düzelt.
2. Yüzeyi SAY, sonra karar ver: accounts--my:rw ile korunan TÜM uçları listele
   (grep -rn "accounts--my:rw" apps/api/src/routes). DEFAULT_AGENT_SCOPES a accounts--my:rw
   eklemek (152.5 in (a) seçeneği) o uçların HEPSİNİ agent rolüne açar — listede kendi hesabı
   dışına çıkan bir uç varsa bu seçenek YANLIŞTIR. Alternatif: yalnız dört /auth/2fa/* ucunu
   accounts--my:ro + principals agent sözleşmesine indirmek (uçlar id parametresi almıyor;
   başkasının ikinci faktörüne giden yol zaten yok — 152.4 kanıtı). Seçtiğin yolu ve
   ELEDİĞİN yolun gerekçesini kanıt maddesine yaz.
3. Kilidin kapandığını uçtan uca kanıtla: require_two_factor açık çalışma alanında agent rolü
   enroll → activate → oturum basma. GET /auth/me nin two_factor durumu da agent rolüyle
   okunabilmeli (152.4 ün durum kaynağı).
4. Kapsam KAÇMASIN: rol/scope matrisinde başka bir gevşetme YAPMA; packages/types/src/
   role-scopes.test.ts ve scopes.test.ts in mevcut iddiaları korunmalı (birini değiştirmen
   gerekiyorsa nedeni kanıt maddesinde adıyla yazılır).

DOSYALAR (beklenen): packages/types/src/role-scopes.ts VEYA apps/api/src/routes/auth.ts ·
test packages/types/src/role-scopes.test.ts · apps/api/test/integration/two-factor-enrollment.test.ts
(yeni blok) · gerekirse apps/api/test/integration/two-factor-enforcement.test.ts.
REFERANS: SEC-2 / tm 146 (scopesWithinRole in neden var olduğu — §D118).

SIRA: bu alt-görev 152.9 dan ÖNCE bitmeli; e2e senaryosu agent rolüyle de yürüyebilsin.

### 152.11. S11-2FA-k [OPUS-XHIGH] Kayıt kapısı: require_two_factor açık alanda oturumu olmayan üyenin girişi yok (role bağımsız kilit)

**Status:** done  
**Dependencies:** None  

Faktörü olmayan + oturumu olmayan üye require_two_factor açık bir alanda ne giriş yapabiliyor ne kaydını yapabiliyor; enroll ucu oturum istiyor, oturum da faktör istiyor.

**Details:**

ÖLÇÜLEN KUSUR (2026-08-27 · tm 152.10 penceresinde ölçüldü ve TESTLE ÇİVİLENDİ, düzeltilmedi):
apps/api/test/integration/two-factor-enrollment.test.ts · "is still shut out with no session,
no factor and the policy on" bugünkü davranışı sabitliyor: /auth/authorize 401
two_factor_required + details.enrollment_required döner (S11-2FA-e, DOĞRU), ve kimliksiz
POST /auth/2fa/enroll 401 döner (oturumsuz kayıt ucu YOK). Dört kayıt ucunun dördü de
`principals: ['agent']` + `accounts--my:rw` istiyor, yani hepsi bir oturum gerektiriyor.

NEDEN 152.10 DEĞİL: 152.10 rol/scope kusuruydu (DEFAULT_AGENT_SCOPES accounts--my:rw
taşımıyordu) ve kapandı. Bu kalan kilit ROLE BAĞIMSIZDIR — owner da, admin de aynı durumda
sıkışır — dolayısıyla farklı bir kusur ve farklı bir çözüm ister.

KİMİ VURUYOR: (a) require_two_factor açık bir alana yeni davet edilen üye (hiç oturumu
olmadı); (b) kaydını yapmadan çıkış yapmış üye; (c) authenticator'ı bozulan + kurtarma
sayfasını kaybeden üye. Tek üyeliği o alandaysa ürüne girişi kalıcı olarak yoktur.
152.7'nin web tarafındaki `enrollment_required` paneli bu sınırı zaten dürüstçe taşıyor
(/app/settings'e link verir, oturumsuzken o rota sign-in'e döner) — panel çalışıyor, arkasında
uç yok.

NE YAPILACAK (öneri, ölçerek karar ver):
1. Parolası doğrulanmış ama faktörü olmayan çağırana, /auth/authorize'ın reddiyle BİRLİKTE
   dar kapsamlı + kısa ömürlü bir KAYIT kimliği ver (yalnız accounts--my:rw, yalnız
   /auth/2fa/enroll + /auth/2fa/activate, dakikalar mertebesinde TTL, tek kullanım).
   Genel bir oturum BASMA — kayıt bitmeden ürünün geri kalanına erişim olmamalı.
2. Sadece require_two_factor açıkken ve hesabın AKTİF faktörü yokken üret; aktif faktörü olan
   hesap bu yola HİÇ girmemeli (yoksa kod sorma kapısı atlanır — S11-2FA-e'nin ilk dalı).
3. Denetim: kaydın bu yolla yapıldığı ayırt edilebilsin (mevcut
   security.two_factor_enrollment_required olayının yanına).
4. Kontrat + web: /auth/authorize yanıtına yeni alan → OpenAPI + @siyahtus/types + typed client;
   SignInPage'in `enrollment_required` paneli artık gerçekten kaydı bitirebilsin (152.7'nin
   bıraktığı "bilinen sınır" notu kapanır).
5. Mevcut çivi testini GÜNCELLE (silme): "hâlâ kilitli" iddiası "kayıt kapısından geçebiliyor,
   ama yalnız kayıt uçlarına" iddiasına dönüşmeli.

TUZAK: bu kapı, S11-2FA-e'nin kapattığı deliği geri açmanın en kolay yoludur. Kayıt kimliğinin
başka HİÇBİR ucu açmadığı negatif testle kanıtlanmalı (inbox, /auth/me dışı her şey 403).

DOSYALAR (beklenen): apps/api/src/routes/auth.ts · packages/contract/openapi/* + @siyahtus/types ·
apps/web/src/features/auth/SignInPage.tsx · test apps/api/test/integration/two-factor-enrollment.test.ts
+ two-factor-enforcement.test.ts · apps/web/src/features/auth/SignInPage.test.tsx.
REFERANS: tm 152.5 (enforceSecondFactor'ın üç dalı) · tm 152.7 (enrollment paneli) · tm 152.10
(role/scope yarısı, kapandı).

### 152.12. S11-2FA-l [SONNET-XHIGH] SignInPage: "Use a recovery code instead" fare ile ilk tıklamada çalışmıyor (blur → FieldError → düğme kayıyor)

**Status:** done  
**Dependencies:** None  

Kod adımındaki mod değiştirme düğmesi, kutunun autoFocus'u yüzünden ilk fare tıklamasında click üretmiyor; yalnız odaklanıyor.

**Details:**

ÖLÇÜLEN KUSUR (2026-08-27 · tm 152.9 penceresinde e2e yazılırken ölçüldü, düzeltilmedi):
apps/web/src/features/auth/SignInPage.tsx — kod adımı açıldığında `#two-factor-code` girdisi
`autoFocus` taşıyor. "Use a recovery code instead" düğmesine FARE ile basıldığında:
mousedown → girdi blur olur → `codeForm.blur('code')` alanı touched yapar → boş alan
`auth.validation.codeRequired` ("Enter your code.") hatasını kazanır → `FieldError`
(`lib/form.tsx:264`, mesaj yokken `null` döner) bir `<p class="mt-1 text-xs">` EKLER →
formun altındaki düğme satırı ~20px aşağı kayar → mouseup düğmenin ESKİ yerine düşer →
mousedown/mouseup hedefleri farklı olduğu için tarayıcı düğmede `click` ÜRETMEZ.
Sonuç: mod değişmez, düğme yalnız odaklanır. Üç ardışık koşuda üçünde de aynı (Playwright
aria snapshot: `button "Use a recovery code instead" [active]`, etiket hâlâ
"Authentication code"). Gerçek bir insan da aynı şeyi yaşar — basıp bırakma arasındaki ~80 ms,
React'in yeniden render'ından uzun.

KAPSAM: yalnız görsel/etkileşim kusuru, güvenlik değil. Kurtarma koduyla giriş İKİNCİ
tıklamada çalışıyor; klavye yolu (Tab + Enter) ilk seferde çalışıyor.

NE YAPILACAK (öneri, ölçerek karar ver):
1. En dar düzeltme: `FieldError` yer ayırsın (mesaj yokken de sabit yükseklik) — ama bu TÜM
   formları etkiler, önce ölç (aynı desen her ekranda var; başka düğmeler de kayıyor olabilir).
2. Alternatif: kod adımının mod düğmelerini formun ÜSTÜNE al ya da hata satırını girdinin
   altında mutlak konumlandır, böylece akış kaymasın.
3. Alternatif: boş+dokunulmamış alanda blur'da required hatasını gösterme (yalnız submit'te).
DOĞRULAMA: `apps/e2e/tests/two-factor.spec.ts` içindeki `useRecoverySheet` yardımcısı bugün
`press('Enter')` kullanıyor ve NEDENİNİ dosyada yazıyor; düzeltme sonrası onu `click()`e
çevir — geçerse kusur gerçekten kapanmıştır. Ayrıca `SignInPage.test.tsx`'e jsdom seviyesinde
bir iddia eklenemez (layout yok), yani kanıt e2e'dedir.
DOSYALAR (beklenen): apps/web/src/features/auth/SignInPage.tsx · apps/web/src/lib/form.tsx
(dokunulursa TÜM form ekranlarının görsel testleri) · apps/e2e/tests/two-factor.spec.ts.

### 152.13. S11-2FA-m [SONNET-XHIGH] Kapı flake'i: two-factor-enforcement.test.ts sürüklenme iddiası adım sınırında kırmızı veriyor

**Status:** done  
**Dependencies:** None  

"refuses a code that is more than one step out" testi, kodun hesaplandığı an ile sunucunun ölçtüğü an arasına 30 sn'lik adım sınırı girerse 200 alıp düşüyor.

**Details:**

ÖLÇÜLEN FLAKE (2026-08-27 · tm 152.9 penceresinde api integration shard 3/3'te bir kez görüldü):
apps/api/test/integration/two-factor-enforcement.test.ts:191-197
`it('refuses a code that is more than one step out')` →
`expect((await authorize(fx.a, { code: code(secret, 2) })).statusCode).toBe(401)`
düştü: `expected 200 to be 401`. Dosya tek başına yeniden koşulduğunda 20/20 yeşil, shard
yeniden koşulduğunda 33 dosya / 644 test yeşil. tm 152.9 yalnız `apps/e2e`'ye dokundu, yani
regresyon değil — testin kendi zamanlaması.

KÖK NEDEN: yardımcı `const code = (secret, offset = 0) => generateTotpForStep(secret,
totpStep(Date.now()) + offset)` (satır 108-109) adımı ÇAĞRI ANINDA sabitliyor. Sunucu ise
`enforceSecondFactor` içinde KENDİ `Date.now()`'unu okuyor ve arada parola KDF'i var
(argon2 ~100-300 ms). Araya bir adım sınırı girerse sunucunun `current`'ı N+1 olur ve testin
"iki adım ötede" sandığı kod ±1 sürüklenme penceresine düşerek KABUL edilir. Aynı tuzak
`code(secret, 1)`'in beklendiği yerlerde ters yönde de vardır (N+1 → N+2 olur, reddedilir).
Olasılık kabaca (KDF süresi / 30 sn) ≈ %1 — nadir, ama tam suite çok testli olduğu için
düzenli aralıklarla görünür.

NE YAPILACAK (öneri): adımı bir kez sabitle ve hem kodu hem beklentiyi ondan türet — ör.
testin başında `const base = totpStep(Date.now())` alıp `generateTotpForStep(secret, base + 2)`
kullan VE çağrıdan hemen önce adımın hâlâ `base` olduğunu doğrula; sınıra çok yakınsa
(`Date.now() % 30_000 > eşik`) bir sonraki pencerenin başlangıcını bekle. Sahte saat
(`vi.useFakeTimers`) burada işe yaramaz — kodu üreten test süreci ile ölçen sunucu aynı
süreçte ama farklı anlarda okuyor; en dürüst çözüm sınırdan kaçınmak.
TUZAK: iddiayı gevşetme (401'i "401 veya 200" yapma) — testin kanıtladığı şey tam olarak
sürüklenme penceresinin ±1 ile sınırlı olduğu; gevşetilirse kanıt yok olur.
DOSYALAR (beklenen): apps/api/test/integration/two-factor-enforcement.test.ts (yalnız test).
