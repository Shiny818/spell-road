// ゲームのルールエンジン。
// 状態は「操作（Action）を順番に適用して変わる」形にしている。
// applyAction は元の状態を変更せず、新しい状態を返す。

import { boardInfo, validateBoard } from './board';
import { getCardDef, IMPLEMENTED_CARD_IDS, TARGET_ATTACKS, TRAP_BACK_STEPS } from './cards';
import { nextRandom } from './rng';
import type {
  Action,
  AttackEffect,
  BoardDef,
  CardInstance,
  GameEvent,
  GameState,
  Pending,
  PlayerState,
  Timing,
  TurnState,
} from './types';

export const GATE_CRACK_LIMIT = 3;
export const COUNTER_CARD_IDS = ['hikari_no_kabe', 'hansha_no_kagami'];

export class RuleError extends Error {}

export interface PlayerConfig {
  name: string;
  isCpu: boolean;
}

export interface GameConfig {
  board: BoardDef;
  players: PlayerConfig[];
  /** 山札に入れるカードidの一覧 */
  deck: string[];
  seed: number;
  handLimit?: number;
  initialHand?: number;
  coinsEnabled?: boolean;
}

// ============================================================
// 生成
// ============================================================

export function createGame(config: GameConfig): GameState {
  const errors = validateBoard(config.board);
  if (errors.length > 0) throw new Error(`ボードのデータに問題があります:\n${errors.join('\n')}`);
  if (config.players.length < 2 || config.players.length > 4) {
    throw new Error('プレイヤーは2〜4人です');
  }
  const info = boardInfo(config.board);
  // コインはマルチプレイでは使わないので、コインマスは「何もなし」のマスにして見せない
  const board: BoardDef = config.coinsEnabled
    ? config.board
    : { ...config.board, nodes: config.board.nodes.map((n) => (n.type === 'coin' ? { ...n, type: 'empty' } : n)) };

  const s: GameState = {
    board,
    players: config.players.map((p, index) => ({
      index,
      name: p.name,
      isCpu: p.isCpu,
      trail: [info.startId],
      hand: [],
      statuses: { rest: false, frost: false },
      gateCracks: {},
      coins: 0,
    })),
    current: 0,
    round: 1,
    turnCount: 1,
    phase: 'turnStart',
    pending: null,
    turn: newTurn(),
    moving: null,
    deck: [],
    discard: [],
    traps: {},
    rngState: config.seed >>> 0,
    nextUid: 1,
    forcedDice: [],
    settings: {
      handLimit: config.handLimit ?? 5,
      coinsEnabled: config.coinsEnabled ?? false,
    },
    result: null,
    log: [],
  };

  s.deck = config.deck.map((cardId) => ({ uid: s.nextUid++, cardId }));
  shuffle(s, s.deck);
  for (const p of s.players) draw(s, p, config.initialHand ?? 2);
  log(s, { type: 'turnStart', player: 0, round: 1 });
  return s;
}

function newTurn(): TurnState {
  return {
    cardUsed: false,
    dice: [],
    value: null,
    frostPenalty: 0,
    twoDice: false,
    moveBonus: 0,
    gateBroken: false,
  };
}

// ============================================================
// 参照用の関数（UI・CPUからも使う）
// ============================================================

export function currentNode(p: PlayerState): string {
  return p.trail[p.trail.length - 1];
}

export function distanceToGoal(s: GameState, p: PlayerState): number {
  return boardInfo(s.board).distToGoal.get(currentNode(p))!;
}

/** 関所で止まっている（まだ通過していない）か */
export function isAtGate(s: GameState, p: PlayerState): boolean {
  return boardInfo(s.board).nodes.get(currentNode(p))!.type === 'gate';
}

/** 通過済みの関所 */
export function passedGates(s: GameState, p: PlayerState): Set<string> {
  const nodes = boardInfo(s.board).nodes;
  return new Set(p.trail.slice(0, -1).filter((id) => nodes.get(id)!.type === 'gate'));
}

/** 次に操作するプレイヤー（ゲーム終了時は null） */
export function expectedActor(s: GameState): number | null {
  if (s.phase === 'gameOver') return null;
  if (s.pending) return s.pending.kind === 'counter' ? s.pending.target : s.pending.player;
  return s.current;
}

/** つむじ風で入れ替えられる相手 */
export function swapTargets(s: GameState, player: number): number[] {
  const me = s.players[player];
  const myDist = distanceToGoal(s, me);
  const ahead = s.players.filter((o) => o.index !== player && distanceToGoal(s, o) < myDist);
  if (ahead.length === 0) return [];
  const nearest = Math.max(...ahead.map((o) => distanceToGoal(s, o)));
  const myGates = passedGates(s, me);
  return ahead
    .filter((o) => distanceToGoal(s, o) === nearest)
    // 入れ替えると相手がチェックポイントより前に戻る場合は使えない
    .filter((o) => [...passedGates(s, o)].every((g) => myGates.has(g)))
    .map((o) => o.index);
}

/** 罠を置けるマスか */
export function canPlaceTrap(s: GameState, nodeId: string): boolean {
  const type = boardInfo(s.board).nodes.get(nodeId)!.type;
  return !['start', 'gate', 'goal'].includes(type) && !s.traps[nodeId];
}

function hasCounter(p: PlayerState, source: 'card' | 'trap'): boolean {
  return p.hand.some((c) =>
    source === 'trap' ? c.cardId === 'hikari_no_kabe' : COUNTER_CARD_IDS.includes(c.cardId),
  );
}

// ============================================================
// 合法手
// ============================================================

export function getLegalActions(s: GameState, player: number): Action[] {
  if (expectedActor(s) !== player) return [];
  const p = s.players[player];

  if (s.pending) {
    const pd = s.pending;
    switch (pd.kind) {
      case 'counter': {
        const counters = p.hand.filter((c) =>
          pd.source === 'trap' ? c.cardId === 'hikari_no_kabe' : COUNTER_CARD_IDS.includes(c.cardId),
        );
        return [
          ...counters.map((c): Action => ({ type: 'counter', player, uid: c.uid })),
          { type: 'noCounter', player },
        ];
      }
      case 'exchange': {
        const actions: Action[] = [{ type: 'declineExchange', player }];
        for (const o of pd.offer) {
          for (const h of p.hand) actions.push({ type: 'exchange', player, offerUid: o.uid, handUid: h.uid });
        }
        return actions;
      }
      case 'discard':
        return combinations(
          p.hand.map((c) => c.uid),
          pd.count,
        ).map((uids): Action => ({ type: 'discard', player, uids }));
    }
  }

  switch (s.phase) {
    case 'turnStart':
      return [{ type: 'roll', player }, ...cardPlays(s, 'start')];
    case 'afterRoll':
      return [{ type: 'confirmMove', player }, ...cardPlays(s, 'afterRoll')];
    case 'turnEnd':
      return [{ type: 'endTurn', player }, ...cardPlays(s, 'end')];
    default:
      return [];
  }
}

function cardPlays(s: GameState, timing: Timing): Action[] {
  if (s.turn.cardUsed) return [];
  const player = s.current;
  const p = s.players[player];
  const atGate = isAtGate(s, p);
  const opponents = s.players.filter((o) => o.index !== player).map((o) => o.index);
  const actions: Action[] = [];

  for (const c of p.hand) {
    const def = getCardDef(c.cardId);
    if (!IMPLEMENTED_CARD_IDS.has(c.cardId)) continue;
    if (!def.timings.includes(timing)) continue;
    if (atGate && !def.usableAtGate) continue;
    const base = { type: 'playCard', player, uid: c.uid } as const;

    switch (c.cardId) {
      case 'tsumujikaze':
        for (const t of swapTargets(s, player)) actions.push({ ...base, target: t });
        break;
      case 'honoo_no_mahoujin':
        if (canPlaceTrap(s, currentNode(p))) actions.push(base);
        break;
      case 'unmei_no_hari':
        actions.push({ ...base, choice: 1 });
        if (s.turn.value! > 1) actions.push({ ...base, choice: -1 });
        break;
      case 'hoshiyomi':
        for (let v = 1; v <= 6; v++) actions.push({ ...base, choice: v });
        break;
      default:
        if (TARGET_ATTACKS[c.cardId]) {
          for (const t of opponents) actions.push({ ...base, target: t });
        } else {
          actions.push(base);
        }
    }
  }
  return actions;
}

function combinations<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [first, ...rest] = items;
  return [...combinations(rest, k - 1).map((c) => [first, ...c]), ...combinations(rest, k)];
}

/** 操作を比較するための文字列 */
export function actionKey(a: Action): string {
  const r = a as Partial<Record<string, unknown>>;
  const uids = a.type === 'discard' ? [...a.uids].sort((x, y) => x - y).join(',') : '';
  return [a.type, a.player, r.uid, r.target, r.choice, r.offerUid, r.handUid, uids]
    .map((v) => (v === undefined ? '' : String(v)))
    .join('|');
}

// ============================================================
// 操作の適用
// ============================================================

export function applyAction(prev: GameState, action: Action): GameState {
  const key = actionKey(action);
  if (!getLegalActions(prev, action.player).some((a) => actionKey(a) === key)) {
    throw new RuleError(`この操作は今できません: ${key}`);
  }
  const s = structuredClone(prev);

  switch (action.type) {
    case 'roll':
      doRoll(s);
      break;
    case 'playCard':
      doPlayCard(s, action.player, action.uid, action.target, action.choice);
      break;
    case 'confirmMove':
      doConfirmMove(s);
      break;
    case 'endTurn':
      doEndTurn(s);
      break;
    case 'counter':
    case 'noCounter':
      doCounter(s, action.type === 'counter' ? action.uid : null);
      break;
    case 'exchange':
    case 'declineExchange':
      doExchange(s, action.type === 'exchange' ? action : null);
      break;
    case 'discard':
      doDiscard(s, action.player, action.uids);
      break;
  }
  return s;
}

// ---- ダイス ----

function doRoll(s: GameState): void {
  const p = s.players[s.current];
  const dice = Array.from({ length: s.turn.twoDice ? 2 : 1 }, () => rollDie(s));
  s.turn.frostPenalty = p.statuses.frost ? 2 : 0;
  p.statuses.frost = false;
  setDice(s, dice);
  log(s, { type: 'roll', player: p.index, dice, value: s.turn.value! });
  s.phase = 'afterRoll';
}

function setDice(s: GameState, dice: number[]): void {
  s.turn.dice = dice;
  s.turn.value = Math.max(1, sum(dice) - s.turn.frostPenalty);
}

// ---- カード ----

function doPlayCard(s: GameState, player: number, uid: number, target?: number, choice?: number): void {
  const p = s.players[player];
  const card = takeFromHand(p, uid);
  s.discard.push(card);
  s.turn.cardUsed = true;
  log(s, { type: 'cardPlayed', player, cardId: card.cardId, target, choice });

  switch (card.cardId) {
    case 'oikaze':
      s.turn.moveBonus += 2;
      break;
    case 'shippu':
      s.turn.twoDice = true;
      break;
    case 'shukufuku':
      draw(s, p, 2);
      break;
    case 'honoo_no_mahoujin': {
      const node = currentNode(p);
      s.traps[node] = { owner: player, kind: 'fire' };
      log(s, { type: 'trapPlaced', player, node });
      break;
    }
    case 'unmei_no_hari':
      changeValue(s, Math.max(1, s.turn.value! + choice!));
      break;
    case 'makimodoshi':
      setDice(s, s.turn.dice.map(() => rollDie(s)));
      log(s, { type: 'roll', player, dice: s.turn.dice, value: s.turn.value! });
      break;
    case 'hoshiyomi':
      changeValue(s, choice!);
      break;
    case 'tsumujikaze':
      startAttack(s, player, target!, card.cardId, { kind: 'swap' }, 'card');
      break;
    default:
      startAttack(s, player, target!, card.cardId, TARGET_ATTACKS[card.cardId], 'card');
  }
}

function changeValue(s: GameState, value: number): void {
  s.turn.value = value;
  log(s, { type: 'valueChanged', player: s.current, value });
}

// ---- 攻撃とカウンター ----

function startAttack(
  s: GameState,
  attacker: number,
  target: number,
  cardId: string,
  effect: AttackEffect,
  source: 'card' | 'trap',
): void {
  if (hasCounter(s.players[target], source)) {
    s.pending = { kind: 'counter', target, attacker, cardId, effect, source };
    return;
  }
  attackHits(s, { kind: 'counter', target, attacker, cardId, effect, source });
}

function doCounter(s: GameState, uid: number | null): void {
  const pd = s.pending as Extract<Pending, { kind: 'counter' }>;
  s.pending = null;
  if (uid === null) {
    attackHits(s, pd);
    return;
  }

  const t = s.players[pd.target];
  const card = takeFromHand(t, uid);
  s.discard.push(card);
  const reflected = card.cardId === 'hansha_no_kagami';
  log(s, { type: 'countered', player: pd.target, cardId: card.cardId, attacker: pd.attacker, reflected });
  // はね返した攻撃に、さらにカウンターはできない。入れ替えははね返しても同じ結果なので無効化と同じ扱い
  if (reflected && pd.effect.kind !== 'swap') applyEffect(s, pd.attacker, pd.effect, pd.target);

  if (pd.source === 'trap') continueMove(s);
}

function attackHits(s: GameState, pd: Extract<Pending, { kind: 'counter' }>): void {
  if (pd.source === 'trap') {
    applyEffect(s, pd.target, pd.effect, pd.attacker);
    s.moving = null;
    enterTurnEnd(s);
    return;
  }
  applyEffect(s, pd.target, pd.effect, pd.attacker);
}

function applyEffect(s: GameState, targetIndex: number, effect: AttackEffect, byIndex: number): void {
  const t = s.players[targetIndex];
  const by = s.players[byIndex];
  switch (effect.kind) {
    case 'back':
    case 'trap':
      moveBack(s, t, effect.steps);
      break;
    case 'frost':
      t.statuses.frost = true;
      log(s, { type: 'statusApplied', player: targetIndex, status: 'frost' });
      break;
    case 'rest':
      t.statuses.rest = true;
      log(s, { type: 'statusApplied', player: targetIndex, status: 'rest' });
      break;
    case 'steal':
      if (t.hand.length > 0) {
        const [card] = t.hand.splice(Math.floor(random(s) * t.hand.length), 1);
        by.hand.push(card);
        log(s, { type: 'stolen', from: targetIndex, to: byIndex });
      }
      break;
    case 'swap':
      [t.trail, by.trail] = [by.trail, t.trail];
      log(s, { type: 'swapped', a: byIndex, b: targetIndex });
      break;
  }
}

/** 戻る。通過済みの関所の1つ先より前には戻らない */
function moveBack(s: GameState, p: PlayerState, steps: number): void {
  const nodes = boardInfo(s.board).nodes;
  let minLength = 1;
  for (let i = p.trail.length - 2; i >= 0; i--) {
    if (nodes.get(p.trail[i])!.type === 'gate') {
      minLength = i + 2;
      break;
    }
  }
  const newLength = Math.max(minLength, p.trail.length - steps);
  const moved = p.trail.length - newLength;
  if (moved <= 0) return;
  p.trail = p.trail.slice(0, newLength);
  log(s, { type: 'pushedBack', player: p.index, to: currentNode(p), steps: moved });
}

// ---- 移動 ----

function doConfirmMove(s: GameState): void {
  const p = s.players[s.current];
  const value = s.turn.value!;
  if (!isAtGate(s, p)) {
    startMove(s, value + s.turn.moveBonus, null);
    return;
  }

  const gateId = currentNode(p);
  const gate = boardInfo(s.board).nodes.get(gateId)!;
  const v = Math.min(6, Math.max(1, value));
  if (s.turn.gateBroken || gate.gate!.pass.includes(v)) {
    // 出目に合う分岐先。なければ最初のルート（封印が砕けたときの通常ルート）
    const edge = gate.next.find((e) => e.dice?.includes(v)) ?? gate.next[0];
    delete p.gateCracks[gateId];
    log(s, { type: 'gatePass', player: p.index, gate: gateId, to: edge.to });
    startMove(s, 1, edge.to);
    return;
  }

  const cracks = (p.gateCracks[gateId] ?? 0) + 1;
  p.gateCracks[gateId] = cracks;
  log(s, { type: 'gateFail', player: p.index, gate: gateId, cracks });
  enterTurnEnd(s);
}

function startMove(s: GameState, steps: number, forcedNext: string | null): void {
  s.phase = 'moving';
  s.moving = { remaining: steps, forcedNext };
  continueMove(s);
}

function continueMove(s: GameState): void {
  const info = boardInfo(s.board);
  const p = s.players[s.current];

  while (s.moving && s.moving.remaining > 0) {
    const here = info.nodes.get(currentNode(p))!;
    let nextId: string;
    if (s.moving.forcedNext) {
      nextId = s.moving.forcedNext;
      s.moving.forcedNext = null;
    } else {
      if (here.next.length === 0) break;
      nextId = here.next[0].to;
    }
    p.trail.push(nextId);
    s.moving.remaining--;
    log(s, { type: 'step', player: p.index, to: nextId });

    const node = info.nodes.get(nextId)!;
    if (node.type === 'goal') {
      finishGame(s, p.index);
      return;
    }
    if (node.type === 'gate') {
      log(s, { type: 'gateStop', player: p.index, gate: nextId });
      s.moving.remaining = 0;
      break;
    }
    const trap = s.traps[nextId];
    if (trap) {
      delete s.traps[nextId];
      log(s, { type: 'trapTriggered', player: p.index, node: nextId, owner: trap.owner });
      startAttack(s, trap.owner, p.index, 'honoo_no_mahoujin', { kind: 'trap', steps: TRAP_BACK_STEPS }, 'trap');
      // カウンターの確認待ち、または罠で戻されて移動終了
      if (s.pending || !s.moving) return;
    }
  }

  s.moving = null;
  landOn(s, p);
}

/** 止まったマスの効果 */
function landOn(s: GameState, p: PlayerState): void {
  const node = boardInfo(s.board).nodes.get(currentNode(p))!;
  switch (node.type) {
    case 'card':
      draw(s, p, 1);
      break;
    case 'exchange':
      if (p.hand.length > 0) {
        const offer: CardInstance[] = [];
        for (let i = 0; i < 3; i++) {
          const c = takeFromDeck(s);
          if (c) offer.push(c);
        }
        if (offer.length > 0) {
          s.phase = 'turnEnd';
          s.pending = { kind: 'exchange', player: p.index, offer };
          return;
        }
      }
      break;
    case 'coin':
      if (s.settings.coinsEnabled) {
        const amount = 1 + Math.floor(random(s) * 3);
        p.coins += amount;
        log(s, { type: 'coin', player: p.index, amount });
      }
      break;
  }
  enterTurnEnd(s);
}

function doExchange(s: GameState, action: Extract<Action, { type: 'exchange' }> | null): void {
  const pd = s.pending as Extract<Pending, { kind: 'exchange' }>;
  s.pending = null;
  const p = s.players[pd.player];
  let rest = pd.offer;
  if (action) {
    s.discard.push(takeFromHand(p, action.handUid));
    p.hand.push(pd.offer.find((c) => c.uid === action.offerUid)!);
    rest = pd.offer.filter((c) => c.uid !== action.offerUid);
  }
  // 選ばなかったカードは山札の一番下へ
  s.deck.unshift(...rest);
  log(s, { type: 'exchanged', player: p.index, swapped: action !== null });
  enterTurnEnd(s);
}

// ---- ターンの終わり ----

function enterTurnEnd(s: GameState): void {
  s.phase = 'turnEnd';
}

function doEndTurn(s: GameState): void {
  const p = s.players[s.current];
  const over = p.hand.length - s.settings.handLimit;
  if (over > 0) {
    s.pending = { kind: 'discard', player: p.index, count: over };
    return;
  }
  advanceTurn(s);
}

function doDiscard(s: GameState, player: number, uids: number[]): void {
  s.pending = null;
  const p = s.players[player];
  for (const uid of uids) s.discard.push(takeFromHand(p, uid));
  log(s, { type: 'discarded', player, count: uids.length });
  advanceTurn(s);
}

function advanceTurn(s: GameState): void {
  const n = s.players.length;
  for (;;) {
    s.current = (s.current + 1) % n;
    if (s.current === 0) s.round++;
    s.turnCount++;
    const p = s.players[s.current];
    if (!p.statuses.rest) break;
    p.statuses.rest = false;
    log(s, { type: 'skipTurn', player: p.index });
  }

  const p = s.players[s.current];
  s.turn = newTurn();
  s.phase = 'turnStart';
  log(s, { type: 'turnStart', player: p.index, round: s.round });
  if (isAtGate(s, p) && (p.gateCracks[currentNode(p)] ?? 0) >= GATE_CRACK_LIMIT) {
    s.turn.gateBroken = true;
    log(s, { type: 'gateBroken', player: p.index, gate: currentNode(p) });
  }
}

function finishGame(s: GameState, winner: number): void {
  s.phase = 'gameOver';
  s.pending = null;
  s.moving = null;
  const dists = s.players.map((p) => (p.index === winner ? -1 : distanceToGoal(s, p)));
  // 残りマス数が同じなら同じ順位（例: 2位が2人なら次は4位）
  const ranks = dists.map((d) => 1 + dists.filter((o) => o < d).length);
  s.result = { winner, ranks };
  log(s, { type: 'gameOver', result: s.result });
}

// ============================================================
// 小さな道具
// ============================================================

function log(s: GameState, e: GameEvent): void {
  s.log.push(e);
}

function random(s: GameState): number {
  const [v, next] = nextRandom(s.rngState);
  s.rngState = next;
  return v;
}

function rollDie(s: GameState): number {
  if (s.forcedDice.length > 0) return s.forcedDice.shift()!;
  return 1 + Math.floor(random(s) * 6);
}

function shuffle<T>(s: GameState, arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random(s) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

function takeFromHand(p: PlayerState, uid: number): CardInstance {
  const i = p.hand.findIndex((c) => c.uid === uid);
  return p.hand.splice(i, 1)[0];
}

function takeFromDeck(s: GameState): CardInstance | null {
  if (s.deck.length === 0 && s.discard.length > 0) {
    s.deck = s.discard;
    s.discard = [];
    shuffle(s, s.deck);
  }
  return s.deck.pop() ?? null;
}

function draw(s: GameState, p: PlayerState, count: number): void {
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    const c = takeFromDeck(s);
    if (!c) break;
    p.hand.push(c);
    drawn++;
  }
  if (drawn > 0) log(s, { type: 'draw', player: p.index, count: drawn });
}
