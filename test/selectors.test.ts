// Covers src/ui/selectors.ts: the rules the table screen applies on top of the engine —
// who this device may act for, whose card sits in the "me" slot, the seat order shown,
// and what the PLAY button does with the chips a player has stacked up.
//
// These were unreachable from a test while they read module globals in app.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newTable, reduce } from '../src/engine/index.ts';
import {
  actorId, amHost, lastLine, playState, ringFrom, statusOf, viewerId,
} from '../src/ui/selectors.ts';
import type { Device, UiState } from '../src/ui/state.ts';
import type { Action, TableState } from '../src/types.ts';

function table(names: string[] = ['a', 'b', 'c']): TableState {
  let s = newTable({ code: 'TEST', hostId: names[0], hostName: names[0] });
  for (const n of names.slice(1)) s = reduce(s, { type: 'join', by: n, name: n });
  return s;
}
const go = (s: TableState, by: string, type: Action['type'], extra: Record<string, unknown> = {}): TableState =>
  reduce(s, { type, by, ...extra } as Action);
const seat = (s: TableState, id: string) => s.players.find((p) => p.id === id)!;

// Spelled out rather than imported from state.ts so that adding a field to UiState
// surfaces here as a type error instead of silently defaulting.
const uiState = (over: Partial<UiState> = {}): UiState => ({
  view: 'table', tab: 'join', code: '', name: '', stack: 1000, blinds: 0,
  err: '', busy: false, homeNote: '', addName: '', pending: null,
  staged: [], stageKey: '', confirmFold: false, actFor: false,
  picks: [], pickKey: '', split: false, sheet: null, sheetPlayer: null, confirmRemove: false,
  ...over,
});
const phone = (id: string): Device => ({ id, kind: 'peer', local: false });
const onePhone: Device = { id: '*', kind: 'local', local: true };

// ---------------- who may act ----------------

test('only the player on the clock may act', () => {
  const s = go(table(), 'a', 'deal'); // 3-handed: button a acts first
  assert.equal(actorId(s, uiState(), phone('a')), 'a');
  assert.equal(actorId(s, uiState(), phone('b')), null);
});

test('the host may act for someone else, but only after asking to', () => {
  let s = go(table(), 'a', 'deal');
  s = go(s, 'a', 'call'); // now it is b's turn, and a is the host
  assert.equal(actorId(s, uiState(), phone('a')), null);
  assert.equal(actorId(s, uiState({ actFor: true }), phone('a')), 'b');
  // a player who is not the host gets nothing from the same flag
  assert.equal(actorId(s, uiState({ actFor: true }), phone('c')), null);
});

test('one phone acts for whoever is on the clock, and is always the host', () => {
  const s = go(table(), 'a', 'deal');
  assert.equal(actorId(s, uiState(), onePhone), 'a');
  assert.equal(viewerId(s, uiState(), onePhone), 'a'); // the phone shows the actor's cards
  assert.equal(amHost(s, onePhone), true);
  assert.equal(amHost(s, phone('b')), false);
});

test('nobody is on the clock at showdown', () => {
  let s = go(table(['a', 'b']), 'a', 'deal');
  s = go(s, 'a', 'raise', { to: 1000 });
  s = go(s, 'b', 'call'); // both all in: straight to showdown
  assert.equal(s.hand!.street, 'showdown');
  assert.equal(actorId(s, uiState(), phone('a')), null);
  assert.equal(actorId(s, uiState(), onePhone), null);
});

test('your own card stays in the me slot when it is not your turn', () => {
  const s = go(table(), 'a', 'deal');
  assert.equal(viewerId(s, uiState(), phone('b')), 'b');
  assert.equal(viewerId(s, uiState({ actFor: true }), phone('a')), 'a');
});

// ---------------- the seat list ----------------

test('seats are listed clockwise from the viewer, who is left out', () => {
  const s = table(['a', 'b', 'c', 'd']);
  assert.deepEqual(ringFrom(s, 'b').map((p) => p.id), ['c', 'd', 'a']);
  assert.deepEqual(ringFrom(s, 'd').map((p) => p.id), ['a', 'b', 'c']);
});

test('a viewer who is not seated sees the whole table', () => {
  const s = table(['a', 'b', 'c']);
  assert.deepEqual(ringFrom(s, null).map((p) => p.id), ['a', 'b', 'c']);
  assert.deepEqual(ringFrom(s, 'nobody').map((p) => p.id), ['a', 'b', 'c']);
});

test('seat status reports the hand, then why someone is out of it', () => {
  let s = go(table(), 'a', 'deal');
  assert.equal(statusOf(s, seat(s, 'a')), 'Thinking…');
  assert.equal(statusOf(s, seat(s, 'b')), 'Small blind');
  s = go(s, 'a', 'fold');
  assert.equal(statusOf(s, seat(s, 'a')), 'Folded');
  const sat = go(table(), 'c', 'sitOut', { value: true });
  assert.equal(statusOf(sat, seat(sat, 'c')), 'Sitting out');
});

test('the last line drops the trailing full stop the log keeps', () => {
  const s = go(table(), 'a', 'deal');
  assert.equal(lastLine(s), 'Hand #1: a has the button. Blinds 5/10');
});

// ---------------- the PLAY button ----------------

test('staged chips that match the bet offer a call, not a raise', () => {
  const s = go(table(), 'a', 'deal'); // a to act, 10 to call, min raise to 20
  assert.deepEqual(playState(s, 'a', 10), { label: 'CALL $10', ok: true, action: { type: 'call' } });
});

test('a short stack says how much to add rather than refusing', () => {
  const s = go(table(), 'a', 'deal');
  // under the call: top up to the current bet
  assert.deepEqual(playState(s, 'a', 5), { label: 'ADD $5', ok: false, fill: 10 });
  // over the call but under the minimum raise: top up to the minimum
  assert.deepEqual(playState(s, 'a', 15), { label: 'ADD $5', ok: false, fill: 20 });
});

test('a legal raise plays the street total, not the chips added', () => {
  const s = go(table(), 'a', 'deal');
  assert.deepEqual(playState(s, 'a', 20), { label: 'PLAY $20', ok: true, action: { type: 'raise', to: 20 } });
});

test('all in for less than the call is submitted as a call', () => {
  // a is left with 8 chips, so their whole stack cannot reach the big blind
  let s = reduce(table(), { type: 'adjust', by: 'a', player: 'a', stack: 8 });
  s = go(s, 'a', 'deal');
  assert.equal(s.hand!.toAct, 'a');
  assert.deepEqual(playState(s, 'a', 8), { label: 'PLAY $8', ok: true, action: { type: 'call' } });
});

test('all in above the call is submitted as a raise', () => {
  const s = go(table(), 'a', 'deal');
  assert.deepEqual(playState(s, 'a', 1000), { label: 'PLAY $1,000', ok: true, action: { type: 'raise', to: 1000 } });
});

test('chips stacked up out of turn, or none at all, leave PLAY inert', () => {
  const s = go(table(), 'a', 'deal');
  assert.deepEqual(playState(s, 'a', 0), { label: 'PLAY', ok: false });
  assert.deepEqual(playState(s, 'b', 100), { label: 'PLAY', ok: false }); // not b's turn
  assert.deepEqual(playState(s, null, 100), { label: 'PLAY', ok: false });
});
