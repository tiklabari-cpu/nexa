/**
 * `CardTable` (GV-04 · tm 472.3): every body cell carries its column's name for
 * the narrow window's cards, and every part its table role. Whether the cards
 * then fit 375 px is a layout fact jsdom cannot measure — that lives in
 * `narrow-archive-reports.spec.ts`.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CardTable } from './CardTable.js';

function Table({
  columns,
  rows,
  className,
}: {
  columns: string[];
  rows: string[][];
  className?: string;
}) {
  return (
    <CardTable className={className}>
      <caption>Chats per agent</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([first, ...rest]) => (
          <tr key={first}>
            <th scope="row">{first}</th>
            {rest.map((value, i) => (
              <td key={i}>{value}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </CardTable>
  );
}

describe('CardTable', () => {
  it('names every body cell after its column, and keeps the caller’s classes', () => {
    render(
      <Table
        className="w-full text-sm"
        columns={['Agent', 'Chats', 'Rating']}
        rows={[['Ada', '12', '90%']]}
      />,
    );
    const table = screen.getByRole('table', { name: 'Chats per agent' });
    expect(table).toHaveClass('card-table', 'w-full', 'text-sm');
    expect(screen.getByRole('rowheader', { name: 'Ada' })).toHaveAttribute('data-label', 'Agent');
    expect(screen.getByRole('cell', { name: '12' })).toHaveAttribute('data-label', 'Chats');
    expect(screen.getByRole('cell', { name: '90%' })).toHaveAttribute('data-label', 'Rating');
  });

  it('gives each part its role, so a stacked layout keeps the table’s semantics', () => {
    render(<Table columns={['Agent', 'Chats']} rows={[['Ada', '12']]} />);
    const table = screen.getByRole('table');
    expect(table).toHaveAttribute('role', 'table');
    for (const section of Array.from(table.querySelectorAll('thead, tbody'))) {
      expect(section).toHaveAttribute('role', 'rowgroup');
    }
    for (const row of Array.from(table.querySelectorAll('tr'))) {
      expect(row).toHaveAttribute('role', 'row');
    }
    expect(screen.getByText('Agent')).toHaveAttribute('role', 'columnheader');
    expect(screen.getByText('Ada')).toHaveAttribute('role', 'rowheader');
    expect(screen.getByText('12')).toHaveAttribute('role', 'cell');
  });

  it('labels a row that arrives later, and follows a column that is renamed', () => {
    const { rerender } = render(<Table columns={['Agent', 'Chats']} rows={[['Ada', '12']]} />);
    rerender(
      <Table
        columns={['Agent', 'Conversations']}
        rows={[
          ['Ada', '12'],
          ['Lin', '7'],
        ]}
      />,
    );
    expect(screen.getByText('12')).toHaveAttribute('data-label', 'Conversations');
    expect(screen.getByText('7')).toHaveAttribute('data-label', 'Conversations');
    expect(screen.getByText('Lin')).toHaveAttribute('data-label', 'Agent');
  });

  it('counts a spanning header for every column it covers, and leaves a caller’s label alone', () => {
    render(
      <CardTable>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col" colSpan={2}>
              Ratings
            </th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Mon</td>
            <td>3 good</td>
            <td data-label="Bad">1 bad</td>
            <td>4</td>
          </tr>
          <tr>
            <td colSpan={3}>Tue (no ratings)</td>
            <td>0</td>
          </tr>
        </tbody>
      </CardTable>,
    );
    expect(screen.getByText('3 good')).toHaveAttribute('data-label', 'Ratings');
    expect(screen.getByText('1 bad')).toHaveAttribute('data-label', 'Bad');
    expect(screen.getByText('4')).toHaveAttribute('data-label', 'Total');
    // A cell spanning three columns ends at the third: the next one is Total.
    expect(screen.getByText('0')).toHaveAttribute('data-label', 'Total');
  });

  it('writes no label under a column whose header is empty', () => {
    render(
      <CardTable>
        <thead>
          <tr>
            <th scope="col">Agent</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Ada</td>
            <td>
              <button type="button">Open</button>
            </td>
          </tr>
        </tbody>
      </CardTable>,
    );
    expect(screen.getByRole('button', { name: 'Open' }).closest('td')).not.toHaveAttribute(
      'data-label',
    );
  });
});
