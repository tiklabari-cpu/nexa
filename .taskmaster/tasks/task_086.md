# Task ID: 86

**Title:** GL-2 · PARK-a — .parked-playbook/ temizliği (izlenmeyen yarım iş)

**Status:** done

**Dependencies:** None

**Priority:** medium

**Description:** .parked-playbook/ (SkillBrowser.tsx, RecommendedSkills.tsx, skill-filters.ts + 3 test dosyası; 25 Tem) izlenmeyen yarım iş olarak duruyor (HANDOFF 'parked' notu). Teslim edilen muadilleri repo'da mevcut: TemplateGallery.tsx, RecommendedSkills.tsx, skill-tabs.ts, skill-filter.ts (tm 32, PLAN §4.1 hepsi ✅). F.1/6 'sessiz borç' ve F.1/7 'ölü kod' maddelerini kirletir — Faz-0 kapanışından (tm 87) ÖNCE çözülmeli. PLAN §4.5/GL-2 · §D52.

**Details:**

1) Dosya-dosya diff: .parked-playbook/RecommendedSkills.tsx ↔ apps/web/src/features/playbook/RecommendedSkills.tsx; .parked-playbook/skill-filters.ts ↔ skill-filter.ts + skill-tabs.ts; .parked-playbook/SkillBrowser.tsx ↔ TemplateGallery.tsx/PlaybookPage.tsx (muadil eşlemesi burada en zayıf — dikkatli bak).
2) KARAR: değerli fark varsa (teslim edilende olmayan davranış/test) ilgili dosyaya taşı + test yeşil; yoksa dizini SİL. Karar gerekçesiyle PLAN §D'ye yazılır (D-PARK maddesi).
3) Sonuç: git status temiz (untracked 0); HANDOFF'taki 'Kalan tek untracked öğe .parked-playbook/' notu kapatılır.
PLAN §4.5/GL-2 · §D52 · HANDOFF 2026-07-28 notu.

**Test Strategy:**

Silme yolunda: repo temiz (git status untracked 0), web unit regresyonsuz. Entegre yolunda: taşınan davranışın testi + web typecheck/lint/unit yeşil. KAPANIŞ: karar §D'ye (D-PARK) + HANDOFF task log + commit + push + tm 86 done.

## Subtasks

### 86.1. Diff + karar

**Status:** done  
**Dependencies:** None  

Üç kaynak dosyayı teslim edilen muadillerle karşılaştır; entegre-et/sil kararını gerekçesiyle ver.

### 86.2. Uygulama + kapanış

**Status:** done  
**Dependencies:** 86.1  

Kararı uygula (taşı+test veya sil); git status temiz; §D + HANDOFF + commit + push.
