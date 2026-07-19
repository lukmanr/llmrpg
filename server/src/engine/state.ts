import type { EntityKind, Terrain } from '@llmrpg/shared';
import type { ComponentData, ComponentKind } from './components';

export interface EntityRecord {
  id: string;
  kind: EntityKind;
  name: string;
  components: Map<ComponentKind, ComponentData[ComponentKind]>;
}

export interface WorldState {
  worldId: string;
  revision: number;
  tick: number;
  mapWidth: number;
  mapHeight: number;
  terrain: Terrain[];
  entities: Map<string, EntityRecord>;
}

export interface PlaythroughState {
  id: string;
  playerEntityId: string;
  explored: Array<Terrain | null>;
  log: import('@llmrpg/shared').LogLine[];
}

export function getComponent<K extends ComponentKind>(
  entity: EntityRecord,
  kind: K,
): ComponentData[K] | undefined {
  return entity.components.get(kind) as ComponentData[K] | undefined;
}

export function setComponent<K extends ComponentKind>(
  entity: EntityRecord,
  kind: K,
  data: ComponentData[K],
): void {
  entity.components.set(kind, data);
}

export function removeComponent(entity: EntityRecord, kind: ComponentKind): void {
  entity.components.delete(kind);
}

export function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function flatIndex(x: number, y: number, width: number): number {
  return y * width + x;
}

export function entityAt(
  state: WorldState,
  x: number,
  y: number,
  predicate?: (e: EntityRecord) => boolean,
): EntityRecord | undefined {
  for (const e of state.entities.values()) {
    const pos = getComponent(e, 'Position');
    if (!pos || pos.x !== x || pos.y !== y) continue;
    if (predicate && !predicate(e)) continue;
    return e;
  }
  return undefined;
}

export function entitiesAt(state: WorldState, x: number, y: number): EntityRecord[] {
  const out: EntityRecord[] = [];
  for (const e of state.entities.values()) {
    const pos = getComponent(e, 'Position');
    if (pos && pos.x === x && pos.y === y) out.push(e);
  }
  return out;
}
