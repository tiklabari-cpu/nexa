// node --test scripts/loop/block.test.mjs — kapıda `statik › loop-tools` adımı.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { MAX_LINES, run } from './block.mjs';

const dir = mkdtempSync(join(tmpdir(), 'block-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function file(name, text) {
  const p = join(dir, name);
  writeFileSync(p, text);
  return p;
}
/** `== …:a-b` başlıklarındaki aralıklar. */
const ranges = (out) => [...out.matchAll(/^== .*?:(\d+)-(\d+) /gm)].map((m) => [+m[1], +m[2]]);

const SERVICE = `import { x } from './x';
import type { Y } from './y';

/** Sends one message. */
export function send(a: string): string;
export function send(a: number): string;
export function send(a: unknown): string {
  return String(a);
}

// Owns the queue.
@Injectable()
export class ChatService {
  #queue: string[] = [];

  constructor(private readonly db: Y) {}

  async push(item: string) {
    const sql = \`SELECT { "a": 1 } FROM t WHERE id = \${item}\`;
    function inner() {
      return sql;
    }
    return inner();
  }

  get size() {
    return this.#queue.length;
  }
}

export const handlers = {
  open: async (id: string) => {
    return id;
  },
  close() {
    return 1;
  },
};

export const area = (r: number) => Math.PI * r * r;
`;

describe('TypeScript', () => {
  const f = file('service.ts', SERVICE);

  test('overload ve JSDoc ile birlikte fonksiyon', () => {
    const { out, code } = run([f, 'send']);
    assert.equal(code, 0);
    // İki overload imzası (ilki JSDoc'uyla) + gövde: üçü de basılır.
    assert.deepEqual(ranges(out), [[4, 5], [6, 6], [7, 9]]);
    assert.ok(out.includes('return String(a);'));
  });

  test('sınıf metodu: yorum + decorator dahil sınıf, sahibiyle metod', () => {
    const cls = run([f, 'ChatService']);
    assert.deepEqual(ranges(cls.out), [[11, 29]]);
    const m = run([f, 'ChatService.push']);
    assert.deepEqual(ranges(m.out), [[18, 24]]);
    assert.ok(m.out.includes('SELECT { "a": 1 }'), 'süslü parantezli template string bloğu bölmez');
    assert.deepEqual(ranges(run([f, 'size']).out), [[26, 28]]);
  });

  test('iç içe fonksiyon ve obje metodları', () => {
    assert.deepEqual(ranges(run([f, 'inner']).out), [[20, 22]]);
    assert.deepEqual(ranges(run([f, 'handlers.open']).out), [[32, 34]]);
    assert.deepEqual(ranges(run([f, 'close']).out), [[35, 37]]);
    assert.deepEqual(ranges(run([f, 'area']).out), [[40, 40]]);
  });

  test('satır sorgusu en içteki anlamlı bloğu verir', () => {
    assert.deepEqual(ranges(run([f, '19']).out), [[18, 24]]);
    assert.deepEqual(ranges(run([f, '33']).out), [[32, 34]]);
  });

  test('tek çağrıda birden fazla sorgu', () => {
    const { out, code } = run([f, 'inner', 'area']);
    assert.equal(code, 0);
    assert.deepEqual(ranges(out), [[20, 22], [40, 40]]);
  });

  test('yapı: importlar özet, bildirimler satır aralığıyla', () => {
    const { out } = run([f]);
    assert.match(out, /1-2\s+importlar \(2\)/);
    assert.match(out, /11-29\s+class ChatService/);
    assert.match(out, /18-24\s+ {2}method ChatService\.push/);
  });

  test('bulunamadı: exit 1, yokluk iddiası yok', () => {
    const { out, code } = run([f, 'nothingLikeThis']);
    assert.equal(code, 1);
    assert.match(out, /bulunamadı/);
    assert.match(out, /yokluk kanıtı değildir/);
  });
});

describe('testler, JSX, CRLF, BOM', () => {
  test('describe / it / it.each başlıkla bulunur', () => {
    const f = file(
      'x.test.ts',
      `import { it, describe } from 'vitest';
describe('Risk bayrakları', () => {
  const fx = 1;
  it('yarım kalmış görevi işaretler', async () => {
    expect(fx).toBe(1);
  });
  it.each([1, 2])('sayı %s', (n) => {
    expect(n).toBeTruthy();
  });
});
`,
    );
    assert.deepEqual(ranges(run([f, 'it:yarım kalmış']).out), [[4, 6]]);
    assert.deepEqual(ranges(run([f, 'describe:risk']).out), [[2, 10]]);
    assert.deepEqual(ranges(run([f, 'it:sayı']).out), [[7, 9]]);
    assert.deepEqual(ranges(run([f, '5']).out), [[4, 6]]);
    const outline = run([f]).out;
    assert.doesNotMatch(outline, /const fx/, 'yerel const yapıda gösterilmez');
  });

  test('JSX bileşeni', () => {
    const f = file(
      'Badge.tsx',
      `export function Badge({ label }: { label: string }) {
  return <span className="badge">{label}</span>;
}
`,
    );
    assert.deepEqual(ranges(run([f, 'Badge']).out), [[1, 3]]);
  });

  test('CRLF ve BOM satır numaralarını kaydırmaz, Türkçe korunur', () => {
    const f = file('crlf.ts', String.fromCharCode(0xfeff) + '// başlık\r\nexport function şimdi() {\r\n  return "ğüşiöç";\r\n}\r\n');
    const { out } = run([f, 'şimdi']);
    assert.deepEqual(ranges(out), [[1, 4]]);
    assert.ok(out.includes('return "ğüşiöç";'));
    assert.ok(!out.includes('\r'));
    assert.ok(!out.includes(String.fromCharCode(0xfeff)), 'BOM çıktıya sızmaz (Edit old_string kopyası bozulur)');
  });
});

describe('büyük blok ve çoklu eşleşme', () => {
  test(`${MAX_LINES} satırdan uzun blokta ilk satırlar + iç bloklar; --full tamamı`, () => {
    const methods = Array.from({ length: 80 },(_, i) => `  m${i}() {\n    return ${i};\n  }\n`).join('');
    const f = file('big.ts', `export class Big {\n${methods}}\n`);
    const short = run([f, 'Big']).out;
    assert.match(short, /200 satırdan uzun/);
    assert.match(short, /method Big\.m59/);
    assert.ok(!short.includes('return 59;'), 'gövde basılmaz');
    assert.ok(short.split('\n').length < 100);
    const full = run([f, 'Big', '--full']).out;
    assert.ok(full.includes('return 79;'));
  });

  test('aynı adla çok sayıda eşleşme listelenir', () => {
    const f = file('many.ts', Array.from({ length: 5 }, (_, i) => `class C${i} {\n  run() {\n    return ${i};\n  }\n}\n`).join(''));
    const { out } = run([f, 'run']);
    assert.match(out, /5 eşleşme — hangisi\?/);
    assert.match(out, /method C4\.run/);
  });
});

describe('diğer dosya türleri', () => {
  test('.md: başlık bölümü; başlıkta yoksa grep', () => {
    const f = file('doc.md', '# Başlık\n\ngiriş\n\n## §K Kapanış\n\nsatır bir\nkırmızı kapı kuralı\n\n## Sonraki\n\nson\n');
    assert.deepEqual(ranges(run([f, '§K']).out), [[5, 8]]);
    const g = run([f, 'kırmızı kapı']);
    assert.equal(g.code, 0);
    assert.match(g.out, /başlıklarda yok — grep/);
  });

  test('.md: kod bloğundaki # başlık sayılmaz', () => {
    const f = file('fence.md', '# A\n\n```bash\n# yorum\n```\n\n## B\n');
    assert.doesNotMatch(run([f]).out, /yorum/);
  });

  test('.prisma: model bloğu, üstündeki /// yorumla', () => {
    const f = file('schema.prisma', 'datasource db {\n  provider = "postgresql"\n}\n\n/// Bir yetenek.\nmodel Skill {\n  id String @id\n}\n');
    assert.deepEqual(ranges(run([f, 'Skill']).out), [[5, 8]]);
  });

  test('.sql: grep geri düşüşü, bulunamazsa exit 1', () => {
    const f = file('m.sql', 'CREATE TABLE a (id int);\nALTER TABLE a ADD COLUMN b int;\n');
    const hit = run([f, 'ALTER TABLE']);
    assert.equal(hit.code, 0);
    assert.match(hit.out, /AST yok — grep/);
    assert.equal(run([f, 'DROP']).code, 1);
  });

  test('kullanım hatası: exit 2', () => {
    assert.equal(run([]).code, 2);
    assert.equal(run([join(dir, 'yok.ts'), 'x']).code, 2);
  });
});

describe('gerçek repo dosyası (duman)', () => {
  test('test-gate.mjs içindeki runStep fonksiyonu', () => {
    const { out, code } = run(['scripts/test-gate.mjs', 'runStep']);
    assert.equal(code, 0);
    const [[s, e]] = ranges(out);
    assert.ok(e - s > 10 && e - s < 60, `runStep aralığı makul olmalı: ${s}-${e}`);
    assert.match(out, /function runStep\(heading, step\)/);
  });
});
