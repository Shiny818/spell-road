// ゲームのルールで使う型。描画・通信には依存しない。

// ---- カード ----

export type Attribute = 'wind' | 'time' | 'fire' | 'ice' | 'light' | 'dark';

/** カードを使えるタイミング（cards.md 1.1） */
export type Timing = 'start' | 'afterRoll' | 'end' | 'counter';

export interface CardDef {
  id: string;
  name: string;
  attribute: Attribute;
  rarity: 1 | 2 | 3;
  timings: Timing[];
  usableAtGate: boolean;
  attack: boolean;
  mvp: boolean;
  text: string;
}

export interface CardInstance {
  uid: number;
  cardId: string;
}

// ---- ボード ----

export type SquareType = 'start' | 'empty' | 'card' | 'exchange' | 'gate' | 'coin' | 'goal';

export interface Edge {
  to: string;
  /** 分岐の起点（関所）で、このルートに進む出目 */
  dice?: number[];
}

export interface BoardNode {
  id: string;
  type: SquareType;
  next: Edge[];
  /** 関所の通過条件 */
  gate?: { pass: number[] };
}

export interface BoardDef {
  id: string;
  name: string;
  nodes: BoardNode[];
}

// ---- 状態 ----

export interface Statuses {
  /** 次の自分のターンを飛ばす */
  rest: boolean;
  /** 次の出目 -2 */
  frost: boolean;
}

export interface PlayerState {
  index: number;
  name: string;
  isCpu: boolean;
  /** 通ってきたマスの履歴。最後が現在地。戻る効果はこれをさかのぼる */
  trail: string[];
  hand: CardInstance[];
  statuses: Statuses;
  /** 関所ごとの封印のひびの本数 */
  gateCracks: Record<string, number>;
  coins: number;
}

export interface Trap {
  owner: number;
  kind: 'fire';
}

export type AttackEffect =
  | { kind: 'back'; steps: number }
  | { kind: 'frost' }
  | { kind: 'rest' }
  | { kind: 'steal' }
  | { kind: 'swap' }
  | { kind: 'trap'; steps: number };

export type Pending =
  | {
      kind: 'counter';
      target: number;
      attacker: number;
      cardId: string;
      effect: AttackEffect;
      source: 'card' | 'trap';
    }
  | { kind: 'exchange'; player: number; offer: CardInstance[] }
  | { kind: 'discard'; player: number; count: number };

export type Phase = 'turnStart' | 'afterRoll' | 'moving' | 'turnEnd' | 'gameOver';

export interface TurnState {
  cardUsed: boolean;
  dice: number[];
  value: number | null;
  frostPenalty: number;
  twoDice: boolean;
  moveBonus: number;
  /** 封印のひびが上限に達し、このターンは条件なしで関所を抜けられる */
  gateBroken: boolean;
}

export interface GameResult {
  winner: number;
  /** プレイヤーごとの順位（同じ残りマス数なら同順位） */
  ranks: number[];
}

export type GameEvent =
  | { type: 'turnStart'; player: number; round: number }
  | { type: 'skipTurn'; player: number }
  | { type: 'roll'; player: number; dice: number[]; value: number }
  | { type: 'cardPlayed'; player: number; cardId: string; target?: number; choice?: number }
  | { type: 'valueChanged'; player: number; value: number }
  | { type: 'step'; player: number; to: string }
  | { type: 'pushedBack'; player: number; to: string; steps: number }
  | { type: 'gateStop'; player: number; gate: string }
  | { type: 'gateFail'; player: number; gate: string; cracks: number }
  | { type: 'gateBroken'; player: number; gate: string }
  | { type: 'gatePass'; player: number; gate: string; to: string }
  | { type: 'trapPlaced'; player: number; node: string }
  | { type: 'trapTriggered'; player: number; node: string; owner: number }
  | { type: 'countered'; player: number; cardId: string; attacker: number; reflected: boolean }
  | { type: 'statusApplied'; player: number; status: keyof Statuses }
  | { type: 'swapped'; a: number; b: number }
  | { type: 'stolen'; from: number; to: number }
  | { type: 'draw'; player: number; count: number }
  | { type: 'exchanged'; player: number; swapped: boolean }
  | { type: 'coin'; player: number; amount: number }
  | { type: 'discarded'; player: number; count: number }
  | { type: 'gameOver'; result: GameResult };

export interface GameState {
  board: BoardDef;
  players: PlayerState[];
  current: number;
  round: number;
  turnCount: number;
  phase: Phase;
  pending: Pending | null;
  turn: TurnState;
  moving: { remaining: number; forcedNext: string | null } | null;
  /** 山札。配列の末尾が一番上 */
  deck: CardInstance[];
  discard: CardInstance[];
  traps: Record<string, Trap>;
  rngState: number;
  nextUid: number;
  /** テスト・デバッグ用: 指定するとダイスの目をこの順に使う */
  forcedDice: number[];
  settings: { handLimit: number; coinsEnabled: boolean };
  result: GameResult | null;
  log: GameEvent[];
}

// ---- 操作 ----

export type Action =
  | { type: 'roll'; player: number }
  | { type: 'confirmMove'; player: number }
  | { type: 'endTurn'; player: number }
  | { type: 'playCard'; player: number; uid: number; target?: number; choice?: number }
  | { type: 'counter'; player: number; uid: number }
  | { type: 'noCounter'; player: number }
  | { type: 'exchange'; player: number; offerUid: number; handUid: number }
  | { type: 'declineExchange'; player: number }
  | { type: 'discard'; player: number; uids: number[] };
