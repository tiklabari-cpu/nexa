# Task ID: 118

**Title:** M-FMT — FORMAT-BORC — `pnpm format:check` repo genelinde kırmızı (346 dosya), iki penceredir taşınıyor

**Status:** done

**Dependencies:** None

**Priority:** critical

**Description:** `package.json:24`'teki `format:check` script'i 346 dosyada kırmızı. DoD kapısında olmadığı için hiçbir turu kırmadı ama HANDOFF tm 115 notu (2) ve tm 116 notu (3) bunu iki turdur "ayrı task'lık" diye adlandırdı ve görev hiç açılmadı. Bu görev o borcu kapatır.

**Details:**

(a) GEREKÇE VE KANIT (bu pencerede yeniden ÖLÇÜLDÜ, 2026-08-11 · GRAF-ONARIM):
- `npx prettier --check "**/*.{ts,tsx,js,json,md,css,yaml,yml}"` → **"Code style issues found in 346 files"**.
- Dosya türüne göre sayım (`--list-different`): **189 ts · 67 md · 59 tsx · 14 yml · 10 json · 7 yaml**.
- Kaynak: HANDOFF tm 115 notu (2) "repo genelinde 349 dosyada kırmızı; tm 115 öncesinden böyle ve DoD kapısında değil — kendi dokunduğum dosyaları formatladım, gerisine karışmadım (ayrı task'lık)" + tm 116 notu (3) aynısını tekrarladı. İki pencere borcu adlandırdı, hiçbiri görev açmadı; bu pencerenin graf taraması bunu açık uç olarak buldu.
- DoD kapısında **DEĞİL**: CONVENTIONS §1 typecheck · lint · unit · integration · build · e2e sayıyor, `format:check` yok. Yani bu bir kapı ihlali değil, **sessiz borç** (§F.1/6'nın kardeşi).

(b) DOKUNULACAK DOSYALAR: repo geneli kod globları + `.prettierignore` (gerekirse). `.prettierrc.json` **okunur, değiştirilmez**.

(c) SIRA: sözleşme/migration payı yok. Sıra: KARAR (aşağıdaki .md sorusu) → `.prettierignore` güncellemesi (gerekiyorsa) → `pnpm format` → tam DoD kapısı → tek `chore(format)` commit'i (+ gerekirse ayrı `chore(e2e)`).

(d) BİLİNEN TUZAKLAR — asıl iş burada, `--write` koşmak değil KARAR vermek:
- **67 `.md`'nin içinde `PLAN.md` (770 KB / ~4.200 satır) · `HANDOFF.md` · `CONVENTIONS.md` · `CLAUDE.md` · `README.md` · `TASK-RUNNER-PROMPT.md` · `PLAN-V2-KIRILIM.md` var.** `.prettierrc.json` md için `proseWrap: preserve` diyor (prose sarılmaz) ama prettier **tabloları yeniden hizalar**. PLAN'ın damga tabloları ve §K kanıt blokları bu depoda **grep'le** okunuyor (CLAUDE.md: "Hedef satırı `grep -n` ile bul"); boru işaretleri kalacağı için grep kalıpları hayatta kalır, ama diff devasa olur ve `git blame` bütün damga satırlarında bu commit'i gösterir.
  → **KARAR GEREKLİ, tek başına `--write` koşma:** (A) bu üretim-dışı `.md`'leri `.prettierignore`'a ekle — `.prettierignore` referans belgeler için **zaten aynı emsali taşıyor** ("Reference documents stay exactly as delivered": PRD, rapor-1/2, prd-yeterlilik, MASTER-PROMPT, v2-derin-analiz/); ya da (B) hepsini biçimlendir ve `.md` diff'ini **kod diff'inden ayrı** bir commit'e koy. Hangisini seçersen gerekçesini HANDOFF'a yaz. Karma commit YASAK.
- `--write` **279 kod dosyasını** (ts/tsx/json/yaml/yml) yeniden yazar → tam DoD kapısı **yeniden** koşulmalı; prettier ile eslint kuralları çakışabilir (`eslint.config.js`).
- Kanıt PNG churn'ü yapısaldır: e2e koşusu `apps/e2e/kanit/*.png`'leri tazeleyebilir → ayrı `chore(e2e)` commit'i (AGAC-TEMIZ dersi); commit öncesi `apps/e2e/test-results/.last-run.json` `passed`.
- **Anlamsal değişiklik olmadığı kanıtlanmalı:** test sayıları düşmemeli, altı kapı da exit 0. Biçimlendirmenin bir testi kırması "prettier böyle istedi" ile geçiştirilmez — o testin neden dizilime bağlı olduğu bulunmalı.

(e) KAPSAM SINIRI — DOKUNMA:
Ürün mantığı (bu görevde davranış değişikliği SIFIR) · `.prettierrc.json` kuralları (biçim savaşı açma) · `.prettierignore`'un mevcut referans-belge girdileri (CLAUDE.md sınırı: referans .md'lere dokunma) · `node_modules`/`dist`/`generated` (zaten ignore) · Faz-3 görevleri · tm 1-26 (K1).
**AYRI KARAR, tek başına yapma:** `format:check`'i CONVENTIONS §1 DoD kapısına EKLEMEK cazip görünür ama bu kapı sözleşmesini değiştirir — önerini HANDOFF'a yaz, uygulama kullanıcı kararıdır.

--- İZLENEBİLİRLİK DENETİMİ (tm 119 · 2026-08-11) — KARAR: PRD KARŞILIĞI YOK, GERÇEK KAPSAM SAPMASI; İŞ TUTULDU ---
ARAMA (negatif kanıt): PRD tam metninde `prettier` · `format:check` · `kod stili` · `lint` · `biçimlendirme kuralı`
için **0 eşleşme**. PRD §7.8 NFR-M yalnız M1 monorepo (pnpm/Turborepo + ortak `@siyahtus/types`) · M2 domain sınırları
· M3 SOLID · M4 test piramidi · M5 gözlemlenebilirlik diyor — kod biçimlendirme maddesi YOK. PLAN tam metninde de
`format:check`/`prettier` için 0 eşleşme. Yani bu görev gerçekten plana bağlı DEĞİLDİ.
İŞ HÂLÂ GEREKLİ Mİ? → **EVET, tutuldu (seçenek a).** Gerekçe: `package.json`'da var olup HER koşuda kırmızı veren
bir script bir sinyal değil gürültüdür; üç ayrı pencere (tm 115 · tm 116 · GRAF-ONARIM) borcu adlandırdı, hiçbiri
kapatmadı. Bu, CONVENTIONS §1'in "kapı gerçek regresyonları saklayan gürültüye dönüşmesin" kaygısının kardeşidir
(§D80/§D82 aynı sınıf). İptal etmek borcu yok etmez, yalnız görünmez kılar.
PLAN'A EKLENEN GEREKSİNİM SATIRI: **§7.2 NFR kapıları → `M-FMT`**, damga `⬜` (henüz yapılmadı).
Satır açıkça **türetilmiş** olarak işaretlendi (PRD §7.8 NFR-M kapsamı; kendi PRD maddesi YOK) — `07.9`/`08.6.3-conflict`
gibi KK-türetilmiş kalemlerin emsaliyle aynı biçimde. Sapma kaydı: **§D90**.
GÖREV BİTİNCE: `M-FMT` satırı `⬜ → ✅ → KM-FMT` olur ve kanıt `#### KM-FMT` bloğuna yazılır (CONVENTIONS §1.2:
hücrede yalnız damga + referans). Kabul kriteri ve (A)/(B) kararı yukarıda (d) maddesinde DEĞİŞMEDEN duruyor.
PRIORITY NOTU: `critical` kaydı işin panel sağlık taramasından geldiğinin izidir; CONVENTIONS §4.1 gereği
DEĞİŞTİRİLMEDİ.

**Test Strategy:**

Kabul kriteri: `npx prettier --check "**/*.{ts,tsx,js,json,md,css,yaml,yml}"` **exit 0** ("All matched files use Prettier code style!"). (A) yolunu seçtiysen ignore edilen her dosya `.prettierignore`'da adıyla ve yorumla listeli olmalı — sessiz kapsam daraltma sayılmaz.

Regresyon kapısı, hepsi exit 0 ve sayılar taban ≥: `pnpm -w typecheck` (11/11) · `pnpm -w lint` (8/8) · `pnpm -w test` (**3802**) · `pnpm -w test:integration` (**1906**) · `pnpm -w build` (7/7) · `pnpm -w test:e2e` (**113/113**). Toplam 5821 test — düşerse görev bitmemiştir.

Ek kanıt: `git diff --stat` çıktısı HANDOFF'a yazılır (kaç dosya, kaç satır, kaç tanesi `.md`) ve ürün davranışı diff'inin boş olduğu gösterilir.
