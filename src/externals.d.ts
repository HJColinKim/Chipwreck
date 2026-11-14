/*
 * Hand-written declarations for the two runtimes ChipWreck talks to but which ship
 * no types here: the claude.ai artifact host, and mqtt.js loaded from a CDN at runtime.
 *
 * These describe only the surface this app actually uses, not the full APIs.
 */
import type { TableState } from './types.ts';

// ---------------- claude.ai artifact host ----------------

export interface DocSnapshot {
  id: string;
  exists: boolean;
  data(): TableState | null;
}

export interface DocRef {
  get(): Promise<DocSnapshot>;
  set(data: TableState): Promise<void>;
  /** Cooperative lease so two devices cannot write the same table at once. */
  acquire(opts: { holder: string; ttlMs: number }): Promise<{ acquired: boolean }>;
  onSnapshot(next: (s: DocSnapshot) => void, onError: (e: unknown) => void): () => void;
}

export interface ClaudeDb {
  doc(path: string): DocRef;
}

export interface ClaudeUser {
  id(): Promise<string | null>;
}

export interface RoomPeer {
  presence?: { pid?: unknown };
}

export interface RoomHandle {
  on(event: string, cb: (m: { isMe?: boolean; data?: { v?: number } }) => void): () => void;
  emit(event: string, data: unknown): Promise<void>;
  presence(p: { pid: string }): Promise<void>;
  onPeers(cb: () => void): () => void;
  peers(): RoomPeer[];
  leave(): Promise<void>;
}

export interface ClaudeRoom {
  join(name: string): Promise<RoomHandle>;
}

/** Errors from the db carry a machine-readable code rather than being Error instances. */
export interface DbError {
  code?: 'unavailable' | 'invalid_argument' | 'quota_exceeded' | string;
  message?: string;
}

// ---------------- mqtt.js ----------------

export interface MqttClient {
  connected: boolean;
  on(event: 'connect', cb: () => void): void;
  on(event: 'message', cb: (topic: string, payload: Uint8Array) => void): void;
  on(event: 'error', cb: (e: unknown) => void): void;
  subscribe(topic: string, opts: { qos: 0 | 1 | 2 }): void;
  publish(topic: string, message: string, opts: { qos: 0 | 1 | 2; retain: boolean }): void;
  end(force?: boolean): void;
}

export interface MqttLib {
  connect(url: string, opts: Record<string, unknown>): MqttClient;
}

declare global {
  interface Window {
    claude?: {
      use(name: 'db'): Promise<ClaudeDb | null>;
      use(name: 'user'): Promise<ClaudeUser | null>;
      use(name: 'room'): Promise<ClaudeRoom | null>;
      use(name: string): Promise<unknown>;
      hot?: { ready(cb: () => void): void };
    };
    mqtt?: MqttLib;
    /** Set by test/net_smoke.py to point the relay at a local broker. */
    CHIPSTACK_BROKERS?: string[];
  }
}
