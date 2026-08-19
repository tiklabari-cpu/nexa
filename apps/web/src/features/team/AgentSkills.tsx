/**
 * Per-agent skill assignment (FR-MOD-08.6.3 — skill-based routing).
 *
 * Opens from an agent's row in Team: the full skill catalogue (Settings →
 * Skills) with the agent's current set checked. Saving replaces the set
 * wholesale through `PUT /agents/{agentId}/expertise`, the same endpoint
 * `GET /agents` reads back from — this screen never invents its own shape for
 * an agent's skills. Called "expertise" at the API layer, "Skills" here, same
 * split the Settings catalogue made (SettingsPage.tsx `Skills`).
 */
import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState } from '../../components/EmptyState.js';
import { Modal } from '../../components/ui/index.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';

export interface Expertise {
  id: number;
  name: string;
  slug: string;
}

interface AgentSkillsProps {
  agent: { id: string; name: string; expertise: Expertise[] };
  /** Whether the caller may change the assignment — the server's own gate
   *  (`minimumRole: admin`) mirrored so an unusable control reads as disabled,
   *  not absent (the catalogue is still worth seeing read-only). */
  canEdit: boolean;
}

export function AgentSkills({ agent, canEdit }: AgentSkillsProps): ReactElement {
  const t = useTranslate();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const api = useApiClient();
  const client = useQueryClient();

  const catalog = useQuery({
    queryKey: ['settings', 'expertise'],
    queryFn: () => api.get<{ items: Expertise[] }>('/settings/expertise'),
    enabled: open,
  });

  const save = useMutation({
    mutationFn: (expertiseIds: number[]) =>
      api.put(`/agents/${agent.id}/expertise`, { expertise_ids: expertiseIds }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['team', 'agents'] });
      setOpen(false);
    },
  });

  function openModal(): void {
    setSelected(new Set(agent.expertise.map((skill) => skill.id)));
    save.reset();
    setOpen(true);
  }

  function toggle(id: number): void {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const items = catalog.data?.items ?? [];
  const currentNames = agent.expertise.map((skill) => skill.name).join(', ');

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        aria-label={t('team.skills.manageAriaLabel', { name: agent.name })}
        className="text-xs text-content-secondary underline"
      >
        {currentNames || t('team.skills.noSkills')}
      </button>

      {open && (
        <Modal
          onClose={() => setOpen(false)}
          title={t('team.skills.dialogTitle', { name: agent.name })}
          description={t('team.skills.dialogDescription')}
        >
          {catalog.isPending ? (
            <p className="text-sm text-content-secondary">{t('team.skills.loading')}</p>
          ) : catalog.error ? (
            <p className="text-sm text-danger">{t('team.skills.loadError')}</p>
          ) : items.length === 0 ? (
            <EmptyState
              title={t('team.skills.empty.title')}
              description={t('team.skills.empty.description')}
            />
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {items.map((skill) => (
                <li key={skill.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(skill.id)}
                      disabled={!canEdit}
                      onChange={() => toggle(skill.id)}
                    />
                    {skill.name}
                  </label>
                </li>
              ))}
            </ul>
          )}

          {save.isError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {t('team.skills.saveError')}
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            >
              {canEdit ? t('team.skills.cancel') : t('team.skills.close')}
            </button>
            {canEdit && items.length > 0 && (
              <button
                type="button"
                onClick={() => save.mutate([...selected])}
                disabled={save.isPending}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                {save.isPending ? t('team.skills.saving') : t('team.skills.saveButton')}
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
