# 魔法のすごろく（仮）

魔法カードで駆け引きをする、ファンタジーのすごろくゲーム（ブラウザゲーム）。

- 仕様書: [docs/spec.md](docs/spec.md)
- カードリスト: [docs/cards.md](docs/cards.md)

## テストプレイ

`testplay.bat` をダブルクリックすると、開発用サーバーが起動してブラウザでゲームが開きます（http://localhost:5180）。
初回は必要なパッケージを自動でインストールします。終了するときは黒いウィンドウを閉じてください。

## 開発

```bash
npm install
npm run dev         # 開発用サーバーを起動（http://localhost:5180）
npm test            # 自動テスト
npm run typecheck   # 型チェック
npm run simulate    # CPUどうしで1000ゲーム行い、バランスの目安を表示（例: npm run simulate -- 500 3）
```

## フォルダ構成

| フォルダ | 内容 |
|---|---|
| `src/core/` | ゲームのルール（描画・通信に依存しない） |
| `src/scenes/` | ボードとコマの描画（Phaser） |
| `src/ui/` | 手札・ボタン・確認画面などのHTMLのUI、1台での対戦の進行 |
| `src/ai/` | CPUの思考、自動対戦 |
| `src/data/` | カード・ボードのデータ（JSON） |
| `tests/` | 自動テスト |
| `scripts/` | シミュレーションなどの道具 |
