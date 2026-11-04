// 通信対戦で、プレイヤーごとに「見せてよい状態」を作る。
// 他の人の手札・山札・捨て札の中身・乱数は伏せる（枚数だけ分かるようにする）。

import type { CardInstance, GameState } from './types';

/** 中身を伏せたカードの id */
export const HIDDEN_CARD = 'hidden';

const hide = (cards: CardInstance[]): CardInstance[] => cards.map(() => ({ uid: 0, cardId: HIDDEN_CARD }));

/** seat の人に見せてよい状態。null なら全員のものを伏せる（観戦用） */
export function redactFor(s: GameState, seat: number | null): GameState {
  const pending =
    s.pending?.kind === 'exchange' && s.pending.player !== seat ? { ...s.pending, offer: hide(s.pending.offer) } : s.pending;
  return structuredClone({
    ...s,
    players: s.players.map((p) => (p.index === seat ? p : { ...p, hand: hide(p.hand) })),
    deck: hide(s.deck),
    discard: hide(s.discard),
    pending,
    // 乱数の状態が分かると、次のダイスや山札の順番が予想できてしまう
    rngState: 0,
    forcedDice: [],
    // できごとは別に送るので、これまでの記録はいらない
    log: [],
  });
}
