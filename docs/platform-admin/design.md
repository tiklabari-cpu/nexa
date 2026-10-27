# Root (platform) yönetim paneli — tasarım (tm 389)

Gereksinimler: `requirements.md`. Görev yerleşimi: `gorev-yerlesimi.md`. Bu doküman 389.x alt
görevlerinin "KODDA BUGÜN / KARARLAR" kutularının ortak kaynağıdır; satır numaraları 2026-10-14
çalışma kopyasına göredir — başlamadan önce grep ile yeniden doğrula.

## A. Mimari

| Bileşen        | Süreç / imaj                                                                                                         | Port        | Erişim                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------- |
| `platform-api` | `apps/api` imajı, `command: node dist/src/platform.js`, `SIYAHTUS_MIGRATE_ON_START=false`, `depends_on: api healthy` | 4002        | `admin.<alan>/platform/*` → `127.0.0.1:${SIYAHTUS_PLATFORM_HOST_PORT:-4002}` (tek hop) |
| `admin`        | yeni `apps/admin` SPA, nginx-unprivileged (apps/web Dockerfile kalıbı)                                               | 8080 → 5175 | `admin.<alan>/*`                                                                       |

- `apps/api/src/platform-server.ts` `buildPlatformServer()` sırayla kaydeder: errorHandler,
  lifecycle, telemetry (`siyahtus-platform`), sensible, helmet, cors (yalnız `ADMIN_APP_URL`),
  **platformDatabase** (`DATABASE_PLATFORM_URL`), redis, backgroundMail, platformRateLimit,
  platformAuth, platformAudit, rotalar `/platform/v1`. Kaydedilmez: scheduler, auth/license/
  entitlement/sandbox/pilot gate, metering, ai-budget. `server.ts:199-306` Fastify seçenekleri
  `lib/fastify-options.ts baseFastifyOptions()` olarak çıkarılır (davranış birebir; mevcut
  `buildServer` testleri değişmez).
- Yeniden kullanılan modüller: env/load-env/shutdown/trust-proxy/log-redact/api-error/crypto/
  totp/ip-allowlist/origin; mail (mailer, caps, templates, delivery); billing
  (`subscription-service`, `license-activation`, `metering`); audit (`audit-log`, `audit-chain`
  genelleştirilmiş, `audit-export`); `routes/health.ts:143-177` → `services/ops/health-snapshot.ts`;
  `routes/reports.ts:444-496` → `services/billing/billing-views.ts`.
- **Süreçler arası:** senkron çağrı yok; paylaşılan durum Postgres; komutlar Redis pub/sub
  `siyahtus:platform:ops` (`settings.changed`, `ai.settings_changed`, `health.publish`; her kiracı
  API süreci ve RTM dinler) ve `siyahtus:platform:ops:jobs` (yalnız `job.run`; kiracı API'de
  zamanlayıcısı açık her süreç dinler — ayrı kanal, çünkü `PUBLISH` sayısı `no_listener`'ı
  söyler ve genel kanalı tm 389.13'ten beri her süreç dinliyor); `job.run` isteğini
  `request_id` talep anahtarını (`SET … NX`) ilk alan süreç işler — "lider" kilidi her yarım
  dakikada bırakılıp yeniden alındığı için lider-dinler tasarımı boşluklu olurdu (tm 389.14;
  iş ayrıca `siyahtus:sched-running:<ad>` çalışıyor işaretini taşır, panel `already_running`'i
  oradan söyler; sonuç `siyahtus:ops:job-runs`, iş tablosu `siyahtus:ops:scheduler`). Sağlık anlık görüntüsü
  `siyahtus:ops:health` (lider, 30 sn). **Bileşen durum kaydı** `siyahtus:ops:components` (Redis
  hash; `services/ops/component-status.ts reportComponentStatus(key, {state: ok|degraded|down|
not_installed, detail, updatedAt})` — kiracı API bileşenleri isteğe bağlı çağırır; 389.14 mevcut
  bileşenlere çağrıyı ekler).

## B. Veritabanı

### B1. Rol (migration `20261101090000_platform_role_and_tables`)

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siyahtus_platform') THEN
    CREATE ROLE siyahtus_platform LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
      PASSWORD 'siyahtus_platform_dev_password';
  END IF;
  -- BYPASSRLS superuser ister; managed Postgres reddederse WARNING ver, politika yolu 389.1 TUZAKLAR.
  BEGIN EXECUTE 'ALTER ROLE siyahtus_platform BYPASSRLS';
  EXCEPTION WHEN insufficient_privilege THEN RAISE WARNING 'siyahtus_platform: BYPASSRLS verilemedi'; END;
END $$;
GRANT CONNECT ON DATABASE siyahtus TO siyahtus_platform;
GRANT USAGE ON SCHEMA public TO siyahtus_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO siyahtus_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO siyahtus_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO siyahtus_platform;
REVOKE UPDATE, DELETE ON audit_log, invoices, invoice_line_items, account_two_factor,
  account_two_factor_recovery_codes FROM siyahtus_platform;
GRANT EXECUTE ON FUNCTION auth_revoke_refresh_family, auth_two_factor_disable,
  purge_unverified_signups, sandbox_reset, events_ensure_partition TO siyahtus_platform;
```

Aynı DO bloğu `infra/db/init/00-extensions.sql`'e; `infra/db/pilot/20-platform-role-password.sh`
(10-app-role-password.sh kalıbı); `with-test-datastores.ts` üçüncü URL'yi türetir; fixtures
`platformClient()`, `buildPlatformTestServer()`.

### B2. Platform tabloları (hepsi `ENABLE ROW LEVEL SECURITY`, politika yok, `REVOKE ALL FROM siyahtus_app`)

| Tablo                             | Alanlar (özet)                                                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `platform_admins`                 | id, email citext unique, password_hash (scrypt), role, totp_secret_ciphertext, totp_enrolled_at, disabled_at, invited_by, created_at                                                             |
| `platform_admin_recovery_codes`   | admin_id, code_hash, used_at                                                                                                                                                                     |
| `platform_admin_invites`          | id, email, role, token_hash, expires_at, accepted_at                                                                                                                                             |
| `platform_sessions`               | id, admin_id, token_hash unique, stage password\|active, created_at, last_seen_at, totp_verified_at, expires_at, ip, user_agent                                                                  |
| `platform_audit_log`              | chain_seq bigint PK, admin_id, action (kapalı liste), target_type, target_id, license_id?, reason, payload jsonb, ip, created_at, prev_hash, hash — append-only (trigger UPDATE/DELETE reddeder) |
| `platform_audit_chain_head`       | singleton: seq, hash                                                                                                                                                                             |
| `platform_settings`               | key text PK, value jsonb, updated_by, updated_at, version int                                                                                                                                    |
| `platform_notes`                  | id, license_id, admin_id, body, created_at                                                                                                                                                       |
| `platform_blocklist`              | id, kind email\|domain\|ip, value, reason, created_by, created_at                                                                                                                                |
| `platform_impersonation_sessions` | id, admin_id, license_id, account_id (hedef üye), mode read_only\|full, handoff_code_hash, handoff_expires_at, started_at, ends_at, ended_at, end_reason                                         |
| `platform_credits`                | id, license_id, amount_minor, currency, reason, admin_id, invoice_id?, created_at                                                                                                                |
| `platform_alert_prefs`            | admin_id PK, kinds text[], locale en                                                                                                                                                             | tr (389.20) |

`platform_settings` anahtarları: `signup_enabled`, `trial_days`, `announcement {en,tr,level,
until}`, `maintenance {enabled, mode read_only|full, message}`, `billing.swift_bank_details`,
`billing.providers {swift_manual, crypto_manual, stripe}`, `billing.issuer_profile`,
`ai.llm {provider, base_url, model, model_fast, region, timeout_ms, max_output_tokens,
api_key_ciphertext, api_key_last4}`, `ai.embedding {provider, base_url, model, dimensions:1536,
api_key_ciphertext, api_key_last4}`, `ai.caps {deployment: {llm|embedding: {workspace, global}}, plans: {…}}` (389.17 writes
`deployment` — in place of the four `AI_DAILY_*`; `plans` is 389.12's), `ai.prices
{llm_input_usd_per_mtok, llm_output_usd_per_mtok, embedding_usd_per_mtok}` (in place of `AI_PRICE_*`),
`ai.crisis_text_drafts {TR: …, GB: …}`.

Kiracı API'nin çağırdığı SECURITY DEFINER'lar (EXECUTE → `siyahtus_app`; hepsi `platform_*`
öneki): `platform_public_settings()` (signup_enabled, trial_days, announcement, maintenance),
`platform_signup_blocked(email, ip)`, `platform_ai_settings()` (anahtar **şifreli** döner; çözme
`PLATFORM_SETTINGS_KEY` ile kiracı sürecinde), `platform_billing_settings()` (sağlayıcı
görünürlüğü, banka bilgisi, ihraççı profili).

### B3. Kiracı tarafı dalgalanmalar (389.2)

- `20261101120000`: `licenses_status_check` += `suspended` (+`suspended_at`, `suspended_reason`,
  `purge_scheduled_at`); `audit_log_actor_type_check` += `platform`; **`license_overrides`**
  (license_id PK; entitlements jsonb, seat_ceiling, mail_daily_cap, expires_at, updated_by,
  updated_at; RLS yalnız SELECT, `siyahtus_app`'e yazım yok — §C-A25 ruhu) → `lib/entitlements.ts
readEntitlements` merge. **AI tavanı burada değil:** #283.2'nin `licenses.ai_daily_*_cap`
  kolonları tek kaynaktır; 389.12 oraya yazar (`override ?? plan ?? env`). #283 henüz
  kapanmadıysa 389.12 kolonları kendisi açar, #283.2 "varsa kullan" diye yazılmıştır.
- `20261101150000`: `api_tokens_kind_check` += `impersonation` + `impersonation_session_id`;
  `auth_resolve_token` iki kolon daha; `auth_consume_impersonation_handoff(code_hash,
token_hash)`.
- `packages/types/src/domain.ts`: `suspended`, `LICENSE_CLOSED_STATUSES`, `isLicenseClosed()`; 11
  `=== 'canceled'` noktası (auth.ts:647/1235/1629, channels.ts:427, saml.ts:224,
  channel-service.ts:427/611, token-service.ts:84, metering.ts:249, rtm/auth.ts:149/267) helper'a;
  token-service reason `license_closed`; authorize → `not_allowed/workspace_suspended`; müşteri
  token mint 403; RTM aynı.
- `GET /deployment/notice` (duyuru + bakım; `/deployment` gövdesi değişmez → 13-test dalgası
  yok); `plugins/maintenance-gate.ts` (503, `ERROR_TYPES` += `maintenance`); signup gate
  `platform_public_settings().signup_enabled` (env yedek) + blocklist (`not_allowed/
signup_blocked`).
- Mobil parity: 224 → **226** (exchange + notice; yorum satırıyla; bump'ı hangi görev önce
  kapanırsa o yapar, diğeri TUZAKLAR'da).

## C. Platform API yüzeyi — ayrı kontrat `packages/contract/platform/openapi.yaml`

Bundle `--entry/--out` parametreli, `dist/platform-openapi.json`, `src/generated/platform.ts`,
`loadPlatformOpenApiDocument()`; `platform-contract-parity.test.ts`; `endpoint-ui.cjs` ikinci
çift. Ortak: keyset sayfalama `?cursor&limit`, her mutasyon `{reason}`, `?q`. Hata tipleri
`platform_*` önekli (`packages/types/src/errors.ts`).

| Modül       | Uçlar (özet)                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| auth        | login (aşamalı), totp enroll/activate/verify/reverify, recovery regenerate, me, **me/alert-prefs (GET/PUT, 389.20)**, sessions, logout, invite/accept                                                                                                                                                                                                                                                     |
| admins      | CRUD, davet, rol, disable/enable, reset-two-factor, revoke-sessions                                                                                                                                                                                                                                                                                                                                       |
| dashboard   | kpis, signups timeline, health (+components)                                                                                                                                                                                                                                                                                                                                                              |
| workspaces  | list, detail, members, brands, usage, subscription, invoices(+download), audit, sandbox, notes, impersonations, ai-summary; eylemler extend-trial, activate, set-plan, suspend/unsuspend [totp], set-read-only/set-active, cancel/resume, overrides, ai-caps, resend-owner-verification, sandbox/reset, force-ownership-transfer [superadmin+totp], delete [superadmin+totp] / delete/cancel, purge-queue |
| accounts    | search, detail, resend-verification, force-password-reset, revoke-sessions/tokens, reset-two-factor [totp], suspend/unsuspend, export, erase [totp]                                                                                                                                                                                                                                                       |
| billing     | plans, subscriptions, invoices(+pdf), packages, revenue, credits, manual-subscription, payment-requests (crypto queue: list, send-address, confirm-txid, cancel), swift-payments (mark-paid), providers (GET/PUT), bank-details (GET/PUT), issuer-profile (GET/PUT)                                                                                                                                       |
| usage       | global, workspaces (top), workspace detail, caps PUT                                                                                                                                                                                                                                                                                                                                                      |
| settings    | GET/PATCH (signup_enabled, trial_days, announcement, maintenance [totp]), effective-config, **ai** (GET maske / PUT / test-connection / reembed)                                                                                                                                                                                                                                                          |
| ai-catalogs | guardrails (catalog+version), crisis-text-drafts (GET/PUT), templates (pack version, installs), compliance-pack, qa-rubric, tools                                                                                                                                                                                                                                                                         |
| operations  | scheduler (+run-now), webhooks backlog, siem, partitions (+ensure), unverified-signups (+purge [totp]), jobs (ai/knowledge/docs), components                                                                                                                                                                                                                                                              |
| audit       | list, export (NDJSON + imza), verify, workspaces/{id}                                                                                                                                                                                                                                                                                                                                                     |
| security    | blocklist CRUD, failed-logins, signups-by-ip, impersonations, abuse-counters                                                                                                                                                                                                                                                                                                                              |
| support     | lookup, impersonations start/end/get                                                                                                                                                                                                                                                                                                                                                                      |
| health      | live/ready/narrow                                                                                                                                                                                                                                                                                                                                                                                         |

## D. `apps/admin` SPA

`apps/web`'den kopya: `api-client.ts` (baseUrl `/platform/v1`, Bearer, brand başlığı yok, 401 →
sign-out), `i18n.ts` + ratchet testi (en/tr), `tokens.css` (operatör vurgu rengi amber; kalıcı
"PLATFORM · <region>" şeridi; `[OPS]` başlık öneki), `tailwind.config.ts`, `components/ui/*`,
SettingsForm/SaveBar kalıbı (#323 ile aynı), nginx.conf (`/platform/` → `PLATFORM_UPSTREAM`;
WebSocket yok; `frame-ancestors 'none'`), Dockerfile, vitest, `nginx-security.test.ts`,
`build-sourcemaps.test.ts`, `url-pii` CI denetimi (#386) kapsamına girer. PKCE yok — `POST
/auth/login` + TOTP; tek opak oturum token'ı `sessionStorage`. Özellik klasörleri: auth,
dashboard, workspaces (liste + sekmeli detay + ReasonDialog/TOTP), accounts, billing (+payment
queues), usage, settings (duyuru/bakım/effective-config/**AI ayarları**), ai-catalogs, operations,
audit, security, admins, support. Vite `ADMIN_PORT` 5175, proxy `/platform` → 4002. axe testleri.

**AI ayarları ekranı (389.17):** sağlayıcı seçimi (mock/openai), model, model (hızlı), base URL,
bölge, **API anahtarı** (type=password, yazma-yalnız, kaydedince "•••• last4" + "Değiştir"),
zaman aşımı / çıktı token limiti, embedding modeli (1536 sabit, değişince uyarı), günlük tavanlar
(global, workspace başına varsayılan), fiyat tablosu, "Bağlantıyı test et" (sonuç + gecikme),
"Yeniden gömle" (iş ilerlemesi), **etkin yapılandırma kaynağı** rozeti (DB / env).

## E. Dağıtım

- `docker-compose.pilot.yml` + `.full.yml`: `platform-api` (aynı imaj, `command`, healthcheck
  `/platform/v1/health/ready`, `127.0.0.1:4002`) ve `admin` (`127.0.0.1:5175:8080`);
  `x-app-environment` += `DATABASE_PLATFORM_URL`; db += `SIYAHTUS_PLATFORM_DB_PASSWORD` + init
  script. Edge: Caddy `admin.example.com { handle /platform/* → :4002; handle → :5175 }`;
  cloudflared aynı; `env.pilot.test.ts` "beş public isim" + tek-hop kuralı. Helm `apps:` +=
  `platform-api` (`command` alanı template'e), `admin`; secret/configmap; networkpolicy
  (platform-api yalnız admin pod'larından). Makefile `platform-bootstrap-admin`; `scripts/smoke.sh`
  admin/platform kontrolleri; CI `pilot-images` otomatik.
- **Env** (parity listesiyle; her anahtar `env.ts`, `.env.example`, `.env.production.example`,
  `turbo.json globalEnv`, `ci.yml`, README, production-checklist §1/§9, Helm `values*.yaml` +
  `secret.yaml`/`configmap.yaml`, `chart-storage.test.ts`): `DATABASE_PLATFORM_URL`,
  `PLATFORM_PORT` 4002, `PLATFORM_HOST`, `ADMIN_APP_URL`, `PLATFORM_IP_ALLOWLIST`,
  `PLATFORM_SESSION_TTL` 28800, `PLATFORM_IDLE_TTL` 900, `PLATFORM_IMPERSONATION_TTL` 1800,
  `RATE_LIMIT_PLATFORM_PER_MIN` 300, `PLATFORM_SETTINGS_KEY`; compose-only
  `SIYAHTUS_PLATFORM_DB_PASSWORD`, `SIYAHTUS_PLATFORM_HOST_PORT`, `SIYAHTUS_ADMIN_HOST_PORT`; Vite
  `ADMIN_PORT`. Kiracı API'de boot'u durduran yeni kural **yok**; platform süreci kendi
  `assertPlatformEnv`'ine sahip.
- Docs: production-checklist §1/§9 "Back office" (bootstrap, Cloudflare Access, managed
  Postgres'te `ALTER ROLE … BYPASSRLS`), "Trial end" bölümü panelle yeniden yazılır (psql dipnot);
  `docs/runbooks/platform-admin-ops.md`; `tenant-isolation-suspicion.md` paragrafı;
  `docs/adr/platform-admin-panel.md` (ADR-16 — 15 numara RTM zarfına ait; PLAN §0 tablosuna 389.7 ekler).

## F. Platform AI ayarları — kiracı API tarafı (389.17)

- `services/ai/provider/llm-registry.ts`: `createLlmProvider` boot'taki tek örnek yerine
  **hot-swap registry** (`current()`, `reload()`); yapılandırma `platform_ai_settings()` → yoksa
  env; Redis `ai.settings_changed` ile yeniden kurulur; `MeteredLlm`, ziyaretçi ve Copilot
  örnekleri (ayrı devre kesiciler) registry'den; `plugins/ai-residency.ts` ve `plugins/ai-budget.ts`
  `metered` bayrağı registry'yi okur. #283.1 adaptörü `createLlmProvider(config)` **saf
  fonksiyon** olarak yazılır ki registry yeniden kurabilsin (#283'e not düşüldü).
- Kayıt anında doğrulama: `provider-hosts.ts` bölge kuralı, `EMBEDDING_DIMENSIONS=1536`,
  `PILOT_MODE` production'da mock reddi; embedding modeli değişince uyarı + "Yeniden gömle"
  (`knowledge:reembed` → `operations.run`, ölçüm deployment satırına). "Bağlantıyı test et"
  küçük tamamlama (deployment satırına ölçüm, kiracı kotasına değil).
- Anahtar hiçbir zaman düz dönmez (`…last4`); audit payload'ında yalnız `changed: ['api_key']`.

## G. Impersonation akışı (389.15)

1. Operatör → `POST /platform/v1/support/impersonations {license_id, account_id, mode, reason}`
   ([totp] `full` için) → `platform_impersonation_sessions` + tek kullanımlık handoff kodu (60 sn)
   - sahibe `impersonation_notice` e-postası.
2. Operatör tarayıcısı `app.<alan>/auth/impersonate#code=…` → `POST /api/v1/auth/impersonation/
exchange` (public, kendi kovası) → SQL `auth_consume_impersonation_handoff` → `api_tokens(kind=
'impersonation')`; `token-service` dalı → `principal.impersonation {sessionId, mode, endsAt,
adminId}`.
3. `plugins/impersonation-gate.ts`: `read_only`'de yazım 403; her modda yasak yollar; `plugins/
audit.ts actorOf` → `platform` + `on_behalf_of`; `/auth/me.impersonation`;
   `ImpersonationBanner` (kırmızı, geri sayım, "Oturumu bitir" → platform tarafı `end`).
4. RTM: `apps/rtm/src/auth.ts` impersonation token'ını tanır, `read_only`'de yayın yapmaz.

## H. Test stratejisi (ortak)

- Platform rotaları `buildPlatformTestServer()` ile; her modülde (a) yetki matrisi testi (4 rol ×
  uçlar), (b) TOTP/recentTotp kapıları, (c) audit çift yazımı, (d) kiracı tarafı etki testi
  (`buildTestServer()` ile aynı DB).
- İzolasyon kanıtı: `platform-rls.test.ts` — `siyahtus_app` platform tablolarını okuyamaz;
  `siyahtus_platform` kiracı tablolarını RLS'siz okur; kiracı API sürecinde `/platform/*` 404.
- e2e `platform-admin.spec.ts` (sharded + pilot/session configs): bootstrap → login → TOTP →
  workspace askıya al → kiracı paneli 403 → kaldır → impersonation salt-okunur → şerit → bitir.
- Mutasyon kanıtları: zincirde bir satır değiştir → verify kırmızı; anahtar düz dönerse test
  kırmızı (`secret-redaction` kalıbı).

## I. Dosya listesi (özet, 389.x KODDA BUGÜN kutuları buradan)

`apps/api/src/server.ts`, `platform.ts`/`platform-server.ts` (yeni), `lib/fastify-options.ts`
(yeni), `plugins/{database,platform-database,platform-auth,platform-audit,platform-rate-limit,
maintenance-gate,impersonation-gate}.ts`, `config/env.ts` (+`platform-env.ts`),
`services/platform/**` (yeni), `services/auth/{token-service,principal}.ts`, `plugins/audit.ts`,
`services/audit/{audit-log,audit-chain}.ts`, `routes/{auth,account-lifecycle,deployment,customer,
reports,health}.ts`, `plugins/scheduler.ts`, `services/mail/templates/messages.ts`,
`lib/entitlements.ts`, `services/ai/provider/{llm-provider,llm-registry}.ts`,
`prisma/schema.prisma` (**`prisma format` çalıştırma** — hafıza), migrations (3 yeni);
`apps/rtm/src/auth.ts`; `packages/types/src/{domain,platform,errors}.ts`;
`packages/contract/{platform/**, scripts/bundle.ts, openapi/paths/{auth,deployment}.yaml}`;
`apps/mobile` parity; `apps/web` (ImpersonationBanner, NoticeBar, ImpersonatePage, i18n);
`apps/admin` (yeni); `apps/e2e` (portlar 4002/5175, webServer, MAP, `totp.ts`,
`platform-admin.spec.ts`); `eslint.config.js`, `scripts/audit/endpoint-ui.cjs`,
`scripts/smoke.sh`, Makefile, compose dosyaları, `infra/{db,pilot,helm}`, docs.
