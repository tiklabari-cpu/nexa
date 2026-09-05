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
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { embed, toVectorLiteral } from '@nexa/ai-mock';
import { buildEventId, generateShortId, MOBILE_REDIRECT_URI } from '@nexa/types';
import { loadEnvFile } from '../src/config/load-env-file.js';
import { hashPassword, hashToken } from '../src/lib/crypto.js';
import { type AuditContext } from '../src/services/audit/audit-log.js';
import { ADMIN_SCOPES, type AgentPrincipal } from '../src/services/auth/principal.js';
import { CampaignService } from '../src/services/campaigns/campaign-service.js';
import { GoalService } from '../src/services/goals/goal-service.js';
import { ScheduledReportService } from '../src/services/reports/scheduled-report-service.js';
import { saveSlaPolicy } from '../src/services/sla/sla-service.js';
import { type CreateInput, TicketService } from '../src/services/tickets/ticket-service.js';
import { WebhookService } from '../src/services/webhooks/webhook-service.js';

loadEnvFile();

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'nexa-demo-password';

interface AgentSpec {
  name: string;
  role: 'admin' | 'agent';
  priority: 'primary' | 'first' | 'normal' | 'last';
}

/**
 * The sales tracker fixture for one tenant (FR-MOD-13.5).
 *
 * Both tenants get one, with *different* currencies and different figures, for
 * the same reason there are two tenants at all: an isolation failure then shows
 * up as a wrong number (or a report denominated in someone else's currency)
 * rather than as nothing at all.
 */
interface SalesTrackerSpec {
  /** ISO 4217, and one of `SALES_TRACKER_CURRENCIES` — the ingest endpoint refuses anything else. */
  currency: string;
  attributionWindowDays: number;
  /**
   * Orders credited to a seeded conversation, in minor units. These are the
   * only ones the Reviews report's Ecommerce block counts (`trackedSalesSummary`
   * filters on `attributed`), so this list *is* the demo's tracked-sales figure.
   * Empty for a tenant with no seeded conversations — there is nothing to
   * attribute to, and inventing a credit would be the one dishonest number in
   * an otherwise measured fixture.
   */
  attributedCents: number[];
  /**
   * Orders no conversation can be credited with: recorded, reported back to the
   * widget, and deliberately absent from attributed revenue. Their presence is
   * what makes the report's `attributed = true` filter visible in the demo —
   * without them, "count every row" and "count the credited rows" would give
   * the same answer and neither could be wrong.
   */
  unattributedCents: number[];
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
   * The commercial tier, and therefore what the workspace is entitled to
   * (FR-MOD-11.5 · `services/billing/subscription-service.ts`).
   *
   * Both demo tenants are Enterprise, because the demo's job is to make every
   * screen reachable and several of them — SSO, HIPAA/BAA, SIEM export — exist
   * only on that tier. The cross-tenant specs need it on *both*: they prove
   * isolation by asking the same Enterprise surface as two different
   * workspaces, and a `growth` second tenant would turn "nobody else's trail"
   * into "no trail, because that plan cannot export".
   *
   * A field rather than a constant, so the tier stays visible here and the
   * later 11.5 items (the sandbox licence, the end-to-end white-label
   * verification) have one line to change rather than a seed to unpick. What is
   * *refused* on the tier below is proved in
   * `test/integration/entitlements.test.ts`, which can move a workspace between
   * plans mid-test — something a fixed demo fixture cannot express at all.
   */
  plan: 'growth' | 'enterprise';
  salesTracker: SalesTrackerSpec;
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
    plan: 'enterprise',
    // Three credited orders (USD 252.50 together) plus one the window could not
    // tie to a chat, so the demo's Ecommerce block reads 3 / $252.50 and not 4 /
    // $285.50.
    salesTracker: {
      currency: 'USD',
      attributionWindowDays: 7,
      attributedCents: [12_900, 4_550, 7_800],
      unattributedCents: [3_300],
    },
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
    plan: 'enterprise',
    // Tracking on, in a currency Acme does not use, and with nothing credited —
    // this tenant has no conversations for a sale to be attributed to. Its
    // report is therefore "configured, and the answer is zero", which is both a
    // demo state worth having and the sharpest cross-tenant tripwire available:
    // any figure at all here, or a `GBP` in Acme's block, is a leak.
    salesTracker: {
      currency: 'GBP',
      attributionWindowDays: 14,
      attributedCents: [],
      unattributedCents: [8_100, 2_400],
    },
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
    agentReply:
      "Thanks for flagging this — I'll check the courier tracking and update you shortly.",
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
    // already ships with full data, never sees the wizard (FR-MOD-00.4) or the
    // Reports survey popover (FR-MOD-07.2) either.
    await prisma.license.updateMany({
      where: { organizationId: existing.id, onboardingCompletedAt: null },
      data: { onboardingCompletedAt: new Date(), demoSeededAt: new Date() },
    });
    await prisma.license.updateMany({
      where: { organizationId: existing.id, surveyAnsweredAt: null },
      data: { surveyAnsweredAt: new Date() },
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
      plan: spec.plan,
      billingCycle: 'monthly',
      status: 'trialing',
      trialEndsAt,
      // The demo tenants already ship with full data, so they must never open on
      // the first-run wizard (FR-MOD-00.4) — that gate is for empty workspaces a
      // real signup creates. Marked complete and seeded from the start; the
      // Reports survey popover (FR-MOD-07.2) is likewise pre-answered (skipped)
      // so it never interrupts a deterministic e2e run.
      onboardingCompletedAt: new Date(),
      demoSeededAt: new Date(),
      surveyAnsweredAt: new Date(),
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
      data: { licenseId, brandId: defaultBrand.id, primaryColor: '#2d67fa' },
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
    data: {
      licenseId,
      brandId: defaultBrand.id,
      fileSharingEnabled: true,
      spamFilterEnabled: true,
    },
  });

  // --- Billing --------------------------------------------------------------

  // The row entitlements are read from (`lib/entitlements.ts`), so it carries
  // the spec's tier. The amounts stay the catalogue's self-serve figures on
  // both tiers — Enterprise is quoted, and `updateSubscription` leaves the
  // numbers on a row alone when it moves a workspace to a tier that states
  // none, so this is what a real upgraded row looks like.
  await prisma.subscription.create({
    data: {
      licenseId,
      plan: spec.plan,
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

  let conversations: Conversation[] = [];
  if (spec.richDemo) {
    conversations = await seedConversations({
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

    // --- Campaigns / Tickets / Reviews demo fixture (§D113/K14) -------------
    // Only the richDemo tenant gets these — northwind/stateside stay the
    // isolation fixtures they already are (some e2e specs rely on their
    // emptiness). Written through the same services the routes call, so the
    // rows carry the exact invariants a real workspace's would (computed
    // campaign status, ticket-rule application, the "one unresolved ticket per
    // chat" constraint) rather than a hand-rolled approximation of them.
    await seedCampaigns({ licenseId, organizationId: organization.id });
    await seedTickets({
      licenseId,
      organizationId: organization.id,
      ownerId: owner.id,
      agents,
      groupId: supportTeam.id,
      customers,
      // Bridges a ticket to the closed conversation (FR-MOD-13.6) — created
      // `solved` so it never occupies the chat's "one unresolved ticket" slot,
      // leaving `tickets.spec.ts`'s own from-a-chat creation free to succeed.
      bridgeChatId: conversations[0]!.chatId,
    });
    // Custom field values (FR-MOD-08.7.6) are deliberately NOT seeded here:
    // no ticket/contact custom field definitions exist in this fixture yet
    // (nothing in this repo creates one by default), so there is nothing for
    // a value to reference. Add the definitions first if a future task needs
    // the Customers screen to show one.

    // --- SLA / Goal / Scheduled report / Webhook demo fixture (§D113/K14) ---
    // Same reasoning as campaigns/tickets above: through the services the
    // routes call, not a raw insert, so each row carries the invariants a real
    // save would (SLA's minute-range CHECK, the goal's own-trigger rule, the
    // schedule's roster-bound recipients, the webhook's SSRF-safe target).
    await seedSlaTarget({ licenseId, organizationId: organization.id });
    await seedGoal({ licenseId, organizationId: organization.id });
    await seedScheduledReport({
      licenseId,
      organizationId: organization.id,
      ownerId: owner.id,
      ownerEmail: owner.email,
    });
    await seedWebhook({ licenseId, organizationId: organization.id });
  }

  // --- Sales tracker (FR-MOD-13.5) ------------------------------------------

  await seedSalesTracker({
    licenseId,
    slug: spec.slug,
    spec: spec.salesTracker,
    conversations,
    // The last seeded customer, who has no conversation — the buyer behind the
    // orders nothing can be credited with.
    walkInCustomerId: customers.at(-1)!.id,
  });

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
      // Both callbacks the first-party clients carry: the console's and the
      // phone's (`auth_signup` registers the same pair). Sourced from
      // `@nexa/types` so the seed and the mobile app cannot drift apart.
      redirectUris: ['http://localhost:5173/auth/callback', MOBILE_REDIRECT_URI],
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

/** A seeded conversation and the visitor who held it — what a sale can be credited to. */
interface Conversation {
  chatId: string;
  customerId: string;
}

/**
 * One archived conversation and one live one, so the inbox has something to
 * show and the archive view is not empty on first run.
 *
 * Returns both, newest last, because the sales tracker fixture below has to
 * credit its orders to a real chat — and a fixture that re-derived the chat ids
 * with its own query could silently attribute to a conversation this function
 * did not create.
 */
async function seedConversations(input: {
  licenseId: bigint;
  customers: Array<{ id: string }>;
  agentId: string;
  groupId: bigint;
  shippingTagId: string;
}): Promise<Conversation[]> {
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
  // Two more (FR-MOD-07.8), backdated so the Reviews report's daily bar and
  // CSAT donut have more than a single day's worth of data to render. Rating
  // has no uniqueness constraint on chat/thread — a real visitor can vote more
  // than once too (`widget.ts#vote`) — so stacking these on the one closed
  // conversation is the same shape production data takes, not a shortcut.
  await prisma.rating.create({
    data: {
      chatId: closed.chatId,
      licenseId,
      threadId: closed.threadId,
      value: 'good',
      createdAt: new Date(Date.now() - 3 * 86_400_000),
    },
  });
  await prisma.rating.create({
    data: {
      chatId: closed.chatId,
      licenseId,
      threadId: closed.threadId,
      value: 'bad',
      createdAt: new Date(Date.now() - 6 * 86_400_000),
    },
  });

  // A live conversation waiting for a reply, so the inbox is not empty either.
  const live = await createConversation({
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

  return [
    { chatId: closed.chatId, customerId: customers[0]!.id },
    { chatId: live.chatId, customerId: customers[1]!.id },
  ];
}

/**
 * Two campaigns (FR-MOD-03.3): one running, one switched off, so the status
 * tabs (Ongoing / Inactive) have something to filter on the first time anyone
 * opens the tenant rather than only after an owner builds one by hand.
 *
 * The running one targets a **specific** path. It used to be `url_contains:
 * '/'` — a catch-all, which was harmless only because campaigns were evaluated
 * once at save time and never again: with no visitors on a freshly seeded site,
 * it matched nobody and stayed inert forever. Since the visit write path
 * evaluates campaigns too (tm 176.5), a catch-all is no longer inert — it
 * nudges *every* visitor on *every* page, in a demo whose widget already greets
 * them with a proactive card of its own (FR-MOD-11.2). Two mechanisms saying
 * hello over each other is not what the demo is for, and it made the campaign
 * card an unpredictable neighbour for anything else browsing the seeded site.
 * A workspace is still free to write a `/` campaign and mean it; the demo just
 * should not ship one.
 */
async function seedCampaigns(tenant: { licenseId: bigint; organizationId: string }): Promise<void> {
  const campaigns = new CampaignService();
  await campaigns.create(prisma, tenant, {
    name: 'Bike range greeting',
    active: true,
    conditions: { url_contains: '/bikes/' },
    content: { message: 'Welcome to Acme Bikes! Ask us anything about our bikes.' },
  });
  await campaigns.create(prisma, tenant, {
    name: 'Pricing page nudge',
    active: false,
    conditions: { url_contains: '/pricing' },
    content: { message: 'Questions about pricing? Happy to help — just ask.' },
  });
}

/**
 * Five tickets (FR-MOD-02.6/13.6): open/pending/solved, each a different
 * priority, so the Tickets grid and its sort/filter have real spread to show
 * rather than one status repeated five times.
 *
 * Run through `TicketService` rather than a raw insert so the invariants a
 * live create/update goes through also hold here: id allocation, ticket-rule
 * application, the assignee/group existence checks, and — for the priority
 * change — the audit trail (13.6's other write path an inserted row would
 * otherwise never exercise).
 */
async function seedTickets(input: {
  licenseId: bigint;
  organizationId: string;
  ownerId: string;
  agents: Array<{ id: string }>;
  groupId: bigint;
  customers: Array<{ id: string }>;
  /** The chat the "bridged" ticket is created from (FR-MOD-13.6). */
  bridgeChatId: string;
}): Promise<void> {
  const { licenseId, organizationId, ownerId, agents, groupId, customers, bridgeChatId } = input;
  const tenant = { licenseId, organizationId };
  const principal: AgentPrincipal = {
    kind: 'agent',
    accountId: ownerId,
    licenseId,
    organizationId,
    role: 'owner',
    scopes: [...ADMIN_SCOPES],
    tokenId: 'seed',
    tokenKind: 'pat',
  };
  const chainSecret = process.env['AUDIT_CHAIN_SECRET'];
  if (!chainSecret) {
    throw new Error('AUDIT_CHAIN_SECRET is required to seed tickets (their audit trail).');
  }
  const audit: AuditContext = { licenseId, chainSecret, actorId: ownerId, actorType: 'agent' };
  const tickets = new TicketService();
  const groupIdNumber = Number(groupId);

  /** Create a ticket, then set its priority when it differs from the 0 default. */
  async function seedTicket(create: CreateInput, priority: number): Promise<void> {
    const created = await tickets.create(prisma, tenant, principal, create);
    if (priority !== 0) {
      await tickets.update(prisma, tenant, principal, audit, created.id, { priority });
    }
  }

  await seedTicket(
    {
      subject: 'Bike frame arrived with a scratch',
      customer_id: customers[0]!.id,
      status: 'open',
      assignee_id: agents[1]?.id ?? null,
      group_id: groupIdNumber,
    },
    60,
  );
  await seedTicket(
    { subject: 'Warranty claim — rear gearbox', customer_id: customers[2]!.id, status: 'open' },
    0,
  );
  await seedTicket(
    {
      subject: 'Bulk order enquiry — 12 bikes for a local shop',
      customer_id: customers[1]!.id,
      status: 'pending',
      assignee_id: ownerId,
      group_id: groupIdNumber,
    },
    80,
  );
  await seedTicket(
    {
      subject: 'Return requested — frame size too small',
      source_chat_id: bridgeChatId,
      // `solved`, not the `open` default: a ticket already resolved leaves the
      // chat's "one unresolved ticket" slot free, so `tickets.spec.ts`'s own
      // from-a-chat creation still gets the fresh-ticket path it expects.
      status: 'solved',
      assignee_id: agents[0]?.id ?? null,
    },
    -20,
  );
  await seedTicket(
    {
      subject: 'Missing accessory in shipment NX-7734',
      customer_id: customers[2]!.id,
      status: 'pending',
      assignee_id: agents[1]?.id ?? null,
      group_id: groupIdNumber,
    },
    10,
  );
}

/**
 * The SLA target (FR-MOD-11.5-d): a first-response and resolution promise, so
 * Settings > SLA opens with a configured policy instead of an empty form.
 * Business-hours-only, the usual real-workspace choice — no `WorkSchedule` rows
 * are seeded alongside it (no task has put agent hours in this fixture yet), so
 * `readClock` resolves an empty week and the breach sweep marks nothing; the
 * target itself, what this screen is for, is what gets seeded.
 */
async function seedSlaTarget(tenant: { licenseId: bigint; organizationId: string }): Promise<void> {
  await saveSlaPolicy(prisma, tenant, {
    firstResponseMinutes: 5,
    resolutionMinutes: 24 * 60,
    businessHoursOnly: true,
  });
}

/**
 * One goal (FR-MOD-13.3) — the lead funnel's conversion stage: a visitor who
 * reaches the order-confirmation page has converted. `url_contains` is the
 * only predicate v1's matcher reads (`goal-matching.ts`), so it is the one
 * usable shape a seeded goal can take.
 */
async function seedGoal(tenant: { licenseId: bigint; organizationId: string }): Promise<void> {
  const goals = new GoalService();
  await goals.create(prisma, tenant, {
    name: 'Order confirmed',
    definition: { url_contains: '/thank-you' },
  });
}

/**
 * One scheduled export (FR-MOD-07.9): a weekly Overview mailed to the owner,
 * through `ScheduledReportService` rather than a raw insert — `recipients` is
 * validated against the licence's own roster there, and re-deriving that check
 * for a seed-only insert would risk it drifting from what `POST
 * /scheduled-reports` actually enforces.
 */
async function seedScheduledReport(input: {
  licenseId: bigint;
  organizationId: string;
  ownerId: string;
  ownerEmail: string;
}): Promise<void> {
  const { licenseId, organizationId, ownerId, ownerEmail } = input;
  const tenant = { licenseId, organizationId };
  const schedules = new ScheduledReportService();
  await schedules.create(prisma, tenant, {
    group: 'overview',
    frequency: 'weekly',
    format: 'csv',
    recipients: [ownerEmail],
    createdByAgentId: ownerId,
  });
}

/**
 * One outbound webhook (FR-MOD-08.8.4), subscribed to `chat_deactivated` — the
 * wire name for an archived chat (`chat-service.ts`'s "Chat archived" system
 * event publishes exactly this action). The route's own SSRF guard
 * (`assertPublicHttpUrl`) refuses a literal `localhost` target, so the mock
 * target is `https://example.com/hook` — the same stand-in the SSRF and
 * knowledge-crawl fixtures already use for "a URL that parses and is public
 * but answers nobody real". Disabled immediately after registering: this repo
 * mocks external services rather than calling them (MASTER-PROMPT), and
 * `WebhookDispatcher` only ever queries `enabled: true` rows, so a disabled
 * row is demo data the dispatcher will never actually try to deliver to the
 * open internet.
 */
async function seedWebhook(tenant: { licenseId: bigint; organizationId: string }): Promise<void> {
  const webhooks = new WebhookService();
  const registration = await webhooks.register(prisma, tenant, {
    url: 'https://example.com/hook',
    action: 'chat_deactivated',
  });
  await prisma.webhook.update({ where: { id: registration.id }, data: { enabled: false } });
}

/**
 * The sales tracker fixture (FR-MOD-13.5): the configuration row plus the
 * orders the Reviews report's Ecommerce block is built from.
 *
 * Written the way the ingest endpoint writes them — `attributed` true only
 * alongside a real `chat_id`, every amount in the license's configured
 * currency — so the demo data and the data a live snippet produces are the same
 * shape. A row here that claimed attribution with no chat behind it would make
 * the demo prove something the product does not do.
 *
 * Idempotent on its own, not only via `seedTenant`'s already-present guard:
 * the settings row is upserted and the orders lean on
 * `UNIQUE(license_id, external_order_id)` — the same constraint that stops the
 * live endpoint recording one order twice. Re-running the seed therefore cannot
 * double the revenue figure even if it reaches this function again.
 */
async function seedSalesTracker(input: {
  licenseId: bigint;
  slug: string;
  spec: SalesTrackerSpec;
  conversations: Conversation[];
  walkInCustomerId: string;
}): Promise<void> {
  const { licenseId, slug, spec, conversations, walkInCustomerId } = input;

  await prisma.salesTrackerSettings.upsert({
    where: { licenseId },
    create: {
      licenseId,
      enabled: true,
      currency: spec.currency,
      attributionWindowDays: spec.attributionWindowDays,
    },
    update: {
      enabled: true,
      currency: spec.currency,
      attributionWindowDays: spec.attributionWindowDays,
    },
  });

  // Attributed orders are only possible where a conversation exists; a spec that
  // asks for them without one is a fixture bug, not something to paper over.
  if (spec.attributedCents.length > 0 && conversations.length === 0) {
    throw new Error(`${slug}: attributed sales were requested but no conversation was seeded`);
  }

  const orders = [
    ...spec.attributedCents.map((amountCents, index) => {
      const conversation = conversations[index % conversations.length]!;
      return {
        chatId: conversation.chatId,
        customerId: conversation.customerId,
        amountCents,
        attributed: true,
      };
    }),
    ...spec.unattributedCents.map((amountCents) => ({
      chatId: null,
      customerId: walkInCustomerId,
      amountCents,
      attributed: false,
    })),
  ];

  await prisma.trackedSale.createMany({
    data: orders.map((order, index) => ({
      licenseId,
      chatId: order.chatId,
      customerId: order.customerId,
      // Shaped like a shop's own order reference and stable across reseeds, so
      // the uniqueness above is what makes this idempotent. Matches
      // `SALES_TRACKER_EXTERNAL_ORDER_ID_RE`, which the live endpoint enforces.
      externalOrderId: `${slug.toUpperCase()}-DEMO-${1001 + index}`,
      amountCents: order.amountCents,
      currency: spec.currency,
      attributed: order.attributed,
      // Spread over the last few hours: comfortably inside the reports' default
      // 30-day window, and after the conversations above (minutes old), so an
      // attributed order sits within its license's attribution window rather
      // than predating the chat it is credited to.
      createdAt: new Date(Date.now() - (index + 1) * 1_800_000),
    })),
    skipDuplicates: true,
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
    data: {
      id: chatId,
      licenseId,
      customerId,
      active,
      createdAt: startedAt,
      // The inbox list's ordering key (FR-MOD-02.2.2), written here for the
      // same reason `createdAt` is: left to its `now()` default, every seeded
      // conversation would claim it had just spoken, and a fixture laid down to
      // *be* an order would arrive with none. Its value is the invariant the
      // column carries — the `created_at` of the last event written below.
      lastEventAt: new Date(startedAt.getTime() + Math.max(messages.length - 1, 0) * 120_000),
    },
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

/**
 * A workspace whose region this deployment does not serve (NFR-C4 · C4-b).
 *
 * Seeded directly, and that is the whole point. Since C4-h the product refuses
 * to create one: `POST /auth/signup` on a European deployment will not write a
 * `us` workspace, which was the hole C4-h closed — and, with it, the only way a
 * browser could produce this row. The three doors that refuse such a workspace
 * (REST edge, socket `login`, widget token mint) are a *second* layer, and a
 * second layer earns its keep on exactly the rows the first one did not stop: a
 * restored backup, a migration pointed at the wrong database, a future signup
 * path written by someone who did not read C4-h. None of those would ask
 * permission either, so neither does this.
 *
 * Deliberately the minimum a credential needs — organization, licence, owner,
 * and the OAuth client a token grant reads. No conversations, no customers, no
 * knowledge: everything it could own would be data this deployment must not be
 * holding in the first place.
 */
const MISPLACED_US = {
  organizationName: 'Stateside Supply',
  slug: 'stateside',
  ownerName: 'Sam Stateside',
} as const;

async function seedMisplacedUsWorkspace(passwordHash: string): Promise<void> {
  const existing = await prisma.organization.findFirst({
    where: { name: MISPLACED_US.organizationName },
    select: { id: true },
  });
  if (existing) {
    console.log(`  ${MISPLACED_US.organizationName}: already present, skipping`);
    return;
  }

  const organization = await prisma.organization.create({
    data: { name: MISPLACED_US.organizationName, region: 'us' },
    select: { id: true },
  });

  const license = await prisma.license.create({
    data: {
      organizationId: organization.id,
      plan: 'growth',
      billingCycle: 'monthly',
      status: 'trialing',
      trialEndsAt: new Date(Date.now() + 14 * 86_400_000),
      // Nothing here will ever open a screen — every identified request this
      // workspace makes is refused — but a null would claim the workspace is
      // merely waiting on its wizard rather than being in the wrong country.
      onboardingCompletedAt: new Date(),
      surveyAnsweredAt: new Date(),
    },
    select: { id: true },
  });

  const owner = await prisma.account.create({
    data: {
      email: `owner@${MISPLACED_US.slug}.localhost`,
      name: MISPLACED_US.ownerName,
      passwordHash,
    },
    select: { id: true, email: true },
  });

  await prisma.agentMembership.create({
    data: {
      licenseId: license.id,
      agentId: owner.id,
      role: 'owner',
      routingStatus: 'accepting_chats',
      concurrentChatsLimit: 6,
    },
  });

  // The token endpoints are anonymous — residency is decided where a credential
  // is *used*, not where it is issued — so this client is what lets the
  // compliance suite obtain a genuine token and get it refused at each door.
  await prisma.oauthClient.create({
    data: {
      id: `nexa-agent-app-${MISPLACED_US.slug}`,
      organizationId: organization.id,
      displayName: 'Nexa Agent App',
      clientType: 'public',
      // Both callbacks the first-party clients carry: the console's and the
      // phone's (`auth_signup` registers the same pair). Sourced from
      // `@nexa/types` so the seed and the mobile app cannot drift apart.
      redirectUris: ['http://localhost:5173/auth/callback', MOBILE_REDIRECT_URI],
      scopes: [],
    },
  });

  console.log(`  ${MISPLACED_US.organizationName}  (region us — refused at every door)`);
  console.log(`    owner        ${owner.email} / ${DEMO_PASSWORD}`);
}

/**
 * The workspace list paging is proved against (NFR-P5 · P5-PAGE).
 *
 * Five console lists chain pages now, and on a three-conversation fixture not
 * one of them can show it: where a second page never exists, a cursor that was
 * never sent and a cursor that was sent and then ignored produce the same
 * screen. So this workspace is deliberately larger than one page of anything —
 * sixty conversations against the inbox's 50-row page, and one conversation of
 * two hundred and fifty events against the transcript's 200-event page.
 *
 * A workspace of its own rather than sixty more rows in Acme, and that is the
 * whole reason it exists as a fourth tenant. The e2e suite counts Acme's
 * conversations in a dozen places (the inbox tab counters, the Reports figures,
 * the chat-topics clusters); sixty more rows would have rewritten every one of
 * those numbers to prove something none of them is about.
 *
 * It proves the sidebar *counters* for the same reason (audit D3, M-COUNT-a).
 * A count only differs from a page where the view is larger than the page, so
 * these sixty are also the only fixture in the seed where "the whole view" and
 * "the rows this browser fetched" are different numbers. The split is
 * deliberate: fifty-nine conversations the AI answered alone (the Solved view,
 * ADR-09's AI resolutions) plus the one long agent-worked conversation, so
 * Solved reads 59 where All and Archive read 60 and no single wrong number
 * could satisfy all three.
 */
const PAGING = {
  organizationName: 'Paging Proving Ground',
  slug: 'paging',
  ownerName: 'Pat Ordonez',
  /** Conversations here — ten past the console's 50-row chat page. */
  chatCount: 60,
  /** Tickets here — ten past the Tickets grid's own 50-row page. */
  ticketCount: 60,
  /** Events in the newest conversation — fifty past the 200-event transcript page. */
  longTranscriptEvents: 250,
  /** Spacing between consecutive events, and between one conversation and the next. */
  stepMs: 60_000,
} as const;

/** `1` → `01`, so the row label reads in the same order the console lists it. */
function pagingLabel(index: number): string {
  return String(index + 1).padStart(2, '0');
}

async function seedPagingWorkspace(passwordHash: string): Promise<void> {
  const existing = await prisma.organization.findFirst({
    where: { name: PAGING.organizationName },
    select: { id: true },
  });
  if (existing) {
    console.log(`  ${PAGING.organizationName}: already present, skipping`);
    return;
  }

  const organization = await prisma.organization.create({
    data: { name: PAGING.organizationName, region: 'eu' },
    select: { id: true },
  });
  const license = await prisma.license.create({
    data: {
      organizationId: organization.id,
      plan: 'growth',
      billingCycle: 'monthly',
      status: 'trialing',
      trialEndsAt: new Date(Date.now() + 14 * 86_400_000),
      // Ships with data, so it must never open on the first-run wizard or the
      // Reports survey popover — the same reasoning as the demo tenants above.
      onboardingCompletedAt: new Date(),
      demoSeededAt: new Date(),
      surveyAnsweredAt: new Date(),
    },
    select: { id: true },
  });
  const licenseId = license.id;

  const owner = await prisma.account.create({
    data: { email: `owner@${PAGING.slug}.localhost`, name: PAGING.ownerName, passwordHash },
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
  // The console signs in through OAuth 2.1 + PKCE like any other workspace, and
  // `listWorkspaces` reads the client id off the membership — without this row
  // the owner authenticates and then cannot be granted a token.
  await prisma.oauthClient.create({
    data: {
      id: `nexa-agent-app-${PAGING.slug}`,
      organizationId: organization.id,
      displayName: 'Nexa Agent App',
      clientType: 'public',
      redirectUris: ['http://localhost:5173/auth/callback', MOBILE_REDIRECT_URI],
      scopes: [],
    },
  });

  const group = await prisma.group.create({
    data: { licenseId, name: 'Support', languageCode: 'en' },
    select: { id: true },
  });
  await prisma.groupAgent.create({
    data: { licenseId, groupId: group.id, agentId: owner.id, priority: 'last' },
  });

  // Laid down backwards from a fixed base, so the console's order
  // (`last_event_at DESC, id DESC`) *is* the numbering: `Paging Visitor 01` is
  // the first row and `Paging Visitor 60` the last one, ten rows into the
  // second page. That is what lets a test name the row only paging can reach
  // rather than counting rows and hoping.
  //
  // The two orders agree here, deliberately: each conversation's events start
  // at its own `createdAt` and step forward by the same amount, so last
  // activity is monotonic in creation time and the numbering means the same
  // thing under either. The one exception is the long conversation at index 0,
  // whose two hundred and fifty events carry it further forward still — and it
  // is the first row under both readings.
  const base = new Date(Date.now() - 6 * 3_600_000);
  const startedAt = (index: number): Date => new Date(base.getTime() - index * PAGING.stepMs);

  /**
   * The long conversation, which is the *first* row rather than a sixty-first
   * one: it keeps the workspace at exactly one page plus ten, and it puts the
   * transcript a test needs at the top of the list, where opening it needs no
   * paging of its own.
   */
  const longMessages = Array.from({ length: PAGING.longTranscriptEvents }, (_, index) => ({
    authorType: index % 2 === 0 ? 'customer' : 'agent',
    // A marker no other seeded text contains, and which no shorter marker is a
    // prefix of, so a test can address one message out of two hundred and fifty.
    text: `paging-msg-${String(index + 1).padStart(3, '0')} — line ${index + 1} of the long conversation`,
  }));

  const customers = Array.from({ length: PAGING.chatCount }, (_, index) => ({
    id: randomUUID(),
    organizationId: organization.id,
    name: `Paging Visitor ${pagingLabel(index)}`,
    email: `visitor${pagingLabel(index)}@${PAGING.slug}-customer.localhost`,
    countryCode: 'NL',
    country: 'Netherlands',
    chatsCount: 1,
    lastActivityAt: startedAt(index),
  }));

  const conversations = customers.map((customer, index) => ({
    chatId: generateShortId(),
    threadId: generateShortId(),
    customerId: customer.id,
    createdAt: startedAt(index),
    messages:
      index === 0
        ? longMessages
        : [
            { authorType: 'customer', text: `Question from ${customer.name}` },
            // Answered by the AI, not a person — which is what puts these
            // fifty-nine in the "Solved" view as well as in Archive. That is
            // the one view whose counter the audit named (D3, FR-MOD-02.1.2):
            // it is ADR-09's AI-resolution set, and at fifty-nine it is past
            // the console's own 50-row page, so a browser can tell a counter
            // that reports the view from one that reports the rows it loaded.
            // The long conversation above keeps its agent turns, so it stays
            // out of Solved and the two numbers are not the same number.
            { authorType: 'bot', text: 'Answered by the AI, and archived.' },
          ],
  }));

  // Written in bulk rather than through `createConversation`. That helper is one
  // round trip per row, and this fixture is some five hundred of them — a cost
  // the e2e suite would pay in its global setup on every single run, for rows
  // whose only job is to exist in quantity.
  await prisma.customer.createMany({ data: customers });
  await prisma.chat.createMany({
    data: conversations.map((c) => ({
      id: c.chatId,
      licenseId,
      customerId: c.customerId,
      // Closed, all of them. Sixty active chats would sit in the routing queue
      // and on the traffic board of a workspace that exists to be read rather
      // than worked; `view=all` applies no active filter, so the list is the
      // full sixty either way.
      active: false,
      createdAt: c.createdAt,
      // The list orders on this (FR-MOD-02.2.2), so the numbering above is only
      // the console's order if it is written: the `now()` default would give all
      // sixty the same instant and leave `id DESC` — a random order — deciding
      // which row is first. Its value is the invariant the column carries, the
      // `created_at` of the last event written below, which for this fixture is
      // monotonic in `createdAt` and so preserves the numbering exactly.
      lastEventAt: new Date(c.createdAt.getTime() + (c.messages.length - 1) * PAGING.stepMs),
    })),
  });
  await prisma.chatAccess.createMany({
    data: conversations.map((c) => ({ chatId: c.chatId, groupId: group.id })),
  });
  await prisma.chatUser.createMany({
    data: conversations.flatMap((c) => [
      { chatId: c.chatId, userId: c.customerId, userType: 'customer', present: false },
      { chatId: c.chatId, userId: owner.id, userType: 'agent', present: false },
    ]),
  });
  await prisma.thread.createMany({
    data: conversations.map((c) => ({
      id: c.threadId,
      chatId: c.chatId,
      licenseId,
      active: false,
      assigneeId: owner.id,
      createdAt: c.createdAt,
      eventSequence: c.messages.length,
      firstResponseAt: new Date(c.createdAt.getTime() + PAGING.stepMs),
      closedAt: new Date(c.createdAt.getTime() + c.messages.length * PAGING.stepMs),
      summary: 'Paging fixture conversation.',
    })),
  });
  await prisma.event.createMany({
    data: conversations.flatMap((c) =>
      c.messages.map((message, index) => ({
        id: buildEventId(c.threadId, index + 1),
        threadId: c.threadId,
        chatId: c.chatId,
        licenseId,
        type: 'message',
        text: message.text,
        authorId: message.authorType === 'customer' ? c.customerId : owner.id,
        authorType: message.authorType,
        recipients: 'all',
        createdAt: new Date(c.createdAt.getTime() + index * PAGING.stepMs),
      })),
    ),
  });

  /**
   * Sixty tickets, ten past the Tickets grid's own 50-row page — and numbered
   * *against* the activity order rather than with it.
   *
   * That reversal is the whole fixture. `Paging Ticket 01` is the least
   * recently active one, so under the grid's default order (`last_message`
   * descending) it is the sixtieth row: on the second page, and not among the
   * fifty a browser holds when the grid opens. Bringing it to the top by
   * subject is therefore only possible if the *server* ordered the whole
   * collection — a re-sort of the loaded rows can reach the first of fifty and
   * calls it the first of sixty (D3 · FR-MOD-02.7).
   *
   * Bulk-written like the conversations above, and for the same reason: sixty
   * rows through `TicketService` would be sixty round trips in every e2e run,
   * paid for rows whose only job is to exist in quantity. The invariants that
   * helper protects are proved where tickets are actually created (Acme's
   * `seedTickets`, and the ticket integration suite).
   */
  await prisma.ticket.createMany({
    data: Array.from({ length: PAGING.ticketCount }, (_, index) => {
      // Reversed against the numbering: index 0 is the oldest activity.
      const activeAt = startedAt(PAGING.ticketCount - 1 - index);
      return {
        id: generateShortId(),
        licenseId,
        customerId: customers[index % customers.length]!.id,
        subject: `Paging Ticket ${pagingLabel(index)}`,
        lastMessageAt: activeAt,
        createdAt: activeAt,
      };
    }),
  });

  console.log(
    `  ${PAGING.organizationName}  (paging fixture — ${PAGING.chatCount} conversations, one of ${PAGING.longTranscriptEvents} events, ${PAGING.ticketCount} tickets)`,
  );
  console.log(`    owner        ${owner.email} / ${DEMO_PASSWORD}`);
}

/**
 * A trial that ended before this run started (FR-MOD-10.2).
 *
 * `license-gate.ts` re-reads `trialEndsAt` on every mutating request rather
 * than caching it, so read-only mode is a fact about the row, not about
 * elapsed wall-clock time in a test. But nothing public ever moves that row
 * backwards — `fixtures.ts`'s own rule is that e2e drives the product through
 * its API and never the database, and there is no endpoint that ages a
 * workspace's trial (there should not be one). A live-trial signup can only
 * ever be aged forward by waiting fourteen real days, so the one way to get an
 * e2e-reachable "read-only since before the run started" workspace is to seed
 * it already expired, the same way `MISPLACED_US`/`PAGING` seed a state a
 * public signup could never produce.
 *
 * Deliberately the same minimum as `MISPLACED_US`: no conversations, no
 * customers — the claim under test is the write gate and the subscribe path,
 * neither of which needs existing data to demonstrate (the gate's own point,
 * ADR-10, is that data would stay readable if there were any).
 */
const OVERDUE = {
  organizationName: 'Overdue Outfitters',
  slug: 'overdue',
  ownerName: 'Rae Overdue',
} as const;

async function seedOverdueTrialWorkspace(passwordHash: string): Promise<void> {
  const existing = await prisma.organization.findFirst({
    where: { name: OVERDUE.organizationName },
    select: { id: true },
  });
  if (existing) {
    console.log(`  ${OVERDUE.organizationName}: already present, skipping`);
    return;
  }

  const organization = await prisma.organization.create({
    data: { name: OVERDUE.organizationName, region: 'eu' },
    select: { id: true },
  });

  const license = await prisma.license.create({
    data: {
      organizationId: organization.id,
      plan: 'growth',
      billingCycle: 'monthly',
      status: 'trialing',
      // Two days past the fourteen it was granted — well clear of any clock
      // skew between the seed run and the tests that read it.
      trialEndsAt: new Date(Date.now() - 2 * 86_400_000),
      // A null here would send the owner to the setup wizard instead of the
      // inbox — this fixture is about the write gate, not onboarding.
      onboardingCompletedAt: new Date(),
      surveyAnsweredAt: new Date(),
    },
    select: { id: true },
  });

  const owner = await prisma.account.create({
    data: {
      email: `owner@${OVERDUE.slug}.localhost`,
      name: OVERDUE.ownerName,
      passwordHash,
    },
    select: { id: true, email: true },
  });

  await prisma.agentMembership.create({
    data: {
      licenseId: license.id,
      agentId: owner.id,
      role: 'owner',
      routingStatus: 'accepting_chats',
      concurrentChatsLimit: 6,
    },
  });

  await prisma.oauthClient.create({
    data: {
      id: `nexa-agent-app-${OVERDUE.slug}`,
      organizationId: organization.id,
      displayName: 'Nexa Agent App',
      clientType: 'public',
      redirectUris: ['http://localhost:5173/auth/callback', MOBILE_REDIRECT_URI],
      scopes: [],
    },
  });

  console.log(`  ${OVERDUE.organizationName}  (trial ended two days before this seed ran)`);
  console.log(`    owner        ${owner.email} / ${DEMO_PASSWORD}`);
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
  await seedMisplacedUsWorkspace(passwordHash);
  await seedPagingWorkspace(passwordHash);
  await seedOverdueTrialWorkspace(passwordHash);

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
