import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { DialogueAct, DialogueState, EntityView, LogLine } from '@llmrpg/shared';
import { EARSHOT_RADIUS } from '@llmrpg/shared';
import { archetypeEmoji } from '../lib/archetypes';
import { listenAgentStream } from '../lib/agentClient';
import {
  dialogueStart,
  dialogueState,
  dialogueTurn,
  GameApiError,
} from '../lib/gameClient';

export interface DialogueTarget {
  entityId: string;
  displayName: string;
  agentName?: string;
  archetype?: string;
}

type MessageRole = 'player' | 'npc' | 'system';

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  name?: string;
  emoji?: string;
  variant?: 'error' | 'tool' | 'closing' | 'bark' | 'soft';
  enter?: boolean;
}

const ACT_CHIPS: { act: DialogueAct; label: string; tip: string }[] = [
  { act: 'say', label: 'Say', tip: 'Speak plainly — the default for free text.' },
  { act: 'ask', label: 'Ask', tip: 'Pose a question and press for an answer.' },
  { act: 'accuse', label: 'Accuse', tip: 'Call out wrongdoing — sharp, consequential.' },
  { act: 'bargain', label: 'Bargain', tip: 'Propose a deal or trade of favors.' },
  { act: 'promise', label: 'Promise', tip: 'Commit yourself — promises are remembered.' },
  { act: 'comfort', label: 'Comfort', tip: 'Offer kindness or reassurance.' },
  { act: 'threaten', label: 'Threaten', tip: 'Apply pressure — rapport may suffer.' },
  { act: 'reveal', label: 'Reveal', tip: 'Share something you know.' },
  { act: 'refuse', label: 'Refuse', tip: 'Decline a request firmly.' },
];

const TOOL_PHRASES: Record<string, string> = {
  share_claim: 'shares something worth remembering',
  make_promise: 'makes a promise',
  update_relationship: 'their regard for you shifts',
  memory_search: 'thinks back…',
};

let nextId = 0;
function newId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

function errorMessage(err: unknown): string {
  if (err instanceof GameApiError) return err.body || err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

function meterSlots(
  value: number,
  min: number,
  max: number,
  filled: string,
  empty: string,
): string {
  const clamped = Math.max(min, Math.min(max, value));
  const pct = (clamped - min) / (max - min);
  const slots = 8;
  const n = Math.round(pct * slots);
  return filled.repeat(n) + empty.repeat(slots - n);
}

function toolPhrase(toolName: string): string {
  return TOOL_PHRASES[toolName] ?? toolName.replace(/_/g, ' ');
}

function findEarshotNpc(
  entities: readonly EntityView[],
  player: { x: number; y: number },
): EntityView | null {
  const candidates = entities.filter((e) => {
    if (!e.talkable) return false;
    const d = Math.max(Math.abs(e.x - player.x), Math.abs(e.y - player.y));
    return d <= EARSHOT_RADIUS && d > 0;
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const da = Math.max(Math.abs(a.x - player.x), Math.abs(a.y - player.y));
    const db = Math.max(Math.abs(b.x - player.x), Math.abs(b.y - player.y));
    return da - db;
  });
  return candidates[0] ?? null;
}

function parseBark(line: LogLine): { name: string; text: string } | null {
  // Server format: `Name: "bark text"`
  const match = /^(.+?):\s*"(.+)"\s*$/.exec(line.text);
  if (!match) return null;
  return { name: match[1] ?? '', text: match[2] ?? '' };
}

export interface ChatDockProps {
  /** Face-to-face dialogue opened via talk action / click. */
  faceTarget: DialogueTarget | null;
  onFaceTargetClear: () => void;
  visibleEntities: readonly EntityView[];
  player: { x: number; y: number; name: string } | null;
  /** World log lines — dialogue-tone barks are ingested into the feed. */
  log: readonly LogLine[];
}

/**
 * Always-visible chat dock: hybrid dialogue (DESIGN §7.5), earshot speech,
 * and spontaneous NPC barks.
 */
export function ChatDock({
  faceTarget,
  onFaceTargetClear,
  visibleEntities,
  player,
  log,
}: ChatDockProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [act, setAct] = useState<DialogueAct>('say');
  const [state, setState] = useState<DialogueState | null>(null);
  const [npcEmoji, setNpcEmoji] = useState('🧑');
  const [headerVisible, setHeaderVisible] = useState(false);
  const [starting, setStarting] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const [thinking, setThinking] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const disposeRef = useRef<(() => void) | null>(null);
  const pendingNpcIdRef = useRef<string | null>(null);
  const toolMsgIdsRef = useRef<Map<string, string>>(new Map());
  const farewellPendingRef = useRef(false);
  const dialogueIdRef = useRef<string | null>(null);
  const ingestedBarkKeys = useRef(new Set<string>());
  const activeEntityIdRef = useRef<string | null>(null);
  const npcNameRef = useRef('Someone');
  const npcEmojiRef = useRef('🧑');
  const faceKeyRef = useRef<string | null>(null);
  const entitiesRef = useRef(visibleEntities);
  entitiesRef.current = visibleEntities;

  const live = state !== null && !state.ended;
  const displayName = state?.npcName ?? npcNameRef.current;
  const inputBusy = inFlight || starting;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  useEffect(() => {
    return () => {
      disposeRef.current?.();
    };
  }, []);

  // Ingest spontaneous NPC barks from the world log.
  useEffect(() => {
    for (let i = 0; i < log.length; i += 1) {
      const line = log[i]!;
      if (line.tone !== 'dialogue') continue;
      const key = `${line.tick}:${i}:${line.text}`;
      if (ingestedBarkKeys.current.has(key)) continue;
      ingestedBarkKeys.current.add(key);

      const parsed = parseBark(line);
      if (!parsed) continue;

      // Skip if this looks like our own streamed dialogue (active NPC speaking).
      if (live && state && parsed.name === state.npcName) continue;

      const entity = visibleEntities.find(
        (e) => e.name === parsed.name || e.name.startsWith(parsed.name),
      );
      const emoji = archetypeEmoji(entity?.appearance.archetype ?? 'npc', entity?.kind ?? 'npc');

      setMessages((prev) => [
        ...prev,
        {
          id: newId('bark'),
          role: 'npc',
          variant: 'bark',
          name: parsed.name,
          emoji,
          content: parsed.text,
          enter: true,
        },
      ]);
    }
  }, [log, live, state, visibleEntities]);

  const clearConversationUi = (): void => {
    setHeaderVisible(false);
    setState(null);
    dialogueIdRef.current = null;
    activeEntityIdRef.current = null;
    setAct('say');
    setStarting(false);
    setInFlight(false);
    setThinking(null);
  };

  const beginConversation = async (
    targetId: string,
    title: string,
    emoji: string,
    earshot: boolean,
  ): Promise<boolean> => {
    disposeRef.current?.();
    disposeRef.current = null;
    pendingNpcIdRef.current = null;
    toolMsgIdsRef.current = new Map();
    farewellPendingRef.current = false;
    dialogueIdRef.current = null;
    activeEntityIdRef.current = targetId;
    npcNameRef.current = title;
    npcEmojiRef.current = emoji;
    setNpcEmoji(emoji);
    setAct('say');
    setStarting(true);
    setState(null);
    setHeaderVisible(true);
    setThinking(null);

    try {
      const next = await dialogueStart(targetId, { earshot });
      dialogueIdRef.current = next.dialogueId;
      npcNameRef.current = next.npcName || title;
      npcEmojiRef.current = emoji;
      setState(next);
      setNpcEmoji(emoji);
      setStarting(false);
      setHeaderVisible(true);
      return true;
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: newId('error'),
          role: 'system',
          variant: 'error',
          content: errorMessage(err),
        },
      ]);
      clearConversationUi();
      return false;
    }
  };

  // Face-to-face dialogue from talk action / adjacent click.
  useEffect(() => {
    if (!faceTarget) {
      faceKeyRef.current = null;
      return;
    }
    const key = faceTarget.entityId;
    if (faceKeyRef.current === key && dialogueIdRef.current) return;
    faceKeyRef.current = key;

    let cancelled = false;
    const entity = entitiesRef.current.find((e) => e.id === faceTarget.entityId);
    const emoji = archetypeEmoji(
      faceTarget.archetype ?? entity?.appearance.archetype ?? 'npc',
      'npc',
    );
    void (async () => {
      const ok = await beginConversation(faceTarget.entityId, faceTarget.displayName, emoji, false);
      if (cancelled && ok) {
        // StrictMode remount — leave the newer effect's conversation in charge.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [faceTarget]);

  const pushSoft = (content: string): void => {
    setMessages((prev) => [
      ...prev,
      {
        id: newId('soft'),
        role: 'system',
        variant: 'soft',
        content,
      },
    ]);
  };

  const refreshState = async (): Promise<DialogueState | null> => {
    const dialogueId = dialogueIdRef.current;
    if (!dialogueId) return null;
    try {
      const next = await dialogueState(dialogueId);
      setState(next);
      if (next.ended) {
        if (next.closingLine) {
          setMessages((prev) => {
            const already = prev.some(
              (m) => m.variant === 'closing' && m.content === next.closingLine,
            );
            if (already) return prev;
            return [
              ...prev,
              {
                id: newId('closing'),
                role: 'npc',
                variant: 'closing',
                name: next.npcName,
                emoji: npcEmoji,
                content: next.closingLine ?? '',
              },
            ];
          });
        }
        setHeaderVisible(false);
        window.setTimeout(() => {
          setState(null);
          dialogueIdRef.current = null;
          activeEntityIdRef.current = null;
          onFaceTargetClear();
        }, 220);
      }
      return next;
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: newId('error'),
          role: 'system',
          variant: 'error',
          content: errorMessage(err),
        },
      ]);
      return null;
    }
  };

  const sendInConversation = (text: string, sendAct: DialogueAct): void => {
    const trimmed = text.trim();
    const dialogueId = dialogueIdRef.current;
    if (!trimmed || inFlight || !dialogueId) return;

    const speaker = npcNameRef.current;
    setInput('');
    setThinking(null);
    toolMsgIdsRef.current = new Map();

    const playerId = newId('player');
    const npcId = newId('npc');
    pendingNpcIdRef.current = npcId;

    setMessages((prev) => [
      ...prev,
      { id: playerId, role: 'player', content: trimmed, name: 'You', emoji: '🧑‍🦱' },
      {
        id: npcId,
        role: 'npc',
        content: '',
        name: speaker,
        emoji: npcEmojiRef.current,
      },
    ]);
    setInFlight(true);

    void (async () => {
      try {
        const turn = await dialogueTurn({
          dialogueId,
          act: sendAct,
          text: trimmed,
        });
        setState(turn.state);
        dialogueIdRef.current = turn.state.dialogueId;

        const dispose = listenAgentStream(turn.sseUrl, {
          onThinking: (message) => {
            setThinking(message);
          },
          onPartial: (content, isIncremental) => {
            setThinking(null);
            const id = pendingNpcIdRef.current;
            if (!id) return;
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== id) return m;
                return {
                  ...m,
                  content: isIncremental ? m.content + content : content,
                };
              }),
            );
          },
          onToolCall: (event) => {
            if (event.phase === 'started') {
              const msgId = newId('tool');
              toolMsgIdsRef.current.set(event.id, msgId);
              const phrase = toolPhrase(event.toolName);
              const toolMsg: ChatMessage = {
                id: msgId,
                role: 'system',
                variant: 'tool',
                content: `✎ ${npcNameRef.current} ${phrase}`,
              };
              setMessages((prev) => {
                const npcMsgId = pendingNpcIdRef.current;
                const idx = npcMsgId ? prev.findIndex((m) => m.id === npcMsgId) : -1;
                if (idx === -1) return [...prev, toolMsg];
                return [...prev.slice(0, idx), toolMsg, ...prev.slice(idx)];
              });
              return;
            }
            // completed — leave the italic note as-is
          },
          onCompleted: (response) => {
            setThinking(null);
            const id = pendingNpcIdRef.current;
            if (id) {
              setMessages((prev) =>
                prev.map((m) => (m.id === id ? { ...m, content: response } : m)),
              );
            }
            pendingNpcIdRef.current = null;
            disposeRef.current = null;
            setInFlight(false);

            void (async () => {
              await refreshState();
              if (farewellPendingRef.current) {
                farewellPendingRef.current = false;
                onFaceTargetClear();
              }
            })();
          },
          onError: (error) => {
            setThinking(null);
            const npcIdPending = pendingNpcIdRef.current;
            setMessages((prev) => {
              const withoutEmpty = npcIdPending
                ? prev.filter((m) => !(m.id === npcIdPending && m.content === ''))
                : prev;
              return [
                ...withoutEmpty,
                {
                  id: newId('error'),
                  role: 'system',
                  variant: 'error',
                  content: error,
                },
              ];
            });
            pendingNpcIdRef.current = null;
            disposeRef.current = null;
            farewellPendingRef.current = false;
            setInFlight(false);
            void refreshState();
          },
        });

        disposeRef.current = dispose;
      } catch (err) {
        const npcIdPending = pendingNpcIdRef.current;
        setMessages((prev) => {
          const withoutEmpty = npcIdPending
            ? prev.filter((m) => !(m.id === npcIdPending && m.content === ''))
            : prev;
          return [
            ...withoutEmpty,
            {
              id: newId('error'),
              role: 'system',
              variant: 'error',
              content: errorMessage(err),
            },
          ];
        });
        pendingNpcIdRef.current = null;
        farewellPendingRef.current = false;
        setInFlight(false);
      }
    })();
  };

  const sendEarshot = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed || inputBusy || !player) return;

    const npc = findEarshotNpc(visibleEntities, player);
    if (!npc) {
      setInput('');
      pushSoft('No one is close enough to hear you.');
      return;
    }

    setInput('');
    const emoji = archetypeEmoji(npc.appearance.archetype, npc.kind);
    void (async () => {
      const ok = await beginConversation(npc.id, npc.name, emoji, true);
      if (!ok) return;
      // Small delay so state/dialogueId settle before turn.
      sendInConversation(trimmed, 'say');
    })();
  };

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (live) {
      sendInConversation(input, act === 'farewell' ? 'say' : act);
    } else {
      sendEarshot(input);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (live) {
        sendInConversation(input, act === 'farewell' ? 'say' : act);
      } else {
        sendEarshot(input);
      }
    }
  };

  const onFarewell = (): void => {
    if (!live || inputBusy) return;
    farewellPendingRef.current = true;
    sendInConversation('Farewell.', 'farewell');
  };

  const patience = state?.patience ?? 100;
  const rapport = state?.rapport ?? 0;
  const showHeader = headerVisible && state !== null && !state.ended;

  return (
    <aside className="chat-dock" aria-label="Chat">
      <header className="chat-dock-title">
        <span className="chat-dock-title-icon" aria-hidden>
          💬
        </span>
        <h2>Chat</h2>
        <span className="chat-dock-subtitle">Folk of Milltown</span>
      </header>

      <div
        className={['chat-active-chip', showHeader ? 'visible' : 'hidden'].join(' ')}
        aria-live="polite"
      >
        {state && !state.ended && (
          <>
            <span className="chat-active-avatar" aria-hidden>
              {npcEmoji}
            </span>
            <div className="chat-active-meta">
              <strong>{state.npcName}</strong>
              <div className="chat-meters" aria-label="Conversation standing">
                <span className="chat-meter patience" title={`Patience ${Math.round(patience)}`}>
                  <span className="meter-label">Patience</span>
                  <span className="meter-glyphs" aria-hidden>
                    {meterSlots(patience, 0, 100, '◆', '◇')}
                  </span>
                </span>
                <span className="chat-meter rapport" title={`Rapport ${Math.round(rapport)}`}>
                  <span className="meter-label">Rapport</span>
                  <span className="meter-glyphs" aria-hidden>
                    {meterSlots(rapport, -100, 100, '●', '○')}
                  </span>
                </span>
              </div>
            </div>
            <button
              type="button"
              className="chat-end-btn"
              onClick={onFarewell}
              disabled={inputBusy}
              aria-label="End conversation"
              title="Farewell"
            >
              ✕
            </button>
          </>
        )}
      </div>

      <div className="chat-feed" aria-live="polite">
        {messages.length === 0 && (
          <p className="chat-empty-hint">
            Type anytime — folk nearby will answer. Or walk up and talk face to face.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={[
              'chat-bubble',
              `chat-bubble-${m.role}`,
              m.variant ? `chat-bubble-${m.variant}` : '',
              m.role === 'npc' && !m.content ? 'chat-bubble-pending' : '',
              m.enter ? 'chat-bubble-enter' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {m.role === 'npc' && (
              <div className="chat-bubble-head">
                <span className="chat-avatar" aria-hidden>
                  {m.emoji ?? npcEmoji}
                </span>
                <span className="chat-speaker">{m.name ?? displayName}</span>
              </div>
            )}
            {m.role === 'player' && (
              <div className="chat-bubble-head chat-bubble-head-player">
                <span className="chat-speaker">You</span>
              </div>
            )}
            <div className="chat-bubble-body">
              {m.variant === 'tool' ? (
                <em>{m.content}</em>
              ) : (
                m.content || (m.role === 'npc' ? '…' : '')
              )}
            </div>
          </div>
        ))}
        {thinking && <p className="chat-thinking">{thinking}</p>}
        <div ref={bottomRef} />
      </div>

      {live && (
        <div className="act-bar" role="group" aria-label="Dialogue act">
          {ACT_CHIPS.map((chip) => (
            <button
              key={chip.act}
              type="button"
              className={act === chip.act ? 'act-chip selected' : 'act-chip'}
              disabled={inputBusy}
              title={chip.tip}
              onClick={() => setAct(chip.act)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      <form className="chat-composer" onSubmit={onSubmit}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            inFlight
              ? `${displayName} is speaking…`
              : starting
                ? 'Starting…'
                : live
                  ? `Say something… (${ACT_CHIPS.find((c) => c.act === act)?.label ?? 'Say'})`
                  : 'Say something…'
          }
          disabled={inputBusy}
          rows={2}
          aria-label={live ? `Message to ${displayName}` : 'Say something to folk nearby'}
        />
        <button type="submit" className="btn-primary chat-send" disabled={inputBusy || !input.trim()}>
          Send
        </button>
      </form>
    </aside>
  );
}
