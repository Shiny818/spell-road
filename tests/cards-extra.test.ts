// MVP以外の12種類のカード
import { describe, expect, it } from 'vitest';
import { getLegalActions, plannedSteps } from '../src/core/engine';
import type { Action } from '../src/core/types';
import { at, give, placeAt, run, setup } from './helpers';

const roll = (player: number) => ({ type: 'roll', player }) as const;
const move = (player: number) => ({ type: 'confirmMove', player }) as const;
const end = (player: number) => ({ type: 'endTurn', player }) as const;
const play = (player: number, uid: number, extra: { target?: number; choice?: number } = {}): Action => ({
  type: 'playCard',
  player,
  uid,
  ...extra,
});
const plays = (s: Parameters<typeof getLegalActions>[0], player: number) =>
  getLegalActions(s, player).filter((a) => a.type === 'playCard');

describe('風', () => {
  it('旅の風で1マス進み、止まったマスの効果も発動する', () => {
    let s = setup();
    const uid = give(s, 0, 'tabi_no_kaze');
    s.forcedDice = [1];
    s = run(s, roll(0), move(0));
    expect(at(s, 0)).toBe('a1');
    s = run(s, play(0, uid));
    expect(at(s, 0)).toBe('a2');
    expect(s.players[0].hand).toHaveLength(1); // カード入手マスで1枚
    expect(s.phase).toBe('turnEnd');
  });

  it('大旋風でダイス3個の合計だけ進む', () => {
    let s = setup();
    const uid = give(s, 0, 'daisenpu');
    s.forcedDice = [1, 2, 3];
    s = run(s, play(0, uid), roll(0));
    expect(s.turn.dice).toEqual([1, 2, 3]);
    s = run(s, move(0));
    expect(at(s, 0)).toBe('a6');
  });
});

describe('時', () => {
  it('倍速で出目が2倍。関所では使えない', () => {
    let s = setup();
    const uid = give(s, 0, 'baisoku');
    s.forcedDice = [2];
    s = run(s, roll(0), play(0, uid), move(0));
    expect(at(s, 0)).toBe('a4');

    let g = setup();
    placeAt(g, 0, 'g2');
    give(g, 0, 'baisoku');
    g.forcedDice = [2];
    g = run(g, roll(0));
    expect(plays(g, 0)).toEqual([]);
  });

  it('時間停止で、もう一度自分のターン。追加のターンではカードを使えない', () => {
    let s = setup();
    const uid = give(s, 0, 'jikan_teishi');
    give(s, 0, 'oikaze');
    s.forcedDice = [1, 1];
    s = run(s, roll(0), move(0), play(0, uid), end(0));
    expect(s.current).toBe(0);
    expect(s.log.at(-1)).toEqual({ type: 'turnStart', player: 0, round: 1, extra: true });
    expect(plays(s, 0)).toEqual([]);
    s = run(s, roll(0), move(0), end(0));
    expect(at(s, 0)).toBe('a2');
    expect(s.current).toBe(1);
  });
});

describe('炎・氷', () => {
  it('爆炎は全員に当たり、1人ずつカウンターできる', () => {
    let s = setup(3);
    for (const p of [0, 1, 2]) placeAt(s, p, 'b3');
    const uid = give(s, 0, 'bakuen');
    const wall = give(s, 1, 'hikari_no_kabe');
    s = run(s, play(0, uid));
    expect(s.pending).toMatchObject({ kind: 'counter', target: 1 });
    s = run(s, { type: 'counter', player: 1, uid: wall });
    expect(s.pending).toBeNull();
    expect(at(s, 1)).toBe('b3');
    expect(at(s, 2)).toBe('a7');
  });

  it('爆炎を反射の鏡ではね返すと、その人の分だけ攻撃者が戻る', () => {
    let s = setup(3);
    for (const p of [0, 1, 2]) placeAt(s, p, 'b3');
    const uid = give(s, 0, 'bakuen');
    const mirror = give(s, 1, 'hansha_no_kagami');
    s = run(s, play(0, uid), { type: 'counter', player: 1, uid: mirror });
    expect(at(s, 0)).toBe('a7');
    expect(at(s, 1)).toBe('b3');
    expect(at(s, 2)).toBe('a7');
  });

  it('凍てつく床を踏むと、そのマスで止まり、マスの効果がある', () => {
    let s = setup();
    placeAt(s, 0, 'a1');
    const trap = give(s, 0, 'itetsuku_yuka');
    s.forcedDice = [1, 5];
    s = run(s, roll(0), move(0), play(0, trap), end(0));
    expect(s.traps.a2).toEqual({ owner: 0, kind: 'ice' });
    s = run(s, roll(1), move(1));
    expect(at(s, 1)).toBe('a2');
    expect(s.traps.a2).toBeUndefined();
    expect(s.players[1].hand).toHaveLength(1);
    expect(s.phase).toBe('turnEnd');
  });

  it('吹雪で次の移動マス数が半分（切り捨て）になり、移動したら解ける', () => {
    let s = setup();
    const uid = give(s, 0, 'fubuki');
    s.forcedDice = [1, 5];
    s = run(s, play(0, uid), roll(0), move(0), end(0));
    expect(s.players[1].statuses.blizzard).toBe(true);
    s = run(s, roll(1));
    expect(plannedSteps(s)).toBe(2);
    s = run(s, move(1));
    expect(at(s, 1)).toBe('a2');
    expect(s.players[1].statuses.blizzard).toBe(false);
  });
});

describe('光', () => {
  it('浄化は悪い状態があるときだけ使え、霜と吹雪を解く', () => {
    let s = setup();
    const uid = give(s, 0, 'jouka');
    expect(plays(s, 0)).toEqual([]);
    s.players[0].statuses.frost = true;
    s.players[0].statuses.blizzard = true;
    s = run(s, play(0, uid));
    expect(s.players[0].statuses).toMatchObject({ frost: false, blizzard: false });
  });

  it('聖なる加護の間は攻撃の対象にならず、全員への攻撃と罠も受けない。次の自分のターンで解ける', () => {
    let s = setup(3);
    const guard = give(s, 0, 'seinaru_kago');
    s.forcedDice = [1];
    s = run(s, play(0, guard), roll(0), move(0), end(0));
    expect(s.players[0].statuses.protected).toBe(true);

    // プレイヤー1: 炎のつぶての対象に選べるのはプレイヤー2だけ。爆炎はプレイヤー0には当たらない
    give(s, 1, 'honoo_no_tsubute');
    expect(plays(s, 1).map((a) => (a as { target?: number }).target)).toEqual([2]);
    s.players[1].hand = [];
    placeAt(s, 2, 'b3');
    const blast = give(s, 1, 'bakuen');
    s = run(s, play(1, blast));
    expect(s.log.some((e) => e.type === 'blocked' && e.player === 0)).toBe(true);
    expect(at(s, 0)).toBe('a1');
    expect(at(s, 2)).toBe('a7');

    s.forcedDice = [1, 1];
    s = run(s, roll(1), move(1), end(1), roll(2), move(2), end(2));
    expect(s.current).toBe(0);
    expect(s.players[0].statuses.protected).toBe(false);
  });
});

describe('闇', () => {
  it('忘却で相手の手札が1枚捨て札になる', () => {
    let s = setup();
    const uid = give(s, 0, 'boukyaku');
    give(s, 1, 'oikaze');
    give(s, 1, 'shukufuku');
    s = run(s, play(0, uid, { target: 1 }));
    expect(s.players[1].hand).toHaveLength(1);
    expect(s.discard.map((c) => c.cardId)).toContain('boukyaku');
    expect(s.discard).toHaveLength(2);
  });

  it('闇の取引で、選んだ1枚と相手のランダムな1枚を交換する', () => {
    let s = setup();
    const uid = give(s, 0, 'yami_no_torihiki');
    const mine = give(s, 0, 'shukufuku');
    // 相手の手札が空なら使えない
    expect(plays(s, 0)).toEqual([]);
    const theirs = give(s, 1, 'oikaze');
    expect(plays(s, 0)).toEqual([play(0, uid, { target: 1, choice: mine })]);
    s = run(s, play(0, uid, { target: 1, choice: mine }));
    expect(s.players[0].hand.map((c) => c.uid)).toEqual([theirs]);
    expect(s.players[1].hand.map((c) => c.uid)).toEqual([mine]);
  });

  it('呪いの封印を受けると、次の自分のターンが終わるまでカードもカウンターも使えない', () => {
    let s = setup();
    const seal = give(s, 0, 'noroi_no_fuin');
    const fire = give(s, 0, 'honoo_no_tsubute');
    s.forcedDice = [1, 1, 1];
    s = run(s, play(0, seal, { target: 1 }), roll(0), move(0), end(0));
    give(s, 1, 'oikaze');
    give(s, 1, 'hikari_no_kabe');
    expect(plays(s, 1)).toEqual([]);
    s = run(s, roll(1), move(1), end(1));
    expect(s.players[1].statuses.sealed).toBe(false);
    // 封印が解けたので、カウンターできる
    s = run(s, play(0, fire, { target: 1 }));
    expect(s.pending).toMatchObject({ kind: 'counter', target: 1 });
  });

  it('封印をはね返されたら、攻撃した人は次の自分のターンの終わりまで封印される', () => {
    let s = setup();
    const seal = give(s, 0, 'noroi_no_fuin');
    const mirror = give(s, 1, 'hansha_no_kagami');
    s.forcedDice = [1, 1, 1];
    s = run(s, play(0, seal, { target: 1 }), { type: 'counter', player: 1, uid: mirror }, roll(0), move(0), end(0));
    expect(s.players[0].statuses.sealed).toBe(true);
    s = run(s, roll(1), move(1), end(1));
    give(s, 0, 'oikaze');
    expect(plays(s, 0)).toEqual([]);
    s = run(s, roll(0), move(0), end(0));
    expect(s.players[0].statuses.sealed).toBe(false);
  });
});
