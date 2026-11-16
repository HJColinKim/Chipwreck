/*
 * The waiting room: the table code to read out, the stakes, and who has taken a seat.
 * Shares the lobby's frame, so joining and waiting feel like one screen.
 */
import { lobbySkeleton } from './lobby.ts';
import { avatarHTML } from '../scene.ts';
import { ROOM_COLORS } from '../theme.ts';
import { esc, money } from '../format.ts';
import { mount, observe, patch } from '../dom.ts';
import { amHost, eligibleCount } from '../selectors.ts';
import type { Device, UiState } from '../state.ts';
import type { Backend } from '../../transport/index.ts';
import type { TableState } from '../../types.ts';

export function renderRoom(
  S: TableState, ui: UiState, me: Device, online: Set<string>, net: Backend | null,
): void {
  if (mount('room', lobbySkeleton('rpanel'))) observe('hero');
  const host = amHost(S, me), local = me.local;
  const n = S.players.length;
  const canStart = eligibleCount(S) >= 2;
  const label = local ? 'ONE PHONE TABLE' : host ? 'SHARE THIS CODE' : 'YOU’RE IN';
  const hint = local ? 'Add everyone in seat order, going clockwise.' : host ? (n < 2 ? 'Read the code out. Players join from their phones.' : 'Everyone in? Start when the cards are shuffled.') : 'Waiting for the host to deal.';
  const rows = S.players.map((p, i) => {
    const isH = !local && p.id === S.hostId;
    const away = !local && online.size && !online.has(p.id);
    const tag = isH ? 'HOST' : local ? 'SEAT ' + (i + 1) : away ? 'AWAY' : 'READY';
    const tagStyle = isH ? 'background:var(--mustard);color:var(--ink)' : away ? 'background:var(--pine);color:var(--steel)' : 'background:var(--felt);color:var(--linen)';
    return `<div class="rp">${avatarHTML(ROOM_COLORS[i % ROOM_COLORS.length])}<div class="nm">${esc(p.name)}${p.id === me.id && !local ? ' (you)' : ''}</div><div class="tag" style="${tagStyle}">${tag}</div></div>`;
  }).join('');
  patch('rpanel', `
    <div class="roomhead"><div class="lbl">${label}</div><button class="textlink" data-a="leave">Leave</button></div>
    ${local ? '' : `<div class="tiles" aria-label="Table code ${esc(S.code)}">${S.code.split('').map((c) => `<div>${esc(c)}</div>`).join('')}</div>`}
    <div class="stats">
      <div class="stat blue"><b>STACK</b><span>${money(S.settings.startingStack)}</span></div>
      <div class="stat brick"><b>BLINDS</b><span>$${S.settings.sb}/$${S.settings.bb}</span></div>
      <div class="stat pine"><b>SEATED</b><span>${n}/10</span></div>
    </div>
    <div class="rplayers">${rows}</div>
    ${local ? `<div class="addrow"><input id="in-add" class="field" maxlength="18" placeholder="Add a player" value="${esc(ui.addName)}"><button class="abtn pine" data-a="add-player">ADD</button></div>` : ''}
    <p class="note">${hint}</p>
    ${host ? `<button id="b-start" class="abtn submit ${canStart ? 'mustard' : 'dead'}" data-a="deal" ${canStart && !ui.busy ? '' : 'disabled'}>START GAME</button>`
      : `<button id="b-seat" class="abtn submit mustard" data-a="seat">TAKE YOUR SEAT</button>`}
    ${!local && net && net.kind === 'peer' ? '<div class="extras"><button class="textlink" data-a="copy-link">Copy invite link</button></div>' : ''}`);
}
