# Task ID: 247

**Title:** V8-E2E-ORDER2 [OPUS-XHIGH] e2e suit-sirasi sinifi geri dondu: command-palette:131 + tickets:226 (FLAKE DEGIL)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Tam e2e suiti ardisik iki kosuda AYNI iki testi AYNI imzayla dusuruyor; ikisi de ayri kosuldugunda yesil. tm 233 sinifi kapatmadi, o gunku dort ornegini kapatti.

**Details:**

GEREKCE + OLCUM (GL-15 / tm 210, 2026-09-12). PLAN SD163. tm 233 (SD160, 2026-09-08) suiti "ardisik iki kez 279/279" diye olcmustu. Bugun suit 294 test (tm 236-246 arasi 18 spec dosyasi degisti) ve TAM KOSU ARDISIK IKI KEZ (17,0 dk / 14,2 dk) ayni iki testi ayni imzayla dusurdu: (1) apps/e2e/tests/command-palette.spec.ts:131 "stops and restarts accepting chats, and the Team screen agrees" -- Team satiri "Not accepting" yerine "Accepting chats" okuyor, yanindaki es zamanli sohbet sayaci 6 (= concurrent_chats_limit, SD151in olctugu birikmenin aynisi). (2) apps/e2e/tests/tickets.spec.ts:226 "renders the authored template into the message that goes out" (FR-MOD-08.7.5) -- getByLabel("Notify the customer") HIC render edilmiyor. IZOLASYON KANITI: iki spec dosyasi birlikte ayri kosuldugunda 9/9 YESIL, 40,2 sn (komut: cd apps/e2e && npx playwright test tests/command-palette.spec.ts tests/tickets.spec.ts -- pnpm ... test -- <dosya> ile FILTRELEME CALISMIYOR, -- passthrough yutulup tam suit kosuyor; bu tuzaga dusme, bir tam kosu ~15 dk yakar). Yani urun kusuru DEGIL, suit-sirasi bagimliligi.

IKI SOMUT ADAY (ikisi de testin KENDI kodunda, tahmin degil): (a) command-palette.spec.ts:141-145 ilk iddiasini RELOADSUZ veriyor -- Team linkine istemci-ici geziliyor ve satir onbellekten okunabiliyor -- ama ayni testin 154-155. satirlari ikinci iddiadan ONCE agentPage.reload() cagiriyor. Asimetri testin icinde. GL-13un SD152si Team konsolunun uygunluk sutunundaki 30 sn bayatligi duzeltmisti; bu onun ayni sinifi mi yoksa kalintisi mi, OLCULMELI. (b) tickets.spec.ts:253-257 sohbeti getByRole("region", {name:"Conversations"}).getByRole("button").first() ile seciyor; o listeyi suitin geri kalani boyunca baska testler degistiriyor, dolayisiyla "musterisi e-posta tasiyan sohbet" garantisi tam kosuda YOK. Testin kendi yorumu zaten "both of which are now true" diyor -- iddia tam kosuda dogru degil.

YAPILACAK IS: (1) Her iki kirmiziyi tam suit sirasinda YENIDEN URET ve kok nedeni OLC (hangi onceki spec durumu birakiyor); tahminle duzeltme. tm 233un yontemi emsal: iki dosyayla ureten minimal kombinasyon bul. (2) Duzeltmeyi tercihen apps/e2e icinde yap (fixture/izolasyon); URUN KODUNA ancak gercek bir kusur cikarsa dokun (tm 233 bunu bir kez yapti, SD160/4). (3) Tam suiti ARDISIK IKI KEZ kosup 294/294 kanitla -- tek yesil kosu bu sinif icin kanit degildir. (4) SINIFIN NOBETCISI: SD163un dersi "tm 233 sinifi ortadan kaldirmadi, o gunku dort ornegini kapatti" -- bu tur en az bir yapisal onlem onersin (or. paylasilan durumu yazan testlerin kendi fixturelariyla izole edilmesi, ya da suit sonunda demo ajanin durumunu dogrulayan bir nobetci), yoksa ucuncu kez geri gelir.

TUZAKLAR: 1) kanit PNGleri (~146) her tam kosuda yeniden yazilir -- churn, regresyon degil; kendi disindakileri git checkout ile geri al. 2) Iki pencere ayni anda e2e kosamaz (sabit portlar 4000/4001/5173/5174). 3) Kok .env elle alinmali: set -a && . ./.env && set +a, yoksa RTM 60 sn sonra "DATABASE_URL: Required" ile duser. 4) docker compose down -v KULLANMA.

KAPSAM SINIRI: Faz-2 kapanisi (tm 210) bu kirmizilarin uzerinden VERILMEDI ve yeniden acilmaz -- ikisi de v2 satirlarinin kabul kriterini tasimiyor (tickets:226 etiketi FR-MOD-08.7.5 = v1 Should; command-palette:131in FR-MOD-01.1.3 atfi YORUMDA, CONVENTIONS S7.1 geregi kapsama iddiasi sayilmaz ve o v2 satirinin gercek nobetcisi :175, iki tam kosuda da yesil).

**Test Strategy:**

Iki kapi. (1) KOK NEDEN OLCULDU MU: her iki kirmizi icin "hangi onceki spec hangi durumu birakiyor" sorusu KANITLA cevaplanmali (minimal yeniden ureten kombinasyon), tahminle degil -- tm 233un yontemi emsal. (2) TAM SUIT ARDISIK IKI KEZ 294/294: tek yesil kosu bu sinif icin kanit DEGILDIR, cunku bu turda (GL-15) iki ardisik kosu de ayni iki kirmiziyi verdi ve izole kosu ikisini de yesil gosterdi. Ayrica tam DoD kapisi (CONVENTIONS S1) exit 0. Gorev ancak (a) iki test tam suit sirasinda yesilse, (b) ardisik iki tam kosu 294/294 ise ve (c) sinifin tekrarina karsi en az bir YAPISAL onlem onerilmis/uygulanmissa (nobetci ya da fixture izolasyonu) biter -- (c) olmadan SD163un dersi odenmemis sayilir.
