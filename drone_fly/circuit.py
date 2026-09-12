"""Fixed measured connectivity, plus topology controls with the same interfaces."""
import hashlib
import json
from pathlib import Path

import numpy as np

DATA = Path(__file__).parent / "data"
GRAPH_PATH = DATA / "graph.json"
GRAPH = json.loads(GRAPH_PATH.read_text())
GRAPH_HASH = hashlib.sha256(GRAPH_PATH.read_bytes()).hexdigest()
MANIFEST = json.loads((DATA / "manifest.json").read_text())
if GRAPH_HASH != MANIFEST["graphSha256"]:
    raise RuntimeError("Measured circuit hash does not match its pinned manifest")


def rewired_edges(edges, seed=19):
    """Directed double-edge swaps preserve each node's exact in/out degree."""
    out = np.array(edges, dtype=int).copy()
    rng = np.random.default_rng(seed)
    pairs = set(map(tuple, out[:, :2]))
    for _ in range(len(out) * 10):
        a, b = rng.choice(len(out), 2, replace=False)
        u, v = out[a, :2]
        x, y = out[b, :2]
        if u == y or x == v or (u, y) in pairs or (x, v) in pairs:
            continue
        pairs.remove((u, v))
        pairs.remove((x, y))
        pairs.update(((u, y), (x, v)))
        out[a, 1], out[b, 1] = y, v
    return out


class Circuit:
    def __init__(self, kind="connectome"):
        if kind not in {"connectome", "rewired", "random"}:
            raise ValueError("Unknown circuit substrate")
        self.kind = kind
        self.n = len(GRAPH["nodes"])
        edges = np.array(GRAPH["edges"])
        if kind == "rewired":
            edges = rewired_edges(edges)
        self.edges = edges
        signs = np.array([n["sign"] for n in GRAPH["nodes"]])
        self.w = np.zeros((self.n, self.n))
        for pre, post, count in edges:
            self.w[post, pre] = count * signs[pre]
        self.w /= np.maximum(1, np.abs(self.w).sum(axis=1))[:, None]
        self.inputs = np.array(GRAPH["inputs"])
        self.outputs = np.array(GRAPH["outputs"])
        self.activity = np.zeros(self.n)
        # A conventional fixed random feature substrate, dimension-matched at readout.
        rng = np.random.default_rng(19)
        self.random_projection = rng.normal(0, .65, (self.n, 8))
        self.random_bias = rng.normal(0, .2, self.n)

    def step(self, observation, intervention="none"):
        observation = np.asarray(observation, dtype=float)
        if observation.shape != (8,) or not np.isfinite(observation).all():
            raise ValueError("Eight finite observation channels required")
        if intervention == "silence":
            self.activity[:] = 0
        elif self.kind == "random":
            self.activity = .3 * self.activity + .7 * np.tanh(
                self.random_projection @ observation + self.random_bias)
        else:
            drive = np.zeros(self.n)
            drive[self.inputs[:, 0]] = 1.5 * observation[self.inputs[:, 1]]
            for _ in range(3):
                self.activity = .3 * self.activity + .7 * np.tanh(drive + 1.4 * (self.w @ self.activity))
                if intervention == "outputs":
                    self.activity[self.outputs] = 0
        if intervention == "outputs":
            self.activity[self.outputs] = 0
        return self.activity[self.outputs].copy()

    def reset(self):
        self.activity[:] = 0


class Readout:
    """Fixed nonlinear expansion of 16 output cells + trainable ridge readout.

The expansion never sees the camera features directly. All learned coefficients
are fitted on training data only. The bias remains active during circuit ablation.
"""
    def __init__(self, coefficients=None):
        rng = np.random.default_rng(37)
        self.projection = rng.normal(0, 1.4, (96, 16))
        self.bias = rng.normal(0, .35, 96)
        self.coefficients = None if coefficients is None else np.asarray(coefficients)

    def features(self, output):
        output = np.asarray(output) * 3
        return np.r_[output, np.tanh(self.projection @ output + self.bias), 1.]

    def act(self, output):
        if self.coefficients is None:
            raise RuntimeError("No trained readout loaded; run training")
        return np.clip(self.features(output) @ self.coefficients,
                       [-.5, -2, -1.5], [2, 2, 1.5])

    def fit(self, features, targets, regularization=.02):
        x, y = np.asarray(features), np.asarray(targets)
        penalty = np.eye(x.shape[1]) * regularization
        penalty[-1, -1] = 0
        self.coefficients = np.linalg.solve(x.T @ x + penalty, x.T @ y)
        return float(np.mean((x @ self.coefficients - y) ** 2))

