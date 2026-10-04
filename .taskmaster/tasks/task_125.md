# Task ID: 125

**Title:** 13.7-l [OPUS-XHIGH] Mobil cihaz kaydının bağlanması — telefon /notifications/devices'ı gerçekten çağırsın

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** `13.7-j`'nin başlığındaki iki paydan ikincisi ("+ cihaz kaydının bağlanması") teslim edilmedi: `DeviceTokenLifecycle` uygulamaya sağlayıcısız ve transport'suz bağlandığı için telefon `/notifications/devices` ucunu HİÇ çağırmıyor. Sunucu yarısı (13.7-c/-d) eksiksiz ve testli; bu görev telefon yarısını bağlar.

**Details:**

BULGU (tm 90.11 · `13.7-k` parite matrisi · HANDOFF "Sonraki pencereye not"):

`apps/mobile/src/auth/device-token.ts`'teki `DeviceTokenLifecycle` üç anı (açılış · çıkış · hesap
değişimi) doğru SIRAYLA yönetir ve testlidir, ama uygulamaya **sağlayıcısız ve transport'suz**
bağlanmıştır: `apps/mobile/src/auth/session.ts:131` — `new DeviceTokenLifecycle({ store })` —
yani provider `noDeviceToken` (her zaman `null` döner) ve transport `null`. Sonuç: telefon
`/notifications/devices` ucunu HİÇ çağırmaz. Bu, tm 90.11'in parite matrisinde teste yazılmış
iki açık borçtan biridir:

  apps/mobile/src/__tests__/parity.test.ts:221  (OPEN_DEBTS)
  apps/mobile/src/__tests__/parity.test.ts:367  expect([...REQUESTED]).not.toContain('/notifications/devices')

Sunucu yarısı EKSİKSİZ ve testli — bu görev sunucuya dokunmaz:
- `apps/api/src/routes/notifications.ts` — `GET /notifications/devices` (scope `agents--my:ro`),
  `POST /notifications/devices` (scope `agents--my:rw`; `(license, token)` üzerinde upsert +
  `revokedAt` diriltme + satırı çağırana taşıma), `DELETE /notifications/devices/:deviceId`.
- Sözleşme: `packages/contract/openapi/openapi.yaml:250` ve `:252`. Uçlar BELGELİ — yeni
  sözleşme yazılmayacak.
- Push gönderim çekirdeği `13.7-d` (tm 90.4) + `apps/api/test/integration/push-lifecycle.test.ts`
  (tm 90.11) kayıt→gönderim→yenileme→rotasyon→iptal→reddi zincirini HTTP üzerinden doğrular.

NEDEN AYRI GÖREV: tm 90.10 (`13.7-j`) yalnız bildirim tercihleri ekranını teslim etti ve cihaz
kaydını bilinçli olarak erteledi ("Cihaz token'ı kayıt/iptal bu alt-görevde DEĞİL"). tm 90.11 bunu
düzeltmek yerine KAYDETTİ, çünkü bağlamak `expo-notifications` + izin akışı ister — yeni bağımlılık,
doğrulama işi değil. Bu boşluk §D96'nın iki kabul edilen borcundan (mağaza payı · modül paritesi
daraltması) HİÇBİRİ DEĞİLDİR; üçüncü ve KAYITSIZ bir boşluktur. §F.00 bunu iki yoldan biriyle
kapatmayı emreder: "tamamla, ya da kapsamı daralt + kalanı gerekçeli yeni kaleme ayır". Bu görev
"tamamla" seçeneğidir ve Faz-3 kapanış turunun (tm 126) ön koşuludur.

DOKUNULACAK DOSYALAR:
- `apps/mobile/package.json` — `expo-notifications` bağımlılığı. Expo **managed workflow**
  korunur; custom native modül YAZILMAZ (§6.1.6 varsayımı).
- `apps/mobile/src/auth/device-token.ts` — `DeviceTokenProvider` (izin isteği + Expo push token)
  ve `DeviceTokenTransport` (POST/DELETE) gerçek implementasyonları. Arayüzler ZATEN TANIMLI
  (satır 35 ve 41); imzalarını DEĞİŞTİRME, doldur. `noDeviceToken` testlerde kullanılmaya devam
  edebilir ama üretim yolu artık gerçek provider'ı geçmelidir.
- `apps/mobile/src/auth/session.ts:131` — `DeviceTokenLifecycle`'a gerçek provider + transport ver.
- `apps/mobile/src/features/notifications/` — ekranın push satırı bugün `pushAllowed(prefs)`'e göre
  üç cümle üretiyor; **dördüncü durum** eklenir: tercih açık ama CİHAZ İZNİ yok. Sessiz kalmamalı —
  kullanıcı "açık" görüp bildirim almamalı.
- `apps/mobile/src/__tests__/parity.test.ts` — `OPEN_DEBTS`'ten handset maddesini ÇIKAR ve
  ilgili testi tersine çevir. Bu test borç ödendiği gün KIRMIZIYA dönecek şekilde BİLEREK yazıldı
  (dosyadaki yorum: "When it lands, this assertion is the thing that says so"). Kırmızıyı
  susturma — iddiayı güncelle.
- `PLAN.md` — `13.7` satırı `◐ → K13.7` olarak **KALIR** (mağaza payı hâlâ açık, §D96). Kanıt
  metni tabloya değil `#### K13.7` bloğuna madde olarak yazılır (CONVENTIONS §1.2). §6.1.6'nın
  "◐'nin gerekçesi İKİ PAYLIDIR" listesi bu boşluğu zaten kapsamıyordu; yeni §D sapması
  GEREKMEZ — kanıt bloğunda "handset kaydı bağlandı" maddesi yeter.

CONTRACT-FIRST SIRA (bu görevde kısalır — sözleşme ve şema HAZIR):
sözleşme ✅ zaten var (openapi.yaml:250/252) → migration YOK (`device_tokens` tablosu 13.7-c'de
mevcut) → backend YOK (uçlar teslim) → **istemci: transport + provider + unit testler** → ekran
payı (dördüncü push durumu) → parite testinin güncellenmesi → bundle kapısı.

BİLİNEN TUZAKLAR:
- İKİNCİ BİR API İSTEMCİSİ YAZMA: `13.7-b`'nin `SessionApiClient`'ı kullanılır (tm 90.10 aynı
  kararı verdi — "sözleşmeden türetilir, ikinci istemci yok").
- SIRA KURALLARI MUTLAKTIR (dosyanın başındaki iki kural): (1) başarısız `revoke` yerel token'ı
  YİNE DE siler; (2) hesap değişiminde önce revoke, SONRA register (asla ters, asla eşzamanlı).
  `device-token.test.ts` bunları koruyor — testleri gevşetme, implementasyonu onlara uydur.
- İzin reddi GERÇEK bir çalışma durumudur: `getToken()` `null` döner ve yaşam döngüsü no-op olur.
  Bu bir hata yolu değil, normal yol.
- `apps/mobile` testleri `node:*` kullanabilir (tsconfig'te "node" tipleri var) ama ÜRETİM
  KAYNAĞI kullanamaz. `jest.mock` fabrikası yerel bir `const`'a kapanmamalı (hoisting).
- Gerçek APNs/FCM anahtarı YOK (CLAUDE.md: gerçek secret yok). Expo push token'ı alınır;
  gönderim MOCK kalır (`.data/push`), `13.7-d` bunu zaten böyle kuruyor.
- Mobil e2e Playwright ile koşmaz; RN test süiti + integration testleri kapıdır.

KAPSAM SINIRI (neye DOKUNULMAYACAK):
- Sunucu uçları, `device_tokens` şeması/RLS, push gönderim çekirdeği (`13.7-d`) — hepsi teslim
  ve testli. Migration YAZMA.
- `.ipa`/`.apk` üretimi, store yüklemesi: KAPSAM DIŞI (§D96 · CLAUDE.md "production deploy yok").
  Bu görev §D96'nın MAĞAZA payını kapatmaz ve `13.7` satırını `✅` YAPMAZ.
- Billing/Playbook/Team mobil yüzeyleri kapsam dışı kalır (§D96 ikinci pay, §C-A28).
- web/api tarafında davranış değişikliği YOK; api ve web test sayıları değişmemeli.

**Test Strategy:**

pnpm --filter @siyahtus/mobile typecheck && pnpm --filter @siyahtus/mobile lint && pnpm --filter @siyahtus/mobile test && pnpm --filter @siyahtus/mobile build

Ölçülebilir kabul (hepsi exit 0):
1. `pnpm --filter @siyahtus/mobile test` — yeni provider/transport unit testleri yeşil; `device-token.test.ts` ve `session.test.ts` REGRESYONSUZ (sıra kuralları korunur: hesap değişiminde önce revoke sonra register; başarısız revoke yerel token'ı yine de siler).
2. `apps/mobile/src/__tests__/parity.test.ts` — `OPEN_DEBTS` dizisinden handset maddesi DÜŞMÜŞ (dizi 2 → 1 madde) ve "does not register the handset itself" testi TERSİNE çevrilmiş: artık `REQUESTED` kümesi `/notifications/devices` yolunu İÇERİR. Matrisin yol sayımı (13 yol) yeni yolla birlikte güncellenmiş ve "tam eşitlik" iddiası hâlâ geçerli — sınıflanmamış uç kalmamalı.
3. `pnpm --filter @siyahtus/mobile build` — `expo export` ios + android bundle üretir (yeni `expo-notifications` bağımlılığı bundle'ı kırmaz). Bu, 13.7'nin §D96'da kararlaştırılmış DoD kapısıdır.
4. CONVENTIONS §1 DoD kapısının tamamı (typecheck · lint · `pnpm -w test` · `pnpm -w test:integration` · `pnpm -w build` · `pnpm -w test:e2e` · `db:check-drift`) exit 0 — sunucu tarafına dokunulmadığı için api/web sayıları DEĞİŞMEMELİ.
