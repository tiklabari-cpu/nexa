/**
 * Database fixtures for RTM tests.
 *
 * Builds the same two-tenant shape the API tests use, so a cross-tenant leak in
 * fan-out shows up as another organization's message arriving rather than as
 * nothing at all.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { generateShortId } from '@nexa/types';

export interface RtmTenant {
  organizationId: string;
  licenseId: bigint;
  ownerAccountId: string;
  agentAccountId: string;
  outsiderAccountId: string;
  supportGroupId: bigint;
  salesGroupId: bigint;
  customerId: string;
}

export interface RtmFixtures {
  a: RtmTenant;
  b: RtmTenant;
}

export function ownerClient(): PrismaClient {
  return new PrismaClient({ datasourceUrl: process.env['DATABASE_URL'] });
}

export async function resetDatabase(db: PrismaClient): Promise<void> {
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
      AND tablename NOT LIKE 'events\\_%'
  `;
  if (tables.length === 0) return;
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function seedTenant(db: PrismaClient, slug: string): Promise<RtmTenant> {
  const organization = await db.organization.create({
    data: { name: `Org ${slug}` },
    select: { id: true },
  });
  const license = await db.license.create({
    data: { organizationId: organization.id },
    select: { id: true },
  });

  const [owner, agent, outsider] = await Promise.all(
    ['owner', 'agent', 'outsider'].map((role) =>
      db.account.create({
        data: { email: `${role}-${slug}-${randomUUID()}@example.test`, name: `${role} ${slug}` },
        select: { id: true },
      }),
    ),
  );

  await db.agentMembership.createMany({
    data: [
      {
        licenseId: license.id,
        agentId: owner!.id,
        role: 'owner',
        routingStatus: 'accepting_chats',
      },
      {
        licenseId: license.id,
        agentId: agent!.id,
        role: 'agent',
        routingStatus: 'accepting_chats',
      },
      {
        licenseId: license.id,
        agentId: outsider!.id,
        role: 'agent',
        routingStatus: 'accepting_chats',
      },
    ],
  });

  const support = await db.group.create({
    data: { licenseId: license.id, name: 'Support' },
    select: { id: true },
  });
  const sales = await db.group.create({
    data: { licenseId: license.id, name: 'Sales' },
    select: { id: true },
  });

  // The outsider is in Sales only, so "a chat routed to Support must not reach
  // them" is testable.
  await db.groupAgent.createMany({
    data: [
      { licenseId: license.id, groupId: support.id, agentId: agent!.id, priority: 'normal' },
      { licenseId: license.id, groupId: sales.id, agentId: outsider!.id, priority: 'normal' },
    ],
  });

  const customer = await db.customer.create({
    data: { organizationId: organization.id, name: `Customer ${slug}` },
    select: { id: true },
  });

  return {
    organizationId: organization.id,
    licenseId: license.id,
    ownerAccountId: owner!.id,
    agentAccountId: agent!.id,
    outsiderAccountId: outsider!.id,
    supportGroupId: support.id,
    salesGroupId: sales.id,
    customerId: customer.id,
  };
}

export async function seedRtmFixtures(db: PrismaClient): Promise<RtmFixtures> {
  await resetDatabase(db);
  return { a: await seedTenant(db, 'a'), b: await seedTenant(db, 'b') };
}

export async function grantToken(
  db: PrismaClient,
  input: {
    licenseId: bigint;
    organizationId: string;
    ownerId: string;
    scopes: string[];
    revokedAt?: Date;
    expiresAt?: Date;
  },
): Promise<string> {
  const token = `test_${randomUUID()}`;
  await db.apiToken.create({
    data: {
      licenseId: input.licenseId,
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      kind: 'pat',
      tokenHash: createHash('sha256').update(token, 'utf8').digest('base64url'),
      scopes: input.scopes,
      ...(input.revokedAt ? { revokedAt: input.revokedAt } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    },
  });
  return token;
}

/** Mints a customer token the same way the API does, without going through it. */
export function customerToken(input: {
  customerId: string;
  organizationId: string;
  licenseId: bigint;
  secret: string;
  expiresInSeconds?: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({
      sub: input.customerId,
      org: input.organizationId,
      lic: input.licenseId.toString(),
      iat: now,
      exp: now + (input.expiresInSeconds ?? 3600),
    }),
  ).toString('base64url');

  const signature = createHmac('sha256', input.secret).update(`nxc1.${body}`).digest('base64url');
  return `nxc1.${body}.${signature}`;
}

/** Create a chat with an open thread and optional events, bypassing the API. */
export async function createConversation(
  db: PrismaClient,
  input: {
    tenant: RtmTenant;
    groupId?: bigint;
    agentIds?: string[];
    messages?: string[];
    /**
     * Defaults to the tenant's customer. Pass a distinct one for a second
     * concurrent conversation — the database allows only one active chat per
     * license+customer.
     */
    customerId?: string;
  },
): Promise<{ chatId: string; threadId: string; eventIds: string[]; customerId: string }> {
  const chatId = generateShortId();
  const threadId = generateShortId();
  const { tenant } = input;
  const customerId = input.customerId ?? tenant.customerId;

  await db.chat.create({
    data: { id: chatId, licenseId: tenant.licenseId, customerId, active: true },
  });
  await db.chatAccess.create({
    data: { chatId, groupId: input.groupId ?? tenant.supportGroupId },
  });
  await db.chatUser.create({
    data: { chatId, userId: customerId, userType: 'customer', present: true },
  });
  for (const agentId of input.agentIds ?? []) {
    await db.chatUser.create({
      data: { chatId, userId: agentId, userType: 'agent', present: true },
    });
  }
  await db.thread.create({
    data: { id: threadId, chatId, licenseId: tenant.licenseId, active: true },
  });

  const eventIds: string[] = [];
  const messages = input.messages ?? [];
  for (const [index, text] of messages.entries()) {
    const eventId = `${threadId}_${index + 1}`;
    await db.event.create({
      data: {
        id: eventId,
        threadId,
        chatId,
        licenseId: tenant.licenseId,
        type: 'message',
        text,
        authorType: 'customer',
        recipients: 'all',
      },
    });
    eventIds.push(eventId);
  }
  if (messages.length > 0) {
    await db.thread.update({
      where: { id: threadId },
      data: { eventSequence: messages.length },
    });
  }

  return { chatId, threadId, eventIds, customerId };
}

/** A fresh customer, for tests needing more than one live conversation. */
export async function createCustomer(db: PrismaClient, tenant: RtmTenant): Promise<string> {
  const customer = await db.customer.create({
    data: { organizationId: tenant.organizationId, name: `Customer ${randomUUID().slice(0, 8)}` },
    select: { id: true },
  });
  return customer.id;
}
