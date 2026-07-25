/**
 * Browse templates (FR-MOD-05.1).
 *
 * A gallery of ready-made skills grouped by type. Choosing one is choosing a
 * starting point: the dialog closes and the editor opens on a skill already
 * filled from the template, so the admin edits rather than starts from nothing.
 *
 * The dialog is deliberately small-but-honest about accessibility — labelled,
 * modal, closes on Escape and on a backdrop click, and moves focus in on open —
 * because it is reached from a primary header action and a keyboard user must be
 * able to open it, pick, and leave without a mouse.
 */
import { useEffect, useRef, type ReactElement } from 'react';
import {
  SKILL_TEMPLATES,
  TEMPLATE_CATEGORIES,
  type SkillTemplate,
} from './templates.js';

export function TemplateGallery({
  open,
  onClose,
  onUse,
  pendingId,
}: {
  open: boolean;
  onClose: () => void;
  onUse: (template: SkillTemplate) => void;
  /** Id of the template currently being turned into a skill, if any. */
  pendingId: string | null;
}): ReactElement | null {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-gallery-title"
        className="w-full max-w-3xl rounded-lg border border-border bg-surface shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
          <div>
            <h2 id="template-gallery-title" className="text-sm font-semibold">
              Browse templates
            </h2>
            <p className="text-2xs text-content-tertiary">
              Pick a starting point — it opens in the editor, yours to change.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
          >
            Close
          </button>
        </header>

        <div className="flex max-h-[70vh] flex-col gap-6 overflow-y-auto p-5">
          {TEMPLATE_CATEGORIES.map((category) => {
            const templates = SKILL_TEMPLATES.filter((t) => t.category === category.id);
            if (templates.length === 0) return null;
            return (
              <section key={category.id} aria-labelledby={`gallery-cat-${category.id}`}>
                <h3
                  id={`gallery-cat-${category.id}`}
                  className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-content-tertiary"
                >
                  <span aria-hidden="true">{category.icon}</span>
                  {category.label}
                </h3>
                <p className="mb-3 text-2xs text-content-tertiary">{category.description}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {templates.map((template) => (
                    <TemplateCard
                      key={template.id}
                      template={template}
                      pending={pendingId === template.id}
                      onUse={() => onUse(template)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  pending,
  onUse,
}: {
  template: SkillTemplate;
  pending: boolean;
  onUse: () => void;
}): ReactElement {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-inset p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{template.name}</p>
        <p className="mt-0.5 text-2xs text-content-secondary">{template.summary}</p>
      </div>

      {template.requiresIntegration && (
        <p className="text-2xs text-warning">Needs the {template.requiresIntegration} app connected.</p>
      )}

      <button
        type="button"
        disabled={pending}
        onClick={onUse}
        className="self-start rounded-md bg-brand-500 px-3 py-1.5 text-2xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
      >
        {pending ? 'Opening…' : 'Use template'}
      </button>
    </div>
  );
}
