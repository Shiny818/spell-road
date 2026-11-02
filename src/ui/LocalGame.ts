// 1台の端末で、人間1人とCPUが対戦するときの進行役。
// 操作を適用し、増えたイベントを画面に再生させ、CPUの番なら自動で操作する。

import { chooseCpuAction } from '../ai/cpu';
import { applyAction, expectedActor } from '../core/engine';
import type { Action, GameEvent, GameState } from '../core/types';

const CPU_DELAY_MS = 650;

export interface GameView {
  /** イベントを順に再生する（アニメーション・メッセージ） */
  playEvents(events: GameEvent[], state: GameState): Promise<void>;
  /** 現在の状態で画面全体を描き直す */
  render(state: GameState): void;
}

export class LocalGame {
  private busy = false;
  private stopped = false;

  constructor(
    public state: GameState,
    public readonly human: number,
    private readonly view: GameView,
  ) {}

  start(): void {
    this.view.render(this.state);
    this.next();
  }

  stop(): void {
    this.stopped = true;
  }

  /** イベントの再生中か */
  get isBusy(): boolean {
    return this.busy;
  }

  /** 人間が操作できる状態か */
  get waitingForHuman(): boolean {
    return !this.busy && expectedActor(this.state) === this.human;
  }

  async act(action: Action): Promise<void> {
    if (this.busy || this.stopped) return;
    this.busy = true;
    const prev = this.state;
    this.state = applyAction(prev, action);
    this.view.render(this.state);
    await this.view.playEvents(this.state.log.slice(prev.log.length), this.state);
    this.busy = false;
    if (this.stopped) return;
    this.view.render(this.state);
    this.next();
  }

  private next(): void {
    const actor = expectedActor(this.state);
    if (actor === null || actor === this.human) return;
    setTimeout(() => {
      if (!this.stopped) void this.act(chooseCpuAction(this.state, actor));
    }, CPU_DELAY_MS);
  }
}
