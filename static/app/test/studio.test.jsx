import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { buildManifest } from '../src/core/manifest.js';
import { DEFAULT_OPTIONS } from '../src/core/presets.js';
import { I18nProvider, localeDictionaries } from '../src/i18n/index.js';
import { createFakeConfluence } from './fixtures/fakeConfluence.js';
import { routeConfluence } from '../preview/fixtures.js';

const { invoke, requestConfluence, routerOpen } = vi.hoisted(() => ({ invoke: vi.fn(), requestConfluence: vi.fn(), routerOpen: vi.fn() }));
vi.mock('@forge/bridge', () => ({
  invoke,
  requestConfluence,
  view: { getContext: vi.fn(), theme: { enable: vi.fn() } },
  router: { open: routerOpen, navigate: vi.fn() },
}));

const { StudioApp } = await import('../src/studio/StudioApp.jsx');

const SITE = 'https://acme.atlassian.net';
const SPACE = { id: '5', key: 'ENG', name: 'Engineering' };
const PAGES = [
  { id: '1', title: 'Engineering', parentId: null, position: 0, version: 3, labels: ['team'], attachments: [] },
  { id: '2', title: 'Getting started', parentId: '1', position: 0, version: 1, attachments: [] },
  { id: '3', title: 'Café', parentId: '1', position: 1, version: 2, attachments: [] },
];
const context = { siteUrl: SITE, locale: 'en_US', extension: { space: { key: 'ENG', id: '5' } } };

const rows = () => screen.queryAllByTestId('file-tree-row').map((row) => row.textContent);
const exportButton = () => screen.getByTestId('studio-export');

function renderStudio({ locale = 'en-US', onStart, createClient } = {}) {
  const fake = createFakeConfluence({ space: SPACE, pages: PAGES, users: {} });
  const view = render(
    <I18nProvider locale={locale}>
      <StudioApp context={context} createClient={createClient ?? (() => fake.client)} onStart={onStart} />
    </I18nProvider>,
  );
  return { fake, view };
}

const delay = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});
const docsContext = { siteUrl: 'https://preview.atlassian.net', locale: 'en_US', extension: { space: { key: 'DOCS', id: '98001' } } };

function renderBridgeStudio() {
  requestConfluence.mockReset();
  requestConfluence.mockImplementation(async (path) => {
    await delay(40);
    return routeConfluence(path);
  });
  return render(
    <I18nProvider locale="en-US">
      <StudioApp context={docsContext} />
    </I18nProvider>,
  );
}

const scanCalls = () => requestConfluence.mock.calls.map(([path]) => path).filter((path) => /\/pages(\/\d+\/children)?\?/.test(path));

function manifestFile(options = DEFAULT_OPTIONS, name = 'export-manifest.json') {
  const pages = PAGES.map((p, i) => ({
    id: p.id, title: p.title, parentId: p.parentId, version: p.version, path: `p${i}.md`, name: `p${i}`, weight: 10, links: [], attachments: [],
  }));
  const text = buildManifest({ siteUrl: SITE, spaceKey: 'ENG', rootPageId: null, options, pages, warnings: [] });
  return new File([text], name, { type: 'application/json' });
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (key) => (key === 'getAccess' ? { licensed: true } : null));
});
afterEach(cleanup);

describe('export studio', () => {
  it('shows only the licence empty state when unlicensed', async () => {
    invoke.mockImplementation(async () => ({ licensed: false }));
    renderStudio();
    expect(await screen.findByText('ArtUp Export needs an active licence')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-export')).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('defaults to the whole space and previews its files and page count', async () => {
    renderStudio();
    const space = await screen.findByTestId('scope-space');
    expect(space).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(rows()).toEqual(expect.arrayContaining(['engineering', 'index.md', 'getting-started.md', 'cafe.md', 'export-manifest.json'])));
    await waitFor(() => expect(exportButton()).toHaveTextContent('Export 3 pages'));
    expect(exportButton()).toBeEnabled();
    expect(await screen.findByTestId('front-matter')).toHaveTextContent('title: "Engineering"');
    expect(screen.getByText('ENG · Engineering')).toBeInTheDocument();
  });

  it('follows the preset in the tree and in the front-matter sample', async () => {
    renderStudio();
    await waitFor(() => expect(rows()).toContain('index.md'));
    fireEvent.click(screen.getByTestId('preset-hugo'));
    await waitFor(() => expect(rows()).toContain('_index.md'));
    expect(screen.getByTestId('front-matter')).toHaveTextContent('weight: 10');
    fireEvent.click(screen.getByTestId('preset-docusaurus'));
    await waitFor(() => expect(rows()).toContain('_category_.json'));
    expect(screen.getByTestId('front-matter')).toHaveTextContent('sidebar_position: 10');
  });

  it('switches file names to numeric prefixes', async () => {
    renderStudio();
    await waitFor(() => expect(rows()).toContain('cafe.md'));
    fireEvent.click(screen.getByLabelText('Numeric prefixes in file names'));
    await waitFor(() => expect(rows()).toContain('020-cafe.md'));
  });

  it('needs a picked page for a branch export', async () => {
    const onStart = vi.fn();
    renderStudio({ onStart });
    await waitFor(() => expect(exportButton()).toHaveTextContent('Export 3 pages'));
    fireEvent.click(screen.getByTestId('scope-branch'));
    expect(exportButton()).toBeDisabled();
    const input = screen.getByLabelText('Page to export');
    fireEvent.change(input, { target: { value: 'Caf' } });
    const option = await screen.findByText('Café', { selector: '[data-testid="picker-option-title"]' });
    fireEvent.click(option);
    await waitFor(() => expect(exportButton()).toHaveTextContent('Export 1 page'));
    expect(exportButton()).toBeEnabled();
    fireEvent.click(exportButton());
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({
      target: { kind: 'branch', spaceKey: 'ENG', pageId: '3' }, options: DEFAULT_OPTIONS, mode: 'full', previousManifest: null, siteUrl: SITE,
    }));
  });

  it('loads a dropped manifest, switches to update and warns when options differ', async () => {
    const onStart = vi.fn();
    renderStudio({ onStart });
    const zone = await screen.findByTestId('drop-zone');
    fireEvent.drop(zone, { dataTransfer: { files: [manifestFile()] } });
    expect(await screen.findByText('Previous export: 3 pages')).toBeInTheDocument();
    expect(screen.getByTestId('mode-update')).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => expect(exportButton()).toBeEnabled());
    fireEvent.click(exportButton());
    expect(onStart).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'update', fullReason: null }));
    expect(onStart.mock.lastCall[0].previousManifest.pages).toHaveLength(3);

    fireEvent.drop(zone, { dataTransfer: { files: [manifestFile({ ...DEFAULT_OPTIONS, preset: 'hugo' })] } });
    expect(await screen.findByText(/A full export will be made because the format options differ/)).toBeInTheDocument();
  });

  it('reports a file that is not a manifest', async () => {
    renderStudio();
    const zone = await screen.findByTestId('drop-zone');
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['{"a":1}'], 'x.json')] } });
    expect(await screen.findByText('This file is not an ArtUp Export manifest.')).toBeInTheDocument();
    expect(screen.getByTestId('mode-update')).toHaveAttribute('aria-checked', 'false');
  });

  it('keeps Export disabled in update mode until a previous export is loaded', async () => {
    renderStudio();
    await waitFor(() => expect(exportButton()).toBeEnabled());
    fireEvent.click(screen.getByTestId('mode-update'));
    expect(exportButton()).toBeDisabled();
  });

  it('renders Russian labels and plural button text', async () => {
    renderStudio({ locale: 'ru-RU' });
    const ru = localeDictionaries['ru-RU'];
    expect(await screen.findByText(ru['step.scope.title'])).toBeInTheDocument();
    await waitFor(() => expect(exportButton()).toHaveTextContent(ru['studio.exportButton'].few.replace('{count}', '3')));
    expect(within(screen.getByTestId('scope-space')).getByText(ru['scope.space.title'])).toBeInTheDocument();
  });

  it('stops the preview requests when the studio unmounts during a scan', async () => {
    const { unmount } = renderBridgeStudio();
    await waitFor(() => expect(scanCalls().length).toBeGreaterThan(0), { timeout: 2000 });
    unmount();
    const count = requestConfluence.mock.calls.length;
    await delay(400);
    expect(requestConfluence.mock.calls.length).toBe(count);
  });

  it('aborts the previous scan when the target changes', async () => {
    renderBridgeStudio();
    await waitFor(() => expect(scanCalls().length).toBeGreaterThan(0), { timeout: 2000 });
    fireEvent.click(screen.getByTestId('scope-branch'));
    const count = requestConfluence.mock.calls.length;
    await delay(400);
    expect(requestConfluence.mock.calls.length).toBe(count);
  });

  it('rejects a dropped file over 512 MB without reading it', async () => {
    renderStudio();
    const zone = await screen.findByTestId('drop-zone');
    const file = new File(['x'], 'huge.zip');
    Object.defineProperty(file, 'size', { value: 600 * 1024 * 1024 });
    file.arrayBuffer = vi.fn();
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(await screen.findByText('This file is larger than 512 MB. Drop the export-manifest.json from inside the zip instead.')).toBeInTheDocument();
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(screen.getByTestId('mode-update')).toHaveAttribute('aria-checked', 'false');
  });

  it('keeps only the latest picker search when responses arrive out of order', async () => {
    const fake = createFakeConfluence({ space: SPACE, pages: PAGES, users: {} });
    const answers = { Ca: [{ id: '2', title: 'Getting started', ancestors: [] }], Caf: [{ id: '3', title: 'Café', ancestors: ['Engineering'] }] };
    const client = {
      ...fake.client,
      async searchPages(key, text) {
        await delay(text === 'Ca' ? 300 : 20);
        return answers[text] ?? [];
      },
    };
    renderStudio({ createClient: () => client });
    fireEvent.click(await screen.findByTestId('scope-branch'));
    const input = screen.getByLabelText('Page to export');
    fireEvent.change(input, { target: { value: 'Ca' } });
    fireEvent.change(input, { target: { value: 'Caf' } });
    expect(await screen.findByText('Café', { selector: '[data-testid="picker-option-title"]' })).toBeInTheDocument();
    await delay(400);
    expect(screen.queryByText('Getting started', { selector: '[data-testid="picker-option-title"]' })).toBeNull();
    expect(screen.getByText('Café', { selector: '[data-testid="picker-option-title"]' })).toBeInTheDocument();
  });
});
