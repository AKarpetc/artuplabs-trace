import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@forge/bridge';
import { AppError, call, errorMessage } from '../src/api.js';
import { createT, localeDictionaries } from '../src/i18n/index.js';

vi.mock('@forge/bridge', () => ({
  invoke: vi.fn(),
  view: { theme: { enable: vi.fn() }, getContext: vi.fn() },
  router: { navigate: vi.fn() },
}));

const t = createT('en-US', localeDictionaries);

describe('call', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('resolves with the invoke result on success', async () => {
    invoke.mockResolvedValue({ ok: true });
    await expect(call('getOverview', { projectId: '10002' })).resolves.toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith('getOverview', { projectId: '10002' });
  });

  it.each([
    ['no-permission', 'There was an error invoking the function - no-permission'],
    ['unlicensed', 'unlicensed'],
    ['bad-request', 'Error: bad-request'],
  ])('maps a rejection containing "%s" to that AppError code', async (code, rawMessage) => {
    invoke.mockRejectedValue(new Error(rawMessage));
    await expect(call('getOverview', {})).rejects.toMatchObject({ code, message: rawMessage });
  });

  it('maps an unrecognised rejection to the generic code, keeping the message', async () => {
    invoke.mockRejectedValue(new Error('Jira request failed (500)'));
    await expect(call('getIssueTypes', {})).rejects.toMatchObject({ code: 'generic', message: 'Jira request failed (500)' });
  });

  it('throws an AppError instance', async () => {
    invoke.mockRejectedValue(new Error('bad-request'));
    await expect(call('getOverview', {})).rejects.toBeInstanceOf(AppError);
  });
});

describe('errorMessage', () => {
  it('returns the dedicated translation for a known AppError code', () => {
    const error = new AppError('no-permission', 'no-permission');
    expect(errorMessage(t, error)).toBe('You do not have permission for this action in this project.');
  });

  it('returns the generic translation with the message for an unknown AppError code', () => {
    const error = new AppError('generic', 'Jira request failed (500)');
    expect(errorMessage(t, error)).toBe('Something went wrong: Jira request failed (500)');
  });

  it('maps a plain Error by inspecting its message', () => {
    const error = new Error('There was an error invoking the function - unlicensed');
    expect(errorMessage(t, error)).toBe('ArtUp Trace license is not active on this site.');
  });

  it('falls back to the generic translation for a plain Error with no known code', () => {
    const error = new Error('network down');
    expect(errorMessage(t, error)).toBe('Something went wrong: network down');
  });
});
