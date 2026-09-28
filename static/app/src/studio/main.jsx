import { createRoot } from 'react-dom/client';
import '@atlaskit/css-reset';
import { bootstrap } from '../theme';
import { I18nProvider, resolveLocale } from '../i18n/index.js';
import { StudioApp } from './StudioApp.jsx';

/** Boots the space page: theme, locale, then the studio. */
async function main() {
  const { context } = await bootstrap();
  createRoot(document.getElementById('root')).render(
    <I18nProvider locale={resolveLocale(context.locale)}>
      <StudioApp context={context} />
    </I18nProvider>,
  );
}

main();
