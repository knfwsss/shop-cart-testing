#!/usr/bin/env python3
"""Разбор сырых результатов k6 (results/raw/*.json.gz): графики и сводка по этапам.

Запуск из папки shop-cart: python3 tests/lr5_load/analyze.py <папка_для_графиков>
"""
import gzip
import json
import math
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

RESULTS = Path(__file__).parent / "results"
BUCKET = 10

# Окна, где нагрузка постоянна (секунды от старта сценариев).
WINDOWS = {
    "load": [("Удержание 50 VU", 60, 300, 50)],
    "stress": [
        (f"{vu} VU", 30 + i * 90, 90 + i * 90, vu)
        for i, vu in enumerate([50, 100, 200, 400, 600])
    ],
    "spike": [
        ("До скачка, 10 VU", 5, 30, 10),
        ("Пик, 300 VU", 45, 100, 300),
        ("После спада, 10 VU", 120, 170, 10),
    ],
}


def parse_time(value):
    # k6 пишет время с наносекундами, а fromisoformat в Python 3.9 понимает только микросекунды.
    head, _, tz = value.partition("+")
    if not tz and value.endswith("Z"):
        head, tz = value[:-1], "00:00"
    if "." in head:
        base, frac = head.split(".")
        head = f"{base}.{frac[:6].ljust(6, '0')}"
    return datetime.fromisoformat(f"{head}+{tz}").timestamp()


def percentile(values, p):
    if not values:
        return float("nan")
    values = sorted(values)
    k = (len(values) - 1) * p / 100
    lo, hi = math.floor(k), math.ceil(k)
    return values[lo] + (values[hi] - values[lo]) * (k - lo)


def load_points(name):
    durations, failed, vus, by_endpoint = [], [], [], defaultdict(list)
    with gzip.open(RESULTS / "raw" / f"{name}.json.gz", "rt") as fh:
        for line in fh:
            if '"type":"Point"' not in line:
                continue
            item = json.loads(line)
            metric, data = item["metric"], item["data"]
            tags = data.get("tags") or {}
            if metric == "vus":
                vus.append((parse_time(data["time"]), data["value"]))
            elif tags.get("scenario") not in ("browse", "shop"):
                continue
            elif metric == "http_req_duration":
                t = parse_time(data["time"])
                durations.append((t, data["value"]))
                by_endpoint[tags.get("name", "?")].append((t, data["value"]))
            elif metric == "http_req_failed":
                failed.append((parse_time(data["time"]), data["value"]))
    t0 = min(t for t, _ in durations)
    shift = lambda rows: [(t - t0, v) for t, v in rows]  # noqa: E731
    return {
        "durations": shift(durations),
        "failed": shift(failed),
        "vus": shift(vus),
        "endpoints": {k: shift(v) for k, v in by_endpoint.items()},
    }


def bucketize(points):
    buckets = defaultdict(list)
    for t, v in points:
        if t >= 0:
            buckets[int(t // BUCKET)].append(v)
    return buckets


def window_stats(data, start, end):
    inside = [v for t, v in data["durations"] if start <= t < end]
    fails = [v for t, v in data["failed"] if start <= t < end]
    login = [v for t, v in data["endpoints"].get("login", []) if start <= t < end]
    checkout = [v for t, v in data["endpoints"].get("checkout", []) if start <= t < end]
    catalog = [v for t, v in data["endpoints"].get("catalog", []) if start <= t < end]
    return {
        "rps": round(len(inside) / (end - start), 1),
        "avg": round(sum(inside) / len(inside), 2),
        "p95": round(percentile(inside, 95), 2),
        "p99": round(percentile(inside, 99), 2),
        "max": round(max(inside), 2),
        "errors_pct": round(100 * sum(fails) / len(fails), 3) if fails else 0.0,
        "login_p95": round(percentile(login, 95), 2),
        "checkout_p95": round(percentile(checkout, 95), 2),
        "catalog_p95": round(percentile(catalog, 95), 2),
    }


def plot(name, data, out_dir):
    dur = bucketize(data["durations"])
    fail = bucketize(data["failed"])
    vu = bucketize(data["vus"])
    login = bucketize(data["endpoints"].get("login", []))
    keys = sorted(set(dur) | set(vu))
    x = [k * BUCKET for k in keys]

    fig, axes = plt.subplots(3, 1, figsize=(10, 9), sharex=True)
    axes[0].plot(x, [max(vu.get(k, [0])) for k in keys], color="#1f4e79", lw=2, label="Виртуальные пользователи (VU)")
    ax_rps = axes[0].twinx()
    ax_rps.plot(x, [len(dur.get(k, [])) / BUCKET for k in keys], color="#c55a11", lw=1.5, label="Запросов в секунду")
    axes[0].set_ylabel("VU")
    ax_rps.set_ylabel("RPS")
    lines = axes[0].get_lines() + ax_rps.get_lines()
    axes[0].legend(lines, [l.get_label() for l in lines], loc="upper left", fontsize=9)
    axes[0].set_title("Нагрузка и пропускная способность")

    axes[1].plot(x, [percentile(dur.get(k, []), 95) for k in keys], color="#2e7d32", lw=2, label="p95 всех запросов")
    axes[1].plot(x, [percentile(login.get(k, []), 95) for k in keys], color="#7b1fa2", lw=1.5, ls="--", label="p95 входа (login)")
    axes[1].axhline(500, color="#c62828", ls=":", lw=1.5, label="SLA: p95 < 500 мс")
    axes[1].set_ylabel("мс")
    axes[1].set_yscale("log")
    axes[1].legend(loc="upper left", fontsize=9)
    axes[1].set_title("Время ответа (p95, логарифмическая шкала)")

    axes[2].plot(x, [100 * sum(fail.get(k, [])) / max(len(fail.get(k, [])), 1) for k in keys], color="#c62828", lw=2, label="Доля ошибок")
    axes[2].axhline(1, color="#555", ls=":", lw=1.5, label="SLA: < 1 %")
    axes[2].set_ylim(-0.1, 2)
    axes[2].set_ylabel("%")
    axes[2].set_xlabel("Время от начала теста, с")
    axes[2].legend(loc="upper left", fontsize=9)
    axes[2].set_title("Ошибки (http_req_failed)")

    for ax in axes:
        ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_dir / f"{name}_график.png", dpi=150)
    plt.close(fig)


def plot_memory(out_dir):
    fig, ax = plt.subplots(figsize=(10, 3.6))
    for name, color in [("load", "#1f4e79"), ("stress", "#c55a11"), ("spike", "#2e7d32")]:
        rows = (RESULTS / f"{name}-memory.csv").read_text().strip().splitlines()[1:]
        xs, ys = zip(*[map(int, r.split(",")) for r in rows])
        ax.plot(xs, ys, lw=2, color=color, label=name)
    ax.set_xlabel("Время от запуска сервера, с")
    ax.set_ylabel("RSS, МБ")
    ax.set_title("Память процесса сервера во время тестов")
    ax.grid(alpha=0.3)
    ax.legend()
    fig.tight_layout()
    fig.savefig(out_dir / "память_сервера.png", dpi=150)
    plt.close(fig)


def plot_stress_steps(stats, out_dir):
    steps = stats["stress"]["windows"]
    labels = [s["label"] for s in steps]
    fig, ax = plt.subplots(figsize=(10, 3.8))
    ax.bar([i - 0.2 for i in range(len(steps))], [s["p95"] for s in steps], width=0.4, color="#2e7d32", label="p95 всех запросов, мс")
    ax.bar([i + 0.2 for i in range(len(steps))], [s["login_p95"] for s in steps], width=0.4, color="#7b1fa2", label="p95 входа, мс")
    ax.axhline(500, color="#c62828", ls=":", label="SLA 500 мс")
    ax.set_xticks(range(len(steps)))
    ax.set_xticklabels(labels)
    ax2 = ax.twinx()
    ax2.plot(range(len(steps)), [s["rps"] for s in steps], color="#c55a11", marker="o", lw=2, label="RPS")
    ax2.set_ylabel("RPS")
    ax.set_ylabel("мс")
    ax.set_title("Stress: время ответа и пропускная способность по ступеням")
    handles = ax.get_legend_handles_labels()[0] + ax2.get_legend_handles_labels()[0]
    ax.legend(handles, [h.get_label() for h in handles], loc="upper left", fontsize=9)
    ax.grid(alpha=0.3, axis="y")
    fig.tight_layout()
    fig.savefig(out_dir / "stress_ступени.png", dpi=150)
    plt.close(fig)


def main():
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else RESULTS
    out_dir.mkdir(parents=True, exist_ok=True)
    stats = {}
    for name in ["load", "stress", "spike"]:
        data = load_points(name)
        plot(name, data, out_dir)
        stats[name] = {
            "total_requests": len(data["durations"]),
            "duration_s": round(max(t for t, _ in data["durations"])),
            "windows": [
                {"label": label, "vus": vus, **window_stats(data, start, end)}
                for label, start, end, vus in WINDOWS[name]
            ],
        }
        print(name, json.dumps(stats[name], ensure_ascii=False, indent=1))
    plot_stress_steps(stats, out_dir)
    plot_memory(out_dir)
    (RESULTS / "windows-summary.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
