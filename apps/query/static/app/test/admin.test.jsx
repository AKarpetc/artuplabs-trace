import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DEFAULT = async (key) => (key === 'adminStatus' ? { excluded: ['RPT'], progress: null, parts: ['sprint'] } : { excluded: [], started: ['sprint'] });
const invoke = vi.fn(DEFAULT);
const requestJira = vi.fn(async () => ({ ok: true, json: async () => ({ values: [{ key: 'RPT', name: 'Reports' }, { key: 'JQLG', name: 'JQL' }], isLast: true }) }));
vi.mock('@forge/bridge', () => ({
  invoke: (...a) => invoke(...a),
  requestJira: (...a) => requestJira(...a),
}));
const { I18nProvider } = await import('../src/i18n/index.js');
const { AdminPanel } = await import('../src/admin/AdminPanel.jsx');

const view = () => render(<I18nProvider locale="en-US"><AdminPanel /></I18nProvider>);

describe('AdminPanel', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(DEFAULT);
  });
  it('shows the excluded projects and saves a change', async () => {
    render(<I18nProvider locale="en-US"><AdminPanel /></I18nProvider>);
    expect(await screen.findByText('Reports (RPT)')).toBeTruthy();
    fireEvent.click(screen.getByTestId('save-excluded'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('setExcluded', { projectKeys: ['RPT'] }));
  });
  it('asks before resetting the index', async () => {
    render(<I18nProvider locale="en-US"><AdminPanel /></I18nProvider>);
    fireEvent.click(await screen.findByTestId('reset-index'));
    expect(screen.getByText('Rebuild the whole index?')).toBeTruthy();
    fireEvent.click(screen.getByTestId('reset-confirm'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('resetIndex', {}));
  });

  it('reads every page of projects', async () => {
    requestJira.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ values: [{ key: 'A', name: 'Alpha' }], isLast: false }) }));
    view();
    expect(await screen.findByText('Reports (RPT)')).toBeTruthy();
    expect(requestJira.mock.calls.slice(-2).map((c) => c[0])).toEqual(['/rest/api/3/project/search?maxResults=100&startAt=0', '/rest/api/3/project/search?maxResults=100&startAt=1']);
  });
  it('drops a key Jira no longer knows from the list it saves and says when the list is saved', async () => {
    invoke.mockImplementation(async (key) => (key === 'adminStatus' ? { excluded: ['GONE', 'RPT'], progress: null, parts: ['sprint'] } : { excluded: ['RPT'] }));
    view();
    expect(await screen.findByText('Reports (RPT)')).toBeTruthy();
    expect(screen.queryByText('GONE')).toBeNull();
    fireEvent.click(screen.getByTestId('save-excluded'));
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('setExcluded', { projectKeys: ['RPT'] });
  });
  it('keeps the success of a save when reading the status afterwards fails', async () => {
    let calls = 0;
    invoke.mockImplementation(async (key) => {
      if (key === 'adminStatus') {
        calls += 1;
        if (calls > 1) throw new Error('There was an error invoking the function - internal');
      }
      return DEFAULT(key);
    });
    view();
    await screen.findByText('Reports (RPT)');
    fireEvent.click(screen.getByTestId('save-excluded'));
    expect(await screen.findByText('Saved')).toBeTruthy();
  });
  it('keeps the dialog open while the reset is being sent', async () => {
    let release;
    invoke.mockImplementation(async (key) => (key === 'resetIndex' ? new Promise((r) => { release = r; }) : DEFAULT(key)));
    view();
    fireEvent.click(await screen.findByTestId('reset-index'));
    fireEvent.click(screen.getByTestId('reset-confirm'));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('resetIndex', {}));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape' });
    expect(screen.getByText('Rebuild the whole index?')).toBeTruthy();
    release({ started: ['sprint'] });
    await waitFor(() => expect(screen.queryByText('Rebuild the whole index?')).toBeNull());
  });
  it('explains that excluded projects leave every function and what a reindex repairs', async () => {
    view();
    expect(await screen.findByText(/answered by Jira itself and are not filtered: previousSprint, nextSprint/)).toBeTruthy();
    expect(screen.getByText(/moved to another project/)).toBeTruthy();
  });
  it('keeps the reset when the dialog is cancelled', async () => {
    view();
    fireEvent.click(await screen.findByTestId('reset-index'));
    fireEvent.click(screen.getByTestId('reset-cancel'));
    await waitFor(() => expect(screen.queryByText('Rebuild the whole index?')).toBeNull());
    expect(invoke).not.toHaveBeenCalledWith('resetIndex', {});
  });
  it('tells the admin to wait while the index is being built', async () => {
    invoke.mockImplementation(async (key) => {
      if (key === 'reindexProject') throw new Error('There was an error invoking the function - busy');
      return DEFAULT(key);
    });
    view();
    await screen.findByText('Reports (RPT)');
    fireEvent.click(screen.getByTestId('reindex-action'));
    expect(await screen.findByText('Wait until the index is built, then try again.')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('reindexProject', { projectKey: 'JQLG' });
  });
  it('confirms a started reindex', async () => {
    view();
    await screen.findByText('Reports (RPT)');
    fireEvent.click(screen.getByTestId('reindex-action'));
    expect(await screen.findByText('Reindexing JQL (JQLG)')).toBeTruthy();
  });
  it('shows the index progress with the shared component', async () => {
    invoke.mockImplementation(async (key) => (key === 'adminStatus' ? { excluded: [], progress: { sprint: { done: 5, total: 10 } }, parts: ['sprint'] } : {}));
    view();
    expect(await screen.findByText('5 of 10 work items')).toBeTruthy();
  });
  it('tells a user who is not a Jira administrator that only administrators can change these settings', async () => {
    invoke.mockImplementation(async () => {
      throw new Error('There was an error invoking the function - forbidden');
    });
    view();
    expect(await screen.findByText('Only Jira administrators can change these settings.')).toBeTruthy();
  });
  it('shows the error of a failed save', async () => {
    invoke.mockImplementation(async (key) => {
      if (key === 'setExcluded') throw new Error('There was an error invoking the function - bad-request');
      return DEFAULT(key);
    });
    view();
    await screen.findByText('Reports (RPT)');
    fireEvent.click(screen.getByTestId('save-excluded'));
    expect(await screen.findByText('The request was not valid.')).toBeTruthy();
  });
});
