# Task ID: 26

**Title:** I18N1/2 — Panel + widget i18n (mesaj katalogu + locale)

**Status:** pending

**Dependencies:** None

**Priority:** medium

**Description:** i18n altyapisi YOK (§7.2 I18N ⬜); metinler kod icinde sabit, tarih/sayi Intl ile dagink (apps/web/src/lib/format.ts, Transcript.tsx). PRD I18N1/2: panel (apps/web) + widget (apps/widget) cevrilebilir olsun. Canli/otomatik ceviri kapsam disi (§9) — yalniz katalog + tr/en.

**Details:**

1) Hafif i18n: harici agir bagimlilik gerekmez — mesaj katalogu (tr/en) + t() yardimci; locale kaynagi (kullanici/tarayici). Mevcut Intl format helper'larini (format.ts) locale'e bagla.
2) Panel: apps/web gorunur string'leri katalogla; tr/en iskelet + eksik-anahtar guvenligi (fallback).
3) Widget: apps/widget string'leri katalogla; P3 bundle butcesi (50KB, mevcut 5.3KB) korunur.
PRD: NFR I18N1/2 · PLAN.md §7.2.

**Test Strategy:**

DoD kapisi + widget bundle butcesi (P3) korunur (describe.skipIf boyut testi yesil). Ozel: t() eksik-anahtar fallback unit; locale degisince metin degisir smoke/e2e; widget boyut kontrolu. Bitince PLAN.md §7.2 I18N ⬜→✅ guncellenir.

## Subtasks

### 26.1. i18n yaklasimi + katalog (tr/en) + t() + locale kaynagi

**Status:** pending  
**Dependencies:** None  

Hafif cozum; fallback; locale secimi.

### 26.2. Panel string katalogla + Intl helper'lari locale'e bagla

**Status:** pending  
**Dependencies:** 26.1  

apps/web string'leri + format.ts locale.

### 26.3. Widget string katalogla (bundle butcesi P3)

**Status:** pending  
**Dependencies:** 26.2  

apps/widget; boyut korunur.

### 26.4. Testler: t() fallback unit + locale smoke + widget boyut

**Status:** pending  
**Dependencies:** 26.3  

Fallback; locale-degisim; P3 boyut.
