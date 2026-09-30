import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { router, view } from '@forge/bridge';
import { I18nProvider } from '../../src/i18n/index.js';
import { ActionApp } from '../../src/app/ActionApp.jsx';
import { globalPagePath } from '../../src/app/globalPageUrl.js';

vi.mock('@forge/bridge', async () => {
  const mock = await import('../../preview/bridgeMock.js');
  return {
    ...mock,
    requestJira: vi.fn(mock.requestJira),
    invoke: vi.fn(mock.invoke),
    router: { navigate: vi.fn() },
    view: { ...mock.view, close: vi.fn() },
  };
});

vi.mock('../../src/infra/download.js', () => ({ saveBlob: vi.fn() }));

const WAIT = { timeout: 5000 };
const LOCAL_ID = 'ari:cloud:ecosystem::extension/app-1/env-2/static/reports-navigator-action';
const project = { id: '10000', key: 'RPT', type: 'software' };

const renderApp = (extension, environmentType = 'DEVELOPMENT') => render(
  <I18nProvider locale="en-US">
    <ActionApp context={{ environmentType, localId: LOCAL_ID, siteUrl: 'https://preview.atlassian.net', extension }} />
  </I18nProvider>,
);

beforeEach(() => {
  window.history.replaceState(null, '', '/?screen=wizard&state=form');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('action entry labels', () => {
  it.each([
    ['navigator with a query', { type: 'jira:issueNavigatorAction', jql: 'project = RPT' }, 'Issues from the current search'],
    ['navigator with selected issues', { type: 'jira:issueNavigatorAction', issueKeys: ['RPT-1', 'RPT-2'] }, 'Issues from the current search'],
    ['board', { type: 'jira:boardAction', board: { id: '3', type: 'scrum' }, project }, 'Board 3'],
    ['backlog', { type: 'jira:backlogAction', board: { id: '4', type: 'kanban' }, project }, 'Board 4'],
    ['sprint', { type: 'jira:sprintAction', sprint: { id: '5', state: 'active' }, board: { id: '3', type: 'scrum' }, project }, 'Sprint 5'],
    ['issue', { type: 'jira:issueAction', issue: { id: '10001', key: 'RPT-7', type: 'Task', typeId: '10002' }, project }, 'Issue RPT-7'],
  ])('%s shows its entry label', async (_name, extension, label) => {
    renderApp(extension);
    expect(await screen.findByText(label, {}, WAIT)).toBeInTheDocument();
  });

  it('shows the lock state when the site has no licence in production', async () => {
    window.history.replaceState(null, '', '/?state=unlicensed');
    renderApp({ type: 'jira:issueAction', issue: { key: 'RPT-7' }, project }, 'PRODUCTION');
    expect(await screen.findByText('ArtUp Reports needs an active license', {}, WAIT)).toBeInTheDocument();
  });
});

describe('unknown context', () => {
  it('shows one sentence and the action to open the global page', async () => {
    renderApp({ type: 'jira:issueAction' });
    expect(await screen.findByText('ArtUp Reports cannot tell what to export from here, so open it from the global page.', {}, WAIT)).toBeInTheDocument();
    expect(screen.getByTestId('open-global')).toHaveTextContent('Open ArtUp Reports');
  });

  it('navigates to the global page of the app and environment', async () => {
    renderApp({ type: 'jira:issueAction' });
    fireEvent.click(await screen.findByTestId('open-global', {}, WAIT));
    expect(vi.mocked(router.navigate).mock.calls).toEqual([['/jira/apps/app-1/env-2']]);
  });
});

describe('result view', () => {
  it('offers Close after a finished export and closes the modal', async () => {
    window.history.replaceState(null, '', '/?screen=wizard&state=done');
    renderApp({ type: 'jira:issueAction', issue: { key: 'RPT-7' }, project });
    fireEvent.click(await screen.findByTestId('wizard-export', {}, WAIT));
    await waitFor(() => expect(screen.getByTestId('result-view')).toBeInTheDocument(), WAIT);
    fireEvent.click(screen.getByTestId('close-modal'));
    expect(view.close).toHaveBeenCalledTimes(1);
  });
});

describe('globalPagePath', () => {
  it.each([
    [LOCAL_ID, '/jira/apps/app-1/env-2'],
    ['', null],
    [undefined, null],
    ['ari:cloud:ecosystem::extension/app-1', null],
  ])('%s gives %s', (localId, expected) => {
    expect(globalPagePath(localId)).toBe(expected);
  });
});
