import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { invoke, requestJira } from '@forge/bridge';
import { I18nProvider } from '../../src/i18n/index.js';
import { Wizard } from '../../src/wizard/Wizard.jsx';
import { resetPreviewRuns } from '../../preview/bridgeMock.js';
import { BAD_JQL_FIELD, BOARD, WIZARD_TEMPLATES } from '../../preview/fixtures.js';

vi.mock('@forge/bridge', async () => {
  const mock = await import('../../preview/bridgeMock.js');
  return { ...mock, requestJira: vi.fn(mock.requestJira), invoke: vi.fn(mock.invoke) };
});

const NONE = { kind: 'none' };
const SEARCH = { kind: 'jql', jql: 'project = RPT ORDER BY key ASC' };
const WAIT = { timeout: 5000 };

function renderWizard({ entry = NONE, locale = 'en-US', ...props } = {}) {
  const renderers = { xlsx: vi.fn(async () => new Uint8Array([1])) };
  render(
    <I18nProvider locale={locale}>
      <Wizard entry={entry} context={{ siteUrl: 'https://preview.atlassian.net' }} save={vi.fn()} renderers={renderers} language="de-DE" {...props} />
    </I18nProvider>,
  );
}

const jiraCalls = (fragment) => vi.mocked(requestJira).mock.calls.filter(([path]) => path.includes(fragment));
const typeJql = (text) => fireEvent.change(screen.getByTestId('wizard-jql'), { target: { value: text } });

beforeEach(() => {
  resetPreviewRuns();
  window.history.replaceState(null, '', '/?screen=wizard&state=form');
  vi.mocked(requestJira).mockClear();
  vi.mocked(invoke).mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

describe('source step', () => {
  it('keeps Export disabled on the global page until JQL is typed', () => {
    renderWizard();
    expect(exportState()).toBe(true);
    typeJql('project = RPT');
    expect(exportState()).toBe(false);
  });

  it('asks Jira for filters once typing pauses for 300 ms', async () => {
    renderWizard();
    await waitFor(() => expect(jiraCalls('/filter/search')).toHaveLength(1), WAIT);
    const input = screen.getByLabelText('Saved filter');
    fireEvent.change(input, { target: { value: 'o' } });
    fireEvent.change(input, { target: { value: 'op' } });
    fireEvent.change(input, { target: { value: 'open' } });
    await new Promise((done) => { setTimeout(done, 200); });
    expect(jiraCalls('/filter/search')).toHaveLength(1);
    await waitFor(() => expect(jiraCalls('/filter/search')).toHaveLength(2), WAIT);
    expect(jiraCalls('/filter/search')[1][0]).toContain('filterName=open');
  });

  it('fills the JQL from a chosen filter and names the file after it', async () => {
    renderWizard();
    const input = screen.getByLabelText('Saved filter');
    fireEvent.change(input, { target: { value: 'open' } });
    fireEvent.click(await screen.findByText('Open RPT issues', {}, WAIT));
    expect(screen.getByTestId('wizard-jql')).toHaveValue('project = RPT AND statusCategory != Done');
    expect(screen.getByTestId('wizard-file-example').textContent).toMatch(/^Example: \d{4}-\d{2}-\d{2}-Open-RPT-issues\.xlsx$/);
  });

  it('shows Jira\'s JQL error verbatim under the field', async () => {
    renderWizard();
    typeJql(`${BAD_JQL_FIELD} = 1`);
    fireEvent.click(screen.getByTestId('wizard-export'));
    expect(await screen.findByTestId('wizard-jql-error', {}, WAIT))
      .toHaveTextContent(`Field '${BAD_JQL_FIELD}' does not exist or you do not have permission to view it.`);
    typeJql('project = RPT');
    expect(screen.queryByTestId('wizard-jql-error')).toBeNull();
  });

  it('names the issues an entry point brings instead of the source step', () => {
    renderWizard({ entry: { kind: 'issue', key: 'RPT-7', projectKey: 'RPT' } });
    expect(screen.getByTestId('entry-summary')).toHaveTextContent('Issue RPT-7');
    expect(screen.queryByTestId('wizard-jql')).toBeNull();
  });
});

describe('format and template steps', () => {
  it('starts an issue entry with Word and its paper size from the language', () => {
    renderWizard({ entry: { kind: 'issue', key: 'RPT-7', projectKey: 'RPT' }, language: 'en-US' });
    expect(screen.getByTestId('format-docx')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('paper-LETTER--radio-input')).toBeChecked();
  });

  it('shows paper sizes for PDF and hides them for Excel', () => {
    renderWizard();
    expect(screen.queryByText('Paper size')).toBeNull();
    fireEvent.click(screen.getByTestId('format-pdf'));
    expect(screen.getByTestId('paper-A4--radio-input')).toBeChecked();
  });

  it('asks for templates of the entry\'s project', async () => {
    renderWizard({ entry: { kind: 'board', boardId: 3, projectKey: 'OPS' } });
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith('listTemplates', { projectKeys: ['OPS'] }));
  });

  it('asks for templates of a board\'s project read from its first issue', async () => {
    renderWizard({ entry: { kind: 'board', boardId: BOARD.id } });
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith('listTemplates', { projectKeys: ['RPT'] }), WAIT);
  });

  it('lists built-in and stored Excel templates in their groups', async () => {
    renderWizard();
    await screen.findByTestId('templates-site', {}, WAIT);
    const titles = (group) => within(screen.getByTestId(`templates-${group}`)).getAllByRole('radio').map((card) => card.textContent);
    expect(titles('builtin')).toEqual([
      'Issue listThe main fields of every issue, with a summary sheet.',
      'Work logsOne row per work log: who, when and how many hours.',
      'CommentsOne row per comment with its author and date.',
      'Sprint summaryIssues split into sheets by status, with story points.',
    ]);
    expect(titles('user')).toEqual(['My sprint columns5 columns']);
    expect(titles('site')).toEqual([`${WIZARD_TEMPLATES.site[0].name}4 columns`]);
    expect(screen.queryByTestId('templates-project')).toBeNull();
  });

  it('offers custom Word templates for Word only', async () => {
    renderWizard();
    fireEvent.click(screen.getByTestId('format-docx'));
    expect(await screen.findByTestId(`template-${WIZARD_TEMPLATES.user[1].id}`, {}, WAIT)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('format-pdf'));
    expect(screen.queryByTestId(`template-${WIZARD_TEMPLATES.user[1].id}`)).toBeNull();
    expect(screen.getByTestId(`template-${WIZARD_TEMPLATES.project[1].id}`)).toHaveTextContent('RPT sprint handoutRPT · Sprint report');
  });

  it('copies a stored Excel template into the column editor', async () => {
    renderWizard();
    fireEvent.click(await screen.findByTestId(`template-${WIZARD_TEMPLATES.user[0].id}`, {}, WAIT));
    const items = () => within(screen.getByTestId('columns-list')).getAllByRole('listitem').map((item) => item.getAttribute('aria-label'));
    await waitFor(() => expect(items()).toEqual([
      'Key, column 1 of 5', 'Summary, column 2 of 5', 'Status, column 3 of 5', 'Story Points, column 4 of 5', 'Team, column 5 of 5',
    ]), WAIT);
  });
});

describe('Excel preview', () => {
  it('asks for JQL before it can preview on the global page', () => {
    renderWizard();
    expect(screen.getByTestId('preview-needs-jql')).toHaveTextContent('Enter a JQL query or choose a filter to see the first issues.');
  });

  it('shows the first five issues with links, formatted dates and the match count', async () => {
    renderWizard({ entry: SEARCH });
    expect(await screen.findByTestId('preview-count', {}, WAIT)).toHaveTextContent('30 issues match');
    expect(screen.getByTestId('preview-jql')).toHaveTextContent('project = RPT ORDER BY key ASC');
    const rows = within(screen.getByTestId('preview-rows')).getAllByRole('row');
    expect(rows).toHaveLength(6);
    const link = within(rows[1]).getByRole('link', { name: 'RPT-1' });
    expect(link).toHaveAttribute('href', 'https://preview.atlassian.net/browse/RPT-1');
    expect(rows[2]).toHaveTextContent('Oct 2, 2026');
    expect(within(rows[0]).getAllByRole('columnheader').slice(0, 3).map((cell) => cell.textContent)).toEqual(['Key', 'Summary', 'Issue Type']);
  });

  it('refreshes the preview after the columns change', async () => {
    renderWizard({ entry: SEARCH });
    await screen.findByTestId('preview-count', {}, WAIT);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove Summary' }));
    });
    await waitFor(() => {
      const header = within(screen.getByTestId('preview-rows')).getAllByRole('columnheader').map((cell) => cell.textContent);
      expect(header.slice(0, 2)).toEqual(['Key', 'Issue Type']);
    }, WAIT);
  });
});

function exportState() {
  return screen.getByTestId('wizard-export').disabled;
}
