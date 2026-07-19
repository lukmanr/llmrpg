import type {
  Appearance,
  EntityView,
  GameAction,
  LogLine,
  MapView,
  PlayerView,
  Terrain,
  VisibleSet,
} from '@llmrpg/shared';

/**
 * Engine Abstraction Layer core interfaces (DESIGN §4).
 *
 * Game logic and narrative systems depend only on these; adapters
 * (eal/adapters/*) implement them for a concrete presentation target.
 * The R1 adapter is a browser roguelike; a future adapter may be 3D.
 */

/** Read-only world queries the presentation layer needs. */
export interface WorldView {
  readonly revision: number;
  readonly tick: number;
  readonly map: MapView;
  readonly visible: VisibleSet;
  readonly player: PlayerView;
  /** Message log lines accumulated this session, oldest first. */
  readonly log: readonly LogLine[];
}

export interface Camera {
  centerX: number;
  centerY: number;
}

/** Purely presentational; holds no game state. */
export interface Renderer {
  mount(container: unknown): void;
  render(view: WorldView, camera: Camera): void;
  unmount(): void;
}

/**
 * Normalized player intents. Key bindings live in the adapter;
 * game logic sees intents, never keys.
 */
export type PlayerIntent =
  | { kind: 'action'; action: GameAction }
  | { kind: 'ui'; ui: 'toggle-journal' | 'toggle-inventory' | 'dismiss' };

export interface InputSource {
  subscribe(handler: (intent: PlayerIntent) => void): () => void;
}

/**
 * Time-step contract (DESIGN §4.1). Phase 1 is turn-based: the world
 * advances when the player acts. `requestTurn` resolves when the
 * simulation has applied the turn and the view can re-render.
 */
export interface Ticker {
  requestTurn(action: GameAction): Promise<void>;
}

/** Non-spatial UI surfaces addressable from game logic. */
export interface PresentationChannel {
  openDialogue(target: { entityId: string; displayName: string; agentName: string }): void;
  closeDialogue(): void;
  notify(text: string, tone?: LogLine['tone']): void;
  openJournal(tab?: 'threads' | 'people' | 'claims' | 'chronicle'): void;
}

/** Optional; no-op in R1. */
export interface AudioSink {
  play(soundTag: string): void;
}

/** Maps appearance descriptors to concrete presentation (glyphs in R1). */
export interface AppearanceMapper<TVisual> {
  entity(appearance: Appearance, kind: EntityView['kind']): TVisual;
  terrain(terrain: Terrain, explored: boolean): TVisual;
}
