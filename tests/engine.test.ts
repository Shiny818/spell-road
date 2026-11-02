import { describe, expect, it } from 'vitest';
import { validateBoard } from '../src/core/board';
import { applyAction, getLegalActions, RuleError, swapTargets } from '../src/core/engine';
import type { BoardDef } from '../src/core/types';
import { at, FOREST, give, placeAt, run, setup } from './helpers';

const roll = (player: number) => ({ type: 'roll', player }) as const;
const move = (player: number) => ({ type: 'confirmMove', player }) as const;
const end = (player: number) => ({ type: 'endTurn', player }) as const;

describe('ボード', () => {
  it('はじまりの森のデータは正しい', () => {
    expect(validateBoard(FOREST)).toEqual([]);
  });

  it('関所以外で分岐しているとエラーになる', () => {
    const bad: BoardDef = {
      id: 'bad',
      name: 'bad',
      nodes: [
        { id: 's', type: 'start', next: [{ to: 'a' }, { to: 'g' }] },
        { id: 'a', type: 'empty', next: [{ to: 'g' }] },
        { id: 'g', type: 'goal', next: [] },
      ],
    };
    expect(validateBoard(bad)).toContain('s: 分岐できるのは関所だけです');
  });
});

describe('移動とマス', () => {
  it('出目の分だけ進む', () => {
    let s = setup();
    s.forcedDice = [3];
    s = run(s, roll(0), move(0));
    expect(at(s, 0)).toBe('a3');
    expect(s.phase).toBe('turnEnd');
  });

  it('カード入手マスで1枚引く', () => {
    let s = setup();
    s.forcedDice = [2];
    s = run(s, roll(0), move(0));
    expect(at(s, 0)).toBe('a2');
    expect(s.players[0].hand).toHaveLength(1);
  });

  it('自分のターンに使えるカードは1枚まで', () => {
    let s = setup();
    give(s, 0, 'oikaze');
    const uid2 = give(s, 0, 'unmei_no_hari');
    s = run(s, { type: 'playCard', player: 0, uid: s.players[0].hand[0].uid }, roll(0));
    expect(getLegalActions(s, 0).some((a) => a.type === 'playCard')).toBe(false);
    expect(() => applyAction(s, { type: 'playCard', player: 0, uid: uid2, choice: 1 })).toThrow(RuleError);
  });

  it('追い風で移動マス数+2', () => {
    let s = setup();
    const uid = give(s, 0, 'oikaze');
    s.forcedDice = [1];
    s = run(s, { type: 'playCard', player: 0, uid }, roll(0), move(0));
    expect(at(s, 0)).toBe('a3');
  });

  it('疾風でダイス2個の合計だけ進む', () => {
    let s = setup();
    const uid = give(s, 0, 'shippu');
    s.forcedDice = [2, 3];
    s = run(s, { type: 'playCard', player: 0, uid }, roll(0));
    expect(s.turn.value).toBe(5);
  });

  it('ゴールは出目が多くてもゴールになり、残りマス数で順位が決まる（同じなら同順位）', () => {
    let s = setup(4);
    placeAt(s, 0, 'z4');
    placeAt(s, 1, 'm5');
    placeAt(s, 2, 'm5');
    placeAt(s, 3, 'a1');
    s.forcedDice = [6];
    s = run(s, roll(0), move(0));
    expect(s.phase).toBe('gameOver');
    expect(s.result).toEqual({ winner: 0, ranks: [1, 2, 2, 4] });
  });

  it('手札が上限を超えたらターン終了時に捨てる', () => {
    let s = setup();
    for (let i = 0; i < 6; i++) give(s, 0, 'oikaze');
    s.forcedDice = [1];
    s = run(s, roll(0), move(0), end(0));
    expect(s.pending).toMatchObject({ kind: 'discard', count: 1 });
    s = run(s, { type: 'discard', player: 0, uids: [s.players[0].hand[0].uid] });
    expect(s.players[0].hand).toHaveLength(5);
    expect(s.current).toBe(1);
  });

  it('カード交換マスで3枚から選んで交換できる', () => {
    let s = setup();
    placeAt(s, 0, 'a6');
    const mine = give(s, 0, 'oikaze');
    s.forcedDice = [1];
    s = run(s, roll(0), move(0));
    expect(at(s, 0)).toBe('a7');
    const pd = s.pending!;
    expect(pd.kind).toBe('exchange');
    if (pd.kind !== 'exchange') return;
    expect(pd.offer).toHaveLength(3);
    const pick = pd.offer[1];
    const deckBefore = s.deck.length;
    s = run(s, { type: 'exchange', player: 0, offerUid: pick.uid, handUid: mine });
    expect(s.players[0].hand.map((c) => c.uid)).toEqual([pick.uid]);
    expect(s.deck.length).toBe(deckBefore + 2);
    expect(s.phase).toBe('turnEnd');
  });

  it('手札がなければカード交換マスでは何も起きない', () => {
    let s = setup();
    placeAt(s, 0, 'a6');
    s.forcedDice = [1];
    s = run(s, roll(0), move(0));
    expect(s.pending).toBeNull();
  });
});

describe('関所', () => {
  it('通過しようとしても関所で止まる', () => {
    let s = setup();
    placeAt(s, 0, 'b7');
    s.forcedDice = [5];
    s = run(s, roll(0), move(0));
    expect(at(s, 0)).toBe('g2');
  });

  it('条件に合わない目なら進めず、ひびが入る', () => {
    let s = setup();
    placeAt(s, 0, 'g2');
    s.forcedDice = [2];
    s = run(s, roll(0), move(0));
    expect(at(s, 0)).toBe('g2');
    expect(s.players[0].gateCracks.g2).toBe(1);
  });

  it('条件に合う目なら出目に関係なく1マスだけ進み、出目でルートが決まる', () => {
    let s = setup();
    placeAt(s, 0, 'g2');
    s.forcedDice = [6];
    s = run(s, roll(0), move(0));
    expect(at(s, 0)).toBe('r1');

    let t = setup();
    placeAt(t, 0, 'g2');
    t.forcedDice = [3];
    t = run(t, roll(0), move(0));
    expect(at(t, 0)).toBe('l1');

    let u = setup();
    placeAt(u, 0, 'g3');
    u.forcedDice = [4];
    u = run(u, roll(0), move(0));
    expect(at(u, 0)).toBe('v1');
  });

  it('ひびが3本入ると次のターンは必ず抜けられる', () => {
    let s = setup();
    placeAt(s, 0, 'g2');
    s.players[0].gateCracks.g2 = 2;
    s.forcedDice = [1, 1, 2];
    s = run(s, roll(0), move(0), end(0), roll(1), move(1), end(1));
    expect(s.players[0].gateCracks.g2).toBe(3);
    expect(s.turn.gateBroken).toBe(true);
    s = run(s, roll(0), move(0));
    // 出目2に対応するルートはないので、最初のルート（遠回り）へ
    expect(at(s, 0)).toBe('l1');
    expect(s.players[0].gateCracks.g2).toBeUndefined();
  });

  it('関所では移動のカードは使えないが、出目のカードは使える', () => {
    let s = setup();
    placeAt(s, 0, 'g2');
    give(s, 0, 'oikaze');
    give(s, 0, 'shippu');
    const star = give(s, 0, 'hoshiyomi');
    expect(getLegalActions(s, 0).filter((a) => a.type === 'playCard')).toEqual([]);
    s.forcedDice = [2];
    s = run(s, roll(0), { type: 'playCard', player: 0, uid: star, choice: 6 }, move(0));
    expect(at(s, 0)).toBe('r1');
  });

  it('通過した関所より前には戻されない', () => {
    let s = setup();
    placeAt(s, 1, 'l2');
    const uid = give(s, 0, 'kaen');
    s = run(s, { type: 'playCard', player: 0, uid, target: 1 });
    expect(at(s, 1)).toBe('l1');
  });

  it('関所で止まっている人は戻されると関所から離れ、ひびは残る', () => {
    let s = setup();
    placeAt(s, 1, 'g2');
    s.players[1].gateCracks.g2 = 2;
    const uid = give(s, 0, 'honoo_no_tsubute');
    s = run(s, { type: 'playCard', player: 0, uid, target: 1 });
    expect(at(s, 1)).toBe('b7');
    expect(s.players[1].gateCracks.g2).toBe(2);
  });
});

describe('攻撃とカウンター', () => {
  it('光の壁で攻撃を無効にする', () => {
    let s = setup();
    placeAt(s, 1, 'a5');
    const kaen = give(s, 0, 'kaen');
    const wall = give(s, 1, 'hikari_no_kabe');
    s = run(s, { type: 'playCard', player: 0, uid: kaen, target: 1 });
    expect(s.pending).toMatchObject({ kind: 'counter', target: 1 });
    s = run(s, { type: 'counter', player: 1, uid: wall });
    expect(at(s, 1)).toBe('a5');
    expect(s.pending).toBeNull();
  });

  it('反射の鏡ではね返された攻撃には、カウンターできない', () => {
    let s = setup();
    placeAt(s, 0, 'a6');
    placeAt(s, 1, 'a5');
    const kaen = give(s, 0, 'kaen');
    give(s, 0, 'hikari_no_kabe');
    const mirror = give(s, 1, 'hansha_no_kagami');
    s = run(s, { type: 'playCard', player: 0, uid: kaen, target: 1 }, { type: 'counter', player: 1, uid: mirror });
    expect(at(s, 1)).toBe('a5');
    expect(at(s, 0)).toBe('a2');
    expect(s.pending).toBeNull();
  });

  it('カウンターは自分のターンの1枚とは別枠で、何回でも使える', () => {
    let s = setup(3);
    const w1 = give(s, 0, 'hikari_no_kabe');
    const w2 = give(s, 0, 'hikari_no_kabe');
    give(s, 0, 'oikaze');
    const a1 = give(s, 1, 'honoo_no_tsubute');
    const a2 = give(s, 2, 'honoo_no_tsubute');
    s.forcedDice = [1, 1, 1];
    s = run(
      s,
      roll(0), move(0), end(0),
      { type: 'playCard', player: 1, uid: a1, target: 0 },
      { type: 'counter', player: 0, uid: w1 },
      roll(1), move(1), end(1),
      { type: 'playCard', player: 2, uid: a2, target: 0 },
      { type: 'counter', player: 0, uid: w2 },
      roll(2), move(2), end(2),
    );
    expect(at(s, 0)).toBe('a1');
    expect(getLegalActions(s, 0).some((a) => a.type === 'playCard')).toBe(true);
  });

  it('霜の呪いで次の出目が-2（最低1）', () => {
    let s = setup();
    const uid = give(s, 0, 'shimo_no_noroi');
    s.forcedDice = [1, 2];
    s = run(s, { type: 'playCard', player: 0, uid, target: 1 }, roll(0), move(0), end(0), roll(1));
    expect(s.turn.value).toBe(1);
    expect(s.players[1].statuses.frost).toBe(false);
  });

  it('氷結で1回休み', () => {
    let s = setup();
    const uid = give(s, 0, 'hyouketsu');
    s.forcedDice = [1];
    s = run(s, { type: 'playCard', player: 0, uid, target: 1 }, roll(0), move(0), end(0));
    expect(s.current).toBe(0);
    expect(s.round).toBe(2);
    expect(s.players[1].statuses.rest).toBe(false);
  });

  it('盗みの影で相手の手札を1枚奪う', () => {
    let s = setup();
    const uid = give(s, 0, 'nusumi_no_kage');
    give(s, 1, 'oikaze');
    s = run(s, { type: 'playCard', player: 0, uid, target: 1 });
    expect(s.players[0].hand.map((c) => c.cardId)).toEqual(['oikaze']);
    expect(s.players[1].hand).toEqual([]);
  });

  it('つむじ風は1つ前の人とだけ入れ替えられ、チェックポイントを越えて戻す相手には使えない', () => {
    const s = setup(3);
    placeAt(s, 0, 'a2');
    placeAt(s, 1, 'a5');
    placeAt(s, 2, 'a7');
    expect(swapTargets(s, 0)).toEqual([1]);

    placeAt(s, 0, 'b2');
    placeAt(s, 1, 'l1');
    placeAt(s, 2, 'l3');
    expect(swapTargets(s, 0)).toEqual([]);
  });

  it('つむじ風で位置を入れ替える', () => {
    let s = setup();
    placeAt(s, 1, 'a5');
    const uid = give(s, 0, 'tsumujikaze');
    s = run(s, { type: 'playCard', player: 0, uid, target: 1 });
    expect(at(s, 0)).toBe('a5');
    expect(at(s, 1)).toBe('start');
  });
});

describe('罠', () => {
  function withTrapAtA2() {
    let s = setup();
    placeAt(s, 0, 'a1');
    const trap = give(s, 0, 'honoo_no_mahoujin');
    s.forcedDice = [1];
    s = run(s, roll(0), move(0));
    expect(at(s, 0)).toBe('a2');
    return run(s, { type: 'playCard', player: 0, uid: trap }, end(0));
  }

  it('通過するときにも発動し、移動が止まって3マス戻る', () => {
    let s = withTrapAtA2();
    expect(s.traps.a2).toBeDefined();
    s.forcedDice = [5];
    s = run(s, roll(1), move(1));
    expect(at(s, 1)).toBe('start');
    expect(s.traps.a2).toBeUndefined();
    expect(s.phase).toBe('turnEnd');
  });

  it('光の壁で防ぐと、そのまま移動を続ける。反射の鏡は使えない', () => {
    let s = withTrapAtA2();
    const wall = give(s, 1, 'hikari_no_kabe');
    give(s, 1, 'hansha_no_kagami');
    s.forcedDice = [5];
    s = run(s, roll(1), move(1));
    expect(s.pending).toMatchObject({ kind: 'counter', source: 'trap' });
    const counters = getLegalActions(s, 1).filter((a) => a.type === 'counter');
    expect(counters).toEqual([{ type: 'counter', player: 1, uid: wall }]);
    s = run(s, { type: 'counter', player: 1, uid: wall });
    expect(at(s, 1)).toBe('a5');
  });
});
