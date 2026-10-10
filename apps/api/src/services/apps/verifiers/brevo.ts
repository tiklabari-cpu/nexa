/**
 * Brevo (ex-Sendinblue), live (tm 263).
 *
 * Verify: `GET /v3/account` with the key in the `api-key` header — read-only,
 * and the account it answers with names whose key this is. Chat data:
 * `GET /v3/contacts/{email}` — whether the person still receives campaign
 * mail, and how many campaigns they opened (Brevo's statistics cover the last
 * 90 days). Endpoints per developers.brevo.com (`getAccount`, `getContactInfo`).
 *
 * Brevo answers a bad key with 401 `unauthorized` ("Key not found"); some
 * versions of its reference list the same codes under 400, so a 400 whose code
 * says so is read as a bad key too.
 */
import { messageOf, reasonForTransportError, sanitiseProviderMessage } from './provider-message.js';
import { ProviderReadError, type AppVerifier, type ChatField } from './types.js';

const BAD_KEY_CODES = new Set(['unauthorized', 'api-key not found', 'authentication failed']);

function isBadKey(status: number, body: unknown): boolean {
  if (status === 401 || status === 403) return true;
  if (status !== 400) return false;
  const code = (body as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' && BAD_KEY_CODES.has(code.toLowerCase());
}

export const brevoVerifier: AppVerifier = {
  appId: 'brevo',
  credentialFields: ['api_key'],

  async verify({ apiKey }, { http, endpoints }) {
    let answer;
    try {
      answer = await http.request({
        method: 'GET',
        url: `${endpoints.brevo}/v3/account`,
        headers: { 'api-key': apiKey },
      });
    } catch (error) {
      return { ok: false, reason: reasonForTransportError(error) };
    }
    const providerMessage = sanitiseProviderMessage(messageOf(answer.json), [apiKey]);
    if (isBadKey(answer.status, answer.json)) {
      return { ok: false, reason: 'invalid_key', ...(providerMessage ? { providerMessage } : {}) };
    }
    if (answer.status !== 200 || !answer.json || typeof answer.json !== 'object') {
      return {
        ok: false,
        reason: 'provider_error',
        ...(providerMessage ? { providerMessage } : {}),
      };
    }
    const account = answer.json as { email?: unknown; companyName?: unknown };
    const label =
      typeof account.companyName === 'string' && account.companyName.trim()
        ? account.companyName.trim()
        : typeof account.email === 'string'
          ? account.email
          : 'Brevo';
    return { ok: true, accountLabel: label.slice(0, 120) };
  },

  async fetchChatData({ apiKey }, { email }, { http, endpoints }) {
    if (!email) return null;
    let answer;
    try {
      answer = await http.request({
        method: 'GET',
        url: `${endpoints.brevo}/v3/contacts/${encodeURIComponent(email)}?identifierType=email_id`,
        headers: { 'api-key': apiKey },
      });
    } catch (error) {
      throw new ProviderReadError(reasonForTransportError(error));
    }
    if (answer.status === 404) return null;
    if (isBadKey(answer.status, answer.json)) throw new ProviderReadError('invalid_key');
    if (answer.status !== 200 || !answer.json || typeof answer.json !== 'object') {
      throw new ProviderReadError('provider_error');
    }
    const contact = answer.json as {
      emailBlacklisted?: unknown;
      listIds?: unknown;
      statistics?: { opened?: unknown };
    };
    const opened = Array.isArray(contact.statistics?.opened) ? contact.statistics.opened : [];
    const campaigns = new Set(
      opened
        .map((entry) => (entry as { campaignId?: unknown }).campaignId)
        .filter((id) => id !== undefined),
    );
    const fields: ChatField[] = [
      { label: 'Subscribed', value: contact.emailBlacklisted === true ? 'No' : 'Yes' },
      { label: 'Campaigns opened (90d)', value: String(campaigns.size) },
    ];
    if (Array.isArray(contact.listIds)) {
      fields.push({ label: 'Lists', value: String(contact.listIds.length) });
    }
    return fields;
  },
};
