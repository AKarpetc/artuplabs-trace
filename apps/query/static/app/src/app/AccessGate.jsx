import Button from '@atlaskit/button/new';
import EmptyState from '@atlaskit/empty-state';
import Spinner from '@atlaskit/spinner';
import { Box, xcss } from '@atlaskit/primitives';
import { errorMessage } from '../api.js';
import { useT } from '../i18n/index.js';
import { EmptyIllustration } from '../illustrations/EmptyIllustration.jsx';
import { LockIllustration } from '../illustrations/LockIllustration.jsx';
import { useAccess } from './useAccess.js';

const centerStyles = xcss({ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' });

/** Licence gate: a spinner while checking, an empty state with one retry action when unlicensed or failed, else `children`. */
export function AccessGate({ children }) {
  const t = useT();
  const access = useAccess();
  if (access.status === 'loading') {
    return <Box xcss={centerStyles}><Spinner size="large" label={t('loading')} /></Box>;
  }
  if (access.status === 'unlicensed') {
    return (
      <EmptyState
        header={t('unlicensed.title')}
        description={t('unlicensed.body')}
        renderImage={() => <LockIllustration size={160} />}
        primaryAction={<Button appearance="primary" onClick={access.retry}>{t('errors.tryAgain')}</Button>}
        headingLevel={1}
      />
    );
  }
  if (access.status === 'error') {
    return (
      <EmptyState
        header={errorMessage(t, access.error)}
        renderImage={() => <EmptyIllustration size={160} />}
        primaryAction={<Button appearance="primary" onClick={access.retry}>{t('errors.tryAgain')}</Button>}
        headingLevel={1}
      />
    );
  }
  return children;
}
