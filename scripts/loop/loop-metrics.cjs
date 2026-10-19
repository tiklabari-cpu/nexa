#!/usr/bin/env node
// Döngü pencerelerinin maliyet/süre/bağlam ölçümü (.loop-logs/task-*.jsonl ve arşivdeki .gz'ler).
// Kullanım: node scripts/loop/loop-metrics.cjs [--from 281] [--to 999]
// Sütunlar: model, süre (dk), API çağrısı, maliyet ($), ilk tur bağlamı, okuma (Σ çağrı bağlamı,
// M token), araç çıktısı (k token, ~3,5 karakter/token), bunun okuma/arama payı, block.mjs
// kullanımı (yapı/ad-satır/desen çağrı sayıları), grep'ten hemen sonra gelen ayrı okuma
// çağrısı, yüklenen araç sayısı.
// Çağrı = tekil message.id (2026-10-19): akış kaydı bir yanıtın parçalarını ayrı satırlarda
// yazar; eskiden her parça ayrı çağrı sayılıyordu (≈2 kat).
// Taban 295.1–303.1 (n=26, medyan): çağrı 132, $10,66, okuma 28,9M, grep→oku 39.
// Tarif v1 (303.2–303.4): block yalnız yapı modunda 3/5/5 kez; çağrı 185/153/232, grep→oku
// 50/49/70 — kısayol olmadı. 2026-10-20'den itibaren re:desen sorgusu + örnekli tarif (v2);
// ölçmek istenen sorgulu kullanım, o yüzden gruplar "sorgulu block yok / var".
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const FROM = arg('--from', 281);
const TO = arg('--to', 1e9);
const DIR = path.resolve(__dirname, '..', '..', '.loop-logs');

const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text || '').join('') : '');
const shell = (u) => u.name === 'Bash' || u.name === 'PowerShell';
const isRead = (u) => u.name === 'Read' || u.name === 'Grep' || u.name === 'Glob' ||
  (shell(u) && /(^|[\s|;&(])(cat|sed|head|tail|grep|rg|ls|find|wc)\s/.test(u.cmd));
const isBlock = (u) => shell(u) && /scripts\/loop\/block\.mjs/.test(u.cmd);
// Bir komut metnindeki block.mjs çağrılarının modu: yapı (sorgusuz) · ad/satır · desen (re:/rei:).
const blockModes = (cmd) => {
  const modes = { yapı: 0, ad: 0, desen: 0 };
  for (const m of cmd.matchAll(/scripts\/loop\/block\.mjs\s+([^|;&\n]*)/g)) {
    const args = m[1].trim().split(/\s+/).filter((a) => a && a !== '--full');
    const queries = args.slice(1).filter((a) => !/[\\/]|\.\w+$/.test(a) || /^(re|rei):/.test(a));
    if (queries.length === 0) modes.yapı++;
    else if (queries.some((a) => /^(re|rei):/.test(a))) modes.desen++;
    else modes.ad++;
  }
  return modes;
};
const isGrep = (u) => u.name === 'Grep' || (shell(u) && /\b(grep|rg) -[a-zA-Z]*n/.test(u.cmd) && !isBlock(u));
const isRangeRead = (u) => u.name === 'Read' || (shell(u) && /\bsed -n|\bcat\s|\bhead -|\btail -/.test(u.cmd) && !isBlock(u));
const ctxOf = (u) => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);

const rows = [];
for (const f of walk(DIR).filter((p) => /task-[\d.]+\.jsonl(\.gz)?$/.test(p))) {
  const id = f.match(/task-([\d.]+)\.jsonl/)[1];
  const major = Number(id.split('.')[0]);
  if (major < FROM || major > TO) continue;
  let buf = fs.readFileSync(f);
  if (f.endsWith('.gz')) buf = zlib.gunzipSync(buf);
  const uses = {};
  const msgs = new Map(); // message.id → { ctx, tools[] } — bir çağrı
  let res = null, tools = 0, out = 0, readOut = 0;
  for (const line of buf.toString('utf8').split('\n')) {
    if (!line) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.type === 'system' && j.subtype === 'init') tools = (j.tools || []).length;
    if (j.type === 'result') res = j;
    if (j.type === 'assistant' && !j.parent_tool_use_id && j.message) {
      const key = j.message.id || `${msgs.size}`;
      if (!msgs.has(key)) msgs.set(key, { ctx: 0, tools: [] });
      const m = msgs.get(key);
      if (j.message.usage) m.ctx = ctxOf(j.message.usage);
      for (const c of j.message.content || []) {
        if (c.type !== 'tool_use') continue;
        uses[c.id] = { name: c.name, cmd: (c.input && c.input.command) || '' };
        m.tools.push(uses[c.id]);
      }
    }
    if (j.type === 'user') for (const c of (j.message && j.message.content) || []) {
      if (c.type !== 'tool_result' || !uses[c.tool_use_id]) continue;
      const n = text(c.content).length;
      out += n;
      if (isRead(uses[c.tool_use_id])) readOut += n;
    }
  }
  if (!res) continue;
  const calls = [...msgs.values()];
  const blocks = { yapı: 0, ad: 0, desen: 0 };
  let grepThenRead = 0;
  calls.forEach((c, i) => {
    for (const t of c.tools.filter(isBlock)) for (const [k, v] of Object.entries(blockModes(t.cmd))) blocks[k] += v;
    if (i > 0 && calls[i - 1].tools.some(isGrep) && c.tools.some(isRangeRead)) grepThenRead++;
  });
  const model = Object.entries(res.modelUsage || {}).sort((a, b) => b[1].costUSD - a[1].costUSD)[0];
  rows.push({
    id,
    model: model ? model[0].replace('claude-', '') : '?',
    min: +(res.duration_ms / 60000).toFixed(0),
    calls: calls.length,
    usd: +(res.total_cost_usd || 0).toFixed(2),
    'ilk tur (k)': calls.length ? Math.round(calls[0].ctx / 1000) : null,
    'okuma (M)': +(calls.reduce((s, c) => s + c.ctx, 0) / 1e6).toFixed(1),
    'araç çıktısı (k)': Math.round(out / 3500),
    'okuma %': out ? Math.round((100 * readOut) / out) : 0,
    'block yapı/ad/desen': `${blocks.yapı}/${blocks.ad}/${blocks.desen}`,
    sorgulu: blocks.ad + blocks.desen,
    'grep→oku': grepThenRead,
    araç: tools,
  });
}
rows.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
console.table(rows);
const med = (a) => { const s = a.filter((x) => x !== null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const grp = (name, f) => {
  const r = rows.filter(f);
  if (!r.length) return;
  console.log(`${name.padEnd(16)} n=${r.length}  çağrı ${med(r.map((x) => x.calls))}  $${med(r.map((x) => x.usd))}  ` +
    `ilk tur ${med(r.map((x) => x['ilk tur (k)']))}k  okuma ${med(r.map((x) => x['okuma (M)']))}M  ` +
    `grep→oku ${med(r.map((x) => x['grep→oku']))}  (medyan)`);
};
grp('sorgulu block yok', (r) => r.sorgulu === 0);
grp('sorgulu block var', (r) => r.sorgulu > 0);
