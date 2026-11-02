// CPUの思考（強さ: 普通）。合法手の中から簡単な判断で1つ選ぶ。

import { boardInfo } from '../core/board';
import { getCardDef } from '../core/cards';
import { currentNode, distanceToGoal, getLegalActions, isAtGate } from '../core/engine';
import type { Action, CardInstance, GameState } from '../core/types';

type PlayCard = Extract<Action, { type: 'playCard' }>;

export function chooseCpuAction(s: GameState, player: number): Action {
  const legal = getLegalActions(s, player);
  if (legal.length === 0) throw new Error(`プレイヤー${player}は今操作できません`);
  const p = s.players[player];
  const plays = legal.filter((a): a is PlayCard => a.type === 'playCard');
  const cardOf = (a: PlayCard) => p.hand.find((c) => c.uid === a.uid)!.cardId;
  const findPlay = (cardId: string, pred: (a: PlayCard) => boolean = () => true) =>
    plays.find((a) => cardOf(a) === cardId && pred(a));

  const pending = s.pending;
  if (pending?.kind === 'counter') {
    // 入れ替えは反射しても意味がないので光の壁を優先
    const prefer = pending.effect.kind === 'swap' ? ['hikari_no_kabe', 'hansha_no_kagami'] : ['hansha_no_kagami', 'hikari_no_kabe'];
    for (const id of prefer) {
      const c = legal.find((a) => a.type === 'counter' && p.hand.find((h) => h.uid === a.uid)?.cardId === id);
      if (c) return c;
    }
    return { type: 'noCounter', player };
  }
  if (pending?.kind === 'exchange') {
    const worst = [...p.hand].sort((a, b) => cardValue(a) - cardValue(b))[0];
    const best = [...pending.offer].sort((a, b) => cardValue(b) - cardValue(a))[0];
    if (cardValue(best) > cardValue(worst)) {
      return { type: 'exchange', player, offerUid: best.uid, handUid: worst.uid };
    }
    return { type: 'declineExchange', player };
  }
  if (pending?.kind === 'discard') {
    const uids = [...p.hand]
      .sort((a, b) => cardValue(a) - cardValue(b))
      .slice(0, pending.count)
      .map((c) => c.uid);
    return { type: 'discard', player, uids };
  }

  const myDist = distanceToGoal(s, p);
  const opponents = s.players.filter((o) => o.index !== player);
  const leader = [...opponents].sort((a, b) => distanceToGoal(s, a) - distanceToGoal(s, b))[0];
  const leaderDist = distanceToGoal(s, leader);
  const leaderThreat = leaderDist < myDist || leaderDist <= 8;
  const onLeader = (a: PlayCard) => a.target === leader.index;

  const pickAttack = (): Action | undefined => {
    if (!leaderThreat) return undefined;
    if (isAtGate(s, leader)) {
      const frost = findPlay('shimo_no_noroi', onLeader);
      if (frost && !leader.statuses.frost) return frost;
    }
    const swap = plays.find((a) => cardOf(a) === 'tsumujikaze');
    if (swap && myDist - distanceToGoal(s, s.players[swap.target!]) >= 4) return swap;
    if (!leader.statuses.rest) {
      const rest = findPlay('hyouketsu', onLeader);
      if (rest) return rest;
    }
    return (
      findPlay('kaen', onLeader) ??
      findPlay('honoo_no_tsubute', onLeader) ??
      (leader.hand.length >= 2 ? findPlay('nusumi_no_kage', onLeader) : undefined)
    );
  };

  switch (s.phase) {
    case 'turnStart': {
      const attack = pickAttack();
      if (attack) return attack;
      if (!isAtGate(s, p) && myDist > 6) {
        const move = findPlay('shippu') ?? findPlay('oikaze');
        if (move) return move;
      }
      return { type: 'roll', player };
    }

    case 'afterRoll': {
      const value = s.turn.value!;
      if (isAtGate(s, p)) return chooseAtGate(s, player, value, plays, cardOf);
      // ちょうどゴールに届くなら星読み、カードマスに止まれるなら運命の針
      const reach = (v: number) => landing(s, player, v + s.turn.moveBonus);
      if (reach(value) !== 'goal') {
        const star = plays.find((a) => cardOf(a) === 'hoshiyomi' && reach(a.choice!) === 'goal');
        if (star) return star;
        const needle = plays.find(
          (a) =>
            cardOf(a) === 'unmei_no_hari' &&
            (reach(value + a.choice!) === 'goal' || isGoodSquare(s, reach(value + a.choice!))) &&
            !isGoodSquare(s, reach(value)),
        );
        if (needle) return needle;
      }
      return { type: 'confirmMove', player };
    }

    case 'turnEnd': {
      const attack = pickAttack();
      if (attack) return attack;
      const trap = findPlay('honoo_no_mahoujin');
      if (trap && opponents.some((o) => distanceToGoal(s, o) - myDist >= 1 && distanceToGoal(s, o) - myDist <= 8)) {
        return trap;
      }
      if (p.hand.length <= 3) {
        const bless = findPlay('shukufuku');
        if (bless) return bless;
      }
      return { type: 'endTurn', player };
    }
  }
  return legal[0];
}

function chooseAtGate(
  s: GameState,
  player: number,
  value: number,
  plays: PlayCard[],
  cardOf: (a: PlayCard) => string,
): Action {
  const info = boardInfo(s.board);
  const gate = info.nodes.get(currentNode(s.players[player]))!;
  const pass = gate.gate!.pass;
  // 出目ごとの「抜けた後の残り距離」。抜けられない目は Infinity
  const after = (v: number) => {
    const clamped = Math.min(6, Math.max(1, v));
    if (!s.turn.gateBroken && !pass.includes(clamped)) return Infinity;
    const edge = gate.next.find((e) => e.dice?.includes(clamped)) ?? gate.next[0];
    return info.distToGoal.get(edge.to)!;
  };
  const best = Math.min(...[1, 2, 3, 4, 5, 6].map(after));
  const now = after(value);
  if (now === best) return { type: 'confirmMove', player };

  const star = plays.find((a) => cardOf(a) === 'hoshiyomi' && after(a.choice!) === best);
  const needle = plays
    .filter((a) => cardOf(a) === 'unmei_no_hari' && after(value + a.choice!) < now)
    .sort((a, b) => after(value + a.choice!) - after(value + b.choice!))[0];
  if (needle) return needle;
  if (now === Infinity) {
    if (star) return star;
    const reroll = plays.find((a) => cardOf(a) === 'makimodoshi');
    if (reroll) return reroll;
  }
  return { type: 'confirmMove', player };
}

/** 罠や関所を考えずに、steps マス進んだ先のマス */
function landing(s: GameState, player: number, steps: number): string {
  const info = boardInfo(s.board);
  let id = currentNode(s.players[player]);
  for (let i = 0; i < steps; i++) {
    const node = info.nodes.get(id)!;
    if (node.next.length === 0) break;
    id = node.next[0].to;
    const type = info.nodes.get(id)!.type;
    if (type === 'goal') return 'goal';
    if (type === 'gate') break;
  }
  return id;
}

function isGoodSquare(s: GameState, id: string): boolean {
  if (id === 'goal') return true;
  const node = boardInfo(s.board).nodes.get(id);
  return !!node && (node.type === 'card' || node.type === 'exchange') && !s.traps[id];
}

function cardValue(c: CardInstance): number {
  const def = getCardDef(c.cardId);
  // カウンターは手元に残しておきたいので少し高めに評価する
  return def.rarity + (def.timings.includes('counter') ? 0.5 : 0);
}
