# PLAN.md — Nexa Geliştirme Planı

> **Bu plan `urun-gereksinim-dokumani-PRD.md`'nin izdüşümüdür.**
> İş kırılımı PRD'nin kendi başlıklarını (§5 fazlar → §6 `FR-MOD` modülleri → §7 NFR → §8 veri)
> birebir takip eder. Her iş kaleminin bir PRD kimliği vardır; kimliksiz iş yapılmaz.
>
> Şema doğruluk kaynağı: PRD §8.4 + `rapor-2-teknik-mimari.md` §5.3.
> `LiveChat_ER_Diyagram.mermaid` KULLANILMAZ (çelişkili — bkz. yeterlilik değerlendirmesi G8).

**Başlangıç:** 2026-07-22 · **Son denetim:** 2026-07-25 (kapsam) · **Kapsam denetimi + kırılım:** 2026-07-25 (PLAN-EXPAND) · **GO-LIVE kırılımı:** 2026-07-28 (§4.5 · §D52 · tm 85–88 + 68/69/70) · **Faz-0 kapanışı:** 2026-07-31 (GL-3 · tm 87 · §F.2 · §D55) · **v1 kapanışı:** 2026-07-31 (GL-4 · tm 88 · §F.2 · §D56)

> **Bu turda (2026-07-25) PLAN, PRD §6'nın 138 `FR-MOD` satırına ve KODA karşı yeniden
> denetlendi.** İki `✅` iddiası koda karşı **`◐`** çıktı (02.4 Details ziyaret bilgisi, 13.8
> e-posta bildirimi — bkz. §D19/§D20). Faz kapanışı artık **sayaca** bağlı (§F.00): bir faz
> ancak `Must` kapsamında `0 ◐` ve `0 ⬜` kaldığında kapanır. Kalan işin atomik kırılımı §3.13
> (Faz-0) + §4.4 (v1) + §G (düz dizin) altındadır.

| Faz                | PRD  | Genel durum                          | **Must sayacı (§F.00 kapısı)** | Kapanış |
| ------------------ | ---- | ------------------------------------ | ------------------------------ | :-----: |
| **Faz 0 — MVP**    | §5.1 | 54 ✅ · 0 ◐ (§3) · gruplu-🔒 v1'e    | **51 ✅ · 0 ◐ · 0 ⬜**          | ✅ KAPALI |
| Faz 1 — v1         | §5.2 | v1 payı teslim (Playbook+AI+omnichannel-MOCK+webhooks §1.3); Should çoğu ✅ · mobil 🔒 · 06.3.2-bulk→v2 | **20 ✅ · 0 ◐ · 0 ⬜**          | ✅ KAPALI |
| **Faz 2 — v2**     | §5.3 | **📋 PLANLANDI, kod SÜRÜYOR** (plan 2026-08-01; sayım 2026-08-10). Kapsam PRD'ye karşı süpürüldü → **30 kalem**, **sayılarak**: **3 ⬜ açık · 1 ◐ kısmi · 23 ✅ teslim · 3 ⛔ kapsam dışı** (7 faz çelişkisi PRD'den çözüldü). **PLAN'da 12 kalem eksikti** (§D62). Kalan iş **tam atomik** bölündü → §5.2 · `PLAN-V2-KIRILIM.md` · Task Master | v2 `Must` yok — PRD'de v2 kalemlerinin hepsi `Should`/`Could`. §F.00'ın **sayaç** kuralı yerine **kalem** kuralı: **23 açık kalemin hepsi ✅** | ⬜ AÇIK |
| Faz 3 — Enterprise | §5.4 | ⬜ başlanmadı · orta derinlik (§6.1). 2026-08-01'de **13.7 mobil** buraya taşındı (§D60) · **08.9.6 IP allowlist** buradan v2'ye çıktı (§D61) | —                              |    —    |

**Faz-0 kapandı (2026-07-31 · GL-3 · tm 87).** Kapanışı bloklayan 6 `Must ◐` kapatıldı: 01.3, 02.4,
13.8 (modül tablolarında D23/D24/D26'da `◐`→`✅`) + EK-A.1 / EK-A.2 / EK-B.1 (bu turda §7.1'de
`◐`→`✅`, tm 29/30 teslimine karşı kanıtla). `Must` sayacı **sayılarak** `51 ✅ · 0 ◐ · 0 ⬜`
(§3.0–§3.10'da 48 modül Must + 3 EK). §F.1'in 10 maddesi **tam sürüm** koşuldu; kanıt HANDOFF §F.2
raporunda + §D55. Sayım yöntemi: §3 tablolarındaki `Must`/`Must (MVP temel)` satırları elle değil
**sayılarak** (✅=teslim+test, ◐=çekirdek var/KK eksik); `Should (MVP)` kalemleri kapanışı
bloklamadı (§F.00) ama §3.13'te ismen listeli. _Tarihçe: kapanış öncesi üst-tablo sayacı bayattı —
"45 ✅ · 6 ◐ — ❌ AÇIK" (2026-07-25 damgası); 01.3/02.4/13.8 çevrilince güncellenmemişti (§D55)._

**v1 (Faz 1) kapandı (2026-07-31 · GL-4 · tm 88).** v1 `Must` kapısı **sayılarak** `20 ✅ · 0 ◐ · 0 ⬜`
(§4.1/4.2/4.3'te `Must (v1)` = **20 satır**, hepsi ✅: 05.1/05.3/05.5 · 06.1–06.4 [10] · 08.5.4–.6 ·
08.8.4 · 02.1.2 · 04.2 · 10.1.4). Mobil (13.7 · 13.8-push) 🔒 → **Faz 3'e atandı** (2026-08-01 · §D60;
eski gerekçe "§11.1/8" yanlış atıftı — o madde masaüstü native app'i kapsar) — `Should` olduğu için
sayaca zaten girmiyordu, kapanış kararı değişmedi. `Should` kalemleri de çoğunlukla teslim (Copilot 12.x · Campaigns · Reviews/Reports v1 ·
Apps · Custom fields · HelpDesk merge…); tek bilinçli v2 payı `06.3.2-bulk` (bulk/CSV, §5.1). §F.1'in
**10 maddesi tam sürüm** koda karşı koşuldu; **tam DoD kapısı + tam E2E süiti** yeşil (817 unit · 821
integration · 59 e2e — exit 0). Kanıt HANDOFF §F.2 + §D56. GL-5/6/7 (tm 70/68/69, öne çekilen güvenlik)
bağımlılığı **çözüldü**. _Tarihçe: kapanış öncesi sayaç "denetlendi §4 — çoğu ⬜/◐ — ❌ AÇIK" idi; öne
çekmeler (Playbook/AI) + sonraki dilimler v1 payını doldurdu ama kapanış turu koşulmamıştı (§D56)._

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
| 01.1.3                   | **Command Palette (⌘K)** — içerik arama + rota atlama    | Must (MVP temel) |  ✅   | Dilim 14 (tm 18) — müşteri/sohbet/ticket arama + modül atlama, scope-gated, deep-link. **v2 payı da kapandı** (§5.0 `01.1.3`, tm 95.1–95.8): aksiyon + AI sorgu sonuç tipleri, klavye sarması, KK placeholder'ı `Search Text or go to…` — üçü tek e2e oturumunda |
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
| 02.4.1–.6 | Details paneli (info/tags/visited pages/visit info) | Must (MVP) | ✅ | ✅ → K02.4.1-.6 |
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
| 13.8 | **Notifications** (ses/masaüstü/tarayıcı/e-posta) | Must (MVP) | ✅ | ✅ → K13.8 |

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
> **✅ KAPANDI (2026-07-31 · GL-3 · tm 87):** 9 alt-görev tm 27–31'de done; sayaç sayılarak
> `51 ✅ · 0 ◐ · 0 ⬜` doğrulandı; §F.1'in 10 maddesi tam sürüm koşuldu (kanıt HANDOFF §F.2 · §D55).

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
| 06.2.4 | Ordered steps (6 adım tipi; reorder + klavye alternatifi) | Must (v1) | ✅ → K06.2.4 |
| 06.2.5 | Preview (canlı simülasyon)                                | Must (v1)   |               ✅               |
| 06.3.1 | Knowledge alt sekmeler (All/Websites/Files/Articles/FAQ) | Must (v1) | ✅ → K06.3.1 |
| 06.3.2 | + New source (chunk+embedding) | Must (v1) | ✅ → K06.3.2 |
| 06.3.3 | Kaynak tablosu (düzenle/sil/yeniden indeksle)             | Must (v1)   |               ✅               |
| 06.4   | Profile (persona: Tone/Language/Answer length)            | Must (v1)   | ✅ Name/Avatar/Tone/Language/Answer length + canlı Preview — `ProfileForm.tsx` · API `playbook.ts` PATCH `/ai-agents/:id` (answer_length→persona jsonb) · test `ProfileForm.test.tsx` (6) + `ai-agent-profile.test.ts` · tm 11/33.5 · §D25 |
| 06.5 | Performance (resolution rate, CSAT, transfer) | Should (v1) | ✅ → K06.5 |

### 4.3 Diğer v1 modülleri

| PRD        | Gereksinim                                                                                             | Öncelik        |                         Durum                         |
| ---------- | ------------------------------------------------------------------------------------------------------ | -------------- | :---------------------------------------------------: |
| **08.8.4** | **Webhooks** (register/list/unregister) — HMAC-SHA256 + timestamp/nonce + retry 3× + **SSRF koruması** | Must (v1)      | ✅ register/list/unregister API · HMAC-SHA256 imzalama + timestamp/nonce/SSRF · 3× retry + delivery log · tm 34 · §D36 |
| 02.1.2 | AI Agents grubu (AI agent / Solved) | Must (v1) | ✅ → K02.1.2 |
| 02.1.4 | Views grubu (WhatsApp/Messenger/Twilio görünümleri) | Should (v1) | ✅ → K02.1.4 |
| 02.3.2 | Reply Suggestions çipleri | Should (v1) | ✅ → K02.3.2 |
| 02.5 | Copilot özeti → internal note | Should (v1) | ✅ → K02.5 |
| 02.7 | Tickets grid (sıralanabilir, deep-link) | Should (v1) | ✅ → K02.7 |
| 02.9 | Live typing preview | Should (v1) | ✅ → K02.9 |
| 03.1.3 | Ziyaretçi tablosu + satır aksiyonları | Should (v1) | ✅ → K03.1.3 |
| 03.3.1–.3 | Campaigns (alt sekmeler, builder, kart) | Should (v1) | ✅ → K03.3.1-.3 |
| 04.2 | AI Agents (team tarafı) — performance | Must (v1) | ✅ → K04.2 |
| 04.6 | Chatbots / Suspended agents sekmeleri | Should (v1) | ✅ → K04.6 |
| 07.4       | AI Agent raporu (resolution/deflection)                                                                | Should (v1)    | ✅ resolution/deflection — resolutions=ADR-09 (fatura ile aynı sorgu) · tm 44 · §D29 |
| 07.7 | Rapor grupları + Export (CSV) | Should (v1–v2) | ✅ → K07.7 |
| 07.8       | Reviews / Ratings                                                                                      | Should (v1)    | ✅ CSAT donut + günlük bar raporu · API `/reports/reviews` · e-commerce iskeleti · tm 45 · §D34 |
| 08.5.4     | Messenger (Facebook OAuth)                                                                             | Must (v1)      |             ✅ **MOCK adaptör** (tm 35)              |
| 08.5.5     | Twilio SMS                                                                                             | Must (v1)      |             ✅ **MOCK adaptör** (tm 35)              |
| 08.5.6     | WhatsApp (Business)                                                                                    | Must (v1)      |             ✅ **MOCK adaptör** (tm 35)              |
| 08.6.2 | Ticket rules (atama/etiket/öncelik) | Should (v1) | ✅ → K08.6.2 |
| 08.7.3     | Chat timeout                                                                                           | Should (v1)    |          ✅ **idle auto-close sweep** (tm 48)          |
| 08.7.4 | Chat transcripts (e-posta) | Should (v1) | ✅ → K08.7.4 |
| 08.7.5 | Ticket email templates | Should (v1) | ✅ → K08.7.5 |
| 08.7.6 | Custom fields | Should (v1) | ✅ → K08.7.6 |
| 08.7.7 | Forms builder (pre/post-chat) | Should (v1) | ✅ → K08.7.7 |
| 08.8.1 | Apps (marketplace) girişi | Should (v1) | ✅ → K08.8.1 |
| 09.1 | Entegrasyon kartları gridi | Should (v1) | ✅ → K09.1 |
| 09.2 | Entegrasyon listesi (15–20) | Should (v1) | ✅ → K09.2 |
| 10.1.4 | AI resolutions meter + stepper | Must (v1) | ✅ → K10.1.4 |
| 10.1.5     | API calls (aşım paketi)                                                                                | Should (v1)    |                     ✅ tm 55                          |
| 10.3       | Invoices + payment details yönetimi                                                                    | Should (v1)    |                     ✅ tm 56                          |
| 11.7 | Widget customization (Appearance/Position/Mobile) | Should (v1) | ✅ → K11.7 |
| 11.8 | Typing indicator (sneak-peek) | Could (v1) | ✅ → K11.8 |
| 12.1–12.3 | **Copilot** (buton, ayrı KB, özet + yanıt yardımı) | Should (v1) | ✅ → K12.1-12.3 |
| 13.1 | Home dashboard | Should (v1) | ✅ → K13.1 |
| 13.6 | Omnichannel Ticketing / HelpDesk katmanı | Should (v1) | ✅ → K13.6 |
| 13.7 | Mobil uygulamalar | Should (v1) | ⬜ → K13.7 |

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
> 08.8.4, 02.1.2, 04.2, 13.8-mobil-push(🔒 → Faz 3, §D60). Bunların `0 ◐/⬜` olması gerekir. `Should`'lar
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

- **10.1.4-a — AI resolutions meter + stepper + %80 uyarı (UI)** `[XHIGH]` · *Must v1* — **✅ tm 54**
  · metering ✅ (ADR-13), UI ✅ (`BillingPage.tsx` `ai-counter`/`quota-percent`/`quota-warning`/
  `overage-package`/`overage-charge`; `/billing/usage` = fatura ADR-09; test `BillingPage.test.tsx` 12) —
  KK: _"Sayaç 'N/limit (% used)'; aşım paketi; %80 proaktif uyarı (Nexa)"_ · doğrulama: unit (%80'de
  uyarı; sayaç metering'den) ✅. **Bağımlılık:** yok. GL-1'de senkronlandı (§D53), GL-4'te doğrulandı.
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
- **13.7 Mobil uygulamalar** — 🔒 → **Faz 3'e atandı** (§6 · §6.1 · tm 90). v1 kapanışını **bloklamadı**.
  _Gerekçe düzeltmesi (2026-08-01, §D60):_ bu satır önce "web-öncelikli (PRD §11.1/8 ile hizalı)" diyordu.
  §11.1/8 **"Masaüstü native uygulama"** maddesidir — mobil değil. PRD'de mobil kapsam dışı DEĞİL; aksine
  FR-MOD-13.7 `Should (v1)` ve KK'sında _"tam modül paritesi (Nexa farklılaşması)"_ yazıyor. Yani kalem
  **gerekçesiz 🔒** durumundaydı ve §F.00'ın _"gerekçesiz 🔒 bir kapanış engelidir (gizlenmiş ⬜ olabilir)"_
  kuralına takılıyordu. Doğru gerekçe: native iOS/Android **bu deponun stack'i dışında** (ADR-01/02: TS
  monorepo, Fastify+React+Vite) — ayrı uygulama hattı, ayrı derleme zinciri, store süreci. Faz 3'e taşındı.

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
- **✅ Kapandı (2026-07-31 · tm 86 · §D54):** karar = **SİL** — dosya-dosya diff'te 6 parked
  dosyanın hiçbiri teslim edilen muadillerde olmayan bir davranış/test taşımıyor (üçü de teslim
  edilende ya birebir ya süperküme, biri `PlaybookPage.tsx`'e inline). Hiçbir yer parked modülleri
  import etmiyor (ölü kod). `git rm -r .parked-playbook` → `git status` untracked **0**; web
  typecheck/lint/unit **445** (baz değişmedi → regresyon yok). Kod değişmedi; commit `chore`.

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
- **✅ Kapandı (2026-07-31 · tm 87 · §F.2 · §D55):** Faz-0 `Must` sayacı **sayılarak** doğrulandı →
  `51 ✅ · 0 ◐ · 0 ⬜` (48 modül Must §3.0–§3.10 + 3 EK). Üst-tablo bayat sayacı (`45 ✅ · 6 ◐`)
  düzeltildi; 3 bayat `◐` (EK-A.1/A.2/B.1 + NFR P4) tm 29/30 teslimine karşı kanıtla `◐`→`✅`
  ("verify+close, don't rebuild" [[nexa-early-delivered-slices-audit]]). §F.1'in **10 maddesi tam
  sürüm** koşuldu, madde madde kanıt HANDOFF §F.2'de. **Tam DoD kapısı (exit 0):** typecheck · lint ·
  unit **817** · integration **821** (contract-parity 5/5) · build · e2e **59** (demo-flow dahil,
  `.env` source'lanarak — rtm dev'i ilk denemede env'siz düşmüştü, §D55). Üst tablo Faz-0 → **✅ KAPALI**.

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
- **✅ Kapandı (2026-07-31 · tm 88 · §F.2 · §D56):** v1 `Must` sayacı **sayılarak** doğrulandı →
  `20 ✅ · 0 ◐ · 0 ⬜` (grep `Must (v1)` §4.1/4.2/4.3 = 20 satır, hepsi ✅); mobil (13.7/13.8-push) 🔒
  gerekçeli. **Kod DEĞİŞMEDİ** — saf denetim + doküman senkronu ("verify+close, don't rebuild"
  [[nexa-early-delivered-slices-audit]]). §F.1'in **10 maddesi tam sürüm** koda karşı koşuldu, madde
  madde kanıt HANDOFF §F.2'de. **Faz sızıntısı:** GL-5/6/7 (cc-mask/spam-filter/banned-IP) **henüz
  yazılmadı** (dosyalar ABSENT, `bannedCustomerIps` 0 enforcement) → §D52 belgeli sapma dışında sızıntı
  YOK. **Şema artığı (§F.1/4):** webhooks/channels/ratings artık tüketiliyor (§8 güncellendi), yalnız
  goals(v2)+workflows(⛔ADR-14) gerekçeli 0-tüketici. **Tam DoD kapısı + TAM E2E (exit 0, kanıtla):**
  typecheck · lint · build · unit **817** · integration **821** (contract-parity 5/5, serial
  `--concurrency=1`) · **e2e 59** (18 spec, `.env` source'lu, demo-flow dahil) · db:check-drift "no
  drift". Doküman tazeliği: üst tablo v1→✅ KAPALI + sayaç · §F.00 v1 kapı satırı · §8 (3 satır) ·
  §4.4.11 10.1.4-a "UI ⬜"→✅ · §D56. **GL-5/6/7 (tm 70/68/69) bağımlılığı çözüldü.**

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
- **✅ Kapandı (2026-07-31 · tm 70 · §D57):** saf lib `apps/api/src/lib/cc-mask.ts` — 13–19 haneli aday
  diziler (boşluk/tire ayraçlı dahil) **Luhn** ile doğrulanır, geçen PAN `**** **** **** 1234`'e maskelenir
  (son 4 korunur; yanlış-pozitif biası: kaçırmaktansa fazla maskele). **Yazım yolları kaynağında maskelenir:**
  `chats.ts` (`normaliseEvent` → ajan send + start initial), `customer.ts` (widget mesaj + **AI/skill'e giden
  metin** + pre-chat `custom_fields` + rating comment + typing sneak-peek), `email-inbound.ts`
  (`ingestInboundEmail` konu → ticket + triage kuralları). Kaynakta maskelendiği için **RTM push + transcript
  e-postası otomatik** maskeli. **Yan kanallar (kanıt):** request log (Fastify default serializer `req.body`
  loglamaz + test'te `disableRequestLogging`) · `audit_log` meta (yapıca "asla değer/PII" + sweep 0) ·
  `.data/mail` FileMailer spool (transcript maskeli, ham PAN yok) · AI/skill yolu maskeli metin alır. **Testler
  (NEGATİF önce):** `src/lib/cc-mask.test.ts` (**16** — Luhn-geçmez 16-hane sipariş no/telefon/UUID/timestamp/
  20-hane MASKELENMEZ; ayraçlı/ayraçsız/13-15-16-19-hane PAN maskelenir) + `test/integration/cc-masking.test.ts`
  (**9** — widget/ajan/pre-chat/rating/email **DB'de ham PAN YOK** doğrudan SQL; transcript spool + audit sweep
  temiz; cross-tenant A/B). **Tam DoD (exit 0):** typecheck · lint · build · unit (api +16) · integration **788**
  (api, +9; contract-parity 5/5, serial `--concurrency=1`) · **e2e 59**. §5 08.9.5 ✅ · §7.2 NFR-C5/S9 ✅ · §D57.

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

> **Bu bölüm 2026-08-01'de baştan yazıldı (v2 planlama turu).** Önceki hâli 18 kalemlik bir liste +
> "orta derinlik" kırılımdı. Bu tur iki şey yaptı: **(1) kapsamı PRD'ye karşı süpürdü** — v2'nin
> gerçek kalem sayısı **30** çıktı, PLAN'da **12'si eksikti** (§D62); **(2) kalan işi tam atomik
> böldü** — her alt-görev tek temiz pencerede DoD kapısından geçebilecek boyutta, `dosyalar` +
> `referans desen` alanlarıyla (§5.2).
>
> **Kapsam süpürmesi nasıl yapıldı:** üç bağımsız kaynak paralel tarandı ve sonra uzlaştırıldı —
> (a) PRD **§5.3** v2 faz tablosunun her "Alan | Kapsam" hücresi; (b) PRD **§5.5** modül→faz
> matrisinin **v2 sütununda** işaret taşıyan her modül; (c) PRD **§6**'nın `Öncelik` sütununda
> `(v2)` geçen her `FR-MOD` satırı. Eksiklerin çoğu PRD'de **proza içinde** geçtiği ve kendi
> `FR-MOD` satırı olmadığı için gözden kaçmıştı (ör. "zamanlanmış export", "100+ entegrasyon",
> "çoklu-ajan çakışma uyarısı", "command palette AI komutları"). Her "PLAN'da yok" iddiası hedefli
> `grep` ile teyit edildi ve yanlış-pozitifler ayıklandı.

### 5.0 v2 kalem envanteri (30 kalem — PRD'ye karşı sayıldı)

**3 ⬜ açık · 1 ◐ kısmi · 23 ✅ teslim · 3 ⛔ kapsam dışı** — tablodan **sayılarak** (§1.2: bu sayılar elle yazılmaz; son sayım 2026-08-10, tm 110 turunda — bu tur satır 22 ile birlikte üç kaçırılmış çevrimle eşitlendi: `09.3` ⬜→✅ (tm 71.8) · `09.4` ⬜→✅ (tm 72.7) · `13.2` ⬜→◐ (tm 73.1, sürüyor); §D84).
7 kalem faz çelişkisi taşıyordu → hepsi bu turda PRD'den çözüldü (§D61/§D62).
Açık 23 kalemin tamamı §5.2'de atomik bölündü.

`Yeni` sütunu: `★` = bu turda kapsam süpürmesinde bulunan, PLAN §5'te satırı olmayan kalem.

| PRD | Gereksinim | Öncelik | Yeni | Durum / Not |
| --- | --- | --- | :-: | --- |
| 06.3.2-bulk | **Bulk/CSV knowledge base import** | Should (v2) |  | ✅ → K06.3.2-bulk |
| 07.5 | **Metrics breakdown** — ajan/takım/kanal/saat | Should (v2) |  | ✅ → K07.5 |
| 07.6 | **Chat topics (AI-clustered)** | Could (v2) |  | ✅ → K07.6 |
| 07.7 | **Rapor grupları v2 payı** — Leads/Cases/Sales/Team performance + **PDF export** + benchmark + **Save view** | **Should (v1–v2)** | ★ | ✅ → K07.7-b |
| 07.9 | **Zamanlanmış (scheduled) rapor export** | v2 (§5.3 Reports) | ★ | ✅ → K07.9 |
| 08.5.7 | **Instagram (DM)** | Should (Ent./v2) |  | ✅ → K08.5.7 |
| 08.6.3 | **Skills-based routing + supervision/takeover** | Could (v2) |  | ✅ → K08.6.3 |
| 08.6.3-conflict | **Çoklu-ajan çakışma uyarısı** | v2 (§5.3 Routing) | ★ | ✅ → K08.6.3-conflict |
| 08.8.3 | **MCP server** (search_tickets/list_chats/get_report/summarize_chat) | Could (v2) |  | ✅ → K08.8.3 |
| 08.9.2 | Banned customers | Should (v2) | | ✅ **TESLİM** — GL-6 · tm 68 · `lib/banned-ip.ts` · §D58 |
| 08.9.3 | Spam filtre | Should (v2) | | ✅ **TESLİM** — GL-7 · tm 69 · `services/security/spam-filter.ts` · §D59 |
| 08.9.5 | CC masking (Luhn, yazma anında) | Should (v2) | | ✅ **TESLİM** — GL-5 · tm 70 · `lib/cc-mask.ts` · §D57 |
| 08.9.6 | **IP allowlist / oturum güvenliği** | Could (Ent.) → **v2** | ★ | ✅ → K08.9.6 |
| 08.9.7 | **Temel audit log — TÜM PLANLARDA** + kullanıcıya görünür ekran | v2 (§5.3 Güvenlik) · NFR-S12 | ★ | ✅ → K08.9.7 |
| 09.2 | **100+ entegrasyon** (marketplace katalog genişlemesi) | v2 (§5.5 MOD-09) | ★ | ⬜ §5.5 matrisi: v1 `○ (15–20)` → v2 `○ (100+)`. v1'de 20 kart **teslim** (tm 51/52). İş = katalog + kataloğun **ölçeklendiğinin kanıtı** (arama/kategori/sayfalama). Hepsi MOCK. → §5.2 |
| 09.3 | **API istek paketleri** (Essential/Pro/Pro+) | Could (v2) |  | ✅ → K09.3 |
| 09.4 | **Zapier/Make + Build-your-app** (partner/creator) | Could (v2) | | ✅ → K09.4 |
| 01.1.3 | **⌘K command palette — AI komutları** | v2 (§5.5 MOD-01) | ★ | ✅ → K01.1.3 |
| 12.4 | **Copilot BI komut** (rapor/metrik sorusu → cevap) | v2 (§5.5 MOD-12) | ★ | ✅ → K12.4 |
| 13.2 | **Engage / Traffic** (gelişmiş filtre + ziyaretçi 360° panel) | Should (v2) | | ✅ → K13.2 |
| 13.3 | **Goals** — ziyaretçi→sohbet→dönüşüm hunisi | Should (v2) | | ⬜ `goals` tablosu **teslim** şemada ama **0 tüketici** (§8) — bu iş onu bağlar. → §5.2 |
| 13.4 | Görsel Workflow builder (nodes/edges) + 31+ şablon | Could (v2) | | ⛔ **ADR-14: UI yapılmayacak** (`workflows` tablosu şemada kalır). Şablon **sayısı** hedefi ADR-14 uyumlu ikame ile onurlandırıldı → `05.6-tmpl31` (§C-A14) |
| 05.6 | **Skill şablon kataloğunu 31+'a genişlet** (ADR-14 uyumlu ikame) | v2 (§5.3 Otomasyon) | ★ | ✅ → K05.6 |
| 13.5 | **Sales tracker** (Ecommerce/Tracked sales) | Could (v2) | | ⬜ 13.3 Goals + 07.8 Reviews/Ratings (tm 45 **teslim**) üzerine. → §5.2 |
| §5.3-KB | **Public KB** (SEO'lu self-servis) | v2 (§5.3 Knowledge) |  | ✅ → K5.3-KB |
| §5.3-Vardiya | **Work scheduler / staffing prediction** | v2 (§5.3 Vardiya) |  | ✅ → K5.3-Vardiya |
| §5.3-Marka | **Multibrand** | v2 (§5.3 Marka) |  | ✅ → K5.3-Marka |
| 06.2.3 | NL skill (doğal dil talimat → skill) | Must (v1) | | ✅ **v1'de teslim.** PRD §5.3'teki tekrarı **kapsam dışı** görsel builder'ın bağlamıdır → yeni iş YOK (§D62) |
| — | §5.5 MOD-04 (Team/roller) v2 `○` | ○ (§5.5) | | ⛔ Somut `FR-MOD (v2)` satırı yok, kapsam tanımsız → **ayrı kalem açılmadı** (§C-A12) |
| — | §5.5 MOD-06 (AI+RAG) v2 `○` | ○ (§5.5) | | ⛔ MOD-06'nın tek `(v2)` içeriği `06.3.2-bulk` → **ayrı kalem açılmadı** (§C-A13) |

### 5.1 Kırılım politikası + etiket sistemi (model × efor matrisi)

> **Bu bölüm 2026-08-01'de yeniden yazıldı.** Önceki hâli "v2 orta-derinlik kırılımı" idi ve gerekçesi
> şuydu: _"v2 başlarken kod tabanı değişmiş olacak; bugün yazılan ince kırılım yanlış güven verir."_
> O gerekçe **artık geçerli değil**, çünkü v2 **şimdi başlıyor** — Faz-0 ve v1 kapandı (§F.00), kod
> tabanı bu kırılımın yazıldığı andaki hâliyle aynı. Bu yüzden §5.2'deki kırılım **tam atomiktir**:
> her alt-görev tek temiz pencerede DoD kapısından geçebilecek boyuttadır ve `dosyalar` +
> `referans desen` alanlarını taşır. Bayatlama politikası artık yalnız **Faz 3**'e (§6.1) uygulanır.

#### 5.1.1 Etiket = model + efor

Otonom döngüde (`run-loop.sh`) her temiz pencere, görev başlığındaki etiketten **hangi modelle** ve
**hangi eforla** çalışacağını okur. Bu turda etiket tek boyutlu (`[XHIGH]`/`[MAX]`) olmaktan çıkıp
**iki boyutlu** hâle geldi: _model_ × _efor_. Gerekçe: v2 iş kalemlerinin büyük bölümü mekanik
(katalog verisi, liste/sekme UI, kontrat satırı, salt-okunur rapor kartı) ve bunları en pahalı
modelle koşturmak bütçeyi, gerçekten muhakeme isteyen güvenlik/algoritma işlerinden çalıyor.

| Etiket | Model | Efor | Ne zaman |
| --- | --- | --- | --- |
| `[SONNET-XHIGH]` | sonnet | xhigh | **Varsayılan hedef.** Mekanik iş: depoda kopyalanacak bir desen var ve o dosya ismen verilebiliyor; ~3-5 dosya; güvenlik sınırı yok; eşzamanlılık yok; kontrat/şema değişikliği katkısal; KK mekanik doğrulanabilir. |
| `[SONNET-MAX]` | sonnet | max | Aynı güvenlik/eşzamanlılık muafiyeti, ama iş **mekanik olarak girift**: geniş yüzey (10+ dosya), çok sayıda benzer dönüşüm, yoğun tablo/rapor sorgusu, çok adımlı form akışı. Sonnet yapabilir ama daha fazla düşünme bütçesi ister. |
| `[OPUS-XHIGH]` | opus | xhigh | Çok dosyaya yayılan **tasarım kararı**, yeni UI kompozisyonu, yeni veri/sorgu şekli, çok yüzeyli bağlama (kontrat+backend+UI+RTM), KK'da yorum gerektiren belirsizlik — **veya hafif güvenlik dokunuşu** (yeni yetkili endpoint, scope genişletme). |
| `[OPUS-MAX]` | opus | max | Güvenlik sınırı (authN/authZ, erişim kontrolü, kripto), tenant/marka izolasyonu, eşzamanlılık/kilit, algoritma tasarımı, çapraz-kesen veri modeli değişikliği. |

**Efor tabanı `xhigh`'dır** — bu matriste `high` veya altı yoktur. Kullanıcı kuralı:
_"Güvenlik olarak high gereken işlerde xhigh kullansın."_ Yani güvenlik hassasiyeti taşıyan hiçbir
iş `sonnet`'e verilmez ve hiçbir iş `xhigh`'ın altına düşmez.

**Yanlış `SONNET` etiketi bu planın en pahalı hatasıdır** — bir güvenlik sınırının küçük modele
düşmesi, kaydedilmemiş bir açık demektir. Bu yüzden §5.2'deki her `SONNET-*` alt-görev, kırılım
turunda ayrı bir **düşman denetçisi** tarafından 6 koşula karşı yeniden sınandı (KK birebir mi, kod
iddiası doğru mu, `dosyalar`/`referans desen` gerçekten var mı, güvenlik sızmış mı, bağımlılık grafı
sağlam mı, Sonnet için yeterince belirli mi) ve kritik bulgular kırılıma geri işlendi.

**Eski etiketler:** Faz-0 ve v1 tarihçe bölümlerinde (§3 · §4 · §A · §B) `[XHIGH]`/`[MAX]` yazımı
**olduğu gibi bırakıldı** — o işler bitti, etiketleri artık yalnız kayıt değeri taşıyor. Yeni matris
§5.2 (v2) ve §6.1 (Faz 3) için geçerlidir.

#### 5.1.2 Bölme politikası

Kullanıcı talimatı (2026-08-01): _"bütün taskları olabildiğince task ve subtasklara böleceksin."_

- **Her kalem** görev + alt-görevlere bölünür. Tek parça bırakmak varsayılan **değildir**.
- **Tek istisna:** bir `[OPUS-MAX]` alt-görevin **güvenlik/algoritma çekirdeği** daha küçüğe
  bölünmez — bağlam bölününce güvenlik akıl yürütmesi kaybolur. Çekirdek tek alt-görev kalır.
- Çekirdeğin **etrafındaki** her şey (kontrat satırı, migration, salt-okunur UI, liste ekranı, seed,
  tip tanımı) ayrı ve **daha ucuz etiketli** alt-göreve çıkarılır. Tipik desen:
  `[SONNET-XHIGH]` kontrat/tip iskeleti → `[OPUS-MAX]` güvenlik çekirdeği (bölünmez) →
  `[SONNET-XHIGH]` UI → `[OPUS-XHIGH]` uçtan uca doğrulama.
  Bu, pahalı pencereyi küçültür: v1'in ölçülen maliyeti opus-xhigh ~$13/pencere, opus-max
  ~$25-31/pencere idi (§`run-loop.sh` kota kapısı yorumu).
- Contract-first sıra korunur: kontrat+backend alt-görevi UI'dan **önce** gelir, UI ona bağımlıdır.
- Bir alt-görev 2 pencereden uzun çıkıyorsa **mutlaka** daha da bölünür; 3 pencere yalnız
  bölünemez güvenlik çekirdeği için kabul edilir.

### 5.2 v2 atomik kırılım (23 kalem · 196 alt-görev)

> Her kalem: alt-görev tablosu (ID · başlık · **etiket** · bağımlılık · pencere) + kalem seviyesinde
> **KK birebir** + bölünmeyen çekirdek gerekçesi + varsayımlar + açık sorular.
> **Tam alan detayı** (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu
> testler · sözleşme · migration) **`PLAN-V2-KIRILIM.md`** companion dosyasındadır (§D66).
> Alt-görev ID'leri PLAN §5.2, companion, §G düz tablosu ve Task Master'da **birebir aynıdır**.
>
> **Etiket dağılımı (196 alt-görev):** `SONNET-XHIGH` **95** · `SONNET-MAX` **5** · `OPUS-XHIGH` **65** ·
> `OPUS-MAX` **31** → **%51 Sonnet**. Ölçülen pencere maliyeti (v1 koşularından): opus-xhigh ~$13,
> opus-max ~$25–31; Sonnet belirgin ucuz. Yarısını küçük modele indirmek, kalan yarıdaki güvenlik
> ve algoritma işine bütçe bırakır — etiket disiplininin somut karşılığı budur.

#### 5.2.1 · Bulk/CSV knowledge base import (FR-MOD-06.3.2 — v1'in tek bilinçli v2 payı)

**8 atomik alt-görev · ~11 pencere** — `OPUS-MAX` ×3 · `OPUS-XHIGH` ×1 · `SONNET-XHIGH` ×4

**KK (PRD birebir):** _"crawl/parse"_ · _"Geçersiz URL/tür reddi"_ · _"**bulk/CSV import** (Nexa)"_ · _"RAG indeksleme"_

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `06.3.2-bulk-a` | RFC4180 CSV ayrıştırıcı + formül-enjeksiyon nötrleme (saf modül, lineer zaman) | `OPUS-MAX` | — | 2 |
| `06.3.2-bulk-b` | CSV satır şeması: kolon eşleme + satır-başı doğrulama (saf modül) | `SONNET-XHIGH` | — | 1 |
| `06.3.2-bulk-c` | POST /knowledge-sources/bulk — kontrat + route: tenant sahipliği, satır tavanı, tx sınırı,… | `OPUS-MAX` | 06.3.2-bulk-a, 06.3.2-bulk-b | 2 |
| `06.3.2-bulk-d` | Frontend saf yardımcılar: örnek CSV şablonu katalogu + dosya okuma/ön-kontrol modülü | `SONNET-XHIGH` | — | 1 |
| `06.3.2-bulk-e` | Knowledge panelinde "Bulk import" formu: dosya seç → dry-run önizleme | `SONNET-XHIGH` | 06.3.2-bulk-c, 06.3.2-bulk-d | 1 |
| `06.3.2-bulk-f` | İçe aktarma sonuç tablosu: satır no / başlık / durum / hata + kısmi-başarı özeti + empty state | `SONNET-XHIGH` | 06.3.2-bulk-e | 1 |
| `06.3.2-bulk-g` | CSV'de website satırları: satır-başı SSRF guard + crawl'ın transaction DIŞINDA, sıralı ve… | `OPUS-MAX` | 06.3.2-bulk-c | 2 |
| `06.3.2-bulk-h` | Uçtan uca doğrulama: E2E CSV içe aktarma akışı + RAG'de aranabilirlik + regresyon/parite kanıtı | `OPUS-XHIGH` | 06.3.2-bulk-f, 06.3.2-bulk-g | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** Üç bölünmez çekirdek var, hepsi izole edildi ve etraflarındaki ucuz yüzeyler ayrı alt-görevlere çıkarıldı. (1) 06.3.2-bulk-a — CSV ayrıştırıcı: depoda kopyalanacak parser YOK (reports-export.ts ters yön/serileştirme, apps/api'de csv-parse/papaparse grep 0), yani yeni algoritma tasarımı; ayrıca formül-enjeksiyon nötrleme + lineer-zaman (ReDoS) garantisi aynı fonksiyonun içinde yaşıyor — tırnak/gömülü satır-sonu durum makinesini enjeksiyon guard'ından ayırmak, guard'ın hangi hücreye uygulandığı bilgisini kaybettirir. (2) 06.3.2-bulk-c — bulk endpoint: satır-başı tenant/ai_agent sahiplik kontrolü + tx sınırı + kısmi-başarı semantiği tek bir akıl yürütme; "ilk satırdan sonra sahiplik kontrolünü atlama" bu işin somut hata sınıfı ve döngüyü sonuç-zarfından ayırınca görünmez oluyor. (3) 06.3.2-bulk-g — website satırları: tek istek → N dış fetch = SSRF amplifikasyonu; guard'ın satır başına…

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (10)
  - TAŞIMA (§C adayı): Yeni bir multipart bağımlılığı EKLENMEZ. CSV, JSON gövdesinde ham metin alanı (`csv`) olarak gelir; route-özel `bodyLimit` ile `server.ts:99`'daki 1…
  - BÜYÜKLÜK: Senkron ve sınırlı — istek başına satır tavanı (~200), hücre başına 100.000 karakter (mevcut `createSourceBody.content` zod tavanıyla aynı), toplam gövde…
  - YANIT ŞEKLİ: Kısmi başarı 200 + `{ imported, failed, dry_run, results[] }` ile raporlanır; 207 kullanılmaz ve ADR-06 hata zarfı yalnız TÜM isteğin reddinde döner.…
  - TX SINIRI: Her satır kendi kısa transaction'ında yazılır (create + `knowledge.index()` çifti). Tek uzun tx seçilmedi: kısmi başarı zaten sözleşme, ve N embedding boyunca…
  - ÖNİZLEME: İstemciye ikinci bir CSV parser yazılmaz; önizleme `dry_run: true` ile sunucudan alınır. Böylece önizlemede görülen kural ile yazmada uygulanan kural aynı…
  - VERİ MODELİ: Batch/job/import-durumu tablosu EKLENMEZ → migration yok. PRD §8.4 DDL'inde böyle bir tablo tanımlı değil ve senkron+sınırlı akış onu gerektirmiyor. Sonuç…
  - _…+4 madde daha — tam metin companion dosyada_

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (5)
  - Satır tavanı 200 doğru büyüklük mü? PRD/NFR bulk için bir sayı vermiyor; üründe daha büyük (birkaç bin satırlık) bir beklenti varsa akış senkron kalamaz ve asenkron iş +…
  - İçe aktarılan kaynaklar bir 'batch' izi taşımalı mı? Bugün `addedBy` dışında iz yok; toplu geri alma ("bu içe aktarmayı sil") isteniyorsa `knowledge_sources`'a bir…
  - v2-04 §312 "PDF/DOCX/PPTX/TXT/CSV/TSV/MD, 50 MB'a kadar" satırı hangi yüzeye ait? Bu kırılım onu *dosya-türü knowledge kaynağı ayrıştırma* hedefi kabul etti ve ikili…
  - Kısmi başarıda, düşen satırların düzeltilebilir bir 'hata CSV'si' olarak indirilebilmesi isteniyor mu? Şu an kapsam dışı (06.3.2-bulk-f kapsam_disi). İsteniyorsa…
  - Bulk'ta `type:'file'` satırı ne anlama gelmeli? Bu kırılım onu 'CSV hücresindeki düz metin' kabul etti (tek-kaynak akışıyla aynı: `content` indekslenir). Eğer beklenti…

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.1**

#### 5.2.2 · Metrics breakdown — ajan/takım/kanal/saat boyutları (FR-MOD-07.5)

**9 atomik alt-görev · ~11 pencere** — `OPUS-MAX` ×2 · `OPUS-XHIGH` ×1 · `SONNET-XHIGH` ×6

**KK (PRD birebir):** _"Boyutlu kırılım"_

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `07.5-a` | ReportsBreakdown kontratına by_hour/by_team/by_channel (additive, opsiyonel) | `SONNET-XHIGH` | yok | 1 |
| `07.5-b` | Saat boyutu: breakdownByHour() + /reports/breakdown yanıtına by_hour | `SONNET-XHIGH` | 07.5-a | 1 |
| `07.5-c` | channel_messages(license_id, chat_id) indeksi + saf kanal etiketi helper'ı | `SONNET-XHIGH` | yok | 1 |
| `07.5-d` | Kanal boyutu agregasyon çekirdeği — license_id-kilitli soft-FK join + 'website' fallback | `OPUS-MAX` | 07.5-a, 07.5-c | 2 |
| `07.5-e` | Takım boyutu agregasyon çekirdeği — chat_access M:N fan-out + license kilidi | `OPUS-MAX` | 07.5-a | 2 |
| `07.5-f` | CSV export: breakdown grubunu dört boyuta genişlet (uzun format) | `SONNET-XHIGH` | 07.5-b, 07.5-d, 07.5-e | 1 |
| `07.5-g` | Breakdown sekmesi: "By hour" bölümü (salt-okunur tablo + empty state) | `SONNET-XHIGH` | 07.5-b | 1 |
| `07.5-h` | Breakdown sekmesi: "By team" + "By channel" bölümleri + örtüşme dipnotu | `SONNET-XHIGH` | 07.5-d, 07.5-e | 1 |
| `07.5-i` | Uçtan uca doğrulama: dört boyut çapraz-tutarlılığı + NFR-P2 bütçe ölçümü | `OPUS-XHIGH` | 07.5-f, 07.5-g, 07.5-h | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** İki OPUS-MAX çekirdeği bölünmez. (1) 07.5-d kanal boyutu: `channel_messages.chat_id` FK'sız soft-reference (schema.prisma yorumu birebir: "`chat_id` is a soft reference (no FK)"); join `license_id` eşleşmesiyle kilitlenmezse başka tenant'ın satırı bir chat'i yanlış kanala sokabilir — join koşulu, RLS davranışı ve "hangi kanal" seçimi tek akıl yürütmedir, parçalanırsa izolasyon argümanı kaybolur. (2) 07.5-e takım boyutu: `chat_access` tablosunun KENDİ license_id kolonu YOK (migration 20260722154008 satır 892-906 birebir: "chat_users and chat_access have no license column of their own (PRD §8.4)" — RLS `chats` üzerinden EXISTS alt-sorgusuyla uygulanıyor) ve `chat-service.ts:1246` `chatAccess.createMany` bir chat'i birden fazla gruba yazabiliyor (M:N) → izolasyon kilidi + çift-sayım invariantı + "hangi takım" tanımı aynı kararın parçaları. Bu çekirdeklerin ETRAFI ucuzlatıldı: kontrat…

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (10)
  - Saat kovası UTC'dir — mevcut `breakdownByDay`'in `AT TIME ZONE 'UTC'` deseniyle (reports.ts:301) tutarlı. Müşteri saat dilimi parametresi bu kalemde kapsam dışı; aksi…
  - `by_hour` DENSE döner (0-23, veri yoksa sıfır satır); `by_day` mevcut davranışını korur (sparse). Gerekçe: saat ekseni sabit ve 24 elemanlıdır, UI'da boşluk yerine sıfır…
  - Kanal sınıflandırması: bir chat'in kanalı, o chat'e ait EN ESKİ `direction='inbound'` `channel_messages` satırının `channel_type`'ıdır; hiç satır yoksa `'website'`.…
  - Takım boyutunda FAN-OUT kabul edilir (birincil grup SEÇİLMEZ): bir chat açık olduğu her takımın satırında sayılır ve yanıt `overlapping: true` ile bunu beyan eder, UI…
  - Hiçbir gruba açık olmayan sohbetler `team_id: null` / 'Unassigned' satırında toplanır — hiçbir sohbet kaybolmaz.
  - Rapor görünürlüğü lisans genelinde kalır: `reports_read` scope'u tüm takımların/kanalların metriklerini görür. Gerekçe: mevcut `by_agent` de tüm ajanları döndürüyor…
  - _…+4 madde daha — tam metin companion dosyada_

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (5)
  - Takım boyutunda örtüşme beyanı (fan-out + `overlapping` bayrağı) yeterli mi, yoksa şemaya 'birincil takım' (`threads.group_id` veya `chat_access.is_primary`) eklenip…
  - Kanal boyutuna e-posta dahil edilecek mi? `email-inbound.ts` gelen e-postayı TICKET'a çeviriyor (chat değil) ve `channel_messages` yazmıyor; mevcut breakdown ise…
  - v2-03 §316 ortak gövde parametreleri `distribution` (`hour|day|day-hours|month|year`) ve `filters.agents` / `filters.groups` tanımlıyor. Bu kalem sabit dört boyutu TEK…
  - NFR-P7 ("ağır raporlar için read-replica/ayrı analitik depo") uygulanmış değil. 07.5-i'nin EXPLAIN ölçümü NFR-P2 bütçesini (okuma p99 <150ms) aşarsa ne yapılacak — kalem…
  - `chat_access` RLS'i `chats` üzerinden EXISTS alt-sorgusuyla çalışıyor (migration 20260722154008:892-906). Takım agregasyonu bu alt-sorgunun maliyetini ödeyecek; ölçüm…

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.2**

#### 5.2.3 · 07.6 — Chat topics (AI kümeleme): deterministik ai-mock kümeleme + hacim/trend raporu + yetersiz-veri empty state

**8 atomik alt-görev · ~9 pencere** — `OPUS-MAX` ×1 · `OPUS-XHIGH` ×3 · `SONNET-XHIGH` ×4

**KK (PRD birebir):** _"yeterli veri yoksa empty"_ · _"AI kümeleme"_ · _"hacim/trend"_

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `07.6-a` | `GET /reports/topics` kontratı + yetkili route iskeleti + yetersiz-veri (empty) yanıtı | `OPUS-XHIGH` | yok | 1 |
| `07.6-b` | Deterministik konu kümeleme çekirdeği: `packages/ai-mock/src/topics.ts` (kümeleme + etiket… | `OPUS-MAX` | 07.6-a | 2 |
| `07.6-c` | Kümelemeyi route'a bağla: tenant-scoped konu sorgusu + hacim/trend (önceki dönem) + performans… | `OPUS-XHIGH` | 07.6-a, 07.6-b | 1 |
| `07.6-d` | Demo seed'de konu çeşitliliği: kümelenebilir sohbet özetleri | `SONNET-XHIGH` | 07.6-b, 07.6-c | 1 |
| `07.6-e` | Reports'ta 'Chat topics' sekmesi: hacim/trend listesi + yetersiz-veri empty state | `SONNET-XHIGH` | 07.6-a, 07.6-c | 1 |
| `07.6-f` | Overview'da 'Top chat topics' promo bandı (See chat topics / Remind me later — kalıcı dismiss) | `SONNET-XHIGH` | 07.6-e | 1 |
| `07.6-g` | Topics rapor grubu: `/reports/groups` kataloğu + CSV export satırı | `SONNET-XHIGH` | 07.6-c | 1 |
| `07.6-h` | Uçtan uca doğrulama: Chat topics e2e (dolu + empty) + ai-mock paylaşım regresyonu | `OPUS-XHIGH` | 07.6-c, 07.6-d, 07.6-e, 07.6-f | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** 07.6-b (deterministik kümeleme + etiket türetme çekirdeği) bölünmez. Üç şey aynı akıl yürütmenin parçası ve ayrı pencerelere dağılınca kaybolur: (1) determinizm garantisi — aynı sohbet kümesi girdi sırasından bağımsız aynı kümeleri/etiketleri vermeli, yoksa rapor her yenilemede değişir ve testler kırılgan olur; (2) eşik kalibrasyonu — benzerlik eşiği, minimum küme boyutu ve "yeterli veri" eşiği birbirine bağlı üç sayıdır, biri diğerinden ayrı ayarlanamaz ("yeterli veri yoksa empty" KK'sı doğrudan bu üçlüye dayanıyor); (3) etiket türetmede PII elemesi — etiket, müşteri konuşma metninden türeyen tokenlardan oluşuyor; salt-rakam tokenların (kart/sipariş numarası) elenmesi kümeleme skorlamasıyla aynı fonksiyonda yaşıyor, ayrı pencereye çıkarılırsa "etiketi kim üretti, neyi eledi" bağlamı kopar. Ayrıca packages/ai-mock/src/embedding.ts hem RAG (knowledge-service.ts) hem bu iş tarafından…

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (9)
  - YENİ TABLO YOK — kümeleme istek anında (on-the-fly) hesaplanır. Gerekçe: CLAUDE.md'ye göre şema tek doğruluk kaynağı PRD §8.4 + rapor-2-teknik-mimari.md §5.3 ve ikisinde…
  - Kümeleme girdisi: thread başına `threads.summary` doluysa o, değilse thread'in ilk müşteri `events.text` mesajı (type='message', author_type='customer'). `summary`…
  - Performans tavanı: pencere başına en fazla 1000 en yeni kümelenebilir sohbet işlenir; üstü kesilir ve yanıtta `analyzed` alanı gerçek sayıyı söyler. NFR-P7 ölçümü…
  - 'Yeterli veri yoksa empty' bir HATA DEĞİL, bir DURUM: 200 + `sufficient_data:false` + `topics: []`. Yeni ApiError tipi EKLENMEZ — böylece errors.ts (×2 yer) +…
  - Chat topics ayrı bir sol-nav girdisi veya `/chat-topics` rotası DEĞİL, Reports sayfasının 5. sekmesidir. Sol navigasyonda 'NEW' kırmızı nokta rozeti YAPILMAZ:…
  - `share` ve `trend` boşken 0 değil null döner — depodaki yerleşik kural (ReportsOverview.automated_rate, ReportsReviews.score: 'unrated period is unknown, not bad').…
  - _…+3 madde daha — tam metin companion dosyada_

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (4)
  - 'Yeterli veri' eşiği kaç sohbet? PRD sayı vermiyor ('yeterli veri yoksa empty'). Önerilen kalibrasyon: pencerede ≥20 kümelenebilir sohbet VE küme başına ≥3 sohbet;…
  - Trend hangi biçimde sunulsun: sayısal değişim oranı mı (önceki döneme göre), yoksa ayrık 'up/down/flat' mı? Öneri: kontrat `previous_volume` (integer) + `trend`…
  - Kümeleme girdisi olarak müşteri mesaj metni kullanılsın mı, yoksa yalnız `threads.summary` mi? Yalnız summary kullanılırsa insan-yürüttüğü sohbetler rapordan düşer…
  - Topics CSV export grubu (07.6-g) bu kalemin kapsamında mı kalsın, yoksa 07.7 'Rapor grupları + Export'a mı bırakılsın? Şu an 07.6'ya alındı çünkü reports-export.ts:34-44…

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.3**

#### 5.2.4 · 07.7-v2 — Rapor grupları v2 payı: Leads/Cases/Sales/Team performance + PDF export + benchmark + Save view

**12 atomik alt-görev · ~13 pencere** — `OPUS-MAX` ×1 · `OPUS-XHIGH` ×3 · `SONNET-MAX` ×1 · `SONNET-XHIGH` ×7

**KK (PRD birebir):** _"İzin bazlı görünürlük"_ · _"export"_ · _"benchmark karşılaştırma"_

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `07.7-a` | Cases rapor grubu — kontrat + lisans-kapsamlı ticket sorgusu + CSV exporter | `SONNET-XHIGH` | yok | 1 |
| `07.7-b` | Leads rapor grubu — organizasyon-kapsamlı `customers` verisinin lisans sınırına oturtulması… | `OPUS-MAX` | 07.7-a | 2 |
| `07.7-c` | Team performance rapor grubu — ajan bazlı KPI genişletmesi (mevcut by_agent üzerine) | `SONNET-MAX` | 07.7-b | 1 |
| `07.7-d` | Sales rapor grubu — 13.5 Sales tracker'a bağlı `configured:false` dürüst iskelet | `SONNET-XHIGH` | 07.7-c | 1 |
| `07.7-e` | Benchmark karşılaştırma katmanı — tüm rapor gruplarına ortak vs-baseline (lisans-içi,… | `OPUS-XHIGH` | 07.7-a, 07.7-b, 07.7-c, 07.7-d | 1 |
| `07.7-f` | Deterministik, bağımlılıksız PDF serializer (saf modül) — `toCsv`'nin PDF eşi | `OPUS-XHIGH` | yok | 1 |
| `07.7-g` | PDF export rotası — `/reports/export` `format` parametresi + content-type/attachment bağlama | `SONNET-XHIGH` | 07.7-f, 07.7-d, 07.7-e | 1 |
| `07.7-h` | Reports Save view — rapora özgü kaydedilmiş görünüm (saf modül, Inbox views deseni) | `SONNET-XHIGH` | yok | 1 |
| `07.7-i` | Reports UI — Leads + Cases sekmeleri (kartlar + benchmark rozetleri + empty state) | `SONNET-XHIGH` | 07.7-a, 07.7-b, 07.7-e | 1 |
| `07.7-j` | Reports UI — Sales + Team performance sekmeleri (ajan tablosu + `configured:false` empty state) | `SONNET-XHIGH` | 07.7-c, 07.7-d, 07.7-i | 1 |
| `07.7-k` | Reports UI — Export butonu (CSV/PDF indirme) + Save view çubuğu | `SONNET-XHIGH` | 07.7-g, 07.7-h, 07.7-i, 07.7-j | 1 |
| `07.7-l` | Uçtan uca doğrulama — 8 grup için izin matrisi, cross-tenant süpürmesi, ağır sorgu bütçesi… | `OPUS-XHIGH` | 07.7-a, 07.7-b, 07.7-c, 07.7-d, 07.7-e, 07.7-f, 07.7-g, 07.7-h, 07.7-i, 07.7-j, 07.7-k | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** 07.7-b (Leads) tek bölünemez güvenlik çekirdeği. Gerekçe koda karşı: `customers` tablosu `organization_id` ile scope'lu (schema.prisma:228-236 — `licenseId` alanı YOK) ve RLS `app.current_organization` ile kapatılıyor (lib/tenant.ts:60); buna karşılık TÜM mevcut rapor sorguları `license_id` ile scope'lu (`WHERE t.license_id = ${licenseId}`, `ticketCount` `where:{licenseId}`). Bir Organization birden çok License taşır (`Organization.licenses License[]`). Dolayısıyla `customers.is_lead`'i doğrudan saymak, aynı organizasyonun KARDEŞ LİSANSLARININ müşterilerini bu lisansın raporuna sızdırır. Hangi sınırın doğru olduğu (org-scope mu, chats/tickets üzerinden lisans-bağlı join mi) bir erişim-kontrolü kararıdır; sorgu + RLS + negatif test aynı pencerede kalmalı, bölünürse izolasyon akıl yürütmesi kaybolur. Çekirdeğin ETRAFINDAKİ her şey daha ucuz etiketli alt-görevlere çıkarıldı: PDF serializer…

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (8)
  - §V1 — BENCHMARK TANIMI: PRD 'benchmark karşılaştırma' der ama neye karşı olduğunu söylemez. Karar: benchmark = AYNI LİSANSIN kendi geçmişiyle karşılaştırması (baseline:…
  - §V2 — PDF KAPSAMI: PDF çıktısı TABLO'dur; grafik/donut/bar çizimi yoktur. Dayanak: depoda hiçbir PDF/çizim bağımlılığı yok (package.json grep 0) ve CONVENTIONS'ın dış…
  - §V3 — LEADS/CASES EXPORT'U AGREGATTIR: Bu iki grup satır-bazlı müşteri verisi (ad/e-posta/telefon) döndürmez; yalnız sayılar/gün kırılımı döner. Dayanak: PRD KK'sı…
  - §V4 — SAVE VIEW İSTEMCİ TARAFIDIR: Kaydedilmiş rapor görünümü `localStorage`'da tutulur, sunucuda tablo açılmaz. Dayanak: aynı özelliğin yazılı emsali Inbox'ta böyle…
  - §V5 — SALES GRUBU 13.5'E BAĞLIDIR: Şemada satış/sipariş tablosu yok; Sales grubu `configured:false` dürüst iskelet olarak teslim edilir (reviews raporundaki `ecommerce`…
  - §V6 — TEAM PERFORMANCE ≠ 07.5: 07.7'nin Team performance'ı bir RAPOR GRUBUDUR (ajan bazlı KPI + kendi export'u). Saat/kanal/takım BOYUTLARI ve ısı haritası FR-MOD-07.5…
  - _…+2 madde daha — tam metin companion dosyada_

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (5)
  - Leads sayımının lisans sınırı: 07.7-b 'bu lisansa dokunmuş lead' (chats/tickets join) yorumunu alıyor. Alternatif yorum 'organizasyon geneli lead' olurdu ve o da…
  - Cases grubunda merge edilmiş ticket'lar (`merged_into_id IS NOT NULL`) sayılmalı mı? 07.7-a çift sayım olmasın diye `merged_into_id IS NULL` filtresini varsayıyor; 13.6…
  - NFR-P7 ('ağır raporlar → read-replica / kolon-tabanlı analitik depo') bu depoda karşılanamaz (altyapı, §9 sınırı). 07.7-l ikame olarak aralık üst sınırı veya export…
  - PDF'e benchmark bloğu nasıl yerleşecek: ayrı bir 'Önceki dönem' tablosu mu, yoksa her satırda delta sütunu mu? 07.7-g bunu tablo-şekli kararı olarak bırakıyor; UI ile…
  - Team performance sorgusunda mevcut `LIMIT 20` (reports.ts:697) korunacak mı, yoksa tam ajan listesi mi dönecek? Tam liste NFR-P7 yükstartırır; 07.7-c mevcut limiti…

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.4**

#### 5.2.5 · Zamanlanmış (scheduled) rapor export — PRD §5.3-Reports

**10 atomik alt-görev · ~12 pencere** — `OPUS-MAX` ×1 · `OPUS-XHIGH` ×5 · `SONNET-MAX` ×1 · `SONNET-XHIGH` ×3

**KK (PRD birebir):** _"FR-MOD-07.7 KK (PRD satır 591, birebir): "İzin bazlı görünürlük; export; benchmark karşılaştırma" — bu alt-göreve düşen pay: "İzin bazlı görünürlük" + "export"."_ · _"FR-MOD-07.7 KK (PRD satır 591, birebir): "İzin bazlı görünürlük; export; benchmark karşılaştırma" — bu alt-göreve düşen pay: "İzin bazlı görünürlük" (tek kayıt okuma/değiştirme de aynı izin kapısından geçer)."_ · _"FR-MOD-07.7 KK (PRD satır 591, birebir): "İzin bazlı görünürlük; export; benchmark karşılaştırma" — bu alt-göreve düşen pay: "export" (CSV üretiminin tek doğruluk kaynağı olarak korunması)."_ · _"FR-MOD-07.7 KK (PRD satır 591, birebir): "İzin bazlı görünürlük; export; benchmark karşılaştırma" — bu alt-göreve düşen pay: "İzin bazlı görünürlük" (teslim geçmişi de aynı izin kapısından geçer)."_ · _"FR-MOD-07.7 KK (PRD satır 591, birebir): "İzin bazlı görünürlük; export; benchmark karşılaştırma" — bu alt-göreve düşen pay: "İzin bazlı görünürlük" (kullanıcı yalnız görebildiği rapor gruplarını zamanlayabilir)."_ · _"FR-EK-B.1 KK (PRD, birebir): "10.000+ satırda 60fps; skeleton; her boş liste için anlamlı empty state (boş dikdörtgen yok)" — bu alt-göreve düşen pay: "her boş liste için anlamlı empty state (boş dikdörtgen yok)"."_ · _"FR-EK-A.1 KK (PRD, birebir): "Tek form/validasyon kütüphanesi; alan-altı hata mesajı" — oluşturma formu bu primitifi kullanır."_ · _"FR-MOD-07.7 KK (PRD satır 591, birebir): "İzin bazlı görünürlük; export; benchmark karşılaştırma" — bu alt-görev 'İzin bazlı görünürlük' ve 'export' paylarını UÇTAN UCA kanıtlar (benchmark v2 — kapsam dışı)."_

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `07.9-sched-a` | Şema + migration: scheduled_reports / scheduled_report_runs (RLS + dönem tekilleştirme kısıtı) | `OPUS-XHIGH` | yok | 1 |
| `07.9-sched-b` | `reports_manage` scope + kontrat/route: zamanlanmış export listeleme ve oluşturma | `OPUS-XHIGH` | 07.9-sched-a | 2 |
| `07.9-sched-c` | Kontrat/route: tek kayıt okuma + güncelleme + iptal (GET/PATCH/DELETE) | `OPUS-XHIGH` | 07.9-sched-b | 1 |
| `07.9-sched-d1` | Rapor teslim e-postası: Mailer `kind` genişletme + saf konu/gövde biçimlendirici | `SONNET-XHIGH` | yok | 1 |
| `07.9-sched-d2` | Rapor CSV üretimini paylaşılan `services/reports/report-csv.ts` modülüne çıkar | `SONNET-MAX` | yok | 1 |
| `07.9-sched-e` | Zamanlayıcı çekirdeği: dönem hesabı + tek-teslim claim (idempotens) + tenant-scoped sweep | `OPUS-MAX` | 07.9-sched-a, 07.9-sched-b, 07.9-sched-d1, 07.9-sched-d2 | 2 |
| `07.9-sched-f` | `scheduled-reports:run` operatör betiği + npm script (dry-run varsayılanı) | `SONNET-XHIGH` | 07.9-sched-e | 1 |
| `07.9-sched-g` | Teslim geçmişi okuması: kontrat + `GET /reports/scheduled-exports/{id}/runs` | `OPUS-XHIGH` | 07.9-sched-c, 07.9-sched-e | 1 |
| `07.9-sched-h` | Settings UI: "Scheduled exports" bölümü (liste + oluştur + iptal + son çalışma durumu) | `SONNET-XHIGH` | 07.9-sched-c, 07.9-sched-g | 1 |
| `07.9-sched-i` | Uçtan uca doğrulama: cross-tenant zinciri + tekrar-tetik idempotens regresyonu + e2e | `OPUS-XHIGH` | 07.9-sched-c, 07.9-sched-e, 07.9-sched-f, 07.9-sched-g, 07.9-sched-h | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** Tek bölünmez çekirdek `07.9-sched-e` (zamanlayıcı çekirdeği). "Bir dönem için en fazla bir teslim" garantisi üç şeyin AYNI ANDA doğru olmasına bağlıdır: (1) dönem anahtarının (period_key) sıklıktan deterministik türetilmesi, (2) `scheduled_report_runs` üzerindeki `@@unique([scheduledReportId, periodKey])` kısıtına dayalı transactional claim — çakışma "başkası aldı" demektir, hata değil, (3) claim ile e-posta gönderiminin sırası (önce claim, sonra gönder; gönderim hatası satırı `failed` bırakır ama dönemi serbest bırakmaz). Bu üçü ayrı pencerelere bölünürse "iki e-posta gitmesin" akıl yürütmesi bağlamıyla birlikte kaybolur — claim'i yazan pencere gönderim sırasını görmez, gönderimi yazan pencere claim'in yarış semantiğini görmez. Çekirdeğin ETRAFINDAKİ her şey ayrı ve daha ucuz etiketlere çıkarıldı: şema/migration (-a), CRUD yüzeyi (-b/-c), CSV üretimi (-d2), e-posta biçimi (-d1), CLI…

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (11)
  - Zamanlama motoru: bu depoda production scheduler YOK (proje sınırı). Zamanlanmış export, `retention:run` ve `chat-timeout:run` ile aynı 'operatör / host-cron tetikler'…
  - Format yalnız CSV. PDF karara bağlanmamıştı; `apps/api/src/routes/reports-export.ts` başlık yorumu 'PDF and benchmark comparison are explicitly out of scope for v1'…
  - Teslim kanalı: `FileMailer` mock (`.data/mail`), gerçek SMTP yok (MASTER-PROMPT §5 / PLAN §9). Teslim 'gönderildi' kabulü = posta kutusuna dosya düşmesi.
  - Yeni yazma scope'u `reports_manage` eklenir ve YALNIZ `ADMIN_SCOPES`'a verilir (principal.ts). Gerekçe: `AGENT_SCOPES` içinde `reports_read` bile yok — ajan raporu…
  - Sıklık kümesi: `daily | weekly | monthly`. PRD sıklık listelemiyor → türetilmiş. Gün sınırı UTC (ADR-12 tek bölge eu; depodaki tüm rapor sorguları zaten UTC gün ile…
  - Rapor penceresi: her çalışmada 'önceki TAM dönem' (daily → dün 00:00–24:00 UTC). Kısmi dönem hiç gönderilmez; böylece aynı period_key için içerik deterministiktir ve…
  - _…+5 madde daha — tam metin companion dosyada_

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (6)
  - Alıcı kümesi gerçekten workspace-içi ajan e-postalarıyla sınırlansın mı, yoksa doğrulanmış dış adres (ör. muhasebe/yönetim) de olsun mu? Varsayım #7 dar tarafı seçti;…
  - `reports_manage` yeni bir scope olarak mı eklensin, yoksa mevcut bir yönetim scope'u (`billing_manage` veya `properties.configuration:rw`) mı yeniden kullanılsın? Yeni…
  - Kalıcı teslim hatasında retry beklenir mi? Webhook tarafında NFR-M5 gereği 3× retry + her deneme log satırı var (`webhook-dispatcher.ts`). Zamanlanmış export için…
  - Sıklık için saat/gün seçimi gerekiyor mu (ör. 'her Pazartesi 09:00')? Şu an tüm dönem hesabı UTC gün sınırında; tenant saat dilimi alanı depoda yok. Gerekiyorsa…
  - PRD §5.3-Reports satırındaki 'zamanlanmış export', aynı satırdaki Chat topics ve Team performance raporlarını da kapsıyor mu? Bu kırılım yalnız mevcut 4 rapor grubunu…
  - `GET /reports/export` (senkron) için hâlâ hiçbir web tüketicisi yok (`grep -rn 'reports/export\|reports/groups' apps/web/src apps/e2e` = 0). Zamanlanmış export UI'ı…

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.5**

#### 5.2.6 · Instagram (DM) kanalı — MOCK adaptör, uçtan uca (PRD FR-MOD-08.5.7, v2)

**8 atomik alt-görev · ~9 pencere** — `OPUS-MAX` ×1 · `OPUS-XHIGH` ×2 · `SONNET-XHIGH` ×5

**KK (PRD birebir):** _"Coming soon → Get notified → tam entegrasyon"_ · _"rapor-1-fonksiyonel.md:1534-1541 — "[MOD-08.5.7] Instagram (SOON) ... Mevcut Durumlar: Coming soon. Tetiklenen Eylem ve Sayfa Mantığı: [Get notified] lansman bildirimi için kayıt."_ · _"rapor-1-fonksiyonel.md:1467 — "Instagram — Coming soon — [Get notified]."_ · _"rapor-1-fonksiyonel.md:1534-1541 — "[Get notified] lansman bildirimi için kayıt. Validasyon ve Hata Senaryoları: Yok."_

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `08.5.7-a` | Instagram kanal tipinin kontrata eklenmesi (ChannelType enum + connect/webhook gövde tanımı) | `SONNET-XHIGH` | yok | 1 |
| `08.5.7-b` | InstagramAdapter — parseConnect/parseInbound/send (MOCK) + adapter unit testleri | `SONNET-XHIGH` | 08.5.7-a | 1 |
| `08.5.7-c` | instagram'ın adapter kanalı olarak devreye alınması (CHANNEL_TYPES + registry) + inbound→chat… | `OPUS-XHIGH` | 08.5.7-a, 08.5.7-b | 1 |
| `08.5.7-d` | Kanal adresinin lisanslar arası tekilliği — çakışan adres bağlamanın reddi (bölünmez izolasyon… | `OPUS-MAX` | 08.5.7-c | 2 |
| `08.5.7-e` | Settings → Channels: Instagram kartının statik 'Coming soon'dan canlı connect/disconnect… | `SONNET-XHIGH` | 08.5.7-c | 1 |
| `08.5.7-f` | 'Get notified' kaydının kalıcılaştırılması (kalan coming-soon kanalları) | `SONNET-XHIGH` | 08.5.7-e | 1 |
| `08.5.7-g` | Inbox Views grubunda Instagram kanal görünümü | `SONNET-XHIGH` | 08.5.7-c | 1 |
| `08.5.7-h` | Uçtan uca doğrulama: Instagram bağla → DM gelsin → inbox'ta chat (e2e) | `OPUS-XHIGH` | 08.5.7-e, 08.5.7-g | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** 08.5.7-d (kanal adresi sahiplenme çakışmasının reddi) bölünmez. Kısıt (DB unique index), yazma yolu (ChannelService.connect upsert + P2002 yarış dalı) ve okuma yolu (resolveLicense çoklu-satır reddi) tek bir izolasyon akıl yürütmesinin üç ucudur; ayrı pencerelere bölünürse "adres bir lisansa aittir" invaryantı yarım kalır ve arada geçen sürümde çapraz-tenant yanlış yönlendirme açık kalır. Migration'ı ayrı alt-göreve çıkarmak da güvenli değil: kısmi/fonksiyonel index'in tam şekli (status='connected' + address IS NOT NULL kısıtı, seed'in config={} website_widget satırı) servis kodundaki ret kararıyla birlikte tasarlanmalı. Çekirdeğin ETRAFINDAKİ her şey (kontrat satırı -a, saf adapter -b, UI -e/-f/-g, e2e -h) zaten ayrı ve daha ucuz etiketlere çıkarıldı; pahalı pencere yalnız bu çekirdekle sınırlı.

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (9)
  - Instagram mock connect alan seti Messenger'a paralel seçildi: `code` (mock OAuth kodu) + `ig_user_id` (kanal adresi) + opsiyonel `username`; gönderici kimliği IGSID. PRD…
  - Kanal adresi olarak `page_id` değil `ig_user_id` alan adı seçildi. Gerekçe: Messenger'ın adres uzayıyla isim düzeyinde karışmaması; gerçek çakışma riski 08.5.7-d'de DB…
  - Inbound gövde şekli depodaki düzleştirilmiş {recipient, sender, message} kalıbını izler; Meta'nın gerçek entry[].messaging[] sarmalayıcısı taklit edilmez (mevcut…
  - Mock outbound provider message id öneki `aigid.` (Messenger'ın `mid.`, WhatsApp'ın `wamid.`, Twilio'nun `SM` muadili).
  - 'Get notified' kaydı backend'e yazılmaz; localStorage'da kalıcılaştırılır (Banner'ın kalıcı dismiss deseni). Gerekçe: yeni tablo/route açmamak, PRD kaydın nereye…
  - Kanal adresi tekilliği yalnız `status='connected'` iken zorlanır; disconnect edilen bir kanalın adresi başka bir lisans tarafından bağlanabilir. Gerekçe: disconnect…
  - _…+3 madde daha — tam metin companion dosyada_

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (4)
  - 08.5.7-d (kanal adresinin lisanslar arası tekilliği) 08.5.7 altında mı kalmalı, yoksa ayrı bir güvenlik tm görevi mi açılmalı? Bulgu Instagram'a özgü değil — mevcut…
  - Messenger/WhatsApp/SMS adaptörleri v1'de teslim (tm 35) olmasına rağmen Settings → Channels'ta hâlâ statik 'Coming soon' görünüyor (Channels.tsx:92-94). Bu bilinçli bir…
  - 'Get notified' PRD'de "lansman bildirimi için kayıt" olarak geçiyor ama kaydın nereye yazılacağı yazmıyor. İstemci-tarafı kalıcılık (localStorage) yeterli sayılsın mı,…
  - Instagram inbound gövde şekli: depodaki düzleştirilmiş {recipient, sender, message} kalıbı mı korunsun, yoksa Meta'nın gerçek IG webhook sarmalayıcısı…

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.6**

#### 5.2.7 · Skills-based routing + supervision/takeover — atomik kırılım

**9 atomik alt-görev · ~11 pencere** — `OPUS-MAX` ×2 · `OPUS-XHIGH` ×3 · `SONNET-XHIGH` ×4

**KK (PRD birebir):** _"Uzmanlık/skill bazlı"_ · _"supervisor takeover"_

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `08.6.3-a` | Skill kataloğu veri modeli (skills + agent_skills tabloları, RLS, seed) | `OPUS-XHIGH` | — | 1 |
| `08.6.3-b` | Skill katalog CRUD + ajan-skill atama API'si (kontrat + rol kapılı backend) | `OPUS-XHIGH` | 08.6.3-a | 1 |
| `08.6.3-c` | ADR-08 routing çekirdeği: skill-eşleşmeli aday seçimi + kural koşuluna skill_ids (BÖLÜNMEZ) | `OPUS-MAX` | 08.6.3-a, 08.6.3-b | 2 |
| `08.6.3-d` | Supervisor takeover çekirdeği: rol kapısı + eşzamanlı devir reddi + audit + RTM (BÖLÜNMEZ) | `OPUS-MAX` | — | 2 |
| `08.6.3-e` | Settings: Skills kataloğu bölümü + routing kuralında skill koşulu gösterimi | `SONNET-XHIGH` | 08.6.3-b, 08.6.3-c | 1 |
| `08.6.3-f` | Team: ajan başına skill ataması ekranı | `SONNET-XHIGH` | 08.6.3-b | 1 |
| `08.6.3-g` | Inbox: supervisor takeover butonu (rol kapılı, onaylı) + devir sonrası durum | `SONNET-XHIGH` | 08.6.3-d | 1 |
| `08.6.3-h` | Çoklu-ajan çakışma uyarısı (aynı sohbette birden fazla present ajan) | `SONNET-XHIGH` | — | 1 |
| `08.6.3-i` | Uçtan uca doğrulama: skill routing + takeover E2E, cross-tenant negatif matrisi, ADR-08… | `OPUS-XHIGH` | 08.6.3-c, 08.6.3-d, 08.6.3-e, 08.6.3-f, 08.6.3-g | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** İki OPUS-MAX çekirdek bölünmez. (1) 08.6.3-c ADR-08 aday seçimi: `#selectAgent` (routing-service.ts:246-269) tek ham SQL'de yük sayımı + kapasite HAVING'i yapıyor ve seçim `GROUP_PRIORITY_ORDER` katman düşmesi → en az yüklü → `last_assigned_at` tie-break zincirinden oluşuyor; skill filtresi bu zincirin herhangi bir halkasından ayrılırsa "skill'li aday yok → hangi gevşetme" kararı ve transaction-içi yük tutarlılığı (kod yorumu: "computing load in one transaction and writing the assignment in another lets two chats arriving together both pick the agent who had a free slot") kaybolur. (2) 08.6.3-d takeover: rol kapısı + koşullu assignee güncellemesi (iki supervisor yarışı) + audit kaydı tek bağlamda akıl yürütülmeli — yetki kararını yazma yarışından ayırmak "yetkisiz ikinci yazıcı kazanır" sınıfı hataya kapı bırakır. Her iki çekirdeğin ETRAFI (migration/RLS, katalog CRUD, üç UI ekranı,…

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (9)
  - Skill modeli düz (flat) bir katalogdur: seviye/ağırlık/hiyerarşi YOK. PRD FR-MOD-08.6.3 yalnız 'Uzmanlık/skill bazlı' diyor; seviyeli skill'e dair hiçbir kaynak satırı…
  - Skill routing'de GEVŞETİLMEZ: bir kural skill istiyorsa o skill'i olmayan ajan hiçbir aşamada seçilmez; skill'li uygun aday yoksa ADR-08'in mevcut fallback grup → kuyruk…
  - 'Supervisor' AYRI bir rol olarak eklenmez; mevcut roleAtLeast(role,'admin') (owner > viceowner > admin > agent, principal.ts:70-78) supervisor yetkisi olarak kullanılır.…
  - Takeover, mevcut POST /chats/{chatId}/transfer'i DEĞİŞTİRMEZ; ayrı bir path olarak eklenir. transfer = rızalı/kurala bağlı devir (scope kapılı, mevcut davranış korunur),…
  - Eşzamanlı takeover koşullu güncelleme (updateMany + beklenen assignee → 0 satır ise 409) ile çözülür, satır kilidi (SELECT FOR UPDATE) ile değil — mevcut…
  - Salt-okunur gözlemci ('watch' / non-participant supervisor izleme) bu kalemin KAPSAMI DIŞI. facts §eksikler bunu ayrı bir boşluk olarak işaretliyor (ChatUser.userType'a…
  - _…+3 madde daha — tam metin companion dosyada_

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (6)
  - Eşzamanlı takeover reddi için 409 gövdesinde hangi `error.type` kullanılacak? Mevcut 409'lar semantik olarak uymuyor (chat_inactive = kapalı sohbet; group_offline /…
  - Skill kataloğu Settings altında mı (`/settings/skills`, access_rules scope'u) yoksa Team altında mı (`/agents/skills`, agents--all scope'u) yaşamalı? Kırılımda Settings…
  - Bir routing kuralı birden fazla skill isteyebilir mi, isterse mantık AND mi OR mu? Kırılımda AND varsayıldı (`HAVING COUNT(DISTINCT skill_id) = n` — 'hepsine sahip'),…
  - Takeover'dan sonra ÖNCEKİ assignee sohbeti hâlâ okuyabilmeli mi (ChatUser satırı kalır, present=false) yoksa erişimi tamamen kesilmeli mi? Kırılımda 'satır kalır,…
  - `agent_skills` AgentMembership'e mi bağlanmalı (license_id + agent_id composite FK) yoksa doğrudan Account'a mı? Kırılımda license-scoped ayrı tablo varsayıldı…
  - Skill'i olmayan ama kurala uyan bir grup için 'skill'li kimse yok' durumu operatöre GÖRÜNÜR olmalı mı (ör. Settings'te uyarı rozeti)? Şu anda sohbet sessizce kuyruğa…

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.7**

#### 5.2.8 · Çoklu-ajan çakışma uyarısı (aynı sohbette iki ajan) — atomik kırılım

**7 atomik alt-görev · ~8 pencere** — `OPUS-MAX` ×1 · `OPUS-XHIGH` ×3 · `SONNET-XHIGH` ×3

**KK (PRD birebir):** _"| Routing (gelişmiş) | Skills-based routing, supervision + takeover, çoklu-ajan çakışma uyarısı |"_

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `08.6.3-conflict-a` | Çakışma uyarısı RTM push action'ı + composer-registry anahtar/TTL tip sözleşmesi | `SONNET-XHIGH` | yok | 1 |
| `08.6.3-conflict-b` | ConflictDetectionService — atomik eşzamanlı-yazıcı kaydı + çakışma kararı (güvenlik/algoritma… | `OPUS-MAX` | 08.6.3-conflict-a | 2 |
| `08.6.3-conflict-c` | send_typing_indicator yolunda çakışma tespiti + uyarının bus envelope ile her iki ajana iletimi | `OPUS-XHIGH` | 08.6.3-conflict-a, 08.6.3-conflict-b | 1 |
| `08.6.3-conflict-d` | Transfer/atama anında aktif yazıcı çakışmasının API tarafından uyarılması | `OPUS-XHIGH` | 08.6.3-conflict-a, 08.6.3-conflict-b | 1 |
| `08.6.3-conflict-e` | Çakışma uyarısı istemci state'i + ConflictBanner bileşeni (salt görünüm) | `SONNET-XHIGH` | 08.6.3-conflict-a | 1 |
| `08.6.3-conflict-f` | Realtime kablolama: agent_conflict_warning aboneliği + applyPush case'i + banner montajı | `SONNET-XHIGH` | 08.6.3-conflict-c, 08.6.3-conflict-e | 1 |
| `08.6.3-conflict-g` | Uçtan uca doğrulama: iki-ajan çakışma senaryosu + cross-tenant/negatif süiti + kanıt | `OPUS-XHIGH` | 08.6.3-conflict-c, 08.6.3-conflict-d, 08.6.3-conflict-f | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** Tek bölünmez çekirdek `08.6.3-conflict-b` (ConflictDetectionService). Özelliğin kendisi bir yarış durumu tespitidir: iki ajanın aynı thread'de eşzamanlı yazması. Kayıt+okuma tek atomik Redis işleminde yapılmazsa (check-then-act) tespitin kendisi bir race condition içerir ve çakışma sessizce kaçırılır (false negative) — yani özellik "çalışıyor gibi görünüp" hiç uyarmaz. Aynı bağlamda üç şey birlikte akıl yürütülmek zorunda: (1) atomik komut seçimi ve pencere (TTL) genişliği, (2) tenant-scoped yetki kontrolü — kaydı yalnız chat'e erişimi olan ajan yapabilir, aksi halde "hangi ajan hangi chat'te" bilgisi sızar (NFR-S4), (3) düşen socket'in kalıcı çakışma bırakmaması (TTL lapse). Bunlar ayrı pencerelere bölünürse yarış penceresi yanlış kapatılır. Çekirdeğin ETRAFINDAKİ her şey ayrıldı: tip/anahtar sözleşmesi (-a, SONNET), dispatcher+yayın (-c, OPUS-XHIGH), API atama yüzeyi (-d, OPUS-XHIGH),…

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (8)
  - §C — Çakışma UYARIDIR, ENGEL DEĞİLDİR. PRD 'çakışma uyarısı' diyor; ikinci ajanın yazması reddedilmez. Sonuç: yeni bir ApiError tipi (ve dolayısıyla errors.ts ×2 +…
  - §C — Kalıcı audit tablosu açılmaz. Çakışma anlık bir durumdur; Redis + TTL yeterli. Olgularda 'yok — migration gerek (eğer kalıcı audit isteniyorsa)' diye geçen…
  - §C — Yeni bir RTM client action'ı EKLENMEZ; mevcut `send_typing_indicator` yeniden kullanılır. Gerekçe: ajan composer'ı bu action'ı zaten gönderiyor (apps/web…
  - §C — Çakışma iki ayrı yüzeyde tespit edilir: (1) RTM/typing yolu — eşzamanlı YAZAN iki ajan (-b/-c); (2) API/transfer yolu — devir sırasında hâlâ yazan ajan (-d).…
  - §C — Uyarı `originConnectionId` SETLENMEDEN yayınlanır, çünkü fanout.ts origin socket'i eliyor; çakışan HER İKİ ajan da uyarıyı almalı.
  - §C — RTM gateway ilk kez envelope YAYINLAYAN taraf olur (bugüne kadar yalnız tüketiyordu). fanout.ts'in 'gateway yetki kararı vermez' kuralı korunuyor: audience…
  - _…+2 madde daha — tam metin companion dosyada_

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (4)
  - Çakışma penceresi (AGENT_COMPOSING_TTL_SECONDS) kaç saniye olmalı? PRD hiçbir eşik vermiyor. Öneri: mevcut AGENT_TYPING_TTL_SECONDS=8 ile hizalı 8-10 sn. Onay…
  - Uyarı ajan ADIYLA mı yoksa yalnız kimlikle mi gösterilsin? Ad göstermek ajan dizinine ek bir okuma (ve dolayısıyla ek bir yetki kararı) gerektirir; -e şu an payload'daki…
  - 'Çakışma' tanımına ATAMA-ONLY durum girsin mi — yani iki ajan aynı chat'te ChatUser.present=true ama hiçbiri yazmıyorsa uyarı verilsin mi? Mevcut kırılım HAYIR diyor…
  - FR-MOD-08.6.3'ün diğer yarısı (skills-based routing + supervisor takeover) ayrı bir kalem olarak mı planlanıyor? Bu kırılım yalnız 'çakışma uyarısı' payını kapsıyor;…

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.8**

#### 5.2.9 · MCP server (search_tickets/list_chats/get_report/summarize_chat) — tool yüzeyi + OAuth scope bazlı yetki + tenant izolasyon

**8 atomik alt-görev · ~9 pencere** — `OPUS-MAX` ×1 · `OPUS-XHIGH` ×3 · `SONNET-XHIGH` ×4

**KK (PRD birebir):** _"search_tickets/list_chats/get_report/summarize_chat tool'ları"_ · _"OAuth scope bazlı"_ · _"tenant izole"_ · _"**MCP server** (mcp URL + Copy + Claude setup + örnek prompt)"_

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `08.8.3-a` | MCP tool kataloğu — saf veri modülü (4 tool descriptor + input şemaları) | `SONNET-XHIGH` | — | 1 |
| `08.8.3-b` | MCP kontratı (paths/mcp.yaml) + GET /mcp/manifest keşif ucu | `OPUS-XHIGH` | 08.8.3-a | 1 |
| `08.8.3-c` | Tool-call yürütücüsü — scope gate + tenant kapsamı + IDOR 404 + audit + search_tickets… | `OPUS-MAX` | 08.8.3-a, 08.8.3-b | 2 |
| `08.8.3-d` | list_chats tool adaptörü (mevcut chat listeleme yoluna bağlama) | `SONNET-XHIGH` | 08.8.3-c | 1 |
| `08.8.3-e` | get_report tool adaptörü — `report` enum'u ile mevcut 4 rapor sorgusuna eşleme | `SONNET-XHIGH` | 08.8.3-c | 1 |
| `08.8.3-f` | summarize_chat tool'u + tool yanıtlarında PII/CC-mask sınırının doğrulanması | `OPUS-XHIGH` | 08.8.3-c | 1 |
| `08.8.3-g` | Settings → MCP bağlantı ekranı (mcp URL + Copy + Claude setup + örnek prompt) | `SONNET-XHIGH` | 08.8.3-b | 1 |
| `08.8.3-h` | Uçtan uca MCP istemci akışı + rate-limit kapsaması + audit doğrulaması | `OPUS-XHIGH` | 08.8.3-c, 08.8.3-d, 08.8.3-e, 08.8.3-f | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** Çekirdek = 08.8.3-c (tool çözümleme → scope gate → tenant kapsamı → IDOR 404 → audit). Bu dört karar tek akıl yürütmedir: gate'i dispatch'ten ayıran bir bölme, bir pencereye "hangi scope yeterli", başka bir pencereye "hangi tenant görülebilir" kararını verir; aradaki boşluk (ör. hasAnyScope geçtikten sonra sorgunun request.withTenant DIŞINDA çalışması, ya da yetkisiz id için 403 dönüp kaynağın varlığını doğrulaması) hiçbir pencerenin kabul kriterinde görünmez. Bu yüzden gate + tenant kapsamı + referans tool (search_tickets) tek alt-görevde (2 pencere bütçesi) kalır. Çekirdeğin ETRAFINDAKİ her şey dışarı çıkarıldı: saf katalog verisi (-a), kontrat+manifest (-b), üç tool adaptörü (-d/-e/-f), salt-okunur UI (-g), uçtan uca doğrulama (-h). Böylece OPUS-MAX penceresi 9 pencerenin yalnız 2'si.

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (11)
  - Tool yüzeyi TEK genel uç olarak kurulur: POST /api/v1/mcp/tools/{tool} (tool adı path param). Olgulardaki per-tool path listesi kendi içinde 'tahmini öneri' olarak…
  - MCP istemcisinin kimliği MEVCUT yollarla kurulur: PAT (Basic base64(account_id:PAT)) veya mevcut OAuth 2.1 Auth-Code+PKCE akışı (apps/api/src/routes/auth.ts). Dynamic…
  - MCP'ye özel YENİ SCOPE eklenmez. Mevcut tickets--*:ro / chats--*:ro / reports_read ödünç alınır. Gerekçe: packages/types/src/scopes.ts'e scope eklemek…
  - YENİ ApiError TİPİ eklenmez; validation / authorization / not_found kullanılır. Gerekçe: yeni tip errors.ts (2 yer) + scopes.test.ts sayacı + openapi enum + regen…
  - api_tokens.kind'a 'mcp' değeri EKLENMEZ; MCP token'ı 'pat' veya 'oauth' olarak kalır → hiçbir alt-görevde Prisma migration yok.
  - get_report TEK tool olarak kalır ve zorunlu `report` argümanı enum alır: overview | breakdown | ai-agent | reviews — apps/api/src/routes/reports.ts'teki dört…
  - _…+5 madde daha — tam metin companion dosyada_

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (6)
  - Claude Desktop/ChatGPT gibi bir MCP istemcisi gerçekten JSON-RPC/SSE bekliyorsa, REST tool uçları yeterli mi yoksa ayrı bir POST /mcp JSON-RPC köprüsü ayrı bir kalem…
  - Dynamic client registration (RFC 7591) v2 kapsamında mı? Bugünkü /auth/authorize insan tarayıcı login formu varsayıyor — MCP istemcisinin PAT ile bağlanması kabul…
  - get_report enum'una CSV export (/reports/export, ayrı EXPORT_SCOPES) dahil edilecek mi? Şimdilik kapsam dışı bırakıldı.
  - summarize_chat çağrısı copilot.recordAssist / Assisted metriğini ve ADR-09 AI-resolution sayacını besleyecek mi? Beslerse MCP çağrıları faturayı etkiler.
  - MCP tool çağrıları için ayrı bir rate-limit kovası mı gerekli, yoksa mevcut PAT kovası yeterli mi? Ayrıca 10.1.5 'API calls' faturalama sayacı MCP çağrılarını da saymalı…
  - Manifest, çağıranın scope'larına göre FİLTRELENMELİ mi (yalnız çağırabileceği tool'ları göstersin)? Bugünkü plan statik tam katalog döndürüyor; filtreleme bir yetki…

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.9**

#### 5.2.10 · IP allowlist / oturum güvenliği (FR-MOD-08.9.6) — atomik kırılım

**9 atomik alt-görev · ~10 pencere** — `OPUS-MAX` ×3 · `OPUS-XHIGH` ×3 · `SONNET-XHIGH` ×3

**KK (PRD birebir):** _"oturum politikaları"_ · _"IP kısıtı"_

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `08.9.6-a` | security_settings oturum politikası kolonları + kontrat/okuma yüzeyi (davranışsız iskelet) | `SONNET-XHIGH` | — | 1 |
| `08.9.6-b` | ip_allowlist_entries tablosu + RLS politikası + IpAllowlistEntry şeması | `OPUS-XHIGH` | — | 1 |
| `08.9.6-c` | lib/ip-allowlist.ts — CIDR/IP eşleştirme algoritması + izin-ret semantiği (saf, DB'siz) | `OPUS-MAX` | — | 1 |
| `08.9.6-d` | /settings/ip-allowlist CRUD (GET/POST/DELETE) + self-lockout guard + audit + path kontratı | `OPUS-XHIGH` | 08.9.6-b, 08.9.6-c | 1 |
| `08.9.6-e` | IP allowlist enforcement — auth onRequest kapısı + trustProxy taklit yüzeyi + not_allowed/audit | `OPUS-MAX` | 08.9.6-a, 08.9.6-b, 08.9.6-c | 1 |
| `08.9.6-f` | PATCH /settings/security — oturum politikası alanlarının yazma yüzeyi (validasyon + audit) | `SONNET-XHIGH` | 08.9.6-a | 1 |
| `08.9.6-g` | Oturum politikası enforcement — idle timeout (lastUsedAt) + lisans başına eşzamanlı oturum… | `OPUS-MAX` | 08.9.6-a, 08.9.6-f | 2 |
| `08.9.6-h` | Settings ekranı — IP allowlist bölümü + oturum politikası formu | `SONNET-XHIGH` | 08.9.6-d, 08.9.6-f | 1 |
| `08.9.6-i` | Uçtan uca doğrulama — E2E akışı, audit görünürlüğü, proxy-IP davranışı ve istek başına maliyet… | `OPUS-XHIGH` | 08.9.6-d, 08.9.6-e, 08.9.6-g, 08.9.6-h | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** Üç alt-görev bölünmez güvenlik/eşzamanlılık çekirdeğidir ve daha küçüğe ayrılmaz: (1) 08.9.6-c — CIDR/IP eşleştirme algoritması + izin/ret semantiği: bir bit-maske hatası ya bypass (yanlış izin) ya da tüm ajanların kilitlenmesi (yanlış ret) demek; parse, eşleştirme ve "boş liste ne demek" kararı aynı bağlamda kalmalı. (2) 08.9.6-e — enforcement noktası: plugins/auth.ts:130-207 her kimlikli isteğin geçtiği tek çıkış kapısı; hangi principal türünün muaf olduğu, server.ts:97 trustProxy:true yüzünden request.ip'nin X-Forwarded-For ile taklit edilebilir olması ve kontrolün sırası tek bir akıl yürütmedir — parçalanırsa kontrol sessizce anlamsızlaşır. (3) 08.9.6-g — oturum politikası enforcement: token geçerlilik semantiğini değiştirmek authN sınırıdır ve eşzamanlı oturum limiti touch() fire-and-forget yazımı ile resolve() okuması arasındaki yarışı + toplu revoke invariant'ını birlikte ele…

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (13)
  - BOŞ ALLOWLIST = HERKESE İZİN. Kayıt yokken hiçbir kısıt uygulanmaz. Gerekçe: olgularda saptanan self-lockout riski ('boş liste izinli mi engelli mi netleşmeden…
  - CIDR DESTEKLENİR. Bir kayıt tekil IPv4/IPv6 adresi ya da CIDR aralığıdır (tekil adres /32 ya da /128 gibi davranır). PRD yalnız 'IP kısıtı' diyor; ofis/VPN aralıkları…
  - ENFORCEMENT NOKTASI: HER KİMLİKLİ İSTEK, LOGIN DEĞİL. Kontrol plugins/auth.ts onRequest hook'unda agent/PAT/bot principal'ları için çalışır; public:true uçlar…
  - MÜŞTERİ/WIDGET YÜZEYİ MUAF. principal.kind === 'customer' istekleri IP allowlist'e tabi değildir; o yüzeyin IP denetimi FR-MOD-08.9.2'nin deny-list'idir…
  - OTURUM IP'YE BAĞLANMAZ (session-to-IP binding YOK). Login sonrası IP değişimi oturumu sonlandırmaz; yalnız o anki isteğin adresi allowlist'e göre değerlendirilir.…
  - SELF-LOCKOUT GUARD YAZMA TARAFINDA. Kısıt açıkken (veya ilk kayıt eklenirken) çağıranın kendi adresini kapsamayan bir yapılandırma 400 validation ile reddedilir. PRD'de…
  - _…+7 madde daha — tam metin companion dosyada_

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (6)
  - PLAN ÇELİŞKİSİ: IP allowlist hangi plan(lar)da aktif olacak? PRD §5.3 (satır 413) 'Güvenlik | IP allowlist, CC masking, banned customers, spam, temel audit log (tüm…
  - OWNER/ADMIN İÇİN ACİL KURTARMA YOLU: allowlist enforcement owner rolünü de kapsasın mı, yoksa owner her zaman muaf mı kalsın? Muafiyet self-lockout'a karşı ikinci bir…
  - İHLAL DAVRANIŞI: allowlist dışı bir adresten gelen istekte yalnız o istek mi reddedilsin (şu anki varsayım), yoksa ilgili token da revoke mü edilsin? Revoke, VPN kopması…
  - IDLE TIMEOUT VARSAYILANI: PRD hiçbir süre vermiyor. Varsayılan null (kapalı) mı kalsın, yoksa NFR-S2'nin 'access token TTL ≤1 saat' hedefiyle uyumlu bir varsayılan (ör.…
  - WIDGET/MÜŞTERİ MUAFİYETİ: PRD'nin 'IP kısıtı' ifadesi yalnız agent/admin panelini mi kastediyor? NFR-C11 (regüle dikey: 'IP allowlist; CC masking; audit') müşteri…
  - RTM (WebSocket) YÜZEYİ: apps/rtm bağlantıları da allowlist'e tabi olacak mı? Bu kırılım yalnız apps/api HTTP yüzeyini kapsıyor; RTM el sıkışması ayrı bir enforcement…

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.10**

#### 5.2.11 · Temel audit log TÜM PLANLARDA (+ kullanıcıya görünür audit ekranı) — NFR-S12

**11 atomik alt-görev · ~14 pencere** — `OPUS-MAX` ×2 · `OPUS-XHIGH` ×3 · `SONNET-XHIGH` ×6

**KK (PRD birebir):** _"Temel audit (login, rol değişimi, veri silme, webhook değişimi, son 30 gün) tüm planlarda"_ · _"KK3: Audit log (login, rol değişimi, veri silme, webhook değişimi) tutulur (§7). — kaynak: US-11, satır 325"_ · _"genişletilmiş + SIEM Enterprise"_

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `08.9.7-a` | Audit log okuma kontratı + audit_log--all:ro scope'u + GET /audit-log (keyset, son 30 gün… | `OPUS-XHIGH` | yok | 2 |
| `08.9.7-b` | Audit liste filtreleri: eylem, aktör ve tarih aralığı (katkısal sorgu parametreleri) | `SONNET-XHIGH` | 08.9.7-a | 1 |
| `08.9.7-c` | Webhook değişimi audit'i: webhook.created / webhook.deleted eylemleri | `OPUS-XHIGH` | yok | 1 |
| `08.9.7-d` | data.deleted eylemi + ayarlar ailesi hedefli silmelerinde audit | `SONNET-XHIGH` | 08.9.7-c | 1 |
| `08.9.7-e` | İçerik ve entegrasyon silme uçlarında data.deleted audit'i | `SONNET-XHIGH` | 08.9.7-d | 1 |
| `08.9.7-f` | Rol değişimi ucu (PUT /agents/{agentId}/role) + member.role_changed audit'i | `OPUS-MAX` | 08.9.7-c | 2 |
| `08.9.7-g` | Retention politikasına audit penceresi (RETENTION_AUDIT_DAYS=30) — politika/env/rapor iskeleti | `SONNET-XHIGH` | yok | 1 |
| `08.9.7-h` | Append-only log'da süreli budama: audit_prune_expired SECURITY DEFINER + retention sweep… | `OPUS-MAX` | 08.9.7-g | 2 |
| `08.9.7-i` | Audit Log ekranı: salt-okunur liste + boş/skeleton/hata durumları + Settings girişi | `SONNET-XHIGH` | 08.9.7-a | 1 |
| `08.9.7-j` | Audit ekranı filtreleri (eylem/tarih) + 'daha fazla yükle' + e2e görünürlük | `SONNET-XHIGH` | 08.9.7-b, 08.9.7-i | 1 |
| `08.9.7-k` | NFR-S12 uçtan uca doğrulama: dört olay + 30 gün penceresi + 'tüm planlarda' kanıtı | `OPUS-XHIGH` | 08.9.7-b, 08.9.7-c, 08.9.7-e, 08.9.7-f, 08.9.7-h, 08.9.7-j | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** İki alt-görevin çekirdeği bölünmez. (1) 08.9.7-f — rol değişimi ucu: yetki yükseltme (privilege escalation) sınırı tek bir akıl yürütmeyle kurulur — aktörün rolü, hedefin rolü, kendi rolünü değiştirme yasağı, owner'ın korunması ve son-owner invaryantı aynı bağlamda birlikte düşünülmezse kapı yarım kapanır; agents.ts:161-231'deki suspension guard'larının aynısı burada rol için kurulmalı. (2) 08.9.7-h — append-only budama: audit_log'da UPDATE/DELETE nexa_app rolünden REVOKE edilmiş (migration 20260722154008:1005-1006) ve RLS'te yalnız SELECT/INSERT politikası var; 30 günlük pencere ancak dar bir SECURITY DEFINER fonksiyonla (retention_list_tenants() deseni) uygulanabilir. Fonksiyonun imzası, yaş yüklemi, lisans parametresi, GRANT/REVOKE'u ve "tablo DELETE yetkisi asla verilmez" kararı tek karardır; parçalanırsa append-only invaryantına açılan deliğin sınırı kaybolur. Bu iki çekirdeğin…

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (11)
  - Scope adı `audit_log--all:ro` olacak. Kaynak olgulardaki `audit_log--all:r` önerisi kullanılamaz: packages/types/src/scopes.ts'teki expandScope regex'i izin ekini…
  - Audit okuma yetkisi Owner/Admin ile sınırlı: route'ta scope (`audit_log--all:ro`) + `minimumRole: 'admin'` çift kapısı. PRD KK'sı okuma yüzeyini tanımlamıyor; karar…
  - 'Son 30 gün' hem SAKLAMA süresi hem liste varsayılan penceresi olarak yorumlandı: 30 günden eski satırlar budanır (08.9.7-h) ve filtresiz liste son 30 günü döner…
  - 'genişletilmiş + SIEM Enterprise' bu turda YAPILMIYOR. Repoda plan/entitlement mekanizması hiç yok (grep 'entitlement|planGate|requirePlan' → 0); plan bazlı farklı…
  - 'Tüm planlarda' için KALDIRILACAK bir kapı yok — kapı hiç kurulmamış (schema.prisma AuditLogEntry yorumu bunu açıkça söylüyor). Dolayısıyla iş 'kapıyı kaldırmak' değil,…
  - 'Rol değişimi' olayını kaydedebilmek için önce olayın kendisi gerekiyor: depoda rol değiştiren hiçbir uç yok, o yüzden 08.9.7-f minimal bir `PUT /agents/{agentId}/role`…
  - _…+5 madde daha — tam metin companion dosyada_

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (5)
  - 08.9.7-f (rol değişimi ucu, OPUS-MAX, 2 pencere) bu kalemin kapsamında mı kalmalı, yoksa MOD-04 (Team) altına ayrı bir kalem olarak mı taşınmalı? Orkestratörün bağlayıcı…
  - 'Son 30 gün' gerçekten SİLME mi olmalı, yoksa yalnız görüntüleme penceresi mi? Silme, append-only invaryantına kontrollü bir delik açıyor (08.9.7-h: SECURITY DEFINER +…
  - Enterprise payı ('genişletilmiş saklama + export + SIEM') hangi faza yazılacak? Uygulanabilmesi için önce bir entitlement/plan-gate mekanizması gerekiyor ve repoda hiç…
  - `data.deleted` tek eylemi mi, yoksa uç başına ayrı eylem adları mı (`website.deleted`, `skill.deleted`, `tag.deleted` …)? Tek eylem sözlüğü küçük tutuyor ama…
  - Audit ekranı Settings altında mı kalmalı, yoksa güvenlik/uyumluluk yüzeyi büyüdükçe kendi modül rayı girdisine mi taşınmalı (components/navigation.ts MODULES)? Bu turda…

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.11**

#### 5.2.12 · 100+ entegrasyon — marketplace katalog genişlemesi + ölçeklenme kanıtı (arama/kategori/sayfalama/virtualization)

**8 atomik alt-görev · ~8 pencere** — `OPUS-XHIGH` ×3 · `SONNET-MAX` ×2 · `SONNET-XHIGH` ×3

**KK (PRD birebir):** _"kategori/ödeme/yerleşim filtreleri + arama"_ · _"virtualized grids (Contacts/Teammates/Skills/Tickets/Knowledge/Apps/Campaigns), infinite scroll, skeleton, anlamlı empty state | ... 10.000+ satırda 60fps"_ · _"kanal-tipli olanlar Channels'ta da yönetilir"_ · _"Her biri OAuth/API key"_ · _"NFR-P4 | Liste render (virtualization) | 10.000+ satırda 60 fps; yalnız görünür satır DOM'da"_

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `09.2-v2-a` | Marketplace liste kontratı — arama/kategori/sayfalama parametreleri + sayfalama meta alanları | `SONNET-XHIGH` | yok | 1 |
| `09.2-v2-b` | Saf katalog filtre + sayfalama fonksiyonları (@nexa/types) + determinizm testleri | `SONNET-XHIGH` | yok | 1 |
| `09.2-v2-c` | GET /settings/apps sorgu bağlama — zod parse + sayfalama + tenant join korunumu | `OPUS-XHIGH` | 09.2-v2-a, 09.2-v2-b | 1 |
| `09.2-v2-d` | Katalog verisi 20 → 60 kart (mock, mevcut 8 kategori) + üst-sınır iddialarının kaldırılması | `SONNET-MAX` | yok | 1 |
| `09.2-v2-e` | Katalog verisi 60 → 100+ kart + "100+" hedefinin testle sabitlenmesi | `SONNET-MAX` | 09.2-v2-d | 1 |
| `09.2-v2-f` | Marketplace arama kutusu + tıklanabilir kategori filtresi + empty/skeleton durumları | `SONNET-XHIGH` | 09.2-v2-c | 1 |
| `09.2-v2-g` | Virtualized kart grid'i + sayfa zinciri (NFR-P4 "yalnız görünür satır DOM'da") | `OPUS-XHIGH` | 09.2-v2-f, 09.2-v2-e | 1 |
| `09.2-v2-h` | Uçtan uca doğrulama — 100+ katalogla e2e + NFR-P4 ölçüm notu + izolasyon/kontrat regresyonu | `OPUS-XHIGH` | 09.2-v2-c, 09.2-v2-e, 09.2-v2-g | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** Bu kalemde OPUS-MAX gerektiren, bölünemeyen bir güvenlik/algoritma çekirdeği YOK. Mevcut yetki modeli (route scope kapısı `access_rules:ro/rw`, in-chat okuma `chats--all:ro`/`chats--access:ro`) ve tenant izolasyonu (`request.withTenant` + `app_installations` license-scoped `@@unique(licenseId, appId)`) genişletilmiyor — yalnız korunuyor. Katalog tenant-bağımsız statik veri olduğu için arama/kategori filtresi izolasyon sınırına hiç dokunmuyor. En yüksek iki yüzey: (1) `09.2-v2-c` — tenant-scoped `GET /settings/apps` yanıtının kesiti ve katalog⋈kurulum join sırası değişiyor + input uzunluk sınırı konuyor → hafif güvenlik dokunuşu, kullanıcı kuralı gereği SONNET'e verilmez, OPUS-XHIGH; (2) `09.2-v2-g` — depoda çok-sütunlu grid virtualization deseni olmadığı için yeni UI kompozisyon kararı → OPUS-XHIGH. Kalan altı alt-görev (kontrat satırı, saf fonksiyon, katalog verisi ×2, filtre UI'ı)…

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (8)
  - Kategori enum'u 8 değerde SABİT kalır (crm/support/ecommerce/payments/marketing/productivity/analytics/channels) — 100+ kart bu 8 kategoriye dağıtılır. Gerekçe: enum…
  - Katalog DB'ye TAŞINMAZ — statik TS dizisi (`@nexa/types/apps.ts` APP_CATALOG) kalır, Prisma migration YOK. Gerekçe: `AppInstallation` (schema.prisma satır 1287) yalnız…
  - Yeni KANAL-TİPLİ kart EKLENMEZ — mevcut 5 kanal kartı (whatsapp/messenger/instagram/telegram/twilio-sms) aynen korunur, eklenen 80+ kartın hepsi veri app'idir. Gerekçe:…
  - Filtreleme/sayfalama SERVER-SIDE yapılır (customers.ts deseni), client-side değil. Gerekçe: 100+ kartın tek yanıtta dönmesi yanıt boyutunu ve ilk render maliyetini…
  - Sayfalama cursor'ı katalog kart id'si üzerinden kurulur (deterministik, tenant-bağımsız); cursor'a HİÇBİR tenant/lisans verisi girmez.
  - '100+' hedefi test eşiğiyle sabitlenir: `APP_CATALOG.length >= 100`, üst sınır YOK. v1'in `toBeLessThanOrEqual(20)` üst sınırı (apps.test.ts:40 ve integration…
  - _…+2 madde daha — tam metin companion dosyada_

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (4)
  - 100+ kartın isimleri GERÇEK marka adları mı (Notion/Asana/Zapier/Airtable...) yoksa jenerik mock isimler mi olsun? Mevcut 20 kart gerçek marka adı taşıyor…
  - Kategori enum'u 8'de mi kalsın (varsayım 1)? 100+ kartlık bir dizinde 12-15 kategori kullanıcı deneyimi açısından daha doğal olabilir; genişletilecekse openapi enum +…
  - `limit` varsayılanı customers.ts emsalinde 25; kart grid'i için 25 düşük kalabilir (ekranda ~12-16 kart). Varsayılan 48/60 mi olsun, max 100 mü kalsın?
  - 09.4 (Zapier/Make + Build-your-app, '700+ Zapier' katalog/desen kanıtı) ile 09.2-v2 aynı APP_CATALOG'u mu paylaşacak, yoksa ayrı bir partner dizini mi olacak? Aynı…

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.12**

#### 5.2.13 · API istek paketleri (Essential/Pro/Pro+) — mock satın alma, gerçek kota artışı

**8 atomik alt-görev · ~9 pencere** — `OPUS-MAX` ×1 · `OPUS-XHIGH` ×3 · `SONNET-XHIGH` ×4

**KK (PRD birebir):** _"Fiyatlı API paketleri satışı"_

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `09.3-a` | Statik API paket kataloğu + tipleri (@nexa/types) | `SONNET-XHIGH` | — | 1 |
| `09.3-b` | api_package_purchases tablosu: Prisma modeli + migration + RLS politikası | `OPUS-XHIGH` | 09.3-a | 1 |
| `09.3-c` | Okuma yüzeyi: GET /billing/api-packages (katalog) + GET /billing/api-packages/purchases +… | `OPUS-XHIGH` | 09.3-a, 09.3-b | 1 |
| `09.3-d` | Paket satın alma çekirdeği: POST /billing/api-packages + atomik kota artışı (mock ödeme,… | `OPUS-MAX` | 09.3-a, 09.3-b, 09.3-c | 2 |
| `09.3-e` | Satın alınan paketin fatura satır kalemi (invoice line_item) | `SONNET-XHIGH` | 09.3-d | 1 |
| `09.3-f` | Billing ekranında API paketleri bölümü: kartlar + mock satın alma akışı | `SONNET-XHIGH` | 09.3-c, 09.3-d | 1 |
| `09.3-g` | Satın alma geçmişi listesi (UI) + empty state | `SONNET-XHIGH` | 09.3-c, 09.3-f | 1 |
| `09.3-h` | Uçtan uca doğrulama: satın alma → kota artışı → geçmiş → fatura (E2E + seed) | `OPUS-XHIGH` | 09.3-e, 09.3-f, 09.3-g | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** 09.3-d (paket satın alma çekirdeği) bölünmez. Üç sınır tek akıl yürütmede birleşiyor: (1) yetkilendirme — BILLING_WRITE_SCOPES + read-only lisansta yazılabilirlik kararı (allowWhenReadOnly, subscription PATCH/payment-method PUT ile aynı gerekçe zinciri), (2) tenant izolasyonu — satın alma license_id'ye bağlanır ve kota AYNI lisansın usage_record'ına yazılır, (3) eşzamanlılık — kota artışı ile eşzamanlı gelen recordApiCall aynı (license_id, metric, period) benzersiz satırında yarışır. metering.ts:117 recordApiCall'ın ON CONFLICT'i `included`'a DOKUNMUYOR (yalnız quantity+1); satın almanın ON CONFLICT'i bu yüzden `included = usage_records.included + quota` olmak ZORUNDA — VALUES'taki hesaplanmış değeri yazarsa dönemin ilk API çağrısı ile satın alma sırasına göre kota sessizce kaybolur veya çift eklenir. Bu üç şeyi ayrı pencerelere bölmek, upsert'ün doğruluğunu kanıtlayan bağlamı…

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (9)
  - Paket = TEK SEFERLİK top-up (abonelik/otomatik yenileme DEĞİL). PRD satır 666 yalnız 'Fiyatlı API paketleri satışı' diyor; yenileme, iptal veya dönemsel tahsilat…
  - Satın alınan kota, satın alındığı DÖNEMİN usage_records.included değerine eklenir; dönem devri (rollover) YOK. Gerekçe: usage_records (license_id, metric, period)…
  - Katalog KOD-İÇİ statik kalır (packages/types, APP_CATALOG deseni); DB'de paket katalog tablosu AÇILMAZ. Fiyat/kota değişimi bir kod değişimidir. Gerekçe: ADR-13 mock…
  - Pro+ paketinin kotası ve fiyatı TÜRETİLDİ (1.000.000 çağrı / $249.99). PRD satır 666'nın Kaynak sütunu 'Essential 100K $29.99, Pro/Pro+ 500K $149.99' diyerek iki paketi…
  - Ödeme tamamen MOCK: satın alma PaymentMethod kaydına dokunmaz, kart çekilmez, dış servis çağrılmaz ve kayıtlı ödeme yöntemi ZORUNLU TUTULMAZ. Kayıtlı kart şartı konsaydı…
  - Yeni ApiError tipi EKLENMEZ: bilinmeyen paket → not_found, geçersiz gövde → validation, scope eksikliği → authorization. Gerekçe: bu depoda yeni tip eklemek errors.ts'te…
  - _…+3 madde daha — tam metin companion dosyada_

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (7)
  - Pro+ paketinin kotası ve fiyatı nedir? PRD satır 666 'Pro/Pro+ 500K $149.99' diyerek iki paketi tek rakama bağlıyor; v2-derin-analiz dosyalarında doğrulama yok.…
  - Satın alınan kota dönem sonunda yanar mı, yoksa bir sonraki döneme devreder mi (rollover)? Varsayım: yanar (dönem-bazlı). Devir istenirse usage_records'a yeni bir…
  - Satın alma öncesi kayıtlı bir ödeme yöntemi zorunlu mu? Varsayım: hayır (mock). Zorunlu olursa 09.3-d'ye yeni bir reddetme dalı ve muhtemelen yeni ApiError tipi girer…
  - Paketler tek seferlik mi, otomatik yenilenen abonelik mi? Yenilemeli olursa zamanlayıcı (ChatTimeoutSweeper benzeri bir job), iptal endpoint'i ve dönem geçişinde…
  - İptal/iade politikası var mı? Kota geri alınabilir mi? Geri alma, usage_records.included'ı AZALTMA anlamına gelir ve kullanılmış kotanın altına düşme riski (negatif…
  - Bu kalem PRD'de 'Could (v2)' ve KK yetersiz (tek satırlık genel ifade); rapor-1-fonksiyonel.md'de [MOD-09.3] alt bölümü yok (grep 0) ve rakamların kaynağı doğrulanmamış.…
  - _…+1 madde daha — tam metin companion dosyada_

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.13**

#### 5.2.14 · Zapier/Make + Build-your-app (partner/creator portalı) — atomik kırılım

**7 atomik alt-görev · ~8 pencere** — `OPUS-MAX` ×1 · `OPUS-XHIGH` ×2 · `SONNET-XHIGH` ×4

**KK (PRD birebir):** _"700+ Zapier"_ · _"partner/creator portalı"_

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `09.4-a` | Zapier + Make marketplace kartları ve katalog sınır güncellemesi | `SONNET-XHIGH` | yok | 1 |
| `09.4-b` | Entegrasyon manifesti (trigger + action kataloğu): kontrat + statik endpoint | `SONNET-XHIGH` | yok | 1 |
| `09.4-c` | Partner app kaydı çekirdeği: oauth_clients self-servis CRUD (client_id / secret_hash /… | `OPUS-MAX` | yok | 2 |
| `09.4-d` | Partner app secret rotate + denetim izi (partner_app.* audit olayları) | `OPUS-XHIGH` | 09.4-c | 1 |
| `09.4-e` | Developer portal kabuğu: partner app listesi + kayıt formu + 'secret bir kez' paneli | `SONNET-XHIGH` | 09.4-c | 1 |
| `09.4-f` | Portal'da Zapier REST Hooks yüzeyi: webhook aboneliği yönetimi + trigger manifesti + secret… | `SONNET-XHIGH` | 09.4-b, 09.4-d, 09.4-e | 1 |
| `09.4-g` | Uçtan uca partner akışı doğrulaması: kayıtlı client ile OAuth 2.1 authorize→token +… | `OPUS-XHIGH` | 09.4-c, 09.4-d, 09.4-e, 09.4-f | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** 09.4-c (partner app kaydı çekirdeği) bölünmez. Üç kısıt tek bağlamda tutulmak zorunda: (1) üretilen secret'ın saklanma formatı `hashToken(secret)` olmak ZORUNDA çünkü mevcut `OauthService.#authenticateClient` (apps/api/src/services/auth/oauth-service.ts:328-340) `constantTimeEqual(hashToken(clientSecret), client.secret_hash)` ile doğruluyor — format ayrı pencerede kararlaştırılırsa üretilen client `/auth/token` akışında sessizce çalışmaz; (2) `redirect_uris` kayıt-anı doğrulaması, `OauthService.isRegisteredRedirect` (oauth-service.ts:130-140) TAM EŞLEŞME beklediği için normalize etmemek zorunda — doğrulama ile eşleştirme aynı akıl yürütmenin iki ucu; (3) scope daraltma (kaydeden principal'ın sahip olmadığı scope client'a verilemez) + org-scoped RLS izolasyonu (404, 403 değil) aynı route'ta karar veriliyor. Bu üçü ayrılırsa open-redirect / yetki genişlemesi / sessiz kimlik doğrulama…

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (9)
  - KK YORUMU (kk_yetersiz=true): '700+ Zapier' inşa edilebilir bir kabul kriteri değildir — Zapier'in kendi ekosistemindeki app sayısını ifade eder. Kilitli yorum: Nexa 700…
  - SCOPE KARARI: partner app yönetimi için YENİ OAuth scope EKLENMEZ; mevcut `access_rules:ro`/`access_rules:rw` yeniden kullanılır (routes/apps.ts:45,55 ile aynı yönetici…
  - KATALOG SINIRI SAPMASI: FR-MOD-09.2 KK'sı 'Tam entegrasyon listesi (15–20 kart)' diyor ve iki test bu sınırı kilitliyor (packages/types/src/apps.test.ts:39-40,…
  - MODELLEME: Zapier ve Make, APP_CATALOG'un mevcut ikili bölünmesini (channel app / data app) bozmamak için DATA app olarak modellenir (dataLabel + dataFields dolu).…
  - PARTNER APP KAYDI KİMLİK DOĞRULAMALIDIR: RFC 7591 tarzı kimliksiz/dinamik client kaydı AÇILMAZ. Kayıt daima oturum açmış ve `access_rules:rw` taşıyan bir yönetici…
  - REDIRECT_URI POLİTİKASI: yalnız mutlak `https` URI'ler kabul edilir; tek istisna geliştirme için `http://localhost` ve `http://127.0.0.1`. Wildcard, fragment ve gömülü…
  - _…+3 madde daha — tam metin companion dosyada_

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (5)
  - Kaynak izlenebilirliği kırık: PRD satır 667'nin Kaynak sütunu 'v2-05' dosyasına atıf yapıyor ama depoda böyle bir dosya yok (find → 0) ve v2-derin-analiz/01-04…
  - Partner app yönetimi için `access_rules:rw` yeniden kullanımı onaylanıyor mu, yoksa ayrı bir `oauth_clients--all:ro/:rw` scope çifti mi isteniyor? Ayrı scope,…
  - APP_CATALOG'un 15–20 üst sınırının 22'ye çıkarılması (FR-MOD-09.2 KK'sından sapma) kabul mü, yoksa Zapier/Make ayrı bir `AUTOMATION_CATALOG` sabitinde mi tutulsun?…
  - Portal'da PAT (personal access token) üretme ekranı bu kaleme dahil edilsin mi? API tam olarak mevcut (apps/api/src/routes/auth.ts:396-500: list/create/revoke,…
  - WEBHOOK_ACTIONS bugün 5 aksiyon (chat_started, chat_deactivated, chat_transferred, event_created, ticket_created). Zapier/Make için anlamlı trigger yelpazesi bu 5'le…

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.14**

#### 5.2.15 · ⌘K command palette — aksiyon + AI sorgusu sonuç tipleri (v2 payı)

**8 atomik alt-görev · ~8 pencere** — `OPUS-MAX` ×1 · `OPUS-XHIGH` ×3 · `SONNET-XHIGH` ×4

**KK (PRD birebir):** _"3 sonuç tipi: aksiyon ("Stop Accepting Chats"), navigasyon, AI sorgusu ("Summarize my team's activity…")"_ · _"Search Text or go to…"_ · _"klavye ↑↓/esc"_

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `01.1.3-ai-a` | Statik aksiyon kataloğu (`actions.ts`) + `PaletteResult` birleşik tipi | `SONNET-XHIGH` | — | 1 |
| `01.1.3-ai-b` | Aksiyon sonuç tipinin scope kapısı — yetkisi olmayan aksiyon palette GÖRÜNMEZ | `OPUS-XHIGH` | 01.1.3-ai-a | 1 |
| `01.1.3-ai-c` | Aksiyon tetikleme — `run()` bağlama + optimistic durum + hata geri alma | `OPUS-XHIGH` | 01.1.3-ai-b | 1 |
| `01.1.3-ai-d` | Kontrat: `POST /palette/ai-query` + bundle + tip üretimi | `SONNET-XHIGH` | — | 1 |
| `01.1.3-ai-e` | AI sorgu endpoint'i — scope kapısı + tenant izolasyonu + deterministik cevap (reports… | `OPUS-MAX` | 01.1.3-ai-d | 2 |
| `01.1.3-ai-f` | Palette'te AI sorgu sonuç tipi + cevap kartı + boş/anlaşılmadı durumları | `SONNET-XHIGH` | 01.1.3-ai-e | 1 |
| `01.1.3-ai-g` | Klavye/a11y: ↑↓/esc üç sonuç tipinde de tutarlı (NFR-A11Y6 regresyonu) | `SONNET-XHIGH` | 01.1.3-ai-c, 01.1.3-ai-f | 1 |
| `01.1.3-ai-h` | Uçtan uca doğrulama + kapanış: tam DoD, e2e, PLAN/HANDOFF izleri | `OPUS-XHIGH` | 01.1.3-ai-c, 01.1.3-ai-f, 01.1.3-ai-g | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** Bölünemez çekirdek YOK — bu kalemde tek güvenlik sınırı 'aksiyon sonuç tipinin scope kapısı' (01.1.3-ai-b) ve o tek başına tutarlı bir akıl yürütmedir: katalog verisi (-a), tetikleme (-c) ve AI yolu (-d/-e/-f) ondan ayrılabilir. Yine de -b ve -c ARDIŞIK yapılmalıdır: kapı olmadan tetikleme yazılırsa, yetkisiz aksiyon UI'da gizlenmemiş hâlde tetiklenebilir hâle gelir ve testler bunu yakalamaz (endpoint 403 döner ama palet yanlış bir eylem sunmuş olur).

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (4)
  - AI sorgusu YENİ bir endpoint ister (POST /palette/ai-query); mevcut /copilot/* uçları chat bağlamına bağlıdır (chatId alır), palet ise chat bağlamsızdır. Copilot'un BI…
  - AI cevabı DETERMİNİSTİKTİR — @nexa/ai-mock üzerinden (ADR: dış LLM yok). Cevap serbest metin üretmez; mevcut reports sorgularından sayısal özet + kaynak metrik adı…
  - Aksiyon kataloğu STATİKTİR (frontend'de `actions.ts`), NAV_DESTINATIONS deseninin ikizi. Backend'de 'aksiyon kataloğu' endpoint'i AÇILMAZ — her aksiyon zaten kendi…
  - İlk aksiyon seti PRD'nin somut örneğiyle sınırlı tutuldu: 'Stop/Start Accepting Chats' (PATCH /agents/me/routing-status). Katalog genişletilebilir bırakıldı ama bu turda…

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (2)
  - Palet AI sorgusu hangi scope'u istemeli — yalnız `reports_read` mi, yoksa ayrı bir `palette_ai` scope'u mu? Şu anki tasarım: mevcut `reports_read` yeniden kullanılır…
  - Aksiyon kataloğu ileride kullanıcı tanımlı olabilir mi (ör. bir skill'i palete pinlemek)? Şu an statik; kontrat yüzeyi açılmadı.

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.15**

#### 5.2.16 · Copilot BI komut — rapor/metrik sorusu → deterministik cevap (§5.5 MOD-12 v2)

**6 atomik alt-görev · ~7 pencere** — `OPUS-MAX` ×1 · `OPUS-XHIGH` ×2 · `SONNET-XHIGH` ×3

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `12.4-bi-a` | Kontrat: `POST /copilot/bi` anchor'ı + bundle + tip üretimi | `SONNET-XHIGH` | — | 1 |
| `12.4-bi-b` | `@nexa/ai-mock`'ta soru → rapor metriği eşleyici (deterministik, LLM yok) | `OPUS-XHIGH` | — | 1 |
| `12.4-bi-c` | BI endpoint çekirdeği — scope birleşimi + müşteri-token sınırı + tenant izolasyonu + ADR-09… | `OPUS-MAX` | 12.4-bi-a, 12.4-bi-b | 2 |
| `12.4-bi-d` | CopilotPanel'de BI soru girişi + cevap kartı | `SONNET-XHIGH` | 12.4-bi-c | 1 |
| `12.4-bi-e` | Anlaşılmadı / yetersiz veri durumları — anlamlı empty state + örnek sorular | `SONNET-XHIGH` | 12.4-bi-d | 1 |
| `12.4-bi-f` | Uçtan uca doğrulama + ADR-09 çapraz kontrolü + kapanış | `OPUS-XHIGH` | 12.4-bi-d, 12.4-bi-e | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** **12.4-bi-c bölünmez.** BI endpoint'inin çekirdeğinde üç sınır aynı anda karar bekliyor: (a) **scope birleşimi** — BI cevabı rapor verisi taşıdığı için `reports_read` gerekir, ama uç Copilot domain'inde; hangi scope kombinasyonunun isteneceği tek bir yetkilendirme kararıdır; (b) **müşteri token'ına kapalılık** (agent+bot principals, 404 boundary — copilot.ts'in mevcut I4 deseni) ve **cross-tenant izolasyon**; (c) **ADR-09 tutarlılığı** — uç kendi SQL'ini YAZMAMALI, mevcut reports sorgularını çağırmalıdır; aksi hâlde 'Copilot 12 diyor, Reports 11 diyor' sınıfı bir sapma doğar ve bu testlerde kolayca gözden kaçar. Bu üçü ayrı pencerelere bölünürse, scope'u yazan pencere ADR-09'u, ADR-09'u yazan pencere sınır davranışını görmez. Çevresindeki her şey (kontrat, niyet eşleyici, UI, empty state) AYRI ve daha ucuz alt-görevlere çıkarıldı.

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (4)
  - KK-türetilmiş: PRD'de bu kalem için ayrı FR-MOD satırı YOK — yalnız §5.5 matrisinde MOD-12'nin v2 hücresinde '○ (BI komut)' var ve §5.3 faz başlığı 'Copilot BI' diyor.…
  - BI komutu CHAT BAĞLAMLIDIR (mevcut /copilot/* uçları gibi chatId alır veya hesap geneli çalışır); hesap/takım geneli bağlamsız sorgu ⌘K paletinin işidir (01.1.3-ai). İki…
  - Cevap DETERMİNİSTİKTİR: @nexa/ai-mock niyeti çözer, sayıyı mevcut reports sorgusu üretir. Serbest metin üretimi YOK — 'uydurulmuş sayı' sınıfı yapısal olarak imkânsız.
  - Yeni ApiError tipi AÇILMAZ: anlaşılmayan soru / yetersiz veri 200 + kind alanı ile döner (errors.ts ×2 + scopes.test.ts sayacı + openapi enum + regen tuzağı).

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (2)
  - BI komutu hangi scope'u istemeli: yalnız `reports_read` mi, Copilot'un mevcut scope'u + `reports_read` birleşimi mi? Tasarım tercihi: birleşim (en dar yetki), ama ürün…
  - Hangi metrik seti ilk turda desteklensin? Şu an /reports/overview'ın KPI'ları hedeflendi (chats, closed, çözüm split'i, CSAT). Breakdown boyutları (07.5) indikten sonra…

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.16**

#### 5.2.17 · Skill şablon kataloğunu 31+'a genişlet (ADR-14 uyumlu ikame)

**5 atomik alt-görev · ~6 pencere** — `SONNET-MAX` ×1 · `SONNET-XHIGH` ×4

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `05.6-tmpl31-a` | Katalog şeması genişletme: rozet alanı (Popular/Essential) + invariant testlerinin… | `SONNET-XHIGH` | — | 1 |
| `05.6-tmpl31-b` | 23+ yeni şablon kaydı — katalog 8 → 31+ | `SONNET-MAX` | 05.6-tmpl31-a | 2 |
| `05.6-tmpl31-c` | Katalog i18n: şablon metinleri TR/EN (NFR-I18N2) | `SONNET-XHIGH` | 05.6-tmpl31-b | 1 |
| `05.6-tmpl31-d` | Galeri ölçek davranışı: arama + kategori filtresi + sanal liste (31+ kart) | `SONNET-XHIGH` | 05.6-tmpl31-b | 1 |
| `05.6-tmpl31-e` | Kapanış: tam DoD + galeri e2e regresyonu + PLAN/HANDOFF izleri | `SONNET-XHIGH` | 05.6-tmpl31-c, 05.6-tmpl31-d | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** Bölünemez çekirdek YOK — bu kalemde güvenlik sınırı, eşzamanlılık veya algoritma tasarımı bulunmuyor. Kaynak recon'un birebir tespiti: iş, `templates.ts` içindeki salt-okunur statik bir diziye kayıt eklemekten ibaret; authN/authZ, tenant izolasyonu, SSRF, kripto, rate-limit veya PII yüzeyi AÇMIYOR (katalog dış servise bağlanmıyor, kullanıcı girdisi almıyor, yeni DB/API yazma yolu eklemiyor). Bu yüzden kalemin TAMAMI `SONNET-*` etiketlidir — v2'de bu özelliğe sahip tek kalem.

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (4)
  - KK-türetilmiş: PRD §5.3 'Otomasyon' hücresi '31+ şablon' der ama aynı hücredeki görsel node/edge Workflow builder ADR-14 ile ⛔. Şablon SAYISI hedefi, ADR-14'ten bağımsız…
  - Katalog DETERMİNİSTİK ve YERELDİR (apps/web/src/features/playbook/templates.ts) — dış servis, backend route veya DB tablosu AÇILMAZ. Bu, ADR-14 ve mevcut mimariyle…
  - Hedef sayı 31+; bugünkü katalog 8 kayıt (3 prebuilt + 2 ai + 3 trending) → en az 23 yeni kayıt.
  - Yeni kayıtlar mevcut `SkillTemplate` şeklini korur (id/name/category/summary/instruction/steps/requiresIntegration) ve `templates.test.ts`'in üç mevcut invariantını…

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (3)
  - Katalog bugün tamamen İngilizce ve `apps/web/src/lib/i18n.ts`'e hiç bağlı değil. NFR-I18N2 'en az TR/EN' istiyor. 23+ yeni kayıt eklemeden ÖNCE i18n'e bağlanmalı mı…
  - Kaynak recon bir kapsam boşluğu işaret etti: katalogda regüle/bahis dikeyine (KYC, para çekme, çevrim şartı, sorumlu oyun) özel TEK BİR şablon yok (grep 0). PRD satır…
  - FR-MOD-05.2 kart rozetlerinde 'Popular'/'Essential' geçiyor ama TEMPLATE_CATEGORIES yalnız 3 sabit tür tanımlıyor (prebuilt/ai/trending). Rozetler ayrı bir kategori mi…

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.17**

#### 5.2.18 · Engage / Traffic (gelişmiş) — Match all filters + Add filter, ziyaretçi 360° panel, 03.1.1 kalan sekmeler

**11 atomik alt-görev · ~13 pencere** — `OPUS-MAX` ×2 · `OPUS-XHIGH` ×4 · `SONNET-XHIGH` ×5

**KK (PRD birebir):** _"Gelişmiş filtre"_ · _"proaktif aksiyon"_ · _"ziyaretçi geçmişi"_

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `13.2-a` | TrafficActivity sözlüğünün supervised + invited ile genişletilmesi (kontrat + tip + web etiket… | `SONNET-XHIGH` | yok | 1 |
| `13.2-b` | `invited` durumu: campaign_sends'ten türetme + funnel öncelik kararı (backend) | `OPUS-XHIGH` | 13.2-a | 1 |
| `13.2-c` | `chat_supervisions` tablosu + RLS politikası + Prisma modeli (yalnız migration, route yok) | `OPUS-XHIGH` | yok | 1 |
| `13.2-d` | Supervision register/release API + yetki sınırı + heartbeat (BÖLÜNMEZ GÜVENLİK ÇEKİRDEĞİ) | `OPUS-MAX` | 13.2-c | 2 |
| `13.2-e` | `supervised` durumunun Traffic funnel'ına bağlanması + öncelik sırası | `OPUS-XHIGH` | 13.2-a, 13.2-d | 1 |
| `13.2-f` | "Match all filters + Add filter": GET /traffic çoklu-koşul filtre çekirdeği (kontrat + backend) | `OPUS-MAX` | 13.2-a, 13.2-b, 13.2-e | 2 |
| `13.2-g` | Traffic durum sekmeleri (All/Chatting/Supervised/Queued/Waiting/Invited/Browsing) + sayaç +… | `SONNET-XHIGH` | 13.2-f | 1 |
| `13.2-h` | "Match all filters + Add filter" filtre paneli UI + query builder | `SONNET-XHIGH` | 13.2-f, 13.2-g | 1 |
| `13.2-i` | CustomerDetail'e `visits_count` + `groups[]` (kontrat + servis) | `SONNET-XHIGH` | yok | 1 |
| `13.2-j` | Ziyaretçi 360° panel: N visits özeti + Came from + Groups kartları (UI) | `SONNET-XHIGH` | 13.2-i | 1 |
| `13.2-k` | Uçtan uca doğrulama: E2E (sekme + filtre + supervise + 360° panel) + NFR-P2 ölçümü + a11y… | `OPUS-XHIGH` | 13.2-a, 13.2-b, 13.2-c, 13.2-d, 13.2-e, 13.2-f, 13.2-g, 13.2-h, 13.2-i, 13.2-j | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** İki bölünmez çekirdek var. (1) **13.2-d** (supervision register/release): "kim hangi sohbeti izleyebilir" kararı (`chats--all:ro` global mi, `chats--access:ro` yalnız kendi grubunun `chat_access` üzerinden eriştiği sohbet mi), IDOR deseni (başka kiracının chatId'si → 404, 403 DEĞİL) ve iki ajanın aynı sohbeti eşzamanlı izlemesi/serbest bırakması (idempotent upsert + yalnız kendi satırını silme) tek bir akıl yürütmenin parçaları; ayrıştırılırsa "endpoint var ama yetki yarım" ara durumu doğar ve tam da orada sızıntı olur. Çekirdeğin ETRAFINDAKİ her şey ayrıştırıldı: tablo+RLS 13.2-c'ye (OPUS-XHIGH), funnel bağlama 13.2-e'ye (OPUS-XHIGH), UI 13.2-g/-h'ye (SONNET-XHIGH). (2) **13.2-f** (filtre predicate derleyicisi): istemciden gelen koşulların çok-kiracılı bir sorguya çevrilmesi — allowlist, tenant kapısı (`group_id` başka kiracıya sızmamalı) ve sorgu şekli (NFR-P2 bütçesi; Visit.pages…

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (8)
  - **Supervised kalıcı tabloyla modellenir, RTM/Redis presence ile DEĞİL.** `chat_supervisions` (chat_id, agent_id, license_id, started_at, last_seen_at) + heartbeat…
  - **Invited = `campaign_sends` satırı `engaged = false` ve canlı pencere içinde.** Yeni kolon/tablo açılmaz; CampaignSend zaten 'davet gönderildi' anlamını taşıyor…
  - **Ziyaretçi 'groups' = müşterinin bu lisanstaki sohbetlerine `chat_access` üzerinden erişen ajan grupları.** Yeni `customer_groups` segment tablosu AÇILMAZ. Gerekçe:…
  - **'Match all filters' = ayrık, AND'lenen query parametreleri** (`activity`, `page_url_contains`, `came_from_contains`, `country_code`, `is_lead`, `group_id`), JSON koşul…
  - **Funnel öncelik sırası: `queued` > `supervised` > `waiting` > `chatting`;** `invited` yalnız aktif sohbeti OLMAYAN ziyaretçide `browsing`'i ezer. Gerekçe: kuyruktaki…
  - **`page_url_contains` filtresi SQL LIKE ile DEĞİL, servisin zaten yaptığı over-fetch + JS de-dup adımında uygulanır.** Gerekçe: `visits.pages` JSONB ve üzerinde uygun…
  - _…+2 madde daha — tam metin companion dosyada_

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (4)
  - Supervision heartbeat penceresi kaç dakika olmalı? Traffic'in `LIVE_WINDOW_MINUTES = 30` sabitiyle aynı olursa bir ajanın 25 dk önce kapattığı sekme hâlâ 'Supervised'…
  - `chats--all:ro` taşıyan HER ajan her sohbeti izleyebilmeli mi, yoksa ek olarak bir rol şartı (owner/viceowner/admin) da aranmalı mı? PRD rol matrisi 'supervise' için…
  - Ziyaretçi 'groups' için varsayım 3 (chat_access'ten türetme) onaylanıyor mu, yoksa gerçekten ayrı bir `customer_groups` segment tablosu mu isteniyor? İkincisi seçilirse…
  - Filtre `group_id` parametresi, `chats--access:ro` ile sınırlı bir ajan kendi grupları dışında bir değer verdiğinde 400 mü dönmeli, yoksa sessizce boş sonuç mu? (İkisi de…

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.18**

#### 5.2.19 · 13.3 — Goals (ziyaretçi→sohbet→dönüşüm hunisi): goals tablosunu bağla + Reports "Achieved goals"

**9 atomik alt-görev · ~10 pencere** — `OPUS-MAX` ×1 · `OPUS-XHIGH` ×4 · `SONNET-XHIGH` ×4

**KK (PRD birebir):** _"hedef tanımı"_ · _"3 aşamalı huni"_ · _"rapor entegrasyonu"_

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `13.3-a` | Goal veri sözlüğü — @nexa/types tipleri + OpenAPI component şemaları (path YOK) | `SONNET-XHIGH` | — | 1 |
| `13.3-b` | goal_achievements tablosu + RLS politikası + idempotency kısıtı (Prisma migration) | `OPUS-XHIGH` | — | 1 |
| `13.3-c` | Goals CRUD — kontrat path + route + servis (license-scoped, .strict() definition) | `OPUS-XHIGH` | 13.3-a | 1 |
| `13.3-d` | Hedef eşleşme + achievement kaydı çekirdeği — idempotent tetik, ziyaretçi yazma yolu, campaign… | `OPUS-MAX` | 13.3-b, 13.3-c | 2 |
| `13.3-e` | /reports/overview "Achieved goals" sayacı (pencere + önceki pencere karşılaştırması) | `SONNET-XHIGH` | 13.3-b, 13.3-d | 1 |
| `13.3-f` | GET /reports/goals — 3 aşamalı huni raporu + rapor grubu + CSV export | `OPUS-XHIGH` | 13.3-b, 13.3-c, 13.3-d | 1 |
| `13.3-g` | Goals ekranı — liste + Create goal formu (Customers alanının 4. sekmesi) | `SONNET-XHIGH` | 13.3-c | 1 |
| `13.3-h` | 3 aşamalı huni gösterimi (Goals ekranı) + Reports Overview "Achieved goals" KPI kartı | `SONNET-XHIGH` | 13.3-e, 13.3-f, 13.3-g | 1 |
| `13.3-i` | Uçtan uca doğrulama — ziyaret→sohbet→hedef E2E + çapraz-tenant regresyon kapanışı | `OPUS-XHIGH` | 13.3-d, 13.3-e, 13.3-f, 13.3-g, 13.3-h | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** 13.3-d (hedef eşleşme + achievement kaydı çekirdeği) bölünmez. Üç akıl yürütme aynı bağlamı paylaşıyor: (1) idempotency — aynı ziyaretçi aynı hedefi iki kez tetiklememeli, kanıtı `@@unique([goalId, customerId])` + `createMany({skipDuplicates:true})`; (2) tenant izolasyonu — yazma yolu **ziyaretçi (customer principal)** tarafından tetikleniyor (customer.ts:341 `recordPageView` bloğu), yani kimliği doğrulanmış ajan değil, widget; (3) çapraz-özellik invariantı — achievement yazılınca aynı müşterinin `campaign_sends.converted` alanı güncelleniyor, bu da yalnız aynı licenseId için geçerli olmalı. Bu üçü ayrı pencerelere bölünürse "hangi koşulda satır yazılır" kararı ile "o satırın hangi lisansa ait olduğu" kararı farklı bağlamlara düşer ve izolasyon akıl yürütmesi kaybolur. Çekirdeğin ETRAFINDAKİ her şey ayrı ve daha ucuz etikete çıkarıldı: migration+RLS 13.3-b (OPUS-XHIGH), CRUD 13.3-c…

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (8)
  - `goal_achievements` YENİ bir tablodur ve PRD §8.4'e EK'tir (çelişki değil). Gerekçe: PRD §8.4 (satır 960) yalnız `goals`(`id`,`license_id`,`name`,`definition`,`active`)…
  - `Goal.definition` (jsonb) v1 şeması `{ url_contains?: string }` olarak sabitlenir — `Campaign.conditions` ile aynı vokabüler (campaigns.ts:22 `.strict()`). Gerekçe: PRD…
  - `campaign_sends` tablosuna `goal_id` FK EKLENMEZ. Bunun yerine achievement yazıldığında aynı müşterinin AYNI LİSANSTAKİ `campaign_sends` satırları `converted=true`…
  - Huni denominatörleri: `visitors` = pencerede ziyareti olan distinct müşteri (TENANT GENELİ), `chats` = pencerede açılan thread'lerin distinct müşterisi, `conversions` =…
  - Goals ekranı Customers alanının 4. sekmesidir (`/app/customers/goals`). Gerekçe: PRD 'Gözlem: Engage/Goals hunisi' der ama bu depoda Engage adında bir üst alan yok;…
  - Yeni scope üretilmez: Goals `customers:ro` (okuma) / `customers:rw` (yazma) taşır — campaigns.ts:4-9'daki gerekçenin aynısı (Goals de CRM/canlı panonun kapsadığı…
  - _…+2 madde daha — tam metin companion dosyada_

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (5)
  - "Achieved goals" hem `/reports/overview` KPI kartında (13.3-e) hem ayrı bir Goals rapor grubunda (13.3-f) veriliyor. Tek yer isteniyorsa 13.3-e düşülebilir (−1 pencere)…
  - `Goal.definition` v2'de sayfa URL'sinin ötesine (olay adı, satış tutarı, form gönderimi) genişleyecek mi? Plan `matchesGoal` fonksiyonunu şimdiden çok-koşullu AND olarak…
  - `campaign_sends.converted` semantiği değişiyor: bugün serbest bir boolean, bu işten sonra yalnız tanımlı bir Goal tetiklendiğinde true olacak. Mevcut Campaigns E2E/unit…
  - Huni 'visitors' denominatörü tenant geneli mi olmalı (planın seçimi) yoksa hedef bazında mı (yalnız hedefin sayfasına yakın olan ziyaretçiler)? Hedef bazında istenirse…
  - `goal_achievements` için retention/PII politikası gerekiyor mu? Satır `customer_id` taşıyor; `visits` tablosu NFR-S9 retention politikasına tabi (schema.prisma yorumu).…

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.19**

#### 5.2.20 · Sales tracker (Ecommerce / Tracked sales) — atomik kırılım

**8 atomik alt-görev · ~9 pencere** — `OPUS-MAX` ×1 · `OPUS-XHIGH` ×3 · `SONNET-XHIGH` ×4

**KK (PRD birebir):** _"İzleme yapılandırması"_ · _"Reports Ecommerce ile ilişki"_

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `13.5-a` | Sales tracker veri modeli — sales_tracker_settings (lisans-tekil) + tracked_sales (olay… | `SONNET-XHIGH` | 13.3 Goals (dış bağımlılık — orkestratörün bağlayıcı kararı: 13.3 önce; `goals` tablosu şemada var ama 0 tüketici, bu kalem başlamadan 13.3'ün CRUD+UI'si bitmeli) | 1 |
| `13.5-b` | Sales tracker konfigürasyon endpoint'i — GET/PUT /settings/sales-tracker (kontrat + route +… | `OPUS-XHIGH` | 13.5-a | 1 |
| `13.5-c` | Tracked-sale ingest + atıf (attribution) çekirdeği — POST /customer/chat/sale (BÖLÜNMEZ) | `OPUS-MAX` | 13.5-a, 13.5-b | 2 |
| `13.5-d` | GET /reports/reviews ecommerce bloğunu gerçek veriyle doldur — trackedSalesSummary agregasyonu | `OPUS-XHIGH` | 13.5-b, 13.5-c | 1 |
| `13.5-e` | Settings ekranı — 'Sales tracker' bölümü (enabled / currency / atıf penceresi formu) | `SONNET-XHIGH` | 13.5-b | 1 |
| `13.5-f` | Reports/Reviews — Ecommerce KPI'ları + dürüst empty state + 'Configure sales platforms' CTA | `SONNET-XHIGH` | 13.5-d, 13.5-e (CTA'nın hedefi olan Settings bölümü var olmalı) | 1 |
| `13.5-g` | Widget izleme kodu — nexa('trackSale', …) JS API + kurulum snippet'i | `SONNET-XHIGH` | 13.5-c | 1 |
| `13.5-h` | Uçtan uca doğrulama — seed/demo verisi + e2e (izleme kodu → Reports Ecommerce) + 13.3 Goals… | `OPUS-XHIGH` | 13.5-d, 13.5-e, 13.5-f, 13.5-g, 13.3 Goals (dış bağımlılık — tutarlılık kontrolü için teslim olmalı) | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** 13.5-c (tracked-sale ingest + atıf çekirdeği) bölünmez. Bu tek noktada üç sınır aynı anda kesişiyor: (1) **güven sınırı** — parayı bildiren taraf müşteri token'ı, yani widget'ın çalıştığı sayfa; `amount_cents`/`currency`/`external_order_id` tamamen ziyaretçi kontrolündeki girdidir ve `license_id` ASLA gövdeden alınamaz (tenant'tan alınır); (2) **idempotency/çift-sayım invariantı** — aynı `external_order_id` iki kez POST edildiğinde ciro iki kez sayılmamalı, bu kısıt `(license_id, external_order_id)` unique + upsert davranışının birlikte akıl yürütülmesini ister; (3) **atıf algoritması** — satışın hangi chat'e bağlanacağı (attribution_window_days içindeki son chat, yoksa attributed=false) rapordaki `attributed_revenue_cents`'i doğrudan belirler. Bu üçü ayrı pencerelere bölünürse "kim neyi doğruluyor" bağlamı kaybolur: doğrulamayı ingest'ten ayırmak, ya doğrulanmamış yazma yolu ya da atıf…

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (11)
  - **Veri kaynağı = first-party izleme kodu, harici platform webhook'u DEĞİL.** PRD 'satış/dönüşüm izleme kodu/kuralı' diyor ama kaynağı belirtmiyor. Olgular MOD-09.2…
  - **Atıf (attribution) kuralı deterministik:** satış, aynı müşterinin `attribution_window_days` içindeki EN SON chat'ine bağlanır. Pencere içinde chat yoksa satış yine…
  - **Tek para birimi:** lisans başına tek ISO 4217 kodu (`sales_tracker_settings.currency`). Farklı para biriminde gelen satış 400 ile reddedilir; çoklu-para toplama…
  - **Idempotency anahtarı `(license_id, external_order_id)`.** Aynı sipariş kaç kez bildirilirse bildirilsin bir kez sayılır. Tekrar POST 200 döner (hata değil) — checkout…
  - **`configured` semantiği:** `sales_tracker_settings` satırı VAR **ve** `enabled=true` → `configured:true`. Satır yok veya kapalı → bugünkü `configured:false` + üç null…
  - **Yeni scope AÇILMAZ.** Konfigürasyon `access_rules:ro/rw`, rapor `reports_read`, ingest `principals:['customer']` — hepsi mevcut. Böylece…
  - _…+5 madde daha — tam metin companion dosyada_

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (5)
  - **13.3 Goals şeması:** tracked sale, `goals.definition` jsonb'sinde bir dönüşüm tipi (`type:'purchase'`) olarak mı temsil edilecek, yoksa `tracked_sales` tamamen…
  - **Rapor yüzeyi:** MOD-07.7'nin v2 payı ayrı bir 'Sales' rapor grubu/sekmesi (Leads/Cases/Sales/Team performance — rapor-1:1363-1371) istiyor. Satış verisi Reviews…
  - **Origin kontrolü:** izleme kodu müşterinin checkout/teşekkür sayfasında çalışacak. Widget token'ı zaten trusted-domain kapısından geçiyor; satış bildirimi için EK bir…
  - **Çoklu para birimi:** tek-currency varsayımı (varsayım 3) kabul edilirse bu soru kapanır. Kabul edilmezse `ReportsReviews.ecommerce` şeması kırıcı biçimde değişir (para…
  - **Üst sınır/anomali:** ziyaretçi kontrolündeki `amount_cents` için mantıklı bir üst sınır (ör. 100.000.000 kuruş) konulacak mı, yoksa yalnız tamsayı+negatif-değil…

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.20**

#### 5.2.21 · Public KB — SEO'lu self-servis bilgi bankası (PRD §5.3-Knowledge)

**9 atomik alt-görev · ~12 pencere** — `OPUS-MAX` ×2 · `OPUS-XHIGH` ×3 · `SONNET-XHIGH` ×4

**KK (PRD birebir):** _"SEO'lu self-servis bilgi bankası (public KB)"_

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `PUBKB-a` | Public KB veri modeli: kb_articles + kb_categories + kb_settings (RLS'li migration) | `SONNET-XHIGH` | yok | 1 |
| `PUBKB-b` | Yönetim (agent-auth) KB CRUD kontratı + backend + yayın (draft/published) durumu | `OPUS-XHIGH` | PUBKB-a | 2 |
| `PUBKB-c` | Anonim public okuma çekirdeği (BÖLÜNMEZ): slug→license çözümleyici + yayın filtresi + 404… | `OPUS-MAX` | PUBKB-a, PUBKB-b | 2 |
| `PUBKB-d` | Makale gövdesi güvenli render çekirdeği (BÖLÜNMEZ): escape-first sınırlı markdown | `OPUS-MAX` | yok | 1 |
| `PUBKB-e` | SEO'lu sunucu-render HTML yüzeyi: KB ana sayfası + makale sayfası… | `OPUS-XHIGH` | PUBKB-c, PUBKB-d | 2 |
| `PUBKB-f` | sitemap.xml + robots.txt (yalnız yayınlanmış makaleler, XML-escape'li) | `SONNET-XHIGH` | PUBKB-c, PUBKB-e | 1 |
| `PUBKB-g` | Admin: KB makale listesi + durum sekmeleri (All/Published/Drafts) + anlamlı empty state | `SONNET-XHIGH` | PUBKB-b | 1 |
| `PUBKB-h` | Admin: makale editörü (içerik + SEO alanları) + publish/unpublish + public link | `SONNET-XHIGH` | PUBKB-b, PUBKB-g | 1 |
| `PUBKB-i` | Uçtan uca doğrulama: anonim okuyucu e2e + izolasyon/SEO kanıt seti | `OPUS-XHIGH` | PUBKB-c, PUBKB-e, PUBKB-f, PUBKB-h | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** İki bölünmez çekirdek var. (1) PUBKB-c — anonim (principal'sız) trafiğe org-scoped İÇERİK servis etme kararı bu depoda bir ilk: slug→license çözümleyici (pre-tenant SECURITY DEFINER deliği), yayın filtresi (published+is_public), 404-yerine-403 politikası (NFR-S5) ve enumeration yüzeyi TEK bir akıl yürütmenin parçaları; resolver'ı filtreden veya 404 politikasından ayırmak, "hangi satır kime görünür" invariantını iki ayrı pencereye bölerek kaybettirir. (2) PUBKB-d — escape-first render: kaçış sırası ile beyaz-liste sırası aynı fonksiyonda karar verilir; "önce escape sonra whitelist" invariantı bölününce stored-XSS açığı tam olarak bu dikişten girer. Her iki çekirdeğin ETRAFINDAKİ her şey (şema/migration, admin CRUD, HTML şablonu, sitemap, admin UI, e2e) ayrı ve daha ucuz etiketli alt-görevlere çıkarıldı.

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (12)
  - §C-PUBKB-1 (ŞEMA İZOLASYONU): Public KB, `knowledge_sources` tablosunu GENİŞLETMEZ; ayrı `kb_articles`/`kb_categories`/`kb_settings` tabloları kullanır. Gerekçe:…
  - §C-PUBKB-2 (RENDER MİMARİSİ): Public KB sayfaları apps/web SPA'sına EKLENMEZ; API tarafından sunucuda üretilen HTML olarak servis edilir. Gerekçe: PRD kendi A2…
  - §C-PUBKB-3 (İÇERİK BİÇİMİ): Makale gövdesi ham HTML olarak saklanmaz ve saklanmayacak; sınırlı markdown alt kümesi + escape-first render kullanılır (`lib/kb-render.ts`).…
  - §C-PUBKB-4 (ADRES): Workspace'in public adresi `kb_settings.public_slug` (license-singleton, global unique) ile taşınır. Gerekçe: `Organization` (schema.prisma:29-40) ve…
  - §C-PUBKB-5 (ERİŞİM ÇÖZÜMLEME): slug→license çözümü, mevcut `auth_resolve_organization_license` (migration 20260724110000, SECURITY DEFINER, REVOKE FROM PUBLIC + GRANT TO…
  - §C-PUBKB-6 (SCOPE): KB yönetimi YENİ SCOPE EKLEMEZ; mevcut `agents-bot--all:ro` / `agents-bot--all:rw` kullanılır (aynı Knowledge alanı, `playbook.ts:20-21` ile aynı…
  - _…+6 madde daha — tam metin companion dosyada_

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (6)
  - Public KB hangi origin'den servis edilecek? API origin mi, `WIDGET_BASE_URL` mi, yoksa ayrı bir `kb.` alt alanı mı? DNS/TLS kapsam dışı olduğu için kırılımda API origin…
  - Makale gövdesi için zengin metin (WYSIWYG) editörü isteniyor mu? Varsayım: HAYIR — düz metin + sınırlı markdown (§C-PUBKB-3). Zengin editör istenirse PUBKB-d ve PUBKB-h…
  - Public KB'de site-içi arama (full-text) MVP'ye dahil mi? Şu an kapsam dışı bırakıldı (liste + kategori + makale gezinmesi). Dahilse ayrı bir alt-görev (Postgres…
  - AI Agent, public KB makalelerini de RAG kaynağı olarak kullanmalı mı (çift yönlü bağ: bir makale hem public hem RAG)? Varsayım: HAYIR — iki tablo, iki amaç, tek yönlü…
  - Bir workspace'in birden çok public KB'si (marka/dil başına) olacak mı? Varsayım: license başına TEK KB (`kb_settings` license-singleton). Çoklu KB istenirse…
  - Yayınlanmış bir makalenin slug'ı değiştirilirse eski adres ne yapmalı (301 yönlendirme kaydı mı, 404 mü)? Kırılımda 404 varsayıldı; SEO açısından yönlendirme tablosu…

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.21**

#### 5.2.22 · WORKSCHED — Work scheduler / staffing prediction (PRD §5.3-Vardiya)

**10 atomik alt-görev · ~11 pencere** — `OPUS-MAX` ×2 · `OPUS-XHIGH` ×4 · `SONNET-XHIGH` ×4

**KK (PRD birebir):** _"| Ekip/Vardiya | Work scheduler / staffing prediction |"_

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `WORKSCHED-a` | Work schedule kontratı + @nexa/types haftalık plan tipi ve normalizer | `SONNET-XHIGH` | yok | 1 |
| `WORKSCHED-b` | work_schedules + agent_presence_events tabloları, Prisma modelleri ve RLS migration'ı | `OPUS-XHIGH` | WORKSCHED-a | 1 |
| `WORKSCHED-c` | GET/PUT /agents/{agentId}/work-schedule — scope kapısı ve self-vs-admin yetkilendirme | `OPUS-XHIGH` | WORKSCHED-a, WORKSCHED-b | 1 |
| `WORKSCHED-d` | Presence olay günlüğü yazma yolu + planlı vardiya ↔ manuel routingStatus öncelik kuralı… | `OPUS-MAX` | WORKSCHED-b | 2 |
| `WORKSCHED-e` | /reports/breakdown yanıtına saat-bazlı hacim kırılımı (by_hour) | `SONNET-XHIGH` | yok | 1 |
| `WORKSCHED-f` | Deterministik staffing tahmin çekirdeği (saf modül, LLM yok — bölünmez) | `OPUS-MAX` | yok | 1 |
| `WORKSCHED-g` | GET /reports/staffing-forecast — kontrat + üç girdinin tek yanıta bağlanması | `OPUS-XHIGH` | WORKSCHED-b, WORKSCHED-d, WORKSCHED-e, WORKSCHED-f | 1 |
| `WORKSCHED-h` | Team → Work schedule düzenleyici (haftalık ızgara + timezone + alan-altı hata) | `SONNET-XHIGH` | WORKSCHED-a, WORKSCHED-c | 1 |
| `WORKSCHED-i` | Reports → Staffing sekmesi (salt-okunur gün × saat ızgarası + düşük-baz uyarısı) | `SONNET-XHIGH` | WORKSCHED-g | 1 |
| `WORKSCHED-j` | Uçtan uca doğrulama: staffing e2e akışı + izolasyon iddiaları + ADR-09 sayı tutarlılığı | `OPUS-XHIGH` | WORKSCHED-c, WORKSCHED-d, WORKSCHED-g, WORKSCHED-h, WORKSCHED-i | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** İki bölünmez çekirdek var. (1) WORKSCHED-d — presence olay günlüğünün YAZMA yolu `PUT /agents/me/routing-status` handler'ının içindedir ve o handler aynı `withTenant` bloğunda `routing.drainQueue` çağırıyor (apps/api/src/routes/agents.ts:74); olay yazımı bu transaction'dan koparılırsa kısmi yazma (durum değişti, olay yok / olay var, atama geri alındı) oluşur. Aynı alt-görev planlı vardiya ile manuel routingStatus arasındaki öncelik kuralını da sabitler — kural bağlamdan koparılırsa ajanın kuyruk alıp almadığı yanlış kararlaşır. (2) WORKSCHED-f — deterministik personel tahmini yeni bir algoritma tasarımıdır; depoda kopyalanacak eşdeğeri yoktur (reports-metrics.ts yalnız oran/yuvarlama içerir) ve kapasite modeli parçalara bölünürse "düşük-baz → null, 0 değil" ile "kapsama açığı" kuralları birbirinden kopar. Bu iki çekirdeğin ETRAFINDAKİ her şey daha ucuz alt-görevlere çıkarıldı:…

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (11)
  - KK-türetilmiş kalemdir: PRD §5.3 satır 412 iki sütunlu ("Alan | Kapsam") tablodadır, ayrı "Kabul Kriteri" sütunu yoktur ve PRD §6 FR-MOD tablosunda bu koda karşılık…
  - Tahmin LLM'siz ve deterministiktir (orkestratörün bağlayıcı kararı): girdi = saat-bazlı geçmiş hacim + presence kapsaması + AgentMembership.concurrentChatsLimit +…
  - StaffingForecast TABLOSU AÇILMAZ — tahmin API-time hesaplanır, persist edilmez. (Olgulardaki 'persist edilecekse' notu bu turda hayır olarak karara bağlandı; ihtiyaç…
  - Tarihsel presence, ÖRNEKLEYİCİ CRON ile değil, OLAY GÜNLÜĞÜ (append-on-change) ile tutulur: routingStatus zaten tek noktadan (agents.ts PUT /agents/me/routing-status)…
  - ÖNCELİK KURALI: manuel routingStatus HER ZAMAN planlı vardiyayı ezer. WorkSchedule routing/atama kararını değiştirmez — yalnız beklenen kapasite ve tahmin girdisidir.…
  - Vardiya planı AJAN bazlı ve lisans kapsamlıdır (PK license_id + agent_id). Grup/ekip bazlı vardiya bu kalemin kapsamı dışındadır (PRD 'Ekip/Vardiya' diyor ama §6'da…
  - _…+5 madde daha — tam metin companion dosyada_

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (6)
  - Vardiya planı ajan bazlı mı olmalı, yoksa grup/ekip (Group) bazlı mı? PRD §5.3 satırı 'Ekip/Vardiya' diyor ama §6'da tanım yok. Varsayım: ajan bazlı (PK…
  - Tahmin çıktısı zaman içinde saklanıp 'tahmin vs gerçekleşen' karşılaştırması istenir mi? Varsayım: hayır — API-time hesap, StaffingForecast tablosu yok. İstenirse ayrı…
  - Planlı vardiya routing'i GERÇEKTEN sürmeli mi (vardiya başında ajanı otomatik accepting_chats yapmak)? Varsayım: HAYIR (manuel kazanır — WORKSCHED-d). Otomatik sürüş…
  - Düşük-baz (low_confidence) eşiği kaç sohbet/saat olmalı? PRD'de sayı yok. Varsayım: sabit bir eşik, mevcut rapor 'düşük-baz uyarısı' deseniyle hizalı; sayı kullanıcı…
  - agent_presence_events için retention politikası ne olmalı — mevcut retention yolu bu tabloyu da süpürmeli mi? Süpürürse tahmin penceresi geçmişe doğru kısalır;…
  - Vardiya planı UI'ı ajanın kendisine mi (self-servis) yoksa yalnız yöneticiye mi açılmalı? Varsayım (WORKSCHED-c): ikisi de — self için agents--my, başkası için…

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.22**

#### 5.2.23 · MULTIBRAND — Multibrand (tek lisansta çok marka) · PRD §5.3-Marka

**8 atomik alt-görev · ~10 pencere** — `OPUS-MAX` ×1 · `OPUS-XHIGH` ×4 · `SONNET-XHIGH` ×3

**KK (PRD birebir):** _"Destek (birebir, urun-gereksinim-dokumani-PRD.md:58): «Multi-tenant | Çok kiracılı SaaS; izolasyon anahtarı `organization_id` / `license_id` / `account_id`»"_ · _"Destek (birebir, urun-gereksinim-dokumani-PRD.md:758): «NFR-S4 | Tenant izolasyonu | Her sorgu `organization_id`/`license_id` filtreli; PostgreSQL RLS (`current_setting('app.current_org')`) + `TenantScopedRepository`; PgBouncer transaction-mode + `SET LOCAL`; CI'da çapraz-tenant reddi negatif testleri»"_ · _"Destek (birebir, v2-derin-analiz/v2-02-teknik-mimari-derin.md:476): «her transaction başında `SET LOCAL app.current_org_id` çağrılmalı — aksi halde bağlantı havuzunda önceki tenant'ın context'i sızabilir (kritik operasyonel tuzak).»"_ · _"Destek (birebir, v2-derin-analiz/v2-04-guvenlik-uyumluluk.md:432-434): «Repository katmanında merkezi tenant-scoping — her `findMany`/`findFirst` çağrısı bir taban sınıf/yardımcı fonksiyondan geçmeli, `organization_id` filtresi *asla* çağıran koda bırakılmamalı»"_ · _"Destek (birebir, PRD §5.3-Marka, satır 415 ham kapsam hücresi): «Multibrand; 100+ entegrasyon; command palette AI komutları»"_ · _"Destek (birebir, v2-derin-analiz/v2-04-guvenlik-uyumluluk.md:441): «Otomatik izolasyon testi — CI'da her repository metodu için "org A'nın token'ı ile org B'nin ID'sini sorgula, sonuç boş dönmeli" testi zorunlu kılınmalı.»"_

| ID | Alt-görev | Etiket | Bağımlılık | Pen |
| --- | --- | --- | --- | :-: |
| `MULTIBRAND-a` | `brands` tablosu + license-scoped RLS + lisans başına varsayılan marka backfill | `OPUS-XHIGH` | yok | 1 |
| `MULTIBRAND-b` | Marka izolasyon çekirdeği — `app.current_brand` context + marka çözümleyici + brand-scoped RLS… | `OPUS-MAX` | MULTIBRAND-a | 2 |
| `MULTIBRAND-c` | brand_id yayılımı — websites + üç singleton ayar tablosunun (widget/security/inbox)… | `OPUS-XHIGH` | MULTIBRAND-b | 2 |
| `MULTIBRAND-d` | `/brands` CRUD kontratı + route + `brands--all` scope + `brand_not_found` hata tipi | `OPUS-XHIGH` | MULTIBRAND-a, MULTIBRAND-b | 1 |
| `MULTIBRAND-e` | Settings → Brands ekranı (liste + ekle + yeniden adlandır + sil + boş durum) | `SONNET-XHIGH` | MULTIBRAND-d | 1 |
| `MULTIBRAND-f` | AppShell marka değiştirici + seçili markanın persist'i + isteklerde `X-Nexa-Brand` başlığı | `SONNET-XHIGH` | MULTIBRAND-b, MULTIBRAND-d, MULTIBRAND-e | 1 |
| `MULTIBRAND-g` | Marka-scoped ayar ekranlarının seçili markaya bağlanması (Widget / Websites / Channels) | `SONNET-XHIGH` | MULTIBRAND-c, MULTIBRAND-f | 1 |
| `MULTIBRAND-h` | Uçtan uca cross-brand doğrulama — otomatik izolasyon test matrisi + kapsam-kaçağı alarmı + e2e | `OPUS-XHIGH` | MULTIBRAND-c, MULTIBRAND-g | 1 |

> **Bölünmeyen çekirdek (§5.1.2 istisnası):** MULTIBRAND-b (marka izolasyon çekirdeği) bölünmez. Çekirdek üç şeyi TEK akıl yürütmede tutmak zorunda: (1) `withTenant` transaction'ına üçüncü bir `SET LOCAL app.current_brand` eklenmesi — v2-02:476 bunun yanlış yapılmasının PgBouncer transaction-mode'da connection-pool context sızıntısı ürettiğini açıkça uyarıyor; (2) `nexa_current_brand()` + RLS policy semantiği (NULL = lisansın tüm markaları, NOT NULL = tek marka) — policy ile context aynı anda tasarlanmazsa ya her sorgu boş döner ya da filtre hiç uygulanmaz; (3) istekten gelen marka kimliğinin lisansa aitliğinin doğrulanması (cross-brand IDOR). Bu üçü ayrı pencerelere bölünürse, aradaki pencerede sistem "policy var ama context yok" (tüm veri görünmez) veya "context var ama policy yok" (tüm veri sızar) durumunda kalır ve ikinci durum sessizce yanlış-ama-makul veri döndürür — orkestratörün "en riskli v2 kalemi" dediği tam senaryo.…

**Varsayımlar** — kırılım turunda PRD dışında verilen kararlar: (10)
  - Katman sırası Organization → License → Brand olarak kuruldu: Brand, License'ın ALTINDA yeni bir izolasyon katmanıdır. PRD §8.4 tablo envanterinde `brands` tablosu hiç…
  - Geriye dönük uyum: her lisans migration ile bir 'Default' markası alır ve mevcut TÜM veri ona bağlanır; tek-markalı lisansların davranışı hiç değişmez ve UI'da marka…
  - `app.current_brand` NULL = 'lisansın tüm markaları', NOT NULL = tek marka. Bu sayede lisans-geneli mevcut sorgular (reports, billing, metering) marka bilgisi taşımadan…
  - v2 kapsamındaki brand-scoped tablo kümesi ŞUNLARLA SINIRLI: channels, websites, widget_settings, security_settings, inbox_settings. `chats`, `tickets`, `campaigns` marka…
  - `customers` marka-agnostik kalır (bugünkü hâliyle organization_id scoped). Aynı müşteri birden çok markayla konuşabilir; marka ayrımı kanal/ayar düzeyinde taşınır. PII…
  - Marka seçimi istemciden `X-Nexa-Brand` başlığıyla taşınır (yol parametresi değil) — böylece ADR-04'ün mevcut `/api/v1/...` REST yüzeyi ve 23 path dosyası yeniden…
  - _…+4 madde daha — tam metin companion dosyada_

**Açık sorular** — ürün/kullanıcı kararı bekleyenler: (6)
  - `chats` / `tickets` / `campaigns` marka-scoped olacak mı? Bu turda kapsam dışı varsayıldı. Olacaksa +3-4 alt-görev (her biri OPUS-XHIGH, chats için muhtemelen OPUS-MAX…
  - Faturalama marka bazında mı kırılacak? Bugün `usage_records`/metering lisans bazında (ADR-13 mock). Marka bazlı kullanım/fatura isteniyorsa ayrı bir kalem gerekir — bu…
  - Ajanlar markaya atanabilecek mi (marka bazlı yetki)? Varsayım: hayır, tüm ajanlar tüm markaları görür. Evet ise MULTIBRAND-b'nin çekirdeği büyür (authZ kararı marka…
  - `customers` markaya bağlanacak mı? Varsayım: hayır (organization_id scoped kalır). Evet ise PII sahipliği + CRM ekranları + retention politikaları etkilenir; bu ayrı bir…
  - Her markanın ayrı bir widget domain'i / website'ı olması ZORUNLU mu, yoksa bir domain birden çok markaya hizmet edebilir mi? -c, `@@unique([licenseId, brandId, domain])`…
  - Marka logosu/teması widget'a yansıyacak mı (marka bazlı görsel kimlik)? Bu kırılım `logoUrl` kolonunu tanımlıyor ama widget'a bağlamıyor; bağlanacaksa `apps/widget`…

> Tam alan detayı (neden açık · kapsam · dosyalar · referans desen · KK doğrulama · zorunlu testler · sözleşme · migration): **`PLAN-V2-KIRILIM.md` → 5.2.23**

---

### 5.3 v2 dilim gruplaması + kritik yol

> Dilim = 3–8 kalemlik tematik grup; her dilimin bir **§F.00 kapanış kapısı** ve bir **§F.0 mini
> denetim** noktası var. Dilim **sırası = çalışma sırası**.

#### 5.3.1 Sıralamanın iki kilit kararı

**(a) Güvenlik kalemleri en başta.** `08.9.6` (IP allowlist / oturum güvenliği) ve
`08.6.3-conflict` (çoklu-ajan çakışma = yarış durumu) ve `08.9.7-audit` (audit tüm planlarda)
**birinci dilime** kondu. Gerekçe bu depoda kanıtlanmış bir desen: v2'nin diğer üç güvenlik kalemi
(CC-masking · banned customers · spam filtre) GO-LIVE turunda **öne çekilmek zorunda kaldı**
(§D52/§D57/§D58/§D59) çünkü canlıya hazırlık onları erken istedi. Sonradan eklenen güvenlik en
pahalı borçtur: her yeni yüzey onu retrofit etmek zorunda kalır. Aynı hatayı v2 içinde tekrar
etmemek için erişim kontrolü ve eşzamanlılık sınırları **önce** kapanır.

**(b) Multibrand ikinci dilimde — sonda değil.** Bu, v2'nin en tartışmalı sıralama kararı;
gerekçesi yazılı olmalı:

- Multibrand **tenant/RLS izolasyon sınırının genişlemesidir**: `license` → `license × brand`.
  Her sorgu, her RLS politikası, her widget/persona/rapor yüzeyi marka boyutu kazanır.
- **Sonda yapılırsa:** v2 boyunca inşa edilen her yeni yüzey (Goals hunisi, Public KB, MCP tool'ları,
  Instagram kanalı, audit ekranı, scheduled export, 100+ katalog…) **marka-farkındalığı olmadan**
  yazılır ve Multibrand penceresi hepsini geri dönüp retrofit etmek zorunda kalır. Bu, tek bir
  `[OPUS-MAX]` penceresine v2'nin tamamı kadar yüzey yükler — bölünemez çekirdek olduğu için de
  ucuza bölünemez.
- **Başta yapılırsa:** v2'nin geri kalanı marka boyutunu **doğduğu anda** taşır; her yeni sorgu
  zaten iki anahtarla yazılır. Maliyet tek yerde toplanır.
- **Karşı argüman (ve neden kazanmıyor):** Multibrand en riskli kalem; erken yapmak v2'nin geri
  kalanını istikrarsız bir tabanın üstüne kurar. — Ama bu risk **her hâlükârda** alınıyor: v1
  yüzeyleri de retrofit gerektiriyor (Multibrand'in blast radius'u v1'i de kapsıyor), yani "sonra
  yaparsak taban stabil kalır" doğru değil; yalnız **retrofit edilecek yüzey sayısı** artıyor.
- **Sonuç:** Multibrand, güvenlik dilimi kapandıktan hemen sonra, v2'nin yeni yüzeyleri açılmadan
  **önce** gelir. Cross-brand negatif testi bu dilimin kapanış kapısıdır.

**(c) Bağımlılık zorlamaları.** `13.5 Sales tracker` → `13.3 Goals`'a bağlı (PRD: "MOD-07.8,
MOD-13.3"). `09.4 Zapier/partner` → webhooks ✅ (tm 34) üzerine. `08.5.7 Instagram` →
`08.5-adapter-a` ✅ (tm 35) üzerine. `12.4-bi Copilot BI` → `07.5 Metrics breakdown`'a bağlı
(BI komutu kırılım sorgularını okur; ADR-09 tutarlılığı aynı sorgudan gelmeli).
`09.2 100+ katalog` ile `09.4 partner portalı` aynı dilimde — ikisi de marketplace yüzeyi.

#### 5.3.2 Dilim tablosu (çalışma sırası)

| # | Dilim | Tema | Kalemler | Alt-gör. | ~Pen | Kapanış kapısı |
| :-: | --- | --- | --- | :-: | :-: | --- |
| 1 | **Güvenlik sınırları** | Erişim kontrolü + yarış durumu + denetim izi — **v2 buradan başlar** | `08.9.6` · `08.6.3-conflict` · `08.9.7-audit` | 27 | 32 | Üçü de ✅ · her birinde negatif + cross-tenant testi yeşil |
| 2 | **Marka izolasyonu** | Multibrand — tenant sınırının genişlemesi; **yeni yüzeyler açılmadan önce** | `Multibrand` | 8 | 10 | Multibrand ✅ · **cross-brand negatif** yeşil |
| 3 | **Routing** | Skills-based routing + supervision/takeover | `08.6.3` | 9 | 11 | 08.6.3 ✅ · yetkisiz takeover reddi + eşzamanlılık |
| 4 | **Reports** | Boyutlu kırılım · konu kümeleme · rapor grupları · zamanlanmış export | `07.5` · `07.6` · `07.7-v2` · `07.9-sched` | 39 | 45 | Dördü de ✅ · **ADR-09 tutarlılığı** korunur |
| 5 | **AI yüzeyi** | MCP server · ⌘K AI komutları · Copilot BI | `08.8.3` · `01.1.3-ai` · `12.4-bi` | 22 | 24 | Üçü de ✅ · scope + tenant izolasyonu + ADR-09 |
| 6 | **Bilgi tabanı** | Bulk/CSV import · Public KB · 31+ şablon | `06.3.2-bulk` · `Public KB` · `05.6-tmpl31` | 22 | 29 | Üçü de ✅ · **public yüzey** erişim sınırı doğrulandı |
| 7 | **Marketplace** | 100+ katalog · API paketleri · partner portalı | `09.2` · `09.3` · `09.4` | 23 | 25 | Üçü de ✅ |
| 8 | **Engage** | Traffic gelişmiş · Goals hunisi · Sales tracker | `13.2` · `13.3` · `13.5` | 28 | 32 | Üçü de ✅ · `goals` tablosu artık tüketiliyor (§8) |
| 9 | **Kanal + Vardiya** | Instagram DM (MOCK) · work scheduler | `08.5.7` · `Work scheduler` | 18 | 20 | İkisi de ✅ → **Faz-2 §F.00 kapanır** |
| | | | **9 dilim · 23 kalem** | **196** | **228** | |

**Sıra Task Master'da zorlanır (bilgi değil, kısıt):** dilim sırası yalnız bu tabloda yazılı
kalsaydı run-loop onu görmezdi — `next` seçimi önceliğe, eşitlikte görev numarasına bakar.
Bu yüzden sıra **bağımlılıkla** kodlandı: `V2-2` (Multibrand) üç güvenlik görevini bekler;
`V2-3…V2-9`'un tamamı `V2-2`'yi bekler. Böylece **önce güvenlik, sonra marka izolasyonu, sonra
geri kalan her şey (birbirine paralel)** akışı yapısal olarak garanti edilir — §5.3.1'in
gerekçesi bir tavsiye değil, grafın şekli hâline gelir. Doğrulama: panel `next` = `08.9.6`
(dilim V2-1) · 20 görev sıra bekliyor · `validate_dependencies` temiz.

## 6. FAZ 3 — Enterprise (PRD §5.4)

**Çıkış kriteri (PRD):** Enterprise ARR ≥%25 · SOC2 Type II + ISO 27001 · churn <%5/yıl.

| PRD    | Gereksinim                                       | Not                                                       |
| ------ | ------------------------------------------------ | --------------------------------------------------------- |
| 08.5.8 | Telegram                                         | PRD §11.1/7: "Instagram/Telegram tam kanal: v2/Enterprise" → Instagram v2 (§5), Telegram burada |
| **13.7** | **Mobil uygulamalar** (iOS/Android + push) — **13.8-mobil-push** dahil | **v1 `Should`'undan bu turda taşındı (2026-08-01 · §D60).** PRD KK: _"Inbox/AI/CRM/Reports mobilde; push; **tam modül paritesi** (Nexa farklılaşması)"_. Taşıma gerekçesi: native iOS/Android **bu deponun stack'i dışında** (ADR-01/02 TS monorepo) — ayrı uygulama hattı + derleme zinciri + store süreci. Eski `🔒` gerekçesi ("PRD §11.1/8") **yanlış atıftı**: o madde _"Masaüstü native uygulama"_ hakkındadır. → §6.1 · tm 90 |
| 08.9.6 | ~~IP allowlist / oturum güvenliği~~              | **→ Faz 2'ye taşındı (§5, 2026-08-01 · §D61).** PRD §5.3 "Güvenlik" satırı bu kalemi CC-masking/banned-customers/spam ile **aynı v2 hücresinde** listeliyor; o üç kardeş zaten v2 (ve GL-5/6/7 ile öne bile çekildi). FR-MOD-08.9.6'nın `Could (Ent.)` etiketi **önceliği** bildirir; **fazı PRD §5 belirler** (§1.1 omurga kuralı: _"Çalışma sırası PRD §5'in faz sırasıdır"_). Güvenlik erken gelir. |
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
| 08.5.8 | Telegram (TR pazarı önceliği)            | `[OPUS-XHIGH]`|   2        | 08.5-adapter-a (tm 35 ✅)                  |
| **13.7** | **Mobil uygulamalar** (iOS/Android + push) | `[OPUS-MAX]` ↑ | **8–12** | **v1'den taşındı (§D60).** ↑ gerekçe: **stack sınırı** — bu monorepo TS/web (ADR-01/02); native app ayrı derleme zinciri + store süreci + ayrı test piramidi ister; ayrıca push altyapısı (APNs/FCM MOCK) + oturum/token modelinin mobil kanada genişlemesi = kimlik sınırı. Faz başında atomik bölünür (§5.1 bayatlama politikası). Bağımlılık: 13.8 web bildirim ✅ (tm 31) · auth/token ✅. tm 90 |
| ~~08.9.6~~ | ~~IP allowlist / oturum güvenliği~~  | —        |   —        | **→ Faz 2'ye taşındı** (§5 · §5.2 · §D61). PRD §5.3 Güvenlik satırı v2 diyor; §1.1'e göre fazı §5 belirler. |
| —      | SAML 2.0 SSO + SCIM provisioning         | `[MAX]` ↑|   4–5      | NFR-S11; kimlik sınırı                     |
| —      | HIPAA BAA + bölgesel barındırma          | `[MAX]` ↑|   3–4      | ADR-12 tek bölge (`eu`) yeniden açılır     |
| —      | SOC2 Type II · ISO 27001 · audit+SIEM    | `[MAX]` ↑|   süreç    | NFR-C6/C7/S12; audit yazıcı ✅ temeli var  |
| —      | White-label widget · SLA · sandbox       | `[XHIGH]`|   3–4      | 11.5 · widget ✅                           |
| —      | Sesli/telefon (voice/IVR)                | ⛔        |     0      | PRD §11.1/3 kapsam dışı                     |
| —      | Gerçek zamanlı çeviri · sesli sentiment  | ⛔        |     0      | PRD §11.1/4 kapsam dışı                     |
| —      | Veri ambarı export                       | ⛔        |     0      | P3 (§11.1/5)                                |

**Enterprise:** çoğu `[OPUS-MAX]` (güvenlik/uyumluluk/kimlik sınırları). Kod ~alt-görev **28–37**
(2026-08-01: mobil 13.7 `+8–12` girdi, 08.9.6 `−2` Faz-2'ye çıktı) + sertifikasyon **süreç** işi
(takvim-belirleyici).

> **Etiket notu (2026-08-01):** Faz-3 tablosu hâlâ **orta derinliktedir** — atomik kırılım faz başında
> yapılır (§5.1 bayatlama politikası). Etiketler yeni **model+efor matrisine** çevrildi
> (`[SONNET-XHIGH]` · `[SONNET-MAX]` · `[OPUS-XHIGH]` · `[OPUS-MAX]` — bkz. §5.2 giriş). Eski
> `[XHIGH]`/`[MAX]` yazımı Faz-0/v1 tarihçe bölümlerinde (§3/§4/§A/§B) **olduğu gibi bırakıldı**:
> o işler bitti, etiketleri artık yalnız kayıt değeri taşıyor.

---

## 7. Çapraz Kesit ve NFR Kapıları (PRD §6 FR-EK + §7)

Bunlar bir dilim değil, **her dilimin kabul koşulu**. Yeni ekran/endpoint eklerken kontrol edilir.

### 7.1 FR-EK — Çapraz kesit desenler

| PRD    | Desen                                                                                                     | Öncelik      |                      Durum                       |
| ------ | --------------------------------------------------------------------------------------------------------- | ------------ | :----------------------------------------------: |
| EK-A.1 | Form & girdi mantığı — tek validasyon kütüphanesi, alan-altı hata, geçersizken submit pasif               | Must (MVP)   | ✅ tek frontend validasyon primitifi `lib/form.tsx` (alan-altı hata + geçersizken submit pasif) — pilot Invite/Add website, kalan Must formlar (Signup/Reset/canned/tag/payment/channels) taşındı; test `form.test.tsx` (13) · tm 29.1/29.2 · §D55 |
| EK-A.2 | Ortak girdi davranışları — debounce arama, dropdown, stepper, optimistic toggle, yarım-form kapatma onayı | Must (MVP)   | ✅ ortak dirty-guard (kirli form kapatma onayı) `lib/dirty-guard.tsx` + `stepper.ts` + `optimistic.ts` tekilleştirme; test `dirty-guard.test.tsx` (6) + `stepper.test.ts` (5) + `optimistic.test.ts` (3) · tm 29.3 · §D55 |
| EK-B.1 | Sayfalama & yükleme — virtualized grid, infinite scroll, skeleton, **anlamlı empty state**                | Must (MVP)   | ✅ `VirtualList.tsx` (yalnız görünür satır DOM'da) + `Skeleton.tsx` + `EmptyState.tsx`; Contacts/Teammates/Skills/Tickets taşındı; test `VirtualList.test.tsx` (10, 10k-satır P4 proxy) + `Skeleton.test.tsx` (7) · tm 30.1/30.2 · §D55 |
| EK-C.1 | Realtime katman — WebSocket push (polling değil) + reconnect telafi                                       | Must (MVP)   |                    ✅ Dilim 5                    |
| EK-C.2 | Banner/dropdown/panel/modal — tek tasarım sistemi                                                         | Should (MVP) | ✅ tek design-system `components/ui/{Banner,Dropdown,Modal,Panel}` — mevcut kopyalar oturtuldu · Banner segmentli + kalıcı dismiss · test (22) · tm 62 |

### 7.2 NFR kapıları (PRD §7 — 58 madde)

Faz-0 kapanışında doğrulanacak olanlar:

| NFR      | Hedef                                               |                                                                                                                                                                                    Durum                                                                                                                                                                                     |
| -------- | --------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |
| P1       | RTM fan-out gecikmesi                               |                                                                                                                                                                              ✅ ölçüldü (13 ms)                                                                                                                                                                              |
| P3       | Widget bundle bütçesi                               |                                                                                                                                                                         ✅ 5.3 KB gzip (bütçe 50 KB)                                                                                                                                                                         |
| P4/P6    | Virtualized liste + büyük liste sorguları           |                                                                                                       ✅ **P6** keyset + `events` RANGE partition · **P4 ölçüldü** (tm 30/T6-a): `VirtualList` 10k satırda sınırlı DOM düğümü — test `VirtualList.test.tsx` _"NFR-P4 budget > paints a bounded node count for 10,000 rows (60fps proxy)"_ · §D55                                                                                                        |
| S1–S5    | Auth · token · scope · **tenant izolasyonu** · IDOR |                                                                                                                                                                         ✅ Dilim 2 (negatif testli)                                                                                                                                                                          |
| S6       | Widget izolasyonu (`innerHTML` yasak)               |                                                                                                                                                                          ✅ Dilim 6 (eslint kuralı)                                                                                                                                                                          |
| **S7**   | **Webhook HMAC + SSRF**                             |                                                                                                                                                       ⬜ v1 — kırılım **§4.4.3** (08.8.4-b HMAC + 08.8.4-c SSRF, ikisi de `[MAX]`; negatif testler önce). Ortak `lib/ssrf.ts` 06.3.2-a (KB crawl) ile paylaşılır.                                                                                                                                                       |
| S8       | Rate limiting                                       |                                                                                                                                                                                  ✅ ADR-07                                                                                                                                                                                   |
| **S10**  | **File sharing güvenliği**                          |                                                                                                                                                                 ✅ Dilim 13 (fail-closed virüs tarama, tm 4)                                                                                                                                                                 |
| S12      | Audit log (append-only)                             |                                                                                                                           ✅ yazıcı bağlandı (tm 23): 12 güvenlik olayı INSERT ediliyor · UPDATE/DELETE DB'de reddi · cross-tenant izole · PII yok                                                                                                                           |
| **C5/S9** | **CC masking (PCI SAQ A) + PII yazım maskesi** | ✅ → KC5-S9 |
| A11Y1–6  | WCAG 2.1 AA · klavye · ⌘K                           |                                                                                                                                                                       ✅ 01.1.3 (⌘K) Dilim 14 (tm 18)                                                                                                                                                                        |
| I18N1/2 | Widget + panel i18n | ✅ → KI18N1-2 |
| C1/C2/C8 | GDPR · KVKK · retention | ✅ → KC1-C2-C8 |
| M4       | Test piramidi (unit + integration + contract + E2E) |                                                                                                                                                    ✅ **1697** test (817 unit + 821 integration + 59 E2E) · contract-parity 5/5 — 2026-07-31 GL-3 sayımı (web 445·api 179+779·rtm 29+42·types 56·ai-mock 56·widget 52)                                                                                                                                                     |
| M5 | Gözlemlenebilirlik (`request_id`, OTel, metrikler) | ✅ → KM5 |

---

## 8. Veri Modeli (PRD §8.4) — tablo durumu

41 model migrate edildi (`schema.prisma`), tümünde RLS (Dilim 3). **Tüketici taraması (denetim
2026-07-25):** `apps/api/src` içinde her modelin `prisma.<model>.*` çağrıları sayıldı. Sonuç:

| Tablo       | Tüketici (2026-07-25 sayım)          | Bekleyen gereksinim | Faz / karar                                |
| ----------- | ------------------------------------ | ------------------- | ------------------------------------------ |
| `webhooks`  | **2 dosya / 5 çağrı** (`webhook-service`/`webhook-dispatcher`, tm 34) | 08.8.4 ✅ | **kullanılıyor** (GL-4 re-sayım 2026-07-31) |
| `campaigns` | **2** (✅ `CampaignService` oku/yaz + yeni `campaign_sends`) | 03.3.x ✅ | **kullanılıyor** (tm 43); trigger motoru + kart |
| `channels`  | **1 dosya / 8 çağrı** (`channel-service`, tm 35 MOCK adaptörler) | 08.5.4–.6 ✅ | **kullanılıyor** (GL-4 re-sayım) |
| `ratings`   | **yazma** (`customer.ts`) **+ okuma** (`reports.ts` reviews 07.8 raw · `home-service` CSAT) | 07.8 ✅ | **kullanılıyor** (tm 45/60, GL-4 re-sayım) |
| `goals`     | **0**                                | 13.3                | v2                                         |
| `visits`    | **3** (✅ yazma widget + okuma `getCustomer`) | 13.2 / 02.4 inbox | **kullanılıyor**; kalan tüketici: 02.4 (§3.13/T3) + 13.2 (v2). §8'in eski "kullanılmayan" iddiası düzeltildi (§D21) |
| `workflows` | **0**                                | 13.4                | ⛔ ADR-14 — tablo kalır, UI yapılmaz       |

**Karar:** Silinen tablo yok. **GL-4 re-sayım (2026-07-31 · §F.1/4):** v1 payı 2026-07-25'in üç
"0-tüketici" satırını doldurdu — `webhooks` (tm 34), `channels` (tm 35), `ratings` (okuma tm 45/60).
Geriye yalnız `goals` (v2 · 13.3) + `workflows` (⛔ ADR-14, tablo kalır UI yapılmaz) 0-tüketicili;
ikisi de gerekçeli-bekleyen (silme kararı yok — her birinin bir PRD kimliği + fazı var; §G'de izli).
Yani `Must` kapsamında **artık sistemsiz artık tablo yok**.

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

- **Atomik alt-görev:** **~255** — Faz-0 **9** (✅ teslim) + v1 **~50** (✅ teslim) + **v2 196**
  (2026-08-01'de atomik bölündü). v3 hâlâ orta derinlik: **~28–37** + sertifikasyon süreç işi (§6.1).
- **Etiket dağılımı — Faz-0+v1 (eski tek boyutlu şema, tarihçe):** `[MAX]` **8** (06.2.4-a, 06.3.2-a,
  08.8.4-b, 08.8.4-c, 12.2-a, 03.3.2-a, 08.7.7-a, 13.6-a — hepsi ↑ güvenlik/eşzamanlılık/izolasyon)
  · `[XHIGH]` **~51**.
- **Etiket dağılımı — v2 (yeni model × efor matrisi, §5.1.1):** `SONNET-XHIGH` **95** ·
  `SONNET-MAX` **5** · `OPUS-XHIGH` **65** · `OPUS-MAX` **31** → **%51 Sonnet**.
  31 `OPUS-MAX`'ın hepsi gerekçeli: erişim kontrolü, tenant/marka izolasyonu, eşzamanlılık/yarış,
  algoritma tasarımı veya ADR-09 bütünlüğü. Her biri §5.2'de "bölünmeyen çekirdek" gerekçesi taşır.
- **Faz dağılımı:** Faz-0 = 9 (hepsi Must ◐ kapatıcı) · v1 = ~50 (Must ~18, Should ~32) ·
  **v2 = 196** (9 dilim; v2'de `Must` yok — PRD'de tüm v2 kalemleri `Should`/`Could`).
- **Tahmini pencere:** Faz-0 **~10** (fiili) · v1 **~55–65** (fiili) · **v2 ~228** (kaba; `OPUS-MAX`
  ve 2–3 pencerelik bölünmez çekirdekler dahil).

### Kritik yol (en uzun bağımlılık zinciri)

**Faz-0 / v1 (tarihçe):** `T4-a → T4-b` (Faz-0 form katmanı) **→ Faz-0 kapanır →**
`07.4-a → 06.5-a → 06.1-a → 04.2-a` (AI performans zinciri; 04.2-a hem 06.5-a hem 12.2-a bekler).
Paralel uzun hat: `12.2-a → 12.1-a → 12.3-a → 02.3.2-a`. En uzun tekil kalem: **13.6-a**.

**v2 (Faz 2):** kritik yol **dilimler arasıdır**, kalem içi değil. Kalem içi zincirler kısadır
(tipik `kontrat → çekirdek → UI → kapanış`, 4 halka); asıl uzunluk dilim sırasından gelir:

`V2-1 güvenlik` **→** `V2-2 Multibrand` **→** (V2-3…V2-9 büyük ölçüde **paralelleşebilir**)
**→** `V2-8 Engage` içindeki `13.3 Goals → 13.5 Sales tracker` zinciri **→ Faz-2 kapanır**.

- **Neden ilk iki dilim seri:** Multibrand tenant sınırını genişletir; ondan sonra açılan her yüzey
  marka boyutunu doğduğu anda taşır. Güvenlik dilimi ondan da önce gelir çünkü `08.9.6` (IP
  allowlist) ve `08.6.3-conflict` (yarış durumu) oturum/eşzamanlılık sınırlarını kurar (§5.3.1).
- **En uzun tekil kalem:** `07.7-v2` (12 alt-görev, ~14 pencere — rapor grupları + PDF + benchmark
  + Save view). Ardından `13.2` (11) ve `08.9.7-audit` (11).
- **Kalem-içi en uzun zincir:** `06.3.2-bulk` — CSV çekirdeği → ingest → website/SSRF → UI → e2e.

### Faz kapanışını bloklayanlar (`Must` — §F.00 girdisi)

- **Faz-0:** T1-a · T3-a · T3-b · T4-a · T4-b · T5-a · T6-a · T6-b · T7-a (9 — hepsi). `Should`:
  EK-C.2 ✅ (tm 62); 03.1.1-kalan bloklamaz, v1'e taşınır.
- **v1:** 05.1-a · 05.3-a · 06.1-a · 06.2.4-a · 06.3.1-a · 06.3.2-a · 06.4-a · 08.5-adapter-a ·
  08.5.4-a · 08.5.5-a · 08.5.6-a · 08.8.4-a/-b/-c/-d · 02.1.2-a · 10.1.4-a · 04.2-a (~18).
- **v2:** PRD'de v2 kalemlerinin **hiçbiri `Must` değildir** (hepsi `Should`/`Could`) → §F.00'ın
  *sayaç* kuralı v2'de uygulanamaz. Yerine **kalem kuralı** geçerlidir: **23 açık kalemin hepsi ✅**
  olduğunda Faz-2 kapanır. Dilim bazlı ara kapılar §5.3.2'de. `13.4` ⛔ (ADR-14) ve `08.9.2/.3/.5`
  ✅ (GL-5/6/7) sayıma girmez.

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

> **v3 (Faz 3) satırları** §6.1'de item-level verildi (orta derinlik — faz başında atomik bölünür).
> **v2 satırları artık tam atomiktir** — aşağıda.

---

### v2 (Faz 2) — dilim gruplaması

Çalışma sırası bu tablodur. Sıralamanın gerekçesi §5.3.1'de (güvenlik önce, Multibrand yeni
yüzeyler açılmadan önce). Her dilim bir §F.00 kapanış kapısı taşır.

#### 5.3.2 Dilim tablosu (çalışma sırası)

| # | Dilim | Tema | Kalemler | Alt-gör. | ~Pen | Kapanış kapısı |
| :-: | --- | --- | --- | :-: | :-: | --- |
| 1 | **Güvenlik sınırları** | Erişim kontrolü + yarış durumu + denetim izi — **v2 buradan başlar** | `08.9.6` · `08.6.3-conflict` · `08.9.7-audit` | 27 | 32 | Üçü de ✅ · her birinde negatif + cross-tenant testi yeşil |
| 2 | **Marka izolasyonu** | Multibrand — tenant sınırının genişlemesi; **yeni yüzeyler açılmadan önce** | `Multibrand` | 8 | 10 | Multibrand ✅ · **cross-brand negatif** yeşil |
| 3 | **Routing** | Skills-based routing + supervision/takeover | `08.6.3` | 9 | 11 | 08.6.3 ✅ · yetkisiz takeover reddi + eşzamanlılık |
| 4 | **Reports** | Boyutlu kırılım · konu kümeleme · rapor grupları · zamanlanmış export | `07.5` · `07.6` · `07.7-v2` · `07.9-sched` | 39 | 45 | Dördü de ✅ · **ADR-09 tutarlılığı** korunur |
| 5 | **AI yüzeyi** | MCP server · ⌘K AI komutları · Copilot BI | `08.8.3` · `01.1.3-ai` · `12.4-bi` | 22 | 24 | Üçü de ✅ · scope + tenant izolasyonu + ADR-09 |
| 6 | **Bilgi tabanı** | Bulk/CSV import · Public KB · 31+ şablon | `06.3.2-bulk` · `Public KB` · `05.6-tmpl31` | 22 | 29 | Üçü de ✅ · **public yüzey** erişim sınırı doğrulandı |
| 7 | **Marketplace** | 100+ katalog · API paketleri · partner portalı | `09.2` · `09.3` · `09.4` | 23 | 25 | Üçü de ✅ |
| 8 | **Engage** | Traffic gelişmiş · Goals hunisi · Sales tracker | `13.2` · `13.3` · `13.5` | 28 | 32 | Üçü de ✅ · `goals` tablosu artık tüketiliyor (§8) |
| 9 | **Kanal + Vardiya** | Instagram DM (MOCK) · work scheduler | `08.5.7` · `Work scheduler` | 18 | 20 | İkisi de ✅ → **Faz-2 §F.00 kapanır** |
| | | | **9 dilim · 23 kalem** | **196** | **228** | |

**Sıra Task Master'da zorlanır (bilgi değil, kısıt):** dilim sırası yalnız bu tabloda yazılı
kalsaydı run-loop onu görmezdi — `next` seçimi önceliğe, eşitlikte görev numarasına bakar.
Bu yüzden sıra **bağımlılıkla** kodlandı: `V2-2` (Multibrand) üç güvenlik görevini bekler;
`V2-3…V2-9`'un tamamı `V2-2`'yi bekler. Böylece **önce güvenlik, sonra marka izolasyonu, sonra
geri kalan her şey (birbirine paralel)** akışı yapısal olarak garanti edilir — §5.3.1'in
gerekçesi bir tavsiye değil, grafın şekli hâline gelir. Doğrulama: panel `next` = `08.9.6`
(dilim V2-1) · 20 görev sıra bekliyor · `validate_dependencies` temiz.

### v2 (Faz 2) — düz tablo (Task Master aktarım kaynağı)

196 atomik alt-görev. Etiket = model × efor (§5.1.1). Tam alan detayı: **`PLAN-V2-KIRILIM.md`**.
Bu tablo Task Master'a **aktarıldı** (2026-08-01) — üst görev başına alt-görevler, başlıklarda etiket.

| ID | Başlık | PRD | Etiket | Bağımlılık | Dilim | Pen |
| --- | --- | --- | --- | --- | :-: | :-: |
| `08.6.3-conflict-a` | Çakışma uyarısı RTM push action'ı + composer-registry anahtar/TTL tip sözleşmesi | 08.6.3-conflict | `SONNET-XHIGH` | yok | V2-1 | 1 |
| `08.6.3-conflict-b` | ConflictDetectionService — atomik eşzamanlı-yazıcı kaydı + çakışma kararı (güven | 08.6.3-conflict | `OPUS-MAX` | 08.6.3-conflict-a | V2-1 | 2 |
| `08.6.3-conflict-c` | send_typing_indicator yolunda çakışma tespiti + uyarının bus envelope ile her ik | 08.6.3-conflict | `OPUS-XHIGH` | 08.6.3-conflict-a, 08.6.3-conflict-b | V2-1 | 1 |
| `08.6.3-conflict-d` | Transfer/atama anında aktif yazıcı çakışmasının API tarafından uyarılması | 08.6.3-conflict | `OPUS-XHIGH` | 08.6.3-conflict-a, 08.6.3-conflict-b | V2-1 | 1 |
| `08.6.3-conflict-e` | Çakışma uyarısı istemci state'i + ConflictBanner bileşeni (salt görünüm) | 08.6.3-conflict | `SONNET-XHIGH` | 08.6.3-conflict-a | V2-1 | 1 |
| `08.6.3-conflict-f` | Realtime kablolama: agent_conflict_warning aboneliği + applyPush case'i + banner | 08.6.3-conflict | `SONNET-XHIGH` | 08.6.3-conflict-c, 08.6.3-conflict-e | V2-1 | 1 |
| `08.6.3-conflict-g` | Uçtan uca doğrulama: iki-ajan çakışma senaryosu + cross-tenant/negatif süiti + k | 08.6.3-conflict | `OPUS-XHIGH` | 08.6.3-conflict-c, 08.6.3-conflict-d, 08.6.3-conflict-f | V2-1 | 1 |
| `08.9.6-a` | security_settings oturum politikası kolonları + kontrat/okuma yüzeyi (davranışsı | 08.9.6 | `SONNET-XHIGH` | — | V2-1 | 1 |
| `08.9.6-b` | ip_allowlist_entries tablosu + RLS politikası + IpAllowlistEntry şeması | 08.9.6 | `OPUS-XHIGH` | — | V2-1 | 1 |
| `08.9.6-c` | lib/ip-allowlist.ts — CIDR/IP eşleştirme algoritması + izin-ret semantiği (saf,  | 08.9.6 | `OPUS-MAX` | — | V2-1 | 1 |
| `08.9.6-d` | /settings/ip-allowlist CRUD (GET/POST/DELETE) + self-lockout guard + audit + pat | 08.9.6 | `OPUS-XHIGH` | 08.9.6-b, 08.9.6-c | V2-1 | 1 |
| `08.9.6-e` | IP allowlist enforcement — auth onRequest kapısı + trustProxy taklit yüzeyi + no | 08.9.6 | `OPUS-MAX` | 08.9.6-a, 08.9.6-b, 08.9.6-c | V2-1 | 1 |
| `08.9.6-f` | PATCH /settings/security — oturum politikası alanlarının yazma yüzeyi (validasyo | 08.9.6 | `SONNET-XHIGH` | 08.9.6-a | V2-1 | 1 |
| `08.9.6-g` | Oturum politikası enforcement — idle timeout (lastUsedAt) + lisans başına eşzama | 08.9.6 | `OPUS-MAX` | 08.9.6-a, 08.9.6-f | V2-1 | 2 |
| `08.9.6-h` | Settings ekranı — IP allowlist bölümü + oturum politikası formu | 08.9.6 | `SONNET-XHIGH` | 08.9.6-d, 08.9.6-f | V2-1 | 1 |
| `08.9.6-i` | Uçtan uca doğrulama — E2E akışı, audit görünürlüğü, proxy-IP davranışı ve istek  | 08.9.6 | `OPUS-XHIGH` | 08.9.6-d, 08.9.6-e, 08.9.6-g, 08.9.6-h | V2-1 | 1 |
| `08.9.7-a` | Audit log okuma kontratı + audit_log--all:ro scope'u + GET /audit-log (keyset, s | 08.9.7-audit | `OPUS-XHIGH` | yok | V2-1 | 2 |
| `08.9.7-b` | Audit liste filtreleri: eylem, aktör ve tarih aralığı (katkısal sorgu parametrel | 08.9.7-audit | `SONNET-XHIGH` | 08.9.7-a | V2-1 | 1 |
| `08.9.7-c` | Webhook değişimi audit'i: webhook.created / webhook.deleted eylemleri | 08.9.7-audit | `OPUS-XHIGH` | yok | V2-1 | 1 |
| `08.9.7-d` | data.deleted eylemi + ayarlar ailesi hedefli silmelerinde audit | 08.9.7-audit | `SONNET-XHIGH` | 08.9.7-c | V2-1 | 1 |
| `08.9.7-e` | İçerik ve entegrasyon silme uçlarında data.deleted audit'i | 08.9.7-audit | `SONNET-XHIGH` | 08.9.7-d | V2-1 | 1 |
| `08.9.7-f` | Rol değişimi ucu (PUT /agents/{agentId}/role) + member.role_changed audit'i | 08.9.7-audit | `OPUS-MAX` | 08.9.7-c | V2-1 | 2 |
| `08.9.7-g` | Retention politikasına audit penceresi (RETENTION_AUDIT_DAYS=30) — politika/env/ | 08.9.7-audit | `SONNET-XHIGH` | yok | V2-1 | 1 |
| `08.9.7-h` | Append-only log'da süreli budama: audit_prune_expired SECURITY DEFINER + retenti | 08.9.7-audit | `OPUS-MAX` | 08.9.7-g | V2-1 | 2 |
| `08.9.7-i` | Audit Log ekranı: salt-okunur liste + boş/skeleton/hata durumları + Settings gir | 08.9.7-audit | `SONNET-XHIGH` | 08.9.7-a | V2-1 | 1 |
| `08.9.7-j` | Audit ekranı filtreleri (eylem/tarih) + 'daha fazla yükle' + e2e görünürlük | 08.9.7-audit | `SONNET-XHIGH` | 08.9.7-b, 08.9.7-i | V2-1 | 1 |
| `08.9.7-k` | NFR-S12 uçtan uca doğrulama: dört olay + 30 gün penceresi + 'tüm planlarda' kanı | 08.9.7-audit | `OPUS-XHIGH` | 08.9.7-b, 08.9.7-c, 08.9.7-e, 08.9.7-f, 08.9.7-h, 08.9.7-j | V2-1 | 1 |
| `MULTIBRAND-a` | `brands` tablosu + license-scoped RLS + lisans başına varsayılan marka backfill | Multibrand | `OPUS-XHIGH` | yok | V2-2 | 1 |
| `MULTIBRAND-b` | Marka izolasyon çekirdeği — `app.current_brand` context + marka çözümleyici + br | Multibrand | `OPUS-MAX` | MULTIBRAND-a | V2-2 | 2 |
| `MULTIBRAND-c` | brand_id yayılımı — websites + üç singleton ayar tablosunun (widget/security/inb | Multibrand | `OPUS-XHIGH` | MULTIBRAND-b | V2-2 | 2 |
| `MULTIBRAND-d` | `/brands` CRUD kontratı + route + `brands--all` scope + `brand_not_found` hata t | Multibrand | `OPUS-XHIGH` | MULTIBRAND-a, MULTIBRAND-b | V2-2 | 1 |
| `MULTIBRAND-e` | Settings → Brands ekranı (liste + ekle + yeniden adlandır + sil + boş durum) | Multibrand | `SONNET-XHIGH` | MULTIBRAND-d | V2-2 | 1 |
| `MULTIBRAND-f` | AppShell marka değiştirici + seçili markanın persist'i + isteklerde `X-Nexa-Bran | Multibrand | `SONNET-XHIGH` | MULTIBRAND-b, MULTIBRAND-d, MULTIBRAND-e | V2-2 | 1 |
| `MULTIBRAND-g` | Marka-scoped ayar ekranlarının seçili markaya bağlanması (Widget / Websites / Ch | Multibrand | `SONNET-XHIGH` | MULTIBRAND-c, MULTIBRAND-f | V2-2 | 1 |
| `MULTIBRAND-h` | Uçtan uca cross-brand doğrulama — otomatik izolasyon test matrisi + kapsam-kaçağ | Multibrand | `OPUS-XHIGH` | MULTIBRAND-c, MULTIBRAND-g | V2-2 | 1 |
| `08.6.3-a` | Skill kataloğu veri modeli (skills + agent_skills tabloları, RLS, seed) | 08.6.3 | `OPUS-XHIGH` | — | V2-3 | 1 |
| `08.6.3-b` | Skill katalog CRUD + ajan-skill atama API'si (kontrat + rol kapılı backend) | 08.6.3 | `OPUS-XHIGH` | 08.6.3-a | V2-3 | 1 |
| `08.6.3-c` | ADR-08 routing çekirdeği: skill-eşleşmeli aday seçimi + kural koşuluna skill_ids | 08.6.3 | `OPUS-MAX` | 08.6.3-a, 08.6.3-b | V2-3 | 2 |
| `08.6.3-d` | Supervisor takeover çekirdeği: rol kapısı + eşzamanlı devir reddi + audit + RTM  | 08.6.3 | `OPUS-MAX` | — | V2-3 | 2 |
| `08.6.3-e` | Settings: Skills kataloğu bölümü + routing kuralında skill koşulu gösterimi | 08.6.3 | `SONNET-XHIGH` | 08.6.3-b, 08.6.3-c | V2-3 | 1 |
| `08.6.3-f` | Team: ajan başına skill ataması ekranı | 08.6.3 | `SONNET-XHIGH` | 08.6.3-b | V2-3 | 1 |
| `08.6.3-g` | Inbox: supervisor takeover butonu (rol kapılı, onaylı) + devir sonrası durum | 08.6.3 | `SONNET-XHIGH` | 08.6.3-d | V2-3 | 1 |
| `08.6.3-h` | Çoklu-ajan çakışma uyarısı (aynı sohbette birden fazla present ajan) | 08.6.3 | `SONNET-XHIGH` | — | V2-3 | 1 |
| `08.6.3-i` | Uçtan uca doğrulama: skill routing + takeover E2E, cross-tenant negatif matrisi, | 08.6.3 | `OPUS-XHIGH` | 08.6.3-c, 08.6.3-d, 08.6.3-e, 08.6.3-f, 08.6.3-g | V2-3 | 1 |
| `07.5-a` | ReportsBreakdown kontratına by_hour/by_team/by_channel (additive, opsiyonel) | 07.5 | `SONNET-XHIGH` | yok | V2-4 | 1 |
| `07.5-b` | Saat boyutu: breakdownByHour() + /reports/breakdown yanıtına by_hour | 07.5 | `SONNET-XHIGH` | 07.5-a | V2-4 | 1 |
| `07.5-c` | channel_messages(license_id, chat_id) indeksi + saf kanal etiketi helper'ı | 07.5 | `SONNET-XHIGH` | yok | V2-4 | 1 |
| `07.5-d` | Kanal boyutu agregasyon çekirdeği — license_id-kilitli soft-FK join + 'website'  | 07.5 | `OPUS-MAX` | 07.5-a, 07.5-c | V2-4 | 2 |
| `07.5-e` | Takım boyutu agregasyon çekirdeği — chat_access M:N fan-out + license kilidi | 07.5 | `OPUS-MAX` | 07.5-a | V2-4 | 2 |
| `07.5-f` | CSV export: breakdown grubunu dört boyuta genişlet (uzun format) | 07.5 | `SONNET-XHIGH` | 07.5-b, 07.5-d, 07.5-e | V2-4 | 1 |
| `07.5-g` | Breakdown sekmesi: "By hour" bölümü (salt-okunur tablo + empty state) | 07.5 | `SONNET-XHIGH` | 07.5-b | V2-4 | 1 |
| `07.5-h` | Breakdown sekmesi: "By team" + "By channel" bölümleri + örtüşme dipnotu | 07.5 | `SONNET-XHIGH` | 07.5-d, 07.5-e | V2-4 | 1 |
| `07.5-i` | Uçtan uca doğrulama: dört boyut çapraz-tutarlılığı + NFR-P2 bütçe ölçümü | 07.5 | `OPUS-XHIGH` | 07.5-f, 07.5-g, 07.5-h | V2-4 | 1 |
| `07.6-a` | `GET /reports/topics` kontratı + yetkili route iskeleti + yetersiz-veri (empty)  | 07.6 | `OPUS-XHIGH` | yok | V2-4 | 1 |
| `07.6-b` | Deterministik konu kümeleme çekirdeği: `packages/ai-mock/src/topics.ts` (kümelem | 07.6 | `OPUS-MAX` | 07.6-a | V2-4 | 2 |
| `07.6-c` | Kümelemeyi route'a bağla: tenant-scoped konu sorgusu + hacim/trend (önceki dönem | 07.6 | `OPUS-XHIGH` | 07.6-a, 07.6-b | V2-4 | 1 |
| `07.6-d` | Demo seed'de konu çeşitliliği: kümelenebilir sohbet özetleri | 07.6 | `SONNET-XHIGH` | 07.6-b, 07.6-c | V2-4 | 1 |
| `07.6-e` | Reports'ta 'Chat topics' sekmesi: hacim/trend listesi + yetersiz-veri empty stat | 07.6 | `SONNET-XHIGH` | 07.6-a, 07.6-c | V2-4 | 1 |
| `07.6-f` | Overview'da 'Top chat topics' promo bandı (See chat topics / Remind me later — k | 07.6 | `SONNET-XHIGH` | 07.6-e | V2-4 | 1 |
| `07.6-g` | Topics rapor grubu: `/reports/groups` kataloğu + CSV export satırı | 07.6 | `SONNET-XHIGH` | 07.6-c | V2-4 | 1 |
| `07.6-h` | Uçtan uca doğrulama: Chat topics e2e (dolu + empty) + ai-mock paylaşım regresyon | 07.6 | `OPUS-XHIGH` | 07.6-c, 07.6-d, 07.6-e, 07.6-f | V2-4 | 1 |
| `07.7-a` | Cases rapor grubu — kontrat + lisans-kapsamlı ticket sorgusu + CSV exporter | 07.7-v2 | `SONNET-XHIGH` | yok | V2-4 | 1 |
| `07.7-b` | Leads rapor grubu — organizasyon-kapsamlı `customers` verisinin lisans sınırına  | 07.7-v2 | `OPUS-MAX` | 07.7-a | V2-4 | 2 |
| `07.7-c` | Team performance rapor grubu — ajan bazlı KPI genişletmesi (mevcut by_agent üzer | 07.7-v2 | `SONNET-MAX` | 07.7-b | V2-4 | 1 |
| `07.7-d` | Sales rapor grubu — 13.5 Sales tracker'a bağlı `configured:false` dürüst iskelet | 07.7-v2 | `SONNET-XHIGH` | 07.7-c | V2-4 | 1 |
| `07.7-e` | Benchmark karşılaştırma katmanı — tüm rapor gruplarına ortak vs-baseline (lisans | 07.7-v2 | `OPUS-XHIGH` | 07.7-a, 07.7-b, 07.7-c, 07.7-d | V2-4 | 1 |
| `07.7-f` | Deterministik, bağımlılıksız PDF serializer (saf modül) — `toCsv`'nin PDF eşi | 07.7-v2 | `OPUS-XHIGH` | yok | V2-4 | 1 |
| `07.7-g` | PDF export rotası — `/reports/export` `format` parametresi + content-type/attach | 07.7-v2 | `SONNET-XHIGH` | 07.7-f, 07.7-d, 07.7-e | V2-4 | 1 |
| `07.7-h` | Reports Save view — rapora özgü kaydedilmiş görünüm (saf modül, Inbox views dese | 07.7-v2 | `SONNET-XHIGH` | yok | V2-4 | 1 |
| `07.7-i` | Reports UI — Leads + Cases sekmeleri (kartlar + benchmark rozetleri + empty stat | 07.7-v2 | `SONNET-XHIGH` | 07.7-a, 07.7-b, 07.7-e | V2-4 | 1 |
| `07.7-j` | Reports UI — Sales + Team performance sekmeleri (ajan tablosu + `configured:fals | 07.7-v2 | `SONNET-XHIGH` | 07.7-c, 07.7-d, 07.7-i | V2-4 | 1 |
| `07.7-k` | Reports UI — Export butonu (CSV/PDF indirme) + Save view çubuğu | 07.7-v2 | `SONNET-XHIGH` | 07.7-g, 07.7-h, 07.7-i, 07.7-j | V2-4 | 1 |
| `07.7-l` | Uçtan uca doğrulama — 8 grup için izin matrisi, cross-tenant süpürmesi, ağır sor | 07.7-v2 | `OPUS-XHIGH` | 07.7-a, 07.7-b, 07.7-c, 07.7-d, 07.7-e, 07.7-f, 07.7-g, 07.7-h, 07.7-i, 07.7-j, 07.7-k | V2-4 | 1 |
| `07.9-sched-a` | Şema + migration: scheduled_reports / scheduled_report_runs (RLS + dönem tekille | 07.9-sched | `OPUS-XHIGH` | yok | V2-4 | 1 |
| `07.9-sched-b` | `reports_manage` scope + kontrat/route: zamanlanmış export listeleme ve oluşturm | 07.9-sched | `OPUS-XHIGH` | 07.9-sched-a | V2-4 | 2 |
| `07.9-sched-c` | Kontrat/route: tek kayıt okuma + güncelleme + iptal (GET/PATCH/DELETE) | 07.9-sched | `OPUS-XHIGH` | 07.9-sched-b | V2-4 | 1 |
| `07.9-sched-d1` | Rapor teslim e-postası: Mailer `kind` genişletme + saf konu/gövde biçimlendirici | 07.9-sched | `SONNET-XHIGH` | yok | V2-4 | 1 |
| `07.9-sched-d2` | Rapor CSV üretimini paylaşılan `services/reports/report-csv.ts` modülüne çıkar | 07.9-sched | `SONNET-MAX` | yok | V2-4 | 1 |
| `07.9-sched-e` | Zamanlayıcı çekirdeği: dönem hesabı + tek-teslim claim (idempotens) + tenant-sco | 07.9-sched | `OPUS-MAX` | 07.9-sched-a, 07.9-sched-b, 07.9-sched-d1, 07.9-sched-d2 | V2-4 | 2 |
| `07.9-sched-f` | `scheduled-reports:run` operatör betiği + npm script (dry-run varsayılanı) | 07.9-sched | `SONNET-XHIGH` | 07.9-sched-e | V2-4 | 1 |
| `07.9-sched-g` | Teslim geçmişi okuması: kontrat + `GET /reports/scheduled-exports/{id}/runs` | 07.9-sched | `OPUS-XHIGH` | 07.9-sched-c, 07.9-sched-e | V2-4 | 1 |
| `07.9-sched-h` | Settings UI: "Scheduled exports" bölümü (liste + oluştur + iptal + son çalışma d | 07.9-sched | `SONNET-XHIGH` | 07.9-sched-c, 07.9-sched-g | V2-4 | 1 |
| `07.9-sched-i` | Uçtan uca doğrulama: cross-tenant zinciri + tekrar-tetik idempotens regresyonu + | 07.9-sched | `OPUS-XHIGH` | 07.9-sched-c, 07.9-sched-e, 07.9-sched-f, 07.9-sched-g, 07.9-sched-h | V2-4 | 1 |
| `08.8.3-a` | MCP tool kataloğu — saf veri modülü (4 tool descriptor + input şemaları) | 08.8.3 | `SONNET-XHIGH` | — | V2-5 | 1 |
| `08.8.3-b` | MCP kontratı (paths/mcp.yaml) + GET /mcp/manifest keşif ucu | 08.8.3 | `OPUS-XHIGH` | 08.8.3-a | V2-5 | 1 |
| `08.8.3-c` | Tool-call yürütücüsü — scope gate + tenant kapsamı + IDOR 404 + audit + search_t | 08.8.3 | `OPUS-MAX` | 08.8.3-a, 08.8.3-b | V2-5 | 2 |
| `08.8.3-d` | list_chats tool adaptörü (mevcut chat listeleme yoluna bağlama) | 08.8.3 | `SONNET-XHIGH` | 08.8.3-c | V2-5 | 1 |
| `08.8.3-e` | get_report tool adaptörü — `report` enum'u ile mevcut 4 rapor sorgusuna eşleme | 08.8.3 | `SONNET-XHIGH` | 08.8.3-c | V2-5 | 1 |
| `08.8.3-f` | summarize_chat tool'u + tool yanıtlarında PII/CC-mask sınırının doğrulanması | 08.8.3 | `OPUS-XHIGH` | 08.8.3-c | V2-5 | 1 |
| `08.8.3-g` | Settings → MCP bağlantı ekranı (mcp URL + Copy + Claude setup + örnek prompt) | 08.8.3 | `SONNET-XHIGH` | 08.8.3-b | V2-5 | 1 |
| `08.8.3-h` | Uçtan uca MCP istemci akışı + rate-limit kapsaması + audit doğrulaması | 08.8.3 | `OPUS-XHIGH` | 08.8.3-c, 08.8.3-d, 08.8.3-e, 08.8.3-f | V2-5 | 1 |
| `01.1.3-ai-a` | Statik aksiyon kataloğu (`actions.ts`) + `PaletteResult` birleşik tipi | 01.1.3-ai | `SONNET-XHIGH` | — | V2-5 | 1 |
| `01.1.3-ai-b` | Aksiyon sonuç tipinin scope kapısı — yetkisi olmayan aksiyon palette GÖRÜNMEZ | 01.1.3-ai | `OPUS-XHIGH` | 01.1.3-ai-a | V2-5 | 1 |
| `01.1.3-ai-c` | Aksiyon tetikleme — `run()` bağlama + optimistic durum + hata geri alma | 01.1.3-ai | `OPUS-XHIGH` | 01.1.3-ai-b | V2-5 | 1 |
| `01.1.3-ai-d` | Kontrat: `POST /palette/ai-query` + bundle + tip üretimi | 01.1.3-ai | `SONNET-XHIGH` | — | V2-5 | 1 |
| `01.1.3-ai-e` | AI sorgu endpoint'i — scope kapısı + tenant izolasyonu + deterministik cevap (re | 01.1.3-ai | `OPUS-MAX` | 01.1.3-ai-d | V2-5 | 2 |
| `01.1.3-ai-f` | Palette'te AI sorgu sonuç tipi + cevap kartı + boş/anlaşılmadı durumları | 01.1.3-ai | `SONNET-XHIGH` | 01.1.3-ai-e | V2-5 | 1 |
| `01.1.3-ai-g` | Klavye/a11y: ↑↓/esc üç sonuç tipinde de tutarlı (NFR-A11Y6 regresyonu) | 01.1.3-ai | `SONNET-XHIGH` | 01.1.3-ai-c, 01.1.3-ai-f | V2-5 | 1 |
| `01.1.3-ai-h` | Uçtan uca doğrulama + kapanış: tam DoD, e2e, PLAN/HANDOFF izleri | 01.1.3-ai | `OPUS-XHIGH` | 01.1.3-ai-c, 01.1.3-ai-f, 01.1.3-ai-g | V2-5 | 1 |
| `12.4-bi-a` | Kontrat: `POST /copilot/bi` anchor'ı + bundle + tip üretimi | 12.4-bi | `SONNET-XHIGH` | — | V2-5 | 1 |
| `12.4-bi-b` | `@nexa/ai-mock`'ta soru → rapor metriği eşleyici (deterministik, LLM yok) | 12.4-bi | `OPUS-XHIGH` | — | V2-5 | 1 |
| `12.4-bi-c` | BI endpoint çekirdeği — scope birleşimi + müşteri-token sınırı + tenant izolasyo | 12.4-bi | `OPUS-MAX` | 12.4-bi-a, 12.4-bi-b | V2-5 | 2 |
| `12.4-bi-d` | CopilotPanel'de BI soru girişi + cevap kartı | 12.4-bi | `SONNET-XHIGH` | 12.4-bi-c | V2-5 | 1 |
| `12.4-bi-e` | Anlaşılmadı / yetersiz veri durumları — anlamlı empty state + örnek sorular | 12.4-bi | `SONNET-XHIGH` | 12.4-bi-d | V2-5 | 1 |
| `12.4-bi-f` | Uçtan uca doğrulama + ADR-09 çapraz kontrolü + kapanış | 12.4-bi | `OPUS-XHIGH` | 12.4-bi-d, 12.4-bi-e | V2-5 | 1 |
| `06.3.2-bulk-a` | RFC4180 CSV ayrıştırıcı + formül-enjeksiyon nötrleme (saf modül, lineer zaman) | 06.3.2-bulk | `OPUS-MAX` | — | V2-6 | 2 |
| `06.3.2-bulk-b` | CSV satır şeması: kolon eşleme + satır-başı doğrulama (saf modül) | 06.3.2-bulk | `SONNET-XHIGH` | — | V2-6 | 1 |
| `06.3.2-bulk-c` | POST /knowledge-sources/bulk — kontrat + route: tenant sahipliği, satır tavanı,  | 06.3.2-bulk | `OPUS-MAX` | 06.3.2-bulk-a, 06.3.2-bulk-b | V2-6 | 2 |
| `06.3.2-bulk-d` | Frontend saf yardımcılar: örnek CSV şablonu katalogu + dosya okuma/ön-kontrol mo | 06.3.2-bulk | `SONNET-XHIGH` | — | V2-6 | 1 |
| `06.3.2-bulk-e` | Knowledge panelinde "Bulk import" formu: dosya seç → dry-run önizleme | 06.3.2-bulk | `SONNET-XHIGH` | 06.3.2-bulk-c, 06.3.2-bulk-d | V2-6 | 1 |
| `06.3.2-bulk-f` | İçe aktarma sonuç tablosu: satır no / başlık / durum / hata + kısmi-başarı özeti | 06.3.2-bulk | `SONNET-XHIGH` | 06.3.2-bulk-e | V2-6 | 1 |
| `06.3.2-bulk-g` | CSV'de website satırları: satır-başı SSRF guard + crawl'ın transaction DIŞINDA,  | 06.3.2-bulk | `OPUS-MAX` | 06.3.2-bulk-c | V2-6 | 2 |
| `06.3.2-bulk-h` | Uçtan uca doğrulama: E2E CSV içe aktarma akışı + RAG'de aranabilirlik + regresyo | 06.3.2-bulk | `OPUS-XHIGH` | 06.3.2-bulk-f, 06.3.2-bulk-g | V2-6 | 1 |
| `05.6-tmpl31-a` | Katalog şeması genişletme: rozet alanı (Popular/Essential) + invariant testlerin | 05.6-tmpl31 | `SONNET-XHIGH` | — | V2-6 | 1 |
| `05.6-tmpl31-b` | 23+ yeni şablon kaydı — katalog 8 → 31+ | 05.6-tmpl31 | `SONNET-MAX` | 05.6-tmpl31-a | V2-6 | 2 |
| `05.6-tmpl31-c` | Katalog i18n: şablon metinleri TR/EN (NFR-I18N2) | 05.6-tmpl31 | `SONNET-XHIGH` | 05.6-tmpl31-b | V2-6 | 1 |
| `05.6-tmpl31-d` | Galeri ölçek davranışı: arama + kategori filtresi + sanal liste (31+ kart) | 05.6-tmpl31 | `SONNET-XHIGH` | 05.6-tmpl31-b | V2-6 | 1 |
| `05.6-tmpl31-e` | Kapanış: tam DoD + galeri e2e regresyonu + PLAN/HANDOFF izleri | 05.6-tmpl31 | `SONNET-XHIGH` | 05.6-tmpl31-c, 05.6-tmpl31-d | V2-6 | 1 |
| `PUBKB-a` | Public KB veri modeli: kb_articles + kb_categories + kb_settings (RLS'li migrati | Public KB | `SONNET-XHIGH` | yok | V2-6 | 1 |
| `PUBKB-b` | Yönetim (agent-auth) KB CRUD kontratı + backend + yayın (draft/published) durumu | Public KB | `OPUS-XHIGH` | PUBKB-a | V2-6 | 2 |
| `PUBKB-c` | Anonim public okuma çekirdeği (BÖLÜNMEZ): slug→license çözümleyici + yayın filtr | Public KB | `OPUS-MAX` | PUBKB-a, PUBKB-b | V2-6 | 2 |
| `PUBKB-d` | Makale gövdesi güvenli render çekirdeği (BÖLÜNMEZ): escape-first sınırlı markdow | Public KB | `OPUS-MAX` | yok | V2-6 | 1 |
| `PUBKB-e` | SEO'lu sunucu-render HTML yüzeyi: KB ana sayfası + makale sayfası (title/meta/ca | Public KB | `OPUS-XHIGH` | PUBKB-c, PUBKB-d | V2-6 | 2 |
| `PUBKB-f` | sitemap.xml + robots.txt (yalnız yayınlanmış makaleler, XML-escape'li) | Public KB | `SONNET-XHIGH` | PUBKB-c, PUBKB-e | V2-6 | 1 |
| `PUBKB-g` | Admin: KB makale listesi + durum sekmeleri (All/Published/Drafts) + anlamlı empt | Public KB | `SONNET-XHIGH` | PUBKB-b | V2-6 | 1 |
| `PUBKB-h` | Admin: makale editörü (içerik + SEO alanları) + publish/unpublish + public link | Public KB | `SONNET-XHIGH` | PUBKB-b, PUBKB-g | V2-6 | 1 |
| `PUBKB-i` | Uçtan uca doğrulama: anonim okuyucu e2e + izolasyon/SEO kanıt seti | Public KB | `OPUS-XHIGH` | PUBKB-c, PUBKB-e, PUBKB-f, PUBKB-h | V2-6 | 1 |
| `09.2-v2-a` | Marketplace liste kontratı — arama/kategori/sayfalama parametreleri + sayfalama  | 09.2 | `SONNET-XHIGH` | yok | V2-7 | 1 |
| `09.2-v2-b` | Saf katalog filtre + sayfalama fonksiyonları (@nexa/types) + determinizm testler | 09.2 | `SONNET-XHIGH` | yok | V2-7 | 1 |
| `09.2-v2-c` | GET /settings/apps sorgu bağlama — zod parse + sayfalama + tenant join korunumu | 09.2 | `OPUS-XHIGH` | 09.2-v2-a, 09.2-v2-b | V2-7 | 1 |
| `09.2-v2-d` | Katalog verisi 20 → 60 kart (mock, mevcut 8 kategori) + üst-sınır iddialarının k | 09.2 | `SONNET-MAX` | yok | V2-7 | 1 |
| `09.2-v2-e` | Katalog verisi 60 → 100+ kart + "100+" hedefinin testle sabitlenmesi | 09.2 | `SONNET-MAX` | 09.2-v2-d | V2-7 | 1 |
| `09.2-v2-f` | Marketplace arama kutusu + tıklanabilir kategori filtresi + empty/skeleton durum | 09.2 | `SONNET-XHIGH` | 09.2-v2-c | V2-7 | 1 |
| `09.2-v2-g` | Virtualized kart grid'i + sayfa zinciri (NFR-P4 "yalnız görünür satır DOM'da") | 09.2 | `OPUS-XHIGH` | 09.2-v2-f, 09.2-v2-e | V2-7 | 1 |
| `09.2-v2-h` | Uçtan uca doğrulama — 100+ katalogla e2e + NFR-P4 ölçüm notu + izolasyon/kontrat | 09.2 | `OPUS-XHIGH` | 09.2-v2-c, 09.2-v2-e, 09.2-v2-g | V2-7 | 1 |
| `09.3-a` | Statik API paket kataloğu + tipleri (@nexa/types) | 09.3 | `SONNET-XHIGH` | — | V2-7 | 1 |
| `09.3-b` | api_package_purchases tablosu: Prisma modeli + migration + RLS politikası | 09.3 | `OPUS-XHIGH` | 09.3-a | V2-7 | 1 |
| `09.3-c` | Okuma yüzeyi: GET /billing/api-packages (katalog) + GET /billing/api-packages/pu | 09.3 | `OPUS-XHIGH` | 09.3-a, 09.3-b | V2-7 | 1 |
| `09.3-d` | Paket satın alma çekirdeği: POST /billing/api-packages + atomik kota artışı (moc | 09.3 | `OPUS-MAX` | 09.3-a, 09.3-b, 09.3-c | V2-7 | 2 |
| `09.3-e` | Satın alınan paketin fatura satır kalemi (invoice line_item) | 09.3 | `SONNET-XHIGH` | 09.3-d | V2-7 | 1 |
| `09.3-f` | Billing ekranında API paketleri bölümü: kartlar + mock satın alma akışı | 09.3 | `SONNET-XHIGH` | 09.3-c, 09.3-d | V2-7 | 1 |
| `09.3-g` | Satın alma geçmişi listesi (UI) + empty state | 09.3 | `SONNET-XHIGH` | 09.3-c, 09.3-f | V2-7 | 1 |
| `09.3-h` | Uçtan uca doğrulama: satın alma → kota artışı → geçmiş → fatura (E2E + seed) | 09.3 | `OPUS-XHIGH` | 09.3-e, 09.3-f, 09.3-g | V2-7 | 1 |
| `09.4-a` | Zapier + Make marketplace kartları ve katalog sınır güncellemesi | 09.4 | `SONNET-XHIGH` | yok | V2-7 | 1 |
| `09.4-b` | Entegrasyon manifesti (trigger + action kataloğu): kontrat + statik endpoint | 09.4 | `SONNET-XHIGH` | yok | V2-7 | 1 |
| `09.4-c` | Partner app kaydı çekirdeği: oauth_clients self-servis CRUD (client_id / secret_ | 09.4 | `OPUS-MAX` | yok | V2-7 | 2 |
| `09.4-d` | Partner app secret rotate + denetim izi (partner_app.* audit olayları) | 09.4 | `OPUS-XHIGH` | 09.4-c | V2-7 | 1 |
| `09.4-e` | Developer portal kabuğu: partner app listesi + kayıt formu + 'secret bir kez' pa | 09.4 | `SONNET-XHIGH` | 09.4-c | V2-7 | 1 |
| `09.4-f` | Portal'da Zapier REST Hooks yüzeyi: webhook aboneliği yönetimi + trigger manifes | 09.4 | `SONNET-XHIGH` | 09.4-b, 09.4-d, 09.4-e | V2-7 | 1 |
| `09.4-g` | Uçtan uca partner akışı doğrulaması: kayıtlı client ile OAuth 2.1 authorize→toke | 09.4 | `OPUS-XHIGH` | 09.4-c, 09.4-d, 09.4-e, 09.4-f | V2-7 | 1 |
| `13.2-a` | TrafficActivity sözlüğünün supervised + invited ile genişletilmesi (kontrat + ti | 13.2 | `SONNET-XHIGH` | yok | V2-8 | 1 |
| `13.2-b` | `invited` durumu: campaign_sends'ten türetme + funnel öncelik kararı (backend) | 13.2 | `OPUS-XHIGH` | 13.2-a | V2-8 | 1 |
| `13.2-c` | `chat_supervisions` tablosu + RLS politikası + Prisma modeli (yalnız migration,  | 13.2 | `OPUS-XHIGH` | yok | V2-8 | 1 |
| `13.2-d` | Supervision register/release API + yetki sınırı + heartbeat (BÖLÜNMEZ GÜVENLİK Ç | 13.2 | `OPUS-MAX` | 13.2-c | V2-8 | 2 |
| `13.2-e` | `supervised` durumunun Traffic funnel'ına bağlanması + öncelik sırası | 13.2 | `OPUS-XHIGH` | 13.2-a, 13.2-d | V2-8 | 1 |
| `13.2-f` | "Match all filters + Add filter": GET /traffic çoklu-koşul filtre çekirdeği (kon | 13.2 | `OPUS-MAX` | 13.2-a, 13.2-b, 13.2-e | V2-8 | 2 |
| `13.2-g` | Traffic durum sekmeleri (All/Chatting/Supervised/Queued/Waiting/Invited/Browsing | 13.2 | `SONNET-XHIGH` | 13.2-f | V2-8 | 1 |
| `13.2-h` | "Match all filters + Add filter" filtre paneli UI + query builder | 13.2 | `SONNET-XHIGH` | 13.2-f, 13.2-g | V2-8 | 1 |
| `13.2-i` | CustomerDetail'e `visits_count` + `groups[]` (kontrat + servis) | 13.2 | `SONNET-XHIGH` | yok | V2-8 | 1 |
| `13.2-j` | Ziyaretçi 360° panel: N visits özeti + Came from + Groups kartları (UI) | 13.2 | `SONNET-XHIGH` | 13.2-i | V2-8 | 1 |
| `13.2-k` | Uçtan uca doğrulama: E2E (sekme + filtre + supervise + 360° panel) + NFR-P2 ölçü | 13.2 | `OPUS-XHIGH` | 13.2-a, 13.2-b, 13.2-c, 13.2-d, 13.2-e, 13.2-f, 13.2-g, 13.2-h, 13.2-i, 13.2-j | V2-8 | 1 |
| `13.3-a` | Goal veri sözlüğü — @nexa/types tipleri + OpenAPI component şemaları (path YOK) | 13.3 | `SONNET-XHIGH` | — | V2-8 | 1 |
| `13.3-b` | goal_achievements tablosu + RLS politikası + idempotency kısıtı (Prisma migratio | 13.3 | `OPUS-XHIGH` | — | V2-8 | 1 |
| `13.3-c` | Goals CRUD — kontrat path + route + servis (license-scoped, .strict() definition | 13.3 | `OPUS-XHIGH` | 13.3-a | V2-8 | 1 |
| `13.3-d` | Hedef eşleşme + achievement kaydı çekirdeği — idempotent tetik, ziyaretçi yazma  | 13.3 | `OPUS-MAX` | 13.3-b, 13.3-c | V2-8 | 2 |
| `13.3-e` | /reports/overview "Achieved goals" sayacı (pencere + önceki pencere karşılaştırm | 13.3 | `SONNET-XHIGH` | 13.3-b, 13.3-d | V2-8 | 1 |
| `13.3-f` | GET /reports/goals — 3 aşamalı huni raporu + rapor grubu + CSV export | 13.3 | `OPUS-XHIGH` | 13.3-b, 13.3-c, 13.3-d | V2-8 | 1 |
| `13.3-g` | Goals ekranı — liste + Create goal formu (Customers alanının 4. sekmesi) | 13.3 | `SONNET-XHIGH` | 13.3-c | V2-8 | 1 |
| `13.3-h` | 3 aşamalı huni gösterimi (Goals ekranı) + Reports Overview "Achieved goals" KPI  | 13.3 | `SONNET-XHIGH` | 13.3-e, 13.3-f, 13.3-g | V2-8 | 1 |
| `13.3-i` | Uçtan uca doğrulama — ziyaret→sohbet→hedef E2E + çapraz-tenant regresyon kapanış | 13.3 | `OPUS-XHIGH` | 13.3-d, 13.3-e, 13.3-f, 13.3-g, 13.3-h | V2-8 | 1 |
| `13.5-a` | Sales tracker veri modeli — sales_tracker_settings (lisans-tekil) + tracked_sale | 13.5 | `SONNET-XHIGH` | 13.3 Goals (dış bağımlılık — orkestratörün bağlayıcı kararı: 13.3 önce; `goals` tablosu şemada var ama 0 tüketici, bu kalem başlamadan 13.3'ün CRUD+UI'si bitmeli) | V2-8 | 1 |
| `13.5-b` | Sales tracker konfigürasyon endpoint'i — GET/PUT /settings/sales-tracker (kontra | 13.5 | `OPUS-XHIGH` | 13.5-a | V2-8 | 1 |
| `13.5-c` | Tracked-sale ingest + atıf (attribution) çekirdeği — POST /customer/chat/sale (B | 13.5 | `OPUS-MAX` | 13.5-a, 13.5-b | V2-8 | 2 |
| `13.5-d` | GET /reports/reviews ecommerce bloğunu gerçek veriyle doldur — trackedSalesSumma | 13.5 | `OPUS-XHIGH` | 13.5-b, 13.5-c | V2-8 | 1 |
| `13.5-e` | Settings ekranı — 'Sales tracker' bölümü (enabled / currency / atıf penceresi fo | 13.5 | `SONNET-XHIGH` | 13.5-b | V2-8 | 1 |
| `13.5-f` | Reports/Reviews — Ecommerce KPI'ları + dürüst empty state + 'Configure sales pla | 13.5 | `SONNET-XHIGH` | 13.5-d, 13.5-e (CTA'nın hedefi olan Settings bölümü var olmalı) | V2-8 | 1 |
| `13.5-g` | Widget izleme kodu — nexa('trackSale', …) JS API + kurulum snippet'i | 13.5 | `SONNET-XHIGH` | 13.5-c | V2-8 | 1 |
| `13.5-h` | Uçtan uca doğrulama — seed/demo verisi + e2e (izleme kodu → Reports Ecommerce) + | 13.5 | `OPUS-XHIGH` | 13.5-d, 13.5-e, 13.5-f, 13.5-g, 13.3 Goals (dış bağımlılık — tutarlılık kontrolü için teslim olmalı) | V2-8 | 1 |
| `08.5.7-a` | Instagram kanal tipinin kontrata eklenmesi (ChannelType enum + connect/webhook g | 08.5.7 | `SONNET-XHIGH` | yok | V2-9 | 1 |
| `08.5.7-b` | InstagramAdapter — parseConnect/parseInbound/send (MOCK) + adapter unit testleri | 08.5.7 | `SONNET-XHIGH` | 08.5.7-a | V2-9 | 1 |
| `08.5.7-c` | instagram'ın adapter kanalı olarak devreye alınması (CHANNEL_TYPES + registry) + | 08.5.7 | `OPUS-XHIGH` | 08.5.7-a, 08.5.7-b | V2-9 | 1 |
| `08.5.7-d` | Kanal adresinin lisanslar arası tekilliği — çakışan adres bağlamanın reddi (bölü | 08.5.7 | `OPUS-MAX` | 08.5.7-c | V2-9 | 2 |
| `08.5.7-e` | Settings → Channels: Instagram kartının statik 'Coming soon'dan canlı connect/di | 08.5.7 | `SONNET-XHIGH` | 08.5.7-c | V2-9 | 1 |
| `08.5.7-f` | 'Get notified' kaydının kalıcılaştırılması (kalan coming-soon kanalları) | 08.5.7 | `SONNET-XHIGH` | 08.5.7-e | V2-9 | 1 |
| `08.5.7-g` | Inbox Views grubunda Instagram kanal görünümü | 08.5.7 | `SONNET-XHIGH` | 08.5.7-c | V2-9 | 1 |
| `08.5.7-h` | Uçtan uca doğrulama: Instagram bağla → DM gelsin → inbox'ta chat (e2e) | 08.5.7 | `OPUS-XHIGH` | 08.5.7-e, 08.5.7-g | V2-9 | 1 |
| `WORKSCHED-a` | Work schedule kontratı + @nexa/types haftalık plan tipi ve normalizer | Work scheduler | `SONNET-XHIGH` | yok | V2-9 | 1 |
| `WORKSCHED-b` | work_schedules + agent_presence_events tabloları, Prisma modelleri ve RLS migrat | Work scheduler | `OPUS-XHIGH` | WORKSCHED-a | V2-9 | 1 |
| `WORKSCHED-c` | GET/PUT /agents/{agentId}/work-schedule — scope kapısı ve self-vs-admin yetkilen | Work scheduler | `OPUS-XHIGH` | WORKSCHED-a, WORKSCHED-b | V2-9 | 1 |
| `WORKSCHED-d` | Presence olay günlüğü yazma yolu + planlı vardiya ↔ manuel routingStatus öncelik | Work scheduler | `OPUS-MAX` | WORKSCHED-b | V2-9 | 2 |
| `WORKSCHED-e` | /reports/breakdown yanıtına saat-bazlı hacim kırılımı (by_hour) | Work scheduler | `SONNET-XHIGH` | yok | V2-9 | 1 |
| `WORKSCHED-f` | Deterministik staffing tahmin çekirdeği (saf modül, LLM yok — bölünmez) | Work scheduler | `OPUS-MAX` | yok | V2-9 | 1 |
| `WORKSCHED-g` | GET /reports/staffing-forecast — kontrat + üç girdinin tek yanıta bağlanması | Work scheduler | `OPUS-XHIGH` | WORKSCHED-b, WORKSCHED-d, WORKSCHED-e, WORKSCHED-f | V2-9 | 1 |
| `WORKSCHED-h` | Team → Work schedule düzenleyici (haftalık ızgara + timezone + alan-altı hata) | Work scheduler | `SONNET-XHIGH` | WORKSCHED-a, WORKSCHED-c | V2-9 | 1 |
| `WORKSCHED-i` | Reports → Staffing sekmesi (salt-okunur gün × saat ızgarası + düşük-baz uyarısı) | Work scheduler | `SONNET-XHIGH` | WORKSCHED-g | V2-9 | 1 |
| `WORKSCHED-j` | Uçtan uca doğrulama: staffing e2e akışı + izolasyon iddiaları + ADR-09 sayı tuta | Work scheduler | `OPUS-XHIGH` | WORKSCHED-c, WORKSCHED-d, WORKSCHED-g, WORKSCHED-h, WORKSCHED-i | V2-9 | 1 |


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
- **A11 (GL-7 · spam filtre davranışı · tm 69):** FR-MOD-08.9.3 spam kararının davranışı task
  içinde kararlaştırıldı (§4.5/GL-7(c) gereği). **Karar:** widget chat yolu **zarflı red** — filtre
  açıkken chat-start mesajı spam sınıflanırsa `ApiError('message_rejected', 403)` (jenerik _"This
  message could not be sent."_). Gerekçe: (a) senkron widget isteğinin chat reddedilince döneceği
  bir gövdesi (`chat_id`) yok — sessiz 2xx yanlış-pozitif ziyaretçiyi hiç yanıtlanmayacak bir mesaja
  bakar bırakır (e-postanın aksine, orada bekleyen insan yok); (b) aynı endpoint'teki kardeş
  banned-IP reddi (`customer_banned`, zarflı) ile tutarlı; (c) mesaj **jeneriktir** → hangi kuralın
  tetiklendiğini söylemez, filtre problanamaz. **E-posta yolu sessiz** kalır
  (`{status:'ignored',reason:'spam'}`, HTTP 200) — async webhook, sağlayıcı tekrar denemesin.
  **Kapsam:** yalnız chat-**START** taranır (kurulu sohbetteki sonraki mesaj değil) — spam kuyruğu
  orada taşırır; kurulu bir konuşmayı ortada kesmek yanlış-pozitif maliyetini meşru ziyaretçiye
  yükler. İki yol da tek motor `evaluateSpam` (`services/security/spam-filter.ts`) — tek doğruluk
  kaynağı. Doğrulama: §D59.

- **A12 (v2 kapsam süpürmesi · §5.5 MOD-04 "○" · 2026-08-01):** PRD §5.5 modül→faz matrisi
  `MOD-04 Team/roller/teams` satırının **v2 sütununda çıplak bir `○`** var (v1'de `○`, Ent.'te
  `○ (SCIM)` — sonuncusu etiketli, v2'ninki değil). PRD §6'da `MOD-04` için `(v2)` önceliği taşıyan
  **hiçbir `FR-MOD` satırı yok**; yani ne kapsam ne kabul kriteri tanımlı. **Varsayım:** matristeki
  etiketsiz `○`, "bu modül sonraki fazlarda da evrilmeye devam eder" anlamında bir **yön işareti**dir,
  ayrı bir gereksinim değildir. → v2 için **ayrı iş kalemi açılmadı**. Aksi ortaya çıkarsa (kullanıcı
  somut kapsam yazarsa) yeni kalem olarak §5'e eklenir. Bkz. §D62.

- **A13 (v2 kapsam süpürmesi · §5.5 MOD-06 "○" · 2026-08-01):** Aynı gerekçe `MOD-06 AI Agent + RAG`
  v2 hücresi için. `MOD-06`'nın `(v2)` önceliği taşıyan tek içeriği **`06.3.2`'nin bulk/CSV import
  payı**dır (satırın kendisi `Must (v1)`, `bulk/CSV import` kanadı bilinçli olarak v2'ye bırakıldı —
  §4.4 GL-1 notu). **Varsayım:** MOD-06'nın v2 payı = `06.3.2-bulk`; ayrı kalem açılmadı. Bkz. §D62.

- **A14 (v2 kapsam süpürmesi · "31+ şablon" ADR-14 altında · 2026-08-01):** PRD §5.3'ün `Otomasyon`
  hücresi _"NL skill + **görsel node/edge Workflow builder** (Workspace skill) + canlı preview;
  **31+ şablon**"_ der. Görsel builder **ADR-14 ile ⛔** (UI yapılmaz, `workflows` tablosu şemada
  kalır) — dolayısıyla "31+ şablon" hedefi de teknik olarak sahipsiz kalıyordu. **Varsayım:** şablon
  **sayısı** hedefi ADR-14'ten bağımsız olarak onurlandırılabilir, çünkü **Skill şablon galerisi**
  (05.1/05.2) v1'de ✅ teslim edildi ve **kendi deterministik yerel kataloğu** var. → İş kalemi
  `05.6-tmpl31` olarak açıldı: skill şablon kataloğunu 31+'a çıkar. **Görsel canvas YAPILMAZ** —
  ADR-14 aynen geçerli. Bkz. §D62.

- **A15 (WORKSCHED-d · planlı vardiya ↔ manuel routingStatus önceliği · tm 77.4 · 2026-08-08):**
  PRD §5.3-Vardiya "work scheduler" satırının KK sütunu yok ve §6'da karşılığı yok; iki
  uygunluk kavramının çakıştığında hangisinin kazandığı yazılı değil. **Varsayım:** manuel
  `routing_status` HER ZAMAN planlı vardiyayı ezer. `work_schedules` yalnız **beklenen kapasite
  girdisidir** — routing/atama kararına hiç girmez, iki yönde de: vardiyada olan ama manuel
  `offline` ajan kuyruktan sohbet ALMAZ, vardiyası kapalı ama `accepting_chats` olan ajan ALIR.
  Gerekçe: ADR-08 aday havuzu zaten `m.routing_status = 'accepting_chats'` üzerine kurulu
  (`routing-service.ts`) ve uygunluk ajanın **rıza gösterdiği** bir durumdur — planın onu
  sürüklemesi ajanı masasında olmadığı anda müşteriye bağlar. Bunun doğal sonucu: **vardiya
  başında ajanı otomatik `accepting_chats`'e geçirme YAPILMAZ** (§5.2.22 açık soru 3); istenirse
  ayrı bir OPUS-MAX kalemidir (zamanlanmış iş + kuyruk yan etkisi + rıza sınırı). Kural testle
  sabitlendi: `routing.test.ts` "rostered hours vs routing status" (2) + `presence-log.test.ts`
  drainQueue yönü. Çatışma **hata değil karardır** → yeni `ApiError` tipi açılmadı.

- **A16 (13.2-l · `visits.came_from` ne kadarını saklıyoruz · NFR-S9 · tm 111 · 2026-08-10):**
  PRD `came_from`'u yalnız "nereden geldi" diye tanımlar; referrer'ın ne kadarının saklanacağı
  yazılı değil ve referrer bir DIŞ URL'dir — query string'i parola sıfırlama token'ı, oturum
  kimliği veya e-posta adresi taşıyabilir. **Karar: yalnız origin + path saklanır; query string
  ve fragment düşürülür.** Gerekçe: `hostPageUrl`'ün (ziyaret edilen sayfa) aynı kararı zaten
  var — bir destek transkripti bu değerlerin görüneceği son yerdir — ve ajanın sorduğu soruyu
  ("hangi siteden/hangi sayfadan geldi") path yanıtlar. Kural TEK yerde: `@nexa/types`
  `sanitizeReferrer`; **iki kez** uygulanır — loader host sayfada (düşen kısım ziyaretçinin
  tarayıcısından hiç çıkmasın) ve servis yazmadan önce (gövde istemci girdisidir, elle
  hazırlanmış bir istek istediğini gönderir). URL olarak ayrıştırılamayan bir referrer
  (`android-app://…`) olduğu gibi saklanır — kırpılacak query string'i yoktur. Panelde düz
  metin olarak render edilmesi kararı (13.2-j) korunur, link yapılmaz. Bunun kabul edilen
  maliyeti: kampanya/attribution için UTM parametreleri saklanmaz; istenirse ayrı bir iş
  kalemidir (13.2-l KAPSAM DIŞI).

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
- **D54 (GL-2 · PARK-a · tm 86 · 2026-07-31 · D-PARK):** `.parked-playbook/` (6 dosya: `SkillBrowser.tsx`/`.test`, `RecommendedSkills.tsx`/`.test`, `skill-filters.ts`/`.test`; 25 Tem parked WIP) **silindi**. **Karar = SİL** (entegre etme değil), üç muadil-eşlemesinin dosya-dosya diff'iyle gerekçelendi: (1) **`RecommendedSkills.tsx`** → teslim edilen `apps/web/src/features/playbook/RecommendedSkills.tsx` (tm 32) daha eksiksiz — PlaybookPage'e bağlı, `role="list"/"listitem"` a11y, "See more" tam galeriyi (`TemplateGallery`) açıyor (parked'ın inline 4→hepsi `showAll` toggle'ı yerine üstün UX); parked'ın tek ayrık davranışı (inline genişletme) aşılmış tasarım, benzersiz değer yok; teslim tarafı `RecommendedSkills.test.tsx` ile testli. (2) **`skill-filters.ts`** → teslim, **bölünmüş süperküme**: `skill-tabs.ts` (`classifySkill`/`filterSkillsByTab`/`countSkillsByTab`) + `skill-filter.ts` (`applySkillControls`/`skillMatchesControls`/`hasActiveSkillFilters`/`skillOwnerOptions`) — parked'ın `matchesTab`/`tabCounts`/`selectSkills`/`isFiltering`'inin tümü karşılanıyor + teslim `skillOwnerOptions` ve generic `SkillFacet` tiplemesi ekliyor; ikisi de testli (`skill-filter.test.ts` 16 · `skill-tabs.test.ts` 12). (3) **`SkillBrowser.tsx`** (task'ın "en zayıf eşleme" uyardığı dosya) → ayrı 1:1 dosya yok ama tüm davranışı **`PlaybookPage.tsx`'e inline** teslim: Skills tablist+sayaçlar (`countSkillsByTab`), debounce'lu ad araması (200ms), tip/durum/sahip Select'leri, `VirtualList` satırları (enable/disable + "needs a step" ipucu), boş durumlar (`hasActiveSkillFilters` no-skills vs no-match). **Ölü kod:** repoda hiçbir yer parked dosyaları veya modül adlarını (`parked-playbook`/`skill-filters`/`SkillBrowser`) import etmiyor → §F.1/6 sessiz-borç + §F.1/7 ölü-kod kirliliği. **Not:** dir aslında `878d640` snapshot'ında commit'lenmişti (HANDOFF "untracked" notu bayattı) → `git rm -r` şimdi izlenen ölü kodu da temizledi. **Kanıt (exit 0):** web typecheck · lint · unit **445**/65 (baz D51 445 ile aynı → parked testleri web süitinde hiç yoktu, silme regresyonsuz); `git status` untracked **0**. Parked dosyalar kök `.parked-playbook/`'ta, hiçbir paketin tsconfig/eslint/vitest kapsamında değil → typecheck/lint/build/integration/e2e yapısal olarak etkilenmez (D49/D50/D51 "additive/yapısal no-op → odaklı kapı" emsali). Kapsam: yalnız tm 86 + silme + §D + HANDOFF.
- **D55 (GL-3 · F0-KAPAT · tm 87 · 2026-07-31 · Faz-0 kapanış turu):** Faz-0 §F.00 kapandı — §F.1'in **10 maddesi tam sürüm** koda karşı koşuldu, sayaç sayılarak doğrulandı, üst tablo `✅ KAPALI`'ya çevrildi. **Sayım (§F.1/1 + subtask 1):** Faz-0 `Must` = §3.0–§3.10 modül tablolarında **48 ✅** (00:3·01:4·02:11·03:2·04:6·06:0·07:1·08:10·10:5·11:5·13:1) + 3 EK (§7.1) = **51**; beklenen `51 ✅ · 0 ◐ · 0 ⬜` doğrulandı. **Uyuşmazlık bulundu ve giderildi:** üst-tablo "Must sayacı" `45 ✅ · 6 ◐` bayattı (2026-07-25 damgası) — 01.3/02.4/13.8 D23/D24/D26'da modül tablolarında `◐`→`✅` çevrilmişti ama sayaç güncellenmemişti (§D'deki 2026-07-26 "Genel durum" düzeltmesinin ikizi, "Must sayacı" sütununda tekrarı); EK-A.1/EK-A.2/EK-B.1 ise tm 29/30'da teslim edilmiş ama §7.1 satırları `◐` kalmıştı ("TM'de bitti, PLAN'da ◐" deseni — §D52/§D53 · panel bulgusu). **3 bayat satır + NFR P4 kanıtla `◐`→`✅` (kod DEĞİŞMEDİ, "verify+close, don't rebuild"):** EK-A.1=`lib/form.tsx` (`form.test.tsx` 13), EK-A.2=`lib/dirty-guard.tsx`+`stepper.ts`+`optimistic.ts` (6+5+3), EK-B.1=`VirtualList.tsx`+`Skeleton.tsx`+`EmptyState.tsx` (10+7), P4=`VirtualList.test.tsx` "NFR-P4 budget 10k satır 60fps proxy". **§F.1 10-madde kanıt (HANDOFF §F.2):** (1) kapsam süpürmesi=sayım yukarıda, 0 ◐; (2) faz sızıntısı=YOK (§3.0–§3.10'da yalnız Faz-0 ID; v1/v2 grup-🔒, sayılmaz; belgeli öne-çekmeler §1.3/§D52); (3) NFR ölçüldü — P1 13ms·P3 gzip `bundle-size.test.ts`·P4 10k proxy·S1–S5 34 integration dosyasında cross-tenant/IDOR negatifi·a11y aria assertion'ları+⌘K; (4) şema artıkları §8 tablosu belgeli (workflows ⛔ ADR-14 UI'sız; webhooks/channels/goals 0-tüketici→v1/v2, §G'de izli); (5) contract-parity **5/5**; (6) sessiz borç **temiz** (0 TODO/FIXME/XXX/@ts-expect-error/skip/only/eslint-disable — apps+packages src; `process.exit(` yanlış-pozitifi `xit(` regex artefaktı); (7) ölü kod yok (App.tsx her feature sayfası route'lu; GL-2 `.parked-playbook` temizledi); (8) doküman tazeliği — M4 (752→**1697**), §E (595→1697), üst-tablo sayacı, §F.00 kapı satırı güncellendi; README ports/URL gerçekle uyumlu; (9) temiz kurulum provası — datastore healthy + migrate + seed (global-setup `db:seed`→"Acme Bikes") + **demo-flow e2e** yeşil; (10) kapsam dışı (§9) temiz — Stripe SDK yok (dep NONE, mock billing), apps'e telif görsel kopyalanmamış, voice/IVR/çeviri ⛔. **Tam DoD kapısı (exit 0, kanıtla — §F.2 uyarısı "kanıtsız geçti yok"):** typecheck · lint · unit **817** (web 445·api 179·rtm 29·types 56·ai-mock 56·widget 52) · integration **821** (api 779·rtm 42, serial `--concurrency=1`, paylaşılan-PG yarışı [[nexa-test-gate-parallel-db]]) · build · e2e **59** (18 spec, chromium). **E2E harness notu:** ilk koşu rtm dev'in env'siz düşmesiyle kırıldı (`DATABASE_URL/REDIS_URL/JWT/CUSTOMER_TOKEN_SECRET Required`); `set -a; . ./.env` ile source'lanıp portlar boşaltılınca 59 yeşil ([[nexa-e2e-clean-db]] "sourced .env" uyarısı). **Bulunan açık:** yalnız bayat-satır senkronu (küçük → bu turda kapatıldı); yeni tm görevi gerektiren büyük açık YOK. **Kapsam:** yalnız tm 87 + PLAN üst-tablo/§7.1/§7.2/§F.00/§4.5/§E/§D + HANDOFF §F.2; kod değişmedi → commit `docs(plan)`.

- **D56 (GL-4 · V1-KAPAT · tm 88 · 2026-07-31 · v1 kapanış turu):** v1 (Faz 1) §F.00 kapandı — §F.1'in **10 maddesi tam sürüm** koda karşı koşuldu + **tam E2E süiti** koşuldu, sayaç sayılarak doğrulandı, üst tablo `❌ AÇIK → ✅ KAPALI`. **Kod DEĞİŞMEDİ** (saf denetim + doküman senkronu; "verify+close, don't rebuild" [[nexa-early-delivered-slices-audit]]). **Sayım (§F.1/1 + subtask 1):** v1 `Must` = §4.1/4.2/4.3'te `grep 'Must (v1)'` = **20 satır**, hepsi ✅ — 05.1/05.3/05.5 (3) · 06.1–06.4 (10: 06.1·06.2.1–.5·06.3.1–.3·06.4) · 08.5.4–.6 (3, MOCK) · 08.8.4/02.1.2/04.2 (3) · 10.1.4 (1); beklenen `20 ✅ · 0 ◐ · 0 ⬜` doğrulandı. Mobil (13.7 · 13.8-push) 🔒 gerekçeli (§11.1/8, web-öncelikli) — sayaca girmez. **GL-3'ten farkı:** v1 modül tabloları zaten tam ✅'ti (GL-1/tm 85 üç bayat satırı 06.2.4/06.3.2/10.1.4 senkronlamıştı) → üst-tablodaki bayatlık yalnız "sayaç hiç sayılmamıştı" idi. **Bulunan bayatlık + düzeltme:** (a) §4.4.11 10.1.4-a **breakdown** satırı "UI ⬜" diyordu ama §4.3 ✅ tm 54 (senkron kaçağı) → ✅'e çevrildi; (b) §8 tablosu 3 satır bayattı — `webhooks`/`channels`/`ratings` "0-tüketici" idi ama v1 doldurdu → re-sayıldı/güncellendi. **§F.1 10-madde kanıt (HANDOFF §F.2):** (1) kapsam süpürmesi=sayım yukarıda 0 ◐/⬜, anahtar dosyalar spot-check mevcut (`PlaybookPage`/`SkillEditor`/`step-reorder`/`web-crawler`/`ssrf`/`webhooks`/`BillingPage`); (2) **faz sızıntısı=YOK** — GL-5/6/7 (cc-mask/spam-filter/banned-IP) §D52'de belgeli öne-çekme ama **henüz yazılmadı** (`cc-mask.ts`/`spam-filter.ts` ABSENT, `bannedCustomerIps` 0 enforcement consumer) → belgesiz sızıntı yok; (3) NFR ölçüldü — webhook HMAC-SHA256+SSRF (S7) `ssrf.test`(15)/`web-crawler`(6)/integration `knowledge-crawl`(11)/`webhooks`; cross-tenant/IDOR negatifleri 38 api-integration dosyasında; A11Y4 klavye-reorder `step-reorder`(10)+`SkillEditor`(5) — hepsi 817 unit + 821 integration içinde yeşil; (4) **şema artığı** — webhooks(5 çağrı/2 dosya·tm34)·channels(8/1·tm35)·ratings(yazma+okuma tm45/60) artık tüketiliyor (§8 güncellendi); yalnız `goals`(v2·13.3)+`workflows`(⛔ADR-14) 0-tüketici, gerekçeli; (5) contract-parity **5/5**; (6) sessiz borç **temiz** — 0 TODO/FIXME/XXX/HACK/@ts-ignore/@ts-expect-error/eslint-disable + 0 skip/only (apps+packages, `find`-doğrulandı); (7) ölü kod yok — `App.tsx` v1 feature sayfaları route'lu (playbook/billing/apps/traffic/campaigns/home/settings); (8) doküman tazeliği — üst tablo v1→✅+sayaç · §F.00 v1 kapı satırı · §8 (3 satır+Karar) · §4.4.11 10.1.4-a · header · §4.5/GL-4 bülteni · §D56; test sayıları (817/821/59) gerçekle uyumlu; (9) temiz kurulum provası — datastore healthy (nexa-db:5433/nexa-redis:6380) + e2e global-setup migrate+seed ("Acme Bikes") + **demo-flow e2e** yeşil + `db:check-drift` "no drift"; (10) kapsam dışı (§9) temiz — 0 Stripe SDK dep (mock billing ADR-13), `payment_methods` yalnız maskeli (PAN alanı yok), apps'e telif görsel kopyalanmadı. **Tam DoD kapısı + TAM E2E (exit 0, kanıtla — §F.2 "kanıtsız geçti yok"):** typecheck · lint · build · unit **817** (web 445·api 179·rtm 29·types 56·ai-mock 56·widget 52) · integration **821** (api 779·rtm 42, serial `--concurrency=1`, paylaşılan-PG yarışı [[nexa-test-gate-parallel-db]]) · **e2e 59** (18 spec chromium, `.env` **source'lu** — Playwright webServer spawn'ları env'i process'ten alır [[nexa-e2e-clean-db]], demo-flow dahil). Bu tur HANDOFF 2026-07-28'in "son bakım penceresi tam kapıyı koşmadı" borcunu kapattı. **Bulunan açık:** yeni tm görevi gerektiren büyük açık YOK (breakdown/§8 bayatlığı küçük → bu turda kapatıldı). **Kapsam:** yalnız tm 88 + PLAN (header/üst-tablo/§F.00/§8/§4.4.11/§4.5/§D) + HANDOFF §F.2; kod değişmedi → commit `docs(plan)`. **GL-5/6/7 (tm 70/68/69) bağımlılığı çözüldü.**

- **D57 (GL-5 · CC masking · tm 70 · 2026-07-31 · v2'den öne-çekilen güvenlik):** FR-MOD-08.9.5 teslim edildi — kart no **yazım anında** maskelenir (DB/log'a, yalnız UI değil; PCI SAQ A sınırı). **Tasarım kararı:** saf `apps/api/src/lib/cc-mask.ts` (13–19 hane aday → **Luhn** kapısı → `**** **** **** 1234`, son 4 korunur) + maskeleme **route sınırında** (kaynak) uygulanır — servis katmanı değil. Gerekçe: (a) kaynakta maskelenen metin hem DB'ye yazılır hem RTM'e push'lanır hem transcript'e girer → tek nokta üçünü de kapatır; (b) **AI/skill yolu** (`ai.handle(body.text)`) event'ten değil doğrudan girdiden beslenir — yalnız servis-katmanı maskesi bunu KAÇIRIRDI, bu yüzden `customer.ts`'te `maskedText` bir kez hesaplanıp DB+AI+RTM'e ortak verilir. **Kapsam (KK'nin ötesinde bilinçli eklenenler):** PLAN §4.5/GL-5 üç yolu sayar (agent/widget+custom_fields/email-konu); ayrıca **rating comment** (DB'ye yazılan müşteri serbest metni — "DB'ye maskeli yazılır" tam kapsamı) ve **typing sneak-peek** (ajana giden RTM yan kanalı) maskelendi — ikisi de aynı PAN→DB/ajan sınıfı, boşluk bırakmamak için. **Yanlış-pozitif biası bilinçli:** Luhn-geçen kart-dışı bir sayıyı fazla maskelemek, gerçek PAN sızdırmaktan iyidir (PCI'nin umursadığı yön). **NEGATİF-önce doğrulandı:** Luhn-geçmez 16-hane sipariş no + telefon + UUID + timestamp + 20-hane hesap no MASKELENMEZ (unit'te önce kırmızı görülüp yeşile alındı). **Yan-kanal kanıtı:** request log Fastify default serializer `req.body`'yi loglamaz (+ test'te `disableRequestLogging`); `audit_log` meta yapıca değer/PII taşımaz (`sanitizeAuditMetadata`) + integration sweep 0; `.data/mail` transcript spool maskeli. **Kapsam:** yalnız apps/api (2 yeni lib + 3 route/servis dosyası + 1 yeni integration test) + PLAN(§5/§7.2/§4.5-GL-5/§D57) + HANDOFF; kod değişti → commit `feat(security)`. **Sınır (kapsam dışı, gerekçeli):** `properties` JSON (ajan-kontrollü yapısal veri, KK hedefi değil) + kişi adı alanı (isim maskesi yanlış olur) dokunulmadı. **GL-6/7 (tm 68/69) sırada** — bağımsız (GL-4 bağımlılığı zaten çözüldü).
- **D58 (GL-6 · Banned customers tamamlama · tm 68 · 2026-07-31 · v2'den öne-çekilen güvenlik):** FR-MOD-08.9.2 tamamlandı — **IP tabanlı yasak**. Mevcuttu: visitor yasağı (`Customer.bannedAt` + token mint reddi + `chat-service` chat start reddi) + ban/unban müşteri UI (`CustomerDetailPanel`, `POST/DELETE /customers/:id/ban`). **Eksikti:** `SecuritySettings.bannedCustomerIps` kolonu şemadaydı ama **hiçbir yerde okunmuyordu** (grep 0). **Tasarım kararı:** kimlik yasağı (bannedAt) bir kimlikle taşınır → servis katmanında (`chat-service`) uygulanır; **adres yasağı istemci IP'sinin bilindiği yerde** — istek kenarında (`/customer/token` mint + `/customer/chat/events`) uygulanır. Saf `lib/banned-ip.ts`: `normaliseIp` (trim/lowercase + IPv4-mapped IPv6 `::ffff:` sıyırma → proxy'nin bildirdiği adres adminin yazdığıyla eşleşir) + `isIpBanned(tx, ip)` (per-license `SecuritySettings.findFirst`, RLS-kapsamlı → satır yoksa/boşsa yasak yok). **İki nokta gerekçesi:** mint'te reddetmek yasaklı adrese hiç token vermez; ama bandan ÖNCE mint'lenmiş token'la chat başlatılabilir → events yolunda da kontrol (start + mevcut chat'e mesaj), böylece "yasaklı sohbet başlatamaz" canlı oturum için de tutar. **Kontrat (tm 1 deseni):** `banned_customer_ips` `/settings/security` GET (+`required`)/PATCH; PATCH `net.isIP` doğrular (tipografi listede kural gibi durup kimseyi tutamaz), `normaliseIp` ile canonical yazılır, `Set` ile dedup edilir (iki-şekil-bir-adres tek giriş). **UI:** Settings→Security "Blocked IP addresses" (`SettingsPage.BannedCustomerIps`, `FileSharing` ile aynı `['settings','security']` sorgusunu paylaşır → tek satır, iki ekran senkron). **KK "Yasaklı sohbet başlatamaz" — doğrulandı:** integration **10** (yasaklı IP → token 403; token-önce-ban → chat 403 + 0 chat; unban → 201; **cross-tenant** A yasağı B'yi etkilemez ZORUNLU; IPv4-mapped eşleşir) + unit **5** (`normaliseIp`) + UI unit **4** (liste/ekle/sil/read-only). **Tam DoD kapısı (exit 0, kanıtla):** typecheck · lint · build · unit (api +5, web +4) · integration **798** (api, +10; contract-parity 5/5, serial `--concurrency=1`) · **e2e** ilgili yeşil (settings 13/13 — yeni Blocked-IP bölümü kırmadı; demo-flow 3/3). **E2E determinizm bulgusu (kapsam dışı → tm 89):** demo-flow.spec.ts ilk koşuda kırmızıydı — ziyaretçi mesajına gömülü çıplak `Date.now()` (13 hane) Luhn-geçerli olunca **GL-5 cc-mask'ı** `**** **** **** NNNN`'e çevirdi (benim değişikliğim DEĞİL — IP kontrolüm boş yasak listesinde inert, `settings:301` aynı round-trip yeşildi). demo-flow (kapsamımdaki akış) `.slice(-6)` ile determinize edildi; aynı desendeki diğer 5 spec (customers/traffic/settings/widget) **tm 89**'a loglandı (§5 kapsam disiplini — sprawl yok). **Kapsam:** apps/api (`lib/banned-ip.ts`+test · `auth.ts`/`customer.ts`/`settings.ts`) + contract (openapi+regen) + apps/web (`SettingsPage` + `BannedCustomerIps.test.tsx`) + apps/e2e (demo-flow determinizm) + PLAN(§5/§D58)+HANDOFF; kod değişti → commit `feat(security)`. **GL-7 (tm 69) sırada.**
- **D59 (GL-7 · Spam filtre · tm 69 · 2026-07-31 · v2'den öne-çekilen güvenlik):** FR-MOD-08.9.3
  teslim edildi — chat yoluna spam filtresi + email yolu aynı motora bağlandı. **Mevcuttu:**
  `SecuritySettings.spamFilterEnabled` yalnız `email-inbound.ts`'te (sağlayıcı bayrağı); chat
  yolunda filtre yok (§D56 "spam-filter.ts ABSENT" doğrulamıştı → gerçek yeni yapım, denetim-kapama
  DEĞİL — [[nexa-early-delivered-slices-audit]] burada geçerli değil). **Tasarım kararı:**
  deterministik motor `apps/api/src/services/security/spam-filter.ts` — **LLM yok** (test
  edilebilirlik + yanlış-pozitif denetimi; aynı girdi→aynı karar, sınır tablo-testinde pinlenir).
  Dört sinyal: blocklist (dar, çok-kelime/net — "you won" DEĞİL, yalnız "you have won") · link seli
  (≥4 URL) · tekrar (bir token ≥5 kez & ≥%50 baskın, veya 20+ aynı-karakter run) · gibberish (40+
  hane kesintisiz alnum + Shannon entropi ≥3.5). `evaluateSpam({filterEnabled, text?, providerFlagged?})`
  **tek gate** — filtre kapalı→geç, sağlayıcı-bayrağı→spam, yoksa içerik sınıflandır; hem chat hem
  email onu çağırır (**tek doğruluk kaynağı**). URL token'ları per-token kurallardan muaf — unit
  testi meşru uzun-URL'de (60 'a'lı path) char-run yanlış-pozitifini **yakaladı → düzeltildi**
  (char-run + gibberish per-token'a alındı, URL atlanır). **Davranış kararı (§C-A11):** chat =
  **zarflı red** `message_rejected` (403, jenerik → probing yok, kardeş banned-IP ile tutarlı,
  hiçbir şey persist edilmez); email = sessiz `ignored/spam`. **Kapsam (bilinçli):** yalnız
  chat-**START** taranır — `existing` chat lookup yukarı taşındı, spam kontrolü pre-chat
  yazımlarından (name/email/custom_fields/page-view) ÖNCE (red hiçbir yan-etki bırakmaz). Yeni hata
  tipi `message_rejected` (403) — kardeş `customer_banned` deseni, `NEXA_ADDED_TYPES`'a eklendi +
  openapi `ErrorType` enum + regen. **NEGATİF-önce doğrulandı:** unit **29** (kısa selam · tek-link
  soru · tekrar-meşru nudge · uzun-URL · order-id · emoji/punc GEÇER — önce yeşil sınır; sonra link
  seli/tekrar/blocklist/gibberish düşer; + ReDoS-linear regresyon) + integration **7** (chat 6: spam 403+0 chat · filtre-off
  201 · kurulu-sohbet taranmaz 201 · **cross-tenant** A-off/B-on · legit-link 201 · normal-start
  201; email 1: sağlayıcı-**temiz** ama içerik-spam konu düşer → "aynı motor" kanıtı). **Tam DoD
  kapısı (exit 0, kanıtla):** typecheck · lint · build · unit (api içi +28; `types` sayaç testi
  27→28 `message_rejected` `NEXA_ADDED_TYPES`'a eklendi) · integration **805** (api, +7;
  contract-parity 5/5, serial `--concurrency=1`) · **e2e 59** (widget/demo/traffic/customers/
  settings chat-start mesajları meşru → filtre kırmadı). **Kapsam:** apps/api (`services/security/
  spam-filter.ts`+test · `customer.ts`/`email-inbound.ts`) + packages/types (`errors.ts`+
  `scopes.test.ts`) + packages/contract (openapi enum + regen `api.ts`) + PLAN(§5/§C-A11/§D59)+
  HANDOFF; kod değişti → commit `feat(security)`. **GL-5/6/7 üçlüsü tamamlandı** (tm 70/68/69) —
  öne-çekilen saf-güvenlik seti kapandı (§D52).
  **Güvenlik denetimi (security-reviewer subagent, [MAX] son kapı):** bir **HIGH** bulundu ve commit
  ÖNCESİ giderildi — `normaliseToken`'ın `/…|[^\p{L}\p{N}]+$/u` (uçta-olmayan `$` alternatifi)
  ziyaretçi metniyle **O(n²)** idi: ZWSP (U+200B, `\s`-split'ten sağ çıkar) dolgulu tek token → ~1 s
  senkron event-loop bloğu (tüm tenant'ları etkiler, ~880× amplifikasyon). Düzeltme: iki-uçlu index
  walk (linear, code-point aware) + repetition döngüsünde 64-hane token kapısı (per-token işi yapısal
  sınırlar) + ReDoS-linear regresyon unit'i. LOW (email konu maskeleme sırası) da kapatıldı — konu
  artık **maskeli** sınıflandırılır (widget'la tutarlı, `maskedSubject` bir kez). Cross-tenant izole
  (RLS `withTenant`) + red-öncesi-yazma-yok + probing-oracle-yok denetimde onaylandı.
- **D59-b (E2E determinizm · tm 89 · 2026-07-31 · §D58 takip bulgusu):** _(numara düzeltmesi 2026-08-01: bu kayıt da `D59` diye yazılmıştı — §D'de **iki ayrı D59** vardı. Spam filtre kaydı (tm 69) §5 tablosundan `§D59` diye referanslandığı için o numarayı korudu; bu kayıt `D59-b` oldu. Bkz. §D65.)_ §D58'de tm 89'a loglanan bulgu kapatıldı — GL-5 cc-mask (08.9.5) ile çakışan çıplak `Date.now()` mesaj-metni jetonları determinize edildi. **Kök neden:** ziyaretçi/ajan mesaj metnine gömülü çıplak `Date.now()` **13 hane** = kart uzunluğu; Luhn-geçerli düştüğü koşularda `lib/cc-mask.ts` `CARD_CANDIDATE` (`(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)`, ≥13 hane + Luhn) onu `**** **** **** NNNN`'e çevirir → `toContainText(rawText)` ~%10 olasılıkla kırılır (probabilistik flake). **Çözüm (tm 68 / demo-flow deseninin aynısı):** jetonlar `Date.now().toString().slice(-6)` ile **6 haneye** indirildi — 6 < 13 olduğundan `CARD_CANDIDATE`'in tabanına asla ulaşmaz → hiçbir zaman maskelenmez → metin **inşa gereği** verbatim round-trip eder (tek koşu bir olasılık-flake'i kanıtlayamaz; belirlenim regex tabanıyla kanıtlanır — sibling `customers:57`/`settings:203`/`settings:306` aynı idiom). **Düzeltilen 7 mesaj-metni sitesi:** `customers.spec.ts:101` · `traffic.spec.ts:23` · `settings.spec.ts:307`/`324` · `widget.spec.ts:120`/`153` **+ `widget.spec.ts:247`** (ek: ekli-dosya `caption`'ı, agent transcript'inde `toContainText` ile denetleniyor — aynı kusur; task'ın numaralı listesinde yoktu ama DoD "tam süit deterministik" gereği kapatıldı, HANDOFF'ta işaretli). **DOKUNULMADI (maskelenmez → flake değil):** URL/domain (`ai-agent:80` · `onboarding:62` · `settings:21`/`161`/`183`) + ayar/metadata alanları (`ai-agent:54` Tone · `ai-agent:78` knowledge Title · `campaigns:14` kampanya adı) — hiçbiri cc-mask yazım yolunda (`chats.ts`/`customer.ts` mesaj metni) değil; `onboarding:18` signup id'si (workspace adı/email, mesaj değil, `-random` ayrıca kesintiye uğratır). **Doğrulama (exit 0, kanıtla):** e2e typecheck · e2e lint · **e2e ilgili yeşil** — 4 etkilenen spec dosyası **32/32 passed** (customers/traffic/settings/widget; `.env` source'lu, nexa-db:5433/nexa-redis:6380 healthy, migrate current, global-setup seed [[nexa-e2e-clean-db]]) — düzeltilen her site fiilen koştu (customers:93 · settings:301 · traffic:12 · widget:118/134/228). **Kapsam:** yalnız apps/e2e (5 spec dosyası, test-jetonu üretimi) + PLAN(§D59)+HANDOFF; **kaynak kod DEĞİŞMEDİ** (yalnız test fixtürleri) → commit `test(e2e)`. **GL-6 (tm 68) takip bulgusu kapandı; GL-7 (tm 69) sırada.**

- **D60 (Mobil 13.7 + 13.8-push → Faz 3 · gerekçe düzeltmesi · 2026-08-01 · v2 planlama turu):** FR-MOD-13.7 "Mobil uygulamalar" (ve 13.8'in mobil-push kanadı) v1 boyunca `🔒` damgalıydı ve gerekçesi **"web-öncelikli (PRD §11.1/8 ile hizalı)"** yazıyordu. **Bu tur bunun yanlış atıf olduğunu buldu:** PRD §11.1'in 8. maddesi _"**Masaüstü** native uygulama: web-öncelikli; opsiyonel/geç faz"_ der — **mobil hakkında değildir**. PRD'de mobil kapsam dışı da değildir: FR-MOD-13.7 `Should (v1)` önceliğindedir ve KK'sında _"Inbox/AI/CRM/Reports mobilde; push; **tam modül paritesi** (Nexa farklılaşması)"_ yazar; yani PRD onu bir **farklılaşma** kalemi sayar. Sonuç: kalem **gerekçesiz bir 🔒** taşıyordu ve §F.00'ın _"gerekçesiz `🔒` bir kapanış engelidir (gizlenmiş `⬜` olabilir)"_ kuralına takılıyordu — v1, farkında olunmadan, gerekçesiz bir kilitle kapandı. **Kapanış kararı değişmez** (mobil `Should`'tur, `Must` sayacına zaten girmiyordu; `20 ✅` sayımı doğru kaldı) — düzeltilen yalnız **gerekçe** ve **faz ataması**. **Kullanıcı kararı (2026-08-01):** Faz 3'e (Enterprise) ertelensin. **Yeni gerekçe (doğru olan):** native iOS/Android **bu deponun stack'i dışındadır** (ADR-01 TypeScript her yerde / ADR-02 pnpm+Turborepo monorepo: Fastify+React+Vite) — ayrı uygulama hattı, ayrı derleme zinciri, ayrı test piramidi ve store yayın süreci ister; ayrıca push altyapısı (APNs/FCM, MOCK'lanacak) cihaz-token yaşam döngüsü + 08.2 kanal tutarlılığı invariant'ı taşır. **Dokunulan satırlar:** §4.3 13.7 · §4.4.11 13.7 notu · §3.10 13.8 satırı (mobil push damgası) · üst-tablo v1 anlatısı (satır 36) · §4.4 v1 kapanış kapısı listesi · §F.00 v1 kapı satırı · §6 tablosu (**yeni satır**) · §6.1 kırılımı (**yeni satır, `[OPUS-MAX]` ~8–12 alt-görev**). **Task Master:** **tm 90** açıldı (Faz 3, `deferred`, orta derinlik — faz başında bölünecek). **Kod DEĞİŞMEDİ.**

- **D61 (08.9.6 IP allowlist: Faz 3 → Faz 2 · PRD içi faz çelişkisi çözüldü · 2026-08-01):** Kalem PLAN §6/§6.1'de Faz-3'te duruyordu (tm 80). **Çelişki:** PRD'nin iki yeri farklı faz söylüyor — (a) **§5.3 "v2 (Faz 2)"** tablosunun `Güvenlik` satırı: _"IP allowlist, CC masking, banned customers, spam, temel audit log (tüm planlarda)"_ → v2; (b) **§6 FR-MOD-08.9.6** önceliği: `Could (Ent.)` → Enterprise. **Tiebreak (PLAN §1.1 omurga kuralı):** _"Çalışma sırası **PRD §5'in faz sırasıdır**; her faz içinde işler PRD §6'nın modül numaralarına göre gruplanır."_ Yani **§5 fazı belirler, §6 önceliği/gruplamayı belirler.** `Could (Ent.)` bir **öncelik** damgasıdır (düşük öncelik + Enterprise planında satılır), faz ataması değildir. **Destekleyici kanıt:** aynı §5.3 hücresindeki üç kardeş (08.9.5 CC masking · 08.9.2 banned customers · 08.9.3 spam) zaten v2'ydi ve GL-5/6/7 ile **öne bile çekildi** (§D52/§D57/§D58/§D59); IP allowlist'i tek başına iki faz ötede bırakmak asimetrik ve gerekçesizdi. **Karar:** → **Faz 2**, `[OPUS-MAX]` (erişim kontrolü sınırı). Dilim sıralamasında **erken** konumlandırıldı — sonradan eklenen güvenlik en pahalı borçtur. **Dokunulan:** §6 tablosu (üstü çizili + yönlendirme) · §6.1 (üstü çizili) · §5 tablosu (**yeni satır**) · §5.2 (**atomik kırılım**) · §G. **Task Master:** tm 80 v2'ye taşındı (başlık/detay/faz güncellendi).

- **D62 (v2 kapsam süpürmesi — PLAN §5'te 12 kalem eksikti · 2026-08-01):** Bu tur v2'yi atomik bölmeden önce **kapsamı PRD'ye karşı süpürdü**: üç bağımsız kaynak paralel tarandı — (a) PRD **§5.3** v2 faz tablosunun her hücresi, (b) PRD **§5.5** modül→faz matrisinin v2 sütununda işaret taşıyan her modül, (c) PRD **§6**'nın `Oncelik` sütununda `(v2)` geçen her `FR-MOD` satırı — sonra üçü uzlaştırıldı. **Sonuç: v2 = 30 kalem.** İlk uzlaştırma `19 açık · 3 teslim · 1 kapsam dışı · 7 karar gerektiren` saydı; **7 karar kalemi PRD'den çözülünce** dağılım **nihai** hâlini aldı: **23 ⬜ açık · 4 ✅ teslim · 3 ⛔ kapsam dışı** (08.9.6 v3'ten v2'ye girdi §D61; 08.9.7-audit/09.2/01.1.3/12.4/05.6 açık kalem oldu; 06.2.3 ✅ teslim sayıldı; MOD-04/MOD-06 ⛔ oldu). §5.0'daki sayılar **tablodan sayılarak** üretildi (§1.2). **PLAN §5/§5.1 yalnız 18 kalem listeliyordu → 12 kalem eksikti.** Eksikler, çoğu PRD'de **proza içinde** geçtiği ve `FR-MOD` satırı olmadığı için gözden kaçmıştı: `⌘K AI komutları` (§5.5 MOD-01 v2 hücresi) · `zamanlanmış rapor export` (§5.3 Reports) · `çoklu-ajan çakışma uyarısı` (§5.3 Routing) · `07.7 rapor grupları v2 payı` (önceliği **`Should (v1–v2)`** — açıkça iki faza yayılıyor, v2 payı hiç açılmamış) · `100+ entegrasyon` (§5.5 MOD-09 v2) · `Copilot BI komut` (§5.5 MOD-12 v2) · `temel audit log tüm planlarda` (NFR-S12 + risk R5) · `08.9.6` (→ §D61) · `31+ şablon` (§5.3 Otomasyon) + §5.5'in tanımsız `○` derinleşmeleri (MOD-04 · MOD-06 · 06.2.3 NL skill). **Her "PLAN'da yok" iddiası hedefli grep ile teyit edildi** ve yanlış-pozitifler ayıklandı (ör. "çakışma" PLAN'da 4 kez geçiyor ama hiçbiri routing değil: RLS anahtar çakışması, OpenAPI anahtar çakışması, Playbook birleşimi, ticket-seçim effect'i). **Karar verilenler:** MOD-04 v2 `○` → somut `FR-MOD (v2)` satırı yok, kapsam tanımı yok → **ayrı kalem açılmadı** (§C-A12); MOD-06 v2 `○` → tek `(v2)` içeriği `06.3.2-bulk`'tur → **ayrı kalem açılmadı** (§C-A13); 06.2.3 NL skill → v1'de ✅ teslim, §5.3'teki tekrarı ⛔ builder'ın bağlamı → **yeni iş yok**; `31+ şablon` → ADR-14 canvas'ı ⛔ ama **şablon sayısı hedefi** ADR-14'e rağmen onurlandırılabilir (05.1/05.2 Skill şablon galerisi ✅ teslim, kendi kataloğu var) → **`05.6-tmpl31` olarak açıldı** (§C-A14). **Kalan 9 kalem v2 kırılımına dâhil edildi.**

- **D63 (Etiket sistemi: tek boyutlu → model × efor matrisi · 2026-08-01):** `run-loop.sh` her temiz pencerenin modelini/eforunu görev başlığındaki etiketten okur. Eski sistem tek boyutluydu (`[XHIGH]`→opus/xhigh · `[MAX]`→opus/max; model `MODEL="opus"` ile sabit). **Sorun:** v2 iş kalemlerinin büyük bölümü mekaniktir (katalog verisi, liste/sekme UI, kontrat satırı, salt-okunur rapor kartı) ve bunları en pahalı modelle koşturmak, gerçekten muhakeme isteyen güvenlik/algoritma işlerinden bütçe çalar — v1'in ölçülen maliyeti opus-xhigh ~$13/pencere, opus-max ~$25–31/pencere. **Yeni sistem (kullanıcı talimatı):** `[SONNET-XHIGH]` · `[SONNET-MAX]` · `[OPUS-XHIGH]` · `[OPUS-MAX]`. **Efor tabanı `xhigh`** — matriste `high` ve altı YOK; kullanıcı kuralı: _"Güvenlik olarak high gereken işlerde xhigh kullansın."_ Güvenlik hassasiyeti olan hiçbir iş `sonnet`'e verilmez. Tam koşul listesi + bölme politikası **§5.1**'de. **Eski etiketler Faz-0/v1 tarihçesinde (§3 · §4 · §A · §B) olduğu gibi bırakıldı** — o işler bitti, etiketleri artık yalnız kayıt değeri taşıyor; yeni matris §5.2 (v2) ve §6.1 (Faz 3) için geçerlidir. **Bölme politikası da değişti:** eski tur "MAX işler bölünmez" diyordu; yeni talimat _"bütün taskları olabildiğince task ve subtasklara böleceksin"_ — tek istisna bir `[OPUS-MAX]` alt-görevin **güvenlik/algoritma çekirdeği** (bağlam bölününce güvenlik akıl yürütmesi kaybolur). Çekirdeğin etrafındaki ucuz yüzeyler (kontrat, migration, salt-okunur UI, seed) **ayrı ve daha ucuz etiketli** alt-göreve çıkarılır.

- **D64 (2026-07-28 "hepsi deferred" kararının kapsamı düzeltildi · 2026-08-01):** Panel 2026-07-27'den beri **kritik** bir bulgu taşıyordu: _"run-loop duracak: bağımlılığı çözülmüş hiçbir görev kalmadı"_ — 19 açık görev var ama **0 seçilebilir**, çünkü hepsi `deferred` (seçilebilir = `pending` **ve** bağımlılıkları kapalı). İki ayrı GRAF-ONARIM penceresi (commit `15f9ce7`, `a8e2fe1`) bunu bağımsız teşhis etti, grafın sağlam olduğunu doğruladı ve **doğru olarak** graf mutasyonu yapmadı — çünkü elde **2026-07-28 kullanıcı kararı** vardı: _"proje hızla canlıya hazırlanacak; **dış entegrasyonlar deferred kalır**"_. **Bu turun bulgusu:** o karar **dış entegrasyonlar** için verilmişti, ama §4.5'in "GO-LIVE sonrası deferred kalanlar" bölümü onu **tüm v2+v3'e** (tm 63–84) uyguladı. Oysa listenin çoğu dış entegrasyon **değildir**: tm 63/64 (Reports v2) · 66 (skills-based routing) · 73–78 (Engage/Goals/Sales/Public KB/scheduler/Multibrand) tamamen iç iştir. Dış servise dokunanlar (Instagram/Zapier/API paketleri) bile MASTER-PROMPT'un _"Dış servisleri MOCK'la — arayüz + sahte sağlayıcı yaz"_ kuralına tabidir ve v1 bunu zaten **üç kanalda yaptı** (Messenger/Twilio/WhatsApp hepsi MOCK, tm 35). Yani gerçek kimlik/anahtar gerektiren **hiçbir v2 kalemi yok**. **Kullanıcı talimatı (2026-08-01)** — v2'nin eksiksiz ve atomik planlanması + Task Master'a aktarımı — 2026-07-28 kararının bu genişletilmiş yorumunu **geçersiz kılar**. **Sonuç:** v2 görevleri `deferred` → `pending`, alt-görevleriyle birlikte (§G · Task Master). Faz-3 kalemleri (tm 79–84, 90) `deferred` kalır — onlar gerçekten sonraki fazdır. Panelin kritik bulgusu bununla kapanır.

- **D66 (v2 atomik kırılımı ayrı companion dosyaya alındı · 2026-08-01):** Faz-2'nin atomik kırılımı **23 kalem / ~180 alt-görev**tir ve her alt-görev ev formatının tam alan setini taşır (koda karşı `neden açık`, `dosyalar`, `referans desen`, `KK birebir`, `KK doğrulama`, `zorunlu testler`, `sözleşme`, `migration`). Bu, ham hâliyle **birkaç yüz KB** tutuyor. PLAN.md zaten ~305 KB ve `TASK-RUNNER-PROMPT.md` §0/4 her pencereye açıkça _"PLAN.md — **baştan sona OKUMA** (bağlamı boşa harcar)"_ diyor; dosyayı iki katına çıkarmak bu protokolü daha da zorlardı. **Karar:** kırılım **ikiye ayrıldı** — (a) **PLAN.md §5.2**: kalem başına **özet tablo** (her alt-görev: ID · başlık · etiket · bağımlılık · pencere) + kalem seviyesinde `KK birebir` + bölünmeyen çekirdek gerekçesi + varsayımlar/açık sorular; (b) **`PLAN-V2-KIRILIM.md`** (yeni companion): aynı alt-görevlerin **tam alan detayı**. **PLAN.md tek doğruluk kaynağı olmaya devam eder** (CLAUDE.md) — companion onun eki'dir, ayrı bir plan değildir; §5.2'deki her kalem sonunda buraya işaret eder ve numaralandırma (`5.2.N`) ile alt-görev ID'leri **birebir aynıdır**. **Pratikte pencere hiçbirini baştan sona okumaz:** Task Master alt-görevinin `details` alanı zaten o alt-görevin tam metnini taşır (aktarımda companion'dan üretildi), yani runner tek kaynaktan çalışır. Companion, bir kalemin komşularını veya çekirdek gerekçesini görmek istendiğinde okunur. **Risk ve azaltma:** iki dosyanın bayatlaması (bu deponun bilinen kusuru — §D52/§D53/§D55'in "TM'de bitti, PLAN'da ◐" deseni). Azaltma: özet tablo ile tam detay **aynı JSON kaynağından programatik üretildi**, elle kopyalanmadı; bir alt-görev değişirse ikisi birlikte yeniden üretilir.

- **D67 (panel çelişkisi `plan-tm-reverse` #97 — YANLIŞ POZİTİF, karar: görev açık kalır · 2026-08-01):** Panel `ORTA` bir çelişki bildirdi: _"#97 açık ama kapsadığı her PLAN satırı ✅"_ — kanıt olarak `PLAN.md:520` (`06.3.2` → `✅`) gösterildi. **Koda karşı doğrulandı, iki taraf da doğru:** (a) `PLAN.md:520`'nin `✅`'i **gerçektir** — `services/ai/web-crawler.ts` (94 satır) · `lib/ssrf.ts` (171) · `services/ai/knowledge-service.ts` (109) mevcut, `playbook.ts`'te `assertPublicHttpUrl`+`crawl` yolu bağlı, testleri var (`ssrf.test.ts` · `web-crawler.test.ts` · integration `knowledge-crawl.test.ts`); (b) **tm 97 de haklı olarak açıktır** — bulk/CSV yolu **gerçekten yok**: `parseCsv`/`csv-parse`/`papaparse` grep **0** · `playbook.yaml`'da `bulk` grep **0** · `/knowledge-sources` yalnız 2 yol · `package.json`'da csv/multipart bağımlılığı **0**. **Kök neden:** `FR-MOD-06.3.2` **iki ayrı kapsama** bölünmüştü — tek-kaynak yolu v1'de (`✅`, tm 33.4), bulk/CSV kanadı v2'de (`⬜`, tm 97; v1'in tek kasıtlı v2 payı, üst tablo satır 21). Panelin eşleştiricisi `06.3.2-bulk` kimliğinden `-bulk` sonekini atıp v1 satırıyla eşleştiriyor. **Yapılan (kod DEĞİŞMEDİ):** ayrım üç yerde açık hâle getirildi — (1) `PLAN.md:520` v1 satırına "KAPSAM SINIRI" notu (bu `✅` bulk'u kapsamaz); (2) §5.0 `06.3.2-bulk` satırına karşılıklı işaret + koda karşı kanıt; (3) tm 97 başlığı "YALNIZ çoklu-satır" olarak daraltıldı ve `details`'in başına kapsam-sınırı uyarısı eklendi, böylece run-loop penceresi bitmiş crawl/SSRF işini yeniden yazmaz. **Görev ne kapatıldı ne iptal edildi** — iş gerçekten duruyor. Kardeş bulgular (#63/#65/#67/#71–75/#93/#95) 17:48'de kendiliğinden kapandı; bu biri `-bulk` soneki v1 FR koduyla önek çakıştığı için kaldı.

**Doküman düzeltmeleri (kaynakta sayı hatası):**

- **D65 (§D numara çakışması · 2026-08-01):** §D'de **iki ayrı kayıt `D59` numarasını taşıyordu** — (a) GL-7 Spam filtre (tm 69) ve (b) E2E determinizm (tm 89). İkisi de 2026-07-31'de aynı gün yazılmış, ikincisi birincinin numarasını görmemiş. §5 tablosunun 08.9.3 satırı `§D59` diye **spam filtreye** referans verdiği için o numara korundu; e2e kaydı **`D59-b`** oldu. Referans kırılmadı.

- **D68 (Faz-2 üst-tablo + §5.0 dağılım sayacı bayattı — 08.9.6 `◐→✅` çevrildi, sayaç güncellenmedi · 2026-08-01):** Panel §1.2 ihlali bildirdi: üst-tablo (satır 22) ve §5.0 girişi (satır 1100) dağılımı `4 ✅ · 23 ⬜ · 3 ⛔` yazıyordu; §5.0 gereksinim envanteri (satır 1108–1137, **30 satır**) her satırın **öncü durum damgası tek tek sayıldığında** `5 ✅ · 22 ⬜ · 3 ⛔` çıkıyor (toplam 30 sabit). **Kök neden — bir kalem `◐→✅`:** `08.9.6` satırı (satır 1120) tm 80.9 penceresinde `◐`'den `✅`'e çevrildi (08.9.6-i teslim, a→i tamam) ama iki dağılım sayacı güncellenmedi; sayaç zaten `◐` saymadığı için 08.9.6'yı ⬜ tarafında tutuyordu, dolayısıyla düzeltme `−1 ⬜ / +1 ✅`. Bu, deponun bilinen "kod/TM'de bitti, PLAN üst-özeti bayat" deseni (§D55/§D56). **Kanıt:** satır 1120 damgası artık `✅` (düzeltme öncesi son commit HEAD `7bbb70d`/tm 80.8'de aynı satır `◐`'di — tm 80.9 çalışma alanında çevirmiş, commit'lememişti); başka hiçbir Faz-2 gereksinim tablosunda öncü damga yok (grep 0). **Panelin `6 ✅ / 21 ⬜` iddiası** naif ham-glif sayımıydı: `06.3.2-bulk` satırının (satır 1108) notu v1 kardeş satırına atıfla gömülü bir `` `✅` `` + `` `⬜` `` taşır → ham sayım öncü damgayı 1 fazla sayar; doğru yöntem **öncü-damga** sayımıdır. **Yapılan (YALNIZ dağılım sayacı):** satır 22 + satır 1100 → `22 ⬜ · 5 ✅ · 3 ⛔`. **Dokunulmadı:** gereksinim satır damgaları (kanıta dayalı); `23 açık kalem` kapanış-paydası (satır 22-col5 · satır 2318) + §5.2 `23 kalem` kırılım kapsamı — bunlar planlanan açık-backlog paydasıdır (yapısal), 08.9.6'nın teslimi payda içi **ilerlemedir**, kapsam değişikliği değil; §D62'nin tarihsel `23/4/3` kaydı (append-only).
- **D69 (Faz-2 üst-tablo sayacı — §D68 yanlış-pozitifi panelce yeniden bildirildi · re-doğrulandı, DEĞİŞİKLİK YOK · 2026-08-02):** Panel yine §1.2 çelişkisi bildirdi: özet (satır 22) `5 ✅ / 22 ⬜` derken sayım `6 ✅ / 21 ⬜` veriyor. **Bağımsız re-doğrulama (awk, öncü-damga):** tek Faz-2 gereksinim tablosu §5.0 (satır 1108–1137, 30 satır) her satırın **öncü** durum damgası tek tek sayıldı → **22 ⬜ · 5 ✅ · 3 ⛔** — üst-tablo (satır 22) + §5.0 girişi (satır 1100) ile **birebir uyuşuyor; özet DOĞRU, bayat DEĞİL.** §5.0 dışında öncü damga taşıyan Faz-2 tablosu yok (§5.2 kırılım · §5.3.2 dilim · §G düz tablo **hedef değil** — grep 0). **Kök neden (D68'de zaten teşhisli):** panelin `6 ✅ / 21 ⬜`'i **naif ham-glif** sayımı — `06.3.2-bulk` satırı (satır 1108) notunda v1 kardeşine atıfla gömülü `` `✅` `` (+`` `⬜` ``) taşır → naif sayaç bu satırı öncü `⬜` yerine `✅` sayıp `−1 ⬜ / +1 ✅` kaydırır (ham glif: **6 ✅ · 23 ⬜**; öncü: **5 ✅ · 22 ⬜**). D68'den bu yana **hiçbir damga değişmedi** (satır 1120 hâlâ `✅`, commit'li; çalışma alanı temiz). **Yapılan:** yalnız bu §D kaydı — özet sayacına **ve** gereksinim satır damgalarına **DOKUNULMADI** (özet düzeltilecek bir şey içermiyor; damgalar kanıta dayalı). Satır 1108'in gömülü glifi durdukça bu, naif sayaç için **kalıcı** yanlış-pozitif kaynağıdır (aynı satırın kök çakışması §D67/#97). Sonraki tarama bunu doğrudan **kapatabilir**.
- **D70 (Faz-2 üst-tablo + §5.0 dağılım sayacı GERÇEKTEN bayattı — 08.9.7 `⬜→◐` çevrildi, sayaç güncellenmedi · 2026-08-02):** Panel §1.2 çelişkisi bildirdi (özet `6 ✅ / 21 ⬜`, sayım `7 ✅ / 19 ⬜`). **Bağımsız re-doğrulama (awk, öncü-damga; §5.0 satır 1108–1137, 30 satır):** **20 ⬜ · 1 ◐ · 6 ✅ · 3 ⛔** (toplam 30 sabit) → özet (satır 22 + 1100) `21 ⬜ · 6 ✅ · 3 ⛔` ile **UYUŞMUYOR: özet bayat.** **Kök neden — bir kalem `⬜→◐`:** `08.9.7` satırı (satır 1120→artık 1121) tm 92.1–92.7 pencerelerinde audit-log okuma yüzeyi + liste filtreleri + webhook olayları + retention iskeleti kısmen teslim edilince `⬜`'den `◐`'e çevrildi (kalan v2 payı: -e/-f/-h/-i/-j/-k) ama dağılım sayacı güncellenmedi. **Kanıt (git):** özet satırları (22 + 1100) son olarak commit `7f2781f`'te (tm 91.7 · 05:23) yazıldı — o commit'te satır 1121 öncü damgası `⬜`'di (`git show 7f2781f:PLAN.md`); satır 1121 en son commit `f299096`'da (tm 92.7 · 08:35, özetten SONRA) dokunuldu ve HEAD'de öncü damga `◐`. Yani 91.7'de doğru olan özet (§D69), 92.x audit turlarında bayatladı — deponun bilinen "kod/TM'de bitti, PLAN üst-özeti bayat" deseni (§D55/§D56/§D68). D69'dan farkı: D69'da özet gerçekten doğruydu, panelin sayısı yalnız naif yanlış-pozitifti; **bu turda özet fiilen yanlış** (yeni bir `◐` doğdu, sayaçta yok). **Panelin `7 ✅ / 19 ⬜`'i** yine naif ham-glif kayması: `06.3.2-bulk` satırının (satır 1108) gömülü `` `✅` `` glifi öncü `⬜`'yi `✅` sayıp `+1 ✅ / −1 ⬜` kaydırıyor (öncü-damga: `6 ✅ / 20 ⬜`; naif: `7 ✅ / 19 ⬜`) — kalıcı yanlış-pozitif kaynağı (§D68/§D69), ama bu turda altında **gerçek** bir `◐` bayatlığı var. **Yapılan (YALNIZ dağılım sayacı):** satır 22 + satır 1100 → `20 ⬜ · 1 ◐ · 6 ✅ · 3 ⛔`. **Dokunulmadı:** gereksinim satır damgaları (kanıta dayalı); `23 açık kalem` kapanış-paydası (satır 22-col5 · satır 2318) + §5.2 `23 kalem` kırılım kapsamı — 08.9.7'nin kısmi teslimi payda içi **ilerlemedir** (◐, hâlâ açık kalem), kapsam değişikliği değil; `📋 PLANLANDI, kod başlamadı` anlatısı (kapsam dışı — sayaç düzeltmesi, anlatı revizyonu değil).
- **D71 (Faz-2 üst-tablo sayacı — §D70 sonrası panel yine çelişki bildirdi; özet DOĞRU, DEĞİŞMEDİ; naif-glif kaynağı KÖKTEN KAPATILDI · 2026-08-02):** Panel §1.2 çelişkisi bildirdi (özet `6 ✅ / 20 ⬜`, sayım `7 ✅ / 19 ⬜`). **Bağımsız re-doğrulama (grep, öncü-damga; §5.0 satır 1108–1137, 30 satır):** **20 ⬜ · 1 ◐ · 6 ✅ · 3 ⛔** (toplam 30 sabit) → üst-tablo (satır 22) + §5.0 girişi (satır 1100) ile **birebir uyuşuyor; özet DOĞRU, bayat DEĞİL** — §D70'in gerçek `◐` bayatlığı zaten kapatıldı, bu turda altında **gerçek** bayatlık YOK. §5.0 dışında öncü damga taşıyan Faz-2 tablosu yok (§5.2 kırılım · §5.3.2 dilim · §G düz tablo hedef değil — grep 0). **Kök neden (üçüncü tekrar, §D68/§D69/§D70):** panelin `7 ✅ / 19 ⬜`'i naif ham-glif kayması — `06.3.2-bulk` satırının (satır 1108) notu v1 kardeş satırına atıfla gömülü `` `✅` ``/`` `⬜` `` glifleri taşıyordu → naif sayaç o satırı öncü `⬜` yerine `✅` sayıp `+1 ✅ / −1 ⬜` kaydırıyordu (öncü-damga: 6 ✅ / 20 ⬜; naif: 7 ✅ / 19 ⬜). **Yapılan — §D69'un öngördüğü kök kapatma ("sonraki tarama bunu doğrudan kapatabilir"):** satır 1108 notundaki iki gömülü glif düz metne çevrildi (`` `✅` `` → **teslim** (kapalı) · `` `⬜` `` → **açık** (yapılmadı)) — yalnız açıklama prozası; satırın öncü durum damgası (`⬜`) ve anlamı DEĞİŞMEDİ. Artık §5.0'da gömülü glif kalmadı (grep 0) → naif ham-glif sayımı da öncü-damga sayımıyla (6 ✅ / 20 ⬜) yakınsar → yanlış-pozitif bir sonraki taramada kendiliğinden kapanır, döngü kırıldı. **Dokunulmadı:** özet sayacı (satır 22 + 1100 — zaten doğru; 7/19'a çekmek onu BOZARDI) · gereksinim satır damgaları (kanıta dayalı) · §D68/§D69/§D70 (append-only tarihçe; gömülü glife atıfları yazıldıkları an doğruydu).
- **D72 (Faz-2 üst-tablo + §5.0 dağılım sayacı GERÇEKTEN bayattı — 07.5 `⬜→◐` + Multibrand `◐→✅`, sayaç güncellenmedi · 2026-08-02):** Panel §1.2 çelişkisi bildirdi (özet `7 ✅ / 19 ⬜`, sayım `8 ✅ / 18 ⬜`). **Bağımsız re-doğrulama (grep, öncü-damga; §5.0 satır 1108–1137, 30 satır, her satır tam 1 glif → ham sayım = öncü sayım):** **18 ⬜ · 1 ◐ · 8 ✅ · 3 ⛔** (toplam 30 sabit) → özet (satır 22 + satır 1100) `19 ⬜ · 7 ✅` ile **UYUŞMUYOR: özet bayat.** **Kök neden — özet son yazımından (commit `2bcef94`; o tree'de özet=tablo=`7✅/19⬜/1◐/3⛔`, TUTARLI) bu yana iki öncü damga ilerledi, sayaç güncellenmedi:** (a) `07.5` (satır 1109) `⬜→◐` — commit `b642ebc` (tm 63.1, ReportsBreakdown by_hour/team/channel kısmi teslim); (b) `§5.3-Marka` Multibrand (satır 1134) `◐→✅` — commit `10e13ff` (tm 78.8, cross-brand isolation matrix). Net `+1 ✅ / −1 ⬜`; ◐ sayısı 1'de sabit (07.5 girdi, Multibrand çıktı) → panelin ◐/⛔ bildirmemesi doğru. İkisi de gerçek teslim → deponun bilinen "kod/TM'de bitti, PLAN üst-özeti bayat" deseni (§D55/§D56/§D68/§D70), naif-glif yanlış-pozitifi DEĞİL: §D71 kök kapatması tuttu — satır 1108'de gömülü glif YOK (grep 0), bu yüzden ham-glif sayımı öncü-damga sayımıyla birebir aynı çıkıyor. **Yapılan (YALNIZ dağılım sayacı):** satır 22 + satır 1100 → `18 ⬜ · 1 ◐ · 8 ✅ · 3 ⛔`. **Dokunulmadı:** gereksinim satır damgaları (kanıta dayalı); `23 açık kalem` kapanış-paydası (satır 22-col5 · satır 1102 · satır 2318) + §5.2 `23 kalem` kırılım kapsamı — 07.5/Multibrand ilerlemesi payda içi ilerlemedir, kapsam değişikliği değil (§D68/§D70 ile aynı ilke).
- **D73 (Faz-2 üst-tablo + §5.0 dağılım sayacı GERÇEKTEN bayattı — 4 kalem `⬜/◐→✅` (07.5/07.6/08.6.3/08.8.3), sayaç güncellenmedi · 2026-08-03):** Panel §1.2 çelişkisi bildirdi (özet `8 ✅ / 1 ◐ / 18 ⬜`, panel sayımı `2 ✅ / 0 ◐ / 1 ⬜`). **Bağımsız re-doğrulama (awk, öncü-damga; §5.0 satır 1108–1167, 30 satır — cell'ler teslim notlarıyla büyüdüğü için fiziksel aralık D72'deki 1137'den 1167'ye uzadı, satır SAYISI 30 sabit):** **15 ⬜ · 0 ◐ · 12 ✅ · 3 ⛔** (toplam 30) → üst-tablo (satır 22 = `18 ⬜ · 1 ◐ · 8 ✅`) + §5.0 girişi (satır 1100 = `17 ⬜ · 1 ◐ · 9 ✅`) ile **UYUŞMUYOR: özet bayat** (üstelik iki özet birbiriyle de tutmuyordu — `8` vs `9 ✅`). **Kök neden — özet son doğru yazımından (§D72 · commit `cf1ea463`, 2026-08-02; o tree'de özet=tablo=`18 ⬜ · 1 ◐ · 8 ✅ · 3 ⛔`, TUTARLI — `git show cf1ea463:PLAN.md` öncü-damga sayımıyla doğrulandı) bu yana 2026-08-03 teslim dalgasında DÖRT öncü damga ilerledi, sayaç güncellenmedi:** (a) `07.5` (satır 1109) `◐→✅` — ReportsBreakdown boyut kırılımı tam (tm 63.1–63.9); (b) `07.6` (satır 1110) `⬜→✅` — Chat topics kümeleme + e2e (tm 64.1–64.8); (c) `08.6.3` (satır 1115) `⬜→✅` — skills-based routing + supervisor takeover (tm 66.x, migration `20260803100000`, e2e `560d2175`/tm 66.9); (d) `08.8.3` (satır 1132) `⬜→✅` — MCP server tool yüzeyi (tm 67.x, `c2bd633`/tm 67.5). Net `+4 ✅ / −3 ⬜ / −1 ◐`; ◐ 1→0 (07.5 çıktı, yeni ◐ doğmadı). **Kanıt (git):** üst-özet commit'i `cf1ea463` anında bu dört satırın öncü damgaları `07.5=◐ · 07.6=⬜ · 08.6.3=⬜ · 08.8.3=⬜`'ti; dördü de HEAD'de `✅` (satırlar 2026-08-03'te düzenlendi, özetten SONRA). §5.0 girişi (satır 1100) ara commit `cb98760a`'da yalnız `9 ✅`'e kısmen bumplanmış ama orada da durmuştu; üst-tablo (satır 22) hiç dokunulmamıştı. Dördü de gerçek teslim → deponun bilinen "kod/TM'de bitti, PLAN üst-özeti bayat" deseni (§D55/§D56/§D68/§D70/§D72), naif-glif yanlış-pozitifi DEĞİL: §D71 kök kapatması tuttu (satır 1108'de gömülü glif YOK, grep 0 → ham-glif = öncü-damga). Satır sayısı sabit (30) + ⛔ sabit (3) → **yeni satır yok, kapsam değişikliği yok** — yalnız damga akışı + sayılmayan özet. **Panelin `2 ✅ / 0 ◐ / 1 ⬜`'i** ne öncü-damga ne ham-glif sayımıyla örtüşüyor (dejenere/kırık okuma) → dikkate alınmadı; öncü-damga awk sayımı §F.00/§1.2 gereği tek geçerli yöntemdir. **Yapılan (YALNIZ dağılım sayacı):** satır 22 + satır 1100 → `15 ⬜ · 0 ◐ · 12 ✅ · 3 ⛔` (iki özet artık birbiriyle ve tabloyla birebir). **Dokunulmadı:** gereksinim satır damgaları (kanıta dayalı); `23 açık kalem` kapanış-paydası (satır 22-col5 · satır 1102 · satır 2318) + §5.2 `23 kalem` kırılım kapsamı — dört teslim payda içi ilerlemedir, kapsam değişikliği değil (§D68/§D70/§D72 ile aynı ilke); `📋 PLANLANDI, kod başlamadı` anlatısı (kapsam dışı — bu iş sayaç düzeltmesidir, anlatı revizyonu değil).
- **D74 (Faz-2 üst-tablo + §5.0 dağılım sayacı GERÇEKTEN bayattı — 07.7 `⬜→◐` + §5.3-KB Public KB `◐→✅`, sayaç güncellenmedi · 2026-08-03):** Panel §1.2 çelişkisi bildirdi (bulgu #9bb521084cea; özet `12 ✅ / 1 ◐ / 14 ⬜`, panel sayımı `2 ✅ / 0 ◐ / 1 ⬜`). **Bağımsız re-doğrulama (grep/awk, öncü-damga; §5.0 satır 1108–1169, 30 satır):** **13 ⬜ · 1 ◐ · 13 ✅ · 3 ⛔** (toplam 30 sabit) → üst-tablo (satır 22) + §5.0 girişi (satır 1100) `14 ⬜ · 1 ◐ · 12 ✅` ile **UYUŞMUYOR: özet bayat.** **Kök neden — özet son doğru yazımından (commit `7c50ec6`, 2026-08-03 15:47; o tree'de özet=tablo=`14 ⬜ · 1 ◐ · 12 ✅ · 3 ⛔`, `git show 7c50ec6:PLAN.md` öncü-damga sayımıyla doğrulandı) bu yana İKİ öncü damga ilerledi, sayaç güncellenmedi:** (a) `07.7` Rapor grupları v2 payı (satır 1112) `⬜→◐` — commit `4a57d6a` (tm 93.2, Leads rapor grubu izolasyon çekirdeği + CSV; 20:52, özetten SONRA); (b) `§5.3-KB` Public KB (satır 1162) `◐→✅` — commit `09944d3` (tm 76.9, public KB uçtan uca doğrulama e2e; 19:59, özetten SONRA). Net `+1 ✅ / −1 ⬜`; ◐ 1'de sabit (07.7 girdi, KB çıktı) → panelin ◐/⛔ bildirmemesi tutarlı. İkisi de gerçek damga akışı → deponun bilinen "kod/TM'de bitti, PLAN üst-özeti bayat" deseni (§D55/§D56/§D68/§D70/§D72/§D73). Satır SAYISI sabit (30) + ⛔ sabit (3) → **yeni satır yok, kapsam değişikliği yok** — yalnız damga akışı + sayılmayan özet. **Panelin `2 ✅ / 0 ◐ / 1 ⬜`'i** öncü-damga sayımıyla örtüşmüyor: panel parser'ı §5.0 tablosunu ilk sarkan devam satırında keser (satır 1111 `**Kalan:** 07.6-h e2e. → §5.2 |` — `|` ile başlamaz → GFM tablosunu bitirir) ve yalnız ilk 3 fiziksel satırı okur (06.3.2-bulk ⬜ · 07.5 ✅ · 07.6 ✅ = `2 ✅ / 0 ◐ / 1 ⬜`) → dejenere okuma; §F.00/§1.2 gereği öncü-damga sayımı tek geçerli yöntem (§D73 ile aynı sonuç). **Bu bulgu her taramada yeniden AÇILABİLİR** — panel parser'ı §5.0'ın 30 satırının 27'sini görmüyor; kalıcı çözüm ya §5.0 tablosunun tek-fiziksel-satıra reflow'u ya da panel sayacının düzeltilmesidir, ikisi de bu pencerenin "yalnız özet satırı" kapsamı DIŞINDA (nexa-panel ayrı depo). **Yapılan (YALNIZ dağılım sayacı):** satır 22 + satır 1100 → `13 ⬜ · 1 ◐ · 13 ✅ · 3 ⛔` (iki özet birbiriyle ve tabloyla birebir). **Dokunulmadı:** gereksinim satır damgaları (kanıta dayalı); `23 açık kalem` kapanış-paydası (satır 22-col5 · satır 1102 · satır 2318) + §5.2 `23 kalem` kırılım kapsamı — 07.7/KB ilerlemesi payda içi ilerlemedir, kapsam değişikliği değil; `📋 PLANLANDI, kod başlamadı` anlatısı (kapsam dışı — sayaç düzeltmesi, anlatı revizyonu değil).
- **D75 (Faz-2 özet sayacı BAYAT DEĞİL — panel bulgusu YANLIŞ POZİTİF, §D74'ün öngördüğü dejenere parse tekrarı · 2026-08-07):** Panel yine §1.2 çelişkisi bildirdi (özet `13 ✅ / 1 ◐ / 13 ⬜`, panel sayımı `2 ✅ / 0 ◐ / 1 ⬜`). **Bağımsız re-doğrulama (awk, öncü-damga; §5.0 satır 1108–1169, `^\| ` ile başlayan 30 fiziksel satır, damgası 6. alanın ilk karakteri — 30/30 satır damga taşıdı, `??` yok → parse tam):** **13 ⬜ · 1 ◐ · 13 ✅ · 3 ⛔** (toplam 30) — üst-tablo (satır 22) + §5.0 girişi (satır 1100) ile **BİREBİR AYNI: özet DOĞRU, düzeltme gerekmiyor.** Damga akışı da yok: `git show 593ace7:PLAN.md` (§D74'ün özet düzeltmesi) aynı yöntemle sayıldığında yine `13 ⬜ · 1 ◐ · 13 ✅ · 3 ⛔` → o commit'ten bu yana **hiçbir öncü damga ilerlemedi**; aradaki tek gereksinim-ilgili iş 07.7 alt-görevleridir (tm 93.3 done `86b9621` · tm 93.4 **blocked** `c1c1ad7`, 12 alt-görevin yalnız a/b/c'si kapalı) → `07.7` hâlâ `◐`, `13.5` Sales tracker hâlâ `⬜` (93.4 rapor grubunun `configured:false` iskeleti, tracker'ın kendisi değil) — ikisi de doğru. **Kök neden — özet değil panel parser'ı:** §D74'te teşhis edilen dejenere okuma birebir tekrarladı; parser §5.0 tablosunu ilk sarkan devam satırında keser (satır 1111 `**Kalan:** 07.6-h e2e. → §5.2 |` — `|` ile başlamaz) ve yalnız ilk 3 fiziksel satırı okur (1108 `06.3.2-bulk ⬜` · 1109 `07.5 ✅` · 1110 `07.6 ✅`) = tam olarak `2 ✅ / 0 ◐ / 1 ⬜`; panelin rakamları bu üç satırla aritmetik olarak birebir eşleşiyor → sayaç bayatlığı DEĞİL, 30 satırın 27'sinin görülmemesi. Sarkan devam satırları: 1111 · 1116–1130 · 1133–1146 · 1164 (sırasıyla 07.6 · 08.6.3 · 08.8.3 · §5.3-KB satırlarının hard-wrap kuyrukları). **Yapılan:** hiçbir sayı değiştirilmedi — özet zaten gerçek sayımla eşit olduğu için satır 22'yi "düzeltmek" hatayı ENJEKTE ederdi; yalnız bu §D kaydı yazıldı. **Dokunulmadı:** gereksinim satır damgaları · özet sayaçları (satır 22 · satır 1100) · `23 açık kalem` kapanış-paydası. **KALICI ÇÖZÜM GEREKİYOR (yetki bekliyor):** bu bulgu §D74'ün uyardığı gibi her taramada yeniden açılıyor (D72/D73 gerçek bayatlıktı, D74 gerçek, D75 yanlış pozitif) ve her turda bir pencere yakıyor; iki seçenek — (a) §5.0'ın 4 sarkan satırını kendi tablo satırlarına reflow etmek (damgalara dokunmaz, GFM'de eşdeğer, tabloyu 30 temiz fiziksel satır yapar), (b) panel sayacını düzeltmek (nexa-panel ayrı depo). İkisi de bu pencerenin "yalnız özet satırı" kapsamı dışında bırakıldı; (a) tek satırlık yetkiyle bu depoda yapılabilir.
- **D76 (Faz-2 özet sayacı BAYAT DEĞİL — §D75'in yanlış pozitifi birebir tekrarladı; özet DEĞİŞMEDİ, kalıcı çözüm artık tm 101 `critical` · 2026-08-07):** Panel yine §1.2 çelişkisi bildirdi (özet `13 ✅ / 2 ◐ / 12 ⬜`, panel sayımı `2 ✅ / 0 ◐ / 1 ⬜`). **Bağımsız re-doğrulama (python, MANTIKSAL satır birleştirmeli; §5.0 satır 1108–1169: `^\| ` ile başlayan satır yeni kalem, sarkan devam satırları kendi kalemine eklendi; damga = 6. alanın öncü karakteri — 30/30 kalem damga taşıdı, `??` yok):** **12 ⬜ · 2 ◐ · 13 ✅ · 3 ⛔** (toplam 30) — üst-tablo (satır 22) + §5.0 girişi (satır 1100) ile **BİREBİR AYNI: özet DOĞRU, hiçbir sayı değiştirilmedi** (değiştirmek hatayı ENJEKTE ederdi). **Damga akışı da temiz:** `git show bdf5a1b:PLAN.md` (§D75 turu) aynı yöntemle `13 ⬜ · 1 ◐ · 13 ✅ · 3 ⛔`; aradaki tek hareket `§5.3-Vardiya ⬜→◐` (WORKSCHED-a/b/c teslim, tm 77.1–77.3) ve o damgayı çeviren commit (`495b059`) **satır 22 + satır 1100 sayaçlarını aynı commit'te birlikte güncellemiş** → bayatlık penceresi hiç oluşmadı. **Kök neden — özet değil panel parser'ı (dördüncü tekrar, §D71/§D74/§D75):** parser §5.0 tablosunu ilk sarkan devam satırında keser (satır 1111 `**Kalan:** 07.6-h e2e. → §5.2 |` — `|` ile başlamaz) ve yalnız ilk 3 fiziksel satırı okur (1108 `06.3.2-bulk ⬜` · 1109 `07.5 ✅` · 1110 `07.6 ✅`) = tam olarak `2 ✅ / 0 ◐ / 1 ⬜`; sayaç bayatlığı DEĞİL, 30 kalemin 27'sinin görülmemesi. Sarkan kuyruklar: 1111 (07.6) · 1116–1130 (08.6.3) · 1133–1146 (08.8.3) · 1163–1164 (§5.3-KB; **1163 BOŞ SATIR** — tabloyu GFM render'ında da böler). **Yapılan — §D75'in "yetki bekliyor" bıraktığı kök kapatma artık kuyrukta:** reflow işi Task Master'a **tm 101 · priority `critical` · dependencies `[]`** olarak açıldı (4 sarkan satırı kendi tablo satırlarına birleştir → 30 temiz fiziksel satır; damga/sayaç/metin değişmez, doğrulama scripti test stratejisinde). Bu pencerede yalnız bu §D kaydı + HANDOFF yazıldı. **Dokunulmadı:** gereksinim satır damgaları (kanıta dayalı) · özet sayaçları (satır 22 · satır 1100) · `23 açık kalem` kapanış-paydası · §D68–§D75 (append-only tarihçe).
- **D77 (§5.0 tablosunun 4 sarkan satırı REFLOW EDİLDİ — dejenere parse döngüsü KÖKTEN KAPATILDI; hiçbir damga/sayaç/metin değişmedi · tm 101 · 2026-08-08):** §D75'in "(a) reflow — yetki bekliyor" diye bıraktığı, §D76'nın **tm 101 `critical`** olarak kuyruğa aldığı kalıcı çözüm uygulandı. **Yapılan:** §5.0 tablosunda hücre içeriği fiziksel satırlara hard-wrap edilmiş 4 mantıksal satırın **32 devam satırı** kendi tablo satırının sonuna birleştirildi (satır sonu → tek boşluk): `07.6` (1 kuyruk satırı) · `08.6.3` (15) · `08.8.3` (14) · `§5.3-KB` (2 — biri **boş satır**, GFM render'ında tabloyu fiilen bitiriyordu). Tablo artık **30 mantıksal = 30 fiziksel** satır; blokta `| ` ile başlamayan satır **0**. **Doğrulama (script, exit 0 — 4 kapı):** (1) **içerik korunumu** — reflow öncesi/sonrası 30 mantıksal satır whitespace-normalize edilerek **30/30 birebir eşit** (tek karakter kaybı/eklemesi yok); (2) **naif sayaç yakınsadı** — panelin yaptığı satır-bazlı sayım önce `2 ✅ / 0 ◐ / 1 ⬜` (yalnız 3 satır okunuyordu, §D75/§D76'nın teşhis ettiği aritmetik), sonra **12 ⬜ · 0 ◐ · 15 ✅ · 3 ⛔ = 30** → naif sayım artık MANTIKSAL sayımla **birebir aynı**, yani bulgunun kaynağı ortadan kalktı; (3) **tablo bütünlüğü** — blokta sarkan/boş satır 0; (4) **sızıntı yok** — dosya geneli damga çoklukları önce=sonra (`✅ 568 · ◐ 160 · ⬜ 188 · ⛔ 57`), §5.0 dışı hiçbir satır değişmedi, `git diff --numstat` PLAN.md **+4 / −36** (4 satır 36 satırın yerine geçti). **YENİ BULGU — sayaçlar artık GERÇEKTEN 1 kalem bayat (bu pencerede DEĞİŞTİRİLMEDİ, tm 101 kapsamı dışı):** reflow sonrası tablo `12 ⬜ · 0 ◐ · 15 ✅ · 3 ⛔` sayıyor, satır 22 + satır 1100 özetleri ise hâlâ `12 ⬜ · 1 ◐ · 14 ✅ · 3 ⛔` diyor. Kaynak (git tarihçesi, son 12 PLAN.md revizyonunda mantıksal sayım): `5d2c096` (WORKSCHED-j) `§5.3-Vardiya ◐→✅` çevirirken **iki özeti de aynı commit'te güncelledi** (bayatlık oluşmadı); ardından `6230b4f` (07.7-l · tm 93.12) `07.7 ◐→✅` çevirdi ama **özet sayaçlarına dokunmadı** → tek kalemlik gerçek bayatlık oradan geliyor. tm 101 detayı "sayaçları değiştirmek KAPSAM DIŞI" dediği için burada düzeltilmedi (o premis, özet ile tablonun eşit olduğu §D76 anına aitti; artık eşit değiller) — ayrı görev olarak açıldı, bkz. `HANDOFF.md`. Düzeltme tek satırlık: iki özette `1 ◐ · 14 ✅` → `0 ◐ · 15 ✅`. **Dokunulmadı:** gereksinim satır damgaları (kanıta dayalı) · özet sayaçları (satır 22 · satır 1100) · `23 açık kalem` kapanış-paydası · §5.1/§5.2/§5.3 · §D68–§D76 (append-only tarihçe) · `run-loop.sh` (bu pencereden önce de kirliydi).
- **D78 (Faz-2 özet sayaçları tabloyla eşitlendi — §D77'nin işaret ettiği 1 kalemlik gerçek bayatlık kapatıldı · tm 102 · 2026-08-08):** **Bayat commit:** `6230b4f` (07.7-l · tm 93.12) `07.7` damgasını `◐→✅` çevirdi ama satır 22 + satır 1100 özet sayaçlarına dokunmadı → özetler `12 ⬜ · 1 ◐ · 14 ✅ · 3 ⛔`da kaldı. (Karşı örnek, doğru davranış: `5d2c096`/WORKSCHED-j `§5.3-Vardiya ◐→✅` çevirirken iki sayacı **aynı commit'te** güncellemişti — bayatlık penceresi hiç oluşmamıştı.) **Yeni sayım (körlemesine yazılmadı — script, exit 0; §5.0 başlığı → §5.1 arası, `^\| ` ile başlayan satırlar, damga = 6. alanın öncü karakteri):** 30 veri satırı, hepsi geçerli damga (`??` yok) → **12 ⬜ · 0 ◐ · 15 ✅ · 3 ⛔ = 30**. tm 101 reflow'undan sonra 30 mantıksal = 30 fiziksel satır olduğu için mantıksal ve naif sayım aynı sonucu veriyor. **Yapılan (YALNIZ iki özet satırı):** satır 22 + satır 1100 → `12 ⬜ açık · 0 ◐ kısmi · 15 ✅ teslim · 3 ⛔ kapsam dışı`; iki özet artık birbiriyle ve tabloyla birebir. **Kaynak kapandı:** panel bir sonraki taramada §1.2 çelişkisi bildirmeyecek — §D68–§D76 serisinin iki ayağı (dejenere parser → tm 101/§D77; bayat sayaç → bu kayıt) da kapalı. **Dokunulmadı:** gereksinim satır damgaları (kanıta dayalı — diff'te damga ekleyen/silen satır yok) · §5.0 tablosunun düzeni (tm 101'in 30 temiz satırı korundu, blokta `^\| ` ile başlamayan satır 0) · `23 açık kalem` kapanış-paydası (satır 22-col5 · satır 1102 · satır 2318 — 07.7'nin teslimi payda içi ilerlemedir, kapsam değişikliği değil) · `📋 PLANLANDI, kod başlamadı` anlatısı · §D68–§D77 (append-only tarihçe) · `run-loop.sh` (bu pencereden önce de kirliydi).
- **D79 (tm 97 "in-progress'te asılı" bulgusu YANLIŞ POZİTİF — durum DEĞİŞTİRİLMEDİ; asıl kusur `pick_next` kuralı 1'in üst-görev tuzağıydı, o kapatıldı · 2026-08-09):** Panelin sağlık taraması tm 97'yi (`06.3.2-bulk`) "in-progress ama canlı pencere yok" diye işaretledi. **Denetim sonucu: terk edilmiş iş YOK.** tm 97 bir **üst görevdir** ve kendi `details`'i "bu görevin kendisi kod YAZMAZ" der; `in-progress` olmasının tek sebebi alt-görev **97.1'in bitmiş** olmasıdır — bu CONVENTIONS §4'ün ("alt-görevlerin hepsi done olunca üst task done") tanımladığı **normal ara durumdur**. Kanıt: `.loop-logs/task-97.jsonl` **yok** (üst görev hiç koşulmadı), yalnız `task-97.1.jsonl` var ve **temiz** bitmiş — `terminal_reason: completed`, `{"status":"done","task_id":"97.1"}`, DoD tam yeşil (unit 1980 · integration 1491 · e2e 86/86), commit `6d31a76` + `34ec673` push edildi, `feat/csv-import-parser` dalı silindi; PLAN §5.1 `06.3.2-bulk` satırı ⬜→◐ + kanıt yazılmış, HANDOFF notu düşülmüş. Çalışma alanı temiz. **Bu yüzden tm 97 `pending`'e ÇEKİLMEDİ** — çekmek 97.1'in bittiğini inkâr eden bir gerileme olurdu; doğru durum `in-progress`'tir. **Ama bulgu gerçek bir kusuru ortaya çıkardı:** `pick_next` kuralı 1 ("in-progress bir görev VEYA alt-görev varsa ONU seç") kural 3'teki "üst görev kod yazmaz, alt-görevleri koşulur" istisnasını **taşımıyordu** — yani döngü açıldığında üst görev 97'yi seçip pahalı ve **boş** bir pencere açabilirdi (iş yok, ilerleme yok). Kural 1'e üst-görev→alt-görev yönlendirmesi eklendi (1.5'e de tek satır atıf). Ayrıca pnpm-only depoda `npm install` artığı `package-lock.json` her taramada "kirli çalışma alanı" bulgusu üretiyordu → `.gitignore`'a alındı (`yarn.lock` ile birlikte); hiçbir dalda izlenmemişti (`git log --all -- package-lock.json` boş). **Sıradaki iş:** 97.2 (`06.3.2-bulk-b`, bağımlılık yok) ve 97.4 (`06.3.2-bulk-d`, bağımlılık yok) hazır. → §5.2.13 · §D67
- **D80 (test veri depoları koşu başına İZOLE — DoD kapısının objektifliği onarıldı; ÜRÜN KODU DEĞİŞMEDİ · tm 105 · 2026-08-09):** §D-öncesi durum: `@nexa/api` + `@nexa/rtm` gerçek Postgres/Redis'e karşı koşuyor ve her süit `TRUNCATE ... CASCADE` ile başlıyordu; aynı anda açık iki otonom pencere aynı `nexa` veritabanını paylaştığı için birbirinin fixture'ını siliyordu. Sonuç, pencerenin **hiç dokunmadığı** dosyalarda yüzlerce kırmızıydı — tm 97.6 kapanışında ölçüldü: art arda iki koşu **889 → 982** farklı kırmızı, `report-csv.test.ts`'te CANLI `unique constraint (email)` çakışması, `pg_stat_activity`'de yarım kalmış `idle in transaction` bağlantı, ve `git diff --stat -- apps/api` BOŞ. Kapı bu haliyle objektif değildi: her pencere ya yanlışlıkla `blocked` ilan edecek ya da her seferinde elle kök-neden analizi yapacaktı. **Çözüm (seçenek 2 — "her pencereye ayrı DB"; seçenek 1/3'teki kilit/mutex reddedildi çünkü pencereleri sıraya sokar, sorunu çözmez yalnız serileştirir):** `apps/api/scripts/test-datastores.ts` + CLI sarmalayıcı `with-test-datastores.ts`; `@nexa/api` ve `@nexa/rtm`'in `test`/`test:unit`/`test:integration` script'leri artık bu sarmalayıcıdan geçiyor. Her koşu (a) kendi `nexa_test_<12 hex>` veritabanını alır — `CREATE DATABASE` → `prisma migrate deploy` (**~3 sn** ölçüldü; şablon-DB klonlama bilinçli olarak YAPILMADI: 6 dakikalık süitin yanında yanlış sayıyı optimize edip geçersiz kılınacak bir önbellek eklerdi) → koşu sonunda `DROP DATABASE ... WITH (FORCE)`; (b) kendi Redis **mantıksal veritabanını** kiralar (1-15; index 0 kiralama defterine ayrıldı ve asla flush edilmez), kiralanan index koşu başında `FLUSHDB` ile temizlenir; (c) kendi **lisans id ofsetini** alır. **(c) neden gerekli:** Redis pub/sub kanalları mantıksal veritabanına göre ayrılmaz ve `licenseChannel()` kanalı autoincrement id ile adlandırır — iki koşu da `nexa:rtm:license:1` üzerinde yayın yapıp birbirinin zarfını okurdu. `resetDatabase()` (İKİ paketin `test/helpers/fixtures.ts`'i) TRUNCATE'ten SONRA `licenses_id_seq`'i ofsetin üstüne taşır, böylece kanal adları da ayrışır — **ürün kodu değişmeden**. Ölü pencere kurtarma: canlılık Redis kirasıdır (yaş eşiği DEĞİL — yaş ya sağlıklı-ama-yavaş koşuyu biçer ya da çöp bırakır), 5 dk TTL + 60 sn kalp atışı; kirası düşmüş veritabanını bir sonraki koşu **kiralamadan ÖNCE** süpürür (turbo, kardeş görev kırmızıya düşünce diğerlerini SIGKILL'lediği için bu senaryo teorik değil — koşu temizlenemeden ölür). Her `DROP` `assertDroppableDatabaseName()` kapısından geçer (tam `nexa_test_<12 hex>` biçimi; salt önek değil — filtredeki bir yazım hatası geliştirme veritabanını düşürürdü). Ayrıca izole URL'lere **bağlantı bütçesi** eklendi (`connection_limit=10`, `connect_timeout=20`, `pool_timeout=30`): ayrı veritabanları veriyi ayırır ama sunucu hâlâ tek, ve Prisma'nın CPU sayısından türeyen varsayılan havuzu iki süitte "Can't reach database server" zaman aşımı üretiyordu. **Sonuç:** iki tam `@nexa/api` süiti aynı anda koşuldu → 889-982 kırmızı yerine **her ikisi de yalnız tm 107'nin bilinen tarih kusuruyla kırmızı** (aşağıda HANDOFF'ta sayılar). `--concurrency=1` zorunluluğu kalktı (kök `test:integration`'dan kaldırıldı); turbo `@nexa/api` + `@nexa/rtm`'i paralel koşturdu ve ikisi de temiz. Kaçış kapağı `NEXA_TEST_ISOLATION=off`. İSTİSNA: `apps/e2e` sabit portlarda gerçek sunucuları ve seed'lenmiş `nexa` veritabanını sürer — iki pencere aynı anda e2e koşamaz (port çakışması olarak GÜRÜLTÜLÜ düşer, sessiz bozulma değil). Doküman senkronu: `CONVENTIONS.md` §1.1 (yeni), `TASK-RUNNER-PROMPT.md` §2'nin "DB testleri paralel koşmaz" paragrafı yeniden yazıldı, `README.md` "Test datastores are private to each run". **PLAN gereksinim satırı YOK:** tm 105 bir PRD gereksinimi değil, sağlık taramasından doğan altyapı görevidir (başlığında iş kalemi kimliği taşımaz, `Düz tablo`da karşılığı yoktur) — bu yüzden damga çevrilmedi, kayıt §D'ye düşüldü. → §D53 (kapı disiplini) · CONVENTIONS §1.1
- **D81 (widget'tan müşteri mesajı TARAYICIDA kırıktı — `connect()`/`send()` yarışı; e2e 72/87 → 87/87 · tm 106 · 2026-08-09):** §D-öncesi durum: e2e süiti bu makinede ilk kez koşulur hale gelince (tm 97.8) `visitorSends()` kullanan **15 test** düşüyordu; transkript boş kalıyor, optimistic balon geri alınıyordu. Aynı akış doğrudan HTTP ile **201** dönüyordu (tm 97.8 ölçtü), yani hata sunucuda değildi. **Kök neden (kanıtlandı, tahmin değil):** widget'ın composer'ı ilk kareden itibaren ekranda — `renderPrechat()` onu yalnız bir pre-chat formu yapılandırılmışsa gizler — ama token minti (`connect()`) `setOpen(true)` içinde `void connect()` ile ateşlenip beklenmiyordu. Hızlı yazan (veya makine hızında koşan) biri minti geçiyor, `api.send()` `#token === null` olduğu için `WidgetApiError: not connected` atıyor, `send()`'in catch dalı balonu geri alıyor ve **istek ağa hiç çıkmıyor**. `onPickFile()` bu yarışı zaten biliyordu ve korumasını taşıyordu (_"a fast click can beat it"_); yükleme yolunda düşünülen yarış **gönderme yolunda düşünülmemişti**. **Düzeltme iki parçalı ve ikincisi olmadan birincisi yeni bir kusur doğurur:** (a) `send()` artık `if (!api.authenticated) await connect()` taşıyor — optimistic balonun **ÖNCESİNE** konuldu, çünkü başarılı bir `connect()` `state.events`'i toptan değiştirir ve önüne itilmiş balonu düşürürdü; (b) `connect()` **tek-uçuşlu** yapıldı (`connecting ??= mint().finally(...)`) — `state.connected` mint bitene kadar `false` olduğu için sade gardiyan ikinci çağrıyı yakalamıyordu ve iki mint **iki kimlik** demekti: ilk ziyarette hiçbiri saklı bir `customer_id` taşımaz, sunucu her biri için ayrı müşteri yaratır ve ikinci sıraya düşen token, ziyaretçinin göremediği bir konuşma adına konuşurdu. **Kanıt:** `apps/widget/test/send-race.test.ts` (jsdom, 2 test) minti kasten açık tutup Send'e basıyor — düzeltme olmadan **kırmızı** (`git stash` ile birebir doğrulandı, konsolda tm 97.8'in trace.zip'inden çıkan stack'in aynısı), düzeltmeyle **yeşil**; testler ayrıca **tek** token minti atıldığını sayıyor ve DOM iddiasını sunucu yerleşene kadar bekletiyor (aksi halde geri alınmadan önceki optimistic balona takılıp yanlış yeşil verirdi — bu kusurun saklanma biçiminin ta kendisi). **İkinci, maskelenmiş kusur:** widget düzelince `inbox-panel.spec.ts:58` (çoklu-ajan çakışma bandı) ilk kez `visitorSends`'i geçti ve **kendi** yarışında düştü — ajan RTM soketi henüz `live` değilken yazıyordu. `sendTyping()` soket `live` değilse çerçeveyi **kuyruğa almaz, atar**; composer ise patlama başına tek "start" yolladığı için o tuş vuruşuyla birlikte kayıt da kaybolur, ikinci composer çakışma sayılmaz. WS çerçeve kaydıyla ölçüldü: dev'de StrictMode soketi iki kez kurar, ikinci deneme reconnect backoff'una girer ve saniyeler sürer. Test artık ürünün kendi **bağlantı rozetini** (`ConnectionBadge` → "Live") bekliyor — bir ajanın gözüyle aynı sinyal. **Ölçüm (aynı makine, sıfırdan `CREATE DATABASE` + `migrate deploy` yapılmış izole `nexa_e2e106`, koşu sonunda düşürüldü; `nexa`'ya DOKUNULMADI):** tam süit **87/87 yeşil** (tm 97.8 tabanı: 72/87). Paylaşılan `nexa` veritabanında `customers.spec` satırları hâlâ düşüyor — seed **idempotent**, TRUNCATE etmiyor, bu yüzden her e2e koşusu yeni müşteri/sohbet biriktiriyor ve seed'lenmiş Alex/Mira/Robin ilk sayfadan taşıyor; bu tm 106'nın kusuru değil, ayrı bir kayıt (aşağıda HANDOFF). **PLAN gereksinim satırı YOK:** tm 106 bir PRD gereksinimi değil, e2e kapısı koşulur hale gelince görünen bir regresyondur (başlığında iş kalemi kimliği taşımaz, `Düz tablo`da karşılığı yoktur; 11.1/11.2 gibi widget satırları zaten ✅) — tm 105'in §D80'deki emsaliyle aynı biçimde damga çevrilmedi, kayıt §D'ye düşüldü. → §D80 (kapı objektifliği) · tm 107/108 (kalan bilinen kırmızılar)
- **D82 (`pnpm -w test` bu makinede İLK KEZ exit 0 — 7 web kırmızısı makine locale'ineydi, testler pinlendi; ÜRÜN KODU DEĞİŞMEDİ · tm 108 · 2026-08-09):** §D-öncesi durum: `@nexa/web` **767/774**, sabit 7 kırmızı (`BillingPage` ×5, `ReportsPage` ×2), en az beş penceredir HANDOFF'ta "bilinen kırmızı" olarak taşınıyordu ve DoD kapısının "unit yeşil" maddesini her turda elle gerekçelendirmeye zorluyordu. **Kök neden (ölçüldü, tahmin değil):** `apps/web/src/lib/format.ts`'in `activeLocale`'i i18n store bir locale bağlayana kadar `undefined`; `new Intl.NumberFormat(undefined)` **runtime'ın varsayılan locale'ini** = işletim sisteminin locale'ini kullanır. Bu makine tr-TR → render edilen DOM `$297,00` · `4.812` · `31 Tem 2026`, test `$297.00` · `4,812` bekliyor. Kırmızılar bileşenlerin mantığını değil **koşan dizüstünü** ölçüyordu; `BillingPage`'in modül grafiği `i18n.ts`'i çekmediği için (çekseydi `applyLocale(detectLocale())` jsdom'un `navigator.language`'ından `'en'` bağlar ve kusur görünmezdi) yalnız bu iki dosya düşüyordu. **Seçim — task detayındaki (a):** locale **testte** pinlendi (`vitest.setup.ts` → `setFormatLocale('en-US')`), `format.ts`'te DEĞİL. (b) reddedildi: ürün varsayılanını 'en-US'e sabitlemek i18n'in "ajanın seçtiği dile uy" davranışını (I18N2) geri alırdı; testin işi biçimlendirme mantığını doğrulamak, koşan makinenin locale'ini değil. Pin, test dosyası import edilmeden önce koştuğu için kendi locale'ini bağlayan test (veya i18n store'un modül init'i) hâlâ kazanır — `format.test.ts`'in `setFormatLocale('tr')` bloğu dokunulmadan yeşil kaldı. **Kusurun başka makineye taşınmaması için iki mekanizma, çünkü pin'in kendisi tek başına en-US bir dizüstünde YANLIŞ SEBEPLE yeşil verir:** (1) `NEXA_TEST_RUNTIME_LOCALE=<bcp47>` — setup, runtime'ın **varsayılan** locale'ini süit boyunca yeniden yazar (`Intl.NumberFormat`/`Intl.DateTimeFormat` + `Date.prototype.toLocale{,Date,Time}String`; sonuncular `Transcript`/`DetailsPanel`/`TicketPane`'in `format.ts`'ten GEÇMEYEN çağrı yerleri, yoksa simülasyon eksik kalırdı) → **en-US · tr-TR · de-DE üçünde de 779/779 yeşil** ölçüldü; (2) `src/lib/format.locale-pin.test.ts` (+5 test) runtime varsayılanını kasten düşman (tr-TR) yapıp helper'ların hâlâ en-US ürettiğini kanıtlıyor — pin kalkarsa **her** makinede kırmızı, oysa bileşen süitleri yalnız İngilizce-olmayan bir makinede kırmızı olurdu. **Mutasyonla doğrulandı (boş geçmiyor):** setup'taki pin çıkarılıp süit `NEXA_TEST_RUNTIME_LOCALE=en-US` ile koşuldu → guard 3/5 kırmızı (`expected '$297,00' to be '$297.00'`, `'4.812'`/`'4,812'`, `'31 Tem 2026'`); pin geri konunca 89/89 (guard + iki bileşen süiti). **Sonuç:** `@nexa/web` 767/774 → **779/779**, `pnpm -w test` **exit 0** (10/10 turbo task) — bu depoda bu makinede ilk kez; kapı artık gerçek regresyonları gürültünün altında saklamıyor. **PLAN gereksinim satırı YOK:** tm 108 bir PRD gereksinimi değil, sağlık taramasından doğan test-altyapısı düzeltmesidir (başlığında iş kalemi kimliği taşımaz, `Düz tablo`da karşılığı yoktur) — §D80/§D81 emsaliyle aynı biçimde damga çevrilmedi, kayıt §D'ye düşüldü. **Kalan, bilerek dokunulmadı:** `Transcript.tsx:155/162` + `DetailsPanel.tsx:115/231` + `TicketPane.tsx:428` doğrudan `toLocale*` çağırıyor (hiçbir test bunları iddia etmiyor, bu yüzden kırmızı üretmiyorlar — ama aynı sınıf gizli makine bağımlılığı) · tarih iddiaları hâlâ **zaman dilimine** duyarlı (locale'den ayrı bir eksen; guard bu yüzden tarihte tam dize değil biçim iddia ediyor). → §D80 (kapı objektifliği) · CONVENTIONS §1
- **D83 (e2e seed KİRLİLİĞİ — `db:seed` idempotent olduğu için her koşu bir öncekinin üstüne birikiyordu; `customers.spec` sağlam bir üründe kırmızıydı · tm 109 · 2026-08-09):** §D-öncesi durum: `apps/e2e/tests/global-setup.ts` her koşudan önce `pnpm db:seed` çağırıyor ve yorumu _"Every run starts from the same fixture"_ diyordu — **bu yorum yanlıştı**. Seed idempotent: `seedTenant()` var olan organizasyonu görünce `already present, skipping` deyip çıkıyor, hiçbir tabloyu TRUNCATE etmiyor. Dolayısıyla her e2e koşusu bir öncekinin bıraktığının **üstüne** yazıyordu. Her widget spec'i saklı `customer_id` olmadan token mint ettiği için her koşu YENİ anonim ziyaretçi bırakıyor; müşteri dizini `last_activity_at DESC, id DESC` sıralı ve sayfa boyu **25** (`apps/api/src/routes/customers.ts:18`), yani taze ziyaretçiler seed'lenmiş Robin/Alex/Mira'yı ilk sayfadan taşıyor. Sonuç: `customers.spec.ts:12/51/68` + `command-palette.spec.ts:15` kırmızı — **üründe hiçbir kusur olmadan**. Yanlış teşhisin tarihi uzun: tm 97.8 kapanışı bunu "paylaşılan DB'de state kirliliği" diye kaydetmiş ama nedenini bulamamıştı; tm 106 sıfırdan izole bir DB'de aynı süitin 87/87 yeşil olduğunu ölçerek kusuru üründen ayırmıştı, ama kaynağını kapatmamıştı. **Ölçülen birikim (bu tur, düzeltmeden önce):** paylaşılan `nexa` — `customers=29 chats=42 orgs=7`, oysa seed'in yatırdığı fixture `customers=10 orgs=2`. **Çözüm — task detayındaki yön 1 (seed'den önce reset); yön 2 (e2e'yi tm 105'in izolasyon harness'ına bağlamak) REDDEDİLDİ:** e2e sabit portlarda gerçek sunucular sürüyor ve `REDIS_URL`'e mantıksal index eklemek API ile RTM'in pub/sub'ını birbirinden ayırırdı (HANDOFF'ta kayıtlı tuzak) — süiti düzeltmek yerine sessizce bozardı. `prisma migrate reset --force` de reddedildi: veritabanını **düşürür**, MASTER-PROMPT sınırı. Onun yerine `apps/api/prisma/seed.ts` opsiyonel bir sıfırlama kazandı: `NEXA_SEED_RESET=1` → katalogdan keşfedilen (elle liste bayatlar) tüm public tablolara `TRUNCATE ... RESTART IDENTITY CASCADE`; partition'lar ebeveyni üzerinden, `_prisma_migrations` hariç — `apps/api/test/helpers/fixtures.ts`'in `resetDatabase()`'i ile birebir aynı kural, ve entegrasyon süitinin bu veritabanına karşı her dosyadan önce zaten yaptığı silmenin aynısı (şema da veritabanı da yerinde kalır). **Varsayılan KAPALI**, çünkü `pnpm db:seed` bir geliştiricinin kendi çalışma alanına karşı koştuğu komuttur; sorulmadan veri silmek, düzelttiğinden daha kötü bir kusur olurdu. Tanınmayan bir değer (`NEXA_SEED_RESET=yes`) sessizce "hayır" saymak yerine **fırlatıyor** — sessizce hiçbir şey yapmamak, bu bayrağın ortadan kaldırmak için var olduğu başarısızlık biçiminin ta kendisidir. `global-setup.ts` bayrağı argüman değil **env** ile geçiriyor (iki kat `pnpm run` içinde çıplak bir `--reset` pnpm'in kendi bayraklarıyla belirsiz) ve yeni bir kapı taşıyor: seed çıktısında `already present` görürse **hata veriyor** — sıfırlama bir gün sessizce çalışmazsa süit birikime geri kaymak yerine kurulumda gürültüyle düşer. Yanıltıcı yorum da değiştirildi (task detayı madde 3): artık mekanizmayı, maliyeti ("e2e koşusu artık yerel geliştirme verisini siler; önceden yalnız üstüne ekliyordu") ve Playwright'ın `webServer`'ı global setup'tan ÖNCE başlattığını — yani TRUNCATE'in canlı sunucular bağlıyken indiğini — yazıyor. **Kabul kriteri karşılandı (art arda İKİ tam koşu, paylaşılan `nexa` veritabanına karşı):** koşu 1 **88/88** · koşu 2 **88/88**; ve satır sayımı koşular ARASINDA büyümedi — her ikisinin sonunda da `customers=26 chats=41 orgs=5 licenses=5` (düzeltmeden önce koşu 2, koşu 1'in bıraktığı 26'nın üstüne ekleyerek başlıyordu). **Mutasyonla doğrulandı (test boş geçmiyor):** sıfırlama kapatılıp iki `widget.spec.ts` koşusuyla GERÇEK birikim üretildi (Acme müşterileri **34** > 25 sayfa boyu) → `customers.spec.ts:12/51/68` **kırmızı**, yani tm 106'nın kaydettiği satırların birebir aynısı; sıfırlama geri açılıp AYNI veritabanı durumunda tekrar koşuldu → **10/10 yeşil**. **PLAN gereksinim satırı YOK:** tm 109 bir PRD gereksinimi değil, e2e kapısının objektifliğini onaran test-altyapısı düzeltmesidir (başlığında iş kalemi kimliği taşımaz, `Düz tablo`da karşılığı yoktur) — §D80/§D81/§D82 emsaliyle aynı biçimde damga çevrilmedi, kayıt §D'ye düşüldü. → §D80 (koşu başına izole test veri depoları — `apps/e2e` orada bilinçli olarak KAPSAM DIŞI bırakılmıştı) · §D81 (tm 106'nın izole-DB ölçümü) · CONVENTIONS §1.1
- **D84 (Faz-2 özet sayaçları yine bayatlamıştı — sebep: 5 damga çevrildi, hiçbir çeviren commit özeti güncellemedi · tm 110 · 2026-08-10):** Satır 22 en son `6679c26`'da (05.6-tmpl31-a · tm 98.1) yazılmıştı ve **o an doğruydu** (`7 ⬜ · 1 ◐ · 19 ✅ · 3 ⛔`); o commit'ten bu yana §5.0 tablosuna satır **eklenmedi/silinmedi** (iki tarafta da 30 satır, aynı PRD kodları, aynı sıra) — yalnız beş damga çevrildi: `05.6` ◐→✅ (`60b967c`, tm 98.5) · `08.5.7` ⬜→✅ (`51e2643`, tm 65.8) · `09.3` ⬜→✅ (`9dfed5f`, tm 71.8) · `09.4` ⬜→✅ (`4ac9cb7`, tm 72.7) · `13.2` ⬜→◐ (`05229bd`, tm 73.1); `7⬜/1◐/19✅` + bu beş çevrim = `3⬜/1◐/23✅`, yani tek sebep **bayat özet**, damga hatası veya satır ekleme değil. Satır 1100 de aynı kusurdaydı (tm 65.8'e kadar güncel tutulmuş, sonraki üç çevrimi kaçırmış → `6 ⬜ · 0 ◐ · 21 ✅`). **Yeni sayım körlemesine yazılmadı** (script, exit 0; §5.0 başlığı → §5.1 arası `^| ` satırları, damga = 6. alanın öncü karakteri): 30 veri satırı, 0 geçersiz damga → **3 ⬜ · 1 ◐ · 23 ✅ · 3 ⛔ = 30**; Task Master çapraz doğrulaması örtüşüyor (done olmayan v2 kalemleri = tm 73/74/75/99). **Yapılan (YALNIZ iki özet satırı):** 22 + 1100 → `3 ⬜ açık · 1 ◐ kısmi · 23 ✅ teslim · 3 ⛔ kapsam dışı`. **Dokunulmadı:** gereksinim satır damgaları (kanıta dayalı — diff'te damga ekleyen/silen satır yok) · `23 açık kalem` kapanış paydası (satır 22-col5 · satır 1102 · §5.2 başlığı · satır 2318 — planlama anındaki açık küme, canlı sayaç değil) · `📋 PLANLANDI, kod SÜRÜYOR` anlatısı · kod. **§D78 (tm 102) ile aynı sınıf, ikinci tekrar** — o tur tek kalemlik bayatlıktı ve iki sayacı eşitlemişti; bu tur beş kalem birikmişti. Kalıcı çözüm damga çeviren pencerenin sayacı **aynı commit'te** güncellemesidir (emsal `5d2c096`/WORKSCHED-j); bu tur da kaynak kapanmadı, yalnız sonucu düzeltildi — sayaç bir sonraki `⬜→✅`da yeniden bayatlar.
- **D85 (§D80'in KODU bir gün boyunca commit'siz durdu — dokümanı başka pencerelerin commit'lerine karıştı; kurtarma turu · tm 105 · 2026-08-10):** §D80'i yazan pencere işi bitirmiş ama **kapanışı yapamadan** 5 saatlik oturum kotasına takılıp ölmüştü (`.loop-logs/task-105.jsonl`: 2026-08-09T07:56Z'de art arda iki oturum, ikisi de tek turda HTTP 429; kontrollü durdurma kaydı `.state/last-stop.json` yok). Sonuç, deponun **kendi kendisiyle çelişmesi**: `CONVENTIONS.md` §1.1 (`e5a0437`) ve `PLAN.md` §D80 (`6679c26`) ile `TASK-RUNNER-PROMPT.md` §2, izolasyonun **yürürlükte olduğunu** anlatıyordu — çünkü sonraki pencereler o dosyaları kendi işleri için düzenlerken kirli çalışma alanında duran tm 105 doküman değişikliklerini farkında olmadan kendi commit'lerine aldılar — oysa mekanizmanın **kodu** (`apps/api/scripts/test-datastores.ts` + `with-test-datastores.ts` + iki `fixtures.ts` ofseti + `package.json`/`turbo.json`/`tsconfig.json` bağlantıları + `README.md` bölümü) hâlâ commit'siz duruyordu. Yani depoyu klonlayan biri belgelenen izolasyonu ALMIYORDU; `pnpm -w test:integration`'dan `--concurrency=1` kaldırılmış olsaydı (kaldırılmamıştı, o da commit'sizdi) kapı sessizce §D80-öncesi davranışa döner. Bu pencere kod yazmadı — §D80'in teslimini **olduğu gibi doğrulayıp** kapattı. **Doğrulama (bu turda çalıştırıldı, hepsi exit 0):** kabul kriteri birebir — **iki eşzamanlı** `npx turbo run test --filter=@nexa/api --concurrency=1 --force` (turbo önbelleği zorla atlandı, yoksa koşu replay olur ve hiçbir şey kanıtlamaz) → **A: 2278/2278 · B: 2278/2278**, ikisi de yeşil; koşu sırasında ayrı veri depoları canlı gözlendi (`nexa_test_348f98feb624`/db1 · `nexa_test_b1ed2cfbd9e7`/db2, her biri kendi kira anahtarıyla), koşu sonrası artık **0 veritabanı · 0 kira anahtarı**. §D80'in kaydettiği "tm 107'nin bilinen tarih kusuru" artık YOK (tm 107 `done`, `bac4584`) — bu yüzden §D80'in kırmızılı sonucunun aksine bu tur **tam yeşil**. Ayrıca `pnpm -w test:integration --force` (kök script'ten `--concurrency=1` kalkmış haliyle) turbo'yu `@nexa/api` + `@nexa/rtm`'i **paralel** koşturdu ve ikisi ayrı depo aldı (rtm→`nexa_test_9fc1f07cb958`/db1, api→`nexa_test_8d920ac1d072`/db2) → api **1741/1741** · rtm **51/51**; `pnpm -w test --force` **exit 0** (10/10 turbo task, replay yok: api 2278 · web 896 · ai-mock 136 · rtm 90 · types 86 · widget 59) · typecheck 11/11 · lint 8/8 (`eslint src scripts` yeni dizini kapsıyor) · build 7/7. **e2e koşulmadı, bilerek:** `apps/e2e` bu mekanizmanın belgelenmiş istisnasıdır ve bu turda `apps/e2e` altında hiçbir dosya değişmedi. **Ders (§D80'in kendisinden bağımsız):** kirli çalışma alanı yalnız "bir sonraki taramada bulgu" değil — başka pencerelerin commit'lerine **seçici olarak sızarak** dokümanı koddan ayırır ve depoyu, hiçbir pencerenin bilerek yazmadığı tutarsız bir duruma sokar. → §D80 (mekanizmanın kendisi) · CONVENTIONS §1.1
- v2-03 §8.5 başlığı "~63 scope" diyor, tablosu **58** sayıyor. Tablo esas alındı.
- v2-03 §1.8 tablosu **24** hata tipi listeliyor (master prompt 23 diyor). Tablo esas alındı.
- **Faz-0 özet satırı (satır 20) bayatlamıştı** (denetim 2026-07-26): "Genel durum" sütunu `51 ✅ · 3 ◐` gösteriyordu; §3.0–§3.10 gereksinim tabloları elle sayıldığında `54 ✅ · 0 ◐` çıkıyor. Sebep: üç `◐` kalemi (01.3, 02.4, 13.8) D23/D24/D26 çelişki denetimlerinde koda karşı doğrulanıp sırasıyla `◐`→`✅` çevrildi (satır işaretleri güncel), ancak özet satırı güncellenmedi — satır eklenmedi/silinmedi, `✅`+`◐` toplamı 54 sabit kaldı, yalnız 3 satır `◐`'den `✅`'e geçti. Özet gerçek sayıma göre düzeltildi (yalnız "Genel durum" sütunu; gereksinim işaretlerine dokunulmadı).

---

## E. Bitti Tanımı Takibi — Faz-0 kritik yol kesiti

- [x] Tüm testler yeşil — **1697** (817 unit + 821 integration + 59 E2E) — 2026-07-31 GL-3 sayımı
      · @nexa/types 56 · ai-mock 56 · rtm 29+42 · widget 52 · web 445 · api 179+779
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

**Faz-0 kapısı (2026-07-31 · GL-3 · tm 87):** **51 ✅ · 0 ◐ · 0 ⬜** (Must) → **✅ KAPALI**. Altı
bloklayan ◐ (01.3, 02.4, 13.8, EK-A.1, EK-A.2, EK-B.1) kapandı ve §F.1'in **10 maddesi tam sürüm**
koşuldu (kanıt HANDOFF §F.2 · §D55). _Tarihçe: kapanış öncesi damga "45 ✅ · 6 ◐ · 0 ⬜ → AÇIK" idi._

**v1 (Faz 1) kapısı (2026-07-31 · GL-4 · tm 88):** **20 ✅ · 0 ◐ · 0 ⬜** (Must) → **✅ KAPALI**. §4.4
kapanış kapısı listesi (05.1/05.3/05.5 · 06.1–06.4 · 08.5.4–.6 · 08.8.4 · 02.1.2 · 04.2 · +10.1.4)
`0 ◐/⬜`; mobil (13.7 · 13.8-push) 🔒 — **gerekçesi 2026-08-01'de düzeltildi ve kalem Faz 3'e atandı**
(§D60): kapanış anındaki gerekçe "§11.1/8, web-öncelikli" idi ama §11.1/8 masaüstü native app maddesidir;
yani kapanış **gerekçesiz bir 🔒 ile** yapılmış oldu. Sayaca girmediği için `20 ✅` sayımı ve kapanış
kararı **değişmez** (mobil `Must (v1)` değil, `Should`'tur) — düzeltilen yalnız gerekçe + faz ataması.
§F.1'in **10 maddesi tam sürüm** + **tam E2E süiti** koşuldu (kanıt HANDOFF §F.2 · §D56). _Tarihçe:
kapanış öncesi damga "denetlendi §4 — çoğu ⬜/◐ → AÇIK" idi; öne çekme + sonraki dilimler payı
doldurmuştu, tur koşulmamıştı._

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


## K. Kanıt Geçmişi (evidence log)

> Gereksinim tablolarının kanıt hücreleri buraya taşındı. **Tablo satırına kanıt YAZILMAZ** —
> her kapanış kendi maddesini ilgili `K…` bloğunun altına ekler. Gerekçe: kanıt hücrede
> birikince satır 32.000 karakteri aştı ve `grep` tek komutta pencerenin tur bütçesini yaktı.
> Blok yoksa aynı biçimde yenisini aç. Tabloda yalnız damga (`⬜`/`◐`/`✅`) + `→ K…` durur.

#### K02.4.1-.6 — 02.4.1–.6 · Details paneli (info/tags/visited pages/visit info)

Chat info/tags/assignee/ID/Started ✅ · **Visited pages + Visit info (Device/Referring/Duration/IP) ✅** — inbox `getChat` visitor'ı taşıyor (`chat-service.ts` `get`→`#latestVisitor`, agent-only/NFR-S9), UI `DetailsPanel.tsx` iki bölümü + boş durumları render eder; test: `DetailsPanel.test.tsx` (3) + `chats.test.ts` "visitor context" (4, IDOR dahil). tm 27/27.1/27.2 · §D24 (D19 kapandı)

#### K13.8 — 13.8 · Notifications (ses/masaüstü/tarayıcı/e-posta)

Ses + masaüstü/tarayıcı (Notification API) + sekme başlığı ✅ (tm 16, `notifications.ts`) · **e-posta bildirim kanalı ✅** (tm 31): karar `assignee-email.ts` `shouldEmailAssignee` + route tetik `customer.ts` (atanan ajana FileMailer) · kullanıcı bazında opt-out `notify_email` (migration `20260725110000`, Settings `SettingsPage.tsx`/`auth-store.ts`, `agents.ts`/`auth.ts`) · KK 08.2 karşılandı · test: `assignee-email.test.ts` (5) + `notifications.test.ts` integration (5, opt-out/idempotent/cross-tenant dahil) — **mobil push 🔒 → Faz 3** (2026-08-01 · §D60; eski damga "🔒 v1 (§11.1/8)" idi — §11.1/8 masaüstü native app maddesi, yanlış atıf) → FR-MOD-13.7 · §6.1 · tm 90. MVP `Must` payı (ses/masaüstü/tarayıcı/e-posta) tam teslim, mobil push `Should` kanadıdır → sayacı etkilemez · §D20/§D26/§D60

#### K06.2.4 — 06.2.4 · Ordered steps (6 adım tipi; reorder + klavye alternatifi)

✅ drag + klavye (↑↓) reorder — ikisi de tek `moveStep` yolundan + aria-live duyuru; zorunlu-parametre kapısı (transfer hedefi boşsa Save engeli + `role="alert"` satır hatası) — `SkillEditor.tsx` (draggable liste + ↑↓ + `canSave = issues.length===0`) · saf `step-reorder.ts` (`moveStep`/`describeMove`/`stepIssues`) · test `step-reorder.test.ts` (10) + `SkillEditor.test.tsx` (5) · tm 33.2 · §D53

#### K06.3.1 — 06.3.1 · Knowledge alt sekmeler (All/Websites/Files/Articles/FAQ)

✅ 5 alt sekme (All/Websites/Files/Articles/FAQ) `role="tablist"` — `PlaybookPage.tsx` `KnowledgePanel` (`['all', ...KNOWLEDGE_TYPES]` + sekme sayaçları + tür bazlı süzme + sekme başına boş durum) · saf partition `knowledge-tabs.ts` `filterSourcesByTab`/`countSourcesByTab` (All = Websites ∪ Files ∪ Articles ∪ FAQ) · şema `@nexa/types` `KNOWLEDGE_SOURCE_TYPES` (§8 knowledge_sources) · test `knowledge-tabs.test.ts` (4) · tm 33.3 · §D28

#### K06.3.2 — 06.3.2 · + New source (chunk+embedding)

✅ geçersiz URL/tür reddi + website crawl/parse + RAG indeksleme — `routes/playbook.ts` `POST /knowledge-sources` (`type` enum website/file/article/faq; website → `assertPublicHttpUrl` SSRF-guard → `crawl` → `knowledge.index` aynı tx) · `services/ai/web-crawler.ts` (deterministik mock fetcher + `htmlToText`) · `lib/ssrf.ts` · test `ssrf.test.ts` (15: 169.254.169.254/localhost/private/`file://` reddi + DNS-rebinding) + `web-crawler.test.ts` (6) + integration `knowledge-crawl.test.ts` (11: SSRF negatifler → 400 & kaynak-yok · public crawl → ready + chunks · cross-tenant) · tm 33.4 · §D53. **bulk/CSV** bilinçli kapsam dışı → §5.1 `06.3.2-bulk` (Should, v2) **KAPSAM SINIRI (2026-08-01 · §D67):** bu `✅` yalnız **tek kaynak** yolunu kapsar. PRD KK'sının _"bulk/CSV import (Nexa)"_ kanadı **bilinçli olarak v2'ye ayrıldı** — v1'in tek kasıtlı v2 payı (üst tablo satır 21). Karşılığı: PLAN §5.0 `06.3.2-bulk` (`⬜`) · §5.2.13 (8 atomik alt-görev) · **tm 97**. Bu satırın `✅`'i o işi kapsamaz; ikisi ayrı kapsamdır.

#### K06.5 — 06.5 · Performance (resolution rate, CSAT, transfer)

✅ KPI kartları (Resolution rate/AI chats resolved/CSAT/Transferred) — Playbook Performance sekmesi `AiPerformance.tsx` (`PlaybookPage.tsx` `VIEW_TABS[performance]` → `view==='performance'`) + saf `performance.ts` `performanceKpis`/`isLowBase` (düşük-baz eşiği 20 → `tone='warn'`+hint+dipnot; CSAT bazı bağımsız) · AI-off arşiv ayrımı (`!agentActive` → `role=status` "historical figures") · sayılar `/reports/ai-agent`+`/reports/overview` (07.4 ile ortak sorgu = fatura ADR-09, ikinci sayaç yok) · test `AiPerformance.test.tsx`(5)+`performance.test.ts`(8) · tm 33.6 · §D36

#### K02.1.2 — 02.1.2 · AI Agents grubu (AI agent / Solved)

✅ AI Agents grubu (KK "AI konuşmalarını insan kuyruğundan ayırır; Solved → AI resolution sayacı") — sidebar grubu `InboxPage.tsx` `AI_VIEWS` (AI agent ✦ / Solved ✓) + canlı sayaçlar `useInbox.ts` `useViewCounts` (`ai`/`ai_solved`) + tür-bazlı boş durumlar · backend süzgeç `chat-service.ts` `viewFilter`: **ai** = aktif + bot-event VAR & agent-event YOK (bekleyen/queued/unassigned'dan ayırır) · **ai_solved** = kapalı & agent-event YOK = ADR-09'un birebir predicate'i (`reports.ts` `AGENT_EVENT`/`automated` ile aynı satır → Solved listesi = `ai_resolutions` sayacı, çelişmez) · tip `types.ts` `InboxView` + rota enum `routes/chats.ts` · test integration `chats.test.ts` "AI Agents group" (3: insan kuyruğundan ayrım · agent yanıtı grubu düşürür · Solved = ADR-09 `ai_resolutions` sayacı birebir) · tm 37 · §D48

#### K02.1.4 — 02.1.4 · Views grubu (WhatsApp/Messenger/Twilio görünümleri)

✅ Inbox **Views** grubu (`InboxPage.tsx`) — kanal bağlı değilse **channel-promo** (dashed CTA → Settings→Channels), bağlıysa kanal satırları (Messenger/WhatsApp/SMS, "Connected" → Settings); **custom saved views** (base view + real-time tab, `localStorage`, ekle/sil, reload'da kalıcı, boş ad reddi). Kanal durumu owner/admin `channels--all` kapılı (`canReadChannels`) — ajan `/channels` çağırmaz (403 önlenir), yalnız kendi saved view'lerini görür. Saf `views.ts` (`showChannelPromo`/`connectedChannelViews`/`canReadChannels`/`addSavedView`/`removeSavedView`/`useSavedViews`) + `useConnectedChannels` (`useInbox.ts`, scope-gated) · test `views.test.ts` (19: kanal yok→promo · bağlıysa liste+sıra · saved view ekle/sil/round-trip/reload/boş-ad reddi) · tm 38 · §D42. Not: kanal→chat filtresi (per-kanal) `ChatSummary`'de kanal etiketi ister (backend, ayrı task); bu dilim promo+saved views KK'sını tam karşılar.

#### K02.3.2 — 02.3.2 · Reply Suggestions çipleri

✅ Reply Suggestions — composer'da **Space** (boş reply alanında, mode='all') → bağlama göre şekillenen AI çip satırı (`role="group"`); **çip → composer'a düzenlenebilir metin** (`setText`, caret sonda, mode='all'), müşteri yanıtı olarak (asla internal note değil, Copilot draft ile aynı el-verme). Öneriler cache'teki transcript'ten **anlık** türer (fetch/round-trip yok, PRD §108 katman-3 hafif mikro-özellik) — son müşteri mesajına göre lead (selam/soru/iade/teşekkür) + her zaman 2 güvenli bekletme yanıtı, dedupe, ≤4; boş konuşmada bile çip döner. Space **yalnız boşken** tetikler (cümle ortasında değil, v2-01 §307), **Escape** geri alır (§276), yazınca çipler çekilir, internal-note moduna geçince kapanır. Deterministik saf `replySuggestions.ts` (ai-mock felsefesi; gerçek sağlayıcı = tek fonksiyon değişimi) + `Composer.tsx` · placeholder "…press Space for suggestions" · test `replySuggestions.test.ts` (7) + `Composer.suggestions.test.tsx` (5: KK çip→düzenlenebilir · her zaman çip · dolu alanda tetiklenmez · Escape · note'ta yok) · tm 39

#### K02.5 — 02.5 · Copilot özeti → internal note

✅ (12.3-a ile kapandı) `POST /copilot/chats/:id/summary` → özet **internal note** (recipients=agents, `chats.sendEvent` RTM fan-out, arşivde görünür); archived chat → 409 · `copilot.ts`/`copilot-service.ts` · test `copilot.test.ts` (summary→note + archived 409) · tm 36 · §D40

#### K02.7 — 02.7 · Tickets grid (sıralanabilir, deep-link)

✅ Sıralanabilir grid (KK "Satır → ticket konuşması; URL param sıralama") — VirtualTable (T6-a) tablo: Subject/Customer/Status/Priority/Assignee/Last message, tıklanır `aria-sort` başlıklar; **satır → ticket konuşması** (grid-first: hiçbir şey oto-seçili değil → satıra tıkla → detay pane + `← Tickets` geri); **URL param sıralama** `ticket_sort`/`ticket_order` (paylaşılabilir + reload'da kalıcı deep-link; `?ticket_sort=…` linki grid'i açar, chat view'e geçince temizlenir). Client-side sort = yüklü sayfa (keyset newest-first backend değişmedi; ADR yok); nulls-last (her iki yön) + stabil id-desc tiebreak = server sırasıyla uyumlu. Saf `ticket-grid.ts` (`sortTickets`/`parse`/`write`/`clear`/`toggleTicketSort`/`ariaSortFor`) + `TicketGrid.tsx` → `InboxPage.tsx` (deep-link effect + grid-first render). Test `ticket-grid.test.ts`(12)+`TicketGrid.test.tsx`(6)+e2e `tickets.spec.ts` (deep-link: header→URL, `?ticket_sort` reload→aria-sort, satır→konuşma) · tm 40

#### K02.9 — 02.9 · Live typing preview

✅ çift yönlü — ajan→ziyaretçi (`Composer.tsx` → `send_typing_indicator` → RTM `dispatcher.ts` #typing (chat yetki denetimli) → `TypingService.setAgentTyping` Redis TTL → Customer poll `/customer/chat` `agent_typing` → widget `renderTyping`) + ziyaretçi→ajan sneak-peek (widget `notifyTyping` → `POST /customer/chat/typing` → `chat-service.ts` `publishCustomerTyping` → `incoming_typing_indicator`/`incoming_sneak_peek` (yalnız ajanlara) → `useInbox.ts` → `TypingIndicator.tsx` önizleme) · şema `@nexa/types` `typingStateKey`/`SNEAK_PEEK_MAX_LENGTH` · test `typing.test.ts`(5)+`TypingIndicator.test.tsx`(4)+rtm `typing.test.ts`(6)+integration `customer-chat.test.ts` · OpenAPI `/customer/chat/typing` · tm 41 · §D30

#### K03.1.3 — 03.1.3 · Ziyaretçi tablosu + satır aksiyonları

✅ Live-visitor board — tablo Visitor/Activity/**Chatting with**/Actions; "Chatting with" insan kazanır > AI persona (ör. "Hazal", widget FR-11.3 ile aynı çözümleme) · salt-okur API `GET /traffic` (`routes/traffic.ts` scope customers:ro\|:rw → `traffic-service.ts` `listLive`; OpenAPI `paths/traffic.yaml`, contract-parity ✅) · web `TrafficPage.tsx` + saf `rowActions.ts` `visitorRowActions` (Start chat/Supervise/Assign to me/Edit, durum×yetki) · rota `/app/customers/real-time` · test integration `traffic.test.ts`(9)+unit `rowActions.test.ts`(8)+e2e `traffic.spec.ts` · tm 42 · §D32

#### K03.3.1-.3 — 03.3.1–.3 · Campaigns (alt sekmeler, builder, kart)

✅ Campaigns modülü (Customers üçüncü sekmesi, `/app/customers/campaigns`) — **03.3.1 alt sekmeler**: All/Ongoing/Scheduled/Inactive durum filtresi (KK "durum bazlı filtre"), saf `campaigns.ts` (`filterCampaigns`/`campaignCounts`/`CAMPAIGN_TABS`); durum = depolanan lifecycle (`campaigns_status_check` sözlüğü ongoing/scheduled/inactive) · **03.3.2 builder** (KK "tetikleyici+mesaj zorunlu; kayıt sonrası eşleşen ziyaretçiye otomatik gönderim"): koşul(`url_contains`)+mesaj zorunlu → kayıtta `#fireIfRunning` canlı ziyaretçileri (son 30 dk `visits`) saf `matchesConditions` ile süzer, eşleşene `campaign_sends` yazar (visitor başına 1, `skipDuplicates` idempotent); **cross-tenant**: sorgu `licenseId`+org kapılı + RLS → A kampanyası B ziyaretçisine ASLA göndermez · **03.3.3 kart** (KK "düzenleme+performans Displayed/Chats/Conversion"): edit + on/off toggle (`active`→status yeniden hesaplanır, ongoing ise fire) + performans `campaign_sends`'ten sayılır (displayed=gönderim, chats=engaged, conversion=converted; asla kampanyada cache'lenmez). Scope `customers:ro/:rw` (traffic deseni; owner/admin yönetir, ajan salt-okur). Migration `20260726170000_campaign_sends` (+RLS `campaign_sends_tenant`, drift ✅). `@nexa/types` Campaign DTO. OpenAPI `/campaigns`+`/campaigns/{id}` (contract-parity ✅). test integration `campaigns.test.ts`(13: match→send·no-match→gönderilmez·cross-tenant·scheduled fire yok·durum filtre·activate idempotent·strip-trigger 400·404·perf·scope split) + unit `campaign-matching.test.ts`(12) + web `campaigns.test.ts`(9)+`CampaignsPage.test.tsx`(4) + e2e `campaigns.spec.ts` · tm 43

#### K04.2 — 04.2 · AI Agents (team tarafı) — performance

✅ Team-tarafı AI Agents girişi (KK "Per-agent performance; Copilot knowledge yönetimi") — **performance**: 06.5 `AiPerformance` kartları reuse (reports=fatura ADR-09, düşük-baz + AI-off dürüstlüğü, `reports_read` kapısı) + AI-agent roster (name/status/skills; `kind:'ai_agent'` süzülür → Copilot roster'a girmez; her satır → Playbook) `TeamAiPerformance.tsx` · **Copilot knowledge yönetimi**: `/copilot/knowledge` (12.2-a) list/add/delete; müşteriye kapalı; bot `:ro` oku / `:rw` düzenle yetki kapısı `CopilotKnowledge.tsx` · `TeamPage.tsx`'e iki bölüm (AI kümesi) · test `TeamAiPerformance.test.tsx`(5)+`CopilotKnowledge.test.tsx`(5) · tm 58 · §D41

#### K04.6 — 04.6 · Chatbots / Suspended agents sekmeleri

✅ bot hesabı ücretsiz + suspend/unsuspend (KK birebir) — API `agents.ts` GET `/agents?status=active\|suspended\|all` (+`suspended` bayrağı, default `active`) + PUT `/agents/:id/suspension` (owner/admin çift kapı; owner askıya alınamaz; kendini/üst-rütbeyi askıya alma yok; cross-tenant 404; idempotent no-op; audit `member.suspended`/`unsuspended`) · askı membership'te → mevcut oturumlar sıradaki istekte ölür + routing o andan atamayı durdurur · web `TeamPage.tsx` **Chatbots** (`/ai-agents`, "Free — bots never use a seat") + **Suspended** (reinstate) + satır-içi Suspend · bot=ai_agent, koltuk tutmaz → askı koltuğu boşaltır/geri alır · OpenAPI `/agents/{agentId}/suspension` (contract-parity ✅) · test integration `agents-suspension.test.ts` (listing/sessions/routing/authz/billing) · tm 59 · §D37

#### K07.7 — 07.7 · Rapor grupları + Export (CSV)

✅ izin bazlı görünürlük + CSV export (benchmark/PDF v2) — katalog+CSV `reports-export.ts` (`REPORT_GROUPS`/`visibleReportGroups` boş-liste-değil-403 · `toCsv` RFC4180 + formül-enjeksiyon kalkanı · `exportFilename` UTC pencere) · rota `reports.ts` `GET /reports/groups` (yetki süzgeci) + `GET /reports/export` (EXPORT_SCOPES route-gate + grup-bazlı yeniden denetim · text/csv attachment + nosniff/no-store) · web rapor grupları = `ReportsPage.tsx` tabs (overview/ai-agent/reviews/breakdown) · OpenAPI `/reports/groups`+`/reports/export` (contract-parity ✅) · test unit `reports-export.test.ts`(11) + integration `reports-billing.test.ts` "report groups + CSV export (07.7)"(11) · tm 46 · §D35

#### K08.6.2 — 08.6.2 · Ticket rules (atama/etiket/öncelik)

✅ koşul+eylem motoru — `ticket_rules`+`ticket_tags` (RLS, migration `20260726180000`) · saf eşleşme `ticket-rule-matching.ts` (hasCondition/hasAction/matchesTicketRule) · uygulama `apply-ticket-rules.ts` (ticket create + createFromEmail kancası; atama/öncelik/etiket, position sırası, geçersiz hedefi atlar) · CRUD `ticket-rule-service.ts` + rota `/settings/ticket-rules` (`tickets--all:rw`/`:ro`) · web Settings "Ticket rules" formu (form-primitif, öncelik/etiket) · OpenAPI `TicketRule*`+ 4 yol (contract-parity ✅) · unit `ticket-rule-matching.test.ts`(7) + integration `ticket-rules.test.ts`(12: kural→otomatik atama · koşul/eylem zorunlu · cross-tenant) · tm 47 · §D43

#### K08.7.4 — 08.7.4 · Chat transcripts (e-posta)

✅ bitişte transcript e-postası (müşteri + ekip) — paylaşımlı kapanış yolu: `chat-service.ts` `#emailTranscript` hem `deactivate` (ajan arşivi) hem `deactivateByTimeout` (idle sweep) sonrası tx-dışı best-effort, RLS-scoped · saf `notifications/chat-transcript.ts` (`transcriptRecipients`: adres/atama/opt-out süzgeci · `renderTranscript`: müşteri kopyasından internal note [`recipients=agents`] süzülür, saf sistem-olayı sohbeti mail atmaz) · mailer `chats.ts`+`server.ts` rotasına ve `chat-timeout-run.ts` sweeper'ına bağlı (FileMailer A4 → `.data/mail`) · yeni API yolu yok (contract-parity ✅ değişmedi) · unit `services/notifications/chat-transcript.test.ts`(9) + integration `test/integration/chat-transcript.test.ts`(6: iki kapanış yolu · internal-note müşteriye gitmez · adres/atama/opt-out süzgeci · cross-tenant) · tm 49 · §D44

#### K08.7.5 — 08.7.5 · Ticket email templates

✅ markalı/değişkenli ticket e-posta şablonu — kayıtta geçersiz değişken/format engeli (KK birebir): paylaşımlı katalog+doğrulayıcı+renderer `template-variables.ts` (`TEMPLATE_VARIABLES` · `findTemplateProblems`/`findTemplateProblemsIn` · `renderTemplate`) → form (web) + endpoint (api) aynı tanımla "geçerli" der · servis `ticket-email-template-service.ts` (`assertPlaceholdersValid` create+edit; license-scoped CRUD) + rota `/settings/ticket-email-templates` (`tickets--all:rw`/`:ro`) · `ticket_email_templates` (RLS, migration `20260726190000`) · web Settings "Ticket email templates" formu (canlı alan-altı hata + Submit valid olana dek kapalı + optimistik toggle) · OpenAPI `TicketEmailTemplate`+2 yol (contract-parity ✅) · unit `template-variables.test.ts`(15) + web `SettingsForms.test.tsx`(+2) + integration `ticket-email-templates.test.ts`(10) · tm 50 · §D45

#### K08.7.6 — 08.7.6 · Custom fields

✅ tip/zorunluluk + Details/CRM'de görünür — `custom_field_definitions` (entity/type/required · unique(license,entity,label)) + `custom_field_values` (bir-varlık CHECK · RLS · definition/ticket/customer cascade) migration `20260726200000` · paylaşımlı tip-kataloğu+doğrulayıcı `@nexa/types/custom-fields.ts` `checkCustomFieldValue` (type+required; form ve endpoint aynı tanım) · servis `custom-field-service.ts` (tanım CRUD + `setValues` + `readCustomFieldValues`) · tanım rotası `/settings/custom-fields` (`access_rules:ro/rw`) + değer yazma `PUT /tickets/:id/custom-fields` (`tickets--*:rw`) & `PUT /customers/:id/custom-fields` (`customers:rw`) · `custom_fields` ticket detail (Details) + customer detail (CRM) yanıtına gömülü · web Settings "Custom fields" formu + paylaşımlı `<CustomFields>` TicketPane(Details)+CustomerDetailPanel(CRM) · OpenAPI `CustomFieldDefinition`/`CustomFieldValue`/`CustomFieldValuesInput` + 6 yol (contract-parity ✅) · unit `custom-fields.test.ts`(9) + web `CustomFields.test.tsx`(6)/`SettingsForms.test.tsx`(+2) + integration `custom-fields.test.ts`(13: yaz→Details/CRM oku · tip/zorunluluk · cascade · scope · cross-tenant) · tm 51 · §D46

#### K08.7.7 — 08.7.7 · Forms builder (pre/post-chat)

✅ pre-chat form builder — alan(label/tip/required) → widget'ta gösterim → contact'a yazma (KK birebir): pre-chat alanı = `form_placement='pre_chat'` işaretli **contact** custom-field'ı (tm 51 makinesini yeniden kullanır) → yanıt tipine göre doğrulanır (`checkCustomFieldValue`) + CRM'de görünür, ayrı depo yok · migration `20260726210000` `form_placement` kolonu + CHECK (`pre_chat` yalnız `entity='contact'`; drift temiz) · `@nexa/types` `FORM_PLACEMENTS`/`PreChatFormField` + `CustomFieldDefinition.form_placement` · servis `custom-field-service.ts` (`listPreChatForm` + create/update `formPlacement`) · token mint `/customer/token` yanıtına `pre_chat_form` (best-effort, appearance emsali) · `/customer/chat/events` gövdesine `custom_fields` → ilk mesajla `setValues('contact')` (geçersiz tip/zorunlu-boş → 400, sohbet açılmadan) · web Settings "Pre-chat form" builder (`PreChatFormSettings`) · widget pre-chat formuna dinamik alanlar (`renderPreChatFields`; yanıtlar ilk mesajla gider; alan yoksa sabit 11.2 formu değişmez) · yeni API yolu yok (contract-parity 5/5) · widget `widget.prechat.test.ts`(4) + web `SettingsForms.test.tsx`(+2) + integration `customer-chat.test.ts`(+4) · **pre-chat teslim; post-chat placement modellenebilir ama widget render'ı ertelendi** · tm 52 · §D47

#### K08.8.1 — 08.8.1 · Apps (marketplace) girişi

✅ Settings→Integrations girişi (KK "Üçüncü parti dizin (detay MOD-09)") — Apps rotası (`/app/apps`, MOD-09.1 grid) modül-rayında yok; tek giriş yolu buydu. Settings'e Channels'ın hemen altına **Integrations** bölümü + "Open marketplace" linki (`SettingsPage.tsx` `Integrations` export, `react-router` `Link` → `/app/apps`) · test `Integrations.test.tsx`(1: link href → `/app/apps`) · web unit 444→445 · additive (yeni Section/region "Integrations"; mevcut region adları + e2e seçicileri değişmez; API/OpenAPI/migration yüzeyi yok → contract-parity 5/5 & api integration etkilenmez) · tm 53.3 · §D51

#### K09.1 — 09.1 · Entegrasyon kartları gridi

✅ entegrasyon kartları gridi + OAuth akışı (MOCK) — KK birebir _"kart → izin/OAuth akışı; bağlanınca veri sohbet içinde"_: statik katalog `@nexa/types/apps.ts` `APP_CATALOG` (grid+servis+test tek kaynak) + deterministik `appChatData` in-chat stub · servis `services/apps/app-service.ts` mock OAuth (HMAC-imzalı `state` = CSRF-bağlı, 10dk TTL, constant-time verify; idempotent upsert; cross-tenant chat → 404) + `app_installations` (RLS, license-scoped, migration `20260727090000`; drift temiz) · rota `/settings/apps` GET (`access_rules:ro/rw`) + OAuth start/callback + DELETE (`access_rules:rw`) + `GET /chats/:id/apps` (agent `chats--all:ro`/`chats--access:ro`) — admin connect'i, agent in-chat okumayı gate'ler · web `features/apps/AppsMarketplace.tsx` grid (connect/disconnect) + `/app/apps` rota + DetailsPanel "Apps" bölümü (bağlı-app verisi; boşsa "No connected apps") · OpenAPI `paths/apps.yaml` (5 yol) + `App*` şema, yeniden bundle+client (contract-parity 5/5) · unit `@nexa/types apps.test.ts`(4) + web `AppsMarketplace.test.tsx`(3) + integration `apps.test.ts`(7: mock OAuth→kurulu · in-chat veri · disconnect+404 · tampered/mismatch state reddi · yok→404 · ro-admin list-var connect-yok · cross-tenant izole) · tm 53.1 · §D49

#### K09.2 — 09.2 · Entegrasyon listesi (15–20)

✅ tam entegrasyon dizini (20 kart) — KK birebir _"her biri OAuth/API key; kanal-tipli olanlar Channels'ta da yönetilir"_: katalog `@nexa/types/apps.ts` `APP_CATALOG` 09.1'in 5 kartını 20'ye büyüttü — 10 veri app'i (OAuth+API-key karışık: Salesforce/Intercom/Zendesk/WooCommerce/Magento/PayPal/Klaviyo/Slack/Jira/Segment) + 5 kanal-tipli kart (WhatsApp/Messenger/Instagram/Telegram/SMS-Twilio, `channel` set) · yeni `channel?: ChannelType` alanı + `dataLabel`/`dataFields` opsiyonel (kanal app'i in-chat veri taşımaz) + `isChannelApp`/`channelApps`/`connectableApps` bölücüleri + `AppListItem.channel` · servis `app-service.ts` `requireConnectableApp` kapısı: kanal app'inin marketplace OAuth-start/callback/disconnect'ini 400 ile reddeder (bir kanalın durumunu tek yüzey Settings→Channels yönetir) + `chatData` yalnız veri app'lerini yüzeye çıkarır · web `AppsMarketplace.tsx` `ChannelAppCard` = "In Channels" rozeti + "Manage in Channels" linki (`/app/settings#section-channels`), Connect yok · OpenAPI `AppListItem` kategori enum (+support/analytics/channels) + `channel` alanı (CHANNEL_TYPES ile birebir) → client yeniden üretildi (contract-parity 5/5) · unit `@nexa/types apps.test.ts`(+2: 15–20 kart & iki provider · kanal-çapraz partition) + web `AppsMarketplace.test.tsx`(+1: kanal kartı Channels'a linkler) + integration `apps.test.ts`(8, +1: tam liste 15–20 · kanal app channel/category · OAuth+disconnect 400) · tm 53.2 · §D50

#### K10.1.4 — 10.1.4 · AI resolutions meter + stepper

✅ sayaç `N / limit (% used)` + %80 proaktif uyarı (aşımdan önce) + aşım paketi fiyatı önden — `BillingPage.tsx` (`ai-counter`/`quota-percent`/`quota-warning`/`overage-package`/`overage-charge`; figürler `/billing/usage` = fatura ADR-09) · test `BillingPage.test.tsx` (12: 6% sayaç · %80 uyarı · pack $0.50/$25.00 · 105% aşım) · tm 54 · §D53

#### K11.7 — 11.7 · Widget customization (Appearance/Position/Mobile)

✅ tema/renk/konum + mobil tam ekran + canlı önizleme + WCAG — license-singleton `widget_settings` (RLS+CHECK) · GET/PUT `/settings/widget` (`routes/settings.ts`, Zod+audit+upsert) · widget `applyAppearance` (`--nx-brand`/`data-nx-theme`/`.nx-left`/`.nx-mobile-full`+`@media(max-width:480px)`, mount + token'dan) · web `WidgetCustomization.tsx` **canlı preview** · çok dilli = I18N1/2 tr/en (tm 26) `data-language`→locale fallback (PRD "45+ dil" hedef, KK "çok dilli") · test `widget.appearance.test.ts`(9)/`loader.appearance.test.ts`(5)/`WidgetCustomization.test.tsx`(5)+integration `settings.test.ts` · OpenAPI `/settings/widget` · tm 57 · §D33

#### K11.8 — 11.8 · Typing indicator (sneak-peek)

✅ ziyaretçi→ajan sneak-peek (11.8 KK) — widget `notifyTyping` → `POST /customer/chat/typing` (`SNEAK_PEEK_MAX_LENGTH`) → `chat-service.ts` `publishCustomerTyping` → `incoming_sneak_peek` **yalnız ajanlara** → `useInbox.ts` → `TypingIndicator.tsx` önizleme metni · aynı tm 41 bundle'ı (`+11.8`, 02.9 satırı ile ortak kod) · test integration `customer-chat.test.ts` (sneak-peek yalnız-ajana fan-out, metin doğrulanır) + web `typing.test.ts`(5)/`TypingIndicator.test.tsx`(4) + rtm `typing.test.ts`(6) · OpenAPI `/customer/chat/typing` · tm 41 · §D31

#### K12.1-12.3 — 12.1–12.3 · Copilot (buton, ayrı KB, özet + yanıt yardımı)

✅ **Copilot agent-assist (3 alt-görev, tm 36)** — **12.2-a ayrı KB:** `kind:'copilot'` AiAgent'a bağlı ayrı bilgi tabanı, AI-agent KB'sinden çift yönlü izole (`/knowledge-sources` `ai_agent`'a, `/copilot/knowledge` copilot ajanına süzülür → birbirini göstermez), **müşteri token'ı → 404** (agent+bot default principals, boundary=404), cross-tenant izole; `GET/POST/DELETE /copilot/knowledge` (`copilot.ts`→`copilot-service.ts` `ensureAgent`/`createSource`/`deleteSource`, SSRF-guard'lı website crawl + eşzamanlı indeks). **12.1-a buton+panel:** transcript header'da Copilot butonu → sağ panel Copilot sekmesi (`CopilotPanel.tsx`; `InboxPage` `panelTab` details↔copilot, chat değişince reset) → **Assisted metriğini besler** — her assist bir `skill_run` yazar = 07.3.2 reports "assisted" sorgusunun tam anahtarı (`recordAssist` copilot `workspace`-kind skill; kapalı chat + agent-event + skill_run ⇒ assisted). **12.3-a özet+yanıt+enhance (+02.5):** özet→internal note (`chats.sendEvent` recipients=agents); yanıt taslağı copilot KB'den RAG (son müşteri mesajı sorgu; eşleşme yoksa boş, uydurmaz) → `copilotDraft` store ile composer'a (`Composer` reply moduna geçer); enhance rephrase/friendly/formal/grammar (`@nexa/ai-mock` `enhanceText`/`summariseConversation` deterministik stub). OpenAPI 5 yol (`paths/copilot.yaml`, contract-parity ✅). `/skills`+`/knowledge-sources` `ai_agent`'a filtrelendi (copilot skill/source sızmaz). Test: integration `copilot.test.ts`(15: KB izolasyon negatifleri + summary→note + reply RAG + enhance + assisted-alignment 07.3.2) · unit `assist.test.ts`(14) · web `CopilotPanel.test.tsx`(7)/`copilotDraft.test.ts`(3)/`Composer.copilot.test.tsx`(2) · e2e `copilot.spec.ts`(1) · tm 36 · §D40

#### K13.1 — 13.1 · Home dashboard

✅ aktivasyon checklist (5 adım, gerçek state'ten türetilir: website/teammate/customize/canned/AI-agent) + canlı gerçek-zaman kartları (visitors_online = açık chat ∪ 30dk ziyaret UNION, ongoing_chats, agents_online = accepting_chats) + haftalık performans (bu hafta vs geçen: new chats/resolved/CSAT WoW delta) — `GET /home` (`reports_read`) `routes/home.ts` → `services/home/home-service.ts` (RLS + defansif license filtresi; weekly chats/resolved = Reports overview chats/closed ile aynı created-in-window taban, ADR-09 automated split'e dokunmaz) · şema `@nexa/types` `HomeDashboard` · OpenAPI `/home` (contract-parity ✅) · web `HomePage.tsx` + saf `dashboard.ts` kart view-model'leri · rota `/app/home` + nav "Home" (`nav.home` tr/en) · test unit `dashboard.test.ts`(8)+`HomePage.test.tsx`(4) [kartlar] + integration `home.test.ts`(13) [canlı sayaç + tenant isolation + scope] · tm 60 · §D34

#### K13.6 — 13.6 · Omnichannel Ticketing / HelpDesk katmanı

✅ **HelpDesk katmanı — backend ✅ (tm 61.1) + frontend ✅ (tm 61.2)** — chat↔ticket köprüsü (`source_chat` detail; Dilim 11 create-from-chat) + ticket yaşam döngüsü (status geçişleri artık `ticket.status_changed` audit'li) + **merge/unmerge** (non-destructive pointer `merged_into_id`; invariant: self-merge/zincir/primary-with-children/already-merged reddi + cross-tenant→404; unmerge = tam ters; merged ticket listeden gizli, primary'de `merged_ticket_ids`) + **followers** (add/remove idempotent, üyelik doğrulaması) + **priority** (int, PATCH) — hepsi audit'li (`ticket.merged`/`unmerged`/`follower_added`/`follower_removed`/`priority_changed`/`status_changed`). `routes/tickets.ts` (POST/DELETE `/tickets/:id/merge`, POST `/tickets/:id/followers`, DELETE `/tickets/:id/followers/:accountId`, priority via PATCH) → `ticket-service.ts`; migration `20260726160000_ticket_helpdesk` (`priority`, `merged_into_id` self-FK + no-self-merge CHECK, `ticket_followers` RLS=thread_tags deseni + GRANT); OpenAPI 3 yol + Ticket/TicketDetail alanları (contract-parity ✅); `@nexa/types` `TICKET_PRIORITY_*`. KK doğrulaması "integration (merge/unmerge invariant + audit)" birebir: `tickets-helpdesk.test.ts` (15). **Frontend HelpDesk yüzeyi ✅ (tm 61.2)** — `TicketDetailPane`'de priority seçici (4 seviyeli ölçek; `ticket-priority.ts` keyfi int'i en yakın seviyeye snap'ler) + followers (agent picker'dan ekle / satırdan çıkar) + merge (aday ticket listesinden birleştir) + unmerge (folded child'ı primary'nin panelinden veya child'ın merged-banner'ından geri al); merged ticket read-only (subject/status/priority disabled + banner); liste satırında priority pill. `useTickets.ts` HelpDesk hook'ları (merge/unmerge/addFollower/removeFollower/agents; id mutate-time'da) + `TicketDetail`/`TicketFollower` tipleri. `TicketPane.tsx` · `useTickets.ts` · `ticket-priority.ts` · `types.ts`; test `TicketPane.test.tsx` (8: priority PATCH · follower add/remove · merge · child+primary unmerge · list pill) + `ticket-priority.test.ts` (6) + e2e `tickets.spec.ts` (1, priority+follower canlı stack). NOT (`◐` değil): liste satırında **merged-child sayaç rozeti** liste özet payload'una `merged_ticket_ids`/`merged_count` alanı eklemeyi (backend+contract) gerektirir → frontend-scope dışı, ertelendi; merge/unmerge UI'dan tam çalışıyor (child'lar primary panelinde), KK'nın parçası değil. · §D38·§D39

#### K13.7 — 13.7 · Mobil uygulamalar

🔒 → **Faz 3 (Enterprise)** — v1 kapanışını bloklamadı, ama gerekçesi bu turda **düzeltildi**: eski metin "PRD §11.1/8 ile hizalı" diyordu; §11.1/8 **masaüstü** native uygulama hakkındadır, mobil hakkında değil (yanlış atıf → gerekçesiz 🔒 = §F.00'a göre gizlenmiş ⬜). Yeni gerekçe: native iOS/Android bu deponun stack'i (TS monorepo: Fastify+React+Vite) dışındadır; ayrı bir uygulama hattı + store süreci ister. Faz 3'e **açıkça** atandı → §6 · §6.1 · tm 90. §D60

#### K06.3.2-bulk — 06.3.2-bulk · Bulk/CSV knowledge base import

✅ **Teslim (2026-08-09):** sekiz alt-görevin tamamı kapandı (97.1–97.8), uçtan uca kanıtlandı. **Başladı (2026-08-08):** ayrıştırıcı çekirdeği teslim — RFC4180 CSV okuyucu + formül-enjeksiyon nötrleme + lineer zaman garantisi — `apps/api/src/lib/csv-import.ts` · test `apps/api/src/lib/csv-import.test.ts` (22: kapanmamış tırnak/kapanış sonrası metin/üç bütçe aşımı tipli hata · `=cmd\|' /C calc'!A0` nötrleme + beş lead varyantı + tırnak içine gizlenmiş payload · ~100k patolojik girdide lineerlik · BOM/CRLF/gömülü satır-sonu/karışık CR · boş dosya & yalnız başlık) · tm 97.1. **06.3.2-bulk-b teslim (2026-08-09):** satır şeması — başlık normalizasyonu (kırp+küçük harf+BOM temizliği) ile `name,type,content,source_url` kolon eşlemesi (sıra serbest, bilinmeyen kolon yok sayılır, hata üretmez); kolonlardan biri eksikse dosya-düzeyi tipli hata (`KnowledgeBulkHeaderError`, eksik olan HER kolonu listeler); satır → `{name,type,content?,source_url?}` eşlemesi, `type` boşsa `article` varsayılanı (`createSourceBody`'nin `.default('article')`'ıyla aynı); satır-başı zod doğrulaması `createSourceBody`'nin (`routes/playbook.ts`) `superRefine` kuralını birebir yansıtır (website→`source_url` zorunlu, diğer→`content` zorunlu, aynı uzunluk tavanları); ilk hatada durmaz, her satır için `{line, ok, value|error}` döner — `apps/api/src/services/ai/knowledge-bulk-row.ts` · test `knowledge-bulk-row.test.ts` (14: enum-dışı `type` reddi · website+boş `source_url` reddi · diğer türde boş `content` reddi · 100k karakter aşımı reddi · boş `name` reddi · eksik kolon → dosya reddi + eksiklerin TAMAMI listelenir · bilinmeyen fazladan kolon yok sayılır · blank `type`→`article` · 5 satırlık karışık dosyada 3 geçerli/2 geçersiz, sıra ve satır no korunur) · tm 97.2. **06.3.2-bulk-c teslim (2026-08-09):** `POST /knowledge-sources/bulk` — kontrat + route; iki saf modül ilk kez bir HTTP yoluna bağlandı. KONTRAT: `knowledgeSourcesBulk` bloğu + `/knowledge-sources/bulk` path'i + `KnowledgeBulkResult`/`KnowledgeBulkRowResult` şemaları, `generate` ile re-bundle + tip üretimi (`contract-parity` 5/5 iki yönlü yeşil) — `packages/contract/openapi/paths/playbook.yaml` · `openapi.yaml` · `src/generated/api.ts`. ROUTE (`apps/api/src/routes/playbook.ts`): mevcut `agents-bot--all:rw` scope'u (yeni scope YOK) · route-özel `bodyLimit` 12 MiB (`server.ts` 1 MiB varsayılanı yerinde kalır; JSON kaçışı için içerik tavanının üstünde, böylece reddi *tipli* bütçe hatası verir) · bütçe `maxRows:200`/`maxCellChars:100.000`/`maxBytes:5 MiB`, aşım TÜM isteği ADR-06 `validation` ile reddeder (kırpma yok, yeni ApiError tipi yok) · `ai_agent` sahipliği döngüden ÖNCE bir kez RLS altında doğrulanır ve dosya hedefini değiştiremez (`ai_agent_id` kolon değil gövde alanı; bilinmeyen kolon yok sayılır) · satır başına KISA tx (create + `knowledge.index()` çifti), tek uzun tx yok · kısmi başarı 200 + `{imported, failed, dry_run, results[]}` (207 yok) · `dry_run:true` hiçbir şey yazmaz, aynı `results`'ı döner (önizleme sunucudan, istemcide ikinci parser yok) · `type:'website'` satırı satır düzeyinde reddedilir, HİÇBİR dış istek yapılmaz (SSRF amplifikasyonu 97.7'ye ait) · migration YOK (mevcut `knowledge_sources`/`knowledge_chunks`). Test `apps/api/test/integration/knowledge-bulk.test.ts` (14, negatifler önce: cross-tenant ajan reddi + iki tarafta 0 satır · `ai_agent_id` kolonu yok sayılır, tüm satırlar doğrulanmış ajana bağlanır · satır/hücre/bayt tavanı aşımı → `validation`, 0 yazım · eksik kolon başlığı + kapanmamış tırnak → istek reddi · scope'suz 403, kimliksiz 401 · website satırı crawl edilmeden atlanır, kalan satırlar yazılır · 3 geçerli satır indekslenir (`chunk_count`=gerçek chunk sayısı, gömülü virgüllü tırnaklı hücre dahil) · 2 geçerli/2 geçersiz karışık dosyada satır no + neden korunur · formül-lead hücre `'` ön-ekiyle saklanır · dry-run 0 yazım + gerçek koşuyla aynı kararlar) · tm 97.3. **06.3.2-bulk-d teslim (2026-08-09):** frontend saf yardımcılar, hiçbir bileşene mount edilmeden. `bulk-template.ts` — kolon sözlüğü (`BULK_TEMPLATE_COLUMNS`, `knowledge-bulk-row.ts`'teki `KNOWLEDGE_BULK_COLUMNS` ile birebir mirror, apps/api'ye import yok — `templates.ts` deseniyle aynı bilinçli ayrım) ve sözlükten TÜRETİLEN `toTemplateCsv()` (header elle yazılmaz, dizi map'i; iki örnek satır — website/`source_url` ve content/`type` — dört kolonun karşılıklı-dışlayıcı kuralını gösterir) + indirilebilir `toTemplateBlob()`/`BULK_TEMPLATE_FILENAME`/`BULK_TEMPLATE_MIME_TYPE` — `apps/web/src/features/playbook/bulk-template.ts` · test `bulk-template.test.ts` (10: header sunucu kolon setiyle birebir aynı · satır sırası header'la eşleşir · deterministik · blob mime/dosya adı). `bulk-file.ts` — `precheckBulkFile()` (senkron: `.csv` uzantı + gevşek MIME allow-list + 0 bayt + boyut tavanı, okumadan önce anında ret) ve `readBulkFile()` (aynı ön-kontrol + `FileReader.readAsText` ile metne çevirme — jsdom'da `Blob.text()` yok, bu yüzden `FileReader`; boşluk-yalnız içerik de `empty_file` sayılır); boyut tavanı `apps/api`'deki `BULK_CSV_LIMITS.maxBytes` (5 MiB) ile mirror — sunucunun 12 MiB gövde tavanı JSON-kaçış payı taşır, admin'in akıl yürüteceği sayı o değil — `apps/web/src/features/playbook/bulk-file.ts` · test `bulk-file.test.ts` (13: `.txt`/yanlış MIME reddi · 0 bayt reddi · tavan üstü reddi (neden metninde tavan MiB olarak yazılı) · geçerli `.csv` metne çevrilir · BOM'lu dosyada içerik kaybı yok (BOM UTF-8 decode ile düşer, veri kalır) · boşluk-yalnız dosya `empty_file`). Ön-kontroller UX'tir, otorite sunucu (97.3) kalır — bu katman hiçbir güvenlik kararı vermez. Doğrulama: `pnpm --filter @nexa/web test` 23/23 yeşil (yeni) · `pnpm -w typecheck` 11/11 · `pnpm -w lint` 8/8 · `pnpm -w build` 7/7; tam suite `@nexa/web` 739 geçti/7 kırmızı (BillingPage/ReportsPage locale-format, bu turdan bağımsız — bulk dosyaları hariç izole çalıştırıldığında da aynı 7 kırmızı) ve `@nexa/api` 1997 geçti/8 kırmızı (`spawn pnpm ENOENT`, tm 97.3'te de dokümante edilen aynı ortam kısıtı) — ikisi de bu turun kapsamı dışında, dokunulmadı. tm 97.4. **06.3.2-bulk-e teslim (2026-08-09):** Knowledge panelinde "Bulk import" ikincil eylemi — `BulkImportForm.tsx`: dosya seçilince `bulk-file.ts`'in `readBulkFile()` ön-kontrolüyle okunur, geçerse `POST /knowledge-sources/bulk` **`dry_run:true`** ile çağrılır (yazma yok) ve dönen `{imported,failed}` ham sayı önizlemesi gösterilir (satır-satır sonuç tablosu 97.6'nın işi); "Import" yalnız dry-run en az 1 satırı `imported` (=geçerli) işaretlerse etkinleşir (EK-A.1), sunucu reddi (ADR-06 `validation`) `Banner`'da gösterilir ve form kilitlenmez (dosya girişi etkin kalır), yükleme sırasında `Skeleton` görünür; başarılı import sonrası `['playbook']` invalidasyonu (mevcut `invalidate` deseni) tetiklenir + panel kapanır. "Şablonu indir" `bulk-template.ts`'in `toTemplateBlob()`'unu indirir. `PlaybookPage.tsx`'teki `KnowledgePanel`'in tek-kaynak formunun hemen altına mount edildi, aynı `canEdit && aiAgentId` kapısıyla (ajan yokken hiç render edilmez, tek-kaynak formuyla birlikte görünür/kaybolur) — `apps/web/src/features/playbook/BulkImportForm.tsx` · test `BulkImportForm.test.tsx` (7, negatifler önce: yanlış uzantı → alan-altı hata + hiçbir ağ çağrısı yok · dry-run 0 geçerli satır → Import disabled kalır · sunucu `validation` hatası → Banner'da mesaj + form kilitlenmez; pozitif: yükleme sırasında Skeleton görünür · geçerli CSV → dry-run çağrısı → Import → `dry_run:false` çağrısı + invalidasyon). Doğrulama: `pnpm -w typecheck` 11/11 · `pnpm -w lint` 8/8 · `pnpm -w build` 7/7; tam suite `@nexa/web` 746 geçti/7 kırmızı (aynı bilinen BillingPage/ReportsPage locale-format kırmızıları, bu turdan bağımsız — bulk dosyaları dahil/hariç aynı 7) ve `@nexa/api` 1999 geçti/6 kırmızı (aynı bilinen `spawn pnpm ENOENT` ortam kısıtı, apps/api'ye bu turda hiç dokunulmadı) — ikisi de bu turun kapsamı dışında. tm 97.5. **06.3.2-bulk-f teslim (2026-08-09):** içe aktarma sonuç tablosu — `BulkImportResults.tsx`: `KnowledgeBulkResult` zarfını satır no/başlık/tür/durum rozeti (Imported/Skipped)/hata nedeniyle tablo olarak render eder, `VirtualTable` üzerinde (EK-B.1 — 200 satır sunucu tavanında bile yalnız görünür satırlar DOM'da); üstte özet `Banner` (`X imported · Y skipped`, kısmi başarıda `warning` tonu, tam başarıda `success`); hiç satır yoksa `EmptyState` (boş dikdörtgen değil, ne yapılacağını söyler). Dry-run önizleme ve gerçek içe aktarma AYNI bileşeni kullanır, yalnız `title` farklı (`Preview — <dosya>` / `Import complete`) — `apps/web/src/features/playbook/BulkImportResults.tsx`. `BulkImportForm.tsx` ham-sayı önizlemesi yerine bu bileşene bağlandı; gerçek içe aktarma tamamlanınca panel artık otomatik kapanıp `onSuccess`'te sıfırlanmıyor — admin satır-satır sonucu görür, "Done" butonuyla kendi kapatır. Test: `BulkImportResults.test.tsx` (5, negatif önce: boş `results` → `EmptyState` + `role=table` yok · kısmi başarı → uyarı `Banner` + her atlanan satırın no+nedeni DOM'da · tam başarı → atlanan satır bölümü hiç render edilmez · dry-run/gerçek aynı bileşen farklı başlıkla · 200 satırda `role=row` sayısı 60'ın altında, yalnız pencere içi satırlar) + `BulkImportForm.test.tsx` genişletildi (7, "Done" ile panel kapanışı ve tamamlanmış-import sonucu dahil). Doğrulama: `pnpm -w typecheck` 11/11 · `pnpm -w lint` 8/8 · `pnpm -w build` 7/7; izole `BulkImportResults.test.tsx`+`BulkImportForm.test.tsx` 12/12 yeşil; tam suite `@nexa/web` 751 geçti/7 kırmızı (aynı bilinen BillingPage/ReportsPage locale-format kırmızıları, bu turdan bağımsız). `@nexa/api` bu turda **paylaşılan yerel Postgres/Redis'e başka pencere(ler)in eşzamanlı yazdığı** doğrulandı — izole geçici DB'de bile aynı desen (canlı `unique constraint` çakışması `report-csv.test.ts`'te, `pg_stat_activity`'de yarım kalmış `idle in transaction` bağlantı, art arda iki koşuda farklı sonuç 889→982 kırmızı) — apps/api'ye bu turda **hiç dokunulmadı** (`git diff --stat -- apps/api` boş), kod hatası değil ortam çakışması; ayrı takip notu HANDOFF'ta + tm 105 açıldı. tm 97.6. **06.3.2-bulk-g teslim (2026-08-09):** CSV'nin `type:'website'` satırları artık crawl ediliyor — satır başına `assertPublicHttpUrl` (mevcut `lib/ssrf.ts` **değiştirilmeden** yeniden kullanıldı) → `crawl()` → hücre nötrleme, hepsi **DB transaction'ı AÇILMADAN ÖNCE**; yazma yine satır başına kısa tx (crawl bittikten sonra açılır). Amplifikasyon kapısı: istek başına en çok **20** website satırı (aşılırsa istek ADR-06 zarfıyla bütün olarak reddedilir, **0 dış istek** — ilk 20'yi crawl edip durmaz) + tüm dosyanın paylaştığı **15 sn** duvar-saati bütçesi + **sıralı** yürütme (eşzamanlı `crawl` çağrısı `throw` eder, böylece ileride `Promise.all`'a kayma sessizce olamaz). Ret mesajları **ayırt edilemez**: bozuk URL / loopback / link-local / metadata / bütçe → aynı üç sabit cümle, host·IP·şema·ağ ipucu YOK (gerçek neden yalnız sunucu log'una) — 200 satırda ayırt edilebilir bir ret nedeni ağ haritası olurdu. Dry-run guard'ı çalıştırır ama **hiç fetch etmez**. — `apps/api/src/services/ai/knowledge-bulk-crawl.ts` (yeni) · `routes/playbook.ts` · `lib/csv-import.ts` (`neutraliseFormula` export) · sözleşme `paths/playbook.yaml` + `openapi.yaml` (katkısal, yeni path YOK) · test `knowledge-bulk-crawl.test.ts` (22: 11 engelli hedefin her biri fetcher'a ULAŞMADAN reddedilir · 11 ret → tek mesaj · sızıntı yok · bütçe bitince fetch yok · yavaş host bütçeyi yer, sonraki satır ağa çıkmaz · eşzamanlılık reddi · sıra korunur · formül nötrleme) + integration `knowledge-bulk-website.test.ts` (9: 8 engelli hedef taşıyan CSV → hepsi `failed`, **0 kaynak / 0 chunk** · ret mesajı tek ve sızdırmaz · 21 satır → 400 + 0 kaynak · dry-run'da da tavan · cross-tenant · 1 engelli + 2 public → 2 kaynak ve `chunk_count > 0` · karışık dosya · dry-run fetch'siz ve verdict'leri gerçek import'la aynı · **tx-dışı kanıtı:** 3 crawl'lı satır 3 FARKLI `created_at` = 3 ayrı tx, yani tek tx içinde ağ çağrısı yok) · tm 97.7. **06.3.2-bulk-h teslim (2026-08-09):** uçtan uca doğrulama — `apps/e2e/tests/bulk-import.spec.ts` (yeni, 1 test, tek sürekli yolculuk): Playbook → Knowledge → Bulk import → şablon indir (`knowledge-bulk-import-template.csv`) → 5 satırlık CSV yükle → **dry-run önizleme** tablosu (`3 imported · 2 skipped`) → önizleme hiçbir şey yazmaz (kaynak listesi hâlâ boş, ayrıca iddia edildi) → Import → `Import complete` tablosunda satır satır sonuç → **article/faq/website** satırları Knowledge listesinde ve DOĞRU alt-sekmede (`knowledge-tabs.ts` filtresi: Articles/FAQ/Websites), website satırı `Indexed` + crawl edilen URL ile → **iki ret satırı listeye HİÇ girmez**: `type: podcast` → `type: …` satır hatası, `http://169.254.169.254/…` → tek ve sızdırmayan `source_url: this URL cannot be fetched.` (yanıtta `169.254` geçmediği ayrıca iddia edildi). **'RAG indeksleme' payı gerçekten geri okundu:** CSV'den gelen cümle, Playbook skill **Preview** yüzeyinden (`POST /skills/preview` → aynı `SkillEngine` → `KnowledgeService.retrieve` → pgvector yolu, canlı widget cevabının kullandığı yolun ta kendisi) cevap olarak döndü ve çalışma günlüğü kaynağı adıyla **alıntıladı** — `send_message — answered from "Zephyr warranty <run>" (0.7217)`; kanıt `apps/e2e/kanit/33-bulk-import-{preview,results,rag-answer}.png`. Ayrıca e2e koşum kapısı onarıldı: `apps/e2e/tests/global-setup.ts` `execFile('pnpm',…)` çağrısına `shell: true` (bu makinede `pnpm.exe` yok → tüm süit kurulumda `spawn pnpm ENOENT` ile ölüyordu, tek bir test bile koşmuyordu). Doğrulama: `bulk-import.spec.ts` **1/1 yeşil** (hem paylaşılan hem sıfırdan kurulmuş izole DB'de), `contract-parity.test.ts` **5/5**, typecheck 11/11 · lint 8/8 · build 7/7. tm 97.8. **`06.3.2`'nin v2'ye ayrılan kanadı — v1 satırıyla (§4.2:520) KARIŞTIRILMAMALI.** O satır **teslim** (kapalı) durumdadır ve *tek kaynak* yolunu kapsar (geçersiz URL/tür reddi · website crawl/parse · RAG indeksleme, tm 33.4); **bu satır yalnız çoklu-satır CSV/bulk yolunu** kapsar ve **teslim** (8/8 alt-görev) durumdadır. Açılış tespiti (2026-08-01, koda karşı — ARTIK TARİHÇE): `parseCsv`/`csv-parse`/`papaparse` grep **0** · `playbook.yaml`'da `bulk` grep **0** · `/knowledge-sources` yolları yalnız 2 (koleksiyon + `{sourceId}`); üçü de 97.1–97.3 ile kapandı — bugün `csv-import.ts` + `knowledgeSourcesBulk` bloğu + 3 yol (`/knowledge-sources`, `/bulk`, `/{sourceId}`) var. Task Master: **tm 97** (bu turda açıldı, §D62 — daha önce görevi yoktu). Bağımlılık: `06.3.2-a` **teslim** (crawl+index yolu + SSRF guard hazır, üzerine oturur). → §5.2 · §D67

#### K07.5 — 07.5 · Metrics breakdown — ajan/takım/kanal/saat

✅ MVP payı gün+ajan split **teslim** (tm 21/54). **07.5-a teslim** — kontrat `ReportsBreakdown`'a `by_hour`/`by_team`/`by_channel` (+ üst-alan `overlapping`) opsiyonel dizi/alan eklendi (additive, `required` değişmedi, mevcut `by_day`+`by_agent` sözleşmesi kırılmadı) — `packages/contract/openapi/openapi.yaml` · `packages/contract/openapi/paths/reports.yaml` (breakdown summary/description 4 boyutu anlatır) · bundle+generated tipler yeniden üretildi · contract-parity (5 test) + typecheck (contract/api/web) yeşil · tm 63.1. **07.5-c teslim** — `channel_messages`'a `(license_id, chat_id)` btree indeksi (migration `20260802140000_channel_messages_chat_id_index`, yalnız `CREATE INDEX`, geri alınabilir) + `reports-metrics.ts`'e saf `channelLabel()` (CHANNEL_TYPES tek kaynaktan tüketilir; `null`/bilinmeyen → `'website'`) — `apps/api/prisma/schema.prisma` · migration · `apps/api/src/routes/reports-metrics.ts` · unit `reports-metrics.test.ts` (+3, tümü yeşil) · integration `data-model.test.ts` "channel messages" (EXPLAIN, `enable_seqscan` kapatılarak plan yeni indeksi kullanıyor doğrulandı, Seq Scan yok) · `db:check-drift` temiz · tm 63.3. **07.5-b teslim** — `breakdownByHour(tx, licenseId, from, to)` helper'ı (mevcut `SPLIT_COUNTS` fragment'i aynen yeniden kullanılır, tek fark `GROUP BY EXTRACT(HOUR FROM t.created_at AT TIME ZONE 'UTC')`), 0-23 DENSE dizi (veri olmayan saat sıfırla doldurulur) döner; `/reports/breakdown` yanıtına `by_hour` eklendi, `by_day`/`by_agent` davranışı değişmedi — `apps/api/src/routes/reports.ts` · integration `reports-billing.test.ts` "breakdown (07.5)" (+2: dense 24 kova + bilinen saate düşme + satır-içi invariant · cross-tenant `by_hour` 24 sıfır-kova) · tm 63.2. **07.5-d teslim** — `breakdownByChannel(tx, licenseId, from, to)` kanal boyutu çekirdeği: `threads t` → soft-FK `LEFT JOIN LATERAL channel_messages cm` join HER İKİ kilitle (`cm.license_id = t.license_id AND cm.chat_id = t.chat_id` — RLS üstüne açık lisans kilidi, defense-in-depth: `chat_id` FK'sız ve yalnız lisans içinde tekil olduğu için chat_id-tek join başka tenant'ın satırını sızdırabilirdi), chat başına EN ESKİ `direction='inbound'` satırının `channel_type`'ı (`ORDER BY cm.created_at, cm.id LIMIT 1`), inbound yoksa `channelLabel(null)` → `'website'` (07.5-c helper'ı, tek sözlük); mevcut `SPLIT_COUNTS` aynen yeniden kullanılır (ADR-09 hizası), her thread tam bir kovaya düşer → `SUM(by_channel.chats)` === pencere toplamı; `/reports/breakdown` yanıtına `by_channel` eklendi, `reports_read` scope + route değişmedi (kontrat alanı 07.5-a'da hazırdı) — `apps/api/src/routes/reports.ts` · integration `reports-billing.test.ts` "breakdown (07.5)" (+5, negatifler önce: CROSS-TENANT B'nin aynı-chat_id `channel_messages` satırı A'nın chat'ini 'website'te tutar/'messenger'a sokamaz · `reports_read` yoksa 403 · `chat_id` NULL satır hiçbir kovayı bozmaz · messenger/twilio/whatsapp + website fallback + oldest-inbound-wins · partition invariantı `SUM(by_channel.chats)===by_day` + satır-içi `manual+assisted+automated===closed`; mevcut "never counts another tenant" `by_channel: []` ile genişletildi) · @nexa/api 1229/1229 · tm 63.4. **07.5-e teslim** — `breakdownByTeam(tx, licenseId, from, to)` takım boyutu çekirdeği: `threads t` → `JOIN chats c` (lisans kilidi `c.license_id = t.license_id`) → `LEFT JOIN chat_access ca ON ca.chat_id = c.id` (tablonun KENDİ license_id kolonu YOK) → `LEFT JOIN groups g ON g.license_id = c.license_id AND g.id = ca.group_id` (groups PK bileşik `(license_id, id)` → aynı `group_id` başka lisansta da var, lisans kilidi zorunlu; RLS üstüne defense-in-depth); `chat_access` M:N → FAN-OUT kabul (şemada 'birincil grup' yok): bir chat açık olduğu HER takımın satırında sayılır, yanıt `overlapping: true` ile beyan eder (sessiz çift-sayım yasak), hiçbir gruba açık olmayan chat `team_id: null` 'Unassigned' kovasında toplanır (kayıp yok); mevcut `SPLIT_COUNTS` aynen (ADR-09 hizası, satır-içi `manual+assisted+automated===closed`); `overlapping` ayrı EXISTS sorgusuyla (per-thread `count(*)>1`, aynı lisans kilitleri); `/reports/breakdown` yanıtına `by_team`+`overlapping` eklendi, `reports_read` scope + route değişmedi (kontrat alanları 07.5-a'da hazırdı) — `apps/api/src/routes/reports.ts` · integration `reports-billing.test.ts` "breakdown (07.5)" (+4, negatifler önce: CROSS-TENANT aynı `group_id` iki lisansta — A yalnız kendi 'Sales A'sını görür, 'Sales B' sızmaz · takım + 'Unassigned' kovası · M:N fan-out iki takımda sayım + `overlapping===true` + toplam pencere toplamını aşar · örtüşme yokken partition `SUM(by_team.chats)===by_day` + `overlapping===false` + satır-içi invariant; mevcut "never counts another tenant" `by_team: []` + `overlapping:false` ile genişletildi) · typecheck/lint/build yeşil · @nexa/api integration 967/967 + rtm 51/51 · tm 63.5. **07.5-f teslim** — `/reports/export?group=breakdown` CSV'si UZUN FORMAT'a geçti: `dimension,key,chats,closed,manual,assisted,automated`, `dimension` ∈ {day, hour, team, channel} — dört ekran boyutu (07.5-b/-d/-e'nin kendi helper'ları: `breakdownByDay`/`breakdownByHour`/`breakdownByTeam`/`breakdownByChannel`) TEK dosyada sırayla; `REPORT_GROUPS` katalogu/route/scope/dosya-adı deseni ve mevcut formula-injection guard'ı DEĞİŞMEDİ — `apps/api/src/routes/reports.ts` (`buildGroupCsv` 'breakdown' case) · `packages/contract/openapi/paths/reports.yaml` (export açıklaması güncellendi, kontrat şeması değişmedi — CSV gövde şeması taşımıyor) · integration `reports-billing.test.ts` "CSV export" (ekran–CSV birebir çapraz-doğrulama: satır sayısı === by_day+by_hour+by_team+by_channel toplamı, her satır JSON'la eşit + yeni team-name formula-injection testi) · @nexa/api integration 968/968 · tm 63.6. **07.5-g teslim** — Breakdown sekmesine üçüncü bölüm "By hour": yerel `ReportsBreakdown` arayüzüne opsiyonel `by_hour?: Array<SplitRow & { hour: number }>` eklendi (kontrat alanı 07.5-a'da hazırdı, kontrat DEĞİŞMEDİ); `BreakdownTab`'e "By day"/"By agent" ile AYNI `Section`+`Card`+`SplitTable`+`EmptyState` deseni kopyalanarak üçüncü `Section` eklendi (mevcut `SplitTable` bileşeni AYNEN kullanıldı, yeni tablo bileşeni yazılmadı), satır etiketi `String(hour).padStart(2,'0')+':00'` (`00:00`–`23:00`); alan yoksa/boşsa (`by_hour ?? []`) mevcut `EmptyState` deseni; "By day"/"By agent" blokları DEĞİŞMEDİ — `apps/web/src/features/reports/ReportsPage.tsx` · unit `ReportsPage.test.tsx` "Breakdown report, By hour (07.5-g)" (+3: `by_hour` 24 satır dolu → `00:00`/`23:00` etiketleri + 25 satır (header+24) · `by_hour` alanı yok → EmptyState, tablo yok · `by_hour: []` → EmptyState, tablo yok) · e2e `reports.spec.ts` "navigates the Overview / AI Agent / Breakdown tabs" testine `region name: 'By hour'` görünürlük iddiası eklendi (mevcut 'By day' iddiasının yanına) — `pnpm -w typecheck/lint/build` yeşil · web unit 517/517 · `reports.spec.ts` 3/3 yeşil (üç ayrı koşuda doğrulandı); tm 63.7. **07.5-h teslim** — Breakdown sekmesine dördüncü ve beşinci bölüm "By team" + "By channel": yerel `ReportsBreakdown` arayüzüne opsiyonel `by_team?: Array<SplitRow & { team_id: number | null; name: string | null }>`, `overlapping?: boolean`, `by_channel?: Array<SplitRow & { channel: string }>` eklendi (kontrat alanları 07.5-a'da hazırdı, kontrat DEĞİŞMEDİ); `BreakdownTab`'e AYNI `Section`+`Card`+`SplitTable`+`EmptyState` deseni kopyalanarak iki `Section` daha eklendi (mevcut `SplitTable` AYNEN kullanıldı); "By team" satır etiketi takım adı, `team_id: null` → 'Unassigned'; "By channel" satır etiketi ham kanal string'i ('website' dahil); `overlapping === true` iken "By team" `Section` description'ına dipnot ("a conversation open to more than one team is counted in every one of them, so row totals can exceed the window's total chats" — 07.5-e'nin fan-out beyanını ekrana taşır, sessiz çift-sayım yasağı), `false`/`undefined` iken dipnot yok; "By day"/"By agent"/"By hour" blokları DEĞİŞMEDİ — `apps/web/src/features/reports/ReportsPage.tsx` · unit `ReportsPage.test.tsx` "Breakdown report, By team / By channel (07.5-h)" (+6: takım adları + 'Unassigned' satırı görünür · `overlapping: true` → dipnot görünür · `overlapping: false` → dipnot yok · `by_team` yok/boş → EmptyState, tablo yok · `by_channel` 'website' dahil satırlar görünür · `by_channel` yok/boş → EmptyState, tablo yok) · e2e `reports.spec.ts` "navigates the Overview / AI Agent / Breakdown tabs" testine `region name: 'By team'` + `'By channel'` görünürlük iddiaları eklendi — `pnpm -w typecheck/lint/build` yeşil (11/11 · 8/8 · 7/7) · web unit 523/523 · `@nexa/rtm` 90/90 + `@nexa/api` 1234/1234 (serial, paylaşılan Postgres yarışını önlemek için ayrı koşuldu) · `reports.spec.ts` 3/3 yeşil (iki ayrı koşuda doğrulandı; tam `test:e2e`'deki tek kırıklık `settings.spec.ts:421` — tm 63.7'den beri bilinen, bu göreve ilgisiz önceden var olan kırıklık) · tm 63.8. **07.5-i teslim** — uçtan uca dört-boyut çapraz-tutarlılık + NFR-P2 EXPLAIN bütçe ölçümü: `reports-billing.test.ts` "breakdown cross-consistency (07.5-i)" bloğu (+4): (1) gün/saat/kanal üç ekseni de pencereyi aynı Overview `chats` KPI'ına böler ve `closed/manual/assisted/automated` split'i üç eksende + KPI kartlarında + faturada (`ai_resolutions.used`) birebir eşittir (ADR-09); (2) `manual+assisted+automated===closed` invariantı DÖRT boyutun HER satırında tutar; (3) YALNIZ takım boyutu pencere toplamını aşabilir ve YALNIZ `overlapping===true` beyanıyla (fazla tam olarak fazladan üyelik sayısı kadar), gün/saat/kanal daima tam bölüşür; (4) NFR-P2 (okuma p99 <150ms): üç yeni sorgu (`by_hour`/`by_channel`/`by_team`) `EXPLAIN (ANALYZE, FORMAT JSON)` plan+süre ile ölçüldü — seed veri setinde by_hour ~0.09ms · by_channel ~0.29ms · by_team ~0.13ms, hepsi bütçenin çok altında (plan regresyonu bu tabanı deler); **NFR-P7** (read-replica/ayrı analitik depo) üretim ölçeği için AÇIK SORU olarak bırakıldı, uygulanmadı. e2e `reports.spec.ts` dört bölümü (By day/hour/team/channel) zaten doğruluyor (63.7/63.8), CSV dört-`dimension` tutarlılığı export testinde kanıtlı (63.6). DoD tam yeşil: typecheck 11/11 · lint 8/8 · build 7/7 · @nexa/api integration 972/972 (contract-parity 5/5 dahil) · @nexa/rtm 51/51 · web unit 523/523 · reports.spec.ts 3/3 · tm 63.9. **BOYUT KIRILIMI TAM** (gün/saat/ajan/takım/kanal · ekran+CSV+e2e · ADR-09 hizası + NFR-P2 kanıtlı). → §5.2

#### K07.6 — 07.6 · Chat topics (AI-clustered)

✅ Deterministik kümeleme (`@nexa/ai-mock`, gerçek LLM yok). Yetersiz veride empty state. **07.6-a teslim** — `GET /reports/topics` kontratı + yetkili route iskeleti + "yeterli veri yoksa empty" kapısı: kontrat `paths/reports.yaml`'a `topics:` bloğu (operationId `getReportsTopics`, `breakdown` deseni) + `openapi.yaml`'a `/reports/topics` path kaydı + `ReportsTopics` şeması **PİNLENDİ** (`range` · `previous_period{range}` · `min_conversations` · `analyzed` · `sufficient_data` · `topics[]{id,label,keywords[],volume,share(number\|null),previous_volume,trend(number\|null)}` — `share`/`trend` boşken **null** değil 0: ReportsOverview.automated_rate + ReportsReviews.score kuralı, şema açıklamasında gerekçeli) · bundle + generated tipler (`packages/contract/src/generated/api.ts`) yeniden üretildi. Backend iskeleti `apps/api/src/routes/reports.ts` `app.get('/reports/topics', {config:{scopes:['reports_read']}})` — `rangeQuery`+`resolveRange`+`request.withTenant` içinde `clusterableCount()` (license_id filtreli SAYIM: `summary` dolu VEYA müşteri mesajı olan thread'ler), `analyzed < TOPIC_MIN_CONVERSATIONS(=20, geçici; 07.6-b `MIN_CONVERSATIONS` ile uzlaşılacak)` → `sufficient_data:false`+`topics:[]`; **kümeleme YOK** (07.6-c) — `sufficient` dalı da şimdilik boş `topics:[]`, yeni ApiError TİPİ YOK (yetersiz veri durum, hata değil) · integration `apps/api/test/integration/reports-topics.test.ts` (+9, negatifler önce: `reports_read` yok→403 · ters aralık→400 · boş tenant→`sufficient_data:false`+`analyzed:0`+`topics:[]` · eşik altı→false+doğru sayım · eşikte→true (skeleton'da topics boş) · müşteri-mesajı ile clusterable sayılır · summary/mesaj yoksa sayılmaz · `previous_period` eşit-uzunluk önceki pencere · **CROSS-TENANT** A'nın sohbetleri B'nin `analyzed`'ına girmez, NFR-S4) · contract-parity (çift yönlü) yeşil. DoD tam yeşil: typecheck 11/11 · lint 8/8 · build 7/7 · @nexa/api integration 981/981 (contract-parity 5/5 dahil) + unit 1247/1247 · tm 64.1. **07.6-b teslim** — deterministik kümeleme çekirdeği `packages/ai-mock/src/topics.ts` (SAF: DB/Fastify/env yok, `embedding.ts` komşusu — `embedding.ts`'e TEK SATIR dokunulmadı): `clusterTopics(docs,options?)` greedy-leader — dokümanlar id'ye SIRALANIR (girdi sırasından bağımsız determinizm), `embed()` ile vektör, normalize-ortalama merkeze cosine ≥ `TOPIC_SIMILARITY_THRESHOLD(0.3)` ise katıl yoksa yeni küme (eşitlikte erken küme); etiket = hafif tf-idf (küme-içi tf × korpus idf) en ayırt edici 3 token, **SALT-RAKAM token elenir** (PII: sipariş/kart no etikete girmez), tie-break skor↓→alfabetik; `TOPIC_MIN_CLUSTER_SIZE(2)` altı küme topic değil ama `analyzed`'e sayılır; `TOPIC_MIN_CONVERSATIONS(20)` altı kümelenebilir doküman → `{sufficient:false,topics:[]}`. Çıktı `{sufficient,analyzed,topics[]{id,label,keywords[],volume,docIds[]}}` — kontrat `topics[]`'ın saf-fonksiyon üretebildiği alanları; `share`/`previous_volume`/`trend` route'a (07.6-c) bırakıldı. `index.ts`'ten export. Kalibrasyon: within-topic cosine ~0.38–0.62, cross-topic ≤~0.20 → eşik 0.3 boş bantta. Test `packages/ai-mock/src/topics.test.ts` (+16): determinizm (ters+interleave→toEqual, girdi mutasyonu yok) · kümeleme (benzer bir arada/ilgisiz ayrı, 3 tema→3 topic, off-topic küme dışı+analyzed'e dahil) · sıra/tie-break (hacim↓→label↑ stabil, benzersiz stabil id) · yetersiz veri (eşik altı/boş/tek→false+[], eşikte→true tek küme) · PII (16 hane etikete/keyword'e girmez) · robustluk (boş/whitespace/noktalama çökertmez, analyzed dışı). DoD yeşil: typecheck 11/11 · lint 8/8 · build 7/7 · @nexa/ai-mock 72/72 (topics 16 + regresyon embedding/intent/compiler/assist 56) · @nexa/api full 1247/1247 · paylaşılan-embedding regresyonu (knowledge-crawl 11 + ai-skills + copilot 15 + reports-topics 9) 53/53 (`embedding.ts` değişmedi) · tm 64.2. **07.6-c teslim** — kümeleme route'a bağlandı (`apps/api/src/routes/reports.ts`): `clusterableDocs()` license_id-filtreli tenant-scoped sorgu (kümeleme metni = `threads.summary` dolu ise o, değilse ilk müşteri mesajı `events.type='message' AND author_type='customer'`, `created_at ASC` LIMIT 1), en yeni `TOPIC_WINDOW_LIMIT(1000)` ile performans tavanı (NFR-P7) + `analyzed` gerçek sayıyı söyler; PAYLAŞILAN yardımcı `buildTopicsReport()` (07.6-g CSV aynı sayıyı tüketecek, `breakdownByDay` deseni) → `clusterTopics()`, `sufficient` false ise 07.6-a empty yanıtı korunur. TREND: eşit-uzunluk önceki pencere docs çekilir ve MEVCUT dönemin küme MERKEZLERİNE atanır (**yeniden kümelenmez** — yoksa iki dönemin etiketleri eşleşmez); merkezler üyelerden yeniden kurulur (`centroidOf` = normalize-ortalama toFixed(6), `similarity` dot-product olduğundan birim vektör şart, `clusterTopics`'in kullandığı merkezle birebir), aynı `TOPIC_SIMILARITY_THRESHOLD(0.3)` eşiği; `previous_volume`=atanan sayı, `trend`=(volume−prev)/prev (**prev=0 iken null** — yeni konu bilinmez, +%100 değil), `share`=volume/analyzed (analyzed=0 iken null). Yerel `TOPIC_MIN_CONVERSATIONS(20)`+`clusterableCount()` KALDIRILDI — tek sayı `@nexa/ai-mock` `TOPIC_MIN_CONVERSATIONS`'tan; `analyzed`+`sufficient` `clusterTopics` sonucundan. Kontrat DEĞİŞMEDİ (07.6-a'da pinlenen `ReportsTopics.topics[]` alanları birebir dolduruldu; iç `docIds` yanıta SIZMAZ). Test `apps/api/test/integration/reports-topics.test.ts` (14: 07.6-a gate/isolation korunur + yeni: ayrı kelime dağarcıkları ≥2 kümeye ayrılır her biri volume>0 · hacim↓ sıra + `share=volume/analyzed` · 16-hane rakam dizisi etikete/keyword'e girmez (PII) · `previous_volume` prev pencereden okunur + yeni konu `trend` null · aynı istek iki kez → birebir aynı (determinizm) · **CROSS-TENANT** A'nın delivery/refund konuları B'nin (login) yanıtında yok, `analyzed` yalnız B — NFR-S4). DoD tam yeşil: typecheck 11/11 · lint 8/8 · build 7/7 · @nexa/api integration 986/986 (contract-parity 5/5 + tenant-isolation 22/22 dahil) · unit 266/266 + @nexa/ai-mock regresyon yeşil (`embedding.ts` değişmedi). E2E: Chat topics e2e 07.6-h'nin işi; mevcut `apps/e2e/tests/reports.spec.ts` /reports/topics'e DOKUNMUYOR (yalnız Overview/AI Agent/Breakdown/Reviews) → bu backend değişikliği mevcut e2e akışını etkilemez. · tm 64.3. **07.6-d teslim** — demo seed'de konu çeşitliliği (`apps/api/prisma/seed.ts`): eskiden HER kapalı thread'e birebir aynı özet yazılıyordu (`'Delivery query, resolved.'`), kümeleyicinin tek kelime dağarcığı vardı. Yeni `CHAT_TOPIC_GROUPS` (delivery/refund/billing/product, grup başına 6 kapalı sohbet + kendi müşterisi) + `seedChatTopics()` bunları `createConversation()`'ın yeni `summary`/`at` parametreleriyle yazıyor (eski çağrı yeri varsayılanla değişmedi). Kelimeler `clusterTopics`'e karşı 200 rastgele id sıralamasıyla kalibre edildi (grup-içi cosine ~0.4–0.9 bir arada kalıyor, gruplar-arası eşik 0.3'ün altında/yakınında — hiç birleşme yok). Delivery grubundan 2 sohbet `PREVIOUS_WINDOW_AT`'a (mevcut 30 günlük pencereden bir pencere öncesine) geri tarihleniyor ki en az bir konunun `trend`'i her zaman null değil gerçek bir sayı olsun. Şema/migration YOK — yalnız seed verisi; hesap/lisans/plan yapısı ve kümeleme eşikleri (07.6-b) değişmedi. Test `apps/api/test/integration/reports-topics.test.ts`'e yeni `describe` (gerçek `pnpm db:seed` çalıştırır, sentetik fixture değil): seed edilmiş demo lisansında `sufficient_data:true` + `topics.length>=2` + her kümede `volume>=TOPIC_MIN_CLUSTER_SIZE` + en az bir kümede `previous_volume>0` ve `trend!==null` · zengin sohbeti olmayan ikinci demo lisansına (northwind) sızma yok (`analyzed:0`+`sufficient_data:false`+`topics:[]`) · idempotency (seed iki kez → aynı kümeler, `toEqual`). DoD tam yeşil: typecheck 11/11 · lint 8/8 · build 7/7 · `pnpm -w test` (@nexa/api) 66 dosya/1255 test yeşil (yeni 3 test dahil) + izole `reports-topics.test.ts` 17/17 doğrulandı · tm 64.4. **07.6-e teslim** — Reports'a 'Chat topics' sekmesi: `TABS`'a `{id:'topics',label:'Chat topics'}` + panel dalı bağlandı; yerel `ReportsTopics`/`TopicRow` arayüzleri 07.6-a şemasıyla birebir; `TopicsTab` = `useReport<ReportsTopics>('topics',...)` + hata→`ErrorNotice` + yükleniyor→`CardSkeleton` + `!sufficient_data`→anlamlı `EmptyState` (`min_conversations`+`analyzed` metinde) + dolu→`TopicsTable` (label/volume/share `formatRate`+'—' null/trend ok+büyüklük, renk tek başına değil, `TopicTrend` `trend===null`→'—') — `apps/web/src/features/reports/ReportsPage.tsx`. Test `ReportsPage.test.tsx` "Chat topics report (07.6)" (+4): hacim/pay/trend satırları görünür (KK-a) · `sufficient_data:false` → anlamlı empty, tablo yok (KK-b) · önceki pencerede yoksa trend hücresi '—' (0% değil, KK-c) · seçili aralıkla `/reports/topics` sorgulanır; mevcut sekme testleri regresyonsuz. DoD yeşil: typecheck 11/11 · lint 8/8 · web unit 527/527 (yeni 4 dahil, `ReportsPage.test.tsx` 23/23) · build 7/7 · manuel doğrulama: gerçek API'ye karşı tarayıcıda Chat topics sekmesi tıklanıp hacim/pay/trend + '—' render'ı canlı veriyle onaylandı · tm 64.5. **07.6-f teslim** — Overview'a promo bandı: mevcut `components/ui/Banner.tsx` deseni (`dismissible`+stabil `id` → localStorage, EK-C.2, tm 62) yeniden kullanılıp `apps/web/src/features/reports/ReportsPage.tsx`'e `TopicsPromoBanner` eklendi — yalnız `tab==='overview'` dalında render edilir (Chat topics/diğer sekmelerde otomatik gizli, ayrı koşul yazılmadı); `tone="brand"`, metin "Top chat topics in one place"; birincil CTA "See chat topics" `onClick`'i `setTab('topics')` çağırır (aynı sayfa, yeni rota yok); ikincil "Remind me later" AYRI bir buton DEĞİL — Banner'ın kendi `dismissible` kontrolü, `dismissLabel="Remind me later"` ile erişilebilir adı override edilerek (görünür glif yine `×`, aria-label "Remind me later"). Sol navigasyona NEW rozeti eklenmedi (varsayım 5 korundu). Kontrat/şema/migration yok — salt istemci UI. Test `ReportsPage.test.tsx` yeni "Overview 'Chat topics' promo banner (07.6-f)" bloğu (+5): band görünür + CTA tıklanınca Chat topics sekmesi `aria-selected=true` olur · Chat topics sekmesindeyken band yok · diğer sekmelerde (AI Agent) band yok · "Remind me later" → band kapanır ve `unmount`+yeniden `render` sonrası geri gelmez (localStorage kalıcılığı, Banner.test.tsx'teki remount deseniyle birebir) · `localStorage.setItem` fırlatırken (private mode simülasyonu) yine kapanır, hata fırlatmaz. DoD tam yeşil: typecheck 11/11 · lint 8/8 · web unit 532/532 (yeni 5 dahil) · build 7/7 · `pnpm -w test:integration` 47 dosya/989 test yeşil (bu görev backend'e dokunmadı, regresyon kontrolü). tm 64.6. **07.6-g teslim** — Topics rapor grubu `/reports/groups` kataloğuna + CSV export'a eklendi: `reports-export.ts` `REPORT_GROUPS`'a `{id:'topics',label:'Chat topics',scopes:['reports_read']}` satırı (mevcut dört grubun ardına, Reports sayfası `TABS` sırasında son sekme) — `EXPORT_SCOPES`/`visibleReportGroups` katalogdan TÜRETİLDİĞİ için otomatik tutarlı kaldı, yeni scope/route yok. `reports.ts` `buildGroupCsv` switch'ine `case 'topics'` — 07.6-c'nin PAYLAŞILAN `buildTopicsReport()` yardımcısını (route'un previous-window `spanMs`/`prevFrom`/`prevTo` inşasıyla birebir) yeniden kullanır, yeniden hesaplama YOK; başlıklar `label,volume,share,previous_volume,trend`; `sufficient_data:false` iken yalnız başlık satırı (uydurma 0 satırı yok). Kontrat `paths/reports.yaml` `export` bloğunun açıklaması + `group` parametre açıklamasına `topics` eklendi (yeni path/şema yok, contract-parity kırılmadı) + bundle/generated tipler yeniden üretildi. Enjeksiyon koruması: konu etiketleri `tokenize()`'ın ürettiği saf alfanümerik kelimelerden geldiği için (`packages/ai-mock/src/topics.ts`) formula-lead karakterle (`=+-@`) ASLA başlayamaz — koruma `csvField`'dan geldiği ve zaten `reports-export.test.ts`'in `toCsv` süitinde jenerik kanıtlandığı için topics'e özgü ayrı bir enjeksiyon testi yazılmadı (breakdown'ın takım-adı testi gibi diğer sabit-metin gruplarında da tekrarlanmıyor). Test: `reports-export.test.ts` `reportGroup('topics')` (+1) · `reports-topics.test.ts`'e yeni `describe('CSV export (07.6-g)')` (+4: izin bazlı görünürlük · CSV satırları JSON'daki `volume`/`share`/`previous_volume`/`trend` ile birebir · yetersiz veride yalnız başlık satırı · CROSS-TENANT A'nın CSV'sinde B'nin konu kelimeleri yok) · mevcut `reports-billing.test.ts` grup-listesi regresyon testi `topics` içerecek şekilde güncellendi. DoD tam yeşil: typecheck 11/11 · lint 8/8 · build 7/7 · @nexa/api unit 266/266 (`reports-export.test.ts` 11/11) + integration 993/993 (47 dosya, contract-parity 5/5 dahil, tek koşuda) · @nexa/web 532/532 · @nexa/rtm 90/90 · @nexa/ai-mock 72/72 · @nexa/types 60/60 · @nexa/widget 52/52 (bu görev backend+kontrat, UI/e2e'ye dokunmadı — KAPSAM DIŞI "indirme düğmesi UI'ı"; 07.6-h e2e ayrı görev). tm 64.7. **07.6-h teslim** — uçtan uca doğrulama (yalnız test/kanıt; ürün davranışı DEĞİŞMEDİ): `apps/e2e/tests/reports.spec.ts`'e yeni `describe('reports — chat topics (FR-MOD-07.6)')` (+3, `agentPage` fixture'ıyla gerçek tarayıcı+API): (1) DOLU kutup — Chat topics sekmesi `aria-selected=true`, "grouped into topics by AI clustering" ("AI kümeleme"), `Volume`+`Trend` sütun başlıkları + ≥1 konu satırı hacim değeriyle ("hacim/trend"), yeni konu için uydurma 0% değil '—'; kanıt `apps/e2e/kanit/23-reports-topics.png`. (2) EMPTY kutbu — Custom aralık 2020-01-01…-07 (verisiz) → "Not enough conversations yet" anlamlı empty state (boş tablo değil: `Volume` başlığı yok) = "yeterli veri yoksa empty" KK'sının uçtan uca kanıtı; `apps/e2e/kanit/23-reports-topics-empty.png`. (3) Promo bandı — "See chat topics" CTA sekmeyi açar (`aria-selected=true`); "Remind me later" gerçek `reload` (localStorage refresh-token ile yeniden auth) sonrası bandı geri getirmez. E2E öncesi temiz kurulum: DB truncate (integration `resetDatabase` kuralı) + `pnpm db:seed` (demo Acme 4 grup×6 = 26 clusterable → 4 topic, `sufficient_data:true`), `.env` source, playwright webServer portları yönetti (`nexa-e2e-clean-db`). REGRESYON KANITI (aynı tur): `embedding.ts` DEĞİŞMEDİ (git ile doğrulandı) — iki tüketici de yeşil: @nexa/ai-mock 72/72 + knowledge-crawl 11/11 + ai-skills 18/18 + copilot 15/15 (RAG/paylaşılan embedding) + reports-topics 21/21. NFR-P7: `/reports/topics` ~22–80ms (cap `TOPIC_WINDOW_LIMIT`=1000, analyzed=26). DoD TAM yeşil: typecheck 11/11 · lint 8/8 · build 7/7 · unit (types 60 · ai-mock 72 · widget 52 · api 266 · rtm 39 · web 532) · integration (rtm 51 + api 993/993, 47 dosya) · e2e `reports.spec.ts` 6/6 (yeni topics 3 dahil). tm 64.8. **Kalan:** 07.6-h e2e. → §5.2

#### K07.7-b — 07.7 · Rapor grupları v2 payı — Leads/Cases/Sales/Team performance + PDF export + benchmark + Sav

✅ Önceliği **açıkça iki faza yayılıyor**. v1 payı **teslim** teslim (izin bazlı görünürlük + CSV, tm 46/§D35); §4.4.8 zaten _"Kapsam dışı: PDF/benchmark (v2)"_ diyordu ama **v2 satırı hiç açılmamıştı**. **07.7-a (Cases rapor grubu) teslim** (tm 93.1): `GET /reports/cases` (by_day open/closed/total + by_status + by_priority, `merged_into_id IS NULL` çift-saymayı önler) + `REPORT_GROUPS`'a `cases` + `buildGroupCsv` 'cases' case'i (`date,open,closed,total`) — `apps/api/src/routes/reports.ts` + `reports-export.ts` · test `reports-export.test.ts`(+1) + `reports-billing.test.ts` "Cases report (07.7-a)"(8) + CSV export(+1) + groups-list güncellemesi (109/109) · OpenAPI `/reports/cases` + `pnpm --filter @nexa/contract generate` + contract-parity ✅ (5/5). **07.7-b (Leads rapor grubu — lisans-sınırı çekirdeği) teslim** (tm 93.2, OPUS-MAX): `GET /reports/leads` — `is_lead` müşteriler bu lisansa **dokunduğu** UTC güne göre sayılır (`by_day{date,count}` + `totals.leads`, sum(by_day)===totals). **İZOLASYON KARARI:** `customers` `organization_id`-scope'lu (`is_lead` schema.prisma:243, `license_id` YOK; RLS `app.current_organization`) ve bir org çok lisans taşır → `customers.is_lead` naif sayımı kardeş lisansların lead'lerini sızdırırdı; onun yerine lead **yalnız** bir `chats`/`tickets` (ikisi de license-scope'lu) satırıyla lisansa bağlanır — join'de `WHERE license_id = ${licenseId}` AÇIKÇA (RLS üstüne defence-in-depth, `breakdownByChannel`/`breakdownByTeam` deseni), `first_touch`=min(chat/ticket) ile lead ilk-değme gününe atanır (org-geneli oluşturma tarihi bu lisansın malı değil). `customers`'a `license_id` EKLENMEDİ (kapsam dışı). Paylaşılan `leadFirstTouch` CTE fragmanı `leadsByDay`+`leadTotals`'ta; `buildLeadsReport`+`buildGroupCsv` export; `REPORT_GROUPS`'a `leads` + `buildGroupCsv` 'leads' case'i (`date,count`) — `apps/api/src/routes/reports.ts` + `reports-export.ts` · OpenAPI `/reports/leads` + `ReportsLeads` + re-bundle (138 path) + contract-parity ✅ (5/5). Test: `reports-export.test.ts`(+1) + `reports-billing.test.ts` "Leads report (07.7-b)"(8) + CSV export(+1) + groups-list · **`tenant-isolation.test.ts` izolasyon çekirdeği**(+3: AYNI org iki lisans — naif org-geneli sayım L1/L2 için 3/3 iken lisans-bağlı rapor 2/1; L1 lead'i L2'nin `/reports/leads` yanıtında VE `?group=leads` CSV'sinde SAYILMAZ). KK "İzin bazlı görünürlük" + "export". MCP `get_report`/Web UI (07.7-i) KAPSAM DIŞI. **07.7-c (Team performance rapor grubu) teslim** (tm 93.3, SONNET-MAX): `GET /reports/team-performance` — mevcut breakdown `by_agent` sorgusunun (`SPLIT_COUNTS` · chats DESC · `LIMIT 20`) ajan başına genişletilmişi: ortalama ilk-yanıt/kapanış süresi + `ratings`→`threads.assignee_id` join'li good/bad/CSAT + `chat_transferred` devir sayısı. Paylaşılan `teamPerformanceByAgent` hem rotada hem `buildGroupCsv` 'team-performance' case'inde (14 sütun) kullanılır → indirme ile sekme aynı lisans+aralık için farklı rakam veremez. **PENCERELEME KARARI:** CSAT ve devir kendi `created_at`'lerine göre pencerelenir (`satisfactionCounts`/`transferCount` idiyomu, thread'in oluşturma tarihine göre DEĞİL); hangi ajanın listeye gireceği, sırası ve `LIMIT 20` YALNIZ chat-split sorgusundan gelir — bu mevcut by_agent kırılımının alan genişletmesi, yeni ajan-görünürlük kuralı DEĞİL. Oy verilmemiş ajanda CSAT `null` (0 değil — `satisfactionScore` kuralı). `REPORT_GROUPS`'a `{id:'team-performance',label:'Team performance',scopes:['reports_read']}` — `apps/api/src/routes/reports.ts` + `reports-export.ts` · Kontrat: `paths/reports.yaml` `teamPerformance` op + `openapi.yaml` `/reports/team-performance` ref + re-bundle + contract-parity ✅. Test: `reports-export.test.ts`(+1) + `reports-billing.test.ts` "Team performance report (07.7-c)"(8: chat split+süre+CSAT · oysuz ajan→`null` · AI→insan devri · atanmamış sohbet hiçbir ajan satırına yazılmaz · boş pencere boş liste · cross-tenant · ters tarih · `reports_read` şartı) + CSV export(+2: JSON raporla birebir aynı satır · `=Acme,Inc` ajan adı `'` ön ekiyle nötrleniyor) → api 1536/1536. **FIXTURE NOTU:** `accounts` global tablo, görünürlüğü satırdaki bir kolondan değil `agent_memberships` üzerinden gelir (`accounts_tenant` policy) → raporun `LEFT JOIN accounts`'u ismi yalnız lisansın ÜYESİ ajan için çözer; formül-enjeksiyon fixture'ına eksik üyelik satırı eklendi (üretimde bir assignee zaten hep üyedir). Web UI sekmesi (07.7-j) KAPSAM DIŞI. **07.7-d (Sales rapor grubu — 13.5 Sales tracker'a bağlı `configured:false` dürüst iskelet) teslim** (tm 93.4, SONNET-XHIGH): `GET /reports/sales` + `buildSalesReport` — reviews'ün `ecommerce` bloğuyla (`buildReviewsReport`) birebir aynı dürüst iskelet: `{ range, configured:false, tracked_sales:null, attributed_revenue_cents:null, currency:null, conversions:null }`; 13.5 Sales tracker geldiğinde tek yerden doldurulur (şema/migration'a dokunulmadı — bilinçli olarak sipariş/satış tablosu AÇILMADI). `REPORT_GROUPS`'a `{id:'sales',label:'Sales',scopes:['reports_read']}` + `buildGroupCsv` 'sales' case'i (metric/value şekli, null değerler `csvField` ile boş hücre). Kontrat: `paths/reports.yaml` `sales` op (açıklamasında 13.5 bağımlılığı yazılı) + `openapi.yaml` `/reports/sales` ref + `ReportsSales` şeması + re-bundle + `api.ts` regen, contract-parity ✅. Test: `reports-export.test.ts`(+1 katalog) + `reports-billing.test.ts` "Sales report (07.7-d)"(4: configured:false + tüm alanlar null — 0 DEĞİL · cross-tenant'ta da sızıntısız aynı configured:false · ters aralık 400 · reports_read scope'suz 403) + CSV export(+1: metric/value başlığı, null hücreler boş) → api 1554/1554. KK "İzin bazlı görünürlük" + "export" birebir karşılandı. DoD TAM yeşil (iki pencere önce Docker ortam sorunuyla blocked kalmıştı — tm 93.6'nın kurduğu Postgres 17/Redis ortamı bu pencerede kullanıldı, kod hiç değişmedi): typecheck 11/11 · lint 8/8 · `turbo test` 10/10 (api 1554/1554) · integration 5/5 (1206/1206, `tenant-isolation` 32/32 dahil) · build 7/7 · e2e 74/74 (`reports.spec.ts` "opens the Reviews tab ... and the sales skeleton" dahil). Web UI sekmesi (07.7-j) KAPSAM DIŞI. **07.7-f (deterministik, bağımlılıksız PDF serializer — saf modül) teslim** (tm 93.6, OPUS-XHIGH): `toPdf(title, headers, rows, meta)` — `toCsv`'nin PDF eşi; elle yazılmış PDF 1.7 (katalog + sayfa ağacı + Helvetica/Helvetica-Bold core font `/WinAnsiEncoding` — font gömme YOK + sıkıştırılmamış içerik akışı + bayt-ofsetli `xref` + trailer), **sıfır yeni npm bağımlılığı** (depoda PDF kütüphanesi grep'i 0'dı; bağımlılık eklemek yerine ~90 satırlık saf serializer yazıldı). `Buffer` döner çünkü `xref` dosyaya BAYT ofseti taşır — string dönseydi çağıran yeniden kodlayıp offsetleri sessizce geçersizleştirebilirdi. **DETERMİNİZM KARARI:** modül içinde saat/rastgelelik/ortam okuması YOK, `/ID` yok, zlib YOK (zlib çıktısı Node sürümleri arasında garanti kararlı değil — determinizm birkaç KB'den değerli); `/CreationDate`+`/ModDate` yalnız `meta.createdAt`'ten gelir, verilmezse anahtar hiç yazılmaz (uydurulmuş "şimdi" yok) → aynı girdi bayt-birebir aynı çıktı. **KAÇIŞ:** `\`, `(`, `)` PDF literal kaçışı + 0x20–0x7E dışındaki her bayt `\ooo` octal → içerik akışları saf ASCII (sekiz bitlik veriyi bozan hiçbir taşıma sayfayı değiştiremez); metin CP1252'ye çevrilir, core font'un 256 glifi dışındaki kod noktası `?` olur — **bir bayt bir glif**, dolayısıyla hiçbir `xref` ofseti kaymaz (bozulma değil, çizim sınırı; aşmak gömülü font = bağımlılık ister, task yasaklıyor). **`FORMULA_LEAD` kalkanı PDF'e BİLEREK TAŞINMADI** — PDF'in formül değerlendiricisi yok, `'` ön eki yalnız okuyucunun verisini bozardı (`-Acme` → `'-Acme`); gerekçe kod yorumunda + CSV'nin hâlâ koruduğu regresyon testinde. Yerleşim A4: sayfa başına başlık + sütun başlığı tekrarı + `Page n of m` altbilgisi, sayısal hücrelerde sağa hizalama, sığmayanda WinAnsi üç-nokta kırpma; sütun genişliği **max-min fair share** (dar sütun doğal genişliğini alır, artan yalnız açgözlü sütunlar arasında bölünür — ilk sürümdeki orantısal ölçekleme tek bir uzun serbest-metin sütununun sayfayı yutmasına ve `date`/`chats`'in üç-noktaya inmesine yol açıyordu, regresyon testiyle kilitlendi). `exportFilename`'e opsiyonel 4. parametre `format: 'csv'\|'pdf' = 'csv'` (uzantı parametreleştirildi); 3 argümanlı v1 çağıranlar birebir aynı adı alır (test). Rota/kontrat/OpenAPI/şema/migration'a **TEK satır dokunulmadı** — `reports.ts` hiç açılmadı, bağlama işi 07.7-g — `apps/api/src/routes/reports-export.ts` · test `reports-export.test.ts` **11→24 (+13)**: `xref` ofsetinin gerçekten kendi `N 0 obj` baytlarına düştüğünü ve `/Length`in akıştaki gerçek bayt sayısıyla eşleştiğini okuyan yapısal denetleyici (`readXref`/`expectWellFormed` — "makul görünen" ofset okuyucuda bozuk dosya açar) · `%PDF-1.7` başlangıcı + `%%EOF` sonu · determinizm (meta'lı ve meta'sız) · `meta.createdAt` yoksa `/CreationDate` hiç yok · `(`/`)`/`\` kaçışı · WinAnsi dışı metin (`Café → 世界`) + akışlarda yüksek bayt kalmadığı · **0 satır → "No data." tek geçerli sayfa (boş dosya DEĞİL)** · 0 sütun · 200 satırda sayfalama (başlık+sütun başlığı her sayfada tekrar) · aşırı uzun hücre + 40 sütunlu tablo exception'sız · fair-share genişlik · formül kalkanının uygulanmadığı + CSV regresyonu → api unit 1554/1554. **BAĞIMSIZ KANIT (kendi testine değil üçüncü-parti ayrıştırıcıya karşı):** üretilen 3 sayfalık PDF Apple CoreGraphics (`qlmanage`) ile PNG'ye render edildi — `Overview — Ünïcode` başlığı (WinAnsi `ü`/`ï` + em-dash), hücrelerdeki `( ) \ "` düz metin olarak bozulmadan, sağa hizalı `chats` sütunu, fair-share sayesinde kırpılmamış `date`/`chats` ve `Page 1 of 3` doğru çizildi; 0 satırlı belge de sütun başlığı + `No data.` ile geçerli tek sayfa olarak render oldu. DoD TAM yeşil (bu pencerede Postgres 17 + pgvector yerel olarak ayağa kaldırılıp docker-compose eşleniği kuruldu — bkz. HANDOFF): typecheck 11/11 · lint 8/8 · build 7/7 · `turbo test` 10/10 (api 1554 · web 606 · rtm · ai-mock 72 · widget 52 · types 60) · integration 1206/1206 (`tenant-isolation` 32/32 dahil) · e2e 74/74. **07.7-e (benchmark karşılaştırma katmanı — tüm rapor gruplarına ortak vs-baseline) teslim** (tm 93.5, OPUS-XHIGH): **BELİRSİZLİK KARARI (§V1) kodda yazılı:** PRD "benchmark karşılaştırma" der ama neye karşı olduğunu söylemez; benchmark = **AYNI LİSANSIN kendi geçmişi** (`baseline: previous_period | previous_year`), lisanslar-arası/sektör/anonim havuz **AÇIKÇA REDDEDİLDİ** — gerekçe ürün tercihi değil **erişim sınırı**: her rapor rakamı RLS altında lisans-kapsamlı sorgudan gelir (ADR-12, NFR-S4) ve agregasyon bunu güvenli yapmaz (kohort bire indirilebilir → rakip trafiği ifşa olur); gerekçe `reports-metrics.ts` blok yorumunda + `isBenchmarkBaseline` testinde (`industry`/`other_license`/`peer_cohort` reddedilir — "henüz yok" değil, **yok**). Saf çekirdek `benchmarkWindow(from,to,baseline)` `apps/api/src/routes/reports-metrics.ts`'e çıkarıldı (Fastify/Prisma/env importu yok): `previous_period` birebir eski üç satır (`from-span` → `from-1ms`; 1 ms boşluk iki pencerenin aynı anı paylaşmasını önler), `previous_year` **sabit 365 gün** kaydırır — takvim yılı artık günde iki pencereyi farklı uzunlukta yapardı (eşit-uzunluk kuralının tam ihlali) ve saat dilimi/DST akıl yürütmesi gerektirirdi. `withBenchmark(...)` `previous_period` bloğunu **tek yerde** üretir (`{baseline, range, ...figures}`; `baseline` alanı yanıtı kendini tanımlar kılar — aynı anahtar isteğe göre farklı pencere taşır). Overview + Reviews'ün elle yazılmış kopyaları kaldırıldı, **davranış birebir korundu** (regresyon testi: `baseline` verilmeyen çıktı, `?baseline=previous_period` çıktısıyla `toEqual`). `?baseline=` **dokuz rapor ucunun hepsine** eklendi (`resolveReportQuery` — tek query çözümleyici; tanımsız değer 400 ve hata mesajı `baseline`'ı adıyla anar, "Invalid date range." yanıltmaz). **Grup başına baseline rakamı** ortak `groupBenchmark` dispatch'inden gelir → ekran ile indirme aynı sayıyı verir: overview (headline sayaçlar) · breakdown + team-performance (lisans çözüm ayrımı — **boyut/ajan tablosu KOPYALANMAZ**: kovalar pencereden türetilir, satır-satır karşılaştırma bir ajanı başkasıyla eşleştirirdi) · ai-agent (resolutions/transfers/skill_runs) · reviews (CSAT) · cases (`casesByDay` toplamı — `ticketCount` DEĞİL, merged hariç tutma serisiyle aynı kalsın diye) · leads (`leadTotals` → `leadFirstTouch`, lisans bağı baseline'da da geçerli) · sales (hepsi `null` — 0 değil) · topics (pencere-düzeyi rakam yok; `previous_volume` zaten topic satırında **ve** `baseline` kümeleme çağrısına kadar iner, yani trend penceresi gerçekten değişir). **CSV benchmark bloğu opt-in:** `?baseline=` verilirse tabloya `benchmark_<key>,value` satırları (tablo genişliğine pad'li) eklenir; verilmezse dosya **bayt-birebir eskisi** — JSON nesnesi anahtar kazanınca zararsızdır ama CSV konumsaldır ve 1. sütunu tarih diye okuyan bir script bozulurdu. Kontrat: **YENİ PATH YOK** — `components/parameters/BenchmarkBaseline` + `components/schemas/BenchmarkWindow` eklendi, dokuz operation + `/reports/export` parametreyi `$ref`'ler, `previous_period` eksik olan altı şemaya `allOf` ile eklendi ve `required`'a alındı; `pnpm --filter @nexa/contract generate` (141 path) + contract-parity ✅ (5/5, path sayısı değişmedi). Test: `reports-metrics.test.ts` **12→21** (pencere aritmetiği, 1 ms boşluk, sıfır-uzunluk pencere, artık gün, UTC kayması, eski üç satırın birebir yeniden üretimi, baseline enum'u) + `reports-billing.test.ts` "benchmark comparison (07.7-e)" **+55** (5×9 tanımsız-baseline reddi · export'ta da red · hata mesajı `baseline`'ı anar · **cross-tenant**: aynı pencere+baseline, A=1 B=3 — havuzlansa ikisi de 4 okurdu · 9 grup previous_period taşır · 9 grup varsayılanı `previous_period` · overview/reviews değişmedi · sales null · previous_year 9 grupta 365 gün kayar + yıl-önce sohbeti sayar, önceki dönem saymaz · cases merged hariç · leads dokunmamış kardeş lead'i saymaz · team-performance `agents` taşımaz · topics trend penceresi kayar · 9 grup CSV baseline'sız `benchmark_` içermez · 9 grup CSV baseline'lı blok ekler + alan sayısı sabit · CSV rakamı JSON'la aynı · CSV bloğu baseline ile birlikte kayar) → api 1684. UI rozetleri (07.7-i/-j), PDF yerleşimi (07.7-g) ve hedef/SLA eşikleri (FR-MOD-13.3) KAPSAM DIŞI. DoD TAM yeşil: typecheck 11/11 · lint 8/8 · `turbo test` 10/10 (api 1684) · integration 1310/1310 · build 7/7 · e2e 74/74. **07.7-g (PDF export rotası — `/reports/export` `format` parametresi + content-type/attachment bağlama) teslim** (tm 93.7, SONNET-XHIGH): `exportQuery` zod şemasına `format: z.enum(['csv','pdf']).default('csv')`; rota gövdesi CSV yolunu byte-birebir değiştirmeden tek dallanma alır — `format==='pdf'` → `toPdf(group.label, table.headers, table.rows, {subtitle: '<from>–<to>'})` + `content-type: application/pdf` + `exportFilename(group.id, from, to, 'pdf')` ile `.pdf` uzantılı attachment; `nosniff`/`no-store` artık **tek** `reply.header(...)` çağrısından geliyor, iki formatta da aynı kopyasız kaynaktan. Kontrat: `paths/reports.yaml` `export` operation'ına `format` parametresi (enum `csv\|pdf`, default `csv`) + `application/pdf` response içeriği eklendi, "PDF export is still v2 work ... not offered here" cümlesi kaldırıldı; `pnpm --filter @nexa/contract generate` (142 path, sayı değişmedi) + contract-parity ✅ (5/5) — `api.ts`'te `exportReport.parameters.query.format` + `responses['200'].content['application/pdf']` üretildi. Test: `reports-billing.test.ts` "PDF export" **+15** (`format=exe/html/pdfx` → 400 · `reports_read`'siz `format=pdf` → 403 — format yetkiyi baypas etmiyor · 9 grubun hepsi `format=pdf` → 200 + `%PDF-1.7` başlangıcı + doğru `content-disposition` + nosniff/no-store · **cross-tenant**: B'nin `format=pdf` çıktısı, A'da yeni sohbet açılmadan önce/sonra bayt-birebir aynı — RLS'in saf-fonksiyon garantisini PDF metin operatörlerini ayrıştırmadan kanıtlar (ilk deneme `(1) Tj` regex'iyle "hour" boyutunun `key=1` satırını sızıntı sandı — yanlış pozitif, bayt-eşitliğe geçilerek düzeltildi) · `format` verilmeyince çıktı `format=csv` ile bayt-birebir aynı — regresyon) → `turbo test` 10/10, api 85 dosya/1766 test. DoD TAM yeşil: typecheck 11/11 · lint 8/8 · build 7/7 · `turbo run test --filter='!@nexa/e2e' --concurrency=1` 10/10 (tek-thread, DB testleri paralel koşmadı). Web UI export butonu (07.7-k) ve uçtan uca doğrulama (07.7-l) KAPSAM DIŞI — bu satır PDF yerleşim/benchmark-tablo kararını hâlâ UI'ye bırakıyor (bkz. §5.2.4 açık soru). **07.7-h (Reports Save view — rapora özgü kaydedilmiş görünüm, saf modül) teslim** (tm 93.8, SONNET-XHIGH): `apps/web/src/features/reports/report-views.ts` — Inbox'ın `features/inbox/views.ts` saved-view deposunun (satır 96-243) BİREBİR kopyası, Reports'a özgü alanlarla: `SavedReportView { id, name, tab, mode, customFrom, customTo, baseline }`; `tab`/`mode` `ReportsPage.tsx`'teki `TabId`/`RangeMode`'u **ayrı tip olarak yansıtır** (import bağı YOK — sayfa bileşenine tek yönlü bağımlılık kurmamak için; UI bağlama 07.7-k'da iki tarafı birleştirir), `baseline: ReportBaseline | null` `reports-metrics.ts`'teki `BenchmarkBaseline`'ı yansıtır (`null` = kayıt anında benchmark karşılaştırması kapalıydı). Ayrı `STORAGE_KEY = 'nexa.reports.saved-views'` (Inbox'ın anahtarıyla çakışmaz — test edildi). `isSavedReportView` katı doğrulayıcı bilinmeyen `tab`/`mode`/`baseline` değerini DÜŞÜRÜR; `safeStorage()` + `loadSavedReportViews`/`saveSavedReportViews`/`addSavedReportView`/`removeSavedReportView`/`useSavedReportViews()` — isim sınırı `SAVED_REPORT_VIEW_NAME_MAX=40` (Inbox'ın `SAVED_VIEW_NAME_MAX` emsaliyle aynı değer). Test `report-views.test.ts`(13, negatif önce: bozuk/non-array storage · bilinmeyen tab/mode/baseline'lı 6 satır düşürülür · storage throw'unda çökmeme · Inbox anahtarına dokunmama · round-trip custom aralık+previous_year baseline · ekle/isim-kırpma/boş-isim-red/sil · `useSavedReportViews` reload-sonrası kalıcılık) → web 641/641. Kontrat/migration yok (bilinçli — istemci-taraflı). Test `pnpm -w test:e2e` **tam koştu** (75/76 — tek kırmızı `skills-routing.spec.ts:76`, bu görevle **ilgisiz**, tm 77.4'ten beri HANDOFF'ta kayıtlı bilinen flake, izole koşuda da aynı hata → bu görevin sürdüğü yüzeyde regresyon yok). UI çubuğu/butonları (07.7-k) KAPSAM DIŞI. **07.7-i (Reports UI — Leads + Cases sekmeleri) teslim** (tm 93.9, SONNET-XHIGH): `ReportsPage.tsx` `TABS`'a `{id:'cases',label:'Cases'}` + `{id:'leads',label:'Leads'}`; `LeadsTab`/`CasesTab` MEVCUT `useReport<T>(kind, api, props)` generic hook'unu ve `Kpi`/`KpiGrid`/`Card`/`CardSkeleton`/`ErrorNotice`/`EmptyState` desenini birebir kopyalar (referans: `ReviewsTab`). `CasesTab`'ın kartları (Open/Closed/Total) `ReportsCases`'te top-level `totals` alanı OLMADIĞI için `by_day`'den `sumCaseSplit` ile türetilir — backend'in kendi `casesBenchmark`'ının aynı toplamı aldığı yöntem (`apps/api/src/routes/reports.ts:2103`), böylece kart ile alttaki tablo asla ayrışmaz. `LeadsTab` `totals.leads`'i doğrudan kullanır. Her iki sekme `previous_period` alanını (07.7-e'den, HER ZAMAN dolu gelir) MEVCUT `CountDelta` bileşenine besler — Overview/Reviews'ün "vs previous" rozet deseninin birebir aynısı. Cases ayrıca `by_status`/`by_priority` için ayrı tablolar (`CasesStatusTable`/`CasesPriorityTable`) render eder; priority ham işaretli tamsayı (`FR-MOD-13.6`), `formatCount` DEĞİL çıplak `{row.priority}` ile yazılır (negatif değer `-5` gibi doğru görünsün diye). Her boş dizi kendi `EmptyState`'ini alır, üçü de AYNI metni PAYLAŞMAZ (`BreakdownTab`'ın per-section farklılaştırma deseni: "No cases in this window" / "No status data yet" / "No priority data yet" — FR-EK-B.1). **İZİN BAZLI GÖRÜNÜRLÜK (KK birebir):** `GET /reports/groups` için yeni `useReportGroups()` sorgusu (`ReportsPage` üst seviyesinde, `queryKey:['reports','groups']`); yalnız `GROUP_GATED_TABS = new Set(['cases','leads'])` bu yanıta göre süzülür (`visibleTabs`), MEVCUT dört sekme (Overview/AI Agent/Reviews/Breakdown) ve `staffing`/`topics` KOŞULSUZ kalır — yetki zaten backend'de `reports_read` scope'una (`/reports/cases`, `/reports/leads` 403) bağlı, UI gizleme ikinci bir uygulama katmanı DEĞİL (kod yorumunda not edilir); grup yanıtı gelene/hata verene kadar sekme GİZLİ kalır (fail-closed, fail-open değil — geçici yükleme durumuyla gerçek yetkisizlik bir an için aynı görünür, bu güvenli varsayılan). Sales/Team performance aynı kümeye 07.7-j'de eklenecek. Test: **yeni** 14 test `ReportsPage.test.tsx`'e ("Cases + Leads tabs, permission-gated visibility" describe'ı): sekmeler `/reports/groups` grant ederse render + doğru endpoint çağrısı · grant etmezse HİÇBİRİ render edilmez ("İzin bazlı görünürlük") · yalnız biri grant edilirse yalnız o render edilir · previous_period'den vs-previous delta ("benchmark comparison") · by_day/by_status/by_priority tabloları · her üç boş-durum metni ayrı ayrı + `<table>` YOK · Leads KPI + günlük tablo · Leads boş-durum · Cases 403/hata → `ErrorNotice`, çökme yok. (Not: `Kpi` etiketleri — "Open"/"Closed"/"Total"/"New leads" — alttaki tablonun sütun başlığıyla AYNI metni taşıdığı için ilk yazımda `kpi()` global `getByText` iki eşleşme buldu; `Volume` bölgesine scope'lu yeni `volumeKpi()` yardımcı fonksiyonuyla çözüldü — testler DIŞINDA gerçek UI'de sorun yok, iki metin farklı DOM bağlamında.) `apps/e2e/tests/reports.spec.ts`'e **+1** test ("opens the Cases and Leads tabs, each a permission-gated report group"): seeded demo agent `reports_read` taşıdığı için her iki sekme görünür ve açılabilir (görünürlük ucu; rakamların doğruluğu server-side `reports-billing.test.ts` "Cases report (07.7-a)"/"Leads report (07.7-b)"'de zaten kanıtlı, tam izin matrisi 07.7-l'nin işi). DoD TAM yeşil: typecheck 11/11 · lint 8/8 · `npx turbo run test --filter='!@nexa/e2e' --concurrency=1` 10/10 (web +14 yeni, api 1766/1766 değişmedi) · build 7/7 · `pnpm -w test:integration` 5/5 (1344/1344) · `pnpm -w test:e2e` tam koştu **77/77** (önceki bilinen `skills-routing.spec.ts:76` flake bu turda da yeşildi — regresyon yok). ****07.7-j (Reports UI — Sales + Team performance sekmeleri) teslim** (tm 93.10, SONNET-XHIGH): `ReportsPage.tsx` `TABS`'a `{id:'sales',label:'Sales'}` + `{id:'team-performance',label:'Team performance'}`; `GROUP_GATED_TABS`'a (07.7-i'nin hazırladığı mekanizma) `'sales'`/`'team-performance'` eklendi — set dört gruba çıktı, mekanizma kodu değişmedi. **Yeni** `SalesTab` — `useReport<ReportsSales>('sales', api, props)`; backend'in v1'de hep `configured:false` döndüğü (FR-MOD-13.5 bağımlılığı) tek dal `ReviewsTab`'in `ecommerce` bloğuyla birebir aynı desen: `configured:false` → 13.5'e işaret eden `EmptyState` ("Sales tracking not set up" / "...The Sales tracker (FR-MOD-13.5) is not available yet."), hiçbir `KpiGrid` render edilmez (sıfır rakam YOK, FR-EK-B.1); `configured:true` olursa (13.5 sonrası) Tracked sales/Attributed revenue/Conversions üç kartlı `KpiGrid`. **Yeni** `TeamPerformanceTab` + `TeamPerformanceTable` — `useReport<ReportsTeamPerformance>('team-performance', api, props)`; `BreakdownTab`'ın `by_agent` satır desenini chats/closed/automated/assisted/manual/avg first response/CSAT yedi sütununa genişletir — agent görünürlüğü/sıra/`LIMIT 20` backend'in `teamPerformanceByAgent`'ından gelir, burada yeniden uygulanmaz; CSAT `null` (kimse oy vermemiş) VE avg first response `null` (hiç ilk yanıt yok) satırları `formatRate`/`formatDuration` ÇAĞRILMADAN çıplak `'—'` (`%0`/`0s` DEĞİL); `agents.length===0` → "No agent activity in this window" anlamlı empty state. **DÜZELTME (test turunda bulundu):** ilk yazımda Sales `Section` açıklaması da "(FR-MOD-13.5)" taşıyordu — `EmptyState`'in kendi açıklamasıyla çakışıp `getByText(/FR-MOD-13.5/)` iki eşleşme buluyordu; KK zaten yalnız *empty state*'in 13.5'e işaret etmesini istiyordu, `Section` açıklaması "Sales attributed to supported conversations."a sadeleştirildi — regresyon değil, ilk turun kendi test hatasıydı. Test: `ReportsPage.test.tsx`'e **+10** ("Sales + Team performance tabs, permission-gated visibility"): grant/no-grant/kısmi-grant görünürlük (İzin bazlı görünürlük) · `configured:false` → empty state + '0' YOK · `configured:true` → üç KPI · ajan tablosu yedi alanı (çakışmasız değerlerle) · CSAT+avg-first-response `null` → aynı satırda iki `'—'`, `'0%'` YOK · 0 ajan → empty state · Sales/Team performance 403/hata ayrı ayrı → `ErrorNotice`. `apps/e2e/tests/reports.spec.ts`'e **+1** ("opens the Sales and Team performance tabs, each a permission-gated report group") — 07.7-i'nin Cases/Leads e2e'siyle birebir aynı desen, yalnız görünürlük ucu (rakamlar server-side `reports-billing.test.ts` "Sales report (07.7-d)"/"Team performance report (07.7-c)"'de zaten kanıtlı). DoD TAM yeşil: typecheck 11/11 · lint 8/8 · `npx turbo run test --filter='!@nexa/e2e' --concurrency=1` 10/10 (web 660/660 dahil +10 yeni, api 1766/1766 değişmedi) · build 7/7 · `pnpm -w test:integration` 5/5 (1344/1344) · `pnpm -w test:e2e` **tam koştu** 77/78 — tek kırmızı `skills-routing.spec.ts:76`, tm 77.4'ten beri HANDOFF'ta kayıtlı bilinen flake (Team skill kataloğu, FR-MOD-08.6.3, bu görevin sürdüğü Reports yüzeyiyle ilgisiz), izole koşuda (`-g` filtresiyle tek başına) yeşil — regresyon yok. **07.7-k (Reports UI — Export butonu + Save view çubuğu) teslim** (tm 93.11, SONNET-XHIGH): `Page` `actions`'a `ExportControl` — aktif sekmenin grubu için `GET /reports/export?group=<tab>&from&to&format=csv\|pdf` (format seçici + Export butonu); yeni `ApiClient.getFile()` (`api-client.ts`) `content-disposition`'daki dosya adını + blob'u birlikte döndürür (mevcut `getBlob` bunu yapmıyordu — BillingPage'in fatura indirmesi kendi sabit adını kullanıyordu; bu görev sunucunun adını KORUR, KAPSAM'ın "content-disposition adı korunur" şartı); indirme hata verirse (`ApiClientError`) mesaj görünür `role="alert"` olarak basılır, sessiz yutma YOK. Export, `/reports/groups` yanıtında (`visibleGroupIds`) olmayan sekme için hiç render edilmez — GROUP_GATED_TABS'ın dört sekmesiyle sınırlı tab-görünürlüğünden farklı olarak, Export görünürlüğü TÜM sekmelere (staffing hariç — `REPORT_GROUPS`'ta hiç yok) tekdüze uygulanır. **Save view çubuğu:** yeni `SavedViewsControl` (paylaşılan `Dropdown` primitifi) — 07.7-h'nin `useSavedReportViews()`'ini `onSelectSaved`/`onAddSavedView`/`onRemoveSavedView` kalıbıyla bağlar (Inbox `ViewsGroup` deseni, `InboxPage.tsx`); isim formu Inbox'ın elle disabled-check'i DEĞİL, T4-a paylaşılan form primitifi (`useForm`+`required`+`FieldError`) — boş ad alan-altı hata + submit pasif. **UYUMLULUK DÜZELTMESİ (bu görevde bulundu, KAPSAM dosya listesinde yoktu ama zorunluydu):** `report-views.ts`'in `ReportTabId`'si 07.7-h'de (07.7-i/-j'den ÖNCE) yazılmıştı ve yalnız altı sekmeyi taşıyordu — Cases/Leads/Sales/Team performance'ta kaydedilen bir görünüm `isSavedReportView`'da "bilinmeyen tab" olarak SESSİZCE düşerdi; `REPORT_TABS`/`ReportTabId` dört yeni sekmeyle genişletildi. **`baseline` KARARI:** sayfada henüz bir "Compare to" seçici YOK (§5.2.4 açık soru hâlâ kapanmadı — hangi UI'nin benchmark'ı göstereceği karara bağlanmadı, ve mevcut "vs previous"/"previous period" metinleri `previous_year` aktifken YALANLARDI); `baseline` state'i + kayıtlı görünümden restore edilmesi yine de TAM bağlandı (`TabProps.baseline`, staffing-forecast hariç dokuz rapor ucuna `&baseline=` — sunucu zaten destekliyordu, 07.7-e) ki (a) ileride seçici eklenince kablo hazır olsun, (b) kullanıcı bugün seçici olmadığı için `baseline`'ı hiç null'dan çıkaramaz — restore doğruluğu testte localStorage fixture'ıyla kanıtlanır, UI'den DEĞİL. Test: `ReportsPage.test.tsx` **58→66 (+8)** (Export görünürlük gated/ungated · CSV/PDF format aktarımı · başarısız indirmede görünür hata · boş ad alan-altı hata+submit pasif · kaydet→seç→tab/mode/customFrom/customTo TOPTAN geri gelir · restore edilen baseline rapor isteğine yansır · sil→liste küçülür) + `api-client.test.ts` **12→15 (+3)** (`getFile` dosya adı+blob döner · content-disposition yoksa filename null · hata tipi/mesajı sunucudan — `getBlob`'un jenerik mesajının aksine) + `report-views.test.ts` değişmedi (mevcut 13 test genişletilmiş `REPORT_TABS`'la da yeşil) → web 671/671. E2E `reports.spec.ts`'e **+1** ("exports the active tab as a CSV download, and a saved view survives a reload"): gerçek tarayıcı indirmesi (`page.waitForEvent('download')`) + sunucu dosya adı deseni (`nexa-overview-<from>-<to>.csv`) + TAM sayfa reload sonrası kayıt kalıcılığı. DoD TAM yeşil: typecheck 11/11 · lint 8/8 · `npx turbo run test --filter='!@nexa/e2e' --concurrency=1` 10/10 (api 1766/1766 değişmedi, web 671/671 dahil +11 yeni) · build 7/7 · `pnpm -w test:integration` 5/5 (1344/1344) · `pnpm -w test:e2e` **tam koştu 79/79** (önceki bilinen `skills-routing.spec.ts:76` flake bu turda da yeşildi — regresyon yok). **07.7-l (uçtan uca doğrulama — izin matrisi · cross-tenant süpürmesi · NFR-P7) teslim** (tm 93.12, OPUS-XHIGH), **kalem KAPANDI (12/12)**: (1) **İzin matrisi** — `reports-billing.test.ts`'e iki blok, `REPORT_GROUPS` katalogundan **tablo-güdümlü** (elle liste DEĞİL, onuncu grup eklendiğinde matris kendiliğinden genişler): dokuz grup × {`/reports/groups`, JSON uç, CSV export, PDF export} yetkili tarafta 200 + her grup `?baseline=previous_period` ile benchmark bloğu döndürür; `reports_read` YOKKEN katalog **boş liste + 200** (403 DEĞİL — NFR-S3 kararı dört yeni grupla birlikte yeniden kanıtlandı) ve dokuz JSON ucu + CSV + PDF hepsi 403 (`format` hiçbir şey vermez); komşu scope'la (`chats--all:rw`+`agents--all:rw`+`billing_manage`) da sıfır görünürlük. Katalog değişmezleri birim testte: her grubun **en az bir scope**'u var (`hasAnyScope(granted, [])===true` olduğu için scope'suz bir giriş herkese açık olurdu), id'ler tekil ve `/reports/<id>` ile `?group=<id>` arasında birebir aynı (encode gerektirmez) — `reports-export.test.ts` 24→27. (2) **Cross-tenant süpürmesi** — `tenant-isolation.test.ts`'e **ikinci, bağımsız** iki-lisanslı organizasyon (`Org SWEEP`; 07.7-b'nin `Org SIBLING`'i bilerek kullanılmadı): dört v2 grubu × {JSON builder, CSV tablosu, PDF baytları}; ajan adı izleyici (PDF sabit sütun genişliğinde eleme yaptığı için kısa ad + content-stream'den `(...) Tj` okuması), kardeş lisansın ajan adı/uuid'i hiçbir yüzeyde yok; Cases/Leads/Sales tablolarının **her hücresi** kapalı sözlük (tarih · sayı · null · sabit metrik adı) — §V3 'kimlik taşımaz' kararı hücre düzeyinde kilitlendi; naif org-geneli lead sayımı (3/3) yine reddedildi (2/1). 44 test (39→44). (3) **NFR-P7 kapısı** — ölçüm `EXPLAIN (ANALYZE)` ile alındı (leads_by_day **1.758 ms** · leads_total 0.013 · team_split 0.096 · team_ratings 0.010 · team_transfers 0.016; NFR-P2 okuma bütçesi 150 ms), ama asıl risk gecikme değil **sınırsız pencere**: NFR-P7'nin kendi cevabı (read-replica / kolon-tabanlı analitik depo) bu depoda altyapı sınırının dışında (§9), o yüzden **aralık üst sınırı** eklendi — `REPORT_MAX_RANGE_DAYS = 366` + `assertReportRange`, `resolveReportQuery` (dokuz JSON grubu) **ve** `/reports/export` (iki format) — rate-limit yerine aralık sınırı, çünkü limit sorgunun **ne sıklıkla** koştuğunu sınırlar, **ne kadar pahalı** olduğunu değil; ayrıca Redis durumuna bağlı olmadığı için deterministik ve test edilebilir. 365 değil 366: artık gün içeren on iki aylık pencere ile UI'nin en geniş preset'i (`PRESETS` 365) reddedilmemeli; staffing forecast kendi sınırını (`STAFFING_MAX_RANGE_DAYS`, artık aynı sayı) koruyor. Sözleşme: `openapi.yaml`'a paylaşılan `ReportRangeFrom`/`ReportRangeTo` parametreleri (sınır notu açıklamada) + `paths/reports.yaml`'daki 11 inline `from`/`to` çifti bunlara `$ref` — yeni path YOK, üretilen tip `string` kaldı (additive), re-bundle koştu, contract-parity 5/5. (4) **E2E tam akış** — `reports.spec.ts`'e +1: on sekmenin hepsi görünür → benchmark rozeti (`vs previous`) → CSV indirme → PDF indirme (format seçici) → Team performance'ta kaydedilen görünüm reload sonrası sekmeyi geri getirir. Web tarafında dört gated sekme için **süpürme** testi (`ReportsPage.test.tsx` 66→72): katalog boşken hiçbir gated sekme ve Export yok ama altı gated-olmayan sekme duruyor · her grubu tek başına verince yalnız o sekme çıkar · format seçici tam olarak `csv`/`pdf` sunar. DoD TAM yeşil: typecheck 11/11 · lint 8/8 · `npx turbo run test --filter='!@nexa/e2e' --concurrency=1` 10/10 (api 1766→**1791**, web 671→**677**) · build 7/7 · `pnpm -w test:integration` 5/5 (1344→**1366**) · `pnpm -w test:e2e` **80/80** (temiz seed'den tam koştu).

#### K07.9 — 07.9 · Zamanlanmış (scheduled) rapor export

✅ Yalnız PRD §5.3'te; FR-MOD-07.7 sadece "Export (CSV/PDF)" diyor, "zamanlanmış" ifadesi FR-MOD tablosunda YOK → ayrı kalem. KK-türetilmiş. **07.9-sched-a teslim** — veri katmanı: `ScheduledReport` (grup/sıklık/alıcı/enabled, `@@index([licenseId, enabled])`) + `ScheduledReportRun` (`@@unique([scheduledReportId, periodKey])` = dönem talebi/idempotens kilidi) — `apps/api/prisma/schema.prisma` · migration `apps/api/prisma/migrations/20260801090000_scheduled_reports/migration.sql` (her iki tabloda RLS + `nexa_current_license()` politikası; runs'a DELETE yok → `REVOKE DELETE` — varsayılan ayrıcalıklar aksi hâlde veriyor; CHECK'ler: frequency domain, boş-alıcı-yok, period_key şekli, run status, period aralığı; **composite FK** `(license_id, scheduled_report_id)` → RLS'in göremediği çapraz-kiracı dönem işgalini yapısal olarak engeller) · test integration `data-model.test.ts` "scheduled report exports"(10) + `tenant-isolation.test.ts` "scheduled report exports"(11) · tm 94.1. **07.9-sched-b teslim** — yazma scope'u + liste/oluştur yüzeyi: yeni `reports_manage` scope'u (`packages/types/src/scopes.ts`; `scopes.test.ts` `NEXA_ADDED_SCOPES` sayacı) yalnız `ADMIN_SCOPES`'ta (`apps/api/src/services/auth/principal.ts`) — `reports_read` salt-okunur kalır ve zamanlanmış tanım açamaz · kontrat `packages/contract/openapi/paths/reports.yaml#scheduledExports` (`listScheduledExports` + `createScheduledExport`) + `openapi.yaml` `ScheduledExport`/`ScheduledExportFrequency` şemaları + `/reports/scheduled-exports` path'i, `pnpm --filter @nexa/contract generate` ile re-bundle (`src/generated/api.ts`) · route `apps/api/src/routes/scheduled-reports.ts` (zod `.strict()`, GET+POST ikisi de `reports_manage` — liste alıcı posta kutularını taşıdığı için rapor okuma değil yönetim yüzeyi) · servis `apps/api/src/services/reports/scheduled-report-service.ts` (`reportGroup()` katalog doğrulaması → bilinmeyen grup 400; **alıcılar yalnız aynı lisansın askıya alınmamış ajan e-postaları** — citext'e uygun case-insensitive eşleşme, roster yazımıyla saklama, tekrarlar sadeleşir) · test `apps/api/test/integration/scheduled-reports.test.ts` (20) · tm 94.2. **07.9-sched-c teslim** — tek kayıt yaşam döngüsü: kontrat `paths/reports.yaml#scheduledExport` (`scheduledExportId` path param + `getScheduledExport`/`updateScheduledExport`/`deleteScheduledExport`) + `openapi.yaml`'a `/reports/scheduled-exports/{scheduledExportId}` path'i, `pnpm --filter @nexa/contract generate` ile re-bundle · route `apps/api/src/routes/scheduled-reports.ts` (GET/PATCH/DELETE, üçü de `reports_manage` — **by-id okuma da liste ile aynı DTO'yu, alıcı posta kutuları dâhil, döndürdüğü için `reports_read`'e açılmadı**; `updateBody` `createBody.shape`'ini yeniden kullanır + `.refine` "at least one field" → boş gövde 400) · servis `get`/`update`/`remove` (`update` **create'in doğrulamasını birebir tekrar uygular**: değişen grup `reportGroup()` kataloğuna, değişen alıcı listesi `resolveRecipients()` roster kapısına — aksi hâlde PATCH create'in kapattığı PII sızıntısını yeniden açardı; `remove` `deleteMany` + lisans filtresi, `scheduled_report_runs` composite FK cascade ile birlikte gider) · **başka lisansın id'si her fiilde 404, 403 değil** — varlık sızdırmaz · test `apps/api/test/integration/scheduled-reports.test.ts` (42; +22) · tm 94.3. **07.9-sched-d1 teslim** — teslim e-postasının biçimi: `apps/api/src/services/mail/mailer.ts`'teki `Message.kind` union'ına `'scheduled_report'` eklendi (yorumla neden ayrı: posta kutusu dosya adı `${stamp}-${kind}-...` teslimi diğer e-posta türlerinden ayırt eder) · yeni saf modül `apps/api/src/services/reports/scheduled-report-mail.ts` → `buildScheduledReportMail({ groupLabel, periodFrom, periodTo, csv, rowCount, filename })`: konu grup etiketi + UTC dönemi taşır, gövde dönemi/satır sayısını/dosya adını açıkça yazar ve CSV'yi gövdeye gömer (`FileMailer` düz metin yazdığı için MIME ek yok — mock teslimin dürüst şekli); 0 satırlık dönemde boş gövde yerine anlamlı "No rows for this period." cümlesi. Prisma/DB/HTTP dokunuşu yok, tamamen saf — DB'siz test. Test `apps/api/src/services/reports/scheduled-report-mail.test.ts` (3): dolu CSV'de konu+gövde alanları · satır sayısı çoğullaması · 0 satır → "no rows" cümlesi · tm 94.4. **07.9-sched-d2 teslim** — paylaşılan CSV üretimi: `buildGroupCsv` + onu besleyen tüm sorgu/yardımcı katmanı (`windowTotals`, `ticketCount`, `casesByDay/Status/Priority`, `leadFirstTouch`/`leadsByDay`/`leadTotals`, `satisfactionCounts/Score`, `csatSummary`, `satisfactionByDay`, `breakdownByDay/Hour/Channel/Team`, `transferCount`, `teamPerformanceByAgent`, `buildTopicsReport` (+ `clusterableDocs`/`centroidOf`), yedi `*Benchmark` fonksiyonu, `SPLIT_COUNTS`/`AGENT_EVENT`/`SKILL_RUN` — 27 export, davranış-değişmez taşıma) `apps/api/src/routes/reports.ts`'ten (3068→1608 satır) yeni `apps/api/src/services/reports/report-csv.ts`'e (1529 satır) çıkarıldı; dokuz grubun (overview/breakdown/ai-agent/reviews/topics/cases/leads/team-performance/sales) hepsi aynı fonksiyonlara bağlı kaldı — `routes/reports.ts` artık JSON rapor builder'ları + `/reports/export` için bunları geri import ediyor (`routes/ → services/` yönü korunuyor, ters bağımlılık yok; `tenant-isolation.test.ts`'in `buildGroupCsv` import'u da yeni yola taşındı, davranış değişmeden 53 test yeşil). Yeni test `apps/api/src/services/reports/report-csv.test.ts` (10): dokuz grubun başlık satırı + satır şekli (overview/ai-agent/sales = sabit `metric,value`; reviews/cases/leads/team-performance = gün/ajan başına satır; breakdown = saat ekseni dense 24 satır tabanı) + bilinmeyen grup → `validation` hatası · `reports-billing.test.ts` DEĞİŞTİRİLMEDEN yeşil kaldı (davranış-değişmezlik kanıtı) · tm 94.5. **07.9-sched-e teslim** — zamanlayıcı çekirdeği: yeni saf `apps/api/src/services/reports/scheduled-report-period.ts` → `periodFor(frequency, now)` her zaman ÖNCEKİ TAM dönemi verir (daily → dün `00:00:00.000Z`–`23:59:59.999Z`, weekly → geçen ISO haftası Pzt–Paz, monthly → geçen ay), hepsi UTC; anahtar YALNIZ sıklıktan türetilir (koşu anından asla — aksi hâlde iki sweep farklı anahtar üretir ve ikincisi aynı raporu tekrar postalar) ve `scheduled_report_runs_period_key_check` biçimlerine birebir uyar (`2026-08-07` / `2026-W31` / `2026-07`); ISO haftası **hafta-numaralama yılıyla** etiketlenir (`2026-W53` = 2026-12-28..2027-01-03; `2030-W01` = 2029-12-31..2030-01-06), takvim yılıyla değil — yoksa iki farklı hafta tek anahtara çakışırdı. `to` dönemin SON anı (kapalı aralık), çünkü rapor sorguları `>= from AND <= to` — dışlayıcı bir uç sınır satırını iki döneme birden yazardı · yeni `apps/api/src/services/reports/scheduled-report-sweeper.ts` → `ScheduledReportSweeper(db, mailer).run({ now })`: `retention_list_tenants()` ile tenant listesi + her tenant için `withTenant` (RLS çapraz-kiracı muhafızı — `chat-timeout.ts`/`retention.ts` deseni) → `enabled` tanımlar → **teslimden ÖNCE claim** (`scheduled_report_runs`'a `pending` INSERT; Prisma `P2002` = "bu dönem zaten alındı" → sessizce `skipped`, hata değil; INSERT'in KENDİSİ testtir — önce-oku-sonra-yaz iki sweep'in ikisini de göndermeye bırakırdı) → `buildGroupCsv` (-d2) + `toCsv` → `buildScheduledReportMail` (-d1) → alıcı başına AYRI `Mailer.send({ kind:'scheduled_report' })` → run satırı `sent`/`failed` + `rowCount`/`recipientCount`/sanitize edilmiş `error` ile kapanır, `last_run_at` yalnız başarıda ilerler. Claim **kendi transaction'ında** commit edilir (teslim hatasıyla birlikte geri alınsaydı dönem serbest kalırdı) ve başarısız satır SİLİNMEZ — dönem tüketilmiş sayılır (retry/backoff v1 dışı, varsayım #11) · testler: saf `apps/api/src/services/reports/scheduled-report-period.test.ts` (17 — gün/ay/yıl sınırı, artık yıl 29 Şubat, iki ISO-yıl sınır haftası, DB CHECK regex'i, `from < to`, dönem-içi determinizm, bilinmeyen sıklık) + `apps/api/test/integration/scheduled-reports-sweep.test.ts` (12 — uçtan uca teslim + run alanları + `last_run_at`, boş dönem de teslim edilir, çok alıcı, **ikinci sweep hiç göndermez** (1 posta / 1 satır / `skipped=1`), **eşzamanlı** iki sweep'te de tek teslim, mailer hatası → `failed` + `error` ve sonraki koşu yine göndermez, bir tanımın hatası aynı lisanstaki diğerini durdurmaz, **cross-tenant**: iki lisans kendi alıcısına kendi CSV'sini alır ve karşı tarafın ajan adını İÇERMEZ, `enabled=false` → ne posta ne run satırı (yeniden açılınca teslim edilir), üç sıklık üç ayrı dönem anahtarı) — claim bozulduğunda (P2002 → sahte id) idempotens testlerinin üçü kırmızıya döndü, testlerin boş geçmediği böyle doğrulandı · rota/kontrat/migration dokunuşu YOK (arka plan servisi; `contract-parity.test.ts` etkilenmedi) · tm 94.6. **07.9-sched-f teslim** — operatör betiği: yeni `apps/api/src/services/reports/scheduled-reports-run.ts` (`chat-timeout-run.ts`/`retention/run.ts` deseni: `loadEnvFile()` → `parseEnv()` → `new PrismaClient({datasourceUrl: env.runtimeDatabaseUrl})` → JSON rapor stdout'a / tek satır özet stderr'e / `finally`'de `$disconnect` / hata → `process.exitCode=1`) + `apps/api/package.json`'a `scheduled-reports:run` script'i. Sweeper'ın kendi `dryRun` parametresi YOK — claim (INSERT) teslimin tek-teslim garantisinin ta kendisi olduğu için "commit etmeden çalıştır" onu geçersiz kılardı; bu yüzden dry-run (varsayılan) sweeper'ı HİÇ çağırmaz — aynı `retention_list_tenants()` + `periodFor` ile hangi (enabled) tanımın hangi dönem için hazır olduğunu (`alreadyClaimed: false`) listeler, hiçbir claim/e-posta yazmaz; yalnız `--apply` gerçek `ScheduledReportSweeper.run()`'ı çağırıp teslim eder. Test: betik gerçek bir alt-süreç olarak (`pnpm --filter @nexa/api run scheduled-reports:run`, `chat topics — demo seed diversity` testindeki `execFile` deseni) çalıştırılıp dry-run'ın hiçbir yan etki bırakmadığı (posta kutusu boş, `scheduled_report_runs` satır sayısı sabit), `--apply`'ın rapor toplamlarının run tablosuyla birebir tutarlı teslim ettiği, betiğin kendi kurduğu `PrismaClient`'ın (RLS-bağlı runtime rolü) iki lisans arasında sızdırmadığı ve DB erişilemezken `exitCode=1` + boş posta kutusuyla çıktığı kanıtlandı — `apps/api/test/integration/scheduled-reports-sweep.test.ts` (+4, 16) · tm 94.7. **07.9-sched-g teslim** — teslim geçmişi okuması: kontrat `GET /reports/scheduled-exports/{id}/runs` (`reports.yaml` → `scheduledExportRuns` bloğu, `limit` query varsayılan 20 / üst sınır 100, aşılırsa 400 — sessiz clamp değil, çünkü kırpılmış sayfa tam geçmişten ayırt edilemez) + `openapi.yaml` components'e `ScheduledExportRun` şeması + `@nexa/types`'a `ScheduledExportRun`/`ScheduledExportRunStatus`; bundle+generated tipler yeniden üretildi. Route `reports_read` kapısında — tanım yüzeyinin `reports_manage`'ine karşın bilinçli olarak daha zayıf: bir run alıcı SAYISINI taşır, adresini asla; adresler tanımda kalır. Servis `runs()` önce tanımı `licenseId` ile arar (yok/başka lisans → 404, boş liste değil — "hiç çalışmadı" ile "böyle bir tanım yok" farklı olgular ve 404 varlık sızdırmaz), sonra `createdAt desc` (+`periodKey desc` eşitlik bozucu: claim `created_at`'i işlem saatiyle yazar) sıralı sayfa döner. DB'nin `sent` durumu tel üzerinde `delivered` olarak geçer — operatörün sweep raporu ve ayarlar ekranıyla tek kelime. — `packages/contract/openapi/paths/reports.yaml` · `packages/contract/openapi/openapi.yaml` · `packages/types/src/domain.ts` · `apps/api/src/routes/scheduled-reports.ts` · `apps/api/src/services/reports/scheduled-report-service.ts` · test `apps/api/test/integration/scheduled-reports.test.ts` (+16, 56; gerçek sweep sonrası `delivered`+`row_count`/`recipient_count` run satırıyla birebir, BrokenMailer ile `failed`+`error`, `reports_read` girer ama yanıt hiçbir posta kutusu içermez, reports scope'suz token 403, başka lisansın tanımı 404, `limit` 101/0/-1/2.5/all → 400, bilinmeyen query anahtarı → 400, sıralama ve varsayılan 20) · `contract-parity.test.ts` 5/5 yeşil · tm 94.8. **07.9-sched-h teslim** — Settings UI: sözleşme değişikliği yok, -g'nin ürettiği tipler + mevcut typed `ApiClient` tüketildi. Yeni `apps/web/src/features/settings/ScheduledExports.tsx` — `Section title="Scheduled exports"`, Ticket rules/Ticket email templates deseninin birebir kopyası (liste + `canEdit` altında oluşturma formu + satır başına aksiyon): (a) tanım listesi — rapor grubu etiketi (`/reports/groups` eşlemesi), sıklık, alıcı sayısı, satır başına `GET .../runs?limit=1`'den okunan son çalışma rozeti (`StatusDot` üç ton: delivered/failed/hiç çalışmadı); (b) boş durumda `title="No scheduled exports"` + anlamlı açıklama (boş dikdörtgen yok); (c) oluşturma formu — grup seçimi `/reports/groups`'tan (boş dönerse seçenek yok → `required` doğrulayıcı submit'i kilitli tutar, İzin bazlı görünürlük), sıklık seçici, alıcı çoklu seçim `/agents`'tan (checkbox grubu, en az biri seçilmeden submit pasif — T4-a form primitifi, alan-altı hata); (d) satır başına iki-adımlı onaylı iptal ("Cancel" → "Confirm cancel"/"Keep") → `DELETE /reports/scheduled-exports/{id}` + liste invalidate. Tanımın kendisi `reports_manage`'e kapalı olduğu için (-b/-c/-g'nin aynı gerekçesi) `canEdit=false` yalnız formu/aksiyonları gizler; API 403 verirse `list.error` → `ErrorNotice`. `SettingsPage.tsx`'e `canManageScheduledExports = scopes.includes('reports_manage')` + bileşen bağlama. Test `apps/web/src/features/settings/ScheduledExports.test.tsx` (8): boş durum · submit'in grup+alıcı ikisi de seçilene dek pasif kalması + alan-altı hata · boş `/reports/groups` → oluşturma kapalı · POST gövdesi · üç son-çalışma durumu · iki-adımlı iptal → DELETE + satır listeden kalkar · read-only görünüm · tm 94.9. **07.9-sched-i teslim** — zincirin uçtan uca kanıtı (yeni kod yolu YOK; bu alt-görev yalnız doğrular): `apps/api/test/integration/tenant-isolation.test.ts`'e "the whole chain, licence against licence" bloğu (+5, 58) — iki lisans tanımlarını KENDİ token'larıyla `POST /reports/scheduled-exports`'tan açar (owner-seed değil: saldırılan yol, satırı üreten yolla aynı olsun), tek `ScheduledReportSweeper` koşusu ikisini de teslim eder; sonra B'nin (`reports_manage`+`reports_read` taşıyan — yani yeterli, tek engeli lisans olan) token'ı A'nın tanımına BEŞ yüzeyden vurur: liste (200, A'nın id'si yok) · GET · PATCH · DELETE · `/runs` → dördü de **404**, 403 değil (403 "o id var" sızıntısı olurdu), ve girişimlerin hiç iz bırakmadığı sahip bağlantısından okunarak doğrulanır (alıcı listesi değişmemiş, run satırı duruyor, A kendi tanımını hâlâ 200 okuyor). Teslim izolasyonu posta kutusundan okunur: tam iki mesaj, her biri yalnız kendi lisansının ajanına; A'nın gövdesi `Agent a` + A'nın ajan id'sini İÇERİR, `Agent b`/B'nin id'sini İÇERMEZ (ve simetriği) — CSV gövdeye gömülü olduğu için okunan şey teslimatın kendisi. İkinci tracer B'nin tag'i: tag hiçbir rapor CSV'sine girmez (yalnız Overview JSON'ının `top_tags`'ında yaşar), bu yüzden önce B'nin Overview'ında gerçekten göründüğü + A'nınkinde görünmediği kanıtlanır (guard-the-guard), sonra A'nın teslimatında geçmediği. İdempotens regresyonu: `apps/api/test/integration/scheduled-reports-sweep.test.ts` (+2, 18) — `scheduled-reports:run` ÜÇ kez **ayrı süreç** olarak tetiklenir (dry-run → `--apply` → `--apply`; dry-run kasten ilk, çünkü aynı adayları okuyup dönemi kazara tüketmeye en yakın geçiş odur) → tek posta, tek `sent` satırı; ayrıca tanım devre dışı bırakılıp yeniden etkinleştirilse de aynı dönem ikinci kez teslim EDİLMEZ (`delivered:0 · skipped:1`). Testlerin boş geçmediği mutasyonla doğrulandı: claim'in `P2002 → null` dalı sahte id döndürecek şekilde bozulduğunda üç yeni idempotens iddiasının hepsi kırmızıya döndü; beş-yüzey testinde B'nin token'ı A'nınkiyle değiştirildiğinde test kırmızıya döndü (ikisi de geri alındı). E2E `apps/e2e/tests/settings.spec.ts` (+2, 18): admin akışı boş durum → grup+sıklık+alıcı (ikisi seçilene dek submit pasif) → POST 201 → satır (Weekly · 1 recipient · "Never run") → reload → iki adımlı iptal → DELETE 204 → boş duruma dönüş; ajan rolünde (`agent2@acme.localhost` — seed'in `agent1`'i **admin**, ADMIN_SCOPES taşır) bölüm ne liste ne aksiyon gösterir, `Could not load scheduled exports.` uyarısı görünür. DoD **tam sürüm** yeşil: typecheck 0 · lint 0 · unit api 1921 · integration 1466/61 dosya · build 0 · e2e 82/82 · tm 94.10. **tm 107 düzeltmesi** — bu satırdaki “betiğin kendi kurduğu `PrismaClient` iki lisans arasında sızdırmıyor” kanıtı yalnız 2026-08-08'de geçerliydi: betik alt-süreç olarak GERÇEK saati okur (`scheduled-reports-run.ts:158` `new Date()`), fixture ise sabit `IN_PERIOD`e (2026-08-07) yazıyordu; başka her takvim gününde rapor “No rows for this period” ile gelip iddia çöküyordu (2026-08-09'da ölçüldü). Betik blokunun fixture'ı artık gerçek saatten türetiliyor — `scriptPeriodAnchors`: önceki tam UTC gününün öğlesi + bir dakika öncesi; iki çapa, çünkü çocuk süreç tohumlamadan saniyeler sonra başlar ve arada UTC gece yarısı geçebilir. `--apply` testi ayrıca `rowCount: 1` doğruluyor (verisiz dönem de teslim edildiği için yalnız sayımlara bakan kardeş testler boş geçerdi), ve kuralın HER takvim gününde tuttuğu saf bir blokla kanıtlanıyor (gece yarısının iki yanı, ay/yıl sınırı, artık gün, UTC+3'te ertesi güne düşen an × 0-5 dk çocuk gecikmesi; mutasyonla boş geçmediği doğrulandı) · `apps/api/test/integration/scheduled-reports-sweep.test.ts` (+2, 20) · tm 107.

#### K08.5.7 — 08.5.7 · Instagram (DM)

✅ **İkili etiket çözüldü → v2.** Dayanak: PRD §11.1/7 _"Instagram/Telegram tam kanal: v2/Enterprise"_ + Telegram zaten Faz-3'te. Adaptör MOCK (08.5-adapter-a **teslim** tm 35). **08.5.7-a teslim** — kontrata `instagram` eklendi: `ChannelType` enum'ı (`packages/contract/openapi/openapi.yaml`), connect (`code`+`ig_user_id`, adres=ig_user_id) ve webhook gövde şekli (`recipient.id`=ig_user_id, `sender.id`=IGSID, `message.text`) `paths/channels.yaml`'da belgelendi, bundle + generated client regen edildi (yeni path yok, 148 path sabit) · test `contract-parity.test.ts` (5, regresyon kanıtı) · tm 65.1. **08.5.7-b teslim** — `InstagramAdapter` (Messenger deseni birebir): parseConnect `{code, ig_user_id, username?}` → `{address: ig_user_id, config: {ig_user_id, username?, ig_access_token}}` (`code` config'e yazılmaz), parseInbound `{recipient.id, sender.id/username?, message.text}` → normalize (externalId=IGSID), send → mock `aigid.<token>` — `apps/api/src/services/channels/instagram.ts` · test `apps/api/src/services/channels/adapters.test.ts` 'Instagram adapter (08.5.7)' describe (+6, dosya toplam 21) · tm 65.2. **08.5.7-c teslim** — `instagram` adapter kanalı olarak devreye alındı: `CHANNEL_TYPES` 3→4 (`apps/api/src/services/channels/channel-adapter.ts`) ve `ADAPTERS` kaydı (`registry.ts`) — bu ikisi `/channels/instagram/{connect,disconnect,messages,webhook}`'u açar; route katmanı jenerik olduğu için kod değişmedi. `InstagramAdapter` artık `implements ChannelAdapter`. Uçtan uca kanıt: `apps/api/test/integration/channels-adapters.test.ts` CASES dizisine instagram eklendi → mevcut altı senaryo (inbound→routed chat, dönen gönderici tek müşteri+chat, bilinmeyen adres 404, disconnect sonrası 404, outbound chat_id/external_id, scope+adresleme reddi) instagram için de koşuyor (+6) · instagram'a özgü `describe` (+2: registry doğru adaptöre bağlı — `aigid.` provider id + config'te `ig_user_id`/`ig_access_token`, `code` yok; username→customer.name) · cross-tenant (+1: iki tenant da instagram bağlıyken DM alıcı hesaba göre yönleniyor, B ne A'nın chat'ine yazabiliyor ne log'unu görebiliyor) — integration 1535→1544 · unit regresyon `adapters.test.ts` CHANNEL_TYPES sabiti + `telegram`/`website_widget` negatifleri, `reports-metrics.test.ts` `channelLabel('instagram')`. **08.5.7-d teslim** — kanal adresi artık tek bir çalışma alanına ait: **kısıt** `channels_connected_address_key` — `UNIQUE (type, (config->>'address')) WHERE status='connected' AND config->>'address' IS NOT NULL` (`apps/api/prisma/migrations/20260809090000_channel_address_uniqueness/migration.sql`; kısmi olması şart — disconnect satırı silmiyor, aksi halde adres kalıcı kilitlenirdi; seed'in `config={}` website_widget satırı da dışarıda) + `channel_address_owner(type,address)` SECURITY DEFINER (RLS başka tenant'ın kanalını gizlediği için yazma yolu çakışmayı başka türlü göremez). **Yazma yolu** `ChannelService.connect`: upsert ÖNCESİ sahiplik kontrolü — adres başka bir `(license, brand)` satırındaysa 400 `That channel address is already connected.` (hedef lisans/kimlik sızdırılmaz, NFR-S5); kontrol-sonra-yaz yarışını index kapatıyor, kaybeden `P2002` dalından AYNI 400'e dönüyor. **Okuma yolu** `resolveLicense`: `rows.length > 1` artık sessizce `rows[0]` değil — 500 + error-level log (kırık invaryant gürültülü olmalı). Prisma ifade/parça index'i modelleyemediği için `schema.prisma`'ya not + `scripts/check-drift.ts` KNOWN_UNMODELLABLE kaydı — `apps/api/src/services/channels/channel-service.ts` · test `apps/api/test/integration/channels-adapters.test.ts` 'channel address ownership' (+12: 4 kanalın hepsinde ret, sızıntı yok, reddedilen devralmadan sonra yönlendirme sabit, aynı lisansın 2. brand'i de ret, **servis atlanarak** yazılan satırı DB'nin reddi, eşzamanlı connect'te tek kazanan, disconnect sonrası devir + eski sahibin geri alamaması, kendi kanalını yeniden bağlama/taşıma, (type,address) kapsamı) · test `apps/api/src/services/channels/channel-service.test.ts` (yeni, +6: index yerindeyken API'den tetiklenemeyen iki dal — ön kontrolün YAZMADAN reddi ve yarış/P2002 dalı — stub client ile) · tm 65.4. **08.5.7-e teslim** — Settings → Channels'ta Instagram kartı sabit 'Coming soon'dan çıkarıldı: `channelsFor(websites, connectedChannels)` ikinci parametre alır (Website kartıyla birebir aynı türetilmiş-durum deseni), `ChannelsGrid` `canReadChannels(scopes)` (Inbox Views ile aynı kapı) arkasında `useConnectedChannels` ile `/channels`'ı okur — scope'suz ajanda istek hiç atılmaz. Bağlı değilken 'not_connected'+Connect (tetikleyince `lib/form.tsx useForm` ile `code`+`ig_user_id` mock-OAuth formu → `POST /channels/instagram/connect`, alan-altı hata + geçersizken submit pasif, başarıda `['channels']` invalidate); bağlıyken 'connected'+adres gösterimi+Disconnect (`window.confirm` sonrası `POST /channels/instagram/disconnect`) — `apps/web/src/features/settings/Channels.tsx` · test `apps/web/src/features/settings/channels.test.ts` (+4 yeni `describe`, 'built' kümesine instagram eklendi/telegram regresyonu yeşil) · test `apps/web/src/features/settings/Channels.test.tsx` (yeni, +4: connect formu boş/eksik `ig_user_id` alan-altı hata + submit pasif, dolu formda submit aktif, bağlı kart adres+Disconnect gösterir, onaysız disconnect göndermez) · tm 65.5. **08.5.7-f teslim** — kalan coming-soon kartlarının (telegram + gelecekteki her coming-soon) 'Get notified' tıklaması artık kalıcı: `Banner.tsx`'in `bannerDismissKey`/`readDismissed`/`persistDismissed` üçlüsü birebir taklit edildi — `channelNotifiedKey(channelId)` → `nexa.channels.notified.<channelId>`, `readNotified`/`persistNotified` aynı try/catch savunmasıyla (storage erişilemezse sessizce `false`'a düşer, patlamaz). `ChannelCardView`'daki `useState(false)` → `useState(() => readNotified(channel.id))` (lazy-init, kart `channel.id` ile keylendiği için remount'ta doğru id okunur); tıklama hem state'i hem storage'ı yazıyor. Backend'e dokunulmadı (kapsam dışı, görev metni gereği) — `apps/web/src/features/settings/Channels.tsx` · test `apps/web/src/features/settings/Channels.test.tsx` yeni `describe('Get notified — persistence')` (+4: tıkla→kalır, remount'ta kalır; iki kanal birbirini etkilemez; `getItem`/`setItem` fırlatınca patlamaz, o oturum için hâlâ doğru görünür) · e2e regresyon `settings.spec.ts:104` (whatsapp 'Get notified' oturum-içi görünürlüğü) yeşil kaldı · tm 65.6. **08.5.7-g teslim** — Inbox Views grubunda Instagram artık bilinen bir kanal: `ChannelViewType` birleşimine `'instagram'` eklendi, `CHANNEL_VIEW_META`'ya Settings → Channels kartıyla birebir aynı `{ label: 'Instagram', icon: '📷' }` girdisi eklendi, `isChannelViewType()` güncellendi — sabit rail sırası nesne anahtar sırasıyla korunuyor (Messenger → WhatsApp → SMS → Instagram, `connectedChannelViews` bu sırayı API'nin döndürdüğü sıradan bağımsız uyguluyor). Öncesinde bilinmeyen tip sessizce elendiği için instagram bağlansa bile Inbox Views'da hiç görünmüyordu ve tek kanal instagram ise `showChannelPromo()` yanlışlıkla `true` dönüyordu (02.1.4 KK ihlali) — `apps/web/src/features/inbox/views.ts` · test `apps/web/src/features/inbox/views.test.ts` (+2 yeni: bağlı instagram → tek satır + promo gizli, bağlı değil → satır yok; sabit sıra testi ayrıca dört kanalı da kapsayacak şekilde güncellendi — dosya toplam 19→21) · tm 65.7. **08.5.7-h teslim (kalem KAPANDI, 8/8 alt-görev)** — altı ayrı slice'ın (kontrat, adaptör, registry, adres sahipliği, Settings kartı, Views satırı) tek bir tarayıcıda buluştuğu uçtan uca kanıt: Settings → Channels'ta Instagram kartı Connect → mock OAuth modalı (`code`+`ig_user_id`, `ig_user_id` boşken submit pasif) → kart 'Connected' + adres okunur; **anonim** POST `/channels/instagram/webhook` (gerçek sağlayıcının yaptığı gibi — DB'ye yazma yok, token yok, yönlendiren tek şey adres) → Inbox'ta yeni chat: DM metni listede + transkriptte okunuyor, müşteri adı sender'ın IG kullanıcı adı; Views grubunda 'Instagram' satırı var ve `channel-promo` yok; Disconnect (confirm) → kart 'Not connected' VE rail'de satır gidip promo geri geliyor (02.1.4 aynası, tek yönlü latch değil). Negatif ön-koşul ayrı test: bağlı değilken promo var, Instagram satırı yok, kart 'Coming soon' DEĞİL 'Not connected'+Connect (08.5.7-e regresyon kapısı) — `apps/e2e/tests/instagram.spec.ts` (yeni, 2 test) · `apps/e2e/tests/fixtures.ts` `channelWebhook()` yardımcısı (public webhook'u sağlayıcı gibi POST eder) · `apps/e2e/tests/settings.spec.ts` 'channels' coming-soon iddiası gözden geçirildi (whatsapp/telegram kalan iki kanal; instagram kapsamı yeni spec'e taşındı) · e2e 88→90 yeşil · kanıt `apps/e2e/kanit/08.5.7-instagram-{connected,inbox,disconnected}.png` · tm 65.8. → §5.2

#### K08.6.3 — 08.6.3 · Skills-based routing + supervision/takeover

✅ Veri katmanı teslim (08.6.3-a): `expertise` + `agent_expertise` tabloları (license-scoped composite PK — Group deseni), RLS ENABLE + tenant policy + `nexa_app` GRANT, unique(license_id, slug), composite FK cascade, deterministik seed (3 uzmanlık/tenant + ajan atamaları). NOT: `skills` tablo adı zaten ADR-14 AI-Skill'e ait (farklı kavram) → uzmanlık modeli `expertise`/`agent_expertise` adıyla; migration timestamp Ağustos-2 uygulanmışların ardına (`20260803100000_agent_expertise`) — `apps/api/prisma/schema.prisma` · migration `20260803100000_agent_expertise` · seed `prisma/seed.ts` · test `data-model.test.ts` (+4: RLS+policy varlığı · unique(slug) idempotans · cross-tenant gizleme · FK cascade) · `tenant-isolation.test.ts` (+5: okuma izolasyonu · IDOR · iki WITH CHECK · cross-tenant delete) · drift temiz · tm 66.1. **◐ CRUD/atama API teslim (08.6.3-b):** kontrat-önce + rol-kapılı. İsim çakışması nedeniyle API yüzeyi `expertise` (`skill` DEĞİL — `skills`/`Skill` zaten ADR-14 AI-Skill'e ait). Kontrat: `settings.yaml` `expertise` (GET liste + POST) + `expertiseItem` (DELETE), `agents.yaml` `agentExpertise` (PUT /agents/{id}/expertise, `{expertise_ids:int[]}` TAM değiştirme/idempotent), `openapi.yaml` `Expertise` şeması + Agent'a katkısal `expertise[]`, yeniden bundle (121 path) + tip üretimi. Backend: `/settings/expertise` GET (scope `access_rules:ro/rw`) · POST/DELETE + PUT atama `minimumRole:'admin'` çift kapı (bot/agent-rol/scope reddi=403) + `withTenant`; yabancı/cross-tenant id → 404 (enumerable değil); slug ad'dan türetilir (unique(license,slug)), dup → `not_allowed` 403 (canned/tag ev-deseni). `serialiseAgent` artık `expertise[]` döner (GET /agents + atama yanıtı) — `packages/contract/openapi/paths/{settings,agents}.yaml` · `.../openapi.yaml` · `apps/api/src/routes/{settings,agents}.ts` · `packages/types/src/domain.ts` (`EXPERTISE_NAME_MAX_LENGTH`) · test `settings.test.ts` (+8 katalog: CRUD+slug+dup+scope/rol/bot reddi+cross-tenant) · `agents-expertise.test.ts` (13: idempotent/wholesale/empty-clear/dedupe/cascade + negatifler) · contract-parity iki yönlü yeşil (API integ 1024) · tm 66.2. **◐ ADR-08 routing çekirdeği teslim (08.6.3-c):** [OPUS-MAX bölünmez] skill/uzmanlık-eşleşmeli aday seçimi + kural koşuluna `expertise_ids` — kilitli ADR-08 zinciri BOZULMADAN. Kontrat: `RoutingRule.conditions`'a katkısal `expertise_ids:int64[]` + `routingRule` PATCH gövdesine `conditions` (yeniden bundle 121 path + tip üretimi). Backend: `routing-service.ts` — `#selectGroup` artık `{groupId, requiredExpertiseIds}` döner (eşleşen kuralın talebi), `route()` bunu hem birincil hem fallback takım seçimine taşır → uzmanlık HİÇBİR aşamada gevşemez (skill'li aday yoksa mevcut fallback→kuyruk zinciri işler); `#selectAgent`'a `agent_expertise` IN-**alt-sorgu** daraltıcısı (`HAVING COUNT(DISTINCT expertise_id)=n` = TÜM uzmanlıklara sahip/AND) — JOIN yerine alt-sorgu, aksi halde satır fan-out'u `COUNT(t.id)` kapasite sayımını bozardı; kilitli tie-break (priority→en az yüklü→`last_assigned_at`) ve transaction-içi yük tutarlılığı KORUNUR. `routes/settings.ts` — `updateRuleBody`'ye `conditions`+`expertise_ids` doğrulaması (tenant-içi id; yabancı/cross-tenant → 404 enumerable değil), jsonb'ye sayı olarak yazılır. **Varsayım:** kuyruğa düşen sohbet uzmanlık talebini taşımaz (thread kolonu + migration gerekir, -c kapsamı dışı) → uzmanlık BAŞLANGIÇ atamasını (`route()`) daraltır; kuyruk-boşaltma (`drainQueue`) takım-bazlı kalır. `expertise_ids` adı 66.1/66.2 ile tutarlı (`skill_ids` değil). — `apps/api/src/services/routing/routing-service.ts` · `apps/api/src/routes/settings.ts` · `packages/contract/openapi/{openapi.yaml,paths/settings.yaml}` · test `routing.test.ts` (+8: skill'siz-asla-seçilmez · yabancı-id-404 · geçerli-id-saklanır · TÜM-uzmanlık-AND · ADR-08-sıra-korunur · fallback'e-taşınır · cross-tenant-sızmaz · kapasite-limiti) · API integ 1032 · contract-parity iki yönlü yeşil · tm 66.3. **✅ Supervisor takeover çekirdeği teslim (08.6.3-d):** [OPUS-MAX bölünmez] rol-kısıtlı zorla devir — `transfer`'den AYRI yüzey (transfer=rızalı/scope'lu; takeover=admin+ rol-kapılı, audit'li). Kontrat: `chats.yaml` `takeover` (POST /chats/{chatId}/takeover, gövde `{reason?}`, 200 Chat/403/404/409) + `openapi.yaml` path kaydı + `ErrorType` enum'a `takeover_conflict` (yeniden bundle **122 path** + tip üretimi). Backend: `routes/chats.ts` scope `chats--all:rw` (supervisor katılımcı olmadığı sohbete erişir → unrestricted şart) + ÇİFT KAPI `principal.kind==='agent'` & `roleAtLeast(role,'admin')` (bot/agent-rol reddi=403, suspension deseni). `ChatService.takeover` (`withTenant` tek transaction): aktif thread'in mevcut assignee'si okunur → **KOŞULLU** `updateMany where {id, assigneeId: beklenen}` (0 satır → `takeover_conflict` 409; READ COMMITTED'de ikinci supervisor satır kilidinde bloke olur, WHERE'i commit'lenmiş yeni satıra karşı yeniden değerlendirir → eşleşmez, SELECT FOR UPDATE gerekmez); önceki assignee `ChatUser.present=false` (satır kalır — arşiv/denetim izi), supervisor upsert present=true; `system_event:'chat_taken_over'` (recipients=`agents`, internal); audit + RTM aynı transaction'da. Yeni tip `takeover_conflict`(409): `not_allowed`(403) DEĞİL (kaybeden yetkiliydi, yarışı kaybetti), `chat_inactive` DEĞİL (chat açık) — dar tip (`ticket_exists` idiyomu); `errors.ts` (ERROR_TYPES+ERROR_STATUS) + `scopes.test.ts` sayaç (24+7) + openapi enum. `AUDIT_ACTIONS`'a `chat.taken_over` (aktör+chat+previous_assignee, PII-minimal, mesaj içeriği YOK); `RTM_PUSH_ACTIONS`'a `chat_taken_over` + `ChatTakenOverPush` (audience=before∪after). **Varsayımlar:** `takeover_conflict` yeni tip (açık soru kararı); eşzamanlılık koşullu updateMany (satır kilidi değil); supervisor=roleAtLeast admin (ayrı rol yok, v2-04:141). — `packages/contract/openapi/{paths/chats.yaml,openapi.yaml}` · `packages/types/src/{errors.ts,rtm.ts}` · `apps/api/src/services/audit/audit-log.ts` · `apps/api/src/services/chat/chat-service.ts` · `apps/api/src/routes/chats.ts` · test `chats.test.ts` (+7 takeover: agent-rol/bot 403 · cross-tenant 404 · kapalı 409 chat_inactive · reassign+demote+system_event · eşzamanlı-kaybeden 409 takeover_conflict [held-lock deterministik] · iki-canlı-supervisor tek-kazanan) · `audit-log.test.ts` (+1 chat.taken_over: previous_assignee+reason, secret/transcript yok) · API integ **1040** · contract-parity iki yönlü yeşil · tm 66.4. **✅ Settings UI teslim (08.6.3-e):** [SONNET-XHIGH] Settings'e yeni `Skills` bölümü — katalog listesi (`GET /settings/expertise`), ekle (`POST`) ve sil (`DELETE`, optimistic + sunucu reddinde geri alma `optimisticCacheUpdate` ile), boş liste → anlamlı empty state ("No skills yet"), `canEdit=false` → salt-okunur (ekle/sil kontrolleri hiç render edilmez). Routing kuralı satırında `conditions.expertise_ids` artık ham id yerine skill adına çözülüyor: `RoutingRules` kendi `/settings/expertise` sorgusuyla (Skills bölümüyle aynı cache key, tek fetch) bir id→ad haritası kurup `describeConditions`'a geçiriyor; haritada olmayan id (silinmiş skill) `#<id>`'ye düşer, sessizce kaybolmaz; mevcut url/country koşul gösterimi ve fallback "Anything" metni değişmeden korunur (regresyon testiyle kanıtlı). UI etiketi kasıtlı olarak "Skills" — veri katmanı 66.1-66.3 ile tutarlı `expertise` adını korur, ADR-14'ün Playbook "Skill" kavramından ayrışır (openapi.yaml `Expertise` şemasının "ürün yüzeyi skill diyebilir" notuyla uyumlu). — `apps/web/src/features/settings/SettingsPage.tsx` · test `SettingsForms.test.tsx` (+2: ad zorunlu + alan-altı hata) · `Skills.test.tsx` (5: liste render + boş durum + POST trim + optimistic sil+sunucu-reddinde-geri-alma + salt-okunur) · `RoutingRules.test.tsx` (3: skill adı çözümü + url koşulu regresyonu + fallback "Anything") · web unit 542 · tm 66.5. **✅ Team UI teslim (08.6.3-f):** [SONNET-XHIGH] Team ekranında ajan satırından açılan skill atama yüzeyi — yeni `AgentSkills` bileşeni (feature-içi ayrı dosya, `InviteTeammates.tsx`'in Modal deseni): satırdaki tetikleyici buton ajanın mevcut skill adlarını gösterir (`aria-label="Manage skills for <ad>"`), açılınca `/settings/expertise` kataloğunu (Skills bölümüyle aynı `['settings','expertise']` cache key) çoklu checkbox listesi olarak render eder; ajanın mevcut `expertise[]`'i (08.6.3-b'nin `GET /agents` yanıtına eklediği alan — `TeamPage.tsx` `Agent` arayüzüne katkısal `expertise` eklendi) işaretli açılır. Kaydet → `PUT /agents/{agentId}/expertise` TAM `expertise_ids` gövdesiyle (idempotent tam-değiştirme, 08.6.3-b'nin kontratı — yeni sözleşme YOK), başarıda `['team','agents']` invalidasyonuyla satır güncellenir. Katalog boşsa "Settings → Skills'ten önce skill ekleyin" yönlendirmeli `EmptyState`; `canEdit=false` (mevcut `canManage`, roleAtLeast admin) → checkbox'lar disabled + Save butonu hiç render edilmez (yalnız Close) — kontrol GÖRÜNÜR ama salt-okunur (Suspend'in aksine sütun tamamen gizlenmez). Yeni `Skills` sütunu tüm rollere görünür (colSpan 6→7 / 5→6). — `apps/web/src/features/team/AgentSkills.tsx` · `apps/web/src/features/team/TeamPage.tsx` · test `AgentSkills.test.tsx` (4: mevcut skill işaretli açılır · değişen seçim `expertise_ids` ile PUT'lanır · boş katalog yönlendirmeli empty state · rol yetersiz→tüm kontroller disabled) · e2e `team.spec.ts` (+1: seeded owner'ın Billing'i işaretli diğerleri değil — mutasyonsuz görünürlük kanıtı) · web unit 546 · tm 66.6. **✅ Inbox UI teslim (08.6.3-g):** [SONNET-XHIGH] Sohbet detayında rol-kapılı "Take over" aksiyonu — `DetailsPanel`'in Assignee satırına, yalnız `admin`/`viceowner`/`owner` rolünde (`useAuth` — rotanın kendi `roleAtLeast(role,'admin')` kapısının aynısı) ve sohbet aktifken (`chat.active` — kapalıda 409 `chat_inactive` almamak için) görünen bir buton eklendi; tıklanınca onay modali mevcut atananın adını gösterir (`GET /agents` — Skills/Team ekranlarıyla aynı `['team','agents']` cache key, atanmamışsa "unassigned" kopyası, roster sorgusu bu durumda hiç tetiklenmez) → onayda `POST /chats/{chatId}/takeover` (08.6.3-d'nin ucu tüketilir, yeni sözleşme YOK). Başarıda `useChatAction`'ın mevcut `invalidate()`'i (chats+chat+events) çalışır ve modal kapanır; 403 (`authorization`) ve 409 (`takeover_conflict`) sunucunun kendi insan-okunur mesajını (`ApiClientError.message`) ayrı bir `Banner` (danger tonu) içinde gösterir — iki mesaj birbirinden farklı ve anlamlı (KK'nın şartı, sunucu metni yeniden yazılmadan `Brands.tsx`'in aynı `error instanceof ApiClientError` deseniyle). `useInbox.ts` `useChatAction`'a `takeover` mutation'ı eklendi (archive/reopen ile birebir desen). — `apps/web/src/features/inbox/DetailsPanel.tsx` · `apps/web/src/features/inbox/useInbox.ts` · test `DetailsPanel.test.tsx` (+9, negatif önce: agent rolünde buton yok · admin/viceowner/owner'da görünür · atanan ajanın adıyla onay metni + doğru endpoint çağrısı + başarıda kapanma · atanmamış sohbette düz metin + roster sorgusu atlanır · 403→yetki mesajı · 409→403'ten farklı çakışma mesajı · arşivlenmiş sohbette buton yok) · e2e `inbox-panel.spec.ts` (+1: gerçek owner oturumunda kontrol görünür + onay modali açılır, Cancel ile kapanır — mutasyonsuz kanıt, paylaşılan seed tenant'ı bozmadan) · web unit 555 · tm 66.7. **✅ Çoklu-ajan çakışma uyarısı gereksinimi audit-close (08.6.3-h):** [SONNET-XHIGH] Bu satırın istediği davranış — kendimden başka bir ajan aynı sohbetteyken uyarı banner'ı, o ajan ayrılınca kaybolma — PRD §5.3 satır 408'deki AYNI ibareden ("çoklu-ajan çakışma uyarısı") türeyen ayrı bir kırılımda (`08.6.3-conflict-a..g`, tm 91.1-91.7, bkz. bir alt satır `08.6.3-conflict`) zaten UÇTAN UCA teslim edilmiş halde bulundu: `apps/web/src/features/inbox/conflict.ts` (zustand store) + `ConflictBanner.tsx` (`role='status'`, `aria-live='polite'`, çakışma yoksa null) `InboxPage.tsx`'e monte edilmiş, RTM `agent_conflict_warning` push'uyla (composer-registry tabanlı, atomik Redis, tenant-RLS korumalı) canlı besleniyor. **Fark:** bu satırın orijinal kapsamı `ChatDetail.users[].present` alanına dayalı basit bir "sohbeti açık tutan ajan" türetmesi öngörüyordu; teslim edilen mekanizma onun yerine "aktif yazan ajan" (composing) sinyalini kullanıyor — PRD tümcesi tetikleme koşulunu belirtmiyor (facts.kk_yetersiz=true, iki kırılım da bağımsız KK-türetmesi), composing-tabanlı sinyal "aynı anda yanıt vermeyin" uyarısının amacına presence-tabanlıdan daha sadık (salt görüntüleme false-positive üretmez) ve zaten race-safe atomik tasarımla (OPUS-MAX çekirdek) teslim edilmiş; ikinci, çakışan bir banner mekanizması EKLEMEK kullanıcıya iki farklı "çakışma" anlamı gösterir ve gereksiz kod ikiliği yaratırdı — bu yüzden yeniden inşa edilmedi. Bu pencere: DoD kapısının tamamı mevcut kodla (değişiklik YOK) yeniden çalıştırılıp doğrulandı — `pnpm -w typecheck` ✓ `pnpm -w lint` ✓ web unit 555 ✓ (`conflict.test.ts` 5 dahil) · API unit 266 ✓ · RTM 90 ✓ (`conflict.test.ts`+`conflict-publisher.test.ts`+entegrasyon çakışma testleri dahil) · API integ 1040 ✓ · `pnpm -w build` ✓ · **E2E** (truncate+reseed ile temiz DB, `.env` source edilerek) `inbox-panel.spec.ts` ✓ (3/3 — "multi-agent composing conflict › a conflict banner appears while two agents reply to the same conversation at once" dahil, gerçek iki-ajan tarayıcı senaryosu). — tm 66.8. **✅ Uçtan uca doğrulama teslim (08.6.3-i):** [OPUS-XHIGH] yeni davranış YOK, kanıt: (1) yeni E2E `skills-routing.spec.ts` — Settings'te skill oluştur (UI) → Team'de plain-agent'a (agent2/Priya Nair) ata (UI, `PUT /agents/{id}/expertise`) → fallback kuralına `expertise_ids` talebi (API — kuralın tek düzenlenebilir yüzeyi, create-rule ekranı yok) → widget sohbeti YALNIZ skill'i taşıyan ajana düşer (`GET /chats/{id}` assignee=skilled) → owner (admin) tarayıcıda "Take over" onaylar → assignee owner'a değişir (chatId ile STABİL okuma: takeover son-olayı `chat_taken_over`'a çevirdiği için last_event.text değil id ile) + negatif E2E (agent rolünde "Take over" görünmez); paylaşılan seed tenant'ı `finally`'de temizlenir (kural geri yüklenir · skill silinir→composite-FK cascade atamayı düşürür · sohbet deactivate). (2) cross-tenant matris tek yerde toplandı `tenant-isolation.test.ts` (+2: skill-routing `agent_expertise` IN-alt-sorgu RLS altında boşalır · takeover koşullu assignee `updateMany` 0 satır + B thread değişmez) — skill CRUD + atama zaten aynı describe'da (5 test). (3) ADR-08 regresyon kapısı `routing.test.ts` (+1: skill'siz kural uzmanlığı TAMAMEN yok sayar — yüksek öncelikli generalist, skill tutan düşük öncelikli specialist'i yener → filtre no-skill yoluna sızmaz). (4) transfer↔takeover yüzey ayrımı `chats.test.ts` (+1: aynı agent-rol token transfer=200 · takeover=403 `authorization` — fark ROL kapısı, scope değil). DoD tam yeşil: `pnpm -w typecheck`+`lint`+`build` ✓ · API test **1310** ✓ (integ +4 dahil) · E2E `skills-routing.spec.ts` 2/2 ✓ (temiz DB, `.env` source). — `apps/e2e/tests/skills-routing.spec.ts` · `apps/api/test/integration/{tenant-isolation,routing,chats}.test.ts` · tm 66.9. **08.6.3 TAMAMLANDI (a→i).** → §5.2

#### K08.6.3-conflict — 08.6.3-conflict · Çoklu-ajan çakışma uyarısı

✅ FR-MOD-08.6.3'ün KK'sında **geçmiyor**; yalnız PRD §5.3'te → ayrı kalem + KK-türetilmiş. Aynı sohbette eşzamanlı iki ajan = yarış durumu. **08.6.3-conflict-a teslim** — davranışsız kontrat iskeleti: `RTM_PUSH_ACTIONS`'a `agent_conflict_warning` + `AgentConflictWarningPush` (`chat_id`, `thread_id`, `agents: [{agent_id, since}]`, `detected_at`) `IncomingEventPush` deseninde; `composerStateKey(licenseId, chatId)` + `AGENT_COMPOSING_TTL_SECONDS=8`, `typingStateKey`'in birebir license-scoped anahtar deseni — tespit mantığı/dispatcher kablolama/API/UI **yok** (-b..-g'nin işi) — `packages/types/src/rtm.ts` · `packages/types/src/realtime-bus.ts` · test `packages/types/src/realtime-bus.test.ts` (4: composer anahtarı license-izolasyonu + kararlılık + TTL pozitifliği + push action üyeliği) · tm 91.1. **08.6.3-conflict-b teslim** — `ConflictDetectionService` (atomik eşzamanlı-yazıcı kaydı + çakışma kararı, OPUS-MAX bölünmez çekirdek): (1) tenant-scoped RLS yetki okuması (`typing.ts` `canType` deseni birebir kopya) → erişimi olmayan ajan kayıt olamaz, yanıt 'chat yok'tan ayırt edilemez; (2) TEK atomik Redis Lua (`ZREMRANGEBYSCORE` prune + `ZADD` + `PEXPIRE` + `ZRANGE` geri-okuma, `rate-limit.ts` `script LOAD`/`evalsha`/NOSCRIPT deseni) `composerStateKey(licenseId, chatId)` altına yazar ve penceredeki tüm ajanları AYNI işlemde geri okur — check-then-act YOK → eşzamanlı iki kayıt altında çakışma kaybolmaz; (3) ≥2 farklı agent_id = çakışma kararı (`{agentId, since}`); (4) TTL (`AGENT_COMPOSING_TTL_SECONDS`, ctor'da enjekte edilebilir) dolunca kayıt kendiliğinden düşer (key PEXPIRE); (5) `is_typing=false` → atomik `ZREM`. Servis PUSH GÖNDERMEZ (yalnız karar; -c yayınlar) — `apps/rtm/src/conflict.ts` · test `apps/rtm/src/conflict.test.ts` (6, gerçek PG+Redis, negatif-önce: yetkisiz→boş küme + cross-tenant izolasyon RLS + atomiklik/`Promise.all` çakışma-kaybolmaz + tek-ajan idempotent + TTL self-drop + `is_typing=false` ZREM) · tm 91.2. **08.6.3-conflict-c teslim** — `send_typing_indicator` yolunda çakışma tespiti + uyarı yayını: (1) `ConflictPublisher` (RealtimePublisher'ın RTM tarafı eşi, gateway'in İLK yayınlayan tarafı) — `agent_conflict_warning` `BusEnvelope`'unu `licenseChannel`'a yayınlar; audience={agentIds: çakışan ajanların hepsi}, boş audience yayınlanmaz (fail-closed, `hasAudience` deseni), `originConnectionId` SETLENMEZ (fanout origin'i eler → çakışan HER İKİ ajan da alır), `thread_id` typing frame'inde taşınmadığından RLS-scoped `threads` okumasıyla sunucuda çözülür (chat görünmüyorsa null → yayın yok), publish best-effort (asla rethrow etmez — kayıp uyarı sonraki keystroke'ta yeniden yayınlanır); (2) dispatcher `#typing` genişletildi: `is_typing=true` → `ConflictDetectionService.record`, `decision.conflict` (≥2) ise `publish`; `is_typing=false` → kayıt silinir, yayın yok; blok kendi try/catch'inde — hiçbir 08.6.3 hatası 02.9 typing yanıtını bozmaz; (3) `server.ts` DI: ayrı `nexa-rtm-pub` Redis publish client + `ConflictDetectionService`(commands) + `ConflictPublisher`; Dispatcher deps opsiyonel tutuldu (`typing.test.ts` deps eklemeden yeşil kalır) — `apps/rtm/src/conflict-publisher.ts` · `apps/rtm/src/dispatcher.ts` · `apps/rtm/src/server.ts` · test `apps/rtm/src/conflict-publisher.test.ts` (4: envelope+audience şekli + boş-audience reddi + cross-tenant thread RLS izolasyonu + redis-hatası-yutulur) + `apps/rtm/test/integration/rtm.test.ts` (+5: iki-ajan çift `agent_conflict_warning` + tek-ajan 0 push + yetkisiz chat not_found + in-tenant audience izolasyonu + cross-tenant sızıntı yok) · tm 91.3. **08.6.3-conflict-d teslim** — Transfer/atama anında aktif yazıcı çakışması API tarafından uyarılır (OPUS-XHIGH): `chat-service.transfer` COMMIT sonrası `composerStateKey(licenseId, chatId)` **SALT OKUNUR** (`zrangebyscore` ile `AGENT_COMPOSING_TTL` penceresindeki ajan kümesi; -b'nin yazdığı sorted set, mutasyon yok) — yeni assignee `oldAssignee`'den farklıysa **ve** pencerede ≥1 başka ajan yazıyorsa `agent_conflict_warning` yayınlanır; audience = {yeni assignee ∪ yazan ajanlar} ∩ chat'in before+after audience'ı (`#audienceFor` kesişimi → chat'i görmeyen/başka-lisans ajan audience'a giremez, NFR-S4); team devri (assignee=null) ve aynı-ajana no-op devir uyarı üretmez; okuma+yayın best-effort try/catch — commit'lenmiş devir asla bozulmaz; `since`/`detected_at` ISO string (-c ile şekil paritesi). Yeni REST route/alan yok → contract-parity etkilenmez, migration yok — `apps/api/src/services/chat/chat-service.ts` · test `apps/api/test/integration/agent-conflict.test.ts` (5, gerçek PG+Redis, negatif-önce: yazan-yok→uyarı-yok + team-devri→uyarı-yok + registry-okuma-hatası devri bozmaz + fence: outsider/cross-tenant audience'a girmez + pozitif: iki-ajana çift audience + ISO payload) · tm 91.4. **08.6.3-conflict-e teslim** — İstemci çakışma state'i + `ConflictBanner` (salt görünüm, SONNET-XHIGH): (1) `conflict.ts` — `typing.ts`'in birebir deseninde zustand store, `byChat: Record<chatId, {agents: {agentId, since}[], detectedAt}>`; `note(chatId, agents, detectedAt)` <2 ajanda temizler (payload zaten çakışma değil), `clear(chatId)`; idle-lapse zamanlayıcısı `CONFLICT_IDLE_MS = AGENT_COMPOSING_TTL_SECONDS * 1000` — sunucunun composer-registry TTL'iyle aynı pencere, ayrı bir sabitle senkron kaybı riski yok. (2) `ConflictBanner.tsx` — `TypingIndicator.tsx` deseninde `role='status'` + `aria-live='polite'`; çakışma yoksa `null` (layout zıplamaz); "Bu sohbette N ajan aynı anda yazıyor" + `agent_id` listesi. Ağ çağrısı / push aboneliği YOK (-f'nin işi) — `apps/web/src/features/inbox/conflict.ts` · `apps/web/src/features/inbox/ConflictBanner.tsx` · test `conflict.test.ts` (5: kayıt+şekil, <2 ajan yok-sayılır, `clear`, idle-lapse, taze uyarı süreyi öteler) + `ConflictBanner.test.tsx` (5: null-yok, farklı chat'te null, iki ajan görünür, `clear` sonrası kaybolur, role/aria-live) · tm 91.5. **08.6.3-conflict-f teslim** — Realtime kablolama (SONNET-XHIGH): (1) `useInbox.ts` `pushes` listesine `agent_conflict_warning` eklendi; `applyPush`'a case eklendi — `incoming_typing_indicator` deseninde payload doğrulama (`chat_id` string + `agents` dizisi, her üye `{agent_id, since}` string + `detected_at` string; herhangi biri bozuksa push tamamen yok sayılır, çökmez) → `useConflictStore.note(chatId, agents, detectedAt)`; (2) `chat_deactivated` case'ine çakışma temizliği eklendi (`useConflictStore.clear`) — kapanan sohbet 'çakışıyor' kalamaz, `typing` store'daki mevcut davranışın aynısı; (3) `ConflictBanner`, `InboxPage.tsx`'te `TypingIndicator`'ın yanına monte edildi. `applyPush` test edilebilirlik için export edildi (push handler'a başka giriş yolu yok) — `apps/web/src/features/inbox/useInbox.ts` · `apps/web/src/features/inbox/InboxPage.tsx` · test `useInbox.test.tsx` (7: kayıt+şekil, chat_id/agents/agent-üyesi eksikse sessiz yok-sayma, boş payload çökmez, push→store→banner tam zincir, `chat_deactivated` temizler) · e2e `apps/e2e/tests/inbox-panel.spec.ts` (gerçek iki-ajan senaryosu: owner + seeded `agent1@acme.localhost`, aynı sohbete eşzamanlı yazma → RTM→ConflictDetectionService→ConflictPublisher→banner data-testid ile görünür) · tm 91.6. **08.6.3-conflict-g teslim** — uçtan uca doğrulama süiti (yeni davranış YOK, yalnız kanıt): (1) RTM tam yaşam döngüsü — iki ajan yazar → çift `agent_conflict_warning` → biri `is_typing=false` → kalan ajan tek başına yeniden yazınca **yeni uyarı gelmez** (çakışma sunucuda gerçekten temizlendi, istemci idle-timer'ına bağlı değil); (2) **şekil paritesi** — RTM'in yayınladığı gerçek frame, web `useInbox.applyPush`'un okuduğu alanlarla (`chat_id`·`agents[].agent_id`·`agents[].since`·`detected_at` string) birebir doğrulanır (+`thread_id` süperset) → iki taraf sessizce ayrışamaz (bu, -g'nin var oluş nedeni: başka hiçbir yer bunu doğrulamıyordu); (3) **02.9 dayanıklılık** — composer registry anahtarı WRONGTYPE ile bozulunca `send_typing_indicator` yine `success` döner, hayalet uyarı çıkmaz; (4) **cross-tenant ayna** — ikinci lisansın iki soketi aynı chatId ile akışı koşar → her ikisi `not_found`, 0 push, A'nın kendi çakışması etkilenmez. Devir uçtan-uca + cross-tenant + registry-hata dayanıklılığı zaten -d'de (`agent-conflict.test.ts`, 5 test). Tam DoD kapısı yeşil (typecheck+lint+unit+integration+build+e2e; API 1108 test · RTM çakışma 9 test · e2e 61 — banner spec dahil) — `apps/rtm/test/integration/rtm.test.ts` (conflict describe 5→9) · tm 91.7. **08.6.3-conflict TAMAMLANDI (a→g).** → §5.2

#### K08.8.3 — 08.8.3 · MCP server (search_tickets/list_chats/get_report/summarize_chat)

✅ Tool yüzeyi + OAuth scope bazlı yetki + tenant izolasyon. Scope altyapısı **teslim**. **08.8.3-a teslim** — MCP tool kataloğu, saf veri modülü: 4 tool descriptor (`name`/`title`/`description`/`inputSchema` zod + `inputJsonSchema` karşılığı/`requiredScopes`) `as const` dizi + `toolByName()`; `requiredScopes` mevcut route'lardan birebir kopyalandı (search_tickets/list_chats/summarize_chat → `--all:ro`/`--access:ro` çifti, get_report → `reports_read`) ve modül yüklenirken `isScope()` ile doğrulanıyor (yazım hatası kapısı). Route/kontrat/enforcement YOK — kapsam dışı, -b/-c'nin işi. — `apps/api/src/services/mcp/tool-catalog.ts` · test `tool-catalog.test.ts` (26) · tm 67.1. **08.8.3-b teslim** — MCP kontratı + keşif ucu: `paths/mcp.yaml#/manifest` (GET /mcp/manifest, yalnız `manifest` operasyonu) + openapi.yaml path ref + `McpToolDescriptor`/`McpManifest` şemaları + re-bundle & tip üretimi (123 path). Route `routes/mcp.ts` kimlikli (agent/bot default principal), scope YOK; statik tam katalog + server URL (`${API_BASE_URL}/api/v1/mcp`) + protokol sürümü döner. `public:true` KULLANILMADI, tenant verisi dönmez. Token'sız 401 · müşteri (nxc1.) token'ı 404 (principal-kind gate, 403 değil) · iki lisans birebir aynı katalogu görür, yanıtta license_id/organization_id yok. — `apps/api/src/routes/mcp.ts` · `packages/contract/openapi/paths/mcp.yaml` · test `apps/api/test/integration/mcp.test.ts` (6) · contract-parity iki yönlü yeşil · tm 67.2. **08.8.3-c teslim** — Tool-call yürütücüsü (bölünmez çekirdek): `POST /mcp/tools/{tool}` tek genel uç (kontrat `paths/mcp.yaml#/toolCall` + `McpToolCallRequest`/`McpToolCallResult` şemaları + re-bundle, 124 path). Çekirdek tek yerde toplanır: tool çözümleme (bilinmeyen VEYA henüz-bağlanmamış ad → 404, 403/400 değil — yüzey haritalatılmaz) → tool'un `requiredScopes`'una karşı scope gate (`authorizingScope`, `:rw⇒:ro`/`--all⇒--access` implication'lı; eksik → 403) → argüman doğrulama (tool `inputSchema` → 400) → yürütmenin TAMAMI `request.withTenant` içinde → `mcp.tool_called` audit (metadata `{tool, scope_used}`; argüman metni/PII YAZILMAZ) aynı tx'te. Referans tool `search_tickets` → `TicketService.list` (mevcut serbest metin `query` yolu). Salt-okunur → `allowWhenReadOnly:true` (read-only lisansta 402 değil, çalışır). Negatifler pozitiflerden ÖNCE: 401 (token'sız/revoked) · 404 (bilinmeyen tool / henüz bağlanmamış list_chats / müşteri nxc1. token'ı) · 403 (scope eksik) · 400 (eksik/bozuk argüman) · cross-tenant iki lisans (A yalnız kendi ticket'ını görür, B görünmez; yanıtta license_id/organization_id yok). Yeni scope/ApiError/migration YOK. — `apps/api/src/routes/mcp.ts` · `apps/api/src/services/mcp/tool-dispatch.ts` · `tools/search-tickets.ts` · `services/audit/audit-log.ts` (`mcp.tool_called`) · unit `tool-dispatch.test.ts` (9) · integration `apps/api/test/integration/mcp-tools.test.ts` (14) · contract-parity iki yönlü yeşil · tm 67.3. **08.8.3-d teslim** — `list_chats` tool adaptörü: dispatch tablosuna `list_chats` dalı. `ChatService.list`'in tx alan sorgu gövdesi `listChatsInTenant` olarak modül seviyesine çıkarıldı (Prisma transaction'lar iç içe açılamadığından — `search_tickets`'ın aksine `ChatService.list` kendi `withTenant`'ını açıyordu; executor artık `ctx.tx`'i doğrudan bu fonksiyona veriyor); `list()` artık ona ince bir sarmalayıcı, dış imza/davranış değişmedi (65 `chats.test.ts` regresyonu değişmeden yeşil). Sonuç zarfı `search_tickets`'la birebir aynı (`items`/`next_page_id`). Gate/tenant/audit ÇEKİRDEKTEN (08.8.3-c) aynen tüketildi — yeni hasAnyScope/withTenant YAZILMADI. — `apps/api/src/services/mcp/tools/list-chats.ts` · `apps/api/src/services/chat/chat-service.ts` (`listChatsInTenant` export) · `tool-dispatch.ts` (+1 dal) · test `apps/api/test/integration/mcp-tools.test.ts` (+11: 403 scope eksik, 400 geçersiz view/limit, pozitif liste, sayfalama `next_page_id`, cross-tenant izolasyon ×2, audit) · `tool-dispatch.test.ts` (+1 resolve testi) · tm 67.4. **08.8.3-e teslim** — `get_report` tool adaptörü: `reports.ts`'teki dört route'un (`overview`/`breakdown`/`ai-agent`/`reviews`) sorgu+yanıt gövdesi dışa aktarılabilir saf fonksiyonlara çıkarıldı (`buildOverviewReport`/`buildBreakdownReport`/`buildAiAgentReport`/`buildReviewsReport`) — route'lar artık bunları çağırıyor, davranış değişmedi (sorgu kodu KOPYALANMADI); `resolveRange` de dışa aktarıldı, aynı 30-gün varsayılan pencere ve `from>to` → 400 kuralı MCP tarafında da geçerli. Yeni `tools/get-report.ts`: `report` enum'una (overview/breakdown/ai-agent/reviews) göre dört builder'a dispatch, `ctx.tenant.licenseId` doğrudan geçirilir (tenant sınırı çekirdekten — `ctx.tx`'in RLS'i). `tool-dispatch.ts`'e `get_report` dalı eklendi. Regresyon: `reports-billing.test.ts` (100 test) + `reports-topics.test.ts` (21) değişmeden yeşil. — `apps/api/src/routes/reports.ts` (4 builder + `resolveRange` export) · `apps/api/src/services/mcp/tools/get-report.ts` · `tool-dispatch.ts` (+1 dal) · test `apps/api/test/integration/mcp-tools.test.ts` (+11: 403 scope eksik, 400 bilinmeyen enum/eksik argüman/ters tarih aralığı, dört enum pozitif, cross-tenant iki lisans farklı ticket sayısı — izole, sızıntı yok, audit `mcp.tool_called`) · `tool-dispatch.test.ts` (+1 resolve testi) · tm 67.5. **08.8.3-f teslim** — `summarize_chat` tool adaptörü + PII/CC-mask okuma-yolu sınırı: dispatch tablosuna `summarize_chat` dalı (dört tool'un tamamı bağlı). Yeni `tools/summarize-chat.ts`: görünürlük gate'i önce çalışır (`resolveVisibility` + `chatVisibilityFilter`, doğrudan `ctx.tx` üzerinde — `ChatService.get` ikinci, iç içe açılamayan `withTenant` açacağından) → erişilemez / ekip-dışı / başka lisansın (RLS görünmez kılar) chat'i → 404, asla 403 (kısa id enumerasyon oracle'ı olmaz, NFR-S5); sonra `copilot-service.ts:182 conversationTurns()` ile turn'ler okunur, `summariseConversation()` (deterministik, @nexa/ai-mock) ile özetlenir; İNTERNAL NOTE YAZILMAZ (salt-okunur — copilot summary route'unun yazma yolu değişmedi, hiçbir `events`/`skill_run` satırı eklenmez, varsayım 7); özet `cc-mask.ts maskCardNumbers()`'tan geçirilerek dönülür — yazma-anı maskesine ek okuma-yolu savunması, DB'ye herhangi bir yoldan ulaşmış ham PAN bir tool yanıtından çıkamaz (KK "PII/CC-mask sınırı"). `chat_id` argümanı kataloğa 08.8.3-a'da eklenmişti; yalnız `SummarizeChatArgs` tipi export edildi. Gate/tenant/audit ÇEKİRDEKTEN (08.8.3-c) aynen tüketildi — yeni scope/withTenant/migration YOK. Regresyon: `copilot.test.ts` (15) değişmeden yeşil. — `apps/api/src/services/mcp/tools/summarize-chat.ts` · `tool-dispatch.ts` (+1 dal) · `tool-catalog.ts` (`SummarizeChatArgs` export) · test `apps/api/test/integration/mcp-tools.test.ts` (+8: 403 scope eksik, 400 eksik chat_id, 404 yok chat, 404 başka lisans chat — tenant izole, pozitif özet, internal-note YAZILMADI/chat değişmedi, cross-tenant A-id-B-token, audit `mcp.tool_called`; −1 bayat "henüz bağlanmamış" testi) · `cc-masking.test.ts` (+1: transcript'te geçerli Luhn kart → tool yanıtında maskeli, ham PAN yok) · `tool-dispatch.test.ts` (summarize_chat resolve testi) · tm 67.6. **08.8.3-g teslim** — Settings → MCP bağlantı ekranı: `Integrations`'ın altına yeni `McpConnection` bölümü — manifest'i (`GET /mcp/manifest`, 08.8.3-b) `useQuery` ile okuyan salt-okunur bir Section/Card: (1) MCP server URL salt-okunur input + [Copy] düğmesi (panoya yazar, 1.5sn "Copied" geri bildirimi); (2) katlanır "Claude setup" bölümü (varsayılan kapalı, `aria-expanded` ile), adım adım bağlanma talimatı; (3) rapor-1'deki örnek prompt bloğu ("Find all tickets where customers ask about bulk orders"); (4) manifest.tools listesi salt-okunur + boşsa EmptyState ("No tools published yet"); manifest hatasında ErrorNotice. DOM'da hiçbir token/secret metni YOK (testle kanıtlandı). Yeni token/PAT üretme akışı YOK — mevcut PAT yüzeyi kullanılır (varsayım 8 korunur, yeni alt-rota açılmadı). — `apps/web/src/features/settings/McpConnection.tsx` · `SettingsPage.tsx` (Integrations altına eklendi) · test `McpConnection.test.tsx` (7) · e2e `apps/e2e/tests/settings.spec.ts` (+1: MCP bölümü görünürlük + URL/Copy/Claude-setup/örnek-prompt) · tm 67.7. **08.8.3-h teslim** — Uçtan uca MCP istemci akışı + rate-limit kapsaması + audit doğrulaması (KAYNAK KODU DEĞİŞİKLİĞİ YOK — doğrulama dilimi): yeni `mcp-e2e.test.ts` (8) tek PAT ile `GET /mcp/manifest` → dört tool'un sırayla çağrılması (search_tickets/list_chats/get_report/summarize_chat) → sonuç zarfları; iki lisanslı TAM-AKIŞ izolasyonu (karşı lisansın ticket/chat/organization kimliği hiçbir yanıt gövdesinde yok); dört başarılı çağrının tam olarak dört `mcp.tool_called` audit kaydı ürettiği (manifest GET audit'lenmez) ve metadata'nın yalnız `{tool, scope_used, request_id}` olduğu — argüman metni/PII (arama sorgusu, chat_id) sızmaz; `request_id` yazıcının kimlik-anahtarı filtresinden muaf, üniform korelasyon UUID'i, kullanıcı içeriği değil. **Rate-limit (açık soru 5 KARARI):** MCP uçları global rate-limit preHandler'ına ZATEN girmiş durumda (plugin server.ts:144'te route'lardan önce app seviyesinde kayıtlı) — GET manifest + POST tool call'ın ikisi de `X-RateLimit-*` başlıklarını taşıyor ve AYNI PAT (agent) kovasını tüketiyor; MCP'ye AYRI kova GEREKMEZ (`bucketFor` token'a göre anahtarlıyor → ardışık/otomatik LLM çağrı paterni normal otomatik PAT istemcisi gibi kısıtlanır) → düşük bütçeli sunucuda kova dolunca 429 + ADR-06 hata zarfı (`too_many_requests`) + `Retry-After`. Negatifler (önce): scope'u daraltılmış PAT ile yasak tool → 403 (akış ortasında, gate per-tool) · revoked PAT → 401. MCP path'lerine 429 response'u EKLENMEDİ (paylaşılan TooManyRequests bileşeninden gelir) → mcp.yaml/contract-parity DEĞİŞMEDİ. DoD tam yeşil: `pnpm -w typecheck` ✓ · `pnpm -w lint` ✓ · `pnpm -w build` ✓ · `@nexa/api test` **1402** ✓ (mcp-e2e +8, seri — vitest `fileParallelism:false`) — `apps/api/test/integration/mcp-e2e.test.ts` · tm 67.8. **08.8.3 TAMAMLANDI (a→h).** bölümü — (1) `GET /mcp/manifest`'ten (08.8.3-b) çekilen sunucu URL'i salt-okunur alanda + [Copy] düğmesi (panoya yazım, `WebsiteWidgets` kopyala desenini izler); (2) `aria-expanded` ile açılır/kapanır 'Claude setup' bölümü (kapalı başlar — `WebsiteWidgets`'ın "Get code" toggle deseni, `aria-expanded` testlenebilir olsun diye native `<details>` yerine bu tercih edildi) — adım adım bağlama talimatı; (3) rapor-1'deki örnek prompt ("Find all tickets where customers ask about bulk orders") salt-okunur blok; (4) manifest'in `tools` dizisi salt-okunur liste + boşken anlamlı empty state (`EmptyState`, boş dikdörtgen değil). Token/secret DOM'a hiçbir yoldan yazılmaz — ekran manifest'i olduğu gibi gösterir, üretmez (mevcut PAT yüzeyi korunur; varsayım 8 — yeni alt-rota yerine mevcut tek-sayfa Settings'e bölüm). — `apps/web/src/features/settings/McpConnection.tsx` · `SettingsPage.tsx` (+1 bölüm) · test `McpConnection.test.tsx` (7: URL+Copy panoya yazar, Claude setup toggle `aria-expanded`, örnek prompt render, tool listesi render, boş tool listesi empty-state, manifest hata → `ErrorNotice`, DOM'da token/secret metni yok) · e2e `settings.spec.ts` (+1: MCP bölümü görünür + dört KK parçası — URL/Copy/Claude setup toggle/örnek prompt) · tm 67.7. Kalan: -h (uçtan uca). → §5.2

#### K08.9.6 — 08.9.6 · IP allowlist / oturum güvenliği

✅ **Faz çelişkisi çözüldü → v2** (§D61). PRD §5.3 "Güvenlik" satırı bunu CC-masking/banned/spam ile **aynı v2 hücresinde** listeliyor; §1.1'e göre **fazı §5 belirler**, `Could (Ent.)` yalnız önceliktir. PLAN §6'dan taşındı (tm 80). **08.9.6-a teslim** — `security_settings`'e 3 sütun (`ip_allowlist_enforced`, `session_idle_timeout_seconds`, `max_concurrent_sessions`) + OpenAPI kontrat + `GET /settings/security` okuma yüzeyi; davranışsız iskelet, PATCH/enforcement yok — `apps/api/prisma/schema.prisma` · migration `20260727100000_session_policy_columns` · `apps/api/src/routes/settings.ts` · test `apps/api/test/integration/settings.test.ts` (+3) · tm 80.1. **08.9.6-b teslim** — `ip_allowlist_entries` normalize tablosu + RLS tenant politikası (`nexa_current_license()`) + `IpAllowlistEntry` Prisma modeli (License FK cascade, `@@unique([licenseId, entry])`, `@@index([licenseId])`) + OpenAPI `IpAllowlistEntry` şeması (yalnız şema, path YOK) — `apps/api/prisma/schema.prisma` · migration `20260801100000_ip_allowlist_entries` · `packages/contract/openapi/openapi.yaml` · test `apps/api/test/integration/tenant-isolation.test.ts` (RLS liste 10→11 + 4 negatif: cross-tenant SELECT/by-id + WITH CHECK reddi + UNIQUE reddi) · tm 80.2. **08.9.6-c teslim** — saf modül `lib/ip-allowlist.ts` (DB/route/hook YOK): `parseAllowlistEntry` (tekil IP/CIDR → canonical `{version, bytes, prefixLength}`, host bitleri maskeli; geçersiz prefix/adres/çift slash → null), `ipMatchesEntry` (bit-maskeli prefix üyeliği; IPv4-mapped `::ffff:a.b.c.d` `normaliseIp` ile düzleştirilir; v4↔v6 eşleşmez), `decideIpAccess` (boş liste = allow [self-lockout önlemi], dolu + eşleşme yok = deny, clientIp yok = deny), `wouldLockOut` (-d yazma tarafının çağıracağı öz-kilitleme kontrolü) — `apps/api/src/lib/ip-allowlist.ts` · test `apps/api/src/lib/ip-allowlist.test.ts` (23 unit; negatif-önce; regresyon kilitleri: boş liste=allow + clientIp yok=deny; /0 sınırı sabit) · tm 80.3. **08.9.6-d teslim** — `/settings/ip-allowlist` CRUD (GET/POST/DELETE) + self-lockout guard + audit + path kontratı: GET (`access_rules:ro|rw`, entry alfabetik) · POST (`access_rules:rw`, `parseAllowlistEntry`→400, canonical `formatAllowlistEntry` saklanır, unique çakışması→403, `wouldLockOut(request.ip, nextEntries)`→400 öz-kilitleme reddi) · DELETE (`access_rules:rw`, tenant-scoped deleteMany, cross-tenant→404 NFR-S5) · her yazımda aynı tx'te `writeAuditEntry` (`settings.ip_allowlist_added`/`_removed`, metadata=entry, ham IP metadata'ya yazılmaz) · yeni saf `formatAllowlistEntry` (RFC 5952 v6 sıkıştırma, canonical string) — `apps/api/src/routes/settings.ts` · `apps/api/src/lib/ip-allowlist.ts` (+format) · `apps/api/src/services/audit/audit-log.ts` (+2 action) · `packages/contract/openapi/paths/settings.yaml`+`openapi.yaml` (+2 path, re-bundle) · test `apps/api/test/integration/ip-allowlist.test.ts` (7; negatif-önce + cross-tenant + canonical + audit) + `lib/ip-allowlist.test.ts` (23→29) · tm 80.4. **08.9.6-e teslim** — IP allowlist enforcement, auth `onRequest` kapısı (principal-kind sonrası / scope öncesi): `principal.kind !== 'customer' && !config.public` iken lisansın `ip_allowlist_enforced` bayrağı + `ip_allowlist_entries` her istekte **taze** (cache YOK — license-gate gerekçesi) tenant-scoped okunur → `decideIpAccess({clientIp: request.ip, entries})` deny ise **`not_allowed` (403, mevcut tip; yeni hata tipi YOK)** · müşteri/widget **muaf** (o yüzey 08.9.2 ban-list) · public uçlar (login/authorize/token/revoke) **muaf** (kurtarma yolu açık kalır) · **trustProxy taklit yüzeyi kapatıldı**: `server.ts` `trustProxy: true`→`1` (tek güvenilen hop → proxy'nin eklediği **en-sağ** XFF girdisi kazanır; istemci-önekli adres `request.ip`'yi etkileyemez, allowlist tek başlıkla atlanamaz) · ret **`auth.ip_denied`** audit (target `token:<id>`, metadata `principal_kind`; **ham IP YOK** — NFR-C1/C2, `ip: null`) — `apps/api/src/plugins/auth.ts` · `apps/api/src/server.ts` · `apps/api/src/services/audit/audit-log.ts` (+1 action) · `apps/api/prisma/schema.prisma` (bayrak doc'u güncellendi) · test `apps/api/test/integration/ip-allowlist.test.ts` (+11 enforcement: negatif-önce + XFF-spoof + no-XFF-deny + cross-tenant + customer-muaf + public-muaf + audit-no-IP) + `route-config.test.ts` (+1 public kurtarma uçları) · tm 80.5. **08.9.6-f teslim** — `PATCH /settings/security`'ye üç katkısal alan yazma yüzeyi: `ip_allowlist_enforced: z.boolean().optional()` · `session_idle_timeout_seconds`/`max_concurrent_sessions`: `z.number().int().positive().max(<üst sınır>).nullable().optional()` (chat-timeout deseni; `.positive()` sıfır/negatifi reddeder, `null` = kapalı) · üst sınırlar: idle timeout 2.592.000 sn (30 gün, `CHAT_TIMEOUT_MAX_SECONDS` ile aynı) · concurrent sessions 25 (`MAX_ACTIVE_TOKENS_PER_OWNER`) · PATCH data bloğuna 3 katkısal spread satırı · mevcut `settings.security_updated` audit yazımı (yalnız değişen alan adları) davranışsız kaldı — testle doğrulandı · enforcement KAPSAM DIŞI (-g'nin işi) — `apps/api/src/routes/settings.ts` · `packages/contract/openapi/paths/settings.yaml`+`openapi.yaml` (re-bundle) · test `apps/api/test/integration/settings.test.ts` (+4: round-trip/null-kapatma, 8-değerli negatif tablo, audit-yalnız-değişen-alan, cross-tenant izolasyon) · tm 80.6. **08.9.6-g teslim** — oturum politikası enforcement (idle timeout + eşzamanlı oturum limiti); migration YOK / yeni hata tipi YOK (mevcut 401 authentication zarfı): (1) **idle timeout** `resolve()` içinde yalnız **oauth** için — lisansın `session_idle_timeout_seconds` doluysa `now - (lastUsedAt ?? createdAt) > timeout` token'ı **kalıcı revoke** edilip membership okumasıyla aynı transaction'da commit'lenir, ret `idle_expired` reason'ı loglanır ama istemciye ayrım verilmez ("expired≠unknown" gerekçesi korunur); PAT/bot **muaf** (uzun ömürlü kimlik, #pruneOldest ile aynı gerekçe). `touch()` fire-and-forget yarışı yorumla ele alındı — okunan değer daima önceki isteğin aktivitesi, karşılaştırma `lastActive`'de monoton → yarış **fail-closed**. (2) **eşzamanlı oturum limiti** `#pruneOldest` cap'i lisansın `max_concurrent_sessions` (null → `MAX_ACTIVE_TOKENS_PER_OWNER` 25) değerinden **kilitli transaction içinde** okur; PAT prune'dan muaf. Paralel `issue()` invariant'ı **`pg_advisory_xact_lock(hashtext('nexa.session-cap'), hashtext('<license>:<owner>'))`** ile korunur — `withTenant` READ COMMITTED olduğundan lock olmadan iki paralel basım birbirinin commit'lenmemiş satırını görmeden under-prune eder (lock kapalıyken 8 paralel → 6 canlı ile kanıtlandı, açıkken tam cap). `auth.ts` **değişmedi** (reason mevcut log yolundan akıyor) — `apps/api/src/services/auth/token-service.ts` (resolve idle + `#idleExpired` + `#pruneOldest` advisory lock/cap) · test `apps/api/test/integration/session-policies.test.ts` (12: negatif-önce idle/limit + PAT-muaf + null-regresyon + **paralel-invariant** + 2× cross-tenant) + helper `grantToken` (+lastUsedAt/createdAt) · tm 80.7. **08.9.6-h teslim** — Settings ekranına yeni `IpAllowlist.tsx` bileşeni: allowlist CRUD (GET/POST/DELETE `/settings/ip-allowlist`, queryKey `['settings','ip-allowlist']`, TrustedDomains deseni) + oturum politikası formu (`Enforce` anahtarı + idle timeout dakika→saniye + max concurrent sessions → PATCH `/settings/security`, paylaşılan `['settings','security']` cache'i günceller, BannedCustomerIps/FileSharing deseni) + self-lockout uyarı metni (Section açıklaması) + sunucu 400'ünün alan-altı gösterimi (`role="alert"`, hem ekleme hem policy save mutasyonunda) + kayıt yokken EmptyState + `canEdit=access_rules:rw` false iken hiçbir düzenleme formu render edilmez (salt-okunur özet metni gösterilir) — `apps/web/src/features/settings/IpAllowlist.tsx` · `apps/web/src/features/settings/SettingsPage.tsx` (render listesi + `SecuritySettings` arayüzüne 3 alan) · test `apps/web/src/features/settings/IpAllowlist.test.tsx` (9: liste + empty state + add + remove + self-lockout alert + policy PATCH + enforce toggle + policy-hata alert + canEdit=false) · tm 80.8. **08.9.6-i teslim** — uçtan uca doğrulama: (1) **E2E** allowlist CRUD (ekle → listede görünür → sil → boş durum; enforce KAPALI tutuldu ki oturum kendini kilitlemesin; loopback `127.0.0.0/8` girişi self-lockout guard'ı geçer çünkü tarayıcı→API IPv4 loopback'e düşer — çalıştırıldı, kanıt `kanit/80.9-ip-allowlist.png`) — `apps/e2e/tests/settings.spec.ts` (+1); (2) **audit okuma yolu** (RLS/app-role, gerçek konsol trail okuması): enforce açık + eşleşmeyen IP → 403 + `auth.ip_denied` girdisi ait olduğu tenant'a **RLS altında görünür**, karşı tenant'a **görünmez**, ne `ip` kolonu ne metadata ham adresi taşır (NFR-C1/C2) + **en-sağ XFF hop kabul** testi (spoof testinin aynası — `request.ip`'nin tek güvenilen hop'a sabitlendiğini uçtan uca kanıtlar) — `apps/api/test/integration/ip-allowlist.test.ts` (17→19); (3) **istek başına maliyet ölçüldü** (app-role/RLS, local PG, 2 koşu × 500): enforce-OFF ~1.1–1.2ms ort / p95 ~2ms · enforce-ON ~1.3–1.5ms ort / p95 ≤ ~2.5ms (BEGIN/set_config/COMMIT baskın; okumalar ihmal edilebilir) → **cache REDDEDİLDİ** (staleness penceresi = kaldırılan IP'yi TTL boyunca kabul eder = kısıtın kapatmak için var olduğu pencere; maliyet zaten bütçe içinde) — `apps/api/src/plugins/auth.ts` (maliyet yorumu gerçek ölçüme göre düzeltildi) · tm 80.9. **08.9.6 TAMAMLANDI (a→i)** — HANDOFF tm 80.9. → §5.2

#### K08.9.7 — 08.9.7 · Temel audit log — TÜM PLANLARDA + kullanıcıya görünür ekran

✅ FR-MOD satırı YOK; NFR-S12 birebir: _"Temel audit … **tüm planlarda**; genişletilmiş + SIEM Enterprise"_ + risk **R5**. Yazıcı teslim (tm 23, `services/audit/audit-log.ts`). **08.9.7-a teslim (okuma yüzeyi çekirdeği):** GET /audit-log — keyset sayfalama (created_at DESC, id DESC, base64url cursor), filtresiz varsayılan **son 30 gün** penceresi (mevcut `(license_id, created_at DESC)` indeksi, tam tablo taraması yok), limit **kırpılır** (reddedilmez); RLS tenant izolasyonu (ekstra license filtresi yok) + `audit_log--all:ro` scope + `minimumRole: admin` **çift kapı** — `packages/contract/openapi/paths/audit-log.yaml`+`openapi.yaml` (path + AuditLogEntry şeması + Audit tag, re-bundle) · `packages/types/src/scopes.ts` (SCOPES 64→65, scopes.test NEXA_ADDED 6→7) · `apps/api/src/services/auth/principal.ts` (ADMIN_SCOPES +1) · `apps/api/src/services/audit/audit-log-reader.ts` · `apps/api/src/routes/audit-log.ts` · `apps/api/src/server.ts` · test `apps/api/test/integration/audit-log-read.test.ts` (9: negatif-önce rol/scope kapısı + cross-tenant + 30 gün penceresi + keyset + clamp + şekil) + contract-parity yeşil · tm 92.1. **08.9.7-c teslim (webhook değişimi olayları):** AUDIT_ACTIONS'a `webhook.created` + `webhook.deleted` (kapalı sözlük); POST /webhooks & DELETE /webhooks/:id audit'i register/unregister ile **AYNI** `withTenant` tx'inde yazılıyor; `target=webhook:<id>`; `metadata` YALNIZ `{ action, type, url_host }` — tam URL + plaintext signing secret append-only log'a **düşmüyor** (silme öncesi RLS-scoped read ile host/tip alınır); silme yalnız `removed>0`'da kaydedilir (404 no-op + cross-tenant miss hiçbir entry yazmaz) — `apps/api/src/services/audit/audit-log.ts` · `apps/api/src/routes/webhooks.ts` · test `apps/api/src/services/audit/audit-log.test.ts` (+1: sözlük iki eylemi içeriyor) · `apps/api/test/integration/audit-log.test.ts` (+3: create host-only/secret-free · delete+404 · cross-tenant hiç yazmaz) · tm 92.3. **08.9.7-b teslim (liste filtreleri):** GET /audit-log'a katkısal `action`/`actor_id`/`date_from`/`date_to`; `action` verildiğinde `(license_id, action, created_at DESC)` indeksi kullanılır (customer-service.ts `#where` deseninde birleştirilen filtre listesi), `date_from`/`date_to` verilmezse 08.9.7-a'nın 30 günlük varsayılanı korunur, `date_from > date_to` → 400 (reports.ts `resolveRange` deseni) — `apps/api/src/services/audit/audit-log-reader.ts` (`buildWhere`) · `apps/api/src/routes/audit-log.ts` (`z.enum(AUDIT_ACTIONS)` + uuid) · `packages/contract/openapi/paths/audit-log.yaml` (re-bundle) · test `apps/api/test/integration/audit-log-read.test.ts` (+10: negatif-önce geçersiz action/date_from>date_to + action/actor_id/tarih daraltma + additive kombinasyon + cross-tenant filtre altında da izole + filtreli keyset sayfalama çakışmasız → dosya 7→17) · tm 92.2. **08.9.7-g teslim (retention penceresi — politika/env/rapor iskeleti):** `RetentionPolicy`'ye dördüncü pencere `auditDays` (mevcut threadDays/visitDays/mailDays deseni birebir); env `RETENTION_AUDIT_DAYS` (`z.coerce.number().int().positive().default(30)` — NFR-S12 "son 30 gün") + `.env.example`; `resolveCutoffs`'a `audit` cutoff'u (aynı `cutoffFor` tablo-silme guard'ı: pozitif olmayan pencere `RangeError`); `RetentionReport`'a `auditEntries` sayacı (bu adımda daima 0 — fiili silme yok, iskelet) — `apps/api/src/services/retention/policy.ts` · `apps/api/src/services/retention/retention.ts` · `apps/api/src/config/env.ts` · `.env.example` · test `apps/api/src/services/retention/policy.test.ts` (+3: dört pencere/audit guard/NFR-S12 varsayılan 30 pin) · `apps/api/test/integration/retention.test.ts` (POLICY literal + `auditEntries=0` skeleton assert) · tm 92.7. **08.9.7-d teslim (data.deleted + ayarlar ailesi hedefli silmelerinde audit):** AUDIT_ACTIONS'a kapalı sözlük eylemi `data.deleted`; beş hedefli silme ucunda (canned_response, tag — `settings.ts` içinde inline; custom_field, ticket_rule, ticket_email_template — servis katmanında `audit: AuditContext` parametresiyle) mevcut `withTenant(tx)` bloğu içinde ve yalnız `count > 0`'da `writeAuditEntry`; `target=<kind>:<id>`, `metadata` YALNIZ `{ kind }` — silinen kaydın adı/gövdesi/değeri asla yazılmaz — `apps/api/src/services/audit/audit-log.ts` · `apps/api/src/routes/settings.ts` · `apps/api/src/routes/custom-fields.ts` · `apps/api/src/routes/ticket-rules.ts` · `apps/api/src/routes/ticket-email-templates.ts` · `apps/api/src/services/custom-fields/custom-field-service.ts` · `apps/api/src/services/tickets/ticket-rule-service.ts` · `apps/api/src/services/tickets/ticket-email-template-service.ts` · test `apps/api/src/services/audit/audit-log.test.ts` (+1: sözlük `data.deleted` içeriyor) · `apps/api/test/integration/audit-log.test.ts` (+6: beş uç pozitif tam-1-entry + no-op-404 hiç yazmaz + cross-tenant hiçbir log'a düşmez) · tm 92.4. **08.9.7-e teslim (içerik ve entegrasyon silme uçlarında data.deleted):** 08.9.7-d'nin `data.deleted` eylemi beş içerik/entegrasyon silme ucuna uygulandı — DELETE /websites/:id, DELETE /skills/:id, DELETE /knowledge-sources/:id (AI-agent), DELETE /copilot/knowledge/:id, DELETE /settings/apps/:id — her biri kendi mevcut `withTenant(tx)` bloğu içinde ve yalnız silme gerçekleştiyse (`count > 0`) `writeAuditEntry`; `target=<kind>:<id>` (website / skill / knowledge_source / copilot_source / app_installation), `metadata` YALNIZ `{ kind }` — silinen kaydın adı/URL'i/içeriği asla yazılmaz — `apps/api/src/routes/websites.ts` · `apps/api/src/routes/playbook.ts` · `apps/api/src/routes/copilot.ts` · `apps/api/src/routes/apps.ts` · test `apps/api/test/integration/audit-log.test.ts` (+6: beş uç pozitif tam-1-entry + no-op-404 hiç yazmaz + cross-tenant hiçbir log'a düşmez) · tm 92.5. **08.9.7-f teslim (rol değişimi olayı — `PUT /agents/{agentId}/role` + `member.role_changed` audit'i):** 'Rol değişimi'ni kaydedebilmek için önce olayın kendisi gerekiyordu (depoda rol değiştiren uç yoktu); yeni `PUT /agents/{agentId}/role` contract-first eklendi (`paths/agents.yaml`+`openapi.yaml` kaydı, re-bundle → contract-parity yeşil). Route **çift kapı** `{ scopes: ['agents--all:rw'], minimumRole: 'admin' }` (auth plugin `minimumRole`'u = agent-principal + `roleAtLeast(role,'admin')`; `audit-log.ts` route deseni). Yetki tavanı OPUS-MAX bölünmez tek akıl yürütme olarak (suspension 161-231 deseninin rol için aynısı): kendi rolünü değiştiremez · owner'ın rolü değişmez (owner devri kapsam dışı) · **owner'a yükseltme reddedilir** (ikinci owner üretilmez — `nextRole==='owner'` guard'ı) · aktörün rolünü aşan hedef **ve** yeni rol reddedilir (`roleAtLeast(actorRole,…)` ikisi de) — hepsi 400 değil **403**; no-op (aynı rol) hiçbir entry yazmaz. AUDIT_ACTIONS'a kapalı sözlük `member.role_changed`; entry aynı `withTenant(tx)` içinde, `target=account:<id>`, `metadata` YALNIZ `{ from, to }` — üyeliğin geri kalanı asla yazılmaz — `apps/api/src/routes/agents.ts` · `apps/api/src/services/audit/audit-log.ts` (+1 action) · `packages/contract/openapi/paths/agents.yaml`+`openapi.yaml` (re-bundle) · test `apps/api/src/services/audit/audit-log.test.ts` (+1: sözlük `member.role_changed` içeriyor) · `apps/api/test/integration/agents-role.test.ts` (12: negatif-önce agent-rol/self/owner/owner-yükseltme/üst-rol-hedef/üst-rol-grant → 403 + cross-tenant 404 hiçbir log'a yazmaz + geçersiz rol 400 + no-op 200 entry-yok + pozitif agent→admin/admin→agent/owner→viceowner tam-1-entry, üyelik gerçekten değişti) · `apps/api/test/integration/audit-log.test.ts` (+1: KK birebir — admin agent→admin taşır, tam-1 `member.role_changed` {from,to} aktöre atfen + no-op tekrar yazmaz) · tm 92.6. **08.9.7-h teslim (append-only log'da 30-gün fiili budama — `audit_prune_expired` SECURITY DEFINER):** audit_log'da UPDATE/DELETE `nexa_app`'ten REVOKE'lu (migration 20260722154008) olduğundan 30-gün penceresi ancak `retention_list_tenants()` desenini izleyen dar bir SECURITY DEFINER fonksiyonla uygulanabildi: yeni migration `20260802090000_audit_retention_window` → `audit_prune_expired(p_license_id BIGINT, p_cutoff TIMESTAMPTZ) RETURNS BIGINT` (`LANGUAGE plpgsql`, `SET search_path=public,pg_temp`); YALNIZ `license_id = p_license_id AND created_at < p_cutoff` satırlarını siler + silinen sayıyı döndürür; `p_license_id`/`p_cutoff` NULL ya da `p_cutoff >= now()` → **exception** (tüm-tabloyu-silme yolu yok); `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO nexa_app` — tablo DELETE yetkisi **verilmedi**, mevcut REVOKE aynen duruyor. SECURITY DEFINER RLS'i atladığından tek cross-tenant savunma fonksiyon-içi lisans yüklemi (yaş yüklemi = tek anti-wipe guard). `RetentionRunner`'ın per-tenant döngüsüne bağlandı: dryRun RLS altında yalnız **sayar** (`#countAudit`, silme yolu yok), apply fonksiyonu `nexa_app` üzerinden çağırır (`#pruneAudit`); sonuç `data.retention_pruned` metadata'sına `audit_entries` olarak + `report.auditEntries` toplamına yazılır (iskeletin sabit 0'ı gerçek sayımla değişti; sadece audit budandıysa da entry yazılır) — `apps/api/prisma/migrations/20260802090000_audit_retention_window/migration.sql` · `apps/api/src/services/retention/retention.ts` · `apps/api/src/services/retention/run.ts` · test `apps/api/test/integration/retention.test.ts` (+8: **31-gün gider/29-gün kalır** KK · dryRun sayar-silmez · idempotent · metadata `audit_entries` · cross-tenant A≠B · NULL/now()/gelecek cutoff exception · `nexa_app` doğrudan DELETE edemez → 8→16) · `apps/api/test/integration/audit-log.test.ts` (+3: budama pencereye saygılı · wipe-cutoff reddi · tablo-DELETE revoke korunur; mevcut 'log cannot be rewritten' regresyonsuz → 32→35) · `db:check-drift` temiz (schema.prisma değişmedi) · tm 92.8. **08.9.7-i teslim (Audit Log ekranı — salt-okunur liste + boş/skeleton/hata + Settings girişi):** yeni `apps/web/src/features/audit/AuditLogPage.tsx` — `useQuery` + `api.get('/audit-log')` → tablo (Zaman/Eylem/Aktör/Hedef/IP, `VirtualTable` — CustomersPage deseni), `ListSkeleton` (yükleniyor), `EmptyState` (boş — dört olay kategorisini anan anlamlı metin, boş dikdörtgen değil), `ErrorNotice` (hata); RBAC istemci kapı `scopes.includes('audit_log--all:ro')` — `useQuery({ enabled })` ile scope yokken **hiç fetch atmıyor** (UI gizleme asıl kapı DEĞİL — gerçek kapı 08.9.7-a'daki route `scopes`+`minimumRole:admin`, bu yalnız kolaylık); `App.tsx`'e `/app/settings/audit-log` route'u (modül rayında değil, yalnız Settings girişinden erişilir — Apps/marketplace deseni); `SettingsPage.tsx`'e Integrations kartı deseninde `AuditLog()` giriş bölümü, scope yokken render EDİLMİYOR. `apps/web/src/lib/format.ts`'e `formatDateTime` eklendi (mevcut `formatDate` deseni birebir, ayrıca saat de gösterir — audit zaman damgası için gün tek başına yetersiz) — `apps/web/src/features/audit/AuditLogPage.tsx` · `apps/web/src/features/settings/SettingsPage.tsx` (`AuditLog` export) · `apps/web/src/App.tsx` · `apps/web/src/lib/format.ts` · test `apps/web/src/features/audit/AuditLogPage.test.tsx` (5: satır render eylem/aktör/hedef/IP/zaman · boş → EmptyState · yükleme → skeleton · hata → ErrorNotice · scope yokken fetch YOK) · `apps/web/src/features/settings/AuditLog.test.tsx` (2: link + scope yokken render yok) · `apps/web/src/lib/format.test.ts` (+1: formatDateTime) · tm 92.9. **08.9.7-j teslim (ekran filtreleri + 'daha fazla yükle' + e2e görünürlük):** `AuditLogPage.tsx`'e eylem seçici (`AUDIT_ACTIONS`'ı ayna tutan, ailelere gruplanmış `<optgroup>` listesi — Authentication/Team/Settings/Billing/Webhooks/Tickets/Credentials/Data, paylaşan paket olmadığından elle senkron) + tarih aralığı kontrolü (`From date`/`To date`, ReportsPage `RangeControls` deseni) + `useInfiniteQuery` ile `next_page_id` tabanlı 'Load more' (08.9.7-a'nın keyset cursor'ı `page_id` sorgu parametresi olarak); üç filtre de `useSearchParams` ile URL'e yazılıyor (Tickets grid sort deep-link deseni — 02.7-a) — mevcut yerel state yerine URL tek doğruluk kaynağı, filtre değişince yeni sorgu anahtarı sayfalamayı kendiliğinden sıfırlıyor. Varsayılan 'son 30 gün' penceresi statik açıklama metninde kalıyor (filtre boşken hiçbir `date_from`/`date_to` gönderilmiyor — sunucu varsayımı korunur) — `apps/web/src/features/audit/AuditLogPage.tsx` · test `apps/web/src/features/audit/AuditLogPage.test.tsx` (11: mevcut 5 + negatif-önce next_page_id yokken 'Load more' yok · 'Load more' ikinci sayfayı ekliyor + page_id gönderiyor · eylem filtresi action parametresiyle listeyi daraltıyor · özel tarih aralığı varsayılan 30 günü geçersiz kılıyor · filtre URL'e yazılıp reload'da korunuyor) · e2e `apps/e2e/tests/settings.spec.ts` (+1: owner girişi → Settings → Audit log → kendi `auth.login` kaydı görünür) · tm 92.10. **08.9.7-k teslim (NFR-S12 uçtan uca doğrulama — dört olay + 30 gün + tüm planlarda):** tek süitte KK'nın her maddesi ayrı ayrı koda karşı kanıtlandı — (1) login → rol değişimi → webhook oluştur+sil → hedefli veri silme; dördü de tek `GET /audit-log` okumasında doğru eylem adlarıyla (`auth.login` · `member.role_changed` · `webhook.created`+`webhook.deleted` · `data.deleted`); (2) 31-gün satır `audit_prune_expired` budaması sonrası okumada YOK, 29-gün VAR (budama+okuma birlikte, "son 30 gün"); (3) deneme (`trialing`) ve ücretli (`plan=enterprise`,`status=active`) iki lisansta audit hem YAZIMDA hem OKUMADA aynı — plan/tier kapısı hiç kurulmadığı **testle** kanıtlandı (kaldırılacak kapı yoktu); (4) çapraz-kiracı: B'nin dört olayının hiçbiri A'nın okumasında yok, B kendi okumasında hepsini görür; (5) e2e ekran: owner girişi (mevcut) + webhook değişimi Audit log ekranında görünür (action filtresiyle server-taraflı) — test `apps/api/test/integration/audit-log.test.ts` (+4: dört-olay-tek-okuma · trial/paid yazım paritesi · çapraz-kiracı dört-olay · budama+okuma 30-gün → 35→39) · `apps/api/test/integration/audit-log-read.test.ts` (+1: reader plan-agnostik trial/paid okuma paritesi → 17→18) · `apps/e2e/tests/settings.spec.ts` (+1: webhook değişimi audit ekranında; helper `ownerAccessToken` PKCE) · tm 92.11. **Slice tamam (11/11 alt-görev):** temel audit TÜM PLANLARDA + kullanıcıya görünür ekran teslim ve uçtan uca doğrulandı. **Kapsam dışı (ayrı kalem):** Enterprise 'genişletilmiş saklama + SIEM' — entitlement mekanizması repoda yok. → §5.2

#### K09.3 — 09.3 · API istek paketleri (Essential/Pro/Pro+)

✅ 09.3-a statik katalog **teslim** — `packages/types/src/api-packages.ts` · test `api-packages.test.ts` (4) · tm 71.1. **09.3-b teslim** — satın alma kaydının veri katmanı: `ApiPackagePurchase` (license_id · package_id · api_calls · price_cents · period yyyymm · purchased_at, `@@index([licenseId, period])`, License'a `onDelete: Cascade`) — `apps/api/prisma/schema.prisma` · migration `apps/api/prisma/migrations/20260809100000_api_package_purchases/migration.sql` (RLS + `api_package_purchases_tenant` politikası `nexa_current_license()` ile; **satış kaydı append-only** → `GRANT SELECT, INSERT` + `REVOKE UPDATE, DELETE` — varsayılan ayrıcalıklar aksi hâlde veriyor, audit_log deseni: kayıt tek kanıt, düzenlenebilirse kesilmiş fatura sessizce ucuzlatılır; CHECK'ler: period `^\d{6}$` = usage_records ile ortak birleştirme anahtarı, api_calls > 0, price_cents >= 0 — negatif fiyat iade demek, iade `included`'ı harcanmışın altına düşürür; `package_id` kod-içi kataloğu adlandırdığı için FK/CHECK YOK — `scheduled_reports.group_id` deseni) · test integration `data-model.test.ts` "api package purchases"(10 — çapraz-kiracı okuma/yazma, append-only reddi, politika+grant+index varlığı, CHECK'ler, cascade) · tm 71.2. **09.3-c teslim** — okuma yüzeyi: `GET /billing/api-packages` (katalog `@nexa/types` API_PACKAGE_CATALOG'dan, tenant sorgusu yok — fiyat kime sorulduğuna göre değişmez) + `GET /billing/api-packages/purchases` (`request.withTenant`, `purchasedAt desc`; kota/fiyat satırdan okunur, kataloğdan yeniden türetilmez — sonraki fiyat değişimi kesilmiş faturayı yeniden yazamaz; `name` kataloğdan join, kataloğdan düşmüş pakette `null` — satır kaybolmaz). İkisi de `BILLING_READ_SCOPES` (`billing_manage`/`billing_admin`/`reports_read`) — `packages/contract/openapi/paths/reports.yaml` (`apiPackages`/`apiPackagePurchases`) · `packages/contract/openapi/openapi.yaml` (`ApiPackage` + `ApiPackagePurchase` şemaları + iki path) · `apps/api/src/routes/reports.ts` · test integration `reports-billing.test.ts` "API packages"(10 — scope'suz token 403 ×2 ve çapraz-kiracı sızıntı NEGATİFLERİ önce, katalog `@nexa/types` ile birebir, boş geçmiş `[]` (404 değil), satılan fiyatın korunması, kataloğu terk etmiş paket, newest-first) + `contract-parity.test.ts` (iki yönlü, 5/5) · tm 71.3. **09.3-d teslim** — satın alma çekirdeği: `POST /billing/api-packages` (`BILLING_WRITE_SCOPES` + `allowWhenReadOnly: true` — kapasitesi biten lisans tam da satın alması gereken lisanstır, subscription PATCH / payment-method PUT ile aynı gerekçe zinciri; `reports_read` fiyatı görür, para harcayamaz) → tek `withTenant` transaction'ında makbuz + kota: `apps/api/src/services/billing/api-package-service.ts` (`purchaseApiPackage` katalog id'sini doğrular — bilinmeyen `not_found`/404, yeni ApiError tipi YOK; kota/fiyat satış anında kataloğdan kopyalanır; `creditApiCallQuota` **atomik upsert**: `ON CONFLICT (license_id, metric, period) DO UPDATE SET included = usage_records.included + <kota>` — `EXCLUDED.included` yazılsaydı ikinci satın alma birinciyi sessizce siler; INSERT dalı `included = env varsayılanı + kota`, yalnız kota yazılsaydı dönemin ilk çağrısından önce alan lisans plan kotasını kaybederdi; `quantity`'ye DOKUNMAZ — `recordApiCall` `quantity`'yi, satın alma `included`'ı sahiplenir, ikisi de diğerini okumaz) · `apps/api/src/routes/reports.ts` (POST + `serialiseApiPackagePurchase` GET geçmişiyle ortak — aynı satır iki yerde farklı anlatılamaz) · `packages/contract/openapi/paths/reports.yaml` (`apiPackages.post`) + `openapi.yaml` (`ApiPackagePurchaseResult` = makbuz + satın alma SONRASI usage, aynı transaction'da geri okunur) · audit `billing.api_package_purchased` (`AUDIT_ACTIONS`'a eklendi — satın alma satırında aktör yok) · test integration `reports-billing.test.ts` "API packages — buying one (09.3-d)"(16 — NEGATİFLER önce: scope'suz 403, `reports_read` 403, bilinmeyen paket 404 + sıfır yan etki, bozuk gövde 400 ×3; ÇAPRAZ-KİRACI: A'nın satın alması B'nin `included`'ını oynatmıyor; YARIŞ ×3 gerçek DB'de `nexa_app` rolüyle — satın alma önce / meter önce / 12 paralel çağrı ∥ satın alma, üçünde de `included = plan + kota` ve `quantity = N`; iki satın alma üst üste biner; kota artışı `GET /billing/usage`'da overage'ı sıfırlar; makbuz + usage yanıtı; geçmişte görünür; satır değişmez; audit girdisi; read-only lisansta 200; kart yok/istenmiyor ADR-13) + `contract-parity.test.ts` (iki yönlü, 5/5) · tm 71.4. **09.3-e teslim (2026-08-09):** `buildInvoices()` artık dönem başına `api_package_purchases`'ı okuyup her satın alma için ayrı bir line_item üretiyor (`API package — <ad> (<kota> calls)`, tutar/kota KAYITTAN — kataloğdan yeniden türetilmiyor, `serialiseApiPackagePurchase`'ın aynı disiplini: bir sonraki fiyat değişimi kesilmiş satırı yeniden yazamaz; `name` yalnız görüntü için kataloğdan join, kataloğdan düşmüş paket id'ye düşer). Mevcut seat+overage hesabı DEĞİŞMEDİ, paket satırları listeye EKLENDİ (`total_cents === subtotal_cents === satırların toplamı` korunuyor). Trial döneminde plan satırı yine ücretsiz kalıyor ama satın alma ayrı bir gerçek satır olarak görünüyor — `POST /billing/api-packages` trial gate'i hiç bloklamıyor (`allowWhenReadOnly`), yani trialken de gerçekleşebilen bir harcamayı "her şey $0" satırının içinde gizlemek yanlış olurdu. CSV indirme (`invoiceCsvRows`) yeni satırı kod değişmeden kendiliğinden taşıyor; kontrat değişmedi (`Invoice.line_items` zaten dizi) — `apps/api/src/services/billing/invoice-service.ts` · test `reports-billing.test.ts` "a bought API package, as its own line item (09.3-e)" (5 — satın alma sonrası satır+toplam · satın alma-yok regresyon · CSV · trial'da ayrı harcama · çapraz-kiracı negatif) · `typecheck`/`lint`/`build` exit 0 · `pnpm -w test` 2134/2134 (+5) · `pnpm -w test:integration` 1597/1597 (+5) · e2e 90/90 (billing.spec.ts dahil, regresyon) · tm 71.5. **09.3-f teslim (2026-08-10):** `BillingPage.tsx`'e `ApiPackagesSection` — `GET /billing/api-packages` katalogunu üç kart olarak gösterir (ad/kota/fiyat, `formatCount`/`formatMoney`, `AppsMarketplace.tsx` kart-gridi + `PaymentMethodSection` useQuery/useMutation/invalidate deseni), kart başına 'Buy' → inline onay adımı → 'Confirm purchase' `POST /billing/api-packages`; başarıda `['billing','usage']` + `['billing','invoices']` + `['billing','api-packages','purchases']` (09.3-g'nin gelecekteki listesi için, henüz kimse okumuyor) invalidate edilir — yanıttaki `usage` alanı `UsageSummary` (sayfanın okuduğu `Usage`'dan dar, `quota_warning`/`period_label` yok), bu yüzden yerel yama yerine yeniden okuma tercih edildi; hata → `Banner tone="danger"` (bileşende `tone="error"` yok) + sayaç değişmez; katalog `isPending` → `CardSkeleton`, boş katalog → anlamlı empty state; kart etiketi kasıtlı olarak "calls" (sadece "API calls" değil) — üç kart + "API calls" bölüm başlığı aynı metni paylaşırsa `findByText` testleri yalnız zamanlamayla (katalog henüz mount olmadan) geçiyordu, gerçek çakışma; buton read-only lisansta HİÇ gate'lenmiyor (backend `allowWhenReadOnly`, 09.3-d ile hizalı, KK-5) — `apps/web/src/features/billing/BillingPage.tsx` · test `BillingPage.test.tsx` "API packages (FR-MOD-09.3)" (5 — üç kart ad/kota/fiyat · boş katalog empty state · satın alma → POST + usage yeniden-okuma · hata → banner + sayaç sabit · read-only'de buton etkin) · `typecheck`/`lint`/`build` exit 0 · `pnpm -w test` yeşil — `@nexa/web` 798/798 (793'ten +5), `@nexa/api` 2134/2134 (değişmedi) · `pnpm -w test:integration` 1597/1597 (değişmedi, backend dokunulmadı) · e2e 90/90 (billing.spec.ts dahil, regresyon) · tm 71.6. **09.3-g teslim (2026-08-10):** `BillingPage.tsx`'e `ApiPackagePurchasesSection` — `GET /billing/api-packages/purchases`'ı okuyup tarih/paket adı/kota/tutar sütunlu bir tabloda listeler (`InvoicesSection`'ın satır 992-1091'deki tablo deseni birebir: `formatDate`/`formatCount`/`formatMoney`); sunucu zaten `purchasedAt desc` döndürdüğü için istemci yeniden sıralamaz, sunucu sırasını olduğu gibi render eder; satın alma yokken boş dikdörtgen değil anlamlı empty state metni (FR-EK-B.1); `isPending` → `CardSkeleton`, hata → `ErrorNotice`. `['billing','api-packages','purchases']` sorgu anahtarı 09.3-f'de zaten satın alma başarısında invalidate ediliyordu (o turda tüketicisiz) — bu turda ilk tüketicisi oldu, ayrı bir değişiklik gerekmedi. `ApiPackagesSection`'ın hemen altına, `PaymentMethodSection`'dan önce yerleşti — `apps/web/src/features/billing/BillingPage.tsx` · test `BillingPage.test.tsx` "API package purchase history (FR-MOD-09.3)" (3 — tarih/ad/kota/tutar + sunucu sırası korunur · boş liste → anlamlı empty state · satın alma sonrası liste invalidate olup yeni satır görünüyor, mock `opts` çağrı-anında okunarak POST'un DB'ye yazdığını simüle eder) · `typecheck`/`lint`/`build` exit 0 · `pnpm -w test` yeşil — `@nexa/web` 801/801 (798'den +3) · tm 71.7. **09.3-h teslim (2026-08-10) — KALEM KAPANDI (8/8):** `apps/e2e/tests/billing.spec.ts`'e tek senaryo (`buys an API package: the quota rises and the purchase reaches history and the invoice`) — ekrandan Essential satın alınır (kartın kendi onay adımı, kart çekilmez ADR-13) ve satın almanın görünmesi GEREKEN üç yer aynı oturumda okunur: (1) `api-overage-terms` cümlesindeki `included` figürü tam paketin kotası kadar artmış, (2) `api-package-purchase-row` bir satır artmış ve yeni satır ad/kota/fiyatı taşıyor, (3) açık dönemin faturasında `API package — Essential (100000 calls)` satır kalemi var ve `invoice-total` tam paket fiyatı kadar oynamış. Alt süitlerin **yapısal olarak** kuramadığı iddia buydu: integration `included` artışını ve fatura satırını ayrı ayrı kanıtlıyordu, bileşen testleri her bölümün kendi endpoint'ini render ettiğini kanıtlıyordu — "ödeme mock, kota artışı gerçek" cümlesi ise bir bölümdeki tıklamayla üç başka bölümün yeniden okuduğu figürler arasında duruyor. Üç iddia da **delta** olarak yazıldı (satın alma kalıcı bir kayıt — seed idempotent olduğu için kendini geri alamaz; mutlak rakama bağlanan bir test reseed'siz ikinci koşuda, önceki koşunun yükselttiği kotada kırmızıya düşerdi, oysa nedensellik iddiası deltayla korunur), figürler **ayraç-bağımsız** karşılaştırılıyor (`digitsOf` — sayfa `Intl` ile biçimliyor, `$29.99`/`29,99 $` aynı 2999 sent; ayraçları sabitleyen bir test ICU verisini test eder) ve kota/toplam `expect.poll` ile okunuyor (satın alma sorguyu invalidate ediyor, figür refetch'le geliyor). **Üçüncü iddia için ekranda yüzey yoktu:** 09.3-e'nin fatura satır kalemi yalnız indirilen CSV'de görünüyordu, `InvoicesSection` satırda sadece toplamı gösteriyordu — `BillingPage.tsx`'e satır başına `line_items` dökümü (`data-testid="invoice-line-items"`, açıklama + `formatMoney`, `description`+index ile key'lenir: aynı dönemde aynı paketten iki satın alma iki özdeş açıklama üretir) + `data-testid="invoice-total"` eklendi; bu yalnız test kancası değil — toplamı $29.99 oynatan bir satın almanın "neden" sorusu aksi hâlde ekrandan ayrılmadan yanıtlanamıyordu. `apps/api/prisma/seed.ts` **dokunulmadı** (delta disiplini deterministik başlangıç ihtiyacını ortadan kaldırdı; seed idempotent kalır) — `apps/e2e/tests/billing.spec.ts` · `apps/web/src/features/billing/BillingPage.tsx` · test `apps/web/src/features/billing/BillingPage.test.tsx` (+1: fatura satırı line_items dökümü, paket satırı + toplam = satırların toplamı) · kanıt `apps/e2e/kanit/09.3-api-package-purchased.png` · DoD tam yeşil: `typecheck` **0** (11/11) · `lint` **0** (8/8) · `pnpm -w test` **0** (`@nexa/web` 802/802, 801'den +1 · `@nexa/api` 2134/2134) · `pnpm -w test:integration` **0** (1597/1597, 66 dosya) · `build` **0** (7/7) · e2e `billing.spec.ts` **3/3** (yeni senaryo + mevcut checkout/trial regresyonsuz) + `demo-flow.spec.ts` **3/3** (Billing sayfasına giren diğer tek süit) · tm 71.8.

Kalan: yok — 8/8 alt-görev teslim, kalem kapandı (ADR-13 Stripe MOCK — gerçek ödeme yok, kota artışı gerçek ve uçtan uca kanıtlı). Kapsam dışı bırakılanlar (ayrı kalem olur): otomatik yenilenen paket aboneliği · iade/iptal ile kota geri alma · dönem devri (rollover) · idempotency anahtarı. → §5.2

#### K09.4 — 09.4 · Zapier/Make + Build-your-app (partner/creator)

✅ **09.4-a teslim** — `packages/types/src/apps.ts` APP_CATALOG'a iki yeni DATA app: `zapier` (productivity/oauth, `dataLabel`/`dataFields` "Active zaps"/"Last zap run") ve `make` (productivity/api_key, "Active scenarios"/"Last run") — desen mevcut `slack`/`jira` girdilerinden birebir kopyalandı, kart açıklaması partner portalına gönderme yapar (metin; gerçek link 09.4-e'de). Katalog sınırı 20 → 22'ye yükseltildi (09.2'nin v1 15–20 listesi + 09.4'ün iki otomasyon kartı) — `packages/types/src/apps.test.ts` (üst sınır iddiası + yeni "lists Zapier and Make" testi) ve `apps/api/test/integration/apps.test.ts` (aynı sınır + `GET /settings/apps` yanıtında iki kart, ikisi de `installed: false`) güncellendi. `apps/web` `AppsMarketplace.test.tsx` regresyonsuz yeşil kaldı (grid kataloğu türetir, kod değişmedi). Kalan 6 alt-görev (09.4-b…g: manifest, partner app kaydı çekirdeği, secret rotate+audit, developer portal, Zapier REST Hooks yüzeyi, uçtan uca doğrulama) açık — tm 72.1. **09.4-b teslim** — entegrasyon manifesti: `packages/types/src/integrations.ts` (yeni) — `INTEGRATION_TRIGGERS` (WEBHOOK_ACTIONS'ın beş aksiyonunun her biri için `{action, label, description, sample_payload}`, `sample_payload` dispatcher'ın gerçek zarfını taklit eder: `{action, data}`) + `INTEGRATION_ACTIONS` (üç mevcut yaz uç noktasından seçilmiş METADATA: mesaj gönder `POST /chats/{chatId}/events`, ticket oluştur `POST /tickets`, etiket ekle `POST /chats/{chatId}/tags` — `required_scopes` her rotanın kendi `config.scopes`'unu birebir kopyalar, yeni scope AÇILMADI); `index.ts`'ten dışa aktarıldı. Route `GET /integrations/manifest` (`apps/api/src/routes/webhooks.ts`, MCP manifest deseni: kayıt anında bir kez inşa edilir, tenant verisi okumaz) — `GET /webhooks` ile AYNI scope (`webhooks--all:ro`/`:rw`, yeni scope yok); yanıt `{triggers, actions, subscribe:{POST,/webhooks}, unsubscribe:{DELETE,/webhooks/{webhookId}}}`. Kontrat: `packages/contract/openapi/paths/webhooks.yaml`'a `integrationManifest` operasyonu + `openapi.yaml`'a `IntegrationManifest`/`IntegrationTrigger`/`IntegrationAction` şemaları + path kaydı, re-bundle (150→151 path). `packages/types` `apps/api`'ye bağımlı olamayacağından (ters bağımlılık), WEBHOOK_ACTIONS↔INTEGRATION_TRIGGERS eşleşmesi tip sistemiyle değil bir **senkron testiyle** korunuyor — `apps/api/test/integration/webhooks.test.ts`'e yeni `describe('GET /integrations/manifest')` (8: negatif-önce 401/403 · trigger kümesi WEBHOOK_ACTIONS ile birebir + her trigger sample_payload taşıyor (aksiyon eklenip manifeste yazılmazsa bu test kırılır) · actions boş değil + her required_scopes `isScope`'tan geçiyor · subscribe/unsubscribe sabitleri doğru · çapraz-kiracı: iki lisans BYTE-FOR-BYTE aynı yanıtı alır, yanıtta license_id/organization_id YOK) · `packages/types/src/integrations.test.ts` (yeni, 4: tekil action'lar · her trigger label/description/sample_payload taşıyor · actions tekil id + gerçek scope) · `contract-parity.test.ts` yeşil (5/5, çift yönlü parite) · tm 72.2. **09.4-c teslim** — partner app kaydı çekirdeği: `oauth_clients`'ın YAZMA yolu ilk kez açıldı (bugüne kadar tabloyu yalnız signup/seed dolduruyordu, okuma yolu `auth_find_client` üzerinden zaten vardı). Kontrat `packages/contract/openapi/paths/partner-apps.yaml` (yeni, 5 operasyon: `POST|GET /partner/apps`, `GET|PATCH|DELETE /partner/apps/{clientId}`) + `openapi.yaml`'a `Partner` tag'i, iki path kaydı ve beş şema (`PartnerApp` secret'sız · `PartnerAppRegistration` allOf + opsiyonel `client_secret` · `PartnerAppRegistrationRequest` · `PartnerAppPatch` · `PartnerAppClientType`), re-bundle 151→153 path. Servis `apps/api/src/services/partner/partner-app-service.ts` (yeni) + route `apps/api/src/routes/partner-apps.ts` (yeni) + `server.ts` kaydı. **Altı güvenlik kararı tek bağlamda:** (1) `client_id` = `generateClientId()` (128 bit hex, org kimliği sızdırmaz — crypto.ts:157'nin src'deki İLK tüketicisi); (2) secret yalnız `client_type='confidential'` için üretilir (`nxcs_` + 256 bit), saklanan değer `hashToken(secret)` — `OauthService.#authenticateClient`'ın `constantTimeEqual(hashToken(presented), secret_hash)` doğrulamasıyla birebir; `SAFE_SELECT` `secretHash`'i HİÇ seçmez, yanıt `Cache-Control: no-store`; public client'ta `secret_hash` null (PKCE); (3) `redirect_uris` kayıt anında doğrulanır ve **normalize EDİLMEDEN** saklanır (`isRegisteredRedirect` tam string eşleşmesi bekliyor): mutlak URI · yalnız https (dev istisnası `http://localhost` / `http://127.0.0.1` — matcher'ın kendi istisnasıyla aynı) · fragment/wildcard/`..`/userinfo yok · en fazla 10, tekrarsız · **kanonik biçim zorunlu** (`url.toString() === raw`) — bu son kural saldırıyı değil SESSİZ KIRILMAYI önler (`:443`, büyük harfli host, kodlanmış `%2e%2e`, homograf/IDN host hepsi kanonikte değişir, yani kaydedilse ASLA eşleşmezdi); (4) scope tavanı `effectiveScopes(scopesOf(principal))` ile — PAT escalation guard'ının aynı ilkesi, ama düz `Set` yerine implikasyon açılımıyla (`chats--all:rw` gerçekten `chats--all:ro`'yu kapsar, daralan isteği reddetmek yanlış-pozitif olurdu); tavan create VE update'te uygulanır; boş küme 400 — çünkü `POST /auth/authorize` boş `client.scopes`'u "tavan yok" diye okuyor, yani boş liste göründüğünün TERSİ anlama geliyor; (5) izolasyon org-scoped RLS (`oauth_clients_tenant`, USING+WITH CHECK) + `updateMany`/`deleteMany` count=0 → 404 (403 DEĞİL, id enumerasyonu); (6) yeni OAuth scope AÇILMADI — `access_rules:ro`/`:rw` yeniden kullanıldı (routes/apps.ts ile aynı yönetici yüzeyi). **Kapsamın ötesinde bulunan kusur kapatıldı:** organizasyonun kendi giriş client'ı (signup'ın açtığı `nexa-agent-app-<org>`) AYNI tabloda yaşıyor ve `auth_list_memberships` onu "org'un en eski client'ı" diye tanımlıyor — koruma olmadan bir admin partner portalından onu silip tüm çalışma alanını girişten kilitleyebilirdi; `firstPartyClientId()` aynı kuralı okuyarak PATCH/DELETE'i 400 ile reddediyor (listede görünmeye devam ediyor). `client_type` kayıttan sonra DEĞİŞTİRİLEMEZ (confidential→public canlı secret'ı yerinde bırakıp doğrulamayı sessizce düşürürdü). Migration YOK. Test `apps/api/test/integration/partner-apps.test.ts` (yeni, 28 — negatifler önce): redirect reddi 5 blok (http/ftp · wildcard/fragment/traversal/userinfo · relative + `javascript:`/`data:` · **kodlanmış `%2e%2e` + Kiril homograf** · kanonik olmayan 3 varyant · tekrar/11 adet/boş) · scope tavanı 5 (tutulmayan scope 403 · bilinmeyen scope 403 · boş liste 400 · implikasyonla tutulan `:ro` kabul · **update'te de tavan**) · yetki 3 (401 · read-only token her yazmada 403 · scope'suz 403) · secret 3 (list/get'te YOK + payload'da string olarak da yok, DB'de `hashToken` eşiti · public'te hiç üretilmez · `no-store`) · cross-tenant 2 (get/patch/delete üçü de **404 + `error.type==='not_found'`**, satır dokunulmamış · iki yönlü liste sızıntısı yok) · first-party koruması 1 · CRUD 4 · **ve çekirdeğin en kritik iddiası: portalda üretilen confidential client GERÇEK OAuth 2.1 `authorize→token` akışını tamamlıyor** (`secret_hash` format uyumunun uçtan uca kanıtı) + token'ın scope'u client'ın kayıtlı kümesiyle sınırlı (owner oturumu tüm admin setini taşırken) · yanlış/eksik `client_secret` → 401 `invalid_client` · kayıtlı olmayan redirect_uri ile authorize → 400. `contract-parity.test.ts` yeşil (çift yönlü). tm 72.3. **09.4-d teslim** — partner app secret rotate + denetim izi. Rotate: `POST /partner/apps/{clientId}/rotate-secret` (`apps/api/src/routes/partner-apps.ts`) + `PartnerAppService.rotateSecret` — yeni secret `mintClientSecret()` ile üretilir (register ile ORTAK yardımcı; iki yolun farklı biçimde secret üretmesi ancak çok sonra, prefix okuyan bir şeyde ortaya çıkardı), `hashToken(secret)` `secret_hash`'in üstüne yazılır, düz metin **yalnız bu yanıtta** döner (`Cache-Control: no-store`), `client_id` değişmez (mevcut yetkilendirmeler ayakta kalır). **Örtüşme penceresi YOK** — tek `secret_hash` kolonu var, yani eski secret commit anında ölür; rotate'ın var oluş sebebi sızıntı olduğu için grace period tam olarak istenmeyen şeydir. Public client'ta 400 (PKCE ile doğrulanır, ortada secret yok — sessizce üretmek kimsenin bilmediği bir kimlik bilgisi bırakırdı), başka organizasyonun client'ında **404** (RLS + id enumerasyonu engeli), first-party giriş client'ında 400 (PATCH/DELETE ile aynı `assertNotFirstParty` kuralı — re-key etmek partner entegrasyonunu değil ajan uygulamasını kırardı). Denetim izi: `AUDIT_ACTIONS`'a dört aksiyon (`partner_app.created`/`.updated`/`.deleted`/`.secret_rotated`, `apps/api/src/services/audit/audit-log.ts`) ve 09.4-c'nin üç yazma yoluna + rotate'a `writeAuditEntry` — hepsi **eylemin KENDİ transaction'ında** (webhooks.ts deseni: ya ikisi birden ya hiçbiri; eşleşmeyen bir DELETE/PATCH ve cross-tenant ıskalama hiçbir log'a satır YAZMAZ). Metadata yalnız güvenlik-anlamlı: `client_type` · verilen `scopes` · `redirect_uri_count` · PATCH'te dokunulan alan adları — secret ve redirect URI'ların KENDİSİ asla (URI token gömebilir); `sanitizeAuditMetadata` ikinci savunma hattı olarak zaten duruyor. Kontrat: `paths/partner-apps.yaml`'a `partnerAppSecret` operasyonu + `openapi.yaml`'a path kaydı ve `PartnerAppSecretRotation` şeması (`client_secret` **zorunlu** — rotate yalnız confidential'a uygulanır), re-bundle 153→154 path. Migration YOK (`audit_log`'un `action` kolonunda CHECK/enum yok, yalnız `audit_log_actor_type_check` var — doğrulandı). `apps/web` audit ekranındaki elle tutulan `ACTION_GROUPS` aynası da Credentials grubuna dört aksiyonu aldı (dosya başındaki "elle senkron" notunun gereği). Testler: `apps/api/test/integration/partner-apps.test.ts` +8 (28→36, negatifler önce: public client 400 + arkasında hash üretilmediği · başka org 404 + secret'ı DEĞİŞMEMİŞ · first-party 400 · 401/403 · olmayan id 404 · **eski secret ile `POST /auth/token` → `invalid_client`, yeni secret ile aynı akış 200** — rotate yolunun `secret_hash` format uyumunun kanıtı · yalnız yeni hash saklanır, list/get/payload'da secret yok · `no-store`) · `apps/api/test/integration/audit-log.test.ts` +5 (kayıt/güncelleme/silme/rotate için birer satır + doğru `target`/`actor`, no-op DELETE satır yazmaz, cross-tenant rotate ve delete **hiçbir** lisansın log'una yazmaz, entry'de ne eski ne yeni secret geçer). DoD tam yeşil: typecheck **0** (11/11) · lint **0** (8/8) · `pnpm -w test` **0** (`@nexa/api` 2181/2181, +13) · `pnpm -w test:integration` **0** (`@nexa/api` 1644/1644 · `@nexa/rtm` 51/51) · build **0** (7/7) · `contract-parity.test.ts` yeşil. tm 72.4.

✅ **09.4-e teslim** — `apps/web/src/features/developers/DeveloperPortal.tsx` (yeni): `/partner/apps`
listesi (anlamlı empty state) + 'Register app' modalı (display_name zorunlu, client_type, redirect
URI'lar satır-satır, scope çoklu seçim — yalnız çağıran principal'ın kendi scope'ları seçilebilir) +
kayıt yanıtındaki `client_secret`'ı yalnız `SecretOncePanel`'da BİR KEZ gösterip panel kapanınca
state'ten silen akış (liste asla secret taşımaz — sunucu zaten seçmiyor) + sil (onay modalı) +
sunucudan gelen 400'ün (ör. geçersiz redirect_uri) alan-altı/form hatası olarak yansıması. `App.tsx`'e
`/app/developers` rotası + `navigation.ts` FOOTER'a `access_rules:rw` scope kapılı girdi + yeni
`isNavVisible` yardımcı fonksiyonu, `AppShell.tsx` (ray) ve `CommandPalette.tsx` (arama sonuçları)
ikisine de uygulandı. i18n `nav.developers` anahtarı bu turda eklendi. Yazım sırasında bulunup
düzeltilen iki kusur: (1) `RegisterAppModal`'ın mutation'ı listeyi invalidate etmiyordu (yalnız
`DeleteAppModal` invalidate ediyordu) — kaydedilen app, secret paneli kapanana kadar listede
görünmeyecekti; `DeleteAppModal` ile aynı `invalidateQueries` deseni eklendi. (2) Redirect-URI
textarea'sının etiketi (`<label>`) içine gömülü "One URI per line." ipucu metni, alanın erişilebilir
adını kirletiyordu (`getByLabelText('Redirect URIs')` alanın kendi hata mesajı göründüğünde artık
eşleşmiyordu) — ipucu `InviteTeammates.tsx`'in zaten kullandığı desenle etiketin dışına taşındı.
`DeveloperPortal.test.tsx` (7 test): empty state · alan-altı hata + submit pasif · secret bir kez +
panel kapanınca DOM'dan gidiyor + liste satırında yok (stateful mock ile gerçekten kanıtlanıyor) ·
sunucu 400'ü form hatası olarak yansıyor · sil akışı · `access_rules:rw` olmayan ajanda hem portal hem
`isNavVisible` yardımcısı gizli. `AppShell.test.tsx` (+2) ve `CommandPalette.test.tsx` (+2): rail'de ve
komut paletinde Developers girdisi scope'suz ajanda yok, scope'lu ajanda var. DoD tam yeşil: typecheck
**0** (11/11) · lint **0** (8/8) · `pnpm -w test` **0** (`@nexa/web` 813/813, 802'den +11 · `@nexa/api`
2181/2181 · `@nexa/rtm` 90/90) · `pnpm -w test:integration` **0** (`@nexa/api` 1644/1644 · `@nexa/rtm`
51/51 — bu tur backend'e dokunmadı, regresyon yok) · build **0** (7/7) ·
`apps/e2e/tests/developer-portal.spec.ts` (yeni, 1 test: kayıt → secret bir kez → Done sonrası
DOM'dan gidiyor → reload sonrası liste sunucudan geliyor → sil) **0** (1/1, elle koşuldu — `.env`
pencere kabuğuna source edilerek; `apps/rtm/src/index.ts` `apps/api`'nin aksine hiçbir `.env`
yükleyicisi çağırmadığından farklı bir kabukta `pnpm --filter @nexa/e2e test` RTM `webServer`
zaman aşımıyla düşebilir — bu tm 72.5'in dosya kapsamı dışında bir altyapı kusuru, ayrı not edildi).
Tam `pnpm -w test:e2e` süiti koşulmadı; tam kapanış kanıtı 09.4-g'nin (tm 72.7) işi. tm 72.5.

✅ **09.4-f teslim** — Portal'a ikinci ve üçüncü sekme, `apps/web/src/features/developers/WebhookSubscriptions.tsx` (yeni): `WebhookSubscriptions` — `GET /webhooks` listesi (url/action/type/enabled/created_at, anlamlı empty state) + Subscribe formu (action seçenekleri **09.4-b'nin `GET /integrations/manifest` yanıtından** türer, sabit `WEBHOOK_ACTIONS` kopyası YOK) + `POST /webhooks` yanıtındaki `secret`'ı `WebhookSecretPanel`'da bir kez gösterip kapanınca state'ten silen akış (liste sunucudan zaten secret almıyor) + `DELETE /webhooks/{webhookId}` onay modalıyla + sunucudan gelen 400'ün (SSRF reddi — `assertPublicHttpUrl`, tm 34) `url` alanının altına yansıması. `IntegrationManifestReference` — aynı manifest sorgusunu paylaşan salt-okunur üçüncü sekme: triggers/actions/subscribe-unsubscribe, geliştiriciye Zapier/Make app tanımı için referans. `DeveloperPortal.tsx` üç sekmeli hale getirildi (`role="tablist"`/`"tab"`/`"tabpanel"`, ReportsPage'in aynı deseni) — Apps sekmesindeki mevcut akış (liste/register/secret-once/sil) davranış değişikliği olmadan korundu; header'daki 'Register app' eylemi yalnız Apps sekmesinde görünür. 09.4-d'nin rotate-secret'ı burada yüzeye çıktı: `AppRow`'a yalnız `client_type==='confidential'` satırlarda "Rotate secret" düğmesi (public client'ta sunucu zaten 400 döner — bu istemci-taraflı, işyeri-bağımsız bir gerçek olduğundan düğme hiç gösterilmedi) + `RotateSecretModal` (onay) + `POST /partner/apps/{clientId}/rotate-secret` + `SecretOncePanel` genelleştirildi (`title` prop, register ve rotate arasında paylaşılıyor). Testler: `WebhookSubscriptions.test.tsx` (yeni, 7 — empty state · action seçenekleri manifest yanıtından türüyor/sabit liste yok · secret bir kez + panel kapanınca DOM'dan gidiyor + liste satırında yok · sunucu 400'ü `url` alanının altında (`aria-invalid`) · sil akışı · `canEdit=false`'ta Subscribe/Delete gizli · manifest sekmesi triggers/actions/subscribe-unsubscribe'i yanıttan render eder) · `DeveloperPortal.test.tsx` (+3 — sekmeler arası geçiş (Apps→Webhooks→Manifest, header eylemi Apps dışında görünmüyor) · Rotate secret düğmesi yalnız confidential'da · rotate akışı: onay → yeni secret bir kez → Done sonrası DOM'dan gidiyor) · `apps/e2e/tests/developers.spec.ts` (yeni, 1 — gerçek sunucuya karşı: portal → Webhooks sekmesi → abone ol → secret bir kez → listede görünür (reload sonrası da) → sil → listeden düşer). DoD tam yeşil: typecheck **0** (11/11) · lint **0** (8/8) · `pnpm -w test` **0** (`@nexa/web` 823/823, 813'ten +10) · `pnpm -w test:integration` **0** (`@nexa/api` 1644/1644 — bu tur backend'e dokunmadı, regresyon yok) · build **0** (7/7) · `developers.spec.ts` + `developer-portal.spec.ts` (regresyon kontrolü) **0** (2/2, `.env` kabuğa source edilerek elle koşuldu — aynı tm 72.5'te not edilen RTM `.env` yükleyici kusuru, hâlâ ayrı bir düzeltme görevi olarak açık). Tam `pnpm -w test:e2e` süiti koşulmadı; tam kapanış kanıtı 09.4-g'nin işi. tm 72.6.

✅ **09.4-g teslim — KALEM KAPANDI.** Doğrulama turu: yeni üretim kodu yazılmadı, yalnız açık kalan
dört iddia teste bağlandı ve tam kapanış kapısı koşuldu. `apps/api/test/integration/partner-apps.test.ts`
+4 (36→40): **grant tavanı** — portalda kayıtlı client `chats--all:ro` ile kaydedilip owner oturumu
`chats--all:ro,customers:ro` isterse token yalnız `chats--all:ro` taşır **ve düşen scope gerçekten
kullanılamaz** (`GET /customers` → 403; yanıt gövdesindeki dizeye değil rota kapısına bakılıyor) ·
kayıtlı kümenin tamamen dışında bir scope istenirse authorize **400** (boş grant vermek yerine —
scope'suz token değişimden geçip ilk gerçek çağrıda kafa karıştırıcı biçimde düşerdi) · `scope`
hiç verilmezse kayıtlı küme varsayılan olur (rol varsayılanı değil) · **cross-tenant authorize** —
B organizasyonunda kaydedilen client'a A'nın owner'ı geçerli parola + kendi lisansıyla authorize
olamaz, **404 + `error.type==='not_found'`** (403 client_id'nin gerçek olduğunu doğrulardı, NFR-S5).
Bu son test kasıtlı olarak partner-apps süitinde: portal CRUD'unu RLS koruyor, ama `POST /auth/authorize`
**public** bir rota ve client'ını tenant bağlamı OLMADAN buluyor — kod yetkilendirmesini fiilen dağıtan
yol o, ve bugüne kadar portalın ÜRETTİĞİ bir client'la sınanmamıştı. `tenant-isolation.test.ts` +6:
`oauth_clients` politikası (`oauth_clients_tenant`) bu süitte tek başına **organizasyon** anahtarlı
olduğu için diğerlerinden bağımsız kırılabilir ve kaybedecek en çok şeye sahip — buradaki satır veri
değil, `POST /auth/authorize`'ın sonradan güveneceği bir kimlik bilgisi. Altı iddia: kendi org'unu
okur · B'nin client'ını tam id ile çekemez · `redirect_uris`'ini repoint edemez (edebilseydi o
çalışma alanının authorization code'ları saldırganın callback'ine giderdi) · **scope tavanını
boşaltamaz** (boş `scopes` route'ta "tavan yok" demek, yani silme kılığında yetki yükseltme) ·
silemez · B'ye client ekemez (WITH CHECK). 09.4-c/d'den gelen üç iddia
(kayıtlı olmayan redirect_uri → 400 · yanlış/eksik `client_secret` → `invalid_client` · rotate/delete
yabancı client'a değmiyor, secret_hash sağlam) ve manifest↔`WEBHOOK_ACTIONS` senkron testi zaten
yerindeydi, bu turda regresyon kontrolü olarak yeşil koşuldu. **KK kapanışı — '700+ Zapier' payı:**
katalogda Zapier+Make kartı (09.4-a) · `GET /integrations/manifest` her trigger'ı ve
subscribe/unsubscribe yolunu yayınlıyor (09.4-b) · portalda webhook aboneliği kurulup silinebiliyor
(09.4-f) · ve portalda üretilen confidential client gerçek OAuth 2.1 `authorize→token` akışını kayıtlı
scope tavanıyla tamamlıyor — yani Zapier/Make tarafında tek bir Nexa app'i tanımlamak için gereken
her şey Nexa tarafında mevcut ve kanıtlı. Gerçek platformda app yayınlamak depo dışıdır (kapsam dışı).
**Tam DoD kapısı yeşil:** `pnpm -w typecheck` **0** (11/11) · `pnpm -w lint` **0** (8/8) ·
`pnpm -w test` **0** (`@nexa/api` 2191/2191, 2181'den +10) · `pnpm -w test:integration` **0**
(`@nexa/api` 1654/1654, 1644'ten +10 = partner-apps 4 + tenant-isolation 6; 67 dosya —
`contract-parity`, manifest senkronu ve `apps` katalog sınırı dahil) · `pnpm -w build` **0** (7/7) ·
`pnpm -w test:e2e` **TAM SÜİT 93/93** (`developers.spec.ts` + `developer-portal.spec.ts` dahil;
09.4-e/f'nin borç bıraktığı tam koşu bu turda kapandı — `.env` kabuğa source edilerek, RTM `.env`
yükleyici kusuru hâlâ ayrı bir düzeltme görevi). tm 72.7.

→ §5.2

#### K01.1.3 — 01.1.3 · ⌘K command palette — AI komutları

✅ §5.5 matrisi MOD-01 v2: `○ (AI komutları)`. Palet **teslim** MVP'de (tm 18). v2 payı = doğal-dil AI sorgu tipi + sonuç render + scope kapısı. **01.1.3-ai-a teslim** — statik aksiyon kataloğu + `PaletteResult` birleşik tipi: `ActionRecord`/`ActionDeps` (`apps/web/src/components/actions.ts`) — tek kayıt `toggle-accepting-chats` (dinamik `label()` mevcut `routing_status`'a göre Stop/Start metnini seçer, `requiredScope` hedef `PUT /agents/me/routing-status`'un kabul ettiği iki scope ile birebir, `run()` gerçek gövde — mevcut `useAuth().setRoutingStatus`'u çağırır, boş bırakılmadı ama palet henüz çağırmıyor) · `PaletteResult` (`kind: 'nav'|'content'|'action'|'ai'`) `CommandPalette.tsx`'in eski yerel `Command` tipinin yerini aldı (saf refactor — davranış değişmedi, yalnız `kind` eklendi) · test `actions.test.ts` (6) · regresyon `CommandPalette.test.tsx` değişmeden yeşil (6) · tm 95.1. **01.1.3-ai-b teslim** — aksiyon sonuç tipinin scope kapısı: `CommandPalette.tsx` aksiyon sonuçlarını `ACTIONS` üzerinden üretir ve her kaydı oturumun scope kümesiyle (`useAuth().agent.scopes`, mevcut içerik-arama kapısının aynı kaynağı — yeni endpoint yok) süzer; süzmeden geçen kayıt yoksa hiçbir sonuç push edilmediği için `Actions` başlığı da render edilmez (boş bölüm yok, NFR-S5). Etiket canlı `routing_status`'tan hesaplanır (`agent`/`setRoutingStatus` alan-bazlı store aboneliğiyle `ActionDeps`'e geçer); `run()` bu turda bilinçli olarak **inert** — tetikleme+optimistic+geri alma -c'nin işi. i18n `palette.group.actions` (en/tr). **Sınır:** bu bir UX kapısıdır, koruma değil — gerçek kapı `PUT /agents/me/routing-status`'un kendi `config.scopes`'u; ikisi birden test edilir: `CommandPalette.test.tsx` (+5: yetkisiz oturumda aksiyon ve başlık YOK · `agents--my:rw` ve `agents--all:rw` ile listelenir · etiket canlı duruma göre · scope kümesi boşken palet sağlam) ve `apps/api/test/integration/route-config.test.ts` (+1: endpoint'in scope çifti `actions.ts`'in kopyaladığı literal'e sabitlendi — ikisi ayrışamaz) · tm 95.2. **01.1.3-ai-c teslim** — aksiyon tetikleme + optimistic + hata geri alma: aksiyon seçilince palet ÖNCE kapanır (`close()`), sonra `action.run(actionDeps)` arka planda sonuçlanır — modal bir isteğin üstünde açık tutulmaz. Optimistic hikâyenin sahibi katalog kaydı: `ActionDeps`'e istek YAPMAYAN yerel yazıcı `applyRoutingStatus` eklendi (`CommandPalette.tsx`'te `useAuth.setState` üzerinden, kimliği sabit `useCallback`), `run()` önce tahmini yazar → `setRoutingStatus` (PUT `/agents/me/routing-status`) → hata olursa **önceki değeri geri yazar ve yeniden fırlatır**; palet fırlatılanı yakalayıp `role="alert"` bir `Banner` (tone danger, dismissible) gösterir — palet kapandıktan sonra bile ayakta kalır, çünkü hata cevabı kapanıştan sonra gelir (sessiz yutma yok, FR-EK-A.2). i18n `palette.action.failed` / `.failedFallback` / `.failedDismiss` (en/tr). Testler: `actions.test.ts` (+4, 6→10; **negatif önce** — mutasyon kanıtı: geri alma satırı silinince 2 test kırmızı) · `CommandPalette.test.tsx` (+5, 11→16: 403 ve 500'de mağazadaki durum geri döner + alert görünür · başarıda PUT gövdesi doğru, palet kapalı, istek gönderilirken store ZATEN yeni değeri taşıyor · ters yön · alert kapatılabilir; mutasyon kanıtı: catch susturulunca 3 test kırmızı) · e2e `command-palette.spec.ts` (+1: palet → Stop Accepting Chats → **Team ekranı** 'Not accepting' okur → palet → Start ile geri alınır; kanıt `apps/e2e/kanit/95-palette-action.png`) · tm 95.3. **01.1.3-ai-d teslim** — kontrat: `POST /palette/ai-query` (`packages/contract/openapi/paths/command-palette.yaml`, `copilot.yaml` deseni birebir) — body `{query}` (1-500 karakter), yanıt `{answer, kind: 'summary'|'no_data'|'not_understood', metric_source?}` (`ref` alanı gelecekteki deep-link için ayrıldı, bu turda hiç doldurulmuyor). Yeni `ApiError` tipi AÇILMADI — anlaşılmayan soru `kind:'not_understood'` ile 200 döner. `openapi.yaml`'a yeni `Command Palette` tag'i + `$ref`; `pnpm --filter @nexa/contract generate` ile bundle (145→146 path) + `src/generated/api.ts` yeniden üretildi. tm 95.4. **01.1.3-ai-e teslim** (aynı pencerede -d ile BİRLEŞTİRİLDİ — task'ın kendi notu bunu açıkça izin veriyordu, çünkü -d tek başına inseydi `contract-parity.test.ts` kırılırdı; main hiçbir noktada kırmızı kapıyla görülmedi): `apps/api/src/routes/command-palette.ts` — `config.scopes: ['reports_read']` (yeni scope AÇILMADI), `request.withTenant` içinde, principals varsayılanı (agent+bot) korunduğu için müşteri token'ı 404 alır (I4 sınırı, `copilot.ts` deseni birebir). Kendi SQL'ini YAZMAZ — `buildOverviewReport`'u (`GET /reports/overview`'un kullandığı AYNI fonksiyon) çağırır, böylece ADR-09 tutarlılığı yapısal olarak korunur. Niyet eşleme deterministik: `packages/ai-mock/src/palette-intent.ts` (`matchIntent`'in aynı eşik/skor mantığı, 5 sabit konu — takım aktivitesi/tickets/memnuniyet/yanıt süresi/otomasyon — her biri Overview'daki tek bir alanı okur). `zod` ile `query` 1-500 karakter sınırı (NFR-S8). Testler: `apps/api/test/integration/command-palette.test.ts` (9, yeni) — **ADR-09 tutarlılığı** (cevaptaki sayı `/reports/overview` ile birebir) · scope'suz token 403 · müşteri token'ı 404 · aşırı uzun/boş query 400 · **cross-tenant**: başka lisansın sohbetleri cevaba sızmıyor (0 döner, sızıntı yok) · `not_understood` ve `no_data` (memnuniyet puanı hiç oylanmamışken `null` → no_data, sahte 0% değil) 200 · determinizm (aynı sorgu → aynı `metric_source`) · `packages/ai-mock/src/palette-intent.test.ts` (9, yeni) — konu eşlemesi deterministik, KK örneği ("Summarize my team's activity") doğru konuya bağlanıyor. tm 95.5. **01.1.3-ai-f teslim** — palette AI sonuç render'ı: `CommandPalette.tsx`'te girdi hiçbir action/nav/content'e eşleşmeyip (`commands.length===0`) caller `reports_read` scope'unu taşıyorsa (`AI_QUERY_SCOPE` — aynı 403-courtesy deseni diğer gruplarla), listeye tek bir `kind:'ai'` sonucu eklenir (`Ask AI: "{query}"`, debounced `query`). Seçilince palet **kapanmaz** (nav/action'ın aksine — cevabın gösterileceği yer paletin kendisi): `useMutation` ile `POST /palette/ai-query` çağrılır, sonuç aynı satırda bir karta döner — yükleniyor → `Skeleton` (`aria-hidden`), `summary` → cevap metni + `metric_source` etiketi, `no_data`/`not_understood` → `EmptyState` (FR-EK-B.1, boş dikdörtgen değil) — açıklaması backend'in kendi `answer`'ı (ikinci bir metin yazılmadı, ADR-09 ruhu: tek kaynak — `not_understood` için örnek konuları zaten backend listeliyor). Sorgu düzenlenince (`onChange`) veya palet kapanınca cevap terk edilir/reset. i18n `palette.group.ai` + `palette.ai.*` (en/tr). Testler: `CommandPalette.test.tsx` (+8, 16→24) — eşleşmeyen girdi 'Ask AI' sonucu · `reports_read` yoksa hiç sunulmaz · seçilince endpoint çağrılır + `summary` kartta (istek gövdesi doğrulanır, palet açık kalır) · `no_data` anlamlı empty state · `not_understood` backend'in örnek metni · yükleniyor → skeleton · istek hatası → uyarı · sorgu düzenlenince cevap terk edilir. tm 95.6. **01.1.3-ai-g teslim** — klavye/a11y: dört sonuç tipi (`action`/`nav`/`content`/`ai`) zaten tek bir düz `commands` dizisine indirgeniyordu (`CommandPalette.tsx`, önceki turlardan); eksik olan ↑↓'nün **sarması** (wrap) idi — `onInputKeyDown` `Math.min`/`Math.max` ile UÇLARDA KİLİTLENİYORDU (son satırda ArrowDown, ilk satırda ArrowUp hiçbir şey yapmıyordu). İki dal `(index + 1) % commands.length` / `(index - 1 + commands.length) % commands.length` oldu (boş listede `% 0` NaN'ı önlemek için `commands.length > 0` koruması eklendi — daha önce `Math.min(1, -1)` zaten negatif bir indekse kilitleniyordu, aynı köşe artık güvenli). Grup başlıkları (`role="presentation"` `<p>`) `commands` dizisinde hiç yer almadığı için odağı yapısal olarak alamıyorlar — ayrı bir kod değişikliği gerekmedi, yalnız test kanıtı eklendi. `role=listbox`/`option` + `aria-activedescendant` ve odak halkası (tüm tiplerde aynı `className` mantığı) zaten doğruydu, değişmedi. **Test altyapısı borcu ödendi:** jsdom `scrollIntoView`'i uygulamıyor — palette bugüne kadar hiçbir test ok tuşuyla `activeIndex`'i gerçekten değiştirmediği için bu hiç tetiklenmemişti; `apps/web/vitest.setup.ts`'e paylaşılan no-op polyfill eklendi (tüm workspace testleri için, yalnız bu dosya için değil). Testler (`CommandPalette.test.tsx`, yeni `describe` bloğu, +3): karışık liste (action+nav+content, `tm 95.` sabit kurgu "o" sorgusuyla 1+8+1+1=11 satır) ↑↓ ile baştan sona dolaşır, `aria-activedescendant` her adımda doğru satırı gösterir, son satırdan bir adım daha ileri baş satıra sarar ve tersi · Enter, ok tuşlarıyla gidilen satırı (ilk sonuç değil) çalıştırır — customer sonucundan bir ArrowDown sonra ticket'a Enter, `/app/inbox?ticket=TCK123`'e gider (bu spesifik akış daha önce test edilmiyordu) · yalın action+nav listesinde de sarma çalışır (ağ isteği gerekmez). **Mutasyon kanıtı:** sarma satırları `Math.min`/`Math.max`'e geri alınınca yeni 2 test (sarma iddiaları) kırmızı, 3. test (Enter-on-second-result, sarmaya bağlı değil) yeşil kaldı — beklenen ayrım. Regresyon: mevcut 24 test değişmeden yeşil (toplam 27). tm 95.7. **01.1.3-ai-h teslim — KALEM KAPANDI.** KK'nın üç sonuç tipi TEK oturumda, yalnız klavyeyle kanıtlandı: `apps/e2e/tests/command-palette.spec.ts` yeni senaryo `proves all three result kinds — navigate, act, ask — in one session` (⌘K aç → ↑↓ iki yönde de sarar [`aria-activedescendant`, boş sorguda: ağ yanıtı listeyi altımızdan değiştiremez; imleç `mouse.move(0,0)` ile satırlardan çekilir, çünkü satırlar hover'la da vurgulanır] → **navigasyon** Enter ile Reports'a gider → **aksiyon** Enter ile Stop Accepting Chats, Team ekranı API üzerinden `Not accepting` okur, sonra geri alınır ve reload'dan sonra `Accepting chats` [seed temiz bırakılır] → **AI sorgusu** KK'nın kendi örneği "Summarize my team's activity" cevap kartına döner: `handled N chats in this period` + `Source: totals.chats` [ADR-09 — sayı Reports'un builder'ından] → **Escape** kapatır). **Placeholder KK'ya hizalandı:** `palette.placeholder` en `Search customers, conversations, tickets — or jump to a module…` → **`Search Text or go to…`** (PRD §485 birebir; tr `Metin ara veya git…`), unit'te de sabitlendi (`CommandPalette.test.tsx` 'opens on ⌘K and closes on Escape' + e2e attribute iddiası) — KK'nın üçüncü maddesi bu tura kadar karşılanmıyordu, tek satırlık metin farkıydı, ◐ bırakmak yerine kapatıldı. Kanıt `apps/e2e/kanit/95-palette-ai-answer.png`. DoD tam yeşil (typecheck/lint/unit 2941/integration 1527/build/e2e **84/84** — tm 104'ün e2e kırmızısı da bu koşuda yeşildi). tm 95.8

#### K12.4 — 12.4 · Copilot BI komut (rapor/metrik sorusu → cevap)

✅ §5.5 matrisi MOD-12 v2: `○ (BI komut)`. Copilot **teslim** v1 (tm 36). ADR-09 tutarlılığı şart (aynı sorgu = aynı sayı). **12.4-bi-a teslim** — `POST /copilot/bi` kontrat anchor'ı (operationId `copilotBi`, body `{question}` maxLength 500, yanıt `{answer,kind,metric,value,range}`) + `openapi.yaml` $ref + bundle/tip regen — `packages/contract/openapi/paths/copilot.yaml` · `packages/contract/openapi/openapi.yaml` · test `contract-parity.test.ts` · tm 96.1. **Bilinçli kırmızı — KAPANDI (12.4-bi-c):** `contract-parity.test.ts` `post /copilot/bi` için "documented but not served" diyordu; route indi, parity iki yönlü **yeşil**. **12.4-bi-b teslim** — deterministik soru→metrik eşleyici (LLM yok, saat yok): `resolveBiQuestion(question) => {metric, range, confidence}`; 6 metrik sözlüğü (`chats`/`closed`/`manual`/`assisted`/`automated`/`csat` → Overview alan yolu) TR+EN ifadelerle `matchIntent` eşiğinde (0.6), 7 göreli pencere (`dün`/`bugün`/`bu hafta`/`geçen hafta`/`bu ay`/`son 7 gün`/`son 30 gün`) sıralı regex listesiyle; **belirsiz soru metrik DÖNDÜRMEZ** (eşit kanıtlı iki metrik → `null`; "kaç sohbet çözüldü" üçlü split'e eşit yakın → `null`) — `packages/ai-mock/src/bi-intent.ts` · test `packages/ai-mock/src/bi-intent.test.ts` (55) · tm 96.2. **12.4-bi-c teslim** — `POST /copilot/bi` endpoint çekirdeği: **scope birleşimi** (rota `agents-bot--all:ro|:rw` any-of kapısı + handler'da `reports_read` — `config.scopes` bilerek any-of olduğu için ikisi tek listede birleştirilemez; tek listede olsa "ya biri ya öbürü" olurdu, istenenin tam tersi), **müşteri token → 404** (varsayılan agent+bot `principals`, I4), **cross-tenant** (`request.withTenant` + `licenseId`), ve **ADR-09**: uç kendi SQL'ini yazmaz — `buildOverviewReport`'u (yani `GET /reports/overview`'ün ta kendisini) çağırıp `biMetricSource` yolundaki alanı okur. Göreli pencere → tarih dönüşümü `biWindow()`; hafta/gün sınırları `scheduled-report-period.ts`'ten **paylaşılan** (haftalık zamanlanmış rapor ile "geçen hafta" sorusu aynı Pazartesi-Pazar UTC haftasını kapatır). Soru pencere adı vermezse rapor varsayılanı (`resolveRange`, 30 gün) kullanılır ve **cevapta söylenir**; metrik yoksa `not_understood`, alan `null` ise `no_data` (asla sahte 0/%0) — `apps/api/src/routes/copilot.ts` · `apps/api/src/services/ai/copilot-service.ts` · test `apps/api/test/integration/copilot-bi.test.ts` (15) + `apps/api/src/services/ai/copilot-service.test.ts` (12) · tm 96.3. **12.4-bi-d teslim** — CopilotPanel'e "Ask about your reports" bölümü: soru girdisi + gönder (`useCopilotBi`, `POST /copilot/bi`, `chatId` almaz — ADR-09 uç account-wide); `kind==='metric'` cevabı `value` (metrik `satisfaction.score` ise `formatRate`, aksi hâlde `formatCount`) + ham `metric` alan yolu etiketi + `range` (`formatDate` ile pencere) + **kaynak şeffaflığı** sabit "Source: Reports → Overview" satırıyla gösterilir; yükleniyorken `Skeleton` (aria-hidden), istek hatası sessiz yutulmaz (`role="alert"`). `no_data`/`not_understood` şimdilik yalın `answer` metni — kendi empty-state'i 12.4-bi-e'de — `apps/web/src/features/inbox/CopilotPanel.tsx` · `apps/web/src/features/inbox/useCopilot.ts` · test `apps/web/src/features/inbox/CopilotPanel.test.tsx` (+5) · tm 96.4. **12.4-bi-e teslim** — `not_understood`/`no_data` artık boş dikdörtgen değil: palette'in `AiAnswerCard`'ıyla aynı `EmptyState` bileşeni (FR-EK-B.1). `not_understood` → başlık + sunucunun `answer` cümlesi (ikinci el-yazması kopya yok, palette'in aynı disiplini) + `@nexa/ai-mock`'un `BI_METRICS` sözlüğünden **birebir** alınmış 4 örnek soru — `apps/web` `@nexa/ai-mock`'a bağımlı DEĞİL (`templates.test.ts`'in aynı ayrımı), örnekler elle senkron tutulan sabit bir dize listesi; tıklamak `biQuestion` girdisini doldurur, otomatik göndermez. `no_data` → aynı bileşen + `metric` alan yolundan üretilen tek "son 30 gün" öneri butonu; öneri orijinal soru metnine EKLENMEZ, sıfırdan kurulur (aksi hâlde "dün" gibi önce eşleşen bir aralık ifadesi ai-mock'un matcher sırasında sonradan eklenen "son 30 gün"ü geçersiz kılabilirdi) — `apps/web/src/features/inbox/CopilotPanel.tsx` · test `apps/web/src/features/inbox/CopilotPanel.test.tsx` (+3) · tm 96.5. **12.4-bi-f teslim (kalem kapanışı)** — ADR-09 artık **iki yüzey arasında** kanıtlı: tek tarayıcı oturumunda Reports → Overview'un `Volume` KPI'ları okunuyor, sonra Copilot'a aynı iki soru sözle sorulup (`How many chats closed?` / `How many chats started?`) **rendere edilen figürlerin birebir aynı** olduğu iddia ediliyor — figür, alıntıladığı rapor alanının rozetiyle (`totals.closed` / `totals.chats`) birlikte adresleniyor, yani "aynı sayı ama başka alandan" geçemez. Her iki taraf da **varsayılan penceresinde** bırakıldı (Reports `resolveRange(30)`, pencere adı vermeyen soru `biWindow(null)` → aynı `resolveRange`), böylece karşılaştırma tarih seçimi içermiyor; seed trafiği pencerenin kenarında değil içinde olduğu için iki okuma arasında geçen saniyeler figürleri oynatamıyor, ve KPI'ların sıfır-olmadığı ayrıca iddia ediliyor (sıfır=sıfır boş bir kanıt olurdu). İkinci test bi-e'nin empty state'ini uçtan uca kapatıyor: yerleştirilemeyen soru → "Not sure what you mean" + örnek soru listesi, örneğe tıklamak girdiyi doldurur (otomatik sormaz) ve ortada uydurma bir figür yoktur. Kanıt: `apps/e2e/kanit/96-copilot-bi.png` — `28` / `totals.closed` / `Jul 9, 2026 – Aug 8, 2026` / `Source: Reports → Overview` — `apps/e2e/tests/copilot-bi.spec.ts` (2) · tm 96.6. `no_data` yüzeyi bilinçli olarak e2e'de değil (tek null-olabilir alan `satisfaction.score`; ratings'siz bir pencere seed'in ne zaman koştuğuna bağlı olur) — `CopilotPanel.test.tsx` + `copilot-bi.test.ts` kapsıyor. DoD tam yeşil: typecheck/lint/unit/integration/build **0**, e2e **86/86**. → §5.2

#### K13.2 — 13.2 · Engage / Traffic (gelişmiş filtre + ziyaretçi 360° panel)

◐ **13.2-a teslim** — `TrafficActivity` sözlüğü `browsing/queued/waiting/chatting`'ten `supervised`+`invited` ile 4→6'ya genişletildi, üç katman tek turda senkron: `packages/contract/openapi/openapi.yaml` `TrafficVisitor.activity` enum'ı + `paths/traffic.yaml` funnel açıklaması (iki yeni madde) → re-bundle (`pnpm --filter @nexa/contract generate`, `src/generated/api.ts` yenilendi) → `apps/api/src/services/traffic/traffic-service.ts` `TrafficActivity` union'ı → `apps/web/src/features/traffic/types.ts` union'ı → `TrafficPage.tsx` `ACTIVITY` map'ine `supervised` (tone `info`) + `invited` (tone `warning`) satırları (map artık `export`, testte doğrudan içe aktarılıyor). Servis bu iki değeri HENÜZ üretmiyor — üretim 13.2-b (`invited`) ve 13.2-e (`supervised`) işi; bu adım yalnız sözlüğü senkronladı. Test: `apps/web/src/features/traffic/TrafficPage.test.ts` (yeni, 6 — `ACTIVITY`'nin 6 `TrafficActivity` değerinin hepsi için tone+label döndürdüğü, exhaustive) · `apps/api/test/integration/traffic.test.ts` (12, regresyon — servis hâlâ eski 4 değerden üretiyor) · `contract-parity.test.ts` (5, yeşil) · e2e `traffic.spec.ts` (1, regresyon). tm 73.1.
◐ **13.2-b teslim** — `invited` üretimi: `TrafficService.listLive` artık ÜÇÜNCÜ kaynağı okuyor — `tx.campaignSend.findMany({ licenseId, engaged: false, createdAt: { gte: liveSince }, customer: { organizationId, id: { notIn: seen } } })`; tenant filtresi aynı dosyadaki visits bloğundan birebir (NFR-S4, `campaign_sends` RLS `license_id` üzerinde). Funnel önceliği chats → **invited** → browsing: aktif sohbeti olan ziyaretçi sohbet durumunu korur (`seen` onu zaten aldı), sohbeti olmayan ama canlı pencerede yanıtlanmamış daveti olan `browsing` yerine `invited` görünür, ikisi de yoksa satır üretilmez. "Her ziyaretçi tam bir kovada" kuralı, over-fetch (`remaining * 4`) ve limit mantığı korundu; yanıt şekli değişmedi (13.2-a'nın enum'ı zaten kontratta), migration yok. — `apps/api/src/services/traffic/traffic-service.ts` · test `apps/api/test/integration/traffic.test.ts` (9→15: cross-tenant davet sızıntısı · `engaged=true` satır üretmez · pencere dışı davet satır üretmez · davet edilmiş ziyaretçi `activity='invited'` · davet browsing'i ezer, tek satır · aktif sohbet daveti ezer) · tm 73.2

◐ **13.2-c teslim** — `chat_supervisions` veri katmanı: yeni tablo (`chat_id` VARCHAR(12) → chats · `agent_id` UUID → accounts · `license_id` BIGINT → licenses, üçü de ON DELETE CASCADE; `started_at` + heartbeat `last_seen_at`), PK `(chat_id, agent_id)` — aynı ajanın paneli yeniden açması ikinci satır değil güncelleme — ve board okumasının indeksi `(license_id, last_seen_at DESC)`. Kiracı sınırı `chat_supervisions_tenant` RLS politikası (`campaign_sends_tenant`'ın birebir eşi: `USING` + `WITH CHECK` = `license_id = nexa_current_license()`); GRANT gerekmiyor (20260722090000 varsayılan ayrıcalıkları dört fiili de veriyor, bu tablo canlı durum olduğu için kısıtlanacak bir şey yok). Supervise Postgres'te tutuldu, Redis presence reddedildi (§C): sınır böylece veritabanı garantisi ve satır DoD kapısının doğrulayabileceği deterministik kanıt. ROUTE/OpenAPI YOK (contract-parity çift yönlü) — register/release 13.2-d, funnel'a bağlama 13.2-e. Politikanın gerçekten tuttuğu ölçüldü: politika geçici kaldırılınca 5 test kırmızıya döndü (okuma sızıntısı, IDOR, WITH CHECK, cross-tenant delete+update), geri konunca yeşil. — `apps/api/prisma/schema.prisma` · `apps/api/prisma/migrations/20260810090000_chat_supervisions/migration.sql` · test `apps/api/test/integration/data-model.test.ts` (+6: RLS+politika · PK+indeks · üç yönlü cascade · chat silinince düşer · aynı izleyici iki kez olamaz/ikinci izleyici olabilir · nexa_app register+heartbeat+release) · test `apps/api/test/integration/tenant-isolation.test.ts` (+5: yalnız kendi lisansını okur · B'nin satırını anahtarla çekemez · B'ye izleyici ekleyemez · B'nin satırını silemez/tazeleyemez · ham SQL de geçemez) · tm 73.3

◐ **13.2-d teslim** — Supervision register/release API: kontrat + backend AYNI turda. `POST /chats/{chatId}/supervise` (idempotent upsert; ikinci çağrı tek satırı bırakır, `last_seen_at`'i tazeler, `started_at`'e DOKUNMAZ = heartbeat) + `DELETE /chats/{chatId}/supervise` (yalnız çağıranın satırı; `agentId` principal'den gelir, istekten DEĞİL → başkasının satırını silen bir çağrı şekli yok; izlenmeyen sohbette de 204 = idempotent). Scope `chats--all:ro`/`chats--access:ro` — **YAZMA scope'u istenmedi** (izleme bir okumadır; `rowActions.ts`'in "A read, so it needs no write scope" kararı sunucuda da korundu, iki taraf ayrışmıyor). Yetki `chat/access.ts`'in `resolveVisibility`+`canSeeChat` çiftiyle — `GET /chats/{chatId}` ile BİREBİR aynı: bir ajan tam olarak açabildiği sohbeti izleyebilir. IDOR yanıtı tek ve ayırt edilemez **404** (başka kiracının id'si · ekibinin erişmediği sohbet · hiç var olmayan id — NFR-S5, 403 yok). 13.2-c'nin uyardığı FK tuzağı kapatıldı: sohbet ÖNCE kiracı oturumunda çözülür (`chats` RLS yabancı sohbeti görünmez yapar), FK'nin tek başına kabul edeceği cross-tenant işaret hiç kurulamaz. `principals: ['agent']` (bot'un `accounts` satırı yok → FK patlaması değil, 404). Bayatlık okuma tarafında: `SUPERVISION_LIVE_WINDOW_SECONDS = 90` + `liveByChat()` (13.2-e'nin girdisi, `(license_id, last_seen_at DESC)` indeksinden) — pencere dışı satır silinmez, canlı SAYILMAZ. Supervise atama DEĞİL: thread assignee/queue ve `chat_users` değişmiyor (testle kilitli). — `packages/contract/openapi/paths/chats.yaml` (+`supervise` post/delete) · `packages/contract/openapi/openapi.yaml` (+`ChatSupervision` şeması + path) · re-bundle (155 path, `src/generated/api.ts` yenilendi) · `apps/api/src/services/traffic/supervision-service.ts` (yeni) · `apps/api/src/routes/chats.ts` · test `apps/api/test/integration/traffic-supervision.test.ts` (yeni, 28) · `contract-parity.test.ts` (5, çift yönlü yeşil). **Testlerin kuralı gerçekten ölçtüğü mutasyonla kanıtlandı:** `canSeeChat` kaldırılınca 4 kırmızı · sohbet çözümü tamamen atlanınca (naif FK-only uygulama) 8 kırmızı — "başka kiracının chatId'si için satır yazılmaz" dahil · `deleteMany`'den `agentId` düşürülünce 2 kırmızı. Üçü de geri konunca 28/28 yeşil. · tm 73.4

◐ **13.2-e teslim** — `supervised` ÜRETİMİ: `TrafficService.listLive` artık `chat_supervisions`'ı okuyor. Toplu okuma `SupervisionService.liveByChat(tx, tenant.licenseId, chatIds)`, mevcut assignee/persona `Promise.all`'ının ÜÇÜNCÜ elemanı olarak — board başına TEK indeksli sorgu (`(license_id, last_seen_at DESC)`), ziyaretçi başına sorgu yok (NFR-P2). Funnel önceliği **`queued` > `supervised` > `waiting` > `chatting`** (PRD sırayı yazmıyor; §C varsayımı): `queued` üstte kaldı çünkü kuyruktaki sohbet henüz kimseye ait değildir ve bir izleyici onu yanıtlanmış yapmaz — supervisor'ın taradığı kovadan gizlenmemeli; `supervised` ise `waiting`/`chatting`'in üstünde çünkü o ikisi transkriptten zaten okunabilir, "izleniyor" ise satırda başka hiçbir yerde görünmeyen nadir bilgidir. "Her ziyaretçi tam bir kovada" kuralı korundu (tek satır) ve **`chatting_with` DEĞİŞMEDİ** — izlemek yanıtlamak değildir, sütun hâlâ insan assignee'yi (yoksa persona'yı) adlandırır, `queued`'da null kalır; izleyeni adlandırmak (`supervised_by`) ayrı iş. Migration/kontrat yok (enum 13.2-a'da, yanıt alanları aynı). **Testlerin kuralı ölçtüğü mutasyonla kanıtlandı:** `supervised` dalı silinince 3 kırmızı · `supervised` `queued`'ın üstüne alınınca 1 kırmızı (öncelik testi) · `waiting`'in altına indirilince 1 kırmızı · toplu okuma ziyaretçi-başına döngüye çevrilince 1 kırmızı (NFR-P2 testi) · canlılık penceresi bir güne açılınca 1 kırmızı (bayat heartbeat). Beşi geri alınınca 23/23 yeşil. Dürüst sınır: cross-tenant satırı fiilen `chat_supervisions_tenant` RLS politikası durduruyor — `liveByChat`'in `licenseId` filtresi kaldırıldığında testler yeşil kalıyor (politika tek başına yetiyor), yani o filtre derinlemesine savunma + indeks kullanımı içindir. — `apps/api/src/services/traffic/traffic-service.ts` · test `apps/api/test/integration/traffic.test.ts` (15→23, +8: B'nin lisansıyla A'nın sohbetine yazılmış satır A'nın board'unu boyamaz (13.2-c'nin FK tuzağı) · bayat heartbeat supervised üretmez · canlı satır `activity='supervised'`, tek satır · supervised > waiting · queued izlenirken de `queued` + `chatting_with` null · izlenirken insan/persona adlandırması bozulmaz · kapanmış sohbetin izlenmesi board'a satır eklemez · tüm board tek `liveByChat` çağrısıyla okunur) · tm 73.5

◐ **13.2-f teslim** — "Match all filters + Add filter" çekirdeği: `GET /traffic`'e altı ayrık, AND'lenen query parametresi (`activity` çoklu · `page_url_contains` · `came_from_contains` · `country_code` · `is_lead` · `group_id`); verilmeyen parametre kısıt getirmez, verilen HEPSİ sağlanmalı, OR modu YOK. Zod şeması `.strict()` (campaigns.ts:22 deseni) → bilinmeyen anahtar 400; `is_lead` `z.enum(['true','false'])` ile ayrıştırılır çünkü `z.coerce.boolean()` `Boolean('false')`=true üretip "lead olmayanlar"ı lead'lere çevirirdi. **Cevaplanamayan koşul = başarısız koşul:** `group_id` sohbetin taşıdığı bir olgudur (`chat_access`) → yalnız gezinen ziyaretçi onu sağlayamaz ve düşer; `page_url_contains`/`came_from_contains` canlı penceredeki ziyaretin taşıdığı olgudur → o ziyareti olmayan düşer. `group_id` **sorguya girmeden önce** kiracının grupları içinde doğrulanır ve yabancı/bilinmeyen id boş board döndürür (404 DEĞİL — NFR-S5, `customers.ts` kuralı). Kova sahiplenmesi filtreden ÖNCE (`seen.add`): filtrelenen bir sohbet/davet `browsing` olarak yeniden etiketlenmez, board'dan düşer. NFR-P2: sorgu sayısı artmaz — bir ziyaret koşulu istendiğinde board'ın üçüncü kaynağı için zaten yaptığı `visits` okuması öne alınır ve üç kovanın tamamına hizmet eder (dördüncü okuma AÇILMAZ); JSONB `pages` üzerinde indekssiz SQL LIKE yok (eşleşme JS de-dup adımında, `visitorPageUrls` yeniden kullanılarak); her kaynak taraması `take` sınırlı (≤500). Migration yok; kontrat re-bundle (155 path). **Testlerin kuralı ölçtüğü mutasyonla kanıtlandı:** `.strict()` düşünce 1 kırmızı · `wants()` hep true olunca 5 · ziyareti olmayan satır koşulu sağlar yapılınca 1 · sayfa filtresi sohbet satırlarına uygulanmayınca 1 · üçüncü kaynak ziyareti yeniden okuyunca (dördüncü round-trip) 1 · kova sahiplenmesi filtreden sonraya alınınca 1 · davet kaynağı yalnız `browsing` istendiğinde atlanınca 1 · grup kapısı kaldırılınca 1 · `browsing` takım filtresine rağmen üretilince 1. Dokuzu geri alınınca 43/43 yeşil. — `packages/contract/openapi/paths/traffic.yaml` · `apps/api/src/routes/traffic.ts` · `apps/api/src/services/traffic/traffic-service.ts` · test `apps/api/test/integration/traffic.test.ts` (23→43, +20) · tm 73.6

◐ **13.2-g teslim** — Traffic durum sekmeleri: saf `traffic-tabs.ts` (`TRAFFIC_TABS` — All + altı funnel durumu, rapor-1 §644 sırasıyla · `tabToActivity()` — seçilen sekmeyi 13.2-f'nin `activity` parametresine çevirir, `all` hiçbir kısıt eklemez · `countByTab()` — yüklü listeyi sekme başına sayar · `isTrafficTab()` — bilinmeyen URL değeri `all`'a düşer, hiç patlamaz). `TrafficPage.tsx`'e `role=tablist` şerit; seçim `useSearchParams`'ta (`?tab=`) kalıcı — `AuditLogPage.tsx`'in `setFilter`/`{replace:true}` deseni — deep-link/reload'da korunur ve bilinmeyen değer sessizce `all`'a düşer. **İstemci tarafı yeniden filtreleme yok:** sekme değişimi `['traffic', tab]` sorgu anahtarıyla YENİ bir `GET /traffic?activity=…` isteği açar, önceki yanıtı yeniden dilimlemez — tek doğruluk kaynağı sunucu. Bu yüzden sayaç yalnız *bilinen* kovalar için gösterilir: aktif sekmenin kendisi (gelen yanıt tam odur) ve, yanıt filtresiz board'sa (`all` aktifken), hepsi birden — filtreli bir sekmedeyken diğerlerine sahte `0` YAZILMAZ, rakam basitçe gösterilmez. Her sekme için anlamlı empty state (FR-EK-B.1, `EMPTY_STATE` sözlüğü — 7 ayrı başlık/açıklama). **Ek kapsam:** Supervise satır aksiyonu artık `registerSupervision` mutasyonuyla 13.2-d'nin `POST /chats/{id}/supervise`'ını da çağırıyor (navigate davranışı korunarak, kayıt sonucu beklenmeden) — böylece board'da `supervised` üretimi artık gerçek bir tıklamadan doğabiliyor, önceden yalnız elle yazılmış satırla görülebiliyordu (13.2-e notu). Migration/kontrat yok. — `apps/web/src/features/traffic/traffic-tabs.ts` (yeni) · `apps/web/src/features/traffic/TrafficPage.tsx` · test `apps/web/src/features/traffic/traffic-tabs.test.ts` (yeni, 13 — 7 sekme + sıra · `tabToActivity` her durum için tekil dizi, `all` `undefined` · `isTrafficTab` güvenli-başarısız · `countByTab` kovalar `all`'a toplanıyor + boş liste) · test `apps/web/src/features/traffic/TrafficPage.test.tsx` (yeni, 7 — varsayılan `all` + filtresiz istek · sayaçlar filtresiz board'da toplamı `all`'a eşit · sekme seçimi sunucuya yalnız o durumu soruyor · sekmeye özel empty state · URL'e yazma + reload'da geri yükleme (unmount/remount ile "reload" simülasyonu) · bilinmeyen `?tab=` değeri `all`'a düşüyor · Supervise satırı `POST /chats/{id}/supervise` çağırıyor). Regresyon: `apps/web/src/features/traffic/TrafficPage.test.ts` (6, `ACTIVITY` map) · `rowActions.test.ts` (8) hepsi yeşil kaldı; e2e `traffic.spec.ts` (1/1) — varsayılan `all` sekmesi hâlâ tüm board'u gösteriyor. tm 73.7

◐ **13.2-h teslim** — Filtre paneli UI + query builder: saf `traffic-filters.ts` (13.2-f'nin altı parametresini birebir örten `TRAFFIC_FIELD_DEFS`; alan başına EN FAZLA bir koşul — "Add filter" yalnız henüz eklenmemiş alanları sunar, iki satır aynı parametre için asla çakışmaz), `conditionError`/`conditionsAreValid` (FR-EK-A.1 istemci ön-doğrulaması) ve `buildTrafficParams` (yalnız GEÇERLİ koşullar parametre üretir; `country_code` büyük harfe çevrilir). `TrafficFilters.tsx`: "Match all filters" başlıklı panel, `Dropdown` (EK-C.2) ile "Add filter" menüsü, etiketli kaldırma düğmesi, "Clear". Satırlar bileşende YEREL durum (`rows`) — `select` alanları (activity/lead) anında committer, `text` alanları (page_url_contains/came_from_contains/country_code/group_id) 250ms debounce sonrası (`CustomersPage` deseni, satır başına ayrı zamanlayıcı). **`onChange` yalnız TÜM liste geçerliyken çağrılır** — geçersiz/boş bir satır varken üst bileşene hiç bildirim gitmez, yani istek de hiç atılmaz (KK'nın "istek atılmaz" şartı `enabled` bayrağı gerekmeden doğal sağlanıyor). Alan-altı hata yalnız satır "touched" olduktan sonra gösterilir (T4-a'nın `touched` deseni) — taze eklenen boş satır anında kırmızı yanmaz. `TrafficPage.tsx`: koşullar `?<field>=` URL parametrelerinde kalıcı (`conditionsFromSearchParams`/`handleFiltersChange`, `tab`'la aynı `{replace:true}` deseni); panelin kendi `activity` koşulu VARSA sekmenin yerine GEÇER (`resolveActivity` — "sekme = önceden dolu activity koşulu" maddesinin uygulanışı), yoksa sekme 13.2-g'deki gibi çalışır; diğer beş alan sekmeyle AND'lenir. **Varsayım (§C):** `group_id` bir `GET /groups` seçiciyle DEĞİL ham sayısal id metin kutusuyla filtrelenir — backend zaten yabancı/geçersiz id'yi sessizce boş board'a çeviriyor (13.2-f) ve KK bir seçici zorunlu kılmıyor; bir sonraki pencere isterse `GET /groups`'a bağlı bir seçiciye yükseltebilir (13.2-f'nin notu). — `apps/web/src/features/traffic/traffic-filters.ts` (yeni) · `apps/web/src/features/traffic/TrafficFilters.tsx` (yeni) · `apps/web/src/features/traffic/TrafficPage.tsx` · test `apps/web/src/features/traffic/traffic-filters.test.ts` (yeni, 23 — alan katalog bütünlüğü · her alan için geçerli/geçersiz değer · `buildTrafficParams` ekle/kaldır/ikisi-birlikte/geçersiz-parametresiz · `resolveActivity` sekme/panel önceliği · `conditionsFromSearchParams` round-trip) · test `apps/web/src/features/traffic/TrafficFilters.test.tsx` (yeni, 12 — 'Add filter' yeni satır açar · eklenmiş alan menüden düşer · select anında committer · text alanı boşken committemez · geçersiz değerde alan-altı hata + `onChange` ÇAĞRILMAZ · hızlı yazımda debounce sonrası TEK `onChange` · select debounce'suz · satır kaldırma · 'Clear' hepsini siler · etiketli kontroller). Regresyon: `TrafficPage.test.tsx` (7) — filtre eklenmeden önceki senaryolar (varsayılan istek, sekme geçişi, URL round-trip) değişmedi, boş koşul listesi hiçbir parametre eklemiyor. `pnpm -w typecheck` 0 (11/11) · `pnpm -w lint` 0 (8/8) · `pnpm -w test` 0 (`@nexa/web` 884/884, 849'dan +35) · `pnpm -w test:integration` 0 (1727/1727, regresyon — backend'e dokunulmadı) · `pnpm -w build` 0 (7/7) · e2e `traffic.spec.ts` 1/1 (regresyon). tm 73.8

◐ **13.2-i teslim** — `CustomerDetail`'e iki katkısal alan: `visits_count` (gerçek toplam — `visits[]` `MAX_VISITS=10` ile kırpılıyor, dizi uzunluğundan gerçek sayı çıkarılamaz) ve `groups` (bu ziyaretçinin sohbetlerinin yönlendirildiği takımlar, `chat_access.group_id` → `groups` tablosundan ad, distinct). `CustomerService.get()` üç okumayı `Promise.all` ile paralel yapıyor (custom fields + `tx.visit.count` + yeni `#groups()`); `#groups()` `chat: { customerId, licenseId }` join'iyle `chatAccess.findMany` okur, `Set` ile id'leri de-dup eder, sonra `groups` tablosundan `licenseId` + `id in (...)` ile adları çeker — `visits`/`chats` bloklarının license daraltma deseniyle birebir. Kontrat: `openapi.yaml` `CustomerDetail` şemasına iki alan `required` olarak eklendi, re-bundle edildi (155 path, `src/generated/api.ts` yenilendi); `apps/web/src/features/customers/types.ts` senkron. YENİ PATH/migration yok. — `apps/api/src/services/customers/customer-service.ts` · `packages/contract/openapi/openapi.yaml` · `apps/web/src/features/customers/types.ts` · test `apps/api/test/integration/customers.test.ts` (+5: 12 ziyaretli müşteride `visits.length===10` ama `visits_count===12` (kırpma tuzağının kanıtı) · iki gruba açık sohbeti olan müşteride `groups` iki kayıt (dedup: aynı gruba ikinci sohbet tekrarlamıyor) · sohbeti olmayan müşteride `groups` boş dizi · CROSS-TENANT: B lisansının ziyaretleri A'nın `visits_count`'una girmiyor · CROSS-TENANT: B'nin grubuna açık sohbet A'nın `groups`'unda görünmüyor). `pnpm -w typecheck` 0 (11/11) · `pnpm -w lint` 0 (8/8) · `pnpm -w test` 0 (`@nexa/api` 2269/2269, `customers.test.ts` 32/32) · `pnpm -w test:integration` 0 (1732/1732 — `mcp-tools.test.ts`'te bir turda gözlenen tek kırmızı izole + tam-suite tekrarında yeniden koşulup yeşile döndü, bu dilimin dosyalarıyla ilgisi yok, flaky) · `pnpm -w build` 0 (7/7) · e2e `customers.spec.ts` 6/6 (regresyon — UI 13.2-j'de). tm 73.9

◐ **13.2-j teslim** — Ziyaretçi 360° panel: 13.2-i'nin kontrata eklediği `visits_count`/`groups`/`came_from` alanları ilk kez render edildi (kontrat teslim edilmişti, tüketen UI eksikti). `CustomerDetailPanel.tsx`'in dl özet bloğuna `Visits` satırı — değer `customer.visits_count` (gerçek toplam, `visits[]`'in `MAX_VISITS=10` kırpmasından BAĞIMSIZ) — ve `visits_count > 1` iken yanında `StatusDot tone="info"` ile "Returning visitor" rozeti. Her ziyaret satırında `came_from` doluysa "Came from …" satırı, düz metin (dosyanın "Visited pages" kartındaki URL render kararıyla birebir aynı gerekçe: "a link would be a one-click path to whatever a stranger put in the address bar" — visitor girdisi hiçbir yerde `<a>` olarak render edilmez); `came_from` null'da satır hiç yazılmaz (sessiz atlama). Yeni `Groups` kartı — "Conversations" kartıyla birebir iskelet (aynı `Card`/başlık/`divide-y` deseni) — boşsa "Not routed to a team yet. Groups appear here once one of their conversations is assigned." (FR-EK-B.1), doluysa takım adları. PII sınırı: `Visit.ip` (schema.prisma `ip` alanı, NFR-S9) frontend `Visit` tipinde hiç yok, dolayısıyla render edilemez; negatif test bunu API yanıtına sızdırılmış bir `ip` alanı simüle ederek de doğruluyor (kontrata rağmen sızsa bile panel göstermez). — `apps/web/src/features/customers/CustomerDetailPanel.tsx` · test `apps/web/src/features/customers/CustomerDetailPanel.test.tsx` (yeni, 8 — `visits_count` dl'de görünür + `visits_count<=1`'de rozet yok · `visits_count>1`'de "Returning visitor" rozeti, kırpılmış `visits` dizisinden bağımsız · `came_from` dolu satırda metin görünür ve `role=link` YOK · `came_from` null'da satır sessizce yok · Groups boş → empty state · Groups dolu → takım adları · NEGATİF: sızdırılmış `ip` alanı DOM'a hiç render edilmiyor · regresyon: Custom fields/Visited pages/Conversations kartları kırılmadı). `types.ts`'e dokunulmadı (13.2-i'de zaten tam). `pnpm -w typecheck` 0 (11/11) · `pnpm -w lint` 0 (8/8) · `pnpm -w test` 0 (`@nexa/web` 892/892, 884'ten +8) · `pnpm -w test:integration` 0 (1732/1732, regresyon — backend'e dokunulmadı) · `pnpm -w build` 0 (7/7) · e2e `customers.spec.ts` 6/6 (regresyon). tm 73.10

◐ **13.2-k teslim (doğrulama) — ama satır `◐` KALIYOR, gerekçesi aşağıda.** Tek e2e senaryosu 13.2-a…j'nin tamamını TEK gerçek ziyaretçi üzerinde birleştiriyor (`traffic.spec.ts`, +1 test, 46→~230 satır): widget'tan mesaj → `GET /customers` en yeniyle kimlik çözümü (anonim olduğu ASSERT ediliyor, yanlışlıkla seed müşterisi seçilirse test boşa geçmesin diye) → `PATCH /customers/{id}` ile ad (paylaşılan board'da "Unnamed visitor" satırları ayırt edilemez) → `POST /chats/{id}/deactivate` ile sohbeti kapatıp ziyaretçiyi `browsing` kovasına düşürme → **7 sekme** görünür + Browsing sekmesi ziyaretçiyi listeliyor → **filtre:** "Add filter" → "Page URL contains"; önce EŞLEŞEN değer (`demo.html`) satırı KORUYOR (koşulun board'u toptan boşaltmadığının pozitif kontrolü), sonra eşleşmeyen değer satırı düşürüyor + satır sayısı azalıyor + empty state çıkıyor, "✕" ile koşul kaldırılınca satır ve sayı geri geliyor → **supervise:** browsing satırından "Start chat" (assign_to_me → `queuePosition` null, yoksa `queued` `supervised`'ı ezerdi) → board `Chatting` → "Supervise chat" → board `Supervised` (13.2-d + 13.2-e uçtan uca) → **360° panel:** satırdan "Edit contact" → `/app/customers?customer={id}` deep-link'i paneli açıyor, `Visits` sayacı + "Visited pages"te `demo.html` + `Groups` kartı takım adıyla (empty state DEĞİL) doğrulanıyor. **a11y (NFR-A11Y4/A11Y5):** tablist artık ok tuşlarıyla geziliyor — bu turda YAZILDI, yoktu: roving `tabIndex` (şerit tek Tab durağı, yedi ayrı durak değil) + ArrowRight/ArrowLeft (iki yönde sarma) + Home/End, aktivasyon focus'u izliyor; `aria-selected` tek satırda doğrulanıyor (aynı anda tam olarak bir seçili sekme). **NFR-P2 ölçümü:** filtreli `GET /traffic?activity=chatting&activity=supervised&page_url_contains=demo.html`, 1 ısınma + 20 örnek → **medyan 28–34 ms · p95 55–132 ms · max 132 ms** (bütçe 150 ms okuma); assert medyan üzerinde, kuyruk yalnız KAYDEDİLİYOR — ölçüm `tsx watch` dev sunucusunda alındı, kuyruğu sorgudan çok harness'i anlatır, yani NFR-P2'nin p99 üretim iddiasını DESTEKLER ama tek başına KANITLAMAZ (dürüst sınır). **E2E'nin bulduğu gerçek kusur (düzeltildi):** `TrafficPage.tsx` scope'ları çıplak `Array.includes` ile okuyordu; sunucu `hasAnyScope`/`expandScope` ile `chats--all:rw` → `chats--all:ro` genişletmesi yaptığı için owner/admin'in scope kümesinde LİTERAL bir `:ro` yok — sonuç: **"Supervise chat" düğmesi tam olarak supervise eden herkes için (owner+admin) devre dışıydı**, API'nin kabul edeceği bir çağrıda. `hasAnyScope` (`@nexa/types`) paylaşılan genişleticisine geçirildi; istemci ve rota artık aynı cevabı veriyor. — `apps/e2e/tests/traffic.spec.ts` · `apps/web/src/features/traffic/TrafficPage.tsx` · test `apps/web/src/features/traffic/TrafficPage.test.tsx` (7→11, +4: roving tabIndex + ok/Home/End + tek `aria-selected` · ok tuşu seçimi sunucuya tıklamayla aynı isteği atıyor · owner'ın yazma scope'unun ima ettiği satır aksiyonları ENABLED · salt-okur çağıran için Supervise enabled ama Assign/Edit disabled). Kapı: `pnpm -w typecheck` 0 (11/11) · `pnpm -w lint` 0 (8/8) · `pnpm -w test` 0 (`@nexa/web` 896/896, 892'den +4) · `pnpm -w test:integration` 0 (1732/1732) · `pnpm -w build` 0 (7/7) · **tam e2e süiti 94/94** (73→…, +1 yeni; 26 spec dosyası regresyonuyla birlikte). tm 73.11

**AÇIK KALAN (satırın `◐` sebebi) — `visits.came_from` yazma yolu yok.** KK'nın istediği "360° panelde 'Came from' metni" e2e'de ASSERT EDİLEMEDİ, çünkü ürün bu alanı hiçbir yerde doldurmuyor: `CustomerService.recordPageView` bir `referrer` parametresi kabul ediyor ama TEK çağıranı (`apps/api/src/routes/customer.ts`, `POST /customer/chat`) onu hiç geçirmiyor; widget da göndermiyor ve kontratta böyle bir alan yok. Sonuç: `came_from` ürünün üretebildiği HER ziyaret için `null` — yani 13.2-j'nin "Came from …" satırı ve 13.2-f'nin `came_from_contains` filtresi altı filtreden biri olarak ÖLÜ. Render yolu `CustomerDetailPanel.test.tsx`'te, filtre yolu `traffic.test.ts`'te (fixture'ın DB'ye elle yazdığı satırla) kaplı; eksik olan yalnız YAZMA. Bu bir doğrulama değil ürün işi (loader → frame parametresi → widget gövdesi → OpenAPI → rota → servis, ayrıca NFR-S9 tarafında "referrer'ı saklıyoruz" kararı) ve 13.2-k'nin KAPSAM DIŞI maddesinin ("yeni ürün davranışı eklemek") tam ortasına düşüyor → ayrı task açıldı (tm 111). O kapanınca 13.2 satırı `✅`ya döner. Eski not (Faz-0'dan): 03.1.1'in Faz-0'da ertelenen kalan sekmeleri (Supervised/Invited/Browsing) bu kaleme dahildi (§3.13 kararı) — üçü de artık e2e'de görünür ve sayılıyor. → §5.2

**AÇIK KALAN KAPANDI (13.2-l · tm 111) — satır `◐` → `✅`.** `visits.came_from` yazma yolu uçtan uca bağlandı, contract-first: OpenAPI `sendCustomerMessage` gövdesine katkısal `referrer` (`maxLength: 2048`) → `startSchema`'ya `referrer` + gövdenin tamamına `.strict()` (yanlış yazılmış `referer` artık 400, sessizce düşmüyor) → rota `recordPageView`'a geçiriyor → servis `sanitizeReferrer` ile yazıyor. Host sayfada okuyan tek kod loader: `document.referrer`'ı `host_referrer` frame parametresine koyuyor (frame'in KENDİ `document.referrer`'ı gömüldüğü sayfadır, o yüzden widget tarafında fallback YOK — olsaydı her ziyaretçi "zaten üstünde olduğu siteden gelmiş" görünürdü). **NFR-S9 kararı (§C-A16): yalnız origin+path saklanır, query string + fragment düşürülür** — `hostPageUrl`'ün kararıyla aynı gerekçe; kural `@nexa/types`'ta `sanitizeReferrer` olarak TEK yerde, hem loader (host sayfada, düşen kısım tarayıcıdan hiç çıkmasın) hem servis (gövde istemci girdisidir) çağırıyor. `came_from` yalnız ziyaret OLUŞURKEN yazılır: "came from" varışın özelliğidir, sonraki sayfa onu ezmez. Dosyalar: `packages/types/src/referrer.ts` (yeni) · `packages/contract/openapi/paths/customer-chat.yaml` · `apps/api/src/routes/customer.ts` · `apps/api/src/services/customers/customer-service.ts` · `apps/widget/src/loader.ts` · `apps/widget/src/widget.ts` · `apps/widget/src/api.ts`. Testler: `packages/types/src/referrer.test.ts` (6) · `apps/widget/src/loader.test.ts` (+3) · `apps/widget/src/widget.referrer.test.ts` (2, yeni) · `apps/api/test/integration/customer-chat.test.ts` (+7: yazma · doğrudan girişte null · query düşüyor · aynı ziyarette varış referrer'ı korunuyor · 2048 aşımı 400 · `.strict()` 400 · cross-tenant) · `apps/api/test/integration/traffic.test.ts` (+2: widget'ın KENDİ yazdığı referrer'ı `came_from_contains` buluyor + komşu tenant görmüyor). E2E: 13.2-k senaryosu artık ziyaretçiyi ÜÇÜNCÜ bir origin'den (`searchy.localhost:5174`) link'e tıklayarak getiriyor — 360° panelde "Came from …" düz metin (link DEĞİL) görünüyor ve "Add filter → Came from contains" o ziyaretçiyi buluyor, eşleşmeyen parça düşürüyor (`kanit/13.2-l-came-from-filter.png`). Kapı: typecheck 0 · lint 0 · `pnpm -w test` 0 · integration 0 (1741/1741) · build 0 · e2e **94/94**. tm 111 → §5.2

#### K05.6 — 05.6 · Skill şablon kataloğunu 31+'a genişlet (ADR-14 uyumlu ikame)

✅ 05.1/05.2 Skill şablon galerisi **teslim** v1 (kendi deterministik yerel kataloğu var). Görsel canvas YAPILMAZ. §C-A14. → §5.2. **05.6-tmpl31-a teslim (2026-08-09):** `SkillTemplate`'e opsiyonel `badge?: 'popular'\|'essential'` alanı (kategoriden ayrı bir kart vurgusu, FR-MOD-05.2) + katalog invariant testleri sıkılaştırıldı — id benzersizliği artık çakışanları listeleyen bir assert'le zorunlu, `summary` ≤100 karakter sınırı (`MAX_TEMPLATE_SUMMARY_LENGTH`), badge/category ayrışma testi — `apps/web/src/features/playbook/templates.ts` · test `apps/web/src/features/playbook/templates.test.ts` (15, +2) · tm 98.1. Mevcut 8 kayıt değişmedi (badge opsiyonel, içerik eklenmedi — kapsam dışı). **05.6-tmpl31-b teslim (2026-08-09):** Kataloğa 25 yeni `SkillTemplate` (8→33, PRD §5.3 "31+" hedefi karşılandı) — kategori dağılımı dengeli (prebuilt/ai/trending 11/11/11), her kaydın `steps`'i `validateSteps` eşdeğeri `stepIsValid` mirror'ından geçiyor, `badge` alanı 4 kayıtta seçmeli kullanıldı (popular/essential); mevcut 8 kaydın id/kategori/davranışı DEĞİŞMEDİ (yeni regresyon testiyle kilitlendi) — `apps/web/src/features/playbook/templates.ts` · test `apps/web/src/features/playbook/templates.test.ts` (15→18, +3: `SKILL_TEMPLATES.length>=31` KK sayısal kapısı + orijinal 8 kaydın id/kategori regresyonu) · tm 98.2. **05.6-tmpl31-c teslim (2026-08-09):** Kataloğun kullanıcıya görünen `name`/`summary` metinleri için TR/EN i18n anahtarları eklendi (`playbook.template.<id>.name`/`.summary`, 33 kayıt × 2 dil) — `apps/web/src/lib/i18n.ts`'in mevcut `nav.*` desenini izler; anahtar-türetme `templateNameKey`/`templateSummaryKey` (`templates.ts`) ile yapılır, ham `id` string'i iki dosyada elle tekrarlanmaz — bir yazım hatası testin `hasMessage` doğrulamasını kırar (negatif-önce KK). `instruction`/`steps` **bilinçli olarak** i18n'e taşınmadı (AI'ya giden talimat metni) — regresyon testiyle bu sınır kilitlendi. UI tüketimi (`TemplateGallery.tsx`/`RecommendedSkills.tsx`'in `t()` çağırması) bu dilimin kapsamında DEĞİL — DOSYALAR listesi yalnız `templates.ts`/`i18n.ts`/`templates.test.ts`; galeri ayrıca -d'de (arama/sanallaştırma) elden geçecek — `apps/web/src/lib/i18n.ts` (yeni `hasMessage()` + 66 katalog anahtarı) · `apps/web/src/features/playbook/templates.ts` (yeni `templateNameKey`/`templateSummaryKey`) · test `apps/web/src/features/playbook/templates.test.ts` (23, +5: her kaydın TR/EN anahtarı var · EN katalog `name`/`summary` alanıyla senkron · TR gerçekten çevrilmiş (anahtara/EN'e düşmüyor) · instruction/steps anahtarı YOK · locale değişince galeri metni değişir ama `templateToDraft` davranışı değişmez) · tm 98.3. **05.6-tmpl31-d teslim (2026-08-09):** `TemplateGallery.tsx` kategori bazlı gruplu grid'den debounce'lu (200ms) ad/özet araması + kategori sekmesi (`role="tablist"`, `skill-tabs.ts`/`kb-tabs.ts` deseniyle aynı) + tek sütunlu, mevcut `VirtualList` primitifine (T6-a, tm 30) taşınmış bir listeye geçti — her satır sabit `ROW_HEIGHT=88`px (primitifin tek sert kısıtı; `requiresIntegration` yoksa satır kısalmasın diye o satır `aria-hidden` + `text-transparent` ile yine de ayrılır). Boş sonuç `EmptyState` + aktif filtre varsa "Clear filters" gösterir. Mevcut a11y sözleşmesi (Escape/backdrop kapama, açılışta Close düğmesine focus) davranışça DEĞİŞMEDİ — üçü de artık ayrı regresyon testiyle kilitli (öncesinde yalnız Escape testliydi, backdrop/focus hiç test edilmiyordu) — `apps/web/src/features/playbook/TemplateGallery.tsx` · test `apps/web/src/features/playbook/TemplateGallery.test.tsx` (5→11, +6: kategori sekmesi sayımları · arama daraltır · kategori sekmesi doğru alt küme · sanal pencere DOM satırı << 33 · boş sonuç + Clear filters kurtarır · backdrop kapama · açılış focus'u) · tm 98.4. Kapsam dışı bırakılan `RecommendedSkills.tsx` şeridi dokunulmadı (davranışı korunuyor). **Dosya listesinin dışına** yalnız `apps/e2e/tests/playbook.spec.ts` için tek zorunlu istisna yapıldı: eski "gruplu heading" DOM'unu doğrulayan e2e artık gerçekle uyuşmuyordu (sekme oldu), CONVENTIONS'ın "ilgili e2e yeşil" kapısını objektif tutmak için güncellendi + KK'nın istediği "arama ile şablon bulup skill oluşturma" e2e'si eklendi (`playwright test playbook.spec.ts` — 3/3 yeşil). **05.6-tmpl31-e teslim (2026-08-09, kapanış):** Tam DoD kapısı koşuldu: typecheck ✅ (8 paket) · lint ✅ (8 paket) · build ✅ (7 paket) · `pnpm -w test` 767/774 (7 kırmızı = bilinen **tm 108** makine-locale defekti, `BillingPage.test.tsx`+`ReportsPage.test.tsx`, bu dilimin dosyalarına dokunulmadı) · `pnpm -w test:integration` 1532/1533 (1 kırmızı = bilinen **tm 107** tarihe-bağlı defekti, `scheduled-reports-sweep.test.ts`, izole tekrar koşuyla da aynı kırmızı doğrulandı) · e2e `pnpm --filter @nexa/e2e exec playwright test playbook.spec.ts` **3/3 yeşil** — KK'nın istediği "galeri aç → ara → şablon seç → editör ön-dolu açılır → (persisted skill)" akışı `finds a template by search and creates a skill from it` testinde uçtan uca doğrulanıyor (bu test tm 98.4'te zaten eklenmişti — bu tur mükerrer dosya değişikliği yapmadı, yalnız doğruladı). `05.6-tmpl31` **tamamlandı (5/5 alt-görev)** — tm 98.5.

#### K5.3-KB — §5.3-KB · Public KB (SEO'lu self-servis)

✅ KK PRD §6'da yok → KK-türetilmiş. **Public (kimlik doğrulamasız) yüzey = yeni erişim sınırı.** PRD §11.1/9 pazarlama sitesi/blog **kapsam dışıdır** — bu ürün-içi KB, karıştırılmaz. **PUBKB-a teslim (veri modeli — RLS'li migration, kontrat/route YOK):** üç yeni license-scoped tablo `kb_categories`/`kb_articles`/`kb_settings` (`knowledge_sources` DEĞİŞMEDİ, §C-PUBKB-1); üçünde `ENABLE ROW LEVEL SECURITY` + `_tenant` policy (`nexa_current_license()`); `@@unique([licenseId, slug])` kb_articles+kb_categories'te, `kb_settings.public_slug` GLOBAL unique + license-singleton PK; `kb_articles.status` CHECK (draft|published) + `(license_id, status, published_at DESC)` index — `apps/api/prisma/schema.prisma` · migration `20260803110000_public_kb` · test `apps/api/test/integration/public-kb-schema.test.ts` (15: self-servis kategori bağı + kategori silince link temizlenir + SEO/publication kolonları round-trip + status CHECK reddi + slug unique (aynı/başka lisans) + kb_settings singleton reddi + public_slug global-unique reddi + RLS cross-tenant SELECT/UPDATE/DELETE + kategori/settings) · `db:check-drift` temiz · tm 76.1. **PUBKB-b teslim (yönetim CRUD + kontrat + yayın durumu):** kontrat `packages/contract/openapi/paths/kb.yaml` (11 op: `POST/GET /kb-articles`, `GET/PATCH/DELETE /kb-articles/{id}`, `POST/GET /kb-categories`, `PATCH/DELETE /kb-categories/{id}`, `GET/PUT /kb-settings`) + `KbArticle`/`KbCategory`/`KbSettings` şemaları — bundle+tip regen, `contract-parity.test.ts` çift-yönlü yeşil; route `apps/api/src/routes/kb.ts` (scope `agents-bot--all:ro/:rw` yeniden kullanım §C-PUBKB-6, YENİ scope/ApiError tipi YOK); makale varsayılan `status='draft'`+`published_at=null`, yalnız açık PATCH `status=published` `published_at` damgalar / unpublish null'lar (KK "yalnız yetkili eylemle yayınlanır"); `PUT /kb-settings` `minimumRole:'admin'` (KK "yalnız yönetici açar") + `public_slug` global-unique; slug normalizasyonu ASCII-only, transliterasyon yok→reddet `apps/api/src/lib/kb-slug.ts`; publish/unpublish + settings.enabled audit (`kb.article_published`/`kb.article_unpublished`/`kb.settings_updated`, NFR-C2) — test `apps/api/test/integration/kb.test.ts` (20: CRUD + draft-default + publish/unpublish audit + cross-tenant 404 + slug reddi + minimumRole 403 + settings singleton) + unit `apps/api/src/lib/kb-slug.test.ts` (8) · tm 76.2. **PUBKB-c teslim (anonim public okuma çekirdeği — BÖLÜNMEZ):** slug→license çözümleyici `kb_resolve_public_slug(TEXT)` SECURITY DEFINER (`auth_resolve_organization_license` kardeşi §C-PUBKB-5; YALNIZ `kb_settings.enabled=true` + license `canceled` DEĞİL eşleşir, `REVOKE EXECUTE FROM PUBLIC` + `GRANT TO nexa_app`) — migration `20260803120000_kb_public_resolver`; 3 anonim route `apps/api/src/routes/public-kb.ts` (`config.public:true` + `publicKbRateLimit`, principal YOK — tenant yol parametresinden): `GET /public/kb/{workspaceSlug}/articles` (yalnız yayınlanmış, keyset sayfalama), `.../articles/{articleSlug}` (gövde detayda), `.../categories`; her istek slug çözümle→`withTenant`→ZORUNLU `status='published' AND published_at IS NOT NULL` filtresi (RLS + filtre birlikte izolasyon); TEK ayırt edilemez **404** (bilinmeyen slug · KB kapalı · license canceled · taslak · başka tenant makalesi — NFR-S5, 403 yok, aynı gövde/aynı tip/aynı mesaj); yanıt gövdesinde `license_id`/`created_by`/iç kimlik YOK; geçerli ajan token'ı yetki yükseltmez (principal göz ardı edilir); anon SEO trafiği için ayrı yüksek kova `rl:pubkb:<ip>` (`RATE_LIMIT_PUBKB_PER_MIN` def 300 · `rate-limit.ts` route-config `publicKbRateLimit`, `skipRateLimit` KULLANILMADI); kontrat `packages/contract/openapi/paths/public-kb.yaml` (3 op `security:[]` + `PublicKbArticle`/`PublicKbArticleSummary`/`PublicKbCategory` şemaları — bundle+tip regen, `contract-parity.test.ts` çift-yönlü yeşil) — test `apps/api/test/integration/public-kb.test.ts` (12: unknown/disabled/canceled/draft/cross-tenant-çift-yön 404 + enumeration tek-gövde + no-elevation + no-leak + kategori sıra + keyset sayfalama + rate-limit ayrı-kova/429) · tm 76.3. **PUBKB-d teslim (makale gövdesi güvenli render çekirdeği — BÖLÜNMEZ):** saf, I/O'suz `apps/api/src/lib/kb-render.ts` → `renderArticleBody()` escape-first sınırlı markdown; ZORUNLU sıra (1) TÜM girdi HTML-escape (`& < > " '`, `&` önce) → (2) yalnız escape'li metinde beyaz-liste: `##`/`###`→`<h2>`/`<h3>`, blank-satır paragraf, `-`→`<ul><li>`, `**kalın**`, `` `kod` ``, `[metin](url)` → (3) link yalnız `http:`/`https:` şema (javascript:/data:/vbscript:/protokol-göreli `//`/göreli reddedilir → link düz metne düşer), üretilen `<a rel="nofollow noopener ugc">` → (4) ham HTML asla geçmez (girdideki `<script>`/`<img onerror>` adım 1'de metne döner) → (5) doğrusal tarama + 100K girdi tavanı + `[`/`]`-sınırlı link sınıfları ⇒ ReDoS/katastrofik geri izleme yok. Ayrıca `renderPlainExcerpt()` (meta description, etiketsiz, çıktıda `<` yok). Yeni sanitizasyon bağımlılığı EKLENMEDİ (§C-PUBKB-3); `web-crawler.ts htmlToText` (ters yön, entity DECODE eder) yeniden KULLANILMADI — test `apps/api/src/lib/kb-render.test.ts` (24: önce negatif — script/img/iframe/style/svg tag üretilmez · javascript/data/vbscript/`//` şema düşer · çift/iç içe kodlama decode edilmez · link metni/URL'inde `"`/`>` ile attribute kaçışı kırılmaz · aşırı uzun/derin girdi süre tavanı; sonra pozitif h2/h3/paragraf/liste/kalın/kod/link + determinizm + KK 4 doğrulama) · `typecheck`/`lint`/`unit`(335)/`build` exit 0; kb-render yalnız kendi testinden import ediliyor (route/DB yüzeyi yok → integration/e2e etkilenmez) · tm 76.4. **PUBKB-e teslim (SEO'lu sunucu-render HTML yüzeyi):** iki anonim `text/html` sayfa — KB ana sayfası `GET /public/kb/{workspaceSlug}` (kategoriye göre gruplu yayınlanmış makale listesi) + makale sayfası `GET /public/kb/{workspaceSlug}/{articleSlug}` — `apps/api/src/routes/public-kb-html.ts` (`config.public:true` + `publicKbRateLimit`); veri yolu PUBKB-c ile PAYLAŞILIR (kopyalanmaz, çağrılır): resolver + yayın filtresi tek tanıma `apps/api/src/lib/kb-public-read.ts`'e çıkarıldı (`resolvePublicKbWorkspace`/`publishedArticleWhere`; `public-kb.ts` de bunları çağırır); HTML üretimi saf, I/O'suz `apps/api/src/lib/kb-page.ts` — her sayfa `<title>` (seo_title ?? title), `<meta name=description>` (seo_description ?? excerpt → PUBKB-d `renderPlainExcerpt`), `<link rel=canonical>`, OpenGraph (og:title/description/type/url), `Article` JSON-LD (`<`/`>`/`&`→`\uXXXX` ⇒ `</script>` bloğu kapatamaz), `<meta name=robots content="index, follow">` (chat.html noindex'inin bilinçli tersi), `lang` attr, tek `<h1>`, `<main>` + `<nav>` breadcrumb landmark'ları, JS'siz ilk boyama (`<script src>` YOK — tek script inert JSON-LD); gövde PUBKB-d `renderArticleBody` çıktısıdır (escape'li tek HTML; diğer HER değer `escapeHtml`'den geçer — kb-render'dan export edildi, ikinci kaçış kopyası yok); TEK ayırt edilemez HTML **404** (`noindex`, içerik yok) her miss için (bilinmeyen slug/KB kapalı/canceled/taslak/başka tenant/bozuk slug — NFR-S5); `Cache-Control: public, max-age=60` + güçlü ETag → eşleşen `If-None-Match` 304; rota ayrımı `articles`/`categories` statik segmentleri JSON okuyucuda kalır (Fastify statik > parametre, gölgeleme yok); kontrat `packages/contract/openapi/paths/public-kb.yaml` +2 op `security:[]` (`getPublicKbHome`/`getPublicKbArticleHtml`, yanıt `text/html`) — bundle+tip regen, `contract-parity.test.ts` çift-yönlü yeşil — test `apps/api/test/integration/public-kb-html.test.ts` (14: taslak/disabled/canceled/cross-tenant-çift-yön 404 + metin sızmaz · XSS uçtan-uca aktif tag üretilmez · seo_title/description attribute kaçışı kırılmaz · JS'siz başlık+gövde ilk boyama · canonical/OG/JSON-LD makale alanlarıyla eşleşir · `</script>` JSON-LD kaçışı · a11y tek-`<h1>`/lang/main+nav landmark/başlık atlamaz · ana sayfa liste+link · rota gölgelememe · ETag/304) · `typecheck`/`lint`/`unit`(335)/`build`/`integration`(1160) exit 0 · tm 76.5. **PUBKB-f teslim (sitemap.xml + robots.txt):** `apps/api/src/routes/public-kb-sitemap.ts` (`config.public:true` + `publicKbRateLimit`) — iki anonim rota `GET /public/kb/{workspaceSlug}/sitemap.xml` ve `.../robots.txt`; veri yolu PUBKB-c/e ile PAYLAŞILIR (`kb-public-read.ts`'in `resolvePublicKbWorkspace`/`publishedArticleWhere`'i çağrılır, kopyalanmaz — liste PUBKB-e'nin sayfalarından asla sapamaz); sitemap: yalnız `status='published'` makaleler, her `<loc>` `escapeXml` ile kaçırılır (`& < > " '`), `<lastmod>` = `updatedAt` ISO-8601, 50k URL tavanı (aşarsa ilk N, sitemap index v3 kapsam dışı); bilinmeyen/KB-kapalı/license-canceled workspace → 404 (NFR-S5); robots.txt aynı miss'i `Disallow: /` + 200 olarak yanıtlar (bir robots.txt isteği asla hata değildir), erişilebilir KB için `Allow: /public/kb/{slug}/` + mutlak `Sitemap:` URL'i; rota ayrımı PUBKB-e'nin deseniyle `sitemap.xml`/`robots.txt` `kb.ts`'in `RESERVED_ARTICLE_SLUGS`'ına eklendi (bir makale bu adları alamaz, Fastify statik>parametre önceliğini garanti eder). Kontrat: `packages/contract/openapi/paths/public-kb.yaml` +2 op `security:[]` (`getPublicKbSitemap` `application/xml` · `getPublicKbRobots` `text/plain`) — bundle+tip regen, `contract-parity.test.ts` çift-yönlü yeşil — test `apps/api/test/integration/public-kb-sitemap.test.ts` (9: unknown/disabled/canceled → 404+Disallow · taslak sitemap'te yok · cross-tenant çift-yön · XML-injection kaçışı + well-formed doğrulama · N yayınlanmış makale → N `<url>`+ISO lastmod · robots Allow+Sitemap içeriği · rota gölgelememe) + `kb.test.ts`'e +1 (reserved-slug create/rename reddi, 4 kelime) · `typecheck`/`lint`/`build`/`integration`(1170) exit 0 (unit değişmedi — sitemap saf route, ayrı unit testi yok) · tm 76.6. **PUBKB-g teslim (admin: KB makale listesi + durum sekmeleri):** saf modül `apps/web/src/features/playbook/kb-tabs.ts` (`knowledge-tabs.ts`'in kardeşi) — durum sekmeleri `all`/`published`/`draft` temiz bir partition (`filterArticlesByTab`/`countArticlesByTab`, All=Published∪Drafts, örtüşme/kayıp yok → KK "yönetilebilir bilgi bankası" payı) + kategori+arama saf daraltma tek modülde (`applyKbControls`/`articleMatchesControls`/`hasActiveKbFilters`, debounce çağıran bileşende — `skill-filter.ts`'in tek-kontrol-yüzeyli kardeşi). `KbArticleList.tsx` PUBKB-b'nin `GET /kb-articles` + `GET /kb-categories`'ini tüketir, read-only (oluşturma/düzenleme/publish YOK — PUBKB-h); `role=tablist`+`aria-selected`+`aria-controls` sekmeleri (SKILL_TABS deseninin kopyası, NFR-A11Y1), satırda başlık + kategori adı (yoksa "Uncategorized") + `StatusDot` durum rozeti + `formatDate(updated_at)`; her sekme için AYRI anlamlı empty state (`EMPTY_BY_TAB`, boş dikdörtgen yok — FR-EK-B.1) + hiç makale yokken üst-seviye empty state (sekmeler bile gizlenir) + yükleme `ListSkeleton` + hata `ErrorNotice`. `PlaybookPage.tsx`'e beşinci "Public KB" görünüm sekmesi kaydedildi (`PlaybookView` genişletildi; AI'nin kendi `knowledge` sekmesinden ayrı kavram). `KbArticle`/`KbCategory` tipleri `playbook/types.ts`'e eklendi (dizinin yerleşik kalıbı — Skill/AiAgent gibi elle aynalanan JSON şekli; `@nexa/types` paketinde KbArticle yok) — test `kb-tabs.test.ts` (11: partition/All/sayaç + arama+kategori+ikisi-birlikte+tab-üstüne-uygulanır+hasActiveKbFilters) + `KbArticleList.test.tsx` (7: hiç-makale-yok empty + sekme sayaçları/aria-selected + sekme değişince liste daralır+satır alanları + klavye ile sekme gezinme (Tab+Enter) + sekmeye-özel empty state + arama/kategori/clear + yükleme skeleton + hata notice) · `typecheck`/`lint`/`build` (workspace 11/11 task) exit 0 · `@nexa/web` unit 583/583 (14/14 playbook dosyası dahil) yeşil · tm 76.7. **PUBKB-h teslim (admin: makale editörü — içerik+SEO alanları + publish/unpublish + public link):** `KbArticleEditor.tsx` — Title(zorunlu)/Slug/Category(+"yeni kategori" hızlı ekleme)/Body(desteklenen sınırlı-markdown'ı anlatan yardım metniyle)/Excerpt/SEO title+SEO description(60/155 karakter sayacı) alanları, T4-a `useForm` primitifiyle (zorunlu title/body validator'ı + saf slug validator `kb-slug.ts`); slug başlıktan otomatik türer (`deriveKbSlug`) — elle değiştirilince veya mevcut (var olan) makalede baştan kilitlenir (KK "kalıcı adres" payı — bir içerik düzenlemesi yayındaki URL'i asla kaydırmaz); Publish/Unpublish butonu içerikten bağımsız `PATCH status` mutasyonu → "Published" rozeti + Public link satırı görünür (`GET /kb-settings` `public_slug` + makale slug'ından üretilir, kopyala butonu) + `kb_settings.enabled=false` iken uyarı bandı; backend'den dönen slug/kategori çakışması ilgili alanın altına düşer (genel toast değil — `fieldFromMessage` "alan: mesaj" ayrıştırıcısı); T5-a `useCloseGuard` ile kirli-form kapatma onayı. `KbArticleList.tsx`'e "New article" butonu + satır tıklaması eklendi (`canEdit` — PlaybookPage'in mevcut `agents-bot--all:rw` scope kontrolü yeniden kullanıldı, yeni scope YOK) — test `KbArticleEditor.test.tsx` (11: zorunlu alan+submit disable, slug otomatik türetme+kilit, mevcut makalede slug sabit kalır, SEO alanları round-trip, publish/unpublish+public link, kb kapalı banner, backend slug çakışması alan-altı hata, dirty-guard onay/onaysız, read-only mod, a11y label) + `kb-slug.test.ts` (9: türetme büyük harf/boşluk/tire + validator boş/karakter/rezerve-kelime) + `KbArticleList.test.tsx` +3 (canEdit=false'ta New/tıklama gizli, New article create-modu açar, satır tıklaması edit-modu açar) · `typecheck`/`lint`/`build` (workspace 11/11 task) exit 0 · `@nexa/web` unit 606/606 (30 yeni dahil) yeşil · tm 76.8. **PUBKB-i teslim (uçtan uca doğrulama — anonim okuyucu e2e + izolasyon/SEO kanıt seti):** `apps/e2e/tests/public-kb.spec.ts` (2 test, oturumsuz `browser.newContext()` — storageState'siz). Test 1 (hikâye, Acme owner UI): ajan Public KB sekmesinde editörle makale oluşturur (kategori 'Guides', gövdeye `<img onerror>` XSS payload) → taslakken public adres 404 + metin sızmaz + sitemap 0 `<loc>` → UI'dan Publish → oturumsuz okuyucu KB ana sayfası→kategori→makale gezinir (self-servis), `<h1>`+gövde görünür, `<title>`=seo_title + meta description + `<link rel=canonical>` doğrulanır (SEO'lu), sitemap yalnız o makaleyi listeler (1 `<loc>`, Northwind slug'ı yok = cross-tenant sitemap izolasyonu), XSS inert (`img[onerror]`=0 + `window.__nexaKbXss` undefined, NFR-S6), JS kapalı context'te gövde yine görünür (JS'siz ilk boyama), NFR-P2 tek-istek bütçesi HANDOFF'a kanıt (≈9 ms · 2432 bytes), UI'dan Unpublish → public adres tekrar 404 + sitemap'ten düşer. Test 2 (cross-tenant, ayrı blok, ikinci tenant Northwind fixture'ı): Northwind workspaceSlug + Acme makale slug'ı → 404 ve tersi → 404, her ikisi kendi workspace'inde 200 (izolasyon = NFR-S5, kırık workspace değil). `apps/e2e/tests/fixtures.ts`'e `ownerAccessTokenFor(context, owner)` + `ACME_OWNER`/`NORTHWIND_OWNER` (mevcut `ownerAccessToken` geriye uyumlu delege). `typecheck`(11/11)/`lint`(8/8)/`build`(7/7) exit 0 · e2e public-kb 2/2 + fixtures'ı paylaşan skills-routing/settings regresyonu 18/18 yeşil · `pnpm -w test` 1504/1505 (tek kırmızı `chats.test.ts:915` takeover-eşzamanlılık, paralel-DB yarışı — seri koşumda 65/65 yeşil, bu görevle ilgisiz, e2e-only değişiklik) · tm 76.9. **Kalan (h→i):** admin makale editörü (içerik + SEO alanları + publish/unpublish + public link), uçtan uca doğrulama — henüz yapılmadı. → §5.2

#### K5.3-Vardiya — §5.3-Vardiya · Work scheduler / staffing prediction

✅ KK-türetilmiş. Tahmin = geçmiş hacim + presence'tan **deterministik** hesap, LLM yok. **WORKSCHED-a teslim (kontrat-öncesi tip katmanı — çalışan kod/route YOK):** `@nexa/types` `packages/types/src/work-schedule.ts` — `WORK_SCHEDULE_DAYS` (7 gün, hafta sırasıyla) · `WorkScheduleSlot`/`WorkSchedule` · `WORK_SCHEDULE_TIME_PATTERN` (zero-padded 24h `HH:MM`) · `DEFAULT_WORK_SCHEDULE` (Pzt-Cuma 09:00-18:00 etkin, haftasonu kapalı) · `normalizeWorkSchedule()` (bilinmeyen gün/gün tekrarı/geçersiz saat/start≥end reddi; boş/null girdi → default) — test `work-schedule.test.ts` (11: KK "geçersiz saat/gün reddedilir" önce negatif, sonra boş-girdi→default ve tam-hafta pozitif). Kontrat: `openapi.yaml` `components.schemas` `WorkSchedule`/`WorkScheduleSlot` eklendi + re-bundle (140 path, DEĞİŞMEDİ); `paths/agents.yaml`'a `workSchedule` GET+PUT bloğu eklendi ama **bilinçli olarak `paths:` köküne bağlanmadı** — sunucuda karşılığı olmayan bir operasyon `contract-parity.test.ts`'i "documented but not served" ile kırar (08.8.3-b'nin tool-call ucunda uygulanan aynı erteleme, bkz. HANDOFF). `contract-parity.test.ts` 5/5 DEĞİŞMEDİ. **WORKSCHED-b teslim (veri katmanı — yazan kod yolu hâlâ YOK):** migration `apps/api/prisma/migrations/20260807090000_work_scheduler/migration.sql` — iki tablo, veri yazılmaz: `work_schedules` (PK `(license_id, agent_id)` — agent_memberships deseni, `timezone` DEFAULT `'UTC'` = `DEFAULT_WORK_SCHEDULE.timezone`, `schedule` JSONB + `work_schedules_schedule_is_array_check`) ve append-only `agent_presence_events` (`(license_id, agent_id, changed_at)` index — webhook_deliveries deseni, `agent_presence_events_status_check` = `agent_memberships_routing_status_check`'in aynısı: 3 routing statüsü). İkisinde de `ENABLE ROW LEVEL SECURITY` + `<tablo>_tenant` policy (USING + WITH CHECK = `nexa_current_license()`) + `nexa_app` GRANT; FK'ler `licenses(id)` + `accounts(id)` ON DELETE CASCADE. Prisma modelleri `WorkSchedule`/`AgentPresenceEvent` (schema.prisma, 41→43 model) — `db:check-drift` exit 0 (yapısal DDL birebir `prisma migrate diff` çıktısı). Test: `tenant-isolation.test.ts` +6 (ÖNCE çapraz-tenant: A'nın roster/presence satırı B bağlamında görünmez · bileşik anahtarla IDOR null · WITH CHECK her iki tabloda ayrı ayrı reddeder · updateMany/deleteMany 0 satır + hayatta kalan satır doğrulanır) · `data-model.test.ts` +7 (RLS enabled + policy adı, index tanımı, JSONB-dizi ve statü CHECK'leri, lisans-başına-tek-plan + aynı ajan farklı lisansta, Prisma round-trip, lisans silinince cascade). `@nexa/api` 1554→1567. **WORKSCHED-c teslim (ilk çalışan yüzey — plan artık okunup yazılabiliyor):** `GET`/`PUT /agents/{agentId}/work-schedule` — `apps/api/src/routes/agents.ts` (`requireWorkScheduleAccess()` + `serialiseWorkSchedule()` + iki handler). AuthZ ikili: rota kapısı okuma `['agents--all:ro','agents--my:ro']` · yazma `['agents--my:rw','agents--all:rw']` (`PUT /agents/me/routing-status` deseninin aynısı), **self-vs-admin ayrımı handler'da** — `agents--my:*` rota kapısını yoldaki id ne olursa olsun geçtiği için çizgi orada çizilmek zorunda: çağıran ≠ hedef ise `agents--all:{ro|rw}` şart, yoksa 403. Bot/app principal'ının hesabı olmadığından "self" onlar için asla doğru değil → yönetici scope'una düşer. 403 önce, varlık kontrolü sonra: çapraz-tenant id RLS'te ıskalayıp 404 döner, id sayılabilir olmaz (NFR-S5). Gövde tek kapıdan geçer — `normalizeWorkSchedule()` (rota yalnız "gövde nesne mi" der; dizi gövde default'a sessizce dönüşmesin diye reddedilir), geçersiz → `ApiError.validation` (yeni hata tipi AÇILMADI). Yazım `work_schedules` upsert `(license_id, agent_id)`, replace-not-patch; satırı olmayan ajan default haftayı okur. Audit: `AUDIT_ACTIONS`'a `work_schedule.updated` (+1) — metadata yalnız `timezone` + `enabled_days`, saatler DEĞİL. Kontrat: `openapi.yaml` `paths:`'e `/agents/{agentId}/work-schedule` bağlandı (WORKSCHED-a'nın bilinçli ertelemesi kapandı) + re-bundle **140 → 141 path**, `src/generated/api.ts` yeniden üretildi; `contract-parity.test.ts` 5/5 yeşil. Test: `work-schedule.test.ts` (25 — negatifler önce: `agents--my` başkasına PUT/GET 403 + yazılmadığı doğrulanır · scope'suz token 403 · salt-okunur admin PUT 403 · müşteri principal 404 (I4: 403 değil, daha sıkı) · 401 · çapraz-tenant GET/PUT 404 + iki lisansın planı bağımsız · 6 geçersiz gövde 400 · round-trip, wholesale replace, idempotent, boş → default · audit tek satır + saat sızmaz) · `route-config.test.ts` +1 (iki verb'ün scope config'i `onRoute` ile birebir doğrulanır, NFR-S3). `@nexa/api` 1567 → 1593. **WORKSCHED-d teslim (presence olay günlüğü yazma yolu + öncelik kuralı — tarihsel presence artık üretiliyor):** İki yazma noktası, ikisi de değişikliği yapan transaction'ın İÇİNDE. (1) `PUT /agents/me/routing-status` (`apps/api/src/routes/agents.ts`) — geçiş kararı okuma-sonra-yazma ile değil `updateMany`'nin KENDİ `where`'i ile veriliyor (`routingStatus: { not: status }`): aynı duruma yarışan iki istek eski değeri birlikte okuyup ikisi de olay yazamaz, yani "gerçek değişim başına tam 1 satır" tam da kaydetmek için var olduğu eşzamanlılık altında bozulmuyor; `count > 0` ise `agent_presence_events` append, ardından **aynı `withTenant` bloğunda** `routing.drainQueue` — atama geri alınırsa "bu ajan online oldu" satırı da geri alınır (üyeliğin varlığını token çözümü zaten kanıtlıyor, `token-service.ts:110`). Aynı duruma tekrar PUT → 0 yeni satır (idempotent). (2) `PUT /agents/{agentId}/suspension` — routing askıya alınmış ajanı `routing_status` ne derse desin atlar (`routing-service.ts` `AND NOT m.suspended`), o yüzden askı da bir presence değişimidir: `routingStatus !== 'offline'` iken askıya alma `offline`, geri alma ajanın hâlâ tuttuğu statüyü yazar — `routing_status` sütununa DOKUNULMAZ (ajanın kendi ayarı; dönüşte seçtiği statüye döner). (3) Saf modül `apps/api/src/services/staffing/presence-coverage.ts` — olay günlüğünden [from,to) için ajan × UTC saat (0-23) online-dakika ızgarası; Fastify/Prisma/env importu yok (`reports-metrics.ts` felsefesi). İki kural: online YALNIZ `accepting_chats` (routing'in atama koşulunun aynısı; tanınmayan statü online SAYILMAZ — kapsamayı fazla göstermek personel açığını gizleyen tek yön) ve **hiç olay yoksa 0 DEĞİL `null`** (log varken 0 kovası gerçek bilgidir, raporlanır). Çağıran, her ajan için `from`'dan önceki son olayı da vermek zorundadır (değişim günlüğünde pencerenin açılış durumu ancak onu yazan satırdan bilinir) — modül pencereye kırpar; son olay `to`'ya kadar açık uçlu sürer. (4) ÖNCELİK KURALI (§C **A15**): manuel `routing_status` HER ZAMAN planlı vardiyayı ezer; WorkSchedule atama kararına HİÇ girmez — ADR-08 aday havuzu değişmedi, migration/kontrat/yeni ApiError YOK. Test: `presence-coverage.test.ts` (14 — negatifler önce: boş log null · pencere sonrası olaylar null · yalnız-offline ajan 0 (unknown değil) · `not_accepting_chats` ve tanınmayan statü online değil · ters/eşit pencere + geçersiz tarih throw; sonra saat-sınırı bölme 08:45→10:10 = 15/60/10 · pencere öncesi durumun taşınması · açık uçlu son olay · aynı saatin günler boyunca toplanması · ajan ayrımı + deterministik sıra) · `presence-log.test.ts` (9 — NEGATİF ÖNCE: tam vardiyada ama manuel `offline` ajana drainQueue atama YAPMAZ; aynası: rosteri tümüyle kapalı ama `accepting_chats` ajana atama YAPILIR · EŞZAMANLILIK: `drainQueue` reddedilince ne olay ne statü kalır (kısmi yazma yok) · CROSS-TENANT: `nexa_app` rolüyle (owner RLS'ten muaftır — ilk kurgu bu yüzden yanlıştı) B lisansı A'nın olaylarını göremez ve türettiği kapsama `null` · her geçiş 1 olay + tekrar PUT 0 · zaman damgası · askı/geri-alma çifti + zaten-offline'da 0 satır · uçtan uca kapsama) · `routing.test.ts` +2 (rosterli-ama-offline atanmaz · roster kapalıyken accepting atanır — plan iki yönde de atamayı sürmez). `@nexa/api` 1593 → 1618. **WORKSCHED-e teslim (saat-bazlı hacim kırılımı — kod ZATEN vardı, bu turda yalnız doğrulandı):** `/reports/breakdown` yanıtındaki `by_hour[]` ve onu üreten `breakdownByHour()` helper'ı (`apps/api/src/routes/reports.ts:623`) WORKSCHED epiği açılmadan (WORKSCHED-a, tm 77.1, 2026-08-07) ÖNCE, ilgisiz bir görevde teslim edilmişti — `feat(reports): breakdownByHour() + /reports/breakdown by_hour dimension (tm 63.2)`, 2026-08-02, dört-boyutlu breakdown'ın (`by_day`/`by_hour`/`by_channel`/`by_team`) parçası olarak. Bu satırdaki "Kalan (e→j)" notu geçersizmiş: kod hâlâ mevcut ve WORKSCHED-e'nin KK'sını karşılıyor — bu turda TEK iş bunu doğrulamaktı, yeni kod YAZILMADI. Doğrulanan: `breakdownByDay` ile aynı `SPLIT_COUNTS` deseni, UTC saat kovası, 24 kova dense (boş saat 0, `reports.ts:648`) · cross-tenant izolasyon (`'never counts another tenant'` testi — `theirs.by_hour` 24 sıfır-dolu kova) · by_hour toplamı = by_day toplamı aynı pencerede (`'breakdown cross-consistency'` testi) · `reports_read` scope zorunluluğu (403) + ters tarih aralığı (400) rota-seviyesinde paylaşılan doğrulamadan geliyor · `contract-parity.test.ts` 5/5 yeşil. **Kayıtlı kapsam sapması (geri alınmadı):** WORKSCHED-e'nin "CSV export'a by_hour eklenmeyecek" kapsam-dışı maddesi CSV'nin ZATEN by_hour içerdiği gerçeğiyle çelişiyor — ama bu da WORKSCHED'den önce, tm 63.6'da (`feat(reports): breakdown CSV export → long format across 4 dimensions`) kasıtlı tasarım kararıyla teslim edilmiş ve hâlâ test ediliyor (`reports-billing.test.ts` CSV testleri); geri almak canlı davranışı bozar ve mevcut tüketicileri kırar, bu yüzden dokunulmadı. Kapı: `typecheck`·`lint`·`build` yeşil · `test` (unit+integration, serial) **82 dosya / 1684 test** yeşil (contract-parity + tenant-isolation dahil) · üretim kodu değişikliği YOK. **WORKSCHED-f teslim (deterministik tahmin çekirdeği — saf modül, LLM yok):** `apps/api/src/services/staffing/staffing-forecast.ts` → `staffingForecast(input)` gün × saat **7×24 = 168 hücrelik tam** ızgara döner (`{dayOfWeek, hour, observedChats, requiredAgents, scheduledAgents, gap, lowConfidence}` — camelCase iç modül sözleşmesi, snake_case'e çeviren -g'dir). Model **Little yasası**, fazlası değil: `requiredAgents = ceil((chats/occurrences) × (averageChatMinutes/60) / concurrentChatsLimit)`; `occurrences` = o hafta-günü-saatinin pencerede kaç kez geçtiği (28 günlük pencerede 4 Salı 14:00 ⇒ 160 sohbet saatte 40'tır, 160 değil) ve **kısmi pencere kesirli sayılır** (yarım saatlik pencere 0.5). Erlang-C / servis-seviyesi hedefi **bilinçli olarak YOK**: yanıt-süresi hedefi PRD'de yazmıyor, uydurmak bir ürün kararını aritmetiğin içine gömerdi (kod yorumunda yazılı) — bu ortalama yük, ortalamanın üstündeki saat kuyruğa girer. İki ayrı "bilinmiyor", ikisi de 0 DEĞİL: (1) örneklem eşiğinin altı → `requiredAgents = null` + `lowConfidence = true` (sıfır hacim de aynı ifade — "o saatte kimse yazmaz" iddiası değil); (2) presence kapsaması `null` (WORKSCHED-d'nin "hiç olay yok" sözleşmesi) → `scheduledAgents = null`, dolayısıyla `gap = null` — 0 çıkarılsaydı hiç verisi olmayan bir haftanın 168 saatinin tamamı personel açığı olarak raporlanırdı; log VARSA boş hücre gerçek 0'dır. `gap = required − scheduled` (pozitif = açık, negatif = fazla kapasite). Bölme-sıfır koruması: `concurrentChatsLimit` ve `averageChatMinutes` sonlu ve > 0 olmalı (0/negatif → `RangeError`, `NaN`/`Infinity` → `TypeError`); negatif sayaç, ızgara dışı gün/saat, **aynı hücrenin iki kez verilmesi** (sessizce toplamak tahmini ikiye katlardı) ve ilerlemeyen/geçersiz pencere de hata. **Assumption (§5.2.22 açık soru 4 — PRD'de sayı yok):** düşük-baz eşiği `DEFAULT_MINIMUM_SAMPLE_CHATS = 20`, ürünün mevcut tek düşük-baz sayısıyla hizalı (`apps/web/src/features/playbook/performance.ts` `LOW_BASE_THRESHOLD = 20`) — çağrı başına `minimumSampleChats` ile ezilebilir. Sınırlı maliyet: tam haftalar aritmetikle sayılır, yalnız ≤167 saatlik artık yürünür — `resolveRange` aralığı sınırlamadığı için asırlık bir `from`/`to` aksi halde HTTP isteğinin içinde milyonlarca tur attırırdı. **İzolasyon:** modül tenant verisi GÖRMEZ — kapsama, ajan boyutu çağıran tarafından toplanmış dakika olarak gelir, yani içeride ajan/lisans kimliği yoktur (yapısal test bunu iddia eder); izolasyon -d/-e/-g'de kanıtlanır. Test `apps/api/src/services/staffing/staffing-forecast.test.ts` (**31** — negatifler önce: limit 0/negatif/`NaN`/`Infinity` · süre 0/negatif · hacim 0 ve eşik-altı → `null`, 0 DEĞİL · kapsama `null` → 168 hücrenin hepsinde `gap` null · boş dizi kapsama → gerçek 0 · ters/eşit/geçersiz pencere · negatif sayaç · ızgara dışı gün/saat · yinelenen hücre · dizi olmayan hacim; sonra determinizm: aynı girdi iki kez → `toEqual` + `JSON.stringify` birebir, satır sırasından bağımsız · 168 hücre tam + sabit sıra · ortalama gelme hızıyla boyutlandırma · 9 günlük pencerede Pzt/Salı 2, diğerleri 1 kez · kesirli yarım-saat penceresi · sohbet varsa en az 1 ajan · limit 1 ve kesirli 4.5 · kapsama > ihtiyaç → `gap ≤ 0` · kısmi kapsama 0.625 ajan · yapısal: dosyada hiç `import` yok, `require`/`process.env` yok, `Math.random`/`Date.now`/argümansız `new Date()` yok). Kontrat / migration / route YOK (iç servis modülü, §C varsayımı: tahmin API-time hesaplanır, `StaffingForecast` tablosu açılmaz). `@nexa/api` 1684 → **1715**. Kapı: `typecheck` (11/11) · `lint` (8/8) · `test` (83 dosya / 1715) · `test:integration` (1310) · `build` (7/7) · `e2e` (74/74) hepsi exit 0. tm 77.6. **WORKSCHED-g teslim (üç girdi tek yanıtta — ilk staffing ucu):** `GET /reports/staffing-forecast` — `apps/api/src/routes/reports.ts` (`buildStaffingForecastReport()` + `volumeByWeekdayHour()` + `presenceEvents()` + `coverageByWeekdayHour()` + `rosterPlans()` + `staffingInputs()` + `assertForecastRange()`). Kontrat: `paths/reports.yaml` `staffingForecast` + `openapi.yaml` `components.schemas.StaffingForecast`, `paths:` köküne bağlandı → re-bundle **141 → 142 path**, `src/generated/api.ts` yeniden üretildi; `contract-parity.test.ts` 5/5 yeşil. Rota kapısı `['reports_read']` — **YENİ SCOPE YOK** (yanıt, `reports_read`'in zaten kapsadığı hacimden türetiliyor; ayrı bir scope girdisini okuyamayan token'a staffing sayısı verirdi), `route-config.test.ts` +1 bunu `onRoute` ile birebir doğrular. Yanıt **7×24 = 168 hücrelik tam ızgara** (`day_of_week` 0=Pazar, UTC — `EXTRACT(DOW)`/`getUTCDay()` uzlaşımı) + `inputs` (limit · ortalama sohbet dakikası · eşik · ajan sayısı) + `coverage_known`/`roster_known`/`low_confidence`. **Dört ayrı "bilinmiyor", hiçbiri 0 DEĞİL:** örneklem eşiği altı → `required_agents` null · presence logu yok → `scheduled_agents` + `gap` null · kayıtlı plan yok → `rostered_agents` null · **bölen bilinmiyorsa** (pencerede hiç sohbet kapanmadı → `average_chat_minutes` null; aktif ajan yok → `concurrent_chats_limit` null) hacim modelden ÇEKİLİR ve 168 hücrenin tamamı `required_agents: null` döner — uydurma bir süre/limit ile boyutlandırmak ölçülmüş gibi görünen bir sayı üretirdi (`observed_chats` ve kapsama yine gerçek). **ADR-09:** `observed_chats` `breakdownByHour` ile aynı `SPLIT_COUNTS` fragmanı ve aynı pencere yüklemi, yalnız `GROUP BY`'a `EXTRACT(DOW)` eklenmiş — bir saatin yedi gününü toplamak `/reports/breakdown` `by_hour[hour].chats` değerini birebir verir (integration testi 24 saatin hepsi için iddia eder, vakum-geçiş koruması dahil). **Yeni saf modül** `apps/api/src/services/staffing/roster-coverage.ts` → `rosterCoverage(plans, at)`: haftalık planı UTC ızgarasına yansıtır (Pazartesi-başlı hafta → Pazar-başlı dow, saat sınırında bölme, hafta sınırında iki yönde sarma, IANA offset `Intl`'den — elle tablo bir sonraki saat değişiminde bayatlar). Birim **hafta, pencere değil**: yinelenen bir desen 7 günlük ve 90 günlük raporda aynı okunur, bu yüzden hiçbir şey "kaç kez geçti"ye bölünmez. İki kural: yalnız **kayıtlı** plan sayılır (editörün Pzt-Cuma 09:00-18:00 ön-dolgusu bir taahhüt değil; hiç plan yoksa `null`, sıfır değil) ve çözülemeyen timezone UTC'ye DÜŞMEZ, o plan düşer — yanlış saate yerleştirmek sabah açığını gizler, düşürmek eksik roster olarak görünür (§5.2.22 A15'in "fazla göstermek tek yasak yön" mantığı). **Sınırlar (ikisi de sessiz kırpma değil 400):** pencere ≤ **366 gün** (`resolveRange` aralığı sınırlamıyor, bu uç ise satırları JS'te yürüyor) · presence satırı ≤ 250k (değişim günlüğünü kırpmak her ajanın son durumunu pencere sonuna kadar sürdürür ve tam da gizlenmemesi gereken müsaitliği fazla gösterir). `baseline`/`previous_period` **bilinçli YOK**: yanıt zaten pencereden bir projeksiyon, iki projeksiyonu karşılaştırmak "tahmin vs gerçekleşen"dir (açık soru 2, ertelendi). Persist YOK (§C varsayımı korundu), CSV export'a staffing grubu EKLENMEDİ (kapsam dışı), migration YOK, yeni `ApiError` tipi YOK, `scopes.ts` sayacı değişmedi. Test: `roster-coverage.test.ts` (**17** — negatifler önce: plan yok → null · hepsi çözülemez zone → null · rosterlanmamış ajan 0 (unknown değil) · default hafta asla sayılmaz · geçersiz argüman throw · bozuk slot atlanır; sonra 168 hücre + sabit sıra · Pzt→Pazar dow eşlemesi · 08:45-10:10 bölünmesi · aynı saatte 2.5 ajan · UTC+3 kaydırma · hafta sınırında iki yönde sarma · DST'nin `at`'e göre kayması · karışık listede yalnız bozuk plan düşer · determinizm + sıra bağımsızlığı · hafta ≠ pencere) · `apps/api/test/integration/staffing-forecast.test.ts` (**17** — NEGATİF ÖNCE: `reports_read`'siz 403 · 401 · ters aralık + ayrıştırılamaz tarih 400 · 366 günden geniş 400; CROSS-TENANT: B'nin hacmi/presence'ı/rosteri A'nın ızgarasında YOK, `coverage_known`/`roster_known` false — ve B aynı pencerede kendi haftasını görür, yani sızacak veri gerçekten oradaydı · iki lisans bağımsız; sonra 168 hücre + varsayılan 30 gün · 24 sohbet/30 dk/limit 6 → `required 2`, `scheduled 1`, `rostered 1`, `gap 1` · komşu saatlerde kapsama var öneri yok · her şey bilinmezken 168 hücrenin hepsi null · 5 sohbetlik hücre null ama `observed_chats` 5 ve `scheduled_agents` gerçek 0 · hiç kapanmamışsa tüm öneriler çekilir · aktif ajan yok (bot token'ıyla sorulur: insan token'ı kendi üyeliğinden çözüldüğü için herkes askıya alınınca 401 olurdu) · default hafta roster sayılmaz — aynı test tek-ajan `GET`'in 09:00-18:00 döndürdüğünü de gösterir · ADR-09 `by_hour` eşitliği · Istanbul planı 06:00 UTC'ye düşer) · `route-config.test.ts` +1. `@nexa/api` 1715 → **1750**. Kapı: `typecheck` · `lint` · `test` (85 dosya / 1750) · `test:integration` (1328) · `build` (7/7) · `e2e` (74/74) hepsi exit 0. tm 77.7. **WORKSCHED-h teslim (self-servis ızgara editörü — ilk UI yüzeyi):** `apps/web/src/features/team/WorkSchedule.tsx` — `TeamPage`'e yeni bir `Section`; roster'dan (`canManage` varsa herkes, yoksa yalnız `currentAgentId`) `requireWorkScheduleAccess`'in (WORKSCHED-c) self-vs-admin ayrımını UI'da yansıtan bir seçilebilir liste türetir — kullanılamayacak bir picker girdisi hiç render edilmez, sonradan 403 ile karşılaşmak yerine. Editör bir `Modal` (`AgentSkills.tsx` deseni, per-satır tetikleyici): `GET`/`PUT /agents/{agentId}/work-schedule` (WORKSCHED-c) çağırır, tek doğrulama kapısı `@nexa/types` `normalizeWorkSchedule` — kaydet her zaman bu fonksiyonun ürettiği normalize gövdeyi gönderir, editör ve rota asla ayrı fikirde olamaz. Alan-altı hata `apps/web/src/lib/form.tsx` `FieldError`; yalnız `enabled` gün doğrulanır (kapalı günün saatleri ne olursa olsun hata üretmez — WORKSCHED-c'nin "replace-not-patch" sözleşmesiyle tutarlı, kapalı bir günün saatleri atılmaz, yalnız etkisiz kalır). Kapatma `apps/web/src/lib/dirty-guard.tsx` `useCloseGuard` (Escape/backdrop/İptal hepsi aynı kapıdan geçer). Timezone seçici `Intl.supportedValuesOf('timeZone')` (418 bölge) + `UTC` ön-ek (bazı motorlarda `UTC` alias listede yok, ama `DEFAULT_WORK_SCHEDULE.timezone` tam olarak budur). **Assumption (FR-EK-B.1 empty state — KAPSAM'daki "hiç plan kaydedilmemişse"):** rota her zaman bir plan döner (satır yoksa `DEFAULT_WORK_SCHEDULE`, WORKSCHED-c) — yani tek bir ajan için gerçek bir "plan yok" durumu hiç YOK. Boş durum bu yüzden rosterin kendisine bağlandı: görüntüleyenin zamanlayabileceği KİMSE yoksa (`selectable.length === 0` — boş ekip ya da roster henüz yüklenmemiş) `EmptyState` gösterilir; roster sorgusu `isPending` iken iskelet (`ListSkeleton`), asla erken boş durum. Test `WorkSchedule.test.tsx` (**11** — roster kapsamı: yönetici olmayan yalnız kendi satırını görür · yönetici picker'da herkesi görür · boş roster → EmptyState · yükleniyorken iskelet, EmptyState değil; editör: 7 gün + timezone render + kapalı günün saat alanları disabled · start≥end alan-altı hata + Kaydet pasif · geçersiz saat formatı hata · kapalı gündeki saçma stored aralık doğrulanmaz · Kaydet normalize edilmiş gövdeyi PUT eder (7 gün tam) · kirli kapatma dirty-guard sorar + reddedilince modal açık kalır · temiz kapatma sormaz). Kontrat/migration/route YOK (WORKSCHED-c'de zaten teslim edildi), yalnız `WorkSchedule.tsx` + `WorkSchedule.test.tsx` + `TeamPage.tsx`'e 3 satırlık entegrasyon. Kapı: `typecheck` (11/11) · `lint` (8/8) · `test` (85 dosya/1750 `@nexa/api` DEĞİŞMEDİ + 83 dosya/617 `@nexa/web`, ikisi de yeşil) · `build` (7/7) · `test:e2e` 73/74 (`skills-routing.spec.ts:76` — izole çalıştırıldığında yeşil, HANDOFF'ta tm 77.4'ten beri kayıtlı tekrarlayan pre-existing flake, bu görevle ilgisiz; ilgili `team.spec.ts` 3/3 yeşil) hepsi exit 0. tm 77.8. **WORKSCHED-i teslim (Reports → Staffing sekmesi — salt-okunur ilk UI yüzeyi):** `apps/web/src/features/reports/ReportsPage.tsx` — mevcut `TABS`/`useReport` kabuğuna 6. sekme `Staffing` eklendi (Breakdown ile Chat topics arasına; `role=tab`/`tabpanel` + `aria-controls` deseni ReportsPage'in paylaşılan mekanizmasından miras alınır — ayrıca ayrı bir testle doğrulandı). `GET /reports/staffing-forecast`'in (-g) yanıtını UTC 7×24 ızgaraya (`day_of_week` 0=Pazar × `hour` 0-23) render eder: her hücre `gap`'i (`required_agents − scheduled_agents`) gösterir, `gap > 0` (açık) `bg-warning/10` ile vurgulanır (negatif/sıfır vurgulanmaz — KK'nın ikinci maddesi). `gap`/`required_agents`/`scheduled_agents` üçünden biri null ise hücre '—' + `title="Not enough data"` gösterir, **0 hiç YAZILMAZ** (KK'nın üçüncü maddesi birebir). Pencerede toplam `observed_chats` 0 ise (gerçekten hiç veri yoksa) ızgara yerine `EmptyState` gösterilir — 168 tire dolu bir dikdörtgen yerine (FR-EK-B.1). `coverage_known`/`roster_known` false olduğunda ek dürüst not (`No presence data…` / `No agent has a saved work schedule…`) — API'nin dört ayrı "bilinmiyor"undan ikisini okunur kılar. Tahmin aritmetiği istemcide YENİDEN HESAPLANMAZ (yalnız backend -f/-g'nin döndürdüğü sayılar render edilir) — kapsam dışı madde korundu; CSV export ve vardiya düzenleme (WORKSCHED-h, ayrı) de dokunulmadı. Test: `ReportsPage.test.tsx` +9 (NEGATİF ÖNCE: low-confidence/null hücre → '—' + `title="Not enough data"`, hücre metninde `0` YOK · boş pencere → anlamlı empty state, tablo YOK · API hatası → `role="alert"`; sonra 7×24 ızgara + 25 columnheader/8 row · `gap > 0` vurgu class'ı (`bg-warning/10`) taşır, `gap ≤ 0` taşımaz · presence bilinmiyor notu · endpoint sorgusu seçili aralıkla çağrılır · paylaşılan `role=tab`/`tabpanel` + `aria-controls` deseni ayrıca iddia edilir). `@nexa/web` 617 → **626**. Kontrat/migration/route YOK (-g'de zaten teslim edildi), yalnız `ReportsPage.tsx` + `ReportsPage.test.tsx` değişti. Kapı: `typecheck` (11/11) · `lint` (8/8) · `test` (85 dosya/1750 `@nexa/api` DEĞİŞMEDİ + 83 dosya/**626** `@nexa/web`) · `build` (7/7) hepsi exit 0 · `test:e2e` — `reports.spec.ts`'in ilgili akışı **6/6 yeşil**; tam suite 70/74 (4 kırmızı: `customers.spec.ts` 3 test + `skills-routing.spec.ts:76`). Bu 4'ü bu değişiklikle ilgisiz olduğu ayrıca doğrulandı: `ReportsPage.tsx`/`.test.tsx` `git stash` ile HEAD'e döndürülüp `customers.spec.ts` izole tekrar koşuldu — **birebir aynı 3 hata** tekrar çıktı (paylaşılan geliştirme DB'sinin seed/durum sürüklenmesi, bu görevden ÖNCE var — `skills-routing.spec.ts:76` zaten tm 77.4'ten beri HANDOFF'ta kayıtlı aynı sınıf flake). tm 77.9. **WORKSCHED-j teslim (uçtan uca doğrulama — kalem kapanış kapısı, yeni ürün kodu YOK):** Yeni dosya `apps/e2e/tests/staffing.spec.ts` (**2** test) — zincirin tamamı gerçek tarayıcıda: Team ▸ Work schedule editöründen hafta kaydet → tam `reload` sonrası editörü yeniden açıp sunucudan geri oku → Inbox ▸ Availability ile müsaitliği çevir (`accepting_chats` → `not_accepting_chats` → geri) → Reports ▸ Staffing sekmesinde 7×24 ızgara (25 columnheader / 7 rowheader). **İddianın kalbi ızgaranın görünmesi DEĞİL, iki "bilinmiyor" notunun KAYBOLMASI:** `roster_known` `work_schedules` satırı olmadan false, `coverage_known` pencerede presence olayı olmadan false (`presence-coverage.ts`: boş log `null`, 0 değil) — ikisinin de tarayıcıdan sürülen yazmalardan SONRA yok olması, editörün PUT'ladığı planın ve müsaitlik kontrolünün eklediği olayın tahminin geri okuduğu satırlarla aynı satırlar olduğunun bu seviyede tek kanıtı. İkinci test: hiç sohbet olmayan pencere (2020-01-01..07) → `No staffing data in this window` empty state + ızgara YOK (168 hücrelik 0 dolu tablo "tam kadro, açık yok" diye okunurdu). **Kanıtın vakuma düşmemesi için üç önlem:** (1) Her iki notun *render edildiği* `ReportsPage.test.tsx` +2 testle sabitlendi (`roster_known: false` → not görünür · ikisi de true → ikisi de yok) — daha önce yalnız presence notunun pozitif testi vardı, roster notunun hiç yoktu, yani e2e'deki yokluk iddiası dize değişse sessizce geçerdi. (2) e2e roster ayağı **kendini geçersiz kılan** iki vardiya arasında geçiş yapar (08:00-20:00 ↔ 07:00-19:00: depoda olmayanı yazar), böylece reload sonrası geri okuma her koşuda O KOŞUNUN yazdığı satırı kanıtlar — seed truncate etmediği için sabit tek vardiya ilk koşudan sonra editör hiçbir şey yapmasa da geçerdi (fiilen doğrulandı: iki ardışık koşu 08:00 → 07:00 yazdı). (3) Zincir testi iki tablo **elle boşaltıldıktan** sonra (0 satır teyit edildi) koşuldu ve yeşil geçti; ardından DB'de 1 roster satırı + tam 2 presence olayı bulundu — yani notlar yalnız tarayıcıdan sürülen yazmalar yüzünden yoktu. **İzolasyon (kapsam maddesi 2):** `tenant-isolation.test.ts` +1 test ve RLS-açık tablo listesine `work_schedules` + `agent_presence_events` eklendi (12 → **14**); yeni test iki tablonun **tenant bağlamı olmayan** bağlantıya 0 satır döndürdüğünü, üstelik o anda iki lisans için gerçekten satır varken (guard-the-guard) iddia eder — süitin genel fail-closed kontrolü bu blok seed etmeden ÖNCE koştuğu için o iki tablo için ancak vakumda geçebiliyordu. Çapraz-tenant okuma/IDOR/WITH CHECK/updateMany-deleteMany iddiaları WORKSCHED-b'de (tm 77.2) zaten vardı, tekrarlanmadı. `tenant-isolation.test.ts` 38 → **39**. **ADR-09 sayı tutarlılığı (kapsam maddesi 3): yeni test YAZILMADI — WORKSCHED-g'de (tm 77.7) zaten teslim edilmişti** ve bu turda denetlendi: `staffing-forecast.test.ts:510` `'quotes the same hourly volume as /reports/breakdown'` — staffing hücrelerinin saat bazında toplamı `by_hour[hour].chats` ile 24 saatin hepsi için karşılaştırılıyor, üstelik vakum-geçiş koruması (toplam 36) dahil. Aynı iddianın ikinci kopyasını yazmak kapsamı büyütmek olurdu. `@nexa/api` 1750 → **1751** · `@nexa/web` 626 → **628** · `@nexa/e2e` 74 → **76**. Kontrat/migration/route/ürün kodu değişikliği YOK — yalnız test dosyaları. Kapı: `typecheck` (11/11 exit 0) · `lint` (8/8 exit 0) · `test` (85 dosya/**1751** `@nexa/api` + 83 dosya/**628** `@nexa/web`, exit 0) · `test:integration` (59 dosya/**1329**, `tenant-isolation` 39/39 + `contract-parity` 5/5, exit 0) · `build` (7/7 exit 0) · `test:e2e` **75/76**: `staffing.spec.ts` **2/2**, testStrategy'nin adlandırdığı regresyonlar yeşil (`reports.spec.ts` 5/5 · `team.spec.ts` 3/3 · `routing.test.ts` + `contract-parity` integration içinde); tek kırmızı `skills-routing.spec.ts:76` — **izole koşuldu ve 2/2 yeşil**, sebebi kendi tekrarlı koşularının paylaşılan seed DB'sinde biriktirdiği yinelenen skill satırları (`select … from skills` ile doğrulandı: "Where is my order" 3 kez) → strict-mode ihlali; tm 77.4'ten beri HANDOFF'ta kayıtlı pre-existing flake, WORKSCHED ile ilgisiz. tm 77.10. **Kalem KAPANDI: WORKSCHED a–j onu da dahil hepsi done.** → §5.2

#### K5.3-Marka — §5.3-Marka · Multibrand

✅ KK-türetilmiş. **Tenant/RLS izolasyon sınırının genişlemesi = v2'nin en riskli kalemi.** Cross-brand negatif test şart. **MULTIBRAND-a teslim (kontrat-öncesi şema katmanı — davranışsız, hiçbir route/path yok):** yeni `brands` tablosu (uuid id · `license_id` FK cascade · `@@unique([licenseId, slug])` · `logoUrl?` · `isDefault`) — `Website` modelinin birebir şekli; `websites`/`widget_settings` deseninde RLS (`ENABLE ROW LEVEL SECURITY` + `brands_tenant` policy `nexa_current_license()` USING+WITH CHECK); lisans başına **tek varsayılan** partial unique index `ON brands(license_id) WHERE is_default` (Prisma bir WHERE yüklemini ifade edemez → `check-drift.ts` KNOWN_UNMODELLABLE'a kaydedildi, pgvector deseni); backfill mevcut HER lisansa bir `Default` (is_default) markası verir → tek-markalı davranış birebir korunur (canlı DB'de 4/4 lisans, `NOT EXISTS` guard'ıyla idempotent); `seed.ts` aynı satırı üretir. contract-parity değişmedi (path yok). `apps/api/prisma/schema.prisma` (model Brand + License.brands) · migration `20260802100000_brands` · `apps/api/prisma/seed.ts` · `apps/api/scripts/check-drift.ts` · test `apps/api/test/integration/data-model.test.ts` (+4: tek-varsayılan + 2. varsayılan reddi/partial index · çok sayıda non-default · slug lisans-scoped · license cascade) + `tenant-isolation.test.ts` (RLS-etkin liste 11→12 + 3 negatif: cross-tenant SELECT/by-id + WITH CHECK reddi) · tm 78.1. **MULTIBRAND-b teslim (marka izolasyon çekirdeği — bölünmez OPUS-MAX, `channels` üzerinde kanıtlandı):** `withTenant`'a ÜÇÜNCÜ transaction-scoped `set_config('app.current_brand', …, true)` (PgBouncer transaction-mode uyumlu, pool'a sızmaz) + `assertValidContext` brand-UUID doğrulaması (malformed → TypeError) + `TenantScopedRepository.brandId` getter (`apps/api/src/lib/tenant.ts`); migration `20260802120000_brand_context` — `nexa_current_brand()` (`nexa_current_license()` birebir ikizi, `NULLIF(current_setting('app.current_brand',true),'')::UUID`) + GRANT · `channels.brand_id` (nullable ekle → varsayılan markaya backfill → NOT NULL + FK `brands(id)` cascade) · `@@unique([licenseId, type])` → `@@unique([licenseId, brandId, type])` · `channels_tenant` policy DROP+CREATE (`license_id = nexa_current_license() AND (nexa_current_brand() IS NULL OR brand_id = nexa_current_brand())` USING+WITH CHECK — NULL = lisansın tüm markaları, tek-marka davranışı korunur) · `auth_signup` CREATE OR REPLACE + varsayılan marka INSERT (signup lisansı artık markasız doğmuyor → "her lisansta tek varsayılan" invariant'ı signup'a da yayıldı); marka çözümleyici `X-Nexa-Brand` başlığı `apps/api/src/plugins/auth.ts` onRequest'te isteyenin lisansına aitliğe göre doğrulanır (ait değil / malformed / yok → 404, 403 değil — `websites` deseni, un-enumerable NFR-S5) + `tenant()` brandId'yi bağlama katar; `ChannelService.connect` markayı çözer (başlık ya da lisans varsayılanı), `sendOutbound` compound-key yerine `findFirst(type)`'a geçer, yanıt `brand_id` taşır. Kontrat **additive**: `ConnectedChannel.brand_id` + reusable `X-Nexa-Brand` BrandHeader param (yeni path YOK, contract-parity yön kontrolü tetiklenmez) → `packages/contract` re-bundle + `packages/types` regen (ADR-05). Test `apps/api/test/integration/brand-isolation.test.ts` (+11: intra-lisans görünmezlik [list+disconnect] · cross-lisans brand → 404 · malformed/yok → 404 · context sızıntısı commit+rollback unwind · malformed brandId → TypeError · RLS okuma daraltma + WITH CHECK yazma reddi · marka başına tek kanal tipi); regresyon `channels-adapters.test.ts` (beforeEach varsayılan marka — brand_id NOT NULL) + `tenant-isolation.test.ts` + `data-model.test.ts` yeşil. Kapı: typecheck·lint·build·unit **263**·integration **929** (44→45 dosya, +11) serial · contract-parity 5/5 değişmedi · db:check-drift no-drift. `apps/api/src/lib/tenant.ts` · `apps/api/src/plugins/auth.ts` · `apps/api/src/services/channels/channel-service.ts` · `apps/api/prisma/schema.prisma` (Channel.brandId + Brand.channels) · migration · `apps/api/prisma/seed.ts` (marka önce) · `packages/contract/openapi/{openapi,paths/channels}.yaml` · tm 78.2. **MULTIBRAND-c teslim (brand_id yayılımı — websites + üç singleton ayar tablosu):** `-b` deseni dört tabloya uygulandı. `websites.brand_id` (nullable→varsayılan markaya backfill→NOT NULL+FK cascade) · `@@unique([licenseId,domain])` → `@@unique([licenseId,brandId,domain])` (aynı domain marka başına bir kez); `widget_settings`/`security_settings`/`inbox_settings` `licenseId @id` → `@@id([licenseId,brandId])` (satır başına marka, mevcut satırlar varsayılan markaya backfill); dört tablonun `_tenant` policy'leri DROP+CREATE marka-koşullu (`license_id = nexa_current_license() AND (nexa_current_brand() IS NULL OR brand_id = nexa_current_brand())`, `-b` şablonu birebir). Callsite: yeni `lib/brand.ts` `resolveBrandId(tx, brandId)` (başlık ya da lisans varsayılanı — `ChannelService.defaultBrandId` deseninin paylaşımlı biçimi); `routes/settings.ts` üç GET marka filtresi + üç upsert `licenseId_brandId` bileşik anahtarı + serialiser'lara `brand_id`; `services/websites/website-service.ts` create markayı çözer, appearance marka-scoped (`widgetSettings.findFirst({where:{brandId}})`), yanıt `brand_id`; `spam-filter.ts` `findUnique({licenseId})` → `findFirst()` (licenseId artık tek başına anahtar değil, callsite'lar customer/email). Enforcement okumaları (auth IP-check · banned-ip · uploads · token-service session policy · chat-timeout sweep · chat-page appearance) `findFirst()` olarak KALDI — brandless bağlamda RLS lisans-geneli tek (varsayılan marka) satırı okur (**VARSAYIM:** marka-bazlı enforcement -g/-h kapsamı; bugün yalnız varsayılan-marka satırı var). Kontrat additive: `Website`/`SecuritySettings`/`ChatTimeoutSettings`/`WidgetSettings` şemalarına `brand_id` + altı ayar/website operasyonuna reusable `X-Nexa-Brand` BrandHeader (yeni path YOK, contract-parity yön kontrolü tetiklenmez) → `packages/contract` re-bundle + `packages/types` regen (ADR-05). Migration `20260802130000_brand_scoped_settings` (add→backfill→NOT NULL+FK · PK swap · policy rewrite); canlı DB teyidi: 4 policy marka-koşullu · 4 `brand_id` NOT NULL · 3 bileşik PK · `websites_license_id_brand_id_domain_key`. Fixtures markasız KALDI (78.1 izolasyon süitleri şart koşuyor) → yeni `seedDefaultBrand(db, licenseId)` yardımcısı ihtiyaç anında marka kurar; onarılan owner-side create/upsert (customer-chat · ip-allowlist · session-policies · chat-timeout · channel-email-inbound · home) brandId + bileşik anahtar. Test: `settings.test.ts` + `websites.test.ts` brand-isolation blokları (+8: marka-scoped widget/security/inbox — A2'nin yazımı varsayılan markayı değiştirmez · aynı domain iki markada · cross-brand website id → 404 · başka-lisans brand → 404). Kapı: typecheck·lint·build·unit **263**+web **489**·integration **937** (929→937, +8) serial · contract-parity 5/5 değişmedi · db:check-drift no-drift · e2e settings.spec **15/15**. `apps/api/prisma/schema.prisma` (Website/Security/Inbox/WidgetSettings.brandId + Brand back-relations + License[]) · migration · `apps/api/src/lib/brand.ts` · `apps/api/src/routes/{settings,websites}.ts` · `apps/api/src/services/websites/website-service.ts` · `apps/api/src/services/security/spam-filter.ts` · `apps/api/prisma/seed.ts` · `packages/contract/openapi/{openapi,paths/settings,paths/websites}.yaml` · tm 78.3. **MULTIBRAND-d teslim (`/brands` CRUD kontrat + route — ADR-05 iki-yönlü parity TEK pencerede, yalnız API yüzeyi, migration yok):** yeni `packages/contract/openapi/paths/brands.yaml` iki-bloklu (koleksiyon `GET/POST /brands` + tekil `GET/PATCH/DELETE /brands/{brandId}`, `websites.yaml`'ın birebir şekli, 401/403/404/409/429 referansları) + `openapi.yaml`'a `Brand` şeması ve iki path kaydı; Error enum'a İKİ tip (`brand_not_found` 404 un-enumerable + `brand_exists` 409 — jenerik conflict yerine `website_exists` deseninde dar) → re-bundle (117 path) + `packages/types` regen (api.ts). `packages/types/src/scopes.ts` `brands--all:ro`/`brands--all:rw` (tenant-wide `--all`, `--my`/`--groups` yok); `errors.ts` İKİ YER (ERROR_TYPES + ERROR_STATUS: `brand_not_found:404` · `brand_exists:409`); `scopes.test.ts` sayaçları (SCOPES +2 · ERROR_TYPES 24+6) yeşil. Rol eşlemesi `principal.ts`: owner/admin yazar (`brands--all:rw` → ADMIN_SCOPES), ajan okur (`brands--all:ro` → DEFAULT_AGENT_SCOPES — ajan marka seçer, oluşturmaz). `routes/brands.ts` (`websites.ts` deseni): TÜM handler lisans-geneli çalışır (katalog marka-scoped değil → gelen `X-Nexa-Brand` düşürülür, delete bağımlılık sayımı tüm lisansı görür), slug türetme (boş türev → 400), P2002→`brand_exists` 409, cross-license/bilinmeyen id → 404, varsayılan marka silinemez (`not_allowed` 403), bağlı verisi (channel/website count>0) olan marka silme reddi (`not_allowed` 403, cascade yok), silmede `data.deleted` audit; `server.ts` route kaydı. Test `apps/api/test/integration/brands.test.ts` (+11: cross-license get/patch/delete → 404 & listede yok [NFR-S5] · varsayılan silme reddi · website'lı marka silme reddi · duplicate + türev slug 409 · read-scope/scope-siz 403 · CRUD döngüsü · lisanslar arası slug reuse · bad slug + boş patch 400). Kapı: typecheck·lint·build·unit (types 60 · web 489) · integration **948** (45→46 dosya; brands 11 + contract-parity 5/5 iki-yönlü) serial. `packages/contract/openapi/{openapi.yaml,paths/brands.yaml}` · `packages/types/src/{scopes,scopes.test,errors}.ts` · `apps/api/src/routes/brands.ts` · `apps/api/src/services/auth/principal.ts` · `apps/api/src/server.ts` · tm 78.4. **MULTIBRAND-e teslim (Settings → Brands ekranı — liste + ekle + yeniden adlandır + sil + boş durum, UI-only):** `Brands.tsx` — `WebsiteWidgets.tsx`/`Tags` deseninin bileşimi. `useQuery` `GET /brands` listesi; `lib/form.tsx` `useForm`+`required` ile 'Add brand' formu (ad zorunlu, alan-altı hata + submit-disabled, `POST /brands`); satır-içi yeniden adlandırma `BrandRow` (blur'da `PATCH /brands/:id`, aynı ada dönülürse çağrı yok, sunucu reddi `ErrorNotice` ile satırda gösterilir + taslak eski ada döner); sil butonu varsayılan markada render edilmez (`canEdit && !is_default`), sunucu reddi (bağlı veri/`not_allowed`) aynı `ErrorNotice`; marka yokken `EmptyState` (EK-B.1); `canEdit=false` → ekle formu render edilmez, ad alanları `disabled`, sil butonu yok (`brands--all:rw` scope'undan türetilir, `SettingsPage.tsx` `canManageBrands`). Test `Brands.test.tsx` (10: listeler · boş ad hata+disabled · ekle+liste güncellenir · varsayılanda sil yok/diğerinde var · boş liste EmptyState · canEdit=false tüm kontroller pasif · rename PATCH · aynı ada rename no-op · rename 409 ErrorNotice+revert · delete reddi ErrorNotice). Kapı: typecheck·lint·build·unit **web 499** (489→499,+10) · integration **948** değişmedi (UI-only, backend dokunulmadı) · e2e `settings.spec` **15/15** değişmedi. `apps/web/src/features/settings/{Brands.tsx,Brands.test.tsx,SettingsPage.tsx}` · tm 78.5. **MULTIBRAND-f teslim (AppShell marka değiştirici + persist + isteklerde `X-Nexa-Brand` başlığı, istemci plumbing):** `api-client.ts`'e `getBrandId` seçeneği — `request`/`getBlob` ikisi de seçili markada `X-Nexa-Brand` başlığı ekler, seçim yokken başlık HİÇ gönderilmez (NULL semantiği korunur, boş header'la karıştırılmaz). `auth-store.ts`'e `useBrandStore`/`useBrand`/`readBrandId` — `lib/i18n.ts`'in localStorage persist deseninin birebir ikizi (`nexa.brand_id` anahtarı, aynı `readStored`/`writeStored` yardımcıları); `useApiClient()` artık brandId'yi de enjekte ediyor. `AppShell.tsx`'e `BrandSwitcher` (rayın üstünde logonun altı, paylaşılan `Dropdown` bileşeni — hesap menüsüyle birebir yerleşim deseni): `GET /brands` (`['settings','brands']` — `Brands.tsx` ile AYNI cache anahtarı, tutarlı invalidation); iki-ve-üstü markada seçici görünür, tek markada (veya sıfır) render edilmez; seçim değişince `queryClient.invalidateQueries()` (filtresiz — `-g` sonrası markaya bağlanacak her ekranın cache'i de kapsanır) + persist; aynı markayı yeniden seçmek invalidate ETMEZ. Reconciliation effect: liste geldiğinde mevcut (persisted) brandId listede yoksa (silinmiş marka) VEYA liste tek elemanlıysa varsayılan markaya düşer (`is_default` → yoksa ilk eleman) — cross-brand 404 döngüsünü ve tek-markalı lisansta gereksiz başlığı önler. Test `api-client.test.ts` (+3: seçili markada `X-Nexa-Brand` var · seçim yokken başlık hiç yok · `getBlob` de header taşıyor) + `AppShell.test.tsx` (+6: tek markada gizli · iki markada seçici görünür + değiştirme + localStorage'a yazar · store `readBrandId()` ile yeniden kurulduğunda seçim korunur · silinmiş/geçersiz id → varsayılana düşer · marka değişince `invalidateQueries` çağrılır · aynı markayı yeniden seçmek çağırmaz). Kontrat/migration yok (`X-Nexa-Brand` -b/-c'de zaten kontrata yazılmıştı, burada yalnız tüketiliyor). Kapı: typecheck·lint·build YEŞİL · unit **web 508** (499→508,+9 — paket bazında çalıştırıldı; `pnpm -w test` paylaşılan Postgres'te rtm'yle yarışıp FK hatası veriyor [memory: parallel-db], ayrı ayrı 100% yeşil) · integration **api 1211/1211** DEĞİŞMEDİ (contract-parity 5/5 dahil) · rtm **90/90** DEĞİŞMEDİ · e2e `settings.spec` DEĞİŞMEDİ (grep: dosyada `brand` referansı yok, -h kapsamı). `apps/web/src/lib/{api-client.ts,api-client.test.ts,auth-store.ts,i18n.ts}` (yeni `shell.brand` anahtarı) · `apps/web/src/components/{AppShell.tsx,AppShell.test.tsx}` · tm 78.6. **MULTIBRAND-g teslim (marka-scoped ayar ekranları — UI-only, `-f`'in `useBrand()`/`X-Nexa-Brand` altyapısını tüketir):** Üç ekranın (`WidgetCustomization`, `WebsiteWidgets`, `Channels`) `useQuery` `queryKey`'lerine `brandId` eklendi (`['settings','widget',brandId]` vb.) — iki markanın cache girdisi artık ayrık, marka değişince otomatik refetch. Başlıklar seçili markayı adlandırır (`"Widget appearance · Acme Support"`), marka seçili değilken (lisans-geneli) düz kalır (regresyon korunur) — başlık için `GET /brands` (`['settings','brands']`, `Brands.tsx`/`AppShell.tsx` ile AYNI anahtar) `enabled: brandId!==null` ile çekilir. `WidgetCustomization`: kaydetme `setQueryData(['settings','widget',brandId], data)` markaya özgü anahtara yazar; kaydedilmemiş taslak (`edits`) marka değişince `useEffect`'le sıfırlanır — önceki markanın taslağı yeni markaya sızıp yanlış markaya PUT atamaz. `WebsiteWidgets`: açık install-snippet paneli marka değişince kapanır (`useEffect(() => setOpenSnippet(null), [brandId])`) — önceki markanın site id'sine işaret eden panel kalmaz. Test (`useBrandStore.setState` ile marka simüle edilir, gerçek RTM/API yok): `WidgetCustomization.test.tsx` +3 (marka A rengi render + başlıkta marka adı · marka B'ye geçince B'nin rengi fetch edilir ve A'nın değeri EKRANDA KALMAZ + başlık güncellenir · marka seçili değilken başlık düz) · `WebsiteWidgets.test.tsx` +3 (aynı üçlü: marka A'nın site listesi + başlık · marka B'ye geçince B'nin domaini gelir, A'nınki listede yok + başlık · marka yokken başlık düz). Kapı: typecheck·lint·build YEŞİL · unit **web 514** (508→514,+6) · integration **api 1211/1211** DEĞİŞMEDİ · rtm **90/90** DEĞİŞMEDİ (UI-only, backend dokunulmadı — paket bazında ayrı çalıştırıldı: `pnpm -w test` paylaşılan Postgres'te yarışıp FK hatası veriyor [memory: parallel-db], izole 100% yeşil) · e2e `settings.spec` DEĞİŞMEDİ (-h kapsamı, bu turda kapsam dışı). `apps/web/src/features/settings/{WidgetCustomization.tsx,WidgetCustomization.test.tsx,WebsiteWidgets.tsx,WebsiteWidgets.test.tsx,Channels.tsx}` · tm 78.7. **MULTIBRAND-h teslim (uçtan uca cross-brand doğrulama — otomatik izolasyon matrisi + kapsam-kaçağı alarmı + e2e; YALNIZ doğrulama katmanı, migration/üretim-kodu YOK):** `brand-isolation.test.ts`'e iki şema-güdümlü katman eklendi. (1) TEK kaynak `BRAND_SCOPED_TABLES` listesi (channels·websites·widget_settings·security_settings·inbox_settings) + `it.each` ile tablo başına cross-brand görünmezlik matrisi: marka A2'ye ekilen satır → A1 bağlamında **0** (kardeş marka göremez) · kendi markası A2'de **1** · markasız lisans-geneli **1** (tek-marka davranışı korunur) · B lisansı bağlamında **0** (cross-tenant taban). 5 tablonun RLS'i `AND (nexa_current_brand() IS NULL OR brand_id = nexa_current_brand())` idiomunu taşıyor → matris hepsini kanıtlar. (2) KAPSAM-KAÇAĞI ALARMI (contract-parity iki-yönlü diff deseni): `information_schema.columns`'ta `brand_id` kolonu taşıyan public tabloların gerçek kümesi ↔ matris listesi — bildirilmemiş tablo (undeclared → sızıntı yüzeyi, v2-04 §7.1) VEYA brand_id'siz sahte kalem (phantom) çıkarsa KIRMIZI. Alarm KENDİNİ kanıtlar: rollback'li interaktif tx içinde gerçek `_brand_scope_probe (brand_id uuid)` tablosu enjekte edilir, canlı şema sorgusu onu yakalar ve diff `undeclared`'a düşürür (KK madde 2 — alarmın kendisi kanıtlı) + ters yön declared-ama-brand_id'siz `accounts` ile phantom (KK madde 3); probe rollback'le iz bırakmaz. Seed: **Northwind iki-markalı lisans** yapıldı (Default `#2f6bff`/`northwind-supply.localhost` + Northwind Europe `#e11d48`/`northwind-eu.localhost`) — Acme tek-markalı KALDI, böylece 19 Acme e2e spec'i regresyonsuz. e2e `brands.spec.ts`: Northwind'e giriş → marka değiştirici (2 marka → görünür) → widget rengi `#2f6bff`→`#e11d48` + website listesi (aktif markanınki görünür, diğeri YOK) + başlık markayı adlandırır (`Widget appearance · Northwind Europe`) → geri dön regresyonsuz. Kapı: typecheck·lint·build YEŞİL · unit (api **263**·rtm **90**·web **514**) · integration **api 956** (46 dosya; brand-isolation 11→**19**: +5 matris +3 alarm; tenant-isolation 22 dahil) serial · e2e `brands.spec` **1/1** · truncate+reseed (memory: E2E clean DB; Prisma AI-guard `migrate reset`'i engellediği için data-only truncate). `apps/api/test/integration/brand-isolation.test.ts` · `apps/api/prisma/seed.ts` (TenantSpec.secondBrand + Northwind) · `apps/e2e/tests/brands.spec.ts` · tm 78.8. **Zincir -a→-h TAMAM.** → §5.2

#### KC5-S9 — C5/S9 · CC masking (PCI SAQ A) + PII yazım maskesi

✅ **GL-5 (tm 70):** kart no Luhn ile tespit → `**** **** **** 1234` **yazım anında** (DB/log/RTM/transcript, yalnız UI değil); saf `lib/cc-mask.ts` + tüm event yazım yolları **kaynağında** (`chats.ts`/`customer.ts`/`email-inbound.ts`) · yan kanal sweep temiz (request log body-loglamaz · `audit_log` meta · `.data/mail` · AI/skill yolu). NEGATİF-önce test: unit **16** (Luhn-geçmez sipariş no/telefon/UUID/timestamp MASKELENMEZ) + integration **9** (DB'de ham PAN yok — doğrudan SQL; cross-tenant). §4.5/GL-5 · §D57

#### KI18N1-2 — I18N1/2 · Widget + panel i18n

✅ tm 26 (26.1–26.4): bağımlılıksız katalog (tr/en) + t() fallback zinciri (aktif locale→en→anahtar, eksik-anahtar güvenliği) · panel shell/nav/⌘K t()'ye taşındı + hesap menüsü dil değiştirici · widget `createTranslator` (data-language → sabit locale, runtime değişimi yok) · format.ts Intl helper'ları locale'e bağlı · testler: t() fallback unit (panel+widget) · panel locale-switch smoke · widget mount-locale smoke · bundle P3 7.57 KB gzip ≪ 50 KB

#### KC1-C2-C8 — C1/C2/C8 · GDPR · KVKK · retention

✅ retention job bağlandı (tm 24): tenant-döngülü hard-delete (kapanmış thread→event/tag cascade · visit telemetri · `.data` mail) · `retention_list_tenants()` SECURITY DEFINER sayımı + RLS-scoped `withTenant` silme (cross-tenant fiziksel imkânsız) · pozitif-pencere guard · **dry-run varsayılan** (`--apply` ile siler) · idempotent · audit `data.retention_pruned`

#### KM5 — M5 · Gözlemlenebilirlik (request_id, OTel, metrikler)

✅ OTel bağlandı (tm 25): request/route SERVER span'i + `request_id` attribute (log `reqId` + `X-Request-Id` ile aynı) · `http.server.requests`/`.request.duration`/`.errors` metrikleri · konsol exporter (collector yok — sınır) · `OTEL_ENABLED` ile aç/kapa (test'te varsayılan kapalı) · in-memory exporter'a karşı 3 entegrasyon testi
