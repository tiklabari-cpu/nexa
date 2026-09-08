/**
 * Turning a stored ticket e-mail template into an actual message (FR-MOD-08.7.5).
 *
 * The authoring half of this requirement has existed since tm 50: a workspace
 * writes a branded template, and `{{ group.field }}` placeholders are validated
 * against the `@nexa/types` catalogue before the row is stored. What was missing
 * was the other half — nothing ever *rendered* one, so an admin could write a
 * template and no mail would ever carry it.
 *
 * The decisions live here, apart from the database and the mailer, because the
 * cases that matter are the refusals: a template whose text stopped being
 * renderable, a ticket with nobody to write to, a placeholder the product cannot
 * fill. Each of those has to be a *refusal* rather than a best guess, and a pure
 * function is the only way to test that without a spool and a tenant.
 *
 * The rule the module exists to hold: **nothing is sent that could not be fully
 * rendered.** A template is validated at authoring time, but rows outlive the
 * catalogue they were written against — a variable removed from
 * `TEMPLATE_VARIABLES` turns yesterday's valid template into today's broken one.
 * Re-checking at send time is what stops that from reaching a customer's inbox
 * as a literal `{{ticket.titel}}`, which is exactly the failure the requirement's
 * acceptance criterion ("geçersiz değişken/format engeli") names.
 */
import {
  findTemplateProblemsIn,
  nearestTicketPriorityBand,
  renderTemplate,
  templateVariablesUsed,
  type TemplateContext,
  type TemplateProblem,
  type TemplateVariable,
  type TicketStatus,
} from '@nexa/types';

/** The stored template, reduced to what rendering needs. */
export interface StoredTemplate {
  id: string;
  subject: string;
  body: string;
  enabled: boolean;
}

/** Everything a ticket notice can say, gathered from the ticket and its workspace. */
export interface TicketEmailFacts {
  ticketId: string;
  subject: string;
  /** The status the ticket is moving *to* — the notice is about the change. */
  status: TicketStatus;
  /** The stored signed priority; rendered as its named band, never as a number. */
  priority: number;
  customerName: string | null;
  customerEmail: string | null;
  /** The agent making the change, or null when the caller names no person. */
  agentName: string | null;
  /** The workspace's own name (`organizations.name`), the "branded" in the requirement. */
  companyName: string | null;
}

/** A message ready to hand to the mailer, plus the trail's share of it. */
export interface RenderedTicketEmail {
  to: string;
  subject: string;
  body: string;
  templateId: string;
  /**
   * Which variables the template named — the *names*, never their values. This
   * is what the audit entry carries: enough to answer "what did that message
   * draw on" without copying a word of the customer's data into the log
   * (FR-MOD-08.3 · M-CO-a).
   */
  variables: TemplateVariable[];
}

/**
 * Why a template could not be turned into a message. Each is a refusal with a
 * different cause, kept apart so the caller can answer with the right status —
 * a template that is not this workspace's is absent (404), the rest are the
 * caller's request being wrong (400).
 */
export type TicketEmailRefusal =
  | { reason: 'disabled' }
  | { reason: 'invalid_template'; problem: TemplateProblem }
  | { reason: 'no_recipient' };

export type TicketEmailOutcome =
  { ok: true; message: RenderedTicketEmail } | { ok: false; refusal: TicketEmailRefusal };

/**
 * The values each catalogue variable resolves to for one ticket.
 *
 * Every variable the catalogue knows gets a key, even when the answer is empty:
 * `renderTemplate` fills a missing key with an empty string rather than leaving
 * a raw placeholder, and being explicit here is what makes that a decision
 * ("we have no agent name") rather than an accident.
 *
 * `ticket.priority` is the *band* — `Urgent`, `Normal` — and not the stored
 * integer. The column is a signed ±100 scale that exists so a queue can be
 * ordered; a customer reading "Priority: -50" learns nothing. The band table is
 * `@nexa/types`', the same one the inbox renders, so the mail and the screen
 * cannot disagree.
 */
export function ticketTemplateContext(facts: TicketEmailFacts): TemplateContext {
  return {
    'ticket.id': facts.ticketId,
    'ticket.subject': facts.subject,
    'ticket.status': facts.status,
    'ticket.priority': nearestTicketPriorityBand(facts.priority).label,
    'customer.name': facts.customerName ?? '',
    'customer.email': facts.customerEmail ?? '',
    'agent.name': facts.agentName ?? '',
    'company.name': facts.companyName ?? '',
  };
}

/**
 * Render a stored template for a ticket, or refuse.
 *
 * The order of the checks is the order of the risks:
 *
 *  1. **Disabled** — a template switched off is one the workspace has decided
 *     not to send. Checked first because it is a decision already made, and
 *     rendering it to find out whether it *could* have been sent would be work
 *     spent on an answer nobody wants.
 *  2. **Still valid** — the stored text is re-judged by the same
 *     `findTemplateProblemsIn` that guarded the write. Rows outlive catalogues;
 *     this is the check that keeps a stale template out of a customer's inbox
 *     instead of shipping raw braces.
 *  3. **Someone to write to** — a ticket with no customer address cannot be
 *     notified. A refusal rather than a silent skip: an agent who asked for a
 *     notice and got none must be told, or the feature is dead in exactly the
 *     way it was dead before.
 */
export function renderTicketEmail(
  template: StoredTemplate,
  facts: TicketEmailFacts,
): TicketEmailOutcome {
  if (!template.enabled) return { ok: false, refusal: { reason: 'disabled' } };

  const problems = findTemplateProblemsIn({ subject: template.subject, body: template.body });
  const problem = problems[0];
  if (problem) return { ok: false, refusal: { reason: 'invalid_template', problem } };

  const to = facts.customerEmail?.trim();
  if (!to) return { ok: false, refusal: { reason: 'no_recipient' } };

  const context = ticketTemplateContext(facts);
  return {
    ok: true,
    message: {
      to,
      subject: renderTemplate(template.subject, context),
      body: renderTemplate(template.body, context),
      templateId: template.id,
      variables: templateVariablesUsed({ subject: template.subject, body: template.body }),
    },
  };
}
