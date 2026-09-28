import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

vi.mock('@forge/bridge', () => ({
  view: {
    theme: { enable: vi.fn() },
    getContext: vi.fn().mockResolvedValue({
      locale: 'en_US',
      siteUrl: 'https://artuplabs-dev.atlassian.net/wiki',
      environmentType: 'DEVELOPMENT',
      license: { active: true },
      extension: { space: { key: 'EXPT' }, content: { id: '123' } },
      moduleKey: 'export-space-page',
    }),
  },
  invoke: vi.fn().mockResolvedValue({ licensed: true }),
  requestConfluence: vi.fn().mockRejectedValue(new Error('offline')),
  router: { navigate: vi.fn() },
  showFlag: vi.fn(() => ({ close: vi.fn(() => Promise.resolve(true)) })),
}));

describe('space page shell', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('bootstraps the Forge theme and renders the ArtUp Export heading', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import('../src/studio/main.jsx');
    await waitFor(() => expect(screen.getByText('ArtUp Export')).toBeInTheDocument());
  });
});

describe('content action shell', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('bootstraps the Forge theme and renders the ArtUp Export heading', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import('../src/action/main.jsx');
    await waitFor(() => expect(screen.getByText('ArtUp Export')).toBeInTheDocument());
  });
});
