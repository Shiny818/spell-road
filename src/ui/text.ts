// イベントを画面に出す文章にする

import { getCardDef } from '../core/cards';
import type { GameEvent, GameState } from '../core/types';

export function describeEvent(e: GameEvent, s: GameState): string | null {
  const name = (i: number) => s.players[i].name;
  const card = (id: string) => `「${getCardDef(id).name}」`;

  switch (e.type) {
    case 'turnStart':
      return `${name(e.player)}のターン`;
    case 'skipTurn':
      return `${name(e.player)}は凍りついて動けない（1回休み）`;
    case 'roll': {
      const sum = e.dice.reduce((a, b) => a + b, 0);
      return `${name(e.player)}のサイコロ: ${e.dice.join('+')}${sum !== e.value ? ` → ${e.value}` : ''}`;
    }
    case 'cardPlayed':
      return `${name(e.player)}が${card(e.cardId)}を使った${e.target !== undefined ? `（→ ${name(e.target)}）` : ''}`;
    case 'valueChanged':
      return `出目が ${e.value} になった`;
    case 'pushedBack':
      return `${name(e.player)}は${e.steps}マス戻された`;
    case 'gateStop':
      return `${name(e.player)}は関所で止まった`;
    case 'gateFail':
      return `封印は解けない…（ひび${e.cracks}本）`;
    case 'gateBroken':
      return `封印が砕けた！ ${name(e.player)}は今回必ず関所を通れる`;
    case 'gatePass':
      return `${name(e.player)}は関所を通過した！`;
    case 'trapPlaced':
      return `${name(e.player)}が炎の罠を置いた`;
    case 'trapTriggered':
      return `${name(e.player)}が罠を踏んだ！`;
    case 'countered':
      return e.reflected
        ? `${name(e.player)}は${card(e.cardId)}ではね返した！`
        : `${name(e.player)}は${card(e.cardId)}で防いだ！`;
    case 'statusApplied':
      return e.status === 'rest'
        ? `${name(e.player)}は凍りついた（次のターンは休み）`
        : `${name(e.player)}に霜の呪い（次の出目-2）`;
    case 'swapped':
      return `${name(e.a)}と${name(e.b)}の位置が入れ替わった`;
    case 'stolen':
      return `${name(e.to)}が${name(e.from)}のカードを1枚奪った`;
    case 'draw':
      return `${name(e.player)}はカードを${e.count}枚引いた`;
    case 'exchanged':
      return e.swapped ? `${name(e.player)}はカードを交換した` : null;
    case 'coin':
      return `${name(e.player)}はコインを${e.amount}枚手に入れた`;
    case 'discarded':
      return `${name(e.player)}はカードを${e.count}枚捨てた`;
    case 'gameOver':
      return `${name(e.result.winner)}がゴール！`;
    case 'step':
      return null;
  }
}
