# Task ID: 129

**Title:** M-GATE-a [OPUS-XHIGH] DoD kapısının objektifliği: `pnpm -w test` altında mobil jest süiti deterministik (zaman aşımı + RNTL "attached view" kırmızıları) — §D112

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** 2026-08-17 ölçümü (§D112): `pnpm -w test` turbo paralelliğinde apps/mobile jest süiti 4 kırmızı verdi (NotificationsScreen "shows a loading state" 5000 ms zaman aşımı; App.test 3× "Unable to locate attached view in the native tree"), aynı süit tek başına 389/389 · 25 s. Kapı bu makinede yük altında objektif değil; CONVENTIONS §1.1 "kırmızıyı başka pencereye yükleme" kuralı bu durumda yanlış teşhise zorlar. Bu görev kapıyı deterministik yapar — testi susturarak DEĞİL.

**Details:**

BULGU (bu turda ölçüldü, tahmin değil): `pnpm -w test` → `@siyahtus/mobile#test` exit 1:
- `src/features/notifications/NotificationsScreen.test.tsx` "shows a loading state before preferences
  arrive" → "Exceeded timeout of 5000 ms" (dosya toplam 40.9 s);
- `src/App.test.tsx` üç senaryo → "Unable to locate attached view in the native tree" (dosya 29.3 s);
- Test Suites: 2 failed, 31 passed · Tests: 4 failed, 385 passed · süre 77 s (turbo altında, api/web
  vitest süitleriyle aynı anda). Aynı süit `cd apps/mobile && pnpm test` → 33/33 · 389/389 · 24.6 s.
Yani kusur test mantığında değil, YÜK ALTINDA ZAMANLAMADA: jest-expo dosyaları 13–40 s sürüyor,
varsayılan `testTimeout` 5000 ms, RNTL sorguları render bitmeden çalışıyor. HANDOFF/PLAN'da benzeri
kayıt: web vitest'in yük altında 5000 ms flake'i (hafıza notu "--maxWorkers=4 settles it") ve
13.7-h'nin push-notifications zamanlama flake'i.

NE YAPILACAK (ÖNCE ÖLÇ, SONRA DÜZELT — sırayla ve her adımı kanıtla):
1) Taban ölçümü: 3 ardışık `pnpm -w test` koşusu; her koşuda mobil süitin süresi ve kırmızı sayısı
   (`.loop-logs` değil, HANDOFF notuna yaz).
2) Kök nedenleri ayır: (a) `getBy*` sonrası asenkron güncelleme bekleyen testler → `findBy*`/`waitFor`
   (mesaj "Unable to locate attached view" çoğu zaman budur); (b) gerçekten uzun süren render'lar →
   `jest.config.js` `testTimeout: 20000` (gerekçesi dosya başına yorumla; 30000 üstü KABUL DEĞİL —
   o zaman test tasarımı yanlıştır); (c) CPU açlığı → `apps/mobile/package.json` `test`:
   `jest --ci --maxWorkers=50%` (ya da sabit 2; ölç) ve/veya kök `turbo.json` `test` görevine
   mobil için sınır — turbo'da görev bazlı concurrency yok, `pnpm -w test` script'ine
   `--concurrency=<n>` eklemek TÜM paketleri yavaşlatır; önce jest tarafını dene.
3) Kanıt: 3 ardışık `pnpm -w test` koşusu exit 0 (bu makinede) + tek başına süit süresi ≤ 40 s.
4) Kayıt: §D112'ye ölçümü ve seçilen çözümü ekle (D112 bu turda açıldı; sen "çözüm" paragrafını
   yazarsın) · CONVENTIONS §1.1'e bir cümle: "mobil süit yük altında zaman aşımına düşerse …" YERİNE
   kalıcı çözüm — kural eklemek değil, kapıyı deterministik yapmak hedef; yine de kalan bir tolerans
   varsa yaz.
5) HANDOFF'a "M-GATE" notu; hafıza notlarını (kişisel) değil depo belgesini güncelle.

DOSYALAR: `apps/mobile/jest.config.js` · `apps/mobile/package.json` · ilgili `*.test.tsx` (yalnız
sorgu deseni; assert'ler DEĞİŞMEZ) · `PLAN.md` §D112 · `CONVENTIONS.md` (gerekirse) · `HANDOFF.md`.
REFERANS: `apps/mobile/jest.setup.js` (IS_REACT_ACT_ENVIRONMENT notu) · `App.test.tsx` mevcut
`findByText` kullanımları · web tarafı emsali §D82 (locale flake'i testi pinleyerek kapattı, ürün
kodu değişmedi).
KAPSAM DIŞI: ürün kodu (apps/mobile/src dışı test dosyaları hariç DEĞİŞMEZ) · testi `skip` etmek ·
`--forceExit`/`--detectOpenHandles` ile örtmek · api/web süitleri.
TUZAK: `testTimeout`'u yükseltmek tek başına "Unable to locate attached view"i çözmez — o sorgu
zamanlamasıdır; ikisini ayrı ölç.

BAĞLAM (bu pencere sıfırdan açılır — hafızaya değil dosyalara güven):
- Önce TASK-RUNNER-PROMPT.md §0 sırası: MASTER-PROMPT.md · CONVENTIONS.md · bu görev · PLAN.md (dar okuma) · git log.
- Faz-4'ün gerekçesi + kırılımı: PLAN.md `## 6A.` (bul: `grep -n '^## 6A' PLAN.md`) ve §D111–§D113 (bul: `grep -n '^- \*\*D11[123]' PLAN.md`).
- Bu görevin PRD/kod kimliği: **M-GATE (türetilmiş — CONVENTIONS §1 DoD kapısı · NFR-M4)**. Gereksinim satırı: `grep -n '| M-GATE' PLAN.md | cut -c1-200` (durum damgalı satır).
- Kanıt bloğu: `grep -n '^#### KM-GATE' PLAN.md` → kapanışta maddeyi bu bloğun SONUNA ekle (CONVENTIONS §1.2 — hücreye kanıt YAZMA).
- Faz-4 düz tablosu (etiket · bağımlılık · dilim): PLAN.md `### Faz 4 (Bütünleme) — düz tablo`.
PLAN §7.2 tablosunda `M-GATE` satırı bu turda `⬜ → KM-GATE` olarak açıldı; kapanışta `✅ → KM-GATE` yap ve `#### KM-GATE` bloğuna maddeyi ekle.
KAPANIŞ (TASK-RUNNER-PROMPT §3, sıra önemli): PLAN.md damga + K bloğu maddesi → HANDOFF.md kısa not (en üst, `## Task log (newest-first)` altı) → `git add -A` + Conventional Commit + push → Task Master done → son çıktı JSON.
DoD kapısı (CONVENTIONS §1, exit code'larla): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w format:check` · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · ilgili `pnpm -w test:e2e` · kontrat değiştiyse `pnpm -w contract:generate` sonrası `git status` temiz · migration varsa `pnpm -w db:check-drift`.
Kapı komutlarını ARKA PLANA ATMA (TASK-RUNNER-PROMPT §2) — ön planda, yeterli timeout ile koş.
<info added on 2026-08-17T22:53:28.555Z>
I'll analyze the codebase to understand the current state of the relevant test files and provide accurate information for the task update.Now I have all the context needed. Let me provide the update text for the task details:

EK FLAKE GÖZLEM (tm 128.4 · 13.7-s turu, 2026-08-18):

(1) ChatScreen.test.tsx zaman aşımı (§D112 sınıfı):
Dosya: `apps/mobile/src/features/inbox/ChatScreen.test.tsx`
Senaryo: "shows the conversation, newest message included" (satır 87–102)
Hata: `Exceeded timeout of 5000 ms`
Bağlam: `pnpm -w test` turbo altında; dosya tek başına 11/11 · 1.8 s. Aynı koşuda 3 suite / 2 test de kırmızı görüldü — miktar değişken. Sonraki tam koşu 11/11 görev exit 0 (api 3251 · mobil 465/465 · 41 dosya).
Testin yapısı: `mount()` fonksiyonu `render()` sonrası `await act(async () => {})` ile settle ediyor (satır 74–84); `screen.getByText()` senkron sorgu — yük altında async güncelleme bitmeden koşuyor olabilir. Potansiyel düzeltme: `getByText` yerine `findByText` ya da `waitFor` sarmalayıcısı.

(2) push-notifications.test.ts saat kayması (§D87 sınıfı — ilk kez integration tarafında):
Dosya: `apps/api/test/integration/push-notifications.test.ts`
Senaryo: "does not push to a handset that was signed out" (satır 235–244)
Hata: `PrismaClientUnknownRequestError` · Postgres 23514 `device_tokens_revoked_check`
Mekanizma: Test satır 237–238'de `owner.deviceToken.updateMany({ data: { revokedAt: new Date() } })` çağırıyor. `revokedAt` NODE saatinden yazılıyor, `created_at` DB saatinden geliyor (`DEFAULT CURRENT_TIMESTAMP`, migration satır 41). Saat farkı 1 ms bile olursa `revoked_at < created_at` ve CHECK (migration satır 100–102: `CHECK (revoked_at IS NULL OR revoked_at >= created_at)`) ihlal ediliyor.
Düşen satır örneği: `revoked_at = …44.354Z`, `created_at = …44.355Z` (1 ms ÖNCE).
Dosya tek başına 14/14 · 6.3 s; ikinci tam koşu 90/90 · 2374/2374 exit 0.
Emsal çözüm (§D87): `registerDevice()` helper'ında revoke edilecek satır için açık `createdAt` yazmak (mevcut kod satır 109–124 zaten `revokedAt` varsa `createdAt: new Date(revokedAt.getTime() - 60_000)` geçiyor — ama bu sadece seed anında geçerli; updateMany yolunda aynı koruma YOK). Önerilen düzeltme: "does not push to a handset that was signed out" testinde `revokedAt`'i doğrudan `new Date()` yerine, ilgili satırın `created_at`'inden türetilmiş bir değer olarak yazmak (ör. `await owner.$queryRaw` ile `created_at + interval '1 second'` almak ya da Prisma select → JS hesabı). Testi skip etmek/susturmak kabul değil (CONVENTIONS §1.1).

Bu iki flake M-GATE kapsamına eklendi; çözüm bu görev içinde uygulanacak.
</info added on 2026-08-17T22:53:28.555Z>

**Test Strategy:**

- 3 ardışık `pnpm -w test` koşusu exit 0 (bu makinede; süreleri HANDOFF'a yaz).
- `cd apps/mobile && pnpm test` 389/389 (ya da o günkü toplam) ve ≤ 40 s.
- `pnpm -w typecheck` · `lint` · `format:check` exit 0.
- Ölçülebilir: hiçbir testte `.skip`/`.only`; `testTimeout` ≤ 20000; değişen test dosyalarında assert sayısı azalmadı (`git diff --stat` + göz).
- PLAN §7.2 `M-GATE` satırı `✅ → KM-GATE`; §D112'ye çözüm paragrafı; HANDOFF notu.
