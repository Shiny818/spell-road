// イベントを画面に出す文章にする

import { getCardDef } from '../core/cards';
import type { GameEvent, GameState, Statuses } from '../core/types';

const STATUS_TEXT: Record<keyof Statuses, (who: string) => string> = {
  rest: (who) => `${who}は凍りついた（次のターンは休み）`,
  frost: (who) => `${who}に霜の呪い（次の出目-2）`,
  blizzard: (who) => `${who}に吹雪（次に進むマスが半分）`,
  sealed: (who) => `${who}は封印された（次のターンの終わりまでカードを使えない）`,
  protected: (who) => `${who}は聖なる加護に包まれた（次のターンまで攻撃を受けない）`,
};

export function describeEvent(e: GameEvent, s: GameState): string | null {
  const name = (i: number) => s.players[i].name;
  const card = (id: string) => `「${getCardDef(id).name}」`;

  switch (e.type) {
    case 'turnStart':
      return e.extra ? `時間が止まった！ ${name(e.player)}がもう一度動く` : `${name(e.player)}のターン`;
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
      return `${name(e.player)}が${e.kind === 'ice' ? '氷' : '炎'}の罠を置いた`;
    case 'trapTriggered':
      return e.kind === 'ice' ? `${name(e.player)}が氷の罠を踏んだ！ 足が凍りついた` : `${name(e.player)}が炎の罠を踏んだ！`;
    case 'countered':
      return e.reflected
        ? `${name(e.player)}は${card(e.cardId)}ではね返した！`
        : `${name(e.player)}は${card(e.cardId)}で防いだ！`;
    case 'statusApplied':
      return STATUS_TEXT[e.status](name(e.player));
    case 'cleansed':
      return `${name(e.player)}の悪い状態が消えた`;
    case 'blocked':
      return `${name(e.player)}は聖なる加護で守られている！`;
    case 'slowed':
      return `吹雪で足が重い…（${e.steps}マスだけ進む）`;
    case 'forgotten':
      return `${name(e.player)}はカードを1枚忘れてしまった`;
    case 'traded':
      return `${name(e.from)}と${name(e.to)}がカードを取り引きした`;
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
