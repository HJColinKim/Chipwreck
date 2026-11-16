/*
 * Chips, drawn in HTML: one chip, a stack of them, the riffling pair the lobby animates,
 * and the busy indicator that reuses it. Pure string builders — no state, no DOM.
 */
import { SIZE } from './theme.ts';
import type { ChipColors, ChipGeom, ChipLike, StackOpts } from './theme.ts';
import { esc } from './format.ts';

/** One chip: a top face, a striped side band, and the value on the inner disc. */
export function chipHTML(c: ChipLike, P: ChipGeom, top: number, label?: string, extraStyle?: string): string {
  const hw = P.w / 2;
  return `<div class="ch" style="left:0;top:${top}px;width:${P.w}px;height:${P.ry + P.sideH}px;${extraStyle || ''}">` +
    `<div class="ch-side" style="top:${P.ry}px;width:${P.w}px;height:${P.sideH}px;border-radius:0 0 ${hw}px ${hw}px / 0 0 ${P.ry}px ${P.ry}px;background:linear-gradient(90deg,rgba(0,0,0,${P.dk}),rgba(0,0,0,.4)),repeating-linear-gradient(90deg,${c.base} 0 ${P.a}px,${c.stripe} ${P.a}px ${P.b}px)"></div>` +
    `<div class="ch-face" style="width:${P.w}px;height:${P.face}px;background:repeating-conic-gradient(${c.base} 0deg 20deg,${c.stripe} 20deg 30deg)">` +
    `<div class="ch-in" style="inset:${P.inset};background:${c.base};${P.ring ? `border:${P.ring}px solid ${c.stripe};` : ''}color:${c.stripe};${P.label || ''}">${label || ''}</div></div></div>`;
}

/** n chips of one colour, value shown on the top chip only. */
export function stack3D(c: ChipLike, n: number, P: ChipGeom, opts?: StackOpts): string {
  opts = opts || {};
  const off = P.off!; // only stacked sizes are passed here, and those all define off
  const h = P.ry + P.sideH + off * (n - 1);
  let out = `<div style="position:relative;width:${P.w}px;height:${h}px;flex:none">`;
  out += `<div class="ch-shadow" style="left:${P.sh!}px;top:${P.sh!}px;width:${P.w}px;height:${opts.shadowH || h}px;border-radius:${P.w / 2}px / ${P.ry}px"></div>`;
  for (let i = 0; i < n; i++) out += chipHTML(c, P, (n - 1 - i) * off, opts.noLabel || i !== n - 1 ? '' : (opts.labelFn ? opts.labelFn(c) : c.label));
  return out + '</div>';
}

const RIF_RED: ChipColors = { base: '#B8432F', stripe: '#E3C35A' };
const RIF_BLK: ChipColors = { base: '#141a17', stripe: '#E3C35A' };
const RIF_W = 110, RIF_H = 100;

/** The two interleaving stacks mid-riffle, drawn into a RIF_W x RIF_H box. */
function rifStacksHTML(): string {
  const P = SIZE.rif;
  const one = (c: ChipColors, x: number, y: number, z: number, dx: number, dy: number, delay: number): string =>
    `<div class="abs rif" style="left:${x}px;top:${y}px;width:${P.w}px;height:${P.ry + P.sideH}px;z-index:${z};--dx:${dx}px;--dy:${dy}px;animation:cwRiffle 2.6s cubic-bezier(.6,0,.3,1) ${delay}s infinite">${chipHTML(c, P, 0, '')}</div>`;
  let kids = '';
  for (let i = 0; i < 5; i++) {
    kids += one(RIF_RED, 0, 64 - i * 7, 2 * i, 25, -i * 7, i * .05);
    kids += one(RIF_BLK, 50, 64 - i * 7, 2 * i + 1, -25, -(i + 1) * 7, i * .05 + .02);
  }
  return kids;
}

export function riffleHTML(left: number, top: number): string {
  const felt = `<div class="abs" style="left:6px;top:74px;width:100px;height:20px;border-radius:50%;background:#2A4B40"></div>`;
  return `<div class="abs" style="left:${left}px;top:${top}px;width:${RIF_W}px;height:${RIF_H}px">${felt}${rifStacksHTML()}</div>`;
}

/**
 * Busy indicator: the lobby's riffling chips scaled down to sit inside a button or a line
 * of text. Scaled rather than redrawn so the motion matches the home screen exactly.
 * `.rif` is disabled under prefers-reduced-motion, so pass a label wherever one fits —
 * with the chips frozen the label is all that is left saying the app is working.
 */
export function busyHTML(label?: string, h = 34): string {
  const s = h / RIF_H;
  // With a label the chips are decorative; without one they are the only content left,
  // so they have to announce themselves instead of being hidden.
  const a11y = label ? 'aria-hidden="true"' : 'role="img" aria-label="Working"';
  return `<span class="busy"><span class="rifspin" style="width:${Math.round(RIF_W * s)}px;height:${h}px" ${a11y}>`
    + `<span class="rifscale" style="transform:scale(${s})">${rifStacksHTML()}</span></span>`
    + (label ? `<span>${esc(label)}</span>` : '') + '</span>';
}
