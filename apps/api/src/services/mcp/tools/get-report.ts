/**
 * `get_report` — MCP adapter for the four `reports_read` endpoints
 * (FR-MOD-08.8.3-e): `GET /reports/{overview,breakdown,ai-agent,reviews}`.
 *
 * The `report` argument selects which one; each case runs the exact report
 * builder the matching route calls — the query itself is not duplicated, only
 * the range resolution and the enum→builder dispatch live here. Read-only,
 * like every MCP tool, which is why the catalogue gates it behind
 * `reports_read` (shared by all four report routes).
 *
 * `resolveRange` is the same function every REST report route resolves its
 * window with, so `get_report` defaults to the same last-30-days window and
 * rejects a reversed range with the same `ApiError.validation` (400) they do.
 *
 * As with `search_tickets`/`list_chats`, the tenant boundary is not this
 * executor's to enforce: `ctx.tx` already carries the caller's tenant context
 * (RLS), and every builder below is handed `ctx.tenant.licenseId` directly —
 * the same license every report route scopes to.
 */
import {
  buildAiAgentReport,
  buildBreakdownReport,
  buildOverviewReport,
  buildReviewsReport,
  resolveRange,
} from '../../../routes/reports.js';
import type { GetReportArgs } from '../tool-catalog.js';
import type { McpToolExecutor } from '../tool-dispatch.js';

export const runGetReport: McpToolExecutor = async (ctx, args) => {
  // The tool-call surface validated `args` against the catalogue's
  // `getReportInputSchema` before dispatching, so this shape is guaranteed.
  const { report, from, to } = args as GetReportArgs;
  const range = resolveRange({ from, to });

  switch (report) {
    case 'overview':
      return buildOverviewReport(ctx.tx, ctx.tenant.licenseId, range.from, range.to);
    case 'breakdown':
      return buildBreakdownReport(ctx.tx, ctx.tenant.licenseId, range.from, range.to);
    case 'ai-agent':
      return buildAiAgentReport(ctx.tx, ctx.tenant.licenseId, range.from, range.to);
    case 'reviews':
      return buildReviewsReport(ctx.tx, ctx.tenant.licenseId, range.from, range.to);
  }
};
