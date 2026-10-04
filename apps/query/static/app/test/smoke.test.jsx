import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STATUS = {
  functions: [{ name: 'subtasksOf', group: 'query', usage: 'subtasksOf(subquery)', examples: ['issue in subtasksOf("project = DEMO")'] }],
  queue: { pending: false, running: false },
  lastRefresh: null,
  errors: [],
  progress: null,
  excluded: [],
};

const DEFAULT = async (key) => (key === 'getAccess' ? { licensed: true, environmentType: 'DEVELOPMENT' } : STATUS);
const invoke = vi.fn(DEFAULT);
const withFunction = (name) => ({ ...STATUS, functions: [{ ...STATUS.functions[0], name }] });
const failing = () => Promise.reject(new Error('There was an error invoking the function - internal'));

vi.mock('@forge/bridge', () => ({
  view: {
    getContext: vi.fn(async () => ({ locale: 'ru_RU', environmentType: 'DEVELOPMENT', extension: { type: 'jira:globalPage' } })),
    theme: { enable: vi.fn(async () => undefined) },
  },
  invoke: (...a) => invoke(...a),
}));

const { I18nProvider } = await import('../src/i18n/index.js');
const { GlobalApp } = await import('../src/app/GlobalApp.jsx');

const view = () => render(<I18nProvider locale="en-US"><GlobalApp /></I18nProvider>);

describe('GlobalApp', () => {
  beforeEach(() => {
    window.localStorage.clear();
    invoke.mockReset();
    invoke.mockImplementation(DEFAULT);
  });
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
  it('labels the open tab panel with its tab', async () => {
    view();
    await screen.findByTestId('fn-subtasksOf');
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(screen.getByTestId('tab-functions').id);
    fireEvent.click(screen.getByTestId('tab-status'));
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(screen.getByTestId('tab-status').id);
  });
  it('shows skeleton cards while the status loads', async () => {
    invoke.mockImplementation((key) => (key === 'getAccess' ? DEFAULT(key) : new Promise(() => {})));
    view();
    expect(await screen.findByTestId('status-loading')).toBeInTheDocument();
  });
  it('shows the error screen when the first status read fails and retries from it', async () => {
    invoke.mockImplementation((key) => (key === 'getAccess' ? DEFAULT(key) : failing()));
    view();
    expect(await screen.findByText('Something went wrong on our side. Try again in a minute.')).toBeInTheDocument();
    invoke.mockImplementation(DEFAULT);
    fireEvent.click(screen.getByText('Try again'));
    expect(await screen.findByTestId('fn-subtasksOf')).toBeInTheDocument();
  });
  it('keeps the last status with an inline warning when a later read fails', async () => {
    view();
    await screen.findByTestId('fn-subtasksOf');
    invoke.mockImplementation((key) => (key === 'getAccess' ? DEFAULT(key) : failing()));
    fireEvent.click(screen.getByTestId('status-refresh'));
    expect(await screen.findByTestId('status-stale')).toBeInTheDocument();
    expect(screen.getByTestId('fn-subtasksOf')).toBeInTheDocument();
    invoke.mockImplementation(DEFAULT);
    fireEvent.click(screen.getByTestId('status-refresh'));
    await waitFor(() => expect(screen.queryByTestId('status-stale')).toBeNull());
  });
  it('applies only the reply to the latest status read', async () => {
    let releaseFirst;
    invoke.mockImplementation((key) => {
      if (key === 'getAccess') return DEFAULT(key);
      return new Promise((done) => { releaseFirst = done; });
    });
    view();
    await waitFor(() => expect(releaseFirst).toBeTypeOf('function'));
    const first = releaseFirst;
    invoke.mockImplementation(async (key) => (key === 'getAccess' ? DEFAULT(key) : withFunction('parentsOf')));
    fireEvent.click(screen.getByTestId('status-refresh'));
    expect(await screen.findByTestId('fn-parentsOf')).toBeInTheDocument();
    await act(async () => first(withFunction('epicsOf')));
    expect(screen.queryByTestId('fn-epicsOf')).toBeNull();
    expect(screen.getByTestId('fn-parentsOf')).toBeInTheDocument();
  });
});
