import { createHandler } from '../server/app.js';
import { parseOrigins } from '../server/origins.js';

// Vercel invokes the request handler directly; do not start a listening server.
export default createHandler({
  apiKey: process.env.GEMINI_API_KEY,
  model: process.env.GEMINI_MODEL ?? 'gemini-3.8-live',
  voice: process.env.GEMINI_VOICE ?? 'Kore',
  origins: parseOrigins(process.env.APP_ORIGINS ?? process.env.APP_ORIGIN ?? ''),
});
