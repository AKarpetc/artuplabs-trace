import { makeDocx, para } from '../test/fixtures/makeDocx.js';

/** Preview query parameters: `screen`, `state`, `locale` (default en-US), `theme` (light|dark), `width` in px (0 = full). */
export function previewParams() {
  const search = new URLSearchParams(globalThis.location?.search ?? '');
  const width = Number(search.get('width'));
  return {
    screen: search.get('screen') || 'gallery',
    state: search.get('state') || 'default',
    locale: search.get('locale') || 'en-US',
    theme: search.get('theme') === 'dark' ? 'dark' : 'light',
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : 0,
  };
}

/** Constrains `element` to the requested viewport width so narrow layouts can be checked in a wide window. */
export function applyWidth(element, width) {
  if (!width) return;
  element.style.width = `${width}px`;
  element.style.maxWidth = '100%';
}

const wait = (ms) => new Promise((done) => {
  setTimeout(done, ms);
});

async function until(check, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = check();
    if (value) return value;
    await wait(50);
  }
  throw new Error('preview driver: timed out');
}

const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);
const RUN_STATES = ['running', 'incomplete', 'done', 'failed'];

/** Drives the wizard for `?state=`: `form` picks Word; the run states press Export (Word first for `failed`). */
export async function driveWizard(state) {
  if (state === 'form' || state === 'failed') (await until(() => byTestId('format-docx'))).click();
  if (!RUN_STATES.includes(state)) return;
  const button = await until(() => {
    const found = byTestId('wizard-export');
    return found && !found.disabled ? found : null;
  });
  button.click();
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const DOCX_BODIES = {
  'docx-errors': `${para('{{summry}}')}${para('{{field "Story Point"}}')}${para('{{@summary}}')}`,
  'docx-ok': `${para('{{jql}}')}${para('{{#issues}}{{key}} {{summary}}')}${para('{{@description}}')}${para('{{/issues}}')}`,
};

async function chooseDocx(state) {
  const input = await until(() => byTestId('template-file'));
  const file = new File([makeDocx({ body: DOCX_BODIES[state] })], 'sprint-report.docx', { type: DOCX_MIME });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Drives the templates tab for `?state=`: the form states press Create template (Word for the docx ones and choose a file), `deleting` presses the first Delete. */
export async function driveTemplates(state) {
  if (state === 'deleting') {
    (await until(() => document.querySelector('[data-testid^="template-delete-"]'))).click();
    return;
  }
  if (!['excel-form', 'docx-errors', 'docx-ok'].includes(state)) return;
  (await until(() => byTestId('templates-create'))).click();
  if (state !== 'excel-form') (await until(() => byTestId('kind-docx'))).click();
  (await until(() => byTestId('kinds-continue'))).click();
  if (state !== 'excel-form') await chooseDocx(state);
}

/** Drivers of the screens that need clicks after loading, by screen name. */
export const SCREEN_DRIVERS = { wizard: driveWizard, templates: driveTemplates };
