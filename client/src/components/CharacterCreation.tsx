import { FormEvent, useState } from 'react';
import { createCharacter, GameApiError } from '../lib/gameClient';

const EXAMPLE_VOWS = [
  'I keep my word, whatever it costs.',
  'No one hungry in front of me stays hungry.',
  'I will find who ruined my family.',
] as const;

const MAX_VOWS = 2;

export interface CharacterCreationProps {
  onCreated: (name: string, vowCount: number) => void;
}

export function CharacterCreation({ onCreated }: CharacterCreationProps) {
  const [name, setName] = useState('');
  const [vows, setVows] = useState<string[]>([]);
  const [vowDraft, setVowDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const addVow = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed || vows.length >= MAX_VOWS) return;
    if (vows.includes(trimmed)) return;
    setVows((prev) => [...prev, trimmed]);
    setVowDraft('');
  };

  const removeVow = (index: number): void => {
    setVows((prev) => prev.filter((_, i) => i !== index));
  };

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || submitting) return;

    setSubmitting(true);
    setError(null);
    void (async () => {
      try {
        const state = await createCharacter({
          name: trimmedName,
          vows: vows.slice(0, MAX_VOWS),
        });
        onCreated(state.name ?? trimmedName, vows.length);
      } catch (err) {
        const msg =
          err instanceof GameApiError
            ? err.body || err.message
            : err instanceof Error
              ? err.message
              : String(err);
        setError(msg);
        setSubmitting(false);
      }
    })();
  };

  return (
    <div className="modal-backdrop character-backdrop" role="presentation">
      <div
        className="modal-dialog character-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Create your character"
      >
        <header className="modal-header">
          <h2>🛤️ Who walks the road?</h2>
        </header>
        <form className="character-form" onSubmit={onSubmit}>
          <label className="character-field">
            <span className="character-label">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              autoFocus
              placeholder="Your name"
              disabled={submitting}
              required
            />
          </label>

          <fieldset className="character-vows" disabled={submitting}>
            <legend>Vows <span className="character-hint">(up to {MAX_VOWS})</span></legend>
            <p className="character-vow-intro">
              Commitments the world will challenge. Choose examples or write your own.
            </p>
            <div className="vow-chips" role="group" aria-label="Example vows">
              {EXAMPLE_VOWS.map((example) => {
                const selected = vows.includes(example);
                const full = vows.length >= MAX_VOWS && !selected;
                return (
                  <button
                    key={example}
                    type="button"
                    className={selected ? 'vow-chip selected' : 'vow-chip'}
                    disabled={full}
                    onClick={() => {
                      if (selected) {
                        setVows((prev) => prev.filter((v) => v !== example));
                      } else {
                        addVow(example);
                      }
                    }}
                  >
                    {example}
                  </button>
                );
              })}
            </div>
            <div className="vow-draft-row">
              <input
                type="text"
                value={vowDraft}
                onChange={(e) => setVowDraft(e.target.value)}
                maxLength={200}
                placeholder="Write a vow…"
                disabled={vows.length >= MAX_VOWS}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addVow(vowDraft);
                  }
                }}
              />
              <button
                type="button"
                className="vow-add"
                disabled={vows.length >= MAX_VOWS || !vowDraft.trim()}
                onClick={() => addVow(vowDraft)}
              >
                Add
              </button>
            </div>
            {vows.length > 0 && (
              <ul className="vow-list">
                {vows.map((vow, i) => (
                  <li key={`${vow}-${i}`}>
                    <span>{vow}</span>
                    <button type="button" onClick={() => removeVow(i)} aria-label="Remove vow">
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          {error && (
            <p className="character-error" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="character-submit"
            disabled={submitting || !name.trim()}
          >
            {submitting ? 'Binding…' : 'Enter Milltown'}
          </button>
        </form>
      </div>
    </div>
  );
}
