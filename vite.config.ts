import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/** いまのコミットの短い番号（git が使えない環境では空） */
function commitId(): string {
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return process.env.GITHUB_SHA?.slice(0, 7) ?? '';
  }
}

export default defineConfig({
  base: './',
  // タイトル画面に出すバージョン（package.json の version と、ビルドしたときのコミット）
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commitId()),
  },
  // 8000・8765 は他で使用中のため、固定のポートを使う
  server: { port: 5180, strictPort: true },
  preview: { port: 5181, strictPort: true },
  // Phaser 本体が大きいため
  build: { chunkSizeWarningLimit: 2000 },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
