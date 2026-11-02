/**
 * The live Messenger / Instagram client's pure halves (tm 381 · KN-02) and
 * the Graph pieces every Meta channel shares (`meta-graph.ts`): the webhook's
 * signature, the subscription handshake, Meta's `object: page` and
 * `object: instagram` payloads read into messages, and Graph's answers. The
 * HTTP side runs against a recording stand-in for the safe client; the
 * integration suite (`test/integration/meta-messaging-live.test.ts`) runs the
 * whole server against a local HTTPS Graph.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SafeHttp, SafeRequest, SafeResponse } from '../../lib/safe-fetch.js';
import { DEFAULT_PROVIDER_ENDPOINTS } from '../apps/verifiers/types.js';
import {
  MetaGraphError,
  MetaGraphUnreachableError,
  metaSignatureMatches,
  verifyMetaSubscription,
} from './meta-graph.js';
import {
  META_TEXT_MAX,
  MetaMessagingLive,
  createLiveMetaMessaging,
  metaConnectError,
  parseMetaMessagingWebhook,
} from './meta-messaging-live.js';
import { WhatsAppGraphError } from './whatsapp-live.js';

const APP_SECRET = 'meta-unit-app-secret-3c9a';
const CONFIG = {
  appId: '2233445566',
  appSecret: APP_SECRET,
  verifyToken: 'verify-me-8e2f',
  graphVersion: 'v21.0',
};

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

function live(
  http: SafeHttp,
  channels: Array<'messenger' | 'instagram'> = ['messenger', 'instagram'],
) {
  return new MetaMessagingLive(
    { http, endpoints: { ...DEFAULT_PROVIDER_ENDPOINTS, whatsapp: 'https://graph.example.test' } },
    CONFIG,
    'https://app.siyahtus.test/',
    channels,
  );
}

const PAGE = '104771234567001';
const IG = '17841400000000001';
const PSID = '6789012345678901';

describe('the shared Meta webhook check (meta-graph.ts)', () => {
  const body = Buffer.from(JSON.stringify({ object: 'page', entry: [] }));
  const good = `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;

  it('accepts the app secret’s HMAC of the raw bytes, and nothing else', () => {
    expect(metaSignatureMatches(APP_SECRET, body, good)).toBe(true);
    expect(
      metaSignatureMatches(APP_SECRET, body, good.toUpperCase().replace('SHA256=', 'sha256=')),
    ).toBe(true);
    expect(metaSignatureMatches(APP_SECRET, body, undefined)).toBe(false);
    expect(metaSignatureMatches(APP_SECRET, body, good.replace('sha256=', 'sha1='))).toBe(false);
    expect(metaSignatureMatches('another-secret', body, good)).toBe(false);
    expect(metaSignatureMatches(APP_SECRET, Buffer.concat([body, Buffer.from(' ')]), good)).toBe(
      false,
    );
    expect(metaSignatureMatches(APP_SECRET, body, 'sha256=xyz')).toBe(false);
  });

  it('echoes the challenge only for the verify token, and only a plain one', () => {
    expect(verifyMetaSubscription('tok', 'subscribe', 'tok', '12345')).toBe('12345');
    expect(verifyMetaSubscription('tok', 'subscribe', 'nope', '12345')).toBeNull();
    expect(verifyMetaSubscription('tok', 'unsubscribe', 'tok', '12345')).toBeNull();
    expect(verifyMetaSubscription('tok', 'subscribe', 'tok', '<script>')).toBeNull();
    expect(verifyMetaSubscription('tok', 'subscribe', undefined, '1')).toBeNull();
  });

  it('reads the window and the token out of Graph’s codes, for every Meta channel', () => {
    expect(new MetaGraphError(400, 190, undefined).tokenInvalid).toBe(true);
    expect(new MetaGraphError(400, 131047, undefined).windowClosed).toBe(true);
    expect(new MetaGraphError(400, 10, undefined, 2018278).windowClosed).toBe(true);
    expect(new MetaGraphError(400, 10, undefined, 2534022).windowClosed).toBe(true);
    expect(new MetaGraphError(400, 10, undefined, 2018001).windowClosed).toBe(false);
    // WhatsApp's error is the shared one now (tm 381), so one instanceof covers both.
    expect(new MetaGraphError(400, 1, undefined)).toBeInstanceOf(WhatsAppGraphError);
  });
});

describe('parseMetaMessagingWebhook (tm 381 · FR-MOD-08.5.4 · FR-MOD-08.5.7)', () => {
  it('reads a Messenger text message: recipient page, sender PSID, mid, time', () => {
    const at = Date.UTC(2026, 10, 2, 10, 0, 0);
    expect(
      parseMetaMessagingWebhook({
        object: 'page',
        entry: [
          {
            id: PAGE,
            time: at,
            messaging: [
              {
                sender: { id: PSID },
                recipient: { id: PAGE },
                timestamp: at,
                message: { mid: 'm_1', text: ' Merhaba ' },
              },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        channel: 'messenger',
        address: PAGE,
        senderId: PSID,
        mid: 'm_1',
        at: new Date(at).toISOString(),
        text: 'Merhaba',
      },
    ]);
  });

  it('reads Instagram the same way, under its account id', () => {
    const [message] = parseMetaMessagingWebhook({
      object: 'instagram',
      entry: [
        {
          id: IG,
          messaging: [
            {
              sender: { id: '42' },
              recipient: { id: IG },
              timestamp: 1,
              message: { mid: 'aWdf', text: 'selam' },
            },
          ],
        },
      ],
    });
    expect(message).toMatchObject({
      channel: 'instagram',
      address: IG,
      senderId: '42',
      mid: 'aWdf',
    });
  });

  it('drops echoes, deleted messages, receipts and reactions', () => {
    expect(
      parseMetaMessagingWebhook({
        object: 'page',
        entry: [
          {
            id: PAGE,
            messaging: [
              {
                sender: { id: PAGE },
                recipient: { id: PSID },
                timestamp: 1,
                message: { mid: 'e', text: 'x', is_echo: true },
              },
              {
                sender: { id: PSID },
                recipient: { id: PAGE },
                timestamp: 1,
                message: { mid: 'd', is_deleted: true },
              },
              {
                sender: { id: PSID },
                recipient: { id: PAGE },
                timestamp: 1,
                delivery: { mids: ['e'] },
              },
              {
                sender: { id: PSID },
                recipient: { id: PAGE },
                timestamp: 1,
                read: { watermark: 1 },
              },
              {
                sender: { id: PSID },
                recipient: { id: PAGE },
                timestamp: 1,
                reaction: { mid: 'e', action: 'react' },
              },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  it('says story replies, story mentions and attachments as plain text, never their file address', () => {
    const texts = parseMetaMessagingWebhook({
      object: 'instagram',
      entry: [
        {
          id: IG,
          messaging: [
            {
              sender: { id: '42' },
              recipient: { id: IG },
              timestamp: 1,
              message: { mid: 'a', reply_to: { story: { id: 's', url: 'https://lookaside/x' } } },
            },
            {
              sender: { id: '42' },
              recipient: { id: IG },
              timestamp: 2,
              message: {
                mid: 'b',
                attachments: [{ type: 'story_mention', payload: { url: 'https://lookaside/y' } }],
              },
            },
            {
              sender: { id: '42' },
              recipient: { id: IG },
              timestamp: 3,
              message: {
                mid: 'c',
                text: 'dekont',
                attachments: [{ type: 'image', payload: { url: 'https://cdn/z' } }],
              },
            },
            {
              sender: { id: '42' },
              recipient: { id: IG },
              timestamp: 4,
              message: { mid: 'd', is_unsupported: true },
            },
          ],
        },
      ],
    }).map((message) => message.text);
    expect(texts).toEqual([
      '[Story reply] [Instagram message]',
      '[Instagram story mention]',
      'dekont [Instagram image]',
      '[Instagram message]',
    ]);
    expect(texts.join(' ')).not.toMatch(/lookaside|cdn/);
  });

  it('takes a postback as its title, keyed by its mid or, without one, by sender and time', () => {
    const [withMid, withoutMid] = parseMetaMessagingWebhook({
      object: 'page',
      entry: [
        {
          id: PAGE,
          messaging: [
            {
              sender: { id: PSID },
              recipient: { id: PAGE },
              timestamp: 5,
              postback: { mid: 'm_pb', title: 'Destek', payload: 'HUMAN' },
            },
            {
              sender: { id: PSID },
              recipient: { id: PAGE },
              timestamp: 6,
              postback: { payload: 'BONUS' },
            },
          ],
        },
      ],
    });
    expect(withMid).toMatchObject({ mid: 'm_pb', text: 'Destek' });
    expect(withoutMid).toMatchObject({ mid: `postback.${PSID}.6`, text: 'BONUS' });
  });

  it('refuses a body that is not a Messenger / Instagram webhook, and skips one odd item', () => {
    expect(() =>
      parseMetaMessagingWebhook({ object: 'whatsapp_business_account', entry: [] }),
    ).toThrow();
    expect(() => parseMetaMessagingWebhook('nope')).toThrow();
    expect(
      parseMetaMessagingWebhook({
        object: 'page',
        entry: [
          {
            id: PAGE,
            messaging: [
              {
                sender: {},
                recipient: { id: PAGE },
                timestamp: 1,
                message: { mid: 'x', text: 'a' },
              },
              {
                sender: { id: PSID },
                recipient: { id: PAGE },
                timestamp: 1,
                message: { mid: 'y', text: 'b' },
              },
            ],
          },
        ],
      }).map((message) => message.mid),
    ).toEqual(['y']);
  });
});

describe('MetaMessagingLive Graph calls (tm 381)', () => {
  it('turns a login code into a long-lived user token, the app secret never in an error', async () => {
    const { http, calls } = recordingHttp([
      { match: /grant_type=fb_exchange_token/, json: { access_token: 'long-token' } },
      { match: /oauth\/access_token\?client_id/, json: { access_token: 'short-token' } },
    ]);
    expect(await live(http).userTokenFromCode('the-code')).toBe('long-token');
    expect(calls[0]!.url).toContain(
      'redirect_uri=https%3A%2F%2Fapp.siyahtus.test%2Fchannels%2Fmeta%2Fcallback',
    );
    expect(calls[1]!.url).toContain('fb_exchange_token=short-token');

    const refusing = recordingHttp([
      {
        match: /oauth/,
        status: 400,
        json: { error: { message: `bad secret ${APP_SECRET} code the-code`, code: 100 } },
      },
    ]);
    const error = await live(refusing.http)
      .userTokenFromCode('the-code')
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MetaGraphError);
    expect((error as MetaGraphError).providerMessage ?? '').not.toContain(APP_SECRET);
    expect((error as MetaGraphError).providerMessage ?? '').not.toContain('the-code');
  });

  it('lists the pages with their linked Instagram accounts, skipping rows it cannot use', async () => {
    const { http, calls } = recordingHttp([
      {
        match: /\/me\/accounts/,
        json: {
          data: [
            {
              id: PAGE,
              name: 'Acme',
              access_token: 'pt',
              instagram_business_account: { id: IG, username: 'acme' },
            },
            { id: '200', name: 'No IG', access_token: 'pt2' },
            { id: 'not-a-number', name: 'Bad', access_token: 'pt3' },
            { id: '300', name: 'No token' },
          ],
        },
      },
    ]);
    expect(await live(http).pages('user-token')).toEqual([
      { id: PAGE, name: 'Acme', accessToken: 'pt', instagram: { id: IG, username: 'acme' } },
      { id: '200', name: 'No IG', accessToken: 'pt2', instagram: null },
    ]);
    expect(calls[0]!.headers).toEqual({ authorization: 'Bearer user-token' });
    expect(calls[0]!.url).not.toContain('user-token');
  });

  it('sends a RESPONSE through the page, split at the channel’s limit', async () => {
    const { http, calls } = recordingHttp([
      { match: /\/messages$/, json: { message_id: 'm_out' } },
    ]);
    const client = live(http);
    const text = 'x'.repeat(META_TEXT_MAX.instagram + 5);
    expect(await client.sendText('pt', PAGE, 'instagram', PSID, text)).toBe('m_out');
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe(`https://graph.example.test/v21.0/${PAGE}/messages`);
    expect(calls[0]!.json).toEqual({
      recipient: { id: PSID },
      messaging_type: 'RESPONSE',
      message: { text: 'x'.repeat(META_TEXT_MAX.instagram) },
    });
    calls.length = 0;
    await client.sendText('pt', PAGE, 'messenger', PSID, text);
    expect(calls).toHaveLength(1);
  });

  it('subscribes the app to the page’s messages and postbacks', async () => {
    const { http, calls } = recordingHttp([{ match: /subscribed_apps/, json: { success: true } }]);
    await live(http).subscribePage('pt', PAGE);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `https://graph.example.test/v21.0/${PAGE}/subscribed_apps`,
      json: { subscribed_fields: 'messages,messaging_postbacks' },
    });
  });

  it('maps Meta’s refusals to what the API answers', () => {
    expect(metaConnectError(new MetaGraphError(400, 100, 'expired'), 'Facebook').type).toBe(
      'validation',
    );
    expect(metaConnectError(new MetaGraphError(502, null, undefined), 'Facebook').type).toBe(
      'service_unavailable',
    );
    expect(metaConnectError(new MetaGraphUnreachableError('timeout'), 'Facebook').type).toBe(
      'service_unavailable',
    );
  });
});

describe('createLiveMetaMessaging (tm 381)', () => {
  const context = { http: recordingHttp([]).http, endpoints: DEFAULT_PROVIDER_ENDPOINTS };
  const base = {
    APPS_CREDENTIAL_KEY: 'ab'.repeat(32),
    WHATSAPP_APP_ID: '1',
    WHATSAPP_APP_SECRET: 's',
    WHATSAPP_VERIFY_TOKEN: 'v',
    WHATSAPP_GRAPH_VERSION: 'v21.0',
    WEB_APP_URL: 'https://app.test',
  };

  it('runs only the channels named, and none without the Meta app', () => {
    expect(createLiveMetaMessaging({ ...base, APPS_LIVE_PROVIDERS: [] }, context)).toBeNull();
    const instagramOnly = createLiveMetaMessaging(
      { ...base, APPS_LIVE_PROVIDERS: ['instagram'] },
      context,
    );
    expect(instagramOnly?.live.runs('instagram')).toBe(true);
    expect(instagramOnly?.live.runs('messenger')).toBe(false);
    expect(
      createLiveMetaMessaging(
        { ...base, WHATSAPP_APP_SECRET: undefined, APPS_LIVE_PROVIDERS: ['messenger'] },
        context,
      ),
    ).toBeNull();
  });
});
