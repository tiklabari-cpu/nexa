# Task ID: 124

**Title:** C4-h [OPUS-XHIGH] Signup bölge kapısı — bir dağıtım BAŞKA bölgenin çalışma alanını kendi veritabanına yaratmasın

**Status:** done

**Dependencies:** 82 ✓

**Priority:** medium

**Description:** C4-g'nin (tm 82.7) uçtan uca doğrulamasında bulundu: `POST /auth/signup` anonim olduğu için bölge kapısının ÖNÜNDEDİR, ve `eu` süreci `region: 'us'` gövdesini kabul edip organizasyonu Avrupa veritabanında yaratır.

**Details:**

BULGU (tm 82.7 · `C4-g` uçtan uca doğrulama · PLAN §K KC4):

`POST /auth/signup` `config: { public: true }` taşır; bölge karşılaştırması (`plugins/auth.ts`) token
çözümünden SONRA çalıştığı için bu ucun önünde HİÇ yoktur. Sonuç, tarayıcıda birebir gözlendi
(`apps/e2e/tests/compliance.spec.ts`, ilk test):

1. Avrupa dağıtımının signup formunda "United States" seçilir.
2. `auth_signup` çalışır — `organizations` (region=`us`) + sahip `accounts` + `licenses` satırları
   **Avrupa veritabanında** yaratılır. 201 döner.
3. Ardından gelen `signIn` 421 alır; kurucu içeri HİÇ giremez.

Yani bugünkü davranış: çalışma alanı yanlış bölgede DOĞAR, sonra sonsuza dek erişilemez kalır.
NFR-C4'ün iddiası ("veriler seçilen bölgede durur") ilk yazma anında ihlal ediliyor, ve ihlal
edilen satırlar kimsenin silmediği yetim satırlar olarak kalıyor. `C4-b`'nin widget token
basımında aynı akıl yürütme zaten uygulanmış durumda ("reddetmeden ÖNCE yazma" — `routes/auth.ts`,
ziyaretçi satırı yaratılmadan önce bölge kontrolü); signup'ta yok.

NEDEN AYRI GÖREV: `C4-g` bir DOĞRULAMA kalemidir; düzeltme `C4-b` (zorlama çekirdeği) /
`C4-c` (signup akışı) alanıdır ve yeni bir ürün kararı gerektirir (aşağıya bak). Kapsam
disiplini (CONVENTIONS §5) gereği tm 82.7 bunu yeşil bir teste gömmedi — e2e yalnız doğru olan
yarısını iddia ediyor (üç kapı da 421 ile reddediyor).

KARAR GEREKTİREN NOKTA (bu görevin ilk işi, uydurma yok): bir dağıtım kendi bölgesine ait
OLMAYAN bir signup ile ne yapmalı? Üç aday:
  (a) REDDET — 421 `misdirected_request` + `details.region`, hiçbir satır yaratmadan. En basit,
      `C4-b`'nin widget basımıyla birebir tutarlı, ve istemciye doğru kapıyı söylüyor.
  (b) YÖNLENDİR — istemciyi o bölgenin dağıtımına gönder (`Location`/istemci tarafı). Ürün olarak
      daha nazik ama bu depoda ikinci bir dağıtımın adresi YOK (ADR-12 · tek dağıtım MOCK).
  (c) SEÇİMİ DARALT — signup formu yalnız bu dağıtımın bölgesini sunsun. `C4-c`'nin seçicisini
      anlamsızlaştırır; PRD'nin "kayıtta bölge seçimi" iddiasını zayıflatır.
Öneri (a): tek dağıtımlı bu depoda yalnız (a) hem yazmayı önler hem seçiciyi korur; (b) gerçek
çok-bölgeli dağıtımda (a)'nın üstüne eklenir, (a)'nın yerine değil.

KAPSAM: (1) `POST /auth/signup` (ve varsa aynı sınıftaki diğer anonim yazan uçlar — taranacak)
bölgesi bu dağıtıma ait olmayan gövdeyi **hiçbir satır yaratmadan** reddeder. (2) `C4-c`'nin
signup ekranı bu reddi anlaşılır biçimde gösterir (bugünkü "Could not create that workspace."
metni YANILTICI — çalışma alanı yaratıldı, sonra erişilemez oldu; bu metin de bu görevde
düzeltilir). (3) Bu tur öncesinde yaratılmış yetim `us` satırları için ne yapılacağı yazılı
karara bağlanır (temizlik script'i mi, dokunulmuyor mu) — sessiz bırakılmaz.

DOSYALAR: `apps/api/src/routes/auth.ts` (signup) · `apps/api/prisma/…/auth_signup` (gerekirse) ·
`apps/web/src/features/auth/PublicPages.tsx` (`SignUpPage` hata metni) ·
`apps/api/test/integration/region.test.ts` · `apps/e2e/tests/compliance.spec.ts`

REFERANS DESEN (birebir): `apps/api/src/routes/auth.ts` `POST /customer/token` — bölge kontrolü
ziyaretçi satırı yaratılmadan ÖNCE, ban okumasının bile önünde; gerekçesi yorumda yazılı
("hatayı bildirmeden önce ihlali işlemek olurdu"). Signup'ta gereken tam olarak aynı sıralama.

SINIRLAR (CLAUDE.md): dış servisler MOCK · production deploy/DNS/TLS/gerçek secret/ödeme YOK ·
force-push/DB drop/history rewrite YOK.

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN §K KC4'teki `⬜` maddesi kapatılır (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

**Test Strategy:**

pnpm --filter @siyahtus/api test:integration (`eu` dağıtımında `region: 'us'` signup REDDEDİLİR ve organizations/accounts/licenses sayıları DEĞİŞMEZ — "eu'ya düşürüldü" değil, "hiç yaratılmadı"; kendi bölgesindeki signup hâlâ 201; `us` dağıtımında ayna testi (ikinci sunucu `SIYAHTUS_REGION=us`) — orada `us` geçer, `eu` reddedilir) && pnpm --filter @siyahtus/web test (signup ekranı reddi doğru metinle gösterir) && pnpm -w typecheck && pnpm -w lint && pnpm -w build && pnpm -w test:e2e (compliance.spec.ts'in ilk testi bugünkü "yaratıldı ama giremiyor" akışından "hiç yaratılmadı" akışına GÜNCELLENİR)
