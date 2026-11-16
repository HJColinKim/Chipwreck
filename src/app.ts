/*
 * ChipWreck entry point. Real cards, digital chips.
 *
 * The code is in four layers, each only knowing about the one below it:
 *
 *   src/types.ts      the persisted shapes every layer shares
 *   src/engine/       pure game rules — a reducer over TableState, no DOM, no I/O
 *   src/transport/    sync backends: claude.ai artifact db, MQTT relay, or one phone
 *   src/ui/           screens, state and events (see ui/state.ts and ui/render.ts)
 *
 * All this file does is start the UI. Importing ui/events.ts installs the listeners.
 */
import { boot } from './ui/session.ts';
import './ui/events.ts';

const start = (): void => boot();
// The artifact host reloads the page's script on edit, and wants to drive first paint.
if (window.claude && window.claude.hot && window.claude.hot.ready) window.claude.hot.ready(start);
else start();
