// CPUどうしで多数のゲームを行い、バランスの目安を集計する。
// 使い方: npm run simulate -- [ゲーム数] [人数]

import forest from '../src/data/boards/forest.json';
import { autoplay } from '../src/ai/autoplay';
import { buildSharedDeck, getCardDef, MVP_CARD_IDS } from '../src/core/cards';
import { createGame } from '../src/core/engine';
import type { BoardDef } from '../src/core/types';

const games = Number(process.argv[2] ?? 1000);
const players = Number(process.argv[3] ?? 4);
const SECONDS_PER_TURN = 25;

const rounds: number[] = [];
const turns: number[] = [];
const winsBySeat = Array(players).fill(0);
const cardUse = new Map<string, number>();
let gateFails = 0;
let gateBroken = 0;
let counters = 0;
let trapsTriggered = 0;
let routeShort = 0;
let routeLong = 0;

for (let seed = 1; seed <= games; seed++) {
  const s = autoplay(
    createGame({
      board: forest as BoardDef,
      players: Array.from({ length: players }, (_, i) => ({ name: `CPU${i}`, isCpu: true })),
      deck: buildSharedDeck(MVP_CARD_IDS),
      seed,
    }),
  );
  rounds.push(s.round);
  turns.push(s.log.filter((e) => e.type === 'turnStart').length);
  winsBySeat[s.result!.winner]++;
  for (const e of s.log) {
    if (e.type === 'cardPlayed') cardUse.set(e.cardId, (cardUse.get(e.cardId) ?? 0) + 1);
    if (e.type === 'gateFail') gateFails++;
    if (e.type === 'gateBroken') gateBroken++;
    if (e.type === 'countered') counters++;
    if (e.type === 'trapTriggered') trapsTriggered++;
    if (e.type === 'gatePass' && (e.to === 'r1' || e.to === 'v1')) routeShort++;
    if (e.type === 'gatePass' && (e.to === 'l1' || e.to === 'u1')) routeLong++;
  }
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)];
const avgTurns = avg(turns);

console.log(`ボード: ${forest.name} / ${players}人 / ${games}ゲーム\n`);
console.log(`ラウンド数   平均 ${avg(rounds).toFixed(1)}（10% ${pct(rounds, 0.1)} / 中央 ${pct(rounds, 0.5)} / 90% ${pct(rounds, 0.9)}）`);
console.log(`手番の数     平均 ${avgTurns.toFixed(1)}`);
console.log(
  `プレイ時間   約${((avgTurns * SECONDS_PER_TURN) / 60).toFixed(1)}分（1手番${SECONDS_PER_TURN}秒として。90%のゲームは${((pct(turns, 0.9) * SECONDS_PER_TURN) / 60).toFixed(1)}分以内）`,
);
console.log(`席順ごとの勝率 ${winsBySeat.map((w, i) => `P${i + 1}: ${((w / games) * 100).toFixed(1)}%`).join('  ')}`);
console.log(`\n1ゲームあたり`);
console.log(`  関所での失敗 ${(gateFails / games).toFixed(1)}回 / 封印が砕けた ${(gateBroken / games).toFixed(2)}回`);
console.log(`  近道ルート ${(routeShort / games).toFixed(1)}回 / 遠回りルート ${(routeLong / games).toFixed(1)}回`);
console.log(`  カウンター ${(counters / games).toFixed(1)}回 / 罠の発動 ${(trapsTriggered / games).toFixed(2)}回`);
console.log(`\nカードの使用回数（1ゲームあたり）`);
for (const [id, n] of [...cardUse].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${getCardDef(id).name.padEnd(6, '　')} ${(n / games).toFixed(2)}`);
}
