# ADR-16 — Platform (root) yönetim paneli: ayrı süreç, ayrı rol, ayrı kontrat, korkuluklu impersonation, panelde yalnız AI anahtarı

- **Görev:** tm 389.7 (PLATFORM-EDGE-CI-DOCS-WIRING) · epik tm 389 PLATFORM-ADMIN · PLAN.md §D218 (açılış ve sapmalar)
- **Tarih:** 2026-10-25
- **Durum:** Kabul edildi. Kararlar planlama turunda sahiple verildi (§D218) ve `docs/platform-admin/design.md` A–I bölümlerinde tasarlandı; 389.1–389.6 bunları kodladı. Bu belge kararları gerekçeleriyle tek yerde toplar.
- **Numara:** Görev metni "ADR-15" diyordu; ADR-15 PLAN §0'da zaten "RTM zarfı"dır, bu yüzden bir sonraki boş numara (16) alındı. `design.md` §E'deki "ADR-15" anılışı bu belgeye işaret eder.
- **Yöntem:** Yalnız depo okundu; dosya adları HEAD'de doğrulandı. Sahip isteği ve keşif §D218'dedir; burada yinelenmez.

## 0. Karar — tek tabloda

| #   | Konu                 | Karar                                                                                                                                                                                                                                                                                   |
| --- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K-a | Süreç                | Kök panelin API'si **ayrı süreç**: `apps/api` imajı, komut `node dist/src/platform.js`, 4002, yalnız `/platform/v1`. Kiracı API (`buildServer`) `/platform/*` için 404 verir; platform rotaları o süreçte yüklenmez. SPA ayrı imaj: `apps/admin`, nginx, 8080 (yayın 5175).             |
| K-b | Veritabanı rolü      | Platform süreci **`siyahtus_platform`** rolüyle bağlanır (`BYPASSRLS`, NOINHERIT; denetim/fatura/2FA tablolarında UPDATE/DELETE yok). Kiracı süreçleri bu rolün bağlantı dizesini taşımaz: compose'ta yalnız `platform-api` servisinde, Helm'de yalnız onun bağlayacağı ayrı Secret'ta. |
| K-c | Kontrat              | Ayrı kontrat `packages/contract/platform/openapi.yaml`, ayrı üretilmiş istemci; kiracı kontratı değişmez (mobil parity sayısı yalnız kiracı yolu eklenince oynar).                                                                                                                      |
| K-d | Kimlik               | Operatör hesabı çalışma alanı hesabı değildir (`platform_admins`). Parola, ardından **zorunlu TOTP**; oturum opak (8 sa mutlak, 15 dk boşta); yıkıcı işlemde 5 dk'dan taze kod; dört rol × izin matrisi; ilk operatör yalnız CLI ile (`platform:bootstrap-admin`).                      |
| K-e | Denetim              | Her platform mutasyonu `{reason}` ister ve **ayrı bir hash zincirine** yazılır (`platform_audit_log`, anahtar `PLATFORM_SETTINGS_KEY`'den HKDF). Bir kiracıya dokunan eylem **ek olarak** kiracının `audit_log`'una `actor_type='platform'` ile, aynı transaction'da yazılır.           |
| K-f | Kiracı içeriği       | Platform ekranları ve yanıtları **kiracı içeriği taşımaz** (mesaj, oyuncu verisi, bilgi tabanı): yalnız sayı, durum, kimlik. Bir kiracının içine bakmanın tek yolu impersonation'dır.                                                                                                   |
| K-g | Impersonation        | **Salt-okunur varsayılan.** Gerekçe zorunlu, süre kısa (oturumun `ends_at`'i), kiracı sahibine e-posta, tek kullanımlık handoff kodu (60 sn), yasak yol listesi, kırmızı şerit + geri sayım, RTM'de yayın yok, kiracı denetiminde `on_behalf_of`. `full` kipi taze TOTP ister.          |
| K-h | Panelde saklanan sır | **Yalnız AI sağlayıcı anahtarları**, şifreli (anahtar `PLATFORM_SETTINGS_KEY`'den türer), hot-swap; yanıtta ve denetimde asla düz dönmez (`…last4`). Dağıtım sırları (veritabanı, JWT, SMTP, depolama) `.env` / Secret'ta kalır; panelden yazılmaz.                                     |
| K-i | Askı                 | `licenses.status = 'suspended'` kiracıyı tam kilitler (403 `workspace_suspended`); yalnız platform rolü koyup kaldırabilir (tetikleyici). Kiracı tavanları `license_overrides`'tan okunur; kiracı yalnız SELECT yapar.                                                                  |
| K-j | Dağıtım              | Beşinci halka açık ad (`admin.<alan>`) ve altıncı servis. Kenarda `/platform/*` **doğrudan** platform-api'ye (tek hop), gerisi SPA'ya; önüne Cloudflare Access önerilir (yalnız belgede). Pilotta `--profile platform` arkasında, Helm'de `enabled` anahtarlı.                          |
| K-k | Boot kuralı          | Kiracı API'de boot'u durduran **yeni kural yok** (sahip kuralı 2026-10-10): platform ayarı okunamazsa env ile devam + uyarı. Platform süreci kendi `assertPlatformEnv`'ine sahiptir (https `ADMIN_APP_URL`, rol ayrımı) ve yalnızca kendini durdurur.                                   |

## 1. Gerekçeler

- **Neden ayrı süreç, yeni bir rota öneki değil?** Aynı süreçteki `/platform/*`, kiracı isteğinin yolunda `BYPASSRLS` bağlantısı olan bir kod yolu demektir: kiracı rotalarındaki tek bir `app.db` / `app.platformDb` karışıklığı tüm çalışma alanlarını okur. Ayrı süreçte `app.db` hiç yoktur (`platform-server.test.ts` bunu sınar) ve BYPASSRLS bağlantı dizesi kiracı pod'larına hiç verilmez. Ölçüt güvenlik sınırı olduğu için süreç sınırı seçildi, rota sınırı değil.
- **Neden ayrı rol?** Satır düzeyi güvenlik (tenant izolasyonu) `siyahtus_app` rolüne uygulanır; sahip rolü politikaları atlar. Platform panelinin her çalışma alanını görmesi gerekir ama sahip rolünün yetkileri (denetim tablosunda UPDATE gibi) gerekmez. `siyahtus_platform` bu ikisinin arasıdır: tüm satırları okur, kendi denetim zincirini silemez.
- **Neden ayrı kontrat?** Kiracı kontratı müşteri/ajan SDK'larının ve mobil uygulamanın sözleşmesidir; operatör yüzeyini orada yayımlamak onu her istemciye sızdırır ve parity sayılarını oynatır. Ayrı dosya, ayrı üretim, `contract-parity` ikinci çiftle.
- **Neden çift denetim?** Platform zinciri "operatör ne yaptı"nın kanıtıdır ve kiracı bunu görmez; kiracı zinciri "benim çalışma alanımda ne oldu"nun kanıtıdır ve operatörün eylemini içermezse kiracı için görünmez bir değişiklik olur. İkisi aynı transaction'da yazılır: biri yazılamazsa eylem de yoktur.
- **Neden impersonation korkulukları?** Kök panelin en tehlikeli yeteneği bir kiracının oturumunu devralmaktır. Salt-okunur varsayılan, gerekçe, kiracıya bildirim ve kısa süre, "destek için baktım"ı kanıtlanabilir ve sınırlı kılar; `full` kipi yalnız taze TOTP ile açılır.
- **Neden panelde yalnız AI anahtarı?** Bu, sahibin açıkça istediği tek ayardır (sağlayıcı ve anahtarı yapıştırma alanı) ve süreç yeniden başlatmadan değişmesi gereken tek sırdır. Veritabanı, JWT ve posta sırları panele konursa panel ele geçirildiğinde tüm dağıtım ele geçer; bu yüzden `.env` / Secret'ta kalır.
- **Neden kenarda iki ayrı hedef, tek hop?** `X-Forwarded-For` tek sayıdır (`TRUST_PROXY_HOPS`); SPA'nın nginx'i de `/platform/` için ekleme yapar, bu yüzden onun içinden geçen istek iki hop olurdu. Aynı gerekçeyle panelin `/api/`'si zaten api'ye doğrudan gider (PLAN §D197). `PLATFORM_IP_ALLOWLIST` ve giriş kovası bu adrese bakar; yanlış hop sayısı onları atlatılabilir kılar.
- **Neden Cloudflare Access yalnız belgede?** DNS ve Cloudflare hesabı sahibindir; depo gerçek bir edge işlemi yapmaz (CLAUDE.md sınırları). Öneri sert (`docs/production-checklist.md` §9 "Back office") ama yapılandırması bu depoda yoktur; panelin kendi parolası + TOTP + IP izin listesi Access'ten bağımsız çalışır.

## 2. Bugünkü kod ve bu görevin kablolaması

- Servisler: `docker-compose.pilot.yml` ve `docker-compose.full.yml` `platform-api` + `admin` (pilotta `--profile platform`).
- Kenar: `infra/pilot/Caddyfile.example` ve `infra/pilot/cloudflared/config.example.yml` beş ad; `apps/api/src/config/env.pilot.test.ts` isimleri, portları, tek-hop kuralını (`/platform/*` önce, gerisi sonra) ve `trusted_proxies` yasağını bekçiler.
- Helm: `infra/helm/siyahtus` `apps:` += `platform-api` (`args`, imajın ENTRYPOINT'i korunur), `admin`; `<release>-platform-secrets` yalnız platform-api'ye mount edilir; `networkpolicy.yaml` platform-api'ye yalnız admin pod'larından giriş, çıkışta DNS + Postgres/Redis portları; `apps/api/src/config/chart-storage.test.ts` bunu bekçiler.
- İşletim: `make platform-bootstrap-admin EMAIL=…`, `scripts/smoke.sh` "Back office" bölümü, `ci.yml` `pilot-images` işi `--profile platform` ile admin imajını da derler.

## 3. Sonuçlar ve kabul edilen riskler

- **Operasyonel yük:** altıncı servis, beşinci ad, ikinci Secret. Pilotta `--profile platform` ile isteğe bağlıdır; kullanılmayan kurulumun maliyeti sıfıra yakındır.
- **BYPASSRLS bir süper kullanıcı gerektirir.** Yönetilen Postgres'te migration rolü süper kullanıcı değilse rol `BYPASSRLS`'siz kalır ve panel boş görünür; `ALTER ROLE … BYPASSRLS` elle verilir ve `pg_roles.rolbypassrls` ile doğrulanır (checklist §5 ve §9).
- **Kimlik tek noktası:** operatörün parolası ve telefonu sızarsa platform zinciri ve tüm çalışma alanları açıktır. Karşı önlemler katmanlıdır: Access (önerilen), IP izin listesi, zorunlu TOTP, kısa oturum, yıkıcı işlemde taze kod, değiştirilemez zincir. Bunların hiçbiri diğerinin yerini almaz.
- **Kapsam dışı (bu ADR'nin kararı değil):** gerçek deploy, DNS, TLS, Cloudflare Access'in fiilen kurulması; operatör SSO'su. Bunlar sahibin ya da sonraki görevlerin işidir.
