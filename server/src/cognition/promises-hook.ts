import type { WorldTurnHook } from '../engine/world';
import type { CognitionStores } from './api';
import { getStoresDb } from './gossip';
import { markReceiptsDelivered } from './stores';

function expiredReceiptText(p: {
  fromEntityId: string;
  fromName: string;
  toEntityId: string;
  toName: string;
  terms: string;
}): string {
  const fromIsPlayer = p.fromName === 'You' || p.fromEntityId.includes('player');
  const toIsPlayer = p.toName === 'You' || p.toEntityId.includes('player');
  if (fromIsPlayer) {
    return `Your promise to ${p.toName} expired unkept: ${p.terms}`;
  }
  if (toIsPlayer) {
    return `${p.fromName}'s promise to you expired unkept: ${p.terms}`;
  }
  return `Your promise to ${p.toName} expired unkept: ${p.terms}`;
}

/**
 * Promise deadline sweep: expire open promises past deadline and emit receipts.
 */
export function createPromiseHook(stores: CognitionStores): WorldTurnHook {
  return {
    name: 'promises',
    run(ctx) {
      const changed = stores.promises.sweep(ctx.world.tick);
      const ids: string[] = [];
      for (const p of changed) {
        const receipt = stores.receipts.record({
          tick: ctx.world.tick,
          text: expiredReceiptText(p),
          eventIds: [],
        });
        ctx.receipts.push(receipt);
        ids.push(receipt.id);
      }
      const db = getStoresDb(stores);
      if (db) markReceiptsDelivered(db, ids);
    },
  };
}
