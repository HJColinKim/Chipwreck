/*
 * The contract every sync backend implements, plus the subscription plumbing they share.
 *
 * A backend owns one table: it knows this device's player id, accepts actions, and pushes
 * whole TableStates back out. The UI only ever talks to this interface, so swapping the
 * claude.ai db for MQTT or for one phone changes nothing above this line.
 */
import type { ActionInput, Settings, TableState } from '../types.ts';

export type BackendKind = 'claude' | 'peer' | 'local';
export type CreateSettings = Partial<Settings>;

export interface Backend {
  kind: BackendKind;
  me: { id: string };
  state: TableState | null;
  create(settings: CreateSettings, name: string): Promise<string>;
  open(code?: string): Promise<unknown>;
  submit(action: ActionInput): Promise<TableState>;
  onState(cb: (s: TableState) => void): () => void;
  onOnline?(cb: (ids: Set<string>) => void): () => void;
  hostedCodes?(): string[];
  close(): void;
}

// ---------- primitives every backend needs ----------
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Unique enough for a device id or a message id, short enough to read in a log. */
export const rid = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
// no O/0/I/1: the code gets read out loud across a table
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const makeCode = (): string =>
  Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');

/**
 * State fan-out shared by all three backends. Late subscribers get the current state
 * immediately, and a state older than the one already held is dropped — relays can
 * deliver out of order, and going backwards would undo a move on screen.
 */
export class Emitter {
  state: TableState | null = null;
  online: Set<string> = new Set();
  private subs = new Set<(s: TableState) => void>();
  private onlineSubs = new Set<(ids: Set<string>) => void>();

  onState(cb: (s: TableState) => void): () => void {
    this.subs.add(cb);
    if (this.state) cb(this.state);
    return () => { this.subs.delete(cb); };
  }
  onOnline(cb: (ids: Set<string>) => void): () => void {
    this.onlineSubs.add(cb);
    return () => { this.onlineSubs.delete(cb); };
  }
  push(s: TableState | null | undefined): void {
    if (!s) return;
    if (this.state && this.state.code === s.code && (s.version || 0) < (this.state.version || 0)) return;
    this.state = s;
    this.subs.forEach((cb) => cb(s));
  }
  setOnline(set: Set<string>): void {
    this.online = set;
    this.onlineSubs.forEach((cb) => cb(set));
  }
}
