import { createRoot } from 'react-dom/client';
import '@atlaskit/css-reset';
import { bootstrap } from '../theme';
import { I18nProvider, resolveLocale } from '../i18n/index.js';
import { ActionApp } from './ActionApp.jsx';

/** Boots the action: theme, locale, then the app. */
async function main() {
  const { context } = await bootstrap();
  createRoot(document.getElementById('root')).render(
    <I18nProvider locale={resolveLocale(context.locale)}>
      <ActionApp context={context} />
    </I18nProvider>,
  );
}

main();
