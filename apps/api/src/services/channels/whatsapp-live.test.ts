/**
 * The live WhatsApp client's pure halves (tm 380 · KN-01): the webhook's
 * signature, the subscription handshake, Meta's payloads read into messages and
 * statuses, and Graph's answers mapped to what the channel does with them. The
 * HTTP side runs against a recording stand-in for the safe client; the
 * integration suite (`test/integration/whatsapp-live.test.ts`) runs the whole
 * server against a local HTTPS Graph.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SafeHttp, SafeRequest, SafeResponse } from '../../lib/safe-fetch.js';
import { DEFAULT_PROVIDER_ENDPOINTS } from '../apps/verifiers/types.js';
import {
  GRAPH_INVALID_TOKEN,
  WhatsAppGraphError,
  WhatsAppLive,
  createLiveWhatsApp,
  parseWhatsAppWebhook,
  whatsAppConnectError,
} from './whatsapp-live.js';

const APP_SECRET = 'test-app-secret-1f4c8e2a';
const CONFIG = {
  appId: '1234567890',
  appSecret: APP_SECRET,
  verifyToken: 'verify-me-7d1b',
  configId: '998877',
  graphVersion: 'v21.0',
};

function sign(body: string | Buffer, secret = APP_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/** A safe client that answers from a table and records every request. */
function recordingHttp(answers: Array<Partial<SafeResponse> & { match: RegExp }>) {
  const calls: SafeRequest[] = [];
  const http: SafeHttp = {
    async request(request) {
      calls.push(request);
      const answer = answers.find((candidate) => candidate.match.test(request.url));
      if (!answer) throw new Error(`unexpected ${request.url}`);
      const json = answer.json;
      const text = answer.text ?? (json === undefined ? '' : JSON.stringify(json));
      return { status: answer.status ?? 200, json, text, bytes: answer.bytes ?? Buffer.from(text) };
    },
  };
  return { http, calls };
}

function live(http: SafeHttp): WhatsAppLive {
  return new WhatsAppLive(
    { http, endpoints: { ...DEFAULT_PROVIDER_ENDPOINTS, whatsapp: 'https://graph.example.test' } },
    CONFIG,
    'https://app.siyahtus.test/',
  );
}

/** Meta's documented sample shapes (developers.facebook.com/docs/whatsapp/cloud-api/webhooks). */
/** The webhook's outer shape, loose enough to add entries of other kinds. */
interface WebhookBody {
  object: string;
  entry: Array<{ id: string; changes: Array<{ field: string; value: Record<string, unknown> }> }>;
}

function webhook(value: Record<string, unknown>, phoneNumberId = '106540352242922'): WebhookBody {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550783881', phone_number_id: phoneNumberId },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

const CONTACTS = [{ profile: { name: 'Ada Kaya' }, wa_id: '905321112233' }];

describe('the webhook signature (X-Hub-Signature-256)', () => {
  const client = live(recordingHttp([]).http);
  const body = Buffer.from(JSON.stringify(webhook({ messages: [] })));

  it('accepts the HMAC-SHA256 of the raw body under the app secret', () => {
    expect(client.signatureMatches(body, sign(body))).toBe(true);
    expect(
      client.signatureMatches(body, sign(body).toUpperCase().replace('SHA256=', 'sha256=')),
    ).toBe(true);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['without the sha256= prefix', sign(body).slice('sha256='.length)],
    ['sha1 instead of sha256', `sha1=${createHmac('sha1', APP_SECRET).update(body).digest('hex')}`],
    ['under another secret', sign(body, 'someone-else')],
    ['truncated', sign(body).slice(0, 40)],
    ['not hex', `sha256=${'z'.repeat(64)}`],
  ])('refuses a signature that is %s', (_label, header) => {
    expect(client.signatureMatches(body, header)).toBe(false);
  });

  it('refuses a body changed after signing — even by one byte, even re-serialised alike', () => {
    const header = sign(body);
    const tampered = Buffer.from(body.toString('utf8').replace('"messages":[]', '"messages":[ ]'));
    expect(client.signatureMatches(tampered, header)).toBe(false);
  });
});

describe('the subscription handshake', () => {
  const client = live(recordingHttp([]).http);

  it('echoes the challenge for subscribe with the verify token', () => {
    expect(client.verifySubscription('subscribe', CONFIG.verifyToken, '1158201444')).toBe(
      '1158201444',
    );
  });

  it.each([
    ['another token', 'subscribe', 'wrong', '1'],
    ['no token', 'subscribe', undefined, '1'],
    ['another mode', 'unsubscribe', CONFIG.verifyToken, '1'],
    ['no challenge', 'subscribe', CONFIG.verifyToken, undefined],
    ['a challenge that is markup', 'subscribe', CONFIG.verifyToken, '<script>alert(1)</script>'],
  ])('answers nothing for %s', (_label, mode, token, challenge) => {
    expect(client.verifySubscription(mode, token, challenge)).toBeNull();
  });
});

describe('Meta payloads (FR-MOD-08.5.6)', () => {
  it('reads a text message with the sender name from contacts', () => {
    const [batch] = parseWhatsAppWebhook(
      webhook({
        contacts: CONTACTS,
        messages: [
          {
            from: '905321112233',
            id: 'wamid.HBgLOTA1MzIxMTEyMjMzFQIAEhggQTRBQjY4',
            timestamp: '1730450000',
            type: 'text',
            text: { body: 'Para yatırma işlemim görünmüyor' },
          },
        ],
      }),
    );
    expect(batch).toEqual({
      phoneNumberId: '106540352242922',
      statuses: [],
      messages: [
        {
          wamid: 'wamid.HBgLOTA1MzIxMTEyMjMzFQIAEhggQTRBQjY4',
          from: '905321112233',
          profileName: 'Ada Kaya',
          at: new Date(1730450000 * 1000).toISOString(),
          type: 'text',
          text: 'Para yatırma işlemim görünmüyor',
          media: null,
        },
      ],
    });
  });

  it('reads an image with its caption, a document with its name, and interactive replies', () => {
    const [batch] = parseWhatsAppWebhook(
      webhook({
        contacts: CONTACTS,
        messages: [
          {
            from: '905321112233',
            id: 'wamid.img',
            timestamp: '1730450001',
            type: 'image',
            image: {
              id: '1479537139650973',
              mime_type: 'image/jpeg',
              sha256: 'x',
              caption: 'dekont',
            },
          },
          {
            from: '905321112233',
            id: 'wamid.doc',
            timestamp: '1730450002',
            type: 'document',
            document: { id: '22', mime_type: 'application/pdf', filename: 'ekstre.pdf' },
          },
          {
            from: '905321112233',
            id: 'wamid.btn',
            timestamp: '1730450003',
            type: 'interactive',
            interactive: { type: 'button_reply', button_reply: { id: 'yes', title: 'Evet' } },
          },
          {
            from: '905321112233',
            id: 'wamid.loc',
            timestamp: '1730450004',
            type: 'location',
            location: { latitude: 41.0, longitude: 29.0 },
          },
          {
            from: '905321112233',
            id: 'wamid.react',
            timestamp: '1730450005',
            type: 'reaction',
            reaction: { message_id: 'wamid.x', emoji: '👍' },
          },
        ],
      }),
    );
    expect(batch!.messages.map((m) => [m.wamid, m.text, m.media])).toEqual([
      ['wamid.img', 'dekont', { id: '1479537139650973', mime: 'image/jpeg', filename: null }],
      ['wamid.doc', '', { id: '22', mime: 'application/pdf', filename: 'ekstre.pdf' }],
      ['wamid.btn', 'Evet', null],
      // Said in the inbox rather than lost; a reaction is dropped.
      ['wamid.loc', '[WhatsApp location message]', null],
    ]);
  });

  it('reads statuses, with the error code of a failed one, and skips unknown statuses', () => {
    const [batch] = parseWhatsAppWebhook(
      webhook({
        statuses: [
          {
            id: 'wamid.out1',
            status: 'delivered',
            timestamp: '1730450100',
            recipient_id: '905321112233',
          },
          {
            id: 'wamid.out2',
            status: 'failed',
            timestamp: '1730450101',
            recipient_id: '905321112233',
            errors: [{ code: 131047, title: 'Re-engagement message' }],
          },
          { id: 'wamid.out3', status: 'deleted', timestamp: '1730450102', recipient_id: '9' },
        ],
      }),
    );
    expect(batch!.statuses).toEqual([
      {
        wamid: 'wamid.out1',
        status: 'delivered',
        at: new Date(1730450100 * 1000).toISOString(),
        recipient: '905321112233',
        errorCode: null,
      },
      {
        wamid: 'wamid.out2',
        status: 'failed',
        at: new Date(1730450101 * 1000).toISOString(),
        recipient: '905321112233',
        errorCode: 131047,
      },
    ]);
  });

  it('groups changes by business number and skips an item that does not read', () => {
    const body = webhook({
      messages: [
        {
          from: 'not-a-number',
          id: 'wamid.bad',
          timestamp: '1',
          type: 'text',
          text: { body: 'x' },
        },
      ],
    });
    body.entry.push({
      id: '2',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '1', phone_number_id: '200' },
            messages: [
              {
                from: '905000000000',
                id: 'wamid.ok',
                timestamp: '2',
                type: 'text',
                text: { body: 'hi' },
              },
            ],
          },
        },
        { field: 'account_update', value: { ban_info: {} } },
      ],
    });
    const batches = parseWhatsAppWebhook(body);
    expect(batches.map((b) => [b.phoneNumberId, b.messages.map((m) => m.wamid)])).toEqual([
      ['106540352242922', []],
      ['200', ['wamid.ok']],
    ]);
  });

  it('refuses a body that is not a WhatsApp Business webhook (400)', () => {
    expect(() => parseWhatsAppWebhook({ object: 'page', entry: [] })).toThrow(
      expect.objectContaining({ status: 400 }),
    );
    expect(() => parseWhatsAppWebhook('nope')).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe('the Graph client', () => {
  it('exchanges the signup code with the app secret, redirect and code, and never echoes them', async () => {
    const { http, calls } = recordingHttp([
      {
        match: /oauth\/access_token/,
        json: { access_token: 'EAAG-business-token', token_type: 'bearer' },
      },
    ]);
    await expect(live(http).exchangeCode('code-abc')).resolves.toBe('EAAG-business-token');
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe('https://graph.example.test/v21.0/oauth/access_token');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CONFIG.appId,
      client_secret: APP_SECRET,
      redirect_uri: 'https://app.siyahtus.test/channels/whatsapp/callback',
      code: 'code-abc',
    });
  });

  it('maps a refused code to a 400 whose text carries neither the secret nor the code', async () => {
    const { http } = recordingHttp([
      {
        match: /oauth\/access_token/,
        status: 400,
        json: { error: { message: `Invalid code code-abc for secret ${APP_SECRET}`, code: 100 } },
      },
    ]);
    const error = await live(http)
      .exchangeCode('code-abc')
      .catch((caught: unknown) => caught);
    const mapped = whatsAppConnectError(error);
    expect(mapped.status).toBe(400);
    expect(mapped.details).toMatchObject({ reason: 'app_credentials_invalid', provider_code: 100 });
    expect(JSON.stringify(mapped.details)).not.toContain(APP_SECRET);
  });

  it('sends free text to /{phone_number_id}/messages with the token as a bearer, split at 4096', async () => {
    const { http, calls } = recordingHttp([
      { match: /\/messages$/, json: { messages: [{ id: 'wamid.sent' }] } },
    ]);
    const id = await live(http).sendText(
      'EAAG-token',
      '106540352242922',
      '905321112233',
      'a'.repeat(5000),
    );
    expect(id).toBe('wamid.sent');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://graph.example.test/v21.0/106540352242922/messages',
      headers: { authorization: 'Bearer EAAG-token' },
      json: {
        messaging_product: 'whatsapp',
        to: '905321112233',
        type: 'text',
        text: { preview_url: false, body: 'a'.repeat(4096) },
      },
    });
  });

  it('reads Graph error 190 as a token Meta no longer accepts', async () => {
    const { http } = recordingHttp([
      {
        match: /\/messages$/,
        status: 401,
        json: { error: { message: 'Error validating access token', code: GRAPH_INVALID_TOKEN } },
      },
    ]);
    const error = await live(http)
      .sendText('EAAG-token', '1', '9', 'hi')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WhatsAppGraphError);
    expect((error as WhatsAppGraphError).tokenInvalid).toBe(true);
  });

  it('fetches media only from a Meta host and only within the size given', async () => {
    const { http, calls } = recordingHttp([
      {
        match: /\/v21\.0\/media-1$/,
        json: { url: 'https://evil.example/x', mime_type: 'image/png', file_size: 10 },
      },
      {
        match: /\/v21\.0\/media-2$/,
        json: { url: 'https://lookaside.fbsbx.com/x', file_size: 5000 },
      },
      {
        match: /\/v21\.0\/media-3$/,
        json: { url: 'https://lookaside.fbsbx.com/y', mime_type: 'image/png', file_size: 4 },
      },
      { match: /lookaside\.fbsbx\.com\/y$/, bytes: Buffer.from([1, 2, 3, 4]) },
    ]);
    const client = live(http);
    await expect(client.fetchMedia('t', 'media-1', 100)).rejects.toBeInstanceOf(WhatsAppGraphError);
    await expect(client.fetchMedia('t', 'media-2', 100)).resolves.toEqual({ tooLarge: true });
    const fetched = await client.fetchMedia('t', 'media-3', 100);
    expect(fetched).toEqual({ bytes: Buffer.from([1, 2, 3, 4]), mime: 'image/png' });
    expect(calls.at(-1)).toMatchObject({ maxBytes: 100, headers: { authorization: 'Bearer t' } });
    expect(calls.some((call) => call.url.startsWith('https://evil.example'))).toBe(false);
  });
});

describe('createLiveWhatsApp', () => {
  const base = {
    APPS_LIVE_PROVIDERS: ['whatsapp'],
    APPS_CREDENTIAL_KEY: 'ab'.repeat(32),
    WHATSAPP_APP_ID: '1',
    WHATSAPP_APP_SECRET: 's',
    WHATSAPP_VERIFY_TOKEN: 'v',
    WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: 'c',
    WHATSAPP_GRAPH_VERSION: 'v21.0',
    WEB_APP_URL: 'https://app.test',
  };
  const context = { http: recordingHttp([]).http, endpoints: DEFAULT_PROVIDER_ENDPOINTS };

  it('runs live with the switch, the key and the four Meta values', () => {
    expect(createLiveWhatsApp(base, context)?.live.signupConfig()).toEqual({
      app_id: '1',
      config_id: 'c',
      graph_version: 'v21.0',
      redirect_uri: 'https://app.test/channels/whatsapp/callback',
    });
  });

  it.each([
    ['the switch', { APPS_LIVE_PROVIDERS: [] }],
    ['the credential key', { APPS_CREDENTIAL_KEY: undefined }],
    ['the app secret', { WHATSAPP_APP_SECRET: undefined }],
    ['the verify token', { WHATSAPP_VERIFY_TOKEN: undefined }],
  ])('stays the mock without %s', (_label, override) => {
    expect(createLiveWhatsApp({ ...base, ...override }, context)).toBeNull();
  });
});
