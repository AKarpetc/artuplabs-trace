import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { invoke, requestJira } from '@forge/bridge';
import { I18nProvider } from '../../src/i18n/index.js';
import { TemplatesTab } from '../../src/templates/TemplatesTab.jsx';
import { forgetCatalog } from '../../src/wizard/useCatalog.js';
import { useExportRun } from '../../src/wizard/useExportRun.js';
import { formatsFor, labelsFor } from '../../src/wizard/labels.js';
import * as bridge from '../../preview/bridgeMock.js';
import { makeDocx, para } from '../fixtures/makeDocx.js';

vi.mock('@forge/bridge', async () => {
  const mock = await import('../../preview/bridgeMock.js');
  return { ...mock, requestJira: vi.fn(mock.requestJira), invoke: vi.fn(mock.invoke) };
});

const WAIT = { timeout: 10000 };
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const BODY = [
  para('{{#issues}}'),
  para('{{key}} {{reporter}} {{field "Team"}}'),
  para('{{@description}}'),
  para('{{#comments}}'),
  para('{{@body}}'),
  para('{{/comments}}'),
  para('{{/issues}}'),
].join('');

async function uploadTemplate(name) {
  render(
    <I18nProvider locale="en-US">
      <TemplatesTab save={vi.fn()} />
    </I18nProvider>,
  );
  fireEvent.click(await screen.findByTestId('templates-create', {}, WAIT));
  fireEvent.click(screen.getByTestId('kind-docx'));
  fireEvent.click(screen.getByTestId('kinds-continue'));
  await screen.findByTestId('docx-upload-form');
  const file = new File([makeDocx({ body: BODY })], `${name}.docx`, { type: DOCX });
  fireEvent.change(screen.getByTestId('template-file'), { target: { files: [file] } });
  await screen.findByTestId('template-valid', {}, WAIT);
  fireEvent.click(screen.getByTestId('template-save'));
  await screen.findByText(name, {}, WAIT);
  const { user } = await invoke('listTemplates', { projectKeys: [] });
  return user.find((template) => template.name === name);
}

const bulkFetchBodies = () => vi.mocked(requestJira).mock.calls
  .filter(([path]) => path.startsWith('/rest/api/3/issue/bulkfetch'))
  .map(([, init]) => JSON.parse(init.body));

beforeEach(() => {
  bridge.resetPreviewRuns();
  forgetCatalog();
  window.history.replaceState(null, '', '/?screen=templates&state=list');
  vi.mocked(invoke).mockReset().mockImplementation(bridge.invoke);
  vi.mocked(requestJira).mockReset().mockImplementation(bridge.requestJira);
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('custom Word template from upload to export', () => {
  it('reads what the stored file uses: description, reporter, comments, images and custom fields', async () => {
    const stored = await uploadTemplate('Customer digest');
    expect(stored.placeholders.every((tag) => typeof tag === 'string')).toBe(true);
    cleanup();
    vi.mocked(requestJira).mockClear();

    const docxTemplate = vi.fn(async () => new Uint8Array([6]));
    const renderers = { docxTemplate };
    const { result } = renderHook(() => useExportRun({ renderers, save: vi.fn(), clock: () => 0 }));
    await act(() => result.current.start({
      entry: { kind: 'jql', jql: 'project = RPT ORDER BY key ASC' },
      template: stored,
      siteUrl: 'https://preview.atlassian.net',
      labels: labelsFor((key) => key),
      formats: formatsFor('en-US'),
    }));
    await waitFor(() => expect(result.current.state).toBe('done'), WAIT);

    const [body] = bulkFetchBodies();
    expect(body.fields).toEqual(expect.arrayContaining(['description', 'reporter', 'comment', 'attachment', 'customfield_10030']));
    expect(body.expand).toEqual(['renderedFields']);
    const [{ issues, template }] = docxTemplate.mock.calls[0];
    expect(template).toBeInstanceOf(Uint8Array);
    expect(issues[0].reporter).not.toBe('');
    expect(Object.keys(issues[0].fields)).toEqual(['Team']);
    expect(issues[0].fields.Team).not.toBe('');
  });
});
