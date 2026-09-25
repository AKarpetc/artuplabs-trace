import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { FlagGroup } from '@atlaskit/flag';
import AutoDismissFlag from '@atlaskit/flag/auto-dismiss-flag';
import { useT } from '../i18n/index.js';

const ToastContext = createContext(null);

/**
 * Provides a `show({ title, description, appearance })` toast API to
 * descendants, rendering active toasts as an Atlaskit flag group; flags
 * auto-dismiss after a few seconds and can be dismissed manually.
 */
export function ToastProvider({ children }) {
  const t = useT();
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
        {toasts.map((toast) => (
          <AutoDismissFlag
            key={toast.id}
            id={toast.id}
            title={toast.title}
            description={toast.description}
            appearance={toast.appearance}
            actions={[...(toast.actions ?? []), { content: t('common.dismiss'), onClick: () => dismiss(toast.id) }]}
            onDismissed={dismiss}
          />
        ))}
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
