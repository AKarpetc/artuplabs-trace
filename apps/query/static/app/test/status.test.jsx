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
    expect(screen.getByText('12,400 of 50,000 issues')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
  });
  it('lists recent errors with the function name', () => {
    view({ ...BASE, errors: [{ at: Date.parse('2026-10-03T10:00:00Z'), functionName: 'parentsOf', message: 'Usage: parentsOf(subquery)' }] });
    expect(screen.getByText('parentsOf')).toBeTruthy();
    expect(screen.getByText('Usage: parentsOf(subquery)')).toBeTruthy();
  });
});
