import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

vi.mock('@forge/bridge', () => ({
  view: {
    theme: { enable: vi.fn() },
    getContext: vi.fn().mockResolvedValue({
      locale: 'en_US',
      extension: { project: { id: '10002', key: 'REQ' } },
    }),
  },
  invoke: vi.fn(),
  router: { navigate: vi.fn() },
}));

describe('project page shell', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('bootstraps the Forge theme and renders the ArtUp Trace heading', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import('../src/project/main.jsx');
    await waitFor(() => expect(screen.getByText('ArtUp Trace')).toBeInTheDocument());
  });
});

describe('issue panel shell', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('bootstraps the Forge theme and renders the ArtUp Trace heading', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import('../src/issue/main.jsx');
    await waitFor(() => expect(screen.getByText('ArtUp Trace')).toBeInTheDocument());
  });
});
