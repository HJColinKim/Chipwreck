/*
 * Every listener the app installs, in one place: chip taps and drags, the keyboard, text
 * inputs, and one delegated click handler for every control on the page.
 *
 * Controls carry their intent in data-a (plus data-id / data-k / data-v), so a view only
 * has to name what a button does — the switch below is the single list of what each name
 * means, and patched-in HTML never needs listeners reattached.
 *
 * Importing this module installs the listeners.
 */
import { legal } from '../engine/index.ts';
import { rid, store } from '../transport/index.ts';
import { $app, buzz, cache, keepAwake, popAt, toast } from './dom.ts';
import { money } from './format.ts';
import { render } from './render.ts';
import { actorId, playState, playerOf } from './selectors.ts';
import { continueLocal, leaveToLobby, rejoin, send, submitLobby } from './session.ts';
import { refreshSubmit } from './views/lobby.ts';
import { device, live, ui } from './state.ts';
import { byV, greedy } from './theme.ts';
import type { ActionInput } from '../types.ts';

/** The player this device may act for right now — null in the lobby, or when it may not act. */
const acting = (): string | null => (live.S ? actorId(live.S, ui, device()) : null);

// ---------------- chips: tap, drag in, drag out ----------------
function addChip(v: number): void {
  const actor = acting();
  if (!actor) return;
  const p = playerOf(live.S, actor)!;
  const sum = ui.staged.reduce((a, b) => a + b, 0);
  if (sum + v > p.stack) return;
  ui.staged.push(v);
  buzz(8);
  render();
  popAt('zonePops', '+$' + v, '40%', 40);
}

/**
 * Pointer drags between the tray and "your play", with a tap as the degenerate case: a
 * press that never moves counts as a tap, and a chip dropped outside the zone goes back.
 */
function startDrag(e: PointerEvent, v: number, source: 'tray' | 'zone', idx?: number): void {
  const actor = acting();
  if (!actor) return;
  if (source === 'tray') { const p = playerOf(live.S, actor)!; if (v > p.stack - ui.staged.reduce((a, b) => a + b, 0)) return; }
  e.preventDefault();
  const sx = e.clientX, sy = e.clientY;
  const c = byV(v)!;
  let ghost: HTMLDivElement | null = null;
  const zoneEl = document.getElementById('zone');
  const move = (ev: PointerEvent): void => {
    if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) {
      ghost = document.createElement('div');
      ghost.className = 'ghost';
      ghost.style.background = `repeating-conic-gradient(${c.base} 0deg 20deg, ${c.stripe} 20deg 30deg)`;
      ghost.innerHTML = `<i style="background:${c.base};border:2px solid ${c.stripe};color:${c.stripe}">${c.label}</i>`;
      document.body.appendChild(ghost);
      if (zoneEl) zoneEl.classList.add('drag');
    }
    if (ghost) { ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px'; }
  };
  const up = (ev: PointerEvent): void => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    const moved = !!ghost;
    if (ghost) ghost.remove();
    if (zoneEl) zoneEl.classList.remove('drag');
    if (ev.type === 'pointercancel') return;
    const r = zoneEl && zoneEl.getBoundingClientRect();
    const inZone = r && ev.clientY >= r.top - 60 && ev.clientY <= r.bottom + 20 && ev.clientX >= r.left - 30 && ev.clientX <= r.right + 30;
    if (source === 'tray') { if (!moved || inZone) addChip(v); }
    else if (!moved || !inZone) { ui.staged.splice(idx!, 1); render(); }
  };
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

// ---------------- listeners ----------------
document.addEventListener('pointerdown', keepAwake, { passive: true });
document.addEventListener('pointerdown', (e) => {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  const t = target.closest<HTMLElement>('[data-chip]');
  if (t && $app.contains(t)) return startDrag(e, Number(t.dataset.chip), 'tray');
  const z = target.closest<HTMLElement>('[data-zchip]');
  if (z && $app.contains(z)) return startDrag(e, ui.staged[Number(z.dataset.zchip)], 'zone', Number(z.dataset.zchip));
});

document.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  const t = target && target.closest ? target.closest<HTMLElement>('[data-chip]') : null;
  if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); addChip(Number(t.dataset.chip)); return; }
  const id = target ? target.id : '';
  if (e.key === 'Enter' && id === 'in-code') submitLobby(false);
  if (e.key === 'Enter' && id === 'in-name' && !live.S) submitLobby(false);
  if (e.key === 'Enter' && id === 'in-add') addLocalPlayer('in-add');
  if (e.key === 'Enter' && id === 'in-add2') addLocalPlayer('in-add2');
  if (e.key === 'Escape' && ui.sheet) { ui.sheet = null; render(); }
});

// Typed-in text is held in ui and the panel left alone, so the field keeps its caret.
document.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'in-code') {
    const v = t.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (t.value !== v) t.value = v;
    ui.code = v; ui.err = ''; cache.delete('lpanel'); refreshSubmit(ui);
  } else if (t.id === 'in-name') {
    ui.name = t.value.slice(0, 18); ui.err = ''; cache.delete('lpanel'); refreshSubmit(ui);
  } else if (t.id === 'in-add') { ui.addName = t.value; cache.delete('rpanel'); }
});

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-a]');
  if (!el) return;
  const a = el.dataset.a;
  if (a === 'close-sheet-bg') { if (e.target === el) { ui.sheet = null; render(); } return; }
  if ((el as HTMLButtonElement).disabled) return;
  const S = live.S;
  const h = S && S.hand;
  const actor = acting();
  switch (a) {
    // lobby
    case 'tab': ui.tab = el.dataset.v as 'join' | 'create'; ui.err = ''; render(); break;
    case 'stack': ui.stack = Number(el.dataset.v); render(); break;
    case 'blinds': ui.blinds = Number(el.dataset.v); render(); break;
    case 'submit': submitLobby(false); break;
    case 'local': submitLobby(true); break;
    case 'local-continue': continueLocal(); break;
    case 'rejoin': rejoin(el.dataset.code!); break;
    // room
    case 'seat': ui.view = 'table'; render(); break;
    case 'add-player': addLocalPlayer('in-add'); break;
    case 'add-player2': addLocalPlayer('in-add2'); break;
    case 'add-sheet': ui.sheet = 'add'; render(); setTimeout(() => { const i = document.getElementById('in-add2'); if (i) i.focus(); }, 30); break;
    case 'leave': leaveToLobby(); break;
    case 'deal': ui.view = 'table'; send({ type: 'deal' }, 'deal'); break;
    // table
    case 'menu': ui.sheet = 'menu'; render(); break;
    case 'close-sheet': ui.sheet = null; render(); break;
    case 'player': ui.sheet = 'player'; ui.sheetPlayer = el.dataset.id ?? null; ui.confirmRemove = false; render(); break;
    case 'act-for': ui.actFor = true; render(); break;
    case 'stop-act': ui.actFor = false; render(); break;
    case 'clear': if (actor) { ui.staged = []; render(); } break;
    case 'fold': {
      if (!actor) break;
      const L = legal(S, actor)!;
      if (L.canCheck && !ui.confirmFold) { ui.confirmFold = true; render(); break; }
      ui.confirmFold = false;
      send({ type: 'fold', player: actor }, 'fold');
      break;
    }
    case 'checkcall': if (actor) { const L = legal(S, actor)!; send({ type: L.canCheck ? 'check' : 'call', player: actor }, 'checkcall'); } break;
    case 'allin': if (actor) { const L = legal(S, actor)!; send(L.maxTo > h!.currentBet ? { type: 'raise', to: L.maxTo, player: actor } : { type: 'call', player: actor }, 'allin'); } break;
    case 'play': {
      if (!actor) break;
      const ps = playState(S, actor, ui.staged.reduce((x, y) => x + y, 0));
      if (ps.ok) send({ ...ps.action, player: actor } as ActionInput, 'play');
      else if (ps.fill) {
        // short of the call or the minimum raise: stage the difference for them
        const L = legal(S, actor)!;
        const target = Math.min(L.maxTo, ps.fill);
        ui.staged = greedy(target - L.mine);
        const rest = target - L.mine - ui.staged.reduce((x, y) => x + y, 0);
        if (rest > 0) toast(`Use CALL or ALL IN for the last ${money(rest)}`);
        render();
      }
      break;
    }
    case 'win1': send({ type: 'award', winners: [[el.dataset.id!]] }, 'win1:' + el.dataset.id); break;
    case 'split': ui.split = !ui.split; ui.picks = (h!.pots || []).map(() => []); render(); break;
    case 'pick': {
      const i = Number(el.dataset.pot), id = el.dataset.id!;
      const w = ui.picks[i] || [];
      ui.picks[i] = w.includes(id) ? w.filter((x) => x !== id) : w.concat(id);
      render();
      break;
    }
    case 'award': send({ type: 'award', winners: ui.picks }, 'award'); break;
    case 'rebuy-me': send({ type: 'rebuy' }); break;
    case 'sit-back': send({ type: 'join', name: ui.name || store.get('chipstack:name') || 'Player' }); break;
    case 'copy-code': copy(S.code); break;
    case 'copy-link': copy(location.origin + location.pathname + '#' + S.code, 'invite link'); break;
    case 'undo': send({ type: 'undo' }); break;
    case 'save-settings': {
      const v = (id: string): string => (document.getElementById(id) as HTMLInputElement).value;
      send({ type: 'settings', startingStack: v('in-s-stack'), sb: v('in-s-sb'), bb: v('in-s-bb') }).then((ok) => ok && toast('Blinds saved'));
      break;
    }
    case 'pa': playerAction(el.dataset.k as PlayerActionKind); break;
    default: break;
  }
});

let rz: ReturnType<typeof setTimeout>;
window.addEventListener('resize', () => {
  clearTimeout(rz);
  rz = setTimeout(() => { if (live.S && ui.view === 'table') render(); }, 120);
});

// ---------------- handlers the switch delegates to ----------------
type PlayerActionKind = 'up' | 'down' | 'button' | 'sit' | 'rebuy' | 'adjust' | 'remove';

function playerAction(kind: PlayerActionKind): void {
  const id = ui.sheetPlayer;
  const p = playerOf(live.S, id);
  if (!p) return;
  if (kind === 'remove') {
    if (!ui.confirmRemove) { ui.confirmRemove = true; render(); return; }
    ui.confirmRemove = false; ui.sheet = null;
    const me = device();
    send({ type: 'leave', player: id! }).then((ok) => { if (ok && id === me.id && !me.local) leaveToLobby(); });
    return;
  }
  const map: Record<Exclude<PlayerActionKind, 'remove'>, ActionInput> = {
    up: { type: 'move', player: id!, dir: -1 },
    down: { type: 'move', player: id!, dir: 1 },
    button: { type: 'button', player: id! },
    sit: { type: 'sitOut', player: id!, value: !p.sittingOut },
    rebuy: { type: 'rebuy', player: id! },
    // left as possibly-undefined on purpose: a missing field fails validation, '' would read as 0
    adjust: { type: 'adjust', player: id!, stack: (document.getElementById('in-adj') as HTMLInputElement | null)?.value as string },
  };
  send(map[kind as Exclude<PlayerActionKind, 'remove'>]);
}

/** One-phone mode seats players from this device, so each gets a made-up id. */
async function addLocalPlayer(inputId: string): Promise<void> {
  const el = document.getElementById(inputId) as HTMLInputElement | null;
  const n = ((el && el.value) || '').trim();
  if (!n) return toast('Type a name first', true);
  const ok = await send({ type: 'join', by: 'l' + rid(), name: n });
  if (ok) {
    ui.addName = '';
    cache.delete('rpanel');
    if (inputId === 'in-add2') ui.sheet = null;
    render();
    const i = document.getElementById(inputId) as HTMLInputElement | null;
    if (i) { i.value = ''; i.focus(); }
  }
}

function copy(text: string, label?: string): void {
  const done = (): void => toast('Copied ' + (label || text));
  try { navigator.clipboard.writeText(text).then(done, () => toast(label ? text : 'Code: ' + text)); }
  catch (e) { toast('Code: ' + text); }
}
