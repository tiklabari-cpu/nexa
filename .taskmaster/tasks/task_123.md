# Task ID: 123

**Title:** A11Y1–6 — :focus-visible / :hover durumları HİÇ taranmıyor: axe kör noktasını kapat (KA11Y ⬜)

**Status:** done

**Dependencies:** None

**Priority:** critical

**Description:** a11y süitinde `focus`/`hover` için 0 eşleşme var: axe duran DOM'u okur, bu yüzden odak halkası ve hover durum renkleri bugüne kadar hiç ölçülmedi. tm 120 bu kör nokta sınıfının GERÇEK bir serious ihlal sakladığını kanıtladı. Durumları render eden tarama ekle.

**Details:**

PRD/PLAN kimliği: **A11Y1–6** (PLAN §7.2 NFR satırı · kanıt bloğu `#### KA11Y`, PLAN.md:4225).
Bu görev KA11Y'nin en alttaki **`⬜ Ölçülmeyen kalan`** maddesinin `:hover`/`:focus` kanadını kapatır.

(a) GEREKÇE + KANIT (bu turda ölçüldü):
KA11Y'nin `⬜` maddesi aynen: "yalnız `chromium` taranıyor · axe otomatik olarak AA'nın ~%57'sini
kapsar · `moderate`/`minor` raporlanıyor ama kapı değil · **`:hover`/`:focus` durum renkleri
taranmıyor (axe duran DOM'u okur)**".
ÖLÇÜM: `grep -c 'focus\|hover' apps/e2e/tests/a11y.spec.ts apps/e2e/tests/a11y.ts` → **her ikisi de 0**.
`apps/web/src/styles/tokens.test.ts` (90 test) `--focus-ring` için **tek bir çift bile** tutmuyor —
oradaki `ring`/`focus` eşleşmeleri yalnızca `relativeLuminance`/`contrastRatio` yardımcılarının adı.
Yani odak halkası **ne e2e'de ne birim seviyesinde** ölçülüyor.

NEDEN ŞİMDİ (bu sınıf kanıtlanmış şekilde defekt saklıyor): tm 120, hiç render edilmeyen bir
sekmedeki `1.47:1` serious ihlalin **16 temiz taramanın hepsi tarafından** kaçırıldığını ölçtü.
Ders KA11Y'ye ve HANDOFF'a yazıldı: "bir tarama yalnız FİİLEN RENDER ETTİĞİ durumların kanıtıdır".
`:focus-visible` ve `:hover` tam olarak hiç render edilmeyen durumlardır.
İlgili WCAG maddesi: odak göstergesi **metin değildir** → **1.4.11 Non-text Contrast, eşik 3:1**
(mevcut `tokens.test.ts` çiftleri metin için 4.5:1 varsayıyor — bu görev farklı bir eşik getiriyor).

⚠️ (d) TUZAK — BİR HİPOTEZ ZATEN ÇÜRÜTÜLDÜ, YENİDEN KOVALAMA:
Bu görevi doğuran pencere elle şöyle akıl yürüttü: "`tokens.css:49` açık temada
`--focus-ring: var(--brand-500)`, yani `bg-brand-500` dolgulu birincil CTA'da halka **1.00:1**,
görünmez". **YANLIŞ.** `tokens.css:180-183` `:focus-visible`e `outline-offset: 2px` veriyor —
halka öğenin DIŞINA, arkasındaki yüzeye çiziliyor. Ölçülen gerçek oranlar (WCAG 1.4.11 eşiği 3:1):
· AÇIK `--focus-ring` #2d67fa → canvas #f7f8fa **4.46** · surface #ffffff **4.74** ·
  surface-2 #f1f3f7 **4.27** · inset #e9ecf2 **4.00** → DÖRDÜ DE GEÇER
· KOYU `--focus-ring` #7aa2ff → canvas **7.61** · surface **7.10** · surface-2 **6.42** ·
  inset **7.38** → DÖRDÜ DE GEÇER
Yani bugün BİLİNEN bir odak-halkası defekti YOK; bu görev bir düzeltme değil, **ölçüm boşluğunu**
kapatır. (Zaten bu çürütme, görevin kendi gerekçesi: elle akıl yürütme `outline-offset`i modelden
kaçırdı ve yanlış pozitif üretti — bir tarama saniyeler içinde cevaplardı.)
DİKKAT: `outline-offset` sayesinde önemli olan komşu renk **arkadaki yüzeydir**. Eğer bir odaklanabilir
öğe `bg-brand-500` dolgulu bir KAPSAYICI içindeyse (ör. `Banner.tsx`) komşu renk brand olur ve oran
**1.00** (açık) / **1.90** (koyu) düşer — tarama bunu bulursa GERÇEK bulgudur, öyle raporla.

(b) DOKUNULACAK DOSYALAR:
    · `apps/e2e/tests/a11y.spec.ts` + `apps/e2e/tests/a11y.ts` (odak/hover durumunu RENDER eden tarama)
    · `apps/web/src/styles/tokens.test.ts` (3:1 eşikli non-text çiftleri — e2e 5 dk, birim 4 ms)
    · `apps/web/src/styles/tokens.css` **YALNIZCA** tarama gerçek bir ihlal bulursa

(c) SIRA (contract/migration YOK — test + gerekiyorsa token):
    (1) KAPI-PROBE ÖNCE: taramanın fiilen odak durumunu ölçtüğünü kanıtla (bilerek kırık bir odak
        halkası enjekte et → tarama KIRMIZI dönmeli). tm 115'in `button-name` probe emsali; sessizce
        hiç koşmayan bir tarama temiz geçişten ayırt edilemez.
    (2) Gerçek tarama: her yüzeyde birincil odaklanabilir öğelere `focus`/`hover` uygula, İKİ TEMADA.
    (3) Bulgu çıkarsa çağrı yerinde düzelt (token'a dokunmadan — tm 120 emsali).
    (4) Birim seviyede kilitle, sonra kanıtı `#### KA11Y`ye madde olarak ekle + `⬜` maddesini
        DARALT (kapanan kanat çıkarılır; `chromium`-tek ve elle-odak-sırası kanatları KALIR).

(d) DİĞER TUZAKLAR:
    - `--brand-500` · `--brand-text` · `--text-tertiary` · `--note` DEĞİŞMEZ — tm 115/117/120
      bunları ölçüp kilitledi, `tokens.test.ts` 90 testle tutuyor. Odak halkası için token oynatmak
      o kilitleri kırar.
    - `A11Y_EXCEPTIONS` **BOŞ KALMALI** — bir kuralı bastırarak yeşile boyama yasak (tm 115 emsali).
    - e2e çıplak kabukta koşmaz: `set -a; . ./.env; set +a; pnpm -w test:e2e` (`apps/rtm` kök
      `.env`i kendi okumaz — HANDOFF tm 118 notu (3)).
    - Seed'li "All" görünümünün ilk sohbeti ARŞİVLİ (28'in 27'si) — composer render edilmiyor.
      Odaklanabilir composer öğesi gerekiyorsa tm 120'nin yolunu izle: `POST /chats` + `assign_to_me`
      ile kendi aktif sohbetini aç, `?chat=<id>` ile derin bağlan (tek-aktif-sohbet değişmezi → idempotent).

(e) KAPSAM SINIRI: `chromium` dışı tarayıcı eklemek (Playwright `projects`, `playwright.config.ts:48`)
    BU GÖREVİN DIŞINDA — ayrı karar, koşu süresini katlar. Odak SIRASI ve ekran okuyucu duyurusu elle
    kalmaya devam eder (KA11Y `⬜`sinde kalır). Ürün davranışı · sözleşme · migration · Faz-3
    statüleri · tm 1-26 DEĞİŞMEZ.

**Test Strategy:**

Kod + test görevi → **TAM DoD kapısı** (CONVENTIONS §1), hepsi exit 0:
typecheck · lint · format:check · build · `pnpm -w test` · `pnpm -w test:integration` ·
`set -a; . ./.env; set +a; pnpm -w test:e2e`.

ÖLÇÜLEBİLİR KABUL:
(1) `grep -c 'focus' apps/e2e/tests/a11y.spec.ts` → **> 0** (bugün 0).
(2) a11y tarama sayısı **18 → artmış** olmalı (tm 120 tabanı 18; `a11y.spec.ts` çıktısında görünür).
(3) Her taramada `blocking 0 · excused 0 · advisory 0` VE `A11Y_EXCEPTIONS` **hâlâ boş**.
(4) KAPI-PROBE KANITI: bilerek kırılmış odak halkasıyla tarama **KIRMIZI** döndüğü gösterilmeli
    (düzeltme öncesi/sonrası çıktısı HANDOFF'a yazılır) — yoksa taramanın gerçekten ölçtüğü kanıtlanmamıştır.
(5) `tokens.test.ts` sayısı **90'dan artmış** ve eklenen çiftler **3:1** (non-text) eşiğiyle ölçülüyor.
(6) unit ≥ **3870** · integration ≥ **1906** · e2e ≥ **124** (tm 120 tabanı; DÜŞÜŞ YOK).
(7) `#### KA11Y` bloğuna kanıt maddesi eklendi ve `⬜` maddesi daraltıldı (silinmedi).
