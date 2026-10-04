# Task ID: 147

**Title:** E2E-POLLUTION [XHIGH] a11y spec'inin bıraktığı davet satırı `command-palette` + `skills-routing`'i düşürüyor — e2e kapısı HEAD'de 197/200, tm 145'ten BAĞIMSIZ

**Status:** done

**Dependencies:** 145 ✓

**Priority:** high

**Description:** `pnpm -w test:e2e` şu anda main'de (tm 145 öncesi ve sonrası birebir aynı) 3 kırmızı veriyor: 197 passed / 3 failed. Kök neden ürün kusuru değil, koşu-içi test veri kirliliği: bir a11y spec'i `a11y-join@siyahtus.test` için bekleyen bir davet bırakıyor, davet hiç iptal edilmiyor ve Team tablosunda DAVET EDEN sütunu `Dana Okonkwo` yazdığı için `command-palette.spec.ts`'in `getByRole('row').filter({hasText: DEMO.agentName})` locator'ı iki satıra birden çarpıyor (strict mode violation).

**Details:**

ÖLÇÜLDÜ (bu tur, tm 145 penceresinde — hem düzeltmeli hem düzeltmesiz ağaçta AYNI 3 kırmızı, yani tm 145'ten bağımsız):

- tm 145 değişiklikleriyle: `197 passed, 3 failed (12.3m)`
- `git stash` ile tm 145 tamamen geri alınmış ağaçta: `197 passed, 3 failed (12.3m)` — aynı üç test, aynı sıra.
- Aynı üç spec YALNIZ BAŞINA koşulduğunda (`npx playwright test command-palette skills-routing`): **6/6 yeşil, 33.9s**. Yani kusur spec'lerin kendisinde değil, önlerinde koşan bir spec'in bıraktığı satırda.

KIRMIZI 1 (kök neden) — `apps/e2e/tests/command-palette.spec.ts:77`
```
Locator: getByRole('row').filter({ hasText: 'Dana Okonkwo' })
strict mode violation: ... resolved to 2 elements:
  1) getByRole('row', { name: 'a11y-join@siyahtus.test Agent' })
  2) getByRole('row', { name: 'Dana Okonkwoyou owner@acme.' })
unexpected value "a11y-join@siyahtus.testAgentDana OkonkwoRevoke"
```
Team tablosunun bekleyen-davet satırı `<e-posta> | <rol> | <davet eden> | Revoke` biçiminde; davet eden `Dana Okonkwo` olduğu için `DEMO.agentName` ile filtrelenen locator ajanın KENDİ satırıyla birlikte davet satırını da yakalıyor. Daveti bırakan spec `a11y-join@siyahtus.test` adresini kullanan a11y spec'i (tm 137.1 turunda eklenen public auth funnel / davet-kabul taraması); daveti koşu sonunda iptal etmiyor.

KIRMIZI 2 ve 3 (kırmızı 1'in ARDIL etkisi, ayrı kusur DEĞİL):
- `command-palette.spec.ts:159` — `getByRole('option', { name: 'Stop Accepting Chats' })` bulunamıyor. Kırmızı 1 "Stop Accepting Chats" komutunu çalıştırdıktan SONRA assert'te düştüğü için testin geri-açma adımı hiç koşmadı; ajan "not accepting" durumunda kaldı ve palet artık "Start Accepting Chats" gösteriyor.
- `skills-routing.spec.ts:78` — `the chat never routed to the skilled agent`. Aynı sebep: hedef ajan hâlâ sohbet kabul etmiyor, routing ona atayamıyor.

Yani tek bir bırakılmış satır düzeltilirse üçü birden kapanmalı — ama bu DOĞRULANMALI, varsayılmamalı.

NEDEN ŞİMDİ GÖRÜLDÜ: a11y spec'leri tm 137.1–137.3'te eklendi; tm 137.3 kapanışından sonraki pencereler (tm 138.1, 138.2, 142) kendi testStrategy'leri gereği `test:e2e` KOŞMADI (üçü de HANDOFF'ta bunu açıkça yazıyor). tm 145 e2e'yi koşan ilk pencere oldu ve kirliliği ortaya çıkardı. Kusur tm 137.x'te doğdu, tm 145'te görüldü.

KABUL:
1. Kök neden koda karşı doğrulanır: `a11y-join@siyahtus.test` davetini hangi spec'in bıraktığı `grep` ile bulunur (tahmin edilmez).
2. Düzeltme yönü SEÇİLİR ve gerekçesi yazılır. En az iki aday tartışılmalı:
   (a) daveti bırakan spec kendi ardından temizlesin (davet iptal / `afterAll`) — kirliliği kaynağında keser, ama "her spec kendi çöpünü toplasın" disiplini bir sonraki spec'te yine unutulabilir;
   (b) `command-palette.spec.ts`'in locator'ı daraltılsın (ör. satırı e-postayla ya da roster tablosunun kendisiyle kapsayarak) — kırılgan locator'ı onarır ama bırakılan daveti yerinde bırakır, yani üçüncü kırmızı (`skills-routing`) bu yolla kapanmayabilir.
   Yön (a) muhtemelen doğru olan; ama (b)'nin locator kırılganlığı da ayrıca gerçek (bir davet satırının ajan adını taşıması normal bir ürün davranışı).
3. Ardıl etkiler ayrıca ele alınır: kırmızı 1 ortasında düşen bir test ajanı "not accepting" bırakıyor. Testin kendi durumunu `finally`/`afterEach` ile geri alması, sonraki spec'lerin bir öncekinin yarım kalmasına bağımlı olmamasını sağlar — bu, aynı sınıf kusurun bir daha üç test yerine bir test düşürmesi demektir.
4. Kanıt ÖNCE KIRMIZI: düzeltmeden önce TAM süit koşulup 197/200 gösterilir, düzeltmeden sonra TAM süit koşulup **200/200** (ya da o günkü toplam) gösterilir. Yalnız üç spec'i koşmak YETMEZ — üçü zaten izole koşuda yeşil, kusur tam da sıralamada.
5. `apps/e2e/kanit/*.png` churn'ü normaldir (her koşu yeniden yazar), commit'e dahil edilir.

SINIR (CONVENTIONS §5): yalnız bu kirlilik. Ürün kodu (Team roster'ın davet satırı biçimi, palet komutları, routing) değiştirilmez — kusur test tarafındadır. a11y taramalarının kapsamı daraltılmaz.

BOOTSTRAP (bu pencere temiz başlar):
- `apps/e2e/tests/command-palette.spec.ts:63-115` · `apps/e2e/tests/skills-routing.spec.ts:78`
- `grep -rn 'a11y-join' apps/e2e/` → daveti bırakan spec
- `apps/e2e/tests/global-setup.ts` (seed + `SIYAHTUS_SEED_RESET=1`; sıfırlama KOŞULAR arası çalışıyor, koşu İÇİ değil — §D83)
- e2e koşumu: kök `.env` kaynaklanmalı (`set -a; . ./.env; set +a`), yoksa RTM `DATABASE_URL: Required` ile düşer ve Playwright 60 sn webServer timeout verir; süit ~13 dk (pencere komut tavanının üstünde → arka plan + aynı turda blocking-wait); önceki koşudan kalan 5173/5174/4000 dinleyicileri varsa ÖNCE öldürülmeli.

**Test Strategy:**

- TAM `pnpm -w test:e2e` düzeltmeden ÖNCE (beklenen: 197/200, üç adı kayıtlı kırmızı) ve SONRA (beklenen: 200/200). Sıralamaya bağlı bir kusur olduğu için tekil spec koşusu kanıt sayılmaz.
- Üç spec'in izole koşusu ayrıca yeşil kalmalı (regresyon yok).
- Tam DoD kapısı (CONVENTIONS §1): typecheck · lint · format:check · test · test:integration · build. Ürün kodu değişmiyorsa bu gate'lerin cache-hit olması beklenir ve bu bir kusur değil, değişmezliğin kanıtıdır.
