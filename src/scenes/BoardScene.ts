// ボードとコマを描くPhaserの画面。ルールの状態は持たず、渡された状態を表示するだけ。

import Phaser from 'phaser';
import type { BoardDef, GameEvent, GameState } from '../core/types';
import { PLAYER_COLORS, PLAYER_ICONS, SQUARE_STYLE } from '../ui/theme';

const UNIT = 84;
const MARGIN = 56;
const RADIUS = 28;
/** 同じマスに複数のコマがいるときのずらし方 */
const SLOT_OFFSETS = [
  [-13, -13],
  [13, -13],
  [-13, 13],
  [13, 13],
];

const hex = (c: string) => Number.parseInt(c.slice(1), 16);

export class BoardScene extends Phaser.Scene {
  private board!: BoardDef;
  private pieces: Phaser.GameObjects.Container[] = [];
  /** 画面上で各コマがいるマス（イベントを再生しながら更新する） */
  private piecePos: string[] = [];
  private trapIcons = new Map<string, Phaser.GameObjects.Text>();
  private crackTexts = new Map<string, Phaser.GameObjects.Text>();
  private ready!: Promise<void>;
  private resolveReady!: () => void;
  private worldW = 0;
  private worldH = 0;

  constructor() {
    super('board');
    this.ready = new Promise((r) => (this.resolveReady = r));
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#bfe3b4');
    // ドラッグでボードを動かせる
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      const cam = this.cameras.main;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
    });
    this.scale.on('resize', () => this.fitCamera());
    this.resolveReady();
  }

  /** ボードとコマを描き直す */
  setup(state: GameState): void {
    this.children.removeAll(true);
    this.pieces = [];
    this.trapIcons.clear();
    this.crackTexts.clear();
    this.board = state.board;

    const xs = this.board.nodes.map((n) => n.pos![0]);
    const ys = this.board.nodes.map((n) => n.pos![1]);
    this.worldW = Math.max(...xs) * UNIT + MARGIN * 2;
    this.worldH = Math.max(...ys) * UNIT + MARGIN * 2;

    const g = this.add.graphics();
    g.lineStyle(10, 0x8d6e4a, 0.55);
    for (const n of this.board.nodes) {
      const [x1, y1] = this.nodeXY(n.id);
      for (const e of n.next) {
        const [x2, y2] = this.nodeXY(e.to);
        g.lineBetween(x1, y1, x2, y2);
      }
    }

    for (const n of this.board.nodes) {
      const [x, y] = this.nodeXY(n.id);
      const style = SQUARE_STYLE[n.type];
      this.add.circle(x, y, RADIUS, hex(style.color)).setStrokeStyle(3, 0x6b5638);
      if (style.icon) this.add.text(x, y, style.icon, { fontSize: '26px' }).setOrigin(0.5);

      if (n.type === 'gate' && n.gate) {
        // 通過条件と、分岐先ごとの出目
        this.label(x, y - RADIUS - 12, `${n.gate.pass.join('・')}で通過`, '#5a3e1b');
        if (n.next.length > 1) {
          for (const e of n.next) {
            const [ex, ey] = this.nodeXY(e.to);
            this.label((x + ex) / 2, (y + ey) / 2, e.dice!.join('・'), '#7a2e2e');
          }
        }
        const crack = this.add.text(x, y + RADIUS + 12, '', { fontSize: '13px', color: '#7a2e2e', fontStyle: 'bold' });
        crack.setOrigin(0.5);
        this.crackTexts.set(n.id, crack);
      }
    }

    this.piecePos = state.players.map((p) => p.trail[p.trail.length - 1]);
    state.players.forEach((_, i) => {
      const [x, y] = this.pieceXY(i);
      const body = this.add.circle(0, 0, 16, hex(PLAYER_COLORS[i])).setStrokeStyle(3, 0xffffff);
      const icon = this.add.text(0, 0, PLAYER_ICONS[i], { fontSize: '18px' }).setOrigin(0.5);
      this.pieces.push(this.add.container(x, y, [body, icon]).setDepth(10 + i));
    });

    this.sync(state);
    this.fitCamera();
    this.focusOn(state.current, 0);
  }

  /** 罠・ひびの表示を状態に合わせる */
  sync(state: GameState): void {
    for (const [id, icon] of this.trapIcons) {
      if (!state.traps[id]) {
        icon.destroy();
        this.trapIcons.delete(id);
      }
    }
    for (const id of Object.keys(state.traps)) {
      if (this.trapIcons.has(id)) continue;
      const [x, y] = this.nodeXY(id);
      this.trapIcons.set(id, this.add.text(x + 18, y - 22, '🔥', { fontSize: '22px' }).setOrigin(0.5).setDepth(5));
    }
    for (const [gate, text] of this.crackTexts) {
      const cracks = state.players
        .filter((p) => (p.gateCracks[gate] ?? 0) > 0 && p.trail[p.trail.length - 1] === gate)
        .map((p) => `${PLAYER_ICONS[p.index]}ひび${p.gateCracks[gate]}`);
      text.setText(cracks.join(' '));
    }
  }

  /** イベントに合わせてコマを動かす。動かすものがなければすぐ終わる */
  async animate(e: GameEvent): Promise<void> {
    switch (e.type) {
      case 'step':
        this.piecePos[e.player] = e.to;
        await this.movePiece(e.player, 170);
        return;
      case 'pushedBack':
        this.piecePos[e.player] = e.to;
        this.cameras.main.shake(180, 0.004);
        await this.movePiece(e.player, 420);
        return;
      case 'swapped':
        [this.piecePos[e.a], this.piecePos[e.b]] = [this.piecePos[e.b], this.piecePos[e.a]];
        await Promise.all([this.movePiece(e.a, 450), this.movePiece(e.b, 450)]);
        return;
      case 'turnStart':
        this.focusOn(e.player, 400);
        return;
    }
  }

  /** 最終的な状態に合わせて全員のコマを置き直す（アニメーションのずれの補正） */
  placeAll(state: GameState): void {
    this.piecePos = state.players.map((p) => p.trail[p.trail.length - 1]);
    state.players.forEach((_, i) => {
      const [x, y] = this.pieceXY(i);
      this.pieces[i].setPosition(x, y);
    });
    this.sync(state);
  }

  private movePiece(player: number, duration: number): Promise<void> {
    const [x, y] = this.pieceXY(player);
    this.cameras.main.pan(x, y, duration, 'Sine.easeInOut', true);
    const piece = this.pieces[player];
    return new Promise((resolve) => {
      const done = () => {
        piece.setPosition(x, y);
        resolve();
      };
      this.tweens.add({ targets: piece, x, y, duration, ease: 'Sine.easeInOut', onComplete: done });
      // 画面が裏に回っているとアニメーションが止まるので、時間が来たら先に進める
      setTimeout(done, duration + 150);
    });
  }

  private focusOn(player: number, duration: number): void {
    const [x, y] = this.pieceXY(player);
    this.cameras.main.pan(x, y, duration, 'Sine.easeInOut', true);
  }

  private fitCamera(): void {
    const cam = this.cameras.main;
    const w = this.scale.width;
    cam.setZoom(Math.min(1.1, w / this.worldW));
    cam.setBounds(0, 0, this.worldW, this.worldH);
  }

  private nodeXY(id: string): [number, number] {
    const n = this.board.nodes.find((node) => node.id === id)!;
    return [MARGIN + n.pos![0] * UNIT, MARGIN + n.pos![1] * UNIT];
  }

  /** コマの画面上の位置（同じマスのコマは少しずらす） */
  private pieceXY(player: number): [number, number] {
    const [x, y] = this.nodeXY(this.piecePos[player]);
    const [dx, dy] = SLOT_OFFSETS[player];
    return [x + dx, y + dy];
  }

  private label(x: number, y: number, text: string, color: string): void {
    this.add
      .text(x, y, text, {
        fontSize: '13px',
        color,
        fontStyle: 'bold',
        backgroundColor: '#ffffffcc',
        padding: { x: 4, y: 1 },
      })
      .setOrigin(0.5)
      .setDepth(4);
  }
}
