import { createRoot } from 'react-dom/client';
import '@atlaskit/css-reset';
import { bootstrap } from '../src/theme';
import { I18nProvider, resolveLocale } from '../src/i18n/index.js';
import { applyWidth, previewParams } from './driver.js';
import { SCREEN_COMPONENTS } from './Gallery.jsx';

/** Boots the preview like the real entries: `?screen=<name>&state=<state>&locale=<code>&theme=<light|dark>&width=<px>`. */
async function main() {
  const { screen, width } = previewParams();
  const Screen = SCREEN_COMPONENTS[screen] ?? SCREEN_COMPONENTS.gallery;
  const { context } = await bootstrap();
  const root = document.getElementById('root');
  applyWidth(root, width);
  createRoot(root).render(
    <I18nProvider locale={resolveLocale(context.locale)}>
      <Screen context={context} />
    </I18nProvider>,
  );
}

main();
