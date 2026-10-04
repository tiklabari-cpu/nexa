# Task ID: 83

**Title:** C6 — SOC 2 Type II · ISO 27001 · tam audit log + SIEM · dilim V3-2

**Status:** done

**Dependencies:** 81 ✓, 82 ✓

**Priority:** medium

**Description:** PRD §5.4 (Ent.) · NFR-C6/C7/S12 · KK-türetilmiş. KOD PAYI görevleşir; sertifikasyon süreci §F.00'ı BLOKLAMAZ (§D97).

**Details:**

Faz 3 (Enterprise) · PLAN §6.1 · kalem `C6` · dilim V3-2

7 atomik alt-görev · ~9 pencere · etiket dağılımı: SONNET-XHIGH x3 · OPUS-XHIGH x3 · OPUS-MAX x1

KK: "Genişletilmiş audit + SIEM'e export; kontrol kanıtları" — NFR-C6/C7/S12'den türetildi (§C-A21). Sertifikasyon = dış denetim süreci, bu depodan üretilemez.

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  C6-a [SONNET-XHIGH] Audit kapsamı denetimi + genişletme — hangi güvenlik-hassas mutasyon yazmıyor  (bağ: —)
  C6-b [OPUS-XHIGH] SIEM export kontratı + siem_export_cursors (keyset, tekrar-teslime dayanıklı) + NDJSON akışı  (bağ: —)
  C6-c [OPUS-MAX] Export bütünlüğü çekirdeği (BÖLÜNMEZ) — kayıt zinciri (HMAC) + export imzası + boşluk tespiti  (bağ: C6-b)
  C6-d [SONNET-XHIGH] MOCK SIEM hedefi (.data/siem dosya sink) + zamanlanmış gönderim  (bağ: C6-b, C6-c)
  C6-e [OPUS-XHIGH] Erişim gözden geçirme raporu (SOC 2 CC6.1 kanıtı) — kim/hangi rol/son giriş/PAT envanteri  (bağ: C6-a)
  C6-f [SONNET-XHIGH] Settings → Security: SIEM export ekranı (hedef, son export, boşluk uyarısı)  (bağ: C6-d)
  C6-g [OPUS-XHIGH] Uçtan uca doğrulama — eylem→audit→export→zincir; append-only; boşluk negatifi; cross-tenant  (bağ: C6-c, C6-d, C6-e, C6-f)

BAĞLAM KURULUMU (bu görev KOD YAZMAZ — alt-görevleri koşulur):
- PLAN §6.1.4 kalem kırılımı + bölünmeyen çekirdek gerekçeleri + varsayımlar + açık sorular
- PLAN §6.2 dilim sırası ve sıralamanın gerekçesi · PLAN §G Faz-3 düz tablosu
- CONVENTIONS DoD kapısı · TASK-RUNNER-PROMPT pencere protokolü
- Tam alan detayı her alt-görevin kendi `details` alanındadır (Faz-3'ün companion dosyası YOK — PLAN §D98)

SINIRLAR (CLAUDE.md): dış servisler MOCK · production deploy/DNS/TLS/gerçek secret/ödeme YOK ·
force-push/DB drop/history rewrite YOK · başka repoya dokunma YOK.

**Test Strategy:**

Her alt-görev KENDİ tam DoD kapısından geçer (CONVENTIONS §1): pnpm -w typecheck && pnpm -w lint && pnpm -w test && pnpm -w build && ilgili test:integration/test:e2e — hepsi exit 0. Kalem ancak son doğrulama alt-görevi (C6-g) yeşil olduğunda ✅ sayılır. Her alt-görevin kendi testStrategy alanı o pencerenin kapı komutlarını verir.

## Subtasks

### 83.1. C6-a1 [OPUS-XHIGH] Audit kapsam boşluğu ENVANTERİ — 37 route taranır, çıktı ada bağlı sabit liste

**Status:** done  
**Dependencies:** None  

Audit kapsam boşluğu envanteri — 37 route taranır, çıktı ada bağlı sabit liste

**Details:**

C6-a1 — Audit kapsam boşluğu ENVANTERİ — 37 route taranır, çıktı ada bağlı sabit liste  [OPUS-XHIGH]

PRD: C6 (PLAN §6.1.4 · dilim V3-2 · tm 83)
TAHMİN: ~1 pencere

BU BÖLÜNME DENETİM BULGUSUYLA YAPILDI (PLAN §D99). İlk kırılımda tek bir `SONNET-XHIGH` alt-görev hem "hangi mutasyon güvenlik-hassastır" kararını hem de kodu istiyordu. Bu bir GÜVENLİK DENETİMİDİR: `apps/api/src/routes/` altında **37 route dosyası** var, mevcut sözlük **44 eylem** taşıyor ve her eylemin bir METADATA MİNİMİZASYON kararı var (`member.role_changed` yalnız from/to rolleri; `auth.ip_denied` adresi KASTEN saklamıyor). §5.1.1'in `SONNET-XHIGH` ölçütü "~3-5 dosya + kopyalanacak desen" der; burada 37 dosya taranıp muhakeme isteniyor.

KAPSAM (KOD DEĞİŞİKLİĞİ YOK — çıktı bir listedir):
- `apps/api/src/routes/*.ts` içindeki TÜM mutasyon uçları taranır ve mevcut `AUDIT_ACTIONS` (`apps/api/src/services/audit/audit-log.ts:33`) ile karşılaştırılır.
- Çıktı: (a) EKLENECEK eylem adlarının sabit listesi, (b) her biri için yazılacak/yazılmayacak metadata alanları, (c) kapsam dışı bırakılan uçların gerekçesi.
- Liste PLAN §D'ye kayıt olarak yazılır ve `C6-a2`'nin girdisi olur.

DOSYALAR: `apps/api/src/routes/*.ts` (yalnız okuma) · `apps/api/src/services/audit/audit-log.ts:33` · `PLAN.md` §D

REFERANS DESEN: tm 92 `08.9.7-c/-d/-e` — hangi uçların audit'e bağlandığının önceki turu; onların KAPSAM DIŞI bıraktıkları bu envanterin başlangıç noktasıdır.

KAPSAM DIŞI: kod değişikliği (C6-a2), export (C6-b/-c/-d).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build — hepsi exit 0 (kod değişmediği için regresyonsuz yeşil kalmalı); envanter §D'ye yazılır; HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 83.2. C6-a2 [SONNET-XHIGH] Envanterdeki eylemlerin AUDIT_ACTIONS'a eklenmesi + çağrıların bağlanması

**Status:** done  
**Dependencies:** 83.1  

Envanterdeki eylemlerin AUDIT_ACTIONS'a eklenmesi + çağrıların bağlanması

**Details:**

C6-a2 — Envanterdeki eylemlerin `AUDIT_ACTIONS`'a eklenmesi + çağrıların bağlanması  [SONNET-XHIGH]

PRD: C6 (PLAN §6.1.4 · dilim V3-2 · tm 83)
TAHMİN: ~1 pencere

NEDEN AÇIK: `C6-a1` bir envanter üretti (PLAN §D'de, ada bağlı sabit liste). Bu alt-görev o listeyi UYGULAR — karar vermez, kod yazar. Liste dışına ÇIKMA; yeni eylem icat etme.

KAPSAM: `C6-a1`'in listesindeki her eylem `AUDIT_ACTIONS`'a eklenir ve ilgili route handler'ında `writeAuditEntry` çağrısı bağlanır. Metadata alanları listede yazılı olanlarla SINIRLIDIR.

DOSYALAR: `apps/api/src/services/audit/audit-log.ts:33` (`AUDIT_ACTIONS` birliği) · `C6-a1` listesinde adı geçen route dosyaları

REFERANS DESEN (birebir): tm 92 `08.9.7-c` (webhook.created/deleted) ve `08.9.7-d`/`-e` (data.deleted) — eylem ekleme + çağrı bağlama kalıbı. `AUDIT_ACTIONS` KAPALI bir birliktir: eylem eklemek bir derleme hatasını çözmek demektir, serbest string değil.

KURAL: PII minimizasyonu korunur (`sanitizeAuditMetadata`); parola/token/sır ASLA yazılmaz. Şüphede kalırsan alanı YAZMA — `C6-a1` listesi neyin yazılacağını zaten söylüyor.

KAPSAM DIŞI: yeni eylem seçimi (C6-a1'in işi), export (C6-b/-c/-d).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir; HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 83.3. C6-b [OPUS-MAX] SIEM export kontratı + siem_export_cursors (keyset, tekrar-teslime dayanıklı) + NDJSON akışı

**Status:** done  
**Dependencies:** None  

SIEM export kontratı + siem_export_cursors (keyset, tekrar-teslime dayanıklı) + NDJSON akışı

**Details:**

C6-b — SIEM export kontratı + siem_export_cursors (keyset, tekrar-teslime dayanıklı) + NDJSON akışı  [OPUS-MAX]

PRD: C6 (PLAN §6.1 · dilim V3-2 · tm 83)
TAHMİN: ~1 pencere

KAPSAM: `GET /audit-log/export` (NDJSON akışı, keyset imleç) + `siem_export_cursors` tablosu (licenseId, target, lastExportedId, lastExportedAt) + RLS. İmleç TEKRAR-TESLİME DAYANIKLI olmalı: aynı imleçten iki kez okumak aynı satırları verir, satır ATLAMAZ.

**HEDEF YÖNETİM UÇLARI DA BU ALT-GÖREVE AİTTİR** (denetim bulgusu: `C6-f` ekranı hiçbir uca sahip değildi, contract-first sırası kırıktı): `GET|PATCH /settings/siem` (hedef okuma/yazma, `admin+` rol kapısı, `settings.security_updated` audit'i) + `GET /settings/siem/status` (son export zamanı, satır sayısı, zincir boşluğu bayrağı) + `packages/contract/openapi/paths/settings.yaml`.

**SCOPE KARARI ERTELENMİYOR** (denetim bulgusu — "bu pencerede karara bağlanır" bir SONNET-belirsizliğiydi, artık OPUS-MAX): export **ayrı bir scope ister** — `audit_log--all:ro` (tm 92) tek bir ekranın sayfalı okumasıdır; toplu dışa akış farklı bir yetkidir. Yeni scope `audit_log--export:ro` olarak eklenir ve `packages/types/src/scopes.ts` + kontrat + route config dörtlüsünde birden tanımlanır.

DOSYALAR: `apps/api/prisma/schema.prisma` + migration · `apps/api/src/routes/audit-log.ts` · `apps/api/src/services/audit/audit-log-reader.ts` · `packages/contract/openapi/paths/audit-log.yaml`

REFERANS DESEN: `audit-log-reader.ts` mevcut keyset okuma (tm 92 · `08.9.7-a`) · `apps/api/src/services/reports/report-csv.ts` (satır akışı/CSV üretimi) + `apps/api/src/services/reports/scheduled-report-sweeper.ts` (periyodik iş) — **`reports-export.ts` diye bir dosya YOKTUR** (denetim düzeltmesi) · rol/scope kapısı emsali tm 92 `08.9.7-a`.

KAPSAM DIŞI: bütünlük zinciri (C6-c), hedef (C6-d).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 83.4. C6-c [OPUS-MAX] Export bütünlüğü çekirdeği (BÖLÜNMEZ) — kayıt zinciri (HMAC) + export imzası + boşluk tespiti

**Status:** done  
**Dependencies:** 83.3  

Export bütünlüğü çekirdeği (BÖLÜNMEZ) — kayıt zinciri (HMAC) + export imzası + boşluk tespiti

**Details:**

C6-c — Export bütünlüğü çekirdeği (BÖLÜNMEZ) — kayıt zinciri (HMAC) + export imzası + boşluk tespiti  [OPUS-MAX]

PRD: C6 (PLAN §6.1 · dilim V3-2 · tm 83)
TAHMİN: ~3 pencere

BÖLÜNMEZ ÇEKİRDEK (PLAN §5.1.2). Gerekçe: bir denetim izinin değeri SİLİNEMEZ olmasında değil, SİLİNDİĞİNİN GÖRÜLEBİLMESİNDEDİR. Zincir (her satır bir öncekinin HMAC'ini taşır), export imzası ve boşluk tespiti üçü birlikte TEK bir iddiayı taşır: "bu export eksiksizdir ve değiştirilmemiştir". Herhangi biri ayrı pencereye alınırsa aradaki sürümde imzalı ama EKSİK bir export üretilir; denetçiye verilen kanıt sessizce değersizleşir — üstelik testler yeşilken.

KAPSAM: `audit_log` satırlarına zincir alanı (prevHash/hash) + INSERT yolunda hesaplama + export imzası + `verifyChain()` + boşluk tespiti. Anahtar lisans başına türetilir ve EXPORT'A GİRMEZ (§C-A22).

KRİTİK INVARYANT (test edilecek): `RETENTION_AUDIT_DAYS=30` budaması (tm 92 `08.9.7-h`, `audit_prune_expired` SECURITY DEFINER) HENÜZ EXPORT EDİLMEMİŞ satırı SİLMEZ. Aksi hâlde kayıt kalıcı olarak kaybolur ve zincirde onarılamaz boşluk kalır.

DOSYALAR: `apps/api/src/services/audit/audit-log.ts` · `apps/api/src/services/audit/audit-log-reader.ts` · `apps/api/src/lib/crypto.ts` · yeni migration (zincir kolonları + budama fonksiyonunun güncellenmesi)

REFERANS DESEN: `lib/crypto.ts` HMAC kullanımı (webhook HMAC-SHA256, **tm 34 · `08.8.4-b`** — denetim düzeltmesi: tm 33 = "06 AI Agent + Knowledge", ilgisiz) · `audit_prune_expired` SECURITY DEFINER kalıbı (tm 92).

KAPSAM DIŞI: hedef/zamanlama (C6-d), ekran (C6-f).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

**EXPORT FORMATI BU PENCEREDE KİLİTLENİR** (denetim bulgusu): NDJSON'un zincir/imza alanlarını nasıl taşıdığı — her satırda `prev_hash`/`hash` alanı mı, yoksa dosya sonunda imza satırı mı, yoksa yan `.sig` dosyası mı — burada karara bağlanır ve §C'ye yazılır. `C6-d` (sink) ve `C6-g` (e2e) bu formatı VARSAYACAK; format kilitlenmezse ikisi de uyumsuz yazılır.

### 83.5. C6-d [SONNET-XHIGH] MOCK SIEM hedefi (.data/siem dosya sink) + zamanlanmış gönderim

**Status:** done  
**Dependencies:** 83.3, 83.4  

MOCK SIEM hedefi (.data/siem dosya sink) + zamanlanmış gönderim

**Details:**

C6-d — MOCK SIEM hedefi (.data/siem dosya sink) + zamanlanmış gönderim  [SONNET-XHIGH]

PRD: C6 (PLAN §6.1 · dilim V3-2 · tm 83)
TAHMİN: ~1 pencere

KAPSAM: SIEM hedefi yapılandırması (tip + hedef) + gönderim işi. Hedef MOCK'tur: `.data/siem/<licenseId>/<timestamp>.ndjson` dosyasına yazılır. Gerçek Splunk/Sentinel/Datadog bağlantısı YAPILMAZ (CLAUDE.md sınırı).

DOSYALAR: `apps/api/src/services/audit/siem-sink.ts` (yeni) · `apps/api/src/services/reports/` (sweeper emsali) · `apps/api/package.json` (`siem:run` script)

REFERANS DESEN (birebir): `apps/api/src/services/reports/scheduled-report-sweeper.ts` (**tm 94 · `07.9-sched-e`** — denetim düzeltmesi: tm 93 = "07.7 Rapor grupları", sweeper tm 94'ündür) — periyodik iş, imleç ilerletme, hata dayanıklılığı, lisans başına kilit.

**ZORUNLU SIRA İNVARYANTI (denetim bulgusu — kalıcı denetim kaydı kaybı riski):** dosya YAZILIR ve KAPATILIR → **SONRA** imleç ilerletilir; asla tersi. Sweeper lisans başına kilit alır (emsalin kilit kalıbı). Çökme hâlinde TEKRAR YAZIM kabul edilir, **ATLAMA kabul EDİLMEZ** — çünkü `C6-c`'nin invaryantı gereği budama yalnız "export edildi" damgalı satırı silebilir; imleç dosyadan önce ilerlerse budama gönderilmemiş satırları siler ve zincirde ONARILAMAZ boşluk kalır. Format `C6-c`'de kilitlendi; sink onu DEĞİŞTİRMEZ. Dosya sink deseni: `services/mail/mailer.ts` FileMailer (`.data/mail`) ve `services/storage` (`.data/uploads`).

KAPSAM DIŞI: bütünlük (C6-c'de), ekran (C6-f).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 83.6. C6-e [OPUS-XHIGH] Erişim gözden geçirme raporu (SOC 2 CC6.1 kanıtı) — kim/hangi rol/son giriş/PAT envanteri

**Status:** done  
**Dependencies:** 83.1  

Erişim gözden geçirme raporu (SOC 2 CC6.1 kanıtı) — kim/hangi rol/son giriş/PAT envanteri

**Details:**

C6-e — Erişim gözden geçirme raporu (SOC 2 CC6.1 kanıtı) — kim/hangi rol/son giriş/PAT envanteri  [OPUS-XHIGH]

PRD: C6 (PLAN §6.1 · dilim V3-2 · tm 83)
TAHMİN: ~1 pencere

KAPSAM: `GET /reports/access-review` — lisanstaki her üyelik: hesap, rol, durum (suspended/awaiting), son giriş, 2FA durumu; artı aktif PAT/OAuth/SCIM token envanteri (token DEĞERİ değil: id, sahip, scope'lar, son kullanım, oluşturma). Export edilebilir.

NEDEN: SOC 2 CC6.1 ("mantıksal erişim") kanıtı kod tarafından ÜRETİLEBİLİR bir kanıttır; sertifikasyonun kendisi değildir. Rapor KANIT ÜRETİR, KARAR VERMEZ — "bu erişim uygun mu" sorusu insan denetimidir (§C-A23).

DOSYALAR: `apps/api/src/routes/reports.ts` · `apps/api/src/services/reports/` · `apps/api/src/services/reports/report-csv.ts` · `packages/contract/openapi/paths/reports.yaml`

REFERANS DESEN: `routes/reports.ts` mevcut rapor ucu + `apps/api/src/services/reports/report-csv.ts` (**tm 94 · `07.9-sched-d2`** — denetim düzeltmesi: `07.7-v2` tm 93'ün PLAN kalem kodudur, alt-görev değil). Rol kapısı: yalnız `admin` ve üstü.

KAPSAM DIŞI: ekran — rapor bu turda API + export olarak teslim edilir; ayrı bir sayfa açılmaz.

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 83.7. C6-f [SONNET-XHIGH] Settings → Security: SIEM export ekranı (hedef, son export, boşluk uyarısı)

**Status:** done  
**Dependencies:** 83.3, 83.4, 83.5  

Settings → Security: SIEM export ekranı (hedef, son export, boşluk uyarısı)

**Details:**

C6-f — Settings → Security: SIEM export ekranı (hedef, son export, boşluk uyarısı)  [SONNET-XHIGH]

PRD: C6 (PLAN §6.1 · dilim V3-2 · tm 83)
TAHMİN: ~1 pencere

KAPSAM: SIEM bölümü — hedef yapılandırma formu, son export zamanı ve satır sayısı, zincir boşluğu tespit edilmişse UYARI bandı.

DOSYALAR: `apps/web/src/features/settings/SiemExport.tsx` (yeni) + test · `apps/web/src/features/settings/SettingsPage.tsx`

**YENİ SUNUCU UCU AÇILMAZ** (denetim bulgusu): hedef okuma/yazma ve durum uçları `C6-b`'nin malıdır (`GET|PATCH /settings/siem`, `GET /settings/siem/status`); bu ekran onları TÜKETİR.

REFERANS DESEN (birebir): `apps/web/src/features/settings/ScheduledExports.tsx` (**tm 94 · `07.9-sched-h`** — denetim düzeltmesi) — zamanlanmış iş yapılandırma ekranının kalıbı; uyarı için `components/ui/Banner.tsx` (segmentli + kalıcı dismiss, tm 62).

KAPSAM DIŞI: e2e (C6-g).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

### 83.8. C6-g [OPUS-XHIGH] Uçtan uca doğrulama — eylem→audit→export→zincir; append-only; boşluk negatifi; cross-tenant

**Status:** done  
**Dependencies:** 83.4, 83.5, 83.6, 83.7  

Uçtan uca doğrulama — eylem→audit→export→zincir; append-only; boşluk negatifi; cross-tenant

**Details:**

C6-g — Uçtan uca doğrulama — eylem→audit→export→zincir; append-only; boşluk negatifi; cross-tenant  [OPUS-XHIGH]

PRD: C6 (PLAN §6.1 · dilim V3-2 · tm 83)
TAHMİN: ~1 pencere

KAPSAM: (1) güvenlik-hassas eylem → audit satırı → export → zincir doğrulaması uçtan uca. (2) append-only korunur (UPDATE/DELETE DB'de reddedilir). (3) boşluk tespiti NEGATİFİ: elle silinen satır yakalanır. (4) cross-tenant izolasyonu. (5) e2e: SIEM ekranı + erişim raporu (kanıt PNG `apps/e2e/kanit/C6-siem-export.png`).

DOSYALAR: `apps/e2e/tests/siem.spec.ts` (yeni) · `apps/api/test/integration/siem-export.test.ts` · `apps/e2e/kanit/`

KAPI: bu alt-görev yeşile dönmeden kalem ✅ olmaz. Kalemin ✅'i YALNIZ KOD PAYINI kapsar — sertifikasyon süreci §F.00'ı bloklamaz (§D97).

DoD (CONVENTIONS §1): typecheck + lint + unit + integration + build + ilgili e2e — hepsi exit 0;
PLAN gereksinim satırı güncellenir (damga yalnız `✅ → K<kod>` / `◐ → K<kod>`, kanıt `## K.`
bölümüne madde olarak); HANDOFF.md'ye kısa not; commit + push; Task Master'da done.

**YETKİ REDDİ NEGATİFİ (denetim bulgusu K1-2 · ZORUNLU):** SIEM export/hedef uçlarının `siem_export` yetkisi olmadan (`growth` planı) ilgili uçlar **REDDEDİLMELİDİR**. Bu test bu alt-görevin süitindedir; kapı `11.5-b`'de kurulur (tm 84). `tm 84` bu kalemden SONRA koşacaksa test önce `skip` değil, **kapı kurulana kadar kırmızı bırakılmaz** — sıralama gereği `11.5-b` daha önce bitmiş olmalıdır (bkz. §6.2 bağımlılık notu).
