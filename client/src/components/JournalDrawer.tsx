import type { LogLine } from '@llmrpg/shared';

export type JournalTab = 'threads' | 'people' | 'claims' | 'chronicle';

export interface JournalDrawerProps {
  open: boolean;
  tab: JournalTab;
  log: readonly LogLine[];
  onTabChange: (tab: JournalTab) => void;
  onClose: () => void;
}

const TABS: { id: JournalTab; label: string }[] = [
  { id: 'threads', label: 'Threads' },
  { id: 'people', label: 'People' },
  { id: 'claims', label: 'Claims' },
  { id: 'chronicle', label: 'Chronicle' },
];

export function JournalDrawer({
  open,
  tab,
  log,
  onTabChange,
  onClose,
}: JournalDrawerProps) {
  if (!open) return null;

  return (
    <aside className="journal-drawer" aria-label="Journal">
      <header className="journal-header">
        <h2>Journal</h2>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close journal">
          Esc
        </button>
      </header>
      <nav className="journal-tabs" aria-label="Journal sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'journal-tab active' : 'journal-tab'}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="journal-body">
        {tab === 'chronicle' ? (
          <ul className="chronicle-list">
            {log.length === 0 && (
              <li className="chronicle-empty">The chronicle is blank. Walk the road.</li>
            )}
            {log.map((line, i) => (
              <li key={`${line.tick}-${i}`} className={`log-line tone-${line.tone}`}>
                <span className="log-tick">t{line.tick}</span>
                <span className="log-text">{line.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="journal-placeholder">Coming in a later phase.</p>
        )}
      </div>
    </aside>
  );
}
