/*
 * Shared primitives for the engine: street order, coercion, table lookups and the
 * table log. Nothing here changes a hand — it is the vocabulary the rest of the
 * engine is written in.
 */
import type { Player, Street, TableState } from '../types.ts';

export const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];
export const DEAL_HINT: Record<Street, string> = {
  preflop: 'Deal two cards to each player',
  flop: 'Burn one, deal the flop (3 cards)',
  turn: 'Burn one, deal the turn (1 card)',
  river: 'Burn one, deal the river (1 card)',
  showdown: 'Show hands and pick the winner',
};
const LOG_MAX = 40;

export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
/**
 * Returns `never` so that `if (!x) fail(...)` narrows x for the rest of the scope.
 * The explicit annotation on the const is required for that narrowing to apply.
 */
export const fail: (msg: string) => never = (msg) => { throw new Error(msg); };

export function int(n: unknown): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? v : NaN;
}

export function cap(w: string): string { return w.charAt(0).toUpperCase() + w.slice(1); }

export const player = (s: TableState, id: string): Player | undefined => s.players.find((p) => p.id === id);
export const eligible = (s: TableState): Player[] => s.players.filter((p) => p.stack > 0 && !p.sittingOut);
export const isHost = (s: TableState, id: string): boolean => id === s.hostId || id === '*';
export const nameOf = (s: TableState, id: string): string => (player(s, id) || { name: '?' }).name;

export function log(s: TableState, msg: string): void {
  s.log.push(msg);
  if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
}

// next id after `fromId` in `order` (cyclic) that passes `pred`
export function nextIn(order: string[], fromId: string | null, pred: (id: string) => boolean): string | null {
  const n = order.length;
  const i = fromId === null ? -1 : order.indexOf(fromId);
  for (let k = 1; k <= n; k++) {
    const id = order[(i + k + n) % n];
    if (pred(id)) return id;
  }
  return null;
}
