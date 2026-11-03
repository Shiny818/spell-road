// 画像素材の場所。素材は public/assets/ に置く（一覧は docs/assets.md）。
// 無い素材は読み込みに失敗するので、そのときは今までの絵文字・色で表示する。

import type { Attribute, SquareType } from '../core/types';

const BASE = `${import.meta.env.BASE_URL}assets/`;

export const ASSET = {
  chara: (player: number) => `${BASE}chara/p${player + 1}.png`,
  square: (type: SquareType) => `${BASE}square/${type}.png`,
  squareBase: `${BASE}square/base.png`,
  card: (cardId: string) => `${BASE}card/${cardId}.png`,
  attr: (attr: Attribute) => `${BASE}attr/${attr}.png`,
  dice: (n: number) => `${BASE}ui/dice_${n}.png`,
  trapFire: `${BASE}icon/trap_fire.png`,
  statusRest: `${BASE}icon/status_rest.png`,
  statusFrost: `${BASE}icon/status_frost.png`,
  cardBack: `${BASE}ui/card_back.png`,
  forestTile: `${BASE}bg/forest_tile.png`,
};

/** 画像の要素。読み込めなければ代わりの文字（絵文字）にする */
export function img(src: string, fallback: string, cls = ''): HTMLElement {
  const image = document.createElement('img');
  image.src = src;
  image.alt = '';
  image.draggable = false;
  image.className = `pic ${cls}`;
  image.addEventListener('error', () => {
    const span = document.createElement('span');
    span.className = `pic-fallback ${cls}`;
    span.textContent = fallback;
    image.replaceWith(span);
  });
  return image;
}
