import { useEffect, useRef, useState } from 'react';
import type { LogLine } from '@llmrpg/shared';

export interface StoryStripProps {
  lines: readonly LogLine[];
}

/** Collapsible world log for info / combat / system tones (dialogue goes to chat). */
export function StoryStrip({ lines }: StoryStripProps) {
  const [open, setOpen] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const worldLines = lines.filter((l) => l.tone !== 'dialogue');

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [worldLines.length, open]);

  return (
    <section className={open ? 'story-strip open' : 'story-strip'} aria-label="Story">
      <button
        type="button"
        className="story-strip-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span aria-hidden>📜</span>
        <span>Story</span>
        <span className="story-strip-count">{worldLines.length}</span>
        <span className="story-strip-chevron" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="story-strip-body">
          {worldLines.length === 0 && (
            <p className="story-empty">The mill wheel turns. The road waits.</p>
          )}
          {worldLines.map((line, i) => (
            <div
              key={`${line.tick}-${i}-${line.text.slice(0, 12)}`}
              className={`log-line tone-${line.tone}`}
            >
              <span className="log-tick">t{line.tick}</span>
              <span className="log-text">{line.text}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </section>
  );
}
