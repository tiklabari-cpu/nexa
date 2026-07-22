/**
 * Demo seed.
 *
 * Creates **two** organizations, always. Cross-tenant isolation is the property
 * most easily broken without anyone noticing, and a single-tenant dataset makes
 * a total isolation failure look like everything working. A second tenant in
 * every developer's database means a leak shows up as visibly wrong data rather
 * than as nothing at all.
 *
 * Idempotent: re-running against a seeded database is a no-op.
 */
import { PrismaClient } from '@prisma/client';
import { buildEventId, generateShortId } from '@nexa/types';
import { loadEnvFile } from '../src/config/load-env-file.js';
import { hashPassword, hashToken } from '../src/lib/crypto.js';

loadEnvFile();

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'nexa-demo-password';

interface AgentSpec {
  name: string;
  role: 'admin' | 'agent';
  priority: 'primary' | 'first' | 'normal' | 'last';
}

interface TenantSpec {
  slug: string;
  organizationName: string;
  ownerName: string;
  agents: AgentSpec[];
  widgetDomain: string;
  teams: string[];
  /** Whether to build a full sample conversation. */
  richDemo: boolean;
}

const TENANTS: TenantSpec[] = [
  {
    slug: 'acme',
    organizationName: 'Acme Bikes',
    ownerName: 'Dana Okonkwo',
    agents: [
      { name: 'Sam Rivera', role: 'admin', priority: 'primary' },
      { name: 'Priya Nair', role: 'agent', priority: 'normal' },
    ],
    widgetDomain: 'acme-bikes.localhost',
    teams: ['Support', 'Sales'],
    richDemo: true,
  },
  {
    // Exists so isolation failures are visible, not to be logged into.
    slug: 'northwind',
    organizationName: 'Northwind Supply',
    ownerName: 'Lee Whitfield',
    agents: [{ name: 'Jordan Ames', role: 'agent', priority: 'normal' }],
    widgetDomain: 'northwind-supply.localhost',
    teams: ['Support'],
    richDemo: false,
  },
];

/** Deterministic pseudo-embedding so retrieval demos are reproducible. */
function fakeEmbedding(seed: number): string {
  const values = Array.from({ length: 1536 }, (_, i) => {
    const x = Math.sin((i + 1) * (seed + 1)) * 0.5;
    return Number(x.toFixed(6));
  });
  return `[${values.join(',')}]`;
}

async function seedTenant(spec: TenantSpec, passwordHash: string): Promise<void> {
  const existing = await prisma.organization.findFirst({
    where: { name: spec.organizationName },
    select: { id: true },
  });
  if (existing) {
    console.log(`  ${spec.organizationName}: already present, skipping`);
    return;
  }

  const organization = await prisma.organization.create({
    data: { name: spec.organizationName, region: 'eu' },
    select: { id: true },
  });

  const trialEndsAt = new Date(Date.now() + 14 * 86_400_000);
  const license = await prisma.license.create({
    data: {
      organizationId: organization.id,
      plan: 'growth',
      billingCycle: 'monthly',
      status: 'trialing',
      trialEndsAt,
    },
    select: { id: true },
  });
  const licenseId = license.id;

  // --- People ---------------------------------------------------------------

  const owner = await prisma.account.create({
    data: { email: `owner@${spec.slug}.localhost`, name: spec.ownerName, passwordHash },
    select: { id: true, email: true },
  });
  await prisma.agentMembership.create({
    data: {
      licenseId,
      agentId: owner.id,
      role: 'owner',
      routingStatus: 'accepting_chats',
      concurrentChatsLimit: 6,
    },
  });

  const agents: Array<{ id: string; spec: AgentSpec }> = [];
  for (const [index, agentSpec] of spec.agents.entries()) {
    const account = await prisma.account.create({
      data: {
        email: `agent${index + 1}@${spec.slug}.localhost`,
        name: agentSpec.name,
        passwordHash,
      },
      select: { id: true },
    });
    await prisma.agentMembership.create({
      data: {
        licenseId,
        agentId: account.id,
        role: agentSpec.role,
        routingStatus: 'accepting_chats',
        concurrentChatsLimit: 6,
      },
    });
    agents.push({ id: account.id, spec: agentSpec });
  }

  // --- Teams and routing ----------------------------------------------------

  const teams: Array<{ id: bigint; name: string }> = [];
  for (const name of spec.teams) {
    const group = await prisma.group.create({
      data: { licenseId, name, languageCode: 'en' },
      select: { id: true, name: true },
    });
    teams.push(group);
  }
  const supportTeam = teams[0]!;

  await prisma.groupAgent.create({
    data: { licenseId, groupId: supportTeam.id, agentId: owner.id, priority: 'last' },
  });
  for (const agent of agents) {
    await prisma.groupAgent.create({
      data: {
        licenseId,
        groupId: supportTeam.id,
        agentId: agent.id,
        priority: agent.spec.priority,
      },
    });
  }

  await prisma.routingRule.create({
    data: {
      licenseId,
      name: 'Everything else',
      kind: 'chat',
      isFallback: true,
      targetGroupId: supportTeam.id,
      priority: 1000,
    },
  });

  if (teams.length > 1) {
    const salesTeam = teams[1]!;
    await prisma.routingRule.create({
      data: {
        licenseId,
        name: 'Pricing pages go to Sales',
        kind: 'chat',
        conditions: { url_contains: ['/pricing', '/plans'] },
        targetGroupId: salesTeam.id,
        priority: 10,
      },
    });

    // Sales needs a member, or the rule is dead weight: routing falls through
    // to the fallback team when nobody in the matched one can take the chat,
    // which is correct but makes the rule look broken in a demo.
    await prisma.groupAgent.create({
      data: {
        licenseId,
        groupId: salesTeam.id,
        agentId: owner.id,
        priority: 'normal',
      },
    });
  }

  // --- Channels, website, widget --------------------------------------------

  await prisma.channel.create({
    data: { licenseId, type: 'website_widget', status: 'connected', config: {} },
  });
  await prisma.website.create({
    data: {
      licenseId,
      domain: spec.widgetDomain,
      status: 'connected',
      setup: 'manual',
      connectedAt: new Date(),
      createdBy: owner.id,
    },
  });
  await prisma.trustedDomain.create({
    data: {
      organizationId: organization.id,
      licenseId,
      domain: spec.widgetDomain,
      includeSubdomains: true,
    },
  });

  // --- Agent productivity ---------------------------------------------------

  const tags = await Promise.all(
    ['billing', 'shipping', 'bug', 'lead'].map((name) =>
      prisma.tag.create({
        data: { licenseId, name, authorId: owner.id },
        select: { id: true, name: true },
      }),
    ),
  );

  await prisma.cannedResponse.createMany({
    data: [
      {
        licenseId,
        scope: 'chat',
        shortcut: 'hello',
        text: 'Hi there! How can I help you today?',
        updatedBy: owner.id,
      },
      {
        licenseId,
        scope: 'chat',
        shortcut: 'shipping',
        text: 'Standard delivery takes 3-5 working days. I can check your order if you share the number.',
        updatedBy: owner.id,
      },
      {
        licenseId,
        scope: 'chat',
        shortcut: 'thanks',
        text: 'Thanks for your patience — anything else I can help with?',
        updatedBy: owner.id,
      },
    ],
  });

  await prisma.securitySettings.create({
    data: { licenseId, fileSharingEnabled: true, spamFilterEnabled: true },
  });

  // --- Billing --------------------------------------------------------------

  await prisma.subscription.create({
    data: {
      licenseId,
      plan: 'growth',
      seats: spec.agents.length + 1,
      unitPriceCents: 9900,
      aiResolutionsIncluded: 200,
      status: 'trialing',
      trialEndsAt,
      currentPeriodEnd: trialEndsAt,
    },
  });

  const period = new Date().toISOString().slice(0, 7).replace('-', '');
  await prisma.usageRecord.createMany({
    data: [
      {
        licenseId,
        metric: 'ai_resolutions',
        period,
        quantity: spec.richDemo ? 12n : 0n,
        included: 200n,
        overageUnit: 50,
        overageUnitPriceCents: 50,
      },
      {
        licenseId,
        metric: 'api_calls',
        period,
        quantity: spec.richDemo ? 4_812n : 0n,
        included: 100_000n,
        overageUnit: 100_000,
        overageUnitPriceCents: 2_950,
      },
    ],
  });

  // --- AI -------------------------------------------------------------------

  const aiAgent = await prisma.aiAgent.create({
    data: {
      licenseId,
      kind: 'ai_agent',
      name: 'Ada',
      tone: 'friendly',
      languages: ['en'],
      instruction:
        'Answer questions about orders, delivery and returns. Hand over to a human for refunds above 100.',
      active: spec.richDemo,
      persona: { answerLength: 'short', signature: '— Ada, Acme assistant' },
    },
    select: { id: true },
  });

  await prisma.aiAgent.create({
    data: { licenseId, kind: 'copilot', name: 'Copilot', active: true },
  });

  await prisma.skill.create({
    data: {
      licenseId,
      aiAgentId: aiAgent.id,
      name: 'Where is my order',
      kind: 'ai_agent',
      instruction:
        'When a customer asks about a delivery, collect the order number, summarise, and hand over if it is late by more than a week.',
      steps: [
        { type: 'detect_intent', intent: 'order_status' },
        { type: 'request_info', field: 'order_number', prompt: 'What is your order number?' },
        { type: 'tag', tag: 'shipping' },
        { type: 'summarize' },
        { type: 'send_message', template: 'order_status_reply' },
        { type: 'transfer_to_team', condition: 'late_over_7_days', group: supportTeam.name },
      ],
      trigger: { on: 'customer_message' },
      active: spec.richDemo,
      createdBy: owner.id,
    },
  });

  const knowledgeSource = await prisma.knowledgeSource.create({
    data: {
      aiAgentId: aiAgent.id,
      licenseId,
      type: 'article',
      name: 'Delivery and returns',
      status: 'ready',
      addedBy: owner.id,
      content: 'Standard delivery 3-5 working days. Returns accepted within 30 days, unused.',
    },
    select: { id: true },
  });

  const chunks = [
    'Standard delivery takes 3 to 5 working days across the EU.',
    'Returns are accepted within 30 days if the item is unused and in its original packaging.',
    'Refunds are issued to the original payment method within 5 working days of receipt.',
  ];
  for (const [index, text] of chunks.entries()) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, embedding, token_count, position)
       VALUES (gen_random_uuid(), $1::uuid, $2::bigint, $3, $4::vector, $5, $6)`,
      knowledgeSource.id,
      licenseId.toString(),
      text,
      fakeEmbedding(index),
      Math.ceil(text.length / 4),
      index,
    );
  }

  // --- Customers ------------------------------------------------------------

  const customers = await Promise.all(
    [
      { name: 'Robin Fields', email: 'robin', countryCode: 'GB', country: 'United Kingdom' },
      { name: 'Alex Moreau', email: 'alex', countryCode: 'FR', country: 'France', isLead: true },
      { name: 'Mira Haddad', email: 'mira', countryCode: 'DE', country: 'Germany' },
    ].map((c, index) =>
      prisma.customer.create({
        data: {
          organizationId: organization.id,
          name: c.name,
          email: `${c.email}@${spec.slug}-customer.localhost`,
          countryCode: c.countryCode,
          country: c.country,
          isLead: c.isLead ?? false,
          lastActivityAt: new Date(Date.now() - index * 3_600_000),
        },
        select: { id: true, name: true },
      }),
    ),
  );

  // --- Sample conversations -------------------------------------------------

  if (spec.richDemo) {
    await seedConversations({
      licenseId,
      customers,
      agentId: agents[0]!.id,
      groupId: supportTeam.id,
      shippingTagId: tags.find((t) => t.name === 'shipping')!.id,
    });
  }

  const demoToken = `nexa_pat_demo_${spec.slug}`;
  await prisma.apiToken.create({
    data: {
      licenseId,
      organizationId: organization.id,
      ownerId: owner.id,
      kind: 'pat',
      tokenHash: hashToken(demoToken),
      name: 'Demo token (seed)',
      scopes: [
        'accounts--my:rw',
        'agents--all:rw',
        'chats--all:rw',
        'customers:rw',
        'groups--all:rw',
        'tags--all:rw',
        'canned_responses--all:rw',
        'reports_read',
      ],
    },
  });

  await prisma.oauthClient.create({
    data: {
      id: `nexa-agent-app-${spec.slug}`,
      organizationId: organization.id,
      displayName: 'Nexa Agent App',
      // Public client: OAuth 2.1 relies on PKCE rather than a secret for
      // anything running in a browser, where no secret stays secret.
      clientType: 'public',
      redirectUris: ['http://localhost:5173/auth/callback'],
      scopes: [],
    },
  });

  console.log(`  ${spec.organizationName}`);
  console.log(`    license      ${licenseId}`);
  console.log(`    owner        ${owner.email} / ${DEMO_PASSWORD}`);
  console.log(`    client_id    nexa-agent-app-${spec.slug}`);
  console.log(`    widget host  ${spec.widgetDomain}`);
  console.log(`    demo token   ${demoToken}`);
}

/**
 * One archived conversation and one live one, so the inbox has something to
 * show and the archive view is not empty on first run.
 */
async function seedConversations(input: {
  licenseId: bigint;
  customers: Array<{ id: string }>;
  agentId: string;
  groupId: bigint;
  shippingTagId: string;
}): Promise<void> {
  const { licenseId, customers, agentId, groupId, shippingTagId } = input;

  const closed = await createConversation({
    licenseId,
    customerId: customers[0]!.id,
    groupId,
    agentId,
    active: false,
    messages: [
      { authorType: 'customer', text: 'Hi — my order NX-8814 has not arrived yet.' },
      { authorType: 'bot', text: 'Let me check that for you. One moment.' },
      { authorType: 'agent', text: 'Thanks for waiting — it is out for delivery today.' },
      { authorType: 'agent', text: 'Customer verified via order number.', recipients: 'agents' },
      { authorType: 'customer', text: 'Perfect, thank you!' },
    ],
  });

  await prisma.threadTag.create({
    data: { threadId: closed.threadId, tagId: shippingTagId },
  });
  await prisma.rating.create({
    data: { chatId: closed.chatId, licenseId, threadId: closed.threadId, value: 'good' },
  });

  // A live conversation waiting for a reply, so the inbox is not empty either.
  await createConversation({
    licenseId,
    customerId: customers[1]!.id,
    groupId,
    agentId: null,
    active: true,
    messages: [
      { authorType: 'customer', text: 'Do you ship to France?' },
      { authorType: 'customer', text: 'And how long does it take?' },
    ],
  });
}

async function createConversation(input: {
  licenseId: bigint;
  customerId: string;
  groupId: bigint;
  agentId: string | null;
  active: boolean;
  messages: Array<{ authorType: string; text: string; recipients?: string }>;
}): Promise<{ chatId: string; threadId: string }> {
  const { licenseId, customerId, groupId, agentId, active, messages } = input;
  const chatId = generateShortId();
  const threadId = generateShortId();
  const startedAt = new Date(Date.now() - messages.length * 120_000);

  await prisma.chat.create({
    data: { id: chatId, licenseId, customerId, active, createdAt: startedAt },
  });
  await prisma.chatAccess.create({ data: { chatId, groupId } });
  await prisma.chatUser.create({
    data: { chatId, userId: customerId, userType: 'customer', present: active },
  });
  if (agentId) {
    await prisma.chatUser.create({
      data: { chatId, userId: agentId, userType: 'agent', present: active },
    });
  }

  const firstAgentReply = messages.findIndex((m) => m.authorType === 'agent');
  await prisma.thread.create({
    data: {
      id: threadId,
      chatId,
      licenseId,
      active,
      assigneeId: agentId,
      createdAt: startedAt,
      eventSequence: messages.length,
      ...(active ? {} : { closedAt: new Date(), summary: 'Delivery query, resolved.' }),
      ...(firstAgentReply >= 0
        ? { firstResponseAt: new Date(startedAt.getTime() + firstAgentReply * 120_000) }
        : {}),
      ...(active && !agentId ? { queuePosition: 1, queuedAt: startedAt } : {}),
    },
  });

  for (const [index, message] of messages.entries()) {
    await prisma.event.create({
      data: {
        id: buildEventId(threadId, index + 1),
        threadId,
        chatId,
        licenseId,
        type: 'message',
        text: message.text,
        authorId: message.authorType === 'customer' ? customerId : agentId,
        authorType: message.authorType,
        recipients: message.recipients ?? 'all',
        createdAt: new Date(startedAt.getTime() + index * 120_000),
      },
    });
  }

  return { chatId, threadId };
}

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('The demo seed must never run against production.');
  }

  // Hash once: scrypt is deliberately slow, and every demo account shares the
  // same password anyway.
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  console.log('seeding demo data');
  for (const spec of TENANTS) {
    await seedTenant(spec, passwordHash);
  }

  console.log('');
  console.log('  ⚠  Seed credentials are public and identical on every machine.');
  console.log('     They exist for local development only.');
}

main()
  .catch((error: unknown) => {
    console.error('seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
