import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { liveConfig, type TokenResponse } from '../shared/live';

interface Options {
  apiKey?: string;
  model: string;
  voice: string;
  origin: string;
  dist?: string;
  issueToken?: () => Promise<TokenResponse>;
}
function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
const types: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

export function createApp(options: Options) {
  const buckets = new Map<string, { count: number; until: number }>();
  let globalBucket = { count: 0, until: 0 };
  const config = liveConfig(options.voice);
  const issueToken = options.issueToken ?? (async () => {
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    const client = new GoogleGenAI({ apiKey: options.apiKey, httpOptions: { apiVersion: 'v1beta', timeout: 10_000 } });
    const token = await client.authTokens.create({ config: {
      uses: 1,
      expireTime: expiresAt,
      newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
      liveConnectConstraints: { model: options.model, config },
    } });
    if (!token.name) throw new Error('Token service returned no token.');
    return { token: token.name, model: options.model, expiresAt, config };
  });
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'microphone=(self), camera=()');
    try {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      if (pathname === '/api/token') {
        if (request.method !== 'POST') {
          response.setHeader('Allow', 'POST');
          return json(response, 405, { error: 'Use POST to start a session.' });
        }
        if (request.headers.origin !== options.origin || request.headers['sec-fetch-site'] === 'cross-site') {
          return json(response, 403, { error: 'This origin is not allowed to start a session.' });
        }
        if (!options.apiKey && !options.issueToken) {
          return json(response, 503, { error: 'Set GEMINI_API_KEY on the server, then restart it.' });
        }
        const now = Date.now();
        for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
        if (globalBucket.until <= now) globalBucket = { count: 0, until: now + 600_000 };
        // Do not trust forwarded headers from arbitrary clients.
        const ip = request.socket.remoteAddress ?? 'local';
        const bucket = buckets.get(ip) ?? { count: 0, until: now + 600_000 };
        buckets.set(ip, bucket);
        if (bucket.count >= 6 || globalBucket.count >= 30) {
          response.setHeader('Retry-After', String(Math.ceil((Math.max(bucket.until, globalBucket.until) - now) / 1000)));
          return json(response, 429, { error: 'Too many session attempts. Please wait a few minutes.' });
        }
        bucket.count++;
        globalBucket.count++;
        try { return json(response, 200, await issueToken()); }
        catch {
          return json(response, 502, { error: 'Could not create a Gemini session. Check the server API key and model access.' });
        }
      }
      if (pathname.startsWith('/api/')) return json(response, 404, { error: 'Not found.' });
      if (!options.dist || !['GET', 'HEAD'].includes(request.method ?? '')) return json(response, 404, { error: 'Not found.' });
      const root = resolve(options.dist);
      const path = resolve(root, '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
      if (!path.startsWith(root + sep)) return json(response, 403, { error: 'Forbidden.' });
      try {
        const data = await readFile(path);
        response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' });
        response.end(request.method === 'HEAD' ? undefined : data);
      } catch { json(response, 404, { error: 'Not found.' }); }
    } catch { json(response, 400, { error: 'Invalid request.' }); }
  });
}
