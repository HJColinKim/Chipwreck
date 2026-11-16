/*
 * The DOM runtime the views sit on.
 *
 * Each screen mounts a skeleton once, then named regions are patched only when their HTML
 * changes, so CSS animations (riffle, logo bob) keep running and inputs keep focus. Also
 * here: the transient layers (toast, chip pops, street announcements) and the device bits
 * a browser only exposes imperatively — artboard scaling, wake lock, vibration.
 */
import { STREET } from './theme.ts';
import { esc } from './format.ts';
import { live } from './state.ts';
import type { StreetChange } from '../engine/index.ts';

export const $app = document.getElementById('app')!;

export const isMobile = (): boolean => window.innerWidth < 700;

// ---------------- mount and patch ----------------
let mounted: string | null = null;
/** Last HTML patched into each region, so an unchanged region is left completely alone. */
export const cache = new Map<string, string>();

/** Swaps in a screen's skeleton. Returns true on the render that actually mounted it. */
export function mount(name: string, html: string): boolean {
  if (mounted === name) return false;
  mounted = name; cache.clear();
  $app.innerHTML = html;
  return true;
}

export function patch(id: string, html: string): void {
  if (cache.get(id) === html) return;
  const el = document.getElementById(id);
  if (!el) return;
  cache.set(id, html);
  const a = document.activeElement as HTMLInputElement | null;
  const keep = a && a.id && el.contains(a) && a.tagName === 'INPUT'
    ? { id: a.id, start: a.selectionStart, end: a.selectionEnd }
    : null;
  el.innerHTML = html;
  if (keep) {
    const n = document.getElementById(keep.id) as HTMLInputElement | null;
    if (n) { n.focus(); try { n.setSelectionRange(keep.start, keep.end); } catch (e) { /* ignore */ } }
  }
}

// scale the 800x420 artboards to their frames
const ro = window.ResizeObserver ? new ResizeObserver((entries) => {
  for (const en of entries) {
    const el = en.target as HTMLElement, w = el.clientWidth, h = el.clientHeight;
    el.style.setProperty('--sc', String(el.classList.contains('stage') ? Math.min(w / 800, h / 420) : w / 800));
  }
}) : null;
export function observe(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  if (ro) ro.observe(el);
  const w = el.clientWidth, h = el.clientHeight;
  el.style.setProperty('--sc', String(el.classList.contains('stage') ? Math.min(w / 800, (h || 420) / 420) : w / 800));
}

// ---------------- transient layers ----------------
let toastTimer: ReturnType<typeof setTimeout>;
export function toast(msg: string, bad?: boolean): void {
  let el = document.querySelector<HTMLElement>('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.toggle('bad', !!bad);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, bad ? 3600 : 2200);
}

export function popAt(layerId: string, text: string, top: string, size: number): void {
  const layer = document.getElementById(layerId);
  if (!layer) return;
  const el = document.createElement('div');
  el.className = 'pop';
  el.style.top = top; el.style.fontSize = size + 'px';
  el.textContent = text;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

/**
 * Deliberately non-blocking. Each device plays this on its own, with nothing keeping the
 * devices in step, so the next player may already be acting while you are still watching
 * it — hence pointer-events:none on .announce, and no gating of the action buttons.
 *
 * Tune the beat here: STREET_MS mirrors the .ann duration in shell.html, the same pairing
 * popAt has with .pop.
 */
const STREET_MS = 1500;
export function announceStreet(c: StreetChange): void {
  const layer = document.getElementById('announce');
  if (!layer) return;
  layer.textContent = ''; // a quick check-through closes streets back to back; never stack two
  const el = document.createElement('div');
  el.className = 'ann';
  el.innerHTML = `<b>${esc(STREET[c.street])}</b><span>${esc(c.hint)}</span>`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), STREET_MS);
}

// ---------------- device ----------------
let wakeLock: WakeLockSentinel | null = null;
/** The host's phone has to stay awake to keep the table running, so ask on first touch. */
export function keepAwake(): void {
  if (wakeLock || !navigator.wakeLock || !live.S) return;
  navigator.wakeLock.request('screen').then((l) => { wakeLock = l; l.addEventListener('release', () => { wakeLock = null; }); }).catch(() => {});
}

export const buzz = (p: number | number[]): void => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* ignore */ } };
