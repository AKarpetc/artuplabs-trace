import { router, view } from '@forge/bridge';
import Button from '@atlaskit/button/new';
import EmptyState from '@atlaskit/empty-state';
import { Box, xcss } from '@atlaskit/primitives';
import { entryFromContext } from '../core/entry.js';
import { useT } from '../i18n/index.js';
import { EmptyIllustration } from '../illustrations/EmptyIllustration.jsx';
import { Wizard } from '../wizard/Wizard.jsx';
import { AccessGate } from './AccessGate.jsx';
import { globalPagePath } from './globalPageUrl.js';

const shellStyles = xcss({ padding: 'space.200' });

const closeModal = () => view.close();

function UnknownContext({ localId }) {
  const t = useT();
  const path = globalPagePath(localId);
  const action = path
    ? <Button appearance="primary" onClick={() => router.navigate(path)} testId="open-global">{t('action.openGlobal')}</Button>
    : <Button appearance="primary" onClick={closeModal} testId="close-modal">{t('action.close')}</Button>;
  return (
    <EmptyState
      header={t('action.unknown')}
      renderImage={() => <EmptyIllustration size={160} />}
      primaryAction={action}
      headingLevel={1}
    />
  );
}

/** Action modal: licence gate, then the wizard for the entry the module context describes, in a compact layout. */
export function ActionApp({ context }) {
  const t = useT();
  const entry = entryFromContext(context.extension);
  const close = <Button onClick={closeModal} testId="close-modal">{t('action.close')}</Button>;
  return (
    <Box xcss={shellStyles}>
      <AccessGate>
        {entry.kind === 'none'
          ? <UnknownContext localId={context.localId} />
          : <Wizard entry={entry} context={context} compact resultAction={close} />}
      </AccessGate>
    </Box>
  );
}
