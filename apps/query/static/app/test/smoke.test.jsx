import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/bridge', () => ({
  view: {
    getContext: vi.fn(async () => ({ locale: 'ru_RU', environmentType: 'DEVELOPMENT', extension: { type: 'jira:globalPage' } })),
    theme: { enable: vi.fn(async () => undefined) },
  },
  invoke: vi.fn(async (key) => (key === 'getAccess' ? { licensed: true, environmentType: 'DEVELOPMENT' } : undefined)),
}));

const { I18nProvider } = await import('../src/i18n/index.js');
const { GlobalApp } = await import('../src/app/GlobalApp.jsx');

describe('GlobalApp', () => {
  it('shows the app title once the licence check passes', async () => {
    render(<I18nProvider locale="ru-RU"><GlobalApp /></I18nProvider>);
    expect(await screen.findByRole('heading', { name: 'ArtUp Query' })).toBeInTheDocument();
  });
});
