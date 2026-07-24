#!/usr/bin/env node
// Deterministik görev günlüğü — AI YOK, anında yazar.
// update-subtask / update-task --append kullanılMAZ: ikisi de LLM'e gider ve
// claude-code provider oturum içinden çağrılınca kilitlenir (2026-07-24'te ölçüldü).
// Kullanım: node .taskmaster/gunluk.mjs <görev-id> "not"
import { readFileSync, writeFileSync } from 'node:fs';

const P = new URL('./tasks/tasks.json', import.meta.url);
const [id, ...rest] = process.argv.slice(2);
const not = rest.join(' ').trim();
if (!id || !not) {
  console.error('kullanım: node .taskmaster/gunluk.mjs <görev-id> "not"');
  process.exit(1);
}
const d = JSON.parse(readFileSync(P, 'utf8'));
const t = d.master.tasks.find((x) => String(x.id) === String(id));
if (!t) {
  console.error(`görev ${id} bulunamadı`);
  process.exit(1);
}
const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
t.details = (t.details ? t.details + '\n\n' : '') + `[günlük ${ts} UTC] ${not}`;
d.master.metadata.updated = new Date().toISOString();
writeFileSync(P, JSON.stringify(d, null, 2) + '\n');
console.log(`✓ görev ${id} günlüğüne yazıldı: ${not.slice(0, 60)}${not.length > 60 ? '…' : ''}`);
