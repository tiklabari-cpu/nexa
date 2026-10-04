# Task ID: 182

**Title:** M-CO — Sirket bilgileri (FR-MOD-08.3) — semada, ucta ve konsolda hic yok

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** Denetimde YOK cikti ve onceligi Onemli. `Organization` modelinde yalnizca `name` + `region` var (schema.prisma:29-43); sektor/adres/saat dilimi alani yok, `/settings/company` benzeri uc yok (settings.ts teki 46 route un hicbiri sirket bilgisi yazmiyor), web tarafinda boyle bir bolum yok.

**Details:**

PRD satır **594-659** (FR-MOD-08.3) · denetim `prd-uyum-denetimi.md` §6 (YOK listesi).

**Saat dilimi çakışması — asıl dikkat noktası:** çalışma saatleri özelliği (`WorkSchedule`, `work_schedule.updated` audit eylemi) zaten bir saat dilimi taşıyor. Şirket saat dilimi ile ajan/çalışma saati saat dilimi çakışmamalı — hangisi hangisini besliyor? İki ayrı doğruluk kaynağı olursa raporlar sessizce kayar.

**Test Strategy:**

`db:check-drift` exit 0. Kaydet → geri oku; scope reddi; cross-tenant izolasyon; **çalışma saatleri bu saat dilimini kullanıyor** (iki kaynak kararının testi). e2e + `kanit/08.3-company.png`. PLAN.md 08.3 satırı ⬜ → ✅.

## Subtasks

### 182.1. M-CO-a [SONNET-XHIGH] Organization şema alanları + migration + GET/PATCH /settings/company

**Status:** done  
**Dependencies:** None  

Sektör / adres / saat dilimi. Sektör serbest metin mi kapalı liste mi — kapalı liste raporlanabilir ama esnek değil, kararını yorumla. Kontrat + `contract:generate` + generated senkron. Scope mevcut ayar uçlarıyla tutarlı.

**Details:**

Bağımlılık: yok. Dilim V7-3. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.

### 182.2. M-CO-b [OPUS-XHIGH] Ayarlar ekranı bölümü + saat dilimi tek doğruluk kaynağı kararı

**Status:** done  
**Dependencies:** None  

Şirket saat dilimi ile çalışma saatleri saat dilimi arasındaki ilişkiyi karara bağla, yorumla ve **teste bağla**. `lib/form.tsx` (M-UI-f/g merge olduysa doğrudan ortak kütüphaneyle yaz); i18n en+tr; a11y rota listesi.

**Details:**

Bağımlılık: M-CO-a. Dilim V7-3. Pencere protokolü: `TASK-RUNNER-PROMPT.md` (bootstrap → resume → build → doğrulama → kapanış); DoD kapısı `CONVENTIONS.md` §1. Etiket = model × efor, PLAN §5.1.1.
