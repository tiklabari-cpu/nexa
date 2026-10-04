# Task ID: 27

**Title:** 02.4 — Details paneli ziyaret bilgisi

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Inbox Details panelinde eksik olan Visited pages + Visit info (denetim §D19). Must (MVP).

**Details:**

ÜST GÖREV (parent). 02.4 Details paneli ziyaret bilgisi — Must (MVP), Faz-0 kapanışını bloklayan ◐ (§D19).
Iki subtask sırayla: 27.1 (kontrat+backend) → 27.2 (UI). Her subtask kendi DoD kapısından TEK TEK geçer.
Denetim bulgusu: DetailsPanel.tsx yalnız Chat info/Tags/Teams gösteriyor; Visited pages + Visit info YOK.
Bağlam: PLAN.md §3.13/T3, §D19, §C-A10. Kapanış: her iki subtask ✅ olunca parent done.

**Test Strategy:**

Alt-görev bazlı; parent ancak 27.1+27.2 DoD+KK yeşil olunca done.

## Subtasks

### 27.1. T3-a — getChat yanıtına ziyaret bilgisi (kontrat+backend)

**Status:** done  
**Dependencies:** None  

ChatDetail yanıtına visited_pages + visit_info (device/referrer/duration/ip). Contract-first. PRD FR-MOD-02.4.

**Details:**

T3-a — getChat yanıtına ziyaret bilgisi (kontrat + backend). [XHIGH]
PRD: FR-MOD-02.4.1-.6 (+ NFR-S5 IDOR: ziyaret verisi tenant-scoped).
NEDEN AÇIK: getChat (packages/contract/openapi/paths/chats.yaml) yanıtı ziyaret bilgisi taşımıyor. Veri VAR:
`Visit` şeması (openapi.yaml:886 civarı: referrer/pages/avg_duration), `visits` tablosu widget'tan doluyor,
`getCustomer` okuyor — ama chat yüzeyine bağlı değil.
KAPSAM (contract-first): (1) kontrat — ChatDetail yanıtına `visitor` bloğu: visited_pages[] + visit_info
{device, referrer, duration_seconds, ip}; `pnpm --filter @siyahtus/contract generate`. (2) backend — chat-service/
customer-service müşterinin son ziyaretini chat'e bağlar (apps/api/src/services/chat + customers).
KK (PRD birebir): "Bölümler katlanır; tag/assignee anında kaydeder; süre/ziyaret canlı".
KK-TÜRETİLMİŞ (§C-A10): gösterilecek alanlar (Visited pages; Device/Referring/Duration/IP) PRD Açıklama
sütunundan türetildi.
KAPSAM DIŞI: canlı süre WS push (T3-b UI hesaplar); 13.2 Engage 360° panel (v2); IP coğrafi çözümleme.
BAĞLAM: PLAN.md §3.13/T3-a, §D19, §C-A10, ADR-04 (resource-based REST). Bağımlılık: yok (visits zaten yazılıyor).

### 27.2. T3-b — Details panelinde Visited pages + Visit info (UI)

**Status:** done  
**Dependencies:** 27.1  

DetailsPanel.tsx'e iki katlanır bölüm. Veri T3-a'dan. PRD FR-MOD-02.4.

**Details:**

T3-b — Details panelinde Visited pages + Visit info bölümleri (UI). [XHIGH]
PRD: FR-MOD-02.4.1-.6.
NEDEN AÇIK: apps/web/src/features/inbox/DetailsPanel.tsx yalnız Conversation (Status/Chat ID/Assignee/Queue/
Started) + Tags + Teams render ediyor (§D19).
KAPSAM: iki katlanır `<Section>` daha — "Visited pages" (sıralı liste) + "Visit info" (Device/Referring/
Duration/IP satırları); veri T3-a'dan (getChat). Ziyaret yoksa anlamlı empty state (boş dikdörtgen değil).
KK (PRD birebir): "Bölümler katlanır; tag/assignee anında kaydeder; süre/ziyaret canlı".
KAPSAM DIŞI: harita; IP coğrafi; canlı ziyaretçi akışı (03.1.x, v1).
BAĞLAM: PLAN.md §3.13/T3-b. Bağımlılık: 27.1 (T3-a veri yolu) — ÖNCE o biter.
