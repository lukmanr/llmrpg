import type { WorldDb } from '../engine/db';
import type { WorldState } from '../engine/state';
import { chebyshev, getComponent } from '../engine/state';
import type { CognitionStores } from './api';

export interface GossipJobPayload {
  /** Optional override; default uses world.tick. */
  tick?: number;
}

/** @internal — set by createCognitionStores for pending-job peeks. */
export type PendingJobPeeker = (kind: 'reflection' | 'gossip') => boolean;

const pendingPeekers = new WeakMap<object, PendingJobPeeker>();
const storesDb = new WeakMap<object, WorldDb>();

export function registerPendingJobPeeker(stores: object, peeker: PendingJobPeeker): void {
  pendingPeekers.set(stores, peeker);
}

export function registerStoresDb(stores: object, db: WorldDb): void {
  storesDb.set(stores, db);
}

export function getStoresDb(stores: object): WorldDb | undefined {
  return storesDb.get(stores);
}

function npcPositions(world: WorldState): Array<{ id: string; name: string; x: number; y: number }> {
  const out: Array<{ id: string; name: string; x: number; y: number }> = [];
  for (const e of world.entities.values()) {
    if (e.kind !== 'npc') continue;
    const pos = getComponent(e, 'Position');
    if (!pos) continue;
    out.push({ id: e.id, name: e.name, x: pos.x, y: pos.y });
  }
  return out;
}

function mostConfidentBelief(stores: CognitionStores, npcId: string) {
  const list = stores.beliefs.forNpc(npcId);
  if (list.length === 0) return null;
  return list[0]!;
}

function isAboutPlayer(world: WorldState, aboutEntityIds: string[]): boolean {
  return aboutEntityIds.some((id) => world.entities.get(id)?.kind === 'player');
}

/**
 * Pairwise gossip: NPCs within Chebyshev distance 2 exchange their single
 * most-confident belief each. Player-subject transmits produce receipts.
 */
export function runGossipJob(
  stores: CognitionStores,
  world: WorldState,
  payload: GossipJobPayload = {},
): number {
  const tick = payload.tick ?? world.tick;
  const npcs = npcPositions(world);
  let transmits = 0;

  for (let i = 0; i < npcs.length; i++) {
    for (let j = i + 1; j < npcs.length; j++) {
      const a = npcs[i]!;
      const b = npcs[j]!;
      if (chebyshev(a.x, a.y, b.x, b.y) > 2) continue;

      const beliefA = mostConfidentBelief(stores, a.id);
      const beliefB = mostConfidentBelief(stores, b.id);

      if (beliefA) {
        const copied = stores.beliefs.transmit(a.id, b.id, beliefA.id, tick);
        if (copied) {
          transmits += 1;
          stores.memories.append({
            npcId: b.id,
            tick,
            type: 'belief',
            text: `${a.name} told me: ${beliefA.proposition}`,
            subjects: [...beliefA.aboutEntityIds, a.id],
            importance: 4,
          });
          if (isAboutPlayer(world, beliefA.aboutEntityIds)) {
            stores.receipts.record({
              tick,
              text: `Word spreads: ${a.name} told ${b.name} about you.`,
              eventIds: [],
            });
          }
        }
      }

      if (beliefB) {
        const copied = stores.beliefs.transmit(b.id, a.id, beliefB.id, tick);
        if (copied) {
          transmits += 1;
          stores.memories.append({
            npcId: a.id,
            tick,
            type: 'belief',
            text: `${b.name} told me: ${beliefB.proposition}`,
            subjects: [...beliefB.aboutEntityIds, b.id],
            importance: 4,
          });
          if (isAboutPlayer(world, beliefB.aboutEntityIds)) {
            stores.receipts.record({
              tick,
              text: `Word spreads: ${b.name} told ${a.name} about you.`,
              eventIds: [],
            });
          }
        }
      }
    }
  }

  return transmits;
}

/**
 * Enqueue a single gossip job when tick hits the cadence window.
 * Idempotent per window: skips if a pending gossip job already exists.
 */
export function enqueueGossipEvery(
  stores: CognitionStores,
  tick: number,
  everyNTicks = 30,
): boolean {
  if (tick % everyNTicks !== 0) return false;
  const peeker = pendingPeekers.get(stores as object);
  if (peeker?.('gossip')) return false;
  const windowId = Math.floor(tick / everyNTicks);
  stores.jobs.enqueue('gossip', null, { windowId }, tick);
  return true;
}
