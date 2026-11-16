/*
 * What the table means for the person holding this device: whose turn it is, whose card
 * sits in the "me" slot, what each seat should say, and what the PLAY button does with
 * the chips they have staged.
 *
 * Pure functions of (state, ui, device) with no DOM and no module state, so they can be
 * read and tested on their own — the views only lay out what these decide.
 */
import { legal } from '../engine/index.ts';
import { money } from './format.ts';
import type { Device, UiState } from './state.ts';
import type { ActionInput, Player, TableState } from '../types.ts';

export const playerOf = (S: TableState, id: string | null): Player | undefined =>
  S.players.find((p) => p.id === id);
export const nameOf = (S: TableState, id: string | null): string => (playerOf(S, id) || { name: '?' }).name;
export const eligibleCount = (S: TableState): number =>
  S.players.filter((p) => p.stack > 0 && !p.sittingOut).length;
/** One-phone mode acts for everybody, so that device is always the host. */
export const amHost = (S: TableState, me: Device): boolean => me.local || S.hostId === me.id;

/** The player this device may act for right now, or null if it may not act. */
export function actorId(S: TableState, ui: UiState, me: Device): string | null {
  const h = S.hand;
  if (!h || !h.toAct || h.street === 'showdown') return null;
  if (me.local) return h.toAct;
  if (h.toAct === me.id) return h.toAct;
  if (amHost(S, me) && ui.actFor) return h.toAct;
  return null;
}

/** Whose card sits in the "me" slot: you, or on one phone whoever is acting. */
export function viewerId(S: TableState, ui: UiState, me: Device): string | null {
  if (me.local) return (S.hand && S.hand.toAct) || S.buttonId || (S.players[0] && S.players[0].id);
  return actorId(S, ui, me) || me.id;
}

/** Everyone but the viewer, in seat order starting with whoever sits to the viewer's left. */
export function ringFrom(S: TableState, viewer: string | null): Player[] {
  const list = S.players;
  const i = viewer ? list.findIndex((p) => p.id === viewer) : -1;
  return i < 0 ? list.slice() : list.slice(i + 1).concat(list.slice(0, i));
}

/** The line under a player's name: what they did, or why they are not in this hand. */
export function statusOf(S: TableState, p: Player): string {
  const h = S.hand;
  const won = !h && S.lastResult && S.lastResult.wins.some((w) => w.id === p.id);
  const inHand = h && h.seats.includes(p.id);
  if (won) return 'Won the pot';
  if (!inHand) return p.sittingOut ? 'Sitting out' : p.stack === 0 ? 'Busted' : h ? 'Next hand' : 'Ready';
  if (h.folded[p.id]) return 'Folded';
  if (h.allIn[p.id]) return 'All in';
  if (h.toAct === p.id) return 'Thinking…';
  return (h.last && h.last[p.id]) || 'Waiting';
}

/** The last thing that happened, for the line under the felt. */
export function lastLine(S: TableState): string {
  const h = S.hand;
  if (h && h.street === 'showdown' && h.runout) return 'All in. Deal out the rest of the board, then show hands.';
  const l = S.log[S.log.length - 1] || '';
  return l.replace(/\.$/, '');
}

export interface PlayState {
  label: string;
  ok: boolean;
  /** The action to submit, once the staged chips amount to a legal move. */
  action?: ActionInput;
  /** When they are short: the street total to top the stack up to. */
  fill?: number;
}

/**
 * What the PLAY button says and does for the chips currently staged. The label is the
 * whole point: a stack that is short of the call says how much to ADD rather than
 * silently refusing, and one that matches says CALL rather than a bare amount.
 */
export function playState(S: TableState, actor: string | null, staged: number): PlayState {
  const h = S.hand!;
  const L = actor ? legal(S, actor) : null;
  if (!L || staged <= 0) return { label: 'PLAY', ok: false };
  const p = playerOf(S, actor)!;
  const to = L.mine + staged;
  const allIn = staged === p.stack;
  if (allIn) return { label: `PLAY ${money(staged)}`, ok: true, action: to > h.currentBet ? { type: 'raise', to } : { type: 'call' } };
  if (to === h.currentBet && L.toCall > 0) return { label: `CALL ${money(staged)}`, ok: true, action: { type: 'call' } };
  if (to > h.currentBet && to >= L.minTo) return { label: `PLAY ${money(staged)}`, ok: true, action: { type: 'raise', to } };
  if (to < h.currentBet) return { label: `ADD ${money(h.currentBet - to)}`, ok: false, fill: h.currentBet };
  return { label: `ADD ${money(L.minTo - to)}`, ok: false, fill: L.minTo };
}
