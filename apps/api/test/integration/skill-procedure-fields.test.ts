/**
 * A skill's procedure fields (tm 296.2 · SiyahTuş analysis AI-03 · ADR-14a):
 * the `skills` columns `20261018090000_skills_procedure_fields` adds, the
 * contract's `Skill` / `SkillProcedure` / `ProcedureProblemDetails`, and the
 * write path that judges a procedure with `validateSkillProcedure` before it
 * is stored.
 *
 * Running a procedure is `ai-procedure.test.ts`'s (#296.3); here, only that a
 * procedure skill may now be turned on.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadOpenApiDocument } from '@siyahtus/contract';
import {
  COND_FNS,
  COND_OPS,
  PROC_STEP_TYPES,
  PROCEDURE_PROBLEM_CODES,
  PROCEDURE_SECTIONS,
  PROCEDURE_WARNING_CODES,
  SENSITIVE_SLOT_CATEGORIES,
  SKILL_MODES,
  SKILL_PROCEDURE_FIELDS,
  SLOT_PROBLEM_CODES,
  SLOT_TYPES,
} from '@siyahtus/types';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Json = Record<string, unknown>;

interface SkillBody {
  id: string;
  mode: string;
  when_to_use: string | null;
  examples: string[];
  priority: number;
  slots: Json[];
  procedure: Json | null;
  locked: boolean;
  template_key: string | null;
  template_version: number | null;
  is_fallback: boolean;
  active: boolean;
  steps: unknown[];
}

interface ErrorBody {
  error: { type: string; message: string; details?: Json };
}

describe('skill procedure fields (tm 296.2)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let token: string;
  let financeGroupId: number;
  let foreignGroupId: number;

  const auth = () => ({ authorization: `Bearer ${token}` });

  /** Araştırma §3.1, cut down: method and time → within the expected time, wait; else finance. */
  function deposit(): Json {
    return {
      name: 'Yatırım geçmedi',
      mode: 'procedure',
      when_to_use: 'Oyuncu yatırımının hesabına geçmediğini söylüyor.',
      examples: ['param yatmadı', ' havale attım gözükmüyor '],
      priority: 50,
      slots: [
        {
          name: 'yontem',
          label: 'Ödeme yöntemi',
          type: 'enum',
          ask: 'Hangi yöntemle yatırım yaptınız?',
          validate: { enum_source: 'payment_methods.deposit' },
        },
        {
          name: 'islem_zamani',
          label: 'İşlem zamanı',
          type: 'datetime',
          ask: 'Saat kaçta yatırdınız?',
        },
      ],
      procedure: {
        steps: [
          { id: 'sor', type: 'collect', slots: ['yontem', 'islem_zamani'] },
          {
            id: 'sure',
            type: 'check',
            when: {
              fn: {
                name: 'elapsed_minutes',
                args: ['islem_zamani'],
                op: 'lt',
                value: { fact: 'method.expected_minutes' },
              },
            },
            then: { type: 'resolve', outcome: 'resolved_waiting', followup_template: 'bekle' },
          },
          {
            id: 'devir',
            type: 'handoff',
            reason_code: 'expected_time_exceeded',
            target: { group_id: financeGroupId },
          },
        ],
        templates: [
          { key: 'bekle', text: '{yontem} genellikle {method.expected_minutes} dakikada geçer.' },
        ],
      },
    };
  }

  function withProcedure(change: (procedure: Json) => Json): Json {
    const skill = deposit();
    return { ...skill, procedure: change(skill['procedure'] as Json) };
  }

  function steps(skill: Json): Json[] {
    return (skill['procedure'] as Json)['steps'] as Json[];
  }

  async function create(body: Json) {
    return server.post('/skills', body, auth());
  }

  async function createDeposit(): Promise<SkillBody> {
    const response = await create(deposit());
    expect(response.statusCode).toBe(201);
    return response.json() as SkillBody;
  }

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
    await clearRateLimits(server.app);
    token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:rw'],
    });
    const finance = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Finans' },
      select: { id: true },
    });
    financeGroupId = Number(finance.id);
    const foreign = await owner.group.create({
      data: { licenseId: fx.b.licenseId, name: 'Başka kiracının ekibi' },
      select: { id: true },
    });
    foreignGroupId = Number(foreign.id);
  });

  it('reads a skill written before procedures as single, every new field at its default — no data move', async () => {
    const legacy = await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        name: 'Order status',
        kind: 'ai_agent',
        steps: [{ type: 'send_message', source: 'text', text: 'Hi.' }],
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    const response = await server.get(`/skills/${legacy.id}`, auth());
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mode: 'single',
      when_to_use: null,
      examples: [],
      priority: 100,
      slots: [],
      procedure: null,
      locked: false,
      template_key: null,
      template_version: null,
      is_fallback: false,
      steps: [{ type: 'send_message', source: 'text', text: 'Hi.' }],
    });
  });

  it('stores a procedure: the skill’s own fields in their columns, the rest in procedure, defaults filled, created inactive', async () => {
    const created = await createDeposit();
    expect(created).toMatchObject({
      mode: 'procedure',
      when_to_use: 'Oyuncu yatırımının hesabına geçmediğini söylüyor.',
      examples: ['param yatmadı', 'havale attım gözükmüyor'],
      priority: 50,
      active: false,
      steps: [],
      locked: false,
    });
    expect(
      created.slots.map((slot) => [slot['name'], slot['required'], slot['max_attempts']]),
    ).toEqual([
      ['yontem', 'always', 2],
      ['islem_zamani', 'always', 2],
    ]);
    expect(Object.keys(created.procedure ?? {}).sort()).toEqual([...SKILL_PROCEDURE_FIELDS].sort());
    expect(created.procedure).toMatchObject({
      handoff: { conditions: [], card_fields: [] },
      limits: { max_turns: 12 },
    });

    const row = await owner.skill.findUniqueOrThrow({ where: { id: created.id } });
    expect([row.mode, row.whenToUse, row.priority, row.examples]).toEqual([
      'procedure',
      created.when_to_use,
      50,
      created.examples,
    ]);
    expect(row.procedure).toStrictEqual(created.procedure);
    expect(row.slots).toStrictEqual(created.slots);

    const read = await server.get(`/skills/${created.id}`, auth());
    expect(read.json()).toMatchObject({ procedure: created.procedure, slots: created.slots });
  });

  it('refuses on save what AI-03 lists — with the code the editor words, storing nothing', async () => {
    const cases: Array<[string, Json, string]> = [
      [
        'a goto to no step',
        withProcedure((p) => ({
          ...p,
          steps: [
            ...(p['steps'] as Json[]).slice(0, 1),
            {
              id: 'sure',
              type: 'check',
              when: { slot: { name: 'yontem', op: 'exists' } },
              then: { goto: 'yok' },
            },
            ...(p['steps'] as Json[]).slice(2),
          ],
        })),
        'procedure_unknown_goto',
      ],
      [
        'a loop nothing in which waits',
        withProcedure((p) => ({
          ...p,
          steps: [
            { id: 'sor', type: 'collect', slots: ['yontem', 'islem_zamani'] },
            { id: 'bilgi', type: 'say', instruction: 'Kontrol ediyorum.' },
            {
              id: 'geri',
              type: 'check',
              when: { slot: { name: 'yontem', op: 'exists' } },
              then: { goto: 'bilgi' },
            },
            { id: 'devir', type: 'handoff', reason_code: 'needs_finance' },
          ],
        })),
        'procedure_loop_without_collect',
      ],
      [
        'a collect of three slots',
        {
          ...withProcedure((p) => ({
            ...p,
            steps: [
              { id: 'sor', type: 'collect', slots: ['yontem', 'islem_zamani', 'tutar'] },
              { id: 'devir', type: 'handoff', reason_code: 'needs_finance' },
            ],
          })),
          slots: [
            ...(deposit()['slots'] as Json[]),
            { name: 'tutar', label: 'Tutar', type: 'money', ask: 'Ne kadar yatırdınız?' },
          ],
        },
        'procedure_collect_too_many_slots',
      ],
      [
        'a template variable that names nothing',
        withProcedure((p) => ({
          ...p,
          templates: [{ key: 'bekle', text: '{bilinmeyen} dakika.' }],
        })),
        'procedure_unknown_variable',
      ],
      [
        'a "şifre" slot',
        {
          ...deposit(),
          slots: [
            ...(deposit()['slots'] as Json[]),
            { name: 'sifre', label: 'Şifre', type: 'text', ask: 'Hesap şifrenizi yazar mısınız?' },
          ],
        },
        'slot_sensitive_forbidden',
      ],
      [
        'a team this license does not have',
        withProcedure((p) => ({
          ...p,
          steps: [
            ...(p['steps'] as Json[]).slice(0, 2),
            {
              id: 'devir',
              type: 'handoff',
              reason_code: 'x',
              target: { group_id: foreignGroupId },
            },
          ],
        })),
        'procedure_unknown_target',
      ],
    ];

    for (const [label, body, reason] of cases) {
      const response = await create(body);
      expect([label, response.statusCode]).toEqual([label, 400]);
      const { error } = response.json() as ErrorBody;
      expect([label, error.type, error.details?.['reason']]).toEqual([label, 'validation', reason]);
    }
    const sensitive = (await create(cases[4]![1])).json() as ErrorBody;
    expect(sensitive.error.details).toMatchObject({
      section: 'slots',
      position: 3,
      slot: 'sifre',
      category: 'password',
    });
    expect(await owner.skill.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
  });

  it('a procedure needs its when_to_use and a procedure object holding only its four fields', async () => {
    const missing = await create({ ...deposit(), when_to_use: undefined });
    expect((missing.json() as ErrorBody).error.details).toMatchObject({
      reason: 'procedure_needs_when_to_use',
      section: 'procedure',
      field: 'when_to_use',
    });
    const none = await create({ ...deposit(), procedure: undefined });
    expect((none.json() as ErrorBody).error.details?.['reason']).toBe('procedure_not_object');
    const misplaced = await create(withProcedure((p) => ({ ...p, priority: 5 })));
    expect((misplaced.json() as ErrorBody).error.details).toMatchObject({
      reason: 'procedure_unknown_field',
      field: 'priority',
    });
  });

  it('a single skill takes the selection fields by the same rules; slots and a procedure are a procedure’s', async () => {
    const created = await create({
      name: 'Bonus',
      when_to_use: ' Oyuncu bonusunu soruyor. ',
      examples: ['bonusum nerede'],
      priority: 20,
      steps: [{ type: 'send_message', source: 'text', text: 'Bakıyorum.' }],
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      mode: 'single',
      when_to_use: 'Oyuncu bonusunu soruyor.',
      examples: ['bonusum nerede'],
      priority: 20,
      procedure: null,
    });

    const badPriority = await create({ name: 'Bonus', priority: 0 });
    expect((badPriority.json() as ErrorBody).error.details).toMatchObject({
      reason: 'procedure_bad_priority',
      field: 'priority',
    });
    for (const field of ['slots', 'procedure'] as const) {
      const response = await create({ name: 'Bonus', [field]: deposit()[field] });
      expect(response.statusCode).toBe(400);
      expect((response.json() as ErrorBody).error.details).toMatchObject({
        reason: 'procedure_unknown_field',
        field,
      });
    }
  });

  it('PATCH judges the procedure whole: dropping a slot re-checks the steps that name it', async () => {
    const created = await createDeposit();
    const patch = (body: Json) => server.patch(`/skills/${created.id}`, body, auth());

    const dropped = await patch({ slots: [(deposit()['slots'] as Json[])[0]] });
    expect(dropped.statusCode).toBe(400);
    expect((dropped.json() as ErrorBody).error.details).toMatchObject({
      reason: 'slot_unknown_reference',
      section: 'steps',
    });

    const reprioritised = await patch({ priority: 10 });
    expect(reprioritised.statusCode).toBe(200);
    expect(reprioritised.json()).toMatchObject({ priority: 10, procedure: created.procedure });

    const replaced = await patch({
      procedure: { steps: [{ id: 'devir', type: 'handoff', reason_code: 'needs_finance' }] },
    });
    expect(replaced.statusCode).toBe(200);
    const body = replaced.json() as SkillBody;
    expect(steps(body as unknown as Json)).toEqual([
      { id: 'devir', type: 'handoff', reason_code: 'needs_finance' },
    ]);
    expect(body.procedure?.['templates']).toEqual([]);
    expect(body.slots).toEqual(created.slots);
  });

  it('obeys no body on the server’s fields: locked, template_key, template_version', async () => {
    const serverFields = {
      locked: true,
      template_key: 'x',
      template_version: 3,
    };
    const created = await create({ ...deposit(), ...serverFields });
    expect(created.statusCode).toBe(201);
    const skill = created.json() as SkillBody;
    const patched = await server.patch(
      `/skills/${skill.id}`,
      { name: 'Yatırım', ...serverFields },
      auth(),
    );
    expect(patched.statusCode).toBe(200);
    for (const body of [skill, patched.json() as SkillBody]) {
      expect(body).toMatchObject({
        locked: false,
        template_key: null,
        template_version: null,
        is_fallback: false,
      });
    }
  });

  it('a locked copy changes only its texts and its team — not its steps, not its mode', async () => {
    const created = await createDeposit();
    await owner.skill.update({
      where: { id: created.id },
      data: { locked: true, templateKey: 'deposit_not_credited', templateVersion: 1 },
    });
    const patch = (body: Json) => server.patch(`/skills/${created.id}`, body, auth());

    const reworded = await patch({
      procedure: {
        ...created.procedure,
        templates: [
          {
            key: 'bekle',
            text: '{yontem} ile yatırımlar {method.expected_minutes} dakikada geçer.',
          },
        ],
      },
    });
    expect(reworded.statusCode).toBe(200);
    expect(reworded.json()).toMatchObject({ locked: true, template_key: 'deposit_not_credited' });

    const restructured = await patch({
      procedure: {
        ...created.procedure,
        steps: steps(created as unknown as Json)
          .slice(0, 1)
          .concat(steps(created as unknown as Json).slice(2)),
      },
    });
    expect(restructured.statusCode).toBe(400);
    expect((restructured.json() as ErrorBody).error.details?.['reason']).toBe(
      'procedure_locked_change',
    );

    const remoded = await patch({ mode: 'single' });
    expect((remoded.json() as ErrorBody).error.details).toMatchObject({
      reason: 'procedure_locked_change',
      field: 'mode',
    });
  });

  it('a procedure skill can be turned on now the executor runs it (#296.3), and a single one may become one while on', async () => {
    const created = await createDeposit();
    const on = await server.patch(`/skills/${created.id}`, { active: true }, auth());
    expect(on.statusCode).toBe(200);
    expect((on.json() as SkillBody).active).toBe(true);

    const single = await create({
      name: 'Order status',
      steps: [{ type: 'send_message', source: 'text', text: 'Hi.' }],
    });
    const id = (single.json() as SkillBody).id;
    expect((await server.patch(`/skills/${id}`, { active: true }, auth())).statusCode).toBe(200);
    const switched = await server.patch(
      `/skills/${id}`,
      {
        mode: 'procedure',
        when_to_use: 'x',
        procedure: deposit()['procedure'],
        slots: deposit()['slots'],
      },
      auth(),
    );
    expect(switched.statusCode).toBe(200);
    expect(await owner.skill.findUniqueOrThrow({ where: { id } })).toMatchObject({
      mode: 'procedure',
      active: true,
    });
  });

  it('the database holds the mode, the priority range and a procedure skill’s procedure', async () => {
    const insert = (columns: string, values: string) =>
      owner.$executeRawUnsafe(
        `INSERT INTO skills (id, license_id, name, kind, updated_at, ${columns})
         VALUES (gen_random_uuid(), ${fx.a.licenseId}, 'x', 'ai_agent', now(), ${values})`,
      );
    await expect(insert('mode', `'graph'`)).rejects.toThrow(/skills_mode_check/);
    await expect(insert('priority', '0')).rejects.toThrow(/skills_priority_check/);
    await expect(insert('mode', `'procedure'`)).rejects.toThrow(/skills_procedure_mode_check/);
    await expect(insert('mode, procedure', `'procedure', '{"steps": []}'`)).resolves.toBe(1);
  });

  it('the contract’s vocabularies are the validator’s', () => {
    const schemas = (
      loadOpenApiDocument() as unknown as {
        components: { schemas: Record<string, { properties: Record<string, Json> }> };
      }
    ).components.schemas;
    const enumOf = (schema: string, property: string) =>
      schemas[schema]!.properties[property]!['enum'] as string[];
    const condition = schemas['ProcedureCondition']!.properties;

    expect(enumOf('Skill', 'mode')).toEqual([...SKILL_MODES]);
    expect(enumOf('ProcedureProblemDetails', 'reason')).toEqual([
      ...PROCEDURE_PROBLEM_CODES,
      ...SLOT_PROBLEM_CODES,
      ...PROCEDURE_WARNING_CODES,
    ]);
    expect(enumOf('ProcedureProblemDetails', 'section')).toEqual([...PROCEDURE_SECTIONS]);
    expect(enumOf('ProcedureProblemDetails', 'category')).toEqual([...SENSITIVE_SLOT_CATEGORIES]);
    expect(enumOf('ProcedureStep', 'type')).toEqual([...PROC_STEP_TYPES]);
    expect(enumOf('SlotDef', 'type')).toEqual([...SLOT_TYPES]);
    expect(schemas['ProcedureConditionOp']).toMatchObject({ enum: [...COND_OPS] });
    expect((condition['fn']!['properties'] as Record<string, Json>)['name']!['enum']).toEqual([
      ...COND_FNS,
    ]);
    expect(Object.keys(schemas['SkillProcedure']!.properties).sort()).toEqual(
      [...SKILL_PROCEDURE_FIELDS].sort(),
    );
  });
});
