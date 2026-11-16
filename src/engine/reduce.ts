/*
 * The reducer: reduce(state, action) -> new state, throwing an Error with a readable
 * message on an illegal action. Every action carries { type, by } where `by` is the
 * acting device's player id.
 *
 * Actions arriving from a backend are unvalidated network input typed as Action at the
 * boundary — the switch below is what actually rejects malformed ones.
 *
 * This file owns table administration (joining, seating, chips, settings, undo) and
 * delegates anything inside a hand to hand.ts and betting.ts.
 */
import { clone, fail, int, isHost, log, nameOf, nextIn, player } from './core.ts';
import { addPlayer, cleanName, validateSettings } from './table.ts';
import { award, startHand } from './hand.ts';
import { act } from './betting.ts';
import type { Action, Settings, Snapshot, TableState } from '../types.ts';

const HISTORY_MAX = 10;
const TABLE_MAX = 10;

export function reduce(prev: TableState, a: Action): TableState {
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
        if (a.name) existing.name = cleanName(a.name) || existing.name;
        break;
      }
      if (s.players.length >= TABLE_MAX) fail(`Table is full (${TABLE_MAX} players)`);
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
