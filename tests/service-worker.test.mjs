import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const code = await readFile(new URL('../docs/sw.js', import.meta.url), 'utf8');
const scope = 'https://example.github.io/whitenoise/';

function setup({ failPath, networkFails = false } = {}) {
  const handlers = new Map();
  const stores = new Map();
  const downloaded = [];
  const network = [];
  let claims = 0;
  let activations = 0;
  const keyOf = request => typeof request === 'string' ? request : request.url ?? request.href;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async addAll(urls) {
          downloaded.push(...urls);
          if (urls.some(url => url.includes(failPath ?? '\u0000'))) throw new Error('Download failed');
          for (const url of urls) entries.set(url, { url, cached: true });
        },
        async match(request, options = {}) {
          let key = keyOf(request);
          if (options.ignoreSearch) { const url = new URL(key); url.search = ''; key = url.href; }
          return entries.get(key);
        },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const self = {
    registration: { scope },
    location: { origin: new URL(scope).origin },
    clients: { async claim() { claims++; } },
    async skipWaiting() { activations++; },
    addEventListener(type, handler) { handlers.set(type, handler); },
  };
  vm.runInNewContext(code, {
    URL, self, caches,
    fetch: async request => {
      network.push(request);
      if (networkFails) throw new Error('Offline');
      return { url: request.url, network: true };
    },
  });
  async function dispatch(type, extra = {}) {
    let response;
    const waits = [];
    handlers.get(type)({
      ...extra,
      waitUntil(promise) { waits.push(promise); },
      respondWith(promise) { response = promise; },
    });
    await Promise.all(waits);
    return response;
  }
  async function offlineStatus(type) {
    let message;
    await dispatch('message', {
      data: { type },
      ports: [{ postMessage(value) { message = value; } }],
    });
    return message.ready;
  }
  return {
    dispatch,
    ready: () => offlineStatus('CHECK_OFFLINE'),
    ensure: () => offlineStatus('ENSURE_OFFLINE'),
    setFailPath: value => { failPath = value; },
    stores, downloaded, network,
    claims: () => claims, activations: () => activations,
  };
}

test('offline readiness requires the complete shell and all four sounds', async () => {
  const worker = setup();
  assert.equal(await worker.ready(), false);
  await worker.dispatch('install');
  assert.equal(await worker.ready(), true);
  assert.equal(worker.downloaded.filter(url => url.endsWith('.wav')).length, 4);
  assert.ok(worker.downloaded.every(url => url.startsWith(scope)), 'project subpath is preserved');
  for (const [name, entries] of worker.stores) {
    if (name.startsWith('still-whitenoise-')) entries.delete(`${scope}audio/rain.wav`);
  }
  assert.equal(await worker.ready(), false, 'missing audio cannot produce a ready claim');
});

test('failed precaching rejects installation and never reports offline readiness', async () => {
  const worker = setup({ failPath: '/audio/rain.wav' });
  await assert.rejects(worker.dispatch('install'), /Download failed/);
  assert.equal(await worker.ready(), false);
  assert.equal(worker.activations(), 0);
});

test('repair restores only missing files without re-downloading complete sounds', async () => {
  const worker = setup();
  await worker.dispatch('install');
  const initialDownloads = worker.downloaded.length;
  for (const entries of worker.stores.values()) entries.delete(`${scope}audio/rain.wav`);
  assert.equal(await worker.ready(), false);
  assert.equal(worker.downloaded.length, initialDownloads, 'readiness checks never download');
  assert.equal(await worker.ensure(), true);
  assert.deepEqual(worker.downloaded.slice(initialDownloads), [`${scope}audio/rain.wav`]);
  assert.equal(await worker.ready(), true);
  await worker.ensure();
  assert.equal(worker.downloaded.length, initialDownloads + 1, 'a complete cache needs no network');
  assert.equal(worker.activations(), 0, 'repair never forces worker activation or reload');
});

test('failed repair preserves cached assets and a later online retry succeeds', async () => {
  const worker = setup();
  await worker.dispatch('install');
  for (const entries of worker.stores.values()) entries.delete(`${scope}audio/rain.wav`);
  worker.setFailPath('/audio/rain.wav');
  assert.equal(await worker.ensure(), false);
  const fan = await worker.dispatch('fetch', { request: { url: `${scope}audio/box-fan.wav`, method: 'GET' } });
  assert.equal(fan.cached, true);
  assert.equal(await worker.ready(), false);
  worker.setFailPath(undefined);
  assert.equal(await worker.ensure(), true);
});

test('simultaneous repair requests share a single missing-asset download', async () => {
  const worker = setup();
  await worker.dispatch('install');
  const initialDownloads = worker.downloaded.length;
  for (const entries of worker.stores.values()) entries.delete(`${scope}audio/rain.wav`);
  assert.deepEqual(await Promise.all([worker.ensure(), worker.ensure()]), [true, true]);
  assert.equal(worker.downloaded.length, initialDownloads + 1);
});

test('activation removes only this app’s obsolete caches', async () => {
  const worker = setup();
  worker.stores.set('another-project-cache', new Map([['keep', true]]));
  worker.stores.set('still-whitenoise-obsolete', new Map());
  await worker.dispatch('install');
  await worker.dispatch('activate');
  assert.equal(worker.stores.has('another-project-cache'), true);
  assert.equal(worker.stores.has('still-whitenoise-obsolete'), false);
  assert.equal(await worker.ready(), true);
  assert.equal(worker.claims(), 1);
});

test('a new worker waits until an explicit update request', async () => {
  const worker = setup();
  await worker.dispatch('install');
  assert.equal(worker.activations(), 0);
  await worker.dispatch('message', { data: { type: 'ACTIVATE_UPDATE' } });
  assert.equal(worker.activations(), 1);
});

test('cached sounds and navigation work without network, including query strings', async () => {
  const worker = setup({ networkFails: true });
  await worker.dispatch('install');
  const sound = await worker.dispatch('fetch', { request: { url: `${scope}audio/rain.wav?v=1`, method: 'GET' } });
  assert.equal(sound.cached, true);
  assert.equal(worker.network.length, 0);
  const page = await worker.dispatch('fetch', { request: { url: `${scope}missing-path`, method: 'GET', mode: 'navigate' } });
  assert.equal(page.url, `${scope}index.html`);
  assert.equal(page.cached, true);
});

test('other projects, other origins, and mutations are left to the browser', async () => {
  const worker = setup();
  for (const request of [
    { url: 'https://example.github.io/another-app/', method: 'GET' },
    { url: 'https://elsewhere.example/', method: 'GET' },
    { url: `${scope}upload`, method: 'POST' },
  ]) assert.equal(await worker.dispatch('fetch', { request }), undefined);
  assert.equal(worker.network.length, 0);
});
