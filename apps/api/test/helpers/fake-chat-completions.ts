/**
 * A stand-in for an OpenAI-shaped `chat/completions` API (tm 480 — DeepSeek,
 * Kimi), on a real socket.
 *
 * The adapters are tested through the real `fetch`, so what is pinned is what
 * actually goes on the wire and how a real body is read — blank keep-alive
 * lines, a `Retry-After` header, a refused redirect. The server listens on
 * 127.0.0.1: no request leaves the machine and no key exists (the tests' key
 * is a label the redaction checks look for). Answers come from a queue whose
 * last entry repeats. Shapes follow the vendors' documented ones: a completion
 * with `choices[0].message.{content, reasoning_content}`, `finish_reason` and
 * `usage`; an error of `{ error: { message, type, code } }`.
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export interface FakeChatReply {
  status: number;
  /** JSON-encoded unless `raw` is given. */
  body?: unknown;
  raw?: string;
  headers?: Record<string, string>;
  /** Hold the answer this long — a slow or hanging provider. */
  delayMs?: number;
}

export interface FakeChatRequest {
  method: string;
  /** Path and query, e.g. `/v1/chat/completions`. */
  path: string;
  headers: IncomingHttpHeaders;
  /** The parsed JSON body. */
  body: Record<string, unknown>;
  /** The body as it arrived. */
  text: string;
}

export interface FakeChatCompletions {
  /** The server's origin (`http://127.0.0.1:<port>`); append the vendor's base path. */
  url: string;
  /** Every request, in order. */
  requests: FakeChatRequest[];
  /** Answers for the next requests, in order; the last one repeats. */
  reply(...replies: FakeChatReply[]): void;
  close(): Promise<void>;
}

export async function startFakeChatCompletions(): Promise<FakeChatCompletions> {
  const requests: FakeChatRequest[] = [];
  let replies: FakeChatReply[] = [chatCompletion('OK')];
  const sockets = new Set<Socket>();

  const server: Server = createServer((req, res) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (text += chunk));
    req.on('end', () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // Left empty: a test that cares reads `text`.
      }
      requests.push({
        method: req.method ?? '',
        path: req.url ?? '',
        headers: req.headers,
        body,
        text,
      });
      const reply = replies[Math.min(requests.length, replies.length) - 1]!;
      const send = () => {
        if (res.destroyed) return;
        const payload = reply.raw ?? (reply.body === undefined ? '' : JSON.stringify(reply.body));
        res.writeHead(reply.status, {
          'content-type': 'application/json',
          'x-request-id': 'req-test-0001',
          ...reply.headers,
        });
        res.end(payload);
      };
      if (reply.delayMs) setTimeout(send, reply.delayMs).unref();
      else send();
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    reply(...next) {
      if (next.length === 0) throw new Error('reply() needs at least one answer');
      replies = next;
    },
    close() {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

export const DEFAULT_CHAT_USAGE = { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 };

/**
 * A completion. `extra.message` adds fields to `choices[0].message`
 * (`reasoning_content`…), `extra.finish_reason` and `extra.usage` replace
 * theirs.
 */
export function chatCompletion(
  content: string | null,
  extra: {
    finish_reason?: string;
    usage?: Record<string, unknown>;
    message?: Record<string, unknown>;
  } = {},
): FakeChatReply {
  return {
    status: 200,
    body: {
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1_763_000_000,
      model: 'test-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content, ...extra.message },
          finish_reason: extra.finish_reason ?? 'stop',
        },
      ],
      usage: extra.usage ?? DEFAULT_CHAT_USAGE,
    },
  };
}

/**
 * An error answer. Its message quotes the key and the prompt, the way a real
 * provider message could, so every test built on it is also a test that the
 * message goes nowhere.
 */
export function chatError(
  status: number,
  error: { type?: string; code?: string; message?: string } = {},
  headers: Record<string, string> = {},
): FakeChatReply {
  return {
    status,
    headers,
    body: { error: { message: error.message ?? 'refused', type: error.type, code: error.code } },
  };
}
