// 通信のしくみ。ホスト・参加者の処理（HostSession / ClientSession）は、この形だけを使う。
// 本番は PeerJS（peer.ts）、テストは通信なしでつなぐ版（createMemoryNetwork）を使う。

import type { ClientMessage, HostMessage } from './protocol';

/** 1本のつながり。In は受け取るメッセージ、Out は送るメッセージ */
export interface Connection<In, Out> {
  send(msg: Out): void;
  onMessage(fn: (msg: In) => void): void;
  /** 相手が切った・通信が途切れた（自分で close したときも呼ばれる） */
  onClose(fn: () => void): void;
  close(): void;
}

export type HostSide = Connection<ClientMessage, HostMessage>;
export type ClientSide = Connection<HostMessage, ClientMessage>;

/** ホストが部屋を開いている間の窓口 */
export interface HostTransport {
  readonly code: string;
  onConnection(fn: (conn: HostSide) => void): void;
  close(): void;
}

/** 部屋コードでホストにつなぐ。つながらなければ NetError で失敗する */
export type ConnectToHost = (code: string) => Promise<ClientSide>;

export type NetErrorKind = 'notFound' | 'network' | 'timeout';

export class NetError extends Error {
  constructor(public readonly kind: NetErrorKind) {
    super(kind);
  }
}

export const NET_ERROR_TEXT: Record<NetErrorKind, string> = {
  notFound: 'その部屋コードの部屋が見つかりません。コードを確かめてください。',
  network: 'つながりませんでした。インターネットとWi-Fiを確かめてください。',
  timeout:
    'ホストにつながりませんでした。ホストと同じWi-Fiにつないでいるか確かめてください（フリーWi-Fiやゲスト用Wi-Fiでは、端末どうしがつながらないことがあります）。',
};

// ============================================================
// 生存確認（スマホがスリープしたときなど、切れたことに早く気づくため）
// ============================================================

interface Pingable {
  t: string;
}

/**
 * 一定の間隔で ping を送り、相手から何も届かない時間が続いたら切れたとみなす。
 * ping はここで取り除くので、呼び出し側には届かない。
 */
export function withHeartbeat<In extends Pingable, Out extends Pingable>(
  conn: Connection<In, Out>,
  ping: Out,
  intervalMs = 2000,
  timeoutMs = 9000,
): Connection<In, Out> {
  let last = Date.now();
  let closed = false;
  const timer = setInterval(() => {
    if (Date.now() - last > timeoutMs) {
      conn.close();
      return;
    }
    conn.send(ping);
  }, intervalMs);
  const listeners: ((msg: In) => void)[] = [];
  conn.onMessage((msg) => {
    last = Date.now();
    if (msg.t === 'ping') return;
    for (const fn of listeners) fn(msg);
  });
  conn.onClose(() => {
    closed = true;
    clearInterval(timer);
  });
  return {
    send: (msg) => {
      if (!closed) conn.send(msg);
    },
    onMessage: (fn) => listeners.push(fn),
    onClose: (fn) => conn.onClose(fn),
    close: () => conn.close(),
  };
}

// ============================================================
// テスト用: 通信なしで、同じプログラムの中でつなぐ
// ============================================================

/** 送ったものは JSON にして渡す（本物の通信と同じく、別のオブジェクトになる） */
function pipePair<A, B>(): [Connection<A, B>, Connection<B, A>] {
  const handlers = [[] as ((m: unknown) => void)[], [] as ((m: unknown) => void)[]];
  const closers = [[] as (() => void)[], [] as (() => void)[]];
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    queueMicrotask(() => [...closers[0], ...closers[1]].forEach((fn) => fn()));
  };
  const side = (me: 0 | 1) => ({
    send: (msg: unknown) => {
      if (!open) return;
      const copy = JSON.parse(JSON.stringify(msg));
      queueMicrotask(() => {
        handlers[1 - me].forEach((fn) => fn(copy));
      });
    },
    onMessage: (fn: (m: unknown) => void) => handlers[me].push(fn),
    onClose: (fn: () => void) => closers[me].push(fn),
    close,
  });
  return [side(0) as Connection<A, B>, side(1) as Connection<B, A>];
}

export interface MemoryNetwork {
  host(code: string): HostTransport;
  connect: ConnectToHost;
  /** つながっているものをすべて切る（テストで切断を起こす） */
  dropAll(): void;
}

export function createMemoryNetwork(): MemoryNetwork {
  const hosts = new Map<string, (conn: HostSide) => void>();
  const live: { close(): void }[] = [];
  return {
    host(code) {
      let accept: (conn: HostSide) => void = () => {};
      hosts.set(code, (c) => accept(c));
      return {
        code,
        onConnection: (fn) => {
          accept = fn;
        },
        close: () => {
          hosts.delete(code);
        },
      };
    },
    connect: async (code) => {
      const accept = hosts.get(code);
      if (!accept) throw new NetError('notFound');
      const [hostSide, clientSide] = pipePair<ClientMessage, HostMessage>();
      live.push(hostSide);
      accept(hostSide);
      return clientSide as ClientSide;
    },
    dropAll() {
      for (const c of live.splice(0)) c.close();
    },
  };
}
