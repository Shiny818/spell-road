import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  // 8000・8765 は他で使用中のため、固定のポートを使う
  server: { port: 5180, strictPort: true },
  preview: { port: 5181, strictPort: true },
  // Phaser 本体が大きいため
  build: { chunkSizeWarningLimit: 2000 },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
