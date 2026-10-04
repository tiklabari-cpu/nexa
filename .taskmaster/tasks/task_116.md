# Task ID: 116

**Title:** KANIT-AD — `16-notifications-settings.png` adının vaat ettiği ekranı çekmiyor [XHIGH]

**Status:** done

**Dependencies:** None

**Priority:** low

**Description:** Üç kanıt PNG'si **birebir aynı bayt** (md5 `1b9e2148…`): `16-notifications-settings.png` = `8-channels-grid.png` = `08.5.7-instagram-disconnected.png`. Üçü de Settings → Channels sayfasını gösteriyor. İkisi savunulabilir (kanal ızgarası; Instagram kartı "Not connected"), ama `16-notifications-settings.png` **bildirim ayarlarını göstermiyor** — yani adının iddia ettiği kanıtı sağlamıyor.

**Details:**

KÖKEN: AGAC-TEMIZ penceresi (2026-08-11) bulmuştu ama kapsamı kirli çalışma ağacıydı, görev açmadı ve tm 114'ün §F.1/8 maddesine havale etti. GL-8 (tm 114) turunda md5 ile **yeniden doğrulandı** ve buraya taşındı — sessizce düşmesin diye (§F.00: bulgu ya düzeltilir ya görev olur ya §D'ye yazılır).

ÖNEMLİ: bu **önceden var olan** bir kusurdur, tm 99.8'in süpürmesinin getirdiği bir regresyon DEĞİL (HEAD'de de aynı üç dosya eşitti, yalnız md5 değeri farklıydı: `50b328d7…` → şimdi `1b9e2148…`).

YAZAN SATIR: `apps/e2e/tests/notifications.spec.ts:27`
  `await agentPage.screenshot({ path: 'kanit/16-notifications-settings.png', fullPage: true });`
Ekran görüntüsü alındığı anda sayfa Settings → Channels'ta ("Widget installation, saved replies and routing" başlıklı, altı MCP server kartında kesiliyor) — testin o noktaya kadar bildirim ayarları sekmesine gitmediği anlamına gelir.

SIRA: (1) `notifications.spec.ts`'in akışını oku, screenshot'tan önce bildirim ayarları yüzeyine (Settings → Notifications) gerçekten gidildiğinden emin ol; (2) gitmiyorsa ya navigasyonu ekle ya screenshot'ı testin doğru anına taşı; (3) yeni PNG'yi aç ve **gözle doğrula** — ad ile içerik uyuşmalı; (4) üç dosyanın md5'i artık ayrışmalı.

KAPSAM SINIRI: **ürün kodu değişmemeli** — bu bir test/kanıt kusuru. Bildirim ayarları ekranı gerçekten eksikse o AYRI bir bulgudur, ayrı görev olarak açılır.

TUZAK: `apps/e2e/kanit/*.png` her tam koşuda yeniden üretilir; süpürmenin tazelediği diğer dosyaları kendi commit'ine tıkma, ayrı `chore(e2e)` commit'ine koy (AGAC-TEMIZ dersi). Commit öncesi `apps/e2e/test-results/.last-run.json` `passed` olmalı.

**Test Strategy:**

Kapı: `set -a; . ./.env; set +a; pnpm -w test:e2e` exit 0 (referans taban 103/103, bu tur ≥).

KABUL KRİTERİ (ölçülebilir): (i) `md5sum apps/e2e/kanit/16-notifications-settings.png apps/e2e/kanit/8-channels-grid.png apps/e2e/kanit/08.5.7-instagram-disconnected.png` → **üç farklı** özet; (ii) `16-notifications-settings.png` açıldığında bildirim ayarları yüzeyi görünüyor (ses/masaüstü/tarayıcı/e-posta kontrolleri) — HANDOFF'a ne göründüğü yazılır; (iii) e2e süiti yeşil ve test sayısı düşmedi; (iv) ürün kodu diff'i boş.
