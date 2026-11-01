#!/usr/bin/env node
// Analyze the shipped PCM, not source recordings or assumed processing settings.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const names = ['box-fan', 'rain', 'white-noise', 'brown-noise'];
const db = value => 20 * Math.log10(Math.max(value, 1e-15));
const round = value => Math.round(value * 10000) / 10000;
const reports = [];

for (const name of names) {
  const data = readFileSync(new URL(`docs/audio/${name}.wav`, root));
  assert.equal(data.toString('ascii', 0, 4), 'RIFF');
  assert.equal(data.toString('ascii', 8, 12), 'WAVE');
  let format, payload;
  for (let offset = 12; offset + 8 <= data.length;) {
    const type = data.toString('ascii', offset, offset + 4);
    const length = data.readUInt32LE(offset + 4);
    if (type === 'fmt ') format = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'data') payload = data.subarray(offset + 8, offset + 8 + length);
    offset += 8 + length + (length % 2);
  }
  assert(format && payload, `${name}: valid WAV chunks`);
  assert.equal(format.readUInt16LE(0), 1, `${name}: uncompressed PCM`);
  assert.equal(format.readUInt16LE(2), 1, `${name}: mono`);
  const rate = format.readUInt32LE(4);
  assert.equal(rate, 24000);
  assert.equal(format.readUInt16LE(14), 16);
  const n = payload.length / 2;
  assert.equal(n / rate, 30, `${name}: full 30-second buffer`);
  const x = Float64Array.from({ length: n }, (_, i) => payload.readInt16LE(i * 2) / 32768);
  let sum = 0, energy = 0, peak = 0, clipped = 0;
  const differences = new Float64Array(n - 1);
  for (let i = 0; i < n; i++) {
    sum += x[i]; energy += x[i] ** 2; peak = Math.max(peak, Math.abs(x[i]));
    if (Math.abs(x[i]) >= 32767 / 32768) clipped++;
    if (i) differences[i - 1] = Math.abs(x[i] - x[i - 1]);
  }
  differences.sort();
  const rms = Math.sqrt(energy / n);
  const seamStep = Math.abs(x[0] - x[n - 1]);
  const stepP99 = differences[Math.floor(differences.length * .99)];
  const prefix = new Float64Array(n + rate + 1);
  for (let i = 0; i < n + rate; i++) prefix[i + 1] = prefix[i] + x[i % n] ** 2;
  const windows = {};
  const series = {};
  // A 1 ms hop measures the entire circular buffer, including every loop join.
  for (const ms of [10, 50, 250, 1000]) {
    const width = rate * ms / 1000;
    let minimum = Infinity, maximum = 0;
    series[ms] = [];
    for (let i = 0; i < n; i += rate / 1000) {
      const value = Math.sqrt((prefix[i + width] - prefix[i]) / width);
      minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
      series[ms].push(value);
    }
    windows[ms] = { minimum_dbfs: round(db(minimum)), maximum_dbfs: round(db(maximum)) };
  }
  const transientDb = Math.max(...series[10].map((value, i) => db(value / series[250][i])));
  assert.equal(clipped, 0, `${name}: no clipped samples`);
  assert(db(peak) <= -12, `${name}: peak ceiling -12 dBFS`);
  assert(Math.abs(db(rms) + 23) < .02, `${name}: matched -23 dBFS RMS`);
  assert(db(peak / rms) < 11, `${name}: bounded crest factor`);
  assert(Math.abs(sum / n) < .0001, `${name}: negligible DC`);
  assert(seamStep < stepP99, `${name}: seam step below normal 99th percentile`);
  assert(windows[10].minimum_dbfs > -40, `${name}: no silent 10 ms windows`);
  assert(windows[10].maximum_dbfs < -17.5, `${name}: no loud 10 ms bursts`);
  assert(windows[50].maximum_dbfs < -20, `${name}: no loud 50 ms bursts`);
  assert(windows[1000].minimum_dbfs > -24, `${name}: sustained level floor`);
  assert(windows[1000].maximum_dbfs < -22.5, `${name}: sustained level ceiling`);
  assert(transientDb < 6, `${name}: no isolated 10 ms burst >6 dB over local 250 ms`);
  reports.push({
    file: `${name}.wav`, duration_seconds: n / rate, sample_rate: rate,
    rms_dbfs: round(db(rms)), peak_dbfs: round(db(peak)), crest_factor_db: round(db(peak / rms)),
    clipped_samples: clipped, dc_offset: sum / n,
    seam_step: seamStep, normal_step_99th_percentile: stepP99,
    maximum_10ms_to_250ms_db: round(transientDb), windows,
  });
}

if (process.argv.includes('--report')) {
  const output = new URL('reports/audio/measurements.json', root);
  writeFileSync(output, JSON.stringify({ method: 'Sliding circular RMS, 1 ms hop; PCM16 samples / 32768', tracks: reports }, null, 2) + '\n');
  console.log(`Wrote ${fileURLToPath(output)}`);
}
console.log('Audio checks passed: all four loops, entire waveforms and circular boundaries; no clipped samples, silent windows, or transient-limit violations.');
