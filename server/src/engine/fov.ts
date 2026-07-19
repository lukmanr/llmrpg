import { TERRAIN_FLAGS, type Terrain } from '@llmrpg/shared';

/**
 * Recursive shadowcasting FOV (8 octants).
 *
 * Phase 1 simplification: only terrain opacity occludes. Blocking entities
 * do NOT occlude line of sight.
 */
export function fov(
  terrain: readonly Terrain[],
  width: number,
  height: number,
  originX: number,
  originY: number,
  radius: number,
): Set<number> {
  const visible = new Set<number>();

  if (
    originX < 0 ||
    originY < 0 ||
    originX >= width ||
    originY >= height ||
    radius < 0
  ) {
    return visible;
  }

  visible.add(originY * width + originX);

  // [xx, xy, yx, yy] — maps octant coords onto the map
  const octants: ReadonlyArray<readonly [number, number, number, number]> = [
    [1, 0, 0, 1],
    [0, 1, 1, 0],
    [0, -1, 1, 0],
    [-1, 0, 0, 1],
    [-1, 0, 0, -1],
    [0, -1, -1, 0],
    [0, 1, -1, 0],
    [1, 0, 0, -1],
  ];

  for (const [xx, xy, yx, yy] of octants) {
    castLight(originX, originY, 1, 1.0, 0.0, radius, xx, xy, yx, yy, terrain, width, height, visible);
  }

  return visible;
}

function opaqueAt(
  terrain: readonly Terrain[],
  width: number,
  height: number,
  x: number,
  y: number,
): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) return true;
  const t = terrain[y * width + x];
  if (t === undefined) return true;
  return TERRAIN_FLAGS[t].opaque;
}

function castLight(
  cx: number,
  cy: number,
  row: number,
  start: number,
  end: number,
  radius: number,
  xx: number,
  xy: number,
  yx: number,
  yy: number,
  terrain: readonly Terrain[],
  width: number,
  height: number,
  visible: Set<number>,
): void {
  if (start < end) return;

  let newStart = 0;
  let blocked = false;

  for (let distance = row; distance <= radius && !blocked; distance++) {
    const dy = -distance;
    for (let dx = -distance; dx <= 0; dx++) {
      const mapX = cx + dx * xx + dy * xy;
      const mapY = cy + dx * yx + dy * yy;

      const leftSlope = (dx - 0.5) / (dy + 0.5);
      const rightSlope = (dx + 0.5) / (dy - 0.5);

      if (start < rightSlope) continue;
      if (end > leftSlope) break;

      const distSq = dx * dx + dy * dy;
      if (distSq <= radius * radius) {
        if (mapX >= 0 && mapY >= 0 && mapX < width && mapY < height) {
          visible.add(mapY * width + mapX);
        }
      }

      if (blocked) {
        if (opaqueAt(terrain, width, height, mapX, mapY)) {
          newStart = rightSlope;
        } else {
          blocked = false;
          start = newStart;
        }
      } else if (opaqueAt(terrain, width, height, mapX, mapY) && distance < radius) {
        blocked = true;
        castLight(
          cx,
          cy,
          distance + 1,
          start,
          leftSlope,
          radius,
          xx,
          xy,
          yx,
          yy,
          terrain,
          width,
          height,
          visible,
        );
        newStart = rightSlope;
      }
    }
  }
}

/** Default perception / FOV radius for Phase 1. */
export const FOV_RADIUS = 9;
