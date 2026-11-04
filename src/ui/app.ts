// HTMLのUI（タイトル・待合室・プレイヤー情報・手札・ボタン・確認画面・結果）

import Phaser from 'phaser';
import { ALL_ATTACKS, getCardDef } from '../core/cards';
import { distanceToGoal, expectedActor, isAtGate, plannedSteps } from '../core/engine';
import type { Action, CardInstance, GameEvent, GameState } from '../core/types';
import { ClientSession } from '../net/ClientSession';
import { HostSession } from '../net/HostSession';
import { connectToRoom, openRoom } from '../net/peer';
import { MAX_PLAYERS, normalizeRoomCode, type SeatInfo } from '../net/protocol';
import type { GameSession, GameView } from '../net/session';
import { NET_ERROR_TEXT, NetError } from '../net/transport';
import { BoardScene, PIXEL_RATIO } from '../scenes/BoardScene';
import { ASSET, img, imgChain } from './assets';
import { moodByEvent, moodByRank, type Expression } from './expression';
import { isSoundOn, onSoundChange, play, playBgm, setSound, soundForEvent, unlock } from './sound';
import { describeEvent } from './text';
import { ATTRIBUTE_STYLE, PLAYER_COLORS, PLAYER_ICONS, TIMING_LABEL } from './theme';

/** この端末（ブラウザのタブ）の目印。つなぎ直したときに同じ席に戻るために使う */
function clientId(): string {
  const key = 'spell-road.clientId';
  try {
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

const LAST_ROOM_KEY = 'spell-road.room';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** プレイヤーの顔（キャラクターの画像。無ければ絵文字） */
const face = (player: number, cls = 'face') => img(ASSET.chara(player), PLAYER_ICONS[player], cls);
/** 使われたカードを表示しておく時間 */
const CARD_SHOW_MS = { cpu: 2400, human: 1000 };
/** サイコロが転がっている時間 */
const DICE_ROLL_MS = 650;

// サイコロの絵を先に読み込んでおく（転がしている間に絵が欠けないように）
for (let n = 1; n <= 6; n++) new Image().src = ASSET.dice(n);

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: { class?: string; text?: string; style?: string } = {},
  children: (HTMLElement | string)[] = [],
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (attrs.class) e.className = attrs.class;
  if (attrs.text) e.textContent = attrs.text;
  if (attrs.style) e.setAttribute('style', attrs.style);
  e.append(...children);
  return e;
}

function button(label: string | (HTMLElement | string)[], onClick: () => void, cls = ''): HTMLButtonElement {
  const b = typeof label === 'string' ? el('button', { class: `btn ${cls}`, text: label }) : el('button', { class: `btn ${cls}` }, label);
  b.addEventListener('click', onClick);
  return b;
}

export class App implements GameView {
  private scene = new BoardScene();
  private phaser: Phaser.Game | null = null;
  private session: GameSession | null = null;
  /** いま開いている確認画面の種類（操作できなくなったら閉じるため） */
  private modalKind: 'card' | 'prompt' | 'result' | 'notice' | null = null;
  private messages: string[] = [];
  /** 手番のキャラクターの、できごとに反応した表情（次の手番まで続く） */
  private speakerMood: { player: number; expr: Expression } | null = null;
  /** 確認画面の中で選んでいるもの（交換・捨てるカード） */
  private selection: number[] = [];

  /** 自分の席 */
  private get me(): number {
    return this.session?.me ?? 0;
  }

  /** 自分が今できる操作 */
  private myLegal(_s?: GameState): Action[] {
    return this.session?.legal ?? [];
  }

  init(): void {
    this.initSound();
    playBgm('title');
    let cpuCount = 3;
    this.segmented($('#cpu-count'), [1, 2, 3], cpuCount, (n) => (cpuCount = n));
    const name = () => $<HTMLInputElement>('#player-name').value.trim() || 'あなた';
    // 通信対戦では、名前が「あなた」のままだと他の人の画面で紛らわしいので、ホストが「プレイヤー2」などの名前をつける
    const onlineName = () => (name() === 'あなた' ? '' : name());
    $('#start').addEventListener('click', () => void this.startSolo(name(), cpuCount));
    $('#create-room').addEventListener('click', () => void this.createRoom(onlineName()));
    $('#join-room').addEventListener('click', () => void this.joinRoom(onlineName()));
    const codeInput = $<HTMLInputElement>('#room-code');
    try {
      codeInput.value = sessionStorage.getItem(LAST_ROOM_KEY) ?? '';
    } catch {
      // 保存できない環境では何もしない
    }
    codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.joinRoom(onlineName());
    });
    $('#lobby-leave').addEventListener('click', () => this.leave());
    setInterval(() => this.renderClock(), 250);
  }

  /** 選択肢のボタンを並べる（1つだけ選べる） */
  private segmented(box: HTMLElement, values: number[], selected: number, onSelect: (n: number) => void): void {
    box.replaceChildren(
      ...values.map((n) => {
        const b = button(`${n}人`, () => {
          onSelect(n);
          box.querySelectorAll('button').forEach((x) => x.classList.toggle('selected', x === b));
        });
        if (n === selected) b.classList.add('selected');
        return b;
      }),
    );
  }

  // ============================================================
  // 1人プレイ・部屋を作る・部屋に入る
  // ============================================================

  private async startSolo(name: string, cpuCount: number): Promise<void> {
    await this.showGameScreen();
    const host = new HostSession(name, this, null, { onGameStart: (s) => this.onGameStart(s) });
    this.session = host;
    await host.startGame(cpuCount);
  }

  private async createRoom(name: string): Promise<void> {
    this.setTitleBusy('部屋を作っています…');
    try {
      const transport = await openRoom();
      const host = new HostSession(name, this, transport, {
        onLobby: (seats) => this.renderLobby(seats, 0),
        onGameStart: (s) => this.onGameStart(s),
      });
      this.session = host;
      this.setTitleBusy(null);
      this.showLobby(transport.code);
      this.renderLobby(host.seats, 0);
    } catch (e) {
      this.setTitleBusy(null, e instanceof NetError ? NET_ERROR_TEXT[e.kind] : '部屋を作れませんでした。');
    }
  }

  private async joinRoom(name: string): Promise<void> {
    const code = normalizeRoomCode($<HTMLInputElement>('#room-code').value);
    if (!code) {
      this.setTitleBusy(null, '部屋コード（5文字）を入れてください。');
      return;
    }
    this.setTitleBusy('つないでいます…');
    const client = new ClientSession(connectToRoom, code, name, clientId(), this, {
      onLobby: (seats, you) => this.renderLobby(seats, you),
      onGameStart: (s) => this.onGameStart(s),
      onStatus: (text) => this.setNetStatus(text),
      onEnd: (text) => this.leave(text),
    });
    try {
      await client.start();
    } catch (e) {
      this.setTitleBusy(null, e instanceof NetError ? NET_ERROR_TEXT[e.kind] : 'つながりませんでした。');
      return;
    }
    try {
      sessionStorage.setItem(LAST_ROOM_KEY, code);
    } catch {
      // 保存できない環境では何もしない
    }
    this.session = client;
    this.setTitleBusy(null);
    this.showLobby(code);
  }

  /** タイトル画面のボタンを押せなくして、状況を出す。text が null なら元に戻す */
  private setTitleBusy(text: string | null, error = ''): void {
    $('#title').querySelectorAll<HTMLButtonElement>('.title-panel .btn').forEach((b) => (b.disabled = text !== null));
    const msg = $('#title-message');
    msg.textContent = text ?? error;
    msg.classList.toggle('error', !!error);
  }

  private showScreen(id: 'title' | 'lobby' | 'game'): void {
    for (const s of ['title', 'lobby', 'game']) $(`#${s}`).classList.toggle('hidden', s !== id);
  }

  private showLobby(code: string): void {
    this.showScreen('lobby');
    $('#lobby-code').textContent = code;
  }

  /** 待合室の顔ぶれ。ホストならCPUの人数を選んで始められる */
  private renderLobby(seats: SeatInfo[], you: number): void {
    if (!this.session || this.session.state) return;
    $('#lobby-seats').replaceChildren(
      ...seats.map((s, i) =>
        el('li', { style: `--pc:${PLAYER_COLORS[i]}` }, [
          face(i),
          el('span', { class: 'lobby-name', text: s.name }),
          el('span', { class: 'lobby-tag', text: [s.host ? 'ホスト' : '', i === you ? 'あなた' : ''].filter(Boolean).join('・') }),
        ]),
      ),
    );
    const host = this.session instanceof HostSession ? this.session : null;
    $('#lobby-leave').textContent = host ? '部屋を閉じる' : '部屋を出る';
    const controls = $('#lobby-controls');
    if (!host) {
      controls.replaceChildren(el('p', { class: 'note', text: 'ホストがゲームを始めるのを待っています…' }));
      return;
    }
    const humans = seats.length;
    const options = Array.from({ length: MAX_PLAYERS - humans + 1 }, (_, i) => i).filter((n) => humans + n >= 2);
    let cpu = Number(controls.dataset.cpu ?? MAX_PLAYERS - humans);
    if (!options.includes(cpu)) cpu = options[options.length - 1];
    controls.dataset.cpu = String(cpu);
    const counts = el('div', { class: 'segmented' });
    this.segmented(counts, options, cpu, (n) => (controls.dataset.cpu = String(n)));
    controls.replaceChildren(
      el('div', { class: 'field' }, [el('span', { text: 'CPUの人数（足りない席を埋める）' }), counts]),
      button(
        'ゲーム開始',
        () => {
          void this.showGameScreen().then(() => host.startGame(Number(controls.dataset.cpu)));
        },
        'primary big',
      ),
    );
  }

  /** ゲームが始まった（もう一度、つなぎ直して途中から、も含む） */
  private async onGameStart(state: GameState): Promise<void> {
    await this.showGameScreen();
    this.scene.setup(state);
    this.messages = [];
    this.pushMessage(`${state.players[state.current].name}のターン`);
    this.hideModal();
  }

  /** 部屋を出てタイトルに戻る。text があれば知らせる */
  private leave(text?: string): void {
    this.session?.stop();
    this.session = null;
    this.setNetStatus(null);
    this.hideModal();
    delete $('#lobby-controls').dataset.cpu;
    this.showScreen('title');
    this.setTitleBusy(null);
    playBgm('title');
    if (text) {
      this.showModal([el('p', { text }), el('div', { class: 'choices' }, [button('OK', () => this.hideModal(), 'primary')])], 'notice');
    }
  }

  /** 通信の状態（つなぎ直し中など）を画面の上に出す */
  private setNetStatus(text: string | null): void {
    const bar = $('#net-status');
    bar.classList.toggle('hidden', !text);
    bar.textContent = text ?? '';
  }

  private async showGameScreen(): Promise<void> {
    this.showScreen('game');
    playBgm('forest');
    this.hideModal();
    this.messages = [];
    const speaker = $('#speaker');
    delete speaker.dataset.key;
    delete speaker.dataset.player;
    this.speakerMood = null;

    if (!this.phaser) {
      const boardEl = $('#board');
      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: boardEl,
        backgroundColor: '#bfe3b4',
        // 内部は画素密度ぶん大きく描き、表示は元の大きさに縮める（スマホでぼやけないように）
        scale: {
          mode: Phaser.Scale.NONE,
          width: boardEl.clientWidth * PIXEL_RATIO,
          height: boardEl.clientHeight * PIXEL_RATIO,
          zoom: 1 / PIXEL_RATIO,
        },
        scene: [this.scene],
      });
      // 手札の量などでボードの表示領域の大きさが変わるので、そのたびに合わせる
      new ResizeObserver(() => this.fitBoard()).observe(boardEl);
      this.phaser = game;
    }
    // ボードの準備（Phaserの起動）は待たない。画面が裏に回っていると起動しないため。
    // 起動前に届いた状態は BoardScene が覚えておき、起動したときに描く
  }

  // ============================================================
  // GameView
  // ============================================================

  async playEvents(events: GameEvent[], state: GameState): Promise<void> {
    let prev: GameEvent | undefined;
    for (const e of events) {
      const sound = soundForEvent(e, prev, this.me);
      if (sound) play(sound);
      prev = e;
      const text = describeEvent(e, state);
      if (text) this.pushMessage(text);
      if (e.type === 'turnStart') this.speakerMood = null;
      else this.reactSpeaker(e, state);
      if (e.type === 'roll') await this.showDice(e.dice, e.value);
      else if (e.type === 'cardPlayed' || e.type === 'countered') await this.showCardUse(e, state);
      else if (e.type === 'step' || e.type === 'pushedBack' || e.type === 'swapped') await this.scene.animate(e);
      else if (e.type === 'turnStart') {
        this.showSpeaker(e.player, state);
        void this.scene.animate(e);
        await sleep(350);
      } else if (text) await sleep(420);
    }
    this.scene.placeAll(state);
  }

  render(state: GameState): void {
    if (!this.session) return;
    // 時間切れなどで操作できなくなったら、カードの説明画面は閉じる
    if (this.modalKind === 'card' && this.myLegal().length === 0) this.hideModal();
    this.renderPlayers(state);
    this.renderHand(state);
    this.renderActions(state);
    this.renderPrompt(state);
    this.renderClock();
    this.fitBoard();
  }

  /** 制限時間の表示 */
  private renderClock(): void {
    const box = $('#clock');
    const clock = this.session?.clock;
    const s = this.session?.state;
    if (!clock || !s || s.phase === 'gameOver') {
      box.classList.add('hidden');
      for (const p of document.querySelectorAll('.prompt-clock')) p.textContent = '';
      return;
    }
    const sec = Math.max(0, Math.ceil((clock.deadline - performance.now()) / 1000));
    const who = clock.player === this.me ? 'あなた' : s.players[clock.player].name;
    const what = clock.kind === 'counter' ? 'カウンターの確認' : '';
    box.textContent = `⏱ ${who}${what ? `の${what}` : ''} 残り${sec}秒`;
    box.classList.remove('hidden');
    box.classList.toggle('urgent', sec <= 10 && clock.player === this.me);
    // 確認画面を開いている間も見えるように
    for (const p of document.querySelectorAll('.prompt-clock')) p.textContent = clock.player === this.me ? `残り${sec}秒` : '';
  }

  private fitBoard(): void {
    const scale = this.phaser?.scale;
    const boardEl = $('#board');
    const w = Math.floor(boardEl.clientWidth * PIXEL_RATIO);
    const h = Math.floor(boardEl.clientHeight * PIXEL_RATIO);
    if (!scale || (scale.width === w && scale.height === h)) return;
    scale.resize(w, h);
  }

  // ============================================================
  // 表示
  // ============================================================

  private pushMessage(text: string): void {
    this.messages.push(text);
    this.messages = this.messages.slice(-3);
    const box = $('#message');
    box.replaceChildren(...this.messages.map((m, i) => el('div', { class: i === this.messages.length - 1 ? 'latest' : '', text: m })));
  }

  /** 音のオン・オフのボタンと、ボタンを押したときの音 */
  private initSound(): void {
    const toggles = [$('#sound-title'), $('#sound-game')];
    const update = (on: boolean) => {
      for (const t of toggles) {
        t.textContent = on ? '🔊' : '🔇';
        t.title = on ? '音をオフにする' : '音をオンにする';
        t.setAttribute('aria-label', t.title);
        t.classList.toggle('on', on);
      }
    };
    for (const t of toggles) t.addEventListener('click', () => setSound(!isSoundOn()));
    onSoundChange(update);
    update(isSoundOn());
    // スマホはタップの瞬間にしか音の準備ができないので、タップのたびに準備しておく
    document.addEventListener('pointerdown', unlock, { capture: true });
    document.addEventListener(
      'click',
      (ev) => {
        const target = ev.target as HTMLElement;
        if (target.closest('.btn, .card') && !target.closest('.sound-toggle')) play('click');
      },
      { capture: true },
    );
  }

  private async showDice(dice: number[], value: number): Promise<void> {
    const box = $('#dice');
    const faces = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    const randomFace = () => 1 + Math.floor(Math.random() * 6);
    const dieEls = dice.map(() => img(ASSET.dice(randomFace()), faces[randomFace()], 'dice-face'));
    const wraps = dieEls.map((d) => el('div', { class: 'die rolling' }, [d]));
    const valueEl = el('div', { class: 'dice-value', text: String(value) });
    valueEl.style.visibility = 'hidden';
    box.replaceChildren(el('div', { class: 'dice-faces' }, wraps), valueEl);
    box.classList.remove('hidden');

    // その場で回しながら目を次々に変え、最後に出た目でピタッと止める
    const setFace = (i: number, n: number) => {
      const node = wraps[i].firstElementChild as HTMLElement;
      if (node instanceof HTMLImageElement) node.src = ASSET.dice(n);
      else node.textContent = faces[n];
    };
    const shuffle = setInterval(() => wraps.forEach((_, i) => setFace(i, randomFace())), 80);
    await sleep(DICE_ROLL_MS);
    clearInterval(shuffle);
    dice.forEach((d, i) => {
      setFace(i, d);
      wraps[i].classList.replace('rolling', 'landed');
    });
    valueEl.style.visibility = '';
    await sleep(700);
    box.classList.add('hidden');
  }

  /** 使われたカードを大きく見せる。CPUのカードは読めるように長めに出す（タップで閉じられる） */
  private async showCardUse(e: Extract<GameEvent, { type: 'cardPlayed' | 'countered' }>, s: GameState): Promise<void> {
    let result: (HTMLElement | string)[] = [];
    if (e.type === 'cardPlayed' && e.target !== undefined) result = ['→ ', face(e.target), `${s.players[e.target].name}に`];
    if (e.type === 'cardPlayed' && ALL_ATTACKS[e.cardId]) result = ['→ 自分以外の全員に'];
    if (e.type === 'countered') result = [`${s.players[e.attacker].name}の攻撃を${e.reflected ? 'はね返した！' : '防いだ！'}`];

    const box = $('#cast');
    box.replaceChildren(
      el('div', { class: 'cast-body', style: `--pc:${PLAYER_COLORS[e.player]}` }, [
        el('div', { class: 'cast-who' }, [face(e.player, 'face big'), `${s.players[e.player].name}の魔法！`]),
        this.cardElement({ uid: -1, cardId: e.cardId }, 'large'),
        el('p', { class: 'card-text', text: getCardDef(e.cardId).text }),
        ...(result.length ? [el('div', { class: 'cast-result' }, result)] : []),
        el('div', { class: 'cast-skip', text: 'タップで次へ' }),
      ]),
    );
    box.classList.remove('hidden');
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        box.removeEventListener('click', done);
        resolve();
      };
      const timer = setTimeout(done, e.player === this.me ? CARD_SHOW_MS.human : CARD_SHOW_MS.cpu);
      box.addEventListener('click', done);
    });
    box.classList.add('hidden');
  }

  private renderPlayers(s: GameState): void {
    const seats = this.session?.seats ?? [];
    const chips = s.players.map((p) => {
      const away = seats[p.index]?.kind === 'human' && !seats[p.index].connected;
      const chip = el('div', { class: `chip ${p.index === s.current ? 'current' : ''} ${away ? 'away' : ''}`, style: `--pc:${PLAYER_COLORS[p.index]}` }, [
        face(p.index, 'chip-icon'),
        el('span', { class: 'chip-name', text: p.name }),
        ...(away ? [el('span', { class: 'chip-away', text: '切断中' })] : []),
        el('span', { class: 'chip-info' }, [
          ...(p.statuses.rest ? [img(ASSET.statusRest, '💤', 'chip-status')] : []),
          ...(p.statuses.frost ? [img(ASSET.statusFrost, '❄️', 'chip-status')] : []),
          ...(p.statuses.blizzard ? [img(ASSET.statusBlizzard, '🌨️', 'chip-status')] : []),
          ...(p.statuses.sealed ? [img(ASSET.statusSeal, '🔒', 'chip-status')] : []),
          ...(p.statuses.protected ? [img(ASSET.statusGuard, '✨', 'chip-status')] : []),
          img(ASSET.cardBack, '🃏', 'chip-card'),
          `${p.hand.length} 残り${distanceToGoal(s, p)}`,
        ]),
      ]);
      return chip;
    });
    $('#players').replaceChildren(...chips);
    this.showSpeaker(s.current, s);
  }

  /**
   * メッセージ窓の上に、手番のキャラクターのバストアップを出す。
   * 表情は、手番の間に起きたできごと（カードを使った・攻撃を受けた）を優先し、なければ順位で決める。
   */
  private showSpeaker(player: number, s: GameState): void {
    const expr = this.speakerMood?.player === player ? this.speakerMood.expr : moodByRank(s, player);
    const box = $('#speaker');
    const key = `${player}:${expr}`;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.dataset.player = String(player);
    box.dataset.expr = expr;
    box.style.setProperty('--pc', PLAYER_COLORS[player]);
    // 表情の絵 → ふつうの顔のバストアップ → 全身の絵を切り抜いたもの → 絵文字、の順に試す
    const pic = imgChain(
      [
        ...(expr === 'normal' ? [] : [{ src: ASSET.bust(player, expr), cls: 'speaker-img' }]),
        { src: ASSET.bust(player, 'normal'), cls: 'speaker-img' },
        { src: ASSET.chara(player), cls: 'speaker-img crop' },
      ],
      PLAYER_ICONS[player],
      'speaker-img',
    );
    box.replaceChildren(el('div', { class: 'speaker-pic' }, [pic]), el('div', { class: 'speaker-name', text: s.players[player].name }));
  }

  /** できごとに合わせて、手番のキャラクターの表情を変える */
  private reactSpeaker(e: GameEvent, s: GameState): void {
    const player = Number($('#speaker').dataset.player);
    if (Number.isNaN(player)) return;
    const expr = moodByEvent(e, player);
    if (!expr) return;
    this.speakerMood = { player, expr };
    this.showSpeaker(player, s);
  }

  private renderHand(s: GameState): void {
    const me = s.players[this.me];
    const playable = new Set(this.myLegal(s).filter((a) => a.type === 'playCard').map((a) => (a as { uid: number }).uid));
    const cards = me.hand.map((c) => {
      const node = this.cardElement(c, playable.has(c.uid) ? 'playable' : '');
      node.addEventListener('click', () => this.openCard(s, c));
      return node;
    });
    if (cards.length === 0) cards.push(el('div', { class: 'empty-hand', text: '手札はありません' }));
    $('#hand').replaceChildren(...cards);
  }

  private renderActions(s: GameState): void {
    const box = $('#actions');
    if (s.phase === 'gameOver') {
      box.replaceChildren();
      return;
    }
    const legal = this.myLegal(s);
    if (legal.length === 0 || s.pending) {
      const actor = expectedActor(s);
      const who = actor === null ? '' : `${s.players[actor].name}が考え中…`;
      box.replaceChildren(el('div', { class: 'waiting', text: actor === this.me ? '' : who }));
      return;
    }

    const buttons: HTMLElement[] = [];
    const me = s.players[this.me];
    for (const a of legal) {
      if (a.type === 'roll') {
        const hint = isAtGate(s, me) ? this.gateHint(s) : '';
        buttons.push(button('🎲 サイコロを振る', () => this.act(a), 'primary'));
        if (hint) buttons.unshift(el('div', { class: 'hint', text: hint }));
      }
      if (a.type === 'confirmMove') {
        const v = s.turn.value!;
        const label = isAtGate(s, me) ? `出目 ${v} で関所に挑む` : `${plannedSteps(s)}マス進む${me.statuses.blizzard ? '（吹雪で半分）' : ''}`;
        if (isAtGate(s, me)) buttons.push(el('div', { class: 'hint', text: this.gateHint(s) }));
        buttons.push(button(label, () => this.act(a), 'primary'));
      }
      if (a.type === 'endTurn') buttons.push(button('ターン終了', () => this.act(a), 'primary'));
    }
    const canPlay = legal.some((a) => a.type === 'playCard');
    if (canPlay) buttons.push(el('div', { class: 'hint', text: '光っているカードを使えます' }));
    else if (s.turn.isExtra) buttons.push(el('div', { class: 'hint', text: '時間停止の追加ターン（カードは使えない）' }));
    else if (me.statuses.sealed && me.hand.length > 0) buttons.push(el('div', { class: 'hint', text: '封印されていて、カードを使えない' }));
    box.replaceChildren(...buttons);
  }

  private gateHint(s: GameState): string {
    const me = s.players[this.me];
    const node = s.board.nodes.find((n) => n.id === me.trail[me.trail.length - 1])!;
    if (s.turn.gateBroken) return '封印が砕けている！ 今回は必ず通れる';
    const cracks = me.gateCracks[node.id] ?? 0;
    return `関所: ${node.gate!.pass.join('・')}で通過（ひび${cracks}/3）`;
  }

  // ============================================================
  // カード
  // ============================================================

  private cardElement(c: CardInstance, extra = ''): HTMLElement {
    const def = getCardDef(c.cardId);
    const attr = ATTRIBUTE_STYLE[def.attribute];
    return el('div', { class: `card ${extra}`, style: `--ac:${attr.color}` }, [
      el('div', { class: 'card-head' }, [
        img(ASSET.attr(def.attribute), attr.name, 'card-attr'),
        el('span', { class: 'card-rarity', text: '★'.repeat(def.rarity) }),
      ]),
      img(ASSET.card(c.cardId), '', 'card-art'),
      el('div', { class: 'card-name', text: def.name }),
      el('div', { class: 'card-timing', text: def.timings.map((t) => TIMING_LABEL[t]).join('/') }),
    ]);
  }

  /** カードの説明と、使う場合の選択肢 */
  private openCard(s: GameState, c: CardInstance): void {
    if (s.pending) return;
    const def = getCardDef(c.cardId);
    const variants = this.myLegal(s).filter(
      (a): a is Extract<Action, { type: 'playCard' }> => a.type === 'playCard' && a.uid === c.uid,
    );
    const body: HTMLElement[] = [
      this.cardElement(c, 'large'),
      el('p', { class: 'card-text', text: def.text }),
      el('p', { class: 'card-sub', text: `使えるとき: ${def.timings.map((t) => TIMING_LABEL[t]).join('・')}${def.usableAtGate ? '' : '（関所では使えない）'}` }),
    ];
    const choices = el('div', { class: 'choices' });
    // 闇の取引は、先に渡すカードを選んでから相手を選ぶ
    let shown = variants;
    if (c.cardId === 'yami_no_torihiki' && variants.length > 0) {
      const giveUids = [...new Set(variants.map((v) => v.choice!))];
      const give = giveUids.includes(this.selection[0]) ? this.selection[0] : undefined;
      body.push(
        el('p', { class: 'card-sub', text: '渡すカードを選んでください' }),
        el('div', { class: 'card-row' }, s.players[this.me].hand.filter((h) => giveUids.includes(h.uid)).map((h) => {
          const node = this.cardElement(h, give === h.uid ? 'selected' : '');
          node.addEventListener('click', () => {
            this.selection = [h.uid];
            this.openCard(s, c);
          });
          return node;
        })),
      );
      shown = give === undefined ? [] : variants.filter((v) => v.choice === give);
      if (give === undefined) choices.append(el('p', { class: 'card-sub', text: 'カードを選ぶと、相手を選べます' }));
    }
    for (const v of shown) {
      let label = '使う';
      let content: (HTMLElement | string)[] | null = null;
      if (v.target !== undefined) {
        // 相手を選ぶときの手がかりに、ゴールまでの残りマス数と手札の枚数を見せる
        const t = s.players[v.target];
        content = [
          face(v.target),
          el('span', { class: 'target-label' }, [
            el('span', { text: `${t.name}に使う` }),
            el('span', { class: 'target-info', text: `ゴールまで${distanceToGoal(s, t)}マス・手札${t.hand.length}枚` }),
          ]),
        ];
      }
      if (v.choice !== undefined && c.cardId !== 'yami_no_torihiki') label = c.cardId === 'unmei_no_hari' ? `出目を${v.choice > 0 ? '+1' : '-1'}（→ ${Math.max(1, s.turn.value! + v.choice)}）` : `出目を ${v.choice} にする`;
      choices.append(
        button(content ?? label, () => {
          this.selection = [];
          this.hideModal();
          this.act(v);
        }, 'primary'),
      );
    }
    if (variants.length === 0) body.push(el('p', { class: 'card-sub', text: '今は使えません' }));
    body.push(choices, button('閉じる', () => {
      this.selection = [];
      this.hideModal();
    }));
    this.showModal(body, 'card');
  }

  // ============================================================
  // 確認画面（カウンター・交換・捨てる・結果）
  // ============================================================

  private renderPrompt(s: GameState): void {
    if (s.phase === 'gameOver') {
      if (!this.session!.busy) this.showResult(s);
      return;
    }
    const pd = s.pending;
    if (!pd || this.myLegal().length === 0) {
      // 時間切れなどで、答える前に先へ進んだ
      if (this.modalKind === 'prompt') this.hideModal();
      return;
    }
    const me = s.players[this.me];

    if (pd.kind === 'counter') {
      const title =
        pd.source === 'trap'
          ? `${pd.effect.kind === 'trap' && pd.effect.trap === 'ice' ? '氷' : '炎'}の罠を踏んだ！`
          : `${s.players[pd.attacker].name}の「${getCardDef(pd.cardId).name}」！`;
      const counters = this.myLegal(s).filter((a): a is Extract<Action, { type: 'counter' }> => a.type === 'counter');
      this.showPrompt([
        el('h2', { text: title }),
        el('p', { text: 'カウンターしますか？' }),
        el('div', { class: 'choices' }, [
          ...counters.map((a) => {
            const name = getCardDef(me.hand.find((h) => h.uid === a.uid)!.cardId).name;
            return button(`「${name}」を使う`, () => this.actFromModal(a), 'primary');
          }),
          button('使わない', () => this.actFromModal({ type: 'noCounter', player: this.me })),
        ]),
      ]);
      return;
    }

    if (pd.kind === 'exchange') {
      const [offerSel, handSel] = [this.selection[0], this.selection[1]];
      const offerRow = el('div', { class: 'card-row' }, pd.offer.map((c) => {
        const node = this.cardElement(c, offerSel === c.uid ? 'selected' : '');
        node.addEventListener('click', () => {
          this.selection = [c.uid, handSel];
          this.renderPrompt(s);
        });
        return node;
      }));
      const handRow = el('div', { class: 'card-row' }, me.hand.map((c) => {
        const node = this.cardElement(c, handSel === c.uid ? 'selected' : '');
        node.addEventListener('click', () => {
          this.selection = [offerSel, c.uid];
          this.renderPrompt(s);
        });
        return node;
      }));
      const ok = button('交換する', () => this.actFromModal({ type: 'exchange', player: this.me, offerUid: offerSel, handUid: handSel }), 'primary');
      ok.disabled = offerSel === undefined || handSel === undefined;
      this.showPrompt([
        el('h2', { text: 'カード交換' }),
        el('p', { text: 'もらうカード' }),
        offerRow,
        el('p', { text: '渡すカード' }),
        handRow,
        el('div', { class: 'choices' }, [ok, button('交換しない', () => this.actFromModal({ type: 'declineExchange', player: this.me }))]),
      ]);
      return;
    }

    if (pd.kind === 'discard') {
      const row = el('div', { class: 'card-row' }, me.hand.map((c) => {
        const node = this.cardElement(c, this.selection.includes(c.uid) ? 'selected' : '');
        node.addEventListener('click', () => {
          this.selection = this.selection.includes(c.uid)
            ? this.selection.filter((u) => u !== c.uid)
            : [...this.selection, c.uid].slice(-pd.count);
          this.renderPrompt(s);
        });
        return node;
      }));
      const ok = button('捨てる', () => this.actFromModal({ type: 'discard', player: this.me, uids: this.selection }), 'primary');
      ok.disabled = this.selection.length !== pd.count;
      this.showPrompt([
        el('h2', { text: '手札が多すぎます' }),
        el('p', { text: `${pd.count}枚選んで捨ててください` }),
        row,
        el('div', { class: 'choices' }, [ok]),
      ]);
    }
  }

  private showResult(s: GameState): void {
    const r = s.result!;
    if (this.modalKind === 'result') return;
    const order = [...s.players].sort((a, b) => r.ranks[a.index] - r.ranks[b.index]);
    const session = this.session!;
    const host = session instanceof HostSession ? session : null;
    const online = !host || host.code !== null;
    playBgm('result');
    const choices = host
      ? [
          button('もう一度', () => void host.startGame(session.seats.filter((x) => x.kind === 'cpu').length), 'primary'),
          button(online ? '部屋を閉じてタイトルへ' : 'タイトルへ', () => this.leave()),
        ]
      : [el('p', { class: 'note', text: 'ホストが「もう一度」を押すと、次のゲームが始まります' }), button('部屋を出る', () => this.leave())];
    this.showModal([
      el('h2', { text: r.winner === this.me ? '🎉 1位でゴール！' : `${s.players[r.winner].name}がゴール！` }),
      el('ol', { class: 'ranking' }, order.map((p) =>
        el('li', {}, [
          el('span', { class: 'rank', text: `${r.ranks[p.index]}位` }),
          face(p.index),
          p.name,
          el('span', { class: 'rest', text: p.index === r.winner ? 'ゴール' : `残り${distanceToGoal(s, p)}マス` }),
        ]),
      )),
      el('div', { class: 'choices' }, choices),
    ], 'result');
  }

  // ============================================================
  // 小さな道具
  // ============================================================

  private act(a: Action): void {
    this.session?.act(a);
  }

  private actFromModal(a: Action): void {
    this.selection = [];
    this.hideModal();
    this.act(a);
  }

  private showModal(children: HTMLElement[], kind: NonNullable<App['modalKind']>): void {
    $('#modal-body').replaceChildren(...children);
    $('#modal').classList.remove('hidden');
    this.modalKind = kind;
  }

  /** 操作を求める確認画面（カウンター・交換・捨てる）。制限時間も一緒に見せる */
  private showPrompt(children: HTMLElement[]): void {
    this.showModal([...children, el('div', { class: 'prompt-clock', text: '' })], 'prompt');
    this.renderClock();
  }

  private hideModal(): void {
    $('#modal').classList.add('hidden');
    this.modalKind = null;
  }
}
