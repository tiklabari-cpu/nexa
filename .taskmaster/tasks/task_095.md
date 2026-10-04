# Task ID: 95

**Title:** 01.1.3 — ⌘K command palette AI komutları  ·  dilim V2-5

**Status:** done

**Dependencies:** 78 ✓

**Priority:** medium

**Description:** Faz 2 (v2) · PLAN §5.2 · 8 atomik alt-görev. Bu turda kapsam süpürmesinde bulundu (PLAN §D62).

**Details:**

Faz 2 (v2) · PLAN §5.2 · kalem `01.1.3-ai`.

8 atomik alt-görev · ~8 pencere · etiket dağılımı: OPUS-MAX x1 · OPUS-XHIGH x3 · SONNET-XHIGH x4

ALT-GÖREVLER SIRAYLA (her biri tek temiz pencere, kendi DoD kapısı):
  01.1.3-ai-a [SONNET-XHIGH] Statik aksiyon kataloğu (`actions.ts`) + `PaletteResult` birleşik tipi  (bağ: —)
  01.1.3-ai-b [OPUS-XHIGH] Aksiyon sonuç tipinin scope kapısı — yetkisi olmayan aksiyon palette GÖRÜNMEZ  (bağ: 01.1.3-ai-a)
  01.1.3-ai-c [OPUS-XHIGH] Aksiyon tetikleme — `run()` bağlama + optimistic durum + hata geri alma  (bağ: 01.1.3-ai-b)
  01.1.3-ai-d [SONNET-XHIGH] Kontrat: `POST /palette/ai-query` + bundle + tip üretimi  (bağ: —)
  01.1.3-ai-e [OPUS-MAX] AI sorgu endpoint'i — scope kapısı + tenant izolasyonu + deterministik cevap (reports verisinden)  (bağ: 01.1.3-ai-d)
  01.1.3-ai-f [SONNET-XHIGH] Palette'te AI sorgu sonuç tipi + cevap kartı + boş/anlaşılmadı durumları  (bağ: 01.1.3-ai-e)
  01.1.3-ai-g [SONNET-XHIGH] Klavye/a11y: ↑↓/esc üç sonuç tipinde de tutarlı (NFR-A11Y6 regresyonu)  (bağ: 01.1.3-ai-c, 01.1.3-ai-f)
  01.1.3-ai-h [OPUS-XHIGH] Uçtan uca doğrulama + kapanış: tam DoD, e2e, PLAN/HANDOFF izleri  (bağ: 01.1.3-ai-c, 01.1.3-ai-f, 01.1.3-ai-g)

BÖLÜNMEYEN ÇEKİRDEK (PLAN §5.1.2 istisnası): Bölünemez çekirdek YOK — bu kalemde tek güvenlik sınırı 'aksiyon sonuç tipinin scope kapısı' (01.1.3-ai-b) ve o tek başına tutarlı bir akıl yürütmedir: katalog verisi (-a), tetikleme (-c) ve AI yolu (-d/-e/-f) ondan ayrılabilir. Yine de -b ve -c ARDIŞIK yapılmalıdır: kapı olmadan tetikleme yazılırsa, yetkisiz aksiyon UI'da gizlenmemiş hâlde tetiklenebilir hâle gelir ve testler bunu yakalamaz (endpoint 403 döner ama palet yanlış bir eylem sunmuş olur).

VARSAYIMLAR: AI sorgusu YENİ bir endpoint ister (POST /palette/ai-query); mevcut /copilot/* uçları chat bağlamına bağlıdır (chatId alır), palet ise chat bağlamsızdır. Copilot'un BI komutu (12.4-bi) chat bağlamlı kalır; palet sorgusu hesap/takım geneli olduğu için ayrı yüzeydir. · AI cevabı DETERMİNİSTİKTİR — @siyahtus/ai-mock üzerinden (ADR: dış LLM yok). Cevap serbest metin üretmez; mevcut reports sorgularından sayısal özet + kaynak metrik adı döner. Böylece ADR-09 tutarlılığı (aynı sorgu = aynı sayı) korunur. · Aksiyon kataloğu STATİKTİR (frontend'de `actions.ts`), NAV_DESTINATIONS deseninin ikizi. Backend'de 'aksiyon kataloğu' endpoint'i AÇILMAZ — her aksiyon zaten kendi scope'lu endpoint'ine sahiptir. · İlk aksiyon seti PRD'nin somut örneğiyle sınırlı tutuldu: 'Stop/Start Accepting Chats' (PATCH /agents/me/routing-status). Katalog genişletilebilir bırakıldı ama bu turda yalnız kanıtlanmış bir aksiyon bağlanır — yeni mutasyon yüzeyi açmamak için.

AÇIK SORULAR (ürün kararı): Palet AI sorgusu hangi scope'u istemeli — yalnız `reports_read` mi, yoksa ayrı bir `palette_ai` scope'u mu? Şu anki tasarım: mevcut `reports_read` yeniden kullanılır (yeni scope açmak scopes.test.ts sayacını ve openapi enum'unu da değiştirir). · Aksiyon kataloğu ileride kullanıcı tanımlı olabilir mi (ör. bir skill'i palete pinlemek)? Şu an statik; kontrat yüzeyi açılmadı.

NOT: Bu görevin kendisi kod YAZMAZ — alt-görevleri sırayla koşulur. Her alt-görev CONVENTIONS.md DoD kapısından (typecheck+lint+unit+integration+build+e2e) geçer.

**Test Strategy:**

Bu görev alt-görevleriyle tamamlanır. Her alt-görev kendi DoD kapısından geçer (typecheck+lint+unit+integration+build+e2e, exit 0). Güvenlik yüzeyi olan alt-görevlerde NEGATİF testler pozitiflerden ÖNCE yazılır ve CROSS-TENANT izolasyon testi zorunludur. DB süiti paylaşılan Postgres`te seri koşulur (--concurrency=1).

## Subtasks

### 95.1. 01.1.3-ai-a [SONNET-XHIGH] Statik aksiyon kataloğu (`actions.ts`) + `PaletteResult` birleşik tipi

**Status:** done  
**Dependencies:** None  

`apps/web/src/components/actions.ts` — NAV_DESTINATIONS'ın ikizi statik katalog: `{ id, label, keywords[], requiredScope, run: (deps) => Promise<void> }`. Bu turda tek kayıt: `toggle-accepting-chats` ('Stop Accepting Chats' / 'Start Accepting Chats', requiredScope agent kendi durumunu değiştirir). Ayrıca `PaletteResult` birleşik tipi (`{kind:'nav'|'content'|'action'|'ai'}`) tanımlanır ve CommandPa

**Details:**

01.1.3-ai-a — Statik aksiyon kataloğu (`actions.ts`) + `PaletteResult` birleşik tipi  [SONNET-XHIGH]

PRD: FR-MOD-01.1.3 (aksiyon sonuç tipi payı)
ETİKET GEREKÇESİ: SONNET-XHIGH: 6 koşulun hepsi sağlandı. (1) 2 dosya + testi. (2) Güvenlik sınırı YOK — bu alt-görev yalnız veri yapısı tanımlar, hiçbir şey tetiklemez ve hiçbir şey gizlemez; scope kapısı bilinçli olarak -b'ye ayrıldı. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var: `apps/web/src/components/navigation.ts` NAV_DESTINATIONS (label/keyword/icon üçlüsü + palet filtresi). (5) Kontrat değişikliği yok. (6) KK mekanik: katalog kayıtlarının şekli + tip birleşiminin derlenmesi.
NEDEN AÇIK: `apps/web/src/components/CommandPalette.tsx` bugün yalnız iki sonuç tipi üretiyor — navigasyon (NAV_DESTINATIONS'tan rota) ve içerik araması (customers/tickets/chats). 'Aksiyon' tipi yok: `apps/web/src/components/` altında action-tipi command üretimi grep 0. Statik bir aksiyon kataloğu hiç tanımlı değil.
KAPSAM: `apps/web/src/components/actions.ts` — NAV_DESTINATIONS'ın ikizi statik katalog: `{ id, label, keywords[], requiredScope, run: (deps) => Promise<void> }`. Bu turda tek kayıt: `toggle-accepting-chats` ('Stop Accepting Chats' / 'Start Accepting Chats', requiredScope agent kendi durumunu değiştirir). Ayrıca `PaletteResult` birleşik tipi (`{kind:'nav'|'content'|'action'|'ai'}`) tanımlanır ve CommandPalette'in mevcut iki tipi bu birleşime taşınır (davranış DEĞİŞMEZ — saf refactor). `run()` gövdeleri bu alt-görevde BOŞ bırakılmaz, ama palet onları henüz ÇAĞIRMAZ (bağlama -c'de).
DOSYALAR: apps/web/src/components/actions.ts · apps/web/src/components/actions.test.ts · apps/web/src/components/CommandPalette.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/components/navigation.ts (NAV_DESTINATIONS — statik katalog + keyword eşleşme deseni birebir) · apps/web/src/components/CommandPalette.tsx (mevcut sonuç üretimi + debounce'lu filtre) · packages/types/src/template-variables.ts (TEMPLATE_VARIABLES — 'tek doğruluk kaynağı sabit dizi, birden çok tüketici' deseni)
KK (birebir): "3 sonuç tipi: aksiyon ("Stop Accepting Chats"), navigasyon, AI sorgusu ("Summarize my team's activity…")"
KK DOĞRULAMA: `apps/web/src/components/actions.test.ts` — katalogdaki her kaydın `id`/`label`/`keywords`/`requiredScope` alanları dolu; `PaletteResult` birleşimi dört `kind` değerini de kabul ediyor; mevcut `CommandPalette.test.tsx` DEĞİŞMEDEN yeşil kalır (refactor'ın davranışı bozmadığının kanıtı).
KAPSAM DIŞI: Scope kapısı — yetkisiz aksiyonun listeden gizlenmesi (01.1.3-ai-b) · Aksiyonun fiilen tetiklenmesi (01.1.3-ai-c) · AI sorgu tipi (01.1.3-ai-d/-e/-f) · Yeni aksiyon eklemek — bu turda yalnız PRD'nin somut örneği bağlanır
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 95.2. 01.1.3-ai-b [OPUS-XHIGH] Aksiyon sonuç tipinin scope kapısı — yetkisi olmayan aksiyon palette GÖRÜNMEZ

**Status:** done  
**Dependencies:** 95.1  

Palet sonuç üretiminde aksiyon kayıtları, oturumun scope kümesine göre SÜZÜLÜR. Scope kümesi mevcut auth store'dan okunur (yeni endpoint AÇILMAZ). Süzme sonucu boşsa aksiyon başlığı hiç render edilmez (boş başlık gösterilmez). **Sınır beyanı:** bu bir UX kapısıdır; gerçek koruma hedef endpoint'in kendi scope kontrolüdür ve o zaten mevcuttur — testte ikisi birden doğrulanır.

**Details:**

01.1.3-ai-b — Aksiyon sonuç tipinin scope kapısı — yetkisi olmayan aksiyon palette GÖRÜNMEZ  [OPUS-XHIGH]

PRD: FR-MOD-01.1.3 + NFR-S3 (scope enforcement) + NFR-S5 (yetki sızıntısı yok)
ETİKET GEREKÇESİ: OPUS-XHIGH: koşul 2 ihlal — yetkilendirme (authZ) dokunuşu var. Ama çekirdek güvenlik sınırı DEĞİL: hedef endpoint zaten scope-gated (`agents.ts:52` PATCH /agents/me/routing-status), yani bu katman savunmanın İKİNCİ hattıdır — UI'da gizlemek tek başına koruma değildir, gerçek kapı backend'dedir. Kullanıcı kuralı 'güvenlik hassasiyeti olan ama çekirdek sınır olmayan işler EN AZ OPUS-XHIGH' → OPUS-XHIGH, MAX değil. Sonnet'e verilmez.
NEDEN AÇIK: Bugünkü palet salt-okunur (navigasyon + arama) — hiçbir sonuç bir POST/PATCH mutasyonu tetiklemiyor, dolayısıyla scope'a göre sonuç gizleme mekanizması hiç yazılmamış (kaynak recon: 'Aksiyon tetikleyen bir komut için yetki kontrolü tasarımı yok'). Aksiyon tipi açılınca bu boşluk bir yetki sızıntısına dönüşür: yetkisiz ajan, yapamayacağı bir eylemi menüde görür.
KAPSAM: Palet sonuç üretiminde aksiyon kayıtları, oturumun scope kümesine göre SÜZÜLÜR. Scope kümesi mevcut auth store'dan okunur (yeni endpoint AÇILMAZ). Süzme sonucu boşsa aksiyon başlığı hiç render edilmez (boş başlık gösterilmez). **Sınır beyanı:** bu bir UX kapısıdır; gerçek koruma hedef endpoint'in kendi scope kontrolüdür ve o zaten mevcuttur — testte ikisi birden doğrulanır.
DOSYALAR: apps/web/src/components/CommandPalette.tsx · apps/web/src/components/actions.ts · apps/web/src/components/CommandPalette.test.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/components/CommandPalette.tsx (mevcut scope-gated içerik araması — palet zaten bazı aramaları scope'a göre atlıyor, aynı kaynak kullanılır) · apps/api/src/routes/agents.ts:52 (PATCH /agents/me/routing-status — hedef endpoint'in kendi scope kapısı)
KK (birebir): "3 sonuç tipi: aksiyon ("Stop Accepting Chats"), navigasyon, AI sorgusu ("Summarize my team's activity…")"
KK DOĞRULAMA: `CommandPalette.test.tsx` — (1) gerekli scope'a SAHİP oturumda 'stop accepting' araması aksiyonu listeler; (2) **NEGATİF:** scope'a sahip OLMAYAN oturumda aynı arama aksiyonu listelemez ve 'aksiyon' başlığı hiç render edilmez; (3) scope kümesi boş olduğunda palet yine de navigasyon/arama sonuçlarını verir (aksiyon eksikliği paleti bozmaz).
KAPSAM DIŞI: Aksiyonun tetiklenmesi (01.1.3-ai-c) · Backend scope kontrolünü değiştirmek — dokunulmaz, yalnız referans alınır · Yeni scope tanımlamak (errors/scopes sayacı tuzağına girilmez)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 95.3. 01.1.3-ai-c [OPUS-XHIGH] Aksiyon tetikleme — `run()` bağlama + optimistic durum + hata geri alma

**Status:** done  
**Dependencies:** 95.2  

Aksiyon seçilince `run()` çağrılır: (1) palet KAPANIR (kullanıcı beklemede kalmaz), (2) durum optimistic güncellenir, (3) istek başarısızsa geri alınır + hata bildirimi. İlk somut aksiyon: 'Stop/Start Accepting Chats' → `PATCH /agents/me/routing-status`. Etiket duruma göre değişir (kabul ediyorsa 'Stop', etmiyorsa 'Start').

**Details:**

01.1.3-ai-c — Aksiyon tetikleme — `run()` bağlama + optimistic durum + hata geri alma  [OPUS-XHIGH]

PRD: FR-MOD-01.1.3 + FR-EK-A.2 (optimistic + hata geri alma)
ETİKET GEREKÇESİ: OPUS-XHIGH: koşul 2 ihlal — palet ilk kez bir MUTASYON tetikliyor (salt-okunur yüzeyden yazma yüzeyine geçiş). Ayrıca koşul 4 tam sağlanmıyor: optimistic + hata geri alma deseni depoda var (EK-A.2 `optimistic.ts`) ama palet bağlamına (modal kapanırken sonuçlanan istek) hiç uygulanmamış — tasarım kararı gerekiyor.
NEDEN AÇIK: Kaynak recon: 'bugünkü palet salt-okunur (navigasyon+arama), hiçbir run() bir POST/PATCH mutasyonu tetiklemiyor'. Katalog (-a) ve kapı (-b) hazır olsa bile aksiyon hâlâ çalışmaz.
KAPSAM: Aksiyon seçilince `run()` çağrılır: (1) palet KAPANIR (kullanıcı beklemede kalmaz), (2) durum optimistic güncellenir, (3) istek başarısızsa geri alınır + hata bildirimi. İlk somut aksiyon: 'Stop/Start Accepting Chats' → `PATCH /agents/me/routing-status`. Etiket duruma göre değişir (kabul ediyorsa 'Stop', etmiyorsa 'Start').
DOSYALAR: apps/web/src/components/CommandPalette.tsx · apps/web/src/components/actions.ts · apps/web/src/components/CommandPalette.test.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/lib/optimistic.ts (EK-A.2'de kurulan optimistic + hata geri alma primitifi — tm 30) · apps/api/src/routes/agents.ts:52 (PATCH /agents/me/routing-status — çağrılacak endpoint) · apps/web/src/features/inbox/DetailsPanel.tsx (mevcut optimistic toggle kullanımı)
KK (birebir): "3 sonuç tipi: aksiyon ("Stop Accepting Chats"), navigasyon, AI sorgusu ("Summarize my team's activity…")"
KK DOĞRULAMA: `CommandPalette.test.tsx` — aksiyon seçilince (1) `PATCH /agents/me/routing-status` çağrılır, (2) palet kapanır, (3) durum optimistic döner; **NEGATİF:** istek 4xx/5xx dönerse optimistic değişiklik GERİ ALINIR ve kullanıcıya hata gösterilir (sessiz yutulmaz).
KAPSAM DIŞI: Yeni aksiyon kayıtları eklemek · AI sorgu tipi (01.1.3-ai-d/-e/-f) · Backend endpoint'ini değiştirmek
SÖZLEŞME: yok — mevcut `PATCH /agents/me/routing-status` kullanılır
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 95.4. 01.1.3-ai-d [SONNET-XHIGH] Kontrat: `POST /palette/ai-query` + bundle + tip üretimi

**Status:** done  
**Dependencies:** None  

`packages/contract/openapi/paths/command-palette.yaml` — `POST /palette/ai-query`, body `{ query: string }` (uzunluk sınırlı), yanıt `{ answer: string, kind: 'summary'|'no_data'|'not_understood', metric_source?: string, ref?: { type, id } }`. `openapi.yaml`'a `$ref` ile bağlanır. `pnpm --filter @siyahtus/contract generate` ile bundle + `src/generated/api.ts` yeniden üretilir. **Yeni ApiError tipi AÇIL

**Details:**

01.1.3-ai-d — Kontrat: `POST /palette/ai-query` + bundle + tip üretimi  [SONNET-XHIGH]

PRD: FR-MOD-01.1.3 (AI sorgusu payı)
ETİKET GEREKÇESİ: SONNET-XHIGH: 6 koşul sağlandı. (1) 2 kontrat dosyası + üretilen çıktı. (2) Güvenlik sınırı YOK — bu adım yalnız şema metni; scope kararı ve enforcement -e'de. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var: `packages/contract/openapi/paths/copilot.yaml` (aynı domain-dosyası + anchor + operationId deseni). (5) Kontrat değişikliği katkısal ve mekanik. (6) KK mekanik: contract-parity + bundle diff. **UYARI:** bu alt-görev tek başına inerse `contract-parity.test.ts` KIRILIR (belgelenmiş ama sunulmayan route). Bu yüzden -e ile AYNI dilimde ve ARDIŞIK koşulur; ikisi tek pencerede de birleştirilebilir — ayrı tutulmasının sebebi -e'nin OPUS olması, kontrat yazımının ucuza inmesi.
NEDEN AÇIK: Backend'de palet-özel bir AI komut endpoint'i yok: `packages/contract/openapi/paths/` altında 'palette' veya 'command' adlı path dosyası/anahtarı grep 0.
KAPSAM: `packages/contract/openapi/paths/command-palette.yaml` — `POST /palette/ai-query`, body `{ query: string }` (uzunluk sınırlı), yanıt `{ answer: string, kind: 'summary'|'no_data'|'not_understood', metric_source?: string, ref?: { type, id } }`. `openapi.yaml`'a `$ref` ile bağlanır. `pnpm --filter @siyahtus/contract generate` ile bundle + `src/generated/api.ts` yeniden üretilir. **Yeni ApiError tipi AÇILMAZ** — anlaşılmayan soru bir hata değil, `kind:'not_understood'` ile 200 döner (errors.ts ×2 + scopes.test.ts sayacı + openapi enum + regen tuzağına girilmez).
DOSYALAR: packages/contract/openapi/paths/command-palette.yaml · packages/contract/openapi/openapi.yaml · packages/contract/src/generated/api.ts · packages/contract/dist/openapi.json
REFERANS DESEN (kopyalanacak): packages/contract/openapi/paths/copilot.yaml (domain dosyası + anchor + operationId deseni birebir) · packages/contract/openapi/paths/reports.yaml (description üslubu)
KK (birebir): "3 sonuç tipi: aksiyon ("Stop Accepting Chats"), navigasyon, AI sorgusu ("Summarize my team's activity…")"
KK DOĞRULAMA: `pnpm --filter @siyahtus/contract generate` sonrası `src/generated/api.ts` diff'inde yeni operation görünür; `apps/api/test/integration/contract-parity.test.ts` **-e ile birlikte** yeşil (tek başına kırmızıdır — bu bilinçli ve yukarıda not edildi).
KAPSAM DIŞI: Route implementasyonu (01.1.3-ai-e) · UI (01.1.3-ai-f) · Yeni scope veya yeni ApiError tipi tanımlamak
SÖZLEŞME: packages/contract/openapi/paths/command-palette.yaml YENİ dosya + openapi.yaml'a $ref. UYARI: re-bundle edilmezse contract-parity.test.ts kırılır; ayrıca route inmeden tek başına inerse de kırılır (iki yönlü test).
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 95.5. 01.1.3-ai-e [OPUS-MAX] AI sorgu endpoint'i — scope kapısı + tenant izolasyonu + deterministik cevap (reports verisinden)

**Status:** done  
**Dependencies:** 95.4  

`apps/api/src/routes/command-palette.ts` — `POST /palette/ai-query`, `{ config: { scopes: ['reports_read'] } }`, `request.withTenant` içinde. Akış: (1) zod ile `query` doğrula (uzunluk tavanı — NFR-S8), (2) `@siyahtus/ai-mock` ile niyeti çöz (intent.ts deseni; deterministik, LLM YOK), (3) niyet bir rapor metriğine eşleşiyorsa **mevcut reports servis fonksiyonunu çağır** — kendi SQL'ini YAZMAZ, böylece

**Details:**

01.1.3-ai-e — AI sorgu endpoint'i — scope kapısı + tenant izolasyonu + deterministik cevap (reports verisinden)  [OPUS-MAX]

PRD: FR-MOD-01.1.3 + NFR-S3 (scope) + NFR-S4 (tenant izolasyonu) + NFR-S5 (IDOR) + NFR-S8 (girdi sınırı)
ETİKET GEREKÇESİ: OPUS-MAX: koşul 2 ihlal ve bu sefer ÇEKİRDEK sınır. Üç şey aynı akıl yürütmenin parçası: (a) yeni bir yetkili endpoint'in scope kapısı (`reports_read` yeniden kullanılır, yeni scope açılmaz), (b) `request.withTenant` içinde çalışıp başka lisansın verisini asla göstermemesi, (c) müşteri token'ına kapalı olması (agent+bot principals, 404 boundary — copilot.ts'in I4 deseni). Bunlar ayrı pencerelere bölünürse ikinci pencere birincinin kurduğu sınırı görmeden yazar ve 'testler yeşil ama sınır açık' durumu oluşur. Bölünmez.
NEDEN AÇIK: Palet AI sorgusunu karşılayan bir route yok (kontrat da yok — bkz. -d). Serbest-dilde bir soruyu ayrıştırıp bir AI yanıtına çeviren kod `apps/web/src/components/` ve `apps/api/src/routes/` altında grep 0.
KAPSAM: `apps/api/src/routes/command-palette.ts` — `POST /palette/ai-query`, `{ config: { scopes: ['reports_read'] } }`, `request.withTenant` içinde. Akış: (1) zod ile `query` doğrula (uzunluk tavanı — NFR-S8), (2) `@siyahtus/ai-mock` ile niyeti çöz (intent.ts deseni; deterministik, LLM YOK), (3) niyet bir rapor metriğine eşleşiyorsa **mevcut reports servis fonksiyonunu çağır** — kendi SQL'ini YAZMAZ, böylece ADR-09 tutarlılığı yapısal olarak korunur, (4) eşleşmiyorsa `kind:'not_understood'`, veri yoksa `kind:'no_data'`. Müşteri token'ı → 404 (agent+bot principals default).
DOSYALAR: apps/api/src/routes/command-palette.ts · apps/api/src/server.ts · apps/api/test/integration/command-palette.test.ts · packages/ai-mock/src/palette-intent.ts · packages/ai-mock/src/palette-intent.test.ts
REFERANS DESEN (kopyalanacak): apps/api/src/routes/copilot.ts (scope-gated + withTenant + @siyahtus/ai-mock + zod parse + müşteri token 404 sınırı — birebir aynı iskelet) · packages/ai-mock/src/intent.ts (matchIntent — eşik tabanlı deterministik niyet eşleme) · apps/api/src/routes/reports.ts:510 (GET /reports/overview — çağrılacak veri kaynağı, ADR-09'un tek tanımı)
KK (birebir): "3 sonuç tipi: aksiyon ("Stop Accepting Chats"), navigasyon, AI sorgusu ("Summarize my team's activity…")"
KK DOĞRULAMA: `apps/api/test/integration/command-palette.test.ts` — (1) 'Summarize my team's activity' benzeri sorgu 200 + `kind:'summary'` + sayısal cevap döner; (2) **ADR-09 tutarlılığı:** dönen sayı aynı pencere için `GET /reports/overview` sayısıyla BİREBİR aynı; (3) **CROSS-TENANT:** başka lisansın verisi cevaba sızmaz; (4) **NEGATİF:** `reports_read` scope'u olmayan token → 403; (5) **NEGATİF:** müşteri token'ı → 404; (6) **NEGATİF:** tavanı aşan `query` → 400.
KAPSAM DIŞI: UI render (01.1.3-ai-f) · Yeni scope tanımlamak — `reports_read` yeniden kullanılır · Gerçek LLM çağrısı (ADR: mock) · Copilot'un chat-bağlamlı BI komutu (12.4-bi — ayrı yüzey)
SÖZLEŞME: yok — şema -d'de indi; bu alt-görev onu SUNAR (contract-parity iki yönlü olduğu için -d ile birlikte yeşile döner)
TAHMİN: 2 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 95.6. 01.1.3-ai-f [SONNET-XHIGH] Palette'te AI sorgu sonuç tipi + cevap kartı + boş/anlaşılmadı durumları

**Status:** done  
**Dependencies:** 95.5  

Palet girdisi bir aksiyona/navigasyona/içeriğe eşleşmiyorsa 'AI'ya sor' sonucu gösterilir; seçilince `POST /palette/ai-query` çağrılır ve cevap palet içinde bir kartta render edilir. Üç durum: `summary` (cevap + kaynak metrik adı), `no_data` (anlamlı empty state — boş dikdörtgen değil), `not_understood` (ne sorulabileceğine dair örnek). Yükleniyor durumu skeleton.

**Details:**

01.1.3-ai-f — Palette'te AI sorgu sonuç tipi + cevap kartı + boş/anlaşılmadı durumları  [SONNET-XHIGH]

PRD: FR-MOD-01.1.3 + FR-EK-B.1 (anlamlı empty state)
ETİKET GEREKÇESİ: SONNET-XHIGH: 6 koşul sağlandı. (1) 2 dosya + testi. (2) Güvenlik sınırı YOK — kapı -b'de, endpoint yetkisi -e'de; burada yalnız render. (3) Eşzamanlılık yok. (4) Kopyalanacak desen ismen var: `CopilotPanel.tsx` (AI cevabı + yükleniyor + boş durum render'ı) ve mevcut palet sonuç listesi. (5) Kontrat değişikliği yok. (6) KK mekanik: üç durumun render'ı.
NEDEN AÇIK: `CommandPalette.tsx` serbest-dilde bir soruyu ayrıştırıp bir AI endpoint'ine yönlendiren koda sahip değil (grep 0); AI cevabı için render yolu da yok.
KAPSAM: Palet girdisi bir aksiyona/navigasyona/içeriğe eşleşmiyorsa 'AI'ya sor' sonucu gösterilir; seçilince `POST /palette/ai-query` çağrılır ve cevap palet içinde bir kartta render edilir. Üç durum: `summary` (cevap + kaynak metrik adı), `no_data` (anlamlı empty state — boş dikdörtgen değil), `not_understood` (ne sorulabileceğine dair örnek). Yükleniyor durumu skeleton.
DOSYALAR: apps/web/src/components/CommandPalette.tsx · apps/web/src/components/CommandPalette.test.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/features/inbox/CopilotPanel.tsx (AI cevabı + yükleniyor + boş durum render deseni) · apps/web/src/components/ui/EmptyState.tsx (EK-B.1'de kurulan anlamlı empty state bileşeni — tm 30) · apps/web/src/components/ui/Skeleton.tsx
KK (birebir): "3 sonuç tipi: aksiyon ("Stop Accepting Chats"), navigasyon, AI sorgusu ("Summarize my team's activity…")" | ""Search Text or go to…""
KK DOĞRULAMA: `CommandPalette.test.tsx` — (1) eşleşmeyen girdi 'AI'ya sor' sonucunu gösterir; (2) seçilince endpoint çağrılır ve `summary` cevabı kartta görünür; (3) `no_data` → anlamlı empty state metni (boş dikdörtgen DEĞİL); (4) `not_understood` → örnek soru önerisi.
KAPSAM DIŞI: Backend davranışı · Cevabın chat'e/note'a aktarılması (Copilot işi, 12.x)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 95.7. 01.1.3-ai-g [SONNET-XHIGH] Klavye/a11y: ↑↓/esc üç sonuç tipinde de tutarlı (NFR-A11Y6 regresyonu)

**Status:** done  
**Dependencies:** 95.3, 95.6  

Dört sonuç tipi tek bir düz gezinme listesine indirgenir: ↑↓ gruplar arasında da hareket eder, esc paleti kapatır, Enter seçili sonucu çalıştırır. ARIA: `role=listbox`/`option` + `aria-activedescendant`; grup başlıkları odak almaz. Görsel odak halkası her tipte görünür.

**Details:**

01.1.3-ai-g — Klavye/a11y: ↑↓/esc üç sonuç tipinde de tutarlı (NFR-A11Y6 regresyonu)  [SONNET-XHIGH]

PRD: FR-MOD-01.1.3 + NFR-A11Y6
ETİKET GEREKÇESİ: SONNET-XHIGH: 6 koşul sağlandı. (1) 1 dosya + testi. (2) Güvenlik yok. (3) Eşzamanlılık yok. (4) Kopyalanacak desen: mevcut `CommandPalette.tsx` klavye gezinme kodu — yeni sonuç tipleri aynı listeye katılır. (5) Kontrat yok. (6) KK **birebir mekanik**: PRD 'klavye ↑↓/esc' diyor, test doğrudan bunu ölçer.
NEDEN AÇIK: Klavye gezinme MVP'de iki sonuç tipi için yazıldı. Aksiyon ve AI sonuçları listeye katılınca odak sırası, sarmalama (wrap) ve esc davranışı yeni tipleri kapsamıyor — `CommandPalette.test.tsx` bugün yalnız açılma/kapanma + rota atlama + içerik araması test ediyor, karışık listede gezinme testi yok.
KAPSAM: Dört sonuç tipi tek bir düz gezinme listesine indirgenir: ↑↓ gruplar arasında da hareket eder, esc paleti kapatır, Enter seçili sonucu çalıştırır. ARIA: `role=listbox`/`option` + `aria-activedescendant`; grup başlıkları odak almaz. Görsel odak halkası her tipte görünür.
DOSYALAR: apps/web/src/components/CommandPalette.tsx · apps/web/src/components/CommandPalette.test.tsx
REFERANS DESEN (kopyalanacak): apps/web/src/components/CommandPalette.tsx (mevcut ↑↓/esc kodu) · apps/web/src/features/playbook/step-reorder.ts (06.2.4-a'da kurulan klavye + ARIA duyuru deseni — NFR-A11Y4)
KK (birebir): "klavye ↑↓/esc"
KK DOĞRULAMA: `CommandPalette.test.tsx` — karışık sonuç listesinde (nav + content + action + ai) ↑↓ sırayla tüm seçenekleri dolaşır, grup başlıklarında durmaz, sonda başa sarar; esc kapatır; Enter seçili sonucu çalıştırır; `aria-activedescendant` seçili seçeneğe işaret eder.
KAPSAM DIŞI: Yeni sonuç tipi eklemek · Ekran okuyucu canlı duyurusu (mevcut davranış korunur)
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.

### 95.8. 01.1.3-ai-h [OPUS-XHIGH] Uçtan uca doğrulama + kapanış: tam DoD, e2e, PLAN/HANDOFF izleri

**Status:** done  
**Dependencies:** 95.3, 95.6, 95.7  

Tam DoD kapısı (typecheck + lint + unit + integration + build + e2e, exit 0). E2E: ⌘K aç → navigasyon çalışır → aksiyon çalışır (accepting-chats) → AI sorgusu cevap döner → esc kapatır. PLAN §5.0'daki `01.1.3-ai` satırı ⬜→✅ ve §3.1'deki 01.1.3 MVP satırına v2 payının kapandığı notu. HANDOFF notu.

**Details:**

01.1.3-ai-h — Uçtan uca doğrulama + kapanış: tam DoD, e2e, PLAN/HANDOFF izleri  [OPUS-XHIGH]

PRD: FR-MOD-01.1.3 (tam kalem kapanışı)
ETİKET GEREKÇESİ: OPUS-XHIGH: kapanış turu — koda karşı kanıt toplama, KK'nın üç sonuç tipinin de fiilen karşılandığının doğrulanması ve doküman senkronu yargı gerektirir (hangi satır ✅, hangisi ◐). Mekanik değil; ama yeni güvenlik sınırı da açmıyor → MAX değil.
NEDEN AÇIK: Alt-görevler ayrı pencerelerde iner; kalemin KK'sı (üç sonuç tipi + klavye) ancak hepsi bir arada koşturulunca doğrulanabilir.
KAPSAM: Tam DoD kapısı (typecheck + lint + unit + integration + build + e2e, exit 0). E2E: ⌘K aç → navigasyon çalışır → aksiyon çalışır (accepting-chats) → AI sorgusu cevap döner → esc kapatır. PLAN §5.0'daki `01.1.3-ai` satırı ⬜→✅ ve §3.1'deki 01.1.3 MVP satırına v2 payının kapandığı notu. HANDOFF notu.
DOSYALAR: apps/e2e/tests/command-palette.spec.ts · PLAN.md · HANDOFF.md
REFERANS DESEN (kopyalanacak): apps/e2e/tests/demo-flow.spec.ts (uçtan uca akış deseni) · PLAN.md §4.4 kapanış alt-görev örnekleri
KK (birebir): "3 sonuç tipi: aksiyon ("Stop Accepting Chats"), navigasyon, AI sorgusu ("Summarize my team's activity…")" | "klavye ↑↓/esc" | ""Search Text or go to…""
KK DOĞRULAMA: Tek e2e senaryosu KK'nın üç sonuç tipini de aynı oturumda kanıtlar; DoD kapısı exit 0.
KAPSAM DIŞI: Yeni özellik eklemek
TAHMİN: 1 pencere

BAĞLAM: PLAN.md §5.2 (özet) + PLAN-V2-KIRILIM.md (tam alan detayı). Etiket sistemi PLAN §5.1. DoD kapısı CONVENTIONS.md.
