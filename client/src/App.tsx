import { useEffect, useState } from 'react';
import { ChatPanel } from './components/ChatPanel';

type HealthStatus = 'checking' | 'ok' | 'down';

export function App() {
  const [health, setHealth] = useState<HealthStatus>('checking');

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch('/api/health');
        if (!cancelled) {
          setHealth(res.ok ? 'ok' : 'down');
        }
      } catch {
        if (!cancelled) {
          setHealth('down');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const statusLabel =
    health === 'checking'
      ? 'checking server…'
      : health === 'ok'
        ? 'llmrpg server online'
        : 'llmrpg server offline';

  return (
    <div className="app">
      <header className="app-header">
        <h1>llmrpg — Phase 0 · Milltown Gate</h1>
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
          <span className="health-label">{statusLabel}</span>
        </div>
      </header>
      <main>
        <ChatPanel />
      </main>
    </div>
  );
}
