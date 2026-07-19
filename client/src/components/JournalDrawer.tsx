import { useEffect, useMemo, useState } from 'react';
import type { Journal, LogLine, ReceiptView } from '@llmrpg/shared';
import { gameTime } from '@llmrpg/shared';
import { getJournal, GameApiError } from '../lib/gameClient';

export type JournalTab = 'threads' | 'people' | 'claims' | 'chronicle';

export interface JournalDrawerProps {
  open: boolean;
  tab: JournalTab;
  log: readonly LogLine[];
  /** Client-accumulated receipts (merged with journal fetch). */
  localReceipts?: readonly ReceiptView[];
  /** Bump to refetch journal (e.g. after new receipts). */
  refreshKey?: number;
  onTabChange: (tab: JournalTab) => void;
  onClose: () => void;
  onJournalLoaded?: (journal: Journal) => void;
}

const TABS: { id: JournalTab; label: string }[] = [
  { id: 'threads', label: 'Threads' },
  { id: 'people', label: 'People' },
  { id: 'claims', label: 'Claims' },
  { id: 'chronicle', label: 'Chronicle' },
];

function formatDayPhase(tick: number): string {
  const { day, phase } = gameTime(tick);
  return `day ${day}, ${phase}`;
}

function formatDeadline(tick: number): string {
  const { day, phase } = gameTime(tick);
  return `by ${phase}, day ${day}`;
}

function claimSource(firsthand: boolean, sourceName: string): string {
  return firsthand ? 'saw it themselves' : `per ${sourceName}, secondhand`;
}

function statusClass(status: string): string {
  return `status-chip status-${status}`;
}

export function JournalDrawer({
  open,
  tab,
  log,
  localReceipts = [],
  refreshKey = 0,
  onTabChange,
  onClose,
  onJournalLoaded,
}: JournalDrawerProps) {
  const [journal, setJournal] = useState<Journal | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimFilter, setClaimFilter] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const data = await getJournal();
        if (cancelled) return;
        setJournal(data);
        onJournalLoaded?.(data);
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof GameApiError
            ? err.body || err.message
            : err instanceof Error
              ? err.message
              : String(err);
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, refreshKey, onJournalLoaded]);

  const receipts = useMemo(() => {
    const byId = new Map<string, ReceiptView>();
    for (const r of journal?.receipts ?? []) byId.set(r.id, r);
    for (const r of localReceipts) byId.set(r.id, r);
    return [...byId.values()].sort((a, b) => b.tick - a.tick);
  }, [journal, localReceipts]);

  const filteredClaims = useMemo(() => {
    const claims = journal?.claims ?? [];
    const q = claimFilter.trim().toLowerCase();
    if (!q) return claims;
    return claims.filter(
      (c) =>
        c.proposition.toLowerCase().includes(q) ||
        c.sourceName.toLowerCase().includes(q),
    );
  }, [journal, claimFilter]);

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
        {loading && <p className="journal-loading">Reading the ledger…</p>}
        {error && !loading && (
          <p className="journal-error" role="alert">
            {error}
          </p>
        )}

        {!loading && tab === 'threads' && (
          <div className="journal-section">
            <h3 className="journal-section-title">Vows</h3>
            {(journal?.vows.length ?? 0) === 0 ? (
              <p className="journal-empty">No vows sworn.</p>
            ) : (
              <ul className="journal-list">
                {journal!.vows.map((vow) => (
                  <li key={vow.id} className="journal-card">
                    <div className="journal-card-head">
                      <span className={statusClass(vow.status)}>{vow.status}</span>
                      <span className="journal-meta">t{vow.createdAtTick}</span>
                    </div>
                    <p className="journal-card-body">{vow.text}</p>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="journal-section-title">Promises</h3>
            {(journal?.promises.length ?? 0) === 0 ? (
              <p className="journal-empty">No promises held.</p>
            ) : (
              <ul className="journal-list">
                {journal!.promises.map((p) => (
                  <li key={p.id} className="journal-card">
                    <div className="journal-card-head">
                      <span className={statusClass(p.status)}>{p.status}</span>
                      {p.deadlineTick !== null && (
                        <span className="journal-meta">{formatDeadline(p.deadlineTick)}</span>
                      )}
                    </div>
                    <p className="journal-card-body">{p.terms}</p>
                    <p className="journal-meta">
                      {p.fromName} → {p.toName}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="journal-section-title">Receipts</h3>
            {receipts.length === 0 ? (
              <p className="journal-empty">No consequences recorded yet.</p>
            ) : (
              <ul className="journal-list receipts-feed">
                {receipts.map((r) => (
                  <li key={r.id} className="journal-card receipt-card">
                    <span className="journal-meta">
                      t{r.tick} · {formatDayPhase(r.tick)}
                    </span>
                    <p className="journal-card-body">
                      <span className="receipt-prefix">◈ Because of you —</span> {r.text}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!loading && tab === 'people' && (
          <div className="journal-section">
            {(journal?.people.length ?? 0) === 0 ? (
              <p className="journal-empty">No one written down yet.</p>
            ) : (
              <ul className="journal-list">
                {journal!.people.map((person) => (
                  <li key={person.entityId} className="journal-card person-card">
                    <div className="journal-card-head">
                      <strong className="person-name">{person.name}</strong>
                      <span className="journal-meta">{person.archetype}</span>
                    </div>
                    <p className="person-disposition">{person.disposition}</p>
                    <p className="journal-meta">
                      first met{' '}
                      {person.firstMetTick !== null
                        ? formatDayPhase(person.firstMetTick)
                        : '—'}
                      {' · '}
                      last seen{' '}
                      {person.lastSeenTick !== null
                        ? formatDayPhase(person.lastSeenTick)
                        : '—'}
                    </p>
                    {person.claims.length > 0 && (
                      <ul className="person-claims">
                        {person.claims.map((c) => (
                          <li key={c.id}>
                            <span className="claim-prop">{c.proposition}</span>
                            <span className="journal-meta">
                              {claimSource(c.firsthand, c.sourceName)} · t{c.atTick}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!loading && tab === 'claims' && (
          <div className="journal-section">
            <input
              type="search"
              className="claims-filter"
              value={claimFilter}
              onChange={(e) => setClaimFilter(e.target.value)}
              placeholder="Filter claims…"
              aria-label="Filter claims"
            />
            {filteredClaims.length === 0 ? (
              <p className="journal-empty">
                {claimFilter.trim() ? 'No claims match.' : 'No claims collected.'}
              </p>
            ) : (
              <ul className="journal-list">
                {filteredClaims.map((c) => (
                  <li key={c.id} className="journal-card">
                    <p className="journal-card-body">{c.proposition}</p>
                    <p className="journal-meta">
                      {claimSource(c.firsthand, c.sourceName)} · t{c.atTick}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'chronicle' && (
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
        )}
      </div>
    </aside>
  );
}
