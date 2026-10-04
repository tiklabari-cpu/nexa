# Task ID: 43

**Title:** 03.3 — Campaigns [MAX]

**Status:** done

**Dependencies:** 29 ✓

**Priority:** low

**Description:** campaigns tablosu 0 tüketicili. PRD MOD-03.3 (v1, Should).

**Details:**

PARENT [MAX]. 03.3 Campaigns. campaigns tablosu 0 tüketicili (§8). 3 subtask; 03.3.2-a [MAX]
(tetik motoru + otomatik gönderim). Bağlam: PLAN §4.4.7. Bağımlılık: tm 29 (form deseni).

**Test Strategy:**

Subtask bazlı.

## Subtasks

### 43.1. 03.3.1-a — Campaigns alt sekmeler

**Status:** done  
**Dependencies:** None  

All/Ongoing/Scheduled/Inactive durum filtre. PRD 03.3.1 (Should).

**Details:**

03.3.1-a Campaigns alt sekmeler (All/Ongoing/Scheduled/Inactive). [XHIGH] PRD 03.3.1 (Should).
KAPSAM: durum bazlı filtre sekmeleri. KK (birebir): "Durum bazlı filtre". BAĞLAM: PLAN §4.4.7.

### 43.2. 03.3.2-a — New campaign builder [MAX]

**Status:** done  
**Dependencies:** 43.1  

Koşul+mesaj+zamanlama → eşleşen ziyaretçiye otomatik gönderim. PRD 03.3.2 (Should).

**Details:**

03.3.2-a New campaign builder (koşul+mesaj+zamanlama → otomatik gönderim). [MAX] ↑ PRD 03.3.2 (Should).
↑ GEREKÇE: tetikleyici motoru + eşleşen ziyaretçiye otomatik gönderim (eşzamanlılık/yanlış-tetik riski).
KAPSAM: builder (koşul+mesaj zorunlu) → kayıt sonrası eşleşen ziyaretçiye otomatik gönderim.
KK (birebir): "Tetikleyici+mesaj zorunlu; kayıt sonrası eşleşen ziyaretçiye otomatik gönderim". BAĞLAM: PLAN §4.4.7. Bağımlılık: 43.1 + tm 29.

### 43.3. 03.3.3-a — Kampanya kartı

**Status:** done  
**Dependencies:** 43.2  

Edit/View report + active toggle + performans. PRD 03.3.3 (Should).

**Details:**

03.3.3-a Kampanya kartı (Edit/View report; active toggle). [XHIGH] PRD 03.3.3 (Should).
KAPSAM: düzenleme + performans (Displayed/Chats/Conversion) + active toggle.
KK (birebir): "Düzenleme + performans (Displayed/Chats/Conversion)". BAĞLAM: PLAN §4.4.7. Bağımlılık: 43.2.
