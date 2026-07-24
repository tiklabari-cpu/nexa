# Task ID: 11

**Title:** 11.3 — Agent identity / persona

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** PLAN.md 3.9: bot kimligi Dilim 6'da geldi, eksik olan persona (ad/avatar). PRD FR-MOD-06.4 persona alanlarini tanimliyor (Name/Avatar/Tone/Language) ama o Must(v1); MVP payi yalnizca musterinin kiminle konustugunu gormesi.

**Details:**

MVP kapsami dar tut: ad + avatar widget'ta gorunur. Tone/Language/Answer length v1'e ait, buraya cekilmez. Greeting (gorev 12) bunu gosterdigi icin once bu biter.

PRD: FR-MOD-11.3 (kaynak FR-MOD-06.4) · PLAN.md §3.9 · Dilim 13

[günlük 2026-07-24 13:13 UTC] plan: Agent identity/persona (11.3). MVP DAR: musteri widget'ta kiminle konustugunu (ad+avatar) gorur; PRD KK3 -> baslikta. Tone/Language/Answer length YOK (kapsam korumasi). (1) customer.ts GET /customer/chat: responder cozumu -> thread.assigneeId varsa Account{name,avatarUrl} (insan onceligi), yoksa aktif AiAgent{name,avatarUrl} (seed 'Ada'); state'e agent:{name,avatar_url}|null ekle. (2) kontrat customer-chat CustomerChatState'e agent alani; generate. (3) widget api.ts WidgetState.agent; widget.ts header avatar(img url varsa, yoksa bas harf) + ad, yoksa 'Chat with us'. (4) customer-chat.test.ts: aktif AI -> agent.name='Ada'; assignee atanmis -> insan adi. E2E: widget baslikta persona adi gorunur + kanit/11-*.png. Veri hazir: Account.name/avatarUrl, AiAgent.name/avatarUrl. Duzenleme UI YOK (sadece gorunur).

[günlük 2026-07-24 13:26 UTC] bitti: Agent identity/persona (11.3). Sunucu: customer.ts GET /customer/chat responder cozumu -> thread.assigneeId varsa Account{name,avatarUrl} (insan onceligi), yoksa aktif AiAgent kind='ai_agent' (copilot HARIC!) orderBy createdAt asc -> state.agent:{name,avatar_url}|null. Kontrat CustomerChatState.agent eklendi + generate. Widget: WidgetState.agent; header avatar (img url varsa, yoksa bas harf) + ad, yoksa 'Chat with us'; renderHeader connect/refresh'te. KAPSAM: sadece ad+avatar; Tone/Language/Answer length EKLENMEDI. Testler: api 481 (customer-chat +5: aktif AI adi, atanmis insan adi, insan>AI onceligi, ikisi de yoksa null, cross-tenant AI sizmaz), e2e 28 (widget baslikta 'Ada'). KESIF/DUZELTME: (1) db:reset AI guardrail'ine takildi -> yapilmadi; (2) customer-chat vitest resetDatabase demo verisini truncate etti -> db:seed ile geri (seed taze tenant kurdugu icin AiAgent drift'i de cozuldu); (3) seed 2 aktif AI (Ada kind ai_agent + Copilot kind copilot) -> findFirst nondeterministik olurdu, kind='ai_agent' filtresi + orderBy eklendi. Kanit: kanit/11-persona-header.png (avatar 'A' + 'Ada'). Demo seed geri, login OK.

**Test Strategy:**

Kabul: musteri widget'ta agent adini ve avatarini gorur. KAPSAM TESTI: Tone/Language/Answer length MVP'de YOK — eklenmisse kapsam kaymasidir ve §D'ye yazilir.
