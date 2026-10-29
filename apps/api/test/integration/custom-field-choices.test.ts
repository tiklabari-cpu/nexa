/**
 * Choice fields and form order — WG-04 (tm 343).
 *
 * A form question can now be a list: `select` (one), `multiselect` (any) or
 * `topic` (one, and the choice routes the conversation). The acceptance
 * criteria this file holds:
 *
 *   - a list question is added, edited and reordered, and the widget is handed
 *     the form in that order and type;
 *   - a value that is not in the list is a 400;
 *   - a visitor who picks "Para çekme" lands in the Finans team's queue;
 *   - an option whose team was deleted since does not drop the conversation —
 *     the routing rules take it.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface Definition {
  id: string;
  type: string;
  form_placement: string | null;
  options: Array<{ value: string; label: string; target_group_id?: number | null }> | null;
  position: number;
}

interface WidgetField {
  definition_id: string;
  label: string;
  type: string;
  options?: Array<{ value: string; label: string; target_group_id?: unknown }>;
}

describe('choice fields and form order (WG-04)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let adminToken: string;
  let supportId: bigint;
  let financeId: bigint;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await seedDefaultBrand(owner, fx.a.licenseId);
    await clearRateLimits(server.app);

    // Support is the fallback every chat goes to by the rules; Finans is a team
    // only a topic choice sends anyone to.
    supportId = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Support' },
        select: { id: true },
      })
    ).id;
    financeId = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Finans' },
        select: { id: true },
      })
    ).id;
    await owner.routingRule.create({
      data: { licenseId: fx.a.licenseId, kind: 'chat', isFallback: true, targetGroupId: supportId },
    });

    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:rw', 'customers:rw'],
    });
  });

  const define = (body: Record<string, unknown>) =>
    server.post('/settings/custom-fields', { entity: 'contact', ...body }, auth(adminToken));

  async function created(body: Record<string, unknown>): Promise<Definition> {
    const response = await define(body);
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as Definition;
  }

  const patch = (id: string, body: unknown) =>
    server.patch(`/settings/custom-fields/${id}`, body, auth(adminToken));

  async function widgetToken() {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return response.json() as { token: string; customer_id: string; pre_chat_form: WidgetField[] };
  }

  function topic(targets: { withdrawal?: bigint; deposit?: bigint } = {}) {
    return created({
      label: 'Konu',
      type: 'topic',
      required: true,
      form_placement: 'pre_chat',
      options: [
        {
          value: 'withdrawal',
          label: 'Para çekme',
          target_group_id: Number(targets.withdrawal ?? financeId),
        },
        {
          value: 'deposit',
          label: 'Para yatırma',
          ...(targets.deposit ? { target_group_id: Number(targets.deposit) } : {}),
        },
      ],
    });
  }

  /** The team the visitor's first connection was routed to. */
  async function routedTeam(customerId: string): Promise<bigint | null> {
    const thread = await owner.thread.findFirstOrThrow({
      where: { chat: { customerId } },
      select: { groupId: true },
    });
    return thread.groupId;
  }

  it('adds, edits and reorders a list question; the widget gets that order and type (FR-MOD-08.7.7)', async () => {
    const name = await created({ label: 'Oyuncu adı', type: 'text', form_placement: 'pre_chat' });
    const game = await created({
      label: 'Oyun',
      type: 'select',
      form_placement: 'pre_chat',
      options: [
        { value: 'slots', label: 'Slot' },
        { value: 'poker', label: 'Poker' },
      ],
    });
    expect(game.options).toEqual([
      { value: 'slots', label: 'Slot' },
      { value: 'poker', label: 'Poker' },
    ]);
    expect([name.position, game.position]).toEqual([0, 1]);

    // Edit: reword one option, add another.
    const edited = await patch(game.id, {
      options: [
        { value: 'slots', label: 'Slot oyunları' },
        { value: 'poker', label: 'Poker' },
        { value: 'live', label: 'Canlı casino' },
      ],
    });
    expect(edited.statusCode, edited.body).toBe(200);

    // Reorder: the list question first.
    const moved = await patch(game.id, { position: 0 });
    expect(moved.statusCode).toBe(200);
    expect((moved.json() as Definition).position).toBe(0);

    const list = await server.get('/settings/custom-fields?entity=contact', auth(adminToken));
    expect((list.json() as { items: Definition[] }).items.map((d) => [d.id, d.position])).toEqual([
      [game.id, 0],
      [name.id, 1],
    ]);

    const { pre_chat_form } = await widgetToken();
    expect(pre_chat_form.map((f) => [f.label, f.type])).toEqual([
      ['Oyun', 'select'],
      ['Oyuncu adı', 'text'],
    ]);
    expect(pre_chat_form[0]!.options).toEqual([
      { value: 'slots', label: 'Slot oyunları' },
      { value: 'poker', label: 'Poker' },
      { value: 'live', label: 'Canlı casino' },
    ]);
  });

  it('moving a field to another form puts it last there and closes the gap behind it', async () => {
    const a = await created({ label: 'A', type: 'text', form_placement: 'pre_chat' });
    const b = await created({ label: 'B', type: 'text', form_placement: 'pre_chat' });
    const c = await created({ label: 'C', type: 'text', form_placement: 'post_chat' });

    const moved = await patch(a.id, { form_placement: 'post_chat' });
    expect((moved.json() as Definition).position).toBe(1);
    const rows = await owner.customFieldDefinition.findMany({
      where: { id: { in: [a.id, b.id, c.id] } },
      select: { id: true, position: true },
    });
    const at = new Map(rows.map((row) => [row.id, row.position]));
    expect([at.get(b.id), at.get(c.id), at.get(a.id)]).toEqual([0, 0, 1]);
  });

  it('refuses a value that is not in the list, on the CRM and on the pre-chat form', async () => {
    const game = await created({
      label: 'Oyun',
      type: 'select',
      form_placement: 'pre_chat',
      options: [{ value: 'slots', label: 'Slot' }],
    });
    const crm = await server.put(
      `/customers/${fx.a.customerId}/custom-fields`,
      { values: { [game.id]: 'roulette' } },
      auth(adminToken),
    );
    expect(crm.statusCode).toBe(400);

    const { token } = await widgetToken();
    const sent = await server.post(
      '/customer/chat/events',
      { text: 'Merhaba', custom_fields: { [game.id]: 'Slot' } },
      auth(token),
    );
    expect(sent.statusCode).toBe(400);
    expect(await owner.chat.count()).toBe(0);
  });

  it('stores a multiselect answer as its values, once each, in the options order', async () => {
    const games = await created({
      label: 'Oyunlar',
      type: 'multiselect',
      form_placement: 'pre_chat',
      options: [
        { value: 'slots', label: 'Slot' },
        { value: 'poker', label: 'Poker' },
      ],
    });
    const { token, customer_id } = await widgetToken();
    const sent = await server.post(
      '/customer/chat/events',
      { text: 'Merhaba', custom_fields: { [games.id]: '["poker","slots","poker"]' } },
      auth(token),
    );
    expect(sent.statusCode, sent.body).toBe(201);
    const stored = await owner.customFieldValue.findFirstOrThrow({
      where: { definitionId: games.id, customerId: customer_id },
    });
    expect(stored.value).toBe('["slots","poker"]');
  });

  it('routes a visitor who picks "Para çekme" to the Finans team', async () => {
    const field = await topic();
    const { token, customer_id, pre_chat_form } = await widgetToken();
    // The widget sees the choices, never the team behind them.
    expect(pre_chat_form[0]!.options).toEqual([
      { value: 'withdrawal', label: 'Para çekme' },
      { value: 'deposit', label: 'Para yatırma' },
    ]);

    const sent = await server.post(
      '/customer/chat/events',
      { text: 'Çekimim gelmedi', custom_fields: { [field.id]: 'withdrawal' } },
      auth(token),
    );
    expect(sent.statusCode, sent.body).toBe(201);
    expect(await routedTeam(customer_id)).toBe(financeId);

    // The answer is the contact's too.
    const stored = await owner.customFieldValue.findFirstOrThrow({
      where: { definitionId: field.id, customerId: customer_id },
    });
    expect(stored.value).toBe('withdrawal');
  });

  it('leaves a choice without a team to the routing rules', async () => {
    const field = await topic();
    const { token, customer_id } = await widgetToken();
    const sent = await server.post(
      '/customer/chat/events',
      { text: 'Yatırım', custom_fields: { [field.id]: 'deposit' } },
      auth(token),
    );
    expect(sent.statusCode).toBe(201);
    expect(await routedTeam(customer_id)).toBe(supportId);
  });

  it('does not drop the chat when the chosen option’s team was deleted since', async () => {
    const field = await topic();
    await owner.group.delete({
      where: { licenseId_id: { licenseId: fx.a.licenseId, id: financeId } },
    });

    const { token, customer_id } = await widgetToken();
    const sent = await server.post(
      '/customer/chat/events',
      { text: 'Çekimim gelmedi', custom_fields: { [field.id]: 'withdrawal' } },
      auth(token),
    );
    expect(sent.statusCode, sent.body).toBe(201);
    expect(await routedTeam(customer_id)).toBe(supportId);
  });

  it('keeps a topic to one per workspace, on the pre-chat form, routing to its own teams', async () => {
    await topic();
    const second = await define({
      label: 'Konu 2',
      type: 'topic',
      form_placement: 'pre_chat',
      options: [{ value: 'x', label: 'X' }],
    });
    expect(second.statusCode).toBe(400);

    await owner.customFieldDefinition.deleteMany({ where: { type: 'topic' } });
    const postChat = await define({
      label: 'Konu',
      type: 'topic',
      form_placement: 'post_chat',
      options: [{ value: 'x', label: 'X' }],
    });
    expect(postChat.statusCode).toBe(400);

    const otherTeam = await owner.group.create({
      data: { licenseId: fx.b.licenseId, name: 'Elsewhere' },
      select: { id: true },
    });
    const foreign = await define({
      label: 'Konu',
      type: 'topic',
      form_placement: 'pre_chat',
      options: [{ value: 'x', label: 'X', target_group_id: Number(otherTeam.id) }],
    });
    expect(foreign.statusCode).toBe(400);

    // And a topic cannot be moved off the pre-chat form once it is there.
    const field = await topic();
    expect((await patch(field.id, { form_placement: null })).statusCode).toBe(400);
  });

  it('refuses options a type does not take, and a list with none', async () => {
    expect(
      (await define({ label: 'Not', type: 'text', options: [{ value: 'a', label: 'A' }] }))
        .statusCode,
    ).toBe(400);
    expect((await define({ label: 'Liste', type: 'select', options: [] })).statusCode).toBe(400);
    expect(
      (
        await define({
          label: 'Liste',
          type: 'select',
          options: [{ value: 'a', label: 'A', target_group_id: Number(financeId) }],
        })
      ).statusCode,
    ).toBe(400);
  });

  it('holds the option rules in the database too', async () => {
    // A select with no options — what the CHECK refuses whatever the caller.
    await expect(
      owner.customFieldDefinition.create({
        data: { licenseId: fx.a.licenseId, entity: 'contact', label: 'Raw', type: 'select' },
      }),
    ).rejects.toThrow();
    await expect(
      owner.customFieldDefinition.create({
        data: {
          licenseId: fx.a.licenseId,
          entity: 'contact',
          label: 'Raw',
          type: 'select',
          options: [{ value: 'a', label: 'x'.repeat(81) }],
        },
      }),
    ).rejects.toThrow();
    await expect(
      owner.customFieldDefinition.create({
        data: {
          licenseId: fx.a.licenseId,
          entity: 'contact',
          label: 'Raw',
          type: 'topic',
          formPlacement: 'post_chat',
          options: [{ value: 'a', label: 'A' }],
        },
      }),
    ).rejects.toThrow();
  });
});
