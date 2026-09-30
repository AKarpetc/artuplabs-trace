import { previewParams } from './driver.js';
import { ActionApp } from '../src/app/ActionApp.jsx';

const NAVIGATOR = { type: 'jira:issueNavigatorAction', jql: 'project = RPT ORDER BY key ASC', project: { key: 'RPT' } };

/** The real action modal (`?screen=action&state=…`): a navigator search entry, or a context without an entry for `none`. */
export function ActionScreen({ context }) {
  const { state } = previewParams();
  const extension = state === 'none' ? { type: 'jira:issueNavigatorAction' } : NAVIGATOR;
  return <ActionApp context={{ siteUrl: 'https://preview.atlassian.net', ...context, extension }} />;
}
