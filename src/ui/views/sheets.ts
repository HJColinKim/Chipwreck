/*
 * The bottom sheets: the table menu (code, ledger, blinds, undo, log) and the per-player
 * sheet behind tapping a seat (move, button, sit out, rebuy, fix stack, remove).
 */
import { esc, money, UP } from '../format.ts';
import { amHost, playerOf } from '../selectors.ts';
import type { Device, UiState } from '../state.ts';
import type { TableState } from '../../types.ts';

export function sheetHTML(S: TableState, ui: UiState, me: Device): string {
  if (!ui.sheet) return '';
  let inner = '';
  if (ui.sheet === 'menu') inner = menuHTML(S, me);
  else if (ui.sheet === 'player') inner = playerSheetHTML(S, ui, me);
  else if (ui.sheet === 'add') inner = `<h3>ADD PLAYER</h3><input id="in-add2" class="field" maxlength="18" placeholder="Name" value=""><button class="abtn mustard sm" data-a="add-player2">ADD WITH ${money(S.settings.startingStack)}</button>`;
  return `<div class="sheetwrap" data-a="close-sheet-bg"><div class="panel sheet" role="dialog" aria-modal="true">${inner}<button class="abtn off sm" data-a="close-sheet">CLOSE</button></div></div>`;
}

function menuHTML(S: TableState, me: Device): string {
  const host = amHost(S, me);
  const rows = S.players.map((p) => {
    const live = S.hand && S.hand.seats.includes(p.id) ? (S.hand.committed[p.id] || 0) : 0;
    const net = p.stack + live - p.buyIns * S.settings.startingStack;
    return `<tr data-a="player" data-id="${esc(p.id)}"><td>${esc(p.name)}</td><td>${p.buyIns}×</td><td>${money(p.stack)}</td><td class="${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}">${net > 0 ? '+' : ''}${money(net).replace('$-', '-$')}</td></tr>`;
  }).join('');
  const peer = me.kind === 'peer';
  return `<h3>${me.local ? 'ONE PHONE TABLE' : 'TABLE ' + esc(S.code)}</h3>
    ${!me.local ? `<p class="note">Friends join with code <b style="color:var(--mustard)">${esc(S.code)}</b>.${peer ? ' Keep the host’s phone awake with ChipWreck open.' : ''}</p>
      <div class="sgrid"><button class="abtn pine" data-a="copy-code">COPY CODE</button>${peer ? '<button class="abtn pine" data-a="copy-link">COPY LINK</button>' : ''}</div>` : ''}
    <h4 class="lbl">Players · tap to manage</h4>
    <div style="overflow-x:auto"><table class="ledger"><thead><tr><th>PLAYER</th><th>BUY-INS</th><th>STACK</th><th>NET</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${me.local && !S.hand ? '<button class="abtn pine sm" data-a="add-sheet">ADD PLAYER</button>' : ''}
    ${host ? `<h4 class="lbl">Blinds and buy-in</h4>
      <div class="three">
        <input id="in-s-stack" class="field" inputmode="numeric" aria-label="Buy-in" value="${S.settings.startingStack}">
        <input id="in-s-sb" class="field" inputmode="numeric" aria-label="Small blind" value="${S.settings.sb}">
        <input id="in-s-bb" class="field" inputmode="numeric" aria-label="Big blind" value="${S.settings.bb}">
      </div>
      <div class="sgrid"><button class="abtn pine" data-a="save-settings" ${S.hand ? 'disabled' : ''}>${S.hand ? 'AFTER THIS HAND' : 'SAVE'}</button>
      <button class="abtn pine" data-a="undo" ${S.history && S.history.length ? '' : 'disabled'}>UNDO LAST</button></div>` : ''}
    <h4 class="lbl">What happened</h4>
    <div class="logbox">${S.log.slice().reverse().map((l) => `<div>${esc(l)}</div>`).join('') || '<div>Nothing yet.</div>'}</div>
    <button class="abtn brick sm" data-a="leave">${me.local ? 'BACK TO START (SAVED)' : 'LEAVE TABLE'}</button>`;
}

function playerSheetHTML(S: TableState, ui: UiState, me: Device): string {
  const p = playerOf(S, ui.sheetPlayer);
  if (!p) return '<h3>PLAYER LEFT</h3>';
  const self = p.id === me.id || me.local;
  const host = amHost(S, me);
  const inHand = S.hand && S.hand.seats.includes(p.id);
  const between = !S.hand;
  const b = [];
  if (between) {
    b.push('<button class="abtn pine" data-a="pa" data-k="up">MOVE UP</button>');
    b.push('<button class="abtn pine" data-a="pa" data-k="down">MOVE DOWN</button>');
    if (S.buttonId !== p.id) b.push('<button class="abtn pine" data-a="pa" data-k="button">GIVE BUTTON</button>');
  }
  if (self || host) b.push(`<button class="abtn pine" data-a="pa" data-k="sit">${p.sittingOut ? 'BACK IN' : 'SIT OUT'}</button>`);
  if ((self || host) && !inHand) b.push(`<button class="abtn pine" data-a="pa" data-k="rebuy">REBUY</button>`);
  return `<h3>${esc(UP(p.name))}</h3><p class="note">Stack ${money(p.stack)} · ${p.buyIns} buy-in${p.buyIns > 1 ? 's' : ''}</p>
    ${b.length ? `<div class="sgrid">${b.join('')}</div>` : '<p class="note">Seat changes open up between hands.</p>'}
    ${host && between ? `<label class="flabel"><span class="lbl">Fix their stack</span><div class="addrow"><input id="in-adj" class="field" inputmode="numeric" value="${p.stack}"><button class="abtn pine" data-a="pa" data-k="adjust">SAVE</button></div></label>` : ''}
    ${(self || host) && !inHand ? `<button class="abtn ${ui.confirmRemove ? 'brick' : 'off'} sm" data-a="pa" data-k="remove">${ui.confirmRemove ? 'TAP AGAIN TO REMOVE' : 'REMOVE FROM TABLE'}</button>` : ''}`;
}
