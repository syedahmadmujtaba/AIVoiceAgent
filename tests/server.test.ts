import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app';
import { liveConfig } from '../shared/live';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    if (!server.listening) { resolve(); return; }
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  })));
});
async function setup(configured = true) {
  const issueToken = vi.fn(async () => ({ token: 'short-lived', model: 'test-model', expiresAt: 'later', config: liveConfig('Kore') }));
  const server = createApp({ model: 'test-model', voice: 'Kore', origin: 'http://localhost:3000',
    ...(configured ? { issueToken } : {}),
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/token`;
  const post = (origin = 'http://localhost:3000') => fetch(url, { method: 'POST', headers: { Origin: origin } });
  return { url, post, issueToken };
}
describe('token endpoint', () => {
  it('rejects other origins and methods before issuing a token', async () => {
    const f = await setup();
    expect((await fetch(f.url)).status).toBe(405);
    expect((await f.post('https://other.example')).status).toBe(403);
    expect((await fetch(f.url, { method: 'POST' })).status).toBe(403);
    expect(f.issueToken).not.toHaveBeenCalled();
  });
  it('returns non-cacheable credentials and limits requests', async () => {
    const f = await setup();
    const first = await f.post();
    expect(first.status).toBe(200);
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    expect((await first.json()).token).toBe('short-lived');
    for (let i = 0; i < 5; i++) expect((await f.post()).status).toBe(200);
    const limited = await f.post();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBeTruthy();
    expect(f.issueToken).toHaveBeenCalledTimes(6);
  });
  it('reports missing configuration without making a provider request', async () => {
    const f = await setup(false);
    const response = await f.post();
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain('GEMINI_API_KEY');
  });
  it('does not expose provider errors or credentials', async () => {
    const f = await setup(); f.issueToken.mockRejectedValue(new Error('secret-provider-key'));
    const response = await f.post();
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('secret-provider-key');
  });
});
