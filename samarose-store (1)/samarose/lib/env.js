// Loads .env (if present) before anything else reads process.env.
try { process.loadEnvFile(); } catch { /* no .env file: use real environment variables */ }
export const PROD = process.env.NODE_ENV === 'production';
export const PORT = Number(process.env.PORT) || 3000;
export const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
