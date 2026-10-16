/**
 * Pins `scripts/audit/log-keys.mjs` (ID-08 · tm 288.1) — the CI step that keeps
 * a camelCase identity key (`chatId`, `licenseId`, `reqId`) out of every log
 * call in `apps/api` and `apps/rtm`. Placed here for the reason
 * `endpoint-ui-audit.test.ts` gives: the script is a repo-root tool, no package
 * owns it, and this directory is where repo-level artefacts get pinned.
 *
 * Three things are worth pinning. The scanner sees the shapes the defect
 * actually had (`customer.ts` wrote the shorthand `{ err, chatId }`, `push.ts`
 * the long form across lines); it does not cry wolf on a message, a comment or
 * a call that is not a log; and its list of twins is `LOG_KEYS`, so a key added
 * to the type and forgotten in the script goes red here.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { LOG_KEYS } from '@siyahtus/types';

// src/config → apps/api → apps → repo root (same resolution as load-env-file.ts)
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCRIPT = resolve(REPO_ROOT, 'scripts/audit/log-keys.mjs');

interface Finding {
  file: string;
  line: number;
  key: string;
  expected: string;
}
interface Audit {
  SCAN_ROOTS: string[];
  CAMEL_TWINS: Record<string, string>;
  findCamelLogKeys: (source: string, file?: string) => Finding[];
  auditRepository: () => { scanned: number; findings: Finding[] };
}

let audit: Audit;
beforeAll(async () => {
  audit = (await import(pathToFileURL(SCRIPT).href)) as Audit;
});

describe('scripts/audit/log-keys.mjs (ID-08)', () => {
  it('finds the shorthand and the long form, across lines and inside nested objects', () => {
    const source = [
      "request.log.warn({ err: error, chatId }, 'assignee notification failed');",
      'deps.log.warn(',
      '  {',
      '    err: error,',
      '    chatId: input.event.chatId,',
      '  },',
      "  'push notification failed',",
      ');',
      "this.#log.error({ provider: { licenseId: tenant.licenseId } }, 'nested');",
      "options.logger?.info({ reqId: request.id }, 'optional chain');",
      'const child = app.log.child({ threadId, customerId: c });',
    ].join('\n');

    const found = audit.findCamelLogKeys(source, 'x.ts');
    expect(found.map((f) => `${f.line}:${f.key}→${f.expected}`)).toEqual([
      '1:chatId→chat_id',
      '5:chatId→chat_id',
      '9:licenseId→license_id',
      '10:reqId→request_id',
      '11:threadId→thread_id',
      '11:customerId→customer_id',
    ]);
  });

  it('ignores a key-looking word in a message, a comment or a value, and calls that are not logs', () => {
    const source = [
      "request.log.warn({ err: error, chat_id: chatId }, 'chatId was { chatId: 1 }');",
      '// log.warn({ chatId })',
      '/* logger.info({ licenseId }) */',
      'const payload = { chatId, licenseId };',
      "await chats.sendEvent(tenant, principal, chatId, { chatId: 'x' });",
      'request.log.info({ chat_id: chatId, thread_id: threadId }, `chatId: ${chatId}`);',
      'reply.send({ customerId });',
    ].join('\n');

    expect(audit.findCamelLogKeys(source)).toEqual([]);
  });

  it('bans the camelCase twin of every LOG_KEYS entry, and nothing it does not map', () => {
    for (const [camel, snake] of Object.entries(LOG_KEYS)) {
      expect(audit.CAMEL_TWINS[camel], camel).toBe(snake);
    }
    const allowed = new Set<string>(Object.values(LOG_KEYS));
    for (const expected of Object.values(audit.CAMEL_TWINS)) expect(allowed).toContain(expected);
    expect(audit.CAMEL_TWINS['reqId']).toBe('request_id');
  });

  it('scans both server processes and finds nothing in the repository today', () => {
    expect(audit.SCAN_ROOTS).toEqual(['apps/api/src', 'apps/rtm/src']);
    const { scanned, findings } = audit.auditRepository();
    expect(scanned).toBeGreaterThan(200);
    expect(findings).toEqual([]);
  });
});
