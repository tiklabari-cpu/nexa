/**
 * Command palette AI query (FR-MOD-01.1.3 — the palette's third result type).
 *
 * Account/team-wide and context-free, unlike Copilot's chat-scoped assists
 * (`routes/copilot.ts`): this takes no `chatId`, because it is asked from the
 * palette rather than from inside a conversation. It shares Copilot's
 * boundary shape all the same — `reports_read`-gated, run inside
 * `request.withTenant`, closed to a customer token by the default
 * agent+bot `principals` list (a customer token gets a 404, never a 403).
 *
 * The answer is never a second computation of a number Reports already owns:
 * matching (`@nexa/ai-mock`, deterministic — no real LLM) only decides *which*
 * field of `buildOverviewReport` to read, and the route reads it through the
 * exact same builder `GET /reports/overview` calls, so the two can never quote
 * different figures for the same license and window (ADR-09).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { matchPaletteTopic } from '@nexa/ai-mock';
import { ApiError } from '../lib/api-error.js';
import { buildOverviewReport, resolveRange } from './reports.js';

const READ = ['reports_read'];

const aiQueryBody = z.object({
  query: z.string().trim().min(1).max(500),
});

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

/** The shape of `buildOverviewReport`'s body this route actually reads. */
interface OverviewSnapshot {
  totals: { chats: number; tickets: number; automated: number };
  satisfaction: { score: number | null };
  response_times: { avg_first_response_seconds: number | null };
}

/**
 * One reader per topic: pulls the figure out of the Overview report and
 * phrases it. `read` returns `null` when the report has nothing to say yet
 * (an unrated period has a `null` satisfaction score, not a zero) — the route
 * turns that into `kind: 'no_data'` rather than reporting a false zero.
 */
const TOPIC_READERS: Record<
  string,
  { read: (overview: OverviewSnapshot) => number | null; describe: (value: number) => string }
> = {
  team_activity: {
    read: (overview) => overview.totals.chats,
    describe: (value) => `Your team handled ${value} chat${value === 1 ? '' : 's'} in this period.`,
  },
  tickets: {
    read: (overview) => overview.totals.tickets,
    describe: (value) => `There ${value === 1 ? 'was' : 'were'} ${value} ticket${value === 1 ? '' : 's'} in this period.`,
  },
  satisfaction: {
    read: (overview) => overview.satisfaction.score,
    describe: (value) => `Customer satisfaction is ${value}% in this period.`,
  },
  response_time: {
    read: (overview) => overview.response_times.avg_first_response_seconds,
    describe: (value) => `Average first response time is ${value} second${value === 1 ? '' : 's'} in this period.`,
  },
  automated: {
    read: (overview) => overview.totals.automated,
    describe: (value) => `${value} chat${value === 1 ? '' : 's'} were resolved automatically in this period.`,
  },
};

const NOT_UNDERSTOOD_ANSWER =
  "I couldn't match that to something I can report on yet. Try asking about team activity, tickets, " +
  'customer satisfaction, response time, or automated resolutions.';

export default async function commandPaletteRoutes(app: FastifyInstance): Promise<void> {
  app.post('/palette/ai-query', { config: { scopes: READ } }, async (request, reply) => {
    const body = parse(aiQueryBody, request.body);

    const match = matchPaletteTopic(body.query);
    if (!match) {
      return reply.send({ answer: NOT_UNDERSTOOD_ANSWER, kind: 'not_understood' });
    }

    const reader = TOPIC_READERS[match.topic.id];
    /* istanbul ignore if -- every catalogue entry has a reader; guards a future topic added to one but not the other. */
    if (!reader) {
      return reply.send({ answer: NOT_UNDERSTOOD_ANSWER, kind: 'not_understood' });
    }

    const tenant = request.tenant();
    // No caller-supplied window: the palette asks about "this period" the same
    // way the Reports overview tab opens — the shared 30-day default
    // (`resolveRange`) — so the two can be compared figure-for-figure in a test
    // without the palette also having to expose `from`/`to` query params.
    const { from, to } = resolveRange({});
    const overview = (await request.withTenant((tx) =>
      buildOverviewReport(tx, tenant.licenseId, from, to),
    )) as unknown as OverviewSnapshot;

    const value = reader.read(overview);
    if (value === null || value === undefined) {
      return reply.send({
        answer: 'No data yet for that in this period.',
        kind: 'no_data',
        metric_source: match.topic.metricSource,
      });
    }

    return reply.send({
      answer: reader.describe(value),
      kind: 'summary',
      metric_source: match.topic.metricSource,
    });
  });
}
