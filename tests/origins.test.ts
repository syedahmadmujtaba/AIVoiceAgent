import { describe, expect, it } from 'vitest';
import { parseOrigins } from '../server/origins';

describe('origin allowlist configuration', () => {
  it('normalizes pasted URLs, whitespace and duplicates', () => {
    expect(parseOrigins(' https://bilingualvoiceagent.vercel.app/, https://voiceagent.ahmadmujtaba.dev/,https://voiceagent.ahmadmujtaba.dev '))
      .toEqual(['https://bilingualvoiceagent.vercel.app', 'https://voiceagent.ahmadmujtaba.dev']);
  });
  it.each(['', 'https://*.example.com', 'https://example.com/path', 'https://user:pass@example.com', 'https://example.com?x=1', 'file:///tmp'])('rejects invalid origin %s', value => {
    expect(() => parseOrigins(value)).toThrow();
  });
});
