import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CanvasGlyphRenderer, KeyboardInputSource } from '@llmrpg/eal-roguelike-web';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root not found');
}

/**
 * Phase 1 bootstrap: adapter + input are plain TS objects owned outside React.
 * `isCaptured` is swapped by App so map keys are ignored while a modal is open.
 */
const captured = { current: false };
const renderer = new CanvasGlyphRenderer();
const input = new KeyboardInputSource(() => captured.current);

createRoot(root).render(
  <StrictMode>
    <App renderer={renderer} input={input} capturedRef={captured} />
  </StrictMode>,
);
