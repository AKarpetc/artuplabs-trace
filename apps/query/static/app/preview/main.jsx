import { createRoot } from 'react-dom/client';
import '@atlaskit/css-reset';
import { bootstrap } from '../src/theme';
import { I18nProvider, resolveLocale } from '../src/i18n/index.js';
import { AdminApp } from '../src/app/AdminApp.jsx';
import { GlobalApp } from '../src/app/GlobalApp.jsx';
import { applyWidth, previewParams, SCREEN_DRIVERS } from './driver.js';

const SCREENS = { global: GlobalApp, admin: AdminApp };

/** Boots the preview like the real entries: `?screen=global|admin&state=<state>&locale=<code>&theme=<light|dark>&width=<px>`. */
async function main() {
  const { screen, state, width } = previewParams();
  const Screen = SCREENS[screen] ?? GlobalApp;
  const { context } = await bootstrap();
  const root = document.getElementById('root');
  applyWidth(root, width);
  createRoot(root).render(
    <I18nProvider locale={resolveLocale(context.locale)}>
      <Screen />
    </I18nProvider>,
  );
  await SCREEN_DRIVERS[screen]?.(state);
}

main();
