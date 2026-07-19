import type { Camera, Renderer, WorldView } from '@llmrpg/eal-core';
import type { EntityView, Terrain } from '@llmrpg/shared';
import { defaultAppearanceMapper, PALETTE, type Glyph } from './glyphs.js';

const CELL_CSS_PX = 18;

const DRAW_ORDER: Record<EntityView['kind'], number> = {
  structure: 0,
  item: 1,
  creature: 2,
  npc: 2,
  player: 3,
};

/**
 * Canvas glyph grid renderer. No React; mounts a <canvas> into a host element.
 * Renders on demand (call render()) — no requestAnimationFrame loop.
 */
export class CanvasGlyphRenderer implements Renderer {
  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lastView: WorldView | null = null;
  private lastCamera: Camera | null = null;
  private cellSize = CELL_CSS_PX;
  private mapper = defaultAppearanceMapper;

  mount(container: unknown): void {
    if (!(container instanceof HTMLElement)) {
      throw new Error('CanvasGlyphRenderer.mount expects an HTMLElement');
    }
    this.unmount();
    this.container = container;
    const canvas = document.createElement('canvas');
    canvas.className = 'roguelike-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Game map');
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
    const originX = camera.centerX - Math.floor(cols / 2);
    const originY = camera.centerY - Math.floor(rows / 2);

    const { width, height, explored } = view.map;
    const visibleSet = new Set(view.visible.tileIdx);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.floor(this.cellSize * 0.85)}px ${getComputedStyle(container).fontFamily || 'monospace'}`;

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const wx = originX + col;
        const wy = originY + row;
        if (wx < 0 || wy < 0 || wx >= width || wy >= height) continue;

        const idx = wy * width + wx;
        const terrain = explored[idx];
        if (terrain == null) continue;

        const isVisible = visibleSet.has(idx);
        // explored=true in mapper means "dimmed memory"; visible uses full brightness.
        const glyph = this.mapper.terrain(terrain as Terrain, !isVisible);
        this.drawGlyph(ctx, col, row, glyph);
      }
    }

    const entities = [...view.visible.entities].sort(
      (a, b) => DRAW_ORDER[a.kind] - DRAW_ORDER[b.kind],
    );

    for (const ent of entities) {
      const idx = ent.y * width + ent.x;
      if (!visibleSet.has(idx)) continue;
      const col = ent.x - originX;
      const row = ent.y - originY;
      if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
      const glyph = this.mapper.entity(ent.appearance, ent.kind);
      this.drawGlyph(ctx, col, row, glyph);
    }

    // Player is always drawn on top when within the camera viewport.
    const player = view.player;
    const col = player.x - originX;
    const row = player.y - originY;
    if (col >= 0 && row >= 0 && col < cols && row < rows) {
      const glyph = this.mapper.entity({ archetype: 'player', tags: [] }, 'player');
      this.drawGlyph(ctx, col, row, glyph);
    }
  }

  private drawGlyph(
    ctx: CanvasRenderingContext2D,
    col: number,
    row: number,
    glyph: Glyph,
  ): void {
    const x = col * this.cellSize;
    const y = row * this.cellSize;
    if (glyph.bg) {
      ctx.fillStyle = glyph.bg;
      ctx.fillRect(x, y, this.cellSize, this.cellSize);
    }
    ctx.fillStyle = glyph.fg;
    ctx.fillText(glyph.char, x + this.cellSize / 2, y + this.cellSize / 2 + 0.5);
  }
}
