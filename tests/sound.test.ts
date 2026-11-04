import { describe, expect, it } from 'vitest';
import { soundForEvent } from '../src/ui/sound';

describe('効果音', () => {
  it('できごとに合った音を選ぶ', () => {
    expect(soundForEvent({ type: 'roll', player: 0, dice: [3], value: 3 }, undefined, 0)).toBe('dice');
    expect(soundForEvent({ type: 'step', player: 1, to: 'a1' }, undefined, 0)).toBe('step');
    expect(soundForEvent({ type: 'gateFail', player: 0, gate: 'g2', cracks: 1 }, undefined, 0)).toBe('gate_fail');
  });

  it('自分のターンが来たときだけターンの音を鳴らす', () => {
    expect(soundForEvent({ type: 'turnStart', player: 0, round: 1 }, undefined, 0)).toBe('turn');
    expect(soundForEvent({ type: 'turnStart', player: 1, round: 1 }, undefined, 0)).toBeNull();
  });

  it('罠で戻されたときは、罠の音だけを鳴らす', () => {
    const trap = { type: 'trapTriggered', player: 0, node: 'a3', owner: 1 } as const;
    const back = { type: 'pushedBack', player: 0, to: 'a1', steps: 2 } as const;
    expect(soundForEvent(trap, undefined, 0)).toBe('trap');
    expect(soundForEvent(back, trap, 0)).toBeNull();
    expect(soundForEvent(back, undefined, 0)).toBe('attack');
  });
});
