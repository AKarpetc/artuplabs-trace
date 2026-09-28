import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@forge/bridge', () => ({
  requestConfluence: vi.fn(),
}));

const { BridgeProbe } = await import('../src/probe/BridgeProbe.jsx');

describe('BridgeProbe', () => {
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
});
