# Task ID: 96

**Title:** 12.4 — Copilot BI komut (rapor/metrik sorusu)  ·  dilim V2-5

**Status:** done

**Dependencies:** 78 ✓

**Priority:** medium

**Description:** Faz 2 (v2) · PLAN §5.2 · 6 atomik alt-görev. Bu turda kapsam süpürmesinde bulundu (PLAN §D62).

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `12.4-bi`.

6 atomik alt-görev · ~7 pencere · etiket dağılımı: OPUS-MAX x1 · OPUS-XHIGH x2 · SONNET-XHIGH x3

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  12.4-bi-a [SONNET-XHIGH] Kontrat: `POST /copilot/bi` anchor'ı + bundle + tip üretimi  (bağ: —)
  12.4-bi-b [OPUS-XHIGH] `@siyahtus/ai-mock`'ta soru → rapor metriği eşleyici (deterministik, LLM yok)  (bağ: —)
  12.4-bi-c [OPUS-MAX] BI endpoint çekirdeği — scope birleşimi + müşteri-token sınırı + tenant izolasyonu + ADR-09 tutarlılığı  (bağ: 12.4-bi-a, 12.4-bi-b)
  12.4-bi-d [SONNET-XHIGH] CopilotPanel'de BI soru girişi + cevap kartı  (bağ: 12.4-bi-c)
  12.4-bi-e [SONNET-XHIGH] Anlaşılmadı / yetersiz veri durumları — anlamlı empty state + örnek sorular  (bağ: 12.4-bi-d)
  12.4-bi-f [OPUS-XHIGH] Uçtan uca doğrulama + ADR-09 çapraz kontrolü + kapanış  (bağ: 12.4-bi-d, 12.4-bi-e)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): **12.4-bi-c bölünmez.** BI endpoint'inin çekirdeğinde üç sınır aynı anda karar bekliyor: (a) **scope birleşimi** — BI cevabı rapor verisi taşıdığı için `reports_read` gerekir, ama uç Copilot domain'inde; hangi scope kombinasyonunun isteneceği tek bir yetkilendirme kararıdır; (b) **müşteri token'ına kapalılık** (agent+bot principals, 404 boundary — copilot.ts'in mevcut I4 deseni) ve **cross-tenant izolasyon**; (c) **ADR-09 tutarlılığı** — uç kendi SQL'ini YAZMAMALI, mevcut reports sorgularını çağırmalıdır; aksi hâlde 'Copilot 12 diyor, Reports 11 diyor' sınıfı bir sapma doğar ve bu testlerde kolayca gözden kaçar. Bu üçü ayrı pencerelere bölünürse, scope'u yazan pencere ADR-09'u, ADR-09'u yazan pencere sınır davranışını görmez. Çevresindeki her şey (kontrat, niyet eşleyici, UI, empty state) AYRI ve daha ucuz alt-görevlere çıkarıldı.

VARSAYIMLAR: KK-türetilmiş: PRD'de bu kalem için ayrı FR-MOD satırı YOK — yalnız §5.5 matrisinde MOD-12'nin v2 hücresinde '○ (BI komut)' var ve §5.3 faz başlığı 'Copilot BI' diyor. Kabul kriteri §C varsayımı olarak türetildi. · BI komutu CHAT BAĞLAMLIDIR (mevcut /copilot/* uçları gibi chatId alır veya hesap geneli çalışır); hesap/takım geneli bağlamsız sorgu ⌘K paletinin işidir (01.1.3-ai). İki yüzey bilinçli olarak ayrıldı — aynı endpoint'e iki farklı bağlam yüklemek yetki kararını bulanıklaştırır. · Cevap DETERMİNİSTİKTİR: @siyahtus/ai-mock niyeti çözer, sayıyı mevcut reports sorgusu üretir. Serbest metin üretimi YOK — 'uydurulmuş sayı' sınıfı yapısal olarak imkânsız. · Yeni ApiError tipi AÇILMAZ: anlaşılmayan soru / yetersiz veri 200 + kind alanı ile döner (errors.ts ×2 + scopes.test.ts sayacı + openapi enum + regen tuzağı).

AÇIK SORULAR (ürün kararı): BI komutu hangi scope'u istemeli: yalnız `reports_read` mi, Copilot'un mevcut scope'u + `reports_read` birleşimi mi? Tasarım tercihi: birleşim (en dar yetki), ama ürün tarafı 'Copilot kullanan herkes BI görsün' derse gevşetilir. · Hangi metrik seti ilk turda desteklensin? Şu an /reports/overview'ın KPI'ları hedeflendi (chats, closed, çözüm split'i, CSAT). Breakdown boyutları (07.5) indikten sonra 'kanal bazında' sorular da cevaplanabilir hâle gelir — ayrı tur mu olmalı?

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 96.1. 12.4-bi-a [SONNET-XHIGH] Kontrat: `POST /copilot/bi` anchor'ı + bundle + tip üretimi

**Status:** done  
**Dependencies:** None  

`copilot.yaml`'a `bi` anchor'ı: `POST /copilot/bi`, operationId `copilotBi`, body `{ question: string }` (uzunluk tavanı), yanıt `{ answer: string, kind: 'metric'|'no_data'|'not_understood', metric: string|null, value: number|null, range: {from,to}|null }`. `openapi.yaml`'a `$ref: './paths/copilot.yaml#/bi'`. Regenerate.

**Details:**

12.4-bi-a — Kontrat: `POST /copilot/bi` anchor'ı + bundle + tip üretimi  [SONNET-XHIGH]

PRD: §5.5-MOD-12 (v2 '○ (BI komut)') + §5.3 faz başlığı
ETİKET GEREKÇESİ: SONNET-XHIGH: 6 koşul sağlandı. (1) 2 kontrat dosyası + üretilen çıktı. (2) Güvenlik sınırı yok — yalnız şema metni. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var: aynı dosyadaki `summary`/`reply`/`enhance` anchor'ları (operationId + body/response deseni birebir). (5) Katkısal ve mekanik. (6) KK mekanik: contract-parity + bundle diff. UYARI: tek başına inerse contract-parity KIRILIR (iki yönlü) → -c ile ardışık koşulur.
NEDEN AÇIK: `packages/contract/openapi/paths/copilot.yaml` anchor'ları tam olarak: knowledge, knowledgeSource, summary, reply, enhance. 'bi' veya benzeri anchor YOK; `openapi.yaml`'da da referans yok.
KAPSAM: `copilot.yaml`'a `bi` anchor'ı: `POST /copilot/bi`, operationId `copilotBi`, body `{ question: string }` (uzunluk tavanı), yanıt `{ answer: string, kind: 'metric'|'no_data'|'not_understood', metric: string|null, value: number|null, range: {from,to}|null }`. `openapi.yaml`'a `$ref: './paths/copilot.yaml#/bi'`. Regenerate.
DOSYALAR: packages/contract/openapi/paths/copilot.yaml · packages/contract/openapi/openapi.yaml · packages/contract/src/generated/api.ts · packages/contract/dist/openapi.json
REFERANS DESEN (kopyalanacak): packages/contract/openapi/paths/copilot.yaml (summary/reply/enhance anchor'ları — operationId + şema deseni birebir)
KK (birebir): "KK-türetilmiş: 'Copilot bir rapor/metrik sorusuna, Reports ile BİREBİR aynı sayıyı vererek cevap verir; anlamadığı soruyu uydurmaz.' — PRD'de bu kalem için Kabul Kriteri sütunu YOK (yalnız §5.5 matris hücresi '○ (BI komut)'), türetme ADR-09 tutarlılık kuralı ve mevcut copilot.ts sınır deseni üzerinden yapıldı. §C varsayımı."
KK DOĞRULAMA: `pnpm --filter @siyahtus/contract generate` sonrası üretilen tipte `copilotBi` görünür; `contract-parity.test.ts` -c ile birlikte yeşil.
KAPSAM DIŞI: Route implementasyonu (12.4-bi-c) · Niyet eşleyici (12.4-bi-b) · UI (12.4-bi-d/-e)
SÖZLEŞME: packages/contract/openapi/paths/copilot.yaml'a `bi` anchor + openapi.yaml $ref. UYARI: re-bundle şart; route inmeden tek başına inerse contract-parity kırılır.
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 96.2. 12.4-bi-b [OPUS-XHIGH] `@siyahtus/ai-mock`'ta soru → rapor metriği eşleyici (deterministik, LLM yok)

**Status:** done  
**Dependencies:** None  

`packages/ai-mock/src/bi-intent.ts` — saf, deterministik: `resolveBiQuestion(question) => { metric: MetricKey|null, range: RelativeRange|null, confidence: number }`. Sıralı Matcher listesi (compiler.ts mimarisi): metrik sözlüğü (chats/closed/csat/resolution split), göreli tarih ifadeleri ('bu hafta', 'son 7 gün', 'dün'). Eşiğin altında `metric:null` döner (uydurmaz). **Saf modül** — Prisma/Fastify

**Details:**

12.4-bi-b — `@siyahtus/ai-mock`'ta soru → rapor metriği eşleyici (deterministik, LLM yok)  [OPUS-XHIGH]

PRD: §5.5-MOD-12 (v2 BI komut) + NFR-P2
ETİKET GEREKÇESİ: OPUS-XHIGH: koşul 4 tam sağlanmıyor — `compiler.ts` (NL→SkillStep) ve `intent.ts` (eşik tabanlı intent) mimari örnek verir ama 'soru → hangi metrik + hangi tarih aralığı' eşlemesi YENİ bir tasarım kararıdır (metrik sözlüğü, tarih ifadesi çözümleme, belirsizlik eşiği). Güvenlik sınırı yok, eşzamanlılık yok → MAX değil.
NEDEN AÇIK: `packages/ai-mock` içinde 'doğal dil soru → hangi rapor sorgusu + hangi parametre' eşlemesi yapan fonksiyon YOK. En yakın parçalar başka özellikler için yazılmış: `compiler.ts` (NL→SkillStep, 06.2.3), `intent.ts` (matchIntent, eşik 0.6).
KAPSAM: `packages/ai-mock/src/bi-intent.ts` — saf, deterministik: `resolveBiQuestion(question) => { metric: MetricKey|null, range: RelativeRange|null, confidence: number }`. Sıralı Matcher listesi (compiler.ts mimarisi): metrik sözlüğü (chats/closed/csat/resolution split), göreli tarih ifadeleri ('bu hafta', 'son 7 gün', 'dün'). Eşiğin altında `metric:null` döner (uydurmaz). **Saf modül** — Prisma/Fastify/ağ yok.
DOSYALAR: packages/ai-mock/src/bi-intent.ts · packages/ai-mock/src/bi-intent.test.ts · packages/ai-mock/src/index.ts
REFERANS DESEN (kopyalanacak): packages/ai-mock/src/compiler.ts (compileInstruction — sıralı regex Matcher listesi mimarisi) · packages/ai-mock/src/intent.ts (matchIntent — eşik tabanlı güven skoru, INTENT_THRESHOLD deseni)
KK (birebir): "KK-türetilmiş: 'Anlaşılan soru doğru metriğe ve doğru tarih aralığına eşlenir; eşik altındaki soru için metrik DÖNMEZ (uydurma yok).' — §C varsayımı; PRD'de KK sütunu yok."
KK DOĞRULAMA: `pnpm --filter @siyahtus/ai-mock test -- bi-intent` — tablo testi: bilinen soru kalıpları doğru `metric`+`range` üretir; **NEGATİF:** alakasız/bulanık soru `metric:null` döner ve bir metrik UYDURMAZ; aynı girdi her koşuda aynı çıktı (determinizm).
KAPSAM DIŞI: Endpoint (12.4-bi-c) · Gerçek LLM (ADR: mock) · Breakdown boyutlu sorular (07.5 indikten sonra ayrı tur)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 96.3. 12.4-bi-c [OPUS-MAX] BI endpoint çekirdeği — scope birleşimi + müşteri-token sınırı + tenant izolasyonu + ADR-09 tutarlılığı

**Status:** done  
**Dependencies:** 96.1, 96.2  

`copilot.ts`'e `POST /copilot/bi`: scope birleşimi (Copilot scope + `reports_read`), `request.withTenant`, agent+bot principals (müşteri token → 404). Akış: zod doğrula (uzunluk tavanı) → `resolveBiQuestion` (12.4-bi-b) → metrik varsa **mevcut reports servis fonksiyonunu ÇAĞIR** (kendi SQL'ini yazmaz — ADR-09 tek tanım korunur) → cevabı `{kind:'metric', metric, value, range}` olarak döndür; metrik

**Details:**

12.4-bi-c — BI endpoint çekirdeği — scope birleşimi + müşteri-token sınırı + tenant izolasyonu + ADR-09 tutarlılığı  [OPUS-MAX]

PRD: §5.5-MOD-12 (v2 BI komut) + ADR-09 + NFR-S3 + NFR-S4 + NFR-S5 + NFR-S8
ETİKET GEREKÇESİ: OPUS-MAX: koşul 2 ihlal, çekirdek güvenlik/bütünlük sınırı. Üç karar aynı akıl yürütmede: scope birleşimi (en dar yetki), müşteri token'ına kapalılık + cross-tenant izolasyon, ve ADR-09 tutarlılığı (kendi SQL'ini yazmama disiplini). Bölünürse biri diğerini görmeden yazılır. Bkz. bolunmeyen_gerekce.
NEDEN AÇIK: `apps/api/src/routes/copilot.ts` içinde BI/rapor sorgusu cevaplayan rota YOK (yalnız knowledge/summary/reply/enhance). `copilot-service.ts` içinde reports sorgularını sarmalayan metod YOK.
KAPSAM: `copilot.ts`'e `POST /copilot/bi`: scope birleşimi (Copilot scope + `reports_read`), `request.withTenant`, agent+bot principals (müşteri token → 404). Akış: zod doğrula (uzunluk tavanı) → `resolveBiQuestion` (12.4-bi-b) → metrik varsa **mevcut reports servis fonksiyonunu ÇAĞIR** (kendi SQL'ini yazmaz — ADR-09 tek tanım korunur) → cevabı `{kind:'metric', metric, value, range}` olarak döndür; metrik yoksa `not_understood`, veri yoksa `no_data`. `copilot-service.ts`'e ince bir `answerBi()` sarmalayıcı.
DOSYALAR: apps/api/src/routes/copilot.ts · apps/api/src/services/ai/copilot-service.ts · apps/api/test/integration/copilot-bi.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/copilot.ts (mevcut summary/reply/enhance — scope + withTenant + zod + müşteri-token 404 sınırı birebir aynı iskelet) · apps/api/src/routes/reports.ts (overview sorgusu — ADR-09'un tek tanımı; çağrılacak kaynak) · apps/api/src/routes/reports-metrics.ts (round/resolutionRate — aynı aritmetik yeniden kullanılır, kopyalanmaz)
KK (birebir): "KK-türetilmiş: 'Copilot bir rapor/metrik sorusuna, Reports ile BİREBİR aynı sayıyı vererek cevap verir; anlamadığı soruyu uydurmaz; başka lisansın verisi sızmaz.' — §C varsayımı."
KK DOĞRULAMA: `apps/api/test/integration/copilot-bi.test.ts` — (1) **ADR-09 tutarlılığı:** aynı pencere için `/copilot/bi` cevabı ile `/reports/overview` sayısı BİREBİR aynı (bu testin kırılması sapmanın tek erken uyarısıdır); (2) **CROSS-TENANT:** başka lisansın verisi cevaba girmez; (3) **NEGATİF:** müşteri token'ı → 404; (4) **NEGATİF:** `reports_read` olmayan token → 403; (5) **NEGATİF:** tavanı aşan question → 400; (6) anlaşılmayan soru → 200 `not_understood` (hata zarfı DEĞİL).
KAPSAM DIŞI: UI (12.4-bi-d/-e) · Kendi SQL'ini yazmak — ADR-09 gereği YASAK · Yeni scope tanımlamak · Breakdown boyutlu sorular (07.5 sonrası)
SÖZLEŞME: yok — şema -a'da indi; bu alt-görev onu SUNAR (contract-parity iki yönlü, -a ile birlikte yeşile döner)
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 96.4. 12.4-bi-d [SONNET-XHIGH] CopilotPanel'de BI soru girişi + cevap kartı

**Status:** done  
**Dependencies:** 96.3  

CopilotPanel'e 'Sor' bölümü: soru girdisi + gönder; cevap kartında `value` + `metric` etiketi + `range` (hangi pencere) gösterilir. **Kaynak şeffaflığı:** kart 'Reports → Overview' gibi kaynağı açıkça yazar (kullanıcı sayının nereden geldiğini görür — ADR-09 güveninin UI karşılığı). Yükleniyor → skeleton.

**Details:**

12.4-bi-d — CopilotPanel'de BI soru girişi + cevap kartı  [SONNET-XHIGH]

PRD: §5.5-MOD-12 (v2 BI komut)
ETİKET GEREKÇESİ: SONNET-XHIGH: 6 koşul sağlandı. (1) 2 dosya + testi. (2) Güvenlik yok — yetki -c'de. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var: `CopilotPanel.tsx`'in mevcut summary/reply akış render'ı. (5) Kontrat yok. (6) KK mekanik: girdi → çağrı → kart render.
NEDEN AÇIK: `apps/web` tarafında Copilot panelinde BI komutu girme/cevap gösterme UI'ı YOK — mevcut `CopilotPanel` yalnızca özet/reply/enhance akışlarını render ediyor.
KAPSAM: CopilotPanel'e 'Sor' bölümü: soru girdisi + gönder; cevap kartında `value` + `metric` etiketi + `range` (hangi pencere) gösterilir. **Kaynak şeffaflığı:** kart 'Reports → Overview' gibi kaynağı açıkça yazar (kullanıcı sayının nereden geldiğini görür — ADR-09 güveninin UI karşılığı). Yükleniyor → skeleton.
DOSYALAR: apps/web/src/features/inbox/CopilotPanel.tsx · apps/web/src/features/inbox/CopilotPanel.test.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/inbox/CopilotPanel.tsx (mevcut summary/reply akışı — istek + yükleniyor + sonuç render deseni) · apps/web/src/components/ui/Skeleton.tsx
KK (birebir): "KK-türetilmiş: 'Kullanıcı bir metrik sorusu sorar ve cevabı kaynağıyla birlikte görür.' — §C varsayımı."
KK DOĞRULAMA: `CopilotPanel.test.tsx` — soru gönderilince `POST /copilot/bi` çağrılır; `kind:'metric'` cevabı `value`+`metric`+kaynak etiketiyle render edilir; yükleniyorken skeleton görünür.
KAPSAM DIŞI: Boş/anlaşılmadı durumları (12.4-bi-e) · Cevabı note'a/chat'e aktarmak
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 96.5. 12.4-bi-e [SONNET-XHIGH] Anlaşılmadı / yetersiz veri durumları — anlamlı empty state + örnek sorular

**Status:** done  
**Dependencies:** 96.4  

`not_understood` → anlamlı empty state + **örnek soru listesi** (tıklanınca girdiye dolar; ai-mock'un desteklediği kalıplardan türetilir, uydurma değil). `no_data` → 'seçili pencerede veri yok' + pencereyi genişletme önerisi. İkisi de boş dikdörtgen DEĞİL (FR-EK-B.1).

**Details:**

12.4-bi-e — Anlaşılmadı / yetersiz veri durumları — anlamlı empty state + örnek sorular  [SONNET-XHIGH]

PRD: §5.5-MOD-12 + FR-EK-B.1 (anlamlı empty state — boş dikdörtgen yok)
ETİKET GEREKÇESİ: SONNET-XHIGH: 6 koşul sağlandı. (1) 1 dosya + testi. (2) Güvenlik yok. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var: `apps/web/src/components/ui/EmptyState.tsx` (EK-B.1, tm 30). (5) Kontrat yok. (6) KK mekanik: iki durumun render'ı.
NEDEN AÇIK: -d yalnız başarılı `metric` cevabını render eder; `not_understood` ve `no_data` için UI yolu yok. Bu iki durum BI komutunun en sık karşılaşılacak hâlleridir (kullanıcı ne sorabileceğini bilmiyor).
KAPSAM: `not_understood` → anlamlı empty state + **örnek soru listesi** (tıklanınca girdiye dolar; ai-mock'un desteklediği kalıplardan türetilir, uydurma değil). `no_data` → 'seçili pencerede veri yok' + pencereyi genişletme önerisi. İkisi de boş dikdörtgen DEĞİL (FR-EK-B.1).
DOSYALAR: apps/web/src/features/inbox/CopilotPanel.tsx · apps/web/src/features/inbox/CopilotPanel.test.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/components/ui/EmptyState.tsx (EK-B.1 anlamlı empty state bileşeni) · apps/web/src/features/playbook/RecommendedSkills.tsx ('Try this' → girdiyi dolduran kart deseni)
KK (birebir): "KK-türetilmiş: 'Anlaşılmayan soru için ne sorulabileceği gösterilir; veri yoksa bu açıkça söylenir. Boş dikdörtgen gösterilmez.' — §C varsayımı + FR-EK-B.1."
KK DOĞRULAMA: `CopilotPanel.test.tsx` — `not_understood` cevabında örnek soru listesi render edilir ve bir örneğe tıklamak girdiyi doldurur; `no_data` cevabında anlamlı metin görünür; her iki durumda da boş dikdörtgen render EDİLMEZ.
KAPSAM DIŞI: Yeni soru kalıbı eklemek (ai-mock işi, 12.4-bi-b)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 96.6. 12.4-bi-f [OPUS-XHIGH] Uçtan uca doğrulama + ADR-09 çapraz kontrolü + kapanış

**Status:** done  
**Dependencies:** 96.4, 96.5  

Tam DoD kapısı (exit 0). E2E: Reports Overview'da bir KPI okunur → Copilot'a aynı soru sorulur → **iki sayı birebir aynı** olduğu iddia edilir. PLAN §5.0 `12.4-bi` satırı ⬜→✅; HANDOFF notu.

**Details:**

12.4-bi-f — Uçtan uca doğrulama + ADR-09 çapraz kontrolü + kapanış  [OPUS-XHIGH]

PRD: §5.5-MOD-12 (kalem kapanışı) + ADR-09
ETİKET GEREKÇESİ: OPUS-XHIGH: kapanış turu + ADR-09 çapraz doğrulaması yargı gerektirir (Copilot cevabı ile Reports ekranının aynı sayıyı gösterdiğinin uçtan uca kanıtı). Yeni güvenlik sınırı açmıyor → MAX değil.
NEDEN AÇIK: Alt-görevler ayrı pencerelerde iner; 'Copilot ile Reports aynı sayıyı söyler' iddiası ancak uçtan uca koşulunca kanıtlanır.
KAPSAM: Tam DoD kapısı (exit 0). E2E: Reports Overview'da bir KPI okunur → Copilot'a aynı soru sorulur → **iki sayı birebir aynı** olduğu iddia edilir. PLAN §5.0 `12.4-bi` satırı ⬜→✅; HANDOFF notu.
DOSYALAR: apps/e2e/tests/copilot-bi.spec.ts · PLAN.md · HANDOFF.md
REFERANS DESEN (kopyalanacak): apps/e2e/tests/copilot.spec.ts (mevcut Copilot e2e) · apps/e2e/tests/demo-flow.spec.ts
KK (birebir): "KK-türetilmiş: 'Copilot bir rapor/metrik sorusuna, Reports ile BİREBİR aynı sayıyı vererek cevap verir.' — §C varsayımı."
KK DOĞRULAMA: E2E tek akışta Reports KPI'sı ile Copilot cevabını karşılaştırır ve eşitlik iddia eder — KK'nın tamamı bu tek iddiada.
KAPSAM DIŞI: Yeni özellik
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
