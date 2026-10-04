# Task ID: 32

**Title:** 05 — Playbook tamamlama

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Playbook çekirdeği var (öne çekildi); şablon galerisi/sekmeler/kontroller eksik. PRD MOD-05 (v1).

**Details:**

PARENT. 05 Playbook tamamlama (öne çekilen v1 yüzeyi). Backend skill CRUD+compile+preview VAR
(routes/playbook.ts); UI PlaybookPage.tsx/SkillEditor.tsx VAR. Eksik: şablon galerisi/sekmeler/kontroller.
4 subtask; her biri DoD+KK'dan geçer. Bağlam: PLAN §4.4.1.

**Test Strategy:**

Subtask bazlı; parent tüm subtask yeşil olunca done.

## Subtasks

### 32.1. 05.1-a — Browse templates galerisi

**Status:** done  
**Dependencies:** None  

Şablon galerisi + tür seçimi → editör. PRD 05.1 (Must).

**Details:**

05.1-a Browse templates galerisi. [XHIGH] PRD 05.1 (Must).
NEDEN AÇIK: PlaybookPage.tsx'te 'Browse templates'/şablon galerisi yok (grep 0).
KAPSAM: header 'Browse templates' → şablon kartı galerisi; kart seç → skill editörüne ön-doldurulmuş açılır.
Şablonlar deterministik yerel katalog (dış servis yok).
KK (birebir): "Şablon galerisi; tür seçimi → editör".
KAPSAM DIŞI: Workspace workflow türü (⛔ ADR-14). BAĞLAM: PLAN §4.4.1.

### 32.2. 05.2-a — Recommended skills kartları

**Status:** done  
**Dependencies:** 32.1  

Try this / See more; entegrasyon uyarısı. PRD 05.2 (Should).

**Details:**

05.2-a Recommended skills kartları. [XHIGH] PRD 05.2 (Should).
KAPSAM: Prebuilt/AI/Trending kategorili kartlar; 'Try this' → şablonu kopyalayıp editöre açar; entegrasyon
gerektiren şablon uyarır.
KK (birebir): "[Try this] şablonu kopyalayıp editöre açar; entegrasyon gerektirenler uyarır".
BAĞLAM: PLAN §4.4.1. Bağımlılık: 32.1.

### 32.3. 05.3-a — Skill listesi sekmeleri (All/AI/Workspace/Drafts)

**Status:** done  
**Dependencies:** None  

AI/Workspace/Drafts ayrımı. PRD 05.3 (Must).

**Details:**

05.3-a Skill listesi sekmeleri (All/AI/Workspace/Drafts). [XHIGH] PRD 05.3 (Must).
NEDEN AÇIK: liste var ama AI/Workspace/Drafts sekme ayrımı yok.
KAPSAM: role=tablist sekmeler; AI(✦)/Workspace(⚡)/Drafts ayrımı; Skill.status/kind'dan filtre.
KK (birebir): "AI (✦) vs Workspace (⚡) vs taslak ayrımı". BAĞLAM: PLAN §4.4.1.

### 32.4. 05.4-a — Liste kontrolleri (Search/Sort/Filter)

**Status:** done  
**Dependencies:** 32.3  

Ada göre arama + tür/durum/sahip filtre. PRD 05.4 (Should).

**Details:**

05.4-a Liste kontrolleri (Search/Sort/Filter). [XHIGH] PRD 05.4 (Should).
KAPSAM: ada göre debounce arama + tür/durum/sahip filtre + sıralama.
KK (birebir): "Ada göre arama; tür/durum/sahip filtre". BAĞLAM: PLAN §4.4.1. Bağımlılık: 32.3 + form deseni (tm 29).
