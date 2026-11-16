/*
 * The UI's mutable state, in one place.
 *
 * `ui` is what the player is doing right now (which screen, the chips they have staged,
 * which sheet is open); `live` is the table and the connection it arrives on. Views never
 * reach in here — render() and the event handlers read these and pass values down, so
 * every view stays a function of its arguments.
 */
import { store } from '../transport/index.ts';
import type { Backend, BackendKind } from '../transport/index.ts';
import type { TableState } from '../types.ts';

export interface UiState {
  view: 'lobby' | 'room' | 'table' | 'auto';
  tab: 'join' | 'create';
  code: string; name: string; stack: number; blinds: number;
  err: string; busy: boolean; homeNote: string; addName: string;
  /** data-a of the control whose action is in flight, so only that button shows the spinner. */
  pending: string | null;
  staged: number[]; stageKey: string; confirmFold: boolean; actFor: boolean;
  picks: string[][]; pickKey: string; split: boolean;
  sheet: 'menu' | 'player' | 'add' | null;
  sheetPlayer: string | null; confirmRemove: boolean;
}

export const ui: UiState = {
  view: 'lobby', tab: 'join', code: '', name: store.get('chipstack:name') || '', stack: 1000, blinds: 0,
  err: '', busy: false, homeNote: '', addName: '', pending: null,
  staged: [], stageKey: '', confirmFold: false, actFor: false,
  picks: [], pickKey: '', split: false, sheet: null, sheetPlayer: null, confirmRemove: false,
};

/**
 * Who this device is at the table. Built fresh from the backend on every render, so it
 * is the only thing views need to know about transport: their id, and whether one phone
 * is being passed round (which also makes that device the host).
 */
export interface Device {
  id: string | null;
  kind: BackendKind | null;
  local: boolean;
}

export interface Live {
  /** The backend the open table is on, or null in the lobby. */
  backend: Backend | null;
  /** The shared claude.ai/MQTT backend, connected at boot and reused to join or create. */
  net: Backend | null;
  /*
   * The open table. Declared non-null because every reader runs only once a table
   * exists — render() branches on it first. Making this properly nullable means threading
   * it through ~90 call sites, which belongs with moving rendering to a component tree
   * rather than with this split.
   */
  S: TableState;
  /** Player ids the backend believes are connected; empty when it cannot tell. */
  online: Set<string>;
}

export const NO_TABLE = null as unknown as TableState;

export const live: Live = { backend: null, net: null, S: NO_TABLE, online: new Set() };

export const device = (): Device => {
  const b = live.backend;
  return { id: b ? b.me.id : null, kind: b ? b.kind : null, local: !!b && b.kind === 'local' };
};
