import { decode, decodePcm } from '../utils/audio';

export interface AudioEngine {
  prepare(onSamples: (samples: Float32Array, rate: number) => void): Promise<void>;
  play(data: string, mimeType?: string): void;
  interrupt(): void;
  close(): Promise<void>;
  analyser: AnalyserNode | null;
}

export class BrowserAudio implements AudioEngine {
  analyser: AnalyserNode | null = null;
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private input: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private sources = new Set<AudioBufferSourceNode>();
  private nextStart = 0;
  private closed = false;

  constructor(private onSpeaking: (speaking: boolean) => void) {}

  async prepare(onSamples: (samples: Float32Array, rate: number) => void) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone access requires HTTPS or localhost and a supported browser.');
    }
    // Resume in the click gesture, before waiting for permission or network requests.
    const context = new AudioContext();
    this.context = context;
    const resumed = context.resume();
    const streamPromise = navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    // Attach both rejection handlers immediately. Permission may resolve after Stop.
    const streamTask = streamPromise.then(stream => {
      if (this.closed) {
        stream.getTracks().forEach(track => track.stop());
        throw new DOMException('Cancelled', 'AbortError');
      }
      this.stream = stream;
      return stream;
    });
    const [, stream] = await Promise.all([resumed, streamTask]);
    if (this.closed) throw new DOMException('Cancelled', 'AbortError');
    await context.audioWorklet.addModule('/pcm-capture.worklet.js');
    if (this.closed) throw new DOMException('Cancelled', 'AbortError');
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.5;
    this.analyser.connect(context.destination);
    this.input = context.createMediaStreamSource(stream);
    this.worklet = new AudioWorkletNode(context, 'pcm-capture');
    this.worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
      if (!this.closed) onSamples(event.data, context.sampleRate);
    };
    this.input.connect(this.worklet);
    this.worklet.connect(context.destination);
  }

  play(data: string, mimeType = 'audio/pcm;rate=24000') {
    const context = this.context;
    if (this.closed || !context || !this.analyser) return;
    if (!mimeType.startsWith('audio/pcm')) throw new Error('Unsupported response audio format.');
    const rate = Number(/rate=(\d+)/.exec(mimeType)?.[1] ?? 24000);
    const samples = decodePcm(decode(data));
    if (!samples.length) return;
    const buffer = context.createBuffer(1, samples.length, rate);
    buffer.getChannelData(0).set(samples);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
      if (!this.sources.size) this.onSpeaking(false);
    };
    const start = Math.max(context.currentTime, this.nextStart);
    this.sources.add(source);
    source.start(start);
    this.nextStart = start + buffer.duration;
    this.onSpeaking(true);
  }

  interrupt() {
    for (const source of this.sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    this.sources.clear();
    this.nextStart = 0;
    this.onSpeaking(false);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.interrupt();
    this.stream?.getTracks().forEach(track => track.stop());
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.port.close();
      this.worklet.disconnect();
    }
    this.input?.disconnect();
    this.analyser?.disconnect();
    this.analyser = null;
    if (this.context && this.context.state !== 'closed') await this.context.close();
  }
}
