import type { WorldTurnHook } from '../engine/world';
import type { CognitionStores } from './api';

/**
 * Runs last in the turn pipeline: delivers receipts recorded between turns
 * (jobs/gossip) onto this turn's response.
 */
export function createReceiptDrainHook(stores: CognitionStores): WorldTurnHook {
  return {
    name: 'receipts',
    run(ctx) {
      const drained = stores.receipts.drain();
      ctx.receipts.push(...drained);
    },
  };
}
