/*
 * ChipWreck engine — a pure reducer for Texas Hold'em chip handling.
 * Cards are physical; this only tracks stacks, blinds, bets, pots and turns.
 *
 * This file is the engine's public surface. Nothing outside src/engine reaches past it.
 *
 *   types.ts    the persisted shapes every layer shares
 *   core.ts     street order, coercion, table lookups, the log
 *   table.ts    creating a table and seating players
 *   pots.ts     pot and side-pot maths
 *   hand.ts     dealing, the action order, closing streets, payouts
 *   betting.ts  fold / check / call / raise
 *   reduce.ts   the reducer: table administration plus dispatch into the above
 *   views.ts    read-only derivations for the UI
 */
export { DEAL_HINT } from './core.ts';
export { newTable } from './table.ts';
export type { NewTableOptions } from './table.ts';
export { computePots, potTotal } from './pots.ts';
export { reduce } from './reduce.ts';
export { boardCount, legal, positionName, positions, streetChange, toActAfter } from './views.ts';
export type { StreetChange, StreetPos } from './views.ts';
