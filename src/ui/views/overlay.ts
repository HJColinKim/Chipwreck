/*
 * The modal over the felt between hands: who took the pot and the deal button, or at
 * showdown the winner picker (one tap for the common case, a pot-by-pot picker when
 * someone went all in for less).
 */
import { busyHTML } from '../chips.ts';
import { esc, money, UP } from '../format.ts';
import { eligibleCount, nameOf, playerOf } from '../selectors.ts';
import type { Device, UiState } from '../state.ts';
import type { TableState } from '../../types.ts';

export function overlayHTML(S: TableState, ui: UiState, me: Device): string {
  const h = S.hand;
  if (h && h.street === 'showdown') return showdownHTML(S, ui, me);
  if (h) return '';
  const res = S.lastResult;
  const canDeal = eligibleCount(S) >= 2;
  const myPlayer = me.local ? null : playerOf(S, me.id);
  let kicker, title, amount = null, sub = '';
  if (res && res.wins.length) {
    kicker = `HAND ${res.handNo}`;
    amount = res.wins.reduce((t, w) => t + w.amount, 0);
    if (res.wins.length === 1) title = !me.local && res.wins[0].id === me.id ? 'YOU TAKE IT' : `${UP(nameOf(S, res.wins[0].id))} TAKES IT`;
    else { title = 'SPLIT POT'; sub = res.wins.map((w) => `${nameOf(S, w.id)} ${money(w.amount)}`).join(' · '); }
  } else if (res) { kicker = `HAND ${res.handNo}`; title = 'HAND OVER'; sub = 'Uncalled chips went back.'; }
  else { kicker = me.local ? 'ONE PHONE TABLE' : `TABLE ${S.code}`; title = 'READY TO DEAL'; sub = 'Seat order should match where people sit, clockwise. Change it from the table menu.'; }
  const btns = [];
  btns.push(`<button class="abtn ink mgo" id="b-deal" data-a="deal" ${canDeal && !ui.busy ? '' : 'disabled'}>${ui.pending === 'deal' ? busyHTML('DEALING…', 30) : canDeal ? (res ? 'DEAL NEXT HAND →' : 'DEAL HAND 1 →') : 'NEED 2 PLAYERS WITH CHIPS'}</button>`);
  if (myPlayer && myPlayer.stack === 0) btns.push(`<button class="abtn pine mgo" data-a="rebuy-me">REBUY ${money(S.settings.startingStack)}</button>`);
  if (!myPlayer && !me.local) btns.push('<button class="abtn pine mgo" data-a="sit-back">JOIN THIS TABLE</button>');
  const nextBtn = canDeal ? `<p class="msub">${esc(nameOf(S, S.buttonId))} has the button. Blinds go in automatically.</p>` : '';
  return `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title"><div class="mcard">
    <div class="mkick">${esc(kicker)}</div>
    <div class="px mtitle" id="m-title">${esc(title)}</div>
    ${amount != null ? `<div class="px mamt num">${money(amount)}</div>` : ''}
    ${sub ? `<p class="msub">${esc(sub)}</p>` : ''}
    ${btns.join('')}
    ${nextBtn}
    <div class="mlinks"><button class="melink" data-a="menu">Table menu</button>${me.local ? '<button class="melink" data-a="add-sheet">Add player</button>' : ''}</div>
  </div></div>`;
}

function showdownHTML(S: TableState, ui: UiState, me: Device): string {
  const h = S.hand!; // only reached while the hand is at showdown
  const pots = h.pots || [];
  if (ui.pickKey !== String(h.no)) { ui.pickKey = String(h.no); ui.picks = pots.map(() => []); ui.split = false; }
  const total = pots.reduce((t, p) => t + p.amount, 0);
  const multi = pots.length > 1 || ui.split;
  let body;
  if (!multi) {
    body = `<div class="mpick">${pots[0].eligible.map((id) => `<button class="abtn ink" data-a="win1" data-id="${esc(id)}" ${ui.busy ? 'disabled' : ''}>${ui.pending === 'win1:' + id ? busyHTML(undefined, 26) : esc(!me.local && id === me.id ? 'ME' : UP(nameOf(S, id)))}</button>`).join('')}</div>
      <div class="mlinks"><button class="melink" data-a="split">Split the pot</button></div>`;
  } else {
    const ready = ui.picks.length === pots.length && ui.picks.every((w) => w.length);
    body = pots.map((pot, i) => `<div class="mpot"><div class="lbl"><span>${pots.length > 1 ? (i === 0 ? 'MAIN POT' : 'SIDE POT ' + i) : 'TAP EVERY WINNER'}</span><span class="num">${money(pot.amount)}</span></div>
        <div class="mpick">${pot.eligible.map((id) => `<button class="abtn ink ${ui.picks[i] && ui.picks[i].includes(id) ? 'on' : ''}" data-a="pick" data-pot="${i}" data-id="${esc(id)}" aria-pressed="${!!(ui.picks[i] && ui.picks[i].includes(id))}">${esc(UP(nameOf(S, id)))}</button>`).join('')}</div></div>`).join('') +
      `${pots.length > 1 ? '<p class="msub">Someone went all in for less, so there are side pots. Only players who matched the bet can win each one. Tap two names to split.</p>' : ''}
      <button class="abtn ink mgo" id="b-award" data-a="award" ${ready && !ui.busy ? '' : 'disabled'}>${ui.pending === 'award' ? busyHTML('PAYING OUT…', 30) : `PAY ${ui.picks.some((w) => w.length > 1) || pots.length > 1 ? 'THE WINNERS' : 'THE WINNER'}`}</button>
      ${pots.length === 1 ? '<div class="mlinks"><button class="melink" data-a="split">One winner</button></div>' : ''}`;
  }
  return `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-title"><div class="mcard">
    <div class="mkick">SHOWDOWN</div>
    <div class="px mtitle" id="m-title">WHO TOOK IT?</div>
    <div class="px mamt num">${money(total)}</div>
    ${h.runout ? '<p class="msub">Deal out the rest of the board first, then show hands.</p>' : ''}
    ${body}
    <div class="mlinks"><button class="melink" data-a="menu">Table menu</button></div>
  </div></div>`;
}
