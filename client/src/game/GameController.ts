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
  Snapshot,
  Terrain,
  WorldDelta,
} from '@llmrpg/shared';
import { getSession, getSnapshot, submitAction } from '../lib/gameClient';

export type ConnectionState = 'connecting' | 'ready' | 'error';

export interface GameControllerOptions {
  presentation: PresentationChannel;
  /** UI intents (journal / inventory / dismiss) forwarded to the React shell. */
  onUiIntent?: (ui: 'toggle-journal' | 'toggle-inventory' | 'dismiss') => void;
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

/**
 * Owns WorldView assembly, turn submission, context resolution for take/talk,
 * and PresentationChannel side-effects from talk events.
 *
 * Never mutates the published WorldView in place without notify(); subscribers
 * always receive a stable snapshot via getView().
 */
export class GameController implements Ticker {
  private readonly presentation: PresentationChannel;
  private readonly onUiIntent?: GameControllerOptions['onUiIntent'];

  private state: MutableWorldView | null = null;
  private connection: ConnectionState = 'connecting';
  private lastError: string | null = null;
  private listeners = new Set<() => void>();

  private inFlight = false;
  private queued: GameAction | null = null;
  private onlineHandler: (() => void) | null = null;

  constructor(options: GameControllerOptions) {
    this.presentation = options.presentation;
    this.onUiIntent = options.onUiIntent;
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
   * Resolves empty take/talk ids before submitting.
   */
  handleIntent(intent: PlayerIntent): void {
    if (intent.kind === 'ui') {
      this.onUiIntent?.(intent.ui);
      return;
    }

    const resolved = this.resolveAction(intent.action);
    if (!resolved) return;
    void this.requestTurn(resolved);
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
        entities: snapshot.visible.entities.map((e) => ({ ...e, appearance: { ...e.appearance, tags: [...e.appearance.tags] } })),
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
      const item = this.findTakeTarget();
      if (!item) {
        this.presentation.notify('Nothing here to take.', 'system');
        return null;
      }
      return { verb: 'take', itemId: item.id };
    }
    if (action.verb === 'talk' && action.targetId === '') {
      const target = this.findTalkTarget();
      if (!target) {
        this.presentation.notify('No one to talk to.', 'system');
        return null;
      }
      return { verb: 'talk', targetId: target.id };
    }
    return action;
  }

  private findTakeTarget(): EntityView | null {
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

  private findTalkTarget(): EntityView | null {
    const view = this.state;
    if (!view) return null;
    const { x, y } = view.player;
    const candidates = view.visible.entities.filter((e) => {
      if (!e.talkable) return false;
      const dx = Math.abs(e.x - x);
      const dy = Math.abs(e.y - y);
      // Adjacent (including diagonals), not the same tile as self-identity issues.
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
      if (!agentName) {
        this.presentation.notify('Dialogue target has no agent.', 'system');
        continue;
      }
      this.presentation.openDialogue({ entityId, displayName, agentName });
    }
  }

  /** Append a local-only log line (e.g. from presentation.notify). */
  appendLocalLog(text: string, tone: LogLine['tone'] = 'system'): void {
    if (!this.state) {
      // Allow notify before boot completes by buffering into a tiny ephemeral log.
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
