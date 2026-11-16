/*
 * Backend for running as a claude.ai artifact: the table lives in a shared artifact db
 * document, and a live room is used only to poke the other devices into re-reading it.
 *
 * Writes take a short cooperative lease on the document, so two phones acting at the
 * same moment cannot both reduce from the same stale state.
 */
import { Emitter, makeCode, rid, sleep } from './backend.ts';
import type { Backend, CreateSettings } from './backend.ts';
import { newTable, reduce } from '../engine/index.ts';
import type { Action, ActionInput, TableState } from '../types.ts';
import type { ClaudeDb, ClaudeRoom, ClaudeUser, DbError, DocRef, RoomHandle } from '../externals.d.ts';

export class ClaudeBackend extends Emitter implements Backend {
  readonly kind = 'claude';
  me: { id: string } = { id: '' };
  private db: ClaudeDb;
  private user: ClaudeUser | null;
  private room: ClaudeRoom | null;
  private tab = rid();
  private code = '';
  private r: RoomHandle | null = null;
  private unsub: (() => void) | null = null;
  private offPoke: (() => void) | null = null;
  private offPeers: (() => void) | null = null;

  constructor(db: ClaudeDb, user: ClaudeUser | null, room: ClaudeRoom | null) {
    super();
    this.db = db;
    this.user = user;
    this.room = room;
  }

  async init(): Promise<this> {
    const id = this.user ? await this.user.id() : null;
    if (!id) throw new Error('Sign in to claude.ai to join a table.');
    this.me = { id: 'u' + String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) };
    return this;
  }

  private ref(code: string): DocRef { return this.db.doc('tables/' + code); }

  private async withLease(
    code: string,
    fn: (cur: TableState | null) => TableState | null,
  ): Promise<TableState | null> {
    const ref = this.ref(code);
    for (let i = 0; i < 40; i++) {
      let r: { acquired: boolean } | undefined;
      try { r = await ref.acquire({ holder: this.me.id + ':' + this.tab, ttlMs: 1500 }); }
      catch (e) { if (e && (e as DbError).code === 'unavailable') { await sleep(300); continue; } throw dbErr(e); }
      if (r && r.acquired) {
        const snap = await ref.get();
        const cur = snap.exists ? snap.data() : null;
        const next = fn(cur && cur.code ? cur : null);
        if (!next) return cur;
        try { await ref.set(next); } catch (e) { throw dbErr(e); }
        this.push(next);
        this.poke(next.version);
        return next;
      }
      await sleep(150 + Math.random() * 250);
    }
    throw new Error('The table is busy — try again.');
  }

  async create(settings: CreateSettings, name: string): Promise<string> {
    for (let tries = 0; tries < 5; tries++) {
      const code = makeCode();
      let taken = false;
      await this.withLease(code, (cur) => {
        if (cur) { taken = true; return null; }
        return newTable({ code, hostId: this.me.id, hostName: name, ...settings });
      });
      if (!taken) { await this.open(code); return code; }
    }
    throw new Error('Could not make a table code — try again.');
  }

  async open(code: string): Promise<void> {
    this.close();
    this.code = code;
    const ref = this.ref(code);
    const snap = await ref.get();
    if (!snap.exists || !(snap.data() || ({} as Partial<TableState>)).code) throw new Error(`No table with code ${code}.`);
    this.push(snap.data());
    this.unsub = ref.onSnapshot((s) => { const d = s.exists ? s.data() : null; if (d && d.code) this.push(d); }, () => {});
    if (this.room) {
      try {
        const r = await this.room.join('t-' + code.toLowerCase());
        this.r = r;
        this.offPoke = r.on('poke', (m) => {
          void (async () => {
            if (m && m.isMe) return;
            const v = m && m.data && m.data.v;
            if (this.state && v && v <= this.state.version) return;
            try { const s = await ref.get(); if (s.exists) this.push(s.data()); } catch (e) { /* ignore */ }
          })();
        });
        r.presence({ pid: this.me.id }).catch(() => {});
        this.offPeers = r.onPeers(() => {
          const set = new Set<string>();
          for (const p of r.peers()) if (p.presence && typeof p.presence.pid === 'string') set.add(p.presence.pid);
          this.setOnline(set);
        });
      } catch (e) { this.r = null; }
    }
  }

  private poke(v: number): void { if (this.r) this.r.emit('poke', { v }).catch(() => {}); }

  async submit(action: ActionInput): Promise<TableState> {
    const next = await this.withLease(this.code, (cur) => {
      if (!cur) throw new Error('This table no longer exists.');
      return reduce(cur, { ...action, by: this.me.id } as Action);
    });
    return next!;
  }

  close(): void {
    if (this.unsub) this.unsub();
    if (this.offPoke) this.offPoke();
    if (this.offPeers) this.offPeers();
    if (this.r) this.r.leave().catch(() => {});
    this.unsub = this.offPoke = this.offPeers = null;
    this.r = null;
    this.state = null;
  }
}

/** Db failures carry a code rather than being Errors, and each one has a different fix. */
function dbErr(e: unknown): Error {
  if (e instanceof Error) return e;
  const d = e as DbError | null;
  if (d && d.code === 'invalid_argument') return new Error('You can view this table but not play. Ask the owner for edit access.');
  if (d && d.code === 'quota_exceeded') return new Error('Storage is full. Delete old tables.');
  return new Error((d && d.message) || 'Something went wrong syncing the table.');
}
