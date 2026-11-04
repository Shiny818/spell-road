// ボードとコマを描くPhaserの画面。ルールの状態は持たず、渡された状態を表示するだけ。

import Phaser from 'phaser';
import type { BoardDef, GameEvent, GameState, SquareType } from '../core/types';
import { ASSET } from '../ui/assets';
import { PLAYER_COLORS, PLAYER_ICONS, SQUARE_STYLE } from '../ui/theme';

// 横4列。ボード全体の幅は以前（横6列）とほぼ同じなので、画面上でもマスが1.5倍になる
const UNIT = 134;
const MARGIN = 66;
const RADIUS = 42;
/** コマ（キャラクター）の表示の大きさ */
const PIECE_SIZE = 55;
/** 切り株の土台を敷かず、絵だけを大きく描くマス */
const BIG_ICON_SQUARES = new Set<SquareType>(['start', 'goal', 'gate']);
const ICON_SQUARES: SquareType[] = ['start', 'card', 'exchange', 'coin', 'gate', 'goal'];
/** マス・コマの画像の最大の大きさ。これより大きい画像は読み込み後に縮める */
const TEXTURE_MAX = 320;
/** 同じマスに複数のコマがいるときのずらし方 */
const SLOT_OFFSETS = [
  [-20, -20],
  [20, -20],
  [-20, 20],
  [20, 20],
];

const hex = (c: string) => Number.parseInt(c.slice(1), 16);

/** 画面の画素密度。スマホでぼやけないよう、この倍率で描く */
export const PIXEL_RATIO = Math.min(window.devicePixelRatio || 1, 3);

export class BoardScene extends Phaser.Scene {
  private board!: BoardDef;
  private pieces: Phaser.GameObjects.Container[] = [];
  /** 画面上で各コマがいるマス（イベントを再生しながら更新する） */
  private piecePos: string[] = [];
  private trapIcons = new Map<string, Phaser.GameObjects.Image | Phaser.GameObjects.Text>();
  private crackTexts = new Map<string, Phaser.GameObjects.Text>();
  private ready!: Promise<void>;
  private resolveReady!: () => void;
  /**
   * 画面が裏に回っているとPhaserが起動しないことがある（スマホで別のアプリを見ているときなど）。
   * 起動前に届いた状態は覚えておき、起動したときに描く。それまでの演出は飛ばす
   */
  private created = false;
  private pendingState: GameState | null = null;
  private worldW = 0;
  private worldH = 0;

  constructor() {
    super('board');
    this.ready = new Promise((r) => (this.resolveReady = r));
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  /** 画像を読み込む。無い画像は読み込みに失敗するだけで、描くときに絵文字・色に切り替える */
  preload(): void {
    for (let i = 0; i < 4; i++) this.load.image(`chara${i}`, ASSET.chara(i));
    for (const t of ICON_SQUARES) this.load.image(`square_${t}`, ASSET.square(t));
    this.load.image('square_base', ASSET.squareBase);
    this.load.image('trap_fire', ASSET.trapFire);
    this.load.image('trap_ice', ASSET.trapIce);
    this.load.image('bg_forest', ASSET.forestTile);
  }

  create(): void {
    this.shrinkTextures();
    this.cameras.main.setBackgroundColor('#bfe3b4');
    // ドラッグでボードを動かせる
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      const cam = this.cameras.main;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
    });
    this.scale.on('resize', () => this.fitCamera());
    this.created = true;
    if (this.pendingState) this.setup(this.pendingState);
    this.resolveReady();
  }

  /** ボードとコマを描き直す */
  setup(state: GameState): void {
    if (!this.created) {
      this.pendingState = state;
      return;
    }
    this.pendingState = null;
    this.children.removeAll(true);
    this.pieces = [];
    this.trapIcons.clear();
    this.crackTexts.clear();
    this.board = state.board;

    const xs = this.board.nodes.map((n) => n.pos![0]);
    const ys = this.board.nodes.map((n) => n.pos![1]);
    this.worldW = Math.max(...xs) * UNIT + MARGIN * 2;
    this.worldH = Math.max(...ys) * UNIT + MARGIN * 2;

    if (this.textures.exists('bg_forest')) {
      // ボードより広めに敷いて、ドラッグしても端が見えないようにする
      const pad = 600;
      this.add
        .tileSprite(-pad, -pad, this.worldW + pad * 2, this.worldH + pad * 2, 'bg_forest')
        .setOrigin(0)
        .setTileScale(1.2);
    }

    // 道（ふちどり＋土の色）
    const g = this.add.graphics();
    for (const [width, color, alpha] of [
      [20, 0x6b4e2e, 0.5],
      [13, 0xecd9ad, 1],
    ]) {
      g.lineStyle(width, color, alpha);
      for (const n of this.board.nodes) {
        const [x1, y1] = this.nodeXY(n.id);
        for (const e of n.next) {
          const [x2, y2] = this.nodeXY(e.to);
          g.lineBetween(x1, y1, x2, y2);
        }
      }
    }

    for (const n of this.board.nodes) {
      const [x, y] = this.nodeXY(n.id);
      this.drawSquare(n.type, x, y);

      if (n.type === 'gate' && n.gate) {
        // 通過条件と、分岐先ごとの出目
        this.label(x, y - RADIUS - 12, `${n.gate.pass.join('・')}で通過`, '#5a3e1b');
        if (n.next.length > 1) {
          for (const e of n.next) {
            const [ex, ey] = this.nodeXY(e.to);
            this.label((x + ex) / 2, (y + ey) / 2, e.dice!.join('・'), '#7a2e2e');
          }
        }
        const crack = this.addText(x, y + RADIUS + 12, '', { fontSize: '15px', color: '#7a2e2e', fontStyle: 'bold' });
        crack.setOrigin(0.5);
        this.crackTexts.set(n.id, crack);
      }
    }

    this.piecePos = state.players.map((p) => p.trail[p.trail.length - 1]);
    state.players.forEach((_, i) => {
      const [x, y] = this.pieceXY(i);
      this.pieces.push(this.add.container(x, y, this.pieceParts(i)).setDepth(10 + i));
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
      const key = `trap_${state.traps[id].kind}`;
      const icon = this.textures.exists(key)
        ? this.add.image(x, y + 4, key).setDisplaySize(RADIUS * 2.6, RADIUS * 2.6) // 地面に描かれた魔法陣なので、マス全体に重ねる
        : this.addText(x + 27, y - 33, state.traps[id].kind === 'ice' ? '🧊' : '🔥', { fontSize: '30px' });
      this.trapIcons.set(id, icon.setOrigin(0.5).setDepth(5));
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
    if (!this.created) return;
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
    if (!this.created) {
      this.pendingState = state;
      return;
    }
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
    cam.setZoom(Math.min(1.1 * PIXEL_RATIO, w / this.worldW));
    // 下側は、左下に重なる手番キャラの絵に隠れないよう、ゴールより少し先までスクロールできるようにする
    cam.setBounds(0, 0, this.worldW, this.worldH + 220);
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

  /**
   * 大きすぎる画像を、表示に合った大きさに縮めておく。
   * 大きな画像をそのまま小さく描くとギザギザになるため、半分ずつ縮めてなめらかにする。
   */
  private shrinkTextures(): void {
    const keys = [...Array.from({ length: 4 }, (_, i) => `chara${i}`), ...ICON_SQUARES.map((t) => `square_${t}`), 'square_base', 'trap_fire', 'trap_ice'];
    for (const key of keys) {
      if (!this.textures.exists(key)) continue;
      const src = this.textures.get(key).getSourceImage() as HTMLImageElement;
      const scale = TEXTURE_MAX / Math.max(src.width, src.height);
      if (scale >= 1) continue;
      let image: CanvasImageSource = src;
      let [w, h] = [src.width, src.height];
      const [tw, th] = [Math.round(w * scale), Math.round(h * scale)];
      while (w > tw) {
        [w, h] = [Math.max(tw, Math.round(w / 2)), Math.max(th, Math.round(h / 2))];
        const canvas = document.createElement('canvas');
        [canvas.width, canvas.height] = [w, h];
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, 0, 0, w, h);
        image = canvas;
      }
      this.textures.remove(key);
      this.textures.addCanvas(key, image as HTMLCanvasElement);
    }
  }

  /** マス。切り株の土台の上に種類の絵を描く（画像が無ければ色の丸と絵文字） */
  private drawSquare(type: SquareType, x: number, y: number): void {
    const style = SQUARE_STYLE[type];
    const key = `square_${type}`;
    const hasIcon = this.textures.exists(key);
    const big = hasIcon && BIG_ICON_SQUARES.has(type);
    if (!big) {
      if (this.textures.exists('square_base')) this.add.image(x, y, 'square_base').setDisplaySize(RADIUS * 2.4, RADIUS * 2.4);
      else this.add.circle(x, y, RADIUS, hex(style.color)).setStrokeStyle(3, 0x6b5638);
    }
    if (hasIcon) {
      const size = big ? RADIUS * 2.6 : RADIUS * 1.5;
      this.add.image(x, y, key).setDisplaySize(size, size);
    } else if (style.icon) {
      this.addText(x, y, style.icon, { fontSize: '38px' }).setOrigin(0.5);
    }
  }

  /** コマ。足元にプレイヤーの色の台を敷いたキャラクター（画像が無ければ色の丸と絵文字） */
  private pieceParts(i: number): Phaser.GameObjects.GameObject[] {
    const color = hex(PLAYER_COLORS[i]);
    if (!this.textures.exists(`chara${i}`)) {
      const body = this.add.circle(0, 0, 20, color).setStrokeStyle(3, 0xffffff);
      return [body, this.addText(0, 0, PLAYER_ICONS[i], { fontSize: '22px' }).setOrigin(0.5)];
    }
    const stand = this.add.ellipse(0, PIECE_SIZE * 0.32, PIECE_SIZE * 0.72, PIECE_SIZE * 0.28, color).setStrokeStyle(2, 0xffffff);
    const chara = this.add.image(0, 0, `chara${i}`).setDisplaySize(PIECE_SIZE, PIECE_SIZE).setOrigin(0.5, 0.6);
    return [stand, chara];
  }

  private addText(x: number, y: number, text: string, style: Phaser.Types.GameObjects.Text.TextStyle) {
    return this.add.text(x, y, text, { ...style, resolution: PIXEL_RATIO * 1.1 });
  }

  private label(x: number, y: number, text: string, color: string): void {
    this.addText(x, y, text, {
      fontSize: '15px',
      color,
      fontStyle: 'bold',
      backgroundColor: '#ffffffcc',
      padding: { x: 4, y: 1 },
    })
      .setOrigin(0.5)
      .setDepth(4);
  }
}
