#!/usr/bin/env python3
"""Render independent waveform QA figures; requires NumPy and Matplotlib."""
import os
from pathlib import Path
import tempfile
import wave

os.environ.setdefault("MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / "whitenoise-matplotlib"))
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
NAMES = ["box-fan", "rain", "white-noise", "brown-noise"]
fig, axes = plt.subplots(4, 2, figsize=(14, 11), layout="constrained")
fig.suptitle("Whitenoise • shipped audio verification\nFull-track level envelope and sample-level loop boundaries", fontsize=18)
for row, name in enumerate(NAMES):
    with wave.open(str(ROOT / f"docs/audio/{name}.wav")) as source:
        rate = source.getframerate()
        x = np.frombuffer(source.readframes(source.getnframes()), dtype="<i2").astype(float) / 32768
    windows = x.reshape(-1, 240)
    time = np.arange(len(windows)) * .01
    peak = np.max(np.abs(windows), axis=1)
    rms = np.sqrt(np.mean(windows ** 2, axis=1))
    ax = axes[row, 0]
    ax.fill_between(time, 20 * np.log10(peak), -42, color="#c6d4d0", label="10 ms peak envelope")
    ax.plot(time, 20 * np.log10(rms), color="#24785f", linewidth=.7, label="10 ms RMS")
    ax.axhline(-12, color="#bb5e45", linestyle="--", linewidth=.8, label="Peak ceiling")
    ax.set(xlim=(0, 30), ylim=(-42, -10), title=name.replace("-", " ").title(), ylabel="Level (dBFS)", xlabel="Time (seconds)")
    ax.grid(alpha=.18)
    if row == 0:
        ax.legend(fontsize=8, loc="lower right")
    # Plot the actual consecutive samples across two concatenated loop copies.
    count = round(rate * .008)
    seam = np.r_[x[-count:], x[:count]]
    t = np.arange(-count, count) / rate * 1000
    ax = axes[row, 1]
    ax.plot(t, seam, linewidth=.7, color="#4e6c9c")
    ax.axvline(-.5 / rate * 1000, color="#bb5e45", linestyle="--", linewidth=1, label="Last sample → first sample")
    ax.set(xlim=(-8, 8), ylim=(-.27, .27), title="Loop join (±8 milliseconds)", ylabel="Sample amplitude", xlabel="Time from loop boundary (ms)")
    ax.grid(alpha=.18)
    if row == 0:
        ax.legend(fontsize=8, loc="lower right")
out = ROOT / "reports/audio/waveforms.png"
fig.savefig(out, dpi=150)
print(out)
