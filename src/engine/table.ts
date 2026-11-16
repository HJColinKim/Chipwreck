/*
 * Table setup: creating a table, validating its settings and seating players.
 * Everything here is about the table between hands — the hand itself lives in hand.ts.
 */
import { int, fail } from './core.ts';
import type { Settings, TableState } from '../types.ts';

const NAME_MAX = 18;

export interface NewTableOptions {
  code: string;
  hostId?: string | null;
  hostName?: string;
  startingStack?: number;
  sb?: number;
  bb?: number;
}

export function validateSettings(st: Settings): void {
  if (!(st.startingStack > 0)) fail('Starting stack must be more than 0');
  if (!(st.sb > 0)) fail('Small blind must be more than 0');
  if (!(st.bb >= st.sb)) fail('Big blind must be at least the small blind');
}

/** Names come straight off a text input on someone's phone, so trim and cap them here. */
export const cleanName = (name: unknown): string => String(name || '').trim().slice(0, NAME_MAX);

export function addPlayer(s: TableState, id: string, name?: string): void {
  s.players.push({
    id,
    name: cleanName(name) || 'Player',
    stack: s.settings.startingStack,
    buyIns: 1,
    sittingOut: false,
  });
}

export function newTable(
  { code, hostId, hostName, startingStack = 1000, sb = 5, bb = 10 }: NewTableOptions,
): TableState {
  if (!code) fail('Missing table code');
  const s: TableState = {
    code,
    version: 0,
    hostId: hostId ?? null,
    settings: { startingStack: int(startingStack), sb: int(sb), bb: int(bb) },
    players: [],
    buttonId: null,
    handNo: 0,
    hand: null,
    lastResult: null,
    log: [],
    history: [],
  };
  validateSettings(s.settings);
  if (hostId) addPlayer(s, hostId, hostName || 'Host');
  s.buttonId = hostId || null;
  return s;
}
