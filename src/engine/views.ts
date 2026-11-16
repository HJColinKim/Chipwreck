/*
 * Read-only derivations for the UI. Everything here is a question about a state the
 * engine has already produced — none of it changes a hand — so it is kept apart from
 * the reducer: a new on-screen fact belongs here, not in the rules.
 */
import { DEAL_HINT, STREETS, player } from './core.ts';
import { potTotal } from './pots.ts';
import type { Hand, LegalMoves, Street, TableState } from '../types.ts';

/** What the acting player is allowed to do right now, or null when it isn't their turn. */
export function legal(s: TableState, id: string): LegalMoves | null {
  const h = s.hand;
  if (!h || h.street === 'showdown' || h.toAct !== id) return null;
  const p = player(s, id)!;
  const mine = h.bets[id] || 0;
  const toCall = Math.max(0, h.currentBet - mine);
  const maxTo = mine + p.stack;
  const minTo = Math.min(maxTo, h.currentBet + h.minRaise);
  return {
    toCall: Math.min(toCall, p.stack),
    canCheck: toCall === 0,
    canRaise: maxTo > h.currentBet && (p.stack > toCall),
    minTo,
    maxTo,
    mine,
    isBet: h.currentBet === 0,
    pot: potTotal(h),
    currentBet: h.currentBet,
  };
}

/**
 * Community cards face up on the felt. Showdown keeps the full five: an all-in runout
 * jumps straight there with the board still to be dealt, and the cards stay out while
 * hands are compared.
 */
export function boardCount(street: Street): number {
  return street === 'preflop' ? 0 : street === 'flop' ? 3 : street === 'turn' ? 4 : 5;
}

const POSITION_NAMES: Record<string, string> = {
  BTN: 'on the button', SB: 'in the small blind', BB: 'in the big blind',
  CO: 'in the cutoff', HJ: 'in the hijack', UTG: 'under the gun',
};
/**
 * Prose completing "You're ___", so a player is told where they are in words they would
 * use themselves. The preposition belongs to the position — you are *on* the button but
 * *under* the gun — so it is carried here rather than assembled by the caller.
 */
export function positionName(code: string): string {
  return POSITION_NAMES[code] || (code.startsWith('UTG+') ? 'under the gun +' + code.slice(4) : code);
}

/**
 * Position code per seat, by the usual convention of counting round from the button.
 *
 * Heads-up is the odd one out and matches what reduce() already does: the button posts the
 * small blind, so there is no separate BTN seat. Short tables simply run out of names —
 * the hijack only exists from six seats up, and everything between the blinds and the
 * cutoff is UTG, UTG+1 and so on.
 */
export function positions(h: Hand): Record<string, string> {
  const seats = h.seats, n = seats.length;
  const b = seats.indexOf(h.buttonId);
  const out: Record<string, string> = {};
  if (b < 0) return out;
  const at = (o: number): string => seats[(b + o) % n];
  if (n === 2) { out[at(0)] = 'SB'; out[at(1)] = 'BB'; return out; }
  out[at(0)] = 'BTN'; out[at(1)] = 'SB'; out[at(2)] = 'BB';
  for (let o = 3; o < n; o++) {
    out[at(o)] = o === n - 1 ? 'CO' : n >= 6 && o === n - 2 ? 'HJ' : o === 3 ? 'UTG' : 'UTG+' + (o - 3);
  }
  return out;
}

/**
 * How many players still owe an action after `id` before this betting round closes,
 * assuming nobody raises again. -1 when the question does not apply.
 *
 * "Seats behind you" is a different and wrong question. A bet or raise clears h.acted
 * (see the raise branch of act()), so after a re-raise the players who still owe an action
 * sit on both sides of you in seat order — a static slice of the ring undercounts a 3-bet
 * and overcounts a street someone has already closed. Walking from whoever is on the clock
 * with the same predicate advance() uses keeps this honest by construction: the engine
 * decides who is next, and this only counts.
 */
export function toActAfter(h: Hand, id: string): number {
  if (!h.toAct) return -1; // showdown: nobody is on the clock
  const from = h.seats.indexOf(h.toAct);
  if (from < 0) return -1;
  const order = h.seats.slice(from).concat(h.seats.slice(0, from));
  const i = order.indexOf(id);
  if (i < 0) return -1;
  const owes = (x: string): boolean =>
    !h.folded[x] && !h.allIn[x] && (!h.acted[x] || (h.bets[x] || 0) < h.currentBet);
  return order.slice(i + 1).filter(owes).length;
}

/** Just enough of a hand to tell whether the table moved on. */
export type StreetPos = Pick<Hand, 'no' | 'street'>;
export interface StreetChange { street: Street; hint: string }

/**
 * What to announce when new state arrives, or null to stay quiet.
 *
 * A street closes as a side effect of the last bet (see advance()), never as a step of its
 * own, so clients only ever receive the state *after* the change. There is no event to
 * listen for — the move has to be spotted by comparing what was on screen with what just
 * arrived, which is why this takes a before and an after rather than one hand.
 *
 * Silent in five cases, each of which would otherwise mislead:
 *   prev === null   a device that joined mid-hand would be told to deal a street already down
 *   different hand  a new deal is its own event, not a street closing
 *   same street     somebody just called; the round is still open
 *   backwards       undo rewound the hand
 *   showdown        the showdown modal already says what to do
 */
export function streetChange(prev: StreetPos | null, next: StreetPos | null): StreetChange | null {
  if (!prev || !next || prev.no !== next.no) return null;
  if (next.street === 'showdown') return null;
  if (STREETS.indexOf(next.street) <= STREETS.indexOf(prev.street)) return null;
  return { street: next.street, hint: DEAL_HINT[next.street] };
}
