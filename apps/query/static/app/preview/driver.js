/** Preview query parameters: `screen`, `state`, `locale` (default en-US), `theme` (light|dark), `width` in px (0 = full). */
export function previewParams() {
  const search = new URLSearchParams(globalThis.location?.search ?? '');
  const width = Number(search.get('width'));
  return {
    screen: search.get('screen') || 'global',
    state: search.get('state') || 'reference',
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

function typeInto(element, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Drives the global page for `?state=`: the status states open the Status tab, `reference-empty-search` types a search that matches nothing. */
export async function driveGlobal(state) {
  if (state.startsWith('status-')) {
    (await until(() => byTestId('tab-status'))).click();
    return;
  }
  if (state === 'reference-empty-search') {
    typeInto(await until(() => byTestId('reference-search')), 'zzzz');
  }
}

/** Drives the admin page for `?state=`: `admin-busy` presses Reindex, `admin-reset-dialog` presses Rebuild. */
export async function driveAdmin(state) {
  if (state === 'admin-busy') {
    const button = await until(() => {
      const found = byTestId('reindex-action');
      return found && !found.disabled ? found : null;
    });
    button.click();
  }
  if (state === 'admin-reset-dialog') (await until(() => byTestId('reset-index'))).click();
}

/** Drivers of the screens that need clicks after loading, by screen name. */
export const SCREEN_DRIVERS = { global: driveGlobal, admin: driveAdmin };
