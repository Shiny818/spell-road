import { describe, expect, it } from 'vitest';
import { HIDDEN_CARD } from '../src/core/view';
import type { GameState } from '../src/core/types';
import { ClientSession } from '../src/net/ClientSession';
import { HostSession, turnOrderFor, type HostTiming } from '../src/net/HostSession';
import { normalizeRoomCode, makeRoomCode, type SeatInfo } from '../src/net/protocol';
import type { GameSession, GameView } from '../src/net/session';
import { createMemoryNetwork, type HostSide } from '../src/net/transport';

const FAST: Partial<HostTiming> = { cpuDelayMs: 0, watchWaitMs: 200, turnLimitMs: 2000, counterLimitMs: 2000, heartbeat: false };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 画面の代わり。操作できるようになったら、今できる操作からランダムに選ぶ（auto が false なら何もしない） */
class BotView implements GameView {
  session!: GameSession;
  auto = true;
  renders = 0;
  leaks: string[] = [];
  private x: number;
  constructor(seed: number) {
    this.x = seed;
  }
  async playEvents(): Promise<void> {}
  render(state: GameState): void {
    this.renders++;
    // 自分以外の手札が見えていないか
    for (const p of state.players) {
      if (p.index !== this.session.me && p.hand.some((c) => c.cardId !== HIDDEN_CARD)) this.leaks.push(`${this.session.me}が${p.index}の手札を見た`);
    }
    if (!this.auto) return;
    const legal = this.session.legal;
    if (legal.length === 0) return;
    this.x = (this.x * 1103515245 + 12345) >>> 0;
    const a = legal[this.x % legal.length];
    setTimeout(() => this.session.act(a), 0);
  }
}

async function until(cond: () => boolean, ms = 20000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('時間切れ');
    await sleep(5);
  }
}

function makeRoom(timing: Partial<HostTiming> = FAST) {
  const net = createMemoryNetwork();
  const hostView = new BotView(1);
  const lobby: SeatInfo[][] = [];
  const host = new HostSession('ホスト', hostView, net.host('ABCDE'), { onLobby: (s) => lobby.push(s) }, timing);
  hostView.session = host;
  const join = async (name: string, seed: number, id = `id-${name}`) => {
    const view = new BotView(seed);
    const ended: string[] = [];
    const client = new ClientSession(net.connect, 'ABCDE', name, id, view, { onEnd: (t) => ended.push(t) }, { heartbeat: false, retryMs: 20 });
    view.session = client;
    await client.start();
    return { client, view, ended };
  };
  return { net, host, hostView, lobby, join };
}

describe('部屋コード', () => {
  it('5文字で、読み間違えやすい文字を使わない', () => {
    for (let i = 0; i < 200; i++) expect(makeRoomCode()).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
  });
  it('入力を整え、使えない文字なら受け付けない', () => {
    expect(normalizeRoomCode(' ab cd e ')).toBe('ABCDE');
    expect(normalizeRoomCode('ABCD0')).toBeNull();
    expect(normalizeRoomCode('ABCD')).toBeNull();
  });
});

describe('通信対戦', () => {
  it('待合室に参加者が並び、ゲームを最後まで遊べる。他の人の手札は一度も見えない', async () => {
    const room = makeRoom();
    const a = await room.join('アン', 2);
    const b = await room.join('ベン', 3);
    await until(() => room.host.seats.length === 3);
    expect(room.lobby.at(-1)!.map((s) => s.name)).toEqual(['ホスト', 'アン', 'ベン']);
    await until(() => b.client.seats.length === 3 && b.client.me === 2);

    room.host.startGame(1);
    expect(room.host.seats.map((s) => s.kind)).toEqual(['human', 'human', 'human', 'cpu']);
    await until(() => room.host.fullState?.phase === 'gameOver' && a.client.state?.phase === 'gameOver' && b.client.state?.phase === 'gameOver', 60000);

    expect(a.client.state!.result).toEqual(room.host.fullState!.result);
    expect(b.client.state!.result).toEqual(room.host.fullState!.result);
    expect(a.client.state!.players.map((p) => p.trail)).toEqual(room.host.fullState!.players.map((p) => p.trail));
    expect([...room.hostView.leaks, ...a.view.leaks, ...b.view.leaks]).toEqual([]);
    // 参加者が実際に操作している
    const log = room.host.fullState!.log;
    expect(log.some((e) => e.type === 'roll' && e.player === 1)).toBe(true);
    expect(log.some((e) => e.type === 'roll' && e.player === 2)).toBe(true);
    room.host.stop();
  }, 70000);

  it('切断した人の番はCPUが代わりに進め、つなぎ直すと同じ席に戻って続きから遊べる', async () => {
    const room = makeRoom();
    const a = await room.join('アン', 2);
    await until(() => room.host.seats.length === 2);
    room.host.startGame(0);
    await until(() => (room.host.fullState?.round ?? 0) >= 2);

    room.net.dropAll();
    await until(() => room.host.seats[1].connected === false || a.client.seats[1]?.connected === true);
    // 切れている間もゲームは進む（アンの番はCPUが代わりに操作する）
    const rounds = room.host.fullState!.round;
    await until(() => room.host.seats[1].connected === true, 5000);
    expect(a.client.me).toBe(1);
    await until(() => room.host.fullState?.phase === 'gameOver' && a.client.state?.phase === 'gameOver', 60000);
    expect(room.host.fullState!.round).toBeGreaterThanOrEqual(rounds);
    expect(a.client.state!.result).toEqual(room.host.fullState!.result);
    room.host.stop();
  }, 70000);

  it('時間切れになると、その手番はCPUが代わりに操作する', async () => {
    const room = makeRoom({ ...FAST, turnLimitMs: 30, counterLimitMs: 30 });
    room.hostView.auto = false;
    const a = await room.join('アン', 2);
    a.view.auto = false;
    await until(() => room.host.seats.length === 2);
    room.host.startGame(0);
    // 誰も操作しなくても、時間切れで進んでいく
    await until(() => room.host.fullState!.turnCount >= 4, 10000);
    const rolls = room.host.fullState!.log.filter((e) => e.type === 'roll');
    expect(rolls.some((e) => e.player === 0)).toBe(true);
    expect(rolls.some((e) => e.player === 1)).toBe(true);
    room.host.stop();
  }, 15000);

  it('ゲームが始まった後に、知らない端末は入れない。版が違う画面も断る', async () => {
    const room = makeRoom();
    room.hostView.auto = false;
    await room.join('アン', 2);
    await until(() => room.host.seats.length === 2);
    room.host.startGame(0);
    const late = await room.join('ベン', 3);
    late.view.auto = false;
    await until(() => late.ended.length > 0);
    expect(late.ended[0]).toContain('始まっています');

    const conn = await room.net.connect('ABCDE');
    const replies: unknown[] = [];
    conn.onMessage((m) => replies.push(m));
    conn.send({ t: 'hello', v: 999, clientId: 'x', name: 'x' });
    await until(() => replies.length > 0);
    expect(replies[0]).toEqual({ t: 'rejected', reason: 'version' });
    room.host.stop();
  });

  it('ホストが部屋を閉じると、参加者に知らされる', async () => {
    const room = makeRoom();
    const a = await room.join('アン', 2);
    await until(() => room.host.seats.length === 2);
    room.host.stop();
    await until(() => a.ended.length > 0);
    expect(a.ended[0]).toContain('閉じました');
  });

  it('ホストは、自分の番でないときやおかしな操作を受け付けない', async () => {
    const room = makeRoom();
    room.hostView.auto = false;
    const a = await room.join('アン', 2);
    a.view.auto = false;
    await until(() => room.host.seats.length === 2);
    // ホストが先手になるシードで始める
    let seed = 1;
    while (turnOrderFor(2, seed)[0] !== 0) seed++;
    room.host.startGame(0, seed);
    await until(() => room.host.legal.length > 0);
    // ホスト（席0）の番に、アンが勝手にダイスを振ろうとしても無視される
    const conn = (a.client as unknown as { conn: HostSide }).conn;
    conn.send({ t: 'action', seq: 0, action: { type: 'roll', player: 1 } } as never);
    conn.send({ t: 'action', seq: 0, action: { type: 'roll', player: 0 } } as never);
    await sleep(50);
    expect(room.host.fullState!.log.filter((e) => e.type === 'roll')).toEqual([]);
    room.host.stop();
  });
});
