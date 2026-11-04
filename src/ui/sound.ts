// 効果音。素材は public/assets/se/ に置く（一覧は docs/assets.md）。
// スマホでいきなり鳴らないよう、最初は音オフ。オン・オフはこの端末に覚えておく。
// 音が重なっても途切れないよう、Web Audio で鳴らす。読み込めない音は鳴らさないだけ。

import type { GameEvent } from '../core/types';

export type SoundName =
  | 'dice'
  | 'step'
  | 'card'
  | 'attack'
  | 'guard'
  | 'trap'
  | 'draw'
  | 'coin'
  | 'gate_fail'
  | 'gate_pass'
  | 'turn'
  | 'goal'
  | 'click';

const NAMES: SoundName[] = ['dice', 'step', 'card', 'attack', 'guard', 'trap', 'draw', 'coin', 'gate_fail', 'gate_pass', 'turn', 'goal', 'click'];

/** 長い素材の、頭のほうだけを鳴らす秒数（step.mp3 は足音が何歩も続くので最初の1歩だけ使う） */
const CLIP_SECONDS: Partial<Record<SoundName, number>> = { step: 0.3 };

/** 音ごとの音量（0〜1）。何度も鳴る音は控えめにする */
const VOLUME: Partial<Record<SoundName, number>> = { step: 0.5, click: 0.6 };

/** 同じ音をこれより短い間隔で鳴らさない（同時に起きたできごとで二重に鳴らないように） */
const MIN_INTERVAL_MS = 120;

const STORAGE_KEY = 'spell-road.sound';

const BASE = `${import.meta.env.BASE_URL}assets/se/`;

let ctx: AudioContext | null = null;
const buffers = new Map<SoundName, AudioBuffer>();
const lastPlayed = new Map<SoundName, number>();
let enabled = readSetting();
let loading: Promise<void> | null = null;
const listeners = new Set<(on: boolean) => void>();

function readSetting(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function isSoundOn(): boolean {
  return enabled;
}

/** 音のオン・オフを切り替える。ボタンを押したときに呼ぶ（スマホはタップの中でないと音を出せない） */
export function setSound(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // 保存できなくても、この画面の間は切り替わる
  }
  if (on) unlock();
  for (const fn of listeners) fn(on);
}

export function onSoundChange(fn: (on: boolean) => void): void {
  listeners.add(fn);
}

/**
 * 音を出せる状態にする。スマホのブラウザは、画面をタップした瞬間にしか音の準備ができないので、
 * タップのたびに呼んでおく。
 */
export function unlock(): void {
  if (!enabled) return;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  loading ??= loadAll(ctx);
}

async function loadAll(audio: AudioContext): Promise<void> {
  await Promise.all(
    NAMES.map(async (name) => {
      try {
        const res = await fetch(`${BASE}${name}.mp3`);
        if (!res.ok) return;
        buffers.set(name, await audio.decodeAudioData(await res.arrayBuffer()));
      } catch {
        // 読み込めない音は鳴らさない
      }
    }),
  );
}

export function play(name: SoundName): void {
  if (!enabled || !ctx) return;
  const buffer = buffers.get(name);
  if (!buffer) return;
  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -Infinity) < MIN_INTERVAL_MS) return;
  lastPlayed.set(name, now);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  const volume = VOLUME[name] ?? 1;
  gain.gain.value = volume;
  source.connect(gain).connect(ctx.destination);
  const clip = CLIP_SECONDS[name];
  if (clip) {
    // 切ったところでプツッと鳴らないよう、最後を少しずつ小さくする
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(volume, t + clip * 0.6);
    gain.gain.linearRampToValueAtTime(0, t + clip);
    source.start(0, 0, clip);
  } else {
    source.start();
  }
}

/** できごとに合わせて鳴らす音。prev は1つ前のできごと（続けて同じような音が鳴らないように使う） */
export function soundForEvent(e: GameEvent, prev: GameEvent | undefined, me: number): SoundName | null {
  switch (e.type) {
    case 'roll':
      return 'dice';
    case 'step':
      return 'step';
    case 'cardPlayed':
      return 'card';
    case 'countered':
      return 'guard';
    case 'pushedBack':
      // 罠を踏んだときは罠の音だけにする
      return prev?.type === 'trapTriggered' ? null : 'attack';
    case 'statusApplied':
    case 'stolen':
      return 'attack';
    case 'trapTriggered':
      return 'trap';
    case 'draw':
      return 'draw';
    case 'exchanged':
      return e.swapped ? 'draw' : null;
    case 'coin':
      return 'coin';
    case 'gateFail':
      return 'gate_fail';
    case 'gateBroken':
      return 'gate_pass';
    case 'gatePass':
      return prev?.type === 'gateBroken' ? null : 'gate_pass';
    case 'turnStart':
      return e.player === me ? 'turn' : null;
    case 'gameOver':
      return 'goal';
    default:
      return null;
  }
}
