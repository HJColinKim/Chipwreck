/*
 * The table screen: the pot on the felt, the seats, your chip tray and the action row.
 * The skeleton mounts once; everything below patches the regions that changed.
 */
import { boardCount, positionName, positions, potTotal, toActAfter } from '../../engine/index.ts';
import { busyHTML, chipHTML, riffleHTML, stack3D } from '../chips.ts';
import { avatarHTML, boardHTML, dealerSVG, handsSVG, tableHTML } from '../scene.ts';
import { CHIPS, SIZE, STREET, avatarColor, byV, greedy } from '../theme.ts';
import { esc, money, UP } from '../format.ts';
import { isMobile, mount, observe, patch } from '../dom.ts';
import { actorId, amHost, eligibleCount, lastLine, nameOf, playState, playerOf, ringFrom, statusOf, viewerId } from '../selectors.ts';
import { overlayHTML } from './overlay.ts';
import type { Device, UiState } from '../state.ts';
import type { Player, TableState } from '../../types.ts';

const tableSkeleton = (): string => `<main class="tbl" id="tbl">
    <header class="thead">
      <button class="brandbtn" data-a="menu" aria-label="Table menu"><span class="mini-chip"><i></i></span><span class="px" style="font-size:20px;letter-spacing:.01em">CHIPWRECK</span></button>
      <div class="hpills"><div id="hHand"></div><div id="hBlinds"></div><button data-a="menu">MENU</button></div>
    </header>
    <section class="tpot" aria-label="Pot">
      <div class="stage" id="stage">
        <div class="pops" id="potPops"></div>
        <div class="art" aria-hidden="true">
          ${dealerSVG('table')}${tableHTML}
          <div class="abs" style="left:122px;top:282px;width:58px;height:58px;border-radius:50%;background:#E3E7D8;box-shadow:0 6px 0 #16291f;display:flex;align-items:center;justify-content:center">
            <div class="px" style="width:42px;height:42px;border-radius:50%;border:2px solid #141a17;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-size:20px;color:#141a17">D</div></div>
          <div class="abs" style="left:612px;top:262px;width:54px;height:76px;border-radius:5px;background:#B8432F;border:4px solid #E3E7D8;box-sizing:border-box;transform:rotate(14deg)"></div>
          <div class="abs" style="left:604px;top:258px;width:54px;height:76px;border-radius:5px;background:#B8432F;border:4px solid #E3E7D8;box-sizing:border-box;box-shadow:0 6px 0 #16291f;transform:rotate(4deg)"></div>
          ${handsSVG}${riffleHTML(560, 322)}
          <div class="potpile" id="potPile"></div>
          <div class="potlabel" id="potLabel"></div>
          <div class="board" id="board"></div>
        </div>
        <div class="spill turn" id="turnPill" aria-live="polite"></div>
        <div class="spill street" id="streetPill"></div>
        <div class="announce" id="announce" aria-hidden="true"></div>
      </div>
      <div class="slast" id="lastLine" aria-live="polite"></div>
    </section>
    <section class="tplayers" aria-label="Players">
      <div class="phead"><div class="sec">PLAYERS</div><small id="pcount"></small></div>
      <div class="seats" id="seats"></div>
    </section>
    <section class="tchips" aria-label="Your chips">
      <div class="cardhead"><div class="sec">CHIPS</div><div id="avail" style="font-size:15px;font-weight:900" class="num"></div></div>
      <div class="tray" id="tray"></div>
    </section>
    <section class="tstack" aria-label="Your play">
      <div class="cardhead"><div class="sec">YOUR PLAY</div><button class="textlink" data-a="clear">Clear</button></div>
      <div class="zone" id="zone"><div class="pops" id="zonePops"></div><div id="zoneInner"></div></div>
    </section>
    <section class="tme" id="me"></section>
    <section class="tactions" id="actions"></section>
  </main>
  <div id="overlay"></div>`;

export function renderTable(S: TableState, ui: UiState, me: Device, online: Set<string>): void {
  if (mount('table', tableSkeleton())) observe('stage');
  const h = S.hand;
  const actor = actorId(S, ui, me);
  const viewer = viewerId(S, ui, me);
  const vp = playerOf(S, viewer);
  const myTurn = !!actor;
  document.getElementById('tbl')!.classList.toggle('wait', !myTurn);

  // draft resets when the turn, street or bet changes
  const key = actor ? `${h!.no}|${h!.street}|${actor}|${h!.currentBet}` : '';
  if (key !== ui.stageKey) { ui.staged = []; ui.confirmFold = false; ui.stageKey = key; }
  const staged = ui.staged.reduce((a, b) => a + b, 0);

  patch('hHand', `HAND ${h ? h.no : Math.max(1, S.handNo + (S.lastResult ? 0 : 1))}`);
  patch('hBlinds', `$${S.settings.sb} / $${S.settings.bb}`);

  // stage
  const pot = potTotal(S.hand);
  const groups: Record<number, number> = {}; greedy(pot).forEach((v) => { groups[v] = (groups[v] || 0) + 1; });
  patch('potPile', CHIPS.filter((c) => groups[c.v]).reverse().map((c) => stack3D(c, Math.min(groups[c.v], 7), SIZE.pot)).join(''));
  patch('potLabel', `<b>POT</b><span class="px num">${money(pot)}</span>`);
  patch('board', h ? boardHTML(boardCount(h.street)) : '');
  let turnText, turnBg = 'var(--pine)', turnInk = 'var(--linen)';
  if (h && h.street === 'showdown') turnText = 'SHOWDOWN';
  else if (h && h.toAct) {
    if (me.local || h.toAct === me.id) { turnText = me.local ? `${UP(nameOf(S, h.toAct))}’S TURN` : 'YOUR TURN'; turnBg = 'var(--mustard)'; turnInk = 'var(--ink)'; }
    else turnText = `${UP(nameOf(S, h.toAct))}’S TURN`;
  } else turnText = S.lastResult ? 'HAND OVER' : 'WAITING TO DEAL';
  patch('turnPill', `<span style="display:contents">${esc(turnText)}</span>`);
  const tp = document.getElementById('turnPill')!; tp.style.background = turnBg; tp.style.color = turnInk;
  patch('streetPill', h ? STREET[h.street] : 'BETWEEN HANDS');
  patch('lastLine', esc(lastLine(S)));

  // players, listed clockwise from the viewer so the seat below you is the one that acts
  // after you — S.players is the seat ring, and a flat slice of it reads as no order at all
  const others = ringFrom(S, viewer);
  const pos = h ? positions(h) : {};
  const liveCount = h ? h.seats.filter((id) => !h.folded[id]).length : eligibleCount(S);
  patch('pcount', h ? `${liveCount} IN HAND` : `${S.players.length} SEATED`);
  patch('seats', others.length ? others.map((p) => seatHTML(S, me, online, p, pos[p.id])).join('') : `<div class="empty-seats">${me.local ? 'Add players from the table menu.' : `Nobody else yet. Share code ${esc(S.code)}.`}</div>`);

  // tray
  const stack = vp ? vp.stack : 0;
  const avail = stack - staged;
  patch('avail', money(avail));
  patch('tray', CHIPS.map((c) => {
    const ok = myTurn && c.v <= avail;
    return `<div class="tchip ${ok ? '' : 'no'}" data-chip="${c.v}" role="button" tabindex="${myTurn ? 0 : -1}" aria-label="Add ${c.label}" aria-disabled="${!ok}"><div>${stack3D(c, 3, SIZE.tray, { shadowH: 76, labelFn: (x) => `<span style="font-size:${x.v === 100 ? 17 : 20}px">${x.label}</span>` })}</div></div>`;
  }).join(''));

  // zone
  const maxV = isMobile() ? 8 : 5;
  const shown = ui.staged.slice(-maxV), n = shown.length, offset = ui.staged.length - n;
  const stackH = n ? 68 + 20 * n : 0;
  let zone = '';
  if (!n) zone = `<div class="zhint">${myTurn ? 'DRAG OR TAP CHIPS TO STACK YOUR PLAY' : 'WAIT FOR YOUR TURN'}</div>`;
  else {
    zone = `<div class="ztotal px num">${money(staged)}</div><div class="zstack" style="height:${stackH}px">
      <div class="ch-shadow" style="left:20px;top:20px;width:170px;height:${stackH}px;border-radius:85px / 34px"></div>
      ${shown.map((v, i) => `<div class="zchip" data-zchip="${offset + i}" style="top:${(n - 1 - i) * 20}px" aria-label="Remove ${byV(v)!.label}">${chipHTML(byV(v)!, SIZE.zone, 0, i === n - 1 ? byV(v)!.label : '')}</div>`).join('')}
    </div>`;
  }
  patch('zoneInner', zone);

  patch('me', meHTML(S, ui, me, viewer, myTurn));
  const wonMe = !h && S.lastResult && S.lastResult.wins.some((w) => w.id === viewer);
  document.getElementById('me')!.classList.toggle('hot', myTurn || !!wonMe);
  patch('actions', actionsHTML(S, ui, actor, viewer, staged));
  patch('overlay', overlayHTML(S, ui, me));
}

function seatHTML(S: TableState, me: Device, online: Set<string>, p: Player, pos?: string): string {
  const h = S.hand;
  const inHand = h && h.seats.includes(p.id);
  const acting = h && h.toAct === p.id && h.street !== 'showdown';
  const won = !h && S.lastResult && S.lastResult.wins.some((w) => w.id === p.id);
  const dim = (inHand && h.folded[p.id]) || (!inHand && (p.sittingOut || p.stack === 0));
  const isDealer = (h ? h.buttonId : S.buttonId) === p.id;
  const bet = inHand ? (h.bets[p.id] || 0) : 0;
  let st = statusOf(S, p);
  if (!me.local && online.size && !online.has(p.id) && !acting) st += ' · away';
  return `<button class="seat ${acting || won ? 'hot' : ''} ${dim ? 'dim' : ''}" data-a="player" data-id="${esc(p.id)}">
    ${avatarHTML(avatarColor(p.id), isDealer)}
    <div class="who">
      <div class="nmrow"><div class="nm">${esc(p.name)}</div>${pos ? `<span class="pos">${esc(pos)}</span>` : ''}</div>
      <div class="st">${esc(st)}</div></div>
    <div class="money"><div class="bet px num">${money(bet)}</div><div class="of num">of ${money(p.stack)}</div></div>
  </button>`;
}

function meHTML(S: TableState, ui: UiState, me: Device, viewer: string | null, myTurn: boolean): string {
  const p = playerOf(S, viewer);
  if (!p) {
    return `<div class="merow">${avatarHTML('var(--ink)', false, 'var(--mustard)')}<div><div class="px mename">YOU</div><div class="mesub">Not seated at this table</div></div></div>
      <button class="abtn ink sm" style="height:52px;font-size:20px;--drop:0px;box-shadow:none" data-a="sit-back">JOIN THIS TABLE</button>`;
  }
  const h = S.hand;
  const isMe = !me.local && viewer === me.id;
  const inRound = h && h.seats.includes(p.id) ? (h.bets[p.id] || 0) : 0;
  const status = myTurn ? (isMe ? 'Your turn' : me.local ? 'Your turn. Pass the phone after.' : `Acting for ${p.name}`) : statusOf(S, p);
  const isDealer = (h ? h.buttonId : S.buttonId) === p.id;
  // Where you are, in words. A code like CO means nothing unless you already know it, and
  // the count is the part that actually changes a decision.
  const pos = h && h.seats.includes(p.id) ? positions(h)[p.id] : '';
  let posLine = '';
  if (pos) {
    const canStillAct = h!.street !== 'showdown' && !h!.folded[p.id] && !h!.allIn[p.id];
    const after = canStillAct ? toActAfter(h!, p.id) : -1;
    const tail = after < 0 ? '' : after === 0 ? ' · last to act' : ` · ${after} still to act after`;
    posLine = `<div class="mesub">${esc((isMe ? 'You’re ' : UP(p.name) + ' is ') + positionName(pos) + tail)}</div>`;
  }
  let extra = '';
  if (!me.local && amHost(S, me) && h && h.toAct && h.toAct !== me.id && h.street !== 'showdown') {
    extra = ui.actFor ? '<button class="melink" data-a="stop-act">Stop acting for them</button>'
      : `<button class="melink" data-a="act-for">Act for ${esc(nameOf(S, h.toAct))} (phone died?)</button>`;
  }
  return `<div class="merow">${avatarHTML('var(--ink)', isDealer, 'var(--mustard)')}
      <div style="display:flex;flex-direction:column;gap:3px;min-width:0"><div class="px mename">${isMe ? 'YOU' : esc(UP(p.name))}${pos ? `<span class="pos">${esc(pos)}</span>` : ''}</div><div class="mesub">${esc(status)}</div>${posLine}</div></div>
    <div style="display:flex;flex-direction:column;gap:4px">
      <div style="font-size:11px;font-weight:900;letter-spacing:.14em;color:var(--pine)">STACK</div>
      <div class="px mestack num">${money(p.stack - (myTurn ? ui.staged.reduce((a, b) => a + b, 0) : 0))}</div>
      <div class="mesub num">${money(inRound)} in this round</div>
      ${extra}
    </div>`;
}

function actionsHTML(S: TableState, ui: UiState, actor: string | null, viewer: string | null, staged: number): string {
  const h = S.hand;
  const vp = playerOf(S, viewer);
  const mine = h && vp ? (h.bets[viewer!] || 0) : 0;
  const toCall = h && vp ? Math.max(0, Math.min(h.currentBet - mine, vp.stack)) : 0;
  const cc = toCall > 0 ? (vp && toCall >= vp.stack ? `ALL IN ${money(toCall)}` : `CALL ${money(toCall)}`) : 'CHECK';
  const ps = playState(S, actor, staged);
  const dis = !actor || ui.busy ? 'disabled' : '';
  // These buttons are too narrow for a spinner beside their label, and the player just
  // pressed the one that is waiting, so the spinner replaces the label outright.
  const bz = (tag: string, label: string): string => (ui.pending === tag ? busyHTML(undefined, 30) : label);
  return `<button class="abtn linen fold ${ui.confirmFold ? 'sure' : ''}" id="b-fold" data-a="fold" ${dis}>${bz('fold', ui.confirmFold ? 'REALLY FOLD?' : 'FOLD')}</button>
    <button class="abtn linen" id="b-call" data-a="checkcall" ${dis}>${bz('checkcall', cc)}</button>
    <button class="abtn linen" id="b-allin" data-a="allin" ${dis}>${bz('allin', 'ALL IN')}</button>
    <button class="abtn play ${ps.ok ? 'ok' : 'no'}" id="b-play" data-a="play" ${dis}>${bz('play', ps.label)}</button>`;
}
