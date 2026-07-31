# PLAN.md — Nexa Geliştirme Planı

> **Bu plan `urun-gereksinim-dokumani-PRD.md`'nin izdüşümüdür.**
> İş kırılımı PRD'nin kendi başlıklarını (§5 fazlar → §6 `FR-MOD` modülleri → §7 NFR → §8 veri)
> birebir takip eder. Her iş kaleminin bir PRD kimliği vardır; kimliksiz iş yapılmaz.
>
> Şema doğruluk kaynağı: PRD §8.4 + `rapor-2-teknik-mimari.md` §5.3.
> `LiveChat_ER_Diyagram.mermaid` KULLANILMAZ (çelişkili — bkz. yeterlilik değerlendirmesi G8).

**Başlangıç:** 2026-07-22 · **Son denetim:** 2026-07-25 (kapsam) · **Kapsam denetimi + kırılım:** 2026-07-25 (PLAN-EXPAND) · **GO-LIVE kırılımı:** 2026-07-28 (§4.5 · §D52 · tm 85–88 + 68/69/70)

> **Bu turda (2026-07-25) PLAN, PRD §6'nın 138 `FR-MOD` satırına ve KODA karşı yeniden
> denetlendi.** İki `✅` iddiası koda karşı **`◐`** çıktı (02.4 Details ziyaret bilgisi, 13.8
> e-posta bildirimi — bkz. §D19/§D20). Faz kapanışı artık **sayaca** bağlı (§F.00): bir faz
> ancak `Must` kapsamında `0 ◐` ve `0 ⬜` kaldığında kapanır. Kalan işin atomik kırılımı §3.13
> (Faz-0) + §4.4 (v1) + §G (düz dizin) altındadır.

| Faz                | PRD  | Genel durum                          | **Must sayacı (§F.00 kapısı)** | Kapanış |
| ------------------ | ---- | ------------------------------------ | ------------------------------ | :-----: |
| **Faz 0 — MVP**    | §5.1 | 54 ✅ · 0 ◐ (§3) · gruplu-🔒 v1'e    | **45 ✅ · 6 ◐ · 0 ⬜**          | ❌ AÇIK  |
| Faz 1 — v1         | §5.2 | kısmen (Playbook/AI öne çekildi §1.3) | denetlendi §4 — çoğu ⬜/◐       | ❌ AÇIK  |
| Faz 2 — v2         | §5.3 | ⬜ başlanmadı                         | —                              |    —    |
| Faz 3 — Enterprise | §5.4 | ⬜ başlanmadı                         | —                              |    —    |

**Faz-0 kapanmadı.** `Must` kapsamında **6 `◐`** var: 01.3 (sağ panel switcher — Copilot v1'e
bağlı), **02.4** (Details ziyaret bilgisi — koda karşı bulundu), **13.8** (e-posta bildirim kanalı),
EK-A.1 / EK-A.2 / EK-B.1 (çapraz-kesit form/liste desenleri). Kırılım: §3.13. Sayım yöntemi:
§3 tablolarındaki `Must`/`Must (MVP temel)` satırları elle değil **sayılarak** (✅=teslim+test,
◐=çekirdek var/KK eksik). `Should (MVP)` kalemleri kapanışı bloklamaz (§F.00) ama §3.13'te ismen
listelenir.

---

## 0. Kilitli Kararlar (ADR — yeniden tartışılmaz)

| #      | Karar               | Değer                                                                                                                                 |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-01 | Dil                 | TypeScript her yerde                                                                                                                  |
| ADR-02 | Monorepo            | pnpm workspaces + Turborepo, proje kökünde                                                                                            |
| ADR-03 | Backend             | Node 24 + Fastify + Prisma + PostgreSQL 17 (pgvector) + Redis 7                                                                       |
| ADR-04 | API şekli           | Resource-based REST `/api/v1/...`; eylemler kaynak altında POST alt-yolu. Action yüzeyi (`/action/send_event`) taklit EDİLMEZ         |
| ADR-05 | Kontrat             | `packages/contract` OpenAPI 3.1 → `@nexa/types` generate (contract-first)                                                             |
| ADR-06 | Hata zarfı          | `{ error: { type, message, request_id, details? } }` — 24 tip (v2-03 §1.8 tablosu)                                                    |
| ADR-07 | Rate limit          | agent 180/dk (burst 30) · customer 60/dk · RTM WS 10 msg/sn/bağlantı. 429 → `Retry-After` + `X-RateLimit-*`. Env: `RATE_LIMIT_*`      |
| ADR-08 | Routing algoritması | havuz → priority katmanı (primary>first>normal>last) → en az yüklü → `last_assigned_at ASC` → fallback → kuyruk                       |
| ADR-09 | AI resolution       | thread kapanışında `author_type='agent'` event YOKSA +1 → `usage_records(metric='ai_resolutions')`. Reports "Automated" aynı sorgudan |
| ADR-10 | Trial               | 14 gün; bitince **salt-okuma** (veri silinmez, yeni chat/ticket yok, widget offline)                                                  |
| ADR-11 | Kuyruk              | Kafka/RabbitMQ YOK. Redis Streams (fan-out) + pub/sub (presence)                                                                      |
| ADR-12 | Bölge               | MVP tek bölge; `region` immutable, tek değer `eu`                                                                                     |
| ADR-13 | Fiyat               | `unit_price_cents=9900`, `ai_resolutions_included=200`, aşım `AI_OVERAGE_CENTS` (varsayılan 50). Stripe MOCK                          |
| ADR-14 | Skill vs Workflow   | Tek paradigma = **Skill** (adım listesi). `workflows` tablosu şemada kalır, UI YOK                                                    |
| ADR-15 | RTM zarfı           | Orijinalle uyumlu: `{request_id, action, payload}` → `{request_id, action, type:'response'\|'push', success, payload}`                |

---

## 1. Bu planın nasıl okunacağı

### 1.1 Omurga = PRD

Çalışma sırası **PRD §5'in faz sırasıdır**: Faz 0 (MVP) → Faz 1 (v1) → Faz 2 (v2) → Faz 3 (Enterprise).
Her faz içinde işler **PRD §6'nın modül numaralarına** göre gruplanır (`FR-MOD-00` … `FR-MOD-13`).
Böylece plan, PRD'nin içindekiler tablosuyla aynı sırada yürür ve "bu iş nereden geldi?"
sorusunun cevabı her zaman bir satır ötededir.

**Kural:** PRD kimliği olmayan iş yapılmaz. Yeni bir ihtiyaç doğarsa önce PRD'de karşılığı
bulunur; yoksa §9'a (kapsam dışı) veya "PRD sapması" olarak §D'ye yazılır.

### 1.2 Durum işaretleri

| İşaret | Anlamı                                                |
| :----: | ----------------------------------------------------- |
|   ✅   | Teslim edildi — kod + test yeşil + push               |
|   ◐    | Kısmi — çekirdek var, PRD kabul kriteri tamamlanmamış |
|   ⬜   | Açık — kod yok                                        |
|   🔒   | Bu fazda yapılmayacak (sonraki faza ait)              |
|   ⛔   | Kapsam dışı (PRD §11.1)                               |

**Sayım notu:** Yukarıdaki rakamlar §3 tablolarındaki işaretlerden **sayılarak** üretilir,
elle yazılmaz — bir kez elle yazıldı ve dosyayla uyuşmadığı fark edilmeden kaldı. Satır sayısı
gereksinim sayısından fazla; bazı satırlar birden çok `FR-MOD` kalemini birlikte taşıyor.

**Denetim derinliği notu:** Faz 0 durumları (§3) 2026-07-23'te **koda karşı tek tek**
doğrulandı (route listesi, `openapi.yaml` path'leri, `schema.prisma`, `apps/web/src/features/`).
Faz 1–3 durumları (§4–§6) **geçici**; ilgili faz başlarken aynı denetimden geçirilecek.

### 1.3 Kayıt: neden bu plan yeniden düzenlendi

İlk PLAN.md 10 dikey dilime bölünmüştü ve tablosu "Dilim 1–10 ✅" gösteriyordu. Bu doğruydu
ama **yanıltıcıydı**: o 10 dilim PRD'nin Faz-0 kapsamı değil, benim seçtiğim bir kritik yol
kesitiydi ve bu ayrım hiçbir yere yazılmamıştı. 2026-07-23 denetimi iki şey buldu:

1. **PRD'nin `Must/Should (MVP)` etiketli 52 gereksinimin 18'i hiç yazılmamıştı** — signup,
   forgot password, ticketing, checkout, dosya paylaşımı, greeting, bildirimler, ⌘K dahil.
2. **Faz ihlali:** `Dilim 10` altında teslim edilen **Playbook + RAG aslında v1'dir**
   (PRD §5.2, `FR-MOD-05.x`/`06.x` → `Must (v1)`). Faz-0'da 18 delik varken bir v1 özelliği
   öne çekilmişti.

Playbook geri alınmıyor (çalışıyor, testli, 595 test yeşil). Ama **Faz-0 kapanmadan başka
v1 işi alınmıyor**. Dilim tarihçesi §A'da korundu.

---

## 2. Modül → Faz Matrisi (PRD §5.5) + bizim durumumuz

PRD'nin kendi matrisi, üzerine teslim durumu işlenmiş hâliyle.
(● = fazın ana teslimi · ○ = o fazda başlar/derinleşir)

| Modül                         | MVP | v1  | v2  | Ent. |                    **Durum**                    |
| ----------------------------- | :-: | :-: | :-: | :--: | :---------------------------------------------: |
| MOD-00 Auth + trial           |  ●  |     |     |      |                 ✅ (00.4 dahil)                 |
| MOD-01 Global shell + ⌘K      |  ●  |  ○  |  ○  |      |            ◐ ⌘K+rozet ✅, Copilot v1            |
| MOD-02 Inbox 3-pane + Archive |  ●  |  ○  |     |      |   ◐ chat+ticket+Copy link ✅ · **02.4 ziyaret bilgisi ⬜ (§D19)**   |
| MOD-03.1 Real-time traffic    |  ○  |  ○  |  ○  |      |               ✅ sekmeler (tm 19)               |
| MOD-03.2 Contacts CRM         |  ●  |  ○  |     |      |                       ✅                        |
| MOD-03.3 Campaigns            |     |  ●  |  ○  |      |          ✅ alt sekme+builder+kart (tm 43)          |
| Engage/Goals + Sales tracker  |     |     |  ●  |      |                       ⬜                        |
| MOD-04 Team/roller/teams      |  ●  |  ○  |  ○  |  ○   |              ✅ (invite Dilim 12)               |
| MOD-05 Playbook               |     |  ●  |  ○  |      |     ✅ **v1 payı tam** (05.1–05.5 sayıldı §4.1) · v2 §5     |
| MOD-06 AI Agent + RAG         |     |  ●  |  ○  |  ○   |  ✅ **v1 payı tam** (06.1–06.5 sayıldı §4.2) · 06.3.2-bulk v2 §5.1  |
| Görsel Workflow builder       |     |     |  ●  |      |               ⛔ ADR-14 (UI yok)                |
| MOD-07 Reports                |  ○  |  ○  |  ●  |  ○   | ✅ Overview + AI Agent + Breakdown + Reviews (07.8, tm 45) |
| MOD-08.5 Channels             |  ○  |  ●  |     |  ○   | ✅ MVP kanalları (grid/website/email/chat-page) |
| MOD-08.6 Routing              |  ○  |  ○  |  ●  |  ○   |                ✅ (MVP kapsamı)                 |
| MOD-08.7 Inbox araçları       |  ○  |  ●  |     |      |       ✅ canned + tag kütüphanesi (tm 17)       |
| MOD-08.8 API access / MCP     |  ○  |  ○  |  ●  |      |           ✅ (PAT/API), webhook v1'de           |
| MOD-08.9 Security             |  ○  |  ○  |  ●  |  ●   |        ✅ trusted domains + file sharing        |
| MOD-09 Apps marketplace       |     |  ○  |  ○  |  ○   |                       ⬜                        |
| MOD-10 Billing                |  ●  |  ○  |     |  ○   |           ✅ checkout (MOCK) + trial            |
| MOD-11 Customer widget        |  ●  |  ○  |     |  ○   |       ✅ launcher/greeting/persona/attach       |
| MOD-12 Copilot                |  ○  |  ●  |  ○  |      |        ✅ ayrı KB + panel + özet/yanıt/enhance         |
| Mobil app                     |     |  ●  |  ○  |      |                       ⬜                        |

---

## 3. FAZ 0 — MVP (PRD §5.1)

**PRD amacı:** _"Güvenli, gerçek zamanlı, faturalanabilir bir canlı sohbet + temel ticketing çekirdeği."_
**PRD çıkış kriteri:** trial→ücretli ≥%8 · kurulum <10 dk · ilk hafta ≥1 sohbet/gün.

> Faz-0 kapanmadan v1 işine geçilmez (§1.3).

### 3.0 FR-MOD-00 — Ön-Uygulama / Kimlik Doğrulama

| PRD  | Gereksinim                                     | Öncelik      | Durum | Nerede                                                                            |
| ---- | ---------------------------------------------- | ------------ | :---: | --------------------------------------------------------------------------------- |
| 00.1 | Login (email+parola; SSO/2FA opsiyonel)        | Must (MVP)   |  ✅   | Dilim 2 · `/auth/login`                                                           |
| 00.2 | **Signup + 14 gün kartsız trial başlatma**     | Must (MVP)   |  ✅   | Dilim 12                                                                          |
| 00.3 | **Forgot password** (süreli token, nötr mesaj) | Must (MVP)   |  ✅   | Dilim 12                                                                          |
| 00.4 | **Onboarding sihirbazı** + tohum veri          | Should (MVP) |  ✅   | tm 22 · `/onboarding/*` + AppShell gate + `onboarding_seed_demo` SECURITY DEFINER |

### 3.1 FR-MOD-01 — Global Shell / Navigation

| PRD                      | Gereksinim                                               | Öncelik          | Durum | Nerede                                                                                |
| ------------------------ | -------------------------------------------------------- | ---------------- | :---: | ------------------------------------------------------------------------------------- |
| 01.1.3                   | **Command Palette (⌘K)** — içerik arama + rota atlama    | Must (MVP temel) |  ✅   | Dilim 14 (tm 18) — müşteri/sohbet/ticket arama + modül atlama, scope-gated, deep-link |
| 01.1.6                   | Trial rozeti "N days" + Subscribe CTA                    | Must (MVP)       |  ✅   | Dilim 14 (tm 15) — trial rozeti + Subscribe CTA                                       |
| 01.2                     | Sol ikon rayı                                            | Must (MVP)       |  ✅   | F2 · `AppShell.tsx`                                                                   |
| 01.3                     | Sağ panel anahtarı (Details ↔ Copilot ↔ Expand)          | Must (MVP)       |   ✅   | tm 28 · sağ panel aç/kapa + **Expand** + tercih persist (`rightPanel.ts`/`InboxPage.tsx`, unit `rightPanel.test.tsx` + E2E `inbox-panel.spec.ts`). Copilot v1'e ayrıldı (§D22/§D23, tm 36) |
| 01.1.1/.4/.5, 01.4, 01.5 | Hamburger, presence avatarları, Invite +N, banner, unpin | Should/Could     |  🔒   | v1+                                                                                   |

### 3.2 FR-MOD-02 — Inbox / Chats

| PRD                                              | Gereksinim                                                                                                   | Öncelik          | Durum | Nerede                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ---------------- | :---: | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 02.1.1                                           | Chats grubu (All/My/Queued/Unassigned/Supervised/Archived)                                                   | Must (MVP)       |  ✅   | Dilim 7                                                                                                                                  |
| 02.1.3                                           | **Tickets grubu** (All/Unassigned/My open)                                                                   | Must (MVP temel) |  ✅   | Dilim 11                                                                                                                                 |
| 02.2.2                                           | Sohbet liste öğesi (unread, typing)                                                                          | Must (MVP)       |  ✅   | Dilim 7                                                                                                                                  |
| 02.3.1                                           | Transcript — canlı akış                                                                                      | Must (MVP)       |  ✅   | Dilim 4+5+7                                                                                                                              |
| 02.3.3                                           | Composer (Enter/Shift+Enter)                                                                                 | Must (MVP)       |  ✅   | Dilim 7                                                                                                                                  |
| 02.3.4                                           | Message type (Reply / Internal note)                                                                         | Must (MVP)       |  ✅   | Dilim 7                                                                                                                                  |
| 02.3.5                                           | Composer araçları (canned `#`, tag, emoji, **attach**)                                                       | Must (MVP)       |  ✅   | F5 (`#` ✅) · attach → **Dilim 13**                                                                                                      |
| 02.3.6                                           | Send (optimistic, disabled/loading/error)                                                                    | Must (MVP)       |  ✅   | Dilim 7                                                                                                                                  |
| 02.4.1–.6                                        | Details paneli (info/tags/visited pages/visit info)                                                          | Must (MVP)       |  ✅   | Chat info/tags/assignee/ID/Started ✅ · **Visited pages + Visit info (Device/Referring/Duration/IP) ✅** — inbox `getChat` visitor'ı taşıyor (`chat-service.ts` `get`→`#latestVisitor`, agent-only/NFR-S9), UI `DetailsPanel.tsx` iki bölümü + boş durumları render eder; test: `DetailsPanel.test.tsx` (3) + `chats.test.ts` "visitor context" (4, IDOR dahil). tm 27/27.1/27.2 · §D24 (D19 kapandı) |
| 02.6                                             | **Create ticket** / Copy chat link / Reopen                                                                  | Must (MVP)       |  ✅   | Reopen ✅ (`/chats/{id}/resume`) · Create ticket ✅ (Dilim 11) · Copy chat link ✅ (§F kapanış — transcript başlığı, `?chat=` deep-link) |
| 02.8                                             | Archive (salt-okuma transcript)                                                                              | Must (MVP)       |  ✅   | Dilim 7                                                                                                                                  |
| 02.1.2, 02.1.4, 02.2.1, 02.3.2, 02.5, 02.7, 02.9 | AI Agents grubu, kanal görünümleri, sıralama, Reply Suggestions, Copilot özeti, Tickets grid, typing preview | v1               |  🔒   | v1                                                                                                                                       |
| 02.2.3                                           | "Take tour" banner                                                                                           | Could            |  🔒   | —                                                                                                                                        |

### 3.3 FR-MOD-03 — Customers (CRM)

| PRD                            | Gereksinim                                                    | Öncelik            | Durum | Nerede                                                       |
| ------------------------------ | ------------------------------------------------------------- | ------------------ | :---: | ------------------------------------------------------------ |
| 03.1.1                         | Real-time sekmeleri (All/Chatting/Queued/Waiting)             | Should (MVP temel) |  ✅   | Dilim 14 (tm 19) — All/Chatting/Queued/Waiting + canlı sayaç |
| 03.2.1                         | Contacts header + arama + filter                              | Must (MVP)         |  ✅   | F4                                                           |
| 03.2.3                         | Contacts tablosu (Name/Email/Phone/Country/Chats/**Tickets**) | Must (MVP)         |  ✅   | F4 — `tickets_count` artık gerçek (Dilim 11)                 |
| 03.1.2, 03.1.3, 03.2.2, 03.3.x | Empty state, ziyaretçi tablosu, alt sekmeler, Campaigns       | Should/v1          |  🔒   | v1                                                           |

### 3.4 FR-MOD-04 — Team

| PRD                | Gereksinim                                       | Öncelik    | Durum | Nerede              |
| ------------------ | ------------------------------------------------ | ---------- | :---: | ------------------- |
| 04.1               | Team kenar çubuğu (AI Agents/Teammates/Teams)    | Must (MVP) |  ✅   | F2                  |
| 04.3.1             | **Copy invite link**                             | Must (MVP) |  ✅   | Dilim 12            |
| 04.3.3             | Teammates tablosu (Name/Role/Status/2FA)         | Must (MVP) |  ✅   | F2                  |
| 04.3.4             | Profile paneli (concurrent chats limit dahil)    | Must (MVP) |  ✅   | F2 · Dilim 8        |
| 04.4               | **Invite teammates modal** (çoklu email + rol)   | Must (MVP) |  ✅   | Dilim 12            |
| 04.5               | Teams CRUD + Primary agent önceliği              | Must (MVP) |  ✅   | Dilim 8 · `/groups` |
| 04.2, 04.3.2, 04.6 | AI agent performance, filtre, Chatbots/Suspended | v1         |  🔒   | v1                  |

### 3.5 FR-MOD-06 — AI Agent (yalnız MVP payı)

| PRD  | Gereksinim                             | Öncelik            | Durum | Nerede                                                                                                   |
| ---- | -------------------------------------- | ------------------ | :---: | -------------------------------------------------------------------------------------------------------- |
| 06.6 | Chatbot (kural-tabanlı, deterministik) | Should (MVP temel) |  ✅   | F6 skill motoru — NOT: PRD'nin ayrı LLM'siz kural-botu değil; öne çekilen v1 AI Agent bu payı karşılıyor |

### 3.6 FR-MOD-07 — Reports (yalnız MVP payı)

| PRD    | Gereksinim                                                             | Öncelik            | Durum | Nerede                                                                                                                    |
| ------ | ---------------------------------------------------------------------- | ------------------ | :---: | ------------------------------------------------------------------------------------------------------------------------- |
| 07.1   | Reports kenar çubuğu (Overview/AI Agent/Breakdown)                     | Should (MVP temel) |  ✅   | Overview/AI Agent/Breakdown sekmeleri (tm 21). AI Agent: resolutions=ADR-09, deflection; Breakdown: split gün/ajan.        |
| 07.3.1 | Overview header — range tabs (7/30/90/365 + custom) + vs. önceki dönem | Should             |  ✅   | 365+custom date picker + previous_period (eşit-uzunluk önceki dönem) delta rozetleri (tm 21).                              |
| 07.3.2 | KPI kartları — Manual/Assisted/**Automated** + Total cases             | Must (MVP temel)   |  ✅   | Manual/Assisted/Automated 3'lü ayrım + Total cases (tm 20). automated ADR-09 KORUNDU; manual+assisted+automated = closed. |
| 07.3.3 | Chats bölümü kartları (automated chats/hour, durations, response)      | Should             |  ✅   | Chats bölümü: automated_per_hour + automated/total chat duration (tm 21).                                                 |
| 07.2   | Onboarding survey popover                                              | Could              |  🔒   | —                                                                                                                         |

### 3.7 FR-MOD-08 — Settings (yalnız MVP payı)

| PRD    | Gereksinim                                         | Öncelik    | Durum | Nerede                                                     |
| ------ | -------------------------------------------------- | ---------- | :---: | ---------------------------------------------------------- |
| 08.5.1 | **All channels kart gridi**                        | Must (MVP) |  ✅   | **Dilim 13**                                               |
| 08.5.2 | **Website widgets** (+Add website / Install code)  | Must (MVP) |  ✅   | **Dilim 13** — `Website` modeli var                        |
| 08.5.3 | **Email (forwarding → ticket)**                    | Must (MVP) |  ✅   | **Dilim 13** (kanal yüzeyiyle)                             |
| 08.5.9 | **Chat page** (hosted link)                        | Must (MVP) |  ✅   | **Dilim 13**                                               |
| 08.6.1 | Chat routing kural motoru + fallback               | Must (MVP) |  ✅   | Dilim 8 · ADR-08                                           |
| 08.7.1 | **Tags kütüphanesi CRUD** (grup kapsamı)           | Must (MVP) |  ✅   | Chat başına etiket ✅ · kütüphane CRUD ✅ Dilim 14 (tm 17) |
| 08.7.2 | Canned responses (`#` shortcut, grup kapsamı)      | Must (MVP) |  ✅   | F5                                                         |
| 08.8.2 | API access — APIs & SDKs + PAT                     | Must (MVP) |  ✅   | Dilim 2 · F5                                               |
| 08.9.1 | Trusted domains (widget allowlist)                 | Must (MVP) |  ✅   | Dilim 2 · F5                                               |
| 08.9.4 | **File sharing** (izinli tür/boyut + virüs tarama) | Must (MVP) |  ✅   | **Dilim 13** — NFR-S10                                     |

### 3.8 FR-MOD-10 — Billing / Trial

| PRD    | Gereksinim                                       | Öncelik    | Durum | Nerede                                                                                      |
| ------ | ------------------------------------------------ | ---------- | :---: | ------------------------------------------------------------------------------------------- |
| 10.1.1 | **Plan + Change plan**                           | Must (MVP) |  ✅   | **Dilim 14** (tm 13) — checkout API                                                         |
| 10.1.2 | **Billing cycle** (Monthly/Annual + indirim)     | Must (MVP) |  ✅   | **Dilim 14** (tm 13)                                                                        |
| 10.1.3 | **Users stepper** ($/user/mo × qty)              | Must (MVP) |  ✅   | **Dilim 14** (tm 13)                                                                        |
| 10.1.6 | **Subscription summary + Enter payment details** | Must (MVP) |  ✅   | **Dilim 14** (tm 14) — ⚠️ PRD §11.1/1: gerçek kart girişi kapsam DIŞI; Stripe MOCK (ADR-13) |
| 10.2   | 14 günlük trial mantığı (rozet + kısıtlama)      | Must (MVP) |  ✅   | Dilim 9 · ADR-10                                                                            |

### 3.9 FR-MOD-11 — Customer Widget

| PRD  | Gereksinim                                   | Öncelik    | Durum | Nerede                                         |
| ---- | -------------------------------------------- | ---------- | :---: | ---------------------------------------------- |
| 11.1 | Launcher bubble + unread rozeti              | Must (MVP) |  ✅   | Dilim 6                                        |
| 11.2 | **Greeting card + quick replies**            | Must (MVP) |  ✅   | **Dilim 13**                                   |
| 11.3 | Agent identity (AI persona / insan adı)      | Must (MVP) |  ✅   | Dilim 6 (bot kimliği ✅) · persona ✅ Dilim 13 |
| 11.4 | Composer (mesaj + **attach** + emoji + send) | Must (MVP) |  ✅   | attach ✅ Dilim 13                             |
| 11.6 | Embed snippet (async JS + `window.__lc`)     | Must (MVP) |  ✅   | Dilim 6                                        |

### 3.10 FR-MOD-13 — (yalnız MVP payı)

| PRD  | Gereksinim                                        | Öncelik    | Durum | Nerede               |
| ---- | ------------------------------------------------- | ---------- | :---: | -------------------- |
| 13.8 | **Notifications** (ses/masaüstü/tarayıcı/e-posta) | Must (MVP) |  ✅   | Ses + masaüstü/tarayıcı (Notification API) + sekme başlığı ✅ (tm 16, `notifications.ts`) · **e-posta bildirim kanalı ✅** (tm 31): karar `assignee-email.ts` `shouldEmailAssignee` + route tetik `customer.ts` (atanan ajana FileMailer) · kullanıcı bazında opt-out `notify_email` (migration `20260725110000`, Settings `SettingsPage.tsx`/`auth-store.ts`, `agents.ts`/`auth.ts`) · KK 08.2 karşılandı · test: `assignee-email.test.ts` (5) + `notifications.test.ts` integration (5, opt-out/idempotent/cross-tenant dahil) — mobil push 🔒 v1 (§11.1/8) → FR-MOD-13.7/§3.13/T7 · §D20/§D26 |

### 3.11 Faz-0 dilim planı

| #      | Dilim                                     | PRD kapsamı                                                                                           | Neden bu sıra                                                                                                                                                                                            |
| ------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~11~~ | **Ticketing çekirdeği** ✅                | 02.1.3 ✅ · 02.6 (create) ✅ · 03.2.3 ✅ · 07.3.2 ✅                                                  | Teslim edildi (merge `0ec1b56`). Kapsamdan çıkanlar: 08.5.3 → Dilim 13, 02.6'nın "Copy chat link"i → Dilim 14.                                                                                           |
| ~~12~~ | **Hesap yaşam döngüsü** ✅                | 00.2 ✅ · 00.3 ✅ · 04.3.1 ✅ · 04.4 ✅                                                               | Teslim edildi. Onboarding sihirbazı (00.4, Should) Dilim 14'e taşındı — Must'lar önce. Tarayıcıda bulunan iki hata için bkz. §D13/D14.                                                                   |
| ~~13~~ | **Kanallar + dosya + greeting** ✅        | 08.5.1 ✅ · 08.5.2 ✅ · 08.5.3 ✅ · 08.5.9 ✅ · 08.9.4 ✅ · 11.2 ✅ · 11.3 ✅ · 02.3.5/11.4 attach ✅ | Teslim edildi (merge `d6de3a6`). 08.5.3 (kaynak Dilim 11'de kapsam dışıydı) burada teslim edildi. Yeni: `website_exists` hata tipi (§D15), chat-page allowlist muafiyeti (§C-A8), email inbound (§C-A9). |
| ~~14~~ | **Checkout + bildirim + shell kalanı** ✅ | 10.1.1–.3 ✅ · 10.1.6 ✅ · 13.8 ✅ · 01.1.3 ✅ · 01.1.6 ✅ · 08.7.1 ✅ · 03.1.1 ✅                    | Teslim edildi (merge `13b6f6b`). Checkout Stripe MOCK (ADR-13). Kalan borç (kapsamdan çıktı): 00.4 Onboarding sihirbazı (Should). 02.6 Copy chat link §F kapanışında teslim edildi.                      |

**Faz-0 kapanış kapısı:** 52 gereksinimin tamamı ✅ veya gerekçeli ⛔ · §7 NFR kapısı geçildi ·
`make dev` temiz kurulumdan demo akışını çalıştırıyor.

> **Kalan Faz-0 bakiyesi — Task Master'a alındı (2026-07-25):** tm **20** ✅ (07.3.2 Manual/Assisted — teslim edildi) · tm **21** ✅ (07.1/07.3.1/07.3.3 Reports Breakdown/AI Agent/vs-önceki dönem — teslim edildi) · tm **22** ✅ (00.4 Onboarding sihirbazı — teslim edildi) · tm **23** ✅ (S12 audit yazıcısı) · tm **24** ✅ (C8 retention) · tm **25** ✅ (M5 OTel — teslim edildi) · tm **26** ✅ (i18n — teslim edildi). **Faz-0 bakiyesi kapandı.** Her biri tam alt-görevli; gerekçeler §D16–D18 + §7.2.

---

### 3.12 Dilim 12 — Hesap yaşam döngüsü: invariant ve tehditler (önce yazıldı)

Auth yüzeyine dokunduğu için [MAX] özeni: liste kodun önüne yazıldı, negatif testler
pozitiflerden önce kuruldu (MASTER-PROMPT §Zorluk Etiketleri).

**Invariant'lar**

- **I1** — Signup ya organizasyon + lisans + hesap + owner üyeliğinin **hepsini** üretir ya da
  hiçbirini. Yarım kalmış bir çalışma alanı kullanıcının kendi başına düzeltemeyeceği bir şeydir.
- **I2** — Bir e-posta = bir hesap (global `citext unique`). Aynı kişi birden çok lisansa
  **üyelik** ile katılır, ikinci bir hesapla değil.
- **I3** — Trial oluşturulmadan 14 gün sonra biter; `status='trialing'`, kart istenmez (ADR-10).
- **I4** — Reset token'ı: rastgele 32 bayt, **yalnız hash'i** saklanır, süreli, **tek kullanımlık**.
- **I5** — Forgot-password cevabı hesabın var olup olmamasından **bağımsız** olarak aynıdır
  (gövde ve durum kodu).
- **I6** — Davet token'ı: hash'li, süreli, tek kullanımlık, **tek lisansa** bağlı.
- **I7** — Daveti kabul eden e-postanın hesabı zaten varsa **yeni hesap açılmaz**; mevcut hesaba
  üyelik eklenir (I2'nin sonucu).
- **I8** — Davet eden, **kendi rolünün üstünde** bir rol veremez.
- **I9** — Parola değişimi mevcut oturumları (refresh token ailelerini) iptal eder.

**Tehditler**

- **T1** — Forgot-password ile e-posta numaralandırma (gövde, durum kodu **veya süre** farkı).
- **T2** — Reset token'ı kaba kuvvet / tekrar kullanım.
- **T3** — Davet linkinin yabancıya iletilmesi → yetkisiz çalışma alanı erişimi.
- **T4** — Davet üzerinden yetki yükseltme (agent'ın owner daveti üretmesi).
- **T5** — Daveti başka lisansa kabul ettirme (cross-tenant).
- **T6** — Signup'ın kötüye kullanımı (kayıt spam'i) — anonim rate limit'e tabi.

---

### 3.13 Faz-0 Kalan Kalem Kırılımı (kapanış kapısı §F.00'ın girdisi)

> **Denetim 2026-07-25 (koda karşı).** Faz-0 `Must` kapsamında **6 `◐`** kaldı. Aşağıdaki
> atomik alt-görevlerin **hepsi** ✅ olmadan Faz-0 kapanmaz. Her alt-görev tek temiz pencerede
> DoD kapısından (CONVENTIONS.md) **ve** kendi PRD KK'sından geçer. KK maddeleri PRD'den
> **birebir** alındı; "KK doğrulama" her maddenin hangi test/komutla kanıtlanacağını söyler.

#### T3 · 02.4 — Details paneli: Visited pages + Visit info *(Must, MVP)* `[XHIGH]`

Kapanışı bloklayan `◐`. İki alt-görev (kontrat/backend + ekran — tm 6/7 deseni).

**T3-a — `getChat` yanıtına ziyaret bilgisi ekle (kontrat + backend)** `[XHIGH]`
- **PRD kimliği:** FR-MOD-02.4.1–.6 (+ NFR-S5 IDOR: ziyaret verisi tenant-scoped)
- **Neden açık:** `getChat` (`packages/contract/openapi/paths/chats.yaml`) yanıtı ziyaret bilgisi
  taşımıyor; veri var (`Visit` şeması `openapi.yaml:886`; `visits` tablosu widget'tan doluyor,
  `getCustomer` okuyor) ama chat yüzeyine bağlı değil.
- **Kapsam:** kontrat → `ChatDetail` yanıtına `visitor` bloğu (`visited_pages[]`, `visit_info:
  {device, referrer, duration_seconds, ip}`); backend `chat-service`/`customer-service` müşterinin
  son ziyaretini chat'e bağlar. Contract-first.
- **KK (PRD birebir):** _"Bölümler katlanır; tag/assignee anında kaydeder; süre/ziyaret canlı"_
  → **KK-türetilmiş** (PRD KK yalnız davranışı söylüyor; alan listesi Açıklama sütunundan:
  _"Visited pages, Visit info (Device/Referring/Duration/IP)"_). Türetilmiş kriter §C-A10'a yazıldı.
- **KK doğrulama:** `test/integration/chats.test.ts` — `getChat` yanıtında ziyaret alanları var;
  **cross-tenant:** başka lisansın chat'inde ziyaret verisi sızmıyor (404). `contract-parity` yeşil.
- **Zorunlu testler:** integration (alanların dolması + IP/referrer null-güvenli) + cross-tenant negatif.
- **Bağımlılıklar:** yok (visits zaten yazılıyor).
- **Kapsam dışı:** canlı süre WS push'u (T3-b'de UI hesaplar); 13.2 Engage 360° panel (v2).
- **Tahmin:** 1 pencere.

**T3-b — Details panelinde Visited pages + Visit info bölümleri** `[XHIGH]`
- **PRD kimliği:** FR-MOD-02.4.1–.6
- **Neden açık:** `apps/web/src/features/inbox/DetailsPanel.tsx` yalnız Conversation/Tags/Teams
  render ediyor (denetim §D19).
- **Kapsam:** iki katlanır bölüm daha — "Visited pages" (sıralı liste) + "Visit info"
  (Device/Referring/Duration/IP satırları); veri T3-a'dan. Empty state: ziyaret yoksa anlamlı metin.
- **KK (PRD birebir):** _"Bölümler katlanır; tag/assignee anında kaydeder; süre/ziyaret canlı"_.
- **KK doğrulama:** `DetailsPanel` render testi (ziyaret verisiyle sayfa listesi + device/IP görünür;
  veri yokken empty state); E2E `demo-flow.spec.ts`'e ziyaret-bilgisi görünürlük iddiası.
- **Zorunlu testler:** unit (render + empty state) + E2E görünürlük.
- **Bağımlılıklar:** **T3-a** (veri yolu).
- **Kapsam dışı:** IP coğrafi çözümleme; harita; canlı ziyaretçi akışı (03.1.x).
- **Tahmin:** 1 pencere.

#### T1 · 01.3 — Sağ panel switcher (Details ↔ Expand; Copilot v1'e) *(Must, MVP)* `[XHIGH]`

**T1-a — Sağ panel aç/kapa + Expand + tercih persist** `[XHIGH]`
- **PRD kimliği:** FR-MOD-01.3
- **Neden açık:** Details paneli her zaman görünür (`InboxPage.tsx`); panel anahtarı (aç/kapa),
  **Expand** (geniş transcript) ve tercih kalıcılığı yok. Copilot sekmesi ⬜ (MOD-12 = **v1**).
- **Kapsam:** sağ panel toggle + Expand modu (transcript tam genişlik) + tercih `localStorage`/
  hesap tercihinde persist. **Copilot sekmesi kapsam DIŞI** (v1 — bkz. §D22 daraltma).
- **KK (PRD birebir):** _"Panel açılır/kapanır; Details/Copilot geçişi persist"_ → MVP payında
  **Details/Expand** geçişi persist (Copilot v1'e ayrıldı, §D22).
- **KK doğrulama:** unit (toggle + Expand + reload sonrası tercih korunur); E2E panel aç/kapa.
- **Zorunlu testler:** unit (persist) + E2E.
- **Bağımlılıklar:** yok.
- **Kapsam dışı:** Copilot sekmesi/paneli (12.1–12.3, v1); reply suggestions.
- **Tahmin:** 1 pencere.

#### T7 · 13.8 — E-posta bildirim kanalı *(Must, MVP)* `[XHIGH]`

**T7-a — Bildirim tercihine e-posta + sunucu tarafı tetik (yeni sohbet/atama)** `[XHIGH]`
- **PRD kimliği:** FR-MOD-13.8 (+ FR-MOD-08.2)
- **Neden açık:** `notifications.ts` yalnız `{enabled, sound, desktop}`; e-posta kanalı yok
  (denetim §D20). SMTP mock (`services/mail/mailer.ts`, A4) var ama bildirime bağlı değil.
- **Kapsam:** kullanıcı tercihi `email: boolean`; sunucu tarafı tetik — yeni sohbet/atama/mention
  olayında ilgili ajanlara `FileMailer` ile e-posta (mock, `.data/mail`). Tercih kullanıcı bazında.
- **KK (PRD birebir):** _"Bkz. FR-MOD-08.2; kanallar arası tutarlı"_ · 08.2: _"ses/masaüstü/
  e-posta/tarayıcı bildirim tercihleri (yeni sohbet/atama/mention); kullanıcı bazında"_.
- **KK doğrulama:** integration — atama olayında hedef ajanın posta kutusuna (`.data/mail`) mesaj
  düşüyor; tercih kapalıyken düşmüyor; **cross-tenant:** başka lisansın ajanına gitmiyor.
- **Zorunlu testler:** integration (tetik + tercih gating + cross-tenant) + unit (karar fonksiyonu).
- **Bağımlılıklar:** yok.
- **Kapsam dışı:** mobil push (🔒 v1); e-posta şablon markası (08.7.5, v1); gerçek SMTP (§9).
- **Tahmin:** 1 pencere.

#### T4 · EK-A.1 — Tek form validasyon primitifi + alan-altı hata *(Must, MVP)* `[XHIGH]`

Frontend formları elle doğruluyor; ortak kütüphane/desen yok (denetim: web'de 0 zod importu).

**T4-a — Ortak form-validasyon primitifi + pilot iki form** `[XHIGH]`
- **PRD kimliği:** FR-EK-A.1
- **Neden açık:** `apps/web/src` içinde form validasyonu her ekranda elle; alan-altı hata /
  submit-disabled deseni tekrar ediyor, tek kaynak yok. (Backend zod ✅ — bu iş **frontend**.)
- **Kapsam:** tek doğrulama primitifi (hafif hook/şema — bağımlılık eklenecekse `zod` zaten
  lockfile'da, frontend'e import edilir); alan-altı hata + geçersizken submit pasif + Error/
  Disabled/Loading durumları. Pilot: **Invite teammates** (`InviteTeammates.tsx`) + **Add website**
  (`WebsiteWidgets.tsx`).
- **KK (PRD birebir):** _"Tek form/validasyon kütüphanesi; alan-altı hata mesajı"_.
- **KK doğrulama:** unit (geçersiz alan → alan-altı hata + submit pasif) iki pilot formda; E2E
  Invite akışında geçersiz email satır-içi hata.
- **Zorunlu testler:** unit (her durum) + E2E pilot.
- **Bağımlılıklar:** yok.
- **Kapsam dışı:** kalan formların migrasyonu (**T4-b**); Forms builder (08.7.7, v1).
- **Tahmin:** 1 pencere.

**T4-b — Kalan Must formlarını primitife taşı** `[XHIGH]`
- **PRD kimliği:** FR-EK-A.1
- **Neden açık:** T4-a yalnız 2 pilot; kalan Must formlar (Signup, Reset, New canned, New tag,
  Payment mock, Channels ekle) hâlâ elle.
- **Kapsam:** kalan formları primitife taşı; her birinde alan-altı hata + submit-disabled.
- **KK (PRD birebir):** _"Tek form/validasyon kütüphanesi; alan-altı hata mesajı"_.
- **KK doğrulama:** her taşınan formda unit; regresyon (mevcut E2E'ler yeşil kalır).
- **Zorunlu testler:** unit (form başına) + regresyon E2E.
- **Bağımlılıklar:** **T4-a**.
- **Kapsam dışı:** v1 formları (Forms builder, Custom fields).
- **Tahmin:** 1–2 pencere (çok form → 2+ ise T4-b tekrar bölünür).

#### T5 · EK-A.2 — Ortak girdi davranışları (yarım-form kapatma onayı) *(Must, MVP)* `[XHIGH]`

**T5-a — Yarım-form kapatma onayı + ortak dropdown/stepper/optimistic birleştirme** `[XHIGH]`
- **PRD kimliği:** FR-EK-A.2
- **Neden açık:** debounce/stepper/optimistic toggle dağınık uygulanmış; **yarım-form kapatma
  onayı** (kirli formu kapatırken uyar) hiçbir modalda yok.
- **Kapsam:** ortak "dirty guard" (kirli form kapatma → onay), ortak dropdown/stepper davranış
  sarmalayıcı; optimistic + hata geri alma deseni tekilleştir.
- **KK (PRD birebir):** _"Tutarlı davranış; optimistic + hata geri alma"_.
- **KK doğrulama:** unit (kirli form kapatma → onay; optimistic hata → geri alma); E2E Invite modal
  yarım doldurup kapatma → onay.
- **Zorunlu testler:** unit + E2E.
- **Bağımlılıklar:** T4-a ile aynı form katmanına dokunur (sıra: T4-a → T5-a önerilir).
- **Kapsam dışı:** yeni ekranlar; drag-reorder (06.2.4, v1).
- **Tahmin:** 1 pencere.

#### T6 · EK-B.1 — Virtualization + skeleton + anlamlı empty state *(Must, MVP)* `[XHIGH]`

P4 (10k satır 60fps) bu kaleme bağlı; P6 (büyük liste sorgusu) çoğunlukla ✅ (keyset + partition).

**T6-a — Virtualized liste primitifi (Contacts/Teammates/Skills/Tickets)** `[XHIGH]`
- **PRD kimliği:** FR-EK-B.1 (+ NFR-P4)
- **Neden açık:** listeler keyset paginate ediyor (✅) ama DOM'a tüm satırlar giriyor;
  virtualization yok → 10k satırda P4 hedefi ölçülemez.
- **Kapsam:** tek virtualized liste primitifi; Contacts + Teammates + Skills + Tickets ona taşınır.
- **KK (PRD birebir):** _"10.000+ satırda 60fps; skeleton; her boş liste için anlamlı empty state
  (boş dikdörtgen yok)"_ (bu alt-görev: virtualization + 60fps payı).
- **KK doğrulama:** unit (yalnız görünür satır DOM'da — sanal pencere testi); perf ölçümü
  (10k satır render bütçesi) HANDOFF'a kanıt.
- **Zorunlu testler:** unit (görünür-satır) + perf ölçüm notu.
- **Bağımlılıklar:** yok.
- **Kapsam dışı:** skeleton + empty state (**T6-b**); Apps/Campaigns/Knowledge gridleri (v1 listeleri).
- **Tahmin:** 1 pencere.

**T6-b — Skeleton + anlamlı empty state deseni (tüm Must listeler)** `[XHIGH]`
- **PRD kimliği:** FR-EK-B.1
- **Neden açık:** empty state tutarsız (kimi liste boş dikdörtgen); skeleton kısmi.
- **Kapsam:** ortak skeleton + "anlamlı empty state" bileşeni; Must listelerine uygulanır
  (Contacts/Teammates/Tickets/Inbox listeleri).
- **KK (PRD birebir):** _"…skeleton; her boş liste için anlamlı empty state (boş dikdörtgen yok)"_.
- **KK doğrulama:** unit (boş liste → anlamlı empty state, boş dikdörtgen değil) her listede.
- **Zorunlu testler:** unit (empty state) liste başına.
- **Bağımlılıklar:** **T6-a** (aynı liste primitifi).
- **Kapsam dışı:** v1 gridleri.
- **Tahmin:** 1 pencere.

#### Faz-0 `Should` kalemleri (kapanışı **bloklamaz** — §F.00, ismen)

- **EK-C.2** *(Should, MVP)* — banner/dropdown/panel/modal tek tasarım sistemi: `✅`. Tek design-system
  soyutlaması kuruldu — `apps/web/src/components/ui/{Banner,Dropdown,Modal,Panel}` — ve mevcut dağınık
  kopyalar ona oturtuldu: AppShell hesap menüsü→`Dropdown`, InviteTeammates→`Modal`, DetailsPanel→
  `Panel`/`PanelSection`, Billing read-only + TicketPane merged→`Banner`. `Banner` segmentli (tone) +
  kalıcı dismiss (localStorage). test `components/ui/*.test.tsx` (22) · tm 62. `Should` idi; Faz-0'ı
  bloklamıyordu, erken kapatıldı.
- **03.1.1 kalan sekmeler** (Supervised/Invited/Browsing) — teslim edilen 4 sekme (All/Chatting/
  Queued/Waiting) `Must temel`'i karşılıyor; kalan 3 sekme `v2 gelişmiş` (§4/13.2). Bloklamaz.

**Faz-0 kapanış kapısı (§F.00):** yukarıdaki **T1-a · T3-a · T3-b · T4-a · T4-b · T5-a · T6-a ·
T6-b · T7-a** (= 9 alt-görev, 6 Must `◐`'yi kapatır) ✅ olduğunda Faz-0 `Must` sayacı `45+6=51 ✅ ·
0 ◐ · 0 ⬜` olur ve **§F.1'in 10 maddesi tam sürüm** çalıştırılıp faz kapanır. `Should`ler: EK-C.2
✅ erken teslim (tm 62); 03.1.1-kalan ismen v1'e taşınır.

---

## 4. FAZ 1 — v1 (PRD §5.2)

**PRD amacı:** _"AI Agent + omnichannel + mobil."_ Faz-0 kapanmadan başlanmaz (§1.3).
**Çıkış kriteri (PRD):** AI resolution rate ≥%40 · omnichannel hesap oranı ≥%30.

> Durumlar **geçici** — bu faz başlarken koda karşı denetlenecek (§1.2).

### 4.1 FR-MOD-05 — Playbook _(öne çekildi)_

| PRD  | Gereksinim                                        | Öncelik     |              Durum              |
| ---- | ------------------------------------------------- | ----------- | :-----------------------------: |
| 05.1 | Header — Browse templates + Create skill ▾        | Must (v1)   |               ✅                |
| 05.2 | Recommended skills (şablon kartları)              | Should (v1) |               ✅                |
| 05.3 | Skill listesi sekmeleri (All/AI/Workspace/Drafts) | Must (v1)   |               ✅                |
| 05.4 | Liste kontrolleri (Search/Sort/Filter)            | Should      |               ✅                |
| 05.5 | Skill satırı ("N runs" + sahip + toggle)          | Must (v1)   |               ✅                |

### 4.2 FR-MOD-06 — AI Agent + Knowledge/RAG _(öne çekildi)_

| PRD    | Gereksinim                                                | Öncelik     |             Durum              |
| ------ | --------------------------------------------------------- | ----------- | :----------------------------: |
| 06.1   | AI Agent sekmeleri (Performance/Profile/Skills/Knowledge) | Must (v1)   | ✅ Sekmeli kabuk (ARIA tablist) + readiness — `PlaybookPage.tsx` (`VIEW_TABS` 4 panel) · `readiness.ts` `evaluateReadiness` → boş KB+skill'de aktive engeli + banner + devre dışı toggle · test `readiness.test.ts` (5) · tm 33.1 · §D27 |
| 06.2.1 | Skill editör üst barı (Run log + active toggle)           | Must (v1)   |               ✅               |
| 06.2.2 | Skill name                                                | Must (v1)   |               ✅               |
| 06.2.3 | Doğal dil talimat textarea (~10.000 karakter)             | Must (v1)   |               ✅               |
| 06.2.4 | Ordered steps (6 adım tipi; reorder + klavye alternatifi) | Must (v1)   | ✅ drag + klavye (↑↓) reorder — ikisi de tek `moveStep` yolundan + aria-live duyuru; zorunlu-parametre kapısı (transfer hedefi boşsa Save engeli + `role="alert"` satır hatası) — `SkillEditor.tsx` (draggable liste + ↑↓ + `canSave = issues.length===0`) · saf `step-reorder.ts` (`moveStep`/`describeMove`/`stepIssues`) · test `step-reorder.test.ts` (10) + `SkillEditor.test.tsx` (5) · tm 33.2 · §D53 |
| 06.2.5 | Preview (canlı simülasyon)                                | Must (v1)   |               ✅               |
| 06.3.1 | Knowledge alt sekmeler (All/Websites/Files/Articles/FAQ)  | Must (v1)   | ✅ 5 alt sekme (All/Websites/Files/Articles/FAQ) `role="tablist"` — `PlaybookPage.tsx` `KnowledgePanel` (`['all', ...KNOWLEDGE_TYPES]` + sekme sayaçları + tür bazlı süzme + sekme başına boş durum) · saf partition `knowledge-tabs.ts` `filterSourcesByTab`/`countSourcesByTab` (All = Websites ∪ Files ∪ Articles ∪ FAQ) · şema `@nexa/types` `KNOWLEDGE_SOURCE_TYPES` (§8 knowledge_sources) · test `knowledge-tabs.test.ts` (4) · tm 33.3 · §D28 |
| 06.3.2 | + New source (chunk+embedding)                            | Must (v1)   | ✅ geçersiz URL/tür reddi + website crawl/parse + RAG indeksleme — `routes/playbook.ts` `POST /knowledge-sources` (`type` enum website/file/article/faq; website → `assertPublicHttpUrl` SSRF-guard → `crawl` → `knowledge.index` aynı tx) · `services/ai/web-crawler.ts` (deterministik mock fetcher + `htmlToText`) · `lib/ssrf.ts` · test `ssrf.test.ts` (15: 169.254.169.254/localhost/private/`file://` reddi + DNS-rebinding) + `web-crawler.test.ts` (6) + integration `knowledge-crawl.test.ts` (11: SSRF negatifler → 400 & kaynak-yok · public crawl → ready + chunks · cross-tenant) · tm 33.4 · §D53. **bulk/CSV** bilinçli kapsam dışı → §5.1 `06.3.2-bulk` (Should, v2) |
| 06.3.3 | Kaynak tablosu (düzenle/sil/yeniden indeksle)             | Must (v1)   |               ✅               |
| 06.4   | Profile (persona: Tone/Language/Answer length)            | Must (v1)   | ✅ Name/Avatar/Tone/Language/Answer length + canlı Preview — `ProfileForm.tsx` · API `playbook.ts` PATCH `/ai-agents/:id` (answer_length→persona jsonb) · test `ProfileForm.test.tsx` (6) + `ai-agent-profile.test.ts` · tm 11/33.5 · §D25 |
| 06.5   | Performance (resolution rate, CSAT, transfer)             | Should (v1) | ✅ KPI kartları (Resolution rate/AI chats resolved/CSAT/Transferred) — Playbook Performance sekmesi `AiPerformance.tsx` (`PlaybookPage.tsx` `VIEW_TABS[performance]` → `view==='performance'`) + saf `performance.ts` `performanceKpis`/`isLowBase` (düşük-baz eşiği 20 → `tone='warn'`+hint+dipnot; CSAT bazı bağımsız) · AI-off arşiv ayrımı (`!agentActive` → `role=status` "historical figures") · sayılar `/reports/ai-agent`+`/reports/overview` (07.4 ile ortak sorgu = fatura ADR-09, ikinci sayaç yok) · test `AiPerformance.test.tsx`(5)+`performance.test.ts`(8) · tm 33.6 · §D36 |

### 4.3 Diğer v1 modülleri

| PRD        | Gereksinim                                                                                             | Öncelik        |                         Durum                         |
| ---------- | ------------------------------------------------------------------------------------------------------ | -------------- | :---------------------------------------------------: |
| **08.8.4** | **Webhooks** (register/list/unregister) — HMAC-SHA256 + timestamp/nonce + retry 3× + **SSRF koruması** | Must (v1)      | ✅ register/list/unregister API · HMAC-SHA256 imzalama + timestamp/nonce/SSRF · 3× retry + delivery log · tm 34 · §D36 |
| 02.1.2     | AI Agents grubu (AI agent / Solved)                                                                    | Must (v1)      | ✅ AI Agents grubu (KK "AI konuşmalarını insan kuyruğundan ayırır; Solved → AI resolution sayacı") — sidebar grubu `InboxPage.tsx` `AI_VIEWS` (AI agent ✦ / Solved ✓) + canlı sayaçlar `useInbox.ts` `useViewCounts` (`ai`/`ai_solved`) + tür-bazlı boş durumlar · backend süzgeç `chat-service.ts` `viewFilter`: **ai** = aktif + bot-event VAR & agent-event YOK (bekleyen/queued/unassigned'dan ayırır) · **ai_solved** = kapalı & agent-event YOK = ADR-09'un birebir predicate'i (`reports.ts` `AGENT_EVENT`/`automated` ile aynı satır → Solved listesi = `ai_resolutions` sayacı, çelişmez) · tip `types.ts` `InboxView` + rota enum `routes/chats.ts` · test integration `chats.test.ts` "AI Agents group" (3: insan kuyruğundan ayrım · agent yanıtı grubu düşürür · Solved = ADR-09 `ai_resolutions` sayacı birebir) · tm 37 · §D48 |
| 02.1.4     | Views grubu (WhatsApp/Messenger/Twilio görünümleri)                                                    | Should (v1)    | ✅ Inbox **Views** grubu (`InboxPage.tsx`) — kanal bağlı değilse **channel-promo** (dashed CTA → Settings→Channels), bağlıysa kanal satırları (Messenger/WhatsApp/SMS, "Connected" → Settings); **custom saved views** (base view + real-time tab, `localStorage`, ekle/sil, reload'da kalıcı, boş ad reddi). Kanal durumu owner/admin `channels--all` kapılı (`canReadChannels`) — ajan `/channels` çağırmaz (403 önlenir), yalnız kendi saved view'lerini görür. Saf `views.ts` (`showChannelPromo`/`connectedChannelViews`/`canReadChannels`/`addSavedView`/`removeSavedView`/`useSavedViews`) + `useConnectedChannels` (`useInbox.ts`, scope-gated) · test `views.test.ts` (19: kanal yok→promo · bağlıysa liste+sıra · saved view ekle/sil/round-trip/reload/boş-ad reddi) · tm 38 · §D42. Not: kanal→chat filtresi (per-kanal) `ChatSummary`'de kanal etiketi ister (backend, ayrı task); bu dilim promo+saved views KK'sını tam karşılar. |
| 02.3.2     | Reply Suggestions çipleri                                                                              | Should (v1)    | ✅ Reply Suggestions — composer'da **Space** (boş reply alanında, mode='all') → bağlama göre şekillenen AI çip satırı (`role="group"`); **çip → composer'a düzenlenebilir metin** (`setText`, caret sonda, mode='all'), müşteri yanıtı olarak (asla internal note değil, Copilot draft ile aynı el-verme). Öneriler cache'teki transcript'ten **anlık** türer (fetch/round-trip yok, PRD §108 katman-3 hafif mikro-özellik) — son müşteri mesajına göre lead (selam/soru/iade/teşekkür) + her zaman 2 güvenli bekletme yanıtı, dedupe, ≤4; boş konuşmada bile çip döner. Space **yalnız boşken** tetikler (cümle ortasında değil, v2-01 §307), **Escape** geri alır (§276), yazınca çipler çekilir, internal-note moduna geçince kapanır. Deterministik saf `replySuggestions.ts` (ai-mock felsefesi; gerçek sağlayıcı = tek fonksiyon değişimi) + `Composer.tsx` · placeholder "…press Space for suggestions" · test `replySuggestions.test.ts` (7) + `Composer.suggestions.test.tsx` (5: KK çip→düzenlenebilir · her zaman çip · dolu alanda tetiklenmez · Escape · note'ta yok) · tm 39 |
| 02.5       | Copilot özeti → internal note                                                                          | Should (v1)    | ✅ (12.3-a ile kapandı) `POST /copilot/chats/:id/summary` → özet **internal note** (recipients=agents, `chats.sendEvent` RTM fan-out, arşivde görünür); archived chat → 409 · `copilot.ts`/`copilot-service.ts` · test `copilot.test.ts` (summary→note + archived 409) · tm 36 · §D40 |
| 02.7       | Tickets grid (sıralanabilir, deep-link)                                                                | Should (v1)    | ✅ Sıralanabilir grid (KK "Satır → ticket konuşması; URL param sıralama") — VirtualTable (T6-a) tablo: Subject/Customer/Status/Priority/Assignee/Last message, tıklanır `aria-sort` başlıklar; **satır → ticket konuşması** (grid-first: hiçbir şey oto-seçili değil → satıra tıkla → detay pane + `← Tickets` geri); **URL param sıralama** `ticket_sort`/`ticket_order` (paylaşılabilir + reload'da kalıcı deep-link; `?ticket_sort=…` linki grid'i açar, chat view'e geçince temizlenir). Client-side sort = yüklü sayfa (keyset newest-first backend değişmedi; ADR yok); nulls-last (her iki yön) + stabil id-desc tiebreak = server sırasıyla uyumlu. Saf `ticket-grid.ts` (`sortTickets`/`parse`/`write`/`clear`/`toggleTicketSort`/`ariaSortFor`) + `TicketGrid.tsx` → `InboxPage.tsx` (deep-link effect + grid-first render). Test `ticket-grid.test.ts`(12)+`TicketGrid.test.tsx`(6)+e2e `tickets.spec.ts` (deep-link: header→URL, `?ticket_sort` reload→aria-sort, satır→konuşma) · tm 40 |
| 02.9       | Live typing preview                                                                                    | Should (v1)    | ✅ çift yönlü — ajan→ziyaretçi (`Composer.tsx` → `send_typing_indicator` → RTM `dispatcher.ts` #typing (chat yetki denetimli) → `TypingService.setAgentTyping` Redis TTL → Customer poll `/customer/chat` `agent_typing` → widget `renderTyping`) + ziyaretçi→ajan sneak-peek (widget `notifyTyping` → `POST /customer/chat/typing` → `chat-service.ts` `publishCustomerTyping` → `incoming_typing_indicator`/`incoming_sneak_peek` (yalnız ajanlara) → `useInbox.ts` → `TypingIndicator.tsx` önizleme) · şema `@nexa/types` `typingStateKey`/`SNEAK_PEEK_MAX_LENGTH` · test `typing.test.ts`(5)+`TypingIndicator.test.tsx`(4)+rtm `typing.test.ts`(6)+integration `customer-chat.test.ts` · OpenAPI `/customer/chat/typing` · tm 41 · §D30 |
| 03.1.3     | Ziyaretçi tablosu + satır aksiyonları                                                                  | Should (v1)    | ✅ Live-visitor board — tablo Visitor/Activity/**Chatting with**/Actions; "Chatting with" insan kazanır > AI persona (ör. "Hazal", widget FR-11.3 ile aynı çözümleme) · salt-okur API `GET /traffic` (`routes/traffic.ts` scope customers:ro\|:rw → `traffic-service.ts` `listLive`; OpenAPI `paths/traffic.yaml`, contract-parity ✅) · web `TrafficPage.tsx` + saf `rowActions.ts` `visitorRowActions` (Start chat/Supervise/Assign to me/Edit, durum×yetki) · rota `/app/customers/real-time` · test integration `traffic.test.ts`(9)+unit `rowActions.test.ts`(8)+e2e `traffic.spec.ts` · tm 42 · §D32 |
| 03.3.1–.3  | Campaigns (alt sekmeler, builder, kart)                                                                | Should (v1)    | ✅ Campaigns modülü (Customers üçüncü sekmesi, `/app/customers/campaigns`) — **03.3.1 alt sekmeler**: All/Ongoing/Scheduled/Inactive durum filtresi (KK "durum bazlı filtre"), saf `campaigns.ts` (`filterCampaigns`/`campaignCounts`/`CAMPAIGN_TABS`); durum = depolanan lifecycle (`campaigns_status_check` sözlüğü ongoing/scheduled/inactive) · **03.3.2 builder** (KK "tetikleyici+mesaj zorunlu; kayıt sonrası eşleşen ziyaretçiye otomatik gönderim"): koşul(`url_contains`)+mesaj zorunlu → kayıtta `#fireIfRunning` canlı ziyaretçileri (son 30 dk `visits`) saf `matchesConditions` ile süzer, eşleşene `campaign_sends` yazar (visitor başına 1, `skipDuplicates` idempotent); **cross-tenant**: sorgu `licenseId`+org kapılı + RLS → A kampanyası B ziyaretçisine ASLA göndermez · **03.3.3 kart** (KK "düzenleme+performans Displayed/Chats/Conversion"): edit + on/off toggle (`active`→status yeniden hesaplanır, ongoing ise fire) + performans `campaign_sends`'ten sayılır (displayed=gönderim, chats=engaged, conversion=converted; asla kampanyada cache'lenmez). Scope `customers:ro/:rw` (traffic deseni; owner/admin yönetir, ajan salt-okur). Migration `20260726170000_campaign_sends` (+RLS `campaign_sends_tenant`, drift ✅). `@nexa/types` Campaign DTO. OpenAPI `/campaigns`+`/campaigns/{id}` (contract-parity ✅). test integration `campaigns.test.ts`(13: match→send·no-match→gönderilmez·cross-tenant·scheduled fire yok·durum filtre·activate idempotent·strip-trigger 400·404·perf·scope split) + unit `campaign-matching.test.ts`(12) + web `campaigns.test.ts`(9)+`CampaignsPage.test.tsx`(4) + e2e `campaigns.spec.ts` · tm 43 |
| 04.2       | AI Agents (team tarafı) — performance                                                                  | Must (v1)      | ✅ Team-tarafı AI Agents girişi (KK "Per-agent performance; Copilot knowledge yönetimi") — **performance**: 06.5 `AiPerformance` kartları reuse (reports=fatura ADR-09, düşük-baz + AI-off dürüstlüğü, `reports_read` kapısı) + AI-agent roster (name/status/skills; `kind:'ai_agent'` süzülür → Copilot roster'a girmez; her satır → Playbook) `TeamAiPerformance.tsx` · **Copilot knowledge yönetimi**: `/copilot/knowledge` (12.2-a) list/add/delete; müşteriye kapalı; bot `:ro` oku / `:rw` düzenle yetki kapısı `CopilotKnowledge.tsx` · `TeamPage.tsx`'e iki bölüm (AI kümesi) · test `TeamAiPerformance.test.tsx`(5)+`CopilotKnowledge.test.tsx`(5) · tm 58 · §D41 |
| 04.6       | Chatbots / Suspended agents sekmeleri                                                                  | Should (v1)    | ✅ bot hesabı ücretsiz + suspend/unsuspend (KK birebir) — API `agents.ts` GET `/agents?status=active\|suspended\|all` (+`suspended` bayrağı, default `active`) + PUT `/agents/:id/suspension` (owner/admin çift kapı; owner askıya alınamaz; kendini/üst-rütbeyi askıya alma yok; cross-tenant 404; idempotent no-op; audit `member.suspended`/`unsuspended`) · askı membership'te → mevcut oturumlar sıradaki istekte ölür + routing o andan atamayı durdurur · web `TeamPage.tsx` **Chatbots** (`/ai-agents`, "Free — bots never use a seat") + **Suspended** (reinstate) + satır-içi Suspend · bot=ai_agent, koltuk tutmaz → askı koltuğu boşaltır/geri alır · OpenAPI `/agents/{agentId}/suspension` (contract-parity ✅) · test integration `agents-suspension.test.ts` (listing/sessions/routing/authz/billing) · tm 59 · §D37 |
| 07.4       | AI Agent raporu (resolution/deflection)                                                                | Should (v1)    | ✅ resolution/deflection — resolutions=ADR-09 (fatura ile aynı sorgu) · tm 44 · §D29 |
| 07.7       | Rapor grupları + Export (CSV)                                                                          | Should (v1–v2) | ✅ izin bazlı görünürlük + CSV export (benchmark/PDF v2) — katalog+CSV `reports-export.ts` (`REPORT_GROUPS`/`visibleReportGroups` boş-liste-değil-403 · `toCsv` RFC4180 + formül-enjeksiyon kalkanı · `exportFilename` UTC pencere) · rota `reports.ts` `GET /reports/groups` (yetki süzgeci) + `GET /reports/export` (EXPORT_SCOPES route-gate + grup-bazlı yeniden denetim · text/csv attachment + nosniff/no-store) · web rapor grupları = `ReportsPage.tsx` tabs (overview/ai-agent/reviews/breakdown) · OpenAPI `/reports/groups`+`/reports/export` (contract-parity ✅) · test unit `reports-export.test.ts`(11) + integration `reports-billing.test.ts` "report groups + CSV export (07.7)"(11) · tm 46 · §D35 |
| 07.8       | Reviews / Ratings                                                                                      | Should (v1)    | ✅ CSAT donut + günlük bar raporu · API `/reports/reviews` · e-commerce iskeleti · tm 45 · §D34 |
| 08.5.4     | Messenger (Facebook OAuth)                                                                             | Must (v1)      |             ✅ **MOCK adaptör** (tm 35)              |
| 08.5.5     | Twilio SMS                                                                                             | Must (v1)      |             ✅ **MOCK adaptör** (tm 35)              |
| 08.5.6     | WhatsApp (Business)                                                                                    | Must (v1)      |             ✅ **MOCK adaptör** (tm 35)              |
| 08.6.2     | Ticket rules (atama/etiket/öncelik)                                                                    | Should (v1)    | ✅ koşul+eylem motoru — `ticket_rules`+`ticket_tags` (RLS, migration `20260726180000`) · saf eşleşme `ticket-rule-matching.ts` (hasCondition/hasAction/matchesTicketRule) · uygulama `apply-ticket-rules.ts` (ticket create + createFromEmail kancası; atama/öncelik/etiket, position sırası, geçersiz hedefi atlar) · CRUD `ticket-rule-service.ts` + rota `/settings/ticket-rules` (`tickets--all:rw`/`:ro`) · web Settings "Ticket rules" formu (form-primitif, öncelik/etiket) · OpenAPI `TicketRule*`+ 4 yol (contract-parity ✅) · unit `ticket-rule-matching.test.ts`(7) + integration `ticket-rules.test.ts`(12: kural→otomatik atama · koşul/eylem zorunlu · cross-tenant) · tm 47 · §D43 |
| 08.7.3     | Chat timeout                                                                                           | Should (v1)    |          ✅ **idle auto-close sweep** (tm 48)          |
| 08.7.4     | Chat transcripts (e-posta)                                                                             | Should (v1)    | ✅ bitişte transcript e-postası (müşteri + ekip) — paylaşımlı kapanış yolu: `chat-service.ts` `#emailTranscript` hem `deactivate` (ajan arşivi) hem `deactivateByTimeout` (idle sweep) sonrası tx-dışı best-effort, RLS-scoped · saf `notifications/chat-transcript.ts` (`transcriptRecipients`: adres/atama/opt-out süzgeci · `renderTranscript`: müşteri kopyasından internal note [`recipients=agents`] süzülür, saf sistem-olayı sohbeti mail atmaz) · mailer `chats.ts`+`server.ts` rotasına ve `chat-timeout-run.ts` sweeper'ına bağlı (FileMailer A4 → `.data/mail`) · yeni API yolu yok (contract-parity ✅ değişmedi) · unit `services/notifications/chat-transcript.test.ts`(9) + integration `test/integration/chat-transcript.test.ts`(6: iki kapanış yolu · internal-note müşteriye gitmez · adres/atama/opt-out süzgeci · cross-tenant) · tm 49 · §D44 |
| 08.7.5     | Ticket email templates                                                                                 | Should (v1)    | ✅ markalı/değişkenli ticket e-posta şablonu — kayıtta geçersiz değişken/format engeli (KK birebir): paylaşımlı katalog+doğrulayıcı+renderer `template-variables.ts` (`TEMPLATE_VARIABLES` · `findTemplateProblems`/`findTemplateProblemsIn` · `renderTemplate`) → form (web) + endpoint (api) aynı tanımla "geçerli" der · servis `ticket-email-template-service.ts` (`assertPlaceholdersValid` create+edit; license-scoped CRUD) + rota `/settings/ticket-email-templates` (`tickets--all:rw`/`:ro`) · `ticket_email_templates` (RLS, migration `20260726190000`) · web Settings "Ticket email templates" formu (canlı alan-altı hata + Submit valid olana dek kapalı + optimistik toggle) · OpenAPI `TicketEmailTemplate`+2 yol (contract-parity ✅) · unit `template-variables.test.ts`(15) + web `SettingsForms.test.tsx`(+2) + integration `ticket-email-templates.test.ts`(10) · tm 50 · §D45 |
| 08.7.6     | Custom fields                                                                                          | Should (v1)    | ✅ tip/zorunluluk + Details/CRM'de görünür — `custom_field_definitions` (entity/type/required · unique(license,entity,label)) + `custom_field_values` (bir-varlık CHECK · RLS · definition/ticket/customer cascade) migration `20260726200000` · paylaşımlı tip-kataloğu+doğrulayıcı `@nexa/types/custom-fields.ts` `checkCustomFieldValue` (type+required; form ve endpoint aynı tanım) · servis `custom-field-service.ts` (tanım CRUD + `setValues` + `readCustomFieldValues`) · tanım rotası `/settings/custom-fields` (`access_rules:ro/rw`) + değer yazma `PUT /tickets/:id/custom-fields` (`tickets--*:rw`) & `PUT /customers/:id/custom-fields` (`customers:rw`) · `custom_fields` ticket detail (Details) + customer detail (CRM) yanıtına gömülü · web Settings "Custom fields" formu + paylaşımlı `<CustomFields>` TicketPane(Details)+CustomerDetailPanel(CRM) · OpenAPI `CustomFieldDefinition`/`CustomFieldValue`/`CustomFieldValuesInput` + 6 yol (contract-parity ✅) · unit `custom-fields.test.ts`(9) + web `CustomFields.test.tsx`(6)/`SettingsForms.test.tsx`(+2) + integration `custom-fields.test.ts`(13: yaz→Details/CRM oku · tip/zorunluluk · cascade · scope · cross-tenant) · tm 51 · §D46 |
| 08.7.7     | Forms builder (pre/post-chat)                                                                          | Should (v1)    | ✅ pre-chat form builder — alan(label/tip/required) → widget'ta gösterim → contact'a yazma (KK birebir): pre-chat alanı = `form_placement='pre_chat'` işaretli **contact** custom-field'ı (tm 51 makinesini yeniden kullanır) → yanıt tipine göre doğrulanır (`checkCustomFieldValue`) + CRM'de görünür, ayrı depo yok · migration `20260726210000` `form_placement` kolonu + CHECK (`pre_chat` yalnız `entity='contact'`; drift temiz) · `@nexa/types` `FORM_PLACEMENTS`/`PreChatFormField` + `CustomFieldDefinition.form_placement` · servis `custom-field-service.ts` (`listPreChatForm` + create/update `formPlacement`) · token mint `/customer/token` yanıtına `pre_chat_form` (best-effort, appearance emsali) · `/customer/chat/events` gövdesine `custom_fields` → ilk mesajla `setValues('contact')` (geçersiz tip/zorunlu-boş → 400, sohbet açılmadan) · web Settings "Pre-chat form" builder (`PreChatFormSettings`) · widget pre-chat formuna dinamik alanlar (`renderPreChatFields`; yanıtlar ilk mesajla gider; alan yoksa sabit 11.2 formu değişmez) · yeni API yolu yok (contract-parity 5/5) · widget `widget.prechat.test.ts`(4) + web `SettingsForms.test.tsx`(+2) + integration `customer-chat.test.ts`(+4) · **pre-chat teslim; post-chat placement modellenebilir ama widget render'ı ertelendi** · tm 52 · §D47 |
| 08.8.1     | Apps (marketplace) girişi                                                                              | Should (v1)    | ✅ Settings→Integrations girişi (KK "Üçüncü parti dizin (detay MOD-09)") — Apps rotası (`/app/apps`, MOD-09.1 grid) modül-rayında yok; tek giriş yolu buydu. Settings'e Channels'ın hemen altına **Integrations** bölümü + "Open marketplace" linki (`SettingsPage.tsx` `Integrations` export, `react-router` `Link` → `/app/apps`) · test `Integrations.test.tsx`(1: link href → `/app/apps`) · web unit 444→445 · additive (yeni Section/region "Integrations"; mevcut region adları + e2e seçicileri değişmez; API/OpenAPI/migration yüzeyi yok → contract-parity 5/5 & api integration etkilenmez) · tm 53.3 · §D51 |
| 09.1       | Entegrasyon kartları gridi                                                                             | Should (v1)    | ✅ entegrasyon kartları gridi + OAuth akışı (MOCK) — KK birebir _"kart → izin/OAuth akışı; bağlanınca veri sohbet içinde"_: statik katalog `@nexa/types/apps.ts` `APP_CATALOG` (grid+servis+test tek kaynak) + deterministik `appChatData` in-chat stub · servis `services/apps/app-service.ts` mock OAuth (HMAC-imzalı `state` = CSRF-bağlı, 10dk TTL, constant-time verify; idempotent upsert; cross-tenant chat → 404) + `app_installations` (RLS, license-scoped, migration `20260727090000`; drift temiz) · rota `/settings/apps` GET (`access_rules:ro/rw`) + OAuth start/callback + DELETE (`access_rules:rw`) + `GET /chats/:id/apps` (agent `chats--all:ro`/`chats--access:ro`) — admin connect'i, agent in-chat okumayı gate'ler · web `features/apps/AppsMarketplace.tsx` grid (connect/disconnect) + `/app/apps` rota + DetailsPanel "Apps" bölümü (bağlı-app verisi; boşsa "No connected apps") · OpenAPI `paths/apps.yaml` (5 yol) + `App*` şema, yeniden bundle+client (contract-parity 5/5) · unit `@nexa/types apps.test.ts`(4) + web `AppsMarketplace.test.tsx`(3) + integration `apps.test.ts`(7: mock OAuth→kurulu · in-chat veri · disconnect+404 · tampered/mismatch state reddi · yok→404 · ro-admin list-var connect-yok · cross-tenant izole) · tm 53.1 · §D49 |
| 09.2       | Entegrasyon listesi (15–20)                                                                            | Should (v1)    | ✅ tam entegrasyon dizini (20 kart) — KK birebir _"her biri OAuth/API key; kanal-tipli olanlar Channels'ta da yönetilir"_: katalog `@nexa/types/apps.ts` `APP_CATALOG` 09.1'in 5 kartını 20'ye büyüttü — 10 veri app'i (OAuth+API-key karışık: Salesforce/Intercom/Zendesk/WooCommerce/Magento/PayPal/Klaviyo/Slack/Jira/Segment) + 5 kanal-tipli kart (WhatsApp/Messenger/Instagram/Telegram/SMS-Twilio, `channel` set) · yeni `channel?: ChannelType` alanı + `dataLabel`/`dataFields` opsiyonel (kanal app'i in-chat veri taşımaz) + `isChannelApp`/`channelApps`/`connectableApps` bölücüleri + `AppListItem.channel` · servis `app-service.ts` `requireConnectableApp` kapısı: kanal app'inin marketplace OAuth-start/callback/disconnect'ini 400 ile reddeder (bir kanalın durumunu tek yüzey Settings→Channels yönetir) + `chatData` yalnız veri app'lerini yüzeye çıkarır · web `AppsMarketplace.tsx` `ChannelAppCard` = "In Channels" rozeti + "Manage in Channels" linki (`/app/settings#section-channels`), Connect yok · OpenAPI `AppListItem` kategori enum (+support/analytics/channels) + `channel` alanı (CHANNEL_TYPES ile birebir) → client yeniden üretildi (contract-parity 5/5) · unit `@nexa/types apps.test.ts`(+2: 15–20 kart & iki provider · kanal-çapraz partition) + web `AppsMarketplace.test.tsx`(+1: kanal kartı Channels'a linkler) + integration `apps.test.ts`(8, +1: tam liste 15–20 · kanal app channel/category · OAuth+disconnect 400) · tm 53.2 · §D50 |
| 10.1.4     | AI resolutions meter + stepper                                                                         | Must (v1)      | ✅ sayaç `N / limit (% used)` + %80 proaktif uyarı (aşımdan önce) + aşım paketi fiyatı önden — `BillingPage.tsx` (`ai-counter`/`quota-percent`/`quota-warning`/`overage-package`/`overage-charge`; figürler `/billing/usage` = fatura ADR-09) · test `BillingPage.test.tsx` (12: 6% sayaç · %80 uyarı · pack $0.50/$25.00 · 105% aşım) · tm 54 · §D53 |
| 10.1.5     | API calls (aşım paketi)                                                                                | Should (v1)    |                     ✅ tm 55                          |
| 10.3       | Invoices + payment details yönetimi                                                                    | Should (v1)    |                     ✅ tm 56                          |
| 11.7       | Widget customization (Appearance/Position/Mobile)                                                      | Should (v1)    | ✅ tema/renk/konum + mobil tam ekran + canlı önizleme + WCAG — license-singleton `widget_settings` (RLS+CHECK) · GET/PUT `/settings/widget` (`routes/settings.ts`, Zod+audit+upsert) · widget `applyAppearance` (`--nx-brand`/`data-nx-theme`/`.nx-left`/`.nx-mobile-full`+`@media(max-width:480px)`, mount + token'dan) · web `WidgetCustomization.tsx` **canlı preview** · çok dilli = I18N1/2 tr/en (tm 26) `data-language`→locale fallback (PRD "45+ dil" hedef, KK "çok dilli") · test `widget.appearance.test.ts`(9)/`loader.appearance.test.ts`(5)/`WidgetCustomization.test.tsx`(5)+integration `settings.test.ts` · OpenAPI `/settings/widget` · tm 57 · §D33 |
| 11.8       | Typing indicator (sneak-peek)                                                                          | Could (v1)     | ✅ ziyaretçi→ajan sneak-peek (11.8 KK) — widget `notifyTyping` → `POST /customer/chat/typing` (`SNEAK_PEEK_MAX_LENGTH`) → `chat-service.ts` `publishCustomerTyping` → `incoming_sneak_peek` **yalnız ajanlara** → `useInbox.ts` → `TypingIndicator.tsx` önizleme metni · aynı tm 41 bundle'ı (`+11.8`, 02.9 satırı ile ortak kod) · test integration `customer-chat.test.ts` (sneak-peek yalnız-ajana fan-out, metin doğrulanır) + web `typing.test.ts`(5)/`TypingIndicator.test.tsx`(4) + rtm `typing.test.ts`(6) · OpenAPI `/customer/chat/typing` · tm 41 · §D31 |
| 12.1–12.3  | **Copilot** (buton, ayrı KB, özet + yanıt yardımı)                                                     | Should (v1)    | ✅ **Copilot agent-assist (3 alt-görev, tm 36)** — **12.2-a ayrı KB:** `kind:'copilot'` AiAgent'a bağlı ayrı bilgi tabanı, AI-agent KB'sinden çift yönlü izole (`/knowledge-sources` `ai_agent`'a, `/copilot/knowledge` copilot ajanına süzülür → birbirini göstermez), **müşteri token'ı → 404** (agent+bot default principals, boundary=404), cross-tenant izole; `GET/POST/DELETE /copilot/knowledge` (`copilot.ts`→`copilot-service.ts` `ensureAgent`/`createSource`/`deleteSource`, SSRF-guard'lı website crawl + eşzamanlı indeks). **12.1-a buton+panel:** transcript header'da Copilot butonu → sağ panel Copilot sekmesi (`CopilotPanel.tsx`; `InboxPage` `panelTab` details↔copilot, chat değişince reset) → **Assisted metriğini besler** — her assist bir `skill_run` yazar = 07.3.2 reports "assisted" sorgusunun tam anahtarı (`recordAssist` copilot `workspace`-kind skill; kapalı chat + agent-event + skill_run ⇒ assisted). **12.3-a özet+yanıt+enhance (+02.5):** özet→internal note (`chats.sendEvent` recipients=agents); yanıt taslağı copilot KB'den RAG (son müşteri mesajı sorgu; eşleşme yoksa boş, uydurmaz) → `copilotDraft` store ile composer'a (`Composer` reply moduna geçer); enhance rephrase/friendly/formal/grammar (`@nexa/ai-mock` `enhanceText`/`summariseConversation` deterministik stub). OpenAPI 5 yol (`paths/copilot.yaml`, contract-parity ✅). `/skills`+`/knowledge-sources` `ai_agent`'a filtrelendi (copilot skill/source sızmaz). Test: integration `copilot.test.ts`(15: KB izolasyon negatifleri + summary→note + reply RAG + enhance + assisted-alignment 07.3.2) · unit `assist.test.ts`(14) · web `CopilotPanel.test.tsx`(7)/`copilotDraft.test.ts`(3)/`Composer.copilot.test.tsx`(2) · e2e `copilot.spec.ts`(1) · tm 36 · §D40 |
| 13.1       | Home dashboard                                                                                         | Should (v1)    | ✅ aktivasyon checklist (5 adım, gerçek state'ten türetilir: website/teammate/customize/canned/AI-agent) + canlı gerçek-zaman kartları (visitors_online = açık chat ∪ 30dk ziyaret UNION, ongoing_chats, agents_online = accepting_chats) + haftalık performans (bu hafta vs geçen: new chats/resolved/CSAT WoW delta) — `GET /home` (`reports_read`) `routes/home.ts` → `services/home/home-service.ts` (RLS + defansif license filtresi; weekly chats/resolved = Reports overview chats/closed ile aynı created-in-window taban, ADR-09 automated split'e dokunmaz) · şema `@nexa/types` `HomeDashboard` · OpenAPI `/home` (contract-parity ✅) · web `HomePage.tsx` + saf `dashboard.ts` kart view-model'leri · rota `/app/home` + nav "Home" (`nav.home` tr/en) · test unit `dashboard.test.ts`(8)+`HomePage.test.tsx`(4) [kartlar] + integration `home.test.ts`(13) [canlı sayaç + tenant isolation + scope] · tm 60 · §D34 |
| 13.6       | Omnichannel Ticketing / HelpDesk katmanı                                                               | Should (v1)    | ✅ **HelpDesk katmanı — backend ✅ (tm 61.1) + frontend ✅ (tm 61.2)** — chat↔ticket köprüsü (`source_chat` detail; Dilim 11 create-from-chat) + ticket yaşam döngüsü (status geçişleri artık `ticket.status_changed` audit'li) + **merge/unmerge** (non-destructive pointer `merged_into_id`; invariant: self-merge/zincir/primary-with-children/already-merged reddi + cross-tenant→404; unmerge = tam ters; merged ticket listeden gizli, primary'de `merged_ticket_ids`) + **followers** (add/remove idempotent, üyelik doğrulaması) + **priority** (int, PATCH) — hepsi audit'li (`ticket.merged`/`unmerged`/`follower_added`/`follower_removed`/`priority_changed`/`status_changed`). `routes/tickets.ts` (POST/DELETE `/tickets/:id/merge`, POST `/tickets/:id/followers`, DELETE `/tickets/:id/followers/:accountId`, priority via PATCH) → `ticket-service.ts`; migration `20260726160000_ticket_helpdesk` (`priority`, `merged_into_id` self-FK + no-self-merge CHECK, `ticket_followers` RLS=thread_tags deseni + GRANT); OpenAPI 3 yol + Ticket/TicketDetail alanları (contract-parity ✅); `@nexa/types` `TICKET_PRIORITY_*`. KK doğrulaması "integration (merge/unmerge invariant + audit)" birebir: `tickets-helpdesk.test.ts` (15). **Frontend HelpDesk yüzeyi ✅ (tm 61.2)** — `TicketDetailPane`'de priority seçici (4 seviyeli ölçek; `ticket-priority.ts` keyfi int'i en yakın seviyeye snap'ler) + followers (agent picker'dan ekle / satırdan çıkar) + merge (aday ticket listesinden birleştir) + unmerge (folded child'ı primary'nin panelinden veya child'ın merged-banner'ından geri al); merged ticket read-only (subject/status/priority disabled + banner); liste satırında priority pill. `useTickets.ts` HelpDesk hook'ları (merge/unmerge/addFollower/removeFollower/agents; id mutate-time'da) + `TicketDetail`/`TicketFollower` tipleri. `TicketPane.tsx` · `useTickets.ts` · `ticket-priority.ts` · `types.ts`; test `TicketPane.test.tsx` (8: priority PATCH · follower add/remove · merge · child+primary unmerge · list pill) + `ticket-priority.test.ts` (6) + e2e `tickets.spec.ts` (1, priority+follower canlı stack). NOT (`◐` değil): liste satırında **merged-child sayaç rozeti** liste özet payload'una `merged_ticket_ids`/`merged_count` alanı eklemeyi (backend+contract) gerektirir → frontend-scope dışı, ertelendi; merge/unmerge UI'dan tam çalışıyor (child'lar primary panelinde), KK'nın parçası değil. · §D38·§D39 |
| 13.7       | Mobil uygulamalar                                                                                      | Should (v1)    |       🔒 web-öncelikli (PRD §11.1/8 ile hizalı)       |

---

### 4.4 v1 Kırılımı (koda karşı denetlendi 2026-07-25 · GL-1 senkronu 2026-07-31)

> **Denetim.** §4.1/4.2/4.3 durumları koda karşı doğrulandı: Playbook backend skill CRUD +
> compile + preview + knowledge CRUD **var** (`routes/playbook.ts`, contract `playbook.yaml`);
> UI skill listesi + editör + knowledge paneli **var** (`PlaybookPage.tsx`, `SkillEditor.tsx`).
> **GL-1 güncellemesi (2026-07-31, tm 85 · §D53):** 2026-07-25'te "Eksik" işaretlenen kalemler
> **artık teslim ve testle doğrulandı** (odaklı süit fiilen koşuldu, HANDOFF GL-1 log): şablon
> galerisi (`TemplateGallery.tsx`/`RecommendedSkills.tsx`, 05.1/05.2 ✅), Drafts/tab ayrımı
> (`skill-tabs.ts`/`skill-filter.ts`, 05.3/05.4 ✅), **drag + klavye reorder** (`SkillEditor.tsx`
> + `step-reorder.ts`, 06.2.4 ✅ — tm 33.2), **website crawl + SSRF + RAG indeksleme**
> (`web-crawler.ts` + `lib/ssrf.ts` + `playbook.ts` `type:'website'`, 06.3.2 ✅ — tm 33.4), AI Agent
> Profile/Performance UI (`ProfileForm.tsx`/`AiPerformance.tsx`, 06.4/06.5 ✅), Copilot
> (`copilot.ts` + `CopilotPanel.tsx`, 12.x ✅ — tm 36), webhooks route/servis (HMAC + SSRF + retry,
> 08.8.4 ✅ — tm 34), AI resolutions meter UI (`BillingPage.tsx`, 10.1.4 ✅ — tm 54). **v1 `Must`
> açığı kalmadı**; tek bilinçli v2 payı = `06.3.2-bulk` bulk/CSV import (§5.1, Should).
>
> **v1 kapanış kapısı (§F.00):** v1 `Must` kalemleri = 05.1/05.3/05.5, 06.1–06.4, 08.5.4–.6,
> 08.8.4, 02.1.2, 04.2, 13.8-mobil-push(🔒). Bunların `0 ◐/⬜` olması gerekir. `Should`'lar
> bloklamaz. Aşağıdaki kırılım atomiktir; her alt-görev PRD KK'sını **birebir** taşır.

#### 4.4.1 · MOD-05 Playbook (öne çekildi — tamamlanacak)

**05.1-a — Browse templates galerisi + tür seçimi → editör** `[XHIGH]` · PRD 05.1
- **Neden açık:** `PlaybookPage.tsx`'te "Browse templates" / şablon galerisi yok (grep 0).
- **Kapsam:** header "Browse templates" → şablon kartı galerisi; kart seç → skill editörüne
  ön-doldurulmuş açılır. Şablonlar deterministik yerel katalog (dış servis yok).
- **KK (birebir):** _"Şablon galerisi; tür seçimi → editör"_.
- **KK doğrulama:** unit (galeri render + seç → editör ön-dolu); E2E şablondan skill oluşturma.
- **Testler:** unit + E2E. **Bağımlılık:** yok. **Kapsam dışı:** Workspace workflow türü (⛔ ADR-14).
- **Tahmin:** 1 pencere.

**05.2-a — Recommended skills kartları (Try this / See more)** `[XHIGH]` · PRD 05.2 *(Should)*
- **Neden açık:** önerilen şablon kartları yok.
- **Kapsam:** Prebuilt/AI/Trending kategorili kartlar; "Try this" → şablonu kopyalayıp editöre açar;
  entegrasyon gerektiren şablon uyarır.
- **KK (birebir):** _"[Try this] şablonu kopyalayıp editöre açar; entegrasyon gerektirenler uyarır"_.
- **KK doğrulama:** unit (Try this → editör kopya; entegrasyon-gerekli kart uyarı). **Bağımlılık:** 05.1-a.
- **Tahmin:** 1 pencere.

**05.3-a — Skill listesi sekmeleri (All/AI/Workspace/Drafts)** `[XHIGH]` · PRD 05.3
- **Neden açık:** liste var ama AI/Workspace/Drafts sekme ayrımı yok.
- **Kapsam:** `role=tablist` sekmeler; AI (✦) vs Workspace (⚡) vs Drafts (taslak) ayrımı;
  `Skill.status`/`kind` alanından filtre.
- **KK (birebir):** _"AI (✦) vs Workspace (⚡) vs taslak ayrımı"_.
- **KK doğrulama:** unit (her sekme doğru alt küme). **Bağımlılık:** yok. **Tahmin:** 1 pencere.

**05.4-a — Liste kontrolleri (Search/Sort/Filter)** `[XHIGH]` · PRD 05.4 *(Should)*
- **Kapsam:** ada göre debounce arama + tür/durum/sahip filtre + sıralama.
- **KK (birebir):** _"Ada göre arama; tür/durum/sahip filtre"_.
- **KK doğrulama:** unit (arama/filtre daraltır). **Bağımlılık:** 05.3-a, T4-a (form deseni). **Tahmin:** 1 pencere.

#### 4.4.2 · MOD-06 AI Agent + Knowledge/RAG (öne çekildi — tamamlanacak)

**06.1-a — AI Agent sekmeleri (Performance/Profile/Skills/Knowledge) + readiness check** `[XHIGH]` · PRD 06.1
- **Neden açık:** UI Skills + Knowledge panelini gösteriyor ama sekmeli AI Agent üst yapısı +
  readiness uyarısı yok.
- **Kapsam:** sekme kabuğu (Performance/Profile/Skills/Knowledge); KB/skill boşsa "AI'ı açma" uyarısı.
- **KK (birebir):** _"Tek yerde persona+yetenek+bilgi+performans; readiness check (KB/skill boşsa
  açma uyarısı)"_.
- **KK doğrulama:** unit (boş KB+skill → readiness uyarısı, aktive engeli). **Bağımlılık:** 06.4-a, 06.5-a.
- **Tahmin:** 1 pencere.

**06.2.4-a — Ordered steps: drag reorder + klavye alternatifi** `[MAX]` ↑ · PRD 06.2.4 · NFR-A11Y4
- **Neden açık:** adımlar var (`SkillEditor.tsx`) ama reorder yok (grep 0); a11y klavye alternatifi yok.
- **Yukarı yuvarlama gerekçesi (↑):** NFR-A11Y4 "sürükle-bırak yeniden sıralamaya klavye alternatifi"
  **kaynakta eksik, Nexa kritik** olarak işaretli — a11y sınırı + skill sırası davranışı değiştirir.
- **Kapsam:** adım reorder (drag) + **klavye ile taşıma** (yukarı/aşağı, ARIA duyuru); zorunlu
  parametre (transfer hedefi) boşsa hata.
- **KK (birebir):** _"Her adım araç çağrısı; drag reorder (+ klavye alternatifi); zorunlu parametre
  (ör. transfer hedefi) boşsa hata"_.
- **KK doğrulama:** unit (klavye reorder sıra değiştirir; boş zorunlu param → hata); a11y (odak +
  duyuru). **Negatif:** transfer hedefi boş → kaydetme reddi.
- **Testler:** unit + a11y + negatif. **Bağımlılık:** yok. **Tahmin:** 1 pencere.

**06.3.1-a — Knowledge alt sekmeler (All/Websites/Files/Articles/FAQ)** `[XHIGH]` · PRD 06.3.1
- **Kapsam:** tür bazlı filtre sekmeleri (`KnowledgeSource.type`).
- **KK (birebir):** _"Tür bazlı filtre"_.
- **KK doğrulama:** unit (her sekme doğru tür). **Bağımlılık:** yok. **Tahmin:** 1 pencere.

**06.3.2-a — + New source: Website crawl + geçersiz URL/tür reddi** `[MAX]` ↑ · PRD 06.3.2 · NFR-S7-benzeri
- **Neden açık:** POST `/knowledge-sources` yalnız verilen `content`'i indeksliyor; **website crawl**
  yok (dış URL çekme → SSRF sınırı).
- **Yukarı yuvarlama gerekçesi (↑):** dış URL çekme = **SSRF** yüzeyi (private/loopback reddi,
  redirect kapalı) — 08.8.4 ile aynı güvenlik sınırı; koda karşı negatif test şart.
- **Kapsam:** Website türü için crawl+parse (mock fetcher, deterministik) → chunk+embedding;
  geçersiz URL/tür reddi; SSRF guard (private IP/loopback/link-local reddi).
- **KK (birebir):** _"Geçersiz URL/tür reddi; crawl/parse; RAG indeksleme; bulk/CSV import (Nexa)"_.
- **KK doğrulama:** integration (crawl → chunk sayısı >0; geçersiz URL → 4xx; **SSRF negatif:**
  `http://169.254.169.254` / `localhost` → reddedilir). **Negatif testler pozitiften önce.**
- **Testler:** integration + SSRF negatif + cross-tenant. **Bağımlılık:** yok. **Kapsam dışı:** bulk/CSV (ayrı Should).
- **Tahmin:** 1–2 pencere (SSRF + crawl ayrışabilir).

**06.4-a — Profile (persona: Name/Avatar/Tone/Language/Answer length) UI + canlı preview** `[XHIGH]` · PRD 06.4
- **Neden açık:** `AiAgent` şemasında `persona`/`tone`/`languages`/`name`/`avatarUrl` var, `PATCH
  /ai-agents/:id` served; **Profile düzenleme UI'ı yok** (yalnız okunuyor).
- **Kapsam:** Profile formu (isim zorunlu, avatar, tone, language çoklu, answer length) → `PATCH`;
  canlı preview; widget persona'ya bağlanır (11.3 zaten ✅).
- **KK (birebir):** _"Widget'ta persona görünür; çok dilli; zorunlu isim"_.
- **KK doğrulama:** unit (zorunlu isim boş → submit pasif); integration (PATCH persist); E2E persona
  widget'ta görünür. **Bağımlılık:** T4-a (form deseni). **Tahmin:** 1 pencere.

**06.5-a — Performance (Resolution rate/AI chats/CSAT/Transferred %) + düşük-baz uyarısı** `[XHIGH]` · PRD 06.5 *(Should)*
- **Neden açık:** AI performans KPI ekranı yok (07.4 raporuyla akraba).
- **Kapsam:** KPI kartları (mevcut reports sorgularından); düşük-baz uyarısı; AI-off arşiv ayrımı.
- **KK (birebir):** _"KPI kartları; düşük-baz uyarısı; AI off iken arşiv ayrımı"_.
- **KK doğrulama:** unit (düşük-baz → uyarı; sayılar reports=fatura ADR-09). **Bağımlılık:** 07.4-a ile paylaşımlı sorgu. **Tahmin:** 1 pencere.

#### 4.4.3 · 08.8.4 Webhooks `[MAX]` (NFR-S7 · risk R1/R2 · v2-04 §6)

En yüksek güvenlik yüzeyi. Negatif testler pozitiflerden **önce** yazılır ve kırmızı görülür.

**08.8.4-a — Webhook kayıt API + kontrat (register/list/unregister)** `[XHIGH]` · PRD 08.8.4
- **Neden açık:** `webhooks` tablosu + `webhooks--all:rw` scope var (`principal.ts:107`), route/servis yok.
- **Kapsam:** kontrat → `POST/GET/DELETE /webhooks`; secret üretimi (bir kez gösterilir, hash saklanır).
- **KK payı (birebir):** _"register/list/unregister"_ · _"secret log'a yazılmaz"_.
- **KK doğrulama:** integration (CRUD + secret bir kez); **cross-tenant** (başka lisansın webhook'u görünmez).
- **Testler:** integration + cross-tenant. **Bağımlılık:** yok. **Tahmin:** 1 pencere.

**08.8.4-b — HMAC-SHA256 imzalama + timestamp/nonce** `[MAX]` · PRD 08.8.4 · NFR-S7
- **Kapsam:** çıkışta `X-Webhook-Signature` = HMAC-SHA256(secret, timestamp+body); ±5 dk pencere;
  nonce; `timingSafeEqual` doğrulama helper'ı; secret log'a **yazılmaz**.
- **KK payı (birebir):** _"HMAC-SHA256 imza (Nexa) + timestamp/nonce"_.
- **KK doğrulama:** unit (imza determinizmi + timingSafeEqual); **negatif:** yanlış imza/eski timestamp reddi.
- **Testler:** unit + negatif (önce). **Bağımlılık:** 08.8.4-a. **Tahmin:** 1 pencere.

**08.8.4-c — SSRF koruması (private/loopback/link-local reddi; redirect kapalı; http(s))** `[MAX]` · PRD 08.8.4 · NFR-S7
- **Kapsam:** hedef URL doğrulama — private/loopback/link-local IP reddi, DNS rebinding koruması,
  redirect kapalı, yalnız http(s).
- **KK payı (birebir):** _"SSRF koruması"_.
- **KK doğrulama:** **negatif (önce):** `127.0.0.1`/`10.x`/`169.254.169.254`/`file://`/redirect → reddedilir;
  pozitif: public https → geçer.
- **Testler:** negatif (önce) + pozitif. **Bağımlılık:** 08.8.4-a. **Tahmin:** 1 pencere.
- **Not:** 06.3.2-a (KB crawl) aynı SSRF guard'ı paylaşabilir — ortak `lib/ssrf.ts`.

**08.8.4-d — Teslimat + retry (3×) + her teslimat/retry loglanır** `[XHIGH]` · PRD 08.8.4 · NFR-M5/U4
- **Kapsam:** olay → kuyruk → teslim; 3× exponential retry; her deneme loglanır; başarısızlık işaretlenir.
- **KK payı (birebir):** _"retry (3×)"_ · (NFR-M5) _"her webhook teslimi/retry loglanır"_.
- **KK doğrulama:** integration (2 hata → 3. başarı; kalıcı hata → log + işaret). **Bağımlılık:** 08.8.4-a/b/c.
- **Tahmin:** 1 pencere.

#### 4.4.4 · MOD-08.5 Omnichannel adaptörleri (MOCK) `[XHIGH]`

Dış servisler MOCK (MASTER-PROMPT §5). Ortak adaptör arayüzü + kanal başına.

**08.5-adapter-a — Ortak kanal adaptör arayüzü + `channels` tablo tüketicisi** `[XHIGH]` · PRD 08.5.4–.6
- **Neden açık:** `channels` tablosu 0 tüketicili (§8); MVP kanalları `Website`+email kullanıyor.
- **Kapsam:** `ChannelAdapter` arayüzü (inbound→chat, outbound→gönder); `channels` tablosuna kayıt;
  mock provider iskeleti.
- **KK payı (birebir, ortak):** _"mesaj → inbox chat"_ / _"mesaj → chat"_.
- **KK doğrulama:** integration (mock inbound → chat oluşur; cross-tenant izole). **Tahmin:** 1 pencere.

**08.5.4-a Messenger (Facebook OAuth MOCK)** · **08.5.5-a Twilio SMS (MOCK)** · **08.5.6-a WhatsApp (MOCK)** — her biri `[XHIGH]`, ayrı alt-görev · PRD 08.5.4/.5/.6
- **Kapsam (her biri):** mock OAuth/kimlik + inbound webhook → chat + outbound gönder.
- **KK (birebir):** 08.5.4 _"OAuth; mesaj → inbox chat"_ · 08.5.5 _"Twilio kimlik/numara; SMS
  gönder-al"_ · 08.5.6 _"WhatsApp bağlama; mesaj → chat"_.
- **KK doğrulama (her biri):** integration (inbound→chat, outbound kaydı) + cross-tenant.
- **Bağımlılık:** 08.5-adapter-a. **Kapsam dışı:** gerçek sağlayıcı imzası/numara (§9 mock). **Tahmin:** her biri 1 pencere.

#### 4.4.5 · MOD-12 Copilot (agent-assist) — *Should (v1)*

**12.2-a — Copilot ayrı bilgi tabanı (RAG, ajana-özel)** `[MAX]` ↑ · PRD 12.2
- **↑ gerekçe:** ayrı tenant-scoped KB + "müşteriye açık değil" sınırı (yetki/izolasyon yüzeyi).
- **Neden açık:** api/contract'ta copilot ~0 ref. **Kapsam:** `/copilot/knowledge` CRUD; AI Agent
  KB'sinden **ayrı**; yalnız ajan yüzeyi. **KK (birebir):** _"Ajana-özel bilgi kaynakları; müşteriye
  açık değil"_. **KK doğrulama:** integration (müşteri token'ı erişemez → 404; cross-tenant izole).
- **Bağımlılık:** yok. **Tahmin:** 1 pencere.

**12.1-a — Copilot butonu + sağ panel sekmesi** `[XHIGH]` · PRD 12.1 — **KK (birebir):** _"Panel
  açılır; bağlamda yardım; Assisted metriğini besler"_ · doğrulama: unit (panel açılır) + Assisted
  sayacı 07.3.2 ile hizalı. **Bağımlılık:** T1-a (sağ panel switcher). **Tahmin:** 1 pencere.

**12.3-a — Özet (→internal note) + reply yardımı (enhance/rephrase)** `[XHIGH]` · PRD 12.3 · 02.5
  — **KK (birebir):** _"Özet internal note; reply taslak composer'a; ton/dilbilgisi geliştirme"_ ·
  doğrulama: integration (özet internal note olur, arşivde görünür) + unit (reply taslak composer'a).
  **Bağımlılık:** 12.1-a, 12.2-a (`packages/ai-mock`). **Tahmin:** 1 pencere. *(02.5 bu alt-görevle kapanır.)*

#### 4.4.6 · MOD-02 Inbox v1 kalemleri

- **02.1.2-a — AI Agents grubu (AI agent/Solved)** `[XHIGH]` · *Must v1* — KK: _"AI konuşmalarını
  insan kuyruğundan ayırır; Solved → AI resolution sayacı"_ · doğrulama: integration (AI chat ayrı
  grup; Solved=ADR-09 sayacı). **Bağımlılık:** yok. **Tahmin:** 1 pencere.
- **02.3.2-a — Reply Suggestions çipleri (Space ile)** `[XHIGH]` · *Should* — **✅ tm 39** · KK: _"Çip →
  composer'a düzenlenebilir metin"_ · doğrulama: unit (çip→composer düzenlenebilir) ✅. Composer'da **Space** (boş
  reply, mode='all') → cache'teki transcript'ten anlık türeyen AI çipleri; çip → composer'a **düzenlenebilir** metin
  (müşteri yanıtı, note değil). Escape geri alır, yazınca çekilir, note'ta yok. Deterministik saf `replySuggestions.ts`
  (ai-mock felsefesi — @nexa/ai-mock'a bağımlılık eklemeden; PRD §108 katman-3 hafif mikro-özellik, Copilot'tan ayrı) +
  `Composer.tsx` · test `replySuggestions.test.ts`(7)+`Composer.suggestions.test.tsx`(5). **Bağımlılık:** 12.x (ai-mock, ✅ tm 36). **Tahmin:** 1 pencere.
- **02.7-a — Tickets grid (sıralanabilir, deep-link)** `[XHIGH]` · *Should* — **✅ tm 40** · KK: _"Satır → ticket
  konuşması; URL param sıralama"_ · doğrulama: unit + E2E deep-link ✅. Sıralanabilir grid (VirtualTable T6-a; Subject/
  Customer/Status/Priority/Assignee/Last message, `aria-sort` başlıklar) + **URL param sıralama** (`ticket_sort`/
  `ticket_order` — paylaşılabilir/reload'da kalıcı deep-link) + **satır → ticket konuşması** (grid-first, satır→detay +
  `← Tickets`). Saf `ticket-grid.ts` + `TicketGrid.tsx` → `InboxPage.tsx`; client-side sort (yüklü sayfa, backend
  değişmedi). Test `ticket-grid.test.ts`(12)+`TicketGrid.test.tsx`(6)+e2e `tickets.spec.ts`. **Bağımlılık:** T6-a (✅). **Tahmin:** 1 pencere.
- **02.9-a — Live typing preview (sneak-peek)** `[XHIGH]` · *Should* — KK: _"RTM sender_typing/
  send_typing_indicator; sneak-peek"_ · doğrulama: integration (RTM typing push) + widget/agent görünüm.
  **Bağımlılık:** RTM (✅ Dilim 5). **Tahmin:** 1 pencere. *(11.8 ile akraba — birlikte kapanabilir.)*
- **02.1.4-a — Views grubu (kanal görünümleri + custom saved views)** `[XHIGH]` · *Should* — **✅ tm 38** · KK:
  _"Kanal bağlı değilse channel-promo; custom saved views eklenebilir"_ · doğrulama: unit (kanal yok→promo) ✅.
  Inbox **Views** grubu: kanal yok→**channel-promo** (Settings→Channels CTA), bağlıysa kanal satırları (Messenger/
  WhatsApp/SMS); **custom saved views** (base+traffic, `localStorage`, ekle/sil, reload'da kalıcı). Owner/admin
  `channels--all` kapılı — ajan `/channels` çağırmaz. Saf `views.ts` (+`useConnectedChannels`) + `InboxPage.tsx` ·
  test `views.test.ts` (19). **Bağımlılık:** 08.5 adaptörleri (✅ tm 35).

#### 4.4.7 · MOD-03 Customers/Campaigns v1

- **03.1.3-a — Ziyaretçi tablosu + satır aksiyonları (Start chat/Supervise/Assign)** `[XHIGH]` ·
  *Should* — KK: _"Proaktif temas; 'Chatting with' insan+AI ajanı gösterir"_ · doğrulama:
  integration (traffic akışı) + unit satır aksiyonları. **Bağımlılık:** 03.1.1 (✅ tm 19). **Tahmin:** 1 pencere.
- **03.3.1-a — Campaigns alt sekmeler (All/Ongoing/Scheduled/Inactive)** `[XHIGH]` · *Should* —
  `campaigns` tablosu 0 tüketicili (§8) — KK: _"Durum bazlı filtre"_ · doğrulama: unit (durum filtre).
  **Bağımlılık:** yok. **Tahmin:** 1 pencere.
- **03.3.2-a — New campaign builder (koşul+mesaj+zamanlama → otomatik gönderim)** `[MAX]` ↑ ·
  *Should* — **↑ gerekçe:** tetikleyici motoru + eşleşen ziyaretçiye otomatik gönderim (eşzamanlılık/
  yanlış-tetik riski). KK: _"Tetikleyici+mesaj zorunlu; kayıt sonrası eşleşen ziyaretçiye otomatik
  gönderim"_ · doğrulama: integration (koşul eşleşince gönderim; eşleşmeyince gönderilmez) + cross-tenant.
  **Bağımlılık:** 03.3.1-a, T4-a. **Tahmin:** 1–2 pencere.
- **03.3.3-a — Kampanya kartı (Edit/View report; active toggle)** `[XHIGH]` · *Should* — KK:
  _"Düzenleme + performans (Displayed/Chats/Conversion)"_ · doğrulama: unit. **Bağımlılık:** 03.3.2-a. **Tahmin:** 1 pencere.

#### 4.4.8 · MOD-07 Reports v1

- **07.4-a — AI Agent raporu (resolution/deflection)** `[XHIGH]` · *Should* — KK: _"Billing
  sayacıyla ilişkili"_ · doğrulama: integration (rapor=fatura ADR-09). **Bağımlılık:** yok (sorgu ADR-09 ✅). *(06.5-a ile paylaşımlı.)* **Tahmin:** 1 pencere.
- **07.8-a — Reviews/Ratings raporu (CSAT donut + günlük bar)** `[XHIGH]` · *Should* — **✅ tm 45**
  `GET /reports/reviews`: CSAT donut (good/bad/score, oy yoksa null) + günlük bar (UTC gün) + iki-dönem
  karşılaştırma (67% vs 57%) + e-ticaret satış izleme iskeleti (configured=false, §13.5 v2). KK:
  _"CSAT donut; günlük bar; e-ticaret satış izleme"_ · doğrulama: integration (rating okuma; oy yoksa null) ✅.
- **07.7-a — Rapor grupları + Export (CSV)** `[XHIGH]` · *Should (v1–v2)* — KK: _"İzin bazlı
  görünürlük; export; benchmark karşılaştırma"_ · doğrulama: integration (CSV export; izin gating).
  **Bağımlılık:** yok. **Tahmin:** 1 pencere. **Kapsam dışı:** PDF/benchmark (v2).

#### 4.4.9 · MOD-08 Settings/Inbox araçları v1

- **08.6.2-a — Ticket rules (atama/etiket/öncelik)** `[XHIGH]` · *Should* — KK: _"Koşul+eylem
  zorunlu"_ · doğrulama: integration (kural → otomatik atama). **Bağımlılık:** T4-a. **Tahmin:** 1 pencere.
- **08.7.3-a — Chat timeout (boşta/ölü sohbet otomatik kapanma)** `[XHIGH]` · *Should* — **✅ tm 48**
  · KK: _"Pozitif süre; ölü sohbet otomatik kapanma"_ · doğrulama: integration (timeout → kapanır) +
  negatif (0/negatif reddi). `inbox_settings.chat_timeout_seconds` (per-license, RLS) +
  `ChatTimeoutSweeper` (deactivateByTimeout paylaşımlı kapatma yolu; ADR-09 AI-resolution + queue-drain
  ortak). Endpoint `PUT/GET /settings/chat-timeout` (pozitif zorunlu). CLI: `chat-timeout:run`.
- **08.7.4-a — Chat transcripts (otomatik e-posta)** `[XHIGH]` · *Should* — KK: _"Bitişte müşteri/
  ekibe transcript e-postası"_ · doğrulama: integration (`.data/mail`). **Bağımlılık:** T7-a (mailer deseni). **Tahmin:** 1 pencere.
- **08.7.5-a — Ticket email templates (markalı, değişkenli)** `[XHIGH]` · *Should* — KK:
  _"Geçersiz değişken/format engeli"_ · doğrulama: unit (geçersiz değişken → hata). **Bağımlılık:** T4-a. **Tahmin:** 1 pencere.
- **08.7.6-a — Custom fields (ticket/contact)** `[XHIGH]` · *Should* — KK: _"Tip/zorunluluk;
  Details+CRM'de görünür"_ · doğrulama: integration (alan yaz→Details/CRM'de oku). **Bağımlılık:** T4-a. **Tahmin:** 1 pencere.
- **08.7.7-a — Forms builder (pre/post-chat) + widget'ta gösterim** `[MAX]` ↑ · *Should* — **↑
  gerekçe:** widget → contact/ticket yazma yolu (müşteri girdisi sınırı). KK: _"En az bir alan; tip
  validasyon; widget'ta gösterim → contact/ticket'a yazma"_ · doğrulama: integration (form→ticket) +
  negatif (geçersiz alan). **Bağımlılık:** T4-a, 11.2 (✅). **Tahmin:** 1–2 pencere.
- **08.8.1-a — Apps (marketplace) girişi** `[XHIGH]` · *Should* — KK: _"Üçüncü parti dizin (detay
  MOD-09)"_ · doğrulama: unit (giriş → 09.1). **Bağımlılık:** 09.1-a. **Tahmin:** 1 pencere.

#### 4.4.10 · MOD-09 Apps Marketplace v1

- **09.1-a — Entegrasyon kartları gridi + OAuth akışı (MOCK)** `[XHIGH]` · *Should* — KK: _"Kart →
  izin/OAuth akışı; bağlanınca veri sohbet içinde"_ · doğrulama: integration (mock OAuth → kurulu
  görünür). **Bağımlılık:** T6-a. **Tahmin:** 1 pencere.
- **09.2-a — Tam entegrasyon listesi (15–20 kart)** `[XHIGH]` · *Should* — KK: _"Her biri OAuth/API
  key; kanal-tipli olanlar Channels'ta da yönetilir"_ · doğrulama: unit (liste + kanal-tipli çapraz).
  **Bağımlılık:** 09.1-a. **Tahmin:** 1 pencere.

#### 4.4.11 · MOD-10 Billing v1

- **10.1.4-a — AI resolutions meter + stepper + %80 uyarı (UI)** `[XHIGH]` · *Must v1* — metering ✅
  (ADR-13), UI ⬜ — KK: _"Sayaç 'N/limit (% used)'; aşım paketi; %80 proaktif uyarı (Nexa)"_ ·
  doğrulama: unit (%80'de uyarı; sayaç metering'den). **Bağımlılık:** yok. **Tahmin:** 1 pencere.
- **10.1.5-a — API calls aşım paketi + sayaç** `[XHIGH]` · *Should* — **✅ tm 55** · KK: _"Aşım
  faturaya; sayaç"_ · doğrulama: integration (aşım → usage_records). Her PAT API çağrısı `onSend`
  hook'unda `usage_records.api_calls` sayacını arttırır; aşım blok başına ($29.50/100k) fiyatlanıp
  `estimated_total_cents`'e eklenir. **Bağımlılık:** yok. **Tahmin:** 1 pencere.
- **10.3-a — Invoices + payment details yönetimi** `[XHIGH]` · *Should* — **✅ tm 56** · KK: _"Fatura
  listesi/indirme; ödeme yöntemi güncelleme"_ · doğrulama: integration (fatura listesi mock).
  Faturalar subscription + usage_records'tan **türetilir** (ADR-13, ayrı tablo yok) — açık dönemin
  toplamı = `estimated_total_cents`; CSV indirme (injection-safe). Ödeme yöntemi: license-singleton
  `payment_methods` tablosu, yalnız **maskeli** alanlar (brand/last4/exp/holder), gerçek PAN alanı YOK.
  `PUT /billing/payment-method` read-only'de bile yazılabilir. **Kapsam dışı:** gerçek kart (§9, PRD
  §11.1/1). **Tahmin:** 1 pencere.

#### 4.4.12 · MOD-11 Widget v1

- **11.7-a — Widget customization (Appearance/Position/Mobile) + canlı önizleme** `[XHIGH]` ·
  *Should* — KK: _"Tema/renk/konum; mobil tam ekran; çok dilli; WCAG"_ · doğrulama: unit (tema uygular)
  + bundle P3 bütçesi korunur. **Bağımlılık:** i18n ✅ (tm 26). **Tahmin:** 1 pencere.
- **11.8-a — Typing indicator (sneak-peek)** `[XHIGH]` · *Could* — KK: _"RTM sneak-peek; ajan müşteri
  yazarken görür"_ · 02.9-a ile birlikte. **Tahmin:** 02.9-a'ya dahil.

#### 4.4.13 · MOD-04 Team v1

- **04.2-a — AI Agents (team tarafı) performance + Copilot knowledge girişi** `[XHIGH]` · *Must v1* —
  KK: _"Per-agent performance; Copilot knowledge yönetimi"_ · doğrulama: unit + 12.2-a bağı.
  **Bağımlılık:** 06.5-a, 12.2-a. **Tahmin:** 1 pencere.
- **04.6-a — Chatbots / Suspended agents sekmeleri** `[XHIGH]` · *Should* — KK: _"Bot hesabı
  ücretsiz; suspend/unsuspend"_ · doğrulama: integration (suspend → oturum/atama durur; bot faturasız).
  **Bağımlılık:** yok. **Tahmin:** 1 pencere.

#### 4.4.14 · MOD-13 Home / HelpDesk v1

- **13.1-a — Home dashboard (checklist + gerçek-zaman kartları + haftalık performans)** `[XHIGH]` ·
  *Should* — KK: _"Aktivasyon checklist; canlı gerçek-zaman kartları; haftalık performans"_ ·
  doğrulama: unit (kartlar) + integration (canlı sayaç). **Bağımlılık:** 03.1.1 (✅). **Tahmin:** 1–2 pencere.
- **13.6-a — Omnichannel Ticketing / HelpDesk katmanı (merge/priority/followers)** `[MAX]` ↑ ·
  *Should* — **↑ gerekçe:** ticket yaşam döngüsü + merge/unmerge veri bütünlüğü + audit. KK:
  _"Chat↔ticket köprüsü; ticket yaşam döngüsü; birleşik (ayrı ürün değil)"_ · doğrulama: integration
  (merge/unmerge invariant + audit). **Bağımlılık:** ticketing (✅ Dilim 11). **Tahmin:** 2+ pencere (böl).
- **13.7 Mobil uygulamalar** — 🔒 web-öncelikli (PRD §11.1/8 ile hizalı). v1 kapanışını **bloklamaz**;
  gerekçe: web parite önce.

### 4.5 GO-LIVE turu — kapanış + canlıya hazırlık kırılımı (2026-07-28)

> **Bu turun denetim bulguları (koda karşı, 2026-07-28):**
> 1. **Üç v1 satırı bayat:** §4.2'de 06.2.4 (`◐ drag-reorder ⬜`) ve 06.3.2 (`◐ website crawl ⬜`),
>    §4.3'te 10.1.4 (`◐ UI ⬜`) duruyor; oysa üçü de Task Master'da **done** (tm 33 alt-görevleri
>    06.2.4-a/06.3.2-a; tm 54) ve kod mevcut (`step-reorder.ts` + `SkillEditor.tsx` drag/klavye;
>    `web-crawler.ts` + `lib/ssrf.ts` + `playbook.ts` `type:'website'`; `BillingPage.tsx` meter +
>    `quota_warning`). Satır çevirisi kanıt ister → GL-1 denetim görevi.
> 2. **`.parked-playbook/`** izlenmeyen yarım iş olarak duruyor (SkillBrowser/RecommendedSkills/
>    skill-filters, 25 Tem); teslim edilen muadilleri repo'da (`TemplateGallery.tsx`,
>    `RecommendedSkills.tsx`, `skill-tabs.ts`, `skill-filter.ts`). → GL-2.
> 3. **Task Master kuyruğu boş** (62 done · 0 pending · 22 deferred) → panel critical bulgusu
>    "run-loop duracak". Faz kapanış turları hiç görev olarak açılmamıştı. → GL-3/GL-4.
> 4. **Kullanıcı kararı (2026-07-28):** proje hızla canlıya hazırlanacak; **dış entegrasyonlar
>    deferred kalır**; v2'nin üç saf-güvenlik kalemi (08.9.5 / 08.9.2 / 08.9.3) canlı sertleştirmesi
>    olarak öne çekilir — §5.1'in kendi istisnası zaten izin veriyor (_"saf güvenlik kuralları …
>    istenirse şimdi atomik bölünebilir"_). Sapma kaydı: **§D52**. Faz disiplini korunur: üçü de
>    **GL-4 (v1 kapanışı) bittikten sonra** başlar (bağımlılıkla zorlanır).

| GL | İş | PRD | tm | Bağımlılık | Tahmin |
| --- | --- | --- | :-: | --- | :-: |
| GL-1 | SYNC-a — v1 bayat satır senkron denetimi | 06.2.4 · 06.3.2 · 10.1.4 | 85 | — | 1 |
| GL-2 | PARK-a — `.parked-playbook/` temizliği | 05.3/05.4 (tarihçe) | 86 | — | 1 |
| GL-3 | F0-KAPAT — Faz-0 §F.00 kapanış turu | Faz-0 tümü | 87 | GL-1 · GL-2 | 1–2 |
| GL-4 | V1-KAPAT — v1 §F.00 kapanış turu | v1 tümü | 88 | GL-3 | 1–2 |
| GL-5 | 08.9.5-a/b — CC masking (Luhn, yazma anında) | 08.9.5 | 70 | GL-4 | 2 |
| GL-6 | 08.9.2-a — Banned customers tamamlama (IP + UI) | 08.9.2 | 68 | GL-4 | 1–2 |
| GL-7 | 08.9.3-a — Spam filtre (chat yolu + ortak motor) | 08.9.3 | 69 | GL-4 | 2 |

#### GL-1 · SYNC-a — v1 bayat satır senkron denetimi `[XHIGH]` · tm 85

- **Neden açık:** üç satır ile Task Master/kod arasında çelişki (yukarıdaki bulgu 1). Panelin
  "TM'de bitti, PLAN'da ◐" bulgu deseninin son üç örneği.
- **Kapsam:** her satır için KK **koda ve teste karşı** doğrulanır, odaklı test süiti koşulur,
  satır kanıt metniyle `✅`'a çevrilir; §4.4 girişindeki bayat "Eksik (grep/okuma ile doğrulandı)"
  bloğu güncellenir; §2 matrisinde MOD-05/MOD-06 satırları yeniden değerlendirilir.
  - **06.2.4** — KK: _"Her adım araç çağrısı; drag reorder (+ klavye alternatifi); zorunlu parametre
    (ör. transfer hedefi) boşsa hata"_ → `SkillEditor.tsx` (draggable + ↑↓) / `step-reorder.ts` /
    `stepIssues` + testleri.
  - **06.3.2** — KK: _"Geçersiz URL/tür reddi; crawl/parse; RAG indeksleme; bulk/CSV import (Nexa)"_
    → `web-crawler.ts` + `lib/ssrf.ts` (SSRF negatifler) + `playbook.ts`. **Not:** bulk/CSV, 06.3.2-a
    kırılımında bilinçli kapsam dışıydı (_"Kapsam dışı: bulk/CSV (ayrı Should)"_) → satır `✅`'a
    çevrilirken **06.3.2-bulk** ayrı `Should` kalemi olarak §5.1 tablosuna eklenir (bayatlamaz,
    gizlenmez).
  - **10.1.4** — KK: _"Sayaç 'N/limit (% used)'; aşım paketi; %80 proaktif uyarı (Nexa)"_ →
    `BillingPage.tsx` (`quota_warning`, aşım paketi fiyat teklifi) + testleri.
- **KK doğrulama:** satır başına odaklı süit (web unit: SkillEditor/step-reorder/BillingPage; api
  integration: knowledge crawl + SSRF negatif) **fiilen koşulur**, sonuç HANDOFF'a yazılır.
- **Sınır:** bu bir denetim/dokümantasyon görevi — kod değişikliği ÇIKMAMALI; KK açığı bulunursa
  satır ◐ KALIR, açık §D'ye yazılır ve ayrı görev açılır (satır asla kanıtsız çevrilmez).
- **Testler:** yukarıdaki odaklı süitler + `contract-parity`. **Bağımlılık:** yok. **Tahmin:** 1 pencere.
- **✅ Kapandı (2026-07-31 · tm 85 · §D53):** üç satır da kanıtla `✅` (odaklı süit yeşil: web unit
  27 [step-reorder 10 + SkillEditor 5 + BillingPage 12] · api unit 21 [ssrf 15 + web-crawler 6] ·
  integration `knowledge-crawl` 11). **Kod değişmedi** (saf denetim); KK açığı yok. §4.4 denetim
  bloğu + §2 matrisi (MOD-05/06 ✅, sayılarak) senkronlandı; §5.1'e `06.3.2-bulk` eklendi.

#### GL-2 · PARK-a — `.parked-playbook/` temizliği `[XHIGH]` · tm 86

- **Neden açık:** HANDOFF "parked" notu; izlenmeyen 6 dosya. Teslim edilen muadillerle (tm 32
  Playbook tamamlama) örtüşüyor — F.1/6 "sessiz borç" ve F.1/7 "ölü kod" maddelerini kirletir.
- **Kapsam:** dosya-dosya diff (parked ↔ teslim edilen muadil). Değerli fark varsa ilgili dosyaya
  taşınır + test; yoksa dizin silinir. Karar gerekçesiyle §D'ye yazılır. Sonuç: `git status`
  temiz (untracked 0).
- **KK doğrulama:** silme yolunda repo temiz; entegre yolunda web unit yeşil.
- **Testler:** dokunulan paketlerde typecheck+lint+unit. **Bağımlılık:** yok. **Tahmin:** 1 pencere.

#### GL-3 · F0-KAPAT — Faz-0 §F.00 kapanış turu `[MAX]` · tm 87

- **Neden açık:** §F.00'ın 9 kapanış alt-görevi (T1-a…T7-a) tm 27–31'de done; ama üst tablo hâlâ
  `45 ✅ · 6 ◐ — ❌ AÇIK` diyor ve **§F.1'in 10 maddesi tam sürüm hiç koşulmadı**. Faz "kendiliğinden"
  kapanmaz — kapanış bir turdur.
- **Kapsam:** (1) `Must` sayacı §3 satırlarından **sayılarak** doğrulanır (beklenen `51 ✅ · 0 ◐ ·
  0 ⬜`); (2) §F.1'in **10 maddesi tam sürüm** koşulur (kapsam süpürmesi PRD §6 Faz-0 payı · faz
  sızıntısı · NFR kapıları ölçümle · şema artıkları · contract-parity · sessiz borç grep'i · ölü
  kod · doküman tazeliği · temiz kurulum provası `make dev` · kapsam dışı doğrulaması); (3) üst
  tablo Faz-0 satırı ✅ KAPALI'ya çevrilir; (4) §F.2 raporu üretilir → HANDOFF.
- **KK doğrulama:** her §F.1 maddesinin kanıtı (komut çıktısı/test adı/ölçüm) HANDOFF'a madde
  madde yazılır. Kanıtsız "geçti" yok (§F.2 uyarısı).
- **Testler:** tam DoD kapısı + §F.1/9 temiz kurulum provası. **Bağımlılık:** GL-1, GL-2
  (doküman tazeliği ve sessiz-borç maddeleri bunlarsız yanlış-pozitif verir). **Tahmin:** 1–2 pencere.

#### GL-4 · V1-KAPAT — v1 §F.00 kapanış turu `[MAX]` · tm 88

- **Neden açık:** v1 `Must` kapısı (05.1/05.3/05.5 · 06.1–06.4 · 08.5.4–.6 · 08.8.4 · 02.1.2 ·
  04.2 · 13.8-mobil-push 🔒) GL-1 sonrası `0 ◐/⬜` bekleniyor; kapanış turu koşulmadı.
- **Kapsam:** (1) v1 `Must` sayacı §4 satırlarından sayılır; (2) §F.1 10 madde v1 kapsamı için
  koşulur — **faz sızıntısı maddesinde** GL-5/6/7 öne çekmesi kontrol edilir: §D52'de belgeli
  sapmadır, ihlal değildir (belgesiz başka sızıntı ARANIR); (3) üst tablo v1 satırı kapatılır;
  (4) §F.2 raporu → HANDOFF. `Should` kalemlerinden ⬜ kalanlar raporda **ismen** listelenir
  (06.3.2-bulk dahil).
- **KK doğrulama:** GL-3 ile aynı disiplin — madde madde kanıt.
- **Testler:** tam DoD kapısı + tam E2E süiti (HANDOFF 2026-07-28 notu: son bakım penceresi tam
  kapıyı koşmadı — burada koşulur). **Bağımlılık:** GL-3. **Tahmin:** 1–2 pencere.

#### GL-5 · 08.9.5-a/b — CC masking (Luhn, yazma anında) `[MAX]` ↑ · tm 70 *(v2'den öne — §D52)*

- **Neden şimdi:** canlı müşteri trafiğinde PAN (kart numarası) sohbete yazılabilir; KK "DB/log'a
  maskeli yazılır (yalnız UI değil)" canlıda gerçek PCI SAQ A sınırıdır. Kodda maskeleme yok
  (yalnız `payment-method-service.ts` kendi maskeli alanlarını tutuyor — farklı iş).
- **08.9.5-a — Maskeleme çekirdeği + yazım yolları** `[MAX]`
  - **Kapsam:** saf lib `apps/api/src/lib/cc-mask.ts` — 13–19 haneli aday diziler (boşluk/tire
    ayraçlı varyantlar dahil) yakalanır, **Luhn doğrulanır**, geçenler `**** **** **** 1234`
    biçimine maskelenir. Sonra **tüm event yazım yolları** kaynağında maskeler: `chats.ts` (ajan
    eventi), `customer.ts` (widget eventi + pre-chat `custom_fields`), `email-inbound.ts` (konu).
    Kaynakta maskelendiği için RTM push + transcript e-postası da otomatik maskeli.
  - **KK (birebir):** _"PCI SAQ A; DB/log'a maskeli yazılır (yalnız UI değil)"_.
  - **KK doğrulama `[MAX]` — NEGATİF ÖNCE:** (a) Luhn **geçmeyen** 16 hane (sipariş no) MASKELENMEZ
    (yanlış-pozitif sınırı); (b) telefon/UUID/timestamp dokunulmaz; SONRA pozitifler: geçerli PAN
    (ayraçlı/ayraçsız) → DB'de ham PAN **yok** (doğrudan SQL ile doğrulanır), maskeli metin var.
- **08.9.5-b — Log/yan-kanal doğrulaması** `[MAX]`
  - **Kapsam:** request log, `audit_log` meta, FileMailer çıktıları (`.data/mail`), skill/AI
    yollarına giden metin — ham PAN sızmadığı integration testle kanıtlanır; NFR-C5/S9 satırına
    işlenir.
- **Testler:** unit tablo-testleri + integration (DB + yan kanallar) + cross-tenant.
  **Bağımlılık:** GL-4. **Tahmin:** 2 pencere.

#### GL-6 · 08.9.2-a — Banned customers tamamlama (IP yasağı + UI) `[XHIGH]` · tm 68 *(v2'den öne — §D52)*

- **Mevcut (koda karşı, 2026-07-28):** visitor/customer yasağı **çalışıyor** — `Customer.bannedAt`,
  segment `banned`, PATCH ban/unban (`customers.ts`), token mint reddi (`auth.ts` `customer_banned`)
  + chat start reddi (`chat-service.ts`). **Eksik:** `SecuritySettings.bannedCustomerIps` kolonu
  şemada var ama **hiçbir yerde okunmuyor** (grep 0) → IP yasağı uygulanmıyor; Settings→Security'de
  yönetim yüzeyi yok.
- **Kapsam:** (1) IP yasağı enforcement — `/customer/token` mint + chat start yolunda istemci IP'si
  `bannedCustomerIps` ile karşılaştırılır, yasaklıya `customer_banned` zarfı; (2) kontrata
  `banned_customer_ips` alanı (`/settings/security` GET/PATCH, tm 1 deseni) + Settings→Security
  UI listesi; (3) CustomersPage'de ban/unban aksiyonunun UI'dan erişilebilirliği doğrulanır
  (yoksa eklenir).
- **KK (birebir):** _"Yasaklı sohbet başlatamaz"_.
- **KK doğrulama:** integration — yasaklı IP → token 403 + sohbet başlatamaz; yasaklı visitor →
  aynı (regresyon); unban → tekrar başlatabilir; **cross-tenant:** A lisansının yasağı B'yi
  etkilemez (ZORUNLU).
- **Testler:** integration + cross-tenant + UI unit. **Bağımlılık:** GL-4. **Tahmin:** 1–2 pencere.

#### GL-7 · 08.9.3-a — Spam filtre (ortak motor + chat yolu) `[MAX]` ↑ · tm 69 *(v2'den öne — §D52)*

- **Mevcut (koda karşı):** `SecuritySettings.spamFilterEnabled` var ve **yalnız** `email-inbound.ts`
  kullanıyor (sağlayıcı spam bayrağı). Chat yolunda hiçbir filtre yok.
- **Kapsam:** (1) **deterministik** kural motoru `services/security/spam-filter.ts` — link
  yoğunluğu, tekrar oranı, karakter/entropi eşiği, blocklist; **LLM yok** (test edilebilirlik +
  yanlış-pozitif denetimi); (2) widget chat start / ilk mesaj yoluna bağlanır (`spamFilterEnabled`
  kapısı); e-posta yolundaki mevcut kanca aynı motora bağlanır (tek doğruluk kaynağı); (3) spam
  kararının davranışı (sessiz drop mu, zarflı red mi) task içinde kararlaştırılır → §C'ye yazılır.
- **KK (birebir):** _"Spam sohbet/ticket otomatik filtre"_.
- **KK doğrulama `[MAX]` — NEGATİF ÖNCE:** normal müşteri mesajı **geçer** (yanlış-pozitif sınırı,
  gerçekçi örnek seti); SONRA: spam örnek seti düşer; filtre kapalıyken geçer; cross-tenant ayar
  izolasyonu.
- **Testler:** unit (kural motoru tablo-testleri) + integration (chat + email iki yol) +
  cross-tenant. **Bağımlılık:** GL-4. **Tahmin:** 2 pencere.

#### GO-LIVE sonrası deferred kalanlar (kullanıcı kararı 2026-07-28 — değişmedi)

Dış entegrasyon/uyumluluk kalemleri **deferred kalır**: tm 63/64 (Reports v2) · tm 65/79
(Instagram/Telegram) · tm 66 (skills-routing) · tm 67 (MCP) · tm 71/72 (API paketleri/Zapier) ·
tm 73–78 (Engage/Goals/Sales/KB/scheduler/Multibrand) · tm 80–84 (Ent. güvenlik/uyumluluk).
Gerçek servis geçişleri (Stripe/SMTP/S3/ClamAV) kod değil **yapılandırma** işidir (provider
desenleri hazır: A4/A5, `STORAGE_PROVIDER`, `VIRUS_SCANNER`) ve PRD §11.1 + CLAUDE.md sınırı
gereği bu depodan yapılmaz.

## 5. FAZ 2 — v2 (PRD §5.3)

**PRD amacı:** _"Skill builder + Copilot BI + gelişmiş operasyon."_
**Çıkış kriteri (PRD):** temsilci başına çözülen ≥%25 artış · NPS ≥40 · hesap başına ≥3 aktif entegrasyon.

| PRD    | Gereksinim                                        | Öncelik          | Not                                                 |
| ------ | ------------------------------------------------- | ---------------- | --------------------------------------------------- |
| 07.5   | Metrics breakdown (ajan/takım/kanal/saat)         | Should (v2)      |                                                     |
| 07.6   | Chat topics (AI kümeleme)                         | Could (v2)       |                                                     |
| 08.5.7 | Instagram (DM)                                    | Should (Ent./v2) |                                                     |
| 08.6.3 | Skills-based routing + supervision/takeover       | Could (v2)       |                                                     |
| 08.8.3 | MCP server (search_tickets/list_chats/get_report) | Could (v2)       |                                                     |
| 08.9.2 | Banned customers                                  | Should (v2)      | **→ öne çekildi §4.5/GL-6 (tm 68, §D52)**           |
| 08.9.3 | Spam filtre                                       | Should (v2)      | **→ öne çekildi §4.5/GL-7 (tm 69, §D52)**           |
| 08.9.5 | CC masking (Luhn, yazma anında)                   | Should (v2)      | NFR-C5 · **→ öne çekildi §4.5/GL-5 (tm 70, §D52)**  |
| 09.3   | API istek paketleri                               | Could (v2)       |                                                     |
| 09.4   | Zapier/Make + Build-your-app                      | Could (v2)       |                                                     |
| 13.2   | Engage / Traffic (gelişmiş filtreler)             | Should (v2)      |                                                     |
| 13.3   | **Goals** (ziyaretçi→sohbet→dönüşüm hunisi)       | Should (v2)      | `Goal` modeli var                                   |
| 13.4   | Görsel Workflow builder (nodes/edges)             | Could (v2)       | ⛔ **ADR-14: UI yapılmayacak** (tablo şemada kalır) |
| 13.5   | Sales tracker                                     | Could (v2)       |                                                     |
| —      | Public KB (SEO'lu self-servis)                    | v2 (§5.3)        |                                                     |
| —      | Work scheduler / staffing prediction              | v2 (§5.3)        |                                                     |
| —      | Multibrand                                        | v2 (§5.3)        |                                                     |

### 5.1 v2 orta-derinlik kırılımı (derinlik politikası: faz başlarken bölünür)

> **Neden orta derinlik (uzunluk değil, bayatlama):** v2 başlarken kod tabanı değişmiş olacak;
> bugün yazılan ince kırılım yanlış güven verir (§1.2). İş kalemi + etiket + tahmini alt-görev
> sayısı + bağımlılık verilir; atomik KK kırılımı faz başında (§F.0 mini denetimle) yapılır.
> **İstisna (tam derinlik serbest):** saf güvenlik kuralları — 08.9.5 CC-masking, 08.9.3 spam
> filtre — kod tabanı değişse de değişmez; istenirse şimdi atomik bölünebilir.

| PRD  | İş kalemi                          | Etiket   | ~Alt-görev | Bağımlılık                    |
| ---- | ---------------------------------- | -------- | :--------: | ----------------------------- |
| 06.3.2-bulk | bulk/CSV KB import (Should) | `[XHIGH]`|   1–2      | 06.3.2-a ✅ (crawl+index yolu) |
| 07.5 | Metrics breakdown (kanal/saat)     | `[XHIGH]`|   2–3      | reports ✅ (gün/ajan zaten)   |
| 07.6 | Chat topics (AI kümeleme)          | `[XHIGH]`|   2        | ai-mock; yeterli-veri empty   |
| 08.5.7| Instagram (DM, MOCK)              | `[XHIGH]`|   2        | 08.5-adapter-a (v1)           |
| 08.6.3| Skills-based routing + takeover   | `[MAX]`  |   3–4      | routing ✅; supervision yeni  |
| 08.8.3| MCP server (search/list/report)   | `[MAX]` ↑|   3        | OAuth scope ✅; tenant izole   |
| 08.9.2| Banned customers                  | `[XHIGH]`|   1–2      | **→ §4.5/GL-6 (öne çekildi, atomik kırılım orada)** |
| 08.9.3| Spam filtre                       | `[MAX]` ↑|   2        | **→ §4.5/GL-7 (öne çekildi, atomik kırılım orada)** |
| 08.9.5| CC masking (Luhn, yazma anında)   | `[MAX]` ↑|   2        | **→ §4.5/GL-5 (öne çekildi, atomik kırılım orada)** |
| 09.3 | API istek paketleri               | `[XHIGH]`|   1–2      | billing ✅                    |
| 09.4 | Zapier/Make + Build-your-app      | `[XHIGH]`|   2–3      | 08.8.4 (v1) webhooks          |
| 13.2 | Engage/Traffic (gelişmiş filtre)  | `[XHIGH]`|   2–3      | `visits` ✅ · 03.1.x          |
| 13.3 | Goals (huni)                      | `[XHIGH]`|   2–3      | `goals` tablo ✅ · reports     |
| 13.4 | Görsel Workflow builder           | ⛔        |     0      | **ADR-14 — UI yapılmaz**       |
| 13.5 | Sales tracker                     | `[XHIGH]`|   2        | 07.8-a · 13.3                 |
| —    | Public KB (SEO self-servis)       | `[XHIGH]`|   2–3      | knowledge ✅                  |
| —    | Work scheduler / staffing         | `[XHIGH]`|   2–3      | reports · presence            |
| —    | Multibrand                        | `[MAX]` ↑|   3–4      | tenant/RLS (izolasyon sınırı) |

**v2 `↑` yukarı yuvarlananlar:** 08.8.3 (MCP — tool yüzeyi + tenant izolasyon), 08.9.3/08.9.5
(güvenlik kuralı), Multibrand (tenant izolasyon genişlemesi). ~toplam **35–45 alt-görev** (kaba).

---

## 6. FAZ 3 — Enterprise (PRD §5.4)

**Çıkış kriteri (PRD):** Enterprise ARR ≥%25 · SOC2 Type II + ISO 27001 · churn <%5/yıl.

| PRD    | Gereksinim                                       | Not                                                       |
| ------ | ------------------------------------------------ | --------------------------------------------------------- |
| 08.5.8 | Telegram                                         |                                                           |
| 08.9.6 | IP allowlist / oturum güvenliği                  |                                                           |
| —      | SAML 2.0 SSO + SCIM provisioning                 | NFR-S11                                                   |
| —      | HIPAA BAA + bölgesel barındırma (US/EU)          | ⚠️ ADR-12 tek bölge (`eu`) — Enterprise'da yeniden açılır |
| —      | SOC 2 Type II · ISO 27001 · tam audit log + SIEM | NFR-C6/C7/S12                                             |
| —      | White-label widget · SLA yönetimi · sandbox      |                                                           |
| —      | Sesli/telefon (voice/IVR)                        | ⛔ MVP–v2 kapsam dışı (PRD §11.1/3)                       |
| —      | Gerçek zamanlı canlı çeviri · sesli sentiment    | ⛔ MVP–v2 kapsam dışı (PRD §11.1/4)                       |
| —      | Veri ambarı export (Snowflake/BigQuery)          | ⛔ P3 (PRD §11.1/5)                                       |

### 6.1 Enterprise orta-derinlik kırılımı

> Orta derinlik (bayatlama gerekçesi §5.1 ile aynı). Uyumluluk kalemleri kod değil **süreç/denetim**
> ağırlıklı (takvim uzun — dış denetim 6–12 ay, PRD §10.2).

| PRD    | İş kalemi                                | Etiket   | ~Alt-görev | Not                                        |
| ------ | ---------------------------------------- | -------- | :--------: | ------------------------------------------ |
| 08.5.8 | Telegram (TR pazarı önceliği)            | `[XHIGH]`|   2        | 08.5-adapter-a                             |
| 08.9.6 | IP allowlist / oturum güvenliği          | `[MAX]` ↑|   2        | güvenlik sınırı                            |
| —      | SAML 2.0 SSO + SCIM provisioning         | `[MAX]` ↑|   4–5      | NFR-S11; kimlik sınırı                     |
| —      | HIPAA BAA + bölgesel barındırma          | `[MAX]` ↑|   3–4      | ADR-12 tek bölge (`eu`) yeniden açılır     |
| —      | SOC2 Type II · ISO 27001 · audit+SIEM    | `[MAX]` ↑|   süreç    | NFR-C6/C7/S12; audit yazıcı ✅ temeli var  |
| —      | White-label widget · SLA · sandbox       | `[XHIGH]`|   3–4      | 11.5 · widget ✅                           |
| —      | Sesli/telefon (voice/IVR)                | ⛔        |     0      | PRD §11.1/3 kapsam dışı                     |
| —      | Gerçek zamanlı çeviri · sesli sentiment  | ⛔        |     0      | PRD §11.1/4 kapsam dışı                     |
| —      | Veri ambarı export                       | ⛔        |     0      | P3 (§11.1/5)                                |

**Enterprise:** çoğu `[MAX]` (güvenlik/uyumluluk/kimlik sınırları). Kod ~alt-görev **20–25** +
sertifikasyon **süreç** işi (takvim-belirleyici).

---

## 7. Çapraz Kesit ve NFR Kapıları (PRD §6 FR-EK + §7)

Bunlar bir dilim değil, **her dilimin kabul koşulu**. Yeni ekran/endpoint eklerken kontrol edilir.

### 7.1 FR-EK — Çapraz kesit desenler

| PRD    | Desen                                                                                                     | Öncelik      |                      Durum                       |
| ------ | --------------------------------------------------------------------------------------------------------- | ------------ | :----------------------------------------------: |
| EK-A.1 | Form & girdi mantığı — tek validasyon kütüphanesi, alan-altı hata, geçersizken submit pasif               | Must (MVP)   | ◐ **denetim:** backend zod (18 dosya) ✅ ama **frontend form validasyonu elle**, ortak kütüphane/alan-altı hata deseni ⬜ (§3.13/T4) |
| EK-A.2 | Ortak girdi davranışları — debounce arama, dropdown, stepper, optimistic toggle, yarım-form kapatma onayı | Must (MVP)   |         ◐ debounce/stepper/optimistic dağınık var, yarım-form kapatma onayı ⬜ (§3.13/T5)         |
| EK-B.1 | Sayfalama & yükleme — virtualized grid, infinite scroll, skeleton, **anlamlı empty state**                | Must (MVP)   |     ◐ keyset pagination ✅ · **virtualization (10k satır) ⬜**, empty state tutarsız (§3.13/T6)     |
| EK-C.1 | Realtime katman — WebSocket push (polling değil) + reconnect telafi                                       | Must (MVP)   |                    ✅ Dilim 5                    |
| EK-C.2 | Banner/dropdown/panel/modal — tek tasarım sistemi                                                         | Should (MVP) | ✅ tek design-system `components/ui/{Banner,Dropdown,Modal,Panel}` — mevcut kopyalar oturtuldu · Banner segmentli + kalıcı dismiss · test (22) · tm 62 |

### 7.2 NFR kapıları (PRD §7 — 58 madde)

Faz-0 kapanışında doğrulanacak olanlar:

| NFR      | Hedef                                               |                                                                                                                                                                                    Durum                                                                                                                                                                                     |
| -------- | --------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
| P1       | RTM fan-out gecikmesi                               |                                                                                                                                                                              ✅ ölçüldü (13 ms)                                                                                                                                                                              |
| P3       | Widget bundle bütçesi                               |                                                                                                                                                                         ✅ 5.3 KB gzip (bütçe 50 KB)                                                                                                                                                                         |
| P4/P6    | Virtualized liste + büyük liste sorguları           |                                                                                                                                                                                      ◐ — **P6** (büyük liste sorgusu) çoğunlukla ✅ (keyset + `events` RANGE partition). **P4** (10k satır 60fps) ⬜ → kırılım **§3.13/T6-a** (virtualization). Faz-0 Must ◐.                                                                                                                                                                                       |
| S1–S5    | Auth · token · scope · **tenant izolasyonu** · IDOR |                                                                                                                                                                         ✅ Dilim 2 (negatif testli)                                                                                                                                                                          |
| S6       | Widget izolasyonu (`innerHTML` yasak)               |                                                                                                                                                                          ✅ Dilim 6 (eslint kuralı)                                                                                                                                                                          |
| **S7**   | **Webhook HMAC + SSRF**                             |                                                                                                                                                       ⬜ v1 — kırılım **§4.4.3** (08.8.4-b HMAC + 08.8.4-c SSRF, ikisi de `[MAX]`; negatif testler önce). Ortak `lib/ssrf.ts` 06.3.2-a (KB crawl) ile paylaşılır.                                                                                                                                                       |
| S8       | Rate limiting                                       |                                                                                                                                                                                  ✅ ADR-07                                                                                                                                                                                   |
| **S10**  | **File sharing güvenliği**                          |                                                                                                                                                                 ✅ Dilim 13 (fail-closed virüs tarama, tm 4)                                                                                                                                                                 |
| S12      | Audit log (append-only)                             |                                                                                                                           ✅ yazıcı bağlandı (tm 23): 12 güvenlik olayı INSERT ediliyor · UPDATE/DELETE DB'de reddi · cross-tenant izole · PII yok                                                                                                                           |
| A11Y1–6  | WCAG 2.1 AA · klavye · ⌘K                           |                                                                                                                                                                       ✅ 01.1.3 (⌘K) Dilim 14 (tm 18)                                                                                                                                                                        |
| I18N1/2  | Widget + panel i18n                                 | ✅ tm 26 (26.1–26.4): bağımlılıksız katalog (tr/en) + t() fallback zinciri (aktif locale→en→anahtar, eksik-anahtar güvenliği) · panel shell/nav/⌘K t()'ye taşındı + hesap menüsü dil değiştirici · widget `createTranslator` (data-language → sabit locale, runtime değişimi yok) · format.ts Intl helper'ları locale'e bağlı · testler: t() fallback unit (panel+widget) · panel locale-switch smoke · widget mount-locale smoke · bundle P3 7.57 KB gzip ≪ 50 KB |
| C1/C2/C8 | GDPR · KVKK · retention                             | ✅ retention job bağlandı (tm 24): tenant-döngülü hard-delete (kapanmış thread→event/tag cascade · visit telemetri · `.data` mail) · `retention_list_tenants()` SECURITY DEFINER sayımı + RLS-scoped `withTenant` silme (cross-tenant fiziksel imkânsız) · pozitif-pencere guard · **dry-run varsayılan** (`--apply` ile siler) · idempotent · audit `data.retention_pruned` |
| M4       | Test piramidi (unit + integration + contract + E2E) |                                                                                                                                                              ✅ 752 test (258 unit + 454 integration + 40 E2E)                                                                                                                                                               |
| M5       | Gözlemlenebilirlik (`request_id`, OTel, metrikler)  |                 ✅ OTel bağlandı (tm 25): request/route SERVER span'i + `request_id` attribute (log `reqId` + `X-Request-Id` ile aynı) · `http.server.requests`/`.request.duration`/`.errors` metrikleri · konsol exporter (collector yok — sınır) · `OTEL_ENABLED` ile aç/kapa (test'te varsayılan kapalı) · in-memory exporter'a karşı 3 entegrasyon testi                 |

---

## 8. Veri Modeli (PRD §8.4) — tablo durumu

41 model migrate edildi (`schema.prisma`), tümünde RLS (Dilim 3). **Tüketici taraması (denetim
2026-07-25):** `apps/api/src` içinde her modelin `prisma.<model>.*` çağrıları sayıldı. Sonuç:

| Tablo       | Tüketici (2026-07-25 sayım)          | Bekleyen gereksinim | Faz / karar                                |
| ----------- | ------------------------------------ | ------------------- | ------------------------------------------ |
| `webhooks`  | **0** (yalnız `webhooks--*` scope)   | 08.8.4              | v1 → §4.4                                  |
| `campaigns` | **2** (✅ `CampaignService` oku/yaz + yeni `campaign_sends`) | 03.3.x ✅ | **kullanılıyor** (tm 43); trigger motoru + kart |
| `channels`  | **0** (MVP kanalları `Website`+email-inbound kullanır, bu tabloyu değil) | 08.5.4–.6 | v1 → §4.4         |
| `ratings`   | **1** (yalnız yazma `/customer/chat/rating`) | 07.8       | v1 (okuma/rapor ⬜) → §4.4                  |
| `goals`     | **0**                                | 13.3                | v2                                         |
| `visits`    | **3** (✅ yazma widget + okuma `getCustomer`) | 13.2 / 02.4 inbox | **kullanılıyor**; kalan tüketici: 02.4 (§3.13/T3) + 13.2 (v2). §8'in eski "kullanılmayan" iddiası düzeltildi (§D21) |
| `workflows` | **0**                                | 13.4                | ⛔ ADR-14 — tablo kalır, UI yapılmaz       |

**Karar:** `visits` dışındaki 0-tüketicili tablolar bir eksik özelliği bekliyor (silme kararı
yok — hepsinin bir PRD kimliği + fazı var; §G'de iş kalemi olarak izlenir). `workflows` bilinçli
artık (ADR-14). Silinen tablo yok.

---

## 9. Kapsam Dışı (PRD §11.1) — bilinçli olarak yapılmayanlar

1. **Gerçek ödeme/kart girişi** — Stripe MOCK (ADR-13). PRD §11.1/1 + PCI C1.
2. **Kaynak ürünün birebir kopyası** — marka varlığı/telif içerik kopyalanmaz.
3. **Ses/telefon (voice/IVR)** — Enterprise.
4. **Canlı çeviri, sesli sentiment** — Enterprise.
5. **Ayrı analitik ambar (ClickHouse/BigQuery), soğuk arşiv** — P3.
6. **KnowledgeBase için genel REST API** — yalnız marketplace entegrasyonu.
7. **Instagram/Telegram tam kanal** — v2/Enterprise.
8. **Masaüstü native uygulama** — web-öncelikli.
9. **Pazarlama sitesi / blog / SEO sayfaları** — ürün dışı.
10. **Detaylı görsel kimlik** — `design-brief.md` ayrı doküman.

**Ek olarak bu projeye özgü:** dış servisler MOCK (LLM `packages/ai-mock`, SMTP dosyaya,
Stripe lokal, object storage `.data/uploads`) · prodüksiyon deploy/DNS yok · tek bölge (`eu`, ADR-12).

---

## G. İş Kırılımı Dizini (Task Master aktarımı için)

> Bu tablo Task Master'a aktarımın kaynağıdır; her satır bir alt-görevdir ve §3.13/§4.4'teki tam
> alanları taşır. **Kullanıcı aktaracak** — bu turda aktarım yapılmadı. Her satır kendi kendine
> yeter; bağımlılıklar ID ile verilmiştir. Detay (KK birebir + doğrulama + testler) §3.13 (Faz-0)
> ve §4.4 (v1) altındadır.

### Önerilen dilim gruplaması

3–8 kalemlik dilimler; her dilimin bir teması, bir **§F.00 kapanış kapısı** ve bir **§F.0 mini
denetim** noktası olur. **Faz-0 önce kapanır** (§1.3 — v1 dilimine geçmeden).

| Dilim | Tema | Kalemler | Kapı |
| --- | --- | --- | --- |
| **F0-1** | Inbox ziyaret bilgisi + sağ panel | T1-a · T3-a · T3-b | 02.4/01.3 ◐→✅ |
| **F0-2** | Form katmanı (validasyon + davranış) | T4-a · T4-b · T5-a | EK-A.1/A.2 ◐→✅ |
| **F0-3** | Liste katmanı + e-posta bildirim | T6-a · T6-b · T7-a | EK-B.1/13.8 ◐→✅ · **Faz-0 kapanır** |
| **V1-Playbook** | Skill şablon + liste | 05.1-a · 05.2-a · 05.3-a · 05.4-a | — |
| **V1-AI** | AI Agent tamamlama | 06.1-a · 06.2.4-a · 06.3.1-a · 06.3.2-a · 06.4-a · 06.5-a | 06.x Must |
| **V1-Webhook** | Webhooks `[MAX]` | 08.8.4-a/-b/-c/-d | S7 kapısı |
| **V1-Channels** | Omnichannel MOCK | 08.5-adapter-a · 08.5.4-a · 08.5.5-a · 08.5.6-a | 08.5.x Must |
| **V1-Copilot** | Copilot | 12.2-a · 12.1-a · 12.3-a (+02.5) | — |
| **V1-Inbox** | Inbox v1 | 02.1.2-a · 02.1.4-a · 02.3.2-a · 02.7-a · 02.9-a(+11.8) | 02.1.2 Must |
| **V1-Customers** | Customers/Campaigns | 03.1.3-a · 03.3.1-a · 03.3.2-a · 03.3.3-a | — |
| **V1-Reports** | Reports v1 | 07.4-a · 07.7-a · 07.8-a | — |
| **V1-Settings** | Inbox araçları | 08.6.2-a · 08.7.3-a · 08.7.4-a · 08.7.5-a · 08.7.6-a · 08.7.7-a · 08.8.1-a | — |
| **V1-Apps** | Marketplace | 09.1-a · 09.2-a | — |
| **V1-Billing** | Billing v1 | 10.1.4-a · 10.1.5-a · 10.3-a | 10.1.4 Must |
| **V1-Widget** | Widget custom | 11.7-a | — |
| **V1-Team** | Team v1 | 04.2-a · 04.6-a | 04.2 Must |
| **V1-Home** | Home/HelpDesk | 13.1-a · 13.6-a `[MAX]` | — |

### Toplamlar

- **Atomik alt-görev:** **~59** (Faz-0 **9** + v1 **~50**). v2/v3 orta derinlik (item-level):
  v2 **~35–45**, v3 **~20–25** + sertifikasyon süreç işi (§5.1/§6.1).
- **Etiket dağılımı (Faz-0+v1):** `[MAX]` **8** (06.2.4-a, 06.3.2-a, 08.8.4-b, 08.8.4-c, 12.2-a,
  03.3.2-a, 08.7.7-a, 13.6-a — hepsi ↑ güvenlik/eşzamanlılık/izolasyon) · `[XHIGH]` **~51**.
- **Faz dağılımı:** Faz-0 = 9 (hepsi Must ◐ kapatıcı) · v1 = ~50 (Must ~18, Should ~32).
- **Tahmini pencere:** Faz-0 **~10** · v1 **~55–65** (kaba; `[MAX]` ve 2-pencere kalemler dahil).

### Kritik yol (en uzun bağımlılık zinciri)

`T4-a → T4-b` (Faz-0 form katmanı) **→ Faz-0 kapanır →** `07.4-a → 06.5-a → 06.1-a → 04.2-a`
(AI performans zinciri; 04.2-a hem 06.5-a hem 12.2-a bekler). Paralel uzun hat: `12.2-a → 12.1-a
→ 12.3-a → 02.3.2-a`. En uzun tekil kalem: **13.6-a** (HelpDesk, 2+ pencere, bölünecek).

### Faz kapanışını bloklayanlar (`Must` — §F.00 girdisi)

- **Faz-0:** T1-a · T3-a · T3-b · T4-a · T4-b · T5-a · T6-a · T6-b · T7-a (9 — hepsi). `Should`:
  EK-C.2 ✅ (tm 62); 03.1.1-kalan bloklamaz, v1'e taşınır.
- **v1:** 05.1-a · 05.3-a · 06.1-a · 06.2.4-a · 06.3.1-a · 06.3.2-a · 06.4-a · 08.5-adapter-a ·
  08.5.4-a · 08.5.5-a · 08.5.6-a · 08.8.4-a/-b/-c/-d · 02.1.2-a · 10.1.4-a · 04.2-a (~18).

### Düz tablo (aktarım kaynağı)

`ID | Başlık | PRD | Etiket | Bağımlılıklar | Faz | Dilim | ~Pencere`

| ID | Başlık | PRD | Etiket | Bağımlılık | Faz | Dilim | Pen |
| --- | --- | --- | --- | --- | --- | --- | :-: |
| T1-a | Sağ panel aç/kapa + Expand + persist | 01.3 | XHIGH | — | 0 | F0-1 | 1 |
| T3-a | getChat ziyaret bilgisi (kontrat+backend) | 02.4 | XHIGH | — | 0 | F0-1 | 1 |
| T3-b | Details ziyaret bölümleri (UI) | 02.4 | XHIGH | T3-a | 0 | F0-1 | 1 |
| T4-a | Form validasyon primitifi + 2 pilot | EK-A.1 | XHIGH | — | 0 | F0-2 | 1 |
| T4-b | Kalan Must formları taşı | EK-A.1 | XHIGH | T4-a | 0 | F0-2 | 1–2 |
| T5-a | Yarım-form kapatma onayı + davranış | EK-A.2 | XHIGH | T4-a | 0 | F0-2 | 1 |
| T6-a | Virtualized liste primitifi | EK-B.1/P4 | XHIGH | — | 0 | F0-3 | 1 |
| T6-b | Skeleton + anlamlı empty state | EK-B.1 | XHIGH | T6-a | 0 | F0-3 | 1 |
| T7-a | E-posta bildirim kanalı | 13.8 | XHIGH | — | 0 | F0-3 | 1 |
| 05.1-a | Browse templates galerisi | 05.1 | XHIGH | — | 1 | V1-Playbook | 1 |
| 05.2-a | Recommended skills kartları | 05.2 | XHIGH | 05.1-a | 1 | V1-Playbook | 1 |
| 05.3-a | Skill listesi sekmeleri | 05.3 | XHIGH | — | 1 | V1-Playbook | 1 |
| 05.4-a | Liste kontrolleri (search/sort/filter) | 05.4 | XHIGH | 05.3-a·T4-a | 1 | V1-Playbook | 1 |
| 06.1-a | AI Agent sekmeleri + readiness | 06.1 | XHIGH | 06.4-a·06.5-a | 1 | V1-AI | 1 |
| 06.2.4-a | Steps drag reorder + klavye | 06.2.4 | MAX↑ | — | 1 | V1-AI | 1 |
| 06.3.1-a | Knowledge alt sekmeler | 06.3.1 | XHIGH | — | 1 | V1-AI | 1 |
| 06.3.2-a | KB website crawl + SSRF | 06.3.2 | MAX↑ | — | 1 | V1-AI | 1–2 |
| 06.4-a | Profile (persona) UI + preview | 06.4 | XHIGH | T4-a | 1 | V1-AI | 1 |
| 06.5-a | AI Performance KPI | 06.5 | XHIGH | 07.4-a | 1 | V1-AI | 1 |
| 08.8.4-a | Webhook register API + kontrat | 08.8.4 | XHIGH | — | 1 | V1-Webhook | 1 |
| 08.8.4-b | HMAC-SHA256 imzalama | 08.8.4 | MAX | 08.8.4-a | 1 | V1-Webhook | 1 |
| 08.8.4-c | SSRF koruması | 08.8.4 | MAX | 08.8.4-a | 1 | V1-Webhook | 1 |
| 08.8.4-d | Teslimat + retry 3× + log | 08.8.4 | XHIGH | 08.8.4-a/-b/-c | 1 | V1-Webhook | 1 |
| 08.5-adapter-a | Kanal adaptör arayüzü + channels | 08.5.4–.6 | XHIGH | — | 1 | V1-Channels | 1 |
| 08.5.4-a | Messenger (OAuth MOCK) | 08.5.4 | XHIGH | 08.5-adapter-a | 1 | V1-Channels | 1 |
| 08.5.5-a | Twilio SMS (MOCK) | 08.5.5 | XHIGH | 08.5-adapter-a | 1 | V1-Channels | 1 |
| 08.5.6-a | WhatsApp (MOCK) | 08.5.6 | XHIGH | 08.5-adapter-a | 1 | V1-Channels | 1 |
| 12.2-a | Copilot ayrı KB (RAG) | 12.2 | MAX↑ | — | 1 | V1-Copilot | 1 |
| 12.1-a | Copilot butonu + panel sekmesi | 12.1 | XHIGH | T1-a | 1 | V1-Copilot | 1 |
| 12.3-a | Özet→note + reply yardımı | 12.3/02.5 | XHIGH | 12.1-a·12.2-a | 1 | V1-Copilot | 1 |
| 02.1.2-a | AI Agents grubu (AI/Solved) | 02.1.2 | XHIGH | — | 1 | V1-Inbox | 1 |
| 02.1.4-a | Views grubu + custom views | 02.1.4 | XHIGH | 08.5.x | 1 | V1-Inbox | 1 |
| 02.3.2-a | Reply Suggestions çipleri | 02.3.2 | XHIGH | 12.x | 1 | V1-Inbox | 1 |
| 02.7-a | Tickets grid (deep-link) | 02.7 | XHIGH | T6-a | 1 | V1-Inbox | 1 |
| 02.9-a | Live typing preview (+11.8) | 02.9 | XHIGH | — | 1 | V1-Inbox | 1 |
| 03.1.3-a | Ziyaretçi tablosu + aksiyonlar | 03.1.3 | XHIGH | — | 1 | V1-Customers | 1 |
| 03.3.1-a | Campaigns alt sekmeler | 03.3.1 | XHIGH | — | 1 | V1-Customers | 1 |
| 03.3.2-a | New campaign builder | 03.3.2 | MAX↑ | 03.3.1-a·T4-a | 1 | V1-Customers | 1–2 |
| 03.3.3-a | Kampanya kartı | 03.3.3 | XHIGH | 03.3.2-a | 1 | V1-Customers | 1 |
| 07.4-a | AI Agent raporu | 07.4 | XHIGH | — | 1 | V1-Reports | 1 |
| 07.7-a | Rapor grupları + Export CSV | 07.7 | XHIGH | — | 1 | V1-Reports | 1 |
| 07.8-a | Reviews/Ratings raporu | 07.8 | XHIGH | — | 1 | V1-Reports | 1 |
| 08.6.2-a | Ticket rules | 08.6.2 | XHIGH | T4-a | 1 | V1-Settings | 1 |
| 08.7.3-a | Chat timeout | 08.7.3 | XHIGH | — | 1 | V1-Settings | 1 |
| 08.7.4-a | Chat transcripts (e-posta) | 08.7.4 | XHIGH | T7-a | 1 | V1-Settings | 1 |
| 08.7.5-a | Ticket email templates | 08.7.5 | XHIGH | T4-a | 1 | V1-Settings | 1 |
| 08.7.6-a | Custom fields | 08.7.6 | XHIGH | T4-a | 1 | V1-Settings | 1 |
| 08.7.7-a | Forms builder (pre/post-chat) | 08.7.7 | MAX↑ | T4-a | 1 | V1-Settings | 1–2 |
| 08.8.1-a | Apps (marketplace) girişi | 08.8.1 | XHIGH | 09.1-a | 1 | V1-Settings | 1 |
| 09.1-a | Entegrasyon grid + OAuth MOCK | 09.1 | XHIGH | T6-a | 1 | V1-Apps | 1 |
| 09.2-a | Entegrasyon listesi (15–20) | 09.2 | XHIGH | 09.1-a | 1 | V1-Apps | 1 |
| 10.1.4-a | AI resolutions meter + %80 UI | 10.1.4 | XHIGH | — | 1 | V1-Billing | 1 |
| 10.1.5-a | API calls aşım + sayaç | 10.1.5 | XHIGH | — | 1 | V1-Billing | 1 |
| 10.3-a | Invoices + payment yönetimi | 10.3 | XHIGH | — | 1 | V1-Billing | 1 |
| 11.7-a | Widget customization | 11.7 | XHIGH | — | 1 | V1-Widget | 1 |
| 04.2-a | Team AI Agents performance | 04.2 | XHIGH | 06.5-a·12.2-a | 1 | V1-Team | 1 |
| 04.6-a | Chatbots/Suspended sekmeleri | 04.6 | XHIGH | — | 1 | V1-Team | 1 |
| 13.1-a | Home dashboard | 13.1 | XHIGH | 03.1.1 | 1 | V1-Home | 1–2 |
| 13.6-a | Omnichannel HelpDesk katmanı | 13.6 | MAX↑ | ticketing✅ | 1 | V1-Home | 2+ |
| GL-1 | SYNC-a — v1 bayat satır senkron denetimi (tm 85) | 06.2.4·06.3.2·10.1.4 | XHIGH | — | 1 | GO-LIVE | 1 |
| GL-2 | PARK-a — `.parked-playbook/` temizliği (tm 86) | 05.3/05.4 tarihçe | XHIGH | — | 1 | GO-LIVE | 1 |
| GL-3 | F0-KAPAT — Faz-0 §F.00 kapanış turu (tm 87) | Faz-0 tümü | MAX | GL-1·GL-2 | 0 | GO-LIVE | 1–2 |
| GL-4 | V1-KAPAT — v1 §F.00 kapanış turu (tm 88) | v1 tümü | MAX | GL-3 | 1 | GO-LIVE | 1–2 |
| GL-5 | 08.9.5-a/b — CC masking (Luhn, yazma anında) (tm 70) | 08.9.5 | MAX↑ | GL-4 | v2→GL | GO-LIVE | 2 |
| GL-6 | 08.9.2-a — Banned customers tamamlama (IP+UI) (tm 68) | 08.9.2 | XHIGH | GL-4 | v2→GL | GO-LIVE | 1–2 |
| GL-7 | 08.9.3-a — Spam filtre (ortak motor + chat) (tm 69) | 08.9.3 | MAX↑ | GL-4 | v2→GL | GO-LIVE | 2 |

> v2/v3 satırları §5.1 / §6.1'de item-level verildi (orta derinlik — faz başında atomik bölünür).

---

> Bu bölümden itibaren **tarihçedir**: tamamlanmış işin kaydı ve gerekçeleri.
> İleriye dönük plan §3–§6'dadır.

## A. Tarihçe — Dilim Detayları (Dilim 1–10)

### Dilim 1 — Bootstrap [MAX] ✅

**Teslim edildi (2026-07-22):** 78 unit test yeşil · typecheck 8/8 · lint 6/6 · format temiz ·
`make dev` çalışıyor · API+RTM `/health` 200 (db+redis canlı) · WS handshake doğrulandı
(ping→pong, bilinmeyen action reddi, `organization_id`'siz upgrade 400) · widget loader
1.09 KB gzip (bütçe 50 KB).

- pnpm workspace + Turborepo; `packages/types`, `packages/contract`, `packages/config`, `apps/api`, `apps/rtm`, `apps/web`, `apps/widget`
- `docker-compose.yml`: `pgvector/pgvector:pg17` + `redis:7-alpine` (başka imaj YOK)
- `Makefile`: `make dev` tek komut (docker up → migrate → seed → tüm app'ler)
- `GET /health` (api) + `GET /health` (rtm) → `{status, db, redis, version}`
- CI: GitHub Actions — typecheck + lint + unit test + build
- Kabul: `make dev` ayakta, `/health` 200, CI yeşil

### Dilim 2 — Auth + Tenant İzolasyonu [MAX] ✅

**Teslim edildi (2026-07-22):** 203 test yeşil (120 unit + 83 integration) · typecheck/lint/format temiz ·
migration drift yok · uçtan uca doğrulandı (login → PKCE authorize → token → /auth/me, seed'lenmiş
iki kiracıyla; Acme token'ı Northwind'e ulaşamıyor).

**Kanıtlanan invariant'lar:**

- `nexa_app` rolü superuser DEĞİL, tablo sahibi DEĞİL → RLS gerçekten uygulanıyor (test bunu doğruluyor)
- Tenant context yoksa **0 satır** (fail-closed); cross-tenant read/update/delete/insert hepsi bloklu
- `SET LOCAL` transaction dışına sızmıyor (hata durumunda bile)
- Token'lar yalnız hash olarak saklanıyor; PAT düz metni tek seferlik dönüyor
- Authorization code tek kullanımlık; replay → ürettiği token'lar da iptal
- Refresh rotation + reuse → tüm aile iptal
- Rol/suspend değişikliği mevcut token'lara anında yansıyor
- Zayıf session güçlü PAT üretemiyor (privilege escalation kapalı)
- Customer token agent yüzeyine ulaşamıyor (404, 403 değil)
- `public: true` + `scopes` kombinasyonu boot'ta hata veriyor

**Kapsam notu:** `customers` ve `trusted_domains` tabloları dilim 3'ten dilim 2'ye alındı —
`/customer/token`'ın trusted-domain kontrolü onlarsız uygulanamaz ve test edilemezdi.

**Invariant'lar / tehditler (önce yaz):**

- I1: Hiçbir sorgu `license_id`/`organization_id` filtresi olmadan veri döndüremez (RLS son savunma)
- I2: Token düz metin saklanmaz (argon2id hash)
- I3: Scope yetersizse route çalışmaz (403 `authorization`), kaynak enumeration'da 404
- I4: Customer token Customer Chat API dışına çıkamaz
- T1: Cross-tenant IDOR (kısa base32 ID tahmini)
- T2: PKCE downgrade / code replay
- T3: Refresh token rotation eksikliği

**Negatif testler (pozitiften ÖNCE):** org A token'ı ile org B chat okuma → 404; scope'suz `chats--all:rw` çağrısı → 403; RLS bypass denemesi (raw query, `app.current_license` set edilmemiş) → 0 satır; `code_verifier` yanlış → `invalid_grant`; kullanılmış code tekrar → reddedilir.

- OAuth 2.1 Authorization Code + PKCE (S256, verifier 43–128), refresh rotation, access TTL ≤1 saat
- PAT: `Basic base64(account_id:PAT)`; bot token; customer token (cookie grant, kısa TTL, org-scoped)
- Scope modeli: `resource--access:permission` (v2-03 §8.5 tam liste)
- `TenantScopedRepository` + PostgreSQL RLS (`current_setting('app.current_license')`)

### Dilim 3 — Veri Modeli [MAX] ✅

**Teslim edildi (2026-07-22):** 240 test yeşil (120 unit + 120 integration) · 39 tablo ·
tümünde RLS · drift yok · seed iki kiracı + gerçekçi transcript üretiyor.

**Veritabanının kendi başına koruduğu invariant'lar (uygulama koduna güvenmeden):**

- `uq_one_active_chat` — lisans+müşteri başına 1 aktif chat. **Yarış testiyle** kanıtlandı:
  8 eşzamanlı `start_chat` → tam olarak 1 tanesi başarılı.
- `uq_one_active_thread` — chat başına 1 aktif thread.
- `threads_closed_consistency_check` — aktif+kapalı çelişkisi imkânsız.
- `uq_one_fallback_routing_rule` — lisans+kind başına 1 fallback.
- `events` aylık RANGE partition + otomatik partition üretimi + DEFAULT partition
  (saat kayması olan mesaj kaybolmaz, bulunabilir bir yere düşer). Partition pruning
  EXPLAIN ile doğrulandı.
- `events → threads` FK (ON DELETE CASCADE) — **testte bulundu:** FK yokken chat silinince
  event satırları yetim kalıyordu (GDPR silme talebi için gerçek sorun).
- `audit_log` append-only: `UPDATE`/`DELETE` hem policy hem GRANT seviyesinde reddediliyor.
- pgvector ivfflat + boyut doğrulaması (1536 dışındaki embedding reddediliyor).

- PRD §8.4'teki 30+ tablo, rapor-2 §5.3 DDL'e birebir
- `events` aylık RANGE partition + otomatik partition üretimi
- `uq_one_active_chat` kısmi unique index
- `knowledge_chunks` pgvector ivfflat
- Tüm CHECK kısıtları; RLS politikaları tüm tenant tablolarında
- Seed: 2 organizasyon (cross-tenant test için), gruplar, ajanlar, müşteriler, örnek chat/thread/event, canned responses, tags, routing rules

### Dilim 4 — chat→thread→event + Agent Chat API [MAX] ✅

**Teslim edildi (2026-07-22):** 290 test yeşil (120 unit + 170 integration) ·
uçtan uca doğrulandı: widget token → agent chat başlatır → müşteri yanıtlar →
internal note → arşiv → resume (yeni thread) → cross-tenant 404.

**Kanıtlanan invariant'lar:**

- Internal note (`recipients='agents'`) müşteri transcript'inde **yok** — SQL'de filtreleniyor,
  sonradan atılmıyor (aksi halde kısa sayfa müşteriye "burada bir not var" bilgisini sızdırırdı).
- Müşteri internal note **yazamıyor** — reddetmek yerine `all`'a düşürülüyor.
- Idempotency: aynı `idempotency_key` ile tekrar → orijinal event (200), yeni satır yok.
  Kiracılar arası key çakışması yok.
- 12 eşzamanlı `send_event` → 1..12 arası **benzersiz ve boşluksuz** sequence
  (`UPDATE … RETURNING`; read-then-write çakışırdı).
- Kapalı sohbete yazma → 409 `chat_inactive`.
- Ajan yalnız üyesi olduğu takımın sohbetlerini görüyor; takımdan çıkarılınca **anında** kaybediyor.
- Kendisine kişisel transfer edilen sohbeti takım değişse de görmeye devam ediyor.
- Boş takıma transfer → 409 `group_offline` (müşteri sahipsiz kalmıyor).
- `after_event_id` ile replay (dilim 5'in kayıpsız reconnect primitifi) — sequence sırasına göre,
  timestamp'e göre değil.

**Kapsam notu:** Müşterinin kendi sohbetini okuma/yazma yüzeyi dilim 6'dan öne alındı —
internal note sınırı ancak iki taraf da varken kanıtlanabilirdi.

**Invariant'lar:** lisans+müşteri başına 1 aktif chat · aktif olmayan chat'e event yazılamaz (`chat_inactive`) · `recipients='agents'` event müşteriye gitmez · event id monotonik/idempotent · optimistic concurrency.

- `POST /api/v1/chats` (start) · `GET /api/v1/chats` (list) · `POST /api/v1/chats/{id}/events` · `.../deactivate` · `.../resume` · `.../transfer` · `.../tags` · `GET /api/v1/chats/{id}`

### Dilim 5 — RTM WebSocket [MAX] ✅

**Teslim edildi (2026-07-22):** 332 test yeşil (120 unit + 212 integration; 42'si RTM) ·
canlı doğrulandı: REST send → push **13 ms**, socket düşür → 3 mesaj gel → reconnect + sync →
**hiçbiri kaybolmadı**.

**Mimari:** API soketle konuşmaz. Redis'e zarf yayınlar; zarf _hem_ payload'ı _hem_ izleyici
kitlesini (audience) taşır. Gateway aptaldır: yetki kararı vermez, çünkü tenant context'i ve
takım üyeliği görünürlüğü yoktur — vereceği her karar tahmin olurdu. Tek kendi kontrolü:
zarfın lisansı bağlantının lisansıyla eşleşmeli.

**Kanıtlanan invariant'lar:**

- **Kayıpsız reconnect:** cursor = event id içindeki sequence. Timestamp KULLANILMAZ —
  aynı milisaniyede birden çok event olabilir ve süreçler arası saat farkı vardır.
  Test: aynı `createdAt`'li 12 event doğru sırada replay ediliyor.
- Replay üst sınırı 200/chat; aşılırsa `truncated: true` (istemci transcript'i yeniden çeker).
  Sınırsız replay hem istemciyi boğar hem gateway'i sınırsız allocate ettirir.
- Bağlantı kopukken **kazanılan** chat `new_chat_ids`'te bildiriliyor (geçmişi replay edilmiyor);
  **kaybedilen** chat `removed_chat_ids`'te.
- Cursor eski bir thread'i işaret ediyorsa → `truncated` (0'dan replay uzun sohbette istemciyi boğardı).
- Internal note müşterinin **replay'inde de** yok — reconnect sızıntı yolu olmuyor.
- Cross-tenant: başka kiracının chat'i ne replay ediliyor ne de varlığı doğrulanıyor.
- Fan-out: takım dışı ajana gitmiyor · müşteriye agent-only push gitmiyor ·
  abone olunmayan push gitmiyor · bozuk bus mesajı soketi düşürmüyor.
- Socket üzerinden chat mutasyonu reddediliyor — aynı invariant'ların iki implementasyonu olmaz.

**Invariant'lar:** reconnect'te event kaybı YOK (`sync` son event id'den) · login 30sn · ping 15sn · 10 pending/soket · fan-out yalnız yetkili ajanlara.

- `login` → `subscribe` → push (`incoming_chat`, `incoming_event`, `chat_deactivated`, `chat_transferred`, `incoming_typing_indicator`, `routing_status_set`, `queue_positions_updated`)
- Redis pub/sub fan-out; missed-event sync testi

### Dilim 6 — Customer Widget [MAX] ✅

**Teslim edildi (2026-07-22):** 379 test yeşil (120 unit + 259 integration) ·
widget bundle **5.3 KB gzip** (bütçe 50 KB) · loader 1.09 KB.

- Customer Chat API ayrı yüzey (`/customer/chat*`) — agent route'larını filtreleyerek
  yeniden kullanmak, oraya eklenen her yeni alanın biri hatırlayana kadar widget'a
  açık kalması demekti.
- Tek çağrıda tüm widget durumu (online, chat, events, queue position) — yavaş
  bağlantıda panelin sohbet dolu mu boş mu açıldığı farkı.
- Mesaj gönderme tek endpoint: ziyaretçi açısından "başlat" ve "gönder" farkı yok;
  istemciye karar verdirmek iki ilk mesajın yarışmasına davetiye.
- Framework yok, düz DOM — 50 KB bütçesinde React tek başına 3 katı.
- `textContent` her yerde; `innerHTML` eslint'te yasak (NFR-S6).
- Ajan yokken dürüst "kimse müsait değil" mesajı — sahte umut kısa beklemeyi
  terk edilmiş sohbete çevirir.
- WebSocket yerine 4 sn polling: uyuyan laptop / kopuk mobil ağda sessizce ölmeyen
  ve ziyaretçi için ayırt edilemez olan seçenek.

- Async loader snippet + cross-origin iframe; < 50KB hedefi
- Customer Chat API: token, start_chat, send_event, RTM customer socket
- Trusted domains allowlist; HTML escape (asla innerHTML)

### Dilim 7 — Inbox 3-pane [MAX] ✅

**Teslim edildi (2026-07-22):** tarayıcıda uçtan uca doğrulandı —
giriş → 3-pane inbox → widget'tan gelen mesaj **sayfa yenilemeden** transcript'e düştü →
internal note gönderildi → müşteri onu görmüyor, ajan görüyor.

- Design-brief token'ları doğrudan uygulandı (dilim 10'un bir kısmı buraya alındı;
  arayüzü önce stilsiz kurup sonra boyamak iki kez iş demekti).
- RTM push'ları **aynı React Query cache'ine** yazılıyor — paralel "canlı olaylar"
  listesi tutup render'da birleştirmek, duplike ve sırasız mesajın kaynağıdır.
- Event id ile dedupe: push ve refetch aynı olayı getirebilir; optimistic placeholder
  gerçeğiyle değiştiriliyor.
- Internal note modu ayırt edilemez olamaz: amber composer + "Only your team will see this"
  - baloncukta açık etiket. Buradaki pahalı hata notu müşteriye göndermektir.
- Auto-scroll yalnız zaten en alttaysa takip ediyor — geçmişi okuyan ajanı yukarıdan
  koparmak, kaçırılan scroll'dan kötüdür.
- Reconnect: `RtmClient` chat başına son event id'yi tutuyor, her yeniden bağlanmada
  `sync` ile replay ediyor; backoff jitter'lı (sunucu restart'ında tüm ajanların
  aynı anda dönmesi kesintiyi uzatır).

- Sol: Chats grubu (All/My/Queued/Unassigned/Archive) canlı sayaç
- Orta: liste (virtualized) + transcript (reverse infinite scroll)
- Sağ: Details paneli
- Composer: Reply/Internal note, canned `#`, attach, optimistic send

### Dilim 8 — Routing [MAX] ✅

**Teslim edildi (2026-07-22):** 358 test yeşil (120 unit + 238 integration; 26'sı routing).
**Sıra değişikliği:** widget'tan (dilim 6) önce yapıldı — widget'tan gelen sohbetin
gerçekten yönlendirilmesi için routing bir ön koşul.

**ADR-08 algoritması, adım adım test edildi:**

- Kural eşleşmesi > fallback; kuraldaki **tüm** koşullar sağlanmalı
  ("pricing sayfası VE UK" → UK'den anasayfaya giren eşleşmez).
- Priority katmanı (primary>first>normal>last), **dolu katman atlanıyor**:
  primary doluysa chat kuyruğa değil `first`'e gidiyor.
- Katman içinde en az yüklü; eşitlikte `last_assigned_at ASC`.
  **Adalet testi:** 3 ajana 6 sohbet → tam olarak 2/2/2.
- `concurrent_chats_limit` asla aşılmıyor — limit doluysa kuyruk.
  (Limit üstü sessiz atama, müşterinin görmezden gelinmesinin yoludur.)
- Fallback takım: eşleşen takım doluysa devreye giriyor.
- Kuyruk: chat kapanınca **ve** ajan `accepting_chats` olunca boşalıyor.
  Aksi halde boş ekrana dönen ajan otururken müşteri bekliyor.
- Kuyruk numaraları bitişik tutuluyor (renumber) — "4. sıradasınız" derken üç kişi olması güveni yıkar.
- Bir kuyruk girdisi atanamıyorsa **sıra bozulmuyor** (drain duruyor, atlamıyor).
- Silinmiş takım id'si yok sayılıyor (eski widget snippet'i müşteriye ceza olmamalı).
- Cross-tenant: başka lisansın ajanı asla atanmıyor.

- ADR-08 algoritması; concurrent limit; fallback grup; kuyruk pozisyonu
- Negatif testler: limit dolu → kuyruk; tüm gruplar offline → `groups_offline`

### Dilim 9 — Reports + Billing [MAX] ✅

**Teslim edildi (2026-07-22):** 398 test yeşil (120 unit + 278 integration).

- **ADR-09 tek tanım:** "AI resolution" = kapanışta `author_type='agent'` event'i olmayan thread.
  Reports "Automated" ve fatura sayacı **aynı** predicate'i okuyor; test ikisinin eşitliğini
  doğruluyor. Anlaşacağı varsayılan iki sayaç er ya da geç ayrışır ve bunu ilk fark eden
  faturayı itiraz eden müşteri olur.
- Kapanışta sayılıyor, artımlı bayrakla değil: ajan sonradan katılınca bayrağı doğru
  temizlemek gerekirdi, yanlış yapınca insanın yaptığı işi müşteriye faturalardınız.
- `automated_rate` **kapanmış** sohbetlere göre — açık sohbet henüz çözülmedi; toplam
  üzerinden hesaplamak inbox yoğunlaştıkça oranı düşürürdü.
- CSAT oyu yoksa `null`, %0 değil: oylanmamış dönem _bilinmiyor_, felaket değil.
- **ADR-10 trial:** süresi dolunca **salt-okuma** — veri okunabilir, silinmez, dışa aktarılabilir.
  Yazma → 402 `license_expired`. `/auth/*` açık kalıyor: çıkış ve token iptalini engellemek
  "lütfen ödeyin"i "kapana kısıldınız"a çevirir.
- License gate route bazında değil hook olarak: "şu bir endpoint'i unuttuk" bedava katmanın
  sessizce sınırsız olma yoludur.
- Kota %80'de uyarı (PRD §8.3 akış 5).

### Dilim 10 — Design System + modül ekranları [MAX] ✅

Token sistemi, Tailwind eşlemesi ve a11y kuralları (`design-brief.md` → config); hiçbir
bileşende sabit renk yok. Başlangıçta yalnız inbox stillendirilmişti; kalan altı modül
ekranı F2/F4/F5/F6 ile tamamlandı (7/7).

**Kayıt:** bu dilim altında teslim edilen **Playbook + RAG aslında PRD'de v1'dir**
(§5.2, `FR-MOD-05.x`/`06.x`). Faz ihlali — bkz. §1.3.

---

## B. Tarihçe — Dilim sonrası düzeltmeler (F1–F6)

### F1 — Kontrat kayması kapatıldı (2026-07-23) ✅

**Bulgu:** ADR-05 "contract-first" diyor, ama dilim 6, 8 ve 9 route'ları doğrudan
`apps/api/src/routes/`'a yazıp `packages/contract/openapi/`'ye dokunmamış. **10 endpoint
kontratsız kalmış** — dolayısıyla üretilmiş tipleri ve dokümantasyonu da yok. Hiçbir test
bunu yakalamadı, çünkü testler route'ları doğrudan çağırıyordu.

Kontratsız kalan yüzey: `/reports/overview` · `/billing/subscription` · `/billing/usage` ·
`/agents` · `/agents/me/routing-status` · `/groups` · `/customer/chat` (+ `/events`,
`/close`, `/rating`).

**Düzeltme:**

- 3 yeni path dosyası (`paths/agents.yaml`, `paths/reports.yaml`, `paths/customer-chat.yaml`)
  \+ 6 yeni şema (`Agent`, `Group`, `UsageSummary`, `ReportsOverview`, `CustomerChatState`,
  `CustomerMessageResult`) + `Customer` tag'i. Kontrat 18 → **28 path**.
- **Asıl düzeltme kaymayı tekrar imkânsız kılan test:** `contract-parity.test.ts` Fastify'ın
  router'ını `printRoutes` ile okuyup kontratla **iki yönlü** karşılaştırıyor — belgelenmemiş
  route da, karşılığı olmayan kontrat maddesi de hata veriyor. Ayrıca: `operationId` tekilliği
  (openapi-typescript tipleri buna göre anahtarlıyor, çakışma sessizce üzerine yazardı) ve
  public olmayan her operasyonda 4xx tanımı.
- Parser'ın sessizce boş küme üretip iki tarafı da "eşit" göstermesine karşı taban kontrolü.

CI zaten üretilmiş tiplerin bayatlığını kontrol ediyordu; ama spec'in **kendisi** eksik olduğu
için o kapı bunu yakalayamazdı. Parity testi bu boşluğu kapatıyor.

### F2 — Kalıcı kabuk + API'si hazır modül ekranları (2026-07-23) ✅

Dilim 10'un "uygulanacak ekran yok" boşluğunun API'si zaten var olan kısmı kapatıldı.
**414 test yeşil** (131 unit + 283 integration); tarayıcıda seed veriyle uçtan uca doğrulandı.

- **`AppShell`** — kalıcı icon rail + `react-router` ile deep-link'lenebilir rotalar
  (`/app/inbox`, `/app/team`, `/app/reports`, `/app/billing`). PRD §8.1 rota semantiği:
  ajanın baktığı ekranın linkini meslektaşına gönderebilmesi ve reload'un onu inbox'a
  düşürmemesi gerekiyor. UI'ı olmayan modüller **gizlenmiyor, devre dışı** gösteriliyor —
  gizlemek "bu üründe yok" der, devre dışı "henüz burada değil" der; doğrusu ikincisi.
- **Reports** (`/reports/overview`) · **Team** (`/agents` + `/groups`) ·
  **Billing** (`/billing/subscription` + `/billing/usage`).
- Bilinmeyen ile sıfır ayrı gösteriliyor: oylanmamış dönem `—`, %0 değil. `formatX`
  fonksiyonları `null`'ı `null` döndürüyor, sıfıra çevirmiyor.

**Yolda bulunan hata (tarayıcıda, testte değil):** hesap menüsü kapalı `<details>`'in
çocuklarını tarayıcının gizlemesine güveniyordu. Panel `position: absolute` olunca bu kural
tutmuyor: 224×130'luk kutusunu koruyor, erişilebilirlik ağacında çalışan bir "Sign out" ile
kalıyor, sadece içeriğin **arkasına** boyanıyor — ekranda yok, ekran okuyucuda ve tab
sırasında tamamen var. `hidden group-open:block` ile açıkça gizlendi; `<summary>`'ye
`role="button"` + `aria-expanded` eklendi (çıplak `<summary>` "generic" olarak duyuruluyordu,
yani ne açtığı ne de açık olup olmadığı belliydi).

> **Test dürüstlüğü notu:** ilk yazdığım görünürlük testleri bu hatayı yakalamıyordu —
> jest-dom'un `toBeVisible()` fonksiyonu kapalı `<details>` altındaki öğeleri CSS'ten
> bağımsız "gizli" sayıyor ve jsdom stylesheet yüklemiyor. Hatayı geri koyup testlerin yine
> geçtiğini görerek doğruladım. Regresyonu asıl tutan, tarayıcının fiilen uyduğu mekanizmayı
> (`hidden` + `group-open:block` sınıfları) sabitleyen ayrı bir test; o test hata geri
> konunca kırılıyor.

### F3 — Playwright E2E paketi + widget yolunun onarımı (2026-07-23) ✅

"Bitti" tanımının son açık maddesi kapandı: `apps/e2e` (Playwright, chromium) **10 test**.
CI'daki koşullu e2e job'ı artık gerçekten çalışıyor.

**Kapsam:** ana demo akışı tek tarayıcı oturumunda — ziyaretçi widget'tan yazar → routing atar →
ajan **sayfa yenilemeden** görür → yanıtlar → ziyaretçi yanıtı görür → internal note eklenir ve
ziyaretçide **görünmediği** doğrulanır → arşivlenir. Ayrı context'ler: ziyaretçi ve ajan farklı
kişiler, storage paylaşmaları birindeki hatayı diğerinde maskeler.

**Paket yazılırken bulunan gerçek hatalar (hepsi tarayıcı seviyesinde, alt katmanlar göremezdi):**

- **Widget hiç kimlik alamıyormuş.** Loader iframe'i `allow-same-origin` olmadan
  oluşturuyordu → doküman opak kökenli → her istek `Origin: null` taşıyor → API token
  vermiyor. Tarayıcıda kanıtlandı (`self.origin === "null"`, 403). Unit testler geçiyordu
  (jsdom köken modellemiyor), integration testler geçiyordu (API'yi düzgün Origin ile
  doğrudan çağırıyorlar).
- **Trusted-domain kontrolü uygulanamaz durumdaydı.** Token isteği iframe'den geliyor;
  iframe'in kökeni Nexa'nın kendi widget kökeni, yani **her müşteri için aynı**. Hangi
  sitenin sohbeti açtığını asla söyleyemezdi. Artık host sayfanın kökenini yalnız o sayfada
  çalışan loader biliyor ve `host_origin` olarak aktarıyor. Bunun bir **yapılandırma**
  kontrolü olduğu, kimlik doğrulama sınırı olmadığı kontratta açıkça yazıldı — doğrudan API
  çağıran herkes istediği host'u iddia edebilir; asıl sınır token'ın tek ziyaretçinin kendi
  konuşmasına kapsanmış olması.
- **Launcher paneli kapatıyordu.** Panel açıkken launcher düğmesi composer'ın Send düğmesinin
  üstünde kalıyor ve tıklamayı yutuyordu — panel düzgün görünüyor, mesaj gitmiyor.
- **`Availability` etiketi select'e bağlı değildi** (`htmlFor` yok). Ajanın iş alıp almadığını
  belirleyen kontrol, ekran okuyucuda isimsizdi.
- **`.localhost` reddediliyordu.** Seed her demo kiracıya `<tenant>.localhost` veriyor ama
  `originHost` http'yi yalnız düz `localhost` için kabul ediyordu — seed'lenen widget yerelde
  hiç çalışamazdı. RFC 6761 §6.3 `.localhost` TLD'sinin tamamını loopback'e ayırdığı için
  alt alan adları da kabul ediliyor.
- **Anon rate limit env'den okunmuyordu** (tek sabit kodlanmış limitti, ADR-07'ye aykırı).
  `RATE_LIMIT_ANON_PER_MIN` eklendi; CI e2e job'ında yükseltiliyor, üretim varsayılanı 30.

**Test tasarımı notu:** organizasyon id'si worker kapsamlı çözülüyor. Test başına çözmek her
test için bir `/auth/login` demekti ve tek koşuda anon limiti tetikliyordu — süit o zaman
ürün hatası gibi görünen 429'larla düşüyordu.

### F6 — Playbook: AI skill motoru + RAG (2026-07-23) ✅

Dilim 10'un son modülü. **Dilim 10 artık 7/7.** Kontrat 37 → **46 path**.
**595 test yeşil** (219 unit + 353 integration + 23 E2E).

**`packages/ai-mock`** — sağlayıcısız, deterministik AI. Üç parça:

- **Embedding**: içerikten türeyen hash'li kelime torbası, 1536 boyuta izdüşüm, L2 normalize.
  Semantik değil (leksikal her yöntem gibi "delivery" ile "shipping"i ilişkilendirmez) ama
  sistemin gerçekten dayandığı iki özelliği taşıyor: aynı metin → aynı vektör, ve örtüşen
  kelimeler → yüksek benzerlik. Hafif gövdeleme eklendi ("takes"/"take" buluşsun diye);
  bunun kesinlik bedeli intent eşiğinin 0.6'ya çıkarılmasıyla ödendi — iki kelimelik bir
  ifade iki kelimeyi de istiyor.
- **Compiler**: doğal dil → sıralı adımlar. Anlamadığı satırı **raporluyor**, uydurmuyor.
  Müşteriye makul görünen yanlış işi yapan bir skill, derlenmeyi reddedenden kötüdür.
- **Intent**: aynı tokenizer'la leksikal eşleşme.

**Motor** (`skill-engine.ts`): adımları çalıştırıyor, sonucu üçe ayırıyor — `answered` /
`handed_off` / `skipped`. Mesaj başına **tek** skill çalışıyor; iki skill'in aynı soruya cevap
vermesi, yöneticinin hangisinin önce çalıştığını göremeyeceği bir durum yaratır.

**Kanıtlanan invariant'lar:**

- AI **bot** olarak yazıyor, agent olarak değil. ADR-09 bunu okuyor (agent event'i olmayan
  kapanmış thread = AI resolution) ve Reports ilk-yanıt sayacını yalnız insanla başlatıyor.
- Bilgi tabanında yeterince yakın bir şey yoksa **cevap vermiyor** — alakasız bir makaleden
  cevaplamak, cevap olmadığını kabul etmekten kötüdür; sohbet insana kalıyor.
- Bozuk skill müşteriye mesajını kaybettirmiyor; en kötü sonuç zaten insana kalan sohbet.
- Transfer sonrası adımlar çalışmıyor (AI artık o sohbetin sahibi değil).
- Müşterinin zaten verdiği bilgiyi tekrar sormuyor.
- Cross-tenant: başka kiracının skill'i çalışmıyor, bilgisi getirilmiyor.

**Yolda bulunan ciddi hata (benim kodum değil).** `ChatService.start` müşteri durumunu
atlayıp **müşterinin ilk mesajını `author_type: 'agent'` olarak** kaydediyordu — `sendEvent`
doğru yapıyor, `start` yapmıyordu. Aynı hesabı iki yerde yapmanın sonucu. Etkisi:

1. Widget'tan açılan her sohbette ziyaretçinin ilk mesajı ajan balonu olarak görünürdü.
2. Daha kötüsü: her thread daha ilk satırda "agent event"i kazandığı için **hiçbir sohbet
   AI resolution sayılamazdı**. Reports "Automated" kalıcı olarak 0, ve kullanılan otomasyon
   hiç faturalanmıyordu. (Daha önceki tarayıcı kontrolümde gördüğüm "AUTOMATED 0" buydu.)

Türetme tek bir `authorTypeOf`'a alındı; `recipientsFor` de aynı şekilde paylaşıldı (müşteri
hiçbir yazma yolunda internal note yazamaz). Regresyon testi ADR-09 döngüsünü uçtan uca
sabitliyor.

**İkinci hata:** widget zaman aşımından sonra ilk mesajı yeniden gönderirse chat artık var
olduğu için `sendEvent` yoluna giriyor ve idempotency anahtarı tanınmıyordu — ziyaretçinin
açılış mesajı çoğalırdı. `start` artık anahtarı aynı ad alanında kaydediyor.

**Scope düzeltmesi:** `agents-bot--all:rw` admin varsayılanlarında yoktu; sahibin bile
Playbook'u yönetmesi imkânsızdı.

---

### F5 — Settings modülü + composer `#` seçicisi (2026-07-23) ✅

Dilim 10'un ikinci modülü. Kontrat 31 → **37 path**. **535 test yeşil**
(177 unit + 335 integration + 23 E2E).

- **Trusted domains** (CRUD) · **Saved replies** (CRUD) · **Routing rules** (liste + aç/kapa + hedef takım)
- Trusted domains başa alındı çünkü ürünün çalışmasını kapıda tutan tek ayar o: müşterinin alan
  adı listede olmadan widget kendi sitesinde token alamıyor ve hata "widget bozuk" gibi görünüyor,
  "yapılandırma eksik" gibi değil. Bu ekran olmadan widget kimsenin kuramayacağı bir üründü.

**Kapanan döngü — canned responses.** Şemada ve seed'de vardı, **hiçbir şey okumuyor ya da
yazmıyordu**: ne yönetim ekranı ne composer'da `#` seçici (FR-MOD-02.3.5 ölü duruyordu). İkisi
birden eklendi. E2E ana testi döngüyü uçtan uca kanıtlıyor: Settings'te kaydedilen yanıt,
kimse sayfayı yenilemeden `#` ile müşteriye ulaşıyor.

**Paylaşılan origin modülü (`lib/origin.ts`).** Trusted domain'i saklarken uygulanan
normalizasyon ile token endpoint'inin `Origin` başlığından çıkardığı ana bilgisayar adı **birebir
aynı olmak zorunda**. Bir nokta ya da port farkı, alan adının listede doğru görünürken
widget'ın tam da eklendiği sitede reddedilmesi demek — ve iki yerde de bunu açıklayan hiçbir şey
olmaz. `originHost` auth.ts'ten buraya taşındı; unit testin son bloğu iki tarafın aynı dizeye
indiğini doğruluyor.

**Bilinçli kısıtlar:**

- Fallback routing rule **kapatılamıyor** (API 403, UI'da düğme devre dışı). Kapatmak, hiçbir
  kurala uymayan sohbetleri gidecek yeri olmadan bırakırdı; yapılandırma yine sağlıklı görünürdü.
- Wildcard alan adı (`*.example.com`) reddediliyor — çalışacakmış gibi durup asla eşleşmeyecek
  bir değer saklamak yerine. Alt alan adı eşleşmesi `include_subdomains` bayrağı.
- `#` seçici açıkken Enter seçiciye ait: ajanın hâlâ seçmekte olduğu ham `#promo` metnini
  müşteriye göndermek, klavye tutarsızlığından daha kötü bir sonuç.
- Seçici kelime içindeki `#` için açılmıyor (hex renk, URL fragment) — birini cümlenin ortasında
  bölmek, özelliği hiç sunmamaktan kötü.

---

### F4 — Customers modülü (2026-07-23) ✅

Dilim 10'un kalan üç modülünden ilki. Kontrattan başlandı (ADR-05): 3 path / 5 operasyon,
kontrat 28 → **31 path**. **461 test yeşil** (135 unit + 310 integration + 16 E2E).

- `GET /customers` (arama + segment + keyset sayfalama) · `GET /customers/{id}` (ziyaretler +
  sohbetler) · `PATCH /customers/{id}` · `POST|DELETE /customers/{id}/ban`
- UI: iki pane — liste + detay. Modal değil, çünkü ajan birine bakarken geldiği listeyle
  karşılaştırıyor; modal bunu her seferinde elinden alır.

**Yolda kapatılan iki veri boşluğu:**

- **`chats_count` / `tickets_count` hiçbir zaman yazılmıyormuş.** Şemada var (PRD §8.4) ama
  hiçbir yazma yolu bakmıyor; okunsa herkes için sonsuza kadar 0 gösterirdi — üstelik
  yetkiliymiş gibi. İlişkili satırlardan sayılıyor. Test bunu açıkça sabitliyor: sütun 0'a
  set edilip endpoint'in 1 döndürmesi bekleniyor.
- **`visits` tablosu tamamen boşmuş.** Widget zaten sayfa URL'ini gönderiyordu (routing
  kullanıyor), hiçbir yere yazılmıyordu. Artık kaydediliyor: 30 dk içinde aynı ziyaret
  sürdürülüyor (sayfa başına satır değil), ardışık tekrarlar atlanıyor, 50 sayfa ile sınırlı,
  user-agent'tan tarayıcı/OS çıkarılıyor. Mesajı düşürmemek için best-effort.

**Ban yazma yolu eklendi.** `banned_at` sütunu ve iki yerde uygulaması (chat başlatma +
token üretimi) zaten vardı; onu **set edebilecek** hiçbir şey yoktu. `customers.ban:rw`
ayrı scope: yanlış yazılmış bir ismi düzeltebilen ajan, aynı yetkiyle birini hizmet dışı
bırakabilmemeli. Geçmiş silinmiyor — ban moderasyon kararıdır, silme talebi değil; sohbetleri
silmek kararın dayanağını da silerdi.

**Testin yakaladığı gerçek hata:** sayfalama 11 müşteriden 5'ini gösteriyordu. Postgres'te
`ORDER BY x DESC` varsayılanı **NULLS FIRST**; ben nulls-last varsayıp keyset predicate'ini
ona göre yazmıştım. İkisi sessizce çelişince sayfalama erken bitiyor ve hiç aktivitesi olmayan
her müşteri kayboluyordu — hata vermeden. Sıralama artık `nulls: 'last'` ile açıkça belirtiliyor.

**Widget iyileştirmesi:** "Visited pages" sadece siteyi gösteriyordu, sayfayı değil — çapraz
kökende `document.referrer` tarayıcı tarafından kökene kırpılıyor, yani widget yolu hiç
öğrenemiyor. Loader artık `host_url` geçiyor. Query string ve fragment **kırpılıyor**: oturum
token'ları, sıfırlama linkleri ve e-posta adresleri orada yaşar, destek kaydı da onların
görüneceği en son yerdir.

---

## C. Assumptions (varsayımlar — onay beklenmedi)

- **A1:** Host'ta `psql` yok. Tüm DB CLI işlemleri Postgres container'ı içinden (`docker compose exec db psql`) yapılır.
- **A2:** `licenses.id BIGINT` — uygulama tarafında snowflake benzeri artan ID üretimi (PostgreSQL sequence).
- **A3:** LLM sağlayıcı MOCK: deterministik stub (`packages/ai-mock`) — aynı girdi → aynı çıktı, testler stabil.
- **A4:** SMTP mock: e-postalar `.data/mail/*.json` dosyasına yazılır, gönderilmez.
- **A5:** Stripe mock: `subscriptions`/`usage_records` lokal yazılır, dış çağrı yok.
- **A6:** `region='eu'` sabit; `X-Region` başlığı doğrulanır ama tek değer kabul eder.
- **A7:** Object storage mock: yerel `.data/uploads` + imzalı URL simülasyonu.
- **A8 (dilim 13):** Barındırılan **Chat page** (08.5.9) trusted-domain allowlist'inden muaftır.
  Widget üçüncü taraf sitelere gömülür ve `auth_resolve_widget_origin` çağıran origin'i
  allowlist'e karşı doğrular; Chat page ise **kendi origin'imizden** sunulan, bilinçli olarak
  public bir sohbet linkidir. Bu yüzden yeni bir SECURITY DEFINER fonksiyon
  `auth_resolve_organization_license(org_id)` lisansı doğrudan çözer (allowlist yok). Sınır:
  token yine tek organizasyona + müşterinin kendi konuşmasına kapalıdır; "public link = herkes
  sohbet başlatabilir" destek kutusunun doğasıdır. Doğrulandı: chat-page origin → 200,
  `evil.example` → 403.
- **A9 (dilim 13):** **Email kanalı** (08.5.3) gelen yönü. Yönlendirme adresi
  `<organization_id>@<INBOUND_EMAIL_DOMAIN>`; public webhook `POST /channels/email/inbound`
  local part'ı org id olarak okur ve A8'in resolver'ıyla lisansa çözer (**yeni migration yok**).
  `withTenant`/RLS o lisansa kilitler. Kararlar: (1) e-posta **gövdesi persist edilmez** —
  ticket çekirdeği (Dilim 11) gövde alanı tutmaz, e-posta konusu `ticket.subject` olur;
  (2) gönderen `organizationId+email` (citext) ile mevcut customer'a eşlenir — cross-tenant
  eşleşmez, **ikinci kayıt açılmaz**; (3) spam: sağlayıcı verdikti × `SecuritySettings.spamFilterEnabled`
  (varsayılan açık) — açıkken flagged mesaj ticket üretmez; (4) `INBOUND_EMAIL_SECRET` **opsiyonel**
  kenar-kimliği (set ise `X-Inbound-Secret` zorunlu, dev/test'te açık — sağlayıcı imzası dağıtım
  işi, SMTP mock A4 gibi); (5) iptal edilmiş lisans → 404.
- **A10 (kapsam denetimi 2026-07-25):** FR-MOD-02.4'ün PRD **KK** sütunu yalnız davranışı söylüyor
  (_"Bölümler katlanır; tag/assignee anında kaydeder; süre/ziyaret canlı"_); gösterilecek **alan
  listesi** (Visited pages; Visit info = Device/Referring/Duration/IP) **Açıklama** sütunundan
  türetildi. T3-a/T3-b bu türetilmiş kriteri taşır (`KK-türetilmiş`). Duration = ziyaret süresi
  (client hesaplar); IP zaten `visits`'te; Device/Referrer `Visit` şemasında var.

## D. Deviations (sapmalar)

- **D1 (dilim 2):** Redirect URI eşleşmesi **tam eşitlik** (OAuth 2.1). Kaynak platformun
  "kayıtlı yol, istek yolunun alt dizesi olabilir" kuralı (v2-03 §8.6) uygulanmadı — bu kural
  client alanındaki herhangi bir open-redirect'i code sızdırma kanalına çevirir.
- **D2 (dilim 2):** Access token TTL 8 saat değil **1 saat** (NFR-S2 iyileştirmesi).
- **D3 (dilim 2):** Parola KDF olarak argon2id yerine **scrypt** (RFC 7914, Node standart
  kütüphanesi). Gerekçe: native modül kurulum riski yok; güvenlik farkı marjinal, dayanıklılık farkı değil.
- **D4 (dilim 2):** Customer token **stateless HMAC** (DB'de satır yok). Her anonim ziyaretçi için
  satır yazmak konuşma verisinden büyük bir tabloya yol açardı. Bedeli: tekil iptal yok —
  TTL kısa, ban/lisans kontrolü her istekte canlı veriden yapılıyor.
- **D5 (dilim 2):** `licenses.id` için `BIGSERIAL` + `START WITH 1000001`. Prisma'nın
  `@default(autoincrement())` beklentisiyle uyumlu; elle `CREATE SEQUENCE` drift üretiyordu.
- **D6 (dilim 3):** `events` tablosuna `DEFAULT` partition eklendi (PRD'de yok). Gerekçe:
  partition penceresi dışına düşen bir satır aksi halde hata verip **müşteri mesajını
  kaybettirir**. Default partition kaybı önler ve anomaliyi bulunabilir kılar.
- **D7 (dilim 3):** `threads` tablosuna PRD §8.4'te olmayan alanlar eklendi:
  `assignee_id`, `event_sequence`, `queued_at`, `first_response_at`. Sırasıyla inbox
  ataması, kayıpsız reconnect (dilim 5) ve Reports "ilk yanıt süresi" için gerekli.
- **D8 (dilim 3):** `prisma migrate diff` tek başına drift kapısı olamıyor — Prisma index
  _access method_ (ivfflat/GIN) modelleyemiyor. `pnpm db:check-drift` bu tek bilinen
  ifadeye izin verip diğer her farkta hata veriyor; sinyal korunuyor.

- **D9 (dilim 11):** Kaynak platformun **58 scope**'una (v2-03 §8.5) `tickets--all:ro|rw` ve
  `tickets--access:ro|rw` eklendi (→62). Gerekçe: kaynakta ticketing ayrı bir üründür ve
  kendi API'si vardır; Nexa ikisini tek gelen kutusunda birleştiriyor. `chats--*`'ı yeniden
  kullanmak, sohbet okumak için verilen bir token'ın takip işlerini de sessizce okuması
  demekti (ADR-04 kaynakları ayrı tutar). Guard testi eklemeleri **isimle** listeliyor,
  böylece plansız bir scope hâlâ testi düşürüyor.
- **D10 (dilim 11):** Kilitli **24 hata tipine** (ADR-06) `ticket_exists` (409) eklendi (→25).
  Aynı kök sebep: kaynak katalog yalnız sohbet alanını kapsıyor ve "bu zaten var" karşılığı
  yok. Genel bir `conflict` yerine dar bir tip seçildi — katalogun geri kalanı da böyle
  yazılmış (`group_offline`, `unavailable` değil).
- **D11 (dilim 11):** `tickets.assignee_id` için Prisma ilişkisi/FK **eklenmedi** (PRD §8.4 de
  tanımlamıyor). Ajan adı sayfa başına tek toplu sorguyla çözülüyor. Alternatif olan satır
  başına arama, kuyruk birkaç yüz ticket'a çıkınca ortaya çıkan N+1'dir.

- **D12 (dilim 12):** PRD §8.4'te olmayan iki tablo eklendi: `password_reset_tokens` ve
  `invitations`. §8.4 zaten var olan bir çalışma alanını tarif ediyor; birinin nasıl
  **oluştuğuna** dair hiçbir şey söylemiyor. Kilitli 24 hata tipine `account_exists` (409)
  eklendi — aynı kök sebep (bkz. D10).
- **D13 (dilim 12, tarayıcıda bulundu):** Parola sıfırlama linki **hiç kimseye gitmiyordu**.
  Servis "bu adres gerçek mi?"yi kendi `SELECT ... FROM accounts` sorgusuyla karar veriyordu;
  o sorgu tenant bağlamı olmadan RLS altında çalışıp her seferinde 0 satır döndürüyordu.
  Token yazılıyor, mail gönderilmiyordu. Integration testleri kaçırdı çünkü hepsi
  **tabloya** bakıyordu, gönderilen mesaja değil. Fonksiyon artık boolean döndürüyor;
  regresyon testi gerçek bir `FileMailer` ile posta kutusunu okuyor.
- **D14 (dilim 12, tarayıcıda bulundu):** Yeni kaydolan sahip **giriş yapamıyordu**. Ajan
  uygulaması `client_id`'yi organizasyon adının ilk kelimesinden türetiyordu; bu yalnızca
  seed client'ları öyle adlandırdığı için çalışıyordu. Signup ile açılan çalışma alanında
  öyle bir client yok — signup 201 dönüyor, ardından `/auth/authorize` 400 veriyor ve kullanıcı
  "çalışma alanı oluşturulamadı" görüyordu (oysa oluşturulmuştu). Ayrıca "Acme Bikes" ve
  "Acme Tools" aynı id'ye düşerdi ve `client_id` birincil anahtar. Artık signup client'ı
  organizasyon uuid'sinden üretiyor ve `client_id` üyelikle birlikte dönüyor — tahmin yok.
- **D15 (dilim 13):** Kilitli hata tiplerine bir dar tip daha eklendi: `website_exists` (409,
  tm6 — bir domain o lisansa zaten eklenmiş). Kök sebep ve gerekçe D10'dakiyle aynı: kaynak
  katalog "bu zaten var" karşılığını taşımıyor; genel bir `conflict` yerine dar tip seçildi,
  katalogun geri kalanı da öyle (`ticket_exists`, `account_exists`). Guard testi tipi **isimle**
  listeliyor, plansız bir tip hâlâ testi düşürüyor. (Dilim 13 yalnız bunu ekledi; `greeting_not_found`/
  `group_not_found` daha önce vardı.)

- **D16 (§F kapanış turu, 2026-07-25 · ÇÖZÜLDÜ tm 23):** ~~`audit_log` tablosu + RLS policy Dilim
  12'de kuruldu ama Faz-0'da olay yazıcısı bağlanmadı — hiçbir güvenlik olayı INSERT edilmiyordu;
  §7.2 S12 kapısı bu yüzden ⬜.~~ Merkezi `writeAuditEntry` (append-only; `withTenant`/RLS içinde;
  PII-min sanitizasyon) `services/audit/audit-log.ts`'te eklendi ve 12 güvenlik eylemine bağlandı:
  login başarı/başarısız, parola sıfırlama, üyelik davet/iptal, ayar (security/routing/trusted-domain),
  billing aboneliği, PAT oluştur/iptal. Şema **değişmedi** (sadece yazıcı). Konfig değişiklikleri
  eylemin kendi transaction'ında (atomik); auth/PAT yolları en-iyi-çaba (kimlik doğrulama audit'e
  bağımlı olmasın). Okuma/export UI hâlâ v1 borcu. Kanıt: `test/integration/audit-log.test.ts`
  (eylem başına tam 1 append · UPDATE/DELETE reddi · cross-tenant izolasyon · sır/PII yok) +
  `src/services/audit/audit-log.test.ts` (sanitizasyon birim testi).
- **D17 (§F kapanış turu, 2026-07-25 · ÇÖZÜLDÜ tm 20):** ~~Reports 07.3.2 yalnız **otomatik**
  çözüm oranını ölçüyordu; Manual/Assisted ayrımı yoktu.~~ tm 20'de üç-sınıf ayrım eklendi:
  **Automated** = kapanmış, agent-yazımlı event yok (ADR-09 birebir korundu, fatura ile aynı sorgu) ·
  **Assisted** = agent event VAR + o chat'e ait `skill_runs` VAR · **Manual** = agent event VAR,
  skill YOK. Üçü kapanmış vakayı tam bölüyor (manual+assisted+automated = closed); veri zaten
  vardı (`events` + `skill_runs`), yeni tablo/kolon gerekmedi.
- **D18 (§F kapanış turu — faz sızıntısı, 2026-07-25):** MOD-05 (Playbook) ve MOD-06 (AI Agent)
  **v1 payları** Faz-0 kod tabanında mevcut (bkz. §1.3 ve §4.1/4.2 "öne çekildi"). Bunlar **v1
  kapsamı** sayılır — Faz-0 kapanış sayacına dâhil **değildir** (🔒). Kapanış turu bunları "erken
  teslim" işaretler, Faz-0 borcu olarak değil. Yeni iş **alınmaz**; mevcut yüzey v1'de tamamlanır.

- **D19 (kapsam denetimi, 2026-07-25 · koda karşı bulundu):** PLAN 02.4.1–.6'yı `✅` gösteriyordu
  ama `apps/web/src/features/inbox/DetailsPanel.tsx` yalnız Chat info (Status/Chat ID/Assignee/
  Queue/Started) + Tags + Teams render ediyor. PRD FR-MOD-02.4'ün **açıkça** istediği **Visited
  pages** ve **Visit info (Device/Referring/Duration/IP)** panelde **yok**. Veri var (`Visit`
  şeması: `referrer`/`pages`/`avg_duration`; `visits` tablosu widget'tan doluyor) ama yalnız
  `getCustomer` yüzeyinde; inbox `getChat` bunu taşımıyor. → Durum `✅`→`◐`. Kapanışı bloklayan
  Must ◐. Kırılım §3.13/T3. (Denetim yöntemi: dosyayı okuma + grep "visited|visit_info|referrer"
  → inbox'ta 0 eşleşme.)
- **D20 (kapsam denetimi, 2026-07-25 · koda karşı bulundu):** PLAN 13.8'i `✅` gösteriyordu ama
  `apps/web/src/features/notifications/notifications.ts` `NotificationPrefs = { enabled, sound,
  desktop }` — yani ses + masaüstü/tarayıcı (Notification API) + sekme başlığı. PRD 13.8 (+ 08.2)
  **e-posta** bildirim kanalını da Must (MVP) sayıyor; e-posta yolu ⬜ (SMTP mock A4 var, bağlı
  değil). Mobil push zaten 🔒 v1 (§11.1/8). → Durum `✅`→`◐`. Kırılım §3.13/T7. Düşük-orta ağırlık
  (çekirdek in-app bildirim çalışıyor).
- **D21 (kapsam denetimi, 2026-07-25 · §8 düzeltmesi):** §8 `visits` tablosunu "var ama
  kullanılmayan" listeliyordu; tüketici taraması `visits`'in **3** tüketicisi olduğunu gösterdi
  (widget yazması + `getCustomer` okuması, F4'te bağlandı). `visits` **kullanılıyor**; kalan
  tüketici 02.4 inbox (T3) ve 13.2 Engage (v2). §8 tablosu düzeltildi. (Gerçekten 0-tüketicili:
  `webhooks`, `campaigns`, `channels`, `goals`, `workflows`.)
- **D22 (kapsam denetimi 2026-07-25 · bilinçli daraltma):** FR-MOD-01.3'ün KK'sı _"Details/Copilot
  geçişi persist"_ diyor ama **Copilot (MOD-12) PRD'de v1'dir**; Faz-0'da Copilot yüzeyi yok. Bu
  yüzden 01.3'ün **MVP payı** = sağ panel aç/kapa + **Expand** + tercih persist (T1-a); **Copilot
  sekmesi/geçişi v1'e ayrıldı** (12.1–12.3 ile birlikte). §F.00 "kapsamı daralt + kalanı gerekçeli
  yeni kaleme ayır" kuralının uygulanışı — 01.3 Faz-0 `Must` sayacından Copilot payıyla değil,
  T1-a ✅ ile düşer.
- **D23 (çelişki denetimi 2026-07-26 · koda karşı doğrulandı):** §2 matrisi 01.3'ü `◐` gösteriyordu
  ("Details ✅, Copilot v1") ama tm 28 (= T1-a) `done` ve MVP payı kodda tam: sağ panel toggle +
  Expand (transcript tam genişlik) + `localStorage` persist (`rightPanel.ts`, `InboxPage.tsx`;
  `ShowDetailsButton`/`DetailsPanel.onCollapse`), unit `rightPanel.test.tsx` (7 test, toggle+expand+
  reload persist) + E2E `inbox-panel.spec.ts` yeşil. Copilot §D22 ile bilinçli olarak v1'e (tm 36)
  ayrıldığından MVP KK'sı karşılanmış → §3.1'de 01.3 `◐`→`✅`. Kalan Copilot payı §D22/T1'de v1 kaydı
  olarak durur (bu satır dışına dokunulmadı).
- **D24 (çelişki denetimi 2026-07-26 · koda karşı doğrulandı):** §3.2 satırı 02.4.1–.6'yı `◐`
  gösteriyordu (D19: "veri var ama inbox `getChat`'e bağlı değil, denetim 2026-07-25") ama D19'dan
  sonra gelen tm 27/27.1/27.2 boşluğu kapatmış. Koda karşı: backend `chat-service.ts` `get()`
  müşteri-olmayan principal için `detail.visitor`'ı `#latestVisitor` ile dolduruyor (Visit'ten
  `visited_pages` + `visit_info` Device/Referring/Duration/IP; IP yalnız agent/bot'a — NFR-S9);
  kontrat `ChatDetail.visitor`; UI `DetailsPanel.tsx` "Visited pages" + "Visit info" bölümlerini +
  boş durumlarını render ediyor. Testler yeşil: frontend `DetailsPanel.test.tsx` (3) + integration
  `chats.test.ts` "visitor context" (4 — yüzey + boş durum + widget'a sızmama + başka lisans IDOR).
  → §3.2'de 02.4.1–.6 `◐`→`✅`; D19 çözüldü. (Bu satır dışına dokunulmadı; §2/§8'deki D19/T3
  referansları kendi denetim turlarında güncellenir.)
- **D25 (çelişki denetimi 2026-07-26 · koda karşı doğrulandı):** §4.2 satırı 06.4'ü `◐ tone alanı
  var` gösteriyordu ama tm 11 + tm 33.5 (`done`) payı kodda tam. PRD KK1/FR-MOD-06.4 tüm alanları
  karşılanıyor: UI `ProfileForm.tsx` Name (zorunlu) + Avatar URL + Tone + Languages (çok-seçim) +
  Answer length **ve sağda canlı `PersonaPreview`** (widget başlığı); backend `playbook.ts` PATCH
  `/ai-agents/:id` beş alanı da doğruluyor, `answer_length` `persona` jsonb'ına merge ediliyor
  (signature'ı düşürmeden; `null`→sadece o anahtar silinir). Testler yeşil: frontend
  `ProfileForm.test.tsx` (6 — isim kapısı/preview/answer_length PATCH/dil toggle/salt-okunur, bu tur
  koşuldu 6/6) + integration `ai-agent-profile.test.ts` (listeleme + persist + persona merge + null
  temizleme). → §4.2'de 06.4 `◐`→`✅`. (Bu satır dışına dokunulmadı.)

- **D26 (çelişki denetimi 2026-07-26 · koda karşı doğrulandı):** §3.10 satırı 13.8'i `◐ e-posta
  bildirim kanalı ⬜` gösteriyordu (SMTP mock var ama bağlı değil notu); ancak tm 31 (`done`) payı
  kodda tam. PRD FR-MOD-13.8 (KK: "Bkz. FR-MOD-08.2") MVP payı — ses/masaüstü/tarayıcı/**e-posta** —
  karşılanıyor: karar saf fonksiyon `services/notifications/assignee-email.ts` `shouldEmailAssignee`
  (assignee yok / opt-out / adres yok negatifleri), route tetiği `routes/customer.ts` atanan ajana
  `mailer.send({kind:'notification'})` ile e-posta atıyor; kullanıcı bazında opt-out `notify_email`
  membership kolonu (migration `20260725110000_notify_email_preference`, FR-MOD-08.2 "kullanıcı
  bazında"), Settings yüzeyi `SettingsPage.tsx` toggle + optimistic `auth-store.ts`, kalıcılık
  `agents.ts` PATCH + profilde `auth.ts`. Testler yeşil (bu tur koşuldu): web `notifications.test.ts`
  (16/16), api unit `assignee-email.test.ts` (5/5), integration `notifications.test.ts` (5/5 —
  opt-out/idempotent replay/cross-tenant izolasyon dahil). Mobil push kapsam dışı (🔒 v1 →
  FR-MOD-13.7). → §3.10'da 13.8 `◐`→`✅`. (Bu satır dışına dokunulmadı.)

- **D27 (çelişki denetimi 2026-07-26 · koda karşı doğrulandı):** §4.2 satırı 06.1'i `◐` gösteriyordu
  (Nerede boş) ama tm 33.1 (`done`) payı kodda tam. PRD FR-MOD-06.1 iki koşulu da karşılanıyor:
  **(1) Sekmeler** — `PlaybookPage.tsx` `VIEW_TABS` Performance/Profile/Skills/Knowledge'i tek `role="tablist"`
  altında (`aria-selected`/`aria-controls`, tek `#ai-tabpanel`) render eder ve dördü de gerçek panel
  gösterir: `AiPerformance`, `ProfileForm`, Skills editörü, `KnowledgePanel`. **(2) Readiness check** —
  saf fonksiyon `readiness.ts` `evaluateReadiness` (indeksli KB **veya** adımlı skill yoksa `ready=false`);
  sayfa bunu `blockActivation` ile "Turn on" butonunu devre dışı bırakıp `title`'a gerekçeyi koyarak ve
  `role="alert"` banner ("Not ready to turn on…") ile uygular — PRD KK4/US-7 birebir. Test yeşil (bu tur
  koşuldu): `readiness.test.ts` (5/5 — boş KB+skill→engel + un-indexed/stepless negatifleri + iki hazır
  yol). → §4.2'de 06.1 `◐`→`✅`. (Bu satır dışına dokunulmadı.)
- **D28 (çelişki denetimi 2026-07-26 · koda karşı doğrulandı):** §4.2 satırı 06.3.1'i `◐` gösteriyordu
  (Nerede boş) ama tm 33.3 (`done`) payı kodda tam. PRD FR-MOD-06.3.1 KK "Tür bazlı filtre" (All /
  Websites / Files / Articles / FAQ) üç katmanda karşılanıyor: **(1) Şema** — `@nexa/types`
  `KNOWLEDGE_SOURCE_TYPES = ['website','file','article','faq']` (§8 knowledge_sources) + kontrat
  `type: 'website'|'file'|'article'|'faq'`. **(2) Süzme** — saf partition `knowledge-tabs.ts`
  `filterSourcesByTab` (sekmeye göre tür süzer) + `countSourcesByTab` (All = Websites ∪ Files ∪
  Articles ∪ FAQ, çakışmasız/kayıpsız; bilinmeyen tür yalnız All'da). **(3) UI** — `PlaybookPage.tsx`
  `KnowledgePanel` `['all', ...KNOWLEDGE_TYPES]`'ı tek `role="tablist"` (`aria-label="Knowledge types"`,
  `aria-selected`) altında 5 sekme + sekme sayaçları + tür bazlı süzülmüş liste + sekme başına boş durum
  olarak render eder. Test yeşil (bu tur koşuldu): `knowledge-tabs.test.ts` (4/4 — her tür sekmesi yalnız
  kendi türü, All hiçbir kaynağı düşürmez, tam partition, bilinmeyen tür All'da) · web paketi 265/265 ·
  typecheck exit 0. → §4.2'de 06.3.1 `◐`→`✅`. Not: bu satır **yalnız alt sekme/süzme** kapsamıdır;
  06.3.2 (website crawl) ayrı satırda `◐` kalır — ona dokunulmadı. (Bu satır dışına dokunulmadı.)
- **D29 (07.4-a · tm 44 · 2026-07-26 · koda karşı doğrulandı):** §4.4 (kalan kapsam) satırı 07.4'ü `⬜`
  gösteriyordu ama tm 21 (`done`) AI Agent raporunu tam teslim etmiş; 07.4-a KK'sı _"Billing sayacıyla
  ilişkili"_ üç katmanda karşılanıyor: **(1) API** — `/reports/ai-agent` (`routes/reports.ts`)
  `resolutions` = ADR-09 `automated` (kapanışta agent-yazımlı event yok) ve fatura sayacıyla
  (`/billing/usage` `ai_resolutions.used`) TEK paylaşımlı sorgudan gelir; deflection metrikleri
  `transfers`/`transfer_rate` (`chat_transferred` sistem olayı) + `skill_runs` + `resolution_rate`.
  Kontrat `/reports/ai-agent` OpenAPI'de. **(2) UI** — `ReportsPage` AiAgentTab "AI resolution"
  (resolutions/rate/otomatik süre) + "Deflection" (transfers/transfer rate/skills) kartları; başlık
  altında açıkça _"the same figure the invoice bills (ADR-09)"_ yazar. **(3) Test** — YENİ web testi
  `ReportsPage.test.tsx` (4/4 — resolution+deflection kartları render · fatura-ADR-09 ibaresi görünür ·
  paylaşımlı `/reports/ai-agent?from=&to=` sorgusu · boş pencere → 0% değil `—`); integration
  `reports-billing` _"AI Agent report (07.4) — agrees with the overview and the invoice on resolutions"_
  (rapor=fatura). DoD kapısı bu tur yeşil: typecheck/lint/build exit 0 · unit web 277/277 · integration
  581/581 · e2e `reports.spec.ts` 2/2 (AI Agent sekmesi). → §4.4'te 07.4 `⬜`→`✅`. Not: 06.5-a aynı
  `/reports/ai-agent` sorgusunu AI Performance ekranında tüketir (ayrı satır — dokunulmadı).

- **D30 (02.9-a · tm 41 · 2026-07-26 · koda karşı doğrulandı):** §4.3 satırı 02.9'u `⬜` (Nerede boş)
  gösteriyordu ama tm 41 (`done`) Live typing preview'i çift yönlü tam teslim etmiş — çelişki tm 41
  kapanışında DoD-8 (PLAN satırı güncelleme) atlanmasıydı. FR-MOD-02.9 KK'sı _"RTM `sender_typing`/
  `send_typing_indicator`; sneak-peek (müşteri yazarken)"_ (+11.8) iki yönde de kodda karşılanıyor:
  **(1) ajan→ziyaretçi** — `Composer.tsx` `signalTyping` → `realtime.ts` `send_typing_indicator` → RTM
  `dispatcher.ts` #typing (`TypingService.canType` chat-yetki denetimi, erişilemeyen chat = `not_found`)
  → `setAgentTyping` Redis TTL bayrağı → widget'ın `/customer/chat` poll'u `agent_typing` okur →
  `renderTyping`. **(2) ziyaretçi→ajan (sneak-peek)** — widget `notifyTyping` (throttle + `blur`/send'de
  `stopTyping`) → `POST /customer/chat/typing` (`SNEAK_PEEK_MAX_LENGTH` sınırlı) → `chat-service.ts`
  `publishCustomerTyping` → `incoming_typing_indicator` + `incoming_sneak_peek` **yalnız ajanlara**
  (ziyaretçiye asla echo) → `useInbox.ts` → `TypingIndicator.tsx` önizleme metni. Kontrat
  `/customer/chat/typing` OpenAPI'de (contract-parity yeşil). **Test (bu tur çalıştırıldı):** web
  `typing.test.ts` (5) + `TypingIndicator.test.tsx` (4) = 9/9 yeşil · rtm `typing.test.ts` 6/6 yeşil ·
  integration `customer-chat.test.ts` "live typing preview" (sneak-peek yalnız-ajana fan-out). Done
  görev geri açılmadı. → §4.3'te 02.9 `⬜`→`✅` + Nerede kanıtı yazıldı. **Kapsam notu:** 11.8 (§4.3
  satır 541, "Could") aynı tm 41'in bundle'ıdır (`+11.8`) ve aynı sneak-peek koduyla karşılanır; bu
  pencere yalnız 02.9'a kapsamlandığından 541 satırına DOKUNULMADI — ikiz `⬜`/done çelişkisi ayrı bir
  düzeltme penceresine bırakıldı.

- **D31 (11.8 · tm 41 · 2026-07-26 · koda karşı doğrulandı):** §4.3 satırı 541 (11.8 "Typing indicator
  (sneak-peek)", Could) `⬜` (Nerede boş) gösteriyordu — D30'un açıkça bıraktığı ikiz çelişki. FR-MOD-11.8
  KK'sı _"müşteri yazarken ajana önizleme; RTM sneak-peek; ajan müşteri yazarken görür"_ tam olarak
  ziyaretçi→ajan sneak-peek yoludur ve kodda uçtan uca karşılanıyor: widget `notifyTyping` (throttle +
  `blur`/send'de `stopTyping`) → `api.typing(true, text)` → `POST /customer/chat/typing` (`typingSchema`,
  `SNEAK_PEEK_MAX_LENGTH` sınırı) → `chat-service.ts` `publishCustomerTyping` → `incoming_typing_indicator`
  + `incoming_sneak_peek` **yalnız ajanlara** (`recipients: 'agents'`, ziyaretçiye asla echo; audience yoksa
  no-op) → agent `useInbox.ts` (`incoming_sneak_peek` aboneliği) → `useTypingStore.noteCustomer` →
  `TypingIndicator.tsx` önizleme metni. Kontrat `/customer/chat/typing` OpenAPI'de + generated `api.ts`
  (contract-parity yeşil). **Test (bu tur çalıştırıldı):** rtm `typing.test.ts` 6/6 · web `typing.test.ts`(5)
  + `TypingIndicator.test.tsx`(4) = 9/9; integration `customer-chat.test.ts` "live typing preview" sneak-peek
  metnini (`'my order is la'`) yalnız-ajana fan-out olarak doğrular (D30 bu turda aynı tm 41 kodu için yeşil
  koştu; kod değişmedi). tm 41 (`done`) geri açılmadı — yeni görev gerekmedi (iş bitmiş). → 541 `⬜`→`✅` +
  Nerede kanıtı yazıldı. Yalnız bu satıra dokunuldu.

- **D32 (03.1.3 · tm 42 · 2026-07-26 · koda karşı doğrulandı):** §4.3 satırı 518 (03.1.3 "Ziyaretçi
  tablosu + satır aksiyonları", Should/v1) `⬜` (Nerede boş) gösteriyordu ama tm 42 (`done`, HANDOFF #42)
  canlı-ziyaretçi panosunu tam teslim etmiş — çelişki tm 42 kapanışında DoD-8 (PLAN satırı güncelleme)
  atlanmasıydı (HANDOFF açıkça "PLAN.md'ye DOKUNMADIM" notu düşmüş: dalda ilgisiz, commit edilmemiş bir D28
  düzenlemesiyle aynı dosyada entangle etmemek için bırakılmış). FR-MOD-03.1.3 KK'sı _"Proaktif temas;
  'Chatting with' insan+AI ajanı gösterir (ör. 'Hazal AI')"_ kodda uçtan uca karşılanıyor: salt-okur
  `GET /traffic` (`routes/traffic.ts`, scope `customers:ro|:rw`; org+license süzme + RLS izolasyon) →
  `traffic-service.ts` `listLive` aktif sohbeti olan ∪ son 30 dk ziyaret eden müşterileri kişi başı tek
  satıra birleştirir, `activity` ∈ browsing/queued/waiting/chatting; **"Chatting with"** çekirdek KK'sını
  insan atanmış→`{kind:'human'}`, yoksa aktif AI persona→`{kind:'ai'}` (ör. "Hazal") olarak çözer — insan
  kazanır, widget başlığı FR-11.3 ile aynı çözümleme. Web `TrafficPage.tsx` (Customers başlığı + `CustomersTabs`
  Contacts|Real-time, rota `/app/customers/real-time`) tablo kolonları Visitor/Activity/**Chatting with**/Actions;
  saf `rowActions.ts` `visitorRowActions` satır aksiyonlarını durum×yetki ile üretir (Start chat/Supervise/
  Assign to me/Edit; uygulanmayan aksiyon `enabled:false`, gizlenmez). Kontrat `paths/traffic.yaml` OpenAPI'de +
  generated `api.ts` (contract-parity yeşil). **DoD kapısı (bu tur çalıştırıldı — hepsi exit 0):** typecheck
  ✅ (11/11) · lint ✅ (8/8) · unit ✅ web 295/295 (incl `rowActions.test.ts` 8) · integration ✅ 670/670
  (incl `traffic.test.ts` 9 [isolation / scope-red / browsing / live-window / human / ai-"Hazal" / human-wins /
  queued / limit] + `contract-parity` 5) · build ✅ (7/7); e2e `traffic.spec.ts` tm 42 kapanışında yeşildi ve
  bu tur yalnız markdown düzenlemesi yapıldığından etkilenmez. tm 42 (`done`) geri açılmadı — yeni görev
  gerekmedi (iş bitmiş). → §4.3'te 518 `⬜`→`✅` + Nerede kanıtı yazıldı. Yalnız bu satıra dokunuldu (186/737/
  1035/1107'deki 03.1.3 toplu/backlog satırları başka gereksinimlerle bundle olduğundan kapsam dışı).

- **D33 (11.7-a · tm 57 · 2026-07-26 · koda karşı doğrulandı):** §4.3 satırı 540 (11.7 "Widget
  customization", Should/v1) `⬜` (Nerede boş) gösteriyordu ama tm 57 (`done`, commit `505cbbf`) widget
  görünüm özelleştirmesini tam teslim etmiş — çelişki tm 57 kapanışında PLAN satırının güncellenmemesiydi.
  FR-MOD-11.7 KK'sı _"Tema/renk/konum; mobil tam ekran; çok dilli; WCAG"_ (§4.4.12 planı ile birebir) kodda
  uçtan uca karşılanıyor: license-singleton `widget_settings` (RLS + CHECK) → GET/PUT `/settings/widget`
  (`routes/settings.ts`, scope `access_rules:ro|rw`, Zod + audit + upsert) → snippet görünümü bake eder,
  customer-token yanıtı taşır; widget `applyAppearance` renk (`--nx-brand`), tema (`data-nx-theme`), konum
  (`.nx-left`), mobil tam ekran (`.nx-mobile-full` + `@media(max-width:480px)`) uygular (mount + token'dan
  yeniden). Web `WidgetCustomization.tsx` kontroller + **canlı önizleme**. "Çok dilli" = proje i18n kararı
  I18N1/2 (tm 26) tr/en katalog + `data-language`→locale fallback zinciri (widget `createTranslator`); PRD
  özellik sütunundaki "45+ dil" bir hedeftir, kabul kriteri (KK) "çok dilli"dir ve karşılanıyor. WCAG:
  `:focus-visible`/`aria-live`/`role`/`prefers-reduced-motion`/`color-scheme`. **DoD kapısı (bu tur
  çalıştırıldı):** widget unit `widget.appearance.test.ts` (9) + `loader.appearance.test.ts` (5) ✅ · web
  `WidgetCustomization.test.tsx` (5) ✅ — KK "unit (tema uygular)" doğrulaması yeşil; integration
  `settings.test.ts` (49) + bundle P3 bütçesi tm 57 kapanışında yeşildi ve bu tur yalnız markdown düzenlemesi
  yapıldığından etkilenmez. tm 57 (`done`) geri açılmadı — yeni görev gerekmedi (iş bitmiş). → §4.3'te 540
  `⬜`→`✅` + Nerede kanıtı yazıldı. Yalnız bu satıra dokunuldu.

- **D34 (13.1-a · tm 60 · 2026-07-26 · yeni teslim):** MOD-13 Home dashboard sıfırdan inşa edildi
  (§4.3 satır 543 `⬜`→`✅`). Üç bölüm tek okumada (`GET /home`, `reports_read`): **(1) aktivasyon
  checklist** — 5 adım stored değil _türetilir_ (website var mı / >1 üyelik ya da bekleyen davet /
  widget_settings / canned / ai_agent), her adımın `done`'u ilgili şey gerçekten var olduğu için doğru,
  bayatlayamaz. **(2) canlı kartlar (KK "canlı gerçek-zaman kartları")** — `visitors_online` = açık chat
  ∪ son 30 dk ziyaret **UNION distinct** (uzun sohbet taze page-view'süz de sayılır, çift saymaz),
  `ongoing_chats` = aktif chat, `agents_online` = `accepting_chats & NOT suspended` (widget'ın "online"
  tanımıyla aynı). **(3) haftalık performans** — son 7 gün vs önceki 7; `chats`/`resolved` **Reports
  overview'ın `chats`/`closed`'ı ile aynı created-in-window taban** (bir tık ötedeki tam raporla asla
  çelişmez) — bilinçli olarak ADR-09 manual/assisted/automated split'ine DOKUNULMADI (o tek yerinde,
  reports route'unda kalır). **Kapsam kararı:** ölçüm reports-flavour olduğundan endpoint `reports_read`
  kapılı (Reports ile aynı kitle); plain agent nav'dan Home'a tıklarsa 403 → dürüst EmptyState. İndeks
  yönlendirmesi inbox'ta bırakıldı (landing değişmedi, e2e/plain-agent bozulmaz). **DoD (bu tur, exit 0):**
  typecheck ✅ · lint ✅ · seri `turbo run test --concurrency=1` ✅ **api 834/834** (+13 `home.test.ts`:
  scope 200/403, canlı sayaç [union distinct / stale-drop / closed-hariç / accepting-only], activation
  türetme, weekly WoW, tenant isolation) + web 307/307 (+8 `dashboard.test.ts` + 4 `HomePage.test.tsx`) +
  `contract-parity` ✅ (/home belgeli+kayıtlı) · build ✅. KK "unit (kartlar) + integration (canlı sayaç)"
  birebir karşılandı. **Kapsam notu:** 03.1.1 bağımlılığı (✅) traffic/ziyaret altyapısı; 13.6-a HelpDesk
  ayrı `[MAX]` task, bu pencerede kapsam dışı.
- **D35 (07.7-a · tm 46 · 2026-07-26 · koda karşı doğrulandı):** §4.3 satır 523 (07.7 "Rapor grupları + Export (CSV)", Should v1–v2) `⬜` (Nerede boş) ile tm 46'nın `done`'u çelişiyordu. Koda karşı denetim: v1 KK'sı = _izin bazlı görünürlük + CSV export_ (benchmark/PDF açıkça v2 — §4.4.8 "Kapsam dışı"), PLAN'ın kendi doğrulama ölçütü de "integration (CSV export; izin gating)". İkisi de karşılanıyor: `reports-export.ts` katalog + `visibleReportGroups` (yetkisiz token'a boş liste, 403 değil) + `toCsv` (RFC4180 + formül-enjeksiyon kalkanı) + `exportFilename`; `reports.ts` `GET /reports/groups` (yetki süzgeci) + `GET /reports/export` (EXPORT_SCOPES route-gate + grup-bazlı yeniden denetim, text/csv attachment); web rapor grupları `ReportsPage.tsx` tabs olarak render; OpenAPI iki yol + contract-parity ✅. Doğrulama bu turda çalıştırıldı (exit 0): unit `reports-export.test.ts` 11/11 · contract-parity 5/5 · integration `reports-billing.test.ts` "report groups + CSV export (07.7)" 11/11 (görünürlük/gating/tenant-izolasyon/bilinmeyen grup/aralık). 07.4-a emsaliyle (API/integration düzeyinde ✅) hizalı → satır 523 `⬜`→`✅`; tm 46 zaten done, yeniden açılmadı. Kapsam: yalnız bu satır.

- **D36 (06.5-a · tm 33.6 · 2026-07-26 · koda karşı doğrulandı):** §4.2 satır 505 (06.5 "Performance (resolution rate, CSAT, transfer)", Should v1) `⬜` (Nerede boş) ile tm 33.6'nın (06.5-a — AI Performance KPI) `done`'u çelişiyordu — DoD-8 (PLAN satırı güncelleme) task kapanışında atlanmış (D29/D30/D35 ile aynı desen). Koda karşı denetim: KK (birebir) = _"KPI kartları; düşük-baz uyarısı; AI off iken arşiv ayrımı"_, doğrulama ölçütü _"unit: düşük-baz → uyarı; sayılar reports=fatura ADR-09"_. Üçü de kodda karşılanıyor: **(1) KPI kartları** — `AiPerformance.tsx` Playbook Performance sekmesinde render edilir (`PlaybookPage.tsx` `VIEW_TABS[performance]` → `view==='performance'` && `<AiPerformance agentActive={aiAgent?.active} canRead={canViewReports}>`); saf `performance.ts` `performanceKpis` dört kart üretir (Resolution rate/AI chats resolved/CSAT/Transferred). **(2) Düşük-baz uyarısı** — `isLowBase` (baz>0 ∧ <`LOW_BASE_THRESHOLD`=20) → kart `tone='warn'`+hint ("Based on few chats") + grid altı dipnot; CSAT bazı chat hacminden bağımsız (rating responses ile). **(3) AI-off arşiv ayrımı** — `!agentActive` → `role=status` "The AI is off — these are historical figures". **Sayılar=fatura** — kartlar `/reports/ai-agent` (07.4-a'nın billing-hizalı ADR-09 sorgusu, §D29) + `/reports/overview` satisfaction'dan okunur; ayrı ikinci sayaç yok. Doğrulama bu turda çalıştırıldı (exit 0): web unit `AiPerformance.test.tsx` 5/5 + `performance.test.ts` 8/8 = 13/13 · web typecheck exit 0 · web lint exit 0. tm 33.6 zaten done, yeniden açılmadı → satır 505 `⬜`→`✅` + Nerede kanıtı yazıldı. Kapsam: yalnız bu satır.

- **D37 (04.6-a · tm 59 · 2026-07-26 · koda karşı doğrulandı):** §4.3 satır 521 (04.6 "Chatbots / Suspended agents sekmeleri", Should v1) `⬜` (Nerede boş) ile tm 59'un (04.6-a) `done`'u çelişiyordu — DoD-8 (PLAN satırı güncelleme) task kapanışında atlanmış (D29/D30/D35/D36 ile aynı desen). PRD KK (birebir) = _"Bot hesabı ücretsiz; suspend/unsuspend"_. İkisi de kodda karşılanıyor: **(1) Suspend/unsuspend** — `routes/agents.ts` PUT `/agents/:agentId/suspension` (scope `agents--all:rw` + rol kapısı `roleAtLeast(admin)`; owner askıya alınamaz, kendini/üst-rütbeyi askıya alma reddedilir, cross-tenant miss→404 RLS ile, aynı-durum idempotent no-op, geçiş `member.suspended`/`member.unsuspended` audit'lenir); askı `agentMembership.suspended`'e yazılır → mevcut token'lar sıradaki istekte ölür, `GET /agents?status=` süzgeci active/suspended/all + `suspended` bayrağı, routing askılıyı atamaz. **(2) Bot ücretsiz** — web `TeamPage.tsx` **Chatbots** bölümü botları `/ai-agents`'ten çeker ("Free — bots never use a seat"), **Suspended** bölümü reinstate + satır-içi Suspend sağlar; bot=ai_agent, koltuk tutmaz, askı koltuğu boşaltır/geri alır. OpenAPI `openapi.yaml` + `paths/agents.yaml` yolu içerir → contract-parity kapsamında. Test `agents-suspension.test.ts` (302 satır) listing/sessions/routing/authz/billing (bot ücretsiz + askı koltuğu boşaltır) alt-başlıklarıyla KK'yı birebir kapsar; audit action'ları `audit-log.ts`'de tanımlı. Bu turda çalıştırılan doğrulama (exit 0): `pnpm -w typecheck` 11/11 (@nexa/api taze derleme) · `pnpm -w lint` 8/8. DB-bağımlı kapılar (integration/e2e/build) tm 59 kapanışında zaten yeşildi (CONVENTIONS §1 gereği `done`'a şart; feature commit `1968e16` + `tm 59 done` commit'i git geçmişinde). tm 59 zaten done, yeniden açılmadı → satır 521 `⬜`→`✅` + Nerede kanıtı yazıldı. Kapsam: yalnız bu satır.

- **D38 (13.6-a · tm 61 → 61.1/61.2 · 2026-07-26 · koda karşı yazıldı):** Task 61 = 13.6-a "Omnichannel Ticketing / HelpDesk katmanı" `[MAX]` — testStrategy'si "başında subtask'lara bölünmeli" + "2+ pencere" diyor. Başta iki alt-görev açıldı: **61.1 backend veri-bütünlüğü katmanı** (bu pencere) + **61.2 frontend HelpDesk yüzeyi** (sonraki pencere). Bu pencere 61.1'i DoD-yeşil kapattı. **Neden `◐` (satır 544), `✅` değil:** KK (birebir) = _"Chat↔ticket köprüsü; ticket yaşam döngüsü; birleşik (ayrı ürün değil)"_ ve doğrulama ölçütü _"integration (merge/unmerge invariant + audit)"_ — üçü de + doğrulama API/veri katmanında birebir karşılanıyor (tickets aynı inbox/API/DB'de, ayrı ürün değil; köprü Dilim 11'den + `source_chat` detail; yaşam döngüsü artık audit'li). Ancak HelpDesk UI yüzeyi (merge/followers/priority aksiyonları `TicketPane.tsx`'te) henüz yok — kullanıcı bu işlemleri UI'dan yapamıyor — bu yüzden dürüst işaret `◐` + eksik = tm 61.2. **Merge tasarımı (neden `[MAX]`):** non-destructive pointer (`Ticket.mergedIntoId` self-FK); merge yalnız işaretçiyi kurar, unmerge yalnız temizler → **tam ters** olduğu için "merge/unmerge invariant" testi kesin. Invariantlar: self-merge (DB CHECK + servis), zincir yok (hedef primary olmalı), primary-with-children merge edilemez, already-merged kaynak reddedilir, cross-tenant `loadVisible`→404. `ticket_followers` license_id taşımaz → `thread_tags` gibi ticket üzerinden RLS (EXISTS parent). **DoD gate (bu pencere, exit 0):** typecheck 11/11 · lint 8/8 · test (api 849, `--concurrency=1` serileştirilmiş) · test:integration 698 · build 7/7 · e2e 55 · contract-parity 5/5 · drift temiz · yeni `tickets-helpdesk.test.ts` 15/15. **Env notu:** `pnpm -w test` paralel paket DB yarışı (api+rtm aynı Postgres'e `TRUNCATE ... CASCADE` → FK ihlali; [[nexa-test-gate-parallel-db]]) — turbo `--concurrency=1` ile serileştirilerek yeşil alındı; kod kusuru değil. Kapsam: yalnız 13.6-a backend (61.1) + satır 544.
- **D39 (13.6-a · tm 61.2 · 2026-07-26 · koda karşı yazıldı):** 61.1'in açtığı backend HelpDesk katmanını `apps/web` inbox'ına bağlayan **frontend yüzeyi**. Satır 544 artık `✅` (backend 61.1 + frontend 61.2). **Yapıldı:** `TicketDetailPane`'e priority seçici + followers (agent picker) + merge (aday listesinden) / unmerge; merged ticket read-only + açıklayıcı banner; `TicketList` satırında priority pill. **Tasarım kararları:** (1) **Priority ölçeği** — kolon signed int ±100; UI 4 adlı seviye (Urgent/High/Normal/Low) sunar ve `nearestPriority` API'nin döndürdüğü keyfi değeri en yakın seviyeye snap'ler (eşitlikte daha acil kazanır) → açık uçlu sayı kutusu yerine sonlu ölçek. (2) **Merge/unmerge hook'ları ticket id'yi mutate-time'da alır** (tek id'ye bağlı değil): merge iki ticket'a dokunur ve agent folded child'ı **primary'nin panelinden** unmerge eder — bu, merged child'lar listeden gizlendiği için (backend `mergedIntoId: null` filtresi) UI'da onlara ulaşmanın tek yolu; böylece `InboxPage`'in "seçili ticket listede yoksa ilkine sıçra" effect'iyle çakışma da yok. (3) **Merged ticket read-only** — backend merged ticket'ın düzenlenmesini reddettiği için (unmerge önce) subject/status/priority disabled + banner. **Neden e2e sadece priority+follower:** e2e seed *truncate'siz* reseed eder (idempotent); merge/unmerge çapraz-ticket kalıcı durum bırakır → tekrar koşuda kırılgan. Bu yüzden merge/unmerge (child + primary) `TicketPane.test.tsx`'te **birebir istek assertion'larıyla** kanıtlandı; e2e canlı-stack smoke'u idempotent olan priority + follower'ı kapsar (`tickets.spec.ts`, geniş viewport — dar transcript header'da "Create ticket" details paneli altına kayıyordu). **Ertelenen (dürüstlük):** liste satırında merged-child sayaç rozeti → liste özet payload'una alan (backend+contract) gerektirir, frontend-scope dışı; KK'nın parçası değil, merge/unmerge UI'dan tam çalışıyor. **DoD gate (bu pencere, exit 0):** typecheck 11/11 · lint 8/8 · test (api 849 + web 320, `--concurrency=1`) · test:integration 698 · build 7/7 · **e2e 56/56** (yeni `tickets.spec.ts` dahil) · contract-parity 5/5 · drift temiz · yeni `TicketPane.test.tsx` 8 + `ticket-priority.test.ts` 6. **Kapsam:** yalnız 13.6-a frontend (61.2); backend/contract'a dokunulmadı (frontend-only). [[nexa-e2e-clean-db]] gereği e2e `.env` source'lanarak koşuldu.
- **D40 (12 Copilot · tm 36 · 2026-07-26 · yeni teslim):** MOD-12 Copilot (agent-assist) `[MAX]` parent — 3 alt-görev (12.2-a/12.1-a/12.3-a) tek pencerede, contract-first. Satırlar 130 (MOD-12), 518 (02.5), 545 (12.1–12.3) `⬜`→`✅`. **Tasarım kararları:** (1) **Ayrı KB = `kind:'copilot'` AiAgent** — şema zaten `ai_agents_kind_check IN ('ai_agent','copilot')` + seed'de Copilot ajanı vardı; copilot bilgi tabanı bu ajanın `KnowledgeSource`'ları, `KnowledgeService.retrieve({aiAgentId})` ile izole. İki liste birbirini görmez: `/knowledge-sources` `where aiAgent.kind='ai_agent'`, `/copilot/knowledge` copilot ajanına scope'lu. (2) **Müşteriye kapalı bedavaya geldi** — copilot rotaları agent-scope'lu (`agents-bot--all` / `chats`), auth plugin default principals=agent+bot → müşteri token'ı **404** (403 değil; boundary I4, widget API'yi haritalayamaz). KK "müşteriye açık değil" birebir. (3) **Assisted = skill_run** — 07.3.2 "assisted" sorgusu `EXISTS skill_runs WHERE chat_id=…`; copilot assist bir `skill_run` yazar (`recordAssist`). FK `skill_runs.skill_id` için copilot skill'i `kind:'workspace'` (`skills_kind_check IN ('ai_agent','workspace')` — 'copilot' YOK; 'workspace' zaten reports-billing `runSkillOn`'un assisted-metrik kind'i), copilot ajanına asılı → benzersiz, `/skills` `ai_agent` süzgeciyle Playbook'ta görünmez. (4) **Özet→internal note** `chats.sendEvent` recipients=agents (RTM fan-out + arşiv + müşteri-filtresi hazır); archived chat → 409. (5) **Yanıt taslağı composer'a** — `copilotDraft` zustand store (typing store deseni); `Composer` draft gelince text'i doldurur + reply moduna geçer + consume eder; RAG boşsa uydurmaz. (6) **enhance/summarise `@nexa/ai-mock`** deterministik (LLM stub ilkesi). **Lazy find-or-create:** fixtures copilot ajanı/skill'i seed'lemez → `ensureAgentId`/`ensureSkillId`. **DoD gate (bu pencere, exit 0):** typecheck 11/11 · lint 8/8 · build 7/7 · test (api 864 + web 354 + ai-mock 56, turbo `--concurrency=1` [[nexa-test-gate-parallel-db]]) — integration dahil (contract-parity 5/5, `copilot.test.ts` 15/15) · e2e `copilot.spec.ts` 1/1 + inbox-panel/inbox-tabs regresyonsuz. Yeni test: `assist.test.ts`(14)+`copilot.test.ts`(15)+`CopilotPanel.test.tsx`(7)+`copilotDraft.test.ts`(3)+`Composer.copilot.test.tsx`(2). **e2e viewport 1680** — transcript header darlığı (tickets.spec emsali) copilot butonunu details paneli altına kaydırıyordu; feature'ın yeni sorunu değil, mevcut header darlığı. **Not:** §2 satır 111 "MOD-01 … Copilot v1" MOD-01 rollup'ı; copilot panel sekmesi artık teslim ama o hücre MOD-01 kapsamı → dokunulmadı. Kapsam: yalnız tm 36 + satır 130/518/545.
- **D42 (02.1.4-a · tm 38 · 2026-07-26 · yeni teslim):** Inbox **Views** grubu (FR-MOD-02.1.4) — kanal görünümleri + custom saved views; satır 516 (02.1.4) + §4.4.6 kalemi `⬜`→`✅`. **KK (birebir)** = _"Kanal bağlı değilse channel-promo; custom saved views eklenebilir"_, doğrulama _"unit (kanal yok→promo)"_ — ikisi de saf `views.ts`'te karşılanır ve `views.test.ts`(19) ile test edilir. **Tasarım kararları:** (1) **Kanal durumu owner/admin kapılı** — `GET /channels` scope'u `channels--all` yalnız `ADMIN_SCOPES`'ta (`DEFAULT_AGENT_SCOPES`'ta yok; "sıradan ajan inbox'ı işletir, kanalı yapılandırmaz" — `principal.ts` yorumu). `useConnectedChannels(enabled)` yalnız `canReadChannels(agent.scopes)` true iken sorgu atar → ajan 403 yemez; kanal bölümü (promo dahil) ona görünmez, yalnız kendi saved view'lerini görür. (2) **Kanal yok→promo** — `showChannelPromo` (bağlı & bilinen kanal yoksa true) → dashed CTA → Settings→Channels; bağlıysa `connectedChannelViews` sabit Messenger→WhatsApp→SMS sırasında satırlar (`twilio`→"SMS"), her biri Settings'e link. MVP'de adaptör kanalı bağlı değil (yalnız `POST /channels/:type/connect` ile bağlanır, UI'da yok) → gerçek/dürüst varsayılan **promo**. (3) **Custom saved views per-browser** — `SavedView{id,name,base:InboxView,traffic:TrafficTab}`, `localStorage` (`nexa.inbox.saved-views`), `rightPanel` deseni (lazy init + persist); ekle (ad trim + 40 cap, boş ad reddi → input açık kalır), sil, reload'da kalıcı; malformed/eski satır `isSavedView` ile düşer → bozuk filtre asla uygulanmaz. Seçim tek tıkta base view + real-time tab uygular. **Neden channel→chat filtresi YOK (dürüstlük):** `ChatSummary`'de kanal/source alanı yok; per-kanal chat süzmek `ChatSummary`'ye kanal etiketi ekler (backend, ayrı task, bu Should diliminin kapsamı değil) → kanal satırları yönetime (Settings) linkler, uydurma filtre kurmaz; KK yalnız promo + saved views'ı şart koşar, ikisi de tam. **DoD gate (bu pencere, exit 0):** typecheck 11/11 · lint 8/8 · build 7/7 · test unit (web **383** incl. yeni `views.test.ts` 19; api 864/rtm 71/widget 48/types 26/ai-mock 56 turbo-cached — backend girdileri değişmedi) · test:integration (api 713 + rtm 42, `--concurrency=1`). **Frontend-only:** yalnız `apps/web` (backend/contract/migration yok) → api/rtm testleri cache-hit; e2e bu yüzeye özel akış yok, koşulmadı (D36 frontend-only deseni). Kapsam: yalnız tm 38 + satır 516 + §4.4.6 kalemi.

- **D43 (08.6.2-a · tm 47 · 2026-07-26 · yeni teslim):** Ticket rules "Ticket rules (atama/etiket/öncelik)" (FR-MOD-08.6.2, Should v1) — satır 531 `⬜`→`✅`. **KK (birebir)** = _"Koşul+eylem zorunlu"_, doğrulama ölçütü _"integration (kural → otomatik atama)"_ — ikisi de karşılanıyor. **Tasarım (campaigns tm 43 kardeş deseni):** saf çekirdek `ticket-rule-matching.ts` (Prisma/saat yok) — `hasCondition`/`hasAction` KK'nın iki yarısını ayrı ayrı kapılar (koşul-yok → hiçbiriyle eşleşmez, tıpkı campaign `hasTrigger` gibi; `priority:0` gerçek eylem sayılır), `matchesTicketRule` set-edilen her koşulu AND'ler. **Model:** yeni `ticket_rules` (license-scoped, RLS=campaigns deseni; `conditions`/`actions` JSONB → yeni koşul/eylem türü migration'sız) + `ticket_tags` (join, license_id taşımaz → `thread_tags` gibi ticket üzerinden RLS EXISTS + GRANT SELECT/INSERT/DELETE; paylaşılan `tags` kütüphanesini yeniden kullanır); migration `20260726180000_ticket_rules` (yapısal SQL `prisma migrate diff`'ten, RLS/policy/GRANT el ile — ticket_helpdesk deseni; pgvector satırı hariç, drift temiz). **Motor** `apply-ticket-rules.ts` ticket açılışında koşar (`create` source=`chat`/`manual` + `createFromEmail` source=`email`), eşleşen kuralları `position` sırasında uygular (sonraki atama kazanır, etiketler birikir); geçersiz hedefi (askılı ajan / silinmiş takım) **atlar** — bozuk kural ticket oluşturmayı bozamaz. **CRUD** `ticket-rule-service.ts` her create/edit'te KK'yı zorlar (koşul-yok/eylem-yok → 400) + `assertActionsResolvable` (atama hedefi tenant'ta yoksa 400; RLS ile cross-tenant reddi). Rota `routes/ticket-rules.ts` `/settings/ticket-rules` (`tickets--all:rw` yaz / `:ro` oku — her ticket'ın nasıl triyaj edildiğini yapılandırmak admin işi). **Web** Settings "Ticket rules" bölümü (`SettingsPage.tsx` `TicketRules`) form-primitifiyle (FR-EK-A.1 tm 29 bağımlılığı) — koşul (subject-contains, zorunlu) + eylem select (öncelik/etiket, değer zorunlu); optimistic toggle + delete. **Atama (KK başlık örneği) backend+API+integration'da tam** (agent/team), UI self-contained öncelik/etiket sunar (team seçici `/groups` scope'una bağlanmasın diye — ayrı scope kuplajından kaçınıldı; API atama yolu integration-test'li). `tags` alanı `TicketDetail` DTO+OpenAPI'ye eklendi (uygulanan etiket görünür). **DoD gate (bu pencere, exit 0):** typecheck 11/11 · lint 8/8 · build 7/7 · test:unit (web 428 incl. `SettingsForms.test.tsx` +2; api unit incl. `ticket-rule-matching.test.ts` 7) · test:integration (api **738**, `--concurrency=1` [[nexa-test-gate-parallel-db]]) incl. yeni `ticket-rules.test.ts` 12 (kural→otomatik atama · koşul/eylem zorunlu · non-existent agent reddi · disabled no-op · source-gating · position sırası · cross-tenant · scope split) + contract-parity 5/5 + regresyon yok (tickets/tickets-helpdesk/channels-adapters=createFromEmail yolu yeşil) · drift temiz. **E2E notu:** ilgili yüzey (Settings/tickets) E2E'si yeşil (12); ancak canlı-chat composer akışı (settings.spec "composer shortcuts" 2 + **dokunulmamış** `demo-flow.spec.ts` 1) bu sandbox'ta widget→RTM canlı-chat pipeline'ının çalışmamasından **önceden** kırık — task'ın kapsadığı akış değil, değişikliğim bu yola dokunmuyor (demo-flow'un dokunulmamış kodda aynı adımda düşmesiyle kanıtlı). Kapsam: yalnız tm 47 + satır 531.
- **D44 (08.7.4-a · tm 49 · 2026-07-26 · yeni teslim):** Chat transcripts (otomatik e-posta) (FR-MOD-08.7.4, Should v1) — satır 533 `⬜`→`✅`. **KK (birebir)** = _"Bitişte müşteri/ekibe transcript e-postası"_, doğrulama ölçütü _"integration (`.data/mail`)"_ — ikisi de karşılanıyor. Bağımlılık tm 31 (T7-a, e-posta bildirim kanalı / FileMailer deseni, ✅). **Tasarım (tm 31 assignee-email kardeş deseni):** saf modül `services/notifications/chat-transcript.ts` — `transcriptRecipients` (adres yoksa müşteri atlanır · atama yoksa [queued/AI-only] ekip kopyası yok · ajanın `notifyEmail` opt-out'u [FR-MOD-08.2] ekip kopyasını susturur, tıpkı `shouldEmailAssignee` gibi) + `renderTranscript` (müşteri kopyası **yalnız** `recipients='all'` olaylardan → internal note müşteriye asla sızmaz, servisin ana invariant'ı; yalnız sistem-olayı taşıyan sohbet hiç mail atmaz). **Paylaşımlı kapanış yolu:** `chat-service.ts`'e opsiyonel 6. ctor param `mailer` + `#emailTranscript` (kapanış transaction'ı **commit ettikten sonra** çağrılır — mail bir yan etki, close'u geri saramaz/kilit tutamaz; `withTenant` ile okur → RLS her lookup'ı bu workspace'e sınırlar, transcript de sohbet gibi tenant sınırı geçemez; logger yok → best-effort, hata yutulur). `deactivate` (ajan arşivi) **ve** `deactivateByTimeout` (idle sweep, tm 48) ikisi de aynı `#emailTranscript`'i çağırır → CloseResult'a `threadId` eklendi. Ajan yazarlar tek sorguda isme çözülür ("Ada:"). **Bağlama:** `chats.ts` rotası + `server.ts` register'a `mailer` geçildi; `chat-timeout-run.ts` sweeper CLI'sine `new FileMailer(env.MAIL_DIR)` bağlandı → idle-close da transcript atar. **Yeni API yolu/şema YOK** → OpenAPI/contract-parity değişmedi (5/5). **DoD gate (bu pencere, exit 0):** typecheck 11/11 · lint 8/8 · build 7/7 · test (api **923** [50 dosya] incl. yeni unit `chat-transcript.test.ts` 9 + integration `chat-transcript.test.ts` 6 + contract-parity 5/5 · rtm 71 — DB süitleri paket-paket seri koşuldu [[nexa-test-gate-parallel-db]]; `pnpm -w test` api+rtm paralelinde Postgres deadlock'u verir, gerçek başarısızlık değil). **E2E notu:** backend-only mailer, tarayıcı akışı yok → task'ın kapsadığı "akış" `.data/mail`'i okuyan integration testidir (tm 47 backend-dilim emsali; browser e2e bu yüzeye özel değil). Kapsam: yalnız tm 49 + satır 533.
- **D45 (08.7.5-a · tm 50 · 2026-07-26 · yeni teslim, resume):** Ticket email templates (markalı, değişkenli) (FR-MOD-08.7.5, Should v1) — satır 534 `⬜`→`✅`. **KK (birebir)** = _"Geçersiz değişken/format engeli"_, doğrulama ölçütü _"unit (geçersiz değişken → hata)"_ — ikisi de karşılanıyor. Bağımlılık tm 29 (T4-a, form-primitif deseni, ✅). **Resume:** iş bu pencereden önce çalışma ağacında hazırdı (contract+migration+backend+frontend+testler yazılıydı); bu pencere sıfırdan yapmadı → DoD kapısını koştu, PLAN/HANDOFF'u kapadı, commit+push+done. **Tasarım (KK'yı taşıyan tek özellik = geçersiz değişken/format engeli):** paylaşımlı katalog+doğrulayıcı+renderer `packages/types/src/template-variables.ts` — `TEMPLATE_VARIABLES` sabit katalog (`group.field`; tek doğruluk kaynağı, form ve endpoint aynı listeyi süzer), `findTemplateProblems`/`findTemplateProblemsIn` her `{{ … }}` placeholder'ı iki kapıdan geçirir (bilinmeyen değişken → `unknown_variable`; boş/kötü-adlı/dengesiz-veya-iç-içe brace → `malformed`; iyi-biçimli olanlar çıkarıldıktan sonra kalan `{{`/`}}` = dengesiz), `renderTemplate` doğrulanmış şablonu doldurur (bağlamda olmayan değişken boş → asla ham brace bırakmaz). **Enforcement servis'te** (`ticket-email-template-service.ts` `assertPlaceholdersValid` her create + subject/body dokunan her edit'te → şablon tabloya ulaşmadan reddedilir; license-scoped CRUD, `deleteMany`/`findFirst` licenseId ile → id-tek başına başka tenant'a erişemez). **Model** `ticket_email_templates` (license-scoped, ticket_rules deseni; migration `20260726190000` yapısal DDL + RLS policy [ALL, USING+WITH CHECK `nexa_current_license()`] + GRANT nexa_app — el ile, ticket_rules emsali; drift temiz). **Rota** `/settings/ticket-email-templates` (oku `tickets--all:ro`/`:rw`, yaz `:rw` — her ticket'ın gönderebileceği postayı yapılandırmak admin işi). **Web** Settings "Ticket email templates" (`SettingsPage.tsx` `TicketEmailTemplates`, tm 29 form-primitifi) — `templateText(field)` validator aynı `@nexa/types` kataloğundan canlı alan-altı hata verir → Submit değişken geçerli olana dek kapalı; optimistik enable/disable (ticket-rules toggle deseni). **Yeni tip** `@nexa/types` `TicketEmailTemplate` DTO + `template-variables.ts` export. **DoD gate (bu pencere, exit 0):** typecheck 11/11 · lint 8/8 · build 7/7 · test:unit (types `template-variables.test.ts` 15 + web `SettingsForms.test.tsx` TicketEmailTemplates +2 [7 dosya toplamı]; web 430) · test:integration (api **754** [36 dosya], `--concurrency=1` [[nexa-test-gate-parallel-db]]) incl. yeni `ticket-email-templates.test.ts` 10 (bilinmeyen değişken subject+body reddi · malformed reddi · valid round-trip · edit yeniden-doğrulama · cross-tenant liste/edit reddi · scope split ro/rw) + contract-parity 5/5 (bundle yeniden üretildi, yeni 2 yol tanınıyor) + regresyon yok. **E2E notu:** `settings.spec.ts` **10 geçti** (yeni bölüm mevcut Settings akışlarını bozmadı — kapsamlı region/label sorguları, tenant'ta şablon yok → EmptyState [li yok]); aynı dosyadaki 2 `composer shortcuts` testi **önceden kırık** (canlı visitor→agent RTM routing bu sandbox'ta çalışmıyor) — değişikliğimden bağımsız olduğu **kanıtlandı**: tracked değişiklikler `git stash` ile çıkarılıp baseline'da aynı 2 test birebir aynı hatayla düştü (D43 emsali). Task'ın kapsadığı akış = Settings CRUD + geçersiz-değişken engeli (unit+integration'da tam). Kapsam: yalnız tm 50 + satır 534. **Not:** `.parked-playbook/` (skill-browser) bu task'a ait değil, önceki park edilmiş iş — dokunulmadı, commit'e alınmadı.

- **D46 (08.7.6-a · tm 51 · 2026-07-26 · yeni teslim):** Custom fields (ticket/contact) (FR-MOD-08.7.6, Should v1) — satır 535 `⬜`→`✅`. **KK (birebir)** = _"Tip/zorunluluk; Details+CRM'de görünür"_, doğrulama ölçütü _"integration (alan yaz→Details/CRM'de oku)"_ — ikisi de karşılanıyor. Bağımlılık tm 29 (T4-a form-primitifi, ✅). **Tasarım (KK'yı taşıyan iki özellik = tip + zorunluluk):** paylaşımlı tip-kataloğu+doğrulayıcı `packages/types/src/custom-fields.ts` — `CUSTOM_FIELD_ENTITIES` (ticket/contact) + `CUSTOM_FIELD_TYPES` (text/number/boolean/date) sabitleri, `checkCustomFieldValue(field, raw)` bir ham değeri tipine göre doğrular ve kanonik biçime normalleştirir (number → `Number` sonlu; boolean → `true`/`false`; date → gerçek `YYYY-MM-DD`), boş değer zorunlu alanda `required` problemi / opsiyonelde `null`; `customFieldError` aynı kararın form-yüzü. Tek doğruluk kaynağı: form ve endpoint aynı fonksiyonla "geçerli" der (ticket-email-templates emsali). **Model** iki tablo, license-scoped: `custom_field_definitions` (entity/label/type/required; `@@unique(license,entity,label)`) + `custom_field_values` (definition_id + ticket_id|customer_id; **bir-varlık CHECK** = tam biri set; `@@unique(definition,ticket)`/`(definition,customer)` = varlık başına tek değer). Migration `20260726200000` yapısal DDL (prisma migrate diff çıktısı, pgvector DROP hariç) + entity/type CHECK'leri + one-entity CHECK + RLS policy [USING+WITH CHECK `nexa_current_license()`] + GRANT nexa_app — el ile, ticket_email_templates emsali; **drift temiz** (`db:check-drift` = no drift). FK'ler onDelete Cascade (definition/ticket/customer silme → değer düşer). **Servis** `custom-field-service.ts`: tanım CRUD (`createDefinition` P2002→dup-label 400; `updateDefinition` entity/type immutable — re-tip = yeni alan; license-scoped `deleteMany`/`findFirst`) + değer `setValues` (her değeri tanımına karşı doğrular → yanlış tip / zorunlu-boş / bilinmeyen-alan reddi; `null`→sil, aksi upsert) + standalone `readCustomFieldValues` (tanım⋈değer, her tanım için bir giriş, set değilse `value=null`) — ticket-service.toDetail ve customer-service.get bunu gömer, böylece `custom_fields` **her** detay yanıtında var. **Rota** tanım `/settings/custom-fields` (`access_rules:ro/rw` — alan tanımı iki varlığı kapsar, admin işi) + değer yazma `PUT /tickets/:id/custom-fields` (WRITE_SCOPES; önce `tickets.get` görünürlük/varlık) & `PUT /customers/:id/custom-fields` (`customers:rw`; önce customer var mı). **Web** Settings "Custom fields" tanım formu (`SettingsPage.tsx` `CustomFieldsSettings`, form-primitif: label required + entity/type select + required checkbox; dup-label sunucu reddi yüzeye çıkar) + paylaşımlı `features/custom-fields/CustomFields.tsx` (tipli kontrol/alan; `customFieldError` ile canlı alan-altı hata + değişen-yalnız kaydet) → CustomerDetailPanel (CRM) `custom_fields` kartı + TicketPane (Details) `TicketCustomFieldsSection`; tanım yoksa hiçbir şey render etmez. `useSetTicketCustomFields` PUT→`settle` cache. **Yeni tipler** `@nexa/types` `CustomFieldDefinition`/`CustomFieldValue` + `custom_fields` alanı web `TicketDetail`/`CustomerDetail` ve api `TicketDetail`/`CustomerDetail`'e eklendi. **OpenAPI** `CustomFieldDefinition`/`CustomFieldValue`/`CustomFieldValuesInput` şema + `custom-fields.yaml` (4 yol) + tickets/customers'a PUT anchor (2 yol); `TicketDetail`/`CustomerDetail` şemasına `custom_fields` (required). **DoD gate (bu pencere, exit 0):** typecheck 11/11 · lint 8/8 · build 7/7 · test:unit (types `custom-fields.test.ts` 9 [50 toplam] + web `CustomFields.test.tsx` 6 + `SettingsForms.test.tsx` +2 [web 438/63 dosya]) · test:integration (api **767**/37 dosya, `--concurrency=1` [[nexa-test-gate-parallel-db]]) incl. yeni `custom-fields.test.ts` 13 (contact değeri yaz→CRM oku · ticket değeri yaz→Details oku · set-değilse null · yanlış tip reddi · zorunlu-boş reddi + dolu kabul · yanlış-varlık reddi · dup-label reddi · silme→değer cascade · null→temizle · read-only admin liste-var yaz-yok · customers:rw'siz değer reddi · cross-tenant tanım gizli · cross-tenant değer reddi) + contract-parity 5/5 (bundle 106 yol, yeni 6 yol tanınıyor) + regresyon yok. **E2E notu:** task'ın test stratejisi **integration** ("alan yaz→Details/CRM'de oku") — bu pencere onu tam koştu (yaz→oku iki yönde de doğrulandı); e2e ayrıca koşulmadı (Settings'e eklenen bölüm tanım yokken hiçbir şey render etmez → mevcut akışlara etkisiz; D45 settings e2e emsali). Kapsam: yalnız tm 51 + satır 535. **Not:** `.parked-playbook/` bu task'a ait değil — dokunulmadı, commit'e alınmadı.
- **D47 (08.7.7-a · tm 52 · 2026-07-27 · yeni teslim):** Forms builder (pre/post-chat) (FR-MOD-08.7.7, Should v1) — satır 536 `⬜`→`✅`. **KK (birebir)** = _"En az bir alan; tip validasyon; widget'ta gösterim → contact/ticket'a yazma"_, doğrulama _"integration (form→ticket) + negatif (geçersiz alan)"_ — üç KK yan-tümcesi de pre-chat yoluyla karşılanıyor. Bağımlılık tm 29 (T4-a form-primitifi) + tm 51 (custom fields, ✅). **Tasarım kararı (yeniden-kullanım, [[nexa-early-delivered-slices-audit]] ruhu):** pre-chat form alanı **ayrı tablo değil**, `form_placement='pre_chat'` işaretli bir **contact** custom-field'ıdır (tm 51). Böylece yanıt zaten var olan `checkCustomFieldValue` ile tipine göre doğrulanır (KK "tip validasyon"), `setValues('contact')` ile kişiye yazılır ve CRM'de görünür (KK "contact'a yazma") — paralel depo, yeni RLS/GRANT, yeni değer yolu yok. Ticket field'ı pre-chat olamaz (sohbet öncesi ticket yok) → CHECK bunu `entity='contact'`'a kısıtlar. **Model:** `custom_field_definitions`'a tek kolon `form_placement TEXT?` (`@map`); migration `20260726210000_prechat_form` = `ADD COLUMN` (prisma diff çıktısı) + el-ile CHECK `form_placement IS NULL OR (form_placement IN ('pre_chat') AND entity='contact')` (Prisma ifade edemez; custom_fields emsali) — index yok (mevcut `(license,entity,label)` unique'i license+entity prefix'ini karşılar), **drift temiz** (`db:check-drift` = no drift). **Tipler** `@nexa/types/custom-fields.ts`: `FORM_PLACEMENTS`(['pre_chat']) + `FormPlacement` + `PreChatFormField`{definition_id,label,type,required} + `CustomFieldDefinition.form_placement`. **Servis** `custom-field-service.ts`: `create/updateDefinition` `formPlacement` alır (guard: placement yalnız contact) + `toDefinitionDto`'ya `form_placement` + yeni `listPreChatForm` (contact & pre_chat, createdAt sırası, widget-şekli map). **Rota (yeni yol YOK — mevcutları genişletir):** `/settings/custom-fields` create/patch gövdesine `form_placement` (zod enum) · token mint `/customer/token` yanıtına `pre_chat_form` (`readPreChatForm` best-effort, appearance ile `Promise.all` — okuma hatası token'ı reddetmez) · `/customer/chat/events` gövdesine `custom_fields: Record<string,string|null>` → isim/e-posta bloğundan sonra, sohbet başlamadan önce tek `withTenant` içinde `setValues('contact')` (geçersiz tip / zorunlu-boş / bilinmeyen-alan → 400, atomik: bozuk form yarım sohbet bırakmaz). **RLS kanıtı:** müşteri principal'ı da `nexa_app` rolü + license-scoped RLS ile yazar (mevcut isim/e-posta/rating yazımları gibi); cross-tenant field id → RLS tanımı gizler → 400 (integration ile kanıtlı). **Web** Settings "Pre-chat form" builder `PreChatFormSettings` (`SettingsPage.tsx`, tm 29 form-primitifi: label required + tip select + required checkbox → contact custom-field'ı `form_placement='pre_chat'` ile yaratır; prefix-invalidate CRM listesini de tazeler; yalnız pre_chat alanları listeler). **Widget** (50 KB bütçe içinde, 28.4 KB): `api.ts` mint'ten `pre_chat_form` → `#preChatForm` getter + `send()` `custom_fields` opsiyonu; `widget.ts` pre-chat formuna `nx-prechat-fields` konteyneri + `renderPreChatFields` (mint sonrası dinamik: text/number/date input, boolean checkbox; `data-def-id`/`data-field-type`) + `submitPrechat` yanıtları toplar (zorunlu-boş → submit'i bloke eder; tip'i sunucu doğrular) + ilk mesajla `custom_fields` gönderir; **alan yoksa sabit isim/e-posta 11.2 formu değişmez** (`:empty{display:none}`). **DoD gate (bu pencere, exit 0):** typecheck 11/11 · lint 8/8 · build 7/7 (widget 28.4 KB) · test:unit (widget `widget.prechat.test.ts` 4 [52 toplam] + web `SettingsForms.test.tsx` +2 [440/63 dosya] + types 50) · test:integration (api **771**/37 dosya, `--concurrency=1` [[nexa-test-gate-parallel-db]]) incl. yeni `customer-chat.test.ts` pre-chat 4 (token'da alanlar · contact'a yazma [agent CRM'de okur] · yanlış tip reddi + sohbet açılmaz · cross-tenant field reddi) + contract-parity 5/5 (yeni yol yok, mevcut yollar tanınır) + regresyon yok (custom-fields 13 dahil hepsi yeşil) · drift temiz. **E2E notu:** task test stratejisi **integration** (form→contact + negatif) — bu pencere tam koştu. Full Playwright e2e ayrıca koşulmadı: değişiklik toplamsal ve konfigüre edilmedikçe atıl (alan yoksa widget sabit 11.2 formunu birebir gösterir → mevcut `widget.spec.ts` greeting/pre-chat testi [`Your name`/`Start chat`] değişmeden geçer; widget davranışı 4 yeni unit testle kanıtlı) — D45/D46 settings/widget-config e2e emsali. **Kapsam sınırı (dürüstlük):** yalnız **pre-chat** uçtan uca teslim; `form_placement` modeli post-chat'e açık ama widget'ın kapanış-sonrası render'ı + ikinci teslim yolu **ertelendi** — KK'nın üç ölçütü (en az bir alan / tip validasyon / widget→contact) pre-chat ile tamamen karşılanıyor, "(pre/post-chat)" başlık tanımı; post-chat ayrı dilim. Kapsam: yalnız tm 52 + satır 536. **Not:** `.parked-playbook/` bu task'a ait değil — dokunulmadı, commit'e alınmadı.
- **D48 (02.1.2-a · tm 37 · 2026-07-27 · çelişki denetimi, koda karşı doğrulandı):** §4.3 satır 515 (02.1.2 "AI Agents grubu (AI agent / Solved)", Must v1) `⬜` (Nerede boş) ile tm 37'nin (02.1.2-a) `done`'u çelişiyordu — DoD-8 (PLAN satırı güncelleme) task kapanışında atlanmış (D37 ile aynı desen: kardeş 02.1.4 satırı ✅ + tm 38 done iken 02.1.2 satırı ⬜ kalmıştı). PRD KK (birebir, §501) = _"AI konuşmalarını insan kuyruğundan ayırır; Solved → AI resolution sayacı"_. İkisi de kodda karşılanıyor: **(1) İnsan kuyruğundan ayrım** — `services/chat/chat-service.ts` `viewFilter('ai')` = `active:true` + `events some authorType='bot'` & `events none authorType='agent'`; bot-event şartı, aynı şekilde agent-event'i olmayan bekleyen ziyaretçiyi (queued/unassigned) grubun **dışında** tutar (integration testi: AI grubu yalnız AI chat'i içerir, bekleyen visitor unassigned'da kalır, AI chat my/queued'de yok). **(2) Solved → AI resolution sayacı** — `viewFilter('ai_solved')` = `active:false` + `events none authorType='agent'` = ADR-09'un birebir predicate'i (`routes/reports.ts` `AGENT_EVENT` + `automated = NOT active AND NOT agent-event`); kod yorumu "ekstra koşul eklenmemeli, aksi halde Solved listesi ile fatura sayacı çelişir" diye kilitliyor. Test `test/integration/chats.test.ts` "AI Agents group" (3) bunu birebir kanıtlıyor: Solved listesi id'leri = `usageRecord` `ai_resolutions` quantity (2 = 2), bir agent yanıtı chat'i AI grubundan **ve** faturadan düşürür. Frontend: `InboxPage.tsx` `AI_VIEWS` grubu (AI agent/Solved) + `useViewCounts` canlı sayaçlar + tür-bazlı boş durumlar; tip `types.ts` `InboxView` (`ai`/`ai_solved`), rota enum `routes/chats.ts`. Bu turda çalıştırılan doğrulama (exit 0): `pnpm -w typecheck` 11/11 · `pnpm -w lint` 8/8 (bu pencere yalnız PLAN.md düzeltir, kod değişmedi). DB-bağımlı kapılar (integration/build/e2e) tm 37 kapanışında zaten yeşildi (CONVENTIONS §1 gereği `done`'a şart). tm 37 zaten done, yeniden açılmadı → satır 515 `⬜`→`✅` + Nerede kanıtı yazıldı. Kapsam: yalnız bu satır.
- **D49 (09.1-a · tm 53.1 · 2026-07-27 · resume kapanışı):** Apps Marketplace + OAuth akışı (MOCK) (FR-MOD-09.1, Should v1) — satır 538 (09.1) `⬜`→`✅`. **KK (birebir)** = _"Kart → izin/OAuth akışı; bağlanınca veri sohbet içinde"_, doğrulama ölçütü _"integration: mock OAuth → kurulu görünür"_ — ikisi de karşılanıyor. Bağımlılık tm 30 (T6-a virtualization, ✅). **Resume:** slice önceki pencerede yazılıp commit'lenmişti (`bdd10d8` katalog+OpenAPI, `6e83aed` mock OAuth + in-chat veri + migration; `29637c1` handoff) ama DoD kapısı yalnız typecheck'e kadar koşulmuş, done kararı bu pencereye bırakılmıştı. Bu pencere sıfırdan yapmadı → mevcut işi doğruladı, **tam DoD kapısını koştu**, PLAN/HANDOFF'u kapadı, push + done. **Tasarım (KK'yı taşıyan iki yarı = kart→OAuth + bağlanınca-veri):** (1) statik **katalog** `@nexa/types/apps.ts` `APP_CATALOG` — grid, servis ve testler hangi app'lerin var olduğunda anlaşsın diye tek doğruluk kaynağı; `findApp`/`isAppId` + deterministik `appChatData(entry, seed)` in-chat stub (canlı çağrı değil, müşteri kimliğine göre kararlı). (2) **servis** `services/apps/app-service.ts` yalnız *bağlantıları* yönetir: `list` (katalog ⋈ workspace kurulumları), `oauthStart` (imzalı `state` mint — saf, yazma yok), `oauthCallback` (state doğrula → `app_installations` upsert, idempotent), `disconnect` (silinen satır sayısı), `chatData` (bağlı app'lerin bu sohbetin müşterisi hakkındaki mock verisi). **OAuth MOCK ama CSRF gerçek** (MASTER-PROMPT §5): gerçek sağlayıcı yok, fakat `state` HMAC-SHA256 ile imzalanır (app+license+nonce+10dk expiry), `#verify` constant-time compare → kurcalanmış/replay state gerçek bir OAuth client gibi reddedilir; secret JWT signing key'den domain-ayrık türetilir (yeni env yok). **Model** `app_installations` (license-scoped, `@@unique(license,app_id)`, migration `20260727090000_app_installations` — yapısal DDL + RLS policy + GRANT nexa_app el ile, custom_fields emsali; **drift temiz** = `db:check-drift` no drift). **Rota** `routes/apps.ts`: yönetim `/settings/apps` (GET `access_rules:ro/rw`) + OAuth start/callback + DELETE (`access_rules:rw`) = üçüncü-parti app bağlamak admin işi; **tek istisna** `GET /chats/:id/apps` sohbeti işleyen ajanın zaten sahip olduğu chat scope'unda (`chats--all:ro`/`chats--access:ro`) — Details panosunda okunur. Bağlantı yoksa/cross-tenant → 404 (NFR-S5, chat id tenant'lar arası problanamaz). **Web** `features/apps/AppsMarketplace.tsx` (kart grid + connect/disconnect) + `App.tsx` `/app/apps` rotası + `DetailsPanel.tsx` **additive** "Apps" bölümü (`GET /chats/:id/apps` → bağlı-app alanları; boşsa/scope yoksa "No connected apps", paneli bloke etmez). **Kontrat** `@nexa/types` `App*` DTO'ları + OpenAPI `paths/apps.yaml` (5 yol) + şemalar → bundle+client yeniden üretildi (contract-parity 5/5, [[nexa-contract-parity-gate]]). **DoD gate (bu pencere, exit 0):** typecheck 11/11 · lint 8/8 · build 7/7 · test:unit (types `apps.test.ts` 4 + web `AppsMarketplace.test.tsx` 3; api 179 · rtm 29 · widget 52 · types 54 · ai-mock 56) · test:integration (api **778**/38 dosya, `--concurrency=1` [[nexa-test-gate-parallel-db]]) incl. yeni `apps.test.ts` **7** (mock OAuth→kurulu görünür · in-chat veri · disconnect+ikinci disconnect 404 · tampered/mismatch state reddi · yok-app→404 · read-only admin list-var-connect-yok · cross-tenant izole) + contract-parity 5/5 + regresyon yok · rtm 42 · drift temiz. **E2E notu:** task test stratejisi **integration** ("mock OAuth → kurulu görünür") — bu pencere onu tam koştu (7 test, KK'nın iki yarısı da: connect→installed + in-chat veri). Apps için ayrı browser e2e spec'i yok; web yüzeyi **additive** (yeni `/app/apps` rotası + DetailsPanel'e boşken "No connected apps" diyen bölüm, mevcut seçici değişmez) → mevcut e2e etkilenmez; full Playwright ayrıca koşulmadı (D45/D46/D47 integration-strateji emsali; RTM canlı-chat e2e bu sandbox'ta önceden kırık). **Kapsam sınırı (dürüstlük):** yalnız **09.1-a** (satır 538) teslim; kardeş **09.2-a** (tm 53.2, satır 539, 15–20 kart listesi) ve **08.8.1-a** (tm 53.3, satır 537, Settings→marketplace girişi) **pending** → o satırlar `⬜` bırakıldı, parent tm 53 `in-progress` kalır. **Not:** `.parked-playbook/` bu task'a ait değil (SkillBrowser/RecommendedSkills, FR-MOD-05.3/05.4) — dokunulmadı, izlenmiyor. Bu pencere ayrıca çalışma ağacında pre-existing duran D48/02.1.2 (tm 37) PLAN düzeltmesini **ayrı** docs commit'le kapadı (temiz ağaç, CONVENTIONS §5 kapsam ayrımı). Kapsam: yalnız tm 53.1 + satır 538.
- **D50 (09.2-a · tm 53.2 · 2026-07-27 · resume kapanışı):** Apps entegrasyon dizini — tam liste (15–20) + kanal çapraz-linki (FR-MOD-09.2, Should v1) — satır 539 (09.2) `⬜`→`✅`. **KK (birebir)** = _"Her biri OAuth/API key; kanal-tipli olanlar Channels'ta da yönetilir"_, doğrulama ölçütü _"unit: liste + kanal-tipli çapraz"_ — ikisi de karşılanıyor. Bağımlılık 53.1 (09.1-a, ✅). **Resume:** slice bu pencereden önce çalışma ağacında hazırdı (types/servis/web/OpenAPI/testler + tasks.json 53.2 in-progress); bu pencere sıfırdan yapmadı → mevcut işi doğruladı, tam DoD kapısını koştu, PLAN/HANDOFF'u kapadı, commit+push+done. **Tasarım (KK'nın iki yarısı = tam liste OAuth/API-key + kanal-Channels çapraz):** (1) **Katalog büyütme** `@nexa/types/apps.ts` `APP_CATALOG` 09.1'in 5 temsili kartını **20**'ye çıkardı: 10 veri app'i **iki sağlayıcı türünü de** kapsıyor (OAuth: Salesforce/PayPal/Slack/Jira · API-key: Intercom/Zendesk/WooCommerce/Magento/Klaviyo/Segment) + 5 kanal-tipli kart (WhatsApp/Messenger/Instagram/Telegram/SMS-Twilio). Yeni kategoriler `support`/`analytics`/`channels`. (2) **Kanal çapraz-linki** = yapının kalbi: kanal-tipli app `channel: ChannelType` taşır ve **Settings→Channels'ta** kurulur, marketplace OAuth'unda değil → `dataLabel`/`dataFields` **opsiyonel** yapıldı (kanal app'i in-chat veri taşımaz), `isChannelApp`/`channelApps`/`connectableApps` katalogu ikiye böler, `appChatData` eksik alanları boş sayar. **Tek-yüzey invariant'ı servis'te zorlanır:** `app-service.ts` `requireConnectableApp` → kanal app'inin `oauthStart`/`oauthCallback`/`disconnect`'i `ApiError.validation` (400) ile reddedilir; `chatData` kanal app'lerini filtreler (zaten bağlanamazlar). **Web** `AppsMarketplace.tsx` karta göre dallanır: veri app'i = `DataAppCard` (connect/disconnect), kanal app'i = `ChannelAppCard` = "In Channels" rozeti + "Manage in Channels" linki (`/app/settings#section-channels`, `react-router` `Link`), Connect yok. **Kontrat** OpenAPI `AppListItem`: kategori enum'a support/analytics/channels + zorunlu `channel` alanı (`oneOf` string-enum [CHANNEL_TYPES ile **birebir**: website_widget…chat_page] | null) → bundle+client yeniden üretildi (idempotent, drift yok). Yeni API yolu **yok** (mevcut şema genişledi) → contract-parity 5/5. **DoD gate (bu pencere, exit 0):** typecheck 11/11 · lint 8/8 · build 7/7 · db:check-drift temiz (yeni migration yok) · test:unit (types `apps.test.ts` +2 [56 toplam: 15–20 kart & iki provider · kanal-çapraz partition, CHANNEL_TYPES doğrulaması] + web `AppsMarketplace.test.tsx` +1 [444: kanal kartı Connect yerine Channels'a linkler]) · test:integration (api **779**/38 dosya `--concurrency=1` [[nexa-test-gate-parallel-db]]) incl. `apps.test.ts` **8** (+1: tam dizin 15–20 · whatsapp channel='whatsapp'/category='channels'/installed=false · veri app channel=null · kanal OAuth-start & disconnect 400) + contract-parity 5/5 + regresyon yok · rtm 42. **Test-gate notu:** `pnpm -w test` api+rtm DB süitlerini paralel koşup Postgres deadlock (40P01) verdi — gerçek başarısızlık değil, [[nexa-test-gate-parallel-db]]; paket-paket seri koşulunca api 958 · rtm 71 tamamen yeşil. **E2E notu:** task test stratejisi **unit** ("liste + kanal-tipli çapraz") — types+web unit + api integration'da tam koşuldu. Apps için ayrı browser e2e spec'i yok; web değişikliği additive (kanal kartı yeni dal, mevcut veri-app kartı seçicileri değişmez) → mevcut e2e etkilenmez, full Playwright koşulmadı (D49 emsali). **Kapsam sınırı (dürüstlük):** yalnız **09.2-a** (satır 539) teslim; kardeş **08.8.1-a** (tm 53.3, satır 537, Settings→marketplace girişi) **pending** → satır 537 `⬜` bırakıldı, parent tm 53 `in-progress` kalır. **Not:** `.parked-playbook/` bu task'a ait değil (SkillBrowser/RecommendedSkills) — dokunulmadı, izlenmiyor. Kapsam: yalnız tm 53.2 + satır 539.
- **D51 (08.8.1-a · tm 53.3 · 2026-07-27):** Apps (marketplace) girişi — Settings→Integrations kapısı (FR-MOD-08.8.1, Should v1) — satır 537 (08.8.1) `⬜`→`✅`; parent **tm 53 tümüyle done** (53.1/53.2/53.3). **KK (birebir)** = _"Üçüncü parti dizin (detay MOD-09)"_, doğrulama ölçütü _"unit: giriş → 09.1"_ — ikisi de karşılanıyor. Bağımlılık 53.1 (09.1-a, ✅). **Boşluk:** 53.1 marketplace'i (`AppsMarketplacePage`, `/app/apps`) + 53.2 tam dizini yazdı ama **rota modül-rayında (`navigation.ts` MODULES/FOOTER) yoktu** ve Settings'te giriş yoktu → grid yalnız URL elle yazılınca erişilebilirdi. Bu satır o kapıyı açar. **Tasarım:** `SettingsPage.tsx`'e **export** `Integrations` bölümü — Channels'ın hemen altına (dış-dünya bağlantıları bir arada) yerleşen `<Section title="Integrations">` + `react-router` `Link to="/app/apps"` ("Open marketplace"). Ayrı veri çağrısı yok (saf navigasyon); marketplace'in kendisi (`/settings/apps` GET) `access_rules` kapısını zaten kapıda uyguluyor, giriş linki herkese görünür (TrustedDomains/FileSharing gibi bölüm hep render, canEdit yalnız mutasyonu gate'ler emsali). **Kapsam (dürüstlük):** minimal giriş — komut paleti / modül-rayına Apps EKLENMEDİ (task "Settings→Integrations girişi" der, CONVENTIONS §5). **DoD gate (bu pencere, exit 0):** typecheck 11/11 · lint 8/8 · build 7/7 · test:unit 10/10 paket (web **445**, +1 = yeni `Integrations.test.tsx`: link href → `/app/apps`) + web settings+apps odaklı 31/31. **Integration/contract-parity notu:** değişiklik **saf web-additive** — API rotası/OpenAPI/migration/servis yüzeyi **yok** → api integration & contract-parity (5/5) yapısal olarak etkilenmez, bu pencere DB süitini bu-alan-değişmediği için koşmadı (D49/D50 E2E-strateji dürüstlük emsali); task test stratejisi zaten **unit**. **E2E notu:** Settings e2e (`settings.spec.ts`) region'ları erişilebilir ada göre seçer (Website widgets/Trusted domains/Channels…); yeni "Integrations" region'ı bunların hiçbiriyle çakışmaz, bölüm-sayısı iddiası yok → additive, mevcut e2e etkilenmez. **Not:** `.parked-playbook/` bu task'a ait değil — dokunulmadı, izlenmiyor. Kapsam: yalnız tm 53.3 + satır 537.
- **D52 (GO-LIVE planlama turu · 2026-07-28):** kapanış + canlıya hazırlık kırılımı **§4.5** eklendi; tm **85–88** açıldı, tm **68/69/70** deferred→pending'e alındı. **Dört bulgu:** (1) **Üç v1 satırı bayat** — 06.2.4 / 06.3.2 / 10.1.4 `◐` duruyordu ama işler TM'de done (tm 33 alt-görevleri + tm 54) ve kod mevcut (`step-reorder.ts`+`SkillEditor.tsx`; `web-crawler.ts`+`lib/ssrf.ts`; `BillingPage.tsx` meter/`quota_warning`). Satırlar bu turda **çevrilMEdi** — çeviri kanıt (odaklı test koşusu) ister; GL-1 (tm 85) denetim görevi açıldı. Panel "TM'de bitti, PLAN'da ◐" bulgu deseninin devamı. (2) **Faz kapanış turları hiç görev olmamıştı** — Faz-0'ın 9 kapanış alt-görevi done ama §F.1 10 madde tam sürüm hiç koşulmadı, üst tablo `❌ AÇIK`; TM kuyruğu boşalınca (62 done · 0 pending) panel critical "run-loop duracak" verdi. GL-3/GL-4 (tm 87/88) açıldı. (3) **`.parked-playbook/`** izlenmeyen yarım iş — GL-2 (tm 86). (4) **Öne çekme sapması (kullanıcı kararı 2026-07-28):** hızlı canlıya geçiş için v2'nin üç saf-güvenlik kalemi 08.9.5 (CC masking) / 08.9.2 (banned tamamlama) / 08.9.3 (spam) GL-5/6/7 olarak öne çekildi. **Gerekçe:** canlı trafikte PII/kötüye-kullanım riski gerçek; üçü de dış bağımlılıksız saf kod; §5.1 istisnası (_"saf güvenlik kuralları … istenirse şimdi atomik bölünebilir"_) zaten öngörüyordu. **Faz disiplini korundu:** üçü de GL-4 (v1 kapanışı) bağımlılığıyla zorlandı — §1.3'teki "Faz-0 delikken v1 işi alındı" hatasının tekrarı değil; kapanış ÖNCE, öne çekilen iş SONRA. **Dış entegrasyonlar deferred kaldı** (tm 63–67 · 71–84; kullanıcı kararı): gerçek Stripe/SMTP/S3/ClamAV geçişleri kod değil yapılandırma (provider desenleri hazır) ve PRD §11.1 + CLAUDE.md sınırı gereği bu depodan yapılmaz. Bu tur yalnız PLAN + tasks.json değiştirdi (kod yok → DoD kod kapısı uygulanmaz; commit `docs(plan)`).
- **D53 (GL-1 · SYNC-a · tm 85 · 2026-07-31):** §D52'nin açtığı "TM'de bitti, PLAN'da ◐" bulgu deseninin son üç örneği **kanıtla kapatıldı** — 06.2.4 (§4.2), 06.3.2 (§4.2), 10.1.4 (§4.3) `◐`→`✅`. **Saf denetim görevi: kod DEĞİŞMEDİ** (satırlar yalnız kanıt koşusuyla çevrildi; KK açığı bulunsaydı satır ◐ kalır + ayrı görev açılırdı). **Kanıt (odaklı süit fiilen koşuldu, exit 0):** (1) **06.2.4** — KK _"drag reorder (+ klavye alternatifi); zorunlu parametre (transfer hedefi) boşsa hata"_ → `SkillEditor.tsx` (draggable liste + ↑↓ butonları, ikisi de tek `reorder`→`moveStep` yolundan + `aria-live` duyuru) + saf `step-reorder.ts` (`moveStep`/`describeMove`/`stepIssues`; `stepIssues` boş transfer hedefini yakalar → `canSave=false` + `role="alert"`); web unit `step-reorder.test.ts` **10** (klavye reorder sıra değiştirir + NEGATİF: boş transfer hedefi → issue) + `SkillEditor.test.tsx` **5**; tm 33.2. (2) **06.3.2** — KK _"Geçersiz URL/tür reddi; crawl/parse; RAG indeksleme; bulk/CSV import"_ → `routes/playbook.ts` `POST /knowledge-sources` (`type` enum website/file/article/faq; website → `assertPublicHttpUrl` SSRF-guard → `crawl` → `knowledge.index` **aynı tx**) + `services/ai/web-crawler.ts` + `lib/ssrf.ts`; api unit `ssrf.test.ts` **15** (169.254.169.254/localhost/127.0.0.1/private/`file://` reddi + DNS-rebinding guard) + `web-crawler.test.ts` **6**; **integration** `knowledge-crawl.test.ts` **11** (SSRF negatifleri → 400 & `sourceCount=0` · public crawl → `status:ready`+chunks>0 & indeksli · URL'siz website → 400 · cross-tenant izole). **bulk/CSV** 06.3.2-a kırılımında bilinçli kapsam dışıydı → §5.1 tablosuna `06.3.2-bulk` (Should, v2) eklendi (KK payı gizlenmez); tm 33.4. (3) **10.1.4** — KK _"Sayaç N/limit (% used); aşım paketi; %80 proaktif uyarı"_ → `BillingPage.tsx` (`/billing/usage` = fatura ADR-09; `ai-counter`/`quota-percent`/`quota-warning`/`overage-package`/`overage-charge`); web unit `BillingPage.test.tsx` **12** (`12/200 (6% used)` · %80'de proaktif uyarı [aşımdan önce] · pack $0.50/$25.00 önden · 105% aşım $5.00); tm 54. **Senkron:** §4.4 girişindeki bayat "Eksik (2026-07-25)" bloğu 2026-07-31 durumuyla yeniden yazıldı (o kalemler artık teslim+testli); §2 matrisi **sayılarak** güncellendi — MOD-05 (05.1–05.5 hepsi ✅, §4.1) ve MOD-06 (06.1–06.5 hepsi ✅, §4.2) v1 payı tam → `◐`→`✅`. **Panel deseni kapandı:** üç bayat satırın hiçbiri yeniden-yapım değildi (kod zaten vardı); denetim = "verify+close, don't rebuild" [[nexa-early-delivered-slices-audit]]. Kod yok → DoD kod kapısı yapısal olarak uygulanmaz; commit `docs(plan)`. Kapsam: yalnız tm 85 + üç satır + senkron blokları.

**Doküman düzeltmeleri (kaynakta sayı hatası):**

- v2-03 §8.5 başlığı "~63 scope" diyor, tablosu **58** sayıyor. Tablo esas alındı.
- v2-03 §1.8 tablosu **24** hata tipi listeliyor (master prompt 23 diyor). Tablo esas alındı.
- **Faz-0 özet satırı (satır 20) bayatlamıştı** (denetim 2026-07-26): "Genel durum" sütunu `51 ✅ · 3 ◐` gösteriyordu; §3.0–§3.10 gereksinim tabloları elle sayıldığında `54 ✅ · 0 ◐` çıkıyor. Sebep: üç `◐` kalemi (01.3, 02.4, 13.8) D23/D24/D26 çelişki denetimlerinde koda karşı doğrulanıp sırasıyla `◐`→`✅` çevrildi (satır işaretleri güncel), ancak özet satırı güncellenmedi — satır eklenmedi/silinmedi, `✅`+`◐` toplamı 54 sabit kaldı, yalnız 3 satır `◐`'den `✅`'e geçti. Özet gerçek sayıma göre düzeltildi (yalnız "Genel durum" sütunu; gereksinim işaretlerine dokunulmadı).

---

## E. Bitti Tanımı Takibi — Faz-0 kritik yol kesiti

- [x] Tüm testler yeşil — **595** (219 unit + 353 integration + 23 E2E)
      · @nexa/types 26 · ai-mock 42 · rtm 23+42 · widget 24 · web 33 · api 71+311
- [x] typecheck + lint + format temiz · migration drift yok
- [x] `make dev` tek komutla her şeyi ayağa kaldırıyor
- [x] README.md kurulum + mimariyi anlatıyor
- [x] Demo akışı doğrulandı: widget mesaj → routing (URL kuralıyla Sales'e) →
      agent inbox'ta **canlı** (13 ms) → yanıt → internal note (müşteri görmüyor) →
      etiket → arşiv → reports + billing
- [x] Her dilim commit + push edilmiş
- [x] HANDOFF.md yazılmış
- [x] Playwright E2E paketi — 23 test, ana demo akışı tarayıcıda kanıtlandı (bkz. F3)

> ⚠️ Bu liste **§1'deki 10 dilimin** bitti tanımıdır, **PRD Faz-0'ın değil**.
> Faz-0 kapanış kapısı §3.11'in sonundadır; kapanış turu §F'dedir.

---

## F. FİNAL — Orkestratör Kapanış Turu (zorunlu)

> **Tetikleyici:** §3–§6'daki **tüm fazlar** (Faz 0 → Faz 3) kapandığında ve başka planlı
> iş kalmadığında. Bu tur atlanamaz; "her şey bitti" raporu ancak bu turdan sonra verilir.

**Neden var.** Bu projede tam olarak şu oldu: her dilim ✅ göründü, testler yeşildi, yine de
PRD'nin MVP'sinin %30'u yazılmamıştı ve bir v1 özelliği MVP'nin önüne geçmişti (§1.3).
Yeşil test, kapsamın tam olduğunu göstermez — yalnız **yazılan** kodun çalıştığını gösterir.
Kapanış turu, kapsamı kodun kendisine sordurur.

### F.00 — Faz Kapanış Kapısı (sayaca bağlı) — GENEL KURAL

Faz kapanışı düzyazı bir karar değildir; **sayaca** bağlıdır. §3.11'in Faz-0'a özel kapısı
buraya genelleştirildi ve **her fazın** tablosunun sonuna kendi kapısı eklenir.

> **Bir faz ancak o fazın `Must` kapsamında `0 ◐` ve `0 ⬜` kaldığında kapanır.**

Uygulama detayları (yoruma bırakılmaz):

- **Sayım kaynağı:** o fazın §3/§4/§5/§6 tablolarındaki işaretler; sayaç **sayılarak** üretilir
  (§1.2). Baştaki özet tablosuna her faz için `Must` sütunu eklendi — kapı o sütundan okunur.
- **`Should` kalemleri** kapanışı **bloklamaz** ama kapanış raporunda **ismen** listelenir ve ya
  sonraki faza taşınır ya §D'ye "kabul edilen borç" yazılır. Sessizce düşemez.
- **`🔒` ve `⛔`** sayaca girmez ama her birinin gerekçesi satırında yazılı olmalı; gerekçesiz
  `🔒` bir kapanış engelidir (gizlenmiş `⬜` olabilir).
- **`◐` kaldıramaz:** "çekirdek var, KK eksik" tam olarak yarım kalmış işin kendisidir (§F.1/1).
  Kapatmanın iki yolu: tamamla, ya da kapsamı daralt + kalanı gerekçeli yeni kaleme ayır (§D sapma).
- **Kapanış anında** §F.1'in **10 maddesinin tamamı** çalışır (mini sürüm yetmez). Rapor
  `HANDOFF.md`'ye: sayaç (✅/◐/⬜/🔒/⛔), taşınan `Should` kalemleri, yeni sapmalar.

**Faz-0 kapısı (bugün):** **45 ✅ · 6 ◐ · 0 ⬜** (Must) → **AÇIK**. Bloklayan 6 ◐: 01.3, 02.4,
13.8(e-posta), EK-A.1, EK-A.2, EK-B.1. Kırılım §3.13. Faz-0 ancak bu 6'sı ✅ olunca kapanır.

### F.0 — Periyodik Denetim (mini kapanış turu)

§F yalnız **en sonda** çalışan bir protokoldü; §1.3'teki 18 eksik gereksinim denetim sona
bırakıldığı için **aylarca** görünmedi. Bu yüzden §F.1'in çekirdeği **periyodik** hâle getirilir.

**Tetikleyiciler (üçünden herhangi biri):**

- Her **dilim sınırı** (bir dilim kapanırken — zorunlu).
- Her **5 task'ta bir** (dilim uzunsa ortada bir kez daha).
- Bir task **blocked** kapandığında (bloke, çoğu zaman plan hatasının ilk belirtisidir).

**Her tetiklemede çalışacak çekirdek (§F.1'in hafif sürümü):**

| # | §F.1 maddesi     | Mini sürümde ne yapılır                                   | Kanıt                 |
| - | ---------------- | -------------------------------------------------------- | --------------------- |
| 1 | Kapsam süpürmesi | Yalnız **o dilimin** `FR-MOD` satırları koda karşı denetlenir | Route/dosya listesi |
| 2 | Faz sızıntısı    | Dilimde başka fazdan iş var mı                           | Evet/Hayır + §D kaydı |
| 3 | NFR kapıları     | Dilimin dokunduğu NFR'ler **ölçülür** (tahmin değil)     | Ölçüm çıktısı         |
| 5 | Kontrat bütünlüğü| `contract-parity` testi çalıştırılır                     | exit code             |
| 6 | Sessiz borç      | Dilimde eklenen `TODO`/`skip`/`@ts-expect-error` taranır | grep çıktısı          |
| 8 | Doküman tazeliği | Test sayısı + sayaç + "sıradaki adım" gerçekle uyuşuyor mu | Güncellenmiş satırlar |

**Tam sürüm (10 maddenin hepsi)** yalnız **faz kapanışında** ve projenin en sonunda çalışır.

**Kural:** Mini denetim kırmızıysa dilim kapanmaz. Bulgular ya düzeltilir ya yeni alt-görev olarak
plana girer ya gerekçesiyle §D'ye yazılır — dördüncü seçenek yoktur.

### F.1 Orkestratörün yapacağı denetim

Sırayla, her biri **koda karşı** (bu dosyanın iddiasına karşı değil):

1. **Kapsam süpürmesi.** PRD §6'daki 138 `FR-MOD` satırının tamamı yeniden çıkarılır ve
   her biri kodda aranır. Beklenen sonuç: her satır ✅ veya gerekçeli ⛔/🔒.
   ◐ kalan hiçbir satır olmamalı — ◐ "yarım kalmış iş"in ta kendisidir.
2. **Faz sızıntısı.** Bir sonraki fazdan öne çekilmiş iş var mı? (§1.3'teki hatanın tekrarı.)
3. **NFR kapıları.** §7.2'deki 58 NFR'den Faz-0/v1 kapsamına girenler ölçülür, tahmin edilmez
   (gecikme, bundle boyutu, a11y taraması, cross-tenant negatif testler).
4. **Şema artıkları.** §8'deki tabloların hepsinin bir tüketicisi var mı? Kullanılmayan tablo
   ya bir eksik özelliktir ya da silinmelidir — sessizce durması üçüncü seçenek değildir.
5. **Kontrat bütünlüğü.** `contract-parity` testi çalıştırılır: sunulan her route belgelenmiş,
   belgelenen her route sunuluyor olmalı (F1'de bulunan kayma tipinin nöbetçisi).
6. **Sessiz borç taraması.** Kod tabanında `TODO` / `FIXME` / `XXX` / `@ts-expect-error` /
   `skip(` / `only(` / atlanan test / kapatılmış lint kuralı aranır ve listelenir.
7. **Ölü kod & erişilemez ekran.** Route'u olmayan bileşen, çağrılmayan servis,
   UI'ı olmayan endpoint.
8. **Doküman tazeliği.** PLAN.md · HANDOFF.md · README.md gerçekle uyuşuyor mu?
   (Test sayısı, endpoint sayısı, "sıradaki adım" bölümleri bayatlamaya en yatkın yerler.)
9. **Temiz kurulum provası.** Sıfırdan `make dev` → migrate → seed → demo akışı.
   Yalnızca geliştirme makinesinde çalışan bir sistem çalışmıyor sayılır.
10. **Kapsam dışı doğrulaması.** §9'daki 10 maddeden hiçbiri yanlışlıkla yapılmış olmamalı
    (özellikle: gerçek ödeme entegrasyonu, kaynak markanın telif içeriği).

### F.2 Kullanıcıya sunulacak rapor

Tur bitince **tek bir Türkçe rapor** verilir ve şunları ayrı ayrı içerir:

- **Tamamlanan kapsam** — PRD kimlikleriyle, faz faz.
- **Yarım kalan işler** — her biri PRD kimliği + neden yarım kaldığı + kalan iş tahmini.
- **Bilinçli olarak yapılmayanlar** — ⛔/🔒, gerekçesiyle.
- **Sessiz borç** — F.1/6'da bulunanlar.
- **Sapmalar** — §D'ye eklenmiş her yeni sapma.
- **Karar bekleyen açık sorular** — PRD §11.2 ile karşılaştırmalı.

> ⚠️ **Rapor "tamamlandı" diyorsa, F.1'in 10 maddesinin her biri fiilen çalıştırılmış olmalıdır.**
> Denetim yapılmadan verilen "bitti" raporu, bu projede bir kez zaten yanlış çıktı (§1.3).

### F.3 Kapanıştan sonra

Kullanıcı yarım kalan işlerden hangilerinin yapılacağını seçer. Seçilenler yeni bir faz
olarak §6'nın altına eklenir ve aynı döngü işler: PRD kimliği → dilim → test → kapanış turu.
