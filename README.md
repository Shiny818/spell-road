# 魔法のすごろく（仮）

魔法カードで駆け引きをする、ファンタジーのすごろくゲーム（ブラウザゲーム）。

- 仕様書: [docs/spec.md](docs/spec.md)
- カードリスト: [docs/cards.md](docs/cards.md)

## 開発

```bash
npm install
npm test            # 自動テスト
npm run typecheck   # 型チェック
npm run simulate    # CPUどうしで1000ゲーム行い、バランスの目安を表示（例: npm run simulate -- 500 3）
```

## フォルダ構成

| フォルダ | 内容 |
|---|---|
| `src/core/` | ゲームのルール（描画・通信に依存しない） |
| `src/ai/` | CPUの思考、自動対戦 |
| `src/data/` | カード・ボードのデータ（JSON） |
| `tests/` | 自動テスト |
| `scripts/` | シミュレーションなどの道具 |
