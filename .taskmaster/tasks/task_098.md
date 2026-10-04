# Task ID: 98

**Title:** 05.6 — Skill şablon kataloğunu 31+ (ADR-14 uyumlu ikame)  ·  dilim V2-6

**Status:** done

**Dependencies:** 78 ✓

**Priority:** medium

**Description:** Faz 2 (v2) · PLAN §5.2 · 5 atomik alt-görev. Bu turda kapsam süpürmesinde bulundu (PLAN §D62).

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `05.6-tmpl31`.

5 atomik alt-görev · ~6 pencere · etiket dağılımı: SONNET-MAX x1 · SONNET-XHIGH x4

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  05.6-tmpl31-a [SONNET-XHIGH] Katalog şeması genişletme: rozet alanı (Popular/Essential) + invariant testlerinin sıkılaştırılması  (bağ: —)
  05.6-tmpl31-b [SONNET-MAX] 23+ yeni şablon kaydı — katalog 8 → 31+  (bağ: 05.6-tmpl31-a)
  05.6-tmpl31-c [SONNET-XHIGH] Katalog i18n: şablon metinleri TR/EN (NFR-I18N2)  (bağ: 05.6-tmpl31-b)
  05.6-tmpl31-d [SONNET-XHIGH] Galeri ölçek davranışı: arama + kategori filtresi + sanal liste (31+ kart)  (bağ: 05.6-tmpl31-b)
  05.6-tmpl31-e [SONNET-XHIGH] Kapanış: tam DoD + galeri e2e regresyonu + PLAN/HANDOFF izleri  (bağ: 05.6-tmpl31-c, 05.6-tmpl31-d)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): Bölünemez çekirdek YOK — bu kalemde güvenlik sınırı, eşzamanlılık veya algoritma tasarımı bulunmuyor. Kaynak recon'un birebir tespiti: iş, `templates.ts` içindeki salt-okunur statik bir diziye kayıt eklemekten ibaret; authN/authZ, tenant izolasyonu, SSRF, kripto, rate-limit veya PII yüzeyi AÇMIYOR (katalog dış servise bağlanmıyor, kullanıcı girdisi almıyor, yeni DB/API yazma yolu eklemiyor). Bu yüzden kalemin TAMAMI `SONNET-*` etiketlidir — v2'de bu özelliğe sahip tek kalem.

VARSAYIMLAR: KK-türetilmiş: PRD §5.3 'Otomasyon' hücresi '31+ şablon' der ama aynı hücredeki görsel node/edge Workflow builder ADR-14 ile ⛔. Şablon SAYISI hedefi, ADR-14'ten bağımsız olarak Skill şablon galerisi (05.1/05.2, v1'de ✅ teslim) üzerinden onurlandırıldı. Görsel canvas YAPILMAZ. §C-A14. · Katalog DETERMİNİSTİK ve YERELDİR (apps/web/src/features/playbook/templates.ts) — dış servis, backend route veya DB tablosu AÇILMAZ. Bu, ADR-14 ve mevcut mimariyle tutarlıdır: 'template' kavramı bugün kontratta hiç yok (grep 0) ve orada kalır. · Hedef sayı 31+; bugünkü katalog 8 kayıt (3 prebuilt + 2 ai + 3 trending) → en az 23 yeni kayıt. · Yeni kayıtlar mevcut `SkillTemplate` şeklini korur (id/name/category/summary/instruction/steps/requiresIntegration) ve `templates.test.ts`'in üç mevcut invariantını (name/instruction dolu + ≥1 step; her step validateSteps ile senkron; id benzersiz) sağlar.

AÇIK SORULAR (ürün kararı): Katalog bugün tamamen İngilizce ve `apps/web/src/lib/i18n.ts`'e hiç bağlı değil. NFR-I18N2 'en az TR/EN' istiyor. 23+ yeni kayıt eklemeden ÖNCE i18n'e bağlanmalı mı (12.4-bi-c sırası) yoksa katalog İngilizce kalıp yalnız UI mi çevrilmeli? Şu anki kırılım i18n'i ayrı alt-göreve (-c) aldı ve içerik ekleme (-b) ondan ÖNCE geliyor — tersine çevrilirse 23 kayıt iki dilde yazılır (daha pahalı ama tek geçiş). · Kaynak recon bir kapsam boşluğu işaret etti: katalogda regüle/bahis dikeyine (KYC, para çekme, çevrim şartı, sorumlu oyun) özel TEK BİR şablon yok (grep 0). PRD satır 114 bu dikeye değiniyor. Bu dikey ilk 31'e dahil edilmeli mi, yoksa ayrı bir ürün kararı mı? · FR-MOD-05.2 kart rozetlerinde 'Popular'/'Essential' geçiyor ama TEMPLATE_CATEGORIES yalnız 3 sabit tür tanımlıyor (prebuilt/ai/trending). Rozetler ayrı bir kategori mi olmalı yoksa kart üstü etiket mi?

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 98.1. 05.6-tmpl31-a [SONNET-XHIGH] Katalog şeması genişletme: rozet alanı (Popular/Essential) + invariant testlerinin sıkılaştırılması

**Status:** done  
**Dependencies:** None  

`SkillTemplate` tipine opsiyonel `badge?: 'popular'|'essential'` alanı (kategori DEĞİL — kategori grubu, rozet vurgu). `templates.test.ts` invariantları sıkılaştırılır: id benzersizliği ZORUNLU hâle gelir (23+ kayıt eklenirken çakışma en olası hata), `summary` uzunluk sınırı, `steps` en az 1 ve hepsi `validateSteps` ile senkron. Bu alt-görev **içerik EKLEMEZ** — yalnız 23+ kaydın güvenle eklenebil

**Details:**

05.6-tmpl31-a — Katalog şeması genişletme: rozet alanı (Popular/Essential) + invariant testlerinin sıkılaştırılması  [SONNET-XHIGH]

PRD: FR-MOD-05.2 (kart rozetleri) + §5.3-Otomasyon (31+ şablon)
ETİKET GEREKÇESİ: SONNET-XHIGH: 6 koşul sağlandı. (1) 2 dosya. (2) Güvenlik YOK — statik veri. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var: `packages/types/src/template-variables.ts` (sabit katalog + doğrulayıcı deseni, tm 50). (5) Kontrat değişikliği yok (katalog kontrata hiç yansımıyor — grep 0). (6) KK mekanik: tip + invariant testleri.
NEDEN AÇIK: `TEMPLATE_CATEGORIES` yalnız 3 sabit tür (prebuilt/ai/trending) tanımlıyor; FR-MOD-05.2 (PRD satır 557) kart rozetlerinde 'Popular'/'Essential' de geçiyor ama bunlar ayrı bir alan olarak modellenmemiş.
KAPSAM: `SkillTemplate` tipine opsiyonel `badge?: 'popular'|'essential'` alanı (kategori DEĞİL — kategori grubu, rozet vurgu). `templates.test.ts` invariantları sıkılaştırılır: id benzersizliği ZORUNLU hâle gelir (23+ kayıt eklenirken çakışma en olası hata), `summary` uzunluk sınırı, `steps` en az 1 ve hepsi `validateSteps` ile senkron. Bu alt-görev **içerik EKLEMEZ** — yalnız 23+ kaydın güvenle eklenebileceği kapıyı kurar.
DOSYALAR: apps/web/src/features/playbook/templates.ts · apps/web/src/features/playbook/templates.test.ts
REFERANS DESEN (kopyalanacak): packages/types/src/template-variables.ts (TEMPLATE_VARIABLES sabit katalog + findTemplateProblems doğrulayıcı — tm 50, §D45) · apps/web/src/features/playbook/templates.test.ts (mevcut 3 invariant)
KK (birebir): "KK-türetilmiş: 'Katalog kayıtları benzersiz kimlikli, şema-geçerli ve adım-doğrulamasından geçmiş olmalıdır; rozet alanı kategoriden ayrıdır.' — PRD §5.3 hücresi bir Kabul Kriteri sütunu içermiyor (kk_yetersiz), türetme FR-MOD-05.2 rozet ifadesi ve mevcut test invariantları üzerinden yapıldı. §C-A14."
KK DOĞRULAMA: `pnpm --filter @siyahtus/web test -- templates` — id çakışması olan bir kayıt eklendiğinde test KIRILIR (kapı çalışıyor); `badge` alanı opsiyonel olduğu için mevcut 8 kayıt DEĞİŞMEDEN geçer.
KAPSAM DIŞI: 23+ yeni kayıt eklemek (05.6-tmpl31-b) · i18n (05.6-tmpl31-c) · Galeri ölçek davranışı (05.6-tmpl31-d) · Backend/kontrat 'template' kavramı — AÇILMAZ (ADR-14 ile tutarlı)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 98.2. 05.6-tmpl31-b [SONNET-MAX] 23+ yeni şablon kaydı — katalog 8 → 31+

**Status:** done  
**Dependencies:** 98.1  

Kataloğa 23+ yeni `SkillTemplate`. Kategori dağılımı dengeli (prebuilt/ai/trending), `badge` alanı seçmeli kullanılır. Her kayıt: gerçekçi `instruction` (seed.ts'teki skill.create içeriği kalibrasyon referansı) + `validateSteps`'ten geçen `steps` + doğru `requiresIntegration` bayrağı. **Bu alt-görev 2 pencereye taşabilir** — taşarsa kategori bazında ikiye bölünür (prebuilt+ai / trending), bölme no

**Details:**

05.6-tmpl31-b — 23+ yeni şablon kaydı — katalog 8 → 31+  [SONNET-MAX]

PRD: §5.3-Otomasyon ('31+ şablon') + FR-MOD-05.1/05.2 (galeri + öneri kartları)
ETİKET GEREKÇESİ: SONNET-MAX: koşul 2 ve 3 sağlanıyor (güvenlik/eşzamanlılık YOK — statik veri), ama iş **mekanik olarak girifttir**: 23+ ayrı şablonun her biri gerçekçi bir `instruction` + tutarlı `steps` dizisi ister; her adımın `validateSteps` ile senkron kalması, id'lerin çakışmaması, kategori dağılımının dengeli olması gerekir. Geniş yüzey + çok sayıda benzer dönüşüm = SONNET-MAX tanımı. Etrafındaki her şey ucuz SONNET-XHIGH.
NEDEN AÇIK: `apps/web/src/features/playbook/templates.ts` `SKILL_TEMPLATES` bugün TAM OLARAK 8 kayıt: prebuilt 3 (order-status, returns-policy, business-hours), ai 2 (greet-and-route, collect-then-handover), trending 3 (shopify-o…). PRD hedefi 31+ → en az 23 yeni kayıt eksik (somut sayısal açık).
KAPSAM: Kataloğa 23+ yeni `SkillTemplate`. Kategori dağılımı dengeli (prebuilt/ai/trending), `badge` alanı seçmeli kullanılır. Her kayıt: gerçekçi `instruction` (seed.ts'teki skill.create içeriği kalibrasyon referansı) + `validateSteps`'ten geçen `steps` + doğru `requiresIntegration` bayrağı. **Bu alt-görev 2 pencereye taşabilir** — taşarsa kategori bazında ikiye bölünür (prebuilt+ai / trending), bölme noktası şimdiden belli.
DOSYALAR: apps/web/src/features/playbook/templates.ts · apps/web/src/features/playbook/templates.test.ts
REFERANS DESEN (kopyalanacak): apps/web/src/features/playbook/templates.ts (mevcut 8 kayıt — şekil, ton ve ayrıntı düzeyi kalibrasyonu) · apps/api/prisma/seed.ts (skill.create çağrısı ~satır 379 — gerçekçi bir Skill'in instruction/steps şekli) · packages/ai-mock/src/compiler.ts (validateSteps — adımların geçerli sayılma kuralı)
KK (birebir): "KK-türetilmiş: 'Katalog en az 31 şablon içerir; her şablon şema-geçerlidir ve adımları doğrulamadan geçer.' — §C-A14 (PRD §5.3 hücresinde Kabul Kriteri sütunu yok)."
KK DOĞRULAMA: `pnpm --filter @siyahtus/web test -- templates` — (1) `SKILL_TEMPLATES.length >= 31` iddiası (KK'nın sayısal payının doğrudan ölçümü); (2) -a'da sıkılaştırılan invariantların hepsi 31+ kayıt için yeşil; (3) her kategoride en az N kayıt (galeri boş grup göstermez).
KAPSAM DIŞI: i18n çevirisi (05.6-tmpl31-c) · Galeri arama/filtre/sanal liste (05.6-tmpl31-d) · Regüle/bahis dikeyi şablonları — açık soru, ürün kararı bekliyor
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 98.3. 05.6-tmpl31-c [SONNET-XHIGH] Katalog i18n: şablon metinleri TR/EN (NFR-I18N2)

**Status:** done  
**Dependencies:** 98.2  

Şablonların kullanıcıya görünen metinleri (`name`, `summary`) i18n anahtarlarına taşınır; `instruction`/`steps` **çevrilmez** (bunlar AI'ya giden talimat metnidir, dil değişimi davranışı değiştirir — bilinçli sınır). TR karşılıkları eklenir. Eksik çeviri anahtarı testle yakalanır.

**Details:**

05.6-tmpl31-c — Katalog i18n: şablon metinleri TR/EN (NFR-I18N2)  [SONNET-XHIGH]

PRD: §5.3-Otomasyon + NFR-I18N2 (en az TR/EN)
ETİKET GEREKÇESİ: SONNET-XHIGH: 6 koşul sağlandı. (1) 2-3 dosya. (2) Güvenlik yok. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var: `apps/web/src/lib/i18n.ts` (tm 26'da kurulan TR/EN altyapısı; nav etiketleri aynı desenle çevrildi). (5) Kontrat yok. (6) KK mekanik: her anahtarın iki dilde karşılığı var mı.
NEDEN AÇIK: Katalog tamamen İngilizce; `apps/web/src/lib/i18n.ts` sistemine hiç bağlı değil (`templates.ts`'te sabit İngilizce string'ler). NFR-I18N2 'en az TR/EN' istiyor → doğrulanmamış boşluk. 31+ kayıtla bu boşluk 4 kat büyür.
KAPSAM: Şablonların kullanıcıya görünen metinleri (`name`, `summary`) i18n anahtarlarına taşınır; `instruction`/`steps` **çevrilmez** (bunlar AI'ya giden talimat metnidir, dil değişimi davranışı değiştirir — bilinçli sınır). TR karşılıkları eklenir. Eksik çeviri anahtarı testle yakalanır.
DOSYALAR: apps/web/src/features/playbook/templates.ts · apps/web/src/lib/i18n.ts · apps/web/src/features/playbook/templates.test.ts
REFERANS DESEN (kopyalanacak): apps/web/src/lib/i18n.ts (tm 26 — TR/EN anahtar deseni, nav.home vb.) · apps/web/src/features/playbook/TemplateGallery.tsx (metinlerin tüketildiği yer)
KK (birebir): "KK-türetilmiş: 'Kullanıcıya görünen şablon metinleri TR ve EN'de eksiksizdir; talimat metni çevrilmez.' — §C-A14 + NFR-I18N2."
KK DOĞRULAMA: `pnpm --filter @siyahtus/web test -- templates` — her şablonun `name`/`summary` anahtarının hem TR hem EN sözlükte karşılığı var; eksik anahtar testi KIRAR. `instruction` alanının i18n'e taşınMADIĞı da iddia edilir (bilinçli sınırın regresyon koruması).
KAPSAM DIŞI: instruction/steps çevirisi — bilinçli olarak YAPILMAZ · 45+ dil hedefi (PRD hedefi; NFR-I18N2 en az TR/EN diyor)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 98.4. 05.6-tmpl31-d [SONNET-XHIGH] Galeri ölçek davranışı: arama + kategori filtresi + sanal liste (31+ kart)

**Status:** done  
**Dependencies:** 98.2  

Galeriye debounce'lu ada/özete göre arama + kategori sekmesi/filtresi; kart listesi mevcut `VirtualList` primitifine taşınır. Sonuç boşsa anlamlı empty state (boş dikdörtgen değil). Mevcut a11y davranışı (Escape/backdrop kapama, focus-trap) KORUNUR — regresyon testiyle bağlanır.

**Details:**

05.6-tmpl31-d — Galeri ölçek davranışı: arama + kategori filtresi + sanal liste (31+ kart)  [SONNET-XHIGH]

PRD: FR-MOD-05.1/05.2 (galeri) + FR-EK-B.1 + NFR-P4
ETİKET GEREKÇESİ: SONNET-XHIGH: 6 koşul sağlandı. (1) 2 dosya. (2) Güvenlik yok. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var: `apps/web/src/components/VirtualList.tsx` (EK-B.1/T6-a, tm 30) + `skill-filter.ts` (05.4-a'da kurulan arama/filtre deseni). (5) Kontrat yok. (6) KK mekanik: filtre daraltır, sanal pencere yalnız görünür kartı DOM'a koyar.
NEDEN AÇIK: `TemplateGallery.tsx` bugün 8 kaydı kategori gruplarında düz render ediyor — arama yok, sanal liste yok. 8 kartta sorun değil; 31+ kartta modal uzar, bulunabilirlik düşer ve NFR-P4 bütçesi ölçülemez hâle gelir.
KAPSAM: Galeriye debounce'lu ada/özete göre arama + kategori sekmesi/filtresi; kart listesi mevcut `VirtualList` primitifine taşınır. Sonuç boşsa anlamlı empty state (boş dikdörtgen değil). Mevcut a11y davranışı (Escape/backdrop kapama, focus-trap) KORUNUR — regresyon testiyle bağlanır.
DOSYALAR: apps/web/src/features/playbook/TemplateGallery.tsx · apps/web/src/features/playbook/TemplateGallery.test.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/components/VirtualList.tsx (T6-a virtualized liste primitifi — tm 30) · apps/web/src/features/playbook/skill-filter.ts (05.4-a arama/filtre deseni) · apps/web/src/components/EmptyState.tsx
KK (birebir): "KK-türetilmiş: 'Katalog 31+ kayıtta da gezilebilir: arama ve kategori filtresi daraltır, yalnız görünür kartlar DOM'a girer, boş sonuç anlamlı empty state gösterir.' — §C-A14 + FR-EK-B.1."
KK DOĞRULAMA: `TemplateGallery.test.tsx` — (1) arama sonucu daraltır; (2) kategori filtresi doğru alt kümeyi verir; (3) **sanal pencere:** 31+ kayıtta DOM'daki kart sayısı toplam kayıttan belirgin AZ (T6-a'nın görünür-satır testinin aynısı); (4) boş sonuç → anlamlı empty state; (5) **regresyon:** Escape/backdrop kapama ve focus-trap korunur.
KAPSAM DIŞI: Yeni şablon eklemek · RecommendedSkills şeridi (mevcut davranış korunur)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 98.5. 05.6-tmpl31-e [SONNET-XHIGH] Kapanış: tam DoD + galeri e2e regresyonu + PLAN/HANDOFF izleri

**Status:** done  
**Dependencies:** 98.3, 98.4  

Tam DoD kapısı (exit 0). E2E: galeri aç → ara → şablon seç → skill editörü ön-dolu açılır → kaydet. PLAN §5.0 `05.6-tmpl31` satırı ⬜→✅ + §5.0'daki 13.4 satırının ADR-14 ikame notunun teyidi. HANDOFF notu.

**Details:**

05.6-tmpl31-e — Kapanış: tam DoD + galeri e2e regresyonu + PLAN/HANDOFF izleri  [SONNET-XHIGH]

PRD: §5.3-Otomasyon (kalem kapanışı)
ETİKET GEREKÇESİ: SONNET-XHIGH: 6 koşul sağlandı. Bu kalemde kapanış turu bile ucuzdur çünkü güvenlik yüzeyi yok, ADR tutarlılığı sorgusu yok ve doğrulama tamamen mekanik (sayı ≥31, testler yeşil, DoD exit 0). Kalemin diğer alt-görevleriyle aynı sınıf.
NEDEN AÇIK: Alt-görevler ayrı pencerelerde iner; '31+ şablon' iddiası ve galerinin ölçekte çalıştığı ancak hepsi bir arada koşulunca doğrulanır.
KAPSAM: Tam DoD kapısı (exit 0). E2E: galeri aç → ara → şablon seç → skill editörü ön-dolu açılır → kaydet. PLAN §5.0 `05.6-tmpl31` satırı ⬜→✅ + §5.0'daki 13.4 satırının ADR-14 ikame notunun teyidi. HANDOFF notu.
DOSYALAR: apps/e2e/tests/playbook-templates.spec.ts · PLAN.md · HANDOFF.md
REFERANS DESEN (kopyalanacak): apps/e2e/tests/ (mevcut playbook e2e akışları) · PLAN.md §4.4 kapanış alt-görev örnekleri
KK (birebir): "KK-türetilmiş: 'Katalog en az 31 şablon içerir ve galeri bu ölçekte gezilebilir; şablondan skill oluşturma akışı bozulmamıştır.' — §C-A14."
KK DOĞRULAMA: E2E tek akışta 31+ kataloglu galeriden arama ile şablon bulup skill oluşturur — KK'nın hem sayısal hem işlevsel payı bu akışta.
KAPSAM DIŞI: Yeni özellik
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
