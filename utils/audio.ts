import type { Blob } from '@google/genai';

export function decode(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

export function encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function encodePcm(data: Float32Array): Uint8Array {
  const bytes = new Uint8Array(data.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < data.length; i++) {
    const sample = Number.isFinite(data[i]) ? Math.max(-1, Math.min(1, data[i])) : 0;
    view.setInt16(i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}

export function decodePcm(data: Uint8Array): Float32Array {
  if (data.byteLength % 2 !== 0) throw new Error('Invalid PCM audio length.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const samples = new Float32Array(data.byteLength / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
  return samples;
}

export function createBlob(data: Float32Array, sampleRate: number): Blob {
  return { data: encode(encodePcm(data)), mimeType: `audio/pcm;rate=${sampleRate}` };
}
