import { describe, expect, it } from 'vitest';
import { autoplay, randomChooser } from '../src/ai/autoplay';
import { applyAction, expectedActor, getLegalActions } from '../src/core/engine';
import { HIDDEN_CARD, redactFor } from '../src/core/view';
import type { GameState } from '../src/core/types';
import { give, run, setup } from './helpers';

/** 伏せたはずの情報が残っていないか */
function expectNoLeak(s: GameState, seat: number) {
  const v = redactFor(s, seat);
  for (const p of v.players) {
    expect(p.hand).toHaveLength(s.players[p.index].hand.length);
    if (p.index === seat) expect(p.hand).toEqual(s.players[seat].hand);
    else expect(p.hand.every((c) => c.cardId === HIDDEN_CARD && c.uid === 0)).toBe(true);
  }
  expect(v.deck).toHaveLength(s.deck.length);
  expect(v.deck.every((c) => c.cardId === HIDDEN_CARD)).toBe(true);
  expect(v.discard.every((c) => c.cardId === HIDDEN_CARD)).toBe(true);
  expect(v.rngState).toBe(0);
  expect(v.log).toEqual([]);
  if (v.pending?.kind === 'exchange' && v.pending.player !== seat) {
    expect(v.pending.offer.every((c) => c.cardId === HIDDEN_CARD)).toBe(true);
  }
}

describe('プレイヤーごとの見える状態', () => {
  it('自分の手札だけが見え、他の人の手札・山札・乱数は伏せられる', () => {
    const s = setup(3);
    give(s, 0, 'kaen');
    give(s, 1, 'hikari_no_kabe');
    give(s, 1, 'oikaze');
    for (const seat of [0, 1, 2]) expectNoLeak(s, seat);
    const v = redactFor(s, 1);
    expect(v.players[1].hand.map((c) => c.cardId)).toEqual(['hikari_no_kabe', 'oikaze']);
    expect(v.players[0].hand).toEqual([{ uid: 0, cardId: HIDDEN_CARD }]);
    // 元の状態は書き換えない
    expect(s.players[0].hand[0].cardId).toBe('kaen');
  });

  it('カード交換で並ぶカードは、交換する本人にだけ見える', () => {
    let s = setup(2);
    give(s, 0, 'oikaze');
    // 3+4 で a7（交換マス）に止まる
    s.forcedDice = [3, 4];
    s.turn.diceCount = 2;
    s = run(s, { type: 'roll', player: 0 }, { type: 'confirmMove', player: 0 });
    expect(s.pending?.kind).toBe('exchange');
    expect(redactFor(s, 0).pending).toEqual(s.pending);
    expectNoLeak(s, 1);
  });

  it('ゲームの最初から最後まで、どの時点でも漏れない', () => {
    let s = setup(4, 7);
    const choose = randomChooser(7);
    for (let i = 0; i < 3000 && s.phase !== 'gameOver'; i++) {
      const actor = expectedActor(s)!;
      for (const seat of [0, 1, 2, 3]) expectNoLeak(s, seat);
      s = applyAction(s, choose(s, actor));
    }
    expect(s.phase).toBe('gameOver');
  });

  it('全員の手札を伏せても（観戦用）ゲームの進み具合は分かる', () => {
    const s = autoplay(setup(2, 3));
    const v = redactFor(s, null);
    expect(v.result).toEqual(s.result);
    expect(v.players.every((p) => p.hand.every((c) => c.cardId === HIDDEN_CARD))).toBe(true);
    expect(getLegalActions(v, 0)).toEqual([]);
  });
});
