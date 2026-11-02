import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  // Phaser 本体が大きいため
  build: { chunkSizeWarningLimit: 2000 },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
