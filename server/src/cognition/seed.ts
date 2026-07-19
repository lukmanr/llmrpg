import type { CognitionStores } from './api';
import type { Persona } from '../world/personas';

/**
 * Seed the cognition stores from persona content at world bootstrap:
 * relationships and beliefs (with provenance) defined in PERSONAS.
 * Idempotent: skips if any beliefs already exist.
 */
export function seedCognitionFromPersonas(
  stores: CognitionStores,
  personas: Persona[],
): void {
  const already = personas.some((p) => stores.beliefs.forNpc(p.entityId).length > 0);
  if (already) return;

  for (const persona of personas) {
    for (const rel of persona.relationships) {
      stores.relationships.adjust(
        persona.entityId,
        rel.otherEntityId,
        { trust: rel.trust, affection: rel.affection, fear: rel.fear },
        rel.note,
        0,
      );
    }
    for (const belief of persona.seedBeliefs) {
      stores.beliefs.upsert({
        npcId: persona.entityId,
        proposition: belief.proposition,
        aboutEntityIds: belief.aboutEntityIds,
        source: belief.distortionFrom ?? persona.entityId,
        firsthand: belief.firsthand,
        confidence: belief.confidence,
        observedAtTick: 0,
        receivedAtTick: 0,
        distortionHistory: belief.distortionFrom ? [belief.distortionFrom] : [],
      });
    }
  }
}
