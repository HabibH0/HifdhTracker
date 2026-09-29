import { defineConfig } from '@neon/config/v1';

// `neon deploy` bundles and deploys the API. ALLOWED_ORIGINS lists the exact origins allowed to
// call it from a browser, e.g. "https://<user>.github.io".
export default defineConfig({
  functions: {
    hifdhapi: {
      name: 'Hifdh API',
      source: './functions/api.js',
      env: {
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? '',
      },
    },
  },
});
