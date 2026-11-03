// HTMLのUI（タイトル・プレイヤー情報・手札・ボタン・確認画面・結果）

import Phaser from 'phaser';
import forest from '../data/boards/forest.json';
import { buildSharedDeck, getCardDef, MVP_CARD_IDS } from '../core/cards';
import { createGame, distanceToGoal, expectedActor, getLegalActions, isAtGate } from '../core/engine';
import type { Action, BoardDef, CardInstance, GameEvent, GameState } from '../core/types';
import { BoardScene, PIXEL_RATIO } from '../scenes/BoardScene';
import { ASSET, img } from './assets';
import { LocalGame, type GameView } from './LocalGame';
import { describeEvent } from './text';
import { ATTRIBUTE_STYLE, PLAYER_COLORS, PLAYER_ICONS, TIMING_LABEL } from './theme';

const HUMAN = 0;
const CPU_NAMES = ['ルル', 'ポポ', 'ミミ'];

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** プレイヤーの顔（キャラクターの画像。無ければ絵文字） */
const face = (player: number, cls = 'face') => img(ASSET.chara(player), PLAYER_ICONS[player], cls);
/** 使われたカードを表示しておく時間 */
const CARD_SHOW_MS = { cpu: 2400, human: 1000 };

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
  private game: LocalGame | null = null;
  private messages: string[] = [];
  /** 確認画面の中で選んでいるもの（交換・捨てるカード） */
  private selection: number[] = [];

  init(): void {
    let cpuCount = 3;
    const counts = $('#cpu-count');
    for (const n of [1, 2, 3]) {
      const b = button(`${n}人`, () => {
        cpuCount = n;
        counts.querySelectorAll('button').forEach((x) => x.classList.toggle('selected', x === b));
      });
      if (n === cpuCount) b.classList.add('selected');
      counts.append(b);
    }
    $('#start').addEventListener('click', () => {
      const name = $<HTMLInputElement>('#player-name').value.trim() || 'あなた';
      void this.startGame(name, cpuCount);
    });
  }

  private async startGame(name: string, cpuCount: number): Promise<void> {
    $('#title').classList.add('hidden');
    $('#game').classList.remove('hidden');
    this.hideModal();
    this.game?.stop();
    this.messages = [];

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
    await this.scene.whenReady();

    const state = createGame({
      board: forest as BoardDef,
      players: [
        { name, isCpu: false },
        ...CPU_NAMES.slice(0, cpuCount).map((n) => ({ name: n, isCpu: true })),
      ],
      deck: buildSharedDeck(MVP_CARD_IDS),
      seed: Math.floor(Math.random() * 2 ** 31),
    });
    this.scene.setup(state);
    this.game = new LocalGame(state, HUMAN, this);
    this.pushMessage(`${state.players[state.current].name}のターン`);
    this.game.start();
  }

  // ============================================================
  // GameView
  // ============================================================

  async playEvents(events: GameEvent[], state: GameState): Promise<void> {
    for (const e of events) {
      const text = describeEvent(e, state);
      if (text) this.pushMessage(text);
      if (e.type === 'roll') await this.showDice(e.dice, e.value);
      else if (e.type === 'cardPlayed' || e.type === 'countered') await this.showCardUse(e, state);
      else if (e.type === 'step' || e.type === 'pushedBack' || e.type === 'swapped') await this.scene.animate(e);
      else if (e.type === 'turnStart') {
        void this.scene.animate(e);
        await sleep(350);
      } else if (text) await sleep(420);
    }
    this.scene.placeAll(state);
  }

  render(state: GameState): void {
    this.renderPlayers(state);
    this.renderHand(state);
    this.renderActions(state);
    this.renderPrompt(state);
    this.fitBoard();
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

  private async showDice(dice: number[], value: number): Promise<void> {
    const box = $('#dice');
    const faces = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
    box.replaceChildren(
      el('div', { class: 'dice-faces' }, dice.map((d) => img(ASSET.dice(d), faces[d], 'dice-face'))),
      el('div', { class: 'dice-value', text: String(value) }),
    );
    box.classList.remove('hidden');
    await sleep(750);
    box.classList.add('hidden');
  }

  /** 使われたカードを大きく見せる。CPUのカードは読めるように長めに出す（タップで閉じられる） */
  private async showCardUse(e: Extract<GameEvent, { type: 'cardPlayed' | 'countered' }>, s: GameState): Promise<void> {
    let result: (HTMLElement | string)[] = [];
    if (e.type === 'cardPlayed' && e.target !== undefined) result = ['→ ', face(e.target), `${s.players[e.target].name}に`];
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
      const timer = setTimeout(done, e.player === HUMAN ? CARD_SHOW_MS.human : CARD_SHOW_MS.cpu);
      box.addEventListener('click', done);
    });
    box.classList.add('hidden');
  }

  private renderPlayers(s: GameState): void {
    const chips = s.players.map((p) => {
      const chip = el('div', { class: `chip ${p.index === s.current ? 'current' : ''}`, style: `--pc:${PLAYER_COLORS[p.index]}` }, [
        face(p.index, 'chip-icon'),
        el('span', { class: 'chip-name', text: p.name }),
        el('span', { class: 'chip-info' }, [
          ...(p.statuses.rest ? [img(ASSET.statusRest, '💤', 'chip-status')] : []),
          ...(p.statuses.frost ? [img(ASSET.statusFrost, '❄️', 'chip-status')] : []),
          img(ASSET.cardBack, '🃏', 'chip-card'),
          `${p.hand.length} 残り${distanceToGoal(s, p)}`,
        ]),
      ]);
      return chip;
    });
    $('#players').replaceChildren(...chips);
  }

  private renderHand(s: GameState): void {
    const me = s.players[HUMAN];
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
    const game = this.game!;
    if (s.phase === 'gameOver') {
      box.replaceChildren();
      return;
    }
    if (!game.waitingForHuman || s.pending) {
      const actor = expectedActor(s);
      const who = actor === null ? '' : `${s.players[actor].name}が考え中…`;
      box.replaceChildren(el('div', { class: 'waiting', text: actor === HUMAN ? '' : who }));
      return;
    }

    const legal = this.myLegal(s);
    const buttons: HTMLElement[] = [];
    const me = s.players[HUMAN];
    for (const a of legal) {
      if (a.type === 'roll') {
        const hint = isAtGate(s, me) ? this.gateHint(s) : '';
        buttons.push(button('🎲 サイコロを振る', () => this.act(a), 'primary'));
        if (hint) buttons.unshift(el('div', { class: 'hint', text: hint }));
      }
      if (a.type === 'confirmMove') {
        const v = s.turn.value!;
        const label = isAtGate(s, me) ? `出目 ${v} で関所に挑む` : `${v + s.turn.moveBonus}マス進む`;
        if (isAtGate(s, me)) buttons.push(el('div', { class: 'hint', text: this.gateHint(s) }));
        buttons.push(button(label, () => this.act(a), 'primary'));
      }
      if (a.type === 'endTurn') buttons.push(button('ターン終了', () => this.act(a), 'primary'));
    }
    const canPlay = legal.some((a) => a.type === 'playCard');
    if (canPlay) buttons.push(el('div', { class: 'hint', text: '光っているカードを使えます' }));
    box.replaceChildren(...buttons);
  }

  private gateHint(s: GameState): string {
    const me = s.players[HUMAN];
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
    for (const v of variants) {
      let label = '使う';
      let content: (HTMLElement | string)[] | null = null;
      if (v.target !== undefined) content = [face(v.target), `${s.players[v.target].name}に使う`];
      if (v.choice !== undefined) label = c.cardId === 'unmei_no_hari' ? `出目を${v.choice > 0 ? '+1' : '-1'}（→ ${Math.max(1, s.turn.value! + v.choice)}）` : `出目を ${v.choice} にする`;
      choices.append(
        button(content ?? label, () => {
          this.hideModal();
          this.act(v);
        }, 'primary'),
      );
    }
    if (variants.length === 0) body.push(el('p', { class: 'card-sub', text: '今は使えません' }));
    body.push(choices, button('閉じる', () => this.hideModal()));
    this.showModal(body);
  }

  // ============================================================
  // 確認画面（カウンター・交換・捨てる・結果）
  // ============================================================

  private renderPrompt(s: GameState): void {
    if (s.phase === 'gameOver') {
      if (!this.game!.isBusy) this.showResult(s);
      return;
    }
    const pd = s.pending;
    if (!pd || !this.game!.waitingForHuman) return;
    const me = s.players[HUMAN];

    if (pd.kind === 'counter') {
      const title =
        pd.source === 'trap'
          ? '炎の罠を踏んだ！'
          : `${s.players[pd.attacker].name}の「${getCardDef(pd.cardId).name}」！`;
      const counters = this.myLegal(s).filter((a): a is Extract<Action, { type: 'counter' }> => a.type === 'counter');
      this.showModal([
        el('h2', { text: title }),
        el('p', { text: 'カウンターしますか？' }),
        el('div', { class: 'choices' }, [
          ...counters.map((a) => {
            const name = getCardDef(me.hand.find((h) => h.uid === a.uid)!.cardId).name;
            return button(`「${name}」を使う`, () => this.actFromModal(a), 'primary');
          }),
          button('使わない', () => this.actFromModal({ type: 'noCounter', player: HUMAN })),
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
      const ok = button('交換する', () => this.actFromModal({ type: 'exchange', player: HUMAN, offerUid: offerSel, handUid: handSel }), 'primary');
      ok.disabled = offerSel === undefined || handSel === undefined;
      this.showModal([
        el('h2', { text: 'カード交換' }),
        el('p', { text: 'もらうカード' }),
        offerRow,
        el('p', { text: '渡すカード' }),
        handRow,
        el('div', { class: 'choices' }, [ok, button('交換しない', () => this.actFromModal({ type: 'declineExchange', player: HUMAN }))]),
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
      const ok = button('捨てる', () => this.actFromModal({ type: 'discard', player: HUMAN, uids: this.selection }), 'primary');
      ok.disabled = this.selection.length !== pd.count;
      this.showModal([
        el('h2', { text: '手札が多すぎます' }),
        el('p', { text: `${pd.count}枚選んで捨ててください` }),
        row,
        el('div', { class: 'choices' }, [ok]),
      ]);
    }
  }

  private showResult(s: GameState): void {
    const r = s.result!;
    const order = [...s.players].sort((a, b) => r.ranks[a.index] - r.ranks[b.index]);
    const human = s.players[HUMAN];
    this.showModal([
      el('h2', { text: r.winner === HUMAN ? '🎉 1位でゴール！' : `${s.players[r.winner].name}がゴール！` }),
      el('ol', { class: 'ranking' }, order.map((p) =>
        el('li', {}, [
          el('span', { class: 'rank', text: `${r.ranks[p.index]}位` }),
          face(p.index),
          p.name,
          el('span', { class: 'rest', text: p.index === r.winner ? 'ゴール' : `残り${distanceToGoal(s, p)}マス` }),
        ]),
      )),
      el('div', { class: 'choices' }, [
        button('もう一度', () => void this.startGame(human.name, s.players.length - 1), 'primary'),
        button('タイトルへ', () => {
          this.game?.stop();
          this.hideModal();
          $('#game').classList.add('hidden');
          $('#title').classList.remove('hidden');
        }),
      ]),
    ]);
  }

  // ============================================================
  // 小さな道具
  // ============================================================

  private myLegal(s: GameState): Action[] {
    return this.game?.waitingForHuman ? getLegalActions(s, HUMAN) : [];
  }

  private act(a: Action): void {
    void this.game?.act(a);
  }

  private actFromModal(a: Action): void {
    this.selection = [];
    this.hideModal();
    this.act(a);
  }

  private showModal(children: HTMLElement[]): void {
    $('#modal-body').replaceChildren(...children);
    $('#modal').classList.remove('hidden');
  }

  private hideModal(): void {
    $('#modal').classList.add('hidden');
  }
}
