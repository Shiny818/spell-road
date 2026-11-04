// CPUどうしで多数のゲームを行い、バランスの目安を集計する。
// 使い方: npm run simulate -- [ゲーム数] [人数] [mvp] [ボードのid]
// 例: npm run simulate -- 1000 4 mountain （ボードのidは forest / mountain。省くと forest）

import { autoplay } from '../src/ai/autoplay';
import { boardInfo } from '../src/core/board';
import { ALL_CARD_IDS, buildSharedDeck, getCardDef, MVP_CARD_IDS } from '../src/core/cards';
import { createGame } from '../src/core/engine';
import { BOARDS, getBoard } from '../src/data/boards';

const args = process.argv.slice(2);
const numbers = args.filter((a) => /^\d+$/.test(a)).map(Number);
const games = numbers[0] ?? 1000;
const players = numbers[1] ?? 4;
/** mvp と書くと、試作版の15種類だけで遊ぶ */
const cardIds = args.includes('mvp') ? MVP_CARD_IDS : ALL_CARD_IDS;
const board = getBoard(args.find((a) => BOARDS.some((b) => b.id === a)) ?? 'forest');
const SECONDS_PER_TURN = 25;

const info = boardInfo(board);
/** 分岐する関所と、その分岐先（近い順） */
const branches = board.nodes
  .filter((n) => n.type === 'gate' && n.next.length > 1)
  .map((n) => ({ gate: n.id, routes: [...n.next].sort((a, b) => info.distToGoal.get(a.to)! - info.distToGoal.get(b.to)!) }));
/** ルートごとの集計（関所のid → 分岐先のid → 集計） */
const routeStats = new Map<string, Map<string, { taken: number; wins: number; rankSum: number; cards: number }>>();
for (const b of branches) routeStats.set(b.gate, new Map(b.routes.map((e) => [e.to, { taken: 0, wins: 0, rankSum: 0, cards: 0 }])));

const rounds: number[] = [];
const turns: number[] = [];
const winsBySeat = Array(players).fill(0);
const cardUse = new Map<string, number>();
let gateFails = 0;
let gateBroken = 0;
let counters = 0;
let trapsTriggered = 0;

for (let seed = 1; seed <= games; seed++) {
  const s = autoplay(
    createGame({
      board,
      players: Array.from({ length: players }, (_, i) => ({ name: `CPU${i}`, isCpu: true })),
      deck: buildSharedDeck(cardIds),
      seed,
    }),
  );
  rounds.push(s.round);
  turns.push(s.log.filter((e) => e.type === 'turnStart').length);
  winsBySeat[s.result!.winner]++;
  /** プレイヤーごとに、分岐でどのルートに進んだか（関所のid → 分岐先） */
  const taken = s.players.map(() => new Map<string, string>());
  /** そのルートに入ってから引いたカードの枚数 */
  const drawsAfter = s.players.map(() => new Map<string, number>());
  for (const e of s.log) {
    if (e.type === 'cardPlayed') cardUse.set(e.cardId, (cardUse.get(e.cardId) ?? 0) + 1);
    if (e.type === 'gateFail') gateFails++;
    if (e.type === 'gateBroken') gateBroken++;
    if (e.type === 'countered') counters++;
    if (e.type === 'trapTriggered') trapsTriggered++;
    if (e.type === 'gatePass' && routeStats.has(e.gate)) {
      taken[e.player].set(e.gate, e.to);
      drawsAfter[e.player].set(e.gate, 0);
    }
    if (e.type === 'draw') for (const [g, n] of drawsAfter[e.player]) drawsAfter[e.player].set(g, n + e.count);
  }
  s.players.forEach((_, i) => {
    for (const [gate, to] of taken[i]) {
      const r = routeStats.get(gate)!.get(to)!;
      r.taken++;
      if (s.result!.winner === i) r.wins++;
      r.rankSum += s.result!.ranks[i];
      r.cards += drawsAfter[i].get(gate)!;
    }
  });
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)];
const avgTurns = avg(turns);
const pc = (n: number) => `${(n * 100).toFixed(1)}%`;

console.log(`ボード: ${board.name} / ${players}人 / ${games}ゲーム / カード${cardIds.length}種類 / 最短${info.distToGoal.get(info.startId)}マス\n`);
console.log(`ラウンド数   平均 ${avg(rounds).toFixed(1)}（10% ${pct(rounds, 0.1)} / 中央 ${pct(rounds, 0.5)} / 90% ${pct(rounds, 0.9)}）`);
console.log(`手番の数     平均 ${avgTurns.toFixed(1)}`);
console.log(
  `プレイ時間   約${((avgTurns * SECONDS_PER_TURN) / 60).toFixed(1)}分（1手番${SECONDS_PER_TURN}秒として。90%のゲームは${((pct(turns, 0.9) * SECONDS_PER_TURN) / 60).toFixed(1)}分以内）`,
);
console.log(`席順ごとの勝率 ${winsBySeat.map((w, i) => `P${i + 1}: ${pc(w / games)}`).join('  ')}`);
console.log(`\n1ゲームあたり`);
console.log(`  関所での失敗 ${(gateFails / games).toFixed(1)}回 / 封印が砕けた ${(gateBroken / games).toFixed(2)}回`);
console.log(`  カウンター ${(counters / games).toFixed(1)}回 / 罠の発動 ${(trapsTriggered / games).toFixed(2)}回`);

console.log(`\n分岐のルートごと（そのルートに進んだプレイヤーの成績。勝率の目安は全体で ${pc(1 / players)}）`);
for (const b of branches) {
  b.routes.forEach((e, k) => {
    const r = routeStats.get(b.gate)!.get(e.to)!;
    const len = info.distToGoal.get(e.to)! + 1;
    const name = k === 0 ? '近道' : '遠回り';
    console.log(
      `  ${b.gate} ${name}（出目${e.dice!.join('・')}、関所からゴールまで${len}マス）: 1ゲーム${(r.taken / games).toFixed(2)}人 / 勝率 ${pc(r.wins / r.taken)} / 平均順位 ${(r.rankSum / r.taken).toFixed(2)} / 引いたカード ${(r.cards / r.taken).toFixed(1)}枚`,
    );
  });
}

console.log(`\nカードの使用回数（1ゲームあたり）`);
for (const [id, n] of [...cardUse].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${getCardDef(id).name.padEnd(6, '　')} ${(n / games).toFixed(2)}`);
}
