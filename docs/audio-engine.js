export const SOUNDS = Object.freeze([
  { id: 'box-fan', name: 'Box fan' },
  { id: 'rain', name: 'Rain' },
  { id: 'white-noise', name: 'White noise' },
  { id: 'brown-noise', name: 'Brown noise' },
]);

// Looping runs on the audio rendering thread, never on a JavaScript timer.
export class SoundPlayer {
  constructor({ contextFactory, fetcher = (...args) => globalThis.fetch(...args), onChange = () => {}, onError = () => {} } = {}) {
    this.contextFactory = contextFactory ?? (() => new (globalThis.AudioContext || globalThis.webkitAudioContext)());
    this.fetcher = fetcher;
    this.onChange = onChange;
    this.onError = onError;
    this.buffers = new Map();
    this.request = 0;
    this.volume = 0.45;
    this.state = 'paused';
    this.sound = 'box-fan';
  }

  getContext() {
    if (!this.context) {
      this.context = this.contextFactory();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume ** 2;
      this.master.connect(this.context.destination);
      this.context.addEventListener('statechange', () => {
        if (this.current && ['interrupted', 'suspended', 'closed'].includes(this.context.state)) {
          this.pause('interrupted');
        }
      });
    }
    return this.context;
  }

  notify(state) {
    this.state = state;
    this.onChange({ state, sound: this.sound });
  }

  setVolume(value) {
    if (!Number.isFinite(value)) return;
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master) this.master.gain.setTargetAtTime(this.volume ** 2, this.context.currentTime, 0.06);
  }

  async load(id, context) {
    if (!this.buffers.has(id)) {
      const promise = this.fetcher(new URL(`./audio/${id}.wav`, import.meta.url))
        .then(response => {
          if (!response.ok) throw new Error('Sound download failed');
          return response.arrayBuffer();
        })
        .then(bytes => context.decodeAudioData(bytes))
        .catch(error => { this.buffers.delete(id); throw error; });
      this.buffers.set(id, promise);
    }
    return this.buffers.get(id);
  }

  stopCurrent() {
    if (!this.current) return;
    const { source, envelope } = this.current;
    const now = this.context.currentTime;
    // cancelAndHold avoids a jump if pause is pressed during the fade-in.
    if (envelope.gain.cancelAndHoldAtTime) envelope.gain.cancelAndHoldAtTime(now);
    else {
      envelope.gain.cancelScheduledValues(now);
      envelope.gain.setValueAtTime(envelope.gain.value, now);
    }
    envelope.gain.linearRampToValueAtTime(0, now + 0.3);
    source.stop(now + 0.32);
    source.onended = () => { source.disconnect(); envelope.disconnect(); };
    this.current = null;
  }

  async play(id = this.sound) {
    if (!SOUNDS.some(sound => sound.id === id)) return;
    const request = ++this.request;
    this.stopCurrent();
    this.sound = id;
    this.notify('loading');
    try {
      const context = this.getContext();
      // Resume in the original tap handler, before fetching/decoding awaits.
      const resumed = context.resume();
      const [buffer] = await Promise.all([this.load(id, context), resumed]);
      if (request !== this.request) return;
      if (context.state !== 'running') throw new Error('Audio is interrupted');
      const source = context.createBufferSource();
      const envelope = context.createGain();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = buffer.duration;
      envelope.gain.setValueAtTime(0, context.currentTime);
      envelope.gain.linearRampToValueAtTime(1, context.currentTime + 0.6);
      source.connect(envelope);
      envelope.connect(this.master);
      this.current = { source, envelope };
      source.start();
      this.notify('playing');
    } catch (error) {
      if (request !== this.request) return;
      this.notify('error');
      this.onError(error);
    }
  }

  pause(reason = 'paused') {
    const request = ++this.request;
    this.stopCurrent();
    this.notify(reason);
    // This timer only saves power after stopping; playback never depends on it.
    setTimeout(() => {
      if (request === this.request && this.context?.state === 'running') {
        this.context.suspend().catch(() => {});
      }
    }, 360);
  }
}
