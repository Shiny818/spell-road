// 通信対戦で送り合うメッセージ。
// ホストがルールの処理をすべて行い、参加者は操作を送って結果を受け取るだけ（docs/spec.md 6.6）。

import type { Action, GameEvent, GameState } from '../core/types';

/** 通信の版。メッセージの形を変えたら上げる（古い画面がつながってきたら断る） */
export const PROTOCOL_VERSION = 2;

export const MAX_PLAYERS = 4;

/** 席の情報（全員に見える） */
export interface SeatInfo {
  name: string;
  /** cpu: CPUの席 / human: 人の席 */
  kind: 'human' | 'cpu';
  /** 人の席で、今つながっているか（切断中はCPUが代わりに操作する） */
  connected: boolean;
  /** ホストの席か */
  host: boolean;
  /** 選んだキャラクター（0〜3）。まだ選んでいなければ null */
  chara: number | null;
}

/** 制限時間（ホストが数える。端末ごとの時計のずれが関係ないよう、残り時間で送る） */
export interface Clock {
  player: number;
  kind: 'turn' | 'counter';
  remainingMs: number;
}

/** 参加者 → ホスト */
export type ClientMessage =
  | { t: 'hello'; v: number; clientId: string; name: string }
  | { t: 'action'; seq: number; action: Action }
  /** 待合室で名前を変える */
  | { t: 'rename'; name: string }
  /** キャラクターを選ぶ（早い者勝ち） */
  | { t: 'pick'; chara: number }
  /** 演出を見終わった（ホストは全員が見終わってから次へ進める） */
  | { t: 'watched'; seq: number }
  | { t: 'leave' }
  | { t: 'ping' };

/** ホスト → 参加者 */
export type HostMessage =
  /** 待合室（ゲーム前）。choosing ならキャラクターを選んでいるところ */
  | { t: 'lobby'; you: number; seats: SeatInfo[]; choosing?: boolean }
  /**
   * ゲームの状態と、新しく起きたできごと。seq はホストが状態を変えるたびに1増え、
   * game は「もう一度」で新しいゲームになると1増える
   */
  | {
      t: 'update';
      game: number;
      seq: number;
      you: number;
      seats: SeatInfo[];
      state: GameState;
      events: GameEvent[];
    }
  /** 全員が演出を見終わった後に送る。その人が今できる操作と制限時間 */
  | { t: 'prompt'; seq: number; legal: Action[]; clock: Clock | null }
  /** 切断・再接続で、席の状態が変わった */
  | { t: 'seats'; seats: SeatInfo[] }
  | { t: 'rejected'; reason: RejectReason }
  /** ホストが部屋を閉じた */
  | { t: 'closed' }
  | { t: 'ping' };

export type RejectReason = 'version' | 'full' | 'started';

export const REJECT_TEXT: Record<RejectReason, string> = {
  version: 'ホストとアプリの版が違います。両方の画面を読み込み直してください。',
  full: '部屋がいっぱいです（4人まで）。',
  started: 'ゲームがもう始まっています。',
};

/** 部屋コードに使う文字（読み間違えやすい 0/O・1/I は使わない） */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

export function makeRoomCode(random: () => number = Math.random): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[Math.floor(random() * CODE_CHARS.length)]).join('');
}

/** 入力された部屋コードを整える。使えない文字が入っていれば null */
export function normalizeRoomCode(input: string): string | null {
  const code = input.replace(/\s/g, '').toUpperCase();
  if (code.length !== CODE_LENGTH) return null;
  return [...code].every((c) => CODE_CHARS.includes(c)) ? code : null;
}
