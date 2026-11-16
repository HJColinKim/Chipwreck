/*
 * Design constants: the chip set, chip geometry per size, palettes and the lobby options.
 * Shapes and values only — the HTML that draws them is in chips.ts and scene.ts.
 */
import type { Street } from '../types.ts';

export interface ChipColors { base: string; stripe: string }
/** Tray/pot chips also carry a denomination; decorative ones (riffle, lobby pile) do not. */
export type ChipLike = ChipColors & { v?: number; label?: string };
export interface ChipSpec extends ChipColors { v: number; label: string }
/** Chip geometry per size. off/sh/label are only set for sizes that get stacked or labelled. */
export interface ChipGeom {
  w: number; face: number; ry: number; sideH: number;
  a: number; b: number; inset: string; ring: number; dk: number;
  off?: number; sh?: number; label?: string;
}
export type SizeName = 'pot' | 'tray' | 'zone' | 'rif' | 'lobby';
export interface StackOpts { noLabel?: boolean; shadowH?: number; labelFn?: (c: ChipLike) => string }

export const CHIPS: ChipSpec[] = [
  { v: 5, label: '$5', base: '#B8432F', stripe: '#E3C35A' },
  { v: 10, label: '$10', base: '#2F5D73', stripe: '#E3E7D8' },
  { v: 25, label: '$25', base: '#E3C35A', stripe: '#141a17' },
  { v: 100, label: '$100', base: '#141a17', stripe: '#E3C35A' },
];
export const byV = (v: number): ChipSpec | undefined => CHIPS.find((c) => c.v === v);

/** Fewest chips that add up to `amount`, biggest first. */
export function greedy(amount: number): number[] {
  const r: number[] = []; let rem = amount;
  for (const d of [100, 25, 10, 5]) while (rem >= d) { r.push(d); rem -= d; }
  return r;
}

const AVATAR = ['#141a17', '#B8432F', '#2F5D73', '#839E9F', '#3B7955'];
/**
 * Keyed off the player id rather than their index in S.players, so a seat moving — or
 * anyone leaving — never recolours the rest of the table. Colour is a recognition aid, and
 * it is worthless if it changes under you. Tables past five share colours either way.
 */
export function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR[hash % AVATAR.length];
}
export const ROOM_COLORS = ['#E3C35A', '#B8432F', '#2F5D73', '#839E9F', '#3B7955'];
export const STREET: Record<Street, string> = {
  preflop: 'PREFLOP', flop: 'FLOP', turn: 'TURN', river: 'RIVER', showdown: 'SHOWDOWN',
};
export const STACK_OPTS = [500, 1000, 2000];
export const BLIND_OPTS = [[5, 10], [10, 20], [25, 50]];

const PIXEL = 'font-family:var(--pixel);font-weight:400;letter-spacing:.03em;text-shadow:var(--fringe)';
// chip geometry per size (top face height, side band, stripe widths, inner inset, ring, stack offset, shadow offset)
export const SIZE: Record<SizeName, ChipGeom> = {
  pot:   { w: 76,  face: 32, ry: 16, sideH: 28, a: 10, b: 16, inset: '14% 12%', ring: 1.5, dk: .05, off: 11, sh: 10, label: 'font-size:13px;font-weight:900' },
  tray:  { w: 104, face: 44, ry: 22, sideH: 38, a: 13, b: 22, inset: '13% 12%', ring: 2,   dk: .06, off: 16, sh: 20, label: PIXEL + ';font-size:20px' },
  zone:  { w: 170, face: 68, ry: 34, sideH: 54, a: 20, b: 33, inset: '13% 11%', ring: 2,   dk: .06, off: 20, sh: 20, label: PIXEL + ';font-size:20px' },
  rif:   { w: 44,  face: 18, ry: 9,  sideH: 17, a: 6,  b: 10, inset: '18% 14%', ring: 0,   dk: .05 },
  lobby: { w: 60,  face: 26, ry: 13, sideH: 23, a: 8,  b: 13, inset: '16% 12%', ring: 0,   dk: .05, off: 9, sh: 8 },
};
