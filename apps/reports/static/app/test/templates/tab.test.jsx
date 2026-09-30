import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PizZip from 'pizzip';
import { invoke, requestJira } from '@forge/bridge';
import { TEMPLATE_MAX_UNCOMPRESSED_BYTES, TEMPLATE_PART_BYTES } from '../../src/core/limits.js';
import { I18nProvider } from '../../src/i18n/index.js';
import { TemplatesTab } from '../../src/templates/TemplatesTab.jsx';
import { forgetCatalog } from '../../src/wizard/useCatalog.js';
import * as bridge from '../../preview/bridgeMock.js';
import { PROJECTS, TEMPLATES_SEED } from '../../preview/fixtures.js';
import { makeDocx, para } from '../fixtures/makeDocx.js';

vi.mock('@forge/bridge', async () => {
  const mock = await import('../../preview/bridgeMock.js');
  return { ...mock, requestJira: vi.fn(mock.requestJira), invoke: vi.fn(mock.invoke) };
});

const WAIT = { timeout: 5000 };
const NO_WAIT = [0, 0, 0];
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function renderTab({ locale = 'en-US', ...props } = {}) {
  const save = vi.fn();
  render(
    <I18nProvider locale={locale}>
      <TemplatesTab save={save} {...props} />
    </I18nProvider>,
  );
  return { save };
}

const useState = (state) => window.history.replaceState(null, '', `/?screen=templates&state=${state}`);
const calls = (key) => vi.mocked(invoke).mock.calls.filter(([name]) => name === key).map(([, payload]) => payload);
const fileOf = (bytes, name = 'report.docx') => new File([bytes], name, { type: DOCX });
const chooseFile = (file) => fireEvent.change(screen.getByTestId('template-file'), { target: { files: [file] } });
const docx = (body) => makeDocx({ body });

async function openDocxForm() {
  fireEvent.click(await screen.findByTestId('templates-create', {}, WAIT));
  fireEvent.click(screen.getByTestId('kind-docx'));
  fireEvent.click(screen.getByTestId('kinds-continue'));
  await screen.findByTestId('docx-upload-form');
}

async function openExcelForm() {
  fireEvent.click(await screen.findByTestId('templates-create', {}, WAIT));
  fireEvent.click(screen.getByTestId('kinds-continue'));
  await screen.findByTestId('excel-template-form');
}

const scopeValues = () => [...document.querySelectorAll('input[name="template-scope"]')].map((radio) => radio.value);
const saveButton = () => screen.getByTestId('template-save');

beforeEach(() => {
  bridge.resetPreviewRuns();
  forgetCatalog();
  useState('list');
  vi.mocked(invoke).mockReset().mockImplementation(bridge.invoke);
  vi.mocked(requestJira).mockReset().mockImplementation(bridge.requestJira);
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('templates list', () => {
  it('shows a table per group with name, format, scope and author', async () => {
    renderTab();
    const mine = await screen.findByTestId('templates-group-user', {}, WAIT);
    expect(within(mine).getByText('My sprint columns')).toBeInTheDocument();
    expect(within(mine).getByText('Customer status report')).toBeInTheDocument();
    expect(within(mine).getAllByText('Personal')).toHaveLength(2);
    expect(within(mine).getAllByText('Excel')[0]).toBeInTheDocument();
    expect(within(mine).getByText('Word')).toBeInTheDocument();
    const project = screen.getByTestId('templates-group-project');
    expect(within(project).getByText('RPT')).toBeInTheDocument();
    expect(within(screen.getByTestId('templates-group-site')).getByText('Company issue list')).toBeInTheDocument();
    await waitFor(() => expect(within(project).getByText('Борис Петров')).toBeInTheDocument(), WAIT);
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['My templates', 'Project templates', 'Site templates']);
  });

  it('lists templates of the projects the user administers, in calls of at most 20 keys', async () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ key: `PR${i}`, name: `Project ${i}` }));
    vi.mocked(requestJira).mockImplementation(async (path) => (path.startsWith('/rest/api/3/project/search')
      ? new Response(JSON.stringify({ values: many, isLast: true }), { status: 200 })
      : bridge.requestJira(path)));
    renderTab();
    await screen.findByTestId('templates-group-user', {}, WAIT);
    expect(calls('listTemplates').map((payload) => payload.projectKeys.length)).toEqual([20, 20, 5]);
    expect(calls('getScopes').map((payload) => payload.projectKeys.length)).toEqual([20, 20, 5]);
  });

  it('reads the project list with the documented request', async () => {
    renderTab();
    await screen.findByTestId('templates-group-user', {}, WAIT);
    expect(vi.mocked(requestJira).mock.calls.map(([path]) => path)).toContain('/rest/api/3/project/search?action=edit&maxResults=50');
    expect(calls('listTemplates')).toEqual([{ projectKeys: PROJECTS.map((project) => project.key) }]);
  });

  it('offers Edit and Delete on every row of an administrator', async () => {
    renderTab();
    await screen.findByTestId('templates-group-user', {}, WAIT);
    expect(screen.getAllByRole('button', { name: /^(Edit|Delete) / })).toHaveLength(8);
  });

  it('offers no Edit or Delete on project and site rows the user cannot manage', async () => {
    vi.mocked(invoke).mockImplementation(async (key, payload) => (key === 'getScopes' ? { site: false, projects: [] } : bridge.invoke(key, payload)));
    renderTab();
    await screen.findByTestId('templates-group-user', {}, WAIT);
    expect(within(screen.getByTestId('templates-group-project')).queryByRole('button')).toBeNull();
    expect(within(screen.getByTestId('templates-group-site')).queryByRole('button')).toBeNull();
    expect(within(screen.getByTestId('templates-group-user')).getAllByRole('button')).toHaveLength(4);
  });

  it('shows an empty state with one action when there are no templates', async () => {
    useState('empty');
    renderTab();
    const empty = await screen.findByTestId('templates-empty', {}, WAIT);
    expect(within(empty).getByText('No templates yet. Create one to reuse it in every export.')).toBeInTheDocument();
    expect(screen.queryByTestId('templates-create')).toBeNull();
    fireEvent.click(within(empty).getByRole('button', { name: 'Create template' }));
    expect(await screen.findByTestId('template-kinds')).toBeInTheDocument();
  });

  it('shows the translated text for a forbidden resolver answer with a retry', async () => {
    vi.mocked(invoke).mockImplementation(async (key, payload) => {
      if (key === 'listTemplates') throw new Error('forbidden');
      return bridge.invoke(key, payload);
    });
    renderTab();
    expect(await screen.findByText("You don't have permission to do that.", {}, WAIT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows the translated text for an unexpected resolver error once the repeats are used up', async () => {
    vi.mocked(invoke).mockImplementation(async (key, payload) => {
      if (key === 'listTemplates') throw new Error('internal');
      return bridge.invoke(key, payload);
    });
    renderTab({ retryDelays: NO_WAIT });
    expect(await screen.findByText('Something went wrong on our side. Try again in a moment.', {}, WAIT)).toBeInTheDocument();
    expect(calls('listTemplates')).toHaveLength(NO_WAIT.length + 1);
  });

  it('repeats a throttled read and keeps the templates and their actions', async () => {
    let failures = 2;
    vi.mocked(invoke).mockImplementation(async (key, payload) => {
      if ((key === 'getScopes' || key === 'listTemplates') && failures > 0) {
        failures -= 1;
        throw new Error('internal');
      }
      return bridge.invoke(key, payload);
    });
    renderTab({ retryDelays: NO_WAIT });
    const project = await screen.findByTestId('templates-group-project', {}, WAIT);
    const { id } = TEMPLATES_SEED.project[0];
    expect([within(project).getByTestId(`template-edit-${id}`), within(project).getByTestId(`template-delete-${id}`)]).toHaveLength(2);
  });

  it('keeps at most three template reads in flight across many projects', async () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ key: `P${i}`, name: `Project ${i}` }));
    const request = vi.fn(async (path) => {
      if (path.startsWith('/rest/api/3/project/search')) {
        const start = Number(new URL(path, 'https://x').searchParams.get('startAt') ?? 0);
        const values = many.slice(start, start + 50);
        return new Response(JSON.stringify({ values, isLast: start + 50 >= many.length }), { status: 200 });
      }
      return bridge.requestJira(path);
    });
    let inFlight = 0;
    let peak = 0;
    const callResolver = async (key, payload) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        await new Promise((resolve) => { setTimeout(resolve, 5); });
        return await bridge.invoke(key, payload);
      } finally {
        inFlight -= 1;
      }
    };
    renderTab({ request, callResolver });
    await screen.findByTestId('templates-group-user', {}, WAIT);
    expect(peak).toBe(3);
  });

  it('reads the list again after Try again', async () => {
    let failing = true;
    vi.mocked(invoke).mockImplementation(async (key, payload) => {
      if (key === 'listTemplates' && failing) throw new Error('forbidden');
      return bridge.invoke(key, payload);
    });
    renderTab();
    await screen.findByText("You don't have permission to do that.", {}, WAIT);
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('templates-group-user', {}, WAIT)).toBeInTheDocument();
  });
});

describe('scope picker', () => {
  it('offers only a personal template to a user who administers nothing', async () => {
    vi.mocked(invoke).mockImplementation(async (key, payload) => (key === 'getScopes' ? { site: false, projects: [] } : bridge.invoke(key, payload)));
    renderTab();
    await openExcelForm();
    expect(scopeValues()).toEqual(['user']);
    expect(screen.queryByText('Everyone on this site')).toBeNull();
    expect(screen.queryByText('Everyone in a project')).toBeNull();
  });

  it('offers a project and the site to an administrator, with the projects the user manages', async () => {
    vi.mocked(invoke).mockImplementation(async (key, payload) => (key === 'getScopes' ? { site: true, projects: ['OPS'] } : bridge.invoke(key, payload)));
    renderTab();
    await openExcelForm();
    expect(scopeValues()).toEqual(['user', 'project', 'site']);
    fireEvent.click(screen.getByRole('radio', { name: 'Everyone in a project' }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Project' }), { key: 'ArrowDown' });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['OPS · Operations']);
  });

  it('offers a project but not the site to a project administrator', async () => {
    vi.mocked(invoke).mockImplementation(async (key, payload) => (key === 'getScopes' ? { site: false, projects: ['RPT'] } : bridge.invoke(key, payload)));
    renderTab();
    await openExcelForm();
    expect(scopeValues()).toEqual(['user', 'project']);
  });
});

describe('Excel template form', () => {
  it('shows a live example of the file name', async () => {
    renderTab();
    await openExcelForm();
    const pattern = screen.getByTestId('template-file-pattern');
    fireEvent.change(pattern, { target: { value: '{project}-{filter}' } });
    expect(screen.getByTestId('template-file-example')).toHaveTextContent('Example: RPT-Open-issues.xlsx');
  });

  it('keeps Save disabled until the template has a name', async () => {
    renderTab();
    await openExcelForm();
    expect(saveButton()).toBeDisabled();
    fireEvent.change(screen.getByTestId('template-name'), { target: { value: 'Weekly' } });
    expect(saveButton()).toBeEnabled();
  });

  it('saves a personal column template and shows it in the list', async () => {
    renderTab();
    await openExcelForm();
    fireEvent.change(screen.getByTestId('template-name'), { target: { value: 'Weekly review' } });
    fireEvent.click(saveButton());
    expect(await screen.findByText('Weekly review', {}, WAIT)).toBeInTheDocument();
    const [{ template }] = calls('saveTemplate');
    expect(template).toEqual({
      scope: 'user', scopeId: '', name: 'Weekly review', format: 'xlsx', kind: 'columns',
      columns: expect.any(Array), rowMode: 'issue', groupBy: null, summary: expect.any(Boolean), fileNamePattern: '{project}-{date}-{filter}',
    });
    expect(template.columns.length).toBeGreaterThan(0);
  });

  it('shows a save error under the form and keeps the form open', async () => {
    vi.mocked(invoke).mockImplementation(async (key, payload) => {
      if (key === 'saveTemplate') throw new Error('forbidden');
      return bridge.invoke(key, payload);
    });
    renderTab();
    await openExcelForm();
    fireEvent.change(screen.getByTestId('template-name'), { target: { value: 'Weekly review' } });
    fireEvent.click(saveButton());
    expect(await screen.findByTestId('template-save-error', {}, WAIT)).toHaveTextContent("You don't have permission to do that.");
    expect(saveButton()).toBeEnabled();
  });

  it('edits a saved template in place and locks its scope', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Company issue list' }, WAIT));
    await screen.findByTestId('excel-template-form');
    expect(screen.getByTestId('template-name')).toHaveValue('Company issue list');
    expect(screen.getByRole('radio', { name: 'Everyone on this site' })).toBeDisabled();
    fireEvent.change(screen.getByTestId('template-name'), { target: { value: 'Company list v2' } });
    fireEvent.click(saveButton());
    expect(await screen.findByText('Company list v2', {}, WAIT)).toBeInTheDocument();
    expect(calls('saveTemplate')[0].template).toMatchObject({ id: TEMPLATES_SEED.site[0].id, scope: 'site', name: 'Company list v2', kind: 'columns' });
  });

  it('returns to the list without saving on Cancel', async () => {
    renderTab();
    await openExcelForm();
    fireEvent.click(screen.getByTestId('template-cancel'));
    expect(await screen.findByTestId('templates-group-user')).toBeInTheDocument();
    expect(calls('saveTemplate')).toEqual([]);
  });
});

describe('Word template upload', () => {
  it('shows the suggestion for a misspelt tag and blocks Save', async () => {
    renderTab();
    await openDocxForm();
    chooseFile(fileOf(docx(para('{{summry}}'))));
    const error = await screen.findByTestId('template-error-0', {}, WAIT);
    expect(error).toHaveTextContent('Unknown tag {{summry}}.');
    expect(error).toHaveTextContent('Did you mean {{summary}}?');
    expect(saveButton()).toBeDisabled();
  });

  it('names the file after the upload when the name is empty', async () => {
    renderTab();
    await openDocxForm();
    chooseFile(fileOf(docx(para('{{summary}}')), 'Sprint report.docx'));
    await screen.findByTestId('template-valid', {}, WAIT);
    expect(screen.getByTestId('template-name')).toHaveValue('Sprint report');
  });

  it('checks tags against the field names of the site', async () => {
    renderTab();
    await openDocxForm();
    chooseFile(fileOf(docx(para('{{field "Story Point"}}'))));
    const error = await screen.findByTestId('template-error-0', {}, WAIT);
    expect(error).toHaveTextContent('This site has no field for {{field "Story Point"}}.');
    expect(error).toHaveTextContent('Did you mean {{field "Story Points"}}?');
  });

  it('reports a file that is not a Word document', async () => {
    renderTab();
    await openDocxForm();
    chooseFile(fileOf(new Uint8Array([1, 2, 3, 4]), 'notes.docx'));
    expect(await screen.findByTestId('template-error-0', {}, WAIT)).toHaveTextContent('This file is not a valid Word (.docx) document.');
  });

  it('refuses a file that unpacks to more than 20 MB', async () => {
    const zip = new PizZip();
    zip.file('word/document.xml', '<w:document/>');
    zip.file('padding.bin', new Uint8Array(TEMPLATE_MAX_UNCOMPRESSED_BYTES + 1));
    renderTab();
    await openDocxForm();
    chooseFile(fileOf(zip.generate({ type: 'uint8array', compression: 'DEFLATE' })));
    expect(await screen.findByTestId('template-error-0', {}, WAIT)).toHaveTextContent('This file unpacks to more than 20 MB and cannot be used.');
    expect(saveButton()).toBeDisabled();
  });

  it('accepts a file that is dropped on the zone', async () => {
    renderTab();
    await openDocxForm();
    const zone = screen.getByTestId('template-dropzone');
    fireEvent.dragOver(zone);
    expect(zone).toHaveAttribute('data-over', 'true');
    fireEvent.drop(zone, { dataTransfer: { files: [fileOf(docx(para('{{summary}}')), 'dropped.docx')] } });
    expect(await screen.findByTestId('template-valid', {}, WAIT)).toBeInTheDocument();
    expect(zone).not.toHaveAttribute('data-over');
  });

  it('lists the tags a template can use, from the vocabulary of the core', async () => {
    renderTab();
    await openDocxForm();
    expect(screen.queryByTestId('tags-content')).toBeNull();
    fireEvent.click(screen.getByTestId('tags-toggle'));
    const content = screen.getByTestId('tags-content');
    for (const tag of ['{{jql}}', '{{summary}}', '{{fixVersions}}', '{{author}}', '{{hours}}', '{{direction}}']) {
      expect(within(content).getAllByText(tag).length).toBeGreaterThan(0);
    }
  });

  it('saves the metadata with the tags found, then sends parts 0 to n-1 with the total', async () => {
    const big = docx(`${para('{{#issues}}{{key}} {{summary}}{{/issues}}')}${para('x'.repeat(400000))}`);
    renderTab();
    await openDocxForm();
    chooseFile(fileOf(big, 'Big report.docx'));
    await screen.findByTestId('template-valid', {}, WAIT);
    fireEvent.click(saveButton());
    expect(await screen.findByText('Big report', {}, WAIT)).toBeInTheDocument();
    const [{ template }] = calls('saveTemplate');
    expect(template).toEqual({ scope: 'user', scopeId: '', name: 'Big report', format: 'docx', kind: 'docx', placeholders: ['issues', 'key', 'summary'] });
    const parts = calls('uploadTemplatePart');
    const total = Math.ceil(big.length / TEMPLATE_PART_BYTES);
    expect(total).toBeGreaterThan(2);
    expect(parts.map((part) => [part.index, part.total])).toEqual(Array.from({ length: total }, (_, index) => [index, total]));
    expect(new Set(parts.map((part) => part.uploadId)).size).toBe(1);
    expect(parts.every((part) => part.id === parts[0].id)).toBe(true);
  });

  it('shows the progress while parts are sent', async () => {
    let release;
    const gate = new Promise((done) => { release = done; });
    vi.mocked(invoke).mockImplementation(async (key, payload) => {
      if (key === 'uploadTemplatePart') await gate;
      return bridge.invoke(key, payload);
    });
    renderTab();
    await openDocxForm();
    chooseFile(fileOf(docx(`${para('{{summary}}')}${para('x'.repeat(200000))}`)));
    await screen.findByTestId('template-valid', {}, WAIT);
    fireEvent.click(saveButton());
    expect(await screen.findByTestId('template-upload-progress', {}, WAIT)).toBeInTheDocument();
    release();
    await screen.findByTestId('templates-group-user', {}, WAIT);
  });

  it('retries a failed upload on the same template with a new upload id', async () => {
    let failOnce = true;
    vi.mocked(invoke).mockImplementation(async (key, payload) => {
      if (key === 'uploadTemplatePart' && failOnce) {
        failOnce = false;
        throw new Error('internal');
      }
      return bridge.invoke(key, payload);
    });
    renderTab();
    await openDocxForm();
    chooseFile(fileOf(docx(para('{{summary}}')), 'Retry me.docx'));
    await screen.findByTestId('template-valid', {}, WAIT);
    fireEvent.click(saveButton());
    const failure = await screen.findByTestId('template-save-error', {}, WAIT);
    expect(failure).toHaveTextContent('The template was saved, but its file was not uploaded. Try again.');
    expect(failure).toHaveTextContent('Something went wrong on our side. Try again in a moment.');
    fireEvent.click(saveButton());
    expect(await screen.findByText('Retry me', {}, WAIT)).toBeInTheDocument();
    const parts = calls('uploadTemplatePart');
    expect(parts).toHaveLength(2);
    expect(parts[0].uploadId).not.toBe(parts[1].uploadId);
    expect(parts[0].id).toBe(parts[1].id);
    const saves = calls('saveTemplate');
    expect(saves.map(({ template }) => template.id)).toEqual([undefined, parts[0].id]);
  });

  it('edits the name of a Word template without sending its file again', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Customer status report' }, WAIT));
    await screen.findByTestId('docx-upload-form');
    expect(screen.getByTestId('template-name')).toHaveValue('Customer status report');
    fireEvent.change(screen.getByTestId('template-name'), { target: { value: 'Client report' } });
    expect(saveButton()).toBeEnabled();
    fireEvent.click(saveButton());
    expect(await screen.findByText('Client report', {}, WAIT)).toBeInTheDocument();
    expect(calls('saveTemplate')[0].template).toMatchObject({ id: TEMPLATES_SEED.user[1].id, kind: 'docx', placeholders: ['issues', 'key', 'summary'] });
    expect(calls('uploadTemplatePart')).toEqual([]);
  });

  it('saves the bundled example template as a Word file', async () => {
    const { save } = renderTab();
    await openDocxForm();
    fireEvent.click(screen.getByTestId('template-example'));
    expect(save).toHaveBeenCalledTimes(1);
    const [fileName, blob] = save.mock.calls[0];
    expect(fileName).toBe('example-template.docx');
    expect(blob.type).toBe(DOCX);
    expect(blob.size).toBeGreaterThan(1000);
  });
});

describe('deleting', () => {
  it('asks for confirmation naming the template and deletes nothing on Cancel', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Company issue list' }, WAIT));
    const dialog = await screen.findByTestId('delete-dialog');
    expect(within(dialog).getByText('“Company issue list” will be deleted for everyone who can use it. This cannot be undone.')).toBeInTheDocument();
    expect(calls('deleteTemplate')).toEqual([]);
    fireEvent.click(within(dialog).getByTestId('delete-cancel'));
    await waitFor(() => expect(screen.queryByTestId('delete-dialog')).toBeNull(), WAIT);
    expect(calls('deleteTemplate')).toEqual([]);
  });

  it('deletes the template after the confirmation and drops it from the list', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Company issue list' }, WAIT));
    fireEvent.click(await screen.findByTestId('delete-confirm'));
    await waitFor(() => expect(screen.queryByText('Company issue list')).toBeNull(), WAIT);
    expect(calls('deleteTemplate')).toEqual([{ id: TEMPLATES_SEED.site[0].id }]);
  });

  it('shows the translated error in the dialog when the delete is refused', async () => {
    vi.mocked(invoke).mockImplementation(async (key, payload) => {
      if (key === 'deleteTemplate') throw new Error('forbidden');
      return bridge.invoke(key, payload);
    });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Company issue list' }, WAIT));
    fireEvent.click(await screen.findByTestId('delete-confirm'));
    expect(await screen.findByTestId('delete-dialog-error', {}, WAIT)).toHaveTextContent("You don't have permission to do that.");
    expect(screen.getByText('Company issue list')).toBeInTheDocument();
  });
});
