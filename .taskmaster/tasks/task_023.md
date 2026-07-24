# Task ID: 23

**Title:** S12 — audit_log yazicisi (append-only olay yazimi) [MAX]

**Status:** pending

**Dependencies:** None

**Priority:** high

**Description:** `audit_log` tablosu + RLS policy Dilim 12'de kuruldu (schema.prisma:911 AuditLogEntry, @@map audit_log) ama HICBIR olay INSERT edilmiyor — yazici yok (§D16). PRD NFR S12 append-only denetim izi istiyor. Guvenlik-hassas eylemlerde olay yaz. Sema DEGISMEZ.

**Details:**

1) Olay kumesi (append-only): login basari/basarisiz, parola sifirlama, rol/uyelik degisikligi, ayar degisiklikleri (security/routing/billing), PAT olustur/iptal, trusted domain degisikligi. PRD S12.
2) Merkezi yazici: apps/api/src icinde writeAuditEntry(ctx, action, target, meta); withTenant/RLS uyumlu; append-only (UPDATE/DELETE policy ile reddedildigini dogrula). Ilgili route handler'larina cagri ekle.
3) Alanlar: actor, tenant, action, target, request_id (server.ts mevcut); PII minimizasyonu (parola/deger YAZMA).
4) Okuma/export UI KAPSAM DISI (v1) — bu task yalniz YAZICI.
PRD: NFR S12 · PLAN.md §7.2 · §D16.

**Test Strategy:**

DoD kapisi + guvenlik. Her guvenlik eyleminde tam 1 append (integration); append-only ihlali (UPDATE/DELETE) reddi; cross-tenant gorunmezlik (negatif test ZORUNLU); PII sizmadigi. Efor [MAX] — tamper-direnci/append-only dogrulugu kritik. Bitince PLAN.md §7.2 S12 ⬜→✅ ve §D16 kapatildi olarak guncellenir.

## Subtasks

### 23.1. Olay kumesi + alan sozlesmesi

**Status:** pending  
**Dependencies:** None  

actor/tenant/action/target/request_id; PII-min; hangi eylemler yazilir.

### 23.2. Merkezi writeAuditEntry (withTenant/RLS, append-only dogrula)

**Status:** pending  
**Dependencies:** 23.1  

Tek giris noktasi; UPDATE/DELETE policy reddini dogrula.

### 23.3. Guvenlik-hassas handler'lara cagri ekle

**Status:** pending  
**Dependencies:** 23.2  

auth/settings/billing/PAT/trusted-domains handler'larinda writeAuditEntry cagrilari.

### 23.4. Testler: integration (append/eylem, append-only red, cross-tenant) + unit

**Status:** pending  
**Dependencies:** 23.3  

Her eylemde 1 append; UPDATE/DELETE red; cross-tenant negatif; PII yok.
