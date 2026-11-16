/*
 * Backend for any plain static host (GitHub Pages): the host's phone runs the game and
 * public MQTT brokers only relay. This file is the protocol spoken over that relay —
 * the broker plumbing itself is in relay.ts.
 *
 * The host reduces every action and republishes the whole state, retained, so a device
 * that arrives later picks the table up from the broker. Players send actions to the
 * host and wait for an ok/err addressed to their tab.
 */
import { Emitter, makeCode, rid } from './backend.ts';
import type { Backend, CreateSettings } from './backend.ts';
import { Relay, TOPIC, loadMqtt } from './relay.ts';
import type { RelayMessage } from './relay.ts';
import { sess, store } from './storage.ts';
import { newTable, reduce } from '../engine/index.ts';
import type { Action, ActionInput, TableState } from '../types.ts';

type Timer = ReturnType<typeof setInterval>;

const SEEN_MAX = 500;
const AWAY_MS = 40000;
const CLAIM_MS = 45000;

export class PeerBackend extends Emitter implements Backend {
  readonly kind = 'peer';
  me: { id: string };
  // One identity per browser TAB (sessionStorage survives a refresh), so two tabs or two
  // friends on one browser get separate seats. The host confirms the id on join.
  private tab: string;
  private pending = new Map<string, { res: (s: TableState) => void; rej: (e: Error) => void }>();
  private seen = new Set<string>();
  private players = new Map<string, { pid: string; at: number }>(); // host: tab -> { pid, at }
  private code = '';
  private base = '';
  private retained: TableState | null = null;
  private relay: Relay | null = null;
  private isHost = false;
  private stoodDown = false;
  private hostSince = 0;
  private welcomed: (() => void) | null = null;
  private pingTimer: Timer | undefined;
  private onlineTimer: Timer | undefined;

  constructor() {
    super();
    this.tab = sess.get('chipstack:tab') || rid();
    sess.set('chipstack:tab', this.tab);
    this.me = { id: sess.get('chipstack:pid') || ('p' + rid()) };
    sess.set('chipstack:pid', this.me.id);
  }

  async init(): Promise<this> { await loadMqtt(); return this; }

  hostedCodes(): string[] {
    try { return JSON.parse(store.get('chipstack:hosted') || '[]') as string[]; } catch (e) { return []; }
  }

  private async link(code: string): Promise<void> {
    this.close();
    this.code = code;
    this.base = TOPIC(code);
    this.retained = null;
    const relay = new Relay((topic, msg) => this.onMessage(topic, msg));
    this.relay = relay;
    relay.sub(this.base + '/state');
    relay.sub(this.base + '/to/' + this.tab);
    relay.sub(this.base + '/lock');
    await relay.connect();
  }

  private waitForState(ms: number): Promise<TableState | null> {
    return new Promise((res) => {
      if (this.retained) return res(this.retained);
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (this.retained || Date.now() - t0 > ms) { clearInterval(iv); res(this.retained); }
      }, 100);
    });
  }

  private onMessage(topic: string, msg: RelayMessage): void {
    if (!msg || typeof msg !== 'object') return;
    if (msg.id) {
      if (this.seen.has(msg.id)) return;
      this.seen.add(msg.id);
      if (this.seen.size > SEEN_MAX) this.seen = new Set([...this.seen].slice(-SEEN_MAX / 2));
    }
    if (topic === this.base + '/state') {
      if (!msg.state || msg.state.code !== this.code) return;
      if (!this.retained || (msg.state.version || 0) >= (this.retained.version || 0)) this.retained = msg.state;
      if (!this.isHost) this.push(msg.state);
      return;
    }
    if (topic === this.base + '/lock') {
      if (this.isHost && msg.tab && msg.tab !== this.tab && (msg.at ?? 0) > this.hostSince) {
        this.isHost = false;
        this.stoodDown = true;
        this.relay!.sub(this.base + '/state');
      }
      return;
    }
    if (topic === this.base + '/to/' + this.tab) {
      if (msg.t === 'welcome') {
        this.me.id = msg.pid!;
        sess.set('chipstack:pid', msg.pid!);
        store.set('chipstack:seat:' + this.code, msg.pid!);
        if (this.welcomed) this.welcomed();
        return;
      }
      const p = msg.rid === undefined ? undefined : this.pending.get(msg.rid);
      if (!p) return;
      this.pending.delete(msg.rid!);
      if (msg.t === 'ok') p.res(this.state!);
      else p.rej(new Error(msg.msg || 'Something went wrong'));
      return;
    }
    if (topic === this.base + '/in' && this.isHost) this.hostHandle(msg);
  }

  // ----- host side -----
  async create(settings: CreateSettings, name: string): Promise<string> {
    for (let tries = 0; tries < 5; tries++) {
      const code = makeCode();
      await this.link(code);
      const existing = await this.waitForState(1500);
      if (existing) continue; // code used before: pick another
      this.becomeHost(newTable({ code, hostId: this.me.id, hostName: name, ...settings }));
      return code;
    }
    throw new Error('Could not make a table code — try again.');
  }

  private becomeHost(state: TableState): void {
    this.isHost = true;
    this.hostSince = Date.now();
    this.relay!.sub(this.base + '/in');
    this.relay!.pub(this.base + '/lock', { id: rid(), tab: this.tab, at: this.hostSince }, true);
    this.state = null;
    this.apply(state);
    clearInterval(this.onlineTimer);
    this.onlineTimer = setInterval(() => this.updateOnline(), 5000);
    this.updateOnline();
  }

  private apply(next: TableState): void {
    this.push(next);
    this.save();
    this.relay!.pub(this.base + '/state', { id: rid(), state: next }, true);
  }

  private save(): void {
    if (!this.isHost || !this.state) return;
    store.set('chipstack:host:' + this.code, JSON.stringify(this.state));
    const list = this.hostedCodes().filter((c) => c !== this.code);
    list.unshift(this.code);
    store.set('chipstack:hosted', JSON.stringify(list.slice(0, 5)));
  }

  private reply(tab: string, msg: RelayMessage): void {
    this.relay!.pub(this.base + '/to/' + tab, { id: rid(), ...msg });
  }

  private hostHandle(msg: RelayMessage): void {
    const tab = typeof msg.tab === 'string' ? msg.tab.slice(0, 40) : null;
    if (!tab) return;
    const now = Date.now();
    const validPid = (p: unknown): p is string => typeof p === 'string' && /^p[a-z0-9]{6,30}$/.test(p);
    const takenByOther = (pid: string): boolean =>
      pid === this.me.id || [...this.players].some(([t, v]) => t !== tab && v.pid === pid && now - v.at < CLAIM_MS);
    if (msg.t === 'hello') {
      let pid = validPid(msg.pid) ? msg.pid : 'p' + rid();
      if (takenByOther(pid)) pid = 'p' + rid();
      this.players.set(tab, { pid, at: now });
      this.reply(tab, { t: 'welcome', pid });
      this.relay!.pub(this.base + '/state', { id: rid(), state: this.state! }, true);
      this.updateOnline();
      return;
    }
    if (!validPid(msg.pid)) return;
    const known = this.players.get(tab);
    if (!known) {
      if (takenByOther(msg.pid)) return this.reply(tab, { t: 'err', rid: msg.rid, msg: 'Rejoin the table to keep playing.' });
      this.players.set(tab, { pid: msg.pid, at: now });
    } else known.at = now;
    const pid = this.players.get(tab)!.pid;
    if (msg.t === 'ping') return;
    if (msg.t !== 'act' || !msg.action) return;
    try {
      const next = reduce(this.state!, { ...msg.action, by: pid } as Action);
      this.apply(next);
      this.reply(tab, { t: 'ok', rid: msg.rid });
    } catch (e) { this.reply(tab, { t: 'err', rid: msg.rid, msg: (e as Error).message }); }
  }

  private updateOnline(): void {
    const now = Date.now();
    const set = new Set<string>([this.me.id]);
    this.players.forEach((v) => { if (now - v.at < AWAY_MS) set.add(v.pid); });
    this.setOnline(set);
  }

  // ----- player side -----
  async open(code: string): Promise<string> {
    const saved = store.get('chipstack:host:' + code);
    await this.link(code);
    const live = await this.waitForState(2500);
    if (saved) {
      // resume hosting from this phone's saved copy (or the relay's, if newer)
      const st = JSON.parse(saved) as TableState;
      const best = live && (live.version || 0) > (st.version || 0) ? live : st;
      if (best.hostId) { this.me.id = best.hostId; sess.set('chipstack:pid', best.hostId); }
      this.becomeHost(best);
      return code;
    }
    if (!live) { this.close(); throw new Error(`No table with code ${code}. Check the code with the host.`); }
    this.push(live);
    await new Promise<void>((res, rej) => {
      let settled = false;
      this.welcomed = () => { if (!settled) { settled = true; res(); } };
      const hello = (): void => this.relay!.pub(this.base + '/in', {
        id: rid(), t: 'hello', tab: this.tab, pid: store.get('chipstack:seat:' + code) || this.me.id,
      });
      hello();
      const again = setInterval(() => { if (settled) clearInterval(again); else hello(); }, 2500);
      setTimeout(() => {
        if (settled) return;
        settled = true;
        clearInterval(again);
        rej(new Error("The table exists but the host's phone isn't connected. Ask the host to open the app."));
      }, 12000);
    }).catch((e: Error) => { this.close(); throw e; });
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(
      () => this.relay!.pub(this.base + '/in', { id: rid(), t: 'ping', tab: this.tab, pid: this.me.id }),
      15000,
    );
    this.setOnline(new Set([this.me.id]));
    return code;
  }

  submit(action: ActionInput): Promise<TableState> {
    if (this.isHost) {
      const next = reduce(this.state!, { ...action, by: this.me.id } as Action);
      this.apply(next);
      return Promise.resolve(next);
    }
    if (this.stoodDown) return Promise.reject(new Error('This table is being hosted from another tab.'));
    return new Promise<TableState>((res, rej) => {
      if (!this.relay || !this.relay.up) return rej(new Error('Reconnecting…'));
      const id = rid();
      this.pending.set(id, { res, rej });
      this.relay.pub(this.base + '/in', { id: rid(), t: 'act', rid: id, tab: this.tab, pid: this.me.id, action });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error("The host didn't answer. Is the app open on their phone?"));
        }
      }, 9000);
    });
  }

  close(): void {
    clearInterval(this.pingTimer);
    clearInterval(this.onlineTimer);
    if (this.relay) this.relay.end();
    this.relay = null;
    this.isHost = false;
    this.stoodDown = false;
    this.welcomed = null;
    this.players = new Map();
    this.retained = null;
    this.state = null;
  }
}
