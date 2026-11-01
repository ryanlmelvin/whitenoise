# Still

Four comforting sounds, on repeat. A small, ad-free, offline-capable sleep sound PWA.

**[Open Still](https://ryanlmelvin.github.io/whitenoise/)**

- Box fan: a real fan recording.
- Rain: steady rainfall without thunder.
- White noise: an even wash of sound.
- Brown noise: a deeper, softer hush.

Tap a picture to play or pause. Set the volume. That's it. There are no ads, accounts, analytics, external fonts, or runtime dependencies. Your last sound and volume stay on your device; playback always requires a tap.

## Install and use offline

Open the app and select **Install on device**. On iPhone or iPad, open it in Safari, tap Share, then Add to Home Screen. On supported Android and desktop browsers, the button offers the browser's install prompt. Safari on a Mac offers File → Add to Dock.

Wait for **Ready offline** before disconnecting. This confirms the entire app and all four recordings were cached (about 6 MB). Browser storage can be removed by the browser or device, so check the status again before offline use. Installing in a different browser uses that browser's storage.

Background and lock-screen playback depend on browser and device support. Still requests a playback audio session where available and exposes media play/pause controls. Try locking your screen before relying on it overnight. Calls or another audio app may interrupt playback; tap play to resume. This release has browser and automated checks, not a physical iPhone overnight test.

## Audio quality

Four 30-second mono PCM16 WAVs at 24 kHz avoid compressed-audio padding. Prepared circular crossfades create continuous boundaries without fading each loop to silence. `AudioBufferSourceNode.loop` repeats on the audio rendering thread; no JavaScript interval restarts the sound. Starts, stops, switches, and volume changes use gain ramps.

Every shipped waveform is checked for clipping, peak ceilings, loudness changes, short transients, silent windows, and seam discontinuities. See [the audio report](reports/audio/README.md) for full-track envelopes, seam plots, measurements, thresholds, and reproduction instructions. These checks describe the files, not the final sound pressure of a phone or speaker.

## Develop

Requires Node.js 22+ and Python 3 for the local web server. No package installation or build is needed.

```sh
npm run dev
npm test
npm run check
```

Open `http://127.0.0.1:4186`. Use a unique local origin if another PWA was previously tested there; its service worker may serve an older app. Changes to shipped assets require bumping the cache version in `docs/sw.js`. An update waits while the app is open and is offered when playback is paused; it never automatically reloads a playing session.

The `docs/` directory is the complete static app. GitHub Actions runs behavior and audio checks before deploying it to GitHub Pages. All URLs are relative so installation and offline playback work beneath `/whitenoise/`.

## License

Original application code and illustrations: [MIT](LICENSE).

Bundled fan and rain recordings, plus the generated white and brown noise files: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). See [sound provenance and credits](docs/audio/LICENSE.txt). CC0 assets can be redistributed and modified without requiring the application code to use a particular license. Credits are retained voluntarily. See the [Creative Commons CC0 FAQ](https://wiki.creativecommons.org/wiki/CC0_FAQ).
