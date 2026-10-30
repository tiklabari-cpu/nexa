/**
 * Campaign targeting from the widget (EN-03 · tm 352.1): the page a visitor
 * moved to without a reload, the site's session variables, and the moment a
 * waiting campaign card was actually shown.
 *
 * `POST /customer/visit` is the third writer of a page view, beside the first
 * message (`customer.ts`) and the token mint (`auth.ts`), and does what they
 * do in the same order and the same transaction: record the page, then offer
 * the visitor to the running campaigns. A single-page site changes pages
 * through `pushState`; without this, a visitor who opened the widget on the
 * home page would stay "on the home page" for the engine however far they
 * went. The widget sends it only while the mint said `campaign_tracking`,
 * debounced, and inside the customer token's rate limit (`rl:customer:…`,
 * 60/min) like every route here.
 *
 * Session variables are the site's word, carried by the visitor's browser:
 * unverified. They are bounded (`SESSION_VARIABLES_MAX` keys,
 * `SESSION_VARIABLE_MAX_LENGTH` characters), card-masked before they are
 * written, read by `custom_var` rules and nothing else — no API returns them
 * and the AI never sees them (EN-03 karar 2).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  REFERRER_MAX_LENGTH,
  SESSION_VARIABLE_MAX_LENGTH,
  SESSION_VARIABLES_MAX,
} from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import { maskCardNumbers } from '../lib/cc-mask.js';
import { markCampaignShown } from '../services/campaigns/campaign-delivery.js';
import { fireCampaignsAtVisitor } from '../services/campaigns/campaign-trigger.js';
import { CustomerService } from '../services/customers/customer-service.js';

const variableValue = z.union([
  z.string().max(SESSION_VARIABLE_MAX_LENGTH),
  z.number().finite(),
  z.boolean(),
]);

const visitBody = z
  .object({
    url: z.string().min(1).max(2048),
    referrer: z.string().max(REFERRER_MAX_LENGTH).optional(),
    variables: z
      .record(z.string().trim().min(1).max(SESSION_VARIABLE_MAX_LENGTH), variableValue)
      .refine((value) => Object.keys(value).length <= SESSION_VARIABLES_MAX, {
        message: `at most ${SESSION_VARIABLES_MAX} variables`,
      })
      .optional(),
  })
  .strict();

const campaignIdParam = z.string().uuid();

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

/** An http(s) page address, or null — a page view is about a web page. */
function webPage(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}

/**
 * The variables as they are stored: text, keys trimmed, card numbers masked
 * in keys and values alike (a site that puts a PAN in a variable has made a
 * mistake the database should not keep). Two keys that mask to the same text
 * keep the later one.
 */
export function storedSessionVariables(
  variables: Record<string, string | number | boolean>,
): Record<string, string> {
  const stored: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    stored[maskCardNumbers(key.trim())] = maskCardNumbers(String(value));
  }
  return stored;
}

export default async function customerVisitRoutes(app: FastifyInstance): Promise<void> {
  const customerDirectory = new CustomerService();
  const customerOnly = { principals: ['customer' as const] };

  app.post('/customer/visit', { config: customerOnly }, async (request, reply) => {
    const principal = request.requirePrincipal();
    if (principal.kind !== 'customer') throw ApiError.notFound('Resource not found.');
    const body = parse(visitBody, request.body);
    const url = webPage(body.url);
    if (!url) throw ApiError.validation('url: must be an http or https address.');
    const tenant = request.tenant();

    await request.withTenant(async (tx) => {
      const pageUrls = await customerDirectory.recordPageView(tx, tenant, {
        customerId: principal.customerId,
        url,
        referrer: body.referrer,
        userAgent: request.headers['user-agent'],
        ip: request.ip,
        // In-process and offline (tm 330): the address goes nowhere.
        locate: () => app.geo.locate(request.ip),
        variables: body.variables ? storedSessionVariables(body.variables) : undefined,
      });
      // The page and the fire it justifies are one fact, as on the other two
      // writers (`campaign-trigger.ts` explains the cost: ~0.07 ms).
      await fireCampaignsAtVisitor(
        tx,
        tenant,
        { customerId: principal.customerId, pageUrls },
        new Date(),
      );
    });
    return reply.code(204).send();
  });

  app.post(
    '/customer/campaigns/:campaignId/shown',
    { config: customerOnly },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      if (principal.kind !== 'customer') throw ApiError.notFound('Resource not found.');
      const campaignId = parse(
        campaignIdParam,
        (request.params as { campaignId?: unknown }).campaignId,
      );
      const tenant = request.tenant();
      const found = await request.withTenant((tx) =>
        markCampaignShown(tx, tenant, { customerId: principal.customerId, campaignId }, new Date()),
      );
      if (!found) throw ApiError.notFound('Campaign not found.');
      return reply.code(204).send();
    },
  );
}
