import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../src/i18n/index.js';
import { FunctionReference } from '../src/reference/FunctionReference.jsx';

const FUNCTIONS = [
  { name: 'subtasksOf', group: 'query', usage: 'subtasksOf(subquery)', examples: ['issue in subtasksOf("project = DEMO")'] },
  { name: 'hasLinks', group: 'site', usage: 'hasLinks([linkType])', examples: ['issue in hasLinks("blocks")'] },
];
const view = () => render(<I18nProvider locale="en-US"><FunctionReference functions={FUNCTIONS} /></I18nProvider>);

describe('FunctionReference', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  it('shows every function under its group heading', () => {
    view();
    expect(screen.getByTestId('fn-subtasksOf')).toBeTruthy();
    expect(screen.getByTestId('fn-hasLinks')).toBeTruthy();
    expect(screen.getByText('Work items of a query')).toBeTruthy();
  });
  it('filters by name or description', () => {
    view();
    fireEvent.change(screen.getByTestId('reference-search'), { target: { value: 'links' } });
    expect(screen.queryByTestId('fn-subtasksOf')).toBeNull();
    expect(screen.getByTestId('fn-hasLinks')).toBeTruthy();
  });
  it('offers to clear a search that matches nothing', () => {
    view();
    fireEvent.change(screen.getByTestId('reference-search'), { target: { value: 'zzz' } });
    fireEvent.click(screen.getByText('Clear search'));
    expect(screen.getByTestId('fn-subtasksOf')).toBeTruthy();
  });
  it('copies an example and says so', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    view();
    fireEvent.click(screen.getAllByTestId('copy')[0]);
    expect(await screen.findByText('Copied')).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith('issue in subtasksOf("project = DEMO")');
  });
  it('hides "Copied" after two seconds', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
    vi.useFakeTimers();
    view();
    await act(async () => {
      fireEvent.click(screen.getAllByTestId('copy')[0]);
    });
    expect(screen.getByText('Copied')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText('Copied')).toBeNull();
  });
  it('does not say "Copied" when the copy fails', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    document.execCommand = vi.fn(() => false);
    view();
    await act(async () => {
      fireEvent.click(screen.getAllByTestId('copy')[0]);
    });
    expect(document.execCommand).toHaveBeenCalledWith('copy');
    expect(screen.queryByText('Copied')).toBeNull();
  });
  it('explains the ScriptRunner difference', () => {
    view();
    expect(screen.getByText('Coming from ScriptRunner?')).toBeTruthy();
  });
});
