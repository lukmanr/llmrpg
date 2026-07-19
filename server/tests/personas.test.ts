import { TERRAIN_FLAGS } from '@llmrpg/shared';
import { describe, expect, it } from 'vitest';
import { LOCATIONS, parseMilltown } from '../src/world/milltown';
import {
  PERSONAS,
  personaFullSheet,
  personaSummaryFor,
} from '../src/world/personas';

describe('Milltown personas', () => {
  const locale = parseMilltown();
  const spawnIds = new Set(locale.spawns.map((s) => s.id));

  it('exports nine personas covering the Phase 2 cast', () => {
    expect(PERSONAS).toHaveLength(9);
    const ids = PERSONAS.map((p) => p.entityId).sort();
    expect(ids).toEqual(
      [
        'npc_aldous',
        'npc_bram',
        'npc_hobb',
        'npc_maude',
        'npc_osric',
        'npc_petra',
        'npc_serah',
        'npc_tam',
        'npc_wren',
      ].sort(),
    );
  });

  it('every persona entityId exists in parsed Milltown spawns', () => {
    for (const p of PERSONAS) {
      expect(spawnIds.has(p.entityId)).toBe(true);
    }
  });

  it('schedules reference valid passable LOCATIONS', () => {
    const locationCoords = new Set(
      Object.values(LOCATIONS).map((c) => `${c.x},${c.y}`),
    );

    for (const p of PERSONAS) {
      for (const phase of ['morning', 'afternoon', 'evening', 'night'] as const) {
        const slot = p.schedule[phase];
        expect(locationCoords.has(`${slot.x},${slot.y}`)).toBe(true);

        const idx = slot.y * locale.width + slot.x;
        const terrain = locale.terrain[idx];
        expect(terrain).toBeDefined();
        expect(TERRAIN_FLAGS[terrain!].passable).toBe(true);
      }
    }
  });

  it('seedBeliefs reference existing entity ids', () => {
    const known = new Set([
      ...PERSONAS.map((p) => p.entityId),
      ...locale.spawns.map((s) => s.id),
    ]);

    for (const p of PERSONAS) {
      for (const belief of p.seedBeliefs) {
        for (const id of belief.aboutEntityIds) {
          expect(known.has(id)).toBe(true);
        }
        if (belief.distortionFrom) {
          expect(known.has(belief.distortionFrom)).toBe(true);
        }
      }
    }
  });

  it('personaSummaryFor omits secrets; personaFullSheet includes them', () => {
    const summary = personaSummaryFor('npc_maude');
    const full = personaFullSheet('npc_maude');
    expect(summary).toContain('Maude the Baker');
    expect(summary).toContain('Wants:');
    expect(summary).not.toMatch(/secret/i);
    expect(summary).not.toContain('owing Osric');
    expect(full).toContain('Secrets:');
    expect(full).toContain('owing Osric');
    expect(full).toContain('Knowledge boundary:');
  });

  it('Wren holds the firsthand mill meeting belief', () => {
    const wren = PERSONAS.find((p) => p.entityId === 'npc_wren')!;
    expect(wren.seedBeliefs.some((b) => b.firsthand && b.confidence === 0.9)).toBe(
      true,
    );
  });
});
