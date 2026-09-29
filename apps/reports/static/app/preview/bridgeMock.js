import { setGlobalTheme } from '@atlaskit/tokens/set-global-theme';
import { previewParams } from './driver.js';
import { ME, resolve, routeJira } from './fixtures.js';

/**
 * Local stand-in for @forge/bridge used by `vite --mode preview`; reads the preview query parameters.
 * `state=unlicensed` answers getAccess with an unlicensed site, `state=error` rejects it and `state=loading` never answers it.
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
  return resolve(key, payload);
}

/** Forge `requestJira`: routes the REST path to the fixture site with 30–80 ms latency. */
export async function requestJira(path, init) {
  await latency();
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
