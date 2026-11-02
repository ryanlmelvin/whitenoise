import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Execute the actual offline/update portion of app.js with the same outer bindings.
// Audio and DOM layout are independent of this service-worker lifecycle.
const app = await readFile(new URL('../docs/app.js', import.meta.url), 'utf8');
const code = app.slice(app.indexOf('let registration;'));
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

class Worker extends EventTarget {
  constructor(state = 'activated', ready = true) {
    super();
    this.state = state;
    this.ready = ready;
    this.messages = [];
    this.repairWorks = true;
  }
  postMessage({ type }, ports = []) {
    this.messages.push(type);
    if (type === 'ENSURE_OFFLINE') this.ready = this.repairWorks;
    if (ports[0]) ports[0].postMessage({ ready: this.ready });
  }
  transition(state) { this.state = state; this.dispatchEvent(new Event('statechange')); }
}

function setup(register, { playing = true } = {}) {
  const elements = new Map();
  const $ = selector => {
    if (!elements.has(selector)) {
      const element = new EventTarget();
      element.classList = { add() {}, remove() {} };
      elements.set(selector, element);
    }
    return elements.get(selector);
  };
  class Channel {
    constructor() {
      this.port1 = { close() {} };
      this.port2 = { postMessage: data => queueMicrotask(() => this.port1.onmessage?.({ data })) };
    }
  }
  const serviceWorker = new EventTarget();
  serviceWorker.register = register;
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  let reloads = 0;
  const context = vm.createContext({
    $, window, document, navigator: { serviceWorker, onLine: true },
    offlineReady: false, busy: () => playing,
    MessageChannel: Channel, setTimeout, clearTimeout,
    location: { reload() { reloads++; } },
  });
  vm.runInContext(code, context);
  return { $, context, window, document, serviceWorker, reloads: () => reloads };
}

function registration(active, installing) {
  return Object.assign(new EventTarget(), { active, installing, waiting: null, async update() {} });
}

test('startup repairs an incomplete active cache without interrupting playback', async () => {
  const worker = new Worker('activated', false);
  const app = setup(async () => registration(worker));
  await settle();
  assert.deepEqual(worker.messages, ['CHECK_OFFLINE', 'ENSURE_OFFLINE']);
  assert.equal(app.context.offlineReady, true);
  assert.match(app.$('#offline-status').innerHTML, /Ready offline/);
  assert.equal(app.reloads(), 0);
});

test('reconnecting retries a failed initial worker installation without a page reload', async () => {
  let attempts = 0;
  const worker = new Worker();
  const app = setup(async () => {
    if (++attempts === 1) throw new Error('Offline');
    return registration(worker);
  });
  await settle();
  assert.equal(app.context.offlineReady, false);
  app.window.dispatchEvent(new Event('online'));
  await settle();
  assert.equal(attempts, 2);
  assert.equal(app.context.offlineReady, true);
  assert.equal(app.reloads(), 0);
});

test('a failed installing worker can be retried and its replacement becomes ready', async () => {
  const failed = new Worker('installing', false);
  const replacement = new Worker('installing', true);
  let attempts = 0;
  const app = setup(async () => registration(null, ++attempts === 1 ? failed : replacement));
  await settle();
  failed.transition('redundant');
  assert.equal(app.context.offlineReady, false);
  app.window.dispatchEvent(new Event('online'));
  await settle();
  replacement.transition('activated');
  await settle();
  assert.equal(attempts, 2);
  assert.equal(app.context.offlineReady, true);
  assert.equal(app.reloads(), 0);
});

test('a later online event repairs cache loss and clears stale offline readiness', async () => {
  const worker = new Worker();
  const reg = registration(worker);
  const app = setup(async () => reg);
  await settle();
  assert.equal(app.context.offlineReady, true);
  worker.ready = false;
  worker.repairWorks = false;
  app.window.dispatchEvent(new Event('online'));
  await settle();
  assert.equal(app.context.offlineReady, false);
  worker.repairWorks = true;
  app.window.dispatchEvent(new Event('online'));
  await settle();
  assert.equal(app.context.offlineReady, true);
  assert.equal(app.reloads(), 0);
});


test('returning to an open app checks for updates and offers a waiting version', async () => {
  const reg = registration(new Worker());
  let checks = 0;
  reg.update = async () => { if (++checks === 2) reg.waiting = new Worker('installed'); };
  const app = setup(async () => reg, { playing: false });
  await settle();
  assert.equal(checks, 1);
  assert.equal(app.$('#update-notice').hidden, true);
  app.document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  assert.equal(checks, 2);
  assert.equal(app.$('#update-notice').hidden, false);
  assert.equal(app.reloads(), 0);
  app.$('#update-button').dispatchEvent(new Event('click'));
  assert.deepEqual(reg.waiting.messages, ['ACTIVATE_UPDATE']);
  app.serviceWorker.dispatchEvent(new Event('controllerchange'));
  assert.equal(app.reloads(), 1);
});

test('finding an update during playback never activates or reloads it', async () => {
  const reg = registration(new Worker());
  reg.update = async () => { reg.waiting = new Worker('installed'); };
  const app = setup(async () => reg);
  await settle();
  assert.equal(app.$('#update-notice').hidden, true);
  app.$('#update-button').dispatchEvent(new Event('click'));
  assert.deepEqual(reg.waiting.messages, []);
  assert.equal(app.reloads(), 0);
});
