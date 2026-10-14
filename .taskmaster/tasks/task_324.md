# Task ID: 324

**Title:** ROLE-SET-TEAM-LEAD [OPUS-MAX] (Opus 5.5) Rol seti (K6): Kurucu=owner, Yönetici=admin, Ekip Lideri=team_lead (yeni), Ekip Üyesi=agent; ekip liderliği (group_agents.is_lead); viceowner → admin taşıması; davette team_lead + ekip seçimi

**Status:** pending

**Dependencies:** 281 ⏱

**Priority:** high

**Description:** Bugün owner > viceowner > admin > agent; viceowner ile admin aynı yetki seti; Ekip Lideri yok — lider ya her şeye yetkili Yönetici yapılıyor ya da hiçbir şeyi izleyemeyen ajan kalıyor. AI dört göz (AI-20) ve QA (AI-24) bunsuz kurulamaz. K6: vice owner yeni atamalarda sunulmaz, mevcutlar Yönetici'ye taşınır. Kaynak: RL-01, RL-04.

**Details:**

KAYNAK: SiyahTus-Analiz 03-eklenebilecekler.md / 04-gerekceler-ve-sorular.md (Karar kaydı K1–K27 ve "Kararların maddelere etkisi" madde içi varsayılanların önüne geçer) / 05-uygulama-rehberi.md — maddeler: RL-01, RL-04. Eşleme: SiyahTus-Analiz/07-gorev-plani.md.
TERİM EŞLEMESİ (K1=A): ekranda "Thread ID" = nexa Chat (kod/DB/API alanı chat_id, günlük kapsayıcı); ekranda "Chat ID" = nexa Thread (kod alanı thread_id, tek bağlantı). Kod adları değişmez; çeviri yalnız sunum katmanında.
SIRA (contract-first): OpenAPI (packages/contract) → pnpm contract:generate (@siyahtus/types) → Prisma migration (genişlet → taşı → daralt; CONCURRENTLY kendi dosyasında tek ifade) → API servis + birim test → RTM → web/widget/mobil → entegrasyon/E2E.
PROTOKOL: TASK-RUNNER-PROMPT.md (bootstrap → build → verify → fix → close); CONVENTIONS.md §1 (DoD), §2 (git), §3 (HANDOFF), §5, §6.3 (migration), §7 (test başlığında gereksinim etiketi); CLAUDE.md sınırları (production/DNS/TLS/gerçek secret/kart/ödeme YOK; dış servisler mock).
NOT: 05'teki dosya:satır referansları 2026-10-14 çalışma kopyasına göredir; başlamadan önce grep ile yeniden doğrula, kayma varsa HANDOFF'a yaz.
DALGA: Dalga 4 — roller ve yetki matrisi.

[MAX] yetki çekirdeği (güvenlik incelemesi).
KOD: domain.ts:8-9 AGENT_ROLES; role-scopes.ts:20-25 ROLE_RANK, :32-80, :83-138, :148-152 defaultScopesForRole, :193-196 scopesWithinRole; agent_memberships_role_check, invitations_role_check, uq_license_single_owner; agents.ts:640-690; lifecycle-service.ts:406-413; RoleMenu.tsx (ROLE_RANK ikinci kopyası); GroupAgent schema:715-726; agents.ts:1044-1066; scim.ts:139; rtm/src/auth.ts.
types: AGENT_ROLES'a team_lead; ROLE_RANK owner 4, viceowner 3, admin 2, team_lead 1, agent 0 (sayısal rütbenin hiçbir yerde saklanmadığı doğrulanır); TEAM_LEAD_SCOPES = DEFAULT_AGENT_SCOPES + ekler (RL-02 sonrası matristen); defaultScopesForRole team_lead'i tanır.
migration (genişlet): iki CHECK'e team_lead; group_agents.is_lead BOOLEAN NOT NULL DEFAULT false + indeks (agent_id) WHERE is_lead; invitations ekip ataması (invitation_groups (invitation_id, group_id, is_lead) ya da invitations.group_ids).
viceowner → admin taşıması AYRI ve SONRAKİ migration (K6 onaylı): her taşınan üye için member.role_changed audit (via migration); geri alınamaz veri değişikliği.
contract: paths/agents.yaml rol enum + grup üyeliği lead; paths/account-lifecycle.yaml davet rol enum'u (team_lead).
api: rol değiştirme team_lead kabul; grup üyeliği lead yalnız admin+; davet akışı (RL-04-S1: team_lead seçilince ekip zorunlu, sunucu ekipsiz lider davetini reddeder; kabulde ekip üyeliği ve liderlik uygulanır); principal ve RTM rol listeleri; SCIM.
web: RoleMenu ROLE_RANK'ı @siyahtus/types'tan; Türkçe etiketler owner "Kurucu", admin "Yönetici", team_lead "Ekip Lideri", agent "Ekip Üyesi", viceowner "Yönetici (eski: Kurucu yardımcısı)"; TeamEditor "Ekip lideri" anahtarı, liste rozeti; InviteTeammates team_lead + ekip seçici (lider için zorunlu). mobile rol etiketleri; seed/fixtures'a bir Ekip Lideri.
roleAtLeast tabanlı 87 rol kapısı değişmez; team_lead admin altında → yönetici ekranlarına erişemez. Tek Kurucu kuralı değişmez.

KABUL KRİTERLERİ:
- Ekip sayfasında dört rol Türkçe adlarıyla; Yönetici bir üyeyi Ekip Lideri yapıp ekibin lideri olarak işaretleyebilir.
- Ekip Lideri faturalama, güvenlik ve AI yapılandırma ekranlarını göremez; uçlar 403 (RL-02 öncesi).
- DB tanımsız rolü reddeder.
- Mevcut owner/admin/agent davranışı regresyonda değişmez.
- Ekip Lideri davetinde ekipsiz gönder pasif; sunucu reddeder; kabulde liderlik uygulanır.
- viceowner taşıması sonrası her taşınan üye için audit satırı.

KULLANILAN VARSAYIMLAR:
- K6.
- RL-01-S2: birden çok ekibin lideri olunabilir; S3: lider sohbet karşılar, koltuk sayılır.
- RL-04-S1: lider için ekip zorunlu.

**Test Strategy:**

role-scopes birim, agents-role.test.ts (admin team_lead atar; team_lead rol değiştiremez), role-demotion.test.ts, invite testleri, e2e team.spec.ts; `pnpm test:gate`. DoD: CONVENTIONS §1 kapısı exit 0 — `pnpm test:gate` (arka planda; log son satırları), db:check-drift, contract:generate temiz, audit:req-coverage, PLAN §K kanıtı + HANDOFF bloğu.

## Subtasks

### 324.1. ROLE-TYPES-SCHEMA [OPUS-MAX] types (team_lead, ROLE_RANK), CHECK genişletme, is_lead, davet ekipleri, kontrat

**Status:** pending  
**Dependencies:** None  

Üst görev 324 ayrıntılarındaki ilgili bölüm.

### 324.2. ROLE-API-WEB [OPUS-MAX] Rol değiştirme/grup liderliği/davet/SCIM/RTM + RoleMenu/TeamEditor/InviteTeammates + mobil etiketler + seed

**Status:** pending  
**Dependencies:** 324.1  

Üst görev 324 ayrıntılarındaki ilgili bölüm.

### 324.3. ROLE-VICEOWNER-MIGRATE [OPUS-XHIGH] viceowner → admin taşıma migration'ı (ayrı, sonraki) + audit

**Status:** pending  
**Dependencies:** 324.2  

XHIGH GEREKÇESİ: (1) yetki verisi değişikliği, geri alınamaz.
