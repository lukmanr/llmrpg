import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CanvasTileRenderer,
  CompositeInputSource,
  KeyboardInputSource,
  PointerInputSource,
} from '@llmrpg/eal-roguelike-web';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root not found');
}

/**
 * Adapter + input are plain TS objects owned outside React.
 * `isCaptured` is flipped by App so map keys/clicks are ignored (and hover
 * highlights cleared) while a modal or overlay is open.
 */
const captured = { current: false };
const renderer = new CanvasTileRenderer();
const keyboard = new KeyboardInputSource(() => captured.current);
const pointer = new PointerInputSource(
  renderer,
  () => renderer.getCanvas(),
  () => captured.current,
);
const input = new CompositeInputSource(keyboard, pointer);

createRoot(root).render(
  <StrictMode>
    <App renderer={renderer} input={input} capturedRef={captured} />
  </StrictMode>,
);
