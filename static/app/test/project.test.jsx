import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { invoke, showFlag } from '@forge/bridge';
import { I18nProvider } from '../src/i18n/index.js';
import { ToastProvider } from '../src/components/Toasts.jsx';
import { ProjectApp } from '../src/project/ProjectApp.jsx';
import { CoverageTab } from '../src/project/CoverageTab.jsx';
import { SuspectTab } from '../src/project/SuspectTab.jsx';
import { BaselinesTab } from '../src/project/BaselinesTab.jsx';

vi.mock('@forge/bridge', () => ({
  invoke: vi.fn(),
  view: { theme: { enable: vi.fn() }, getContext: vi.fn() },
  router: { navigate: vi.fn() },
  showFlag: vi.fn(() => ({ close: vi.fn(() => Promise.resolve(true)) })),
}));

const CONFIG = { requirementTypeIds: ['1'], verificationTypeIds: ['2'], linkTypeIds: [], fingerprintFieldIds: ['summary', 'description'] };

function overview(overrides = {}) {
  return {
    configured: true,
    config: CONFIG,
    sync: { lastSyncedAt: '2026-09-25T10:00:00.000Z', job: null },
    coverage: { total: 10, covered: 8, uncovered: 2, percent: 80 },
    ...overrides,
  };
}

function gap(n, summary = `Requirement ${n}`) {
  return { issueId: String(1000 + n), issueKey: `REQ-${n}`, summary, statusName: 'To Do' };
}

function suspect(n) {
  return { linkId: String(2000 + n), reqKey: `REQ-${n}`, reqSummary: `Summary ${n}`, otherKey: `TST-${n}`, linkTypeName: 'Tests', otherStatus: 'Done' };
}

function mockResolvers(handlers) {
  invoke.mockImplementation(async (key, payload) => {
    const handler = handlers[key];
    if (!handler) {
      throw new Error(`unexpected resolver ${key}`);
    }
    return typeof handler === 'function' ? handler(payload) : handler;
  });
}

function calls(key) {
  return invoke.mock.calls.filter(([k]) => k === key);
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function renderWithProviders(ui) {
  return render(
    <I18nProvider locale="en-US">
      <ToastProvider>{ui}</ToastProvider>
    </I18nProvider>,
  );
}

function expectFlag(title, type) {
  return waitFor(() => expect(showFlag).toHaveBeenCalledWith(expect.objectContaining({ title, type, isAutoDismiss: true })));
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('ProjectApp', () => {
  it('shows onboarding when the project is not configured and opens Settings from it', async () => {
    mockResolvers({
      getOverview: overview({ configured: false, coverage: { total: 0, covered: 0, uncovered: 0, percent: null } }),
      getIssueTypes: [{ id: '1', name: 'Story' }, { id: '2', name: 'Test' }],
      getLinkTypes: [{ id: '10', name: 'Tests' }],
      getSettings: CONFIG,
    });
    renderWithProviders(<ProjectApp projectId="10002" projectKey="REQ" />);
    expect(await screen.findByText('Set up ArtUp Trace in three steps')).toBeInTheDocument();
    expect(screen.queryByText('Without verification')).not.toBeInTheDocument();
    expect(calls('getSuspects')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true'));
    expect(await screen.findByText('Requirement issue types')).toBeInTheDocument();
  });

  it('shows the empty state and zero cards for a configured project without requirements, never NaN', async () => {
    mockResolvers({
      getOverview: overview({ coverage: { total: 0, covered: 0, uncovered: 0, percent: null } }),
      getSuspects: { rows: [], next: null },
      getGaps: { rows: [], next: null },
    });
    renderWithProviders(<ProjectApp projectId="10002" projectKey="REQ" />);
    expect(await screen.findByText('No requirements found')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(3));
    expect(document.body.textContent).not.toContain('NaN');
  });

  it('shows the suspect count with a plus when the first page has more', async () => {
    mockResolvers({
      getOverview: overview(),
      getSuspects: { rows: [suspect(1), suspect(2), suspect(3)], next: '2003' },
      getGaps: { rows: [gap(1)], next: null },
    });
    renderWithProviders(<ProjectApp projectId="10002" projectKey="REQ" />);
    expect(await screen.findByText('3+')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows a neutral marker instead of a spinner when the suspect count fails to load', async () => {
    mockResolvers({
      getOverview: overview(),
      getSuspects: () => { throw new Error('boom'); },
      getGaps: { rows: [gap(1)], next: null },
    });
    renderWithProviders(<ProjectApp projectId="10002" projectKey="REQ" />);
    await screen.findByRole('button', { name: 'REQ-1' });
    const label = screen.getAllByText('Suspect links').find((el) => !el.closest('[role="tab"]'));
    const card = label.parentElement;
    await waitFor(() => expect(within(card).getByText('—')).toBeInTheDocument());
    expect(within(card).queryByRole('img')).not.toBeInTheDocument();
  });

  it('refreshes the suspect count after settings are saved', async () => {
    let suspectRows = [suspect(1)];
    mockResolvers({
      getOverview: overview(),
      getSuspects: () => ({ rows: suspectRows, next: null }),
      getGaps: { rows: [gap(1)], next: null },
      getIssueTypes: [{ id: '1', name: 'Story' }, { id: '2', name: 'Test' }],
      getLinkTypes: [],
      getSettings: CONFIG,
      saveSettings: () => {
        suspectRows = [suspect(1), suspect(2), suspect(3), suspect(4)];
        return { errors: [] };
      },
    });
    renderWithProviders(<ProjectApp projectId="10002" projectKey="REQ" />);
    await waitFor(() => expect(calls('getSuspects')).toHaveLength(1));
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('4')).toBeInTheDocument();
  });

  it('shows a translated permission error in the Settings tab without breaking other tabs', async () => {
    mockResolvers({
      getOverview: overview(),
      getSuspects: { rows: [], next: null },
      getGaps: { rows: [gap(1)], next: null },
      getIssueTypes: [],
      getLinkTypes: [],
      getSettings: () => { throw new Error('no-permission'); },
    });
    renderWithProviders(<ProjectApp projectId="10002" projectKey="REQ" />);
    expect(await screen.findByRole('button', { name: 'REQ-1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(await screen.findByText('You do not have permission for this action in this project.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Coverage' }));
    expect(screen.getByRole('button', { name: 'REQ-1' })).toBeInTheDocument();
  });

  it('saves settings, shows the saved toast and reloads the overview so onboarding disappears', async () => {
    let configured = false;
    mockResolvers({
      getOverview: () => overview({ configured }),
      getSuspects: { rows: [], next: null },
      getGaps: { rows: [gap(1)], next: null },
      getIssueTypes: [{ id: '1', name: 'Story' }, { id: '2', name: 'Test' }],
      getLinkTypes: [],
      getSettings: CONFIG,
      saveSettings: () => {
        configured = true;
        return { errors: [] };
      },
    });
    renderWithProviders(<ProjectApp projectId="10002" projectKey="REQ" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await expectFlag('Saved. Sync started in the background.', 'success');
    await waitFor(() => expect(calls('getOverview')).toHaveLength(2));
    await waitFor(() => expect(screen.queryByText('Set up ArtUp Trace in three steps')).not.toBeInTheDocument());
  });

  it('lists validation errors returned by saveSettings', async () => {
    mockResolvers({
      getOverview: overview({ configured: false }),
      getIssueTypes: [],
      getLinkTypes: [],
      getSettings: CONFIG,
      saveSettings: { errors: ['Choose at least one requirement issue type.', 'Something custom.'] },
    });
    renderWithProviders(<ProjectApp projectId="10002" projectKey="REQ" />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Choose at least one requirement issue type.')).toBeInTheDocument();
    expect(screen.getByText('Something custom.')).toBeInTheDocument();
    expect(calls('getOverview')).toHaveLength(1);
  });
});

describe('CoverageTab', () => {
  const coverage = { total: 10, covered: 8, uncovered: 2, percent: 80 };

  it('shows the load error with Try again instead of the empty state', async () => {
    mockResolvers({ getGaps: () => { throw new Error('boom'); } });
    renderWithProviders(<CoverageTab projectId="10002" projectKey="REQ" coverage={coverage} />);
    expect(await screen.findByText('Something went wrong: boom')).toBeInTheDocument();
    expect(screen.queryByText('Every loaded requirement has a verification link.')).not.toBeInTheDocument();

    mockResolvers({ getGaps: { rows: [gap(1)], next: null } });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'REQ-1' })).toBeInTheDocument();
  });

  it('renders a 600-character summary in full inside a fixed-layout table', async () => {
    const long = `${'Требование 要件 🚀 '.repeat(40)}${'x'.repeat(600)}`.slice(0, 600);
    mockResolvers({ getGaps: { rows: [gap(1, long)], next: null } });
    renderWithProviders(<CoverageTab projectId="10002" projectKey="REQ" coverage={coverage} />);
    const cell = await screen.findByText(long);
    expect(cell.textContent).toHaveLength(600);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('filters loaded rows by key or summary', async () => {
    mockResolvers({ getGaps: { rows: [gap(1, 'Login works'), gap(2, 'Export works')], next: null } });
    renderWithProviders(<CoverageTab projectId="10002" projectKey="REQ" coverage={coverage} />);
    await screen.findByRole('button', { name: 'REQ-1' });
    fireEvent.change(screen.getByLabelText('Search by key or summary'), { target: { value: 'EXPORT' } });
    expect(screen.queryByRole('button', { name: 'REQ-1' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'REQ-2' })).toBeInTheDocument();
  });

  it('disables Load more while the next page is pending', async () => {
    const page = deferred();
    mockResolvers({ getGaps: ({ after }) => (after ? page.promise : { rows: [gap(1)], next: '1001' }) });
    renderWithProviders(<CoverageTab projectId="10002" projectKey="REQ" coverage={coverage} />);
    const button = await screen.findByRole('button', { name: /Load more/ });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('button', { name: /Load more/ })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /Load more/ }));
    expect(calls('getGaps')).toHaveLength(2);
    page.resolve({ rows: [gap(2)], next: null });
    expect(await screen.findByRole('button', { name: 'REQ-2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Load more/ })).not.toBeInTheDocument();
  });
});

describe('SuspectTab', () => {
  it('shows the gone toast and reloads the list when a confirm returns ok:false', async () => {
    mockResolvers({ getSuspects: { rows: [suspect(1)], next: null }, confirmLink: { ok: false } });
    const onChanged = vi.fn();
    renderWithProviders(<SuspectTab projectId="10002" projectKey="REQ" onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    await expectFlag('This link no longer exists; the list was refreshed.', 'warning');
    await waitFor(() => expect(calls('getSuspects')).toHaveLength(2));
    expect(calls('confirmLink')[0][1]).toEqual({ projectId: '10002', linkId: '2001' });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('confirms selected links one by one and shows a success toast', async () => {
    let rows = [suspect(1), suspect(2), suspect(3)];
    mockResolvers({
      getSuspects: () => ({ rows, next: null }),
      confirmLink: ({ linkId }) => {
        rows = rows.filter((r) => r.linkId !== linkId);
        return { ok: true };
      },
    });
    renderWithProviders(<SuspectTab projectId="10002" projectKey="REQ" />);
    fireEvent.click(await screen.findByLabelText('Select link of REQ-1'));
    fireEvent.click(screen.getByLabelText('Select link of REQ-3'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm selected (2)' }));
    await expectFlag('2 links confirmed', 'success');
    expect(calls('confirmLink').map(([, p]) => p.linkId)).toEqual(['2001', '2003']);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'REQ-1' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'REQ-2' })).toBeInTheDocument();
  });

  it('disables every Confirm button while a confirmation is in flight', async () => {
    const pending = deferred();
    mockResolvers({ getSuspects: { rows: [suspect(1), suspect(2)], next: null }, confirmLink: () => pending.promise });
    renderWithProviders(<SuspectTab projectId="10002" projectKey="REQ" />);
    const [first] = await screen.findAllByRole('button', { name: 'Confirm' });
    fireEvent.click(first);
    await waitFor(() => screen.getAllByRole('button', { name: /Confirm/ }).forEach((b) => expect(b).toBeDisabled()));
    expect(calls('confirmLink')).toHaveLength(1);
    pending.resolve({ ok: true });
    await expectFlag('Link confirmed', 'success');
  });

  it('does not confirm or count a selected row that the search hides', async () => {
    mockResolvers({ getSuspects: { rows: [suspect(1), suspect(2)], next: null }, confirmLink: { ok: true } });
    renderWithProviders(<SuspectTab projectId="10002" projectKey="REQ" />);
    fireEvent.click(await screen.findByLabelText('Select link of REQ-1'));
    fireEvent.click(screen.getByLabelText('Select link of REQ-2'));
    expect(screen.getByRole('button', { name: 'Confirm selected (2)' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Search by key or summary'), { target: { value: 'Summary 2' } });
    expect(screen.getByRole('button', { name: 'Confirm selected (1)' })).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Search by key or summary'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Confirm selected (1)' })).toBeEnabled();
    expect(screen.getByLabelText('Select link of REQ-1')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm selected (1)' }));
    await expectFlag('Link confirmed', 'success');
    expect(calls('confirmLink').map(([, p]) => p.linkId)).toEqual(['2002']);
  });

  it('keeps the Confirm buttons disabled until the reload after confirming finishes', async () => {
    const reload = deferred();
    mockResolvers({
      getSuspects: () => (calls('getSuspects').length > 1 ? reload.promise : { rows: [suspect(1), suspect(2)], next: null }),
      confirmLink: { ok: true },
    });
    renderWithProviders(<SuspectTab projectId="10002" projectKey="REQ" />);
    const [first, second] = await screen.findAllByRole('button', { name: 'Confirm' });
    fireEvent.click(first);
    await expectFlag('Link confirmed', 'success');
    await waitFor(() => expect(calls('getSuspects')).toHaveLength(2));
    expect(first).toBeDisabled();
    expect(second).toBeDisabled();
    fireEvent.click(second);
    expect(calls('confirmLink')).toHaveLength(1);
    expect(showFlag).toHaveBeenCalledTimes(1);
    reload.resolve({ rows: [suspect(2)], next: null });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled());
  });

  it('shows the empty state only after a successful empty load', async () => {
    mockResolvers({ getSuspects: { rows: [], next: null } });
    renderWithProviders(<SuspectTab projectId="10002" projectKey="REQ" />);
    expect(await screen.findByText('No suspect links')).toBeInTheDocument();
  });
});

describe('BaselinesTab', () => {
  const list = [
    { id: 3, name: 'Sprint 3', createdAt: '2026-09-20T10:00:00.000Z', status: 'capturing', memberCount: 0 },
    { id: 2, name: 'Sprint 2', createdAt: '2026-09-10T10:00:00.000Z', status: 'complete', memberCount: 12 },
    { id: 1, name: 'Sprint 1', createdAt: '2026-09-01T10:00:00.000Z', status: 'complete', memberCount: 10 },
  ];

  it('creates a baseline, shows a toast and refreshes the list', async () => {
    mockResolvers({ listBaselines: list, createBaseline: { baselineId: 4 } });
    renderWithProviders(<BaselinesTab projectId="10002" projectKey="REQ" />);
    expect(await screen.findByText('Capturing')).toBeInTheDocument();
    const create = screen.getByRole('button', { name: 'Create baseline' });
    expect(create).toBeDisabled();
    fireEvent.change(screen.getByLabelText('New baseline name'), { target: { value: '  Release 1 ' } });
    fireEvent.click(create);
    await expectFlag('Baseline Release 1 is being captured', 'success');
    expect(calls('createBaseline')[0][1]).toEqual({ projectId: '10002', name: 'Release 1' });
    await waitFor(() => expect(calls('listBaselines')).toHaveLength(2));
  });

  it('translates the sort tooltips, sort button description and empty select menu', async () => {
    mockResolvers({ listBaselines: [] });
    render(
      <I18nProvider locale="ru-RU">
        <ToastProvider><BaselinesTab projectId="10002" projectKey="REQ" /></ToastProvider>
      </I18nProvider>,
    );
    await screen.findByRole('table');
    const sortButtons = document.querySelectorAll('[aria-roledescription]');
    expect(sortButtons.length).toBeGreaterThan(0);
    sortButtons.forEach((b) => expect(b).toHaveAttribute('aria-roledescription', 'Кнопка сортировки'));
    expect(document.body.textContent).not.toMatch(/Sort (ascending|descending)|Sort button/);
    const input = document.getElementById('baseline-left');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown', keyCode: 40 });
    expect(await screen.findByText('Нет вариантов')).toBeInTheDocument();
  });

  it('keeps Compare disabled until two different complete baselines are chosen', async () => {
    mockResolvers({ listBaselines: list });
    renderWithProviders(<BaselinesTab projectId="10002" projectKey="REQ" />);
    await screen.findByText('Sprint 2');
    expect(screen.getByRole('button', { name: 'Compare' })).toBeDisabled();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4);
  });
});
