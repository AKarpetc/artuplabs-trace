import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { showFlag } from '@forge/bridge';

const FLAG_TYPES = new Set(['success', 'warning', 'error', 'info']);

const ToastContext = createContext(null);

/**
 * Provides a `show({ title, description, appearance, actions })` toast API to
 * descendants, rendered as native auto-dismissing Jira flags.
 */
export function ToastProvider({ children }) {
  const nextId = useRef(0);
  const flags = useRef(new Map());

  const dismiss = useCallback((id) => {
    const flag = flags.current.get(id);
    flags.current.delete(id);
    Promise.resolve(flag?.close?.()).catch(() => {});
  }, []);

  const show = useCallback(({ title, description, appearance, actions }) => {
    nextId.current += 1;
    const id = `artup-trace-${Date.now()}-${nextId.current}`;
    const options = {
      id,
      title,
      type: FLAG_TYPES.has(appearance) ? appearance : 'info',
      isAutoDismiss: true,
    };
    if (description) {
      options.description = description;
    }
    if (actions?.length) {
      options.actions = actions.map((action) => ({ text: action.text ?? action.content, onClick: action.onClick }));
    }
    flags.current.set(id, showFlag(options));
    return id;
  }, []);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

/** Returns the `{ show, dismiss }` toast API from the nearest `ToastProvider`. */
export function useToasts() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToasts must be used within a ToastProvider');
  }
  return context;
}
