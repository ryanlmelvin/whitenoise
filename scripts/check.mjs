import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
for (const name of ['app.js', 'audio-engine.js', 'sw.js']) {
  execFileSync(process.execPath, ['--check', new URL(`docs/${name}`, root).pathname]);
}
const manifest = JSON.parse(readFileSync(new URL('docs/manifest.webmanifest', root)));
for (const key of ['id', 'start_url', 'scope']) assert.equal(manifest[key], './', `${key} must work under the GitHub Pages subpath`);
assert.equal(manifest.display, 'standalone');
for (const icon of manifest.icons) assert(existsSync(new URL(`docs/${icon.src}`, root)), `Missing ${icon.src}`);
const html = readFileSync(new URL('docs/index.html', root), 'utf8');
for (const [, ref] of html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)) {
  assert(existsSync(new URL(`docs/${ref}`, root)), `Missing linked asset ${ref}`);
}
const sw = readFileSync(new URL('docs/sw.js', root), 'utf8');
for (const [, ref] of sw.matchAll(/'((?:\.\/)[^']+)'/g)) {
  assert(existsSync(new URL(`docs/${ref}`, root)), `Missing offline asset ${ref}`);
}
assert.equal([...html.matchAll(/data-sound=/g)].length, 4);
execFileSync(process.execPath, [new URL('scripts/check-audio.mjs', root).pathname], { stdio: 'inherit' });
console.log('App checks passed: syntax, install manifest, linked assets, and offline assets.');
