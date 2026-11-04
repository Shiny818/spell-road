import { describe, expect, it } from 'vitest';
import { ALL_CARD_IDS, buildSharedDeck } from '../src/core/cards';
import { createGame, turnOrderFrom } from '../src/core/engine';
import type { GameState } from '../src/core/types';
import { FOREST } from './helpers';
import { ClientSession } from '../src/net/ClientSession';
import { HostSession, type HostTiming } from '../src/net/HostSession';
import type { SeatInfo } from '../src/net/protocol';
import type { GameView } from '../src/net/session';
import { createMemoryNetwork } from '../src/net/transport';
import { autoplay } from '../src/ai/autoplay';

const FAST: Partial<HostTiming> = { cpuDelayMs: 0, watchWaitMs: 200, turnLimitMs: 2000, counterLimitMs: 2000, heartbeat: false };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('時間切れ');
    await sleep(5);
  }
}

/** 何もしない画面 */
const idle: GameView = { playEvents: async () => {}, render: () => {} };

describe('手番の順番', () => {
  it('order の順に手番が回り、最後の人の次でラウンドが進む', () => {
    const order = [2, 0, 3, 1];
    const start: GameState = createGame({
      board: FOREST,
      players: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, isCpu: true, chara: 3 - i })),
      deck: buildSharedDeck(ALL_CARD_IDS),
      seed: 7,
      order,
    });
    expect(start.current).toBe(2);
    expect(start.players.map((p) => p.chara)).toEqual([3, 2, 1, 0]);
    const end = autoplay(start);
    // 手番（飛ばされた手番も含む。時間停止の追加ターンは除く）の持ち主を順に並べる
    const turns = end.log.filter(
      (e): e is Extract<typeof e, { type: 'turnStart' | 'skipTurn' }> => (e.type === 'turnStart' && !e.extra) || e.type === 'skipTurn',
    );
    expect(turns.length).toBeGreaterThan(8);
    turns.forEach((e, i) => expect(e.player).toBe(order[i % order.length]));
    const rounds = end.log.filter((e) => e.type === 'turnStart' && !e.extra && e.player === order[0]).map((e) => (e as { round: number }).round);
    expect(rounds.slice(0, 3)).toEqual([1, 2, 3]);
  });

  it('全員への攻撃は、使った人の次の人から手番の順に当たる', () => {
    const s = createGame({
      board: FOREST,
      players: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, isCpu: true })),
      deck: buildSharedDeck(ALL_CARD_IDS),
      seed: 1,
      order: [1, 3, 0, 2],
    });
    expect(turnOrderFrom(s, 3)).toEqual([3, 0, 2, 1]);
    expect(turnOrderFrom(s, 1)).toEqual([1, 3, 0, 2]);
  });

  it('正しくない順番は受け付けない', () => {
    const base = { board: FOREST, players: [0, 1].map((i) => ({ name: `P${i}`, isCpu: true })), deck: [], seed: 1 };
    expect(() => createGame({ ...base, order: [0, 0] })).toThrow();
    expect(() => createGame({ ...base, order: [0] })).toThrow();
  });
});

describe('キャラクター選び（1人プレイ）', () => {
  it('選んだキャラクターで始まり、CPUは残りのキャラクターになる。手番はくじで決まる', async () => {
    const lobby: [SeatInfo[], boolean][] = [];
    const host = new HostSession('あなた', idle, null, { onLobby: (s, c) => lobby.push([s, c]) }, FAST);
    host.chooseCharacters(3, 'forest');
    expect(host.choosing).toBe(true);
    expect(lobby.at(-1)![1]).toBe(true);
    host.pickChara(2);
    await until(() => host.fullState !== null);
    const s = host.fullState!;
    expect(s.players[0].chara).toBe(2);
    expect(new Set(s.players.map((p) => p.chara))).toEqual(new Set([0, 1, 2, 3]));
    expect([...s.order].sort()).toEqual([0, 1, 2, 3]);
    expect(s.current).toBe(s.order[0]);
    host.stop();
  });

  it('いろいろなシードで、手番の順番がばらける', async () => {
    const firsts = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      const host = new HostSession('あなた', idle, null, {}, { ...FAST, cpuDelayMs: 100000 });
      await host.startGame(3, seed, 'forest');
      firsts.add(host.fullState!.order[0]);
      host.stop();
    }
    expect(firsts.size).toBeGreaterThan(1);
  });
});

describe('キャラクター選び・名前（通信対戦）', () => {
  function room() {
    const net = createMemoryNetwork();
    const host = new HostSession('', idle, net.host('ABCDE'), {}, FAST);
    const join = async (id: string) => {
      const lobby: [SeatInfo[], number, boolean][] = [];
      const client = new ClientSession(net.connect, 'ABCDE', '', id, idle, { onLobby: (s, y, c) => lobby.push([s, y, c]) }, { heartbeat: false });
      await client.start();
      return { client, lobby };
    };
    return { host, join };
  }

  it('名前は最初「プレイヤーN」で、自由に変えられる（同じ名前でもよい）。抜けると番号が詰まる', async () => {
    const r = room();
    const a = await r.join('a');
    const b = await r.join('b');
    await until(() => r.host.seats.length === 3);
    expect(r.host.seats.map((s) => s.name)).toEqual(['プレイヤー1', 'プレイヤー2', 'プレイヤー3']);
    a.client.rename('ねこ');
    r.host.rename('ねこ');
    await until(() => r.host.seats[1].name === 'ねこ');
    expect(r.host.seats.map((s) => s.name)).toEqual(['ねこ', 'ねこ', 'プレイヤー3']);
    // 空にすると元の名前に戻る
    a.client.rename('  ');
    await until(() => r.host.seats[1].name === 'プレイヤー2');
    a.client.stop();
    await until(() => r.host.seats.length === 2);
    expect(r.host.seats.map((s) => s.name)).toEqual(['ねこ', 'プレイヤー2']);
    await until(() => b.lobby.at(-1)?.[0].length === 2);
    expect(b.lobby.at(-1)![1]).toBe(1);
    r.host.stop();
  });

  it('キャラクターは早い者勝ちで、全員が選ぶと始まる。選び中は新しい人は入れない', async () => {
    const r = room();
    const a = await r.join('a');
    await until(() => r.host.seats.length === 2);
    r.host.chooseCharacters(1, 'forest');
    await until(() => a.lobby.at(-1)?.[2] === true);

    a.client.pickChara(1);
    await until(() => r.host.seats[1].chara === 1);
    // ほかの人が選んだキャラクターは選べない
    r.host.pickChara(1);
    expect(r.host.seats[0].chara).toBeNull();
    expect(r.host.fullState).toBeNull();
    // 選び直しはできる
    a.client.pickChara(3);
    await until(() => r.host.seats[1].chara === 3);

    await r.join('late');
    await sleep(50);
    expect(r.host.seats.length).toBe(2);

    r.host.pickChara(1);
    await until(() => r.host.fullState !== null);
    const s = r.host.fullState!;
    expect(s.players.map((p) => p.chara).slice(0, 2)).toEqual([1, 3]);
    expect(s.players[2].isCpu).toBe(true);
    expect([0, 2]).toContain(s.players[2].chara);
    await until(() => a.client.state !== null);
    expect(a.client.state!.order).toEqual(s.order);
    r.host.stop();
  });

  it('ホストは、まだの人がいてもおまかせで始められる', async () => {
    const r = room();
    await r.join('a');
    await until(() => r.host.seats.length === 2);
    r.host.chooseCharacters(0, 'forest');
    r.host.pickChara(0);
    expect(r.host.fullState).toBeNull();
    r.host.startWithoutWaiting();
    await until(() => r.host.fullState !== null);
    expect(r.host.fullState!.players[0].chara).toBe(0);
    expect(r.host.fullState!.players[1].chara).not.toBe(0);
    r.host.stop();
  });
});
