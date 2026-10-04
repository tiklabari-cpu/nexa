# Task ID: 251

**Title:** V8-A11Y-HANG [OPUS-XHIGH] a11y.spec.ts:947 kararsiz: waitForResponse 10 sn zaman asimi + 21,6 DAKIKALIK context teardown asilmasi

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Tam suit kosu 2'de tek kirmizi buydu. Hata bir axe ihlali degil: beklenen HTTP cevabi 10 sn icinde gelmedi, ardindan context teardown'i asildi ve 45 sn'lik test timeout'unu 21,6 dakikaya tasidi -- suitin duvar saati 31,3 dk'dan 44,3 dk'ya cikti. Ayni test kosu 1'de ayni kodla YESILDI. tm 248'in diff'i (rtm sync + widget) bu yuzeye dokunmuyor. Asilan teardown, kirmizinin kendisinden daha onemli: her gelecekteki kirmizinin maliyetini ongorulemez yapiyor.

**Details:**

OLCUM (tm 248, 2026-09-12). Imza: apps/e2e/tests/a11y.spec.ts:947 ("WCAG 2.1 AA (axe) > dark theme > the skill editor has no serious or critical violations") tam suit kosu 2'de KIRMIZI dustu ve tek basina 21,6 DAKIKA surdu. Hata AXE IHLALI DEGIL:

**Test Strategy:**

No test strategy provided.
