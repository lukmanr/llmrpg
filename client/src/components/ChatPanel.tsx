import { NPC_PLACEHOLDER_AGENT } from '@llmrpg/shared';
import { DialogueView } from './DialogueView';

/**
 * Thin wrapper retained for reuse. The game page hosts dialogue in DialogueModal;
 * this exports the same stream UI with the Phase 0 Bram defaults.
 */
export function ChatPanel() {
  return (
    <DialogueView
      agentName={NPC_PLACEHOLDER_AGENT}
      title="Bram"
      emptyHint="Speak to Bram the Gatekeeper. He watches the Milltown road."
    />
  );
}
