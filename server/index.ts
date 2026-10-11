import { resolve } from 'node:path';
import { createApp } from './app.js';
import { parseOrigins } from './origins.js';

try { process.loadEnvFile('.env.local'); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }

const port = Number(process.env.API_PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be a valid port.');
const production = process.env.NODE_ENV === 'production';
const origins = parseOrigins(process.env.APP_ORIGINS ?? process.env.APP_ORIGIN ?? `http://localhost:${production ? port : 3000}`);
if (!process.env.GEMINI_API_KEY) console.warn('GEMINI_API_KEY is missing. Add it to .env.local before starting a voice session.');
const server = createApp({
  apiKey: process.env.GEMINI_API_KEY,
  model: process.env.GEMINI_MODEL ?? 'gemini-3.8-live',
  voice: process.env.GEMINI_VOICE ?? 'Kore',
  origins,
  dist: production ? resolve('dist') : undefined,
});
server.listen(port, '127.0.0.1', () => console.log(`Voice server listening at http://localhost:${port}`));
