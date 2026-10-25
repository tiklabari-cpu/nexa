/**
 * Ticket messages — the store (SiyahTuş analysis HD-01 · tm 356.1, migration
 * 20261025100000_ticket_messages).
 *
 * Nothing writes `ticket_messages` yet: the service arrives in tm 356.2, the
 * mail job in 356.3. What is pinned here is what the database promises on its
 * own, before either relies on it:
 *
 *   - **Tenant isolation.** Read and write are attacked through the client the
 *     application uses (`siyahtus_app`, subject to RLS); fixtures go in through
 *     the owner, which RLS exempts, so the other tenant's rows really exist. A
 *     message of licence A that names licence B's ticket is refused by the
 *     composite foreign key — a key on `id` alone is checked without RLS.
 *   - **An internal note never becomes e-mail.** It cannot carry a delivery
 *     status, a Message-ID or an In-Reply-To, and the application cannot turn
 *     it into a reply afterwards.
 *   - **The other CHECKs.** Who may write which kind, delivery status only on
 *     a reply, HTML only on the player's message, attachments as an array.
 *   - **One key, one message.** The composer's idempotency key and an inbound
 *     Message-ID are unique per licence — and only per licence.
 *   - **What was written stays written.** The application may move a reply's
 *     delivery fields and nothing else, and may not delete a message; a
 *     message leaves with its ticket.
 *   - **One vocabulary.** The CHECKs, the contract and `@siyahtus/types` name
 *     the same kinds, authors and delivery states.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadOpenApiDocument } from '@siyahtus/contract';
import {
  ERROR_STATUS,
  TICKET_COMPOSER_KINDS,
  TICKET_MESSAGE_ATTACHMENTS_MAX,
  TICKET_MESSAGE_AUTHOR_TYPES,
  TICKET_MESSAGE_DELIVERY_STATUSES,
  TICKET_MESSAGE_KINDS,
  TICKET_MESSAGE_TEXT_MAX,
  TICKET_REPLY_SET_STATUSES,
  TICKET_ATTACHMENT_SCAN_STATUSES,
} from '@siyahtus/types';
import { withTenant, type TenantClient } from '../../src/lib/tenant.js';
import {
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** As much of a JSON schema as these tests read. */
interface SchemaNode {
  enum?: Array<string | null>;
  maxLength?: number;
  maxItems?: number;
  required?: string[];
  properties?: Record<string, SchemaNode>;
}

/** The bundled contract's component schemas. */
function contractSchemas(): Record<string, SchemaNode> {
  const document = loadOpenApiDocument() as unknown as {
    components: { schemas: Record<string, SchemaNode> };
  };
  return document.components.schemas;
}

const TICKET_A = 'TKTA00000001';
const TICKET_B = 'TKTB00000001';

describe('ticket messages schema (HD-01)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let fx: Fixtures;

  /** Run as the application role, under one tenant's RLS context. */
  const asTenant = <T>(tenant: TenantFixture, fn: (tx: TenantClient) => Promise<T>) =>
    withTenant(app, { licenseId: tenant.licenseId, organizationId: tenant.organizationId }, fn);

  /** An agent's note on tenant A's ticket, with whatever the case overrides. */
  const note = (
    overrides: Partial<Prisma.TicketMessageUncheckedCreateInput> = {},
  ): Prisma.TicketMessageUncheckedCreateInput => ({
    licenseId: fx.a.licenseId,
    ticketId: TICKET_A,
    kind: 'internal_note',
    authorType: 'agent',
    authorId: fx.a.agentAccountId,
    bodyText: 'Checked the payout log — it left on Monday.',
    ...overrides,
  });

  beforeAll(() => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await owner.ticket.create({
      data: {
        id: TICKET_A,
        licenseId: fx.a.licenseId,
        subject: 'Withdrawal not received',
        customerId: fx.a.customerId,
      },
    });
    await owner.ticket.create({
      data: {
        id: TICKET_B,
        licenseId: fx.b.licenseId,
        subject: 'Bonus question',
        customerId: fx.b.customerId,
      },
    });
  });

  // =========================================================================
  // Tenant isolation
  // =========================================================================

  describe('tenant isolation', () => {
    it('turns RLS on, the policy guarding read and write (NFR-S4)', async () => {
      const [security] = await owner.$queryRaw<Array<{ enabled: boolean }>>`
        SELECT relrowsecurity AS enabled FROM pg_class WHERE relname = 'ticket_messages'
      `;
      expect(security?.enabled).toBe(true);

      const policies = await owner.$queryRaw<
        Array<{ policyname: string; qual: string; withCheck: string | null }>
      >`
        SELECT policyname, qual, with_check AS "withCheck" FROM pg_policies
        WHERE tablename = 'ticket_messages'
      `;
      expect(policies).toHaveLength(1);
      expect(policies[0]?.policyname).toBe('ticket_messages_tenant');
      // `qual` hides another tenant's rows on read; `with_check` refuses
      // planting one. They fail independently, so both are asserted.
      expect(policies[0]?.qual).toContain('siyahtus_current_license');
      expect(policies[0]?.withCheck).toContain('siyahtus_current_license');
    });

    it("never shows another licence's messages, and refuses writing one for it (NFR-S4)", async () => {
      await owner.ticketMessage.create({ data: note() });
      await owner.ticketMessage.create({
        data: note({
          licenseId: fx.b.licenseId,
          ticketId: TICKET_B,
          authorId: fx.b.agentAccountId,
        }),
      });

      const seen = await asTenant(fx.a, (tx) => tx.ticketMessage.findMany());
      expect(seen.map((row) => row.ticketId)).toEqual([TICKET_A]);

      await expect(
        asTenant(fx.a, (tx) =>
          tx.ticketMessage.create({
            data: note({ licenseId: fx.b.licenseId, ticketId: TICKET_B }),
          }),
        ),
      ).rejects.toThrow(/row-level security/i);

      const moved = await asTenant(fx.a, (tx) =>
        tx.ticketMessage.updateMany({
          where: { licenseId: fx.b.licenseId },
          data: { deliveryStatus: null },
        }),
      );
      expect(moved.count).toBe(0);
    });

    it("refuses a message of this licence on another licence's ticket (NFR-S4)", async () => {
      // RLS lets the row in — its licence is the caller's. Only the composite
      // key (ticket_id, license_id) knows that ticket is not.
      await expect(
        asTenant(fx.a, (tx) => tx.ticketMessage.create({ data: note({ ticketId: TICKET_B }) })),
      ).rejects.toThrow(/ticket_messages_ticket_id_license_id_fkey/);
      await expect(
        owner.ticketMessage.create({ data: note({ ticketId: TICKET_B }) }),
      ).rejects.toThrow(/ticket_messages_ticket_id_license_id_fkey/);
    });
  });

  // =========================================================================
  // An internal note never becomes e-mail
  // =========================================================================

  describe('an internal note', () => {
    // A delivery status on a note is refused twice over — by the note's own
    // CHECK and by "delivery status only on a reply" — and Postgres names
    // whichever it evaluates first, so that case accepts either; the
    // Message-ID and In-Reply-To are the note CHECK's alone.
    const MAILED_NOTE = /ticket_messages_(note_not_mailed|delivery_reply_only)_check/;

    it.each([
      ['a delivery status', { deliveryStatus: 'queued' }, MAILED_NOTE],
      [
        'a Message-ID',
        { emailMessageId: '<a1@mail.siyahtus.test>' },
        /ticket_messages_note_not_mailed_check/,
      ],
      [
        'an In-Reply-To',
        { inReplyTo: '<prev@mail.siyahtus.test>' },
        /ticket_messages_note_not_mailed_check/,
      ],
    ])('cannot carry %s', async (_what, mailed, refusal) => {
      await expect(
        asTenant(fx.a, (tx) => tx.ticketMessage.create({ data: note(mailed) })),
      ).rejects.toThrow(refusal);
    });

    it('cannot be given one afterwards, nor be turned into a reply', async () => {
      const stored = await asTenant(fx.a, (tx) => tx.ticketMessage.create({ data: note() }));

      for (const data of [
        { deliveryStatus: 'sent' },
        { emailMessageId: '<late@mail.siyahtus.test>' },
        { inReplyTo: '<late@player.test>' },
      ]) {
        await expect(
          asTenant(fx.a, (tx) => tx.ticketMessage.update({ where: { id: stored.id }, data })),
          JSON.stringify(data),
        ).rejects.toThrow(
          data.deliveryStatus ? MAILED_NOTE : /ticket_messages_note_not_mailed_check/,
        );
      }
      // The kind is not the application's to rewrite at all.
      await expect(
        asTenant(fx.a, (tx) =>
          tx.ticketMessage.updateMany({ where: { id: stored.id }, data: { kind: 'agent_reply' } }),
        ),
      ).rejects.toThrow(/permission denied/i);

      const after = await owner.ticketMessage.findUniqueOrThrow({ where: { id: stored.id } });
      expect(after).toMatchObject({
        kind: 'internal_note',
        deliveryStatus: null,
        emailMessageId: null,
      });
    });
  });

  // =========================================================================
  // The other CHECKs
  // =========================================================================

  describe('the CHECKs', () => {
    it('stores each kind with its author', async () => {
      await asTenant(fx.a, async (tx) => {
        await tx.ticketMessage.create({
          data: note({
            kind: 'customer_message',
            authorType: 'customer',
            authorId: fx.a.customerId,
            bodyHtml: '<p>Where is my money?</p>',
            emailMessageId: '<in-1@player.test>',
          }),
        });
        await tx.ticketMessage.create({
          data: note({
            kind: 'agent_reply',
            deliveryStatus: 'queued',
            idempotencyKey: 'compose-1',
            attachments: [
              {
                key: 'k/1.pdf',
                name: 'receipt.pdf',
                size: 2048,
                mime: 'application/pdf',
                scan_status: 'clean',
                sensitive: false,
              },
            ],
          }),
        });
        await tx.ticketMessage.create({
          data: note({ kind: 'agent_reply', authorType: 'bot', authorId: null }),
        });
        await tx.ticketMessage.create({ data: note() });
        await tx.ticketMessage.create({
          data: note({
            kind: 'system',
            authorType: 'system',
            authorId: null,
            bodyText: 'Merged TKTA00000002 into this ticket.',
          }),
        });
      });
      const kinds = await owner.ticketMessage.findMany({ select: { kind: true } });
      expect(new Set(kinds.map((row) => row.kind))).toEqual(new Set(TICKET_MESSAGE_KINDS));
    });

    it.each([
      ['an unknown kind', { kind: 'email' }, 'ticket_messages_kind_check'],
      // Any unknown author also fails "who may write what", which Postgres
      // may name first; the vocabulary test below pins the list itself.
      ['an unknown author', { authorType: 'visitor' }, 'ticket_messages_author(_type)?_check'],
      [
        'an unknown delivery status',
        { kind: 'agent_reply', deliveryStatus: 'bounced' },
        'ticket_messages_delivery_status_check',
      ],
      [
        'a player message written by an agent',
        { kind: 'customer_message' },
        'ticket_messages_author_check',
      ],
      [
        'an agent writing as the player',
        { authorType: 'customer' },
        'ticket_messages_author_check',
      ],
      ['a product line signed by an agent', { kind: 'system' }, 'ticket_messages_author_check'],
      [
        'an agent reply that names no agent',
        { kind: 'agent_reply', authorId: null },
        'ticket_messages_author_check',
      ],
      [
        'a delivery status on a player message',
        { kind: 'customer_message', authorType: 'customer', deliveryStatus: 'sent' },
        'ticket_messages_delivery_reply_only_check',
      ],
      [
        'HTML on a reply',
        { kind: 'agent_reply', bodyHtml: '<b>hi</b>' },
        'ticket_messages_html_customer_only_check',
      ],
      [
        'attachments that are not a list',
        { attachments: { key: 'k' } },
        'ticket_messages_attachments_array_check',
      ],
      ['an empty idempotency key', { idempotencyKey: '' }, 'ticket_messages_idempotency_key_check'],
      [
        'an idempotency key past 128',
        { idempotencyKey: 'k'.repeat(129) },
        'ticket_messages_idempotency_key_check',
      ],
    ] as const)('refuses %s', async (_what, overrides, constraint) => {
      await expect(
        asTenant(fx.a, (tx) =>
          tx.ticketMessage.create({
            data: note(overrides as Partial<Prisma.TicketMessageUncheckedCreateInput>),
          }),
        ),
      ).rejects.toThrow(new RegExp(constraint));
    });
  });

  // =========================================================================
  // One key, one message
  // =========================================================================

  describe('uniqueness', () => {
    it('holds one message per composer key per licence — and only per licence', async () => {
      await asTenant(fx.a, (tx) =>
        tx.ticketMessage.create({ data: note({ idempotencyKey: 'compose-7' }) }),
      );
      await expect(
        asTenant(fx.a, (tx) =>
          tx.ticketMessage.create({ data: note({ idempotencyKey: 'compose-7' }) }),
        ),
      ).rejects.toThrow(/Unique constraint failed/i);

      // The same key from another workspace is its own message.
      await asTenant(fx.b, (tx) =>
        tx.ticketMessage.create({
          data: note({
            licenseId: fx.b.licenseId,
            ticketId: TICKET_B,
            authorId: fx.b.agentAccountId,
            idempotencyKey: 'compose-7',
          }),
        }),
      );
      // No key at all is never a collision.
      await asTenant(fx.a, async (tx) => {
        await tx.ticketMessage.create({ data: note() });
        await tx.ticketMessage.create({ data: note() });
      });
      expect(await owner.ticketMessage.count()).toBe(4);
    });

    it('holds one message per inbound Message-ID per licence', async () => {
      const inbound = {
        kind: 'customer_message',
        authorType: 'customer',
        authorId: fx.a.customerId,
        emailMessageId: '<dup@player.test>',
      } as const;
      await asTenant(fx.a, (tx) => tx.ticketMessage.create({ data: note(inbound) }));
      await expect(
        asTenant(fx.a, (tx) => tx.ticketMessage.create({ data: note(inbound) })),
      ).rejects.toThrow(/Unique constraint failed/i);
      await asTenant(fx.b, (tx) =>
        tx.ticketMessage.create({
          data: note({
            ...inbound,
            licenseId: fx.b.licenseId,
            ticketId: TICKET_B,
            authorId: fx.b.customerId,
          }),
        }),
      );
    });
  });

  // =========================================================================
  // What was written stays written
  // =========================================================================

  describe('what the application may change', () => {
    it("moves a reply's delivery fields, and nothing else", async () => {
      const reply = await asTenant(fx.a, (tx) =>
        tx.ticketMessage.create({ data: note({ kind: 'agent_reply', deliveryStatus: 'queued' }) }),
      );

      const sent = await asTenant(fx.a, (tx) =>
        tx.ticketMessage.update({
          where: { id: reply.id },
          data: {
            deliveryStatus: 'sent',
            emailMessageId: '<r1@mail.siyahtus.test>',
            inReplyTo: '<in-1@player.test>',
          },
        }),
      );
      expect(sent.deliveryStatus).toBe('sent');

      for (const data of [
        { bodyText: 'edited' },
        { authorId: fx.a.ownerAccountId },
        { ticketId: TICKET_A },
        { createdAt: new Date(0) },
      ]) {
        await expect(
          asTenant(fx.a, (tx) => tx.ticketMessage.updateMany({ where: { id: reply.id }, data })),
          JSON.stringify(data),
        ).rejects.toThrow(/permission denied/i);
      }
      await expect(asTenant(fx.a, (tx) => tx.ticketMessage.deleteMany({}))).rejects.toThrow(
        /permission denied/i,
      );
    });

    it('lets a message leave with its ticket (erasure deletes the ticket)', async () => {
      await asTenant(fx.a, (tx) => tx.ticketMessage.create({ data: note() }));
      await asTenant(fx.a, (tx) => tx.ticket.deleteMany({ where: { id: TICKET_A } }));
      expect(await owner.ticketMessage.count({ where: { ticketId: TICKET_A } })).toBe(0);
    });

    it('starts a ticket with no response and no message timestamps', async () => {
      const ticket = await owner.ticket.findUniqueOrThrow({ where: { id: TICKET_A } });
      expect(ticket).toMatchObject({
        firstResponseAt: null,
        lastCustomerMessageAt: null,
        lastAgentMessageAt: null,
      });
      const at = new Date('2026-10-25T09:00:00Z');
      const updated = await asTenant(fx.a, (tx) =>
        tx.ticket.update({
          where: { id: TICKET_A },
          data: { firstResponseAt: at, lastAgentMessageAt: at, lastCustomerMessageAt: at },
        }),
      );
      expect(updated.firstResponseAt?.toISOString()).toBe(at.toISOString());
    });
  });

  // =========================================================================
  // One vocabulary
  // =========================================================================

  describe('one vocabulary', () => {
    /** The quoted values of one CHECK constraint, as Postgres prints it. */
    async function checkValues(name: string): Promise<string[]> {
      const [row] = await owner.$queryRaw<Array<{ def: string }>>`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}
      `;
      if (!row) throw new Error(`no constraint ${name}`);
      return [...row.def.matchAll(/'([a-z_]+)'/g)].map((match) => match[1] as string).sort();
    }

    it('names the same kinds, authors and delivery states in the database, the contract and the types', async () => {
      expect(await checkValues('ticket_messages_kind_check')).toEqual(
        [...TICKET_MESSAGE_KINDS].sort(),
      );
      expect(await checkValues('ticket_messages_author_type_check')).toEqual(
        [...TICKET_MESSAGE_AUTHOR_TYPES].sort(),
      );
      expect(await checkValues('ticket_messages_delivery_status_check')).toEqual(
        [...TICKET_MESSAGE_DELIVERY_STATUSES].sort(),
      );

      const schemas = contractSchemas();
      const message = schemas['TicketMessage']?.properties ?? {};
      expect(message['kind']?.enum).toEqual([...TICKET_MESSAGE_KINDS]);
      expect(message['author_type']?.enum).toEqual([...TICKET_MESSAGE_AUTHOR_TYPES]);
      expect(message['delivery_status']?.enum).toEqual([...TICKET_MESSAGE_DELIVERY_STATUSES, null]);
      expect(schemas['TicketMessageAttachment']?.properties?.['scan_status']?.enum).toEqual([
        ...TICKET_ATTACHMENT_SCAN_STATUSES,
      ]);

      const input = schemas['TicketMessageInput']?.properties ?? {};
      expect(input['kind']?.enum).toEqual([...TICKET_COMPOSER_KINDS]);
      expect(input['set_status']?.enum).toEqual([...TICKET_REPLY_SET_STATUSES]);
      expect(input['text']?.maxLength).toBe(TICKET_MESSAGE_TEXT_MAX);
      expect(input['attachment_keys']?.maxItems).toBe(TICKET_MESSAGE_ATTACHMENTS_MAX);
      expect(input['idempotency_key']?.maxLength).toBe(128);
    });

    it('answers both refusals with 409', () => {
      expect(ERROR_STATUS.ticket_merged).toBe(409);
      expect(ERROR_STATUS.ticket_no_recipient).toBe(409);
    });
  });
});
