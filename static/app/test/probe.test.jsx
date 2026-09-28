import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { requestConfluence } = vi.hoisted(() => ({ requestConfluence: vi.fn() }));
vi.mock('@forge/bridge', () => ({ requestConfluence }));

const { BridgeProbe } = await import('../src/probe/BridgeProbe.jsx');

describe('BridgeProbe', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the context snapshot and both test buttons', () => {
    const context = {
      locale: 'en_US',
      siteUrl: 'https://artuplabs-dev.atlassian.net/wiki',
      environmentType: 'DEVELOPMENT',
      license: { active: true },
      extension: { space: { key: 'EXPT' } },
      moduleKey: 'export-space-page',
    };
    render(<BridgeProbe context={context} />);
    expect(screen.getByText('Attachment test')).toBeInTheDocument();
    expect(screen.getByText('Zip download test')).toBeInTheDocument();
    expect(screen.getByText(/"locale": "en_US"/)).toBeInTheDocument();
  });

  it('shows the failed step and message when requestConfluence rejects', async () => {
    requestConfluence.mockReset();
    requestConfluence.mockRejectedValueOnce(new Error('network down'));
    const context = { extension: { space: { key: 'EXPT' } } };
    render(<BridgeProbe context={context} />);
    fireEvent.click(screen.getByText('Attachment test'));
    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
    expect(screen.getByText(/\(space\)/)).toBeInTheDocument();
  });

  it('shows the homepage step when the space has no homepageId', async () => {
    requestConfluence.mockReset();
    requestConfluence.mockResolvedValueOnce({ json: () => Promise.resolve({ results: [{}] }) });
    const context = { extension: { space: { key: 'EXPT' } } };
    render(<BridgeProbe context={context} />);
    fireEvent.click(screen.getByText('Attachment test'));
    await waitFor(() => expect(screen.getByText(/\(homepage\)/)).toBeInTheDocument());
  });
});
