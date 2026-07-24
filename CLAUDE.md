# Nexa — Claude Code Talimatları

## Doğruluk kaynağı sırası

Bir çelişki gördüğünde yukarıdaki kazanır. Aşağıdakini düzeltirsin, yukarıdakini tartışmazsın.

1. `urun-gereksinim-dokumani-PRD.md` — **ne** yapılacak (gereksinim kimlikleri: `FR-MOD-08.5.2`)
2. `PLAN.md` — **hangi sırada ve niçin** (ADR-01…15 kilitli, faz/dilim kırılımı, durum işaretleri)
3. `MASTER-PROMPT.md` — **nasıl çalışılacak** (zorluk etiketleri, bitti tanımı)
4. `.taskmaster/tasks/tasks.json` — **sıradaki iş + o işin çalışma günlüğü**

**Kural:** PRD kimliği olmayan iş yapılmaz (PLAN.md §1.1). Yeni ihtiyaç doğarsa önce PRD'de
karşılığı bulunur; yoksa PLAN.md §D'ye "PRD sapması" olarak yazılır.

## Task Master'ın buradaki rolü

Task Master **planlamaz, yürütür.** Yürütme defteridir: durum, bağımlılık sırası, `next`,
ve her işin altında biriken uygulama notları.

**Kullanılmayacak komutlar:** `parse-prd`, `expand`, `add-task --prompt`, `update --from` —
hiçbiri kod tabanını görmez; ADR'lerle çelişen jenerik adımlar ("veritabanı modelini
oluştur") yazarlar. Ayrıca **oturum içinden AI'ya giden hiçbir task-master komutu
çağrılmaz** (`update-task`, `update-subtask`, `research` dahil): claude-code provider
iç içe claude süreci açıp kilitleniyor (2026-07-24'te ölçüldü — 300 sn, sıfır çıktı).

**Görev günlüğü bunun yerine deterministik yazılır (AI yok, anında):**

```bash
node .taskmaster/gunluk.mjs <görev-id> "not"
```

**Görev ayrıştırması Claude Code tarafından yapılır** — gerçek dosyalar okunarak — ve
Task Master'a elle yazılır:

```bash
task-master add-task --title "..." --description "..." --details "..." \
  --dependencies "2,3" --priority high     # --prompt YOK → LLM devreye girmez
```

Bir işe başlamadan derinlik gerekiyorsa kod **doğrudan okunur** (Read/Grep).
`research` komutu yalnız oturum DIŞINDAN (kendi terminalinden) işe yarar; oturum
içinden aynı kilitlenme sorununa takılır.

## Oturum döngüsü — bir oturum = bir iş

`PLAN.md` 89 KB'dır; her oturumda okunmaz. Tek bir görev okunur.

Bu döngü `/is` komutuna gömülüdür — adımları elle yürütmek yerine `/is` çağrılır.
Seri çalışma: `/loop /is` (döngü kuralları `.claude/commands/is.md` sonunda: soru yerine
günlüklenmiş varsayım; her iş kendi commit'iyle kapanır, push edilmez; `[MAX]` işler
ayrı commit olur ve kapanış raporunda **[MAX] İNCELE** bölümüyle insana sunulur).
Dilim bitince `/dilim-kapat` — push oradadır. Ham adımlar referans için:

1. `task-master next` → sıradaki iş
2. `task-master show <id>` → ayrıntı; `details` alanındaki dosya yollarını oku
3. `task-master set-status --id=<id> --status=in-progress`
4. Planını yaz: `node .taskmaster/gunluk.mjs <id> "plan: ..."`
5. Uygula. Öğrendiğin her şeyi (çalışan/çalışmayan) aynı günlükçüyle düş —
   bir sonraki oturumun bağlamı budur
6. `task-master set-status --id=<id> --status=done`
7. **`/clear`** → yeni oturum, 1. adım

## Dilim kapanışı

Bir dilimin tüm işleri bittiğinde, `/clear`'dan önce:

1. `PLAN.md §3`'teki ilgili satırların durum işaretlerini güncelle (⬜/◐ → ✅)
2. `PLAN.md §3.11` dilim tablosunu ve baştaki faz sayacını güncelle
   (sayaç **sayılarak** üretilir, elle yazılmaz — PLAN.md §1.2)
3. Sapma varsa `PLAN.md §D`'ye, varsayım varsa `§C`'ye yaz
4. Commit + push
5. Sonraki dilimin görevlerini aynı yöntemle üret: kodu oku → elle `add-task`

## Bitti tanımı (her iş için)

- PRD kabul kriteri karşılandı — "ekran duruyor" yetmez
- Kontrat önce: yeni uç varsa `packages/contract/openapi/openapi.yaml` → generate → kod
- Hata zarfı ADR-06: `{ error: { type, message, request_id, details? } }`
- Her sorgu lisans kapsamlı; cross-tenant erişim testi var
- Testler yeşil (birim + ilgili Playwright E2E)
- `[MAX]` etiketli işlerde **negatif testler pozitiflerden önce** yazıldı

---

## Task Master AI Instructions

**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**
@./.taskmaster/CLAUDE.md
