# PLAN.md — Nexa Geliştirme Planı

> **Bu plan `urun-gereksinim-dokumani-PRD.md`'nin izdüşümüdür.**
> İş kırılımı PRD'nin kendi başlıklarını (§5 fazlar → §6 `FR-MOD` modülleri → §7 NFR → §8 veri)
> birebir takip eder. Her iş kaleminin bir PRD kimliği vardır; kimliksiz iş yapılmaz.
>
> Şema doğruluk kaynağı: PRD §8.4 + `rapor-2-teknik-mimari.md` §5.3.
> `LiveChat_ER_Diyagram.mermaid` KULLANILMAZ (çelişkili — bkz. yeterlilik değerlendirmesi G8).

**Başlangıç:** 2026-07-22 · **Son denetim:** 2026-07-23

| Faz                | PRD  | Durum                                                    |
| ------------------ | ---- | -------------------------------------------------------- |
| **Faz 0 — MVP**    | §5.1 | ⏳ **36 tam · 4 kısmi · 12 açık** (52 gereksinim)        |
| Faz 1 — v1         | §5.2 | ⏳ kısmen başlandı (Playbook/AI öne çekildi — bkz. §1.3) |
| Faz 2 — v2         | §5.3 | ⬜ başlanmadı                                            |
| Faz 3 — Enterprise | §5.4 | ⬜ başlanmadı                                            |

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

| Modül                         | MVP | v1  | v2  | Ent. |               **Durum**                |
| ----------------------------- | :-: | :-: | :-: | :--: | :------------------------------------: |
| MOD-00 Auth + trial           |  ●  |     |     |      |     ◐ login var, signup/forgot yok     |
| MOD-01 Global shell + ⌘K      |  ●  |  ○  |  ○  |      |        ◐ ray+panel var, ⌘K yok         |
| MOD-02 Inbox 3-pane + Archive |  ●  |  ○  |     |      |  ◐ chat tarafı ✅, ticket tarafı yok   |
| MOD-03.1 Real-time traffic    |  ○  |  ○  |  ○  |      |                   ◐                    |
| MOD-03.2 Contacts CRM         |  ●  |  ○  |     |      |                   ✅                   |
| MOD-03.3 Campaigns            |     |  ●  |  ○  |      |                   ⬜                   |
| Engage/Goals + Sales tracker  |     |     |  ●  |      |                   ⬜                   |
| MOD-04 Team/roller/teams      |  ●  |  ○  |  ○  |  ○   |      ◐ tablo+teams ✅, invite yok      |
| MOD-05 Playbook               |     |  ●  |  ○  |      |        ◐ **(v1 — öne çekildi)**        |
| MOD-06 AI Agent + RAG         |     |  ●  |  ○  |  ○   |        ◐ **(v1 — öne çekildi)**        |
| Görsel Workflow builder       |     |     |  ●  |      |           ⛔ ADR-14 (UI yok)           |
| MOD-07 Reports                |  ○  |  ○  |  ●  |  ○   |             ◐ Overview ✅              |
| MOD-08.5 Channels             |  ○  |  ●  |     |  ○   |    ⬜ web widget kurulum yüzeyi yok    |
| MOD-08.6 Routing              |  ○  |  ○  |  ●  |  ○   |            ✅ (MVP kapsamı)            |
| MOD-08.7 Inbox araçları       |  ○  |  ●  |     |      |    ◐ canned ✅, tag kütüphanesi yok    |
| MOD-08.8 API access / MCP     |  ○  |  ○  |  ●  |      |      ✅ (PAT/API), webhook v1'de       |
| MOD-08.9 Security             |  ○  |  ○  |  ●  |  ●   | ◐ trusted domains ✅, file sharing yok |
| MOD-09 Apps marketplace       |     |  ○  |  ○  |  ○   |                   ⬜                   |
| MOD-10 Billing                |  ●  |  ○  |     |  ○   |     ◐ okuma+trial ✅, checkout yok     |
| MOD-11 Customer widget        |  ●  |  ○  |     |  ○   |  ◐ launcher/composer ✅, greeting yok  |
| MOD-12 Copilot                |  ○  |  ●  |  ○  |      |                   ⬜                   |
| Mobil app                     |     |  ●  |  ○  |      |                   ⬜                   |

---

## 3. FAZ 0 — MVP (PRD §5.1)

**PRD amacı:** _"Güvenli, gerçek zamanlı, faturalanabilir bir canlı sohbet + temel ticketing çekirdeği."_
**PRD çıkış kriteri:** trial→ücretli ≥%8 · kurulum <10 dk · ilk hafta ≥1 sohbet/gün.

> Faz-0 kapanmadan v1 işine geçilmez (§1.3).

### 3.0 FR-MOD-00 — Ön-Uygulama / Kimlik Doğrulama

| PRD  | Gereksinim                                     | Öncelik      | Durum | Nerede                  |
| ---- | ---------------------------------------------- | ------------ | :---: | ----------------------- |
| 00.1 | Login (email+parola; SSO/2FA opsiyonel)        | Must (MVP)   |  ✅   | Dilim 2 · `/auth/login` |
| 00.2 | **Signup + 14 gün kartsız trial başlatma**     | Must (MVP)   |  ✅   | Dilim 12                |
| 00.3 | **Forgot password** (süreli token, nötr mesaj) | Must (MVP)   |  ✅   | Dilim 12                |
| 00.4 | **Onboarding sihirbazı** + tohum veri          | Should (MVP) |  ⬜   | **Dilim 14'e taşındı**  |

### 3.1 FR-MOD-01 — Global Shell / Navigation

| PRD                      | Gereksinim                                               | Öncelik          | Durum | Nerede                                      |
| ------------------------ | -------------------------------------------------------- | ---------------- | :---: | ------------------------------------------- |
| 01.1.3                   | **Command Palette (⌘K)** — içerik arama + rota atlama    | Must (MVP temel) |  ⬜   | **Dilim 14**                                |
| 01.1.6                   | Trial rozeti "N days" + Subscribe CTA                    | Must (MVP)       |   ◐   | Dilim 9 (gate var, rozet ⬜) → **Dilim 14** |
| 01.2                     | Sol ikon rayı                                            | Must (MVP)       |  ✅   | F2 · `AppShell.tsx`                         |
| 01.3                     | Sağ panel anahtarı (Details ↔ Copilot ↔ Expand)          | Must (MVP)       |   ◐   | Dilim 7 (Details ✅, Copilot v1)            |
| 01.1.1/.4/.5, 01.4, 01.5 | Hamburger, presence avatarları, Invite +N, banner, unpin | Should/Could     |  🔒   | v1+                                         |

### 3.2 FR-MOD-02 — Inbox / Chats

| PRD                                              | Gereksinim                                                                                                   | Öncelik          | Durum | Nerede                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ---------------- | :---: | ------------------------------------------------------------- |
| 02.1.1                                           | Chats grubu (All/My/Queued/Unassigned/Supervised/Archived)                                                   | Must (MVP)       |  ✅   | Dilim 7                                                       |
| 02.1.3                                           | **Tickets grubu** (All/Unassigned/My open)                                                                   | Must (MVP temel) |  ⬜   | **Dilim 11**                                                  |
| 02.2.2                                           | Sohbet liste öğesi (unread, typing)                                                                          | Must (MVP)       |  ✅   | Dilim 7                                                       |
| 02.3.1                                           | Transcript — canlı akış                                                                                      | Must (MVP)       |  ✅   | Dilim 4+5+7                                                   |
| 02.3.3                                           | Composer (Enter/Shift+Enter)                                                                                 | Must (MVP)       |  ✅   | Dilim 7                                                       |
| 02.3.4                                           | Message type (Reply / Internal note)                                                                         | Must (MVP)       |  ✅   | Dilim 7                                                       |
| 02.3.5                                           | Composer araçları (canned `#`, tag, emoji, **attach**)                                                       | Must (MVP)       |   ◐   | F5 (`#` ✅) · attach → **Dilim 13**                           |
| 02.3.6                                           | Send (optimistic, disabled/loading/error)                                                                    | Must (MVP)       |  ✅   | Dilim 7                                                       |
| 02.4.1–.6                                        | Details paneli (info/tags/visited pages/visit info)                                                          | Must (MVP)       |  ✅   | Dilim 7                                                       |
| 02.6                                             | **Create ticket** / Copy chat link / Reopen                                                                  | Must (MVP)       |   ◐   | Reopen ✅ (`/chats/{id}/resume`) · ticket+link → **Dilim 11** |
| 02.8                                             | Archive (salt-okuma transcript)                                                                              | Must (MVP)       |  ✅   | Dilim 7                                                       |
| 02.1.2, 02.1.4, 02.2.1, 02.3.2, 02.5, 02.7, 02.9 | AI Agents grubu, kanal görünümleri, sıralama, Reply Suggestions, Copilot özeti, Tickets grid, typing preview | v1               |  🔒   | v1                                                            |
| 02.2.3                                           | "Take tour" banner                                                                                           | Could            |  🔒   | —                                                             |

### 3.3 FR-MOD-03 — Customers (CRM)

| PRD                            | Gereksinim                                                    | Öncelik            | Durum | Nerede                                                       |
| ------------------------------ | ------------------------------------------------------------- | ------------------ | :---: | ------------------------------------------------------------ |
| 03.1.1                         | Real-time sekmeleri (All/Chatting/Queued/Waiting)             | Should (MVP temel) |   ◐   | F4 (liste ✅, sekmeler ⬜) → **Dilim 14**                    |
| 03.2.1                         | Contacts header + arama + filter                              | Must (MVP)         |  ✅   | F4                                                           |
| 03.2.3                         | Contacts tablosu (Name/Email/Phone/Country/Chats/**Tickets**) | Must (MVP)         |   ◐   | F4 — `tickets_count` **yapısal olarak hep 0** → **Dilim 11** |
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

| PRD  | Gereksinim                             | Öncelik            | Durum | Nerede            |
| ---- | -------------------------------------- | ------------------ | :---: | ----------------- |
| 06.6 | Chatbot (kural-tabanlı, deterministik) | Should (MVP temel) |  ✅   | F6 · skill motoru |

### 3.6 FR-MOD-07 — Reports (yalnız MVP payı)

| PRD    | Gereksinim                                                             | Öncelik            | Durum | Nerede                                                                   |
| ------ | ---------------------------------------------------------------------- | ------------------ | :---: | ------------------------------------------------------------------------ |
| 07.1   | Reports kenar çubuğu (Overview/AI Agent/Breakdown)                     | Should (MVP temel) |   ◐   | Dilim 9 (Overview ✅)                                                    |
| 07.3.1 | Overview header — range tabs (7/30/90/365 + custom) + vs. önceki dönem | Should             |   ◐   | Dilim 9 (aralık ✅, karşılaştırma ⬜)                                    |
| 07.3.2 | KPI kartları — Manual/Assisted/**Automated** + Total cases             | Must (MVP temel)   |   ◐   | Dilim 9 · ADR-09 ✅ · "Total cases = Chats + **Tickets**" → **Dilim 11** |
| 07.3.3 | Chats bölümü kartları (automated chats/hour, durations, response)      | Should             |   ◐   | Dilim 9                                                                  |
| 07.2   | Onboarding survey popover                                              | Could              |  🔒   | —                                                                        |

### 3.7 FR-MOD-08 — Settings (yalnız MVP payı)

| PRD    | Gereksinim                                         | Öncelik    | Durum | Nerede                                           |
| ------ | -------------------------------------------------- | ---------- | :---: | ------------------------------------------------ |
| 08.5.1 | **All channels kart gridi**                        | Must (MVP) |  ⬜   | **Dilim 13**                                     |
| 08.5.2 | **Website widgets** (+Add website / Install code)  | Must (MVP) |  ⬜   | **Dilim 13** — `Website` modeli var              |
| 08.5.3 | **Email (forwarding → ticket)**                    | Must (MVP) |  ⬜   | **Dilim 11**                                     |
| 08.5.9 | **Chat page** (hosted link)                        | Must (MVP) |  ⬜   | **Dilim 13**                                     |
| 08.6.1 | Chat routing kural motoru + fallback               | Must (MVP) |  ✅   | Dilim 8 · ADR-08                                 |
| 08.7.1 | **Tags kütüphanesi CRUD** (grup kapsamı)           | Must (MVP) |   ◐   | Chat başına etiket ✅ · kütüphane → **Dilim 14** |
| 08.7.2 | Canned responses (`#` shortcut, grup kapsamı)      | Must (MVP) |  ✅   | F5                                               |
| 08.8.2 | API access — APIs & SDKs + PAT                     | Must (MVP) |  ✅   | Dilim 2 · F5                                     |
| 08.9.1 | Trusted domains (widget allowlist)                 | Must (MVP) |  ✅   | Dilim 2 · F5                                     |
| 08.9.4 | **File sharing** (izinli tür/boyut + virüs tarama) | Must (MVP) |  ⬜   | **Dilim 13** — NFR-S10                           |

### 3.8 FR-MOD-10 — Billing / Trial

| PRD    | Gereksinim                                       | Öncelik    | Durum | Nerede                                                                              |
| ------ | ------------------------------------------------ | ---------- | :---: | ----------------------------------------------------------------------------------- |
| 10.1.1 | **Plan + Change plan**                           | Must (MVP) |  ⬜   | **Dilim 14**                                                                        |
| 10.1.2 | **Billing cycle** (Monthly/Annual + indirim)     | Must (MVP) |  ⬜   | **Dilim 14**                                                                        |
| 10.1.3 | **Users stepper** ($/user/mo × qty)              | Must (MVP) |  ⬜   | **Dilim 14**                                                                        |
| 10.1.6 | **Subscription summary + Enter payment details** | Must (MVP) |  ⬜   | **Dilim 14** — ⚠️ PRD §11.1/1: gerçek kart girişi kapsam DIŞI; Stripe MOCK (ADR-13) |
| 10.2   | 14 günlük trial mantığı (rozet + kısıtlama)      | Must (MVP) |  ✅   | Dilim 9 · ADR-10                                                                    |

### 3.9 FR-MOD-11 — Customer Widget

| PRD  | Gereksinim                                   | Öncelik    | Durum | Nerede                                              |
| ---- | -------------------------------------------- | ---------- | :---: | --------------------------------------------------- |
| 11.1 | Launcher bubble + unread rozeti              | Must (MVP) |  ✅   | Dilim 6                                             |
| 11.2 | **Greeting card + quick replies**            | Must (MVP) |  ⬜   | **Dilim 13**                                        |
| 11.3 | Agent identity (AI persona / insan adı)      | Must (MVP) |   ◐   | Dilim 6 (bot kimliği ✅, persona ⬜) → **Dilim 13** |
| 11.4 | Composer (mesaj + **attach** + emoji + send) | Must (MVP) |   ◐   | attach → **Dilim 13**                               |
| 11.6 | Embed snippet (async JS + `window.__lc`)     | Must (MVP) |  ✅   | Dilim 6                                             |

### 3.10 FR-MOD-13 — (yalnız MVP payı)

| PRD  | Gereksinim                                        | Öncelik    | Durum | Nerede       |
| ---- | ------------------------------------------------- | ---------- | :---: | ------------ |
| 13.8 | **Notifications** (ses/masaüstü/tarayıcı/e-posta) | Must (MVP) |  ⬜   | **Dilim 14** |

### 3.11 Faz-0 dilim planı

| #      | Dilim                                  | PRD kapsamı                                                            | Neden bu sıra                                                                                                                                                                                                                        |
| ------ | -------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **11** | **Ticketing çekirdeği**                | 02.1.3 · 02.6 · 08.5.3 · (03.2.3, 07.3.2 düzeltmesi)                   | PRD §5.1 MVP'yi _"canlı sohbet **+ temel ticketing** çekirdeği"_ diye tanımlıyor — en büyük tek delik. Ayrıca bugün **görünür kusur**: `customers.tickets_count` ve Reports "Total cases" ticket sayıyor, sayı yapısal olarak hep 0. |
| ~~12~~ | **Hesap yaşam döngüsü** ✅             | 00.2 ✅ · 00.3 ✅ · 04.3.1 ✅ · 04.4 ✅                                | Teslim edildi. Onboarding sihirbazı (00.4, Should) Dilim 14'e taşındı — Must'lar önce. Tarayıcıda bulunan iki hata için bkz. §D13/D14.                                                                                               |
| **13** | **Kanallar + dosya + greeting**        | 08.5.1 · 08.5.2 · 08.5.9 · 08.9.4 · 11.2 · 11.3 · (02.3.5/11.4 attach) | Widget'ın kurulum yüzeyi ve müşteriye ilk dokunuş. 08.9.4 güvenlik şekli taşıyor (NFR-S10: tür/boyut/tarama).                                                                                                                        |
| **14** | **Checkout + bildirim + shell kalanı** | 10.1.1–.3 · 10.1.6 · 13.8 · 01.1.3 · 01.1.6 · 08.7.1 · 03.1.1          | PRD çıkış kriteri "trial→ücretli ≥%8" bu yol olmadan ölçülemez.                                                                                                                                                                      |

**Faz-0 kapanış kapısı:** 52 gereksinimin tamamı ✅ veya gerekçeli ⛔ · §7 NFR kapısı geçildi ·
`make dev` temiz kurulumdan demo akışını çalıştırıyor.

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

## 4. FAZ 1 — v1 (PRD §5.2)

**PRD amacı:** _"AI Agent + omnichannel + mobil."_ Faz-0 kapanmadan başlanmaz (§1.3).
**Çıkış kriteri (PRD):** AI resolution rate ≥%40 · omnichannel hesap oranı ≥%30.

> Durumlar **geçici** — bu faz başlarken koda karşı denetlenecek (§1.2).

### 4.1 FR-MOD-05 — Playbook _(öne çekildi)_

| PRD  | Gereksinim                                        | Öncelik     |              Durum              |
| ---- | ------------------------------------------------- | ----------- | :-----------------------------: |
| 05.1 | Header — Browse templates + Create skill ▾        | Must (v1)   | ◐ create ✅, şablon galerisi ⬜ |
| 05.2 | Recommended skills (şablon kartları)              | Should (v1) |               ⬜                |
| 05.3 | Skill listesi sekmeleri (All/AI/Workspace/Drafts) | Must (v1)   |     ◐ liste ✅, sekmeler ⬜     |
| 05.4 | Liste kontrolleri (Search/Sort/Filter)            | Should      |               ⬜                |
| 05.5 | Skill satırı ("N runs" + sahip + toggle)          | Must (v1)   |               ✅                |

### 4.2 FR-MOD-06 — AI Agent + Knowledge/RAG _(öne çekildi)_

| PRD    | Gereksinim                                                | Öncelik     |             Durum              |
| ------ | --------------------------------------------------------- | ----------- | :----------------------------: |
| 06.1   | AI Agent sekmeleri (Performance/Profile/Skills/Knowledge) | Must (v1)   |               ◐                |
| 06.2.1 | Skill editör üst barı (Run log + active toggle)           | Must (v1)   |               ✅               |
| 06.2.2 | Skill name                                                | Must (v1)   |               ✅               |
| 06.2.3 | Doğal dil talimat textarea (~10.000 karakter)             | Must (v1)   |               ✅               |
| 06.2.4 | Ordered steps (6 adım tipi; reorder + klavye alternatifi) | Must (v1)   | ◐ adımlar ✅, drag-reorder ⬜  |
| 06.2.5 | Preview (canlı simülasyon)                                | Must (v1)   |               ✅               |
| 06.3.1 | Knowledge alt sekmeler (All/Websites/Files/Articles/FAQ)  | Must (v1)   |               ◐                |
| 06.3.2 | + New source (chunk+embedding)                            | Must (v1)   | ◐ article ✅, website crawl ⬜ |
| 06.3.3 | Kaynak tablosu (düzenle/sil/yeniden indeksle)             | Must (v1)   |               ✅               |
| 06.4   | Profile (persona: Tone/Language/Answer length)            | Must (v1)   |       ◐ `tone` alanı var       |
| 06.5   | Performance (resolution rate, CSAT, transfer)             | Should (v1) |               ⬜               |

### 4.3 Diğer v1 modülleri

| PRD        | Gereksinim                                                                                             | Öncelik        |                         Durum                         |
| ---------- | ------------------------------------------------------------------------------------------------------ | -------------- | :---------------------------------------------------: |
| **08.8.4** | **Webhooks** (register/list/unregister) — HMAC-SHA256 + timestamp/nonce + retry 3× + **SSRF koruması** | Must (v1)      | ⬜ `Webhook` modeli var · NFR-S7 · risk R2 · v2-04 §6 |
| 02.1.2     | AI Agents grubu (AI agent / Solved)                                                                    | Must (v1)      |                          ⬜                           |
| 02.1.4     | Views grubu (WhatsApp/Messenger/Twilio görünümleri)                                                    | Should (v1)    |                          ⬜                           |
| 02.3.2     | Reply Suggestions çipleri                                                                              | Should (v1)    |                          ⬜                           |
| 02.5       | Copilot özeti → internal note                                                                          | Should (v1)    |                          ⬜                           |
| 02.7       | Tickets grid (sıralanabilir, deep-link)                                                                | Should (v1)    |                          ⬜                           |
| 02.9       | Live typing preview                                                                                    | Should (v1)    |                          ⬜                           |
| 03.1.3     | Ziyaretçi tablosu + satır aksiyonları                                                                  | Should (v1)    |                          ⬜                           |
| 03.3.1–.3  | Campaigns (alt sekmeler, builder, kart)                                                                | Should (v1)    |               ⬜ `Campaign` modeli var                |
| 04.2       | AI Agents (team tarafı) — performance                                                                  | Must (v1)      |                          ⬜                           |
| 04.6       | Chatbots / Suspended agents sekmeleri                                                                  | Should (v1)    |                          ⬜                           |
| 07.4       | AI Agent raporu (resolution/deflection)                                                                | Should (v1)    |                          ⬜                           |
| 07.7       | Rapor grupları + Export (CSV)                                                                          | Should (v1–v2) |                          ⬜                           |
| 07.8       | Reviews / Ratings                                                                                      | Should (v1)    |                ⬜ `Rating` modeli var                 |
| 08.5.4     | Messenger (Facebook OAuth)                                                                             | Must (v1)      |                  ⬜ **MOCK adaptör**                  |
| 08.5.5     | Twilio SMS                                                                                             | Must (v1)      |                  ⬜ **MOCK adaptör**                  |
| 08.5.6     | WhatsApp (Business)                                                                                    | Must (v1)      |                  ⬜ **MOCK adaptör**                  |
| 08.6.2     | Ticket rules (atama/etiket/öncelik)                                                                    | Should (v1)    |                          ⬜                           |
| 08.7.3     | Chat timeout                                                                                           | Should (v1)    |                          ⬜                           |
| 08.7.4     | Chat transcripts (e-posta)                                                                             | Should (v1)    |                          ⬜                           |
| 08.7.5     | Ticket email templates                                                                                 | Should (v1)    |                          ⬜                           |
| 08.7.6     | Custom fields                                                                                          | Should (v1)    |                          ⬜                           |
| 08.7.7     | Forms builder (pre/post-chat)                                                                          | Should (v1)    |                          ⬜                           |
| 08.8.1     | Apps (marketplace) girişi                                                                              | Should (v1)    |                          ⬜                           |
| 09.1       | Entegrasyon kartları gridi                                                                             | Should (v1)    |                          ⬜                           |
| 09.2       | Entegrasyon listesi (15–20)                                                                            | Should (v1)    |                          ⬜                           |
| 10.1.4     | AI resolutions meter + stepper                                                                         | Must (v1)      |             ◐ metering ✅ (ADR-13), UI ⬜             |
| 10.1.5     | API calls (aşım paketi)                                                                                | Should (v1)    |                          ⬜                           |
| 10.3       | Invoices + payment details yönetimi                                                                    | Should (v1)    |                          ⬜                           |
| 11.7       | Widget customization (Appearance/Position/Mobile)                                                      | Should (v1)    |                          ⬜                           |
| 11.8       | Typing indicator (sneak-peek)                                                                          | Could (v1)     |                          ⬜                           |
| 12.1–12.3  | **Copilot** (buton, ayrı KB, özet + yanıt yardımı)                                                     | Should (v1)    |                          ⬜                           |
| 13.1       | Home dashboard                                                                                         | Should (v1)    |                          ⬜                           |
| 13.6       | Omnichannel Ticketing / HelpDesk katmanı                                                               | Should (v1)    |                          ⬜                           |
| 13.7       | Mobil uygulamalar                                                                                      | Should (v1)    |       🔒 web-öncelikli (PRD §11.1/8 ile hizalı)       |

---

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
| 08.9.2 | Banned customers                                  | Should (v2)      | `Customer.banned` alanı var                         |
| 08.9.3 | Spam filtre                                       | Should (v2)      |                                                     |
| 08.9.5 | CC masking (Luhn, yazma anında)                   | Should (v2)      | NFR-C5                                              |
| 09.3   | API istek paketleri                               | Could (v2)       |                                                     |
| 09.4   | Zapier/Make + Build-your-app                      | Could (v2)       |                                                     |
| 13.2   | Engage / Traffic (gelişmiş filtreler)             | Should (v2)      |                                                     |
| 13.3   | **Goals** (ziyaretçi→sohbet→dönüşüm hunisi)       | Should (v2)      | `Goal` modeli var                                   |
| 13.4   | Görsel Workflow builder (nodes/edges)             | Could (v2)       | ⛔ **ADR-14: UI yapılmayacak** (tablo şemada kalır) |
| 13.5   | Sales tracker                                     | Could (v2)       |                                                     |
| —      | Public KB (SEO'lu self-servis)                    | v2 (§5.3)        |                                                     |
| —      | Work scheduler / staffing prediction              | v2 (§5.3)        |                                                     |
| —      | Multibrand                                        | v2 (§5.3)        |                                                     |

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

---

## 7. Çapraz Kesit ve NFR Kapıları (PRD §6 FR-EK + §7)

Bunlar bir dilim değil, **her dilimin kabul koşulu**. Yeni ekran/endpoint eklerken kontrol edilir.

### 7.1 FR-EK — Çapraz kesit desenler

| PRD    | Desen                                                                                                     | Öncelik      |                      Durum                       |
| ------ | --------------------------------------------------------------------------------------------------------- | ------------ | :----------------------------------------------: |
| EK-A.1 | Form & girdi mantığı — tek validasyon kütüphanesi, alan-altı hata, geçersizken submit pasif               | Must (MVP)   | ◐ Dilim 12–14'te ilk kez ciddi form yükü gelecek |
| EK-A.2 | Ortak girdi davranışları — debounce arama, dropdown, stepper, optimistic toggle, yarım-form kapatma onayı | Must (MVP)   |                        ◐                         |
| EK-B.1 | Sayfalama & yükleme — virtualized grid, infinite scroll, skeleton, **anlamlı empty state**                | Must (MVP)   |              ◐ keyset pagination ✅              |
| EK-C.1 | Realtime katman — WebSocket push (polling değil) + reconnect telafi                                       | Must (MVP)   |                    ✅ Dilim 5                    |
| EK-C.2 | Banner/dropdown/panel/modal — tek tasarım sistemi                                                         | Should (MVP) |                        ◐                         |

### 7.2 NFR kapıları (PRD §7 — 58 madde)

Faz-0 kapanışında doğrulanacak olanlar:

| NFR      | Hedef                                               |                              Durum                               |
| -------- | --------------------------------------------------- | :--------------------------------------------------------------: |
| P1       | RTM fan-out gecikmesi                               |                        ✅ ölçüldü (13 ms)                        |
| P3       | Widget bundle bütçesi                               |                   ✅ 5.3 KB gzip (bütçe 50 KB)                   |
| P4/P6    | Virtualized liste + büyük liste sorguları           |                                ◐                                 |
| S1–S5    | Auth · token · scope · **tenant izolasyonu** · IDOR |                   ✅ Dilim 2 (negatif testli)                    |
| S6       | Widget izolasyonu (`innerHTML` yasak)               |                    ✅ Dilim 6 (eslint kuralı)                    |
| **S7**   | **Webhook HMAC + SSRF**                             | ⬜ v1 (08.8.4 ile birlikte — sonradan eklemek kırıcı değişiklik) |
| S8       | Rate limiting                                       |                            ✅ ADR-07                             |
| **S10**  | **File sharing güvenliği**                          |                  ⬜ **Dilim 13** ile aynı anda                   |
| S12      | Audit log (append-only)                             |              ◐ tablo + policy ✅, olay kapsamı dar               |
| A11Y1–6  | WCAG 2.1 AA · klavye · ⌘K                           |                    ◐ 01.1.3 (⌘K) **Dilim 14**                    |
| I18N1/2  | Widget + panel i18n                                 |                                ⬜                                |
| C1/C2/C8 | GDPR · KVKK · retention                             |          ◐ silme CASCADE ✅ (Dilim 3), retention job ⬜          |
| M4       | Test piramidi (unit + integration + contract + E2E) |                           ✅ 595 test                            |
| M5       | Gözlemlenebilirlik (`request_id`, OTel, metrikler)  |                    ◐ `request_id` ✅, OTel ⬜                    |

---

## 8. Veri Modeli (PRD §8.4) — tablo durumu

39 tablo migrate edildi, tümünde RLS (Dilim 3). Şemada **var ama henüz kullanılmayan** tablolar
— her biri bir gereksinimi bekliyor:

| Tablo       | Bekleyen gereksinim | Faz                                        |
| ----------- | ------------------- | ------------------------------------------ |
| `tickets`   | 02.1.3 / 02.6       | **Faz 0 · Dilim 11**                       |
| `websites`  | 08.5.2              | **Faz 0 · Dilim 13**                       |
| `webhooks`  | 08.8.4              | v1                                         |
| `campaigns` | 03.3.x              | v1                                         |
| `channels`  | 08.5.4–.6           | v1                                         |
| `ratings`   | 07.8                | v1 (yazma yolu ✅ `/customer/chat/rating`) |
| `goals`     | 13.3                | v2                                         |
| `visits`    | 13.2 / 03.1.3       | v2                                         |
| `workflows` | 13.4                | ⛔ ADR-14 — tablo kalır, UI yapılmaz       |

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

> Bu bölümden itibaren **tarihçedir**: tamamlanmış işin kaydı ve gerekçeleri.
> İleriye dönük plan §3–§6'dadır.

## A. Tarihçe — Dilim Detayları (Dilim 1–10)

### Dilim 1 — Bootstrap [XHIGH] ✅

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

### Dilim 6 — Customer Widget [XHIGH] ✅

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

### Dilim 7 — Inbox 3-pane [XHIGH] ✅

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

### Dilim 9 — Reports + Billing [XHIGH] ✅

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

### Dilim 10 — Design System + modül ekranları [XHIGH] ✅

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

**Doküman düzeltmeleri (kaynakta sayı hatası):**

- v2-03 §8.5 başlığı "~63 scope" diyor, tablosu **58** sayıyor. Tablo esas alındı.
- v2-03 §1.8 tablosu **24** hata tipi listeliyor (master prompt 23 diyor). Tablo esas alındı.

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
