/**
 * Settings › Security › Roles and permissions (RL-02 · tm 325.4).
 *
 * Who may do what in this workspace, as the matrix the Founder edits: rows are
 * capabilities grouped the way `CAPABILITY_GROUPS` orders them, columns are the
 * four roles (Kurucu, Yönetici, Ekip Lideri, Ekip Üyesi). A pure consumer of
 * `GET`/`PUT /settings/permissions` (tm 325.2) — every value, default, lock and
 * floor on screen is the server's word, so the screen cannot offer a cell the
 * endpoint would refuse.
 *
 * - **Locked cells are drawn, not hidden.** The Kurucu column, the Founder-only
 *   rows and the cells below a row's floor carry a lock and say why; a matrix
 *   with holes in it would read as "not decided yet".
 * - **Save is the GV-06 high-risk flow** (`SettingsForm` `highRisk`): Save →
 *   each moved cell's before/after → a required reason → confirm. The reason
 *   travels in the PUT body and the API files it with the audit entry and the
 *   Yöneticiler's mail (RL-02-S5).
 * - **"Reset to default" sends the default value.** A cell set to its default
 *   stops being the workspace's choice (the server drops the stored row), so a
 *   later change of default — K7's (tm 325.5) — reaches it.
 * - **Only the Kurucu writes** (`PUT` is `exactRole: owner`). A Yönetici reads
 *   the same table with the controls off and no Save bar; Ekip Lideri and Ekip
 *   Üyesi are not shown the section (the `GET` is `minimumRole: admin`) and
 *   read their own row on "My permissions" (`MyPermissions.tsx`).
 *
 * The draft holds editable cells only, keyed `capability|role`; a PUT sends
 * just the cells that moved.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { SettingsForm } from '../../components/settings/SettingsForm.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';

type MatrixRole = 'owner' | 'admin' | 'team_lead' | 'agent';
type CapabilityValue = 'off' | 'on' | 'none' | 'own' | 'team' | 'all';
type CapabilityLock = 'owner_column' | 'owner_only' | 'below_floor';

interface PermissionCell {
  role: MatrixRole;
  value: CapabilityValue;
  default: CapabilityValue;
  lock: CapabilityLock | null;
}

interface PermissionCapability {
  key: string;
  group: string;
  values: CapabilityValue[];
  floor_role: MatrixRole;
  owner_only: boolean;
  cells: PermissionCell[];
}

export interface PermissionMatrix {
  version: number;
  roles: MatrixRole[];
  capabilities: PermissionCapability[];
}

/** The draft: an editable cell's value, keyed {@link cellKey}. */
type Draft = Record<string, CapabilityValue>;

export const PERMISSIONS_KEY = ['settings', 'permissions'] as const;

/** Who the `GET` answers (`minimumRole: admin`); everyone else is not shown a 403. */
const VIEWER_ROLES = new Set(['owner', 'viceowner', 'admin']);

function cellKey(capability: string, role: MatrixRole): string {
  return `${capability}|${role}`;
}

function parseKey(key: string): { capability: string; role: MatrixRole } {
  const at = key.lastIndexOf('|');
  return { capability: key.slice(0, at), role: key.slice(at + 1) as MatrixRole };
}

/** A switch is exactly `off`/`on`; anything else is a level picked from a list. */
function isSwitch(values: readonly CapabilityValue[]): boolean {
  return values.length === 2 && values[0] === 'off' && values[1] === 'on';
}

export function capabilityLabel(t: TFunction, key: string): string {
  return t(`permissions.capability.${key}`);
}

export function valueLabel(t: TFunction, value: string): string {
  return t(`permissions.value.${value}`);
}

export function roleLabel(t: TFunction, role: string): string {
  return t(`team.role.${role}`);
}

export function PermissionsMatrix({ canEdit }: { canEdit: boolean }): ReactElement | null {
  const role = useAuth((s) => s.agent?.role ?? null);
  if (role === null || !VIEWER_ROLES.has(role)) return null;
  return <MatrixCard canEdit={canEdit} />;
}

function MatrixCard({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const matrix = useQuery({
    queryKey: PERMISSIONS_KEY,
    queryFn: () => api.get<PermissionMatrix>('/settings/permissions'),
  });

  return (
    <Section
      id="section-permissions"
      title={t('settings.permissions.title')}
      description={t('settings.permissions.description')}
    >
      {matrix.error ? (
        <ErrorNotice message={t('settings.permissions.loadError')} />
      ) : (
        <Card>
          {matrix.isPending ? (
            <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : (
            <MatrixForm
              matrix={matrix.data}
              canEdit={canEdit}
              onSaved={(data) => queryClient.setQueryData(PERMISSIONS_KEY, data)}
            />
          )}
        </Card>
      )}
    </Section>
  );
}

function MatrixForm({
  matrix,
  canEdit,
  onSaved,
}: {
  matrix: PermissionMatrix;
  canEdit: boolean;
  onSaved: (data: PermissionMatrix) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  // Memoised on the response: the form compares `saved` with its baseline, and
  // a fresh object every render would be a fresh comparison for nothing.
  const saved = useMemo<Draft>(() => {
    const draft: Draft = {};
    for (const capability of matrix.capabilities) {
      for (const cell of capability.cells) {
        if (cell.lock === null) draft[cellKey(capability.key, cell.role)] = cell.value;
      }
    }
    return draft;
  }, [matrix]);

  const defaults = useMemo<Draft>(() => {
    const draft: Draft = {};
    for (const capability of matrix.capabilities) {
      for (const cell of capability.cells) {
        if (cell.lock === null) draft[cellKey(capability.key, cell.role)] = cell.default;
      }
    }
    return draft;
  }, [matrix]);

  const labels = useMemo(() => {
    const names: Record<string, string> = {};
    for (const key of Object.keys(saved)) {
      const { capability, role } = parseKey(key);
      names[key] = t('settings.permissions.cellName', {
        capability: capabilityLabel(t, capability),
        role: roleLabel(t, role),
      });
    }
    return names;
  }, [saved, t]);

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <p className="text-xs text-content-secondary">{t('settings.permissions.ownerOnly')}</p>
        <MatrixTable matrix={matrix} values={saved} defaults={defaults} />
        <LockLegend />
      </div>
    );
  }

  return (
    <SettingsForm<Draft>
      saved={saved}
      label={t('settings.permissions.title')}
      highRisk={{
        labels,
        format: (_key, value) => valueLabel(t, String(value)),
      }}
      onSave={async (values, { reason }) => {
        const changes = Object.keys(values)
          .filter((key) => values[key] !== saved[key])
          .map((key) => {
            const { capability, role } = parseKey(key);
            return { role, capability, value: values[key] };
          });
        const data = await api.put<PermissionMatrix>('/settings/permissions', { changes, reason });
        onSaved(data);
      }}
    >
      {(form) => {
        const custom = Object.keys(form.values).filter((key) => form.values[key] !== defaults[key]);
        return (
          <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-content-secondary">
                {t('settings.permissions.howItWorks')}
              </p>
              <button
                type="button"
                disabled={custom.length === 0}
                onClick={() =>
                  form.patch(Object.fromEntries(custom.map((key) => [key, defaults[key]!])))
                }
                className="rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                {t('settings.permissions.resetAll')}
              </button>
            </div>
            <MatrixTable
              matrix={matrix}
              values={form.values}
              defaults={defaults}
              onChange={(key, value) => form.setValue(key, value)}
            />
            <LockLegend />
          </div>
        );
      }}
    </SettingsForm>
  );
}

function MatrixTable({
  matrix,
  values,
  defaults,
  onChange,
}: {
  matrix: PermissionMatrix;
  values: Draft;
  defaults: Draft;
  /** Absent: the table is read-only. */
  onChange?: (key: string, value: CapabilityValue) => void;
}): ReactElement {
  const t = useTranslate();
  const groups = [...new Set(matrix.capabilities.map((c) => c.group))];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{t('settings.permissions.tableCaption')}</caption>
        <thead>
          <tr className="text-2xs uppercase tracking-wide text-content-tertiary">
            <th scope="col" className="py-1 pr-3 font-medium">
              {t('settings.permissions.col.capability')}
            </th>
            {matrix.roles.map((role) => (
              <th key={role} scope="col" className="py-1 pr-3 font-medium">
                {roleLabel(t, role)}
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group}>
            <tr className="border-t border-border">
              <th
                scope="colgroup"
                colSpan={matrix.roles.length + 1}
                className="pb-1 pt-3 text-xs font-semibold text-content-secondary"
              >
                {t(`permissions.group.${group}`)}
              </th>
            </tr>
            {matrix.capabilities
              .filter((capability) => capability.group === group)
              .map((capability) => (
                <tr
                  key={capability.key}
                  data-capability={capability.key}
                  className="border-t border-border/60"
                >
                  <th scope="row" className="py-1.5 pr-3 font-medium">
                    {capabilityLabel(t, capability.key)}
                  </th>
                  {matrix.roles.map((role) => {
                    const cell = capability.cells.find((c) => c.role === role);
                    return (
                      <td key={role} className="py-1.5 pr-3 align-middle">
                        {cell && (
                          <MatrixCell
                            capability={capability}
                            cell={cell}
                            value={values[cellKey(capability.key, role)] ?? cell.value}
                            defaultValue={defaults[cellKey(capability.key, role)] ?? cell.default}
                            onChange={
                              onChange &&
                              ((value) => onChange(cellKey(capability.key, role), value))
                            }
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function MatrixCell({
  capability,
  cell,
  value,
  defaultValue,
  onChange,
}: {
  capability: PermissionCapability;
  cell: PermissionCell;
  value: CapabilityValue;
  defaultValue: CapabilityValue;
  onChange?: (value: CapabilityValue) => void;
}): ReactElement {
  const t = useTranslate();
  const name = t('settings.permissions.cellName', {
    capability: capabilityLabel(t, capability.key),
    role: roleLabel(t, cell.role),
  });

  if (cell.lock !== null) {
    const why = t(`permissions.lock.${cell.lock}`);
    return (
      <span
        data-locked={cell.lock}
        title={why}
        className="inline-flex items-center gap-1 text-content-tertiary"
      >
        <LockGlyph />
        <span>{valueLabel(t, cell.value)}</span>
        <span className="sr-only">
          {' — '}
          {t('settings.permissions.lockedBecause', { reason: why })}
        </span>
      </span>
    );
  }

  const disabled = onChange === undefined;
  const custom = value !== defaultValue;

  return (
    <span className="inline-flex items-center gap-1.5">
      {isSwitch(capability.values) ? (
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            role="switch"
            aria-label={name}
            checked={value === 'on'}
            disabled={disabled}
            onChange={(event) => onChange?.(event.target.checked ? 'on' : 'off')}
            className="h-4 w-4 accent-brand-600"
          />
          <span aria-hidden="true" className="text-xs text-content-secondary">
            {valueLabel(t, value)}
          </span>
        </label>
      ) : (
        <select
          aria-label={name}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.value as CapabilityValue)}
          className="rounded-md border border-border bg-inset px-1.5 py-1 text-xs outline-none disabled:opacity-60"
        >
          {capability.values.map((option) => (
            <option key={option} value={option}>
              {valueLabel(t, option)}
            </option>
          ))}
        </select>
      )}
      {custom && (
        <span className="text-2xs text-content-tertiary">
          {t('settings.permissions.customised')}
        </span>
      )}
      {custom && !disabled && (
        <button
          type="button"
          aria-label={t('settings.permissions.resetCell', {
            name,
            value: valueLabel(t, defaultValue),
          })}
          title={t('settings.permissions.resetCellShort', { value: valueLabel(t, defaultValue) })}
          onClick={() => onChange?.(defaultValue)}
          className="rounded px-1 text-xs text-brand-600 hover:bg-surface-2"
        >
          ↺
        </button>
      )}
    </span>
  );
}

function LockGlyph(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

/** What the three locks mean, once, under the table. */
function LockLegend(): ReactElement {
  const t = useTranslate();
  const locks: readonly CapabilityLock[] = ['owner_column', 'owner_only', 'below_floor'];
  return (
    <ul className="flex flex-col gap-1 text-2xs text-content-tertiary">
      {locks.map((lock) => (
        <li key={lock} className="inline-flex items-center gap-1">
          <LockGlyph />
          <span>{t(`permissions.lock.${lock}`)}</span>
        </li>
      ))}
    </ul>
  );
}
