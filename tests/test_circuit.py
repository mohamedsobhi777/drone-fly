import json

import numpy as np
import pytest

from drone_fly.circuit import GRAPH, GRAPH_HASH, MANIFEST, Circuit, Readout, rewired_edges
from drone_fly.experiments import ARTIFACTS, KINDS, load_models, run_episode


def test_measured_data_hash_counts_and_output_reachability():
    assert GRAPH_HASH == MANIFEST["graphSha256"]
    assert len(GRAPH["nodes"]) == 80
    assert len(GRAPH["edges"]) == 1296
    assert sum(edge[2] for edge in GRAPH["edges"]) == 26029
    reached = set(i for i, _ in GRAPH["inputs"])
    for _ in range(80):
        for a, b, _ in GRAPH["edges"]:
            if a in reached and GRAPH["nodes"][a]["sign"]:
                reached.add(b)
    assert set(GRAPH["outputs"]) <= reached


def test_rewiring_preserves_degrees_and_changes_edges():
    old = np.array(GRAPH["edges"])
    new = rewired_edges(old)
    assert set(map(tuple, old[:, :2])) != set(map(tuple, new[:, :2]))
    for column in (0, 1):
        np.testing.assert_array_equal(
            np.bincount(old[:, column], minlength=80), np.bincount(new[:, column], minlength=80)
        )
    assert len(set(map(tuple, new[:, :2]))) == len(new)
    np.testing.assert_array_equal(old[:, 2], new[:, 2])


def test_actual_output_activity_depends_on_sensory_input_and_silencing():
    a, b = Circuit(), Circuit()
    for _ in range(8):
        first = a.step([0.3, -0.2, 0.4, 0.3, 1, 0.5, 0, 0])
        second = b.step([-0.3, 0.2, 0.4, 0.3, 1, 0.5, 0, 0])
    assert np.linalg.norm(first - second) > 0.01
    assert np.all(a.step(np.ones(8), "silence") == 0)
    assert np.all(b.step(np.ones(8), "outputs") == 0)
    b.reset()
    assert np.all(b.activity == 0)


def test_checkpoint_controls_commands_and_corruption_is_rejected(tmp_path):
    models = load_models()
    for kind in KINDS:
        readout = Readout(models["models"][kind]["coefficients"])
        circuit = Circuit(kind)
        for _ in range(10):
            output = circuit.step([0.3, 0.1, 0.4, 0.3, 1, 0.5, 0, 0])
        assert np.linalg.norm(readout.act(output) - Readout(np.zeros((113, 3))).act(output)) > 0.5
    models["graphHash"] = "incorrect"
    invalid = tmp_path / "invalid.json"
    invalid.write_text(json.dumps(models))
    with pytest.raises(ValueError):
        load_models(invalid)


def test_shipped_results_have_separated_seeds_and_all_conditions():
    models = load_models()
    report = json.loads((ARTIFACTS / "benchmark.json").read_text())
    assert not set(report["evaluationSeeds"]) & set(models["trainingSeeds"])
    assert len(report["conditions"]) == 8
    assert len(report["episodes"]) == len(report["evaluationSeeds"]) * 8
    for condition in report["conditions"]:
        episodes = [
            r
            for r in report["episodes"]
            if r["controller"] == condition["controller"] and r["intervention"] == condition["intervention"]
        ]
        assert sum(r["status"] == "complete" for r in episodes) == condition["completions"]


def test_held_out_neural_flight_completes_and_silencing_breaks_it():
    models = load_models()
    intact = run_episode(1000, "standard", "connectome", models)
    silenced = run_episode(1000, "standard", "connectome", models, "silence")
    assert intact["status"] == "complete"
    assert intact["passed"] == 5
    assert silenced["passed"] == 0
    assert silenced["status"] == "collision"
