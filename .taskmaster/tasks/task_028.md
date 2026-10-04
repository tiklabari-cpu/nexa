# Task ID: 28

**Title:** 01.3 — Sağ panel switcher (Details/Expand + persist)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Sağ panel aç/kapa + Expand + tercih persist. Copilot sekmesi v1'e ayrıldı (§D22). PRD FR-MOD-01.3.

**Details:**

01.3 — Sağ panel switcher (Details/Expand + persist). [XHIGH] · Must (MVP), Faz-0 ◐.
PRD: FR-MOD-01.3.
NEDEN AÇIK: Details paneli InboxPage.tsx'te her zaman görünür; panel anahtarı (aç/kapa), Expand (geniş
transcript) ve tercih kalıcılığı yok. Copilot sekmesi ⬜ ama o MOD-12 = v1 (§D22 daraltma).
KAPSAM: sağ panel toggle + Expand modu (transcript tam genişlik) + tercih localStorage/hesap tercihinde persist.
KK (PRD birebir): "Panel açılır/kapanır; Details/Copilot geçişi persist" → MVP payında Details/Expand geçişi
persist (Copilot v1'e ayrıldı, §D22).
KAPSAM DIŞI: Copilot sekmesi/paneli (12.1-12.3, v1 tm 36); reply suggestions.
BAĞLAM: PLAN.md §3.13/T1-a, §D22. Bağımlılık: yok. (12.1-a bu görevin üstüne oturur → tm 36 buna bağımlı.)

**Test Strategy:**

unit: toggle + Expand + reload sonrası tercih korunur. E2E: panel aç/kapa. DoD kapısı tam.
