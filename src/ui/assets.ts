// 画像素材の場所。素材は public/assets/ に置く（一覧は docs/assets.md）。
// 無い素材は読み込みに失敗するので、そのときは今までの絵文字・色で表示する。

import type { Attribute, SquareType } from '../core/types';

const BASE = `${import.meta.env.BASE_URL}assets/`;

export const ASSET = {
  /** キャラクター（0〜3）の全身の絵 */
  chara: (chara: number) => `${BASE}chara/p${chara + 1}.png`,
  /** バストアップ。表情があれば p1_brave.png、ふつうの顔は p1.png */
  bust: (chara: number, expr: string) => `${BASE}chara/bust/p${chara + 1}${expr === 'normal' ? '' : `_${expr}`}.png`,
  square: (type: SquareType) => `${BASE}square/${type}.png`,
  squareBase: `${BASE}square/base.png`,
  /** ボード専用のマスの土台（無ければ square/base.png の切り株を使う） */
  squareBaseOf: (boardId: string) => `${BASE}square/base_${boardId}.png`,
  card: (cardId: string) => `${BASE}card/${cardId}.png`,
  attr: (attr: Attribute) => `${BASE}attr/${attr}.png`,
  dice: (n: number) => `${BASE}ui/dice_${n}.png`,
  trapFire: `${BASE}icon/trap_fire.png`,
  trapIce: `${BASE}icon/trap_ice.png`,
  statusRest: `${BASE}icon/status_rest.png`,
  statusFrost: `${BASE}icon/status_frost.png`,
  statusBlizzard: `${BASE}icon/status_blizzard.png`,
  statusSeal: `${BASE}icon/status_seal.png`,
  statusGuard: `${BASE}icon/status_guard.png`,
  cardBack: `${BASE}ui/card_back.png`,
  /** ボードの背景（つなぎ目なしの絵）。ボードの id ごと */
  boardTile: (boardId: string) => `${BASE}bg/${boardId}_tile.png`,
};

/** 読み込めなかった画像。同じ画像を何度も取りに行かないように覚えておく */
const missing = new Set<string>();

/**
 * 候補の画像を順に試し、最初に読み込めたものを表示する。どれも無ければ代わりの文字にする。
 * 候補ごとに class を変えられる（全身の絵を切り抜いて使う、など）。
 */
export function imgChain(candidates: { src: string; cls: string }[], fallback: string, fallbackCls: string): HTMLElement {
  const list = candidates.filter((c) => !missing.has(c.src));
  const image = document.createElement('img');
  image.alt = '';
  image.draggable = false;
  let i = 0;
  const load = () => {
    image.className = `pic ${list[i].cls}`;
    image.src = list[i].src;
  };
  image.addEventListener('error', () => {
    if (i < list.length) missing.add(list[i++].src);
    if (i < list.length) return load();
    const span = document.createElement('span');
    span.className = `pic-fallback ${fallbackCls}`;
    span.textContent = fallback;
    image.replaceWith(span);
  });
  if (list.length > 0) load();
  else queueMicrotask(() => image.dispatchEvent(new Event('error')));
  return image;
}

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
