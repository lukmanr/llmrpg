import type { InputSource, PlayerIntent } from '@llmrpg/eal-core';

export type IsCapturedFn = () => boolean;

/**
 * Keyboard → PlayerIntent mapping for the R1 roguelike adapter.
 *
 * Context-dependent verbs (`g` take, `t` talk): the EAL PlayerIntent type is
 * fixed to GameAction shapes that require ids. This adapter emits
 * `{ kind:'action', action:{ verb:'take', itemId:'' } }` /
 * `{ verb:'talk', targetId:'' }` with empty ids. The client GameController
 * MUST resolve the concrete target (carryable on/near the player tile, or
 * adjacent talkable) before submitting to the game API.
 */
export class KeyboardInputSource implements InputSource {
  private handlers = new Set<(intent: PlayerIntent) => void>();
  private readonly isCaptured: IsCapturedFn;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private attached = false;

  constructor(isCaptured: IsCapturedFn = () => false) {
    this.isCaptured = isCaptured;
  }

  /** Attach document key listeners. Idempotent. */
  attach(): void {
    if (this.attached) return;
    this.boundKeyDown = (e: KeyboardEvent) => {
      this.onKeyDown(e);
    };
    document.addEventListener('keydown', this.boundKeyDown);
    this.attached = true;
  }

  /** Detach document key listeners. */
  detach(): void {
    if (!this.attached || !this.boundKeyDown) return;
    document.removeEventListener('keydown', this.boundKeyDown);
    this.boundKeyDown = null;
    this.attached = false;
  }

  subscribe(handler: (intent: PlayerIntent) => void): () => void {
    this.handlers.add(handler);
    if (!this.attached) this.attach();
    return () => {
      this.handlers.delete(handler);
      if (this.handlers.size === 0) this.detach();
    };
  }

  private emit(intent: PlayerIntent): void {
    for (const handler of this.handlers) {
      handler(intent);
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (this.isCaptured()) return;

    const target = e.target;
    if (target instanceof HTMLElement) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
    }

    const intent = mapKeyToIntent(e);
    if (!intent) return;
    e.preventDefault();
    this.emit(intent);
  }
}

function move(dx: number, dy: number): PlayerIntent {
  return { kind: 'action', action: { verb: 'move', dx, dy } };
}

function mapKeyToIntent(e: KeyboardEvent): PlayerIntent | null {
  // Shift+J → journal (lowercase j is south-west / move).
  if (e.key === 'J' && e.shiftKey) {
    return { kind: 'ui', ui: 'toggle-journal' };
  }

  switch (e.key) {
    case 'ArrowUp':
    case 'k':
    case 'K':
    case '8':
      return move(0, -1);
    case 'ArrowDown':
    case 'j':
    case '2':
      return move(0, 1);
    case 'ArrowLeft':
    case 'h':
    case 'H':
    case '4':
      return move(-1, 0);
    case 'ArrowRight':
    case 'l':
    case 'L':
    case '6':
      return move(1, 0);
    case 'y':
    case 'Y':
    case '7':
      return move(-1, -1);
    case 'u':
    case 'U':
    case '9':
      return move(1, -1);
    case 'b':
    case 'B':
    case '1':
      return move(-1, 1);
    case 'n':
    case 'N':
    case '3':
      return move(1, 1);
    case '.':
    case '5':
      return { kind: 'action', action: { verb: 'wait' } };
    case 'g':
    case 'G':
      // Empty itemId: controller resolves carryable on/near player tile.
      return { kind: 'action', action: { verb: 'take', itemId: '' } };
    case 't':
    case 'T':
      // Empty targetId: controller resolves adjacent talkable.
      return { kind: 'action', action: { verb: 'talk', targetId: '' } };
    case 'i':
    case 'I':
      return { kind: 'ui', ui: 'toggle-inventory' };
    case 'Escape':
      return { kind: 'ui', ui: 'dismiss' };
    default:
      return null;
  }
}
