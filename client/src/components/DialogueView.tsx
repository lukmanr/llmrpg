import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { DialogueAct, DialogueState } from '@llmrpg/shared';
import { listenAgentStream } from '../lib/agentClient';
import {
  dialogueStart,
  dialogueState,
  dialogueTurn,
  GameApiError,
} from '../lib/gameClient';

type MessageRole = 'player' | 'npc' | 'system';

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  variant?: 'error' | 'tool' | 'closing';
}

const ACT_CHIPS: { act: DialogueAct; label: string }[] = [
  { act: 'say', label: 'Say' },
  { act: 'ask', label: 'Ask' },
  { act: 'accuse', label: 'Accuse' },
  { act: 'bargain', label: 'Bargain' },
  { act: 'promise', label: 'Promise' },
  { act: 'comfort', label: 'Comfort' },
  { act: 'threaten', label: 'Threaten' },
  { act: 'reveal', label: 'Reveal' },
  { act: 'refuse', label: 'Refuse' },
];

let nextId = 0;
function newId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

function meterGlyphs(value: number, min: number, max: number, filled: string, empty: string): string {
  const clamped = Math.max(min, Math.min(max, value));
  const pct = (clamped - min) / (max - min);
  const slots = 10;
  const n = Math.round(pct * slots);
  return filled.repeat(n) + empty.repeat(slots - n);
}

function errorMessage(err: unknown): string {
  if (err instanceof GameApiError) return err.body || err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

export interface DialogueViewProps {
  targetId: string;
  title: string;
  /** Optional empty-state hint; defaults to a generic prompt. */
  emptyHint?: string;
  /** Called after a farewell turn completes (and stream finishes). */
  onFarewellComplete?: () => void;
}

/**
 * Hybrid dialogue UI (DESIGN §7.5): semantic acts + free text, streamed via
 * GAME_API dialogue turn → SkillShop SSE.
 */
export function DialogueView({
  targetId,
  title,
  emptyHint,
  onFarewellComplete,
}: DialogueViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [act, setAct] = useState<DialogueAct>('say');
  const [state, setState] = useState<DialogueState | null>(null);
  const [starting, setStarting] = useState(true);
  const [inFlight, setInFlight] = useState(false);
  const [thinking, setThinking] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const disposeRef = useRef<(() => void) | null>(null);
  const pendingNpcIdRef = useRef<string | null>(null);
  const toolMsgIdsRef = useRef<Map<string, string>>(new Map());
  const farewellPendingRef = useRef(false);
  const dialogueIdRef = useRef<string | null>(null);

  const displayName = state?.npcName || title;
  const ended = state?.ended === true;
  const inputDisabled = inFlight || ended || starting || !state;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  useEffect(() => {
    return () => {
      disposeRef.current?.();
    };
  }, []);

  // Start dialogue when the target changes.
  useEffect(() => {
    disposeRef.current?.();
    disposeRef.current = null;
    setMessages([]);
    setInput('');
    setAct('say');
    setInFlight(false);
    setThinking(null);
    setStarting(true);
    setState(null);
    pendingNpcIdRef.current = null;
    toolMsgIdsRef.current = new Map();
    farewellPendingRef.current = false;
    dialogueIdRef.current = null;

    let cancelled = false;
    void (async () => {
      try {
        const next = await dialogueStart(targetId);
        if (cancelled) return;
        dialogueIdRef.current = next.dialogueId;
        setState(next);
        setStarting(false);
      } catch (err) {
        if (cancelled) return;
        setMessages([
          {
            id: newId('error'),
            role: 'system',
            variant: 'error',
            content: errorMessage(err),
          },
        ]);
        setStarting(false);
      }
    })();

    return () => {
      cancelled = true;
      disposeRef.current?.();
      disposeRef.current = null;
    };
  }, [targetId]);

  const pushSystemError = (content: string): void => {
    setMessages((prev) => [
      ...prev,
      {
        id: newId('error'),
        role: 'system',
        variant: 'error',
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
      if (next.ended && next.closingLine) {
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
              content: next.closingLine ?? '',
            },
          ];
        });
      }
      return next;
    } catch (err) {
      pushSystemError(errorMessage(err));
      return null;
    }
  };

  const send = (text: string, sendAct: DialogueAct): void => {
    const trimmed = text.trim();
    const dialogueId = dialogueIdRef.current;
    if (!trimmed || inFlight || ended || !dialogueId) return;

    setInput('');
    setThinking(null);
    toolMsgIdsRef.current = new Map();

    const playerId = newId('player');
    const npcId = newId('npc');
    pendingNpcIdRef.current = npcId;

    setMessages((prev) => [
      ...prev,
      { id: playerId, role: 'player', content: trimmed },
      { id: npcId, role: 'npc', content: '' },
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
              const toolMsg: ChatMessage = {
                id: msgId,
                role: 'system',
                variant: 'tool',
                content: `⚙ ${event.toolName} …`,
              };
              setMessages((prev) => {
                const npcMsgId = pendingNpcIdRef.current;
                const idx = npcMsgId ? prev.findIndex((m) => m.id === npcMsgId) : -1;
                if (idx === -1) return [...prev, toolMsg];
                return [...prev.slice(0, idx), toolMsg, ...prev.slice(idx)];
              });
              return;
            }

            const msgId = toolMsgIdsRef.current.get(event.id);
            if (!msgId) return;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId
                  ? { ...m, content: `⚙ ${event.toolName} … → done` }
                  : m,
              ),
            );
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
              const next = await refreshState();
              if (farewellPendingRef.current) {
                farewellPendingRef.current = false;
                onFarewellComplete?.();
              } else if (next?.ended && !next.closingLine && response) {
                // Ended without a separate closing line — keep streamed reply.
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

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    send(input, act === 'farewell' ? 'say' : act);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input, act === 'farewell' ? 'say' : act);
    }
  };

  const onFarewell = (): void => {
    if (inputDisabled) return;
    farewellPendingRef.current = true;
    send('Farewell.', 'farewell');
  };

  const hint =
    emptyHint ?? `Speak to ${displayName}. The road remembers those who listen.`;

  const patience = state?.patience ?? 100;
  const rapport = state?.rapport ?? 0;

  return (
    <section className="chat-panel dialogue-view">
      {state && (
        <div className="dialogue-meters" aria-label="Conversation standing">
          <div className="dialogue-meter patience">
            <span className="meter-label">Patience</span>
            <span className="meter-glyphs" aria-hidden>
              {meterGlyphs(patience, 0, 100, '◆', '◇')}
            </span>
            <span className="meter-value">{Math.round(patience)}</span>
          </div>
          <div className="dialogue-meter rapport">
            <span className="meter-label">Rapport</span>
            <span className="meter-glyphs" aria-hidden>
              {meterGlyphs(rapport, -100, 100, '●', '○')}
            </span>
            <span className="meter-value">{Math.round(rapport)}</span>
          </div>
        </div>
      )}

      <div className="transcript" aria-live="polite">
        {starting && messages.length === 0 && (
          <p className="empty-hint">Opening conversation…</p>
        )}
        {!starting && messages.length === 0 && <p className="empty-hint">{hint}</p>}
        {messages.map((m) => (
          <div
            key={m.id}
            className={[
              'message',
              `message-${m.role}`,
              m.variant ? `message-${m.variant}` : '',
              m.role === 'npc' && !m.content ? 'message-pending' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {m.role === 'player' && <span className="speaker">You</span>}
            {m.role === 'npc' && <span className="speaker">{displayName}</span>}
            <div className="message-body">
              {m.content || (m.role === 'npc' ? '…' : '')}
            </div>
          </div>
        ))}
        {thinking && <p className="thinking-status">{thinking}</p>}
        <div ref={bottomRef} />
      </div>

      {ended ? (
        <p className="dialogue-ended-notice">The conversation has ended. (ESC)</p>
      ) : (
        <>
          <div className="act-bar" role="group" aria-label="Dialogue act">
            {ACT_CHIPS.map((chip) => (
              <button
                key={chip.act}
                type="button"
                className={act === chip.act ? 'act-chip selected' : 'act-chip'}
                disabled={inputDisabled}
                onClick={() => setAct(chip.act)}
              >
                {chip.label}
              </button>
            ))}
            <button
              type="button"
              className="act-farewell"
              disabled={inputDisabled}
              onClick={onFarewell}
            >
              Farewell
            </button>
          </div>
          <form className="composer" onSubmit={onSubmit}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={
                inFlight
                  ? `${displayName} is speaking…`
                  : starting
                    ? 'Starting…'
                    : `Say something… (${ACT_CHIPS.find((c) => c.act === act)?.label ?? 'Say'})`
              }
              disabled={inputDisabled}
              rows={2}
              aria-label={`Message to ${displayName}`}
            />
            <button type="submit" disabled={inputDisabled || !input.trim()}>
              Send
            </button>
          </form>
        </>
      )}
    </section>
  );
}
