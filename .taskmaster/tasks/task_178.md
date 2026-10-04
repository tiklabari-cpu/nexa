# Task ID: 178

**Title:** M-RPT — Rapor metrik dogrulugu — deflection ajan-ajan devirlerini AI devri sayiyor

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** `transferCount` (report-csv.ts:937) `chat_transferred` olaylarini `reason` ayrimi YAPMADAN sayiyor; ayni SQL :1044 te tekrarlaniyor. `skillRun.count` uc yerde filtresiz (report-csv.ts:1489, :1726, routes/reports.ts:719) → Copilot assistleri AI Agent yetenegi sayiliyor. Ve testi YESILDI ama hatayi yakalayamiyordu.

**Details:**

PRD satır **579-593** (FR-MOD-07.4) ve **699-706** (FR-MOD-12) · denetim `prd-uyum-denetimi.md` §3 D7.

**ŞEMA DEĞİŞİKLİĞİ GEREKMİYOR — iki hazır dayanak var:**
- `reason` alanı olayın `properties`ine **zaten yazılıyor**: `chat-service.ts:980` (`reason: target.reason`) ve `ai-responder.ts:135` (`reason: 'ai_handoff'`).
- `Skill.aiAgentId` **zaten var** (`schema.prisma:1384`); `SkillRun.skillId → Skill` üzerinden filtrelenebilir.

**Test Strategy:**

Kalem bütününün kabul kriteri: ajan→ajan devri ile AI→insan devri ayrı sayılıyor, Copilot kullanımı AI Agent raporuna karışmıyor, VE bu iki düzeltme geri alındığında testler kırmızıya dönüyor (fixture artık kör değil).

## Subtasks

### 178.1. M-RPT-a [SONNET-XHIGH] transferCount reason filtresi + ikinci kopyanın tek yardımcıya indirilmesi

**Status:** done  
**Dependencies:** None  

SQL'e `AND e.properties @> '{"reason":"ai_handoff"}'::jsonb` ekle. **Containment (`@>`) kullan, `->>` değil** — jsonb GIN indeksinden faydalanmak için; dosyanın kendi yorumu bu gerekçeyi yazıyor. `:1044` civarındaki ikinci kopyayı da düzelt; iki kopya bu hatanın iki yerde yaşamasının sebebi. `TRANSFER_REASONS` sözlüğünü oku — `ai_handoff` dışında "AI devri" sayılan bir reason var mı, kararını yorumla.

**Details:**

Bağımlılık: yok. Dilim V7-2. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 178.2. M-RPT-b [SONNET-XHIGH] skill_runs sayımını AI Agent`a kilitle (üç çağrı yeri)

**Status:** done  
**Dependencies:** None  

`Skill.aiAgentId != null` olan skill'lerin run'ları sayılsın. **Önce varsayımı doğrula:** Copilot gerçekten `skill_runs` yazıyor mu? `skill_runs` yazan yolları grep'le ve `aiAgentId` null olan skill'lerin kim tarafından koşulduğunu tespit et — varsayım yanlışsa filtre de yanlış olur. Bulduğunu yorumla. Üç çağrı yerinin üçünü de düzelt.

**Details:**

Bağımlılık: yok. Dilim V7-2. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 178.3. M-RPT-c [OPUS-XHIGH] Kör fixture`ı düzelt + körlüğü KANITLA + diğer rapor fixture`larını tara

**Status:** done  
**Dependencies:** None  

Denetimin ders niteliğindeki bulgusu: rapor fixture'ı `chat_transferred` olaylarını `reason`suz yazdığı için test yeşilken kriter yanlıştı — yani test ne düzeltmeyi ne bozulmayı görebiliyordu. Fixture iki devir türü ve iki run türü üretsin; iddialar yanlış sayımda KIRILSIN. **Atlanamaz adım:** `-a`/`-b` düzeltmesini geçici geri al, testin kırmızıya döndüğünü gör, geri getir, sonucu HANDOFF'a yaz. Ayrıca diğer rapor fixture'larını tara: ayrım yapılan bir alan fixture'da hep aynı değeri alıyorsa o test de kördür — bulguları listele.

**Details:**

Bağımlılık: M-RPT-a, M-RPT-b. Dilim V7-2. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.
