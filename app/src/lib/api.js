import { createApi } from './apiClient.js';

// Set VITE_API_URL at build time to the deployed Neon Function URL. Without it the app runs
// fully locally and hides the account features.
export const api = createApi({ baseUrl: import.meta.env.VITE_API_URL });
