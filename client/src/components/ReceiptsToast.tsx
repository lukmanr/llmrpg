import { useEffect, useState } from 'react';
import type { ReceiptView } from '@llmrpg/shared';

const DISMISS_MS = 8000;

export interface ToastReceipt extends ReceiptView {
  /** Client-local id so duplicate server ids still stack uniquely. */
  toastId: string;
}

export interface ReceiptsToastProps {
  toasts: ToastReceipt[];
  onDismiss: (toastId: string) => void;
  onOpenThreads: () => void;
}

export function ReceiptsToast({ toasts, onDismiss, onOpenThreads }: ReceiptsToastProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="receipts-toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <ReceiptToastItem
          key={toast.toastId}
          toast={toast}
          onDismiss={onDismiss}
          onOpenThreads={onOpenThreads}
        />
      ))}
    </div>
  );
}

function ReceiptToastItem({
  toast,
  onDismiss,
  onOpenThreads,
}: {
  toast: ToastReceipt;
  onDismiss: (toastId: string) => void;
  onOpenThreads: () => void;
}) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLeaving(true);
      window.setTimeout(() => onDismiss(toast.toastId), 280);
    }, DISMISS_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast.toastId, onDismiss]);

  return (
    <button
      type="button"
      className={leaving ? 'receipt-toast leaving' : 'receipt-toast'}
      onClick={() => {
        onOpenThreads();
        onDismiss(toast.toastId);
      }}
    >
      <span className="receipt-toast-prefix">◈ Because of you —</span>
      <span className="receipt-toast-text">{toast.text}</span>
    </button>
  );
}
