/**
 * OpenAI's chat endpoint, as far as the adapter can tell (tm 255.6).
 *
 * The adapter takes its `fetch` as an argument (`OpenAiLlmProvider`'s
 * `fetchImpl`, `buildServer`'s `llmFetch`), so a test hands it one of these and
 * no request leaves the process. Each handler builds a fresh `Response` —
 * a body can be read only once — and the shapes follow OpenAI's documented
 * ones: `choices[].message`, `finish_reason`, `usage`, and error bodies of
 * `{ error: { message, type, param, code } }`.
 */

export type OpenAiHandler = (init: RequestInit) => Response | Promise<Response>;

export interface FakeOpenAiFetch {
  impl: typeof fetch;
  /** Every request, in order — `calls.length` is how many reached "the provider". */
  calls: Array<{ url: string; init: RequestInit }>;
}

/** Answers from `handlers` in order; the last one repeats. */
export function fakeOpenAiFetch(...handlers: OpenAiHandler[]): FakeOpenAiFetch {
  const calls: FakeOpenAiFetch['calls'] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const handler = handlers[Math.min(calls.length, handlers.length) - 1];
    if (!handler) throw new Error('fakeOpenAiFetch was given no handler');
    return handler(init ?? {});
  }) as typeof fetch;
  return { impl, calls };
}

export function openAiJson(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): OpenAiHandler {
  return () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'x-request-id': 'req_abc123', ...headers },
    });
}

/** A chat completion. `choice` and `extra` override fields of the first choice and of the body. */
export function openAiCompletion(
  content: string | null,
  choice: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): OpenAiHandler {
  return openAiJson(200, {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    model: 'test-model',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content, refusal: null },
        finish_reason: 'stop',
        ...choice,
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 12, total_tokens: 132 },
    ...extra,
  });
}

/** An error response in OpenAI's shape. */
export function openAiProblem(
  status: number,
  code: string | null,
  options: { type?: string | null; message?: string; headers?: Record<string, string> } = {},
): OpenAiHandler {
  return openAiJson(
    status,
    {
      error: {
        message: options.message ?? `Error ${status}`,
        type: options.type ?? null,
        param: null,
        code,
      },
    },
    options.headers ?? {},
  );
}

/** Never answers; rejects when the request is aborted, the way `fetch` does. */
export const hangingRequest: OpenAiHandler = (init) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () =>
      reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })),
    );
  });

/** `fetch`'s own shape for a dead connection: `TypeError: fetch failed`, the socket error as `cause`. */
export function refusedConnection(code: string): OpenAiHandler {
  return () => {
    throw new TypeError('fetch failed', {
      cause: Object.assign(new Error(`connect ${code} 10.0.0.1:443`), { code }),
    });
  };
}
