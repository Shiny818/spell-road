import { describe, expect, it } from 'vitest';
import { autoplay, randomChooser } from '../src/ai/autoplay';
import { setup } from './helpers';
import { buildSharedDeck, MVP_CARD_IDS } from '../src/core/cards';
import { createGame } from '../src/core/engine';
import { FOREST } from './helpers';

function newGame(players: number, seed: number) {
  return createGame({
    board: FOREST,
    players: Array.from({ length: players }, (_, i) => ({ name: `CPU${i}`, isCpu: true })),
    deck: buildSharedDeck(MVP_CARD_IDS),
    seed,
  });
}

describe('最後まで遊べる', () => {
  it('CPUどうしの対戦が終わる', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const s = autoplay(newGame(2 + (seed % 3), seed));
      expect(s.phase).toBe('gameOver');
      expect(s.result!.ranks).toContain(1);
    }
  });

  it('ランダムな合法手だけで進めても、エラーにならずに終わる', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const s = autoplay(newGame(4, seed), randomChooser(seed), 20000);
      expect(s.phase).toBe('gameOver');
      // カードはどこかにある（増えたり消えたりしない）
      const pending = s.pending?.kind === 'exchange' ? s.pending.offer.length : 0;
      const total = s.deck.length + s.discard.length + pending + s.players.reduce((n, p) => n + p.hand.length, 0);
      expect(total).toBe(setup().deck.length);
    }
  }, 30000);
});
