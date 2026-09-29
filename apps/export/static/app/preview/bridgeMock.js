import { setGlobalTheme } from '@atlaskit/tokens/set-global-theme';
import { PAGES, routeConfluence, SPACE } from './fixtures.js';

/**
 * Local stand-in for @forge/bridge used by `vite --mode preview`. Query parameters:
 * `locale` (Confluence locale), `theme` (light|dark), `fixture` (showcase), `state` (unlicensed | form-update | running | done | done-update | failed), `target` (page id), `entry`.
 * The action entry opens on `target`, or on the "Runbooks" page (ten subpages) when none is given.
 * `running` holds the export on page labels after RUNNING_LABELS answers; `failed` answers 403 to page body requests.
 */
function params() {
  const search = new URLSearchParams(globalThis.location?.search ?? '');
  return {
    locale: search.get('locale') || 'en-US',
    theme: search.get('theme') === 'dark' ? 'dark' : 'light',
    state: search.get('state') || 'ready',
    target: search.get('target') || '',
    entry: search.get('entry') || 'studio',
  };
}

const ACTION_PAGE = PAGES.find((page) => page.title === 'Runbooks').id;

const wait = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});
const latency = () => wait(30 + Math.floor(Math.random() * 51));

/** Forge `view` API: context from the query string and token theming. */
export const view = {
  async getContext() {
    const { locale, theme, state, target, entry } = params();
    const isAction = entry === 'action';
    return {
      locale: locale.replace('-', '_'),
      siteUrl: 'https://preview.atlassian.net',
      environmentType: 'DEVELOPMENT',
      license: { active: state !== 'unlicensed' },
      moduleKey: isAction ? 'export-content-action' : 'export-space-page',
      theme: { colorMode: theme },
      extension: {
        type: isAction ? 'confluence:contentAction' : 'confluence:spacePage',
        space: { key: SPACE.key, id: SPACE.id },
        ...(target || isAction ? { content: { id: target || ACTION_PAGE, type: 'page' } } : {}),
      },
    };
  },
  theme: {
    async enable() {
      await setGlobalTheme({ colorMode: params().theme });
    },
  },
  async close() {
    return undefined;
  },
  async refresh() {
    return undefined;
  },
};

/** Forge `invoke`: answers the resolvers the UI calls; unknown keys reject like a missing resolver. */
export async function invoke(key) {
  await latency();
  const { state } = params();
  if (key === 'getAccess') return { licensed: state !== 'unlicensed' };
  throw new Error(`preview: no resolver for ${key}`);
}

const RUNNING_LABELS = 22;
let labelRequests = 0;
const forever = () => new Promise(() => {});

/** Forge `requestConfluence`: routes the REST path to the fixture space with 30–80 ms latency; `state` may stall or fail the export. */
export async function requestConfluence(path) {
  await latency();
  const { state } = params();
  if (state === 'failed' && path.includes('body-format=storage')) {
    return new Response(JSON.stringify({ statusCode: 403, message: 'preview: forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } });
  }
  if (state === 'running' && /\/labels/.test(path)) {
    labelRequests += 1;
    if (labelRequests > RUNNING_LABELS) await forever();
  }
  return routeConfluence(path);
}

/** Forge `router`: logs navigation instead of leaving the preview. */
export const router = {
  async navigate(location) {
    console.info('preview router.navigate', location);
  },
  async open(location) {
    console.info('preview router.open', location);
  },
};

/** Forge `showFlag`: logs the flag and returns a closable handle. */
export function showFlag(options) {
  console.info('preview showFlag', options);
  return { close: async () => true };
}
