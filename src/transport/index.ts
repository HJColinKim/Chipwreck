/*
 * Sync backends. Each owns one table and implements Backend (see backend.ts):
 *
 *   ClaudeBackend  the page runs as a claude.ai artifact — shared db doc plus room pokes
 *   PeerBackend    hosted anywhere else (GitHub Pages) — the host's phone runs the game
 *                  and public MQTT brokers relay
 *   LocalBackend   one phone for the whole table (pass-and-play), stored in this browser
 *
 * All three run the same pure reducer, so the rules are identical everywhere.
 * This file is the transport layer's public surface; pickBackend() is how the UI gets one.
 */
import { ClaudeBackend } from './claude.ts';
import { PeerBackend } from './peer.ts';
import type { Backend } from './backend.ts';

export { LocalBackend } from './local.ts';
export { rid } from './backend.ts';
export { store } from './storage.ts';
export type { Backend, BackendKind, CreateSettings } from './backend.ts';

/**
 * The backend for wherever this page is running. The artifact host is detected rather
 * than configured, because the same bundle ships to both claude.ai and GitHub Pages.
 * Throws if the artifact host is present but won't identify the user — there is no
 * sensible fallback there, since a claude.ai table is keyed by account.
 */
export async function pickBackend(): Promise<Backend> {
  if (window.claude && typeof window.claude.use === 'function') {
    const db = await window.claude.use('db');
    if (db) {
      const [user, room] = await Promise.all([window.claude.use('user'), window.claude.use('room')]);
      return new ClaudeBackend(db, user, room).init();
    }
  }
  return new PeerBackend().init();
}
