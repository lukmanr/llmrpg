import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { executeAgentStream } from '../lib/agentClient';

type MessageRole = 'player' | 'npc' | 'system';

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  variant?: 'error' | 'tool';
}

let nextId = 0;
function newId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

export interface DialogueViewProps {
  agentName: string;
  title: string;
  /** Optional empty-state hint; defaults to a generic prompt. */
  emptyHint?: string;
}

/**
 * Reusable streaming dialogue UI (Phase 0 chat extracted).
 * Used by DialogueModal; parameterized by SkillShop agentName + display title.
 */
export function DialogueView({ agentName, title, emptyHint }: DialogueViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [inFlight, setInFlight] = useState(false);
  const [thinking, setThinking] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const disposeRef = useRef<(() => void) | null>(null);
  const pendingNpcIdRef = useRef<string | null>(null);
  const toolMsgIdsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  useEffect(() => {
    return () => {
      disposeRef.current?.();
    };
  }, []);

  // Reset transcript when the dialogue target changes.
  useEffect(() => {
    disposeRef.current?.();
    disposeRef.current = null;
    setMessages([]);
    setInput('');
    setInFlight(false);
    setThinking(null);
    pendingNpcIdRef.current = null;
    toolMsgIdsRef.current = new Map();
  }, [agentName]);

  const send = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed || inFlight) return;

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

    const dispose = executeAgentStream(
      trimmed,
      {
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
          setInFlight(false);
        },
      },
      agentName,
    );

    disposeRef.current = dispose;
  };

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    send(input);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const hint =
    emptyHint ?? `Speak to ${title}. The road remembers those who listen.`;

  return (
    <section className="chat-panel dialogue-view">
      <div className="transcript" aria-live="polite">
        {messages.length === 0 && <p className="empty-hint">{hint}</p>}
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
            {m.role === 'npc' && <span className="speaker">{title}</span>}
            <div className="message-body">
              {m.content || (m.role === 'npc' ? '…' : '')}
            </div>
          </div>
        ))}
        {thinking && <p className="thinking-status">{thinking}</p>}
        <div ref={bottomRef} />
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={inFlight ? `${title} is speaking…` : 'Say something…'}
          disabled={inFlight}
          rows={2}
          aria-label={`Message to ${title}`}
        />
        <button type="submit" disabled={inFlight || !input.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
