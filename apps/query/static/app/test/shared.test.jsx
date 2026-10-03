import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../src/i18n/index.js';
import { Card } from '../src/components/Card.jsx';
import { IndexProgress } from '../src/status/IndexProgress.jsx';

const view = (progress) => render(<I18nProvider locale="en-US"><IndexProgress progress={progress} /></I18nProvider>);

describe('Card', () => {
  it('renders its children under the test id', () => {
    render(<Card testId="card"><span>inside</span></Card>);
    expect(screen.getByTestId('card').textContent).toBe('inside');
  });
});

describe('IndexProgress', () => {
  it('counts the issues of a part that is filling', () => {
    view({ sprint: { done: 5, total: 10 } });
    expect(screen.getByText('5 of 10 issues')).toBeTruthy();
  });
  it('says Ready for a finished part', () => {
    view({ comments: { done: 3, total: 3, finishedAt: 1 } });
    expect(screen.getByText('Ready')).toBeTruthy();
  });
  it('renders nothing without progress', () => {
    const { container } = view(null);
    expect(container.textContent).toBe('');
  });
});
