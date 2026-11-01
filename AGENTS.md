# Working on Still

- The user wants this app published to their personal GitHub Pages site: https://ryanlmelvin.github.io/whitenoise/.
- Keep the app buildless and self-contained in `docs/`, with four sounds and a clean interface.
- Run `npm test` and `npm run check` before publishing. Audio checks must cover the full tracks for spikes as well as the circular loop seams.
- Bump the app-specific cache version in `docs/sw.js` for any shipped asset change. Never force a reload or update during playback.
- Keep all URLs relative for GitHub project Pages. Preserve other apps' caches on the shared github.io origin.
- Original code and illustrations are MIT; bundled sound files are CC0. Keep source/license provenance with the assets.
- Do not claim real-device or overnight playback testing unless it was actually performed.
