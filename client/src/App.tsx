import { useCallback, useEffect, useRef, useState } from 'react';
import type { PresentationChannel, WorldView } from '@llmrpg/eal-core';
import type { CanvasGlyphRenderer, KeyboardInputSource } from '@llmrpg/eal-roguelike-web';
import type { Journal, ReceiptView } from '@llmrpg/shared';
import { GameController, type ConnectionState } from './game/GameController';
import { CharacterCreation } from './components/CharacterCreation';
import { DialogueModal, type DialogueTarget } from './components/DialogueModal';
import { JournalDrawer, type JournalTab } from './components/JournalDrawer';
import { MessageLog } from './components/MessageLog';
import { PlayerPanel } from './components/PlayerPanel';
import {
  ReceiptsToast,
  type ToastReceipt,
} from './components/ReceiptsToast';
import { getCharacter, getJournal } from './lib/gameClient';

type HealthStatus = 'checking' | 'ok' | 'down';
type CharacterGate = 'loading' | 'needs-create' | 'ready';

export interface AppProps {
  renderer: CanvasGlyphRenderer;
  input: KeyboardInputSource;
  /** Mutable flag read by KeyboardInputSource.isCaptured. */
  capturedRef: { current: boolean };
}

let toastSeq = 0;

export function App({ renderer, input, capturedRef }: AppProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<GameController | null>(null);

  const [health, setHealth] = useState<HealthStatus>('checking');
  const [characterGate, setCharacterGate] = useState<CharacterGate>('loading');
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<WorldView | null>(null);
  const [dialogue, setDialogue] = useState<DialogueTarget | null>(null);
  const [journalOpen, setJournalOpen] = useState(false);
  const [journalTab, setJournalTab] = useState<JournalTab>('chronicle');
  const [inventoryHighlight, setInventoryHighlight] = useState(false);
  const [localReceipts, setLocalReceipts] = useState<ReceiptView[]>([]);
  const [toastReceipts, setToastReceipts] = useState<ToastReceipt[]>([]);
  const [journalRefreshKey, setJournalRefreshKey] = useState(0);
  const [activeVows, setActiveVows] = useState(0);

  const creationOpen = characterGate === 'needs-create';
  capturedRef.current = creationOpen || dialogue !== null || journalOpen;

  const closeDialogue = useCallback(() => {
    setDialogue(null);
  }, []);

  const closeJournal = useCallback(() => {
    setJournalOpen(false);
  }, []);

  const openJournalThreads = useCallback(() => {
    setJournalTab('threads');
    setJournalOpen(true);
    setDialogue(null);
  }, []);

  const dismissToast = useCallback((toastId: string) => {
    setToastReceipts((prev) => prev.filter((t) => t.toastId !== toastId));
  }, []);

  const onJournalLoaded = useCallback((journal: Journal) => {
    setActiveVows(journal.vows.filter((v) => v.status === 'active').length);
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

  // Character gate: block game boot until character exists.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const character = await getCharacter();
        if (cancelled) return;
        if (character.created) {
          try {
            const journal = await getJournal();
            if (!cancelled) {
              setActiveVows(journal.vows.filter((v) => v.status === 'active').length);
            }
          } catch {
            // Journal may be empty or unavailable; vows count updates on open.
          }
          setCharacterGate('ready');
        } else {
          setCharacterGate('needs-create');
        }
      } catch {
        // Server route may not exist yet during parallel work; allow game boot.
        if (!cancelled) setCharacterGate('ready');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (characterGate !== 'ready') return;

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
      onReceipts: (receipts) => {
        setLocalReceipts((prev) => {
          const byId = new Map(prev.map((r) => [r.id, r]));
          for (const r of receipts) byId.set(r.id, r);
          return [...byId.values()];
        });
        setToastReceipts((prev) => [
          ...prev,
          ...receipts.map((r) => {
            toastSeq += 1;
            return { ...r, toastId: `toast-${toastSeq}` };
          }),
        ]);
        setJournalRefreshKey((k) => k + 1);
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
  }, [characterGate, input, renderer, syncFromController]);

  const statusLabel =
    health === 'checking'
      ? 'checking server…'
      : health === 'ok'
        ? 'llmrpg server online'
        : 'llmrpg server offline';

  const onRetry = (): void => {
    void controllerRef.current?.retry();
  };

  const onCharacterCreated = (name: string, vowCount: number): void => {
    void name;
    setActiveVows(vowCount);
    setCharacterGate('ready');
  };

  return (
    <div className="app game-app">
      <header className="app-header">
        <h1>llmrpg — Phase 2 · Milltown</h1>
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

      {characterGate === 'loading' && (
        <div className="game-status connecting">preparing the road…</div>
      )}

      {characterGate === 'ready' && connection === 'connecting' && !view && (
        <div className="game-status connecting">connecting…</div>
      )}

      {characterGate === 'ready' && connection === 'error' && (
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
            activeVows={activeVows}
            inventoryHighlight={inventoryHighlight}
          />
        )}
      </div>

      <JournalDrawer
        open={journalOpen}
        tab={journalTab}
        log={view?.log ?? []}
        localReceipts={localReceipts}
        refreshKey={journalRefreshKey}
        onTabChange={setJournalTab}
        onClose={closeJournal}
        onJournalLoaded={onJournalLoaded}
      />

      {dialogue && <DialogueModal target={dialogue} onClose={closeDialogue} />}

      {creationOpen && <CharacterCreation onCreated={onCharacterCreated} />}

      <ReceiptsToast
        toasts={toastReceipts}
        onDismiss={dismissToast}
        onOpenThreads={openJournalThreads}
      />
    </div>
  );
}
