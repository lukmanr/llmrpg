import { DialogueView } from './DialogueView';

/**
 * Thin wrapper retained for reuse. The game page hosts dialogue in DialogueModal;
 * this exports the same stream UI against a dialogue target id.
 */
export function ChatPanel() {
  return (
    <DialogueView
      targetId="npc-bram"
      title="Bram"
      emptyHint="Speak to Bram the Gatekeeper. He watches the Milltown road."
    />
  );
}
