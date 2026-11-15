/*
 * ChipWreck engine — a pure reducer for Texas Hold'em chip handling.
 * Cards are physical; this only tracks stacks, blinds, bets, pots and turns.
 *
 * reduce(state, action) -> new state (throws Error with a readable message on an illegal action)
 * Every action carries { type, by } where `by` is the acting device's player id.
 *
 * Actions arriving from a backend are unvalidated network input typed as Action at the
 * boundary — the switch below is what actually rejects malformed ones.
 */
import type {
  Action,
  Hand,
  LegalMoves,
  Player,
  Pot,
  Settings,
  Snapshot,
  Street,
  TableState,
  Win,
} from './types.ts';

const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];
const DEAL_HINT: Record<Street, string> = {
  preflop: 'Deal two cards to each player',
  flop: 'Burn one, deal the flop (3 cards)',
  turn: 'Burn one, deal the turn (1 card)',
  river: 'Burn one, deal the river (1 card)',
  showdown: 'Show hands and pick the winner',
};
const HISTORY_MAX = 10;
const LOG_MAX = 40;

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
/**
 * Returns `never` so that `if (!x) fail(...)` narrows x for the rest of the scope.
 * The explicit annotation on the const is required for that narrowing to apply.
 */
const fail: (msg: string) => never = (msg) => { throw new Error(msg); };

interface NewTableOptions {
  code: string;
  hostId?: string | null;
  hostName?: string;
  startingStack?: number;
  sb?: number;
  bb?: number;
}

function newTable({ code, hostId, hostName, startingStack = 1000, sb = 5, bb = 10 }: NewTableOptions): TableState {
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

function int(n: unknown): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? v : NaN;
}

function validateSettings(st: Settings): void {
  if (!(st.startingStack > 0)) fail('Starting stack must be more than 0');
  if (!(st.sb > 0)) fail('Small blind must be more than 0');
  if (!(st.bb >= st.sb)) fail('Big blind must be at least the small blind');
}

function addPlayer(s: TableState, id: string, name?: string): void {
  const clean = String(name || '').trim().slice(0, 18) || 'Player';
  s.players.push({ id, name: clean, stack: s.settings.startingStack, buyIns: 1, sittingOut: false });
}

const player = (s: TableState, id: string): Player | undefined => s.players.find((p) => p.id === id);
const eligible = (s: TableState): Player[] => s.players.filter((p) => p.stack > 0 && !p.sittingOut);
const isHost = (s: TableState, id: string): boolean => id === s.hostId || id === '*';
const nameOf = (s: TableState, id: string): string => (player(s, id) || { name: '?' }).name;

/*
 * The `!` assertions below all rest on the same invariant: once a hand exists, every id
 * in hand.seats is a player at the table, and a hand only starts with >= 2 of them.
 */

function log(s: TableState, msg: string): void {
  s.log.push(msg);
  if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
}

// next id after `fromId` in `order` (cyclic) that passes `pred`
function nextIn(order: string[], fromId: string | null, pred: (id: string) => boolean): string | null {
  const n = order.length;
  const i = fromId === null ? -1 : order.indexOf(fromId);
  for (let k = 1; k <= n; k++) {
    const id = order[(i + k + n) % n];
    if (pred(id)) return id;
  }
  return null;
}

// ---------- pots ----------
function computePots(hand: Hand): Pot[] {
  const ids = hand.seats;
  const live = ids.filter((id) => !hand.folded[id]);
  const levels = [...new Set(live.map((id) => hand.committed[id] || 0))].filter((v) => v > 0).sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const lvl of levels) {
    let amount = 0;
    for (const id of ids) {
      const c = hand.committed[id] || 0;
      amount += Math.max(0, Math.min(c, lvl) - Math.min(c, prev));
    }
    const elig = live.filter((id) => (hand.committed[id] || 0) >= lvl);
    if (amount > 0) {
      const last = pots[pots.length - 1];
      // merge pots with identical eligibility
      if (last && last.eligible.join() === elig.join()) last.amount += amount;
      else pots.push({ amount, eligible: elig });
    }
    prev = lvl;
  }
  // folded chips above the top live level (rare) go to the last pot
  let extra = 0;
  for (const id of ids) extra += Math.max(0, (hand.committed[id] || 0) - prev);
  if (extra && pots.length) pots[pots.length - 1].amount += extra;
  return pots;
}

const potTotal = (hand: Hand | null): number =>
  hand ? hand.seats.reduce((t, id) => t + (hand.committed[id] || 0), 0) : 0;

// ---------- hand lifecycle ----------
function post(s: TableState, h: Hand, id: string, amt: number): number {
  const p = player(s, id)!;
  const a = Math.min(p.stack, amt);
  p.stack -= a;
  h.bets[id] = (h.bets[id] || 0) + a;
  h.committed[id] = (h.committed[id] || 0) + a;
  if (p.stack === 0) h.allIn[id] = true;
  return a;
}

function startHand(s: TableState): void {
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

function canAct(h: Hand, id: string): boolean { return !h.folded[id] && !h.allIn[id]; }

function advance(s: TableState, lastId: string, initial?: boolean): void {
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

function award(s: TableState, winnersPerPot: string[][]): void {
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

// ---------- betting ----------
type BetAction = Extract<Action, { type: 'fold' | 'check' | 'call' | 'raise' }>;

function act(s: TableState, a: BetAction): void {
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

// ---------- reducer ----------
function reduce(prev: TableState, a: Action): TableState {
  if (!a || !a.type) fail('Missing action');
  const s = clone(prev);
  const snapshot = (): void => {
    const snap = clone(prev) as Snapshot & { history?: Snapshot[] };
    delete snap.history;
    s.history.push(snap);
    if (s.history.length > HISTORY_MAX) s.history.splice(0, s.history.length - HISTORY_MAX);
  };
  const host = isHost(s, a.by);
  const noHand = (): void => { if (s.hand) fail('Finish the current hand first'); };

  switch (a.type) {
    case 'join': {
      const existing = player(s, a.by);
      if (existing) {
        if (a.name) existing.name = String(a.name).trim().slice(0, 18) || existing.name;
        break;
      }
      if (s.players.length >= 10) fail('Table is full (10 players)');
      addPlayer(s, a.by, a.name);
      if (!s.hostId) s.hostId = a.by;
      if (!s.buttonId) s.buttonId = a.by;
      log(s, `${nameOf(s, a.by)} joined with ${s.settings.startingStack}.`);
      break;
    }
    case 'leave': {
      const target = a.player || a.by;
      if (target !== a.by && !host) fail('Only the host can remove players');
      if (s.hand && s.hand.seats.includes(target)) fail('Wait until this hand ends');
      const p = player(s, target);
      if (!p) break;
      snapshot();
      if (s.buttonId === target) {
        const order = s.players.map((x) => x.id);
        s.buttonId = nextIn(order, target, (id) => id !== target);
      }
      s.players = s.players.filter((x) => x.id !== target);
      if (s.hostId === target) s.hostId = s.players[0] ? s.players[0].id : null;
      log(s, `${p.name} left with ${p.stack}.`);
      break;
    }
    case 'sitOut': {
      const target = a.player || a.by;
      if (target !== a.by && !host) fail('Only the host can do that');
      const p = player(s, target);
      if (!p) fail('Not at this table');
      p.sittingOut = !!a.value;
      log(s, `${p.name} ${p.sittingOut ? 'sits out' : 'is back in'}.`);
      break;
    }
    case 'move': {
      noHand();
      const i = s.players.findIndex((p) => p.id === a.player);
      const j = i + (a.dir < 0 ? -1 : 1);
      if (i < 0 || j < 0 || j >= s.players.length) break;
      [s.players[i], s.players[j]] = [s.players[j], s.players[i]];
      break;
    }
    case 'button': {
      noHand();
      if (!player(s, a.player)) fail('Not at this table');
      s.buttonId = a.player;
      log(s, `Button moved to ${nameOf(s, a.player)}.`);
      break;
    }
    case 'rebuy': {
      const target = a.player || a.by;
      if (target !== a.by && !host) fail('Only the host can add chips for someone else');
      if (s.hand && s.hand.seats.includes(target)) fail('Rebuy between hands');
      const p = player(s, target);
      if (!p) fail('Not at this table');
      snapshot();
      p.stack += s.settings.startingStack;
      p.buyIns += 1;
      log(s, `${p.name} buys in again (+${s.settings.startingStack}).`);
      break;
    }
    case 'adjust': {
      if (!host) fail('Only the host can adjust stacks');
      noHand();
      const p = player(s, a.player);
      if (!p) fail('Not at this table');
      const v = int(a.stack);
      if (!(v >= 0)) fail('Stack must be 0 or more');
      snapshot();
      log(s, `Host set ${p.name}'s stack ${p.stack} → ${v}.`);
      p.stack = v;
      break;
    }
    case 'settings': {
      if (!host) fail('Only the host can change blinds');
      noHand();
      const st: Settings = {
        startingStack: int(a.startingStack ?? s.settings.startingStack),
        sb: int(a.sb ?? s.settings.sb),
        bb: int(a.bb ?? s.settings.bb),
      };
      validateSettings(st);
      s.settings = st;
      log(s, `Blinds now ${st.sb}/${st.bb}, buy-in ${st.startingStack}.`);
      break;
    }
    case 'deal':
      snapshot();
      startHand(s);
      break;
    case 'fold':
    case 'check':
    case 'call':
    case 'raise':
      snapshot();
      act(s, a);
      break;
    case 'award':
      snapshot();
      award(s, a.winners);
      break;
    case 'undo': {
      if (!host) fail('Only the host can undo');
      const last = s.history.pop();
      if (!last) fail('Nothing to undo');
      const hist = s.history;
      const restored = clone(last) as TableState;
      restored.history = hist;
      restored.version = s.version;
      restored.log = (restored.log || []).concat();
      log(restored, 'Host undid the last action.');
      return bump(restored);
    }
    default:
      fail('Unknown action ' + (a as Action).type);
  }
  return bump(s);
}

function bump(s: TableState): TableState { s.version = (s.version || 0) + 1; s.updatedAt = Date.now(); return s; }
function cap(w: string): string { return w.charAt(0).toUpperCase() + w.slice(1); }

// ---------- helpers for UI ----------
function legal(s: TableState, id: string): LegalMoves | null {
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
function boardCount(street: Street): number {
  return street === 'preflop' ? 0 : street === 'flop' ? 3 : street === 'turn' ? 4 : 5;
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
function streetChange(prev: StreetPos | null, next: StreetPos | null): StreetChange | null {
  if (!prev || !next || prev.no !== next.no) return null;
  if (next.street === 'showdown') return null;
  if (STREETS.indexOf(next.street) <= STREETS.indexOf(prev.street)) return null;
  return { street: next.street, hint: DEAL_HINT[next.street] };
}

export { newTable, reduce, legal, computePots, potTotal, STREETS, DEAL_HINT, boardCount, streetChange };
