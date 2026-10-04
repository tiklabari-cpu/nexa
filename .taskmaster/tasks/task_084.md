# Task ID: 84

**Title:** 11.5 — White-label widget · SLA yönetimi · sandbox · dilim V3-3

**Status:** done

**Dependencies:** 81 ✓, 82 ✓

**Priority:** medium

**Description:** PRD §5.4 (Ent.) · FR-MOD-11.5. BULGU: powered_by bugün HİÇBİR plan kapısı taşımıyor — Enterprise özelliği her planda açık.

**Details:**

Faz 3 (Enterprise) · PLAN §6.1 · kalem `11.5` · dilim V3-3

8 atomik alt-görev · ~11 pencere · etiket dağılımı: OPUS-XHIGH x3 · OPUS-MAX x2 · SONNET-XHIGH x3

KK: "Marka linki; Enterprise'da white-label" (FR-MOD-11.5 birebir) + "SLA yönetimi" · "sandbox" (§5.4'ten türetilmiş, §C-A24).

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  11.5-a [OPUS-XHIGH] PLANS kataloğuna enterprise kademesi + entitlements sözlüğü (white_label · sandbox · sla)  (bağ: —)
  11.5-b [OPUS-MAX] Entitlement zorlama çekirdeği (BÖLÜNMEZ) — yazma kapısı + downgrade'de okuma yolunda geri alma  (bağ: 11.5-a)
  11.5-c [SONNET-XHIGH] Widget tarafı — yetki yokken powered_by=0 URL parametresinin yok sayılması  (bağ: 11.5-b)
  11.5-d [OPUS-XHIGH] SLA yönetimi — hedef tanımı (ilk yanıt / çözüm, iş saatleri) + ölçüm + ihlal işareti  (bağ: 11.5-a)
  11.5-e [SONNET-XHIGH] SLA ekranı + Reports'ta ihlal KPI'ı  (bağ: 11.5-d)
  11.5-f [OPUS-MAX] Sandbox lisansı (BÖLÜNMEZ) — ikinci kiracı: izolasyon + faturaya girmeme + kotaya sayılmama  (bağ: 11.5-a, 11.5-b)
  11.5-g [SONNET-XHIGH] Sandbox ekranı — oluştur/sıfırla + "bu bir sandbox" göstergesi  (bağ: 11.5-f)
  11.5-h [OPUS-XHIGH] Uçtan uca doğrulama — white-label reddi/kabulü/downgrade geri alma + sandbox sızıntı negatifi + SLA e2e  (bağ: 11.5-c, 11.5-e, 11.5-g)

BAĞLAM KURULUMU (bu görev KOD YAZMAZ — alt-görevleri koşulur):
- PLAN §6.1.5 kalem kırılımı + bölünmeyen çekirdek gerekçeleri + varsayımlar + açık sorular
- PLAN §6.2 dilim sırası ve sıralamanın gerekçesi · PLAN §G Faz-3 düz tablosu
- CONVENTIONS DoD kapısı · TASK-RUNNER-PROMPT pencere protokolü
- Tam alan detayı her alt-görevin kendi `details` alanındadır (Faz-3'ün companion dosyası YOK — PLAN §D98)

SINIRLAR (CLAUDE.md): dış servisler MOCK · production deploy/DNS/TLS/gerçek secret/ödeme YOK ·
force-push/DB drop/history rewrite YOK · başka repoya dokunma YOK.

**Test Strategy:**

Her alt-görev KENDİ tam DoD kapısından geçer (CONVENTIONS §1): pnpm -w typecheck && pnpm -w lint && pnpm -w test && pnpm -w build && ilgili test:integration/test:e2e — hepsi exit 0. Kalem ancak son doğrulama alt-görevi (11.5-h) yeşil olduğunda ✅ sayılır. Her alt-görevin kendi testStrategy alanı o pencerenin kapı komutlarını verir.

## Subtasks

### 84.1. 11.5-a [OPUS-XHIGH] PLANS kataloğuna enterprise kademesi + entitlements sözlüğü (white_label · sandbox · sla)

**Status:** done  
**Dependencies:** None  

PLANS kataloğuna enterprise kademesi + entitlements sözlüğü (white_label · sandbox · sla)

**Details:**

11.5-a — PLANS kataloğuna enterprise kademesi + entitlements sözlüğü (white_label · sandbox · sla)  [OPUS-XHIGH]

PRD: 11.5 (PLAN §6.1 · dilim V3-3 · tm 84)
TAHMİN: ~1 pencere

NEDEN AÇIK: `apps/api/src/services/billing/subscription-service.ts:21` → `PLANS = { growth: {...} }`, TEK kademe. Kodda "Enterprise planı" kavramı YOK. Yetki sözlüğü de yok; `powered_by` (`routes/settings.ts:181,827`) hiçbir kontrol olmadan kabul ediliyor.

KAPSAM: `PLANS`'a `enterprise` kademesi + kademe→yetki sözlüğü + kontrat yüzeyi (`GET /billing/entitlements`).

**YETKİ SÖZLÜĞÜ — ALTI ANAHTAR** (denetim bulgusu K1-2 ile üçten altıya çıkarıldı): `white_label` · `sandbox` · `sla` · **`sso`** · **`hipaa`** · **`siem_export`**. Son üçü PRD'nin **açıkça "Enterprise"** dediği yeteneklerdir — NFR-S11 _"SAML 2.0/OIDC + SCIM (Enterprise)"_, NFR-C4 _"Şartlı (imzalı BAA + yalnız US hosting) — Enterprise"_, NFR-S12 _"genişletilmiş + SIEM Enterprise"_. İlk kırılımda sözlükte yoktular; sonuç, `11.5`'in var oluş gerekçesi olan kaçağın (`powered_by` her planda açık) ÜÇ YENİ ÖRNEĞİ olurdu: Faz 3 bittiğinde `growth` planındaki her kiracı SAML SSO'ya, SCIM'e, HIPAA/BAA akışına ve SIEM export'una erişirdi.

KARAR: yetki PLANDAN TÜRETİLİR, ayrı bayrak tablosu AÇILMAZ (§C-A25). İki kaynak (plan + bayrak) uyuşmazlığa düşer ve hangisinin kazandığı yazılı olmaz. Enterprise fiyatı SAYISAL OLARAK UYDURULMAZ — PRD'de Enterprise fiyatı yoktur; "görüşmeye bağlı" modellenir, ADR-13'ün rakamları bozulmaz.

DOSYALAR: `apps/api/src/services/billing/subscription-service.ts:21` · `packages/types/src/domain.ts` · `packages/contract/openapi/paths/settings.yaml` veya `billing` · `apps/api/src/routes/settings.ts`

REFERANS DESEN: `PLANS` map'in kendi yorumu — "A map rather than inlined constants so a future tier is a data change". Downgrade guard (`subscription-service.ts:118-124`; :113 yorum satırı) yeni kademeyle tutarlı kalmalı.

KAPSAM DIŞI: zorlama (11.5-b), SLA (11.5-d), sandbox (11.5-f).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 84.2. 11.5-b [OPUS-MAX] Entitlement zorlama çekirdeği (BÖLÜNMEZ) — yazma kapısı + downgrade'de okuma yolunda geri alma

**Status:** done  
**Dependencies:** 84.1  

Entitlement zorlama çekirdeği (BÖLÜNMEZ) — yazma kapısı + downgrade'de okuma yolunda geri alma

**Details:**

11.5-b — Entitlement zorlama çekirdeği (BÖLÜNMEZ) — yazma kapısı + downgrade'de okuma yolunda geri alma  [OPUS-MAX]

PRD: 11.5 (PLAN §6.1 · dilim V3-3 · tm 84)
TAHMİN: ~2 pencere

BÖLÜNMEZ ÇEKİRDEK (PLAN §5.1.2). Gerekçe: yetki kararı bir GELİR SINIRIDIR ve tek yerde verilmelidir. Kritik olan yarısı yazma kapısı DEĞİL, DOWNGRADE YOLU: plan düşünce daha önce kaydedilmiş `poweredBy=false` satırı yerinde kalır ve widget markasız yayınlanmaya DEVAM EDER. "Yazarken kontrol et" ile "okurken uygula" ayrı pencerelere bölünürse tam olarak bu sessiz kaçak açık kalır. Çekirdek HER İKİ UCU birden kapsar.

KAPSAM: (1) YAZMA: `PATCH /settings/widget` `powered_by=false` yalnız `white_label` yetkisi varken kabul edilir (`routes/settings.ts:827` — bugün kapısız). (1b) **ALTI ANAHTARIN TAMAMI AYNI KAPIDAN GEÇER** (denetim bulgusu K1-2): `sso` → `S11`'in SSO/SCIM uçları · `hipaa` → `C4`'ün BAA kabul ucu · `siem_export` → `C6`'nın export/hedef uçları · `sandbox` → `11.5-f` · `sla` → `11.5-d`. Bu alt-görev kapıyı KURAR ve altısını birden bağlar; ilgili kalemlerin son doğrulama alt-görevleri (`S11-i`, `C4-g`, `C6-g`, `11.5-h`) yetkisiz planda **red negatifini** kendi süitlerinde kanıtlar. (2) OKUMA: widget görünümünü SUNAN her yol (`routes/auth.ts:657`, `services/websites/website-service.ts:128`, `routes/settings.ts:1342`) yetki yoksa `powered_by`yi `true`ya zorlar. Mevcut `poweredBy=false` satırları SİLİNMEZ — okurken yok sayılır (§C-A26, veri kaybı yok).

DOSYALAR: `apps/api/src/routes/settings.ts:181,827,1331-1342` · `apps/api/src/routes/auth.ts:657` · `apps/api/src/services/websites/website-service.ts:128,210` · yeni `apps/api/src/lib/entitlements.ts`

REFERANS DESEN: `apps/api/src/plugins/license-gate.ts` — "route başına değil hook olarak zorla, çünkü 'şu ucu gatelemeyi unuttuk' bedava katmanın sessizce sınırsızlaşma yoludur" ilkesi birebir geçerli.

KAPSAM DIŞI: widget istemci tarafı (11.5-c), SLA/sandbox.

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.
<info added on 2026-08-15T03:22:15.633Z>
Now I have a clear picture. The `PLANS` catalog currently only has `growth`. Task 84.1 will add `enterprise` tier with entitlements. Let me check the test fixtures to see how they seed tenants with different plans.Based on my codebase analysis, I now have all the context needed. The key findings:

1. **Current `PLANS` catalog** (`apps/api/src/services/billing/subscription-service.ts:21-23`): Only has `growth` tier - no entitlements defined yet
2. **`compliance-baa.test.ts`**: Tests the BAA acceptance endpoint but uses `plan: 'growth'` in `seedUsTenant()` (line 74) - no entitlement checks currently
3. **Task 84.1** will add `enterprise` tier with entitlements like `hipaa`, `white_label`, `sso`, `siem_export`, `sandbox`, `sla`
4. **This subtask (84.2)** creates `apps/api/src/lib/entitlements.ts` - the central gate
5. **Test location**: `apps/api/test/integration/entitlements.test.ts` (new file created by this subtask)

Here is the update text:

DEVREDİLEN BORÇ: tm 82.7 (C4-g) penceresi `hipaa` yetki reddi negatif testini buraya devretti.

GEREKÇESİ (K5-3 graf kısıtı): PLAN §6.2'nin kasıtlı sırası `tm 84` → `tm 82` yönünde; yani C4-g koştuğunda bu alt-görevin çıktıları (`apps/api/src/lib/entitlements.ts` ve `PLANS` içinde `enterprise` kademesi) henüz yoktu. Yazılacak test schema-dan önce varolmazdı — mock edilse atlanmış test politikasını, kırmızı bırakılsa DoD'yi bozar. Borç bu pencereye taşındı.

UYGULAMA (entitlement kapısını kurarken, aynı turda):

1. `apps/api/test/integration/entitlements.test.ts` içinde `hipaa` yetkisi için ikili test seti:
   - NEGATİF: `growth` planındaki bir US workspace + owner rolü + `access_rules:rw` scope → `POST /settings/compliance/baa` çağrısı 403 döner. Reddin TEK sebebi `hipaa` yetkisinin yokluğu olacak (bölge = `us`, rol = `owner` — C4-d'nin bölge/rol kapılarını tekrar kanıtlamaz).
   - POZİTİF: `enterprise` planındaki bir US workspace + owner rolü → aynı uç 200 döner ve `hipaaBaaSignedAt` yazılır.

2. Okuma/yazma ayrımı: `GET /settings/compliance` yetkisiz planda da 200 dönüyor mu (sadece bilgi görüntüleme) yoksa o da kapılanıyor mu — karar bu test içinde belgelenecek. Mevcut `compliance-baa.test.ts:239-251` admin'in okuyabildiğini kanıtlıyor, yani okuma kapısız; yazma kapalı.

3. Test konumu: `entitlements.test.ts` (bu alt-görevin dosyası) — `compliance-baa.test.ts`'e ekleme DEĞİL; BAA bölge/rol kurallarını kanıtlıyor, yetki kuralını burada test ediyoruz.

REFERANS: `seedUsTenant()` deseni `apps/api/test/integration/compliance-baa.test.ts:68-116` içinde mevcut; `plan` parametresini `enterprise` yaparak yeniden kullanılabilir.
</info added on 2026-08-15T03:22:15.633Z>
<info added on 2026-08-15T09:26:25.102Z>
Now let me check the `siem-sink.test.ts` to see how it seeds fixtures.Now I have all the context I need. Let me provide the update text for this subtask.

DEVREDİLEN BORÇ #2: tm 83.8 (C6-g) penceresi `siem_export` yetki reddi negatif testini buraya devretti.

GEREKÇESİ (aynı K5-3 graf kısıtı, `hipaa` borcuyla birebir aynı sebep): PLAN §6.2'nin kasıtlı sırası `tm 84` → `tm 83` yönünde; C6-g koştuğunda bu alt-görevin çıktıları (`apps/api/src/lib/entitlements.ts` ve `PLANS` içinde `enterprise` kademesi) henüz yoktu — doğrulandı: `apps/api/src/services/billing/subscription-service.ts:21` hâlâ `PLANS = { growth: {...} }`, tek kademe, ve `lib/entitlements.ts` dosyası yok. Test şema-dan önce yazılamazdı; mock'lansa atlanmış-test politikasını, kırmızı bırakılsa DoD'yi bozardı.

UYGULAMA (entitlement kapısını kurarken, aynı turda — `hipaa` ikilisiyle aynı dosyada):

1. `apps/api/test/integration/entitlements.test.ts` içinde `siem_export` yetkisi için ikili test seti. Kapılanacak UÇLAR (C6-b/C6-d'nin teslim ettiği yüzeyin tamamı, üçü birden):
   - `GET /audit-log/export` (scope `audit_log--export:ro`, minimumRole admin; `apps/api/test/integration/siem-export.test.ts:204` bu scope'u kullanıyor)
   - `PATCH /settings/siem` (hedef/açma yazma ucu, scope `access_rules:rw`; bkz. `siem-export.test.ts:207`)
   - `GET /settings/siem`, `GET /settings/siem/status` — OKUMA kapılanıyor mu? `hipaa` borcunun 2. maddesindeki aynı karar: C6-f ekranı bu iki ucu okur, `growth` planında ekranın "yetkiniz yok" mu diyeceği yoksa hiç mi görünmeyeceği bu testte belgelenecek. Emsal: `GET /settings/compliance` yetkisiz planda da 200 (okuma kapısız, yazma kapalı).
   - NEGATİF: `growth` planındaki workspace + owner rolü + doğru scope → yazma ucu ve export ucu 403. Reddin TEK sebebi `siem_export` yetkisinin yokluğu olsun (rol = owner, scope = doğru).
   - POZİTİF: `enterprise` planında aynı uçlar 200 ve `siemExportCursor` satırı yazılır.

2. SIEM SUITE KIRIKLIKLARI — bu kalemin zaten yeşil olan süiti kırılabilir: `apps/api/test/integration/siem-export.test.ts` (41 test), `siem-sink.test.ts` (14 test), ve `audit-chain.test.ts` (31 test) hepsi `seedFixtures()`'ın varsayılan planıyla koşuyor. `apps/api/test/helpers/fixtures.ts:123` `seedTenant()` içinde `plan: 'growth'` hardcoded. Kapı bu uçlara bağlanırsa bu üç dosya toptan kırmızıya döner. İKİ YOLDAN BİRİ:
   - (a) `seedFixtures()`'a plan parametresi ekle, SIEM/audit süitlerinde `enterprise` seed et
   - (b) `seedTenant()` varsayılanını `enterprise` yap (tüm süitler bu planla koşar, entitlement testleri `growth` için ayrıca override eder)
   Seçilen yol `tm 84.2` penceresinde belgelenir.

3. `SiemSink` döngüsü (zamanlanmış gönderim) de yetkisiz plana teslim etmemeli: kapı yalnız HTTP uçlarına konursa `growth` planındaki bir lisans, `enabled=true` satırı bir kez yazıldıktan sonra (ör. enterprise'dan düşerken) sessizce ihraç edilmeye DEVAM eder. Kod yolu: `apps/api/src/services/audit/siem-sink.ts:137` `#listTenants()` → tüm aktif tenant'ları döner (`retention_list_tenants()` çağrısı), sonra `#sweepTenant()`:149 her biri için çalışır; `#deliverLocked()`:189 `readSiemExportRow()` sonucuna bakarak `enabled` kontrolü yapar ama PLAN KONTROLÜ YOK. Çözüm: `#deliverLocked` veya `#sweepTenant` başında plan yetkisi sorgulansın, yetkisiz planda `status: 'skipped'` dönsün.

4. REFERANS: `seedFixtures()` deseni `apps/api/test/helpers/fixtures.ts:112-200`; `siem-export.test.ts` `grantToken()` ile token üretiyor ve export/settings scope'larını ayrı ayrı test ediyor (`:204-209`).
</info added on 2026-08-15T09:26:25.102Z>

### 84.3. 11.5-c [SONNET-XHIGH] Widget tarafı — yetki yokken powered_by=0 URL parametresinin yok sayılması

**Status:** done  
**Dependencies:** 84.2  

Widget tarafı — yetki yokken powered_by=0 URL parametresinin yok sayılması

**Details:**

11.5-c — Widget tarafı — yetki yokken powered_by=0 URL parametresinin yok sayılması  [SONNET-XHIGH]

PRD: 11.5 (PLAN §6.1 · dilim V3-3 · tm 84)
TAHMİN: ~1 pencere

NEDEN: `apps/widget/src/widget.ts:1154` → `poweredBy: params.get('powered_by') !== '0'`. Yani markayı kaldırmak için URL parametresi YETİYOR; sunucu yetkisi okunmuyor. 11.5-b sunucu tarafını kapatır, bu alt-görev istemci tarafını hizalar.

KAPSAM (denetim sonrası KESİNLEŞTİRİLDİ — "yalnız yetki varsa etkili olsun" bir KARAR BOŞLUĞUYDU): **`powered_by` URL parametresi TAMAMEN KALDIRILIR.** `appearanceFromParams` bu alanı artık ÜRETMEZ; `DEFAULT_APPEARANCE.poweredBy = true` ve tek kaynak `appearanceFromApi`'dir (`widget.ts:1167` → `a.powered_by`).

Gerekçe: istemci, API yanıtı gelmeden yetkiyi BİLEMEZ; "yetki varsa etkili olsun" talimatı ilk boyamada zorunlu olarak ya markayı gizler (kaçak) ya da talimatı ihlal eder. Yetki kararı istemcide HİÇ verilmez — sunucu (`11.5-b`) doğru değeri döner. Bu, işi gerçekten mekanikleştirir ve `SONNET-XHIGH` etiketini haklı kılar.

Bundle bütçesi KORUNUR (NFR-P3: loader < 50 KB, `apps/widget/vite.config.ts:16`'da testle zorlanıyor).

DOSYALAR: `apps/widget/src/widget.ts:33,41,149,899-912,1154,1167` · `apps/widget/src/widget.appearance.test.ts`

REFERANS DESEN: aynı dosyadaki diğer görünüm alanlarının (theme/position/primaryColor) sunucudan gelme yolu — `:1167` `poweredBy: a.powered_by`.

KAPSAM DIŞI: e2e (11.5-h).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 84.4. 11.5-d [OPUS-XHIGH] SLA yönetimi — hedef tanımı (ilk yanıt / çözüm, iş saatleri) + ölçüm + ihlal işareti

**Status:** done  
**Dependencies:** 84.1  

SLA yönetimi — hedef tanımı (ilk yanıt / çözüm, iş saatleri) + ölçüm + ihlal işareti

**Details:**

11.5-d — SLA yönetimi — hedef tanımı (ilk yanıt / çözüm, iş saatleri) + ölçüm + ihlal işareti  [OPUS-XHIGH]

PRD: 11.5 (PLAN §6.1 · dilim V3-3 · tm 84)
TAHMİN: ~2 pencere

KAPSAM: `sla_policies` tablosu (licenseId, firstResponseMinutes, resolutionMinutes, businessHoursOnly) + RLS + CRUD + ölçüm. Sohbet/ticket üzerinde ilk yanıt ve çözüm süresi ölçülür; hedef aşılırsa İHLAL işaretlenir.

KARAR: SLA ÖLÇER ve İŞARETLER; ZORLAMAZ (§C-A27). İhlal bir bildirim ve rapor satırı üretir, sohbeti yeniden yönlendirmez — routing'e dokunmak ayrı bir kalemdir.

İŞ SAATLERİ: mevcut `work_schedules` tablosu (`apps/api/prisma/schema.prisma:1733`, **tm 77 · `WORKSCHED-b`** tablo+RLS / `WORKSCHED-c` okuma ucu — denetim düzeltmesi: tm 96 = "12.4 Copilot BI komut", ilgisiz) iş saatleri kaynağı olarak YENİDEN KULLANILIR; ikinci bir takvim modeli açılmaz.

DOSYALAR: `apps/api/prisma/schema.prisma` + migration · `apps/api/src/services/tickets/` + `apps/api/src/services/chat/` (ölçüm noktaları) · `apps/api/src/routes/settings.ts` · `packages/contract/openapi/paths/settings.yaml`

REFERANS DESEN: `services/staffing/` (work_schedule okuma) · `routes/ticket-rules.ts` (politika CRUD kalıbı) · ölçüm için `services/reports/` mevcut süre hesapları.

KAPSAM DIŞI: ekran (11.5-e), e2e (11.5-h).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

**SLA KAPSAM SINIRI (denetim bulgusu K1-4):** PRD'nin tek somut SLA tanımı NFR-U5'tir — _"Sözleşmeli uptime taahhüdü + kredi mekanizması"_. Bu kalem SLA'yı **yanıt/çözüm SLA'sı** olarak uygular; **uptime taahhüdü ve fatura kredisi payı KAPSAM DIŞIDIR** ve `⛔-süreç` sayılır (uptime taahhüdü bir sözleşme kalemidir, bu depodan üretilemez — §D97'nin kod/süreç ayrımı). §5.5'in `MOD-10 Billing | Ent. ○ (SLA/white-label)` hücresinin SLA payı bu yüzden faturaya DOKUNMAZ. Bu daraltma §6.1.5'te ve §D99'da yazılıdır; `11.5` ✅ damgası yalnız yanıt/çözüm SLA'sını iddia eder.

### 84.5. 11.5-e [SONNET-XHIGH] SLA ekranı + Reports'ta ihlal KPI'ı

**Status:** done  
**Dependencies:** 84.4  

SLA ekranı + Reports'ta ihlal KPI'ı

**Details:**

11.5-e — SLA ekranı + Reports'ta ihlal KPI'ı  [SONNET-XHIGH]

PRD: 11.5 (PLAN §6.1 · dilim V3-3 · tm 84)
TAHMİN: ~1 pencere

KAPSAM: Settings → SLA bölümü (hedef formu, iş saatleri anahtarı) + Reports'ta "SLA ihlalleri" KPI kartı.

DOSYALAR: `apps/web/src/features/settings/SlaPolicy.tsx` (yeni) + test · `apps/web/src/features/reports/ReportsPage.tsx`

REFERANS DESEN (birebir): `apps/web/src/features/reports/ReportsPage.tsx:555-561` "Achieved goals" KPI kartı (tm 74 · 13.3; :549-554 "In queue now" kartıdır — denetim düzeltmesi) — kart yerleşimi + düşük-baz uyarısı (FR-MOD-07.3.2: low-N uyarısı ZORUNLU). Form için `lib/form.tsx`.

KAPSAM DIŞI: e2e (11.5-h).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 84.6. 11.5-f [OPUS-MAX] Sandbox lisansı (BÖLÜNMEZ) — ikinci kiracı: izolasyon + faturaya girmeme + kotaya sayılmama

**Status:** done  
**Dependencies:** 84.1, 84.2  

Sandbox lisansı (BÖLÜNMEZ) — ikinci kiracı: izolasyon + faturaya girmeme + kotaya sayılmama

**Details:**

11.5-f — Sandbox lisansı (BÖLÜNMEZ) — ikinci kiracı: izolasyon + faturaya girmeme + kotaya sayılmama  [OPUS-MAX]

PRD: 11.5 (PLAN §6.1 · dilim V3-3 · tm 84)
TAHMİN: ~2 pencere

BÖLÜNMEZ ÇEKİRDEK (PLAN §5.1.2). Gerekçe: sandbox İKİNCİ BİR KİRACIDIR. Yeni lisans üretmek, onu bir üretim lisansına bağlamak, ama RLS/ölçüm/faturalama açısından ondan TAMAMEN ayırmak tek bir izolasyon akıl yürütmesidir. Parçalanırsa "sandbox verisi üretim raporunda", "sandbox koltuğu faturada" ya da en kötüsü "sandbox token'ı üretim verisini okuyor" sınıfı sızıntı kalır.

KAPSAM: `licenses.sandboxOfLicenseId` (nullable self-FK) + sandbox oluşturma/sıfırlama uçları + ölçüm/faturalama dışında tutma (`usage_records`, `subscriptions`, koltuk sayımı) + raporların sandbox verisini üretim lisansına KARIŞTIRMAMASI. Sandbox aynı bölgeyi miras alır (C4 immutability'si ile tutarlı).

DOSYALAR: `apps/api/prisma/schema.prisma` + migration · `apps/api/src/routes/settings.ts` veya yeni `routes/sandbox.ts` · `apps/api/src/services/billing/metering.ts` · `apps/api/src/services/billing/subscription-service.ts`

REFERANS DESEN (birebir): Multibrand (tm 78 · MULTIBRAND) marka izolasyonu — "yeni bir izolasyon boyutu eklerken her okuma yolunu tek tek gözden geçir" kalıbı; `lib/brand.ts` + `brand_context` migration'ları.

KAPSAM DIŞI: ekran (11.5-g), e2e (11.5-h).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 84.7. 11.5-g [SONNET-XHIGH] Sandbox ekranı — oluştur/sıfırla + "bu bir sandbox" göstergesi

**Status:** done  
**Dependencies:** 84.6  

Sandbox ekranı — oluştur/sıfırla + "bu bir sandbox" göstergesi

**Details:**

11.5-g — Sandbox ekranı — oluştur/sıfırla + "bu bir sandbox" göstergesi  [SONNET-XHIGH]

PRD: 11.5 (PLAN §6.1 · dilim V3-3 · tm 84)
TAHMİN: ~1 pencere

KAPSAM: Settings → Sandbox bölümü (oluştur, sıfırla — YIKICI işlem onayı ile) + kabukta sandbox rozeti ("bu bir sandbox çalışma alanı").

**ZORUNLU İNVARYANT (denetim bulgusu — rozet yanılırsa ÜRETİM verisi silinir):** sıfırlama butonu, aktif lisansın `sandboxOfLicenseId != null` olduğu **SUNUCU yanıtından** türetilir; istemci tarafı bir bayrak, localStorage ya da rota tahmininden TÜRETİLMEZ. Sunucu ayrıca bağımsız olarak sandbox olmayan lisansta sıfırlamayı reddeder (`11.5-f` testinde negatif olarak kanıtlı) — istemci kapısı tek savunma değildir.

DOSYALAR: `apps/web/src/features/settings/Sandbox.tsx` (yeni) + test · `apps/web/src/components/AppShell.tsx` (rozet)

REFERANS DESEN: yıkıcı işlem onayı — mevcut "hesabı kapat" akışı (`account-lifecycle`) · rozet için `apps/web/src/components/ui/Banner.tsx` segmentli kalıbı + `apps/web/src/components/StatusDot.tsx` (denetim düzeltmesi: `StatusDot` `components/ui/` altında DEĞİL).

KAPSAM DIŞI: e2e (11.5-h).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 84.8. 11.5-h [OPUS-XHIGH] Uçtan uca doğrulama — white-label reddi/kabulü/downgrade geri alma + sandbox sızıntı negatifi + SLA e2e

**Status:** done  
**Dependencies:** 84.3, 84.5, 84.7  

Uçtan uca doğrulama — white-label reddi/kabulü/downgrade geri alma + sandbox sızıntı negatifi + SLA e2e

**Details:**

11.5-h — Uçtan uca doğrulama — white-label reddi/kabulü/downgrade geri alma + sandbox sızıntı negatifi + SLA e2e  [OPUS-XHIGH]

PRD: 11.5 (PLAN §6.1 · dilim V3-3 · tm 84)
TAHMİN: ~1 pencere

KAPSAM: (1) `growth` planında white-label REDDİ, `enterprise`'da kabulü, DOWNGRADE sonrası geri alma — tarayıcıda widget çıktısıyla kanıtlanır (kanıt PNG `apps/e2e/kanit/11.5-white-label.png`). (2) sandbox veri sızıntısı negatifi. (3) SLA ihlali e2e.

DOSYALAR: `apps/e2e/tests/entitlements.spec.ts` (yeni) · `apps/api/test/integration/entitlements.test.ts` · `apps/e2e/kanit/`

REFERANS DESEN: `apps/e2e/tests/widget.spec.ts` — widget'ın gerçek cross-origin iframe'de sürülmesi (`acme-bikes.localhost:5174`).

KAPI: bu alt-görev yeşile dönmeden kalem ✅ olmaz.

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.
