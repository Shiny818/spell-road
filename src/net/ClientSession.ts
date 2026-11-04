// 参加者の進行役。ホストから届いた状態とできごとを画面に渡し、操作をホストに送る。
// ルールの計算はしない（今できる操作もホストが教えてくれる）。

import type { Action, GameState } from '../core/types';
import { actionKey } from '../core/engine';
import { PROTOCOL_VERSION, REJECT_TEXT, type ClientMessage, type HostMessage, type SeatInfo } from './protocol';
import { toLocalClock, type GameSession, type GameView, type LocalClock } from './session';
import { NetError, withHeartbeat, type ClientSide, type ConnectToHost } from './transport';

export interface ClientCallbacks {
  /** 待合室の顔ぶれが変わった */
  onLobby?(seats: SeatInfo[], you: number): void;
  /** ゲームが始まった（もう一度、再接続で途中から、も含む）。画面の準備ができるまで待つ */
  onGameStart?(state: GameState): void | Promise<void>;
  /** 通信の状態（つなぎ直し中など）。null で消す */
  onStatus?(text: string | null): void;
  /** 部屋から抜けることになった（ホストが閉じた・断られた） */
  onEnd?(text: string): void;
}

export interface ClientOptions {
  heartbeat: boolean;
  /** つなぎ直す間隔 */
  retryMs: number;
  /** ホストが見つからない状態がこの回数続いたら、あきらめる */
  maxNotFound: number;
}

const DEFAULT_OPTIONS: ClientOptions = { heartbeat: true, retryMs: 2500, maxNotFound: 12 };

export class ClientSession implements GameSession {
  readonly isHost = false;
  me = -1;
  state: GameSession['state'] = null;
  legal: Action[] = [];
  seats: SeatInfo[] = [];
  clock: LocalClock | null = null;
  busy = false;

  private conn: ClientSide | null = null;
  private seq = -1;
  private game = 0;
  private leaving = false;
  /** 届いたメッセージを順番に処理する（演出の再生中に次の状態が届いても追い越さない） */
  private queue: Promise<void> = Promise.resolve();
  private readonly options: ClientOptions;

  constructor(
    private readonly connectTo: ConnectToHost,
    readonly code: string,
    private readonly name: string,
    private readonly clientId: string,
    private readonly view: GameView,
    private readonly callbacks: ClientCallbacks = {},
    options: Partial<ClientOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** 最初の接続。つながらなければ NetError で失敗する */
  async start(): Promise<void> {
    this.attach(await this.connectTo(this.code));
  }

  act(action: Action): void {
    const key = actionKey(action);
    if (!this.conn || !this.legal.some((a) => actionKey(a) === key)) return;
    this.conn.send({ t: 'action', seq: this.seq, action });
    // ホストから次の状態が届くまで、続けて操作できないようにする
    this.legal = [];
    if (this.state) this.view.render(this.state);
  }

  stop(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.conn?.send({ t: 'leave' });
    const conn = this.conn;
    // leave が届くよう、少し待ってから切る
    setTimeout(() => conn?.close(), 300);
  }

  private attach(raw: ClientSide): void {
    const conn = this.options.heartbeat ? withHeartbeat(raw, { t: 'ping' } as ClientMessage) : raw;
    this.conn = conn;
    conn.onMessage((msg) => this.receive(msg));
    conn.onClose(() => {
      if (this.conn !== conn) return;
      this.conn = null;
      this.legal = [];
      if (!this.leaving) void this.reconnect();
    });
    conn.send({ t: 'hello', v: PROTOCOL_VERSION, clientId: this.clientId, name: this.name });
  }

  private async reconnect(): Promise<void> {
    this.callbacks.onStatus?.('ホストとの通信が切れました。つなぎ直しています…');
    if (this.state) this.view.render(this.state);
    let notFound = 0;
    while (!this.leaving) {
      await new Promise((r) => setTimeout(r, this.options.retryMs));
      if (this.leaving) return;
      try {
        this.attach(await this.connectTo(this.code));
        this.callbacks.onStatus?.(null);
        return;
      } catch (e) {
        if (e instanceof NetError && e.kind === 'notFound' && ++notFound >= this.options.maxNotFound) {
          this.end('ホストが見つからなくなりました。ゲームを終わります。');
          return;
        }
      }
    }
  }

  private end(text: string): void {
    this.leaving = true;
    this.conn?.close();
    this.callbacks.onStatus?.(null);
    this.callbacks.onEnd?.(text);
  }

  private receive(msg: HostMessage): void {
    switch (msg.t) {
      case 'lobby':
        this.me = msg.you;
        this.seats = msg.seats;
        this.callbacks.onLobby?.(msg.seats, msg.you);
        break;
      case 'seats':
        this.seats = msg.seats;
        if (this.state) this.view.render(this.state);
        else this.callbacks.onLobby?.(msg.seats, this.me);
        break;
      case 'update':
        this.enqueue(async () => {
          if (msg.game !== this.game) {
            this.game = msg.game;
            await this.callbacks.onGameStart?.(msg.state);
          }
          this.me = msg.you;
          this.seats = msg.seats;
          this.seq = msg.seq;
          this.state = msg.state;
          this.legal = [];
          this.clock = null;
          this.busy = true;
          this.view.render(msg.state);
          await this.view.playEvents(msg.events, msg.state);
          this.busy = false;
          this.view.render(msg.state);
          this.conn?.send({ t: 'watched', seq: msg.seq });
        });
        break;
      case 'prompt':
        this.enqueue(async () => {
          if (msg.seq !== this.seq || !this.state) return;
          this.legal = msg.legal;
          this.clock = toLocalClock(msg.clock);
          this.view.render(this.state);
        });
        break;
      case 'rejected':
        this.end(REJECT_TEXT[msg.reason]);
        break;
      case 'closed':
        this.end('ホストが部屋を閉じました。');
        break;
    }
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((e) => console.error(e));
  }
}
