/*
 * One phone for the whole table (pass-and-play). No network: the state lives in this
 * browser and every action is attributed to '*', which the engine treats as the host.
 */
import { Emitter, rid } from './backend.ts';
import type { Backend, CreateSettings } from './backend.ts';
import { store } from './storage.ts';
import { newTable, reduce } from '../engine/index.ts';
import type { Action, ActionInput, TableState } from '../types.ts';

const KEY = 'chipstack:local';

export class LocalBackend extends Emitter implements Backend {
  readonly kind = 'local';
  me = { id: '*' };

  async init(): Promise<this> { return this; }

  async create(settings: CreateSettings, name: string): Promise<string> {
    const code = 'HERE';
    const s = newTable({ code, hostId: 'h' + rid(), hostName: name, ...settings });
    this.state = null;
    this.push(s);
    this.save();
    return code;
  }

  async open(): Promise<void> {
    const raw = store.get(KEY);
    if (!raw) throw new Error('No saved one-phone table.');
    this.state = null;
    this.push(JSON.parse(raw) as TableState);
  }

  private save(): void { store.set(KEY, JSON.stringify(this.state)); }

  async submit(action: ActionInput): Promise<TableState> {
    const next = reduce(this.state!, { ...action, by: action.by || '*' } as Action);
    this.push(next);
    this.save();
    return next;
  }

  close(): void { this.state = null; }
}
