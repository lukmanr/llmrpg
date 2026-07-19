import type { PlayerView } from '@llmrpg/shared';
import { gameTime } from '@llmrpg/shared';

export interface PlayerPanelProps {
  player: PlayerView;
  tick: number;
  activeVows?: number;
  inventoryHighlight?: boolean;
}

export function PlayerPanel({
  player,
  tick,
  activeVows = 0,
  inventoryHighlight,
}: PlayerPanelProps) {
  const hpPct =
    player.maxHp > 0 ? Math.max(0, Math.min(100, (player.hp / player.maxHp) * 100)) : 0;
  const { day, phase } = gameTime(tick);

  return (
    <aside className="player-panel">
      <h2 className="panel-title">{player.name}</h2>
      <div className="stat-row">
        <span className="stat-label">HP</span>
        <div className="hp-bar" aria-label={`Health ${player.hp} of ${player.maxHp}`}>
          <div className="hp-fill" style={{ width: `${hpPct}%` }} />
        </div>
        <span className="stat-value">
          {player.hp}/{player.maxHp}
        </span>
      </div>
      <dl className="stat-grid">
        <div>
          <dt>Tick</dt>
          <dd>
            {tick}
            <span className="game-time">
              Day {day} · {phase}
            </span>
          </dd>
        </div>
        <div>
          <dt>Pos</dt>
          <dd>
            {player.x},{player.y}
          </dd>
        </div>
        <div>
          <dt>Vows</dt>
          <dd>{activeVows} active</dd>
        </div>
      </dl>
      <section
        className={inventoryHighlight ? 'inventory inventory-highlight' : 'inventory'}
        aria-label="Inventory"
      >
        <h3>Inventory</h3>
        {player.inventory.length === 0 ? (
          <p className="inventory-empty">Empty</p>
        ) : (
          <ul>
            {player.inventory.map((item) => (
              <li key={item.id}>{item.name}</li>
            ))}
          </ul>
        )}
      </section>
      <p className="key-hint">
        move ←↑↓→ / hjkl · g take · t talk · i inv · J journal · . wait
      </p>
    </aside>
  );
}
