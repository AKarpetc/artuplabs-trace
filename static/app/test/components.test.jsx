import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { router, showFlag } from '@forge/bridge';
import { IssueLink } from '../src/components/IssueLink.jsx';
import { PageSection } from '../src/components/PageSection.jsx';
import { SummaryCards } from '../src/components/SummaryCards.jsx';
import { ToastProvider, useToasts } from '../src/components/Toasts.jsx';

vi.mock('@forge/bridge', () => ({
  view: { theme: { enable: vi.fn() }, getContext: vi.fn() },
  invoke: vi.fn(),
  router: { navigate: vi.fn() },
  showFlag: vi.fn(() => ({ close: vi.fn(() => Promise.resolve(true)) })),
}));

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('IssueLink', () => {
  it('renders the issue key and navigates to it on click without leaving a real link href', () => {
    render(<IssueLink issueKey="REQ-42" />);
    const link = screen.getByRole('button', { name: 'REQ-42' });
    fireEvent.click(link);
    expect(router.navigate).toHaveBeenCalledWith('/browse/REQ-42');
  });
});

describe('SummaryCards', () => {
  it('renders a card for every item with its label and value', () => {
    render(
      <SummaryCards
        items={[
          { label: 'Coverage', value: '80%', appearance: 'success' },
          { label: 'Suspect links', value: 3, appearance: 'warning' },
          { label: 'Requirements', value: 12 },
        ]}
      />,
    );
    expect(screen.getByText('Coverage')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('Suspect links')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Requirements')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });
});

describe('PageSection', () => {
  it('renders the title, actions, and children', () => {
    render(
      <PageSection title="Coverage" actions={<button type="button">Export CSV</button>}>
        <p>Section body</p>
      </PageSection>,
    );
    expect(screen.getByRole('heading', { name: 'Coverage' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument();
    expect(screen.getByText('Section body')).toBeInTheDocument();
  });
});

function ToastTrigger({ toast }) {
  const { show, dismiss } = useToasts();
  return (
    <>
      <button type="button" onClick={() => { window.lastToastId = show(toast); }}>Trigger</button>
      <button type="button" onClick={() => dismiss(window.lastToastId)}>Close</button>
    </>
  );
}

describe('ToastProvider / useToasts', () => {
  it('shows a native auto-dismissing Jira flag with the matching type', () => {
    render(
      <ToastProvider>
        <ToastTrigger toast={{ title: 'Saved', description: 'All good', appearance: 'success' }} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    expect(showFlag).toHaveBeenCalledTimes(1);
    const options = showFlag.mock.calls[0][0];
    expect(options).toMatchObject({ title: 'Saved', description: 'All good', type: 'success', isAutoDismiss: true });
    expect(options.id).toEqual(expect.any(String));
    expect(options.id).not.toBe('');
  });

  it.each([
    ['error', 'error'],
    ['warning', 'warning'],
    [undefined, 'info'],
  ])('maps appearance %s to flag type %s', (appearance, type) => {
    render(
      <ToastProvider>
        <ToastTrigger toast={{ title: 'Message', appearance }} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    expect(showFlag).toHaveBeenCalledWith(expect.objectContaining({ title: 'Message', type }));
  });

  it('closes the flag returned by showFlag when dismiss is called with its id', () => {
    const close = vi.fn(() => Promise.resolve(true));
    showFlag.mockReturnValueOnce({ close });
    render(
      <ToastProvider>
        <ToastTrigger toast={{ title: 'Saved', appearance: 'success' }} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('passes actions to the flag as text and onClick', () => {
    const onClick = vi.fn();
    render(
      <ToastProvider>
        <ToastTrigger toast={{ title: 'Saved', actions: [{ content: 'Undo', onClick }] }} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    expect(showFlag.mock.calls[0][0].actions).toEqual([{ text: 'Undo', onClick }]);
  });
});
