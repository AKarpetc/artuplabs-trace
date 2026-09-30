import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../../src/i18n/index.js';
import { GlobalApp } from '../../src/app/GlobalApp.jsx';

vi.mock('@forge/bridge', async () => {
  const mock = await import('../../preview/bridgeMock.js');
  return { ...mock, requestJira: vi.fn(mock.requestJira), invoke: vi.fn(mock.invoke) };
});

const WAIT = { timeout: 5000 };
const CONTEXT = { environmentType: 'DEVELOPMENT', siteUrl: 'https://preview.atlassian.net', extension: { type: 'jira:globalPage' } };
const STORAGE_KEY = 'reports.globalTab';

const renderApp = (context = CONTEXT) => render(
  <I18nProvider locale="en-US">
    <GlobalApp context={context} />
  </I18nProvider>,
);

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/?screen=templates&state=filled');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('global page', () => {
  it('opens on the Export tab with the source step of the wizard', async () => {
    renderApp();
    expect(await screen.findByTestId('wizard-jql', {}, WAIT)).toBeInTheDocument();
    expect(screen.getByTestId('tab-export')).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to the Templates tab and lists templates there', async () => {
    renderApp();
    fireEvent.click(await screen.findByTestId('tab-templates', {}, WAIT));
    expect(await screen.findByTestId('panel-templates', {}, WAIT)).toBeInTheDocument();
    expect(screen.getByTestId('tab-templates')).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps the typed JQL when switching to Templates and back', async () => {
    renderApp();
    fireEvent.change(await screen.findByTestId('wizard-jql', {}, WAIT), { target: { value: 'project = RPT' } });
    fireEvent.click(screen.getByTestId('tab-templates'));
    fireEvent.click(screen.getByTestId('tab-export'));
    expect(screen.getByTestId('wizard-jql')).toHaveValue('project = RPT');
  });

  it('puts the project of the typed JQL into the file-name example', async () => {
    renderApp();
    fireEvent.change(await screen.findByTestId('wizard-jql', {}, WAIT), { target: { value: 'project = RPT' } });
    expect(screen.getByTestId('wizard-file-example').textContent).toMatch(/^Example: RPT-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it('remembers the selected tab in localStorage', async () => {
    renderApp();
    fireEvent.click(await screen.findByTestId('tab-templates', {}, WAIT));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('opens on the remembered tab', async () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    renderApp();
    expect(await screen.findByTestId('panel-templates', {}, WAIT)).toBeInTheDocument();
  });

  it('still switches tabs when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    renderApp();
    fireEvent.click(await screen.findByTestId('tab-templates', {}, WAIT));
    expect(await screen.findByTestId('panel-templates', {}, WAIT)).toBeInTheDocument();
  });

  it('shows the lock state and no tabs when the site has no licence', async () => {
    window.history.replaceState(null, '', '/?state=unlicensed');
    renderApp({ ...CONTEXT, environmentType: 'PRODUCTION' });
    expect(await screen.findByText('ArtUp Reports needs an active license', {}, WAIT)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('tab-export')).toBeNull());
  });
});
