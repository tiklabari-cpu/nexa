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
import {
  INVITATION_ROLES,
  ROLE_RANK,
  roleAtLeast as rankAtLeast,
  type AgentRole,
} from '@siyahtus/types';
import { Modal } from '../../components/ui/index.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';

export type Role = AgentRole;

/**
 * Roles are coarse ranks; the server enforces the same order. The order itself
 * is `ROLE_RANK` in `@siyahtus/types` — the one copy the API and the RTM
 * gateway read too, so a role added there (Team Lead, RL-01) lands on this
 * screen with no second table to renumber.
 */
export function roleAtLeast(role: string | null, minimum: Role): boolean {
  return role != null && role in ROLE_RANK && rankAtLeast(role as Role, minimum);
}

/**
 * The roles this caller could actually grant: the ones an invitation may carry
 * — never `owner` (handing over the workspace is a separate, heavier operation
 * the endpoint refuses outright) and never `viceowner` (retired, K6: the
 * endpoint answers 400 `role_retired`) — and never a rank above their own.
 */
export function assignableRoles(actorRole: string | null): Role[] {
  return INVITATION_ROLES.filter((role) => roleAtLeast(actorRole, role));
}

/**
 * Where the picker starts. A retired `viceowner` is not among the options, and
 * a select whose value matches none shows its first option without having
 * chosen it — so such a row starts on `admin`, the role the migration gave
 * everyone else who held it.
 */
function startingRole(role: Role): Role {
  return role === 'viceowner' ? 'admin' : role;
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
  const [role, setRole] = useState<Role>(startingRole(agent.role));
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
    setRole(startingRole(agent.role));
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
          {role === 'team_lead' && (
            <p className="mt-1 text-2xs text-content-tertiary">
              {t('team.roleChange.teamLeadHint')}
            </p>
          )}

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
