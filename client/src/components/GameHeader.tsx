import type { PlayerView } from '@llmrpg/shared';
import { gameTime } from '@llmrpg/shared';

export type HealthStatus = 'checking' | 'ok' | 'down';

export interface GameHeaderProps {
  player: PlayerView | null;
  tick: number;
  activeVows: number;
  health: HealthStatus;
  onOpenJournal: () => void;
}

function heartRow(hp: number, maxHp: number): string {
  const slots = Math.max(1, Math.min(10, maxHp));
  const filled = Math.max(0, Math.min(slots, Math.round((hp / Math.max(1, maxHp)) * slots)));
  return '❤️'.repeat(filled) + '🖤'.repeat(slots - filled);
}

export function GameHeader({
  player,
  tick,
  activeVows,
  health,
  onOpenJournal,
}: GameHeaderProps) {
  const { day, phase } = gameTime(tick);
  const statusLabel =
    health === 'checking'
      ? 'checking server…'
      : health === 'ok'
        ? 'online'
        : 'offline';

  return (
    <header className="game-header">
      <div className="game-header-brand">
        <span className="brand-mark" aria-hidden>
          🏰
        </span>
        <div className="brand-text">
          <h1>llmrpg</h1>
          <p className="brand-place">
            Milltown · Day {day}, {phase}
            {tick > 0 && <span className="tick-meta"> · t{tick}</span>}
          </p>
        </div>
      </div>

      <div className="game-header-stats">
        {player && (
          <>
            <div
              className="stat-pill hp-pill"
              title={`${player.hp} / ${player.maxHp} health`}
              aria-label={`Health ${player.hp} of ${player.maxHp}`}
            >
              <span className="stat-pill-label">{player.name}</span>
              <span className="hearts" aria-hidden>
                {heartRow(player.hp, player.maxHp)}
              </span>
            </div>
            <div className="stat-pill vows-pill" title="Active vows">
              <span aria-hidden>⭐</span>
              <span>
                {activeVows} vow{activeVows === 1 ? '' : 's'}
              </span>
            </div>
          </>
        )}
        <button type="button" className="btn-secondary journal-header-btn" onClick={onOpenJournal}>
          📖 Journal
        </button>
        <div className="health" title={statusLabel}>
          <span
            className={[
              'health-dot',
              health === 'ok' ? 'health-ok' : '',
              health === 'down' ? 'health-down' : '',
              health === 'checking' ? 'health-checking' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-hidden
          />
        </div>
      </div>
    </header>
  );
}
