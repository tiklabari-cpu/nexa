# Task ID: 249

**Title:** V8-SESSION-DROP [OPUS-XHIGH] settings.spec.ts:971 tam kosuda oturumu kaybediyor: /auth/token 200 -> /auth/me 401 -> giris ekrani

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Uzun bir tam e2e kosusunda imzali bir sayfa yeniden yuklenince oturum olmuyor ve app giris formuna donuyor. Ayni dosya izole kosuldugunda 27/27 yesil. Ag izinden OLCULDU: rotasyondan taze gelen access token ANINDA 401 aliyor, ikinci refresh de reddediliyor.

**Details:**

OLCUM (tm 247, 2026-09-12, tam suit kosu 2/2). Kirmizi: apps/e2e/tests/settings.spec.ts:979 -- getByRole("region",{name:"Personal access tokens"}) bulunamadi. error-context.md'nin sayfa gorutusu ne oldugunu soyluyor: sayfa GIRIS FORMU ("Sign in to your workspace"), yani /app/settings'e gidildiginde oturum yoktu. Locator degil oturum kusuru.

AYNI DOSYA IZOLE KOSULDUGUNDA YESIL: cd apps/e2e && npx playwright test tests/settings.spec.ts tests/widget.spec.ts -> settings'in 27 testinin 27'si gecti.

AG IZI (trace.zip icindeki *-trace.network cozuldu; olculdu, tahmin degil). Sirayla: signIn basarili (POST /auth/login 200 x2, POST /auth/authorize 200, POST /auth/token 200, GET /auth/me 200), inbox tamamen yuklendi (~30 istek, hepsi 200), sonra goto("/app/settings") yeniden yuklemesi: POST /auth/token 200 (auth-store.ts restore(), saklanan refresh token ile rotasyon) -> GET /auth/me 401 -> POST /auth/token 401 -> signed-out, giris formu. Yani rotasyon BASARILI oldu ama o rotasyondan gelen access token hemen 401 aldi ve ikinci refresh denemesi de reddedildi.

IKI ADAY MEKANIZMA -- IKISI DE OLCULMELI, VARSAYILMAMALI:
(a) OTURUM TAVANI KENDI TOKENINI BUDUYOR. apps/api/src/services/auth/token-service.ts 446-459: her basimda pg_advisory_xact_lock altinda, createdAt azalan siraya gore cap kadarini atlayip geri kalanini revoke ediyor. cap = security_settings.max_concurrent_sessions ?? MAX_ACTIVE_TOKENS_PER_OWNER (25), ve tohumda kolon NULL, yani 25. Bir tam kosuda demo sahibi 872 oauth token bastiriyor (veritabanindan sayildi; live 25). createdAt esitliginde siralama belirsizdir ve ikincil siralama YOK, dolayisiyla yeni satirin skip sinirinin otesine dusup kendi budamasiyla revoke edilmesi teorik olarak mumkun -- olculmeli.
(b) REFRESH TOKEN YENIDEN KULLANIMI AILEYI IPTAL EDIYOR. apps/web/src/lib/auth-store.ts restore() rotasyondan sonra writeStored(REFRESH_KEY, ...) yaziyor; single-flight kilidi YOK, yani iki 401'in ayni anda tetikledigi iki refresh eski refresh token'i ikinci kez kullanabilir ve api_tokens.family_id'ye dayali aile iptali butun oturumu dusurur. auth-store.ts 280'in kendi yorumu bu yolu zaten adlandiriyor: "A refresh token that no longer works means the family was revoked".

YAPILACAK IS: (1) Hangi aday oldugunu OLC: api_tokens satirlarinin revoked_at damgalari (hangi satir, ne zaman) + rotasyonun dondurdugu token id'si + api loglari. (2) Kok neden (a) ise budamaya belirleyici bir ikincil siralama (id) ve/veya "az once basileni asla budama" korumasi; (b) ise istemciye single-flight refresh. (3) Her iki halde de integration testi, once KIRMIZI. (4) e2e tarafinda ayrica dusunulmeli ve karara baglanmali: suit bir kosuda tek bir sahibe 872 oturum basiyor (her test formdan giriyor), tavanin 35 kati. Playwright storageState ile tek oturumun paylasilmasi bu sinifi kokunden kaldirir ama buyuk bir fixture refactorudur; karar PLAN'a yazilmali.

TUZAKLAR: 1) pnpm --filter @siyahtus/e2e test -- <dosya> FILTRELEMIYOR; npx playwright test kullan. 2) Kok .env elle alinmali: set -a && . ./.env && set +a. 3) Iki pencere ayni anda e2e kosamaz. 4) trace ag izi icin: unzip trace.zip && *-trace.network dosyalarindaki resource-snapshot satirlarini oku.

**Test Strategy:**

No test strategy provided.
