import type { PlayerView } from '@llmrpg/shared';

export interface InventoryPopoverProps {
  open: boolean;
  player: PlayerView | null;
}

export function InventoryPopover({ open, player }: InventoryPopoverProps) {
  if (!open || !player) return null;

  return (
    <div
      className="inventory-popover"
      role="dialog"
      aria-label="Inventory"
    >
      <h3>🎒 Inventory</h3>
      {player.inventory.length === 0 ? (
        <p className="inventory-empty">Empty pockets.</p>
      ) : (
        <ul>
          {player.inventory.map((item) => (
            <li key={item.id}>{item.name}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
