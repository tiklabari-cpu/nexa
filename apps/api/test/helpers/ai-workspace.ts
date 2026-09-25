/**
 * A workspace a customer can put a question to the AI in, for the suites that
 * drive the AI through the real server (tm 255.9).
 *
 * One AI agent, one knowledge passage stored in whichever embedding space the
 * server under test searches, one active knowledge skill, and a trusted domain
 * the widget can mint a customer token for. What `llm-openai-adapter.test.ts`
 * (tm 255.6) builds inline, gathered so a second and third suite do not copy
 * it again.
 */
import type { PrismaClient } from '@prisma/client';
import { LEXICAL_EMBEDDING_SPACE, embed, toVectorLiteral } from '@siyahtus/ai-mock';
import { expect } from 'vitest';
import { grantToken } from './fixtures.js';
import type { TestServer } from './server.js';

export const AI_PASSAGE =
  'Standard delivery takes 3 to 5 working days across the EU, tracked by Q7-courier.';
export const AI_QUESTION = 'How long does delivery take for parcel QX-44917?';

export interface AiWorkspace {
  organizationId: string;
  licenseId: bigint;
  ownerId: string;
  trustedDomain: string;
  aiAgentId: string;
  skillId: string;
}

let seq = 0;

export async function seedAiWorkspace(
  owner: PrismaClient,
  options: {
    /** The space the passage's vector is filed under — the server's embedding provider's. */
    embeddingSpace?: string;
    passage?: string;
  } = {},
): Promise<AiWorkspace> {
  seq += 1;
  const slug = `aiws${seq}-${Date.now()}`;
  const passage = options.passage ?? AI_PASSAGE;
  const organization = await owner.organization.create({
    data: { name: `Org ${slug}`, region: 'eu' },
    select: { id: true },
  });
  const license = await owner.license.create({
    data: { organizationId: organization.id, plan: 'growth', status: 'active' },
    select: { id: true },
  });
  const account = await owner.account.create({
    data: { email: `owner-${slug}@example.test`, name: `Owner ${slug}` },
    select: { id: true },
  });
  await owner.agentMembership.create({
    data: { licenseId: license.id, agentId: account.id, role: 'owner' },
  });
  const trustedDomain = `shop-${slug}.example.test`;
  await owner.trustedDomain.create({
    data: {
      organizationId: organization.id,
      licenseId: license.id,
      domain: trustedDomain,
      includeSubdomains: true,
    },
  });
  const aiAgent = await owner.aiAgent.create({
    data: {
      licenseId: license.id,
      kind: 'ai_agent',
      name: 'Ada',
      active: true,
      tone: 'formal',
      languages: ['en'],
    },
    select: { id: true },
  });
  const source = await owner.knowledgeSource.create({
    data: {
      aiAgentId: aiAgent.id,
      licenseId: license.id,
      type: 'article',
      name: 'Delivery',
      status: 'ready',
      updatedAt: new Date(),
    },
    select: { id: true },
  });
  // The lexical vector in every case: the fake OpenAI embedder answers with
  // `embed()` too (`openAiEmbeddings(embed)`), so only the space label differs.
  await owner.$executeRawUnsafe(
    `INSERT INTO knowledge_chunks
       (id, source_id, license_id, chunk_text, embedding, token_count, position, embedding_space)
     VALUES (gen_random_uuid(), $1::uuid, $2::bigint, $3, $4::vector, 10, 0, $5)`,
    source.id,
    license.id.toString(),
    passage,
    toVectorLiteral(embed(passage)),
    options.embeddingSpace ?? LEXICAL_EMBEDDING_SPACE,
  );
  const skill = await owner.skill.create({
    data: {
      licenseId: license.id,
      aiAgentId: aiAgent.id,
      name: 'Delivery',
      kind: 'ai_agent',
      steps: [
        { type: 'detect_intent', intent: 'delivery', phrases: ['delivery'] },
        { type: 'send_message', source: 'knowledge' },
      ],
      active: true,
      updatedAt: new Date(),
    },
    select: { id: true },
  });
  return {
    organizationId: organization.id,
    licenseId: license.id,
    ownerId: account.id,
    trustedDomain,
    aiAgentId: aiAgent.id,
    skillId: skill.id,
  };
}

/**
 * A console credential for reading the workspace's reports. OAuth, not a PAT:
 * a PAT request is a billed API call (`plugins/metering.ts`) and would write a
 * `usage_records` row of its own into a suite that counts them.
 */
export function reportReader(owner: PrismaClient, ws: AiWorkspace): Promise<string> {
  return grantToken(owner, {
    licenseId: ws.licenseId,
    organizationId: ws.organizationId,
    ownerId: ws.ownerId,
    scopes: ['reports_read'],
    kind: 'oauth',
  });
}

/** A visitor writes in through the widget; returns their token, the chat and its stored events. */
export async function customerAsks(
  owner: PrismaClient,
  server: TestServer,
  ws: AiWorkspace,
  text = AI_QUESTION,
) {
  const minted = await server.post(
    '/customer/token',
    { organization_id: ws.organizationId },
    { origin: `https://${ws.trustedDomain}` },
  );
  expect(minted.statusCode).toBe(200);
  const { token } = minted.json() as { token: string };
  const sent = await server.post(
    '/customer/chat/events',
    { text },
    { authorization: `Bearer ${token}` },
  );
  expect(sent.statusCode).toBe(201);
  const chatId = (sent.json() as { chat_id: string }).chat_id;
  const events = await owner.event.findMany({
    where: { chatId },
    orderBy: { createdAt: 'asc' },
    select: { text: true, authorType: true },
  });
  return { customerToken: token, chatId, events };
}

export interface RecordedSkillRun {
  status: string;
  log: { outcome: string; entries: Array<{ step: string; detail: string; ok: boolean }> };
  llmInputTokens: number;
  llmOutputTokens: number;
  embeddingTokens: number;
}

/** The run the skill engine wrote for this chat. */
export async function runFor(owner: PrismaClient, chatId: string): Promise<RecordedSkillRun> {
  const run = await owner.skillRun.findFirst({ where: { chatId }, orderBy: { ranAt: 'desc' } });
  expect(run).not.toBeNull();
  return run as unknown as RecordedSkillRun;
}

/** Every line a server wrote, so a test can say what never appeared. */
export class LineSink {
  readonly lines: string[] = [];
  write(chunk: string): boolean {
    this.lines.push(chunk);
    return true;
  }
  end(): void {}
  on(): void {}
  once(): void {}
  emit(): boolean {
    return false;
  }
  get text(): string {
    return this.lines.join('\n');
  }
  entries(): Array<Record<string, unknown>> {
    return this.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  }
  events(name: string): Array<Record<string, unknown>> {
    return this.entries().filter((entry) => entry['event'] === name);
  }
  withMessage(message: string): Array<Record<string, unknown>> {
    return this.entries().filter((entry) => entry['msg'] === message);
  }
}
