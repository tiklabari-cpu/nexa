/**
 * A stand-in for Anthropic's Messages API (tm 479), on a real socket.
 *
 * The Claude adapter talks through the official SDK, so the part worth
 * testing is what the SDK actually puts on the wire and how it reads what
 * comes back — which an injected `fetch` would skip. This starts an HTTP
 * server on 127.0.0.1 (no request leaves the machine, no key exists — the
 * tests' key is a label the redaction checks look for) and answers from a
 * queue. Shapes follow the documented ones: a `message` with `content` blocks,
 * `stop_reason`, `stop_details`, `usage` (with `inference_geo` and, when a
 * fallback ran, `iterations`), and errors of `{ type: 'error', error: { type,
 * message } }` with a `request-id` header.
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export interface FakeAnthropicReply {
  status: number;
  /** JSON-encoded unless `raw` is given. */
  body?: unknown;
  raw?: string;
  headers?: Record<string, string>;
  /** Hold the answer this long — a slow or hanging provider. */
  delayMs?: number;
}

export interface FakeAnthropicRequest {
  method: string;
  /** Path and query, e.g. `/v1/messages?beta=true`. */
  path: string;
  headers: IncomingHttpHeaders;
  /** The parsed JSON body. */
  body: Record<string, unknown>;
  /** The body as it arrived. */
  text: string;
}

export interface FakeAnthropic {
  /** The base URL to hand the adapter (`http://127.0.0.1:<port>`). */
  url: string;
  /** Every request, in order. */
  requests: FakeAnthropicRequest[];
  /** Answers for the next requests, in order; the last one repeats. */
  reply(...replies: FakeAnthropicReply[]): void;
  close(): Promise<void>;
}

export async function startFakeAnthropic(): Promise<FakeAnthropic> {
  const requests: FakeAnthropicRequest[] = [];
  let replies: FakeAnthropicReply[] = [anthropicMessage('OK')];
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
          'request-id': 'req_011CTest',
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

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  inference_geo?: string | null;
  iterations?: Array<Record<string, unknown>> | null;
}

export const DEFAULT_USAGE: AnthropicUsage = {
  input_tokens: 120,
  output_tokens: 30,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  inference_geo: 'us',
};

/**
 * A `message`. `content` is the text of one block, or the blocks themselves;
 * `extra` overrides fields of the body (`stop_reason`, `model`, `usage`…).
 */
export function anthropicMessage(
  content: string | Array<Record<string, unknown>>,
  extra: Record<string, unknown> = {},
): FakeAnthropicReply {
  return {
    status: 200,
    body: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: typeof content === 'string' ? [{ type: 'text', text: content }] : content,
      stop_reason: 'end_turn',
      stop_sequence: null,
      stop_details: null,
      usage: DEFAULT_USAGE,
      ...extra,
    },
  };
}

/**
 * An error answer. Its message quotes the key and the prompt, the way a real
 * provider message could, so every test built on it is also a test that the
 * message goes nowhere.
 */
export function anthropicError(
  status: number,
  type: string,
  options: { headers?: Record<string, string>; message?: string } = {},
): FakeAnthropicReply {
  return {
    status,
    headers: options.headers,
    body: {
      type: 'error',
      error: { type, message: options.message ?? `${type} for this request` },
      request_id: 'req_011CTest',
    },
  };
}
