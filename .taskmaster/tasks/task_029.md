# Task ID: 29

**Title:** EK-A — Form & girdi katmanı (validasyon + davranış)

**Status:** done

**Dependencies:** None

**Priority:** high

**Description:** Frontend form validasyonu elle; ortak kütüphane/desen yok (denetim). Must (MVP).

**Details:**

ÜST GÖREV (parent). EK-A Form & girdi katmanı — Must (MVP), Faz-0 ◐ (EK-A.1 + EK-A.2).
Üç subtask: 29.1 (primitif+pilot) → 29.2 (kalan formlar) + 29.3 (davranış). 29.2 ve 29.3 29.1'e bağımlı.
Denetim: web'de 0 zod importu — frontend form validasyonu elle (backend zod ✅, bu iş FRONTEND).
Her subtask kendi DoD+KK kapısından geçer. Bağlam: PLAN.md §3.13/T4,T5.

**Test Strategy:**

Subtask bazlı; parent 29.1+29.2+29.3 yeşil olunca done.

## Subtasks

### 29.1. T4-a — Ortak form-validasyon primitifi + 2 pilot form

**Status:** done  
**Dependencies:** None  

Tek doğrulama primitifi + alan-altı hata + submit-disabled; pilot Invite + Add website. FR-EK-A.1.

**Details:**

T4-a — Ortak form-validasyon primitifi + pilot iki form. [XHIGH]
PRD: FR-EK-A.1.
NEDEN AÇIK: apps/web/src içinde form validasyonu her ekranda elle; alan-altı hata / submit-disabled deseni
tekrar ediyor, tek kaynak yok. (Backend zod ✅ 18 dosya — bu iş FRONTEND.)
KAPSAM: tek doğrulama primitifi (hafif hook/şema; `zod` zaten pnpm-lock'ta, frontend'e import edilebilir) +
alan-altı hata + geçersizken submit pasif + Error/Disabled/Loading. PİLOT: Invite teammates
(features/team/InviteTeammates.tsx) + Add website (features/settings/WebsiteWidgets.tsx).
KK (PRD birebir): "Tek form/validasyon kütüphanesi; alan-altı hata mesajı".
KAPSAM DIŞI: kalan formların migrasyonu (29.2/T4-b); Forms builder (08.7.7, v1).
BAĞLAM: PLAN.md §3.13/T4-a. Bağımlılık: yok. (29.2, 29.3 + v1 form görevleri 47/50/51/52/43 bu desene dayanır.)

### 29.2. T4-b — Kalan Must formlarını primitife taşı

**Status:** done  
**Dependencies:** 29.1  

Signup/Reset/New canned/New tag/Payment/Channels formları. FR-EK-A.1.

**Details:**

T4-b — Kalan Must formlarını primitife taşı. [XHIGH]
PRD: FR-EK-A.1.
NEDEN AÇIK: 29.1 yalnız 2 pilot; kalan Must formlar (Signup, Reset, New canned, New tag, Payment mock,
Channels ekle) hâlâ elle.
KAPSAM: kalan formları 29.1 primitifine taşı; her birinde alan-altı hata + submit-disabled.
KK (PRD birebir): "Tek form/validasyon kütüphanesi; alan-altı hata mesajı".
KAPSAM DIŞI: v1 formları (Forms builder, Custom fields — ayrı görevler).
BAĞLAM: PLAN.md §3.13/T4-b. Bağımlılık: 29.1 (T4-a primitif). Tahmin 1-2 pencere — çok form; 2+ ise böl.

### 29.3. T5-a — Yarım-form kapatma onayı + ortak davranış

**Status:** done  
**Dependencies:** 29.1  

Dirty guard + dropdown/stepper/optimistic tekilleştirme. FR-EK-A.2.

**Details:**

T5-a — Yarım-form kapatma onayı + ortak dropdown/stepper/optimistic birleştirme. [XHIGH]
PRD: FR-EK-A.2.
NEDEN AÇIK: debounce/stepper/optimistic toggle dağınık uygulanmış; YARIM-FORM KAPATMA ONAYI (kirli formu
kapatırken uyar) hiçbir modalda yok.
KAPSAM: ortak "dirty guard" (kirli form kapatma → onay); ortak dropdown/stepper davranış sarmalayıcı;
optimistic + hata geri alma desenini tekilleştir.
KK (PRD birebir): "Tutarlı davranış; optimistic + hata geri alma".
KAPSAM DIŞI: yeni ekranlar; drag-reorder (06.2.4, v1).
BAĞLAM: PLAN.md §3.13/T5-a. Bağımlılık: 29.1 (aynı form katmanı; sıra 29.1 → 29.3).
