import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { invoke } from '@forge/bridge';
import { I18nProvider } from '../src/i18n/index.js';
import { ToastProvider } from '../src/components/Toasts.jsx';
import { BaselineDiff } from '../src/project/BaselineDiff.jsx';

vi.mock('@forge/bridge', () => ({
  invoke: vi.fn(),
  view: { theme: { enable: vi.fn() }, getContext: vi.fn() },
  router: { navigate: vi.fn() },
  showFlag: vi.fn(() => ({ close: vi.fn(() => Promise.resolve(true)) })),
}));

function mockGetDiff(response) {
  invoke.mockImplementation(async (key) => {
    if (key !== 'getDiff') {
      throw new Error(`unexpected resolver ${key}`);
    }
    return response;
  });
}

function renderWithProviders(ui, locale = 'en-US') {
  return render(
    <I18nProvider locale={locale}>
      <ToastProvider>{ui}</ToastProvider>
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('BaselineDiff', () => {
  it('includes the status-changed count in the counts line', async () => {
    mockGetDiff({
      counts: { added: 1, removed: 2, changed: 3, linksChanged: 4, statusChanged: 5 },
      rows: [],
      next: null,
    });
    renderWithProviders(<BaselineDiff projectId="10002" projectKey="REQ" leftId={1} rightId={2} />);
    expect(await screen.findByText('Added 1 · Removed 2 · Changed 3 · Links changed 4 · Status changed 5')).toBeInTheDocument();
  });

  it('lists a status-only change as its own row with a status-changed lozenge distinct from a content change', async () => {
    mockGetDiff({
      counts: { added: 0, removed: 0, changed: 1, linksChanged: 0, statusChanged: 1 },
      rows: [
        { issueId: '1', issueKey: 'REQ-1', summary: 'Content change', change: 'changed', leftStatus: 'To Do', rightStatus: 'To Do' },
        { issueId: '2', issueKey: 'REQ-2', summary: 'Status only', change: 'status-changed', leftStatus: 'To Do', rightStatus: 'Done' },
      ],
      next: null,
    });
    renderWithProviders(<BaselineDiff projectId="10002" projectKey="REQ" leftId={1} rightId={2} />);
    const changedLozenge = (await screen.findByText('Changed')).parentElement;
    const statusLozenge = (await screen.findByText('Status changed')).parentElement;
    expect(statusLozenge).toBeInTheDocument();
    expect(statusLozenge.className).not.toBe(changedLozenge.className);
    expect(screen.getByText('To Do → Done')).toBeInTheDocument();
  });

  it('translates the status-changed label into another locale', async () => {
    mockGetDiff({
      counts: { added: 0, removed: 0, changed: 0, linksChanged: 0, statusChanged: 1 },
      rows: [{ issueId: '1', issueKey: 'REQ-1', summary: 'Status only', change: 'status-changed', leftStatus: 'To Do', rightStatus: 'Done' }],
      next: null,
    });
    renderWithProviders(<BaselineDiff projectId="10002" projectKey="REQ" leftId={1} rightId={2} />, 'de-DE');
    expect(await screen.findByText('Status geändert')).toBeInTheDocument();
  });
});
