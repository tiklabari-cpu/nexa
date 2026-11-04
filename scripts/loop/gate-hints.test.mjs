// node --test scripts/loop/gate-hints.test.mjs — kapıda `statik › loop-tools` adımı.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { rerunCommand, rerunHints } from './gate-hints.mjs';

describe('rerunCommand', () => {
  test('api: kendi veritabanıyla vitest', () => {
    assert.equal(
      rerunCommand('@siyahtus/api', ['test/a.test.ts']),
      'pnpm --filter @siyahtus/api exec tsx scripts/with-test-datastores.ts vitest run test/a.test.ts',
    );
  });

  test('rtm: script api klasöründen çağrılır (rtm/scripts yok)', () => {
    assert.equal(
      rerunCommand('@siyahtus/rtm', ['src/a.test.ts']),
      'pnpm --filter @siyahtus/rtm exec tsx ../api/scripts/with-test-datastores.ts vitest run src/a.test.ts',
    );
  });

  test('mobil: jest, vitest değil', () => {
    const cmd = rerunCommand('@siyahtus/mobile', ['src/a.test.tsx', 'src/b.test.ts']);
    assert.equal(cmd, 'cd apps/mobile && npx jest src/a.test.tsx src/b.test.ts');
    assert.ok(!cmd.includes('vitest'));
    assert.ok(!cmd.includes('with-test-datastores'));
  });

  test('web / widget / admin: veritabanı yok, uygulama klasöründe vitest', () => {
    for (const app of ['web', 'widget', 'admin']) {
      const cmd = rerunCommand(`@siyahtus/${app}`, ['src/a.test.tsx']);
      assert.equal(cmd, `cd apps/${app} && npx vitest run src/a.test.tsx`);
    }
  });

  test('paketler (types, contract, ai-*) packages/ altında çalışır', () => {
    assert.equal(
      rerunCommand('@siyahtus/types', ['src/a.test.ts']),
      'cd packages/types && npx vitest run src/a.test.ts',
    );
    assert.equal(
      rerunCommand('@siyahtus/ai-mock', ['src/a.test.ts']),
      'cd packages/ai-mock && npx vitest run src/a.test.ts',
    );
  });
});

describe('rerunHints', () => {
  test('turbo önekli FAIL satırları pakete göre gruplanır, aynı dosya bir kez', () => {
    const log = [
      '@siyahtus/web:test:unit:  FAIL  src/i18n-coverage.test.ts > x',
      '@siyahtus/web:test:unit:  FAIL  src/i18n-coverage.test.ts > y',
      '@siyahtus/mobile:test:  FAIL  src/config.test.ts',
      '@siyahtus/rtm:test:unit:  FAIL  src/gateway.test.ts > z',
      ' FAIL  test/integration/chat.test.ts > q',
    ].join('\n');
    assert.deepEqual(rerunHints(log), [
      'cd apps/web && npx vitest run src/i18n-coverage.test.ts',
      'cd apps/mobile && npx jest src/config.test.ts',
      'pnpm --filter @siyahtus/rtm exec tsx ../api/scripts/with-test-datastores.ts vitest run src/gateway.test.ts',
      'pnpm --filter @siyahtus/api exec tsx scripts/with-test-datastores.ts vitest run test/integration/chat.test.ts',
    ]);
  });

  test('renk kodları atılır, kırmızı yoksa boş liste', () => {
    assert.deepEqual(rerunHints('\x1b[31m@siyahtus/web:test:  FAIL  src/a.test.tsx\x1b[39m'), [
      'cd apps/web && npx vitest run src/a.test.tsx',
    ]);
    assert.deepEqual(rerunHints('everything passed'), []);
  });
});
