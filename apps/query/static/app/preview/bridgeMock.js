import { setGlobalTheme } from '@atlaskit/tokens/set-global-theme';
import { previewParams } from './driver.js';
import { adminStatusFor, PROJECTS, statusFor } from './fixtures.js';

/**
 * Local stand-in for @forge/bridge used by `vite --mode preview`; reads the preview query parameters.
 * `state=unlicensed` answers getAccess with an unlicensed site; `admin-forbidden` refuses adminStatus,
 * `admin-busy` refuses reindexProject with `busy`.
 */

const wait = (ms) => new Promise((done) => {
  setTimeout(done, ms);
});
const latency = () => wait(30 + Math.floor(Math.random() * 51));

/** Forge `view` API: context from the query string and token theming. */
export const view = {
  async getContext() {
    const { locale, theme, state, screen } = previewParams();
    return {
      locale: locale.replace('-', '_'),
      siteUrl: 'https://preview.atlassian.net',
      accountId: 'u-ann',
      environmentType: 'DEVELOPMENT',
      license: { active: state !== 'unlicensed' },
      moduleKey: screen === 'admin' ? 'query-admin-page' : 'query-global-page',
      theme: { colorMode: theme },
      extension: { type: screen === 'admin' ? 'jira:adminPage' : 'jira:globalPage' },
    };
  },
  theme: {
    async enable() {
      await setGlobalTheme({ colorMode: previewParams().theme });
    },
  },
};

const RESOLVERS = {
  getAccess: (state) => ({ licensed: state !== 'unlicensed', environmentType: 'DEVELOPMENT' }),
  getStatus: (state) => statusFor(state),
  adminStatus: (state) => {
    if (state === 'admin-forbidden') throw new Error('There was an error invoking the function - forbidden');
    return adminStatusFor(state);
  },
  setExcluded: (state, payload) => ({ excluded: payload?.projectKeys ?? [] }),
  reindexProject: (state) => {
    if (state === 'admin-busy') throw new Error('There was an error invoking the function - busy');
    return { started: ['sprint', 'comments'] };
  },
  resetIndex: () => ({ started: ['sprint', 'comments'] }),
};

/** Forge `invoke`: answers the resolvers from the fixtures; unknown keys reject like a missing resolver. */
export async function invoke(key, payload) {
  await latency();
  const resolver = RESOLVERS[key];
  if (!resolver) throw new Error(`preview: no resolver ${key}`);
  return resolver(previewParams().state, payload);
}

/** Forge `requestJira`: the project search of the fixture site in one page. */
export async function requestJira(path) {
  await latency();
  if (path.startsWith('/rest/api/3/project/search')) {
    return new Response(JSON.stringify({ values: PROJECTS, isLast: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ errorMessages: [`preview: ${path}`] }), { status: 404, headers: { 'content-type': 'application/json' } });
}
