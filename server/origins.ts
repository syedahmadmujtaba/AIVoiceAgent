/** Accept exact HTTP(S) origins, optionally pasted with a trailing slash. */
export function parseOrigins(value: string): string[] {
  const entries = value.split(',').map(origin => origin.trim()).filter(Boolean);
  if (!entries.length) throw new Error('APP_ORIGINS must contain at least one origin.');
  return [...new Set(entries.map(entry => {
    const url = new URL(entry);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || url.hostname.includes('*')) {
      throw new Error('APP_ORIGINS must contain only exact HTTP(S) origins without paths.');
    }
    return url.origin;
  }))];
}
