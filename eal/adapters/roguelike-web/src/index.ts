export {
  PALETTE,
  TileAppearanceMapper,
  defaultAppearanceMapper,
  paintTerrain,
  mixToward,
} from './tiles.js';
export type { TileVisual, TerrainVisibility } from './tiles.js';

export { CanvasTileRenderer, CanvasGlyphRenderer } from './renderer.js';
export type { TileCoord } from './renderer.js';

export {
  KeyboardInputSource,
  PointerInputSource,
  CompositeInputSource,
} from './input.js';
export type { IsCapturedFn, PointerHitTarget } from './input.js';

/** @deprecated Re-exports from tiles — prefer TileAppearanceMapper / TileVisual. */
export { GlyphAppearanceMapper } from './glyphs.js';
export type { Glyph } from './glyphs.js';
