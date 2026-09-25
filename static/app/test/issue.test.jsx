import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { invoke } from '@forge/bridge';
import { I18nProvider } from '../src/i18n/index.js';
import { ToastProvider } from '../src/components/Toasts.jsx';
import { IssueApp } from '../src/issue/IssueApp.jsx';

vi.mock('@forge/bridge', () => ({
  invoke: vi.fn(),
  view: { theme: { enable: vi.fn() }, getContext: vi.fn() },
  router: { navigate: vi.fn() },
}));

function trace(overrides = {}) {
  return {
    isRequirement: true,
    covered: true,
    links: [{ linkId: '9001', otherKey: 'TST-1', linkTypeName: 'Tests', otherStatus: 'Done', suspect: false }],
    ...overrides,
  };
}

function suspectLink(n) {
  return { linkId: `900${n}`, otherKey: `TST-${n}`, linkTypeName: 'Tests', otherStatus: 'Done', suspect: true };
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

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('IssueApp', () => {
  it('shows the not-a-requirement text when the issue is not tracked', async () => {
    mockResolvers({ getIssueTrace: trace({ isRequirement: false, covered: false, links: [] }) });
    renderWithProviders(<IssueApp issueId="1" projectId="10002" />);
    expect(await screen.findByText(
      "This issue is not tracked as a requirement. Configure requirement types on the project's ArtUp Trace page.",
    )).toBeInTheDocument();
  });

  it('shows the load error with Try again and recovers on retry', async () => {
    mockResolvers({ getIssueTrace: () => { throw new Error('boom'); } });
    renderWithProviders(<IssueApp issueId="1" projectId="10002" />);
    expect(await screen.findByText('Something went wrong: boom')).toBeInTheDocument();

    mockResolvers({ getIssueTrace: trace() });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Covered')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'TST-1' })).toBeInTheDocument();
  });

  it('confirms a suspect link, shows a success toast and reloads the trace', async () => {
    let links = [suspectLink(1)];
    mockResolvers({
      getIssueTrace: () => trace({ covered: false, links }),
      confirmLink: ({ linkId }) => {
        links = links.map((l) => (l.linkId === linkId ? { ...l, suspect: false } : l));
        return { ok: true };
      },
    });
    renderWithProviders(<IssueApp issueId="1" projectId="10002" />);
    expect(await screen.findByText('Not covered')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Suspect — confirm' }));
    expect(await screen.findByText('Link confirmed')).toBeInTheDocument();
    expect(calls('confirmLink')[0][1]).toEqual({ projectId: '10002', linkId: '9001' });
    await waitFor(() => expect(calls('getIssueTrace')).toHaveLength(2));
    expect(await screen.findByText('OK')).toBeInTheDocument();
  });

  it('shows the gone toast and reloads when confirm returns ok:false', async () => {
    mockResolvers({ getIssueTrace: trace({ covered: false, links: [suspectLink(1)] }), confirmLink: { ok: false } });
    renderWithProviders(<IssueApp issueId="1" projectId="10002" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Suspect — confirm' }));
    expect(await screen.findByText('This link no longer exists; the list was refreshed.')).toBeInTheDocument();
    await waitFor(() => expect(calls('getIssueTrace')).toHaveLength(2));
  });

  it('disables the Confirm button until the reload after confirming finishes', async () => {
    const pending = deferred();
    mockResolvers({ getIssueTrace: trace({ covered: false, links: [suspectLink(1)] }), confirmLink: () => pending.promise });
    renderWithProviders(<IssueApp issueId="1" projectId="10002" />);
    const button = await screen.findByRole('button', { name: 'Suspect — confirm' });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(calls('confirmLink')).toHaveLength(1);
    pending.resolve({ ok: true });
    expect(await screen.findByText('Link confirmed')).toBeInTheDocument();
  });
});
