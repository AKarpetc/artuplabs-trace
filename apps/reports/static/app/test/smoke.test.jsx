import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '../src/i18n/index.js';
import { GlobalApp } from '../src/app/GlobalApp.jsx';

vi.mock('@forge/bridge', () => ({
  view: {
    theme: { enable: vi.fn().mockResolvedValue(undefined) },
    getContext: vi.fn().mockResolvedValue({
      locale: 'ru_RU',
      environmentType: 'DEVELOPMENT',
      extension: { type: 'jira:globalPage' },
    }),
  },
  invoke: vi.fn(),
}));

const renderApp = (context) => render(
  <I18nProvider locale="ru-RU">
    <GlobalApp context={context} />
  </I18nProvider>,
);

describe('global page shell', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders the title and the development probe outside production', () => {
    const { container } = renderApp({ environmentType: 'DEVELOPMENT', extension: { type: 'jira:globalPage' } });
    expect(screen.getByText('ArtUp Reports')).toBeInTheDocument();
    expect(container.querySelector('pre')).toHaveTextContent('jira:globalPage');
  });

  it('renders no development probe in production', () => {
    const { container } = renderApp({ environmentType: 'PRODUCTION', extension: { type: 'jira:globalPage' } });
    expect(container.querySelector('pre')).toBeNull();
  });
});
