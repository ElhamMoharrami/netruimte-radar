import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // node:sqlite is a Node builtin (v22.5+). Vite's SSR loader otherwise strips
    // the `node:` prefix and tries to resolve `sqlite` as a package, which fails.
    server: {
      deps: {
        external: [/^node:/],
      },
    },
  },
});
