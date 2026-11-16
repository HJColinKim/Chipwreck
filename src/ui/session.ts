/*
 * The connection a screen is looking at: picking a backend at boot, creating or joining a
 * table, subscribing to its state, submitting actions, and leaving.
 *
 * This is the only place that holds a backend. Views and event handlers go through send()
 * and never see the transport, which is why swapping backends changes nothing above here.
 */
import { streetChange, potTotal } from '../engine/index.ts';
import type { StreetPos } from '../engine/index.ts';
import { LocalBackend, pickBackend, store } from '../transport/index.ts';
import type { Backend } from '../transport/index.ts';
import { announceStreet, buzz, popAt, toast } from './dom.ts';
import { money } from './format.ts';
import { render } from './render.ts';
import { NO_TABLE, device, live, ui } from './state.ts';
import { BLIND_OPTS } from './theme.ts';
import type { ActionInput } from '../types.ts';

export function boot(): void {
  const hash = (location.hash || '').replace('#', '').toUpperCase();
  if (/^[A-Z0-9]{4}$/.test(hash)) ui.code = hash;
  pickBackend()
    .then((b) => { live.net = b; render(); })
    .catch((e: Error) => { ui.homeNote = e.message; render(); });
  render();
}

// ---------------- the open table ----------------
let unsub: (() => void) | null = null;

/** Subscribes to a backend's table and repaints on everything it sends. */
function attach(b: Backend): void {
  if (unsub) unsub();
  live.backend = b;
  let lastTurn: string | null = null;
  // Reset per table: a device joining mid-hand has no "before", so it announces nothing.
  let lastPos: StreetPos | null = null;
  const u1 = b.onState((s) => {
    live.S = s;
    if (ui.view === 'auto') ui.view = s.handNo > 0 || s.hand ? 'table' : 'room';
    else if (ui.view === 'room' && s.hand) ui.view = 'table';
    const me = device();
    const turn = s.hand && s.hand.toAct;
    if (turn && turn !== lastTurn && turn === me.id && !me.local) buzz([60, 40, 60]);
    lastTurn = turn;
    const change = streetChange(lastPos, s.hand);
    lastPos = s.hand ? { no: s.hand.no, street: s.hand.street } : null;
    trackPot();
    render();
    if (change) announceStreet(change); // after render(): the first table state mounts the layer
  });
  const u2 = b.onOnline ? b.onOnline((set) => { live.online = set; render(); }) : () => {};
  unsub = () => { u1(); u2(); };
}

/** Pops the amount the pot just grew by. Silent across hands, where a reset is not a win. */
let lastPot: number | null = null, lastPotHand: number | null = null;
function trackPot(): void {
  const h = live.S.hand;
  if (!h || h.street === 'showdown') { lastPot = null; return; }
  const pot = potTotal(h);
  if (lastPot != null && lastPotHand === h.no && pot > lastPot) popAt('potPops', '+' + money(pot - lastPot), '30%', 44);
  lastPot = pot; lastPotHand = h.no;
}

/**
 * Submits one action and reports the outcome. `tag` is the data-a of the control that
 * started it, so only that button shows a spinner while it is in flight.
 */
export async function send(action: ActionInput, tag?: string): Promise<boolean> {
  if (ui.busy) return false;
  ui.busy = true;
  ui.pending = tag ?? null;
  // Nothing repainted between here and the reply, so a slow relay looked like a frozen app.
  render();
  try { await live.backend!.submit(action); return true; }
  catch (e) { toast((e as Error).message, true); return false; }
  finally { ui.busy = false; ui.pending = null; render(); }
}

// ---------------- joining, creating, leaving ----------------
/** Lobby failures belong on the form itself, where the player can fix the input. */
function lobbyError(msg: string): void { ui.err = msg; ui.busy = false; render(); }

export async function submitLobby(local: boolean): Promise<void> {
  const name = ui.name.trim();
  if (!local && ui.tab === 'join' && ui.code.length !== 4) return lobbyError('Table codes are 4 characters.');
  if (!name) return lobbyError('Add your name so the table knows who you are.');
  if (!local && !live.net) return lobbyError(ui.homeNote || 'Still connecting. Try again in a second.');
  ui.err = ''; ui.busy = true; render();
  store.set('chipstack:name', name);
  try {
    if (local || ui.tab === 'create') {
      const [sb, bb] = BLIND_OPTS[ui.blinds];
      const b: Backend = local ? await new LocalBackend().init() : live.net!;
      const code = await b.create({ startingStack: ui.stack, sb, bb }, name);
      if (!local) store.set('chipstack:last', code);
      ui.view = 'room';
      attach(b);
    } else {
      await openTable(ui.code, name);
    }
  } catch (e) { ui.view = 'lobby'; live.S = NO_TABLE; lobbyError((e as Error).message); return; }
  ui.busy = false; render();
}

async function openTable(code: string, name: string): Promise<void> {
  const b = live.net!;
  await b.open(code);
  store.set('chipstack:last', code);
  ui.view = 'auto';
  attach(b);
  if (!b.state!.players.some((p) => p.id === b.me.id)) await b.submit({ type: 'join', name });
}

export async function rejoin(code: string): Promise<void> {
  const name = ui.name.trim();
  if (!name) return lobbyError('Add your name so the table knows who you are.');
  if (!live.net) return lobbyError('Still connecting. Try again in a second.');
  ui.err = ''; ui.busy = true; render();
  store.set('chipstack:name', name);
  try { await openTable(code, name); }
  catch (e) { ui.view = 'lobby'; live.S = NO_TABLE; return lobbyError((e as Error).message); }
  ui.busy = false; render();
}

export async function continueLocal(): Promise<void> {
  try { const b = new LocalBackend(); await b.open(); ui.view = 'auto'; attach(b); }
  catch (e) { lobbyError((e as Error).message); }
}

export function leaveToLobby(): void {
  const b = live.backend;
  // A one-phone table is saved in this browser, so leaving it is only closing the screen.
  if (b && b.kind !== 'local' && b.close) b.close();
  if (unsub) unsub();
  unsub = null;
  live.backend = null; live.S = NO_TABLE;
  ui.view = 'lobby'; ui.sheet = null; ui.actFor = false; ui.staged = [];
  render();
}
