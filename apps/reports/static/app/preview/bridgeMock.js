import { setGlobalTheme } from '@atlaskit/tokens/set-global-theme';
import { PREVIEW_ISSUES } from '../src/core/limits.js';
import { previewParams } from './driver.js';
import { ME, TEMPLATES_SEED, WIZARD_TEMPLATES, resetTemplateStore, resolve, routeJira } from './fixtures.js';

/**
 * Local stand-in for @forge/bridge used by `vite --mode preview`; reads the preview query parameters.
 * `state=unlicensed` answers getAccess with an unlicensed site, `state=error` rejects it and `state=loading` never answers it.
 * On `screen=wizard`: listTemplates answers WIZARD_TEMPLATES; `running` holds every export bulkfetch (more ids than the
 * preview reads), `incomplete` refuses the first one (403, not retried) and `failed` counts 5 000 issues so a Word export is refused.
 * On `screen=templates`: the template resolvers work on an in-memory store, filled with TEMPLATES_SEED unless `state=empty`.
 */

const wait = (ms) => new Promise((done) => {
  setTimeout(done, ms);
});
const latency = () => wait(30 + Math.floor(Math.random() * 51));
const forever = () => new Promise(() => {});

/** Forge `view` API: context from the query string and token theming. */
export const view = {
  async getContext() {
    const { locale, theme, state } = previewParams();
    return {
      locale: locale.replace('-', '_'),
      siteUrl: 'https://preview.atlassian.net',
      accountId: ME.accountId,
      environmentType: 'DEVELOPMENT',
      license: { active: state !== 'unlicensed' },
      moduleKey: 'reports-global-page',
      theme: { colorMode: theme },
      extension: { type: 'jira:globalPage', project: { key: 'RPT', id: '10000' } },
    };
  },
  theme: {
    async enable() {
      await setGlobalTheme({ colorMode: previewParams().theme });
    },
  },
  async close() {
    return undefined;
  },
  async refresh() {
    return undefined;
  },
};

/** Forge `invoke`: answers the resolvers from the fixtures; unknown keys reject like a missing resolver. */
export async function invoke(key, payload) {
  await latency();
  const { state } = previewParams();
  if (key === 'getAccess') {
    if (state === 'loading') await forever();
    if (state === 'error') throw new Error('preview: getAccess failed');
    return { licensed: state !== 'unlicensed' };
  }
  const { mode } = previewParams();
  if (key === 'listTemplates' && mode.screen === 'wizard') return WIZARD_TEMPLATES;
  if (mode.screen === 'templates') seedTemplates(mode.state);
  return resolve(key, payload);
}

let refusedBulkFetches = 0;
let seededFor = null;

function seedTemplates(state) {
  if (seededFor === state) return;
  seededFor = state;
  resetTemplateStore(state === 'empty' ? undefined : TEMPLATES_SEED);
}

/** Forgets how many bulkfetch calls the `incomplete` state has refused and the stored templates (tests start each run fresh). */
export function resetPreviewRuns() {
  refusedBulkFetches = 0;
  seededFor = null;
}

/** Forge `requestJira`: routes the REST path to the fixture site with 30–80 ms latency; the wizard states may stall, refuse or inflate. */
export async function requestJira(path, init) {
  await latency();
  const { mode: { screen, state } } = previewParams();
  const exportBatch = path.startsWith('/rest/api/3/issue/bulkfetch') && JSON.parse(init?.body ?? '{}').issueIdsOrKeys?.length > PREVIEW_ISSUES;
  if (screen === 'wizard' && exportBatch) {
    if (state === 'running') await forever();
    if (state === 'incomplete' && refusedBulkFetches === 0) {
      refusedBulkFetches += 1;
      return new Response(JSON.stringify({ errorMessages: ['preview: forbidden'] }), { status: 403, headers: { 'content-type': 'application/json' } });
    }
  }
  if (screen === 'wizard' && state === 'failed' && path.startsWith('/rest/api/3/search/approximate-count')) {
    return new Response(JSON.stringify({ count: 5000 }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return routeJira(path, init);
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
