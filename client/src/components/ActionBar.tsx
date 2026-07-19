export interface ActionBarProps {
  canTalk: boolean;
  canTake: boolean;
  inventoryOpen: boolean;
  onTalk: () => void;
  onTake: () => void;
  onWait: () => void;
  onInventory: () => void;
  onJournal: () => void;
}

export function ActionBar({
  canTalk,
  canTake,
  inventoryOpen,
  onTalk,
  onTake,
  onWait,
  onInventory,
  onJournal,
}: ActionBarProps) {
  return (
    <div className="action-bar" role="toolbar" aria-label="Actions">
      <div className="action-bar-buttons">
        <button
          type="button"
          className="action-btn"
          disabled={!canTalk}
          title="Talk to the nearest person beside you"
          onClick={onTalk}
        >
          <span className="action-emoji" aria-hidden>
            {'\u{1F5E8}'}
          </span>
          <span className="action-label">Talk</span>
          <kbd>T</kbd>
        </button>
        <button
          type="button"
          className="action-btn"
          disabled={!canTake}
          title="Pick up an item underfoot or beside you"
          onClick={onTake}
        >
          <span className="action-emoji" aria-hidden>
            {'\u{270B}'}
          </span>
          <span className="action-label">Take</span>
          <kbd>G</kbd>
        </button>
        <button
          type="button"
          className="action-btn"
          title="Wait a moment — the world keeps moving"
          onClick={onWait}
        >
          <span className="action-emoji" aria-hidden>
            {'\u{23F3}'}
          </span>
          <span className="action-label">Wait</span>
          <kbd>.</kbd>
        </button>
        <button
          type="button"
          className={inventoryOpen ? 'action-btn selected' : 'action-btn'}
          title="Peek at what you are carrying"
          onClick={onInventory}
        >
          <span className="action-emoji" aria-hidden>
            {'\u{1F392}'}
          </span>
          <span className="action-label">Inventory</span>
          <kbd>I</kbd>
        </button>
        <button
          type="button"
          className="action-btn"
          title="Open your journal — threads, people, claims"
          onClick={onJournal}
        >
          <span className="action-emoji" aria-hidden>
            {'\u{1F4D6}'}
          </span>
          <span className="action-label">Journal</span>
          <kbd>J</kbd>
        </button>
      </div>
      <p className="action-hint">walk: ← ↑ ↓ → or click</p>
    </div>
  );
}
