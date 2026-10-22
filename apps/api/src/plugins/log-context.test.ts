/**
 * `plugins/log-context.ts` (ID-08 · tm 288.1) on a bare Fastify instance: what
 * a line carries after each bind, that a rebind replaces rather than stacks,
 * and that the closing `request completed` line sees what the handler learnt.
 * The real server, end to end from a widget message through the AI path, is
 * `test/integration/log-context.test.ts`.
 */
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { afterEach, describe, expect, it } from 'vitest';
import { capabilitiesForRole, LOG_KEY_LIST } from '@siyahtus/types';
import type { Principal } from '../services/auth/principal.js';
import logContext, {
  bindChatLogContext,
  bindLogContext,
  logContextOf,
  principalLogContext,
} from './log-context.js';

const AGENT: Principal = {
  kind: 'agent',
  accountId: '6a1f0c2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
  licenseId: 9_007_199_254_740_993n, // past Number's precision on purpose
  organizationId: '0f9e8d7c-6b5a-4f3e-9d2c-1b0a9f8e7d6c',
  role: 'agent',
  capabilities: capabilitiesForRole('agent', []),
  scopes: [],
  tokenId: 'tok-1',
  tokenKind: 'pat',
};

class Sink {
  readonly raw: string[] = [];
  write(chunk: string): boolean {
    this.raw.push(chunk);
    return true;
  }
  lines(): Array<Record<string, unknown>> {
    return this.raw.map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}

/** How many times each identity key was written on one raw line. */
function occurrences(raw: string): Record<string, number> {
  return Object.fromEntries(
    LOG_KEY_LIST.map((key) => [key, raw.split(`"${key}":`).length - 1] as const),
  );
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function server(sink: Sink, principal: Principal | null): Promise<FastifyInstance> {
  const instance = Fastify({
    logger: { level: 'info', stream: sink },
    logController: new LogController({ requestIdLogLabel: 'request_id' }),
  });
  // Stands in for `plugins/auth.ts`: binds the principal the way it does.
  await instance.register(
    fp(
      async (inner: FastifyInstance) => {
        inner.addHook('onRequest', async (request) => {
          if (principal) bindLogContext(request, principalLogContext(principal));
        });
      },
      { name: 'auth' },
    ),
  );
  await instance.register(logContext);
  return instance;
}

describe('principalLogContext', () => {
  it('names the workspace and the actor for every principal kind, the licence as a string', () => {
    expect(principalLogContext(AGENT)).toEqual({
      license_id: '9007199254740993',
      organization_id: AGENT.organizationId,
      actor_type: 'agent',
      actor_id: AGENT.kind === 'agent' ? AGENT.accountId : '',
    });
    const base = { licenseId: 7n, organizationId: 'org' };
    expect(
      principalLogContext({ ...base, kind: 'customer', customerId: 'cust-1' } as Principal),
    ).toEqual({
      license_id: '7',
      organization_id: 'org',
      actor_type: 'customer',
      actor_id: 'cust-1',
      customer_id: 'cust-1',
    });
    expect(
      principalLogContext({
        ...base,
        kind: 'bot',
        botId: 'bot-1',
        scopes: [],
        tokenId: 't',
        tokenKind: 'bot',
      }),
    ).toMatchObject({ actor_type: 'bot', actor_id: 'bot-1' });
    expect(
      principalLogContext({
        ...base,
        kind: 'scim',
        tokenId: 'scim-tok',
        tokenKind: 'scim',
        scopes: [],
      }),
    ).toMatchObject({ actor_type: 'scim', actor_id: 'scim-tok' });
    expect(
      principalLogContext({
        ...base,
        kind: 'enrollment',
        accountId: 'acc-1',
        tokenId: 't',
        tokenKind: 'enrollment',
        scopes: [],
      }),
    ).toMatchObject({ actor_type: 'enrollment', actor_id: 'acc-1' });
  });
});

describe('log-context plugin', () => {
  it('binds the principal, then the route params, and every later line carries each key exactly once', async () => {
    const sink = new Sink();
    app = await server(sink, AGENT);
    app.get('/chats/:chatId/threads/:threadId', async (request) => {
      request.log.info('handler line');
      // Re-binding the same values must not add a second copy.
      bindChatLogContext(request, { chatId: 'CHAT000001', threadId: 'THRD000001' });
      request.log.info('after a no-op rebind');
      return { ok: true };
    });

    await app.inject({ method: 'GET', url: '/chats/CHAT000001/threads/THRD000001' });

    const lines = sink.lines();
    const handler = lines.find((line) => line['msg'] === 'handler line');
    expect(handler).toMatchObject({
      license_id: '9007199254740993',
      organization_id: AGENT.organizationId,
      actor_type: 'agent',
      chat_id: 'CHAT000001',
      thread_id: 'THRD000001',
    });
    expect(handler).not.toHaveProperty('reqId');
    expect(typeof handler?.['request_id']).toBe('string');

    for (const raw of sink.raw.filter((line) => !line.includes('"incoming request"'))) {
      for (const [key, count] of Object.entries(occurrences(raw))) {
        expect({ key, count: count > 1 ? count : 'ok' }).toEqual({ key, count: 'ok' });
      }
    }
  });

  it('replaces a narrowed value rather than writing the key twice, and the closing line sees it', async () => {
    const sink = new Sink();
    app = await server(sink, AGENT);
    let seen: unknown;
    app.post('/customer/chat/events', async (request) => {
      bindChatLogContext(request, { chatId: 'DAYCHAT001' });
      bindChatLogContext(request, { chatId: 'DAYCHAT001', threadId: 'CONN000001' });
      // A later fact wins — what a handler that learns the real chat wants.
      bindChatLogContext(request, { chatId: 'DAYCHAT002', threadId: null });
      seen = logContextOf(request);
      request.log.info('narrowed');
      return { ok: true };
    });

    await app.inject({ method: 'POST', url: '/customer/chat/events', payload: {} });

    expect(seen).toMatchObject({ chat_id: 'DAYCHAT002', thread_id: 'CONN000001' });
    const narrowedRaw = sink.raw.find((line) => line.includes('"narrowed"'))!;
    expect(occurrences(narrowedRaw)).toMatchObject({ chat_id: 1, thread_id: 1, license_id: 1 });
    const completed = sink.lines().find((line) => line['msg'] === 'request completed');
    expect(completed).toMatchObject({ chat_id: 'DAYCHAT002', thread_id: 'CONN000001' });
  });

  it("binds nothing from a param that is not shaped like one of our ids, and nothing before there's a principal", async () => {
    const sink = new Sink();
    app = await server(sink, null);
    app.get('/customers/:customerId', async (request) => {
      request.log.info('anonymous');
      return { ok: true };
    });

    await app.inject({ method: 'GET', url: `/customers/${encodeURIComponent('a b"c')}` });
    await app.inject({ method: 'GET', url: '/customers/CUST000001' });

    const [weird, fine] = sink.lines().filter((line) => line['msg'] === 'anonymous');
    expect(weird).not.toHaveProperty('customer_id');
    expect(weird).not.toHaveProperty('license_id');
    expect(fine).toMatchObject({ customer_id: 'CUST000001' });
    expect(fine).not.toHaveProperty('license_id');
  });
});
