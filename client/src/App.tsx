import { useCallback, useEffect, useRef, useState } from 'react';
import type { PresentationChannel, WorldView } from '@llmrpg/eal-core';
import type { CanvasGlyphRenderer, KeyboardInputSource } from '@llmrpg/eal-roguelike-web';
import { GameController, type ConnectionState } from './game/GameController';
import { DialogueModal, type DialogueTarget } from './components/DialogueModal';
import { JournalDrawer, type JournalTab } from './components/JournalDrawer';
import { MessageLog } from './components/MessageLog';
import { PlayerPanel } from './components/PlayerPanel';

type HealthStatus = 'checking' | 'ok' | 'down';

export interface AppProps {
  renderer: CanvasGlyphRenderer;
  input: KeyboardInputSource;
  /** Mutable flag read by KeyboardInputSource.isCaptured. */
  capturedRef: { current: boolean };
}

export function App({ renderer, input, capturedRef }: AppProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<GameController | null>(null);

  const [health, setHealth] = useState<HealthStatus>('checking');
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<WorldView | null>(null);
  const [dialogue, setDialogue] = useState<DialogueTarget | null>(null);
  const [journalOpen, setJournalOpen] = useState(false);
  const [journalTab, setJournalTab] = useState<JournalTab>('chronicle');
  const [inventoryHighlight, setInventoryHighlight] = useState(false);

  capturedRef.current = dialogue !== null || journalOpen;

  const closeDialogue = useCallback(() => {
    setDialogue(null);
  }, []);

  const closeJournal = useCallback(() => {
    setJournalOpen(false);
  }, []);

  const syncFromController = useCallback(() => {
    const c = controllerRef.current;
    if (!c) return;
    setConnection(c.getConnectionState());
    setError(c.getLastError());
    const next = c.getView();
    setView(next);
    if (next) {
      renderer.render(next, {
        centerX: next.player.x,
        centerY: next.player.y,
      });
    }
  }, [renderer]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch('/api/health');
        if (!cancelled) setHealth(res.ok ? 'ok' : 'down');
      } catch {
        if (!cancelled) setHealth('down');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const presentation: PresentationChannel = {
      openDialogue: (target) => {
        setDialogue(target);
        setJournalOpen(false);
      },
      closeDialogue: () => {
        setDialogue(null);
      },
      notify: (text, tone) => {
        controllerRef.current?.appendLocalLog(text, tone ?? 'system');
      },
      openJournal: (tab) => {
        if (tab) setJournalTab(tab);
        setJournalOpen(true);
        setDialogue(null);
      },
    };

    const controller = new GameController({
      presentation,
      onUiIntent: (ui) => {
        if (ui === 'dismiss') {
          setDialogue(null);
          setJournalOpen(false);
          return;
        }
        if (ui === 'toggle-journal') {
          setJournalOpen((open) => {
            if (!open) setDialogue(null);
            return !open;
          });
          return;
        }
        if (ui === 'toggle-inventory') {
          setInventoryHighlight(true);
          window.setTimeout(() => setInventoryHighlight(false), 1200);
          presentation.notify('Inventory listed in the side panel.', 'system');
        }
      },
    });
    controllerRef.current = controller;

    const unsubView = controller.subscribe(syncFromController);
    const unsubInput = input.subscribe((intent) => {
      controller.handleIntent(intent);
    });

    const mountId = window.requestAnimationFrame(() => {
      if (cancelled || !mapRef.current) return;
      renderer.mount(mapRef.current);
      void controller.boot().then(() => {
        if (!cancelled) syncFromController();
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(mountId);
      unsubView();
      unsubInput();
      input.detach();
      renderer.unmount();
      controller.dispose();
      controllerRef.current = null;
    };
  }, [input, renderer, syncFromController]);

  const statusLabel =
    health === 'checking'
      ? 'checking server…'
      : health === 'ok'
        ? 'llmrpg server online'
        : 'llmrpg server offline';

  const onRetry = (): void => {
    void controllerRef.current?.retry();
  };

  return (
    <div className="app game-app">
      <header className="app-header">
        <h1>llmrpg — Phase 1 · Milltown</h1>
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

      {connection === 'connecting' && !view && (
        <div className="game-status connecting">connecting…</div>
      )}

      {connection === 'error' && (
        <div className="game-status error" role="alert">
          <p>{error ?? 'Failed to reach the game server.'}</p>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      <div className="game-layout">
        <div className="game-main">
          <div className="map-container" ref={mapRef} />
          <MessageLog lines={view?.log ?? []} />
        </div>
        {view && (
          <PlayerPanel
            player={view.player}
            tick={view.tick}
            inventoryHighlight={inventoryHighlight}
          />
        )}
      </div>

      <JournalDrawer
        open={journalOpen}
        tab={journalTab}
        log={view?.log ?? []}
        onTabChange={setJournalTab}
        onClose={closeJournal}
      />

      {dialogue && <DialogueModal target={dialogue} onClose={closeDialogue} />}
    </div>
  );
}
