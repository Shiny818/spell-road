// 画面（App）から見た、ゲームの進行役。ホストでも参加者でも同じ形で扱えるようにする。

import type { Action, GameEvent, GameState } from '../core/types';
import type { Clock, SeatInfo } from './protocol';

export interface GameView {
  /** できごとを順に再生する（アニメーション・メッセージ） */
  playEvents(events: GameEvent[], state: GameState): Promise<void>;
  /** 今の状態で画面全体を描き直す */
  render(state: GameState): void;
}

/** 制限時間。deadline はこの端末の performance.now() の時刻 */
export interface LocalClock extends Omit<Clock, 'remainingMs'> {
  deadline: number;
}

export interface GameSession {
  /** 自分の席 */
  readonly me: number;
  readonly isHost: boolean;
  /** 今の状態（参加者なら、自分に見えてよい状態） */
  readonly state: GameState | null;
  /** 自分が今できる操作（演出中・他の人の番なら空） */
  readonly legal: Action[];
  readonly seats: SeatInfo[];
  readonly clock: LocalClock | null;
  /** 演出の再生中か */
  readonly busy: boolean;
  act(action: Action): void;
  stop(): void;
}

export function toLocalClock(clock: Clock | null): LocalClock | null {
  if (!clock) return null;
  const { remainingMs, ...rest } = clock;
  return { ...rest, deadline: performance.now() + remainingMs };
}
