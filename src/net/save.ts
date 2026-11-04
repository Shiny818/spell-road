// ホストの端末への自動保存。ホストの画面が閉じても、同じ部屋コードで部屋を開き直せば
// 続きから再開できるようにする（docs/spec.md 6.3）。保存先はホスト自身の端末だけ。

import type { GameState } from '../core/types';
import { PROTOCOL_VERSION } from './protocol';

/** 保存の形の版。保存する中身を変えたら上げる（古い保存は再開できないものとして捨てる） */
export const SAVE_VERSION = 1;
/** これより古い保存は再開しない */
export const SAVE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'spell-road.save';

export interface SavedSeat {
  name: string;
  kind: 'human' | 'cpu';
  host: boolean;
  /** 参加者の端末の目印（つなぎ直したときに同じ席に戻すため） */
  clientId: string | null;
}

export interface SavedRoom {
  v: number;
  /** 通信の版。メッセージの形が変わっていたら再開しない */
  protocol: number;
  savedAt: number;
  code: string;
  /** 何回目のゲームか */
  gameNo: number;
  seq: number;
  seats: SavedSeat[];
  /** ルールの処理に使う、すべてが分かる状態（乱数の状態も含む） */
  state: GameState;
}

export interface SaveStore {
  /** 再開できる保存があれば返す（古い・壊れた保存は捨てて null） */
  load(): SavedRoom | null;
  save(room: SavedRoom): void;
  clear(): void;
}

/** 保存の中身が再開に使えるか確かめる。使えなければ null */
export function validateSave(raw: unknown, now = Date.now()): SavedRoom | null {
  const r = raw as Partial<SavedRoom> | null;
  if (!r || typeof r !== 'object') return null;
  if (r.v !== SAVE_VERSION || r.protocol !== PROTOCOL_VERSION) return null;
  if (typeof r.savedAt !== 'number' || now - r.savedAt > SAVE_MAX_AGE_MS || r.savedAt > now + 60_000) return null;
  if (typeof r.code !== 'string' || typeof r.gameNo !== 'number' || typeof r.seq !== 'number') return null;
  if (!Array.isArray(r.seats) || r.seats.length < 2 || !r.seats[0]?.host) return null;
  const s = r.state;
  if (!s || typeof s !== 'object' || !Array.isArray(s.players) || s.players.length !== r.seats.length) return null;
  if (s.phase === 'gameOver' || s.result) return null;
  return r as SavedRoom;
}

/** ブラウザの localStorage に保存する（使えない環境では何もしない） */
export function localSaveStore(): SaveStore {
  return {
    load() {
      try {
        const text = localStorage.getItem(STORAGE_KEY);
        if (!text) return null;
        const room = validateSave(JSON.parse(text));
        if (!room) localStorage.removeItem(STORAGE_KEY);
        return room;
      } catch {
        return null;
      }
    },
    save(room) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(room));
      } catch {
        // 保存できなくてもゲームは続ける（再開できなくなるだけ）
      }
    },
    clear() {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // 何もしない
      }
    },
  };
}

/** テスト用: 保存先をメモリにする（本物と同じく、JSON にして出し入れする） */
export function memorySaveStore(): SaveStore & { raw(): string | null } {
  let text: string | null = null;
  return {
    load() {
      if (text === null) return null;
      const room = validateSave(JSON.parse(text));
      if (!room) text = null;
      return room;
    },
    save(room) {
      text = JSON.stringify(room);
    },
    clear() {
      text = null;
    },
    raw: () => text,
  };
}
