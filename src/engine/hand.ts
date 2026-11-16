/*
 * Hand lifecycle: dealing a hand, moving the action round the table, closing a street
 * and paying the pots out. The betting actions themselves live in betting.ts, which
 * calls advance() once an action has been applied.
 *
 * The `!` assertions below all rest on the same invariant: once a hand exists, every id
 * in hand.seats is a player at the table, and a hand only starts with >= 2 of them.
 */
import { DEAL_HINT, STREETS, cap, eligible, fail, log, nameOf, nextIn, player } from './core.ts';
import { computePots, potTotal } from './pots.ts';
import type { Hand, Pot, TableState, Win } from '../types.ts';

/** Moves `amt` — or the rest of their stack, whichever is smaller — into the hand. */
export function post(s: TableState, h: Hand, id: string, amt: number): number {
  const p = player(s, id)!;
  const a = Math.min(p.stack, amt);
  p.stack -= a;
  h.bets[id] = (h.bets[id] || 0) + a;
  h.committed[id] = (h.committed[id] || 0) + a;
  if (p.stack === 0) h.allIn[id] = true;
  return a;
}

export function canAct(h: Hand, id: string): boolean { return !h.folded[id] && !h.allIn[id]; }

export function startHand(s: TableState): void {
  if (s.hand) fail('A hand is already in progress');
  const elig = eligible(s);
  if (elig.length < 2) fail('Need at least 2 players with chips to deal');
  const order = s.players.map((p) => p.id);
  const isElig = (id: string): boolean => elig.some((p) => p.id === id);
  let btn = s.buttonId;
  if (!btn || !isElig(btn)) btn = nextIn(order, btn || order[order.length - 1], isElig);
  const button = btn!;
  const seats = order.filter(isElig);
  let sbId: string, bbId: string, firstToAct: string;
  if (seats.length === 2) {
    sbId = button;
    bbId = nextIn(seats, button, () => true)!;
    firstToAct = sbId;
  } else {
    sbId = nextIn(seats, button, () => true)!;
    bbId = nextIn(seats, sbId, () => true)!;
    firstToAct = nextIn(seats, bbId, () => true)!;
  }
  s.handNo += 1;
  s.buttonId = button;
  const h: Hand = {
    no: s.handNo,
    street: 'preflop',
    seats,
    buttonId: button,
    sbId,
    bbId,
    bets: {},
    committed: {},
    folded: {},
    allIn: {},
    acted: {},
    last: {},
    currentBet: 0,
    minRaise: s.settings.bb,
    toAct: null,
  };
  s.hand = h;
  s.lastResult = null;
  const sbAmt = post(s, h, sbId, s.settings.sb);
  const bbAmt = post(s, h, bbId, s.settings.bb);
  h.last[sbId] = 'Small blind';
  h.last[bbId] = 'Big blind';
  h.currentBet = s.settings.bb; // a short blind still means others call the full big blind
  log(s, `Hand #${h.no}: ${nameOf(s, button)} has the button. Blinds ${sbAmt}/${bbAmt}.`);
  h.toAct = firstToAct;
  // if first-to-act can't act, let advance() find the right player
  advance(s, firstToAct, true);
}

export function advance(s: TableState, lastId: string, initial?: boolean): void {
  const h = s.hand!;
  const live = h.seats.filter((id) => !h.folded[id]);
  if (live.length === 1) return winUncontested(s, live[0]);
  const actors = live.filter((id) => canAct(h, id));
  const needs = (id: string): boolean => canAct(h, id) && (!h.acted[id] || (h.bets[id] || 0) < h.currentBet);
  let roundDone: boolean;
  if (actors.length === 0) roundDone = true;
  else if (actors.length === 1 && (h.bets[actors[0]] || 0) >= h.currentBet) roundDone = true;
  else roundDone = actors.every((id) => !needs(id));

  if (!roundDone) {
    if (initial && needs(lastId)) { h.toAct = lastId; return; }
    h.toAct = nextIn(h.seats, lastId, needs);
    return;
  }
  // close the street
  h.bets = {};
  h.acted = {};
  h.last = {};
  h.currentBet = 0;
  h.minRaise = s.settings.bb;
  const idx = STREETS.indexOf(h.street);
  const runout = actors.length <= 1;
  if (h.street === 'river' || runout) {
    h.runout = runout && h.street !== 'river';
    h.street = 'showdown';
    h.toAct = null;
    h.pots = computePots(h);
    log(s, runout ? 'All in — run out the board, then show hands.' : 'Showdown — show hands.');
    // auto-award pots with a single eligible player (uncalled chips)
    autoAwardSingles(s);
    return;
  }
  h.street = STREETS[idx + 1];
  log(s, `${cap(h.street)}. ${DEAL_HINT[h.street]}.`);
  h.toAct = nextIn(h.seats, h.buttonId, (id) => canAct(h, id));
  // in case button isn't in seats order (can't happen) fall back
  if (!h.toAct) h.toAct = actors[0];
}

function autoAwardSingles(s: TableState): void {
  const h = s.hand!;
  const keep: Pot[] = [];
  for (const pot of h.pots!) {
    if (pot.eligible.length === 1) {
      player(s, pot.eligible[0])!.stack += pot.amount;
      log(s, `${nameOf(s, pot.eligible[0])} takes back ${pot.amount} uncalled.`);
    } else keep.push(pot);
  }
  h.pots = keep;
  if (keep.length === 0) finishHand(s, []);
}

function winUncontested(s: TableState, id: string): void {
  const h = s.hand!;
  const amt = potTotal(h);
  player(s, id)!.stack += amt;
  log(s, `${nameOf(s, id)} wins ${amt} (everyone else folded).`);
  finishHand(s, [{ id, amount: amt }]);
}

function finishHand(s: TableState, wins: Win[]): void {
  const h = s.hand!;
  s.lastResult = { handNo: h.no, wins };
  s.hand = null;
  // move button for the next hand
  const order = s.players.map((p) => p.id);
  const nextBtn = nextIn(order, h.buttonId, (id) => {
    const p = player(s, id);
    return !!p && p.stack > 0 && !p.sittingOut;
  });
  s.buttonId = nextBtn || h.buttonId;
}

export function award(s: TableState, winnersPerPot: string[][]): void {
  const h = s.hand;
  if (!h || h.street !== 'showdown') fail('Nothing to award yet');
  const pots = h.pots!;
  if (!Array.isArray(winnersPerPot) || winnersPerPot.length !== pots.length) fail('Pick a winner for every pot');
  const totals: Record<string, number> = {};
  pots.forEach((pot, i) => {
    const ws = (winnersPerPot[i] || []).filter((id) => pot.eligible.includes(id));
    if (!ws.length) fail(`Pick a winner for ${pots.length > 1 ? (i === 0 ? 'the main pot' : 'side pot ' + i) : 'the pot'}`);
    // odd chips go to the first winner left of the button
    const ordered: string[] = [];
    let cur: string | null = h.buttonId;
    for (let k = 0; k < h.seats.length; k++) {
      cur = nextIn(h.seats, cur, () => true);
      if (cur !== null && ws.includes(cur) && !ordered.includes(cur)) ordered.push(cur);
    }
    const share = Math.floor(pot.amount / ordered.length);
    let rem = pot.amount - share * ordered.length;
    for (const id of ordered) {
      const amt = share + (rem > 0 ? 1 : 0);
      if (rem > 0) rem--;
      totals[id] = (totals[id] || 0) + amt;
    }
  });
  const wins: Win[] = Object.entries(totals).map(([id, amount]) => {
    player(s, id)!.stack += amount;
    return { id, amount };
  });
  log(s, wins.map((w) => `${nameOf(s, w.id)} wins ${w.amount}`).join(', ') + '.');
  finishHand(s, wins);
}
