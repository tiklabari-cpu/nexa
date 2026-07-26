/**
 * Copilot — agent-assist (FR-MOD-12).
 *
 * Copilot is a second AI surface, and the point of it is separation. Its
 * knowledge base is the agent's own — kept apart from the customer-facing AI
 * agent's sources (12.2) and never reachable by a customer token — so it is
 * modelled as an `AiAgent` of `kind: 'copilot'` with knowledge sources of its
 * own. Retrieval and indexing are always scoped to that agent, so the two
 * knowledge bases can never answer from each other.
 *
 * Everything here is find-or-create against the license: the seed makes a
 * Copilot agent, but a freshly provisioned workspace (or a test fixture) may not
 * have one yet, and an assist must not fail because setup ran in a different
 * order. A copilot assist also records a `SkillRun` on the chat — the exact
 * signal Reports counts as "assisted" (07.3.2), so using Copilot on a chat that
 * a human then closes moves it out of the "manual" column.
 */
import type { ConversationTurn } from '@nexa/ai-mock';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import type { Principal } from '../auth/principal.js';
import { KnowledgeService, type RetrievedChunk } from './knowledge-service.js';

const COPILOT_KIND = 'copilot';
/**
 * The copilot assist-run skill uses `workspace` — the `skills_kind_check`
 * constraint permits `ai_agent` and `workspace` only, and `workspace` is the
 * kind the Reports "assisted" split already treats as a non-AI-agent run.
 */
const COPILOT_SKILL_KIND = 'workspace';

export interface CopilotSourceView {
  id: string;
  name: string;
  type: string;
  status: string;
  source_url: string | null;
  chunk_count: number;
  updated_at: string;
}

export interface CopilotDraft {
  draft: string;
  sources: Array<{ name: string; score: number }>;
}

export class CopilotService {
  constructor(private readonly knowledge: KnowledgeService = new KnowledgeService()) {}

  /** The copilot agent's id, if the license has one — no side effects. */
  async findAgentId(tx: TenantClient): Promise<string | null> {
    const agent = await tx.aiAgent.findFirst({
      where: { kind: COPILOT_KIND },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return agent?.id ?? null;
  }

  /** The copilot agent, creating it on first use so an assist never 500s on setup order. */
  async ensureAgentId(tx: TenantClient, tenant: TenantContext): Promise<string> {
    const existing = await this.findAgentId(tx);
    if (existing) return existing;
    const created = await tx.aiAgent.create({
      data: { licenseId: tenant.licenseId, kind: COPILOT_KIND, name: 'Copilot', active: true },
      select: { id: true },
    });
    return created.id;
  }

  /**
   * The copilot "skill" that owns assist runs. It exists only to satisfy the
   * `skill_runs.skill_id` foreign key, so it uses the `workspace` kind the split
   * already recognises for non-AI-agent runs (07.3.2) rather than a new one. It
   * is identified by hanging off the copilot agent — a scope nothing else writes
   * to — and the Playbook list filters to `ai_agent`, so an admin never sees it.
   */
  private async ensureSkillId(tx: TenantClient, tenant: TenantContext): Promise<string> {
    const agentId = await this.ensureAgentId(tx, tenant);
    const existing = await tx.skill.findFirst({
      where: { aiAgentId: agentId, kind: COPILOT_SKILL_KIND },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing.id;

    const created = await tx.skill.create({
      data: {
        licenseId: tenant.licenseId,
        aiAgentId: agentId,
        name: 'Copilot',
        kind: COPILOT_SKILL_KIND,
        active: true,
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    return created.id;
  }

  /**
   * Record that Copilot assisted this chat. Feeds the Reports "assisted" split
   * (07.3.2), which keys off the existence of a `skill_run` for the chat — so
   * this is the one line that makes 12.1's "feeds the Assisted metric" true.
   */
  async recordAssist(
    tx: TenantClient,
    tenant: TenantContext,
    chatId: string,
    action: string,
    detail: string,
  ): Promise<void> {
    const skillId = await this.ensureSkillId(tx, tenant);
    await tx.skillRun.create({
      data: {
        skillId,
        chatId,
        licenseId: tenant.licenseId,
        status: 'succeeded',
        log: { outcome: `copilot_${action}`, entries: [{ step: action, detail, ok: true }] },
      },
    });
    await tx.skill.update({ where: { id: skillId }, data: { runsCount: { increment: 1 } } });
  }

  // --- Knowledge (12.2) ------------------------------------------------------

  async listSources(tx: TenantClient): Promise<CopilotSourceView[]> {
    const agentId = await this.findAgentId(tx);
    if (!agentId) return [];
    const sources = await tx.knowledgeSource.findMany({
      where: { aiAgentId: agentId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { chunks: true } } },
    });
    return sources.map(serialiseSource);
  }

  async createSource(
    tx: TenantClient,
    tenant: TenantContext,
    principal: Principal,
    input: { type: string; name: string; content: string; sourceUrl: string | null },
  ): Promise<CopilotSourceView> {
    const agentId = await this.ensureAgentId(tx, tenant);
    const source = await tx.knowledgeSource.create({
      data: {
        aiAgentId: agentId,
        licenseId: tenant.licenseId,
        type: input.type,
        name: input.name,
        content: input.content,
        sourceUrl: input.sourceUrl,
        status: 'indexing',
        addedBy: principal.kind === 'agent' ? principal.accountId : null,
        updatedAt: new Date(),
      },
      include: { _count: { select: { chunks: true } } },
    });

    // Indexed in the same transaction: a source that exists but is not
    // searchable looks ready and answers nothing.
    const chunks = await this.knowledge.index(tx, tenant, source.id, input.content);
    return { ...serialiseSource(source), status: chunks > 0 ? 'ready' : 'empty', chunk_count: chunks };
  }

  /**
   * Delete a copilot source. Scoped to the copilot agent, so this route can
   * never remove an AI-agent (customer-facing) source — even given its id.
   */
  async deleteSource(tx: TenantClient, sourceId: string): Promise<number> {
    const agentId = await this.findAgentId(tx);
    if (!agentId) return 0;
    const { count } = await tx.knowledgeSource.deleteMany({
      where: { id: sourceId, aiAgentId: agentId },
    });
    return count;
  }

  // --- Assist (12.3) ---------------------------------------------------------

  /** The chat's messages as plain turns, oldest first, for summary/draft input. */
  async conversationTurns(tx: TenantClient, chatId: string): Promise<ConversationTurn[]> {
    const rows = await tx.event.findMany({
      where: { chatId, type: 'message', text: { not: null } },
      orderBy: { createdAt: 'asc' },
      select: { text: true, authorType: true, recipients: true },
    });
    return rows
      // An internal note is agent-to-agent chatter, not part of the customer
      // conversation Copilot is summarising.
      .filter((row) => row.recipients !== 'agents' && row.text)
      .map((row) => ({
        role: row.authorType === 'customer' ? ('customer' as const) : ('agent' as const),
        text: row.text!,
      }));
  }

  /**
   * A suggested reply, retrieved from the copilot knowledge base using the
   * customer's latest message as the query. Returns an empty draft when there is
   * nothing to answer from, rather than inventing one — the same honesty the
   * customer-facing responder applies (RETRIEVAL_THRESHOLD).
   */
  async draftReply(
    tx: TenantClient,
    tenant: TenantContext,
    chatId: string,
  ): Promise<CopilotDraft> {
    const agentId = await this.findAgentId(tx);
    const turns = await this.conversationTurns(tx, chatId);
    const lastCustomer = [...turns].reverse().find((turn) => turn.role === 'customer');

    if (!agentId || !lastCustomer) {
      return { draft: '', sources: [] };
    }

    const chunks: RetrievedChunk[] = await this.knowledge.retrieve(tx, tenant, lastCustomer.text, {
      aiAgentId: agentId,
      limit: 2,
    });
    if (chunks.length === 0) return { draft: '', sources: [] };

    // Stitch the retrieved passages into a first-person draft the agent edits —
    // Copilot proposes, the human decides and sends.
    const draft = chunks.map((chunk) => chunk.text).join(' ');
    return {
      draft,
      sources: chunks.map((chunk) => ({ name: chunk.sourceName, score: chunk.score })),
    };
  }
}

function serialiseSource(source: {
  id: string;
  name: string;
  type: string;
  status: string;
  sourceUrl: string | null;
  updatedAt: Date;
  _count: { chunks: number };
}): CopilotSourceView {
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    status: source.status,
    source_url: source.sourceUrl,
    chunk_count: source._count.chunks,
    updated_at: source.updatedAt.toISOString(),
  };
}

export { COPILOT_KIND };
