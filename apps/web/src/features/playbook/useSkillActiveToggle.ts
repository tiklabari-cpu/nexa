/**
 * Turning a skill on or off — one definition, two places that offer it
 * (FR-MOD-06.2.1).
 *
 * The list row has had this toggle since the Playbook existed; the editor's top
 * bar needs the same one, because an admin who just finished editing a skill
 * should not have to go back to the list to switch it on. Two `useMutation`
 * calls would drift: one would invalidate a different key, or surface its error
 * somewhere else, and the same control would behave differently depending on
 * where you found it. So the mutation lives here and both call it.
 *
 * Deliberately *not* optimistic. The list's toggle never was: it PATCHes, and
 * the button's label follows `skill.active` from the query, which the failed
 * request leaves untouched — so a rejected toggle falls back to the old state
 * on its own, with the error shown next to it. Making the editor's copy
 * optimistic would be exactly the divergence this file exists to prevent.
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../lib/auth-store.js';
import type { Skill } from './types.js';

export interface SkillActiveToggleInput {
  id: string;
  active: boolean;
}

export function useSkillActiveToggle(): UseMutationResult<
  Skill,
  unknown,
  SkillActiveToggleInput,
  unknown
> {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, active }: SkillActiveToggleInput) =>
      api.patch<Skill>(`/skills/${id}`, { active }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['playbook'] }),
  });
}
