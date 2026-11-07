/**
 * A validation 400 lists at most twenty issues (tm 419).
 *
 * zod 3 makes one issue per bad element, and `zodToApiError` used to put every
 * one into `details.fields`: a 500k-element body answered with 72 MB. The list
 * is now the first `VALIDATION_FIELDS_MAX`, with `fields_truncated` and
 * `fields_total` saying what was left out, and each message is clipped — the
 * one long zod message (`.strict()`'s list of unknown keys) is not echoed back.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  validationFields,
  VALIDATION_FIELDS_MAX,
  VALIDATION_MESSAGE_MAX,
} from '../lib/api-error.js';
import errorHandler from './error-handler.js';

interface ValidationBody {
  error: {
    type: string;
    message: string;
    details?: {
      fields: Array<{ field: string; message: string }>;
      fields_truncated?: boolean;
      fields_total?: number;
    };
  };
}

describe('error handler — validation issues (tm 419)', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function serve(schema: z.ZodTypeAny): Promise<FastifyInstance> {
    app = Fastify({ logger: false });
    await app.register(errorHandler);
    app.post('/check', async (request) => schema.parse(request.body));
    await app.ready();
    return app;
  }

  it('lists 20 of 100 issues and says how many there were', async () => {
    const server = await serve(z.array(z.string()));
    const response = await server.inject({
      method: 'POST',
      url: '/check',
      payload: Array(100).fill(1),
    });

    expect(response.statusCode).toBe(400);
    const { error } = response.json<ValidationBody>();
    expect(error.type).toBe('validation');
    expect(error.details?.fields).toHaveLength(VALIDATION_FIELDS_MAX);
    expect(error.details?.fields[0]).toEqual({
      field: '0',
      message: 'Expected string, received number',
    });
    expect(error.details?.fields_truncated).toBe(true);
    expect(error.details?.fields_total).toBe(100);
    expect(error.message).toBe('0: Expected string, received number');
  });

  it('lists every issue, with no truncation flag, at twenty or fewer', async () => {
    const server = await serve(z.array(z.string()));
    const response = await server.inject({
      method: 'POST',
      url: '/check',
      payload: Array(VALIDATION_FIELDS_MAX).fill(1),
    });

    const { error } = response.json<ValidationBody>();
    expect(error.details?.fields).toHaveLength(VALIDATION_FIELDS_MAX);
    expect(error.details).not.toHaveProperty('fields_truncated');
    expect(error.details).not.toHaveProperty('fields_total');
  });

  it('names the value itself (root) as `(root)`', async () => {
    const server = await serve(z.object({ a: z.string() }));
    const response = await server.inject({ method: 'POST', url: '/check', payload: [1] });

    expect(response.json<ValidationBody>().error.details?.fields[0]?.field).toBe('(root)');
  });

  it("clips `.strict()`'s message about 50k unknown keys instead of echoing them", async () => {
    const server = await serve(z.object({}).strict());
    const keys = Object.fromEntries(Array.from({ length: 50_000 }, (_, i) => [`key${i}`, 1]));
    const response = await server.inject({ method: 'POST', url: '/check', payload: keys });

    expect(response.statusCode).toBe(400);
    const { error } = response.json<ValidationBody>();
    expect(error.details?.fields[0]?.message.length).toBeLessThanOrEqual(VALIDATION_MESSAGE_MAX);
    expect(error.message.length).toBeLessThan(VALIDATION_MESSAGE_MAX + 20);
    expect(response.body.length).toBeLessThan(2_000);
  });
});

describe('validationFields', () => {
  it('keeps the dotted path and the root label the caller names', () => {
    expect(
      validationFields(
        [
          { path: ['a', 0, 'b'], message: 'bad' },
          { path: [], message: 'root' },
        ],
        'body',
      ),
    ).toEqual({
      fields: [
        { field: 'a.0.b', message: 'bad' },
        { field: 'body', message: 'root' },
      ],
    });
  });

  it('never cuts a message inside a surrogate pair', () => {
    const message = `${'x'.repeat(VALIDATION_MESSAGE_MAX - 2)}😀😀😀`;
    const [field] = validationFields([{ path: ['f'], message }])['fields'] as Array<{
      message: string;
    }>;

    expect(field?.message.endsWith('…')).toBe(true);
    expect(field?.message.length).toBeLessThanOrEqual(VALIDATION_MESSAGE_MAX);
    expect(field?.message).not.toMatch(/[\uD800-\uDBFF]…$/);
  });
});
