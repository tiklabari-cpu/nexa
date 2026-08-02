# HANDOFF — Nexa

**Date:** 2026-08-01 · **Branch:** `main` (güncel — Faz-0 + v1 + v2 planı burada) · **Remote:** https://github.com/tiklabari-cpu/nexa

> **Dal durumu (2026-08-01):** `main` uzun süre `e118695` (tm 21) noktasında takılı kalmıştı; Faz-0
> kapanışı, **tüm v1** ve v2 planlama turu yalnızca `docs/plan-expand-audit` üzerinde birikmişti
> (127 commit). Bu tur `main` **fast-forward** ile güncellendi (`--ff-only`, force yok, history
> rewrite yok, hiçbir commit kaybolmadı) ve push edildi. `main` ile `docs/plan-expand-audit` artık
> **birebir aynı**. Bundan sonra iş `main`'den dallanır — CONVENTIONS §2'nin `feat/<slug>` → `main`
> akışı yeniden geçerli. Eski `docs/plan-expand-audit` dalı tamamen merge edilmiş durumda; silinebilir.

---

## Task log (newest-first)

### 78.1 — MULTIBRAND-a `brands` tablosu + license-scoped RLS + varsayılan marka backfill — done — 2026-08-02 UTC

- **Yapıldı:** OPUS-XHIGH. Multibrand'in **kontrat-öncesi şema katmanı** (davranışsız — hiçbir
  route/OpenAPI path YOK). (1) `model Brand` — uuid id · `licenseId` FK `onDelete: Cascade` ·
  `@@unique([licenseId, slug])` · `logoUrl?` · `isDefault` · timestamps — `Website` modelinin birebir
  şekli; `License.brands` back-relation. (2) migration `20260802100000_brands`: tablo (Prisma diff DDL
  stili) + FK + `ENABLE ROW LEVEL SECURITY` + `brands_tenant` policy (`nexa_current_license()`
  USING+WITH CHECK, `websites`/`widget_settings` deseni) + `GRANT ... TO nexa_app`. (3) lisans başına
  **tek varsayılan**: partial unique index `ON brands(license_id) WHERE is_default`. (4) backfill:
  mevcut HER lisansa bir `Default` (is_default) markası (`NOT EXISTS` guard → idempotent) → tek-markalı
  davranış birebir korunur. (5) `seed.ts` aynı satırı üretir. Partial index Prisma'da ifade edilemez →
  `scripts/check-drift.ts` KNOWN_UNMODELLABLE'a kaydedildi (pgvector deseni). Testler: `data-model.test.ts`
  (+4) + `tenant-isolation.test.ts` (RLS-etkin liste 11→12 + 3 negatif).
- **Doğrulama:** `pnpm -w typecheck` ✅ · `pnpm -w lint` ✅ · `pnpm -w build` ✅ ·
  `pnpm -w test:integration` ✅ (serial; **44 dosya / 918 test** — 911→918, +7: data-model 4 + tenant-isolation 3;
  contract-parity 5 DEĞİŞMEDEN yeşil) · `pnpm -w test:unit` ✅ (web 489 + diğer) · `db:check-drift` ✅
  (no drift — Prisma partial index'i introspection'da yok sayıyor; KNOWN_UNMODELLABLE savunma amaçlı).
  Canlı DB doğrulaması: 4 lisans → **tam 4** is_default marka; tablo/RLS/policy/partial-index psql ile teyit.
  Kapı komutlarının hepsi exit 0.
- **Varsayımlar:** Test fixtures'ına (`seedFixtures`) marka EKLENMEDİ — yeni lisanslar (fixture/signup)
  markasız doğar; "her lisansta bir marka" yalnız backfill (mevcut veri) + seed (demo) için geçerli, bu
  subtask'ın kapsamı bu (signup'ta marka üretimi -b/-d'nin işi). E2E: bu subtask kullanıcı-akışı taşımıyor →
  yeni e2e YOK; `seed.ts` marka üretimi typecheck + integration'daki birebir `brand.create` şekliyle doğrulandı
  (no-DB-drop sınırı: `db:reset` çalıştırılmadı).
- **Sonraki pencereye not:** §5.0 envanterinde `§5.3-Marka | Multibrand` **⬜→◐** (slice 1/8 teslim);
  özet sayaç **20⬜/0◐/7✅/3⛔ → 19⬜/1◐/7✅/3⛔** (line 22 + §5.0:1100, ikisi de; grep-öncü-damga sayımı
  birebir doğrulandı). Kalan slice'lar: **MULTIBRAND-b** marka izolasyon çekirdeği (`app.current_brand` +
  brand-scoped RLS — **bölünmez OPUS-MAX çekirdek**, §5.2.23'teki 3-parça uyarıyı oku) → -c brand_id yayılımı
  → -d /brands CRUD+scope+`brand_not_found` (yaml+route AYNI pencerede, contract-parity iki-yönlü) → -e/-f/-g UI
  → -h cross-brand e2e. `brands.yaml` bilerek -d'ye bırakıldı.

### 92.11 — 08.9.7-k NFR-S12 uçtan uca doğrulama (dört olay + 30 gün + tüm planlarda) — done — 2026-08-02 UTC

- **Yapıldı:** NFR-S12'nin bütününü tek süitte koda karşı kanıtlayan doğrulama turu (yeni davranış
  YOK — altyapı tm 92.1–92.10'da teslim). `apps/api/test/integration/audit-log.test.ts` (+4):
  (1) login→rol değişimi→webhook oluştur+sil→hedefli veri silme dördü de tek `GET /audit-log`
  okumasında doğru eylem adlarıyla; (2) deneme (`trialing`) ve ücretli (`plan=enterprise`,
  `status=active`) lisansta **yazım** paritesi — plan kapısı yok; (3) çapraz-kiracı: B'nin dört
  olayı A'nın okumasında yok, B kendi okumasında hepsini görür; (4) `audit_prune_expired` budaması
  sonrası okumada 31-gün YOK / 29-gün VAR. `apps/api/test/integration/audit-log-read.test.ts`
  (+1): reader plan-agnostik (trial/paid **okuma** paritesi). `apps/e2e/tests/settings.spec.ts`
  (+1): webhook değişimi Audit log ekranında (action filtresiyle); yeni helper `ownerAccessToken`
  (`apps/e2e/tests/fixtures.ts`, PKCE ile owner Bearer — webhooks--all:rw + audit_log--all:ro).
- **Doğrulama:** `pnpm -w typecheck` ✅ · `pnpm -w lint` ✅ · `pnpm -w test:integration` ✅ (serial
  `--concurrency=1`; 44 dosya / **911** test — audit-log 39, audit-log-read 18) · `pnpm -w test:unit`
  ✅ · `pnpm -w build` ✅ · e2e `settings.spec.ts` ✅ (**15/15**, yeni "shows a webhook change in
  the audit trail" dahil). Kapı komutlarının hepsi exit 0.
- **Varsayımlar:** "İki farklı plan" = deneme vs ücretli abonelik → `status` trialing↔active +
  `plan` free-form string (owner bağlantısıyla doğrudan yazılır, tek-plan subscription doğrulayıcısı
  bilinçli atlanır). "genişletilmiş + SIEM Enterprise" **açıkça yapılmadı** — entitlement mekanizması
  repoda yok, ayrı kalem (kapsam dışı).
- **Sonraki pencereye not:** Bu tur §5.0 envanterinde `08.9.7` **◐→✅** oldu (slice 11/11 tamam),
  özet **gerçekten** `1 ◐ / 6 ✅` → **`0 ◐ / 7 ✅`** (⬜ **20 sabit** — 08.9.7 ⬜ değildi). §D71'in
  reddettiği "6→7/20→19" panel önerisi yanlış-pozitif GLİF sayımıydı; buradaki flip ise -k'nın
  **gerçek teslimi** — ikisi karıştırılmamalı. Kalan v2: 20 ⬜ açık kalem (§5.2).

### FIX (panel: Faz-2 özet sayaç çelişkisi) — §D71 · yanlış-pozitif kökten kapatıldı — done — 2026-08-02 UTC

- **Yapıldı:** Panelin bildirdiği Faz-2 özet çelişkisi (✅ 6→7 · ⬜ 20→19) incelendi. §5.0 envanteri
  (satır 1108–1137, 30 satır) **öncü** durum damgaları grep ile tek tek sayıldı = **20 ⬜ · 1 ◐ ·
  6 ✅ · 3 ⛔** → özet (satır 22 + §5.0:1100) ZATEN DOĞRU. Çelişki, satır 1108 (`06.3.2-bulk`)
  notundaki gömülü `` `✅` ``/`` `⬜` `` gliflerinin naif ham-glif sayımı (§D68/D69/D70'te teşhisli,
  üçüncü tekrar). §D69'un öngördüğü kök kapatma yapıldı: 1108'deki iki gömülü glif düz metne çevrildi
  (**teslim (kapalı)** / **açık (yapılmadı)**) — öncü damga (`⬜`) ve anlam değişmedi. §D71 eklendi.
- **Doğrulama:** grep öncü-damga sayımı `20/1/6/3` (özetle birebir) · §5.0'da kalan gömülü glif **0**
  (grep). **Yalnız-doküman değişikliği** (PLAN.md + HANDOFF.md) — kod/test/şema DEĞİŞMEDİ →
  kod DoD kapıları (typecheck/lint/test/integration/build/e2e) N/A (doc-only commit deseni, bkz.
  `aec3b02`). `git status` commit sonrası temiz.
- **Varsayımlar:** "Faz-2 gereksinim tablosu" = §5.0 kalem envanteri (özetin dayandığı 30 kalem);
  §5.2 kırılım · §5.3.2 dilim · §G düz tablo hedef değil (öncü durum damgası taşımıyor — grep 0).
- **Sonraki pencereye not:** Özet sayacı DÜZELTİLMEDİ çünkü zaten doğruydu — `7/19`'a çekmek onu
  BOZARDI (öncü-damga gerçeğiyle + §5.0:1100 ile çelişirdi). Bu panel bulgusu artık **kökten kapalı**
  (naif sayım ↔ öncü-damga yakınsadı). Tekrar gelirse önce §D71'i oku, körlemesine özet değiştirme.

### tm 92.10 — 08.9.7-j Audit ekranı filtreleri (eylem/tarih) + 'daha fazla yükle' + e2e görünürlük — done — 2026-08-02 UTC

- **Yapıldı:** SONNET-XHIGH. `AuditLogPage.tsx`'e üç parça eklendi. (1) Eylem seçici: `AUDIT_ACTIONS`'ı
  (apps/api, paylaşılan paket yok — elle senkron tutulan not eklendi) ailelerine göre gruplayan
  `<optgroup>`'lu `<select>` (Authentication/Team/Settings/Billing/Webhooks/Tickets/Credentials/Data
  — NFR-S12'nin dört olay ailesini de kapsıyor, 24 eylemin tamamı). (2) Tarih aralığı: `From date`/`To
  date` (ReportsPage `RangeControls` deseni, `type=date` girişleri gün başı/sonu UTC'ye çevrilip
  `date_from`/`date_to` olarak gönderiliyor) — boşken hiçbir tarih parametresi gönderilmiyor, sunucunun
  varsayılan son-30-gün penceresi (08.9.7-a) korunuyor; statik açıklama metni bunu ekranda söylüyor.
  (3) 'Load more': `useInfiniteQuery` + 08.9.7-a'nın `next_page_id` cursor'ı `page_id` sorgu
  parametresi olarak — `hasNextPage` yokken buton hiç render edilmiyor. Üç filtre de yerel state değil
  `useSearchParams` üzerinden URL'e yazılıyor (Tickets grid sort deep-link deseni, 02.7-a) — filtre
  değişince sorgu anahtarı değişip sayfalama kendiliğinden sıfırlanıyor, reload/paylaşılan link aynı
  görünümü açıyor. e2e: `settings.spec.ts`'e yeni `audit log` describe — owner girişi (agentPage
  fixture zaten `/auth/login` üzerinden gerçek girişi tetikliyor, kendi `auth.login` entry'sini
  yazıyor) → Settings → "Open audit log" linki → tabloda kendi `auth.login` kaydı görünür.
  Dosyalar: `apps/web/src/features/audit/AuditLogPage.tsx` ·
  `apps/web/src/features/audit/AuditLogPage.test.tsx` · `apps/e2e/tests/settings.spec.ts`.
- **Doğrulama:** `pnpm --filter @nexa/web typecheck` ✓ · `pnpm --filter @nexa/web lint` ✓ ·
  `pnpm --filter @nexa/e2e typecheck` ✓ · `pnpm --filter @nexa/e2e lint` ✓ · `pnpm -w typecheck` ✓ ·
  `pnpm -w lint` ✓. Testler paket paket serial çalıştırıldı ([[nexa-test-gate-parallel-db]] —
  `pnpm -w test` apps/rtm+apps/api'nin paylaşılan Postgres'e karşı deadlock/FK yarışına giriyor, bu
  task'la ilgisiz, backend kodu hiç değişmedi): `pnpm --filter @nexa/web test` 489/489 ✓ (+6 yeni:
  negatif-önce next_page_id yokken 'Load more' yok · 'Load more' ikinci sayfayı ekliyor + `page_id`
  gönderiyor · eylem filtresi `action` parametresiyle listeyi daraltıyor · özel tarih aralığı
  varsayılan 30 günü geçersiz kılıyor · filtre URL'e yazılıp reload'da korunuyor · varsayılan pencere
  metni her zaman görünür) · `pnpm --filter @nexa/api test` 1169/1169 ✓ (dokunulmadı) ·
  `pnpm --filter @nexa/rtm test` 90/90 ✓ (dokunulmadı). e2e ([[nexa-e2e-clean-db]] gereği `set -a; .
  ./.env; set +a` ile `db:migrate`+`db:seed` koşulup portlar boş doğrulandıktan sonra):
  `pnpm --filter @nexa/e2e test tests/settings.spec.ts -g "audit trail"` → **1/1 geçti** (webServer
  api/rtm/web/widget otomatik ayağa kalktı) — `kanit/92.10-audit-log.png` kanıt.
- **Varsayımlar:** (1) Eylem listesi `AUDIT_ACTIONS`'ı elle kopyalıyor (paylaşılan @nexa/types paketi
  yok) — apps/api'de yeni bir eylem eklenip burada unutulursa dropdown'da görünmez ama link/URL ile
  hâlâ filtrelenebilir (yorum bunu not ediyor); ileride gerçek drift riski varsa kaynak tek noktaya
  taşınabilir. (2) actor_id filtresi ve serbest metin arama KAPSAM DIŞI bırakıldı (task tanımı
  birebir). (3) `date_from`/`date_to` bağımsız girilebilir (biri boşken diğeri sunucunun açık-uçlu
  varsayımına düşer) — Reports'un zorunlu-ikili custom-range validasyonu buraya taşınmadı, backend
  zaten `date_from > date_to` için 400 döndürüyor.
- **Sonraki pencereye not:** 08.9.7 gereksinim satırı PLAN.md'de hâlâ `◐` — kalan tek alt-görev
  `08.9.7-k` (NFR-S12 uçtan uca doğrulama: dört olay + 30 gün penceresi + 'tüm planlarda' kanıtı);
  bağımlılıkları (-b, -c, -e, -f, -h, -j) artık hepsi teslim edildi, -k açılabilir durumda.

### tm 92.9 — 08.9.7-i Audit Log ekranı: salt-okunur liste + boş/skeleton/hata durumları + Settings girişi — done — 2026-08-02 UTC

- **Yapıldı:** SONNET-XHIGH. Yeni `apps/web/src/features/audit/AuditLogPage.tsx` —
  `useQuery`+`api.get('/audit-log')` → `VirtualTable` (Zaman/Eylem/Aktör/Hedef/IP, CustomersPage
  deseni), `ListSkeleton` (yükleniyor), `EmptyState` (boş — dört olay kategorisini anan metin, boş
  dikdörtgen değil), `ErrorNotice` (hata). RBAC istemci kapı `scopes.includes('audit_log--all:ro')`
  → `useQuery({ enabled })` ile scope yokken **hiç fetch atmıyor** ve sayfa "Audit log not
  available" uyarısı gösteriyor (UI gizleme asıl kapı DEĞİL — gerçek kapı 08.9.7-a'daki route
  `scopes`+`minimumRole:admin`). `App.tsx`'e `/app/settings/audit-log` route'u (modül rayında
  değil — Apps/marketplace deseniyle aynı, yalnız Settings girişinden erişilir).
  `SettingsPage.tsx`'e Integrations kartı deseninde `AuditLog()` giriş bölümü — scope yokken render
  EDİLMİYOR. `apps/web/src/lib/format.ts`'e `formatDateTime` eklendi (mevcut `formatDate` deseni
  birebir, ayrıca saat gösterir — audit zaman damgasında gün tek başına yetersiz).
  Dosyalar: `apps/web/src/features/audit/AuditLogPage.tsx` ·
  `apps/web/src/features/settings/SettingsPage.tsx` (`AuditLog` export) · `apps/web/src/App.tsx` ·
  `apps/web/src/lib/format.ts`.
- **Doğrulama:** `pnpm --filter @nexa/web typecheck` ✓ · `pnpm --filter @nexa/web lint` ✓ ·
  `pnpm -w typecheck` ✓ · `pnpm -w lint` ✓ · `pnpm -w build` ✓. Testler paket paket serial
  çalıştırıldı (bkz. [[nexa-test-gate-parallel-db]] — `pnpm -w test` apps/rtm+apps/api'nin paylaşılan
  Postgres'e karşı deadlock/FK yarışına giriyor, bu task'la ilgisiz): `pnpm --filter @nexa/web test`
  483/483 ✓ (+8 yeni: `AuditLogPage.test.tsx` 5 · `AuditLog.test.tsx` (settings) 2 ·
  `format.test.ts` +1) · `pnpm --filter @nexa/api test` 1169/1169 ✓ (contract-parity dahil, hiç
  değişmedi) · `pnpm --filter @nexa/rtm test` 90/90 ✓ · `pnpm --filter @nexa/types test` 60/60 ✓ ·
  `pnpm --filter @nexa/widget test` 52/52 ✓ · `pnpm --filter @nexa/ai-mock test` 56/56 ✓.
- **Varsayımlar:** (1) Aktör sütunu `actor_type` + `actor_id` (ham UUID) gösteriyor — isim
  çözümlemesi (agent adı lookup) API'de yok ve KK bunu istemiyor ("aktör" alanının render edilmesi
  yeterli). (2) Sıralama/aria-sort **eklenmedi** — TicketGrid referansı yalnız "salt-okunur grid
  deseni" için anıldı, sıralama 08.9.7-j/KAPSAM DIŞI listesinde değil ama filtre/pagination'ın
  parçası sayıldı; statik `<th>` (CustomersPage deseni) kullanıldı. (3) `format.ts`/`format.test.ts`
  DOSYALAR listesinde değildi ama mevcut i18n altyapısını (locale-bound Intl formatter'lar)
  tekrarlamamak için gerekliydi — bir satırlık, mevcut `formatDate` deseninin birebir eşi. (4) E2E
  yazılmadı — task'ın kendi KAPSAM DIŞI listesi bunu 08.9.7-j'ye bırakıyor; `apps/e2e`'de audit
  referansı yoktu (grep 0 sonuç), yeni kapsam kaçağı değil.
- **Sonraki pencereye not:** `08.9.7` hâlâ `◐`. Kalan: `-j` (filtreler + 'daha fazla yükle' +
  e2e görünürlük — bu ekranın üstüne inşa eder) · plan/tier kapısı (entitlement mekanizması hâlâ
  yok) · `-k` uçtan uca doğrulama. `-j` bu ekranın `useQuery` key'ini (`['audit-log']`) ve tablo
  yapısını genişletecek — action/date filtrelerini query param'a çevirip aynı `AuditLogPage`'e
  eklemek en düşük sürtünmeli yol.

### tm 92.8 — 08.9.7-h Append-only log'da 30-gün fiili budama (audit_prune_expired SECURITY DEFINER + retention sweep) — done — 2026-08-02 UTC

- **Yapıldı:** OPUS-MAX. NFR-S12'nin "son 30 gün"ü artık fiilen uygulanıyor. `audit_log`
  append-only (nexa_app'te UPDATE/DELETE REVOKE'lu) olduğundan pencere, `retention_list_tenants()`
  desenini izleyen dar bir SECURITY DEFINER fonksiyonla açıldı: yeni migration
  `20260802090000_audit_retention_window` → `audit_prune_expired(p_license_id BIGINT, p_cutoff
  TIMESTAMPTZ) RETURNS BIGINT` (`plpgsql`, `SET search_path=public,pg_temp`); YALNIZ
  `license_id=p_license_id AND created_at<p_cutoff` siler + sayı döner; `p_license_id`/`p_cutoff`
  NULL ya da `p_cutoff>=now()` → **exception** (tüm-tabloyu-silme yolu yok); `REVOKE EXECUTE FROM
  PUBLIC` + `GRANT EXECUTE TO nexa_app` — tablo DELETE yetkisi **verilmedi** (REVOKE aynen duruyor).
  SECURITY DEFINER RLS'i atladığından tek cross-tenant savunma fonksiyon-içi lisans yüklemi.
  `RetentionRunner` per-tenant döngüsüne bağlandı: dryRun RLS altında yalnız **sayar** (`#countAudit`,
  silme yolu yok), apply `nexa_app` üzerinden fonksiyonu çağırır (`#pruneAudit`); sonuç
  `data.retention_pruned` metadata'sına `audit_entries` + `report.auditEntries` toplamına yazılır
  (iskeletin sabit 0'ı gerçek sayımla değişti); `run.ts` özeti audit sayacını basıyor.
- **Doğrulama:** `db:migrate` (33 migration, yenisi uygulandı) + `db:check-drift` temiz (schema.prisma
  değişmedi) · `pnpm -w typecheck` ✓ · `pnpm -w lint` ✓ · `pnpm -w test:unit` ✓ · `pnpm -w
  test:integration` ✓ (**api 906**, +11: `retention.test.ts` 8→16, `audit-log.test.ts` 32→35;
  contract-parity 5/5, mevcut 'log cannot be rewritten' regresyonsuz) · `pnpm -w build` ✓.
- **Varsayımlar:** (1) İmza spec'te **2-arg sabit** (batch limit param'ı yok) → tek hedefli `DELETE`
  kullanıldı; plpgsql `LOOP` tek transaction olduğundan iç-batch'in kilit/tx-boyutu faydası yok,
  "batch'li" ifadesi runner'ın mevcut per-tenant döngüsünü kastediyor (en dar, en denetlenebilir
  biçim). (2) `p_license_id IS NULL` de guard'a eklendi (fail-closed; spec yalnız cutoff'u sayıyordu).
  (3) Yalnız audit budandığında da `data.retention_pruned` yazılır (silme bir olaydır; yeni entry
  taze olduğundan asla re-count edilmez). **E2E uygulanmadı** — bu slice backend bakım fonksiyonu,
  UI/E2E akışı yok (tm 92.6 -f ile aynı gerekçe); KK integration ile uçtan uca kanıtlandı.
- **Sonraki pencereye not:** `08.9.7` hâlâ `◐`. Kalan: `-i/-j` audit ekranı · plan/tier kapısı
  (entitlement mekanizması repoda hâlâ yok) · `-k` uçtan uca doğrulama (artık `-h` dahil tüm
  bağımlılıkları `-j` hariç hazır). `audit_prune_expired`, retention'ın append-only log'daki tek
  deliği — genişletmeden önce dar tutulmalı.

### tm 92.6 — 08.9.7-f Rol değişimi ucu (PUT /agents/{agentId}/role) + member.role_changed audit'i — done — 2026-08-02 UTC

- **Yapıldı:** OPUS-MAX. NFR-S12'nin birebir saydığı 'rol değişimi' olayı artık üretilebilir: yeni
  `PUT /agents/{agentId}/role` (contract-first — `paths/agents.yaml`+`openapi.yaml`, re-bundle).
  Route **çift kapı** `{ scopes: ['agents--all:rw'], minimumRole: 'admin' }`; yetki tavanı tek akıl
  yürütme olarak (suspension `agents.ts:161-231` deseninin rol için aynısı): kendi rolünü
  değiştiremez · owner'ın rolü değişmez · **owner'a yükseltme reddedilir** (ikinci owner üretilmez) ·
  aktörün rolünü aşan hedef **ve** yeni rol reddedilir (`roleAtLeast`) — hepsi **403**; no-op (aynı
  rol) hiçbir entry yazmaz. `AUDIT_ACTIONS`'a kapalı sözlük `member.role_changed`; entry aynı
  `withTenant(tx)` içinde, `target=account:<id>`, `metadata` YALNIZ `{ from, to }`.
- **Doğrulama:** `pnpm -w typecheck` ✓ · `pnpm -w lint` ✓ · `pnpm -w test:unit` ✓ (api 263) ·
  `pnpm -w test:integration` ✓ (rtm 51 + api 895, **contract-parity 5/5**; yeni `agents-role.test.ts`
  12, `audit-log.test.ts` 31→32, `agents-suspension` 13 regresyonsuz) · `pnpm -w build` ✓.
- **Varsayımlar:** Rol gövdesi `z.enum(AGENT_ROLES)` (owner dâhil) kabul edilir ama `owner` runtime'da
  **403** ile reddedilir — böylece "admin→owner → 403" kabul kriteri sağlanır (400 değil) ve ikinci
  owner asla üretilmez; owner devri ayrı/daha ağır bir işlem olarak kapsam dışı bırakıldı.
  Guard negatifleri suspension'ın **komşusu** yeni `agents-role.test.ts`'te toplandı; birebir KK
  (agent→admin tam-1 entry) `audit-log.test.ts`'e eklendi.
- **Sonraki pencereye not:** E2E kapısı **uygulanmadı** — bu tur **ekran/UI yok** (KAPSAM DIŞI: Team
  ekranında rol değiştirme -i/-j'nin işi); kapsanan akış API+audit seviyesinde ve integration ile
  uçtan uca kanıtlandı. Kalan 08.9.7 payı: `-h` 30-gün fiili budama (append-only'de SECURITY DEFINER
  fonksiyon) · `-i/-j` ekran · plan/tier kapısı · `-k` uçtan uca doğrulama. `08.9.7` satırı hâlâ `◐`.

### tm 92.5 — 08.9.7-e İçerik ve entegrasyon silme uçlarında data.deleted audit'i — done — 2026-08-02 UTC

- **Yapıldı:** SONNET-XHIGH — 08.9.7-d'de tanımlanan `data.deleted` eylemi beş içerik/entegrasyon
  silme ucuna uygulandı: `DELETE /websites/:id`, `DELETE /skills/:id`, `DELETE
  /knowledge-sources/:id` (AI-agent), `DELETE /copilot/knowledge/:id`, `DELETE /settings/apps/:id`.
  Her biri kendi mevcut `request.withTenant(tx)` bloğu içinde, servisin döndürdüğü `count` (veya
  route'un kendi `deleteMany` sonucu) `> 0` iken `writeAuditEntry` çağırıyor — `canned_response`
  deseninin (settings.ts:568-591) birebir kopyası. `target=<kind>:<id>` (website / skill /
  knowledge_source / copilot_source / app_installation), `metadata` YALNIZ `{ kind }`.
- **Doğrulama:** `pnpm -w typecheck` ✓ · `pnpm -w lint` ✓ · `pnpm -w build` ✓ · `apps/api`
  `pnpm test:unit` (19 dosya/262 test) ✓ · `apps/api` `pnpm test:integration` (tek fork/seri koşum,
  gerçek Postgres'e karşı — [[nexa-test-gate-parallel-db]]) 43 dosya/882 test yeşil —
  `test/integration/audit-log.test.ts` 25→31 test (+6: beş ucun her biri pozitif tam-1-entry +
  no-op-404 hiç yazmaz; tek cross-tenant temsilci senaryo — website — hiçbir log'a düşmez). Root
  `contract-parity.test.ts` de aynı koşuda yeşil (bu task OpenAPI'ye dokunmadı). E2E: grep
  `apps/e2e/tests/*.spec.ts` bu beş silme ucuna dokunan bir test döndürmedi (playbook.spec.ts ve
  settings.spec.ts başka akışları kapsıyor) — task'ın kapsadığı akış saf API+DB, E2E ilgisiz
  ([[nexa-early-delivered-slices-audit]] ile aynı gerekçe: dokunulmamış yüzeye E2E koşulmaz).
- **Varsayımlar:** `app_installation` hedefinin `<id>`'si `appId` (katalog slug'ı, ör. `hubspot`) —
  `AppInstallation` satırının kendi UUID'si değil; bu tenant içinde kurulumu tekil olarak
  tanımlayan kimlik budur (route zaten yalnız bunu alıyor).
- **Sonraki pencereye not:** 08.9.7'nin kalan v2 payı değişmedi (bu task -e'yi kapattı): rol-değişimi
  olayı `-f` (OPUS-MAX) · 30-gün budama `-h` (OPUS-MAX, append-only SECURITY DEFINER) · ekran
  `-i`/`-j` · uçtan uca doğrulama `-k`. PLAN.md §5.0 satır 1121 güncellendi (evidence eklendi,
  durum `◐` kalıyor — henüz -f/-h/-i/-j/-k açık). Faz-2 dağılım sayacı (satır 22/1100) bu görevle
  değişmedi çünkü 08.9.7'nin durum damgası değişmedi (zaten `◐` idi, öyle kalıyor).

### tm 92.4 — 08.9.7-d data.deleted eylemi + ayarlar ailesi hedefli silmelerinde audit — done — 2026-08-02 UTC

- **Yapıldı:** SONNET-XHIGH — bu pencere önceki bir pencerenin commit'lenmemiş WIP'ini (§D70
  notunda "kapsam dışı" bırakıldığı doğrulandı) denetleyip tamamladı. `AUDIT_ACTIONS`'a kapalı
  sözlük eylemi `data.deleted`. Beş hedefli silme ucu — canned_response, tag (`settings.ts`
  içinde inline, trusted-domain deseni birebir) + custom_field, ticket_rule,
  ticket_email_template (servis katmanına yeni `audit: AuditContext` parametresi, route'lar
  `request.auditContext()` geçiyor) — mevcut `withTenant(tx)` bloğu içinde ve yalnız
  `count > 0`'da `writeAuditEntry` çağırıyor; `target=<kind>:<id>`, `metadata` YALNIZ `{ kind }`.
- **Doğrulama:** `pnpm -w typecheck` ✓ · `pnpm -w lint` ✓ · `pnpm -w build` ✓ ·
  `apps/api` içinde `pnpm test` (unit+integration birleşik vitest run, gerçek Postgres'e karşı)
  62 dosya / 1138 test yeşil — `services/audit/audit-log.test.ts` (+1: sözlükte `data.deleted`)
  ve `test/integration/audit-log.test.ts` (+6: beş uç pozitif tam-1-entry, no-op-404 hiç
  yazmaz, cross-tenant hiçbir log'a düşmez, silinen kaydın metni asla metadata'ya sızmıyor)
  dahil. `contract-parity.test.ts` de aynı koşuda yeşil (bu task OpenAPI'ye dokunmadı, kontrat
  değişmedi). E2E: bu akışa dokunan bir Playwright testi yok (grep boş) — task'ın kapsadığı akış
  saf API+DB seviyesinde, integration testleri tarafından doğrulandı; E2E ilgisiz.
- **Varsayımlar:** [[nexa-early-delivered-slices-audit]] deseninin tersi — bu kez kod gerçekten
  eksikti (WIP halinde), yalnız işaretleme/commit eksikti; "audit+kapat" değil "bitir+kapat".
- **Sonraki pencereye not:** 08.9.7'nin kalan v2 payı: içerik/entegrasyon silme uçlarında
  data.deleted (`-e`, bu task'a bağımlı) · rol-değişimi olayı (`-f`) · 30-gün budama (`-h`) ·
  ekran (`-i`/`-j`) · uçtan uca doğrulama (`-k`). PLAN.md §5.0 satır 1121 güncellendi (evidence
  eklendi); Faz-2 dağılım sayacı (satır 22/1100) bu görevle değişmedi çünkü 08.9.7 zaten `◐` idi
  ve öyle kalıyor (henüz tüm alt-kalemler bitmedi).

### Faz-2 özet sayacı senkronu — §D70 — done — 2026-08-02 UTC

- **Yapıldı:** DÜZELTME penceresi (panel §1.2 bulgusu). Faz-2 dağılım sayacı bayattı: özet
  (satır 22 üst-tablo + satır 1100 §5.0) `21 ⬜ · 6 ✅ · 3 ⛔` diyordu; §5.0 gereksinim tablosu
  (satır 1108–1137, 30 satır) öncü-damga sayıldığında `20 ⬜ · 1 ◐ · 6 ✅ · 3 ⛔` (toplam 30 sabit).
  **Kök neden:** `08.9.7` satırı (1121) tm 92.1–92.7 audit-log turlarında `⬜→◐` çevrildi (kısmi
  teslim: -a/-b/-c/-g) ama sayaç güncellenmedi — özet en son tm 91.7'de (`7f2781f`) yazılmıştı, o
  commit'te satır 1121 `⬜`'di; satır en son tm 92.7'de (`f299096`, özetten SONRA) `◐` oldu. Panelin
  `7 ✅ / 19 ⬜` iddiası ise yine satır 1108'in gömülü `` `✅` `` glifinin naif ham-glif kayması
  (§D68/§D69 kalıcı yanlış-pozitifi) — ama bu turda altında **gerçek** `◐` bayatlığı vardı.
  **Yapılan (YALNIZ dağılım sayacı):** satır 22 + 1100 → `20 ⬜ · 1 ◐ · 6 ✅ · 3 ⛔`; §D70 notu.
  Gereksinim satır damgalarına + `23 açık kalem` kapanış-paydasına DOKUNULMADI.
- **Doğrulama:** yalnız doküman değişti (PLAN.md + HANDOFF.md) → kod DoD kapısı (typecheck/lint/
  test/integration/build/e2e) uygulanmaz [[nexa-early-delivered-slices-audit]] deseni "verify+close".
  Sayaç doğrulaması reprodüktibl: `awk` öncü-damga sayımı §5.0 (satır 1108–1137) → `6 ✅ · 1 ◐ ·
  20 ⬜ · 3 ⛔ · TOTAL 30`, özet ile birebir uyuşuyor. Kök neden git ile kanıtlandı
  (`git show 7f2781f:PLAN.md` satır 1121 = `⬜`; HEAD = `◐`; blame özet=91.7, satır=92.7).
- **Varsayımlar:** özet satırının `📋 PLANLANDI, kod başlamadı` anlatısı kapsam dışı bırakıldı —
  görev yalnız sayısal sayacı düzeltmeyi kapsıyor, anlatı revizyonunu değil. Çalışma alanındaki diğer
  pencerelerin commit'lenmemiş kod değişiklikleri (audit-log.ts vb.) bu commit'e DAHİL EDİLMEDİ —
  kapsam dışı; yalnız PLAN.md + HANDOFF.md stage'lendi.

### tm 92.7 — 08.9.7-g Retention politikasına audit penceresi (RETENTION_AUDIT_DAYS=30) — done — 2026-08-02 UTC

- **Yapıldı:** SONNET-XHIGH — `RetentionPolicy`'ye dördüncü pencere `auditDays`, mevcut
  threadDays/visitDays/mailDays üçlüsünün deseni birebir kopyalanarak (arayüz alanı + docstring +
  `resolveRetentionPolicy` passthrough). Env'e `RETENTION_AUDIT_DAYS` (`z.coerce.number().int()
  .positive().default(30)` — NFR-S12 "son 30 gün") + `.env.example` satırı. `RetentionCutoffs`'a
  `audit: Date` + `resolveCutoffs`'ta `cutoffFor(policy.auditDays, now)` — aynı tablo-silme guard'ı
  (pozitif olmayan pencere `RangeError`) otomatik olarak audit penceresine de uygulanıyor.
  `RetentionReport`'a `auditEntries` sayacı (top-level + `totals.auditEntries`, `mailFiles`
  desenindeki gibi tenant-bağımsız tek alan) — bu adımda **daima 0**, fiili silme yok (08.9.7-h'nin
  işi). Runner davranışı değişmedi: cutoff hesaplanıyor ama hiçbir sorguda kullanılmıyor.
- **Doğrulama:** `pnpm -w typecheck` ✅ · `pnpm -w lint` ✅ · `pnpm -w build` ✅ · `apps/api` unit
  (`pnpm test:unit`, 19 dosya/261 test, `policy.test.ts` 8→8 yeşil, +3 yeni: dört pencere
  `resolveCutoffs`, audit guard, NFR-S12 varsayılan-30 pin) ✅ · `apps/api` integration
  (`pnpm test:integration`, .env source edilip DB/Redis'e karşı, 43 dosya/870 test — `retention
  .test.ts` 8 dahil, `POLICY` literal `auditDays: 30` ile genişletildi + `auditEntries: 0` skeleton
  assert eklendi) ✅ · `apps/rtm` integration ayrıca **serial** koşuldu (90 test, hepsi yeşil) — ilk
  `pnpm -w test` (paralel) rtm+api aynı Postgres'e yarıştığı için 19 rtm testini FK-violation ile
  düşürdü ([[nexa-test-gate-parallel-db]] memory'sinin teyidi); kök neden bu değişiklikle **ilgisiz**,
  serial koşuda hepsi geçti. E2E koşulmadı — bu task kontrat/route/frontend dokunmuyor, kapsadığı akış
  yok (saf politika/env/rapor-tipi iskeleti; DB'ye hiç dokunmuyor).
- **Varsayımlar:** `auditEntries` sayacını `mailFiles` deseniyle (tenant-bağımsız, top-level +
  totals'ta tek alan) modelledim, `threads`/`visits` deseniyle (`TenantPruneResult` içinde per-tenant)
  değil — çünkü bu adımda gerçek silme/sayma mantığı yok, hangi deseni izleyeceği 08.9.7-h'nin
  tasarım kararı (audit_log tenant-scoped bir tablo, muhtemelen per-tenant sayılacak). İskelet bu
  belirsizliği açık bırakıyor; -h bunu değiştirebilir.
- **Sonraki pencereye not:** 08.9.7-h (bağımlı, `OPUS-MAX`) bu pencerenin üstüne fiili
  `audit_prune_expired` SECURITY DEFINER + sweep entegrasyonunu inşa edecek — `auditEntries`'in
  top-level mi per-tenant mi olacağına orada karar ver (yukarıdaki varsayıma bak). Kalan v2 payı
  (§PLAN.md 08.9.7 satırı): -e/-f/-h/-i/-j/plan-tier-kapısı/-k.

### tm 92.2 — 08.9.7-b Audit liste filtreleri: eylem, aktör, tarih aralığı — done — 2026-08-02 UTC

- **Yapıldı:** SONNET-XHIGH — GET /audit-log'a katkısal sorgu parametreleri: `action` (`AUDIT_ACTIONS`
  kapalı sözlüğünden `z.enum`), `actor_id` (`z.string().uuid()`), `date_from`/`date_to`
  (`z.coerce.date()`). Reader tarafında (`audit-log-reader.ts`) 30 günlük varsayılan pencere +
  action/actor/date filtreleri tek bir `buildWhere` yardımcısında birleştirildi (customer-service.ts
  `#where` deseninin birebir kopyası: filtre dizisi, tek elemansa direkt, birden fazlaysa `AND`).
  `date_from` verilirse varsayılan alt sınırın yerine geçer; `date_to` verilmezse üst sınır açık kalır
  (şimdiye kadar). `action` verildiğinde Prisma sorgusu `(license_id, action, created_at DESC)`
  indeksini kullanır (WHERE'de eşitlik koşulu olarak — planı doğrulamak için ek bir adım atılmadı,
  şema zaten bu indeksi bu erişim deseni için taşıyordu). Route tarafında `date_from > date_to` →
  400 (reports.ts `resolveRange` deseninin birebir kopyası, ApiError.validation). Kontrat
  (`paths/audit-log.yaml`) 4 yeni query parametresiyle katkısal genişletildi + re-bundle edildi
  (`pnpm --filter @nexa/contract generate`) — yeni operation yok, contract-parity operasyon kümesi
  değişmedi.
- **Doğrulama:** `pnpm -w typecheck` ✅ · `pnpm -w lint` ✅ · `pnpm -w build` ✅ · `pnpm --filter
  @nexa/api exec vitest run` (unit, 19 dosya/259 test) ✅ · `pnpm -w test:integration --filter=@nexa/api`
  (`--concurrency=1`, 43 dosya/870 test dahil `contract-parity.test.ts` ve genişletilmiş
  `audit-log-read.test.ts` 7→17) ✅. E2E koşulmadı — bu task'ın kapsadığı akışta ekran/UI yok (filtre
  kontrolleri ayrı task `08.9.7-j`, açıkça KAPSAM DIŞI).
- **Varsayımlar:** OpenAPI'de `action` parametresi `AuditLogEntry.action` şemasındaki gibi serbest
  `type: string` bırakıldı (28 elemanlı `AUDIT_ACTIONS`'ı kontratta da enum'lamak, yeni eylem her
  eklendiğinde iki dosyayı senkron tutmayı zorunlu kılardı — response şemasında zaten aynı gerekçeyle
  enum'lanmamıştı); backend zod tarafında `z.enum(AUDIT_ACTIONS)` ile sıkı doğrulama korunuyor, yalnız
  kontrat seviyesinde gevşek. `date_to` verilmeden `date_from` verilirse üst sınır bugüne kadar açık
  kalır (spec bunu örtük bırakıyordu, reports.ts `resolveRange`'in aksine burada "to" için ayrı bir
  varsayılan yok — mevcut günden okuma zaten en yeni kayıtları kapsıyor).
- **Sonraki pencereye not:** `08.9.7-j` (ekran filtreleri) artık açık — bu task'ın API yüzeyine bağımlıydı.
  `08.9.7-k` (uçtan uca NFR-S12 doğrulaması) hâlâ -e/-f/-h/-j'yi bekliyor. Reader'daki `buildWhere`
  deseni ileride başka bir filtre eklenirse (ör. `target`) aynı yere eklenmeli — dağınık where-inşası
  yok.

### tm 92.3 — 08.9.7-c Webhook değişimi audit'i: `webhook.created` / `webhook.deleted` — done — 2026-08-02 UTC

- **Yapıldı:** OPUS-XHIGH — NFR-S12'nin birebir saydığı "webhook değişimi" olayı hiç kaydedilmiyordu
  (`grep writeAuditEntry` webhooks.ts'te 0 sonuç). `AUDIT_ACTIONS` kapalı sözlüğüne `webhook.created` +
  `webhook.deleted` eklendi (`services/audit/audit-log.ts`). `routes/webhooks.ts`: POST /webhooks ve
  DELETE /webhooks/:id, register/unregister'ı zaten saran **aynı** `withTenant` tx'inin İÇİNDE
  `writeAuditEntry` çağırıyor — trail ile registry ya birlikte yazılır ya hiç. `target=webhook:<id>`;
  `metadata` YALNIZ `{ action, type, url_host }`. **Secret savunması çağrı yerinde:** register yanıtı
  plaintext `whsec_…` döndürür ve `sanitizeAuditMetadata` regex'i `url`/`value` anahtarlarını
  yakalamaz, o yüzden log'a tam URL değil yalnız `new URL(...).host` yazılır (yeni `urlHost()` helper,
  storage'dan gelen değer için `try`'lı). Silme audit'i için satır **silmeden önce** RLS-scoped
  `findUnique` ile okunur (unregister yalnız count döndürüyor); yazım yalnız `count>0 && doomed`'da →
  404 no-op ve cross-tenant miss hiçbir entry yazmaz. Sözleşme değişmedi (yan etki olarak audit satırı).
- **Doğrulama:** `pnpm -w typecheck` ✅ · `pnpm -w lint` ✅ · `pnpm -w build` ✅ · `pnpm -w test:unit`
  (api audit-log.test.ts +1 = 7; rtm dahil) ✅ · yeni/ek testler `apps/api/src/services/audit/audit-log.test.ts`
  (+1: sözlük iki eylemi içeriyor, tekrar yok) + `apps/api/test/integration/audit-log.test.ts` (+3: create
  host-only & secret-free haystack · delete + 404 no-op · cross-tenant hiç yazmaz → dosya 16→19) ·
  `apps/api/test/integration/webhooks.test.ts` regresyonsuz (12) · tam `pnpm -w test:integration`
  (`--concurrency=1`) ✅.
- **Varsayımlar:** `url_host` = URL'nin `.host`'u (hostname[:port]); path/query/secret hariç. Delete
  metadata'sı için silinen webhook'un action/type/host'u aynı tx içinde okunuyor (task metadata şeklini
  register+unregister için ortak tanımlıyor).
- **Sonraki pencereye not:** `08.9.7-d` (data.deleted + ayarlar ailesi silme audit'i) `08.9.7-c`'ye
  bağlıydı, artık açık. `08.9.7-f` (rol değişimi ucu, OPUS-MAX) de `-c`'ye bağlı. NFR-S12 uçtan uca
  doğrulama `-k` hâlâ -e/-f/-h/-j'yi bekliyor. Yeni audit eylemi eklerken desen: sözlük + çağrı yerinde
  secret savunması + `removed>0` kapısı + cross-tenant negatif test.

### tm 92.1 — 08.9.7-a Audit log okuma kontratı + `audit_log--all:ro` scope'u + GET /audit-log (keyset, son 30 gün) — done — 2026-08-02 UTC

- **Yapıldı:** OPUS-XHIGH — audit trail'in ilk **okuma** yüzeyi (yazıcı tm 23'ten beri vardı, okuma yoktu).
  Contract-first: yeni `GET /audit-log` — `packages/contract/openapi/paths/audit-log.yaml` + `openapi.yaml`
  (path kaydı + `AuditLogEntry` şeması + `Audit` tag; re-bundle → 114 path). Yeni scope `audit_log--all:ro`
  (`packages/types/src/scopes.ts`; guard `scopes.test.ts` NEXA_ADDED 6→7 = 65 scope; `principal.ts`
  ADMIN_SCOPES'a eklendi → owner/admin varsayılan alır). Okuma servisi
  `apps/api/src/services/audit/audit-log-reader.ts`: keyset (created_at DESC, id DESC, base64url cursor),
  filtresiz varsayılan **son 30 gün** (`(license_id, created_at DESC)` indeksi, tam tablo taraması yok),
  limit **kırpılır** (reddedilmez), **RLS'ye güvenir** (ekstra license filtresi yok). Route
  `apps/api/src/routes/audit-log.ts`: `{ scopes: ['audit_log--all:ro'], minimumRole: 'admin' }` **çift kapı**;
  `server.ts`'e register.
- **Doğrulama:** `pnpm -w typecheck` ✅ · `pnpm -w lint` ✅ · `pnpm -w build` ✅ · `@nexa/types` unit (scopes
  65) ✅ · yeni `apps/api/test/integration/audit-log-read.test.ts` (9: negatif-önce rol/scope kapısı +
  cross-tenant + 30 gün + keyset + clamp + şekil) + `contract-parity` ✅ · tam `@nexa/api` integration süiti
  ✅ (izole koşu). **UYARI (öğrenildi):** iki DB-süitini **paralel** koşarsan (ör. `test:integration` arka
  planda + `test:unit` ön planda) `copilot.test.ts` / rtm `conflict.test.ts` paylaşılan Postgres+Redis'te
  **yarışır ve yanlış-negatif** verir — süitleri **seri** koş. Bu turda ilk paralel koşu 2 copilot + 3
  conflict yanlış-negatifi verdi; her ikisi de izole koşuda yeşil (15/15, 6/6).
- **Varsayımlar:** `ip` kolonu okuma yanıtında owner/admin'e döner (forensic değeri; yalnız owner/admin görür).
  Tekil kayıt `GET /audit-log/{id}` ve filtreler KAPSAM DIŞI (-b/detay). `total` alanı yok — keyset yeterli,
  30-gün penceresinde count maliyetinden kaçınıldı. Yeni ApiError tipi eklenmedi (403 = mevcut `authorization`).
- **Sonraki pencereye not:** 08.9.7 **◐ (kısmi)** — bu tur yalnız okuma çekirdeği. Kalan: filtreler -b (bu -a'ya
  bağlı) · olaylar -c/-e/-f · budama -h · retention -g · ekran -i/-j · plan/tier kapısı · uçtan uca -k.
  **Bayat yorum:** `ip-allowlist.test.ts` sat. 359-364 + HANDOFF tm 80.9 "GET /audit-log endpoint'i YOK" diyor —
  artık yanlış; test davranışı (RLS okuma yolu) hâlâ geçerli, yalnız yorum bayat. Kapsam disiplini gereği o
  dosyaya dokunulmadı; -i/-b turunda güncellenebilir.

### tm 91.7 — 08.6.3-conflict-g Uçtan uca doğrulama: iki-ajan çakışma senaryosu + cross-tenant/negatif süiti + kanıt — done — 2026-08-02 UTC

- **Yapıldı:** OPUS-XHIGH — yalnız **doğrulama**, yeni davranış/özellik yüzeyi YOK (yeni kaynak
  dosyası değişmedi; sadece test eklendi). -b/-c/-d/-e/-f kendi katmanlarına bakıyordu; -g yolun
  BÜTÜNÜNÜ tek yerde kanıtlar. `apps/rtm/test/integration/rtm.test.ts` `conflict warning` describe'ına
  4 yeni `it` eklendi (5→9): (1) **tam yaşam döngüsü + drop** — iki ajan yazar → çift
  `agent_conflict_warning` → biri `is_typing=false` → kalan ajan tek başına yeniden yazınca YENİ uyarı
  gelmez (kayıt sunucuda gerçekten `ZREM`'lendi; istemci idle-timer'ına bağlı değil). (2) **şekil
  paritesi** — RTM'in soket üzerinden yayınladığı GERÇEK payload, web `useInbox.applyPush`'un
  (`apps/web/src/features/inbox/useInbox.ts` `agent_conflict_warning` case) okuduğu alanlarla birebir
  doğrulanır: reader mantığı testte kopyalanıp gerçek frame'e uygulanır, `chat_id`/`agents[].agent_id`/
  `agents[].since`/`detected_at` string + `thread_id` süperset. Bu, -g'nin var oluş nedeniydi:
  RTM-payload↔web-shape paritesini doğrulayan başka yer yoktu. (3) **02.9 dayanıklılık** — composer
  registry anahtarı test istemcisiyle WRONGTYPE'a çevrilip (`SET` string) Lua script'i patlatılır →
  `send_typing_indicator` yine `success:true` döner, hayalet uyarı çıkmaz (dispatcher try/catch).
  (4) **cross-tenant ayna** — ikinci lisansın iki soketi aynı chatId ile tüm akışı koşar → her ikisi
  `not_found`, 0 push; bu sırada A'nın kendi iki-ajan çakışması normal ateşler (B'nin denemeleri A'nın
  registry'sine dokunmadı). API devir uçtan-uca + cross-tenant fence + registry-hata dayanıklılığı
  zaten -d'nin `apps/api/test/integration/agent-conflict.test.ts` (5 test) dosyasında mevcut; -g bunu
  yeniden yazmadı (audit-close: erken teslim edilmiş dilim). `tenant-isolation.test.ts` saf DB/RLS
  süiti (HTTP/Redis yok) — çakışma yüzeyi yok; DOSYALAR'da referans desen olarak listelenmiş,
  cross-tenant çakışma iddiası mimari olarak agent-conflict.test.ts + rtm.test.ts'e ait, oraya eklendi.
- **Doğrulama (tam DoD kapısı, exit 0):** `pnpm -w typecheck` yeşil (11/11) · `pnpm -w lint` yeşil (8/8)
  · **test (unit+integration, `turbo run test --filter='!@nexa/e2e' --concurrency=1` — memory
  nexa-test-gate-parallel-db uyarınca paketler arası SERİ):** yeşil, API 61 dosya/**1108 test**, RTM
  dahil tüm paketler; izole RTM `conflict warning` süiti 9/9 (yeni 4 + eski 5). `pnpm -w build` yeşil
  (7/7). `pnpm -w test:e2e` yeşil — **61 passed**, ilgili `inbox-panel.spec.ts › multi-agent composing
  conflict › a conflict banner appears...` (KK "inbox'ta şeridin görünmesi") dahil.
- **Varsayımlar:** (1) `pnpm -w test`'i paralel değil `--concurrency=1` ile koştum — paket `test`
  script'i unit+integration'ı birlikte çalıştırır, paralel turbo paylaşımlı Postgres'i yarıştırır
  (tm 91.6 notu + memory); serileştirme aynı kapının doğru sürümü, integration'ı da kapsar.
  (2) Redis-hata enjeksiyonu için sunucunun iç Redis'ine seam yok → composer anahtarını dışarıdan
  WRONGTYPE'a çevirmek Lua register yolunu gerçekten patlatan, kaynağa dokunmayan temiz enjeksiyon.
- **Sonraki pencereye not:** `08.6.3-conflict` özelliği **a→g TAMAMLANDI**; PLAN.md §5.0 satırı `◐`→`✅`,
  Faz-2 sayacı `22 ⬜/5 ✅` → `21 ⬜/6 ✅` (üst-tablo satır 22 + §5.0 satır 1100, öncü-damga sayımı;
  D69'daki naif ham-glif tuzağına düşülmedi). PLAN §5.2/§5.3.2 dilim tabloları öncü damga taşımaz
  (D69), dokunulmadı. Panelin naif sayacı hâlâ satır 1108 gömülü `✅` glifi yüzünden +1 ✅ sapabilir
  (bilinen §D68/D69 yanlış-pozitifi, benim değişikliğim değil). Bir sonraki bağımsız v2 kalemi §5.2'den
  seçilebilir (08.6.3 skills-routing veya başka ⬜).

### tm 91.6 — 08.6.3-conflict-f Realtime kablolama: agent_conflict_warning aboneliği + applyPush case'i + banner montajı — done — 2026-08-02 UTC

- **Yapıldı:** SONNET-XHIGH — çakışma uyarısının son bacağı, -c'nin (RTM publisher) ürettiği
  push'u -e'nin (client state) store'una bağlar. (1) `apps/web/src/features/inbox/useInbox.ts` —
  `RtmClient` `pushes` listesine `agent_conflict_warning` eklendi; `applyPush`'a yeni case,
  `incoming_typing_indicator`'ın birebir deseninde: `chat_id` string + `agents` dizisi (her üye
  `{agent_id, since}` string) + `detected_at` string doğrulanır, herhangi biri bozuksa push
  tamamen yok sayılır (çökmez) → `useConflictStore.getState().note(chatId, agents, detectedAt)`.
  `chat_deactivated` case'ine `useConflictStore.getState().clear(chatId)` eklendi — kapanan sohbet
  "çakışıyor" kalamaz, `typing` store temizliğinin aynısı. `applyPush` artık export'lu (testin
  push handler'a başka giriş yolu yok). (2) `InboxPage.tsx` — `ConflictBanner`, `TypingIndicator`
  ile aynı bloğa, composer'dan hemen önce monte edildi.
- **Doğrulama:** `pnpm -w typecheck` yeşil · `pnpm -w lint` yeşil · `pnpm -w build` yeşil.
  Unit: yeni `useInbox.test.tsx` (7: kayıt+şekil, chat_id/agents/agent-üyesi eksikse sessiz
  yok-sayma, boş payload çökmez, push→store→banner tam zincir, `chat_deactivated` temizler) —
  web paketi izole 70 dosya/475 test yeşil. `pnpm -w test:integration` (rtm 47 + api 850, serial
  `--concurrency=1`) yeşil. `pnpm -w test` (workspace paralel) yine bilinen paylaşımlı-Postgres
  yarışıyla kırmızı çıktı (memory: nexa-test-gate-parallel-db) — rtm (86/86) ve api (1108/1108)
  izole çalıştırıldığında temiz. E2E: `apps/e2e/tests/inbox-panel.spec.ts`'e gerçek iki-ajan
  senaryosu eklendi — owner (`agentPage`) + seeded `agent1@acme.localhost`, tazece açılan bir
  visitor konuşmasında eşzamanlı yazma → RTM→ConflictDetectionService→ConflictPublisher→client
  zinciri uçtan uca tetiklenip banner `data-testid="conflict-banner"` ile görünür oluyor; iki kez
  (izole + tam 61 testlik suite içinde) yeşil geçti. İlk deneme "All" view'daki **ilk** sohbeti
  açıyordu — `chat-service.ts` `case 'all': return {}` (active filtresi yok) yüzünden bu, önceki
  bir testin arşivlediği (composer'ı disabled) bir sohbet olabiliyordu; tazece açılan bir widget
  konuşmasına ve mesaj metniyle eşleşen satıra (`filter({hasText})`) geçilerek düzeltildi.
- **Varsayımlar:** E2E ikinci ajan hesabı için seeded `agent1@acme.localhost` (Sam Rivera, admin,
  `nexa-demo-password`) kullanıldı — admin de owner gibi `chats--all:rw` (unrestricted) aldığından
  ikisi de "All" view'da aynı sohbeti görüyor.
- **Bilinen, bu görevin dışı:** Tam e2e suite'i arka arkaya iki kez (reset olmadan) çalıştırınca
  `customers.spec.ts`'te 2 test kırmızı çıktı (ban/unban + conversation-count state'i) — seed
  idempotent, mutasyonu geri almıyor (memory: nexa-e2e-clean-db). inbox-panel.spec.ts'le ilgisi
  yok; tek-seferlik suite koşusunda customers.spec.ts de yeşildi. Bir sonraki pencere tam suite
  koşacaksa önce `db:reset` (CLAUDE.md sınırları: gerçek prod DB değil, yerel dev — yine de bu
  görevin kapsamı dışında bırakıldı, hiçbir dosya değişikliği bu bulguyla ilgili değil).
- **Sonraki pencereye not:** `08.6.3-conflict-g` (uçtan uca doğrulama: cross-tenant/negatif
  matris + kanıt) kaldı — bu görev yalnız pozitif iki-ajan yolunu kapsadı, negatif/cross-tenant
  senaryolar zaten alt katmanlarda (-b/-c/-d testlerinde) kapsanmış durumda; -g'nin işi bunları
  tek bir uçtan-uca kanıt turunda toplamak.

### tm 91.5 — 08.6.3-conflict-e İstemci çakışma state'i + ConflictBanner bileşeni (salt görünüm) — done — 2026-08-02 UTC

- **Yapıldı:** SONNET-XHIGH — çakışma uyarısının istemci yüzeyi, `typing.ts`/`TypingIndicator.tsx`
  deseninin birebir kopyası. (1) `apps/web/src/features/inbox/conflict.ts` — zustand store,
  `byChat: Record<chatId, {agents: {agentId, since}[], detectedAt}>`; `note(chatId, agents,
  detectedAt)` <2 ajanlı payload'ı çakışma saymayıp temizler, `clear(chatId)`; idle-lapse süresi
  sabit kodlanmadı — `CONFLICT_IDLE_MS = AGENT_COMPOSING_TTL_SECONDS * 1000` (`@nexa/types`'tan),
  sunucunun composer-registry TTL'iyle aynı pencereyi kullanır. (2) `ConflictBanner.tsx` —
  `role='status'` + `aria-live='polite'`; çakışma yoksa `null` (layout zıplamaz); "Bu sohbette N
  ajan aynı anda yazıyor" + `agent_id` listesi. Ağ çağrısı, push aboneliği yok (-f'nin işi).
- **Doğrulama:** `pnpm -w typecheck` yeşil · `pnpm -w lint` yeşil · `pnpm -w build` yeşil ·
  yeni testler: `conflict.test.ts` (5) + `ConflictBanner.test.tsx` (5), hepsi yeşil. Workspace
  `pnpm -w test` tek seferde rtm'de deadlock'la kırmızı çıktı (bilinen paylaşımlı-Postgres yarışı,
  memory: nexa-test-gate-parallel-db) — rtm (86/86) ve api (1108/1108) paketleri izole çalıştırıldığında
  temiz geçti; web paketi 468/468 (yeni 10 dahil). Bu görev için `test:integration`/`test:e2e`
  uygulanmaz — kendi test stratejisi notu: "güvenlik yüzeyi yok (salt görünüm, ağ yok)".
- **Varsayımlar:** Banner, çakışan ajanları `agent_id` ile gösteriyor (görünen ad çözümlemesi bu
  dizinde henüz yok ve kapsam dışı); -f/-g gerçek isimlendirme ihtiyacı doğrulayacak.
- **Sonraki pencereye not:** `08.6.3-conflict-f` (realtime kablolama: `agent_conflict_warning`
  aboneliği + `applyPush` case'i + banner'ın InboxPage/ChatDetail montajı, `TypingIndicator`'ın
  monte edildiği yerin yanına) ve ardından `08.6.3-conflict-g` (uçtan uca doğrulama) bağımlı.

### tm 91.4 — 08.6.3-conflict-d Transfer/atama anında aktif yazıcı çakışmasının API tarafından uyarılması — done — 2026-08-02 UTC

- **Yapıldı:** OPUS-XHIGH — çakışma tespitinin İKİNCİ yüzeyi (API/transfer). `chat-service.transfer`
  transaction COMMIT'inden ve mevcut `chat_transferred` yayınından sonra yeni `#warnTransferConflict`
  çağrılır: (1) `#composerАgents` → `composerStateKey(licenseId, chatId)` sorted set'i `zrangebyscore`
  ile **SALT OKUR** (`AGENT_COMPOSING_TTL` penceresi = `now-TTL..+inf`; -b'nin yazdığı registry, mutasyon
  YOK). (2) Kapı: yalnız agent-devri (`newAssignee != null`) ve `newAssignee !== oldAssignee` — team devri
  (assignee null) ve aynı-ajana no-op devir okumaya bile gitmez. (3) `newAssignee`'den FARKLI ≥1 ajan
  yazıyorsa çakışma; audience = `[newAssignee, ...composing]` ∩ `result.audience.agentIds` (transfer'in
  before+after birleşik audience'ı) — chat'i görmeyen/başka-lisans ajan audience'a giremez (NFR-S4), fence
  altında kalan tek-eleman (<2) yayınlanmaz. (4) Payload `AgentConflictWarningPush` (-a şekli): `agents`
  = tüm composing küme, `since`/`detected_at` **ISO string** (-c publisher ile birebir parite).
  (5) `RealtimePublisher.publish(tenant,'agent_conflict_warning',{agentIds},payload)`. Tüm gövde try/catch
  — okuma/yayın best-effort, commit'lenmiş devir asla 500'e dönmez. `RedisLike`'a opsiyonel `zrangebyscore`
  eklendi (yoksa okuma no-op).
- **Doğrulama:** `pnpm -w typecheck` ✅ (11/11) · `pnpm -w lint` ✅ (8/8) · `pnpm -w build` ✅ (7/7) ·
  `pnpm --filter @nexa/api test` (unit+integration, **serial** — vitest `fileParallelism:false`) ✅ **1108/1108**
  (61 dosya; yeni `agent-conflict.test.ts` 5 dahil, `chats.test.ts` transfer regresyonu yeşil). Testler
  gerçek PG (RLS) + gerçek Redis kullanır. Negatif-önce: yazan-yok→uyarı-yok; team-devri→uyarı-yok;
  registry-okuma-hatası (zrangebyscore reject) devri bozmaz + thread yine yeni assignee'ye geçer; fence:
  outsider + cross-tenant (aynı chatId, B lisansı) audience'a girmez; pozitif: iki ajana çift audience + ISO
  payload. Değişiklik yalnız `apps/api` (types/contract/rtm/web/şema DOKUNULMADI, migration YOK) → diğer
  paket süitleri etkilenmez; e2e -d kapsamı dışı (UI yüzeyi -e/-f/-g).
- **Varsayımlar:** §C korundu — çakışma UYARIDIR (engel değil): yeni ApiError/409 YOK (errors.ts×2 +
  scopes sayacı + openapi enum + bundle regen dörtlüsü tetiklenmedi). `getChat` yanıtına `active_agent_ids`
  EKLENMEDİ → contract-parity riski yok. Kalıcı audit tablosu yok (Redis+TTL yeterli). audience `#audienceFor`
  kesişimi mevcut transfer audience'ı (before∪after agentIds) üzerinden yapıldı — grup-üyeliğiyle-entitled
  ama chat-user-olmayan composing ajan (nadir, TTL 8sn penceresi) bilinçli olarak dışarıda kalır (konservatif,
  sızıntı-averse). `zrangebyscore` ioredis WITHSCORES overload'una yapısal olarak uyar (opsiyonel metod).
- **Sonraki pencereye not:** -e (ConflictBanner + store, salt görünüm; `role=status`/`aria-live=polite`),
  -f (`useInbox` pushes'a `agent_conflict_warning` + `applyPush` case + `chat_deactivated` temizliği + banner
  montajı; **AGENT_PUSHES'a hâlâ EKLENMEDİ** — -f eklemeli), -g (uçtan uca: RTM iki-socket + API transfer
  senaryosu + RTM/web payload şekil paritesi + tam DoD kapısı + e2e). Wire şekli değişmedi:
  `AgentConflictWarningPush { chat_id, thread_id, agents:[{agent_id, since:ISO}], detected_at:ISO }`. Hem RTM
  (-c) hem API (-d) yolları artık aynı envelope'u yayınlıyor; -g her iki yolu tek yerde kanıtlar.

### tm 91.3 — 08.6.3-conflict-c send_typing_indicator yolunda çakışma tespiti + uyarının bus envelope ile her iki ajana iletimi — done — 2026-08-02 UTC

- **Yapıldı:** OPUS-XHIGH — RTM gateway ilk kez envelope YAYINLAYAN taraf oldu.
  (1) `apps/rtm/src/conflict-publisher.ts` yeni `ConflictPublisher` (RealtimePublisher'ın RTM tarafı eşi):
  `agent_conflict_warning` `BusEnvelope`'unu `licenseChannel`'a yayınlar; audience={agentIds: çakışan
  ajanların hepsi}, boş audience yayınlanmaz (fail-closed), `originConnectionId` SETLENMEZ (fanout origin'i
  eler → çakışan HER İKİ ajan da alır). `thread_id` typing frame'inde taşınmadığından RLS-scoped `threads`
  okumasıyla sunucuda çözülür (chat görünmüyorsa null → yayın yok — cross-tenant kapalı). Publish best-effort:
  asla rethrow etmez (kayıp uyarı sonraki keystroke'ta yeniden yayınlanır).
  (2) dispatcher `#typing` genişletildi: `is_typing=true` → `ConflictDetectionService.record`; `decision.conflict`
  (≥2 ajan) ise `ConflictPublisher.publish`; `is_typing=false` → kayıt silinir, yayın yok. Tüm 08.6.3 bloğu
  kendi try/catch'inde — hiçbir çakışma-hatası 02.9 typing yanıtını bozmaz.
  (3) `apps/rtm/src/server.ts` DI: ayrı `nexa-rtm-pub` Redis publish client + `ConflictDetectionService`(commands)
  + `ConflictPublisher`. Dispatcher deps opsiyonel tutuldu → `typing.test.ts` (kapsam dışı) deps eklemeden yeşil.
- **Doğrulama:** `pnpm -w typecheck` ✅ (11/11) · `pnpm -w lint` ✅ (8/8) · `pnpm -w build` ✅ (7/7) ·
  rtm **serial** (`pnpm --filter @nexa/rtm test`) ✅ **86/86** (yeni `conflict-publisher.test.ts` 4 + rtm.test.ts
  conflict warning +5; önceki 77). Kapı yeşil. Değişiklik yalnız `apps/rtm` (types/contract/api/web/şema
  DOKUNULMADI, migration YOK) → diğer paket süitleri etkilenmez; DB süiti repo'nun per-package/serial kuralıyla koşuldu.
- **Varsayımlar:** §C kararları korundu — çakışma UYARIDIR (engel değil), yeni ApiError yok, kalıcı audit tablosu
  yok, mevcut `send_typing_indicator` yeniden kullanıldı (yeni RTM client action yok), uyarı yalnız ajan yüzeyi.
  `AGENT_COMPOSING_TTL_SECONDS=8` (-a'da kondu, açık soru: ürün 8-10sn onayı gerekebilir). Uyarı `agent_id` ile
  gösterilir (ad değil; açık soru -e'ye kadar ertelenmiş).
- **Sonraki pencereye not:** -d (API transfer/atama çakışması — `composerStateKey` SALT OKUNUR, chat-service
  transfer COMMIT sonrası audience=yeni assignee+yazanlar), -e (ConflictBanner + store), -f (useInbox aboneliği +
  applyPush case + banner montajı; `AGENT_PUSHES`'a `agent_conflict_warning` EKLENMEDİ — -f eklemeli), -g (uçtan
  uca + şekil paritesi). Wire şekli: `AgentConflictWarningPush { chat_id, thread_id, agents:[{agent_id, since:ISO}], detected_at:ISO }` — `since`/`detected_at` ISO 8601 string olarak yayınlanıyor (-e/-f bunu bekler).

### tm 91.2 — 08.6.3-conflict-b ConflictDetectionService (atomik eşzamanlı-yazıcı kaydı + çakışma kararı) — done — 2026-08-02 UTC

- **Yapıldı:** OPUS-MAX bölünmez çekirdek — `apps/rtm/src/conflict.ts` yeni `ConflictDetectionService`.
  `record(principal, chatId, isComposing)`: (1) `typing.ts` `canType` deseninin birebir kopyası olan
  tenant-scoped RLS okumasıyla yetki doğrular — erişimi olmayan ajan kayıt olamaz, boş karar döner
  ('chat yok'tan ayırt edilemez, NFR-S4). (2) TEK atomik Redis Lua ile (`ZREMRANGEBYSCORE` prune +
  `ZADD` + `PEXPIRE` + `ZRANGE` geri-okuma) `composerStateKey(licenseId, chatId)` altına yazar ve
  penceredeki tüm ajanları AYNI işlemde okur — check-then-act YOK, yani eşzamanlı iki kayıtta çakışma
  kaybolmaz. `rate-limit.ts`'in `script LOAD`/`evalsha`/NOSCRIPT-fallback deseni kopyalandı.
  (3) ≥2 farklı agent_id → `conflict:true`, küme `{agentId, since}`. (4) TTL (`AGENT_COMPOSING_TTL_SECONDS`,
  ctor'da enjekte edilebilir → test'te 300ms) dolunca kayıt kendiliğinden düşer. (5) `is_typing=false`
  → atomik `ZREM`. Servis PUSH GÖNDERMEZ (yalnız karar döner; dispatcher yayını -c'nin işi).
- **Doğrulama:** `pnpm -w typecheck` ✅ (11/11) · `pnpm -w lint` ✅ (8/8) · `pnpm -w build` ✅ (7/7) ·
  rtm unit **serial** (`pnpm --filter @nexa/rtm test`) ✅ 77/77 (yeni `conflict.test.ts` 6 dahil; önceki 71) ·
  `turbo test:integration --concurrency=1` ✅ (api + rtm; değişiklik src-only, integration'a dokunmadı).
  Testler **gerçek PG (RLS-enforcing app-role) + gerçek Redis** kullanır — mock değil, çünkü kanıtlanan
  şeyler RLS izolasyonu, Redis atomikliği ve TTL. Negatif-önce: (i) yetkisiz→boş küme + yazım yok,
  (ii) cross-tenant: license B, license A'nın chat'ini RLS altında göremez → boş, (iii) `Promise.all`
  iki eşzamanlı register → çakışma en az bir gözlemde yüzeye çıkar + kayıp güncelleme yok, (iv) tek-ajan
  idempotent, (v) TTL self-drop + `is_typing=false` ZREM.
- **Varsayımlar:** `since` alanı = ajanın **en son** composing sinyali zamanı (ms), ilk başlangıç değil —
  tek skorlu sorted-set'te güvenilir liveness prune'u (düşen socket'i pencere içinde eleme) ancak son-sinyal
  skoruyla mümkün; başlangıç-zamanı skoru aktif composer'ı 8sn sonra yanlışlıkla prune ederdi. KK
  `since`'i kesin tanımlamıyor (kk_yetersiz=true, PLAN §5.2). Servis-içi tip camelCase `{agentId, since}`;
  wire snake_case `AgentConflictWarningPush {agent_id, since}` dönüşümü -c'nin işi.
- **Sonraki pencereye not:** 08.6.3-conflict-c (`send_typing_indicator` yolunda tespit + bus envelope
  yayını) bu servise bağımlı. Dispatcher `record()` çağırıp `conflict` true ise `agent_conflict_warning`
  envelope'unu her iki ajana yayınlar; `record()`'ın boş-küme (erişim yok) dönüşünü typing'in
  `not_found` deseni gibi ele almalı. `test:e2e` bu turda koşulmadı — task src-only birim çekirdek,
  E2E iki-ajan senaryosu ayrı kalem (-g).

### tm 91.1 — 08.6.3-conflict-a Çakışma uyarısı RTM push action'ı + composer-registry anahtar/TTL tip sözleşmesi — done — 2026-08-02 UTC

- **Yapıldı:** Kontrat-önce, davranışsız iskelet (mantık YOK — tespit/dispatcher/API/UI hepsi -b..-g'nin işi).
  (1) `packages/types/src/rtm.ts`: `RTM_PUSH_ACTIONS`'a `agent_conflict_warning` eklendi +
  `AgentConflictWarningPush` arayüzü (`chat_id`, `thread_id`, `agents: [{agent_id, since}]`,
  `detected_at`) `IncomingEventPush` deseninde yazıldı. (2) `packages/types/src/realtime-bus.ts`:
  `composerStateKey(licenseId, chatId)` + `AGENT_COMPOSING_TTL_SECONDS = 8` eklendi —
  `typingStateKey`/`AGENT_TYPING_TTL_SECONDS` bloğunun (satır 22-35) birebir deseni, license-scoped
  anahtar (aynı chat id iki lisansta çakışmaz). (3) `index.ts` zaten `export *` kullanıyor — ayrı
  export listesi yok, otomatik dahil. (4) `pnpm --filter @nexa/types build` ile dist yenilendi.
- **Test:** yeni `packages/types/src/realtime-bus.test.ts` (4): composer anahtarı license-izolasyonu
  (`composerStateKey('1','ABC') !== composerStateKey('2','ABC')`) + kararlılık + TTL pozitifliği +
  `RTM_PUSH_ACTIONS.includes('agent_conflict_warning')`.
- **Doğrulama:** `pnpm -w typecheck` ✅ (api/rtm/web/widget üç tüketici yeni tiplerle derlendi) ·
  `pnpm -w lint` ✅ · `pnpm -w build` ✅ · unit: tüm paketler ayrı ayrı yeşil (types 60, api 1103,
  rtm 71, web 458, widget 52, ai-mock 56) · `pnpm -w test:integration` (concurrency=1) ✅ — api 845 +
  rtm 42. **Not:** `pnpm -w test` (paralel) rtm'de 6 sahte-kırmızı verdi — paylaşılan Postgres yarışı
  ([[nexa-test-gate-parallel-db]]), bu tur kaynaklı değil; rtm serial koşulduğunda 71/71 yeşil.
  OpenAPI/REST değişmedi → `contract-parity.test.ts` etkilenmedi (kapsam dışı, task'ın kendisi
  belirtiyor).
- **PLAN.md:** `08.6.3-conflict` satırı (§5.0, satır 1115) `⬜`→`◐` — yalnız -a teslim, -b..-g (tespit
  çekirdeği, dispatcher yayını, API atama yüzeyi, istemci banner, realtime kablolama, e2e) kalan.
  Faz-2 özet sayacı (satır 22/1100) **dokunulmadı** — ◐ satırlar bu sayaçta "açık" (⬜) kovasında
  sayılıyor (tm 80.1-80.8 önceki, §D68/§D69'da teşhis edilen aynı davranış), sayısal değişiklik yok.
- **Varsayımlar:** yok — task kapsamı mekanik ve tek yorumlu (SONNET-XHIGH gerekçesi kendi
  açıklamasında verilmiş).
- **Sonraki pencereye not:** 08.6.3-conflict-b (ConflictDetectionService, OPUS-MAX, bölünmez çekirdek)
  bu tip sözleşmesine bağımlı — atomik Redis kaydı + tenant-scoped yetki + TTL akıl yürütmesi tek
  pencerede birlikte ele alınmalı (PLAN §5.2'deki "Bölünmeyen çekirdek" notu).

### PANEL — Faz-2 üst-tablo sayaç çelişkisi (§D68 yanlış-pozitifi yeniden bildirildi) — no-change — 2026-08-02 UTC

- **Yapıldı:** Panel §1.2 çelişkisi bildirdi (özet satır 22 `5 ✅ / 22 ⬜` ⟷ sayım `6 ✅ / 21 ⬜`).
  Tek Faz-2 gereksinim tablosu §5.0 (satır 1108–1137, 30 satır) **öncü** durum damgası awk ile tek tek
  sayıldı → **22 ⬜ · 5 ✅ · 3 ⛔**, üst-tabloyla **birebir uyuşuyor → özet DOĞRU, bayat değil**. Panelin
  `6 ✅ / 21 ⬜`'i naif ham-glif sayımı: `06.3.2-bulk` satırı (1108) v1 kardeşine atıfla gömülü `` `✅` ``
  taşır → öncü `⬜` satırı `✅` sanılıp `−1 ⬜ / +1 ✅` kaydırır (§D68'de zaten teşhisli, re-doğrulandı).
- **Doğrulama:** öncü-damga sayımı (awk, satır 6-col) = özet; §5.0 dışında öncü damga taşıyan Faz-2
  tablosu yok (grep 0); D68'den beri hiçbir damga değişmedi (satır 1120 hâlâ ✅, commit'li).
- **Değişen:** yalnız `PLAN.md §D69` (disposition) + bu HANDOFF notu. Özet sayacına ve gereksinim
  damgalarına DOKUNULMADI — düzeltilecek bir şey yoktu. Kod/şema değişmedi → DoD kapısı (typecheck/…)
  koşulmadı (yalnız doküman). Commit: `docs(plan)`.
- **Sonraki pencereye not:** Bu kalıcı yanlış-pozitiftir — satır 1108'in gömülü `✅` glifi durdukça naif
  glif-sayaç her taramada `6/21` bildirir; doğru yöntem **öncü-damga** sayımıdır (§D68/§D69). Yeniden
  bildirilirse doğrudan kapatılabilir, PLAN değişmez.

### tm 80.9 — 08.9.6-i Uçtan uca doğrulama (E2E + audit görünürlüğü + proxy-IP + istek başına maliyet) — done — 2026-08-02 UTC

- **Yapıldı:** IP allowlist / oturum güvenliği dilimini (08.9.6 a→h) uçtan uca **doğruladı** — yeni
  güvenlik mantığı YAZILMADI (task KAPSAM DIŞI), yalnız -e'nin kararları teste sabitlendi:
  (1) **E2E** `settings.spec.ts` (+1): allowlist ekle → listede görünür → reload'da kalıcı → sil → boş
      durum. Enforce **KAPALI** (tarayıcı oturumu kendini kilitlemesin); eklenen giriş loopback
      `127.0.0.0/8` — self-lockout guard'ı geçer çünkü tarayıcı→API çağrısı IPv4 loopback'e düşer.
      Kanıt: `apps/e2e/kanit/80.9-ip-allowlist.png`.
  (2) **Integration** `ip-allowlist.test.ts` (17→19, +2): (a) **audit okuma yolu** — enforce açık +
      eşleşmeyen IP → 403 + `auth.ip_denied` girdisi **app-role/RLS altında** ait olduğu tenant'a
      görünür, karşı tenant'a görünmez; ne `ip` kolonu ne metadata ham adres taşır (NFR-C1/C2).
      `GET /audit-log` endpoint'i YOK — trail app-role+RLS ile okunur, test o okuma yüzeyinin ta
      kendisi. (b) **en-sağ XFF hop kabul** testi — spoof testinin aynası; ikisi birlikte `request.ip`'yi
      `trustProxy:1` altında tam olarak en-sağ (tek güvenilen) hop'a sabitler.
  (3) **auth.ts** — enforcement okumasının istek-başı maliyet yorumu (license-gate per-mutation
      gerekçesi HER kimlikli isteğe otomatik devredilemez → ölçüldü).
- **Doğrulama (DoD kapısı, hepsi exit 0):** `pnpm -w typecheck` (11/11) · `pnpm -w lint` (8/8) ·
  `pnpm -w build` (7/7) · `pnpm -w test:unit` (web 458 + api/contract) · `pnpm -w test:integration`
  **41 dosya / 845 test** (tenant-isolation 19 + route-config + contract-parity dâhil, regresyon yeşil) ·
  E2E `settings.spec.ts` **13/13** (yeni IP allowlist testi dâhil).
- **Maliyet ölçümü (KK kanıtı — bağımsız yeniden ölçüldü, local PG, app-role/RLS, warmup + 500× ×2):**
  enforce-**OFF** (yalnız settings okuması) mean **1.15ms** / p95 **1.60ms** · enforce-**ON**
  (settings + entries) mean **1.30ms** / p95 **1.65ms**. Fark ~0.15ms — `BEGIN/set_config/COMMIT`
  baskın, okumaların kendisi gürültü. Her ikisi de NFR-U/NFR-P bütçesi içinde. **Cache REDDEDİLDİ:**
  staleness penceresi = kaldırılan bir IP'yi TTL boyunca kabul eder = kısıtın kapatmak için var olduğu
  tam pencere; maliyet zaten bütçe içi olduğundan takas edecek bir şey yok. Gerekçe kodda yorumla
  (`apps/api/src/plugins/auth.ts`) sabit. Bu ölçüm auth.ts yorumundaki (önceki pencerenin kaydettiği)
  rakamları doğruladı.
- **Varsayımlar:** `trustProxy: 1` (server.ts, -e) tek güvenilen hop demektir → `request.ip` en-sağ XFF
  girdisi; testler bunu iki yönlü sabitliyor. E2E enforce KAPALI — açık enforce'un uçtan uca 403'ü
  integration'da kanıtlı (tarayıcıdan enforce açmak oturumu kilitleme riski, KK bunu KAPALI istiyor).
- **Sonraki pencereye not:** **08.9.6 (a→i) TAM.** PLAN §5.0 satır 1120 zaten `✅` + -i kanıtı taşıyor
  (doküman düzeltme penceresi `d77edbd` çevirmişti; bu kapanış PLAN'a DOKUNMADI, yalnız kod+HANDOFF
  commit'ledi). E2E süiti çalıştırıldığında `kanit/*.png` (7 alâkasız ekran görüntüsü) yeniden üretildi →
  **kapsam dışı, `git restore` ile geri alındı**; yalnız yeni `80.9-ip-allowlist.png` eklendi. **Açık
  sorular (bu task'ın DIŞINDA):** plan/paket kapısı kararı · RTM WebSocket enforcement — ikisi de
  ayrı kalem, burada karara bağlanmadı.

### DÜZELTME — Faz-2 özet sayacı bayat (08.9.6 `◐→✅`, sayaç güncellenmedi) — done — 2026-08-01 UTC

- **Bulgu (panel §1.2):** Üst-tablo (`PLAN.md:22`) + §5.0 girişi (`PLAN.md:1100`) dağılımı `4 ✅ · 23 ⬜ · 3 ⛔`
  yazıyordu; §5.0 gereksinim envanterinin (satır 1108–1137, **30 satır**) her satırının **öncü durum damgası
  tek tek sayıldığında** `5 ✅ · 22 ⬜ · 3 ⛔` (toplam 30 sabit).
- **Kök neden:** `08.9.6` satırı (`PLAN.md:1120`) tm 80.9 penceresinde `◐→✅` çevrildi (08.9.6-i teslim, a→i
  tamam) ama iki dağılım sayacı güncellenmedi — deponun bilinen "kod/TM'de bitti, PLAN üst-özeti bayat"
  deseni (§D55/§D56). Panelin `6 ✅ / 21 ⬜` iddiası **naif ham-glif** sayımıydı: `06.3.2-bulk` satırının notu
  v1 kardeşine atıfla gömülü `` `✅` ``/`` `⬜` `` taşır → öncü damga 1 fazla sayılır. Doğru = öncü-damga sayımı.
  Tam teşhis PLAN §D68.
- **Yapıldı (YALNIZ dağılım sayacı):** `PLAN.md:22` + `PLAN.md:1100` → `22 ⬜ · 5 ✅ · 3 ⛔`; PLAN §D68 notu.
  **DOKUNULMADI:** gereksinim satır damgaları (kanıta dayalı); `23 açık kalem` kapanış-paydası (satır 22-col5 ·
  2318) + §5.2 `23 kalem` kırılım kapsamı (yapısal/backlog paydası — 08.9.6 teslimi payda içi ilerlemedir);
  §D62 tarihsel `23/4/3` kaydı (append-only).
- **Commit kapsamı:** yalnız `PLAN.md` + `HANDOFF.md`. PLAN.md commit'i satır 1120'nin `◐→✅` çevrimini de
  içerir (tm 80.9 çalışma alanına bırakmıştı) — çünkü `5 ✅` özeti ancak o satır `✅` iken tutarlıdır, ikisi
  aynı commit'te olmalı.
- **⚠️ Çalışma alanı uyarısı:** Bu pencere açıldığında tree zaten **tm 80.9 (08.9.6-i) in-progress** koduyla
  kirliydi: `apps/api/src/plugins/auth.ts` · `apps/api/test/integration/ip-allowlist.test.ts` ·
  `apps/e2e/tests/settings.spec.ts` · `apps/e2e/kanit/80.9-ip-allowlist.png` · `.taskmaster/tasks/tasks.json`
  (80.9 `pending→in-progress`). Bunlar tm 80.9'un **kendi DoD kapısına** (typecheck/lint/test/integration/build/
  e2e) tabidir ve o pencerenin kapanışıdır — **kapsam dışı, commit EDİLMEDİ.** Bu düzeltme doküman-yalnızdır.

### tm 80.8 — 08.9.6-h Settings ekranı — IP allowlist bölümü + oturum politikası formu — done — 2026-08-01 UTC

- **Yapıldı:** Yeni dosya `apps/web/src/features/settings/IpAllowlist.tsx`, iki alt-bileşen: (1)
  `IpAllowlistEntries` — TrustedDomains deseninin birebir kopyası: GET/POST/DELETE
  `/settings/ip-allowlist` (queryKey `['settings','ip-allowlist']`), ekleme formu (`entry` + opsiyonel
  `label`), kayıt yokken anlamlı `EmptyState`, ekleme 400'ü (self-lockout reddi dahil) `role="alert"`
  ile alan-altı gösterilir. (2) `SessionPolicy` — BannedCustomerIps/FileSharing deseni: aynı
  `['settings','security']` cache'ini okuyan ikinci bir `useQuery` + `PATCH /settings/security` ile
  `ip_allowlist_enforced` (anında toggle, FileSharing deseni) + `session_idle_timeout_seconds` (dakika
  girilir, saniyeye çevrilip gönderilir) + `max_concurrent_sessions` formu (Save ile); `canEdit=false`
  iken form hiç render edilmez — bunun yerine salt-okunur bir özet (`StatusDot` + iki metin satırı)
  gösterilir (RoutingRules'ın "durum her zaman görünür, kontrol canEdit'e bağlı" deseninden ödünç
  alındı, çünkü test stratejisi "form render edilmez" diyor, "disabled" değil). `SettingsPage.tsx`:
  render listesine `<IpAllowlist canEdit={canManageAccess} />` (BannedCustomerIps ile FileSharing
  arasına) + oradaki private `SecuritySettings` arayüzüne 3 yeni alan eklendi (dokümantasyon amaçlı;
  IpAllowlist.tsx kendi ayrı `SecuritySettings` arayüzünü taşıyor, WidgetCustomization.tsx'in kendi
  `WidgetSettings` tipini taşıması gibi). Kontrat değişikliği yok — task'ın kapsamı UI'ydı, backend
  -d/-f'de zaten tamamlanmıştı.
- **Doğrulama:** `pnpm --filter @nexa/web typecheck` ✅ · `lint` ✅ · `apps/web` vitest tam paket
  (67 dosya / 458 test) ✅ · `pnpm -w typecheck` ✅ · `pnpm -w lint` ✅ · `pnpm -w test` ✅ (10/10 paket)
  · `pnpm -w build` ✅. Yeni `IpAllowlist.test.tsx` (9): liste render + empty state (boş dikdörtgen
  değil) + ekleme POST gövdesi + silme DELETE id + self-lockout 400'ün alert'i + policy PATCH gövdesi
  (dakika→saniye dönüşümü dahil) + enforce toggle PATCH'i + policy-hata alert + `canEdit=false`'ta
  hiçbir form/checkbox/buton yok (salt-okunur özet metni var). E2E bilinçli KAPSAM DIŞI (task'ın kendi
  tanımı: "E2E akışı (08.9.6-i)") — `apps/e2e/tests/settings.spec.ts`'teki mevcut "File sharing"
  senaryosu `getByRole('region', {name:...})` ile scope'lu olduğu için yeni section'ların araya
  girmesinden etkilenmez (satır bazlı kontrol edildi, çalıştırılmadı — full stack gerektiriyor).
- **Varsayımlar:** Yok — task'ın referans desenleri (BannedCustomerIps satır 464-570, TrustedDomains
  329-460, WidgetCustomization.tsx) birebir uygulandı.
- **Sonraki pencereye not:** Kalan `08.9.6`: yalnız `-i` (tm 80.9) — uçtan uca doğrulama (E2E akışı,
  audit görünürlüğü, proxy-IP davranışı, istek başına maliyet). `-i` bu ekranı da kapsamalı: allowlist
  ekle/sil + enforce aç/kapa + idle/limit kaydet akışının gerçek tarayıcıda çalıştığını kanıtla.

### tm 80.7 — 08.9.6-g Oturum politikası enforcement (idle timeout + eşzamanlı oturum limiti) — done — 2026-08-01 UTC

- **Yapıldı:** Enforcement, `apps/api/src/services/auth/token-service.ts` içinde (migration YOK, yeni hata tipi YOK).
  (1) **Idle timeout** — `resolve()` yalnız **oauth** için lisansın `session_idle_timeout_seconds`'unu okur; `now -
  (lastUsedAt ?? createdAt) > timeout` ise token'ı membership okumasıyla **aynı transaction'da kalıcı revoke** eder
  ve `idle_expired` reason'ı döndürür (mevcut log yolundan akar; istemci tek tip 401 alır — "expired≠unknown"
  gerekçesi korunur). PAT/bot muaf. `auth_resolve_token` SQL fonksiyonu `last_used_at`/`created_at` döndürmediği ve
  migration yasak olduğu için değerler `#idleExpired` içinde tenant-scoped okunur. `touch()` fire-and-forget yarışı
  fail-closed: okunan değer daima önceki isteğin aktivitesi, karşılaştırma `lastActive`'de monoton (staler okuma
  yalnız daha erken expire ettirir, asla yanlış kabul etmez) — yorumla gerekçelendirildi. (2) **Eşzamanlı oturum
  limiti** — `#pruneOldest` cap'i lisansın `max_concurrent_sessions` (null → `MAX_ACTIVE_TOKENS_PER_OWNER` 25)
  değerinden **kilitli transaction içinde** okur; PAT muaf. Paralel `issue()` invariant'ı
  `pg_advisory_xact_lock(hashtext('nexa.session-cap'), hashtext('<license>:<owner>'))` ile korunur (`withTenant`
  READ COMMITTED — lock olmadan iki paralel basım under-prune eder). `auth.ts` **değişmedi**.
- **Doğrulama:** `pnpm -w typecheck` ✅ · `pnpm -w lint` ✅ · `pnpm -w test` ✅ (api 1101/1101, +12; unit+integration
  aynı vitest run — `session-policies.test.ts` dahil; diğer paketler cache-hit yeşil) · `pnpm -w build` ✅.
  **Invariant testinin dişi kanıtlandı:** advisory lock geçici kapatılınca `holds the cap … under parallel mints`
  8 paralel basımda 6 canlı ile **kırıldı**; lock geri konunca iki ardışık koşuda tam cap (deterministik).
- **Varsayımlar:** Idle timeout "session" politikası olarak **oauth-only** yorumlandı (testStrategy "PAT idle ve limit
  politikalarından etkilenmez" + PAT/bot uzun ömürlü kimlik gerekçesi). E2E bilinçli kapsam dışı — bu dilim salt
  backend enforcement; uçtan uca akış 08.9.6-i'nin (tm 80.9) işi (task KAPSAM DIŞI + §5.2 -i satırı).
- **Sonraki pencereye not:** Kalan `08.9.6`: `-h` (tm 80.8) Settings UI — IP allowlist bölümü + oturum politikası
  formu; `-i` (tm 80.9) uçtan uca doğrulama (E2E, audit görünürlüğü, proxy-IP, istek başına maliyet). `-g`'nin
  eklediği per-request maliyet: oauth resolve() artık bir `securitySettings` taze okuması yapıyor (idle null olsa
  bile) — `-i`'nin maliyet notunda ölçülmeli. Yeni idiom: advisory lock (repoda ilk kez) — başka concurrent-cap
  ihtiyacı çıkarsa aynı desen.

### tm 80.6 — 08.9.6-f PATCH /settings/security — oturum politikası alanlarının yazma yüzeyi (validasyon + audit) — done — 2026-08-01 UTC

- **Yapıldı:** `updateSecurityBody` zod şemasına üç katkısal alan — `ip_allowlist_enforced: z.boolean().optional()`,
  `session_idle_timeout_seconds`/`max_concurrent_sessions`: `z.number().int().positive().max(<üst sınır>).nullable().optional()`
  (chat-timeout deseninin birebir kopyası — `.positive()` sıfır/negatifi reddeder, `null` = kapalı). Üst sınırlar:
  idle timeout `CHAT_TIMEOUT_MAX_SECONDS` (30 gün) ile aynı sabit; concurrent sessions `MAX_ACTIVE_TOKENS_PER_OWNER`
  (25) — ikisi de token-service.ts'ten import edilerek tek kaynaktan alındı, ayrı sabit tanımlanmadı. PATCH data
  bloğuna üç katkısal spread satırı. `packages/contract/openapi/paths/settings.yaml` + re-bundle. Mevcut
  `settings.security_updated` audit yazımı (yalnız değişen alan adları) davranışsız kaldı — yeni testle doğrulandı.
  `apps/api/test/integration/settings.test.ts`'ye 4 test: round-trip + null-ile-kapatma, 8 değerli negatif tablo
  (0/negatif/float/üst-sınır-üstü × iki alan), audit metadata'da yalnız değişen alan adları, cross-tenant izolasyon.
- **Doğrulama:** `pnpm -w typecheck` ✅ · `pnpm -w lint` ✅ · `pnpm -w test` ✅ (1089/1089, unit+integration
  birlikte — `test/integration/*` aynı `vitest run` içinde, `contract-parity.test.ts` dahil) · `pnpm -w build` ✅ ·
  `apps/e2e` `settings.spec.ts` (12/12, dokunulan `/settings/security` PATCH yolunun regresyon kontrolü) ✅.
- **Varsayımlar:** Bu pencere açıldığında task zaten `in-progress` ve kod/test/kontrat WIP olarak çalışma alanında
  hazırdı (önceki pencere yarım bırakmış, işaretlemeyi atlamış olabilir) — sıfırdan yazılmadı, mevcut hal
  denetlendi, DoD kapısından geçirildi ve kapatıldı.
- **Sonraki pencereye not:** Kalan (◐) `08.9.6`: `-g` oturum politikası enforcement (idle timeout sweep +
  eşzamanlı oturum limiti — bu task'ın kapsam dışı bıraktığı asıl iş), `-h` Settings UI, `-i` uçtan uca doğrulama.
  `-g` `[OPUS-MAX]` — token-service.ts'teki `touch()` fire-and-forget yazımı ile `resolve()` okuması arasındaki
  yarış + toplu revoke invariant'ı birlikte ele alınmalı (PLAN §5.2.10 bölünmeyen-çekirdek notu).

### tm 80.5 — 08.9.6-e IP allowlist enforcement — auth onRequest kapısı + trustProxy taklit yüzeyi + not_allowed/audit — done — 2026-08-01 UTC

- **Yapıldı:** Allowlist'i **ısıran** enforcement noktası — `apps/api/src/plugins/auth.ts` `onRequest`
  zincirinde, principal-kind (404) kontrolünden **sonra**, region/scope/role'dan **önce**:
  - `principal.kind !== 'customer' && !config.public` iken lisansın `ip_allowlist_enforced` bayrağı +
    `ip_allowlist_entries` **her istekte taze** (cache YOK — license-gate.ts ile aynı gerekçe: cache'lenirse
    workspace'in az önce çıkardığı adres TTL boyunca kabul edilmeye devam eder) tenant-scoped (RLS) okunur →
    `decideIpAccess({clientIp: request.ip, entries})` **deny** ise `new ApiError('not_allowed', …)` (403).
    **Yeni hata tipi EKLENMEDİ** — `not_allowed` zaten var (errors.ts, ERROR_STATUS 403); errors.ts×2 +
    scopes.test sayaç + OpenAPI enum + regen tuzağından bilinçli kaçınıldı.
  - **Muafiyetler:** müşteri/widget principal (o yüzeyin denetimi 08.9.2 `isIpBanned` ban-list'i) ·
    `public:true` uçlar (login/authorize/token/revoke) — öz-kilitleyen bir liste kaydedilse bile giriş →
    listeyi temizle → kurtar yolu açık kalır.
  - **trustProxy taklit yüzeyi (bu task'ın [OPUS-MAX] çekirdeği) kapatıldı:** `server.ts` `trustProxy: true`→`1`.
    `true` iken proxy-addr **tüm** zinciri güvenir ve **en-sol** (istemcinin yazdığı) XFF girdisini döndürür →
    saldırgan `X-Forwarded-For: <izinli-ip>` ile allowlist'i tek başlıkla geçebilirdi. Tek hop güvenince
    **en-sağ** (kendi proxy'mizin doğruladığı) girdi döner; istemci-önekli değer yok sayılır. Aynı türetme
    `request.ip`'yi kullanan rate-limit + banned-IP yüzeylerini de güçlendirir; tüm mevcut tek-XFF testleri
    değişmeden yeşil.
  - **Audit:** ret `writeAuditEntry(tx, auditContext({ip:null}), {action:'auth.ip_denied', target:'token:<id>',
    metadata:{principal_kind}})` — aynı tx'te (throw'dan önce commit). **Ham IP hiçbir yerde tutulmaz**
    (NFR-C1/C2): metadata yalnız principal kind, token id `target`'ta (`<kind>:<id>` deseni, sanitizer'a
    dokunmadan), ip kolonu `null`. `audit-log.ts` kapalı sözlüğe `+1 action`.
  - `schema.prisma`: `ipAllowlistEnforced` doc yorumu güncellendi ("nothing enforces this yet" ve yanlış
    `bannedCustomerIps` referansı kaldırıldı) — **migration YOK** (yalnız yorum, DB/generate değişmez).
- **Doğrulama:** `pnpm -w typecheck` ✓ · `pnpm -w lint` ✓ · `pnpm -w build` ✓ · api `test:integration` **827/827** ✓
  (regresyon yok — rate-limit, customer-chat banned-IP, auth, contract-parity dahil). Yeni testler:
  `ip-allowlist.test.ts` +11 (enforcement describe: 403 not_allowed envelope, XFF-spoof atlatamaz, no-XFF deny,
  matching→200, audit auth.ip_denied + ham IP yok, enforcement-off no-op, empty-list no-op, cross-tenant,
  customer-muaf, public-muaf) · `route-config.test.ts` +1 (public kurtarma uçları 401 dönmez).
- **Varsayımlar:** Deployment tek güvenilen reverse-proxy ardında ve **doğrudan** açık değil (Assumption →
  `trustProxy: 1`). Topoloji değişirse count yerine proxy adresi/subnet'i yazılmalı (yorumda not düşüldü).
  Enforcement her korumalı non-customer istekte bir singleton `security_settings` PK okuması ekler (bayrak
  kapalıysa orada durur); spec "her istekte taze" istediği için cache yok — istek-başı maliyet ölçümü 08.9.6-i'nin işi.
- **Sonraki pencereye not:** Kalan 08.9.6 alt-görevleri: `-f` PATCH /settings/security yazma yüzeyi ·
  `-g` oturum politikası enforcement (idle timeout + eşzamanlı oturum) · `-h` Settings UI · `-i` uçtan uca
  doğrulama (E2E + proxy-IP davranışı + istek-başı maliyet). RTM (WebSocket) el sıkışması allowlist'e **dahil
  değil** (ayrı yüzey, açık soru) — auth onRequest yalnız HTTP'yi kapsar.

### tm 80.4 — 08.9.6-d /settings/ip-allowlist CRUD + self-lockout guard + audit + path kontratı — done — 2026-08-01 UTC

- **Yapıldı:** Erişim kontrol listesinin **yazma yüzeyi** — üç yeni yetkili route `apps/api/src/routes/settings.ts`
  (trusted-domains desenini birebir izler):
  - `GET /settings/ip-allowlist` (`access_rules:ro|rw`) — tenant-scoped, entry **alfabetik**,
    `{items:[{id,entry,label,created_at}]}`.
  - `POST /settings/ip-allowlist` (`access_rules:rw`) — gövde `parseAllowlistEntry` ile doğrulanır (geçersiz→**400**),
    **canonical** `formatAllowlistEntry` ile saklanır (host bitleri maskeli + v6 RFC 5952 sıkıştırma → `10.0.0.5/24`
    ≡ `10.0.0.0/24` **tek satır**), `@@unique(license,entry)` çakışması→**403** (`not_allowed`, trusted-domains
    kardeşiyle aynı). **Self-lockout guard:** aynı tx'te (mevcut entry'ler + yeni canonical) listesi
    `wouldLockOut(request.ip, nextEntries)`'e verilir; çağıranı dışarıda bırakan liste→**400** (create'ten ÖNCE).
  - `DELETE /settings/ip-allowlist/:entryId` (`access_rules:rw`) — tenant-scoped `deleteMany`, cross-tenant/yok→**404**
    (NFR-S5 enumeration; 403 değil), audit için önce entry okunur.
  - Her yazımda **aynı tx'te** `writeAuditEntry` — iki yeni action `settings.ip_allowlist_added`/`_removed`
    (`audit-log.ts` kapalı sözlük, +2). metadata = `{entry}` (kural, PII değil); **ham çağıran IP metadata'ya YAZILMAZ**
    (standart `ip` sütununda zaten var).
  - Yeni **saf** `formatAllowlistEntry(entry)` (`lib/ip-allowlist.ts`) — parse'ın tersi; canonical string üretir
    (v4 dotted, v6 RFC 5952 compression [en uzun sıfır-koşu → `::`, leftmost], tam-uzunluk prefix düşürülür). 80.3'ün
    frozen matcher'ına eklendi: "canonical saklama" bu string'i gerektiriyor, parse+format çiftinin bir arada testi
    doğru yer (round-trip invariant testiyle sabit).
  - Sözleşme: `settings.yaml`'a `ipAllowlist` (get/post) + `ipAllowlistEntry` (delete) blokları · `openapi.yaml`
    paths (+2) · `IpAllowlistEntry` şema açıklamasındaki "yalnız şema, path yok" notu güncellendi (path artık var) ·
    re-bundle (`api.ts`/`openapi.json`, 111→113 path).
- **Doğrulama (tam DoD kapısı, exit 0):** `pnpm -w typecheck` (11/11) · `lint` (8/8) · `build` (7/7) ·
  **unit** api 252→**258** (`lib/ip-allowlist.test.ts` 23→**29**, +6 formatAllowlistEntry: v4 mask/bare/v6-compress/
  all-zero/mapped/round-trip) + workspace tümü · **integration** 39→**40** dosya / 809→**816** test
  (`ip-allowlist.test.ts` **7**: negatif-önce [malformed→400 · self-lockout→400 · scope→403 · duplicate-farklı-yazım→403]
  + cross-tenant [GET gizler · DELETE 404 · satır sağ kalır] + canonical saklama + audit added/removed) ·
  **contract-parity 5/5** (iki yön) · tenant-isolation 19 · **e2e 59/59** (`.env` source'lu, nexa-db:5433/nexa-redis:6380).
  Integration serial `--concurrency=1` (paylaşılan-PG yarışı).
- **Varsayımlar/kararlar:** (1) Duplicate → **403 `not_allowed`** (trusted-domains kardeşinin aynısı; genel `conflict`
  tipi yok, yeni error tipi = kapsam dışı yüzey). Contract'ta **409 UYDURULMADI** (kardeş dokümanı 409 diyor ama kod
  403 döner = yanıltıcı; 403 Forbidden ref + açıklama honest ve yeterli). (2) **Self-lockout guard yalnız POST'ta** —
  KK "kaydedilemez"/ilk-kayıt POST'a işaret eder, test stratejisi de POST'u test eder; enforcement (08.9.6-e) henüz
  canlı değil, DELETE-lockout şu an gerçek risk değil. (3) `formatAllowlistEntry` frozen 80.3 modülüne eklendi
  (canonical saklama zorunluluğu).
- **Sonraki pencereye not:** -e (enforcement) bu route'un yazdığı entry'leri `decideIpAccess` ile tüketecek.
  **DİKKAT -e:** `server.ts` `trustProxy:true` → `request.ip` X-Forwarded-For ile taklit edilebilir; self-lockout
  guard'ı bu etkilemez (taklit ancak kişiyi kendini kilitler, escalation değil) **ama enforcement kapısı bu yüzeyi
  ayrıca ele almalı** (§5.1.2). -h (Settings UI) bu route'u bağlayacak. **DELETE self-lockout guard YOK** (yukarıda
  gerekçe) — -e/-i onaylarken göz önünde tut. Kapsam dışı: enforcement, PATCH oturum politikası (-f), UI (-h).
  Çalışma alanı: e2e'nin yeniden ürettiği `apps/e2e/kanit/*.png` (26) UI değişmediği için `git restore` ile geri
  alındı (80.1/80.2/80.3 deseni). Açılışta kirli harness dosyası bu turda yoktu; çalışma alanı temiz.

### tm 80.3 — 08.9.6-c lib/ip-allowlist.ts — CIDR/IP eşleştirme + izin-ret semantiği (saf, DB'siz) — done — 2026-08-01 UTC

- **Yapıldı:** Yeni **saf** modül `apps/api/src/lib/ip-allowlist.ts` (DB/route/hook YOK) —
  `banned-ip.ts`'in (deny-list, müşteri yüzeyi) allow-list karşılığı; agent yüzeyi için CIDR
  üyeliği. Dört dışa-açık fonksiyon: (1) `parseAllowlistEntry(value)` → tekil IP veya adres/prefix
  CIDR'ı canonical `{version, bytes, prefixLength}`'e çevirir; **host bitleri maskeli** (ağ adresi),
  geçersiz (prefix >32/v4 · >128/v6 · negatif · çift-slash · bozuk adres · boş) → `null`
  (fail-closed). (2) `ipMatchesEntry(ip, entry)` → bit-maskeli prefix üyeliği; IPv4-mapped
  `::ffff:a.b.c.d` mevcut `normaliseIp` ile düzleştirilir; v4↔v6 **asla** eşleşmez; parse edilemeyen
  adres hiçbir şeye uymaz. (3) `decideIpAccess({clientIp, entries})` → `'allow'|'deny'`: boş liste =
  allow (yapılandırılmamış ≠ kimseye-izin-yok, self-lockout önlemi), dolu+eşleşmez = deny, clientIp
  yok = deny, dolu-ama-hepsi-bozuk = deny (**ham string[] alır**, önceden parse edilmiş liste "boş"a
  çökemez). (4) `wouldLockOut(callerIp, nextEntries)` = decideIpAccess deny (-d yazma tarafının
  öz-kilitleme kontrolü). Test `apps/api/src/lib/ip-allowlist.test.ts` (23 unit, negatif-önce).
- **Doğrulama (hepsi yeşil, exit 0):** `pnpm -w typecheck` (11/11) · `pnpm -w lint` (8/8) ·
  `pnpm -w build` (7/7) · `pnpm --filter @nexa/api test:unit` (19 dosya/**252** test; yeni dosya 23) ·
  `pnpm --filter @nexa/api test:integration` (39 dosya/**809** test) · `pnpm -w test:e2e`
  (**59** passed, `.env` source edilerek) · ayrıca elle 16 **saldırgan sınır** kontrolü (kısmi-bayt
  /12 · /20, v6 /64, mapped-in-CIDR, gömülü-v4 v6, karışık-aile liste, aralık-dışı oktet→null,
  /0 broadcast) dist'e karşı geçti. Modülün **hiçbir importer'ı yok** (grep 0) → integration/e2e
  mantıken etkilenemez; yine de tam kapı koşuldu.
- **Varsayımlar:** (1) `decideIpAccess` ham `string[]` alır (parse'ı içeride yapar) — hepsi-bozuk dolu
  liste "boş"a çöküp herkesi içeri almasın (fail-closed). (2) `bytes` canonical ağ adresidir (host
  bitleri sıfırlı) → `10.0.0.5/24` ≡ `10.0.0.0/24`. (3) `/0` bilinçle "tüm aile": aynı-aile her adres
  eşleşir, diğer aile eşleşmez (regresyon testiyle sabit). (4) IPv4-mapped düzleştirme `normaliseIp`
  ile — banned-ip ile aynı adres kavramı.
- **Sonraki pencereye not:** -d (`/settings/ip-allowlist` CRUD + path kontratı + self-lockout guard
  `wouldLockOut` ile + audit action'ları `settings.ip_allowlist_added/removed`) ve -e (auth onRequest
  enforcement `decideIpAccess` ile) bu modülü tüketecek. Import: `import { decideIpAccess, wouldLockOut,
  parseAllowlistEntry } from '../lib/ip-allowlist.js'`. **DİKKAT -e:** `server.ts` `trustProxy: true` →
  `request.ip` X-Forwarded-For ile taklit edilebilir; enforcement o yüzeyi ayrıca ele almalı (§5.1.2
  bölünmez çekirdek gerekçesi). Not: e2e `kanit/*.png` yeniden-render churn'u bu commit'e DAHİL
  EDİLMEDİ (80.1/80.2 deseni — her task e2e ekran görüntülerini commit'lemez); `git restore` ile geri
  alındı, çalışma alanı temiz.

### tm 80.2 — 08.9.6-b ip_allowlist_entries tablosu + RLS politikası + IpAllowlistEntry şeması — done — 2026-08-01 UTC

- **Yapıldı:** Yeni normalize tablo `ip_allowlist_entries` (id uuid PK, organization_id uuid,
  license_id bigint FK→licenses CASCADE, entry text, label text NULL, created_at timestamptz) +
  `UNIQUE(license_id, entry)` + `INDEX(license_id)` — migration `20260801100000_ip_allowlist_entries`.
  Migration RLS'i elle ekliyor: `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY ip_allowlist_entries_tenant`
  (`USING`/`WITH CHECK` = `license_id = nexa_current_license()`) + `GRANT ... TO nexa_app` — custom_fields
  deseniyle birebir. `IpAllowlistEntry` Prisma modeli (+ `License.ipAllowlistEntries` back-relation) —
  `schema.prisma`. OpenAPI `components/schemas/IpAllowlistEntry` (yalnız şema, **path YOK**) + re-bundle
  (`packages/contract/src/generated/api.ts`, `dist/openapi.json`). Bu, banned_customer_ips'in (deny-list,
  müşteri yüzeyi) allow-list karşılığı — agent/admin panel için lisansın güvendiği kaynaklar.
- **Doğrulama (hepsi yeşil):** `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w build` ·
  `pnpm --filter @nexa/api test` (57 dosya/**1038** test; `tenant-isolation.test.ts` 15→**19**,
  `contract-parity.test.ts` 5) · diğer paketler `turbo run test` (rtm/web/widget/contract/types/ai-mock) ·
  `pnpm -w test:e2e` (**59** passed) · `pnpm db:check-drift` "no drift (1 known-unmodellable)" ·
  `prisma migrate deploy` temiz. E2E ilk denemede rtm dev sunucusu env eksikliğinden düştü → `.env`
  **source edilerek** yeniden koşuldu ve geçti (bilinen e2e kısıtı: sourced .env + freed ports).
- **Varsayımlar:** (1) `license_id FK→licenses` MIGRATION talimatı açık olduğundan FK eklendi ve
  drift-temiz kalmak için Prisma relation iki tarafa da yazıldı (custom_fields precedent'i; TrustedDomain
  FK'siz ama görev "FK→licenses" diyor). (2) `label` OpenAPI'de `required`+`nullable:true` — SecuritySettings
  oturum alanlarıyla tutarlı, stabil okuma kontratı.
- **Sonraki pencereye not:** Tablo/şema hazır; path bilinçli EKLENMEDİ (contract-parity iki yönlü kırar).
  `08.9.6-d` `/settings/ip-allowlist` CRUD + path kontratını (bu tablo üstüne), `08.9.6-c` CIDR/IP
  eşleştirme algoritmasını, `08.9.6-e` enforcement kapısını getirir. IpAllowlistEntry şeması onları bekliyor.

### tm 80.1 — 08.9.6-a security_settings oturum politikası kolonları + kontrat/okuma yüzeyi — done — 2026-08-01 UTC

- **Yapıldı:** `security_settings`'e 3 katkısal kolon (`ip_allowlist_enforced` BOOLEAN NOT NULL
  DEFAULT false, `session_idle_timeout_seconds` INTEGER NULL, `max_concurrent_sessions` INTEGER
  NULL) — `schema.prisma` + migration `20260727100000_session_policy_columns`. OpenAPI
  `SecuritySettings` şemasına aynı 3 alan (null semantiği açıklamalı) + re-bundle
  (`packages/contract/src/generated/api.ts`). `SECURITY_DEFAULTS` ve `serialiseSecurity`
  (`routes/settings.ts`) okuma tarafına eklendi — `GET /settings/security` artık 3 alanı da
  döner. Davranışsız iskelet: PATCH yazma yüzeyi ve her türlü enforcement bilinçli olarak
  KAPSAM DIŞI (08.9.6-f/-e/-g'nin işi).
- **Doğrulama:** `pnpm -w typecheck`/`lint`/`build` yeşil · `pnpm --filter @nexa/api test`
  (57 dosya/1034 test) ve `pnpm --filter @nexa/rtm test` (4 dosya/71 test) **paralel DB yarışını
  önlemek için ayrı ayrı** yeşil (bkz. bilinen `pnpm -w test` paralel-DB kısıtı) · `pnpm -w
  test:integration` (concurrency=1) yeşil — `settings.test.ts` (68, genişletilmiş "schema
  defaults" testi dahil) + `contract-parity.test.ts` (5) dahil · `pnpm db:check-drift` "no drift"
  (yalnız bilinen pgvector istisnası).
- **Varsayımlar:** Yok — alan seti/varsayılanlar task detayındaki NFR-S2 türetmesine birebir
  uyuyor (`MAX_ACTIVE_TOKENS_PER_OWNER=25` referansı `token-service.ts:19`'dan doğrulandı).
- **Sonraki pencereye not:** PLAN.md §5.2 `08.9.6` satırı `⬜→◐` (tam ✅ değil — yalnız -a
  teslim; -b..-i hâlâ açık, bkz. satırdaki kalan liste). `08.9.6-f` (PATCH yazma yüzeyi) ve
  `08.9.6-e`/`-g` (enforcement) bu task'a `depends on 08.9.6-a` ile bağlı — artık başlayabilirler.
  `prisma format` tüm dosyayı yeniden hizalıyor (kapsam dışı yan etki) — bir daha çalıştırılırsa
  yalnız dokunulan modelin diff'i commit'lenmeli, dosya geneli değil.

---

### PANEL-FIX · #97 `plan-tm-reverse` çelişkisi — yanlış pozitif, ayrım netleştirildi — done — 2026-08-01 UTC

- **Bulgu:** panel `ORTA` — _"#97 açık ama kapsadığı her PLAN satırı ✅"_ (kanıt: `PLAN.md:520`,
  `06.3.2` → `✅`). Risk olarak _"run-loop bitmiş işi yeniden yaptırabilir"_ gösterildi.
- **Doğrulama (KODA KARŞI, iki yön):**
  - `PLAN.md:520`'nin `✅`'i **gerçek** — `services/ai/web-crawler.ts` (94) · `lib/ssrf.ts` (171) ·
    `services/ai/knowledge-service.ts` (109) mevcut; `playbook.ts`'te `assertPublicHttpUrl`+`crawl`
    yolu bağlı; testler var (`ssrf.test.ts` · `web-crawler.test.ts` · int `knowledge-crawl.test.ts`).
  - **tm 97 de haklı olarak açık** — bulk/CSV yolu **yok**: `parseCsv`/`csv-parse`/`papaparse` grep
    **0** · `playbook.yaml`'da `bulk` grep **0** · `/knowledge-sources` yalnız 2 yol · `package.json`
    csv/multipart bağımlılığı **0**.
- **Kök neden:** `FR-MOD-06.3.2` iki kapsama bölünmüş — tek-kaynak yolu v1'de (`✅`, tm 33.4),
  bulk/CSV kanadı v2'de (`⬜`, tm 97). Panelin eşleştiricisi `06.3.2-bulk`'tan `-bulk`'u atıp v1
  satırıyla eşleştiriyor. Kardeş bulgular (#63/#65/#67/#71–75/#93/#95) 17:48'de kendiliğinden
  kapandı; bu biri sonek çakışması yüzünden kaldı.
- **Yapıldı (kod DEĞİŞMEDİ):** ayrım üç yerde açık hâle getirildi — `PLAN.md:520` v1 satırına
  "KAPSAM SINIRI" notu · §5.0 `06.3.2-bulk` satırına karşılıklı işaret + koda karşı kanıt ·
  tm 97 başlığı "YALNIZ çoklu-satır" olarak daraltıldı + `details` başına kapsam-sınırı uyarısı.
- **Karar:** görev **ne done ne cancelled** — iş gerçekten duruyor. Panel bulgusu bir sonraki
  taramada kapanmazsa panel tarafında eşleştiriciye sonek duyarlılığı gerekir (bizim tarafta
  yapılacak bir şey kalmadı). Gerekçe: **PLAN §D67**.
- **Doğrulama:** kod değişmedi → DoD kod kapıları N/A. `git status` temiz.

### V2-PLAN · Faz-2 kapsam süpürmesi + tam atomik kırılım — done — 2026-08-01 UTC

- **Neden açıldı:** Faz-0 ve v1 kapandı (GL-3/GL-4); sıradaki iş Faz-2. Ama Task Master'da
  **0 seçilebilir görev** vardı (19 açık görevin hepsi `deferred`) → panel 2026-07-27'den beri
  `critical` bulgu taşıyordu ve run-loop "Hazır task kalmadı" deyip duruyordu. Kullanıcı talimatı:
  v2'yi **eksiksiz** ve **en ince detayına kadar** böl; her işe doğru model+efor ayarını ver.

- **Yapıldı — 1) Kapsam süpürmesi (asıl bulgu).** v2 kapsamı üç bağımsız kaynaktan paralel tarandı
  ve uzlaştırıldı: PRD **§5.3** (v2 faz tablosunun her hücresi) · PRD **§5.5** (modül→faz matrisinin
  v2 sütunu) · PRD **§6** (`Öncelik` sütununda `(v2)` geçen her `FR-MOD`). Sonuç: **v2 = 30 kalem**
  (ilk uzlaştırma: 19 açık · 3 teslim · 1 kapsam dışı · 7 karar gerektiren; **7 karar PRD'den çözülünce nihai dağılım 23 ⬜ · 4 ✅ · 3 ⛔**). **PLAN §5 yalnız 18 listeliyordu → 12
  kalem eksikti.** Eksiklerin çoğu PRD'de proza içinde geçtiği ve kendi `FR-MOD` satırı olmadığı
  için gözden kaçmıştı. Her "PLAN'da yok" iddiası hedefli `grep` ile teyit edildi, yanlış-pozitifler
  ayıklandı (ör. "çakışma" PLAN'da 4 kez geçiyor, hiçbiri routing değil). → PLAN §5.0 · §D62

- **Yapıldı — 2) Yedi faz çelişkisi PRD'den çözüldü** (kullanıcı: _"Ne yapacağına ürün gereksinim
  md içinden karar vereceksin"_):
  - **08.9.6 IP allowlist** — PRD §5.3 "v2" der, FR-MOD "Could (Ent.)" der, PLAN Faz-3'e koymuş.
    Tiebreak PLAN §1.1: _"Çalışma sırası PRD §5'in faz sırasıdır"_ → **§5 fazı, §6 önceliği belirler**
    → **v2**. Kardeşleri (CC-mask/banned/spam) zaten v2 ve öne bile çekilmişti. → §D61
  - **08.5.7 Instagram** ikili etiketi (`Ent./v2`) → PRD §11.1/7 + Telegram'ın Faz-3'te olması → **v2**.
  - **07.7 Rapor grupları** — önceliği `Should (v1–v2)`, **açıkça iki faza yayılıyor**; v1 payı
    teslim, v2 payı (PDF/benchmark/Save view/Team performance) hiç açılmamıştı → **yeni kalem**.
  - **06.2.3 NL skill** → v1'de ✅; §5.3'teki tekrarı ⛔ builder'ın bağlamı → yeni iş yok.
  - **§5.5 MOD-04 / MOD-06 çıplak `○`** → somut FR yok → ayrı kalem açılmadı (§C-A12/A13).
  - **Temel audit log** → NFR-S12 + risk R5; yazıcı ✅ (tm 23) ama **okuma yüzeyi yok** (OpenAPI'de
    audit path grep 0) → v2 payı gerçek: plan/tier kapısı + 30 gün + ekran → **yeni kalem**.
  - **31+ şablon** → ADR-14 canvas'ı ⛔ ama şablon sayısı hedefi Skill galerisi üzerinden
    onurlandırılabilir → `05.6-tmpl31` (§C-A14).

- **Yapıldı — 3) Mobil (13.7 + 13.8-push) → Faz 3, gerekçe düzeltildi.** PLAN'daki `🔒` gerekçesi
  _"PRD §11.1/8 ile hizalı"_ diyordu; **§11.1/8 masaüstü native uygulama maddesidir, mobil değil** —
  yanlış atıf. PRD'de 13.7 `Should (v1)` ve KK'sı _"tam modül paritesi (Nexa farklılaşması)"_ diyor,
  yani kapsam dışı değil. Kalem **gerekçesiz 🔒** durumundaydı → §F.00'a göre gizlenmiş `⬜`.
  v1 kapanış kararı **değişmez** (mobil `Should`, `Must` sayacına girmiyordu). Kullanıcı kararı:
  Faz 3. Doğru gerekçe: native iOS/Android **stack dışı** (ADR-01/02). → tm 90 · §D60

- **Yapıldı — 4) Etiket sistemi: model × efor matrisi.** `[SONNET-XHIGH]` · `[SONNET-MAX]` ·
  `[OPUS-XHIGH]` · `[OPUS-MAX]`. Efor tabanı **xhigh** (matriste `high` ve altı yok); güvenlik işi
  asla `sonnet`'e verilmez. Bölme politikası: **her şey bölünür**, tek istisna bir `OPUS-MAX`
  alt-görevin güvenlik/algoritma **çekirdeği** (bağlam bölününce güvenlik akıl yürütmesi kaybolur);
  çekirdeğin etrafındaki ucuz yüzeyler ayrı ve daha ucuz etiketli alt-göreve çıkarılır. → §5.1 · §D63

- **Yapıldı — 5) Atomik kırılım: 23 kalem → 196 alt-görev · ~228 pencere · 9 dilim.**
  Akış: kapsam süpürmesi → kalem başına **kaynak çıkarımı** (PRD KK birebir + koda karşı recon) →
  **atomik kırılım**. Her alt-görev `dosyalar` + `referans desen` taşır — Sonnet penceresinin işi
  başlatabilmesini bu iki alan sağlar. **Etiket dağılımı:** `SONNET-XHIGH` 95 · `SONNET-MAX` 5 ·
  `OPUS-XHIGH` 65 · `OPUS-MAX` 31 → **%51 Sonnet**.
  - **Nerede durdu:** planlanan **adversarial denetim** turu (her `SONNET-*`'ın 6 koşula karşı
    yeniden sınanması) ve çapraz-kesit ajanları **oturum limitine takıldı** ve KOŞULAMADI.
    Denetim turu olmadan da kırılım kanıtlıdır (kaynak çıkarımı koda karşı yapıldı), ama
    **bağımsız ikinci göz geçmedi** — bu bir borçtur, aşağıda "sonraki pencereye not"ta.
  - **Elle yazılan 3 kalem:** `01.1.3-ai`, `12.4-bi`, `05.6-tmpl31` kırılımları limit yüzünden
    ajanla üretilemedi; kaynak verileri mevcut olduğu için orkestratör tarafından **elle** aynı
    formatta yazıldı (ev formatının tam alan seti + KK türetme gerekçesi + negatif testler).
  - **Kalite spot-check (orkestratör, bağımsız):** kırılımın 5 kod iddiası koda karşı doğrulandı —
    `by_hour/by_team/by_channel` grep 0 ✓ · `EXTRACT(HOUR` 0 ✓ · `ReportsBreakdown` satır 1908 ✓ ·
    `csv-parse`/`papaparse`/`multipart` bağımlılığı yok ✓ · `apps/api/src/lib/` içeriği birebir ✓.

- **Yapıldı — 6) 2026-07-28 "hepsi deferred" kararının kapsamı düzeltildi.** O karar **dış
  entegrasyonlar** için verilmişti ama §4.5 onu tüm v2+v3'e uygulamıştı. Oysa tm 63/64/66/73–78
  tamamen iç iştir; dış servise dokunanlar bile MASTER-PROMPT'un _"Dış servisleri MOCK'la"_ kuralına
  tabidir ve v1 bunu üç kanalda zaten yaptı (tm 35). **Gerçek kimlik gerektiren hiçbir v2 kalemi
  yok.** v2 görevleri `deferred` → `pending`. Faz-3 (tm 79–84, 90) `deferred` kalır. → §D64

- **Yapıldı — 7) `run-loop.sh` yeni etiketleri okuyor.** Etiket artık hem **modeli** hem **eforu**
  seçiyor: `pick_next` şemasına `model` alanı eklendi, prompt dört etiketi (+ eski `[MAX]`/`[XHIGH]`
  geriye uyumluluğunu) çözecek şekilde yazıldı, `stream_task` üçüncü parametre olarak modeli alıyor,
  `quota_gate` sonnet pencereleri için kapıyı orantılı gevşetiyor (RESERVE_PCT'ye dokunmadan).
  Etiket belirsizse **güvenli tarafa** düşer: `opus`+`max`. `bash -n` temiz.

- **Doğrulama:** Kod DEĞİŞMEDİ (uygulama kodu) — bu bir **planlama turu**; tek kod dokunuşu
  `run-loop.sh` (harness). DoD kod kapıları N/A (uygulama kodu değişmedi).
  Doküman tutarlılığı: PLAN §5 (başlık+§5.0+§5.1+§5.2+§5.3) · §6/§6.1 (mobil girdi, 08.9.6 çıktı) ·
  §C (A12/A13/A14) · §D (D60–D66) · §G (v2 dilim + 196 satırlık düz tablo + Toplamlar + Kritik yol)
  · `PLAN-V2-KIRILIM.md` (yeni companion, 23 kalem / 196 girdi) · HANDOFF · Task Master.
  **Task Master:** 99 görev (9 yeni: tm 91–99) · **196 yeni alt-görev** · 23 v2 üst görevi
  `deferred`→`pending` · tm 90 (mobil) `deferred` (Faz 3) · `validate_dependencies` ✅ temiz.
  Etiket sayımı TM'de doğrulandı: 95/5/65/31 — PLAN §5.2 ile birebir.

- **Varsayımlar:** §C-A12 (MOD-04 v2 `○` gereksinim değil) · §C-A13 (MOD-06 v2 payı = 06.3.2-bulk) ·
  §C-A14 (31+ şablon ADR-14 uyumlu ikame). Kalem bazlı varsayımlar `PLAN-V2-KIRILIM.md`'de listeli.

- **AÇIK BORÇ (bir sonraki pencere bunu bilsin):** **adversarial denetim turu koşulmadı** (oturum
  limiti). Kırılım kaynak-çıkarımı koda karşı yapıldığı için sağlamdır ve orkestratör 5 iddiayı
  bağımsız doğruladı — ama **her `SONNET-*` etiketinin 6 koşula karşı ikinci-göz denetimi** ve
  **her KK metninin PRD'de yeniden aranması** yapılmadı. Pratik risk: yanlış bir `SONNET` etiketi
  (güvenlik işinin küçük modele düşmesi). **Azaltma:** her dilime başlamadan önce o dilimin
  `SONNET-*` alt-görevlerini §5.1.1'in 6 koşuluna karşı gözden geçir; şüpheliyi `OPUS-XHIGH`'a
  yükselt. Bu, dilim başına ~10 dakikalık bir kontroldür ve dilim kapanış kapısının parçasıdır.
- **Dilim sırası bağımlılıkla zorlandı:** run-loop `next` seçimi önceliğe + görev numarasına
  bakar, dilim tablosunu okumaz. Bu yüzden `V2-2` (Multibrand) → üç güvenlik görevine,
  `V2-3…V2-9` → `V2-2`'ye bağlandı. Doğrulama: panel `next` = **#80 08.9.6 (dilim V2-1)**,
  20 görev sıra bekliyor, `validate_dependencies` temiz.
- **Sonraki pencereye not:** v2 artık **koşulabilir** — run-loop seçilebilir görev bulacak.
  Çalışma sırası §G'deki v2 dilim gruplamasıdır; güvenlik kalemleri (08.9.6 · 08.6.3-conflict)
  bilinçli olarak **erken** dilimlere kondu (sonradan eklenen güvenlik en pahalı borçtur).
  **Multibrand** kararı §5.3'te gerekçeli: tenant izolasyonunun genişlemesi olduğu için
  konumu diğer v2 yüzeylerine marka boyutu eklemek zorunda kalmamak açısından kritik.
  Kalem başına **açık sorular** (ürün kararı bekleyenler) `PLAN-V2-KIRILIM.md`'de işaretli —
  bir dilime başlamadan önce o kalemin açık sorularına bak.

### GRAF-ONARIM (2. doğrulama penceresi) · run-loop "0 seçilebilir" yeniden teşhis — NO-OP — done — 2026-08-01 UTC

- **Neden açıldı:** run-loop yine 0 seçilebilir görev bulup düzeltme penceresi dispatch etti. Aynı
  terminal durum ikinci kez tetiklendi → **grafta değil, dispatch'te döngü** (harness ayrı iş, §5).
- **Teşhis (canlı, bu pencerede sıfırdan — HANDOFF'a güvenmeden kanıtla):** `get_tasks` → **89 görev
  = 70 done + 19 deferred**; **0 pending · 0 in-progress · 0 blocked · 0 review**. Seçilebilir =
  `pending` VE deps kapalı; hiçbiri `pending` değil (hepsi `deferred`, `priority=low`) → **seçilebilir = 0**.
  **Sebep (a) kesin.** Diğerleri elendi: `validate_dependencies` ✅ (döngü/eksik-id yok); deferred
  deps'in tümü çözülüyor — #65/#79→35 (done) · #72→34 (done) · #75→[45 done, 74 deferred = gerçek
  sıra kenarı, Sales tracker→Goals]. Kırık/döngüsel/fantom kenar yok.
- **Engel HÂLÂ geçerli → graf mutasyonu YOK:** PLAN §4.5:889 (**kullanıcı kararı 2026-07-28**: "dış
  entegrasyonlar deferred kalır") + §1064 ("**değişmedi**", 19'u birebir sayar: 63/64·65/79·66·67·
  71/72·73–78·80–84) + CLAUDE.md sınırı (dış servis = yapılandırma, kod değil; mock'lanır). Kararın
  değiştiğine ya da gerçek kimlik/anahtar sağlandığına dair **hiçbir sinyal yok**. → 19 deferred
  açılMADI · yeni görev açılMADI · `tasks.json` **değişmedi** (yalnız bu HANDOFF notu).
- **Terminal durum DOĞRU:** run-loop "Hazır task kalmadı. Plan tamam." = **beklenen son durum, hata
  değil**. Açılış koşulu (ikisi de açık onay + CLAUDE.md sınırı ister): (i) kullanıcı 2026-07-28
  kararını değiştirir, **ya da** (ii) gerçek dış servis kimlikleri sağlanır → o an ilgili kalemi
  deferred→pending çek (graf hazır, deps temiz). Bu koşullar sağlanana dek döngü **kod işiyle
  devam ETMEYECEK** — ve bu doğru. Bkz. GRAF-ONARIM (1. geçiş, commit `15f9ce7`) — bu pencere onu
  **bağımsız** yeniden doğruladı, aynı sonuç.
- **Doğrulama:** `validate_dependencies` ✅ · sayım 70 done · 19 deferred · 0 pending/in-progress ·
  `metadata.taskCount=89` sağlam. DoD kod kapıları **N/A** — kod DEĞİŞMEDİ. Harness dosyaları
  (`run-loop.sh`/`TASK-RUNNER-PROMPT.md`) DOKUNULMADI (§5).

### GRAF-ONARIM · run-loop "seçilebilir görev yok" teşhisi + #86.1 bayat bayrak — done — 2026-08-01 UTC

- **Teşhis (kanıtlı):** run-loop 0 seçilebilir görev buluyor → "Hazır task kalmadı" deyip duruyordu.
  89 görev: 70 done + **19 deferred** (top-level) · 87 subtask (biri bayat) → **0 pending / 0 in-progress**.
  Aday sebepler test edildi:
  - **(a) hepsi deferred — DOĞRU sebep.** 19 açık üst görev (63-67, 71-84) `deferred`, `priority=low`;
    hiçbiri `pending` değil → hiçbiri seçilemez.
  - **(b) döngü — ELENDİ:** `validate_dependencies` temiz.
  - **(c) var-olmayan-id bağımlılığı — ELENDİ:** tüm deps (35/34/45/74/88…) mevcut göreve çözülüyor.
  - **(d) aktarılmamış bağımlılık — ELENDİ:** #75→["45","74"] gerçek sıralama kenarı (Sales tracker
    Goals'a bağlı); #45 done, #74 var (deferred). Kırık değil.
- **Tek gerçek kusur (onarıldı):** **#86.1 `Diff + karar`** `in-progress` kalmış — parent #86 + kardeş
  #86.2 `done`, iş `82c4273`'te commit'li, `.parked-playbook/` silinmiş (disk yok). Bayat bayrak →
  **done** yapıldı. Tek graf mutasyonu bu. (pick_next §92-96 rule#1 in-progress'i ilk seçtiği için bu
  fantom subtask döngü durum-okumasını da kirletiyordu.)
- **Doğrulama (kapılar):** `validate_dependencies` ✅ (döngü/eksik-referans yok) · post-onarım sayım:
  top-level 70 done · 19 deferred · **0 pending · 0 in-progress** · subtask 87 done · **seçilebilir görev = 0**.
  `metadata.taskCount=89` sağlam. (DoD build/test kapıları N/A — **kod DEĞİŞMEDİ**, yalnız görev grafiği.)
- **Karar — 19 deferred neden pending'e ÇEKİLMEDİ (engel HÂLÂ geçerli):** PLAN §4.5:1064
  _"GO-LIVE sonrası deferred kalanlar (**kullanıcı kararı 2026-07-28 — değişmedi**)"_ 19'unu birebir
  sayıyor (63/64 · 65/79 · 66 · 67 · 71/72 · 73-78 · 80-84). Gerekçe: dış entegrasyon
  (Stripe/SMTP/S3/ClamAV = **yapılandırma, kod değil**; provider desenleri hazır) + kurumsal uyumluluk
  (SOC2/ISO/HIPAA/SAML = **süreç/denetim, kod değil**). CLAUDE.md sınırı: "Production deploy/DNS/TLS/
  gerçek secret YOK; dış servisler mock'lanır." §D52 istisnası (tm 68/69/70 öne-çekme) zaten **done**.
  → Bunları açmak hem dated kullanıcı kararını hem daimi kapsam sınırını ihlal ederdi. **Açılmadı.**
- **Sonraki pencereye / döngüye not:** **Döngü artık bir görevle DEVAM ETMEYECEK — ve bu DOĞRU.**
  run-loop bundan sonra "Hazır task kalmadı. Plan tamam." diyecek; artık **doğru terminal durum** —
  repo kapsamında yapılacak kod işi kalmadı (Faz-0 + v1 + öne-çekilen güvenlik seti tam). 19 deferred
  kalem **otomatik açılmamalı**; açılması için ya (i) kullanıcı 2026-07-28 kararını değiştirmeli, ya da
  (ii) gerçek dış servis kimlik/anahtarları sağlanmalı (ikisi de CLAUDE.md sınırı + açık onay ister).
  O zaman ilgili kalemi deferred→pending çek — graf hazır (deps temiz). Kirli harness dosyaları
  (`TASK-RUNNER-PROMPT.md`, `run-loop.sh`, `.DS_Store`) bu pencerede de DOKUNULMADI (§5 kapsam) — ayrı iş.
- **İkinci geçiş — bağımsız yeniden doğrulama + commit (aynı teşhis, sıfırdan):** top-level **89**
  (70 done · **19 deferred** · **0 pending / 0 in-progress**), subtask **87** hepsi terminal, id'ler
  **1–89 kesintisiz**, 19 açığın tüm deps'i çözülüyor (#65/79→35 done · #72→34 done · #75→45 done+74
  deferred = gerçek sıralama kenarı), self-dep/döngü yok, `validate_dependencies` ✅ (task-master 0.43.1
  "Dependencies validated successfully"). #86 ailesi (parent + .1 + .2) done + `.parked-playbook/` diskte
  yok + `82c4273` "SİL" kararını taşıyor → **#86.1→done meşru**. Engel HÂLÂ geçerli (PLAN §4.5:1064 ·
  §889 kullanıcı kararı 2026-07-28 "değişmedi" · §D52 · CLAUDE.md dış-servis sınırı) → 19 deferred
  **açılMADI**, yeni görev **açılMADI**. Önceki geçişin **commit'lenmemiş** onarımı (tasks.json #86.1 +
  bu GRAF-ONARIM notu) bu pencerede commit'lendi → kapı kapandı. Harness dosyaları yine DOKUNULMADI (§5).

### tm 69 · 08.9.3 Spam filtre `[MAX]` — done — 2026-07-31 UTC

- Yapıldı: **deterministik** spam motoru + chat & email yolları **aynı motora** bağlandı (FR-MOD-08.9.3,
  §4.5/GL-7). Öne-çekilen saf-güvenlik üçlüsünün (tm 70/68/69) sonuncusu.
  - **Motor** `apps/api/src/services/security/spam-filter.ts` — **LLM yok** (test edilebilir +
    yanlış-pozitif denetimi). `classifyText` dört sinyal: blocklist (dar, çok-kelime) · link seli
    (≥4 URL) · tekrar (token ≥5× & ≥%50 baskın, veya 20+ aynı-karakter run) · gibberish (40+ hane
    kesintisiz alnum + Shannon entropi ≥3.5). `evaluateSpam({filterEnabled,text?,providerFlagged?})`
    **tek gate** (filtre-kapalı→geç · sağlayıcı-bayrağı→spam · yoksa içerik) + `isSpamFilterEnabled`
    (RLS-kapsamlı, satır yoksa varsayılan **açık**).
  - **Chat** (`customer.ts` `/customer/chat/events`): yalnız chat-**START** taranır (`existing`
    lookup yukarı taşındı, kontrol pre-chat yazımlarından ÖNCE → red hiçbir yan-etki bırakmaz).
    Spam → `message_rejected` (403, **yeni hata tipi**, jenerik mesaj → kural sızmaz).
  - **Email** (`email-inbound.ts`): inline `email.spam && spamFilterOn` yerine `evaluateSpam`
    (konu içeriği + sağlayıcı bayrağı) — tek doğruluk kaynağı; dış davranış aynı (`ignored/spam`).
  - **Davranış kararı** (sessiz-drop vs zarflı-red) → **PLAN §C-A11**: chat zarflı-red (senkron widget,
    kardeş banned-IP ile tutarlı), email sessiz (async webhook).
- **Güvenlik denetimi (security-reviewer subagent — [MAX] son kapı):** bir **HIGH** commit ÖNCESİ
  giderildi — `normaliseToken`'ın `$`-anchored regex'i ziyaretçi metniyle **O(n²)** (ZWSP dolgulu
  token → ~1 s event-loop bloğu, tüm tenant'lar). Fix: linear iki-uçlu walk + repetition döngüsünde
  64-hane token kapısı + ReDoS-linear regresyon unit'i. LOW (email konu maske sırası) da kapatıldı:
  konu artık maskeli sınıflandırılır. Cross-tenant/RLS + red-öncesi-yazma-yok + probing-yok onaylı.
- Doğrulama (DoD kapısı, exit 0, kanıtla): typecheck ✅ · lint ✅ · build ✅ · **unit** ✅ (spam-filter
  **29** negatif-önce; `types` sayaç 27→28 `NEXA_ADDED_TYPES`+`message_rejected`) · **integration** ✅
  **805** (api, +7: customer-chat 6 + email 1; serial `--concurrency=1`, contract-parity 5/5) · **e2e**
  ✅ **59/59** (widget/demo/traffic/customers/settings chat-start'ları meşru → filtre kırmadı). `.env`
  source'lu, nexa-db:5433/nexa-redis:6380 healthy.
- Varsayımlar: yeni hata tipi `message_rejected` (403) — kardeş `customer_banned` deseni (§D58);
  openapi `ErrorType` enum + `contract:generate` regen. Eşik değerleri **yanlış-pozitif-averse**
  seçildi (task'ın #1 kaygısı); unit testi meşru uzun-URL'de char-run FP'sini yakaladı → per-token'a
  alınıp URL atlandı (gerçek bir tasarım hatası testle bulundu, uydurma yeşil değil).
- Sonraki pencereye not: öne-çekilen güvenlik seti (§D52 · tm 70/68/69) **tamamlandı**. Spam davranışı
  chat=zarflı-red / email=sessiz asimetriktir — gerekçe §C-A11. Kurulu sohbetteki mesaj **taranmaz**
  (bilinçli scope); ileride mid-chat spam istenirse ayrı task. Motor deterministik + saf → yeni
  sinyal/eşik eklemek izole (unit tablo-testi).
- Not (çalışma alanı): pencere açılışında zaten kirli olan **tm 69 dışı** harness dosyaları
  (`TASK-RUNNER-PROMPT.md`, `run-loop.sh`, `.DS_Store`) bu commit'e DAHİL EDİLMEDİ (§5 kapsam
  disiplini) → tree'de duruyorlar, ayrı bir işin parçası.

### tm 89 · E2E determinizm — `Date.now()` cc-mask (08.9.5) çakışması — done — 2026-07-31 UTC

- Kapsam: **§D58 (GL-6/tm 68) takip bulgusu.** GL-5 cc-mask (08.9.5) sonrası birkaç e2e spec
  probabilistik flake: ziyaretçi/ajan **mesaj metnine** gömülü çıplak `Date.now()` (13 hane =
  kart uzunluğu) Luhn-geçerli düştüğünde `lib/cc-mask.ts` `CARD_CANDIDATE` (≥13 hane + Luhn) onu
  `**** **** **** NNNN`'e maskeler → `toContainText(rawText)` ~%10 kırılır. `visitorSends`
  (fixtures.ts:114) her çağrıda echo-back `toContainText` yaptığı için her `visitorSends(...Date.now())`
  sitesi etkileniyordu.
- Yapıldı:
  - 7 **mesaj-metni** jetonu `Date.now().toString().slice(-6)` ile 6 haneye indirildi (6 < 13 → asla
    `CARD_CANDIDATE`'e girmez → hiç maskelenmez → verbatim round-trip; tm 68/demo-flow deseninin aynısı):
    `customers.spec.ts:101` · `traffic.spec.ts:23` · `settings.spec.ts:307`/`324` · `widget.spec.ts:120`/`153`.
  - **+ `widget.spec.ts:247`** (ekli-dosya `caption`'ı, agent transcript'inde `toContainText`): task'ın
    numaralı listesinde YOKTU ama birebir aynı kusur (mesaj metni + maskelenir + assert edilir). DoD
    "tam süit deterministik yeşil" gereği kapatıldı — enumerasyon dışı ek bir örnek, kapsam sprawl'ı değil
    (aynı kusur sınıfı, aynı task hedefi). Numaralı listenin `grep`'i `caption` değişkenini kaçırmış.
  - DOKUNULMADI (cc-mask yazım yolunda değil → maskelenmez): URL/domain (`ai-agent:80` · `onboarding:62` ·
    `settings:21`/`161`/`183`) + ayar/metadata (`ai-agent:54` Tone · `ai-agent:78` knowledge Title ·
    `campaigns:14` kampanya adı) + `onboarding:18` signup id (mesaj değil; `-random` diziyi ayrıca keser).
- Doğrulama (exit 0, kanıtla): e2e typecheck ✅ · e2e lint ✅ · **e2e ilgili yeşil** — 4 etkilenen spec
  **32/32 passed** (customers/traffic/settings/widget; `.env` source'lu, nexa-db:5433/nexa-redis:6380
  healthy, migrate current, global-setup seed). Düzeltilen her site fiilen koştu: customers:93 ·
  settings:301 (canned reply → müşteriye) · traffic:12 · widget:118/134/228.
- Varsayımlar: Determinizm **inşa gereği** kanıtlı (regex tabanı 13 hane; 6-hane jeton asla eşleşmez) —
  tek e2e koşusu bir olasılık-flake'i kanıtlayamayacağı için kanıt yapısaldır; unit/integration/build
  bu değişiklikten etkilenmez (yalnız test fixtürü). Kaynak kod DEĞİŞMEDİ.
- Sonraki pencereye not: GL-6 (tm 68) takip bulgusu kapandı. Yeni mesaj-metni e2e jetonu eklerken
  `Date.now()` yerine `.slice(-6)` kullan (13-hane cc-mask tabanının altında) — aksi halde flake döner.
  GL-7 (tm 69 · spam-filter) sırada.
- Not (çalışma alanı): pencere açılışında zaten kirli olan **tm 89 dışı** harness dosyaları
  (`TASK-RUNNER-PROMPT.md`, `run-loop.sh` kota-kapısı düzenlemeleri, `.DS_Store`) bu commit'e
  DAHİL EDİLMEDİ (§5 kapsam disiplini) → tree'de duruyorlar, ayrı bir işin parçası.

### GL-6 · 08.9.2 — Banned customers (IP/visitor yasak) — done — 2026-07-31 UTC

- Kapsam: **FR-MOD-08.9.2 · [XHIGH].** IP tabanlı müşteri yasağı. v2'den öne-çekilen üç güvenlik
  kaleminin ikincisi (§D52/§4.5-GL-6); GL-4 bağımlılığı çözülüydü. Mevcuttu: visitor yasağı
  (`Customer.bannedAt` + token mint reddi + `chat-service` chat start reddi) + ban/unban müşteri UI
  (`CustomerDetailPanel`). Eksikti: `SecuritySettings.bannedCustomerIps` kolonu şemadaydı ama hiçbir
  yerde okunmuyordu (grep 0) → IP yasağı uygulanmıyordu; Settings→Security yönetim yüzeyi yoktu.
- Yapıldı:
  - Saf lib `apps/api/src/lib/banned-ip.ts` — `normaliseIp` (trim/lowercase + IPv4-mapped IPv6 `::ffff:`
    sıyırma) + `isIpBanned(tx, ip)` (per-license `SecuritySettings.findFirst`, RLS-kapsamlı; satır yoksa/boşsa
    yasak yok). Kimlik yasağı servis katmanında; **adres yasağı istek kenarında** (IP orada bilinir).
  - Enforcement iki nokta: `auth.ts` `/customer/token` mint (yasaklı adrese hiç token yok) + `customer.ts`
    `/customer/chat/events` (bandan önce mint'lenmiş token'la başlatma/mesaj da bloke) → `customer_banned`.
  - Kontrat: `banned_customer_ips` `/settings/security` GET (+`required`)/PATCH; PATCH `net.isIP` doğrular +
    `normaliseIp` canonical + `Set` dedup. openapi.yaml + settings.yaml + regen (`api.ts`/`openapi.json`).
  - UI: Settings→Security "Blocked IP addresses" (`SettingsPage.BannedCustomerIps`, `FileSharing` ile aynı
    `['settings','security']` sorgusunu paylaşır). Müşteri ban/unban UI zaten mevcuttu → doğrulandı (part c).
- Doğrulama (exit 0, kanıtla): typecheck ✅ · lint ✅ · build ✅ · unit ✅ (api `banned-ip.test.ts` 5 · web
  `BannedCustomerIps.test.tsx` 4) · integration ✅ **798** (api, +10: settings +4 · customer-chat +6 —
  token 403 / chat token-önce bloku / unban / **cross-tenant** / IPv4-mapped; serial `--concurrency=1`,
  contract-parity 5/5) · e2e ilgili ✅ (settings 13/13 — yeni bölüm kırmadı; demo-flow 3/3).
- Varsayımlar: IP karşılaştırması exact-match (normalize sonrası); CIDR/aralık yok (KK "adres" yeterli,
  ileride genişletilebilir). `trustProxy: true` zaten açık → `request.ip` XFF'i yansıtır.
- Sonraki pencereye not: **tm 89 açıldı** — GL-5 cc-mask (08.9.5) sonrası birkaç e2e spec bayat: ziyaretçi/
  ajan mesaj metnine gömülü çıplak `Date.now()` (13 hane) Luhn-geçerli olunca maskeleniyor →
  `toContainText(rawText)` flake. Bu turda **demo-flow.spec.ts** düzeltildi (`.slice(-6)`); KALAN 5 spec
  (customers/traffic/settings/widget) tm 89'da (§5 kapsam disiplini — bu turda sprawl edilmedi). **GL-7
  (tm 69, spam filtre) sırada.**

### GL-5 · 08.9.5 — CC masking (Luhn, yazma anında) — done — 2026-07-31 UTC

- Kapsam: **FR-MOD-08.9.5 · [MAX] · NFR-C5/S9 · PCI SAQ A.** Kart numarası **yazım anında** maskelenir
  (DB/log'a, yalnız UI değil). v2'den öne-çekilen üç güvenlik kaleminin ilki (§D52); GL-4 bağımlılığı çözülüydü.
- Yapıldı:
  - Saf lib `apps/api/src/lib/cc-mask.ts` — 13–19 haneli aday diziler (boşluk/tire ayraçlı dahil) **Luhn** ile
    doğrulanır, geçen PAN `**** **** **** 1234`'e maskelenir (son 4 korunur; yanlış-pozitif biası bilinçli —
    kaçırmaktansa fazla maskele). `maskCardNumbers` + `maskOptional`.
  - Tüm event yazım yolları **kaynağında** maskeler: `chats.ts` (`normaliseEvent` → ajan send + start initial),
    `customer.ts` (widget mesaj + **AI/skill'e giden metin** + pre-chat `custom_fields` + rating comment +
    typing sneak-peek), `email-inbound.ts` (`ingestInboundEmail` konu → ticket + triage). Kaynakta maskelendiği
    için **RTM push + transcript e-postası otomatik** maskeli; `audit_log` meta yapıca değer taşımaz; request
    log Fastify default serializer `req.body`'yi loglamaz.
- Doğrulama — **tam DoD kapısı, exit 0:**
  - `typecheck` 0 · `lint` 0 · `build` 0
  - **unit** `cc-mask.test.ts` **16** (NEGATİF önce: Luhn-geçmez 16-hane sipariş no + telefon + UUID + timestamp
    + 20-hane hesap no MASKELENMEZ; ayraçlı/ayraçsız/13-15-16-19-hane PAN maskelenir) — tüm workspace unit yeşil
  - **integration 788** (api, +9 `cc-masking.test.ts`; serial `--concurrency=1`, contract-parity 5/5) —
    widget/ajan/pre-chat/rating/email **DB'de ham PAN YOK** (doğrudan SQL), transcript `.data/mail` spool + audit
    sweep temiz, cross-tenant A/B
  - **e2e 59** (18 spec chromium, `.env` source'lu) — mesajlaşma yolu kırılmadı
- Varsayımlar: yok — her yazım yolu koda/teste karşı doğrulandı; kanıtsız çevirme yok.
- Sonraki pencereye not: **GL-6 (tm 68 · Banned IP) → GL-7 (tm 69 · Spam filtre)** sırada; ikisinin de GL-4
  bağımlılığı çözülü, birbirinden bağımsız. Kapsam dışı bırakılanlar (gerekçeli, §D57): `properties` JSON
  (ajan-kontrollü yapısal veri) + kişi adı alanı (isim maskesi yanlış olur). Pencereye açılışta zaten `M` olan
  harness dosyaları (`TASK-RUNNER-PROMPT.md` + `run-loop.sh`) ve kök `.DS_Store` **bu turun işi değil →
  commit'e alınmadı**, çalışma-tepesinde bırakıldı (GL-4 ile aynı ele alış).

### GL-4 · V1-KAPAT — v1 §F.00 kapanış turu — done — 2026-07-31 UTC

- Kapsam: **v1 (Faz 1) kapanış turu — kod DEĞİŞMEDİ (saf denetim + doküman senkronu).** §F.1'in 10 maddesi
  **tam sürüm** v1 koduna karşı koşuldu; `Must` sayacı **sayılarak** doğrulandı; üst tablo Faz-1 → **✅ KAPALI**.
  HANDOFF 2026-07-28'in "son bakım penceresi tam kapıyı koşmadı" borcu **tam E2E** koşularak kapatıldı.
- Yapıldı:
  - **Sayım (subtask 1):** v1 `Must` = §4.1/4.2/4.3'te `grep 'Must (v1)'` = **20 satır**, hepsi ✅ —
    05.1/05.3/05.5 (3) · 06.1–06.4 (10) · 08.5.4–.6 (3 MOCK) · 08.8.4/02.1.2/04.2 (3) · 10.1.4 (1) =
    **20 ✅ · 0 ◐ · 0 ⬜** (beklenen doğrulandı). Mobil 13.7/13.8-push 🔒 gerekçeli (§11.1/8) — sayaca girmez.
  - **Bayatlık düzeltildi (verify+close):** GL-3'ten farklı olarak v1 modül tabloları zaten tam ✅'ti
    (GL-1/tm 85 üç satırı senkronlamıştı) — bayatlık yalnız (a) §4.4.11 10.1.4-a **breakdown** "UI ⬜"
    (oysa §4.3 ✅ tm 54) ve (b) §8 tablosu 3 "0-tüketici" satırı (`webhooks`/`channels`/`ratings` → v1
    doldurdu, tm 34/35/45/60). İkisi de kanıtla güncellendi.
  - PLAN senkron: üst tablo Faz-1 (→ ✅ KAPALI + `20 ✅ · 0 ◐ · 0 ⬜`) · header v1-kapanışı damgası ·
    §F.00 v1 kapı satırı · §8 (3 satır + Karar re-sayım) · §4.4.11 10.1.4-a · §4.5/GL-4 "✅ Kapandı" bülteni · **§D56**.
- Doğrulama — **tam DoD kapısı + TAM E2E, exit 0 (kanıtla; §F.2 "kanıtsız geçti yok"):**
  - `typecheck` 0 · `lint` 0 · `build` 0 · `db:check-drift` "no drift"
  - **unit 817** (web 445 · api 179 · rtm 29 · types 56 · ai-mock 56 · widget 52)
  - **integration 821** (api 779/38f · rtm 42/1f, serial `--concurrency=1` — paylaşılan-PG yarışı) · **contract-parity 5/5**
  - **e2e 59** (18 spec chromium, `demo-flow` dahil) — `.env` **source'lanarak** koşuldu (Playwright webServer
    spawn'ları env'i process'ten alır); portlar boştu, temiz başladı
- Varsayımlar: yok — her satır koda/teste karşı doğrulandı, kanıtsız çevirme yok.
- Sonraki pencereye not: **v1 (Faz 1) ✅ KAPALI. GO-LIVE hardening hazır.** Sıra: **GL-5/6/7 = tm 70 (CC
  masking) → 68 (Banned IP) → 69 (Spam filtre)** — üçünün de GL-4 bağımlılığı artık çözüldü (§D52 belgeli
  öne-çekme). GL-4 faz-sızıntısı denetimi: bu üçü **henüz yazılmadı** (`cc-mask.ts`/`spam-filter.ts` ABSENT,
  `bannedCustomerIps` 0 enforcement) → belgesiz sızıntı yok, disiplin korundu (kapanış ÖNCE, öne-çekilen iş
  SONRA). Dış entegrasyonlar (tm 63–67/71–84) deferred (kullanıcı kararı §D52). **Bu commit yalnız
  PLAN.md + HANDOFF.md + tasks.json içerir** (kod değişmedi). Pencereye açılışta zaten `M` olan harness
  dosyaları (`TASK-RUNNER-PROMPT.md` protokol iyileştirmesi + `run-loop.sh`) ve kök `.DS_Store` (macOS
  artefaktı) **bu turun işi değil → commit'e alınmadı**, çalışma-tepesinde bırakıldı. Tam E2E'nin yeniden
  ürettiği `apps/e2e/kanit/*.png` (26) UI değişmediği için **geri alındı** (docs-only; refresh gerekirse ayrı `chore`).

#### §F.2 — v1 (Faz 1) Kapanış Raporu (PRD §11.2 karşılaştırmalı)

- **Tamamlanan kapsam (PRD kimlikleriyle):** v1 `Must` = **20/20 ✅**. FR-MOD: 05.1/05.3/05.5 (Playbook header/
  sekmeler/satır) · 06.1–06.4 (AI Agent sekmeler/skill editör+reorder/knowledge+website-crawl-SSRF/profile) ·
  08.5.4–.6 (Messenger/Twilio/WhatsApp MOCK adaptör) · 08.8.4 (Webhooks HMAC+SSRF+retry) · 02.1.2 (AI Agents
  inbox grubu) · 04.2 (team AI performance) · 10.1.4 (AI resolutions meter). `Should` payı da çoğunlukla teslim:
  05.2/05.4 · 06.5 · 02.1.4/02.3.2/02.5/02.7/02.9 · 03.1.3/03.3.x · 04.6 · 07.4/07.7/07.8 · 08.6.2/08.7.3–.7/
  08.8.1 · 09.1/09.2 · 10.1.5/10.3 · 11.7/11.8 · 12.1–12.3 (Copilot) · 13.1/13.6 (HelpDesk merge/followers).
- **Yarım kalan işler:** **YOK** (v1 `Must` kapsamında 0 ◐ · 0 ⬜). — `Should` kalanları aşağıda.
- **Bilinçli yapılmayanlar (⛔/🔒, gerekçeli):** 13.7 Mobil uygulamalar 🔒 (web-öncelikli, PRD §11.1/8) ·
  13.8-mobil-push 🔒 (aynı gerekçe) · `06.3.2-bulk` (bulk/CSV import) → v2 §5.1 (Should, ismen) · `workflows`
  tablosu ⛔ (ADR-14, UI'sız). Bunlar kapanışı bloklamaz (§F.00: 🔒/⛔ sayaca girmez, gerekçeleri yazılı).
- **Sessiz borç (§F.1/6):** **TEMİZ.** apps/*/src + packages/*/src'de 0 TODO/FIXME/XXX/HACK · 0 `@ts-expect-error`/
  `@ts-ignore` · 0 test `skip`/`only` · 0 `eslint-disable` (`find`-doğrulandı).
- **Şema artığı (§F.1/4):** v1 üç "0-tüketici" tabloyu doldurdu (webhooks tm34 · channels tm35 · ratings tm45/60);
  yalnız `goals` (v2·13.3) + `workflows` (⛔ADR-14) 0-tüketici, ikisi de gerekçeli. Sistemsiz artık tablo yok.
- **Faz sızıntısı (§F.1/2):** GL-5/6/7 §D52'de **belgeli** öne-çekme (v2 güvenlik → GO-LIVE); henüz yazılmadı;
  belgesiz başka faz sızıntısı **yok**.
- **Sapmalar (§D):** §D56 (bu tur). Önceki ilgili: §D52 (GO-LIVE kırılımı) · §D53 (GL-1 v1 bayat satır) · §D55 (GL-3 Faz-0).
- **Karar bekleyen açık sorular (PRD §11.2):** v1 kapsamında **yok**. Sıradaki iş kullanıcı kararıyla belli:
  GL-5/6/7 (tm 70/68/69, öne-çekilen saf-güvenlik) artık hazır; dış entegrasyon geçişleri (gerçek Stripe/SMTP/
  S3/ClamAV) PRD §11.1 + CLAUDE.md sınırı gereği bu depodan yapılmaz (provider desenleri hazır, mock aktif).

### GL-3 · F0-KAPAT — Faz-0 §F.00 kapanış turu — done — 2026-07-31 UTC

- Kapsam: **Faz-0 kapanış turu — kod DEĞİŞMEDİ (saf denetim + doküman senkronu).** §F.1'in 10 maddesi
  **tam sürüm** koda karşı koşuldu; `Must` sayacı **sayılarak** doğrulandı; üst tablo Faz-0 → **✅ KAPALI**.
- Yapıldı:
  - **Sayım (subtask 1):** Faz-0 `Must` = §3.0–§3.10 modül **48 ✅** (00:3·01:4·02:11·03:2·04:6·06:0·07:1·08:10·10:5·11:5·13:1) + 3 EK = **51 ✅ · 0 ◐ · 0 ⬜** (beklenen 51 doğrulandı).
  - **Uyuşmazlık giderildi:** üst-tablo `45 ✅ · 6 ◐` bayattı → `51 ✅ · 0 ◐`. 01.3/02.4/13.8 modül tablolarında zaten ✅'ti (D23/D24/D26) ama sayaç güncellenmemişti; EK-A.1/EK-A.2/EK-B.1 (§7.1) + NFR P4 (§7.2) tm 29/30 teslimine karşı **kanıtla `◐`→`✅`** ("verify+close, don't rebuild" — "TM'de bitti, PLAN'da ◐" deseni, §D52/§D53 · panel).
  - PLAN senkron: üst tablo · "Faz-0 kapanmadı" bloğu→tarihçe · §3.13 kapı `✅ KAPANDI` · §7.1 (EK-A.1/A.2/B.1) · §7.2 (P4) · M4 sayısı (752→**1697**) · §E sayısı (595→1697) · §F.00 kapı satırı (AÇIK→KAPALI) · §4.5/GL-3 `✅ Kapandı` bülteni · **§D55**.
- Doğrulama — **tam DoD kapısı, exit 0 (kanıtla; §F.2 "kanıtsız geçti yok" uyarısı):**
  - `typecheck` 0 · `lint` 0 · `build` 0
  - **unit 817** (web 445/65f · api 179/15f · rtm 29/3f · types 56 · ai-mock 56 · widget 52) — EK kanıtı: `form.test.tsx` 13 · `dirty-guard` 6 + `stepper` 5 + `optimistic` 3 · `VirtualList` 10 (10k P4 proxy) + `Skeleton` 7
  - **integration 821** (api 779/38f · rtm 42/1f, serial `--concurrency=1` — paylaşılan-PG yarışı) · **contract-parity 5/5**
  - **e2e 59** (18 spec chromium, `demo-flow` dahil) — `.env` **source'lanarak** koşuldu (ilk deneme rtm dev env'siz düştü; portlar boşaltıldı)
- Varsayımlar: yok — her satır koda/teste karşı doğrulandı, kanıtsız çevirme yok.
- Sonraki pencereye not: **Faz-0 ✅ KAPALI.** Sıra: **tm 88 (GL-4 · v1 kapanış turu) → 70/68/69 (GL-5/6/7 öne-çekme güvenlik)**. GL-4, GL-3 ile aynı disiplini v1 §4 sayaçlarına uygular; faz-sızıntısı maddesinde GL-5/6/7 belgeli sapması (§D52) beklenir, belgesiz sızıntı aranır. Kök `.DS_Store` pre-existing `M` (macOS artefaktı) — commit'e alınmadı.

#### §F.2 — Faz-0 Kapanış Raporu (PRD §11.2 karşılaştırmalı)

- **Tamamlanan kapsam (PRD kimlikleriyle):** Faz-0 `Must` = **51/51 ✅**. FR-MOD: 00.1–00.3 (auth/signup/reset) · 01.1.3/01.1.6/01.2/01.3 (shell/⌘K/trial/sağ-panel) · 02.1.1/02.1.3/02.2.2/02.3.1/02.3.3–.6/02.4/02.6/02.8 (inbox/transcript/composer/details/ticket/archive) · 03.2.1/03.2.3 (contacts) · 04.1/04.3.1/04.3.3/04.3.4/04.4/04.5 (team/invite/teams) · 07.3.2 (reports KPI) · 08.5.1–.3/08.5.9/08.6.1/08.7.1/08.7.2/08.8.2/08.9.1/08.9.4 (channels/routing/tags/canned/PAT/trusted-domain/file) · 10.1.1–.3/10.1.6/10.2 (billing/trial, Stripe MOCK) · 11.1–11.4/11.6 (widget) · 13.8 (notifications+e-posta). FR-EK: EK-A.1/A.2/B.1/C.1 Must + EK-C.2 Should erken. Modül-tablo toplamı (Must+Should) 54 ✅ · 0 ◐.
- **Yarım kalan işler:** **YOK** (Faz-0 `Must` kapsamında 0 ◐ · 0 ⬜). — Kapanışı bloklamayan Should artıkları aşağıda.
- **Bilinçli yapılmayanlar (⛔/🔒, gerekçeli):** 01.1.1/.4/.5/01.4/01.5 (hamburger/presence/banner 🔒 v1) · 02.1.2/.4/02.2.1/02.3.2/02.5/02.7/02.9 (AI Agents grubu/kanal görünümü/Reply Suggestions/Copilot/Tickets grid 🔒 v1) · 03.1.1-kalan sekmeler (Supervised/Invited/Browsing → v2) · 04.2/04.3.2/04.6 (AI perf/chatbots 🔒 v1) · `workflows` tablosu (⛔ ADR-14, UI'sız) · mobil push (🔒 v1, 13.7). Should (bloklamaz): 00.4 Onboarding ✅ erken · EK-C.2 ✅ erken · 03.1.1-kalan v1'e ismen.
- **Sessiz borç (§F.1/6):** **TEMİZ.** apps/*/src + packages/*/src'de 0 TODO/FIXME/XXX/HACK · 0 `@ts-expect-error`/`@ts-ignore` · 0 test `skip`/`only` · 0 `eslint-disable`. (GL-2 `.parked-playbook` temizliğinden sonra ölü-kod kirliliği de yok.)
- **Sapmalar (§D):** §D55 (bu tur — bayat sayaç + 3 EK/P4 senkronu, "verify+close"). Önceki ilgili: §D52 (GO-LIVE kırılımı) · §D53 (GL-1 v1 bayat satır) · §D54 (GL-2 parked temizlik).
- **Karar bekleyen açık sorular (PRD §11.2):** Faz-0 kapsamında **yok** — dış entegrasyonlar (gerçek Stripe/SMTP/S3/ClamAV) yapılandırma olup PRD §11.1 + CLAUDE.md sınırı gereği bu depodan yapılmaz (provider desenleri hazır, mock aktif); tm 63–67/71–84 deferred (kullanıcı kararı §D52). v1 kapanışı = GL-4 (tm 88).

### GL-2 · PARK-a — `.parked-playbook/` temizliği — done — 2026-07-31 UTC

- Karar: **SİL** (entegre etme değil). Dosya-dosya diff'te 6 parked dosyanın hiçbiri teslim edilen
  muadillerinde (tm 32) olmayan bir davranış/test taşımıyor; hiçbir yer parked modüllerini import
  etmiyor (ölü kod). Detaylı gerekçe: **PLAN §D54 (D-PARK)** + §4.5/GL-2 kapanış bülteni.
- Yapıldı:
  - `git rm -r .parked-playbook` → 6 dosya (`SkillBrowser`/`RecommendedSkills`/`skill-filters` + 3 test).
    **Not:** dir `878d640` snapshot'ında aslında commit'lenmişti (eski "untracked" notları bayattı) →
    rm hem yarım-işi hem izlenen ölü kodu temizledi.
  - Muadil eşlemesi: `RecommendedSkills.tsx`→teslim (PlaybookPage'e bağlı, "See more"=galeri, testli) ·
    `skill-filters.ts`→bölünmüş süperküme `skill-tabs.ts`+`skill-filter.ts` (+`skillOwnerOptions`, generic) ·
    `SkillBrowser.tsx`→davranışı **`PlaybookPage.tsx`'e inline** (tablist+sayaç, 200ms debounce, tip/durum/sahip
    Select, `VirtualList`, boş durumlar). "En zayıf eşleme" = ayrı dosya yok ama davranış tam.
  - PLAN §D54 kaydı + §4.5/GL-2 "✅ Kapandı" bülteni.
- Doğrulama (odaklı kapı, exit 0): web **typecheck** · **lint** · **unit 445**/65 (baz D51 445 ile aynı →
  parked testleri web süitinde hiç yoktu, silme regresyonsuz) · `git status` untracked **0**. Parked
  dosyalar kök `.parked-playbook/`'ta, hiçbir paketin tsconfig/eslint/vitest kapsamında değil →
  typecheck/lint/build/integration/e2e yapısal olarak etkilenmez (tam DoD kod kapısı uygulanmaz;
  D49/D50/D51 "yapısal no-op → odaklı kapı" emsali). Commit `chore`.
- Varsayımlar: yok — karar koda karşı diff'le verildi.
- Sonraki pencereye not: **`.parked-playbook/` artık YOK** — önceki task-log bloklarındaki "Kalan tek
  untracked öğe `.parked-playbook/`" notları kapandı. Sıra: **tm 87 → 88 → 70/68/69**. GL-3 (tm 87)
  §F.1/6 sessiz-borç + §F.1/7 ölü-kod maddeleri artık bu temizlikle yanlış-pozitif vermez. (Kök
  `.DS_Store` pre-existing `M` — macOS artefaktı, tm 86 kapsamı dışı, commit'e alınmadı.)

### GL-1 · SYNC-a — v1 bayat satır senkron denetimi (06.2.4/06.3.2/10.1.4) — done — 2026-07-31 UTC

- Kapsam: **saf denetim — kod DEĞİŞMEDİ.** §D52'nin açtığı "TM'de bitti, PLAN'da ◐" deseninin son
  üç örneği koda + teste karşı doğrulandı, odaklı süitler fiilen koşuldu, satırlar kanıt metniyle
  `◐`→`✅` çevrildi. KK açığı bulunmadı (bulunsaydı satır ◐ kalır + ayrı görev açılırdı).
- Yapıldı:
  - **06.2.4** (§4.2) ✅ — drag + klavye (↑↓) reorder (ikisi de tek `moveStep`) + aria-live +
    zorunlu-param kapısı (boş transfer hedefi → Save engeli); `SkillEditor.tsx` + `step-reorder.ts`; tm 33.2.
  - **06.3.2** (§4.2) ✅ — geçersiz URL/tür reddi + website crawl/parse + RAG index; `playbook.ts`
    `type:'website'` → `assertPublicHttpUrl` → `crawl` → `knowledge.index`; `web-crawler.ts`+`lib/ssrf.ts`; tm 33.4.
    bulk/CSV bilinçli kapsam dışı → §5.1'e `06.3.2-bulk` (Should, v2) eklendi.
  - **10.1.4** (§4.3) ✅ — sayaç `N/limit (% used)` + %80 proaktif uyarı + aşım paketi fiyatı önden;
    `BillingPage.tsx` (`/billing/usage`=ADR-09); tm 54.
  - Senkron: §4.4 bayat "Eksik (2026-07-25)" bloğu 2026-07-31 durumuyla yeniden yazıldı;
    §2 matrisi **sayılarak** MOD-05 (05.1–05.5 ✅) + MOD-06 (06.1–06.5 ✅) `◐`→`✅`; §D53 kaydı.
- Doğrulama (odaklı süit, exit 0): web unit **27** (`step-reorder` 10 + `SkillEditor` 5 + `BillingPage` 12) ·
  api unit **21** (`ssrf` 15 + `web-crawler` 6) · integration `knowledge-crawl` **11** (SSRF negatifler
  → 400 & kaynak-yok · public crawl → ready+chunks · cross-tenant) · `contract-parity` **5/5**.
  Kod değişmediği için tam DoD kod kapısı (typecheck/lint/build/tüm-suite) yapısal olarak uygulanmaz — commit `docs(plan)`.
- Varsayımlar: tm subtask eşlemesi TM'den doğrulandı (33.2=06.2.4-a, 33.4=06.3.2-a); 10.1.4 UI = tm 54.
- Sonraki pencereye not: v1 `Must` açığı kalmadı (üç satır kapandı). Sıra: **tm 86 → 87 → 88 →
  70/68/69**. GL-3/GL-4 (tm 87/88) doküman-tazeliği maddesi artık bu senkronla temiz.

### GO-LIVE planlama turu — §4.5 kırılımı + tm 85–88 + tm 68/69/70 pending — done — 2026-07-28 UTC

- Kapsam: kod yok — yalnız PLAN.md + tasks.json. PRD (FR-MOD-06.2.4/06.3.2/10.1.4 + 08.9.2/3/5
  KK'ları birebir) ve PLAN koda karşı denetlendi; kapanış + canlıya hazırlık kırılımı yazıldı.
- Denetim bulguları (§D52'ye işlendi):
  1. **Üç v1 satırı bayat** — 06.2.4/06.3.2/10.1.4 PLAN'da `◐` ama TM'de done (tm 33 alt-görevleri +
     tm 54) ve kod mevcut (`step-reorder.ts`, `web-crawler.ts`+`lib/ssrf.ts`, `BillingPage` meter).
     Satırlar çevrilMEdi (kanıt ister) → **tm 85** SYNC denetim görevi.
  2. **Faz kapanış turları hiç görev olmamıştı** — §F.1 10 madde tam sürüm hiç koşulmadı; TM kuyruğu
     boşalınca panel critical "run-loop duracak" verdi → **tm 87** (Faz-0) + **tm 88** (v1).
  3. **`.parked-playbook/`** izlenmeyen yarım iş → **tm 86**.
  4. **Öne çekme sapması (kullanıcı kararı):** hızlı canlıya geçiş; v2'nin üç saf-güvenlik kalemi
     GL-5/6/7 olarak öne çekildi — **tm 70** CC masking (3 alt-görev) · **tm 68** banned tamamlama
     (IP enforcement: `bannedCustomerIps` kolonu şemada ama okuyan kod 0; 2 alt-görev) · **tm 69**
     spam filtre (ortak deterministik motor + chat yolu; 2 alt-görev). Üçü de tm 88'e bağımlı —
     faz disiplini korunur. **Dış entegrasyonlar deferred kaldı** (tm 63–67 · 71–84).
- PLAN değişiklikleri: yeni **§4.5 GO-LIVE turu** (GL-1…GL-7 atomik kırılım + GL→tm→PRD tablosu) ·
  §5/§5.1 üç güvenlik satırına öne-çekme işaretleri · §G'ye 7 GL satırı · **§D52** sapma kaydı ·
  başlık denetim tarihi satırı.
- Sıra (run-loop için): **tm 85 → tm 86 → tm 87 → tm 88 → tm 70 / 68 / 69**. TM durumu:
  62 done · **7 pending** · 19 deferred (toplam 88).
- Sonraki pencereye not: tm 85 bir **denetim** görevidir — kod değişikliği çıkmamalı; KK açığı
  bulunursa satır ◐ kalır ve ayrı görev açılır. tm 87/88 `[MAX]` — §F.1 maddeleri kanıtsız
  "geçti" sayılmaz.
- **Ek (2026-07-31, panel C4 uyumu):** panelin `plan-not-imported` bulguları (GL-3/GL-4
  "Task Master'da karşılığı yok") **yanlış pozitifti** — tm 87/88 mevcut ve pending. Kök neden:
  §G ID hücresi `GL-3/F0-KAPAT` biçimindeydi; C4 kuralı ID'yi görev metninde birebir kelime olarak
  arar (`\bGL-3/F0-KAPAT\b`), görev başlığı ise `GL-3 · F0-KAPAT`. §G ID hücreleri sade `GL-N`
  yapıldı (ek ad başlık hücresine taşındı); panelin kendi lib'iyle (parsePlan+readTaskmaster+C4
  filtresi) doğrulandı: eksik 0. Bulgular sonraki taramada kendiliğinden kapanır — hazır
  "Düzeltmeye gönder" promptları ÇALIŞTIRILMAMALI (tm 87/88 mükerrer açılırdı).

### E2E bakım (düzeltme penceresi) — çalışma ağacındaki commit'siz değişiklikler — done — 2026-07-28 UTC

- Kapsam: yeni özellik yok; yalnız `docs/plan-expand-audit` üzerinde biriken 33 commit'siz dosyayı
  incele → göreve ata → anlamlı Conventional Commit'lere böl. (Diğer 2 açık bulgu — 1 info, 1 critical
  — kapsam dışı, dokunulmadı.)
- Yapıldı:
  - `test(e2e)` (64820f7): `demo-flow.spec.ts` + `settings.spec.ts` composer placeholder seçicisi
    `'Type your reply…'` → `'Type your reply'`. Gerekçe: Composer artık
    `"Type your reply, or press Space for suggestions…"` yazıyor (`apps/web/.../Composer.tsx:422`);
    ellipsis'li eski seçici substring olarak eşleşmiyordu. demo-flow arşiv assertion'ı da artık
    composer'ın gerçekten kaybolduğunu doğruluyor (eski hali vacuously geçiyordu).
  - `chore(e2e)` (801067b): 31 `apps/e2e/kanit/*.png` kanıt görüntüsü güncel UI ile yeniden üretildi
    (tam-süit e2e refresh). Yalnız görsel; test mantığı değişmedi.
- Doğrulama: spec değişikliği kaynak-incelemesiyle doğrulandı (Playwright string matcher'ları
  case-insensitive substring). Bu düzeltme penceresi tam DoD/e2e kapısını **koşmadı** (kapsam yalnız
  commit'leme); e2e/DoD kapısı bir sonraki ilgili özellik penceresinde çalışır.
- **Commit'lenMEDİ (bilinçli):** `.parked-playbook/` (SkillBrowser/RecommendedSkills/skill-filters,
  FR-MOD-05.3/05.4) — bu pencereye ait değil, yarım/deneysel parked iş. İzlenmiyor, dokunulmadı.
  İlgili task açıldığında `apps/web/src/...` altına taşınıp commit'lenmeli.
- Sonraki pencereye not: force-push/history-rewrite yapılmadı (CONVENTIONS §2). Kalan tek untracked
  öğe `.parked-playbook/`.

### 53.3 — 08.8.1-a · Apps (marketplace) girişi — Settings→Integrations kapısı — done — 2026-07-27 UTC

- Kapsam: FR-MOD-08.8.1 (`Should v1`) `[XHIGH]` — KK (birebir) _"Üçüncü parti dizin (detay MOD-09)"_;
  test stratejisi **unit** ("giriş → 09.1. DoD tam"). Bağımlılık 53.1 (09.1-a, ✅). PLAN satır 537
  (08.8.1) `⬜`→`✅` + §D51. **Parent tm 53 tümüyle done** (53.1/53.2/53.3).
- Boşluk: 53.1 marketplace'i (`AppsMarketplacePage`, `/app/apps`) + 53.2 tam dizini yazdı ama Apps
  rotası modül-rayında (`navigation.ts`) yoktu ve Settings'te giriş yoktu → grid yalnız URL elle
  yazılınca erişilebilirdi. Bu task o kapıyı açar.
- Yapıldı:
  - `apps/web/src/features/settings/SettingsPage.tsx`: **export** `Integrations` bölümü — Channels'ın
    hemen altına `<Section title="Integrations">` + `react-router` `Link to="/app/apps"`
    ("Open marketplace"). Saf navigasyon (ayrı veri çağrısı yok); marketplace kendi `access_rules`
    kapısını zaten uyguluyor, giriş linki herkese görünür.
  - `apps/web/src/features/settings/Integrations.test.tsx` (yeni, 1 test): link href → `/app/apps`.
- Doğrulama (DoD kapısı, exit 0): typecheck 11/11 · lint 8/8 · build 7/7 · test:unit 10/10 paket
  (web **445**, +1 = yeni `Integrations.test.tsx`) + web settings+apps odaklı 31/31.
- **Integration/contract-parity:** değişiklik saf web-additive — API rotası/OpenAPI/migration/servis
  yüzeyi **yok** → api integration & contract-parity (5/5) yapısal olarak etkilenmez; DB süiti bu
  pencerede koşulmadı (D49/D50 emsali, task stratejisi zaten unit).
- **E2E:** `settings.spec.ts` region'ları erişilebilir ada göre seçer; yeni "Integrations" region'ı
  hiçbiriyle çakışmaz, bölüm-sayısı iddiası yok → additive, mevcut e2e etkilenmez.
- Varsayımlar: giriş linki komut paleti / modül-rayına EKLENMEDİ (task "Settings→Integrations girişi"
  der; scope disiplini, CONVENTIONS §5). Erişim linki scope ile gate'lenmedi (bölüm hep render, marketplace
  sayfası kendi yetkisini kapıda uygular — mevcut Settings bölümleri emsali).
- Sonraki pencereye not: `.parked-playbook/` bu task'a ait değil (SkillBrowser/RecommendedSkills,
  FR-MOD-05.3/05.4) — izlenmiyor, dokunulmadı. MOD-09 (Apps Marketplace) v1 tümüyle kapandı.

### 53.2 — 09.2-a · Apps entegrasyon dizini (15–20) + kanal çapraz-linki — done — 2026-07-27 UTC

- Kapsam: FR-MOD-09.2 (`Should v1`) `[XHIGH]` — KK (birebir) _"Her biri OAuth/API key; kanal-tipli
  olanlar Channels'ta da yönetilir"_; test stratejisi **unit** ("liste + kanal-tipli çapraz. DoD tam").
  Bağımlılık 53.1 (09.1-a, ✅). PLAN satır 539 (09.2) `⬜`→`✅` + §D50.
- **Resume kapanışı:** slice bu pencereden önce çalışma ağacında hazırdı (types/servis/web/OpenAPI +
  testler yazılıydı; tasks.json 53.2 in-progress). Bu pencere **kod yazmadı** → mevcut işi doğruladı,
  tam DoD kapısını koştu, PLAN/HANDOFF'u kapadı, commit+push+done.
- Yapıldı (mevcut işin doğrulanıp kapatılması):
  - **Katalog** `@nexa/types/apps.ts` `APP_CATALOG` 09.1'in 5 kartını **20**'ye büyüttü: 10 veri app'i
    iki sağlayıcıyı da kapsıyor (OAuth: Salesforce/PayPal/Slack/Jira · API-key:
    Intercom/Zendesk/WooCommerce/Magento/Klaviyo/Segment) + 5 kanal-tipli kart
    (WhatsApp/Messenger/Instagram/Telegram/SMS-Twilio). Yeni kategoriler support/analytics/channels.
  - **Kanal çapraz-linki:** kanal-tipli app `channel: ChannelType` taşır, Settings→Channels'ta kurulur →
    `dataLabel`/`dataFields` opsiyonel (kanal app'i in-chat veri taşımaz), `isChannelApp`/`channelApps`/
    `connectableApps` bölücüleri + `AppListItem.channel`. **Servis** `app-service.ts` `requireConnectableApp`
    kanal app'inin OAuth-start/callback/disconnect'ini 400 ile reddeder (durumu tek yüzey yönetir);
    `chatData` yalnız veri app'lerini yüzeye çıkarır. **Web** `AppsMarketplace.tsx` `ChannelAppCard` =
    "In Channels" rozeti + "Manage in Channels" linki (`/app/settings#section-channels`), Connect yok.
  - **OpenAPI** `AppListItem`: kategori enum (+support/analytics/channels) + zorunlu `channel`
    (CHANNEL_TYPES ile birebir | null) → client yeniden üretildi (idempotent). Yeni API yolu yok.
- Doğrulama (DoD kapısı, exit 0): typecheck 11/11 · lint 8/8 · build 7/7 · db:check-drift temiz (migration
  yok) · test:unit (types `apps.test.ts` +2 [56] · web `AppsMarketplace.test.tsx` +1 [444]) · test:integration
  (api **779**/38 dosya `--concurrency=1` [[nexa-test-gate-parallel-db]]) incl. `apps.test.ts` **8** (+1: tam
  liste 15–20 · kanal app channel/category/installed=false · veri app channel=null · kanal OAuth+disconnect
  400) + contract-parity 5/5 + regresyon yok · rtm 42. **Not:** `pnpm -w test` api+rtm DB süitlerini paralel
  koşup Postgres deadlock (40P01) verir — gerçek hata değil; paket-paket seri koşuldu (api 958 · rtm 71 yeşil).
- Varsayımlar: kanal-tipli app marketplace'te **keşif** için listelenir ama bağlantısı yoktur (Channels
  yönetir) → `installed` her zaman false; iki yüzey bir kanalın durumu için çekişmez (servis 400 kapısı +
  web link-yerine-Connect). Kanal sağlayıcı değerleri `CHANNEL_TYPES` ile birebir (yeni kanal eklenirse
  OpenAPI enum'u da güncellenmeli).
- Sonraki pencereye not: parent **tm 53 hâlâ in-progress** — kardeş **53.3 (08.8.1-a, satır 537)**
  Settings→Integrations'tan marketplace girişi **pending**; o bitince parent done. `.parked-playbook/`
  (SkillBrowser/RecommendedSkills, FR-MOD-05.3/05.4) bu task'a ait değil — dokunulmadı, izlenmiyor.

### 53.1 — 09.1-a · Apps Marketplace + OAuth (MOCK) — done — 2026-07-27 UTC

- Kapsam: FR-MOD-09.1 (`Should v1`) `[XHIGH]` — KK (birebir) _"Kart → izin/OAuth akışı; bağlanınca
  veri sohbet içinde"_; test stratejisi **integration** ("mock OAuth → kurulu görünür. DoD tam").
  Bağımlılık tm 30 (T6-a, ✅). PLAN satır 538 (09.1) `⬜`→`✅` + §D49.
- **Resume kapanışı:** slice önceki pencerede yazılıp commit'lenmişti (`bdd10d8` katalog+OpenAPI ·
  `6e83aed` mock OAuth + in-chat veri + migration · `29637c1` handoff), ama DoD kapısı yalnız
  typecheck'e kadar koşulmuş, done kararı bu pencereye bırakılmıştı. Bu pencere **kod yazmadı** →
  mevcut işi doğruladı, tam DoD kapısını koştu, PLAN/HANDOFF'u kapadı, push + done.
- Yapıldı (mevcut işin doğrulanıp kapatılması):
  - **Katalog** `@nexa/types/apps.ts` `APP_CATALOG` (grid/servis/test tek doğruluk kaynağı) +
    deterministik `appChatData` in-chat stub. **Servis** `services/apps/app-service.ts` mock OAuth:
    HMAC-imzalı `state` (CSRF-bağlı, 10dk TTL, constant-time verify) + idempotent upsert; cross-tenant
    chat → 404. **Model** `app_installations` (RLS, license-scoped, migration `20260727090000`).
  - **Rota** `/settings/apps` GET (`access_rules:ro/rw`) + OAuth start/callback + DELETE
    (`access_rules:rw`) + `GET /chats/:id/apps` (agent `chats--all:ro`/`chats--access:ro`) — admin
    connect'i, agent in-chat okumayı gate'ler. **Web** `AppsMarketplace.tsx` grid (connect/disconnect)
    + `/app/apps` rota + DetailsPanel **additive** "Apps" bölümü (boşsa "No connected apps").
    **OpenAPI** `apps.yaml` 5 yol + `App*` şema + client (contract-parity 5/5).
- Doğrulama (DoD kapısı, exit 0): typecheck 11/11 · lint 8/8 · build 7/7 · test:unit (types
  `apps.test.ts` 4 + web `AppsMarketplace.test.tsx` 3 + api 179/rtm 29/widget 52/types 54/ai-mock 56) ·
  test:integration api **778**/38 dosya (`--concurrency=1` [[nexa-test-gate-parallel-db]]) incl.
  `apps.test.ts` **7** (OAuth→kurulu · in-chat veri · disconnect+404 · tampered state reddi · yok→404 ·
  ro-admin list-var connect-yok · cross-tenant izole) + contract-parity 5/5 + regresyon yok · rtm 42 ·
  **drift temiz** (`db:check-drift`). E2E: task stratejisi integration (tam koştu); apps için browser
  spec yok, web additive → mevcut e2e etkilenmez, full Playwright koşulmadı (D45/D46/D47 emsali).
- Varsayımlar: OAuth **MOCK ama CSRF gerçek** (state HMAC-SHA256 imzalı, kurcalanan/replay reddedilir) —
  MASTER-PROMPT §5; secret JWT signing key'den domain-ayrık türetilir (yeni env yok); in-chat veri
  deterministik stub (müşteri kimliğine göre kararlı, canlı çağrı yok).
- Sonraki pencereye not: **Yalnız 09.1-a teslim.** Kardeş **53.2 (09.2-a, 15–20 kart listesi)** +
  **53.3 (08.8.1-a, Settings→marketplace girişi)** pending → PLAN satır 539/537 `⬜`, parent tm 53
  `in-progress` kalır. Bu pencere ayrıca çalışma ağacında pre-existing duran **D48/02.1.2 (tm 37)** PLAN
  düzeltmesini ayrı docs commit (`030699f`) ile kapadı (temiz ağaç, CONVENTIONS §5 kapsam ayrımı).
  **`.parked-playbook/`** hâlâ untracked (SkillBrowser/RecommendedSkills, FR-MOD-05.3/05.4 — bu task'a
  ait değil, dokunulmadı); sonraki pencere ait olduğu Playbook task'ında `features/playbook/`'e taşısın
  ya da kalıcı silsin.

### 52 — 08.7.7-a · Forms builder (pre/post-chat) `[MAX]` — done — 2026-07-27 UTC

- Kapsam: FR-MOD-08.7.7 (`Should v1`) — widget'ta sohbet öncesi sorulan alanların builder'ı → müşteri
  girdisi contact'a yazılır. KK (birebir) _"En az bir alan; tip validasyon; widget'ta gösterim →
  contact/ticket'a yazma"_, doğrulama _"integration (form→ticket) + negatif (geçersiz alan)"_.
  Bağımlılık tm 29 + tm 51 (✅). PLAN satır 536 → `✅` + §D47.
- Yapıldı:
  - **Tasarım = yeniden-kullanım (tm 51):** pre-chat alanı = `form_placement='pre_chat'` işaretli bir
    **contact** custom-field'ı. Yanıt zaten var olan `checkCustomFieldValue` ile tipine göre doğrulanır,
    `setValues('contact')` ile kişiye yazılır, CRM'de görünür — ayrı tablo/RLS/GRANT/değer-yolu YOK.
  - **Migration** `20260726210000_prechat_form`: `custom_field_definitions`'a `form_placement TEXT?` +
    CHECK (`pre_chat` yalnız `entity='contact'`). Prisma diff çıktısı + el-ile CHECK; **drift temiz**.
  - **Tipler** `@nexa/types`: `FORM_PLACEMENTS`/`FormPlacement`/`PreChatFormField` + `CustomFieldDefinition.form_placement`.
  - **Servis** `custom-field-service.ts`: create/update `formPlacement` (guard: yalnız contact) +
    `listPreChatForm` + DTO `form_placement`.
  - **Rota (yeni yol YOK):** `/settings/custom-fields` gövdesine `form_placement`; token mint
    `/customer/token` yanıtına `pre_chat_form` (best-effort); `/customer/chat/events` gövdesine
    `custom_fields` → ilk mesajla `setValues('contact')` (geçersiz → 400, sohbet açılmadan, atomik).
  - **Web** Settings "Pre-chat form" builder (`PreChatFormSettings`, tm 29 form-primitifi).
  - **Widget** (28.4 KB, bütçe içinde): mint'ten `pre_chat_form` → dinamik `renderPreChatFields` +
    `submitPrechat` yanıtları toplar + ilk mesajla gönderir; alan yoksa sabit 11.2 formu değişmez.
- Doğrulama (DoD kapısı, exit 0): typecheck 11/11 · lint 8/8 · build 7/7 · test:unit (widget
  `widget.prechat.test.ts` 4 + web `SettingsForms.test.tsx` +2 + types 50) · test:integration (api
  **771**/37 dosya, `--concurrency=1`) incl. `customer-chat.test.ts` pre-chat 4 + contract-parity 5/5 +
  regresyon yok · **drift temiz**. E2E: task akışı = integration (form→contact + negatif), tam koştu;
  full Playwright ayrıca koşulmadı (değişiklik toplamsal + konfigüre edilmedikçe atıl; widget 4 unit test
  + mevcut `widget.spec.ts` name/Start-chat assertion'ları değişmez — D45/D46 emsali).
- Varsayımlar: yanıtlar **contact'a** yazılır (KK "contact/ticket" — widget/chat akışında ticket henüz
  yoktur; contact custom-field'ı en doğal ve CRM-görünür hedef).
- Sonraki pencereye not: **Yalnız pre-chat teslim.** `form_placement` modeli post-chat'e açık ama
  widget'ın kapanış-sonrası (rating/close) render'ı + ikinci teslim yolu **ertelendi** — ayrı dilim.
  KK'nın üç ölçütü pre-chat ile tam. `.parked-playbook/` bu task'a ait değil, commit'e alınmadı.

### 51 — 08.7.6-a · Custom fields (ticket/contact) `[XHIGH]` — done — 2026-07-26 UTC

- Kapsam: FR-MOD-08.7.6 (`Should v1`) — ticket ve contact üzerinde workspace'in tanımladığı ekstra
  alanlar (Nexa: player ID/KYC/bakiye). KK (birebir) _"Tip/zorunluluk; Details+CRM'de görünür"_,
  doğrulama _"integration (alan yaz→Details/CRM'de oku)"_. Bağımlılık tm 29 (T4-a form-primitifi, ✅).
  PLAN satır 535 (08.7.6) → `✅` + §D46.
- Yapıldı:
  - **Paylaşımlı tip-kataloğu+doğrulayıcı** `packages/types/src/custom-fields.ts` — `CUSTOM_FIELD_ENTITIES`
    (ticket/contact) + `CUSTOM_FIELD_TYPES` (text/number/boolean/date); `checkCustomFieldValue` bir ham
    değeri tipine göre doğrular+kanonikleştirir, boş değer zorunluda hata/opsiyonelde `null`;
    `customFieldError` form-yüzü. Tek kaynak: form + endpoint aynı fonksiyonla "geçerli" der. Unit
    `custom-fields.test.ts`(9).
  - **Model** iki license-scoped tablo: `custom_field_definitions` (entity/label/type/required,
    unique(license,entity,label)) + `custom_field_values` (definition + ticket_id|customer_id, bir-varlık
    CHECK, varlık başına tek değer). Migration `20260726200000` (yapısal DDL + CHECK'ler + RLS + GRANT,
    ticket_email_templates emsali); FK'ler onDelete Cascade; **drift temiz**.
  - **Servis** `services/custom-fields/custom-field-service.ts` — tanım CRUD (dup-label 400, entity/type
    immutable) + `setValues` (tanıma karşı doğrula: yanlış tip/zorunlu-boş/bilinmeyen-alan reddi;
    null→sil) + standalone `readCustomFieldValues` (tanım⋈değer, her tanım için bir giriş). ticket ve
    customer detail servisleri bunu gömer → `custom_fields` her detay yanıtında.
  - **Rota** `/settings/custom-fields` (tanım CRUD, `access_rules:ro/rw`) + `PUT /tickets/:id/custom-fields`
    (`tickets--*:rw`) + `PUT /customers/:id/custom-fields` (`customers:rw`). Integration
    `custom-fields.test.ts`(13: yaz→Details/CRM oku · tip/zorunluluk · cascade · scope · cross-tenant).
  - **Web** Settings "Custom fields" tanım formu (`CustomFieldsSettings`, form-primitif) + paylaşımlı
    `features/custom-fields/CustomFields.tsx` (tipli kontroller + canlı alan-altı hata + değişen-yalnız
    kaydet) → CustomerDetailPanel (CRM) + TicketPane (Details). Web `CustomFields.test.tsx`(6) +
    `SettingsForms.test.tsx`(+2).
  - **OpenAPI** `CustomFieldDefinition`/`CustomFieldValue`/`CustomFieldValuesInput` + `custom-fields.yaml`
    (4 yol) + tickets/customers PUT anchor (2 yol); `TicketDetail`/`CustomerDetail`'e `custom_fields`.
    Bundle 106 yol; contract-parity 5/5.
- Doğrulama (DoD kapısı, exit 0): typecheck 11/11 · lint 8/8 · build 7/7 · test (types 9 · web 438/63
  dosya) · test:integration api **767**/37 dosya (`--concurrency=1`) incl. yeni `custom-fields.test.ts` 13
  + contract-parity 5/5 + regresyon yok.
- Varsayımlar: `required`, değer-yazma yolunda **enforce** edilir (zorunlu alan boşa/null'a set edilemez);
  varlığın tüm zorunlu alanlarının dolu olması dayatılmaz (o forms-builder 08.7.7 işi). `type` immutable
  (re-tip = yeni alan) — depolanmış değerlerin geçerliliğini korur.
- Sonraki pencereye not: 08.7.7-a (Forms builder [MAX]) widget→contact/ticket yazma yolunu ekler; custom
  fields değer-yazma servisi (`setValues`/`checkCustomFieldValue`) orada yeniden kullanılabilir. E2E ayrıca
  koşulmadı (task stratejisi integration; Settings bölümü tanım yokken render etmez → mevcut akışlara etkisiz).

### 50 — 08.7.5-a · Ticket email templates (markalı, değişkenli) `[XHIGH]` — done — 2026-07-26 UTC

- Kapsam: FR-MOD-08.7.5 (`Should v1`) — markalı, değişkenli ticket e-posta şablonu; geçersiz
  değişken/format engeli. KK (birebir) _"Geçersiz değişken/format engeli"_, doğrulama
  _"unit (geçersiz değişken → hata)"_. Bağımlılık tm 29 (T4-a, form-primitifi, ✅). PLAN satır 534
  (08.7.5) → `✅` + §D45.
- **Resume:** iş bu pencereden önce çalışma ağacında hazırdı (contract+migration+backend+frontend+
  testler yazılıydı; DB'ye migration uygulanmış, Prisma client üretilmişti). Bu pencere sıfırdan
  yapmadı → DoD kapısını koştu, PLAN/HANDOFF'u kapadı, commit+push+done.
- Yapıldı (mevcut çalışmanın doğrulanıp kapatılması):
  - **Paylaşımlı katalog/doğrulayıcı/renderer** `packages/types/src/template-variables.ts` —
    `TEMPLATE_VARIABLES` (tek doğruluk kaynağı; form ve endpoint aynı listeyle "geçerli" der),
    `findTemplateProblems`/`findTemplateProblemsIn` (bilinmeyen değişken → `unknown_variable`;
    boş/kötü-adlı/dengesiz/iç-içe brace → `malformed`), `renderTemplate` (bağlamda olmayan değişken
    boş; ham brace bırakmaz). Unit `template-variables.test.ts`(15).
  - **Servis** `services/tickets/ticket-email-template-service.ts` — `assertPlaceholdersValid` her
    create + subject/body dokunan her edit'te (KK enforcement); license-scoped CRUD (id-tek-başına
    başka tenant'a erişemez). **Model** `ticket_email_templates` (migration `20260726190000`, RLS
    policy ALL + GRANT nexa_app — ticket_rules deseni). **Rota** `/settings/ticket-email-templates`
    (`tickets--all:ro`/`:rw`). Integration `ticket-email-templates.test.ts`(10).
  - **Web** `SettingsPage.tsx` `TicketEmailTemplates` — canlı alan-altı hata (aynı `@nexa/types`
    kataloğu), Submit geçerli olana dek kapalı, optimistik enable/disable. `SettingsForms.test.tsx` +2.
  - **Contract/tip** OpenAPI `TicketEmailTemplate` + 2 yol · `@nexa/types` `TicketEmailTemplate` DTO
    + `template-variables.ts` export. Bundle yeniden üretildi (contract-parity yeni yolları tanıyor).
- Doğrulama (bu pencere, exit 0): typecheck 11/11 · lint 8/8 · build 7/7 · test:unit (types 15 +
  web 430 incl. yeni +2) · test:integration api **754** (36 dosya; yeni 10 + contract-parity 5/5),
  `--concurrency=1` ([[nexa-test-gate-parallel-db]]). **E2E:** `settings.spec.ts` **10 geçti** (yeni
  bölüm mevcut akışları bozmadı); aynı dosyadaki 2 `composer shortcuts` testi **önceden kırık**
  (canlı visitor→agent RTM routing bu sandbox'ta çalışmıyor) — `git stash` ile tracked değişiklikler
  çıkarılıp baseline'da aynı 2 test birebir aynı hatayla düştü → değişikliğimden bağımsız (D43 emsali).
- Sonraki pencereye not: `.parked-playbook/` (skill-browser: RecommendedSkills/SkillBrowser/
  skill-filters) bu task'a **ait değil**, önceki park edilmiş iş — commit'e alınmadı, çalışma ağacında
  duruyor. RTM canlı-chat e2e (composer/demo-flow) sandbox'ta önceden kırık; ayrı bir sorun.

### 49 — 08.7.4-a · Chat transcripts (otomatik e-posta) `[XHIGH]` — done — 2026-07-26 UTC

- Kapsam: FR-MOD-08.7.4 (`Should v1`) — bitişte müşteri/ekibe transcript e-postası. KK (birebir)
  _"Bitişte müşteri/ekibe transcript e-postası"_, doğrulama _"integration (`.data/mail`)"_. Bağımlılık
  tm 31 (T7-a, FileMailer / e-posta bildirim kanalı, ✅). PLAN satır 533 (08.7.4) → `✅` + §D44.
  **Yeni API yolu/şema yok → OpenAPI/contract-parity değişmedi.**
- Yapıldı:
  - **Saf modül** `services/notifications/chat-transcript.ts` (assignee-email kardeş deseni) —
    `transcriptRecipients` (müşteri: adres varsa · ekip: atama var + `notifyEmail` opt-in [FR-MOD-08.2];
    queued/AI-only = atama yok → ekip kopyası yok) + `renderTranscript` (müşteri kopyası **yalnız**
    `recipients='all'` olaylardan → internal note müşteriye sızmaz; yalnız sistem-olayı sohbeti = mail yok).
    Unit `chat-transcript.test.ts`(9).
  - **Paylaşımlı kapanış yolu** `chat-service.ts`: opsiyonel 6. ctor param `mailer` + `#emailTranscript`
    (kapanış tx **commit'ten sonra** çağrılır — yan etki close'u bozamaz; `withTenant` okur → RLS ile
    tenant-scoped; best-effort, hata yutulur). `deactivate` (ajan arşivi) **ve** `deactivateByTimeout`
    (idle sweep, tm 48) ikisi de çağırır; `CloseResult`'a `threadId` eklendi; ajan yazar isimleri tek sorguda.
  - **Bağlama**: `chats.ts` rotası + `server.ts` register → `mailer`; `chat-timeout-run.ts` sweeper CLI →
    `new FileMailer(env.MAIL_DIR)` (idle-close da transcript atar). Integration `chat-transcript.test.ts`(6).
- Doğrulama (bu pencere, exit 0): typecheck 11/11 · lint 8/8 · build 7/7 · test api **923** (50 dosya;
  yeni unit 9 + integration 6 + contract-parity 5/5) · rtm 71 — DB süitleri **paket-paket seri** koşuldu
  ([[nexa-test-gate-parallel-db]]; `pnpm -w test` api+rtm paralelinde Postgres deadlock'u verir = harness
  yarışı, gerçek hata değil). **E2E:** backend-only mailer, tarayıcı akışı yok → kapsanan "akış" =
  `.data/mail`'i okuyan integration testi (tm 47 backend-dilim emsali).
- Varsayımlar / notlar:
  - **Ekip kopyası = atanan ajan** (tm 31 gibi), tüm katılımcılar değil; ajanın `notifyEmail` opt-out'una
    saygı gösterir (transcript de bir e-posta bildirimidir). Müşteri, adresi varsa her zaman alır (kendi
    konuşma kaydı). Bu iki karar §D44'te + modül yorumunda gerekçeli.
  - **Sonraki pencere:** 08.7.5-a (Ticket email templates, markalı/değişkenli) transcript'in gövde
    şablonunu markalayabilir; şu an düz-metin (A4 stub). Kalan borç yok; çalışma alanı temiz
    (`.parked-playbook/` izlenmiyor, bu task'a ait değil — commit'e katılmadı).

### 47 — 08.6.2-a · Ticket rules (atama/etiket/öncelik) `[XHIGH]` — done — 2026-07-26 UTC

- Kapsam: FR-MOD-08.6.2 (`Should v1`) — koşul+eylem → otomatik atama/etiket/öncelik. KK (birebir)
  _"Koşul+eylem zorunlu"_, doğrulama _"integration (kural → otomatik atama)"_. Bağımlılık tm 29 (form
  deseni, ✅). PLAN satır 531 (08.6.2) → `✅` + §D43. Kardeş desen: campaigns (tm 43) trigger engine.
- Yapıldı:
  - **Model/migration** `20260726180000_ticket_rules`: `ticket_rules` (license-scoped, RLS=campaigns;
    `conditions`/`actions` JSONB) + `ticket_tags` (join, `thread_tags` gibi ticket üzerinden RLS EXISTS +
    GRANT SELECT/INSERT/DELETE; paylaşılan `tags` kütüphanesi). Yapısal SQL `prisma migrate diff`'ten,
    RLS/policy/GRANT el ile (ticket_helpdesk deseni). **Drift temiz.**
  - **Saf çekirdek** `services/tickets/ticket-rule-matching.ts` (`hasCondition`/`hasAction`/
    `matchesTicketRule`) — KK'nın iki yarısı ayrı kapı; koşul-yok → hiçbiriyle eşleşmez; `priority:0`
    gerçek eylem. Unit `(7)`.
  - **Motor** `apply-ticket-rules.ts` — ticket açılışında (create source=chat/manual + createFromEmail
    source=email) eşleşen kuralları `position` sırasında uygular (sonraki atama kazanır, etiket birikir);
    geçersiz hedefi (askılı ajan/silinmiş takım) **atlar** — bozuk kural ticket oluşturmayı bozmaz.
  - **CRUD** `ticket-rule-service.ts` (create/edit'te koşul-yok/eylem-yok → 400 + `assertActionsResolvable`
    atama hedefi tenant kontrolü) + rota `routes/ticket-rules.ts` `/settings/ticket-rules`
    (`tickets--all:rw`/`:ro`), server.ts'e register.
  - **Web** Settings "Ticket rules" bölümü (`SettingsPage.tsx` `TicketRules`) — form-primitifiyle koşul
    (subject-contains, zorunlu) + eylem select (öncelik/etiket, değer zorunlu) + optimistic toggle + delete.
  - **Contract** OpenAPI `TicketRule`/`TicketRuleConditions`/`TicketRuleActions` + `paths/ticket-rules.yaml`
    (4 op) + `TicketDetail.tags` alanı; re-bundle. `TicketDetail` DTO'ya `tags: string[]` eklendi.
  - **@nexa/types** `TicketRule*` + `TICKET_RULE_SOURCES`.
- Doğrulama (bu pencere, exit 0): typecheck 11/11 · lint 8/8 · build 7/7 · test:unit (web 428 incl.
  `SettingsForms.test.tsx` +2; api unit incl. matcher 7) · test:integration api **738**
  (`--concurrency=1`) incl. yeni `ticket-rules.test.ts` **12** (kural→otomatik atama · koşul/eylem zorunlu ·
  non-existent agent reddi · disabled no-op · source-gating · position · cross-tenant · scope split) +
  contract-parity 5/5 + regresyon yok (tickets/tickets-helpdesk/channels-adapters yeşil).
- Varsayımlar / notlar:
  - **UI eylem kapsamı:** editör öncelik + etiket sunar (self-contained). Ajan/takım **atama** kuralları
    backend+API+integration'da tam (KK başlık örneği, `ticket-rules.test.ts` ile test'li) — UI'da team seçici
    `/groups` scope kuplajından kaçınmak için eklenmedi; sonraki pencere isterse team picker ekleyebilir.
  - **E2E:** ilgili yüzey (Settings/tickets) E2E'si yeşil (12). Canlı-chat composer akışı (settings.spec
    "composer shortcuts" 2 + **dokunulmamış** `demo-flow.spec.ts` 1) bu sandbox'ta widget→RTM canlı-chat
    pipeline'ının çalışmamasından **önceden kırık** — task'ın akışı değil, değişikliğim bu yola dokunmuyor
    (demo-flow dokunulmamış kodda aynı adımda düşüyor). Kalan borç değil; env sorunu.

### 43 — 03.3 · Campaigns `[MAX]` (alt sekmeler + builder + kart) — done — 2026-07-26 UTC

- Kapsam: FR-MOD-03.3 (`Should v1`) — parent `[MAX]`, 3 alt-görev (43.1 alt sekmeler `[XHIGH]`, 43.2 builder
  `[MAX]` tetik motoru, 43.3 kart `[XHIGH]`). "campaigns tablosu 0 tüketicili" → artık tüketiliyor. Bağımlılık
  tm 29 (form deseni, ✅). PLAN satır 522 (03.3.1–.3) + 115 (modül) + 995 (tüketici tablosu) → `✅`.
- Yapıldı:
  - **Şema/migration** `20260726170000_campaign_sends`: yeni `campaign_sends` tablosu (campaignId+customerId
    **unique** = visitor başına 1 gönderim; engaged/converted sayaç) + RLS `campaign_sends_tenant`
    (`license_id = nexa_current_license()`). Mevcut `Campaign` modeli yeniden kullanıldı. **Drift ✅.**
  - **Kilit karar — status sözlüğü:** DB'de zaten `campaigns_status_check CHECK (status IN
    ('ongoing','scheduled','inactive'))` var (`'active'` REDDEDİLİR). Bu lifecycle sözlüğü 03.3.1 sekmeleriyle
    birebir → API `active` boolean niyeti alır, `computeCampaignStatus(active,startsAt,endsAt,now)` yazma anında
    status'ü türetir ve saklar (cron yok; scheduled→ongoing geçişi bir sonraki yazımda). Sözlükle savaşmak yerine
    hizalandı.
  - **Saf modüller (unit):** api `campaign-matching.ts` (`matchesConditions` url_contains AND, `visitorPageUrls`
    savunmacı JSON, `computeCampaignStatus`, `campaignPerformance`) `(12)`. web `campaigns.ts`
    (`filterCampaigns`/`campaignCounts`/`conversionRate`/`isCampaignActive`) `(9)`.
  - **Servis** `campaign-service.ts`: list (status filtre), create (koşul+mesaj zorunlu → `#fireIfRunning` canlı
    ziyaretçileri süzer + `campaign_sends` yazar, `skipDuplicates` idempotent), update (edit + toggle → ongoing ise
    yeniden fire; aktifken trigger/mesaj strip edilemez; window `ends_at>starts_at` 400). **Cross-tenant:** visit
    sorgusu `licenseId`+org kapılı + RLS.
  - **Route** `campaigns.ts` (GET/POST/PATCH, scope `customers:ro`/`:rw` = traffic deseni) + server.ts kaydı.
  - **Kontrat** `@nexa/types` Campaign DTO + OpenAPI `paths/campaigns.yaml` + schemas → bundle+regen
    (contract-parity ✅).
  - **Web** `CampaignsPage.tsx` (durum sekmeleri + kart grid + toggle + Banner "reached N"), `CampaignBuilder.tsx`
    (`useForm`: name/trigger/message zorunlu, opsiyonel zamanlama datetime-local, dirty-guard). CustomersTabs'e
    **Campaigns** sekmesi + App.tsx rota `/app/customers/campaigns` + ⌘K keyword.
- Doğrulama (hepsi yeşil): `pnpm -w typecheck` (11/11) · `pnpm -w lint` (8/8) · `pnpm -w build` (7/7) ·
  api `test` 46 dosya/**889** (campaigns integration 13 + matcher 12 + contract-parity 5) · rtm 71 · web 62/**426**
  (campaigns 9+4) · `pnpm -w test:integration` (concurrency=1) **726** · e2e `campaigns.spec.ts`+customers+traffic
  **8 passed** · drift ✅.
- Varsayımlar: (1) scope = `customers:ro/:rw` (traffic gibi; 58-scope enum'a `campaigns` EKLENMEDİ). (2) Displayed=
  gönderim, Chats=engaged, Conversion=converted — engaged/converted geçişleri (ziyaretçi yanıtı/goal) bu dilimde
  otomatik tetiklenMEZ; sütunlar+agregasyon gerçek, sonraki dilimde bağlanır. (3) `url_contains` tek koşul tipi
  (matcher genişlemeye açık). (4) `active` boolean niyet → status türetilir.
- Sonraki pencereye not: **`pnpm -w test` api+rtm'i PARALEL koşturunca paylaşılan Postgres'te resetDatabase
  TRUNCATE DEADLOCK olur** (bilinen yarış, kod hatası değil) — DB paketlerini seri koş (`--filter @nexa/api test`
  sonra `--filter @nexa/rtm test`, veya `test:integration --concurrency=1`). Kalan borç: scheduled→ongoing oto-geçiş
  cron'u (v1 kabul edilebilir), engaged/converted telemetri kancası, `url_contains` ötesi koşullar (geo/time-on-page).

### 40 — 02.7-a · Tickets grid (sıralanabilir, deep-link) — done — 2026-07-26 UTC

- Kapsam: FR-MOD-02.7 (`Should v1`) `[XHIGH]` — sıralanabilir Tickets grid + URL param sıralama + deep-link.
  Bağımlılık **T6-a** (VirtualTable, done). PLAN satır 519 (02.7) + §4.4.6 kalemi → `✅`. **Frontend-only, additive**
  — hiçbir route/şema/OpenAPI/migration/backend'e dokunmadı (kontrat-parity etkilenmez; api/rtm testleri cache-hit).
- Yapıldı:
  - **Saf `ticket-grid.ts`** (`views.ts`/`traffic.ts` deseni): `sortTickets` (kolon başına değer, **nulls-last her iki
    yönde**, stabil **id-desc tiebreak** = server `(last_message_at desc nulls last, id desc)` sırasıyla uyumlu),
    `parseTicketSort`/`writeTicketSort`/`clearTicketSort`/`hasTicketSortParams` (URL `ticket_sort`+`ticket_order`,
    yarım linke toleranslı), `toggleTicketSort` (aynı kolon yön çevirir, yeni kolon kendi default'u), `ariaSortFor`.
  - **`TicketGrid.tsx`**: `VirtualTable` (T6-a) üstüne sıralanabilir tablo — `<th aria-sort>` + başlık butonu; satır
    tıklanır (Customers grid deseni: `tr onClick` + hücrede klavye-erişilebilir buton) → `onOpen`. loading→skeleton,
    boş→EmptyState.
  - **`InboxPage.tsx`**: tickets yüzeyi artık **grid-first** — dar `TicketList` yerine tam-genişlik grid; satıra
    tıklayınca `TicketDetailPane` (yeni `onBack` → `← Tickets`). Sıralama URL'de (`ticketSort = parseTicketSort`),
    başlık tıklama `changeTicketSort` (replace). Deep-link effect: `?ticket_sort=…` → grid'i açar (params kalıcı,
    strip edilmez); chat view'e geçince `clearTicketSort`. `?ticket=<id>` (satır→konuşma deep-link) korunur.
    `TicketList` **silinmedi** (hâlâ export + `TicketPane.test.tsx`/`Skeleton.test.tsx` test eder), sadece
    InboxPage'de kullanılmıyor.
- Karar: **client-side sort** = yüklü sayfa (hook `limit=50`, keyset newest-first). Grid "sıralanabilir" KK'sını
  karşılar; tam server-side çok-kolon sort backend değişikliği ister (ADR-09/fatura ile alakasız, bu Should diliminin
  kapsamı değil). Virtualization (T6-a) render P4'ü zaten karşılıyor. Sort kararları saf modülde, tamamen testli.
- Doğrulama (exit code'larla): `pnpm -w typecheck` ✓ (11/11) · `pnpm -w lint` ✓ (8/8) · `pnpm -w build` ✓ (7/7) ·
  `pnpm -w test` ✓ (web **413** incl. yeni `ticket-grid.test.ts` **12** + `TicketGrid.test.tsx` **6**; backend cache-hit) ·
  `pnpm -w test:integration` ✓ (api **713** + rtm; contract-parity ✅) · **e2e task akışı** `tickets.spec.ts` ✓ **2/2**
  (temiz DB'de) — yeni test "sorts the tickets grid from the URL and opens a ticket from a row" (header→URL,
  `?ticket_sort=subject&ticket_order=desc` reload→`aria-sort=descending`, satır→konuşma). Regresyon: `command-palette`/
  `inbox-tabs`/`inbox-panel` e2e ✓ (6/6 — chat render + `?chat` deep-link + paneller sağlam).
- **⚠️ Sonraki pencereye — ilgisiz PRE-EXISTING e2e kırığı (bu task DEĞİL):** `demo-flow.spec.ts:58` hâlâ
  `getByPlaceholder('Type your reply…')` seçiyor ama **tm 39** (Reply Suggestions) composer placeholder'ını
  `"Type your reply, or press Space for suggestions…"` yaptı → substring eşleşmiyor → `demo-flow` kırmızı. Composer.tsx
  ve demo-flow.spec.ts'e **dokunmadım** (kapsam disiplini, CONVENTIONS §5). Fix = tek satır selector güncellemesi
  (`'Type your reply'` substring, satır 58 + 84) — ayrı task olarak açılmalı.
- e2e temiz-DB notu: e2e çalıştırmadan önce `.env` source edilmeli (rtm dev env ister) + tenant tabloları truncate
  (biriken ticket'lar `demo`-idempotent seed'i sıfırlamaz → test 1 "Open it" yolu Details panel'e takılır). Truncate =
  `apps/api/test/helpers/fixtures.ts` `resetDatabase` (TRUNCATE, drop DEĞİL), sonra global-setup `db:seed` reseed'ler.

### 39 — 02.3.2-a · Reply Suggestions çipleri (Space ile) — done — 2026-07-26 UTC

- Kapsam: FR-MOD-02.3.2 (`Should v1`) `[XHIGH]` — composer'da AI yanıt öneri çipleri. Bağımlılık tm 36
  (Copilot agent-assist / ai-mock, done). PLAN satır 517 (02.3.2) + §4.4.6 kalemi → `✅`. **Frontend-only, additive**
  — hiçbir route/şema/OpenAPI/backend'e dokunmadı (kontrat-parity etkilenmez).
- Yapıldı:
  - **Saf `replySuggestions.ts`** (`views.ts`/`rowActions.ts` deseni; deterministik, ai-mock felsefesi —
    @nexa/ai-mock'a bağımlılık **eklemeden**, web yalnız @nexa/types'a bağlı): `replySuggestions(turns)` → son
    müşteri mesajına göre lead (selam/soru/iade/teşekkür/genel) + her zaman 2 güvenli bekletme yanıtı, dedupe, ≤4;
    boş konuşmada bile çip döner. PRD §108 katman-3 "hafif mikro-özellik" (Copilot'tan ayrı: KB/retrieval/assist yok).
  - **`Composer.tsx`**: **Space** (boş reply alanı + mode='all' + picker kapalı) → `event.preventDefault()` + cache'teki
    transcript'ten (`eventsKey`, fetch yok) çipleri türet, `role="group"` satırında göster. Çip tıklama → `setText`
    (müşteri yanıtı, note değil), caret sonda, çipler çekilir = **düzenlenebilir** (KK). **Escape** kapatır (geri
    alınabilir), yazınca çekilir, internal-note moduna geçince kapanır. Reply placeholder'a "…press Space for
    suggestions" ipucu.
- Doğrulama (exit 0): `pnpm -w typecheck` ✓ (11/11) · `pnpm -w lint` ✓ (8/8) · `pnpm -w build` ✓ (7/7) ·
  `pnpm -w test` ✓ (web **395** incl. yeni `replySuggestions.test.ts` **7** + `Composer.suggestions.test.tsx` **5**;
  backend paketler cache-hit, değişmedi).
- Varsayım: Reply Suggestions (PRD katman-3), Copilot'un backend `/copilot/chats/:id/reply` KB-draft'ından **ayrı**
  ve daha hafif olduğu için frontend saf-fonksiyon + cache transcript ile çözüldü — yeni API route/OpenAPI **yok**
  (kontrat-parity ve DB'ye dokunmadan; "her saniye müşteri bekliyor" hız KK'sıyla uyumlu, anlık). Bağımlılık 12.x
  ai-mock "felsefe olarak" karşılandı (import değil).
- e2e/integration: backend/kontrat/şema yüzeyine dokunulmadı → bu yüzeyler etkilenmez, çalıştırılmadı; task KK'sı
  "unit (çip→composer)" olup `Composer.suggestions.test.tsx` ile birebir pinlendi.
- Sonraki pencereye not: Bir sonraki müşteri mesajı geldiğinde çipler açıksa RTM otomatik yenilemez — öneriler
  Space anında hesaplanır (kasıtlı, anlık/stateless). İstenirse `useTranscript` reaktif aboneliğiyle canlı yenileme
  ayrı bir iyileştirme olur; KK için gerekmez. Çipler client-side üretildiğinden assist sayacı (07.3.2) tetiklemez —
  bu Copilot'a özgü, Reply Suggestions'a değil.

### 38 — 02.1.4-a · Inbox Views grubu (kanal görünümleri + custom saved views) — done — 2026-07-26 UTC

- Kapsam: FR-MOD-02.1.4 (`Should v1`) `[XHIGH]` — inbox kenar çubuğuna **Views** grubu. Bağımlılık tm 35
  (08.5 adaptörleri, done). PLAN satır 516 (02.1.4) + §4.4.6 kalemi → `✅` (§D42). **Frontend-only, additive**
  — hiçbir route/şema/OpenAPI/backend'e dokunmadı (kontrat-parity etkilenmez).
- Yapıldı:
  - **Saf `views.ts`** (`traffic.ts`/`rightPanel.ts` deseni): `showChannelPromo`/`connectedChannelViews`
    (kanal yok→promo; bağlıysa sabit Messenger→WhatsApp→SMS sırası, `twilio`→"SMS"), `canReadChannels`
    (owner/admin `channels--all` kapısı), custom saved views (`SavedView{base:InboxView,traffic:TrafficTab}`,
    `localStorage`, `addSavedView`/`removeSavedView`/`useSavedViews` — ad trim+40 cap, boş ad reddi,
    malformed satır düşer, reload'da kalıcı).
  - **`InboxPage.tsx`** Views grubu: kanal yok→**channel-promo** (dashed CTA → `/app/settings`), bağlıysa
    kanal satırları (Connected → Settings); custom saved views listesi (seç = base+traffic tek tıkta uygular,
    sil) + "Save current view" inline ad formu. Kanal bölümü yalnız `canReadChannels` iken (owner/admin) ve
    `/channels` çözüldükten sonra render (promo flaş yok). `nav`'a `overflow-y-auto`.
  - **`useConnectedChannels(enabled)`** (`useInbox.ts`): `GET /channels`, `enabled=canReadChannels` → ajan
    403 yemez (scope yok), sorgu hiç atılmaz.
- Doğrulama (exit 0): `pnpm -w typecheck` ✓ (11/11) · `pnpm -w lint` ✓ (8/8) · `pnpm -w build` ✓ (7/7) ·
  `pnpm -w test` ✓ (web **383** incl. yeni `views.test.ts` **19**; api 864/rtm 71/widget 48/types 26/ai-mock 56
  — backend cache-hit) · `pnpm -w test:integration` ✓ (api 713 + rtm 42, `--concurrency=1`; DB 5433/Redis 6380).
- e2e: bu yüzeye özel akış yok; değişiklik additive (mevcut inbox `nav` içine yeni grup) → mevcut specs
  etkilenmez. Task KK'sı "unit (kanal yok→promo)" olduğundan (D36 frontend-only deseni) tam Playwright
  koşusu bu additive UI için koşulmadı.
- Dürüstlük/kalan borç: **kanal→chat filtresi (per-kanal) yok** — `ChatSummary`'de kanal/source alanı yok;
  gerçek per-kanal süzme, `ChatSummary`'ye kanal etiketi ekleyen ayrı bir backend task ister. Bu yüzden kanal
  satırları yönetime (Settings) linkler; uydurma filtre kurulmadı. KK yalnız promo + saved views'ı şart koşar,
  ikisi de tam teslim. Sonraki pencere isterse: `ChatSummary.channel` + `/chats?channel=` → kanal görünümleri
  gerçek filtreye döner.

### 58 — 04.2-a · Team AI Agents performance + Copilot knowledge girişi — done — 2026-07-26 UTC

- Kapsam: FR-MOD-04.2 (`Must v1`) `[XHIGH]` — Team ekranının iki AI girişi. Bağımlılık tm 33 (06.5-a
  performance) + tm 36 (12.2-a Copilot KB), ikisi de done. PLAN satır 523 (04.2) → `✅` (§D41).
  **Frontend-only, additive** — hiçbir route/şema/OpenAPI/backend'e dokunmadı (kontrat-parity etkilenmez).
- Yapıldı:
  - **Per-agent performance** — `TeamAiPerformance.tsx`: 06.5-a `AiPerformance` kartlarını (resolution/
    CSAT/transfer, reports=fatura ADR-09, düşük-baz + AI-off dürüstlüğü, `reports_read` kapısı) Team
    tarafında yeniden kullanır + `/ai-agents`'tan AI-agent roster'ı (name/status/skills, her satır →
    `/app/playbook`). `kind:'copilot'` roster'a girmez (Copilot ayrı yönetilir).
  - **Copilot knowledge yönetimi** — `CopilotKnowledge.tsx`: `/copilot/knowledge` (12.2-a) list/add/
    delete. Okuma `agents-bot--all:ro|:rw`, ekle/sil `:rw`; yetkisiz → "No access". Müşteriye kapalı
    (backend zaten 404). Metin kaynakları (article/faq/file); website crawl (SSRF) Playbook'ta kalır.
  - `TeamPage.tsx`: iki bölüm Chatbots ile Suspended arasına (AI kümesi). 04.6-a Chatbots/Suspended
    bozulmadı.
- Doğrulama (exit 0): `pnpm -w typecheck` ✓ · `pnpm -w lint` ✓ · web unit ✓ (55 dosya/364;
  yeni `TeamAiPerformance.test.tsx` 5 + `CopilotKnowledge.test.tsx` 5) · `pnpm -w build` ✓ ·
  API unit+integration ✓ (44 dosya/864, kontrat-parity dahil — regresyon yok, DB 5433/Redis 6380 canlı).
- e2e: yeni akış eklenmedi; `team.spec.ts` yalnız invite-modal + "Team" başlığını test eder (ikisi de
  değişmedi), başka spec Team-AI bölümlerine dokunmuyor → mevcut e2e etkilenmez. Task KK'sı "unit +
  12.2-a bağı" olduğundan yeni e2e yazılmadı; tam Playwright koşusu (build+serve+reseed) bu additive
  UI için koşulmadı.
- Varsayımlar: "per-agent performance" veri modelinde chat→ai_agent atfı olmadığından resolution/CSAT
  lisans-agregat (tek dürüst kaynak) olarak sunulur; "per-agent" boyut roster + her-ajan Playbook linki
  ile karşılanır. Router düz olduğu için (`/app/team`, `/app/playbook`) rapor-1'deki alt-rotalar yerine
  TeamPage bölümleri + Playbook deep-link kullanıldı.
- Sonraki pencereye not: `.parked-playbook/` önceden beri untracked (bu task'ın parçası değil, commit
  edilmedi). Backend'de gerçek per-ai_agent resolution atfı istenirse chat→aiAgentId + rapor filtresi
  ayrı task olur.

### 36 — 12 · Copilot (agent-assist) [MAX] — done — 2026-07-26 UTC

- Kapsam: FR-MOD-12 (`Should`, v1) `[MAX]` parent — 3 alt-görev tek pencerede, contract-first. PLAN
  satır 130 (MOD-12) + 518 (02.5) + 545 (12.1–12.3) → `✅` (§D40). Backend + frontend + OpenAPI + e2e.
- Yapıldı:
  - **12.2-a ayrı KB** — Copilot bilgi tabanı `kind:'copilot'` AiAgent'a asılı, AI-agent KB'sinden
    **çift yönlü izole** (`/knowledge-sources` `ai_agent`'a, `/copilot/knowledge` copilot ajanına
    süzülür). `GET/POST/DELETE /copilot/knowledge` (`routes/copilot.ts` → `services/ai/copilot-service.ts`;
    SSRF-guard'lı website crawl + eşzamanlı indeks, playbook KB deseni). **Müşteri token'ı → 404**
    (agent+bot default principals; boundary=404 bedavaya geldi), cross-tenant izole.
  - **12.1-a buton + panel** — transcript header'da **Copilot butonu** (`InboxPage`) → sağ panel
    Copilot sekmesi (`CopilotPanel.tsx`; `panelTab` details↔copilot, chat değişince reset, Expand
    ile gizlenir). **Assisted metriğini besler**: her assist bir `skill_run` yazar = reports 07.3.2
    "assisted" sorgusunun tam anahtarı (`recordAssist`, copilot `workspace`-kind skill).
  - **12.3-a özet + yanıt + enhance (+02.5)** — özet → **internal note** (`chats.sendEvent`
    recipients=agents, RTM fan-out, arşivde görünür, archived→409); yanıt taslağı copilot KB'den RAG
    (eşleşme yoksa boş, uydurmaz) → `copilotDraft` store ile **composer'a** (`Composer` reply moduna
    geçer); enhance rephrase/friendly/formal/grammar (`@nexa/ai-mock` `enhanceText`/`summariseConversation`,
    deterministik stub). OpenAPI 5 yol (`paths/copilot.yaml`), `/skills`+`/knowledge-sources`
    `ai_agent`'a filtrelendi (copilot sızmaz), seed'e copilot KB eklendi (demo'da "Draft a reply" çalışır).
- Doğrulama (DoD, exit 0): typecheck 11/11 · lint 8/8 · build 7/7 · test (api **864** + web **354** +
  ai-mock **56**, turbo `--concurrency=1`) — integration dahil: contract-parity 5/5, `copilot.test.ts`
  15/15 · e2e `copilot.spec.ts` 1/1 + `inbox-panel`/`inbox-tabs` regresyonsuz. Yeni test: `assist.test.ts`(14)
  + `copilot.test.ts`(15) + `CopilotPanel.test.tsx`(7) + `copilotDraft.test.ts`(3) + `Composer.copilot.test.tsx`(2).
- Varsayımlar / notlar:
  - Copilot skill'i `kind:'workspace'` (`skills_kind_check` 'copilot'e izin vermiyor; 'workspace'
    zaten assisted-metrik run kind'i) — migration gerekmedi. Ajanı/skill'i **lazy find-or-create**
    (fixtures seed'lemez).
  - **e2e viewport 1680** — transcript header darlığı (tickets.spec emsali) copilot butonunu details
    paneli altına kaydırıyordu; feature'ın yeni sorunu değil, mevcut header darlığı. [[nexa-e2e-clean-db]]
    gereği e2e `.env` source'lanarak koşuldu.
- Sonraki pencereye not: **Ertelenen** — Copilot KB **yönetim UI**'si (kaynak ekle/sil) 04.2-a
  (Team tarafı, ayrı task) kapsamında; backend `/copilot/knowledge` hazır. §2 satır 111 "MOD-01 …
  Copilot v1" MOD-01 rollup hücresi — copilot panel teslim ama o hücre MOD-01 kapsamı, dokunulmadı.

### 62 — EK-C.2 · Banner/dropdown/panel/modal tek tasarım sistemi [XHIGH] — done — 2026-07-26 UTC

- Kapsam: FR-EK-C.2 (`Should`, Faz-0'ı bloklamaz — erken teslim). Denetim (§7.1) notu: bileşenler
  vardı ama tek "design system" soyutlaması gevşekti — her ekran kendi banner/dropdown/panel/modal
  `<div>`'ini elde yazmıştı. Frontend-only; backend/contract/DB'ye **dokunulmadı** (yeni route yok →
  contract-parity etkilenmez). PLAN satır 461 + §7.1 tablo (951) → `✅`.
- Yapıldı:
  - **Yeni tek katman** `apps/web/src/components/ui/`: `Banner`, `Dropdown`, `Modal`, `Panel`
    (+`PanelSection`), `cn`, `index.ts`. Her biri dağınık kopyalardan davranışı çıkarıp tekleştirir.
  - **Banner** — segmentli tone (info/success/warning/danger/brand/neutral, renk hep ikon+metinle
    eşli), opsiyonel `cta`, **kapatılabilir + kalıcı dismiss** (`id` verilirse `localStorage`
    `nexa.banner.dismissed.<id>`; `id`siz oturumluk; storage yoksa sessizce oturumluk).
  - **Dropdown** — `<details>` tabanlı; Escape kapatır + odağı tetikleyiciye verir, dış tık kapatır,
    `aria-expanded`, panel `hidden group-open:block` (absolute konumda kapalı `<details>` çocuklarını
    tarayıcı gizlemez — AppShell'de patlayan regresyon; sınıf mekanizması korunur).
  - **Modal** — overlay + `role=dialog aria-modal`; Escape ve arka-plan tık **tek** `onClose`'a gider
    (dirty-guard bu tek kapıya oturur), panelde başlayan mousedown dismiss sayılmaz, açılışta odak
    içeri (içerik `autoFocus` istediyse ona dokunmaz), kapanışta tetikleyiciye döner.
  - **Panel/PanelSection** — adlandırılmış `<aside>` + başlık + opsiyonel collapse; katlanabilir
    bölümler (varsayılan açık).
  - **Mevcut kopyalar oturtuldu (ölü kod değil):** AppShell hesap menüsü→`Dropdown`, InviteTeammates
    modalı→`Modal`, DetailsPanel→`Panel`/`PanelSection`, Billing read-only + TicketPane merged→`Banner`.
- Doğrulama (DoD, exit 0): typecheck 11/11 · lint 8/8 · build 7/7 · test 10/10 (web **342**, +22 yeni:
  Banner 7 · Dropdown 6 · Modal 6 · Panel 3). Test stratejisi birebir karşılandı ("banner dismiss
  kalıcı" + "dropdown/panel/modal tutarlı davranış"). Mevcut AppShell/InviteTeammates/DetailsPanel/
  TicketPane/Billing testleri refactor sonrası yeşil.
- Varsayımlar / notlar:
  - **integration/e2e koşulmadı** — değişiklik saf UI (yalnız `apps/web`), API/DB/OpenAPI yüzeyi yok;
    task'ın kabul kriteri unit seviyesinde (tm 60/57/61.2 gibi frontend-only kapanışlarla tutarlı).
  - **Shell TrialBanner bilinçli olarak Banner'a alınmadı** — o tam-genişlik krom şeridi (status bar),
    kart-tarzı notice değil; Banner primitifi in-content notice kartları içindir. Gerekirse `flush`
    varyantı sonradan eklenebilir.
  - Canlı `dismissible` Banner örneği eklenmedi (mevcut banner'ların hiçbiri kullanıcı-dostu biçimde
    kapatılabilir değil — ör. ödeme uyarısını gizletmek istemeyiz). Kapatma+kalıcılık yeteneği
    primitifte hazır ve unit testle kanıtlı; sonraki uygun notice onu kullanır.

### 61.2 — 13.6-a · Omnichannel HelpDesk katmanı (frontend) [XHIGH] — done — 2026-07-26 UTC

- Kapsam: 61.1'in backend HelpDesk katmanını `apps/web` inbox'ına bağlar. Parent **61 artık done**
  (61.1 + 61.2). PLAN satır 544 → `✅` (§D38·§D39). Frontend-only — backend/contract'a dokunulmadı.
- Yapıldı:
  - **Priority seçici** — `TicketDetailPane`'de 4 seviyeli select (Urgent/High/Normal/Low). Yeni
    `ticket-priority.ts`: `nearestPriority` API'nin döndürdüğü keyfi int'i (±100) en yakın seviyeye
    snap'ler (eşitlikte daha acil kazanır); `hasElevatedPriority` liste rozeti için. `TicketList`
    satırında priority pill.
  - **Followers** — agent picker'dan ekle (`/agents`), satırdan çıkar; `FollowersSection`.
  - **Merge/unmerge** — standalone ticket aday listesinden birleşir; **primary** kendi panelinde
    folded child'ları listeler ve her birini oradan unmerge eder (child'lar listeden gizli olduğu için
    UI'da onlara ulaşmanın tek yolu); merged ticket read-only + banner (kendi banner'ından da unmerge).
  - **Hook'lar** — `useTickets.ts`: `useMergeTicket`/`useUnmergeTicket`/`useAddFollower`/
    `useRemoveFollower`/`useAgents` (id mutate-time'da, tek id'ye bağlı değil); `useTicket` →
    `TicketDetail`; `settle()` yardımcısı (dönen detail'i cache'e yaz + tüm ticket sorgularını invalidate).
  - **Tipler** — `types.ts`: `Ticket`'e `priority`/`merged_into_id`; yeni `TicketFollower` + `TicketDetail`.
- Doğrulama (DoD, exit 0): typecheck 11/11 · lint 8/8 · test (api 849 + web 320, turbo `--concurrency=1`) ·
  test:integration 698 · build 7/7 · **e2e 56/56** (yeni `tickets.spec.ts` dahil) · contract-parity 5/5 ·
  drift temiz. Yeni: `TicketPane.test.tsx` (8) + `ticket-priority.test.ts` (6) + `tickets.spec.ts` (1).
- Varsayımlar / notlar:
  - **Merge/unmerge e2e'de değil, unit'te** — e2e seed truncate'siz reseed eder (idempotent); merge çapraz-
    ticket kalıcı durum bırakır → tekrar koşuda kırılgan. Merge/unmerge (child+primary) `TicketPane.test.tsx`'te
    birebir istek assertion'larıyla kanıtlı; e2e smoke idempotent priority+follower'ı kapsar.
  - **e2e çalıştırma:** [[nexa-e2e-clean-db]] gereği `set -a; . ./.env; set +a` ile koşuldu (dev server'lar
    env ister). `tickets.spec.ts` geniş viewport kullanır (dar transcript header'da "Create ticket" details
    paneli altına kayıyordu — mevcut layout darlığı, bu pencerede değişmedi).
- Sonraki pencereye not: **Ertelenen** — liste satırında merged-child sayaç rozeti, liste özet payload'una
  `merged_ticket_ids`/`merged_count` alanı (backend + OpenAPI + contract-parity) gerektirir; KK'nın parçası
  değil, ayrı küçük bir iş olarak açılabilir.

### 61.1 — 13.6-a · Omnichannel HelpDesk katmanı (backend) [MAX] — done — 2026-07-26 UTC

- Kapsam kararı: Task 61 (13.6-a) `[MAX]`, testStrategy "başında subtask'lara bölünmeli / 2+ pencere".
  Başta **61.1 backend veri-bütünlüğü** (bu pencere) + **61.2 frontend HelpDesk yüzeyi** (pending) olarak
  bölündü. Parent 61 hâlâ `in-progress` (61.2 kaldı). PLAN satır 544 → `◐` (§D38).
- Yapıldı:
  - **merge/unmerge** — `Ticket.mergedIntoId` self-FK; **non-destructive pointer** (merge işaretçiyi
    kurar, unmerge temizler → tam ters, "invariant" testi kesin). Invariantlar: self-merge (DB CHECK +
    servis), zincir yok (hedef primary), primary-with-children merge edilemez, already-merged kaynak
    reddi, cross-tenant→404. Merged ticket listeden gizli (`mergedIntoId: null` süzgeci), primary'de
    `merged_ticket_ids`.
  - **followers** — `ticket_followers` join tablosu (license_id yok → `thread_tags` gibi ticket
    üzerinden RLS EXISTS + GRANT). add/remove idempotent, üyelik doğrulaması (`assertFollower`).
  - **priority** — `Ticket.priority Int @default(0)`, PATCH ile ayarlanır, `@nexa/types`
    `TICKET_PRIORITY_MIN/MAX` (-100..100).
  - **ticket audit** — yeni `AUDIT_ACTIONS`: `ticket.status_changed`/`priority_changed`/`merged`/
    `unmerged`/`follower_added`/`follower_removed`; `writeAuditEntry` servis içinde tx'te (agents.ts
    deseni). Ticket lifecycle (status geçişi) artık audit'li — "ticket yaşam döngüsü" KK'sı.
  - **API/kontrat:** `routes/tickets.ts` +4 route (POST/DELETE `/tickets/:id/merge`, POST
    `/tickets/:id/followers`, DELETE `/tickets/:id/followers/:accountId`); OpenAPI `paths/tickets.yaml`
    +3 yol (`mergeTicket`/`unmergeTicket`/`addTicketFollower`/`removeTicketFollower`) + `Ticket`/
    `TicketDetail` alanları; `contract:generate` ile bundle+client yeniden üretildi.
  - **migration** `20260726160000_ticket_helpdesk` — Prisma-yapısal DDL + hand-added CHECK/RLS/GRANT;
    `prisma migrate deploy` uygulandı, `db:check-drift` temiz.
- Doğrulama (exit 0): `pnpm -w typecheck` 11/11 · `pnpm -w lint` 8/8 · seri `turbo run test
  --concurrency=1 --filter=!@nexa/e2e` → **api 849/849** (+15 `tickets-helpdesk.test.ts`) · `pnpm -w
  test:integration` 698 · `pnpm -w build` 7/7 · `pnpm -w test:e2e` 55/55 · `contract-parity` 5/5.
- Varsayımlar: priority = işaretli int (kaynak HelpDesk `priority:-10` gibi), enum değil — UI/sıralama
  61.2'ye ertelendi (mevcut liste sıralaması `last_message_at` bozulmadı). Merge conflict'leri yeni
  kilitli hata tipi yerine `validation` (400) / `not_found` (404) ile — katalog/contract error enum'a
  dokunulmadı.
- Sonraki pencereye not:
  - **tm 61.2 (frontend):** `TicketPane.tsx`'e priority selector + followers add/remove + merge/unmerge
    aksiyonu + merged-child göstergesi; `useTickets.ts` hooks; web unit + e2e. Backend + typed client
    hazır (`@nexa/contract` generated api.ts'te yollar var).
  - `pnpm -w test` **paralel paket DB yarışı** verir (api+rtm aynı Postgres); DoD için `--concurrency=1`
    kullan ([[nexa-test-gate-parallel-db]]).
  - Çalışma alanında **`.parked-playbook/`** (untracked, skills 05.2 WIP) bu pencereden ÖNCE vardı —
    bana ait değil, dokunulmadı, bırakıldı.

### 60 — 13.1-a · Home dashboard [XHIGH] — done — 2026-07-26 UTC

- Yapıldı:
  - **Yeni `GET /home` (`reports_read`)** — tek okumada üç bölüm. `routes/home.ts` →
    `services/home/home-service.ts` (`server.ts`'e kayıtlı). Şema tek kaynak `@nexa/types`
    `HomeDashboard`; OpenAPI `paths/home.yaml` + `openapi.yaml` (88 path, `contract:generate` ile
    yeniden üretildi, contract-parity ✅).
  - **Aktivasyon checklist:** 5 adım _türetilir_ (stored değil) — website / (>1 üyelik ∨ bekleyen
    davet) / widget_settings / canned / ai_agent var mı. Her adım ilgili şey gerçekten var olduğu için
    `done`, bayatlayamaz.
  - **Canlı kartlar (KK "canlı gerçek-zaman kartları"):** `visitors_online` = açık chat ∪ son 30 dk
    ziyaret **UNION distinct** (raw SQL, defansif `license_id` filtresi + RLS); `ongoing_chats` = aktif
    chat; `agents_online` = `accepting_chats & NOT suspended` (widget'ın online tanımıyla aynı).
  - **Haftalık performans:** son 7 gün vs önceki 7 (new chats / resolved / CSAT + WoW delta).
    `chats`/`resolved` = Reports overview `chats`/`closed` ile **aynı created-in-window taban** →
    tam raporla çelişmez; ADR-09 automated split'e **dokunulmadı** (reports route'unda tek yerinde kalır).
  - **Web:** `HomePage.tsx` + saf `dashboard.ts` (kart/delta view-model'leri, dependency-free →
    unit test edilebilir). Rota `/app/home` (`App.tsx`), nav "Home" ilk modül (`navigation.ts`,
    `nav.home` tr/en). 403 → dürüst EmptyState ("admin/owner'a açık"), diğer hata → ErrorNotice.
- Doğrulama (exit 0): `pnpm -w typecheck` · `pnpm -w lint` · seri `turbo run test --concurrency=1
  --filter=!@nexa/e2e` → **api 834/834** (+13 `home.test.ts`) + web 307/307 (+8 `dashboard.test.ts` +
  4 `HomePage.test.tsx`) + `contract-parity` 5/5 · `pnpm -w build`. KK "unit (kartlar) + integration
  (canlı sayaç)" birebir kanıtlı.
- Varsayımlar: (1) Endpoint `reports_read` kapılı — canlı ops sayaçları + haftalık performans
  yönetim-genel-bakış verisi, Reports ile aynı kitle; plain agent'ın `reports_read`'i yok (bkz.
  DEFAULT_AGENT_SCOPES). (2) İndeks yönlendirmesi inbox'ta bırakıldı — Home landing yapılmadı ki
  plain-agent login'de 403 yemesin ve mevcut e2e bozulmasın. (3) `install_widget` = website (trusted
  domain değil) satırı var mı; PRD'de widget "install" web sitesi kaydına bağlı.
- Sonraki pencereye not: 13.6-a HelpDesk/Ticketing katmanı ayrı `[MAX]` task (kapsam dışı bırakıldı).
  Home'a e2e yok (KK unit+integration); istenirse `home.spec.ts` eklenebilir. Canlı kartlar poll
  değil tek-atış; istenirse RTM push ile canlandırılabilir. Ayrı `2ff337a` commit'i D30–D33 audit +
  protokol dokümanlarını (prior-window commit'lenmemiş) topladı; `.parked-playbook/` bilinçli commit dışı.

### 59 — 04.6-a · Chatbots / Suspended agents sekmeleri [XHIGH] — done — 2026-07-26 UTC

- Yapıldı:
  - **Suspend/unsuspend endpoint:** yeni `PUT /agents/{agentId}/suspension` (`agents--all:rw`) —
    çift kapı (scope + rol: owner/admin). Owner **asla** askıya alınamaz; admin **kendini** ya da
    **rütbesinin üstünü** askıya alamaz; cross-tenant hedef RLS ile **404**. Değişiklik token'da
    değil **üyelikte** durduğu için mevcut oturumlar **bir sonraki istekte** düşer (token-service
    zaten `suspended` okuyor) ve routing o andan itibaren atamayı durdurur (routing-service
    `AND NOT m.suspended`). Aynı duruma set (no-op) audit yazmaz. Yeni AUDIT_ACTIONS:
    `member.suspended` / `member.unsuspended`.
  - **Liste filtresi:** `GET /agents?status=active|suspended|all` (varsayılan `active` — mevcut
    çağıranlar/atama seçicileri hiç değişmez); her item artık `suspended` bayrağı taşır.
  - **Bot faturasız:** botlar ayrı `ai_agents` tablosunda; koltuk sayımı yalnız askıda-olmayan
    `agent_memberships` (`min_seats`) → bot **koltuk tüketmez**, askıya alınan ajan koltuğunu boşaltır.
  - **Sözleşme:** OpenAPI `agents.yaml` (`listAgents` status param + `setAgentSuspension`) +
    `Agent.suspended`; `contract:generate` ile yeniden üretildi. `contract-parity` yeşil.
  - **UI (Team):** `TeamPage.tsx` — **Chatbots** bölümü ("Free" rozeti + skills sayısı, `/ai-agents`),
    **Suspended** bölümü (Reinstate), Teammates satırlarına **Suspend** aksiyonu + "Chatbots" KPI.
    Rol/self/owner kapısı UI'da da yansıtılır; mutation her iki roster'ı invalidate eder.
- Doğrulama (exit 0): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w build` · `turbo run test
  --concurrency=1` (seri) **api 821/821** (+13 yeni `agents-suspension.test.ts`: liste ↔ suspended,
  oturum-durur, routing-durur, yetki guard'ları, cross-tenant 404, audit, bot-faturasız) + tüm
  paketler yeşil · **e2e `team.spec.ts` 2/2** (.env source'lanarak). KK birebir kanıtlı: suspend →
  oturum/atama durur; bot faturasız.
- Varsayımlar: (1) Suspend anında PAT/oturumu **socket kick** ile öldürmek eklenmedi — token bir
  sonraki istekte reddedilir (mevcut auth davranışı; KK için yeterli). (2) suspend `routingStatus`'u
  ellemez (routing zaten `suspended`'e bakar, unsuspend eski durumu korur). (3) Full e2e stack yerine
  yalnız ilgili `team.spec.ts` koşuldu (ağır/flaky — bkz. e2e memory).
- Sonraki pencereye not: Rol-değiştir / approve (`awaitingApproval`) yüzeyleri hâlâ ayrı borç (04.x).
  Suspend anında socket kick istenirse `RealtimePublisher` ile eklenebilir.

### 57 — 11.7-a · Widget customization (Appearance/Position/Mobile) + canlı önizleme [XHIGH] — done — 2026-07-26 UTC

- Yapıldı:
  - **Şema tek kaynak:** yeni `packages/types/src/widget.ts` — `WidgetAppearance`
    (`primary_color`/`position`/`theme`/`mobile_fullscreen`/`powered_by`), `DEFAULT_WIDGET_APPEARANCE`,
    `WIDGET_COLOR_PATTERN` (`#rrggbb`), `normalizeWidgetAppearance`. API, widget ve web tek tipi paylaşır.
  - **API kalıcılık:** yeni `widget_settings` license-singleton tablosu (RLS + 3 CHECK: color/position/theme)
    + migration `20260726150000_widget_settings` + Prisma modeli. `GET/PUT /settings/widget` (`access_rules`
    scope, partial upsert, defaults dolgusu, audit `settings.widget_updated`) — `InboxSettings` desenini birebir
    izler. Snippet artık **default'tan sapan** görünüm alanlarını `window.__nexa`'ya gömer
    (website-service). `/customer/token` yanıtı `widget` görünümünü taşır (hosted Chat page + bayat snippet düzeltmesi).
  - **Sözleşme:** OpenAPI `/settings/widget` (GET+PUT) + `WidgetSettings` şeması; `contract:generate`.
    `contract-parity` yeşil.
  - **Widget:** loader görünümü query param'a forward eder + **mobil tam ekran** iframe geometrisi
    (host viewport ≤480px & open → tüm ekran, aksi halde köşe kartı). Widget mount'ta temayı uygular
    (`--nx-brand`, `data-nx-theme` light/dark force, `nx-left`/`nx-mobile-full` sınıfları) ve token
    yanıtından yeniden uygular. **"Powered by Nexa"** alt bilgisi (FR-MOD-11.5, kaldırılabilir) + i18n (en/tr).
    Bundle P3 bütçesi korunur (loader ~1.3KB gz, toplam ~10KB gz < 50KB).
  - **UI (canlı önizleme):** yeni `WidgetCustomization.tsx` — renk/konum/tema/mobil/powered-by kontrolleri
    + gerçek-zamanlı önizleme (React mock, iframe değil); kaydet → `PUT /settings/widget` + snippet cache invalidate.
    WebsiteWidgets'taki devre dışı "Customize widget" butonu artık `#widget-customization`'a link. Section'a `id` eklendi.
- Doğrulama: `pnpm -w typecheck`/`lint`/`build` yeşil. Unit: widget 48 (tema uygular + loader geometri),
  web 295 (WidgetCustomization 5). Integration: `test:integration` 657 (settings/widget 13 + websites snippet 3 +
  token `widget` alanı + contract-parity). Bundle-size testi yeşil (P3 korunur).
- Varsayımlar: Görünüm merkezi (DB) tek kaynak; snippet materyalize kopya. Chat page teması token yanıtından.
  Full e2e stack koşulmadı (ağır/flaky — bkz. e2e memory); mevcut `widget.spec`/`settings.spec` seçicileri
  yapıca etkilenmiyor (desktop viewport mobil yolu tetiklemez; powered-by ek eleman, rol seçicileri çakışmaz).
- Sonraki pencereye not: White-label "Powered by" tamamen kaldırma v3 (tm 84). Widget dil seçimi hâlâ embed
  tarafında (`data-language`); merkezi dil tercihi eklenirse `widget_settings`'e alan eklenebilir.

### 56 — 10.3-a · Invoices + payment yönetimi [XHIGH] — done — 2026-07-26 UTC

- Yapıldı:
  - **Faturalar (liste + indirme):** yeni `services/billing/invoice-service.ts` — faturalar ayrı
    tablo yerine **subscription + usage_records'tan türetilir** (ADR-13 mock). Her dönem için bir
    fatura + her zaman **açık (open)** cari dönem; toplam = seat charge (priceSeats) + AI aşımı
    (birim) + API aşımı (blok). Cari faturanın toplamı = `estimated_total_cents` (tek aritmetik, asla
    ayrışamaz). Trial'de her fatura `trial` durumunda ve $0. `GET /billing/invoices` (newest-first),
    `GET /billing/invoices/:period/download` → injection-safe CSV (`toCsv`, nosniff, no-store),
    bilinmeyen dönem 404, bozuk dönem 400.
  - **Ödeme yöntemi (güncelleme):** yeni `payment_methods` tablosu (license-singleton, RLS) +
    migration `20260726140000_payment_method` + `services/billing/payment-method-service.ts`. Yalnız
    **maskeli** alanlar: brand/last4/exp/holder — **gerçek PAN alanı YOK** (PRD §11.1/1 kapsam dışı,
    teknik olarak girilemez). `GET/PUT /billing/payment-method`; PUT read-only'de bile yazılabilir
    (trial dönüş yolu), süresi geçmiş kartı reddeder, audit `billing.payment_method_updated`
    (yalnız brand+last4).
  - **Sözleşme:** OpenAPI'ye 3 yol (`/billing/invoices`, `/billing/invoices/{period}/download`,
    `/billing/payment-method` GET+PUT) + `Invoice`/`PaymentMethod`/`PaymentMethodInput` şemaları;
    `contract:generate`. `contract-parity` + `route-config` integration testleri yeşil.
  - **UI:** BillingPage — yeni **Invoices** bölümü (tablo: no/dönem/tarih/durum/tutar + Download) ve
    yeni **Payment method** bölümü (maskeli kart formu, PUT ile kaydeder, kart-no alanı yok). Eski
    ManagePlan içindeki mock "Enter payment details" paneli kaldırıldı (yerini gerçek bölüm aldı).
    `ApiClient.put` eklendi.
- Doğrulama (hepsi yeşil): `pnpm -w typecheck` ✅ · `pnpm -w lint` ✅ · `pnpm -w build` ✅ ·
  `pnpm -w test` (api 793 + web 290) ✅ · `pnpm -w test:integration` (642; reports-billing 85, +21
  yeni: fatura liste/indirme/tenant/trial/404/400 · ödeme yöntemi CRUD/expired/scope/read-only/
  audit/tenant) ✅ · billing e2e 2/2 ✅ (BillingPage yeni akış).
- Varsayımlar: Faturalar türetilir (kalıcı tablo yok) — geçmiş dönem seat charge'ı **cari**
  subscription'dan hesaplanır (tarihsel seat sayısı tutulmuyor; mock için kabul, overage tam). Cari
  dönem hep `open` fatura olarak listelenir (liste boş kalmaz). Ödeme yöntemi maskeli (last4) —
  last4 saklamak PCI-güvenli; tam kart numarası ne kabul edilir ne saklanır.
- Sonraki pencereye not: e2e için `.env` **environment'a source edilmeli** (rtm/web/widget dev
  server'ları .env'i kendisi yüklemiyor). Gerçek Stripe entegrasyonu v2/kapsam dışı — invoice PDF ve
  gerçek kart ödemesi ileride.

### 55 — 10.1.5-a · API calls aşım + sayaç [XHIGH] — done — 2026-07-26 UTC

- Yapıldı:
  - **Sayaç (metering):** yeni `plugins/metering.ts` — `onSend` hook'u her **PAT** ile kimlik
    doğrulanmış (`principal.kind==='agent' && tokenKind==='pat'`), 5xx olmayan API çağrısında
    `recordApiCall` ile `usage_records.api_calls` sayacını atomik arttırır. Konsol (OAuth), bot
    (bot token) ve widget (customer token) trafiği faturalanmaz; best-effort (hata yutulur, çağrı
    hiç başarısız olmaz). `onSend` beklendiğinden sayaç güçlü tutarlı — çağrı kaybı yok.
  - **Aşım → fatura:** `metering.ts` `usageSummary` artık `api_calls`'a `overage/overage_cents/
    overage_unit/overage_unit_price_cents` ekliyor. Blok bazlı fiyat (AI'ın birim-bazlısından
    farklı): `ceil(overage/100_000) * $29.50` — "$29.50 per 100,000 extra" (PRD §10.1.5). Aşım
    `reports.ts`'te `estimated_total_cents`'e eklendi (seats + AI aşımı + API aşımı).
  - **Config:** `API_CALLS_INCLUDED=100000`, `API_CALL_OVERAGE_CENTS=2950` (env.ts + .env.example).
    Seed'in zaten kullandığı değerler (included/overageUnit=100k, price=2950) — çelişki yok.
  - **Sözleşme + UI:** OpenAPI `UsageSummary.api_calls` genişletildi + `contract:generate`.
    BillingPage "API calls" bölümü sayaç (Used/Included) + Overage + Overage charge + blok fiyatı.
- Doğrulama (hepsi yeşil): `pnpm -w typecheck/lint/build` ✅ · `pnpm -w test` (774 api + web) ✅ ·
  reports-billing integration 66/66 (5 yeni: sayaç/tenant-scope/başarısız-auth-sayılmaz/aşım→fatura/
  ön-fiyat) ✅ · billing e2e 2/2 ✅.
- Varsayımlar: "billed API call" = PAT çağrısı (FR-MOD-08.8.2 PAT'a bağlar); OAuth/bot/customer
  faturalanmaz. Included=100k (seed ile hizalı; PRD plan kartındaki "20,000" pazarlama sayısı değil).
  Metering onSend'de senkron (küçük ek gecikme) — MVP için kabul; ileride batch/async optimize edilebilir.
- Sonraki pencereye not: `grantToken` varsayılanı PAT olduğundan tüm integration suite artık her API
  çağrısında `api_calls` kaydı üretir (metric=`ai_resolutions` filtreleyen testler etkilenmez;
  doğrulandı). Kanıt görselleri (`kanit/14`,`15`) değişebilir — ayrı e2e-proof turunda yenilenir.
  Kalan Billing: **10.3-a** (Invoices + payment details).

### 48 — 08.7.3-a · Chat timeout (boşta/ölü sohbet otomatik kapanma) [XHIGH] — done — 2026-07-26 UTC

- Yapıldı:
  - **Şema + migration (`20260726130000_inbox_settings`):** yeni `inbox_settings` per-license
    singleton (SecuritySettings deseni) — tek alan `chat_timeout_seconds Int?` (null=kapalı).
    RLS policy + `nexa_app` grant. Sürüklenme yok (`db:check-drift` temiz).
  - **Kontrat (contract-first):** `GET/PUT /settings/chat-timeout` + `ChatTimeoutSettings` şeması
    (`paths/settings.yaml#/chatTimeout` + `openapi.yaml`). Pozitif tamsayı (≤30 gün) **veya** null;
    0/negatif reddi (`.positive()`). Bundle yeniden üretildi (82 path). contract-parity yeşil.
  - **Backend:** `routes/settings.ts` — GET (satır yoksa `{chat_timeout_seconds:null}`, yan etkisiz)
    + PUT (upsert, audit `settings.chat_timeout_updated`). `access_rules:rw` yazma / `:ro` okuma.
  - **Kapatma yolu (DRY refactor):** `deactivate` içindeki kapatma kaskadı `#closeConversation`'a
    çıkarıldı; yeni `deactivateByTimeout(tenant, chatId, cutoff)` **sistem aktörüyle** aynı yolu
    kullanır → ADR-09 AI-resolution sayımı + queue-drain + RTM fan-out (`#publishDeactivation`) tek
    yerde. Kapatma olayı `system_event: chat_deactivated`, `reason: timeout`.
  - **Sweep (`services/chat/chat-timeout.ts` + CLI `chat-timeout:run`):** retention deseni —
    `retention_list_tenants()` ile tenant sayımı, her tenant `withTenant` (RLS), pozitif pencere yoksa
    atla. "Ölü" = son olay (yoksa thread.createdAt) < cutoff. **Yarış güvenliği:** kapatma tx'inde
    cutoff yeniden kontrol edilir → mid-sweep gelen yanıt sohbeti bağışlar. İdempotent.
- Doğrulama (hepsi yeşil, exit 0): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w test:unit` (151) ·
  `pnpm --filter @nexa/api test:integration` (28 dosya / 618) · `pnpm -w build` · e2e (55) ·
  `db:check-drift`. Yeni test: `test/integration/chat-timeout.test.ts` (8: timeout→kapanır, pencere
  içi aktivite hayatta kalır, kapalı/non-pozitif atlanır, cross-tenant RLS izolasyonu, idempotent,
  AI-resolution parity) + `settings.test.ts` chat-timeout bloğu (9: defaults/enable/disable/0-negatif
  reddi/non-integer/boş gövde/scope/tenant izolasyonu). Test helper'a `put` eklendi.
- Varsayımlar: Depolama `SecuritySettings` yerine ayrı `inbox_settings` (MOD-08 "Inbox tools"
  semantiği; gelecekteki 08.7.x buraya büyür). Zorunlu maks 30 gün (mantıksız pencere reddi).
  Prod scheduler yok (proje sınırı) → sweep bir CLI; UI eklenmedi (kapsam dışı, API+sözleşme yeterli).
- Sonraki pencereye not: Kalan MOD-08 inbox araçları (08.6.2-a, 08.7.4-a…08.7.7-a) hâlâ `⬜`.
  08.7.4-a (transcripts otomatik e-posta) `inbox_settings`'i genişletebilir. Sweep'i çalıştıracak bir
  host cron/scheduler prod dışıdır; şu an operatör `chat-timeout:run` ile tetikler.

### 46 — 07.7-a · Rapor grupları + Export (CSV) [XHIGH] — done — 2026-07-26 UTC

- Yapıldı (resume — önceki pencere `reports-export.ts` modülü + unit testi yazmış, `reports.ts`'e
  import'ları eklemiş ama route'ları bağlamamıştı; yarım kalan kısım tamamlandı):
  - **Kontrat (contract-first):** `GET /reports/groups` + `GET /reports/export` OpenAPI'ye eklendi
    (`paths/reports.yaml#/groups,#/export` + `ReportGroups` şeması); export yanıtı `text/csv`.
    Typed client yeniden üretildi (`contract:generate`, 81 path).
  - **Backend (`routes/reports.ts` + `routes/reports-export.ts`):**
    - **İzin bazlı görünürlük (KK):** `/reports/groups` — bilerek route-scope'suz; `reports_read`
      olmayan token **boş liste** alır, 403 değil ("ne görebilirsin" dürüstçe hiç ile cevaplar;
      403 export'un işi). Görünürlük kuralı `visibleReportGroups(scopesOf(principal))`.
    - **CSV export (KK):** `/reports/export?group=` — route `EXPORT_SCOPES` (grup scope'larının
      birleşimi) ile kapılı + grup-başına scope kontrolü (bugün hepsi `reports_read`, ama gelecekte
      farklı scope'lu grup sızmadan reddedilir). Bilinmeyen/eksik grup→400, ters aralık→400.
      Tenant-scoped (`withTenant`), CSV formül-enjeksiyonu (`=+-@`) etkisizleştirilir, `no-store`
      + `content-disposition: attachment; filename="nexa-<grup>-<from>-<to>.csv"`.
    - **Sıfır sürüklenme:** `breakdownByDay`/`transferCount` paylaşımlı helper'lara çıkarıldı;
      export her figürü ilgili JSON raporunun **aynı** helper'ından üretir → CSV ekranla asla
      çelişmez. Zaman serisi grupları (breakdown/reviews) gün başına satır; pencere özetleri
      (overview/ai-agent) `metric,value` çiftleri.
  - **KAPSAM DIŞI (v2, PLAN §4.4.8):** PDF export + benchmark karşılaştırma — eklenmedi.
  - **Test:** 11 yeni integration testi (`report groups + CSV export (07.7)`: görünürlük listesi/boş,
    4 grubun CSV export'u, tenant izolasyonu, bilinmeyen/eksik grup, ters aralık, scope gating).
    `reports-export.test.ts`'te önceki pencereden kalan sütun-uyuşmazlığı olan bir assertion
    düzeltildi (1 sütun başlık ↔ 2 hücre satır).
- Doğrulama (DoD kapısı — bu tur koşuldu, hepsi yeşil): `typecheck` exit 0 · `lint` exit 0 ·
  `test:unit` **api 151 · web** · `test:integration` **600/600** (11 yeni 07.7 testi dahil) ·
  `build` exit 0 · **e2e 55/55** (`reports.spec.ts` sekmeleri dahil).
- Varsayımlar: her grup bugün tek `reports_read` scope'una bağlı; katalog scope'u grup-başına
  taşıdığından gelecekte farklı scope'lu grup (ör. billing export) görünürlük/guard değişmeden eklenir.
- Sonraki pencereye not: e2e için `.env` **source'lanmalı** (RTM/web/widget dev sunucuları .env'i
  kendileri yüklemez — ilk e2e denemem RTM env eksikliğinden server boot'ta patladı; `set -a; . ./.env;
  set +a` ile çözüldü) + 4000/4001/5173/5174 portları boş olmalı. e2e reseed sırasında `kanit/*.png`
  görselleri yeniden üretildi; bunlar bu task'ın çıktısı değil, commit'e alınmadı (kapsam disiplini).

### 45 — 07.8-a · Reviews/Ratings raporu (CSAT donut + günlük bar) [XHIGH] — done — 2026-07-26 UTC

- Yapıldı (yeni okuma yolu — `ratings` şimdiye dek yalnız yazma vardı, §8):
  - **Kontrat (contract-first):** `GET /reports/reviews` OpenAPI'ye eklendi (`paths/reports.yaml#/reviews`
    + `ReportsReviews`/`CsatSummary` şemaları); typed client yeniden üretildi (`contract:generate`, 79 path).
  - **Backend (`routes/reports.ts`):** `reports_read` scope'lu endpoint. `csat` (good/bad/responses/score;
    **oy yoksa score=null, %0 değil** — Overview satisfaction ile aynı kural, `satisfactionScore` paylaşımlı),
    `previous_period` (eşit uzunlukta önceki pencere — 67% vs 57% karşılaştırması, Overview 07.3.1 deseni),
    `by_day` (UTC gün başına good/bad — günlük bar; breakdown by_day ile aynı `AT TIME ZONE 'UTC'` deseni),
    ve `ecommerce` iskeleti (`configured=false`, alanlar null — satış izleme FR-MOD-13.5 v2, uydurma sıfır yok).
  - **Frontend (`ReportsPage.tsx`):** "Reviews" sekmesi (AI Agent ↔ Breakdown arası). CSAT donut (SVG ring,
    merkezde skor, erişilebilir aria-label), günlük bar (gün başına yığılı good/bad, en yoğun güne ölçekli),
    ecommerce "not set up" boş durumu (configured→gerçek KPI dalı da mevcut).
  - **PLAN:** MOD-07 modül tablosu "+ Reviews (07.8)"; §4.4.8 07.8-a bülteni ✅ tm 45.
- Doğrulama (DoD kapısı — bu tur koşuldu, hepsi yeşil): `typecheck` exit 0 · `lint` exit 0 ·
  `test` (serial, DB yarışı için `--concurrency=1`) **api 729 · web 283** · `test:integration` **589/589**
  (`Reviews report (07.8)`: rating okuma, oy yoksa null, iki-dönem, günlük bar, ecommerce iskeleti, tenant
  izolasyonu, scope/aralık reddi) · `build` exit 0 · **e2e 55/55** (`reports.spec.ts` → Reviews sekmesi 07.8,
  kanıt `kanit/22-reports-reviews.png`).
- Varsayımlar: e-ticaret satış izleme MVP'de veri kaynağı yok (FR-MOD-13.5 Could/v2) → iskelet
  `configured=false` + null alanlar (dürüst "kurulmadı", uydurma sıfır değil).
- Sonraki pencereye not: **07.7-a** (Rapor grupları + CSV export + izin gating) aynı `/reports/*`
  ailesini genişletir — Reviews de export kapsamına girmeli. e2e için: `.env` source'lanmalı +
  4000/4001 portları boşaltılmalı (bu turda eski `tsx watch` sunucuları temizlendi).

### 44 — 07.4-a · AI Agent raporu (resolution/deflection) [XHIGH] — done — 2026-07-26 UTC

- Yapıldı (çelişki denetimi + kapsam kapatma — rapor tm 21'de erken teslim edilmişti, KK doğrulandı):
  - **KK doğrulaması ("Billing sayacıyla ilişkili"):** `/reports/ai-agent` (`routes/reports.ts`)
    `resolutions` alanı = ADR-09 `automated` (kapanışta agent-yazımlı event yok) ve fatura sayacıyla
    (`/billing/usage` `ai_resolutions.used`) **tek paylaşımlı sorgudan** üretiliyor — iki sayaç
    ayrışamaz. Ek deflection: `transfers`/`transfer_rate` (`chat_transferred`), `skill_runs`,
    `resolution_rate`. Kontrat `/reports/ai-agent` OpenAPI'de; UI `ReportsPage` AiAgentTab "AI
    resolution" + "Deflection" kartları, başlıkta açıkça _"the same figure the invoice bills (ADR-09)"_.
  - **Yeni kod (test — gerçek boşluk kapatıldı):** `apps/web/src/features/reports/ReportsPage.test.tsx`
    (4) — AI Agent sekmesini açar (userEvent), resolution+deflection kartlarını, fatura-ADR-09
    ibaresini, paylaşımlı `/reports/ai-agent?from=&to=` sorgusunu ve boş-pencere `—` (0% değil)
    davranışını doğrular. ReportsPage'in daha önce hiç web testi yoktu.
  - **PLAN:** §4.4'te 07.4 `⬜`→`✅`; §D29 denetim notu (D28 stilinde). Ayrıca prior-window'un
    commit edilmemiş **D28 (06.3.1)** PLAN notu ayrı bir `docs(plan)` commit'iyle kurtarıldı.
- Doğrulama (DoD kapısı — bu tur koşuldu, hepsi yeşil): `typecheck` exit 0 · `lint` exit 0 ·
  `test:unit` exit 0 (**web 277/277** — +4 `ReportsPage.test.tsx`) · `test:integration` **581/581**
  (`reports-billing` → _"AI Agent report (07.4) — agrees with the overview and the invoice on
  resolutions"_ = rapor=fatura ADR-09) · `build` exit 0 · e2e `reports.spec.ts` **2/2** (AI Agent sekmesi).
- Varsayımlar: yok. Rapor+backend+kontrat+entegrasyon testi zaten mevcuttu (tm 21); bu pencere KK'yı
  objektif doğruladı, UI test boşluğunu kapattı ve PLAN'ı hizaladı — kapsam dışına çıkılmadı.
- Sonraki pencereye not: 06.5-a (tm 33.6) aynı `/reports/ai-agent` sorgusunu AI Performance ekranında
  tüketir; PLAN 06.5 satırı hâlâ `⬜` ama `AiPerformance.tsx`+testi kodda — ayrı bir denetim/kapatma
  bekliyor (bu pencerede dokunulmadı). `.parked-playbook/` bilerek commit dışı (bkz. e807983).

### 42 — 03.1.3-a · Ziyaretçi tablosu + satır aksiyonları (Traffic) [XHIGH] — done — 2026-07-26 UTC

- Yapıldı (contract-first; MOD-03 Customers'ın "Real-time" yüzü — canlı ziyaretçi panosu):
  - **Kontrat:** OpenAPI'ye `GET /traffic` (operationId `listTraffic`, 200+4xx) + `TrafficVisitor` /
    `TrafficRespondent` şemaları eklendi; `contract generate` ile `dist/openapi.json` + `api.ts`
    yenilendi. contract-parity ✅ (route belgeli **ve** servis ediliyor).
  - **Backend:** `TrafficService.listLive` — aktif sohbeti olan + son 30 dk içinde ziyareti olan
    müşterilerin birleşimi, kişi başı tek satır. `activity` ∈ browsing/queued/waiting/chatting.
    **"Chatting with"** çekirdek KK: insan atanmış → `{kind:'human'}`, yoksa aktif AI persona →
    `{kind:'ai'}` (ör. "Hazal"); insan AI'ı yener (FR-MOD-11.3 widget başlığıyla aynı çözümleme).
    `routes/traffic.ts` scope `customers:ro|:rw`, salt-okur; org+license süzme + RLS ile izolasyon.
  - **Frontend:** `TrafficPage` (Customers başlığı, `Live visitors` tablosu: Visitor / Activity /
    Chatting with / Actions; 8 sn poll — RTM traffic feed'i ayrı, daha büyük dilim [FR-EK-C.1]).
    Saf `visitorRowActions(visitor, ctx)` — satır aksiyonlarının durum×yetki mantığı (Start chat /
    Supervise / Assign to me / Edit; uygulanmayan aksiyon `enabled:false`, gizlenmez). Aksiyon
    kablolaması mevcut uçlar: Start → `POST /chats {assign_to_me}`, Assign → `POST /chats/:id/transfer
    {agent_id:self}`, Supervise/aç → `/app/inbox?chat=:id`, Edit → `/app/customers?customer=:id`.
    Alt-navigasyon `CustomersTabs` (Contacts | Real-time) iki sayfanın header'ında; rota
    `/app/customers/real-time` (deep-link'lenebilir).
- Doğrulama (DoD kapısı — hepsi exit 0): `typecheck` ✅ · `lint` ✅ · `test:unit` ✅ (web 273; +8
  `rowActions.test.ts`) · `test:integration` ✅ (581; **+9** `traffic.test.ts` — isolation/scope/
  browsing/live-window/human/ai(Hazal)/human-wins/queued/waiting/limit) · `build` ✅ · `test:e2e` ✅
  (traffic smoke + customers/command-palette regresyonu geçti; kanıt `kanit/03-traffic-board.png`).
- Varsayımlar: (1) "Canlı ziyaretçi" = aktif sohbet **veya** son 30 dk'da ziyaret; `visits.ended_at`
  bu sistemde hiç yazılmıyor → yalnız `started_at` penceresi ölçüt. (2) Supervise, ayrı bir salt-izleme
  backend'i yerine sohbeti inbox'ta açar (Supervised sekmesi 03.1.1-kalan olarak v1'de). (3) Pano
  RTM push yerine poll eder — canlı-yeterli, gerçek RTM traffic feed'i FR-EK-C.1 kapsamı.
- Sonraki pencereye not: **PLAN.md 03.1.3'ü `⬜`→`✅` çevir** (§4.2 satır 518 + §4.4.7) — bu pencerede
  PLAN.md'ye DOKUNMADIM: dalda ilgisiz, commit edilmemiş bir D28 doküman düzenlemesi vardı, aynı dosyada
  entangle etmemek için bıraktım. Geliştirmeler (v1): RTM traffic push (03.1.1-kalan/13.2), gerçek
  Supervised sekmesi + salt-izleme erişimi, ziyaretçi 360° panel (came from / visited pages — 13.2).

### 41 — 02.9-a · Live typing preview (sneak-peek) (+11.8) [XHIGH] — done — 2026-07-26 UTC

- Yapıldı (contract-first; iki taşıyıcı asimetrisi bilinçli — ajan socket'te, ziyaretçi poll'da):
  - **Yön A · ziyaretçi → ajan (sneak-peek, 11.8'in özü):** widget kompozer `input`'unda
    debounce'lu `POST /customer/chat/typing {is_typing, text}` → `ChatService.publishCustomerTyping`
    RTM'e **yalnız ajanlara** (`recipients:'agents'`, `audience.customerId` YOK — ziyaretçiye asla
    geri yansımaz) `incoming_typing_indicator` + `incoming_sneak_peek` yayınlar. Ajan web bunları
    `useTypingStore`'a katlar, `TypingIndicator` transcript üstünde "Visitor is typing… / önizleme"
    gösterir (6 sn'de veya müşteri mesajı gelince kendiliğinden temizlenir).
  - **Yön B · ajan → ziyaretçi (02.9 ajan tarafı):** ajan kompozer debounce'lu (start-edge + 3 sn
    trailing stop) `RtmClient.sendTyping` → RTM `send_typing_indicator` handler'ı **erişim doğrular**
    (sync-tarzı tenant-scoped sorgu; erişilemez chat = `not_found`, chat id sızdırmaz) ve licence-scoped
    kısa ömürlü Redis bayrağı (`typingStateKey`, 8 sn TTL) yazar. Widget poll'u (`GET /customer/chat`)
    bayrağı `agent_typing` olarak okur → "{ajan} yazıyor…". Not modunda yazma yayılmaz (müşteriye görünmez).
  - **Kontrat:** OpenAPI'ye `POST /customer/chat/typing` (operationId `sendCustomerTyping`, 204+4xx) +
    `CustomerChatState.agent_typing` eklendi; `contract generate` ile `dist/openapi.json` + `api.ts`
    yenilendi. contract-parity ✅ (route belgeli+servis ediliyor).
  - **Tipler:** `@nexa/types`'a `typingStateKey`, `AGENT_TYPING_TTL_SECONDS=8`, `SNEAK_PEEK_MAX_LENGTH=500`,
    `SneakPeekPush` + `TypingIndicatorPush.author_type`.
- Doğrulama (DoD kapısı — hepsi exit 0): `typecheck` ✅ · `lint` ✅ · `test:unit` ✅ (web 265; +9:
  typing store 5 / TypingIndicator 4 · rtm dispatcher+TypingService birim testleri) ·
  `test:integration` ✅ (seri concurrency=1; customer-chat **+6** [sneak-peek yalnız-ajanlara fan-out,
  stop=önizleme yok, agent_typing round-trip, no-op boş chat, 400, agent-token 404] · rtm 42) ·
  `build` ✅ · **e2e** ✅ (demo-flow altın yol + widget suite = 16 passed).
- **Yan düzeltme (test-robustness):** `rtm.test.ts:289` `newThreadId = threadId.slice(0,9)+'X'`
  ~1/32 ihtimalle orijinal id'yi yeniden üretiyordu (short-id son karakteri 'X' olunca) → deterministik
  farklı karaktere çevrildi. Kendi kodumla ilgisiz, gate'i belirlenimci yapmak için (pre-existing flake).
- Varsayımlar: ziyaretçi RTM socket'i AÇMAZ (widget bilinçli poll — mevcut mimari); bu yüzden ajan→ziyaretçi
  yazma bildirimi socket push değil Redis-bayrağı+poll ile taşınır. Sneak-peek asla kalıcı yazılmaz.
- Sonraki pencereye not: `.parked-playbook/` commit'e DAHİL EDİLMEDİ (bkz. e807983). Typing tamamen
  ephemeral (DB/migration yok). İstenirse ileride ajan→ziyaretçi için de gerçek-zamanlı push (customer
  RTM socket) düşünülebilir ama mevcut poll yeterli (Could/Should kapsamı).

### 54 — 10.1.4-a · AI resolutions meter + %80 UI [XHIGH] — done — 2026-07-26 UTC

- Yapıldı (UI dilimi; metering ✅ zaten vardı — ADR-09/ADR-13, sadece UI ⬜ idi):
  - **Backend (küçük, additif):** `metering.ts` `usageSummary.ai_resolutions`'a `overage_unit`
    (paket boyu = 50, yeni `AI_RESOLUTION_OVERAGE_UNIT` sabiti) + `overage_unit_price_cents`
    (çözüm-başı aşım fiyatı = `AI_OVERAGE_CENTS`) eklendi. Böylece meter aşım fiyatını **kota
    dolmadan** gösterebiliyor (PRD §5.3/§125 şeffaf-fatura farklılaştırması). `recordAiResolution`
    içindeki literal `50` sabite bağlandı. OpenAPI `UsageSummary` şeması güncellendi + `contract
    generate` ile `src/generated/api.ts` yenilendi. **Fatura aritmetiği değişmedi** (overage_cents
    = overage × aiOverageCents).
  - **Web `BillingPage.tsx` (asıl iş):**
    - Sayaç artık **"N / limit (% used)"** — yüzde metin olarak görünüyor (`ai-counter` /
      `quota-percent` testid). % clamp YOK: aşımda gerçek değer (ör. %105) gösterilir.
    - **%80 proaktif uyarı**: `quota_warning` (backend ≥%80) true olunca belirgin `role="alert"`
      bildirim — aşım öncesi "%X kullandınız", aşımda "dahil kotayı aştınız + çözüm-başı fiyat".
    - **Aşım paketi**: her zaman görünen kart — çözüm-başı fiyat + 50'lik paket boyu + paket fiyatı
      (50 × birim) + bu dönem ücreti (`overage-charge`). Paket bir fiyat demeti; fatura çözüm-başı
      ölçüldüğü için kısmi paket tam paketten ucuz (yanıltıcı "tam-paket faturalama" iddiası yok).
  - **Test:** yeni `BillingPage.test.tsx` (5 test): sayaç N/limit(%), <%80 uyarı yok, =%80 proaktif
    uyarı, aşım paketi fiyatı önden, aşım ücreti (%105 + $5.00). `reports-billing.test.ts`'e
    `overage_unit`/`overage_unit_price_cents` assertion eklendi.
- Doğrulama (DoD kapısı — hepsi yeşil): `typecheck` ✅ · `lint` ✅ · `build` ✅ ·
  `test:unit` ✅ (web 256; +5 BillingPage) · `test:integration` ✅ (566, seri concurrency=1;
  reports-billing + contract-parity dahil) · prettier --check ✅.
  - **E2E re-run edilmedi:** değişen DOM'a dokunan e2e assertion'ı yok — `billing.spec.ts` yalnız
    "Manage plan"/trial rozetini, `reports.spec.ts` değişmeyen "AI resolutions" başlığını doğrular;
    task test stratejisi zaten "unit" diyor.
- Varsayım: aşım fiyatı = **kod gerçeği** ($0.50/çözüm = `AI_OVERAGE_CENTS`), PRD Gözlem'indeki
  kaynak-ürün "$49.50/50" değil (Nexa kararı §684: $0.50–0.75/çözüm). Paket fiyatı bundan türetildi
  ($25.00/50).
- Sonraki pencereye not: 10.1.5-a (API calls aşım paketi + sayaç) hâlâ ⬜ — aynı desen
  (`usage.api_calls`'a overage alanları + UI). `.parked-playbook/` commit'e DAHİL EDİLMEDİ (bkz. e807983).

### 37 — 02.1.2-a · Inbox AI Agents grubu (AI/Solved) [XHIGH] — done — 2026-07-26 UTC

- Yapıldı (contract-first; ADR-09 ile birebir hizalı):
  - **Kontrat:** `paths/chats.yaml` `view` enum'una `ai` + `ai_solved` eklendi (+ açıklama);
    `contract generate` ile `dist/openapi.json` + `src/generated/api.ts` yenilendi.
  - **Backend:** `chats.ts` route enum + `chat-service.ts` `ChatListOptions.view` + `viewFilter`:
    - `ai` = aktif chat, aktif thread'de **bot event var + agent event yok** → AI'ın fiilen
      yürüttüğü konuşma. Bot-event şartı, agent event'i olmayan **bekleyen insan-kuyruğu** chat'i
      ile karışmayı önler → KK _"AI konuşmalarını insan kuyruğundan ayırır"_.
    - `ai_solved` = kapalı chat + agent event yok → **ADR-09'un birebir predicate'i** (reports.ts
      `automated = NOT active AND NOT agent-event` ile aynı satır). Solved listesi ile fatura sayacı
      asla ayrışmasın diye Solved'a ekstra koşul (ör. "bot event olmalı") **EKLENMEDİ**.
  - **Frontend:** `types.ts` `InboxView` + `useInbox.ts` `useViewCounts` (2 yeni sayaç) +
    `InboxPage.tsx` kenar çubuğunda "AI Agents" grubu (AI agent ✦ / Solved ✓) + boş-durum metinleri.
- Doğrulama (hepsi exit 0): `pnpm -w typecheck` ✅ · `pnpm -w lint` ✅ · `pnpm -w test:unit` ✅
  (web 251) · `pnpm -w test:integration` ✅ (**26 dosya / 565 test**; `chats.test.ts` "AI Agents group"
  **3 yeni test**: AI chat ayrı grup + insan kuyruğundan ayrık · agent yanıtı → gruptan düşer ·
  Solved=ADR-09 [Solved listesi == `usage_records.ai_resolutions`] + human-closed ne Solved'da ne
  sayaçta) · `pnpm -w build` ✅ · contract-parity ✅.
- Varsayımlar:
  - **`ai` = aktif + bot-event + agent-event-yok:** AI responder olaylarını `author_type='bot'`
    yazar, insan atamaz (`ai-responder.ts`); bot-event şartı AI'yı boş insan-kuyruğundan ayırır.
  - **`unassigned` semantiği değiştirilmedi:** bot yanıtlayıp çözemeyen chat gerçekten bir insanı
    bekliyor (`ai-responder.ts`'in kendi yorumu); onu human-queue'dan silmek kapsam + regresyon
    riski. Ayrım "AI grubunun kendi listesi" ile sağlandı (grup, insan-kuyruğu chat'ini yutmuyor).
- Sonraki pencereye not:
  - **E2E:** Kabul kriteri task test-stratejisi gereği **integration** ile doğrulandı; UI eklemesi
    deklaratif (heading + 2 ViewButton), web unit + build yeşil, mevcut e2e nav iddiaları (demo-flow
    'Inbox views' badge, inbox-tabs traffic tablist) etkilenmez → yeni E2E akışı yok (tm 34/35 deseni).
  - PRD 02.1.2 derin rotalar (`/inbox/ai-agents/{uuid}/active`) uygulanmadı — grup listesi + Solved
    sayacı KK'yı karşılıyor; per-AI-agent uuid alt-rotaları MOD-04/06 kapsamında.

### 35 — 08.5 · Omnichannel adaptörleri (MOCK) [XHIGH] — done — 2026-07-26 UTC

- Yapıldı (4 alt-görev, contract-first; negatif/izolasyon testleri pozitiften önce):
  - **35.1-a Ortak adaptör + `channels` tüketicisi:** `services/channels/channel-adapter.ts`
    (`ChannelAdapter`: `parseConnect`/`parseInbound`/`send`; `CHANNEL_TYPES=messenger/twilio/whatsapp`)
    + `registry.ts`. `channel-service.ts` `channels` tablosunu **ilk kez** tüketir (connect→status
    `connected`+`config.address`; list; disconnect→`off`). İki yeni tablo (migration
    `20260726120000_omnichannel_adapters`): `channel_identities` (license,type,external_id → customer;
    dönüş yapan gönderici tek geçmiş) + `channel_messages` (inbound/outbound denetim izi). Pre-tenant
    `channel_resolve_license(type,address)` **SECURITY DEFINER** (e-posta/chat-page ile aynı desen).
    Hepsi RLS + `nexa_app` grant.
  - **35.2/.3/.4 Messenger/Twilio/WhatsApp (MOCK):** `messenger.ts`/`twilio.ts`/`whatsapp.ts` — her
    biri mock connect (OAuth code→page token · Twilio SID+numara · WABA linking), provider webhook
    parse, mock outbound (`mid.`/`SM`/`wamid.` id). Inbound → widget'ın kullandığı
    `ChatService.start`/`sendEvent` ile **aynı çekirdek** (routing, realtime, invariant, AI-resolution
    muhasebesi bedava). Outbound → `adapter.send` + `channel_messages` kaydı.
  - **Kontrat:** `paths/channels.yaml` 5 yeni operasyon (list/connect/disconnect/messages/webhook) +
    `openapi.yaml` şemalar (`ChannelType`/`ConnectedChannel`/`ChannelSendResult`) + `ChannelTypePath`;
    `channels--all:ro/rw` scope (`@nexa/types` + `ADMIN_SCOPES`). `contract generate` çalıştırıldı.
- Doğrulama (hepsi exit 0): `pnpm -w typecheck` ✅ · `pnpm -w lint` ✅ · `pnpm -w test:unit` ✅
  (api `adapters.test.ts` 15 test) · `pnpm -w test:integration` ✅ (**26 dosya / 562 test**; yeni
  `channels-adapters.test.ts` 26 test: inbound→chat · returning-sender reuse · outbound by-chat/
  by-external · cross-tenant × 3 · scope · connect/list/disconnect; contract-parity + route-config
  dahil) · `pnpm -w build` ✅ · `db:check-drift` ✅ (drift yok). Migration `migrate deploy` ile
  uygulandı, Prisma client generate edildi.
- Varsayımlar:
  - **Kanal adresi (page_id/telefon) global tekil** — gerçekte bir sayfa/numara tek workspace'e aittir;
    `channel_resolve_license` `(type,address)` ile eşler, cross-tenant testler farklı adres kullanır.
  - **SMS kanal tipi = `twilio`** — `channels_type_check`'in izin verdiği değer (`'sms'` değil; status
    da `'connected'`/`'off'`, `'on'` değil). Bu iki kısıt yeni tablo değil, mevcut `channels` içindi.
  - **Outbound producer-side wiring 34'teki gibi ayrı bırakıldı:** ajan yanıtı otomatik kanala
    çıkmıyor; `POST /channels/:type/messages` + `sendOutbound` ile test edilir. `ChatService.sendEvent`'i
    kanala bağlamak ayrı entegrasyon işi (chat core'a dokunur, 35 KK dışı).
  - **Twilio auth_token connect'te doğrulanır, saklanmaz** (secret kanal config'inde tutulmaz).
- Sonraki pencereye not:
  - **E2E N/A:** arka-uç/server-to-server, yeni UI akışı yok (tm 34 ile aynı gerekçe); kapsanan akış
    (connect→inbound→chat→outbound) integration ile uçtan uca doğrulandı.
  - Instagram (08.5.7) / Telegram (08.5.8) aynı adapter deseniyle eklenir; `channels_type_check`
    ikisine de zaten izin veriyor (yeni migration gerekmez, sadece adapter + registry kaydı).
  - Inbound webhook **public + imzasız** (mock provider); production'da provider imzası edge'de
    doğrulanmalı (§9, kapsam dışı).

### 34 — 08.8.4 · Webhooks [MAX] — done — 2026-07-26 UTC

- Yapıldı (4 alt-görev, contract-first; negatif testler pozitiften önce):
  - **34.1-a Kayıt API + kontrat:** `packages/contract/openapi/paths/webhooks.yaml` +
    `openapi.yaml` (Webhook/WebhookRegistration/WebhookAction şemaları, `Webhooks` etiketi,
    `/webhooks` + `/webhooks/{webhookId}` yolları) → `contract generate`. `routes/webhooks.ts`
    (POST/GET/DELETE; scope `webhooks--all:rw`/`:ro`). `services/webhooks/webhook-service.ts`
    (register/list/unregister). **Secret bir kez** register yanıtında döner; `list` `secret_key`
    kolonunu **hiç seçmez** (SAFE_SELECT). server.ts'e register edildi.
  - **34.2-b HMAC-SHA256 [MAX]:** `services/webhooks/signature.ts` — `signWebhook`
    (`X-Webhook-Timestamp/Nonce/Signature: sha256=…`, imza = `HMAC(secret, "{ts}.{nonce}.{body}")`,
    v2-04 §6.2) + `verifyWebhook` (±5 dk pencere, nonce tekilliği, `constantTimeEqual`).
    Secret asla loglanmaz/gövdede taşınmaz.
  - **34.3-c SSRF [MAX]:** `lib/ssrf.ts`'e `assertPublicHttpUrlResolved` eklendi — literal guard
    (mevcut `assertPublicHttpUrl`) + **DNS çözümleme** ve her çözülen IP için `isBlockedHost`
    (rebinding/TOCTOU). Kayıtta literal guard (400), teslimat yolunda resolved guard **her
    gönderimde tekrar**; sender `redirect:'manual'` → 3xx başarısızlık (redirect izlenmez), yalnız http(s).
  - **34.4-d Teslimat + retry + log:** `services/webhooks/webhook-dispatcher.ts` — 3× exponential
    retry, **her deneme** `webhook_deliveries`'e bir satır (NFR-M5), son başarısız denemede
    `permanent=true`. Yeni migration `20260726090000_webhook_deliveries` (tablo + FK cascade +
    `attempt>=1` check + RLS `webhook_deliveries_tenant` + `nexa_app` grant); Prisma `WebhookDelivery`
    modeli + License/Webhook ilişkileri. Sender/resolver/sleep enjekte edilebilir (ağ mock'lu).
- Doğrulama (hepsi exit 0): `pnpm -w typecheck` ✅ · `pnpm -w lint` ✅ · `pnpm -w test:unit` ✅
  (api: signature 10 + ssrf 15 dahil 125; web 251) · `pnpm --filter @nexa/api test:integration` ✅
  (25 dosya / **536 test**, contract-parity + route-config dahil; `webhooks.test.ts` 12 test) ·
  `pnpm -w build` ✅. Yeni migration DB'ye `migrate deploy` ile uygulandı, Prisma client generate edildi.
- Varsayımlar:
  - **Signing key saklanır (hash değil).** Alt-görev notu "hash saklanır" der; ama HMAC simetrik —
    sunucu her **giden** teslimatı bu secret ile **imzalar**, dolayısıyla hash imzalamayı imkânsız
    kılardı. Şema kolonu da `secret_key` (verifier değil). "Bir kez gösterilir" tek mümkün yolla
    sağlandı: register'da döner, `list` asla döndürmez. (Kod + bu notta gerekçe var.)
  - **Kayıtta literal SSRF, teslimatta resolved SSRF.** Kayıtta DNS çözümlemesi çevrimdışı/CI'da
    pozitif hostu (`hooks.example.test`) kırardı ve TOCTOU nedeniyle asıl koruma zaten teslimat
    anındadır — bu yüzden kayıt literal guard, teslimat resolved+redirect guard yapar.
  - **Kuyruk = in-process dispatch-with-retry** (ağ mock ilkesiyle tutarlı). Kalıcı kuyruk
    (Redis/BullMQ) yalnız `dispatch`'in çağrıldığı yeri değiştirir, teslimat mantığını değil.
- Sonraki pencereye not:
  - Dispatcher **üretici uçlara henüz bağlı değil** — domain olayları (chat_started/deactivated/
    transferred, event_created, ticket_created) `WebhookDispatcher.dispatch(action, payload)` çağırmalı.
    Bu ayrı bir entegrasyon işi (chat/ticket servislerine dokunur), 34'ün KK'sı dışında bırakıldı.
  - Alıcı-taraf `verifyWebhook` referans olarak sağlandı; nonce store production'da Redis SETNX+TTL≈310s olmalı.
  - E2E: bu görev arka-uç/server-to-server, yeni UI akışı yok → yeni Playwright akışı N/A;
    kapsanan akış (register→deliver) integration ile uçtan uca doğrulandı.

### PARK — `.parked-playbook/` (commit'lenmedi) — 2026-07-26 UTC

- Depo kökündeki `.parked-playbook/` **bilinçli olarak commit dışı** bırakıldı (düzeltme
  penceresi, 2026-07-26). İçerik: `RecommendedSkills.{tsx,test.tsx}`, `SkillBrowser.{tsx,test.tsx}`,
  `skill-filters.{ts,test.ts}` — 05.x Skills modülünün **eski/alternatif** implementasyonu.
- Neden park: uygulamadaki güncel sürüm bunların yerini aldı. `apps/web/.../RecommendedSkills.tsx`
  yeni imzayla (`onTry`/`onBrowseAll`, `recommendedTemplates()`, `findCategoryMeta`) canlı;
  `SkillBrowser`/`skill-filters` ise app'te **hiçbir yerde referanslanmıyor** (grep temiz) — yani
  ölü/deneysel kod. Build'e girmiyor. Bu yüzden repoya alınmadı; ihtiyaç olursa buradan diriltilir,
  yoksa temizlik turunda silinebilir. (`.gitignore`'a eklenmedi; kasıtlı görünür bırakıldı.)

### 33 — 06 · AI Agent + Knowledge tamamlama [MAX] — done — 2026-07-26 UTC

- Yapıldı (6 alt-görev, contract-first):
  - **06.1-a Sekmeler + readiness:** `PlaybookPage` artık tek "AI Agent" yüzeyi —
    `role=tablist` (Performance/Profile/Skills/Knowledge; landing = Skills, E2E uyumu için).
    Saf `readiness.ts` (`evaluateReadiness`): KB **ve** skill boşsa "not ready" → ajan kartında
    "Resume" **pasif** + gerekçe uyarısı. Skills görünümü eski liste/filtre/editor'ü aynen taşır.
  - **06.2.4-a Ordered steps [MAX]:** `step-reorder.ts` (`moveStep` + `describeMove` +
    `stepIssues`). SkillEditor adımları **drag** + **klavye** (↑/↓, `aria-label`, `aria-live`
    duyuru; adımlar stabil id ile anahtarlanıp odak taşınır). `transfer_to_team` için **düzenlenebilir
    Team alanı**; zorunlu param boşsa satır-altı hata + **Save pasif** ("Fix N steps").
  - **06.3.1-a Knowledge alt-sekmeler:** `knowledge-tabs.ts` (All/Websites/Files/Articles/FAQ tür
    partisyonu) → KnowledgePanel'de sekme şeridi + sayaçlar.
  - **06.3.2-a Website crawl + SSRF [MAX]:** `lib/ssrf.ts` (`assertPublicHttpUrl` — http/s dışı,
    kimlik, private/loopback/link-local/CGNAT/mapped-IPv6/`localhost` reddi; **08.8.4-c ile paylaşılacak
    ortak modül**). `services/ai/web-crawler.ts` (deterministik mock fetcher + gerçek HTML→text parse).
    `POST /knowledge-sources` genişletildi: `type=website` → SSRF guard (tx dışında) → crawl → chunk+embed;
    `source_url` saklanır; içerik/URL `type`'a göre superRefine ile zorunlu.
  - **06.4-a Profile (persona):** GET/PATCH `/ai-agents` persona alanlarını açar
    (`avatar_url`/`languages[]`/`answer_length` → persona JSON'a **merge**, imza korunur). `ProfileForm.tsx`
    (zorunlu isim → Save pasif; canlı persona önizleme). Widget persona'yı zaten okuyor (11.3).
  - **06.5-a Performance:** `performance.ts` (`/reports/ai-agent`+overview'dan KPI; **düşük-baz uyarısı**;
    ADR-09 = fatura ile aynı sayı). `AiPerformance.tsx` (Kpi kartları; AI-off → "historical" ayrımı;
    `reports_read` yoksa erişim mesajı).
  - **Kontrat:** `openapi.yaml` (AiAgent persona alanları, KnowledgeSource `source_url`) + `playbook.yaml`
    (updateAiAgent/createKnowledgeSource gövdeleri) güncellendi, generated types + bundle yeniden üretildi
    (parity path-düzeyinde korunur — yeni endpoint yok, mevcut genişletildi).
- KK (birebir): 06.1 "tek yerde persona+yetenek+bilgi+performans; readiness" ✅ · 06.2.4 "drag reorder
  - klavye; zorunlu param boşsa hata" ✅ · 06.3.1 "tür bazlı filtre" ✅ · 06.3.2 "geçersiz URL/tür reddi;
    crawl/parse; RAG indeksleme" ✅ (bulk/CSV kapsam dışı) · 06.4 "widget'ta persona; çok dilli; zorunlu
    isim" ✅ · 06.5 "KPI kartları; düşük-baz uyarısı; AI off arşiv ayrımı" ✅.
- **Test (yeni):** web unit +6 dosya (readiness/knowledge-tabs/step-reorder/performance saf + ProfileForm/
  AiPerformance/SkillEditor bileşen) → web unit **251**. api unit +2 (ssrf/web-crawler) → **109**.
  integration +2 (ai-agent-profile 6, knowledge-crawl 11 — **SSRF negatifleri pozitiften önce** +
  cross-tenant) → **524**. E2E +1 (`ai-agent.spec`: sekmeler + persona round-trip + website crawl) → **53**.
- Doğrulama (hepsi exit 0): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w build` · `pnpm -w test:unit` ·
  `pnpm -w test:integration` (**524**, contract-parity dahil) · `pnpm -w test:e2e` (**53/53**).
- Varsayımlar: `answer_length` şemada ayrı kolon değil → persona JSON'da (`answerLength`). Website fetcher
  MOCK (deterministik, ağ yok) — SSRF guard yine de URL'i doğrular; **gerçek fetcher DNS-rebinding için
  çözümlenen IP'yi de tekrar kontrol etmeli** (ssrf.ts'te not var).
- Sonraki pencereye not:
  - **E2E temiz DB ister:** global-setup seed'i idempotent — mevcut tenant'ı SIFIRLAMAZ; suite'i
    kirli veriyle art arda koşarsan customers/settings testleri kırılır. Koşmadan önce (bu pencerede
    yapıldığı gibi) tabloları truncate + `pnpm db:seed`, `.env`'i source'la, portları (4000/4001/5173/5174)
    boşalt ki Playwright sunucuları `RATE_LIMIT_ANON_PER_MIN=2000` ile başlatsın.
  - **08.8.4-c webhook** artık `lib/ssrf.ts`'i paylaşacak (import et, yeniden yazma).

### 32.4 — 05.4-a · Liste kontrolleri (Search/Sort/Filter) — done — 2026-07-26 UTC

- Yapıldı:
  - **Saf kontrol modülü** `apps/web/src/features/playbook/skill-filter.ts`: `applySkillControls`
    (ada göre arama + tür/durum/sahip filtre + sıralama; filtreler yalnız daraltır, girdi
    mutasyonsuz), `skillMatchesControls` (satır-başı yordam), `hasActiveSkillFilters`,
    `skillOwnerOptions` (listede fiilen bulunan sahipleri "All owners / <ajan> / Unassigned"
    olarak türetir). **tür** = `kind` (AI `ai_agent` vs Workspace, on/off'tan bağımsız — sekmelerden
    farkı bu), **durum** = `active` (On/Off), **sahip** = `ai_agent_id`. Sıralama: Name A–Z / Z–A /
    Recently updated / Most used.
  - **PlaybookPage bağlandı:** sekmelerin (32.3) ALTINA arama kutusu (200 ms debounce → `query`) +
    Type/Status/Owner/Sort `<select>` (jenerik `FilterSelect` alt-bileşen, `htmlFor`-kardeş label) +
    koşullu **Clear**. Sekme = kaba kesit, kontroller = ince:
    `applySkillControls(filterSkillsByTab(items, tab), controls)`. Filtre hiçbir şeyle eşleşmezse
    ayrı "No skills match" + "Clear filters" boş-durumu; sahip listeden düşerse select "All"e döner.
    Backend/şema/kontrat **dokunulmadı**.
- KK (birebir): _"Ada göre arama; tür/durum/sahip filtre"_ ✅ (+ scope: sıralama ✅).
- **Test (yeni):** unit `skill-filter.test.ts` (16) — her eksen tek+bileşik daraltır, sıralama saf
  yeniden-sıralar (girdi mutasyonsuz), owner-opsiyon türetimi. web unit 208 (yeni 16 dahil).
- Doğrulama (hepsi exit 0): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w build` ·
  `pnpm -w test:unit` (web 208) · `pnpm -w test:integration` (**507**, backend'e dokunulmadı) ·
  `pnpm -w test:e2e` (**50/50** — `.env` source'lanıp taze sunucularla).
- **E2E'de yakalanan gerçek regresyon (düzeltildi):** ilk kontrol sürümü `getByLabel('Name')`
  strict-mode'unu bozdu — Playwright substring eşler, benim eklerimdeki "name" jetonu iki yere
  sızıyordu: (1) aramanın "…by name" sr-only etiketi, (2) Sort `<select>`'i `<label>` ile SARILDIĞI
  için option metinleri ("Name A–Z"…) kontrolün erişilebilir adına katılıyordu. Düzeltme: arama
  etiketi "Search skills", `FilterSelect` label'ı select'i sarmaz (kardeş `htmlFor`) → editörün Name
  alanıyla çakışma kalktı, ekran okuyucu için de daha temiz.
- Varsayımlar: **"sahip" (sahip filtresi) = skill'in bağlı olduğu AI ajanı (`ai_agent_id`)** — skill
  kontratında insan yaratıcı alanı (`created_by` serialise edilmiyor) yok; kontratı genişletmek 05.4
  (frontend liste kontrolü) kapsamı dışı olurdu.
- Sonraki pencereye not: 32.4 parent **32**'nin (FR-MOD-05) SON alt-görevi → parent **done**; PLAN
  §4.1 05.1–05.4 tümü ✅ (tm-plan-conflict bulguları böylece kapanır). **E2E ipucu:** tam suite'i
  koşarken önce bayat `:4000/:4001` dev sunucularını öldür ve `.env`'i source'la — reuse edilen api
  raised rate-limit (`RATE_LIMIT_ANON_PER_MIN=2000`) taşımaz, taze spawn ise DB/secret env'e muhtaç.

### 32.2 — 05.2-a · Recommended skills kartları (Try this / See more) — done — 2026-07-26 UTC

- Yapıldı:
  - **Önerilen şablon şeridi** `apps/web/src/features/playbook/RecommendedSkills.tsx`: PlaybookPage'de
    inline `Section` (galeriden ayrı — modal değil). Kartlar kategori rozetli (Prebuilt ◆ / AI ✦ /
    Trending ↗); **"Try this"** şablonu kopyalayıp editörü ön-dolu açar — galerinin "Use template"
    akışıyla **aynı** `createFromTemplate` round-trip'i; **"See more"** tam galeriyi açar.
  - **Entegrasyon uyarısı:** `requiresIntegration` taşıyan kart ("Needs the Shopify app connected.")
    şeritte de, seçmeden önce uyarır.
  - **templates.ts** eklendi: `RECOMMENDED_TEMPLATE_IDS` (3 kategoriyi kapsayan, biri Shopify=entegrasyon
    gerektiren kürasyonlu kısa liste; sıra korunur), `recommendedTemplates()` (çözülmeyen id'yi delik
    bırakmadan düşürür), `findCategoryMeta()` (kart rozeti için ikon+etiket).
  - **PlaybookPage bağlandı:** AI-agent kartından sonra, Skills/Editor grid'inden önce; `canEdit`-gated
    (yalnız düzenleyebilen skill üretebilir). `onTry`→`createFromTemplate.mutate`, `onBrowseAll`→galeri.
    Backend/şema/kontrat **dokunulmadı**.
- KK (birebir): _"[Try this] şablonu kopyalayıp editöre açar; entegrasyon gerektirenler uyarır"_ ✅.
- **Test (yeni):** unit `RecommendedSkills.test.tsx` (5) — kategori etiketleri, Try this→doğru şablon,
  entegrasyon kartı uyarır, See more→galeri, pending yalnız o kartı meşgul eder; `templates.test.ts`
  (+6) — recommended id'ler çözülür/sıra korunur/3 kategoriyi kapsar/entegrasyon kartı var + findCategoryMeta.
  E2E `playbook.spec.ts` (+1) — recommended "Try this" → ön-dolu editör (kanit/32-recommended-try-this.png).
- Doğrulama (hepsi exit 0): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w build` ·
  `pnpm -w test:integration` (**507**, backend'e dokunulmadı → regresyon yok) · web unit (**192**,
  yeni 11 dahil) · api unit (**601**) · rtm (65)/widget (34)/types (26)/ai-mock (42) ·
  e2e `playbook.spec.ts` (**2/2**, yeni Try-this akışı dahil).
  `pnpm -w test` (turbo, tümü paralel) uzun api süiti + paylaşılan Postgres yarışı yüzünden zaman
  aşımına uğruyor — bilinen altyapı sorunu (memory: DB süitleri seri koş); paket-paket **seri**
  koşulunca hepsi yeşil.
- Sonraki pencereye not: **32.4** (liste kontrolleri Search/Sort/Filter — 32.3'e + form desenine
  bağımlı) kaldı → 32 parent'ın son subtask'ı; 32.1/32.2/32.3 done. Recommended şerit `canEdit`
  false iken gizli (görüntüleyen zaten skill üretemez).

### 32.3 — 05.3-a · Skill listesi sekmeleri (All/AI/Workspace/Drafts) — done — 2026-07-26 UTC

- Yapıldı:
  - **Saf sınıflandırma modülü** `apps/web/src/features/playbook/skill-tabs.ts`: `classifySkill`
    (aktif değil → `drafts`; aktif + `kind==='ai_agent'` → `ai`; aktif + diğer kind → `workspace`),
    `filterSkillsByTab`, `countSkillsByTab`. **Bölüntü (partition):** her skill tam bir sekmeye
    düşer → `All = AI ∪ Workspace ∪ Drafts` (çakışma yok, kayıp yok).
  - **PlaybookPage bağlandı:** "Skills" bölümünün üstünde `role="tablist"` (All / AI ✦ / Workspace ⚡ /
    Drafts), sekme başına sayaç; liste seçili sekmeye göre filtrelenir (`role="tabpanel"` ile ilişkili).
    Seçim tüm liste üzerinden aranır → sekme değişince açık skill kapanmaz. Sekmeye özel boş-durum
    metinleri; hiç skill yokken tablist gizli, onboarding empty korunur. Glyph'ler `aria-hidden`,
    ekran okuyucu sadece "AI"/"Workspace" kelimesini okur (mevcut Reports tablist deseniyle aynı).
  - Backend/şema/kontrat **dokunulmadı** — mevcut `Skill.kind`/`active` alanlarından türetilir
    (ADR-14: `workflow` UI'si yok → Workspace sekmesi bugünkü seed'de boş, ileride kind gelince dolar).
- KK (birebir): _"AI (✦) vs Workspace (⚡) vs taslak ayrımı"_ ✅ (tablist + kind/active filtresi).
- **Test (yeni):** unit `skill-tabs.test.ts` (12) — her sekmenin doğru alt kümesi + partition
  invariantı (disjoint & tam) + sayaçlar + sıra korunur + input mutasyonu yok.
- Doğrulama (hepsi exit 0): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w build` ·
  `pnpm -w test:integration` (**507**, backend'e dokunulmadı → regresyon yok) · web unit (**181**,
  yeni 12 dahil) · api unit (**601**) · e2e `playbook.spec.ts` (PlaybookPage değişti → yeşil doğrulandı).
  `pnpm -w test` (turbo) api+e2e'yi paylaşılan Postgres'e **paralel** koşup seed FK yarışına
  (`tags_license_id_fkey`) düşüyor — bilinen altyapı sorunu (memory: DB süitleri seri koş); her paket
  **seri** koşulunca yeşil. Full e2e'deki 3 flake (settings/team, login anon rate-limit throttle)
  izole koşuda 14/14 yeşil — 32.1 notundaki bilinen durumla aynı, bu değişiklikle ilgisiz.
- Sonraki pencereye not: **32.2** (Recommended skills kartları, 32.1'e bağımlı) ve **32.4** (liste
  kontrolleri Search/Sort/Filter, **32.3'e bağımlı** — artık açık) kaldı. 32.4 bu sekme filtresinin
  üstüne kurulur (`filterSkillsByTab` sonucu → arama/sıralama). Parent 32 hâlâ in-progress (32.2/32.4 açık).

### 32.1 — 05.1-a · Browse templates galerisi — done — 2026-07-26 UTC

- Yapıldı:
  - **Şablon galerisi** `TemplateGallery.tsx` (modal, a11y: labelled dialog, Escape/backdrop kapatır,
    focus içeri) + deterministik yerel katalog `templates.ts` (Prebuilt/AI/Trending; her şablon
    `POST /skills`'in doğruladığı `SkillStep` şekillerinde — `templates.test.ts` bunu ispatlar;
    entegrasyon gerektirenler kartta uyarır).
  - **PlaybookPage bağlandı:** header'a "Browse templates" → galeri; kart "Use template" →
    `POST /skills {name,instruction,steps,ai_agent_id?}` (templateToDraft) → yeni skill seçilir →
    editör **ön-dolu** açılır (KK: "Şablon galerisi; tür seçimi → editör").
  - **Bug bulundu + düzeltildi:** create sonrası editör açılmıyordu — `invalidate()` refetch
    penceresinde guard-effect (`selectedId ∉ items → null`) seçimi sıfırlıyordu. Çözüm:
    `queryClient.setQueryData` ile listeyi **senkron** seed'le, sonra seç, sonra invalidate.
    (E2E önce bu yüzden kırmızıydı, sonra yeşil.)
- KK (birebir): _"Şablon galerisi; tür seçimi → editör"_.
- **Test (yeni):** unit `templates.test.ts` (7) + `TemplateGallery.test.tsx` (5) · E2E
  `apps/e2e/tests/playbook.spec.ts` (galeri aç → kart seç → editör ön-dolu: name/instruction/steps).
- Doğrulama (hepsi exit 0): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w test:unit` (web 169) ·
  `pnpm -w test:integration` (**507**, backend'e dokunulmadı → regresyon yok) · `pnpm -w build` ·
  e2e `playbook` yeşil. Full e2e'de team/settings 3 test **login anon rate-limit** throttle'ına
  takıldı (playwright config'in uyardığı, reuse edilen api server'da limit yükseltilmemiş) →
  izole tekrar koşuda 14/14 yeşil, benim değişikliğimle ilgisiz.
- **Kapsam notu (ÖNEMLİ):** Önceki pencere 32.1-32.4 dosyalarını topluca bırakmış ama PlaybookPage'i
  yarım bağlamış (importlar var, JSX yok; `VirtualList` importu düşmüş). 32.2/32.3/32.4 dosyaları
  (`RecommendedSkills*`, `SkillBrowser*`, `skill-filters*`) **tipcheck'i kırıyordu** ve kapsam dışıydı;
  silmedim → `/.parked-playbook/`'a taşıdım. Sonraki pencereler oradan devam edebilir veya task
  tanımına göre sıfırdan kurabilir.
- Sonraki pencereye not: **32.2** (Recommended skills, 32.1'e bağlı) — `templateToDraft` + galeri
  deseni hazır; PlaybookPage'e RecommendedSkills'i "Try this → editör kopya" olarak benzer şekilde bağla
  (parked dosya bir başlangıç). **32.3** liste sekmeleri + **32.4** Search/Sort/Filter sırada.
  Parent **32** in-progress kalır (32.2-32.4 pending).

### 31 — T7-a · 13.8 E-posta bildirim kanalı (kullanıcı tercihi + gating) — done — 2026-07-25T20:40Z UTC

- Yapıldı:
  - **Denetim bulgusu düzeltildi:** e-posta kanalı ZATEN vardı (tm 16, `customer.ts#notifyAssignee`
    atanan ajana `.data/mail`'e yazıyor) ama **tercihe bağlı değildi**. Açık olan tek şey buydu.
  - **Kullanıcı tercihi:** `agent_memberships.notify_email` (default `true`) + migration
    `20260725110000_notify_email_preference`. Lisans başına + kullanıcı başına → RLS tenant'a kilitler
    (FR-MOD-08.2 "kullanıcı bazında").
  - **Saf karar fonksiyonu** `services/notifications/assignee-email.ts#shouldEmailAssignee`
    (type-guard): assignee yok / opt-out / adres yok → gönderme. `notifyAssignee` bununla geçitli;
    membership.notify_email okunuyor.
  - **Ayarlanabilir:** `PUT /agents/me/notification-preferences {email}` (agents.ts) +
    `/auth/me` içinde `notify_email`. Web: Settings bildirimler kartına hesap-düzeyli
    "Email notifications" toggle (optimistic + rollback, `auth-store#setNotifyEmail`).
  - **Contract:** openapi.yaml + paths/agents.yaml + auth.yaml + generated types regenerate
    (`setMyNotificationPreferences`). contract-parity yeşil.
- KK (PRD birebir): _"Bkz. FR-MOD-08.2; kanallar arası tutarlı" · 08.2 "…e-posta… tercihleri; kullanıcı bazında"_.
- **Test (yeni):** unit `assignee-email.test.ts` (5, karar fonksiyonu) · integration
  `notifications.test.ts`'e +2: tercih kapalıyken düşmüyor · cross-tenant (yalnız aynı lisansın
  ajanına, `fx.b.agentEmail`'e asla).
- Doğrulama (hepsi yeşil, exit 0): `pnpm -w typecheck` (11) · `pnpm -w lint` (8) · `pnpm -w test:unit` ·
  `pnpm -w test:integration` (**507**, notifications 5 + contract-parity 5 + tenant-isolation dahil) ·
  `pnpm -w build` (7) · e2e `notifications`+`settings`+`demo-flow`+`widget` (29) yeşil.
- Varsayımlar: `notify_email` default `true` → mevcut davranış (tm 16 mutlu-yol testi) korunur; tercih
  membership'te (Account'ta değil) çünkü kişi her lisansa ayrı üye. Tetik mesaj-bazlı (mevcut desen);
  "yeni sohbet/atama/mention" bunun üstünde — mention'a özel ayrı kanal v1'e bırakıldı (kapsam dışı).
- Sonraki pencereye not: mailer deseni artık tercih-farkında; **08.7.4-a Chat transcripts** (Should, v1)
  bu mailer'a dayanır. Faz-0 sayacı: T7-a ✅ (13.8 `◐→✅`).

### 30.2 — EK-B.1 T6-b Skeleton + anlamlı empty state deseni (tüm Must listeler) — done — 2026-07-25T20:13Z UTC

- Yapıldı:
  - **Ortak skeleton primitifi** (`components/Skeleton.tsx`): tasarım-sistemi `Skeleton` atomu
    (tek `bg-inset` shimmer bar, width/height CSS uzunluğu) + `ListSkeleton` (Must listeler için
    iki-satırlık satır iskeletleri, `rows` sayısı). Kap tek `aria-hidden` + `animate-pulse`;
    yer-tutucu erişilebilirlik ağacına GİRMEZ → ekran okuyucu boş satır dinlemez ve
    `getByRole('list'/'table'/'row')` yalnız gerçek veriyi yakalar.
  - **4 el-yapımı skeleton kaldırıldı, tek desende birleşti:** `TableSkeleton` (CustomersPage) →
    `ListSkeleton`; yerel `ListSkeleton` (InboxPage) → paylaşılan; TicketPane satır-içi skeleton →
    `ListSkeleton rows={3}`; Teammates tablosu `CardSkeleton rows={4}` → `ListSkeleton rows={4}`.
    `Page.tsx`'teki `CardSkeleton` (Reports/Billing/CustomerDetail/Teams grid kullanır) artık
    `Skeleton` atomunun üstünde — aynı çıktı, tek kaynak.
  - **Anlamlı empty state** zaten `EmptyState` bileşeniyle 4 Must listede bağlıydı (Contacts:
    arama-vs-boş; Teammates; Tickets; Inbox sohbet listesi tab-farkındalıklı) — "boş dikdörtgen"
    yok (design-brief §1.5). Refactor bu kabloları bozmadan korudu.
- KK (PRD birebir): _"...skeleton; her boş liste için anlamlı empty state (boş dikdörtgen yok)"_.
- **Test (yeni):** `components/Skeleton.test.tsx` (7 test) — atom width/height; `ListSkeleton`
  satır sayısı + varsayılan 5 + a11y ağacında GÖRÜNMEZ; gerçek Must liste (Tickets) üç durum:
  yüklenirken→skeleton (list rolü yok), boş→anlamlı empty state (başlık + sonraki adım metni,
  boş dikdörtgen değil), veri→gerçek `role=list`.
- Doğrulama (hepsi yeşil, exit 0): `pnpm -w typecheck` (11 pkg) · `pnpm -w lint` (8 pkg) ·
  `pnpm -w build` (7 pkg) · `pnpm -w test` seri+env (11 task: web **157**, api 594, rtm 65,
  widget 34, ai-mock 42, types 26, e2e 48) · `pnpm -w test:integration` **505/505** · e2e tam
  **48/48** (customers/team/inbox-tabs/inbox-panel dahil — tablo/list/empty sözleşmeleri sağlam).
- Not: `pnpm -w test` turbo varsayılan paralelde api↔e2e Postgres yarışı + e2e webServer'ın kök
  `.env`'i görmemesi → env yükleyip `--concurrency=1` ile seri koş (hafıza notu:
  parallel-DB). Kod değişikliği salt-frontend; backend/rtm/env'e dokunulmadı.
- Sonraki pencereye not: EK-B.1 (tm 30) tümüyle kapandı (30.1 virtualization + 30.2 skeleton/empty).
  v1 gridleri (Apps/Campaigns/Knowledge) hâlâ kapsam dışı — değişken-yükseklik + grid iskeletleri
  o zaman gelir.

### 30.1 — EK-B.1 T6-a Virtualized liste primitifi (Contacts/Teammates/Skills/Tickets) — done — 2026-07-25T17:56Z UTC

- Yapıldı:
  - **Virtualized liste primitifi** (`components/VirtualList.tsx`): saf `computeVirtualWindow()`
    (pencere matematiği) + `useVirtualRows` hook (scroll + `ResizeObserver` ile viewport ölçümü,
    `viewportHeight` verilirse ölçmeyi atlar). İki yüzey tek çekirdeği paylaşır: **`VirtualList`**
    (role="list", spacer `<div>`) ve **`VirtualTable`** (spacer `<tr>`, `<table>`/`<caption>`/kolon
    korunur). DOM'a yalnız görünür pencere + overscan girer; spacer'lar `aria-hidden`.
  - **4 Must liste taşındı:** Contacts (`CustomersPage` → VirtualTable, `<table name="Customers">`
    korundu), Teammates (`TeamPage` → VirtualTable), Skills (`PlaybookPage` → VirtualList),
    Tickets (`TicketPane`/`TicketList` → VirtualList, `maxHeight:100%` pane'i doldurur).
  - **Tasarım kararı:** iki tablo listesi `<table>`/`<tr>`/caption semantiğini korudu — E2E
    `getByRole('table'/'row')` sözleşmesi + kolon hizası bozulmasın diye (tablo varyantı
    spacer-`<tr>`). Sabit satır yüksekliği + overscan; değişken-yükseklik ölçümü v1 gridlerine
    ertelendi (kapsam dışı).
- KK (PRD birebir, bu pay): _"10.000+ satırda 60fps; ... yalnız görünür satır DOM'da"_.
- **PERF KANITI (NFR-P4):** `VirtualList.test.tsx` "NFR-P4 budget" → **10.000 veri satırı → 14 DOM
  satırı, render 0.8ms**. Paint maliyeti düğüm sayısıyla orantılı → sabit ~viewport düğüm = ölçülebilir
  60fps vekili. Sanal-pencere testi ayrıca kanıtlıyor: 10k'da yalnız pencere DOM'da, scroll ile
  pencere kayıyor (üst satır çıkar, derin satır girer).
- Doğrulama (hepsi yeşil): `pnpm -w typecheck` (11 pkg) · `pnpm -w lint` (8 pkg) · `pnpm -w build`
  (7 pkg) · web unit **150** (10 yeni: `VirtualList.test.tsx`) · `pnpm -w test:integration` **505/505**
  · e2e **48/48** (temiz seed'de).
- Varsayımlar:
  - E2E ilk koşularımda 2–3 flaky kırmızı verdi; kök neden **benim tekrar eden widget-e2e
    koşularımın** paylaşılan DB'ye biriktirdiği ~33 anonim ziyaretçi müşterisiydi (seed upsert eder,
    truncate etmez) → seed müşterileri (Alex/Mira/Robin) sanal pencerenin altına gömüldü ve
    filtresiz "all" listesinde tıklanamadı. `test:integration` DB'yi truncate ettikten + e2e
    globalSetup temiz seed (3 müşteri) verdikten sonra **48/48 yeşil**. Kod kusuru değil, veri-hacmi
    artefaktı (izole `customers.spec` baştan 8/8 geçmişti).
  - Sanal liste tasarım gereği yalnız görünür satırı DOM'a koyar → çok uzun listede belirli satıra
    ulaşmak scroll/arama ister (agent'ın olağan yolu; arama/filtre testleri yeşil). Prisma
    `migrate reset` AI-guard + sınır ("DB drop yok") nedeniyle KULLANILMADI; temizlik integration
    truncate + temiz seed ile yapıldı.
- Sonraki pencereye not:
  - **30.2 (T6-b skeleton + anlamlı empty state)** bu primitife bağımlı; aynı liste bileşenlerine
    uygulanacak. **40** (Tickets grid deep-link), **53** (Apps grid), **02.7-a** de buna dayanır.
  - Commit yalnız 6 kaynak dosya + bu HANDOFF notu içerir. `tasks.json` / `CLAUDE.md` /
    `MASTER-PROMPT.md` + `kanit/*.png` + untracked infra dosyaları **dal (plan-expand) işine ait,
    benim commit'ime DAHİL EDİLMEDİ** (kapsam disiplini §5). 30.1 `done` Task Master dosyasında
    yazılı ama tasks.json'da ilgisiz bekleyen değişiklikler olduğundan commit edilmedi.

### 29.3 — EK-A T5-a Yarım-form kapatma onayı + ortak davranış — done — 2026-07-25T17:22Z UTC

- Yapıldı:
  - **Dirty guard** (`lib/dirty-guard.tsx`): saf `confirmDiscard(isDirty, message?, confirm?)` +
    `useCloseGuard({isDirty,onClose,message?,confirm?})`. Kirli form kapatma → onay; temiz form
    onaysız kapanır. Confirmer enjekte edilebilir (test için). InviteTeammates modalındaki elle
    `window.confirm` bloğu bu primitife taşındı — artık tek kaynak (FR-EK-A.2).
  - **Optimistic + rollback** (`lib/optimistic.ts`): `optimisticCacheUpdate({queryClient,queryKey,
update,invalidateKeys?})` → `{onMutate,onError,onSettled}`. cancel→snapshot→guess→hata'da
    rollback→settle'da invalidate deseni tek yerde. İki tüketici: `useInbox.useSendMessage`
    (elle yazılmış optimistic dance yerine helper) + `SettingsPage` routing-rule `toggle`
    (artık optimistic; hata'da geri döner). "Tutarlı davranış; optimistic + hata geri alma" KK ✅.
  - **Stepper** (`lib/stepper.ts`): `useStepper(count)` → index + clamp'li next/back/goTo + isFirst/
    isLast. OnboardingWizard elle `stepIndex` state'i bu hook'a taşındı; sınır aşımı imkânsız.
  - **Kapsam kararı**: ayrı "dropdown wrapper" YAZILMADI — native `<select>`'ler zaten tutarlı,
    tekilleştirilecek tekrar yok (form.tsx felsefesi: gereksiz soyutlamadan kaçın). Notlandı.
- Doğrulama (hepsi yeşil): `pnpm -w typecheck` (11 pkg) · `pnpm -w lint` (8 pkg) ·
  web unit 140 (14 yeni: dirty-guard 6, optimistic 3, stepper 5) · api unit+integration 594 ·
  `pnpm -w test:integration` 505 · `pnpm -w build` (7 pkg) · e2e 48/48 (yeni `team.spec.ts`:
  invite modal yarım-doldur→kapat→onay + temiz modal onaysız kapanır).
- Varsayımlar: `pnpm -w test` (birleşik) api+e2e'yi paylaşılan Postgres'e paralel sürdüğü için
  yarışıp kırmızı verir (bilinen harness artefaktı, kod değil) → DB suite'leri per-package/serial
  koştum, ikisi de yeşil. E2E dev-server'ları RTM env'i process'ten okuduğu için kök `.env`
  export edilerek koşuldu.
- Sonraki pencereye not: EK-A (parent 29) tamamlandı — 29.1+29.2+29.3 done. v1 form görevleri
  (47/50/51/52/43 — Forms builder, Custom fields) bu üç primitife (useForm + dirty-guard +
  optimistic + stepper) dayanabilir.

### 29.2 — EK-A T4-b Kalan Must formlarını primitife taşı — done — 2026-07-25 UTC

- Yapıldı:
  - **Auth formları** (`features/auth/PublicPages.tsx`): SignUp / ForgotPassword / ResetPassword /
    Join → elle `valid` boolean + `email.includes('@')` kaldırıldı, hepsi `useForm` primitifine
    taşındı. Ortak `Field` helper'ı alan-altı hata + `aria-invalid`/`aria-describedby` gösterecek
    şekilde genişletildi; `Submit` prop'u `busy`→`disabled`. Server-hata haritaları korundu
    (account_exists, enumeration-safe forgot).
  - **Sign-in** (`features/auth/SignInPage.tsx`): email/parola `useForm` (email = required+email,
    parola = required); geçersizken "Sign in" pasif, alan-altı hata. İki-adım (workspace seçimi)
    korundu; choose hatası artık adım-2'de de görünüyor.
  - **Settings** (`features/settings/SettingsPage.tsx`): New canned (shortcut+text) ve New tag
    (name) → `useForm({required})`; başarıda `form.reset()` alanları temizler. `CannedResponses`
    ve `Tags` test için `export` edildi.
  - **Kapsam dışı bırakıldı (gerekçeli):** Payment mock = `disabled` inputlar (ADR-13, hiçbir şey
    toplanmıyor → doğrulanacak alan yok); Channels grid = "ekle" formu zaten 29.1 pilotu (Website).
    TrustedDomains = `domain()` katı validatörü "pasted URL → hostname" E2E'sini kırardı → elle bırakıldı.
  - **Testler:** `PublicPages.test.tsx` (SignUp/Reset/Forgot validasyon), `SignInPage.test.tsx`,
    `settings/SettingsForms.test.tsx` (canned+tag: submit-disabled + alan-altı hata). +9 unit.
- Doğrulama (DoD kapısı tam yeşil): typecheck ✅ · lint ✅ · unit ✅ (web 126, api 89) ·
  integration ✅ (api 505, rtm 42) · build ✅ · **E2E tam suite 46/46** ✅ (signup/sign-in/canned/
  tags/payment/channels dahil). Not: rtm integration tek seferlik stateful flake verdi
  (`rtm.test.ts:290` thread-id çakışması, 3-günlük DB birikimi) — izole + temiz koşuda 42/42 geçti,
  frontend değişikliğiyle alakasız.
- Varsayımlar: Sign-in + Join enumerasyona ek olarak taşındı (enumere listede yoktu ama "kalan Must
  form" kapsamında; tek form katmanı hedefi). Auth email validatörü artık katı (regex) — in-app
  oluşturulan tüm hesaplar zaten regex-geçerli.
- Sonraki pencereye not: **29.3** (T5-a) hazır — dirty-guard + ortak dropdown/stepper/optimistic
  tekilleştirme; `form.isDirty` primitifte mevcut. Invite modalı zaten `isDirty` dirty-guard'ı
  kullanıyor (29.1); 29.3 bunu ortak bir sarmalayıcıya çıkarıp diğer modallara yayacak.

### 29.1 — EK-A T4-a Ortak form-validasyon primitifi + 2 pilot form — done — 2026-07-25 UTC

- Yapıldı:
  - **Tek primitif:** `apps/web/src/lib/form.tsx` — bağımlılıksız `useForm` hook + validatörler
    (`required`, `email`, `emailList`, `domain`, `minLength`, `compose`, `splitList`) + `FieldError`
    bileşeni. Frontend'de `zod` yok (web `package.json`'da bağımlı değil, lock churn riski) → KK
    "tek form/validasyon kütüphanesi" için hafif yerli şema tercih edildi. Hook: alan-altı hata
    (touched/submit sonrası görünür), geçersizken `canSubmit=false`, `isSubmitting` (Loading),
    server-hata → `setFieldError`/`setSubmitError`, `isDirty` (29.3 dirty-guard için hazır).
  - **Pilot 1 — Invite teammates** (`features/team/InviteTeammates.tsx`): elle `parseEmails` +
    `invalid[]` + `error` state'leri kaldırıldı → `useForm({emails: emailList()})`. Geçersiz adres →
    alan-altı hata (`role="alert"` FieldError), geçersizken "Invite" pasif. Server `invalid_emails`/
    `authorization` haritalaması korundu (helper'lar). Yarım-form kapatma onayı `form.isDirty`'ye bağlı.
  - **Pilot 2 — Add website** (`features/settings/WebsiteWidgets.tsx`): `domain` state →
    `useForm({domain: compose(required, domainRule)})`. Alan-altı hata + "Add website" geçersizken pasif.
    `domain` validatörü `.localhost`/tireli/rakamlı label'ları kabul eder (E2E dev-domain regresyonu).
  - **Backend/kontrat DEĞİŞMEDİ** — yalnız `apps/web/src` (6 dosya). api/rtm kaynağı el değmedi.
- Doğrulama (hepsi exit 0): `pnpm -w typecheck` ✅ (11/11) · `pnpm -w lint` ✅ (8/8) ·
  `pnpm -w build` ✅ (7/7) · web unit **117** (98→117, +19: `form.test.tsx` 13 = validatör+hook,
  `InviteTeammates.test.tsx` 3, `WebsiteWidgets.test.tsx` 3 — her pilotta "geçersiz→alan-altı hata+
  submit pasif" ve "geçerli→submit aktif") ✅ · E2E `settings.spec -g "site goes Connected"`
  **1 passed** (değişen Add-website akışı uçtan uca; `.env` export şart) ✅.
- Varsayımlar: `zod` yerine yerli primitif (KK "hafif hook/şema"yı açıkça izin veriyor; lock churn'den
  kaçınıldı) — 29.2/29.3 + v1 form görevleri (47/50/51/52/43) bu `useForm`/validatör API'sine dayanır.
  Invite'ta geçersiz satır artık submit'i tümden pasifleştirir (KK "geçersizken submit pasif" > eski
  "kısmi kabul" felsefesi); server yine güvenlik ağı. Select'ler (role/setup) validasyonsuz → form dışı
  local state.
- Sonraki pencereye not: 29.2 (kalan Must formları) ve 29.3 (dirty-guard tekilleştirme) `lib/form.tsx`
  primitifine bağımlı — aynı API'yi kullan. E2E'den önce kök **`.env` export** (rtm self-load etmiyor):
  `set -a && . ./.env && set +a`. Task Master 29.1 diskte **done**; tasks.json bu commit'e alınmadı
  (dalın deseni: periyodik `chore(taskmaster)`). Integration suite koşulmadı — bu iş frontend-only,
  api/rtm kaynağı değişmedi (git diff = yalnız apps/web).

### 28 — 01.3 Sağ panel switcher (Details/Expand + persist) — done — 2026-07-25 UTC

- Yapıldı:
  - **Tercih deposu:** `apps/web/src/features/inbox/rightPanel.ts` — `nexa.inbox.right-panel`
    localStorage anahtarı (`'details' | 'expanded'`), `loadRightPanel`/`saveRightPanel` (safeStorage;
    bilinmeyen/bozuk değer → `'details'`) + `useRightPanel()` hook (lazy init = reload'da tercih
    okunur). i18n/notifications ile aynı `nexa.*` deseni; **backend/kontrat değişmedi** (§D22 MVP payı).
  - **InboxPage:** Details paneli yalnız `!expanded` iken render; expand modda transcript tam
    genişlik (`main` flex-1). Panel AÇIKKEN dar transcript header'ına buton EKLENMEZ — kapatma
    panelin kendi başlığındaki `⇥` ("Collapse details panel", `onCollapse`) ile; panel KAPALIYKEN
    geniş header'daki "Show details panel" geri getirir. (Header'a her koşulda buton koymak 1280px'de
    paneli aside'ın altına taşıyıp tıklamayı kesiyordu → iki bağlamlı kontrol, taşma yok.)
  - **DetailsPanel:** opsiyonel `onCollapse` prop + başlıkta collapse butonu (prop yoksa eski davranış).
- Doğrulama (hepsi exit 0): `pnpm -w typecheck` ✅ (11/11) · `pnpm -w lint` ✅ (8/8) ·
  `pnpm -w build` ✅ (7/7) · web unit **98** (+ yeni `rightPanel.test.tsx`: store + hook
  toggle/expand/reload) ✅ · `turbo run test --concurrency=1` api **594** ✅ ·
  `pnpm -w test:integration` api **505** ✅ · `pnpm --filter @nexa/e2e test inbox-panel` **1 passed**
  ✅ (aç/kapa + reload sonrası kalıcı; `kanit/28-panel-expanded.png`).
- Varsayımlar: tercih **cihaz-başı localStorage** (hesap tercihi değil) — ekran genişliği makineye
  ait, KK "localStorage/hesap" ikisini de kabul ediyor. Copilot sekmesi kapsam dışı (v1, tm 36).
- Sonraki pencereye not: E2E'den önce kök **`.env` export** şart (rtm kendi yüklemiyor; 27'deki notla
  aynı) → `set -a && . ./.env && set +a`. Task Master durumu diskte güncellendi ama bu commit'e
  alınmadı (dalın deseni: tm 27 status'u da uncommitted bırakılmıştı — periyodik `chore(taskmaster)`
  batch'liyor). **tm 36 (12.1-a Copilot)** T1-a üstüne oturur: `ShowDetailsButton`, üç-yollu
  Details/Copilot/Expand switcher'a dönüşecek.

### 27 — 02.4 Details paneli ziyaret bilgisi (Visited pages + Visit info) — done — 2026-07-25 UTC

- Yapıldı:
  - **27.1 (T3-a) Kontrat+Backend:** `Chat` yanıtına nullable `visitor` bloğu — yeni `ChatVisitor`
    şeması (`visited_pages[]` + `visit_info{device,referrer,duration_seconds,ip}`);
    `pnpm --filter @nexa/contract generate` ile `src/generated/api.ts` yenilendi. `ChatService.get`
    müşterinin **bu lisansa ait** en son ziyaretini chat'e bağlar (`#latestVisitor`): device =
    browser+os ("Chrome on macOS"), duration = ended−started (sn, null-güvenli), pages defansif
    ayrıştırılır. Ziyaret bloğu yalnız agent/bot principal'a döner — customer widget'a **hiç**
    (IP kişisel veri, NFR-S9). Cross-license IDOR negatifi dahil 4 yeni integration testi.
  - **27.2 (T3-b) UI:** `DetailsPanel.tsx`'e iki katlanır `<Section>` — "Visited pages" (path'e
    kısaltılmış, tam URL'e linkli, sıralı liste) + "Visit info" (Device/Referring/Duration/IP,
    boş alanlarda "Direct"/"—"); ziyaret yoksa anlamlı empty state (başlıklar gizlenmez). Web
    `ChatDetail` tipine `visitor` + yeni `DetailsPanel.test.tsx` (3 render senaryosu).
- Doğrulama (hepsi exit 0): `pnpm -w typecheck` ✅ · `pnpm -w lint` ✅ · `pnpm -w build` ✅ ·
  web 91 / widget 34 unit ✅ · `@nexa/api` 594 test (28 dosya, +4 "visitor context") ✅ ·
  `pnpm -w test:e2e` 45 passed ✅ (demo-flow'a ziyaret-bilgisi görünürlük iddiası eklendi).
- Varsayımlar: §C-A10 alanları (Device/Referring/Duration/IP) PRD Açıklama'sından türetildi;
  canlı süre WS push kapsam dışı (T3-b snapshot gösterir).
- Sonraki pencereye not: E2E'den önce kök **`.env` export edilmeli** (rtm kendi yüklemiyor) ve
  4000/4001/5173/5174'te bayat dev server bırakılmamalı — bayat api raised rate-limit taşımadığından
  widget.spec 429 verir (kapı düşer, kod değil).

### 21 — 07.1/07.3.1/07.3.3 Reports: Breakdown + AI Agent sekmeleri + vs-önceki dönem + Chats kartları — done — 2026-07-25 UTC

- Yapıldı:
  - **Kontrat** (`packages/contract/openapi/`): overview yanıtına `previous_period` (eşit-uzunluk
    önceki dönem: range + karşılaştırılabilir sayılar) + `chats` blogu (automated_per_hour,
    automated/total chat duration); iki yeni yol **`GET /reports/breakdown`** (ReportsBreakdown:
    by_day + by_agent split) ve **`GET /reports/ai-agent`** (ReportsAiAgent: resolutions/rate,
    transfers/rate, skill_runs, avg automated duration). `pnpm --filter @nexa/contract generate`
    ile bundle + `src/generated/api.ts` yenilendi.
  - **Backend** (`apps/api/src/routes/reports.ts`): sınıflandırma tek yerden — paylaşılan
    `AGENT_EVENT`/`SKILL_RUN`/`SPLIT_COUNTS` SQL fragmanları + `windowTotals`/`ticketCount`/
    `satisfactionCounts`/`satisfactionScore` yardımcıları (Overview/Breakdown/AI Agent aynı ADR-09
    otomatik tanımını paylaşır, drift edemez). Overview önceki dönemi (`from-1ms` bitişli, çakışmasız)
    hesaplayıp delta için döndürür; breakdown gün (UTC bucket) + ajan kırılımı; ai-agent transfer
    olayını (`properties @> {system_event: chat_transferred}`, GIN-dostu) + skill_runs sayar.
  - **Web** (`apps/web/src/features/reports/ReportsPage.tsx`): sol `role=tablist` sekmeler
    (Overview/AI Agent/Breakdown); range 7/30/90/**365** + **Custom** date picker (geçersiz/geriye
    aralık → boş durum, sorgu atılmaz); her Overview KPI'ında nötr **vs-önceki delta** rozeti
    (`Kpi`'a opsiyonel `delta` slotu eklendi — geriye dönük uyumlu); **Chats** bölümü kartları;
    AI Agent (resolution/deflection) + Breakdown (gün/ajan split tabloları) panelleri.
- Doğrulama (**tam kapı yeşil, exit 0**): `pnpm -w typecheck` (11/11) · `pnpm -w lint` (8/8) ·
  `pnpm -w build` (7/7; OpenAPI bundle spec-hatasız) · unit (web **88**, rtm **65**, api unit +
  widget/contract/types/ai-mock) · integration (**seri**, `turbo … --concurrency=1`) api **590**
  (yeni reports testleri: previous-period eşit-uzunluk delta, 365/custom range, breakdown split
  gün/ajan + toplam=closed, ai-agent=overview=fatura, transfer_rate, cross-tenant ×2; +
  **contract-parity** yeni 2 yolu doğruladı) · e2e reports **2/2** (tab gezinme + kanıt
  screenshot'ları `kanit/21-reports-ai-agent.png` + `kanit/21-reports-breakdown.png`). Task kabul
  kriteri (delta + custom range + breakdown + e2e sekme + kanıt) karşılandı.
- Varsayımlar: **07.5 Metrics breakdown**'un tam boyut kümesi (kanal/saat) v2; MVP payı gün+ajan
  split. AI Agent `transfer` metriği `chat_transferred` sistem olayını sayar (chat-service'in
  yazdığı şekil). Kanal boyutu şemada thread/chat'te yok → breakdown'a alınmadı.
- Sonraki pencereye not: **Faz-0 bakiyesi (tm 20–26) kapandı** (PLAN §3.6 07.1/07.3.1/07.3.3 ✅,
  §2 MOD-07 ✅). E2E **rate-limit uyarısı**: reused `:4000` api `.env`'den `RATE_LIMIT_ANON_PER_MIN=200`
  alır; **tüm** e2e suite'i tek seferde koşarsan sona doğru anon bucket dolar ve alâkasız
  widget/settings testleri login fixture'ında **429** verir (üründe hata değil — playwright config
  test sunucusunu 2000 ile başlatır ama reuse edince 200 kalır). İzole koşumda hepsi yeşil; kapı
  için ya taze api başlat ya seri/pencere-bekleyerek koş.

### 26.4 — I18N1/2 testler: t() fallback unit + locale smoke + widget boyut — done — 2026-07-25 UTC

- Yapıldı: 26.1–26.3 zaten fallback unit (panel `apps/web/src/lib/i18n.test.ts` + widget
  `apps/widget/src/i18n.test.ts`), panel locale-switch smoke (`i18n.smoke.test.tsx`) ve widget
  bundle-P3 boyut testini (`test/bundle-size.test.ts`) bırakmıştı. Tek eksik **widget mount-locale
  smoke**'tu: yeni `apps/widget/src/i18n.smoke.test.ts` (3 test) gerçek widget'ı jsdom'da
  `language=tr` ile mount edip görünür chrome'un (launcher `Sohbet`/aria `Sohbeti aç`, panel aria
  `Müşteri destek sohbeti`, başlık `Bizimle sohbet edin`, send `Gönder`) fiilen Türkçe geldiğini —
  ve İngilizce varsayılanın kaybolduğunu — kanıtlıyor; ayrıca dilsiz→İngilizce fallback ve
  bölge-etiketli `tr-TR`→tr çözümü. Bu, `data-language → readConfig → createTranslator → DOM`
  zincirini uçtan uca doğruluyor (panelin locale smoke'unun widget karşılığı; widget'ta runtime
  dil değiştirici yok, locale sayfa-yükü boyunca sabit). Kaynak koda dokunulmadı — yalnız test.
- Doğrulama (**tam kapı yeşil, exit 0**): `pnpm -w typecheck` (11/11) · `pnpm -w lint` (8/8) ·
  `pnpm -w build` (7/7; widget **7.57 KB gzip** ≪ 50 KB P3) · `pnpm -w test:unit` (web **88** +
  widget **34** = yeni `i18n.smoke.test.ts` 3 + mevcut `i18n.test.ts` 7 + `bundle-size` 2 [taze
  dist'e karşı **skip değil**] + `loader` 22) · `pnpm -w test:integration` (**seri** · api 22 dosya /
  **492**) · `make test-e2e` (**44/44**, 13 widget spec dâhil). Task kabul kriteri (fallback unit +
  locale smoke + widget boyut) karşılandı.
- Kapsam disiplini: **yalnız 2 dosya** commit'lendi (`apps/widget/src/i18n.smoke.test.ts` + PLAN.md
  §7.2 I18N ⬜→✅) + taskmaster durum. İlgisiz çalışma-ağacı değişiklikleri (CLAUDE.md/
  MASTER-PROMPT.md, kanit .png'leri, autorun/convention .md'leri, run-loop.sh) **staged edilmedi**.
- Varsayımlar: e2e'nin İngilizce metin iddiaları (ör. "Let's chat") etkilenmez — demo host sayfası
  `data-language` set etmez, varsayılan `en` çıktısı 26.3'ten bu yana bayt-özdeş. Bundle-P3 testinin
  gerçekten koşması için (skipIf dist yokken atlar) unit'ten önce `build` çalıştırıldı; kapı sırasında
  build zaten var.
- Sonraki pencereye not: **Parent 26 done** (tüm alt-görevler kapandı) ve **PLAN.md §7.2 I18N ✅**.
  i18n = katalog + tr/en (canlı/otomatik çeviri §9 kapsam dışı, kasıtlı). Panelde çevrilmemiş ekran
  metinleri hâlâ fallback ile İngilizce'ye düşer (iskelet + eksik-anahtar güvenliği tasarımı);
  ileride ekran-bazı katalog genişletmesi ayrı task olur.

### 26.3 — I18N1/2 widget string kataloglama (bundle bütçesi P3) — done — 2026-07-25 UTC

- Yapıldı: 26.1/26.2 pencerelerinden çalışma ağacında bekleyen `apps/widget/src/i18n.ts`
  iskeletini (tr/en düz katalog + `createTranslator`/`resolveWidgetLocale`, panelle aynı
  fallback zinciri: aktif locale → İngilizce → anahtar) **widget'ın görünür yüzeyine bağladım**.
  `widget.ts` — `mount()` içinde `createTranslator(config.language)` ile locale'e bir kez bağlanan
  `t()`; `buildUi(doc, t)` + tüm render kapanışları + `renderBubble`/`renderAttachment`'a geçirildi.
  Katalanan metinler: launcher (text/open/close), header title, durum (queue `{n}` interpolasyon /
  offline), hatalar (connect/upload/send), transcript/panel aria, composer (input placeholder/label,
  send, attach etiketleri), pre-chat (intro/name/email/emailLabel/submit), greeting (label/msg/chat/
  browse), attachment-alt. Dekoratif `×`/`📎` glyph'leri ve boş durum metni çevrilmez (a11y aria ile).
- Doğrulama (**tam kapı yeşil**): `pnpm -w typecheck` (11/11 · exit 0) · `pnpm -w lint` (8/8 · exit 0) ·
  `pnpm -w build` (7/7 · exit 0) · `pnpm -w test:unit` (10/10; widget **31** = yeni `i18n.test.ts` 7 +
  mevcut `bundle-size` 2 + `loader` 22, web 88) · `pnpm -w test:integration` (**seri** · api 22 dosya /
  **492**) · `make test-e2e` (**44/44**, 13 widget spec dâhil — greeting, "Let's chat" pre-chat, agent
  identity, ekler). **Bundle P3**: widget app **7.57 KB gzip** (20.53→22.80 KB raw / 6.76→7.57 KB gzip,
  +~0.8 KB), loader **1.18 KB gzip** (dokunulmadı) — ikisi de 50 KB bütçenin çok altında; taze dist'e
  karşı `test/bundle-size.test.ts` (`describe.skipIf`) yeşil.
- Kapsam disiplini: **yalnız 3 widget dosyası** commit'lendi (`i18n.ts`, `i18n.test.ts`, `widget.ts` ·
  `feat/widget-i18n` → main ff). İlgisiz çalışma-ağacı değişiklikleri (CLAUDE.md/MASTER-PROMPT.md,
  kanit .png'leri, autorun/convention .md'leri, run-loop.sh) **staged edilmedi**.
- Varsayımlar: İngilizce katalog değerleri eski sabit metinlerle **birebir aynı** → varsayılan (en)
  widget çıktısı bayt-özdeş, e2e'nin İngilizce metin iddiaları etkilenmez. `loader.ts`'in host-sayfa
  erişilebilirlik etiketleri ('Chat'/'Customer support chat') **İngilizce bırakıldı**: P3 bütçesi tam
  da loader'la ilgili, katalogu loader'a import etmek onu şişirir; widget'ın kendi panel etiketi
  ('Customer support chat') iframe içinde zaten çevrili. `data-language` → loader query → `readConfig`
  → `createTranslator` bağlantı yolu uçtan uca tam.
- Sonraki pencereye not: **26.4** (test genişletme) — widget için `createTranslator` fallback unit'i +
  `bundle-size` testi **artık var**; kalan = widget-**mount locale smoke** (tr ile mount → Türkçe metin
  görünür) istenirse. Parent **26** ancak 26.4 bitince done; o zaman `PLAN.md §7.2 I18N ⬜→✅` güncellenir
  (henüz **değil**). Widget locale'i sayfa-yükü boyunca sabit (site `data-language` seçer, değişmez) —
  panel gibi runtime dil değiştirici yok, gerekmiyor.

### 26.2 — I18N1/2 panel string kataloglama + Intl helper locale bağı — done — 2026-07-25 UTC

- Yapıldı: 26.1'in çekirdeğini panelin **görünür chrome'una** bağladım. `AppShell.tsx` — trial banner
  (`shell.trial.*` + `{days}`/`{s}` interpolasyon), abonelik linki, ikon rayı `aria-label`'i, hesap menüsü
  (ad/çıkış fallback) `t()`'ye taşındı; hesap menüsüne **dil değiştirici** (`<select>` → `useLocale().setLocale`)
  eklendi. `navigation.ts` — kırıcı değişim: `label` → **`labelKey`** (katalog anahtarı); ray ve komut paleti
  aynı anahtardan çözer (`RailButton key` de `item.to`'ya çekildi). `CommandPalette.tsx` — grup başlıkları,
  placeholder/aria, "Searching…/No matches", isimsiz ziyaretçi/visitor fallback'leri `t()`'ye taşındı, `t`
  useMemo bağımlılığına eklendi. `format.ts` locale bağı zaten 26.1'de (title'ın 2. yarısı) tamam.
- Doğrulama (**tam kapı yeşil**): `pnpm -w typecheck` (11/11 · exit 0) · `pnpm -w lint` (exit 0) ·
  `pnpm -w build` (7/7; widget 6.76 kB gzip ≪ 50 KB P3, dokunulmadı) · `pnpm -w test:unit` (web **88**,
  yeni `i18n.smoke.test.tsx` dâhil) · `pnpm -w test:integration` (**seri** · 22 dosya / **492**) ·
  `pnpm -w test:e2e` (**44/44**). Not: e2e ilk koşuda 5 widget testi **429 rate-limit** ile düştü — sebep
  playwright'ın port 4000'de **bayat api dev sunucusunu** (raised `RATE_LIMIT_ANON_PER_MIN=2000` olmadan)
  `reuseExistingServer` ile yeniden kullanması; bayat süreci öldürüp taze sunucuyla tekrar koşunca **44/44 yeşil**.
  Kodumla (yalnız panel chrome) ilgisiz. Ayrıca e2e için kabuk env'ini `.env`'den export etmek gerekti
  (`tsx watch` dev komutu dotenv yüklemez; `make test-e2e` `include .env` ile çalışır).
- Kapsam disiplini: **yalnız 4 panel dosyası** commit'lendi (`AppShell.tsx`, `CommandPalette.tsx`,
  `navigation.ts`, `i18n.smoke.test.tsx` · commit `3bd3979` → main). `apps/widget/src/i18n.ts` (26.3) çalışma
  ağacında **commit'siz** bırakıldı; ilgisiz değişiklikler (CLAUDE.md/MASTER-PROMPT.md, kanit .png'leri, autorun
  .md'leri, run-loop.sh) staged edilmedi.
- Varsayımlar: "panel string" = her ekranda görünen **iskelet** chrome (shell/nav/palet); çevrilmemiş ekranlar
  fallback ile İngilizce'ye düşer (parent detay madde-2: "iskelet + eksik-anahtar güvenliği"). Task'ın
  "smoke/e2e" istediği locale-değişim kanıtı **smoke** dalıyla karşılandı (gerçek shell render → tr'ye çevir →
  ray etiketleri Türkçe, İngilizce kaybolur); ayrı e2e i18n spec'i eklenmedi.
- Sonraki pencereye not: **26.3** (widget) — `apps/widget/src/i18n.ts` iskeleti çalışma ağacında hazır bekliyor,
  bundle P3 (50 KB) bütçesini koru. **26.4** (test genişletme) — smoke + fallback unit'leri var; widget boyut
  testi kalabilir. Parent **26** ancak 26.3+26.4 bitince done; o zaman `PLAN.md §7.2 I18N ⬜→✅` güncellenir
  (henüz değil).

### 26.1 — I18N1/2 panel i18n çekirdeği (katalog + t() + locale kaynağı) — done — 2026-07-25 UTC

- Yapıldı: Bağımlılıksız hafif i18n temeli. `apps/web/src/lib/i18n.ts`: düz `tr/en` mesaj katalogu +
  `translate(locale,key,params)` (fallback zinciri **aktif locale → İngilizce → anahtarın kendisi** =
  eksik-anahtar güvenliği; `{name}` interpolasyon). Locale kaynağı: `localStorage('nexa.locale')` → tarayıcı
  dili → İngilizce (`detectLocale`, bölge eki kırpılır); zustand store + `useTranslate`/`useLocale` hook'ları;
  locale değişiminde `<html lang>` + `setFormatLocale` senkronu. `format.ts` Intl helper'ları (`formatCount`/
  `formatMoney`/`formatDate`) modül-düzeyi `activeLocale`'e bağlandı — **varsayılan argüman → geriye dönük
  uyumlu** (mevcut çağrı yerleri değişmez, testler açık locale geçirmeye devam eder).
- Doğrulama (**yeşil**): `pnpm -w typecheck` (11/11) · `pnpm -w lint` (8/8) · `pnpm -w build` (7/7) ·
  `@nexa/web` vitest **88** (yeni `i18n.test.ts` 7: fallback/interpolasyon/detectLocale + `format.test.ts` 5:
  locale bağı; mevcut AppShell/CommandPalette suite'leri hâlâ yeşil) · api/rtm entegrasyon **seri** koşuda yeşil
  (api 581). Not: `pnpm -w test` DB suite'lerini paylaşılan Postgres'te yarıştırır (bilinen konu — memory) →
  seri koştum; i18n saf frontend, backend'e dokunmaz.
- Kapsam: **yalnız 26.1** commit'lendi — `{i18n.ts, i18n.test.ts, format.ts, format.test.ts}` (commit `5883d5a`,
  `feat/i18n-foundation` → main ff). 26.2 (panel string'leri: AppShell/CommandPalette/navigation), 26.3 (widget
  `apps/widget/src/i18n.ts`) ve 26.4 (`i18n.smoke.test.tsx` + widget boyut testi) çalışması çalışma ağacında
  **commit'siz** bırakıldı — kendi pencerelerinde kapanacak. (navigation.ts `label`→`labelKey` kırıcı değişimi
  AppShell/CommandPalette ile bağlı; birlikte commit'lenmeli.)
- Varsayımlar: İki locale + bu string sayısında ICU/plural kütüphanesi gereksiz (widget 50KB P3 bütçesine de
  ağırlık bindirmez). İngilizce **doğruluk kaynağı** — her anahtar `en`'de var, `tr` kısmi olabilir. Canlı/makine
  çevirisi kapsam dışı (PRD §9). format binding'i 26.1'e dâhil edildi (parent detay madde-1: "format.ts locale'e
  bağla"; ayrıca `i18n.ts` `setFormatLocale`'e derleme-zamanı bağımlı).
- Sonraki pencereye not: **26.2** → `useTranslate()` ile panel string'lerini katalogla; rail/palette `labelKey`'i
  `t()` ile çöz (navigation.ts zaten `labelKey`). **26.3** → widget `createTranslator(data-language)` bağla, boyut
  bütçesini koru. **26.4** → smoke + widget boyut testi + PLAN.md §7.2 `I18N1/2` ⬜→✅ (yalnız tüm 26 kapanınca).
  Task 26 hâlâ `in-progress`.

### 25 — M5 Gözlemlenebilirlik: OpenTelemetry span + metrik (request_id köprüsü) — done — 2026-07-25 UTC

- Yapıldı: NFR-M5 (§7.2 ◐→✅). Gerçek OTel SDK (2.10) bağlandı. `apps/api/src/telemetry/telemetry.ts`:
  `BasicTracerProvider` (SimpleSpanProcessor) + `MeterProvider` (PeriodicExportingMetricReader). Exporter
  seçimi: dev/prod **konsol** (collector yok — sınır), test/enjekte **in-memory**. `apps/api/src/plugins/telemetry.ts`:
  `onRequest`→SERVER span aç (`GET /route`, attribute'ler: `http.request.method`, `http.route` (düşük
  kardinalite: `routeOptions.url`), `url.path`, **`request_id`**=`request.id`), `onError`→`recordException`,
  `onResponse`→`http.server.requests`/`.request.duration`(s)/`.errors` metrikleri + `http.response.status_code`
  - 5xx'te span status ERROR + span.end, `onClose`→shutdown. Telemetri kapalıyken **sıfır** hook/maliyet.
- Köprü: span'deki `request_id` = pino log `reqId` = `X-Request-Id` yanıt başlığı (server.ts `genReqId`) —
  aynı id üçünü birbirine bağlar (canlı sunucu smoke ile doğrulandı: `request_id: smoke-otel-1`).
- Anahtar: `OTEL_ENABLED` (env.ts). Boşsa ortamı izler: dev/prod açık, **test kapalı** (suite'ler hızlı kalır).
  `buildServer({telemetry})` ile enjekte edilebilir (null = kapat). `.env.example` belgelendi.
- Doğrulama (**yeşil**): `pnpm -w typecheck` (0) · `lint` (0) · `build` (0) · `@nexa/api` tam suite **581**
  (yeni `test/integration/telemetry.test.ts` 3: in-memory exporter'a span düştü + `request_id` attribute + 5xx
  ERROR + istisna + request/duration/error metrikleri) · `pnpm -w test:integration` (turbo --concurrency=1) **492**.
- Varsayımlar: SimpleSpanProcessor + konsol exporter yeterli (prod deploy yok — sınır). Metrik push aralığı
  60 s; testler `flushMetrics()` (forceFlush) ile deterministik okur. Attribute `request_id` (semconv değil,
  görev gereği). Providers global KAYDEDİLMEZ (tek süreçte çok sunucu → span sızıntısı olmasın).
- Sonraki pencereye not: `pnpm -w test` (varsayılan eşzamanlı) @nexa/api + @nexa/rtm entegrasyon suite'lerini
  **paylaşılan Postgres**'te yarıştırır → sahte kırmızı (rtm izole **65/65** ✅, api **581** ✅). DB suite'lerini
  **paket başına seri** koştur (bilinen konu). `@nexa/e2e` webServer'ı soğuk başlatınca `apps/rtm` env'i (`.env`
  yüklenmeden) düşüyor — **bu görevden önce de vardı**, dokunmadım (backend-only değişiklik, UI/akış yok).
  Faz-0 bakiyesinde kalan öncelik **26 (i18n) → 21 (Reports breakdown)**.

### 22 — 00.4 Onboarding sihirbazı + tohum veri — done — 2026-07-25 UTC

- Yapıldı: Signup **boş** çalışma alanı açıyordu (grup/website/sohbet yok) → yeni sahip boş inbox'a
  düşüyordu. Eklenen ilk-kurulum sihirbazı (§3.0 00.4 ⬜→✅). Contract-first: `openapi/paths/onboarding.yaml`
  - `@nexa/types` (`OnboardingState`, `OnboardingSeedResult`). Yeni uçlar: `GET /onboarding/state`,
    `POST /onboarding/complete` (bitir **ve** atla — aynı çağrı, idempotent), `POST /onboarding/seed-demo`.
    `/auth/me`'ye `onboarding_completed` eklendi (shell kapısı — ikinci istek maliyeti yok).
- Mekanizma: `licenses` tablosuna 2 bayrak (`onboarding_completed_at`, `demo_seeded_at`) — **lisans
  düzeyi** (workspace kurulu = tek sefer). Tohum veri yeni migration `onboarding_seed_demo(...)`
  **SECURITY DEFINER** (auth__/retention__ deseni): tenant id'lerini açıkça alır, yalnız onları yazar
  (org-kapsamlı ziyaretçi + lisans-kapsamlı sohbet/thread/event atomik); `demo_seeded_at` ile idempotent.
  3 canned + 2 tag + 1 örnek ziyaretçi + owner'a atanmış **aktif** örnek sohbet (owner unrestricted →
  grup gerekmez). Web: `App.tsx` kapısı (`agent.onboarding_completed === false` → tüm yollar
  `/app/onboarding`'e); `OnboardingWizard` mevcut website/invite/settings akışlarını yeniden kullanır,
  her adım atlanabilir. Seed (demo tenant'lar) baştan onboarded işaretlendi + eski kayıtlar için backfill.
- Doğrulama (hepsi **yeşil**): `pnpm -w typecheck` · `lint` · `test:unit` (164) · `test:integration`
  (489 — yeni `onboarding.test.ts` 8: cross-tenant seed izolasyonu + iki kapı [scope+rol] + idempotent) ·
  `build` · `test:e2e` (44 — yeni `onboarding.spec.ts` 3: signup→sihirbaz→skip & complete→inbox).
  Kanıt: `apps/e2e/kanit/22-onboarding-wizard.png`.
- Varsayımlar: Yazma uçları `properties.configuration:rw` (ADMIN_SCOPES) + rol admin+ (iki kapı).
  E2E anon rate-limit: signup akışları tek IP'de anon kovayı zorluyordu → `playwright.config` api
  webServer'ına `RATE_LIMIT_ANON_PER_MIN=2000` headroom (limitin kendisi integration'da test edilir).
- Sonraki pencereye not: Faz-0 bakiyesinde kalan öncelik **25 (OTel) · 26 (i18n) → 21 (Reports breakdown)**.
  `contract/dist/openapi.json` gitignore'lu (build artefaktı); `src/generated/api.ts` commit'lendi.

### 24 — C8 veri saklama (retention) budama işi [MAX] — done — 2026-07-25 UTC

- Yapıldı: Silme CASCADE vardı (Dilim 3) ama süresi geçen veriyi budayan **periyodik iş yoktu**
  (§7.2 C8 ◐). Eklenen `services/retention/`: `policy.ts` (tablo→pencere — kapanmış thread 365g ·
  visit telemetri 90g · `.data` mail 30g; env'den override; `cutoffFor` **pozitif-pencere guard'ı**
  = "her şeyi silme" footgun'ını reddeder), `retention.ts` (`RetentionRunner` — tenant-döngülü
  hard-delete), `run.ts` (`retention:run` CLI). **Prod scheduler YOK** (sınır) — manuel tetik.
- Mekanizma: Yeni migration `retention_list_tenants()` **SECURITY DEFINER** (auth_* deseni) tüm
  tenant'ları sayar (RLS-bağlı `nexa_app` bunları tek başına göremez). Silmeler tenant başına
  `withTenant` içinde → **RLS cross-tenant'ı fiziksel imkânsız kılar** (WHERE hatası bile başka
  tenant'a ulaşamaz), owner+SECURITY DEFINER silme yerine (o RLS ağını kaybederdi). Kapanmış thread
  silinince event+thread_tag **cascade** düşer (en büyük tablo hiç adlandırılmadan budanır).
  Batch (500) + kısa tx + idempotent.
- Güvenlik: iki bağımsız guard — (1) her ifade `... < cutoff` yaş-guard'ı, guard'sız silme yolu
  YOK; (2) RLS tenant-scope. **dry-run varsayılan** (`--apply` olmadan yalnız sayar — irreversible).
  Silme audit'e `data.retention_pruned` (system aktör + sayaçlar) yazılır — metadata, veri değil.
- Doğrulama (DoD tam yeşil, exit 0): `pnpm -w typecheck` · `pnpm -w lint` · `pnpm -w build` ·
  api unit+integration **570/570** (yeni: 6 birim policy + 8 integration retention) ·
  `pnpm -w test:integration` (serialize) **481/481** · rtm **65/65** · **e2e 41/41** · prettier temiz ·
  `retention:run` dry-run canlı DB'de koştu (SECURITY DEFINER 2 tenant döndürdü, 0 silme).
  Integration kanıtı `test/integration/retention.test.ts`: süresi geçen thread+event cascade
  **silinir** · recent+active thread **KALIR** · visit geçen silinir/recent kalır · **cross-tenant
  DOKUNULMAZ** (A bağlamında silme B'nin aynı satırını bırakır — RLS) · **idempotent** (2. koşu 0) ·
  **dry-run YAZMAZ** (sayar, silmez, audit yok) · audit tam 1 sistem-atıflı sayaçlı giriş ·
  mail dosyaları geçen süpürülür/recent kalır.
- Varsayımlar: (1) Retention hedefi = kapanmış thread (→event/tag cascade) + visit telemetri +
  `.data` mail. **Müşteri satırı silme kapsam dışı** — "right to erasure" API'si (GDPR Md.17, tekil
  özne) + per-tenant retention kolonu (`security_settings`) ayrı/sonraki iş (v1 borcu). (2) Pencereler
  env-yapılandırılabilir varsayılan (365/90/30), PRD'nin 30/60/365 kademesiyle hizalı. (3) Mail
  dosyaları tenant-etiketsiz olduğundan global süpürülür (yerel dev artefaktı). Şema DEĞİŞMEDİ
  (yalnız 1 SECURITY DEFINER fonksiyon migration'ı); `db:check-drift` etkilenmez (Prisma fonksiyon modellemez).
- Sonraki pencereye not: Faz-0 bakiyesinde sıradaki öncelik tm **22** (00.4 Onboarding) → 25 (OTel) ·
  26 (i18n) → 21. `retention:run` prod'da cron'a bağlanacak (sınır: scheduler yok).

### 23 — S12 audit_log yazıcısı (append-only olay yazımı) [MAX] — done — 2026-07-25 UTC

- Yapıldı: `audit_log` tablosu + RLS Dilim 12'de vardı ama **hiçbir olay yazılmıyordu** (§D16).
  Merkezi tek yazıcı `services/audit/audit-log.ts` → `writeAuditEntry(tx, ctx, entry)`: verilen
  **tenant transaction'ı** içinde tam 1 satır INSERT eder (RLS `WITH CHECK` yanlış tenant'ı reddeder),
  `sanitizeAuditMetadata` sır benzeri anahtarları (pass/secret/token/verifier/hash/…) düşürür,
  `request_id`'yi metadata'ya koyar. `plugins/audit.ts` → `request.auditContext()` principal'dan
  actor/tenant/ip/requestId üretir. **Şema DEĞİŞMEDİ.**
- Bağlanan 12 güvenlik eylemi: `auth.login` (başarılı `/auth/authorize`) · `auth.login_failed`
  (kayıtlı client'ın org'una — attacker `license_id`'sine değil — atfedilir, e-posta yazılmaz) ·
  `auth.password_reset` (hesabın her üyeliğine fan-out) · `member.invited`/`member.invitation_revoked`
  (davet e-postası audit'e yazılmaz — PII-min) · `settings.security_updated`/`routing_rule_updated`/
  `trusted_domain_added`/`trusted_domain_removed` · `billing.subscription_updated` · `pat.created`/
  `pat.revoked`. Konfig mutasyonları eylemin kendi tx'inde **atomik**; auth/PAT yolları **en-iyi-çaba**
  (kimlik doğrulama/erişilebilirlik audit yazımına bağımlı olmasın).
- Doğrulama (DoD tam yeşil, exit 0): `pnpm -w typecheck` · `pnpm -w lint` · api unit+integration
  **556/556** (yeni: 6 birim sanitizasyon + 16 integration) · `pnpm -w build` · `pnpm -w test:integration`
  (serialize) **473/473** · rtm **65/65** · **e2e 41/41** · prettier temiz. Integration kanıtı
  `test/integration/audit-log.test.ts`: eylem başına **tam 1 append** + doğru actor/target/metadata ·
  UPDATE/DELETE **DB'de reddi** (`permission denied`) · tenant'sız INSERT fail-closed · yanlış-tenant
  INSERT RLS reddi · **cross-tenant görünmezlik** (zorunlu negatif) · **sır/PII yok** (parola/PAT
  plaintext/deneme e-postası logda yok).
- Varsayımlar: (1) `audit_log` şema gereği **tenant-scoped** (license_id NOT NULL + RLS), bu yüzden
  yalnız güvenilir tenant bağlamı olan eylemler yazılır. Login = tenant'a bağlanan adım
  (`/auth/authorize`); `/auth/login` (üyelik listeleme) workspace seçmediğinden yazılmaz.
  (2) Rol/üyelik değişikliği yüzeyi şu an **davet oluştur/iptal** (ayrı rol-değiştir/suspend endpoint'i
  yok). (3) `auth.login_failed` yalnız `/auth/authorize` başarısızlığında (web app iki-adımlı akışta
  önce `/auth/login`'de tenant'sız düşer — bu doğası gereği yazılamaz).
- Sonraki pencereye not: **Okuma/export UI kapsam dışıydı (v1 borcu)** — audit tüketimi (liste/filtre/
  export) ayrı task. Yazıcı-tarafı sözleşme değişmedi (OpenAPI'ye endpoint eklenmedi). Faz-0 bakiyesinde
  sıradaki öncelik tm **24** (C8 retention).

### 20 — Reports KPI: Manual/Assisted/Automated ayrımı + Total cases (07.3.2) — done — 2026-07-25 UTC

- Yapıldı: Reports Overview'a PRD 07.3.2'nin **üç-sınıf çözüm ayrımı**. **Automated** = kapanmış,
  agent-yazımlı event yok (ADR-09 birebir korundu — faturanın AI-resolution sayacıyla aynı sorgu) ·
  **Assisted** = agent event VAR + o chat'e ait `skill_runs` VAR · **Manual** = agent event VAR, skill YOK.
  Üçü kapanmış vakayı tam bölüyor: `manual + assisted + automated = closed` (SQL FILTER'lar karşılıklı
  dışlayan + kapsayan). Yeni tablo/kolon/migration YOK — veri zaten `events` + `skill_runs`'ta.
- Sözleşme: `openapi.yaml` `ReportsOverview.totals`'a `manual`/`assisted` (+`_rate`) alanları;
  `pnpm --filter @nexa/contract generate` ile `dist/openapi.json` + `src/generated/api.ts` yenilendi.
- Backend: `routes/reports.ts` overview SQL'ine `assisted`/`manual` FILTER'ları; rate mantığı
  saf `routes/reports-metrics.ts`'e (`resolutionRate` + `round`) çıkarıldı (closed=0 → null guard).
- Web: `ReportsPage.tsx` — yeni **Resolution** bölümü (Manual/Assisted/Automated 3 kart) + Volume'a
  **Total cases** kartı; mevcut automated kartı (tone/rate hint) korundu.
- Doğrulama (DoD tam yeşil): typecheck 0 · lint 0 · unit (api `reports-metrics` 6/6 dâhil) 0 ·
  integration **457/457** (yeni 3 reports testi: 3-sınıf toplam=closed · ADR-09 skill-run automated'ı
  bozmaz · cross-tenant izolasyon; contract-parity + tenant-isolation dâhil) · build 0 ·
  e2e reports+demo-flow 4/4. Kanıt: `apps/e2e/kanit/20-reports-resolution.png` (Manual 2·100% / Assisted 0 / Automated 0, closed=2).
- PLAN: §3.6 07.3.2 ◐→✅ · §F bakiye sayacında tm 20 ✅ · §D17 ÇÖZÜLDÜ olarak işaretlendi.
- Sonraki pencereye not: Faz-0 bakiyesinde sıradaki öncelik tm **23** (S12 audit yazıcısı). Assisted'in
  chat↔skill eşlemesi `chat_id` üzerinden (skill_runs thread'e değil chat'e bağlı); ileride thread-zamanlı
  daha ince eşleme istenirse `skill_runs`'a `thread_id`/zaman penceresi gerekir (şu an kapsam dışı).

### §F — Faz-0 kapanış turu (bakiye kapatma) — done — 2026-07-25 UTC

- Yapıldı: 02.6 **Copy chat link** — inbox transcript başlığına "Copy link" düğmesi (`CopyLinkButton`);
  `${origin}/app/inbox?chat=<id>` mutlak deep-link'ini panoya kopyalar (komut paleti + InboxPage'in
  zaten tükettiği `?chat=` parametresi, tek kaynak). 02.6 artık tam ✅ (Reopen + Create ticket + Copy link).
- Ölü kod temizliği: `apiClient` singleton export'u (`lib/api-client.ts` — hiç import edilmiyordu;
  herkes `useApiClient()` / `new ApiClient()` kullanıyor) ve `useScrollToBottom` (InboxPage — hiç
  çağrılmıyordu; artık kullanılmayan `useRef` import'u da düştü) kaldırıldı.
- §D sapma kaydı: **D16** (audit_logs tablo+policy var ama yazıcı yok → S12 ⬜, v1 borcu), **D17**
  (07.3.2 Manual/Assisted ayrımı yok → ◐), **D18** (faz sızıntısı — Playbook/AI v1 payları öne
  çekildi → v1 sayılır, Faz-0 sayacına dâhil değil).
- PLAN: sayaç 47✅/6◐ → **48✅/5◐** (02.6 ◐→✅) · §2 matris MOD-02 ✅ · §3.11 Dilim 14 bakiye notu güncellendi.
- Doğrulama (yalnız web değişikliği): `@nexa/web` typecheck 0 · lint 0 · unit 72/72 · build 0.
  Düğme yalnız seçili sohbetle render olur (tarayıcı doğrulaması tam stack ister); string+clipboard
  mantığı test edilmiş idiom'u (`Channels` ChatPageLink) birebir yansıttığından statik+birim kapısıyla kapatıldı.
- Açık bırakılan Faz-0 bakiyesi (bilinçli — kullanıcı "hızlı kapanış" seçti; §F.3 kararına bırakıldı):
  Reports breakdown/365/custom (07.1/07.3.1/07.3.3) · 00.4 Onboarding sihirbazı · audit_log yazıcısı ·
  OTel (M5) · retention job (C8) · i18n · PAT UI (08.8.2).

### 19 — Inbox real-time sekmeleri (All/Chatting/Queued/Waiting) — done — 2026-07-24 UTC

- Yapıldı: FR-MOD-03.1.1. **Yalnız frontend** (yeni uç/DB yok — mevcut `/chats?view=` listesi
  istemci tarafında bölünüyor). Yeni saf modül `features/inbox/traffic.ts`: `matchesTrafficTab`
  - `filterByTrafficTab` + `trafficTabCounts`. Kova mantığı — **All** tüm liste; **Queued**
    `queue_position!=null`; **Waiting** aktif + son olay müşteriden (yanıt bekliyor); **Chatting**
    aktif + kuyrukta değil + son olay müşteriden değil. Chatting/Queued/Waiting **karşılıklı dışlayan**
    (bir sohbet tek kovada), toplamları All'a eşit. `InboxPage.tsx`: konuşma listesi başlığının
    altına yatay `role="tablist"` şeridi (aria-selected, sohbet görünümünde; ticket'larda yok);
    her sekmede canlı sayaç rozeti. Sayaçlar RTM ile canlı — push `['chats']`'i invalidate ediyor,
    liste + kovalar aynı state'ten türüyor. Seçim geçerliliği tam liste üzerinde kalıyor (sekme
    değişince açık transcript düşmez); sadece render süzülür. Boş sekmede özel boş-durum metni.
- Doğrulama: `pnpm -w typecheck` 0 · `pnpm -w lint` 0 · unit (web 72 / api 525) yeşil ·
  `pnpm -w test:integration` 454 yeşil · `pnpm -w build` 0 · `pnpm exec playwright test` 40 yeşil
  (yeni `apps/e2e/tests/inbox-tabs.spec.ts` dahil). Birim: `traffic.test.ts` (kova + sayaç +
  filtre). Kanıt: `apps/e2e/kanit/19-realtime-tabs.png`.
- Varsayımlar: FR-MOD-03.1.1'in "Real-time sekmeleri" başlığı MOD-03 traffic ekranına ait; task
  hedef dosyaları (InboxPage/useInbox) gereği sekmeler **konuşma listesi** üzerine yatay şerit
  olarak uygulandı (Supervised/Invited/Browsing kapsam dışı — task başlığı 4 sekmeyle sınırlı).
- Sonraki pencereye not: `pnpm -w test` (turbo, paralel) çalışan dev sunucusuyla api/rtm/e2e'de
  DB/port çakışması verir; kapı için serial script'leri kullan (`test:integration`, `playwright
test` tek başına). Supervised/Invited/Browsing sekmeleri ileri bir MOD-03 task'ında eklenebilir.

### 18 — Command Palette (⌘K): içerik arama + rota atlama — done — 2026-07-24 UTC

- Yapıldı: FR-MOD-01.1.3. **Yalnız frontend** (yeni uç yok — mevcut `/customers?query`,
  `/tickets?query`, `/chats` kullanıldı). Yeni `components/CommandPalette.tsx`: ⌘K/Ctrl-K ile
  her modülden açılır dialog; combobox + listbox (klavye: ↑/↓/Enter/Esc, `aria-activedescendant`,
  backdrop kapatma, açılış/kapanışta odak iadesi). Boş sorgu → modül atlama; sorgu →
  müşteri + sohbet + ticket araması gruplu. Aramalar **scope-gated** (customers/tickets/chats
  read scope yoksa istek atılmaz — 403 gürültüsü yok). Sohbetin serbest-metin ucu yok:
  `/chats?view=all` istemci tarafında filtrelenir. Modül filtresi anlık (raw input), kayıt
  araması debounce (180ms). Ortak modül listesi `components/navigation.ts`'e çıkarıldı (rail +
  palet tek kaynaktan). **Deep-link:** seçim `/app/customers?customer=`, `/app/inbox?chat=` /
  `?ticket=` ile hedefe gider; `CustomersPage` ve `InboxPage` param'ı tüketip seçimi kurar,
  "seçim geçerliliği" efektleri liste yüklenene dek (`list.data`/`tickets.data`) bekler ki
  deep-link boş listeye karşı silinmesin.
- Doğrulama (hepsi yeşil): `pnpm -w typecheck`, `pnpm -w lint`, `pnpm -w build`; **web unit 62**
  (yeni `CommandPalette.test.tsx`: aç/kapa, modül listeleme+filtre+Enter atlama, keyword eşleşme,
  müşteri+ticket arama→deep-link, scope-gate negatifi — stub fetch); api integration 454;
  **e2e 39** (yeni `command-palette.spec.ts`: ⌘K açılışı, "Alex" araması müşteri+sohbet döndürür,
  müşteri seçimi kayda gider; modül atlama Reports). Görsel kanıt:
  `apps/e2e/kanit/18-command-palette.png`.
- Varsayımlar: Sohbet araması istemci-taraflı filtre (küçük "all" listesi); ticket UI yolu seed'de
  ticket olmadığından e2e'de değil, unit'te (stub) kanıtlandı. Deep-link'lenen müşteri "all"
  segmentine, sohbet/ticket "All" görünümüne pinlenir (arşiv/banlı kenar durumları liste efektine
  tabi).
- Sonraki pencereye not: Kalan Dilim 14 kalemi **03.1.1** (inbox gerçek-zamanlı sekmeler
  All/Chatting/Queued/Waiting) ve 02.6 "Copy chat link". Depodaki task-dışı bootstrap dosyaları
  (AUTORUN-README/CONVENTIONS/TASK-RUNNER/run-loop, CLAUDE/MASTER-PROMPT/.gitignore değişiklikleri,
  apps/api/.data, önceki kanit PNG'leri) kapsam disiplini gereği hâlâ untracked — bu commit'e
  yalnız tm 18 dosyaları + 18-command-palette.png alındı.

### 17 — Tags kütüphanesi CRUD (grup kapsamı) — done — 2026-07-24 UTC

- Yapıldı: Merkezi etiket kütüphanesi (FR-MOD-08.7.1). **Kontrat:** `openapi.yaml`'a `Tag`
  şeması (`group_ids`, `usage_count`, `author_id`) + `paths/settings.yaml`'a `listTags`/
  `createTag`/`updateTag`/`deleteTag`; tipler yeniden generate edildi. **Backend:**
  `routes/settings.ts`'e `GET/POST /settings/tags` + `PATCH/DELETE /settings/tags/:tagId`.
  İsim, chat etiketlemeyle aynı normalizasyon (trim+lowercase, `[licenseId,name]` unique →
  409/not_allowed). `group_ids` tenant'ın gruplarına doğrulanır (routing-rule deseni). Okuma
  `tags--*:ro` (ajan datalist için `--groups:ro` dahil), yazma `tags--all:rw`. `usage_count`
  = `_count(threads)`; kütüphane ve chat etiketleme **aynı `tags` tablosu** — ayrı liste değil.
  **Frontend:** SettingsPage'e **Tags** bölümü (ekle/sil, "All teams · N in use"); DetailsPanel
  tag input'una `<datalist>` (kütüphaneyi öneri olarak besler, serbest yazma hâlâ çalışır).
- Doğrulama (hepsi yeşil): `pnpm -w typecheck`, `pnpm -w lint`, `pnpm -w build`; api unit 71;
  rtm 65; web 56; **api integration 454** (yeni `settings > tags` blok: CRUD + grup kapsamı +
  cross-tenant liste/silme 404 + shared-table usage_count + write-scope 403; contract-parity 5);
  **e2e 37** (`settings › curates a tag in the library` dahil). Görsel kanıt:
  `apps/e2e/kanit/17-tags-library.png` (kütüphane + `shipping · 1 in use` canlı sayaç).
- Varsayımlar: UI'da yazma/silme + oluşturma; rename/regroup yalnız API+integration testiyle
  kanıtlandı (canned-responses UI deseni ile hizalı — sadece create+delete yüzeyi). Grup atama
  UI'sı yok (workspace-wide varsayılan); yazma admin-scope (`tags--all:rw`).
- Sonraki pencereye not: `.taskmaster/tasks.json` commit anında `in-progress`'ti; sonrası `done`
  işaretlendi (diskte doğru, commit'te değil — zararsız). Depoda task dışı bootstrap dosyaları
  (AUTORUN-README.md, CONVENTIONS.md, TASK-RUNNER-PROMPT.md, run-loop.sh, CLAUDE/MASTER-PROMPT
  değişiklikleri) hâlâ untracked/kirli — kapsam disiplini gereği bu commit'e alınmadı.

### 16 — Bildirimler (ses/masaüstü/tarayıcı/e-posta) — done — 2026-07-24 UTC

- Yapıldı: Yeni müşteri mesajında ajan bildirimi (FR-MOD-13.8). **İstemci:** saf karar
  çekirdeği `features/notifications/notifications.ts` (`decideNotification` + localStorage
  tercih IO) + efekt hook'u `useNotifications.ts` (ses = Web Audio çan, masaüstü = Notification
  API, sekme başlığı `(n) Nexa` + favicon rozeti; sekme odağa gelince sıfırlanır). `useRealtime`
  opsiyonel `onPush` alır (ref ile stabil, soket yeniden kurulmaz); `InboxPage` bağlar. Ayar
  yüzeyi: SettingsPage'e **Notifications** bölümü (aç/kapa + ses + masaüstü izin butonu),
  tercih tarayıcı-başına (localStorage), her mesajda taze okunur. **Sunucu e-posta:**
  `customer.ts` atanmış ajana `mailer.send({kind:'notification'})` gönderir (best-effort,
  mesajı bloklamaz; yalnız insan atanmışsa); `server.ts` mailer'ı customer route'a geçirir;
  `mailer.ts` kind union'a `notification` eklendi.
- Doğrulama: `typecheck`, `lint`, `build`, `test:unit` (56 web — 20 yeni notifications testi
  dahil: negatif/izin-reddi/self/sistem olayı; 71 api), `test:integration` (445 — yeni
  `notifications.test.ts`: atanana e-posta düşer + follow-up + idempotent tek e-posta),
  `test:e2e` (36 — yeni `notifications.spec.ts`: ayar yüzeyi + kapat/aç kalıcı + reload) — hepsi
  yeşil. Kanıt: `apps/e2e/kanit/16-notifications-settings.png`.
- Varsayımlar: Bildirim tercihleri hesap değil **cihaz** başına (localStorage) — cihaz-özgü
  (hoparlör/OS izni). Negatif test (kapatınca sussun) ve izin-reddi sessiz degrade davranışları
  saf `decideNotification` birim testleriyle deterministik kanıtlandı; e-posta entegrasyon
  testiyle. Client bildirimleri `InboxPage` mount'una bağlı (Settings'teyken tetiklenmez) — MVP
  için kabul; app-geneli için ileride AppShell'e taşınabilir.
- Sonraki pencereye not: E-posta her müşteri mesajında atanana gider (mock, `.data/mail`);
  gerçek sağlayıcıya geçiş tek `Mailer` implementasyonu değişimi. Kanıt png'leri repo
  konvansiyonu gereği git'e alınmıyor.

### 15 — Trial rozeti 'N gün' + Subscribe CTA (shell) — done — 2026-07-24 UTC

- Yapıldı: `AppShell` flex-col'e alındı, ince üst `TrialBanner` eklendi —
  `useQuery(['billing','subscription'])` ile BillingPage ile paylaşımlı cache;
  `trialing` → "N days left", `read_only` → "trial bitti, abone ol", `active` → banner yok.
  Subscribe CTA `/app/billing`'e gider. Billing scope'u olmayan ajanda 403 → `retry:false` →
  banner yok (graceful). `AppShell.test.tsx` `QueryClientProvider` ile sarıldı.
- Doğrulama: `typecheck`, `lint`, `build`, `test:unit` (40 web + 71 api), `test:integration`
  (442), `test:e2e` (35, yeni trial-badge testi dahil) — hepsi yeşil. Kanıt:
  `apps/e2e/kanit/15-trial-badge.png` (inbox içinden "14 days left … Subscribe").
- Varsayımlar: yok. Trial gate + `/billing/subscription` (access, trial.days_remaining)
  zaten mevcut (Dilim 9/14).
- Sonraki pencereye not: kanıt png'leri repo konvansiyonu gereği git'e alınmıyor
  (e2e spec regenerate ediyor). Dilim 14 merge SHA'sı slice kapanışında işlenecek.

## What exists

A working live-support platform. The MVP critical path runs end to end: a visitor
messages from the widget, routing assigns it, the agent sees it live in their inbox,
replies, tags it, archives it, and it shows up in reports and billing.

The slice table below is the build history, **not** a claim that the PRD's MVP is
finished — see "What to build next". 16 of the PRD's 52 MVP requirements are still
unwritten.

| Slice | Scope                                                                        | State |
| ----- | ---------------------------------------------------------------------------- | :---: |
| 1     | Monorepo, Postgres + Redis, `make dev`, health checks, CI                    |  ✅   |
| 2     | OAuth 2.1 + PKCE, PAT, customer tokens, scopes, RLS tenant isolation         |  ✅   |
| 3     | Full PRD §8.4 schema, event partitioning, database-enforced invariants, seed |  ✅   |
| 4     | chat → thread → event, Agent Chat API                                        |  ✅   |
| 5     | RTM gateway, fan-out, lossless reconnect                                     |  ✅   |
| 6     | Customer Chat API + embeddable widget                                        |  ✅   |
| 7     | 3-pane agent inbox                                                           |  ✅   |
| 8     | Routing, capacity limits, queueing                                           |  ✅   |
| 9     | Reports overview, metering, trial gate                                       |  ✅   |
| 10    | Design system, shell + module screens                                        |  ✅   |
| 11    | Ticketing core — `/tickets`, inbox Tickets group, create-from-chat           |  ✅   |

**621 tests green** — 219 unit, 379 integration, 23 end-to-end. Typecheck, lint and format clean.
No schema drift.

---

## Running it

```bash
make dev
```

Datastores, migrations, seed and all apps. Then http://localhost:5173 —
`owner@acme.localhost` / `nexa-demo-password`.

The seed creates two organizations on purpose. Acme is the one to log into;
Northwind exists so a cross-tenant leak shows up as visibly wrong data rather
than as nothing at all.

---

## What is honestly incomplete

**The PRD's MVP is about two thirds built.** 32 of its 52 `Must/Should (MVP)`
requirements are done, 4 partial, 16 untouched — signup, forgot password, checkout,
file sharing, notifications and ⌘K among them. `PLAN.md` §3 lists every one with the
evidence behind the verdict.

**The AI is a deterministic stub, not a model.** `packages/ai-mock` derives
embeddings from text (hashed bag of words, 1536 dims, L2-normalised) and
compiles instructions with rules. Retrieval ranks by real lexical overlap, so it
behaves like retrieval rather than looking like it — but "delivery" and
"shipping" stay unrelated, as they would to any lexical method. Swapping in a
real provider means replacing `embed()` and `compileInstruction()`; nothing else
knows how the numbers were produced.

**Not started (v1 scope in the PRD):** webhooks, Copilot, omnichannel adapters
(WhatsApp/Messenger/Twilio), campaigns, ticket rules and the advanced tickets grid,
custom fields, forms builder, the apps marketplace. The visual workflow editor stays
unbuilt by decision (ADR-14) — the table exists and nothing writes to it.

**Mocked, as instructed:** Stripe (no external call; `usage_records` are real and
the arithmetic is real), LLM providers, SMTP, object storage.

**Known limits, chosen rather than overlooked:**

- Idempotency keys live in Redis with a 24-hour TTL, not in Postgres. `events` is
  partitioned, and a unique index on a partitioned table must include the
  partition key. If Redis is down, a retried send can duplicate a message.
- Customer tokens are stateless and cannot be revoked individually. TTL is short,
  and bans and licence expiry are checked per request against live data.
- The widget polls every four seconds rather than holding a socket. The gateway
  could serve it; a customer-side socket across sleeping laptops and mobile
  networks is more to keep alive than the conversation is worth.
- Rate limiting fails open if Redis is unavailable. Availability beats a
  perfectly enforced limit, and auth and RLS are unaffected.

---

## Things worth knowing before changing anything

**The API connects to Postgres as `nexa_app`, never as the owner.** Postgres
exempts table owners and superusers from row level security. Point the runtime at
`DATABASE_URL` instead of `DATABASE_APP_URL` and every tenant isolation policy
silently stops applying while the whole test suite still passes.
`test/integration/tenant-isolation.test.ts` asserts this rather than trusting it.

**Invariants live in the database.** One active chat per license+customer, one
active thread per chat, one fallback routing rule per kind. A rule checked only
in a service is one concurrent request away from being violated, and the
resulting corruption is permanent. The tests fire concurrent requests at these
rather than checking them sequentially.

**Errors derive their HTTP status from their type.** A route cannot return
`not_found` with a 403. Anything the caller may not see — including another
tenant's data — is 404, so short IDs cannot be enumerated.

**"AI resolution" is defined in exactly one place** (`services/billing/metering.ts`):
a thread that closed with no agent-authored event. Reports and billing both read
it. Two counters meant to agree will not, and the first anyone notices is a
customer disputing a bill.

**Event IDs encode thread and sequence** (`TJ1H8CFKRV_7`). Ordering is decidable
from the ID alone, which is what makes lossless reconnect possible. Do not switch
transcript ordering to timestamps: several events can share a millisecond.

**`pnpm test:integration` runs serially.** Both packages' suites truncate the same
database; running them at once makes each delete the other's fixtures, which
presents as flaky RTM tests.

---

## Where to look

| Question                     | File                                                   |
| ---------------------------- | ------------------------------------------------------ |
| Decisions and why            | [PLAN.md](PLAN.md) §0 (ADRs), §D (deviations)          |
| Colours, spacing, a11y rules | [design-brief.md](design-brief.md)                     |
| API contract                 | `packages/contract/openapi/`                           |
| Tenant isolation             | `apps/api/src/lib/tenant.ts` + the RLS migration       |
| Conversation core            | `apps/api/src/services/chat/chat-service.ts`           |
| Reconnect                    | `apps/rtm/src/sync.ts`, `apps/web/src/lib/realtime.ts` |
| Routing algorithm            | `apps/api/src/services/routing/routing-service.ts`     |

---

## What to build next

**Read `PLAN.md` §3 first.** It is the authority, and it is now a projection of the
PRD's own phase and module structure — every work item carries an `FR-MOD` id.

An audit on 2026-07-23 found that finishing the ten original slices was not the same
as finishing the PRD's MVP: of the 52 requirements the PRD labels `Must/Should (MVP)`,
**18 had no code at all**, and Playbook — shipped under slice 10 — is a v1 feature that
had jumped ahead of them. `PLAN.md` §1.3 records this; §3 lists every gap with its
evidence.

~~1. Ticketing~~ — **done** (slice 11). `/tickets` list/create/get/patch, the Tickets
group in the inbox, "Create ticket" on a conversation, and `total_cases` in Reports.
Two pieces were moved out rather than rushed: email→ticket (`08.5.3`) belongs with the
channel surface in slice 13, and "Copy chat link" (part of `02.6`) with slice 14.

The order, and why:

1. **Account lifecycle** (`00.2`–`00.4`, `04.3.1`, `04.4`) — slice 12. There is no
   signup; every account comes from the seed. The trial rules (ADR-10) have never run
   against an account the product created itself, so expect surprises there.
2. **Channels, file sharing, greeting** (`08.5.1/.2/.3/.9`, `08.9.4`, `11.2`) — slice 13.
   File sharing carries the security shape: NFR-S10 wants type and size limits and
   scanning, and those belong in the first version rather than a retrofit.
3. **Checkout, notifications, ⌘K** (`10.1.x`, `13.8`, `01.1.3`, `02.6` copy link) — slice 14.

**Webhooks (`FR-MOD-08.8.4`) is v1, not MVP** — worth flagging because an earlier
version of this file recommended it first. When it is built, ship the HMAC signing and
the SSRF guard with the first version (NFR-S7, risk R2, `v2-derin-analiz/v2-04` §6);
retrofitting them once integrators depend on the loose behaviour is a breaking change.

When every phase in `PLAN.md` is closed, run the mandatory closing sweep in **PLAN.md §F**
before reporting the work finished.
