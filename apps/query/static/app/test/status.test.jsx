import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../src/i18n/index.js';
import { StatusPanel } from '../src/status/StatusPanel.jsx';

const view = (status) => render(<I18nProvider locale="en-US"><StatusPanel status={status} /></I18nProvider>);
const BASE = { queue: { pending: false, running: false }, lastRefresh: null, errors: [], progress: null, excluded: [] };

describe('StatusPanel', () => {
  it('shows an idle queue, no update yet and no errors', () => {
    view(BASE);
    expect(screen.getByText('Idle')).toBeTruthy();
    expect(screen.getByText('No update yet')).toBeTruthy();
    expect(screen.getByText('No errors in the JQL editor so far.')).toBeTruthy();
  });
  it('shows index progress per part', () => {
    view({ ...BASE, progress: { sprint: { done: 12400, total: 50000 }, comments: { done: 5, total: 5, finishedAt: 1 } } });
    expect(screen.getByText('12,400 of 50,000 work items')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
  });
  it('lists recent errors with the function name', () => {
    view({ ...BASE, errors: [{ at: Date.parse('2026-10-03T10:00:00Z'), functionName: 'parentsOf', message: 'Usage: parentsOf(subquery)' }] });
    expect(screen.getByText('parentsOf')).toBeTruthy();
    expect(screen.getByText('Usage: parentsOf(subquery)')).toBeTruthy();
  });
  it('shows a waiting queue', () => {
    view({ ...BASE, queue: { pending: true, running: false } });
    expect(screen.getByText('Waiting')).toBeTruthy();
  });
  it('shows a running queue over a pending one', () => {
    view({ ...BASE, queue: { pending: true, running: true } });
    expect(screen.getByText('Updating')).toBeTruthy();
    expect(screen.queryByText('Waiting')).toBeNull();
  });
  it('lists the excluded projects before any index part has started', () => {
    view({ ...BASE, progress: null, excluded: ['HR', 'OPS'] });
    expect(screen.getByText('Projects excluded from the index: HR, OPS')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
  it('never shows a part as more than complete', () => {
    view({ ...BASE, progress: { sprint: { done: 60, total: 50 } } });
    expect(screen.getByText('50 of 50 work items')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
  });
});
