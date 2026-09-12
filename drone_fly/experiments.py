"""Reproducible training and held-out evaluation; also used by the local workbench."""

import argparse
import json
import os
import time
from pathlib import Path

import numpy as np

from .circuit import GRAPH_HASH, Circuit, Readout
from .physics import Flight
from .vision import encode, visual_servo

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / "artifacts"
KINDS = ("connectome", "rewired", "random")
VERSION = "drone-fly-camera-v1"


def emit(event, **values):
    print(json.dumps({"event": event, **values}, allow_nan=False), flush=True)


def save_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f".tmp-{os.getpid()}")
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")
    temporary.replace(path)


def load_models(path=None):
    path = Path(path or ARTIFACTS / "models.json")
    data = json.loads(path.read_text())
    if data.get("version") != VERSION or data.get("graphHash") != GRAPH_HASH:
        raise ValueError("Checkpoint does not match the observation contract and measured graph")
    if set(data.get("models", {})) != set(KINDS):
        raise ValueError("Checkpoint must contain all three matched substrates")
    for model in data["models"].values():
        coefficients = np.asarray(model.get("coefficients", []))
        if coefficients.shape != (113, 3) or not np.isfinite(coefficients).all():
            raise ValueError("Invalid trained readout coefficients")
    return data


def train(courses=24, output=ARTIFACTS):
    started = time.perf_counter()
    rng = np.random.default_rng(20260913)
    readouts = {kind: Readout() for kind in KINDS}
    xs = {kind: [] for kind in KINDS}
    ys = []
    seeds = list(range(100, 100 + courses))
    teacher_results = []
    for i, seed in enumerate(seeds):
        circuits = {kind: Circuit(kind) for kind in KINDS}
        difficulty = ("standard", "slalom", "gusts")[i % 3]
        with Flight(seed, difficulty) as flight:
            while flight.status == "flying":
                obs, _, _ = encode(flight.observe(), flight.velocity)
                target = visual_servo(obs)
                for kind in KINDS:
                    xs[kind].append(readouts[kind].features(circuits[kind].step(obs)))
                ys.append(target)
                # Shared exploration improves coverage; it is independent of each substrate.
                perturbation = rng.normal(0, [0.06, 0.18, 0.12])
                flight.step(target + perturbation)
            teacher_results.append({"seed": seed, "difficulty": difficulty, **flight.snapshot()})
        emit(
            "progress",
            phase="collect",
            current=i + 1,
            total=courses,
            samples=len(ys),
            message=f"Collected shared camera observations · course {i + 1}/{courses}",
        )
    models = {}
    for kind in KINDS:
        mse = readouts[kind].fit(xs[kind], ys)
        models[kind] = {"coefficients": readouts[kind].coefficients.tolist(), "trainingMSE": mse}
        emit(
            "progress",
            phase="fit",
            kind=kind,
            mse=mse,
            message=f"Fitted {kind} readout · training MSE {mse:.5f}",
        )
    artifact = {
        "version": VERSION,
        "graphHash": GRAPH_HASH,
        "method": "ridge imitation of visual servo",
        "trainingSeeds": seeds,
        "trainingRNG": 20260913,
        "samples": len(ys),
        "trainableParametersPerModel": 339,
        "regularization": 0.02,
        "wallSeconds": time.perf_counter() - started,
        "models": models,
        "teacherResults": teacher_results,
    }
    save_json(Path(output) / "models.json", artifact)
    emit(
        "complete",
        phase="train",
        path=str(Path(output) / "models.json"),
        seconds=artifact["wallSeconds"],
        samples=len(ys),
    )
    return artifact


def run_episode(seed, difficulty, controller, models, intervention="none"):
    circuit = Circuit(controller if controller in KINDS else "connectome")
    readout = Readout(models["models"][controller]["coefficients"]) if controller in KINDS else None
    with Flight(seed, difficulty) as flight:
        while flight.status == "flying":
            obs, _, _ = encode(flight.observe(), flight.velocity, intervention)
            output = circuit.step(obs, intervention)
            command = visual_servo(obs) if controller == "servo" else readout.act(output)
            flight.step(command)
        return {
            "seed": seed,
            "difficulty": difficulty,
            "controller": controller,
            "intervention": intervention,
            **flight.snapshot(),
        }


def benchmark(courses=12, output=ARTIFACTS, models_path=None):
    started = time.perf_counter()
    models = load_models(models_path)
    seeds = list(range(1000, 1000 + courses))
    if set(seeds) & set(models["trainingSeeds"]):
        raise ValueError("Evaluation seeds overlap training seeds")
    conditions = [(k, "none") for k in (*KINDS, "servo")] + [
        ("connectome", intervention) for intervention in ("blind", "left-eye", "silence", "outputs")
    ]
    results, summaries = [], []
    for controller, intervention in conditions:
        rows = []
        for i, seed in enumerate(seeds):
            difficulty = ("standard", "slalom", "gusts")[i % 3]
            row = run_episode(seed, difficulty, controller, models, intervention)
            rows.append(row)
            results.append(row)
            emit(
                "progress",
                phase="evaluate",
                current=len(results),
                total=courses * len(conditions),
                message=f"{controller} / {intervention} · {i + 1}/{courses} courses",
                result=row,
            )
        completions = sum(r["status"] == "complete" for r in rows)
        n = len(rows)
        p = completions / n
        # Wilson interval for completion; repeated courses across conditions are paired.
        z = 1.96
        center = (p + z * z / (2 * n)) / (1 + z * z / n)
        radius = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
        summaries.append(
            {
                "controller": controller,
                "intervention": intervention,
                "courses": n,
                "completions": completions,
                "completionRate": p,
                "completionCI95": [float(center - radius), float(center + radius)],
                "meanGates": float(np.mean([r["passed"] for r in rows])),
                "collisions": sum(r["status"] == "collision" for r in rows),
                "meanTime": float(np.mean([r["time"] for r in rows])),
            }
        )
    report = {
        "version": VERSION,
        "graphHash": GRAPH_HASH,
        "evaluationSeeds": seeds,
        "trainingSeeds": models["trainingSeeds"],
        "conditions": summaries,
        "episodes": results,
        "wallSeconds": time.perf_counter() - started,
        "scope": "Camera fiducial navigation in generic MuJoCo quadcopter; no hardware or biological validation. "
        "One fitted checkpoint per substrate; paired courses, not independent training replications.",
    }
    save_json(Path(output) / "benchmark.json", report)
    emit("complete", phase="evaluate", conditions=summaries, seconds=report["wallSeconds"])
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["train", "benchmark"])
    parser.add_argument("--courses", type=int)
    parser.add_argument("--output", type=Path, default=ARTIFACTS)
    parser.add_argument("--models", type=Path)
    args = parser.parse_args()
    courses = args.courses or (24 if args.mode == "train" else 12)
    if not 1 <= courses <= 100:
        parser.error("courses must be between 1 and 100")
    if args.mode == "train":
        train(courses, args.output)
    else:
        benchmark(courses, args.output, args.models)


if __name__ == "__main__":
    main()
