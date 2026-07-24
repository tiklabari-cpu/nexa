# Task ID: 20

**Title:** 07.3.2 — Reports KPI: Manual/Assisted/Automated cozum ayrimi + Total cases

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** Reports Overview KPI'lari bugun yalniz `automated` + `total_cases` gosteriyor (apps/api/src/routes/reports.ts ~124-220; ADR-09: agent-yazimli event'i olmayan kapanmis thread = automated). PRD 07.3.2 uc kirilim istiyor: Manual / Assisted / Automated. Veri zaten var (skill_executions + events); eksik olan ayrimi yapan aggregation + kartlar. Must (MVP temel), §D17.

**Details:**

Tanim: Automated = kapanmis, hic agent-yazimli event yok (ADR-09, KORUNUR). Assisted = kapanmis, agent event VAR + o thread'e ait skill_execution VAR. Manual = kapanmis, agent event VAR, skill YOK. Manual+Assisted+Automated = toplam kapanmis vaka.
1) Kontrat: packages/contract/openapi/paths/reports.yaml overview yanitina manual/assisted (+ *_rate) alanlari (automated'in yanina). openapi.yaml:201-206 mevcut /reports/* yollari. `pnpm --filter @nexa/types generate`.
2) Aggregation: reports.ts overview SQL (~124-220). Kapanmis her vakayi uc sinifa ayir (skill_executions LEFT JOIN + agent-authored event kontrolu). ADR-09 automated tanimini bozma.
3) manual_rate/assisted_rate; automated_rate mevcut mantikla ayni (closed=0 -> null).
4) Web: apps/web/src/features/reports/ReportsPage.tsx — 3 KPI karti (Manual/Assisted/Automated) + Total cases; mevcut automated karti korunur.
PRD: FR-MOD-07.3.2 · PLAN.md §3.6 · §D17. Kapsam: yalniz bu KPI kirilimi; Breakdown sayfasi task 21.

**Test Strategy:**

DoD kapisi (typecheck/lint/unit/integration/build/e2e exit 0). Ozel: reports integration testinde uc sinifin (manual/assisted/automated) fixtür'leri; siniflandirma dogru; manual+assisted+automated = toplam closed; automated ADR-09 ile birebir ayni kalir; cross-tenant izolasyon ZORUNLU. api unit: rate hesaplari + closed=0 null guard. Bitince PLAN.md §3.6 07.3.2 satiri ◐→✅ ve §F sayaci guncellenir. Kanit: 3 kartli Reports ekrani screenshot.

## Subtasks

### 20.1. Kontrat: reports.yaml overview -> manual/assisted (+rate) alanlari

**Status:** pending  
**Dependencies:** None  

openapi paths/reports.yaml overview yanitina manual, assisted, manual_rate, assisted_rate ekle; @nexa/types generate.

### 20.2. Aggregation: reports.ts SQL uc-sinif siniflandirmasi

**Status:** pending  
**Dependencies:** 20.1  

skill_executions + agent-authored event ile Manual/Assisted/Automated ayrimi; ADR-09 automated korunur.

### 20.3. Rate hesaplari + null guard

**Status:** pending  
**Dependencies:** 20.2  

manual_rate/assisted_rate; closed=0 -> null; automated_rate mevcut mantikla tutarli.

### 20.4. Web: ReportsPage 3 KPI karti + Total cases

**Status:** pending  
**Dependencies:** 20.3  

ReportsPage.tsx uc kart (Manual/Assisted/Automated) + Total cases; automated karti korunur.

### 20.5. Testler: integration (3 sinif + toplam + cross-tenant) + unit (rate)

**Status:** pending  
**Dependencies:** 20.4  

Fixtür'ler; toplam=closed; automated=ADR-09; cross-tenant negatif; rate unit.
