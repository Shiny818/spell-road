// 色・アイコンなど見た目の定義（仮素材）

import type { Attribute, SquareType } from '../core/types';

export const PLAYER_COLORS = ['#e8577a', '#4a90e2', '#f2b632', '#5cb85c'];
export const PLAYER_ICONS = ['🧙‍♀️', '🧙', '🧝', '🧚'];

export const SQUARE_STYLE: Record<SquareType, { color: string; icon: string; label: string }> = {
  start: { color: '#ffffff', icon: '⭐', label: 'スタート' },
  empty: { color: '#f4efe6', icon: '', label: '何もなし' },
  card: { color: '#cfe8ff', icon: '🃏', label: 'カード入手' },
  exchange: { color: '#e5d4ff', icon: '🔄', label: 'カード交換' },
  coin: { color: '#fff1b8', icon: '🪙', label: 'コイン' },
  gate: { color: '#c9b79c', icon: '🚪', label: '関所' },
  goal: { color: '#ffd6e0', icon: '🏁', label: 'ゴール' },
};

export const ATTRIBUTE_STYLE: Record<Attribute, { color: string; name: string }> = {
  wind: { color: '#5cb85c', name: '風' },
  time: { color: '#9b6dd6', name: '時' },
  fire: { color: '#e5533d', name: '炎' },
  ice: { color: '#4fb8d9', name: '氷' },
  light: { color: '#e6b422', name: '光' },
  dark: { color: '#4a4a5a', name: '闇' },
};

export const TIMING_LABEL = {
  start: 'ターン開始',
  afterRoll: '出目の後',
  end: 'ターン終了',
  counter: 'カウンター',
} as const;
