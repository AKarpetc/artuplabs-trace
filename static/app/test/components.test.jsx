import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { router } from '@forge/bridge';
import { IssueLink } from '../src/components/IssueLink.jsx';
import { PageSection } from '../src/components/PageSection.jsx';
import { SummaryCards } from '../src/components/SummaryCards.jsx';
import { ToastProvider, useToasts } from '../src/components/Toasts.jsx';

vi.mock('@forge/bridge', () => ({
  view: { theme: { enable: vi.fn() }, getContext: vi.fn() },
  invoke: vi.fn(),
  router: { navigate: vi.fn() },
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

function ToastTrigger() {
  const { show } = useToasts();
  return (
    <button type="button" onClick={() => show({ title: 'Saved', appearance: 'success' })}>
      Trigger
    </button>
  );
}

describe('ToastProvider / useToasts', () => {
  it('shows a flag when show() is called and it can be dismissed with a single click', async () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByText('Saved')).not.toBeInTheDocument());
  });
});
