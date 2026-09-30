import { makeDocx, para } from '../test/fixtures/makeDocx.js';

/** Preview query parameters: `screen`, `state`, `locale` (default en-US), `theme` (light|dark), `width` in px (0 = full). */
export function previewParams() {
  const search = new URLSearchParams(globalThis.location?.search ?? '');
  const width = Number(search.get('width'));
  const screen = search.get('screen') || 'gallery';
  const state = search.get('state') || 'default';
  return {
    screen,
    state,
    mode: harnessMode(screen, state),
    locale: search.get('locale') || 'en-US',
    theme: search.get('theme') === 'dark' ? 'dark' : 'light',
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : 0,
  };
}

const GLOBAL_MODES = {
  'export-form': { screen: 'wizard', state: 'form' },
  'export-excel': { screen: 'wizard', state: 'form-excel' },
  'templates-list': { screen: 'templates', state: 'list' },
  'templates-empty': { screen: 'templates', state: 'empty' },
};

/** Screen and state whose fixtures apply: the global page and the action modal reuse the wizard and templates fixtures. */
export function harnessMode(screen, state) {
  if (screen === 'global') return GLOBAL_MODES[state] ?? (state === 'docx-errors' ? { screen: 'templates', state } : { screen: 'wizard', state });
  if (screen === 'action') return { screen: 'wizard', state };
  return { screen, state };
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

function typeInto(element, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Drives the global page for `?state=`: the templates states open the Templates tab, the export states type a JQL first. */
export async function driveGlobal(state) {
  const mode = harnessMode('global', state);
  if (mode.screen === 'templates') {
    (await until(() => byTestId('tab-templates'))).click();
    await driveTemplates(mode.state);
    return;
  }
  if (state === 'unlicensed') return;
  typeInto(await until(() => byTestId('wizard-jql')), 'project = RPT ORDER BY key ASC');
  await driveWizard(mode.state);
}

/** Drives the action modal for `?state=`: the wizard states of a search entry. */
export const driveAction = (state) => driveWizard(state);

/** Drivers of the screens that need clicks after loading, by screen name. */
export const SCREEN_DRIVERS = { wizard: driveWizard, templates: driveTemplates, global: driveGlobal, action: driveAction };
