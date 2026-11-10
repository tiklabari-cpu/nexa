/**
 * `splitText` (tm 453 · F33): the outbound split shared by Telegram, WhatsApp and
 * Meta messaging never cuts a surrogate pair in half, prefers a word break, and
 * its parts always concatenate back to the input.
 */
import { describe, expect, it } from 'vitest';
import type { SafeHttp, SafeRequest } from '../../lib/safe-fetch.js';
import { DEFAULT_PROVIDER_ENDPOINTS } from '../apps/verifiers/types.js';
import { MetaMessagingLive } from './meta-messaging-live.js';
import { splitText } from './split-text.js';
import { TelegramLive } from './telegram-live.js';
import { WhatsAppLive } from './whatsapp-live.js';

/** True when `part` holds a lone high or low surrogate (what renders as "�"). */
function hasLoneSurrogate(part: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(part);
}

describe('splitText', () => {
  it('keeps a short text whole, the empty text included', () => {
    expect(splitText('hello', 4096)).toEqual(['hello']);
    expect(splitText('', 4096)).toEqual(['']);
    expect(splitText('a'.repeat(4096), 4096)).toEqual(['a'.repeat(4096)]);
  });

  it('cuts at the limit when there is no space, as before', () => {
    const parts = splitText('x'.repeat(4101), 4096);
    expect(parts).toEqual(['x'.repeat(4096), 'x'.repeat(5)]);
  });

  it('does not split an emoji sitting across the limit (4095 a + 😀b, limit 4096)', () => {
    const text = `${'a'.repeat(4095)}😀b`;
    const parts = splitText(text, 4096);
    expect(parts).toEqual(['a'.repeat(4095), '😀b']);
    expect(parts.join('')).toBe(text);
    expect(parts.some(hasLoneSurrogate)).toBe(false);
    expect(parts.every((part) => part.length <= 4096)).toBe(true);
  });

  it('leaves a pair that ends exactly at the limit alone', () => {
    const text = `${'a'.repeat(4094)}😀b`;
    expect(splitText(text, 4096)).toEqual([`${'a'.repeat(4094)}😀`, 'b']);
  });

  it('survives a text made only of astral characters', () => {
    const text = '😀'.repeat(5000);
    const parts = splitText(text, 4096);
    expect(parts.join('')).toBe(text);
    expect(parts.some(hasLoneSurrogate)).toBe(false);
    expect(parts.every((part) => part.length <= 4096)).toBe(true);
  });

  it('breaks after the last space inside the limit when there is one', () => {
    const text = `${'a'.repeat(7)} ${'b'.repeat(6)} ${'c'.repeat(8)}`;
    const parts = splitText(text, 16);
    expect(parts).toEqual([`${'a'.repeat(7)} ${'b'.repeat(6)} `, 'c'.repeat(8)]);
    expect(parts.join('')).toBe(text);
  });

  it('ignores a space too early in the window (no tiny first part)', () => {
    const text = `hi ${'x'.repeat(30)}`;
    expect(splitText(text, 20)[0]).toHaveLength(20);
  });

  it('never loops on a limit below a pair', () => {
    expect(splitText('😀😀😀', 1).join('')).toBe('😀😀😀');
  });
});

describe('the three providers split through splitText', () => {
  const text = `${'a'.repeat(4095)}😀b`;

  function recorder(json: unknown) {
    const calls: SafeRequest[] = [];
    const http: SafeHttp = {
      async request(request) {
        calls.push(request);
        const body = JSON.stringify(json);
        return { status: 200, json, text: body, bytes: Buffer.from(body) };
      },
    };
    return { http, calls };
  }

  function context(http: SafeHttp) {
    return {
      http,
      endpoints: { ...DEFAULT_PROVIDER_ENDPOINTS, whatsapp: 'https://graph.example.test' },
    };
  }

  it('Telegram', async () => {
    const { http, calls } = recorder({ ok: true, result: { message_id: 7 } });
    const client = new TelegramLive(context(http), 'https://app.siyahtus.test');
    expect(await client.sendMessage('123456:token', '42', text)).toBe('tg.7');
    const sent = calls.map((call) => (call.json as { text: string }).text);
    expect(sent).toEqual(['a'.repeat(4095), '😀b']);
  });

  it('WhatsApp', async () => {
    const { http, calls } = recorder({ messages: [{ id: 'wamid.1' }] });
    const client = new WhatsAppLive(
      context(http),
      { appId: '1', appSecret: 's', verifyToken: 'v', configId: '2', graphVersion: 'v21.0' },
      'https://app.siyahtus.test/',
    );
    await client.sendText('tok', '106', '9053', text);
    const sent = calls.map((call) => (call.json as { text: { body: string } }).text.body);
    expect(sent).toEqual(['a'.repeat(4095), '😀b']);
  });

  it('Meta (Instagram, 1000-unit limit)', async () => {
    const { http, calls } = recorder({ message_id: 'm_1' });
    const client = new MetaMessagingLive(
      context(http),
      { appId: '1', appSecret: 's', verifyToken: 'v', graphVersion: 'v21.0' },
      'https://app.siyahtus.test/',
      ['messenger', 'instagram'],
    );
    const long = `${'a'.repeat(999)}😀b`;
    await client.sendText('pt', 'page', 'instagram', 'psid', long);
    const sent = calls.map((call) => (call.json as { message: { text: string } }).message.text);
    expect(sent.join('')).toBe(long);
    expect(sent.some(hasLoneSurrogate)).toBe(false);
  });
});
