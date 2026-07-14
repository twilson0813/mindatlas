import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/client/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['src/client/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/client/**/*.{ts,tsx}'],
      exclude: ['src/client/**/*.test.{ts,tsx}', 'src/client/**/*.spec.{ts,tsx}'],
    },
  },
  resolve: {
    alias: {
      '@client': path.resolve(__dirname, 'src/client'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
