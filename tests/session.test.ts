import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveCallbacks, LiveServerMessage } from '@google/genai';
import { VoiceSessionController, type Dependencies } from '../voice/session';
import { liveConfig, type TokenResponse } from '../shared/live';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  let speaking!: (value: boolean) => void;
  let samples!: (samples: Float32Array, rate: number) => void;
  const audio = {
    analyser: null,
    prepare: vi.fn(async (callback) => { samples = callback; }),
    play: vi.fn(() => speaking(true)), interrupt: vi.fn(() => speaking(false)), close: vi.fn(async () => {}),
  };
  const session = { close: vi.fn(), sendRealtimeInput: vi.fn() };
  const callbacks: LiveCallbacks[] = [];
  const token: TokenResponse = {
    token: 'auth_tokens/test', model: 'test-model', expiresAt: new Date(Date.now() + 1_800_000).toISOString(), config: liveConfig('Kore'),
  };
  const deps = {
    audio: vi.fn(callback => { speaking = callback; return audio; }),
    token: vi.fn(async () => token),
    connect: vi.fn(async (_token, _config, cb) => { callbacks.push(cb); return session; }),
  } satisfies Dependencies;
  const controller = new VoiceSessionController(deps);
  return { controller, deps, audio, session, callbacks, token, samples: (data: Float32Array, rate: number) => samples(data, rate) };
}
const active: VoiceSessionController[] = [];
function setup() { const f = fixture(); active.push(f.controller); return f; }
afterEach(async () => { await Promise.all(active.splice(0).map(c => c.stop())); vi.useRealTimers(); });

const message = (cb: LiveCallbacks, data: Partial<LiveServerMessage>) => cb.onmessage(data as LiveServerMessage);
const close = (cb: LiveCallbacks) => cb.onclose?.({ code: 1006 } as CloseEvent);

describe('voice session lifecycle', () => {
  it('does not fetch tokens after Stop while microphone permission is pending', async () => {
    const f = setup(); const permission = deferred<void>();
    f.audio.prepare.mockImplementation(() => permission.promise);
    const start = f.controller.start();
    await f.controller.stop(); permission.resolve(); await start;
    expect(f.deps.token).not.toHaveBeenCalled();
    expect(f.audio.close).toHaveBeenCalledOnce();
    expect(f.controller.getSnapshot().connection).toBe('idle');
  });
  it('closes a late connection and never marks it connected after Stop', async () => {
    const f = setup(); const connection = deferred<typeof f.session>();
    f.deps.connect.mockImplementation(() => connection.promise);
    const start = f.controller.start();
    await vi.waitFor(() => expect(f.deps.connect).toHaveBeenCalled());
    await f.controller.stop(); connection.resolve(f.session); await start;
    expect(f.session.close).toHaveBeenCalledOnce();
    expect(f.controller.getSnapshot().connection).toBe('idle');
  });
  it('cleans audio and keeps the error visible when token issuance fails', async () => {
    const f = setup(); f.deps.token.mockRejectedValue(new Error('Token unavailable'));
    await f.controller.start();
    expect(f.audio.close).toHaveBeenCalledOnce();
    expect(f.controller.getSnapshot()).toMatchObject({ connection: 'error', error: 'Token unavailable' });
  });
  it('ignores callbacks from a stopped session after another starts', async () => {
    const f = setup(); await f.controller.start(); const old = f.callbacks[0];
    await f.controller.stop(); await f.controller.start(); close(old);
    message(old, { serverContent: { modelTurn: { parts: [{ inlineData: { data: 'AAA=' } }] } } });
    expect(f.controller.getSnapshot().connection).toBe('connected');
    expect(f.audio.play).not.toHaveBeenCalled();
  });
  it('plays every part and keeps speaking until playback ends, not turnComplete', async () => {
    const f = setup(); await f.controller.start();
    message(f.callbacks[0], { serverContent: {
      modelTurn: { parts: [{ inlineData: { data: 'AAA=' } }, { inlineData: { data: 'AQA=' } }] }, turnComplete: true,
    } });
    expect(f.audio.play).toHaveBeenCalledTimes(2);
    expect(f.controller.getSnapshot().speaking).toBe(true);
    message(f.callbacks[0], { serverContent: { interrupted: true } });
    expect(f.audio.interrupt).toHaveBeenCalledOnce();
    expect(f.controller.getSnapshot().speaking).toBe(false);
  });
  it('sends microphone samples only when connected, at the supplied sample rate', async () => {
    const f = setup(); await f.controller.start(); f.samples(new Float32Array([0]), 48000);
    expect(f.session.sendRealtimeInput).toHaveBeenCalledWith({ audio: { data: 'AAA=', mimeType: 'audio/pcm;rate=48000' } });
    await f.controller.stop(); f.samples(new Float32Array([0]), 48000);
    expect(f.session.sendRealtimeInput).toHaveBeenCalledOnce();
  });
  it('resumes a recoverable disconnect and stops after three retries', async () => {
    vi.useFakeTimers(); const f = setup(); await f.controller.start();
    message(f.callbacks[0], { sessionResumptionUpdate: { resumable: true, newHandle: 'resume-me' } });
    for (let i = 0; i < 3; i++) {
      close(f.callbacks[i]);
      expect(f.controller.getSnapshot().connection).toBe('reconnecting');
      await vi.advanceTimersByTimeAsync(500 * 2 ** i);
    }
    expect(f.deps.connect.mock.calls[1][1].sessionResumption).toEqual({ handle: 'resume-me' });
    expect(f.deps.token).toHaveBeenCalledOnce();
    close(f.callbacks[3]);
    expect(f.controller.getSnapshot().connection).toBe('error');
    expect(f.audio.close).toHaveBeenCalledOnce();
  });
  it('cancels scheduled reconnects when stopped', async () => {
    vi.useFakeTimers(); const f = setup(); await f.controller.start();
    message(f.callbacks[0], { sessionResumptionUpdate: { resumable: true, newHandle: 'handle' } });
    close(f.callbacks[0]); await f.controller.stop(); await vi.advanceTimersByTimeAsync(10_000);
    expect(f.deps.connect).toHaveBeenCalledOnce();
  });
  it('times out a pending connection and closes its late result', async () => {
    vi.useFakeTimers(); const f = setup(); const connection = deferred<typeof f.session>();
    f.deps.connect.mockImplementation(() => connection.promise);
    const start = f.controller.start(); await vi.advanceTimersByTimeAsync(15_001); await start;
    expect(f.controller.getSnapshot().connection).toBe('error');
    expect(f.audio.close).toHaveBeenCalledOnce();
    connection.resolve(f.session); await Promise.resolve();
    expect(f.session.close).toHaveBeenCalledOnce();
  });
  it('expires the session without silently starting a new conversation', async () => {
    vi.useFakeTimers(); const f = setup(); await f.controller.start();
    await vi.advanceTimersByTimeAsync(1_800_000);
    expect(f.controller.getSnapshot().error).toContain('expired');
    expect(f.session.close).toHaveBeenCalledOnce();
  });
});
