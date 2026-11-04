import cardsJson from '../data/cards.json';
import type { AttackEffect, CardDef, TrapKind } from './types';

export const CARD_DEFS = cardsJson as CardDef[];

const byId = new Map(CARD_DEFS.map((c) => [c.id, c]));

export function getCardDef(id: string): CardDef {
  const def = byId.get(id);
  if (!def) throw new Error(`未定義のカード: ${id}`);
  return def;
}

/** 相手1人を対象にする攻撃カードの効果（つむじ風・闇の取引は別に扱う） */
export const TARGET_ATTACKS: Record<string, AttackEffect> = {
  honoo_no_tsubute: { kind: 'back', steps: 2 },
  kaen: { kind: 'back', steps: 4 },
  shimo_no_noroi: { kind: 'frost' },
  hyouketsu: { kind: 'rest' },
  nusumi_no_kage: { kind: 'steal' },
  boukyaku: { kind: 'forget' },
  noroi_no_fuin: { kind: 'seal' },
};

/** 自分以外の全員を対象にする攻撃カードの効果 */
export const ALL_ATTACKS: Record<string, AttackEffect> = {
  bakuen: { kind: 'back', steps: 3 },
  fubuki: { kind: 'blizzard' },
};

/** 罠を置くカード */
export const TRAP_CARDS: Record<string, TrapKind> = {
  honoo_no_mahoujin: 'fire',
  itetsuku_yuka: 'ice',
};

/** 罠の種類から、その罠を置くカード */
export const TRAP_CARD_OF: Record<TrapKind, string> = {
  fire: 'honoo_no_mahoujin',
  ice: 'itetsuku_yuka',
};

export const TRAP_BACK_STEPS = 3;

/** レア度ごとの山札への枚数（cards.md 4.1） */
const COPIES_BY_RARITY = { 1: 3, 2: 2, 3: 1 } as const;

/** マルチプレイ用の共通の山札（カードidの一覧） */
export function buildSharedDeck(cardIds: string[]): string[] {
  return cardIds.flatMap((id) => Array(COPIES_BY_RARITY[getCardDef(id).rarity]).fill(id));
}

export const MVP_CARD_IDS = CARD_DEFS.filter((c) => c.mvp).map((c) => c.id);

/** 全27種類（マルチプレイの山札はこれを使う） */
export const ALL_CARD_IDS = CARD_DEFS.map((c) => c.id);
