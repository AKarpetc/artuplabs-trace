import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const STATUS = {
  functions: [{ name: 'subtasksOf', group: 'query', usage: 'subtasksOf(subquery)', examples: ['issue in subtasksOf("project = DEMO")'] }],
  queue: { pending: false, running: false },
  lastRefresh: null,
  errors: [],
  progress: null,
  excluded: [],
};

vi.mock('@forge/bridge', () => ({
  view: {
    getContext: vi.fn(async () => ({ locale: 'ru_RU', environmentType: 'DEVELOPMENT', extension: { type: 'jira:globalPage' } })),
    theme: { enable: vi.fn(async () => undefined) },
  },
  invoke: vi.fn(async (key) => (key === 'getAccess' ? { licensed: true, environmentType: 'DEVELOPMENT' } : STATUS)),
}));

const { I18nProvider } = await import('../src/i18n/index.js');
const { GlobalApp } = await import('../src/app/GlobalApp.jsx');

describe('GlobalApp', () => {
  it('shows the app title once the licence check passes', async () => {
    render(<I18nProvider locale="ru-RU"><GlobalApp /></I18nProvider>);
    expect(await screen.findByRole('heading', { name: 'ArtUp Query' })).toBeInTheDocument();
  });
  it('opens on the function reference', async () => {
    window.localStorage.clear();
    render(<I18nProvider locale="en-US"><GlobalApp /></I18nProvider>);
    expect(await screen.findByTestId('fn-subtasksOf')).toBeInTheDocument();
  });
  it('switches to the status tab and remembers it', async () => {
    window.localStorage.clear();
    render(<I18nProvider locale="en-US"><GlobalApp /></I18nProvider>);
    fireEvent.click(await screen.findByTestId('tab-status'));
    expect(await screen.findByText('Idle')).toBeInTheDocument();
    expect(window.localStorage.getItem('query.globalTab')).toBe('1');
  });
});
