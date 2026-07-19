import type {
  PresentationChannel,
  PlayerIntent,
  Ticker,
  WorldView,
} from '@llmrpg/eal-core';
import type {
  EntityView,
  GameAction,
  GameEventView,
  LogLine,
  ReceiptView,
  Snapshot,
  Terrain,
  WorldDelta,
} from '@llmrpg/shared';
import { TERRAIN_FLAGS } from '@llmrpg/shared';
import { getSession, getSnapshot, submitAction } from '../lib/gameClient';

export type ConnectionState = 'connecting' | 'ready' | 'error';

/** Subset of the map renderer the controller needs for pointer hover. */
export interface HoverRenderer {
  setHover(tile: { x: number; y: number } | null): void;
}

export interface HoverInfo {
  tile: { x: number; y: number };
  entity: EntityView | null;
}

export interface GameControllerOptions {
  presentation: PresentationChannel;
  renderer: HoverRenderer;
  /** UI intents (journal / inventory / dismiss) forwarded to the React shell. */
  onUiIntent?: (ui: 'toggle-journal' | 'toggle-inventory' | 'dismiss') => void;
  /** Consequence receipts from successful action responses (DESIGN §7.2). */
  onReceipts?: (receipts: ReceiptView[]) => void;
  /** Pointer hover target for the floating tooltip. */
  onHover?: (info: HoverInfo | null) => void;
}

interface MutableWorldView {
  revision: number;
  tick: number;
  map: {
    width: number;
    height: number;
    explored: Array<Terrain | null>;
  };
  visible: Snapshot['visible'];
  player: Snapshot['player'];
  log: LogLine[];
}

function sign(n: number): number {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/**
 * One greedy step toward (tx, ty): prefer the axis of larger delta, then the
 * other axis, then diagonal — same order as NPC reflex pathing.
 */
function greedyStepDeltas(
  x: number,
  y: number,
  tx: number,
  ty: number,
): Array<{ dx: number; dy: number }> {
  const adx = tx - x;
  const ady = ty - y;
  if (adx === 0 && ady === 0) return [];

  const sx = sign(adx);
  const sy = sign(ady);
  const absX = Math.abs(adx);
  const absY = Math.abs(ady);

  const deltas: Array<{ dx: number; dy: number }> = [];
  const pushUnique = (dx: number, dy: number): void => {
    if (dx === 0 && dy === 0) return;
    if (!deltas.some((d) => d.dx === dx && d.dy === dy)) {
      deltas.push({ dx, dy });
    }
  };

  if (absX >= absY) {
    pushUnique(sx, 0);
    pushUnique(0, sy);
  } else {
    pushUnique(0, sy);
    pushUnique(sx, 0);
  }
  pushUnique(sx, sy);
  return deltas;
}

/**
 * Owns WorldView assembly, turn submission, context resolution for take/talk,
 * pointer play, and PresentationChannel side-effects from talk events.
 *
 * Never mutates the published WorldView in place without notify(); subscribers
 * always receive a stable snapshot via getView().
 */
export class GameController implements Ticker {
  private readonly presentation: PresentationChannel;
  private readonly renderer: HoverRenderer;
  private readonly onUiIntent?: GameControllerOptions['onUiIntent'];
  private readonly onReceipts?: GameControllerOptions['onReceipts'];
  private readonly onHover?: GameControllerOptions['onHover'];

  private state: MutableWorldView | null = null;
  private connection: ConnectionState = 'connecting';
  private lastError: string | null = null;
  private listeners = new Set<() => void>();

  private inFlight = false;
  private queued: GameAction | null = null;
  private onlineHandler: (() => void) | null = null;

  constructor(options: GameControllerOptions) {
    this.presentation = options.presentation;
    this.renderer = options.renderer;
    this.onUiIntent = options.onUiIntent;
    this.onReceipts = options.onReceipts;
    this.onHover = options.onHover;
  }

  getConnectionState(): ConnectionState {
    return this.connection;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getView(): WorldView | null {
    if (!this.state) return null;
    return this.state as WorldView;
  }

  subscribe(onChange: () => void): () => void {
    this.listeners.add(onChange);
    return () => {
      this.listeners.delete(onChange);
    };
  }

  /** Boot: fetch session snapshot and start reconnect listeners. */
  async boot(): Promise<void> {
    this.bindReconnect();
    await this.loadSession();
  }

  async retry(): Promise<void> {
    await this.loadSession();
  }

  dispose(): void {
    if (this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler);
      this.onlineHandler = null;
    }
    this.renderer.setHover(null);
    this.onHover?.(null);
    this.listeners.clear();
  }

  /** Ticker: submit one action; serializes turns (at most one queued). */
  async requestTurn(action: GameAction): Promise<void> {
    if (this.inFlight) {
      this.queued = action;
      return;
    }
    await this.runTurn(action);
  }

  /**
   * Handle a PlayerIntent from the input adapter.
   * Resolves empty take/talk ids and pointer context before submitting.
   */
  handleIntent(intent: PlayerIntent): void {
    if (intent.kind === 'ui') {
      this.onUiIntent?.(intent.ui);
      return;
    }

    if (intent.kind === 'pointer') {
      this.handlePointer(intent.tile, intent.hover === true);
      return;
    }

    const resolved = this.resolveAction(intent.action);
    if (!resolved) return;
    void this.requestTurn(resolved);
  }

  /** Nearest adjacent talkable (for action-bar enablement). */
  findTalkTarget(): EntityView | null {
    return this.findAdjacentTalkable();
  }

  /** Nearest takeable item on/adjacent (for action-bar enablement). */
  findTakeTarget(): EntityView | null {
    return this.findAdjacentCarryable();
  }

  private handlePointer(tile: { x: number; y: number }, hover: boolean): void {
    if (hover) {
      this.renderer.setHover(tile);
      const entity = this.entityAt(tile.x, tile.y);
      this.onHover?.({ tile, entity });
      return;
    }

    this.renderer.setHover(null);
    this.onHover?.(null);

    const action = this.resolvePointerClick(tile);
    if (!action) return;
    void this.requestTurn(action);
  }

  private resolvePointerClick(tile: { x: number; y: number }): GameAction | null {
    const view = this.state;
    if (!view) return null;

    const { x: px, y: py } = view.player;
    const dist = chebyshev(px, py, tile.x, tile.y);
    const entitiesHere = this.entitiesAt(tile.x, tile.y);

    const talkable = entitiesHere.find((e) => e.talkable);
    if (talkable && dist <= 1 && dist > 0) {
      return { verb: 'talk', targetId: talkable.id };
    }

    const item = entitiesHere.find((e) => e.carryable);
    if (item && dist <= 1) {
      return { verb: 'take', itemId: item.id };
    }

    // Adjacent walkable → step onto it.
    if (dist === 1 && this.isWalkable(tile.x, tile.y)) {
      return { verb: 'move', dx: tile.x - px, dy: tile.y - py };
    }

    // Farther walkable → one greedy step toward it.
    if (dist > 1 && this.isWalkable(tile.x, tile.y)) {
      for (const { dx, dy } of greedyStepDeltas(px, py, tile.x, tile.y)) {
        const nx = px + dx;
        const ny = py + dy;
        if (this.isWalkable(nx, ny)) {
          return { verb: 'move', dx, dy };
        }
      }
    }

    return null;
  }

  private isWalkable(x: number, y: number): boolean {
    const view = this.state;
    if (!view) return false;
    if (x < 0 || y < 0 || x >= view.map.width || y >= view.map.height) return false;
    const terrain = view.map.explored[y * view.map.width + x];
    if (terrain == null) return false;
    if (!TERRAIN_FLAGS[terrain].passable) return false;
    return !view.visible.entities.some((e) => e.x === x && e.y === y && e.blocking);
  }

  private entityAt(x: number, y: number): EntityView | null {
    const entities = this.entitiesAt(x, y);
    return entities[0] ?? null;
  }

  private entitiesAt(x: number, y: number): EntityView[] {
    const view = this.state;
    if (!view) return [];
    const rank = (e: EntityView): number => {
      if (e.talkable) return 0;
      if (e.kind === 'creature') return 1;
      if (e.carryable) return 2;
      if (e.kind === 'npc') return 3;
      return 4;
    };
    return view.visible.entities
      .filter((e) => e.x === x && e.y === y)
      .sort((a, b) => rank(a) - rank(b));
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private setError(message: string): void {
    this.connection = 'error';
    this.lastError = message;
    this.notify();
  }

  private bindReconnect(): void {
    if (this.onlineHandler) return;
    this.onlineHandler = () => {
      void this.refetchSnapshot('online');
    };
    window.addEventListener('online', this.onlineHandler);
  }

  private async loadSession(): Promise<void> {
    this.connection = 'connecting';
    this.lastError = null;
    this.notify();
    try {
      const snapshot = await getSession();
      this.applySnapshot(snapshot);
      this.connection = 'ready';
      this.lastError = null;
      this.notify();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setError(msg);
    }
  }

  private async refetchSnapshot(_reason: string): Promise<void> {
    try {
      const snapshot = await getSnapshot();
      this.applySnapshot(snapshot);
      this.connection = 'ready';
      this.lastError = null;
      this.notify();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setError(msg);
    }
  }

  private applySnapshot(snapshot: Snapshot): void {
    this.state = {
      revision: snapshot.revision,
      tick: snapshot.tick,
      map: {
        width: snapshot.map.width,
        height: snapshot.map.height,
        explored: [...snapshot.map.explored],
      },
      visible: {
        tileIdx: [...snapshot.visible.tileIdx],
        entities: snapshot.visible.entities.map((e) => ({
          ...e,
          appearance: { ...e.appearance, tags: [...e.appearance.tags] },
        })),
      },
      player: {
        ...snapshot.player,
        inventory: snapshot.player.inventory.map((i) => ({ ...i })),
      },
      log: [...snapshot.logTail],
    };
  }

  private resolveAction(action: GameAction): GameAction | null {
    if (action.verb === 'take' && action.itemId === '') {
      const item = this.findAdjacentCarryable();
      if (!item) {
        this.presentation.notify('Nothing here to take.', 'system');
        return null;
      }
      return { verb: 'take', itemId: item.id };
    }
    if (action.verb === 'talk' && action.targetId === '') {
      const target = this.findAdjacentTalkable();
      if (!target) {
        this.presentation.notify('No one to talk to.', 'system');
        return null;
      }
      return { verb: 'talk', targetId: target.id };
    }
    return action;
  }

  private findAdjacentCarryable(): EntityView | null {
    const view = this.state;
    if (!view) return null;
    const { x, y } = view.player;
    const candidates = view.visible.entities.filter(
      (e) => e.carryable && Math.abs(e.x - x) <= 1 && Math.abs(e.y - y) <= 1,
    );
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const da = Math.abs(a.x - x) + Math.abs(a.y - y);
      const db = Math.abs(b.x - x) + Math.abs(b.y - y);
      return da - db;
    });
    return candidates[0] ?? null;
  }

  private findAdjacentTalkable(): EntityView | null {
    const view = this.state;
    if (!view) return null;
    const { x, y } = view.player;
    const candidates = view.visible.entities.filter((e) => {
      if (!e.talkable) return false;
      const dx = Math.abs(e.x - x);
      const dy = Math.abs(e.y - y);
      return dx <= 1 && dy <= 1 && !(dx === 0 && dy === 0);
    });
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const da = Math.abs(a.x - x) + Math.abs(a.y - y);
      const db = Math.abs(b.x - x) + Math.abs(b.y - y);
      return da - db;
    });
    return candidates[0] ?? null;
  }

  private async runTurn(action: GameAction): Promise<void> {
    if (!this.state) return;
    this.inFlight = true;
    try {
      await this.submitWithRecovery(action);
    } finally {
      this.inFlight = false;
      const next = this.queued;
      this.queued = null;
      if (next) {
        await this.runTurn(next);
      }
    }
  }

  private async submitWithRecovery(action: GameAction): Promise<void> {
    if (!this.state) return;
    try {
      let response = await submitAction({
        revision: this.state.revision,
        action,
      });

      if (!response.ok && response.error.code === 'stale_revision') {
        await this.refetchSnapshot('stale_revision');
        if (!this.state) return;
        response = await submitAction({
          revision: this.state.revision,
          action,
        });
      }

      if (!response.ok) {
        this.presentation.notify(response.error.message, 'system');
        if (response.error.code === 'stale_revision') {
          await this.refetchSnapshot('stale_revision_retry_failed');
        }
        return;
      }

      this.applyDelta(response.revision, response.tick, response.delta, response.log);
      if (response.receipts && response.receipts.length > 0) {
        this.onReceipts?.(response.receipts);
      }
      this.dispatchEvents(response.events);
      this.notify();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.presentation.notify(`Connection error: ${msg}`, 'system');
      await this.refetchSnapshot('fetch_failed');
    }
  }

  private applyDelta(
    revision: number,
    tick: number,
    delta: WorldDelta,
    logLines: LogLine[],
  ): void {
    if (!this.state) return;

    const explored = [...this.state.map.explored];
    for (const patch of delta.exploredPatch) {
      if (patch.idx >= 0 && patch.idx < explored.length) {
        explored[patch.idx] = patch.terrain;
      }
    }

    this.state = {
      revision,
      tick,
      map: {
        width: this.state.map.width,
        height: this.state.map.height,
        explored,
      },
      visible: {
        tileIdx: [...delta.visible.tileIdx],
        entities: delta.visible.entities.map((e) => ({
          ...e,
          appearance: { ...e.appearance, tags: [...e.appearance.tags] },
        })),
      },
      player: {
        ...delta.player,
        inventory: delta.player.inventory.map((i) => ({ ...i })),
      },
      log: [...this.state.log, ...logLines],
    };
  }

  private dispatchEvents(events: GameEventView[]): void {
    for (const event of events) {
      if (event.verb !== 'talk') continue;
      const entityId = event.targetIds[0];
      if (!entityId) continue;
      const displayName =
        typeof event.data['displayName'] === 'string'
          ? event.data['displayName']
          : 'Someone';
      const agentName =
        typeof event.data['agentName'] === 'string' ? event.data['agentName'] : '';
      this.presentation.openDialogue({ entityId, displayName, agentName });
    }
  }

  /** Append a local-only log line (e.g. from presentation.notify). */
  appendLocalLog(text: string, tone: LogLine['tone'] = 'system'): void {
    if (!this.state) {
      return;
    }
    const line: LogLine = {
      tick: this.state.tick,
      text,
      tone,
    };
    this.state = {
      ...this.state,
      log: [...this.state.log, line],
    };
    this.notify();
  }
}
