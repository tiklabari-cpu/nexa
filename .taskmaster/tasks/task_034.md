# Task ID: 34

**Title:** 08.8.4 — Webhooks [MAX]

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** webhooks tablosu + scope var, route/servis yok. En yüksek güvenlik yüzeyi. PRD 08.8.4 (v1, Must).

**Details:**

PARENT [MAX]. 08.8.4 Webhooks — en yüksek güvenlik yüzeyi (NFR-S7, R1/R2). webhooks tablosu +
webhooks--all:rw scope (principal.ts:107) var, route/servis YOK. 4 subtask; negatif testler pozitiften ÖNCE.
Bağlam: PLAN §4.4.3, §7.2 S7.

**Test Strategy:**

Subtask bazlı; -b/-c [MAX] negatif-önce.

## Subtasks

### 34.1. 08.8.4-a — Webhook kayıt API + kontrat

**Status:** done  
**Dependencies:** None  

register/list/unregister; secret bir kez. PRD 08.8.4.

**Details:**

08.8.4-a Webhook kayıt API + kontrat (register/list/unregister). [XHIGH] PRD 08.8.4.
KAPSAM: kontrat → POST/GET/DELETE /webhooks; secret üretimi (bir kez gösterilir, hash saklanır).
KK payı (birebir): "register/list/unregister" · "secret log'a yazılmaz". BAĞLAM: PLAN §4.4.3.

### 34.2. 08.8.4-b — HMAC-SHA256 imzalama [MAX]

**Status:** done  
**Dependencies:** 34.1  

X-Webhook-Signature + timestamp/nonce + timingSafeEqual. NFR-S7.

**Details:**

08.8.4-b HMAC-SHA256 imzalama + timestamp/nonce. [MAX] PRD 08.8.4 · NFR-S7.
KAPSAM: çıkışta X-Webhook-Signature = HMAC-SHA256(secret, timestamp+body); ±5 dk; nonce; timingSafeEqual; secret log'a YAZILMAZ.
KK payı (birebir): "HMAC-SHA256 imza (SiyahTuş) + timestamp/nonce". BAĞLAM: PLAN §4.4.3. Bağımlılık: 34.1.

### 34.3. 08.8.4-c — SSRF koruması [MAX]

**Status:** done  
**Dependencies:** 34.1  

private/loopback/link-local reddi; redirect kapalı; http(s). NFR-S7. Negatif önce.

**Details:**

08.8.4-c SSRF koruması. [MAX] PRD 08.8.4 · NFR-S7.
KAPSAM: hedef URL doğrulama — private/loopback/link-local IP reddi, DNS-rebinding koruması, redirect kapalı, yalnız http(s).
ORTAK: lib/ssrf.ts 06.3.2-a ile paylaşılır.
KK payı (birebir): "SSRF koruması". BAĞLAM: PLAN §4.4.3. Bağımlılık: 34.1.

### 34.4. 08.8.4-d — Teslimat + retry 3× + log

**Status:** done  
**Dependencies:** 34.1, 34.2, 34.3  

Kuyruk + 3× retry + her teslimat loglanır. NFR-M5/U4.

**Details:**

08.8.4-d Teslimat + retry (3×) + her teslimat/retry loglanır. [XHIGH] PRD 08.8.4 · NFR-M5/U4.
KAPSAM: olay → kuyruk → teslim; 3× exponential retry; her deneme loglanır; kalıcı hata işaretlenir.
KK payı (birebir): "retry (3×)" · (NFR-M5) "her webhook teslimi/retry loglanır". BAĞLAM: PLAN §4.4.3. Bağımlılık: 34.1/2/3.
