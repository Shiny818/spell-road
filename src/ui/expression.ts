// 手番キャラのバストアップの表情を、状況から決める。
// 表情ごとの絵（public/assets/chara/bust/p1_happy.png など）が無ければ、ふつうの顔の絵で代用する。

import { distanceToGoal } from '../core/engine';
import type { GameEvent, GameState } from '../core/types';

/** 表情の種類。normal 以外は絵のファイル名の末尾になる（p1_brave.png など） */
export type Expression = 'normal' | 'happy' | 'frown' | 'brave' | 'sad';

export const EXPRESSIONS: Expression[] = ['normal', 'happy', 'frown', 'brave', 'sad'];

/** 何も起きていないときの表情。順位で決める（1位は笑顔、最下位はしかめっ面） */
export function moodByRank(s: GameState, player: number): Expression {
  if (s.result) {
    const ranks = s.result.ranks;
    if (ranks[player] === 1) return 'happy';
    return ranks[player] === Math.max(...ranks) ? 'frown' : 'normal';
  }
  const dist = s.players.map((p) => distanceToGoal(s, p));
  const mine = distanceToGoal(s, s.players[player]);
  const best = Math.min(...dist);
  const worst = Math.max(...dist);
  if (best === worst) return 'normal';
  if (mine === best && dist.filter((d) => d === best).length === 1) return 'happy';
  if (mine === worst) return 'frown';
  return 'normal';
}

/** できごとに対する、そのプレイヤーの表情。関係のないできごとなら null */
export function moodByEvent(e: GameEvent, player: number): Expression | null {
  switch (e.type) {
    case 'cardPlayed':
      if (e.player === player) return 'brave';
      if (e.target === player) return 'sad';
      return null;
    case 'countered':
      if (e.player === player) return 'brave';
      if (e.attacker === player) return 'sad';
      return null;
    case 'pushedBack':
    case 'forgotten':
    case 'slowed':
      return e.player === player ? 'sad' : null;
    case 'blocked':
      return e.player === player ? 'brave' : null;
    default:
      return null;
  }
}
