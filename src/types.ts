/*
 * Shared domain types for ChipWreck.
 *
 * These describe the table state that gets persisted (localStorage, the claude.ai
 * artifact db) and relayed between devices, so treat them as a stored format:
 * changing a field's shape needs a migration for tables already saved on phones.
 */

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface Settings {
  startingStack: number;
  sb: number;
  bb: number;
}

export interface Player {
  id: string;
  name: string;
  stack: number;
  buyIns: number;
  sittingOut: boolean;
}

export interface Pot {
  amount: number;
  eligible: string[];
}

export interface Win {
  id: string;
  amount: number;
}

export interface HandResult {
  handNo: number;
  wins: Win[];
}

/** Per-player maps are keyed by player id and only hold entries for seated players. */
export interface Hand {
  no: number;
  street: Street;
  seats: string[];
  buttonId: string;
  sbId: string;
  bbId: string;
  bets: Record<string, number>;
  committed: Record<string, number>;
  folded: Record<string, boolean>;
  allIn: Record<string, boolean>;
  acted: Record<string, boolean>;
  last: Record<string, string>;
  currentBet: number;
  minRaise: number;
  toAct: string | null;
  /** Only present once the street reaches showdown. */
  pots?: Pot[];
  /** Set when everyone is all in and the board still has to be dealt out. */
  runout?: boolean;
}

export interface TableState {
  code: string;
  version: number;
  hostId: string | null;
  settings: Settings;
  players: Player[];
  buttonId: string | null;
  handNo: number;
  hand: Hand | null;
  lastResult: HandResult | null;
  log: string[];
  history: Snapshot[];
  updatedAt?: number;
}

/** A history entry drops its own history, so undo snapshots do not nest. */
export type Snapshot = Omit<TableState, 'history'>;

/** What the acting player is allowed to do right now, derived for the UI. */
export interface LegalMoves {
  toCall: number;
  canCheck: boolean;
  canRaise: boolean;
  minTo: number;
  maxTo: number;
  mine: number;
  isBet: boolean;
  pot: number;
  currentBet: number;
}

/**
 * Numeric fields that can arrive as strings: the UI passes raw <input> values
 * straight through, and the engine coerces them with int().
 */
type Num = number | string;

interface ByDevice {
  /** The acting device's player id. '*' means one-phone mode, which is always host. */
  by: string;
}

export type Action =
  | (ByDevice & { type: 'join'; name?: string })
  | (ByDevice & { type: 'leave'; player?: string })
  | (ByDevice & { type: 'sitOut'; player?: string; value: boolean })
  | (ByDevice & { type: 'move'; player: string; dir: number })
  | (ByDevice & { type: 'button'; player: string })
  | (ByDevice & { type: 'rebuy'; player?: string })
  | (ByDevice & { type: 'adjust'; player: string; stack: Num })
  | (ByDevice & { type: 'settings'; startingStack?: Num; sb?: Num; bb?: Num })
  | (ByDevice & { type: 'deal' })
  | (ByDevice & { type: 'fold' | 'check' | 'call'; player?: string })
  | (ByDevice & { type: 'raise'; to: Num; player?: string })
  | (ByDevice & { type: 'award'; winners: string[][] })
  | (ByDevice & { type: 'undo' });

export type ActionType = Action['type'];

/** Distributes over the union so each member keeps its own fields. */
type Submittable<T> = T extends unknown ? Omit<T, 'by'> & { by?: string } : never;

/**
 * What the UI hands to a backend. The backend stamps `by` from the identity it
 * trusts, so a device can never claim to be someone else.
 */
export type ActionInput = Submittable<Action>;
