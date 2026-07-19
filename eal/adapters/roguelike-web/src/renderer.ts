import type { Camera, Renderer, WorldView } from '@llmrpg/eal-core';
import type { EntityView, Terrain } from '@llmrpg/shared';
import {
  defaultAppearanceMapper,
  paintTerrain,
  PALETTE,
  type TerrainVisibility,
  type TileVisual,
} from './tiles.js';

const CELL_CSS_PX = 34;

/** Draw order within the entity pass: items → structures → creatures/NPCs → player. */
const DRAW_ORDER: Record<EntityView['kind'], number> = {
  item: 0,
  structure: 1,
  creature: 2,
  npc: 2,
  player: 3,
};

export type TileCoord = { x: number; y: number };

/**
 * Canvas tile renderer: painted terrain + emoji sprites.
 * No React; mounts a <canvas> into a host element.
 * Renders on demand (call render()) — no requestAnimationFrame loop.
 */
export class CanvasTileRenderer implements Renderer {
  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lastView: WorldView | null = null;
  private lastCamera: Camera | null = null;
  private cellSize = CELL_CSS_PX;
  private mapper = defaultAppearanceMapper;
  /** World-space origin of the top-left camera cell (for hitTest). */
  private originX = 0;
  private originY = 0;
  private hoverTile: TileCoord | null = null;

  mount(container: unknown): void {
    if (!(container instanceof HTMLElement)) {
      throw new Error('CanvasTileRenderer.mount expects an HTMLElement');
    }
    this.unmount();
    this.container = container;
    const canvas = document.createElement('canvas');
    canvas.className = 'roguelike-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Game map');
    canvas.style.cursor = 'default';
    container.appendChild(canvas);
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2d canvas context');
    }
    this.ctx = ctx;

    this.resizeObserver = new ResizeObserver(() => {
      this.resizeToContainer();
      if (this.lastView && this.lastCamera) {
        this.paint(this.lastView, this.lastCamera);
      }
    });
    this.resizeObserver.observe(container);
    this.resizeToContainer();
  }

  render(view: WorldView, camera: Camera): void {
    this.lastView = view;
    this.lastCamera = { ...camera };
    this.paint(view, camera);
  }

  unmount(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.canvas?.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
    this.canvas = null;
    this.ctx = null;
    this.container = null;
    this.lastView = null;
    this.lastCamera = null;
    this.hoverTile = null;
  }

  /** Inverse of the camera transform; bounds-checked against the map. */
  hitTest(clientX: number, clientY: number): TileCoord | null {
    const canvas = this.canvas;
    const view = this.lastView;
    if (!canvas || !view) return null;

    const rect = canvas.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    if (localX < 0 || localY < 0 || localX >= rect.width || localY >= rect.height) {
      return null;
    }

    const col = Math.floor(localX / this.cellSize);
    const row = Math.floor(localY / this.cellSize);
    const wx = this.originX + col;
    const wy = this.originY + row;
    const { width, height } = view.map;
    if (wx < 0 || wy < 0 || wx >= width || wy >= height) return null;
    return { x: wx, y: wy };
  }

  /** Highlight a tile with a soft amber outline; null clears. Triggers repaint. */
  setHover(tile: TileCoord | null): void {
    const prev = this.hoverTile;
    if (prev?.x === tile?.x && prev?.y === tile?.y) return;
    this.hoverTile = tile ? { ...tile } : null;
    if (this.canvas) {
      this.canvas.style.cursor = tile ? 'pointer' : 'default';
    }
    if (this.lastView && this.lastCamera) {
      this.paint(this.lastView, this.lastCamera);
    }
  }

  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

  private resizeToContainer(): void {
    if (!this.container || !this.canvas || !this.ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, this.container.clientWidth);
    const cssH = Math.max(1, this.container.clientHeight);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(cssH * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cellSize = CELL_CSS_PX;
  }

  private paint(view: WorldView, camera: Camera): void {
    const ctx = this.ctx;
    const canvas = this.canvas;
    const container = this.container;
    if (!ctx || !canvas || !container) return;

    const cssW = container.clientWidth;
    const cssH = container.clientHeight;
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, cssW, cssH);

    const cols = Math.ceil(cssW / this.cellSize) + 1;
    const rows = Math.ceil(cssH / this.cellSize) + 1;
    this.originX = camera.centerX - Math.floor(cols / 2);
    this.originY = camera.centerY - Math.floor(rows / 2);
    const originX = this.originX;
    const originY = this.originY;

    const { width, height, explored } = view.map;
    const visibleSet = new Set(view.visible.tileIdx);
    const cell = this.cellSize;

    // 1) Terrain
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const wx = originX + col;
        const wy = originY + row;
        if (wx < 0 || wy < 0 || wx >= width || wy >= height) continue;

        const idx = wy * width + wx;
        const terrain = explored[idx] as Terrain | null | undefined;
        const state = terrainVisibility(terrain ?? null, visibleSet.has(idx));
        paintTerrain(ctx, col * cell, row * cell, cell, terrain ?? null, state);
      }
    }

    // 2) Subtle grid
    ctx.strokeStyle = PALETTE.grid;
    ctx.lineWidth = 1;
    for (let col = 0; col <= cols; col += 1) {
      const x = col * cell + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rows * cell);
      ctx.stroke();
    }
    for (let row = 0; row <= rows; row += 1) {
      const y = row * cell + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(cols * cell, y);
      ctx.stroke();
    }

    // 3–6) Entities by draw order (items → structures → creatures/NPCs → player-in-list)
    const entities = [...view.visible.entities].sort(
      (a, b) => DRAW_ORDER[a.kind] - DRAW_ORDER[b.kind],
    );

    const fontPx = Math.floor(cell * 0.78);
    ctx.font = `${fontPx}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const ent of entities) {
      if (ent.kind === 'player') continue; // drawn last from view.player
      const idx = ent.y * width + ent.x;
      if (!visibleSet.has(idx)) continue;
      const col = ent.x - originX;
      const row = ent.y - originY;
      if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
      const visual = this.mapper.entity(ent.appearance, ent.kind);
      const dead = ent.hp != null && ent.hp <= 0;
      this.drawEntity(ctx, col, row, visual, ent.appearance.archetype, dead);
    }

    // 6) Player on top
    const player = view.player;
    const pCol = player.x - originX;
    const pRow = player.y - originY;
    if (pCol >= 0 && pRow >= 0 && pCol < cols && pRow < rows) {
      const visual = this.mapper.entity({ archetype: 'player', tags: [] }, 'player');
      this.drawEntity(ctx, pCol, pRow, visual, 'player', false);
    }

    // 7) Hover highlight
    if (this.hoverTile) {
      const hCol = this.hoverTile.x - originX;
      const hRow = this.hoverTile.y - originY;
      if (hCol >= 0 && hRow >= 0 && hCol < cols && hRow < rows) {
        this.drawHover(ctx, hCol, hRow);
      }
    }
  }

  private drawEntity(
    ctx: CanvasRenderingContext2D,
    col: number,
    row: number,
    visual: TileVisual,
    archetype: string,
    dead: boolean,
  ): void {
    const cell = this.cellSize;
    const cx = col * cell + cell / 2;
    const cy = row * cell + cell / 2;

    ctx.save();

    if (archetype === 'mill') {
      // Floor-colored plinth under the gear.
      const r = cell * 0.28;
      ctx.fillStyle = PALETTE.floor;
      ctx.beginPath();
      ctx.arc(cx, cy + cell * 0.06, r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (visual.ring) {
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.38, 0, Math.PI * 2);
      ctx.strokeStyle = visual.ring;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    if (!visual.emoji) {
      ctx.restore();
      return;
    }

    const opacity = dead ? 0.4 : (visual.opacity ?? 1);
    ctx.globalAlpha = opacity;

    if (dead) {
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(visual.emoji, 0, 0);
    } else {
      ctx.fillText(visual.emoji, cx, cy);
    }

    ctx.restore();
  }

  private drawHover(ctx: CanvasRenderingContext2D, col: number, row: number): void {
    const cell = this.cellSize;
    const pad = 2;
    const x = col * cell + pad;
    const y = row * cell + pad;
    const size = cell - pad * 2;
    const r = 4;
    ctx.save();
    ctx.strokeStyle = PALETTE.hover;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + size, y, x + size, y + size, r);
    ctx.arcTo(x + size, y + size, x, y + size, r);
    ctx.arcTo(x, y + size, x, y, r);
    ctx.arcTo(x, y, x + size, y, r);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

/** Alias so existing `CanvasGlyphRenderer` imports keep compiling. */
export { CanvasTileRenderer as CanvasGlyphRenderer };

function terrainVisibility(
  terrain: Terrain | null,
  isVisible: boolean,
): TerrainVisibility {
  if (terrain == null) return 'unexplored';
  if (isVisible) return 'visible';
  return 'explored';
}
