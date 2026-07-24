# Task ID: 6

**Title:** 08.5.2-a — Websites API + kontrat

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** Website modeli schema.prisma:806-820'de duruyor (licenseId, domain, setup, status, connectedAt, unique[licenseId,domain]) ama openapi.yaml'da /websites yolu YOK ve hicbir route dosyasi ona dokunmuyor. Model olu.

**Details:**

CRUD + snippet uretimi. status alani zaten 'pending' default'lu ve connectedAt nullable — 'Connected' gecisinin nerede yazildigina karar ver (widget ilk handshake'i mantikli yer). setup alani 'manual' default: manual | shopify | wordpress | gtm degerlerini burada sabitle. Kontrat once.

PRD: FR-MOD-08.5.2 · PLAN.md §3.7 / §8 · Dilim 13

**Test Strategy:**

Kabul: CRUD lisans kapsamli. Ayni domain iki kez eklenemez — unique[licenseId,domain] ihlali ADR-06 zarfi dondurur, ham 500 DEGIL (bu ayrimi test eder). Cross-tenant: baska lisansin sitesi okunamaz/silinemez. Kontrat: generate edilmis tipler openapi.yaml ile drift etmiyor.
