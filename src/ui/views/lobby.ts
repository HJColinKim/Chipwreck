/*
 * The front screen: join a table by code, or create one. The frame it draws (logo, dealer,
 * riffling chips, one panel) is shared with the waiting room — see lobbySkeleton.
 */
import { busyHTML, riffleHTML, stack3D } from '../chips.ts';
import { dealerSVG, handsSVG, tableHTML } from '../scene.ts';
import { BLIND_OPTS, SIZE, STACK_OPTS } from '../theme.ts';
import { esc, money } from '../format.ts';
import { mount, observe, patch } from '../dom.ts';
import { store } from '../../transport/index.ts';
import type { Backend } from '../../transport/index.ts';
import type { UiState } from '../state.ts';

/** The lobby frame, with one empty panel for the caller to fill: the form, or the room. */
export function lobbySkeleton(panelId: string): string {
  const pile = [
    { c: { base: '#2F5D73', stripe: '#E3E7D8' }, n: 3 },
    { c: { base: '#141a17', stripe: '#E3C35A' }, n: 6 },
    { c: { base: '#E3C35A', stripe: '#141a17' }, n: 4 },
  ].map((p) => stack3D(p.c, p.n, SIZE.lobby, { noLabel: true })).join('');
  return `<main class="lobby">
    <div class="brand">
      <h1 class="logo">CHIPWRECK</h1>
      <div class="tags"><span style="color:var(--mustard)">REAL CARDS</span><span>DIGITAL CHIPS</span></div>
    </div>
    <div class="lgrid">
      <div class="hero" id="hero" aria-hidden="true"><div class="art">
        ${dealerSVG('lobby')}${tableHTML}${handsSVG}
        <div class="abs px" style="left:150px;top:240px;width:62px;height:88px;border-radius:6px;background:#E3E7D8;box-shadow:0 6px 0 #16291f;transform:rotate(-14deg);padding:6px 7px;box-sizing:border-box;color:#B8432F;font-size:24px;line-height:.8;text-shadow:none">A<div style="font-size:20px">♥</div></div>
        <div class="abs px" style="left:196px;top:250px;width:62px;height:88px;border-radius:6px;background:#E3E7D8;box-shadow:0 6px 0 #16291f;transform:rotate(6deg);padding:6px 7px;box-sizing:border-box;color:#141a17;font-size:24px;line-height:.8;text-shadow:none">A<div style="font-size:20px">♠</div></div>
        <div class="abs" style="left:300px;top:200px;width:200px;height:110px;display:flex;align-items:flex-end;justify-content:center;gap:6px">${pile}</div>
        ${riffleHTML(560, 250)}
      </div></div>
      <section class="panel lpanel" id="${panelId}"></section>
    </div>
  </main>`;
}

export function renderLobbyForm(ui: UiState, net: Backend | null): void {
  if (mount('lobby', lobbySkeleton('lpanel'))) observe('hero');
  const ready = ui.name.trim() && (ui.tab === 'create' || ui.code.length === 4);
  const last = store.get('chipstack:last');
  const hosted = net && net.hostedCodes ? net.hostedCodes() : [];
  const hasLocal = !!store.get('chipstack:local');
  const seg = (on: boolean, label: string, a: string, v: string | number): string => `<button class="abtn ${on ? 'mustard' : 'pine'}" data-a="${a}" data-v="${v}" aria-pressed="${on}">${label}</button>`;
  const extras = [];
  if (last && last !== ui.code) extras.push(`<button class="textlink" data-a="rejoin" data-code="${esc(last)}">Rejoin ${esc(last)}</button>`);
  hosted.filter((c) => c !== last).slice(0, 2).forEach((c) => extras.push(`<button class="textlink" data-a="rejoin" data-code="${esc(c)}">Resume hosting ${esc(c)}</button>`));
  extras.push('<button class="textlink" data-a="local">One phone for everyone</button>');
  if (hasLocal) extras.push('<button class="textlink" data-a="local-continue">Continue one-phone table</button>');
  patch('lpanel', `
    <div class="tabs" role="tablist">
      <button class="abtn ${ui.tab === 'join' ? 'blue' : 'off'}" data-a="tab" data-v="join" role="tab" aria-selected="${ui.tab === 'join'}">JOIN</button>
      <button class="abtn ${ui.tab === 'create' ? 'brick' : 'off'}" data-a="tab" data-v="create" role="tab" aria-selected="${ui.tab === 'create'}">CREATE</button>
    </div>
    ${ui.tab === 'join' ? `
    <label class="flabel"><span class="lbl">Table code</span>
      <input id="in-code" class="field codein" maxlength="4" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="4F2K" value="${esc(ui.code)}"></label>` : `
    <div class="flabel"><span class="lbl">Starting stack</span><div class="seg">${STACK_OPTS.map((v) => seg(ui.stack === v, money(v), 'stack', v)).join('')}</div></div>
    <div class="flabel"><span class="lbl">Blinds</span><div class="seg">${BLIND_OPTS.map((b, i) => seg(ui.blinds === i, `$${b[0]}/$${b[1]}`, 'blinds', i)).join('')}</div></div>`}
    <label class="flabel"><span class="lbl">Your name</span>
      <input id="in-name" class="field" maxlength="18" autocomplete="nickname" placeholder="What the table calls you" value="${esc(ui.name)}"></label>
    <button id="b-submit" class="abtn submit ${ready ? 'mustard' : 'dead'}" data-a="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy ? busyHTML(ui.tab === 'join' ? 'JOINING…' : 'DEALING YOU IN…', 40) : ui.tab === 'join' ? 'JOIN TABLE' : 'CREATE TABLE'}</button>
    ${ui.err ? `<div class="errpill" role="alert">${esc(ui.err)}</div>` : ''}
    ${!net ? `<p class="note">${ui.homeNote ? esc(ui.homeNote) : busyHTML('Connecting…', 22)}</p>` : ''}
    <div class="extras">${extras.join('')}</div>`);
}

/**
 * Keystrokes in the lobby only change whether SUBMIT is live, so they touch those classes
 * directly instead of patching the panel out from under the input the player is typing in.
 */
export function refreshSubmit(ui: UiState): void {
  const b = document.getElementById('b-submit');
  if (!b) return;
  const ready = ui.name.trim() && (ui.tab === 'create' || ui.code.length === 4);
  b.classList.toggle('mustard', !!ready); b.classList.toggle('dead', !ready);
  const err = document.querySelector('#lpanel .errpill');
  if (err && ui.err === '') err.remove();
}
