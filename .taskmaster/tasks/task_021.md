# Task ID: 21

**Title:** 07.1/07.3.1/07.3.3 — Reports Breakdown sayfasi + AI Agent sekmesi + vs-onceki donem + Chats kartlari

**Status:** pending

**Dependencies:** 20

**Priority:** medium

**Description:** Reports bugun yalniz Overview (Dilim 9). Eksik Should payi: 07.1 kenar cubugu sekmeleri (Overview/AI Agent/Breakdown); 07.3.1 aralik tablarina 365+custom ve vs-onceki donem karsilastirmasi; 07.3.3 Chats bolumu kartlari (automated chats/hour, sure/response dagilimlari). §2 MOD-07 ◐.

**Details:**

1) Kontrat: reports.yaml -> breakdown + ai-agent yanitlari; overview'a previous_period (delta) blogu. types generate.
2) Backend: reports.ts — verilen range icin onceki esit-uzunluk donemi hesapla + delta don; 365/custom aralik (query param dogrulama); breakdown/ai-agent aggregation.
3) Web: ReportsPage.tsx — sol sekme (Overview/AI Agent/Breakdown), range tabs 7/30/90/365 + custom date picker, her KPI'da vs-onceki delta rozeti, Chats bolumu kartlari.
PRD: FR-MOD-07.1/07.3.1/07.3.3 · PLAN.md §3.6 · §2 MOD-07. Bagimlilik: task 20 (KPI kirilimi Breakdown'da yeniden kullanilir).

**Test Strategy:**

DoD kapisi. Ozel: previous-period delta integration testi (esit uzunluk donem dogru); custom range param dogrulama; breakdown rakamlari; e2e Reports sekme gezinme (Overview/AI Agent/Breakdown). Bitince PLAN.md §3.6 (07.1/07.3.1/07.3.3) ◐→✅ ve §2 MOD-07 guncellenir. Kanit: Breakdown + AI Agent sekmesi screenshot.

## Subtasks

### 21.1. Kontrat: breakdown/ai-agent + previous_period delta

**Status:** pending  
**Dependencies:** None  

reports.yaml yeni yanitlar + overview delta blogu; types generate.

### 21.2. Backend: previous-period delta + 365/custom range + breakdown/ai-agent aggregation

**Status:** pending  
**Dependencies:** 21.1  

reports.ts onceki donem + delta; range dogrulama; yeni aggregation sorgulari.

### 21.3. Web: sol sekmeler (Overview/AI Agent/Breakdown)

**Status:** pending  
**Dependencies:** 21.2  

ReportsPage sekme yapisi + rota/durum.

### 21.4. Web: range tabs 365+custom + vs-onceki delta rozetleri + Chats kartlari

**Status:** pending  
**Dependencies:** 21.3  

Date picker; delta rozetleri; Chats bolumu kartlari.

### 21.5. Testler: integration (delta + custom range) + unit + e2e sekme gezinme

**Status:** pending  
**Dependencies:** 21.4  

Delta dogrulugu; custom range; e2e navigasyon.
