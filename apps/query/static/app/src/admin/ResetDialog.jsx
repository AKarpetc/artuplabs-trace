import Button from '@atlaskit/button/new';
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog';
import { Text } from '@atlaskit/primitives';
import { useT } from '../i18n/index.js';

/** In-page confirmation before the whole index is rebuilt; while the reset is being sent it cannot be closed. */
export function ResetDialog({ open, busy = false, onConfirm, onCancel }) {
  const t = useT();
  return (
    <ModalTransition>
      {open ? (
        <Modal onClose={busy ? undefined : onCancel} width="small" testId="reset-dialog" label={t('admin.reset.confirmTitle')}>
          <ModalHeader hasCloseButton={!busy}>
            <ModalTitle appearance="danger">{t('admin.reset.confirmTitle')}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <Text>{t('admin.reset.confirmBody')}</Text>
          </ModalBody>
          <ModalFooter>
            <Button appearance="subtle" onClick={onCancel} isDisabled={busy} testId="reset-cancel">{t('admin.reset.cancel')}</Button>
            <Button appearance="danger" onClick={onConfirm} isLoading={busy} testId="reset-confirm">{t('admin.reset.action')}</Button>
          </ModalFooter>
        </Modal>
      ) : null}
    </ModalTransition>
  );
}
