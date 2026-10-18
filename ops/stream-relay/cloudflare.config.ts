import { defineConfig } from 'cf/config';
export default defineConfig({
  accountId: '073abd4ee247f9cf77d6a08d9fa12f12',
  worker: {
    name: 'cicada-stream-relay',
    compatibilityDate: '2026-10-18',
    entrypoint: './src/index.js',
    observability: { enabled: true, traces: { enabled: true, headSamplingRate: 0.01 } },
  },
});
