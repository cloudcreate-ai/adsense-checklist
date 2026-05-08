import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts'],
  format: ['esm'],
  dts: true,
  target: 'node18',
  clean: true,
  banner: ({ fileName }) => fileName === 'cli.js' ? '#!/usr/bin/env node' : undefined,
  external: ['playwright'],
});
