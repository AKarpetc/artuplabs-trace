import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DEFAULT_OPTIONS } from '../src/core/presets.js';
import { I18nProvider, localeDictionaries } from '../src/i18n/index.js';
import { createFakeConfluence } from './fixtures/fakeConfluence.js';

const { invoke, close } = vi.hoisted(() => ({ invoke: vi.fn(), close: vi.fn() }));
vi.mock('@forge/bridge', () => ({
  invoke,
  requestConfluence: vi.fn(),
  view: { getContext: vi.fn(), theme: { enable: vi.fn() }, close },
  router: { open: vi.fn(), navigate: vi.fn() },
}));

const { ActionApp, truncateTitle } = await import('../src/action/ActionApp.jsx');

const en = localeDictionaries['en-US'];
const SITE = 'https://acme.atlassian.net';
const SPACE = { id: '5', key: 'ENG', name: 'Engineering' };
const LONG = `Release checklist for the ${'very '.repeat(20)}long migration`;
const PAGES = [
  { id: '1', title: 'Engineering', parentId: null, position: 0, version: 1, body: '<p>Home</p>', attachments: [] },
  { id: '10', title: 'Runbooks', parentId: '1', position: 0, version: 2, body: '<p>Runbooks</p>', attachments: [] },
  { id: '11', title: 'Deploy', parentId: '10', position: 0, version: 1, body: '<p>Deploy</p>', attachments: [] },
  { id: '12', title: 'Roll back', parentId: '10', position: 1, version: 1, body: '<p>Roll back</p>', attachments: [] },
  { id: '20', title: LONG, parentId: '1', position: 1, version: 1, body: '<p>Long</p>', attachments: [] },
];
const FILE_NAME = /^artup-export-ENG-runbooks-\d{4}-\d{2}-\d{2}\.zip$/;

function contextFor(content) {
  return { siteUrl: SITE, locale: 'en_US', extension: { type: 'confluence:contentAction', space: { key: 'ENG', id: '5' }, content } };
}

function renderAction({ content = { id: '10', type: 'page' }, locale = 'en-US', onStart } = {}) {
  const fake = createFakeConfluence({ space: SPACE, pages: PAGES, users: {} });
  const save = vi.fn();
  render(
    <I18nProvider locale={locale}>
      <ActionApp context={contextFor(content)} createClient={() => fake.client} save={save} onStart={onStart} />
    </I18nProvider>,
  );
  return { fake, save };
}

const exportButton = () => screen.getByTestId('action-export');

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (key) => (key === 'getAccess' ? { licensed: true } : null));
  close.mockReset();
});
afterEach(cleanup);

describe('truncateTitle', () => {
  it('keeps short titles and cuts long ones to 60 characters with an ellipsis', () => {
    expect(truncateTitle('Runbooks')).toBe('Runbooks');
    expect(truncateTitle('x'.repeat(60))).toBe('x'.repeat(60));
    const cut = truncateTitle('y'.repeat(80));
    expect(cut).toHaveLength(60);
    expect(cut.endsWith('…')).toBe(true);
  });
  it('counts characters, not UTF-16 units', () => {
    expect(Array.from(truncateTitle('😀'.repeat(70)))).toHaveLength(60);
  });
});

describe('page action modal', () => {
  it('renders the page title fetched for the page in context', async () => {
    renderAction();
    expect(await screen.findByRole('heading', { name: 'Export “Runbooks”' })).toBeInTheDocument();
  });

  it('takes the title from the context when it is there', async () => {
    renderAction({ content: { id: '10', type: 'page', title: 'Runbooks (context)' } });
    expect(await screen.findByRole('heading', { name: 'Export “Runbooks (context)”' })).toBeInTheDocument();
  });

  it('truncates a long title and keeps the full one for the tooltip', async () => {
    renderAction({ content: { id: '20', type: 'page' } });
    const heading = await screen.findByRole('heading', { name: `Export “${truncateTitle(LONG)}”` });
    expect(heading).toBeInTheDocument();
    fireEvent.mouseOver(screen.getByTestId('action-title'));
    expect(await screen.findByRole('tooltip', {}, { timeout: 2000 })).toHaveTextContent(LONG);
  });

  it('defaults to this page and shows the subpage count once it loads', async () => {
    renderAction();
    expect(await screen.findByTestId('action-page')).toHaveAttribute('aria-checked', 'true');
    expect(await screen.findByText('This page and 2 subpages')).toBeInTheDocument();
    await waitFor(() => expect(exportButton()).toHaveTextContent('Export 1 page'));
    fireEvent.click(screen.getByTestId('action-branch'));
    await waitFor(() => expect(exportButton()).toHaveTextContent('Export 3 pages'));
  });

  it('disables the branch choice for a page without subpages', async () => {
    renderAction({ content: { id: '11', type: 'page' } });
    const branch = await screen.findByTestId('action-branch');
    await waitFor(() => expect(branch).toHaveAttribute('aria-disabled', 'true'));
    expect(within(branch).getByText(en['action.noChildren'])).toBeInTheDocument();
  });

  it('runs a branch export and shows the result with the download', async () => {
    const onStart = vi.fn();
    const { save } = renderAction({ onStart });
    fireEvent.click(await screen.findByTestId('action-branch'));
    await waitFor(() => expect(exportButton()).toHaveTextContent('Export 3 pages'));
    fireEvent.click(exportButton());
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: 'branch', spaceKey: 'ENG', pageId: '10' }, options: DEFAULT_OPTIONS, mode: 'full', previousManifest: null, siteUrl: SITE,
    }));
    const result = await screen.findByTestId('result-view');
    expect(within(result).getByTestId('stat-pages')).toHaveTextContent('3');
    expect(screen.queryByTestId('result-illustration')).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatch(FILE_NAME);
    fireEvent.click(within(result).getByTestId('action-close'));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the modal from Cancel', async () => {
    renderAction();
    fireEvent.click(await screen.findByTestId('action-cancel'));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('keeps format details under More options, collapsed by default', async () => {
    renderAction();
    const toggle = await screen.findByTestId('action-more');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText(en['order.prefix'])).toBeNull();
    expect(screen.queryByTestId('drop-zone')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText(en['order.prefix'])).toBeInTheDocument();
    expect(screen.getByTestId('drop-zone')).toBeInTheDocument();
    expect(screen.getByTestId('mode-update')).toBeInTheDocument();
  });

  it('previews the files of the chosen scope and preset without a front-matter sample', async () => {
    renderAction();
    await waitFor(() => expect(screen.getAllByTestId('file-tree-row').map((row) => row.textContent)).toContain('runbooks.md'));
    fireEvent.click(screen.getByTestId('action-branch'));
    fireEvent.click(screen.getByTestId('preset-hugo'));
    await waitFor(() => expect(screen.getAllByTestId('file-tree-row').map((row) => row.textContent)).toContain('_index.md'));
    expect(screen.queryByTestId('front-matter')).toBeNull();
  });

  it('shows an empty state with Close when the page cannot be read', async () => {
    renderAction({ content: { id: '999', type: 'page' } });
    expect(await screen.findByText(en['action.notFound'])).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('action-close'));
    expect(close).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('action-export')).toBeNull();
  });

  it('shows only the licence empty state when unlicensed', async () => {
    invoke.mockImplementation(async () => ({ licensed: false }));
    renderAction();
    expect(await screen.findByText(en['unlicensed.title'])).toBeInTheDocument();
    expect(screen.queryByTestId('action-export')).toBeNull();
  });

  it('renders Russian labels with plural subpages', async () => {
    renderAction({ locale: 'ru-RU' });
    const dict = localeDictionaries['ru-RU'];
    expect(await screen.findByText(dict['action.withChildren'].few.replace('{count}', '2'))).toBeInTheDocument();
    expect(screen.getByTestId('action-more')).toHaveTextContent(dict['action.moreOptions']);
  });
});
