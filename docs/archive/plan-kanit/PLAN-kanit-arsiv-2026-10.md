# PLAN.md §K kanıt arşivi — 2026-10

> Kaynak: `PLAN.md` `## K. Kanıt Geçmişi`. Canlı bloktan 3 maddeyi aşan eski maddeler (CONVENTIONS §1.2) buraya, aynı `#### K<kod>` başlığıyla taşınır.
> Arama: `grep -n '^#### K07.7' docs/archive/plan-kanit/*.md` — baştan okuma.

#### K02.1.1 — 02.1.1 · Chats grubu (All/My/Queued/Unassigned/Supervised/Archived)

- ✅ tm 286.3 · ID-02 3/5: ajan yolları günlük modelde — `POST /chats` günün sohbetinde açar (bugünkü sohbet varsa yeni bağlantı, ekip eklenir; dünkü sessiz bağlantı önce `day_rollover`), `resume` geçmiş günde bugünün sohbetinde devam eder (`continued_from_chat_id`, senaryo 9), kanal sohbetleri ziyaretçi yolunda (devir penceresi = sweep penceresi), `threads.group_id`, müşteri gün/bağlantı sayacı, `listDayConnections`; rapor regresyonu yeşil; damga değişmedi · `chat-service.ts:464` (`start`), `:2050` (`resume`), `:1084`, `conversation-day.ts:130`, `:221`, `channel-service.ts:538`, `customer-service.ts:505`, migration `20261015170000_thread_group` · `daily-thread-agent.test.ts` (21), `conversation-day.test.ts` (+5), `chats.test.ts` (2 uyarlandı), `InboxPage.reopen.test.tsx` (+1), `CustomerDetailPanel.test.tsx` (+1) · §D238

#### K02.4.1-.6 — 02.4.1–.6 · Details paneli (info/tags/visited pages/visit info)

- ✅ tm 284 · ID-01 (kimlik sözlüğü, K1 = A): Ayrıntılar paneli günlük kapsayıcı numarasını artık "Thread ID" (`chat_id`) diye gösterir, ipucu tooltip'te; Inbox başlığındaki numaraya aynı tooltip · `DetailsPanel.tsx:182-185`, `ThreadHeader.tsx:53-60`, `locales/{en,tr}/ids.ts` · `DetailsPanel.test.tsx`, `ids-glossary.test.ts` (9), `id-glossary.test.ts` (12) · §D234
