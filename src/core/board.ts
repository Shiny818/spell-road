import type { BoardDef, BoardNode } from './types';

export interface BoardInfo {
  def: BoardDef;
  nodes: Map<string, BoardNode>;
  startId: string;
  goalId: string;
  /** 各マスからゴールまでの最短距離 */
  distToGoal: Map<string, number>;
}

const cache = new Map<string, BoardInfo>();

export function boardInfo(def: BoardDef): BoardInfo {
  const cached = cache.get(def.id);
  if (cached && cached.def.nodes.length === def.nodes.length) return cached;

  const nodes = new Map(def.nodes.map((n) => [n.id, n]));
  const startId = def.nodes.find((n) => n.type === 'start')!.id;
  const goalId = def.nodes.find((n) => n.type === 'goal')!.id;

  // ゴールから逆向きにたどって最短距離を求める
  const reverse = new Map<string, string[]>();
  for (const n of def.nodes) {
    for (const e of n.next) {
      if (!reverse.has(e.to)) reverse.set(e.to, []);
      reverse.get(e.to)!.push(n.id);
    }
  }
  const distToGoal = new Map<string, number>([[goalId, 0]]);
  const queue = [goalId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const prev of reverse.get(id) ?? []) {
      if (!distToGoal.has(prev)) {
        distToGoal.set(prev, distToGoal.get(id)! + 1);
        queue.push(prev);
      }
    }
  }

  const info: BoardInfo = { def, nodes, startId, goalId, distToGoal };
  cache.set(def.id, info);
  return info;
}

/**
 * 関所を出目 v で抜けたときに進む分岐先。
 * 出目に合う分岐先がなければ（封印が砕けて、通過の条件外の目で抜けたとき）、出目がいちばん近い分岐先に進む。
 * 例: 2・3で近道、4・5で遠回りなら、1は近道、6は遠回り
 */
export function branchEdge(gate: BoardNode, v: number): BoardNode['next'][number] {
  const exact = gate.next.find((e) => e.dice?.includes(v));
  if (exact) return exact;
  const gap = (e: BoardNode['next'][number]) => Math.min(...(e.dice ?? [Infinity]).map((d) => Math.abs(d - v)));
  return gate.next.reduce((best, e) => (gap(e) < gap(best) ? e : best), gate.next[0]);
}

/** ボードのデータに問題があればエラーメッセージを返す */
export function validateBoard(def: BoardDef): string[] {
  const errors: string[] = [];
  const ids = new Set(def.nodes.map((n) => n.id));
  if (ids.size !== def.nodes.length) errors.push('マスのidが重複しています');

  const starts = def.nodes.filter((n) => n.type === 'start');
  const goals = def.nodes.filter((n) => n.type === 'goal');
  if (starts.length !== 1) errors.push('スタートマスはちょうど1つ必要です');
  if (goals.length !== 1) errors.push('ゴールマスはちょうど1つ必要です');

  for (const n of def.nodes) {
    for (const e of n.next) {
      if (!ids.has(e.to)) errors.push(`${n.id}: 存在しないマス ${e.to} につながっています`);
    }
    if (n.type === 'goal') {
      if (n.next.length > 0) errors.push(`${n.id}: ゴールから先にはつなげられません`);
      continue;
    }
    if (n.next.length === 0) errors.push(`${n.id}: 次のマスがありません`);
    if (n.type === 'gate') {
      if (!n.gate || n.gate.pass.length === 0) errors.push(`${n.id}: 関所の通過条件がありません`);
      if (n.next.length > 1) {
        const covered = new Set<number>();
        for (const e of n.next) {
          if (!e.dice || e.dice.length === 0) errors.push(`${n.id}: 分岐先 ${e.to} に出目の指定がありません`);
          for (const d of e.dice ?? []) {
            if (covered.has(d)) errors.push(`${n.id}: 出目 ${d} が複数の分岐先に指定されています`);
            covered.add(d);
          }
        }
        for (const d of n.gate?.pass ?? []) {
          if (!covered.has(d)) errors.push(`${n.id}: 通過できる出目 ${d} の分岐先がありません`);
        }
      }
    } else if (n.next.length > 1) {
      errors.push(`${n.id}: 分岐できるのは関所だけです`);
    }
  }

  if (errors.length === 0) {
    const info = boardInfo(def);
    for (const n of def.nodes) {
      if (!info.distToGoal.has(n.id)) errors.push(`${n.id}: ゴールにたどり着けません`);
    }
  }
  return errors;
}
