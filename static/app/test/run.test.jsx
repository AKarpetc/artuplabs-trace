import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DEFAULT_OPTIONS } from '../src/core/presets.js';
import { runExport } from '../src/export/pipeline.js';
import { I18nProvider, localeDictionaries } from '../src/i18n/index.js';
import { ConfluenceError } from '../src/infra/confluence.js';
import { readManifestFromFile } from '../src/infra/zip.js';
import { createFakeConfluence } from './fixtures/fakeConfluence.js';

const { invoke, routerOpen } = vi.hoisted(() => ({ invoke: vi.fn(), routerOpen: vi.fn() }));
vi.mock('@forge/bridge', () => ({
  invoke,
  requestConfluence: vi.fn(),
  view: { getContext: vi.fn(), theme: { enable: vi.fn() } },
  router: { open: routerOpen, navigate: vi.fn() },
}));

const { StudioApp } = await import('../src/studio/StudioApp.jsx');

const en = localeDictionaries['en-US'];
const SITE = 'https://acme.atlassian.net';
const SPACE = { id: '5', key: 'ENG', name: 'Engineering' };
const macro = (name) => `<p>Text</p><ac:structured-macro ac:name="${name}"></ac:structured-macro>`;
const PAGES = [
  { id: '1', title: 'Engineering', parentId: null, position: 0, version: 3, body: macro('mystery-widget'), attachments: [] },
  { id: '2', title: 'Getting started', parentId: '1', position: 0, version: 1, body: macro('toc'), attachments: [] },
  { id: '3', title: 'Café', parentId: '1', position: 1, version: 2, body: '<p>Plain</p>', attachments: [] },
];
const context = { siteUrl: SITE, locale: 'en_US', extension: { space: { key: 'ENG', id: '5' } } };
const FILE_NAME = /^artup-export-ENG-\d{4}-\d{2}-\d{2}(-update)?\.zip$/;

function gate() {
  let open;
  const opened = new Promise((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

function setup({ locale = 'en-US', pages = PAGES, wrap = (client) => client } = {}) {
  const fake = createFakeConfluence({ space: SPACE, pages, users: {} });
  const save = vi.fn();
  const client = wrap(fake.client);
  render(
    <I18nProvider locale={locale}>
      <StudioApp context={context} createClient={() => client} save={save} />
    </I18nProvider>,
  );
  return { fake, save };
}

function gatedLabels(held) {
  return (client) => ({
    ...client,
    async getLabels(id) {
      await held.opened;
      return client.getLabels(id);
    },
  });
}

async function startExport() {
  const button = await screen.findByTestId('studio-export');
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

async function previousManifestFile(fake) {
  const result = await runExport({
    client: fake.client, target: { kind: 'space', spaceKey: 'ENG' }, options: DEFAULT_OPTIONS, previousManifest: null,
    siteUrl: SITE, signal: new AbortController().signal, onProgress: () => {}, now: new Date(2026, 8, 1),
  });
  const manifest = JSON.parse(await readManifestFromFile(new File([result.blob], 'prev.zip')));
  manifest.pages.push({ ...manifest.pages[2], id: '9', title: 'Gone', path: 'engineering/gone.md', name: 'gone' });
  return new File([JSON.stringify(manifest)], 'export-manifest.json', { type: 'application/json' });
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (key) => (key === 'getAccess' ? { licensed: true } : null));
  routerOpen.mockReset();
});
afterEach(cleanup);

describe('export run', () => {
  it('shows the stages and a page counter while running, then the result and the download', async () => {
    const held = gate();
    const { save } = setup({ wrap: gatedLabels(held) });
    await startExport();
    const running = await screen.findByTestId('run-view');
    for (const stage of ['scan', 'pages', 'attachments', 'pack']) {
      expect(within(running).getByText(en[`run.stage.${stage}`])).toBeInTheDocument();
    }
    expect(await within(running).findByText('0 of 3 pages')).toBeInTheDocument();
    expect(within(running).getByText(en['run.keepOpen'])).toBeInTheDocument();
    held.open();
    const result = await screen.findByTestId('result-view');
    expect(within(result).getByText(en['result.title'])).toBeInTheDocument();
    expect(within(result).getByTestId('stat-pages')).toHaveTextContent('3');
    expect(save).toHaveBeenCalledTimes(1);
    const [fileName, blob] = save.mock.calls[0];
    expect(fileName).toMatch(FILE_NAME);
    expect(fileName).not.toContain('update');
    expect(within(result).getByText(fileName)).toBeInTheDocument();
    fireEvent.click(within(result).getByTestId('download-again'));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]).toEqual([fileName, blob]);
  });

  it('asks the browser to confirm leaving only while the export runs', async () => {
    const held = gate();
    setup({ wrap: gatedLabels(held) });
    await startExport();
    await screen.findByTestId('run-view');
    const during = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(true);
    held.open();
    await screen.findByTestId('result-view');
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('cancels back to the form with the choices kept', async () => {
    const held = gate();
    const { save } = setup({ wrap: gatedLabels(held) });
    fireEvent.click(await screen.findByTestId('preset-hugo'));
    await startExport();
    fireEvent.click(await screen.findByTestId('run-cancel'));
    expect(await screen.findByText(en['run.cancelled'])).toBeInTheDocument();
    expect(screen.getByTestId('preset-hugo')).toHaveAttribute('aria-checked', 'true');
    held.open();
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(screen.queryByTestId('result-view')).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it('shows the forbidden message when Confluence answers 403, and goes back to the form', async () => {
    setup({
      wrap: (client) => ({
        ...client,
        async getPages(ids, options) {
          if (options.withBody) throw new ConfluenceError(403, '/wiki/api/v2/pages');
          return client.getPages(ids, options);
        },
      }),
    });
    await startExport();
    const failed = await screen.findByTestId('failure-view');
    expect(within(failed).getByText(en['errors.forbidden'])).toBeInTheDocument();
    expect(within(failed).getByText(en['errors.tryAgain'])).toBeInTheDocument();
    fireEvent.click(within(failed).getByText(en['errors.back']));
    expect(await screen.findByTestId('studio-export')).toBeInTheDocument();
  });

  it('shows the network message when requests cannot reach Confluence', async () => {
    setup({
      wrap: (client) => ({
        ...client,
        async getPages(ids, options) {
          if (options.withBody) throw new ConfluenceError(0, '/wiki/api/v2/pages');
          return client.getPages(ids, options);
        },
      }),
    });
    await startExport();
    expect(await screen.findByText(en['errors.network'])).toBeInTheDocument();
  });

  it('summarises an update: changed, unchanged, deleted in warning tone, missing pages and how to apply it', async () => {
    const { fake, save } = setup();
    const file = await previousManifestFile(fake);
    fake.update('2', { version: 2 });
    fireEvent.drop(await screen.findByTestId('drop-zone'), { dataTransfer: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId('mode-update')).toHaveAttribute('aria-checked', 'true'));
    await startExport();
    const result = await screen.findByTestId('result-view');
    expect(save.mock.calls[0][0]).toMatch(/-update\.zip$/);
    expect(within(result).getByTestId('stat-changed')).toHaveTextContent('1');
    expect(within(result).getByTestId('stat-unchanged')).toHaveTextContent('2');
    const deleted = within(result).getByTestId('stat-deleted');
    expect(deleted).toHaveTextContent('1');
    expect(deleted).toHaveAttribute('data-tone', 'warning');
    expect(within(result).getByText(/1 page from the previous export was not found/)).toBeInTheDocument();
    expect(within(result).queryByText('Gone')).toBeNull();
    fireEvent.click(within(result).getByTestId('apply-toggle'));
    expect(within(result).getByTestId('apply-command')).toHaveTextContent(`unzip -o ${save.mock.calls[0][0]} -d docs`);
  });

  it('lists warnings sorted by page, filters them by kind and opens the page in Confluence', async () => {
    setup();
    await startExport();
    const result = await screen.findByTestId('result-view');
    const table = within(result).getByTestId('warnings-table--table');
    const pageCells = () => within(table).queryAllByTestId('warning-page').map((cell) => cell.textContent);
    expect(pageCells()).toEqual(['Engineering', 'Getting started']);
    expect(within(table).getByText(en['warnings.kind.unknown-macro'])).toBeInTheDocument();
    expect(within(table).getByText(en['warnings.kind.dynamic-macro'])).toBeInTheDocument();

    const filter = within(result).getByLabelText(en['warnings.filter.label']);
    fireEvent.keyDown(filter, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByText(`${en['warnings.kind.dynamic-macro']} (1)`));
    await waitFor(() => expect(pageCells()).toEqual(['Getting started']));

    fireEvent.click(within(table).getByText('Getting started'));
    expect(routerOpen).toHaveBeenCalledWith(`${SITE}/wiki/spaces/ENG/pages/2`);
  });

  it('shows a no-warnings line and starts a new export from the form', async () => {
    setup({ pages: PAGES.map((p) => ({ ...p, body: '<p>Plain</p>' })) });
    await startExport();
    const result = await screen.findByTestId('result-view');
    expect(within(result).getByText(en['warnings.none'])).toBeInTheDocument();
    fireEvent.click(within(result).getByText(en['result.newExport']));
    expect(await screen.findByTestId('studio-export')).toBeInTheDocument();
    expect(screen.getByTestId('mode-full')).toHaveAttribute('aria-checked', 'true');
  });

  it('renders the running and result views in Russian', async () => {
    const ru = localeDictionaries['ru-RU'];
    setup({ locale: 'ru-RU' });
    await startExport();
    const result = await screen.findByTestId('result-view');
    expect(within(result).getByText(ru['result.title'])).toBeInTheDocument();
    expect(within(result).getByText(ru['result.newExport'])).toBeInTheDocument();
  });
});
