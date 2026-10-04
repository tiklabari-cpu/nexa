# Task ID: 89

**Title:** e2e determinizm: Date.now() mesaj metinleri cc-mask (08.9.5) ile çakışıyor

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** GL-5 (tm 70) cc-masking sonrası birkaç e2e spec bayat: ziyaretçi/ajan mesaj metnine gömülü çıplak `Date.now()` (13 hane) Luhn-geçerli olduğunda `**** **** **** NNNN` olarak maskeleniyor → `toContainText(rawText)` zaman zaman kırılıyor. tm 68'de demo-flow.spec.ts düzeltildi (question/answer/note → `.slice(-6)`). KALAN aynı desen: customers.spec.ts:101, traffic.spec.ts:23, settings.spec.ts:307/324, widget.spec.ts:120/153. ÇÖZÜM: bu spec'lerdeki mesaj-metni benzersizlik jetonlarını 13-hane cc-mask penceresinin altına indir (ör. `Date.now().toString().slice(-6)`) — URL/domain alanındakiler (ai-agent:80, onboarding:62) maskelenmediği için DOKUNMA. DoD: full e2e süiti deterministik yeşil.

**Details:**

No details provided.

**Test Strategy:**

No test strategy provided.
