import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { invoke, requestJira } from '@forge/bridge';
import { AccessGate } from '../../src/app/AccessGate.jsx';
import { I18nProvider } from '../../src/i18n/index.js';
import { createJiraClient } from '../../src/infra/jira.js';
import { progressView } from '../../src/wizard/progress.js';
import { loadTemplateBytes } from '../../src/wizard/useTemplates.js';
import { Wizard } from '../../src/wizard/Wizard.jsx';
import { WarningsTable } from '../../src/wizard/WarningsTable.jsx';
import { resetPreviewRuns } from '../../preview/bridgeMock.js';
import { routeJira, WIZARD_TEMPLATES } from '../../preview/fixtures.js';

vi.mock('@forge/bridge', async () => {
  const mock = await import('../../preview/bridgeMock.js');
  return { ...mock, requestJira: vi.fn(mock.requestJira), invoke: vi.fn(mock.invoke) };
});

const SEARCH = { kind: 'jql', jql: 'project = RPT ORDER BY key ASC' };
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NOW = new Date(2026, 8, 29, 10, 0).getTime();
const WAIT = { timeout: 5000 };
const WORD_TEMPLATE = WIZARD_TEMPLATES.user[1];

function fakeRenderers() {
  return {
    xlsx: vi.fn(async () => new Uint8Array([1, 2, 3])),
    docx: vi.fn(async () => new Uint8Array([4])),
    pdf: vi.fn(async () => ({ bytes: new Uint8Array([5]), emojiDropped: 0, imagesDropped: 0 })),
    docxTemplate: vi.fn(async () => new Uint8Array([6])),
  };
}

function setState(state) {
  window.history.replaceState(null, '', `/?screen=wizard&state=${state}`);
}

function renderWizard(props = {}) {
  const save = props.save ?? vi.fn();
  const renderers = props.renderers ?? fakeRenderers();
  render(
    <I18nProvider locale="en-US">
      <Wizard entry={SEARCH} context={{ siteUrl: 'https://preview.atlassian.net' }} clock={() => NOW} language="de-DE" {...props} save={save} renderers={renderers} />
    </I18nProvider>,
  );
  return { save, renderers };
}

const exportButton = () => screen.getByTestId('wizard-export');

beforeEach(() => {
  resetPreviewRuns();
  vi.mocked(requestJira).mockClear();
  vi.mocked(invoke).mockClear();
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('progressView', () => {
  it.each([
    [null, { stage: 'read', fraction: 0 }],
    [{ phase: 'count', done: 30, total: 30 }, { stage: 'read', fraction: 0 }],
    [{ phase: 'read', done: 15, total: 30 }, { stage: 'read', fraction: 0.4 }],
    [{ phase: 'images', done: 0, total: 0 }, { stage: 'images', fraction: 0.95 }],
    [{ phase: 'build', done: 0, total: 1 }, { stage: 'build', fraction: 0.95 }],
  ])('%o → %o', (progress, view) => {
    expect(progressView(progress)).toEqual(view);
  });
});

describe('loadTemplateBytes', () => {
  it('reads the parts one after another and joins them', async () => {
    const asked = [];
    const getPart = async (id, index) => {
      asked.push([id, index]);
      await new Promise((done) => { setTimeout(done, index === 0 ? 20 : 0); });
      return { data: ['AQID', 'BAU='][index] };
    };
    const bytes = await loadTemplateBytes({ id: 't1', parts: 2 }, getPart);
    expect([asked, [...bytes]]).toEqual([[['t1', 0], ['t1', 1]], [1, 2, 3, 4, 5]]);
  });

  it('gives null for a template without parts', async () => {
    expect(await loadTemplateBytes({ id: 't1', parts: 0 }, vi.fn())).toBeNull();
  });
});

describe('export run', () => {
  it('shows the read counter with a determinate progress bar while reading', async () => {
    setState('running');
    renderWizard();
    fireEvent.click(exportButton());
    expect(await screen.findByText('0 of 30 issues read', {}, WAIT)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByTestId('run-view')).toHaveAttribute('data-stage', 'read');
  });

  it('returns to the form with nothing downloaded after cancel', async () => {
    setState('running');
    const { save } = renderWizard();
    fireEvent.click(exportButton());
    fireEvent.click(await screen.findByTestId('run-cancel', {}, WAIT));
    expect(await screen.findByTestId('run-cancelled')).toHaveTextContent('Export cancelled. Nothing was downloaded.');
    expect(screen.getByTestId('wizard-export')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it('reports an incomplete read and finishes the file after "Retry missing"', async () => {
    setState('incomplete');
    const { save } = renderWizard();
    fireEvent.click(exportButton());
    expect(await screen.findByTestId('incomplete-count', {}, WAIT)).toHaveTextContent('0 of 30 issues read');
    expect(screen.getByTestId('incomplete-retry')).toHaveTextContent('Retry missing');
    fireEvent.click(screen.getByTestId('incomplete-retry'));
    expect(await screen.findByTestId('result-view', {}, WAIT)).toBeInTheDocument();
    expect(save.mock.calls.map(([name]) => name)).toEqual(['RPT-2026-09-29.xlsx']);
  });

  it('downloads a marked partial file on request', async () => {
    setState('incomplete');
    const { save, renderers } = renderWizard();
    fireEvent.click(exportButton());
    fireEvent.click(await screen.findByTestId('incomplete-partial', {}, WAIT));
    expect(await screen.findByText('Partial file downloaded', {}, WAIT)).toBeInTheDocument();
    expect(save.mock.calls.map(([name]) => name)).toEqual(['2026-09-29-PARTIAL.xlsx']);
    expect(renderers.xlsx.mock.calls[0][0].meta.partial).toEqual({ done: 0, total: 30 });
  });

  it('saves the file as soon as it is built and shows tiles and warnings', async () => {
    setState('done');
    const { save } = renderWizard();
    fireEvent.click(exportButton());
    expect(await screen.findByTestId('result-view', {}, WAIT)).toBeInTheDocument();
    expect(save).toHaveBeenCalledTimes(1);
    const [name, blob] = save.mock.calls[0];
    expect([name, blob.type, blob.size]).toEqual(['RPT-2026-09-29.xlsx', XLSX_MIME, 3]);
    expect(['issues', 'time', 'skipped', 'images'].map((id) => screen.getByTestId(`stat-${id}`).textContent))
      .toEqual(['Issues30', 'Time0 s', 'Skipped0', 'Images missing0']);
    fireEvent.click(screen.getByTestId('warnings-toggle-column-missing'));
    expect(within(screen.getByTestId('warnings-column-missing')).getByText('timeoriginalestimate')).toBeInTheDocument();
    expect(screen.getByTestId('warnings-toggle-column-missing')).toHaveTextContent('Column not on this site1');
  });

  it('saves the same Blob again with "Download again"', async () => {
    setState('done');
    const { save } = renderWizard();
    fireEvent.click(exportButton());
    fireEvent.click(await screen.findByTestId('download-again', {}, WAIT));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
    expect(save.mock.calls[1][1]).toBe(save.mock.calls[0][1]);
  });

  it('refuses too many issues for Word and offers Excel instead', async () => {
    setState('failed');
    const { renderers } = renderWizard();
    fireEvent.click(screen.getByTestId('format-docx'));
    fireEvent.click(exportButton());
    expect(await screen.findByText('Word and PDF files hold up to 2,000 issues, and this query has 5,000. Narrow the JQL or choose Excel.', {}, WAIT)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('failure-excel'));
    expect(await screen.findByTestId('format-xlsx')).toHaveAttribute('aria-checked', 'true');
    expect(renderers.docx).not.toHaveBeenCalled();
  });

  it('counts requests the client repeated', async () => {
    setState('done');
    let failed = false;
    const flaky = async (path, init) => {
      if (!failed && path.startsWith('/rest/api/3/issue/bulkfetch')) {
        failed = true;
        return new Response('{}', { status: 503 });
      }
      return routeJira(path, init);
    };
    const createClient = ({ signal, onRetry } = {}) => createJiraClient({ request: flaky, sleep: async () => {}, signal, onRetry });
    renderWizard({ createClient });
    fireEvent.click(exportButton());
    expect(await screen.findByText('1 request was repeated after a Jira error or rate limit.', {}, WAIT)).toBeInTheDocument();
  });

  it('reads a stored Word template part by part and renders with the joined bytes', async () => {
    setState('done');
    const { renderers } = renderWizard();
    fireEvent.click(screen.getByTestId('format-docx'));
    fireEvent.click(await screen.findByTestId(`template-${WORD_TEMPLATE.id}`, {}, WAIT));
    fireEvent.click(exportButton());
    expect(await screen.findByTestId('result-view', {}, WAIT)).toBeInTheDocument();
    const parts = vi.mocked(invoke).mock.calls.filter(([key]) => key === 'getTemplatePart').map(([, payload]) => payload);
    expect(parts).toEqual([{ id: WORD_TEMPLATE.id, index: 0 }, { id: WORD_TEMPLATE.id, index: 1 }]);
    expect([...renderers.docxTemplate.mock.calls[0][0].template]).toEqual([1, 2, 3, 4, 5]);
  });

  it('never starts a run without a licence', async () => {
    setState('unlicensed');
    render(
      <I18nProvider locale="en-US">
        <AccessGate><Wizard entry={SEARCH} context={{}} save={vi.fn()} renderers={fakeRenderers()} /></AccessGate>
      </I18nProvider>,
    );
    expect(await screen.findByRole('button', { name: 'Try again' }, WAIT)).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith('getAccess', undefined));
    expect(screen.queryByTestId('wizard-export')).toBeNull();
    expect(requestJira).not.toHaveBeenCalled();
  });
});

describe('warnings table', () => {
  const warnings = [
    ...Array.from({ length: 25 }, (_, i) => ({ kind: 'image-missing', issueKey: `RPT-${i + 1}`, detail: `photo-${i + 1}.png` })),
    { kind: 'pdf-emoji', detail: '3' },
  ];
  const renderTable = () => render(<I18nProvider locale="en-US"><WarningsTable warnings={warnings} siteUrl="https://preview.atlassian.net" /></I18nProvider>);

  it('groups warnings by kind with translated names and counts', () => {
    renderTable();
    expect(['image-missing', 'pdf-emoji'].map((kind) => screen.getByTestId(`warnings-toggle-${kind}`).textContent))
      .toEqual(['Image could not be downloaded25', 'Emoji left out of the PDF1']);
  });

  it('expands a kind to issue keys and details, 20 rows per page', () => {
    renderTable();
    fireEvent.click(screen.getByTestId('warnings-toggle-image-missing'));
    const rows = within(screen.getByTestId('warnings-image-missing')).getAllByRole('row').slice(1);
    expect([rows.length, rows[0].textContent, rows[19].textContent]).toEqual([20, 'RPT-1photo-1.png', 'RPT-20photo-20.png']);
  });
});
