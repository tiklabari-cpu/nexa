# Task ID: 6

**Title:** 08.5.2-a — Websites API + kontrat

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Website modeli schema.prisma:806-820'de duruyor (licenseId, domain, setup, status, connectedAt, unique[licenseId,domain]) ama openapi.yaml'da /websites yolu YOK ve hicbir route dosyasi ona dokunmuyor. Model olu.

**Details:**

CRUD + snippet uretimi. status alani zaten 'pending' default'lu ve connectedAt nullable — 'Connected' gecisinin nerede yazildigina karar ver (widget ilk handshake'i mantikli yer). setup alani 'manual' default: manual | shopify | wordpress | gtm degerlerini burada sabitle. Kontrat once.

PRD: FR-MOD-08.5.2 · PLAN.md §3.7 / §8 · Dilim 13

[günlük 2026-07-24 11:30 UTC] plan: 08.5.2-a Websites API. Kontrat once. (1) openapi: paths/websites.yaml + Website schema + openapi.yaml paths kaydi + ErrorType enum'a website_exists. generate. (2) types/errors.ts: website_exists=409; scopes.test.ts NEXA_ADDED_TYPES+len guncelle. (3) env.ts: WIDGET_BASE_URL default http://localhost:5174. (4) services/websites/website-service.ts: list/create/get/remove/serialise + snippet(orgId) + markWebsiteConnected(tx,domain). (5) routes/websites.ts CRUD, scope=access_rules:ro/rw (trusted-domains analogu; owner zaten yetkili). domain normaliseTrustedDomain ile saklanir. dup P2002 -> ApiError('website_exists') 409 ADR-06 zarf, ham 500 DEGIL. (6) server.ts register {env}. (7) baglanti gecisi: POST /customer/token icinde markWebsiteConnected (widget ilk handshake; origin+license cozuldukten sonra pending->connected, best-effort, token mint'i bloklamaz; trusted-domain OTOMATIK eklenmez -> MOD-08.9.1 ayri). (8) websites.test.ts: CRUD lisans-kapsamli, cross-tenant 404, dup 409 zarf, snippet, connected.

[günlük 2026-07-24 11:37 UTC] varsayim/celiski: setup enum. Gorev detayi 'manual|shopify|wordpress|gtm' diyor AMA uygulanmis migration (20260722154008 satir 830) websites_setup_check CHECK setup IN ('manual','platform') ve status_check IN ('pending','connected','error') zorluyor — bu da PRD 8.4 satir 969 'setup [manual/platform]' ile birebir. Dogruluk kaynagi sirasi PRD > Task Master; gorev kapsami 'API+kontrat' (migration YOK). Karar: setup=manual|platform, status=pending|connected|error olarak PRD+DB invaryantina uyduruldu. FR-MOD-08.5.2'nin Shopify/WordPress/GTM/raw ikon ayrimi UI/gorev 7 eslemesine birakildi; daha ince saklama gerekirse PLAN.md D 'PRD sapmasi' adayidir. shopify ile insert 500 veriyordu (CHECK ihlali, P2002 degil) — testte yakalandi.

[günlük 2026-07-24 11:40 UTC] bitti: /websites CRUD (GET list, POST, GET/:id, DELETE) — scope access_rules:ro/rw (trusted-domains analogu, owner zaten yetkili). Kontrat once: paths/websites.yaml + Website schema + ErrorType website_exists (409); generate calisti, contract-parity cift yonlu yesil. Duplicate domain -> ApiError('website_exists') 409 ADR-06 zarf (P2002 yakalandi, ham 500 DEGIL) — testli. Cross-tenant read/delete/list -> 404/bos, testli. Snippet: WebsiteService.snippet(orgId), WIDGET_BASE_URL (yeni env, default :5174), window.__nexa + async loader.js. Connected gecisi: POST /customer/token icinde markWebsiteConnected (widget ilk handshake; pending->connected, best-effort, token mint'i bloklamaz) — uctan uca testli. setup=manual|platform, status=pending|connected|error (DB CHECK + PRD 8.4). Testler: @nexa/api 471 yesil, @nexa/types 26 yesil, api+contract typecheck+lint temiz. Demo seed geri yuklendi, owner@acme.localhost girisi OK.

**Test Strategy:**

Kabul: CRUD lisans kapsamli. Ayni domain iki kez eklenemez — unique[licenseId,domain] ihlali ADR-06 zarfi dondurur, ham 500 DEGIL (bu ayrimi test eder). Cross-tenant: baska lisansin sitesi okunamaz/silinemez. Kontrat: generate edilmis tipler openapi.yaml ile drift etmiyor.
