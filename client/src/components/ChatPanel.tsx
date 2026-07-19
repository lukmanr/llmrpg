import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import { executeAgentStream } from '../lib/agentClient';

type MessageRole = 'player' | 'bram' | 'system';

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  /** Distinguishes error / tool system lines for styling. */
  variant?: 'error' | 'tool';
}

let nextId = 0;
function newId(prefix: string): string {
  nextId += 1;
  return `${prefix}-${nextId}`;
}

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [inFlight, setInFlight] = useState(false);
  const [thinking, setThinking] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const disposeRef = useRef<(() => void) | null>(null);
  const pendingBramIdRef = useRef<string | null>(null);
  const toolMsgIdsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  useEffect(() => {
    return () => {
      disposeRef.current?.();
    };
  }, []);

  const send = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed || inFlight) return;

    setInput('');
    setThinking(null);
    toolMsgIdsRef.current = new Map();

    const playerId = newId('player');
    const bramId = newId('bram');
    pendingBramIdRef.current = bramId;

    setMessages((prev) => [
      ...prev,
      { id: playerId, role: 'player', content: trimmed },
      { id: bramId, role: 'bram', content: '' },
    ]);
    setInFlight(true);

    const dispose = executeAgentStream(trimmed, {
      onThinking: (message) => {
        setThinking(message);
      },
      onPartial: (content, isIncremental) => {
        setThinking(null);
        const id = pendingBramIdRef.current;
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
            const bramId = pendingBramIdRef.current;
            const idx = bramId ? prev.findIndex((m) => m.id === bramId) : -1;
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
        const id = pendingBramIdRef.current;
        if (id) {
          setMessages((prev) =>
            prev.map((m) => (m.id === id ? { ...m, content: response } : m)),
          );
        }
        pendingBramIdRef.current = null;
        disposeRef.current = null;
        setInFlight(false);
      },
      onError: (error) => {
        setThinking(null);
        const bramId = pendingBramIdRef.current;
        setMessages((prev) => {
          const withoutEmptyBram = bramId
            ? prev.filter((m) => !(m.id === bramId && m.content === ''))
            : prev;
          return [
            ...withoutEmptyBram,
            {
              id: newId('error'),
              role: 'system',
              variant: 'error',
              content: error,
            },
          ];
        });
        pendingBramIdRef.current = null;
        disposeRef.current = null;
        setInFlight(false);
      },
    });

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

  return (
    <section className="chat-panel">
      <div className="transcript" aria-live="polite">
        {messages.length === 0 && (
          <p className="empty-hint">
            Speak to Bram the Gatekeeper. He watches the Milltown road.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={[
              'message',
              `message-${m.role}`,
              m.variant ? `message-${m.variant}` : '',
              m.role === 'bram' && !m.content ? 'message-pending' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {m.role === 'player' && <span className="speaker">You</span>}
            {m.role === 'bram' && <span className="speaker">Bram</span>}
            <div className="message-body">
              {m.content || (m.role === 'bram' ? '…' : '')}
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
          placeholder={inFlight ? 'Bram is speaking…' : 'Say something…'}
          disabled={inFlight}
          rows={2}
          aria-label="Message to Bram"
        />
        <button type="submit" disabled={inFlight || !input.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
