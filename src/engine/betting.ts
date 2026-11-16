/*
 * The four betting actions. Each validates against the hand as it stands, moves chips,
 * records what the player did for the UI, then hands off to advance() to work out whose
 * turn it is — or whether that action just closed the street.
 */
import { fail, int, isHost, log, nameOf, player } from './core.ts';
import { advance, post } from './hand.ts';
import type { Action, TableState } from '../types.ts';

export type BetAction = Extract<Action, { type: 'fold' | 'check' | 'call' | 'raise' }>;

export function act(s: TableState, a: BetAction): void {
  const h = s.hand;
  if (!h || h.street === 'showdown') fail('No betting right now');
  const id = h.toAct!;
  if (a.by !== id && !isHost(s, a.by)) fail(`It's ${nameOf(s, id)}'s turn`);
  if (a.player && a.player !== id) fail('Turn moved on — try again');
  const p = player(s, id)!;
  const mine = h.bets[id] || 0;
  const toCall = h.currentBet - mine;
  const who = p.name;
  let label = 'Waiting';
  switch (a.type) {
    case 'fold':
      h.folded[id] = true;
      label = 'Folded';
      log(s, `${who} folds.`);
      break;
    case 'check':
      if (toCall > 0) fail(`Can't check — ${toCall} to call`);
      label = 'Checked';
      log(s, `${who} checks.`);
      break;
    case 'call': {
      if (toCall <= 0) fail('Nothing to call — check instead');
      const amt = post(s, h, id, toCall);
      label = 'Called';
      log(s, `${who} calls ${amt}${h.allIn[id] ? ' (all in)' : ''}.`);
      break;
    }
    case 'raise': {
      // a.to = total bet for this street after the action
      const to = int(a.to);
      const maxTo = mine + p.stack;
      if (!(to > h.currentBet)) fail(h.currentBet ? `Raise must be more than ${h.currentBet}` : 'Bet must be more than 0');
      if (to > maxTo) fail(`You only have ${p.stack}`);
      const size = to - h.currentBet;
      const allIn = to === maxTo;
      const minTo = h.currentBet + h.minRaise;
      if (size < h.minRaise && !allIn) fail(`Minimum ${h.currentBet ? 'raise is to' : 'bet is'} ${minTo}`);
      const wasBet = h.currentBet === 0;
      post(s, h, id, to - mine);
      if (size >= h.minRaise) {
        h.minRaise = size;
        h.acted = {};
      }
      h.currentBet = to;
      label = wasBet ? 'Bet' : 'Raised';
      log(s, `${who} ${wasBet ? 'bets' : 'raises to'} ${to}${allIn ? ' (all in)' : ''}.`);
      break;
    }
    default:
      fail('Unknown action');
  }
  h.acted[id] = true;
  if (!h.last) h.last = {};
  h.last[id] = h.allIn[id] ? 'All in' : label;
  advance(s, id);
}
