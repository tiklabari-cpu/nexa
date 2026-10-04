# Task ID: 180

**Title:** M-READY — AI Agent readiness mantigi — operator ters, active bayragi hic okunmuyor

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** PRD KK4: "Knowledge bos VEYA hic aktif skill yokken uyari gosterilir". Kod: `const ready = hasKnowledge || hasSkill` (readiness.ts:42) — uyari YALNIZ ikisi birden bosken cikiyor; bilgi tabani dolu ama hic skill yokken AI Agent "hazir" gorunuyor. Ayrica `hasSkill = skills.some(hasSteps)` (:41) "aktif" bayragini hic okumuyor.

**Details:**

PRD satır **562-578** (FR-MOD-06.1, KK4) · denetim `prd-uyum-denetimi.md` §3 D8.

İkinci kusur (`active` okunmuyor) denetim raporunda YOK — kodu okurken doğrulamada çıktı. İkisi birden düzeltilmezse madde yine yarım kalır.

`apps/web/src/features/playbook/readiness.ts` — dosya küçük, kusur iki satır. Asıl iş testleri PRD kriterine göre yazmak.

**Test Strategy:**

Beş senaryo: yalnız knowledge → hazır DEĞİL; yalnız skill → hazır DEĞİL; ikisi → hazır; **adımı olan ama pasif skill hazır saymaz**; ikisi de boş → hazır değil. `readiness.test.ts` şu an YANLIŞ davranışı kilitliyor olabilir — mevcut iddiaları körü körüne koruma, PRD kriterine göre yeniden yaz.

## Subtasks

### 180.1. M-READY-a [SONNET-XHIGH] Operatörü çevir (|| → &&) + active bayrağını oku + testleri PRD kriterine göre yeniden yaz

**Status:** done  
**Dependencies:** None  

Uyarı koşulu `!hasKnowledge || !hasSkill`, yani `ready = hasKnowledge && hasSkill`. `hasSkill` = `hasSteps(s) && s.active`. AI Agent ekranında uyarının göründüğü bileşen testi. PLAN.md 06.1 satırı.

**Details:**

Bağımlılık: yok. Dilim V7-2. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.
