/*
 * The MQTT link used by PeerBackend, kept separate from the game protocol that runs over
 * it. Every device connects to several free public brokers at once and sends each message
 * through all of them, so one broker being down doesn't break the table.
 *
 * Topics (see peer.ts for who publishes what):
 *   chipstack/v2/<CODE>/state      retained, published by the host: the latest table state
 *   chipstack/v2/<CODE>/in         players -> host: hello, act, ping
 *   chipstack/v2/<CODE>/to/<tab>   host -> one player: welcome, ok, err
 *   chipstack/v2/<CODE>/lock       retained: which tab is hosting, so a second host tab stands down
 */
import { rid, sleep } from './backend.ts';
import type { ActionInput, TableState } from '../types.ts';
import type { MqttClient, MqttLib } from '../externals.d.ts';

const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081',
];
const brokerList = (): string[] => window.CHIPSTACK_BROKERS || BROKERS; // tests point this at a local broker
export const TOPIC = (code: string): string => 'chipstack/v2/' + code;

/**
 * Anything arriving off a broker is untrusted input from a public topic. It is typed
 * for convenience, not validated — the engine's switch is what actually rejects bad actions.
 */
export interface RelayMessage {
  id?: string;
  t?: 'hello' | 'welcome' | 'ok' | 'err' | 'ping' | 'act';
  tab?: string;
  pid?: string;
  rid?: string;
  msg?: string;
  action?: ActionInput;
  state?: TableState;
  at?: number;
  v?: number;
}

let mqttLib: Promise<MqttLib> | null = null;
export function loadMqtt(): Promise<MqttLib> {
  if (window.mqtt) return Promise.resolve(window.mqtt);
  if (mqttLib) return mqttLib;
  mqttLib = new Promise<MqttLib>((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js';
    s.onload = () => res(window.mqtt!);
    s.onerror = () => { mqttLib = null; rej(new Error('Could not load the connection library. Check your internet.')); };
    document.head.appendChild(s);
  });
  return mqttLib;
}

export class Relay {
  // a bundle of broker connections that behaves like one pub/sub link
  private clients: MqttClient[] = [];
  private onMessage: (topic: string, msg: RelayMessage) => void;
  private subs = new Set<string>();

  constructor(onMessage: (topic: string, msg: RelayMessage) => void) {
    this.onMessage = onMessage;
  }

  async connect(): Promise<this> {
    const lib = await loadMqtt();
    const tries = brokerList().map((url) => new Promise<MqttClient>((res) => {
      let done = false;
      const c = lib.connect(url, {
        clientId: 'cs_' + rid(), clean: true, keepalive: 30, connectTimeout: 7000,
        reconnectPeriod: 2500, protocolVersion: 4,
      });
      c.on('connect', () => {
        this.subs.forEach((t) => c.subscribe(t, { qos: 0 }));
        if (!done) { done = true; res(c); }
      });
      c.on('message', (topic: string, payload: Uint8Array) => {
        let msg: RelayMessage;
        try { msg = JSON.parse(payload.toString()) as RelayMessage; } catch (e) { return; }
        this.onMessage(topic, msg);
      });
      c.on('error', () => {});
      setTimeout(() => { if (!done) { done = true; res(c); } }, 8000); // keep trying in background
    }));
    this.clients = await Promise.all(tries);
    if (!this.clients.some((c) => c.connected)) {
      // give slow networks one more moment
      await sleep(3000);
      if (!this.clients.some((c) => c.connected)) {
        this.end();
        throw new Error("Can't reach the game relay. Check your internet connection and try again.");
      }
    }
    return this;
  }

  sub(topic: string): void {
    this.subs.add(topic);
    this.clients.forEach((c) => c.connected && c.subscribe(topic, { qos: 0 }));
  }
  pub(topic: string, msg: RelayMessage, retain?: boolean): void {
    const body = JSON.stringify(msg);
    this.clients.forEach((c) => { if (c.connected) c.publish(topic, body, { qos: 0, retain: !!retain }); });
  }
  get up(): boolean { return this.clients.some((c) => c.connected); }
  end(): void {
    this.clients.forEach((c) => { try { c.end(true); } catch (e) { /* ignore */ } });
    this.clients = [];
    this.subs.clear();
  }
}
