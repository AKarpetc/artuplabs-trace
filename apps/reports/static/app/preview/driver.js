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

/** Drivers of the screens that need clicks after loading, by screen name. */
export const SCREEN_DRIVERS = { wizard: driveWizard };
