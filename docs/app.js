import { SOUNDS, SoundPlayer } from './audio-engine.js';

const $ = selector => document.querySelector(selector);
const cards = [...document.querySelectorAll('[data-sound]')];
const playIcon = '<path d="m9 6 9 6-9 6Z"/>';
const pauseIcon = '<path d="M7 5h4v14H7zm6 0h4v14h-4z"/>';
const soundName = id => SOUNDS.find(sound => sound.id === id)?.name ?? 'Box fan';
const busy = () => ['playing', 'loading'].includes(player.state);
let selected = 'box-fan';
let savedVolume = 45;
try {
  const saved = JSON.parse(localStorage.getItem('still-preferences'));
  if (SOUNDS.some(sound => sound.id === saved?.sound)) selected = saved.sound;
  if (Number.isFinite(saved?.volume)) savedVolume = Math.min(100, Math.max(0, saved.volume));
} catch { /* Storage may be disabled; audio still works. */ }

// Ask supported devices for the audio session intended for background media.
try { if ('audioSession' in navigator) navigator.audioSession.type = 'playback'; } catch { /* Optional API. */ }

const player = new SoundPlayer({
  onChange: ({ state, sound }) => {
    selected = sound;
    const active = state === 'playing' || state === 'loading';
    document.body.classList.toggle('is-playing', state === 'playing');
    $('#player-title').textContent = soundName(sound);
    $('#player-label').textContent = state === 'playing' ? 'PLAYING · ON REPEAT' : state === 'loading' ? 'GETTING COMFORTABLE' : '';
    $('#player-label').hidden = !$('#player-label').textContent;
    $('#play-button').setAttribute('aria-label', `${active ? 'Pause' : 'Play'} ${soundName(sound)}`);
    $('#play-button svg').innerHTML = active ? pauseIcon : playIcon;
    for (const card of cards) {
      const playing = card.dataset.sound === sound && active;
      card.setAttribute('aria-pressed', String(playing));
      card.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${soundName(card.dataset.sound)}`);
      card.querySelector('svg').innerHTML = playing ? pauseIcon : playIcon;
    }
    $('#playback-note').textContent = state === 'loading' ? 'Getting your sound ready…' : state === 'interrupted' ? 'Playback was interrupted. Tap play to settle back in.' : '';
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = state === 'playing' ? 'playing' : 'paused';
      if ('MediaMetadata' in window) navigator.mediaSession.metadata = new MediaMetadata({
        title: soundName(sound), artist: 'Still', album: 'Still',
        artwork: [{ src: new URL('./images/app-icon-512.png', location.href).href, sizes: '512x512', type: 'image/png' }],
      });
    }
    showUpdate();
    savePreferences();
  },
  onError: error => {
    console.warn('Still could not start audio:', error);
    $('#playback-note').textContent = navigator.onLine ? 'Couldn’t start the sound. Tap play to try again.' : 'This sound isn’t saved yet. Connect once, then try again.';
  },
});
player.sound = selected;
$('#player-title').textContent = soundName(selected);
$('#play-button').setAttribute('aria-label', `Play ${soundName(selected)}`);

function savePreferences() {
  try { localStorage.setItem('still-preferences', JSON.stringify({ sound: selected, volume: Number($('#volume').value) })); } catch { /* Optional persistence. */ }
}
function updateVolume(value) {
  $('#volume').value = value;
  $('#volume').style.setProperty('--volume', `${value}%`);
  $('#volume').setAttribute('aria-valuetext', `${value} percent`);
  $('#volume-value').textContent = `${value}%`;
  player.setVolume(value / 100);
}
updateVolume(savedVolume);
$('#volume').addEventListener('input', event => { updateVolume(Number(event.target.value)); savePreferences(); });
for (const card of cards) card.addEventListener('click', () => {
  if (card.dataset.sound === selected && busy()) player.pause();
  else player.play(card.dataset.sound);
});
$('#play-button').addEventListener('click', () => busy() ? player.pause() : player.play(selected));
if ('mediaSession' in navigator) {
  for (const [action, handler] of Object.entries({ play: () => player.play(selected), pause: () => player.pause(), stop: () => player.pause() })) {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* Action support varies. */ }
  }
}

for (const dialog of document.querySelectorAll('dialog')) {
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
}
$('#sound-credits-button').addEventListener('click', () => $('#sound-credits-dialog').showModal());
$('#credits-back-button').addEventListener('click', () => $('#sound-credits-dialog').close());
$('#about-button').addEventListener('click', () => $('#about-dialog').showModal());
$('#headphone-safety-button').addEventListener('click', () => $('#headphone-safety-dialog').showModal());

let installPrompt;
let offlineReady = false;
const standalone = matchMedia('(display-mode: standalone)');
function updateInstallButton() {
  const installed = standalone.matches || navigator.standalone === true;
  $('#install-button').disabled = installed;
  if (installed) $('#install-button').textContent = 'Installed on this device';
}
updateInstallButton();
standalone.addEventListener('change', updateInstallButton);
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; });
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $('#install-button').textContent = 'Installed on this device';
  $('#install-button').disabled = true;
  $('#install-dialog').close();
});
$('#install-button').addEventListener('click', async () => {
  if (installPrompt) {
    const prompt = installPrompt;
    installPrompt = null;
    try { await prompt.prompt(); await prompt.userChoice; return; } catch { /* Show manual steps if unavailable. */ }
  }
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const safari = /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent);
  $('#install-instructions').innerHTML = ios
    ? '<ol><li>Open this page in <strong>Safari</strong>.</li><li>Tap <strong>Share</strong> (the square with an arrow).</li><li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>. If shown, leave <strong>Open as Web App</strong> on.</li></ol>'
    : safari && /Mac/.test(navigator.platform)
      ? '<ol><li>In Safari’s menu bar, choose <strong>File → Add to Dock</strong>.</li><li>Choose <strong>Add</strong>, then open Still from your Dock.</li></ol>'
      : '<ol><li>Open your browser’s menu.</li><li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li><li>If that option is missing, try Chrome or Edge, or bookmark Still to come back anytime.</li></ol>';
  $('#install-offline-note').textContent = offlineReady ? 'All four sounds are saved and ready offline on this browser.' : 'Keep Still open until “Ready offline” appears to save all four sounds.';
  $('#install-dialog').showModal();
});

let registration;
let reloading = false;
let registrationTask;
let offlineCheckId = 0;
const watchedRegistrations = new WeakSet();
const watchedWorkers = new WeakSet();
function showUpdate() {
  $('#update-notice').hidden = !registration?.waiting || busy();
}
$('#update-button').addEventListener('click', () => {
  if (!busy() && registration?.waiting) {
    reloading = true;
    registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
  }
});
function showOfflineReady() {
  offlineReady = true;
  $('#offline-status').classList.add('ready');
  $('#offline-status').innerHTML = '<span aria-hidden="true"></span>Ready offline';
  $('#install-offline-note').textContent = 'All four sounds are saved and ready offline on this browser.';
}
function showOfflineIncomplete(message = 'Reconnect to save sounds') {
  offlineReady = false;
  $('#offline-status').classList.remove('ready');
  $('#offline-status').innerHTML = `<span aria-hidden="true"></span>${message}`;
  $('#install-offline-note').textContent = 'Keep Still open while connected to save all four sounds.';
}
function requestOfflineStatus(worker, type) {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    const finish = result => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(result);
    };
    // An older worker may not understand a repair request. Never wait forever.
    const timeout = setTimeout(() => finish(undefined), 45000);
    channel.port1.onmessage = event => finish(event.data?.ready);
    try { worker.postMessage({ type }, [channel.port2]); }
    catch { finish(undefined); }
  });
}
async function verifyOfflineCache(worker) {
  if (!worker) return;
  const checkId = ++offlineCheckId;
  let ready = await requestOfflineStatus(worker, 'CHECK_OFFLINE');
  if (checkId !== offlineCheckId) return;
  if (ready === false && navigator.onLine) {
    showOfflineIncomplete('Saving sounds for offline use…');
    ready = await requestOfflineStatus(worker, 'ENSURE_OFFLINE');
  }
  if (checkId !== offlineCheckId) return;
  if (ready) showOfflineReady();
  else showOfflineIncomplete(navigator.onLine ? 'Offline saving incomplete. Reopen to retry.' : 'Reconnect to save sounds');
}
function watchInstallingWorker(worker) {
  if (!worker || watchedWorkers.has(worker)) return;
  watchedWorkers.add(worker);
  const stateChanged = () => {
    if (worker.state === 'installed') {
      showUpdate();
      // The registration's waiting slot may settle after this state event.
      setTimeout(showUpdate, 0);
    }
    if (worker.state === 'activated') verifyOfflineCache(worker);
    if (worker.state === 'redundant' && !offlineReady) showOfflineIncomplete();
  };
  worker.addEventListener('statechange', stateChanged);
  stateChanged();
}
function prepareOffline() {
  if (registrationTask) return registrationTask;
  registrationTask = (async () => {
    try {
      // Register again after reconnecting: a failed first install can leave no active worker.
      const reg = await navigator.serviceWorker.register('./sw.js');
      registration = reg;
      showUpdate();
      if (!watchedRegistrations.has(reg)) {
        watchedRegistrations.add(reg);
        reg.addEventListener('updatefound', () => watchInstallingWorker(reg.installing));
      }
      watchInstallingWorker(reg.installing);
      if (reg.active) await verifyOfflineCache(reg.active);
      if (!reg.installing && !reg.waiting && navigator.onLine) {
        try { await reg.update(); } catch { /* Keep cached playback available if the update check fails. */ }
        watchInstallingWorker(reg.installing);
        showUpdate();
      }
    } catch { showOfflineIncomplete('Offline saving unavailable. Reconnect to retry.'); }
    finally { registrationTask = null; }
  })();
  return registrationTask;
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading && !busy()) location.reload();
    else verifyOfflineCache(navigator.serviceWorker.controller);
  });
  window.addEventListener('online', prepareOffline);
  window.addEventListener('focus', prepareOffline);
  window.addEventListener('pageshow', prepareOffline);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') prepareOffline();
  });
  prepareOffline();
} else $('#offline-status').innerHTML = '<span aria-hidden="true"></span>Online playback';
