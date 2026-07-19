import { entityLabel } from '../lib/archetypes';
import type { EntityView } from '@llmrpg/shared';

export interface HoverTooltipProps {
  entity: EntityView | null;
  cursor: { x: number; y: number } | null;
}

export function HoverTooltip({ entity, cursor }: HoverTooltipProps) {
  if (!entity || !cursor) return null;

  return (
    <div
      className="hover-tooltip"
      style={{ left: cursor.x + 14, top: cursor.y + 14 }}
      role="tooltip"
    >
      {entityLabel(entity.name, entity.appearance.archetype, entity.kind)}
    </div>
  );
}
