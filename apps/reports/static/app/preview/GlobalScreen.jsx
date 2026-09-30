import { GlobalApp } from '../src/app/GlobalApp.jsx';

/** The real global page (`?screen=global&state=…`): tabs, wizard and templates behind the licence gate. */
export function GlobalScreen({ context }) {
  return <GlobalApp context={{ siteUrl: 'https://preview.atlassian.net', ...context }} />;
}
