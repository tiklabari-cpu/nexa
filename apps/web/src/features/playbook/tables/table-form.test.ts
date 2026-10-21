/**
 * The structured tables' form as data (tm 310.5 · AI-13): the fields are the
 * CSV's columns, a typed form becomes the contract's body (and back), and the
 * server's problems are read from the refusal.
 */
import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_TABLE_COLUMNS, KNOWLEDGE_TABLES } from '@siyahtus/types';
import {
  cellText,
  emptyState,
  fieldSpecs,
  payloadOf,
  problemsOf,
  staleCount,
  stateOf,
  type CellFormat,
  type TableRow,
} from './table-form.js';

const FORMAT: CellFormat = {
  yes: 'Yes',
  no: 'No',
  none: '—',
  date: (iso) => iso.slice(0, 10),
  option: (value) => `<${value}>`,
};

function row(over: Record<string, unknown> = {}): TableRow {
  return {
    id: 'row-1',
    brand_ids: [],
    owner_id: null,
    reviewed_at: '2026-10-01T00:00:00.000Z',
    review_interval_days: 14,
    review_due_at: '2026-10-15T00:00:00.000Z',
    stale: false,
    source: 'manual',
    created_by: null,
    updated_by: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...over,
  } as TableRow;
}

describe('the form’s fields are the CSV’s columns (AI-13)', () => {
  it.each(KNOWLEDGE_TABLES)('lists every writable field of %s, in the CSV order', (table) => {
    expect(fieldSpecs(table).map((spec) => spec.name)).toEqual(
      KNOWLEDGE_TABLE_COLUMNS[table].map(([name]) => name),
    );
  });

  it('marks the contract’s required fields, and nothing else', () => {
    const required = (table: (typeof KNOWLEDGE_TABLES)[number]): string[] =>
      fieldSpecs(table)
        .filter((spec) => spec.required)
        .map((spec) => spec.name);
    expect(required('payment_methods')).toEqual(['name', 'direction']);
    expect(required('bonuses')).toEqual(['name']);
    expect(required('kyc_documents')).toEqual(['doc_type']);
    expect(required('rules')).toEqual(['key', 'title']);
  });

  it('draws closed lists as selects with the column default first', () => {
    const specs = new Map(fieldSpecs('bonuses').map((spec) => [spec.name, spec]));
    expect(specs.get('type')?.input).toBe('select');
    expect(specs.get('type')?.options?.[0]).toBe('other');
    expect(specs.get('claim_method')?.options?.[0]).toBe('auto');
    expect(specs.get('wagering_base')?.optional).toBe(true);
    expect(specs.get('excluded_method_ids')?.input).toBe('methods');
    expect(specs.get('active_to')?.input).toBe('date');
  });
});

describe('a blank form carries the column defaults (AI-13-S2)', () => {
  it.each([
    ['payment_methods', '14'],
    ['bonuses', '30'],
    ['kyc_documents', '90'],
    ['rules', '90'],
  ] as const)('reviews %s every %s days', (table, days) => {
    expect(emptyState(table).reviewIntervalDays).toBe(days);
  });

  it('starts a payment method active, in TRY, as a deposit with no reference format', () => {
    const { fields } = emptyState('payment_methods');
    expect(fields).toMatchObject({
      active: true,
      currency: 'TRY',
      direction: 'deposit',
      reference_format: 'none',
      requires_site_request: false,
    });
  });
});

describe('a typed form becomes the contract’s body', () => {
  it('turns numbers, lists and booleans into values and leaves blank optionals out of a create', () => {
    const state = emptyState('payment_methods');
    state.fields['name'] = ' Papara ';
    state.fields['aliases'] = 'PPR, papara kart\n';
    state.fields['min_amount'] = '100';
    state.fields['max_amount'] = '50000,5';
    state.fields['expected_minutes'] = '30';
    state.fields['third_party_allowed'] = true;

    const { body, problems } = payloadOf('payment_methods', state, 'create');

    expect(problems).toEqual([]);
    expect(body).toMatchObject({
      name: 'Papara',
      aliases: ['PPR', 'papara kart'],
      direction: 'deposit',
      min_amount: 100,
      max_amount: 50000.5,
      expected_minutes: 30,
      third_party_allowed: true,
      working_hours: null,
      common_errors: [],
      review_interval_days: 14,
      brand_ids: [],
    });
    expect(body).not.toHaveProperty('delay_threshold_minutes');
    expect(body).not.toHaveProperty('customer_notes');
    expect(body).not.toHaveProperty('owner_id');
  });

  it('sends null for a cleared optional field when editing, so clearing it is possible', () => {
    const edited = stateOf(
      'payment_methods',
      row({ name: 'Papara', min_amount: 100, currency: 'TRY' }),
    );
    edited.fields['min_amount'] = '';
    edited.fields['customer_notes'] = '';

    const { body } = payloadOf('payment_methods', edited, 'update');

    expect(body['min_amount']).toBeNull();
    expect(body['customer_notes']).toBeNull();
    // A field with a default is never cleared to null.
    expect(body['currency']).toBe('TRY');
    expect(body['owner_id']).toBeNull();
  });

  it('always sends a required field so the server names it, and the chosen brands', () => {
    const state = emptyState('rules');
    state.brandIds = ['brand-a'];

    const { body } = payloadOf('rules', state, 'create');

    expect(body).toMatchObject({ key: '', title: '', brand_ids: ['brand-a'], category: 'other' });
  });

  it('parses JSON fields and refuses JSON that does not parse', () => {
    const state = emptyState('payment_methods');
    state.fields['name'] = 'Havale';
    state.fields['working_hours'] =
      '{"timezone":"Europe/Istanbul","windows":[],"closed_on_bank_holidays":true}';
    state.fields['common_errors'] = '[{"code":"E1"';

    const { body, problems } = payloadOf('payment_methods', state, 'create');

    expect(body['working_hours']).toEqual({
      timezone: 'Europe/Istanbul',
      windows: [],
      closed_on_bank_holidays: true,
    });
    expect(problems).toEqual([{ field: 'common_errors', code: 'invalid' }]);
  });

  it('refuses a number that is not a number and a review interval that is not whole days', () => {
    const state = emptyState('payment_methods');
    state.fields['name'] = 'Papara';
    state.fields['min_amount'] = 'abc';
    state.reviewIntervalDays = '1.5';

    const { problems } = payloadOf('payment_methods', state, 'create');

    expect(problems).toEqual([
      { field: 'min_amount', code: 'invalid' },
      { field: 'review_interval_days', code: 'invalid' },
    ]);
  });

  it('writes a campaign’s start at the start of the local day and its end at the end of it', () => {
    const state = emptyState('bonuses');
    state.fields['name'] = 'Hoş geldin';
    state.fields['active_from'] = '2026-11-01';
    state.fields['active_to'] = '2026-11-30';

    const { body } = payloadOf('bonuses', state, 'create');

    expect(new Date(body['active_from'] as string).getHours()).toBe(0);
    expect(new Date(body['active_to'] as string).getHours()).toBe(23);
    expect(new Date(body['active_to'] as string).getDate()).toBe(30);
  });

  it('carries the excluded payment methods of a bonus', () => {
    const state = emptyState('bonuses');
    state.fields['name'] = 'Hoş geldin';
    state.excludedMethodIds = ['m-1', 'm-2'];

    expect(payloadOf('bonuses', state, 'create').body['excluded_method_ids']).toEqual([
      'm-1',
      'm-2',
    ]);
  });
});

describe('an existing row is edited as text and goes back unchanged', () => {
  it('round-trips a payment method through the form', () => {
    const existing = row({
      name: 'Papara',
      aliases: ['PPR'],
      direction: 'withdrawal',
      currency: 'TRY',
      min_amount: 100,
      max_amount: null,
      expected_minutes: 30,
      delay_threshold_minutes: 60,
      working_hours: { timezone: 'Europe/Istanbul', windows: [], closed_on_bank_holidays: false },
      requires_site_request: true,
      reference_format: 'digits',
      common_errors: [],
      active: false,
      brand_ids: ['brand-a'],
      owner_id: 'acct-1',
      review_interval_days: 7,
    });

    const state = stateOf('payment_methods', existing);
    const { body, problems } = payloadOf('payment_methods', state, 'update');

    expect(problems).toEqual([]);
    expect(body).toMatchObject({
      name: 'Papara',
      aliases: ['PPR'],
      direction: 'withdrawal',
      min_amount: 100,
      max_amount: null,
      delay_threshold_minutes: 60,
      requires_site_request: true,
      reference_format: 'digits',
      active: false,
      brand_ids: ['brand-a'],
      owner_id: 'acct-1',
      review_interval_days: 7,
    });
    expect(body['working_hours']).toEqual(existing['working_hours']);
  });
});

describe('the list', () => {
  it('shows a payment method’s limits as one range with its currency', () => {
    const limits = (over: Record<string, unknown>): string =>
      cellText('limits', row({ currency: 'TRY', ...over }), FORMAT);
    expect(limits({ min_amount: 100, max_amount: 50000 })).toBe('100 – 50000 TRY');
    expect(limits({ min_amount: 100, max_amount: null })).toBe('100 – … TRY');
    expect(limits({ min_amount: null, max_amount: null })).toBe('—');
  });

  it('shows a rule’s text value, else its number with the unit', () => {
    expect(cellText('value', row({ value_text: 'Günde 3', numeric_value: 3 }), FORMAT)).toBe(
      'Günde 3',
    );
    expect(
      cellText('value', row({ value_text: null, numeric_value: 50000, unit: 'TRY' }), FORMAT),
    ).toBe('50000 TRY');
  });

  it('words booleans, closed lists and dates', () => {
    expect(cellText('active', row({ active: true }), FORMAT)).toBe('Yes');
    expect(cellText('direction', row({ direction: 'deposit' }), FORMAT)).toBe('<deposit>');
    expect(cellText('active_to', row({ active_to: '2026-11-30T20:59:59.000Z' }), FORMAT)).toBe(
      '2026-11-30',
    );
    expect(cellText('when_required', row({ when_required: null }), FORMAT)).toBe('—');
  });

  it('counts the rows past their review date', () => {
    expect(staleCount([{ stale: true }, { stale: false }, { stale: true }])).toBe(2);
  });
});

describe('the server’s refusal', () => {
  it('reads every problem as field and code, and nothing else from a malformed list', () => {
    expect(
      problemsOf({
        problems: [
          { field: 'min_amount', code: 'min_above_max' },
          { field: 'name', code: 'taken' },
          { field: 7, code: 'x' },
          null,
        ],
      }),
    ).toEqual([
      { field: 'min_amount', code: 'min_above_max' },
      { field: 'name', code: 'taken' },
    ]);
    expect(problemsOf(undefined)).toEqual([]);
    expect(problemsOf({ reason: 'csv_header_missing' })).toEqual([]);
  });
});
