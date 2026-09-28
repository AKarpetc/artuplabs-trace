import { createRoot } from 'react-dom/client';
import '@atlaskit/css-reset';
import { bootstrap } from '../src/theme';
import { I18nProvider, resolveLocale } from '../src/i18n/index.js';
import { StudioApp } from '../src/studio/StudioApp.jsx';
import { ActionApp } from '../src/action/ActionApp.jsx';
import { drive } from './driver.js';
import { Gallery } from './Gallery.jsx';

const ENTRIES = { studio: StudioApp, action: ActionApp, gallery: Gallery };

/** Boots the preview exactly like the real entries; `?entry=studio|action|gallery` picks the app, `?state=` may start an export. */
async function main() {
  const entry = new URLSearchParams(window.location.search).get('entry') || 'studio';
  const App = ENTRIES[entry] ?? StudioApp;
  const { context } = await bootstrap();
  createRoot(document.getElementById('root')).render(
    <I18nProvider locale={resolveLocale(context.locale)}>
      <App context={context} />
    </I18nProvider>,
  );
  if (entry === 'studio') await drive(new URLSearchParams(window.location.search).get('state') || '');
}

main();
