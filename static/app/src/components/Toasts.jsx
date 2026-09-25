import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { FlagGroup } from '@atlaskit/flag';
import AutoDismissFlag from '@atlaskit/flag/auto-dismiss-flag';
import StatusSuccessIcon from '@atlaskit/icon/core/status-success';
import StatusWarningIcon from '@atlaskit/icon/core/status-warning';
import StatusErrorIcon from '@atlaskit/icon/core/status-error';
import StatusInformationIcon from '@atlaskit/icon/core/status-information';

const STATUS_BY_APPEARANCE = {
  success: { Icon: StatusSuccessIcon, color: 'color.icon.success' },
  warning: { Icon: StatusWarningIcon, color: 'color.icon.warning' },
  error: { Icon: StatusErrorIcon, color: 'color.icon.danger' },
  info: { Icon: StatusInformationIcon, color: 'color.icon.information' },
};

const ToastContext = createContext(null);

/**
 * Provides a `show({ title, description, appearance })` toast API to
 * descendants, rendering active toasts as `normal`-appearance Atlaskit
 * flags with a status-coloured icon, so the built-in close button is
 * always available; flags also auto-dismiss after a few seconds.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((toast) => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((current) => [...current, { appearance: 'info', ...toast, id }]);
    return id;
  }, []);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <FlagGroup onDismissed={dismiss}>
        {toasts.map((toast) => {
          const status = STATUS_BY_APPEARANCE[toast.appearance] ?? STATUS_BY_APPEARANCE.info;
          const StatusIcon = status.Icon;
          return (
            <AutoDismissFlag
              key={toast.id}
              id={toast.id}
              title={toast.title}
              description={toast.description}
              appearance="normal"
              icon={<StatusIcon label="" color={status.color} />}
              actions={toast.actions}
              onDismissed={dismiss}
            />
          );
        })}
      </FlagGroup>
    </ToastContext.Provider>
  );
}

/** Returns the `{ show, dismiss }` toast API from the nearest `ToastProvider`. */
export function useToasts() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToasts must be used within a ToastProvider');
  }
  return context;
}
