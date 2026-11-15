import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.ts';
import type { Action, ActionType, TableState } from '../src/types.ts';

function table(names: string[] = ['a', 'b', 'c'], opts: Record<string, unknown> = {}): TableState {
  let s = E.newTable({ code: 'TEST', hostId: names[0], hostName: names[0], ...opts });
  for (const n of names.slice(1)) s = E.reduce(s, { type: 'join', by: n, name: n });
  return s;
}
// Tests build actions dynamically, so the union is asserted at this one boundary.
const go = (s: TableState, by: string, type: ActionType, extra: Record<string, unknown> = {}): TableState =>
  E.reduce(s, { type, by, ...extra } as Action);
const stack = (s: TableState, id: string): number => s.players.find((p) => p.id === id)!.stack;
const total = (s: TableState): number => s.players.reduce((t, p) => t + p.stack, 0) + E.potTotal(s.hand);

test('3-handed blinds and first to act', () => {
  let s = go(table(), 'a', 'deal');
  const h = s.hand!;
  assert.equal(h.buttonId, 'a');
  assert.equal(h.sbId, 'b');
  assert.equal(h.bbId, 'c');
  assert.equal(h.toAct, 'a');
  assert.equal(stack(s, 'b'), 995);
  assert.equal(stack(s, 'c'), 990);
  assert.equal(total(s), 3000);
});

test('heads-up: button posts small blind and acts first preflop, last postflop', () => {
  let s = go(table(['a', 'b']), 'a', 'deal');
  assert.equal(s.hand!.sbId, 'a');
  assert.equal(s.hand!.toAct, 'a');
  s = go(s, 'a', 'call');
  assert.equal(s.hand!.toAct, 'b'); // BB option
  s = go(s, 'b', 'check');
  assert.equal(s.hand!.street, 'flop');
  assert.equal(s.hand!.toAct, 'b');
});

test('BB gets option, then streets advance to showdown and award', () => {
  let s = go(table(), 'a', 'deal');
  s = go(s, 'a', 'call');
  s = go(s, 'b', 'call');
  assert.equal(s.hand!.toAct, 'c');
  s = go(s, 'c', 'check');
  assert.equal(s.hand!.street, 'flop');
  assert.equal(s.hand!.toAct, 'b');
  for (const st of ['flop', 'turn', 'river']) {
    assert.equal(s.hand!.street, st);
    s = go(s, 'b', 'check'); s = go(s, 'c', 'check'); s = go(s, 'a', 'check');
  }
  assert.equal(s.hand!.street, 'showdown');
  assert.equal(s.hand!.pots!.length, 1);
  assert.equal(s.hand!.pots![0].amount, 30);
  s = go(s, 'a', 'award', { winners: [['c']] });
  assert.equal(s.hand, null);
  assert.equal(stack(s, 'c'), 1020);
  assert.equal(s.buttonId, 'b');
  assert.equal(total(s), 3000);
});

test('everyone folds to a raise', () => {
  let s = go(table(), 'a', 'deal');
  s = go(s, 'a', 'raise', { to: 30 });
  s = go(s, 'b', 'fold');
  s = go(s, 'c', 'fold');
  assert.equal(s.hand, null);
  assert.equal(stack(s, 'a'), 1015);
  assert.equal(s.lastResult!.wins[0].amount, 45);
});

test('min-raise enforced, re-raise reopens action', () => {
  let s = go(table(), 'a', 'deal');
  assert.throws(() => go(s, 'a', 'raise', { to: 15 }), /Minimum raise is to 20/);
  s = go(s, 'a', 'raise', { to: 40 }); // raise of 30
  assert.throws(() => go(s, 'b', 'raise', { to: 60 }), /Minimum raise is to 70/);
  s = go(s, 'b', 'raise', { to: 100 });
  s = go(s, 'c', 'fold');
  assert.equal(s.hand!.toAct, 'a');
  s = go(s, 'a', 'call');
  assert.equal(s.hand!.street, 'flop');
});

test('out-of-turn actions are rejected, host can act for others', () => {
  let s = go(table(), 'a', 'deal');
  s = go(s, 'a', 'call');
  assert.throws(() => go(s, 'c', 'call'), /b's turn/);
  s = go(s, 'a', 'fold', { player: 'b' }); // host acts for b
  assert.ok(s.hand!.folded.b);
});

test('side pots with all-ins and uncalled chips returned', () => {
  let s = table(['a', 'b', 'c']);
  s = go(s, 'a', 'adjust', { player: 'a', stack: 100 });
  s = go(s, 'a', 'adjust', { player: 'b', stack: 300 });
  s = go(s, 'a', 'adjust', { player: 'c', stack: 1000 });
  s = go(s, 'a', 'deal');
  s = go(s, 'a', 'raise', { to: 100 }); // a all in
  s = go(s, 'b', 'raise', { to: 295 + 5 }); // b all in (300 total)
  s = go(s, 'c', 'raise', { to: 600 }); // c over-bets
  assert.equal(s.hand!.street, 'showdown');
  assert.ok(s.hand!.runout);
  // main 300 (a,b,c), side 400 (b,c); c's extra 300 returned
  assert.deepEqual(s.hand!.pots!.map((p) => p.amount), [300, 400]);
  assert.equal(stack(s, 'c'), 700);
  s = go(s, 'c', 'award', { winners: [['a'], ['c']] });
  assert.equal(stack(s, 'a'), 300);
  assert.equal(stack(s, 'b'), 0);
  assert.equal(stack(s, 'c'), 1100);
});

test('split pot gives odd chip to first winner left of button', () => {
  let s = table(['a', 'b', 'c'], { sb: 5, bb: 10 });
  s = go(s, 'a', 'deal');
  s = go(s, 'a', 'call');
  s = go(s, 'b', 'fold');
  s = go(s, 'c', 'check');
  for (let i = 0; i < 3; i++) { s = go(s, 'c', 'check'); s = go(s, 'a', 'check'); }
  assert.equal(s.hand!.pots![0].amount, 25);
  s = go(s, 'a', 'award', { winners: [['a', 'c']] });
  assert.equal(stack(s, 'c'), 1003); // 990 + 13
  assert.equal(stack(s, 'a'), 1002); // 990 + 12
});

test('undo restores previous state', () => {
  let s = go(table(), 'a', 'deal');
  const before = stack(s, 'a');
  s = go(s, 'a', 'raise', { to: 50 });
  s = go(s, 'a', 'undo');
  assert.equal(stack(s, 'a'), before);
  assert.equal(s.hand!.toAct, 'a');
  assert.throws(() => go(s, 'b', 'undo'), /host/);
});

test('busted player is skipped, rebuy brings them back', () => {
  let s = table(['a', 'b', 'c']);
  s = go(s, 'a', 'adjust', { player: 'b', stack: 0 });
  s = go(s, 'a', 'deal');
  assert.deepEqual(s.hand!.seats, ['a', 'c']);
  s = go(s, 'a', 'fold');
  s = go(s, 'b', 'rebuy');
  assert.equal(stack(s, 'b'), 1000);
  assert.equal(s.players.find((p) => p.id === 'b')!.buyIns, 2);
});

test('short all-in big blind still lets others act', () => {
  let s = table(['a', 'b', 'c']);
  s = go(s, 'a', 'adjust', { player: 'c', stack: 4 });
  s = go(s, 'a', 'deal');
  assert.ok(s.hand!.allIn.c);
  assert.equal(s.hand!.currentBet, 10);
  s = go(s, 'a', 'call');
  s = go(s, 'b', 'call');
  assert.equal(s.hand!.street, 'flop');
});

test('tracks each player\'s last action, reset each street', () => {
  let s = go(table(), 'a', 'deal');
  assert.equal(s.hand!.last.b, 'Small blind');
  assert.equal(s.hand!.last.c, 'Big blind');
  s = go(s, 'a', 'raise', { to: 30 });
  assert.equal(s.hand!.last.a, 'Raised');
  s = go(s, 'b', 'call');
  assert.equal(s.hand!.last.b, 'Called');
  s = go(s, 'c', 'fold');
  assert.equal(s.hand!.street, 'flop');
  assert.deepEqual(s.hand!.last, {});
  s = go(s, 'b', 'raise', { to: 20 });
  assert.equal(s.hand!.last.b, 'Bet');
});

test('board count per street', () => {
  assert.equal(E.boardCount('preflop'), 0);
  assert.equal(E.boardCount('flop'), 3);
  assert.equal(E.boardCount('turn'), 4);
  assert.equal(E.boardCount('river'), 5);
  // the board is still fully dealt once hands are shown, including an all-in runout
  assert.equal(E.boardCount('showdown'), 5);
});

test('street change announces only a real step forward in the same hand', () => {
  const at = (no: number, street: string): E.StreetPos => ({ no, street } as E.StreetPos);

  const flop = E.streetChange(at(1, 'preflop'), at(1, 'flop'));
  assert.equal(flop!.street, 'flop');
  assert.equal(flop!.hint, E.DEAL_HINT.flop);
  assert.equal(E.streetChange(at(1, 'flop'), at(1, 'turn'))!.street, 'turn');
  assert.equal(E.streetChange(at(1, 'turn'), at(1, 'river'))!.street, 'river');

  // a client that joins mid-hand must not be told to deal the street already on the table
  assert.equal(E.streetChange(null, at(1, 'turn')), null);
  // no hand in progress
  assert.equal(E.streetChange(at(1, 'river'), null), null);
  // same street, e.g. somebody just called
  assert.equal(E.streetChange(at(1, 'flop'), at(1, 'flop')), null);
  // a new hand deals itself; that is not a street change
  assert.equal(E.streetChange(at(1, 'river'), at(2, 'preflop')), null);
  // undo steps backwards
  assert.equal(E.streetChange(at(1, 'turn'), at(1, 'flop')), null);
  // showdown raises its own modal, including an all-in runout straight from preflop
  assert.equal(E.streetChange(at(1, 'river'), at(1, 'showdown')), null);
  assert.equal(E.streetChange(at(1, 'preflop'), at(1, 'showdown')), null);
});

test('street change fires for each street of a real hand, once each', () => {
  let s = go(table(), 'a', 'deal');
  const seen: string[] = [];
  let prev: E.StreetPos | null = null;
  const observe = (st: TableState): void => {
    const ch = E.streetChange(prev, st.hand);
    if (ch) seen.push(ch.street);
    prev = st.hand ? { no: st.hand.no, street: st.hand.street } : null;
  };
  observe(s);
  for (const [by, type] of [['a', 'call'], ['b', 'call'], ['c', 'check']] as const) {
    s = go(s, by, type); observe(s);
  }
  for (const street of ['flop', 'turn', 'river'] as const) {
    assert.equal(s.hand!.street === street || seen.includes(street), true);
    for (const by of ['b', 'c', 'a'] as const) { s = go(s, by, 'check'); observe(s); }
  }
  assert.deepEqual(seen, ['flop', 'turn', 'river']);
  assert.equal(s.hand!.street, 'showdown');
});
