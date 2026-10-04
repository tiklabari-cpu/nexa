# Task ID: 36

**Title:** 12 — Copilot [MAX]

**Status:** done

**Dependencies:** 28 ✓

**Priority:** low

**Description:** Copilot api/contract'ta ~0 ref. Sağ panel switcher (28) üstüne oturur. PRD MOD-12 (v1, Should).

**Details:**

PARENT [MAX]. 12 Copilot (agent-assist). api/contract'ta ~0 ref. 12.2-a (ayrı KB [MAX]) → 12.1-a
(buton, 28/T1-a üstüne) → 12.3-a. Bağlam: PLAN §4.4.5. Bağımlılık: tm 28 (sağ panel switcher).

**Test Strategy:**

Subtask bazlı; 12.2-a izolasyon negatifleri.

## Subtasks

### 36.1. 12.2-a — Copilot ayrı KB (RAG) [MAX]

**Status:** done  
**Dependencies:** None  

/copilot/knowledge; AI Agent KB'sinden ayrı; müşteriye kapalı. PRD 12.2.

**Details:**

12.2-a Copilot ayrı bilgi tabanı (RAG, ajana-özel). [MAX] ↑ PRD 12.2 (Should).
↑ GEREKÇE: ayrı tenant-scoped KB + 'müşteriye açık değil' sınırı (yetki/izolasyon yüzeyi).
KAPSAM: /copilot/knowledge CRUD; AI Agent KB'sinden AYRI; yalnız ajan yüzeyi.
KK (birebir): "Ajana-özel bilgi kaynakları; müşteriye açık değil". BAĞLAM: PLAN §4.4.5.

### 36.2. 12.1-a — Copilot butonu + panel sekmesi

**Status:** done  
**Dependencies:** 36.1  

Sağ panel sekmesi (T1-a üstüne); Assisted metriğini besler. PRD 12.1.

**Details:**

12.1-a Copilot butonu + sağ panel sekmesi. [XHIGH] PRD 12.1 (Should).
KAPSAM: her sohbette Copilot butonu → sağ panel sekmesi (28/T1-a switcher üstüne); Assisted metriğini besler.
KK (birebir): "Panel açılır; bağlamda yardım; Assisted metriğini besler". Bağımlılık: 36.1 + tm 28.

### 36.3. 12.3-a — Özet→note + reply yardımı (+02.5)

**Status:** done  
**Dependencies:** 36.1, 36.2  

Özet internal note + reply taslak + enhance/rephrase. PRD 12.3/02.5.

**Details:**

12.3-a Özet (→internal note) + reply yardımı (enhance/rephrase). [XHIGH] PRD 12.3 · 02.5.
KAPSAM: özet internal note; reply taslak composer'a; ton/dilbilgisi geliştirme (packages/ai-mock).
KK (birebir): "Özet internal note; reply taslak composer'a; ton/dilbilgisi geliştirme". (02.5 bununla kapanır.) Bağımlılık: 36.1/36.2.
