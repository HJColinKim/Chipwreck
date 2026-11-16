/*
 * Pot maths. Side pots fall out of what each player has committed over the hand:
 * every distinct commitment level among live players opens a pot that only the
 * players who reached that level can win.
 */
import type { Hand, Pot } from '../types.ts';

export function computePots(hand: Hand): Pot[] {
  const ids = hand.seats;
  const live = ids.filter((id) => !hand.folded[id]);
  const levels = [...new Set(live.map((id) => hand.committed[id] || 0))].filter((v) => v > 0).sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const lvl of levels) {
    let amount = 0;
    for (const id of ids) {
      const c = hand.committed[id] || 0;
      amount += Math.max(0, Math.min(c, lvl) - Math.min(c, prev));
    }
    const elig = live.filter((id) => (hand.committed[id] || 0) >= lvl);
    if (amount > 0) {
      const last = pots[pots.length - 1];
      // merge pots with identical eligibility
      if (last && last.eligible.join() === elig.join()) last.amount += amount;
      else pots.push({ amount, eligible: elig });
    }
    prev = lvl;
  }
  // folded chips above the top live level (rare) go to the last pot
  let extra = 0;
  for (const id of ids) extra += Math.max(0, (hand.committed[id] || 0) - prev);
  if (extra && pots.length) pots[pots.length - 1].amount += extra;
  return pots;
}

export const potTotal = (hand: Hand | null): number =>
  hand ? hand.seats.reduce((t, id) => t + (hand.committed[id] || 0), 0) : 0;
