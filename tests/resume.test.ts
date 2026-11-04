import { describe, expect, it } from 'vitest';
import { HIDDEN_CARD } from '../src/core/view';
import type { GameState } from '../src/core/types';
import { ClientSession } from '../src/net/ClientSession';
import { HostSession, type HostTiming } from '../src/net/HostSession';
import { PROTOCOL_VERSION } from '../src/net/protocol';
import { SAVE_MAX_AGE_MS, SAVE_VERSION, memorySaveStore, validateSave } from '../src/net/save';
import type { GameSession, GameView } from '../src/net/session';
import { createMemoryNetwork } from '../src/net/transport';

const FAST: Partial<HostTiming> = { cpuDelayMs: 0, watchWaitMs: 200, turnLimitMs: 2000, counterLimitMs: 2000, heartbeat: false };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 画面の代わり。操作できるようになったら、今できる操作からランダムに選ぶ */
class BotView implements GameView {
  session!: GameSession;
  leaks: string[] = [];
  private x: number;
  constructor(seed: number) {
    this.x = seed;
  }
  async playEvents(): Promise<void> {}
  render(state: GameState): void {
    for (const p of state.players) {
      if (p.index !== this.session.me && p.hand.some((c) => c.cardId !== HIDDEN_CARD)) this.leaks.push(`${this.session.me}が${p.index}の手札を見た`);
    }
    const legal = this.session.legal;
    if (legal.length === 0) return;
    this.x = (this.x * 1103515245 + 12345) >>> 0;
    const a = legal[this.x % legal.length];
    setTimeout(() => this.session.act(a), 0);
  }
}

async function until(cond: () => boolean, ms = 20000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('時間切れ');
    await sleep(5);
  }
}

/** ホスト1人＋参加者1人＋CPU1人でゲームを始め、2ラウンド目まで進める */
async function startRoom(clientOptions: { giveUpMs?: number } = {}) {
  const net = createMemoryNetwork();
  const store = memorySaveStore();
  const hostView = new BotView(1);
  const host = new HostSession('ホスト', hostView, net.host('ABCDE'), {}, FAST, store);
  hostView.session = host;

  const view = new BotView(2);
  const ended: string[] = [];
  const statuses: (string | null)[] = [];
  const client = new ClientSession(
    net.connect,
    'ABCDE',
    'アン',
    'id-アン',
    view,
    { onEnd: (t) => ended.push(t), onStatus: (t) => statuses.push(t) },
    { heartbeat: false, retryMs: 20, ...clientOptions },
  );
  view.session = client;
  await client.start();
  await until(() => host.seats.length === 2);
  void host.startGame(1);
  await until(() => (host.fullState?.round ?? 0) >= 2);
  return { net, store, host, hostView, client, view, ended, statuses };
}

/** ホストの画面が閉じたあと、同じ部屋コードで開き直す */
function reopen(room: Awaited<ReturnType<typeof startRoom>>) {
  const save = room.store.load()!;
  const view = new BotView(3);
  const lobby: number[] = [];
  const host2 = HostSession.restore(save, view, room.net.host('ABCDE'), { onLobby: (s) => lobby.push(s.length) }, FAST, room.store);
  view.session = host2;
  return { save, host2, view, lobby };
}

describe('ホストの保存と再開', () => {
  it('ホストの画面が閉じても、同じ部屋コードで開き直すと、参加者が同じ席に戻って最後まで遊べる', async () => {
    const room = await startRoom();
    room.host.halt();
    const { save, host2, view } = reopen(room);

    // 保存した状態がそのまま戻っている（手札も乱数の状態も）
    expect(host2.fullState).toEqual(save.state);
    expect(save.state.round).toBeGreaterThanOrEqual(2);
    // 参加者が戻るまでは止まっている
    expect(host2.paused).toBe(true);
    expect(host2.state).toBeNull();
    expect(host2.legal).toEqual([]);

    // 参加者はつなぎ直し続けていて、開き直したホストに自動で戻る
    await until(() => !host2.paused);
    expect(room.client.me).toBe(1);
    expect(room.ended).toEqual([]);
    await until(() => host2.fullState?.phase === 'gameOver' && room.client.state?.phase === 'gameOver', 60000);
    expect(room.client.state!.result).toEqual(host2.fullState!.result);
    // 再開後も、他の人の手札は見えない
    expect([...view.leaks, ...room.view.leaks]).toEqual([]);
    // ゲームが終わったら保存は消える
    expect(room.store.raw()).toBeNull();
    host2.stop();
  }, 70000);

  it('参加者が戻れなくても、ホストが「いるメンバーで再開」すれば、その席はCPUが操作して続く', async () => {
    const room = await startRoom({ giveUpMs: 60_000 });
    room.host.halt();
    // 参加者を引き止めないよう、つなぎ直しをやめさせる
    room.client.stop();
    await sleep(350);
    const { host2 } = reopen(room);
    expect(host2.paused).toBe(true);
    expect(host2.missing.map((s) => s.name)).toEqual(['アン']);
    await sleep(100);
    expect(host2.paused).toBe(true);

    const turns = host2.fullState!.turnCount;
    await host2.resume();
    await until(() => host2.fullState!.turnCount > turns + 3);
    await until(() => host2.fullState?.phase === 'gameOver', 60000);
    host2.stop();
  }, 70000);

  it('ゲームを進めるたびに保存され、部屋を自分で閉じると保存は消える', async () => {
    const room = await startRoom();
    const first = room.store.load()!;
    expect(first.code).toBe('ABCDE');
    expect(first.seats.map((s) => [s.name, s.kind, s.host, s.clientId])).toEqual([
      ['ホスト', 'human', true, null],
      ['アン', 'human', false, 'id-アン'],
      ['ルル', 'cpu', false, null],
    ]);
    await until(() => (room.store.load()?.state.turnCount ?? 0) > first.state.turnCount);
    room.host.stop();
    expect(room.store.raw()).toBeNull();
  });

  it('ゲームを始める前に部屋を閉じても、前のゲームの保存は消さない', async () => {
    const store = memorySaveStore();
    const net = createMemoryNetwork();
    const first = await startRoom();
    store.save(first.store.load()!);
    first.host.halt();

    const view = new BotView(1);
    const lobbyHost = new HostSession('ホスト', view, net.host('ZZZZZ'), {}, FAST, store);
    view.session = lobbyHost;
    lobbyHost.stop();
    expect(store.load()).not.toBeNull();
  });

  it('通信なしの1人プレイは保存しない', async () => {
    const store = memorySaveStore();
    const view = new BotView(1);
    const host = new HostSession('ホスト', view, null, {}, FAST, store);
    view.session = host;
    void host.startGame(2);
    await until(() => host.fullState!.turnCount >= 3);
    expect(store.raw()).toBeNull();
    host.stop();
  });
});

describe('保存の確かめ', () => {
  it('版が違う・古すぎる・壊れた保存は再開に使わない', async () => {
    const room = await startRoom();
    const good = room.store.load()!;
    room.host.stop();
    const now = good.savedAt + 1000;
    expect(validateSave(good, now)).not.toBeNull();
    expect(validateSave({ ...good, v: SAVE_VERSION + 1 }, now)).toBeNull();
    expect(validateSave({ ...good, protocol: PROTOCOL_VERSION + 1 }, now)).toBeNull();
    expect(validateSave(good, good.savedAt + SAVE_MAX_AGE_MS + 1)).toBeNull();
    expect(validateSave({ ...good, seats: good.seats.slice(0, 1) }, now)).toBeNull();
    expect(validateSave({ ...good, state: { ...good.state, result: { winner: 0 } } }, now)).toBeNull();
    expect(validateSave(null, now)).toBeNull();
    expect(validateSave('x', now)).toBeNull();
  });
});

describe('参加者の待ち時間', () => {
  it('ホストが戻らなくても、しばらくはあきらめずに待つ。長い間つながらなければ終わる', async () => {
    // 以前は約30秒（12回）で終わっていた。つなぎ直しの間隔20msで、それより長く待てることを確かめる
    const room = await startRoom({ giveUpMs: 700 });
    room.host.halt();
    await sleep(450);
    expect(room.ended).toEqual([]);
    expect(room.statuses.some((t) => t?.includes('つなぎ直して'))).toBe(true);
    await until(() => room.ended.length > 0, 3000);
    expect(room.ended[0]).toContain('長い間');
  });

  it('開き直したホストが参加者を待っている間、参加者には「再開の準備中」と表示される', async () => {
    const room = await startRoom();
    room.host.halt();
    const { host2 } = reopen(room);
    // 参加者が戻ると、いったん待合室の通知が届く
    await until(() => room.statuses.some((t) => t?.includes('再開の準備')) || !host2.paused);
    await until(() => !host2.paused);
    await until(() => room.statuses.at(-1) === null);
    host2.stop();
  });
});
