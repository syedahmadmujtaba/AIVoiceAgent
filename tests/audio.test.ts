import { describe, expect, it } from 'vitest';
import { createBlob, decode, decodePcm, encodePcm } from '../utils/audio';

describe('PCM encoding', () => {
  it('clamps full-scale and out-of-range samples without wrapping', () => {
    const bytes = encodePcm(new Float32Array([-2, -1, 0, 1, 2, NaN]));
    const view = new DataView(bytes.buffer);
    expect(Array.from({ length: 6 }, (_, i) => view.getInt16(i * 2, true)))
      .toEqual([-32768, -32768, 0, 32767, 32767, 0]);
  });
  it('respects a buffer view offset and rejects incomplete samples', () => {
    expect([...decodePcm(new Uint8Array([99, 99, 0, 128, 99, 99]).subarray(2, 4))]).toEqual([-1]);
    expect(() => decodePcm(new Uint8Array(3))).toThrow('Invalid PCM');
  });
  it('labels the actual device rate and produces little-endian PCM', () => {
    const blob = createBlob(new Float32Array([1]), 48000);
    expect(blob.mimeType).toBe('audio/pcm;rate=48000');
    expect([...decode(blob.data!)]).toEqual([255, 127]);
  });
});
