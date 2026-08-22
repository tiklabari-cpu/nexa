/**
 * Change a teammate's role (NFR-S12 — the "rol değişimi" the audit requirement
 * names by hand).
 *
 * The server owns this rule and stays the final word: `PUT /agents/{id}/role`
 * refuses a role above the caller's own rank, the owner as a target, an
 * ownership transfer and anyone changing themself, and writes the one
 * `member.role_changed` audit entry. This screen deliberately does *not*
 * re-implement that ceiling — a second copy of an authorization rule is a copy
 * that drifts, and the one that drifts is the one the user is looking at.
 *
 * What it does instead is narrower and safe in both directions: it hides a
 * control that could only ever be refused, offers only the roles this caller
 * could actually grant, and when the server still says no, shows that refusal
 * rather than swallowing it. The filtering is a courtesy; the refusal is the
 * rule.
 */
import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../../components/ui/index.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';

export type Role = 'owner' | 'viceowner' | 'admin' | 'agent';

/** Roles are coarse ranks; the server enforces the same order (ROLE_RANK). */
export const ROLE_RANK: Record<Role, number> = { owner: 3, viceowner: 2, admin: 1, agent: 0 };

export function roleAtLeast(role: string | null, minimum: Role): boolean {
  return role != null && role in ROLE_RANK && ROLE_RANK[role as Role] >= ROLE_RANK[minimum];
}

/**
 * The roles this caller could actually grant: never `owner` — handing over the
 * workspace is a separate, heavier operation the endpoint refuses outright —
 * and never a rank above their own.
 */
export function assignableRoles(actorRole: string | null): Role[] {
  return (['viceowner', 'admin', 'agent'] as const).filter((role) => roleAtLeast(actorRole, role));
}

/**
 * Whether the control is worth showing on this row at all: admin or owner
 * caller, never their own row, never the owner as a target, never someone
 * ranked above them. Each of these is a server refusal, mirrored here only so
 * an unusable button is absent rather than misleading.
 */
export function mayChangeRole(
  actorRole: string | null,
  targetRole: Role,
  isSelf: boolean,
): boolean {
  return (
    roleAtLeast(actorRole, 'admin') &&
    !isSelf &&
    targetRole !== 'owner' &&
    roleAtLeast(actorRole, targetRole)
  );
}

interface RoleMenuProps {
  agent: { id: string; name: string; role: Role };
  /** The signed-in teammate's own role — the ceiling the options are cut to. */
  actorRole: string | null;
  /** Whether this row is the signed-in teammate: nobody changes their own role. */
  isSelf: boolean;
}

export function RoleMenu({ agent, actorRole, isSelf }: RoleMenuProps): ReactElement | null {
  const t = useTranslate();
  const api = useApiClient();
  const client = useQueryClient();

  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>(agent.role);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (next: Role) => api.put(`/agents/${agent.id}/role`, { role: next }),
    onSuccess: async () => {
      // Both rosters: a role is shown in the suspended list too, and the reply
      // is the changed agent rather than the list, so the list is refetched.
      await Promise.all([
        client.invalidateQueries({ queryKey: ['team', 'agents'] }),
        client.invalidateQueries({ queryKey: ['team', 'suspended'] }),
      ]);
      setOpen(false);
    },
    onError: (failure: unknown) => {
      // A refusal here is the privilege ceiling talking, and it is the one
      // outcome worth naming: the generic "not allowed" sentence would leave
      // the admin guessing which of the four rules they hit.
      setError(
        failure instanceof ApiClientError && failure.type === 'authorization'
          ? t('team.roleChange.error.refused')
          : t(errorMessageKey(failure)),
      );
    },
  });

  if (!mayChangeRole(actorRole, agent.role, isSelf)) return null;

  const options = assignableRoles(actorRole);

  function openModal(): void {
    setRole(agent.role);
    setError(null);
    save.reset();
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        aria-label={t('team.roleChange.openAriaLabel', { name: agent.name })}
        className="text-xs text-content-brand underline"
      >
        {t('team.roleChange.openButton')}
      </button>

      {open && (
        <Modal
          onClose={() => setOpen(false)}
          title={t('team.roleChange.dialogTitle', { name: agent.name })}
          description={t('team.roleChange.dialogDescription')}
        >
          {error && (
            <p role="alert" className="mb-3 text-sm text-danger">
              {error}
            </p>
          )}

          <label htmlFor="role-change-role" className="mb-1.5 block text-sm font-medium">
            {t('team.roleChange.roleLabel')}
          </label>
          <select
            id="role-change-role"
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
            className="w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm"
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {t(`team.role.${option}`)}
              </option>
            ))}
          </select>

          <p className="mt-2 text-2xs text-content-tertiary">{t('team.roleChange.ceilingHint')}</p>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            >
              {t('team.roleChange.cancel')}
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                save.mutate(role);
              }}
              disabled={save.isPending || role === agent.role}
              className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {save.isPending ? t('team.roleChange.saving') : t('team.roleChange.saveButton')}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
