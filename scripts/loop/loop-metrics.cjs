#!/usr/bin/env node
// Döngü pencerelerinin maliyet/süre/bağlam ölçümü (.loop-logs/task-*.jsonl ve arşivdeki .gz'ler).
// Kullanım: node scripts/loop/loop-metrics.cjs [--from 281] [--to 999]
// Sütunlar: model, süre (dk), API çağrısı, maliyet ($), ilk tur bağlamı, araç çıktısı (k token,
// ~3,5 karakter/token), bunun okuma/arama payı, kod haritası çağrısı, yüklenen araç sayısı.
// Kod haritasının (2026-10-16) etkisini görmek için 281–288 tabanını sonraki görevlerle karşılaştır.
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
const isRead = (u) => u.name === 'Read' || u.name === 'Grep' || u.name === 'Glob' ||
  ((u.name === 'Bash' || u.name === 'PowerShell') && /(^|[\s|;&(])(cat|sed|head|tail|grep|rg|ls|find|wc)\s/.test(u.cmd));

const rows = [];
for (const f of walk(DIR).filter((p) => /task-[\d.]+\.jsonl(\.gz)?$/.test(p))) {
  const id = f.match(/task-([\d.]+)\.jsonl/)[1];
  const major = Number(id.split('.')[0]);
  if (major < FROM || major > TO) continue;
  let buf = fs.readFileSync(f);
  if (f.endsWith('.gz')) buf = zlib.gunzipSync(buf);
  const uses = {};
  let res = null, calls = 0, first = null, tools = 0, out = 0, readOut = 0, cbm = 0;
  for (const line of buf.toString('utf8').split('\n')) {
    if (!line) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.type === 'system' && j.subtype === 'init') tools = (j.tools || []).length;
    if (j.type === 'result') res = j;
    if (j.type === 'assistant' && !j.parent_tool_use_id) {
      calls++;
      const u = j.message && j.message.usage;
      if (u && first === null) first = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      for (const c of (j.message && j.message.content) || []) {
        if (c.type !== 'tool_use') continue;
        uses[c.id] = { name: c.name, cmd: (c.input && c.input.command) || '' };
        if (c.name.startsWith('mcp__codebase-memory__')) cbm++;
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
  const model = Object.entries(res.modelUsage || {}).sort((a, b) => b[1].costUSD - a[1].costUSD)[0];
  rows.push({
    id,
    model: model ? model[0].replace('claude-', '') : '?',
    min: +(res.duration_ms / 60000).toFixed(0),
    calls,
    usd: +(res.total_cost_usd || 0).toFixed(2),
    'ilk tur (k)': first === null ? null : Math.round(first / 1000),
    'araç çıktısı (k)': Math.round(out / 3500),
    'okuma %': out ? Math.round((100 * readOut) / out) : 0,
    harita: cbm,
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
    `ilk tur ${med(r.map((x) => x['ilk tur (k)']))}k  araç çıktısı ${med(r.map((x) => x['araç çıktısı (k)']))}k  ` +
    `okuma ${med(r.map((x) => x['okuma %']))}%  (medyan)`);
};
grp('harita yok', (r) => r.harita === 0);
grp('harita kullanıldı', (r) => r.harita > 0);
