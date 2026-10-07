import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal } from '../components/ui/Modal';

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
  undo?: () => Promise<void> | void;
}
interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
interface FeedbackApi {
  notify: (message: string, opts?: { undo?: () => Promise<void> | void; tone?: 'info' | 'error' }) => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Ejecuta una acción y muestra el error de forma comprensible si falla. */
  run: <T>(fn: () => Promise<T>, success?: string) => Promise<T | undefined>;
}

const Ctx = createContext<FeedbackApi | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const notify = useCallback<FeedbackApi['notify']>(
    (message, opts) => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-2), { id, message, tone: opts?.tone ?? 'info', undo: opts?.undo }]);
      setTimeout(() => dismiss(id), opts?.undo ? 8000 : 4000);
    },
    [dismiss],
  );

  const confirm = useCallback<FeedbackApi['confirm']>((opts) => new Promise((resolve) => setConfirmState({ ...opts, resolve })), []);

  const run = useCallback<FeedbackApi['run']>(
    async (fn, success) => {
      try {
        const r = await fn();
        if (success) notify(success);
        return r;
      } catch (e) {
        notify(e instanceof Error ? e.message : 'Ocurrió un error inesperado.', { tone: 'error' });
        return undefined;
      }
    },
    [notify],
  );

  const close = (v: boolean) => {
    confirmState?.resolve(v);
    setConfirmState(null);
  };

  const api = useMemo(() => ({ notify, confirm, run }), [notify, confirm, run]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'error' ? 'error' : ''}`}>
            <span className="grow">{t.message}</span>
            {t.undo && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  dismiss(t.id);
                  await t.undo?.();
                  notify('Acción deshecha');
                }}
              >
                Deshacer
              </button>
            )}
          </div>
        ))}
      </div>
      <Modal
        open={!!confirmState}
        title={confirmState?.title ?? ''}
        onClose={() => close(false)}
        footer={
          <>
            <button type="button" className="btn" onClick={() => close(false)}>
              {confirmState?.cancelLabel ?? 'Cancelar'}
            </button>
            <button type="button" data-autofocus className={`btn ${confirmState?.danger ? 'btn-danger-solid' : 'btn-primary'}`} onClick={() => close(true)}>
              {confirmState?.confirmLabel ?? 'Confirmar'}
            </button>
          </>
        }
      >
        <div className="stack">{confirmState?.message}</div>
      </Modal>
    </Ctx.Provider>
  );
}

export function useFeedback(): FeedbackApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFeedback fuera de FeedbackProvider');
  return v;
}
