// PeerJS（WebRTC）での通信。最初の接続だけ PeerJS の公開仲介サーバーを使い、
// その後は端末どうしで直接やり取りする（docs/spec.md 6.2）。

import { Peer, type DataConnection } from 'peerjs';
import { makeRoomCode } from './protocol';
import { NetError, type Connection, type ConnectToHost, type HostSide, type HostTransport } from './transport';

/** 仲介サーバーで使う名前の頭。他のアプリと名前がぶつからないようにする */
const ID_PREFIX = 'spell-road-v1-';
/** ホストにつながるまで待つ時間 */
const CONNECT_TIMEOUT_MS = 15_000;

function errorType(err: unknown): string {
  return (err as { type?: string })?.type ?? '';
}

/** 仲介サーバーに登録する。id を省くと、仲介サーバーが名前を決める */
function openPeer(id?: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, { debug: 1 }) : new Peer({ debug: 1 });
    const fail = (err: unknown) => {
      peer.destroy();
      reject(err);
    };
    peer.once('open', () => {
      peer.off('error', fail);
      resolve(peer);
    });
    peer.once('error', fail);
  });
}

/** PeerJS のつながりを、このゲームの Connection の形にする */
function wrap<In, Out>(dc: DataConnection, onClosed: () => void = () => {}): Connection<In, Out> {
  const closeHandlers: (() => void)[] = [];
  let closed = false;
  const fireClose = () => {
    if (closed) return;
    closed = true;
    for (const fn of closeHandlers) fn();
    onClosed();
  };
  dc.on('close', fireClose);
  dc.on('error', fireClose);
  // 相手の端末が急に消えたとき（スマホのスリープなど）は close が来ないことがあるので、
  // 生存確認（withHeartbeat）でも切れたことに気づくようにしている
  return {
    send: (msg) => {
      if (!closed && dc.open) void dc.send(msg);
    },
    onMessage: (fn) => dc.on('data', (data) => fn(data as In)),
    onClose: (fn) => closeHandlers.push(fn),
    close: () => {
      dc.close();
      fireClose();
    },
  };
}

/** 部屋を作る。部屋コードがぶつかったら作り直す */
export async function openRoom(): Promise<HostTransport> {
  for (let attempt = 0; ; attempt++) {
    const code = makeRoomCode();
    let peer: Peer;
    try {
      peer = await openPeer(ID_PREFIX + code);
    } catch (err) {
      if (errorType(err) === 'unavailable-id' && attempt < 5) continue;
      throw new NetError('network');
    }
    let accept: (conn: HostSide) => void = () => {};
    peer.on('connection', (dc) => {
      dc.on('open', () => accept(wrap(dc)));
    });
    // 仲介サーバーとのつながりが切れても、つながっている参加者とは話せる。新しい参加者のために登録し直す
    peer.on('disconnected', () => {
      if (!peer.destroyed) peer.reconnect();
    });
    peer.on('error', (err) => console.warn('PeerJS:', errorType(err), err));
    return {
      code,
      onConnection: (fn) => {
        accept = fn;
      },
      close: () => peer.destroy(),
    };
  }
}

/** 部屋コードでホストにつなぐ */
export const connectToRoom: ConnectToHost = async (code) => {
  let peer: Peer;
  try {
    peer = await openPeer();
  } catch {
    throw new NetError('network');
  }
  return new Promise((resolve, reject) => {
    const dc = peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });
    const fail = (kind: 'notFound' | 'network' | 'timeout') => {
      clearTimeout(timer);
      peer.destroy();
      reject(new NetError(kind));
    };
    const timer = setTimeout(() => fail('timeout'), CONNECT_TIMEOUT_MS);
    peer.on('error', (err) => fail(errorType(err) === 'peer-unavailable' ? 'notFound' : 'network'));
    dc.on('open', () => {
      clearTimeout(timer);
      resolve(wrap(dc, () => peer.destroy()));
    });
  });
};
