import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import type { PresentationChannel, WorldView } from '@llmrpg/eal-core';
import type { CanvasTileRenderer, CompositeInputSource } from '@llmrpg/eal-roguelike-web';
import type { EntityView, Journal, ReceiptView } from '@llmrpg/shared';
import { GameController, type ConnectionState, type HoverInfo } from './game/GameController';
import { ActionBar } from './components/ActionBar';
import { CharacterCreation } from './components/CharacterCreation';
import { ChatDock, type DialogueTarget } from './components/ChatDock';
import { GameHeader, type HealthStatus } from './components/GameHeader';
import { HoverTooltip } from './components/HoverTooltip';
import { InventoryPopover } from './components/InventoryPopover';
import { JournalDrawer, type JournalTab } from './components/JournalDrawer';
import {
  OnboardingCard,
  shouldShowOnboarding,
} from './components/OnboardingCard';
import {
  ReceiptsToast,
  type ToastReceipt,
} from './components/ReceiptsToast';
import { StoryStrip } from './components/StoryStrip';
import { getCharacter, getJournal } from './lib/gameClient';

type CharacterGate = 'loading' | 'needs-create' | 'ready';

export interface AppProps {
  renderer: CanvasTileRenderer;
  input: CompositeInputSource;
  /** Mutable flag read by CompositeInputSource.isCaptured. */
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
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [localReceipts, setLocalReceipts] = useState<ReceiptView[]>([]);
  const [toastReceipts, setToastReceipts] = useState<ToastReceipt[]>([]);
  const [journalRefreshKey, setJournalRefreshKey] = useState(0);
  const [activeVows, setActiveVows] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [hoverEntity, setHoverEntity] = useState<EntityView | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [canTalk, setCanTalk] = useState(false);
  const [canTake, setCanTake] = useState(false);

  const creationOpen = characterGate === 'needs-create';
  capturedRef.current = creationOpen || journalOpen || showOnboarding;

  const closeJournal = useCallback(() => {
    setJournalOpen(false);
  }, []);

  const openJournal = useCallback((tab?: JournalTab) => {
    if (tab) setJournalTab(tab);
    setJournalOpen(true);
  }, []);

  const openJournalThreads = useCallback(() => {
    setJournalTab('threads');
    setJournalOpen(true);
  }, []);

  const dismissToast = useCallback((toastId: string) => {
    setToastReceipts((prev) => prev.filter((t) => t.toastId !== toastId));
  }, []);

  const onJournalLoaded = useCallback((journal: Journal) => {
    setActiveVows(journal.vows.filter((v) => v.status === 'active').length);
  }, []);

  const clearDialogue = useCallback(() => {
    setDialogue(null);
  }, []);

  const syncFromController = useCallback(() => {
    const c = controllerRef.current;
    if (!c) return;
    setConnection(c.getConnectionState());
    setError(c.getLastError());
    const next = c.getView();
    setView(next);
    setCanTalk(c.findTalkTarget() !== null);
    setCanTake(c.findTakeTarget() !== null);
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
            // Journal may be empty; vows update on open.
          }
          setCharacterGate('ready');
          if (shouldShowOnboarding()) setShowOnboarding(true);
        } else {
          setCharacterGate('needs-create');
        }
      } catch {
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
        const entity = controllerRef.current
          ?.getView()
          ?.visible.entities.find((e) => e.id === target.entityId);
        setDialogue({
          entityId: target.entityId,
          displayName: target.displayName,
          agentName: target.agentName,
          archetype: entity?.appearance.archetype,
        });
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
      },
    };

    const onHover = (info: HoverInfo | null): void => {
      setHoverEntity(info?.entity ?? null);
      if (!info) setCursor(null);
    };

    const controller = new GameController({
      presentation,
      renderer,
      onHover,
      onUiIntent: (ui) => {
        if (ui === 'dismiss') {
          setJournalOpen(false);
          setInventoryOpen(false);
          setShowOnboarding(false);
          return;
        }
        if (ui === 'toggle-journal') {
          setJournalOpen((open) => !open);
          return;
        }
        if (ui === 'toggle-inventory') {
          setInventoryOpen((open) => !open);
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
      // PointerInputSource has no isCaptured hook — gate here for modals/onboarding.
      if (capturedRef.current) return;
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
      renderer.unmount();
      controller.dispose();
      controllerRef.current = null;
    };
  }, [characterGate, input, renderer, syncFromController]);

  const onRetry = (): void => {
    void controllerRef.current?.retry();
  };

  const onCharacterCreated = (_name: string, vowCount: number): void => {
    setActiveVows(vowCount);
    setCharacterGate('ready');
    if (shouldShowOnboarding()) setShowOnboarding(true);
  };

  const submitAction = (kind: 'talk' | 'take' | 'wait'): void => {
    const c = controllerRef.current;
    if (!c) return;
    if (kind === 'talk') {
      c.handleIntent({ kind: 'action', action: { verb: 'talk', targetId: '' } });
    } else if (kind === 'take') {
      c.handleIntent({ kind: 'action', action: { verb: 'take', itemId: '' } });
    } else {
      c.handleIntent({ kind: 'action', action: { verb: 'wait' } });
    }
  };

  const onMapMouseMove = (e: MouseEvent<HTMLDivElement>): void => {
    setCursor({ x: e.clientX, y: e.clientY });
  };

  const onMapMouseLeave = (): void => {
    setCursor(null);
    setHoverEntity(null);
    renderer.setHover(null);
  };

  return (
    <div className="app game-app">
      <div className="game-shell">
        <div className="game-column">
          <GameHeader
            player={view?.player ?? null}
            tick={view?.tick ?? 0}
            activeVows={activeVows}
            health={health}
            onOpenJournal={() => openJournal()}
          />

          {characterGate === 'loading' && (
            <div className="game-status connecting">preparing the road…</div>
          )}

          {characterGate === 'ready' && connection === 'connecting' && !view && (
            <div className="game-status connecting">connecting…</div>
          )}

          {characterGate === 'ready' && connection === 'error' && (
            <div className="game-status error" role="alert">
              <p>{error ?? 'Failed to reach the game server.'}</p>
              <button type="button" className="btn-primary" onClick={onRetry}>
                Retry
              </button>
            </div>
          )}

          <div
            className="map-container"
            ref={mapRef}
            onMouseMove={onMapMouseMove}
            onMouseLeave={onMapMouseLeave}
          />

          <StoryStrip lines={view?.log ?? []} />

          <div className="action-bar-row">
            <ActionBar
              canTalk={canTalk}
              canTake={canTake}
              inventoryOpen={inventoryOpen}
              onTalk={() => submitAction('talk')}
              onTake={() => submitAction('take')}
              onWait={() => submitAction('wait')}
              onInventory={() => setInventoryOpen((o) => !o)}
              onJournal={() => openJournal()}
            />
            <InventoryPopover open={inventoryOpen} player={view?.player ?? null} />
          </div>
        </div>

        <ChatDock
          faceTarget={dialogue}
          onFaceTargetClear={clearDialogue}
          visibleEntities={view?.visible.entities ?? []}
          player={
            view
              ? { x: view.player.x, y: view.player.y, name: view.player.name }
              : null
          }
          log={view?.log ?? []}
        />
      </div>

      <HoverTooltip entity={hoverEntity} cursor={cursor} />

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

      {creationOpen && <CharacterCreation onCreated={onCharacterCreated} />}

      {showOnboarding && characterGate === 'ready' && !creationOpen && (
        <OnboardingCard onStart={() => setShowOnboarding(false)} />
      )}

      <ReceiptsToast
        toasts={toastReceipts}
        onDismiss={dismissToast}
        onOpenThreads={openJournalThreads}
      />
    </div>
  );
}
