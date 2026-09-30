import { useReducer } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { buildFieldCatalog } from '../../src/core/fields.js';
import { createT, I18nProvider, localeDictionaries } from '../../src/i18n/index.js';
import { ColumnsEditor } from '../../src/wizard/ColumnsEditor.jsx';
import { columnName, columnOptions, pseudoColumnsFor } from '../../src/wizard/columnOptions.js';
import { labelsFor } from '../../src/wizard/labels.js';
import { formReducer, initialForm } from '../../src/wizard/useWizardForm.js';
import { FIELDS } from '../../preview/fixtures.js';

const catalog = buildFieldCatalog(FIELDS);
const labels = labelsFor(createT('en-US', localeDictionaries));
const GROUPS = { row: 'Row columns', fields: 'Jira fields' };

function Harness({ columns }) {
  const [state, dispatch] = useReducer(formReducer, undefined, () => ({ ...initialForm({ kind: 'none' }, {}), columns }));
  return (
    <>
      <ColumnsEditor
        columns={state.columns}
        rowMode={state.rowMode}
        groupBy={state.groupBy}
        summary={state.summary}
        catalog={catalog}
        labels={labels}
        onAdd={(ref) => dispatch({ type: 'addColumn', ref })}
        onRemove={(index) => dispatch({ type: 'removeColumn', index })}
        onMove={(from, to) => dispatch({ type: 'moveColumn', from, to })}
        onRowMode={(rowMode) => dispatch({ type: 'rowMode', rowMode })}
        onGroupBy={(groupBy) => dispatch({ type: 'groupBy', groupBy })}
        onSummary={(summary) => dispatch({ type: 'summary', summary })}
      />
      <output data-testid="state">{JSON.stringify(state.columns)}</output>
    </>
  );
}

const renderEditor = (columns = ['key', 'summary', 'status']) => render(<I18nProvider locale="en-US"><Harness columns={columns} /></I18nProvider>);
const names = () => within(screen.getByTestId('columns-list')).getAllByRole('listitem').map((item) => item.getAttribute('aria-label'));
const columnsState = () => JSON.parse(screen.getByTestId('state').textContent);

afterEach(cleanup);

describe('ColumnsEditor', () => {
  it('lists the chosen columns in order with field names and translated row columns', () => {
    renderEditor(['key', 'customfield_10016', 'status']);
    expect(names()).toEqual(['Key, column 1 of 3', 'Story Points, column 2 of 3', 'Status, column 3 of 3']);
  });

  it('moves the focused column down with Alt+↓ and announces it', () => {
    renderEditor();
    fireEvent.keyDown(screen.getByTestId('column-key'), { key: 'ArrowDown', altKey: true });
    expect(columnsState()).toEqual(['summary', 'key', 'status']);
    expect(screen.getByTestId('columns-live')).toHaveTextContent('Key moved to position 2 of 3.');
  });

  it('keeps focus on the moved column', () => {
    renderEditor();
    fireEvent.keyDown(screen.getByTestId('column-status'), { key: 'ArrowUp', altKey: true });
    expect(columnsState()).toEqual(['key', 'status', 'summary']);
    expect(document.activeElement).toBe(screen.getByTestId('column-status'));
  });

  it('ignores Alt+↑ on the first column and arrows without Alt', () => {
    renderEditor();
    fireEvent.keyDown(screen.getByTestId('column-key'), { key: 'ArrowUp', altKey: true });
    fireEvent.keyDown(screen.getByTestId('column-summary'), { key: 'ArrowDown' });
    expect(columnsState()).toEqual(['key', 'summary', 'status']);
  });

  it('removes a column with its button and announces it', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Summary' }));
    expect(columnsState()).toEqual(['key', 'status']);
    expect(screen.getByTestId('columns-live')).toHaveTextContent('Summary removed.');
  });

  it('asks for a column once the last one is removed', () => {
    renderEditor(['key']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Key' }));
    expect(screen.getByTestId('columns-empty')).toHaveTextContent('Add at least one column.');
  });

  it('marks a column the site does not have', () => {
    renderEditor(['key', 'customfield_99999']);
    expect(within(screen.getByTestId('column-customfield_99999')).getByText('Not on this site')).toBeInTheDocument();
  });
});

describe('column options', () => {
  it('offers the key and the row columns of the chosen mode', () => {
    expect([pseudoColumnsFor('issue'), pseudoColumnsFor('comment')]).toEqual([['key'], ['key', 'comment.author', 'comment.created', 'comment.body']]);
  });

  it('leaves chosen columns out and groups row columns before Jira fields', () => {
    const options = columnOptions({ catalog, rowMode: 'worklog', chosen: ['key', 'summary', 'worklog.hours'], labels, locale: 'en-US', groupLabels: GROUPS });
    expect(options.map((group) => [group.label, group.options.map((o) => o.value)])).toEqual([
      ['Row columns', ['worklog.author', 'worklog.started', 'worklog.comment']],
      ['Jira fields', ['assignee', 'components', 'created', 'description', 'duedate', 'fixVersions', 'issuetype', 'labels', 'priority', 'project', 'reporter', 'status', 'customfield_10016', 'customfield_10030', 'timespent', 'updated']],
    ]);
  });

  it('names columns by field, translated row column or reference', () => {
    expect([
      columnName(catalog, 'customfield_10030', labels),
      columnName(catalog, 'comment.body', labels),
      columnName(catalog, '@storyPoints', labels),
      columnName(catalog, 'Nope', labels),
    ]).toEqual([
      { name: 'Team', missing: false },
      { name: 'Comment', missing: false },
      { name: 'Story Points', missing: false },
      { name: 'Nope', missing: true },
    ]);
  });
});
