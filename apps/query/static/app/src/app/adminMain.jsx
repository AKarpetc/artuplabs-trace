import { createRoot } from 'react-dom/client';
import '@atlaskit/css-reset';
import { bootstrap } from '../theme';
import { I18nProvider, resolveLocale } from '../i18n/index.js';
import { AdminApp } from './AdminApp.jsx';

/** Boots the admin page: theme, locale, then the app. */
async function main() {
  const { context } = await bootstrap();
  createRoot(document.getElementById('root')).render(
    <I18nProvider locale={resolveLocale(context.locale)}>
      <AdminApp />
    </I18nProvider>,
  );
}

main();
