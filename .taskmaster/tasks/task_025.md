# Task ID: 25

**Title:** M5 — Gozlemlenebilirlik: OpenTelemetry span/metrik (request_id koprusu)

**Status:** pending

**Dependencies:** None

**Priority:** medium

**Description:** request_id + korele log var (apps/api/src/server.ts:67-69 requestIdHeader; error-handler.ts) ama OTel YOK (§7.2 M5 ◐). PRD M5: dagitik izleme (span) + temel metrikler; request_id ile korele. Prod collector yok (sinir) — mock/konsol exporter.

**Details:**

1) OTel SDK (Node): tracer + HTTP/route span'leri; exporter MOCK/konsol. request_id'yi span attribute + trace korelasyonuna bagla (server.ts).
2) Temel metrikler: istek sayaci/sure, hata orani; kritik yollara (auth, chats, reports) span.
3) Test ortaminda kapatilabilir; perf overhead sinirli.
PRD: NFR M5 · PLAN.md §7.2. Sinir: gercek OTel collector/prod yok.

**Test Strategy:**

DoD kapisi. Ozel: mock exporter'a span dustugu + span'de request_id attribute mevcut (integration); temel metrik uretimi; makul overhead. Bitince PLAN.md §7.2 M5 ◐→✅ guncellenir. Kanit: konsol/mock exporter span ciktisi.

## Subtasks

### 25.1. OTel SDK kurulum + tracer + mock/konsol exporter

**Status:** pending  
**Dependencies:** None  

Node OTel; test-kapatilabilir exporter.

### 25.2. HTTP/route span'leri + request_id korelasyonu

**Status:** pending  
**Dependencies:** 25.1  

server.ts; span attribute request_id.

### 25.3. Temel metrikler (istek/sure/hata) kritik yollarda

**Status:** pending  
**Dependencies:** 25.2  

auth/chats/reports.

### 25.4. Testler: span uretimi + request_id attribute (mock exporter)

**Status:** pending  
**Dependencies:** 25.3  

Span dustu + attribute assertion.
