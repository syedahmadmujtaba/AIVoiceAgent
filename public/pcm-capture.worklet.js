// Send ~20 ms chunks; leave the output silent to avoid microphone feedback.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(Math.round(sampleRate * 0.02));
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input) {
      for (const sample of input) {
        this.chunk[this.offset++] = sample;
        if (this.offset === this.chunk.length) {
          this.port.postMessage(this.chunk, [this.chunk.buffer]);
          this.chunk = new Float32Array(Math.round(sampleRate * 0.02));
          this.offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor);
