import type { LiveCallbacks, LiveConnectConfig, LiveServerMessage, Session } from '@google/genai';
import type { TokenResponse } from '../shared/live';
import { createBlob } from '../utils/audio';
import { BrowserAudio, type AudioEngine } from './audio';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'stopping' | 'error';
export interface Transcript { role: 'user' | 'agent'; text: string; }
export interface VoiceState {
  connection: ConnectionState;
  speaking: boolean;
  error: string | null;
  analyser: AnalyserNode | null;
  transcripts: Transcript[];
}
type LiveSession = Pick<Session, 'sendRealtimeInput' | 'close'>;
export interface Dependencies {
  audio: (onSpeaking: (speaking: boolean) => void) => AudioEngine;
  token: (signal: AbortSignal) => Promise<TokenResponse>;
  connect: (token: TokenResponse, config: LiveConnectConfig, callbacks: LiveCallbacks) => Promise<LiveSession>;
}
const defaults: Dependencies = {
  audio: onSpeaking => new BrowserAudio(onSpeaking),
  token: async signal => {
    const response = await fetch('/api/token', {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || 'Could not start a voice session. Please try again.');
    }
    return response.json();
  },
  connect: async (token, config, callbacks) => {
    const { GoogleGenAI } = await import('@google/genai');
    return new GoogleGenAI({
      apiKey: token.token, httpOptions: { apiVersion: 'v1beta' },
    }).live.connect({ model: token.model, config, callbacks });
  },
};

interface Run {
  abort: AbortController;
  audio: AudioEngine;
  session?: LiveSession;
  token?: TokenResponse;
  handle?: string;
  sequence: number;
  retries: number;
  retryTimer?: ReturnType<typeof setTimeout>;
  expiryTimer?: ReturnType<typeof setTimeout>;
  pendingAbort?: AbortController;
  transcriptBoundary: boolean;
}

// The SDK cannot cancel a pending WebSocket connect. Close a late result explicitly.
function pendingSession(promise: Promise<LiveSession>, signal: AbortSignal): Promise<LiveSession> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const abort = () => {
      if (settled) return;
      settled = true; finish(); reject(new DOMException('Cancelled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true; finish(); reject(new Error('Connection timed out. Please try again.'));
    }, 15_000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    promise.then(session => {
      if (settled) { session.close(); return; }
      settled = true; finish(); resolve(session);
    }, error => {
      if (settled) return;
      settled = true; finish(); reject(error);
    });
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Microphone permission was denied. Allow microphone access, then try again.';
    if (error.name === 'NotFoundError') return 'No microphone was found. Connect one, then try again.';
    if (error.name === 'NotReadableError') return 'The microphone is unavailable. Close other apps using it, then try again.';
  }
  return error instanceof Error ? error.message : 'The voice connection failed. Please try again.';
}

export class VoiceSessionController {
  private run: Run | null = null;
  private state: VoiceState = { connection: 'idle', speaking: false, error: null, analyser: null, transcripts: [] };
  private listeners = new Set<() => void>();
  constructor(private deps: Dependencies = defaults) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<VoiceState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  private current(run: Run) { return this.run === run && !run.abort.signal.aborted; }

  start = async () => {
    if (this.run || this.state.connection === 'stopping') return;
    const run: Run = {
      abort: new AbortController(),
      audio: this.deps.audio(speaking => {
        if (this.current(run)) this.update({ speaking });
      }),
      sequence: 0, retries: 0, transcriptBoundary: true,
    };
    this.run = run;
    this.update({ connection: 'connecting', speaking: false, error: null, transcripts: [] });
    try {
      await run.audio.prepare((samples, rate) => {
        if (!this.current(run) || this.state.connection !== 'connected' || !run.session) return;
        try { run.session.sendRealtimeInput({ audio: createBlob(samples, rate) }); }
        catch { this.lost(run, run.sequence); }
      });
      if (!this.current(run)) return;
      this.update({ analyser: run.audio.analyser });
      const tokenTimer = setTimeout(() => this.fail(run, 'The token request timed out. Please try again.'), 15_000);
      try { run.token = await this.deps.token(run.abort.signal); }
      finally { clearTimeout(tokenTimer); }
      if (!this.current(run)) return;
      const lifetime = Date.parse(run.token.expiresAt) - Date.now();
      if (!Number.isFinite(lifetime) || lifetime <= 0) throw new Error('The session token has expired. Please try again.');
      run.expiryTimer = setTimeout(() => this.fail(run, 'This session has expired. Start again to continue.'), lifetime);
      await this.connect(run);
    } catch (error) {
      if (this.current(run)) this.fail(run, errorMessage(error));
    }
  };

  private async connect(run: Run) {
    if (!this.current(run) || !run.token) return;
    const sequence = ++run.sequence;
    const valid = () => this.current(run) && run.sequence === sequence;
    const pendingAbort = new AbortController();
    run.pendingAbort = pendingAbort;
    try {
      const session = await pendingSession(this.deps.connect(run.token, {
        ...run.token.config,
        sessionResumption: run.handle ? { handle: run.handle } : {},
      }, {
        onmessage: message => {
          if (!valid()) return;
          try { this.message(run, message); }
          catch { this.fail(run, 'Could not play the response audio. Please start again.'); }
        },
        onerror: () => { if (valid()) this.lost(run, sequence); },
        onclose: event => {
          if (valid()) this.lost(run, sequence, event.code === 1008 || event.code === 1007);
        },
      }), pendingAbort.signal);
      if (!valid()) { session.close(); return; }
      run.session = session;
      this.update({ connection: 'connected', error: null });
    } catch (error) {
      if (valid()) this.lost(run, sequence, false, errorMessage(error));
    }
  }

  private lost(run: Run, sequence: number, fatal = false, message = 'The voice connection was interrupted. Please start again.') {
    if (!this.current(run) || run.sequence !== sequence) return;
    ++run.sequence; // Ignore callbacks from the socket being closed.
    run.pendingAbort?.abort();
    const session = run.session;
    run.session = undefined;
    session?.close();
    run.audio.interrupt();
    if (fatal || !run.handle || !run.token || run.retries >= 3 || Date.parse(run.token.expiresAt) <= Date.now()) {
      this.fail(run, message);
      return;
    }
    this.update({ connection: 'reconnecting', speaking: false });
    run.transcriptBoundary = true;
    const delay = 500 * 2 ** run.retries++;
    run.retryTimer = setTimeout(() => { void this.connect(run); }, delay);
  }

  private message(run: Run, message: LiveServerMessage) {
    const update = message.sessionResumptionUpdate;
    if (update) run.handle = update.resumable && update.newHandle ? update.newHandle : undefined;
    if (message.goAway) {
      // Resume immediately when possible; otherwise let the existing connection finish.
      if (run.handle) this.lost(run, run.sequence);
      return;
    }
    const content = message.serverContent;
    if (!content) return;
    if (content.interrupted) {
      run.audio.interrupt();
      run.transcriptBoundary = true;
    }
    if (content.inputTranscription?.text) this.transcript(run, 'user', content.inputTranscription.text);
    if (content.outputTranscription?.text) this.transcript(run, 'agent', content.outputTranscription.text);
    if (!content.interrupted) {
      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) run.audio.play(part.inlineData.data, part.inlineData.mimeType);
      }
    }
    if (content.turnComplete) run.transcriptBoundary = true;
    // turnComplete describes generation, not the end of buffered speaker playback.
  }

  private transcript(run: Run, role: Transcript['role'], text: string) {
    const transcripts = [...this.state.transcripts];
    const previous = transcripts.at(-1);
    if (previous?.role === role && !run.transcriptBoundary) {
      transcripts[transcripts.length - 1] = { role, text: (previous.text + text).slice(-4000) };
    } else transcripts.push({ role, text: text.slice(-4000) });
    run.transcriptBoundary = false;
    this.update({ transcripts: transcripts.slice(-40) });
  }

  private async release(run: Run) {
    run.abort.abort();
    run.pendingAbort?.abort();
    clearTimeout(run.retryTimer);
    clearTimeout(run.expiryTimer);
    try { run.session?.close(); } finally { await run.audio.close(); }
  }
  private fail(run: Run, error: string) {
    if (!this.current(run)) return;
    this.run = null;
    this.update({ connection: 'error', speaking: false, analyser: null, error });
    void this.release(run).catch(() => {});
  }
  stop = async () => {
    const run = this.run;
    this.run = null;
    if (!run) return;
    this.update({ connection: 'stopping', speaking: false, analyser: null });
    try { await this.release(run); }
    finally { this.update({ connection: 'idle', error: null }); }
  };
}
