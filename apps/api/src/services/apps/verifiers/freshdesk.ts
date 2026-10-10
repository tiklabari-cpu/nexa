/**
 * Freshdesk, live (tm 263).
 *
 * Each Freshdesk customer has their own host, `<subdomain>.freshdesk.com`, so
 * this is the one card where the user names where the server connects. The
 * subdomain is a single validated DNS label (`APP_SUBDOMAIN_PATTERN`, checked
 * by the route and again here), spliced into Freshdesk's own domain — never a
 * host of the user's choosing — and the safe client then refuses any address
 * the name resolves to that is internal. Two layers, because the first is
 * about what may be asked for and the second about where it actually goes.
 *
 * Verify: `GET /api/v2/agents/me` ("Currently Authenticated Agent"), Basic
 * auth with the key as user and `X` as password (developers.freshdesk.com).
 * 401 = wrong key, 403 = key without API access, 404 = no such helpdesk.
 * Chat data: `GET /api/v2/tickets?email=…` — the requester's tickets (Freshdesk
 * returns those of the last 30 days by default), counted by status.
 */
import { APP_SUBDOMAIN_PATTERN } from '@siyahtus/types';
import { messageOf, reasonForTransportError, sanitiseProviderMessage } from './provider-message.js';
import { ProviderReadError, type AppVerifier, type ChatField } from './types.js';

/** Open, Pending, Waiting on Customer, Waiting on Third Party — not Resolved (4) or Closed (5). */
const OPEN_STATUSES = new Set([2, 3, 6, 7]);

function basic(apiKey: string): string {
  return `Basic ${Buffer.from(`${apiKey}:X`, 'utf8').toString('base64')}`;
}

function assertLabel(subdomain: string | undefined): string {
  if (!subdomain || !APP_SUBDOMAIN_PATTERN.test(subdomain)) {
    // The route validates first; reaching here is a programming error, and
    // refusing beats building a URL out of an unchecked value.
    throw new Error('freshdesk: subdomain is not a validated DNS label');
  }
  return subdomain;
}

export const freshdeskVerifier: AppVerifier = {
  appId: 'freshdesk',
  credentialFields: ['subdomain', 'api_key'],

  async verify({ apiKey, subdomain }, { http, endpoints }) {
    const base = endpoints.freshdesk(assertLabel(subdomain));
    let answer;
    try {
      answer = await http.request({
        method: 'GET',
        url: `${base}/api/v2/agents/me`,
        headers: { authorization: basic(apiKey) },
      });
    } catch (error) {
      return { ok: false, reason: reasonForTransportError(error) };
    }
    const providerMessage = sanitiseProviderMessage(messageOf(answer.json), [
      apiKey,
      basic(apiKey),
    ]);
    const extra = providerMessage ? { providerMessage } : {};
    if (answer.status === 401 || answer.status === 403) {
      return { ok: false, reason: 'invalid_key', ...extra };
    }
    if (answer.status === 404) return { ok: false, reason: 'not_found', ...extra };
    if (answer.status !== 200 || !answer.json || typeof answer.json !== 'object') {
      return { ok: false, reason: 'provider_error', ...extra };
    }
    // The agent's address names whose key this is. Where Freshdesk puts it has
    // varied (nested `contact` on `agents/me`, top-level on `agents/{id}`), so
    // both are read; the helpdesk name is the fallback.
    const agent = answer.json as { email?: unknown; contact?: { email?: unknown; name?: unknown } };
    const email = agent.contact?.email ?? agent.email;
    const label =
      typeof email === 'string' && email
        ? `${email} (${subdomain}.freshdesk.com)`
        : `${subdomain}.freshdesk.com`;
    return { ok: true, accountLabel: label.slice(0, 120) };
  },

  async fetchChatData({ apiKey, subdomain }, { email }, { http, endpoints }) {
    if (!email) return null;
    const base = endpoints.freshdesk(assertLabel(subdomain));
    let answer;
    try {
      answer = await http.request({
        method: 'GET',
        url: `${base}/api/v2/tickets?email=${encodeURIComponent(email)}&per_page=30`,
        headers: { authorization: basic(apiKey) },
      });
    } catch (error) {
      throw new ProviderReadError(reasonForTransportError(error));
    }
    if (answer.status === 401 || answer.status === 403) throw new ProviderReadError('invalid_key');
    // An address Freshdesk has no contact for is answered 400 ("no contact with this email").
    if (answer.status === 400 || answer.status === 404) return null;
    if (answer.status !== 200 || !Array.isArray(answer.json)) {
      throw new ProviderReadError('provider_error');
    }
    const tickets = answer.json as Array<{ status?: unknown; subject?: unknown }>;
    if (tickets.length === 0) return null;
    const open = tickets.filter((t) => typeof t.status === 'number' && OPEN_STATUSES.has(t.status));
    const latest = tickets[0]?.subject;
    const fields: ChatField[] = [
      { label: 'Open tickets (30d)', value: String(open.length) },
      { label: 'Tickets (30d)', value: String(tickets.length) },
    ];
    if (typeof latest === 'string' && latest.trim()) {
      fields.push({ label: 'Latest ticket', value: latest.trim().slice(0, 120) });
    }
    return fields;
  },
};
