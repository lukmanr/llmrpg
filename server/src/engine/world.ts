import {
  PROTOCOL_VERSION,
  SnapshotSchema,
  type ActionRequest,
  type ActionResponse,
  type EntityKind,
  type EntityView,
  type ExploredPatch,
  type GameEvent,
  type GameEventView,
  type LogLine,
  type PlayerView,
  type Snapshot,
  type Terrain,
  type VisibleSet,
} from '@llmrpg/shared';
import type { GameAction, ReceiptView } from '@llmrpg/shared';
import {
  deserializeComponent,
  isComponentKind,
  serializeComponent,
  type ComponentKind,
} from './components';
import { createWorldDb, defaultWorldDbPath, type WorldDb } from './db';
import { FOV_RADIUS, fov } from './fov';
import { applyAction, type ApplyResult } from './rules';
import { createSeededRng, type Rng } from './rng';
import {
  getComponent,
  type EntityRecord,
  type PlaythroughState,
  type WorldState,
} from './state';
import { MILLTOWN_WORLD_ID, parseMilltown } from '../world/milltown';

export const DEFAULT_PLAYTHROUGH_ID = 'playthrough_default';
export const PLAYER_ENTITY_ID = 'player_you';

/**
 * Post-action turn hook (Phase 2, DESIGN §6): runs after the player's action
 * applies, before the response delta is built. Hooks drive the NPC reflex
 * tier and perception. NPC actions applied through `applyNpcAction` share the
 * player's tick (revision still advances per action); their events join the
 * turn's event list automatically, but hooks decide which log lines the
 * player sees (push onto `log`).
 */
export interface TurnHookArgs {
  world: WorldState;
  playthrough: PlaythroughState;
  request: ActionRequest;
  /** All events this turn so far (player's + earlier hooks'). Mutable. */
  events: GameEvent[];
  /** Player-visible log lines. Mutable. */
  log: LogLine[];
  /** Consequence receipts to surface on this turn's response. Mutable. */
  receipts: ReceiptView[];
  applyNpcAction: (npcId: string, action: GameAction) => ApplyResult;
}

export interface WorldTurnHook {
  name: string;
  run(args: TurnHookArgs): void;
}

export interface WorldServiceOptions {
  db?: WorldDb;
  dbPath?: string;
  /** Injectable RNG factory; defaults to seeded-from-playthrough-id. */
  rngForPlaythrough?: (playthroughId: string) => Rng;
  now?: () => Date;
  newId?: () => string;
  /** Post-action hooks, run in order (reflex, perception, promises, ...). */
  turnHooks?: WorldTurnHook[];
}

/**
 * World service: SQLite-backed single source of truth, Milltown bootstrap,
 * playthrough create-or-resume, snapshots, and action handling.
 */
export class WorldService {
  readonly db: WorldDb;
  private readonly rngForPlaythrough: (playthroughId: string) => Rng;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private turnHooks: WorldTurnHook[];

  constructor(options: WorldServiceOptions = {}) {
    this.db =
      options.db ??
      createWorldDb(options.dbPath ?? defaultWorldDbPath());
    this.rngForPlaythrough =
      options.rngForPlaythrough ?? ((id) => createSeededRng(id));
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.turnHooks = options.turnHooks ?? [];
    this.ensureBootstrapped();
  }

  /** Late hook registration (cognition wires up after construction). */
  setTurnHooks(hooks: WorldTurnHook[]): void {
    this.turnHooks = hooks;
  }

  /** Bootstrap Milltown if the DB has no world meta. */
  ensureBootstrapped(): void {
    const existing = this.db
      .prepare(`SELECT value FROM world_meta WHERE key = 'worldId'`)
      .get() as { value: string } | undefined;
    if (existing) return;

    const locale = parseMilltown();
    const insertMeta = this.db.prepare(
      `INSERT INTO world_meta (key, value) VALUES (?, ?)`,
    );
    const insertEntity = this.db.prepare(
      `INSERT INTO entities (id, kind, name) VALUES (?, ?, ?)`,
    );
    const insertComponent = this.db.prepare(
      `INSERT INTO components (entity_id, kind, data) VALUES (?, ?, ?)`,
    );

    const tx = this.db.transaction(() => {
      insertMeta.run('worldId', MILLTOWN_WORLD_ID);
      insertMeta.run('revision', '0');
      insertMeta.run('tick', '0');
      insertMeta.run('mapWidth', String(locale.width));
      insertMeta.run('mapHeight', String(locale.height));
      insertMeta.run('terrain', JSON.stringify(locale.terrain));

      for (const spawn of locale.spawns) {
        insertEntity.run(spawn.id, spawn.kind, spawn.name);
        for (const [kind, data] of Object.entries(spawn.components)) {
          if (!isComponentKind(kind) || data === undefined) continue;
          insertComponent.run(
            spawn.id,
            kind,
            serializeComponent(kind, data as never),
          );
        }
      }
    });
    tx();
  }

  /** Create-or-resume the single Phase 1 default playthrough. */
  createOrResumePlaythrough(): string {
    const existing = this.db
      .prepare(`SELECT id FROM playthroughs WHERE id = ?`)
      .get(DEFAULT_PLAYTHROUGH_ID) as { id: string } | undefined;
    if (existing) return existing.id;

    const world = this.loadWorldState();
    const locale = parseMilltown();
    const player: EntityRecord = {
      id: PLAYER_ENTITY_ID,
      kind: 'player',
      name: 'You',
      components: new Map(),
    };
    player.components.set('Position', {
      x: locale.playerStart.x,
      y: locale.playerStart.y,
    });
    player.components.set('Appearance', {
      archetype: 'player',
      tags: ['player'],
    });
    player.components.set('Health', { hp: 10, maxHp: 10 });
    player.components.set('Inventory', { itemIds: [] });
    world.entities.set(player.id, player);

    const visible = fov(
      world.terrain,
      world.mapWidth,
      world.mapHeight,
      locale.playerStart.x,
      locale.playerStart.y,
      FOV_RADIUS,
    );
    const explored: Array<Terrain | null> = Array.from(
      { length: world.mapWidth * world.mapHeight },
      () => null,
    );
    for (const idx of visible) {
      const t = world.terrain[idx];
      if (t !== undefined) explored[idx] = t;
    }

    const insertEntity = this.db.prepare(
      `INSERT INTO entities (id, kind, name) VALUES (?, ?, ?)`,
    );
    const insertComponent = this.db.prepare(
      `INSERT INTO components (entity_id, kind, data) VALUES (?, ?, ?)`,
    );
    const insertPlaythrough = this.db.prepare(
      `INSERT INTO playthroughs (id, player_entity_id, explored, log, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );

    const tx = this.db.transaction(() => {
      insertEntity.run(player.id, player.kind, player.name);
      for (const [kind, data] of player.components) {
        insertComponent.run(player.id, kind, serializeComponent(kind, data as never));
      }
      insertPlaythrough.run(
        DEFAULT_PLAYTHROUGH_ID,
        PLAYER_ENTITY_ID,
        JSON.stringify(explored),
        JSON.stringify([]),
        this.now().toISOString(),
      );
    });
    tx();

    return DEFAULT_PLAYTHROUGH_ID;
  }

  buildSnapshot(playthroughId: string): Snapshot {
    const world = this.loadWorldState();
    const playthrough = this.loadPlaythrough(playthroughId);
    const visible = this.computeVisibleSet(world, playthrough.playerEntityId);
    const player = this.buildPlayerView(world, playthrough.playerEntityId);
    const logTail = playthrough.log.slice(-50);

    const snapshot: Snapshot = {
      protocolVersion: PROTOCOL_VERSION,
      worldId: world.worldId,
      playthroughId: playthrough.id,
      revision: world.revision,
      tick: world.tick,
      map: {
        width: world.mapWidth,
        height: world.mapHeight,
        explored: playthrough.explored,
      },
      visible,
      player,
      logTail,
    };
    return SnapshotSchema.parse(snapshot);
  }

  handleAction(playthroughId: string, request: ActionRequest): ActionResponse {
    const cached = this.db
      .prepare(`SELECT response FROM actions_log WHERE action_id = ?`)
      .get(request.actionId) as { response: string } | undefined;
    if (cached) {
      return JSON.parse(cached.response) as ActionResponse;
    }

    const world = this.loadWorldState();
    if (request.revision !== world.revision) {
      return {
        ok: false,
        revision: world.revision,
        error: {
          code: 'stale_revision',
          message: `Client revision ${request.revision} is stale; world is at ${world.revision}.`,
        },
      };
    }

    const playthrough = this.loadPlaythrough(playthroughId);
    const exploredBefore = [...playthrough.explored];

    const result = applyAction(world, playthrough, request.action, {
      actionId: request.actionId,
      rng: this.rngForPlaythrough(playthroughId),
      now: this.now,
      newId: this.newId,
    });

    if (!result.ok) {
      const response: ActionResponse = {
        ok: false,
        revision: world.revision,
        error: { code: result.code, message: result.message },
      };
      // Rejections are not persisted / do not consume actionId (client may retry).
      return response;
    }

    // Turn pipeline (Phase 2): reflex, perception, promises, receipts.
    const turnEvents: GameEvent[] = [...result.events];
    const turnLog: LogLine[] = [...result.log];
    const turnReceipts: ReceiptView[] = [];
    let npcActionSeq = 0;
    const hookArgs: TurnHookArgs = {
      world,
      playthrough,
      request,
      events: turnEvents,
      log: turnLog,
      receipts: turnReceipts,
      applyNpcAction: (npcId, action) => {
        const r = applyAction(world, playthrough, action, {
          actionId: `${request.actionId}:npc:${npcId}:${npcActionSeq++}`,
          rng: this.rngForPlaythrough(playthroughId),
          now: this.now,
          newId: this.newId,
          actorEntityId: npcId,
          advanceTick: false,
        });
        if (r.ok) {
          turnEvents.push(...r.events);
        }
        return r;
      },
    };
    for (const hook of this.turnHooks) {
      hook.run(hookArgs);
    }

    const playerPos = getComponent(
      world.entities.get(playthrough.playerEntityId)!,
      'Position',
    )!;
    const visibleIdx = fov(
      world.terrain,
      world.mapWidth,
      world.mapHeight,
      playerPos.x,
      playerPos.y,
      FOV_RADIUS,
    );

    const exploredPatch: ExploredPatch[] = [];
    for (const idx of visibleIdx) {
      const t = world.terrain[idx];
      if (t === undefined) continue;
      if (playthrough.explored[idx] === null) {
        playthrough.explored[idx] = t;
        if (exploredBefore[idx] === null) {
          exploredPatch.push({ idx, terrain: t });
        }
      }
    }

    playthrough.log.push(...turnLog);

    const visible = this.computeVisibleSet(world, playthrough.playerEntityId);
    const player = this.buildPlayerView(world, playthrough.playerEntityId);

    // Clients only receive events the player witnessed; all events persist.
    const playerId = playthrough.playerEntityId;
    const witnessedEvents = turnEvents.filter((e) =>
      e.witnessedBy.includes(playerId) || e.actorId === playerId,
    );

    const response: ActionResponse = {
      ok: true,
      revision: world.revision,
      tick: world.tick,
      events: witnessedEvents.map(toEventView),
      log: turnLog,
      delta: {
        visible,
        exploredPatch,
        player,
      },
      ...(turnReceipts.length > 0 ? { receipts: turnReceipts } : {}),
    };

    this.persistAfterAction(world, playthrough, request, response, turnEvents);
    return response;
  }

  private persistAfterAction(
    world: WorldState,
    playthrough: PlaythroughState,
    request: ActionRequest,
    response: ActionResponse,
    events: GameEvent[],
  ): void {
    const upsertMeta = this.db.prepare(
      `INSERT INTO world_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    const deleteComponents = this.db.prepare(
      `DELETE FROM components WHERE entity_id = ?`,
    );
    const deleteEntity = this.db.prepare(`DELETE FROM entities WHERE id = ?`);
    const upsertEntity = this.db.prepare(
      `INSERT INTO entities (id, kind, name) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, name = excluded.name`,
    );
    const insertComponent = this.db.prepare(
      `INSERT INTO components (entity_id, kind, data) VALUES (?, ?, ?)`,
    );
    const insertEvent = this.db.prepare(
      `INSERT INTO events (
        id, world_id, tick, revision, verb, actor_id, target_ids, data,
        caused_by, witnessed_by, narrative_tags, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updatePlaythrough = this.db.prepare(
      `UPDATE playthroughs SET explored = ?, log = ? WHERE id = ?`,
    );
    const insertAction = this.db.prepare(
      `INSERT INTO actions_log (action_id, playthrough_id, revision, request, response, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    const dbEntityIds = new Set(
      (
        this.db.prepare(`SELECT id FROM entities`).all() as Array<{ id: string }>
      ).map((r) => r.id),
    );

    const tx = this.db.transaction(() => {
      upsertMeta.run('revision', String(world.revision));
      upsertMeta.run('tick', String(world.tick));

      for (const id of dbEntityIds) {
        if (!world.entities.has(id)) {
          deleteComponents.run(id);
          deleteEntity.run(id);
        }
      }

      for (const entity of world.entities.values()) {
        upsertEntity.run(entity.id, entity.kind, entity.name);
        deleteComponents.run(entity.id);
        for (const [kind, data] of entity.components) {
          insertComponent.run(
            entity.id,
            kind,
            serializeComponent(kind, data as never),
          );
        }
      }

      for (const event of events) {
        insertEvent.run(
          event.id,
          event.worldId,
          event.tick,
          event.revision,
          event.verb,
          event.actorId,
          JSON.stringify(event.targetIds),
          JSON.stringify(event.data),
          JSON.stringify(event.causedBy),
          JSON.stringify(event.witnessedBy),
          JSON.stringify(event.narrativeTags),
          event.createdAt,
        );
      }

      updatePlaythrough.run(
        JSON.stringify(playthrough.explored),
        JSON.stringify(playthrough.log),
        playthrough.id,
      );

      insertAction.run(
        request.actionId,
        playthrough.id,
        world.revision,
        JSON.stringify(request),
        JSON.stringify(response),
        this.now().toISOString(),
      );
    });
    tx();
  }

  loadWorldState(): WorldState {
    const metaRows = this.db
      .prepare(`SELECT key, value FROM world_meta`)
      .all() as Array<{ key: string; value: string }>;
    const meta = new Map(metaRows.map((r) => [r.key, r.value]));

    const worldId = meta.get('worldId');
    const mapWidth = Number(meta.get('mapWidth'));
    const mapHeight = Number(meta.get('mapHeight'));
    const revision = Number(meta.get('revision') ?? '0');
    const tick = Number(meta.get('tick') ?? '0');
    const terrainRaw = meta.get('terrain');
    if (!worldId || !terrainRaw || !Number.isFinite(mapWidth) || !Number.isFinite(mapHeight)) {
      throw new Error('World meta incomplete; bootstrap failed');
    }

    const terrain = JSON.parse(terrainRaw) as Terrain[];
    const entityRows = this.db
      .prepare(`SELECT id, kind, name FROM entities`)
      .all() as Array<{ id: string; kind: string; name: string }>;
    const componentRows = this.db
      .prepare(`SELECT entity_id, kind, data FROM components`)
      .all() as Array<{ entity_id: string; kind: string; data: string }>;

    const entities = new Map<string, EntityRecord>();
    for (const row of entityRows) {
      entities.set(row.id, {
        id: row.id,
        kind: row.kind as EntityKind,
        name: row.name,
        components: new Map(),
      });
    }
    for (const row of componentRows) {
      const entity = entities.get(row.entity_id);
      if (!entity || !isComponentKind(row.kind)) continue;
      const kind: ComponentKind = row.kind;
      entity.components.set(kind, deserializeComponent(kind, row.data));
    }

    return {
      worldId,
      revision,
      tick,
      mapWidth,
      mapHeight,
      terrain,
      entities,
    };
  }

  loadPlaythrough(playthroughId: string): PlaythroughState {
    const row = this.db
      .prepare(
        `SELECT id, player_entity_id, explored, log FROM playthroughs WHERE id = ?`,
      )
      .get(playthroughId) as
      | {
          id: string;
          player_entity_id: string;
          explored: string;
          log: string;
        }
      | undefined;
    if (!row) {
      throw new Error(`Playthrough not found: ${playthroughId}`);
    }
    return {
      id: row.id,
      playerEntityId: row.player_entity_id,
      explored: JSON.parse(row.explored) as Array<Terrain | null>,
      log: JSON.parse(row.log) as LogLine[],
    };
  }

  computeVisibleSet(world: WorldState, playerEntityId: string): VisibleSet {
    const player = world.entities.get(playerEntityId);
    if (!player) throw new Error('Player missing');
    const pos = getComponent(player, 'Position');
    if (!pos) throw new Error('Player has no position');

    const tileIdx = [
      ...fov(
        world.terrain,
        world.mapWidth,
        world.mapHeight,
        pos.x,
        pos.y,
        FOV_RADIUS,
      ),
    ].sort((a, b) => a - b);

    const visibleTiles = new Set(tileIdx);
    const entities: EntityView[] = [];
    for (const e of world.entities.values()) {
      if (e.id === playerEntityId) continue;
      const epos = getComponent(e, 'Position');
      if (!epos) continue;
      const idx = epos.y * world.mapWidth + epos.x;
      if (!visibleTiles.has(idx)) continue;
      entities.push(toEntityView(e));
    }

    return { tileIdx, entities };
  }

  buildPlayerView(world: WorldState, playerEntityId: string): PlayerView {
    const player = world.entities.get(playerEntityId);
    if (!player) throw new Error('Player missing');
    const pos = getComponent(player, 'Position');
    const health = getComponent(player, 'Health');
    const inv = getComponent(player, 'Inventory');
    if (!pos || !health) throw new Error('Player missing Position/Health');

    const inventory = (inv?.itemIds ?? []).map((id) => {
      const item = world.entities.get(id);
      const itemComp = item ? getComponent(item, 'Item') : undefined;
      return {
        id,
        name: item?.name ?? 'unknown',
        kind: itemComp?.kind ?? 'item',
      };
    });

    return {
      id: player.id,
      name: player.name,
      x: pos.x,
      y: pos.y,
      hp: health.hp,
      maxHp: health.maxHp,
      inventory,
    };
  }
}

function toEventView(event: GameEvent): GameEventView {
  return {
    id: event.id,
    tick: event.tick,
    verb: event.verb,
    actorId: event.actorId,
    targetIds: event.targetIds,
    data: event.data,
  };
}

function toEntityView(entity: EntityRecord): EntityView {
  const pos = getComponent(entity, 'Position');
  if (!pos) {
    throw new Error(`Entity ${entity.id} has no position for EntityView`);
  }
  const appearance = getComponent(entity, 'Appearance') ?? {
    archetype: 'unknown',
    tags: [],
  };
  const health = getComponent(entity, 'Health');
  const item = getComponent(entity, 'Item');
  const view: EntityView = {
    id: entity.id,
    kind: entity.kind,
    name: entity.name,
    x: pos.x,
    y: pos.y,
    appearance,
    blocking: getComponent(entity, 'Blocker') !== undefined,
    carryable: item?.carryable ?? false,
    talkable: getComponent(entity, 'Talkable') !== undefined,
  };
  if (health) {
    view.hp = health.hp;
    view.maxHp = health.maxHp;
  }
  return view;
}

export function createWorldService(options?: WorldServiceOptions): WorldService {
  return new WorldService(options);
}
