import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserAudio } from '../voice/audio';

function setup() {
  const stopTrack = vi.fn();
  const stream = { getTracks: () => [{ stop: stopTrack }] };
  const sources: Array<{ onended: (() => void) | null; stop: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> }> = [];
  const context = {
    sampleRate: 48000, currentTime: 2, state: 'running', destination: {},
    resume: vi.fn(async () => {}), close: vi.fn(async () => {}),
    audioWorklet: { addModule: vi.fn(async () => {}) },
    createAnalyser: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() })),
    createBuffer: vi.fn((_channels: number, length: number, rate: number) => ({
      getChannelData: () => new Float32Array(length), duration: length / rate,
    })),
    createBufferSource: vi.fn(() => {
      const source = { onended: null as (() => void) | null, buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      sources.push(source); return source;
    }),
  };
  const getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('AudioContext', class { constructor() { return context; } });
  const worklet = { port: { onmessage: null, close: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
  vi.stubGlobal('AudioWorkletNode', class { constructor() { return worklet; } });
  const speaking = vi.fn();
  const audio = new BrowserAudio(speaking);
  return { audio, speaking, context, getUserMedia, stream, stopTrack, sources, worklet };
}
afterEach(() => vi.unstubAllGlobals());
describe('browser audio resources', () => {
  it('stops a microphone stream that arrives after cancellation', async () => {
    const f = setup(); let resolve!: (stream: typeof f.stream) => void;
    f.getUserMedia.mockImplementation(() => new Promise(yes => { resolve = yes; }));
    const preparing = f.audio.prepare(vi.fn());
    const rejection = expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
    await f.audio.close(); resolve(f.stream); await rejection;
    expect(f.stopTrack).toHaveBeenCalledOnce();
    expect(f.context.createMediaStreamSource).not.toHaveBeenCalled();
    expect(f.context.close).toHaveBeenCalledOnce();
  });
  it('schedules chunks consecutively and waits for every source to finish', async () => {
    const f = setup(); await f.audio.prepare(vi.fn());
    f.audio.play('AAA='); f.audio.play('AAA=');
    expect(f.sources[0].start).toHaveBeenCalledWith(2);
    expect(f.sources[1].start).toHaveBeenCalledWith(2 + 1 / 24000);
    f.sources[0].onended!();
    expect(f.speaking).not.toHaveBeenCalledWith(false);
    f.sources[1].onended!();
    expect(f.speaking).toHaveBeenLastCalledWith(false);
    await f.audio.close();
  });
  it('stops queued speech immediately and releases input resources on close', async () => {
    const f = setup(); await f.audio.prepare(vi.fn());
    f.audio.play('AAA='); f.audio.play('AAA='); f.audio.interrupt();
    for (const source of f.sources) {
      expect(source.stop).toHaveBeenCalledOnce();
      expect(source.disconnect).toHaveBeenCalledOnce();
      expect(source.onended).toBeNull();
    }
    f.audio.play('AAA='); expect(f.sources[2].start).toHaveBeenCalledWith(2);
    await f.audio.close(); await f.audio.close();
    expect(f.stopTrack).toHaveBeenCalledOnce();
    expect(f.context.close).toHaveBeenCalledOnce();
    expect(f.worklet.disconnect).toHaveBeenCalledOnce();
  });
});
