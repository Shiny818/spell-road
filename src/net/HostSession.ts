// ホストの進行役。ルールの処理・CPUの思考・制限時間をすべてここで行い、参加者には
// 「その人に見せてよい状態」と、その人が今できる操作を送る（docs/spec.md 6.6）。
// 1人プレイも、通信なし（transport が null）のホストとして同じように動かす。

import { chooseCpuAction } from '../ai/cpu';
import { DEFAULT_BOARD_ID, getBoard } from '../data/boards';
import { ALL_CARD_IDS, buildSharedDeck } from '../core/cards';
import { actionKey, applyAction, createGame, expectedActor, getLegalActions } from '../core/engine';
import { redactFor } from '../core/view';
import type { Action, BoardDef, GameState } from '../core/types';
import { MAX_PLAYERS, PROTOCOL_VERSION, type ClientMessage, type Clock, type HostMessage, type SeatInfo } from './protocol';
import { SAVE_VERSION, type SavedRoom, type SaveStore } from './save';
import { toLocalClock, type GameSession, type GameView, type LocalClock } from './session';
import { withHeartbeat, type HostSide, type HostTransport } from './transport';

export const CPU_NAMES = ['ルル', 'ポポ', 'ミミ'];

export interface HostTiming {
  /** CPUが操作するまでの間 */
  cpuDelayMs: number;
  /** 全員が演出を見終わるのを待つ最長の時間 */
  watchWaitMs: number;
  /** 手番の操作1回の制限時間 */
  turnLimitMs: number;
  /** カウンターの確認の制限時間 */
  counterLimitMs: number;
  /** 生存確認を使うか（テストでは切る） */
  heartbeat: boolean;
}

export const DEFAULT_TIMING: HostTiming = {
  cpuDelayMs: 650,
  watchWaitMs: 8000,
  turnLimitMs: 60_000,
  counterLimitMs: 10_000,
  heartbeat: true,
};

interface Seat {
  name: string;
  kind: 'human' | 'cpu';
  host: boolean;
  clientId: string | null;
  conn: HostSide | null;
  /** 最後に見終わった update の番号 */
  watched: number;
  /** 時間切れで、この手番の残りはCPUが代わりに操作する */
  autopilot: boolean;
}

export interface HostCallbacks {
  /** 待合室の顔ぶれが変わった */
  onLobby?(seats: SeatInfo[]): void;
  /** ゲームが始まった（もう一度、も含む）。画面の準備ができるまで待つ */
  onGameStart?(state: GameState): void | Promise<void>;
}

export class HostSession implements GameSession {
  readonly me = 0;
  readonly isHost = true;
  /** ルールの処理に使う、すべてが分かる状態 */
  private full: GameState | null = null;
  /** ホスト自身の画面に渡す状態（ホストの画面でも、他の人の手札は伏せておく） */
  private mine: GameState | null = null;
  clock: LocalClock | null = null;
  busy = false;

  private seatList: Seat[];
  private seq = 0;
  /** 何回目のゲームか（もう一度、で増える） */
  private gameNo = 0;
  private stopped = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private clockTimer: ReturnType<typeof setTimeout> | null = null;
  private watchWaiter: (() => void) | null = null;
  private readonly timing: HostTiming;
  /** 保存から開き直した直後で、参加者が戻るのを待っている（resume() で始まる） */
  private waiting = false;
  /** この部屋が保存を書いた（閉じるときに消してよい） */
  private ownsSave = false;

  constructor(
    hostName: string,
    private readonly view: GameView,
    private readonly transport: HostTransport | null = null,
    private readonly callbacks: HostCallbacks = {},
    timing: Partial<HostTiming> = {},
    /** 通信対戦の途中経過を保存する先（ホストの画面が閉じても再開できるように） */
    private readonly store: SaveStore | null = null,
  ) {
    this.timing = { ...DEFAULT_TIMING, ...timing };
    this.seatList = [this.newSeat(hostName || 'プレイヤー1', 'human', null, true)];
    transport?.onConnection((conn) => this.accept(conn));
  }

  /**
   * 保存から部屋を開き直す。transport は保存と同じ部屋コードで開いたものを渡す。
   * 参加者が戻るのを待つ状態で始まるので、続きを始めるには resume() を呼ぶ
   * （人の席が全員戻れば、自動で始まる）。
   */
  static restore(
    save: SavedRoom,
    view: GameView,
    transport: HostTransport,
    callbacks: HostCallbacks = {},
    timing: Partial<HostTiming> = {},
    store: SaveStore | null = null,
  ): HostSession {
    const host = new HostSession(save.seats[0].name, view, transport, callbacks, timing, store);
    host.seatList = save.seats.map((s) => host.newSeat(s.name, s.kind, s.clientId, s.host));
    host.full = save.state;
    host.gameNo = save.gameNo;
    // 古い画面からの操作を受け付けないよう、番号を進めておく
    host.seq = save.seq + 1;
    host.waiting = true;
    host.ownsSave = true;
    return host;
  }

  get state(): GameState | null {
    if (this.waiting) return null;
    if (this.full && this.mine?.log !== this.full.log) this.mine = { ...redactFor(this.full, this.me), log: this.full.log };
    return this.full ? this.mine : null;
  }

  /** 保存から開き直して、参加者が戻るのを待っているか */
  get paused(): boolean {
    return this.waiting;
  }

  /** まだ戻っていない参加者の席（ホスト・CPUは含まない） */
  get missing(): SeatInfo[] {
    return this.seats.filter((s) => s.kind === 'human' && !s.host && !s.connected);
  }

  /** テスト用: すべてが分かる状態 */
  get fullState(): GameState | null {
    return this.full;
  }

  get code(): string | null {
    return this.transport?.code ?? null;
  }

  get seats(): SeatInfo[] {
    return this.seatList.map((s) => ({
      name: s.name,
      kind: s.kind,
      host: s.host,
      connected: s.host || s.kind === 'cpu' || s.conn !== null,
    }));
  }

  /** 人の席の数（待合室） */
  get humanCount(): number {
    return this.seatList.filter((s) => s.kind === 'human').length;
  }

  get legal(): Action[] {
    if (this.busy || !this.full || this.stopped || this.waiting) return [];
    return this.seatList[this.me].autopilot ? [] : getLegalActions(this.full, this.me);
  }

  /**
   * ゲームを始める。足りない席はCPUで埋める（もう一度遊ぶときも、これを呼ぶ）。
   * boardId を省くと、前のゲームと同じボード
   */
  async startGame(cpuCount: number, seed = Math.floor(Math.random() * 2 ** 31), boardId = this.full?.board.id ?? DEFAULT_BOARD_ID): Promise<void> {
    this.clearTimers();
    // 前のゲームのCPUの席は作り直す。人の席はそのまま（切断中の人も席は残す）
    this.seatList = this.seatList.filter((s) => s.kind === 'human');
    const total = Math.min(MAX_PLAYERS, Math.max(2, this.seatList.length + cpuCount));
    const used = new Set(this.seatList.map((s) => s.name));
    const cpuNames = CPU_NAMES.filter((n) => !used.has(n)).concat(CPU_NAMES);
    for (let i = 0; this.seatList.length < total; i++) this.seatList.push(this.newSeat(cpuNames[i], 'cpu', null, false));
    for (const s of this.seatList) s.autopilot = false;

    this.full = createGame({
      board: getBoard(boardId),
      players: this.seatList.map((s) => ({ name: s.name, isCpu: s.kind === 'cpu' })),
      deck: buildSharedDeck(ALL_CARD_IDS),
      seed,
    });
    this.gameNo++;
    this.seq = 0;
    this.waiting = false;
    for (const s of this.seatList) s.watched = -1;
    const game = this.gameNo;
    await this.callbacks.onGameStart?.(this.state!);
    if (this.stopped || game !== this.gameNo) return;
    await this.publish([]);
  }

  /**
   * 保存から開き直したゲームの続きを始める。戻っていない人の席は、CPUが代わりに操作する
   * （人の席が全員戻ったときは、自動で呼ばれる）
   */
  async resume(): Promise<void> {
    if (!this.waiting || !this.full || this.stopped) return;
    this.waiting = false;
    for (const s of this.seatList) {
      s.autopilot = false;
      s.watched = -1;
    }
    const game = this.gameNo;
    await this.callbacks.onGameStart?.(this.state!);
    if (this.stopped || game !== this.gameNo) return;
    await this.publish([]);
  }

  /** 自分（ホスト）の操作 */
  act(action: Action): void {
    if (this.waiting || action.player !== this.me || !this.isLegal(action)) return;
    void this.apply(action);
  }

  /** テスト用: ホストの画面が急に閉じたことにする（参加者には何も知らせず、保存も残す） */
  halt(): void {
    this.stopped = true;
    this.clearTimers();
    for (const s of this.seatList) s.conn?.close();
    this.transport?.close();
  }

  /** 部屋を閉じる・ゲームをやめる（保存も消える） */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    // 保存を消すのは、この部屋が保存したものだけ（ゲームを始める前に閉じても、前のゲームの保存は残す）
    if (this.ownsSave) this.store?.clear();
    this.clearTimers();
    const conns = this.seatList.map((s) => s.conn);
    for (const c of conns) c?.send({ t: 'closed' });
    // 「閉じた」が届くよう、少し待ってから切る
    setTimeout(() => {
      for (const c of conns) c?.close();
      this.transport?.close();
    }, 300);
  }

  // ============================================================
  // 進行
  // ============================================================

  private isLegal(action: Action): boolean {
    const key = actionKey(action);
    return getLegalActions(this.full!, action.player).some((a) => actionKey(a) === key);
  }

  private async apply(action: Action): Promise<void> {
    if (this.busy || this.stopped || !this.full) return;
    this.setClock(null);
    const prev = this.full;
    this.full = applyAction(prev, action);
    const events = this.full.log.slice(prev.log.length);
    // 次の人の手番になったら、時間切れの代わりの操作は終わり
    if (events.some((e) => e.type === 'turnStart')) for (const s of this.seatList) s.autopilot = false;
    this.seq++;
    await this.publish(events);
  }

  /** 状態を全員に配り、演出を見終わるのを待ってから次へ進める */
  private async publish(events: GameState['log']): Promise<void> {
    const seq = this.seq;
    const game = this.gameNo;
    this.busy = true;
    this.persist();
    for (let i = 0; i < this.seatList.length; i++) this.sendUpdate(i, events);
    const mine = this.state!;
    this.view.render(mine);
    await this.view.playEvents(events, mine);
    await this.waitWatched(seq);
    if (this.stopped || game !== this.gameNo || seq !== this.seq) return;
    this.busy = false;
    this.view.render(mine);
    this.next();
  }

  /** ホストの画面が閉じても再開できるよう、今の状態を端末に保存する。ゲームが終わったら消す */
  private persist(): void {
    if (!this.store || !this.transport || !this.full) return;
    this.ownsSave = true;
    if (this.full.phase === 'gameOver' || this.full.result) {
      this.store.clear();
      return;
    }
    this.store.save({
      v: SAVE_VERSION,
      protocol: PROTOCOL_VERSION,
      savedAt: Date.now(),
      code: this.transport.code,
      gameNo: this.gameNo,
      seq: this.seq,
      seats: this.seatList.map((s) => ({ name: s.name, kind: s.kind, host: s.host, clientId: s.clientId })),
      state: this.full,
    });
  }

  private sendUpdate(seat: number, events: GameState['log']): void {
    const s = this.seatList[seat];
    if (!s.conn || !this.full) return;
    s.conn.send({
      t: 'update',
      game: this.gameNo,
      seq: this.seq,
      you: seat,
      seats: this.seats,
      state: redactFor(this.full, seat),
      events,
    });
  }

  /** つながっている参加者が全員 seq を見終わるまで待つ（最長 watchWaitMs） */
  private waitWatched(seq: number): Promise<void> {
    const done = () => this.seatList.every((s) => !s.conn || s.watched >= seq);
    if (done()) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        this.watchWaiter = null;
        clearTimeout(timer);
        this.timers.delete(timer);
        resolve();
      };
      const timer = this.later(finish, this.timing.watchWaitMs);
      this.watchWaiter = () => {
        if (done()) finish();
      };
    });
  }

  /** 次に操作する人に操作を促す。CPU・切断中の人の番なら、CPUが操作する */
  private next(): void {
    const s = this.full!;
    const actor = expectedActor(s);
    if (actor === null) {
      this.sendPrompts();
      return;
    }
    const seat = this.seatList[actor];
    const away = seat.kind === 'human' && !seat.host && !seat.conn;
    if (seat.kind === 'cpu' || away || seat.autopilot) {
      const seq = this.seq;
      this.later(() => {
        if (this.seq === seq && !this.busy) void this.apply(chooseCpuAction(this.full!, actor));
      }, this.timing.cpuDelayMs);
      this.sendPrompts();
      return;
    }
    // 通信対戦（参加者がいる）ときだけ、制限時間をつける
    if (this.seatList.some((x) => x.kind === 'human' && !x.host)) {
      const counter = s.pending?.kind === 'counter';
      const limit = counter ? this.timing.counterLimitMs : this.timing.turnLimitMs;
      this.setClock({ player: actor, kind: counter ? 'counter' : 'turn', remainingMs: limit });
      const seq = this.seq;
      this.clockTimer = this.later(() => {
        if (this.seq !== seq || this.busy) return;
        // カウンターは「使わない」。手番の操作は、この手番の残りをCPUが代わりに行う
        if (counter) void this.apply({ type: 'noCounter', player: actor });
        else {
          seat.autopilot = true;
          void this.apply(chooseCpuAction(this.full!, actor));
        }
      }, limit);
    }
    this.sendPrompts();
    this.view.render(this.state!);
  }

  /** それぞれの参加者に、今できる操作と制限時間を知らせる */
  private sendPrompts(): void {
    this.seatList.forEach((seat, i) => this.sendPrompt(i));
  }

  private sendPrompt(seat: number): void {
    const s = this.seatList[seat];
    if (!s.conn || !this.full) return;
    const legal = this.busy || s.autopilot ? [] : getLegalActions(this.full, seat);
    s.conn.send({ t: 'prompt', seq: this.seq, legal, clock: this.remoteClock() });
  }

  private remoteClock(): Clock | null {
    if (!this.clock) return null;
    const { deadline, ...rest } = this.clock;
    return { ...rest, remainingMs: Math.max(0, deadline - performance.now()) };
  }

  private setClock(clock: Clock | null): void {
    if (this.clockTimer) {
      clearTimeout(this.clockTimer);
      this.timers.delete(this.clockTimer);
      this.clockTimer = null;
    }
    this.clock = toLocalClock(clock);
  }

  // ============================================================
  // 参加者とのやり取り
  // ============================================================

  private accept(raw: HostSide): void {
    const conn = this.timing.heartbeat ? withHeartbeat(raw, { t: 'ping' } as HostMessage) : raw;
    let seatOf: Seat | null = null;
    conn.onMessage((msg: ClientMessage) => {
      if (msg.t === 'hello') seatOf = this.onHello(conn, msg);
      else if (seatOf && seatOf.conn === conn) this.onMessage(seatOf, msg);
    });
    conn.onClose(() => {
      if (seatOf && seatOf.conn === conn) this.onLeave(seatOf);
    });
  }

  private onHello(conn: HostSide, msg: Extract<ClientMessage, { t: 'hello' }>): Seat | null {
    const reject = (reason: 'version' | 'full' | 'started') => {
      conn.send({ t: 'rejected', reason });
      setTimeout(() => conn.close(), 500);
      return null;
    };
    if (this.stopped) return null;
    if (msg.v !== PROTOCOL_VERSION) return reject('version');

    // 同じ端末からのつなぎ直しなら、同じ席に戻す
    let seat = this.seatList.find((s) => s.clientId === msg.clientId) ?? null;
    if (seat) {
      seat.conn?.close();
      seat.conn = conn;
      seat.watched = -1;
    } else {
      if (this.full) return reject('started');
      if (this.humanCount >= MAX_PLAYERS) return reject('full');
      seat = this.newSeat(msg.name.slice(0, 8) || this.unusedName(), 'human', msg.clientId, false);
      seat.conn = conn;
      this.seatList.push(seat);
    }
    this.seatsChanged();
    if (this.full && !this.waiting) {
      const i = this.seatList.indexOf(seat);
      this.sendUpdate(i, []);
      this.sendPrompt(i);
    }
    // 保存から開き直した部屋で、人の席が全員戻ったら、続きを始める
    if (this.waiting && this.missing.length === 0) void this.resume();
    return seat;
  }

  private onMessage(seat: Seat, msg: ClientMessage): void {
    switch (msg.t) {
      case 'watched':
        seat.watched = Math.max(seat.watched, msg.seq);
        this.watchWaiter?.();
        break;
      case 'action': {
        const i = this.seatList.indexOf(seat);
        const ok =
          this.full && !this.busy && msg.seq === this.seq && msg.action.player === i && !seat.autopilot && this.isLegal(msg.action);
        if (ok) void this.apply(msg.action);
        else this.sendPrompt(i); // 古い画面からの操作。今の状態を知らせ直す
        break;
      }
      case 'leave':
        seat.conn?.close();
        break;
    }
  }

  private onLeave(seat: Seat): void {
    seat.conn = null;
    if (!this.full) {
      // 待合室なら席ごと抜ける
      this.seatList = this.seatList.filter((s) => s !== seat);
    }
    this.seatsChanged();
    if (!this.full || this.waiting) return;
    this.watchWaiter?.();
    // その人の操作待ちだったら、CPUが代わりに操作する
    const actor = expectedActor(this.full);
    if (!this.busy && actor !== null && this.seatList[actor] === seat) {
      this.setClock(null);
      this.next();
    }
  }

  private seatsChanged(): void {
    const seats = this.seats;
    // 待合室、または保存から開き直して参加者を待っている間は、待合室として扱う
    if (!this.full || this.waiting) {
      this.seatList.forEach((s, i) => s.conn?.send({ t: 'lobby', you: i, seats }));
      this.callbacks.onLobby?.(seats);
      return;
    }
    for (const s of this.seatList) s.conn?.send({ t: 'seats', seats });
    this.view.render(this.state!);
  }

  // ============================================================
  // 小さな道具
  // ============================================================

  /** 名前をつけなかった参加者の名前（プレイヤー2、プレイヤー3…） */
  private unusedName(): string {
    const used = new Set(this.seatList.map((s) => s.name));
    for (let n = 2; ; n++) if (!used.has(`プレイヤー${n}`)) return `プレイヤー${n}`;
  }

  private newSeat(name: string, kind: 'human' | 'cpu', clientId: string | null, host: boolean): Seat {
    return { name, kind, host, clientId, conn: null, watched: -1, autopilot: false };
  }

  private later(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.stopped) fn();
    }, ms);
    this.timers.add(timer);
    return timer;
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.clockTimer = null;
    this.clock = null;
    this.watchWaiter = null;
  }
}
