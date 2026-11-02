import cardsJson from '../data/cards.json';
import type { AttackEffect, CardDef } from './types';

export const CARD_DEFS = cardsJson as CardDef[];

const byId = new Map(CARD_DEFS.map((c) => [c.id, c]));

export function getCardDef(id: string): CardDef {
  const def = byId.get(id);
  if (!def) throw new Error(`未定義のカード: ${id}`);
  return def;
}

/** ルールエンジンが効果を実装済みのカード */
export const IMPLEMENTED_CARD_IDS = new Set([
  'oikaze',
  'shippu',
  'tsumujikaze',
  'unmei_no_hari',
  'makimodoshi',
  'hoshiyomi',
  'honoo_no_tsubute',
  'kaen',
  'honoo_no_mahoujin',
  'shimo_no_noroi',
  'hyouketsu',
  'hikari_no_kabe',
  'hansha_no_kagami',
  'shukufuku',
  'nusumi_no_kage',
]);

/** 相手1人を対象にする攻撃カードの効果 */
export const TARGET_ATTACKS: Record<string, AttackEffect> = {
  honoo_no_tsubute: { kind: 'back', steps: 2 },
  kaen: { kind: 'back', steps: 4 },
  shimo_no_noroi: { kind: 'frost' },
  hyouketsu: { kind: 'rest' },
  nusumi_no_kage: { kind: 'steal' },
};

export const TRAP_BACK_STEPS = 3;

/** レア度ごとの山札への枚数（cards.md 4.1） */
const COPIES_BY_RARITY = { 1: 3, 2: 2, 3: 1 } as const;

/** マルチプレイ用の共通の山札（カードidの一覧） */
export function buildSharedDeck(cardIds: string[]): string[] {
  return cardIds.flatMap((id) => Array(COPIES_BY_RARITY[getCardDef(id).rarity]).fill(id));
}

export const MVP_CARD_IDS = CARD_DEFS.filter((c) => c.mvp).map((c) => c.id);
