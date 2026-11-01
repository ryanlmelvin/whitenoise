import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundPlayer } from '../docs/audio-engine.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class FakeParam {
  value = 1;
  events = [];
  setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
  linearRampToValueAtTime(value, time) { this.events.push(['ramp', value, time]); }
  setTargetAtTime(value, time, constant) { this.events.push(['target', value, time, constant]); }
  cancelAndHoldAtTime(time) { this.events.push(['hold', time]); }
}

class FakeContext extends EventTarget {
  state = 'suspended';
  currentTime = 10;
  destination = {};
  sources = [];
  gains = [];
  resumes = 0;
  suspends = 0;
  transition(state) { this.state = state; this.dispatchEvent(new Event('statechange')); }
  async resume() { this.resumes++; this.transition('running'); }
  async suspend() { this.suspends++; this.transition('suspended'); }
  async decodeAudioData(bytes) { return { duration: 32, bytes }; }
  createGain() {
    const node = { gain: new FakeParam(), connect() {}, disconnect() { this.disconnected = true; } };
    this.gains.push(node);
    return node;
  }
  createBufferSource() {
    const source = {
      connect() {},
      disconnect() { this.disconnected = true; },
      start() { this.started = true; },
      stop(time) { this.stopAt = time; },
    };
    this.sources.push(source);
    return source;
  }
}

function setup(t, fetcher) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const context = new FakeContext();
  const changes = [];
  const errors = [];
  const calls = [];
  const player = new SoundPlayer({
    contextFactory: () => context,
    fetcher: async url => {
      calls.push(url);
      return fetcher ? fetcher(url) : { ok: true, arrayBuffer: async () => url.pathname };
    },
    onChange: change => changes.push(change),
    onError: error => errors.push(error),
  });
  return { player, context, changes, errors, calls };
}

test('the default network call preserves the browser fetch receiver', async t => {
  const context = new FakeContext();
  const errors = [];
  t.mock.method(globalThis, 'fetch', function (url) {
    assert.equal(this, globalThis, 'native browser fetch requires its Window receiver');
    return Promise.resolve({ ok: true, arrayBuffer: async () => url.pathname });
  });
  const player = new SoundPlayer({ contextFactory: () => context, onError: error => errors.push(error) });
  await player.play('rain');
  assert.equal(player.state, 'playing');
  assert.equal(errors.length, 0);
  assert.equal(context.sources.length, 1);
});

test('playback loops decoded audio without needing repeated JS callbacks', async t => {
  const { player, context } = setup(t);
  await player.play('rain');
  assert.equal(player.state, 'playing');
  const source = context.sources[0];
  assert.equal(source.started, true);
  assert.equal(source.loop, true);
  assert.equal(source.loopStart, 0);
  assert.equal(source.loopEnd, source.buffer.duration);
  assert.match(source.buffer.bytes, /\/audio\/rain\.wav$/);
  t.mock.timers.tick(8 * 60 * 60 * 1000);
  assert.equal(context.sources.length, 1);
  assert.equal(source.stopAt, undefined);
  assert.equal(context.suspends, 0);
});

test('pause during a download prevents late playback', async t => {
  const download = deferred();
  const { player, context } = setup(t, () => download.promise);
  const playing = player.play('rain');
  assert.equal(context.resumes, 1, 'context is unlocked synchronously in the tap');
  player.pause();
  download.resolve({ ok: true, arrayBuffer: async () => 'rain' });
  await playing;
  assert.equal(player.state, 'paused');
  assert.equal(context.sources.length, 0);
  t.mock.timers.tick(1000);
  assert.equal(context.suspends, 1);
});

test('rapid sound choices cannot be replaced by an earlier slow download', async t => {
  const first = deferred();
  const { player, context, changes } = setup(t, url => url.pathname.endsWith('rain.wav')
    ? first.promise : { ok: true, arrayBuffer: async () => 'brown-noise' });
  const stale = player.play('rain');
  await player.play('brown-noise');
  first.resolve({ ok: true, arrayBuffer: async () => 'rain' });
  await stale;
  assert.equal(player.sound, 'brown-noise');
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0].buffer.bytes, 'brown-noise');
  assert.deepEqual(changes.at(-1), { state: 'playing', sound: 'brown-noise' });
});

test('a stale failed request cannot overwrite the current playing state', async t => {
  const first = deferred();
  const { player, errors } = setup(t, url => url.pathname.endsWith('rain.wav')
    ? first.promise : { ok: true, arrayBuffer: async () => 'box-fan' });
  const stale = player.play('rain');
  await player.play('box-fan');
  first.reject(new Error('Network failed'));
  await stale;
  assert.equal(player.state, 'playing');
  assert.equal(player.sound, 'box-fan');
  assert.equal(errors.length, 0);
});

test('failed downloads can be retried, and successful buffers are reused', async t => {
  let attempt = 0;
  const { player, calls, errors } = setup(t, () => ({
    ok: ++attempt > 1,
    arrayBuffer: async () => 'rain',
  }));
  await player.play('rain');
  assert.equal(player.state, 'error');
  assert.equal(errors.length, 1);
  await player.play('rain');
  assert.equal(player.state, 'playing');
  player.pause();
  await player.play('rain');
  assert.equal(calls.length, 2, 'no extra download after a successful decode');
});

test('an old pause timer cannot suspend a newly started sound', async t => {
  const { player, context } = setup(t);
  await player.play('box-fan');
  player.pause();
  await player.play('white-noise');
  t.mock.timers.tick(1000);
  assert.equal(player.state, 'playing');
  assert.equal(context.state, 'running');
  assert.equal(context.suspends, 0);
  assert.equal(context.sources[1].stopAt, undefined);
});

test('pause fades the sound before stopping and disconnects finished nodes', async t => {
  const { player, context } = setup(t);
  await player.play();
  const { source, envelope } = player.current;
  player.pause();
  const fade = envelope.gain.events.at(-1);
  assert.equal(fade[0], 'ramp');
  assert.equal(fade[1], 0);
  assert.ok(fade[2] > context.currentTime);
  assert.ok(source.stopAt > fade[2]);
  source.onended();
  assert.equal(source.disconnected, true);
  assert.equal(envelope.disconnected, true);
});

test('external audio interruption is surfaced and permits an explicit restart', async t => {
  const { player, context } = setup(t);
  await player.play('rain');
  context.transition('interrupted');
  assert.equal(player.state, 'interrupted');
  assert.equal(player.current, null);
  await player.play();
  t.mock.timers.tick(1000);
  assert.equal(player.state, 'playing');
  assert.equal(context.state, 'running');
  assert.equal(context.sources.length, 2);
});

test('volume is bounded, mute is supported, and invalid input does not poison audio', async t => {
  const { player, context } = setup(t);
  player.setVolume(-1);
  await player.play();
  assert.equal(context.gains[0].gain.value, 0);
  player.setVolume(4);
  assert.equal(player.volume, 1);
  player.setVolume(Number.NaN);
  assert.equal(player.volume, 1);
  player.setVolume(0);
  assert.equal(context.gains[0].gain.events.at(-1)[1], 0);
});
