#!/usr/bin/env python3
"""Reproduce the four sleep loops. Requires Python 3, NumPy and ffmpeg.

Downloads the two CC0 source recordings into a caller-selected cache directory.
No source account or API key is required. All transformations are deterministic.
Run: python3 scripts/prepare-audio.py --source-dir /tmp/whitenoise-audio-source
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request
import wave
import zipfile

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RATE = 24000
SOURCES = {
    "box-fan-source.mp3": (
        "https://cdn.freesound.org/previews/824/824852_17819872-hq.mp3",
        "81d762a382973e02aef36024ef3444acef94e83e534bbb4dbc78716c5a2c5a79",
    ),
    "rain.zip": (
        "https://opengameart.org/sites/default/files/Rain%20OGG.zip",
        "e68f3e1c77493cf43bec84cebff5043bff6be9ce16d59b24caa988cd460aa75b",
    ),
}


def download(path, url):
    if not path.exists():
        request = urllib.request.Request(url, headers={"User-Agent": "Whitenoise audio preparation/1.0"})
        with urllib.request.urlopen(request, timeout=90) as response:
            path.write_bytes(response.read())


def decode(path):
    raw = subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(RATE),
        "-f", "f32le", "-",
    ])
    return np.frombuffer(raw, dtype="<f4").astype(np.float64)


def bandlimit(x, low=50, high=9000):
    """Smooth, zero-phase filtering; high-pass suppresses wind/handling rumble."""
    f = np.fft.rfftfreq(len(x), 1 / RATE)
    hp = (f / max(low, 1)) ** 4
    hp = np.sqrt(hp / (1 + hp))
    lp = 1 / np.sqrt(1 + (f / high) ** 12)
    return np.fft.irfft(np.fft.rfft(x) * hp * lp, n=len(x))


def circular_smooth(x, sigma):
    f = np.fft.rfftfreq(len(x), 1 / RATE)
    return np.fft.irfft(np.fft.rfft(x) * np.exp(-2 * (np.pi * sigma * f) ** 2), n=len(x))


def join(x, seconds=3):
    """Overlap endpoints, preserving a natural adjacent-sample wrap.

    The outgoing last 3 s overlaps the incoming first 3 s at constant power.
    The exported boundary is in the original continuous recording (no fades to
    silence and no duplicated endpoint). AudioBufferSourceNode.loop can play it
    without timers, decoder padding, or scheduling gaps.
    """
    n = round(seconds * RATE)
    phase = np.linspace(0, np.pi / 2, n, endpoint=True)
    overlap = x[-n:] * np.cos(phase) + x[:n] * np.sin(phase)
    return np.concatenate([x[n:-n], overlap])


def finish(x):
    """Bound peaks and level slow fluctuations without introducing a seam.

    All smoothing is circular; the same gain trajectory continues across the
    join. Gaussian 120 ms RMS leveling is followed by a fast, smooth transient
    gain reduction and saturating peak ceiling. A final common RMS target keeps
    switching levels consistent.
    """
    x = x - np.mean(x)
    envelope = np.sqrt(np.maximum(circular_smooth(x * x, 0.12), 1e-12))
    x = x * (0.075 / envelope)
    fast_envelope = np.sqrt(np.maximum(circular_smooth(x * x, 0.008), 1e-12))
    transient_gain = np.minimum(1, 0.095 / fast_envelope)
    x *= circular_smooth(transient_gain, 0.004)
    x = 0.21 * np.tanh(x / 0.21)
    x -= np.mean(x)
    x *= 10 ** (-23 / 20) / np.sqrt(np.mean(x * x))
    # Pick an ordinary low-amplitude continuous crossing as the file boundary.
    # This is a rotation, not editing or duplicating samples at the seam.
    delta = np.abs(x - np.roll(x, 1))
    candidates = np.flatnonzero((delta < np.percentile(delta, 20)) & (np.abs(x) < 0.01))
    offset = int(candidates[len(candidates) // 2])
    return np.roll(x, -offset)


def write_wav(path, x):
    assert np.max(np.abs(x)) < 0.27, "Unexpected peak after mastering"
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(np.rint(x * 32767).astype("<i2").tobytes())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    args = parser.parse_args()
    args.source_dir.mkdir(parents=True, exist_ok=True)
    hashes = {}
    for name, (url, expected) in SOURCES.items():
        path = args.source_dir / name
        download(path, url)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if expected and digest != expected:
            raise ValueError(f"Source checksum mismatch: {name}")
        hashes[name] = {"url": url, "sha256": digest}
    with zipfile.ZipFile(args.source_dir / "rain.zip") as archive:
        # Extract only the explicitly selected safe member.
        rain_path = args.source_dir / "rain-selected.ogg"
        rain_path.write_bytes(archive.read("4.ogg"))
    fan = decode(args.source_dir / "box-fan-source.mp3")[36 * RATE:69 * RATE]
    rain = decode(rain_path)[2 * RATE:35 * RATE]
    rng = np.random.default_rng(20261101)
    white = rng.standard_normal(30 * RATE)
    brown = rng.standard_normal(30 * RATE)
    f = np.fft.rfftfreq(len(brown), 1 / RATE)
    # 1/f amplitude (1/f² power), with a 40 Hz floor to remove subsonic energy.
    shape = 1 / np.sqrt(f * f + 40 ** 2)
    shape[0] = 0
    brown = np.fft.irfft(np.fft.rfft(brown) * shape, n=len(brown))
    signals = {
        "box-fan": finish(join(bandlimit(fan, 90, 7500))),
        "rain": finish(join(bandlimit(rain, 90, 8500))),
        "white-noise": finish(white),
        "brown-noise": finish(brown),
    }
    out = ROOT / "docs/audio"
    out.mkdir(parents=True, exist_ok=True)
    for name, data in signals.items():
        write_wav(out / f"{name}.wav", data)
    report = ROOT / "reports/audio"
    report.mkdir(parents=True, exist_ok=True)
    (report / "source-checksums.json").write_text(json.dumps(hashes, indent=2) + "\n")
    print("Wrote four 30-second, 24 kHz mono PCM16 WAV loops.")


if __name__ == "__main__":
    main()
