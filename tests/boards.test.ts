import { describe, expect, it } from 'vitest';
import { boardInfo, branchEdge, validateBoard } from '../src/core/board';
import { ALL_CARD_IDS, buildSharedDeck } from '../src/core/cards';
import { autoplay } from '../src/ai/autoplay';
import { createGame } from '../src/core/engine';
import type { BoardDef, BoardNode } from '../src/core/types';
import { BOARDS, getBoard } from '../src/data/boards';
import { HostSession } from '../src/net/HostSession';
import type { GameView } from '../src/net/session';

const MOUNTAIN = getBoard('mountain');
const node = (b: BoardDef, id: string) => b.nodes.find((n) => n.id === id)!;

/** 分岐先から合流のマスまで、1本道をたどったマス */
function route(b: BoardDef, from: string, until: string): BoardNode[] {
  const out: BoardNode[] = [];
  for (let id = from; id !== until; id = node(b, id).next[0].to) out.push(node(b, id));
  return out;
}
const special = (ns: BoardNode[]) => ns.filter((n) => n.type === 'card' || n.type === 'exchange').length;

describe('ボードの一覧', () => {
  it('どのボードもデータに問題がなく、位置が重ならない', () => {
    for (const b of BOARDS) {
      expect(validateBoard(b), b.id).toEqual([]);
      const pos = b.nodes.map((n) => n.pos!.join(','));
      expect(new Set(pos).size, b.id).toBe(pos.length);
    }
    expect(BOARDS.map((b) => b.id)).toEqual(['forest', 'mountain']);
  });
});

describe('いわやまの峠道', () => {
  it('関所は中ほどに1つだけ。2・3で近道、4・5で遠回り', () => {
    const gates = MOUNTAIN.nodes.filter((n) => n.type === 'gate');
    expect(gates.map((g) => g.id)).toEqual(['g1']);
    expect(gates[0].gate!.pass).toEqual([2, 3, 4, 5]);
    const info = boardInfo(MOUNTAIN);
    const before = info.distToGoal.get('start')! - info.distToGoal.get('g1')!;
    expect(before / info.distToGoal.get('start')!).toBeGreaterThan(0.35);
    expect(before / info.distToGoal.get('start')!).toBeLessThan(0.55);
  });

  it('近道は遠回りの約8割の長さで、カード・交換のマスは半分以下。2つのルートはゴールの手前で合流する', () => {
    const short = route(MOUNTAIN, 's1', 'm1');
    const long = route(MOUNTAIN, 'd1', 'm1');
    expect(short.length / long.length).toBeGreaterThan(0.75);
    expect(short.length / long.length).toBeLessThan(0.86);
    expect(special(short) * 2).toBeLessThanOrEqual(special(long));
    // 合流してからゴールまでは数マス
    expect(boardInfo(MOUNTAIN).distToGoal.get('m1')).toBeLessThanOrEqual(3);
  });

  it('封印が砕けて条件外の目で抜けたときは、出目が近いほうのルートに進む', () => {
    const g1 = node(MOUNTAIN, 'g1');
    expect([1, 2, 3, 4, 5, 6].map((v) => branchEdge(g1, v).to)).toEqual(['s1', 's1', 's1', 'd1', 'd1', 'd1']);
    // はじまりの森の分岐は、これまでと同じ
    const forest = getBoard('forest');
    expect([1, 2, 3, 4, 5, 6].map((v) => branchEdge(node(forest, 'g2'), v).to)).toEqual(['l1', 'l1', 'l1', 'l1', 'r1', 'r1']);
    expect([1, 2, 3, 4, 5, 6].map((v) => branchEdge(node(forest, 'g3'), v).to)).toEqual(['u1', 'v1', 'u1', 'v1', 'u1', 'u1']);
  });

  it('CPUどうしで最後まで遊べ、どちらのルートにも進む', () => {
    const routes = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const s = autoplay(
        createGame({
          board: MOUNTAIN,
          players: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, isCpu: true })),
          deck: buildSharedDeck(ALL_CARD_IDS),
          seed,
        }),
      );
      expect(s.phase).toBe('gameOver');
      for (const e of s.log) if (e.type === 'gatePass') routes.add(e.to);
    }
    expect([...routes].sort()).toEqual(['d1', 's1']);
  });
});

describe('マップを選んで始める', () => {
  it('選んだマップで始まり、「もう一度」でも同じマップになる', async () => {
    const view: GameView = { playEvents: async () => {}, render: () => {} };
    const host = new HostSession('ホスト', view, null, {}, { cpuDelayMs: 1000, heartbeat: false });
    await host.startGame(1, 1, 'mountain');
    expect(host.fullState!.board.id).toBe('mountain');
    await host.startGame(1, 2);
    expect(host.fullState!.board.id).toBe('mountain');
    await host.startGame(1, 3, 'forest');
    expect(host.fullState!.board.id).toBe('forest');
    host.stop();
  });
});
