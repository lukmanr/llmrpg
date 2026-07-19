import { useEffect } from 'react';
import { DialogueView } from './DialogueView';

export interface DialogueTarget {
  entityId: string;
  displayName: string;
  /** Retained for PresentationChannel typing; unused by the dialogue flow. */
  agentName?: string;
}

export interface DialogueModalProps {
  target: DialogueTarget;
  onClose: () => void;
}

export function DialogueModal({ target, onClose }: DialogueModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    // Capture phase so we close before the map input source sees Escape.
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-dialog dialogue-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Dialogue with ${target.displayName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h2>{target.displayName}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            Esc
          </button>
        </header>
        <DialogueView
          targetId={target.entityId}
          title={target.displayName}
          onFarewellComplete={onClose}
        />
      </div>
    </div>
  );
}
