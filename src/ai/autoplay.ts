// CPUだけでゲームを最後まで進める（シミュレーション・テスト用）

import { applyAction, expectedActor, getLegalActions } from '../core/engine';
import type { Action, GameState } from '../core/types';
import { chooseCpuAction } from './cpu';

export type Chooser = (s: GameState, player: number) => Action;

export function autoplay(start: GameState, choose: Chooser = chooseCpuAction, maxActions = 5000): GameState {
  let s = start;
  for (let i = 0; i < maxActions; i++) {
    const actor = expectedActor(s);
    if (actor === null) return s;
    s = applyAction(s, choose(s, actor));
  }
  throw new Error(`${maxActions}回操作しても終わりませんでした`);
}

/** 合法手からランダムに選ぶ（ルールの穴を探すためのテスト用） */
export function randomChooser(seed: number): Chooser {
  let x = seed >>> 0 || 1;
  return (s, player) => {
    const legal = getLegalActions(s, player);
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return legal[(x >>> 0) % legal.length];
  };
}
