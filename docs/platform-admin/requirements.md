# Root (platform) yönetim paneli — gereksinimler (tm 389)

**Durum:** planlandı 2026-10-14 (sahip isteği: "bir root panelimiz yok … SaaS standartlarında bir
yönetim paneli olsun, bütün gereksinimleri hazırla"; ek: "sistemin ayarlarını da yapabilmeliyiz —
AI ayarları ve API kodunu yapıştıracağımız bir alan"). Tasarım: `design.md`. Görev yerleşimi:
`gorev-yerlesimi.md`. Uygulama epiği: Task Master **tm 389** (22 alt görev). PLAN §D218.

## 1. Amaç ve kapsam

Bugün giriş yapınca doğrudan bir çalışma alanının (license) paneli açılır. SiyahTuş'un bütün
kiracıları gördüğü, yönettiği ve sistemi ayarladığı bir yüz yoktur; tek "back office" aracı elle
`UPDATE licenses …` (psql, owner rolü, audit yok — `docs/production-checklist.md` §9). Root panel bu
boşluğu kapatır:

- **Kapsamda:** kiracı (organizasyon/license) yaşam döngüsü, hesaplar, paketler/abonelik/fatura/
  kullanım, platform ayarları (kayıt, duyuru, bakım, **AI sağlayıcı + API anahtarı**, ödeme
  sağlayıcıları, banka bilgisi, fatura ihraççısı), elle ödeme kuyrukları (SWIFT, kripto), operasyon
  (zamanlayıcı, kuyruklar, sağlık, bileşen durumları), denetim zinciri, güvenlik (blocklist, kötüye
  kullanım), destek (kimlik → workspace araması, korkuluklu impersonation), AI katalogları/
  yönetişim görünümleri, operatör uyarıları.
- **Kapsam dışı:** production deploy / DNS / TLS (CLAUDE.md); gerçek ödeme tahsilatı (mock/sandbox
  — ADR-13a); kiracı içeriğini (sohbet, oyuncu, KB) platform ekranında göstermek; katalog
  içeriklerini (G1–G19, şablon paketi) panelden düzenlemek (F2); çoklu bölge/çoklu platform
  örneği; SSO/SAML ile operatör girişi (F2; v1 parola + TOTP).

## 2. Aktörler ve roller (RBAC)

Operatör hesapları (`platform_admins`) kiracı hesaplarından (`accounts`) **ayrıdır**; aynı e-posta
iki tarafta da olabilir, oturumlar ayrıdır.

| Rol          | Görür                                | Yapar                                                                                                                    |
| ------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `readonly`   | her şey (redaksiyonlu)               | hiçbir mutasyon                                                                                                          |
| `support`    | her şey                              | hesap/workspace destek eylemleri (doğrulama e-postası, oturum iptali, deneme uzatma, not), impersonation **salt-okunur** |
| `billing`    | faturalama/kullanım/ödeme kuyrukları | plan değişikliği, elle abonelik, ödeme onayları, kredi, kota override                                                    |
| `superadmin` | her şey                              | hepsi + ayarlar, AI ayarları, askıya alma/silme, zorlamalı sahiplik devri, `full` impersonation, operatör yönetimi       |

İzin matrisi `packages/types/src/platform.ts`'te tek yerde (SPA ile paylaşılır); her rota
`config.platform.permission` ister; `public` + `permission` çelişkisi boot'ta reddedilir.

## 3. Fonksiyonel gereksinimler

Her madde `FR-ADMIN-nn` kodludur; kabul kriteri testin adıdır (CONVENTIONS §7 etiketi için bu
kodlar Ek A kataloğunda **değildir** — test başlıklarına etiket olarak yazılmaz; PLAN'da §D218
altında izlenir).

### 3.1 Kimlik ve oturum (389.4)

- **FR-ADMIN-01** Parola + **zorunlu TOTP** (kayıt yapmamış operatör yalnız enroll/activate
  uçlarına ulaşır). Kurtarma kodları (10, tek kullanımlık). _KK:_ TOTP'siz oturum `stage=password`
  ile hiçbir iş ucuna giremez (403 `platform_totp_required`).
- **FR-ADMIN-02** Oturum opak token (sha256), mutlak TTL 8 sa, boşta 15 dk; yıkıcı eylemler
  `recentTotp` (300 sn) ister. _KK:_ 16. dakikada istek 401; `suspend` eylemi 6 dk önceki TOTP ile 403.
- **FR-ADMIN-03** İlk operatör yalnız CLI ile (`platform:bootstrap-admin`; admin varsa reddeder);
  sonrakiler e-posta davetiyle. IP izin listesi (`PLATFORM_IP_ALLOWLIST`), başarısız giriş kovası.
- **FR-ADMIN-04** Operatör yönetimi: rol değiştirme, devre dışı bırakma, 2FA sıfırlama, oturum
  iptali — hepsi audit'li; son superadmin devre dışı bırakılamaz.

### 3.2 Denetim zinciri (389.5)

- **FR-ADMIN-05** Her mutasyon `platform_audit_log`'a (append-only, HMAC zinciri, `reason` zorunlu).
  Kiracıya dokunan eylemler **ayrıca** kiracının `audit_log`'una `actor_type='platform'` ile
  yazılır (çift audit). _KK:_ `verify` ucu zinciri doğrular; bir satır değiştirilince kırmızı.
- **FR-ADMIN-06** NDJSON dışa aktarma + imza başlığı; kiracı audit'i salt okunur görüntülenir.

### 3.3 Dashboard ve sağlık (389.8)

- **FR-ADMIN-07** KPI'lar (kiracı sayısı duruma göre, deneme bitişleri 7 gün, aktif oturum, günlük
  sohbet/AI turu toplamları, ödeme kuyruğu bekleyen), kayıt zaman çizelgesi, sağlık anlık görüntüsü
  (kiracı API lideri 30 sn'de bir Redis'e yazar; eskiyse `stale`), **bileşen durum kaydı**
  (`siyahtus:ops:components`: ai_jobs, knowledge_jobs, captcha, geoip, kanallar, posta).

### 3.4 Workspace'ler (389.9, 389.10)

- **FR-ADMIN-08** Liste (durum/plan/bölge/deneme/arama/sıralama, keyset sayfalama), detay (üyeler ve
  rolleri, markalar, kullanım, abonelik, faturalar, kiracı audit, sandbox, notlar, impersonation
  geçmişi, AI özeti). Kiracı içeriği (mesaj, oyuncu, KB) **gösterilmez**.
- **FR-ADMIN-09** Eylemler (hepsi `reason`'lı, çoğu TOTP'li): deneme uzat, aktive et, plan değiştir,
  askıya al/kaldır (`suspended` — yeni license durumu), salt-okuma/aktif, abonelik iptal/geri al,
  override'lar (koltuk tavanı, entitlement, kullanım tavanı), sahip doğrulama e-postası, sandbox
  sıfırla, **zorlamalı sahiplik devri** (superadmin + TOTP + kimlik doğrulama kontrol listesi;
  eski Kurucu → Yönetici; tek-Kurucu değişmezi), sil (14 gün soğuma, `purge_scheduled_at`, geri
  alınabilir; purge işi + sahibe e-posta). _KK:_ askıya alınan kiracının üyesi 403
  `workspace_suspended`, müşteri token basımı 403, RTM bağlantısı reddedilir; kaldırılınca hepsi
  geri gelir.
- **FR-ADMIN-10** Destek araması: Thread ID / Chat ID / ticket / müşteri e-postası → workspace
  kimliği (var/yok sızdırmadan, içerik yok).

### 3.5 Hesaplar (389.11)

- **FR-ADMIN-11** Arama, detay (üyelikler), doğrulama e-postası yeniden gönder, zorunlu parola
  sıfırlama, oturum/token/PAT iptali, 2FA sıfırlama (TOTP), platform düzeyinde askıya alma,
  veri dışa aktarma, silme (TOTP; tek Kurucu olduğu workspace varsa reddeder).

### 3.6 Faturalama ve kullanım (389.12, 389.18)

- **FR-ADMIN-12** Planlar ve entitlement'lar (görüntüleme), abonelikler, faturalar (+PDF indirme —
  #383), paketler, gelir özeti, **kredi/iade** (fatura kapanışında negatif satır), elle abonelik
  (SWIFT/kripto ödemesi onaylanınca), kullanım tabloları (global, top-N workspace, detay).
- **FR-ADMIN-13** **AI kota override'ı**: workspace başına `licenses.ai_daily_*_cap` (#283.2) ve
  plan varsayılanları; `override ?? plan ?? env` sırası kiracı API'de 60 sn içinde etkili. _KK:_
  X'e 500.000 override → X 200.000'i aşar, diğerleri durur (#283 KK'sı platform ucundan).
- **FR-ADMIN-14** **Ödeme operasyonu** (#382/#383/#384 ile): SWIFT ödemelerini "ödendi" işaretleme
  (referans koduyla), kripto **adres isteği kuyruğu** (`requested` → adres ver → `address_sent` →
  TXID gir → `paid`), sağlayıcı görünürlüğü (swift_manual / crypto_manual / stripe aç-kapa),
  banka bilgisi ayarı (repoda gerçek IBAN yok), fatura ihraççı profili (SiyahTuş'un ünvanı/adresi/
  vergi no — #383 `seller_snapshot` kaynağı), iptal/iade onayı. _KK:_ kripto talebi onaylanınca
  abonelik `active` ve kiracı paneli "ödendi" gösterir; aynı TXID iki kez reddedilir.

### 3.7 Ayarlar, duyuru, bakım (389.13)

- **FR-ADMIN-15** `signup_enabled` (env `SIGNUP_ENABLED` yedek), deneme günü, duyuru (en/tr, kiracı
  paneli `NoticeBar`), bakım modu (TOTP; kiracı API 503 `maintenance`, okuma serbest/yazma kapalı
  seçeneği), kayıt blocklist'i. Değişiklik Redis `settings.changed` ile anında yayılır.
- **FR-ADMIN-16** **Effective-config**: kiracı API'nin etkin yapılandırması, `SECRET|KEY|PASSWORD|
TOKEN` redaksiyonlu, URL kimlik bilgileri silinmiş, her anahtarın **kaynağı** (DB / env /
  varsayılan). Burada görünen ama panelden değişmeyenler: `APPS_LIVE_PROVIDERS` (K22), Turnstile
  anahtarı varlığı (#339), K23 ticket e-posta kapısı (#356), `PILOT_MODE`.

### 3.8 AI ayarları (389.17) — sahibin açık isteği

- **FR-ADMIN-17** Sağlayıcı (`mock` | `openai`), model, base URL, bölge, **API anahtarı
  yapıştırma alanı** (yazma-yalnız; kaydedince yalnız `…last4` döner; AES-256-GCM,
  `PLATFORM_SETTINGS_KEY`), zaman aşımı, çıktı token limiti, embedding modeli (1536 sabit), global
  günlük tavanlar, fiyat tablosu (maliyet tahmini #283 için), `LLM_MODEL_FAST`. Env değerleri
  **yedek** kalır; DB kaydı varsa önce o. _KK:_ anahtar hiçbir yanıtta, logda ve audit'te düz
  görünmez; `GET` yalnız maske döner.
- **FR-ADMIN-18** Kiracı API **hot-swap registry**: `ai.settings_changed` Redis olayıyla sağlayıcı
  yeniden kurulur, süreç yeniden başlamaz; `MeteredLlm`, Copilot ve ziyaretçi örnekleri (ayrı devre
  kesiciler) registry'den alınır. _KK:_ anahtar değişince 5 sn içinde yeni çağrılar yeni
  yapılandırmayla (entegrasyon testi sahte sağlayıcıyla).
- **FR-ADMIN-19** Kayıt anında doğrulama: bölge kuralı (`provider-hosts.ts`), `PILOT_MODE`
  production'da `mock` reddi (bugünkü kural korunur), "Bağlantıyı test et" (küçük tamamlama,
  deployment satırına ölçümlenir), embedding modeli değişince uyarı + "Yeniden gömle" operasyonu
  (`knowledge:reembed` iş olarak, ilerleme operasyon ekranında).

### 3.9 Operasyon (389.14)

- **FR-ADMIN-20** Zamanlayıcı işleri listesi (son koşu, süre, hata) + "şimdi çalıştır" (Redis
  `job.run`, yalnız lider dinler), webhook birikimi (#375 verisi), SIEM dışa aktarma durumu,
  olay bölümleri (+`ensure`), doğrulanmamış kayıtlar (+purge, TOTP), iş kuyrukları (`ai_jobs` #289,
  `knowledge_jobs` #312, belge işçisi #313), GeoIP veritabanı sürümü/yaşı (#330), kanal webhook
  sağlığı (#380/#381) — hepsi **bileşen varsa** görünür, yoksa "kurulu değil".

### 3.10 Impersonation (389.15)

- **FR-ADMIN-21** "Müşteri olarak gir": platform oturumundan tek kullanımlık el değiştirme kodu
  (60 sn) → kiracı paneli `/auth/impersonate#code=` → `api_tokens(kind='impersonation')`; varsayılan
  **salt-okunur** (yazım 403), `full` mod yalnız superadmin + TOTP; 30 dk; her modda yasak yollar
  (parola/2FA/PAT/SCIM/güvenlik/ödeme/abonelik/BAA/müşteri silme/sandbox); kiracı audit'inde
  `actor_type='platform'` + `on_behalf_of`; kiracı panelinde **kırmızı şerit** + geri sayım + "Oturumu
  bitir"; başlangıçta workspace sahibine e-posta. Maskeleme (#300) ve yetki matrisi (#325) aynen
  geçerlidir. _KK:_ salt-okunur modda `POST /chats/{id}/messages` 403 `impersonation_read_only`;
  `full` modda `PATCH /auth/password` 403 `impersonation_forbidden_path`.

### 3.11 Güvenlik (389.16)

- **FR-ADMIN-22** Blocklist (e-posta, alan adı, IP/CIDR) CRUD → kayıt ve davet akışı
  `platform_signup_blocked()` ile reddeder; başarısız girişler, IP'ye göre kayıtlar, impersonation
  listesi, davet sınırı aşımları (#282), widget doğrulama/kota olayları (#339) — sayaçlar.

### 3.12 AI katalogları ve yönetişim görünümleri (389.19)

- **FR-ADMIN-23** G1–G19 kataloğu ve `PLATFORM_GUARDRAILS_VERSION` (salt okunur); **ülkeye göre
  kriz metni taslakları** (`platform_settings.ai.crisis_text_drafts[country]`, kiracı API
  `platform_ai_settings()` ile okur; AI-08-S1: kiracı onaylamadan yayın yok); iGaming şablon
  paketi sürümü + kiracı başına kurulum/yayın durumu (#311); uyum senaryo paketi sürümü (#314);
  QA rubriği (#319); araç kataloğu (#321). Workspace detayında "AI" sekmesi: yapılandırma
  değişikliği sayıları (#315), guardrail tetiklenme sayıları (#301), QA özeti — **içerik yok**.

### 3.13 Uyarılar (389.20)

- **FR-ADMIN-24** Operatör e-posta uyarıları (tercihe bağlı): deneme bitişi 3 gün, ödeme kuyruğu
  24 sa bekleyen, kota %100'e ulaşan kiracı, sağlık kırmızı, audit zinciri doğrulama hatası.
  Platform-api içi tarama, Redis kilidiyle tekil. En kolay düşürülebilir kalem.

## 4. Fonksiyonel olmayan gereksinimler

- **NFR-ADMIN-S1 İzolasyon:** platform rotaları yalnız `platform-api` sürecinde yüklenir; kiracı
  API süreci çapraz-kiracı rota taşımaz. DB rolü `siyahtus_platform` (BYPASSRLS; superuser
  değilse `WARNING` + politikalara `OR current_user` yolu — açık karar §6.4). `audit_log`,
  `invoices`, 2FA tabloları için platform rolünden `UPDATE/DELETE` **REVOKE**.
- **NFR-ADMIN-S2 Erişim:** yalnız `admin.<alan>`, 127.0.0.1'e bağlı container, edge'de IP izin
  listesi + (önerilen) Cloudflare Access; CSP `frame-ancestors 'none'`; CSRF yüzeyi yok (çerez
  yok, Bearer).
- **NFR-ADMIN-S3 Sırlar:** panelde saklanan tek sır sınıfı AI anahtarları (şifreli); dağıtım
  sırları env'de; log redaksiyonu (`log-redact.ts`) platform sürecinde de.
- **NFR-ADMIN-A Audit:** her mutasyon gerekçeli, zincirli, dışa aktarılabilir, doğrulanabilir.
- **NFR-ADMIN-P Performans:** liste uçları keyset sayfalama, ≤200 ms p95 (10k kiracı fixture);
  sağlık/health snapshot okumaları Redis'ten.
- **NFR-ADMIN-I i18n/a11y:** en/tr ratchet testi, axe (apps/web ile aynı kalıp), masaüstü-only
  (`apps/admin` dar ekran desteği kapsam dışı — #385 kiracı paneline özgü).
- **NFR-ADMIN-O Gözlemlenebilirlik:** `siyahtus-platform` telemetri adı, yapılandırılmış log
  (#288 bağlam alanları + `platform_admin_id`), `/platform/v1/health/{live,ready}`.
- **NFR-ADMIN-B Yedek/geri yükleme:** aynı Postgres; `scripts/backup.sh` platform tablolarını da
  kapsar (test: geri yüklemede audit zinciri doğrulanır).
- **NFR-ADMIN-D Taşınabilirlik:** her şey `ADMIN_APP_URL` / `DATABASE_PLATFORM_URL` / `REDIS_URL`'e
  bağlı; ayrı sunucuya taşımak DB/Redis rotası + edge girdisi.
- **NFR-ADMIN-C Kiracı API için boot kuralı yok:** platform ayarları okunamazsa kiracı API env ile
  çalışmaya devam eder (uyarı); yeni boot-blocking kural yok (sahip kuralı 2026-10-10).

## 5. Tehdit özeti (STRIDE, v1 karşılıkları)

| Tehdit                                   | Karşılık                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Operatör hesabı ele geçirme              | zorunlu TOTP, IP izin listesi, kısa boşta TTL, recentTotp, failure bucket                                      |
| Çapraz-kiracı veri sızıntısı             | kiracı içeriği platform ekranında yok; impersonation salt-okunur + maske + audit                               |
| İçeriden kötüye kullanım                 | gerekçe zorunlu, çift audit, zincir doğrulama, sahibe impersonation e-postası, superadmin+TOTP yıkıcı eylemler |
| Platform API'nin kiracı yüzünden erişimi | ayrı süreç/port/kontrat; `/platform` yolu kiracı API'de yok; endpoint-ui ve sızıntı testi                      |
| Anahtar sızıntısı                        | AES-256-GCM, `…last4`, log/audit redaksiyonu, `GET` maske                                                      |
| Yanlış kiracıya eylem                    | her eylem workspace adını yazarak onay (yıkıcı), ReasonDialog, geri alınabilir silme                           |

## 6. Açık kararlar (varsayılan seçildi; sahip değiştirebilir)

1. HIPAA BAA damgası self-serve kalır (platform imzası F2).
2. Pilot dışında self-serve Enterprise yükseltmesi **kalır** (mevcut davranış); platform
   `set-plan` buna ek.
3. Impersonation: başlangıçta e-posta, bitişte yok; `full` mod v1'de (superadmin + TOTP).
4. BYPASSRLS managed Postgres'te superuser ister; reddedilirse politikalara `OR current_user =
'siyahtus_platform'` migration'ı (389.1 TUZAKLAR'da). Pilot host (Docker) için sorun yok.
5. Workspace sert silme: 14 gün soğuma; kiracı tarafı "silme talebi" #384 iptal akışıyla karşılanır.
6. Mobil parity: kiracı API'ye +2 yol (`/auth/impersonation/exchange`, `/deployment/notice`);
   sayı yorumla bump edilir (389.13 ve 389.15).
7. Tek bölge, tek platform örneği (v1).
8. Operatör SSO yok (v1).
9. 389.20 (uyarılar) ilk düşürülecek kalem.
10. K06.4(iii) "serbest metin karara girmez" ilkesi **etkilenmez**: kiracı davranış kuralları
    paketin tasarımıyla (#299 guidance kuralları, prompt katman sırası) yapılır; bu epik yalnız
    platform katmanını ([1] kilitli kurallar, kriz metni taslakları) besler.
