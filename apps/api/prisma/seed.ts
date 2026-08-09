/**
 * Demo seed.
 *
 * Creates **two** organizations, always. Cross-tenant isolation is the property
 * most easily broken without anyone noticing, and a single-tenant dataset makes
 * a total isolation failure look like everything working. A second tenant in
 * every developer's database means a leak shows up as visibly wrong data rather
 * than as nothing at all.
 *
 * Idempotent: re-running against a seeded database is a no-op. Set
 * `NEXA_SEED_RESET=1` to wipe first and lay the fixture down from scratch —
 * see `resetDemoData` for who needs that and why it is opt-in.
 */
import { PrismaClient } from '@prisma/client';
import { embed, toVectorLiteral } from '@nexa/ai-mock';
import { buildEventId, generateShortId } from '@nexa/types';
import { loadEnvFile } from '../src/config/load-env-file.js';
import { hashPassword, hashToken } from '../src/lib/crypto.js';
import { ADMIN_SCOPES } from '../src/services/auth/principal.js';

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
  /**
   * A second brand, turning this into a Multibrand license (PRD §5.3). The
   * fixture the cross-brand e2e (78.8) switches between — a distinct widget
   * colour and website per brand, so a brand switch is visibly a different
   * appearance and site list, and neither brand's data shows under the other.
   */
  secondBrand?: {
    name: string;
    slug: string;
    /** `#rrggbb`, the `widget_settings_color_check` invariant. */
    primaryColor: string;
    websiteDomain: string;
  };
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
    // Northwind carries the two-brand fixture: it is never logged into by the
    // Acme-based specs, so making it Multibrand keeps the single-brand demo
    // (Acme) unchanged while giving the cross-brand e2e a license to switch in.
    secondBrand: {
      name: 'Northwind Europe',
      slug: 'northwind-eu',
      primaryColor: '#e11d48',
      websiteDomain: 'northwind-eu.localhost',
    },
  },
];

/**
 * Four thematically distinct closed-conversation groups for the Chat topics
 * report (FR-MOD-07.6). A single recycled sentence ("Delivery query,
 * resolved.", on every closed thread below) gives the clusterer one vocabulary
 * to work with — the report is stuck showing either one topic or, below
 * `TOPIC_MIN_CONVERSATIONS`, the "not enough data yet" empty state, and
 * neither proves clustering or a full report out in a demo or e2e.
 *
 * The wording was checked against `clusterTopics` directly, not assumed. Chat
 * and thread ids are `generateShortId()` — random, not sequential — and
 * `clusterTopics` sorts by id before clustering, so which doc a greedy leader
 * sees first (and therefore whether a weakly-worded group survives as one
 * cluster) changes on every fresh seed. Checked across 200 randomised id
 * orderings, not one: each group holds together as a single cluster (pairwise
 * cosine mostly 0.4-0.9 within a group) and no pair of groups ever merges
 * (cross-group cosine stays near or under `TOPIC_SIMILARITY_THRESHOLD`, 0.3 —
 * the calibration `07.6-b` documents). Six per group clears
 * `TOPIC_MIN_CLUSTER_SIZE` with room to spare and, all four together, clears
 * `TOPIC_MIN_CONVERSATIONS` on their own, before the two sample conversations
 * above are even counted.
 */
interface TopicGroup {
  key: string;
  customerName: string;
  customerEmail: string;
  countryCode: string;
  country: string;
  agentReply: string;
  texts: string[];
}

const CHAT_TOPIC_GROUPS: TopicGroup[] = [
  {
    key: 'delivery',
    customerName: 'Devon Marsh',
    customerEmail: 'devon',
    countryCode: 'US',
    country: 'United States',
    agentReply: "Thanks for flagging this — I'll check the courier tracking and update you shortly.",
    texts: [
      'My delivery tracking shows in transit and this delivery is running late.',
      'The delivery tracking still shows in transit, this delivery is very late.',
      'My delivery is late, the tracking still shows the parcel in transit.',
      'This delivery tracking has not updated, delivery is late and stuck in transit.',
      'The tracking for my delivery shows in transit but delivery is now late.',
      'My delivery tracking link shows in transit, the delivery is running late again.',
    ],
  },
  {
    key: 'refund',
    customerName: 'Sana Iqbal',
    customerEmail: 'sana',
    countryCode: 'CA',
    country: 'Canada',
    agentReply: "I'm sorry for the delay — I'll confirm your refund status right away.",
    texts: [
      'I want a refund for my return, the money has not come back to my account.',
      'My return refund has not been credited back to my account yet.',
      'This return refund never arrived, the money still has not come back to my account.',
      'I am waiting for my return refund, the money has not been credited back yet.',
      'My refund for this return has not appeared, the money is still missing from my account.',
      'The refund for my return never came back to my account, please credit it.',
    ],
  },
  {
    key: 'billing',
    customerName: 'Owen Baptiste',
    customerEmail: 'owen',
    countryCode: 'NL',
    country: 'Netherlands',
    agentReply: 'Let me pull up your billing statement and get this charge corrected.',
    texts: [
      'My billing statement shows a charge I do not recognise on this invoice.',
      'This billing invoice charged the wrong amount on my statement again.',
      'My billing statement has an invoice charge that does not look right.',
      'The invoice on my billing statement shows a charge I never expected.',
      'This billing charge on my invoice statement does not match what I owe.',
      'My invoice statement shows a billing charge I want explained.',
    ],
  },
  {
    key: 'product',
    customerName: 'Yuki Tanaka',
    customerEmail: 'yuki',
    countryCode: 'JP',
    country: 'Japan',
    agentReply: "I'll check with the warehouse on the restock date for this item.",
    texts: [
      'This item listing shows out of stock, is the product back in stock soon.',
      'The product listing says out of stock, when will this item be in stock again.',
      'This item is out of stock on the listing, do you know the product restock date.',
      'The listing shows this product unavailable, is the item back in stock yet.',
      'This product is out of stock, the item listing has not shown a restock date.',
      'The item listing still shows out of stock, when does this product restock.',
    ],
  },
];

/**
 * The equal-length window immediately before the report's default 30-day range
 * (`resolveRange` in `apps/api/src/routes/reports.ts`). Backdating two of the
 * delivery group's own conversations here — rather than inventing new text —
 * is what was actually checked against `centroidOf`/`similarity`: both
 * reattach to the current window's delivery centroid at cosine 0.53 and 0.61,
 * comfortably over the join threshold, so `previous_volume` and `trend` are a
 * real number rather than the null a topic absent from history gets.
 */
const PREVIOUS_WINDOW_AT = new Date(Date.now() - 45 * 86_400_000);

/**
 * Embeddings come from the shared stub, which derives them from the chunk's
 * *text*.
 *
 * They used to be derived from the chunk's position, which made cosine
 * similarity meaningless — a delivery question was exactly as close to the
 * refunds chunk as to the delivery one. Retrieval only looked like it worked
 * because the demo had a single source.
 */

async function seedTenant(spec: TenantSpec, passwordHash: string): Promise<void> {
  const existing = await prisma.organization.findFirst({
    where: { name: spec.organizationName },
    select: { id: true },
  });
  if (existing) {
    // A workspace seeded before the onboarding flags existed would have a null
    // `onboarding_completed_at`, which reads as "not set up" — so the demo owner
    // would land on the first-run wizard. Backfill it so the demo tenant, which
    // already ships with full data, never sees the wizard (FR-MOD-00.4).
    await prisma.license.updateMany({
      where: { organizationId: existing.id, onboardingCompletedAt: null },
      data: { onboardingCompletedAt: new Date(), demoSeededAt: new Date() },
    });
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
      // The demo tenants already ship with full data, so they must never open on
      // the first-run wizard (FR-MOD-00.4) — that gate is for empty workspaces a
      // real signup creates. Marked complete and seeded from the start.
      onboardingCompletedAt: new Date(),
      demoSeededAt: new Date(),
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

  // --- Agent expertise (skill-based routing — FR-MOD-08.6.3) ----------------

  // A small catalogue of expertise areas, plus a few agent↔expertise links so
  // the join is not empty in the demo. Deterministic (fixed slugs, sequential
  // creates); the whole tenant seed is idempotent through the org existence
  // check above, so re-running never adds a fourth area.
  const expertiseAreas: Array<{ id: bigint }> = [];
  for (const area of [
    { name: 'Billing', slug: 'billing' },
    { name: 'Technical support', slug: 'technical-support' },
    { name: 'Onboarding', slug: 'onboarding' },
  ]) {
    const created = await prisma.expertise.create({
      data: { licenseId, name: area.name, slug: area.slug },
      select: { id: true },
    });
    expertiseAreas.push(created);
  }

  await prisma.agentExpertise.create({
    data: { licenseId, agentId: owner.id, expertiseId: expertiseAreas[0]!.id },
  });
  for (const [index, agent] of agents.entries()) {
    const area = expertiseAreas[(index + 1) % expertiseAreas.length]!;
    await prisma.agentExpertise.create({
      data: { licenseId, agentId: agent.id, expertiseId: area.id },
    });
  }

  // --- Channels, website, widget --------------------------------------------

  // The license's default brand — the same row the migration backfill lays down
  // for existing licenses. Keeps single-brand behaviour intact (PRD §5.3).
  // Created first: a channel now belongs to a brand (brand_id is NOT NULL).
  const defaultBrand = await prisma.brand.create({
    data: { licenseId, name: 'Default', slug: 'default', isDefault: true },
    select: { id: true },
  });
  await prisma.channel.create({
    data: {
      licenseId,
      brandId: defaultBrand.id,
      type: 'website_widget',
      status: 'connected',
      config: {},
    },
  });
  await prisma.website.create({
    data: {
      licenseId,
      brandId: defaultBrand.id,
      domain: spec.widgetDomain,
      status: 'connected',
      setup: 'manual',
      connectedAt: new Date(),
      createdBy: owner.id,
    },
  });

  // A second brand (PRD §5.3), if the spec calls for one — the Multibrand
  // fixture the cross-brand e2e (78.8) exercises. Each brand gets its own widget
  // colour and website so a switch is visibly distinct and isolation is provable
  // through the UI.
  if (spec.secondBrand) {
    // An explicit colour on the default brand too, so the contrast is concrete
    // rather than resting on the shipped fallback.
    await prisma.widgetSettings.create({
      data: { licenseId, brandId: defaultBrand.id, primaryColor: '#2f6bff' },
    });

    const secondBrand = await prisma.brand.create({
      data: { licenseId, name: spec.secondBrand.name, slug: spec.secondBrand.slug },
      select: { id: true },
    });
    await prisma.widgetSettings.create({
      data: { licenseId, brandId: secondBrand.id, primaryColor: spec.secondBrand.primaryColor },
    });
    await prisma.website.create({
      data: {
        licenseId,
        brandId: secondBrand.id,
        domain: spec.secondBrand.websiteDomain,
        status: 'connected',
        setup: 'manual',
        connectedAt: new Date(),
        createdBy: owner.id,
      },
    });
  }

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
    data: { licenseId, brandId: defaultBrand.id, fileSharingEnabled: true, spamFilterEnabled: true },
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

  // Copilot is a second AI surface with its own, agent-only knowledge base
  // (FR-MOD-12.2) — internal guidance a customer never sees. Seeded with a
  // playbook so "Draft a reply" has something to answer from in the demo.
  const copilotAgent = await prisma.aiAgent.create({
    data: { licenseId, kind: 'copilot', name: 'Copilot', active: true },
    select: { id: true },
  });

  const copilotSource = await prisma.knowledgeSource.create({
    data: {
      aiAgentId: copilotAgent.id,
      licenseId,
      type: 'article',
      name: 'Agent playbook',
      status: 'ready',
      addedBy: owner.id,
      content: 'Internal escalation and refund guidance for agents.',
    },
    select: { id: true },
  });

  const copilotChunks = [
    'A refund over five hundred dollars must be approved by a manager before it is promised.',
    'Escalate an angry or threatening customer to the duty lead rather than handling it alone.',
    'Always confirm the order number before giving a delivery date.',
  ];
  for (const [index, text] of copilotChunks.entries()) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, embedding, token_count, position)
       VALUES (gen_random_uuid(), $1::uuid, $2::bigint, $3, $4::vector, $5, $6)`,
      copilotSource.id,
      licenseId.toString(),
      text,
      toVectorLiteral(embed(text)),
      Math.ceil(text.length / 4),
      index,
    );
  }

  await prisma.skill.create({
    data: {
      licenseId,
      aiAgentId: aiAgent.id,
      name: 'Where is my order',
      kind: 'ai_agent',
      instruction:
        'When a customer asks about a delivery, collect the order number, summarise, and hand over if it is late by more than a week.',
      steps: [
        {
          type: 'detect_intent',
          intent: 'order_status',
          phrases: ['order status', 'where is my order', 'delivery', 'shipping', 'kargo nerede'],
        },
        { type: 'request_info', field: 'order_number', prompt: 'What is your order number?' },
        { type: 'tag', tag: 'shipping' },
        { type: 'summarize' },
        { type: 'send_message', source: 'knowledge' },
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
      toVectorLiteral(embed(text)),
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
    await seedChatTopics({
      licenseId,
      organizationId: organization.id,
      slug: spec.slug,
      agentId: agents[0]!.id,
      groupId: supportTeam.id,
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
      // The owner's own scope set, not a copy of it. A hand-maintained list
      // here drifts the moment a module adds a scope, and the symptom is that
      // the demo owner cannot open the feature that was just built — which is
      // exactly what happened when Playbook and then tickets landed.
      scopes: [...ADMIN_SCOPES],
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

/**
 * Closed conversations across `CHAT_TOPIC_GROUPS`, so the Chat topics report
 * (FR-MOD-07.6) has more than the one recycled sentence above to cluster — see
 * that constant for why the wording is what it is. One dedicated customer per
 * group (mirroring `seedConversations`'s pattern, not reusing Robin/Alex/Mira)
 * keeps their `chats_count` — which the customer directory reads live, not
 * from a stored column — exactly what it was before this task.
 */
async function seedChatTopics(input: {
  licenseId: bigint;
  organizationId: string;
  slug: string;
  agentId: string;
  groupId: bigint;
}): Promise<void> {
  const { licenseId, organizationId, slug, agentId, groupId } = input;

  for (const group of CHAT_TOPIC_GROUPS) {
    const customer = await prisma.customer.create({
      data: {
        organizationId,
        name: group.customerName,
        email: `${group.customerEmail}@${slug}-customer.localhost`,
        countryCode: group.countryCode,
        country: group.country,
        lastActivityAt: new Date(),
      },
      select: { id: true },
    });

    for (const text of group.texts) {
      await createConversation({
        licenseId,
        customerId: customer.id,
        groupId,
        agentId,
        active: false,
        summary: text,
        messages: [
          { authorType: 'customer', text },
          { authorType: 'agent', text: group.agentReply },
        ],
      });
    }

    // The delivery group also gets two of its own conversations backdated into
    // the previous window (see `PREVIOUS_WINDOW_AT`), so at least one topic's
    // trend is a real number in the demo rather than every topic reading null.
    if (group.key === 'delivery') {
      for (const text of group.texts.slice(0, 2)) {
        await createConversation({
          licenseId,
          customerId: customer.id,
          groupId,
          agentId,
          active: false,
          summary: text,
          at: PREVIOUS_WINDOW_AT,
          messages: [
            { authorType: 'customer', text },
            { authorType: 'agent', text: group.agentReply },
          ],
        });
      }
    }
  }
}

async function createConversation(input: {
  licenseId: bigint;
  customerId: string;
  groupId: bigint;
  agentId: string | null;
  active: boolean;
  messages: Array<{ authorType: string; text: string; recipients?: string }>;
  /** Closed-thread summary the Chat topics clusterer reads (07.6-d). Defaults to the original placeholder so the one pre-existing call site is untouched. */
  summary?: string;
  /** Backdates the conversation — the previous-window half of the topics demo. */
  at?: Date;
}): Promise<{ chatId: string; threadId: string }> {
  const { licenseId, customerId, groupId, agentId, active, messages, summary, at } = input;
  const chatId = generateShortId();
  const threadId = generateShortId();
  const startedAt = at ?? new Date(Date.now() - messages.length * 120_000);

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
      ...(active
        ? {}
        : {
            closedAt: at ? new Date(at.getTime() + messages.length * 120_000) : new Date(),
            summary: summary ?? 'Delivery query, resolved.',
          }),
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

/**
 * Whether the caller asked for a wipe before seeding.
 *
 * An unrecognised value throws rather than reading as "no". Silently doing
 * nothing is precisely the failure mode this whole flag exists to remove, and a
 * caller who typed `NEXA_SEED_RESET=yes` would get the accumulating database
 * back with no hint of why.
 */
function resetRequested(): boolean {
  const raw = process.env['NEXA_SEED_RESET'];
  if (raw === undefined || raw === '') return false;
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  throw new Error(`NEXA_SEED_RESET must be one of 1/0/true/false, got "${raw}"`);
}

/**
 * Wipe every tenant table so the seed below builds the fixture from scratch.
 *
 * Opt-in, never the default. `pnpm db:seed` is what a developer runs against
 * their own workspace, and deleting their data unasked would be a worse defect
 * than the one this fixes.
 *
 * The e2e suite is the caller that needs it. Its global setup ran the plain
 * seed and promised "every run starts from the same fixture" — but the seed is
 * idempotent, so a second run *added to* the first instead of replacing it.
 * Every widget spec mints a customer token with no stored id, so each run left
 * another anonymous visitor behind; the customer directory orders by
 * `last_activity_at DESC`, and after a few runs the seeded Robin/Alex/Mira were
 * no longer on the first page. `customers.spec.ts` and `command-palette.spec.ts`
 * failed against a product with nothing wrong with it (tm 109).
 *
 * Truncation, not `migrate reset` — the schema and the database itself stay put
 * (MASTER-PROMPT forbids dropping either), and this is the same wipe the
 * integration suite already performs against this database before every file.
 *
 * The table list is discovered from the catalogue rather than hard-coded,
 * matching `test/helpers/fixtures.ts`: a literal list goes stale the moment a
 * slice adds a table, and the residue left behind is exactly the order-dependent
 * failure this is here to prevent. Partitions are truncated through their
 * parent; Prisma's own migration bookkeeping is left alone.
 */
async function resetDemoData(): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
      -- Partitions are truncated through their parent.
      AND tablename NOT LIKE 'events\\_%'
  `;
  if (tables.length === 0) return;

  const quoted = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
  console.log(`  truncated ${tables.length} tables`);
}

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('The demo seed must never run against production.');
  }

  const reset = resetRequested();

  // Hash once: scrypt is deliberately slow, and every demo account shares the
  // same password anyway.
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  if (reset) {
    console.log('resetting demo data (NEXA_SEED_RESET)');
    await resetDemoData();
  }

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
