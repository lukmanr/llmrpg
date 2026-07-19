import { describe, expect, it } from 'vitest';
import type { Terrain } from '@llmrpg/shared';
import { FOV_RADIUS, fov } from '../src/engine/fov';

function grid(lines: string[]): { terrain: Terrain[]; width: number; height: number } {
  const height = lines.length;
  const width = lines[0]?.length ?? 0;
  const terrain: Terrain[] = [];
  for (const row of lines) {
    for (const ch of row) {
      if (ch === '#') terrain.push('wall');
      else if (ch === '.') terrain.push('floor');
      else if (ch === 'T') terrain.push('tree');
      else throw new Error(`bad char ${ch}`);
    }
  }
  return { terrain, width, height };
}

describe('fov recursive shadowcasting', () => {
  it('includes the origin', () => {
    const { terrain, width, height } = grid(['...']);
    const visible = fov(terrain, width, height, 1, 0, FOV_RADIUS);
    expect(visible.has(1)).toBe(true);
  });

  it('walls occlude tiles beyond them', () => {
    // Viewer at (0,1), wall at (1,1), floor beyond at (2,1)
    const { terrain, width, height } = grid([
      '.....',
      '.#...',
      '.....',
    ]);
    const visible = fov(terrain, width, height, 0, 1, FOV_RADIUS);
    // Wall itself is visible
    expect(visible.has(1 * width + 1)).toBe(true);
    // Tile directly behind the wall from the origin should be occluded
    expect(visible.has(1 * width + 2)).toBe(false);
  });

  it('respects radius bound', () => {
    const size = 25;
    const lines = Array.from({ length: size }, () => '.'.repeat(size));
    const { terrain, width, height } = grid(lines);
    const ox = 12;
    const oy = 12;
    const radius = 5;
    const visible = fov(terrain, width, height, ox, oy, radius);
    for (const idx of visible) {
      const x = idx % width;
      const y = Math.floor(idx / width);
      const dist2 = (x - ox) * (x - ox) + (y - oy) * (y - oy);
      expect(dist2).toBeLessThanOrEqual(radius * radius);
    }
  });

  it('has rough symmetry: open floor mutual visibility within radius', () => {
    const { terrain, width, height } = grid([
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
    ]);
    const a = { x: 2, y: 2 };
    const b = { x: 5, y: 3 };
    const fromA = fov(terrain, width, height, a.x, a.y, FOV_RADIUS);
    const fromB = fov(terrain, width, height, b.x, b.y, FOV_RADIUS);
    expect(fromA.has(b.y * width + b.x)).toBe(true);
    expect(fromB.has(a.y * width + a.x)).toBe(true);
  });

  it('trees are opaque like walls', () => {
    const { terrain, width, height } = grid([
      '.....',
      '.T...',
      '.....',
    ]);
    const visible = fov(terrain, width, height, 0, 1, FOV_RADIUS);
    expect(visible.has(1 * width + 2)).toBe(false);
  });
});
