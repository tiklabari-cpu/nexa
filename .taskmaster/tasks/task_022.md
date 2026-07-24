# Task ID: 22

**Title:** 00.4 — Onboarding sihirbazi + tohum veri (yeni calisma alani)

**Status:** pending

**Dependencies:** None

**Priority:** medium

**Description:** Signup ile acilan yeni calisma alani bugun bos aciliyor (apps/api/src/routes/settings.ts:64 — signup satir olusturmuyor, yalniz seed olusturuyor). PRD 00.4 (Should): yeni sahibe ilk kurulum sihirbazi (profil/persona, ilk website widget, davet, ornek tohum veri) ile bos ekran yerine calisir baslangic. §3.0 ⬜, Dilim 12/14'te ertelendi.

**Details:**

1) Adim kapsami (PRD 00.4): (a) workspace/persona temel bilgi, (b) ilk website widget (mevcut 08.5.2 akisini yeniden kullan), (c) opsiyonel takim daveti (mevcut invite), (d) ornek/tohum veri (demo sohbet/canned) — MOCK.
2) Backend: onboarding tamamlanma durumu (agent/organization alaninda flag ya da /onboarding/state); tohum veri icin tenant-kapsamli SECURITY DEFINER seed fonksiyonu (RLS uyumlu).
3) Web: apps/web AppShell — ilk giriste onboarding rotasi/sihirbazi; adimlar mevcut Settings/Website/Team bilesenlerini yeniden kullanir; "atla" secenegi.
PRD: FR-MOD-00.4 (Should) · PLAN.md §3.0 · §3.11. Sinir: gercek odeme/kart yok.

**Test Strategy:**

DoD kapisi. Ozel: onboarding e2e (yeni signup -> sihirbaz -> hem skip hem complete yollari -> inbox); tohum-veri SECURITY DEFINER fonksiyonu cross-tenant integration testi (baska tenant'a sizmaz). Bitince PLAN.md §3.0 00.4 ⬜→✅, §2 MOD-00, §F sayaci (⬜ dususu) guncellenir. Kanit: sihirbaz screenshot.

## Subtasks

### 22.1. Adim kapsami + tamamlanma durumu modeli

**Status:** pending  
**Dependencies:** None  

Adimlari netlestir; onboarding flag / state ucu tasarimi.

### 22.2. Backend: tenant-kapsamli tohum veri SECURITY DEFINER fonksiyonu + state ucu

**Status:** pending  
**Dependencies:** 22.1  

Demo veri seed fn (RLS uyumlu) + tamamlanma durumu.

### 22.3. Web: onboarding sihirbazi rotasi + adimlar + skip

**Status:** pending  
**Dependencies:** 22.2  

Persona/website/invite/seed adimlari; mevcut bilesenleri yeniden kullan; atla.

### 22.4. Testler: integration (seed izolasyon) + e2e (signup->wizard->inbox)

**Status:** pending  
**Dependencies:** 22.3  

Cross-tenant seed; skip ve complete e2e yollari.
