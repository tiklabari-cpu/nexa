# Task Master İnşa Planı — §G → Görev Ağacı (Blueprint)

> **Amaç:** PLAN.md §G'deki atomik iş kırılımını Task Master görev ağacına dönüştürmenin
> **çerçevesi**. Bu dosya 3 turluk inşanın **Tur 1** çıktısıdır (öneri #1 = parent→subtask +
> bağımlılık; öneri #2 = dilim-başına çalıştırma + kontrol). Tur 2 iskeleti kurar, Tur 3
> her görevi full-otonom detaya çıkarır.
>
> **Kaynaklar:** iş kimliği + KK PLAN.md §3.13/§4.4/§G'den · runner protokolü
> `TASK-RUNNER-PROMPT.md` · döngü `run-loop.sh` · DoD `CONVENTIONS.md` · kapanış kapısı
> PLAN.md §F.00 · periyodik denetim §F.0.

---

## 0) Kararlar (Tur 1'de sabitlenen)

| # | Karar | Değer |
|---|-------|-------|
| K1 | Numaralandırma | Biten 26 görev (tm 1–26) **dokunulmaz**; yeni işler **tm 27+**. |
| K2 | Etiket (tag) | `master` (mevcut tek tag). |
| K3 | Şema | Parent: `id`(str), `title`, `description`, `details`, `testStrategy`, `status`, `dependencies`(str id dizisi), `priority`, `subtasks`. Subtask: `id`(int), `title`, `description`, `details`, `testStrategy`, `status`, `dependencies`, `parentId`(str). |
| K4 | Efor etiketi | run-loop `[MAX]`→`max`, değilse `xhigh`. Etiket **başlık/detayda** `[MAX]` olarak yazılır (pick_next oradan okur). |
| K5 | **Kapsam derinliği** | ~~Faz-0+v1 tam, v2/v3 placeholder~~ → **GÜNCELLENDİ (kullanıcı):** **TÜM fazlar tam detay.** Faz-0+v1+v2+v3'ün hepsi full-otonom detay taşır (KK birebir/türetilmiş). v2/v3 detayında "faz başında §F.0 ile gözden geçir + gerekiyorsa subtask'a böl" notu (PLAN §5.1 bayatlama uyarısı korunur, ama görevler şimdi tam yazıldı). |
| K6 | Materyalizasyon | Tur 2'de `tasks.json`'a tm 27+ **doğrudan yazılır** (deterministik, tam kontrol) + `metadata.taskCount` güncellenir; sonra Task Master `validate_dependencies` ile doğrulanır. (Alternatif: MCP `add_task`/`add_subtask` — AI-üretimli, daha az kontrol.) |
| K7 | Priority | Faz-0 = `high`; v1 Must = `high`; v1 Should = `medium`; v2/v3 = `low`. run-loop eşitlikte yüksek önceliği seçer. |

---

## 1) Gruplama ilkesi (öneri #1)

- **Sıkı bağlı** (aynı dosya/yüzey + ardışık bağımlılık + biri yarım kalırsa yarım yüzey) →
  **parent + subtask**. Tek pencere parent'ı bitirir; **her subtask DoD kapısından tek tek
  geçer** (CONVENTIONS §4). Böylece "operasyon+kontrol" turu subtask başına korunur (Not-3).
- **Gevşek bağlı** (bağımsız özellik, ayrı doğrulanabilir) → **düz görev, olabildiğince çok
  parça** (öneri: max-split). Ayrı pencere/paralellik + ince izleme.

### Parent (sıkı bağlı küme) → subtask

| tm | Parent | Subtask'lar | Dilim | Etiket |
|----|--------|-------------|-------|--------|
| 27 | 02.4 Details ziyaret bilgisi | T3-a (getChat kontrat+backend) · T3-b (Details UI) | F0-1 | XHIGH |
| 29 | EK-A Form & girdi katmanı | T4-a (primitif+2 pilot) · T4-b (kalan formlar) · T5-a (kapatma onayı+davranış) | F0-2 | XHIGH |
| 30 | EK-B.1 Liste katmanı | T6-a (virtualization) · T6-b (skeleton+empty state) | F0-3 | XHIGH |
| 33 | 05 Playbook tamamlama | 05.1-a · 05.2-a · 05.3-a · 05.4-a | V1-Playbook | XHIGH |
| 34 | 06 AI Agent + Knowledge | 06.1-a · 06.2.4-a `[MAX]` · 06.3.1-a · 06.3.2-a `[MAX]` · 06.4-a · 06.5-a | V1-AI | MAX (karışık) |
| 35 | 08.8.4 Webhooks `[MAX]` | 08.8.4-a · -b `[MAX]` · -c `[MAX]` · -d | V1-Webhook | MAX |
| 36 | 08.5 Omnichannel (MOCK) | adapter-a · 08.5.4-a · 08.5.5-a · 08.5.6-a | V1-Channels | XHIGH |
| 37 | 12 Copilot | 12.2-a `[MAX]` · 12.1-a · 12.3-a (+02.5) | V1-Copilot | MAX (karışık) |
| 44 | 03.3 Campaigns | 03.3.1-a · 03.3.2-a `[MAX]` · 03.3.3-a | V1-Customers | MAX (karışık) |
| 54 | 09 Apps Marketplace | 09.1-a · 09.2-a · 08.8.1-a | V1-Apps | XHIGH |

### Düz (gevşek bağlı, max-split)

| tm | Görev | PRD | Dilim | Etiket |
|----|-------|-----|-------|--------|
| 28 | 01.3 Sağ panel switcher (T1-a) | 01.3 | F0-1 | XHIGH |
| 31 | 13.8 E-posta bildirim (T7-a) | 13.8 | F0-3 | XHIGH |
| 38 | 02.1.2-a AI Agents grubu | 02.1.2 | V1-Inbox | XHIGH |
| 39 | 02.1.4-a Views grubu | 02.1.4 | V1-Inbox | XHIGH |
| 40 | 02.3.2-a Reply Suggestions | 02.3.2 | V1-Inbox | XHIGH |
| 41 | 02.7-a Tickets grid | 02.7 | V1-Inbox | XHIGH |
| 42 | 02.9-a Live typing preview (+11.8) | 02.9 | V1-Inbox | XHIGH |
| 43 | 03.1.3-a Ziyaretçi tablosu | 03.1.3 | V1-Customers | XHIGH |
| 45 | 07.4-a AI Agent raporu | 07.4 | V1-Reports | XHIGH |
| 46 | 07.8-a Reviews/Ratings raporu | 07.8 | V1-Reports | XHIGH |
| 47 | 07.7-a Rapor grupları+Export CSV | 07.7 | V1-Reports | XHIGH |
| 48 | 08.6.2-a Ticket rules | 08.6.2 | V1-Settings | XHIGH |
| 49 | 08.7.3-a Chat timeout | 08.7.3 | V1-Settings | XHIGH |
| 50 | 08.7.4-a Chat transcripts (e-posta) | 08.7.4 | V1-Settings | XHIGH |
| 51 | 08.7.5-a Ticket email templates | 08.7.5 | V1-Settings | XHIGH |
| 52 | 08.7.6-a Custom fields | 08.7.6 | V1-Settings | XHIGH |
| 53 | 08.7.7-a Forms builder `[MAX]` | 08.7.7 | V1-Settings | MAX |
| 55 | 10.1.4-a AI meter UI + %80 | 10.1.4 | V1-Billing | XHIGH |
| 56 | 10.1.5-a API calls aşım | 10.1.5 | V1-Billing | XHIGH |
| 57 | 10.3-a Invoices+payment | 10.3 | V1-Billing | XHIGH |
| 58 | 11.7-a Widget customization | 11.7 | V1-Widget | XHIGH |
| 59 | 04.2-a Team AI Agents performance | 04.2 | V1-Team | XHIGH |
| 60 | 04.6-a Chatbots/Suspended | 04.6 | V1-Team | XHIGH |
| 61 | 13.1-a Home dashboard | 13.1 | V1-Home | XHIGH |
| 62 | 13.6-a HelpDesk katmanı `[MAX]` (başında bölünür) | 13.6 | V1-Home | MAX |

### Faz sıralaması — **priority tabanlı** (kapı görevi YOK)

> **Değişiklik (kullanıcı, Tur 2):** "faz sınırında dur" özelliği **kaldırıldı**. `[GATE]`
> görevleri yok. §1.3 ("Faz-0 kapanmadan v1'e geçilmez") artık **priority** ile korunuyor:
> Faz-0 = `high` · v1 Must = `medium` · v1 Should / v2 / v3 = `low`. run-loop eşitlikte en yüksek
> önceliği seçtiği için Faz-0 tamamen boşalmadan v1'e geçmez — **durmadan, sorunsuz akar**. Bir
> Faz-0 görevi `blocked` olursa döngü zaten durur (run-loop davranışı), yani Faz-0 sessizce
> atlanamaz. Kapanış turu (§F.1 tam denetim) proje sonuna kalır (§F); dilim içi kontrol §F.0
> mini denetimle korunur (Not-3).
>
> **Nihai numaralandırma `tasks.json`'da kesinleşti (Tur 2):** Faz-0 = tm 27–31 · v1 = tm 32–61 ·
> v2 backlog = tm 62 (parent) · v3 backlog = tm 63 (parent). Aşağıdaki gruplama tablolarındaki
> eski numaralar indikatiftir; **kaynak `tasks.json`**.

---

## 2) Bağımlılık grafiği (öneri #1)

- **Faz-0 içi:** F0-1 (27,28) · F0-2 (29) · F0-3 (30,31) büyük ölçüde **paralel** (bağımsız
  yüzeyler). Subtask-içi sıra: T3-b→T3-a; T4-b→T4-a; T5-a→T4-a; T6-b→T6-a.
- **Faz geçişi (sert kural, §1.3):** her v1 görevi **tm 32 (FAZ-0 GATE)**'e bağımlı. Faz-0
  kapanmadan hiçbir v1 görevi "ready" olmaz — run-loop v1'e geçemez.
- **v1 içi seçili bağımlılıklar:** 39→36 (Views kanalları bekler) · 40→37 (Reply suggestions
  ai-mock) · 44→29 (Campaigns form katmanı) · 50→31 (transcript mailer) · 59→34+37 (team perf,
  06.5-a + 12.2-a) · 48/51/52→29 (form deseni) · 54(Apps)→41? hayır, 41(Tickets grid)→30 (T6-a).
- **v1 kapanış:** tm 63 tüm v1 Must'a bağımlı → v2 tm 64'e bağımlı.

Tur 2'de her satırın `dependencies` alanı §G "Bağımlılık" sütunundan **birebir** doldurulur;
sonra `validate_dependencies` ile döngü/eksik referans denetlenir.

---

## 3) Çalıştırma modeli (öneri #2) + 3 Not

### 3.1 Pencere = dilim/parent (öneri #2)

run-loop bir görevi temiz pencerede çalıştırır. Hedef bir **parent** ise, o pencere parent'ın
subtask'larını sırayla yapar; **her subtask kendi DoD kapısından geçer** (Not-3), hepsi bitince
parent `done`. Gevşek/düz görevler ayrı pencere. "Her atomik göreve ayrı pencere" **değil** —
soğuk başlangıç israfını sıkı kümede önler, gevşekte paralelliği açar.

### 3.2 Not-1 — Faz sıralaması (priority; **dur YOK** — kullanıcı kararı)

Faz sınırında otomatik dur **kaldırıldı**. §1.3 ordering'i **priority** koruyor: Faz-0 `high` >
v1 Must `medium` > v1 Should/v2/v3 `low`. run-loop ready görevler arasından en yüksek önceliği
seçtiği için, herhangi bir Faz-0 görevi ready durdukça v1'e geçmez; Faz-0 tümüyle `done` olunca
v1 (medium) en yükseğe çıkar ve döngü **durmadan** devam eder. Bir Faz-0 görevi `blocked` olursa
run-loop zaten durur (mevcut davranış) — Faz-0 sessizce atlanamaz. Faz-close **tam** denetimi
(§F.1) proje sonuna kalır; faz ortası kontrol §F.0 mini denetimle (Not-3) sağlanır.

### 3.3 Not-2 — Her task başında bağlam kopmaması

Runner protokolü (TASK-RUNNER-PROMPT §0) zaten bootstrap yapıyor. Bağlam bütünlüğünün asıl
kaldıracı: **her görevin `details`'i kendi kendine yeter** (Tur 3'te doldurulur) —
**Bağlam Bootstrap Sözleşmesi**, her görev `details`'inde zorunlu:

1. **PRD kimliği + KK (birebir)** — PLAN'dan kopya (uydurma yok).
2. **Neden açık** — dosya:satır çapası (kod bugün ne yapıyor).
3. **Kapsam** — dokunulacak dosyalar/katmanlar; contract-first sıra.
4. **KK doğrulama** — her KK maddesi hangi test/komut/E2E ile kanıtlanır.
5. **Zorunlu testler** — birim/integration/E2E + cross-tenant + negatifler.
6. **Kapsam dışı** — bitişik ama YAPILMAYACAK iş (faz sızıntısı kalkanı).
7. **Bağlam işaretçileri** — `PLAN.md §<x>` + ilgili ADR + bağımlı task id'leri.

Pencere bağlamı konuşmadan değil, **görev detayı + PLAN + git + HANDOFF**'tan kurar. Bu sözleşme
Tur 3'ün kabul kriteridir.

### 3.4 Not-3 — Her işlemden sonra kontrol turu (korunur)

- **Görev/subtask başına:** DoD kapısı (CONVENTIONS §1) — typecheck+lint+unit+integration+build+
  E2E+KK. Parent'ta **her subtask ayrı ayrı** geçer (kontrol turu subtask başına korunur).
- **Dilim/5-task/blocked sınırında:** PLAN.md **§F.0 mini denetim** (6 madde: kapsam, faz
  sızıntısı, NFR, contract-parity, sessiz borç, doküman tazeliği). GATE görevleri bunun ağır
  sürümünü (§F.1) taşır; dilim-içi mini denetim runner talimatı olarak Tur 3'te her dilimin
  **son** görevinin `details`'ine eklenir.

---

## 4) Tur 2 ve Tur 3 ne üretecek

- **Tur 2 (iskelet):** tm 27–63 (+v2/v3 placeholder) `tasks.json`'a yazılır — `id`, `title`
  (etiketli), `dependencies`, parent/subtask hiyerarşisi, `priority`, `status:pending`. Kısa
  `description`. `metadata.taskCount` güncellenir. `validate_dependencies` yeşil.
- **Tur 3 (otonom detay):** her görev/subtask'ın `details` + `testStrategy`'si **Bağlam Bootstrap
  Sözleşmesi**ne (§3.3) göre doldurulur — KK birebir, dosya çapaları, doğrulama komutları,
  negatif testler, kapsam dışı, dilim mini-denetim talimatı, GATE görevlerine §F.1 talimatı.
  Çıktı: Task Master'a verildiğinde full-otonom gidebilen görev ağacı.

## 5) İnşa durumu (2026-07-25)

**TAMAMLANDI — 3 tur + tam kapsama.** tasks.json'da tm 27–84 (58 yeni üst görev + 34 subtask = 82 atomik).
- **PLAN → Task Master kapsama: %100** — Faz-0+v1 (§G) 59/59 · v2 (§5.1) 16/16 · v3 (§6.1) 6/6 · EK-C.2 (§7.1 boşluğu) + 11.5 dâhil. (⛔ kalemler: 13.4, voice, çeviri, ambar — görev YOK, doğru.)
- **Detay: 92/92 kalem full-otonom** (KK birebir/türetilmiş + dosya çapası + doğrulama + testler + kapsam dışı + PLAN/ADR işaretçileri).
- **`[MAX]`: 21 kalem** (efor=max). Priority: Faz-0 high · v1 Must medium · gerisi low.
- `validate_dependencies` temiz · `next_task` → tm 27.

Numaralandırma: Faz-0 27–31 · v1 32–61 · EK-C.2 62 · v2 63–78 · v3 79–84.
