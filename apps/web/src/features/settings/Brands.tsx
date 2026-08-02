/**
 * Brands (Multibrand, PRD §5.3) — the brand catalogue, not what a brand
 * contains. A license may run several brands under one subscription; each has
 * its own channels, websites and widget/security/inbox settings, selected
 * elsewhere via the `X-Nexa-Brand` header. This screen only manages the
 * catalogue itself: list, add, rename, remove. The `Default` brand every
 * license is created with can be renamed but never removed — the license
 * always needs exactly one default to fall back to.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, required, useForm } from '../../lib/form.js';

interface Brand {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  is_default: boolean;
  created_at: string;
}

export function Brands({ canEdit }: { canEdit: boolean }): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['settings', 'brands'],
    queryFn: () => api.get<{ items: Brand[] }>('/brands'),
  });

  const invalidate = (): void =>
    void queryClient.invalidateQueries({ queryKey: ['settings', 'brands'] });

  const add = useMutation({
    mutationFn: (body: { name: string }) => api.post<Brand>('/brands', body),
    onSuccess: invalidate,
  });

  // The one validation primitive: a name is required, Submit disabled until it
  // is present (FR-EK-A.1).
  const form = useForm({
    initial: { name: '' },
    validators: { name: required('Enter a brand name.') },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await add.mutateAsync({ name: values.name.trim() });
        reset();
      } catch (error) {
        setSubmitError(error instanceof ApiClientError ? error.message : 'Could not add that brand.');
      }
    },
  });
  const nameError = form.errorFor('name');

  return (
    <Section
      title="Brands"
      description="Run several brands under one subscription. Each has its own channels, websites and widget appearance, selected from the brand switcher."
    >
      {list.error ? (
        <ErrorNotice message="Could not load your brands." />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-wrap items-end gap-3 border-b border-border p-4"
            >
              <label htmlFor="new-brand-name" className="flex min-w-56 flex-1 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  Brand name
                </span>
                <input
                  id="new-brand-name"
                  value={form.values.name}
                  onChange={(event) => form.setValue('name', event.target.value)}
                  onBlur={() => form.blur('name')}
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={nameError ? 'new-brand-name-error' : undefined}
                  placeholder="Acme Support"
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
                <FieldError id="new-brand-name-error" message={nameError} />
              </label>

              <button
                type="submit"
                disabled={!form.canSubmit}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {form.isSubmitting ? 'Adding…' : 'Add brand'}
              </button>

              {form.submitError && (
                <p role="alert" className="w-full text-2xs text-danger">
                  {form.submitError}
                </p>
              )}
            </form>
          )}

          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">Loading…</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title="No brands yet"
              description="Add a brand to run a second storefront or support line under this subscription."
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((brand) => (
                <BrandRow key={brand.id} brand={brand} canEdit={canEdit} onChanged={invalidate} />
              ))}
            </ul>
          )}
        </Card>
      )}
    </Section>
  );
}

/**
 * One row: an inline-editable name (saved on blur, PATCH) and, for every
 * brand but the default, a Remove button. The default has none — it is the
 * license's fallback and cannot be deleted — and any server rejection (a slug
 * clash on rename, or a brand still holding data on remove) surfaces here
 * rather than at the top of the screen, next to the row it is about.
 */
function BrandRow({
  brand,
  canEdit,
  onChanged,
}: {
  brand: Brand;
  canEdit: boolean;
  onChanged: () => void;
}): ReactElement {
  const api = useApiClient();
  const [name, setName] = useState(brand.name);

  const rename = useMutation({
    mutationFn: (nextName: string) => api.patch<Brand>(`/brands/${brand.id}`, { name: nextName }),
    onSuccess: onChanged,
    onError: () => setName(brand.name),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/brands/${brand.id}`),
    onSuccess: onChanged,
  });

  function save(): void {
    const trimmed = name.trim();
    if (!trimmed || trimmed === brand.name) {
      setName(brand.name);
      return;
    }
    rename.mutate(trimmed);
  }

  const error = rename.error ?? remove.error;

  return (
    <li className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-center gap-3">
        <label htmlFor={`brand-name-${brand.id}`} className="sr-only">
          {brand.name} name
        </label>
        <input
          id={`brand-name-${brand.id}`}
          value={name}
          disabled={!canEdit || rename.isPending}
          onChange={(event) => setName(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
            if (event.key === 'Escape') setName(brand.name);
          }}
          className="flex-1 rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-70"
        />

        {brand.is_default && (
          <span className="rounded-full border border-border px-2 py-0.5 text-2xs text-content-tertiary">
            Default
          </span>
        )}

        {canEdit && !brand.is_default && (
          <button
            type="button"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            aria-label={`Remove ${brand.name}`}
            className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>

      {error && (
        <ErrorNotice
          message={error instanceof ApiClientError ? error.message : 'Could not update that brand.'}
        />
      )}
    </li>
  );
}
