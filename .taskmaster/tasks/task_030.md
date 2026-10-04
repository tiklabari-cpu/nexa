# Task ID: 30

**Title:** EK-B.1 — Liste katmanı (virtualization + empty state)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Listeler keyset paginate ediyor ama virtualization yok; empty state tutarsız. Must (MVP).

**Details:**

ÜST GÖREV (parent). EK-B.1 Liste katmanı — Must (MVP), Faz-0 ◐. P4 buna bağlı; P6 çoğunlukla ✅
(keyset + events RANGE partition). İki subtask: 30.1 (virtualization) → 30.2 (skeleton+empty). Her biri kendi
DoD+KK kapısından geçer. Bağlam: PLAN.md §3.13/T6, §7.2 P4/P6.

**Test Strategy:**

Subtask bazlı; parent 30.1+30.2 yeşil olunca done.

## Subtasks

### 30.1. T6-a — Virtualized liste primitifi

**Status:** done  
**Dependencies:** None  

Contacts/Teammates/Skills/Tickets; yalnız görünür satır DOM'da (NFR-P4). FR-EK-B.1.

**Details:**

T6-a — Virtualized liste primitifi (Contacts/Teammates/Skills/Tickets). [XHIGH]
PRD: FR-EK-B.1 (+ NFR-P4).
NEDEN AÇIK: listeler keyset paginate ediyor (✅) ama DOM'a tüm satırlar giriyor; virtualization yok →
10k satırda P4 (60fps) ölçülemez.
KAPSAM: tek virtualized liste primitifi; Contacts + Teammates + Skills + Tickets ona taşınır.
KK (PRD birebir, bu payı): "10.000+ satırda 60fps; ... yalnız görünür satır DOM'da".
KAPSAM DIŞI: skeleton + empty state (30.2/T6-b); Apps/Campaigns/Knowledge gridleri (v1).
BAĞLAM: PLAN.md §3.13/T6-a, §7.2 P4. Bağımlılık: yok. (40 Tickets grid + 53 Apps buna dayanır.)

### 30.2. T6-b — Skeleton + anlamlı empty state deseni

**Status:** done  
**Dependencies:** 30.1  

Boş dikdörtgen yerine anlamlı empty state; skeleton. FR-EK-B.1.

**Details:**

T6-b — Skeleton + anlamlı empty state deseni (tüm Must listeler). [XHIGH]
PRD: FR-EK-B.1.
NEDEN AÇIK: empty state tutarsız (kimi liste boş dikdörtgen); skeleton kısmi.
KAPSAM: ortak skeleton + "anlamlı empty state" bileşeni; Must listelerine uygulanır (Contacts/Teammates/
Tickets/Inbox listeleri).
KK (PRD birebir): "...skeleton; her boş liste için anlamlı empty state (boş dikdörtgen yok)".
KAPSAM DIŞI: v1 gridleri.
BAĞLAM: PLAN.md §3.13/T6-b. Bağımlılık: 30.1 (aynı liste primitifi).
