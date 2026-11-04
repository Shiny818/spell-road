import { describe, expect, it } from 'vitest';
import { moodByEvent, moodByRank } from '../src/ui/expression';
import { placeAt, setup } from './helpers';

describe('バストアップの表情', () => {
  it('全員が同じ位置ならふつうの顔', () => {
    const s = setup(3);
    expect([0, 1, 2].map((p) => moodByRank(s, p))).toEqual(['normal', 'normal', 'normal']);
  });

  it('1位は笑顔、最下位はしかめっ面、その間はふつう', () => {
    const s = setup(3);
    placeAt(s, 0, 'b3');
    placeAt(s, 1, 'a3');
    expect(moodByRank(s, 0)).toBe('happy');
    expect(moodByRank(s, 1)).toBe('normal');
    expect(moodByRank(s, 2)).toBe('frown');
  });

  it('カードを使ったら勇ましい顔、攻撃を受けたら悲しい顔', () => {
    const played = { type: 'cardPlayed', player: 0, cardId: 'honoo_no_tsubute', target: 1 } as const;
    expect(moodByEvent(played, 0)).toBe('brave');
    expect(moodByEvent(played, 1)).toBe('sad');
    expect(moodByEvent(played, 2)).toBeNull();
    expect(moodByEvent({ type: 'pushedBack', player: 2, to: 'a1', steps: 2 }, 2)).toBe('sad');
  });
});
