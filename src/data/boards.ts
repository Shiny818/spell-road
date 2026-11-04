// 遊べるボード（マップ）の一覧。ボードを足したら、ここに加える。

import type { BoardDef } from '../core/types';
import forest from './boards/forest.json';
import mountain from './boards/mountain.json';

export const BOARDS: BoardDef[] = [forest as BoardDef, mountain as BoardDef];

export const DEFAULT_BOARD_ID = 'forest';

/** id のボード。知らない id なら最初のボード */
export function getBoard(id: string): BoardDef {
  return BOARDS.find((b) => b.id === id) ?? BOARDS[0];
}
