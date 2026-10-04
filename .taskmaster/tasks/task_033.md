# Task ID: 33

**Title:** 06 — AI Agent + Knowledge tamamlama [MAX]

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** AI Agent backend var, UI kısmi. Şablon galerisi/reorder/crawl/profile/performance eksik. PRD MOD-06 (v1).

**Details:**

PARENT [MAX]. 06 AI Agent + Knowledge tamamlama. AiAgent şeması persona/tone/languages/name/avatarUrl VAR;
PATCH /ai-agents/:id served. 6 subtask (2'si [MAX]: reorder a11y + KB crawl SSRF). Bağlam: PLAN §4.4.2.

**Test Strategy:**

Subtask bazlı; [MAX] subtask'larda negatif testler pozitiften ÖNCE.

## Subtasks

### 33.1. 06.1-a — AI Agent sekmeleri + readiness check

**Status:** done  
**Dependencies:** 33.5, 33.6  

Performance/Profile/Skills/Knowledge sekme kabuğu + readiness. PRD 06.1 (Must).

**Details:**

06.1-a AI Agent sekmeleri (Performance/Profile/Skills/Knowledge) + readiness check. [XHIGH] PRD 06.1 (Must).
NEDEN AÇIK: UI Skills+Knowledge gösteriyor ama sekmeli AI Agent üst yapısı + readiness uyarısı yok.
KAPSAM: sekme kabuğu; KB/skill boşsa 'AI'ı açma' uyarısı.
KK (birebir): "Tek yerde persona+yetenek+bilgi+performans; readiness check (KB/skill boşsa açma uyarısı)".
BAĞLAM: PLAN §4.4.2. Bağımlılık: 33.5 (Profile) + 33.6 (Performance).

### 33.2. 06.2.4-a — Ordered steps: drag reorder + klavye [MAX]

**Status:** done  
**Dependencies:** None  

Reorder + klavye alternatifi (NFR-A11Y4) + zorunlu param. PRD 06.2.4 (Must).

**Details:**

06.2.4-a Ordered steps: drag reorder + klavye alternatifi. [MAX] ↑ PRD 06.2.4 · NFR-A11Y4.
↑ GEREKÇE: NFR-A11Y4 'sürükle-bırak yeniden sıralamaya klavye alternatifi' kaynakta eksik, SiyahTuş kritik — a11y
sınırı + skill sırası davranışı.
NEDEN AÇIK: adımlar var (SkillEditor.tsx) ama reorder yok (grep 0); klavye alternatifi yok.
KAPSAM: adım reorder (drag) + klavye ile taşıma (yukarı/aşağı + ARIA duyuru); zorunlu param (transfer hedefi) boşsa hata.
KK (birebir): "Her adım araç çağrısı; drag reorder (+ klavye alternatifi); zorunlu parametre (ör. transfer hedefi) boşsa hata".
BAĞLAM: PLAN §4.4.2.

### 33.3. 06.3.1-a — Knowledge alt sekmeler

**Status:** done  
**Dependencies:** None  

All/Websites/Files/Articles/FAQ tür filtre. PRD 06.3.1 (Must).

**Details:**

06.3.1-a Knowledge alt sekmeler (All/Websites/Files/Articles/FAQ). [XHIGH] PRD 06.3.1 (Must).
KAPSAM: tür bazlı filtre sekmeleri (KnowledgeSource.type).
KK (birebir): "Tür bazlı filtre". BAĞLAM: PLAN §4.4.2.

### 33.4. 06.3.2-a — KB website crawl + SSRF [MAX]

**Status:** done  
**Dependencies:** None  

Website crawl+parse + geçersiz URL/tür reddi + SSRF guard. PRD 06.3.2 (Must).

**Details:**

06.3.2-a + New source: Website crawl + geçersiz URL/tür reddi. [MAX] ↑ PRD 06.3.2 · NFR-S7-benzeri.
↑ GEREKÇE: dış URL çekme = SSRF yüzeyi (private/loopback reddi, redirect kapalı) — 08.8.4 ile aynı sınır.
NEDEN AÇIK: POST /knowledge-sources yalnız verilen content'i indeksliyor (routes/playbook.ts:340); website crawl yok.
KAPSAM: Website türü için crawl+parse (mock fetcher, deterministik) → chunk+embedding; geçersiz URL/tür reddi;
SSRF guard (private/loopback/link-local reddi). ORTAK: lib/ssrf.ts 08.8.4-c ile paylaşılır.
KK (birebir): "Geçersiz URL/tür reddi; crawl/parse; RAG indeksleme; bulk/CSV import (SiyahTuş)".
KAPSAM DIŞI: bulk/CSV (ayrı Should). BAĞLAM: PLAN §4.4.2, §7.2 S7.

### 33.5. 06.4-a — Profile (persona) UI + preview

**Status:** done  
**Dependencies:** None  

Name/Avatar/Tone/Language/Answer length → PATCH; canlı preview. PRD 06.4 (Must).

**Details:**

06.4-a Profile (persona: Name/Avatar/Tone/Language/Answer length) UI + canlı preview. [XHIGH] PRD 06.4 (Must).
NEDEN AÇIK: AiAgent şemasında persona/tone/languages/name/avatarUrl var, PATCH /ai-agents/:aiAgentId served
(playbook.ts:110); Profile düzenleme UI'ı yok (yalnız okunuyor).
KAPSAM: Profile formu (isim zorunlu, avatar, tone, language çoklu, answer length) → PATCH; canlı preview;
widget persona'ya bağlanır (11.3 ✅).
KK (birebir): "Widget'ta persona görünür; çok dilli; zorunlu isim".
BAĞLAM: PLAN §4.4.2. Bağımlılık: form deseni (tm 29).

### 33.6. 06.5-a — AI Performance KPI

**Status:** done  
**Dependencies:** None  

Resolution/CSAT/Transferred + düşük-baz uyarısı. PRD 06.5 (Should).

**Details:**

06.5-a Performance (Resolution/AI chats/CSAT/Transferred %) + düşük-baz uyarısı. [XHIGH] PRD 06.5 (Should).
KAPSAM: KPI kartları (mevcut reports sorgularından, ADR-09); düşük-baz uyarısı; AI-off arşiv ayrımı.
KK (birebir): "KPI kartları; düşük-baz uyarısı; AI off iken arşiv ayrımı".
BAĞLAM: PLAN §4.4.2. tm 44 (07.4-a) ile paylaşımlı sorgu.
