import forest from '../src/data/boards/forest.json';
import { buildSharedDeck, MVP_CARD_IDS } from '../src/core/cards';
import { applyAction, createGame } from '../src/core/engine';
import type { Action, BoardDef, GameState } from '../src/core/types';

export const FOREST = forest as BoardDef;

/** 手札を空にした状態のゲーム（プレイヤー0の手番から） */
export function setup(players = 2, seed = 1): GameState {
  const s = createGame({
    board: FOREST,
    players: Array.from({ length: players }, (_, i) => ({ name: `P${i}`, isCpu: true })),
    deck: buildSharedDeck(MVP_CARD_IDS),
    seed,
  });
  for (const p of s.players) {
    s.deck.push(...p.hand);
    p.hand = [];
  }
  return s;
}

export function give(s: GameState, player: number, cardId: string): number {
  const uid = s.nextUid++;
  s.players[player].hand.push({ uid, cardId });
  return uid;
}

/** スタートから指定のマスまでの道のり（分岐は dice の指定順に探す） */
export function trailTo(target: string): string[] {
  const nodes = new Map(FOREST.nodes.map((n) => [n.id, n]));
  const walk = (id: string, path: string[]): string[] | null => {
    if (id === target) return [...path, id];
    for (const e of nodes.get(id)!.next) {
      const r = walk(e.to, [...path, id]);
      if (r) return r;
    }
    return null;
  };
  return walk('start', [])!;
}

export function placeAt(s: GameState, player: number, nodeId: string): void {
  s.players[player].trail = trailTo(nodeId);
}

export function at(s: GameState, player: number): string {
  const t = s.players[player].trail;
  return t[t.length - 1];
}

/** 操作を順に適用する */
export function run(s: GameState, ...actions: Action[]): GameState {
  return actions.reduce(applyAction, s);
}
