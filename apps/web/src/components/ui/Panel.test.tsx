/**
 * Panel — the shared side-panel frame and its sections (FR-EK-C.2).
 *
 * A named region, a titled header with an optional collapse control, and
 * sections that are open by default but can be folded away — the shape the inbox
 * and customer detail panes both need, in one place.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Panel, PanelSection } from './index.js';

describe('Panel', () => {
  it('is a named region with a titled header', () => {
    render(
      <Panel label="Conversation details" title="Details">
        <p>Body</p>
      </Panel>,
    );
    expect(screen.getByRole('complementary', { name: 'Conversation details' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Details' })).toBeInTheDocument();
  });

  it('offers a collapse control only when a handler is given', async () => {
    const user = userEvent.setup();
    const onCollapse = vi.fn();
    const { rerender } = render(
      <Panel
        label="Details"
        title="Details"
        onCollapse={onCollapse}
        collapseLabel="Collapse details panel"
      >
        <p>Body</p>
      </Panel>,
    );

    await user.click(screen.getByRole('button', { name: 'Collapse details panel' }));
    expect(onCollapse).toHaveBeenCalledOnce();

    rerender(
      <Panel label="Details" title="Details">
        <p>Body</p>
      </Panel>,
    );
    expect(screen.queryByRole('button', { name: 'Collapse details panel' })).toBeNull();
  });

  it('names the collapse control from the catalogue when no explicit label is given', () => {
    render(
      <Panel label="Details" title="Details" onCollapse={vi.fn()}>
        <p>Body</p>
      </Panel>,
    );
    expect(screen.getByRole('button', { name: 'Collapse panel' })).toBeInTheDocument();
  });
});

describe('PanelSection', () => {
  it('shows an open section and folds a closed one', () => {
    render(
      <Panel label="Details" title="Details">
        <PanelSection title="Conversation">
          <p>Open body</p>
        </PanelSection>
        <PanelSection title="History" defaultOpen={false}>
          <p>Folded body</p>
        </PanelSection>
      </Panel>,
    );

    // Both headings are present regardless of open state.
    expect(screen.getByText('Conversation')).toBeInTheDocument();
    expect(screen.getByText('History')).toBeInTheDocument();
    // The default-open section shows its body; the folded one does not.
    expect(screen.getByText('Open body')).toBeVisible();
    expect(screen.getByText('Folded body')).not.toBeVisible();
  });
});
