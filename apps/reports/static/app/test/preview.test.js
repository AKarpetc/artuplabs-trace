import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '../src/i18n/index.js';
import { createJiraClient } from '../src/infra/jira.js';
import { SCREEN_COMPONENTS } from '../preview/Gallery.jsx';
import { FIELDS, ISSUES, SCREENS, resetTemplateStore, resolve, routeJira, screenStates } from '../preview/fixtures.js';

vi.mock('@forge/bridge', async () => import('../preview/bridgeMock.js'));

const client = () => createJiraClient({ request: routeJira, sleep: async () => {} });

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('preview screens', () => {
  it.each(screenStates().map(({ screen: name, state }) => [name, state]))('renders %s in state %s without throwing', async (name, state) => {
    window.history.replaceState(null, '', `/?screen=${name}&state=${state}`);
    const Screen = SCREEN_COMPONENTS[name];
    expect(Screen).toBeTypeOf('function');
    const { container } = render(createElement(I18nProvider, { locale: 'en-US' }, createElement(Screen, { context: {} })));
    expect(container.firstChild).not.toBeNull();
    if (state === 'loading') expect(await screen.findByLabelText('Loading…')).toBeInTheDocument();
    if (state === 'error') expect(await screen.findByText('Something went wrong: preview: getAccess failed')).toBeInTheDocument();
    if (state === 'default') expect(await screen.findByRole('radiogroup', { name: 'Choose a format' })).toBeInTheDocument();
    if (state === 'unlicensed') expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('registers a component for every screen in the matrix', () => {
    expect(Object.keys(SCREENS).sort()).toEqual(Object.keys(SCREEN_COMPONENTS).sort());
  });
});

describe('preview fixture Jira', () => {
  it('has 30 issues with Cyrillic and CJK summaries', () => {
    const summaries = ISSUES.map((issue) => issue.fields.summary);
    expect(ISSUES).toHaveLength(30);
    expect(summaries.some((s) => /[а-яё]/i.test(s))).toBe(true);
    expect(summaries.some((s) => /[぀-ヿ一-鿿]/.test(s))).toBe(true);
  });

  it('pages ids through the search cursor and counts approximately', async () => {
    const jira = client();
    expect(await jira.searchIds('project = RPT')).toEqual(ISSUES.map((issue) => issue.id));
    expect(await jira.searchIds('project = RPT', { limit: 7 })).toEqual(ISSUES.slice(0, 7).map((issue) => issue.id));
    expect(await jira.approximateCount('project = RPT')).toBe(30);
  });

  it('narrows the search by status', async () => {
    const jira = client();
    const done = ISSUES.filter((issue) => issue.fields.status.name === 'Done').map((issue) => issue.id);
    expect(await jira.searchIds('project = RPT AND status = "Done"')).toEqual(done);
    expect(await jira.approximateCount('status = Done')).toBe(done.length);
  });

  it('bulk-fetches the requested fields and rendered fields', async () => {
    const { issues, errors } = await client().bulkFetch(['10001', 'RPT-2'], { fields: ['summary'], expand: ['renderedFields'] });
    expect(errors).toEqual([]);
    expect(issues).toEqual([
      { id: '10001', key: 'RPT-1', fields: { summary: ISSUES[0].fields.summary }, renderedFields: ISSUES[0].renderedFields },
      { id: '10002', key: 'RPT-2', fields: { summary: ISSUES[1].fields.summary }, renderedFields: ISSUES[1].renderedFields },
    ]);
  });

  it('serves fields, the current user and filters', async () => {
    const jira = client();
    expect(await jira.getFields()).toEqual(FIELDS);
    expect(await jira.getMyself()).toEqual({ accountId: 'u-ann', displayName: 'Ann Lee' });
    expect(await jira.searchFilters('open')).toEqual([{ id: '10101', name: 'Open RPT issues', jql: 'project = RPT AND statusCategory != Done' }]);
  });

  it('answers 404 for unknown paths', async () => {
    expect((await routeJira('/rest/api/3/unknown')).status).toBe(404);
  });
});

describe('preview resolvers', () => {
  it('reports a licensed site and empty template lists', () => {
    resetTemplateStore();
    expect(resolve('getAccess')).toEqual({ licensed: true });
    expect(resolve('listTemplates', { projectKeys: ['RPT'] })).toEqual({ user: [], project: [], site: [] });
    expect(resolve('getScopes', { projectKeys: ['RPT'] })).toEqual({ site: true, projects: ['RPT'] });
  });

  it('rejects an unknown resolver', () => {
    expect(() => resolve('nope')).toThrow('preview: no resolver for nope');
  });
});
