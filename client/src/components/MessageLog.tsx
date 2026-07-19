import { useEffect, useRef } from 'react';
import type { LogLine } from '@llmrpg/shared';

export interface MessageLogProps {
  lines: readonly LogLine[];
}

export function MessageLog({ lines }: MessageLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  return (
    <section className="message-log" aria-label="Message log">
      <div className="message-log-scroll">
        {lines.length === 0 && (
          <p className="log-empty">The mill wheel turns. The road waits.</p>
        )}
        {lines.map((line, i) => (
          <div key={`${line.tick}-${i}-${line.text.slice(0, 12)}`} className={`log-line tone-${line.tone}`}>
            <span className="log-tick">t{line.tick}</span>
            <span className="log-text">{line.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
